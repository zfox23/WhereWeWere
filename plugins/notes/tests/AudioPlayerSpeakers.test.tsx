import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioPlayer } from '../ui/audio/AudioPlayer';
import { notes, type NoteAudioWithTranscript } from '../ui/api';

vi.mock('../ui/api', async (orig) => {
  const actual = await orig<typeof import('../ui/api')>();
  return {
    ...actual,
    notes: {
      ...actual.notes,
      audioUrl: (id: string) => `/api/v1/notes/audio/${id}`,
      identifySpeakers: vi.fn(async () => ({ id: 'a1' })),
      renameSpeakers: vi.fn(async () => ({ speakers: {} })),
      saveTranscript: vi.fn(async () => ({ segments: [] })),
      retranscribe: vi.fn(async () => ({ id: 'a1' })),
    },
  };
});

const seg = (idx: number, text: string, speaker: string | null) => ({ idx, start_ms: idx * 2000, end_ms: idx * 2000 + 1900, text, edited: false, speaker });

const make = (over: Partial<NoteAudioWithTranscript> = {}): NoteAudioWithTranscript => ({
  id: 'a1', note_id: 'n1', filename: 'chat.webm', mime: 'audio/webm', bytes: 100, duration_ms: 12_000, position: 0,
  status: 'done', error: null, language: 'en', model: 'm', created_at: '2024-01-01T00:00:00Z',
  speakers: {}, diarization_status: 'done', diarization_error: null,
  segments: [
    seg(0, 'How are you?', 'S1'),
    seg(1, 'I am well.', 'S2'),
    seg(2, 'Glad to hear it.', 'S1'),
    seg(3, 'And you carry on.', 'S1'), // same speaker again: no new chip
  ],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

const chips = () => screen.queryAllByRole('button', { name: /\(rename\)$/ }).map((b) => b.textContent?.trim());

describe('speakers in a transcript', () => {
  it('shows a chip where the speaker changes, not on every line', () => {
    render(<AudioPlayer audio={make()} onChanged={vi.fn()} />);
    expect(chips()).toEqual(['Speaker 1', 'Speaker 2', 'Speaker 1']); // 4 lines, 3 changes
  });

  it('uses the names the user chose', () => {
    render(<AudioPlayer audio={make({ speakers: { S1: 'Dad' } })} onChanged={vi.fn()} />);
    expect(chips()).toEqual(['Dad', 'Speaker 2', 'Dad']);
  });

  it('shows no chips on a transcript without speakers', () => {
    render(<AudioPlayer audio={make({ diarization_status: 'none', segments: [seg(0, 'Plain.', null), seg(1, 'Text.', null)] })} onChanged={vi.fn()} />);
    expect(chips()).toEqual([]);
  });

  it('keeps clicking a line seeking the audio', async () => {
    const { container } = render(<AudioPlayer audio={make()} onChanged={vi.fn()} />);
    vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    await userEvent.click(screen.getByRole('button', { name: /I am well/ }));
    expect(container.querySelector('audio')!.currentTime).toBe(2);
  });
});

describe('renaming a speaker', () => {
  it('saves a new name on Enter, for that speaker only', async () => {
    const onChanged = vi.fn();
    render(<AudioPlayer audio={make()} onChanged={onChanged} />);
    await userEvent.click(screen.getAllByRole('button', { name: 'Speaker 1 (rename)' })[0]);
    const input = screen.getByRole('textbox', { name: 'Name for Speaker 1' });
    await userEvent.type(input, 'Dad{Enter}');
    await waitFor(() => expect(notes.renameSpeakers).toHaveBeenCalledWith('a1', { S1: 'Dad' }));
    expect(onChanged).toHaveBeenCalled();
  });

  it('opens one box, at the chip you clicked, even when that speaker appears in several places', async () => {
    render(<AudioPlayer audio={make()} onChanged={vi.fn()} />);
    expect(screen.getAllByRole('button', { name: 'Speaker 1 (rename)' })).toHaveLength(2); // S1 speaks in two places
    await userEvent.click(screen.getAllByRole('button', { name: 'Speaker 1 (rename)' })[1]);
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Speaker 1 (rename)' })).toHaveLength(1); // the other chip is still a chip
    expect(notes.renameSpeakers).not.toHaveBeenCalled(); // nothing saved just by opening it
  });

  it('saves when you click away, and a blank name sends an empty string (back to "Speaker N")', async () => {
    render(<AudioPlayer audio={make({ speakers: { S2: 'Cass' } })} onChanged={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Cass (rename)' }));
    const input = screen.getByRole('textbox', { name: 'Name for Cass' });
    expect(input).toHaveValue('Cass');
    await userEvent.clear(input);
    await userEvent.tab();
    await waitFor(() => expect(notes.renameSpeakers).toHaveBeenCalledWith('a1', { S2: '' }));
  });

  it('Escape cancels without saving', async () => {
    render(<AudioPlayer audio={make()} onChanged={vi.fn()} />);
    await userEvent.click(screen.getAllByRole('button', { name: 'Speaker 1 (rename)' })[0]);
    await userEvent.type(screen.getByRole('textbox'), 'Nope{Escape}');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(notes.renameSpeakers).not.toHaveBeenCalled();
  });

  it('shows an error if the rename is refused', async () => {
    vi.mocked(notes.renameSpeakers).mockRejectedValueOnce(new Error('A speaker name can be at most 60 characters'));
    render(<AudioPlayer audio={make()} onChanged={vi.fn()} />);
    await userEvent.click(screen.getAllByRole('button', { name: 'Speaker 1 (rename)' })[0]);
    await userEvent.type(screen.getByRole('textbox'), 'x{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('at most 60 characters');
  });

  it('cannot be renamed while editing the transcript text', async () => {
    render(<AudioPlayer audio={make()} onChanged={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /Edit transcript/ }));
    for (const chip of screen.getAllByRole('button', { name: /\(rename\)$/ })) expect(chip).toBeDisabled();
  });
});

describe('identifying speakers', () => {
  it('offers to identify when there are none yet, and to do it again when there are', () => {
    const { rerender } = render(<AudioPlayer audio={make({ diarization_status: 'none', segments: [seg(0, 'Hi.', null)] })} onChanged={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Identify speakers' })).toBeInTheDocument();
    rerender(<AudioPlayer audio={make()} onChanged={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Identify speakers again' })).toBeInTheDocument();
  });

  it('starts identification and refreshes', async () => {
    const onChanged = vi.fn();
    render(<AudioPlayer audio={make({ diarization_status: 'none', segments: [seg(0, 'Hi.', null)] })} onChanged={onChanged} />);
    await userEvent.click(screen.getByRole('button', { name: 'Identify speakers' }));
    await waitFor(() => expect(notes.identifySpeakers).toHaveBeenCalledWith('a1'));
    expect(onChanged).toHaveBeenCalled();
  });

  it('warns before replacing names you chose, and does nothing if you decline', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<AudioPlayer audio={make({ speakers: { S1: 'Dad' } })} onChanged={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Identify speakers again' }));
    expect(confirm.mock.calls[0][0]).toContain('replaces the speaker names');
    expect(notes.identifySpeakers).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Identify speakers again' }));
    await waitFor(() => expect(notes.identifySpeakers).toHaveBeenCalledTimes(1));
  });

  it('does not ask for confirmation when no names would be lost', async () => {
    const confirm = vi.spyOn(window, 'confirm');
    render(<AudioPlayer audio={make()} onChanged={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Identify speakers again' }));
    expect(confirm).not.toHaveBeenCalled();
  });

  it('shows progress and hides the button while it runs', () => {
    render(<AudioPlayer audio={make({ diarization_status: 'processing' })} onChanged={vi.fn()} />);
    expect(screen.getByText(/Identifying speakers…/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Identify speakers/ })).toBeNull();
  });

  it('says why a pending run has not finished yet', () => {
    render(<AudioPlayer audio={make({ diarization_status: 'pending', diarization_error: 'Diarization service returned 503' })} onChanged={vi.fn()} />);
    expect(screen.getByText(/last attempt failed: Diarization service returned 503/)).toBeInTheDocument();
  });

  it('reports a failure with its reason and lets you retry', async () => {
    render(<AudioPlayer audio={make({ diarization_status: 'failed', diarization_error: 'Could not decode the audio' })} onChanged={vi.fn()} />);
    expect(screen.getByText(/Speaker identification failed — Could not decode the audio/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Identify speakers' })).toBeEnabled();
  });

  it('notes when no speech was found', () => {
    render(<AudioPlayer audio={make({ diarization_error: 'No speech was detected, so no speakers were found.' })} onChanged={vi.fn()} />);
    expect(screen.getByText('No speech was detected, so no speakers were found.')).toBeInTheDocument();
  });

  it('shows the server’s message when the service is not set up', async () => {
    vi.mocked(notes.identifySpeakers).mockRejectedValueOnce(new Error('Set up speaker identification in Settings > Integrations first.'));
    render(<AudioPlayer audio={make({ diarization_status: 'none', segments: [seg(0, 'Hi.', null)] })} onChanged={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Identify speakers' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Settings > Integrations');
  });

  it('is not offered before the transcript exists', () => {
    render(<AudioPlayer audio={make({ status: 'processing', segments: [] })} onChanged={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /Identify speakers/ })).toBeNull();
  });
});

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioPlayer, activeSegmentIndex } from '../ui/audio/AudioPlayer';
import { notes, type NoteAudioWithTranscript } from '../ui/api';

vi.mock('../ui/api', async (orig) => {
  const actual = await orig<typeof import('../ui/api')>();
  return {
    ...actual,
    notes: {
      ...actual.notes,
      audioUrl: (id: string) => `/api/v1/notes/audio/${id}`,
      saveTranscript: vi.fn(async () => ({ segments: [] })),
      retranscribe: vi.fn(async () => ({ id: 'a1' })),
    },
  };
});

const make = (over: Partial<NoteAudioWithTranscript> = {}): NoteAudioWithTranscript => ({
  id: 'a1', note_id: 'n1', filename: 'walk.webm', mime: 'audio/webm', bytes: 1000, duration_ms: 9000, position: 0,
  status: 'done', error: null, language: 'en', model: 'm', created_at: '2024-01-01T00:00:00Z',
  segments: [
    { idx: 0, start_ms: 0, end_ms: 3000, text: 'First line.', edited: false },
    { idx: 1, start_ms: 3000, end_ms: 6000, text: 'Second line.', edited: true },
    { idx: 2, start_ms: 6000, end_ms: 9000, text: 'Third line.', edited: false },
  ],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
});
afterEach(cleanup);

describe('activeSegmentIndex', () => {
  const segs = [{ start_ms: 0, end_ms: 1000 }, { start_ms: 1000, end_ms: 2000 }, { start_ms: 5000, end_ms: 6000 }];
  it('finds the segment being spoken, holds through short gaps, and lets go after long ones', () => {
    expect(activeSegmentIndex(segs, 0)).toBe(0);
    expect(activeSegmentIndex(segs, 1500)).toBe(1);
    expect(activeSegmentIndex(segs, 3000)).toBe(1); // 1 s into a gap
    expect(activeSegmentIndex(segs, 4500)).toBe(-1); // long silence
    expect(activeSegmentIndex(segs, 5500)).toBe(2);
    expect(activeSegmentIndex([], 100)).toBe(-1);
  });
});

describe('AudioPlayer', () => {
  it('plays the original from the audio endpoint', () => {
    const { container } = render(<AudioPlayer audio={make()} onChanged={vi.fn()} />);
    expect(container.querySelector('audio')!.getAttribute('src')).toBe('/api/v1/notes/audio/a1');
  });

  it('seeks to a segment when it is clicked and starts playing', async () => {
    const user = userEvent.setup();
    const { container } = render(<AudioPlayer audio={make()} onChanged={vi.fn()} />);
    const el = container.querySelector('audio')!;
    await user.click(screen.getByRole('button', { name: /Third line/ }));
    expect(el.currentTime).toBe(6);
    expect(el.play).toHaveBeenCalled();
  });

  it('highlights the segment being played', () => {
    const { container } = render(<AudioPlayer audio={make()} onChanged={vi.fn()} />);
    const el = container.querySelector('audio')!;
    Object.defineProperty(el, 'currentTime', { configurable: true, writable: true, value: 4 });
    fireEvent.timeUpdate(el);
    expect(screen.getByRole('button', { name: /Second line/ })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: /First line/ })).not.toHaveAttribute('aria-current');
  });

  it('changes playback speed', async () => {
    const user = userEvent.setup();
    const { container } = render(<AudioPlayer audio={make()} onChanged={vi.fn()} />);
    await user.selectOptions(screen.getByLabelText('Playback speed'), '1.5');
    expect(container.querySelector('audio')!.playbackRate).toBe(1.5);
  });

  it('saves corrected text for every segment', async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    render(<AudioPlayer audio={make()} onChanged={onChanged} />);
    await user.click(screen.getByRole('button', { name: /Edit transcript/ }));
    const box = screen.getByLabelText('Transcript at 0:03');
    await user.clear(box);
    await user.type(box, 'Fixed line.');
    await user.click(screen.getByRole('button', { name: /Save transcript/ }));
    await waitFor(() => expect(notes.saveTranscript).toHaveBeenCalledWith('a1', [
      { idx: 0, text: 'First line.' }, { idx: 1, text: 'Fixed line.' }, { idx: 2, text: 'Third line.' },
    ]));
    expect(onChanged).toHaveBeenCalled();
  });

  it('warns before a re-transcription would discard corrections', async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<AudioPlayer audio={make()} onChanged={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /Transcribe again/ }));
    expect(confirm.mock.calls[0][0]).toContain('corrections');
    expect(notes.retranscribe).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /Transcribe again/ }));
    await waitFor(() => expect(notes.retranscribe).toHaveBeenCalledWith('a1'));
  });

  it('shows progress while waiting, and the reason with a retry when transcription failed', async () => {
    const { rerender } = render(<AudioPlayer audio={make({ status: 'processing', segments: [] })} onChanged={vi.fn()} />);
    expect(screen.getByText('Transcribing…')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Transcript' })).toBeNull();
    rerender(<AudioPlayer audio={make({ status: 'failed', error: 'Transcription service returned 503', segments: [] })} onChanged={vi.fn()} />);
    expect(screen.getByText(/Transcription failed — Transcription service returned 503/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Retry/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Edit transcript/ })).toBeNull();
  });

  it('marks corrected segments', () => {
    render(<AudioPlayer audio={make()} onChanged={vi.fn()} />);
    expect(within(screen.getByRole('button', { name: /Second line/ })).getByTitle('Corrected by you')).toBeInTheDocument();
  });
});

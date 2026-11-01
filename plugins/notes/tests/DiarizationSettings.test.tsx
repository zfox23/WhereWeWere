import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DiarizationSettings, parseSpeakerCount } from '../ui/DiarizationSettings';
import { plugins } from '../../../client/src/plugins/api';
import { notes } from '../ui/api';

vi.mock('../../../client/src/plugins/api', () => ({ plugins: { settings: { get: vi.fn(), set: vi.fn() } } }));
vi.mock('../ui/api', () => ({ notes: { testDiarization: vi.fn() } }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(plugins.settings.get).mockResolvedValue({});
  vi.mocked(plugins.settings.set).mockResolvedValue({});
});
afterEach(cleanup);

const loaded = async () => {
  render(<DiarizationSettings />);
  await waitFor(() => expect(screen.getByRole('button', { name: /Save speaker identification settings/ })).toBeEnabled());
};

describe('parseSpeakerCount', () => {
  it('accepts blank and whole numbers 1-20 only', () => {
    expect([parseSpeakerCount(''), parseSpeakerCount('  '), parseSpeakerCount('2'), parseSpeakerCount(' 20 ')]).toEqual([null, null, 2, 20]);
    for (const bad of ['0', '21', '1.5', 'two', '-1']) expect(parseSpeakerCount(bad)).toBeUndefined();
  });
});

describe('DiarizationSettings', () => {
  it('loads what is saved', async () => {
    vi.mocked(plugins.settings.get).mockResolvedValue({ diarization_api_url: 'http://dz:8001', diarization_min_speakers: 2, diarization_max_speakers: 4 });
    render(<DiarizationSettings />);
    await waitFor(() => expect(screen.getByLabelText('Speaker identification service URL')).toHaveValue('http://dz:8001'));
    expect(screen.getByLabelText(/Fewest speakers/)).toHaveValue('2');
    expect(screen.getByLabelText(/Most speakers/)).toHaveValue('4');
  });

  it('saves the URL (trailing slash removed) and the speaker hints as numbers', async () => {
    await loaded();
    await userEvent.type(screen.getByLabelText('Speaker identification service URL'), 'http://diarization:8001/');
    await userEvent.type(screen.getByLabelText(/Fewest speakers/), '2');
    await userEvent.type(screen.getByLabelText(/Most speakers/), '2');
    await userEvent.click(screen.getByRole('button', { name: /Save speaker identification settings/ }));
    await waitFor(() => expect(plugins.settings.set).toHaveBeenCalledWith('notes', {
      diarization_api_url: 'http://diarization:8001', diarization_min_speakers: 2, diarization_max_speakers: 2,
    }));
    expect(await screen.findByText(/New transcripts get speakers automatically/)).toBeInTheDocument();
  });

  it('a blank URL turns it off, and blank hints mean auto-detect', async () => {
    await loaded();
    await userEvent.click(screen.getByRole('button', { name: /Save speaker identification settings/ }));
    await waitFor(() => expect(plugins.settings.set).toHaveBeenCalledWith('notes', {
      diarization_api_url: null, diarization_min_speakers: null, diarization_max_speakers: null,
    }));
    expect(await screen.findByText('Saved. Speaker identification is off.')).toBeInTheDocument();
  });

  it('refuses nonsense counts or a reversed range without saving', async () => {
    await loaded();
    await userEvent.type(screen.getByLabelText(/Fewest speakers/), '25');
    await userEvent.click(screen.getByRole('button', { name: /Save speaker identification settings/ }));
    expect(await screen.findByText(/whole numbers from 1 to 20/)).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText(/Fewest speakers/));
    await userEvent.type(screen.getByLabelText(/Fewest speakers/), '5');
    await userEvent.type(screen.getByLabelText(/Most speakers/), '2');
    await userEvent.click(screen.getByRole('button', { name: /Save speaker identification settings/ }));
    expect(await screen.findByText(/can’t be more than the most/)).toBeInTheDocument();
    expect(plugins.settings.set).not.toHaveBeenCalled();
  });

  it('tests the connection and shows the service’s answer', async () => {
    vi.mocked(notes.testDiarization).mockResolvedValue({ ok: false, message: 'The service is running but its model is not available: HF_TOKEN is not set' });
    await loaded();
    expect(screen.getByRole('button', { name: 'Test connection' })).toBeDisabled(); // needs a URL
    await userEvent.type(screen.getByLabelText('Speaker identification service URL'), 'http://dz:8001');
    await userEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    await waitFor(() => expect(notes.testDiarization).toHaveBeenCalledWith('http://dz:8001'));
    expect(await screen.findByText(/HF_TOKEN is not set/)).toBeInTheDocument();
  });

  it('shows a save error', async () => {
    vi.mocked(plugins.settings.set).mockRejectedValue(new Error('Server said no'));
    await loaded();
    await userEvent.click(screen.getByRole('button', { name: /Save speaker identification settings/ }));
    expect(await screen.findByText('Server said no')).toBeInTheDocument();
  });
});

import 'fake-indexeddb/auto';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioSection } from '../ui/audio/AudioSection';
import { CHANNELS_KEY } from '../ui/audio/audioInput';
import { DEFAULT_PROCESSING, PROCESSING_KEY } from '../ui/audio/audioSettings';

// A recorder whose microphone was silent with the chosen settings, and which recovered.
vi.mock('../ui/audio/recorder', async (orig) => {
  const actual = await orig<typeof import('../ui/audio/recorder')>();
  class FakeRecorder {
    constructor(private opts: unknown, private events: Record<string, (...a: unknown[]) => void>) {}
    async start() {
      this.events.onState?.('starting');
      const processing = { ...DEFAULT_PROCESSING, noiseSuppression: true, sampleRate: null, sampleSize: null };
      this.events.onRecovered?.({ attempt: { label: 'with noise suppression turned on', hintsDropped: true, processing }, label: 'with noise suppression turned on' });
      this.events.onState?.('recording');
      return { id: 'rec-1' };
    }
    pause() {}
    resume() {}
    async stop() { return { meta: null, unsaved: null }; }
  }
  return { ...actual, NoteRecorder: FakeRecorder, browserDeps: () => ({}) };
});

const devices = [
  { deviceId: 'ff-mic', label: 'Phone Microphone', kind: 'audioinput' },
];
const props = { userId: 'u1', editId: null, localIds: [], onLocalIdsChange: vi.fn(), onServerCount: vi.fn(), onRecordingChange: vi.fn() };

beforeEach(() => {
  window.localStorage.clear();
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { enumerateDevices: vi.fn(async () => devices), addEventListener: vi.fn(), removeEventListener: vi.fn(), getSupportedConstraints: () => ({ echoCancellation: true, noiseSuppression: true, autoGainControl: true, sampleRate: true }), getUserMedia: vi.fn() },
  });
});
afterEach(cleanup);

describe('AudioSection keeps what made a silent microphone work', () => {
  it('saves the working settings for that microphone and switches the channels to Auto', async () => {
    const user = userEvent.setup();
    render(<AudioSection {...props} />);
    await screen.findByRole('option', { name: 'Phone Microphone' });
    await user.selectOptions(screen.getByLabelText('Microphone'), 'ff-mic');
    await user.click(screen.getByRole('button', { name: /Record/ }));

    await waitFor(() => expect(window.localStorage.getItem(CHANNELS_KEY)).toBe('auto'));
    const saved = JSON.parse(window.localStorage.getItem(PROCESSING_KEY)!);
    expect(saved).toEqual([expect.objectContaining({
      deviceId: 'ff-mic', label: 'Phone Microphone',
      settings: expect.objectContaining({ noiseSuppression: true, echoCancellation: false, sampleRate: null }),
    })]);

    // The panel and the channel switch show it, so the change is visible and reversible.
    expect(screen.getByRole('radio', { name: 'Auto' })).toHaveAttribute('aria-checked', 'true');
    await user.click(screen.getByRole('button', { name: /Advanced audio settings/ }));
    expect(screen.getByRole('checkbox', { name: /Noise suppression/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Echo cancellation/ })).not.toBeChecked();
  });
});

describe('the Auto channel choice', () => {
  it('is offered and remembered', async () => {
    const user = userEvent.setup();
    render(<AudioSection {...props} />);
    await screen.findByLabelText('Microphone');
    expect(screen.getByRole('radio', { name: 'Stereo' })).toHaveAttribute('aria-checked', 'true');
    await user.click(screen.getByRole('radio', { name: 'Auto' }));
    expect(window.localStorage.getItem(CHANNELS_KEY)).toBe('auto');
  });
});

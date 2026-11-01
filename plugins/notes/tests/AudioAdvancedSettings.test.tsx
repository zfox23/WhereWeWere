import 'fake-indexeddb/auto';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioAdvancedSettings, appliedRows } from '../ui/audio/AudioAdvancedSettings';
import { AudioSection } from '../ui/audio/AudioSection';
import { DEFAULT_PROCESSING, PROCESSING_KEY, type AudioProcessing } from '../ui/audio/audioSettings';

const SUPPORTED = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, sampleRate: true, sampleSize: true, voiceIsolation: false };

function setMediaDevices(over: Record<string, unknown> = {}, supported: Record<string, boolean> = SUPPORTED) {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      enumerateDevices: vi.fn(async () => []),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      getSupportedConstraints: () => supported,
      getUserMedia: vi.fn(),
      ...over,
    },
  });
}

beforeEach(() => {
  window.localStorage.clear();
  setMediaDevices();
});
afterEach(cleanup);

function renderPanel(over: Partial<React.ComponentProps<typeof AudioAdvancedSettings>> = {}) {
  const props = {
    mic: { deviceId: 'usb', label: 'Blue Yeti' },
    value: { ...DEFAULT_PROCESSING },
    onChange: vi.fn(),
    onReset: vi.fn(),
    locked: false,
    applied: null,
    ...over,
  };
  render(<AudioAdvancedSettings {...props} />);
  return props;
}
const expand = () => userEvent.click(screen.getByRole('button', { name: /Advanced audio settings/ }));

describe('AudioAdvancedSettings', () => {
  it('is collapsed until opened, and says which microphone the settings are saved for', async () => {
    renderPanel();
    const toggle = screen.getByRole('button', { name: /Advanced audio settings/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText('Echo cancellation')).toBeNull();
    await expand();
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/Saved for Blue Yeti on this device/)).toBeInTheDocument();
  });

  it('offers the echo, noise and gain switches (off by default) and reports each change', async () => {
    const { onChange } = renderPanel();
    await expand();
    for (const name of ['Echo cancellation', 'Noise suppression', 'Automatic gain control']) {
      expect(screen.getByRole('checkbox', { name: new RegExp(name) })).not.toBeChecked();
    }
    await userEvent.click(screen.getByRole('checkbox', { name: /Noise suppression/ }));
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_PROCESSING, noiseSuppression: true });
  });

  it('shows saved choices as checked', async () => {
    renderPanel({ value: { ...DEFAULT_PROCESSING, echoCancellation: true } });
    await expand();
    expect(screen.getByRole('checkbox', { name: /Echo cancellation/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Noise suppression/ })).not.toBeChecked();
  });

  it('only offers voice isolation where the browser supports it', async () => {
    renderPanel();
    await expand();
    expect(screen.queryByRole('checkbox', { name: /Voice isolation/ })).toBeNull();
    cleanup();
    setMediaDevices({}, { ...SUPPORTED, voiceIsolation: true });
    const { onChange } = renderPanel();
    await expand();
    await userEvent.click(screen.getByRole('checkbox', { name: /Voice isolation/ }));
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_PROCESSING, voiceIsolation: true });
  });

  it('disables a switch the browser does not support, and says so', async () => {
    cleanup();
    setMediaDevices({}, { ...SUPPORTED, autoGainControl: false });
    renderPanel();
    await expand();
    const gain = screen.getByRole('checkbox', { name: /Automatic gain control/ });
    expect(gain).toBeDisabled();
    expect(screen.getByText('Not supported by this browser.')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Echo cancellation/ })).toBeEnabled();
  });

  it('changes the sample rate, including back to the browser default', async () => {
    const { onChange } = renderPanel();
    await expand();
    const rate = screen.getByLabelText('Sample rate') as HTMLSelectElement;
    expect(rate.value).toBe('48000');
    await userEvent.selectOptions(rate, '16000');
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_PROCESSING, sampleRate: 16000 });
    await userEvent.selectOptions(rate, '');
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_PROCESSING, sampleRate: null });
  });

  it('locks every control while recording, but still lets you read them', async () => {
    renderPanel({ locked: true });
    await expand();
    expect(screen.getByText(/Locked while recording/)).toBeInTheDocument();
    for (const box of screen.getAllByRole('checkbox')) expect(box).toBeDisabled();
    expect(screen.getByLabelText('Sample rate')).toBeDisabled();
    expect(screen.getByRole('button', { name: /Check what this microphone supports/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Reset to defaults/ })).toBeDisabled();
  });

  it('resets to defaults', async () => {
    const { onReset } = renderPanel({ value: { ...DEFAULT_PROCESSING, echoCancellation: true } });
    await expand();
    await userEvent.click(screen.getByRole('button', { name: /Reset to defaults/ }));
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  describe('asking the microphone what it supports', () => {
    const track = (caps: Record<string, unknown>, settings: Record<string, unknown> = {}) => ({
      getCapabilities: () => caps, getSettings: () => settings, stop: vi.fn(),
    });
    const stream = (t: ReturnType<typeof track>) => ({ getAudioTracks: () => [t], getTracks: () => [t] });

    it('locks a switch the microphone fixes, narrows the sample rates, and shows its own defaults', async () => {
      const t = track(
        { echoCancellation: [false], noiseSuppression: [true, false], sampleRate: { min: 16000, max: 48000 }, sampleSize: { min: 16, max: 24 } },
        { echoCancellation: false, noiseSuppression: false, autoGainControl: false, sampleRate: 48000, channelCount: 1, latency: 0.01 },
      );
      setMediaDevices({ getUserMedia: vi.fn(async () => stream(t)) });
      renderPanel();
      await expand();
      expect(screen.queryByLabelText('Sample size')).toBeNull(); // nothing to choose until asked
      await userEvent.click(screen.getByRole('button', { name: /Check what this microphone supports/ }));

      await waitFor(() => expect(screen.getByText('Fixed off by this microphone or browser.')).toBeInTheDocument());
      expect(screen.getByRole('checkbox', { name: /Echo cancellation/ })).toBeDisabled();
      expect(screen.getByRole('checkbox', { name: /Noise suppression/ })).toBeEnabled();
      const rates = within(screen.getByLabelText('Sample rate')).getAllByRole('option').map((o) => o.textContent);
      expect(rates).toEqual(['Browser default', '16 kHz', '22.05 kHz', '24 kHz', '32 kHz', '44.1 kHz', '48 kHz']);
      expect(within(screen.getByLabelText('Sample size')).getAllByRole('option').map((o) => o.textContent)).toEqual(['Microphone default', '16-bit', '24-bit']);
      expect(screen.getByText('The browser’s default for this microphone')).toBeInTheDocument();
      expect(t.stop).toHaveBeenCalled(); // the microphone is released again
    });

    it('explains a refusal in plain words', async () => {
      setMediaDevices({ getUserMedia: vi.fn(async () => { throw Object.assign(new Error('x'), { name: 'NotAllowedError' }); }) });
      renderPanel();
      await expand();
      await userEvent.click(screen.getByRole('button', { name: /Check what this microphone supports/ }));
      expect(await screen.findByRole('alert')).toHaveTextContent(/Microphone access was blocked/);
    });
  });

  it('shows what the browser really applied, in readable units', async () => {
    renderPanel({
      applied: { echoCancellation: true, noiseSuppression: false, autoGainControl: false, sampleRate: 44100, channelCount: 2, sampleSize: 16, latency: 0.012 } as MediaTrackSettings,
    });
    await expand();
    expect(screen.getByText('Applied by the browser (last recording)')).toBeInTheDocument();
    const rows = Object.fromEntries(appliedRows({ echoCancellation: true, sampleRate: 44100, channelCount: 2, sampleSize: 16, latency: 0.012 } as MediaTrackSettings).map((r) => [r.label, r.value]));
    expect(rows).toMatchObject({ 'Echo cancellation': 'on', 'Sample rate': '44.10 kHz', Channels: '2', 'Sample size': '16-bit', Latency: '12 ms' });
    expect(screen.getByText('44.10 kHz')).toBeInTheDocument();
    expect(appliedRows(null)).toEqual([]);
    expect(appliedRows({ sampleRate: 48000 } as MediaTrackSettings).find((r) => r.label === 'Sample rate')?.value).toBe('48 kHz');
  });
});

describe('AudioSection: settings follow the microphone', () => {
  const devices = [
    { deviceId: 'built-in', label: 'Built-in Microphone', kind: 'audioinput' },
    { deviceId: 'usb-9', label: 'Blue Yeti', kind: 'audioinput' },
  ];
  const sectionProps = { userId: 'u1', editId: null, localIds: [], onLocalIdsChange: vi.fn(), onServerCount: vi.fn(), onRecordingChange: vi.fn() };
  const saved = (): { deviceId: string; settings: AudioProcessing }[] => JSON.parse(window.localStorage.getItem(PROCESSING_KEY) ?? '[]');

  beforeEach(() => setMediaDevices({ enumerateDevices: vi.fn(async () => devices) }));

  it('saves a change for the selected microphone only, and restores it when that microphone is selected again', async () => {
    const user = userEvent.setup();
    render(<AudioSection {...sectionProps} />);
    await screen.findByRole('option', { name: 'Blue Yeti' });
    await user.selectOptions(screen.getByLabelText('Microphone'), 'usb-9');
    await user.click(screen.getByRole('button', { name: /Advanced audio settings/ }));
    await user.click(screen.getByRole('checkbox', { name: /Noise suppression/ }));

    expect(saved()).toEqual([expect.objectContaining({ deviceId: 'usb-9', label: 'Blue Yeti', settings: expect.objectContaining({ noiseSuppression: true }) })]);

    // The other microphone starts from the defaults...
    await user.selectOptions(screen.getByLabelText('Microphone'), 'built-in');
    expect(screen.getByRole('checkbox', { name: /Noise suppression/ })).not.toBeChecked();
    expect(screen.getByText(/Saved for Built-in Microphone/)).toBeInTheDocument();
    // ...and the first one has its choice back.
    await user.selectOptions(screen.getByLabelText('Microphone'), 'usb-9');
    expect(screen.getByRole('checkbox', { name: /Noise suppression/ })).toBeChecked();
  });

  it('loads the saved settings on a later visit', async () => {
    window.localStorage.setItem(PROCESSING_KEY, JSON.stringify([
      { deviceId: 'built-in', label: 'Built-in Microphone', settings: { ...DEFAULT_PROCESSING, echoCancellation: true } },
    ]));
    window.localStorage.setItem('wwp:notes:audio-input', JSON.stringify({ deviceId: 'built-in', label: 'Built-in Microphone' }));
    const user = userEvent.setup();
    render(<AudioSection {...sectionProps} />);
    await screen.findByRole('option', { name: 'Blue Yeti' });
    await user.click(screen.getByRole('button', { name: /Advanced audio settings/ }));
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /Echo cancellation/ })).toBeChecked());
  });

  it('reset clears this microphone’s saved settings', async () => {
    const user = userEvent.setup();
    render(<AudioSection {...sectionProps} />);
    await screen.findByRole('option', { name: 'Blue Yeti' });
    await user.selectOptions(screen.getByLabelText('Microphone'), 'usb-9');
    await user.click(screen.getByRole('button', { name: /Advanced audio settings/ }));
    await user.click(screen.getByRole('checkbox', { name: /Echo cancellation/ }));
    expect(saved()).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: /Reset to defaults/ }));
    expect(saved()).toHaveLength(0);
    expect(screen.getByRole('checkbox', { name: /Echo cancellation/ })).not.toBeChecked();
  });
});

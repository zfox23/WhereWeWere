import 'fake-indexeddb/auto';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioSection } from '../ui/audio/AudioSection';
import { CHANNELS_KEY, INPUT_KEY } from '../ui/audio/audioInput';

const devices = [
  { deviceId: 'built-in', label: 'Built-in Microphone', kind: 'audioinput' },
  { deviceId: 'usb-9', label: 'Blue Yeti', kind: 'audioinput' },
  { deviceId: 'spk', label: 'Speakers', kind: 'audiooutput' },
];

const props = { userId: 'u1', editId: null, localIds: [], onLocalIdsChange: vi.fn(), onServerCount: vi.fn(), onRecordingChange: vi.fn() };

beforeEach(() => {
  window.localStorage.clear();
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { enumerateDevices: vi.fn(async () => devices), addEventListener: vi.fn(), removeEventListener: vi.fn(), getUserMedia: vi.fn() },
  });
});
afterEach(cleanup);

describe('AudioSection microphone picker', () => {
  it('lists only input devices and remembers the choice on this device', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<AudioSection {...props} />);
    const select = (await screen.findByLabelText('Microphone')) as HTMLSelectElement;
    await waitFor(() => expect(screen.getByRole('option', { name: 'Blue Yeti' })).toBeInTheDocument());
    expect(screen.queryByRole('option', { name: 'Speakers' })).toBeNull();

    await user.selectOptions(select, 'usb-9');
    expect(JSON.parse(window.localStorage.getItem(INPUT_KEY)!)).toEqual({ deviceId: 'usb-9', label: 'Blue Yeti' });
    unmount();

    // A later visit starts on the remembered microphone.
    render(<AudioSection {...props} />);
    await waitFor(() => expect((screen.getByLabelText('Microphone') as HTMLSelectElement).value).toBe('usb-9'));
  });

  it('falls back to the system default when the remembered microphone is unplugged', async () => {
    window.localStorage.setItem(INPUT_KEY, JSON.stringify({ deviceId: 'gone', label: 'Old Mic' }));
    render(<AudioSection {...props} />);
    await waitFor(() => expect(screen.getByRole('option', { name: 'Blue Yeti' })).toBeInTheDocument());
    expect((screen.getByLabelText('Microphone') as HTMLSelectElement).value).toBe('');
  });
});

describe('AudioSection channel choice', () => {
  const group = () => screen.getByRole('radiogroup', { name: 'Channels' });

  it('defaults to stereo, and remembers mono on this device', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<AudioSection {...props} />);
    await screen.findByLabelText('Microphone');
    expect(screen.getByRole('radio', { name: 'Stereo' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Mono' })).toHaveAttribute('aria-checked', 'false');

    await user.click(screen.getByRole('radio', { name: 'Mono' }));
    expect(window.localStorage.getItem(CHANNELS_KEY)).toBe('1');
    expect(screen.getByRole('radio', { name: 'Mono' })).toHaveAttribute('aria-checked', 'true');
    unmount();

    render(<AudioSection {...props} />);
    await screen.findByLabelText('Microphone');
    expect(screen.getByRole('radio', { name: 'Mono' })).toHaveAttribute('aria-checked', 'true');
    expect(group()).toBeInTheDocument();
  });

  it('treats anything unexpected in storage as stereo', async () => {
    window.localStorage.setItem(CHANNELS_KEY, 'surround');
    render(<AudioSection {...props} />);
    await screen.findByLabelText('Microphone');
    expect(screen.getByRole('radio', { name: 'Stereo' })).toHaveAttribute('aria-checked', 'true');
  });

  it('offers the blank screen only while recording', async () => {
    render(<AudioSection {...props} />);
    await screen.findByLabelText('Microphone');
    expect(screen.queryByRole('button', { name: /Blank screen/ })).toBeNull();
  });
});

/**
 * Which microphone to record with. The choice is remembered per device
 * (localStorage on this browser, and kept across sign-out) because the input
 * hardware belongs to the device, not the account.
 */

import { useCallback, useEffect, useState } from 'react';

export const INPUT_KEY = 'wwp:notes:audio-input';
export const CHANNELS_KEY = 'wwp:notes:audio-channels';

export interface StoredInput {
  deviceId: string;
  label: string;
}

export function loadPreferredInput(): StoredInput | null {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(INPUT_KEY) ?? 'null') as Partial<StoredInput> | null;
    return parsed && typeof parsed.deviceId === 'string' ? { deviceId: parsed.deviceId, label: typeof parsed.label === 'string' ? parsed.label : '' } : null;
  } catch {
    return null;
  }
}

export function savePreferredInput(input: StoredInput | null): void {
  try {
    if (input) window.localStorage.setItem(INPUT_KEY, JSON.stringify(input));
    else window.localStorage.removeItem(INPUT_KEY);
  } catch {
    // storage blocked: the choice just isn't remembered
  }
}

/**
 * Mono, stereo, or "auto" (leave the channel count to the microphone and browser),
 * remembered per device like the microphone. Stereo is the default.
 */
export type ChannelPreference = 1 | 2 | 'auto';

export function loadPreferredChannels(): ChannelPreference {
  try {
    const v = window.localStorage.getItem(CHANNELS_KEY);
    return v === '1' ? 1 : v === 'auto' ? 'auto' : 2;
  } catch {
    return 2;
  }
}

export function savePreferredChannels(channels: ChannelPreference): void {
  try {
    window.localStorage.setItem(CHANNELS_KEY, String(channels));
  } catch {
    // storage blocked: the choice just isn't remembered
  }
}

/**
 * The device to select among those currently plugged in: the remembered one
 * by id, else by label (some browsers rotate ids), else the system default
 * (empty string).
 */
export function resolveInput(devices: Pick<MediaDeviceInfo, 'deviceId' | 'label'>[], stored: StoredInput | null): string {
  if (!stored) return '';
  if (devices.some((d) => d.deviceId === stored.deviceId)) return stored.deviceId;
  if (stored.label) return devices.find((d) => d.label === stored.label)?.deviceId ?? '';
  return '';
}

export interface AudioInputs {
  devices: MediaDeviceInfo[];
  /** '' means the system default. */
  selectedId: string;
  select: (deviceId: string) => void;
  /** Device names stay hidden until the user has granted microphone access once. */
  needsPermission: boolean;
  requestAccess: () => Promise<void>;
  /** Re-read the device list (e.g. after the first recording unlocks their names). */
  refresh: () => Promise<void>;
  error: string | null;
}

export function useAudioInputs(): AudioInputs {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) return;
      const inputs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
      setDevices(inputs);
      setSelectedId(resolveInput(inputs, loadPreferredInput()));
    } catch {
      setError('Could not list the microphones.');
    }
  }, []);

  useEffect(() => {
    void refresh();
    const md = navigator.mediaDevices;
    md?.addEventListener?.('devicechange', refresh);
    return () => md?.removeEventListener?.('devicechange', refresh);
  }, [refresh]);

  const select = useCallback((deviceId: string) => {
    setSelectedId(deviceId);
    const device = devices.find((d) => d.deviceId === deviceId);
    savePreferredInput(device ? { deviceId, label: device.label } : null);
  }, [devices]);

  const requestAccess = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      await refresh();
    } catch (err) {
      setError(micErrorMessage(err));
    }
  }, [refresh]);

  const needsPermission = devices.length > 0 && devices.every((d) => !d.label);
  return { devices, selectedId, select, needsPermission, requestAccess, refresh, error };
}

/** A person-readable reason a microphone could not be opened. */
export function micErrorMessage(err: unknown): string {
  const name = err instanceof DOMException || err instanceof Error ? err.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Microphone access was blocked. Allow it for this site in the browser settings.';
  if (name === 'NotFoundError') return 'No microphone was found.';
  if (name === 'NotReadableError') return 'The microphone is in use by another app.';
  if (name === 'OverconstrainedError') return 'The selected microphone is not available. Pick another one.';
  return err instanceof Error && err.message ? err.message : 'Could not open the microphone.';
}

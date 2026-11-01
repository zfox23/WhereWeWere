import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PROCESSING, PROCESSING_KEY, appliedMismatches, loadProcessing, probeMicrophone, processingConstraints,
  resetProcessing, saveProcessing, supportedAudioConstraints, type AudioProcessing,
} from '../../ui/audio/audioSettings';

const mic = (deviceId: string, label = '') => ({ deviceId, label });
const settings = (over: Partial<AudioProcessing> = {}): AudioProcessing => ({ ...DEFAULT_PROCESSING, ...over });

beforeEach(() => window.localStorage.clear());

describe('defaults and constraints', () => {
  it('defaults to the highest-fidelity request: all voice processing off, 48 kHz', () => {
    expect(processingConstraints(DEFAULT_PROCESSING)).toEqual({
      echoCancellation: false, noiseSuppression: false, autoGainControl: false, sampleRate: { ideal: 48000 },
    });
  });

  it('adds only what was chosen: voice isolation, sample size, or no sample rate at all', () => {
    expect(processingConstraints(settings({ echoCancellation: true, voiceIsolation: true, sampleSize: 24 }))).toEqual({
      echoCancellation: true, noiseSuppression: false, autoGainControl: false,
      voiceIsolation: true, sampleRate: { ideal: 48000 }, sampleSize: { ideal: 24 },
    });
    expect(processingConstraints(settings({ sampleRate: null }))).not.toHaveProperty('sampleRate');
    expect(processingConstraints(settings({ voiceIsolation: false }))).toHaveProperty('voiceIsolation', false);
    expect(processingConstraints(DEFAULT_PROCESSING)).not.toHaveProperty('voiceIsolation');
  });
});

describe('appliedMismatches', () => {
  it('names each setting the browser overrode, and nothing else', () => {
    const applied = { echoCancellation: true, noiseSuppression: false, autoGainControl: true } as MediaTrackSettings;
    expect(appliedMismatches(DEFAULT_PROCESSING, applied)).toEqual([
      'Echo cancellation is on (you chose off)',
      'Automatic gain control is on (you chose off)',
    ]);
  });

  it('is silent when the settings match, are not reported, or voice isolation was not requested', () => {
    expect(appliedMismatches(DEFAULT_PROCESSING, { echoCancellation: false, noiseSuppression: false, autoGainControl: false } as MediaTrackSettings)).toEqual([]);
    expect(appliedMismatches(DEFAULT_PROCESSING, {} as MediaTrackSettings)).toEqual([]);
    expect(appliedMismatches(DEFAULT_PROCESSING, undefined)).toEqual([]);
    expect(appliedMismatches(DEFAULT_PROCESSING, { voiceIsolation: true } as unknown as MediaTrackSettings)).toEqual([]);
    expect(appliedMismatches(settings({ voiceIsolation: false }), { voiceIsolation: true } as unknown as MediaTrackSettings))
      .toEqual(['Voice isolation is on (you chose off)']);
  });
});

describe('settings are saved per microphone', () => {
  it('starts from the defaults and remembers each microphone separately', () => {
    expect(loadProcessing(mic('a', 'USB'))).toEqual(DEFAULT_PROCESSING);
    saveProcessing(mic('a', 'USB'), settings({ noiseSuppression: true }));
    saveProcessing(mic('b', 'Laptop'), settings({ echoCancellation: true, sampleRate: 16000 }));
    expect(loadProcessing(mic('a', 'USB')).noiseSuppression).toBe(true);
    expect(loadProcessing(mic('b', 'Laptop'))).toMatchObject({ echoCancellation: true, noiseSuppression: false, sampleRate: 16000 });
    expect(loadProcessing(mic('c', 'Other'))).toEqual(DEFAULT_PROCESSING);
  });

  it('keeps the system default microphone apart from named ones', () => {
    saveProcessing(mic(''), settings({ autoGainControl: true }));
    expect(loadProcessing(mic('')).autoGainControl).toBe(true);
    expect(loadProcessing(mic('a', 'USB')).autoGainControl).toBe(false);
  });

  it('finds a microphone by label when the browser has changed its id', () => {
    saveProcessing(mic('old-id', 'Blue Yeti'), settings({ noiseSuppression: true }));
    expect(loadProcessing(mic('new-id', 'Blue Yeti')).noiseSuppression).toBe(true);
    // ...and saving under the new id replaces that entry rather than adding a second.
    saveProcessing(mic('new-id', 'Blue Yeti'), settings({ noiseSuppression: false }));
    expect(JSON.parse(window.localStorage.getItem(PROCESSING_KEY)!)).toHaveLength(1);
    expect(loadProcessing(mic('new-id', 'Blue Yeti')).noiseSuppression).toBe(false);
  });

  it('reset forgets only that microphone', () => {
    saveProcessing(mic('a', 'USB'), settings({ noiseSuppression: true }));
    saveProcessing(mic('b', 'Laptop'), settings({ noiseSuppression: true }));
    resetProcessing(mic('a', 'USB'));
    expect(loadProcessing(mic('a', 'USB'))).toEqual(DEFAULT_PROCESSING);
    expect(loadProcessing(mic('b', 'Laptop')).noiseSuppression).toBe(true);
  });

  it('survives corrupt or hostile storage, keeping only valid values', () => {
    window.localStorage.setItem(PROCESSING_KEY, '{not json');
    expect(loadProcessing(mic('a'))).toEqual(DEFAULT_PROCESSING);
    window.localStorage.setItem(PROCESSING_KEY, JSON.stringify({ not: 'an array' }));
    expect(loadProcessing(mic('a'))).toEqual(DEFAULT_PROCESSING);
    window.localStorage.setItem(PROCESSING_KEY, JSON.stringify([
      null, 'x', { label: 'no id' },
      { deviceId: 'a', label: 'A', settings: { echoCancellation: 'yes', sampleRate: 12345, sampleSize: 7, voiceIsolation: 'maybe', noiseSuppression: true } },
    ]));
    expect(loadProcessing(mic('a'))).toEqual({ ...DEFAULT_PROCESSING, noiseSuppression: true });
  });

  it('keeps the most recent 50 microphones', () => {
    for (let i = 0; i < 55; i++) saveProcessing(mic(`id${i}`, `Mic ${i}`), settings({ noiseSuppression: true }));
    expect(JSON.parse(window.localStorage.getItem(PROCESSING_KEY)!)).toHaveLength(50);
    expect(loadProcessing(mic('id54', 'Mic 54')).noiseSuppression).toBe(true);
    expect(loadProcessing(mic('id0', 'Mic 0')).noiseSuppression).toBe(false); // the oldest fell off
  });

  it('does not throw when storage is blocked', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(() => saveProcessing(mic('a'), settings())).not.toThrow();
    spy.mockRestore();
  });
});

describe('what the browser offers', () => {
  it('lists only the constraints this browser supports', () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getSupportedConstraints: () => ({ echoCancellation: true, noiseSuppression: true, voiceIsolation: false, sampleRate: true }) },
    });
    expect([...supportedAudioConstraints()].sort()).toEqual(['echoCancellation', 'noiseSuppression', 'sampleRate']);
  });

  it('is empty when the browser cannot say', () => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
    expect(supportedAudioConstraints().size).toBe(0);
  });

  it('probes a microphone for its capabilities and releases it straight away', async () => {
    const stop = vi.fn();
    const track = { getCapabilities: () => ({ echoCancellation: [true, false], sampleRate: { min: 8000, max: 48000 } }), getSettings: () => ({ sampleRate: 48000, channelCount: 1 }), stop };
    const getUserMedia = vi.fn(async () => ({ getAudioTracks: () => [track], getTracks: () => [track] }));
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
    const result = await probeMicrophone('usb-1');
    expect(getUserMedia).toHaveBeenCalledWith({ audio: { deviceId: { exact: 'usb-1' } } });
    expect(result.capabilities).toMatchObject({ echoCancellation: [true, false], sampleRate: { min: 8000, max: 48000 } });
    expect(result.settings).toMatchObject({ channelCount: 1 });
    expect(stop).toHaveBeenCalled();

    await probeMicrophone('');
    expect(getUserMedia).toHaveBeenLastCalledWith({ audio: true });
  });

  it('releases the microphone even when reading its capabilities fails', async () => {
    const stop = vi.fn();
    const track = { getCapabilities: () => { throw new Error('boom'); }, getSettings: () => ({}), stop };
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: async () => ({ getAudioTracks: () => [track], getTracks: () => [track] }) },
    });
    await expect(probeMicrophone('x')).rejects.toThrow('boom');
    expect(stop).toHaveBeenCalled();
  });
});

import { describe, expect, it } from 'vitest';
import { backoffMs, parseTranscriptionResponse } from '../services/transcription';

describe('parseTranscriptionResponse', () => {
  it('converts segment seconds to milliseconds and trims text', () => {
    const r = parseTranscriptionResponse({
      text: ' Hi there. ', language: 'en', duration: 2.5,
      segments: [{ start: 0, end: 1.2345, text: ' Hi ' }, { start: 1.2345, end: 2.5, text: ' there. ' }, { start: 3, end: 3, text: '  ' }],
    });
    expect(r).toEqual({
      text: 'Hi there.', language: 'en', durationMs: 2500,
      segments: [{ startMs: 0, endMs: 1235, text: 'Hi' }, { startMs: 1235, endMs: 2500, text: 'there.' }],
    });
  });

  it('falls back to one segment when the server returns only text', () => {
    expect(parseTranscriptionResponse({ text: 'Just text' })).toEqual({
      text: 'Just text', language: null, durationMs: null, segments: [{ startMs: 0, endMs: 0, text: 'Just text' }],
    });
  });

  it('joins segments when text is missing, and tolerates junk', () => {
    expect(parseTranscriptionResponse({ segments: [{ start: 0, end: 1, text: 'a' }, { start: 1, end: 2, text: 'b' }] }).text).toBe('a b');
    expect(parseTranscriptionResponse(null)).toEqual({ text: '', language: null, durationMs: null, segments: [] });
  });
});

describe('backoffMs', () => {
  it('doubles from 30 s and caps at one hour', () => {
    expect([1, 2, 3].map(backoffMs)).toEqual([30_000, 60_000, 120_000]);
    expect(backoffMs(50)).toBe(3_600_000);
  });
});

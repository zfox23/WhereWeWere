import { describe, expect, it } from 'vitest';
import { LOOP_MIN_RUN, backoffMs, collapseRepeatedSegments, parseTranscriptionResponse } from '../services/transcription';

describe('parseTranscriptionResponse', () => {
  it('converts segment seconds to milliseconds and trims text', () => {
    const r = parseTranscriptionResponse({
      text: ' Hi there. ', language: 'en', duration: 2.5,
      segments: [{ start: 0, end: 1.2345, text: ' Hi ' }, { start: 1.2345, end: 2.5, text: ' there. ' }, { start: 3, end: 3, text: '  ' }],
    });
    expect(r).toEqual({
      text: 'Hi there.', language: 'en', durationMs: 2500, collapsedRepeats: 0,
      segments: [{ startMs: 0, endMs: 1235, text: 'Hi' }, { startMs: 1235, endMs: 2500, text: 'there.' }],
    });
  });

  it('falls back to one segment when the server returns only text', () => {
    expect(parseTranscriptionResponse({ text: 'Just text' })).toEqual({
      text: 'Just text', language: null, durationMs: null, collapsedRepeats: 0, segments: [{ startMs: 0, endMs: 0, text: 'Just text' }],
    });
  });

  it('joins segments when text is missing, and tolerates junk', () => {
    expect(parseTranscriptionResponse({ segments: [{ start: 0, end: 1, text: 'a' }, { start: 1, end: 2, text: 'b' }] }).text).toBe('a b');
    expect(parseTranscriptionResponse(null)).toEqual({ text: '', language: null, durationMs: null, collapsedRepeats: 0, segments: [] });
  });
});

describe('backoffMs', () => {
  it('doubles from 30 s and caps at one hour', () => {
    expect([1, 2, 3].map(backoffMs)).toEqual([30_000, 60_000, 120_000]);
    expect(backoffMs(50)).toBe(3_600_000);
  });
});

const seg = (text: string, i: number): { startMs: number; endMs: number; text: string } => ({ startMs: i * 1000, endMs: i * 1000 + 900, text });

describe('collapseRepeatedSegments (a model stuck in a loop)', () => {
  it('folds a long run into one segment spanning the run', () => {
    const looped = [seg('Hello there.', 0), ...Array.from({ length: 600 }, (_, i) => seg('So.', i + 1)), seg('Goodbye.', 601)];
    const { segments, collapsed } = collapseRepeatedSegments(looped);
    expect(collapsed).toBe(599);
    expect(segments.map((s) => s.text)).toEqual(['Hello there.', 'So.', 'Goodbye.']);
    expect(segments[1]).toEqual({ startMs: 1000, endMs: 600_900, text: 'So.' }); // covers the whole run
  });

  it('leaves short repetition alone, up to one fewer than the threshold', () => {
    const texts = Array.from({ length: LOOP_MIN_RUN - 1 }, () => 'No.');
    const { segments, collapsed } = collapseRepeatedSegments(texts.map(seg));
    expect(collapsed).toBe(0);
    expect(segments).toHaveLength(LOOP_MIN_RUN - 1);
    expect(collapseRepeatedSegments(Array.from({ length: LOOP_MIN_RUN }, (_, i) => seg('No.', i))).collapsed).toBe(LOOP_MIN_RUN - 1);
  });

  it('treats case and punctuation as the same, and different text as different', () => {
    const run = ['Whee.', 'whee!', 'WHEE', 'Whee...', 'Whee, whee'].map(seg);
    const { segments } = collapseRepeatedSegments(run);
    expect(segments.map((s) => s.text)).toEqual(['Whee.', 'Whee, whee']); // four alike folded, the odd one kept
  });

  it('folds several separate loops, and does not join runs split by real speech', () => {
    const input = [...Array(5).fill('A.'), 'Something real.', ...Array(5).fill('B.')].map(seg);
    const { segments, collapsed } = collapseRepeatedSegments(input);
    expect(segments.map((s) => s.text)).toEqual(['A.', 'Something real.', 'B.']);
    expect(collapsed).toBe(8);
  });

  it('works for any script and ignores segments that are only punctuation', () => {
    expect(collapseRepeatedSegments(Array.from({ length: 5 }, (_, i) => seg('Storbritannia, Storbritannia', i))).segments).toHaveLength(1);
    expect(collapseRepeatedSegments(Array.from({ length: 6 }, (_, i) => seg('...', i))).collapsed).toBe(0);
    expect(collapseRepeatedSegments([])).toEqual({ segments: [], collapsed: 0 });
  });

  it('rebuilds the stored text from the folded segments, so the repeats do not reach search', () => {
    const body = {
      text: `Intro. ${Array(500).fill('So.').join(' ')} Outro.`,
      segments: [{ start: 0, end: 1, text: 'Intro.' }, ...Array.from({ length: 500 }, (_, i) => ({ start: i + 1, end: i + 2, text: 'So.' })), { start: 501, end: 502, text: 'Outro.' }],
    };
    const result = parseTranscriptionResponse(body);
    expect(result.text).toBe('Intro. So. Outro.');
    expect(result.collapsedRepeats).toBe(499);
    expect(result.segments).toHaveLength(3);
  });

  it('keeps the service’s own text when nothing looped', () => {
    const result = parseTranscriptionResponse({ text: 'Exact text, as the service wrote it.', segments: [{ start: 0, end: 1, text: 'Exact text' }] });
    expect(result.text).toBe('Exact text, as the service wrote it.');
    expect(result.collapsedRepeats).toBe(0);
  });
});

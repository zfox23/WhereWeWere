import { describe, expect, it } from 'vitest';
import { parseTurns, speakerHintFields } from '../services/diarization';
import { collapseRepeatedSegments, parseTranscriptionResponse } from '../services/transcription';

describe('speakerHintFields', () => {
  it('sends an exact count when min equals max, otherwise the bounds that are set', () => {
    expect(speakerHintFields({ minSpeakers: 2, maxSpeakers: 2 })).toEqual([['num_speakers', '2']]);
    expect(speakerHintFields({ minSpeakers: 1, maxSpeakers: 3 })).toEqual([['min_speakers', '1'], ['max_speakers', '3']]);
    expect(speakerHintFields({ minSpeakers: null, maxSpeakers: 4 })).toEqual([['max_speakers', '4']]);
    expect(speakerHintFields({ minSpeakers: 2, maxSpeakers: null })).toEqual([['min_speakers', '2']]);
    expect(speakerHintFields({ minSpeakers: null, maxSpeakers: null })).toEqual([]);
  });
});

describe('parseTurns', () => {
  it('keeps well-formed turns and drops anything else', () => {
    expect(parseTurns({
      turns: [
        { start: 0, end: 1.5, speaker: 'SPEAKER_00' },
        { start: 2, end: 2, speaker: 'zero length' },
        { start: -1, end: 1, speaker: 'negative start' },
        { start: 3, end: 4 },
        { start: '3', end: 4, speaker: 'text numbers' },
        null,
        { start: 5, end: 6, speaker: 'SPEAKER_01' },
      ],
    })).toEqual([{ start: 0, end: 1.5, speaker: 'SPEAKER_00' }, { start: 5, end: 6, speaker: 'SPEAKER_01' }]);
  });

  it('tolerates junk bodies', () => {
    for (const raw of [null, undefined, 'x', 5, [], {}, { turns: 'no' }, { turns: {} }]) expect(parseTurns(raw)).toEqual([]);
  });
});

describe('word timings in a transcription response', () => {
  it('reads per-segment words (seconds) into milliseconds, keeping the leading space', () => {
    const r = parseTranscriptionResponse({
      text: 'Hi there.',
      segments: [{ start: 0, end: 1, text: ' Hi there.', words: [{ word: ' Hi', start: 0, end: 0.4 }, { word: 'there.', start: 0.5, end: 0.9 }] }],
    });
    expect(r.segments[0].words).toEqual([{ startMs: 0, endMs: 400, text: ' Hi' }, { startMs: 500, endMs: 900, text: ' there.' }]);
  });

  it('gives each segment the words inside it when the server only lists words at the top level', () => {
    const r = parseTranscriptionResponse({
      text: 'One. Two.',
      segments: [{ start: 0, end: 1, text: 'One.' }, { start: 1, end: 2, text: 'Two.' }],
      words: [{ word: 'One.', start: 0.1, end: 0.6 }, { word: 'Two.', start: 1.1, end: 1.6 }],
    });
    expect(r.segments.map((s) => s.words?.map((w) => w.text))).toEqual([[' One.'], [' Two.']]);
  });

  it('skips malformed words, and has no words at all when none were requested', () => {
    expect(parseTranscriptionResponse({ text: 'x', segments: [{ start: 0, end: 1, text: 'x', words: [{ word: '', start: 0, end: 1 }, { word: 'y' }, null] }] }).segments[0].words).toBeUndefined();
    expect(parseTranscriptionResponse({ text: 'x', segments: [{ start: 0, end: 1, text: 'x' }] }).segments[0]).not.toHaveProperty('words');
  });

  it('keeps the first segment’s words when a loop is folded', () => {
    const w = [{ startMs: 0, endMs: 100, text: ' So.' }];
    const { segments } = collapseRepeatedSegments(Array.from({ length: 5 }, (_, i) => ({ startMs: i * 1000, endMs: i * 1000 + 900, text: 'So.', words: w })));
    expect(segments).toHaveLength(1);
    expect(segments[0].words).toBe(w);
  });
});

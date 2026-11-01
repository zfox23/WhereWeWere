import { describe, expect, it } from 'vitest';
import {
  defaultSpeakerName, labelSpeakers, restoreOriginalSegments, type SpeakerSegment, type TimedWord, type Turn,
} from '../services/speakers';

/** Words spoken back to back, 400 ms each, starting at `startMs`. */
function words(startMs: number, ...texts: string[]): TimedWord[] {
  return texts.map((t, i) => ({ startMs: startMs + i * 400, endMs: startMs + i * 400 + 380, text: ` ${t}` }));
}
function segment(startMs: number, ...texts: string[]): SpeakerSegment {
  const w = words(startMs, ...texts);
  return { startMs, endMs: w[w.length - 1].endMs, text: texts.join(' '), words: w };
}
const turn = (start: number, end: number, speaker: string): Turn => ({ start, end, speaker });

describe('labelSpeakers: whole segments', () => {
  const segs: SpeakerSegment[] = [
    { startMs: 0, endMs: 4000, text: 'Hello there.' },
    { startMs: 4500, endMs: 9000, text: 'Hi, how are you?' },
    { startMs: 9500, endMs: 12000, text: 'Fine thanks.' },
  ];
  const turns = [turn(0, 4.2, 'SPEAKER_01'), turn(4.2, 9.2, 'SPEAKER_00'), turn(9.2, 12, 'SPEAKER_01')];

  it('gives each segment the speaker covering it, numbering speakers in the order they first speak', () => {
    const out = labelSpeakers(segs, turns, { split: false });
    expect(out.segments.map((s) => s.speaker)).toEqual(['S1', 'S2', 'S1']); // SPEAKER_01 spoke first, so it is S1
    expect(out.speakers).toEqual(['S1', 'S2']);
  });

  it('picks the speaker who talks most during a segment', () => {
    const out = labelSpeakers([{ startMs: 0, endMs: 10_000, text: 'long one' }], [turn(0, 2, 'A'), turn(2, 10, 'B')], { split: false });
    expect(out.segments[0].speaker).toBe('S2');
  });

  it('does not modify its input', () => {
    const before = JSON.stringify(segs);
    labelSpeakers(segs, turns, { split: true });
    expect(JSON.stringify(segs)).toBe(before);
  });

  it('records the original segment index in src', () => {
    expect(labelSpeakers(segs, turns, { split: false }).segments.map((s) => s.src)).toEqual([0, 1, 2]);
    expect(labelSpeakers([{ ...segs[0], src: 7 }], turns, { split: false }).segments[0].src).toBe(7);
  });

  it('copes with unsorted turns, zero-length turns and overlapping turns', () => {
    const out = labelSpeakers(segs, [turn(9.2, 12, 'X'), turn(5, 5, 'GHOST'), turn(0, 9.2, 'Y')], { split: false });
    expect(out.segments.map((s) => s.speaker)).toEqual(['S1', 'S1', 'S2']); // Y starts first, so Y is S1; GHOST is dropped
    expect(out.speakers).toEqual(['S1', 'S2']);
  });
});

describe('labelSpeakers: splitting at a change of speaker', () => {
  it('splits one transcriber segment into a segment per speaker, with exact times and text', () => {
    const seg = segment(0, 'How', 'are', 'you?', 'Good,', 'thanks.'); // 5 words, 0-2000 ms
    const out = labelSpeakers([seg], [turn(0, 1.2, 'A'), turn(1.2, 2.5, 'B')], { split: true });
    expect(out.segments.map((s) => [s.speaker, s.text])).toEqual([['S1', 'How are you?'], ['S2', 'Good, thanks.']]);
    expect(out.segments[0]).toMatchObject({ startMs: 0, endMs: 1180 });
    expect(out.segments[1]).toMatchObject({ startMs: 1200, endMs: 1980 });
    expect(out.segments.every((s) => s.src === 0)).toBe(true); // both came from segment 0
    expect(out.segments[1].words).toHaveLength(2);
  });

  it('keeps a segment whole, text untouched, when one person speaks all of it', () => {
    const seg = { ...segment(0, 'All', 'one', 'voice'), text: 'All one voice.' };
    const out = labelSpeakers([seg], [turn(0, 5, 'A')], { split: true });
    expect(out.segments).toHaveLength(1);
    expect(out.segments[0].text).toBe('All one voice.');
  });

  it('ignores a single word that disagrees with both neighbours (timing jitter at a boundary)', () => {
    const seg = segment(0, 'one', 'two', 'three', 'four', 'five');
    // B is credited with only the middle word.
    const out = labelSpeakers([seg], [turn(0, 0.8, 'A'), turn(0.8, 1.2, 'B'), turn(1.2, 3, 'A')], { split: true });
    expect(out.segments).toHaveLength(1);
    expect(out.speakers).toEqual(['S1']);
  });

  it('keeps a real interjection of more than one word', () => {
    const seg = segment(0, 'one', 'two', 'three', 'four', 'five', 'six');
    const out = labelSpeakers([seg], [turn(0, 0.8, 'A'), turn(0.8, 1.6, 'B'), turn(1.6, 3, 'A')], { split: true });
    expect(out.segments.map((s) => [s.speaker, s.text])).toEqual([['S1', 'one two'], ['S2', 'three four'], ['S1', 'five six']]);
  });

  it('does not split when asked not to (the user has corrected the text), but still names a speaker', () => {
    const seg = segment(0, 'How', 'are', 'you?', 'Good,', 'thanks.');
    const out = labelSpeakers([seg], [turn(0, 0.6, 'A'), turn(0.6, 2.5, 'B')], { split: false });
    expect(out.segments).toHaveLength(1);
    expect(out.segments[0].text).toBe('How are you? Good, thanks.');
    expect(out.segments[0].speaker).toBe('S2'); // B speaks about 1.4 s of the 2 s, A 0.6 s
  });

  it('a segment without word timings is never split', () => {
    const out = labelSpeakers([{ startMs: 0, endMs: 2000, text: 'no words here' }], [turn(0, 1, 'A'), turn(1, 2, 'B')], { split: true });
    expect(out.segments).toHaveLength(1);
  });
});

describe('labelSpeakers: gaps, silence and missing diarization', () => {
  it('puts a word that falls just outside every turn with the nearest speaker, and a far-off one with the previous speaker', () => {
    const seg = segment(0, 'a', 'b'); // midpoints 190 and 590 ms
    const near = labelSpeakers([seg], [turn(0.9, 3, 'A')], { split: true });
    expect(near.segments[0].speaker).toBe('S1'); // 0.3-0.7 s before the turn: within 1.5 s

    const far = labelSpeakers([segment(10_000, 'x', 'y')], [turn(0, 1, 'A')], { split: true });
    expect(far.segments[0].speaker).toBeNull(); // 9 s from any turn and nothing before it
  });

  it('a segment in a gap inherits the speaker before it', () => {
    const out = labelSpeakers(
      [{ startMs: 0, endMs: 2000, text: 'first' }, { startMs: 20_000, endMs: 21_000, text: 'later, in a gap' }],
      [turn(0, 2, 'A')],
      { split: false },
    );
    expect(out.segments.map((s) => s.speaker)).toEqual(['S1', 'S1']);
  });

  it('with no turns at all, nothing gets a speaker', () => {
    const out = labelSpeakers([{ startMs: 0, endMs: 1000, text: 'hello' }], [], { split: true });
    expect(out.segments[0].speaker).toBeNull();
    expect(out.speakers).toEqual([]);
  });

  it('only counts speakers who ended up on a segment', () => {
    const out = labelSpeakers([{ startMs: 0, endMs: 1000, text: 'hello' }], [turn(0, 1, 'A'), turn(500, 800, 'B'), turn(60, 90, 'C')], { split: false });
    expect(out.speakers).toEqual(['S1']);
  });
});

describe('restoreOriginalSegments', () => {
  it('puts the pieces of a split segment back together and leaves others alone', () => {
    const a = segment(0, 'How', 'are', 'you?', 'Good,', 'thanks.');
    const b = segment(5000, 'Next', 'one.');
    const labeled = labelSpeakers([a, b], [turn(0, 1.2, 'X'), turn(1.2, 2.5, 'Y'), turn(4.9, 6, 'X')], { split: true }).segments;
    expect(labeled).toHaveLength(3);
    const restored = restoreOriginalSegments(labeled);
    expect(restored).toHaveLength(2);
    expect(restored[0]).toMatchObject({ startMs: 0, endMs: a.endMs, text: 'How are you? Good, thanks.', speaker: null, src: 0 });
    expect(restored[0].words).toHaveLength(5);
    expect(restored[1].text).toBe('Next one.');
  });

  it('is the inverse of splitting: re-running with different turns gives a different split', () => {
    const a = segment(0, 'one', 'two', 'three', 'four');
    const first = labelSpeakers([a], [turn(0, 0.8, 'A'), turn(0.8, 3, 'B')], { split: true }).segments;
    const again = labelSpeakers(restoreOriginalSegments(first), [turn(0, 1.2, 'A'), turn(1.2, 3, 'B')], { split: true }).segments;
    expect(first.map((s) => s.text)).toEqual(['one two', 'three four']);
    expect(again.map((s) => s.text)).toEqual(['one two three', 'four']);
  });

  it('joins text when there are no word timings, and leaves segments without a src separate', () => {
    expect(restoreOriginalSegments([
      { startMs: 0, endMs: 1, text: 'a', src: 3, speaker: 'S1' },
      { startMs: 1, endMs: 2, text: 'b', src: 3, speaker: 'S2' },
    ])).toEqual([{ startMs: 0, endMs: 2, text: 'a b', src: 3, speaker: null, words: undefined }]);
    expect(restoreOriginalSegments([{ startMs: 0, endMs: 1, text: 'a' }, { startMs: 1, endMs: 2, text: 'b' }])).toHaveLength(2);
  });
});

describe('defaultSpeakerName', () => {
  it('names speakers by number', () => {
    expect(defaultSpeakerName('S1')).toBe('Speaker 1');
    expect(defaultSpeakerName('S12')).toBe('Speaker 12');
    expect(defaultSpeakerName('weird')).toBe('weird');
  });
});

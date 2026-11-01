/**
 * Notes plugin — putting speakers on a transcript (pure; the worker feeds it).
 *
 * The transcriber returns text with timings; the diarization service returns who
 * was speaking when ("turns"). This lines the two up: every segment (or, where
 * word timings exist, every word) goes to the speaker whose turn covers it, and
 * a segment that straddles a change of speaker is split there.
 *
 * Speakers are named S1, S2, ... in the order they first speak. The user can
 * rename them per audio file ("S1" -> "Dad"); the default display name is "Speaker 1".
 */

export interface Turn {
  /** Seconds, as the diarization service reports them. */
  start: number;
  end: number;
  /** The service's own label, e.g. "SPEAKER_00". */
  speaker: string;
}

export interface TimedWord {
  startMs: number;
  endMs: number;
  /** Includes its leading space, as the transcriber writes it. */
  text: string;
}

export interface SpeakerSegment {
  startMs: number;
  endMs: number;
  text: string;
  words?: TimedWord[];
  speaker?: string | null;
  /** Index of the transcriber segment this came from (shared by the pieces of a split segment). */
  src?: number;
  /** The user corrected this text. */
  edited?: boolean;
}

export interface LabeledTranscript {
  segments: SpeakerSegment[];
  /** Speaker ids in order of first appearance: ['S1', 'S2', ...]. */
  speakers: string[];
}

/** A word whose midpoint falls this far (ms) outside every turn still goes to the nearest one; further than this it inherits. */
const NEAREST_TURN_MS = 1500;

/** One isolated word assigned to a different speaker than both neighbours is almost always timing jitter at a boundary. */
function absorbJitter(groups: { speaker: string | null; words: TimedWord[] }[]): { speaker: string | null; words: TimedWord[] }[] {
  const out = groups.map((g) => ({ speaker: g.speaker, words: [...g.words] }));
  for (let i = 1; i < out.length - 1; ) {
    if (out[i].words.length === 1 && out[i - 1].speaker === out[i + 1].speaker && out[i].speaker !== out[i - 1].speaker) {
      out[i - 1].words.push(...out[i].words, ...out[i + 1].words);
      out.splice(i, 2);
    } else {
      i += 1;
    }
  }
  return out;
}

interface MsTurn {
  startMs: number;
  endMs: number;
  id: string;
}

function toMsTurns(turns: Turn[]): { ms: MsTurn[]; ids: string[] } {
  const ids: string[] = [];
  const byLabel = new Map<string, string>();
  const ordered = [...turns].filter((t) => t.end > t.start).sort((a, b) => a.start - b.start || a.end - b.end);
  const ms = ordered.map((t) => {
    let id = byLabel.get(t.speaker);
    if (!id) {
      id = `S${byLabel.size + 1}`;
      byLabel.set(t.speaker, id);
      ids.push(id);
    }
    return { startMs: Math.round(t.start * 1000), endMs: Math.round(t.end * 1000), id };
  });
  return { ms, ids };
}

/** The speaker with the most overlap with [startMs, endMs]; null when no turn overlaps it. */
function speakerByOverlap(turns: MsTurn[], startMs: number, endMs: number): string | null {
  const totals = new Map<string, number>();
  for (const t of turns) {
    const overlap = Math.min(t.endMs, endMs) - Math.max(t.startMs, startMs);
    if (overlap > 0) totals.set(t.id, (totals.get(t.id) ?? 0) + overlap);
  }
  let best: string | null = null;
  let bestMs = 0;
  for (const [id, ms] of totals) {
    if (ms > bestMs) {
      best = id;
      bestMs = ms;
    }
  }
  return best;
}

/** Speaker for a point in time: the turn containing it, else the nearest turn within NEAREST_TURN_MS, else null. */
function speakerAt(turns: MsTurn[], ms: number): string | null {
  let nearest: MsTurn | null = null;
  let nearestGap = Infinity;
  for (const t of turns) {
    if (ms >= t.startMs && ms < t.endMs) return t.id;
    const gap = ms < t.startMs ? t.startMs - ms : ms - t.endMs;
    if (gap < nearestGap) {
      nearest = t;
      nearestGap = gap;
    }
  }
  return nearest && nearestGap <= NEAREST_TURN_MS ? nearest.id : null;
}

/**
 * Give every segment a speaker. With `split` (and word timings) a segment that
 * spans a change of speaker becomes one segment per speaker turn; without it, or
 * without words, each segment goes whole to the speaker who talks most during it
 * (the right mode when the user has corrected the text, which splitting would lose).
 * Input segments are not modified.
 */
export function labelSpeakers(segments: SpeakerSegment[], turns: Turn[], opts: { split: boolean }): LabeledTranscript {
  const { ms, ids } = toMsTurns(turns);
  const out: SpeakerSegment[] = [];
  let previous: string | null = null;

  segments.forEach((seg, index) => {
    const src = seg.src ?? index;
    const whole = (speaker: string | null): SpeakerSegment => ({ ...seg, speaker, src });

    if (opts.split && seg.words && seg.words.length > 1) {
      const groups: { speaker: string | null; words: TimedWord[] }[] = [];
      let last: string | null = previous;
      for (const w of seg.words) {
        const sp = speakerAt(ms, Math.round((w.startMs + w.endMs) / 2)) ?? last;
        const tail = groups[groups.length - 1];
        if (tail && tail.speaker === sp) tail.words.push(w);
        else groups.push({ speaker: sp, words: [w] });
        last = sp;
      }
      const merged = absorbJitter(groups);
      if (merged.length > 1) {
        for (const g of merged) {
          out.push({
            startMs: g.words[0].startMs,
            endMs: g.words[g.words.length - 1].endMs,
            text: g.words.map((w) => w.text).join('').trim(),
            words: g.words,
            speaker: g.speaker,
            src,
          });
        }
        previous = merged[merged.length - 1].speaker ?? previous;
        return;
      }
      const only = merged[0].speaker;
      out.push(whole(only ?? previous));
      previous = only ?? previous;
      return;
    }

    const sp = speakerByOverlap(ms, seg.startMs, seg.endMs) ?? speakerAt(ms, Math.round((seg.startMs + seg.endMs) / 2)) ?? previous;
    out.push(whole(sp));
    previous = sp ?? previous;
  });

  // Only speakers that ended up on a segment count (a turn may fall entirely in silence the transcript skipped).
  const used = new Set(out.map((s) => s.speaker).filter((s): s is string => Boolean(s)));
  return { segments: out, speakers: ids.filter((id) => used.has(id)) };
}

/**
 * Put segments that were split at a speaker change back together (grouped by `src`), so
 * diarization can be run again with different settings. Each rebuilt segment spans its
 * pieces and its text is the pieces' words, or their text joined when there are no words.
 */
export function restoreOriginalSegments(segments: SpeakerSegment[]): SpeakerSegment[] {
  const out: SpeakerSegment[] = [];
  for (const seg of segments) {
    const tail = out[out.length - 1];
    if (tail && seg.src !== undefined && tail.src === seg.src) {
      tail.endMs = Math.max(tail.endMs, seg.endMs);
      tail.words = tail.words && seg.words ? [...tail.words, ...seg.words] : undefined;
      tail.text = tail.words ? tail.words.map((w) => w.text).join('').trim() : `${tail.text} ${seg.text}`.trim();
    } else {
      out.push({ ...seg, speaker: null });
    }
  }
  return out;
}

/** "S3" -> "Speaker 3". */
export function defaultSpeakerName(id: string): string {
  const n = /^S(\d+)$/.exec(id)?.[1];
  return n ? `Speaker ${n}` : id;
}

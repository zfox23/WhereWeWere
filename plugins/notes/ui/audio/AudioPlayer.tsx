/**
 * Playback of one audio attachment on the note detail page, with its
 * transcript: timestamped segments you can click to jump to, the current
 * one highlighted while it plays, text you can correct, and a way to
 * transcribe again.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Loader2, Pencil, RefreshCw, Save, X } from 'lucide-react';
import { notes, type NoteAudioWithTranscript, type TranscriptSegment } from '../api';
import { formatDuration } from './AudioSection';

export const SPEEDS = [0.75, 1, 1.25, 1.5, 2];

/** Index of the segment playing at `ms`, or -1 in a gap / before the first. */
export function activeSegmentIndex(segments: Pick<TranscriptSegment, 'start_ms' | 'end_ms'>[], ms: number): number {
  let found = -1;
  for (let i = 0; i < segments.length; i++) {
    if (segments[i].start_ms <= ms) found = i;
    else break;
  }
  // Stay on the last started segment through short gaps, but not long after the audio moved on.
  if (found >= 0 && ms > segments[found].end_ms + 2000) return -1;
  return found;
}

const STATUS: Record<NoteAudioWithTranscript['status'], string> = {
  uploading: 'Uploading…',
  pending: 'Waiting to be transcribed',
  processing: 'Transcribing…',
  done: '',
  failed: 'Transcription failed',
};

const iconBtn = 'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50';

export function AudioPlayer({ audio, onChanged }: { audio: NoteAudioWithTranscript; onChanged: () => void }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [now, setNow] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [editing, setEditing] = useState(false);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeRef = useRef<HTMLButtonElement | null>(null);

  const segments = audio.segments;
  const active = useMemo(() => activeSegmentIndex(segments, now), [segments, now]);

  useEffect(() => {
    if (ref.current) ref.current.playbackRate = speed;
  }, [speed]);

  // Keep the spoken line in view while it plays (not while editing).
  useEffect(() => {
    if (!editing) activeRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [active, editing]);

  const seek = (ms: number) => {
    const el = ref.current;
    if (!el) return;
    el.currentTime = ms / 1000;
    void el.play().catch(() => {});
  };

  const beginEdit = () => {
    setDrafts(Object.fromEntries(segments.map((s) => [s.idx, s.text])));
    setEditing(true);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await notes.saveTranscript(audio.id, segments.map((s) => ({ idx: s.idx, text: drafts[s.idx] ?? s.text })));
      setEditing(false);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the transcript.');
    } finally {
      setBusy(false);
    }
  };

  const retranscribe = async () => {
    const hasEdits = segments.some((s) => s.edited);
    if (hasEdits && !window.confirm('Transcribing again replaces the transcript, including your corrections. Continue?')) return;
    setBusy(true);
    setError(null);
    try {
      await notes.retranscribe(audio.id);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not queue the transcription.');
    } finally {
      setBusy(false);
    }
  };

  const status = STATUS[audio.status];
  const waiting = audio.status === 'processing' || audio.status === 'uploading' || (audio.status === 'pending' && !audio.error);

  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-700 p-3 space-y-2" aria-label={`Audio: ${audio.filename}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
        <span className="font-medium text-gray-700 dark:text-gray-200 truncate max-w-[16rem]">{audio.filename}</span>
        {audio.duration_ms ? <span>{formatDuration(audio.duration_ms)}</span> : null}
        {audio.language ? <span>{audio.language}</span> : null}
        <label className="ml-auto inline-flex items-center gap-1.5">
          Speed
          <select
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
            aria-label="Playback speed"
            className="rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-1.5 py-0.5 text-xs"
          >
            {SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}
          </select>
        </label>
      </div>

      <audio
        ref={ref}
        controls
        preload="metadata"
        src={notes.audioUrl(audio.id)}
        className="w-full"
        onTimeUpdate={(e) => setNow(Math.round(e.currentTarget.currentTime * 1000))}
        onRateChange={(e) => setSpeed(e.currentTarget.playbackRate)}
      />

      {status && (
        <p className={`flex items-center gap-1.5 text-xs ${audio.status === 'failed' ? 'text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-gray-400'}`}>
          {waiting ? <Loader2 size={12} className="animate-spin" /> : <AlertCircle size={12} />}
          {status}{audio.error && (audio.status === 'failed' || audio.status === 'pending') ? ` — ${audio.status === 'pending' ? 'last attempt failed: ' : ''}${audio.error}` : ''}
        </p>
      )}

      {segments.length > 0 && (
        <ol className="max-h-72 overflow-y-auto rounded-lg bg-gray-50 dark:bg-gray-800/50 p-2 space-y-0.5" aria-label="Transcript">
          {segments.map((s, i) => (
            <li key={s.idx}>
              {editing ? (
                <div className="flex items-start gap-2">
                  <span className="mt-1.5 w-10 shrink-0 text-right text-[11px] tabular-nums text-gray-400">{formatDuration(s.start_ms)}</span>
                  <textarea
                    value={drafts[s.idx] ?? ''}
                    onChange={(e) => setDrafts((d) => ({ ...d, [s.idx]: e.target.value }))}
                    aria-label={`Transcript at ${formatDuration(s.start_ms)}`}
                    rows={Math.max(1, Math.ceil((drafts[s.idx]?.length ?? 0) / 70))}
                    className="input flex-1 text-sm"
                  />
                </div>
              ) : (
                <button
                  type="button"
                  ref={i === active ? activeRef : undefined}
                  onClick={() => seek(s.start_ms)}
                  aria-current={i === active ? 'true' : undefined}
                  className={`flex w-full items-start gap-2 rounded-md px-1.5 py-1 text-left text-sm transition-colors ${
                    i === active ? 'bg-amber-100 dark:bg-amber-900/30 text-gray-900 dark:text-gray-50' : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800'
                  }`}
                >
                  <span className="w-10 shrink-0 text-right text-[11px] tabular-nums text-gray-400 mt-0.5">{formatDuration(s.start_ms)}</span>
                  <span className="flex-1">{s.text}{s.edited ? <span className="ml-1 text-[10px] text-gray-400" title="Corrected by you">✎</span> : null}</span>
                </button>
              )}
            </li>
          ))}
        </ol>
      )}

      {error && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{error}</p>}

      <div className="flex flex-wrap items-center gap-1">
        {editing ? (
          <>
            <button type="button" onClick={() => void save()} disabled={busy} className={iconBtn}><Save size={12} /> Save transcript</button>
            <button type="button" onClick={() => setEditing(false)} disabled={busy} className={iconBtn}><X size={12} /> Cancel</button>
          </>
        ) : (
          <>
            {segments.length > 0 && audio.status === 'done' && (
              <button type="button" onClick={beginEdit} className={iconBtn}><Pencil size={12} /> Edit transcript</button>
            )}
            {(audio.status === 'done' || audio.status === 'failed' || audio.status === 'pending') && (
              <button type="button" onClick={() => void retranscribe()} disabled={busy} className={iconBtn}>
                <RefreshCw size={12} /> {audio.status === 'done' ? 'Transcribe again' : audio.status === 'failed' ? 'Retry' : 'Transcribe now'}
              </button>
            )}
          </>
        )}
      </div>
    </section>
  );
}

/** A note's audio files with their transcripts; refreshes while any are still being processed. */
export function NoteAudioList({ noteId }: { noteId: string }) {
  const [audio, setAudio] = useState<NoteAudioWithTranscript[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useMemo(() => () => notes.audioWithTranscripts(noteId).then((rows) => {
    setAudio(rows);
    setLoaded(true);
  }).catch(() => setLoaded(true)), [noteId]);

  useEffect(() => {
    void load();
  }, [load]);

  const anyWaiting = audio.some((a) => a.status === 'pending' || a.status === 'processing');
  useEffect(() => {
    if (!anyWaiting) return;
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [anyWaiting, load]);

  if (!loaded || audio.length === 0) return null;
  return (
    <div className="space-y-3">
      {audio.map((a) => <AudioPlayer key={a.id} audio={a} onChanged={() => void load()} />)}
    </div>
  );
}

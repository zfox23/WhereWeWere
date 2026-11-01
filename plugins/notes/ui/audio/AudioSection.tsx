/**
 * The audio part of the note form: record from a chosen microphone, attach an
 * existing file, and see every recording's save/upload state.
 *
 * Nothing here can lose audio: chunks are stored on the device as they are
 * recorded, uploads resume and retry on their own, and anything left over
 * from a crash or a closed tab is offered back under "Unsent recordings".
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, CloudUpload, Download, FileAudio, Loader2, Mic, Pause, Play, Square, Trash2, Plus } from 'lucide-react';
import { notes, type NoteAudio } from '../api';
import { micErrorMessage, useAudioInputs } from './audioInput';
import { AUDIO_FILE_ACCEPT, importAudioFile } from './importFile';
import { NoteRecorder, browserDeps, type RecorderState } from './recorder';
import {
  assembleBlob, deleteRecording, isOrphaned, listRecordings, onRecordingsChanged, recoverRecording, type RecordingMeta,
} from './recordingStore';
import { processUploads } from './uploadQueue';

export function formatDuration(ms: number): string {
  const total = Math.max(Math.floor(ms / 1000), 0);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(Math.round(bytes / 1024), 1)} KB`;
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** All of the user's recordings on this device, kept current. */
export function useLocalRecordings(userId: string): RecordingMeta[] {
  const [rows, setRows] = useState<RecordingMeta[]>([]);
  const refresh = useCallback(() => {
    listRecordings(userId).then(setRows).catch(() => {});
  }, [userId]);
  useEffect(() => {
    refresh();
    const off = onRecordingsChanged(refresh);
    // Counters of an in-progress upload change without a notification.
    const timer = setInterval(refresh, 3000);
    return () => {
      off();
      clearInterval(timer);
    };
  }, [refresh]);
  return rows;
}

const labelClass = 'block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5';
const smallBtn = 'inline-flex items-center gap-1.5 rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50';

function StatusChip({ meta }: { meta: RecordingMeta }) {
  if (meta.state === 'recording') return <span className="text-amber-600">Recording…</span>;
  if (meta.state === 'uploaded') return <span className="inline-flex items-center gap-1 text-green-600"><CheckCircle2 size={12} /> Uploaded</span>;
  if (meta.state === 'uploading') return <span className="inline-flex items-center gap-1 text-primary-600"><CloudUpload size={12} /> Uploading…</span>;
  if (meta.attempts > 0 && meta.error) {
    return <span className="inline-flex items-center gap-1 text-red-600" title={meta.error}><AlertCircle size={12} /> Will retry — saved on this device</span>;
  }
  return <span className="text-gray-500">Saved on this device, waiting to upload</span>;
}

function LocalRow({ meta, onRemove }: { meta: RecordingMeta; onRemove: () => void }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-gray-200 dark:border-gray-700 px-3 py-2 text-sm">
      <FileAudio size={16} className="shrink-0 text-rose-500" />
      <span className="min-w-0 flex-1 truncate text-gray-800 dark:text-gray-100">{meta.filename}</span>
      <span className="text-xs text-gray-500">{meta.durationMs ? `${formatDuration(meta.durationMs)} · ` : ''}{formatSize(meta.bytes)}</span>
      <span className="text-xs"><StatusChip meta={meta} /></span>
      <button type="button" onClick={onRemove} aria-label={`Remove ${meta.filename}`} className="text-gray-400 hover:text-red-600">
        <Trash2 size={14} />
      </button>
    </li>
  );
}

function ServerRow({ audio, onRemove }: { audio: NoteAudio; onRemove: () => void }) {
  const state = {
    uploading: 'Uploading…', pending: 'Waiting to be transcribed', processing: 'Transcribing…', done: 'Transcribed', failed: 'Transcription failed',
  }[audio.status];
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-gray-200 dark:border-gray-700 px-3 py-2 text-sm">
      <FileAudio size={16} className="shrink-0 text-rose-500" />
      <span className="min-w-0 flex-1 truncate text-gray-800 dark:text-gray-100">{audio.filename}</span>
      <span className="text-xs text-gray-500">{audio.duration_ms ? `${formatDuration(audio.duration_ms)} · ` : ''}{formatSize(Number(audio.bytes))}</span>
      <span className="text-xs text-gray-500">{state}</span>
      <button type="button" onClick={onRemove} aria-label={`Delete ${audio.filename}`} className="text-gray-400 hover:text-red-600">
        <Trash2 size={14} />
      </button>
    </li>
  );
}

export interface AudioSectionProps {
  userId: string;
  editId: string | null;
  /** Ids of recordings (on this device) attached in this form. */
  localIds: string[];
  onLocalIdsChange: (ids: string[]) => void;
  /** How many audio files the note already has on the server (edit mode). */
  onServerCount: (count: number) => void;
  /** True while a recording is in progress (the form must not be saved over it). */
  onRecordingChange: (live: boolean) => void;
}

export function AudioSection({ userId, editId, localIds, onLocalIdsChange, onServerCount, onRecordingChange }: AudioSectionProps) {
  const inputs = useAudioInputs();
  const recordings = useLocalRecordings(userId);
  const [serverAudio, setServerAudio] = useState<NoteAudio[]>([]);
  const [state, setState] = useState<RecorderState>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const recorderRef = useRef<NoteRecorder | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const localIdsRef = useRef(localIds);
  localIdsRef.current = localIds;

  // Existing audio on the note being edited.
  useEffect(() => {
    if (!editId) return;
    let cancelled = false;
    const load = () => notes.audio(editId).then((rows) => {
      if (cancelled) return;
      setServerAudio(rows);
      onServerCount(rows.length);
    }).catch(() => {});
    void load();
    // Status moves from "waiting" to "transcribed" on its own.
    const timer = setInterval(() => void load(), 10_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [editId, onServerCount]);

  // Leftovers from a crash / closed tab become ordinary unsent recordings.
  useEffect(() => {
    (async () => {
      let recovered = 0;
      for (const meta of await listRecordings(userId)) {
        if (isOrphaned(meta) && (await recoverRecording(meta.id))) recovered += 1;
      }
      if (recovered > 0) {
        setNotice(`Recovered ${recovered === 1 ? 'a recording' : `${recovered} recordings`} that was interrupted. ${recovered === 1 ? 'It is' : 'They are'} listed below.`);
        void processUploads(userId);
      }
    })().catch(() => {});
  }, [userId]);

  useEffect(() => {
    onRecordingChange(state === 'recording' || state === 'paused' || state === 'stopping');
  }, [state, onRecordingChange]);

  // Never close the tab on a live recording without a warning.
  useEffect(() => {
    if (state !== 'recording' && state !== 'paused') return;
    const guard = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [state]);

  // Leaving the page finishes the recording (it's saved and uploaded in the background).
  useEffect(() => () => {
    void recorderRef.current?.stop();
  }, []);

  const add = (id: string) => {
    if (!localIdsRef.current.includes(id)) onLocalIdsChange([...localIdsRef.current, id]);
  };

  const start = async () => {
    setError(null);
    setNotice(null);
    setWarning(null);
    const device = inputs.devices.find((d) => d.deviceId === inputs.selectedId);
    const recorder = new NoteRecorder(
      { userId, deviceId: inputs.selectedId, deviceLabel: device?.label || null },
      {
        onState: setState,
        onTick: setElapsed,
        onLevel: setLevel,
        onWarning: setWarning,
        onInterrupted: (reason, meta) => {
          if (meta) add(meta.id);
          setError(`${reason} What was recorded so far is saved. Press Record to continue in a new recording.`);
          void processUploads(userId);
        },
      },
      browserDeps(),
    );
    recorderRef.current = recorder;
    try {
      const meta = await recorder.start();
      add(meta.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : micErrorMessage(err));
    }
  };

  const stop = async () => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    const { meta, unsaved } = await recorder.stop();
    if (unsaved) {
      download(unsaved, 'recording-unsaved.webm');
      setError('This device could not store the recording, so it was downloaded instead. Keep that file.');
    }
    if (meta) void processUploads(userId);
    // The browser only reveals microphone names after the first permission grant.
    void inputs.refresh();
  };

  const pickFiles = async (files: FileList | null) => {
    if (!files) return;
    setError(null);
    for (const file of Array.from(files)) {
      try {
        const meta = await importAudioFile(userId, file);
        add(meta.id);
        void processUploads(userId);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not add the file.');
      }
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  const removeLocal = async (meta: RecordingMeta) => {
    if (meta.state !== 'uploaded' && !window.confirm('Delete this recording? The audio has not been saved anywhere else.')) return;
    if (meta.serverId) await notes.removeAudio(meta.serverId).catch(() => {});
    await deleteRecording(meta.id);
    onLocalIdsChange(localIdsRef.current.filter((id) => id !== meta.id));
  };

  const removeServer = async (audio: NoteAudio) => {
    if (!window.confirm('Delete this audio file and its transcript from the note?')) return;
    try {
      await notes.removeAudio(audio.id);
      setServerAudio((rows) => {
        const next = rows.filter((r) => r.id !== audio.id);
        onServerCount(next.length);
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the audio.');
    }
  };

  const inForm = recordings.filter((r) => localIds.includes(r.id));
  const leftovers = recordings.filter((r) => !localIds.includes(r.id) && !isOrphaned(r) && !(r.state === 'uploaded' && r.noteId));
  const live = state === 'recording' || state === 'paused';

  return (
    <div className="space-y-3">
      <span className={labelClass}>Audio</span>

      <div className="rounded-2xl border border-gray-200 dark:border-gray-700 p-3 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[12rem] flex-1">
            <label htmlFor="audio-input" className={labelClass}>Microphone</label>
            <select
              id="audio-input"
              value={inputs.selectedId}
              onChange={(e) => inputs.select(e.target.value)}
              disabled={live}
              className="input"
            >
              <option value="">System default</option>
              {inputs.devices.map((d, i) => (
                <option key={d.deviceId || i} value={d.deviceId}>{d.label || `Microphone ${i + 1}`}</option>
              ))}
            </select>
          </div>
          {inputs.needsPermission && !live && (
            <button type="button" onClick={() => void inputs.requestAccess()} className={smallBtn}>Show microphone names</button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!live ? (
            <button type="button" onClick={() => void start()} disabled={state === 'starting' || state === 'stopping'} className="btn-primary inline-flex items-center gap-2 text-sm">
              {state === 'starting' ? <Loader2 size={16} className="animate-spin" /> : <Mic size={16} />} Record
            </button>
          ) : (
            <>
              {state === 'recording' ? (
                <button type="button" onClick={() => recorderRef.current?.pause()} className={smallBtn}><Pause size={14} /> Pause</button>
              ) : (
                <button type="button" onClick={() => recorderRef.current?.resume()} className={smallBtn}><Play size={14} /> Resume</button>
              )}
              <button type="button" onClick={() => void stop()} className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700">
                <Square size={14} /> Stop
              </button>
              <span className="inline-flex items-center gap-2 text-sm tabular-nums text-gray-700 dark:text-gray-200" aria-live="off">
                <span className={`h-2.5 w-2.5 rounded-full ${state === 'recording' ? 'animate-pulse bg-red-500' : 'bg-amber-400'}`} />
                {formatDuration(elapsed)}{state === 'paused' ? ' (paused)' : ''}
              </span>
              <div className="h-2 w-32 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700" role="meter" aria-label="Input level" aria-valuemin={0} aria-valuemax={1} aria-valuenow={level}>
                <div className="h-full bg-green-500 transition-[width] duration-75" style={{ width: `${Math.round(level * 100)}%` }} />
              </div>
            </>
          )}
          {!live && (
            <>
              <button type="button" onClick={() => fileRef.current?.click()} className={smallBtn}><Plus size={14} /> Add audio file</button>
              <input ref={fileRef} type="file" accept={AUDIO_FILE_ACCEPT} multiple hidden onChange={(e) => void pickFiles(e.target.files)} />
            </>
          )}
        </div>
        {live && <p className="text-xs text-gray-500">Saved to this device every second as you record, so a crash or closed tab won't lose it.</p>}
        {inputs.error && <p className="text-sm text-red-600 dark:text-red-400">{inputs.error}</p>}
        {warning && <p role="alert" className="text-sm text-amber-700 dark:text-amber-300">{warning}</p>}
        {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        {notice && <p role="status" className="text-sm text-green-700 dark:text-green-400">{notice}</p>}
      </div>

      {(serverAudio.length > 0 || inForm.length > 0) && (
        <ul className="space-y-2" aria-label="Audio attached to this note">
          {serverAudio.map((a) => <ServerRow key={a.id} audio={a} onRemove={() => void removeServer(a)} />)}
          {inForm.map((r) => <LocalRow key={r.id} meta={r} onRemove={() => void removeLocal(r)} />)}
        </ul>
      )}

      {leftovers.length > 0 && (
        <div className="rounded-2xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-3 space-y-2">
          <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
            Unsent recordings ({leftovers.length}) — kept safe on this device
          </p>
          <ul className="space-y-2">
            {leftovers.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-800 dark:text-gray-100">
                <span className="min-w-0 flex-1 truncate">{r.filename}</span>
                <span className="text-xs text-gray-500">{new Date(r.startedAt).toLocaleString()} · {formatSize(r.bytes)}</span>
                <span className="text-xs"><StatusChip meta={r} /></span>
                <button type="button" className={smallBtn} onClick={() => add(r.id)}><Plus size={12} /> Add to this note</button>
                {r.state !== 'uploaded' && (
                  <button type="button" className={smallBtn} onClick={async () => download(await assembleBlob(r), r.filename)}><Download size={12} /> Save file</button>
                )}
                <button type="button" aria-label={`Discard ${r.filename}`} className="text-gray-400 hover:text-red-600" onClick={() => void removeLocal(r)}><Trash2 size={14} /></button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

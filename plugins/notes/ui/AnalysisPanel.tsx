/**
 * Profile > Notes: run the similarity analysis (the `notes-similarity`
 * background job) and follow its progress. The job only embeds new or
 * edited notes, then re-links and re-groups everything.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, Loader2, Sparkles, Square } from 'lucide-react';
import { jobs } from '../../../client/src/api/client';
import { plugins } from '../../../client/src/plugins/api';
import { notes, type AnalysisStatus } from './api';

const JOB_TYPE = 'notes-similarity';
const POLL_MS = 2000;

interface JobRow {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress?: { phase?: string; message?: string; updated?: number; remaining?: number };
  error?: string | null;
}

function ago(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function AnalysisPanel({ onFinished }: { onFinished: () => void }) {
  const [status, setStatus] = useState<AnalysisStatus | null>(null);
  const [job, setJob] = useState<JobRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finishedRef = useRef(onFinished);
  finishedRef.current = onFinished;

  const loadStatus = useCallback(async () => {
    try {
      const s = await notes.analysisStatus();
      setStatus(s);
      return s;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the analysis status');
      return null;
    }
  }, []);

  const poll = useCallback((id: string) => {
    if (timer.current) clearTimeout(timer.current);
    const tick = async () => {
      try {
        const row = (await jobs.get(id)) as JobRow;
        setJob(row);
        if (row.status === 'pending' || row.status === 'running') {
          timer.current = setTimeout(tick, POLL_MS);
          return;
        }
        if (row.status === 'failed') setError(row.error || 'The analysis failed.');
        await loadStatus();
        if (row.status === 'completed') finishedRef.current();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Lost track of the analysis');
      }
    };
    tick();
  }, [loadStatus]);

  // Pick up a run that's already going (e.g. started before a reload).
  useEffect(() => {
    loadStatus().then((s) => {
      if (s?.active_job_id) poll(s.active_job_id);
    });
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [loadStatus, poll]);

  const start = async () => {
    setError(null);
    try {
      const row = (await jobs.start(JOB_TYPE)) as JobRow;
      setJob(row);
      poll(row.id);
    } catch (err) {
      // Already running (409): follow that run instead.
      const s = await loadStatus();
      if (s?.active_job_id) poll(s.active_job_id);
      else setError(err instanceof Error ? err.message : 'Could not start the analysis');
    }
  };

  const toggleMood = async (include: boolean) => {
    setError(null);
    try {
      await plugins.settings.set('notes', { include_mood_entries: include });
      await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the setting');
    }
  };

  const cancel = async () => {
    if (!job) return;
    try {
      await jobs.cancel(job.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not cancel');
    }
  };

  const running = job != null && (job.status === 'pending' || job.status === 'running');
  const configured = status?.embeddings_configured ?? false;

  return (
    <section className="rounded-2xl border border-violet-200/70 dark:border-violet-800/50 bg-violet-50/60 dark:bg-violet-950/20 p-5">
      <div className="flex flex-wrap items-start gap-4">
        <Sparkles size={22} className="mt-0.5 shrink-0 text-violet-500" />
        <div className="min-w-0 flex-1 space-y-1">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">Similarity analysis</h3>
          <p className="text-xs text-gray-600 dark:text-gray-400">
            Finds notes that talk about the same things, groups them into themes your LLM names, and powers the
            Similarity Web, Related notes, and theme charts.
          </p>
          {status && (
            <p className="text-xs text-gray-600 dark:text-gray-300">
              {status.total === 0
                ? 'No notes yet.'
                : status.pending === 0
                  ? <>All {status.total.toLocaleString()} {status.include_mood_entries ? 'entries' : 'notes'} analyzed into {status.themes} themes.</>
                  : <><strong>{status.pending.toLocaleString()}</strong> of {status.total.toLocaleString()} {status.include_mood_entries ? 'entries' : 'notes'} not yet analyzed.</>}
              {status.last_run_at && <span className="text-gray-400"> Last run {ago(status.last_run_at)}.</span>}
            </p>
          )}
          {status && (
            <label className="flex items-start gap-2 pt-1 text-xs text-gray-700 dark:text-gray-200">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={status.include_mood_entries}
                disabled={running}
                onChange={(e) => toggleMood(e.target.checked)}
              />
              <span>
                Include mood check-ins that have text
                <span className="block text-gray-500 dark:text-gray-400">
                  They join the themes, the Similarity Web, and Related notes. Applied on the next analysis run.
                </span>
              </span>
            </label>
          )}
          {status && !configured && (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              Set up an embedding model in{' '}
              <Link to="/settings?tab=integrations" className="underline">Settings &gt; Integrations</Link> first.
            </p>
          )}
          {status && configured && !status.llm_configured && (
            <p className="text-xs text-gray-500">No LLM configured: themes will be named after their most common tags.</p>
          )}
          {running && (
            <p className="flex items-center gap-1.5 text-xs text-violet-700 dark:text-violet-300" aria-live="polite">
              <Loader2 size={13} className="animate-spin" />
              {job?.progress?.message || 'Starting…'}
            </p>
          )}
          {error && (
            <p className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400"><AlertCircle size={13} /> {error}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {running ? (
            <button type="button" onClick={cancel} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-200">
              <Square size={13} /> Cancel
            </button>
          ) : (
            <button
              type="button"
              onClick={start}
              disabled={!configured || !status || status.total === 0}
              className="btn-primary inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              <Sparkles size={15} />
              {status && status.analyzed > 0 ? 'Update analysis' : 'Analyze notes'}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

import { useState, useEffect } from 'react';
import { Cog, Clock, Loader2, AlertCircle, CheckCircle2, XCircle, Ban, Play, Send, StopCircle } from 'lucide-react';
import { jobs } from '../../api/client';
import type { Job } from '../../types';

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(date);
}

function JobStatusIcon({ status }: { status: Job['status'] }) {
  switch (status) {
    case 'pending':
      return <Clock size={16} className="text-gray-400" />;
    case 'running':
      return <Loader2 size={16} className="animate-spin text-blue-500" />;
    case 'completed':
      return <CheckCircle2 size={16} className="text-green-500" />;
    case 'failed':
      return <XCircle size={16} className="text-red-500" />;
    case 'cancelled':
      return <Ban size={16} className="text-amber-500" />;
  }
}

export function JobsSection({ refreshKey }: { refreshKey: number }) {
  const [jobList, setJobList] = useState<Job[]>([]);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadJobs = async () => {
    try {
      const data = await jobs.list();
      setJobList(data);
    } catch (err) {
      console.error('Failed to load jobs:', err);
    }
  };

  useEffect(() => {
    loadJobs();
  }, [refreshKey]);

  useEffect(() => {
    const hasActive = jobList.some((j) => j.status === 'pending' || j.status === 'running');
    if (!hasActive) return;
    const interval = setInterval(loadJobs, 3000);
    return () => clearInterval(interval);
  }, [jobList]);

  const startJob = async (type: string) => {
    setStarting(true);
    setError(null);
    try {
      await jobs.start(type);
      await loadJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start job');
    } finally {
      setStarting(false);
    }
  };

  const cancelJob = async (id: string) => {
    try {
      await jobs.cancel(id);
      setJobList((prev) =>
        prev.map((j) =>
          j.id === id ? { ...j, progress: { ...j.progress, message: 'Cancelling...' } } : j
        )
      );
      const pollCancel = async (retries: number) => {
        const data = await jobs.list();
        setJobList(data);
        const job = data.find((j: Job) => j.id === id);
        if (job && (job.status === 'pending' || job.status === 'running') && retries > 0) {
          setTimeout(() => pollCancel(retries - 1), 1000);
        }
      };
      pollCancel(15);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel job');
    }
  };

  const hasActiveJob = jobList.some((j) => j.status === 'pending' || j.status === 'running');

  return (
    <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/[0.03] p-6 space-y-4">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
        <Cog size={20} className="text-gray-600 dark:text-gray-400" />
        Jobs
      </h2>

      <div className="flex flex-col items-start gap-4">
        <div className='flex flex-col'>
          <button
            onClick={() => startJob('backfill')}
            disabled={starting || hasActiveJob}
            className="btn-primary"
          >
            {starting ? (
              <>
                <Loader2 size={16} className="animate-spin mr-2" />
                Starting...
              </>
            ) : (
              <>
                <Play size={16} className="mr-2" />
                Backfill Venues
              </>
            )}
          </button>
          <p className="text-xs text-gray-400 mt-1">Reverse geocode and categorize venues</p>
        </div>
        <div className='flex flex-col'>
          <button
            onClick={() => startJob('dawarich-export')}
            disabled={true || starting || hasActiveJob}
            className="btn-secondary"
          >
            <Send size={16} className="mr-2" />
            Export to Dawarich
          </button>
          <p className="text-xs text-gray-400 mt-1">Export Places to Dawarich (disabled; untested)</p>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-red-600">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {jobList.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Recent Jobs</h3>
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {jobList.map((job) => (
              <div key={job.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <JobStatusIcon status={job.status} />
                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100 capitalize">{job.type}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${job.status === 'completed' ? 'bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400' :
                      job.status === 'running' ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400' :
                        job.status === 'failed' ? 'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400' :
                          'bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
                      }`}>
                      {job.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {(job.status === 'pending' || job.status === 'running') && (
                      <button
                        onClick={() => cancelJob(job.id)}
                        className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700 font-medium"
                      >
                        <StopCircle size={13} />
                        Cancel
                      </button>
                    )}
                    <span className="text-xs text-gray-400">{formatRelativeTime(job.created_at)}</span>
                  </div>
                </div>
                {job.progress?.message && (
                  <p className="text-xs text-gray-500 mt-1 ml-6">{job.progress.message}</p>
                )}
                {job.error && job.status !== 'cancelled' && (
                  <p className="text-xs text-red-500 mt-1 ml-6">{job.error}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

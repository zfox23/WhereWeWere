/**
 * "Sync playlists now": starts the `spotify-sync` job and follows its
 * progress, then reloads the shared Spotify status.
 */

import { useEffect, useRef, useState } from 'react';
import { jobs } from '../../../client/src/api/client';
import { refreshSpotifyStatus } from './useSpotifyStatus';

const JOB_TYPE = 'spotify-sync';
const POLL_MS = 1500;

export function useSpotifySync(onDone?: () => void) {
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const finish = () => {
    setSyncing(false);
    void refreshSpotifyStatus();
    done.current?.();
  };

  const poll = (jobId: string) => {
    timer.current = setTimeout(async () => {
      try {
        const job = await jobs.get(jobId);
        if (typeof job?.progress?.message === 'string') setMessage(job.progress.message);
        if (job.status === 'pending' || job.status === 'running') {
          poll(jobId);
          return;
        }
        if (job.status === 'failed') {
          setMessage(null);
          setError(job.error || 'Spotify sync failed.');
        }
      } catch {
        setMessage(null);
      }
      finish();
    }, POLL_MS);
  };

  const start = async () => {
    setSyncing(true);
    setError(null);
    setMessage('Starting the sync…');
    try {
      poll((await jobs.start(JOB_TYPE)).id);
    } catch (err) {
      setSyncing(false);
      setMessage(null);
      setError(err instanceof Error ? err.message : 'Could not start the sync.');
    }
  };

  return { syncing, message, error, start };
}

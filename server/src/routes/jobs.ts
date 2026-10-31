import { Router, Request, Response } from 'express';
import { query } from '../db';
import {
  findPluginJob,
  requestJobCancellation,
  runPluginJob,
  supportedJobTypes,
  isJobRunningLocally,
} from '../services/jobs';
import { isUuid } from '../services/batching';
import { currentUserId } from '../auth/context';

const router = Router();

// Jobs are per-user: every lookup is scoped to the signed-in user, and
// another user's job behaves exactly like a missing one (404).

// GET / - list the user's recent jobs
router.get('/', async (_req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT id, type, status, progress, error, started_at, completed_at, created_at
       FROM jobs
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 20`,
      [currentUserId()]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error listing jobs:', err);
    res.status(500).json({ error: 'Failed to list jobs' });
  }
});

// GET /:id - get job status
router.get('/:id', async (req: Request, res: Response) => {
  try {
    if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Job not found' });
    const result = await query(
      `SELECT id, type, status, progress, error, started_at, completed_at, created_at
       FROM jobs WHERE id = $1 AND user_id = $2`,
      [req.params.id, currentUserId()]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error getting job:', err);
    res.status(500).json({ error: 'Failed to get job' });
  }
});

// POST / - start a new job (all job types are plugin-contributed)
router.post('/', async (req: Request, res: Response) => {
  try {
    // Express 5 leaves req.body undefined when no body was sent.
    const type = req.body?.type;

    const definition = typeof type === 'string' ? findPluginJob(type) : undefined;
    if (!definition) {
      return res.status(400).json({ error: `Unknown job type. Supported: ${supportedJobTypes().join(', ')}` });
    }

    const userId = currentUserId();

    // Check if this user already has a running job of this type
    const running = await query(
      `SELECT id FROM jobs WHERE user_id = $1 AND type = $2 AND status IN ('pending', 'running')`,
      [userId, type]
    );
    if (running.rows.length > 0) {
      return res.status(409).json({
        error: 'A job of this type is already running',
        job_id: running.rows[0].id,
      });
    }

    // The partial unique index idx_jobs_one_active_per_user_type (one
    // pending/running job per user and type) makes this insert the real
    // guard; the check above is just the friendly fast path.
    let job;
    try {
      const result = await query(
        `INSERT INTO jobs (user_id, type, status) VALUES ($1, $2, 'pending') RETURNING *`,
        [userId, type]
      );
      job = result.rows[0];
    } catch (insertErr: any) {
      if (insertErr?.code === '23505') {
        const active = await query(
          `SELECT id FROM jobs WHERE user_id = $1 AND type = $2 AND status IN ('pending', 'running') LIMIT 1`,
          [userId, type]
        );
        return res.status(409).json({
          error: 'A job of this type is already running',
          job_id: active.rows[0]?.id ?? null,
        });
      }
      throw insertErr;
    }

    // Fire and forget — run in the background
    runPluginJob(job.id, definition).catch((err: unknown) => {
      console.error(`Background job ${job.id} threw:`, err);
    });

    res.status(201).json(job);
  } catch (err) {
    console.error('Error creating job:', err);
    res.status(500).json({ error: 'Failed to create job' });
  }
});

// POST /:id/cancel - cancel a running/pending job
router.post('/:id/cancel', async (req: Request, res: Response) => {
  try {
    if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Job not found' });
    const result = await query(
      `SELECT id, status FROM jobs WHERE id = $1 AND user_id = $2`,
      [req.params.id, currentUserId()]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }
    const job = result.rows[0];
    if (job.status !== 'pending' && job.status !== 'running') {
      return res.status(400).json({ error: 'Job is not active' });
    }

    // Diagnostic: distinguish a live runner (in-memory flag will be honored)
    // from a stale DB row left over from a previous process (flag goes nowhere).
    console.log(
      `[jobs] cancel requested for ${job.id} (status=${job.status}, runningInThisProcess=${isJobRunningLocally(job.id)})`
    );
    if (!isJobRunningLocally(job.id)) {
      console.warn(
        `[jobs] job ${job.id} has NO live runner in this process — it is a stale 'running' row from a previous server run; the in-memory cancel flag will be ignored`
      );
    }

    // Signal the in-memory runner to stop. Only for a live local runner: a
    // flag for any other id would never be cleared and would leak.
    if (isJobRunningLocally(job.id)) requestJobCancellation(job.id);

    // If the job is 'running' but has no live runner in this process (e.g. the
    // server restarted while it was running), the in-memory flag alone will
    // never be observed — force the DB row to cancelled directly.
    if (job.status === 'running' && !isJobRunningLocally(job.id)) {
      await query(
        `UPDATE jobs SET status = 'cancelled', completed_at = NOW(), error = 'Job was cancelled by user (no active runner found).' WHERE id = $1`,
        [job.id]
      );
    }

    // If pending (not yet started), mark cancelled immediately
    if (job.status === 'pending') {
      await query(
        `UPDATE jobs SET status = 'cancelled', completed_at = NOW(), error = 'Job was cancelled by user.' WHERE id = $1`,
        [job.id]
      );
    }

    res.json({ message: 'Cancellation requested' });
  } catch (err) {
    console.error('Error cancelling job:', err);
    res.status(500).json({ error: 'Failed to cancel job' });
  }
});

export const jobsRouter = router;

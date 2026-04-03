import { Router, Request, Response } from 'express';
import { query } from '../db';
import {
  runBackfillJob,
  runDawarichExportJob,
  runVenueMergeJob,
  requestJobCancellation,
} from '../services/jobs';

const router = Router();

// GET / - list recent jobs
router.get('/', async (_req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT id, type, status, progress, error, started_at, completed_at, created_at
       FROM jobs
       ORDER BY created_at DESC
       LIMIT 20`
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
    const result = await query(
      `SELECT id, type, status, progress, error, started_at, completed_at, created_at
       FROM jobs WHERE id = $1`,
      [req.params.id]
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

// POST / - start a new job
router.post('/', async (req: Request, res: Response) => {
  try {
    const { type } = req.body;

    const supportedTypes = ['backfill', 'dawarich-export', 'venue-merge'];
    if (!supportedTypes.includes(type)) {
      return res.status(400).json({ error: `Unknown job type. Supported: ${supportedTypes.join(', ')}` });
    }

    // Check if there's already a running job of this type
    const running = await query(
      `SELECT id FROM jobs WHERE type = $1 AND status IN ('pending', 'running')`,
      [type]
    );
    if (running.rows.length > 0) {
      return res.status(409).json({
        error: 'A job of this type is already running',
        job_id: running.rows[0].id,
      });
    }

    const result = await query(
      `INSERT INTO jobs (type, status) VALUES ($1, 'pending') RETURNING *`,
      [type]
    );
    const job = result.rows[0];

    // Fire and forget — run in the background
    const runner = type === 'dawarich-export'
      ? runDawarichExportJob
      : type === 'venue-merge'
        ? runVenueMergeJob
        : runBackfillJob;
    runner(job.id).catch((err) => {
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
    const result = await query(
      `SELECT id, status FROM jobs WHERE id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }
    const job = result.rows[0];
    if (job.status !== 'pending' && job.status !== 'running') {
      return res.status(400).json({ error: 'Job is not active' });
    }

    // Signal the in-memory runner to stop
    requestJobCancellation(job.id);

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

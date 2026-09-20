import { query } from '../db';
import type { PluginJobContext, PluginJobDefinition, PluginJobProgress } from 'wwp-shared';
import { allPlugins } from '../plugins/registry';

// In-memory cancellation signals — checked between batches
const cancelledJobs = new Set<string>();

// Run at startup: any pending/running job in the DB was started by a previous
// process whose in-memory runner no longer exists — mark them failed so they
// don't show as stuck "running" and block new jobs of the same type.
export async function cleanupStaleJobs() {
  try {
    const result = await query(
      `SELECT id, type, status, started_at FROM jobs WHERE status IN ('pending', 'running')`
    );
    if (result.rows.length > 0) {
      console.warn(
        `[jobs] found ${result.rows.length} stale job(s) from a previous server run — marking them failed:`
      );
      for (const row of result.rows) {
        console.warn(
          `[jobs]   stale job ${row.id} type=${row.type} status=${row.status} started_at=${row.started_at}`
        );
        await query(
          `UPDATE jobs SET status = 'failed', completed_at = NOW(),
             error = 'Server restarted while this job was running; the job was interrupted.'
           WHERE id = $1`,
          [row.id]
        );
      }
    } else {
      console.log('[jobs] no stale pending/running jobs found at startup');
    }
  } catch (err) {
    console.warn('[jobs] failed to clean up stale jobs at startup:', err);
  }
}

// Job ids whose runner is alive in THIS process — used to detect stale DB rows
const localRunningJobs = new Set<string>();

export function isJobRunningLocally(jobId: string): boolean {
  return localRunningJobs.has(jobId);
}

export function requestJobCancellation(jobId: string) {
  cancelledJobs.add(jobId);
}

export function isJobCancelled(jobId: string): boolean {
  return cancelledJobs.has(jobId);
}

function cleanupCancellation(jobId: string) {
  cancelledJobs.delete(jobId);
}

export async function updateJobProgress(jobId: string, progress: PluginJobProgress) {
  await query(
    `UPDATE jobs SET progress = $1 WHERE id = $2`,
    [JSON.stringify(progress), jobId]
  );
}

/**
 * All plugin-contributed job definitions (jobType -> definition).
 * The core framework owns the jobs row lifecycle; plugins only provide the
 * work to do, so a job can touch any table without the core knowing its schema.
 */
export function pluginJobs(): PluginJobDefinition[] {
  return allPlugins().flatMap((plugin) => plugin.server.jobs ?? []);
}

export function findPluginJob(jobType: string): PluginJobDefinition | undefined {
  return pluginJobs().find((job) => job.jobType === jobType);
}

/** Job types accepted by POST /api/v1/jobs (all plugin-contributed). */
export function supportedJobTypes(): string[] {
  return pluginJobs().map((job) => job.jobType);
}

/**
 * Generic plugin job runner: marks the job running, dispatches to the
 * plugin's handler with a cancellation/progress context, and writes the
 * final status row. Handlers resolve on success and throw on failure (an
 * error whose message is 'cancelled' maps to status 'cancelled').
 */
export async function runPluginJob(jobId: string, definition: PluginJobDefinition): Promise<void> {
  const ctx: PluginJobContext = {
    jobId,
    isCancelled: () => cancelledJobs.has(jobId),
    updateProgress: (progress) => updateJobProgress(jobId, progress),
  };

  try {
    await query(
      `UPDATE jobs SET status = 'running', started_at = NOW() WHERE id = $1`,
      [jobId]
    );
    localRunningJobs.add(jobId);
    console.log(`[jobs] ${definition.jobType} ${jobId} started (local runner live)`);

    await definition.handler(ctx);

    await query(
      `UPDATE jobs SET status = 'completed', completed_at = NOW() WHERE id = $1`,
      [jobId]
    );
    console.log(`[jobs] ${definition.jobType} ${jobId} completed`);
  } catch (err: any) {
    const isCancelled = err.message === 'cancelled';
    console.error(`Job ${jobId} ${isCancelled ? 'cancelled' : 'failed'}:`, isCancelled ? '' : err);
    await query(
      `UPDATE jobs SET status = $1, completed_at = NOW(), error = $2 WHERE id = $3`,
      [
        isCancelled ? 'cancelled' : 'failed',
        isCancelled ? 'Job was cancelled by user.' : (err.message || String(err)),
        jobId,
      ]
    );
  } finally {
    cleanupCancellation(jobId);
    localRunningJobs.delete(jobId);
  }
}

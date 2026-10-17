-- At most one pending/running job per type. The route used to check and insert
-- in two steps, so two quick POSTs could start the same job twice.
-- First retire any duplicates that already exist (keep the newest per type),
-- otherwise the unique index below could not be created.
UPDATE jobs
SET status = 'failed',
    completed_at = NOW(),
    error = 'Superseded by a newer active job of the same type.'
WHERE status IN ('pending', 'running')
  AND id NOT IN (
    SELECT DISTINCT ON (type) id
    FROM jobs
    WHERE status IN ('pending', 'running')
    ORDER BY type, created_at DESC
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_one_active_per_type
  ON jobs (type)
  WHERE status IN ('pending', 'running');

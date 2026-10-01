-- ============================================================================
-- "Postcard From Your Past" (Profile > Reflect).
--
-- Stores every postcard the LLM has generated for the user so they can be
-- re-viewed from the history list later. `images` keeps the Immich asset ids
-- plus the metadata as seen at receive time (an asset may be deleted from
-- Immich later; the client renders a placeholder for a missing thumbnail).
-- `counts` is the per-type check-in tally for the interesting period.
-- ============================================================================

CREATE TABLE IF NOT EXISTS postcards (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period_from  DATE NOT NULL,
  period_to    DATE NOT NULL,
  addressed_to TEXT NOT NULL,
  sender_line  TEXT NOT NULL,
  stamp_city   TEXT,
  message      TEXT NOT NULL,
  images       JSONB NOT NULL DEFAULT '[]',
  counts       JSONB NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_postcards_user_created ON postcards(user_id, created_at DESC);

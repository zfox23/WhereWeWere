-- A paused "rank by comparing" session for a music list: the answers given so
-- far (and the ranks the session started from), so it can be resumed. One per
-- list; removed with the list.
CREATE TABLE IF NOT EXISTS music_rank_sessions (
  list_id UUID PRIMARY KEY REFERENCES music_lists(id) ON DELETE CASCADE,
  state JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

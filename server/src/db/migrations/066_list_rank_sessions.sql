-- Paused "rank by comparing" sessions for check-in lists, venue lists and media
-- lists, shaped like music_rank_sessions (063): one per list, removed with it.
-- Media lists also become rankable: ranks are 1..n among ranked items, NULL = unranked.
CREATE TABLE IF NOT EXISTS checkin_rank_sessions (
  list_id UUID PRIMARY KEY REFERENCES checkin_lists(id) ON DELETE CASCADE,
  state JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS venue_rank_sessions (
  list_id UUID PRIMARY KEY REFERENCES venue_lists(id) ON DELETE CASCADE,
  state JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

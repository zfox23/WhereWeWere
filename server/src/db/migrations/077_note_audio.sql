-- ============================================================================
-- Audio attachments for notes (notes plugin), with server-side transcription.
--   note_audio           - one row per attached audio file; the original file
--                          lives on disk at <DATA_DIR>/<user>/uploads/note_audio/
--   note_audio_segments  - timestamped transcript segments (editable)
-- A note may now consist of audio alone, so the "title or body" CHECK is
-- dropped; the application enforces "title, body or audio" instead.
-- ============================================================================

ALTER TABLE note_checkins DROP CONSTRAINT IF EXISTS note_checkins_check;

CREATE TABLE IF NOT EXISTS note_audio (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note_id UUID NULL REFERENCES note_checkins(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  bytes BIGINT NOT NULL CHECK (bytes >= 0),
  sha256 TEXT NOT NULL,
  duration_ms INT NULL,
  position INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'done', 'failed')),
  error TEXT NULL,
  attempts INT NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  language TEXT NULL,
  model TEXT NULL,
  transcript_text TEXT NOT NULL DEFAULT '',
  transcript_vector TSVECTOR GENERATED ALWAYS AS (
    to_tsvector('english'::regconfig, transcript_text)
  ) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_note_audio_note ON note_audio (note_id, position);
CREATE INDEX IF NOT EXISTS idx_note_audio_user ON note_audio (user_id);
CREATE INDEX IF NOT EXISTS idx_note_audio_queue ON note_audio (next_attempt_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_note_audio_search ON note_audio USING GIN (transcript_vector);

CREATE TRIGGER update_note_audio_updated_at
  BEFORE UPDATE ON note_audio
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS note_audio_segments (
  audio_id UUID NOT NULL REFERENCES note_audio(id) ON DELETE CASCADE,
  idx INT NOT NULL,
  start_ms INT NOT NULL,
  end_ms INT NOT NULL,
  text TEXT NOT NULL,
  edited BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (audio_id, idx)
);

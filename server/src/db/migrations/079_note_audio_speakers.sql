-- ============================================================================
-- Speaker identification for note audio transcripts.
--   note_audio_segments.speaker  - 'S1', 'S2'... (order of first appearance in the file), NULL if unknown
--   note_audio_segments.words    - word timings from the transcriber: [[startMs, endMs, "text"], ...],
--                                  kept so segments can be split where the speaker changes
--   note_audio_segments.src      - index of the original transcriber segment this one came from; segments
--                                  split at a speaker change share it, so a re-run can put them back together
--   note_audio.speakers          - display names the user chose: { "S1": "Dad" }; unnamed speakers show as "Speaker 1"
--   note_audio.diarization_*     - progress of the (optional) diarization pass, a queue like transcription's
-- ============================================================================

ALTER TABLE note_audio_segments
  ADD COLUMN IF NOT EXISTS speaker TEXT NULL,
  ADD COLUMN IF NOT EXISTS words JSONB NULL,
  ADD COLUMN IF NOT EXISTS src INT NULL;

ALTER TABLE note_audio
  ADD COLUMN IF NOT EXISTS speakers JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS diarization_status TEXT NOT NULL DEFAULT 'none'
    CHECK (diarization_status IN ('none', 'pending', 'processing', 'done', 'failed')),
  ADD COLUMN IF NOT EXISTS diarization_error TEXT NULL,
  ADD COLUMN IF NOT EXISTS diarization_attempts INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS diarization_next_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_note_audio_diarize_queue
  ON note_audio (diarization_next_at) WHERE diarization_status = 'pending';

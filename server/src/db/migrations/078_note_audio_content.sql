-- ============================================================================
-- Transcripts as note content.
--
-- note_checkins.content_hash used to be GENERATED from title + body. A note's
-- analysable content now includes the transcripts of its audio, and a
-- generated column cannot read another table, so the hash becomes a plain
-- column kept current by triggers:
--   - note_checkins: recomputed when title/body change (and on insert)
--   - note_audio:    the parent note's hash is recomputed when a transcript
--                    is saved/edited, or an audio file is attached/detached/deleted
-- For a note without transcripts the value is identical to the old generated
-- one, so existing embeddings stay valid; notes that gain a transcript get a
-- new hash and are re-embedded by the next analysis run.
-- ============================================================================

CREATE OR REPLACE FUNCTION note_transcripts(p_note_id UUID) RETURNS TEXT
LANGUAGE sql STABLE AS $$
  SELECT string_agg(transcript_text, E'\n' ORDER BY position, created_at)
    FROM note_audio
   WHERE note_id = p_note_id AND transcript_text <> ''
$$;

CREATE OR REPLACE FUNCTION note_content_hash(p_note_id UUID, p_title TEXT, p_body TEXT) RETURNS TEXT
LANGUAGE sql STABLE AS $$
  SELECT md5(COALESCE(p_title, '') || E'\n' || p_body
             || COALESCE(E'\n' || note_transcripts(p_note_id), ''))
$$;

ALTER TABLE note_checkins DROP COLUMN content_hash;
ALTER TABLE note_checkins ADD COLUMN content_hash TEXT NOT NULL DEFAULT '';

CREATE OR REPLACE FUNCTION note_checkins_set_content_hash() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.content_hash := note_content_hash(NEW.id, NEW.title, NEW.body);
  RETURN NEW;
END;
$$;

CREATE TRIGGER note_checkins_content_hash
  BEFORE INSERT OR UPDATE OF title, body ON note_checkins
  FOR EACH ROW EXECUTE FUNCTION note_checkins_set_content_hash();

-- Backfill (no audio exists yet, so this reproduces the old values).
UPDATE note_checkins SET content_hash = note_content_hash(id, title, body);

CREATE OR REPLACE FUNCTION note_audio_refresh_note_hash() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  ids UUID[] := ARRAY[]::UUID[];
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.note_id IS NOT NULL THEN ids := ids || OLD.note_id; END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.note_id IS NOT NULL THEN ids := ids || NEW.note_id; END IF;
  IF cardinality(ids) > 0 THEN
    UPDATE note_checkins n SET content_hash = note_content_hash(n.id, n.title, n.body)
     WHERE n.id = ANY(ids) AND n.content_hash IS DISTINCT FROM note_content_hash(n.id, n.title, n.body);
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER note_audio_refresh_hash
  AFTER INSERT OR DELETE OR UPDATE OF transcript_text, note_id, position ON note_audio
  FOR EACH ROW EXECUTE FUNCTION note_audio_refresh_note_hash();

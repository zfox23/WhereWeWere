-- Allow mood checkin IDs to be cached alongside location checkin IDs
ALTER TABLE checkin_scrobbles DROP CONSTRAINT IF EXISTS checkin_scrobbles_checkin_id_fkey;

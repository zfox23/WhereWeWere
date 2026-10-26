# Music

The Music plugin stores your scrobbles in WhereWeWere and shows them in three places:

- **Home timeline** — one item per *listening session* (plays less than 30 minutes apart), expandable to the track list. Sessions shorter than the minimum track count (default 3) stay off the timeline.
- **Other check-in cards** — a footer with the last up to three songs played on or before the check-in, newest first. The oldest fades out when the session has earlier plays. Clicking it jumps to that listening session on the Home timeline, opened and highlighted. It appears only when the most recent play is within the session gap of the check-in and its session meets the timeline's minimum track count (otherwise there is no session card to jump to).
- **Profile → Music** — totals, top songs/artists/albums and a library table for the period chosen with the usual period selector.

Scrobbles arrive from [multi-scrobbler](https://github.com/FoxxMD/multi-scrobbler) or from a history import. Preferences (session gap, minimum tracks, timezone) live in **Settings → Music**.

## Connecting multi-scrobbler

Multi-scrobbler has no plugin mechanism, so WhereWeWere imitates the one client it can reach with just a URL and key: the **Maloja** client. WhereWeWere implements only the four endpoints that client uses, under `/apis/mlj_1/`. Nothing from Maloja itself is needed.

1. Open **Settings → Music** and copy the key.
2. Give multi-scrobbler a Maloja client. With environment variables:

   ```yaml
   MALOJA_URL: http://<wherewewere-host>:<port>   # the web port, or the server port (SERVER_PORT, default 3001)
   MALOJA_ID: wherewewere                          # any label
   MALOJA_API_KEY: <key from Settings → Music>
   ```

   The URL must be reachable *from the multi-scrobbler container*, so `localhost` will not work from inside Docker; use the host's LAN address or a shared Docker network.
3. Restart multi-scrobbler. Its log should show `Auth test passed!` and, on the next play, `Scrobbled (New) => ... [Maloja - wherewewere]`.

The key is separate from `API_ACCESS_TOKEN`: the `/apis/` routes sit outside that guard because multi-scrobbler cannot send the `X-WhereWeWere-Token` header.

> **Note:** multi-scrobbler reads scrobble history without sending the key (it uses it to skip plays it has already sent), so `GET /apis/mlj_1/scrobbles` is readable by anyone who can reach the server port. Writes need the key. If that port is exposed beyond your network, keep it behind your reverse proxy's access controls.

### Replacing an existing Maloja server

Point the existing `MALOJA_URL` / `MALOJA_API_KEY` at WhereWeWere as above, then bring over the history:

1. Export your history from Maloja with `maloja export`, which writes a `maloja_export_<date>.json` file.
2. In **Settings → Music → Import scrobbles**, upload the `.json` file.

Importing is safe to repeat and safe after live scrobbling has started: a play is identified by its time, title and artists, so overlaps are skipped. Doing the multi-scrobbler switch first and the import second leaves no gap.

## Timezones

Neither multi-scrobbler nor Maloja records where a play happened — both deal in epoch seconds — so WhereWeWere assigns each play a timezone from your other check-ins: the zone of your latest timezone-bearing check-in (Location, Media, or any plugin that supplies `timezoneAnchors`) at or before the play. UTC-labelled check-ins are ignored, since imports use UTC for "unknown". Plays before your first check-in take the **fallback timezone** in **Settings → Music**, which starts out as your latest check-in's zone.

This applies to live scrobbles, imports and backups alike (a restore keeps the zones it was exported with). Days and periods on the Profile tab and the Home timeline group each play by its own zone, and a session takes the zone of its first play.

Zones are fixed when a play arrives. If you add or correct check-ins afterwards, or import history that predates your check-ins, use **Settings → Music → Re-assign timezones** to recompute every play. Changing the fallback timezone does the same.

## Sessions

A new play joins the session whose last play was within the gap, merges two sessions it bridges, or starts a new one. Changing the gap in settings (or re-assigning timezones) regroups all history. Sessions are derived data; the scrobbles are the source of truth.

## Backups

Scrobbles are included in backups and restored without duplicates.

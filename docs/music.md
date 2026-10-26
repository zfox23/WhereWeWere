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

### Importing history

**From Last.fm (preferred).** Export your history to a `.csv` (columns `uts,utc_time,artist,artist_mbid,album,album_mbid,track,track_mbid`) and upload it in **Settings → Music → Import from Last.fm**. Last.fm stores each artist credit as one string, so "Above & Beyond" stays whole. Last.fm has no album artist, so an album is credited to the artist of each play.

**From Maloja.** Point the existing `MALOJA_URL` / `MALOJA_API_KEY` at WhereWeWere as above, export with `maloja export` (a `maloja_export_<date>.json` file) and upload it in **Settings → Music → Import from Maloja**. Maloja splits credits such as "Above & Beyond" into separate artists when it imports them, and an export cannot undo that, so don't use it for history that came from Last.fm.

To start over, tick **All music data** under **Settings → Start Over**: it deletes every scrobble and listening session, and the music settings, including the scrobbler key (update multi-scrobbler afterwards).

Importing is safe to repeat and safe after live scrobbling has started: a play is identified by its time, title and artists, so overlaps are skipped. Doing the multi-scrobbler switch first and the import second leaves no gap.

## Timezones

Neither multi-scrobbler nor Maloja records where a play happened — both deal in epoch seconds — so WhereWeWere assigns each play a timezone from your other check-ins: the zone of your latest timezone-bearing check-in (Location, Media, or any plugin that supplies `timezoneAnchors`) at or before the play. UTC-labelled check-ins are ignored, since imports use UTC for "unknown". Plays before your first check-in take the **fallback timezone** in **Settings → Music**, which starts out as your latest check-in's zone.

This applies to live scrobbles, imports and backups alike (a restore keeps the zones it was exported with). Days and periods on the Profile tab and the Home timeline group each play by its own zone, and a session takes the zone of its first play.

Zones are fixed when a play arrives. If you add or correct check-ins afterwards, or import history that predates your check-ins, use **Settings → Music → Re-assign timezones** to recompute every play. Changing the fallback timezone does the same.

## Sessions

A new play joins the session whose last play was within the gap, merges two sessions it bridges, or starts a new one. Changing the gap in settings (or re-assigning timezones) regroups all history. Sessions are derived data; the scrobbles are the source of truth.

## Backups

Scrobbles are included in backups and restored without duplicates.

## Music metadata: artwork, release info and track lengths

Tiny album covers appear beside tracks in expanded listening sessions, in the music preview under other check-ins, in **Profile → Music** (Top songs, Top albums and the Library table), and clicking one opens a modal with the full-size cover, release date, label, the tracklist with lengths and your own scrobble count for each track.

Covers and release info come from [Deezer](https://developers.deezer.com/api) (no key needed), with [MusicBrainz](https://musicbrainz.org) and the Cover Art Archive as a fallback. An album is only accepted when its title agrees and the release's tracklist contains something you played, so an unmatched album shows no cover at all rather than a wrong one.

- **Existing history:** run **Settings → Music → Music metadata → Update music metadata**. It works through your albums most-played first, keeps its progress if a catalog is unreachable, and shows progress as it goes. Expect a large library to take a while (the catalogs are rate limited). Tick "Also retry albums that weren't found" to try earlier misses again.
- **Track lengths:** plays without a length (imports) take the length of the same track on their matched album's tracklist, which listening time on the Profile tab, in sessions and in the album modal falls back to. Lengths already recorded, such as those multi-scrobbler sends, are never overwritten. Singles with no album can't be filled this way. The same button also tops up albums matched in earlier runs.
- **New scrobbles:** the album of each new scrobble is looked up in the background after multi-scrobbler has been answered.
- **Storage:** matches live in the `music_albums` table and thumbnails (and, once opened, large covers) in `DATA_DIR/music-art/`. **Start Over → All music data** clears them.
- **Backups:** every album's match, release info and tracklist (and "not found" results) are in the backup, and ZIP backups carry the thumbnails as files. Large covers are not included; they download again when you open an album. A restore never contacts Deezer or MusicBrainz. If a restore had no thumbnails (a plain `.json` backup), press **Update music metadata** to download them again.
- **Privacy:** lookups send album and artist names to Deezer (and MusicBrainz when Deezer has no match). Nothing else leaves your server, and your browser only ever talks to WhereWeWere for images.

## Lists

Keep favorites, or any other lists, of songs and albums in **Profile → Music → Lists** (make a list there, or from the picker below).

- **Adding:** click a cover, or an album name in the Library or Top albums, to open the album's details. **Add album to list** adds the album; the heart beside a track adds that song. Songs and albums mix freely in one list.
- **Any album works:** an album with no catalog match opens the same details from your own plays (tracklist limited to what you've played, no cover or release info). Plays with no album at all gather under **Unknown album** for each artist; the album itself can't be listed, but its songs can.
- **Only played music:** a track you have never played (shown on a matched album's tracklist) has no add button.
- **Hearts:** songs and albums that are on a list show a heart in the Library, Top lists, listening sessions and the album details.
- **Managing:** rename or delete a list, remove items, and reorder with the arrows. Clicking an item opens its album details.
- **Identity:** a song is its title and artists, an album is its name and album artist (the same way the Library groups plays), so entries keep matching after re-imports and restores.
- **Backups:** lists travel in backups (restores merge by list name and skip items already there). **Start Over → All music data** deletes them too.
- **Show in library:** the details also have a button that filters the Library to that album, which replaces clicking an album name in Top albums to filter.

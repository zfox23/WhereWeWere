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

The `/apis/` routes don't use the sign-in session (multi-scrobbler can't sign in), so the key is what authenticates them. Each user has their own key, and scrobbles land in the account whose key was used; with several users, give each of their multi-scrobbler setups that user's key.

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

Profile → Music has three subtabs, like Profile → Places: **Overview** (the period selector, totals and Top songs/artists/albums), **Library** (every song, artist and album, over all time) and **Lists**. Only Overview has the period selector.

Keep favorites, or any other lists, of songs and albums in the **Lists** subtab (make a list there, or from the picker below). It works like Places' lists: an index of your lists (with a cover mosaic, item count and last-updated date; rename, delete and create from there) that opens a ranked table.

- **Adding:** click a cover, or an album name in the Library or Top albums, to open the album's details. **Add album to list** adds the album; the heart beside a track adds that song. Songs and albums mix freely in one list.
- **Any album works:** an album with no catalog match opens the same details from your own plays (tracklist limited to what you've played, no cover or release info). Plays with no album at all gather under **Unknown album** for each artist; the album itself can't be listed, but its songs can.
- **From Top songs / Top albums:** the list icon beside either heading on **Overview** makes a new list of exactly the rows shown (10, or all of them after "Show more"), ranked in play order, and opens it. It is named for the period: "2026-01 Most Listened Albums" for one month, "2026-01 - 2026-03 Most Listened Songs" for several, "2026-01-05 - 2026-01-11 Most Listened Songs" for a week or other range, and "All Time Most Listened Albums" for all time. A name already in use gets " (2)", " (3)" and so on, so earlier snapshots are kept. The Lists index shows when each list was created and last changed.
- **Only played music:** a track you have never played (shown on a matched album's tracklist) has no add button.
- **Hearts:** songs and albums that are on a list show a heart in the Library, Top lists, listening sessions and the album details.
- **Ranking:** drag the handle (mouse, touch or keyboard) or use each row's ⋯ menu to rank items; ranked items form a 1..n block above an Unranked block. New items arrive unranked. Dragging works while sorted by Rank; the table also sorts by name, artist, type, plays, listening time and last played (all-time numbers). Clicking an item's name opens its album details; ⋯ → Remove takes it off the list. Phones get cards instead of a table.
- **Identity:** a song is its title and artists, an album is its name and album artist (the same way the Library groups plays), so entries keep matching after re-imports and restores.
- **Backups:** lists and their ranks travel in backups (restores merge by list name and skip items already there; a list that already exists keeps its own ranking). **Start Over → All music data** deletes them too.
- **Its own page:** middle-click or ctrl-click a cover or album name to open the same details as a page in a new tab (`/music/album`), which can be bookmarked and shared.
- **Show in library:** the details also have a button that filters the Library to that album, which replaces clicking an album name in Top albums to filter.

### Rank by comparing

On a list's page, **Rank by comparing** (or **Resume ranking**) helps you rank a whole list by choosing between two items at a time, instead of dragging. Check-in, venue and media lists have it too, and work the same way (see [lists.md](lists.md)).

- **Start:** if some items are already ranked you choose **Continue from my ranking** (your ranks are a starting guess, which saves questions when they are mostly right; it costs more than starting fresh if they are badly off) or **Start from scratch**. A paused session offers **Resume**. Songs and albums are compared together.
- **Questions:** pick the one you like more by clicking it, or with the ← and → keys. **Can't decide** (↓ or T) calls it a tie, **Undo** (Backspace or Z) takes back the last answer, and **Finish now** jumps to the result with whatever has been settled.
- **Which questions:** a rating for every item is fitted to all your answers, and the next question is the pair whose order is least certain. A pair your earlier answers already imply (A over B, B over C) is never asked. The tool is done when every neighbouring pair in the order is settled by your answers, so a list takes about 0.8 × n·log₂(n) questions from scratch (around 160 for 40 items) and as few as n−1 when your existing ranking is right and trusted. The progress text ("12 answered · about 20 left") is a rough estimate.
- **Preview:** nothing changes until you press **Apply this ranking** on the result screen, which shows each item's new rank beside how far it moved. **Discard** throws the session away. Applying ranks every item, replacing the list's ranks.
- **Pausing:** progress is saved on the server after every answer, so you can leave (Pause and go back) or close the page and resume later. A saved session is a list of the answers given, so items added or removed from the list in the meantime are accounted for. Sessions are not included in backups.

## Writing down a song by hand

Heard something out in the world, off a device that doesn't scrobble? Use the Music entry in the **+** menu (or `/music-check-in`) to log it, so the moment can anchor other check-ins around that time.

- **Artist and song** autocomplete from your own plays first (your spelling, album and length), then Deezer. Picking a suggestion, or typing a song the lookup recognises exactly, fills in the album, album artist and length. They stay editable; nothing is overwritten once you've changed the album yourself.
- **When** defaults to now in this device's timezone and can be set to any earlier time. The play is stored in that timezone like any other.
- **Note, companions and location:** a free-text note, the people you were with (the same companions as other check-ins), and this device's approximate location (taken once, with your permission, and optional). The note, companions and a "Where I heard it" map link show under the song in its listening session.
- **Always visible:** a listening session that contains a hand-entered song is always shown on the Home timeline, even when it is shorter than the minimum-tracks setting (everything else still follows it). Its companions make the session appear when you filter Home by that companion, and the song counts in stats, lists and the "listening before" preview on other check-ins.
- **Duplicates:** if you already have the same song within about six minutes (a scrobbler got there first, or you saved it twice), the form tells you and asks before adding it anyway. In the other direction, when multi-scrobbler later sends a play of a song you wrote down within about six minutes, that play is skipped (your entry, with its note, wins) so counts and listening time aren't doubled.
- **Fixing or taking one back:** open the play's page (see below) to edit or delete it. The trash icon beside a hand-entered song in its expanded session also deletes it.
- **Backups:** hand-entered songs keep their notes, locations and companions through a backup and restore.

## A play's own page

Click the time beside any song in an expanded listening session on Home to open that play's page (`/music/plays/<id>`). It shows:

- the song: large cover (when the album was matched), title, artists (each opens the library), album (opens the album's details), length, and an **Add to list** button;
- when it was played, with the timezone it was played in, a link to that day on Home, and where it came from (written by hand, multi-scrobbler, a Last.fm or Maloja import) and how long you listened when that is known;
- the note, who you were with, and a map of where you heard it, when the play has them;
- your history with the song: how many times you've played it, first and last played, and a link to it in the library;
- its place in its session ("3rd of 12"), the song before and after, and a link to the session on Home;
- photos from that moment, when Immich is connected, like a place check-in.

**Edit** reopens the check-in form filled in (title, artists, album, length, time in the play's own timezone, note, companions, saved location), and **Delete** removes the play. Both work on any play, including scrobbled ones, and regroup the listening sessions around the old and new time. A scrobbled play you delete is not re-added unless the scrobbler sends it again.

## What counts as "the same song"

A song is its **title and first artist**. A trailing "(feat. X)", "(with X)" or remaster tag is ignored, because scrobblers and imports disagree about them: Spotify sends "Known You Before" by Jason Ross, Seven Lions and Emilie Brandt; Last.fm has "Known You Before (with Emilie Brandt)" by Jason Ross. Those are one song, with one play count, in the Library, on a play's page, in Top songs, in lists and in the "already on file" check for hand-entered songs. A remix, live version or "- Single Version" stays a separate song, and so does the same title by a different first artist. An album is its name and first album artist.

Each Library row shows the most recent spelling of the title and the fullest artist credit seen.

The Library is searched, sorted and paged by the server: type to search the whole history (title, artist or album), click a column to sort all of it, and use **Show more** for the next 100. It is not limited to the most-played rows.

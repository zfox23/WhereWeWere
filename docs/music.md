# Music

The Music plugin stores your scrobbles in WhereWeWere and shows them in three places:

- **Home timeline** — one item per *listening session* (plays less than 30 minutes apart), expandable to the track list. Sessions shorter than the minimum track count (default 3) stay off the timeline.
- **Other check-in cards** — a footer with the last up to three songs played on or before the check-in, newest first. The oldest fades out when the session has earlier plays. Clicking it jumps to that listening session on the Home timeline, opened and highlighted. It appears only when the most recent play is within the session gap of the check-in and its session meets the timeline's minimum track count (otherwise there is no session card to jump to).
- **Profile → Music** — totals, top songs/artists/albums and charts for the period chosen with the usual period selector, a library table and lists (see [Profile → Music](#profile--music)).
- **Spotify** (optional) — Open in Spotify on song, album and artist pages, your Spotify playlists with your plays of their tracks, and lists exported as Spotify playlists (see [Spotify](#spotify)).

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

## Genres

Every album and artist can have genres, which show across the plugin: chips on song, album, artist and play pages and in expanded listening sessions, a page for each genre, **Top genres** and **Genres over time** on the Overview, a genre filter in the Library, and genre breakdowns in Soundtrack of your life and Discovery.

- **Where they come from:** [MusicBrainz](https://musicbrainz.org), whose community votes on genres for release groups (an album across all its editions) and artists. Genres with at least a third of the top genre's votes are kept, up to six. Neither multi-scrobbler nor the Last.fm and Maloja exports carry genres.
- **Which genres a play has:** its album's. When the album has none (or the play has no album) it takes its first artist's. Featured artists don't add their genres.
- **Counting:** a play counts in full toward each of its genres, so genre totals can add up to more than the plays they came from.
- **Looking them up:** run **Settings → Music → Genres → Update genres**. It looks up every first-credited artist, then every album, most played first, keeps its progress if MusicBrainz is unreachable, and shows how many plays have genres. MusicBrainz allows about one request a second, so a large library takes hours. New scrobbles are looked up in the background, and opening a featured-only artist's page looks them up too. "Also retry albums and artists that had no genres" asks again for the misses.
- **Correcting them:** **Edit** beside the genres on an album's or artist's page. Your genres replace MusicBrainz's for that album or artist, and are kept when genres are looked up again. **Use MusicBrainz's genres** undoes an edit. Saving an album with no genres makes its plays use the artist's. An artist's "Unknown album" has no genres of its own.
- **A genre's page** (`/music/genre?name=…`, from any genre chip or link): totals and rank among genres, streaks and peaks, plays over time, its artists, songs and albums, the genres that share its plays, when you play it, and the companions, places and moods it's played around.
- **Backups and Start Over:** lookups and your corrections are in backups (a restore keeps what this server already looked up and adds your corrections where there are none). **Start Over → All music data** deletes them.
- **Privacy:** lookups send artist and album names to MusicBrainz. Nothing else leaves your server.

## Profile → Music

### Overview charts

Beside Top songs, artists and albums, **Top genres** lists the period's genres by plays (see [Genres](#genres)). Below the totals and Top lists, **Overview** has five charts. Every day, hour and month is read in the timezone the play happened in (see [Timezones](#timezones)).

- **Listening calendar** — plays per day for one year, as a heatmap. It opens on the year the selected period ends in, and the arrows change the year. Click a day to open it on Home. Above it are the number of days you listened that year, and your current and longest streaks of days in a row. Streaks count your whole history, not just the year shown. The current streak still counts if your last play was yesterday.
- **Genres over time** — a wave (streamgraph) of the period's eight most played genres, plus a grey **Other** for the rest, per week, month or year (the same bucket sizes as Discovery). Each band's thickness is its plays; a play counts toward each of its genres. Hover or drag a finger across it to read a band at that point (Other names its biggest genres), and click a band to open that genre.
- **Listening clock** — a day-of-week by hour-of-day grid for the period, darker for more listening. **Plays** / **Time** switches between play counts and listening time. Hover a cell for its numbers.
- **Discovery** — for each week, month or year of the period, plays of songs that were *new to you* stacked against *familiar* ones. A play counts as new when it falls in the same week, month or year as the first time you ever played that song. The bucket size follows the period: weeks for two months or less, months for up to three years, years beyond that. The headline gives the share of new plays and how many songs, artists and genres you heard for the first time ever during the period.
- **Soundtrack of your life** — what you played around your other check-ins, grouped by **Companions** (who you were with), **Places** (venue category) or **Mood** (the mood you logged). A play belongs to a check-in when it falls within your session gap (Settings → Music, 30 minutes by default) before or after it. A play near several check-ins of the same group counts once. Pick a group to see its top genres, artists and songs. **Most distinctive** sorts them by *lift*, which is how much bigger an item's share is in that group than in all your plays for the period: 2.0× means twice as often as usual. Items played only once, or no more than usual, are left out of that view. Hand-entered songs with companions count for those companions too.

### Library

The library table is a way in to the rest of your history:

- **Genre** (the picker beside the filter box) keeps only plays with that genre, in all three views. The genre page's **Show in library** opens it filtered this way.
- **Title** and **Artist** fill the filter box with that name. Each artist in a shared credit is its own link. On the **Artists** view, an artist's name opens the Songs view filtered to them.
- **Plays** (Songs view) opens every play of that song: its totals, a plays-per-month chart over its whole history, and every play newest first (date and time in the play's own timezone, album, length, where it came from). Click a play to open its own page. The home icon opens its listening session on Home.
- **Last played** shows the day of the song's last listening session, as Home groups it, and opens that day on Home with the session expanded and highlighted. Sessions shorter than the minimum-tracks setting aren't on Home: you land on the right day, but nothing is highlighted. The play's own page, reached from **Plays**, always works. A ctrl- or middle-click opens the day in a new tab, without the highlight.

## Lists

Profile → Music has three subtabs, like Profile → Places: **Overview** (the period selector, totals and Top songs/artists/albums), **Library** (every song, artist and album, over all time) and **Lists**, plus **Playlists** once Spotify is set up (see [Spotify](#spotify)). Only Overview has the period selector.

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

## Spotify

Spotify is optional. Each WhereWeWere user brings their own Spotify app, which keeps each app within Spotify's limit on the number of users an app in Development Mode may have.

### Setting it up

1. In the [Spotify developer dashboard](https://developer.spotify.com/dashboard), create an app and tick **Web API**. Since February 2026 the app's owner needs Spotify Premium.
2. Add the **Redirect URI** shown in **Settings → Music → Spotify** to the app. It is `https://<your WhereWeWere address>/api/v1/music/spotify/callback`. Spotify only accepts `https` addresses (or `http://127.0.0.1`), so open WhereWeWere through its https address (for example behind your reverse proxy) before connecting.
3. Under the app's **User Management**, add the Spotify account you will sign in with. Apps in Development Mode only work for accounts listed there.
4. Paste the app's **Client ID** and **Client Secret** into Settings → Music → Spotify and save. They are checked with Spotify first.
5. Press **Connect Spotify**, allow access on Spotify's page, and you return to Settings, where the first playlist sync starts.

WhereWeWere asks to read your playlists (your own, followed and collaborative ones) and to create and change playlists (for exports). **Disconnect** signs out and keeps the app and the synced playlists; **Change app** replaces the credentials (a different Client ID signs you out); **Remove** forgets the app, the sign-in and the synced playlists.

### Open in Spotify

With the app saved (signing in isn't needed for this), song, album and artist pages get an **Open in Spotify** button. The first time a page is opened, Spotify's catalog is searched with the names your plays use; a match needs the same name (ignoring "(feat. X)" credits and remaster tags) and your play's first artist among its artists. The answer is remembered, so later visits don't search again. When nothing matches confidently, the button becomes **Search Spotify** and opens a Spotify search instead; "no match" is asked again after 30 days. Albums under "Unknown album" have no button. Links go to open.spotify.com, which hands off to the Spotify app where it is installed (or opens the web player), so they work without Premium.

### Playlists

**Profile → Music → Playlists** lists the playlists in your Spotify library in Spotify's own order (the order the Spotify Web API returns your library in; it can't see the client's "Recents" sort). The **Sort** menu also offers last modified, name, most played and last played, and remembers your choice on this device. Spotify has no "last modified" date, so it is the newest **date added** among the playlist's tracks.

Each playlist shows its tracks, all-time plays of its songs, how many of its songs you've never played and when you last played one. Opening a playlist shows:

- every track with its plays and last-played date (a played song opens its own page), sortable by playlist order, title, artist, date added, plays or last played;
- **Most played**, **Forgotten** (songs you've played but not in the last 3, 6, 12 or 24 months) and **Top artists** (by your plays of their songs on the playlist);
- plays of its songs over time.

A track's plays are every play of the same song (see [What counts as "the same song"](#what-counts-as-the-same-song)), however it was scrobbled, and a song that appears twice on a playlist counts once in its totals.

**Playlists you follow but don't own:** since February 2026 Spotify only gives Development Mode apps the tracks of playlists you own or collaborate on. Other playlists are listed with their name, owner and cover but no tracks or plays ("Tracks not shared"); WhereWeWere doesn't ask for their tracks, which saves requests against Spotify's rate limit.

**Syncing:** the first sync runs right after connecting; after that playlists sync once a day, and **Sync now** (on the Playlists tab or in Settings) syncs straight away. A sync re-reads only the playlists that changed since the last one. Playlist covers are downloaded and served by WhereWeWere (in `DATA_DIR/spotify-covers/`), so your browser never loads images from Spotify. A sync that fails (Spotify unreachable or rate limiting, sign-in revoked) stops, shows its error in Settings, and changes nothing about playlists it hadn't finished; the next sync picks up where it stopped. A rate-limit error says how long Spotify asked you to wait. If Spotify no longer accepts the sign-in, you are signed out and asked to connect again.

### Exporting a list to Spotify

While Spotify is connected, an open list (Profile → Music → Lists) has **Export to Spotify**. It creates a private playlist named after the list, holding its songs and the tracks of its albums, in list order (ranked items first), each track once. WhereWeWere remembers the playlist, and the button becomes **Update on Spotify**, which replaces the playlist's tracks with the list's current ones. If you've removed that playlist from your Spotify library, the next export creates a new one. Songs and albums with no confident Spotify match are left out and listed under the button.

### Backups, Start Over and privacy

- **Backups** carry the Spotify matches and which playlist each list was exported to. They never carry the Client ID or Secret, your sign-in, or the synced playlists; after a restore, add the app and connect again, then sync.
- **Start Over → All music data** removes the matches, the export links and the synced playlists; resetting Music's settings also forgets the Spotify app and sign-in.
- **Privacy:** searches send song, album and artist names to Spotify. Syncing reads your playlists, and exporting writes a playlist. The Client Secret and tokens are stored in the database only.

## What counts as "the same song"

A song is its **title and first artist**. A trailing "(feat. X)", "(with X)" or remaster tag is ignored, because scrobblers and imports disagree about them: Spotify sends "Known You Before" by Jason Ross, Seven Lions and Emilie Brandt; Last.fm has "Known You Before (with Emilie Brandt)" by Jason Ross. Those are one song, with one play count, in the Library, on a play's page, in Top songs, in lists and in the "already on file" check for hand-entered songs. A remix, live version or "- Single Version" stays a separate song, and so does the same title by a different first artist. An album is its name and first album artist.

Each Library row shows the most recent spelling of the title and the fullest artist credit seen.

The Library is searched, sorted and paged by the server: type to search the whole history (title, artist or album), click a column to sort all of it, and use **Show more** for the next 100. It is not limited to the most-played rows.

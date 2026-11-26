/**
 * Profile > Music > Playlists: the user's Spotify playlists, in Spotify's
 * order (or sorted by last modified, name, plays or last played), each with
 * the user's plays of its songs. A playlist opens (`musicPlaylist` in the URL)
 * to its tracks with plays and last played, its most played and forgotten
 * tracks, top artists, and plays over time.
 *
 * Spotify only shares the tracks of playlists the user owns or collaborates
 * on; the others are listed without plays.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ExternalLink, History, ListMusic, Loader2, Mic2, RefreshCw, Trophy } from 'lucide-react';
import { music, spotify } from './api';
import { AlbumArt } from './AlbumArt';
import { ArtistLink, ArtistLinks, SongLink, songPath } from './links';
import { formatDay, formatLength } from './format';
import { ChartCard } from './insights/ChartCard';
import { PlaysWave } from './insights/PlaysWave';
import type { Bucket } from './insights/timeline';
import { useSpotifyStatus } from './useSpotifyStatus';
import { useSpotifySync } from './useSpotifySync';
import type { SpotifyPlaylist, SpotifyPlaylistDetail, SpotifyPlaylistTrack } from './types';

const CARD = 'bg-white/60 dark:bg-gray-900/60 rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3';
const SELECT =
  'rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200';
const SETTINGS_HREF = '/settings?tab=plugin:music';

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

export type PlaylistSort = 'spotify' | 'modified' | 'name' | 'plays' | 'last_played';

export const PLAYLIST_SORTS: { key: PlaylistSort; label: string }[] = [
  { key: 'spotify', label: 'Spotify order' },
  { key: 'modified', label: 'Last modified' },
  { key: 'name', label: 'Name' },
  { key: 'plays', label: 'Most played' },
  { key: 'last_played', label: 'Last played' },
];

const SORT_STORAGE_KEY = 'music.playlistSort';
const time = (iso: string | null) => (iso ? new Date(iso).getTime() : -Infinity);
/** Newest first; unknowns last. */
const newest = (a: string | null, b: string | null) => time(b) - time(a) || 0;

export function sortPlaylists(rows: SpotifyPlaylist[], sort: PlaylistSort): SpotifyPlaylist[] {
  const out = [...rows];
  const bySpotify = (a: SpotifyPlaylist, b: SpotifyPlaylist) => a.position - b.position;
  switch (sort) {
    case 'modified':
      return out.sort((a, b) => newest(a.last_modified_at, b.last_modified_at) || bySpotify(a, b));
    case 'name':
      return out.sort((a, b) => a.name.localeCompare(b.name) || bySpotify(a, b));
    case 'plays':
      return out.sort((a, b) => b.plays - a.plays || bySpotify(a, b));
    case 'last_played':
      return out.sort((a, b) => newest(a.last_played_at, b.last_played_at) || bySpotify(a, b));
    default:
      return out.sort(bySpotify);
  }
}

function storedSort(): PlaylistSort {
  try {
    const v = window.localStorage.getItem(SORT_STORAGE_KEY);
    return PLAYLIST_SORTS.some((s) => s.key === v) ? (v as PlaylistSort) : 'spotify';
  } catch {
    return 'spotify';
  }
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

function Cover({ playlist, size }: { playlist: { spotify_id: string; has_cover: boolean }; size: number }) {
  const [failed, setFailed] = useState(false);
  const box = { width: size, height: size };
  if (!playlist.has_cover || failed) {
    return (
      <span className="flex shrink-0 items-center justify-center rounded-md bg-gray-100 dark:bg-gray-800" style={box} aria-hidden>
        <ListMusic size={Math.round(size / 2.4)} className="text-gray-400" />
      </span>
    );
  }
  return (
    <img
      src={spotify.coverUrl(playlist.spotify_id)}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      onError={() => setFailed(true)}
      className="shrink-0 rounded-md object-cover"
      style={box}
    />
  );
}

function OpenInSpotify({ url, label = 'Open in Spotify' }: { url: string; label?: string }) {
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="btn-secondary inline-flex items-center gap-1.5 !px-2.5 !py-1 text-xs">
      <ExternalLink size={13} />
      {label}
    </a>
  );
}

const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;

// ---------------------------------------------------------------------------
// Index
// ---------------------------------------------------------------------------

function PlaylistIndex({ onOpen }: { onOpen: (id: string) => void }) {
  const status = useSpotifyStatus();
  const [rows, setRows] = useState<SpotifyPlaylist[] | null>(null);
  const [error, setError] = useState(false);
  const [sort, setSort] = useState<PlaylistSort>(storedSort);
  const load = () =>
    spotify
      .playlists()
      .then((r) => {
        setRows(r);
        setError(false);
      })
      .catch(() => setError(true));
  const sync = useSpotifySync(load);

  useEffect(() => {
    void load();
  }, []);

  const changeSort = (next: PlaylistSort) => {
    setSort(next);
    try {
      window.localStorage.setItem(SORT_STORAGE_KEY, next);
    } catch {
      // Not remembered; fine.
    }
  };

  const sorted = useMemo(() => (rows ? sortPlaylists(rows, sort) : []), [rows, sort]);

  if (error) return <p className="text-sm text-red-600">Couldn't load your playlists.</p>;
  if (!rows || !status) return <Loader2 size={20} className="animate-spin text-primary-600" />;

  if (!status.connected && rows.length === 0) {
    return (
      <div className={`${CARD} p-6 text-sm text-gray-600 dark:text-gray-300`}>
        <p>
          Connect Spotify in{' '}
          <Link to={SETTINGS_HREF} className="font-medium text-primary-600 hover:underline">
            Settings → Music
          </Link>{' '}
          to see your playlists here, with your plays of each track.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
          Sort
          <select className={SELECT} value={sort} onChange={(e) => changeSort(e.target.value as PlaylistSort)} aria-label="Sort playlists">
            {PLAYLIST_SORTS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
          {sync.syncing ? (
            <span className="flex items-center gap-1.5">
              <Loader2 size={13} className="animate-spin" />
              {sync.message}
            </span>
          ) : (
            status.last_synced_at && <span>Synced {formatDay(status.last_synced_at)}</span>
          )}
          {status.connected && (
            <button type="button" onClick={() => void sync.start()} disabled={sync.syncing} className="btn-secondary inline-flex items-center gap-1.5 !px-2.5 !py-1 text-xs">
              <RefreshCw size={13} className={sync.syncing ? 'animate-spin' : ''} />
              Sync now
            </button>
          )}
        </div>
      </div>
      {sync.error && <p className="text-xs text-red-600">{sync.error}</p>}
      {!status.connected && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          Spotify is disconnected, so these playlists aren't kept up to date.{' '}
          <Link to={SETTINGS_HREF} className="font-medium hover:underline">
            Connect again
          </Link>
        </p>
      )}
      {rows.length === 0 ? (
        <p className="text-sm text-gray-500">{sync.syncing ? 'Reading your playlists…' : 'No playlists yet. Sync to read them from Spotify.'}</p>
      ) : (
        <ul className={`${CARD} divide-y divide-gray-100 dark:divide-gray-800`} aria-label="Playlists">
          {sorted.map((p) => (
            <li key={p.spotify_id}>
              <button
                type="button"
                onClick={() => onOpen(p.spotify_id)}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-gray-800/50"
              >
                <Cover playlist={p} size={44} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-gray-900 dark:text-gray-100">{p.name}</span>
                  <span className="block truncate text-xs text-gray-500 dark:text-gray-400">
                    {[
                      !p.mine && p.owner_name ? `by ${p.owner_name}` : null,
                      p.total_tracks != null ? plural(p.total_tracks, 'track') : null,
                      p.last_modified_at ? `updated ${formatDay(p.last_modified_at)}` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                <span className="shrink-0 text-right text-xs">
                  {p.tracks_available ? (
                    <>
                      <span className="block font-medium tabular-nums text-pink-700 dark:text-pink-300">{plural(p.plays, 'play')}</span>
                      <span className="block text-gray-500 dark:text-gray-400">
                        {p.unplayed_songs > 0 ? `${p.unplayed_songs.toLocaleString()} never played` : p.last_played_at ? `last ${formatDay(p.last_played_at)}` : ''}
                      </span>
                    </>
                  ) : (
                    <span className="text-gray-400" title="Spotify only shares the tracks of playlists you own or collaborate on">
                      Tracks not shared
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// One playlist
// ---------------------------------------------------------------------------

type TrackSort = 'position' | 'title' | 'artist' | 'added' | 'plays' | 'last_played';

const TRACK_SORTS: { key: TrackSort; label: string }[] = [
  { key: 'position', label: 'Playlist order' },
  { key: 'title', label: 'Title' },
  { key: 'artist', label: 'Artist' },
  { key: 'added', label: 'Date added' },
  { key: 'plays', label: 'Plays' },
  { key: 'last_played', label: 'Last played' },
];

function sortTracks(tracks: SpotifyPlaylistTrack[], sort: TrackSort): SpotifyPlaylistTrack[] {
  const out = [...tracks];
  const byPosition = (a: SpotifyPlaylistTrack, b: SpotifyPlaylistTrack) => a.position - b.position;
  switch (sort) {
    case 'title':
      return out.sort((a, b) => a.title.localeCompare(b.title) || byPosition(a, b));
    case 'artist':
      return out.sort((a, b) => (a.artists[0] ?? '').localeCompare(b.artists[0] ?? '') || byPosition(a, b));
    case 'added':
      return out.sort((a, b) => newest(a.added_at, b.added_at) || byPosition(a, b));
    case 'plays':
      return out.sort((a, b) => b.plays - a.plays || byPosition(a, b));
    case 'last_played':
      return out.sort((a, b) => newest(a.last_played_at, b.last_played_at) || byPosition(a, b));
    default:
      return out.sort(byPosition);
  }
}

/** Each song once (a playlist can hold a song twice). */
function uniqueSongs(tracks: SpotifyPlaylistTrack[]): SpotifyPlaylistTrack[] {
  const seen = new Set<string>();
  return tracks.filter((t) => (seen.has(t.song_key) ? false : (seen.add(t.song_key), true)));
}

const FORGOTTEN_MONTHS = [3, 6, 12, 24];

/** Played songs not played in the last `months` months, most played first. */
export function forgottenTracks(tracks: SpotifyPlaylistTrack[], months: number, now = new Date()): SpotifyPlaylistTrack[] {
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - months);
  return uniqueSongs(tracks)
    .filter((t) => t.plays > 0 && t.last_played_at && new Date(t.last_played_at) < cutoff)
    .sort((a, b) => b.plays - a.plays || byTitle(a, b));
}

const byTitle = (a: SpotifyPlaylistTrack, b: SpotifyPlaylistTrack) => a.title.localeCompare(b.title);

/** First-credited artists of the playlist's songs by the user's plays (then by songs on the playlist). */
export function topArtists(tracks: SpotifyPlaylistTrack[]): { name: string; plays: number; songs: number }[] {
  const by = new Map<string, { name: string; plays: number; songs: number }>();
  for (const t of uniqueSongs(tracks)) {
    const name = t.artists[0];
    if (!name) continue;
    const row = by.get(name.toLowerCase()) ?? { name, plays: 0, songs: 0 };
    row.plays += t.plays;
    row.songs += 1;
    by.set(name.toLowerCase(), row);
  }
  return [...by.values()].sort((a, b) => b.plays - a.plays || b.songs - a.songs || a.name.localeCompare(b.name));
}

function TrackTitle({ t }: { t: SpotifyPlaylistTrack }) {
  // A song with plays has a page of its own; one never played doesn't.
  return t.plays > 0 ? <SongLink songKey={t.song_key}>{t.title}</SongLink> : <span>{t.title}</span>;
}

function RankedTracks({ tracks, empty, detail }: { tracks: SpotifyPlaylistTrack[]; empty: string; detail: (t: SpotifyPlaylistTrack) => string }) {
  if (tracks.length === 0) return <p className="text-xs text-gray-500">{empty}</p>;
  return (
    <ol className="space-y-1.5">
      {tracks.map((t, i) => (
        <li key={t.song_key} className="flex items-center gap-2 text-sm">
          <span className="w-5 shrink-0 text-right text-xs tabular-nums text-gray-400">{i + 1}.</span>
          <AlbumArt artId={t.art_id} albumRef={t.album_ref} size={24} />
          <span className="min-w-0 flex-1 truncate text-gray-900 dark:text-gray-100">
            <TrackTitle t={t} />
            <span className="text-xs text-gray-500 dark:text-gray-400"> · {t.artists.join(', ')}</span>
          </span>
          <span className="shrink-0 text-xs tabular-nums text-gray-500">{detail(t)}</span>
        </li>
      ))}
    </ol>
  );
}

const TOP_N = 10;

function PlaylistDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const [playlist, setPlaylist] = useState<SpotifyPlaylistDetail | null>(null);
  const [error, setError] = useState(false);
  const [sort, setSort] = useState<TrackSort>('position');
  const [months, setMonths] = useState(6);
  const [bucket, setBucket] = useState<Bucket>('month');

  useEffect(() => {
    let cancelled = false;
    setError(false);
    setPlaylist(null);
    spotify
      .playlist(id)
      .then((p) => !cancelled && setPlaylist(p))
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [id]);

  const tracks = useMemo(() => (playlist ? sortTracks(playlist.tracks, sort) : []), [playlist, sort]);
  const stats = useMemo(() => {
    if (!playlist) return null;
    const songs = uniqueSongs(playlist.tracks);
    return {
      plays: songs.reduce((n, t) => n + t.plays, 0),
      played: songs.filter((t) => t.plays > 0).length,
      songs: songs.length,
      mostPlayed: [...songs].filter((t) => t.plays > 0).sort((a, b) => b.plays - a.plays || byTitle(a, b)).slice(0, TOP_N),
      artists: topArtists(playlist.tracks).slice(0, TOP_N),
    };
  }, [playlist]);
  const forgotten = useMemo(() => (playlist ? forgottenTracks(playlist.tracks, months).slice(0, TOP_N) : []), [playlist, months]);

  const back = (
    <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-sm text-primary-600 hover:underline">
      <ArrowLeft size={14} />
      All playlists
    </button>
  );

  if (error) {
    return (
      <div className="space-y-3">
        {back}
        <p className="text-sm text-red-600">Couldn't load this playlist. It may have left your Spotify library.</p>
      </div>
    );
  }
  if (!playlist || !stats) {
    return (
      <div className="space-y-3">
        {back}
        <Loader2 size={20} className="animate-spin text-primary-600" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {back}
      <header className="flex items-start gap-4">
        <Cover playlist={playlist} size={96} />
        <div className="min-w-0">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">{playlist.name}</h2>
          {!playlist.mine && playlist.owner_name && <p className="text-sm text-gray-600 dark:text-gray-300">by {playlist.owner_name}</p>}
          {playlist.description && (
            // Spotify descriptions may carry HTML entities and links; show them as plain text.
            <p className="mt-0.5 line-clamp-2 text-xs text-gray-500 dark:text-gray-400">{new DOMParser().parseFromString(playlist.description, 'text/html').body.textContent}</p>
          )}
          <p className="mt-1 text-sm">
            {playlist.tracks_available && (
              <span className="font-medium text-pink-700 dark:text-pink-300">{plural(stats.plays, 'play')}</span>
            )}
            <span className="text-gray-500 dark:text-gray-400">
              {playlist.tracks_available
                ? ` · ${plural(playlist.tracks.length, 'track')} · ${stats.played.toLocaleString()} of ${plural(stats.songs, 'song')} played`
                : playlist.total_tracks != null
                  ? plural(playlist.total_tracks, 'track')
                  : ''}
              {playlist.last_modified_at && ` · updated ${formatDay(playlist.last_modified_at)}`}
            </span>
          </p>
          <div className="mt-2">
            <OpenInSpotify url={playlist.url} />
          </div>
        </div>
      </header>

      {!playlist.tracks_available ? (
        <p className={`${CARD} p-4 text-sm text-gray-600 dark:text-gray-300`}>
          Spotify only shares the tracks of playlists you own or collaborate on, so there are no plays to show for this one.
        </p>
      ) : (
        <>
          <PlaysWave
            series={playlist.series}
            rerank={(range) => music.series({ playlist: playlist.spotify_id }, range)}
            bandHref={songPath} bucket={bucket} onBucketChange={setBucket} title="Plays of its songs over time" />

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <ChartCard title="Most played" icon={Trophy}>
              <RankedTracks tracks={stats.mostPlayed} empty="None of its songs played yet." detail={(t) => plural(t.plays, 'play')} />
            </ChartCard>
            <ChartCard
              title="Forgotten"
              icon={History}
              controls={
                <select className={SELECT} value={months} onChange={(e) => setMonths(Number(e.target.value))} aria-label="Not played in">
                  {FORGOTTEN_MONTHS.map((m) => (
                    <option key={m} value={m}>
                      {m < 12 ? `${m} months` : m === 12 ? '1 year' : `${m / 12} years`}
                    </option>
                  ))}
                </select>
              }
            >
              <RankedTracks
                tracks={forgotten}
                empty="Every song you've played from it was played recently."
                detail={(t) => (t.last_played_at ? `last ${formatDay(t.last_played_at)}` : '')}
              />
            </ChartCard>
            <ChartCard title="Top artists" icon={Mic2}>
              {stats.artists.length === 0 ? (
                <p className="text-xs text-gray-500">No artists.</p>
              ) : (
                <ol className="space-y-1.5">
                  {stats.artists.map((a, i) => (
                    <li key={a.name} className="flex items-center gap-2 text-sm">
                      <span className="w-5 shrink-0 text-right text-xs tabular-nums text-gray-400">{i + 1}.</span>
                      <span className="min-w-0 flex-1 truncate text-gray-900 dark:text-gray-100">
                        {a.plays > 0 ? <ArtistLink name={a.name} /> : a.name}
                        <span className="text-xs text-gray-500 dark:text-gray-400"> · {plural(a.songs, 'song')}</span>
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-gray-500">{plural(a.plays, 'play')}</span>
                    </li>
                  ))}
                </ol>
              )}
            </ChartCard>
          </div>

          <div className={`${CARD} p-4`}>
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Tracks</h3>
              <select className={SELECT} value={sort} onChange={(e) => setSort(e.target.value as TrackSort)} aria-label="Sort tracks">
                {TRACK_SORTS.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm" aria-label="Tracks">
                <thead>
                  <tr className="text-left text-xs text-gray-500 dark:text-gray-400">
                    <th className="w-8 py-1 pr-2 text-right font-medium">#</th>
                    <th className="py-1 pr-2 font-medium">Title</th>
                    <th className="hidden py-1 pr-2 font-medium md:table-cell">Album</th>
                    <th className="hidden py-1 pr-2 font-medium sm:table-cell">Added</th>
                    <th className="py-1 pr-2 text-right font-medium">Plays</th>
                    <th className="py-1 text-right font-medium">Last played</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {tracks.map((t) => (
                    <tr key={t.position} className={t.plays > 0 ? '' : 'text-gray-500 dark:text-gray-400'}>
                      <td className="py-1.5 pr-2 text-right text-xs tabular-nums text-gray-400">{t.position + 1}</td>
                      <td className="max-w-[18rem] py-1.5 pr-2">
                        <span className="flex items-center gap-2">
                          <AlbumArt artId={t.art_id} albumRef={t.album_ref} size={28} />
                          <span className="min-w-0">
                            <span className={`block truncate ${t.plays > 0 ? 'text-gray-900 dark:text-gray-100' : ''}`}>
                              <TrackTitle t={t} />
                              {t.url && (
                                <a href={t.url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${t.title} in Spotify`} title="Open in Spotify" className="ml-1 inline-block align-middle text-gray-400 hover:text-green-600">
                                  <ExternalLink size={11} />
                                </a>
                              )}
                            </span>
                            <span className="block truncate text-xs text-gray-500 dark:text-gray-400">
                              <ArtistLinks artists={t.artists} />
                              {t.duration_ms ? ` · ${formatLength(Math.round(t.duration_ms / 1000))}` : ''}
                            </span>
                          </span>
                        </span>
                      </td>
                      <td className="hidden max-w-[12rem] truncate py-1.5 pr-2 text-xs md:table-cell">{t.album ?? ''}</td>
                      <td className="hidden whitespace-nowrap py-1.5 pr-2 text-xs sm:table-cell">{t.added_at ? formatDay(t.added_at) : ''}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">{t.plays > 0 ? t.plays.toLocaleString() : '–'}</td>
                      <td className="whitespace-nowrap py-1.5 text-right text-xs">{t.last_played_at ? formatDay(t.last_played_at) : 'Never'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The section
// ---------------------------------------------------------------------------

const playlistFromLocation = (): string | null => new URLSearchParams(window.location.search).get('musicPlaylist');

export function MusicPlaylistsSection() {
  const [selected, setSelected] = useState<string | null>(playlistFromLocation);

  // The open playlist lives in the URL (`musicPlaylist`), so Back from a song returns to it.
  useEffect(() => {
    const sync = () => setSelected(playlistFromLocation());
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);
  useEffect(() => {
    const url = new URL(window.location.href);
    if ((url.searchParams.get('musicPlaylist') ?? null) === selected) return;
    if (selected) url.searchParams.set('musicPlaylist', selected);
    else url.searchParams.delete('musicPlaylist');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  }, [selected]);

  return selected ? <PlaylistDetail id={selected} onBack={() => setSelected(null)} /> : <PlaylistIndex onOpen={setSelected} />;
}

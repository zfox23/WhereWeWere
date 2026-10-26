/**
 * Music plugin — public catalogs used to find album art and release info.
 *
 * Deezer first (no key, art/date/label/tracklist in two calls), MusicBrainz
 * with the Cover Art Archive as the fallback. Both take an injected `fetch`
 * so tests never reach the network.
 */

import {
  acceptsRelease,
  plausibleTitle,
  sameArtist,
  type AlbumMatch,
  type Played,
  type ReleaseTrack,
} from './albumMatch';

export type HttpResponse = { ok: boolean; status: number; json(): Promise<any> };
export type FetchLike = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<HttpResponse>;

export interface AlbumProvider {
  find(played: Played): Promise<AlbumMatch | null>;
}

/** Thrown when a catalog is throttling or down; the caller should stop and retry later. */
export class ProviderUnavailableError extends Error {}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Serialises requests with a minimum gap, since both catalogs rate-limit. */
function gate(minGapMs: number) {
  let last = 0;
  let chain: Promise<void> = Promise.resolve();
  return () => {
    const turn = chain.then(async () => {
      const wait = last + minGapMs - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();
    });
    chain = turn.catch(() => {});
    return turn;
  };
}

// ---------------------------------------------------------------------------
// Deezer
// ---------------------------------------------------------------------------

const DEEZER = 'https://api.deezer.com';
const DEEZER_CANDIDATES = 10;
const DEEZER_VERIFY = 3;

export function createDeezerProvider(fetchImpl: FetchLike, gapMs = 150): AlbumProvider {
  const wait = gate(gapMs);

  async function get(path: string, params: Record<string, string> = {}): Promise<any | null> {
    const url = `${DEEZER}${path}?${new URLSearchParams(params)}`;
    for (let attempt = 0; attempt < 3; attempt++) {
      await wait();
      let res: HttpResponse;
      try {
        res = await fetchImpl(url, { signal: AbortSignal.timeout(20_000) });
      } catch (err) {
        throw new ProviderUnavailableError(`Couldn't reach Deezer: ${err instanceof Error ? err.message : 'network error'}`);
      }
      if (res.status >= 500) throw new ProviderUnavailableError(`Deezer returned HTTP ${res.status}`);
      const body = await res.json().catch(() => null);
      // Errors arrive as HTTP 200 with an `error` body. 4 is the quota limit.
      if (body?.error) {
        if (body.error.code === 800) return null;
        if (body.error.code === 4) {
          await sleep(5_000 * (attempt + 1));
          continue;
        }
        throw new ProviderUnavailableError(`Deezer error ${body.error.code}: ${body.error.message}`);
      }
      if (!res.ok) throw new ProviderUnavailableError(`Deezer returned HTTP ${res.status}`);
      return body;
    }
    throw new ProviderUnavailableError('Deezer is rate limiting requests');
  }

  async function loadAlbum(id: number): Promise<AlbumMatch | null> {
    const album = await get(`/album/${id}`);
    if (!album) return null;
    let raw: any[] = Array.isArray(album.tracks?.data) ? album.tracks.data : [];
    // The embedded list can be cut short on long albums.
    while (raw.length < (album.nb_tracks ?? 0)) {
      const more = await get(`/album/${id}/tracks`, { index: String(raw.length), limit: '100' });
      if (!Array.isArray(more?.data) || more.data.length === 0) break;
      raw = raw.concat(more.data);
    }
    const tracks: ReleaseTrack[] = raw.map((t, i) => ({
      position: Number(t.track_position) || i + 1,
      title: String(t.title ?? ''),
      length: Number.isFinite(Number(t.duration)) && Number(t.duration) > 0 ? Number(t.duration) : null,
    }));
    return {
      provider: 'deezer',
      externalId: String(album.id),
      title: String(album.title ?? ''),
      artist: String(album.artist?.name ?? ''),
      releaseDate: typeof album.release_date === 'string' && album.release_date ? album.release_date : null,
      label: typeof album.label === 'string' && album.label ? album.label : null,
      tracks,
      thumbUrl: album.cover_medium ?? null,
      largeUrl: album.cover_xl ?? album.cover_big ?? null,
    };
  }

  async function search(q: string, played: Played, requireArtist: boolean): Promise<AlbumMatch | null> {
    const found = await get('/search/album', { q, limit: String(DEEZER_CANDIDATES) });
    const candidates = (Array.isArray(found?.data) ? found.data : [])
      .filter((c: any) => plausibleTitle(played.album, String(c.title ?? '')))
      .filter((c: any) => !requireArtist || sameArtist(played.artist, String(c.artist?.name ?? '')))
      .slice(0, DEEZER_VERIFY);
    for (const c of candidates) {
      const release = await loadAlbum(Number(c.id));
      if (release && acceptsRelease(played, release)) return release;
    }
    return null;
  }

  return {
    async find(played) {
      const quote = (s: string) => s.replace(/"/g, ' ');
      // Artist-constrained first; the album-only pass covers compilations and
      // soundtracks filed under "Various Artists" (the tracklist check guards it).
      return (
        (await search(`artist:"${quote(played.artist)}" album:"${quote(played.album)}"`, played, true)) ??
        (await search(`album:"${quote(played.album)}"`, played, false))
      );
    },
  };
}

// ---------------------------------------------------------------------------
// MusicBrainz + Cover Art Archive
// ---------------------------------------------------------------------------

const MB = 'https://musicbrainz.org/ws/2';
const CAA = 'https://coverartarchive.org/release';
/** MusicBrainz requires a descriptive User-Agent and allows one request a second. */
const MB_USER_AGENT = 'WhereWeWere/1.0 (https://github.com/zfox23/WhereWeWere)';

export function createMusicBrainzProvider(fetchImpl: FetchLike, gapMs = 1100): AlbumProvider {
  const wait = gate(gapMs);

  async function get(path: string, params: Record<string, string>): Promise<any | null> {
    await wait();
    let res: HttpResponse;
    try {
      res = await fetchImpl(`${MB}${path}?${new URLSearchParams({ ...params, fmt: 'json' })}`, {
        headers: { 'User-Agent': MB_USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      throw new ProviderUnavailableError(`Couldn't reach MusicBrainz: ${err instanceof Error ? err.message : 'network error'}`);
    }
    if (res.status === 404) return null;
    if (res.status === 503 || res.status === 429 || res.status >= 500) {
      throw new ProviderUnavailableError(`MusicBrainz returned HTTP ${res.status}`);
    }
    if (!res.ok) return null;
    return res.json().catch(() => null);
  }

  return {
    async find(played) {
      const esc = (s: string) => s.replace(/["\\]/g, ' ');
      const found = await get('/release', {
        query: `release:"${esc(played.album)}" AND artist:"${esc(played.artist)}"`,
        limit: '8',
      });
      const candidates = (Array.isArray(found?.releases) ? found.releases : [])
        .filter((r: any) => plausibleTitle(played.album, String(r.title ?? '')))
        .slice(0, 3);
      for (const c of candidates) {
        const r = await get(`/release/${c.id}`, { inc: 'recordings+labels+artist-credits' });
        if (!r) continue;
        const tracks: ReleaseTrack[] = (Array.isArray(r.media) ? r.media : [])
          .flatMap((m: any) => (Array.isArray(m.tracks) ? m.tracks : []))
          .map((t: any, i: number) => ({
            position: i + 1,
            title: String(t.title ?? ''),
            length: Number(t.length) > 0 ? Math.round(Number(t.length) / 1000) : null,
          }));
        if (!acceptsRelease(played, { title: String(r.title ?? ''), tracks })) continue;
        return {
          provider: 'musicbrainz',
          externalId: String(r.id),
          title: String(r.title ?? ''),
          artist: (Array.isArray(r['artist-credit']) ? r['artist-credit'] : [])
            .map((a: any) => `${a.name ?? ''}${a.joinphrase ?? ''}`)
            .join('') || played.artist,
          releaseDate: typeof r.date === 'string' && r.date ? r.date : null,
          label: r['label-info']?.[0]?.label?.name ?? null,
          tracks,
          thumbUrl: `${CAA}/${r.id}/front-250`,
          largeUrl: `${CAA}/${r.id}/front-1200`,
        };
      }
      return null;
    },
  };
}

/** Tries each provider in order; the first match wins. */
export function chainProviders(providers: AlbumProvider[]): AlbumProvider {
  return {
    async find(played) {
      for (const p of providers) {
        const match = await p.find(played);
        if (match) return match;
      }
      return null;
    },
  };
}

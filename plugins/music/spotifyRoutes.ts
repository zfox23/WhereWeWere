/**
 * Spotify routes of the Music plugin, mounted on its /music router:
 *
 *   GET    /spotify/status               app set up? signed in? last sync
 *   PUT    /spotify/credentials          { client_id, client_secret }: check with Spotify and save
 *   DELETE /spotify                      forget the app, the sign-in and the synced playlists
 *   POST   /spotify/authorize            { origin } -> { url }: the Spotify sign-in page
 *   GET    /spotify/callback             Spotify's redirect back; ends on Settings → Music
 *   POST   /spotify/disconnect           sign out, keeping the app and the playlists
 *   GET    /spotify/link                 ?kind=song&song_key | album&ref | artist&name -> { url, matched }
 *   GET    /spotify/playlists            the synced playlists with play totals
 *   GET    /spotify/playlists/:id        one playlist's tracks with plays, and plays per day
 *   GET    /spotify/playlists/:id/cover  its cover, served from WhereWeWere's cache
 *   GET    /spotify/exports/:listId      the playlist a list was exported to (or null)
 *   POST   /spotify/exports/:listId      export a list (create or update its playlist)
 *
 * The sync itself runs as the `spotify-sync` job (and daily, see services/spotifySync.ts).
 */

import type { Request, Response, Router } from 'express';
import { currentUserId } from '../../server/src/auth/context';
import { isUuid } from '../../server/src/services/batching';
import {
  completeAuthorization,
  disconnect,
  getStatus,
  removeAccount,
  saveCredentials,
  SpotifyError,
  startAuthorization,
  CALLBACK_PATH,
} from './services/spotifyApi';
import { getSpotifyLink, type LinkKind } from './services/spotifyLinks';
import { getPlaylist, listPlaylists } from './services/spotifyPlaylists';
import { getPlaylistCover } from './services/spotifySync';
import { exportList, getExport } from './services/spotifyExport';

function sendError(res: Response, err: unknown, what: string): void {
  if (err instanceof SpotifyError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error(`Error ${what}:`, err);
  res.status(500).json({ error: `Failed ${what}` });
}

const SETTINGS_PATH = '/settings?tab=plugin:music';
const PLAYLIST_ID_RE = /^[A-Za-z0-9]{1,64}$/;
const refParam = (v: unknown, max: number): string | null => (typeof v === 'string' && v.length > 0 && v.length <= max ? v : null);

export function mountSpotifyRoutes(router: Router): void {
  router.get('/spotify/status', async (_req: Request, res: Response) => {
    try {
      res.json({ ...(await getStatus(currentUserId())), callback_path: CALLBACK_PATH });
    } catch (err) {
      sendError(res, err, 'loading the Spotify status');
    }
  });

  router.put('/spotify/credentials', async (req: Request, res: Response) => {
    try {
      await saveCredentials(currentUserId(), req.body?.client_id, req.body?.client_secret);
      res.json({ ...(await getStatus(currentUserId())), callback_path: CALLBACK_PATH });
    } catch (err) {
      sendError(res, err, 'saving the Spotify app');
    }
  });

  router.delete('/spotify', async (_req: Request, res: Response) => {
    try {
      await removeAccount(currentUserId());
      res.json({ ok: true });
    } catch (err) {
      sendError(res, err, 'removing Spotify');
    }
  });

  router.post('/spotify/authorize', async (req: Request, res: Response) => {
    try {
      res.json({ url: await startAuthorization(currentUserId(), req.body?.origin) });
    } catch (err) {
      sendError(res, err, 'starting the Spotify sign-in');
    }
  });

  // A browser navigation from Spotify, not an API call: always answer with a
  // redirect to the settings page, carrying the outcome.
  router.get('/spotify/callback', async (req: Request, res: Response) => {
    try {
      await completeAuthorization(currentUserId(), { code: req.query.code, state: req.query.state, error: req.query.error });
      res.redirect(`${SETTINGS_PATH}&spotify=connected`);
    } catch (err) {
      if (!(err instanceof SpotifyError)) console.error('Error finishing the Spotify sign-in:', err);
      const message = err instanceof SpotifyError ? err.message : 'Connecting Spotify failed.';
      res.redirect(`${SETTINGS_PATH}&spotify_error=${encodeURIComponent(message)}`);
    }
  });

  router.post('/spotify/disconnect', async (_req: Request, res: Response) => {
    try {
      await disconnect(currentUserId());
      res.json({ ok: true });
    } catch (err) {
      sendError(res, err, 'disconnecting Spotify');
    }
  });

  router.get('/spotify/link', async (req: Request, res: Response) => {
    try {
      const kind = (['song', 'album', 'artist'] as const).includes(req.query.kind as LinkKind) ? (req.query.kind as LinkKind) : null;
      const ref =
        kind === 'song' ? refParam(req.query.song_key, 2000) : kind === 'album' ? refParam(req.query.ref, 2000) : refParam(req.query.name, 500);
      if (!kind || !ref) return res.status(400).json({ error: 'kind and song_key, ref or name are required' });
      if (kind === 'album' && ref.startsWith('|')) return res.status(404).json({ error: 'Unknown albums have no Spotify page' });
      const link = await getSpotifyLink(currentUserId(), kind, ref);
      if (!link) return res.status(404).json({ error: 'No plays of that' });
      res.json(link);
    } catch (err) {
      sendError(res, err, 'finding it on Spotify');
    }
  });

  router.get('/spotify/playlists', async (_req: Request, res: Response) => {
    try {
      res.json(await listPlaylists(currentUserId()));
    } catch (err) {
      sendError(res, err, 'loading the playlists');
    }
  });

  router.get('/spotify/playlists/:id', async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      if (!PLAYLIST_ID_RE.test(id)) return res.status(400).json({ error: 'Invalid playlist id' });
      const playlist = await getPlaylist(currentUserId(), id);
      if (!playlist) return res.status(404).json({ error: 'Playlist not found' });
      res.json(playlist);
    } catch (err) {
      sendError(res, err, 'loading the playlist');
    }
  });

  router.get('/spotify/playlists/:id/cover', async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      if (!PLAYLIST_ID_RE.test(id)) return res.status(400).end();
      const file = await getPlaylistCover(currentUserId(), id);
      if (!file) return res.status(404).end();
      // Covers change with the playlist; a day is fresh enough.
      res.set('Cache-Control', 'private, max-age=86400');
      res.type('image/jpeg').sendFile(file);
    } catch (err) {
      console.error('Error serving a playlist cover:', err);
      res.status(500).end();
    }
  });

  router.get('/spotify/exports/:listId', async (req: Request, res: Response) => {
    try {
      const listId = String(req.params.listId);
      if (!isUuid(listId)) return res.status(400).json({ error: 'Invalid list id' });
      res.json(await getExport(currentUserId(), listId));
    } catch (err) {
      sendError(res, err, 'loading the export');
    }
  });

  router.post('/spotify/exports/:listId', async (req: Request, res: Response) => {
    try {
      const listId = String(req.params.listId);
      if (!isUuid(listId)) return res.status(400).json({ error: 'Invalid list id' });
      const result = await exportList(currentUserId(), listId);
      if (!result) return res.status(404).json({ error: 'List not found' });
      res.status(result.created ? 201 : 200).json(result);
    } catch (err) {
      sendError(res, err, 'exporting to Spotify');
    }
  });
}

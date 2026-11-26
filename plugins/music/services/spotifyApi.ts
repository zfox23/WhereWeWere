/**
 * Music plugin — talking to Spotify: each user's app credentials, their
 * sign-in (OAuth authorization code flow) and tokens, and the Web API calls.
 *
 * Every user brings their own Spotify app (Client ID + Secret from the
 * Spotify developer dashboard), which keeps each app within Spotify's
 * Development Mode user limit. With only the app credentials, catalog search
 * works (client credentials token); playlists and exports need the user to
 * sign in.
 *
 * Endpoints follow Spotify's February 2026 Web API (playlist `/items`,
 * `POST /me/playlists`, search limit 10).
 */

import crypto from 'crypto';
import { query } from '../../../server/src/db';

const ACCOUNTS = 'https://accounts.spotify.com';
export const API = 'https://api.spotify.com/v1';

/** Playlists to read (own, followed and collaborative) and write (exports). */
export const SCOPES = [
  'playlist-read-private',
  'playlist-read-collaborative',
  'playlist-modify-private',
  'playlist-modify-public',
];

/** Where Spotify sends the browser back after sign-in, relative to the app's origin. */
export const CALLBACK_PATH = '/api/v1/music/spotify/callback';

/** How long a started sign-in may take before its state is refused. */
const SIGN_IN_TTL_MS = 15 * 60 * 1000;
/** Refresh an access token this long before Spotify says it expires. */
const TOKEN_MARGIN_MS = 60 * 1000;
/** Longest Retry-After (seconds) worth waiting for on a 429; longer fails the call. */
const MAX_RETRY_AFTER_S = 30;

export type SpotifyTransport = (url: string, init?: RequestInit) => Promise<Response>;

const realTransport: SpotifyTransport = (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });

// Tests never reach Spotify: they inject a fake with setSpotifyTransport.
let transport: SpotifyTransport | null = process.env.NODE_ENV === 'test' ? null : realTransport;

export function setSpotifyTransport(next: SpotifyTransport | null): void {
  transport = next;
  appTokens.clear();
}

/**
 * Something the user should be told. `status` is the HTTP status to answer
 * with (never 401/403: the client treats those as being signed out of
 * WhereWeWere); `upstream` is Spotify's own status when it answered.
 */
export class SpotifyError extends Error {
  constructor(message: string, readonly status = 400, readonly upstream?: number) {
    super(message);
  }
}

export const NOT_CONFIGURED = 'Add your Spotify app in Settings → Music first.';
export const NOT_CONNECTED = 'Connect your Spotify account in Settings → Music first.';

async function send(url: string, init?: RequestInit): Promise<Response> {
  if (!transport) throw new SpotifyError('Spotify is unavailable.', 502);
  try {
    return await transport(url, init);
  } catch (err) {
    throw new SpotifyError(`Couldn't reach Spotify: ${err instanceof Error ? err.message : 'network error'}`, 502);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Account rows
// ---------------------------------------------------------------------------

export interface SpotifyAccount {
  clientId: string;
  clientSecret: string;
  spotifyUserId: string | null;
  displayName: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiresAt: Date | null;
  oauthState: string | null;
  oauthRedirectUri: string | null;
  oauthStartedAt: Date | null;
}

export async function getAccount(userId: string): Promise<SpotifyAccount | null> {
  const r = await query(
    `SELECT client_id, client_secret, spotify_user_id, display_name, access_token, refresh_token, token_expires_at,
            oauth_state, oauth_redirect_uri, oauth_started_at
     FROM music_spotify_accounts WHERE user_id = $1`,
    [userId],
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    clientId: row.client_id,
    clientSecret: row.client_secret,
    spotifyUserId: row.spotify_user_id,
    displayName: row.display_name,
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    tokenExpiresAt: row.token_expires_at ? new Date(row.token_expires_at) : null,
    oauthState: row.oauth_state,
    oauthRedirectUri: row.oauth_redirect_uri,
    oauthStartedAt: row.oauth_started_at ? new Date(row.oauth_started_at) : null,
  };
}

const CLIENT_ID_RE = /^[0-9a-f]{32}$/i;

/** Check the app credentials with Spotify, then save them. A different Client ID signs the user out. */
export async function saveCredentials(userId: string, rawId: unknown, rawSecret: unknown): Promise<void> {
  const clientId = typeof rawId === 'string' ? rawId.trim() : '';
  const clientSecret = typeof rawSecret === 'string' ? rawSecret.trim() : '';
  if (!CLIENT_ID_RE.test(clientId) || !CLIENT_ID_RE.test(clientSecret)) {
    throw new SpotifyError('The Client ID and Client Secret are each 32 letters and digits, from your app in the Spotify developer dashboard.');
  }
  await appToken(clientId, clientSecret); // throws when Spotify rejects them
  await query(
    `INSERT INTO music_spotify_accounts (user_id, client_id, client_secret) VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE SET
       client_secret = EXCLUDED.client_secret,
       client_id = EXCLUDED.client_id,
       spotify_user_id = CASE WHEN music_spotify_accounts.client_id = EXCLUDED.client_id THEN music_spotify_accounts.spotify_user_id END,
       display_name = CASE WHEN music_spotify_accounts.client_id = EXCLUDED.client_id THEN music_spotify_accounts.display_name END,
       access_token = CASE WHEN music_spotify_accounts.client_id = EXCLUDED.client_id THEN music_spotify_accounts.access_token END,
       refresh_token = CASE WHEN music_spotify_accounts.client_id = EXCLUDED.client_id THEN music_spotify_accounts.refresh_token END,
       token_expires_at = CASE WHEN music_spotify_accounts.client_id = EXCLUDED.client_id THEN music_spotify_accounts.token_expires_at END,
       connected_at = CASE WHEN music_spotify_accounts.client_id = EXCLUDED.client_id THEN music_spotify_accounts.connected_at END,
       updated_at = NOW()`,
    [userId, clientId, clientSecret],
  );
}

/** Forget the Spotify app, the sign-in and the synced playlists (they cascade). */
export async function removeAccount(userId: string): Promise<void> {
  await query(`DELETE FROM music_spotify_accounts WHERE user_id = $1`, [userId]);
}

/** Sign out of Spotify but keep the app credentials and the synced playlists. */
export async function disconnect(userId: string, reason: string | null = null): Promise<void> {
  await query(
    `UPDATE music_spotify_accounts
     SET access_token = NULL, refresh_token = NULL, token_expires_at = NULL, scope = NULL, connected_at = NULL,
         last_error = COALESCE($2, last_error), updated_at = NOW()
     WHERE user_id = $1`,
    [userId, reason],
  );
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
}

async function tokenRequest(clientId: string, clientSecret: string, body: Record<string, string>): Promise<TokenResponse> {
  const res = await send(`${ACCOUNTS}/api/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(body).toString(),
  });
  const data = (await res.json().catch(() => ({}))) as Partial<TokenResponse> & { error?: string; error_description?: string };
  if (res.ok && typeof data.access_token === 'string') return data as TokenResponse;
  if (res.status >= 500) throw new SpotifyError('Spotify is unavailable; try again later.', 502, res.status);
  if (data.error === 'invalid_client') {
    throw new SpotifyError('Spotify rejected the Client ID or Client Secret.', 400, res.status);
  }
  if (data.error === 'invalid_grant') {
    throw new SpotifyError('Spotify no longer accepts this sign-in. Connect your account again.', 409, res.status);
  }
  throw new SpotifyError(`Spotify refused the request${data.error_description ? `: ${data.error_description}` : ''}.`, 400, res.status);
}

/** App-only tokens (client credentials), for catalog search; cached until shortly before they expire. */
const appTokens = new Map<string, { token: string; expiresAt: number }>();

async function appToken(clientId: string, clientSecret: string): Promise<string> {
  const key = `${clientId}:${crypto.createHash('sha256').update(clientSecret).digest('hex')}`;
  const cached = appTokens.get(key);
  if (cached && cached.expiresAt - Date.now() > TOKEN_MARGIN_MS) return cached.token;
  const t = await tokenRequest(clientId, clientSecret, { grant_type: 'client_credentials' });
  appTokens.set(key, { token: t.access_token, expiresAt: Date.now() + (t.expires_in ?? 3600) * 1000 });
  return t.access_token;
}

const refreshing = new Map<string, Promise<string>>();

/** The signed-in user's access token, refreshed when it is about to expire. */
export async function userAccessToken(userId: string): Promise<string> {
  const account = await getAccount(userId);
  if (!account) throw new SpotifyError(NOT_CONFIGURED, 409);
  if (!account.refreshToken) throw new SpotifyError(NOT_CONNECTED, 409);
  if (account.accessToken && account.tokenExpiresAt && account.tokenExpiresAt.getTime() - Date.now() > TOKEN_MARGIN_MS) {
    return account.accessToken;
  }
  // One refresh per user at a time: Spotify may rotate the refresh token.
  const pending = refreshing.get(userId);
  if (pending) return pending;
  const run = (async () => {
    try {
      const t = await tokenRequest(account.clientId, account.clientSecret, {
        grant_type: 'refresh_token',
        refresh_token: account.refreshToken as string,
      });
      await query(
        `UPDATE music_spotify_accounts
         SET access_token = $2, refresh_token = COALESCE($3, refresh_token),
             token_expires_at = NOW() + make_interval(secs => $4), updated_at = NOW()
         WHERE user_id = $1`,
        [userId, t.access_token, t.refresh_token ?? null, t.expires_in ?? 3600],
      );
      return t.access_token;
    } catch (err) {
      if (err instanceof SpotifyError && err.status === 409) await disconnect(userId, err.message);
      throw err;
    } finally {
      refreshing.delete(userId);
    }
  })();
  refreshing.set(userId, run);
  return run;
}

/** A token for catalog search: the user's own when signed in, else the app's. */
export async function searchToken(userId: string): Promise<string> {
  const account = await getAccount(userId);
  if (!account) throw new SpotifyError(NOT_CONFIGURED, 404);
  if (account.refreshToken) {
    try {
      return await userAccessToken(userId);
    } catch (err) {
      if (!(err instanceof SpotifyError) || err.status !== 409) throw err;
    }
  }
  return appToken(account.clientId, account.clientSecret);
}

// ---------------------------------------------------------------------------
// Web API calls
// ---------------------------------------------------------------------------

/**
 * Call the Web API (`path` relative to /v1, or a full `next` URL Spotify
 * returned). Waits out short rate limits. Non-2xx answers throw SpotifyError
 * with `upstream` set, so callers can treat a 403 or 404 as "not available".
 */
export async function spotifyApi<T = unknown>(
  token: string,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const url = path.startsWith(`${API}/`) ? path : `${API}${path.startsWith('/') ? '' : '/'}${path}`;
  for (let attempt = 0; ; attempt++) {
    const res = await send(url, {
      method: init.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    if (res.status === 429) {
      const wait = Number(res.headers.get('Retry-After')) || 1;
      if (attempt < 3 && wait <= MAX_RETRY_AFTER_S) {
        await sleep(wait * 1000);
        continue;
      }
      throw new SpotifyError('Spotify is rate limiting requests; try again in a while.', 502, 429);
    }
    if (res.status >= 500) {
      if (attempt < 2) {
        await sleep(1000 * (attempt + 1));
        continue;
      }
      throw new SpotifyError('Spotify is unavailable; try again later.', 502, res.status);
    }
    if (res.status === 204) return undefined as T;
    const data = await res.json().catch(() => null);
    if (res.ok) return data as T;
    const message = (data as { error?: { message?: string } } | null)?.error?.message;
    if (res.status === 401) throw new SpotifyError('Spotify sign-in expired. Connect your account again.', 409, 401);
    throw new SpotifyError(`Spotify refused the request${message ? `: ${message}` : ''}.`, 400, res.status);
  }
}

// ---------------------------------------------------------------------------
// Sign-in
// ---------------------------------------------------------------------------

/** The redirect URL for an app served at `origin`, or null when it isn't an http(s) origin. */
export function redirectUriFor(origin: unknown): string | null {
  if (typeof origin !== 'string' || origin.length > 500) return null;
  try {
    const url = new URL(origin);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return `${url.origin}${CALLBACK_PATH}`;
  } catch {
    return null;
  }
}

/** Start a sign-in: remember a fresh state and return the Spotify page to send the browser to. */
export async function startAuthorization(userId: string, origin: unknown): Promise<string> {
  const account = await getAccount(userId);
  if (!account) throw new SpotifyError(NOT_CONFIGURED, 409);
  const redirectUri = redirectUriFor(origin);
  if (!redirectUri) throw new SpotifyError('Unrecognised address for this app.');
  const state = crypto.randomBytes(24).toString('hex');
  await query(
    `UPDATE music_spotify_accounts SET oauth_state = $2, oauth_redirect_uri = $3, oauth_started_at = NOW(), updated_at = NOW()
     WHERE user_id = $1`,
    [userId, state, redirectUri],
  );
  const params = new URLSearchParams({
    client_id: account.clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: SCOPES.join(' '),
    state,
    show_dialog: 'true',
  });
  return `${ACCOUNTS}/authorize?${params}`;
}

/** Finish a sign-in from Spotify's redirect: check the state, trade the code for tokens, note who signed in. */
export async function completeAuthorization(
  userId: string,
  params: { code?: unknown; state?: unknown; error?: unknown },
): Promise<{ displayName: string | null }> {
  const account = await getAccount(userId);
  if (!account) throw new SpotifyError(NOT_CONFIGURED);
  const fresh =
    account.oauthState &&
    account.oauthRedirectUri &&
    account.oauthStartedAt &&
    Date.now() - account.oauthStartedAt.getTime() < SIGN_IN_TTL_MS &&
    typeof params.state === 'string' &&
    params.state.length === account.oauthState.length &&
    crypto.timingSafeEqual(Buffer.from(params.state), Buffer.from(account.oauthState));
  // The state is single-use, whatever happens next.
  await query(
    `UPDATE music_spotify_accounts SET oauth_state = NULL, oauth_started_at = NULL WHERE user_id = $1`,
    [userId],
  );
  if (!fresh) throw new SpotifyError('That Spotify sign-in expired or was started elsewhere. Press Connect again.');
  if (typeof params.error === 'string') {
    throw new SpotifyError(params.error === 'access_denied' ? 'Spotify access was not allowed.' : `Spotify said: ${params.error}.`);
  }
  if (typeof params.code !== 'string' || !params.code) throw new SpotifyError('Spotify sent no sign-in code.');

  const t = await tokenRequest(account.clientId, account.clientSecret, {
    grant_type: 'authorization_code',
    code: params.code,
    redirect_uri: account.oauthRedirectUri as string,
  });
  let me: { id?: string; display_name?: string | null };
  try {
    me = await spotifyApi(t.access_token, '/me');
  } catch (err) {
    if (err instanceof SpotifyError && err.upstream === 403) {
      throw new SpotifyError(
        "Spotify refused this account. While your app is in Development Mode, add your Spotify account's email under User Management in the app's dashboard.",
      );
    }
    throw err;
  }
  await query(
    `UPDATE music_spotify_accounts
     SET access_token = $2, refresh_token = $3, token_expires_at = NOW() + make_interval(secs => $4), scope = $5,
         spotify_user_id = $6, display_name = $7, connected_at = NOW(), last_error = NULL, updated_at = NOW()
     WHERE user_id = $1`,
    [userId, t.access_token, t.refresh_token ?? null, t.expires_in ?? 3600, t.scope ?? SCOPES.join(' '), me.id ?? null, me.display_name ?? me.id ?? null],
  );
  return { displayName: me.display_name ?? me.id ?? null };
}

export interface SpotifyStatus {
  configured: boolean;
  connected: boolean;
  client_id: string | null;
  display_name: string | null;
  spotify_user_id: string | null;
  last_synced_at: string | null;
  last_attempt_at: string | null;
  last_error: string | null;
  last_summary: unknown;
  playlists: number;
}

export async function getStatus(userId: string): Promise<SpotifyStatus> {
  const r = await query(
    `SELECT a.client_id, a.display_name, a.spotify_user_id, a.refresh_token IS NOT NULL AS connected,
            a.last_synced_at, a.last_attempt_at, a.last_error, a.last_summary,
            (SELECT COUNT(*)::int FROM music_spotify_playlists p WHERE p.user_id = a.user_id) AS playlists
     FROM music_spotify_accounts a WHERE a.user_id = $1`,
    [userId],
  );
  const row = r.rows[0];
  return {
    configured: !!row,
    connected: !!row?.connected,
    client_id: row?.client_id ?? null,
    display_name: row?.display_name ?? null,
    spotify_user_id: row?.spotify_user_id ?? null,
    last_synced_at: row?.last_synced_at ?? null,
    last_attempt_at: row?.last_attempt_at ?? null,
    last_error: row?.last_error ?? null,
    last_summary: row?.last_summary ?? null,
    playlists: row?.playlists ?? 0,
  };
}

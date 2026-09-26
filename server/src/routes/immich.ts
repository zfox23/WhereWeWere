import { Router, Request, Response } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { query } from '../db';
import { pluginTimestampUnion } from '../plugins/registry';
import { config } from '../config';

const router = Router();

import { DEFAULT_USER_ID as USER_ID } from '../constants';

// Person-photo disk cache: a featured person photo rarely changes, so keep it
// for a day; a "no such person" miss is re-checked after an hour.
const PERSON_PHOTO_TTL_MS = 24 * 60 * 60 * 1000;
const PERSON_MISS_TTL_MS = 60 * 60 * 1000;

async function getImmichSettings(): Promise<{ url: string; apiKey: string } | null> {
  const result = await query(
    'SELECT immich_url, immich_api_key FROM user_settings WHERE user_id = $1',
    [USER_ID]
  );
  const row = result.rows[0];
  if (!row?.immich_url || !row?.immich_api_key) return null;
  return { url: row.immich_url.replace(/\/+$/, ''), apiKey: row.immich_api_key };
}

// GET /photos/:checkinId - search Immich for photos around a check-in time
router.get('/photos/:checkinId', async (req: Request, res: Response) => {
  try {
    const { checkinId } = req.params;

    const immich = await getImmichSettings();
    if (!immich) return res.json({ assets: [] });

    // Get anchor timestamp (any check-in type — location, mood, sleep,
    // tracks, ... — each resolves its rows via its plugin hook).
    const checkinResult = await query(
      `${pluginTimestampUnion('       ')}`,
       [[checkinId]]
    );
    if (checkinResult.rows.length === 0) {
      return res.status(404).json({ error: 'Check-in not found' });
    }

    const t = new Date(checkinResult.rows[0].checked_in_at);
    const takenAfter = new Date(t.getTime() - 20 * 60 * 1000).toISOString();
    const takenBefore = new Date(t.getTime() + 2 * 60 * 60 * 1000).toISOString();

    const response = await fetch(`${immich.url}/api/search/metadata`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': immich.apiKey,
      },
      body: JSON.stringify({
        takenAfter,
        takenBefore,
        type: 'IMAGE',
        size: 20,
        order: 'asc',
      }),
    });

    if (!response.ok) {
      console.error('Immich search failed:', response.status, await response.text());
      return res.json({ assets: [] });
    }

    const data = await response.json() as {
      assets?: { items?: { id: string; thumbhash: string | null; originalFileName: string }[] };
    };

    const assets = (data.assets?.items || []).map((a) => ({
      id: a.id,
      thumbhash: a.thumbhash,
      originalFileName: a.originalFileName,
    }));

    res.json({ assets });
  } catch (err) {
    console.error('Error fetching Immich photos:', err);
    res.json({ assets: [] });
  }
});

interface ImmichAssetItem {
  id: string;
  thumbhash: string | null;
  originalFileName: string;
  localDateTime: string;
}

// GET /photos - batch search Immich for photos around multiple check-ins, with deduplication
router.get('/photos', async (req: Request, res: Response) => {
  try {
    const raw = req.query.checkin_ids as string | undefined;
    const checkinIds = (raw || '').split(',').filter(Boolean);
    if (checkinIds.length === 0) return res.json({});

    const immich = await getImmichSettings();
    if (!immich) {
      const empty: Record<string, never[]> = {};
      for (const id of checkinIds) empty[id] = [];
      return res.json(empty);
    }

    // Fetch all anchor timestamps across all check-in types (each resolves
    // its rows via its plugin hook).
    const checkinsResult = await query(
      `${pluginTimestampUnion('       ')}`,
       [checkinIds]
    );

    const checkinTimes = new Map<string, Date>();
    for (const row of checkinsResult.rows) {
      checkinTimes.set(row.id, new Date(row.checked_in_at));
    }

    // For each check-in, search Immich in parallel
    const perCheckinAssets = new Map<string, ImmichAssetItem[]>();

    await Promise.all(
      Array.from(checkinTimes.entries()).map(async ([checkinId, t]) => {
        const takenAfter = new Date(t.getTime() - 20 * 60 * 1000).toISOString();
        const takenBefore = new Date(t.getTime() + 2 * 60 * 60 * 1000).toISOString();

        try {
          const response = await fetch(`${immich.url}/api/search/metadata`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': immich.apiKey,
            },
            body: JSON.stringify({
              takenAfter,
              takenBefore,
              type: 'IMAGE',
              size: 20,
              order: 'asc',
            }),
          });

          if (response.ok) {
            const data = await response.json() as {
              assets?: { items?: ImmichAssetItem[] };
            };
            perCheckinAssets.set(checkinId, data.assets?.items || []);
          } else {
            perCheckinAssets.set(checkinId, []);
          }
        } catch {
          perCheckinAssets.set(checkinId, []);
        }
      })
    );

    // Deduplicate: assign each asset to the latest check-in timestamp.
    // Build map of assetId -> { asset, candidates: [{ checkinId, checkinTime }] }
    const assetCandidates = new Map<
      string,
      { asset: ImmichAssetItem; candidates: { checkinId: string; checkinTime: number }[] }
    >();

    for (const [checkinId, assets] of perCheckinAssets) {
      const checkinTime = checkinTimes.get(checkinId)!.getTime();
      for (const asset of assets) {
        if (!assetCandidates.has(asset.id)) {
          assetCandidates.set(asset.id, { asset, candidates: [] });
        }
        assetCandidates.get(asset.id)!.candidates.push({ checkinId, checkinTime });
      }
    }

    // Assign each asset to the latest check-in
    const result: Record<string, { id: string; thumbhash: string | null; originalFileName: string }[]> = {};
    for (const id of checkinIds) result[id] = [];

    for (const [, { asset, candidates }] of assetCandidates) {
      candidates.sort((a, b) => b.checkinTime - a.checkinTime);
      const bestCheckinId = candidates[0].checkinId;
      if (result[bestCheckinId]) {
        result[bestCheckinId].push({
          id: asset.id,
          thumbhash: asset.thumbhash,
          originalFileName: asset.originalFileName,
        });
      }
    }

    res.json(result);
  } catch (err) {
    console.error('Error batch fetching Immich photos:', err);
    res.status(500).json({ error: 'Failed to fetch photos' });
  }
});

// GET /thumbnail/:assetId - proxy an Immich thumbnail
router.get('/thumbnail/:assetId', async (req: Request, res: Response) => {
  try {
    const { assetId } = req.params;

    const immich = await getImmichSettings();
    if (!immich) return res.status(404).send('Immich not configured');

    const size = req.query.size === 'preview' ? 'preview' : 'thumbnail';
    const response = await fetch(
      `${immich.url}/api/assets/${assetId}/thumbnail?size=${size}`,
      {
        headers: { 'x-api-key': immich.apiKey },
      }
    );

    if (!response.ok) {
      return res.status(response.status).send('Failed to fetch thumbnail');
    }

    const contentType = response.headers.get('content-type');
    if (contentType) res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');

    const buffer = Buffer.from(await response.arrayBuffer());
    res.send(buffer);
  } catch (err) {
    console.error('Error proxying Immich thumbnail:', err);
    res.status(500).send('Failed to fetch thumbnail');
  }
});

// --- Person (companion) featured photos -------------------------------------

interface PersonPhotoMeta {
  found: boolean;
  personId?: string;
  contentType?: string;
  /** Cache file name (relative to the cache dir), present when found. */
  file?: string;
  fetchedAt: number;
}

function personCachePath(name: string): { dir: string; meta: string } {
  const slug =
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'unknown';
  const dir = path.join(config.dataDir, 'cache', 'immich-people');
  return { dir, meta: path.join(dir, `${slug}.json`) };
}

function photoExt(contentType: string | null): string {
  switch (contentType) {
    case 'image/png': return 'png';
    case 'image/webp': return 'webp';
    case 'image/gif': return 'gif';
    default: return 'jpg';
  }
}

async function readPersonMeta(metaPath: string): Promise<PersonPhotoMeta | null> {
  try {
    return JSON.parse(await fs.readFile(metaPath, 'utf8')) as PersonPhotoMeta;
  } catch {
    return null;
  }
}

/**
 * GET /person-photo?name=John%20Doe — the featured photo of the first Immich
 * person matching the name (used next to companion names). Disk-cached under
 * `<dataDir>/cache/immich-people/`; the browser is told to cache it for an
 * hour so re-renders don't even reach the server.
 */
router.get('/person-photo', async (req: Request, res: Response) => {
  const name = typeof req.query.name === 'string' ? req.query.name.trim() : '';
  if (!name) return res.status(400).send('Missing name');

  const immich = await getImmichSettings();
  if (!immich) return res.status(404).send('Immich not configured');

  const { dir, meta: metaPath } = personCachePath(name);
  const now = Date.now();

  try {
    // Serve from the disk cache while it is fresh.
    const meta = await readPersonMeta(metaPath);
    if (meta && now - meta.fetchedAt < (meta.found ? PERSON_PHOTO_TTL_MS : PERSON_MISS_TTL_MS)) {
      if (meta.found && meta.file) {
        try {
          const img = await fs.readFile(path.join(dir, meta.file));
          res.setHeader('Content-Type', meta.contentType || 'image/jpeg');
          res.setHeader('Cache-Control', 'public, max-age=3600');
          return res.send(img);
        } catch {
          // Cache image vanished (e.g. data dir wiped) — fall through and refetch.
        }
      } else {
        res.setHeader('Cache-Control', 'public, max-age=300');
        return res.status(404).send('Person not found');
      }
    }

    // 1. Search for the person by name to get their ID.
    const search = await fetch(
      `${immich.url}/api/search/person?name=${encodeURIComponent(name)}`,
      { headers: { 'x-api-key': immich.apiKey } }
    );
    if (!search.ok) {
      console.error('Immich person search failed:', search.status);
      return res.status(502).send('Immich person search failed');
    }
    const people = (await search.json()) as { id: string; name: string }[];

    await fs.mkdir(dir, { recursive: true });
    if (!people || people.length === 0) {
      // Negative cache so absent people don't hit Immich on every render.
      await fs.writeFile(metaPath, JSON.stringify({ found: false, fetchedAt: now } satisfies PersonPhotoMeta));
      res.setHeader('Cache-Control', 'public, max-age=300');
      return res.status(404).send('Person not found');
    }

    // 2. Fetch the person's featured thumbnail.
    const personId = people[0].id;
    const thumb = await fetch(`${immich.url}/api/people/${personId}/thumbnail`, {
      headers: { 'x-api-key': immich.apiKey },
    });
    if (!thumb.ok) {
      console.error('Immich person thumbnail failed:', thumb.status);
      return res.status(502).send('Failed to fetch person photo');
    }
    const contentType = thumb.headers.get('content-type') || 'image/jpeg';
    const buf = Buffer.from(await thumb.arrayBuffer());

    const file = `person-${photoExt(contentType)}`;
    await fs.writeFile(path.join(dir, file), buf);
    await fs.writeFile(
      metaPath,
      JSON.stringify({ found: true, personId, contentType, file, fetchedAt: now } satisfies PersonPhotoMeta)
    );

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(buf);
  } catch (err) {
    console.error('Error fetching person photo:', err);
    res.status(502).send('Failed to fetch person photo');
  }
});

export const immichRouter = router;

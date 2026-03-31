import { Router, Request, Response } from 'express';
import { query } from '../db';

const router = Router();

const USER_ID = '00000000-0000-0000-0000-000000000001';

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

    // Get check-in timestamp
    const checkinResult = await query(
      'SELECT checked_in_at FROM checkins WHERE id = $1',
      [checkinId]
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

    // Fetch all check-in timestamps
    const checkinsResult = await query(
      'SELECT id, checked_in_at FROM checkins WHERE id = ANY($1::uuid[])',
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

    // Deduplicate: assign each asset to the check-in closest in time
    // Build map of assetId -> { asset, candidates: [{ checkinId, distance }] }
    const assetCandidates = new Map<string, { asset: ImmichAssetItem; candidates: { checkinId: string; distance: number }[] }>();

    for (const [checkinId, assets] of perCheckinAssets) {
      const checkinTime = checkinTimes.get(checkinId)!.getTime();
      for (const asset of assets) {
        const assetTime = new Date(asset.localDateTime).getTime();
        const distance = Math.abs(assetTime - checkinTime);

        if (!assetCandidates.has(asset.id)) {
          assetCandidates.set(asset.id, { asset, candidates: [] });
        }
        assetCandidates.get(asset.id)!.candidates.push({ checkinId, distance });
      }
    }

    // Assign each asset to the closest check-in
    const result: Record<string, { id: string; thumbhash: string | null; originalFileName: string }[]> = {};
    for (const id of checkinIds) result[id] = [];

    for (const [, { asset, candidates }] of assetCandidates) {
      candidates.sort((a, b) => a.distance - b.distance);
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

export const immichRouter = router;

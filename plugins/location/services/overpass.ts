interface OverpassElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

const PLACE_TAG_KEYS = [
  'amenity',
  'shop',
  'tourism',
  'leisure',
  'aeroway',
  'highway=rest_area',
  'highway=services',
  'railway',
  'building',
  'office',
  'public_transport',
  'historic',
  'natural',
  'man_made',
] as const;

const GENERIC_CATEGORY_VALUES = new Set(['yes']);

function formatOsmTagValue(value: string): string {
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function getPrimaryCategoryValue(tags: Record<string, string>): string | null {
  for (const tagKey of PLACE_TAG_KEYS) {
    const tagValue = tags[tagKey]?.trim();
    if (!tagValue || GENERIC_CATEGORY_VALUES.has(tagValue)) continue;
    return tagValue;
  }

  return null;
}

function buildAddress(tags: Record<string, string>): string | null {
  const parts: string[] = [];
  if (tags['addr:housenumber'] && tags['addr:street']) {
    parts.push(`${tags['addr:housenumber']} ${tags['addr:street']}`);
  } else if (tags['addr:street']) {
    parts.push(tags['addr:street']);
  }
  if (tags['addr:city']) {
    parts.push(tags['addr:city']);
  }
  if (tags['addr:state']) {
    parts.push(tags['addr:state']);
  }
  if (tags['addr:postcode']) {
    parts.push(tags['addr:postcode']);
  }
  return parts.length > 0 ? parts.join(', ') : null;
}

function buildPlaceFilter(keys: readonly string[] = PLACE_TAG_KEYS): string {
  return `[~"^(${keys.join('|')})$"~"."]`;
}

function getParentPriority(tags: Record<string, string>): number {
  if (tags.aeroway && ['aerodrome', 'terminal', 'helipad'].includes(tags.aeroway)) return 10;
  if (tags.railway && ['station', 'halt', 'tram_stop', 'subway_entrance'].includes(tags.railway)) return 10;
  if (tags.shop === 'mall') return 9;
  if (tags.leisure === 'stadium' || tags.tourism === 'theme_park') return 9;
  if (tags.tourism === 'museum' || tags.amenity === 'university' || tags.building === 'university') return 8;
  if (tags.amenity === 'hospital' || tags.building === 'hospital') return 8;
  if (tags.leisure === 'park' || tags.tourism === 'zoo') return 7;
  return 1;
}

export interface EnclosingVenueResult {
  name: string;
  category: string;
  latitude: number;
  longitude: number;
  address: string | null;
  osm_id: string;
}

// --- In-memory cache ---
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const cache = new Map<string, { data: unknown; expires: number }>();

// Overpass is now only used for the background enclosing-venue lookup after
// an import (interactive venue search moved to Photon, see photonVenues.ts).
// Keep the timeout short so a loaded instance can't tie up a background task
// for minutes.
const OVERPASS_FETCH_TIMEOUT_MS = 30000;

// overpass-api.de rejects requests without a proper User-Agent (406 Not
// Acceptable). Node's global fetch sends "undici" by default, which their
// edge blocks, so set one explicitly on every request.
const OVERPASS_USER_AGENT = 'WhereWeWere/1.0 (self-hosted checkin app)';

// overpass.private.coffee was dropped (Nov 2026): it stopped answering and
// every request to it hung until the fetch timeout. overpass-api.de often
// reports "at capacity" (instant 502), so a retry pauses before trying again.
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
];

async function fetchWithRetry(
  body: string,
  retries: number = 2,
): Promise<Response> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const url = OVERPASS_ENDPOINTS[attempt % OVERPASS_ENDPOINTS.length];
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), OVERPASS_FETCH_TIMEOUT_MS);
    let response: Response;
    try {
      const headers = new Headers({ 'Content-Type': 'application/x-www-form-urlencoded' });
      headers.set('User-Agent', OVERPASS_USER_AGENT);
      response = await fetch(url, { method: 'POST', headers, body, signal: controller.signal });
    } catch (err: any) {
      clearTimeout(timeoutHandle);
      if (err?.name === 'AbortError') {
        throw new Error(`Overpass request timed out after ${OVERPASS_FETCH_TIMEOUT_MS}ms`);
      }
      // Network error: retry once more if attempts remain.
      if (attempt === retries) throw err;
      continue;
    }
    clearTimeout(timeoutHandle);

    if (response.ok) return response;

    // Retry for rate limits and transient gateway
    // errors, but not for other errors (e.g. 4xx query syntax problems).
    const retryable =
      response.status === 429 ||
      response.status === 502 ||
      response.status === 503 ||
      response.status === 504;
    if (!retryable || attempt === retries) {
      throw new Error(`Overpass API error: ${response.status} ${response.statusText} (${new URL(url).host})`);
    }

    // Back off before the next attempt; capacity 502s and 429s both clear
    // only once running queries finish.
    const delayMs = 2000 * (attempt + 1);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  // Unreachable, but satisfies TypeScript
  throw new Error('Overpass API: retries exhausted');
}

/**
 * Find the most relevant enclosing venue for a given point (e.g. the airport
 * that contains a terminal). Uses the Overpass `is_in` operator for true
 * spatial containment rather than radius-based proximity.
 */
export async function findEnclosingVenue(
  lat: number,
  lon: number,
  excludeOsmId: string,
): Promise<EnclosingVenueResult | null> {
  // Check cache
  const key = `enclosing|${lat.toFixed(4)},${lon.toFixed(4)}`;
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) {
    const results = cached.data as OverpassElement[];
    return pickBestEnclosing(results, excludeOsmId);
  }

  const placeFilter = buildPlaceFilter();

  const overpassQuery = `
    [out:json][timeout:30];
    is_in(${lat},${lon})->.enclosing;
    (
      way(pivot.enclosing)${placeFilter}["name"];
      relation(pivot.enclosing)${placeFilter}["name"];
    );
    out center;
  `;

  try {
    const response = await fetchWithRetry(`data=${encodeURIComponent(overpassQuery)}`, 1); // fewer retries — this is a secondary lookup

    const data = (await response.json()) as { elements: OverpassElement[] };
    cache.set(key, { data: data.elements, expires: Date.now() + CACHE_TTL_MS });
    return pickBestEnclosing(data.elements, excludeOsmId);
  } catch {
    // Non-fatal — we just won't link a parent
    return null;
  }
}

function pickBestEnclosing(
  elements: OverpassElement[],
  excludeOsmId: string,
): EnclosingVenueResult | null {
  let best: { result: EnclosingVenueResult; priority: number } | null = null;

  for (const el of elements) {
    const tags = el.tags || {};
    if (!tags.name) continue;

    const osmId = `${el.type}/${el.id}`;
    if (osmId === excludeOsmId) continue;

    const categoryValue = getPrimaryCategoryValue(tags);
    if (!categoryValue) continue;

    const category = formatOsmTagValue(categoryValue);
    const priority = getParentPriority(tags);

    const latitude = el.lat ?? el.center?.lat;
    const longitude = el.lon ?? el.center?.lon;
    if (latitude === undefined || longitude === undefined) continue;

    if (!best || priority > best.priority) {
      best = {
        result: {
          name: tags.name,
          category,
          latitude,
          longitude,
          address: buildAddress(tags),
          osm_id: osmId,
        },
        priority,
      };
    }
  }

  return best?.result ?? null;
}

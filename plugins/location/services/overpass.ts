interface OverpassElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

export interface OSMVenueResult {
  name: string;
  category: string;
  latitude: number;
  longitude: number;
  address: string | null;
  osm_id: string;
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

// Nearby searches scan a large area with `around:`, so drop the two heaviest
// tag classes (individual buildings and natural features) to keep the query
// cheap. The `is_in` enclosing-venue lookup only evaluates the handful of
// elements that actually contain the point, so it keeps the full list.
const NEARBY_TAG_KEYS = PLACE_TAG_KEYS.filter(
  (key) => key !== 'building' && key !== 'natural',
) as (typeof PLACE_TAG_KEYS)[number][];

const GENERIC_CATEGORY_VALUES = new Set(['yes']);
const MIN_NEARBY_SEARCH_RADIUS_METERS = 5000;
const QUERY_SEARCH_RADIUS_METERS = 5000;
const SEARCHABLE_NAME_KEY_PATTERN = '^(name|official_name|brand|short_name|alt_name|operator)$';

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

function getVenueCategory(tags: Record<string, string>): string {
  const categoryValue = getPrimaryCategoryValue(tags);
  return categoryValue ? formatOsmTagValue(categoryValue) : 'Place';
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

function escapeOverpassRegex(value: string): string {
  return value
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/"/g, '\\"');
}

function getVenueDisplayName(tags: Record<string, string>): string | null {
  const candidates = [
    tags.name,
    tags.official_name,
    tags.brand,
    tags.short_name,
    tags.alt_name,
    tags.operator,
  ];

  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (trimmed) return trimmed;
  }

  return null;
}

function buildNameFilter(query?: string): string {
  if (!query) return '[name]';
  return `[~"${SEARCHABLE_NAME_KEY_PATTERN}"~"${escapeOverpassRegex(query)}",i]`;
}

function getSearchRadius(radius: number, query?: string): number {
  if (query) {
    return Math.max(radius, QUERY_SEARCH_RADIUS_METERS);
  }
  return Math.max(radius, MIN_NEARBY_SEARCH_RADIUS_METERS);
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

async function fetchNearbyOverpassVenues(
  lat: number,
  lon: number,
  radius: number,
  query?: string,
): Promise<OSMVenueResult[]> {
  const placeFilter = buildPlaceFilter(NEARBY_TAG_KEYS);
  const nameFilter = buildNameFilter(query);
  const searchRadius = getSearchRadius(radius, query);

  const overpassQuery = `
    [out:json][timeout:30];
    nwr${placeFilter}${nameFilter}(around:${searchRadius},${lat},${lon});
    out center;
  `;

  const response = await fetchWithRetry(`data=${encodeURIComponent(overpassQuery)}`);

  const data = (await response.json()) as { elements: OverpassElement[] };
  const deduped = new Map<string, OSMVenueResult>();

  for (const element of data.elements) {
    const tags = element.tags || {};
    const name = getVenueDisplayName(tags);
    if (!name) continue;

    const latitude = element.lat ?? element.center?.lat;
    const longitude = element.lon ?? element.center?.lon;

    if (latitude === undefined || longitude === undefined) continue;

    const osmId = `${element.type}/${element.id}`;
    if (deduped.has(osmId)) continue;

    deduped.set(osmId, {
      name,
      category: getVenueCategory(tags),
      latitude,
      longitude,
      address: buildAddress(tags),
      osm_id: osmId,
    });
  }

  return Array.from(deduped.values());
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

function cacheKey(lat: number, lon: number, query: string | undefined, radius: number): string {
  // Round coordinates to ~111 m precision so nearby requests share cache entries
  const rlat = (Math.round(lat * 1000) / 1000).toFixed(3);
  const rlon = (Math.round(lon * 1000) / 1000).toFixed(3);
  return `${rlat},${rlon}|${radius}|${(query || '').toLowerCase()}`;
}

// Overpass queries can legitimately take up to their [timeout:30] server-side
// limit; give the socket a generous margin so a hung connection can't wedge a
// backfill job forever.
const OVERPASS_FETCH_TIMEOUT_MS = 60000;

// overpass-api.de rejects requests without a proper User-Agent (406 Not
// Acceptable). Node's global fetch sends "undici" by default, which their
// edge blocks, so set one explicitly on every request.
const OVERPASS_USER_AGENT = 'WhereWeWere/1.0 (self-hosted checkin app)';

// 504s are usually per-instance load, not a bad query. Rotating to a
// different mirror on failure is far more effective than hammering the same
// server, so each retry attempt moves to the next endpoint in the list.
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
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
      // Network error talking to this mirror — try the next one without
      // waiting; the others are likely healthy.
      if (attempt === retries) throw err;
      continue;
    }
    clearTimeout(timeoutHandle);

    if (response.ok) return response;

    // Retry (on the next mirror) for rate limits and transient gateway
    // errors, but not for other errors (e.g. 4xx query syntax problems).
    const retryable =
      response.status === 429 ||
      response.status === 502 ||
      response.status === 503 ||
      response.status === 504;
    if (!retryable || attempt === retries) {
      throw new Error(`Overpass API error: ${response.status} ${response.statusText} (${new URL(url).host})`);
    }

    // Be gentler on 429; only a brief pause otherwise so the next mirror
    // isn't hit in the same instant.
    const delayMs = response.status === 429 ? 1000 * (attempt + 1) * 2 : 1000;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  // Unreachable, but satisfies TypeScript
  throw new Error('Overpass API: retries exhausted');
}

export async function searchNearbyVenues(
  lat: number,
  lon: number,
  query?: string,
  radius: number = 500,
): Promise<OSMVenueResult[]> {
  // Check cache first
  const key = cacheKey(lat, lon, query, radius);
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) {
    return cached.data as OSMVenueResult[];
  }

  const results = await fetchNearbyOverpassVenues(lat, lon, radius, query);

  // Store in cache
  cache.set(key, { data: results, expires: Date.now() + CACHE_TTL_MS });

  // Evict expired entries periodically (keep map from growing unbounded)
  if (cache.size > 100) {
    const now = Date.now();
    for (const [k, v] of cache) {
      if (v.expires < now) cache.delete(k);
    }
  }

  return results;
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
      way.enclosing${placeFilter}["name"];
      relation.enclosing${placeFilter}["name"];
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

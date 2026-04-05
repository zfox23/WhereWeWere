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
  'railway',
  'building',
  'office',
  'public_transport',
] as const;
const PLACE_TAG_KEY_PATTERN = `^(${PLACE_TAG_KEYS.join('|')})$`;
const GENERIC_CATEGORY_VALUES = new Set(['yes']);
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
  return query ? Math.max(radius, QUERY_SEARCH_RADIUS_METERS) : radius;
}

function buildPlaceFilter(): string {
  return `[~"${PLACE_TAG_KEY_PATTERN}"~"."]`;
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
  const placeFilter = buildPlaceFilter();
  const nameFilter = buildNameFilter(query);
  const searchRadius = getSearchRadius(radius, query);

  const overpassQuery = `
    [out:json][timeout:15];
    nwr${placeFilter}${nameFilter}(around:${searchRadius},${lat},${lon});
    out center;
  `;

  const url = 'https://overpass-api.de/api/interpreter';
  const requestBody = `data=${encodeURIComponent(overpassQuery)}`;

  const response = await fetchWithRetry(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: requestBody,
  });

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

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  retries: number = 2,
): Promise<Response> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const response = await fetch(url, init);

    if (response.ok) return response;

    // Retry on 429 (rate limit) or 504 (gateway timeout), but not on other errors
    const retryable = response.status === 429 || response.status === 504;
    if (!retryable || attempt === retries) {
      throw new Error(`Overpass API error: ${response.status} ${response.statusText}`);
    }

    // Exponential backoff: 1 s, then 3 s
    const delayMs = response.status === 429 ? 1000 * (attempt + 1) * 2 : 1000 * (attempt + 1);
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
    [out:json][timeout:15];
    is_in(${lat},${lon})->.enclosing;
    (
      way.enclosing${placeFilter}["name"];
      relation.enclosing${placeFilter}["name"];
    );
    out center;
  `;

  try {
    const response = await fetchWithRetry(
      'https://overpass-api.de/api/interpreter',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(overpassQuery)}`,
      },
      1, // fewer retries — this is a secondary lookup
    );

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

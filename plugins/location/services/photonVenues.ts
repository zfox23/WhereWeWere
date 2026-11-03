import { config } from '../../../server/src/config';

/**
 * OSM venue search backed by Photon (PHOTON_URL).
 *
 * This used to run Overpass queries, which never worked reliably for
 * interactive search: the public overpass-api.de instance only grants two
 * query slots per IP and is often "at capacity" (instant 502). The fallback
 * mirror stopped answering at all, and the regex-key queries we needed took
 * 20–60 s even when a slot was free. Every search ran into the 60 s fetch
 * timeout, and the route swallowed the error, so the UI showed "no results".
 *
 * Photon indexes the same OSM data and answers in well under a second:
 *   - nearby (no query): /reverse with a radius and place-tag filters, sorted by distance
 *   - named:             /api?q= with a bounding box around the user
 * It returns OSM type/id and the primary key/value. Results keep the same
 * shape (osm_id "node/123", formatted category) so local-DB dedupe and
 * /import-osm work unchanged.
 */

export interface OSMVenueResult {
  name: string;
  category: string;
  latitude: number;
  longitude: number;
  address: string | null;
  osm_id: string;
}

interface PhotonFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    name?: string;
    osm_type?: string;
    osm_id?: number;
    osm_key?: string;
    osm_value?: string;
    housenumber?: string;
    street?: string;
    city?: string;
    state?: string;
    postcode?: string;
  };
}

// Same place classes the Overpass search used. `building` and `natural` stay
// out: they'd flood nearby results with named apartment blocks and terrain.
// Photon ORs repeated osm_tag filters ("key" or "key:value").
const PLACE_OSM_TAGS = [
  'amenity',
  'shop',
  'tourism',
  'leisure',
  'aeroway',
  'railway',
  'office',
  'public_transport',
  'historic',
  'man_made',
  'highway:rest_area',
  'highway:services',
];

const MIN_NEARBY_SEARCH_RADIUS_METERS = 2500;
const QUERY_SEARCH_RADIUS_METERS = 5000;
// Photon caps a response at 50 features.
const PHOTON_RESULT_LIMIT = 50;
// A cold Photon cache can take a few seconds for a first query; stay well
// under anything the client would notice as "hung".
const PHOTON_TIMEOUT_MS = 10_000;

const OSM_TYPE_NAMES: Record<string, string> = { N: 'node', W: 'way', R: 'relation' };

export function formatOsmTagValue(value: string): string {
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function buildAddress(props: NonNullable<PhotonFeature['properties']>): string | null {
  // Same "street, city, state, postcode" layout as before; /import-osm splits
  // it on commas.
  const parts: string[] = [];
  if (props.housenumber && props.street) {
    parts.push(`${props.housenumber} ${props.street}`);
  } else if (props.street) {
    parts.push(props.street);
  }
  if (props.city) parts.push(props.city);
  if (props.state) parts.push(props.state);
  if (props.postcode) parts.push(props.postcode);
  return parts.length > 0 ? parts.join(', ') : null;
}

/** Map one Photon feature to a venue result, or null if it isn't usable. Exported for tests. */
export function photonFeatureToVenue(feature: PhotonFeature): OSMVenueResult | null {
  const props = feature.properties;
  const name = props?.name?.trim();
  const osmType = props?.osm_type ? OSM_TYPE_NAMES[props.osm_type] : undefined;
  if (!props || !name || !osmType || props.osm_id == null) return null;

  const [longitude, latitude] = feature.geometry?.coordinates ?? [];
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  const tagValue = props.osm_value && props.osm_value !== 'yes' ? props.osm_value : props.osm_key;

  return {
    name,
    category: tagValue ? formatOsmTagValue(tagValue) : 'Place',
    latitude: latitude as number,
    longitude: longitude as number,
    address: buildAddress(props),
    osm_id: `${osmType}/${props.osm_id}`,
  };
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Search radius actually used. Exported for tests. */
export function getSearchRadius(radius: number, query?: string): number {
  return Math.max(radius, query ? QUERY_SEARCH_RADIUS_METERS : MIN_NEARBY_SEARCH_RADIUS_METERS);
}

/** Build the Photon request URL for a nearby or named search. Exported for tests. */
export function buildPhotonVenueUrl(
  base: string,
  lat: number,
  lon: number,
  radiusMeters: number,
  query?: string,
): string {
  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
    limit: String(PHOTON_RESULT_LIMIT),
  });
  for (const tag of PLACE_OSM_TAGS) params.append('osm_tag', tag);

  if (!query) {
    params.set('radius', String(radiusMeters / 1000)); // Photon wants km
    return `${base}/reverse?${params.toString()}`;
  }

  // Named search: a bbox makes Photon search only the local area. Without one
  // it ranks globally (slow, and far-away matches can crowd out local ones).
  const latDelta = radiusMeters / 111320;
  const lonDelta = radiusMeters / (111320 * Math.max(Math.cos((lat * Math.PI) / 180), 0.01));
  params.set('q', query);
  params.set(
    'bbox',
    [lon - lonDelta, lat - latDelta, lon + lonDelta, lat + latDelta]
      .map((n) => n.toFixed(6))
      .join(','),
  );
  return `${base}/api?${params.toString()}`;
}

async function fetchPhotonVenues(
  lat: number,
  lon: number,
  radius: number,
  query?: string,
): Promise<OSMVenueResult[]> {
  const searchRadius = getSearchRadius(radius, query);
  const url = buildPhotonVenueUrl(config.photonUrl, lat, lon, searchRadius, query);

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { 'User-Agent': 'WhereWeWere/1.0 (self-hosted checkin app)' },
      signal: AbortSignal.timeout(PHOTON_TIMEOUT_MS),
    });
  } catch (err: any) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      throw new Error(`Photon venue search timed out after ${PHOTON_TIMEOUT_MS}ms (${config.photonUrl})`);
    }
    throw new Error(`Photon venue search failed (${config.photonUrl}): ${err?.cause?.code ?? err?.message ?? err}`);
  }
  if (!response.ok) {
    throw new Error(`Photon venue search error: ${response.status} ${response.statusText} (${config.photonUrl})`);
  }

  const data = (await response.json()) as { features?: PhotonFeature[] };
  const deduped = new Map<string, OSMVenueResult>();
  for (const feature of data.features ?? []) {
    const venue = photonFeatureToVenue(feature);
    if (!venue || deduped.has(venue.osm_id)) continue;
    // The bbox is a square; keep named results inside the search circle.
    if (haversineMeters(lat, lon, venue.latitude, venue.longitude) > searchRadius) continue;
    deduped.set(venue.osm_id, venue);
  }
  return Array.from(deduped.values());
}

// --- In-memory cache ---
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { data: OSMVenueResult[]; expires: number }>();

function cacheKey(lat: number, lon: number, query: string | undefined, radius: number): string {
  // Round coordinates to ~111 m precision so nearby requests share cache entries
  const rlat = (Math.round(lat * 1000) / 1000).toFixed(3);
  const rlon = (Math.round(lon * 1000) / 1000).toFixed(3);
  return `${rlat},${rlon}|${radius}|${(query || '').toLowerCase()}`;
}

/** Test helper: forget cached searches. */
export function clearVenueSearchCache(): void {
  cache.clear();
}

/**
 * OSM venues near a point, optionally matching a name. Throws if Photon is
 * unreachable or errors, so callers can tell "no venues" from "search failed".
 */
export async function searchNearbyVenues(
  lat: number,
  lon: number,
  query?: string,
  radius: number = 500,
): Promise<OSMVenueResult[]> {
  const key = cacheKey(lat, lon, query, radius);
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return cached.data;

  const results = await fetchPhotonVenues(lat, lon, radius, query);

  cache.set(key, { data: results, expires: Date.now() + CACHE_TTL_MS });
  if (cache.size > 100) {
    const now = Date.now();
    for (const [k, v] of cache) {
      if (v.expires < now) cache.delete(k);
    }
  }
  return results;
}

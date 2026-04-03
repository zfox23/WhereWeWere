import { query } from '../db';

interface Queryable {
  query: (text: string, params?: any[]) => Promise<any>;
}

export interface VenueCandidate {
  name: string;
  latitude: number;
  longitude: number;
  category_id?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  postal_code?: string | null;
  osm_id?: string | null;
  swarm_venue_id?: string | null;
  parent_venue_id?: string | null;
}

export interface VenueRecord {
  id: string;
  name: string;
  category_id: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  postal_code: string | null;
  latitude: number;
  longitude: number;
  osm_id: string | null;
  swarm_venue_id: string | null;
  parent_venue_id: string | null;
  created_at: string;
  checkin_count: number;
}

export interface VenueSimilarity {
  isMatch: boolean;
  score: number;
  distanceMeters: number;
  reason: string;
}

const GENERIC_VENUE_TOKENS = new Set([
  'and',
  'at',
  'company',
  'corp',
  'corporation',
  'grocery',
  'inc',
  'llc',
  'market',
  'markets',
  'shop',
  'store',
  'stores',
  'supercenter',
  'supercentre',
  'supermarket',
  'the',
]);

const DEFAULT_AUTO_MATCH_RADIUS_METERS = 120;

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function tokenizeVenueName(name: string, stripGenericTokens: boolean): string[] {
  const normalized = normalizeWhitespace(
    name
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/'/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
  );

  const tokens = normalized.split(' ').filter(Boolean);
  if (!stripGenericTokens) {
    return tokens;
  }

  const filtered = tokens.filter((token) => !GENERIC_VENUE_TOKENS.has(token));
  return filtered.length > 0 ? filtered : tokens;
}

function normalizedSemanticName(name: string): string {
  return tokenizeVenueName(name, true).join(' ');
}

function normalizedCompactName(name: string): string {
  return tokenizeVenueName(name, true).join('');
}

function uniqueTokens(name: string): string[] {
  return Array.from(new Set(tokenizeVenueName(name, true)));
}

function jaccardSimilarity(a: string[], b: string[]): number {
  const aSet = new Set(a);
  const bSet = new Set(b);
  let intersection = 0;

  for (const token of aSet) {
    if (bSet.has(token)) {
      intersection += 1;
    }
  }

  const union = new Set([...aSet, ...bSet]).size;
  return union === 0 ? 0 : intersection / union;
}

function isSubsetMatch(a: string[], b: string[]): boolean {
  const smaller = a.length <= b.length ? a : b;
  const larger = a.length <= b.length ? b : a;

  if (smaller.length < 2) {
    return false;
  }

  const largerSet = new Set(larger);
  return smaller.every((token) => largerSet.has(token));
}

function coordinateToNumber(value: unknown): number {
  return typeof value === 'number' ? value : Number(value);
}

export function calculateDistanceMeters(
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number
): number {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const earthRadiusMeters = 6371000;

  const dLat = toRadians(latitudeB - latitudeA);
  const dLon = toRadians(longitudeB - longitudeA);
  const lat1 = toRadians(latitudeA);
  const lat2 = toRadians(latitudeB);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return earthRadiusMeters * c;
}

function scoreNameSimilarity(leftName: string, rightName: string): { score: number; reason: string } {
  const leftSemantic = normalizedSemanticName(leftName);
  const rightSemantic = normalizedSemanticName(rightName);

  if (leftSemantic.length > 0 && leftSemantic === rightSemantic) {
    return { score: 1, reason: 'normalized-name-match' };
  }

  const leftCompact = normalizedCompactName(leftName);
  const rightCompact = normalizedCompactName(rightName);

  if (
    leftCompact.length >= 8 &&
    rightCompact.length >= 8 &&
    (leftCompact.includes(rightCompact) || rightCompact.includes(leftCompact))
  ) {
    return { score: 0.94, reason: 'name-contains-match' };
  }

  const leftTokens = uniqueTokens(leftName);
  const rightTokens = uniqueTokens(rightName);

  if (isSubsetMatch(leftTokens, rightTokens)) {
    return { score: 0.91, reason: 'token-subset-match' };
  }

  const overlap = jaccardSimilarity(leftTokens, rightTokens);
  if (overlap >= 0.8) {
    return { score: overlap, reason: 'token-overlap-match' };
  }

  return { score: overlap, reason: 'low-name-similarity' };
}

export function areVenuesSimilar(
  left: Pick<VenueCandidate, 'name' | 'latitude' | 'longitude' | 'osm_id' | 'swarm_venue_id'>,
  right: Pick<VenueCandidate, 'name' | 'latitude' | 'longitude' | 'osm_id' | 'swarm_venue_id'>,
  maxDistanceMeters = DEFAULT_AUTO_MATCH_RADIUS_METERS
): VenueSimilarity {
  const distanceMeters = calculateDistanceMeters(
    coordinateToNumber(left.latitude),
    coordinateToNumber(left.longitude),
    coordinateToNumber(right.latitude),
    coordinateToNumber(right.longitude)
  );

  if (left.swarm_venue_id && right.swarm_venue_id && left.swarm_venue_id === right.swarm_venue_id) {
    return {
      isMatch: true,
      score: 1,
      distanceMeters,
      reason: 'matching-swarm-venue-id',
    };
  }

  if (left.osm_id && right.osm_id && left.osm_id === right.osm_id) {
    return {
      isMatch: true,
      score: 1,
      distanceMeters,
      reason: 'matching-osm-id',
    };
  }

  if (distanceMeters > maxDistanceMeters) {
    return {
      isMatch: false,
      score: 0,
      distanceMeters,
      reason: 'distance-too-large',
    };
  }

  const nameSimilarity = scoreNameSimilarity(left.name, right.name);
  const strongNameMatch = nameSimilarity.score >= 0.9;
  const goodNameMatch = nameSimilarity.score >= 0.8 && distanceMeters <= 90;

  return {
    isMatch: strongNameMatch || goodNameMatch,
    score: nameSimilarity.score,
    distanceMeters,
    reason: nameSimilarity.reason,
  };
}

function mapVenueRow(row: any): VenueRecord {
  return {
    ...row,
    latitude: coordinateToNumber(row.latitude),
    longitude: coordinateToNumber(row.longitude),
    checkin_count: Number(row.checkin_count || 0),
  };
}

async function loadVenueById(client: Queryable, venueId: string): Promise<VenueRecord | null> {
  const result = await client.query(
    `SELECT v.id, v.name, v.category_id, v.address, v.city, v.state, v.country,
            v.postal_code, v.latitude, v.longitude, v.osm_id, v.swarm_venue_id,
            v.parent_venue_id, v.created_at, COUNT(c.id)::int AS checkin_count
     FROM venues v
     LEFT JOIN checkins c ON c.venue_id = v.id
     WHERE v.id = $1
     GROUP BY v.id`,
    [venueId]
  );

  return result.rows.length > 0 ? mapVenueRow(result.rows[0]) : null;
}

async function updateVenueMetadataFromCandidate(
  client: Queryable,
  venueId: string,
  candidate: VenueCandidate
): Promise<VenueRecord> {
  const result = await client.query(
    `UPDATE venues
     SET category_id = COALESCE(category_id, $2),
         address = COALESCE(NULLIF(TRIM(address), ''), $3),
         city = COALESCE(NULLIF(TRIM(city), ''), $4),
         state = COALESCE(NULLIF(TRIM(state), ''), $5),
         country = COALESCE(NULLIF(TRIM(country), ''), $6),
         postal_code = COALESCE(NULLIF(TRIM(postal_code), ''), $7),
         osm_id = COALESCE(osm_id, $8),
         swarm_venue_id = COALESCE(swarm_venue_id, $9),
         parent_venue_id = CASE
           WHEN parent_venue_id IS NULL AND $10 IS NOT NULL AND $10 <> id THEN $10
           ELSE parent_venue_id
         END,
         updated_at = NOW()
     WHERE id = $1
     RETURNING id`,
    [
      venueId,
      candidate.category_id || null,
      candidate.address || null,
      candidate.city || null,
      candidate.state || null,
      candidate.country || null,
      candidate.postal_code || null,
      candidate.osm_id || null,
      candidate.swarm_venue_id || null,
      candidate.parent_venue_id || null,
    ]
  );

  return mapVenueRow((await loadVenueById(client, result.rows[0].id)) as VenueRecord);
}

export async function findBestVenueMatch(
  candidate: VenueCandidate,
  options: {
    excludeVenueId?: string;
    client?: Queryable;
    maxDistanceMeters?: number;
    limit?: number;
  } = {}
): Promise<VenueRecord | null> {
  const client = options.client || { query };

  if (candidate.swarm_venue_id) {
    const result = await client.query(
      `SELECT v.id
       FROM venues v
       WHERE v.swarm_venue_id = $1
         AND ($2::uuid IS NULL OR v.id <> $2)
       LIMIT 1`,
      [candidate.swarm_venue_id, options.excludeVenueId || null]
    );
    if (result.rows.length > 0) {
      return loadVenueById(client, result.rows[0].id);
    }
  }

  if (candidate.osm_id) {
    const result = await client.query(
      `SELECT v.id
       FROM venues v
       WHERE v.osm_id = $1
         AND ($2::uuid IS NULL OR v.id <> $2)
       LIMIT 1`,
      [candidate.osm_id, options.excludeVenueId || null]
    );
    if (result.rows.length > 0) {
      return loadVenueById(client, result.rows[0].id);
    }
  }

  const maxDistanceMeters = options.maxDistanceMeters || DEFAULT_AUTO_MATCH_RADIUS_METERS;
  const limit = options.limit || 20;
  const nearby = await client.query(
    `SELECT v.id, v.name, v.category_id, v.address, v.city, v.state, v.country,
            v.postal_code, v.latitude, v.longitude, v.osm_id, v.swarm_venue_id,
            v.parent_venue_id, v.created_at, COUNT(c.id)::int AS checkin_count,
            (6371000 * acos(
              LEAST(1.0, GREATEST(-1.0,
                cos(radians($1)) * cos(radians(v.latitude)) *
                cos(radians(v.longitude) - radians($2)) +
                sin(radians($1)) * sin(radians(v.latitude))
              ))
            )) AS distance_meters
     FROM venues v
     LEFT JOIN checkins c ON c.venue_id = v.id
     WHERE ($3::uuid IS NULL OR v.id <> $3)
     GROUP BY v.id
     HAVING (6371000 * acos(
              LEAST(1.0, GREATEST(-1.0,
                cos(radians($1)) * cos(radians(v.latitude)) *
                cos(radians(v.longitude) - radians($2)) +
                sin(radians($1)) * sin(radians(v.latitude))
              ))
            )) <= $4
     ORDER BY distance_meters ASC, checkin_count DESC, v.created_at ASC
     LIMIT $5`,
    [candidate.latitude, candidate.longitude, options.excludeVenueId || null, maxDistanceMeters, limit]
  );

  let bestMatch: VenueRecord | null = null;
  let bestScore = 0;

  for (const row of nearby.rows) {
    const venue = mapVenueRow(row);
    const similarity = areVenuesSimilar(candidate, venue, maxDistanceMeters);
    if (!similarity.isMatch) {
      continue;
    }

    const compositeScore = similarity.score * 1000 - similarity.distanceMeters + venue.checkin_count;
    if (compositeScore > bestScore) {
      bestScore = compositeScore;
      bestMatch = venue;
    }
  }

  return bestMatch;
}

export async function findOrReuseVenue(candidate: VenueCandidate): Promise<VenueRecord> {
  const existing = await findBestVenueMatch(candidate);
  if (existing) {
    return updateVenueMetadataFromCandidate({ query }, existing.id, candidate);
  }

  const insertResult = await query(
    `INSERT INTO venues (name, category_id, address, city, state, country,
                         postal_code, latitude, longitude, osm_id, swarm_venue_id, parent_venue_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING id`,
    [
      candidate.name,
      candidate.category_id || null,
      candidate.address || null,
      candidate.city || null,
      candidate.state || null,
      candidate.country || null,
      candidate.postal_code || null,
      candidate.latitude,
      candidate.longitude,
      candidate.osm_id || null,
      candidate.swarm_venue_id || null,
      candidate.parent_venue_id || null,
    ]
  );

  return mapVenueRow((await loadVenueById({ query }, insertResult.rows[0].id)) as VenueRecord);
}
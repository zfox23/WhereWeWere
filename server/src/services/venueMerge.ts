import { PoolClient } from 'pg';
import { pool, query } from '../db';

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

export interface VenueMergeResult {
  merged: boolean;
  canonicalVenueId: string;
  duplicateVenueId: string;
  movedCheckins: number;
}

export type VenueMergeSuggestionStatus = 'pending' | 'denied' | 'applied' | 'invalid';

export interface VenueMergeProposal {
  venueAId: string;
  venueBId: string;
  canonicalVenue: VenueRecord;
  duplicateVenue: VenueRecord;
  similarityScore: number;
  distanceMeters: number;
  reason: string;
}

export interface VenueMergeSuggestion {
  id: string;
  status: VenueMergeSuggestionStatus;
  similarity_score: number;
  distance_meters: number;
  reason: string;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  canonical_venue: {
    id: string | null;
    name: string;
    address: string | null;
    city: string | null;
    state: string | null;
    latitude: number | null;
    longitude: number | null;
    checkin_count: number;
  };
  duplicate_venue: {
    id: string | null;
    name: string;
    address: string | null;
    city: string | null;
    state: string | null;
    latitude: number | null;
    longitude: number | null;
    checkin_count: number;
  };
}

export interface VenueMergeSuggestionResolution {
  id: string;
  status: VenueMergeSuggestionStatus;
  movedCheckins: number;
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
const DEFAULT_JOB_MATCH_RADIUS_METERS = 150;

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

function metadataRichness(venue: VenueRecord): number {
  return [
    venue.category_id,
    venue.address,
    venue.city,
    venue.state,
    venue.country,
    venue.postal_code,
    venue.osm_id,
    venue.swarm_venue_id,
    venue.parent_venue_id,
  ].filter(Boolean).length;
}

export function chooseCanonicalVenue(venues: VenueRecord[]): VenueRecord {
  return [...venues].sort((left, right) => {
    const leftExternalIds = Number(Boolean(left.swarm_venue_id)) + Number(Boolean(left.osm_id));
    const rightExternalIds = Number(Boolean(right.swarm_venue_id)) + Number(Boolean(right.osm_id));
    if (rightExternalIds !== leftExternalIds) {
      return rightExternalIds - leftExternalIds;
    }

    if (right.checkin_count !== left.checkin_count) {
      return right.checkin_count - left.checkin_count;
    }

    const leftRichness = metadataRichness(left);
    const rightRichness = metadataRichness(right);
    if (rightRichness !== leftRichness) {
      return rightRichness - leftRichness;
    }

    return new Date(left.created_at).getTime() - new Date(right.created_at).getTime();
  })[0];
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

export async function mergeVenuePair(
  canonicalVenueId: string,
  duplicateVenueId: string,
  client?: PoolClient
): Promise<VenueMergeResult> {
  if (canonicalVenueId === duplicateVenueId) {
    return {
      merged: false,
      canonicalVenueId,
      duplicateVenueId,
      movedCheckins: 0,
    };
  }

  const ownsClient = !client;
  const dbClient = client || (await pool.connect());

  try {
    if (ownsClient) {
      await dbClient.query('BEGIN');
    }

    const canonical = await loadVenueById(dbClient, canonicalVenueId);
    const duplicate = await loadVenueById(dbClient, duplicateVenueId);

    if (!canonical || !duplicate) {
      if (ownsClient) {
        await dbClient.query('ROLLBACK');
      }
      return {
        merged: false,
        canonicalVenueId,
        duplicateVenueId,
        movedCheckins: 0,
      };
    }

    const nextParentVenueId =
      canonical.parent_venue_id && canonical.parent_venue_id !== duplicate.id
        ? canonical.parent_venue_id
        : duplicate.parent_venue_id && duplicate.parent_venue_id !== canonical.id
          ? duplicate.parent_venue_id
          : null;

    await dbClient.query(
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
       WHERE id = $1`,
      [
        canonical.id,
        duplicate.category_id,
        duplicate.address,
        duplicate.city,
        duplicate.state,
        duplicate.country,
        duplicate.postal_code,
        duplicate.osm_id,
        duplicate.swarm_venue_id,
        nextParentVenueId,
      ]
    );

    await dbClient.query(
      `UPDATE venues
       SET parent_venue_id = $1
       WHERE parent_venue_id = $2
         AND id <> $1`,
      [canonical.id, duplicate.id]
    );

    const movedCheckinsResult = await dbClient.query(
      `UPDATE checkins
       SET venue_id = $1,
           updated_at = NOW()
       WHERE venue_id = $2`,
      [canonical.id, duplicate.id]
    );

    await dbClient.query('DELETE FROM venues WHERE id = $1', [duplicate.id]);

    if (ownsClient) {
      await dbClient.query('COMMIT');
    }

    return {
      merged: true,
      canonicalVenueId: canonical.id,
      duplicateVenueId: duplicate.id,
      movedCheckins: movedCheckinsResult.rowCount || 0,
    };
  } catch (err) {
    if (ownsClient) {
      await dbClient.query('ROLLBACK');
    }
    throw err;
  } finally {
    if (ownsClient) {
      dbClient.release();
    }
  }
}

export async function listVenuesForMerge(): Promise<VenueRecord[]> {
  const result = await query(
    `SELECT v.id, v.name, v.category_id, v.address, v.city, v.state, v.country,
            v.postal_code, v.latitude, v.longitude, v.osm_id, v.swarm_venue_id,
            v.parent_venue_id, v.created_at, COUNT(c.id)::int AS checkin_count
     FROM venues v
     LEFT JOIN checkins c ON c.venue_id = v.id
     GROUP BY v.id
     ORDER BY v.created_at ASC`
  );

  return result.rows.map(mapVenueRow);
}

function pairVenueIds(leftVenueId: string, rightVenueId: string): [string, string] {
  return leftVenueId < rightVenueId
    ? [leftVenueId, rightVenueId]
    : [rightVenueId, leftVenueId];
}

function mapSuggestionRow(row: any): VenueMergeSuggestion {
  return {
    id: row.id,
    status: row.status,
    similarity_score: Number(row.similarity_score),
    distance_meters: Number(row.distance_meters),
    reason: row.reason,
    created_at: row.created_at,
    updated_at: row.updated_at,
    resolved_at: row.resolved_at,
    canonical_venue: {
      id: row.canonical_venue_id,
      name: row.canonical_name,
      address: row.canonical_address,
      city: row.canonical_city,
      state: row.canonical_state,
      latitude: row.canonical_latitude == null ? null : Number(row.canonical_latitude),
      longitude: row.canonical_longitude == null ? null : Number(row.canonical_longitude),
      checkin_count: Number(row.canonical_checkin_count || 0),
    },
    duplicate_venue: {
      id: row.duplicate_venue_id,
      name: row.duplicate_name,
      address: row.duplicate_address,
      city: row.duplicate_city,
      state: row.duplicate_state,
      latitude: row.duplicate_latitude == null ? null : Number(row.duplicate_latitude),
      longitude: row.duplicate_longitude == null ? null : Number(row.duplicate_longitude),
      checkin_count: Number(row.duplicate_checkin_count || 0),
    },
  };
}

export async function findVenueMergeProposals(): Promise<{ scanned: number; proposals: VenueMergeProposal[] }> {
  const venues = await listVenuesForMerge();
  const processedVenueIds = new Set<string>();
  const proposals: VenueMergeProposal[] = [];

  for (const venue of venues) {
    if (processedVenueIds.has(venue.id)) {
      continue;
    }

    const duplicates = venues.filter((candidate) => {
      if (candidate.id === venue.id || processedVenueIds.has(candidate.id)) {
        return false;
      }

      return areVenuesSimilar(venue, candidate, venueMergeThresholds.jobMatchRadiusMeters).isMatch;
    });

    if (duplicates.length === 0) {
      continue;
    }

    const mergeGroup: VenueRecord[] = [venue, ...duplicates];
    const canonicalVenue = chooseCanonicalVenue(mergeGroup);

    processedVenueIds.add(canonicalVenue.id);

    for (const duplicateVenue of mergeGroup) {
      if (duplicateVenue.id === canonicalVenue.id) {
        continue;
      }

      const similarity = areVenuesSimilar(
        canonicalVenue,
        duplicateVenue,
        venueMergeThresholds.jobMatchRadiusMeters
      );
      const [venueAId, venueBId] = pairVenueIds(canonicalVenue.id, duplicateVenue.id);

      proposals.push({
        venueAId,
        venueBId,
        canonicalVenue,
        duplicateVenue,
        similarityScore: similarity.score,
        distanceMeters: Math.round(similarity.distanceMeters),
        reason: similarity.reason,
      });

      processedVenueIds.add(duplicateVenue.id);
    }
  }

  return { scanned: venues.length, proposals };
}

export async function storeVenueMergeProposal(
  jobId: string,
  proposal: VenueMergeProposal
): Promise<void> {
  await query(
    `INSERT INTO venue_merge_suggestions (
       venue_a_id, venue_b_id, canonical_venue_id, duplicate_venue_id,
       canonical_name, duplicate_name, canonical_checkin_count, duplicate_checkin_count,
       similarity_score, distance_meters, reason, status, job_id
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending', $12)
     ON CONFLICT (venue_a_id, venue_b_id)
     DO UPDATE SET
       canonical_venue_id = EXCLUDED.canonical_venue_id,
       duplicate_venue_id = EXCLUDED.duplicate_venue_id,
       canonical_name = EXCLUDED.canonical_name,
       duplicate_name = EXCLUDED.duplicate_name,
       canonical_checkin_count = EXCLUDED.canonical_checkin_count,
       duplicate_checkin_count = EXCLUDED.duplicate_checkin_count,
       similarity_score = EXCLUDED.similarity_score,
       distance_meters = EXCLUDED.distance_meters,
       reason = EXCLUDED.reason,
       job_id = EXCLUDED.job_id,
       status = CASE
         WHEN venue_merge_suggestions.status IN ('denied', 'applied') THEN venue_merge_suggestions.status
         ELSE 'pending'
       END,
       resolved_at = CASE
         WHEN venue_merge_suggestions.status IN ('denied', 'applied') THEN venue_merge_suggestions.resolved_at
         ELSE NULL
       END,
       updated_at = NOW()`,
    [
      proposal.venueAId,
      proposal.venueBId,
      proposal.canonicalVenue.id,
      proposal.duplicateVenue.id,
      proposal.canonicalVenue.name,
      proposal.duplicateVenue.name,
      proposal.canonicalVenue.checkin_count,
      proposal.duplicateVenue.checkin_count,
      proposal.similarityScore,
      proposal.distanceMeters,
      proposal.reason,
      jobId,
    ]
  );
}

export async function invalidateStaleVenueMergeSuggestions(jobId: string): Promise<void> {
  await query(
    `UPDATE venue_merge_suggestions
     SET status = 'invalid',
         resolved_at = COALESCE(resolved_at, NOW()),
         updated_at = NOW()
     WHERE status = 'pending'
       AND (job_id IS DISTINCT FROM $1 OR canonical_venue_id IS NULL OR duplicate_venue_id IS NULL)`,
    [jobId]
  );
}

export async function syncVenueMergeSuggestionValidity(): Promise<void> {
  await query(
    `UPDATE venue_merge_suggestions
     SET status = 'invalid',
         resolved_at = COALESCE(resolved_at, NOW()),
         updated_at = NOW()
     WHERE status = 'pending'
       AND (canonical_venue_id IS NULL OR duplicate_venue_id IS NULL OR venue_a_id IS NULL OR venue_b_id IS NULL)`
  );
}

export async function countPendingVenueMergeSuggestions(): Promise<number> {
  const result = await query(
    `SELECT COUNT(*)::int AS count
     FROM venue_merge_suggestions
     WHERE status = 'pending'`
  );

  return Number(result.rows[0]?.count || 0);
}

export async function listVenueMergeSuggestions(
  status: VenueMergeSuggestionStatus | 'all' = 'pending'
): Promise<VenueMergeSuggestion[]> {
  await syncVenueMergeSuggestionValidity();

  const params: unknown[] = [];
  const whereClause = status === 'all'
    ? ''
    : 'WHERE s.status = $1';

  if (status !== 'all') {
    params.push(status);
  }

  const result = await query(
    `SELECT s.id, s.status, s.similarity_score, s.distance_meters, s.reason,
            s.created_at, s.updated_at, s.resolved_at,
            cv.id AS canonical_venue_id,
            COALESCE(cv.name, s.canonical_name) AS canonical_name,
            cv.address AS canonical_address,
            cv.city AS canonical_city,
            cv.state AS canonical_state,
            cv.latitude AS canonical_latitude,
            cv.longitude AS canonical_longitude,
            COALESCE(cc.count, s.canonical_checkin_count)::int AS canonical_checkin_count,
            dv.id AS duplicate_venue_id,
            COALESCE(dv.name, s.duplicate_name) AS duplicate_name,
            dv.address AS duplicate_address,
            dv.city AS duplicate_city,
            dv.state AS duplicate_state,
            dv.latitude AS duplicate_latitude,
            dv.longitude AS duplicate_longitude,
            COALESCE(dc.count, s.duplicate_checkin_count)::int AS duplicate_checkin_count
     FROM venue_merge_suggestions s
     LEFT JOIN venues cv ON cv.id = s.canonical_venue_id
     LEFT JOIN venues dv ON dv.id = s.duplicate_venue_id
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS count FROM checkins WHERE venue_id = s.canonical_venue_id
     ) cc ON true
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS count FROM checkins WHERE venue_id = s.duplicate_venue_id
     ) dc ON true
     ${whereClause}
     ORDER BY CASE WHEN s.status = 'pending' THEN 0 ELSE 1 END, s.created_at DESC`,
    params
  );

  return result.rows.map(mapSuggestionRow);
}

export async function resolveVenueMergeSuggestion(
  suggestionId: string,
  action: 'approve' | 'deny'
): Promise<VenueMergeSuggestionResolution> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const suggestionResult = await client.query(
      `SELECT id, status, canonical_venue_id, duplicate_venue_id
       FROM venue_merge_suggestions
       WHERE id = $1
       FOR UPDATE`,
      [suggestionId]
    );

    if (suggestionResult.rows.length === 0) {
      throw new Error('Suggestion not found');
    }

    const suggestion = suggestionResult.rows[0];
    if (suggestion.status !== 'pending') {
      throw new Error('Suggestion is no longer pending');
    }

    if (action === 'deny') {
      await client.query(
        `UPDATE venue_merge_suggestions
         SET status = 'denied',
             resolved_at = NOW(),
             updated_at = NOW()
         WHERE id = $1`,
        [suggestionId]
      );

      await client.query('COMMIT');
      return { id: suggestionId, status: 'denied', movedCheckins: 0 };
    }

    if (!suggestion.canonical_venue_id || !suggestion.duplicate_venue_id) {
      await client.query(
        `UPDATE venue_merge_suggestions
         SET status = 'invalid',
             resolved_at = NOW(),
             updated_at = NOW()
         WHERE id = $1`,
        [suggestionId]
      );
      await client.query('COMMIT');
      return { id: suggestionId, status: 'invalid', movedCheckins: 0 };
    }

    const mergeResult = await mergeVenuePair(
      suggestion.canonical_venue_id,
      suggestion.duplicate_venue_id,
      client
    );

    if (!mergeResult.merged) {
      await client.query(
        `UPDATE venue_merge_suggestions
         SET status = 'invalid',
             resolved_at = NOW(),
             updated_at = NOW()
         WHERE id = $1`,
        [suggestionId]
      );
      await client.query('COMMIT');
      return { id: suggestionId, status: 'invalid', movedCheckins: 0 };
    }

    await client.query(
      `UPDATE venue_merge_suggestions
       SET status = 'applied',
           resolved_at = NOW(),
           updated_at = NOW()
       WHERE id = $1`,
      [suggestionId]
    );

    await client.query(
      `UPDATE venue_merge_suggestions
       SET status = 'invalid',
           resolved_at = COALESCE(resolved_at, NOW()),
           updated_at = NOW()
       WHERE status = 'pending'
         AND id <> $1
         AND (
           canonical_venue_id = $2 OR duplicate_venue_id = $2 OR
           canonical_venue_id IS NULL OR duplicate_venue_id IS NULL
         )`,
      [suggestionId, mergeResult.duplicateVenueId]
    );

    await client.query('COMMIT');
    return { id: suggestionId, status: 'applied', movedCheckins: mergeResult.movedCheckins };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export const venueMergeThresholds = {
  autoMatchRadiusMeters: DEFAULT_AUTO_MATCH_RADIUS_METERS,
  jobMatchRadiusMeters: DEFAULT_JOB_MATCH_RADIUS_METERS,
};
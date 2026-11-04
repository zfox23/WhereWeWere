/**
 * Place-based background patterns (Settings > Display > Background):
 *
 * - "My Places": the venues you check in at most around your home area, as
 *   dots sized by visit count, joined in the order you visited them.
 * - "Streets": the road network around that same area, from OpenStreetMap
 *   (Overpass), drawn as line art.
 *
 * Both render to a black-on-transparent SVG that the client uses as a CSS
 * mask over a theme color, so the pattern follows the theme. Rendered files
 * are cached per user under <dataDir>/<userId>/appearance/.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { query } from '../../../server/src/db';
import { config } from '../../../server/src/config';
import { queryOverpass } from './overpass';

export const PLACE_PATTERN_KINDS = ['myplaces', 'streets'] as const;
export type PlacePatternKind = (typeof PLACE_PATTERN_KINDS)[number];

export interface VenuePoint {
  lat: number;
  lon: number;
  /** Check-ins at this venue. */
  visits: number;
}

export interface Region {
  centerLat: number;
  centerLon: number;
  /** Half-height of the drawn area, in km. */
  radiusKm: number;
}

const VIEW_W = 1600;
const VIEW_H = 1000;
/** Points this far from the busiest area are outside "home". */
const HOME_RADIUS_KM = 15;
const MIN_RADIUS_KM = 1.5;
const MYPLACES_TTL_MS = 24 * 60 * 60 * 1000;
const STREETS_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Most recent visits joined by lines (older history is dots only). */
const MAX_PATH_VISITS = 600;
/**
 * Streets covers at most this radius: the road network of a whole metro
 * area is hundreds of thousands of ways (too much for Overpass and for a
 * full-page mask), and at page scale only a neighbourhood reads as streets.
 */
export const STREETS_MAX_RADIUS_KM = 2.5;
/** After a failed Overpass fetch, wait this long before asking again. */
const STREETS_RETRY_MS = 60 * 60 * 1000;
/** Largest Streets SVG kept; denser areas fall back to major roads only. */
export const MAX_STREETS_SVG_BYTES = 1.5 * 1024 * 1024;

const KM_PER_DEG_LAT = 111.32;

function kmBetween(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = (bLat - aLat) * KM_PER_DEG_LAT;
  const dLon = (bLon - aLon) * KM_PER_DEG_LAT * Math.cos(((aLat + bLat) / 2) * (Math.PI / 180));
  return Math.hypot(dLat, dLon);
}

/**
 * The user's home area: the ~5 km grid cell with the most check-ins, then
 * the visit-weighted centre of everything within HOME_RADIUS_KM of it. The
 * drawn radius covers 90% of those visits (so one far outlier can't shrink
 * everything else to a dot). Null when there are no points.
 */
export function pickHomeRegion(points: VenuePoint[]): Region | null {
  if (points.length === 0) return null;
  const cells = new Map<string, { lat: number; lon: number; visits: number }>();
  for (const p of points) {
    const key = `${Math.round(p.lat / 0.05)}:${Math.round(p.lon / 0.05)}`;
    const cell = cells.get(key) ?? { lat: 0, lon: 0, visits: 0 };
    cell.lat += p.lat * p.visits;
    cell.lon += p.lon * p.visits;
    cell.visits += p.visits;
    cells.set(key, cell);
  }
  const busiest = [...cells.values()].sort((a, b) => b.visits - a.visits)[0];
  const seedLat = busiest.lat / busiest.visits;
  const seedLon = busiest.lon / busiest.visits;

  const near = points.filter((p) => kmBetween(seedLat, seedLon, p.lat, p.lon) <= HOME_RADIUS_KM);
  const total = near.reduce((sum, p) => sum + p.visits, 0);
  const centerLat = near.reduce((sum, p) => sum + p.lat * p.visits, 0) / total;
  const centerLon = near.reduce((sum, p) => sum + p.lon * p.visits, 0) / total;

  const byDistance = near
    .map((p) => ({ d: kmBetween(centerLat, centerLon, p.lat, p.lon), visits: p.visits }))
    .sort((a, b) => a.d - b.d);
  let covered = 0;
  let radiusKm = MIN_RADIUS_KM;
  for (const { d, visits } of byDistance) {
    covered += visits;
    radiusKm = Math.max(radiusKm, d);
    if (covered >= total * 0.9) break;
  }
  return { centerLat, centerLon, radiusKm: radiusKm * 1.1 };
}

/** Equirectangular projection into the VIEW_W × VIEW_H canvas, centred on the region. */
export function projector(region: Region): (lat: number, lon: number) => [number, number] {
  const pxPerKm = (VIEW_H / 2) / region.radiusKm;
  const cosLat = Math.cos(region.centerLat * (Math.PI / 180));
  return (lat, lon) => [
    VIEW_W / 2 + (lon - region.centerLon) * KM_PER_DEG_LAT * cosLat * pxPerKm,
    VIEW_H / 2 - (lat - region.centerLat) * KM_PER_DEG_LAT * pxPerKm,
  ];
}

function inView([x, y]: [number, number], margin = 40): boolean {
  return x >= -margin && x <= VIEW_W + margin && y >= -margin && y <= VIEW_H + margin;
}

const fmt = (n: number) => n.toFixed(1);

function svgDocument(body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEW_W} ${VIEW_H}" preserveAspectRatio="xMidYMid slice">${body}</svg>`;
}

/**
 * Dots for venues (radius grows with log visits) plus a faint path through
 * the most recent visits in time order. `visits` are venue coordinates in
 * chronological order.
 */
export function renderMyPlacesSvg(points: VenuePoint[], visits: { lat: number; lon: number }[], region: Region): string {
  const project = projector(region);
  const parts: string[] = [];

  const path: string[] = [];
  let prev: [number, number] | null = null;
  for (const v of visits.slice(-MAX_PATH_VISITS)) {
    const xy = project(v.lat, v.lon);
    if (!inView(xy, 200)) {
      prev = null;
      continue;
    }
    if (prev && Math.hypot(xy[0] - prev[0], xy[1] - prev[1]) < 1) continue;
    path.push(`${prev ? 'L' : 'M'}${fmt(xy[0])} ${fmt(xy[1])}`);
    prev = xy;
  }
  if (path.length > 1) {
    parts.push(`<path d="${path.join('')}" fill="none" stroke="#000" stroke-opacity="0.35" stroke-width="1.2" stroke-linejoin="round"/>`);
  }

  for (const p of points) {
    const xy = project(p.lat, p.lon);
    if (!inView(xy)) continue;
    const r = 2.5 + Math.log2(1 + p.visits) * 1.6;
    parts.push(`<circle cx="${fmt(xy[0])}" cy="${fmt(xy[1])}" r="${fmt(r)}"/>`);
  }
  return svgDocument(parts.join(''));
}

/** OSM highway classes drawn, with their stroke widths. */
const ROAD_WIDTHS: Record<string, number> = {
  motorway: 5, trunk: 4.5, primary: 4, secondary: 3.2, tertiary: 2.6,
  residential: 1.8, unclassified: 1.8, living_street: 1.4, pedestrian: 1.4,
};
const MAJOR_ROADS = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary']);

export interface Road {
  highway: string;
  points: { lat: number; lon: number }[];
}

export function renderStreetsSvg(roads: Road[], region: Region): string {
  const full = renderRoads(roads, region);
  if (full.length <= MAX_STREETS_SVG_BYTES) return full;
  return renderRoads(roads.filter((r) => MAJOR_ROADS.has(r.highway)), region);
}

/** The region Streets draws: the home area, capped to a neighbourhood. */
export function streetsRegion(region: Region): Region {
  return { ...region, radiusKm: Math.min(region.radiusKm, STREETS_MAX_RADIUS_KM) };
}

function renderRoads(roads: Road[], region: Region): string {
  const project = projector(region);
  // One path per width keeps the file small.
  const byWidth = new Map<number, string[]>();
  for (const road of roads) {
    const width = ROAD_WIDTHS[road.highway];
    if (!width || road.points.length < 2) continue;
    const d = road.points
      .map((p, i) => {
        const [x, y] = project(p.lat, p.lon);
        return `${i === 0 ? 'M' : 'L'}${fmt(x)} ${fmt(y)}`;
      })
      .join('');
    const list = byWidth.get(width) ?? [];
    list.push(d);
    byWidth.set(width, list);
  }
  const parts = [...byWidth.entries()].map(
    ([width, ds]) => `<path d="${ds.join('')}" fill="none" stroke="#000" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`,
  );
  return svgDocument(parts.join(''));
}

/** The Overpass bounding box (s, w, n, e) for the drawn 16:10 view, plus 10%. */
export function streetsBbox(region: Region): [number, number, number, number] {
  const halfLat = (region.radiusKm * 1.1) / KM_PER_DEG_LAT;
  const halfLon = (region.radiusKm * 1.6 * 1.1) / (KM_PER_DEG_LAT * Math.cos(region.centerLat * (Math.PI / 180)));
  return [
    region.centerLat - halfLat,
    region.centerLon - halfLon,
    region.centerLat + halfLat,
    region.centerLon + halfLon,
  ];
}

/**
 * Roads within the region's drawn area, from Overpass. Throws on an
 * incomplete answer: Overpass reports a timeout or memory limit as HTTP 200
 * with a `remark` and partial (or no) elements, which must not be cached.
 */
export async function fetchRoads(
  region: Region,
  query: (body: string) => Promise<Response> = queryOverpass,
): Promise<Road[]> {
  const [s, w, n, e] = streetsBbox(region);
  const classes = Object.keys(ROAD_WIDTHS).join('|');
  const q = `[out:json][timeout:25];way["highway"~"^(${classes})$"](${s},${w},${n},${e});out geom qt;`;
  const res = await query(`data=${encodeURIComponent(q)}`);
  const json = (await res.json()) as {
    remark?: string;
    elements?: { tags?: { highway?: string }; geometry?: { lat: number; lon: number }[] }[];
  };
  if (json.remark) throw new Error(`Overpass returned an incomplete result: ${json.remark}`);
  return (json.elements ?? [])
    .filter((el) => el.tags?.highway && Array.isArray(el.geometry))
    .map((el) => ({ highway: el.tags!.highway!, points: el.geometry! }));
}

async function loadVenuePoints(userId: string): Promise<{ points: VenuePoint[]; visits: { lat: number; lon: number }[] }> {
  const result = await query(
    `SELECT v.id, v.latitude::float8 AS lat, v.longitude::float8 AS lon, c.checked_in_at
       FROM checkins c
       JOIN venues v ON v.id = c.venue_id
      WHERE c.user_id = $1
      ORDER BY c.checked_in_at ASC`,
    [userId],
  );
  const byVenue = new Map<string, VenuePoint>();
  const visits: { lat: number; lon: number }[] = [];
  for (const row of result.rows as { id: string; lat: number; lon: number }[]) {
    if (!Number.isFinite(row.lat) || !Number.isFinite(row.lon)) continue;
    visits.push({ lat: row.lat, lon: row.lon });
    const point = byVenue.get(row.id) ?? { lat: row.lat, lon: row.lon, visits: 0 };
    point.visits += 1;
    byVenue.set(row.id, point);
  }
  return { points: [...byVenue.values()], visits };
}

function cachePath(userId: string, kind: PlacePatternKind): string {
  return path.join(config.dataDir, userId, 'appearance', `places-${kind}.svg`);
}

const inFlight = new Map<string, Promise<string | null>>();

/**
 * The user's pattern SVG, rendered on demand and cached (My Places for a
 * day, Streets for a month). Null when there's nothing to draw (no
 * check-ins yet). A failed Streets refresh falls back to the stale copy.
 */
export async function getPlacePattern(userId: string, kind: PlacePatternKind): Promise<string | null> {
  const key = `${userId}:${kind}`;
  const pending = inFlight.get(key);
  if (pending) return pending;
  const job = (async () => {
    const file = cachePath(userId, kind);
    const ttl = kind === 'myplaces' ? MYPLACES_TTL_MS : STREETS_TTL_MS;
    let stale: string | null = null;
    try {
      const stat = await fs.stat(file);
      const cached = await fs.readFile(file, 'utf8');
      if (Date.now() - stat.mtimeMs < ttl) return cached;
      stale = cached;
    } catch {
      // not cached yet
    }

    const { points, visits } = await loadVenuePoints(userId);
    const region = pickHomeRegion(points);
    if (!region) return null;

    let svg: string;
    if (kind === 'myplaces') {
      svg = renderMyPlacesSvg(points, visits, region);
    } else {
      // Back off after a failure so page loads don't keep hammering Overpass.
      const failedMarker = `${file}.failed`;
      try {
        const failed = await fs.stat(failedMarker);
        if (Date.now() - failed.mtimeMs < STREETS_RETRY_MS) {
          if (stale) return stale;
          throw new Error('Street data is temporarily unavailable');
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      }
      const area = streetsRegion(region);
      try {
        svg = renderStreetsSvg(await fetchRoads(area), area);
      } catch (err) {
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(failedMarker, String(err instanceof Error ? err.message : err));
        if (stale) return stale;
        throw err;
      }
      await fs.rm(failedMarker, { force: true });
    }
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, svg);
    return svg;
  })();
  inFlight.set(key, job);
  try {
    return await job;
  } finally {
    inFlight.delete(key);
  }
}

/** Drop cached patterns (e.g. after Start Over deletes check-ins). */
export async function clearPlacePatterns(userId: string): Promise<void> {
  for (const kind of PLACE_PATTERN_KINDS) {
    await fs.rm(cachePath(userId, kind), { force: true });
    await fs.rm(`${cachePath(userId, kind)}.failed`, { force: true });
  }
}

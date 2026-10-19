import type { TrackMapEntry } from './types';

/** Tracks whose on-screen extent is below this are too small to see as a line. */
export const MIN_LINE_PX = 12;
/** Tracks larger than this on screen are always drawn as lines, never merged. */
export const MAX_CLUSTERABLE_PX = 80;
/** Start points closer than this (in screen px) merge into one circle. */
export const CLUSTER_DISTANCE_PX = 40;

export type ProjectFn = (lat: number, lng: number) => { x: number; y: number };

export type TrackMapItem =
  | { kind: 'line'; track: TrackMapEntry; index: number }
  | { kind: 'dot'; track: TrackMapEntry; index: number; lat: number; lng: number }
  | {
    kind: 'cluster';
    id: string;
    lat: number;
    lng: number;
    tracks: TrackMapEntry[];
  };

/**
 * Decides how each track is drawn at the current zoom: a polyline, a dot (a lone
 * track too small to see as a line), or a numbered circle standing in for several
 * nearby small tracks. `index` is the track's position in the input, so colors
 * stay stable as items switch between representations.
 */
export function clusterTracks(
  tracks: TrackMapEntry[],
  project: ProjectFn,
  unproject: (x: number, y: number) => { lat: number; lng: number },
): TrackMapItem[] {
  const items: TrackMapItem[] = [];

  interface Candidate { track: TrackMapEntry; index: number; x: number; y: number; extent: number }
  const candidates: Candidate[] = [];

  tracks.forEach((track, index) => {
    const b = track.bounds;
    if (!b || track.coordinates.length < 2) return;
    const a = project(b.minLat, b.minLng);
    const c = project(b.maxLat, b.maxLng);
    const extent = Math.max(Math.abs(a.x - c.x), Math.abs(a.y - c.y));
    if (extent > MAX_CLUSTERABLE_PX) {
      items.push({ kind: 'line', track, index });
      return;
    }
    const [lng, lat] = track.coordinates[0];
    const start = project(lat, lng);
    candidates.push({ track, index, x: start.x, y: start.y, extent });
  });

  // Union-find over candidates whose start points are within CLUSTER_DISTANCE_PX,
  // using a spatial hash so each candidate only checks its neighboring cells.
  const parent = candidates.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const grid = new Map<string, number[]>();
  candidates.forEach((cand, i) => {
    const cx = Math.floor(cand.x / CLUSTER_DISTANCE_PX);
    const cy = Math.floor(cand.y / CLUSTER_DISTANCE_PX);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const j of grid.get(`${cx + dx}:${cy + dy}`) ?? []) {
          const other = candidates[j];
          if (Math.hypot(cand.x - other.x, cand.y - other.y) < CLUSTER_DISTANCE_PX) {
            parent[find(i)] = find(j);
          }
        }
      }
    }
    const key = `${cx}:${cy}`;
    const cell = grid.get(key);
    if (cell) cell.push(i);
    else grid.set(key, [i]);
  });

  const groups = new Map<number, Candidate[]>();
  candidates.forEach((cand, i) => {
    const root = find(i);
    const group = groups.get(root);
    if (group) group.push(cand);
    else groups.set(root, [cand]);
  });

  for (const group of groups.values()) {
    if (group.length === 1) {
      const { track, index, extent } = group[0];
      if (extent >= MIN_LINE_PX) {
        items.push({ kind: 'line', track, index });
      } else {
        const [lng, lat] = track.coordinates[0];
        items.push({ kind: 'dot', track, index, lat, lng });
      }
      continue;
    }
    const x = group.reduce((s, g) => s + g.x, 0) / group.length;
    const y = group.reduce((s, g) => s + g.y, 0) / group.length;
    const center = unproject(x, y);
    items.push({
      kind: 'cluster',
      id: group.map((g) => g.track.id).sort().join('|'),
      lat: center.lat,
      lng: center.lng,
      tracks: group.map((g) => g.track),
    });
  }

  return items;
}

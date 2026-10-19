import { describe, expect, it } from 'vitest';
import { clusterTracks } from '../ui/trackClustering';
import type { TrackMapEntry } from '../ui/types';

// 1 degree = `scale` px, so tests control "zoom" directly.
const makeProject = (scale: number) => (lat: number, lng: number) => ({ x: lng * scale, y: lat * scale });
const makeUnproject = (scale: number) => (x: number, y: number) => ({ lat: y / scale, lng: x / scale });

function track(id: string, lat: number, lng: number, size: number): TrackMapEntry {
  return {
    id,
    name: id,
    activity_type: null,
    timezone: 'UTC',
    started_at: '2026-01-01T00:00:00Z',
    distance_m: 0,
    elapsed_time_s: 0,
    moving_time_s: 0,
    elevation_gain_m: 0,
    avg_speed_mps: 0,
    max_speed_mps: 0,
    coordinates: [[lng, lat], [lng + size, lat + size]],
    bounds: { minLat: lat, minLng: lng, maxLat: lat + size, maxLng: lng + size },
  };
}

describe('clusterTracks', () => {
  it('merges nearby small tracks into one cluster', () => {
    const tracks = [track('a', 0, 0, 0.1), track('b', 0.1, 0.1, 0.1), track('c', 5, 5, 0.2)];
    const items = clusterTracks(tracks, makeProject(100), makeUnproject(100));
    const cluster = items.find((i) => i.kind === 'cluster');
    expect(cluster && cluster.kind === 'cluster' && cluster.tracks.map((t) => t.id).sort()).toEqual(['a', 'b']);
    expect(items.filter((i) => i.kind === 'line')).toHaveLength(1);
  });

  it('draws a lone sub-pixel track as a dot', () => {
    const items = clusterTracks([track('a', 0, 0, 0.0001)], makeProject(100), makeUnproject(100));
    expect(items).toEqual([expect.objectContaining({ kind: 'dot', index: 0 })]);
  });

  it('never merges tracks that are large on screen', () => {
    const items = clusterTracks([track('a', 0, 0, 2), track('b', 0, 0.1, 2)], makeProject(100), makeUnproject(100));
    expect(items.map((i) => i.kind)).toEqual(['line', 'line']);
  });

  it('separates tracks once zoomed in far enough', () => {
    const tracks = [track('a', 0, 0, 0.1), track('b', 0.1, 0.1, 0.1)];
    const items = clusterTracks(tracks, makeProject(1000), makeUnproject(1000));
    expect(items.map((i) => i.kind)).toEqual(['line', 'line']);
  });
});

/**
 * Backup v2 diff helpers for tracks.
 *
 * The only mutation a user can apply to a track after upload is trimming a
 * prefix/suffix of points (plus editing name/activity type). Therefore the
 * stored geometry + per-point series is always a contiguous subsequence of
 * the original uploaded file's parsed points. These helpers locate that
 * subsequence at export time so the backup only needs to ship the original
 * file plus a { start_index, end_index } trim range.
 */

import type { GpxPoint, GpxPointSeries } from './gpx';

/** Inclusive point range into the original file's parsed points. */
export interface TrackPointRange {
  start: number;
  end: number;
}

/**
 * Find the contiguous range of `originalPoints` that matches the stored
 * (geometry + per-point series) exactly. Returns the range (which may cover
 * the whole file when the track was never trimmed), or `undefined` when the
 * stored data does not appear as a contiguous subsequence (e.g. the file on
 * disk was swapped out under the track) — the caller must fall back to
 * inline geometry/points in that case.
 *
 * `storedCoords` is the stored geometry in [lng, lat] order; `storedPoints`
 * is the stored per-point series ({ t: epoch ms | null, ele, hr }).
 */
export function findTrimRange(
  originalPoints: GpxPoint[],
  storedCoords: [number, number][],
  storedPoints: GpxPointSeries[],
): TrackPointRange | undefined {
  const n = originalPoints.length;
  const m = storedPoints.length;
  if (m < 2 || m > n || storedCoords.length !== m) return undefined;

  // Coordinates round-trip through PostGIS geometry (float precision), so
  // allow a tiny tolerance; time/ele/hr come from the same parsed file on
  // both sides and must match exactly.
  const COORD_EPSILON = 1e-6;
  const pointMatches = (p: GpxPoint, coord: [number, number], s: GpxPointSeries): boolean =>
    Math.abs(p.lon - coord[0]) < COORD_EPSILON &&
    Math.abs(p.lat - coord[1]) < COORD_EPSILON &&
    (p.time ? p.time.getTime() : null) === s.t &&
    p.ele === s.ele &&
    p.hr === s.hr;

  for (let start = 0; start + m <= n; start++) {
    if (!pointMatches(originalPoints[start], storedCoords[0], storedPoints[0])) continue;
    let ok = true;
    for (let i = 1; i < m; i++) {
      if (!pointMatches(originalPoints[start + i], storedCoords[i], storedPoints[i])) {
        ok = false;
        break;
      }
    }
    if (ok) return { start, end: start + m - 1 };
  }
  return undefined;
}

/** Slice the original points by an inclusive range (null/undefined = full). */
export function sliceTrackPoints(
  originalPoints: GpxPoint[],
  range: TrackPointRange | null | undefined,
): GpxPoint[] {
  if (!range) return originalPoints;
  const start = Math.max(0, range.start);
  const end = Math.min(originalPoints.length - 1, range.end);
  return originalPoints.slice(start, end + 1);
}

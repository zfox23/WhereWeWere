import { describe, expect, it } from 'vitest';
import { findTrimRange, sliceTrackPoints } from '../services/trackBackup';
import type { GpxPoint, GpxPointSeries } from '../services/gpx';

function mkPoint(i: number): GpxPoint {
  return {
    lat: 37.8 + i * 0.0001,
    lon: -122.5 + i * 0.0001,
    ele: 10 + i,
    time: new Date(1_700_000_000_000 + i * 1000),
    hr: 100 + i,
  };
}

function toCoords(points: GpxPoint[]): [number, number][] {
  return points.map((p) => [p.lon, p.lat]);
}

function toSeries(points: GpxPoint[]): GpxPointSeries[] {
  return points.map((p) => ({
    t: p.time ? p.time.getTime() : null,
    ele: p.ele,
    hr: p.hr,
  }));
}

describe('findTrimRange', () => {
  const original = Array.from({ length: 10 }, (_, i) => mkPoint(i));

  it('returns null-equivalent full range for an untrimmed track', () => {
    const range = findTrimRange(original, toCoords(original), toSeries(original));
    expect(range).toEqual({ start: 0, end: 9 });
  });

  it('finds a prefix trim', () => {
    const stored = original.slice(3);
    const range = findTrimRange(original, toCoords(stored), toSeries(stored));
    expect(range).toEqual({ start: 3, end: 9 });
  });

  it('finds a prefix+suffix trim', () => {
    const stored = original.slice(2, 8);
    const range = findTrimRange(original, toCoords(stored), toSeries(stored));
    expect(range).toEqual({ start: 2, end: 7 });
  });

  it('returns undefined when the stored points do not appear in the original', () => {
    const scrambled = [...original.slice(5), ...original.slice(0, 5)];
    const range = findTrimRange(original, toCoords(scrambled), toSeries(scrambled));
    expect(range).toBeUndefined();
  });

  it('returns undefined when point metadata differs (not just order)', () => {
    const stored = original.slice(2, 8);
    const series = toSeries(stored);
    series[0] = { ...series[0], ele: 9999 };
    const range = findTrimRange(original, toCoords(stored), series);
    expect(range).toBeUndefined();
  });

  it('returns undefined for size mismatches', () => {
    expect(
      findTrimRange(original, toCoords(original.slice(1)), toSeries(original))
    ).toBeUndefined();
    expect(
      findTrimRange(original, toCoords(original), toSeries(original.slice(1)))
    ).toBeUndefined();
  });

  it('returns undefined for tracks without per-point data', () => {
    expect(findTrimRange(original, toCoords(original), [])).toBeUndefined();
  });
});

describe('sliceTrackPoints', () => {
  const original = Array.from({ length: 10 }, (_, i) => mkPoint(i));

  it('slices by an inclusive range', () => {
    expect(sliceTrackPoints(original, { start: 2, end: 5 })).toHaveLength(4);
    expect(sliceTrackPoints(original, { start: 2, end: 5 })[0]).toBe(original[2]);
    expect(sliceTrackPoints(original, { start: 2, end: 5 })[3]).toBe(original[5]);
  });

  it('returns the full array for null/undefined ranges', () => {
    expect(sliceTrackPoints(original, null)).toBe(original);
    expect(sliceTrackPoints(original, undefined)).toBe(original);
  });

  it('clamps out-of-range indices', () => {
    expect(sliceTrackPoints(original, { start: -3, end: 100 })).toHaveLength(10);
  });
});

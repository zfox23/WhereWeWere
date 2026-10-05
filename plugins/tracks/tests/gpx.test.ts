import { describe, it, expect } from 'vitest';
import { parseGpx, computeTrackSegmentTotals, computeTrackStats, type GpxPoint } from '../services/gpx';

const GPX = `<?xml version="1.0"?>
<gpx version="1.1" creator="test">
  <trk>
    <name>Test Track</name>
    <trkseg>
      <trkpt lat="0.0" lon="0.0">
        <ele>10.5</ele>
        <time>2024-01-01T10:00:00Z</time>
        <extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>100</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions>
      </trkpt>
      <trkpt lat="0.001" lon="0.0">
        <ele>20</ele>
        <time>2024-01-01T10:00:03Z</time>
        <extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>110</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions>
      </trkpt>
      <trkpt lat="0.002" lon="0.0">
        <time>2024-01-01T10:00:07Z</time>
        <extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>120</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions>
      </trkpt>
    </trkseg>
  </trk>
</gpx>`;

describe('parseGpx points series', () => {
  const stats = parseGpx(GPX, 'Fallback');

  it('emits one series entry per track point, in order', () => {
    expect(stats.points).toHaveLength(3);
    expect(stats.points).toHaveLength(stats.coordinates.length);
  });

  it('maps timestamps to epoch milliseconds', () => {
    expect(stats.points[0].t).toBe(Date.UTC(2024, 0, 1, 10, 0, 0));
    expect(stats.points[2].t).toBe(Date.UTC(2024, 0, 1, 10, 0, 7));
  });

  it('maps elevation, using null when missing', () => {
    expect(stats.points[0].ele).toBeCloseTo(10.5);
    expect(stats.points[1].ele).toBe(20);
    expect(stats.points[2].ele).toBeNull();
  });

  it('maps heart rate from extensions', () => {
    expect(stats.points[0].hr).toBe(100);
    expect(stats.points[2].hr).toBe(120);
  });
});

// 1 degree of latitude is ~111,195 m, so this is ~10 m per 0.00008993 degrees.
const DEGREES_PER_10M = 10 / 111194.9;

function buildGpx(lats: number[], startEpochMs = Date.UTC(2024, 0, 1, 10)): string {
  const pts = lats
    .map((lat, i) => {
      const t = new Date(startEpochMs + i * 1000).toISOString();
      return `<trkpt lat="${lat.toFixed(8)}" lon="0"><time>${t}</time></trkpt>`;
    })
    .join('');
  return `<?xml version="1.0"?>
<gpx version="1.1" creator="test">
  <trk>
    <name>Generated</name>
    <trkseg>${pts}</trkseg>
  </trk>
</gpx>`;
}

describe('parseGpx max speed', () => {
  it('reports steady speed close to the true speed', () => {
    // 12 fixes, 1/s, each 10 m further north -> ~10 m/s the whole way
    const lats = Array.from({ length: 12 }, (_, i) => i * DEGREES_PER_10M);
    const stats = parseGpx(buildGpx(lats), 'Fallback');
    expect(stats.maxSpeedMps).toBeCloseTo(10, 0);
  });

  it('ignores GPS jitter spikes from a stationary receiver', () => {
    // Stationary, but the position jumps ~11 m back and forth every second.
    // Raw per-segment speeds would be ~11 m/s (40 km/h); the windowed max
    // speed must stay far below that.
    const lats = Array.from({ length: 21 }, (_, i) => (i % 2 === 0 ? 0 : 0.0001));
    const stats = parseGpx(buildGpx(lats), 'Fallback');
    expect(stats.maxSpeedMps).toBeLessThan(3);
  });

  it('falls back to the whole-track average when the track is shorter than the window', () => {
    // 3 fixes, 1/s, 10 m each -> ~10 m/s, but only 2 s long (window is 5 s)
    const lats = [0, DEGREES_PER_10M, 2 * DEGREES_PER_10M];
    const stats = parseGpx(buildGpx(lats), 'Fallback');
    expect(stats.maxSpeedMps).toBeCloseTo(10, 0);
  });

  it('ignores GPS lock jumps where the position teleports', () => {
    // Steady ~10 m/s the whole way, except one fix that jumps 2 km ahead
    // (simulating a bad fix after the receiver lost signal).
    const lats = Array.from({ length: 12 }, (_, i) => i * DEGREES_PER_10M);
    lats[6] = 0.02; // ~2.2 km teleport between seconds 5 and 6
    const stats = parseGpx(buildGpx(lats), 'Fallback');
    expect(stats.maxSpeedMps).toBeLessThan(15);
  });
});

describe('parseGpx average speed', () => {
  it('reports steady speed close to the true speed', () => {
    // 12 fixes, 1/s, each 10 m further north -> ~10 m/s the whole way
    const lats = Array.from({ length: 12 }, (_, i) => i * DEGREES_PER_10M);
    const stats = parseGpx(buildGpx(lats), 'Fallback');
    expect(stats.avgSpeedMps).toBeCloseTo(10, 0);
  });

  it('excludes GPS lock jumps from distance so avg speed stays <= max speed', () => {
    // Steady ~10 m/s the whole way, except one fix that jumps 2 km ahead
    // (simulating a bad fix after the receiver lost signal). Without the
    // plausibility filter the teleport adds ~2.2 km to distanceM, inflating
    // avg speed to ~174 m/s while max speed stays ~10 m/s.
    const lats = Array.from({ length: 12 }, (_, i) => i * DEGREES_PER_10M);
    lats[6] = 0.02;
    const stats = parseGpx(buildGpx(lats), 'Fallback');
    expect(stats.avgSpeedMps).toBeLessThanOrEqual(stats.maxSpeedMps);
    expect(stats.avgSpeedMps).toBeCloseTo(10, 0);
  });
});

describe('parseGpx moving time', () => {
  it('counts a slow steady walk as moving (window speed, not per-second speed)', () => {
    // 21 fixes, 1/s, at 1.1 m/s (~4 km/h). That is below the old 1.4 m/s
    // per-second threshold, so the old logic reported ~0 moving time, which
    // in turn made the average speed (distance / moving time) absurd.
    // The trailing-window net-displacement speed is a steady 1.1 m/s.
    const step = 0.11 * DEGREES_PER_10M; // 1.1 m per second
    const lats = Array.from({ length: 21 }, (_, i) => i * step);
    const stats = parseGpx(buildGpx(lats), 'Fallback');
    expect(stats.movingTimeS).toBeCloseTo(20, 0);
    expect(stats.avgSpeedMps).toBeCloseTo(1.1, 1);
    expect(stats.avgSpeedMps).toBeLessThanOrEqual(stats.maxSpeedMps);
  });

  it('caps the average speed at the max speed on winding paths', () => {
    // Steady 2 m/s north with a +/-1.5 m lateral zigzag every second: path
    // speed ~3.6 m/s, but the 10 s net-displacement max speed is ~2 m/s.
    // Without the cap, the path-length-based average would exceed the max.
    const m = DEGREES_PER_10M / 10; // degrees per 1 m
    const t0 = Date.UTC(2024, 0, 1, 10);
    const pts: GpxPoint[] = Array.from({ length: 21 }, (_, i) => ({
      lat: i * 2 * m,
      lon: (i % 2 === 0 ? 1.5 : -1.5) * m,
      ele: null,
      hr: null,
      time: new Date(t0 + i * 1000),
    }));
    const stats = computeTrackStats(pts, 'Fallback', null);
    expect(stats.avgSpeedMps).toBeLessThanOrEqual(stats.maxSpeedMps);
    expect(stats.avgSpeedMps).toBeGreaterThan(0);
  });

  it('does not count a jittery stationary receiver as moving', () => {
    // First 31 fixes are exactly still (longer than the trailing window, so
    // every window has full stationary history), then the position jitters
    // +/-~3 m inside a 6 m box. Any 30 s window's net displacement stays
    // <= ~6 m (0.2 m/s), below the 0.4 m/s threshold.
    const lats = [
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0.00003, 0, -0.00003, 0.00003, 0, -0.00003, 0.00003, 0, -0.00003, 0.00003, 0, -0.00003,
      0.00003, 0, -0.00003, 0.00003, 0, -0.00003, 0.00003, 0, -0.00003, 0.00003, 0, -0.00003,
      0.00003, 0, -0.00003, 0.00003, 0, -0.00003,
    ];
    const stats = parseGpx(buildGpx(lats), 'Fallback');
    expect(stats.movingTimeS).toBe(0);
  });
});

describe('computeTrackSegmentTotals', () => {
  const at = (latDeg: number, epochMs: number): GpxPoint => ({
    lat: latDeg,
    lon: 0,
    ele: null,
    hr: null,
    time: new Date(epochMs),
  });

  it('sums distance and moving time for plausible segments', () => {
    // 3 points, 1/s, 10 m each -> ~20 m distance, ~2 s moving
    const t0 = Date.UTC(2024, 0, 1, 10);
    const totals = computeTrackSegmentTotals([
      at(0, t0),
      at(DEGREES_PER_10M, t0 + 1000),
      at(2 * DEGREES_PER_10M, t0 + 2000),
    ]);
    expect(totals.distanceM).toBeCloseTo(20, 0);
    expect(totals.movingTimeS).toBeCloseTo(2, 0);
  });

  it('skips implausible jump segments from distance and moving time', () => {
    // 4 points, 1/s, 10 m each, with one ~2.2 km teleport in the middle.
    const t0 = Date.UTC(2024, 0, 1, 10);
    const totals = computeTrackSegmentTotals([
      at(0, t0),
      at(DEGREES_PER_10M, t0 + 1000),
      at(0.02, t0 + 2000), // teleport: ~2.2 km in 1 s
      at(2 * DEGREES_PER_10M, t0 + 3000), // teleport back
    ]);
    // Only the first 10 m segment is plausible: ~10 m, ~1 s moving.
    expect(totals.distanceM).toBeCloseTo(10, 0);
    expect(totals.movingTimeS).toBeCloseTo(1, 0);
  });

  it('still counts distance for segments without timestamps', () => {
    // No timestamps at all: segments cannot be judged implausible, so all
    // distance counts and moving time stays zero.
    const pts: GpxPoint[] = [
      { lat: 0, lon: 0, ele: null, hr: null, time: null },
      { lat: DEGREES_PER_10M, lon: 0, ele: null, hr: null, time: null },
    ];
    const totals = computeTrackSegmentTotals(pts);
    expect(totals.distanceM).toBeCloseTo(10, 0);
    expect(totals.movingTimeS).toBe(0);
  });

  it('accumulates elevation gain regardless of plausibility', () => {
    const t0 = Date.UTC(2024, 0, 1, 10);
    const pts: GpxPoint[] = [
      { lat: 0, lon: 0, ele: 100, hr: null, time: new Date(t0) },
      { lat: 0.02, lon: 0, ele: 150, hr: null, time: new Date(t0 + 1000) }, // teleport
      { lat: 2 * DEGREES_PER_10M, lon: 0, ele: 160, hr: null, time: new Date(t0 + 2000) }, // back
    ];
    const totals = computeTrackSegmentTotals(pts);
    // 50 m + 10 m of gain; the jump back to lat 2*10m loses elevation, no gain.
    expect(totals.elevationGainM).toBeCloseTo(60, 0);
  });
});

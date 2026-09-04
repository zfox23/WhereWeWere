import { describe, it, expect } from 'vitest';
import { parseGpx } from '../../src/services/gpx';

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

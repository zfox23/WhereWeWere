import { describe, it, expect } from 'vitest';
import { buildGpx, gpxDownloadFilename } from '../../src/services/trackFiles';
import { parseGpx } from '../../src/services/gpx';

describe('buildGpx', () => {
  const track = {
    id: '11111111-1111-1111-1111-111111111111',
    name: 'Night <Ride> & "Paul"',
    activityType: 'Cycling',
    coordinates: [
      [-77.037, 38.9],
      [-77.036, 38.901],
      [-77.035, 38.902],
    ] as [number, number][],
    points: [
      { t: Date.parse('2024-01-01T10:00:00Z'), ele: 10.5, hr: 100 },
      { t: Date.parse('2024-01-01T10:00:03Z'), ele: 20, hr: 110 },
      { t: Date.parse('2024-01-01T10:00:07Z'), ele: null, hr: null },
    ],
  };

  it('produces parseable GPX that round-trips its data', () => {
    const gpx = buildGpx(track);
    const parsed = parseGpx(gpx, 'Fallback');

    // Name with XML special characters survives escaping
    expect(parsed.name).toBe('Night <Ride> & "Paul"');
    expect(parsed.activityType).toBe('Cycling');
    expect(parsed.pointCount).toBe(3);
    expect(parsed.points.map((p) => p.t)).toEqual(track.points.map((p) => p.t));
    expect(parsed.points.map((p) => p.ele)).toEqual([10.5, 20, null]);
    expect(parsed.points.map((p) => p.hr)).toEqual([100, 110, null]);
  });

  it('omits activity type, elevation, time and heart rate when missing', () => {
    const gpx = buildGpx({
      ...track,
      name: 'Bare Track',
      activityType: null,
      points: [
        { t: null, ele: null, hr: null },
        { t: null, ele: null, hr: null },
      ],
    });
    expect(gpx).not.toContain('<type>');
    expect(gpx).not.toContain('<ele>');
    expect(gpx).not.toContain('<time>');
    expect(gpx).not.toContain('<gpxtpx:hr>');
  });

  it('ignores extra per-point data beyond the coordinates', () => {
    const gpx = buildGpx({
      ...track,
      points: [
        ...track.points,
        { t: Date.parse('2024-01-01T10:00:08Z'), ele: 30, hr: 130 },
      ],
    });
    const parsed = parseGpx(gpx, 'Fallback');
    expect(parsed.pointCount).toBe(3);
  });
});

describe('gpxDownloadFilename', () => {
  it('sanitizes path separators and unsafe characters', () => {
    expect(
      gpxDownloadFilename({ id: 'abc', name: 'a/b\\c:d*e', activityType: null, coordinates: [], points: null })
    ).toBe('abcde.gpx');
  });

  it('falls back to the track id when the name is empty or unsafe', () => {
    expect(
      gpxDownloadFilename({ id: 'abc', name: '', activityType: null, coordinates: [], points: null })
    ).toBe('track-abc.gpx');
    expect(
      gpxDownloadFilename({ id: 'abc', name: '///', activityType: null, coordinates: [], points: null })
    ).toBe('track-abc.gpx');
  });
});

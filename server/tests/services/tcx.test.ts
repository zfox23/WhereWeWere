import { describe, it, expect } from 'vitest';
import { parseTcx, parseTrackFile } from '../../src/services/gpx';

const TCX = `<?xml version='1.0' encoding='UTF-8'?>
<TrainingCenterDatabase xmlns:tpx="http://www.garmin.com/xmlschemas/ActivityExtension/v2" xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
  <Activities>
    <Activity Sport="Biking">
      <Id>2024-01-01T10:00:00.000Z</Id>
      <Lap StartTime="2024-01-01T10:00:00.000Z">
        <Track>
          <Trackpoint>
            <Time>2024-01-01T10:00:00.000Z</Time>
            <Position>
              <LatitudeDegrees>0.0</LatitudeDegrees>
              <LongitudeDegrees>0.0</LongitudeDegrees>
            </Position>
            <AltitudeMeters>10.5</AltitudeMeters>
            <extensions>
              <tpx:Extension>
                <tpx:HeartRateBpm><tpx:Value>100</tpx:Value></tpx:HeartRateBpm>
              </tpx:Extension>
            </extensions>
          </Trackpoint>
          <Trackpoint>
            <Time>2024-01-01T10:00:03.000Z</Time>
            <Position>
              <LatitudeDegrees>0.001</LatitudeDegrees>
              <LongitudeDegrees>0.0</LongitudeDegrees>
            </Position>
            <AltitudeMeters>20</AltitudeMeters>
            <extensions>
              <tpx:Extension>
                <tpx:HeartRateBpm><tpx:Value>110</tpx:Value></tpx:HeartRateBpm>
              </tpx:Extension>
            </extensions>
          </Trackpoint>
          <Trackpoint>
            <Time>2024-01-01T10:00:07.000Z</Time>
            <Position>
              <LatitudeDegrees>0.002</LatitudeDegrees>
              <LongitudeDegrees>0.0</LongitudeDegrees>
            </Position>
          </Trackpoint>
        </Track>
      </Lap>
    </Activity>
  </Activities>
</TrainingCenterDatabase>`;

describe('parseTcx', () => {
  const stats = parseTcx(TCX, 'Night Ride with Paul');

  it('uses the fallback name when no <Name> element is present', () => {
    expect(stats.name).toBe('Night Ride with Paul');
  });

  it('extracts the activity type from the Sport attribute', () => {
    expect(stats.activityType).toBe('Biking');
  });

  it('parses track points from laps', () => {
    expect(stats.pointCount).toBe(3);
    expect(stats.coordinates).toEqual([
      [0, 0],
      [0, 0.001],
      [0, 0.002],
    ]);
  });

  it('maps timestamps, elevation, and heart rate', () => {
    expect(stats.points[0].t).toBe(Date.UTC(2024, 0, 1, 10, 0, 0));
    expect(stats.points[0].ele).toBeCloseTo(10.5);
    expect(stats.points[0].hr).toBe(100);
    expect(stats.points[2].ele).toBeNull();
    expect(stats.points[2].hr).toBeNull();
  });

  it('computes start and end times', () => {
    expect(stats.startedAt.toISOString()).toBe('2024-01-01T10:00:00.000Z');
    expect(stats.endedAt.toISOString()).toBe('2024-01-01T10:00:07.000Z');
  });

  it('rejects files without an Activity element', () => {
    expect(() => parseTcx('<TrainingCenterDatabase/>', 'x')).toThrow(
      /no <Activity> element/
    );
  });
});

describe('parseTrackFile', () => {
  it('routes .tcx to the TCX parser', () => {
    expect(parseTrackFile(TCX, '.tcx', 'x').activityType).toBe('Biking');
    expect(parseTrackFile(TCX, '.TCX', 'x').activityType).toBe('Biking');
  });

  it('routes other extensions to the GPX parser', () => {
    expect(() => parseTrackFile(TCX, '.gpx', 'x')).toThrow(/Invalid GPX/);
  });
});

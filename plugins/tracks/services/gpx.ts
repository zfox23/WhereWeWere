import { XMLParser } from 'fast-xml-parser';

/** Per-point series data stored alongside the track for graphing. */
export interface GpxPointSeries {
  /** Epoch milliseconds, or null if the point had no timestamp */
  t: number | null;
  /** Elevation in meters, or null */
  ele: number | null;
  /** Heart rate in bpm, or null */
  hr: number | null;
}

export interface GpxPoint {
  lat: number;
  lon: number;
  ele: number | null;
  time: Date | null;
  hr: number | null;
}

export interface TrackStats {
  name: string;
  /** Activity type from the GPX <type> element or TCX Activity @Sport, or null */
  activityType: string | null;
  startedAt: Date;
  endedAt: Date;
  distanceM: number;
  elapsedTimeS: number;
  movingTimeS: number;
  elevationGainM: number;
  avgSpeedMps: number;
  maxSpeedMps: number;
  avgHr: number | null;
  maxHr: number | null;
  pointCount: number;
  /** WKT LINESTRING (lon lat order) for PostGIS */
  wktLineString: string;
  /** GeoJSON coordinates [lon, lat][] for the map */
  coordinates: [number, number][];
  /** Per-point series (same order as `coordinates`) for graphing */
  points: GpxPointSeries[];
}

const EARTH_RADIUS_M = 6371000;
/**
 * Segments slower than this (~1.4 km/h) are treated as stopped, not
 * "moving". This is compared against the net-displacement speed over a
 * MOVING_SPEED_WINDOW_S trailing window (not raw per-second speed): a
 * toddler-paced walk is ~0.3-0.8 m/s, so a higher threshold misclassifies
 * real slow walking as stopped.
 */
const MOVING_SPEED_THRESHOLD_MPS = 0.4;
/**
 * Trailing window (seconds) used to classify segments as moving. Raw speed
 * between two 1 s-apart fixes is dominated by GPS position jitter, which
 * makes per-segment classification unreliable. A longer net-displacement
 * window has two benefits: per-second jitter cancels out, and a stationary
 * receiver's drift (a random walk) averages down as ~1/sqrt(t), so a
 * receiver that slowly wanders while stopped stays under the threshold.
 */
const MOVING_SPEED_WINDOW_S = 30;
/**
 * Minimum window length (seconds) for max-speed computation. A 10 s window
 * is needed to average out GPS position jitter, which otherwise produces
 * single-window spikes of several m/s from a slow walker.
 */
const MAX_SPEED_WINDOW_S = 10;
/**
 * Segments faster than this (~108 km/h, far beyond any human-powered
 * activity) are treated as GPS lock jumps rather than real speed.
 */
const MAX_PLAUSIBLE_SEGMENT_SPEED_MPS = 30;

function toNumberArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

function parsePoint(trkpt: any): GpxPoint | null {
  const lat = Number(trkpt?.['@_lat']);
  const lon = Number(trkpt?.['@_lon']);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const eleRaw = trkpt?.ele;
  const ele = eleRaw != null && eleRaw !== '' ? Number(eleRaw) : NaN;

  const timeRaw = trkpt?.time;
  const time = timeRaw ? new Date(String(timeRaw)) : null;

  let hr: number | null = null;
  const ext = trkpt?.extensions;
  if (ext) {
    // Depending on parser options, the extension object may be wrapped in
    // TrackPointExtension (or gpxtpx:TrackPointExtension).
    const extObj =
      ext['gpxtpx:TrackPointExtension'] || ext['TrackPointExtension'] || ext;
    const hrRaw = extObj?.hr ?? extObj?.['gpxtpx:hr'];
    if (hrRaw != null && hrRaw !== '') {
      const parsed = Number(hrRaw);
      if (Number.isFinite(parsed) && parsed > 0) hr = parsed;
    }
  }

  return {
    lat,
    lon,
    ele: Number.isFinite(ele) ? ele : null,
    time: time && !Number.isNaN(time.getTime()) ? time : null,
    hr,
  };
}

export function haversineM(a: GpxPoint, b: GpxPoint): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h =
    sinLat * sinLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLon * sinLon;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

function makeParser() {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: true,
    trimValues: true,
  });
}

function parseTcxPoint(tp: any): GpxPoint | null {
  const pos = tp?.Position;
  const lat = Number(pos?.LatitudeDegrees);
  const lon = Number(pos?.LongitudeDegrees);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const eleRaw = tp?.AltitudeMeters;
  const ele = eleRaw != null && eleRaw !== '' ? Number(eleRaw) : NaN;

  const timeRaw = tp?.Time;
  const time = timeRaw ? new Date(String(timeRaw)) : null;

  let hr: number | null = null;
  const ext = tp?.extensions;
  if (ext) {
    const extObj = ext['tpx:Extension'] || ext['Extension'] || ext;
    const hrRaw =
      extObj?.HeartRateBpm?.Value ?? extObj?.['tpx:HeartRateBpm']?.['tpx:Value'];
    if (hrRaw != null && hrRaw !== '') {
      const parsed = Number(hrRaw);
      if (Number.isFinite(parsed) && parsed > 0) hr = parsed;
    }
  }

  return {
    lat,
    lon,
    ele: Number.isFinite(ele) ? ele : null,
    time: time && !Number.isNaN(time.getTime()) ? time : null,
    hr,
  };
}

/**
 * Max speed over a rolling window of at least MAX_SPEED_WINDOW_S, measured as
 * net displacement between the window's endpoints divided by its duration.
 * Raw per-segment speed (distance between two consecutive GPS fixes divided by
 * the time between them) is dominated by GPS position jitter: with fixes
 * roughly once per second and several meters of horizontal error, even a
 * stationary receiver can produce single-segment "speeds" of 10+ m/s. Measuring
 * net displacement over a short window makes the jitter cancel out.
 *
 * Segments faster than MAX_PLAUSIBLE_SEGMENT_SPEED_MPS are treated as GPS lock
 * jumps (e.g. the position teleporting hundreds of meters after the receiver
 * loses signal) and excluded: the track is split into spans of contiguous
 * plausible segments and the max is taken within each span.
 */
export function computeMaxSpeedMps(
  timed: (GpxPoint & { time: Date })[]
): number {
  if (timed.length < 2) return 0;

  let max = 0;
  let spanStart = 0;
  for (let i = 1; i <= timed.length; i++) {
    const implausible =
      i === timed.length || isImplausibleSegment(timed[i - 1], timed[i]);
    if (!implausible) continue;
    max = Math.max(max, maxSpeedInSpan(timed, spanStart, i));
    spanStart = i;
  }

  return max;
}

function isImplausibleSegment(
  a: GpxPoint & { time: Date },
  b: GpxPoint & { time: Date }
): boolean {
  const dtS = (b.time.getTime() - a.time.getTime()) / 1000;
  if (dtS <= 0) return true;
  return haversineM(a, b) / dtS > MAX_PLAUSIBLE_SEGMENT_SPEED_MPS;
}

function maxSpeedInSpan(
  timed: (GpxPoint & { time: Date })[],
  from: number,
  to: number
): number {
  // Points from..to-1 form a span where every segment is plausible.
  let max = 0;
  let start = from;
  for (let end = from; end < to; end++) {
    while (end > start) {
      const winTimeS =
        (timed[end].time.getTime() - timed[start].time.getTime()) / 1000;
      if (winTimeS < MAX_SPEED_WINDOW_S) break;
      const speed = haversineM(timed[start], timed[end]) / winTimeS;
      if (speed > max) max = speed;
      start++;
    }
  }

  // Spans shorter than the window: fall back to the span's average speed so
  // we still report a sensible non-zero speed when there was movement.
  const spanTimeS =
    (timed[to - 1].time.getTime() - timed[from].time.getTime()) / 1000;
  if (spanTimeS > 0 && spanTimeS < MAX_SPEED_WINDOW_S) {
    let spanDist = 0;
    for (let i = from + 1; i < to; i++) {
      spanDist += haversineM(timed[i - 1], timed[i]);
    }
    max = Math.max(max, spanDist / spanTimeS);
  }

  return max;
}

export interface TrackSegmentTotals {
  distanceM: number;
  movingTimeS: number;
  elevationGainM: number;
}

/**
 * Sum segment distance, moving time, and elevation gain over an ordered list
 * of points.
 *
 * GPS lock jumps (e.g. the position teleporting hundreds of meters after the
 * receiver loses signal) inflate distanceM and can make the average speed
 * exceed the windowed max speed, which is impossible. Such segments are
 * skipped from the distance and moving-time sums, mirroring the treatment in
 * computeMaxSpeedMps (the same dtS/distance plausibility test).
 *
 * Moving time is classified with the net displacement over a trailing
 * MOVING_SPEED_WINDOW_S window rather than raw per-segment speed, which GPS
 * position jitter dominates (see computeMovingTimeS).
 *
 * Shared by the GPX/TCX parsers and the track stats backfill so both use
 * identical logic.
 */
export function computeTrackSegmentTotals(
  points: GpxPoint[]
): TrackSegmentTotals {
  let distanceM = 0;
  let elevationGainM = 0;

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const segDist = haversineM(prev, curr);

    let dtS = 0;
    if (prev.time && curr.time) {
      dtS = (curr.time.getTime() - prev.time.getTime()) / 1000;
    }

    const plausible = !(dtS > 0 && segDist / dtS > MAX_PLAUSIBLE_SEGMENT_SPEED_MPS);

    if (plausible) {
      distanceM += segDist;
    }

    if (prev.ele != null && curr.ele != null) {
      const dEle = curr.ele - prev.ele;
      if (dEle > 0) elevationGainM += dEle;
    }
  }

  return {
    distanceM,
    movingTimeS: computeMovingTimeS(points),
    elevationGainM,
  };
}

/**
 * Compute moving time over an ordered list of points.
 *
 * A segment counts as moving when the net displacement over the trailing
 * MOVING_SPEED_WINDOW_S window ending at the segment's end is at least
 * MOVING_SPEED_THRESHOLD_MPS. Raw per-segment speed (distance between two
 * consecutive fixes divided by the time between them) is dominated by GPS
 * position jitter: with fixes roughly once per second and several meters of
 * horizontal error, a stationary receiver registers per-second "speeds" of
 * 1-2+ m/s while a steady casual walk often registers below the old 5 km/h
 * threshold. Both effects made stored moving times far too short, which in
 * turn made the average speed (distance / moving time) wildly exceed the
 * windowed max speed.
 *
 * Segments that look like GPS lock jumps are skipped, mirroring the
 * distance plausibility test in computeTrackSegmentTotals.
 */
function computeMovingTimeS(points: GpxPoint[]): number {
  const timed = points.filter(
    (p): p is GpxPoint & { time: Date } => p.time != null
  );
  if (timed.length < 2) return 0;

  let movingTimeS = 0;
  let windowStart = 0;
  for (let i = 1; i < timed.length; i++) {
    const prev = timed[i - 1];
    const curr = timed[i];
    const dtS = (curr.time.getTime() - prev.time.getTime()) / 1000;
    if (dtS <= 0) continue;

    if (haversineM(prev, curr) / dtS > MAX_PLAUSIBLE_SEGMENT_SPEED_MPS) {
      continue;
    }

    // Oldest point still within the trailing window (moves forward only).
    while (
      windowStart < i &&
      (curr.time.getTime() - timed[windowStart].time.getTime()) / 1000 >
        MOVING_SPEED_WINDOW_S
    ) {
      windowStart++;
    }
    const winTimeS =
      (curr.time.getTime() - timed[windowStart].time.getTime()) / 1000;
    // Too little history (track start, or a gap longer than the window):
    // fall back to the segment's own speed.
    const speed =
      winTimeS >= Math.min(MOVING_SPEED_WINDOW_S / 2, 4)
        ? haversineM(timed[windowStart], curr) / winTimeS
        : haversineM(prev, curr) / dtS;

    if (speed >= MOVING_SPEED_THRESHOLD_MPS) movingTimeS += dtS;
  }

  return movingTimeS;
}

/**
 * Compute track stats from an ordered list of points. Shared by the GPX
 * and TCX parsers and the track trim endpoint.
 */
export function computeTrackStats(
  points: GpxPoint[],
  name: string,
  activityType: string | null
): TrackStats {
  if (points.length < 2) {
    throw new Error('Track has fewer than 2 points');
  }

  // --- Distances / times / speeds ---
  const { distanceM, movingTimeS: rawMovingTimeS, elevationGainM } =
    computeTrackSegmentTotals(points);
  let movingTimeS = rawMovingTimeS;

  const timedPoints = points.filter(
    (p): p is GpxPoint & { time: Date } => p.time != null
  );
  const maxSpeedMps = computeMaxSpeedMps(timedPoints);

  // --- Timestamps ---
  if (timedPoints.length === 0) {
    throw new Error('Invalid GPX file: no timestamps found in track');
  }
  let startedAt: Date;
  let endedAt: Date;
  if (timedPoints.length >= 2) {
    startedAt = timedPoints.reduce<Date>((min, p) => (p.time < min ? p.time : min), timedPoints[0].time);
    endedAt = timedPoints.reduce<Date>((max, p) => (p.time > max ? p.time : max), timedPoints[0].time);
  } else {
    startedAt = timedPoints[0].time;
    endedAt = timedPoints[0].time;
  }

  const elapsedMs = endedAt.getTime() - startedAt.getTime();
  const elapsedTimeS = Math.max(0, Math.round(elapsedMs / 1000));
  if (movingTimeS > elapsedTimeS) movingTimeS = elapsedTimeS;
  movingTimeS = Math.round(movingTimeS);

  let avgSpeedMps = movingTimeS > 0 ? distanceM / movingTimeS : 0;

  // Average speed is based on path length while max speed is based on net
  // displacement over a window, so on a winding trail the average can
  // structurally exceed the max. An average above the max is impossible, so
  // cap it.
  if (maxSpeedMps > 0 && avgSpeedMps > maxSpeedMps) avgSpeedMps = maxSpeedMps;

  // --- Heart rate ---
  const hrs = points
    .map((p) => p.hr)
    .filter((v): v is number => v != null);
  const avgHr = hrs.length > 0 ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : null;
  const maxHr = hrs.length > 0 ? Math.max(...hrs) : null;

  // --- Geometry ---
  const coordinates: [number, number][] = points.map((p) => [p.lon, p.lat]);
  const wktLineString =
    `LINESTRING(` +
    coordinates.map(([lon, lat]) => `${lon} ${lat}`).join(', ') +
    `)`;

  const pointsSeries: GpxPointSeries[] = points.map((p) => ({
    t: p.time ? p.time.getTime() : null,
    ele: p.ele,
    hr: p.hr,
  }));

  return {
    name,
    activityType,
    startedAt,
    endedAt,
    distanceM: Math.round(distanceM),
    elapsedTimeS,
    movingTimeS,
    elevationGainM: Math.round(elevationGainM),
    avgSpeedMps: Math.round(avgSpeedMps * 100) / 100,
    maxSpeedMps: Math.round(maxSpeedMps * 100) / 100,
    avgHr,
    maxHr,
    pointCount: points.length,
    wktLineString,
    coordinates,
    points: pointsSeries,
  };
}

export function parseGpx(
  xml: string,
  fallbackName: string
): TrackStats {
  const parser = makeParser();

  let doc: any;
  try {
    doc = parser.parse(xml);
  } catch {
    throw new Error('Invalid GPX file: could not parse XML');
  }

  const trk = doc?.gpx?.trk ?? doc?.trk;
  if (!trk) {
    throw new Error('Invalid GPX file: no <trk> element found');
  }

  const trkNameRaw = trk.name;
  const name =
    (typeof trkNameRaw === 'string' && trkNameRaw.trim()) || fallbackName;

  const trkTypeRaw = trk.type;
  const activityType =
    typeof trkTypeRaw === 'string' && trkTypeRaw.trim() ? trkTypeRaw.trim() : null;

  const segments = toNumberArray(trk.trkseg);
  const points: GpxPoint[] = [];
  for (const seg of segments) {
    for (const trkpt of toNumberArray((seg as any)?.trkpt)) {
      const p = parsePoint(trkpt);
      if (p) points.push(p);
    }
  }

  if (points.length < 2) {
    throw new Error('Invalid GPX file: track has fewer than 2 points');
  }

  return computeTrackStats(points, name, activityType);
}

/** Parse a Garmin TCX (TrainingCenterDatabase) file. */
export function parseTcx(
  xml: string,
  fallbackName: string
): TrackStats {
  const parser = makeParser();

  let doc: any;
  try {
    doc = parser.parse(xml);
  } catch {
    throw new Error('Invalid TCX file: could not parse XML');
  }

  const db = doc?.TrainingCenterDatabase ?? doc;
  const activities = toNumberArray(db?.Activities?.Activity);
  if (activities.length === 0) {
    throw new Error('Invalid TCX file: no <Activity> element found');
  }

  const activity: any = activities[0];
  const sportRaw = activity?.['@_Sport'];
  const activityType =
    typeof sportRaw === 'string' && sportRaw.trim() ? sportRaw.trim() : null;

  // Optional <Name> inside a tpx extension (not always present)
  const extName =
    activity?.tpx_Extension?.Name ?? activity?.Extension?.Name;
  const name =
    (typeof extName === 'string' && extName.trim()) || fallbackName;

  const points: GpxPoint[] = [];
  for (const lap of toNumberArray(activity?.Lap)) {
    for (const tp of toNumberArray((lap as any)?.Track?.Trackpoint)) {
      const p = parseTcxPoint(tp);
      if (p) points.push(p);
    }
  }

  if (points.length < 2) {
    throw new Error('Invalid TCX file: track has fewer than 2 points');
  }

  return computeTrackStats(points, name, activityType);
}

/** Parse a GPX or TCX file based on its extension. */
export function parseTrackFile(
  xml: string,
  ext: string,
  fallbackName: string
): TrackStats {
  if (ext.toLowerCase() === '.tcx') {
    return parseTcx(xml, fallbackName);
  }
  return parseGpx(xml, fallbackName);
}

/**
 * Extract the raw per-point data from a GPX or TCX file (no stats computed).
 * Used by the backup export to compare a track's stored points against the
 * original uploaded file. Throws on unparsable input.
 */
export function parseTrackPoints(xml: string, ext: string): GpxPoint[] {
  const parser = makeParser();
  let doc: any;
  try {
    doc = parser.parse(xml);
  } catch {
    throw new Error('Invalid track file: could not parse XML');
  }

  const points: GpxPoint[] = [];
  if (ext.toLowerCase() === '.tcx') {
    const db = doc?.TrainingCenterDatabase ?? doc;
    const activities = toNumberArray(db?.Activities?.Activity);
    for (const activity of activities) {
      for (const lap of toNumberArray((activity as any)?.Lap)) {
        for (const tp of toNumberArray((lap as any)?.Track?.Trackpoint)) {
          const p = parseTcxPoint(tp);
          if (p) points.push(p);
        }
      }
    }
  } else {
    const trk = doc?.gpx?.trk ?? doc?.trk;
    if (!trk) throw new Error('Invalid GPX file: no <trk> element found');
    for (const seg of toNumberArray(trk.trkseg)) {
      for (const trkpt of toNumberArray((seg as any)?.trkpt)) {
        const p = parsePoint(trkpt);
        if (p) points.push(p);
      }
    }
  }
  return points;
}

import { XMLParser } from 'fast-xml-parser';

export interface GpxPoint {
  lat: number;
  lon: number;
  ele: number | null;
  time: Date | null;
  hr: number | null;
}

export interface TrackStats {
  name: string;
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
}

const EARTH_RADIUS_M = 6371000;
/** Segments slower than this (~5 km/h) are treated as stopped, not "moving". */
const MOVING_SPEED_THRESHOLD_MPS = 1.4;

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

export function parseGpx(
  xml: string,
  fallbackName: string
): TrackStats {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: true,
    trimValues: true,
  });

  let doc: any;
  try {
    doc = parser.parse(xml);
  } catch (err) {
    throw new Error('Invalid GPX file: could not parse XML');
  }

  const trk = doc?.gpx?.trk ?? doc?.trk;
  if (!trk) {
    throw new Error('Invalid GPX file: no <trk> element found');
  }

  const trkNameRaw = trk.name;
  const name =
    (typeof trkNameRaw === 'string' && trkNameRaw.trim()) || fallbackName;

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

  // --- Distances / times / speeds ---
  let distanceM = 0;
  let movingTimeS = 0;
  let maxSpeedMps = 0;
  let elevationGainM = 0;

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    distanceM += haversineM(prev, curr);

    if (prev.ele != null && curr.ele != null) {
      const dEle = curr.ele - prev.ele;
      if (dEle > 0) elevationGainM += dEle;
    }

    if (prev.time && curr.time) {
      const dtS = (curr.time.getTime() - prev.time.getTime()) / 1000;
      if (dtS > 0) {
        const segDist = haversineM(prev, curr);
        const speed = segDist / dtS;
        if (speed >= MOVING_SPEED_THRESHOLD_MPS) {
          movingTimeS += dtS;
          if (speed > maxSpeedMps) maxSpeedMps = speed;
        }
      }
    }
  }

  // --- Timestamps ---
  const timed = points.filter((p) => p.time) as (GpxPoint & { time: Date })[];
  if (timed.length === 0) {
    throw new Error('Invalid GPX file: no timestamps found in track');
  }
  let startedAt: Date;
  let endedAt: Date;
  if (timed.length >= 2) {
    startedAt = timed.reduce<Date>((min, p) => (p.time < min ? p.time : min), timed[0].time);
    endedAt = timed.reduce<Date>((max, p) => (p.time > max ? p.time : max), timed[0].time);
  } else {
    startedAt = timed[0].time;
    endedAt = timed[0].time;
  }

  const elapsedMs = endedAt.getTime() - startedAt.getTime();
  const elapsedTimeS = Math.max(0, Math.round(elapsedMs / 1000));
  if (movingTimeS > elapsedTimeS) movingTimeS = elapsedTimeS;
  movingTimeS = Math.round(movingTimeS);

  const avgSpeedMps = movingTimeS > 0 ? distanceM / movingTimeS : 0;

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

  return {
    name,
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
  };
}

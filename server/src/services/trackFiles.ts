import fs from 'fs';
import path from 'path';
import { config } from '../config';
import type { GpxPointSeries } from './gpx';

/**
 * Garmin TCX/fit exports name files as:
 *   YYYY-MM-DD_HH-MM-SS_<ActivityName>_<Sport>.tcx
 * e.g. `2010-07-23_16-16-02_Afternoon Ride_MtnBiking.tcx`
 *
 * When the file's own <type> / @Sport is missing or a generic placeholder
 * ("Other", "Unknown"), the sport token in the filename is usually the
 * best available source for the activity type.
 */

const SPORT_ALIASES: Record<string, string> = {
  mtnbiking: 'Mountain Biking',
  mtbiking: 'Mountain Biking',
  mountainbiking: 'Mountain Biking',
  downhillskiing: 'Downhill Skiing',
  crosscountryskiing: 'Cross-Country Skiing',
  alpineskiing: 'Alpine Skiing',
  backcountryskiing: 'Backcountry Skiing',
  horsebackriding: 'Horseback Riding',
  motorizedbiking: 'Motorized Biking',
  rockclimbing: 'Rock Climbing',
  virtualrun: 'Virtual Run',
  virtualbike: 'Virtual Bike',
  virtualwalk: 'Virtual Walk',
  stepmill: 'Step Mill',
  snowshoeing: 'Snowshoeing',
  kitesurfing: 'Kitesurfing',
  surfing: 'Surfing',
  snowboarding: 'Snowboarding',
  racquetball: 'Racquetball',
  fishing: 'Fishing',
  kayaking: 'Kayaking',
  motorcycling: 'Motorcycling',
  biking: 'Cycling',
  cycling: 'Cycling',
  running: 'Running',
  walking: 'Walking',
  swimming: 'Swimming',
  hiking: 'Hiking',
  elliptical: 'Elliptical',
  rowing: 'Rowing',
  skating: 'Skating',
  sailing: 'Sailing',
  stroller: 'Stroller',
  yoga: 'Yoga',
  zumba: 'Zumba',
  pilates: 'Pilates',
  tennis: 'Tennis',
  golf: 'Golf',
  fitness: 'Fitness',
  skiing: 'Skiing',
};

function formatSportToken(raw: string): string {
  const cleaned = raw.trim();
  if (!cleaned) return '';
  const aliasKey = cleaned.toLowerCase().replace(/[^a-z0-9]/g, '');
  const alias = SPORT_ALIASES[aliasKey];
  if (alias) return alias;
  // Split CamelCase boundaries ("DownhillSkiing" → "Downhill Skiing") and
  // normalize any internal hyphens/underscores to spaces, then title-case.
  const spaced = cleaned
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!spaced) return '';
  return spaced
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Attempt to derive a display-friendly activity type from a Garmin-style
 * track filename. Returns null when the filename does not match the expected
 * `YYYY-MM-DD_HH-MM-SS_<name>_<sport>.<ext>` pattern.
 */
export function deriveActivityTypeFromFilename(originalname: string): string | null {
  if (!originalname) return null;
  const base = originalname.replace(/\.(gpx|tcx)$/i, '');
  const parts = base.split('_');
  if (parts.length < 4) return null;
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  const timeRe = /^\d{2}-\d{2}-\d{2}$/;
  if (!dateRe.test(parts[0]) || !timeRe.test(parts[1])) return null;
  const sportToken = parts[parts.length - 1].trim();
  if (!sportToken) return null;
  return formatSportToken(sportToken) || null;
}

/**
 * Directory where the original uploaded track files are kept, per user:
 * <dataDir>/<userId>/uploads/gps_tracks/
 */
export function gpsTracksDir(userId: string): string {
  return path.join(config.dataDir, userId, 'uploads', 'gps_tracks');
}

/**
 * Move a freshly uploaded (temp) file into the user's gps_tracks folder,
 * named after the track id (preserving the original file extension).
 * Returns the final path.
 */
export function storeUploadedTrack(
  userId: string,
  tmpPath: string,
  trackId: string,
  ext: string
): string {
  const dir = gpsTracksDir(userId);
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `${trackId}${ext.toLowerCase()}`);
  // copy + unlink instead of rename so this works across filesystems
  // (e.g. tmpfs /tmp -> mounted data volume in Docker)
  fs.copyFileSync(tmpPath, dest);
  fs.unlinkSync(tmpPath);
  return dest;
}

/** Path of the stored original file for a track, or null if not present. */
export function storedTrackPath(userId: string, trackId: string): string | null {
  const dir = gpsTracksDir(userId);
  for (const ext of ['.gpx', '.tcx']) {
    const candidate = path.join(dir, `${trackId}${ext}`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/** Remove the stored original file(s) for a track. */
export function deleteStoredTrack(userId: string, trackId: string): void {
  const dir = gpsTracksDir(userId);
  for (const ext of ['.gpx', '.tcx']) {
    const candidate = path.join(dir, `${trackId}${ext}`);
    fs.unlink(candidate, () => {});
  }
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export interface GpxExportTrack {
  id: string;
  name: string;
  activityType: string | null;
  /** [lon, lat] per point, in track order */
  coordinates: [number, number][];
  /** Per-point series (t in epoch ms), or null for legacy tracks */
  points: GpxPointSeries[] | null;
}

/**
 * Build a GPX 1.1 document from the current track state in the database.
 * Reflects any edits to the track details (name, activity type) as well as
 * the stored geometry / per-point data.
 */
export function buildGpx(track: GpxExportTrack): string {
  const lines: string[] = [];
  lines.push(
    '<?xml version="1.0" encoding="UTF-8"?>'
  );
  lines.push(
    '<gpx version="1.1" creator="WhereWeWere" ' +
      'xmlns="http://www.topografix.com/GPX/1/1" ' +
      'xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">'
  );
  lines.push('  <trk>');
  lines.push(`    <name>${escapeXml(track.name)}</name>`);
  if (track.activityType) {
    lines.push(`    <type>${escapeXml(track.activityType)}</type>`);
  }
  lines.push('    <trkseg>');
  for (let i = 0; i < track.coordinates.length; i++) {
    const [lon, lat] = track.coordinates[i];
    const point = track.points?.[i];
    lines.push(`    <trkpt lat="${lat}" lon="${lon}">`);
    if (point?.ele != null) {
      lines.push(`      <ele>${point.ele}</ele>`);
    }
    if (point?.t != null) {
      lines.push(`      <time>${new Date(point.t).toISOString()}</time>`);
    }
    if (point?.hr != null) {
      lines.push(
        '      <extensions><gpxtpx:TrackPointExtension>' +
          `<gpxtpx:hr>${point.hr}</gpxtpx:hr>` +
          '</gpxtpx:TrackPointExtension></extensions>'
      );
    }
    lines.push('    </trkpt>');
  }
  lines.push('    </trkseg>');
  lines.push('  </trk>');
  lines.push('</gpx>');
  return lines.join('\n');
}

/** Sanitize a track name into a safe .gpx download filename. */
export function gpxDownloadFilename(track: GpxExportTrack): string {
  const base = (track.name || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '').trim();
  return `${base || `track-${track.id}`}.gpx`;
}

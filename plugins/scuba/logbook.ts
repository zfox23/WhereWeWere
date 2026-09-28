/**
 * Diving Log (diving-log 4.x) logbook backup parser.
 *
 * A Diving Log "backup .sql" file is actually a SQLite 3 database whose
 * `Logbook` table holds one row per dive. This module opens the file with
 * Node's built-in `node:sqlite` (read-only), joins the reference tables
 * (Place / City / Country / Shop / Trip / Divetype), and maps each row to a
 * generic plugin check-in (checked_in_at + checkin_timezone + `data`).
 *
 * Diving Log stores metric values: meters, °C, bar, kg, minutes — the
 * plugin's manifest fields use the same units.
 */

import { DatabaseSync } from 'node:sqlite';
import { find as findTimezone } from 'geo-tz';

export interface LogbookImportRow {
  checked_in_at: string;
  checkin_timezone: string;
  data: Record<string, unknown>;
}

export interface LogbookImportResult {
  total: number;
  rows: LogbookImportRow[];
  errors: string[];
}

// ---------------------------------------------------------------------------
// Reference-table row shapes (only the columns we need)
// ---------------------------------------------------------------------------

interface PlaceRow {
  ID: number;
  Place: string | null;
  Lat: string | null;
  Lon: string | null;
}

interface DivetypeRow {
  ID: number;
  Typename: string | null;
}

interface BuddyRow {
  ID: number;
  FirstName: string | null;
  LastName: string | null;
}

/** Parse a DMS coordinate like `36°36'35.3"N` or `121°53'37.3"W`. */
export function parseDmsCoordinate(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = value
    .trim()
    .replace(/°/g, ' ')
    .replace(/'/g, ' ')
    .replace(/"/g, ' ')
    .match(/^(-?\d+(?:\.\d+)?)\s*(\d+(?:\.\d+)?)\s*(\d+(?:\.\d+)?)\s*([NSnsEWew])$/);
  if (!match) return null;
  const deg = Number(match[1]);
  const min = Number(match[2]);
  const sec = Number(match[3]);
  const sign = match[4].toUpperCase() === 'S' || match[4].toUpperCase() === 'W' ? -1 : 1;
  return sign * (deg + min / 60 + sec / 3600);
}

/** Round to 2 decimals, dropping trailing zeros (for tidy stored numbers). */
function round2(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(value * 100) / 100;
}

function asText(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function asNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function asInt(value: unknown): number | null {
  const num = asNumber(value);
  return num == null ? null : Math.trunc(num);
}

// ---------------------------------------------------------------------------
// Timezone / timestamp helpers
// ---------------------------------------------------------------------------

/** Parse a `shortOffset` label like 'GMT-8' / 'GMT+5:30' / 'UTC' into minutes. */
function parseShortOffset(offsetToken: string): number {
  if (offsetToken === 'GMT' || offsetToken === 'UTC') return 0;
  const match = offsetToken.match(/^(?:GMT|UTC)?([+-])(\d{1,2})(?::?(\d{2}))?$/);
  if (!match) return 0;
  const sign = match[1] === '-' ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3] || '0'));
}

/** The UTC offset (minutes east) of `timeZone` at the instant `utcMs`. */
export function tzOffsetMinutes(utcMs: number, timeZone: string): number {
  let tzName = 'UTC';
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'shortOffset',
    });
    tzName = formatter.formatToParts(new Date(utcMs)).find((p) => p.type === 'timeZoneName')?.value || 'UTC';
  } catch {
    tzName = 'UTC';
  }
  return parseShortOffset(tzName);
}

/**
 * Convert a local wall-clock date/time in `timeZone` to a UTC ISO instant.
 * Iterates to resolve DST ambiguity around the wall-clock time.
 */
export function localTimeToIso(
  date: string,
  time: string,
  timeZone: string,
): string | null {
  const dateMatch = date.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!dateMatch) return null;
  const timeMatch = (time || '').trim().match(/^(\d{1,2}):(\d{2})/);
  const hour = timeMatch ? Number(timeMatch[1]) : 0;
  const minute = timeMatch ? Number(timeMatch[2]) : 0;
  if (hour > 23 || minute > 59) return null;

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const baseUtc = Date.UTC(year, month - 1, day, hour, minute, 0);

  let utcMs = baseUtc;
  for (let i = 0; i < 3; i++) {
    const offsetMinutes = tzOffsetMinutes(utcMs, timeZone);
    const nextUtc = baseUtc - offsetMinutes * 60000;
    if (Math.abs(nextUtc - utcMs) < 1000) {
      utcMs = nextUtc;
      break;
    }
    utcMs = nextUtc;
  }
  return new Date(utcMs).toISOString();
}

/** IANA label for a whole-hour (or null) UTC offset in minutes east. */
function offsetMinutesToIana(offsetMinutes: number): string {
  if (offsetMinutes % 60 !== 0) return 'UTC';
  const hours = offsetMinutes / 60;
  if (hours === 0) return 'UTC';
  // Etc/GMT sign is inverted relative to the UTC offset.
  return `Etc/GMT${hours > 0 ? '-' : '+'}${Math.abs(hours)}`;
}

// ---------------------------------------------------------------------------
// Enum mapping for Diving Log's integer enums
// ---------------------------------------------------------------------------

const WATER_TYPE: Record<number, string> = { 1: 'salt', 2: 'fresh', 3: 'brackish' };
const ENTRY_METHOD: Record<number, string> = { 0: 'pool', 1: 'shore', 2: 'boat' };
const TANK_TYPE: Record<number, string> = { 1: 'aluminum', 2: 'steel' };

// ---------------------------------------------------------------------------
// Main parse
// ---------------------------------------------------------------------------

export function parseDivingLogBackup(
  absPath: string,
  fallbackTimezone: string,
): LogbookImportResult {
  const db = new DatabaseSync(absPath, { readOnly: true });
  try {
    const tables = new Set(
      (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map(
        (t) => t.name,
      ),
    );
    if (!tables.has('Logbook')) {
      throw new Error('Not a Diving Log backup: missing Logbook table');
    }

    // Reference tables.
    const places = new Map<number, PlaceRow>();
    if (tables.has('Place')) {
      for (const row of db.prepare('SELECT ID, Place, Lat, Lon FROM Place').all() as unknown as PlaceRow[]) {
        places.set(row.ID, row);
      }
    }
    const divetypes = new Map<number, string>();
    if (tables.has('Divetype')) {
      for (const row of db.prepare('SELECT ID, Typename FROM Divetype').all() as unknown as DivetypeRow[]) {
        if (row.Typename) divetypes.set(row.ID, row.Typename);
      }
    }
    const buddies = new Map<number, string>();
    if (tables.has('Buddy')) {
      for (const row of db.prepare('SELECT ID, FirstName, LastName FROM Buddy').all() as unknown as BuddyRow[]) {
        const name = [asText(row.FirstName), asText(row.LastName)].filter(Boolean).join(' ');
        if (name) buddies.set(row.ID, name);
      }
    }
    const shopName = (id: number | null): string | null => {
      if (id == null || !tables.has('Shop')) return null;
      const row = db.prepare('SELECT ShopName FROM Shop WHERE ID = ?').get(id) as { ShopName: string | null } | undefined;
      return asText(row?.ShopName);
    };
    const tripName = (id: number | null): string | null => {
      if (id == null || !tables.has('Trip')) return null;
      const row = db.prepare('SELECT TripName FROM Trip WHERE ID = ?').get(id) as { TripName: string | null } | undefined;
      return asText(row?.TripName);
    };

    const rows: LogbookImportRow[] = [];
    const errors: string[] = [];

    const logbook = db.prepare(
      `SELECT ID, Number, Divedate, Entrytime, Surfint, Country, City, Place, PlaceID,
              Divetime, Depth, DepthAvg, Buddy, BuddyIDs, Comments,
              Water, Entry, Divetype, Tanktype, Tanksize, PresS, PresE, PresW,
              Gas, Weather, UWCurrent, Surface, Visibility, Airtemp, Watertemp, Weight,
              Deco, Decostops, Rep, Altitude, Divesuit, Computer, UsedEquip,
              VisHor, VisVer, CNS, PGStart, PGEnd, Divemaster, Boat, Rating,
              O2, He, DblTank, SupplyType, MinPPO2, MaxPPO2,
              ShopID, TripID, UtcOffset, DesaturationTime, NoFlyTime, ScrubberTime,
              UUID
       FROM Logbook
       ORDER BY Divedate ASC, ID ASC`,
    ).all() as Record<string, unknown>[];

    for (const row of logbook) {
      const diveNumber = asInt(row.Number) ?? asInt(row.ID);
      const label = `Dive #${diveNumber ?? '?'}`;

      const date = asText(row.Divedate);
      if (!date || !/^\d{4}-\d{1,2}-\d{1,2}$/.test(date)) {
        errors.push(`${label}: missing or invalid Divedate (${String(row.Divedate)})`);
        continue;
      }

      const data: Record<string, unknown> = {};
      const set = (key: string, value: unknown) => {
        if (value != null && value !== '') data[key] = value;
      };

      // Location (Place table may carry coordinates for the site).
      const place = asText(row.Place);
      const placeRow = row.PlaceID != null ? places.get(Number(row.PlaceID)) : undefined;
      set('place', place ?? placeRow?.Place);
      set('city', asText(row.City));
      set('country', asText(row.Country));
      set('latitude', parseDmsCoordinate(placeRow?.Lat));
      set('longitude', parseDmsCoordinate(placeRow?.Lon));

      // When / how long.
      set('entry_time', asText(row.Entrytime));
      set('surface_interval', asText(row.Surfint));
      set('bottom_time', round2(asNumber(row.Divetime)));
      set('depth', round2(asNumber(row.Depth)));
      set('depth_avg', round2(asNumber(row.DepthAvg)));
      set('altitude', asText(row.Altitude));

      // Enums.
      const water = asInt(row.Water);
      set('water_type', water != null ? WATER_TYPE[water] : undefined);
      const entry = asInt(row.Entry);
      set('entry_method', entry != null ? ENTRY_METHOD[entry] : undefined);
      const tank = asInt(row.Tanktype);
      set('tank_type', tank != null ? TANK_TYPE[tank] : undefined);
      const divetype = asText(row.Divetype);
      if (divetype) {
        const names = divetype
          .split(',')
          .map((id) => divetypes.get(Number(id.trim())))
          .filter(Boolean)
          .join(', ');
        set('divetype', names.length > 0 ? names : divetype);
      }

      // People / vessel.
      const buddyIds = asText(row.BuddyIDs)?.split(',').map((s) => Number(s.trim()));
      const resolvedBuddies =
        buddyIds && buddyIds.length > 0
          ? buddyIds.map((id) => buddies.get(id)).filter(Boolean)
          : [];
      set('buddy', asText(row.Buddy) ?? (resolvedBuddies.length > 0 ? resolvedBuddies.join(', ') : undefined));
      set('divemaster', asText(row.Divemaster));
      set('boat_name', asText(row.Boat));

      // Conditions.
      set('weather', asText(row.Weather));
      set('surface_conditions', asText(row.Surface));
      set('uw_current', asText(row.UWCurrent));
      set('visibility', asInt(row.Visibility));
      set('vis_hor', asText(row.VisHor));
      set('vis_ver', asText(row.VisVer));
      set('air_temp', round2(asNumber(row.Airtemp)));
      set('water_temp', round2(asNumber(row.Watertemp)));

      // Equipment & gas.
      set('weight', round2(asNumber(row.Weight)));
      set('tank_size', round2(asNumber(row.Tanksize)));
      set('gas', asText(row.Gas));
      set('o2', round2(asNumber(row.O2)));
      set('he', round2(asNumber(row.He)));
      set('start_pressure', round2(asNumber(row.PresS)));
      set('end_pressure', round2(asNumber(row.PresE)));
      set('weight_pressure', round2(asNumber(row.PresW)));
      const supplyType = asInt(row.SupplyType);
      if (supplyType != null && supplyType > 0) set('supply_type', String(supplyType));
      set('min_ppo2', round2(asNumber(row.MinPPO2)));
      set('max_ppo2', round2(asNumber(row.MaxPPO2)));
      const dblTank = asInt(row.DblTank) === 1;
      if (dblTank) set('dbl_tank', true);

      set('divesuit', asText(row.Divesuit));
      set('computer', asText(row.Computer));
      set('used_equip', asText(row.UsedEquip));

      // Deco / residual nitrogen.
      const deco = asInt(row.Deco) === 1;
      if (deco) set('deco', true);
      set('deco_stops', asText(row.Decostops));
      const repetitive = asInt(row.Rep) === 1;
      if (repetitive) set('repetitive', true);
      set('desaturation_time', round2(asNumber(row.DesaturationTime)));
      set('no_fly_time', round2(asNumber(row.NoFlyTime)));
      set('scrubber_time', round2(asNumber(row.ScrubberTime)));
      set('cns', asText(row.CNS));
      set('pg_start', asText(row.PGStart));
      set('pg_end', asText(row.PGEnd));

      // Trip context.
      set('shop', shopName(row.ShopID != null ? Number(row.ShopID) : null));
      set('trip', tripName(row.TripID != null ? Number(row.TripID) : null));

      // Rating & comments.
      const rating = asInt(row.Rating);
      if (rating != null && rating > 0) set('rating', Math.min(5, rating));
      set('comments', asText(row.Comments));

      // Provenance (extra keys, not part of the field schema).
      set('source_app', 'Diving Log');
      set('source_id', asInt(row.ID));
      set('source_number', asInt(row.Number));
      set('source_uuid', asText(row.UUID));

      // Timestamp: prefer the stored UtcOffset, then the site's coordinates
      // (geo-tz), then the caller-supplied fallback timezone.
      const utcOffset = asInt(row.UtcOffset);
      let checkinTimezone: string;
      let checkedInAt: string | null;
      if (utcOffset != null) {
        // The logbook row carries an explicit UTC offset in minutes east:
        // wall clock - offset = the UTC instant.
        const entryTime = asText(row.Entrytime) ?? '00:00';
        const hours = Number(entryTime.slice(0, 2)) || 0;
        const minutes = Number(entryTime.slice(3, 5)) || 0;
        checkedInAt = new Date(
          Date.UTC(
            Number(date.slice(0, 4)),
            Number(date.slice(5, 7)) - 1,
            Number(date.slice(8, 10)),
            hours, minutes, 0, 0,
          ) - utcOffset * 60000,
        ).toISOString();
        checkinTimezone = offsetMinutesToIana(utcOffset);
      } else {
        const lat = parseDmsCoordinate(placeRow?.Lat);
        const lon = parseDmsCoordinate(placeRow?.Lon);
        let tz: string | null = null;
        if (lat != null && lon != null) {
          try {
            const candidates = findTimezone(lat, lon);
            const candidate = Array.isArray(candidates) ? candidates[0] : candidates;
            if (typeof candidate === 'string') {
              try {
                new Intl.DateTimeFormat('en-US', { timeZone: candidate });
                tz = candidate;
              } catch {
                tz = null;
              }
            }
          } catch {
            tz = null;
          }
        }
        checkinTimezone = tz ?? fallbackTimezone;
        checkedInAt = localTimeToIso(date, asText(row.Entrytime) ?? '', checkinTimezone);
      }

      if (!checkedInAt) {
        errors.push(`${label}: could not build a timestamp for ${date} ${asText(row.Entrytime) ?? ''} in ${checkinTimezone}`);
        continue;
      }

      rows.push({ checked_in_at: checkedInAt, checkin_timezone: checkinTimezone, data });
    }

    return { total: logbook.length, rows, errors };
  } finally {
    db.close();
  }
}

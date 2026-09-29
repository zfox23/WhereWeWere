/**
 * SCUBA logbook parser tests: builds a small in-memory Diving Log-style
 * SQLite database on disk and verifies the mapping to plugin check-ins.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import {
  parseDivingLogBackup,
  parseDmsCoordinate,
  localTimeToIso,
} from '../logbook';

let tmpDir: string;
let dbPath: string;

const LOGBOOK_COLUMNS = `
  ID INTEGER PRIMARY KEY, Number INTEGER, Divedate TEXT, Entrytime TEXT, Surfint TEXT,
  Country TEXT, City TEXT, Place TEXT, PlaceID INTEGER,
  Divetime REAL, Depth REAL, DepthAvg REAL, Buddy TEXT, BuddyIDs TEXT, Comments TEXT,
  Water INTEGER, Entry INTEGER, Divetype TEXT, Tanktype INTEGER, Tanksize REAL,
  PresS REAL, PresE REAL, PresW REAL, Gas TEXT, Weather TEXT, UWCurrent TEXT, Surface TEXT,
  Visibility INTEGER, Airtemp REAL, Watertemp REAL, Weight REAL,
  Deco INTEGER, Decostops TEXT, Rep INTEGER, Altitude TEXT, Divesuit TEXT, Computer TEXT,
  UsedEquip TEXT, VisHor TEXT, VisVer TEXT, CNS TEXT, PGStart TEXT, PGEnd TEXT,
  Divemaster TEXT, Boat TEXT, Rating INTEGER, O2 REAL, He REAL, DblTank INTEGER,
  SupplyType INTEGER, MinPPO2 REAL, MaxPPO2 REAL,
  ShopID INTEGER, TripID INTEGER, UtcOffset INTEGER,
  DesaturationTime REAL, NoFlyTime REAL, ScrubberTime REAL, UUID TEXT
`;

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE Logbook (${LOGBOOK_COLUMNS});
    CREATE TABLE Place (ID INTEGER PRIMARY KEY, Place TEXT, Lat TEXT, Lon TEXT);
    CREATE TABLE Divetype (ID INTEGER PRIMARY KEY, Typename TEXT);
    CREATE TABLE Buddy (ID INTEGER PRIMARY KEY, FirstName TEXT, LastName TEXT);
    CREATE TABLE Shop (ID INTEGER PRIMARY KEY, ShopName TEXT);
    CREATE TABLE Trip (ID INTEGER PRIMARY KEY, TripName TEXT);

    INSERT INTO Divetype (ID, Typename) VALUES (1, 'Fun'), (8, 'Photography');
    INSERT INTO Buddy (ID, FirstName, LastName) VALUES (1, 'Olivia', 'Erickson'), (2, 'Ben', 'Hamme');
    INSERT INTO Shop (ID, ShopName) VALUES (1, 'Island Divers Hawaii');

    INSERT INTO Place (ID, Place, Lat, Lon) VALUES
      (1, 'San Carlos Beach', '36°36''35.3"N', '121°53''37.3"W'),
      (2, 'Epcot DiveQuest', NULL, NULL);

    -- Row 1: explicit UtcOffset (-480 = UTC-8), no place coords needed.
    INSERT INTO Logbook (ID, Number, Divedate, Entrytime, Place, PlaceID, City, Country,
        Divetime, Depth, Water, Entry, Tanktype, Divesuit, Rating, UtcOffset, UUID)
    VALUES (1, 1, '2020-06-19', '09:23', 'San Carlos Beach', 1, 'Monterey', 'United States',
        30.5, 10.0584, 1, 1, 1, '8mm Semi-Dry', 4, -480, 'AAAA-1111');

    -- Row 2: no UtcOffset; place has coords -> geo-tz (America/Los_Angeles,
    -- PDT in July). BuddyIDs + Divetype + Shop joins.
    INSERT INTO Logbook (ID, Number, Divedate, Entrytime, Place, PlaceID, City, Country,
        Divetime, Depth, Water, Entry, Tanktype, Divetype, BuddyIDs, ShopID,
        DepthAvg, PresS, PresE, DblTank, Deco, Rep, UtcOffset, UUID, Comments)
    VALUES (2, 2, '2019-07-04', '08:10', 'San Carlos Beach/Metridium Fields', 1, 'Monterey', 'United States',
        55, 11.5, 1, 2, 2, '1,8', '1,2', 1,
        9.75, 200, 60, 1, 0, 1, NULL, 'BBBB-2222', 'SAW A HARBOR SEAL!');

    -- Row 3: no UtcOffset and no place coords -> fallback timezone.
    INSERT INTO Logbook (ID, Number, Divedate, Entrytime, Place, PlaceID, City, Country,
        Divetime, Depth, Water, Entry, Tanktype, UUID)
    VALUES (3, 3, '2019-09-26', '18:23', 'Epcot DiveQuest', 2, 'Orlando', 'United States',
        40, 15, 1, 0, 1, 'CCCC-3333');

    -- Row 4: invalid date -> error.
    INSERT INTO Logbook (ID, Number, Divedate, Entrytime, Place, UUID)
    VALUES (4, 4, 'not-a-date', '10:00', 'Nowhere', 'DDDD-4444');
  `);
  return db;
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scuba-logbook-test-'));
  dbPath = path.join(tmpDir, 'logbook.sql');
  const db = makeDb();
  db.close();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('parseDmsCoordinate', () => {
  it('parses DMS north/west and south/east coordinates', () => {
    expect(parseDmsCoordinate('36°36\'35.3"N')).toBeCloseTo(36 + 36 / 60 + 35.3 / 3600, 6);
    expect(parseDmsCoordinate('121°53\'37.3"W')).toBeCloseTo(-(121 + 53 / 60 + 37.3 / 3600), 6);
    expect(parseDmsCoordinate('21°15\'0.0"S')).toBeCloseTo(-21.25, 6);
    expect(parseDmsCoordinate('158°7\'30.0"E')).toBeCloseTo(158 + 7 / 60 + 0.5 / 60, 6);
  });

  it('returns null for missing or malformed values', () => {
    expect(parseDmsCoordinate(null)).toBeNull();
    expect(parseDmsCoordinate('')).toBeNull();
    expect(parseDmsCoordinate('not a coordinate')).toBeNull();
  });
});

describe('localTimeToIso', () => {
  it('converts a local wall-clock time to a UTC instant', () => {
    // 2019-07-04 08:10 in America/Los_Angeles (PDT, UTC-7) -> 15:10 UTC.
    expect(localTimeToIso('2019-07-04', '08:10', 'America/Los_Angeles')).toBe('2019-07-04T15:10:00.000Z');
  });

  it('returns null for invalid dates', () => {
    expect(localTimeToIso('garbage', '10:00', 'UTC')).toBeNull();
  });
});

describe('parseDivingLogBackup', () => {
  it('maps rows to plugin check-ins with the right fields', () => {
    const result = parseDivingLogBackup(dbPath, 'America/New_York');
    expect(result.total).toBe(4);
    expect(result.rows).toHaveLength(3);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('Dive #4');

    // Row 1: explicit UtcOffset.
    const row1 = result.rows.find((r) => r.data.source_uuid === 'AAAA-1111')!;
    expect(row1.checked_in_at).toBe('2020-06-19T17:23:00.000Z');
    expect(row1.checkin_timezone).toBe('Etc/GMT+8');
    expect(row1.local_date).toBe('2020-06-19');
    expect(row1.timezone_source).toBe('utc_offset');
    expect(row1.data.place).toBe('San Carlos Beach');
    expect(row1.data.city).toBe('Monterey');
    expect(row1.data.country).toBe('United States');
    expect(row1.data.latitude).toBeCloseTo(36 + 36 / 60 + 35.3 / 3600, 5);
    expect(row1.data.longitude).toBeCloseTo(-(121 + 53 / 60 + 37.3 / 3600), 5);
    expect(row1.data.entry_time).toBe('09:23');
    expect(row1.data.bottom_time).toBe(30.5);
    expect(row1.data.depth).toBe(10.06);
    expect(row1.data.water_type).toBe('salt');
    expect(row1.data.entry_method).toBe('shore');
    expect(row1.data.tank_type).toBe('aluminum');
    expect(row1.data.divesuit).toBe('8mm Semi-Dry');
    expect(row1.data.rating).toBe(4);
    expect(row1.data.source_id).toBe(1);
    expect(row1.data.source_number).toBe(1);

    // Row 2: geo-tz from place coordinates + joined reference tables.
    const row2 = result.rows.find((r) => r.data.source_uuid === 'BBBB-2222')!;
    expect(row2.checkin_timezone).toBe('America/Los_Angeles');
    expect(row2.checked_in_at).toBe('2019-07-04T15:10:00.000Z');
    expect(row2.local_date).toBe('2019-07-04');
    expect(row2.timezone_source).toBe('geo');
    expect(row2.data.divetype).toBe('Fun, Photography');
    expect(row2.data.buddy).toBe('Olivia Erickson, Ben Hamme');
    expect(row2.data.shop).toBe('Island Divers Hawaii');
    expect(row2.data.entry_method).toBe('boat');
    expect(row2.data.tank_type).toBe('steel');
    expect(row2.data.dbl_tank).toBe(true);
    expect(row2.data.repetitive).toBe(true);
    expect(row2.data.depth_avg).toBe(9.75);
    expect(row2.data.start_pressure).toBe(200);
    expect(row2.data.end_pressure).toBe(60);
    expect(row2.data.comments).toBe('SAW A HARBOR SEAL!');

    // Row 3: fallback timezone for a place without coordinates.
    const row3 = result.rows.find((r) => r.data.source_uuid === 'CCCC-3333')!;
    expect(row3.checkin_timezone).toBe('America/New_York');
    expect(row3.checked_in_at).toBe('2019-09-26T22:23:00.000Z');
    expect(row3.local_date).toBe('2019-09-26');
    expect(row3.timezone_source).toBe('fallback');
    expect(row3.data.entry_method).toBe('pool');
  });

  it('rejects files that are not Diving Log backups', () => {
    const stray = path.join(tmpDir, 'stray.sql');
    const db = new DatabaseSync(stray);
    db.exec('CREATE TABLE Other (ID INTEGER)');
    db.close();
    expect(() => parseDivingLogBackup(stray, 'UTC')).toThrow(/missing Logbook table/);
  });
});

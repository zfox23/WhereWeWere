/**
 * SCUBA plugin server-half tests (no DB: SQL shape + llm rendering).
 * The import endpoint's file handling is covered by the logbook parser tests.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { server, parseLogbookForImport } from '../server';
import type { PluginLlmRow } from 'wwp-shared';

let tmpDir: string;
let dbPath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scuba-server-test-'));
  dbPath = path.join(tmpDir, 'logbook.sql');
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE Logbook (
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
    );
    -- Explicit stored offset (UTC-8).
    INSERT INTO Logbook (ID, Number, Divedate, Entrytime, Place, City, Country, Depth, UtcOffset, UUID)
    VALUES (1, 1, '2020-06-19', '09:23', 'Shore Break', 'Monterey', 'United States', 10, -480, 'UUID-A');
    -- No offset, no coords -> fallback.
    INSERT INTO Logbook (ID, Number, Divedate, Entrytime, Place, City, Country, Depth, UUID)
    VALUES (2, 2, '2019-09-26', '18:23', 'Mystery Wreck', 'Somewhere', 'Unknown', 15, 'UUID-B');
  `);
  db.close();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('parseLogbookForImport — timezone overrides', () => {
  it('matches the bare parser when no overrides are given', async () => {
    const result = await parseLogbookForImport(dbPath, 'America/New_York', undefined);
    expect(result.rows).toHaveLength(2);
    const rowA = result.rows.find((r) => r.data.source_uuid === 'UUID-A')!;
    expect(rowA.checkin_timezone).toBe('Etc/GMT+8');
    expect(rowA.checked_in_at).toBe('2020-06-19T17:23:00.000Z');
    const rowB = result.rows.find((r) => r.data.source_uuid === 'UUID-B')!;
    expect(rowB.checkin_timezone).toBe('America/New_York');
    expect(rowB.checked_in_at).toBe('2019-09-26T22:23:00.000Z');
  });

  it('re-anchors a row to the overridden zone using the logged wall clock', async () => {
    const result = await parseLogbookForImport(dbPath, 'America/New_York', {
      'UUID-A': 'America/New_York',
      'UUID-B': 'America/Los_Angeles',
    });
    // 2020-06-19 09:23 in America/New_York (EDT, UTC-4) -> 13:23 UTC.
    const rowA = result.rows.find((r) => r.data.source_uuid === 'UUID-A')!;
    expect(rowA.checkin_timezone).toBe('America/New_York');
    expect(rowA.checked_in_at).toBe('2020-06-19T13:23:00.000Z');
    // 2019-09-26 18:23 in America/Los_Angeles (PDT, UTC-7) -> 01:23 UTC.
    const rowB = result.rows.find((r) => r.data.source_uuid === 'UUID-B')!;
    expect(rowB.checkin_timezone).toBe('America/Los_Angeles');
    expect(rowB.checked_in_at).toBe('2019-09-27T01:23:00.000Z');
  });

  it('ignores invalid or no-op overrides', async () => {
    const result = await parseLogbookForImport(dbPath, 'UTC', {
      'UUID-A': 'Not/AZone', // invalid IANA id -> keep resolved zone
      'UUID-B': 'UTC', // same as resolved -> keep resolved zone
    });
    expect(result.rows.find((r) => r.data.source_uuid === 'UUID-A')!.checkin_timezone).toBe('Etc/GMT+8');
    expect(result.rows.find((r) => r.data.source_uuid === 'UUID-B')!.checkin_timezone).toBe('UTC');
  });
});

describe('scuba plugin — plugin shape', () => {
  it('uses generic storage and its two stable API mounts', () => {
    expect(server.storage).toBe('generic');
    const mounts = Array.isArray(server.api) ? server.api : [server.api as any];
    expect(mounts.map((m: any) => m.mount)).toEqual(['/scuba', '/import/scuba-logbook']);
    for (const mount of mounts) {
      expect(typeof mount.router).toBe('function');
      expect(Array.isArray(mount.router.stack)).toBe(true);
    }
  });

  it('provides the generic-storage cross-cutting hooks', () => {
    expect(server.reflectionBranch).toBeDefined();
    expect(server.earliestDate).toBeDefined();
    expect(server.resolveTimestamps).toBeDefined();
    expect(server.llm).toBeDefined();
    expect(server.reconcile).toBeDefined();
  });
});

describe('scuba plugin — reflection branch', () => {
  it('emits the scuba envelope and filters on user + month/day', () => {
    const sql = server.reflectionBranch!().sql;
    expect(sql).toContain("'scuba' AS type");
    expect(sql).toContain("pc.plugin_id = 'scuba'");
    expect(sql).toContain('pc.user_id = $1');
    expect(sql).toContain("TO_CHAR(pc.checked_in_at AT TIME ZONE COALESCE(pc.checkin_timezone, 'UTC'), 'MM-DD') = TO_CHAR($2::date, 'MM-DD')");
    expect(sql).toContain('reflection_year');
    expect(sql).toContain('years_ago');
    expect(sql).toContain('data');
  });
});

describe('scuba plugin — earliest date / timestamp hooks', () => {
  it('scopes earliestDate to scuba check-ins for the user', () => {
    const sql = server.earliestDate!().sql;
    expect(sql).toContain("plugin_id = 'scuba'");
    expect(sql).toContain('user_id = $1');
    expect(sql).toContain('MIN(');
  });

  it('resolves anchor timestamps for a uuid set', () => {
    const sql = server.resolveTimestamps!().sql;
    expect(sql).toContain("plugin_id = 'scuba'");
    expect(sql).toContain('$1::uuid[]');
  });
});

describe('scuba plugin — llm hook', () => {
  it('renders a one-line summary per dive', () => {
    const row: PluginLlmRow = {
      checked_in_at: '2019-07-04T15:10:00.000Z',
      timezone: 'America/Los_Angeles',
      data: {
        place: 'San Carlos Beach',
        city: 'Monterey',
        depth: 11.5,
        bottom_time: 55,
        comments: 'epic',
      },
    };
    const lines = server.llm!.toLines(row);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe('- dive San Carlos Beach, Monterey to 11.5 m 55 min — "epic"');
  });

  it('renders minimal dives without extras', () => {
    const lines = server.llm!.toLines({ checked_in_at: new Date(), timezone: null, data: {} });
    expect(lines).toEqual(['- dive']);
  });
});

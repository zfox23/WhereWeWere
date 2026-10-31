import request from 'supertest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, beforeAll, beforeEach, afterAll, it } from 'vitest';
import { query } from '../../../../server/src/db';
import {
  DEFAULT_USER_ID,
  resetIntegrationDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase,
} from '../../../../server/tests/helpers/testDb';
import { createTestUser } from '../../../../server/tests/helpers/auth';
import { runAsUser } from '../../../../server/src/auth/context';
// Importing the app registers every plugin (the scuba import looks its plugin up in the registry).
import { createApp } from '../../../../server/src/index';
import { executeScubaLogbookImport, server } from '../../server';

type Row = Parameters<typeof executeScubaLogbookImport>[0][number];

function dive(over: { uuid?: string; at: string; place: string; depth: number }): Row {
  return {
    source_row: 0,
    local_date: over.at.slice(0, 10),
    checked_in_at: over.at,
    checkin_timezone: 'UTC',
    timezone_source: 'test',
    data: {
      ...(over.uuid ? { source_uuid: over.uuid } : {}),
      place: over.place,
      depth: over.depth,
      entry_time: '09:00',
    },
  } as unknown as Row;
}

describe('Scuba logbook import (integration)', () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  });
  beforeEach(async () => {
    await resetIntegrationDatabase();
  });
  afterAll(async () => {
    await teardownIntegrationDatabase();
  });

  it('is idempotent for dives with a UUID and for dives without one', async () => {
    const rows = [
      dive({ uuid: 'U-1', at: '2024-03-01T09:00:00.000Z', place: 'Blue Hole', depth: 30 }),
      dive({ at: '2024-03-02T09:00:00.000Z', place: 'Reef', depth: 18 }),
      dive({ at: '2024-03-02T13:00:00.000Z', place: 'Reef', depth: 20 }),
    ];

    const first = await runAsUser(DEFAULT_USER_ID, () => executeScubaLogbookImport(rows));
    expect(first.imported).toBe(3);
    expect(first.imported_ids.every((id) => typeof id === 'string')).toBe(true);

    const second = await runAsUser(DEFAULT_USER_ID, () => executeScubaLogbookImport(rows));
    expect(second.imported).toBe(0);
    expect(second.skipped).toBe(3);
    expect(second.imported_ids).toEqual([null, null, null]);

    const count = await query(`SELECT COUNT(*)::int AS n FROM plugin_checkins WHERE plugin_id = 'scuba'`);
    expect(count.rows[0].n).toBe(3);
  });

  it('dedupes repeated dives inside a single import too', async () => {
    const d = dive({ at: '2024-04-01T09:00:00.000Z', place: 'Wall', depth: 25 });
    const result = await runAsUser(DEFAULT_USER_ID, () => executeScubaLogbookImport([d, { ...d }]));
    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(1);
  });

  describe('multi-user isolation', () => {
    const app = createApp();

    /** A minimal Diving Log 4.x backup (SQLite) with the given dives. */
    function logbookFile(dives: { uuid: string; date: string; place: string }[]): Buffer {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scuba-iso-'));
      const file = path.join(dir, 'logbook.sql');
      try {
        const db = new DatabaseSync(file);
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
          CREATE TABLE Place (ID INTEGER PRIMARY KEY, Place TEXT, Lat TEXT, Lon TEXT);
          CREATE TABLE Divetype (ID INTEGER PRIMARY KEY, Typename TEXT);
          CREATE TABLE Buddy (ID INTEGER PRIMARY KEY, FirstName TEXT, LastName TEXT);
          CREATE TABLE Shop (ID INTEGER PRIMARY KEY, ShopName TEXT);
          CREATE TABLE Trip (ID INTEGER PRIMARY KEY, TripName TEXT);
        `);
        const insert = db.prepare(
          `INSERT INTO Logbook (ID, Number, Divedate, Entrytime, Place, Divetime, Depth, UtcOffset, UUID)
           VALUES (?, ?, ?, '09:00', ?, 40, 18, 0, ?)`,
        );
        dives.forEach((d, i) => insert.run(i + 1, i + 1, d.date, d.place, d.uuid));
        db.close();
        return fs.readFileSync(file);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }

    it("imports into the uploader's account, deduping only against their own dives", async () => {
      const other = await createTestUser('other');
      const file = logbookFile([
        { uuid: 'U-1', date: '2024-03-01', place: 'Blue Hole' },
        { uuid: 'U-2', date: '2024-03-02', place: 'Reef' },
      ]);

      const mine = await request(app).post('/api/v1/import/scuba-logbook').attach('file', file, 'logbook.sql');
      expect(mine.status).toBe(200);
      expect(mine.body.imported).toBe(2);

      // The same logbook uploaded by someone else is not "already imported".
      const theirs = await request(app)
        .post('/api/v1/import/scuba-logbook')
        .set('Cookie', other.cookie)
        .attach('file', file, 'logbook.sql');
      expect(theirs.status).toBe(200);
      expect(theirs.body.imported).toBe(2);

      const counts = await query(
        `SELECT user_id, COUNT(*)::int AS c FROM plugin_checkins WHERE plugin_id = 'scuba' GROUP BY user_id ORDER BY user_id = $1`,
        [DEFAULT_USER_ID],
      );
      expect(counts.rows).toEqual([
        { user_id: other.id, c: 2 },
        { user_id: DEFAULT_USER_ID, c: 2 },
      ]);
    });

    it("stats only ever cover the signed-in user's dives", async () => {
      const other = await createTestUser('other');
      await runAsUser(DEFAULT_USER_ID, () =>
        executeScubaLogbookImport([dive({ uuid: 'U-1', at: '2024-03-01T09:00:00.000Z', place: 'Blue Hole', depth: 30 })]),
      );
      const q = { user_id: DEFAULT_USER_ID, from: '2024-01-01', to: '2024-12-31' };
      const base = '/api/v1/scuba/stats';

      const summary = await request(app).get(`${base}/summary`).set('Cookie', other.cookie).query(q);
      expect(summary.status).toBe(200);
      expect(summary.body.total_dives).toBe(0);
      for (const p of ['/by-year', '/by-water', '/by-type', '/top-sites']) {
        const res = await request(app).get(`${base}${p}`).set('Cookie', other.cookie).query(q);
        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);
      }
      expect((await request(app).get(`${base}/monthly`).set('Cookie', other.cookie).query({ ...q, year: 2024 })).body).toEqual([]);
      expect((await request(app).get(`${base}/earliest`).set('Cookie', other.cookie)).body).toEqual({ date: null });

      expect((await request(app).get(`${base}/summary`).query(q)).body.total_dives).toBe(1);
      expect((await request(app).get(`${base}/summary`).unset('Cookie')).status).toBe(401);
    });

    it("timezone reconciliation can't relabel another user's dive", async () => {
      const other = await createTestUser('other');
      const result = await runAsUser(DEFAULT_USER_ID, () =>
        executeScubaLogbookImport([dive({ uuid: 'U-1', at: '2024-03-01T09:00:00.000Z', place: 'Blue Hole', depth: 30 })]),
      );
      const id = result.imported_ids[0]!;
      expect(await runAsUser(other.id, () => server.reconcile!.apply(id, 'Asia/Tokyo'))).toBe(false);
      expect(await runAsUser(DEFAULT_USER_ID, () => server.reconcile!.apply(id, 'Asia/Tokyo'))).toBe(true);
    });
  });
});

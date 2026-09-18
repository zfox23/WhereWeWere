import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock, poolConnectMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  poolConnectMock: vi.fn(),
}));

vi.mock('../../../server/src/db', () => ({
  query: queryMock,
  pool: { connect: poolConnectMock },
}));

import { server } from '../server';
import { TIMELINE_COLUMNS } from '../../../server/src/plugins/timeline';
import type { PluginTimelineContext } from 'wwp-shared';

const baseCtx: PluginTimelineContext = {
  user_id: 'u1',
  from: null,
  to: null,
  q: null,
  filterParams: {},
};

beforeEach(() => {
  queryMock.mockReset();
  poolConnectMock.mockReset();
});

describe('tracks plugin — plugin shape', () => {
  it('declares custom storage mounted at the pre-plugin /tracks URL', () => {
    expect(server.storage).toBe('custom');
    const mounts = Array.isArray(server.api) ? server.api : [server.api as any];
    expect(mounts.map((m: any) => m.mount)).toEqual(['/tracks']);
    for (const mount of mounts) {
      // An express Router is a function with a `stack` (Express 5: an array).
      expect(typeof mount.router).toBe('function');
      expect(Array.isArray(mount.router.stack)).toBe(true);
    }
  });

  it('claims the legacy top-level backup key so old backups are claimed', () => {
    expect(server.legacyBackupKeys).toEqual(['tracks']);
  });
});

describe('tracks plugin — buildTimelineWhere', () => {
  it('combines user, date range, and search conditions with positional params', () => {
    const { sql, values } = server.buildTimelineWhere!({
      user_id: 'u1',
      from: '2026-02-01',
      to: '2026-02-28',
      q: 'night ride',
      filterParams: {},
    });
    expect(sql).toBe(
      "t.user_id = $1 " +
        "AND (t.started_at AT TIME ZONE COALESCE(t.timezone, 'UTC'))::date >= $2::date " +
        "AND (t.started_at AT TIME ZONE COALESCE(t.timezone, 'UTC'))::date <= $3::date " +
        `AND t.name ILIKE '%' || $4 || '%'`
    );
    expect(values).toEqual(['u1', '2026-02-01', '2026-02-28', 'night ride']);
  });

  it('maps the track_activity filter param to an activity_type match', () => {
    const { sql, values } = server.buildTimelineWhere!({
      ...baseCtx,
      filterParams: { track_activity: 'Cycling' },
    });
    expect(sql).toBe('t.user_id = $1 AND t.activity_type ILIKE $2');
    expect(values).toEqual(['u1', 'Cycling']);
  });

  it('ignores unknown filter params', () => {
    const { sql } = server.buildTimelineWhere!({
      ...baseCtx,
      filterParams: { bogus: 'x' },
    });
    expect(sql).toBe('t.user_id = $1');
  });
});

describe('tracks plugin — buildTimelineSelect', () => {
  it('emits every canonical timeline column (UNION alignment) with type "tracks"', () => {
    const { sql } = server.buildTimelineSelect!();
    for (const col of TIMELINE_COLUMNS) {
      expect(sql).toContain(`AS ${col.name}`);
    }
    expect(sql).toContain("'tracks' AS type");
    expect(sql).toContain('FROM tracks t');
    // The track card reads its domain columns from the envelope.
    expect(sql).toContain('t.name AS track_name');
    expect(sql).toContain('t.distance_m AS track_distance_m');
    expect(sql).toContain('t.timezone AS track_timezone');
    expect(sql).toContain('t.elapsed_time_s AS track_elapsed_time_s');
    expect(sql).toContain('t.timezone AS timezone');
  });

  it('anchors the timeline moment on the start of the track', () => {
    const { sql } = server.buildTimelineSelect!();
    expect(sql).toContain('t.started_at AS checked_in_at');
  });
});

describe('tracks plugin — llm hook', () => {
  it('gathers rows in the given date range', async () => {
    const rows = [
      {
        checked_in_at: '2013-05-31T13:41:00Z',
        timezone: 'UTC',
        data: {
          name: 'Night Ride',
          activity_type: 'Cycling',
          started_at: '2013-05-31T13:41:00Z',
          distance_m: 5200,
          elapsed_time_s: 5400,
        },
      },
    ];
    queryMock.mockResolvedValueOnce({ rows });
    const result = await server.llm!.gather('u1', '2013-05-01', '2013-05-31');
    expect(result).toEqual(rows);
    const [sql, values] = queryMock.mock.calls[0];
    expect(sql).toContain('FROM tracks');
    expect(values).toEqual(['u1', '2013-05-01', '2013-05-31']);
  });

  it('renders prompt lines with distance, duration, and optional activity type', () => {
    const row = (data: any, timezone: string | null = 'UTC') =>
      server.llm!.toLines({ checked_in_at: '', timezone, data } as any);

    expect(
      row({
        name: 'Night Ride',
        activity_type: 'Cycling',
        started_at: '2013-05-31T13:41:00Z',
        distance_m: 5200,
        elapsed_time_s: 5400,
      }),
    ).toEqual([
      '- May 31, 2013, 1:41 PM — Cycling track "Night Ride": 5.2 km in 1h 30m',
    ]);

    // No activity type: the type prefix is omitted; meters under a km.
    expect(
      row({
        name: 'Walk',
        activity_type: null,
        started_at: '2013-05-31T13:41:00Z',
        distance_m: 800,
        elapsed_time_s: 450,
      }),
    ).toEqual(['- May 31, 2013, 1:41 PM — track "Walk": 800 m in 8m']);
  });
});

describe('tracks plugin — reconcile hook', () => {
  it('is anchors-only (scanAll false) with the stable track detail path', () => {
    expect(server.reconcile!.detailPath('abc')).toBe('/tracks/abc');
    expect(server.reconcile!.anchorLabel).toBe('a track');
    expect(server.reconcile!.scanAll).toBe(false);
  });

  it('loads scan rows from tracks ordered by time', async () => {
    const rows = [
      { id: 't1', checked_in_at: '2026-03-10T23:30:00Z', original_timezone: 'America/New_York' },
      { id: 't2', checked_in_at: '2026-03-11T23:30:00Z', original_timezone: null },
    ];
    queryMock.mockResolvedValueOnce({ rows });
    const result = await server.reconcile!.loadCheckins('u1');
    expect(result).toEqual(rows);
    const [sql, values] = queryMock.mock.calls[0];
    expect(sql).toContain('FROM tracks');
    expect(sql).toContain('ORDER BY started_at ASC');
    expect(values).toEqual(['u1']);
  });

  it('applies a label-only timezone correction', async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 1 });
    expect(await server.reconcile!.apply('t1', 'Europe/Lisbon')).toBe(true);
    const [sql, values] = queryMock.mock.calls[0];
    expect(sql).toContain('UPDATE tracks');
    expect(sql).toContain('SET timezone = $2');
    expect(values).toEqual(['t1', 'Europe/Lisbon']);
  });

  it('reports failure when no row was updated', async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 0 });
    expect(await server.reconcile!.apply('missing', 'Europe/Lisbon')).toBe(false);
  });
});

describe('tracks plugin — core service hooks', () => {
  it('provides photo/scrobble anchor timestamps for check-in ids', () => {
    const { sql } = server.resolveTimestamps!();
    expect(sql).toBe(
      'SELECT id, started_at AS checked_in_at FROM tracks WHERE id = ANY($1::uuid[])',
    );
  });

  it('reports the earliest track date per user for period selectors', () => {
    const { sql } = server.earliestDate!();
    expect(sql).toContain('SELECT MIN(DATE(started_at AT TIME ZONE COALESCE(timezone, \'UTC\')))');
    expect(sql).toContain('FROM tracks WHERE user_id = $1');
  });
});

describe('tracks plugin — backup & cleanup hooks', () => {
  it('exports stored tracks ordered by time with geometry decoded to coordinates', async () => {
    const rows = [
      {
        id: 't1',
        user_id: 'u1',
        name: 'Night Ride',
        activity_type: 'Cycling',
        timezone: 'UTC',
        started_at: '2013-05-31T13:41:00Z',
        ended_at: '2013-05-31T15:31:00Z',
        distance_m: 5200,
        elapsed_time_s: 5400,
        moving_time_s: 5300,
        elevation_gain_m: 120,
        avg_speed_mps: 1.4,
        max_speed_mps: 3.1,
        avg_hr: 105,
        max_hr: 140,
        point_count: 3,
        file_hash: 'abc123',
        geojson: '{"type":"LineString","coordinates":[[-122.5,37.8],[-122.49,37.81]]}',
        points: [{ t: 1, ele: 2, hr: 3 }],
        created_at: '2013-05-31T13:41:00Z',
        updated_at: '2013-05-31T13:41:00Z',
      },
    ];
    queryMock.mockResolvedValueOnce({ rows });
    const result = await server.backupExport!({ user_id: 'u1' } as any);
    expect(result).toEqual([
      expect.objectContaining({
        id: 't1',
        name: 'Night Ride',
        distance_m: 5200,
        avg_hr: 105,
        file_hash: 'abc123',
        geometry: [[-122.5, 37.8], [-122.49, 37.81]],
        points: [{ t: 1, ele: 2, hr: 3 }],
      }),
    ]);
    const [sql, values] = queryMock.mock.calls[0];
    expect(sql).toContain('ORDER BY started_at ASC');
    expect(values).toEqual(['u1']);
  });

  it('imports through the provided transaction client and counts inserts', async () => {
    const clientQuery = vi.fn().mockResolvedValue({ rowCount: 1 });
    const client = { query: clientQuery, release: vi.fn() };
    const inserted = await server.backupImport!(
      { user_id: 'u1', client } as any,
      [
        {
          id: 't1',
          name: 'Night Ride',
          timezone: 'UTC',
          started_at: '2013-05-31T13:41:00Z',
          ended_at: '2013-05-31T15:31:00Z',
          geometry: [[-122.5, 37.8], [-122.49, 37.81]],
          points: [{ t: 1, ele: 2, hr: 3 }],
        },
      ],
    );
    expect(inserted).toBe(1);
    expect(clientQuery).toHaveBeenCalledTimes(1);
    const [sql, values] = clientQuery.mock.calls[0];
    expect(sql).toContain('INSERT INTO tracks');
    expect(sql).toContain('ST_GeomFromText');
    expect(values[0]).toBe('t1');
    expect(values[2]).toBe('Night Ride');
    // Geometry is re-encoded as WKT for the PostGIS column.
    expect(values[values.length - 2]).toBe('LINESTRING(-122.5 37.8, -122.49 37.81)');
    expect(client.release).not.toHaveBeenCalled();
  });

  it('skips rows missing an id/name or with fewer than two coordinates', async () => {
    const clientQuery = vi.fn();
    const client = { query: clientQuery, release: vi.fn() };
    const inserted = await server.backupImport!(
      { user_id: 'u1', client } as any,
      [
        { name: 'No Id' },
        { id: 't2', geometry: [[-122.5, 37.8]] },
      ],
    );
    expect(inserted).toBe(0);
    expect(clientQuery).not.toHaveBeenCalled();
  });

  it('restores legacy backups from the top-level tracks key', async () => {
    const clientQuery = vi.fn().mockResolvedValue({ rowCount: 1 });
    const client = { query: clientQuery, release: vi.fn() };
    const counts = await server.restoreLegacyBackup!(
      { user_id: 'u1', client } as any,
      {
        tracks: [
          {
            id: 't1',
            name: 'Old Ride',
            geometry: [[-122.5, 37.8], [-122.49, 37.81]],
          },
        ],
      } as any,
    );
    expect(counts).toEqual({ tracks: { inserted: 1, skipped: 0 } });
    expect(clientQuery).toHaveBeenCalledTimes(1);
  });

  it("deletes the user's tracks on start-over", async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 2, rows: [] });
    expect(await server.deleteUserData!({ user_id: 'u1' } as any)).toBe(2);
    const [sql, values] = queryMock.mock.calls[0];
    expect(sql).toContain('DELETE FROM tracks WHERE user_id = $1');
    expect(values).toEqual(['u1']);
  });
});

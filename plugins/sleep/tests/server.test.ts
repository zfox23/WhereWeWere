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

describe('sleep plugin — plugin shape', () => {
  it('declares custom storage and its three stable API mounts', () => {
    expect(server.storage).toBe('custom');
    const mounts = Array.isArray(server.api) ? server.api : [server.api as any];
    expect(mounts.map((m: any) => m.mount)).toEqual([
      '/sleep-entries',
      '/webhook/sleep-as-android',
      '/import/sleep-as-android',
    ]);
    for (const mount of mounts) {
      // An express Router is a function with a `stack` (Express 5: an array).
      expect(typeof mount.router).toBe('function');
      expect(Array.isArray(mount.router.stack)).toBe(true);
    }
  });
});

describe('sleep plugin — buildTimelineWhere', () => {
  it('combines user, date range, and search conditions with positional params', () => {
    const { sql, values } = server.buildTimelineWhere!({
      user_id: 'u1',
      from: '2026-02-01',
      to: '2026-02-28',
      q: 'restless',
      filterParams: {},
    });
    expect(sql).toBe(
      "se.user_id = $1 " +
        "AND (se.ended_at AT TIME ZONE COALESCE(se.sleep_timezone, 'UTC'))::date >= $2::date " +
        "AND (se.ended_at AT TIME ZONE COALESCE(se.sleep_timezone, 'UTC'))::date <= $3::date " +
        `AND se.comment ILIKE '%' || $4 || '%'`
    );
    expect(values).toEqual(['u1', '2026-02-01', '2026-02-28', 'restless']);
  });

  it.each([
    ['lte6', ['EXTRACT(EPOCH FROM (se.ended_at - se.started_at)) <= 21600']],
    [
      '6to8',
      [
        'EXTRACT(EPOCH FROM (se.ended_at - se.started_at)) > 21600',
        'EXTRACT(EPOCH FROM (se.ended_at - se.started_at)) < 28800',
      ],
    ],
    ['gte8', ['EXTRACT(EPOCH FROM (se.ended_at - se.started_at)) >= 28800']],
  ])('maps sleep_duration=%s to the right duration bounds', (filter, fragments) => {
    const { sql, values } = server.buildTimelineWhere!({
      ...baseCtx,
      filterParams: { sleep_duration: filter },
    });
    for (const fragment of fragments) {
      expect(sql).toContain(fragment);
    }
    // Duration buckets add no values of their own.
    expect(values).toEqual(['u1']);
  });

  it('ignores unknown sleep_duration values', () => {
    const { sql } = server.buildTimelineWhere!({
      ...baseCtx,
      filterParams: { sleep_duration: 'bogus' },
    });
    expect(sql).toBe('se.user_id = $1');
  });
});

describe('sleep plugin — buildTimelineSelect', () => {
  it('emits every canonical timeline column (UNION alignment)', () => {
    const { sql } = server.buildTimelineSelect!();
    for (const col of TIMELINE_COLUMNS) {
      expect(sql).toContain(`AS ${col.name}`);
    }
    expect(sql).toContain("'sleep' AS type");
    expect(sql).toContain('FROM sleep_entries se');
    expect(sql).toContain('se.sleep_timezone AS timezone');
    expect(sql).toContain('json_build_object(');
  });

  it('anchors the timeline moment on the wake-up time, falling back to start for pending sessions', () => {
    const { sql } = server.buildTimelineSelect!();
    expect(sql).toContain('COALESCE(se.ended_at, se.started_at) AS checked_in_at');
  });
});

describe('sleep plugin — llm hook', () => {
  it('gathers rows in the given date range', async () => {
    const rows = [
      {
        checked_in_at: '2026-03-11T06:00:00Z',
        timezone: 'America/New_York',
        data: { started_at: '2026-03-10T23:30:00Z', ended_at: '2026-03-11T06:00:00Z', comment: null },
      },
    ];
    queryMock.mockResolvedValueOnce({ rows });
    const result = await server.llm!.gather('u1', '2026-03-01', '2026-03-31');
    expect(result).toEqual(rows);
    const [sql, values] = queryMock.mock.calls[0];
    expect(sql).toContain('FROM sleep_entries');
    expect(values).toEqual(['u1', '2026-03-01', '2026-03-31']);
  });

  it('renders prompt lines with duration and optional comment', () => {
    const row = (started: string, ended: string, comment: string | null) =>
      server.llm!.toLines({
        checked_in_at: '',
        timezone: null,
        data: { started_at: started, ended_at: ended, comment },
      } as any);

    expect(row('2026-03-10T23:30:00Z', '2026-03-11T06:00:00Z', null)).toEqual([
      '- slept 6h 30m',
    ]);
    expect(row('2026-03-10T23:30:00Z', '2026-03-11T00:15:00Z', 'restless')).toEqual([
      '- slept 45m — comment: "restless"',
    ]);
    expect(row('2026-03-10T22:00:00Z', '2026-03-11T06:00:00Z', null)).toEqual(['- slept 8h']);
  });
});

describe('sleep plugin — reconcile hook', () => {
  it('has the stable sleep detail path and anchor label', () => {
    expect(server.reconcile!.detailPath('abc')).toBe('/sleep-entries/abc');
    expect(server.reconcile!.anchorLabel).toBe('sleep entry');
    expect(server.reconcile!.scanAll).toBe(true);
  });

  it('loads scan rows from sleep_entries ordered by time', async () => {
    const rows = [
      { id: 's1', checked_in_at: '2026-03-10T23:30:00Z', original_timezone: 'America/New_York' },
      { id: 's2', checked_in_at: '2026-03-11T23:30:00Z', original_timezone: null },
    ];
    queryMock.mockResolvedValueOnce({ rows });
    const result = await server.reconcile!.loadCheckins('u1');
    expect(result).toEqual(rows);
    const [sql, values] = queryMock.mock.calls[0];
    expect(sql).toContain('FROM sleep_entries');
    expect(sql).toContain('ORDER BY started_at ASC');
    expect(values).toEqual(['u1']);
  });

  it('applies a label-only timezone correction', async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 1 });
    expect(await server.reconcile!.apply('s1', 'Europe/Lisbon')).toBe(true);
    const [sql, values] = queryMock.mock.calls[0];
    expect(sql).toContain('UPDATE sleep_entries');
    expect(sql).toContain('SET sleep_timezone = $2');
    expect(values).toEqual(['s1', 'Europe/Lisbon']);
  });

  it('reports failure when no row was updated', async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 0 });
    expect(await server.reconcile!.apply('missing', 'Europe/Lisbon')).toBe(false);
  });
});

describe('sleep plugin — backup & cleanup hooks', () => {
  it('exports stored entries ordered by time', async () => {
    const rows = [{ id: 's1', sleep_as_android_id: 1 }];
    queryMock.mockResolvedValueOnce({ rows });
    const result = await server.backupExport!({ user_id: 'u1' } as any);
    expect(result).toEqual(rows);
    const [sql, values] = queryMock.mock.calls[0];
    expect(sql).toContain('ORDER BY started_at ASC');
    expect(values).toEqual(['u1']);
  });

  it('imports through the provided transaction client and counts inserts', async () => {
    const clientQuery = vi.fn().mockResolvedValue({ rowCount: 1 });
    const client = { query: clientQuery, release: vi.fn() };
    const inserted = await server.backupImport!(
      { user_id: 'u1', client } as any,
      [{ id: 's1', sleep_as_android_id: 1, started_at: '2026-03-10T23:30:00Z', ended_at: '2026-03-11T06:00:00Z' }],
    );
    expect(inserted).toBe(1);
    expect(clientQuery).toHaveBeenCalledTimes(1);
    expect(client.release).not.toHaveBeenCalled();
  });

  it('skips rows missing the android id on import', async () => {
    const clientQuery = vi.fn();
    const client = { query: clientQuery, release: vi.fn() };
    const inserted = await server.backupImport!(
      { user_id: 'u1', client } as any,
      [{ id: 's1' }],
    );
    expect(inserted).toBe(0);
    expect(clientQuery).not.toHaveBeenCalled();
  });

  it('deletes the user\'s sleep entries on start-over', async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 2 });
    expect(await server.deleteUserData!({ user_id: 'u1' } as any)).toBe(2);
  });

  it('wipes the webhook event log on start-over', async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 4 });
    expect(await server.resetSettings!({ user_id: 'u1' } as any)).toBe(4);
    const [sql] = queryMock.mock.calls[0];
    expect(sql).toContain('DELETE FROM sleep_webhook_events');
  });
});

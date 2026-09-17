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

describe('mood plugin — buildTimelineWhere', () => {
  it('combines user, date range, and search conditions with positional params', () => {
    const { sql, values } = server.buildTimelineWhere!({
      user_id: 'u1',
      from: '2026-01-01',
      to: '2026-01-31',
      q: 'yoga',
      filterParams: {},
    });
    expect(sql).toBe(
      "mc.user_id = $1 " +
        "AND (mc.checked_in_at AT TIME ZONE COALESCE(mc.mood_timezone, 'UTC'))::date >= $2::date " +
        "AND (mc.checked_in_at AT TIME ZONE COALESCE(mc.mood_timezone, 'UTC'))::date <= $3::date " +
        `AND mc.note ILIKE '%' || $4 || '%'`
    );
    expect(values).toEqual(['u1', '2026-01-01', '2026-01-31', 'yoga']);
  });

  it('adds a mood equality condition for in-range mood filter values', () => {
    const { sql, values } = server.buildTimelineWhere!({
      ...baseCtx,
      filterParams: { mood: '4' },
    });
    expect(sql).toBe('mc.user_id = $1 AND mc.mood = $2');
    expect(values).toEqual(['u1', 4]);
  });

  it('ignores out-of-range and non-numeric mood filter values', () => {
    for (const bad of ['0', '6', 'abc']) {
      const { sql, values } = server.buildTimelineWhere!({
        ...baseCtx,
        filterParams: { mood: bad },
      });
      expect(sql).toBe('mc.user_id = $1');
      expect(values).toEqual(['u1']);
    }
  });

  it('adds an EXISTS condition for activity name filters', () => {
    const { sql, values } = server.buildTimelineWhere!({
      ...baseCtx,
      filterParams: { activity: 'gym' },
    });
    expect(sql).toContain('EXISTS (');
    expect(sql).toContain('mca2.mood_checkin_id = mc.id');
    expect(sql).toContain('ma2.name ILIKE $2');
    expect(values).toEqual(['u1', 'gym']);
  });
});

describe('mood plugin — buildTimelineSelect', () => {
  it('emits every canonical timeline column (UNION alignment)', () => {
    const { sql } = server.buildTimelineSelect!();
    for (const col of TIMELINE_COLUMNS) {
      expect(sql).toContain(`AS ${col.name}`);
    }
    expect(sql).toContain("'mood' AS type");
    expect(sql).toContain('mc.mood AS mood');
    expect(sql).toContain('mc.mood_timezone AS mood_timezone');
    expect(sql).toContain('FROM mood_checkins mc');
    // `data` payload mirrors the mood fields for the plugin card.
    expect(sql).toContain("json_build_object(");
  });
});

describe('mood plugin — llm hook', () => {
  it('gathers rows in the given date range', async () => {
    const rows = [{ checked_in_at: '2026-03-10T14:00:00Z', timezone: null, data: {} }];
    queryMock.mockResolvedValueOnce({ rows });
    const result = await server.llm!.gather('u1', '2026-03-01', '2026-03-31');
    expect(result).toEqual(rows);
    const [sql, values] = queryMock.mock.calls[0];
    expect(sql).toContain('FROM mood_checkins');
    expect(values).toEqual(['u1', '2026-03-01', '2026-03-31']);
  });

  it('renders prompt lines with label, activities, and note', () => {
    const lines = server.llm!.toLines({
      checked_in_at: '',
      timezone: null,
      data: { mood: 4, note: 'felt great', activities: [{ name: 'Gym' }, { name: 'Work' }] },
    } as any);
    expect(lines).toEqual(['- mood: good (activities: Gym, Work) — note: "felt great"']);
  });

  it('omits the activities/note suffixes when empty', () => {
    const lines = server.llm!.toLines({
      checked_in_at: '',
      timezone: null,
      data: { mood: 1, note: null, activities: [] },
    } as any);
    expect(lines).toEqual(['- mood: bad']);
  });
});

describe('mood plugin — reconcile hook', () => {
  it('has the stable mood detail path and anchor label', () => {
    expect(server.reconcile!.detailPath('abc')).toBe('/mood-checkins/abc');
    expect(server.reconcile!.anchorLabel).toBe('mood check-in');
    expect(server.reconcile!.scanAll).toBe(true);
  });

  it('loads scan rows from mood_checkins ordered by time', async () => {
    const rows = [
      { id: 'm1', checked_in_at: '2026-03-10T14:00:00Z', original_timezone: null },
      { id: 'm2', checked_in_at: '2026-03-11T14:00:00Z', original_timezone: 'UTC' },
    ];
    queryMock.mockResolvedValueOnce({ rows });
    const result = await server.reconcile!.loadCheckins('u1');
    expect(result).toEqual(rows);
    const [sql, values] = queryMock.mock.calls[0];
    expect(sql).toContain('FROM mood_checkins');
    expect(sql).toContain('ORDER BY checked_in_at ASC');
    expect(values).toEqual(['u1']);
  });

  it('applies a label-only timezone correction', async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 1 });
    expect(await server.reconcile!.apply('m1', 'Europe/Lisbon')).toBe(true);
    const [sql, values] = queryMock.mock.calls[0];
    expect(sql).toContain('UPDATE mood_checkins');
    expect(sql).toContain('SET mood_timezone = $2');
    expect(values).toEqual(['m1', 'Europe/Lisbon']);
  });

  it('reports failure when no row was updated', async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 0 });
    expect(await server.reconcile!.apply('missing', 'Europe/Lisbon')).toBe(false);
  });
});

describe('mood plugin — backup & cleanup hooks', () => {
  it('exports stored check-ins ordered by time', async () => {
    const rows = [{ id: 'm1', mood: 3, note: null }];
    queryMock.mockResolvedValueOnce({ rows });
    const result = await server.backupExport!({ user_id: 'u1' } as any);
    expect(result).toEqual(rows);
    const [sql, values] = queryMock.mock.calls[0];
    expect(sql).toContain('ORDER BY checked_in_at ASC');
    expect(values).toEqual(['u1']);
  });

  it('imports through the provided transaction client and counts inserts', async () => {
    const clientQuery = vi.fn().mockResolvedValue({ rowCount: 1 });
    const client = { query: clientQuery, release: vi.fn() };
    const inserted = await server.backupImport!(
      { user_id: 'u1', client } as any,
      [{ id: 'm1', mood: 4, note: 'x', checked_in_at: '2026-03-10T14:00:00Z' }],
    );
    expect(inserted).toBe(1);
    expect(clientQuery).toHaveBeenCalledTimes(1);
    expect(client.release).not.toHaveBeenCalled();
  });

  it('deletes the user\'s mood check-ins on start-over', async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 3 });
    expect(await server.deleteUserData!({ user_id: 'u1' } as any)).toBe(3);
  });

  it('wipes mood activity groups on start-over (framework handles the rest)', async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 1 });
    expect(await server.resetSettings!({ user_id: 'u1' } as any)).toBe(1);
    const [sql] = queryMock.mock.calls[0];
    expect(sql).toContain('DELETE FROM mood_activity_groups');
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));

vi.mock('../../../server/src/db', () => ({
  query: queryMock,
  pool: { connect: vi.fn() },
}));

import { server } from '../server';
import { getVenueTimezone, normalizeEtcGmt } from '../services/geoTimezone';
import type { PluginReconciliationRow, PluginTimelineContext } from 'wwp-shared';

const baseCtx: PluginTimelineContext = {
  user_id: 'u1',
  from: null,
  to: null,
  q: null,
  filterParams: {},
};

beforeEach(() => {
  queryMock.mockReset();
});

describe('geoTimezone', () => {
  it('resolves coordinates to an IANA zone', () => {
    // New York City
    expect(getVenueTimezone(40.7128, -74.006)).toBe('America/New_York');
    // London
    expect(getVenueTimezone(51.5074, -0.1278)).toBe('Europe/London');
  });

  it('returns null for missing or invalid coordinates', () => {
    expect(getVenueTimezone(null, -74.006)).toBeNull();
    expect(getVenueTimezone(40.7128, null)).toBeNull();
    expect(getVenueTimezone('abc', -74.006)).toBeNull();
    expect(getVenueTimezone(NaN, NaN)).toBeNull();
  });

  it('maps Etc/GMT+N fixed offsets to representative IANA zones', () => {
    expect(normalizeEtcGmt('Etc/GMT+4')).toBe('America/New_York'); // UTC-4
    expect(normalizeEtcGmt('Etc/GMT-1')).toBe('Europe/Paris'); // UTC+1
    expect(normalizeEtcGmt('America/New_York')).toBe('America/New_York'); // passthrough
  });
});

describe('location plugin — reconcile hook', () => {
  it('suggests the geo-resolved timezone when it differs from the stored label', async () => {
    const rows: PluginReconciliationRow[] = [
      {
        id: 'c1',
        checked_in_at: '2026-01-01T14:00:00Z',
        original_timezone: 'America/New_York',
        latitude: 38.7223,
        longitude: -9.1393, // Lisbon
      },
    ];
    const { suggestions, uninferable } = await server.reconcile!.suggest!('u1', rows);
    expect(uninferable).toEqual([]);
    expect(suggestions).toEqual([
      expect.objectContaining({
        id: 'c1',
        suggested_timezone: 'Europe/Lisbon',
      }),
    ]);
    expect(suggestions[0].reason).toContain('Europe/Lisbon');
    expect(suggestions[0].reason).toContain('America/New_York');
  });

  it('skips rows whose stored timezone already matches the geo-resolved zone', async () => {
    const rows: PluginReconciliationRow[] = [
      {
        id: 'c1',
        checked_in_at: '2026-01-01T14:00:00Z',
        original_timezone: 'Europe/Lisbon',
        latitude: 38.7223,
        longitude: -9.1393, // Lisbon
      },
    ];
    const { suggestions, uninferable } = await server.reconcile!.suggest!('u1', rows);
    expect(suggestions).toEqual([]);
    expect(uninferable).toEqual([]);
  });

  it('treats an Etc/GMT stored label as equivalent to its IANA equivalent', async () => {
    const rows: PluginReconciliationRow[] = [
      {
        id: 'c1',
        checked_in_at: '2026-06-15T14:00:00Z',
        original_timezone: 'Etc/GMT+4', // = America/New_York during EDT
        latitude: 40.7128,
        longitude: -74.006, // New York
      },
    ];
    const { suggestions } = await server.reconcile!.suggest!('u1', rows);
    expect(suggestions).toEqual([]);
  });

  it('reports rows without coordinates as uninferable', async () => {
    const rows: PluginReconciliationRow[] = [
      {
        id: 'c1',
        checked_in_at: '2026-01-01T14:00:00Z',
        original_timezone: null,
        latitude: null,
        longitude: null,
      },
    ];
    const { suggestions, uninferable } = await server.reconcile!.suggest!('u1', rows);
    expect(suggestions).toEqual([]);
    expect(uninferable).toHaveLength(1);
    expect(uninferable[0].id).toBe('c1');
  });

  it('exposes the geo-resolved timezone as the anchor for other types', () => {
    const row: PluginReconciliationRow = {
      id: 'c1',
      checked_in_at: '2026-01-01T14:00:00Z',
      original_timezone: 'America/New_York', // wrong label
      latitude: 38.7223,
      longitude: -9.1393, // Lisbon
    };
    expect(server.reconcile!.anchorTimezone!(row)).toBe('Europe/Lisbon');

    const noCoords: PluginReconciliationRow = {
      id: 'c2',
      checked_in_at: '2026-01-01T14:00:00Z',
      original_timezone: null,
      latitude: null,
      longitude: null,
    };
    expect(server.reconcile!.anchorTimezone!(noCoords)).toBeNull();
  });
});

describe('location plugin — timeline', () => {
  it('builds the WHERE clause with user, date range, and search conditions', () => {
    const { sql, values } = server.buildTimelineWhere!({
      user_id: 'u1',
      from: '2026-01-01',
      to: '2026-01-31',
      q: 'cafe',
      filterParams: {},
    });
    expect(sql).toContain('c.user_id = $1');
    expect(sql).toContain("::date >= $2::date");
    expect(sql).toContain("::date <= $3::date");
    // Search covers both the check-in's search vector and the venue's.
    expect(sql).toContain("c.search_vector @@ plainto_tsquery('english', $4)");
    expect(sql).toContain("v.search_vector @@ plainto_tsquery('english', $5)");
    expect(values).toEqual(['u1', '2026-01-01', '2026-01-31', 'cafe', 'cafe']);
  });

  it('adds conditions for the venue_id, category, and country filter params', () => {
    const { sql, values } = server.buildTimelineWhere!({
      ...baseCtx,
      filterParams: { venue_id: 'v1', category: 'cafe', country: 'PT' },
    });
    expect(sql).toContain('c.venue_id = $2');
    expect(sql).toContain('vc.name');
    expect(sql).toContain('v.country');
    expect(values).toEqual(['u1', 'v1', 'cafe', 'PT']);
  });

  it('applies the geo-tz fallback to rows missing a check-in timezone', () => {
    const postProcess = server.buildTimelineSelect!().postProcess;
    expect(postProcess).toBeTypeOf('function');
    const rows = [
      { venue_latitude: 38.7223, venue_longitude: -9.1393, venue_timezone: null },
      { venue_latitude: null, venue_longitude: null, venue_timezone: 'America/Chicago' },
    ];
    const out = (postProcess as (r: unknown[]) => unknown[])(rows);
    expect(out[0]).toMatchObject({ venue_timezone: 'Europe/Lisbon' });
    expect(out[1]).toMatchObject({ venue_timezone: 'America/Chicago' });
  });
});

describe('location plugin — core SQL hooks', () => {
  it('resolves anchor timestamps for photo/scrobble enrichment', () => {
    const { sql } = server.resolveTimestamps!();
    expect(sql).toContain('SELECT id, checked_in_at FROM checkins');
    expect(sql).toContain('id = ANY($1::uuid[])');
  });

  it('reports the earliest location check-in date keyed by local date', () => {
    const { sql } = server.earliestDate!();
    expect(sql).toContain('MIN(');
    expect(sql).toContain('checkin_timezone');
  });

  it('resolves the latest known timezone at or before a reference time', () => {
    const { sql } = server.latestTimezoneAsOf!();
    expect(sql).toContain('checkin_timezone');
    expect(sql).toContain('$1');
    expect(sql).toContain('$2');
  });

  it('contributes a reflection branch in the shared column shape', () => {
    const { sql } = server.reflectionBranch!();
    expect(sql).toContain("'location' AS type");
    expect(sql).toContain('reflection_year');
    expect(sql).toContain('years_ago');
  });
});

describe('location plugin — plugin shape', () => {
  it('declares custom storage and its four stable API mounts', () => {
    expect(server.storage).toBe('custom');
    const mounts = Array.isArray(server.api) ? server.api : [server.api as any];
    expect(mounts.map((m: any) => m.mount)).toEqual([
      '/location-checkins',
      '/venues',
      '/search',
      '/import/swarm',
    ]);
    for (const mount of mounts) {
      expect(typeof mount.router).toBe('function');
      expect(Array.isArray(mount.router.stack)).toBe(true);
    }
  });

  it('declares legacy backup keys for pre-plugin restores', () => {
    expect(server.legacyBackupKeys).toEqual(['checkins', 'venues', 'venueCategories']);
  });
});

describe('location plugin — backup & cleanup hooks', () => {
  it('exports check-ins plus the venue tables they depend on', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ id: 'c1', venue_id: 'v1' }] }) // checkins
      .mockResolvedValueOnce({ rows: [{ id: 'v1', name: 'Cafe' }] }) // venues
      .mockResolvedValueOnce({ rows: [{ id: 'vc1', name: 'Cafe' }] }) // categories
      .mockResolvedValueOnce({ rows: [] }) // venue lists
      .mockResolvedValueOnce({ rows: [] }); // venue list items
    const result = await server.backupExport!({ user_id: 'u1' } as any);
    expect(result).toEqual({
      checkins: [{ id: 'c1', venue_id: 'v1' }],
      venues: [{ id: 'v1', name: 'Cafe' }],
      venueCategories: [{ id: 'vc1', name: 'Cafe' }],
      venueLists: [],
      venueListItems: [],
    });
    // The check-in query is scoped to the user and ordered by time.
    const [checkinsSql, checkinsValues] = queryMock.mock.calls[0];
    expect(checkinsSql).toContain('FROM checkins');
    expect(checkinsSql).toContain('WHERE user_id = $1');
    expect(checkinsSql).toContain('ORDER BY checked_in_at ASC');
    expect(checkinsValues).toEqual(['u1']);
  });

  it('imports in FK order (categories -> venues -> check-ins) via the transaction client', async () => {
    const clientQuery = vi.fn(async (_sql: string) => ({ rows: [{ id: 'c1' }], rowCount: 1 }));
    const client = { query: clientQuery, release: vi.fn() };
    const inserted = await server.backupImport!(
      { user_id: 'u1', client } as any,
      {
        venueCategories: [{ id: 'vc1', name: 'Cafe', icon: null, created_at: null }],
        venues: [{ id: 'v1', name: 'Cafe', category_id: 'vc1' }],
        checkins: [{ id: 'c1', venue_id: 'v1', checked_in_at: '2026-01-01T12:00:00Z' }],
      },
    );
    expect(inserted).toBe(1);
    expect(client.release).not.toHaveBeenCalled(); // provided client is not released
    const insertedSql = clientQuery.mock.calls.map((c) => c[0]);
    expect(insertedSql[0]).toContain('INSERT INTO venue_categories');
    expect(insertedSql[1]).toContain('INSERT INTO venues');
    expect(insertedSql[2]).toContain('INSERT INTO checkins');
  });

  it('skips check-in rows missing a venue on import', async () => {
    const clientQuery = vi.fn();
    const client = { query: clientQuery, release: vi.fn() };
    const inserted = await server.backupImport!(
      { user_id: 'u1', client } as any,
      { checkins: [{ id: 'c1' }] },
    );
    expect(inserted).toBe(0);
    expect(clientQuery).not.toHaveBeenCalled();
  });

  it('detaches scrobbles and deletes the user check-ins on start-over', async () => {
    queryMock
      .mockResolvedValueOnce({ rowCount: 1 }) // scrobble detach
      .mockResolvedValueOnce({ rowCount: 1 }) // companion delete
      .mockResolvedValueOnce({ rowCount: 3 }) // checkin delete
      .mockResolvedValueOnce({ rowCount: 1 }); // venue-list delete
    expect(await server.deleteUserData!({ user_id: 'u1' } as any)).toBe(3);
    expect(queryMock.mock.calls[0][0]).toContain('DELETE FROM checkin_scrobbles');
    expect(queryMock.mock.calls[2][0]).toContain('DELETE FROM checkins WHERE user_id = $1');
    expect(queryMock.mock.calls[3][0]).toContain('DELETE FROM venue_lists WHERE user_id = $1');
  });

  it('deletes the whole venues catalog on start-over (all-data)', async () => {
    queryMock
      .mockResolvedValueOnce({ rowCount: 2 }) // list items (user's lists)
      .mockResolvedValueOnce({ rowCount: 1 }) // venue lists (user's)
      .mockResolvedValueOnce({ rowCount: 1 }) // merge suggestions
      .mockResolvedValueOnce({ rowCount: 4 }) // venues
      .mockResolvedValueOnce({ rowCount: 3 }); // venue categories
    expect(await server.deleteAllData!({ user_id: 'u1' } as any)).toBe(11);
    expect(queryMock.mock.calls[0][0]).toContain('DELETE FROM venue_list_items');
    expect(queryMock.mock.calls[1][0]).toContain('DELETE FROM venue_lists WHERE user_id = $1');
    expect(queryMock.mock.calls[2][0]).toContain('DELETE FROM venue_merge_suggestions');
    expect(queryMock.mock.calls[3][0]).toContain('DELETE FROM venues');
    expect(queryMock.mock.calls[4][0]).toContain('DELETE FROM venue_categories');
  });

  it('runs deleteAllData on the provided transaction client', async () => {
    const clientQuery = vi.fn(async (_sql: string) => ({ rowCount: 1 }));
    const client = { query: clientQuery, release: vi.fn() };
    await server.deleteAllData!({ user_id: 'u1', client } as any);
    expect(queryMock).not.toHaveBeenCalled();
    expect(clientQuery).toHaveBeenCalledTimes(5);
  });
});

describe('location plugin — llm hook', () => {
  it('gathers venue context rows for a date range', async () => {
    queryMock.mockResolvedValue({ rows: [{ checked_in_at: 'x', timezone: 'UTC', data: {} }] });
    await server.llm!.gather!('u1', '2026-01-01', '2026-01-31');
    const [sql, values] = queryMock.mock.calls[0];
    expect(sql).toContain('FROM checkins');
    expect(sql).toContain('JOIN venues');
    expect(values).toEqual(['u1', '2026-01-01', '2026-01-31']);
  });

  it('renders a human-readable line per check-in', () => {
    const lines = server.llm!.toLines!({
      checked_in_at: '2026-01-15T18:30:00Z',
      timezone: 'America/New_York',
      data: {
        venue_name: 'Cafe',
        venue_category: 'Cafe',
        city: 'New York',
        country: 'US',
        note: 'Great espresso',
      },
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('Cafe');
    expect(lines[0]).toContain('New York');
    expect(lines[0]).toContain('Great espresso');
  });
});

describe('location plugin — reconcile apply', () => {
  it('persists the suggested timezone and reports success', async () => {
    queryMock.mockResolvedValue({ rowCount: 1 });
    expect(await server.reconcile!.apply!('c1', 'Europe/Lisbon')).toBe(true);
    const [sql, values] = queryMock.mock.calls[0];
    expect(sql).toContain('UPDATE checkins');
    expect(sql).toContain('SET checkin_timezone = $2');
    expect(values).toEqual(['c1', 'Europe/Lisbon']);
  });

  it('rejects an invalid timezone', async () => {
    expect(await server.reconcile!.apply!('c1', 'Not/AZone')).toBe(false);
    expect(queryMock).not.toHaveBeenCalled();
  });
});

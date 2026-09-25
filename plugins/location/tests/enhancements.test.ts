import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const { queryMock, poolConnectMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  poolConnectMock: vi.fn(),
}));

vi.mock('../../../server/src/db', () => ({
  query: queryMock,
  pool: { connect: poolConnectMock },
}));

import { server } from '../server';

const USER_ID = '00000000-0000-0000-0000-000000000001';

function mounts(): Record<string, any> {
  const api = Array.isArray(server.api) ? server.api : [server.api];
  const out: Record<string, any> = {};
  for (const m of api) out[m!.mount] = m!.router;
  return out;
}

function app() {
  const a = express();
  a.use(express.json());
  const m = mounts();
  a.use('/location-checkins', m['/location-checkins']);
  a.use('/venues', m['/venues']);
  return a;
}

beforeEach(() => {
  queryMock.mockReset();
  poolConnectMock.mockReset();
});

describe('check-in star rating + companions (endpoints)', () => {
  it('POST / creates a check-in with a rating and companions, committing in a transaction', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [] };
        if (sql.includes('INSERT INTO checkins')) {
          return { rows: [{ id: 'c1', rating: 3 }] };
        }
        if (sql.includes('SELECT latitude, longitude')) return { rows: [{ latitude: 40.71, longitude: -74.0 }] };
        if (sql.includes('INSERT INTO checkin_companions')) return { rows: [] };
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    poolConnectMock.mockResolvedValueOnce(client);

    const res = await request(app())
      .post('/location-checkins')
      .send({ user_id: USER_ID, venue_id: 'v1', rating: 3, companions: ['Ada', 'Grace', 'ada'] });

    expect(res.status).toBe(201);
    expect(res.body.rating).toBe(3);
    expect(res.body.companions).toEqual(['Ada', 'Grace']);
    // Transaction committed.
    expect(client.query).toHaveBeenCalledWith('BEGIN');
    expect(client.query).toHaveBeenCalledWith('COMMIT');
  });

  it('POST / treats an out-of-range rating as unrated (null)', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [] };
        if (sql.includes('INSERT INTO checkins')) return { rows: [{ id: 'c1' }] };
        if (sql.includes('SELECT latitude, longitude')) return { rows: [{ latitude: 40.71, longitude: -74.0 }] };
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    poolConnectMock.mockResolvedValueOnce(client);

    const res = await request(app())
      .post('/location-checkins')
      .send({ user_id: USER_ID, venue_id: 'v1', rating: 9 });

    expect(res.status).toBe(201);
    expect(res.body.rating).toBeUndefined();
    // The INSERT captured a null rating.
    const insertCall = client.query.mock.calls.find((c) => c[0].includes('INSERT INTO checkins')) as unknown[];
    expect((insertCall[1] as unknown[])[5]).toBeNull();
  });

  it('PUT /:id replaces companions and clears the rating when the keys are present', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [] };
        if (sql.includes('UPDATE checkins')) return { rows: [{ id: 'c1', rating: null }] };
        if (sql.includes('DELETE FROM checkin_companions')) return { rows: [] };
        if (sql.includes('INSERT INTO checkin_companions')) return { rows: [] };
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    poolConnectMock.mockResolvedValueOnce(client);

    const res = await request(app())
      .put('/location-checkins/c1')
      .send({ rating: null, companions: ['Sam'] });

    expect(res.status).toBe(200);
    expect(res.body.companions).toEqual(['Sam']);
    const deleteCall = client.query.mock.calls.find((c) => c[0].includes('DELETE FROM checkin_companions'));
    expect(deleteCall).toBeDefined();
    expect(client.query).toHaveBeenCalledWith('COMMIT');
  });

  it('GET /:id returns the check-in plus its companion names', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{ id: 'c1', rating: 4, venue_timezone: 'America/New_York', venue_latitude: null, venue_longitude: null }],
      })
      .mockResolvedValueOnce({ rows: [{ name: 'Ada' }, { name: 'Linus' }] });

    const res = await request(app()).get('/location-checkins/c1');
    expect(res.status).toBe(200);
    expect(res.body.rating).toBe(4);
    expect(res.body.companions).toEqual(['Ada', 'Linus']);
  });

  it('GET /companion-names returns distinct, ILIKE-filtered names', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ name: 'Ada' }] });
    const res = await request(app()).get('/location-checkins/companion-names?q=ad&limit=10');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(['Ada']);
    const [sql, values] = queryMock.mock.calls[0];
    expect(sql).toContain('ILIKE $2');
    expect(values).toEqual([USER_ID, '%ad%', 10]);
  });

  it('the timeline data jsonb carries rating and companions', () => {
    const { sql } = server.buildTimelineSelect!();
    expect(sql).toContain("'rating', c.rating");
    expect(sql).toContain('json_agg(cc.name ORDER BY cc.name)');
    expect(sql).toContain("FROM checkin_companions cc");
  });
});

describe('venue lists (endpoints)', () => {
  it('GET /lists returns each list with its venue items', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ id: 'l1', name: 'Favorites', created_at: '2026-01-01' }] })
      .mockResolvedValueOnce({
        rows: [
          { list_id: 'l1', items: [{ id: 'v1', name: 'Coffee', added_at: '2026-01-02' }] },
        ],
      });

    const res = await request(app()).get('/venues/lists');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { id: 'l1', name: 'Favorites', created_at: '2026-01-01', items: [{ id: 'v1', name: 'Coffee', added_at: '2026-01-02' }] },
    ]);
  });

  it('POST /lists creates a list and 409s on a duplicate name', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'l1', name: 'New', created_at: 'x' }] });
    const created = await request(app()).post('/venues/lists').send({ name: 'New' });
    expect(created.status).toBe(201);
    expect(created.body.name).toBe('New');

    const dup: any = Object.assign(new Error('duplicate'), { code: '23505' });
    queryMock.mockRejectedValueOnce(dup);
    const conflict = await request(app()).post('/venues/lists').send({ name: 'New' });
    expect(conflict.status).toBe(409);
  });

  it('POST /lists/:id/items adds a venue idempotently and computes position', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [] };
        if (sql.includes('SELECT id FROM venue_lists')) return { rows: [{ id: 'l1' }] };
        if (sql.includes('SELECT id FROM venues')) return { rows: [{ id: 'v1' }] };
        if (sql.includes('MAX(position)')) return { rows: [{ pos: 2 }] };
        if (sql.includes('INSERT INTO venue_list_items')) return { rows: [] };
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    poolConnectMock.mockResolvedValueOnce(client);

    const res = await request(app()).post('/venues/lists/l1/items').send({ venue_id: 'v1' });
    expect(res.status).toBe(201);
    const insertCall = client.query.mock.calls.find((c) => c[0].includes('INSERT INTO venue_list_items')) as unknown[];
    expect(insertCall[1]).toEqual(['l1', 'v1', 3]);
  });

  it('DELETE /lists/:id/items/:venueId removes a membership (404 if absent)', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ list_id: 'l1' }] });
    const ok = await request(app()).delete('/venues/lists/l1/items/v1');
    expect(ok.status).toBe(200);

    queryMock.mockResolvedValueOnce({ rows: [] });
    const missing = await request(app()).delete('/venues/lists/l1/items/vX');
    expect(missing.status).toBe(404);
  });

  it('GET /lists is registered before GET /:id (literal segment wins)', () => {
    const router = mounts()['/venues'];
    const getLayers = router.stack
      .filter((l: any) => l.route && l.route.path === '/lists')
      .map((l: any) => Object.keys(l.route.methods));
    expect(getLayers.length).toBeGreaterThan(0);
    // The literal /lists route must appear before the /:id catch-all in the stack.
    const listsIdx = router.stack.findIndex((l: any) => l.route?.path === '/lists');
    const idIdx = router.stack.findIndex((l: any) => l.route?.path === '/:id');
    expect(listsIdx).toBeGreaterThan(-1);
    expect(idIdx).toBeGreaterThan(listsIdx);
  });
});

describe('venue library (endpoints)', () => {
  it('GET /library returns one row per venue with check-ins, including list names', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'v1',
            name: 'Coffee',
            address: null,
            city: 'Charlotte',
            state: null,
            country: null,
            rating: 3,
            category_id: 'cat1',
            category_name: 'Cafe',
            category_icon: '☕',
            last_checkin_at: '2026-05-01T12:00:00Z',
            last_checkin_timezone: 'America/New_York',
            checkin_count: 2,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ venue_id: 'v1', name: 'Favorites' }] });

    const res = await request(app()).get('/venues/library');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      id: 'v1',
      name: 'Coffee',
      rating: 3,
      checkin_count: 2,
      lists: ['Favorites'],
    });
  });

  it('GET /library uses a date range and the HAVING check-in constraint', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
    await request(app()).get('/venues/library?from=2026-01-01&to=2026-01-31');
    const [sql, values] = queryMock.mock.calls[0];
    expect(sql).toContain('HAVING COUNT(c.id) > 0');
    expect(sql).toContain('JOIN checkins c ON c.venue_id = v.id AND c.user_id = $1');
    expect(values).toEqual([USER_ID, '2026-01-01', '2026-01-31']);
  });
});

describe('venue rating (endpoints)', () => {
  it('PUT /:id persists a venue rating and rejects out-of-range values as null', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'v1', name: 'Coffee', rating: 4 }] });
    const res = await request(app()).put('/venues/v1').send({ rating: 4 });
    expect(res.status).toBe(200);
    const [sql, values] = queryMock.mock.calls[0];
    expect(sql).toContain('rating = $');
    expect(values).toContain(4);
  });
});

describe('backup round-trip', () => {
  it('backupExport includes companions, venue lists, list items, and ratings', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ id: 'c1', venue_id: 'v1', rating: 3, notes: null, checked_in_at: '2026-01-01', checkin_timezone: null, created_at: null, updated_at: null, swarm_id: null }] })
      .mockResolvedValueOnce({ rows: [{ id: 'v1', name: 'Coffee', rating: 4, category_id: null, address: null, city: null, state: null, country: null, postal_code: null, latitude: 1, longitude: 1, osm_id: null, swarm_venue_id: null, parent_venue_id: null, created_by: null, created_at: null, updated_at: null }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ checkin_id: 'c1', name: 'Ada' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'l1', name: 'Favorites', created_at: null, updated_at: null }] })
      .mockResolvedValueOnce({ rows: [{ list_id: 'l1', venue_id: 'v1', position: 1, added_at: null }] });

    const result: any = await server.backupExport!({ user_id: USER_ID } as any);
    expect(result.checkins[0].rating).toBe(3);
    expect(result.venues[0].rating).toBe(4);
    expect(result.checkinCompanions).toEqual([{ checkin_id: 'c1', name: 'Ada' }]);
    expect(result.venueLists).toEqual([{ id: 'l1', name: 'Favorites', created_at: null, updated_at: null }]);
    expect(result.venueListItems).toEqual([{ list_id: 'l1', venue_id: 'v1', position: 1, added_at: null }]);
  });

  it('backupImport restores companions, venue lists, and list items in FK order', async () => {
    const clientQuery = vi.fn(async (_sql: string, _values?: unknown[]) => ({ rows: [{ id: 'c1' }], rowCount: 1 }));
    const client = { query: clientQuery, release: vi.fn() };

    const inserted = await server.backupImport!(
      { user_id: USER_ID, client } as any,
      {
        checkins: [{ id: 'c1', venue_id: 'v1', rating: 3, notes: null, checked_in_at: '2026-01-01', checkin_timezone: null, created_at: null, updated_at: null, swarm_id: null }],
        venues: [{ id: 'v1', name: 'Coffee', rating: 4, category_id: null, address: null, city: null, state: null, country: null, postal_code: null, latitude: 1, longitude: 1, osm_id: null, swarm_venue_id: null, parent_venue_id: null, created_by: null, created_at: null, updated_at: null }],
        venueCategories: [],
        checkinCompanions: [{ checkin_id: 'c1', name: 'Ada' }],
        venueLists: [{ id: 'l1', name: 'Favorites', created_at: null, updated_at: null }],
        venueListItems: [{ list_id: 'l1', venue_id: 'v1', position: 1, added_at: null }],
      },
    );
    expect(inserted).toBe(1);

    const sqls = clientQuery.mock.calls.map((c) => c[0]);
    // A companion row was inserted for the known check-in.
    expect(sqls.some((s) => s.includes('INSERT INTO checkin_companions'))).toBe(true);
    // A venue list and a list item were inserted.
    expect(sqls.some((s) => s.includes('INSERT INTO venue_lists'))).toBe(true);
    expect(sqls.some((s) => s.includes('INSERT INTO venue_list_items'))).toBe(true);
    // The companion insert referenced the real check-in id.
    const companionCall = clientQuery.mock.calls.find((c) => c[0].includes('INSERT INTO checkin_companions'))!;
    expect(companionCall[1]).toEqual(['c1', 'Ada']);
    // List item references the list id and venue id.
    const listItemCall = clientQuery.mock.calls.find((c) => c[0].includes('INSERT INTO venue_list_items'))!;
    expect(listItemCall[1]).toEqual(['l1', 'v1', 1, null]);
    expect(client.release).not.toHaveBeenCalled();
  });

  it('restoreLegacyBackup normalizes missing new keys to empty arrays', async () => {
    const clientQuery = vi.fn(async (_sql: string, _values?: unknown[]) => ({ rows: [{ id: 'c1' }], rowCount: 1 }));
    const client = { query: clientQuery, release: vi.fn() };
    const counts = await server.restoreLegacyBackup!(
      { user_id: USER_ID, client } as any,
      { checkins: [{ id: 'c1', venue_id: 'v1', rating: 2 }], venues: [] },
    );
    expect(counts.checkins).toEqual({ inserted: 1, skipped: 0 });
    // No companion / list inserts since the legacy payload omitted them.
    const sqls = clientQuery.mock.calls.map((c) => c[0]);
    expect(sqls.some((s) => s.includes('INSERT INTO checkin_companions'))).toBe(false);
    expect(sqls.some((s) => s.includes('INSERT INTO venue_lists'))).toBe(false);
  });
});

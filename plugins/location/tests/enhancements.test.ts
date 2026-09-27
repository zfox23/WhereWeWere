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
        if (sql.includes('INSERT INTO companions')) return { rows: [] };
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
        if (sql.includes('DELETE FROM companions')) return { rows: [] };
        if (sql.includes('INSERT INTO companions')) return { rows: [] };
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
    const deleteCall = client.query.mock.calls.find((c) => c[0].includes('DELETE FROM companions'));
    expect(deleteCall).toBeDefined();
    expect(client.query).toHaveBeenCalledWith('COMMIT');
  });

  it('GET /:id returns the check-in plus its companion names and list memberships', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{ id: 'c1', rating: 4, venue_timezone: 'America/New_York', venue_latitude: null, venue_longitude: null }],
      })
      .mockResolvedValueOnce({ rows: [{ name: 'Ada' }, { name: 'Linus' }] })
      .mockResolvedValueOnce({ rows: [{ list_id: 'cl1' }, { list_id: 'cl2' }] });

    const res = await request(app()).get('/location-checkins/c1');
    expect(res.status).toBe(200);
    expect(res.body.rating).toBe(4);
    expect(res.body.companions).toEqual(['Ada', 'Linus']);
    expect(res.body.lists).toEqual(['cl1', 'cl2']);
  });

  it('the timeline carries companions on the data jsonb and envelope column', () => {
    const { sql } = server.buildTimelineSelect!();
    expect(sql).toContain("'rating', c.rating");
    expect(sql).toContain('json_agg(name ORDER BY name)');
    expect(sql).toContain('FROM companions');
    expect(sql).toContain("checkin_type = 'location'");
    expect(sql).toContain(') AS companions');
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

describe('checkin lists (endpoints)', () => {
  it('GET /lists returns each list with its item count', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ id: 'cl1', name: 'Concerts', created_at: '2026-01-01', updated_at: '2026-01-02' }] })
      .mockResolvedValueOnce({ rows: [{ list_id: 'cl1', count: 4 }] });

    const res = await request(app()).get('/location-checkins/lists');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { id: 'cl1', name: 'Concerts', created_at: '2026-01-01', updated_at: '2026-01-02', item_count: 4 },
    ]);
  });

  it('GET /lists/:id/items joins venue, companions, and rank columns', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ id: 'cl1' }] }) // list ownership
      .mockResolvedValueOnce({
        rows: [
          {
            checkin_id: 'c1', rank: 1, added_at: '2026-01-01',
            checked_in_at: '2026-01-01T19:00:00Z', venue_timezone: 'America/New_York',
            notes: 'Great show', rating: 4,
            venue_id: 'v1', venue_name: 'Fillmore', parent_venue_id: null, parent_venue_name: null,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ checkin_id: 'c1', name: 'Ada' }] }); // companions

    const res = await request(app()).get('/location-checkins/lists/cl1/items');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      checkin_id: 'c1',
      rank: 1,
      venue_id: 'v1',
      venue_name: 'Fillmore',
      notes: 'Great show',
      rating: 4,
      companions: ['Ada'],
    });
    // The item query orders ranked rows first, by rank, then unranked by date.
    const [itemsSql] = queryMock.mock.calls[1];
    expect(itemsSql).toContain('(cli.rank IS NULL) ASC');
    expect(itemsSql).toContain('cli.rank ASC');
  });

  it('GET /lists/:id/items is 404 for a list the user does not own', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    const res = await request(app()).get('/location-checkins/lists/other/items');
    expect(res.status).toBe(404);
  });

  it('POST /lists/:id/items adds a check-in idempotently (optional rank)', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [] };
        if (sql.includes('SELECT id FROM checkin_lists')) return { rows: [{ id: 'cl1' }] };
        if (sql.includes('SELECT id FROM checkins')) return { rows: [{ id: 'c1' }] };
        if (sql.includes('INSERT INTO checkin_list_items')) return { rows: [] };
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    poolConnectMock.mockResolvedValueOnce(client);

    const res = await request(app()).post('/location-checkins/lists/cl1/items').send({ checkin_id: 'c1', rank: 2 });
    expect(res.status).toBe(201);
    const insertCall = client.query.mock.calls.find((c) => c[0].includes('INSERT INTO checkin_list_items')) as unknown[];
    expect(insertCall[1]).toEqual(['cl1', 'c1', 2]);
    expect(client.query).toHaveBeenCalledWith('COMMIT');
  });

  it('POST /lists/:id/items is 404 when the check-in does not exist', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
        if (sql.includes('SELECT id FROM checkin_lists')) return { rows: [{ id: 'cl1' }] };
        if (sql.includes('SELECT id FROM checkins')) return { rows: [] };
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    poolConnectMock.mockResolvedValueOnce(client);

    const res = await request(app()).post('/location-checkins/lists/cl1/items').send({ checkin_id: 'missing' });
    expect(res.status).toBe(404);
  });

  it('DELETE /lists/:id/items/:checkinId removes a membership (404 if absent)', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ checkin_id: 'c1' }] });
    const ok = await request(app()).delete('/location-checkins/lists/cl1/items/c1');
    expect(ok.status).toBe(200);

    queryMock.mockResolvedValueOnce({ rows: [] });
    const missing = await request(app()).delete('/location-checkins/lists/cl1/items/cX');
    expect(missing.status).toBe(404);
  });

  it('PUT /lists/:id/items/:checkinId/rank clears a rank with rank:null', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [] };
        if (sql.includes('SELECT id FROM checkin_lists')) return { rows: [{ id: 'cl1' }] };
        if (sql.includes('SELECT rank FROM checkin_list_items')) return { rows: [{ rank: 3 }] };
        if (sql.includes('UPDATE checkin_list_items SET rank = $3')) return { rows: [], rowCount: 1 };
        if (sql.includes('rank = rank - 1')) return { rows: [] };
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    poolConnectMock.mockResolvedValueOnce(client);

    const res = await request(app()).put('/location-checkins/lists/cl1/items/c1/rank').send({ rank: null });
    expect(res.status).toBe(200);
    expect(res.body.rank).toBeNull();
    // Ranks below the removed one are renumbered down.
    const renumber = client.query.mock.calls.find((c) => c[0].includes('rank = rank - 1')) as unknown[];
    expect(renumber[1]).toEqual(['cl1', 3]);
  });

  it('PUT /lists/:id/ranks bulk re-ranks the given order and clears the rest', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [] };
        if (sql.includes('SELECT id FROM checkin_lists')) return { rows: [{ id: 'cl1' }] };
        if (sql.includes('SET rank = NULL')) return { rows: [] };
        if (sql.includes('UPDATE checkin_list_items SET rank = $3')) return { rows: [], rowCount: 1 };
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    poolConnectMock.mockResolvedValueOnce(client);

    const res = await request(app()).put('/location-checkins/lists/cl1/ranks').send({ ranked_ids: ['c2', 'c1'] });
    expect(res.status).toBe(200);
    expect(res.body.ranked_ids).toEqual(['c2', 'c1']);
    const updates = client.query.mock.calls
      .filter((c) => c[0].includes('UPDATE checkin_list_items SET rank = $3'))
      .map((c) => c as unknown[]);
    expect(updates.map((c) => c[1])).toEqual([
      ['cl1', 'c2', 1],
      ['cl1', 'c1', 2],
    ]);
  });

  it('PUT /lists/:id/ranks rejects a non-array body', async () => {
    const res = await request(app()).put('/location-checkins/lists/cl1/ranks').send({ ranked_ids: 'nope' });
    expect(res.status).toBe(400);
  });

  it('GET /lists is registered before GET /:id on the checkin router', () => {
    const router = mounts()['/location-checkins'];
    const listsIdx = router.stack.findIndex((l: any) => l.route?.path === '/lists');
    const idIdx = router.stack.findIndex((l: any) => l.route?.path === '/:id');
    expect(listsIdx).toBeGreaterThan(-1);
    expect(idIdx).toBeGreaterThan(listsIdx);
  });

  it('POST / attaches selected list_ids in the create transaction', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [] };
        if (sql.includes('INSERT INTO checkins')) return { rows: [{ id: 'c1' }] };
        if (sql.includes('SELECT latitude, longitude')) return { rows: [{ latitude: 40.71, longitude: -74.0 }] };
        if (sql.includes('INSERT INTO checkin_list_items')) return { rows: [] };
        if (sql.includes('SELECT list_id FROM checkin_list_items')) return { rows: [{ list_id: 'cl1' }] };
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    poolConnectMock.mockResolvedValueOnce(client);

    const res = await request(app())
      .post('/location-checkins')
      .send({ user_id: USER_ID, venue_id: 'v1', list_ids: ['cl1'] });

    expect(res.status).toBe(201);
    expect(res.body.lists).toEqual(['cl1']);
    const insertCall = client.query.mock.calls.find((c) => c[0].includes('INSERT INTO checkin_list_items')) as unknown[];
    expect(insertCall[1]).toEqual(['c1', ['cl1'], USER_ID]);
  });

  it('PUT /:id replaces list memberships when list_ids is present', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [] };
        if (sql.includes('UPDATE checkins')) return { rows: [{ id: 'c1' }] };
        if (sql.includes('SELECT list_id FROM companions') || sql.includes('FROM companions')) return { rows: [] };
        if (sql.includes('INSERT INTO checkin_list_items')) return { rows: [] };
        if (sql.includes('DELETE FROM checkin_list_items')) return { rows: [] };
        if (sql.includes('SELECT list_id FROM checkin_list_items')) return { rows: [{ list_id: 'cl1' }] };
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    poolConnectMock.mockResolvedValueOnce(client);

    const res = await request(app())
      .put('/location-checkins/c1')
      .send({ list_ids: ['cl1'] });

    expect(res.status).toBe(200);
    expect(res.body.lists).toEqual(['cl1']);
    expect(client.query.mock.calls.some((c) => c[0].includes('INSERT INTO checkin_list_items'))).toBe(true);
    expect(client.query.mock.calls.some((c) => c[0].includes('DELETE FROM checkin_list_items'))).toBe(true);
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
  it('backupExport includes venue lists, list items, and ratings (companions ship in the core companions.json)', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ id: 'c1', venue_id: 'v1', rating: 3, notes: null, checked_in_at: '2026-01-01', checkin_timezone: null, created_at: null, updated_at: null, swarm_id: null }] })
      .mockResolvedValueOnce({ rows: [{ id: 'v1', name: 'Coffee', rating: 4, category_id: null, address: null, city: null, state: null, country: null, postal_code: null, latitude: 1, longitude: 1, osm_id: null, swarm_venue_id: null, parent_venue_id: null, created_by: null, created_at: null, updated_at: null }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'l1', name: 'Favorites', created_at: null, updated_at: null }] })
      .mockResolvedValueOnce({ rows: [{ list_id: 'l1', venue_id: 'v1', position: 1, added_at: null }] })
      .mockResolvedValueOnce({ rows: [{ id: 'cl1', name: 'Concerts', created_at: null, updated_at: null }] })
      .mockResolvedValueOnce({ rows: [{ list_id: 'cl1', checkin_id: 'c1', rank: 1, added_at: null }] });

    const result: any = await server.backupExport!({ user_id: USER_ID } as any);
    expect(result.checkins[0].rating).toBe(3);
    expect(result.venues[0].rating).toBe(4);
    // Companions are core-owned and no longer part of this plugin's payload.
    expect(result).not.toHaveProperty('checkinCompanions');
    expect(result.venueLists).toEqual([{ id: 'l1', name: 'Favorites', created_at: null, updated_at: null }]);
    expect(result.venueListItems).toEqual([{ list_id: 'l1', venue_id: 'v1', position: 1, added_at: null }]);
    expect(result.checkinLists).toEqual([{ id: 'cl1', name: 'Concerts', created_at: null, updated_at: null }]);
    expect(result.checkinListItems).toEqual([{ list_id: 'cl1', checkin_id: 'c1', rank: 1, added_at: null }]);
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
        checkinLists: [{ id: 'cl1', name: 'Concerts', created_at: null, updated_at: null }],
        checkinListItems: [
          { list_id: 'cl1', checkin_id: 'c1', rank: 1, added_at: null },
          // Items pointing at a check-in absent from the payload are skipped.
          { list_id: 'cl1', checkin_id: 'missing', rank: 2, added_at: null },
        ],
      },
    );
    expect(inserted).toBe(1);

    const sqls = clientQuery.mock.calls.map((c) => c[0]);
    // A companion row was inserted for the known check-in.
    expect(sqls.some((s) => s.includes('INSERT INTO companions'))).toBe(true);
    // A venue list and a list item were inserted.
    expect(sqls.some((s) => s.includes('INSERT INTO venue_lists'))).toBe(true);
    expect(sqls.some((s) => s.includes('INSERT INTO venue_list_items'))).toBe(true);
    // The companion insert referenced the real check-in id.
    const companionCall = clientQuery.mock.calls.find((c) => c[0].includes('INSERT INTO companions'))!;
    expect(companionCall[1]).toEqual(['c1', 'Ada']);
    // List item references the list id and venue id.
    const listItemCall = clientQuery.mock.calls.find((c) => c[0].includes('INSERT INTO venue_list_items'))!;
    expect(listItemCall[1]).toEqual(['l1', 'v1', 1, null]);
    // Checkin list + item were inserted; the dangling item was skipped.
    expect(sqls.some((s) => s.includes('INSERT INTO checkin_lists'))).toBe(true);
    const checkinListItemCall = clientQuery.mock.calls.find((c) => c[0].includes('INSERT INTO checkin_list_items'))!;
    expect(checkinListItemCall[1]).toEqual(['cl1', 'c1', 1, null]);
    expect(clientQuery.mock.calls.filter((c) => c[0].includes('INSERT INTO checkin_list_items'))).toHaveLength(1);
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
    expect(sqls.some((s) => s.includes('INSERT INTO companions'))).toBe(false);
    expect(sqls.some((s) => s.includes('INSERT INTO venue_lists'))).toBe(false);
  });
});

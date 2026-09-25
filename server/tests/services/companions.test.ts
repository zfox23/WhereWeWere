import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));

vi.mock('../../src/db', () => ({
  query: queryMock,
  pool: { connect: vi.fn(), end: vi.fn() },
}));

import {
  normalizeCompanions,
  getCompanions,
  getCompanionsByCheckin,
  insertCompanions,
  setCompanions,
  deleteCompanionsForCheckins,
  searchCompanionNames,
  listCompanionSummaries,
  addCompanionName,
  renameCompanionName,
  deleteCompanionName,
  restoreCompanionRows,
  companionNamesSql,
} from '../../src/services/companions';
import { companionsRouter } from '../../src/routes/companions';

beforeEach(() => {
  queryMock.mockReset();
});

describe('normalizeCompanions', () => {
  it('trims, drops empties, and de-duplicates case-insensitively', () => {
    expect(normalizeCompanions([' Ada ', 'ada', '', '  ', 'Grace', 42, null, 'Sam']))
      .toEqual(['Ada', 'Grace', 'Sam']);
  });

  it('returns [] for non-array input', () => {
    expect(normalizeCompanions('Ada')).toEqual([]);
    expect(normalizeCompanions(null)).toEqual([]);
    expect(normalizeCompanions(undefined)).toEqual([]);
  });
});

describe('getCompanions', () => {
  it('reads names for the (type, check-in) pair, ordered by name', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ name: 'Ada' }, { name: 'Linus' }] });
    const names = await getCompanions('location', 'c1');
    expect(names).toEqual(['Ada', 'Linus']);
    const [sql, values] = queryMock.mock.calls[0];
    expect(sql).toContain('FROM companions');
    expect(sql).toContain('checkin_type = $1');
    expect(sql).toContain('checkin_id = $2');
    expect(values).toEqual(['location', 'c1']);
  });
});

describe('getCompanionsByCheckin', () => {
  it('groups names by check-in id and skips empty id lists without querying', async () => {
    expect(await getCompanionsByCheckin('media', [])).toEqual(new Map());
    expect(queryMock).not.toHaveBeenCalled();

    queryMock.mockResolvedValueOnce({
      rows: [
        { checkin_id: 'c1', name: 'Ada' },
        { checkin_id: 'c1', name: 'Sam' },
        { checkin_id: 'c2', name: 'Grace' },
      ],
    });
    const map = await getCompanionsByCheckin('media', ['c1', 'c2', 'c3']);
    expect(map.get('c1')).toEqual(['Ada', 'Sam']);
    expect(map.get('c2')).toEqual(['Grace']);
    expect(map.has('c3')).toBe(false);
    const [sql, values] = queryMock.mock.calls[0];
    expect(sql).toContain('ANY($2::uuid[])');
    expect(values).toEqual(['media', ['c1', 'c2', 'c3']]);
  });
});

describe('insertCompanions', () => {
  it('is a no-op when every name is empty or invalid', async () => {
    await insertCompanions('media', 'c1', ['  ', '', 42, null]);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('inserts the normalized names idempotently', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    await insertCompanions('media', 'c1', ['Ada', 'ada', 'Sam']);
    const [sql, values] = queryMock.mock.calls[0];
    expect(sql).toContain('INSERT INTO companions');
    expect(sql).toContain('ON CONFLICT (checkin_type, checkin_id, name) DO NOTHING');
    expect(values).toEqual(['media', 'c1', ['Ada', 'Sam']]);
  });
});

describe('setCompanions', () => {
  it('replaces: deletes the existing rows, inserts the new ones, returns normalized names', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [] }) // delete
      .mockResolvedValueOnce({ rows: [] }); // insert
    const names = await setCompanions('location', 'c1', [' Ada ', 'ada', 'Grace']);
    expect(names).toEqual(['Ada', 'Grace']);
    const [delSql, delValues] = queryMock.mock.calls[0];
    expect(delSql).toContain('DELETE FROM companions');
    expect(delValues).toEqual(['location', 'c1']);
    const [, insValues] = queryMock.mock.calls[1];
    expect(insValues).toEqual(['location', 'c1', ['Ada', 'Grace']]);
  });

  it('clears all companions when given an empty list', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] }); // delete only
    const names = await setCompanions('location', 'c1', []);
    expect(names).toEqual([]);
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it('runs on the provided executor when given one (transactional use)', async () => {
    const clientQuery = vi.fn().mockResolvedValue({ rows: [] });
    const names = await setCompanions('media', 'c9', ['Ada'], { query: clientQuery });
    expect(names).toEqual(['Ada']);
    expect(clientQuery).toHaveBeenCalledTimes(2);
    expect(queryMock).not.toHaveBeenCalled();
  });
});

describe('deleteCompanionsForCheckins', () => {
  it('deletes by (type, id list) and no-ops for an empty list', async () => {
    await deleteCompanionsForCheckins('media', []);
    expect(queryMock).not.toHaveBeenCalled();

    queryMock.mockResolvedValueOnce({ rowCount: 2 });
    await deleteCompanionsForCheckins('media', ['c1', 'c2']);
    const [sql, values] = queryMock.mock.calls[0];
    expect(sql).toContain('DELETE FROM companions');
    expect(sql).toContain('ANY($2::uuid[])');
    expect(values).toEqual(['media', ['c1', 'c2']]);
  });
});

describe('searchCompanionNames', () => {
  it('returns distinct, ordered names with a default limit', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ name: 'Ada' }, { name: 'Grace' }] });
    const names = await searchCompanionNames();
    expect(names).toEqual(['Ada', 'Grace']);
    const [sql, values] = queryMock.mock.calls[0];
    expect(sql).toContain('GROUP BY name');
    expect(sql).toContain('ORDER BY name');
    expect(values).toEqual([50]);
  });

  it('applies a case-insensitive substring filter when q is present', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ name: 'Ada' }] });
    await searchCompanionNames('ad', '10');
    const [sql, values] = queryMock.mock.calls[0];
    expect(sql).toContain('WHERE name ILIKE $1');
    expect(values).toEqual(['%ad%', 10]);
  });

  it('clamps the limit to the 1..200 range', async () => {
    queryMock.mockResolvedValue({ rows: [] });
    await searchCompanionNames(null, 9999);
    expect(queryMock.mock.calls[0][1]).toEqual([200]);
    await searchCompanionNames(null, '0');
    expect(queryMock.mock.calls[1][1]).toEqual([50]);
  });
});

describe('companionNamesSql', () => {
  it('emits a scalar jsonb-array subquery for the check-in id expression', () => {
    const sql = companionNamesSql('media', 'mmc.id');
    expect(sql).toContain('json_agg(name ORDER BY name)');
    expect(sql).toContain("'[]'::json");
    expect(sql).toContain(`checkin_type = 'media'`);
    expect(sql).toContain('checkin_id = mmc.id');
  });

  it('rejects types that are not safe plugin ids (SQL injection guard)', () => {
    expect(() => companionNamesSql("media' OR '1'='1", 'c.id')).toThrow();
    expect(() => companionNamesSql('Media', 'c.id')).toThrow();
  });
});

describe('listCompanionSummaries', () => {
  const unionSql = 'SELECT id, checked_in_at FROM plugin_checkins WHERE id = ANY($1::uuid[])';

  it('resolves check-in ids first, then LEFT JOINs the timestamp union', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ checkin_id: 'c1' }, { checkin_id: 'c2' }] })
      .mockResolvedValueOnce({
        rows: [
          { name: 'Ada', checkin_count: 2, last_checkin_at: '2024-01-02T00:00:00Z' },
          { name: 'Sam', checkin_count: 0, last_checkin_at: null },
        ],
      });
    const summaries = await listCompanionSummaries(unionSql);
    expect(summaries).toEqual([
      { name: 'Ada', checkin_count: 2, last_checkin_at: '2024-01-02T00:00:00Z' },
      { name: 'Sam', checkin_count: 0, last_checkin_at: null },
    ]);
    const [idsSql, idsValues] = queryMock.mock.calls[0];
    expect(idsSql).toContain('SELECT DISTINCT checkin_id FROM companions');
    expect(idsValues).toEqual([]);
    const [sql, values] = queryMock.mock.calls[1];
    expect(sql).toContain('COUNT(c.checkin_id)');
    expect(sql).toContain('LEFT JOIN');
    expect(sql).toContain(unionSql);
    expect(sql).toContain('GROUP BY c.name');
    expect(values).toEqual([['c1', 'c2']]);
  });
});

describe('addCompanionName', () => {
  it('rejects blank names without querying', async () => {
    await expect(addCompanionName('   ')).rejects.toMatchObject({ status: 400 });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('rejects (409) a name that already exists case-insensitively', async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 1, rows: [{}] });
    await expect(addCompanionName('ada')).rejects.toMatchObject({ status: 409 });
    const [sql, values] = queryMock.mock.calls[0];
    expect(sql).toContain('lower(name) = lower($1)');
    expect(values).toEqual(['ada']);
  });

  it('inserts a standalone row (no check-in reference) and returns the trimmed name', async () => {
    queryMock
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });
    const name = await addCompanionName('  Ada  ');
    expect(name).toBe('Ada');
    const [sql, values] = queryMock.mock.calls[1];
    expect(sql).toBe('INSERT INTO companions (name) VALUES ($1)');
    expect(values).toEqual(['Ada']);
  });
});

describe('renameCompanionName', () => {
  it('rejects blank inputs without querying', async () => {
    await expect(renameCompanionName('ada', '  ')).rejects.toMatchObject({ status: 400 });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('no-ops (0) when the name is unchanged', async () => {
    expect(await renameCompanionName('Ada', 'Ada')).toBe(0);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('rejects (409) a rename that would duplicate an existing standalone name', async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 1, rows: [{}] });
    await expect(renameCompanionName('ada', 'Ada Lovelace')).rejects.toMatchObject({ status: 409 });
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it('moves rows to the new name (merging conflicts) and returns the row count', async () => {
    queryMock
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // no standalone collision
      .mockResolvedValueOnce({ rowCount: 3, rows: [] }); // delete
    const updated = await renameCompanionName('ada', 'Ada Lovelace');
    expect(updated).toBe(3);
    const [sql, values] = queryMock.mock.calls[1];
    expect(sql).toContain('INSERT INTO companions (checkin_type, checkin_id, name)');
    expect(sql).toContain('ON CONFLICT (checkin_type, checkin_id, name) DO NOTHING');
    expect(sql).toContain('DELETE FROM companions WHERE name = $1');
    expect(values).toEqual(['ada', 'Ada Lovelace']);
  });
});

describe('deleteCompanionName', () => {
  it('rejects blank names without querying', async () => {
    await expect(deleteCompanionName('')).rejects.toMatchObject({ status: 400 });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('deletes every row for the exact name and returns the count', async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 2, rows: [] });
    const deleted = await deleteCompanionName('Ada');
    expect(deleted).toBe(2);
    const [sql, values] = queryMock.mock.calls[0];
    expect(sql).toBe('DELETE FROM companions WHERE name = $1');
    expect(values).toEqual(['Ada']);
  });
});

describe('restoreCompanionRows', () => {
  const id = '11111111-1111-1111-1111-111111111111';

  it('inserts check-in rows keyed by (type, id, name)', async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 1, rows: [] });
    const counts = await restoreCompanionRows([
      { checkin_type: 'location', checkin_id: id, name: 'Ada', created_at: '2024-01-01T00:00:00Z' },
    ]);
    expect(counts).toEqual({ inserted: 1, skipped: 0 });
    const [sql, values] = queryMock.mock.calls[0];
    expect(sql).toContain('ON CONFLICT (checkin_type, checkin_id, name) DO NOTHING');
    expect(values).toEqual(['location', id, 'Ada', '2024-01-01T00:00:00Z']);
  });

  it('inserts standalone rows via the partial unique index arbiter', async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 1, rows: [] });
    await restoreCompanionRows([{ name: 'Ada' }]);
    const [sql, values] = queryMock.mock.calls[0];
    expect(sql).toContain('ON CONFLICT (lower(name)) WHERE checkin_id IS NULL DO NOTHING');
    expect(values).toEqual(['Ada', null]);
  });

  it('skips invalid rows without querying them', async () => {
    const counts = await restoreCompanionRows([
      'not-an-object',
      null,
      { name: '   ' },
      { checkin_type: 'location', name: 'Ada' },           // type without id
      { checkin_id: id, name: 'Ada' },                     // id without type
      { checkin_type: 'location', checkin_id: 'nope', name: 'Ada' }, // bad uuid
    ]);
    expect(counts).toEqual({ inserted: 0, skipped: 6 });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('de-duplicates case variants within the dump and counts conflicts as skipped', async () => {
    queryMock
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })  // Ada (check-in) inserted
      .mockResolvedValueOnce({ rowCount: 1, rows: [] }); // ada (standalone) inserted
    const counts = await restoreCompanionRows([
      { checkin_type: 'location', checkin_id: id, name: 'Ada' },
      { checkin_type: 'location', checkin_id: id, name: 'ada' },  // dupe of row 1
      { name: 'ada' },                                            // standalone
      { name: 'ADA' },                                            // dupe of row 3
    ]);
    expect(counts).toEqual({ inserted: 2, skipped: 2 });
    expect(queryMock).toHaveBeenCalledTimes(2);
  });

  it('counts an existing row (no insert) as skipped', async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const counts = await restoreCompanionRows([{ name: 'Ada' }]);
    expect(counts).toEqual({ inserted: 0, skipped: 1 });
  });
});

describe('GET /companions (core route)', () => {
  function app() {
    const a = express();
    a.use(express.json());
    a.use('/companions', companionsRouter);
    return a;
  }

  it('returns one summary row per companion name', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ checkin_id: 'c1' }] })
      .mockResolvedValueOnce({
        rows: [{ name: 'Ada', checkin_count: 1, last_checkin_at: '2024-01-01T00:00:00Z' }],
      });
    const res = await request(app()).get('/companions');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { name: 'Ada', checkin_count: 1, last_checkin_at: '2024-01-01T00:00:00Z' },
    ]);
  });

  it('POST /names adds a name (201) and 409s on duplicates', async () => {
    queryMock
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });
    const created = await request(app()).post('/companions/names').send({ name: ' Ada ' });
    expect(created.status).toBe(201);
    expect(created.body).toEqual({ name: 'Ada' });

    queryMock.mockResolvedValueOnce({ rowCount: 1, rows: [{}] });
    const dup = await request(app()).post('/companions/names').send({ name: 'ada' });
    expect(dup.status).toBe(409);
    expect(dup.body).toEqual({ error: 'Companion "ada" already exists' });

    const blank = await request(app()).post('/companions/names').send({ name: '  ' });
    expect(blank.status).toBe(400);
  });

  it('PUT /names renames a name and 409s on standalone collisions', async () => {
    queryMock
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 2, rows: [] });
    const res = await request(app()).put('/companions/names').send({ from: 'ada', to: 'Ada' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ updated: 2 });

    queryMock.mockResolvedValueOnce({ rowCount: 1, rows: [{}] });
    const dup = await request(app()).put('/companions/names').send({ from: 'ada', to: 'Ada' });
    expect(dup.status).toBe(409);
  });

  it('DELETE /names removes a name', async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 4, rows: [] });
    const res = await request(app()).delete('/companions/names').send({ name: 'Ada' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: 4 });
  });
});

describe('GET /companions/names (core route)', () => {
  function app() {
    const a = express();
    a.use(express.json());
    a.use('/companions', companionsRouter);
    return a;
  }

  it('returns distinct, ILIKE-filtered names', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ name: 'Ada' }, { name: 'Adam' }] });
    const res = await request(app()).get('/companions/names?q=ad&limit=10');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(['Ada', 'Adam']);
    const [sql, values] = queryMock.mock.calls[0];
    expect(sql).toContain('FROM companions');
    expect(values).toEqual(['%ad%', 10]);
  });

  it('500s with an error body when the query fails', async () => {
    queryMock.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app()).get('/companions/names');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to list companion names' });
  });
});

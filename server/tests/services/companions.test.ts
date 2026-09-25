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

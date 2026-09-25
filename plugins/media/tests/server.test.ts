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

import { server, buildMediaDetailPath, mediaRouter } from '../server';
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

describe('buildMediaDetailPath', () => {
  it('maps media types to their URL segment and slugs the title', () => {
    expect(buildMediaDetailPath('movie', 'm1', 'The Matrix')).toBe('/media/movie/m1/the-matrix');
    expect(buildMediaDetailPath('tv_show', 'm2', 'Breaking Bad')).toBe('/media/tv/m2/breaking-bad');
    expect(buildMediaDetailPath('board_game', 'm3', 'Catan: Seafarers')).toBe('/media/board-game/m3/catan-seafarers');
  });

  it('falls back to the movie segment for unknown types and drops the slug without a title', () => {
    expect(buildMediaDetailPath('unknown', 'm1', 'Title')).toBe('/media/movie/m1/title');
    expect(buildMediaDetailPath('movie', 'm1', null)).toBe('/media/movie/m1/');
  });
});

describe('media plugin — timeline', () => {
  it('selects the shared timeline columns plus the media_* envelope fields', () => {
    const { sql } = server.buildTimelineSelect!();
    expect(sql).toContain(`'media'`);
    expect(sql).toContain('FROM media_checkins mmc');
    expect(sql).toContain('JOIN media_items mi ON mmc.media_item_id = mi.id');
    expect(sql).toContain('media_title');
    expect(sql).toContain('media_image_url');
  });

  it('builds the WHERE clause with user, date range, and search conditions', () => {
    const { sql, values } = server.buildTimelineWhere!({
      user_id: 'u1',
      from: '2026-01-01',
      to: '2026-01-31',
      q: 'matrix',
      filterParams: {},
    });
    expect(sql).toContain('mmc.user_id = $1');
    expect(sql).toContain("::date >= $2::date");
    expect(sql).toContain("::date <= $3::date");
    // Search covers both the item's title and the check-in's notes.
    expect(sql).toContain("mi.title ILIKE '%' || $4 || '%'");
    expect(sql).toContain("mmc.notes ILIKE '%' || $5 || '%'");
    expect(values).toEqual(['u1', '2026-01-01', '2026-01-31', 'matrix', 'matrix']);
  });

  it('scopes by the media_subtype filter param, dropping unknown subtypes', () => {
    const { sql, values } = server.buildTimelineWhere!({
      ...baseCtx,
      filterParams: { media_subtype: 'movie,game' },
    });
    expect(sql).toContain('mi.media_type = ANY($2::text[])');
    expect(values).toEqual(['u1', ['movie', 'game']]);
  });

  it('adds no subtype condition when every requested subtype is unknown', () => {
    const { sql, values } = server.buildTimelineWhere!({
      ...baseCtx,
      filterParams: { media_subtype: 'banana,kiwi' },
    });
    expect(sql).not.toContain('mi.media_type');
    expect(values).toEqual(['u1']);
  });
});

describe('media plugin — plugin shape', () => {
  it('declares custom storage and its two stable API mounts', () => {
    expect(server.storage).toBe('custom');
    const mounts = Array.isArray(server.api) ? server.api : [server.api as any];
    expect(mounts.map((m: any) => m.mount)).toEqual(['/media', '/webhook/plex']);
    for (const mount of mounts) {
      expect(typeof mount.router).toBe('function');
      expect(Array.isArray(mount.router.stack)).toBe(true);
    }
  });

  it('backs up items first, then check-ins, lists, and list memberships', () => {
    expect(server.backupOrder).toEqual(['primary', 'mediaCheckins', 'mediaLists', 'mediaListItems']);
    const tables = (server.extraBackupTables ?? []).map((t) => t.table);
    expect(tables).toEqual(['mediaCheckins', 'mediaLists', 'mediaListItems']);
  });

  it('declares legacy backup keys and settings keys for pre-plugin restores', () => {
    expect(server.legacyBackupKeys).toEqual(['mediaItems', 'mediaCheckins', 'mediaLists', 'mediaListItems']);
    expect(server.settingsKeys!.map((k) => k.name)).toEqual([
      'tmdb_api_key',
      'tgdb_api_key',
      'hardcover_api_key',
      'plex_usernames',
    ]);
    expect(server.legacySettingsKeys).toEqual([
      'tmdb_api_key',
      'tgdb_api_key',
      'hardcover_api_key',
      'plex_usernames',
    ]);
  });
});

describe('media plugin — backup hooks', () => {
  it('exports media items scoped to the user, ordered for a deterministic restore', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'i1', media_type: 'movie', title: 'T' }] });
    const result = await server.backupExport!({ user_id: 'u1' } as any);
    expect(result).toEqual([{ id: 'i1', media_type: 'movie', title: 'T' }]);
    const [sql, values] = queryMock.mock.calls[0];
    expect(sql).toContain('FROM media_items WHERE user_id = $1');
    expect(sql).toContain('ORDER BY created_at ASC');
    expect(values).toEqual(['u1']);
  });

  it('imports items via the transaction client and skips invalid rows', async () => {
    const clientQuery = vi.fn(async (_sql: string, _values: unknown[]) => ({ rows: [], rowCount: 1 }));
    const client = { query: clientQuery, release: vi.fn() };
    const inserted = await server.backupImport!(
      { user_id: 'u1', client } as any,
      [
        { id: 'i1', media_type: 'movie', title: 'Valid' },
        { id: 'i2', media_type: 'movie' }, // missing title -> skipped
        { media_type: 'game', title: 'No id' }, // missing id -> skipped
      ],
    );
    expect(inserted).toBe(1);
    expect(clientQuery).toHaveBeenCalledTimes(1);
    expect(clientQuery.mock.calls[0][0]).toContain('INSERT INTO media_items');
    expect(client.release).not.toHaveBeenCalled(); // provided client is not released
  });

  it('opens and releases its own connection when no client is provided', async () => {
    const clientQuery = vi.fn(async () => ({ rows: [], rowCount: 1 }));
    const fakeClient = { query: clientQuery, release: vi.fn() };
    poolConnectMock.mockResolvedValueOnce(fakeClient);
    const inserted = await server.backupImport!(
      { user_id: 'u1' } as any,
      [{ id: 'i1', media_type: 'movie', title: 'Valid' }],
    );
    expect(inserted).toBe(1);
    expect(poolConnectMock).toHaveBeenCalledTimes(1);
    expect(fakeClient.release).toHaveBeenCalledTimes(1);
  });

  it('restores legacy backups in FK order and reports inserted/skipped counts', async () => {
    const clientQuery = vi.fn(async (_sql: string, _values: unknown[]) => ({ rows: [], rowCount: 1 }));
    const client = { query: clientQuery, release: vi.fn() };
    const counts = await server.restoreLegacyBackup!(
      { user_id: 'u1', client } as any,
      {
        mediaItems: [
          { id: 'i1', media_type: 'movie', title: 'Valid' },
          { id: 'i2' }, // invalid -> skipped
        ],
        mediaCheckins: [
          { id: 'c1', media_item_id: 'i1' },
          { id: 'c2' }, // invalid -> skipped
        ],
        mediaLists: [
          { id: 'l1', name: 'My list' },
          { id: 'l2' }, // invalid -> skipped
        ],
        mediaListItems: [
          { list_id: 'l1', media_item_id: 'i1', position: 0 },
          { media_item_id: 'i1' }, // invalid -> skipped
        ],
      },
    );
    expect(counts).toEqual({
      mediaItems: { inserted: 1, skipped: 1 },
      mediaCheckins: { inserted: 1, skipped: 1 },
      mediaLists: { inserted: 1, skipped: 1 },
      mediaListItems: { inserted: 1, skipped: 1 },
    });
    const sqls = clientQuery.mock.calls.map((c) => c[0]);
    expect(sqls).toHaveLength(4);
    expect(sqls[0]).toContain('INSERT INTO media_items');
    expect(sqls[1]).toContain('INSERT INTO media_checkins');
    expect(sqls[2]).toContain('INSERT INTO media_lists');
    expect(sqls[3]).toContain('INSERT INTO media_list_items');
  });

  it('falls back to the pool query when no transaction client is provided', async () => {
    queryMock.mockResolvedValue({ rows: [], rowCount: 1 });
    const counts = await server.restoreLegacyBackup!(
      { user_id: 'u1' } as any,
      { mediaItems: [{ id: 'i1', media_type: 'movie', title: 'Valid' }] },
    );
    expect(counts.mediaItems).toEqual({ inserted: 1, skipped: 0 });
    expect(queryMock.mock.calls[0][0]).toContain('INSERT INTO media_items');
  });

  it('deletes media in FK-safe order on start-over (check-ins before items, plex log last)', async () => {
    queryMock.mockResolvedValue({ rows: [], rowCount: 2 });
    expect(await server.deleteUserData!({ user_id: 'u1' } as any)).toBe(14);
    const sqls = queryMock.mock.calls.map((c) => c[0]);
    expect(sqls).toEqual([
      'DELETE FROM companions WHERE checkin_type = \'media\' AND checkin_id IN (SELECT id FROM media_checkins WHERE user_id = $1) RETURNING id',
      'DELETE FROM media_checkins WHERE user_id = $1 RETURNING id',
      'DELETE FROM media_list_items WHERE list_id IN (SELECT id FROM media_lists WHERE user_id = $1) RETURNING list_id',
      'DELETE FROM media_tv_episodes WHERE media_item_id IN (SELECT id FROM media_items WHERE user_id = $1) RETURNING id',
      'DELETE FROM media_items WHERE user_id = $1 RETURNING id',
      'DELETE FROM media_lists WHERE user_id = $1 RETURNING id',
      'DELETE FROM plex_webhook_events WHERE user_id = $1 RETURNING id',
    ]);
    for (const [, values] of queryMock.mock.calls) {
      expect(values).toEqual(['u1']);
    }
  });
});

describe('media plugin — cross-cutting hooks', () => {
  it('resolves anchor timestamps for photo/scrobble enrichment', () => {
    const { sql } = server.resolveTimestamps!();
    expect(sql).toContain('SELECT id, checked_in_at FROM media_checkins');
    expect(sql).toContain('id = ANY($1::uuid[])');
  });

  it('contributes a reflection branch in the shared column shape', () => {
    const { sql } = server.reflectionBranch!();
    expect(sql).toContain("'media' AS type");
    expect(sql).toContain('mc.checked_in_at');
    expect(sql).toContain('mc.notes AS note');
    expect(sql).toContain('reflection_year');
    expect(sql).toContain('years_ago');
    expect(sql).toContain('FROM media_checkins mc');
    expect(sql).toContain('JOIN media_items mi ON mc.media_item_id = mi.id');
    expect(sql).toContain('MM-DD');
    expect(sql).toContain('< EXTRACT(YEAR FROM $2::date)');
  });

  it('resolves the latest known media timezone at or before a reference time', () => {
    const { sql } = server.latestTimezoneAsOf!();
    expect(sql).toContain('FROM media_checkins');
    expect(sql).toContain('checked_in_at <= $1');
    expect(sql).toContain('user_id = $2');
  });

  it('loads check-ins as reconciliation rows and caches their item-based detail paths', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          id: 'c1',
          checked_in_at: '2026-01-01T14:00:00Z',
          original_timezone: null,
          media_type: 'movie',
          media_item_id: 'i1',
          media_title: 'The Matrix',
        },
      ],
    });
    const rows = await server.reconcile!.loadCheckins!('u1');
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('c1');
    // The detail path is item-scoped, not check-in-id-scoped.
    expect(server.reconcile!.detailPath!('c1')).toBe('/media/movie/i1/the-matrix');
  });

  it('falls back to the generic path when a check-in was never loaded', () => {
    expect(server.reconcile!.detailPath!('never-seen')).toBe('/media-checkins/never-seen');
  });

  it('persists the suggested timezone label-only and reports success', async () => {
    queryMock.mockResolvedValue({ rowCount: 1 });
    expect(await server.reconcile!.apply!('c1', 'Europe/Lisbon')).toBe(true);
    const [sql, values] = queryMock.mock.calls[0];
    expect(sql).toContain('UPDATE media_checkins');
    expect(sql).toContain('SET checkin_timezone = $2');
    expect(values).toEqual(['c1', 'Europe/Lisbon']);
  });

  it('participates in scans only for rows missing a stored timezone', () => {
    expect(server.reconcile!.scanAll).toBe(false);
    expect(server.reconcile!.anchorLabel).toBe('a media check-in');
  });
});

describe('media check-in companions (endpoints)', () => {
  function app() {
    const a = express();
    a.use(express.json());
    a.use('/media', mediaRouter);
    return a;
  }

  it('the timeline branch carries companions on the shared envelope column', () => {
    const { sql } = server.buildTimelineSelect!();
    expect(sql).toContain(') AS companions');
    expect(sql).toContain("checkin_type = 'media'");
    expect(sql).toContain('checkin_id = mmc.id');
  });

  it('POST /items/:id/checkins stores companions and echoes them back', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ id: 'i1' }] }) // item exists
      .mockResolvedValueOnce({ rows: [{ id: 'mc1', checkin_type: 'completed' }] }) // insert
      .mockResolvedValueOnce({ rows: [] }); // companion insert

    const res = await request(app())
      .post('/media/items/i1/checkins')
      .send({ checkin_type: 'completed', timezone: 'UTC', companions: ['Ada', 'ada', 'Grace'] });
    expect(res.status).toBe(201);
    expect(res.body.companions).toEqual(['Ada', 'Grace']);
    const [sql, values] = queryMock.mock.calls[2];
    expect(sql).toContain('INSERT INTO companions');
    expect(values).toEqual(['media', 'mc1', ['Ada', 'Grace']]);
  });

  it('PUT /checkins/:id replaces companions when the key is present', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ id: 'mc1', rating: 2 }] }) // update
      .mockResolvedValueOnce({ rows: [] }) // companion delete
      .mockResolvedValueOnce({ rows: [] }); // companion insert

    const res = await request(app())
      .put('/media/checkins/mc1')
      .send({ rating: 2, companions: ['Sam'] });
    expect(res.status).toBe(200);
    expect(res.body.companions).toEqual(['Sam']);
    const [delSql, delValues] = queryMock.mock.calls[1];
    expect(delSql).toContain('DELETE FROM companions');
    expect(delValues).toEqual(['media', 'mc1']);
  });

  it('PUT /checkins/:id keeps existing companions when the key is absent', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ id: 'mc1', rating: 3 }] }) // update
      .mockResolvedValueOnce({ rows: [{ name: 'Ada' }] }); // read companions

    const res = await request(app()).put('/media/checkins/mc1').send({ rating: 3 });
    expect(res.status).toBe(200);
    expect(res.body.companions).toEqual(['Ada']);
    expect(queryMock).toHaveBeenCalledTimes(2);
  });

  it('GET /items/:id/checkins attaches companions to each row', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ id: 'mc1' }, { id: 'mc2' }] }) // check-in rows
      .mockResolvedValueOnce({
        rows: [{ checkin_id: 'mc1', name: 'Ada' }, { checkin_id: 'mc2', name: 'Grace' }],
      }); // companions by check-in

    const res = await request(app()).get('/media/items/i1/checkins');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { id: 'mc1', companions: ['Ada'] },
      { id: 'mc2', companions: ['Grace'] },
    ]);
  });

  it('DELETE /checkins/:id removes the companion rows too', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ id: 'mc1' }] }) // check-in delete
      .mockResolvedValueOnce({ rowCount: 1 }); // companion delete

    const res = await request(app()).delete('/media/checkins/mc1');
    expect(res.status).toBe(200);
    const [sql, values] = queryMock.mock.calls[1];
    expect(sql).toContain('DELETE FROM companions');
    expect(sql).toContain('checkin_type = $1');
    expect(values).toEqual(['media', ['mc1']]);
  });
});

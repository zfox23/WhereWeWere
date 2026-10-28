/**
 * Food plugin server-half tests (no DB): input parsing, the Mealie writeback
 * decisions (with fetch stubbed), and llm line rendering.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PluginLlmRow } from 'wwp-shared';
import { parseFoodInput, parseSuggestRequest, server, syncMealie } from '../server';

const CONFIG = { baseUrl: 'https://mealie.mydomain.io', token: 'tok' };

describe('parseFoodInput', () => {
  it('accepts a Mealie recipe meal', () => {
    const input = parseFoodInput({
      meal_type: 'dinner', recipe_name: ' Soup ', mealie_recipe_id: 'r1', mealie_recipe_slug: 'soup',
      rating: 3, checked_in_at: '2026-10-28T18:00:00-07:00', checkin_timezone: 'America/Los_Angeles',
    });
    expect(input).toMatchObject({
      meal_type: 'dinner', recipe_name: 'Soup', mealie_recipe_id: 'r1', rating: 3,
      checked_in_at: '2026-10-29T01:00:00.000Z', checkin_timezone: 'America/Los_Angeles',
    });
  });

  it('treats a 0 rating as unrated', () => {
    expect(parseFoodInput({ meal_type: 'lunch', recipe_name: 'Leftovers', rating: 0 }).rating).toBeNull();
  });

  it.each([
    [{ meal_type: 'brunch', recipe_name: 'x' }, /meal_type/],
    [{ meal_type: 'lunch', recipe_name: '  ' }, /Pick a recipe/],
    [{ meal_type: 'lunch', recipe_name: 'x', rating: 5 }, /rating/],
    [{ meal_type: 'lunch', recipe_name: 'x', mealie_recipe_id: 'r1' }, /go together/],
    [{ meal_type: 'lunch', recipe_name: 'x', location_checkin_id: 'nope' }, /uuid/],
    [{ meal_type: 'lunch', recipe_name: 'x', checkin_timezone: 'Mars/Base' }, /timezone/],
  ])('rejects %j', (body, message) => {
    expect(() => parseFoodInput(body)).toThrow(message);
  });
});

describe('parseSuggestRequest', () => {
  const base = { meal_types: ['dinner'], days: 7, start_date: '2026-10-28', variety: 'balanced', timezone: 'America/New_York' };

  it('accepts a valid request and drops bad coordinates', () => {
    expect(parseSuggestRequest({ ...base, latitude: 40.7, longitude: -74 })).toMatchObject({ latitude: 40.7, longitude: -74 });
    expect(parseSuggestRequest({ ...base, latitude: 140, longitude: -74 })).toMatchObject({ latitude: null, longitude: null });
  });

  it.each([
    [{ meal_types: [] }, /meal_types/],
    [{ meal_types: ['dinner', 'tea'] }, /meal_types/],
    [{ days: 0 }, /days/],
    [{ days: 15 }, /days/],
    [{ start_date: 'tomorrow' }, /start_date/],
    [{ variety: 'chaos' }, /variety/],
  ])('rejects %j', (over, message) => {
    expect(() => parseSuggestRequest({ ...base, ...over })).toThrow(message);
  });
});

describe('syncMealie', () => {
  const fetchMock = vi.fn<typeof fetch>();
  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  function row(over: Record<string, unknown> = {}) {
    return {
      id: 'c1', user_id: 'u', meal_type: 'dinner', recipe_name: 'Soup',
      mealie_recipe_id: 'r1', mealie_recipe_slug: 'soup', rating: null, notes: null,
      location_checkin_id: null, mealie_event_id: null,
      checked_in_at: '2026-10-28T18:00:00.000Z', checkin_timezone: null,
      created_at: '2026-10-28T18:00:00.000Z', updated_at: '2026-10-28T18:00:00.000Z',
      ...over,
    } as Parameters<typeof syncMealie>[1] & object;
  }
  const ok = (body: unknown = {}) => new Response(JSON.stringify(body), { status: 200 });
  const urls = () => fetchMock.mock.calls.map((c) => `${(c[1] as RequestInit | undefined)?.method ?? 'GET'} ${String(c[0]).replace(CONFIG.baseUrl, '')}`);

  it('does nothing for meals that are not Mealie recipes', async () => {
    vi.stubGlobal('fetch', fetchMock);
    const result = await syncMealie(CONFIG, null, row({ mealie_recipe_id: null, mealie_recipe_slug: null }));
    expect(result).toEqual({ eventId: null, sync: { status: 'skipped' } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('skips with a message when Mealie is not configured, keeping any stored event', async () => {
    const result = await syncMealie(null, row({ mealie_event_id: 'evt0' }), row());
    expect(result.eventId).toBe('evt0');
    expect(result.sync.status).toBe('skipped');
  });

  it('on create, adds a timeline event and bumps last-made', async () => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValueOnce(ok({ id: 'evt1' })).mockResolvedValueOnce(ok({ lastMade: null })).mockResolvedValueOnce(ok());
    const result = await syncMealie(CONFIG, null, row());
    expect(result).toEqual({ eventId: 'evt1', sync: { status: 'synced' } });
    expect(urls()).toEqual([
      'POST /api/recipes/timeline/events',
      'GET /api/households/self/recipes/soup',
      'PATCH /api/recipes/soup/last-made',
    ]);
  });

  it('on a notes-only edit, updates the existing event in place', async () => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValueOnce(ok());
    const result = await syncMealie(CONFIG, row({ mealie_event_id: 'evt1' }), row({ notes: 'Better', mealie_event_id: 'evt1' }));
    expect(result.eventId).toBe('evt1');
    expect(urls()).toEqual(['PUT /api/recipes/timeline/events/evt1']);
  });

  it('on a recipe change, replaces the event', async () => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock
      .mockResolvedValueOnce(ok())
      .mockResolvedValueOnce(ok({ id: 'evt2' }))
      .mockResolvedValueOnce(ok({ lastMade: null }))
      .mockResolvedValueOnce(ok());
    const result = await syncMealie(
      CONFIG,
      row({ mealie_event_id: 'evt1' }),
      row({ mealie_recipe_id: 'r2', mealie_recipe_slug: 'tacos', mealie_event_id: 'evt1' }),
    );
    expect(result.eventId).toBe('evt2');
    expect(urls()[0]).toBe('DELETE /api/recipes/timeline/events/evt1');
    expect(urls()[1]).toBe('POST /api/recipes/timeline/events');
  });

  it('on delete, removes the event', async () => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValueOnce(ok());
    const result = await syncMealie(CONFIG, row({ mealie_event_id: 'evt1' }), null);
    expect(result).toEqual({ eventId: null, sync: { status: 'synced' } });
    expect(urls()).toEqual(['DELETE /api/recipes/timeline/events/evt1']);
  });

  it('reports failures without throwing', async () => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const result = await syncMealie(CONFIG, null, row());
    expect(result.eventId).toBeNull();
    expect(result.sync.status).toBe('failed');
    expect(result.sync.message).toMatch(/Saved, but Mealie was not updated: Could not reach Mealie: ECONNREFUSED/);
  });
});

describe('llm hook', () => {
  it('renders a meal line', () => {
    const line = server.llm!.toLines({
      checked_in_at: '2026-10-28T23:30:00.000Z',
      timezone: 'UTC',
      data: { meal_type: 'dinner', recipe_name: 'Soup', rating: 4, eaten_out: true, companions: ['Sam'], note: 'Great' },
    } as PluginLlmRow);
    expect(line).toEqual(['- Oct 28, 2026, 11:30 PM — dinner: Soup (eaten out) with Sam (4/4) — note: "Great"']);
  });

  it('builds a timeline branch on the shared envelope', () => {
    const { sql } = server.buildTimelineSelect!();
    expect(sql).toContain(`'food' AS type`);
    expect(sql).toContain('FROM food_checkins fc');
    const where = server.buildTimelineWhere!({ user_id: 'u', from: null, to: null, q: null, filterParams: { meal_type: 'dinner,bogus' } });
    expect(where.sql).toContain('fc.meal_type = ANY');
    expect(where.values).toContainEqual(['dinner']);
  });
});

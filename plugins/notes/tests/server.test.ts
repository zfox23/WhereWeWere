/**
 * Notes plugin server-half tests (no DB): input parsing, the timeline WHERE
 * clause, and llm line rendering.
 */

import { describe, expect, it } from 'vitest';
import type { PluginLlmRow } from 'wwp-shared';
import { server } from '../server';
import { firstLine, normalizeTagNames, parseNoteInput } from '../services/notesRepo';

describe('parseNoteInput', () => {
  it('trims the title, keeps the markdown, dedupes tags', () => {
    const input = parseNoteInput({
      title: '  Session 4 ',
      body: '# Heading\r\n\r\n- one\n  ',
      checked_in_at: '2026-10-28T20:00:00-05:00',
      checkin_timezone: 'America/Chicago',
      tags: ['Therapy', ' therapy ', 'Dream  Journal', ''],
    });
    expect(input).toEqual({
      title: 'Session 4',
      body: '# Heading\n\n- one',
      checked_in_at: '2026-10-29T01:00:00.000Z',
      checkin_timezone: 'America/Chicago',
      tags: ['Therapy', 'Dream Journal'],
    });
  });

  it('allows a title-only note and an untitled one', () => {
    expect(parseNoteInput({ title: 'Just a title' }).body).toBe('');
    expect(parseNoteInput({ body: 'text' }).title).toBeNull();
  });

  it.each([
    [{}, /Write something/],
    [{ title: ' ', body: '  \n' }, /Write something/],
    [{ body: 'x', checkin_timezone: 'Mars/Base' }, /timezone/],
    [{ body: 'x', checked_in_at: 'nope' }, /checked_in_at/],
    [{ body: 'x', tags: 'Therapy' }, /tags/],
    [{ body: 'x', tags: ['x'.repeat(61)] }, /60/],
    [{ title: 'x'.repeat(301) }, /title/],
  ])('rejects %j', (body, message) => {
    expect(() => parseNoteInput(body)).toThrow(message);
  });

  it('normalizes tag names', () => {
    expect(normalizeTagNames(undefined)).toEqual([]);
    expect(normalizeTagNames(['A', 'a', 'B'])).toEqual(['A', 'B']);
  });
});

describe('firstLine', () => {
  it('skips blank lines and markers, and truncates', () => {
    expect(firstLine('\n\n- [x] done thing\nmore')).toBe('done thing');
    expect(firstLine('> quoted')).toBe('quoted');
    expect(firstLine('a'.repeat(200), 10)).toBe(`${'a'.repeat(9)}…`);
  });
});

describe('buildTimelineWhere', () => {
  const ctx = { user_id: 'u1', from: null, to: null, q: null, filterParams: {} } as never;

  it('scopes to the user', () => {
    const clause = server.buildTimelineWhere!(ctx);
    expect(clause.sql).toBe('n.user_id = $1');
    expect(clause.values).toEqual(['u1']);
  });

  it('searches full text, title and tag names with numbered params', () => {
    const clause = server.buildTimelineWhere!({ ...(ctx as object), q: '50%' } as never);
    expect(clause.sql).toContain(`plainto_tsquery('english', $2)`);
    expect(clause.sql).toContain('n.title ILIKE $3');
    expect(clause.sql).toContain('st.name ILIKE $4');
    expect(clause.values).toEqual(['u1', '50%', '%50\\%%', '%50\\%%']);
  });

  it('filters by tag names case-insensitively', () => {
    const clause = server.buildTimelineWhere!({ ...(ctx as object), filterParams: { note_tag: 'Therapy, Dream Journal,' } } as never);
    expect(clause.sql).toContain('lower(ft.name) = ANY($2::text[])');
    expect(clause.values).toEqual(['u1', ['therapy', 'dream journal']]);
  });
});

describe('llm.toLines', () => {
  it('renders title, tags, companions and a collapsed excerpt', () => {
    const row: PluginLlmRow = {
      checked_in_at: '2026-10-29T01:00:00Z',
      timezone: 'America/Chicago',
      data: { title: 'Session 4', tags: ['Therapy'], companions: ['Sam'], excerpt: 'Talked about\n\nwork.' },
    };
    expect(server.llm!.toLines(row)).toEqual([
      '- Oct 28, 2026, 8:00 PM — note "Session 4" [Therapy] with Sam: Talked about work.',
    ]);
  });
});

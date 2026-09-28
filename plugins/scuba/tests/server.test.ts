/**
 * SCUBA plugin server-half tests (no DB: SQL shape + llm rendering).
 * The import endpoint's file handling is covered by the logbook parser tests.
 */

import { describe, expect, it } from 'vitest';
import { server } from '../server';
import type { PluginLlmRow } from 'wwp-shared';

describe('scuba plugin — plugin shape', () => {
  it('uses generic storage and its two stable API mounts', () => {
    expect(server.storage).toBe('generic');
    const mounts = Array.isArray(server.api) ? server.api : [server.api as any];
    expect(mounts.map((m: any) => m.mount)).toEqual(['/scuba', '/import/scuba-logbook']);
    for (const mount of mounts) {
      expect(typeof mount.router).toBe('function');
      expect(Array.isArray(mount.router.stack)).toBe(true);
    }
  });

  it('provides the generic-storage cross-cutting hooks', () => {
    expect(server.reflectionBranch).toBeDefined();
    expect(server.earliestDate).toBeDefined();
    expect(server.resolveTimestamps).toBeDefined();
    expect(server.llm).toBeDefined();
    expect(server.reconcile).toBeDefined();
  });
});

describe('scuba plugin — reflection branch', () => {
  it('emits the scuba envelope and filters on user + month/day', () => {
    const sql = server.reflectionBranch!().sql;
    expect(sql).toContain("'scuba' AS type");
    expect(sql).toContain("pc.plugin_id = 'scuba'");
    expect(sql).toContain('pc.user_id = $1');
    expect(sql).toContain("TO_CHAR(pc.checked_in_at AT TIME ZONE COALESCE(pc.checkin_timezone, 'UTC'), 'MM-DD') = TO_CHAR($2::date, 'MM-DD')");
    expect(sql).toContain('reflection_year');
    expect(sql).toContain('years_ago');
    expect(sql).toContain('data');
  });
});

describe('scuba plugin — earliest date / timestamp hooks', () => {
  it('scopes earliestDate to scuba check-ins for the user', () => {
    const sql = server.earliestDate!().sql;
    expect(sql).toContain("plugin_id = 'scuba'");
    expect(sql).toContain('user_id = $1');
    expect(sql).toContain('MIN(');
  });

  it('resolves anchor timestamps for a uuid set', () => {
    const sql = server.resolveTimestamps!().sql;
    expect(sql).toContain("plugin_id = 'scuba'");
    expect(sql).toContain('$1::uuid[]');
  });
});

describe('scuba plugin — llm hook', () => {
  it('renders a one-line summary per dive', () => {
    const row: PluginLlmRow = {
      checked_in_at: '2019-07-04T15:10:00.000Z',
      timezone: 'America/Los_Angeles',
      data: {
        place: 'San Carlos Beach',
        city: 'Monterey',
        depth: 11.5,
        bottom_time: 55,
        comments: 'epic',
      },
    };
    const lines = server.llm!.toLines(row);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe('- dive San Carlos Beach, Monterey to 11.5 m 55 min — "epic"');
  });

  it('renders minimal dives without extras', () => {
    const lines = server.llm!.toLines({ checked_in_at: new Date(), timezone: null, data: {} });
    expect(lines).toEqual(['- dive']);
  });
});

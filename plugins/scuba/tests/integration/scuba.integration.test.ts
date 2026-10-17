import { describe, expect, beforeAll, beforeEach, afterAll, it } from 'vitest';
import { query } from '../../../../server/src/db';
import {
  resetIntegrationDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase,
} from '../../../../server/tests/helpers/testDb';
// Importing the app registers every plugin (the scuba import looks its plugin up in the registry).
import '../../../../server/src/index';
import { executeScubaLogbookImport } from '../../server';

type Row = Parameters<typeof executeScubaLogbookImport>[0][number];

function dive(over: { uuid?: string; at: string; place: string; depth: number }): Row {
  return {
    source_row: 0,
    local_date: over.at.slice(0, 10),
    checked_in_at: over.at,
    checkin_timezone: 'UTC',
    timezone_source: 'test',
    data: {
      ...(over.uuid ? { source_uuid: over.uuid } : {}),
      place: over.place,
      depth: over.depth,
      entry_time: '09:00',
    },
  } as unknown as Row;
}

describe('Scuba logbook import (integration)', () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  });
  beforeEach(async () => {
    await resetIntegrationDatabase();
  });
  afterAll(async () => {
    await teardownIntegrationDatabase();
  });

  it('is idempotent for dives with a UUID and for dives without one', async () => {
    const rows = [
      dive({ uuid: 'U-1', at: '2024-03-01T09:00:00.000Z', place: 'Blue Hole', depth: 30 }),
      dive({ at: '2024-03-02T09:00:00.000Z', place: 'Reef', depth: 18 }),
      dive({ at: '2024-03-02T13:00:00.000Z', place: 'Reef', depth: 20 }),
    ];

    const first = await executeScubaLogbookImport(rows);
    expect(first.imported).toBe(3);
    expect(first.imported_ids.every((id) => typeof id === 'string')).toBe(true);

    const second = await executeScubaLogbookImport(rows);
    expect(second.imported).toBe(0);
    expect(second.skipped).toBe(3);
    expect(second.imported_ids).toEqual([null, null, null]);

    const count = await query(`SELECT COUNT(*)::int AS n FROM plugin_checkins WHERE plugin_id = 'scuba'`);
    expect(count.rows[0].n).toBe(3);
  });

  it('dedupes repeated dives inside a single import too', async () => {
    const d = dive({ at: '2024-04-01T09:00:00.000Z', place: 'Wall', depth: 25 });
    const result = await executeScubaLogbookImport([d, { ...d }]);
    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(1);
  });
});

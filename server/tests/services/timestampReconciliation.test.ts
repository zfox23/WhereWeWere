import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock, moodRowsMock, mediaRowsMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  moodRowsMock: [] as unknown[],
  mediaRowsMock: [] as unknown[],
}));

vi.mock('../../src/db', () => ({
  query: queryMock,
}));

// Check-in plugins participate via their reconcile hooks. Mood and media are
// registered here; location/sleep/tracks are out of scope for these tests,
// which focus on the core anchor-resolution logic for media rows.
vi.mock('../../src/plugins/registry', () => ({
  allPlugins: () => [
    {
      id: 'mood',
      server: {
        reconcile: {
          anchorLabel: 'mood check-in',
          scanAll: true,
          detailPath: (id: string) => `/mood-checkins/${id}`,
          loadCheckins: async () => moodRowsMock,
          apply: async () => true,
        },
      },
    },
    {
      id: 'media',
      server: {
        reconcile: {
          anchorLabel: 'a media check-in',
          scanAll: false,
          detailPath: (id: string) => `/media-checkins/${id}`,
          loadCheckins: async () => mediaRowsMock,
          apply: async () => true,
        },
      },
    },
  ],
}));

import { getTimestampReconciliationSuggestions } from '../../src/services/timestampReconciliation';

// The core scan is hook-driven (no direct queries); plugin rows come from
// their reconcile.loadCheckins hooks (stubbed above).
function mockScan(moodRows: unknown[], mediaRows: unknown[]) {
  moodRowsMock.length = 0;
  moodRowsMock.push(...moodRows);
  mediaRowsMock.length = 0;
  mediaRowsMock.push(...mediaRows);
}

beforeEach(() => {
  queryMock.mockReset();
});

describe('getTimestampReconciliationSuggestions', () => {
  it('normalizes Etc/GMT+N anchor timezones to IANA zones in fallback suggestions', async () => {
    // A Daylio import stores fixed offsets as Etc/GMT+4 (= UTC-4, i.e. EDT).
    // The app displays those as America/New_York, so suggestions must match.
    mockScan(
      [
        { id: 'm1', checked_in_at: '2026-06-15T12:00:00Z', original_timezone: null },
        { id: 'm2', checked_in_at: '2026-06-15T11:00:00Z', original_timezone: 'Etc/GMT+4' },
      ],
      [
        {
          id: 'mc1',
          checked_in_at: '2026-06-15T12:30:00Z',
          original_timezone: 'UTC',
          media_type: 'movie',
          media_item_id: 'mi1',
          media_title: 'Test Film',
        },
      ]
    );

    const result = await getTimestampReconciliationSuggestions();

    const moodSuggestion = result.suggestions.find((s) => s.id === 'm1');
    expect(moodSuggestion).toMatchObject({ type: 'mood', suggested_timezone: 'America/New_York' });
    expect(moodSuggestion!.reason).toContain('America/New_York');
    expect(moodSuggestion!.reason).not.toContain('Etc/GMT+4');

    const mediaSuggestion = result.suggestions.find((s) => s.id === 'mc1');
    expect(mediaSuggestion).toMatchObject({ type: 'media', suggested_timezone: 'America/New_York' });
    expect(mediaSuggestion!.reason).toContain('Stored timezone is UTC.');
    expect(mediaSuggestion!.reason).not.toContain('Etc/GMT+4');
  });

  it('does not suggest a change when the stored Etc/GMT zone is equivalent to the resolved IANA zone', async () => {
    // A mood check-in stored as America/New_York anchors a sibling stored as
    // Etc/GMT+4 (UTC-4), which is equivalent during EDT — so no suggestion.
    mockScan(
      [
        { id: 'm0', checked_in_at: '2026-06-15T12:00:00Z', original_timezone: 'America/New_York' },
        { id: 'm1', checked_in_at: '2026-06-15T12:05:00Z', original_timezone: 'Etc/GMT+4' },
      ],
      []
    );

    const result = await getTimestampReconciliationSuggestions();

    expect(result.suggestions).toEqual([]);
    // No uninferable mood check-in: the key is only created when one exists.
    expect(result.uninferable['mood'] ?? []).toEqual([]);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));

vi.mock('../../src/db', () => ({
  query: queryMock,
}));

import { getTimestampReconciliationSuggestions } from '../../src/services/timestampReconciliation';

// The scan issues five queries in this order: venues, moods, media, tracks, sleep.
function mockScan(
  venueRows: unknown[],
  moodRows: unknown[],
  mediaRows: unknown[],
  trackRows: unknown[] = [],
  sleepRows: unknown[] = []
) {
  queryMock
    .mockResolvedValueOnce({ rows: venueRows })
    .mockResolvedValueOnce({ rows: moodRows })
    .mockResolvedValueOnce({ rows: mediaRows })
    .mockResolvedValueOnce({ rows: trackRows })
    .mockResolvedValueOnce({ rows: sleepRows });
}

beforeEach(() => {
  queryMock.mockReset();
});

describe('getTimestampReconciliationSuggestions', () => {
  it('normalizes Etc/GMT+N anchor timezones to IANA zones in fallback suggestions', async () => {
    // A Daylio import stores fixed offsets as Etc/GMT+4 (= UTC-4, i.e. EDT).
    // The app displays those as America/New_York, so suggestions must match.
    mockScan(
      [],
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
    // Venue near New York resolves to America/New_York. A mood check-in stored
    // as Etc/GMT+4 (UTC-4) is equivalent during EDT, so no suggestion.
    mockScan(
      [
        {
          id: 'v1',
          checked_in_at: '2026-06-15T12:00:00Z',
          original_timezone: 'America/New_York',
          venue_name: 'NY Cafe',
          latitude: 40.7128,
          longitude: -74.006,
        },
      ],
      [{ id: 'm1', checked_in_at: '2026-06-15T12:05:00Z', original_timezone: 'Etc/GMT+4' }],
      []
    );

    const result = await getTimestampReconciliationSuggestions();

    expect(result.suggestions).toEqual([]);
    expect(result.uninferable_mood_checkins).toEqual([]);
  });
});

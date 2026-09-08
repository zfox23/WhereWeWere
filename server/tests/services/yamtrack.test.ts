import { describe, expect, it } from 'vitest';
import {
  countPlans,
  mapYamtrackSource,
  parseYamtrackCsv,
  planYamtrackImport,
  scoreToRating,
  type YamtrackRow,
} from '../../src/services/yamtrack';

function row(overrides: Partial<YamtrackRow> & { line: number }): YamtrackRow {
  return {
    media_id: '1',
    source: 'tmdb',
    media_type: 'movie',
    title: 'Test',
    image: null,
    season_number: null,
    episode_number: null,
    score: null,
    status: null,
    notes: null,
    start_date: null,
    end_date: null,
    progress: null,
    created_at: null,
    progressed_at: null,
    ...overrides,
  };
}

const CSV_HEADER =
  '"media_id","source","media_type","title","image","season_number","episode_number","score","status","notes","start_date","end_date","progress","created_at","progressed_at"';

describe('mapYamtrackSource', () => {
  it('maps known sources', () => {
    expect(mapYamtrackSource('tmdb')).toBe('tmdb');
    expect(mapYamtrackSource('igdb')).toBe('tgdb');
    expect(mapYamtrackSource('tgdb')).toBe('tgdb');
    expect(mapYamtrackSource('hardcover')).toBe('hardcover');
    expect(mapYamtrackSource('unknown')).toBeNull();
  });
});

describe('scoreToRating', () => {
  it('maps raw scores into 0-4 star bands', () => {
    expect(scoreToRating('10')).toBe(4);
    expect(scoreToRating('9.5')).toBe(3);
    expect(scoreToRating('7.5')).toBe(3);
    expect(scoreToRating('7.49')).toBe(2);
    expect(scoreToRating('5')).toBe(2);
    expect(scoreToRating('4.99')).toBe(1);
    expect(scoreToRating('2.5')).toBe(1);
    expect(scoreToRating('2.49')).toBe(0);
    expect(scoreToRating('0.5')).toBe(0);
  });

  it('returns null for blank, missing, non-numeric, or non-positive scores', () => {
    expect(scoreToRating(null)).toBeNull();
    expect(scoreToRating('')).toBeNull();
    expect(scoreToRating(undefined)).toBeNull();
    expect(scoreToRating('abc')).toBeNull();
    expect(scoreToRating('0')).toBeNull();
    expect(scoreToRating('-1')).toBeNull();
  });
});

describe('parseYamtrackCsv', () => {
  it('parses a yamtrack export into rows with 1-based line numbers', () => {
    const csv = [
      CSV_HEADER,
      '"100088","tmdb","tv","The Last of Us","https://x.jpg","","","","Completed","","2023-04-04 01:49:00+00:00","2025-05-26 01:50:00+00:00","16","2026-01-19 17:01:18+00:00","2025-05-26 01:50:00+00:00"',
      '"2","tmdb","episode","LOU E1","https://x.jpg","1","1","","Completed","","2023-04-04 01:50:00+00:00","","0","",""',
    ].join('\n');

    const rows = parseYamtrackCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0].line).toBe(2);
    expect(rows[0].media_id).toBe('100088');
    expect(rows[0].media_type).toBe('tv');
    expect(rows[0].title).toBe('The Last of Us');
    expect(rows[1].season_number).toBe('1');
    expect(rows[1].episode_number).toBe('1');
    expect(rows[1].line).toBe(3);
  });

  it('treats empty strings as null', () => {
    const csv = [CSV_HEADER, '"1","tmdb","movie","X","x.jpg","5","","","","","","",""'].join('\n');
    const [r] = parseYamtrackCsv(csv);
    expect(r.season_number).toBe('5');
    expect(r.episode_number).toBeNull();
    expect(r.status).toBeNull();
  });
});

describe('planYamtrackImport', () => {
  it('classifies tv/season rows as tv show entity creation', () => {
    const plans = planYamtrackImport([row({ line: 2, media_type: 'tv', title: 'Show', media_id: '10' })]);
    expect(plans).toHaveLength(1);
    expect(plans[0].disposition).toBe('create_tv_show');
    expect(plans[0].media_type).toBe('tv_show');
    expect(plans[0].external_id).toBe('10');
  });

  it('classifies episode rows with end_date as completed episode check-ins timed at end_date', () => {
    const plans = planYamtrackImport([
      row({ line: 2, media_type: 'episode', title: 'Show', media_id: '10', season_number: '1', episode_number: '2', end_date: '2023-04-04 01:50:00+00:00', score: '10' }),
    ]);
    expect(plans[0].disposition).toBe('create_episode_checkin');
    expect(plans[0].checkin_type).toBe('completed');
    expect(plans[0].season_number).toBe(1);
    expect(plans[0].episode_number).toBe(2);
    expect(plans[0].rating).toBe(4);
    expect(plans[0].checked_in_at).toBe('2023-04-04 01:50:00+00:00');
    expect(plans[0].external_event_id).toBeTruthy();
  });

  it('prefers end_date over start_date as the check-in time', () => {
    const plans = planYamtrackImport([
      row({ line: 2, media_type: 'episode', title: 'Show', media_id: '10', season_number: '1', episode_number: '2', start_date: '2023-04-04 01:00:00+00:00', end_date: '2023-04-04 02:10:00+00:00' }),
    ]);
    expect(plans[0].disposition).toBe('create_episode_checkin');
    expect(plans[0].checked_in_at).toBe('2023-04-04 02:10:00+00:00');
  });

  it('falls back to start_date when end_date is empty', () => {
    const plans = planYamtrackImport([
      row({ line: 2, media_type: 'episode', title: 'Show', media_id: '10', season_number: '1', episode_number: '2', start_date: '2023-04-04 01:50:00+00:00' }),
    ]);
    expect(plans[0].disposition).toBe('create_episode_checkin');
    expect(plans[0].checked_in_at).toBe('2023-04-04 01:50:00+00:00');
  });

  it('creates only the TV show entity when both end_date and start_date are empty', () => {
    const plans = planYamtrackImport([
      row({ line: 2, media_type: 'episode', title: 'Show', media_id: '10', season_number: '1', episode_number: '2' }),
    ]);
    expect(plans[0].disposition).toBe('create_tv_show');
    expect(plans[0].checked_in_at).toBeNull();
    expect(plans[0].external_event_id).toBeNull();
  });

  it('skips episode rows missing season/episode numbers', () => {
    const plans = planYamtrackImport([
      row({ line: 2, media_type: 'episode', title: 'Show', media_id: '10', start_date: '2023-04-04' }),
    ]);
    expect(plans[0].disposition).toBe('skipped');
  });

  it('dedupes episode rows only when media_id, season, episode, and end_date all match', () => {
    const plans = planYamtrackImport([
      row({ line: 2, media_type: 'episode', title: 'Show', media_id: '10', season_number: '1', episode_number: '1', end_date: '2023-04-04 03:00:00+00:00' }),
      row({ line: 3, media_type: 'episode', title: 'Show', media_id: '10', season_number: '1', episode_number: '1', end_date: '2023-04-04 03:00:00+00:00' }),
      row({ line: 4, media_type: 'episode', title: 'Show', media_id: '10', season_number: '1', episode_number: '1', end_date: '2023-04-04 05:00:00+00:00' }),
    ]);
    const byLine = new Map(plans.map((p) => [p.row.line, p]));
    // Same end_date -> duplicate of the first occurrence.
    expect(byLine.get(2)?.disposition).toBe('create_episode_checkin');
    expect(byLine.get(3)?.disposition).toBe('duplicate');
    expect(byLine.get(3)?.duplicate_of_line).toBe(2);
    // Different end_date -> a distinct rewatch check-in.
    expect(byLine.get(4)?.disposition).toBe('create_episode_checkin');
    expect(byLine.get(4)?.checked_in_at).toBe('2023-04-04 05:00:00+00:00');
  });

  it('treats the same episode with different start_dates but no end_date as distinct check-ins', () => {
    const plans = planYamtrackImport([
      row({ line: 2, media_type: 'episode', title: 'Show', media_id: '10', season_number: '1', episode_number: '1', start_date: '2023-04-04 01:00:00+00:00' }),
      row({ line: 3, media_type: 'episode', title: 'Show', media_id: '10', season_number: '1', episode_number: '1', start_date: '2023-04-04 03:00:00+00:00' }),
    ]);
    expect(plans.every((p) => p.disposition === 'create_episode_checkin')).toBe(true);
  });

  it('does not dedupe different episodes of the same show', () => {
    const plans = planYamtrackImport([
      row({ line: 2, media_type: 'episode', title: 'Show', media_id: '10', season_number: '1', episode_number: '1', end_date: '2023-04-04 03:00:00+00:00' }),
      row({ line: 3, media_type: 'episode', title: 'Show', media_id: '10', season_number: '1', episode_number: '2', end_date: '2023-04-04 03:00:00+00:00' }),
      row({ line: 4, media_type: 'episode', title: 'Show', media_id: '10', season_number: '2', episode_number: '1', end_date: '2023-04-04 03:00:00+00:00' }),
    ]);
    expect(plans.every((p) => p.disposition === 'create_episode_checkin')).toBe(true);
  });

  it('classifies movie/game/book with a completed status and date as check-ins', () => {
    const plans = planYamtrackImport([
      row({ line: 2, media_type: 'movie', title: 'Film', media_id: '20', status: 'Completed', start_date: '2023-01-01', score: '8' }),
      row({ line: 3, media_type: 'game', source: 'igdb', title: 'Game', media_id: '30', status: 'In progress', start_date: '2023-01-02' }),
      row({ line: 4, media_type: 'book', source: 'hardcover', title: 'Book', media_id: '40', status: 'Dropped', start_date: '2023-01-03' }),
    ]);
    expect(plans[0].disposition).toBe('create_checkin');
    expect(plans[0].checkin_type).toBe('completed');
    expect(plans[0].rating).toBe(3);
    expect(plans[0].raw_score).toBe(8);
    expect(plans[1].checkin_type).toBe('in_progress');
    expect(plans[1].external_source).toBe('tgdb');
    expect(plans[2].checkin_type).toBe('dropped');
    expect(plans[2].external_source).toBe('hardcover');
  });

  it('classifies planning/paused rows and rows without start_date as media-only', () => {
    const plans = planYamtrackImport([
      row({ line: 2, media_type: 'movie', title: 'Film', media_id: '20', status: 'Planning' }),
      row({ line: 3, media_type: 'book', source: 'hardcover', title: 'Book', media_id: '40', status: 'Paused' }),
      row({ line: 4, media_type: 'movie', title: 'NoDate', media_id: '21', status: 'Completed' }),
    ]);
    expect(plans.every((p) => p.disposition === 'create_media_item')).toBe(true);
    expect(plans.every((p) => p.checkin_type === null)).toBe(true);
  });

  it('skips unrecognized media types and missing titles', () => {
    const plans = planYamtrackImport([
      row({ line: 2, media_type: 'podcast', title: 'Pod', media_id: '50' }),
      row({ line: 3, media_type: 'movie', title: '', media_id: '51' }),
    ]);
    expect(plans.every((p) => p.disposition === 'skipped')).toBe(true);
  });
});

describe('countPlans', () => {
  it('tallies dispositions', () => {
    const plans = planYamtrackImport([
      row({ line: 2, media_type: 'tv', title: 'Show', media_id: '10' }),
      row({ line: 3, media_type: 'episode', title: 'Show', media_id: '10', season_number: '1', episode_number: '1', start_date: '2023-04-04' }),
      row({ line: 4, media_type: 'movie', title: 'Film', media_id: '20', status: 'Planning' }),
      row({ line: 5, media_type: 'podcast', title: 'Pod', media_id: '50' }),
    ]);
    const counts = countPlans(plans);
    expect(counts.total).toBe(4);
    expect(counts.create_tv_show).toBe(1);
    expect(counts.create_episode_checkin).toBe(1);
    expect(counts.create_media_item).toBe(1);
    expect(counts.skipped).toBe(1);
  });
});

describe('end-to-end parse + plan on a real-shaped CSV', () => {
  it('processes a mixed yamtrack export', () => {
    const csv = [
      CSV_HEADER,
      '"100088","tmdb","tv","The Last of Us","img","","","","Completed","","2023-04-04 01:49:00+00:00","2025-05-26 01:50:00+00:00","16","",""',
      '"100088","tmdb","episode","Pilot","img","1","1","10","Completed","","2023-04-04 01:50:00+00:00","","0","",""',
      '"100088","tmdb","episode","Pilot","img","1","1","9","Completed","","2023-04-04 01:50:00+00:00","","0","",""',
      '"550","tmdb","movie","Dune","img","","","","Completed","","2023-04-05 01:50:00+00:00","","0","",""',
      '"770","igdb","game","Hades","img","","","","In progress","","2023-04-06 01:50:00+00:00","","0","",""',
      '"880","hardcover","book","Dune Book","img","","","","Planning","","","","0","",""',
    ].join('\n');

    const plans = planYamtrackImport(parseYamtrackCsv(csv));
    const counts = countPlans(plans);
    expect(counts.total).toBe(6);
    expect(counts.create_tv_show).toBe(1);
    expect(counts.create_episode_checkin).toBe(1);
    expect(counts.duplicate).toBe(1);
    expect(counts.create_checkin).toBe(2);
    expect(counts.create_media_item).toBe(1);

    const episode = plans.find((p) => p.disposition === 'create_episode_checkin')!;
    expect(episode.rating).toBe(4);
    expect(episode.raw_score).toBe(10);
  });
});

import { describe, expect, it } from 'vitest';
import {
  isVerifiedMatch,
  pickStrictTgdbMatch,
  planGameRow,
  tgdbExternalUrl,
  type GameRowRef,
} from '../services/gamesRekey';
import type { TgdbGameResult } from '../services/tgdb';

function tgdbResult(overrides: Partial<TgdbGameResult> & { externalId: string; title: string }): TgdbGameResult {
  return {
    releaseYear: null,
    imageUrl: null,
    externalUrl: tgdbExternalUrl(overrides.externalId),
    platform: null,
    ...overrides,
  };
}

const noOwner = () => null;

function plan(
  row: GameRowRef,
  opts: {
    verifySucceeded?: boolean;
    fetched?: TgdbGameResult | null;
    resolved?: TgdbGameResult | null;
    resolveSucceeded?: boolean;
    ownerOfId?: (id: string) => string | null;
  }
) {
  return planGameRow(row, {
    verifySucceeded: opts.verifySucceeded ?? false,
    fetched: opts.fetched ?? null,
    resolved: opts.resolved ?? null,
    resolveSucceeded: opts.resolveSucceeded ?? false,
    ownerOfId: opts.ownerOfId ?? noOwner,
  });
}

describe('isVerifiedMatch', () => {
  it('accepts exact (case/punctuation-insensitive) titles', () => {
    expect(isVerifiedMatch('Assassin\u0027s Creed: Brotherhood', 'ASSASSIN\u0027S CREED BROTHERHOOD')).toBe(true);
    expect(isVerifiedMatch('Half-Life 2', 'half life 2')).toBe(true);
  });

  it('accepts edition-qualifier variants as the same game', () => {
    expect(isVerifiedMatch('Sonic the Hedgehog', 'Sonic the Hedgehog Steam Edition')).toBe(true);
  });

  it('rejects different games (sequels, subtitles)', () => {
    expect(isVerifiedMatch('Battlefield 2', 'Battlefield 2042')).toBe(false);
    expect(isVerifiedMatch('Half-Life 2', 'Half-Life 2 Episode One')).toBe(false);
    expect(isVerifiedMatch('Hades', 'Sonic the Hedgehog')).toBe(false);
  });
});

describe('pickStrictTgdbMatch', () => {
  const results = [
    tgdbResult({ externalId: '432', title: 'Sonic the Hedgehog 2' }),
    tgdbResult({ externalId: '53', title: 'Sonic the Hedgehog' }),
  ];

  it('picks the strict title match from search results', () => {
    expect(pickStrictTgdbMatch(results, 'Sonic the Hedgehog')?.externalId).toBe('53');
  });

  it('returns null for null/empty results and for non-strict titles', () => {
    expect(pickStrictTgdbMatch(null, 'Sonic the Hedgehog')).toBeNull();
    expect(pickStrictTgdbMatch([], 'Sonic the Hedgehog')).toBeNull();
    expect(pickStrictTgdbMatch(results, 'Sonic 3')).toBeNull();
  });
});

describe('planGameRow', () => {
  const stored: GameRowRef = { title: 'Hades', external_id: '99999' }; // 99999 is an IGDB-style id

  it('verifies a row whose stored id resolves to the same game', () => {
    const p = plan(stored, {
      verifySucceeded: true,
      fetched: tgdbResult({ externalId: '99999', title: 'Hades' }),
    });
    expect(p.verdict).toBe('verified');
    expect(p.targetId).toBeNull();
  });

  it('re-keys a row whose stored id resolves to a DIFFERENT game', () => {
    const p = plan(stored, {
      verifySucceeded: true,
      fetched: tgdbResult({ externalId: '99999', title: 'Some Other Game' }),
      resolveSucceeded: true,
      resolved: tgdbResult({ externalId: '5170', title: 'Hades' }),
    });
    expect(p.verdict).toBe('rekeyed');
    expect(p.targetId).toBe('5170');
    expect(p.mergeAwayRowId).toBeNull();
  });

  it('leaves a row untouched when the ByGameID lookup fails (failure is not a mismatch)', () => {
    const p = plan(stored, { verifySucceeded: false, fetched: null });
    expect(p.verdict).toBe('api-failed');
    expect(p.targetId).toBeNull();
  });

  it('marks a mismatched row unresolvable when the search finds no strict match', () => {
    const p = plan(stored, {
      verifySucceeded: true,
      fetched: tgdbResult({ externalId: '99999', title: 'Some Other Game' }),
      resolveSucceeded: true,
      resolved: null,
    });
    expect(p.verdict).toBe('unresolvable');
    expect(p.targetId).toBeNull();
  });

  it('marks a mismatched row api-failed when the re-resolve search fails', () => {
    const p = plan(stored, {
      verifySucceeded: true,
      fetched: tgdbResult({ externalId: '99999', title: 'Some Other Game' }),
      resolveSucceeded: false,
      resolved: null,
    });
    expect(p.verdict).toBe('api-failed');
    expect(p.targetId).toBeNull();
  });

  it('enriches a local-only row that resolves to a real TGDB id', () => {
    const p = plan({ title: 'Hades', external_id: null }, {
      resolveSucceeded: true,
      resolved: tgdbResult({ externalId: '5170', title: 'Hades' }),
    });
    expect(p.verdict).toBe('enriched');
    expect(p.targetId).toBe('5170');
  });

  it('plans a merge when the resolved id is already owned by another row', () => {
    const p = plan({ title: 'Hades', external_id: null }, {
      resolveSucceeded: true,
      resolved: tgdbResult({ externalId: '5170', title: 'Hades' }),
      ownerOfId: (id) => (id === '5170' ? 'row-owner-id' : null),
    });
    expect(p.verdict).toBe('merged');
    expect(p.targetId).toBe('5170');
    expect(p.mergeAwayRowId).toBe('row-owner-id');
  });

  it('marks a local-only row unresolvable when no strict match exists', () => {
    const p = plan({ title: 'My Homebrew Game', external_id: null }, { resolveSucceeded: true, resolved: null });
    expect(p.verdict).toBe('unresolvable');
  });

  it('marks a local-only row api-failed when the search fails', () => {
    const p = plan({ title: 'Hades', external_id: null }, { resolveSucceeded: false });
    expect(p.verdict).toBe('api-failed');
  });
});

describe('tgdbExternalUrl', () => {
  it('builds the canonical thegamesdb.net URL', () => {
    expect(tgdbExternalUrl('5170')).toBe('https://thegamesdb.net/game.php?id=5170');
  });
});

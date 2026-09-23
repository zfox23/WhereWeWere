// ============================================================================
// Pure decision helpers for re-keying game media_items rows against TGDB.
// Shared by the one-off backfill CLI (src/db/backfill-games-external-ids.ts).
// Kept free of DB/network imports so they can be unit-tested in isolation.
//
// Background: Yamtrack stores games keyed by IGDB id, and an older importer
// stored that id under external_source='tgdb'. TGDB ids and IGDB ids are
// unrelated, so those rows link to the wrong TGDB page. The backfill re-keys
// them by strict title matching (exact or edition qualifier only — the same
// rules as the games-CSV importer).
// ============================================================================

import { normalizeTitle, titleRelation } from './titleMatch';
import type { TgdbGameResult } from './tgdb';

export type RowVerdict =
  | 'verified'        // stored id confirmed against TGDB
  | 'rekeyed'         // stored id was wrong; re-resolved and replaced
  | 'enriched'        // had no external_id; resolved to a real TGDB id
  | 'merged'          // re-keyed onto an id another row already owns; rows merge
  | 'unresolvable'    // no strict title match found; left untouched
  | 'api-failed';     // TGDB call failed; left untouched (re-run later)

export interface GameRowRef {
  title: string;
  external_id: string | null;
}

export interface GameRowPlan {
  verdict: RowVerdict;
  reason: string;
  /** New (tgdb, externalId) pair for rekeyed/enriched/merged plans. */
  targetId: string | null;
  /** id of the other local row that must be merged away, for merged plans. */
  mergeAwayRowId: string | null;
}

/**
 * Does the title fetched by TGDB for a stored external_id confirm that the id
 * is correct? Only an exact or edition-qualifier title match counts.
 */
export function isVerifiedMatch(storedTitle: string, fetchedTitle: string): boolean {
  return titleRelation(normalizeTitle(storedTitle), normalizeTitle(fetchedTitle)) !== 'none';
}

/**
 * Pick the TGDB search result that strictly matches `storedTitle` (exact, then
 * edition qualifier). Anything else is left unmatched so a wrong external_id
 * is never stored.
 */
export function pickStrictTgdbMatch(
  results: TgdbGameResult[] | null,
  storedTitle: string
): TgdbGameResult | null {
  if (!results || results.length === 0) return null;
  const target = normalizeTitle(storedTitle);
  return results.find(
    (r) => titleRelation(target, normalizeTitle(r.title)) !== 'none'
  ) ?? null;
}

/**
 * Decide what to do with one game row given the verify/resolve results.
 *
 * `fetched` is the TGDB record for the stored id (null when the row has no id
 * or the lookup failed). `resolved` is the strict title match from a name
 * search (null when there was none or the search failed). `ownerOfId` maps a
 * TGDB id to the id of the OTHER local row that already stores it.
 *
 * Pure: returns the plan; the caller performs the (optional) writes.
 */
export function planGameRow(
  row: GameRowRef,
  opts: {
    verifySucceeded: boolean;
    fetched: TgdbGameResult | null;
    resolved: TgdbGameResult | null;
    resolveSucceeded: boolean;
    ownerOfId: (id: string) => string | null;
  }
): GameRowPlan {
  const base: GameRowPlan = {
    verdict: 'verified',
    reason: '',
    targetId: null,
    mergeAwayRowId: null,
  };

  if (row.external_id) {
    if (!opts.verifySucceeded) {
      return { ...base, verdict: 'api-failed', reason: 'TGDB ByGameID lookup failed; left untouched' };
    }
    if (opts.fetched && isVerifiedMatch(row.title, opts.fetched.title)) {
      return { ...base, verdict: 'verified', reason: 'Stored id confirmed by TGDB title' };
    }
    // Mismatch: re-resolve by title.
    if (!opts.resolveSucceeded) {
      return { ...base, verdict: 'api-failed', reason: 'Re-resolve search failed; left untouched' };
    }
    if (!opts.resolved) {
      return { ...base, verdict: 'unresolvable', reason: 'Stored id does not match title, and no strict title match found' };
    }
    const ownerId = opts.ownerOfId(opts.resolved.externalId);
    if (ownerId) {
      return {
        ...base,
        verdict: 'merged',
        reason: `Re-keyed onto TGDB id ${opts.resolved.externalId} already owned by another row`,
        targetId: opts.resolved.externalId,
        mergeAwayRowId: ownerId,
      };
    }
    return {
      ...base,
      verdict: 'rekeyed',
      reason: `Stored id ${row.external_id} was wrong; re-keyed to TGDB id ${opts.resolved.externalId}`,
      targetId: opts.resolved.externalId,
    };
  }

  // No external_id: local-only row, try to resolve.
  if (!opts.resolveSucceeded) {
    return { ...base, verdict: 'api-failed', reason: 'TGDB search failed; left local-only' };
  }
  if (!opts.resolved) {
    return { ...base, verdict: 'unresolvable', reason: 'No strict title match found; left local-only' };
  }
  const ownerId = opts.ownerOfId(opts.resolved.externalId);
  if (ownerId) {
    return {
      ...base,
      verdict: 'merged',
      reason: `Resolved to TGDB id ${opts.resolved.externalId} already owned by another row`,
      targetId: opts.resolved.externalId,
      mergeAwayRowId: ownerId,
    };
  }
  return {
    ...base,
    verdict: 'enriched',
    reason: `No external id; resolved to TGDB id ${opts.resolved.externalId}`,
    targetId: opts.resolved.externalId,
  };
}

/** Build the canonical TGDB external_url for an id. */
export function tgdbExternalUrl(externalId: string): string {
  return `https://thegamesdb.net/game.php?id=${externalId}`;
}

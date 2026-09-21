// ============================================================================
// Strict title matching shared by the games-CSV importer, the Yamtrack
// importer (local-only game dedupe), and the games external-id backfill.
//
// Only an exact normalized-title match or a whitelisted edition qualifier
// ("… Steam Edition", "… Director's Cut") denotes the SAME game. Sequel
// numbers, subtitles ("… Season 1", "… Episode One"), and mid-token overlaps
// are treated as different games — when in doubt, a new game is created.
// ============================================================================

export type TitleRelation = 'exact' | 'edition' | 'none';

/**
 * Title key used for local matching and idempotency: lowercase,
 * alphanumerics joined by single spaces (so "Assassin's Creed: Brotherhood"
 * and "Assassin's Creed Brotherhood" collide).
 */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Edition qualifiers that make a longer title refer to the SAME game. */
const EDITION_QUALIFIERS = new Set([
  'steam edition', 'gog edition', 'digital edition', 'digital deluxe edition',
  'definitive edition', 'complete edition', 'gold edition', 'platinum edition',
  'ultimate edition', 'standard edition', 'deluxe edition', 'special edition',
  'limited edition', 'anniversary edition', 'enhanced edition', 'directors cut',
  'remastered', 'remaster', 'complete collection', 'bundle',
]);

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * True when `shorterKey` occurs in `longerKey` as a whole word (the normalized
 * keys are space-delimited, so word boundaries are spaces / string ends).
 * This is what makes "battlefield 2" NOT match "battlefield 2042".
 */
function wordContains(longerKey: string, shorterKey: string): boolean {
  if (!shorterKey || longerKey === shorterKey) return false;
  const re = new RegExp(`(^| )${escapeRegExp(shorterKey)}( |$)`);
  return re.test(longerKey);
}

/** The part of `longerKey` beyond a word-prefix/word-suffix `shorterKey`, else null. */
function extensionTail(longerKey: string, shorterKey: string): string | null {
  if (longerKey.startsWith(shorterKey + ' ')) return longerKey.slice(shorterKey.length + 1);
  if (longerKey.endsWith(' ' + shorterKey)) return longerKey.slice(0, longerKey.length - shorterKey.length - 1);
  return null;
}

/**
 * Classify how a title (aKey) relates to a candidate title (bKey), both
 * already normalized. Only 'exact' and 'edition' denote the same game.
 */
export function titleRelation(aKey: string, bKey: string): TitleRelation {
  if (!aKey || !bKey) return 'none';
  if (aKey === bKey) return 'exact';

  // The longer title must be a whole-word extension of the shorter one by an
  // edition qualifier only.
  const [shorter, longer] = aKey.length <= bKey.length ? [aKey, bKey] : [bKey, aKey];
  const tail = extensionTail(longer, shorter);
  if (tail != null && wordContains(longer, shorter) && EDITION_QUALIFIERS.has(tail)) {
    return 'edition';
  }
  return 'none';
}

/** True when `a` and `b` (already normalized) refer to the same game. */
export function isSameGame(aKey: string, bKey: string): boolean {
  const rel = titleRelation(aKey, bKey);
  return rel === 'exact' || rel === 'edition';
}

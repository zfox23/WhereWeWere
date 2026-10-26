/**
 * Names and links for lists made from a period's Top songs / Top albums.
 */

const pad = (n: number) => String(n).padStart(2, '0');

const parse = (iso: string): { y: number; m: number; d: number } | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return match ? { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) } : null;
};

/**
 * "2026-01 Most Listened Albums" for one whole month, "2026-01 - 2026-03 ..."
 * for whole months, "2026-01-05 - 2026-01-11 ..." for any other range (a week),
 * and "All Time ..." when there is no range.
 */
export function topListTitle(from: string, to: string, kind: 'songs' | 'albums'): string {
  const noun = kind === 'albums' ? 'Albums' : 'Songs';
  const a = parse(from);
  const b = parse(to);
  if (!a || !b) return `All Time Most Listened ${noun}`;
  const wholeMonths = a.d === 1 && b.d === new Date(b.y, b.m, 0).getDate();
  const ym = (x: { y: number; m: number }) => `${x.y}-${pad(x.m)}`;
  if (wholeMonths) {
    return `${ym(a) === ym(b) ? ym(a) : `${ym(a)} - ${ym(b)}`} Most Listened ${noun}`;
  }
  const day = (x: { y: number; m: number; d: number }) => `${ym(x)}-${pad(x.d)}`;
  return `${from === to ? day(a) : `${day(a)} - ${day(b)}`} Most Listened ${noun}`;
}

/** Show a list on the Lists subtab, opened (the URL carries the choice, like the other subtabs). */
export function openMusicList(listId: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set('tab', 'plugin:music');
  url.searchParams.set('musicSection', 'lists');
  url.searchParams.set('musicList', listId);
  window.history.pushState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  // The tab and the lists section both re-read the URL on popstate.
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/** The page of one play. */
export const playPath = (scrobbleId: string): string => `/music/plays/${scrobbleId}`;

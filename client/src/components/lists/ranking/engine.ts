/**
 * Rank a list by answering "A or B?" questions.
 *
 * Every item gets a strength fitted to all the answers at once (a
 * Bradley-Terry model), which orders the list and decides what to ask next:
 * the pair whose order is least settled, skipping any pair the earlier
 * answers already imply (A over B and B over C settles A over C). The session
 * is done when every neighbouring pair in the current order is settled by
 * the answers, so no question is wasted and nothing rests on a guess; a
 * starting ranking only chooses which questions come first, so a list that
 * is already in order needs about one question per item. A session is just
 * the answers given plus the ranks it started from: strengths are always
 * recomputed from them, so undo is "drop the last answer" and a saved
 * session resumes exactly.
 *
 * Pure and deterministic (no randomness), so it is easy to test and to resume.
 */

export type Choice = 'a' | 'b' | 'tie';

export interface Answer {
  a: string;
  b: string;
  r: Choice;
}

export type StartMode = 'continue' | 'scratch';

/** Everything needed to rebuild a session: serializable and small. */
export interface RankSessionState {
  mode: StartMode;
  /** Item id -> rank (1..n) when the session started; null for unranked. Only used by 'continue'. */
  initialRanks: Record<string, number | null>;
  /** Item ids being ranked, in their original display order. */
  itemIds: string[];
  answers: Answer[];
}

export interface Rating {
  /** Strength on a logistic scale: P(a beats b) = 1 / (1 + e^-(a - b)). */
  mu: number;
  /** Uncertainty (standard deviation) of that strength. */
  sigma: number;
}

/** How tight the starting beliefs are: wide enough that answers can overturn them. */
const PRIOR_SD = 4;
/** Prior strength gap between neighbouring ranks of an existing ranking. */
const PRIOR_STEP = 0.3;
const FIT_ITERATIONS = 40;
/** How much to favour asking about neighbours when continuing from a ranking. */
const NEIGHBOUR_BONUS = 1;

// ---- Normal distribution --------------------------------------------------

/** Standard normal CDF (Abramowitz & Stegun 7.1.26 via erf). */
export function cdf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp((-x * x) / 2);
  return x >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

const logistic = (x: number) => 1 / (1 + Math.exp(-x));

// ---- Ratings --------------------------------------------------------------

/** Where each item is believed to stand before any answers. */
export function priorMeans(state: Pick<RankSessionState, 'mode' | 'initialRanks' | 'itemIds'>): Map<string, number> {
  const means = new Map<string, number>();
  const ranked =
    state.mode === 'continue' ? state.itemIds.filter((id) => (state.initialRanks[id] ?? null) !== null) : [];
  const m = ranked.length;
  for (const id of state.itemIds) {
    const rank = state.mode === 'continue' ? state.initialRanks[id] ?? null : null;
    means.set(id, rank === null ? 0 : ((m - 1) / 2 - (rank - 1)) * PRIOR_STEP);
  }
  return means;
}

/**
 * Fit every item's strength to all the answers at once (a Bradley-Terry model
 * with a Gaussian prior, by damped Newton steps), then read each item's
 * uncertainty off the curvature. Fitting from scratch each time keeps the
 * result independent of answer order and makes undo and resume trivial.
 */
export function replay(state: RankSessionState): Map<string, Rating> {
  const prior = priorMeans(state);
  const theta = new Map(prior);
  const games = state.answers.filter((x) => theta.has(x.a) && theta.has(x.b) && x.a !== x.b);
  const tau2 = PRIOR_SD * PRIOR_SD;
  const info = new Map<string, number>();
  for (let iter = 0; iter < FIT_ITERATIONS; iter++) {
    const grad = new Map<string, number>();
    const curv = new Map<string, number>();
    for (const id of state.itemIds) {
      grad.set(id, -((theta.get(id)! - prior.get(id)!) / tau2));
      curv.set(id, 1 / tau2);
    }
    for (const g of games) {
      const p = logistic(theta.get(g.a)! - theta.get(g.b)!);
      const score = g.r === 'a' ? 1 : g.r === 'b' ? 0 : 0.5;
      grad.set(g.a, grad.get(g.a)! + (score - p));
      grad.set(g.b, grad.get(g.b)! - (score - p));
      const w = p * (1 - p);
      curv.set(g.a, curv.get(g.a)! + w);
      curv.set(g.b, curv.get(g.b)! + w);
    }
    let moved = 0;
    for (const id of state.itemIds) {
      const step = Math.max(-2, Math.min(2, grad.get(id)! / curv.get(id)!)) * 0.9;
      theta.set(id, theta.get(id)! + step);
      moved = Math.max(moved, Math.abs(step));
      info.set(id, curv.get(id)!);
    }
    if (moved < 1e-4) break;
  }
  return new Map(state.itemIds.map((id) => [id, { mu: theta.get(id)!, sigma: Math.sqrt(1 / info.get(id)!) }]));
}

/** How sure the fit is that `hi` really stands above `lo` (used to pick the most doubtful pair). */
function confidence(hi: Rating, lo: Rating): number {
  return cdf((hi.mu - lo.mu) / Math.sqrt(hi.sigma ** 2 + lo.sigma ** 2));
}

/**
 * Which items each item is known to stand above (or level with), through
 * chains of answers. A tie links two items both ways.
 */
export function reachability(state: RankSessionState): Map<string, Set<string>> {
  const ids = new Set(state.itemIds);
  const edges = new Map<string, string[]>(state.itemIds.map((id) => [id, []]));
  for (const { a, b, r } of state.answers) {
    if (!ids.has(a) || !ids.has(b) || a === b) continue;
    if (r !== 'b') edges.get(a)!.push(b);
    if (r !== 'a') edges.get(b)!.push(a);
  }
  const reach = new Map<string, Set<string>>();
  for (const start of state.itemIds) {
    const seen = new Set<string>();
    const stack = [...edges.get(start)!];
    while (stack.length) {
      const next = stack.pop()!;
      if (seen.has(next)) continue;
      seen.add(next);
      stack.push(...edges.get(next)!);
    }
    reach.set(start, seen);
  }
  return reach;
}

// ---- Next question and progress ------------------------------------------

/**
 * Item ids best first. The answers come first (anything known to be above
 * another stays above it, through chains of answers); where they say nothing,
 * the fitted strengths decide, then the starting order.
 */
export function orderOf(
  state: RankSessionState,
  ratings = replay(state),
  reach = reachability(state),
): string[] {
  const position = new Map(state.itemIds.map((id, i) => [id, i]));
  const remaining = new Set(state.itemIds);
  const out: string[] = [];
  while (remaining.size > 0) {
    let pick: string | null = null;
    for (const id of remaining) {
      // Held back while something still unplaced is known to be strictly above it.
      let blocked = false;
      for (const other of remaining) {
        if (other !== id && reach.get(other)!.has(id) && !reach.get(id)!.has(other)) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;
      if (
        pick === null ||
        ratings.get(id)!.mu - ratings.get(pick)!.mu > 1e-9 ||
        (Math.abs(ratings.get(id)!.mu - ratings.get(pick)!.mu) <= 1e-9 &&
          (position.get(id)! < position.get(pick)! || (position.get(id) === position.get(pick) && id < pick)))
      ) {
        pick = id;
      }
    }
    // Contradictory answers can leave every item blocked; fall back to strength alone.
    pick ??= [...remaining].sort((x, y) => ratings.get(y)!.mu - ratings.get(x)!.mu)[0];
    out.push(pick);
    remaining.delete(pick);
  }
  return out;
}

export interface Progress {
  answered: number;
  /** Neighbouring pairs in the current order that no answer settles yet. */
  unsure: number;
  total: number;
  /** A rough count of questions still to go (at least `unsure`, usually a bit more). */
  remaining: number;
  /** Everything is settled (or the question budget is spent). */
  done: boolean;
}

/** A safety stop for contradictory answers: well over what a consistent session needs. */
export function questionBudget(n: number): number {
  return n < 2 ? 0 : Math.max(n - 1, Math.ceil(n * Math.log2(n) * 1.5));
}

export function progress(
  state: RankSessionState,
  ratings = replay(state),
  reach = reachability(state),
): Progress {
  const n = state.itemIds.length;
  const order = orderOf(state, ratings, reach);
  let unsure = 0;
  for (let i = 0; i + 1 < order.length; i++) {
    if (!reach.get(order[i])!.has(order[i + 1]) && !reach.get(order[i + 1])!.has(order[i])) unsure++;
  }
  const answered = state.answers.length;
  const budgetLeft = Math.max(0, questionBudget(n) - answered);
  const done = n < 2 || unsure === 0 || budgetLeft === 0;
  const remaining = done ? 0 : Math.min(budgetLeft, Math.ceil(unsure * 1.5));
  return { answered, unsure, total: answered + remaining, remaining, done };
}

/**
 * The pair whose order is least settled, among pairs the answers don't
 * already imply. Null when there is nothing worth asking.
 */
export function nextPair(state: RankSessionState, ratings = replay(state)): [string, string] | null {
  const reach = reachability(state);
  if (progress(state, ratings, reach).done) return null;
  const ids = state.itemIds;
  // Neighbours in the current order are what a finished session must settle,
  // so (when a starting ranking is trusted) they are asked about first.
  const order = orderOf(state, ratings, reach);
  const place = new Map(order.map((id, i) => [id, i]));
  const neighbourBonus = state.mode === 'continue' ? NEIGHBOUR_BONUS : 0;
  let best: [string, string] | null = null;
  let bestScore = -Infinity;
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      // Skip what the answers already imply.
      if (reach.get(ids[i])!.has(ids[j]) || reach.get(ids[j])!.has(ids[i])) continue;
      const x = ratings.get(ids[i])!;
      const y = ratings.get(ids[j])!;
      // The chance the current order of this pair is wrong, with the pair's
      // combined uncertainty breaking ties (it is what an answer would reduce).
      const hi = x.mu >= y.mu ? x : y;
      const score =
        1 - confidence(hi, hi === x ? y : x) + 0.01 * (x.sigma ** 2 + y.sigma ** 2) +
        (Math.abs(place.get(ids[i])! - place.get(ids[j])!) === 1 ? neighbourBonus : 0);
      if (score > bestScore + 1e-9) {
        bestScore = score;
        best = [ids[i], ids[j]];
      }
    }
  }
  if (!best) return null;
  // Alternate sides so "A" isn't always the same kind of item.
  return state.answers.length % 2 === 0 ? best : [best[1], best[0]];
}

export function newSession(
  items: { id: string; rank: number | null }[],
  mode: StartMode,
): RankSessionState {
  return {
    mode,
    initialRanks: Object.fromEntries(items.map((i) => [i.id, i.rank])),
    itemIds: items.map((i) => i.id),
    answers: [],
  };
}

/** Bring a saved session in line with the list as it is now (items added or removed since). */
export function reconcile(state: RankSessionState, items: { id: string; rank: number | null }[]): RankSessionState {
  const present = new Set(items.map((i) => i.id));
  const known = new Set(state.itemIds);
  return {
    ...state,
    itemIds: [...state.itemIds.filter((id) => present.has(id)), ...items.filter((i) => !known.has(i.id)).map((i) => i.id)],
    initialRanks: { ...state.initialRanks, ...Object.fromEntries(items.filter((i) => !known.has(i.id)).map((i) => [i.id, null])) },
    answers: state.answers.filter((x) => present.has(x.a) && present.has(x.b)),
  };
}

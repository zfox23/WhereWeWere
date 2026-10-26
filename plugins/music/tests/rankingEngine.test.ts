import { describe, expect, it } from 'vitest';
import {
  cdf, newSession, nextPair, orderOf, priorMeans, progress, questionBudget, reachability, reconcile, replay,
  type Answer, type RankSessionState,
} from '../ui/ranking/engine';

const ids = (n: number) => Array.from({ length: n }, (_, i) => `item${String(i).padStart(3, '0')}`);
const scratch = (list: string[]) => newSession(list.map((id) => ({ id, rank: null })), 'scratch');

/** Answer questions from a hidden "true" order until the engine says it is done. */
function run(state: RankSessionState, truth: string[], noise = 0, seed = 1) {
  const rank = new Map(truth.map((id, i) => [id, i]));
  let s = seed;
  const rand = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
  for (let guard = 0; guard < 5000; guard++) {
    const pair = nextPair(state);
    if (!pair) break;
    const [a, b] = pair;
    let aWins = rank.get(a)! < rank.get(b)!;
    if (noise && rand() < noise) aWins = !aWins;
    state = { ...state, answers: [...state.answers, { a, b, r: aWins ? 'a' : 'b' }] };
  }
  return state;
}

/** Fraction of item pairs ordered the same as the truth. */
function pairAccuracy(order: string[], truth: string[]) {
  const t = new Map(truth.map((id, i) => [id, i]));
  let agree = 0;
  let total = 0;
  for (let i = 0; i < order.length; i++) {
    for (let j = i + 1; j < order.length; j++) {
      total++;
      if (t.get(order[i])! < t.get(order[j])!) agree++;
    }
  }
  return agree / total;
}

/** A fixed pseudo-random shuffle. */
const shuffle = <T,>(list: T[]) => [...list].sort((a, b) => ((String(a).charCodeAt(6) * 7 + String(a).charCodeAt(7)) % 11) - ((String(b).charCodeAt(6) * 7 + String(b).charCodeAt(7)) % 11));

describe('cdf', () => {
  it('is the standard normal CDF', () => {
    expect(cdf(0)).toBeCloseTo(0.5, 6);
    expect(cdf(1.96)).toBeCloseTo(0.975, 3);
    expect(cdf(-1)).toBeCloseTo(0.1587, 3);
  });
});

describe('strengths', () => {
  it('a win raises the winner above the loser, and more answers shrink the uncertainty', () => {
    const base = scratch(['x', 'y', 'z']);
    const before = replay(base);
    const after = replay({ ...base, answers: [{ a: 'x', b: 'y', r: 'a' }] });
    expect(after.get('x')!.mu).toBeGreaterThan(after.get('y')!.mu);
    expect(after.get('z')!.mu).toBeCloseTo(0, 6); // not involved
    expect(after.get('x')!.sigma).toBeLessThan(before.get('x')!.sigma);
  });

  it('a tie brings two items level', () => {
    const r = replay({ ...scratch(['x', 'y']), answers: [{ a: 'x', b: 'y', r: 'tie' }] });
    expect(r.get('x')!.mu).toBeCloseTo(r.get('y')!.mu, 4);
  });

  it('ignores answers about items that are gone, and a pair with itself', () => {
    const r = replay({ ...scratch(['x', 'y']), answers: [{ a: 'x', b: 'gone', r: 'a' }, { a: 'x', b: 'x', r: 'a' }] });
    expect(r.get('x')!.mu).toBeCloseTo(0, 6);
  });

  it('is independent of the order the answers were given in', () => {
    const answers: Answer[] = [
      { a: 'a', b: 'b', r: 'a' }, { a: 'b', b: 'c', r: 'a' }, { a: 'a', b: 'c', r: 'a' }, { a: 'c', b: 'd', r: 'b' },
    ];
    const one = replay({ ...scratch(['a', 'b', 'c', 'd']), answers });
    const two = replay({ ...scratch(['a', 'b', 'c', 'd']), answers: [...answers].reverse() });
    for (const id of ['a', 'b', 'c', 'd']) expect(one.get(id)!.mu).toBeCloseTo(two.get(id)!.mu, 3);
  });

  it('priors from an existing ranking order the items; unranked ones start in the middle', () => {
    const means = priorMeans(newSession([{ id: 'a', rank: 1 }, { id: 'b', rank: 2 }, { id: 'c', rank: null }], 'continue'));
    expect(means.get('a')!).toBeGreaterThan(means.get('b')!);
    expect(means.get('c')).toBe(0);
    const fresh = priorMeans(newSession([{ id: 'a', rank: 1 }, { id: 'b', rank: 2 }], 'scratch'));
    expect(fresh.get('a')).toBe(fresh.get('b'));
  });
});

describe('what the answers settle', () => {
  it('follows chains, and a tie links both ways', () => {
    const state: RankSessionState = {
      ...scratch(['a', 'b', 'c', 'd']),
      answers: [{ a: 'a', b: 'b', r: 'a' }, { a: 'c', b: 'b', r: 'b' }, { a: 'c', b: 'd', r: 'tie' }],
    };
    const reach = reachability(state);
    expect(reach.get('a')!.has('b')).toBe(true);
    expect(reach.get('b')!.has('c')).toBe(true);
    expect(reach.get('a')!.has('c')).toBe(true); // a over b over c
    expect(reach.get('c')!.has('d') && reach.get('d')!.has('c')).toBe(true);
    expect(reach.get('c')!.has('a')).toBe(false);
  });

  it('never asks what earlier answers imply', () => {
    const state: RankSessionState = {
      ...scratch(['a', 'b', 'c']),
      answers: [{ a: 'a', b: 'b', r: 'a' }, { a: 'b', b: 'c', r: 'a' }],
    };
    expect(nextPair(state)).toBeNull(); // a>b>c settles a>c
    expect(progress(state)).toMatchObject({ done: true, unsure: 0, remaining: 0 });
  });

  it('keeps anything known to be above another above it, whatever the strengths say', () => {
    const state: RankSessionState = {
      ...newSession([{ id: 'x', rank: 1 }, { id: 'y', rank: 2 }, { id: 'z', rank: 3 }], 'continue'),
      answers: [{ a: 'z', b: 'x', r: 'a' }],
    };
    const order = orderOf(state);
    expect(order.indexOf('z')).toBeLessThan(order.indexOf('x'));
  });
});

describe('a session from scratch', () => {
  it.each([8, 20, 40])('puts %i albums in exact order using about as few questions as the information needs', (n) => {
    const truth = ids(n);
    const state = run(scratch(shuffle(truth)), truth);
    expect(progress(state).done).toBe(true);
    expect(orderOf(state)).toEqual(truth);
    // Fewer than a full sort's n·log2(n), no pair asked twice, nothing implied asked.
    expect(state.answers.length).toBeLessThan(n * Math.log2(n));
    const keys = state.answers.map((a) => [a.a, a.b].sort().join('|'));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('tolerates the occasional wrong tap, finishing with a mostly-right order', () => {
    const truth = ids(20);
    const state = run(scratch(truth), truth, 0.1, 7);
    expect(progress(state).done).toBe(true);
    expect(pairAccuracy(orderOf(state), truth)).toBeGreaterThan(0.85);
  });

  it('needs no questions for fewer than two items', () => {
    expect(nextPair(scratch(['only']))).toBeNull();
    expect(progress(scratch([])).done).toBe(true);
  });

  it('counts down: questions answered, neighbours still unsettled, a rough number left', () => {
    const truth = ids(10);
    let state = scratch(truth);
    expect(progress(state)).toMatchObject({ answered: 0, unsure: 9, done: false });
    const first = progress(state).remaining;
    expect(first).toBeGreaterThanOrEqual(9);
    const [a, b] = nextPair(state)!;
    state = { ...state, answers: [{ a, b, r: 'a' }] };
    const p = progress(state);
    expect(p.answered).toBe(1);
    expect(p.unsure).toBeLessThanOrEqual(9);
    expect(p.total).toBe(1 + p.remaining);
  });
});

describe('continuing from a ranking', () => {
  const asRanks = (order: string[]) => order.map((id, i) => ({ id, rank: i + 1 }));

  it('asks fewer questions than starting over when the existing order is right', () => {
    const truth = ids(30);
    const kept = run(newSession(asRanks(truth), 'continue'), truth);
    const fresh = run(scratch(truth), truth);
    expect(kept.answers.length).toBeLessThan(fresh.answers.length);
    expect(orderOf(kept)).toEqual(truth);
  });

  it('corrects a wrong existing order from the answers', () => {
    const truth = ids(14);
    const state = run(newSession(asRanks([...truth].reverse()), 'continue'), truth);
    expect(orderOf(state)).toEqual(truth);
  });

  it('places unranked newcomers among the ranked ones', () => {
    const truth = ids(12);
    const items = truth.map((id, i) => ({ id, rank: i === 4 || i === 8 ? null : i + 1 }));
    const state = run(newSession(items, 'continue'), truth);
    expect(orderOf(state)).toEqual(truth);
  });
});

describe('session mechanics', () => {
  it('undo is dropping the last answer: replaying gives the same strengths and the same question', () => {
    const truth = ids(8);
    let state = scratch(truth);
    for (let i = 0; i < 6; i++) {
      const [a, b] = nextPair(state)!;
      state = { ...state, answers: [...state.answers, { a, b, r: a < b ? 'a' : 'b' }] };
    }
    const undone = { ...state, answers: state.answers.slice(0, 5) };
    expect(progress(undone).answered).toBe(5);
    expect(nextPair(undone)).toEqual(nextPair({ ...undone, answers: [...undone.answers] }));
    expect([...replay(undone)]).toEqual([...replay({ ...undone })]);
  });

  it('a tie is a valid answer that settles the pair', () => {
    const state: RankSessionState = { ...scratch(['x', 'y']), answers: [{ a: 'x', b: 'y', r: 'tie' }] };
    expect(progress(state).done).toBe(true);
    expect(orderOf(state)).toHaveLength(2);
  });

  it('reconciles with a list that changed since it was saved', () => {
    const base = newSession([{ id: 'a', rank: 1 }, { id: 'b', rank: 2 }, { id: 'c', rank: 3 }], 'continue');
    const saved = { ...base, answers: [{ a: 'a', b: 'c', r: 'a' as const }, { a: 'a', b: 'b', r: 'a' as const }] };
    const now = reconcile(saved, [{ id: 'a', rank: 1 }, { id: 'c', rank: 2 }, { id: 'd', rank: null }]);
    expect(now.itemIds).toEqual(['a', 'c', 'd']);
    expect(now.answers).toEqual([{ a: 'a', b: 'c', r: 'a' }]);
    expect(now.initialRanks.d).toBeNull();
    expect(nextPair(now)).not.toBeNull();
  });

  it('stops asking once the safety budget is spent, even when answers contradict', () => {
    const truth = ids(10);
    let state = scratch(truth);
    // Answer so that nothing is ever consistent: a three-way cycle plus noise.
    for (let i = 0; i < 400; i++) {
      const pair = nextPair(state);
      if (!pair) break;
      state = { ...state, answers: [...state.answers, { a: pair[0], b: pair[1], r: i % 2 ? 'a' : 'b' }] };
    }
    expect(state.answers.length).toBeLessThanOrEqual(questionBudget(10));
    expect(progress(state).done).toBe(true);
    expect(orderOf(state)).toHaveLength(10); // still produces an order
  });

  it('keeps unanswered items in their starting order', () => {
    expect(orderOf(scratch(['x', 'y', 'z']))).toEqual(['x', 'y', 'z']);
  });
});

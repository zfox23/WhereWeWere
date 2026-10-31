/**
 * Notes plugin — similarity math over note embeddings (pure; seeded).
 *
 * Vectors are L2-normalized, so cosine similarity is a dot product.
 *   - topKNeighbors: each note's most similar notes (the Similarity Web's edges)
 *   - clusterNotes: spherical k-means, k chosen by (simplified) silhouette
 *     within a granularity band; clustering runs on mean-centered vectors
 *     (and a random projection when they are wide), then centroids are
 *     recomputed in the full space
 *   - assignThemes: a primary theme per note plus a close secondary
 *   - matchPreviousThemes: reuse a theme (and its LLM-given name) when a
 *     new cluster has mostly the same notes
 *
 * The heavy loops are async and yield to the event loop so a large library
 * never stalls the server.
 */

export type Vector = Float32Array;

/** Seeded PRNG (mulberry32): same notes + seed => same clusters. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const yieldToLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

export function dot(a: Vector, b: Vector): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

export function normalize(v: Vector): Vector {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i] * v[i];
  n = Math.sqrt(n);
  if (n > 0) for (let i = 0; i < v.length; i++) v[i] /= n;
  return v;
}

// ---------------------------------------------------------------------------
// Neighbors
// ---------------------------------------------------------------------------

export interface Neighbor {
  index: number;
  similarity: number;
}

/**
 * The `k` most similar other vectors for each vector, at or above `floor`,
 * most similar first. O(n²·d): each pair is scored once.
 */
export async function topKNeighbors(
  vectors: Vector[],
  k: number,
  floor: number,
  onProgress?: (done: number, total: number) => Promise<void> | void,
): Promise<Neighbor[][]> {
  const n = vectors.length;
  const lists: Neighbor[][] = Array.from({ length: n }, () => []);
  const offer = (list: Neighbor[], index: number, similarity: number) => {
    if (list.length === k && list[k - 1].similarity >= similarity) return;
    let pos = list.length;
    while (pos > 0 && list[pos - 1].similarity < similarity) pos--;
    list.splice(pos, 0, { index, similarity });
    if (list.length > k) list.pop();
  };
  let lastYield = Date.now();
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const s = dot(vectors[i], vectors[j]);
      if (s < floor) continue;
      offer(lists[i], j, s);
      offer(lists[j], i, s);
    }
    if (Date.now() - lastYield > 50) {
      await onProgress?.(i + 1, n);
      await yieldToLoop();
      lastYield = Date.now();
    }
  }
  await onProgress?.(n, n);
  return lists;
}

// ---------------------------------------------------------------------------
// Clustering
// ---------------------------------------------------------------------------

/** Gaussian random projection to `dims` dimensions (normalized). */
export function project(vectors: Vector[], dims: number, rand: () => number): Vector[] {
  const src = vectors[0]?.length ?? 0;
  if (src <= dims) return vectors;
  const gauss = () => {
    const u = Math.max(rand(), 1e-12);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
  };
  const matrix = Array.from({ length: dims }, () => {
    const row = new Float32Array(src);
    for (let i = 0; i < src; i++) row[i] = gauss();
    return row;
  });
  return vectors.map((v) => {
    const out = new Float32Array(dims);
    for (let d = 0; d < dims; d++) out[d] = dot(matrix[d], v);
    return normalize(out);
  });
}

/** Normalized mean of the vectors assigned to each cluster. */
export function centroidsFor(vectors: Vector[], assignments: number[], k: number): Vector[] {
  const dims = vectors[0]?.length ?? 0;
  const sums = Array.from({ length: k }, () => new Float32Array(dims));
  for (let i = 0; i < vectors.length; i++) {
    const s = sums[assignments[i]];
    const v = vectors[i];
    for (let d = 0; d < dims; d++) s[d] += v[d];
  }
  return sums.map(normalize);
}

export interface KMeansResult {
  assignments: number[];
  centroids: Vector[];
  /** Sum of (1 - cosine) to the assigned centroid; lower is tighter. */
  inertia: number;
}

/** Spherical k-means with k-means++ seeding. */
export function sphericalKMeans(vectors: Vector[], k: number, rand: () => number, maxIter = 30): KMeansResult {
  const n = vectors.length;
  // k-means++: each next seed is drawn with probability ∝ distance².
  const seeds: number[] = [Math.floor(rand() * n)];
  const minDist = new Float64Array(n).fill(Infinity);
  while (seeds.length < k) {
    const last = vectors[seeds[seeds.length - 1]];
    let total = 0;
    for (let i = 0; i < n; i++) {
      const d = Math.max(0, 1 - dot(vectors[i], last));
      if (d < minDist[i]) minDist[i] = d;
      total += minDist[i] * minDist[i];
    }
    if (total === 0) break;
    let r = rand() * total;
    let pick = n - 1;
    for (let i = 0; i < n; i++) {
      r -= minDist[i] * minDist[i];
      if (r <= 0) {
        pick = i;
        break;
      }
    }
    seeds.push(pick);
  }
  let centroids: Vector[] = seeds.map((i) => Float32Array.from(vectors[i]));
  const kk = centroids.length;
  let assignments = new Array<number>(n).fill(0);
  let inertia = 0;
  for (let iter = 0; iter < maxIter; iter++) {
    let changed = false;
    inertia = 0;
    for (let i = 0; i < n; i++) {
      let best = 0;
      let bestSim = -Infinity;
      for (let c = 0; c < kk; c++) {
        const s = dot(vectors[i], centroids[c]);
        if (s > bestSim) {
          bestSim = s;
          best = c;
        }
      }
      if (assignments[i] !== best) changed = true;
      assignments[i] = best;
      inertia += 1 - bestSim;
    }
    // Re-seed an emptied cluster with the point farthest from its centroid.
    const sizes = new Array<number>(kk).fill(0);
    for (const a of assignments) sizes[a]++;
    for (let c = 0; c < kk; c++) {
      if (sizes[c] > 0) continue;
      let far = 0;
      let farSim = Infinity;
      for (let i = 0; i < n; i++) {
        const s = dot(vectors[i], centroids[assignments[i]]);
        if (s < farSim && sizes[assignments[i]] > 1) {
          farSim = s;
          far = i;
        }
      }
      sizes[assignments[far]]--;
      assignments[far] = c;
      sizes[c] = 1;
      changed = true;
    }
    centroids = centroidsFor(vectors, assignments, kk);
    if (!changed && iter > 0) break;
  }
  assignments = [...assignments];
  return { assignments, centroids, inertia };
}

/**
 * Simplified silhouette (centroid distances instead of all pairs): mean of
 * (b - a) / max(a, b) where a is the distance to the own centroid and b to
 * the nearest other. In [-1, 1]; higher means better-separated clusters.
 */
export function simplifiedSilhouette(vectors: Vector[], result: KMeansResult): number {
  const k = result.centroids.length;
  if (k < 2 || vectors.length === 0) return -1;
  let total = 0;
  for (let i = 0; i < vectors.length; i++) {
    const own = result.assignments[i];
    const a = 1 - dot(vectors[i], result.centroids[own]);
    let b = Infinity;
    for (let c = 0; c < k; c++) {
      if (c === own) continue;
      b = Math.min(b, 1 - dot(vectors[i], result.centroids[c]));
    }
    const m = Math.max(a, b);
    total += m > 0 ? (b - a) / m : 0;
  }
  return total / vectors.length;
}

export const MAX_THEMES = 30;
export const PROJECTION_DIMS = 128;

export interface Clustering {
  k: number;
  /** Cluster per vector. */
  assignments: number[];
  /** Full-dimension centroids. */
  centroids: Vector[];
  silhouette: number;
}

/**
 * The candidate k values for `n` notes: round(√n / 2)..min(30, √n), at least 2 (floor clamped to the cap).
 * Silhouette alone favors a coarse two-way split on text embeddings, so it
 * only chooses among granularities from the floor up.
 */
export function candidateKs(n: number): number[] {
  const root = Math.sqrt(n);
  const max = Math.min(MAX_THEMES, Math.floor(root));
  if (max < 2) return [];
  const min = Math.min(max, Math.max(2, Math.round(root / 2)));
  const ks: number[] = [];
  for (let k = min; k <= max; k++) ks.push(k);
  return ks;
}

/**
 * Subtract the mean vector and re-normalize. Embeddings share a large common
 * component that squeezes every cosine into a narrow high band; removing it
 * spreads the notes out so topics can separate.
 */
export function meanCenter(vectors: Vector[]): Vector[] {
  const dims = vectors[0]?.length ?? 0;
  const mean = new Float32Array(dims);
  for (const v of vectors) for (let d = 0; d < dims; d++) mean[d] += v[d] / vectors.length;
  return vectors.map((v) => {
    const out = new Float32Array(dims);
    for (let d = 0; d < dims; d++) out[d] = v[d] - mean[d];
    return normalize(out);
  });
}

/**
 * Cluster notes into themes. Fewer than 4 notes form one theme (or none).
 * Each k runs a few seeded restarts on the centered, projected vectors; the k with the
 * best silhouette wins.
 */
export async function clusterNotes(vectors: Vector[], seed = 42, restarts = 3): Promise<Clustering | null> {
  const n = vectors.length;
  if (n < 2) return null;
  const ks = candidateKs(n);
  if (ks.length === 0) {
    const assignments = new Array<number>(n).fill(0);
    return { k: 1, assignments, centroids: centroidsFor(vectors, assignments, 1), silhouette: 0 };
  }
  const rand = seededRandom(seed);
  const projected = project(meanCenter(vectors), PROJECTION_DIMS, rand);
  let best: (KMeansResult & { k: number; silhouette: number }) | null = null;
  for (const k of ks) {
    let bestRun: KMeansResult | null = null;
    for (let r = 0; r < restarts; r++) {
      const run = sphericalKMeans(projected, k, rand);
      if (!bestRun || run.inertia < bestRun.inertia) bestRun = run;
    }
    const sil = simplifiedSilhouette(projected, bestRun!);
    if (!best || sil > best.silhouette) best = { ...bestRun!, k, silhouette: sil };
    await yieldToLoop();
  }
  // Drop clusters k-means left empty, then renumber.
  const used = [...new Set(best!.assignments)].sort((a, b) => a - b);
  const remap = new Map(used.map((c, i) => [c, i]));
  const assignments = best!.assignments.map((c) => remap.get(c)!);
  return {
    k: used.length,
    assignments,
    centroids: centroidsFor(vectors, assignments, used.length),
    silhouette: best!.silhouette,
  };
}

// ---------------------------------------------------------------------------
// Themes
// ---------------------------------------------------------------------------

export const SECONDARY_RATIO = 0.92;
export const SECONDARY_MIN = 0.35;

export interface ThemeAssignment {
  primary: { cluster: number; score: number };
  secondary: { cluster: number; score: number } | null;
}

/**
 * Each note's primary theme (its cluster) and, when another theme is nearly
 * as close, a secondary one: a note about a fight on a trip belongs to both.
 */
export function assignThemes(vectors: Vector[], clustering: Clustering): ThemeAssignment[] {
  return vectors.map((v, i) => {
    const own = clustering.assignments[i];
    const primary = { cluster: own, score: dot(v, clustering.centroids[own]) };
    let secondary: ThemeAssignment['secondary'] = null;
    for (let c = 0; c < clustering.centroids.length; c++) {
      if (c === own) continue;
      const score = dot(v, clustering.centroids[c]);
      if (score >= SECONDARY_MIN && score >= primary.score * SECONDARY_RATIO && (!secondary || score > secondary.score)) {
        secondary = { cluster: c, score };
      }
    }
    return { primary, secondary };
  });
}

/** Indices of the cluster's members nearest its centroid (for naming it). */
export function representativeMembers(vectors: Vector[], clustering: Clustering, cluster: number, count: number): number[] {
  const members: { i: number; s: number }[] = [];
  for (let i = 0; i < vectors.length; i++) {
    if (clustering.assignments[i] === cluster) members.push({ i, s: dot(vectors[i], clustering.centroids[cluster]) });
  }
  return members.sort((a, b) => b.s - a.s).slice(0, count).map((m) => m.i);
}

export const THEME_REUSE_JACCARD = 0.6;

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/**
 * For each new cluster (its member note ids), the previous theme id it
 * continues, if any: the best Jaccard match at or above the threshold, each
 * old theme claimed at most once (best matches first).
 */
export function matchPreviousThemes(
  clusters: string[][],
  previous: Map<string, Set<string>>,
  threshold = THEME_REUSE_JACCARD,
): (string | null)[] {
  const candidates: { cluster: number; theme: string; score: number }[] = [];
  clusters.forEach((members, cluster) => {
    const set = new Set(members);
    for (const [theme, old] of previous) {
      const score = jaccard(set, old);
      if (score >= threshold) candidates.push({ cluster, theme, score });
    }
  });
  candidates.sort((a, b) => b.score - a.score);
  const result: (string | null)[] = clusters.map(() => null);
  const claimed = new Set<string>();
  for (const c of candidates) {
    if (result[c.cluster] || claimed.has(c.theme)) continue;
    result[c.cluster] = c.theme;
    claimed.add(c.theme);
  }
  return result;
}

/**
 * Notes similarity math (pure): neighbors, clustering on synthetic topic
 * blobs, secondary themes, and theme reuse.
 */

import { describe, expect, it } from 'vitest';
import {
  assignThemes,
  candidateKs,
  clusterNotes,
  jaccard,
  matchPreviousThemes,
  normalize,
  seededRandom,
  topKNeighbors,
  type Vector,
} from '../services/similarity';

/** `perBlob` noisy points around each of `centers` unit directions in `dims`. */
function blobs(centers: number, perBlob: number, dims = 32, noise = 0.15, seed = 7): { vectors: Vector[]; labels: number[] } {
  const rand = seededRandom(seed);
  const vectors: Vector[] = [];
  const labels: number[] = [];
  for (let c = 0; c < centers; c++) {
    for (let i = 0; i < perBlob; i++) {
      const v = new Float32Array(dims);
      for (let d = 0; d < dims; d++) v[d] = (rand() - 0.5) * noise;
      v[c] += 1;
      vectors.push(normalize(v));
      labels.push(c);
    }
  }
  return { vectors, labels };
}

describe('topKNeighbors', () => {
  it('finds the most similar vectors above the floor, best first', async () => {
    const v = [Float32Array.of(1, 0), normalize(Float32Array.of(1, 0.1)), normalize(Float32Array.of(1, 1)), Float32Array.of(0, 1)];
    const lists = await topKNeighbors(v, 2, 0.5);
    expect(lists[0].map((n) => n.index)).toEqual([1, 2]);
    expect(lists[3].map((n) => n.index)).toEqual([2]); // (1, 0.1) is below the floor
    expect(lists[0][0].similarity).toBeGreaterThan(lists[0][1].similarity);
  });
});

describe('clusterNotes', () => {
  it('recovers well-separated topics', async () => {
    const { vectors, labels } = blobs(4, 12);
    const result = (await clusterNotes(vectors))!;
    expect(result.k).toBe(4);
    // Same blob => same cluster, different blob => different cluster.
    for (let i = 0; i < vectors.length; i++) {
      for (let j = i + 1; j < vectors.length; j++) {
        expect(result.assignments[i] === result.assignments[j]).toBe(labels[i] === labels[j]);
      }
    }
  });

  it('is deterministic for a seed', async () => {
    const { vectors } = blobs(3, 10, 200);
    const a = await clusterNotes(vectors, 1);
    const b = await clusterNotes(vectors, 1);
    expect(a!.assignments).toEqual(b!.assignments);
  });

  it('handles tiny libraries', async () => {
    expect(await clusterNotes([])).toBeNull();
    expect(await clusterNotes([Float32Array.of(1, 0)])).toBeNull();
    const three = await clusterNotes([Float32Array.of(1, 0), Float32Array.of(0, 1), Float32Array.of(1, 0)]);
    expect(three).toMatchObject({ k: 1, assignments: [0, 0, 0] });
  });

  it('bounds k between half of √n and min(√n, 30)', () => {
    expect(candidateKs(3)).toEqual([]);
    expect(candidateKs(9)).toEqual([2, 3]);
    const ks = candidateKs(1300);
    expect([ks[0], ks.at(-1)]).toEqual([18, 30]);
    expect(candidateKs(10_000).at(-1)).toBe(30);
  });

  it('splits a library with a large shared component into many themes', async () => {
    // Every note leans hard on one common direction, so raw cosines are all high.
    const { vectors } = blobs(8, 25, 64);
    const shared = vectors.map((v) => {
      const out = Float32Array.from(v);
      out[63] += 6;
      return normalize(out);
    });
    const result = (await clusterNotes(shared))!;
    expect(result.k).toBeGreaterThan(2);
  });
});

describe('assignThemes', () => {
  it('adds a secondary theme for a note between two', () => {
    const centroids = [Float32Array.of(1, 0), Float32Array.of(0, 1)];
    const between = normalize(Float32Array.of(1, 0.95));
    const clear = normalize(Float32Array.of(1, 0.1));
    const out = assignThemes([between, clear], { k: 2, assignments: [0, 0], centroids, silhouette: 0 });
    expect(out[0].secondary?.cluster).toBe(1);
    expect(out[1].secondary).toBeNull();
  });
});

describe('matchPreviousThemes', () => {
  it('reuses each old theme once, for clusters that overlap enough', () => {
    const prev = new Map([
      ['old-a', new Set(['1', '2', '3', '4'])],
      ['old-b', new Set(['7', '8'])],
    ]);
    expect(matchPreviousThemes([['1', '2', '3', '5'], ['1', '2', '3', '4'], ['9']], prev)).toEqual([null, 'old-a', null]);
    expect(jaccard(new Set(['a']), new Set(['a', 'b']))).toBe(0.5);
  });
});

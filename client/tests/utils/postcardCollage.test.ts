import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ASPECT,
  TARGET_ASPECT,
  collageHeightFactor,
  computeCollageRows,
  sanitizeAspect,
  type CollageInputImage,
} from '../../src/utils/postcardCollage';

const img = (id: string, aspect = 3 / 2): CollageInputImage => ({ id, aspect });

describe('sanitizeAspect', () => {
  it('passes through sane values', () => {
    expect(sanitizeAspect(1.5)).toBe(1.5);
    expect(sanitizeAspect(1)).toBe(1);
  });

  it('falls back to DEFAULT_ASPECT for unknown/invalid values', () => {
    expect(sanitizeAspect(undefined)).toBe(DEFAULT_ASPECT);
    expect(sanitizeAspect(null)).toBe(DEFAULT_ASPECT);
    expect(sanitizeAspect(0)).toBe(DEFAULT_ASPECT);
    expect(sanitizeAspect(-2)).toBe(DEFAULT_ASPECT);
    expect(sanitizeAspect(Infinity)).toBe(DEFAULT_ASPECT);
    expect(sanitizeAspect(NaN)).toBe(DEFAULT_ASPECT);
  });

  it('clamps extreme values', () => {
    expect(sanitizeAspect(0.05)).toBe(0.2);
    expect(sanitizeAspect(100)).toBe(5);
  });
});

describe('computeCollageRows', () => {
  it('returns [] for no images', () => {
    expect(computeCollageRows([])).toEqual([]);
  });

  it('gives a single image the full width and height', () => {
    const rows = computeCollageRows([img('a', 2 / 3)]);
    expect(rows).toHaveLength(1);
    expect(rows[0].imageIds).toEqual(['a']);
    expect(rows[0].widthPcts).toEqual([100]);
    expect(rows[0].heightPct).toBeCloseTo(100);
    // Portrait (a=2/3): row is W/(2/3) = 1.5× the card width tall.
    expect(collageHeightFactor(rows)).toBeCloseTo(1.5);
  });

  it('fills each row to exactly the card width (widths sum to 100%)', () => {
    const rows = computeCollageRows(
      Array.from({ length: 10 }, (_, i) => img(`i${i}`, 3 / 2))
    );
    for (const row of rows) {
      expect(row.widthPcts.reduce((s, p) => s + p, 0)).toBeCloseTo(100);
    }
    expect(rows.map((r) => r.heightPct).reduce((s, p) => s + p, 0)).toBeCloseTo(100);
  });

  it('packs 3 landscape (3:2) images per row at the default target', () => {
    const rows = computeCollageRows(
      Array.from({ length: 10 }, (_, i) => img(`i${i}`, 3 / 2))
    );
    // 10 landscape → rows of 3, 3, 3, 1.
    expect(rows.map((r) => r.imageIds.length)).toEqual([3, 3, 3, 1]);
    // 3 images at a=1.5: aspectSum 4.5.
    expect(rows[0].aspectSum).toBeCloseTo(4.5);
    // Equal images get equal widths.
    for (const p of rows[0].widthPcts) expect(p).toBeCloseTo(100 / 3);
    // Collage H/W: three 1/4.5 rows + one 1/1.5 row.
    expect(collageHeightFactor(rows)).toBeCloseTo(3 / 4.5 + 1 / 1.5);
  });

  it('packs 6 portrait (2:3) images per row at the default target', () => {
    const rows = computeCollageRows(
      Array.from({ length: 10 }, (_, i) => img(`i${i}`, 2 / 3))
    );
    // 6 × 0.667 = 4.0 ≤ 4.5; 7 × 0.667 = 4.67 > 4.5.
    expect(rows.map((r) => r.imageIds.length)).toEqual([6, 4]);
    // 2 rows: 1/4.0 + 1/(8/3) = 0.25 + 0.375 → H/W = 0.625.
    expect(collageHeightFactor(rows)).toBeCloseTo(0.625);
  });

  it('gives an oversized single image its own row so the layout terminates', () => {
    const rows = computeCollageRows([img('a', 5), img('b', 5), img('c', 1)]);
    expect(rows.map((r) => r.imageIds)).toEqual([['a'], ['b'], ['c']]);
  });

  it('preserves input (narrative) order across rows', () => {
    const images = Array.from({ length: 7 }, (_, i) => img(`i${i}`, i % 2 ? 2 / 3 : 3 / 2));
    const rows = computeCollageRows(images);
    const flat = rows.flatMap((r) => r.imageIds);
    expect(flat).toEqual(images.map((i) => i.id));
  });

  it('uses the default aspect for unknown dimensions', () => {
    const rows = computeCollageRows([img('a', Number.NaN), img('b', Number.NaN)]);
    expect(rows[0].aspectSum).toBeCloseTo(DEFAULT_ASPECT * 2);
  });
});

describe('collageHeightFactor', () => {
  it('is the sum of the inverse aspect sums of each row', () => {
    const rows = computeCollageRows([img('a'), img('b'), img('c')]);
    expect(collageHeightFactor(rows)).toBeCloseTo(
      rows.reduce((s, r) => s + 1 / r.aspectSum, 0)
    );
  });

  it('is 0 for no rows', () => {
    expect(collageHeightFactor([])).toBe(0);
  });
});

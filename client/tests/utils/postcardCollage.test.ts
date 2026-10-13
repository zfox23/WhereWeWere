import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ASPECT,
  MAX_ROW_HEIGHT_FRACTION,
  chooseRowCount,
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

describe('chooseRowCount', () => {
  it('returns 0 for no images', () => {
    expect(chooseRowCount(0)).toBe(0);
  });

  it('returns 1 for a handful of images', () => {
    expect(chooseRowCount(1)).toBe(1);
    expect(chooseRowCount(4)).toBe(1);
  });

  it('approximates n / 3, clamped to 1..5', () => {
    expect(chooseRowCount(5)).toBe(2);
    expect(chooseRowCount(10)).toBe(3);
    expect(chooseRowCount(12)).toBe(4);
    expect(chooseRowCount(100)).toBe(5); // clamped at MAX_ROWS
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
    // A lone portrait (1/sum = 1.5 > cap 1) is capped: image is centered.
    expect(rows[0].capped).toBe(true);
    expect(rows[0].heightFactor).toBeCloseTo(MAX_ROW_HEIGHT_FRACTION);
    expect(collageHeightFactor(rows)).toBeCloseTo(1);
  });

  it('fills each uncapped row to exactly the card width (widths sum to 100%)', () => {
    const rows = computeCollageRows(
      Array.from({ length: 10 }, (_, i) => img(`i${i}`, 3 / 2))
    );
    for (const row of rows) {
      expect(row.widthPcts.reduce((s, p) => s + p, 0)).toBeCloseTo(100);
    }
    expect(rows.map((r) => r.heightPct).reduce((s, p) => s + p, 0)).toBeCloseTo(100);
  });

  it('distributes 10 landscape images evenly across 3 rows (4, 3, 3)', () => {
    // 10 / 3 ≈ 3 rows → sizes 4, 3, 3. No lonely single-image row.
    const rows = computeCollageRows(
      Array.from({ length: 10 }, (_, i) => img(`i${i}`, 3 / 2))
    );
    expect(rows.map((r) => r.imageIds.length)).toEqual([4, 3, 3]);
  });

  it('never leaves a single image on a row when 2+ rows fit (the oversized-tail bug)', () => {
    for (let n = 5; n <= 10; n++) {
      const rows = computeCollageRows(
        Array.from({ length: n }, (_, i) => img(`i${i}`, 3 / 2))
      );
      // Only rows beyond the first may be the "short" ones, and none is 1
      // unless the whole collage is a single image.
      expect(rows.filter((r) => r.imageIds.length === 1).length).toBe(0);
    }
  });

  it('distributes 10 portrait images evenly', () => {
    const rows = computeCollageRows(
      Array.from({ length: 10 }, (_, i) => img(`i${i}`, 2 / 3))
    );
    expect(rows.map((r) => r.imageIds.length)).toEqual([4, 3, 3]);
    // Rows of sum 4·(2/3)=8/3 and 3·(2/3)=2 → H/W = 3/8 + 1/2 + 1/2 = 1.375.
    expect(collageHeightFactor(rows)).toBeCloseTo(3 / 8 + 1);
  });

  it('keeps rows bounded in height: no row taller than the cap', () => {
    // Two very portrait images (a=0.5 each) → 1 row (2/3 < 2 rows? chooseRowCount(2)=1).
    // Row sum = 1.0 → 1/sum = 1 = cap → not strictly capped, at the cap.
    const atCap = computeCollageRows([img('a', 0.5), img('b', 0.5)]);
    expect(atCap[0].heightFactor).toBeLessThanOrEqual(MAX_ROW_HEIGHT_FRACTION + 1e-9);

    // One very portrait image alone: 1/0.5 = 2 > cap → capped.
    const capped = computeCollageRows([img('a', 0.5)]);
    expect(capped[0].capped).toBe(true);
    expect(capped[0].heightFactor).toBeCloseTo(MAX_ROW_HEIGHT_FRACTION);
    expect(capped[0].widthPcts).toEqual([50]); // 0.5 × cap(1) → 50% of width, centered
  });

  it('lays very wide images side-by-side in one row so the layout terminates', () => {
    // 3 images, 3/3 → 1 row; the two ultra-wide images (a=5) dominate the
    // row's width while the square one (a=1) gets the rest. Sum = 11.
    const rows = computeCollageRows([img('a', 5), img('b', 5), img('c', 1)]);
    expect(rows).toHaveLength(1);
    expect(rows[0].imageIds).toEqual(['a', 'b', 'c']);
    expect(rows[0].widthPcts.map((p) => Math.round(p))).toEqual([45, 45, 9]);
    expect(rows[0].capped).toBe(false);
  });

  it('preserves input (narrative) order across rows', () => {
    const images = Array.from({ length: 10 }, (_, i) => img(`i${i}`, i % 2 ? 2 / 3 : 3 / 2));
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
  it('is the sum of each row\u2019s height factor', () => {
    const rows = computeCollageRows([img('a'), img('b'), img('c')]);
    expect(collageHeightFactor(rows)).toBeCloseTo(
      rows.reduce((s, r) => s + r.heightFactor, 0)
    );
  });

  it('is 0 for no rows', () => {
    expect(collageHeightFactor([])).toBe(0);
  });
});

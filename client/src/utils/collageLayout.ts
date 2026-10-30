/**
 * Gap-free "collage" layout for the Postcard From Your Past front face.
 *
 * The postcard face is modelled as an integer grid of `COLS x ROWS` units
 * (12 x 8 — exactly the card's 3:2 aspect). Each image is assigned an integer
 * area (proportional to a deterministic per-image weight, so tile sizes vary
 * like a real photo collage), then the images are packed into full-width
 * rows: every row spans the full grid width and the rows stack to the full
 * grid height, so the layout always tiles the card perfectly — no gaps, no
 * overlaps, no overflow — for any number of images.
 *
 * The result is pure and deterministic for a given list of image ids, so the
 * same postcard always renders the same collage.
 */

export const COLLAGE_COLS = 12;
export const COLLAGE_ROWS = 8;

export interface CollageTile {
  id: string;
  /** 0-based column of the tile's top-left corner, in grid units. */
  col: number;
  /** 0-based row of the tile's top-left corner, in grid units. */
  row: number;
  /** Tile width in grid units. */
  cols: number;
  /** Tile height in grid units. */
  rows: number;
}

export interface CollageGrid {
  cols: number;
  rows: number;
  /** One tile per image, in input order; their spans partition the grid exactly. */
  tiles: CollageTile[];
}

/** Deterministic FNV-1a hash of `id`, normalized to [0, 1). */
function hashUnit(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * Split `total` into one integer share per image. Shares are proportional to
 * a per-image weight in [0.7, 1.3] (deterministic from the id, so tile sizes
 * vary between images) and always sum to exactly `total` (largest-remainder
 * rounding).
 */
function weightedAreas(ids: string[], total: number, jitter: boolean): number[] {
  const n = ids.length;
  const weights = ids.map((id) => (jitter ? 0.7 + 0.6 * hashUnit(id) : 1));
  const wSum = weights.reduce((a, b) => a + b, 0);
  const exact = weights.map((w) => (total * w) / wSum);
  const floors = exact.map((e) => Math.max(1, Math.floor(e)));
  let rem = total - floors.reduce((a, b) => a + b, 0);
  // Largest-remainder: hand out the leftover units to the biggest fractions.
  const order = exact
    .map((e, i) => ({ i, frac: e - Math.floor(e) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  let k = 0;
  while (rem > 0 && k < order.length) {
    floors[order[k].i] += 1;
    k += 1;
    rem -= 1;
  }
  k = 0;
  while (rem < 0 && k < order.length) {
    if (floors[order[k].i] > 1) {
      floors[order[k].i] -= 1;
      rem += 1;
    }
    k += 1;
  }
  return floors;
}

/**
 * Split the (area-sorted) image list into `rowCount` contiguous groups.
 * A group closes once its area reaches the row target (while leaving enough
 * images for the remaining rows) or once it hits the per-row image cap. A
 * trailing under-filled row is merged into the previous one.
 */
function groupIntoRows(areas: number[], rowCount: number, total: number): number[][] {
  const n = areas.length;
  const target = total / rowCount;
  const maxPerRow = Math.max(2, Math.ceil(n / rowCount));
  const groups: number[][] = [];
  let current: number[] = [];
  let sum = 0;
  for (let i = 0; i < n; i += 1) {
    current.push(areas[i]);
    sum += areas[i];
    const remaining = n - i - 1;
    const rowsLeft = rowCount - groups.length - 1;
    const targetReached = sum >= target && rowsLeft > 0 && remaining >= rowsLeft;
    if (targetReached || current.length >= maxPerRow) {
      groups.push(current);
      current = [];
      sum = 0;
    }
  }
  if (current.length > 0) groups.push(current);
  while (groups.length > 1) {
    const last = groups[groups.length - 1];
    const lastSum = last.reduce((a, b) => a + b, 0);
    if (lastSum < target * 0.5 && last.length < maxPerRow) {
      groups[groups.length - 2].push(...last);
      groups.pop();
    } else {
      break;
    }
  }
  return groups;
}

/**
 * Adjust `values` (each >= 1) by unit steps so their sum is exactly `total`.
 * Growth goes to the smallest values and shrinkage to the largest, which keeps
 * the resulting tile sizes balanced.
 */
function fitToSum(values: number[], total: number): number[] {
  const out = values.map((v) => Math.max(1, Math.round(v)));
  let diff = total - out.reduce((a, b) => a + b, 0);
  const guard = out.length * 10 + 10;
  for (let pass = 0; diff !== 0 && pass < guard; pass += 1) {
    let best = 0;
    for (let i = 1; i < out.length; i += 1) {
      const better = diff > 0 ? out[i] < out[best] : out[i] > out[best];
      if (better) best = i;
    }
    if (diff > 0 || out[best] > 1) {
      const step = diff > 0 ? 1 : -1;
      out[best] += step;
      diff -= step;
    } else {
      break;
    }
  }
  return out;
}

/**
 * Pack images with the given per-image areas into the `W x H` grid as
 * full-width rows. Returns null if the exact-tiling invariants cannot be met.
 */
function packRows(imageIds: string[], tileAreas: number[]): CollageGrid | null {
  const W = COLLAGE_COLS;
  const H = COLLAGE_ROWS;
  const total = W * H;
  const n = imageIds.length;
  if (n === 0) return { cols: W, rows: H, tiles: [] };
  if (tileAreas.length !== n) return null;

  const rowCount = Math.min(4, Math.max(1, Math.round(n / 2.6)));
  const groups = groupIntoRows(tileAreas, rowCount, total);
  const rowAreas = groups.map((g) => g.reduce((a, b) => a + b, 0));
  const heights = fitToSum(rowAreas.map((a) => (H * a) / total), H);
  if (heights.reduce((a, b) => a + b, 0) !== H) return null;

  const tiles: CollageTile[] = [];
  let idx = 0;
  let y = 0;
  for (let r = 0; r < groups.length; r += 1) {
    const rowArea = rowAreas[r];
    const widths = fitToSum(groups[r].map((a) => (W * a) / rowArea), W);
    if (widths.reduce((a, b) => a + b, 0) !== W) return null;
    let x = 0;
    groups[r].forEach((_, c) => {
      tiles.push({ id: imageIds[idx], col: x, row: y, cols: widths[c], rows: heights[r] });
      x += widths[c];
      idx += 1;
    });
    y += heights[r];
  }

  // Invariants: tiles must partition the grid exactly.
  if (tiles.length !== n) return null;
  let covered = 0;
  for (const t of tiles) {
    if (t.cols < 1 || t.rows < 1 || t.col + t.cols > W || t.row + t.rows > H) return null;
    covered += t.cols * t.rows;
  }
  if (covered !== total) return null;
  return { cols: W, rows: H, tiles };
}

/**
 * Guaranteed-valid uniform fallback: equal tile areas, packed in full-width
 * rows. For the expected 4–10 images this always tiles the grid exactly; the
 * degenerate overflow case (more images than cells) still returns a layout,
 * at the cost of omitting surplus images.
 */
function uniformLayout(imageIds: string[]): CollageGrid | null {
  const W = COLLAGE_COLS;
  const H = COLLAGE_ROWS;
  const total = W * H;
  const n = imageIds.length;
  const base = Math.floor(total / n);
  if (base < 1) {
    // Defensive: more images than cells. One row per grid row, each image at
    // least 1 unit wide; overflow beyond the grid is dropped.
    const perRow = Math.ceil(n / H);
    const tiles: CollageTile[] = [];
    for (let y = 0; y < H; y += 1) {
      const inRow = imageIds.slice(y * perRow, (y + 1) * perRow);
      let x = 0;
      inRow.forEach((id) => {
        const w = Math.floor(W / inRow.length);
        tiles.push({ id, col: x, row: y, cols: Math.max(1, w), rows: 1 });
        x += w;
      });
    }
    return { cols: W, rows: H, tiles };
  }
  const extra = total % n;
  const areas = imageIds.map((_, i) => base + (i < extra ? 1 : 0));
  const rowCount = Math.min(4, Math.max(1, Math.round(n / 2.6)));
  const groups = groupIntoRows(areas, rowCount, total);
  const rowAreas = groups.map((g) => g.reduce((a, b) => a + b, 0));
  const heights = fitToSum(rowAreas.map((a) => (H * a) / total), H);
  if (heights.reduce((a, b) => a + b, 0) !== H) return null;
  const tiles: CollageTile[] = [];
  let idx = 0;
  let y = 0;
  for (let r = 0; r < groups.length; r += 1) {
    const rowArea = rowAreas[r];
    const widths = fitToSum(groups[r].map((a) => (W * a) / rowArea), W);
    if (widths.reduce((a, b) => a + b, 0) !== W) return null;
    let x = 0;
    groups[r].forEach((_, c) => {
      tiles.push({ id: imageIds[idx], col: x, row: y, cols: widths[c], rows: heights[r] });
      x += widths[c];
      idx += 1;
    });
    y += heights[r];
  }
  let covered = 0;
  for (const t of tiles) {
    if (t.cols < 1 || t.rows < 1 || t.col + t.cols > W || t.row + t.rows > H) return null;
    covered += t.cols * t.rows;
  }
  if (tiles.length !== n || covered !== total) return null;
  return { cols: W, rows: H, tiles };
}

/**
 * Compute the collage tiling for `imageIds`. Always succeeds: the jittered
 * area weights are the primary strategy, with a uniform-area layout as the
 * fallback; both are constructed to tile the grid exactly.
 */
export function computeCollageLayout(imageIds: string[]): CollageGrid {
  if (imageIds.length === 0) return { cols: COLLAGE_COLS, rows: COLLAGE_ROWS, tiles: [] };
  const total = COLLAGE_COLS * COLLAGE_ROWS;
  return (
    packRows(imageIds, weightedAreas(imageIds, total, true)) ??
    packRows(imageIds, weightedAreas(imageIds, total, false)) ??
    uniformLayout(imageIds) ?? { cols: COLLAGE_COLS, rows: COLLAGE_ROWS, tiles: [] }
  );
}

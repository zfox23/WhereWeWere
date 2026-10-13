/**
 * Pure layout math for the postcard front collage ("mosaic stripes").
 *
 * The collage is a set of horizontal rows. Within a row, images share one
 * height and get widths proportional to their aspect ratios, so the row
 * fills the card width exactly — no gaps, no distortion, no cropping:
 *
 *   row: images with aspect a_i = width_i / height_i
 *   image width w_i = W · a_i / Σ a_i   (widths sum to exactly W)
 *   row height  h  = W / Σ a_i          (row is 1/Σ a_i of the card wide-tall)
 *
 * Rows are formed greedily in narrative order: an image is added to the
 * current row while the running aspect sum stays at or below TARGET_ASPECT;
 * otherwise a new row starts.
 *
 * The layout is expressed entirely in percentages and one container
 * aspect ratio (height / width), so it is resolution-independent — the
 * postcard front just gets `aspect-ratio: 1 / S` and grows taller as the
 * images demand.
 */

export interface CollageInputImage {
  id: string;
  /** width / height. Falls back to DEFAULT_ASPECT when unknown. */
  aspect: number;
}

export interface CollageRow {
  imageIds: string[];
  /** Each image's share of the row width, as a percentage (sums to 100). */
  widthPcts: number[];
  /** Row height as a percentage of the total collage height (sums to 100). */
  heightPct: number;
  /** Σ a_i of the row's images. */
  aspectSum: number;
}

/** Aspect ratio assumed until a real one is known (EXIF or onLoad). */
export const DEFAULT_ASPECT = 4 / 3;

/**
 * Target total aspect per row. 4.5 means 3 landscape (3:2) images or 6
 * portrait (2:3) images fit on a row, which keeps rows visually balanced.
 */
export const TARGET_ASPECT = 4.5;

/** Clamp an unknown/invalid aspect to something sane (0.2 .. 5). */
export function sanitizeAspect(aspect: number | undefined | null): number {
  return typeof aspect === 'number' && Number.isFinite(aspect) && aspect > 0
    ? Math.min(Math.max(aspect, 0.2), 5)
    : DEFAULT_ASPECT;
}

/**
 * Lay out images into rows. Returns [] for no images. The returned rows
 * tile a box whose height-to-width ratio is `collageHeightFactor(rows)`.
 */
export function computeCollageRows(
  images: CollageInputImage[],
  targetAspect: number = TARGET_ASPECT
): CollageRow[] {
  if (images.length === 0) return [];

  // Greedy packing: start a new row when the next image would push the
  // row's aspect sum past the target (an oversized single image still gets
  // its own row, so the layout always terminates).
  const packed: { img: CollageInputImage; a: number; sum: number }[][] = [];
  let current: { img: CollageInputImage; a: number; sum: number }[] = [];
  let currentSum = 0;

  const flush = () => {
    if (current.length > 0) {
      packed.push(current);
      current = [];
      currentSum = 0;
    }
  };

  for (const img of images) {
    const a = sanitizeAspect(img.aspect);
    if (current.length > 0 && currentSum + a > targetAspect) flush();
    current.push({ img, a, sum: currentSum + a });
    currentSum += a;
  }
  flush();

  // Collage height (in units of card width) = Σ (1 / aspectSum_row).
  const totalInvAspect = packed.reduce((s, row) => s + 1 / row[row.length - 1].sum, 0);

  return packed.map((row) => {
    const aspectSum = row[row.length - 1].sum;
    return {
      imageIds: row.map((r) => r.img.id),
      widthPcts: row.map((r) => (r.a / aspectSum) * 100),
      heightPct: (1 / aspectSum) / totalInvAspect * 100,
      aspectSum,
    };
  });
}

/**
 * Total collage height relative to card width (H / W) for a set of rows.
 * The collage container should use `aspect-ratio: 1 / factor`.
 */
export function collageHeightFactor(rows: CollageRow[]): number {
  return rows.reduce((s, row) => s + 1 / row.aspectSum, 0);
}

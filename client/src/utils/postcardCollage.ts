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
 * Row structure: the number of rows is chosen first (≈ n /
 * TARGET_IMAGES_PER_ROW, clamped to 1..MAX_ROWS) and the images are
 * distributed **evenly by count** across those rows in narrative order.
 * That way no row is a lonely single image (except when the postcard has
 * just one image), so rows stay visually balanced instead of one image
 * spanning the full card width and becoming huge.
 *
 * Safety net: a row taller than MAX_ROW_HEIGHT_FRACTION of the card width
 * (possible with 1–2 very portrait images) is height-capped: its images
 * are laid out uncropped at the capped height and centered, with side
 * margins on the paper background.
 *
 * The layout is expressed entirely in percentages and one container aspect
 * ratio (height / width), so it is resolution-independent — the postcard
 * front just gets `aspect-ratio: 1 / S` and grows taller as the images
 * demand.
 */

export interface CollageInputImage {
  id: string;
  /** width / height. Falls back to DEFAULT_ASPECT when unknown. */
  aspect: number;
}

export interface CollageRow {
  imageIds: string[];
  /**
   * Each image's share of the card width, as a percentage. Sums to 100 for
   * uncapped rows; less than 100 for capped rows (centered, with margins).
   */
  widthPcts: number[];
  /** Row height as a percentage of the total collage height (sums to 100). */
  heightPct: number;
  /** Row height as a fraction of the card width (clamped to the cap). */
  heightFactor: number;
  /** Σ a_i of the row's images. */
  aspectSum: number;
  /** True when the row was height-capped; images are centered. */
  capped: boolean;
}

/** Aspect ratio assumed until a real one is known (EXIF or onLoad). */
export const DEFAULT_ASPECT = 4 / 3;

/** Target images per row when choosing how many rows the collage gets. */
export const TARGET_IMAGES_PER_ROW = 3;

/** Never use more rows than this (keeps the card from getting very tall). */
export const MAX_ROWS = 5;

/**
 * Maximum row height as a fraction of the card width. A row that would be
 * taller than this (e.g. a single very portrait photo) is capped and its
 * images are centered within the capped band.
 */
export const MAX_ROW_HEIGHT_FRACTION = 1;

/** Clamp an unknown/invalid aspect to something sane (0.2 .. 5). */
export function sanitizeAspect(aspect: number | undefined | null): number {
  return typeof aspect === 'number' && Number.isFinite(aspect) && aspect > 0
    ? Math.min(Math.max(aspect, 0.2), 5)
    : DEFAULT_ASPECT;
}

/** How many rows a collage of `n` images should have (0 for none). */
export function chooseRowCount(n: number, targetImagesPerRow: number = TARGET_IMAGES_PER_ROW): number {
  if (n <= 0) return 0;
  return Math.min(MAX_ROWS, Math.max(1, Math.round(n / targetImagesPerRow)));
}

/**
 * Lay out images into evenly-populated rows. Returns [] for no images.
 * The returned rows tile a box whose height-to-width ratio is
 * `collageHeightFactor(rows)`.
 */
export function computeCollageRows(
  images: CollageInputImage[],
  targetImagesPerRow: number = TARGET_IMAGES_PER_ROW
): CollageRow[] {
  if (images.length === 0) return [];

  const rowCount = chooseRowCount(images.length, targetImagesPerRow);

  // Even distribution: the first (n % rowCount) rows get one extra image.
  const base = Math.floor(images.length / rowCount);
  const remainder = images.length % rowCount;
  const rows: CollageInputImage[][] = [];
  let start = 0;
  for (let r = 0; r < rowCount; r++) {
    const size = base + (r < remainder ? 1 : 0);
    if (size > 0) rows.push(images.slice(start, start + size));
    start += size;
  }

  const aspects = rows.map((row) => row.map((i) => sanitizeAspect(i.aspect)));
  const sums = aspects.map((a) => a.reduce((s, x) => s + x, 0));
  const factors = sums.map((s) => Math.min(1 / s, MAX_ROW_HEIGHT_FRACTION));
  const total = factors.reduce((s, x) => s + x, 0);

  return rows.map((row, r) => {
    const sum = sums[r];
    const factor = factors[r];
    const capped = 1 / sum > MAX_ROW_HEIGHT_FRACTION;
    return {
      imageIds: row.map((i) => i.id),
      widthPcts: aspects[r].map((a) => (capped ? a * factor : a / sum) * 100),
      heightPct: (factor / total) * 100,
      heightFactor: factor,
      aspectSum: sum,
      capped,
    };
  });
}

/**
 * Total collage height relative to card width (H / W) for a set of rows.
 * The collage container should use `aspect-ratio: 1 / factor`.
 */
export function collageHeightFactor(rows: CollageRow[]): number {
  return rows.reduce((s, r) => s + r.heightFactor, 0);
}

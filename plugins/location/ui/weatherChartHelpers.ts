/**
 * Pure helpers for the weather modal's hourly chart. Times are Open-Meteo
 * local ISO strings (no offset), so they are parsed textually and never
 * through `Date`, which would shift them into the browser's zone.
 */

/** Hours since local midnight (e.g. 6.7 for 06:42) from an ISO time. */
export function localHours(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const m = /T(\d{2}):(\d{2})/.exec(iso);
  if (!m) return null;
  return Number(m[1]) + Number(m[2]) / 60;
}

/** Compact hour tick label: 12 AM, 3 AM, ... 9 PM. */
export function hourLabel(hour: number): string {
  const h = ((Math.round(hour) % 24) + 24) % 24;
  return `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`;
}

function niceStep(rough: number): number {
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const frac = rough / pow;
  if (frac <= 1) return pow;
  if (frac <= 2) return 2 * pow;
  if (frac <= 5) return 5 * pow;
  return 10 * pow;
}

/** A domain widened to whole multiples of a nice step, with its ticks. */
export function niceScale(min: number, max: number, count = 4): { min: number; max: number; ticks: number[] } {
  if (!(max > min)) {
    min -= 1;
    max += 1;
  }
  const step = niceStep((max - min) / count);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 1e6; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return { min: lo, max: hi, ticks };
}

/**
 * SVG path through the points as a monotone cubic (Fritsch–Carlson), which
 * stays smooth without overshooting past the actual highs and lows. `null`
 * points break the line. Points must be sorted by their first coordinate;
 * `swap` emits (y, x) pairs so the same curve can run vertically.
 */
export function monotonePath(points: ([number, number] | null)[], swap = false): string {
  const segments: [number, number][][] = [];
  let cur: [number, number][] = [];
  for (const p of points) {
    if (p) cur.push(p);
    else if (cur.length) { segments.push(cur); cur = []; }
  }
  if (cur.length) segments.push(cur);

  const fmt = (x: number, y: number) => (swap ? `${y.toFixed(1)},${x.toFixed(1)}` : `${x.toFixed(1)},${y.toFixed(1)}`);
  let d = '';
  for (const seg of segments) {
    const n = seg.length;
    d += `M${fmt(seg[0][0], seg[0][1])}`;
    if (n === 1) continue;
    const dx: number[] = [];
    const slope: number[] = [];
    for (let i = 0; i < n - 1; i++) {
      dx[i] = seg[i + 1][0] - seg[i][0];
      slope[i] = dx[i] === 0 ? 0 : (seg[i + 1][1] - seg[i][1]) / dx[i];
    }
    const tangent: number[] = [slope[0]];
    for (let i = 1; i < n - 1; i++) {
      tangent[i] = slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2;
    }
    tangent[n - 1] = slope[n - 2];
    for (let i = 0; i < n - 1; i++) {
      if (slope[i] === 0) { tangent[i] = 0; tangent[i + 1] = 0; continue; }
      const a = tangent[i] / slope[i];
      const b = tangent[i + 1] / slope[i];
      const s = a * a + b * b;
      if (s > 9) {
        const t = 3 / Math.sqrt(s);
        tangent[i] = t * a * slope[i];
        tangent[i + 1] = t * b * slope[i];
      }
    }
    for (let i = 0; i < n - 1; i++) {
      const [x0, y0] = seg[i];
      const [x1, y1] = seg[i + 1];
      const h = dx[i] / 3;
      d += `C${fmt(x0 + h, y0 + tangent[i] * h)} ${fmt(x1 - h, y1 - tangent[i + 1] * h)} ${fmt(x1, y1)}`;
    }
  }
  return d;
}

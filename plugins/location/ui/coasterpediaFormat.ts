import type { DistanceUnit } from './geo';

export interface Measurement {
  value: number;
  unit: string;
  entered?: { value: number; unit: string };
}

const round = (n: number, digits = 1) => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

/** Coasterpedia values are metric; convert for the user's distance_unit setting. */
export function formatMeasurement(m: Measurement | null | undefined, unit: DistanceUnit): string | null {
  if (!m || typeof m.value !== 'number') return null;
  if (unit === 'imperial') {
    switch (m.unit) {
      case 'm': return `${round(m.value * 3.28084, 0)} ft`;
      case 'cm': return `${round(m.value / 2.54, 0)} in`;
      case 'km': return `${round(m.value * 0.621371)} mi`;
      case 'km/h': return `${round(m.value * 0.621371, 0)} mph`;
      case 'kg': return `${round(m.value * 2.20462, 0)} lb`;
    }
  }
  return `${round(m.value)} ${m.unit}`;
}

/** The editor's original figure, e.g. "740 ft", for a tooltip. */
export function enteredMeasurement(m: Measurement | null | undefined): string | undefined {
  return m?.entered ? `${m.entered.value} ${m.entered.unit} as entered on Coasterpedia` : undefined;
}

/** "under_construction" -> "Under construction". */
export function humanize(value: string | null | undefined): string | null {
  if (!value) return null;
  const s = value.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Show an EDTF date as written, tidying the common uncertain forms. */
export function formatEdtf(edtf: string | null | undefined): string | null {
  if (!edtf) return null;
  if (/^\[\.\.(.+)\]$/.test(edtf)) return `${edtf.slice(3, -1)} or earlier`;
  if (/^\[(.+)\.\.\]$/.test(edtf)) return `${edtf.slice(1, -3)} or later`;
  return edtf.replace(/[?~]$/, '').replace(/X/g, '?');
}

export function youtubeUrl(id: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
}

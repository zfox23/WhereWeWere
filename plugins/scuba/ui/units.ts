/**
 * SCUBA units helpers.
 *
 * Dive data is stored in metric units (meters, °C, bar, kg — the Diving Log
 * convention). These helpers convert between the stored metric values and the
 * user's distance_unit preference ('metric' | 'imperial') for display and
 * form entry, plus a `useScubaUnits` hook that loads the preference.
 */

import { useEffect, useState } from 'react';
import { settings } from '../../../client/src/api/client';

export type DistanceUnit = 'metric' | 'imperial';

const M_TO_FT = 3.280839895;
const KG_TO_LB = 2.2046226218;
const BAR_TO_PSI = 14.503773773;

// ---------------------------------------------------------------------------
// Conversions (null/undefined pass through as undefined)
// ---------------------------------------------------------------------------

function round(v: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}

function convert(
  value: number | null | undefined,
  to: (v: number) => number,
  decimals: number,
): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? round(to(value), decimals) : undefined;
}

/** Meters → display depth (m or ft) for form entry. */
export function depthToDisplay(m: number | null | undefined, unit: DistanceUnit): number | undefined {
  return unit === 'imperial' ? convert(m, (v) => v * M_TO_FT, 0) : convert(m, (v) => v, 1);
}

/** Display depth (m or ft) → stored meters. */
export function depthToStored(v: number | null | undefined, unit: DistanceUnit): number | undefined {
  return unit === 'imperial' ? convert(v, (x) => x / M_TO_FT, 2) : convert(v, (x) => x, 2);
}

/** °C → display temperature (°C or °F) for form entry. */
export function tempToDisplay(c: number | null | undefined, unit: DistanceUnit): number | undefined {
  return unit === 'imperial'
    ? convert(c, (v) => (v * 9) / 5 + 32, 1)
    : convert(c, (v) => v, 1);
}

/** Display temperature (°C or °F) → stored °C. */
export function tempToStored(v: number | null | undefined, unit: DistanceUnit): number | undefined {
  return unit === 'imperial'
    ? convert(v, (x) => ((x - 32) * 5) / 9, 2)
    : convert(v, (x) => x, 2);
}

/** bar → display pressure (bar or psi) for form entry. */
export function pressureToDisplay(bar: number | null | undefined, unit: DistanceUnit): number | undefined {
  return unit === 'imperial' ? convert(bar, (v) => v * BAR_TO_PSI, 0) : convert(bar, (v) => v, 1);
}

/** Display pressure (bar or psi) → stored bar. */
export function pressureToStored(v: number | null | undefined, unit: DistanceUnit): number | undefined {
  return unit === 'imperial' ? convert(v, (x) => x / BAR_TO_PSI, 2) : convert(v, (x) => x, 2);
}

/** kg → display weight (kg or lb) for form entry. */
export function weightToDisplay(kg: number | null | undefined, unit: DistanceUnit): number | undefined {
  return unit === 'imperial' ? convert(kg, (v) => v * KG_TO_LB, 1) : convert(kg, (v) => v, 1);
}

/** Display weight (kg or lb) → stored kg. */
export function weightToStored(v: number | null | undefined, unit: DistanceUnit): number | undefined {
  return unit === 'imperial' ? convert(v, (x) => x / KG_TO_LB, 2) : convert(v, (x) => x, 2);
}

// ---------------------------------------------------------------------------
// Display formatters (read-only views: detail page, cards, stats)
// ---------------------------------------------------------------------------

export function formatDepth(m: number | null | undefined, unit: DistanceUnit): string | null {
  if (typeof m !== 'number' || !Number.isFinite(m)) return null;
  return unit === 'imperial' ? `${Math.round(m * M_TO_FT)} ft` : `${round(m, 1)} m`;
}

export function formatTemp(c: number | null | undefined, unit: DistanceUnit): string | null {
  if (typeof c !== 'number' || !Number.isFinite(c)) return null;
  return unit === 'imperial' ? `${Math.round((c * 9) / 5 + 32)} °F` : `${round(c, 1)} °C`;
}

export function formatPressure(bar: number | null | undefined, unit: DistanceUnit): string | null {
  if (typeof bar !== 'number' || !Number.isFinite(bar)) return null;
  return unit === 'imperial' ? `${Math.round(bar * BAR_TO_PSI)} psi` : `${round(bar, 1)} bar`;
}

export function formatWeight(kg: number | null | undefined, unit: DistanceUnit): string | null {
  if (typeof kg !== 'number' || !Number.isFinite(kg)) return null;
  return unit === 'imperial' ? `${round(kg * KG_TO_LB, 1)} lb` : `${round(kg, 1)} kg`;
}

// ---------------------------------------------------------------------------
// Preference hook
// ---------------------------------------------------------------------------

let cached: Promise<DistanceUnit> | null = null;

function loadDistanceUnit(): Promise<DistanceUnit> {
  if (!cached) {
    cached = settings
      .get()
      .then((s) => (s?.distance_unit === 'imperial' ? 'imperial' : 'metric'))
      .catch(() => 'metric');
  }
  return cached;
}

/** The user's imperial/metric preference (defaults to metric while loading). */
export function useScubaUnits(): DistanceUnit {
  const [unit, setUnit] = useState<DistanceUnit>('metric');
  useEffect(() => {
    let active = true;
    loadDistanceUnit().then((u) => {
      if (active) setUnit(u);
    });
    return () => {
      active = false;
    };
  }, []);
  return unit;
}

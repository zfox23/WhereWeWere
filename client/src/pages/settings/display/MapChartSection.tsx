import type { CSSProperties } from 'react';
import { Map as MapIcon } from 'lucide-react';
import { useTheme } from '../../../contexts/ThemeContext';
import { getThemeDefinition } from '../../../themes';
import {
  CHART_PALETTE_OPTIONS,
  MAP_STYLE_OPTIONS,
  chartColors,
  labelFor,
} from '../../../appearance';
import { DisplaySection } from './DisplaySection';
import { OptionPicker } from './OptionPicker';

// A stylized street-map swatch; each map style applies its own look to it.
const STREETS_SVG = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 40'%3E%3Crect width='120' height='40' fill='%23f2efe9'/%3E%3Cpath d='M70 0h50v22c-20 4-35-6-50 4z' fill='%23aad3df'/%3E%3Crect x='6' y='6' width='22' height='12' fill='%23cdebb0'/%3E%3Cg fill='none' stroke-linecap='round'%3E%3Cpath d='M0 28C40 24 70 34 120 26' stroke='%23f7c873' stroke-width='4'/%3E%3Cpath d='M38 0L44 40M88 30L94 40M0 12L60 10' stroke='%23fff' stroke-width='2.5'/%3E%3C/g%3E%3C/svg%3E\")";

const MAP_PREVIEW: Record<string, CSSProperties> = {
  standard: {},
  tinted: { filter: 'grayscale(1) sepia(0.55) hue-rotate(var(--app-map-hue, 0deg)) saturate(1.5)' },
  vintage: { filter: 'sepia(0.6) saturate(0.85) contrast(0.92)' },
  muted: { filter: 'grayscale(0.85) brightness(1.05) contrast(0.85)' },
  satellite: {
    backgroundImage: 'radial-gradient(circle at 30% 40%, #5b7b3a, transparent 40%), radial-gradient(circle at 75% 60%, #2f5f78, transparent 45%), linear-gradient(135deg, #4a5d32, #6b6a4b 50%, #3d4e5c)',
  },
};

export function MapChartSection() {
  const { appearance, setAppearance, resolvedThemeId } = useTheme();
  const theme = getThemeDefinition(resolvedThemeId);
  const provider = MAP_STYLE_OPTIONS.find((o) => o.id === appearance.mapStyle)?.provider;

  return (
    <DisplaySection
      id="maps-charts"
      title="Maps & Charts"
      icon={MapIcon}
      summary={`${labelFor(MAP_STYLE_OPTIONS, appearance.mapStyle)} · ${labelFor(CHART_PALETTE_OPTIONS, appearance.chartPalette)}`}
      defaultOpen={false}
    >
      <OptionPicker
        label="Map style"
        hint={provider
          ? `Map tiles for this style come from ${provider} instead of OpenStreetMap.`
          : 'Applies to every map: Places, venues and tracks.'}
        options={MAP_STYLE_OPTIONS}
        value={appearance.mapStyle}
        onChange={(mapStyle) => setAppearance({ mapStyle })}
        columns={3}
        renderPreview={(option) => (
          <div
            className="h-10 w-full rounded-md bg-cover bg-center"
            style={{ backgroundImage: STREETS_SVG, ...MAP_PREVIEW[option.id] }}
            aria-hidden="true"
          />
        )}
      />

      <OptionPicker
        label="Chart palette"
        hint="Weather, track graphs, track lines and time-of-day bars."
        options={CHART_PALETTE_OPTIONS}
        value={appearance.chartPalette}
        onChange={(chartPalette) => setAppearance({ chartPalette })}
        columns={3}
        renderPreview={(option) => (
          <div className="flex h-6 w-full items-end gap-0.5" aria-hidden="true">
            {chartColors(option.id, theme).slice(0, 6).map((color, i) => (
              <span
                key={i}
                className="flex-1 rounded-sm"
                style={{ backgroundColor: color, height: `${[60, 90, 45, 75, 100, 55][i]}%` }}
              />
            ))}
          </div>
        )}
      />
    </DisplaySection>
  );
}

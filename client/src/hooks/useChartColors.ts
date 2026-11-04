import { useMemo } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { getThemeDefinition } from '../themes';
import { chartColors } from '../appearance';

/**
 * Series colors for charts and map lines from the Chart palette setting
 * (Settings > Display), resolved to hex so they work in SVG attributes and
 * Leaflet styles. See chartColors for what each slot means.
 */
export function useChartColors(): { colors: string[]; palette: ReturnType<typeof useTheme>['appearance']['chartPalette'] } {
  const { appearance, resolvedThemeId } = useTheme();
  const palette = appearance.chartPalette;
  const colors = useMemo(
    () => chartColors(palette, getThemeDefinition(resolvedThemeId)),
    [palette, resolvedThemeId],
  );
  return { colors, palette };
}

import { useEffect } from 'react';
import { TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import type { Appearance } from 'wwp-shared';
import { useTheme } from '../../../client/src/contexts/ThemeContext';
import { LIGHT_TILE_URL, TILE_ATTRIBUTION } from './geo';

interface TileSource {
  url: string;
  attribution: string;
  /** OSM serves CORS headers, which lets the service worker cache tiles. */
  cors: boolean;
  /** Show an attribution control (third-party providers' terms ask for it). */
  credit: boolean;
  subdomains?: string;
}

const CARTO_ATTRIBUTION = `${TILE_ATTRIBUTION} &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener noreferrer">CARTO</a>`;
const ESRI_ATTRIBUTION = 'Imagery &copy; Esri, Maxar, Earthstar Geographics';

/** Tile source for a map style (exported for tests). */
export function tileSource(style: Appearance['mapStyle'], mode: 'light' | 'dark'): TileSource {
  switch (style) {
    case 'muted':
      return {
        url: `https://{s}.basemaps.cartocdn.com/${mode === 'dark' ? 'dark_all' : 'light_all'}/{z}/{x}/{y}{r}.png`,
        attribution: CARTO_ATTRIBUTION,
        cors: false,
        credit: true,
        subdomains: 'abcd',
      };
    case 'satellite':
      return {
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        attribution: ESRI_ATTRIBUTION,
        cors: false,
        credit: true,
      };
    default:
      // standard, tinted and vintage are OSM; the latter two are CSS filters
      // (index.css, .wwp-tiles-<style>).
      return { url: LIGHT_TILE_URL, attribution: TILE_ATTRIBUTION, cors: true, credit: false };
  }
}

/** Adds an attribution control while a provider that requires one is shown. */
function Credit({ attribution }: { attribution: string }) {
  const map = useMap();
  useEffect(() => {
    const control = L.control.attribution({ prefix: false }).addAttribution(attribution).addTo(map);
    return () => {
      control.remove();
    };
  }, [map, attribution]);
  return null;
}

/**
 * The app's base map layer, following Settings > Display > Map style and the
 * light/dark mode. Use instead of a bare <TileLayer> in every map.
 */
export function ThemedTileLayer() {
  const { resolvedTheme, appearance } = useTheme();
  const style = appearance.mapStyle;
  const source = tileSource(style, resolvedTheme);
  return (
    <>
      <TileLayer
        // Remount on change: Leaflet doesn't swap url/className in place.
        key={`${style}:${resolvedTheme}`}
        url={source.url}
        attribution={source.attribution}
        className={`wwp-tiles wwp-tiles-${style}`}
        {...(source.subdomains ? { subdomains: source.subdomains } : {})}
        // CORS-enabled tile requests: opaque (no-cors) responses can't be cached
        // by the service worker's tile cache.
        {...(source.cors ? { crossOrigin: 'anonymous' as const } : {})}
      />
      {source.credit && <Credit attribution={source.attribution} />}
    </>
  );
}

import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import { useEffect, useMemo } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useTheme } from '../contexts/ThemeContext';

// Fix Leaflet's default icon paths (broken by bundlers)
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

interface MarkerData {
  lat: number;
  lng: number;
  label: string;
  id?: string;
  variant?: 'default' | 'current' | 'selected';
}

interface MapViewProps {
  center?: [number, number];
  zoom?: number;
  markers?: MarkerData[];
  selectedMarkerId?: string;
  onMarkerSelect?: (id: string) => void;
  onMarkerClick?: (id: string) => void;
  className?: string;
}

const markerShadowUrl = 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png';

function createMarkerIcon(color: string): L.Icon {
  const svg = encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="25" height="41" viewBox="0 0 25 41" fill="none">
      <path fill="${color}" stroke="#1f2937" stroke-width="1.25" d="M12.5 1C6.15 1 1 6.15 1 12.5c0 8.84 11.5 27.5 11.5 27.5S24 21.34 24 12.5C24 6.15 18.85 1 12.5 1Z"/>
      <circle cx="12.5" cy="12.5" r="4.5" fill="white"/>
    </svg>`
  );

  return L.icon({
    iconUrl: `data:image/svg+xml;charset=UTF-8,${svg}`,
    shadowUrl: markerShadowUrl,
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41],
  });
}

function createGpsLockedIcon(ringColor: string, dotColor: string): L.DivIcon {
  const svg = encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 26 26" fill="none">
      <circle cx="13" cy="13" r="9" fill="rgba(255,255,255,0.92)" stroke="${ringColor}" stroke-width="2"/>
      <path d="M13 3.5V6.5M13 19.5V22.5M3.5 13H6.5M19.5 13H22.5" stroke="${ringColor}" stroke-width="1.8" stroke-linecap="round"/>
      <circle cx="13" cy="13" r="3.2" fill="${dotColor}" stroke="white" stroke-width="1.2"/>
    </svg>`
  );

  return L.divIcon({
    className: 'gps-locked-marker-icon',
    html: `<img src="data:image/svg+xml;charset=UTF-8,${svg}" alt="" aria-hidden="true" style="display:block;width:26px;height:26px;" />`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    popupAnchor: [0, -14],
  });
}

const LIGHT_TILE_URL = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
const DARK_TILE_URL = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';
const MARKER_COLORS = {
  light: {
    default: '#ea580c',
    current: '#f97316',
    selected: '#c2410c',
  },
  dark: {
    default: '#fb923c',
    current: '#fdba74',
    selected: '#f97316',
  },
} as const;

type MarkerIcons = {
  default: L.Icon;
  current: L.DivIcon;
  selected: L.Icon;
};

function getMarkerIcon(
  marker: MarkerData,
  selectedMarkerId: string | undefined,
  icons: MarkerIcons
): L.Icon | L.DivIcon {
  if (selectedMarkerId && marker.id === selectedMarkerId) {
    return icons.selected;
  }

  if (marker.variant === 'current') {
    return icons.current;
  }

  if (marker.variant === 'selected') {
    return icons.selected;
  }

  return icons.default;
}

// Helper component to recenter map when center prop changes
function RecenterMap({ center }: { center: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center);
  }, [center, map]);
  return null;
}

export default function MapView({
  center = [40.7128, -74.006],
  zoom = 13,
  markers = [],
  selectedMarkerId,
  onMarkerSelect,
  onMarkerClick,
  className = '',
}: MapViewProps) {
  const { resolvedTheme } = useTheme();
  const markerIcons = useMemo(() => {
    const palette = MARKER_COLORS[resolvedTheme];
    return {
      default: createMarkerIcon(palette.default),
      current: createGpsLockedIcon(palette.current, palette.current),
      selected: createMarkerIcon(palette.selected),
    };
  }, [resolvedTheme]);

  return (
    <div className={`w-full h-full min-h-[300px] rounded-lg overflow-hidden ${className}`}>
      <MapContainer
        center={center}
        zoom={zoom}
        scrollWheelZoom
        attributionControl={false}
        className="w-full h-full"
        style={{ minHeight: '300px', height: '100%' }}
      >
        <TileLayer
          key={resolvedTheme}
          attribution={TILE_ATTRIBUTION}
          url={resolvedTheme === 'dark' ? DARK_TILE_URL : LIGHT_TILE_URL}
        />
        <RecenterMap center={center} />
        {markers.map((marker, i) => (
          <Marker
            key={marker.id ?? i}
            position={[marker.lat, marker.lng]}
            icon={getMarkerIcon(marker, selectedMarkerId, markerIcons)}
            eventHandlers={
              marker.id && onMarkerSelect
                ? {
                    click: () => onMarkerSelect(marker.id!),
                  }
                : undefined
            }
          >
            <Popup>
              {onMarkerClick && marker.id ? (
                <button
                  onClick={() => onMarkerClick(marker.id!)}
                  className="text-sm font-medium text-primary-600 hover:underline cursor-pointer bg-transparent border-none p-0"
                >
                  {marker.label}
                </button>
              ) : (
                <span className="text-sm font-medium">{marker.label}</span>
              )}
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}

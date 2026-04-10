import { useEffect, useMemo } from 'react';
import { Circle, MapContainer, Marker, Popup, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useTheme } from '../contexts/ThemeContext';
import { DARK_TILE_URL, LIGHT_TILE_URL, TILE_ATTRIBUTION } from '../utils/geo';

// Ensure Leaflet default icons work when bundled
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

interface Props {
  /** Initial center — only used on first mount */
  initialCenter: [number, number];
  /** Optional controlled recenter target for programmatic map moves */
  viewCenter?: [number, number] | null;
  centerCircle?: {
    center: [number, number];
    radiusMeters: number;
  } | null;
  zoom?: number;
  /** Called whenever the user stops dragging the map */
  onChange?: (lat: number, lng: number) => void;
  /** Called when the user clicks on the map to set a new center */
  onMapClick?: (lat: number, lng: number) => void;
  markers?: Array<{
    lat: number;
    lng: number;
    label: string;
    id?: string;
    variant?: 'default' | 'current' | 'selected';
  }>;
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

function createCenterIndicatorIcon(
  strokeColor: string,
  backgroundColor: string,
  borderColor: string
): L.DivIcon {
  const svg = encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none">
      <path d="M12 3L19 21L12 17L5 21L12 3Z" fill="${strokeColor}" stroke="${strokeColor}" stroke-width="1.5" stroke-linejoin="round"/>
    </svg>`
  );

  return L.divIcon({
    className: 'search-center-indicator-icon',
    html: `<div style="display:flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:9999px;background:${backgroundColor};border:1px solid ${borderColor};box-shadow:0 2px 8px rgba(15,23,42,0.18);backdrop-filter:blur(4px);">
      <img src="data:image/svg+xml;charset=UTF-8,${svg}" alt="" aria-hidden="true" style="width:12px;height:12px;display:block;transform:translateY(-0.5px);" />
    </div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

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
const CIRCLE_COLORS = {
  light: {
    stroke: '#c2410c',
    fill: '#f97316',
    markerBackground: 'rgba(255, 247, 237, 0.92)',
    markerBorder: 'rgba(194, 65, 12, 0.35)',
  },
  dark: {
    stroke: '#fb923c',
    fill: '#f97316',
    markerBackground: 'rgba(67, 20, 7, 0.88)',
    markerBorder: 'rgba(251, 146, 60, 0.38)',
  },
} as const;

type MarkerIcons = {
  default: L.Icon;
  current: L.DivIcon;
  selected: L.Icon;
};

function getMarkerIcon(
  marker: NonNullable<Props['markers']>[number],
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

function CenterTracker({
  onChange,
  onMapClick,
}: {
  onChange?: (lat: number, lng: number) => void;
  onMapClick?: (lat: number, lng: number) => void;
}) {
  useMapEvents({
    moveend(e) {
      if (!onChange) return;
      const c = e.target.getCenter();
      onChange(parseFloat(c.lat.toFixed(7)), parseFloat(c.lng.toFixed(7)));
    },
    click(e) {
      if (!onMapClick) return;
      onMapClick(
        parseFloat(e.latlng.lat.toFixed(7)),
        parseFloat(e.latlng.lng.toFixed(7))
      );
    },
  });
  return null;
}

function InitialView({ center, zoom }: { center: [number, number]; zoom: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, zoom);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally only on mount
  return null;
}

function SyncedView({ center }: { center: [number, number] | null }) {
  const map = useMap();
  useEffect(() => {
    if (!center) return;
    map.setView(center);
  }, [map, center]);
  return null;
}

export default function VenueEditMap({
  initialCenter,
  viewCenter = null,
  centerCircle = null,
  zoom = 15,
  onChange,
  onMapClick,
  markers = [],
  selectedMarkerId,
  onMarkerSelect,
  onMarkerClick,
  className = '',
}: Props) {
  const { resolvedTheme } = useTheme();
  const showCenterPinOverlay = !onMapClick;
  const markerIcons = useMemo(() => {
    const palette = MARKER_COLORS[resolvedTheme];
    return {
      default: createMarkerIcon(palette.default),
      current: createGpsLockedIcon(palette.current, palette.current),
      selected: createMarkerIcon(palette.selected),
    };
  }, [resolvedTheme]);
  const circleColors = CIRCLE_COLORS[resolvedTheme];
  const centerIndicatorIcon = useMemo(() => (
    createCenterIndicatorIcon(
      circleColors.stroke,
      circleColors.markerBackground,
      circleColors.markerBorder
    )
  ), [circleColors.markerBackground, circleColors.markerBorder, circleColors.stroke]);

  return (
    <div className={`relative ${className}`}>
      <MapContainer
        center={initialCenter}
        zoom={zoom}
        scrollWheelZoom
        attributionControl={false}
        className="w-full h-full"
        style={{ minHeight: '220px', height: '100%' }}
      >
        <TileLayer
          key={resolvedTheme}
          attribution={TILE_ATTRIBUTION}
          url={resolvedTheme === 'dark' ? DARK_TILE_URL : LIGHT_TILE_URL}
        />
        <InitialView center={initialCenter} zoom={zoom} />
        <SyncedView center={viewCenter} />
        <CenterTracker onChange={onChange} onMapClick={onMapClick} />
        {centerCircle ? (
          <>
            <Circle
              center={centerCircle.center}
              radius={centerCircle.radiusMeters}
              pathOptions={{
                color: circleColors.stroke,
                weight: 2,
                fillColor: circleColors.fill,
                fillOpacity: 0.08,
              }}
            />
            <Marker
              position={centerCircle.center}
              icon={centerIndicatorIcon}
              interactive={false}
              keyboard={false}
            />
          </>
        ) : null}
        {markers.map((marker, index) => (
          <Marker
            key={marker.id ?? index}
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

      {showCenterPinOverlay ? (
        <div
          className="pointer-events-none absolute left-1/2 top-1/2"
          style={{ zIndex: 1000, transform: 'translate(-50%, calc(-100% + 3px))' }}
        >
          <img
            src={markerIcons.default.options.iconUrl}
            alt=""
            aria-hidden="true"
            className="h-[41px] w-[25px]"
          />
        </div>
      ) : null}

      <div
        className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-md bg-black/60 px-2 py-0.5 text-[11px] text-white backdrop-blur-sm"
        style={{ zIndex: 1000 }}
      >
        {onMapClick ? 'Tap to move search center' : 'Drag map to move pin'}
      </div>
    </div>
  );
}

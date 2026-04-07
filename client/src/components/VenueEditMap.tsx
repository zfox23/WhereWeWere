import { useEffect } from 'react';
import { MapContainer, Marker, Popup, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

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
  zoom?: number;
  /** Called whenever the user stops dragging the map */
  onChange: (lat: number, lng: number) => void;
  markers?: Array<{
    lat: number;
    lng: number;
    label: string;
    id?: string;
    variant?: 'default' | 'selected';
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

const defaultMarkerIcon = createMarkerIcon('#2563eb');
const selectedMarkerIcon = createMarkerIcon('#dc2626');

function getMarkerIcon(
  marker: NonNullable<Props['markers']>[number],
  selectedMarkerId?: string
): L.Icon {
  if (selectedMarkerId && marker.id === selectedMarkerId) {
    return selectedMarkerIcon;
  }

  if (marker.variant === 'selected') {
    return selectedMarkerIcon;
  }

  return defaultMarkerIcon;
}

function CenterTracker({
  onChange,
}: {
  onChange: (lat: number, lng: number) => void;
}) {
  useMapEvents({
    moveend(e) {
      const c = e.target.getCenter();
      onChange(parseFloat(c.lat.toFixed(7)), parseFloat(c.lng.toFixed(7)));
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
  zoom = 15,
  onChange,
  markers = [],
  selectedMarkerId,
  onMarkerSelect,
  onMarkerClick,
  className = '',
}: Props) {
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
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <InitialView center={initialCenter} zoom={zoom} />
        <SyncedView center={viewCenter} />
        <CenterTracker onChange={onChange} />
        {markers.map((marker, index) => (
          <Marker
            key={marker.id ?? index}
            position={[marker.lat, marker.lng]}
            icon={getMarkerIcon(marker, selectedMarkerId)}
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
                  Select {marker.label}
                </button>
              ) : (
                <span className="text-sm font-medium">{marker.label}</span>
              )}
            </Popup>
          </Marker>
        ))}
      </MapContainer>

      {/* Fixed crosshair overlay — sits above the map tiles */}
      <div
        className="pointer-events-none absolute inset-0 flex items-center justify-center"
        style={{ zIndex: 1000 }}
      >
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
          {/* Horizontal bar */}
          <line x1="0" y1="16" x2="13" y2="16" stroke="white" strokeWidth="2.5" />
          <line x1="19" y1="16" x2="32" y2="16" stroke="white" strokeWidth="2.5" />
          <line x1="0" y1="16" x2="13" y2="16" stroke="#ef4444" strokeWidth="1.5" />
          <line x1="19" y1="16" x2="32" y2="16" stroke="#ef4444" strokeWidth="1.5" />
          {/* Vertical bar */}
          <line x1="16" y1="0" x2="16" y2="13" stroke="white" strokeWidth="2.5" />
          <line x1="16" y1="19" x2="16" y2="32" stroke="white" strokeWidth="2.5" />
          <line x1="16" y1="0" x2="16" y2="13" stroke="#ef4444" strokeWidth="1.5" />
          <line x1="16" y1="19" x2="16" y2="32" stroke="#ef4444" strokeWidth="1.5" />
          {/* Center dot */}
          <circle cx="16" cy="16" r="3.5" fill="white" />
          <circle cx="16" cy="16" r="2.5" fill="#ef4444" />
        </svg>
      </div>

      <div
        className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-md bg-black/60 px-2 py-0.5 text-[11px] text-white backdrop-blur-sm"
        style={{ zIndex: 1000 }}
      >
        Drag map to move pin
      </div>
    </div>
  );
}

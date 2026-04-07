import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import { useEffect } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

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

const defaultMarkerIcon = createMarkerIcon('#2563eb');
const currentMarkerIcon = createMarkerIcon('#0f766e');
const selectedMarkerIcon = createMarkerIcon('#dc2626');

function getMarkerIcon(marker: MarkerData, selectedMarkerId?: string): L.Icon {
  if (selectedMarkerId && marker.id === selectedMarkerId) {
    return selectedMarkerIcon;
  }

  if (marker.variant === 'current') {
    return currentMarkerIcon;
  }

  if (marker.variant === 'selected') {
    return selectedMarkerIcon;
  }

  return defaultMarkerIcon;
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
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <RecenterMap center={center} />
        {markers.map((marker, i) => (
          <Marker
            key={marker.id ?? i}
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
    </div>
  );
}

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
}

interface MapViewProps {
  center?: [number, number];
  zoom?: number;
  markers?: MarkerData[];
  onMarkerClick?: (id: string) => void;
  className?: string;
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
          <Marker key={marker.id ?? i} position={[marker.lat, marker.lng]}>
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

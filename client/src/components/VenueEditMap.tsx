import { useEffect } from 'react';
import { MapContainer, TileLayer, useMap, useMapEvents } from 'react-leaflet';
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
  className?: string;
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

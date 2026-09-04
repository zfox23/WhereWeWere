export const LIGHT_TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
export const DARK_TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
export const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors';

export function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
    Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export type DistanceUnit = 'metric' | 'imperial';

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function getBearingDegrees(fromLat: number, fromLon: number, toLat: number, toLon: number): number {
  const phi1 = toRadians(fromLat);
  const phi2 = toRadians(toLat);
  const lambdaDelta = toRadians(toLon - fromLon);

  const y = Math.sin(lambdaDelta) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(lambdaDelta);

  const bearing = (Math.atan2(y, x) * 180) / Math.PI;
  return (bearing + 360) % 360;
}

export function formatDistance(distanceMeters: number, unit: DistanceUnit = 'metric'): string {
  if (unit === 'imperial') {
    const distanceFeet = distanceMeters * 3.28084;
    if (distanceFeet < 5280) {
      return `${Math.round(distanceFeet)}ft`;
    }
    return `${(distanceFeet / 5280).toFixed(1)}mi`;
  }

  if (distanceMeters < 1000) {
    return `${Math.round(distanceMeters)}m`;
  }
  return `${(distanceMeters / 1000).toFixed(1)}km`;
}

export function formatSpeed(mps: number, unit: DistanceUnit): string {
  if (unit === 'imperial') {
    const mph = mps * 2.2369362921;
    return `${mph.toFixed(1)} mph`;
  }
  const kmh = mps * 3.6;
  return `${kmh.toFixed(1)} km/h`;
}

/** Shorthand duration: "0", "45s", "45m", "1h", "1h 30m" */
export function formatDuration(totalSeconds: number): string {
  if (totalSeconds < 60) return totalSeconds <= 0 ? '0' : `${Math.round(totalSeconds)}s`;
  const totalMinutes = Math.round(totalSeconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

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

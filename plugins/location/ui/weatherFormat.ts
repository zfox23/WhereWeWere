import { Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudRain, CloudSnow, CloudSun, Sun, type LucideIcon } from 'lucide-react';
import type { DistanceUnit } from './geo';

export interface WeatherHour {
  time: string;
  temp: number | null;
  code: number | null;
  precip: number | null;
  wind: number | null;
  humidity: number | null;
}

/** Daily summary as stored by the server (metric units), without hourly data. */
export interface WeatherSummary {
  final: boolean;
  code: number | null;
  tmax: number | null;
  tmin: number | null;
  precip: number | null;
  rain: number | null;
  snow: number | null;
  wind_max: number | null;
  gust_max: number | null;
  humidity_mean: number | null;
  sunrise: string | null;
  sunset: string | null;
  uv_max: number | null;
}

export interface WeatherDay extends WeatherSummary {
  date: string;
  latitude: number;
  longitude: number;
  timezone: string;
  /** The venue the weather is for; null when it no longer exists. */
  place: { name: string; city: string | null; state: string | null; country: string | null } | null;
  hourly: WeatherHour[];
}

/** WMO weather interpretation codes, as returned by Open-Meteo. */
export function describeWeather(code: number | null | undefined): { label: string; icon: LucideIcon } {
  if (code == null) return { label: 'Unknown', icon: Cloud };
  if (code === 0) return { label: 'Sunny', icon: Sun };
  if (code === 1) return { label: 'Mostly sunny', icon: Sun };
  if (code === 2) return { label: 'Partly cloudy', icon: CloudSun };
  if (code === 3) return { label: 'Cloudy', icon: Cloud };
  if (code === 45 || code === 48) return { label: 'Fog', icon: CloudFog };
  if (code >= 51 && code <= 57) return { label: 'Drizzle', icon: CloudDrizzle };
  if (code >= 61 && code <= 67) return { label: 'Rain', icon: CloudRain };
  if (code >= 71 && code <= 77) return { label: 'Snow', icon: CloudSnow };
  if (code >= 80 && code <= 82) return { label: 'Showers', icon: CloudRain };
  if (code === 85 || code === 86) return { label: 'Snow showers', icon: CloudSnow };
  if (code >= 95) return { label: 'Thunderstorm', icon: CloudLightning };
  return { label: 'Unknown', icon: Cloud };
}

export function formatTemp(celsius: number | null | undefined, unit: DistanceUnit): string {
  if (celsius == null) return '–';
  const v = unit === 'imperial' ? celsius * 9 / 5 + 32 : celsius;
  return `${Math.round(v)}°`;
}

export function formatWind(kmh: number | null | undefined, unit: DistanceUnit): string {
  if (kmh == null) return '–';
  return unit === 'imperial' ? `${Math.round(kmh * 0.621371)} mph` : `${Math.round(kmh)} km/h`;
}

export function formatPrecip(mm: number | null | undefined, unit: DistanceUnit): string {
  if (mm == null) return '–';
  return unit === 'imperial' ? `${(mm / 25.4).toFixed(2)} in` : `${Math.round(mm * 10) / 10} mm`;
}

/** Snowfall arrives in cm. */
export function formatSnow(cm: number | null | undefined, unit: DistanceUnit): string {
  if (cm == null) return '–';
  return unit === 'imperial' ? `${Math.round((cm / 2.54) * 10) / 10} in` : `${Math.round(cm * 10) / 10} cm`;
}

/** "HH:MM" from an Open-Meteo local ISO time such as 2025-06-01T05:42. */
export function formatClock(iso: string | null | undefined): string {
  if (!iso) return '–';
  const m = /T(\d{2}):(\d{2})/.exec(iso);
  if (!m) return '–';
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
}

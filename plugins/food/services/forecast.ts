// ============================================================================
// Daily forecast from Open-Meteo (https://open-meteo.com; free, no key,
// CC BY 4.0) for meal suggestions: one request covering every suggested day.
// ============================================================================

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const TIMEOUT_MS = 10_000;
/** Open-Meteo forecasts reach 16 days ahead. */
export const MAX_FORECAST_DAYS = 16;

export interface ForecastDay {
  date: string;
  tmax: number | null;
  tmin: number | null;
  precip_probability: number | null;
  code: number | null;
}

/** WMO weather interpretation codes, coarse enough for meal planning. */
export function describeWeatherCode(code: number | null): string | null {
  if (code == null) return null;
  if (code === 0) return 'clear';
  if (code <= 2) return 'partly cloudy';
  if (code === 3) return 'overcast';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 51 && code <= 57) return 'drizzle';
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95) return 'thunderstorms';
  return null;
}

export function parseForecast(body: unknown): ForecastDay[] {
  const daily = (body as { daily?: Record<string, unknown[]> })?.daily;
  if (!daily || !Array.isArray(daily.time)) return [];
  const num = (arr: unknown[] | undefined, i: number) => {
    const v = arr?.[i];
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  };
  return daily.time.map((date, i) => ({
    date: String(date),
    tmax: num(daily.temperature_2m_max, i),
    tmin: num(daily.temperature_2m_min, i),
    precip_probability: num(daily.precipitation_probability_max, i),
    code: num(daily.weather_code, i),
  }));
}

/** Forecast for `startDate`..`endDate` (inclusive, local dates in `timezone`). */
export async function fetchForecast(
  latitude: number,
  longitude: number,
  timezone: string,
  startDate: string,
  endDate: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ForecastDay[]> {
  const params = new URLSearchParams({
    latitude: latitude.toFixed(4),
    longitude: longitude.toFixed(4),
    timezone,
    start_date: startDate,
    end_date: endDate,
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code',
    temperature_unit: 'celsius',
  });
  const res = await fetchImpl(`${FORECAST_URL}?${params}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Open-Meteo error ${res.status}`);
  return parseForecast(await res.json());
}

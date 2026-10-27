// ============================================================================
// Open-Meteo client (https://open-meteo.com): free, no API key, CC BY 4.0,
// non-commercial use. Fetches one local calendar day for one coordinate:
// the archive API for settled days, the forecast API for the last few days.
// All values are stored metric; the client converts for display.
// ============================================================================

const ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';

/** The archive lags real time by about five days; newer days come from the forecast API. */
export const ARCHIVE_LAG_DAYS = 6;

const DAILY_VARS = [
  'weather_code',
  'temperature_2m_max',
  'temperature_2m_min',
  'precipitation_sum',
  'rain_sum',
  'snowfall_sum',
  'wind_speed_10m_max',
  'wind_gusts_10m_max',
  'sunrise',
  'sunset',
  'uv_index_max',
];
const HOURLY_VARS = [
  'temperature_2m',
  'weather_code',
  'precipitation',
  'wind_speed_10m',
  'relative_humidity_2m',
];

export interface HourlyWeather {
  /** Local time, "YYYY-MM-DDTHH:00". */
  time: string;
  temp: number | null;
  code: number | null;
  precip: number | null;
  wind: number | null;
  humidity: number | null;
}

export interface DailyWeatherData {
  source: 'archive' | 'forecast';
  /** False while the day came from the forecast API and may still be revised. */
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
  hourly: HourlyWeather[];
}

export class OpenMeteoError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'OpenMeteoError';
  }
}

export interface FetchOptions {
  /** Retries after a 429 (honouring Retry-After). Defaults to 0 for interactive use. */
  maxRetries?: number;
  fetchImpl?: typeof fetch;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/** YYYY-MM-DD for "now" in an IANA timezone. */
export function todayInTimezone(timezone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(now);
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** True when the date is old enough for the archive API to have settled values. */
export function isArchiveDate(date: string, timezone: string, now: Date = new Date()): boolean {
  return daysBetween(date, todayInTimezone(timezone, now)) >= ARCHIVE_LAG_DAYS;
}

/** Parse an Open-Meteo response (one day requested) into the stored shape. */
export function parseOpenMeteo(body: any, source: 'archive' | 'forecast'): DailyWeatherData {
  const d = body?.daily;
  if (!d || !Array.isArray(d.time) || d.time.length === 0) {
    throw new OpenMeteoError('Open-Meteo returned no daily data');
  }
  const h = body.hourly ?? {};
  const times: unknown[] = Array.isArray(h.time) ? h.time : [];
  const at = (arr: unknown, i: number) => (Array.isArray(arr) ? arr[i] : undefined);
  const hourly: HourlyWeather[] = times.map((t, i) => ({
    time: String(t),
    temp: num(at(h.temperature_2m, i)),
    code: num(at(h.weather_code, i)),
    precip: num(at(h.precipitation, i)),
    wind: num(at(h.wind_speed_10m, i)),
    humidity: num(at(h.relative_humidity_2m, i)),
  }));
  const humidities = hourly.map((x) => x.humidity).filter((x): x is number => x != null);
  const first = (key: string) => at(d[key], 0);
  const data: DailyWeatherData = {
    source,
    final: source === 'archive',
    code: num(first('weather_code')),
    tmax: num(first('temperature_2m_max')),
    tmin: num(first('temperature_2m_min')),
    precip: num(first('precipitation_sum')),
    rain: num(first('rain_sum')),
    snow: num(first('snowfall_sum')),
    wind_max: num(first('wind_speed_10m_max')),
    gust_max: num(first('wind_gusts_10m_max')),
    humidity_mean: humidities.length
      ? Math.round(humidities.reduce((a, b) => a + b, 0) / humidities.length)
      : null,
    sunrise: str(first('sunrise')),
    sunset: str(first('sunset')),
    uv_max: num(first('uv_index_max')),
    hourly,
  };
  if (data.tmax == null && data.tmin == null && data.code == null) {
    throw new OpenMeteoError('Open-Meteo has no data for that day yet');
  }
  return data;
}

/** Fetch one local calendar day of weather at a coordinate. */
export async function fetchDayWeather(
  latitude: number,
  longitude: number,
  date: string,
  timezone: string,
  options: FetchOptions = {},
): Promise<DailyWeatherData> {
  const source = isArchiveDate(date, timezone) ? 'archive' : 'forecast';
  const params = new URLSearchParams({
    latitude: latitude.toFixed(4),
    longitude: longitude.toFixed(4),
    start_date: date,
    end_date: date,
    timezone,
    daily: DAILY_VARS.join(','),
    hourly: HOURLY_VARS.join(','),
    temperature_unit: 'celsius',
    wind_speed_unit: 'kmh',
    precipitation_unit: 'mm',
  });
  const url = `${source === 'archive' ? ARCHIVE_URL : FORECAST_URL}?${params}`;
  const doFetch = options.fetchImpl ?? fetch;
  const maxRetries = options.maxRetries ?? 0;

  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await doFetch(url, { headers: { Accept: 'application/json' } });
    } catch (err) {
      throw new OpenMeteoError(`Could not reach Open-Meteo: ${err instanceof Error ? err.message : 'network error'}`);
    }
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('Retry-After'));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 60_000;
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      throw new OpenMeteoError('Open-Meteo rate limit reached; try again later', 429, waitMs);
    }
    if (!res.ok) {
      let reason = '';
      try {
        reason = ((await res.json()) as { reason?: string })?.reason ?? '';
      } catch { /* not JSON */ }
      throw new OpenMeteoError(`Open-Meteo error ${res.status}${reason ? `: ${reason}` : ''}`, res.status);
    }
    return parseOpenMeteo(await res.json(), source);
  }
}

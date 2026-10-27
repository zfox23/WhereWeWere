import { describe, expect, it, vi } from 'vitest';
import { OpenMeteoError, fetchDayWeather, isArchiveDate, parseOpenMeteo } from '../services/openMeteo';

const BODY = {
  daily: {
    time: ['2025-06-01'],
    weather_code: [61],
    temperature_2m_max: [21.4],
    temperature_2m_min: [12.1],
    precipitation_sum: [4.2],
    rain_sum: [4.2],
    snowfall_sum: [0],
    wind_speed_10m_max: [18],
    wind_gusts_10m_max: [34],
    sunrise: ['2025-06-01T05:12'],
    sunset: ['2025-06-01T21:03'],
    uv_index_max: [5.5],
  },
  hourly: {
    time: ['2025-06-01T00:00', '2025-06-01T01:00'],
    temperature_2m: [13, 12.5],
    weather_code: [3, 61],
    precipitation: [0, 1.2],
    wind_speed_10m: [10, 12],
    relative_humidity_2m: [80, 90],
  },
};

describe('parseOpenMeteo', () => {
  it('maps the daily and hourly arrays', () => {
    const d = parseOpenMeteo(BODY, 'archive');
    expect(d).toMatchObject({ final: true, code: 61, tmax: 21.4, tmin: 12.1, humidity_mean: 85, uv_max: 5.5 });
    expect(d.hourly).toHaveLength(2);
    expect(d.hourly[1]).toMatchObject({ time: '2025-06-01T01:00', precip: 1.2, code: 61 });
  });
  it('marks forecast-sourced days as provisional', () => {
    expect(parseOpenMeteo(BODY, 'forecast').final).toBe(false);
  });
  it('rejects an empty response', () => {
    expect(() => parseOpenMeteo({ daily: { time: [] } }, 'archive')).toThrow(OpenMeteoError);
  });
});

describe('isArchiveDate', () => {
  const now = new Date('2025-06-20T12:00:00Z');
  it('uses the archive only for settled days', () => {
    expect(isArchiveDate('2025-06-01', 'UTC', now)).toBe(true);
    expect(isArchiveDate('2025-06-18', 'UTC', now)).toBe(false);
  });
});

describe('fetchDayWeather', () => {
  it('requests the archive API with the local timezone', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(BODY), { status: 200 }));
    await fetchDayWeather(40.7128, -74.006, '2020-01-05', 'America/New_York', { fetchImpl: fetchImpl as any });
    const url = String((fetchImpl.mock.calls[0] as unknown[])[0]);
    expect(url).toContain('archive-api.open-meteo.com');
    expect(url).toContain('start_date=2020-01-05');
    expect(url).toContain('timezone=America%2FNew_York');
  });
  it('surfaces a 429 with its retry delay', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 429, headers: { 'Retry-After': '7' } }));
    await expect(
      fetchDayWeather(1, 2, '2020-01-05', 'UTC', { fetchImpl: fetchImpl as any }),
    ).rejects.toMatchObject({ status: 429, retryAfterMs: 7000 });
  });
});

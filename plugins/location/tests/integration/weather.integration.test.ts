import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { enrichWeatherForDate, pendingWeatherDates } from '../../services/weatherEnrich';
import { resolveNoonLocation } from '../../services/noonLocation';
import { createApp } from '../../../../server/src/index';
import { query } from '../../../../server/src/db';
import {
  DEFAULT_USER_ID,
  resetIntegrationDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase,
} from '../../../../server/tests/helpers/testDb';

const app = createApp();

const BODY = {
  daily: {
    time: ['2020-03-02'],
    weather_code: [71],
    temperature_2m_max: [1],
    temperature_2m_min: [-5],
    precipitation_sum: [3],
    rain_sum: [0],
    snowfall_sum: [2],
    wind_speed_10m_max: [20],
    wind_gusts_10m_max: [30],
    sunrise: ['2020-03-02T06:30'],
    sunset: ['2020-03-02T17:50'],
    uv_index_max: [2],
  },
  hourly: {
    time: ['2020-03-02T00:00'],
    temperature_2m: [-4],
    weather_code: [71],
    precipitation: [0.5],
    wind_speed_10m: [9],
    relative_humidity_2m: [88],
  },
};

function stubOpenMeteo() {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(BODY), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function venue(name: string, lat: number, lon: number) {
  const r = await query(
    `INSERT INTO venues (name, latitude, longitude) VALUES ($1, $2, $3) RETURNING id`,
    [name, lat, lon],
  );
  return r.rows[0].id as string;
}

async function checkin(venueId: string, at: string, tz = 'America/New_York') {
  await query(
    `INSERT INTO checkins (user_id, venue_id, checked_in_at, checkin_timezone) VALUES ($1, $2, $3, $4)`,
    [DEFAULT_USER_ID, venueId, at, tz],
  );
}

async function enable() {
  await query(
    `INSERT INTO plugin_settings (user_id, plugin_id, key, value)
     VALUES ($1, 'location', 'weather_enabled', 'true'::jsonb)
     ON CONFLICT (user_id, plugin_id, key) DO UPDATE SET value = EXCLUDED.value`,
    [DEFAULT_USER_ID],
  );
}

describe('Weather (integration)', () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  });
  beforeEach(async () => {
    await resetIntegrationDatabase();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  afterAll(async () => {
    await teardownIntegrationDatabase();
  });

  it('uses the latest check-in at or before noon, carried forward from earlier days', async () => {
    const nyc = await venue('NYC', 40.7128, -74.006);
    const la = await venue('LA', 34.05, -118.24);
    await checkin(nyc, '2020-03-01T15:00:00Z'); // 10:00 local on Mar 1
    await checkin(la, '2020-03-02T21:00:00Z', 'America/Los_Angeles'); // 13:00 local on Mar 2
    // Mar 2 noon: the LA check-in is after noon, so NYC carries forward.
    expect(await resolveNoonLocation(DEFAULT_USER_ID, '2020-03-02')).toMatchObject({
      latitude: 40.7128,
      timezone: 'America/New_York',
    });
    // Mar 3 noon: LA is the latest.
    expect((await resolveNoonLocation(DEFAULT_USER_ID, '2020-03-03'))?.timezone).toBe('America/Los_Angeles');
    // Before any check-in: fall back to the first one after.
    expect((await resolveNoonLocation(DEFAULT_USER_ID, '2020-02-20'))?.latitude).toBe(40.7128);
  });

  it('stores the day, lists pending days, and exposes it through the API when enabled', async () => {
    const fetchMock = stubOpenMeteo();
    const nyc = await venue('NYC', 40.7128, -74.006);
    await checkin(nyc, '2020-03-02T15:00:00Z');

    expect(await pendingWeatherDates(DEFAULT_USER_ID)).toEqual(['2020-03-02']);
    await enrichWeatherForDate(DEFAULT_USER_ID, '2020-03-02');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await pendingWeatherDates(DEFAULT_USER_ID)).toEqual([]);

    expect((await request(app).get('/api/v1/weather?dates=2020-03-02')).body).toEqual({ enabled: false, days: {} });
    await enable();
    const list = await request(app).get('/api/v1/weather?dates=2020-03-02,2020-03-03');
    expect(list.body.enabled).toBe(true);
    expect(list.body.days['2020-03-02']).toMatchObject({ code: 71, tmax: 1, tmin: -5, final: true });
    expect(list.body.days['2020-03-02'].hourly).toBeUndefined();
    const day = await request(app).get('/api/v1/weather/2020-03-02');
    expect(day.body.hourly).toHaveLength(1);
    expect(day.body.place).toMatchObject({ name: 'NYC' });
  });

  it('fetches after a check-in is saved only when enabled', async () => {
    const fetchMock = stubOpenMeteo();
    const nyc = await venue('NYC', 40.7128, -74.006);
    const post = () =>
      request(app)
        .post('/api/v1/location-checkins')
        .send({ user_id: DEFAULT_USER_ID, venue_id: nyc, checked_in_at: '2020-03-02T15:00:00Z' });
    await post();
    await new Promise((r) => setTimeout(r, 200));
    expect(fetchMock).not.toHaveBeenCalled();

    await enable();
    await post();
    for (let i = 0; i < 50 && fetchMock.mock.calls.length === 0; i++) await new Promise((r) => setTimeout(r, 50));
    expect(fetchMock).toHaveBeenCalled();
  });

  it('includes daily weather in backups and restores it', async () => {
    stubOpenMeteo();
    const nyc = await venue('NYC', 40.7128, -74.006);
    await checkin(nyc, '2020-03-02T15:00:00Z');
    await enrichWeatherForDate(DEFAULT_USER_ID, '2020-03-02');

    const { server } = await import('../../server');
    const table = server.extraBackupTables!.find((t) => t.table === 'daily_weather')!;
    const rows = (await query(table.select, [DEFAULT_USER_ID])).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].local_date).toBe('2020-03-02');

    await query('DELETE FROM daily_weather');
    for (const row of JSON.parse(JSON.stringify(rows))) {
      await query(table.insert, [DEFAULT_USER_ID, ...Object.values(row)]);
    }
    const restored = await query(`SELECT status, data->>'code' AS code FROM daily_weather`);
    expect(restored.rows).toEqual([{ status: 'ok', code: '71' }]);
  });
});

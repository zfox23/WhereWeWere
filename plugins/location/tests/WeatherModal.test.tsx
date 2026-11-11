/// <reference types="@testing-library/jest-dom" />
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WeatherModal from '../ui/WeatherModal';

const dayMock = vi.hoisted(() => vi.fn());
vi.mock('../../../client/src/api/client', () => ({ weather: { day: dayMock } }));

const hourly = Array.from({ length: 24 }, (_, h) => ({
  time: `2025-06-01T${String(h).padStart(2, '0')}:00`,
  temp: 10 + h / 2,
  code: h === 15 ? 63 : 1,
  precip: h === 15 ? 2.5 : 0,
  wind: 12,
  humidity: 60 + h,
}));

const day = {
  date: '2025-06-01',
  latitude: 47.6,
  longitude: -122.3,
  timezone: 'America/Los_Angeles',
  place: { name: 'Gas Works Park', city: 'Seattle', state: 'WA', country: 'US' },
  final: true,
  code: 63,
  tmax: 21.5,
  tmin: 10,
  precip: 2.5,
  rain: 2.5,
  snow: 0,
  wind_max: 20,
  gust_max: 35,
  humidity_mean: 72,
  sunrise: '2025-06-01T05:12',
  sunset: '2025-06-01T21:03',
  uv_max: 6.4,
  hourly,
};

describe('WeatherModal', () => {
  afterEach(() => { cleanup(); dayMock.mockReset(); });

  it('charts the hours with sun times and summarizes the day', async () => {
    dayMock.mockResolvedValue(day);
    render(<WeatherModal date="2025-06-01" dateLabel="Sunday, June 1" unit="metric" onClose={() => {}} />);
    const chart = await screen.findByRole('img', { name: /hourly temperature and precipitation/i });
    expect(chart).toHaveTextContent('5:12 AM');
    expect(chart).toHaveTextContent('9:03 PM');
    expect(screen.getAllByTestId('night')).toHaveLength(2);
    expect(screen.getAllByTestId('precip-bar')).toHaveLength(1);
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByText('UV').parentElement).toHaveTextContent('UV 6.4');
    expect(screen.getByText('Wind').parentElement).toHaveTextContent('20 km/h (gusts 35 km/h)');
    expect(screen.getByText('Humidity').parentElement).toHaveTextContent('72%');
    // The chart already shows sunrise and sunset.
    expect(screen.queryByText('Sunrise')).toBeNull();
  });

  it('shows an hour’s details when it is tapped', async () => {
    dayMock.mockResolvedValue(day);
    render(<WeatherModal date="2025-06-01" dateLabel="Sunday, June 1" unit="imperial" onClose={() => {}} />);
    const hits = await screen.findAllByTestId('hour-hit');
    expect(hits).toHaveLength(24);
    fireEvent.pointerDown(hits[15]);
    const popup = screen.getByRole('status');
    expect(popup).toHaveTextContent('3:00 PM');
    expect(popup).toHaveTextContent('64° · Rain');
    expect(popup).toHaveTextContent('Precip 0.10 in');
    expect(popup).toHaveTextContent('Humidity 75%');
    expect(popup).toHaveTextContent('Wind 7 mph');
  });

  it('follows a finger sliding along the chart', async () => {
    dayMock.mockResolvedValue(day);
    render(<WeatherModal date="2025-06-01" dateLabel="Sunday, June 1" unit="metric" onClose={() => {}} />);
    const hits = await screen.findAllByTestId('hour-hit');
    const chart = screen.getByRole('img', { name: /hourly temperature and precipitation/i });
    fireEvent.pointerDown(hits[3], { pointerType: 'touch' });
    expect(screen.getByRole('status')).toHaveTextContent('3:00 AM');
    // Default 600px width: 24 hour bands span x = 36..560.
    fireEvent.pointerMove(chart, { pointerType: 'touch', buttons: 1, clientX: 374 });
    expect(screen.getByRole('status')).toHaveTextContent('3:00 PM');
    // A touch that is not pressed does not move the selection.
    fireEvent.pointerMove(chart, { pointerType: 'touch', buttons: 0, clientX: 112 });
    expect(screen.getByRole('status')).toHaveTextContent('3:00 PM');
  });

  it('locks page scrolling while open', async () => {
    dayMock.mockResolvedValue(day);
    const { unmount } = render(<WeatherModal date="2025-06-01" dateLabel="Sunday, June 1" unit="metric" onClose={() => {}} />);
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).not.toBe('hidden');
  });

  it('lists sun times when there is no hourly data to chart', async () => {
    dayMock.mockResolvedValue({ ...day, hourly: [] });
    render(<WeatherModal date="2025-06-01" dateLabel="Sunday, June 1" unit="metric" onClose={() => {}} />);
    expect(await screen.findByText('Sunrise')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /hourly/i })).toBeNull();
  });
});

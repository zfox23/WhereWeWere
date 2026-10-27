import { useEffect, useState } from 'react';
import { MapPin, X } from 'lucide-react';
import { weather as weatherApi } from '../../../client/src/api/client';
import {
  describeWeather,
  formatClock,
  formatPrecip,
  formatSnow,
  formatTemp,
  formatWind,
  type WeatherDay,
} from './weatherFormat';
import type { DistanceUnit } from './geo';

interface Props {
  date: string;
  dateLabel: string;
  unit: DistanceUnit;
  onClose: () => void;
}

export default function WeatherModal({ date, dateLabel, unit, onClose }: Props) {
  const [day, setDay] = useState<WeatherDay | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    weatherApi.day(date).then(setDay).catch((err) => setError(err instanceof Error ? err.message : 'Could not load weather.'));
  }, [date]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const summary = day ? describeWeather(day.code) : null;
  const rows: [string, string][] = day
    ? [
        ['Precipitation', formatPrecip(day.precip, unit)],
        ...(day.snow ? [['Snowfall', formatSnow(day.snow, unit)] as [string, string]] : []),
        ['Wind', `${formatWind(day.wind_max, unit)} (gusts ${formatWind(day.gust_max, unit)})`],
        ['Humidity', day.humidity_mean != null ? `${day.humidity_mean}%` : '–'],
        ['Sunrise', formatClock(day.sunrise)],
        ['Sunset', formatClock(day.sunset)],
        ['UV index', day.uv_max != null ? String(Math.round(day.uv_max * 10) / 10) : '–'],
      ]
    : [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Weather for ${dateLabel}`}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md max-h-[85vh] overflow-y-auto bg-white dark:bg-gray-900 rounded-2xl shadow-xl p-5"
      >
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">{dateLabel}</h3>
            {summary && day && (
              <p className="text-sm text-gray-600 dark:text-gray-300 flex items-center gap-1.5 mt-0.5">
                <summary.icon size={16} aria-hidden="true" />
                {summary.label} · High {formatTemp(day.tmax, unit)} / Low {formatTemp(day.tmin, unit)}
              </p>
            )}
            {day && (
              <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1 mt-0.5">
                <MapPin size={12} aria-hidden="true" />
                {day.place
                  ? [day.place.name, day.place.city, day.place.state].filter(Boolean).join(', ')
                  : `${day.latitude.toFixed(2)}, ${day.longitude.toFixed(2)}`}
                {' '}(at noon)
              </p>
            )}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
            <X size={18} />
          </button>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {!day && !error && <p className="text-sm text-gray-500">Loading...</p>}

        {day && (
          <>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
              {rows.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-gray-500 dark:text-gray-400">{k}</dt>
                  <dd className="text-gray-900 dark:text-gray-100 text-right">{v}</dd>
                </div>
              ))}
            </dl>

            {day.hourly.length > 0 && (
              <div className="mt-4">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">Hourly</h4>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-gray-500 dark:text-gray-400">
                      <th className="py-1 font-medium">Time</th>
                      <th className="py-1 font-medium">Temp</th>
                      <th className="py-1 font-medium">Sky</th>
                      <th className="py-1 font-medium text-right">Precip</th>
                      <th className="py-1 font-medium text-right">Wind</th>
                    </tr>
                  </thead>
                  <tbody className="text-gray-800 dark:text-gray-200">
                    {day.hourly.map((h) => {
                      const d = describeWeather(h.code);
                      return (
                        <tr key={h.time} className="border-t border-gray-100 dark:border-gray-800">
                          <td className="py-1">{formatClock(h.time)}</td>
                          <td className="py-1">{formatTemp(h.temp, unit)}</td>
                          <td className="py-1"><d.icon size={14} aria-label={d.label} /></td>
                          <td className="py-1 text-right">{formatPrecip(h.precip, unit)}</td>
                          <td className="py-1 text-right">{formatWind(h.wind, unit)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {!day.final && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-3">Recent days are provisional and update once final data is available.</p>
            )}
          </>
        )}
        <p className="text-xs text-gray-400 mt-4">
          Weather data by{' '}
          <a href="https://open-meteo.com/" target="_blank" rel="noreferrer" className="underline hover:text-gray-600 dark:hover:text-gray-200">Open-Meteo.com</a>
          {' '}(CC BY 4.0)
        </p>
      </div>
    </div>
  );
}

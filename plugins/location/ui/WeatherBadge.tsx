import { describeWeather, formatTemp, type WeatherSummary } from './weatherFormat';
import type { DistanceUnit } from './geo';

interface Props {
  weather: WeatherSummary;
  unit: DistanceUnit;
  onClick: () => void;
}

/** Icon + high/low next to a timeline date; opens the details modal. */
export default function WeatherBadge({ weather, unit, onClick }: Props) {
  const { label, icon: Icon } = describeWeather(weather.code);
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${label} – see weather details`}
      aria-label={`${label}, high ${formatTemp(weather.tmax, unit)}, low ${formatTemp(weather.tmin, unit)}. Show weather details`}
      className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
    >
      <Icon size={14} aria-hidden="true" />
      <span>{formatTemp(weather.tmax, unit)}/{formatTemp(weather.tmin, unit)}</span>
    </button>
  );
}

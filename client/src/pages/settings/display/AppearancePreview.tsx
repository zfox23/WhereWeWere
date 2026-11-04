import { MapPin, Star } from 'lucide-react';
import { getThemeDefinition } from '../../../themes';
import { useTheme } from '../../../contexts/ThemeContext';

/**
 * A miniature of the app built from the same classes and CSS variables as the
 * real UI, so every Display knob shows up here live while the user scrolls
 * through the options.
 */
export function AppearancePreview() {
  const { resolvedThemeId } = useTheme();
  const themeLabel = getThemeDefinition(resolvedThemeId).label;

  return (
    <div
      className="appearance-preview relative overflow-hidden rounded-2xl border border-white/50 dark:border-gray-700/60 shadow-sm shadow-black/5"
      aria-label={`Preview of the ${themeLabel} theme`}
      role="img"
    >
      {/* Mini header */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-white/70 dark:bg-gray-900/70 border-b border-white/40 dark:border-gray-700/40 backdrop-blur-sm">
        <span className="font-display text-base tracking-wide text-primary-600 dark:text-primary-400">WhereWeWere</span>
        <span className="text-[10px] font-medium text-gray-500 dark:text-gray-400">{themeLabel}</span>
      </div>

      <div className="flex gap-3 p-3">
        {/* Check-in card */}
        <div className="flex-1 min-w-0 bg-white/70 dark:bg-gray-900/60 rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm backdrop-blur-md p-3 space-y-2">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-primary-100 dark:bg-primary-900/40 text-primary-600 dark:text-primary-300">
              <MapPin size={14} />
            </span>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">Corner Café</div>
              <div className="truncate text-[11px] text-gray-500 dark:text-gray-400">Today · 9:41</div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded-full bg-primary-50 dark:bg-primary-900/30 border border-primary-200 dark:border-primary-800 px-2 py-0.5 text-[10px] font-medium text-primary-700 dark:text-primary-300">
              coffee
            </span>
            <span className="flex items-center gap-0.5 text-amber-500">
              <Star size={10} fill="currentColor" />
              <Star size={10} fill="currentColor" />
              <Star size={10} fill="currentColor" />
            </span>
            <span className="ml-auto inline-flex items-center rounded-xl bg-primary-600 px-2.5 py-1 text-[10px] font-medium text-white shadow-sm">
              Check in
            </span>
          </div>
        </div>

        {/* Mini chart, tinted like the theme's accent ramp */}
        <div className="hidden sm:flex w-28 shrink-0 flex-col justify-between bg-white/70 dark:bg-gray-900/60 rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm backdrop-blur-md p-2">
          <span className="text-[10px] font-medium text-gray-500 dark:text-gray-400">This week</span>
          <svg viewBox="0 0 100 40" className="w-full h-10" aria-hidden="true">
            {[14, 26, 18, 34, 22, 30, 38].map((h, i) => (
              <rect
                key={i}
                x={i * 14 + 2}
                y={40 - h}
                width="10"
                height={h}
                rx="2"
                style={{ fill: `rgb(var(--color-primary-${i % 2 ? '300' : '500'}))` }}
              />
            ))}
          </svg>
        </div>
      </div>
    </div>
  );
}

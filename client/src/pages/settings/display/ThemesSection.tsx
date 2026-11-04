import { useState } from 'react';
import { Sun, Moon, Monitor, Palette, Leaf } from 'lucide-react';
import { useTheme } from '../../../contexts/ThemeContext';
import {
  SYSTEM_THEME_ID,
  THEME_GROUPS,
  getThemeDefinition,
  type ThemeGroupId,
} from '../../../themes';
import { DisplaySection } from './DisplaySection';

const GROUP_ICONS: Record<ThemeGroupId, React.ElementType<{ size?: number; className?: string }>> = {
  light: Sun,
  dark: Moon,
  seasonal: Leaf,
};

const selectedClass = 'bg-primary-50/80 dark:bg-primary-900/30 border-primary-300 dark:border-primary-700 shadow-sm';
const idleClass = 'bg-white/50 dark:bg-gray-800/50 border-gray-200/60 dark:border-gray-700/60 hover:bg-gray-50 dark:hover:bg-gray-700/50';

export function ThemesSection() {
  const { theme: currentTheme, setTheme, systemThemeSelection, resolvedThemeId } = useTheme();
  // Open on the group that holds the active theme.
  const [group, setGroup] = useState<ThemeGroupId>(
    () => THEME_GROUPS.find((g) => g.themes.some((t) => t.id === resolvedThemeId))?.id ?? 'light'
  );
  const activeGroup = THEME_GROUPS.find((g) => g.id === group) ?? THEME_GROUPS[0];
  const summary = currentTheme === SYSTEM_THEME_ID ? 'Follow System' : getThemeDefinition(currentTheme).label;

  return (
    <DisplaySection id="themes" title="Theme" icon={Palette} summary={summary}>
      <button
        type="button"
        onClick={() => setTheme(SYSTEM_THEME_ID)}
        className={`w-full rounded-2xl border p-4 text-left transition-all ${currentTheme === SYSTEM_THEME_ID ? selectedClass : idleClass}`}
        aria-pressed={currentTheme === SYSTEM_THEME_ID}
        aria-label="System Theme"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
              <Monitor size={18} className="text-primary-600 dark:text-primary-400" />
              Follow System
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Uses {getThemeDefinition(systemThemeSelection.light).label} for light mode and {getThemeDefinition(systemThemeSelection.dark).label} for dark mode.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-white/50 dark:border-gray-700/60 bg-white/70 dark:bg-gray-900/60 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300">
            <Sun size={14} />
            <span className="h-1.5 w-1.5 rounded-full bg-gray-300 dark:bg-gray-600" />
            <Moon size={14} />
          </div>
        </div>
      </button>

      <div role="tablist" aria-label="Theme groups" className="grid grid-cols-3 gap-1 rounded-xl bg-gray-100/70 dark:bg-gray-800/60 p-1">
        {THEME_GROUPS.map(({ id, label }) => {
          const Icon = GROUP_ICONS[id];
          const isActive = id === group;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setGroup(id)}
              className={`flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-sm font-medium transition-all ${isActive
                ? 'bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
                }`}
            >
              <Icon size={14} />
              {label}
            </button>
          );
        })}
      </div>

      {group === 'seasonal' && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Seasonal themes are light or dark like any other, so they can also be a Follow System pairing.
        </p>
      )}

      <div role="tabpanel" className="grid gap-2 sm:grid-cols-2">
        {activeGroup.themes.map((themeOption) => {
          const isSelected = currentTheme === themeOption.id;
          // Follow System pairs with this theme for its mode.
          const isPaired = currentTheme === SYSTEM_THEME_ID && systemThemeSelection[themeOption.mode] === themeOption.id;
          return (
            <button
              key={themeOption.id}
              type="button"
              onClick={() => setTheme(themeOption.id)}
              className={`w-full rounded-2xl border p-2 pl-3 text-left transition-all ${isSelected ? selectedClass : idleClass}`}
              aria-pressed={isSelected}
              aria-label={`${themeOption.label} Theme`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">{themeOption.label}</div>
                  {(group === 'seasonal' || isPaired) && (
                    <div className="flex items-center gap-1 text-[11px] text-gray-500 dark:text-gray-400">
                      {group === 'seasonal' && (themeOption.mode === 'light' ? <Sun size={11} /> : <Moon size={11} />)}
                      {group === 'seasonal' && (themeOption.mode === 'light' ? 'Light' : 'Dark')}
                      {group === 'seasonal' && isPaired && ' · '}
                      {isPaired && 'System pairing'}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1 rounded-full border border-white/50 dark:border-gray-700/60 bg-white/70 dark:bg-gray-900/60 px-2 py-1">
                  {themeOption.preview.map((swatch, index) => (
                    <span
                      key={index}
                      className="h-4 w-4 rounded-full border border-black/5 dark:border-white/10"
                      style={{ backgroundColor: `rgb(${swatch})` }}
                    />
                  ))}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </DisplaySection>
  );
}

import { useState } from 'react';
import { Sun, Moon, Monitor, Ruler, Check, AlertCircle, Loader2 } from 'lucide-react';
import { settings } from '../../api/client';
import { useTheme } from '../../contexts/ThemeContext';
import { SYSTEM_THEME_ID, THEME_GROUPS, getThemeDefinition } from '../../themes';

interface DisplayTabProps {
  initialDistanceUnit: 'metric' | 'imperial';
}

export function DisplayTab({ initialDistanceUnit }: DisplayTabProps) {
  const { theme: currentTheme, setTheme, systemThemeSelection } = useTheme();
  const [distanceUnit, setDistanceUnit] = useState(initialDistanceUnit);
  const [displaySaving, setDisplaySaving] = useState(false);
  const [displayMsg, setDisplayMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const saveDisplay = async () => {
    setDisplaySaving(true);
    setDisplayMsg(null);
    try {
      await settings.update({ distance_unit: distanceUnit });
      setDisplayMsg({ type: 'success', text: 'Display settings saved.' });
    } catch (err) {
      setDisplayMsg({ type: 'error', text: err instanceof Error ? err.message : 'Failed to save.' });
    } finally {
      setDisplaySaving(false);
    }
  };

  return (
    <>
      {/* Appearance Section */}
      <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/[0.03] p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <Sun size={20} className="text-primary-600" />
          Appearance
        </h2>
        <button
          onClick={() => setTheme(SYSTEM_THEME_ID)}
          className={`w-full rounded-2xl border p-4 text-left transition-all ${currentTheme === SYSTEM_THEME_ID
            ? 'bg-primary-50/80 dark:bg-primary-900/30 border-primary-300 dark:border-primary-700 shadow-sm'
            : 'bg-white/50 dark:bg-gray-800/50 border-gray-200/60 dark:border-gray-700/60 hover:bg-gray-50 dark:hover:bg-gray-700/50'
            }`}
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

        <div className="grid gap-4 md:grid-cols-2">
          {THEME_GROUPS.map(({ mode, label, themes }) => (
            <div key={mode} className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300">
                  {mode === 'light' ? <Sun size={16} className="text-amber-500" /> : <Moon size={16} className="text-primary-400" />}
                  {label}
                </div>
              </div>
              <div className="space-y-2">
                {themes.map((themeOption) => {
                  const isSelected = currentTheme === themeOption.id;
                  return (
                    <button
                      key={themeOption.id}
                      onClick={() => setTheme(themeOption.id)}
                      className={`w-full rounded-2xl border p-2 text-left transition-all ${isSelected
                        ? 'bg-primary-50/80 dark:bg-primary-900/30 border-primary-300 dark:border-primary-700 shadow-sm'
                        : 'bg-white/50 dark:bg-gray-800/50 border-gray-200/60 dark:border-gray-700/60 hover:bg-gray-50 dark:hover:bg-gray-700/50'
                        }`}
                    >
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
                          {themeOption.label}
                        </div>
                        <div className="flex items-center gap-1 rounded-full border border-white/50 dark:border-gray-700/60 bg-white/70 dark:bg-gray-900/60 px-2.5 py-1.5">
                          {themeOption.preview.map((swatch, index) => (
                            <span
                              key={index}
                              className="h-5 w-5 rounded-full border border-black/5 dark:border-white/10"
                              style={{ backgroundColor: `rgb(${swatch})` }}
                            />
                          ))}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Distance Units Section */}
      <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/[0.03] p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <Ruler size={20} className="text-primary-600" />
          Distance Units
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Choose how distances are shown across the app.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {([
            { value: 'metric' as const, label: 'Metric', hint: 'Meters and kilometers (m, km)' },
            { value: 'imperial' as const, label: 'Imperial', hint: 'Feet and miles (ft, mi)' },
          ]).map(({ value, label, hint }) => (
            <button
              key={value}
              onClick={() => setDistanceUnit(value)}
              className={`flex flex-col items-start gap-1 p-3 rounded-xl border transition-all text-sm font-medium ${distanceUnit === value
                ? 'bg-primary-50 dark:bg-primary-900/30 border-primary-300 dark:border-primary-700 text-primary-700 dark:text-primary-400 shadow-sm'
                : 'bg-white/50 dark:bg-gray-800/50 border-gray-200/60 dark:border-gray-700/60 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/50'
                }`}
            >
              <span>{label}</span>
              <span className="text-xs font-normal opacity-80">{hint}</span>
            </button>
          ))}
        </div>

        {displayMsg && (
          <div className={`flex items-center gap-2 text-sm ${displayMsg.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
            {displayMsg.type === 'success' ? <Check size={16} /> : <AlertCircle size={16} />}
            {displayMsg.text}
          </div>
        )}
        <button onClick={saveDisplay} disabled={displaySaving} className="btn-primary">
          {displaySaving ? <Loader2 size={16} className="animate-spin mr-2" /> : null}
          Save Display Settings
        </button>
      </div>
    </>
  );
}

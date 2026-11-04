import { useState } from 'react';
import { Ruler, Check, AlertCircle, Loader2, RotateCcw } from 'lucide-react';
import { settings } from '../../api/client';
import { useTheme } from '../../contexts/ThemeContext';
import { AppearancePreview } from './display/AppearancePreview';
import { ThemesSection } from './display/ThemesSection';
import { BackgroundSection } from './display/BackgroundSection';
import { TypographySection } from './display/TypographySection';
import { SurfacesSection } from './display/SurfacesSection';
import { AccessibilitySection } from './display/AccessibilitySection';
import { MapChartSection } from './display/MapChartSection';

interface DisplayTabProps {
  initialDistanceUnit: 'metric' | 'imperial';
  onSaved?: (patch: { distance_unit: 'metric' | 'imperial' }) => void;
}

export function DisplayTab({ initialDistanceUnit, onSaved }: DisplayTabProps) {
  const { resetAppearance } = useTheme();
  const [distanceUnit, setDistanceUnit] = useState(initialDistanceUnit);
  const [displaySaving, setDisplaySaving] = useState(false);
  const [displayMsg, setDisplayMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const saveDisplay = async () => {
    setDisplaySaving(true);
    setDisplayMsg(null);
    try {
      await settings.update({ distance_unit: distanceUnit });
      onSaved?.({ distance_unit: distanceUnit });
      setDisplayMsg({ type: 'success', text: 'Display settings saved.' });
    } catch (err) {
      setDisplayMsg({ type: 'error', text: err instanceof Error ? err.message : 'Failed to save.' });
    } finally {
      setDisplaySaving(false);
    }
  };

  const confirmReset = () => {
    if (window.confirm('Reset fonts, text size, shapes, surfaces, background, map, chart and comfort options to their defaults? Your theme stays as it is, and a wallpaper photo is kept but hidden.')) {
      resetAppearance();
    }
  };

  return (
    <>
      <div className="z-10 sm:sticky sm:top-[4.25rem]">
        <AppearancePreview />
      </div>

      <ThemesSection />
      <TypographySection />
      <SurfacesSection />
      <BackgroundSection />
      <MapChartSection />
      <AccessibilitySection />

      <div className="flex justify-end">
        <button type="button" onClick={confirmReset} className="btn-secondary gap-2">
          <RotateCcw size={16} />
          Reset appearance
        </button>
      </div>

      {/* Distance Units Section */}
      <div className="bg-white/60 dark:bg-gray-900/60 rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3 p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <Ruler size={20} className="text-primary-600" />
          Distance Units
        </h2>

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

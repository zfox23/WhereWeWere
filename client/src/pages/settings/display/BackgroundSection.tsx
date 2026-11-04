import { Layers } from 'lucide-react';
import { useTheme } from '../../../contexts/ThemeContext';
import { BG_PATTERN_OPTIONS, BG_GRADIENT_OPTIONS, BG_GRADIENT_PREVIEWS, BG_MOTION_OPTIONS } from '../../../themes';
import { OptionPicker } from './OptionPicker';
import { WallpaperControls } from './WallpaperControls';
import { DisplaySection } from './DisplaySection';

const selectedClass = 'bg-primary-50 dark:bg-primary-900/30 border-primary-300 dark:border-primary-700 shadow-sm';
const idleClass = 'bg-white/50 dark:bg-gray-800/50 border-gray-200/60 dark:border-gray-700/60 hover:bg-gray-50 dark:hover:bg-gray-700/50';

export function BackgroundSection() {
  const { appearance, setAppearance } = useTheme();
  const patternLabel = BG_PATTERN_OPTIONS.find((o) => o.id === appearance.bgPattern)?.label;
  const gradientLabel = BG_GRADIENT_OPTIONS.find((o) => o.id === appearance.bgGradient)?.label;
  const motionLabel = appearance.bgMotion === 'none'
    ? undefined
    : BG_MOTION_OPTIONS.find((o) => o.id === appearance.bgMotion)?.label;

  return (
    <DisplaySection
      id="background"
      title="Background"
      icon={Layers}
      summary={[appearance.wallpaper === 'on' ? 'Photo' : undefined, patternLabel, gradientLabel, motionLabel].filter(Boolean).join(' · ')}
    >
      <WallpaperControls />

      <h3 className="text-sm font-semibold font-sans tracking-normal text-gray-700 dark:text-gray-300">Pattern</h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {BG_PATTERN_OPTIONS.map((option) => {
          const isSelected = appearance.bgPattern === option.id;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => setAppearance({ bgPattern: option.id })}
              aria-pressed={isSelected}
              className={`flex flex-col items-start gap-2 p-3 rounded-xl border transition-all text-left ${isSelected ? selectedClass : idleClass}`}
            >
              {/* Pattern preview swatch */}
              <div
                className="w-full h-10 rounded-lg border border-black/5 dark:border-white/10"
                style={{
                  backgroundColor: 'rgb(255 250 246)',
                  backgroundImage: option.previewStyle.backgroundImage,
                  backgroundSize: option.previewStyle.backgroundSize,
                }}
              />
              <div className={`text-xs font-semibold ${isSelected ? 'text-primary-700 dark:text-primary-400' : 'text-gray-700 dark:text-gray-200'}`}>
                {option.label}
              </div>
              {option.description && (
                <div className="text-[11px] leading-tight text-gray-400 dark:text-gray-500">{option.description}</div>
              )}
            </button>
          );
        })}
      </div>

      <h3 className="text-sm font-semibold font-sans tracking-normal text-gray-700 dark:text-gray-300">Gradient</h3>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {BG_GRADIENT_OPTIONS.map((option) => {
          const isSelected = appearance.bgGradient === option.id;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => setAppearance({ bgGradient: option.id })}
              aria-pressed={isSelected}
              className={`flex flex-col items-start gap-2 p-3 rounded-xl border transition-all text-left ${isSelected ? selectedClass : idleClass}`}
            >
              {/* Gradient preview swatch */}
              <div
                className="w-full h-12 rounded-lg border border-black/5 dark:border-white/10"
                style={{ backgroundImage: BG_GRADIENT_PREVIEWS[option.id] }}
              />
              <div className="space-y-0.5">
                <div className={`text-xs font-semibold ${isSelected ? 'text-primary-700 dark:text-primary-400' : 'text-gray-700 dark:text-gray-200'}`}>
                  {option.label}
                </div>
                <div className="text-[11px] text-gray-400 dark:text-gray-500 leading-tight">
                  {option.description}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <OptionPicker
        label="Motion"
        hint={appearance.reduceMotion === 'on'
          ? 'Reduce motion is on (Comfort), so this stays still.'
          : 'Gentle animation behind everything. Stays still when your device asks for reduced motion.'}
        options={BG_MOTION_OPTIONS}
        value={appearance.bgMotion}
        onChange={(bgMotion) => setAppearance({ bgMotion })}
        columns={3}
      />
    </DisplaySection>
  );
}

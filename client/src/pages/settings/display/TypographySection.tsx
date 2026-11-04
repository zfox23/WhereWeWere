import { useEffect } from 'react';
import { Type } from 'lucide-react';
import { useTheme } from '../../../contexts/ThemeContext';
import { FONT_OPTIONS, TEXT_SIZE_OPTIONS, labelFor, loadFontPairing } from '../../../appearance';
import { DisplaySection } from './DisplaySection';
import { OptionPicker } from './OptionPicker';

const TEXT_SIZE_SAMPLE: Record<string, string> = { s: '0.8rem', m: '0.875rem', l: '0.95rem', xl: '1.05rem' };

export function TypographySection() {
  const { appearance, setAppearance } = useTheme();

  // The samples below are drawn in each pairing's own fonts.
  useEffect(() => {
    for (const option of FONT_OPTIONS) void loadFontPairing(option.id);
  }, []);

  return (
    <DisplaySection
      id="typography"
      title="Typography"
      icon={Type}
      summary={`${labelFor(FONT_OPTIONS, appearance.font)} · ${labelFor(TEXT_SIZE_OPTIONS, appearance.textSize)}`}
    >
      <div role="radiogroup" aria-label="Font pairing" className="space-y-2">
        <div className="text-sm font-semibold text-gray-700 dark:text-gray-300">Font pairing</div>
        <div className="grid gap-2 sm:grid-cols-2">
          {FONT_OPTIONS.map((option) => {
            const isSelected = appearance.font === option.id;
            return (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={isSelected}
                aria-label={`${option.label} font pairing`}
                onClick={() => setAppearance({ font: option.id })}
                className={`rounded-xl border p-3 text-left transition-all ${isSelected
                  ? 'bg-primary-50 dark:bg-primary-900/30 border-primary-300 dark:border-primary-700 shadow-sm'
                  : 'bg-white/50 dark:bg-gray-800/50 border-gray-200/60 dark:border-gray-700/60 hover:bg-gray-50 dark:hover:bg-gray-700/50'
                  }`}
              >
                <div
                  className="text-xl leading-tight text-gray-900 dark:text-gray-100"
                  style={{ fontFamily: option.heading, fontWeight: option.headingWeight }}
                >
                  Lisbon, in the rain
                </div>
                <div className="mt-1 text-sm text-gray-600 dark:text-gray-300" style={{ fontFamily: option.body }}>
                  Coffee at the corner café, then the long walk home.
                </div>
                <div className="mt-2 flex items-baseline justify-between gap-2">
                  <span className={`text-xs font-semibold ${isSelected ? 'text-primary-700 dark:text-primary-300' : 'text-gray-700 dark:text-gray-200'}`}>
                    {option.label}
                  </span>
                  <span className="truncate text-[11px] text-gray-500 dark:text-gray-400">{option.description}</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <OptionPicker
        label="Text size"
        hint="Scales text and spacing across the app."
        options={TEXT_SIZE_OPTIONS}
        value={appearance.textSize}
        onChange={(textSize) => setAppearance({ textSize })}
        renderPreview={(option) => (
          <span className="font-semibold leading-none" style={{ fontSize: TEXT_SIZE_SAMPLE[option.id] }} aria-hidden="true">
            Aa
          </span>
        )}
      />
    </DisplaySection>
  );
}

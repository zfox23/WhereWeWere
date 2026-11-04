import type { ReactNode } from 'react';
import type { AppearanceOption } from '../../../appearance';

const selectedClass = 'bg-primary-50 dark:bg-primary-900/30 border-primary-300 dark:border-primary-700 text-primary-700 dark:text-primary-300 shadow-sm';
const idleClass = 'bg-white/50 dark:bg-gray-800/50 border-gray-200/60 dark:border-gray-700/60 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700/50';

interface OptionPickerProps<V extends string> {
  /** Accessible group name, also shown as the sub-heading. */
  label: string;
  hint?: string;
  options: AppearanceOption<V>[];
  value: V;
  onChange: (value: V) => void;
  /** Optional visual above each option's label. */
  renderPreview?: (option: AppearanceOption<V>) => ReactNode;
  /** Grid columns at sm+ (defaults to one per option, max 4). */
  columns?: 2 | 3 | 4;
}

const COLS: Record<2 | 3 | 4, string> = {
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-3',
  4: 'sm:grid-cols-4',
};

/** A labelled row of single-choice buttons for one appearance knob. */
export function OptionPicker<V extends string>({
  label,
  hint,
  options,
  value,
  onChange,
  renderPreview,
  columns,
}: OptionPickerProps<V>) {
  const cols = columns ?? (Math.min(Math.max(options.length, 2), 4) as 2 | 3 | 4);
  return (
    <div role="radiogroup" aria-label={label} className="space-y-2">
      <div>
        <div className="text-sm font-semibold text-gray-700 dark:text-gray-300">{label}</div>
        {hint && <div className="text-xs text-gray-500 dark:text-gray-400">{hint}</div>}
      </div>
      <div className={`grid grid-cols-2 ${COLS[cols]} gap-2`}>
        {options.map((option) => {
          const isSelected = option.id === value;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => onChange(option.id)}
              className={`flex flex-col items-start gap-1.5 rounded-xl border p-2.5 text-left transition-all ${isSelected ? selectedClass : idleClass}`}
            >
              {renderPreview?.(option)}
              <span className="text-xs font-semibold">{option.label}</span>
              {option.description && (
                <span className="text-[11px] leading-tight text-gray-500 dark:text-gray-400">{option.description}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

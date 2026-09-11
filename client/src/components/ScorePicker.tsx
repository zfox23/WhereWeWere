import { Star } from 'lucide-react';

interface ScorePickerProps {
  value: number; // 0-4
  onChange: (value: number) => void;
  disabled?: boolean;
}

/**
 * 0-4 star score picker. Clicking a star sets the score to that value;
 * clicking the current top star again clears it to 0.
 */
export default function ScorePicker({ value, onChange, disabled }: ScorePickerProps) {
  return (
    <div className="flex items-center gap-1" role="radiogroup" aria-label="Score (0-4 stars)">
      {[1, 2, 3, 4].map((star) => {
        const active = star <= value;
        return (
          <button
            key={star}
            type="button"
            role="radio"
            aria-checked={value === star}
            aria-label={`${star} star${star > 1 ? 's' : ''}`}
            disabled={disabled}
            onClick={() => onChange(active && value === star ? 0 : star)}
            className={`transition-transform hover:scale-110 disabled:opacity-50 disabled:hover:scale-100 ${active ? 'text-amber-400' : 'text-gray-300 dark:text-gray-600'}`}
          >
            <Star size={28} fill={active ? 'currentColor' : 'none'} strokeWidth={1.5} />
          </button>
        );
      })}
      {value > 0 && (
        <span className="ml-2 text-sm font-medium text-gray-600 dark:text-gray-300">{value}/4</span>
      )}
      {value === 0 && <span className="ml-2 text-sm text-gray-400">No rating</span>}
    </div>
  );
}

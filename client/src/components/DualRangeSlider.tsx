interface DualRangeSliderProps {
  min: number;
  max: number;
  /** Step between values; defaults to 1. */
  step?: number;
  /** Minimum distance the handles must stay apart; defaults to 0. */
  minGap?: number;
  lowValue: number;
  highValue: number;
  onLowChange: (value: number) => void;
  onHighChange: (value: number) => void;
  /** Accessibility labels for the two thumbs. */
  lowLabel?: string;
  highLabel?: string;
  /** Optional captions rendered under the track's left/right ends. */
  minLabel?: string;
  maxLabel?: string;
  className?: string;
}

/**
 * Dual-handle range slider built from two stacked native range inputs over a
 * shared track. The inputs are click-through with only the thumbs interactive
 * (see `.dual-range` in index.css), so both handles can be dragged.
 *
 * `lowValue` is clamped to `[min, highValue - minGap]` and `highValue` to
 * `[lowValue + minGap, max]`, so the handles can never cross.
 */
export default function DualRangeSlider({
  min,
  max,
  step = 1,
  minGap = 0,
  lowValue,
  highValue,
  onLowChange,
  onHighChange,
  lowLabel,
  highLabel,
  minLabel,
  maxLabel,
  className = '',
}: DualRangeSliderProps) {
  const span = Math.max(1, max - min);
  const lowPct = ((lowValue - min) / span) * 100;
  const highPct = ((highValue - min) / span) * 100;

  return (
    <div className={className}>
      <div className="relative h-5 select-none">
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-gray-200 dark:bg-gray-700" />
        <div
          className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-indigo-500"
          style={{ left: `${lowPct}%`, width: `${Math.max(0, highPct - lowPct)}%` }}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={lowValue}
          onChange={(e) => {
            const value = Number(e.target.value);
            if (Number.isNaN(value)) return;
            onLowChange(Math.min(Math.max(min, value), highValue - minGap));
          }}
          aria-label={lowLabel ?? 'Range start'}
          className="dual-range z-10"
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={highValue}
          onChange={(e) => {
            const value = Number(e.target.value);
            if (Number.isNaN(value)) return;
            onHighChange(Math.min(Math.max(lowValue + minGap, value), max));
          }}
          aria-label={highLabel ?? 'Range end'}
          className="dual-range z-20"
        />
      </div>
      {(minLabel || maxLabel) && (
        <div className="mt-1 flex justify-between text-[11px] text-gray-500 dark:text-gray-400">
          <span>{minLabel}</span>
          <span>{maxLabel}</span>
        </div>
      )}
    </div>
  );
}

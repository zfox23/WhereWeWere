import { Star } from 'lucide-react';

interface StarsProps {
  value: number;
  size?: number;
  max?: number; // number of star positions (default 4)
}

/** Read-only star display (default 0-4 scale). */
export default function Stars({ value, size = 14, max = 4 }: StarsProps) {
  const clamped = Math.max(0, Math.min(max, Math.round(value)));
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${clamped} of ${max} stars`}>
      {Array.from({ length: max }, (_, i) => i + 1).map((star) => (
        <Star
          key={star}
          size={size}
          className={star <= value ? 'text-amber-400' : 'text-gray-200 dark:text-gray-700'}
          fill={star <= value ? 'currentColor' : 'none'}
          strokeWidth={1.5}
        />
      ))}
    </span>
  );
}

import { Star } from 'lucide-react';

interface StarsProps {
  value: number; // 0-4
  size?: number;
}

/** Read-only 0-4 star display. */
export default function Stars({ value, size = 14 }: StarsProps) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${value} of 4 stars`}>
      {[1, 2, 3, 4].map((star) => (
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

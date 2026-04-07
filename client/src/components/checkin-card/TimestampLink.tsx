import { Link } from 'react-router-dom';
import { formatDate, formatTime } from '../../utils/checkin';

interface TimestampLinkProps {
  to: string;
  checkedInAt: string;
  timezone?: string | null;
  mode?: 'full' | 'time';
}

export function TimestampLink({ to, checkedInAt, timezone, mode = 'full' }: TimestampLinkProps) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap mt-4">
      <Link
        to={to}
        className="text-xs font-medium text-gray-600 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
        title={checkedInAt}
      >
        <time dateTime={checkedInAt}>
          {mode === 'time' ? formatTime(checkedInAt, timezone) : formatDate(checkedInAt, timezone)}
        </time>
      </Link>
    </div>
  );
}
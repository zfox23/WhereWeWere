/**
 * AutoProfileTab — the default Profile tab for check-in plugins. Shows the
 * total number of check-ins of this type and the most recent one. Plugins
 * can replace this with richer stats.
 */

import { useEffect, useState } from 'react';
import { Loader2, Smile } from 'lucide-react';
import { Link } from 'react-router-dom';
import { plugins, type GenericCheckin } from './api';
import { StatCard } from '../components/Stats';
import { formatDate } from '../utils/checkin';
import { timelineDetailPath } from './registry';

export function AutoProfileTab({ pluginId }: { pluginId: string }) {
  const [total, setTotal] = useState<number | null>(null);
  const [latest, setLatest] = useState<GenericCheckin | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    plugins.checkins
      .list(pluginId, { limit: '500' })
      .then((rows) => {
        setTotal(rows.length);
        setLatest(rows[0] ?? null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'));
  }, [pluginId]);

  if (error) {
    return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>;
  }

  if (total === null) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <StatCard icon={Smile} label="Check-ins" value={total.toLocaleString()} />

      {latest && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white/60 dark:bg-gray-900/60 p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Most recent
          </div>
          <div className="mt-1 text-sm text-gray-700 dark:text-gray-300">
            {formatDate(latest.checked_in_at, latest.checkin_timezone)}
          </div>
          <Link
            to={timelineDetailPath({ type: pluginId, id: latest.id })}
            className="mt-1 inline-block text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline"
          >
            View
          </Link>
        </div>
      )}
    </div>
  );
}

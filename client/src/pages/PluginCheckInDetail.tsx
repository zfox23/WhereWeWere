/**
 * Generic plugin check-in detail page: /checkins/:pluginId/:id
 *
 * Rendered for check-in plugins that do not ship their own `detailPage`.
 * Shows the stored fields as a label/value list plus the note, with links
 * to edit (the plugin's check-in route) and back to the timeline.
 */

import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Loader2, Pencil } from 'lucide-react';
import { plugins, type GenericCheckin } from '../plugins/api';
import { getClientPlugin } from '../plugins/registry';
import { autoChips } from '../plugins/autoCard';
import { formatDate, formatTime } from '../utils/checkin';

export default function PluginCheckInDetail() {
  const { pluginId, id } = useParams<{ pluginId: string; id: string }>();
  const plugin = pluginId ? getClientPlugin(pluginId) : undefined;

  const [row, setRow] = useState<GenericCheckin | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!pluginId || !id) return;
    plugins.checkins
      .get(pluginId, id)
      .then(setRow)
      .catch((err) => {
        if (String(err.message).includes('404') || String(err.message).includes('not found')) {
          setNotFound(true);
        } else {
          setError(err instanceof Error ? err.message : 'Failed to load');
        }
      });
  }, [pluginId, id]);

  if (!plugin) {
    return (
      <div className="py-16 text-center text-sm text-gray-500 dark:text-gray-400">
        Unknown check-in type.
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="py-16 text-center text-sm text-gray-500 dark:text-gray-400">
        Check-in not found.
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-16 text-center text-sm text-red-600 dark:text-red-400">{error}</div>
    );
  }

  if (!row) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }

  const data = row.data ?? {};
  const chips = autoChips(plugin.fields, data);
  const note = typeof row.data?.note === 'string' && (row.data.note as string).length > 0
    ? (row.data.note as string)
    : null;

  const editPath = plugin.client.checkInPath.replace(':id', row.id) === plugin.client.checkInPath
    ? `${plugin.client.checkInPath}?edit=${row.id}`
    : plugin.client.checkInPath.replace(':id', row.id);

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        to="/"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400"
      >
        <ArrowLeft size={16} />
        Back to timeline
      </Link>

      <div className="mt-4 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white/60 dark:bg-gray-900/60 p-6">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {plugin.strings.title}
          </h1>
          <Link
            to={editPath}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 hover:border-primary-400"
          >
            <Pencil size={14} />
            Edit
          </Link>
        </div>

        <div className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {formatDate(row.checked_in_at, row.checkin_timezone)} · {formatTime(row.checked_in_at, row.checkin_timezone)}
        </div>

        {chips.length > 0 && (
          <dl className="mt-5 space-y-3">
            {chips.map((chip) => (
              <div key={chip.label} className="flex items-start gap-3">
                <dt className="w-32 shrink-0 text-sm font-medium text-gray-500 dark:text-gray-400">
                  {chip.label}
                </dt>
                <dd className="text-sm text-gray-900 dark:text-gray-100">{chip.value}</dd>
              </div>
            ))}
          </dl>
        )}

        {note && (
          <div className="mt-5 border-t border-gray-200 dark:border-gray-700 pt-4">
            <div className="text-sm font-medium text-gray-500 dark:text-gray-400">Note</div>
            <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-300">{note}</p>
          </div>
        )}
      </div>
    </div>
  );
}

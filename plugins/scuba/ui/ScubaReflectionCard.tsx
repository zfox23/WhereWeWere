/**
 * SCUBA "this day in previous years" reflection card.
 *
 * Rendered by the core ReflectTab's generic plugin `reflectionCard` slot for
 * reflection entries of type 'scuba'. The typed payload arrives in
 * `item.data` (built by the server's `reflectionBranch`).
 */

import { Waves } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { PluginReflectionCardProps } from 'wwp-shared';
import { pluginDetailPath } from '../../../client/src/plugins/registry';

interface ScubaReflectionData {
  place?: string | null;
  city?: string | null;
  depth?: number | null;
  bottom_time?: number | null;
}

export function ScubaReflectionCard({ item }: PluginReflectionCardProps) {
  const data = (item.data ?? {}) as ScubaReflectionData;
  const site = [data.place, data.city].filter(Boolean).join(', ');
  const bits = [
    data.depth != null ? `to ${data.depth} m` : null,
    data.bottom_time != null ? `${data.bottom_time} min` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Link
      to={pluginDetailPath('scuba', item.id)}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 text-xs font-medium text-cyan-700 dark:text-cyan-400 hover:text-cyan-800 dark:hover:text-cyan-300 transition-colors"
    >
      <Waves size={13} className="shrink-0" />
      <span>
        Dived {site || 'a dive'}
        {bits ? ` (${bits})` : ''}
      </span>
    </Link>
  );
}

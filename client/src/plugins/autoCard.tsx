/**
 * AutoCheckInCard — the default timeline card for check-in plugins that do
 * not ship their own `timelineCard`. Renders the plugin's fields as
 * compact label/value chips derived from the stored `data` JSONB.
 */

import type { CheckinCardProps, PluginField, CheckinTypeClient } from 'wwp-shared';
import { Link } from 'react-router-dom';
import { CardShell } from '../components/checkin-card/CardShell';
import { MarkdownNote } from '../components/checkin-card/MarkdownNote';
import { timelineDetailPath } from './registry';

/**
 * Renders a plugin's timeline card: the plugin's own `timelineCard` when
 * provided, otherwise the auto-generated one from the manifest fields.
 */
export function PluginTimelineCard({
  item,
  plugin,
  integrations,
  compact = false,
  photos,
  scrobbles,
  iconPack,
}: {
  item: CheckinCardProps['item'];
  plugin: CheckinTypeClient;
  integrations: Record<string, string | null>;
  compact?: boolean;
  photos?: CheckinCardProps['photos'];
  scrobbles?: CheckinCardProps['scrobbles'];
  iconPack?: string;
}) {
  const CardComponent = plugin.client.timelineCard ?? AutoCheckInCard;
  return (
    <CardComponent
      item={item}
      integrations={integrations}
      compact={compact}
      fields={plugin.fields}
      photos={photos}
      scrobbles={scrobbles}
      iconPack={iconPack}
    />
  );
}

function fieldDisplayValue(field: PluginField, value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (field.options) {
    const opt = field.options.find((o) => String(o.value) === String(value));
    return opt ? (opt.icon ? `${opt.icon} ${opt.label}`.trim() : opt.label) : String(value);
  }
  if (field.kind === 'number' || field.kind === 'integer' || field.kind === 'rating') {
    const num = Number(value);
    return Number.isFinite(num) ? String(num) : null;
  }
  if (field.kind === 'boolean') {
    return value ? 'Yes' : 'No';
  }
  if (field.kind === 'multi-select') {
    if (!Array.isArray(value) || value.length === 0) return null;
    return value.map(String).join(', ');
  }
  const text = String(value);
  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
}

/**
 * Build the list of display chips for a stored data object. When `fields`
 * is null (e.g. custom-storage plugins without a matching schema), simple
 * scalar entries are shown generically.
 */
export function autoChips(fields: PluginField[] | null, data: Record<string, unknown>): { label: string; value: string }[] {
  const chips: { label: string; value: string }[] = [];
  if (fields) {
    for (const field of fields) {
      const text = fieldDisplayValue(field, data[field.name]);
      if (text) chips.push({ label: field.label, value: text });
    }
  } else {
    for (const [key, value] of Object.entries(data)) {
      if (typeof value === 'string' || typeof value === 'number') {
        const text = String(value);
        chips.push({ label: key, value: text.length > 40 ? `${text.slice(0, 37)}...` : text });
      }
    }
  }
  return chips;
}

export function AutoCheckInCard({ item, compact = false, fields = null }: CheckinCardProps) {
  const data = (item.data ?? {}) as Record<string, unknown>;
  const chips = autoChips(fields, data);
  const detailTo = timelineDetailPath(item as { type: string; id: string });
  const note = typeof item.notes === 'string' && item.notes.length > 0 ? item.notes : null;

  if (compact) {
    return (
      <CardShell compact>
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-semibold truncate">{item.type}</span>
          {chips.slice(0, 2).map((chip) => (
            <span key={chip.label} className="hidden sm:inline text-xs text-gray-500 dark:text-gray-400 truncate">
              · {chip.value}
            </span>
          ))}
          <Link
            to={detailTo}
            className="ml-auto text-xs text-gray-500 dark:text-gray-400 hover:text-primary-600 shrink-0"
          >
            {new Date(item.checked_in_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          </Link>
        </div>
      </CardShell>
    );
  }

  return (
    <CardShell>
      <div className="flex items-center gap-2 min-w-0">
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 truncate">{item.type}</h3>
        <Link
          to={detailTo}
          className="ml-auto text-xs font-medium text-gray-600 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400"
        >
          {new Date(item.checked_in_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
        </Link>
      </div>

      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {chips.map((chip) => (
            <span
              key={chip.label}
              className="inline-flex items-center gap-1 rounded-full bg-gray-100 dark:bg-gray-800 px-2.5 py-0.5 text-xs text-gray-700 dark:text-gray-300"
            >
              <span className="text-gray-500 dark:text-gray-500">{chip.label}:</span>
              <span className="font-medium">{chip.value}</span>
            </span>
          ))}
        </div>
      )}

      {note && (
        <div className="mt-2 text-sm text-gray-700 dark:text-gray-300">
          <MarkdownNote note={note} />
        </div>
      )}
    </CardShell>
  );
}

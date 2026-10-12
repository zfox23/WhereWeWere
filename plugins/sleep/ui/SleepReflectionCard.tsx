/**
 * Sleep "this day in previous years" reflection card.
 *
 * Rendered by the core ReflectTab's generic plugin `reflectionCard` slot for
 * reflection entries of type 'sleep'. The typed payload arrives in
 * `item.data` (built by the server's `reflectionBranch`).
 */

import { Moon } from 'lucide-react';
import type { PluginReflectionCardProps } from 'wwp-shared';
import { ReflectionCard } from '../../../client/src/components/reflection/ReflectionCard';

interface SleepReflectionData {
  started_at?: string | null;
  ended_at?: string | null;
  sleep_timezone?: string | null;
}

function formatSleepDuration(startedAt: string, endedAt: string): string {
  const mins = Math.max(0, Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 60000));
  const hours = Math.floor(mins / 60);
  const rest = mins % 60;
  if (hours === 0) return `${rest}m`;
  if (rest === 0) return `${hours}h`;
  return `${hours}h ${rest}m`;
}

export function SleepReflectionCard({ item }: PluginReflectionCardProps) {
  const data = (item.data ?? {}) as SleepReflectionData;
  const startedAt = data.started_at;
  const endedAt = data.ended_at;
  if (!startedAt || !endedAt) return null;

  return (
    <ReflectionCard
      to={`/sleep-entries/${item.id}`}
      icon={<Moon size={13} className="shrink-0 text-indigo-500" />}
      title={`Slept for ${formatSleepDuration(startedAt, endedAt)}`}
      checkedInAt={startedAt}
      timezone={data.sleep_timezone}
    />
  );
}

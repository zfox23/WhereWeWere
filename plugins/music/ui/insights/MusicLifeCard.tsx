/**
 * "Soundtrack of your life": what you played around your other check-ins,
 * by the companion you were with, the kind of place you were at, or the mood
 * you logged. Pick a group to see its top artists and songs, either most
 * played or most distinctive (played there more than usual).
 */

import { useEffect, useMemo, useState } from 'react';
import { Headphones } from 'lucide-react';
import { MOOD_LABELS } from '../../../mood/ui/MoodIcons';
import { music } from '../api';
import { joinArtists } from '../format';
import { ArtistLink, SongLink } from '../links';
import type { LifeBy, LifeGroup, LifeItem, LifeSoundtrack } from '../types';
import { ChartCard, Toggle } from './ChartCard';

const TABS: { value: LifeBy; label: string }[] = [
  { value: 'companion', label: 'Companions' },
  { value: 'place', label: 'Places' },
  { value: 'mood', label: 'Mood' },
];

const EMPTY: Record<LifeBy, string> = {
  companion: 'Add companions to check-ins to see what you play with whom.',
  place: 'Check in at places (with a category) to see what you play where.',
  mood: 'Log moods to see what you play when you feel a certain way.',
};

const SHOWN = 5;
/** Below this, "distinctive" is noise (one play is a big share of a small group). */
const MIN_DISTINCTIVE_PLAYS = 2;

type Order = 'played' | 'distinctive';

export function groupLabel(by: LifeBy, group: Pick<LifeGroup, 'key' | 'label'>): string {
  if (by === 'mood') return MOOD_LABELS[Number(group.key)] || group.label;
  return group.label;
}

/** The items to show: most played as served, or by lift among those played enough and more than usual. */
export function rankItems<T extends LifeItem>(items: T[], order: Order): T[] {
  if (order === 'played') return items.slice(0, SHOWN);
  return items
    .filter((i) => i.plays >= MIN_DISTINCTIVE_PLAYS && i.lift > 1)
    .sort((a, b) => b.lift - a.lift || b.plays - a.plays)
    .slice(0, SHOWN);
}

function ItemList({
  title,
  items,
  order,
  view,
  detail,
}: {
  title: string;
  items: (LifeItem & { artists?: string[] })[];
  order: Order;
  view: 'songs' | 'artists';
  detail?: (i: LifeItem & { artists?: string[] }) => string;
}) {
  const shown = rankItems(items, order);
  const max = Math.max(...shown.map((i) => i.plays), 1);
  return (
    <div className="min-w-0">
      <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">{title}</h4>
      {shown.length === 0 ? (
        <p className="text-xs text-gray-500">
          {order === 'distinctive' ? 'Nothing stands out here yet.' : 'Nothing yet.'}
        </p>
      ) : (
        <ol className="space-y-2">
          {shown.map((i) => (
            <li key={`${i.name}|${detail?.(i) ?? ''}`} className="text-sm">
              <div className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate text-gray-900 dark:text-gray-100">
                  {view === 'songs' ? (
                    <SongLink songKey={(i as { song_key?: string }).song_key}>{i.name}</SongLink>
                  ) : (
                    <ArtistLink name={i.name} />
                  )}
                  {detail && <span className="text-xs text-gray-500 dark:text-gray-400"> · {detail(i)}</span>}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-gray-500">
                  {order === 'distinctive' ? `${i.lift.toFixed(1)}× · ${i.plays}` : i.plays}
                </span>
              </div>
              <div className="mt-0.5 h-1 rounded-full bg-gray-100 dark:bg-gray-800">
                <div className="h-1 rounded-full bg-pink-400/80" style={{ width: `${(i.plays / max) * 100}%` }} />
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function MusicLifeCard({ from, to }: { from?: string; to?: string }) {
  const [by, setBy] = useState<LifeBy>('companion');
  const [data, setData] = useState<LifeSoundtrack | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [order, setOrder] = useState<Order>('played');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    music
      .lifeSoundtrack(by, from, to)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setError(false);
      })
      .catch(() => !cancelled && setError(true))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [by, from, to]);

  const groups = data?.groups ?? [];
  // Keep the chosen group while it is still there; otherwise the biggest.
  const group = useMemo(() => groups.find((g) => g.key === selected) ?? groups[0] ?? null, [groups, selected]);

  return (
    <ChartCard
      title="Soundtrack of your life"
      icon={Headphones}
      loading={loading}
      controls={<Toggle label="Group by" value={by} onChange={setBy} options={TABS} />}
    >
      {error ? (
        <p className="text-xs text-red-500">Couldn't load this.</p>
      ) : groups.length === 0 ? (
        !loading && <p className="text-xs text-gray-500">{EMPTY[by]}</p>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Groups">
            {groups.map((g) => (
              <button
                key={g.key}
                type="button"
                aria-pressed={group?.key === g.key}
                onClick={() => setSelected(g.key)}
                className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
                  group?.key === g.key
                    ? 'border-pink-500 bg-pink-50 text-pink-700 dark:bg-pink-900/30 dark:text-pink-200'
                    : 'border-gray-200 text-gray-600 hover:border-pink-300 dark:border-gray-700 dark:text-gray-300'
                }`}
              >
                {groupLabel(by, g)} <span className="tabular-nums text-gray-400">{g.plays}</span>
              </button>
            ))}
          </div>
          {group && (
            <>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {group.plays.toLocaleString()} play{group.plays === 1 ? '' : 's'} within {data!.gap_minutes} min of{' '}
                  {group.checkins.toLocaleString()} check-in{group.checkins === 1 ? '' : 's'}
                </p>
                <Toggle
                  label="Order"
                  value={order}
                  onChange={setOrder}
                  options={[
                    { value: 'played', label: 'Most played' },
                    { value: 'distinctive', label: 'Most distinctive' },
                  ]}
                />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <ItemList title="Artists" items={group.top_artists} order={order} view="artists" />
                <ItemList title="Songs" items={group.top_songs} order={order} view="songs" detail={(i) => joinArtists(i.artists)} />
              </div>
            </>
          )}
        </>
      )}
    </ChartCard>
  );
}

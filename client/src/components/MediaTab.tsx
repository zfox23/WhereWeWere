import { useEffect, useMemo, useState } from 'react';
import { Loader2, Film, List, Plus, Tv, Gamepad2, BookOpen, Dices, Pencil, Trash2, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { media } from '../api/client';
import { PeriodRangeSelector } from './PeriodRangeSelector';
import { StatCard } from './Stats';
import { MediaLibrarySection } from './MediaLibrarySection';
import Stars from './Stars';
import {
  PeriodMode,
  getCurrentMonthIso,
  getPeriodDateRange,
  isValidDateParam,
  isValidMonthParam,
  parsePeriodParam,
} from '../utils/periodRange';
import { MEDIA_SUBTYPES } from '../utils/media';
import { slugify } from '../utils/slugify';
import type { MediaList, MediaStats } from '../types';

function getMediaMonthFromLocation(): string {
  const monthParam = new URLSearchParams(window.location.search).get('mediaMonth');
  return isValidMonthParam(monthParam) ? monthParam : getCurrentMonthIso();
}

function getMediaPeriodFromLocation(): PeriodMode {
  return parsePeriodParam(new URLSearchParams(window.location.search).get('mediaPeriod')) ?? 'single';
}

function getMediaWeekFromLocation(): string {
  const weekParam = new URLSearchParams(window.location.search).get('mediaWeek');
  return isValidDateParam(weekParam) ? weekParam : getCurrentMonthIso().slice(0, 4) + '-01-01';
}

function MediaListsSection() {
  const [lists, setLists] = useState<MediaList[]>([]);
  const [loading, setLoading] = useState(true);
  const [newListName, setNewListName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const refresh = () => {
    media.lists()
      .then(setLists)
      .catch(() => setLists([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    refresh();
  }, []);

  const handleCreate = async () => {
    const name = newListName.trim();
    if (!name) return;
    try {
      await media.createList(name);
      setNewListName('');
      refresh();
    } catch (err) {
      console.error('Failed to create list:', err);
    }
  };

  const handleRename = async (id: string) => {
    const name = renameValue.trim();
    if (!name) return;
    try {
      await media.renameList(id, name);
      setRenamingId(null);
      refresh();
    } catch (err) {
      console.error('Failed to rename list:', err);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`Delete list "${name}"? Items are kept in your library.`)) return;
    try {
      await media.deleteList(id);
      refresh();
    } catch (err) {
      console.error('Failed to delete list:', err);
    }
  };

  const handleRemoveItem = async (listId: string, itemId: string) => {
    try {
      await media.removeItemFromList(listId, itemId);
      refresh();
    } catch (err) {
      console.error('Failed to remove item from list:', err);
    }
  };

  if (loading) {
    return (
      <div className="bg-white/60 dark:bg-gray-900/60 rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3 p-4">
        <p className="text-sm text-gray-400">Loading lists…</p>
      </div>
    );
  }

  return (
    <div className="bg-white/60 dark:bg-gray-900/60 rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
          <List size={16} className="text-violet-500" />
          Lists
        </h3>
      </div>

      <div className="flex gap-2 mb-4">
        <input
          type="text"
          value={newListName}
          onChange={(e) => setNewListName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
          placeholder="New list name (e.g. Watchlist, To Read)"
          className="flex-1 px-3 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
        />
        <button
          type="button"
          onClick={handleCreate}
          disabled={!newListName.trim()}
          className="px-3 py-2 text-sm font-medium bg-primary-500 hover:bg-primary-600 text-white rounded-xl disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <Plus size={16} className="inline mr-1" />
          Add
        </button>
      </div>

      {lists.length === 0 ? (
        <p className="text-sm text-gray-400">
          No lists yet. Create one here, or use “Add to List” on any media detail page.
        </p>
      ) : (
        <div className="space-y-4">
          {lists.map((list) => (
            <div key={list.id} className="border border-gray-200 dark:border-gray-700/60 rounded-xl p-3">
              <div className="flex items-center gap-2 mb-2">
                {renamingId === list.id ? (
                  <>
                    <input
                      type="text"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleRename(list.id);
                        if (e.key === 'Escape') setRenamingId(null);
                      }}
                      autoFocus
                      className="flex-1 px-2 py-1 text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-primary-500 outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => handleRename(list.id)}
                      className="text-xs text-primary-600 hover:text-primary-700 font-medium"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setRenamingId(null)}
                      className="text-gray-400 hover:text-gray-600"
                      aria-label="Cancel rename"
                    >
                      <X size={14} />
                    </button>
                  </>
                ) : (
                  <>
                    <span className="flex-1 text-sm font-medium text-gray-700 dark:text-gray-300">{list.name}</span>
                    <span className="text-xs text-gray-400">{list.items.length} item{list.items.length === 1 ? '' : 's'}</span>
                    <button
                      type="button"
                      onClick={() => {
                        setRenamingId(list.id);
                        setRenameValue(list.name);
                      }}
                      className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                      aria-label={`Rename ${list.name}`}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(list.id, list.name)}
                      className="text-gray-400 hover:text-red-500"
                      aria-label={`Delete ${list.name}`}
                    >
                      <Trash2 size={14} />
                    </button>
                  </>
                )}
              </div>

              {list.items.length === 0 ? (
                <p className="text-xs text-gray-400">
                  Empty. Use “Add to List” on a media detail page to add items.
                </p>
              ) : (
                <ul className="space-y-1">
                  {list.items.map((item) => {
                    const config = MEDIA_SUBTYPES[item.media_type] || MEDIA_SUBTYPES.movie;
                    const href = `${config.detailBase}/${item.id}/${item.title ? slugify(item.title) : ''}`;
                    return (
                      <li key={item.id} className="flex items-center gap-2">
                        <Link
                          to={href}
                          className="flex items-center gap-2 min-w-0 flex-1 text-xs text-gray-600 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400"
                        >
                          {item.image_url ? (
                            <img src={item.image_url} alt="" className="w-6 h-8 object-cover rounded" loading="lazy" />
                          ) : (
                            <span className="w-6 h-8 rounded bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-sm">{config.icon}</span>
                          )}
                          <span className="truncate">
                            {item.title}
                            {item.author ? <span className="text-gray-400"> — {item.author}</span> : null}
                          </span>
                        </Link>
                        <button
                          type="button"
                          onClick={() => handleRemoveItem(list.id, item.id)}
                          className="text-gray-300 hover:text-red-500"
                          aria-label={`Remove ${item.title} from ${list.name}`}
                        >
                          <X size={14} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function MediaTab() {
  const [periodMode, setPeriodMode] = useState<PeriodMode>(getMediaPeriodFromLocation);
  const [selectedMonth, setSelectedMonth] = useState<string>(getMediaMonthFromLocation);
  const [selectedWeek, setSelectedWeek] = useState<string>(getMediaWeekFromLocation);
  const [year, setYear] = useState(() => parseInt(getMediaMonthFromLocation().slice(0, 4), 10));
  const [loading, setLoading] = useState(true);
  const [initialLoaded, setInitialLoaded] = useState(false);
  const [statsData, setStatsData] = useState<MediaStats | null>(null);

  const visibleRange = useMemo(
    () => getPeriodDateRange(selectedMonth, periodMode, selectedWeek),
    [selectedMonth, periodMode, selectedWeek]
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    media
      .stats(visibleRange.from || undefined, visibleRange.to || undefined)
      .then((data) => {
        if (cancelled) return;
        setStatsData(data);
      })
      .catch((err) => {
        console.error('Failed to load media stats:', err);
        if (cancelled) return;
        setStatsData(null);
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
          setInitialLoaded(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [visibleRange.from, visibleRange.to]);

  useEffect(() => {
    const syncStateFromLocation = () => {
      setSelectedMonth(getMediaMonthFromLocation());
      setSelectedWeek(getMediaWeekFromLocation());
      setPeriodMode(getMediaPeriodFromLocation());
    };

    syncStateFromLocation();
    window.addEventListener('popstate', syncStateFromLocation);
    window.addEventListener('hashchange', syncStateFromLocation);

    return () => {
      window.removeEventListener('popstate', syncStateFromLocation);
      window.removeEventListener('hashchange', syncStateFromLocation);
    };
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    let changed = false;

    if (url.searchParams.get('tab') !== 'media') {
      url.searchParams.set('tab', 'media');
      changed = true;
    }
    if (url.searchParams.get('mediaMonth') !== selectedMonth) {
      url.searchParams.set('mediaMonth', selectedMonth);
      changed = true;
    }
    if (url.searchParams.get('mediaPeriod') !== periodMode) {
      url.searchParams.set('mediaPeriod', periodMode);
      changed = true;
    }
    if (url.searchParams.get('mediaWeek') !== selectedWeek) {
      url.searchParams.set('mediaWeek', selectedWeek);
      changed = true;
    }

    if (changed) {
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    }
  }, [periodMode, selectedMonth, selectedWeek]);

  if (!initialLoaded) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-primary-600" size={32} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <PeriodRangeSelector
          periodMode={periodMode}
          onPeriodModeChange={setPeriodMode}
          year={year}
          onYearChange={setYear}
          selectedMonth={selectedMonth}
          onSelectedMonthChange={setSelectedMonth}
          selectedWeek={selectedWeek}
          onSelectedWeekChange={setSelectedWeek}
          onOpenHome={() => {
            if (visibleRange.from && visibleRange.to) {
              window.open(`/?from=${visibleRange.from}&to=${visibleRange.to}`, '_blank', 'noopener,noreferrer');
            } else {
              window.open('/', '_blank', 'noopener,noreferrer');
            }
          }}
        />
      </div>

      <div className="grid grid-cols-2 gap-1.5 md:grid-cols-5 md:gap-3">
        <StatCard icon={Tv} label="TV Episodes" value={statsData?.tv_episodes_completed ?? 0} />
        <StatCard icon={Film} label="Movies" value={statsData?.movies_watched ?? 0} />
        <StatCard icon={BookOpen} label="Books" value={statsData?.books_completed ?? 0} />
        <StatCard icon={Gamepad2} label="Games" value={statsData?.games_completed ?? 0} />
        <StatCard icon={Dices} label="Board Games" value={statsData?.board_games_completed ?? 0} />
      </div>

      <MediaLibrarySection from={visibleRange.from} to={visibleRange.to} />
      <div className="grid md:grid-cols-2 gap-4">
        <MediaListsSection />
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Link2, Loader2, Plus, EyeOff, Undo2 } from 'lucide-react';
import { media, steam } from './api';
import type { MediaLibraryItem, SteamGame, SteamStatus } from './types';
import { formatTimePlayed } from '../utils/media';

type Tab = 'unmatched' | 'ignored';

/** Search the user's games and pick one to link a Steam game to. */
function LinkPicker({ initialQuery, onPick, onCancel }: {
  initialQuery: string;
  onPick: (itemId: string) => void;
  onCancel: () => void;
}) {
  const [q, setQ] = useState(initialQuery);
  const [rows, setRows] = useState<MediaLibraryItem[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      media
        .library(undefined, undefined, ['game'], { q: q.trim(), limit: 8, sort: 'title', dir: 'asc' })
        .then((r) => { if (!cancelled) setRows(r.rows); })
        .catch(() => { if (!cancelled) setRows([]); });
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q]);

  return (
    <div className="mt-2 rounded-lg border border-gray-200 dark:border-gray-700 p-2 space-y-1">
      <input
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="input"
        placeholder="Search your games"
        aria-label="Search your games"
      />
      {rows === null ? (
        <p className="text-xs text-gray-400 px-1">Searching…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-gray-400 px-1">No games match.</p>
      ) : (
        rows.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => onPick(r.id)}
            className="block w-full text-left text-sm px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-800 dark:text-gray-200"
          >
            {r.title}
          </button>
        ))
      )}
      <button type="button" onClick={onCancel} className="text-xs text-gray-500 hover:underline px-1">
        Cancel
      </button>
    </div>
  );
}

/**
 * Steam games the sync couldn't match to a library game. Each can be added
 * to the library, linked to an existing game, or ignored (remembered across
 * syncs; ignored games can be restored from the Ignored tab).
 */
export function SteamReview({ status, onChange }: { status: SteamStatus; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('unmatched');
  const [includeUnplayed, setIncludeUnplayed] = useState(false);
  const [games, setGames] = useState<SteamGame[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [linking, setLinking] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setGames(null);
    steam
      .games(tab, includeUnplayed)
      .then((g) => { if (!cancelled) setGames(g); })
      .catch((err) => { if (!cancelled) { setGames([]); setError(err instanceof Error ? err.message : 'Failed to load.'); } });
    return () => { cancelled = true; };
  }, [open, tab, includeUnplayed]);

  const act = async (appid: number, run: () => Promise<unknown>) => {
    setBusy(appid);
    setError(null);
    try {
      await run();
      setGames((g) => g?.filter((x) => x.appid !== appid) ?? null);
      setLinking(null);
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(null);
    }
  };

  const heading = status.unmatched > 0
    ? `${status.unmatched} Steam game${status.unmatched === 1 ? '' : 's'} need review`
    : 'Review Steam games';

  return (
    <div className="mt-4 rounded-xl border border-gray-200 dark:border-gray-700">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300"
        aria-expanded={open}
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {heading}
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2">
          <div className="flex flex-wrap items-center gap-3 text-xs">
            {(['unmatched', 'ignored'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => { setTab(t); setLinking(null); }}
                className={`px-2 py-1 rounded-md ${tab === t ? 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100' : 'text-gray-500'}`}
              >
                {t === 'unmatched' ? 'To review' : `Ignored (${status.ignored})`}
              </button>
            ))}
            {tab === 'unmatched' && (
              <label className="flex items-center gap-1.5 text-gray-500">
                <input type="checkbox" checked={includeUnplayed} onChange={(e) => setIncludeUnplayed(e.target.checked)} />
                Show never-played games
              </label>
            )}
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          {games === null ? (
            <div className="flex justify-center py-3"><Loader2 size={16} className="animate-spin text-gray-400" /></div>
          ) : games.length === 0 ? (
            <p className="text-xs text-gray-400">Nothing here.</p>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-gray-800 max-h-96 overflow-y-auto">
              {games.map((g) => (
                <li key={g.appid} className="py-2">
                  <div className="flex items-center gap-2">
                    {g.icon_url ? (
                      <img src={g.icon_url} alt="" className="w-6 h-6 rounded shrink-0" loading="lazy" />
                    ) : (
                      <div className="w-6 h-6 rounded bg-gray-200 dark:bg-gray-700 shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <a
                        href={`https://store.steampowered.com/app/${g.appid}`}
                        target="_blank"
                        rel="noreferrer"
                        className="block truncate text-sm text-gray-800 dark:text-gray-200 hover:underline"
                      >
                        {g.name}
                      </a>
                      <p className="text-[11px] text-gray-400">{formatTimePlayed(g.playtime_minutes) ?? 'Never played'}</p>
                    </div>
                    {busy === g.appid ? (
                      <Loader2 size={14} className="animate-spin text-gray-400" />
                    ) : tab === 'unmatched' ? (
                      <div className="flex gap-1 shrink-0">
                        <button type="button" title="Add to library" aria-label={`Add ${g.name} to library`}
                          onClick={() => act(g.appid, () => steam.add(g.appid))}
                          className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300">
                          <Plus size={14} />
                        </button>
                        <button type="button" title="Link to a game in your library" aria-label={`Link ${g.name}`}
                          onClick={() => setLinking(linking === g.appid ? null : g.appid)}
                          className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300">
                          <Link2 size={14} />
                        </button>
                        <button type="button" title="Ignore" aria-label={`Ignore ${g.name}`}
                          onClick={() => act(g.appid, () => steam.ignore(g.appid))}
                          className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300">
                          <EyeOff size={14} />
                        </button>
                      </div>
                    ) : (
                      <button type="button" title="Back to review" aria-label={`Unignore ${g.name}`}
                        onClick={() => act(g.appid, () => steam.unignore(g.appid))}
                        className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300">
                        <Undo2 size={14} />
                      </button>
                    )}
                  </div>
                  {linking === g.appid && (
                    <LinkPicker
                      initialQuery={g.name}
                      onCancel={() => setLinking(null)}
                      onPick={(itemId) => act(g.appid, () => steam.link(g.appid, itemId))}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

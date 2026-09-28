import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MEDIA_SUBTYPES, MEDIA_SUBTYPE_LIST } from '../../utils/media';
import type { MediaSubtype } from '../../../../client/src/types';

/** Hotkey for each media check-in subtype on the landing page. */
const SUBTYPE_HOTKEYS: Record<MediaSubtype, string> = {
  movie: 'm',
  tv_show: 't',
  book: 'b',
  game: 'g',
  board_game: 'd',
};

export default function MediaCheckInLanding() {
  const navigate = useNavigate();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isEditable =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable;
      if (isEditable || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;

      const subtype = (Object.keys(SUBTYPE_HOTKEYS) as MediaSubtype[]).find(
        (s) => SUBTYPE_HOTKEYS[s] === e.key.toLowerCase(),
      );
      if (!subtype) return;
      e.preventDefault();
      navigate(MEDIA_SUBTYPES[subtype].searchPath);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [navigate]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <span className="text-2xl">🎬</span>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Media Check-In</h1>
      </div>

      <div className="grid gap-3 grid-cols-1">
        {MEDIA_SUBTYPE_LIST.map((subtype) => {
          const config = MEDIA_SUBTYPES[subtype];
          return (
            <Link
              key={subtype}
              to={config.searchPath}
              className="flex items-center gap-3 p-4 bg-white/60 dark:bg-gray-900/60 rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3 hover:bg-white dark:hover:bg-gray-800/60 transition-colors"
            >
              <span className="text-3xl">{config.icon}</span>
              <div>
                <div className="font-medium text-gray-900 dark:text-gray-100">{config.plural}</div>
                {config.apiName && (
                  <div className="text-xs text-gray-500 dark:text-gray-400">via {config.apiName}</div>
                )}
              </div>
              <kbd className="ml-auto text-xs font-mono bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 px-1 py-0.5 rounded border border-gray-200 dark:border-gray-600">
                {SUBTYPE_HOTKEYS[subtype].toUpperCase()}
              </kbd>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

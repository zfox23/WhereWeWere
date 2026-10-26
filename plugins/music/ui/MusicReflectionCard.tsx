/**
 * Reflect > On This Day: the most-played tracks of one past day, linking to
 * that day's listening sessions on the Home timeline.
 */

import { Link } from 'react-router-dom';
import { Music } from 'lucide-react';
import { joinArtists } from './format';
import type { ReflectTrack } from './types';

export function MusicReflectionCard({ date, tracks }: { date: string; tracks: ReflectTrack[] }) {
  if (tracks.length === 0) return null;
  return (
    <Link
      to={`/?from=${date}&to=${date}&music=sessions`}
      aria-label={`View listening sessions from ${date}`}
      className="block rounded-xl bg-white/50 dark:bg-gray-800/50 border border-gray-200/60 dark:border-gray-700/50 p-3 hover:bg-pink-50/60 dark:hover:bg-pink-900/20 transition-colors"
    >
      <div className="flex items-center gap-1.5 text-xs font-semibold text-pink-700 dark:text-pink-300 mb-1">
        <Music size={14} className="text-pink-500" />
        Most played
      </div>
      <ol className="space-y-0.5">
        {tracks.map((t, i) => (
          <li key={i} className="flex gap-2 text-xs text-gray-600 dark:text-gray-300">
            <span className="tabular-nums shrink-0 w-7 text-right font-semibold text-pink-600 dark:text-pink-400">{t.count}x</span>
            <span className="min-w-0 truncate">
              {t.title}
              <span className="text-gray-400 dark:text-gray-500">{' — '}{joinArtists(t.artists)}</span>
            </span>
          </li>
        ))}
      </ol>
    </Link>
  );
}

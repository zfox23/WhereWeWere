import { Link } from 'react-router-dom';
import { Music } from 'lucide-react';
import type { ListeningBefore } from '../types';

/** Router state that tells Home which listening session to reveal. */
export interface FocusSessionState {
  focusSession: string;
}

/**
 * The last few songs played on or before a check-in, as a footer on its
 * timeline card. When the session has earlier plays the oldest one fades out
 * downward to say there is more. Clicking anywhere on it jumps to the
 * listening session's own timeline card (expanded and highlighted).
 */
export function MusicPreview({ listening, compact = false }: { listening: ListeningBefore; compact?: boolean }) {
  const { session_id, session_date, tracks, has_more } = listening;
  if (tracks.length === 0) return null;

  const state: FocusSessionState = { focusSession: session_id };

  return (
    <Link
      to={{ pathname: '/', search: `?from=${session_date}&to=${session_date}` }}
      state={state}
      aria-label="Show this listening session on the timeline"
      className={`${compact ? 'mt-1.5' : 'mt-2'} flex items-start gap-1.5 rounded-md text-gray-500 dark:text-gray-400 hover:text-pink-600 dark:hover:text-pink-400 transition-colors`}
    >
      <Music size={compact ? 12 : 13} className="mt-0.5 shrink-0 text-pink-500" />
      <ul className="min-w-0 flex-1 space-y-0.5">
        {tracks.map((t, i) => {
          const faded = has_more && i === tracks.length - 1;
          return (
            <li
              key={`${t.time}-${t.title}`}
              data-faded={faded ? 'true' : undefined}
              className="truncate text-xs"
              style={
                faded
                  ? {
                      maskImage: 'linear-gradient(to bottom, #000 0%, transparent 100%)',
                      WebkitMaskImage: 'linear-gradient(to bottom, #000 0%, transparent 100%)',
                    }
                  : undefined
              }
            >
              <span className="font-medium text-gray-600 dark:text-gray-300">{t.artists.join(', ')}</span>
              {' — '}
              {t.title}
            </li>
          );
        })}
      </ul>
    </Link>
  );
}

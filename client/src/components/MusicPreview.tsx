import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Music } from 'lucide-react';
import { ArtistLinks, HomeLibraryLink } from '../../../plugins/music/ui/libraryLinks';
import type { ListeningBefore } from '../types';

/** Router state that tells Home which listening session to reveal. */
export interface FocusSessionState {
  focusSession: string;
}

type Track = ListeningBefore['tracks'][number];

function trackText(t: Track): string {
  return `${t.artists.join(', ')} — ${t.title}`;
}

/**
 * What was playing just before a check-in, as a one-line footer on its
 * timeline card: the last song, plus a "+N" toggle that lists the songs
 * before it. Text only; covers live on the listening session's own card.
 * Clicking anywhere on it jumps to that card (expanded and highlighted). The
 * footer is a clickable block with a real link (the music icon) for keyboard
 * users.
 */
export function MusicPreview({ listening, compact = false }: { listening: ListeningBefore; compact?: boolean }) {
  const { session_id, session_date, tracks } = listening;
  const [expanded, setExpanded] = useState(false);
  const navigate = useNavigate();
  if (tracks.length === 0) return null;

  const to = { pathname: '/', search: `?from=${session_date}&to=${session_date}` };
  const state: FocusSessionState = { focusSession: session_id };
  const earlier = tracks.slice(1);
  const shown = expanded ? tracks : tracks.slice(0, 1);

  return (
    <div
      onClick={() => navigate(to, { state })}
      className={`${compact ? 'mt-1.5' : 'mt-2'} flex cursor-pointer items-start gap-1.5 rounded-md text-xs text-gray-500 dark:text-gray-400 hover:text-pink-600 dark:hover:text-pink-400 transition-colors`}
    >
      <Link
        to={to}
        state={state}
        aria-label="Show this listening session on the timeline"
        onClick={(e) => e.stopPropagation()}
        className="mt-px shrink-0"
      >
        <Music size={compact ? 12 : 13} className="text-pink-500" />
      </Link>
      <ul className="min-w-0 flex-1 space-y-0.5">
        {shown.map((t) => (
          <li key={`${t.time}-${t.title}`} className="truncate">
            <span className="font-medium text-gray-600 dark:text-gray-300"><ArtistLinks artists={t.artists} /></span>
            {' — '}
            <HomeLibraryLink view="songs" q={t.title}>{t.title}</HomeLibraryLink>
          </li>
        ))}
      </ul>
      {earlier.length > 0 && (
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={expanded ? 'Show only the last song' : `Show ${earlier.length} earlier song${earlier.length === 1 ? '' : 's'}`}
          title={expanded ? undefined : earlier.map(trackText).join('\n')}
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(!expanded);
          }}
          className="shrink-0 rounded px-1 tabular-nums text-gray-400 hover:text-pink-600 dark:hover:text-pink-400"
        >
          {expanded ? 'less' : `+${earlier.length}`}
        </button>
      )}
    </div>
  );
}

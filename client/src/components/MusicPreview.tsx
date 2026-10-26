import { Link, useNavigate } from 'react-router-dom';
import { Music } from 'lucide-react';
import { AlbumArt } from '../../../plugins/music/ui/AlbumArt';
import { ArtistLinks, HomeLibraryLink } from '../../../plugins/music/ui/libraryLinks';
import type { ListeningBefore } from '../types';

/** Router state that tells Home which listening session to reveal. */
export interface FocusSessionState {
  focusSession: string;
}

/**
 * The last few songs played on or before a check-in, as a footer on its
 * timeline card. When the session has earlier plays the oldest one fades out
 * downward to say there is more. Clicking anywhere on it jumps to the
 * listening session's own timeline card (expanded and highlighted), except a
 * cover, which opens the album instead. The footer is a clickable block with
 * a real link (the music icon) for keyboard users, because a cover is a button
 * and can't sit inside a link.
 */
export function MusicPreview({ listening, compact = false }: { listening: ListeningBefore; compact?: boolean }) {
  const { session_id, session_date, tracks, has_more } = listening;
  if (tracks.length === 0) return null;

  const navigate = useNavigate();
  const to = { pathname: '/', search: `?from=${session_date}&to=${session_date}` };
  const state: FocusSessionState = { focusSession: session_id };

  return (
    <div
      onClick={() => navigate(to, { state })}
      className={`${compact ? 'mt-1.5' : 'mt-2'} flex cursor-pointer items-start gap-1.5 rounded-md text-gray-500 dark:text-gray-400 hover:text-pink-600 dark:hover:text-pink-400 transition-colors`}
    >
      <Link
        to={to}
        state={state}
        aria-label="Show this listening session on the timeline"
        onClick={(e) => e.stopPropagation()}
        className="mt-0.5 shrink-0"
      >
        <Music size={compact ? 12 : 13} className="text-pink-500" />
      </Link>
      <ul className="min-w-0 flex-1 space-y-0.5">
        {tracks.map((t, i) => {
          const faded = has_more && i === tracks.length - 1;
          return (
            <li
              key={`${t.time}-${t.title}`}
              data-faded={faded ? 'true' : undefined}
              className="flex items-center gap-1.5 text-xs"
              style={
                faded
                  ? {
                      maskImage: 'linear-gradient(to bottom, #000 0%, transparent 100%)',
                      WebkitMaskImage: 'linear-gradient(to bottom, #000 0%, transparent 100%)',
                    }
                  : undefined
              }
            >
              <AlbumArt artId={t.art_id} size={compact ? 18 : 20} />
              <span className="min-w-0 truncate">
                <span className="font-medium text-gray-600 dark:text-gray-300"><ArtistLinks artists={t.artists} /></span>
                {' — '}
                <HomeLibraryLink view="songs" q={t.title}>{t.title}</HomeLibraryLink>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

import { Music } from 'lucide-react';
import type { Scrobble } from '../types';
import { formatMalojaDate, buildMalojaTrackUrl } from '../utils/checkin';

interface ScrobbleListProps {
  scrobbles: Scrobble[];
  checkedInAt: string;
  malojaUrl?: string | null;
}

export function ScrobbleList({ scrobbles, checkedInAt, malojaUrl }: ScrobbleListProps) {
  if (scrobbles.length === 0) return null;

  return (
    <div className="mt-2 flex items-start gap-1.5">
      {malojaUrl ? (
        <a
          href={`${malojaUrl}/scrobbles?in=${formatMalojaDate(checkedInAt)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-gray-400 mt-0.5 shrink-0 hover:text-primary-500 transition-colors"
        >
          <Music size={13} />
        </a>
      ) : (
        <Music size={13} className="text-gray-400 mt-0.5 shrink-0" />
      )}
      <div className="flex flex-wrap gap-x-3 gap-y-0.5">
        {scrobbles.map((s, i) => (
          <span key={i} className="text-xs text-gray-500 dark:text-gray-400">
            {malojaUrl ? (
              <>
                {s.artists.map((artist, j) => (
                  <span key={j}>
                    {j > 0 && ', '}
                    <a
                      href={buildMalojaTrackUrl(malojaUrl, [artist])}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-gray-600 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
                    >
                      {artist}
                    </a>
                  </span>
                ))}
              </>
            ) : (
              <span className="font-medium text-gray-600 dark:text-gray-300">{s.artists.join(', ')}</span>
            )}
            {' \u2014 '}
            {malojaUrl ? (
              <a
                href={buildMalojaTrackUrl(malojaUrl, s.artists, s.title)}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
              >
                {s.title}
              </a>
            ) : (
              s.title
            )}
          </span>
        ))}
      </div>
    </div>
  );
}

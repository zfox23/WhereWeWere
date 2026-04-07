import { Music } from 'lucide-react';
import { formatMalojaDate, buildMalojaTrackUrl } from '../utils/checkin';

interface Scrobble {
  artists: string[];
  title: string;
  time: number;
}

interface MalojaScrobbleStripProps {
  scrobbles: Scrobble[];
  date: string;
  malojaUrl: string;
}

export function MalojaScrobbleStrip({ scrobbles, date, malojaUrl }: MalojaScrobbleStripProps) {
  if (scrobbles.length === 0) return null;

  // Count frequency of each track (by artist + title combination)
  const trackFrequency = new Map<string, { scrobble: Scrobble; count: number }>();
  
  for (const scrobble of scrobbles) {
    const key = `${scrobble.artists.join(',')}|${scrobble.title}`;
    const existing = trackFrequency.get(key);
    if (existing) {
      existing.count++;
    } else {
      trackFrequency.set(key, { scrobble, count: 1 });
    }
  }

  // Sort by frequency (most played first)
  const topThree = Array.from(trackFrequency.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);

  return (
    <div className="mt-3 pt-2">
      <div className="flex items-start gap-2">
        <Music size={14} className="text-blue-500 mt-0.5 shrink-0" />
        <div className="flex flex-col gap-2 flex-1">
          <a
            href={`${malojaUrl}/scrobbles?in=${formatMalojaDate(date)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors hover:underline"
          >
            {scrobbles.length} scrobble{scrobbles.length !== 1 ? 's' : ''}
          </a>
          {topThree.map((item, idx) => {
            const scrobble = item.scrobble;
            return (
            <div key={idx} className="text-xs space-y-0">
              <div className="flex flex-wrap items-center gap-1">
                {scrobble.artists.map((artist, j) => (
                  <span key={j}>
                    {j > 0 && <span className="text-gray-400">, </span>}
                    <a
                      href={buildMalojaTrackUrl(malojaUrl, [artist])}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-gray-600 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                    >
                      {artist}
                    </a>
                  </span>
                ))}
                <span className="text-gray-400"> — </span>
                <a
                  href={buildMalojaTrackUrl(malojaUrl, scrobble.artists, scrobble.title)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gray-600 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                >
                  {scrobble.title}
                </a>
                <span className="text-gray-500 dark:text-gray-400">{item.count}x</span>
              </div>
            </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

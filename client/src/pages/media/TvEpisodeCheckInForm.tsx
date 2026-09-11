import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { media } from '../../api/client';
import type { MediaTvSeason } from '../../types';
import MediaCheckInForm from './MediaCheckInForm';

/**
 * Wrapper for the TV episode check-in form. Resolves the selected episode's
 * title from cached TMDB data, then renders the shared check-in form.
 */
export default function TvEpisodeCheckInForm() {
  const { id, season, episode } = useParams<{ id: string; season: string; episode: string }>();
  const [episodeTitle, setEpisodeTitle] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!id) {
      setReady(true);
      return;
    }
    let cancelled = false;
    (async () => {
      // Best-effort lookup of the episode title from cached TMDB data.
      try {
        const seasonsData = await media.tvSeasons(id);
        if (!cancelled) {
          const s = Number(season);
          const e = Number(episode);
          const seasonData: MediaTvSeason | undefined = seasonsData.seasons.find(
            (x) => x.season_number === s
          );
          const ep = seasonData?.episodes.find((x) => x.episode_number === e);
          setEpisodeTitle(ep?.episode_title ?? null);
        }
      } catch {
        // Title lookup is non-critical.
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => { cancelled = true; };
  }, [id, season, episode]);

  if (!ready) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-pulse text-gray-400 text-sm">Loading…</div>
      </div>
    );
  }

  return (
    <MediaCheckInForm
      subtype="tv_show"
      episodeMode={{
        seasonNumber: Number(season),
        episodeNumber: Number(episode),
        episodeTitle,
      }}
    />
  );
}

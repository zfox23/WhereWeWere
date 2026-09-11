import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Loader2, ArrowLeft, ChevronRight } from 'lucide-react';
import { media } from '../../api/client';
import type { MediaItem, MediaTvSeason } from '../../types';
import { slugify } from '../../utils/slugify';
import { usePageTitle } from '../../utils/pageTitle';

export default function TvEpisodePicker() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [item, setItem] = useState<MediaItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [seasons, setSeasons] = useState<MediaTvSeason[]>([]);
  const [selectedSeason, setSelectedSeason] = useState<number | null>(null);

  usePageTitle(`TV Episode Picker${item ? `: ${item.title}` : ''}`);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        const [showData, seasonsData] = await Promise.all([
          media.getItem(id),
          media.tvSeasons(id),
        ]);
        if (cancelled) return;
        setItem(showData);
        setSeasons(seasonsData.seasons);
        if (seasonsData.seasons.length > 0) {
          setSelectedSeason(seasonsData.seasons[0].season_number);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load show');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  const currentSeason = seasons.find((s) => s.season_number === selectedSeason) || null;

  const handleSelectEpisode = (episode: number, title: string | null) => {
    if (!item || selectedSeason == null) return;
    navigate(
      `/media-check-in/tv/${item.id}/${slugify(item.title)}/${selectedSeason}/${episode}`
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-primary-600" size={32} />
      </div>
    );
  }

  if (error || !item) {
    return (
      <div className="space-y-4">
        <button onClick={() => navigate('/media-check-in/tv-episode')} className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700">
          <ArrowLeft size={15} /> Back
        </button>
        <div className="text-red-600 dark:text-red-400">{error || 'Failed to load show'}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <button
        onClick={() => navigate('/media-check-in/tv-episode')}
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
      >
        <ArrowLeft size={15} /> Back
      </button>

      {/* Show header */}
      <div className="flex gap-4">
        {item.image_url ? (
          <img src={item.image_url} alt={item.title} className="w-20 h-28 object-cover rounded-xl shadow-md shrink-0" />
        ) : (
          <div className="w-20 h-28 rounded-xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-3xl shrink-0">📺</div>
        )}
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 leading-tight">{item.title}</h1>
          {item.release_year && <p className="text-sm text-gray-500 dark:text-gray-400">{item.release_year}</p>}
          <p className="text-sm text-primary-600 dark:text-primary-400 mt-2">Select an episode to check in</p>
        </div>
      </div>

      {seasons.length === 0 ? (
        <div className="bg-white/60 dark:bg-gray-900/60 rounded-2xl border border-white/40 dark:border-gray-700/40 p-6 text-center text-gray-500">
          No season/episode data available. This may be because the TMDB API key is not set,
          or episode data hasn't been cached yet.
        </div>
      ) : (
        <div className="bg-white/60 dark:bg-gray-900/60 rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Choose a season</span>
            <select
              value={selectedSeason ?? ''}
              onChange={(e) => setSelectedSeason(Number(e.target.value))}
              className="input w-auto"
            >
              {seasons.map((s) => (
                <option key={s.season_number} value={s.season_number}>
                  {s.season_number === 0 ? 'Specials' : `Season ${s.season_number}`}
                </option>
              ))}
            </select>
          </div>
          <div className="divide-y divide-gray-50 dark:divide-gray-800/50">
            {currentSeason?.episodes.map((ep) => (
              <button
                key={ep.episode_number}
                onClick={() => handleSelectEpisode(ep.episode_number, ep.episode_title)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50/80 dark:hover:bg-gray-800/40 transition-colors text-left"
              >
                <span className="w-8 text-sm font-semibold text-gray-400 shrink-0">
                  E{ep.episode_number}
                </span>
                <span className="flex-1 text-sm font-medium text-gray-800 dark:text-gray-200 truncate">
                  {ep.episode_title || `Episode ${ep.episode_number}`}
                </span>
                <ChevronRight size={16} className="text-gray-300 shrink-0" />
              </button>
            ))}
            {(!currentSeason || currentSeason.episodes.length === 0) && (
              <div className="px-4 py-6 text-center text-sm text-gray-400">
                No episodes found for this season.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

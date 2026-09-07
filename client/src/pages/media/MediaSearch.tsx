import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Loader2, Plus, X, ExternalLink, Star, AlertTriangle } from 'lucide-react';
import { media } from '../../api/client';
import type { MediaSubtype, MediaSearchHit } from '../../types';
import { MEDIA_SUBTYPES } from '../../utils/media';
import { slugify } from '../../utils/slugify';
import Stars from '../../components/Stars';

interface MediaSearchProps {
  subtype: MediaSubtype;
}

export default function MediaSearch({ subtype }: MediaSearchProps) {
  const config = MEDIA_SUBTYPES[subtype];
  const navigate = useNavigate();

  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<MediaSearchHit[] | null>(null);
  const [degraded, setDegraded] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [showCustom, setShowCustom] = useState(false);
  const [customTitle, setCustomTitle] = useState('');
  const [customAuthor, setCustomAuthor] = useState('');
  const [customYear, setCustomYear] = useState('');
  const [customImageUrl, setCustomImageUrl] = useState('');
  const [savingCustom, setSavingCustom] = useState(false);

  const runSearch = async (q: string) => {
    if (!q.trim()) return;
    setSearching(true);
    setSearchError(null);
    try {
      const res = await media.search(subtype, q.trim());
      setResults(res.results);
      setDegraded(res.degraded);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Search failed');
      setResults(null);
    } finally {
      setSearching(false);
    }
  };

  const handleRowClick = async (hit: MediaSearchHit) => {
    // Ensure the entity exists locally (upsert API-sourced results once).
    let id = hit.local_id;
    if (!id && hit.external_id) {
      try {
        const item = await media.createItem({
          media_type: subtype,
          external_source: hit.external_source,
          external_id: hit.external_id,
          title: hit.title,
          author: hit.author,
          release_year: hit.release_year,
          image_url: hit.image_url,
          external_url: hit.external_url,
        });
        id = item.id;
      } catch (err) {
        console.error('Failed to upsert media item:', err);
        return;
      }
    }
    if (!id) return;
    const slug = slugify(hit.title);
    if (subtype === 'tv_show') {
      // Intermediate episode picker
      navigate(`/media-check-in/tv/${id}/${slug}`);
    } else {
      navigate(`${config.searchPath}/${id}/${slug}`);
    }
  };

  const handleAddCustom = async () => {
    if (!customTitle.trim()) return;
    setSavingCustom(true);
    try {
      const year = customYear ? parseInt(customYear, 10) : null;
      const item = await media.createItem({
        media_type: subtype,
        title: customTitle.trim(),
        author: subtype === 'book' ? customAuthor.trim() || null : null,
        release_year: Number.isFinite(year as number) ? year : null,
        image_url: customImageUrl.trim() || null,
      });
      setShowCustom(false);
      const slug = slugify(item.title);
      if (subtype === 'tv_show') {
        navigate(`/media-check-in/tv/${item.id}/${slug}`);
      } else {
        navigate(`${config.searchPath}/${item.id}/${slug}`);
      }
    } finally {
      setSavingCustom(false);
    }
  };

  const hasImage = (hit: MediaSearchHit) => Boolean(hit.image_url);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <span className="text-2xl">{config.icon}</span>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {config.plural} Check-In
        </h1>
      </div>

      {/* Search field */}
      <div className="relative">
        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') runSearch(query);
          }}
          placeholder={`Search for a ${config.label.toLowerCase()}…`}
          className="input pl-10"
          autoFocus
        />
        {searching && (
          <Loader2 size={18} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-gray-400" />
        )}
      </div>

      {degraded && results && (
        <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-lg px-3 py-2">
          <AlertTriangle size={14} />
          {config.apiName ? `${config.apiName} search unavailable (check your API key in Settings → Integrations); showing local results only.` : 'Local results only.'}
        </div>
      )}
      {searchError && (
        <div className="text-sm text-red-600 dark:text-red-400">{searchError}</div>
      )}

      {/* Results table */}
      {results && (
        <div className="bg-white/60 dark:bg-gray-900/60 rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b border-gray-100 dark:border-gray-800">
                <th className="px-4 py-2.5 font-medium"></th>
                <th className="px-4 py-2.5 font-medium">Title</th>
                {subtype === 'book' && <th className="px-4 py-2.5 font-medium hidden md:table-cell">Author</th>}
                <th className="px-4 py-2.5 font-medium hidden sm:table-cell">Year</th>
                {config.apiName && <th className="px-4 py-2.5 font-medium hidden lg:table-cell">Source</th>}
                <th className="px-4 py-2.5 font-medium hidden md:table-cell">Last Watched</th>
                <th className="px-4 py-2.5 font-medium">My Rating</th>
              </tr>
            </thead>
            <tbody>
              {results.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-gray-400">
                    No {config.plural.toLowerCase()} found for “{query}”.
                  </td>
                </tr>
              )}
              {results.map((hit, idx) => (
                <tr
                  key={`${hit.external_source}-${hit.external_id || hit.local_id}-${idx}`}
                  onClick={() => handleRowClick(hit)}
                  className="border-b border-gray-50 dark:border-gray-800/50 last:border-0 cursor-pointer hover:bg-gray-50/80 dark:hover:bg-gray-800/40 transition-colors"
                >
                  <td className="px-4 py-2.5">
                    {hasImage(hit) ? (
                      <img
                        src={hit.image_url!}
                        alt=""
                        className="w-9 h-12 object-cover rounded-md shadow-sm"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-9 h-12 rounded-md bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-lg">
                        {config.icon}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2.5 font-medium text-gray-900 dark:text-gray-100">
                    {hit.title}
                    {hit.source !== 'local' && (
                      <span className="ml-2 text-[10px] uppercase tracking-wide text-gray-400">{hit.source}</span>
                    )}
                  </td>
                  {subtype === 'book' && (
                    <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400 hidden md:table-cell">{hit.author || '—'}</td>
                  )}
                  <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400 hidden sm:table-cell">
                    {hit.release_year ?? '—'}
                  </td>
                  {config.apiName && (
                    <td className="px-4 py-2.5 hidden lg:table-cell">
                      {hit.external_url ? (
                        <a
                          href={hit.external_url}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1 text-xs text-primary-600 hover:underline"
                        >
                          <span className="uppercase">{hit.external_source}</span>
                          <ExternalLink size={11} />
                        </a>
                      ) : '—'}
                    </td>
                  )}
                  <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400 hidden md:table-cell">
                    {hit.last_checkin_at
                      ? new Date(hit.last_checkin_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
                      : '—'}
                  </td>
                  <td className="px-4 py-2.5">
                    {hit.my_rating != null && hit.my_rating > 0 ? (
                      <Stars value={hit.my_rating} />
                    ) : (
                      <span className="text-gray-300 dark:text-gray-600">
                        <Star size={12} />
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {/* Add Custom row */}
              <tr
                onClick={() => setShowCustom((s) => !s)}
                className="cursor-pointer hover:bg-gray-50/80 dark:hover:bg-gray-800/40 transition-colors bg-gray-50/50 dark:bg-gray-800/20"
              >
                <td colSpan={7} className="px-4 py-3">
                  <span className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-600">
                    <Plus size={15} />
                    Add Custom
                  </span>
                </td>
              </tr>
            </tbody>
          </table>

          {/* Add Custom form */}
          {showCustom && (
            <div className="border-t border-gray-100 dark:border-gray-800 px-4 py-4 space-y-3 bg-gray-50/70 dark:bg-gray-800/30">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Add a custom {config.label.toLowerCase()}
                </span>
                <button onClick={() => setShowCustom(false)} className="text-gray-400 hover:text-gray-600">
                  <X size={16} />
                </button>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className={subtype === 'book' ? 'sm:col-span-2' : 'sm:col-span-3'}>
                  <label className="block text-xs text-gray-500 mb-1">Title *</label>
                  <input className="input" value={customTitle} onChange={(e) => setCustomTitle(e.target.value)} placeholder="Title" />
                </div>
                {subtype === 'book' && (
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Author</label>
                    <input className="input" value={customAuthor} onChange={(e) => setCustomAuthor(e.target.value)} placeholder="Author" />
                  </div>
                )}
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Release Year</label>
                  <input className="input" value={customYear} onChange={(e) => setCustomYear(e.target.value)} placeholder="e.g. 2020" inputMode="numeric" />
                </div>
                <div className={subtype === 'book' ? '' : 'sm:col-span-2'}>
                  <label className="block text-xs text-gray-500 mb-1">Image URL (optional)</label>
                  <input className="input" value={customImageUrl} onChange={(e) => setCustomImageUrl(e.target.value)} placeholder="https://…" />
                </div>
              </div>
              <button
                onClick={handleAddCustom}
                disabled={!customTitle.trim() || savingCustom}
                className="btn-primary"
              >
                {savingCustom && <Loader2 size={14} className="animate-spin mr-2" />}
                Save & Continue
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

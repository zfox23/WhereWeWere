import { useCallback, useEffect, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { immich as immichApi, timeline } from '../../../api/client';

interface CheckinPhotoPickerProps {
  onPick: (assetId: string) => void;
  onClose: () => void;
}

const PAGE = 30;

/**
 * A grid of Immich photos taken around recent check-ins (the same matching
 * the timeline uses), newest first, loaded a page of check-ins at a time.
 */
export function CheckinPhotoPicker({ onPick, onClose }: CheckinPhotoPickerProps) {
  const [assets, setAssets] = useState<{ id: string; originalFileName: string }[]>([]);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadMore = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const items = await timeline.list({ limit: String(PAGE), offset: String(offset) });
      if (items.length < PAGE) setDone(true);
      setOffset((o) => o + items.length);
      if (items.length === 0) return;
      const byCheckin = await immichApi.photosForCheckins(items.map((i: { id: string }) => i.id));
      setAssets((prev) => {
        const seen = new Set(prev.map((a) => a.id));
        const next = [...prev];
        for (const item of items) {
          for (const asset of byCheckin[item.id] ?? []) {
            if (!seen.has(asset.id)) {
              seen.add(asset.id);
              next.push(asset);
            }
          }
        }
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t load photos.');
    } finally {
      setLoading(false);
    }
  }, [offset]);

  // First page on open.
  useEffect(() => {
    void loadMore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-80 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Choose a check-in photo"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl border border-white/40 dark:border-gray-700/60 bg-white dark:bg-gray-900 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-200/70 dark:border-gray-700/60 px-4 py-3">
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Photos from your check-ins</div>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto p-4">
          {assets.length > 0 && (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {assets.map((asset) => (
                <button
                  key={asset.id}
                  type="button"
                  onClick={() => onPick(asset.id)}
                  className="aspect-square overflow-hidden rounded-lg hover:ring-2 hover:ring-primary-400 focus-visible:ring-2 focus-visible:ring-primary-500"
                  aria-label={`Use ${asset.originalFileName}`}
                >
                  <img
                    src={immichApi.thumbnailUrl(asset.id)}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                </button>
              ))}
            </div>
          )}

          {!loading && assets.length === 0 && !error && (
            <p className="py-6 text-center text-sm text-gray-500 dark:text-gray-400">
              {done
                ? 'No photos found. Photos come from Immich (Settings → Integrations), matched to your check-ins.'
                : 'No photos around these check-ins yet.'}
            </p>
          )}
          {error && <p className="py-2 text-center text-sm text-red-600">{error}</p>}

          <div className="mt-3 flex justify-center">
            {loading ? (
              <Loader2 size={20} className="animate-spin text-primary-600" />
            ) : !done && (
              <button type="button" onClick={() => void loadMore()} className="btn-secondary text-xs">
                Look further back
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

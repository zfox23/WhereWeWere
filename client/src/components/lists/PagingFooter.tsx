import { Loader2 } from 'lucide-react';

/** "Showing 100 of 4,312" with a Show more button while there are more. */
export function PagingFooter({
  shown, total, loadingMore, onMore,
}: { shown: number; total: number; loadingMore: boolean; onMore: () => void }) {
  if (shown === 0) return null;
  return (
    <div className="flex items-center justify-between gap-3 text-xs text-gray-500 dark:text-gray-400">
      <span>
        Showing {shown.toLocaleString()} of {total.toLocaleString()}
      </span>
      {shown < total && (
        <button type="button" onClick={onMore} disabled={loadingMore} className="btn-secondary inline-flex items-center gap-1.5 !py-1 text-xs">
          {loadingMore && <Loader2 size={12} className="animate-spin" />}
          Show more
        </button>
      )}
    </div>
  );
}

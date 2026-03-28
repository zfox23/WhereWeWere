import { useState, useEffect, useCallback } from 'react';
import { Calendar, Loader2 } from 'lucide-react';
import { checkins } from '../api/client';
import { CheckIn } from '../types';
import CheckInCard from '../components/CheckInCard';

const USER_ID = '00000000-0000-0000-0000-000000000001';
const PAGE_SIZE = 20;

function formatDateHeader(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function groupByDate(items: CheckIn[]): Record<string, CheckIn[]> {
  const groups: Record<string, CheckIn[]> = {};
  for (const item of items) {
    const dateKey = new Date(item.checked_in_at).toISOString().split('T')[0];
    if (!groups[dateKey]) {
      groups[dateKey] = [];
    }
    groups[dateKey].push(item);
  }
  return groups;
}

export default function History() {
  const [allCheckins, setAllCheckins] = useState<CheckIn[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [offset, setOffset] = useState(0);
  const [totalCount, setTotalCount] = useState<number | null>(null);

  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const fetchCheckins = useCallback(
    async (newOffset: number, append: boolean) => {
      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }
      setError(null);

      try {
        const params: Record<string, string> = {
          user_id: USER_ID,
          limit: String(PAGE_SIZE),
          offset: String(newOffset),
        };
        if (fromDate) params.from = fromDate;
        if (toDate) params.to = toDate;

        const data = await checkins.list(params);

        if (append) {
          setAllCheckins((prev) => [...prev, ...data]);
        } else {
          setAllCheckins(data);
        }

        setHasMore(data.length === PAGE_SIZE);
        setOffset(newOffset + data.length);

        if (!append) {
          setTotalCount(data.length < PAGE_SIZE ? data.length : null);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load check-ins');
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [fromDate, toDate]
  );

  useEffect(() => {
    setOffset(0);
    setAllCheckins([]);
    setHasMore(true);
    fetchCheckins(0, false);
  }, [fetchCheckins]);

  const handleLoadMore = () => {
    fetchCheckins(offset, true);
  };

  const handleDelete = async (id: string) => {
    try {
      await checkins.delete(id);
      setAllCheckins((prev) => prev.filter((c) => c.id !== id));
    } catch (err) {
      console.error('Failed to delete check-in:', err);
    }
  };

  const grouped = groupByDate(allCheckins);
  const sortedDates = Object.keys(grouped).sort(
    (a, b) => new Date(b).getTime() - new Date(a).getTime()
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">History</h1>
        {allCheckins.length > 0 && (
          <span className="text-sm text-gray-500">
            {totalCount !== null
              ? `${totalCount} check-in${totalCount !== 1 ? 's' : ''}`
              : `${allCheckins.length}+ check-ins`}
          </span>
        )}
      </div>

      {/* Date Range Filter */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center gap-2 mb-3">
          <Calendar size={16} className="text-gray-500" />
          <span className="text-sm font-medium text-gray-700">Filter by date</span>
        </div>
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1">
            <label htmlFor="from-date" className="block text-xs text-gray-500 mb-1">
              From
            </label>
            <input
              id="from-date"
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
            />
          </div>
          <div className="flex-1">
            <label htmlFor="to-date" className="block text-xs text-gray-500 mb-1">
              To
            </label>
            <input
              id="to-date"
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
            />
          </div>
          {(fromDate || toDate) && (
            <div className="flex items-end">
              <button
                onClick={() => {
                  setFromDate('');
                  setToDate('');
                }}
                className="px-3 py-2 text-sm text-gray-600 hover:text-gray-900 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Clear
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="animate-spin text-primary-600" size={32} />
        </div>
      ) : error ? (
        <div className="text-center py-20">
          <p className="text-red-600 mb-4">{error}</p>
          <button
            onClick={() => fetchCheckins(0, false)}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
          >
            Retry
          </button>
        </div>
      ) : allCheckins.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <Calendar size={40} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500">
            {fromDate || toDate
              ? 'No check-ins found for this date range.'
              : 'No check-ins yet.'}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {sortedDates.map((date) => (
            <div key={date}>
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
                {formatDateHeader(date)}
              </h2>
              <div className="space-y-3">
                {grouped[date].map((checkin) => (
                  <CheckInCard
                    key={checkin.id}
                    checkin={checkin}
                    onDelete={handleDelete}
                  />
                ))}
              </div>
            </div>
          ))}

          {/* Load More */}
          {hasMore && (
            <div className="text-center pt-2">
              <button
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="inline-flex items-center gap-2 px-6 py-2.5 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                {loadingMore ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Loading...
                  </>
                ) : (
                  'Load more'
                )}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

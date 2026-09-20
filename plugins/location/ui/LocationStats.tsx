/**
 * Location-specific stats widgets for the Places profile tab.
 *
 * These are venue/category-specific (they render the "Top Venues" leaderboard
 * and the per-category bar chart), so they live with the location plugin
 * rather than the shared core. The generic `StatCard` and `Heatmap` primitives
 * are reused from the core `components/Stats` module.
 */

import { useNavigate } from 'react-router-dom';
import { Trophy, BarChart3 } from 'lucide-react';
import type { TopVenue, CategoryBreakdown } from '../../../client/src/types';

export function TopVenuesList({ venues }: { venues: TopVenue[] }) {
  return (
    <div className="bg-white/60 dark:bg-gray-900/60 rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3 p-4">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1.5 mb-3">
        <Trophy size={16} className="text-yellow-500" />
        Top Venues
      </h3>
      {venues.length === 0 ? (
        <p className="text-sm text-gray-400">No check-ins yet.</p>
      ) : (
        <ul className="space-y-2">
          {venues.map((venue, i) => (
            <li key={venue.venue_id} className="flex items-center gap-3">
              <span className="text-sm font-bold text-gray-400 w-5 text-right">
                {i + 1}
              </span>
              <div className="flex-1 min-w-0 truncate">
                <a
                  href={`/venues/${venue.venue_id}`}
                  target='_blank'
                  rel='noopener noreferrer'
                  className="text-sm font-medium text-gray-900 dark:text-gray-100 hover:text-primary-600 hover:underline text-left"
                >
                  {venue.venue_name}
                </a>
                {venue.category_name && (
                  <p className="text-xs text-gray-500">{venue.category_name}</p>
                )}
              </div>
              <span className="text-sm font-semibold text-primary-600 shrink-0">
                {venue.checkin_count} check-in{venue.checkin_count !== 1 ? 's' : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function CategoryChart({ data }: { data: CategoryBreakdown[] }) {
  const navigate = useNavigate();
  const maxCount = Math.max(...data.map((d) => d.checkin_count), 1);

  return (
    <div className="bg-white/60 dark:bg-gray-900/60 rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3 p-4">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1.5 mb-3">
        <BarChart3 size={16} className="text-indigo-500" />
        Categories
      </h3>
      {data.length === 0 ? (
        <p className="text-sm text-gray-400">No data yet.</p>
      ) : (
        <div className="space-y-2.5">
          {data.map((item) => (
            <button
              key={item.category_name}
              onClick={() => navigate(`/?category=${encodeURIComponent(item.category_name)}`)}
              className="block w-full text-left group"
            >
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate group-hover:text-primary-600 group-hover:underline">
                  {item.category_name}
                </span>
                <span className="text-xs text-gray-500 shrink-0 ml-2">
                  {item.checkin_count} check-in{item.checkin_count !== 1 ? 's' : ''}
                </span>
              </div>
              <div className="w-full bg-gray-100 dark:bg-gray-700 rounded-full h-2">
                <div
                  className="bg-primary-500 h-2 rounded-full transition-all"
                  style={{
                    width: `${(item.checkin_count / maxCount) * 100}%`,
                  }}
                />
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

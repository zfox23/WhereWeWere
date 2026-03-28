import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { MapPin, Flame, CheckCircle, Loader2 } from 'lucide-react';
import { checkins, stats } from '../api/client';
import { CheckIn, Stats, Streak } from '../types';
import CheckInCard from '../components/CheckInCard';
import MapView from '../components/MapView';

const USER_ID = '00000000-0000-0000-0000-000000000001';

export default function Home() {
  const [recentCheckins, setRecentCheckins] = useState<CheckIn[]>([]);
  const [summary, setSummary] = useState<Stats | null>(null);
  const [streaks, setStreaks] = useState<Streak | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [checkinData, summaryData, streakData] = await Promise.all([
        checkins.list({ user_id: USER_ID, limit: '10' }),
        stats.summary(USER_ID),
        stats.streaks(USER_ID),
      ]);
      setRecentCheckins(checkinData);
      setSummary(summaryData);
      setStreaks(streakData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleDelete = async (id: string) => {
    try {
      await checkins.delete(id);
      setRecentCheckins((prev) => prev.filter((c) => c.id !== id));
    } catch (err) {
      console.error('Failed to delete check-in:', err);
    }
  };

  const markers = recentCheckins
    .filter((c) => c.venue_latitude != null && c.venue_longitude != null)
    .map((c) => ({
      lat: c.venue_latitude!,
      lng: c.venue_longitude!,
      label: c.venue_name || 'Check-in',
      id: c.id,
    }));

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-primary-600" size={32} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-20">
        <p className="text-red-600 mb-4">{error}</p>
        <button
          onClick={fetchData}
          className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Your Timeline</h1>
        <Link
          to="/check-in"
          className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors font-medium"
        >
          <MapPin size={18} />
          Check In
        </Link>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-3">
          <div className="p-2 bg-primary-50 rounded-lg">
            <CheckCircle size={20} className="text-primary-600" />
          </div>
          <div>
            <p className="text-2xl font-bold text-gray-900">
              {summary?.total_checkins ?? 0}
            </p>
            <p className="text-sm text-gray-500">Total Check-ins</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-3">
          <div className="p-2 bg-orange-50 rounded-lg">
            <Flame size={20} className="text-orange-500" />
          </div>
          <div>
            <p className="text-2xl font-bold text-gray-900">
              {streaks?.current_streak ?? 0}
            </p>
            <p className="text-sm text-gray-500">Day Streak</p>
          </div>
        </div>
      </div>

      {/* Map */}
      {markers.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <MapView
            markers={markers}
            className="h-64 w-full"
          />
        </div>
      )}

      {/* Recent Check-ins */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Recent Check-ins</h2>
          <Link
            to="/history"
            className="text-sm text-primary-600 hover:text-primary-700 font-medium"
          >
            View all
          </Link>
        </div>
        {recentCheckins.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
            <MapPin size={40} className="mx-auto text-gray-300 mb-3" />
            <p className="text-gray-500 mb-4">No check-ins yet. Start exploring!</p>
            <Link
              to="/check-in"
              className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors font-medium"
            >
              <MapPin size={18} />
              First Check In
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {recentCheckins.map((checkin) => (
              <CheckInCard
                key={checkin.id}
                checkin={checkin}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

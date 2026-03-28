import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, MapPin } from 'lucide-react';
import VenueSearch from '../components/VenueSearch';
import type { SelectedVenue } from '../components/VenueSearch';
import CheckInForm from '../components/CheckInForm';
import { venues } from '../api/client';

export default function CheckIn() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [selectedVenue, setSelectedVenue] = useState<SelectedVenue | null>(null);

  // Pre-fill venue from query params (e.g., from VenueDetail page)
  // Fetch full venue details to get parent info
  useEffect(() => {
    const venueId = searchParams.get('venueId');
    const venueName = searchParams.get('venueName');
    if (venueId && venueName) {
      venues.get(venueId).then((v) => {
        setSelectedVenue({
          id: venueId,
          name: venueName,
          parent_venue_id: v.parent_venue_id ?? null,
          parent_venue_name: v.parent_venue_name ?? null,
        });
      }).catch(() => {
        setSelectedVenue({ id: venueId, name: venueName });
      });
    }
  }, [searchParams]);

  const handleVenueSelect = (venue: SelectedVenue) => {
    setSelectedVenue(venue);
  };

  const handleSuccess = () => {
    navigate('/');
  };

  const handleChangeVenue = () => {
    setSelectedVenue(null);
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Check In</h1>

      {!selectedVenue ? (
        <div className="space-y-4">
          <p className="text-gray-600">Where are you?</p>
          <VenueSearch onSelect={handleVenueSelect} />
        </div>
      ) : (
        <div className="space-y-4">
          {/* Selected venue header */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary-50 rounded-lg">
                <MapPin size={20} className="text-primary-600" />
              </div>
              <div>
                <p className="font-semibold text-gray-900">
                  {selectedVenue.name}
                  {selectedVenue.parent_venue_name && (
                    <span className="font-normal text-sm text-gray-400">
                      {' \u2014 '}{selectedVenue.parent_venue_name}
                    </span>
                  )}
                </p>
                <p className="text-sm text-gray-500">Selected venue</p>
              </div>
            </div>
            <button
              onClick={handleChangeVenue}
              className="inline-flex items-center gap-1.5 text-sm text-primary-600 hover:text-primary-700 font-medium"
            >
              <ArrowLeft size={14} />
              Change venue
            </button>
          </div>

          {/* Check-in form */}
          <CheckInForm
            venueId={selectedVenue.id}
            venueName={selectedVenue.name}
            parentVenueId={selectedVenue.parent_venue_id}
            parentVenueName={selectedVenue.parent_venue_name}
            onSuccess={handleSuccess}
          />
        </div>
      )}
    </div>
  );
}

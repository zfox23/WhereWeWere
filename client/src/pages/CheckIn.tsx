import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, MapPin, Loader2 } from 'lucide-react';
import VenueSearch from '../components/VenueSearch';
import type { SelectedVenue } from '../components/VenueSearch';
import CheckInForm from '../components/CheckInForm';
import MapView from '../components/MapView';
import { venues, checkins } from '../api/client';
import type { CheckIn as CheckInType } from '../types';

export default function CheckIn() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const editId = searchParams.get('edit');
  const [selectedVenue, setSelectedVenue] = useState<SelectedVenue | null>(null);
  const [selectedVenueCoords, setSelectedVenueCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [selectedVenueCoordsLoading, setSelectedVenueCoordsLoading] = useState(false);
  const [editCheckin, setEditCheckin] = useState<CheckInType | null>(null);
  const [editLoading, setEditLoading] = useState(false);

  // Edit mode: fetch existing check-in
  useEffect(() => {
    if (!editId) return;
    setEditLoading(true);
    checkins.get(editId).then((data) => {
      setEditCheckin(data);
      setSelectedVenue({
        id: data.venue_id,
        name: data.venue_name || 'Unknown Venue',
        parent_venue_id: data.parent_venue_id ?? null,
        parent_venue_name: data.parent_venue_name ?? null,
      });
    }).catch((err) => {
      console.error('Failed to load check-in for editing:', err);
    }).finally(() => setEditLoading(false));
  }, [editId]);

  // Pre-fill venue from query params (e.g., from VenueDetail page)
  useEffect(() => {
    if (editId) return; // edit mode handles venue separately
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
  }, [searchParams, editId]);

  const handleVenueSelect = (venue: SelectedVenue) => {
    setSelectedVenue(venue);
  };

  const handleSuccess = () => {
    navigate('/');
  };

  const handleChangeVenue = () => {
    setSelectedVenue(null);
    setSelectedVenueCoords(null);
  };

  useEffect(() => {
    if (!selectedVenue?.id) {
      setSelectedVenueCoords(null);
      return;
    }

    let active = true;
    setSelectedVenueCoordsLoading(true);
    venues.get(selectedVenue.id)
      .then((venue) => {
        if (!active) return;
        const lat = Number(venue.latitude);
        const lng = Number(venue.longitude);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          setSelectedVenueCoords({ lat, lng });
        } else {
          setSelectedVenueCoords(null);
        }
      })
      .catch(() => {
        if (!active) return;
        setSelectedVenueCoords(null);
      })
      .finally(() => {
        if (!active) return;
        setSelectedVenueCoordsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [selectedVenue?.id]);

  if (editLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-primary-600" size={32} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
        {editId ? 'Edit Check In' : 'Check In'}
      </h1>

      {!selectedVenue && !editId ? (
        <div className="space-y-4">
          <VenueSearch
            onSelect={handleVenueSelect}
            initialLat={searchParams.get('lat') ? parseFloat(searchParams.get('lat')!) : undefined}
            initialLon={searchParams.get('lon') ? parseFloat(searchParams.get('lon')!) : undefined}
          />
        </div>
      ) : selectedVenue ? (
        <div className="space-y-4">
          {/* Selected venue header */}
          <div className="bg-white dark:bg-gray-900/60 rounded-xl border border-gray-200 dark:border-gray-700/40 p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary-50 dark:bg-primary-900/30 rounded-lg">
                <MapPin size={20} className="text-primary-600" />
              </div>
              <div>
                <p className="font-semibold text-gray-900 dark:text-gray-100">
                  {selectedVenue.name}
                  {selectedVenue.parent_venue_name && (
                    <span className="font-normal text-sm text-gray-400">
                      {' \u2014 '}{selectedVenue.parent_venue_name}
                    </span>
                  )}
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {editId ? 'Venue' : 'Selected venue'}
                </p>
              </div>
            </div>
            {!editId && (
              <button
                onClick={handleChangeVenue}
                className="inline-flex items-center gap-1.5 text-sm text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 font-medium"
              >
                <ArrowLeft size={14} />
                Change venue
              </button>
            )}
          </div>

          {(selectedVenueCoordsLoading || selectedVenueCoords) && (
            <div className="bg-white dark:bg-gray-900/60 rounded-xl border border-gray-200 dark:border-gray-700/40 overflow-hidden">
              {selectedVenueCoordsLoading && !selectedVenueCoords ? (
                <div className="flex items-center justify-center h-48 text-sm text-gray-500 dark:text-gray-400">
                  <Loader2 className="animate-spin text-primary-600" size={18} />
                  <span className="ml-2">Loading map...</span>
                </div>
              ) : selectedVenueCoords ? (
                <MapView
                  center={[selectedVenueCoords.lat, selectedVenueCoords.lng]}
                  zoom={15}
                  markers={[
                    {
                      lat: selectedVenueCoords.lat,
                      lng: selectedVenueCoords.lng,
                      label: selectedVenue.name,
                      id: selectedVenue.id,
                    },
                  ]}
                  className="h-56 w-full"
                />
              ) : null}
            </div>
          )}

          {/* Check-in form */}
          <CheckInForm
            venueId={selectedVenue.id}
            venueName={selectedVenue.name}
            parentVenueId={selectedVenue.parent_venue_id}
            parentVenueName={selectedVenue.parent_venue_name}
            onSuccess={handleSuccess}
            editCheckinId={editId || undefined}
            initialNotes={editCheckin?.notes || ''}
            initialRating={editCheckin?.rating || 0}
            initialCheckedInAt={editCheckin?.checked_in_at}
          />
        </div>
      ) : null}
    </div>
  );
}

import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, MapPin, Loader2, AlertCircle, Trash2 } from 'lucide-react';
import VenueSearch from './VenueSearch';
import type { SelectedVenue } from './VenueSearch';
import CheckInForm from './LocationCheckInForm';
import MapView from './MapView';
import { venues, checkins } from '../../../client/src/api/client';
import type { CheckIn as CheckInType } from '../../../client/src/types';
import { usePageTitle } from '../../../client/src/utils/pageTitle';

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function applyDateToIsoString(date: string, fallbackIso?: string): string {
  const base = fallbackIso ? new Date(fallbackIso) : new Date();
  const timeHours = base.getHours();
  const timeMinutes = base.getMinutes();
  return `${date}T${String(timeHours).padStart(2, '0')}:${String(timeMinutes).padStart(2, '0')}:00`;
}

export default function CheckIn(props: { editId?: string | null; dateParam?: string | null } = {}) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // editId/dateParam are passed by the plugin route wrapper; the raw query
  // params are kept as a fallback for direct deep links.
  const editId = props.editId ?? searchParams.get('edit');
  usePageTitle(editId ? 'Edit Check-In' : 'New Check-In');

  const dateParam = props.dateParam ?? searchParams.get('date') ?? '';
  const prefillsDate = DATE_ONLY_PATTERN.test(dateParam);
  const [selectedVenue, setSelectedVenue] = useState<SelectedVenue | null>(null);
  const [selectedVenueCoords, setSelectedVenueCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [selectedVenueCoordsLoading, setSelectedVenueCoordsLoading] = useState(false);
  const [selectedVenueDetails, setSelectedVenueDetails] = useState<{
    category_name?: string | null;
    address?: string | null;
    checkin_count?: number | null;
  } | null>(null);
  const [deletingVenue, setDeletingVenue] = useState(false);
  const [editCheckin, setEditCheckin] = useState<CheckInType | null>(null);
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Edit mode: fetch existing check-in
  useEffect(() => {
    if (!editId) return;
    setEditLoading(true);
    setEditError(null);
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
      setEditError(err instanceof Error ? err.message : 'Failed to load check-in for editing');
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

  const handleSuccess = (newId: string) => {
    // Editing: go to the check-in's detail page. Creating: back to the
    // timeline, which highlights the new check-in via `state.newId`.
    if (editId) {
      navigate(`/location-checkins/${editId}`);
    } else {
      navigate('/', { state: { newId } });
    }
  };

  const handleChangeVenue = () => {
    setSelectedVenue(null);
    setSelectedVenueCoords(null);
    setSelectedVenueDetails(null);
  };

  const handleDeleteVenue = async () => {
    if (!selectedVenue?.id || deletingVenue) return;
    if (!window.confirm(`Delete venue "${selectedVenue.name}"? This cannot be undone.`)) {
      return;
    }
    setDeletingVenue(true);
    try {
      await venues.delete(selectedVenue.id);
      handleChangeVenue();
    } catch (err) {
      console.error('Failed to delete venue:', err);
    } finally {
      setDeletingVenue(false);
    }
  };

  useEffect(() => {
    if (!selectedVenue?.id) {
      setSelectedVenueCoords(null);
      setSelectedVenueDetails(null);
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
        const addr = [venue.address, venue.city, venue.state, venue.postal_code, venue.country].filter(Boolean).join(', ');
        setSelectedVenueDetails({
          category_name: venue.category_name ?? null,
          address: addr || null,
          checkin_count: venue.checkin_count ?? 0,
        });
      })
      .catch(() => {
        if (!active) return;
        setSelectedVenueCoords(null);
        setSelectedVenueDetails(null);
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

  if (editError) {
    return (
      <div className="text-center py-20 space-y-4">
        <AlertCircle size={40} className="mx-auto text-red-500 mb-2" />
        <p className="text-red-600 dark:text-red-400 font-medium">{editError}</p>
        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => {
              if (!editId) return;
              setEditLoading(true);
              setEditError(null);
              checkins.get(editId).then((data) => {
                setEditCheckin(data);
                setSelectedVenue({
                  id: data.venue_id,
                  name: data.venue_name || 'Unknown Venue',
                  parent_venue_id: data.parent_venue_id ?? null,
                  parent_venue_name: data.parent_venue_name ?? null,
                });
              }).catch((err) => {
                setEditError(err instanceof Error ? err.message : 'Failed to load check-in for editing');
              }).finally(() => setEditLoading(false));
            }}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm font-medium transition-colors"
          >
            Retry
          </button>
          <button
            type="button"
            onClick={() => navigate('/')}
            className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            Back to Home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
        {editId ? 'Edit Location Check In' : 'Location Check In'}
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
                {(selectedVenueDetails?.category_name || selectedVenueDetails?.address) && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    {[selectedVenueDetails.category_name, selectedVenueDetails.address].filter(Boolean).join(' • ')}
                  </p>
                )}
                <div className="flex items-center gap-1.5 mt-0.5">
                  <p className="text-xs text-gray-400">
                    {editId ? 'Venue' : 'Selected venue'}
                  </p>
                  {selectedVenueDetails?.checkin_count != null && (
                    <span className="text-xs text-primary-600 dark:text-primary-400 font-medium">
                      • {selectedVenueDetails.checkin_count > 0
                        ? `${selectedVenueDetails.checkin_count} check-in${selectedVenueDetails.checkin_count === 1 ? '' : 's'}`
                        : 'New venue'}
                    </span>
                  )}
                </div>
              </div>
            </div>
            {!editId && (
              <div className="flex items-center gap-2">
                {selectedVenueDetails?.checkin_count === 0 && (
                  <button
                    type="button"
                    onClick={handleDeleteVenue}
                    disabled={deletingVenue}
                    className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/30"
                  >
                    {deletingVenue ? (
                      <>
                        <Loader2 size={12} className="animate-spin" />
                        Deleting...
                      </>
                    ) : (
                      <>
                        <Trash2 size={12} />
                        Delete venue
                      </>
                    )}
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleChangeVenue}
                  className="inline-flex items-center gap-1.5 text-sm text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 font-medium"
                >
                  <ArrowLeft size={14} />
                  Change venue
                </button>
              </div>
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
            onDeleteVenue={handleChangeVenue}
            hideVenueCard={true}
            editCheckinId={editId || undefined}
            initialNotes={editCheckin?.notes || ''}
            initialCheckedInAt={editCheckin?.checked_in_at || (prefillsDate ? applyDateToIsoString(dateParam) : undefined)}
            initialRating={editCheckin?.rating ?? null}
            initialCompanions={editCheckin?.companions ?? []}
            initialListIds={editCheckin?.lists ?? []}
          />
        </div>
      ) : null}
    </div>
  );
}

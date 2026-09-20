/**
 * Location check-in type — client half.
 *
 * Ships full custom UIs for every integration point: check-in page, detail
 * page, timeline card, Home filter section, Profile tab, and the reflection
 * card. The existing components (pages/CheckIn, CheckInDetail, CheckInCard,
 * filters/LocationFilter, PlacesTab) were adapted to the plugin prop
 * contracts and now live in this plugin's `ui/` folder.
 */

import { useEffect, useState } from 'react';
import type {
  CheckinCardProps,
  CheckinTypeClientPlugin,
  PluginFilterSectionProps,
  PluginProfileTabProps,
  PluginReflectionCardProps,
} from 'wwp-shared';
import { MapPin } from 'lucide-react';
import { manifest } from './manifest';

export { manifest };
import LocationCheckIn from './ui/LocationCheckIn';
import LocationCheckInDetail from './ui/LocationCheckInDetail';
import LocationCard from './ui/LocationCard';
import LocationFilter from './ui/LocationFilter';
import { PlacesTab } from './ui/PlacesTab';
import { SwarmImportSection } from './ui/SwarmImportSection';
import { LocationProvider } from './ui/LocationContext';
import { LocationReflectionCard } from './ui/LocationReflectionCard';
import { stats } from '../../client/src/api/client';
import type { CheckIn, ImmichAsset, Scrobble } from '../../client/src/types';

const USER_ID = '00000000-0000-0000-0000-000000000001';

/**
 * The location timeline branch emits legacy typed columns
 * (venue_name, venue_timezone, ...) alongside the standard envelope. The
 * card expects the legacy `CheckIn` shape, so lift the extra columns into it.
 */
function toLegacyCheckin(props: CheckinCardProps): CheckIn {
  const item = props.item as CheckinCardProps['item'] & {
    venue_id?: string;
    venue_name?: string;
    venue_category?: string;
    venue_latitude?: number;
    venue_longitude?: number;
    venue_timezone?: string | null;
    parent_venue_id?: string;
    parent_venue_name?: string;
  };
  return {
    id: item.id,
    user_id: item.user_id,
    venue_id: item.venue_id ?? '',
    venue_name: item.venue_name ?? undefined,
    venue_category: item.venue_category,
    venue_latitude: item.venue_latitude,
    venue_longitude: item.venue_longitude,
    venue_timezone: item.venue_timezone ?? item.timezone,
    parent_venue_id: item.parent_venue_id,
    parent_venue_name: item.parent_venue_name,
    notes: item.notes,
    checked_in_at: item.checked_in_at,
    created_at: item.created_at,
  } as CheckIn;
}

function LocationCardAdapter(props: CheckinCardProps) {
  return (
    <LocationCard
      checkin={toLegacyCheckin(props)}
      immichUrl={props.integrations.immich_url ?? null}
      photos={(props.photos as ImmichAsset[] | null) ?? null}
      scrobbles={(props.scrobbles as Scrobble[]) ?? []}
      malojaUrl={props.integrations.maloja_url ?? null}
      dawarichUrl={props.integrations.dawarich_url ?? null}
      compact={props.compact}
    />
  );
}

function LocationFilterSection(props: PluginFilterSectionProps) {
  const [categoryOptions, setCategoryOptions] = useState<string[]>([]);
  const [countryOptions, setCountryOptions] = useState<string[]>([]);

  // The filter section fetches its own option lists (the core previously
  // fetched these in Home for the hard-coded location filter panel).
  useEffect(() => {
    stats
      .categoryBreakdown(USER_ID)
      .then((categories) => {
        setCategoryOptions(
          Array.from(
            new Set(
              (categories || [])
                .map((c: any) => String(c.category_name || '').trim())
                .filter(Boolean)
            )
          ).sort((a, b) => a.localeCompare(b))
        );
      })
      .catch(() => setCategoryOptions([]));
    stats
      .countries(USER_ID)
      .then((countries) => {
        setCountryOptions(
          Array.from(
            new Set(
              (countries || [])
                .map((c: any) => String(c.country || '').trim())
                .filter(Boolean)
            )
          ).sort((a, b) => a.localeCompare(b))
        );
      })
      .catch(() => setCountryOptions([]));
  }, []);

  return (
    <LocationFilter
      included={props.included}
      filtersDisabled={props.filtersDisabled}
      sectionDisabled={props.sectionDisabled}
      typeToggleDisabled={props.typeToggleDisabled}
      category={props.params.category ?? ''}
      country={props.params.country ?? ''}
      categoryOptions={categoryOptions}
      countryOptions={countryOptions}
      onToggleIncluded={props.onToggleIncluded}
      onSetCategory={(value: string) => props.onSetParam('category', value)}
      onSetCountry={(value: string) => props.onSetParam('country', value)}
    />
  );
}

function LocationProfileTab(_props: PluginProfileTabProps) {
  return <PlacesTab />;
}

export const client: CheckinTypeClientPlugin = {
  icon: MapPin,
  iconColor: 'text-primary-500',
  hotkey: 'l',
  fabOrder: 10,
  checkInPath: '/location-check-in',
  detailPath: '/location-checkins/:id',
  checkInForm: (props) => (
    <LocationProvider>
      <LocationCheckIn {...props} />
    </LocationProvider>
  ),
  detailPage: (props) => <LocationCheckInDetail {...props} />,
  timelineCard: LocationCardAdapter,
  filterSection: LocationFilterSection,
  profileTab: LocationProfileTab,
  reflectionCard: LocationReflectionCard,
  dataSettings: SwarmImportSection,
};

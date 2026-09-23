/**
 * Location check-in type — plugin manifest (pure data; shared by client + server).
 *
 * Location uses CUSTOM storage: the pre-existing `checkins`, `venues`, and
 * `venue_categories` tables. The field schema below documents the shape of a
 * location check-in and drives generic features (auto filters, backup
 * validation is skipped for custom storage, but the schema still documents
 * `data` for auto UIs).
 *
 * The Location plugin also owns the entire venues subsystem (venue CRUD,
 * Overpass/Nominatim search, venue merge, geocoding, categorization, the
 * Swarm import, and the "Backfill Venues" background job).
 */

import type { CheckinTypeManifest } from 'wwp-shared';

export const manifest: CheckinTypeManifest = {
  id: 'location',
  version: '1.0.0',
  filterParams: ['venue_id', 'category', 'country'],
  fields: [
    {
      name: 'venue_id',
      kind: 'text',
      label: 'Venue',
      required: true,
    },
    {
      name: 'notes',
      kind: 'textarea',
      label: 'Notes',
    },
  ],
  strings: {
    title: 'Location',
    singular: 'location check-in',
    plural: 'location check-ins',
    newCheckIn: 'Where are you?',
    profileTab: 'Places',
    confirmDelete: 'Delete this location check-in?',
  },
};

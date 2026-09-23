/**
 * Tracks check-in type — plugin manifest (pure data; shared by client + server).
 *
 * Tracks uses CUSTOM storage: the pre-existing `tracks` table (PostGIS
 * LINESTRING geometry plus a per-point JSONB series) and the on-disk
 * originals under `<dataDir>/<userId>/uploads/gps_tracks/`. The field schema
 * below documents the shape of a track and drives generic features (backup
 * validation is skipped for custom storage, but the schema still documents
 * `data` for auto UIs and auto filters).
 */

import type { CheckinTypeManifest } from 'wwp-shared';

export const manifest: CheckinTypeManifest = {
  id: 'tracks',
  version: '1.0.0',
  filterParams: ['track_activity'],
  fields: [
    { name: 'name', kind: 'text', label: 'Name', required: true },
    { name: 'activity_type', kind: 'text', label: 'Activity type' },
    { name: 'started_at', kind: 'datetime', label: 'Started', required: true },
    { name: 'ended_at', kind: 'datetime', label: 'Ended' },
    { name: 'distance_m', kind: 'number', label: 'Distance (m)' },
    { name: 'elapsed_time_s', kind: 'number', label: 'Elapsed time (s)' },
  ],
  strings: {
    title: 'Tracks',
    singular: 'track',
    plural: 'tracks',
    newCheckIn: 'Upload a track',
    profileTab: 'Tracks',
    confirmDelete: 'Delete this track?',
  },
};

/**
 * Music plugin — manifest (pure data; shared by client + server).
 *
 * Music uses CUSTOM storage (`music_scrobbles` + `music_sessions`). Scrobbles
 * are never created by hand: they arrive from multi-scrobbler or a file
 * import. The timeline shows one item per listening session, whose payload is
 * documented by the fields below.
 */

import type { CheckinTypeManifest } from 'wwp-shared';

export const manifest: CheckinTypeManifest = {
  id: 'music',
  version: '1.0.0',
  fields: [
    { name: 'started_at', kind: 'datetime', label: 'Session start' },
    { name: 'ended_at', kind: 'datetime', label: 'Session end' },
    { name: 'track_count', kind: 'integer', label: 'Tracks', min: 0 },
    { name: 'listened_seconds', kind: 'integer', label: 'Listening time', min: 0, unit: 's' },
  ],
  strings: {
    title: 'Music',
    singular: 'listening session',
    plural: 'listening sessions',
    newCheckIn: 'Music',
    profileTab: 'Music',
    confirmDelete: 'Delete this listening session?',
  },
};

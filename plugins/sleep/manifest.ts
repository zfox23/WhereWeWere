/**
 * Sleep check-in type — plugin manifest (pure data; shared by client + server).
 *
 * Sleep uses CUSTOM storage: the pre-existing `sleep_entries` and
 * `sleep_webhook_events` tables. The field schema below documents the shape of
 * a sleep entry and drives generic features (auto UIs/filters are not used —
 * Sleep ships full custom UIs — but the schema still documents `data` for the
 * unified timeline and backup validation).
 */

import type { CheckinTypeManifest } from 'wwp-shared';

export const manifest: CheckinTypeManifest = {
  id: 'sleep',
  version: '1.0.0',
  filterParams: ['sleep_duration'],
  fields: [
    {
      name: 'started_at',
      kind: 'datetime',
      label: 'Sleep Start',
      required: true,
    },
    {
      name: 'ended_at',
      kind: 'datetime',
      label: 'Sleep End',
      required: true,
    },
    {
      name: 'rating',
      kind: 'integer',
      label: 'Sleep Rating',
      min: 0,
      max: 5,
      default: 0,
    },
    {
      name: 'comment',
      kind: 'textarea',
      label: 'Comment',
    },
  ],
  strings: {
    title: 'Sleep',
    singular: 'sleep entry',
    plural: 'sleep entries',
    newCheckIn: 'How did you sleep?',
    profileTab: 'Sleep',
    confirmDelete: 'Delete this sleep entry?',
  },
};

/**
 * Mood check-in type — plugin manifest (pure data; shared by client + server).
 *
 * Mood uses CUSTOM storage: the pre-existing `mood_checkins`,
 * `mood_activities`, `mood_activity_groups`, and `mood_checkin_activities`
 * tables. The field schema below documents the shape of a mood check-in and
 * drives generic features (backup validation is skipped for custom storage,
 * but the schema still documents `data` for auto UIs and auto filters).
 */

import type { CheckinTypeManifest } from 'wwp-shared';

export const manifest: CheckinTypeManifest = {
  id: 'mood',
  version: '1.0.0',
  filterParams: ['mood', 'activity'],
  fields: [
    {
      name: 'mood',
      kind: 'rating',
      label: 'Mood',
      required: true,
      min: 1,
      max: 5,
      options: [
        { value: '1', label: 'Awful', icon: '😢' },
        { value: '2', label: 'Bad', icon: '😕' },
        { value: '3', label: 'Meh', icon: '😐' },
        { value: '4', label: 'Good', icon: '🙂' },
        { value: '5', label: 'Excellent', icon: '😄' },
      ],
    },
    {
      name: 'note',
      kind: 'textarea',
      label: 'Note.md',
    },
    {
      name: 'activity_ids',
      kind: 'multi-select',
      label: 'Activities',
      default: [],
    },
  ],
  strings: {
    title: 'Mood',
    singular: 'mood check-in',
    plural: 'mood check-ins',
    newCheckIn: 'How are you feeling?',
    profileTab: 'Moods',
    confirmDelete: 'Delete this mood check-in?',
  },
};

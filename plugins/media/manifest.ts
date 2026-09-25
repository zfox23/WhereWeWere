/**
 * Media check-in type — plugin manifest (pure data; shared by client + server).
 *
 * Media uses CUSTOM storage: the pre-existing `media_items`, `media_checkins`,
 * `media_lists`, `media_list_items`, `media_tv_episodes`, and
 * `plex_webhook_events` tables. The field schema below documents the shape of
 * a media check-in (backup validation is skipped for custom storage, but the
 * schema still documents `data` for auto UIs and auto filters).
 *
 * The Media plugin also owns the entire media-item subsystem (item
 * search/CRUD/sync against TMDB/TGDB/Hardcover, media lists, the Plex
 * scrobble webhook, the Yamtrack import, and the TV-episode check-in flow).
 */

import type { CheckinTypeManifest } from 'wwp-shared';

export const manifest: CheckinTypeManifest = {
  id: 'media',
  version: '1.0.0',
  filterParams: ['media_subtype'],
  fields: [
    {
      name: 'media_item_id',
      kind: 'text',
      label: 'Media item',
      required: true,
    },
    {
      name: 'media_type',
      kind: 'select',
      label: 'Type',
      options: [
        { value: 'movie', label: 'Movie' },
        { value: 'tv_show', label: 'TV Show' },
        { value: 'game', label: 'Game' },
        { value: 'book', label: 'Book' },
        { value: 'board_game', label: 'Board Game' },
      ],
    },
    {
      name: 'checkin_type',
      kind: 'select',
      label: 'Status',
      default: 'completed',
      options: [
        { value: 'completed', label: 'Completed' },
        { value: 'in_progress', label: 'In-Progress' },
        { value: 'started', label: 'Started' },
        { value: 'dropped', label: 'Dropped' },
      ],
    },
    {
      name: 'rating',
      kind: 'rating',
      label: 'Rating',
      min: 0,
      max: 4,
    },
    {
      name: 'raw_score',
      kind: 'text',
      label: 'Raw score',
    },
    {
      name: 'season_number',
      kind: 'integer',
      label: 'Season',
    },
    {
      name: 'episode_number',
      kind: 'integer',
      label: 'Episode',
    },
    {
      name: 'episode_title',
      kind: 'text',
      label: 'Episode title',
    },
    {
      name: 'time_played_minutes',
      kind: 'integer',
      label: 'Time played',
      unit: 'min',
    },
    {
      name: 'notes',
      kind: 'textarea',
      label: 'Notes',
    },
  ],
  strings: {
    title: 'Media',
    singular: 'media check-in',
    plural: 'media check-ins',
    newCheckIn: 'What are you watching, reading, or playing?',
    profileTab: 'Media',
    confirmDelete: 'Delete this media check-in?',
  },
};

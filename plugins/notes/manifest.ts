/**
 * Notes check-in type — manifest (pure data, shared by client and server).
 *
 * Notes is a custom-storage plugin (`note_checkins` + tag tables): a note
 * carries colored tags, companions, and derived similarity data, none of
 * which the generic store has hooks for. `fields` still describes the data
 * shape for documentation and the generic detail fallbacks.
 */

import type { CheckinTypeManifest } from 'wwp-shared';

/**
 * Colors handed to new tags in turn (Settings > Notes can change them). The
 * order is a colorblind-validated categorical sequence: adjacent slots stay
 * distinguishable under deutan/protan/tritan vision, so keep it as is.
 */
export const TAG_PALETTE = [
  '#2a78d6', // blue
  '#eb6834', // orange
  '#1baf7a', // aqua
  '#eda100', // yellow
  '#e87ba4', // magenta
  '#008300', // green
  '#6250d6', // violet
  '#e34948', // red
] as const;

/** Themes past the palette fold into one neutral color; their labels carry identity. */
export const OVERFLOW_COLOR = '#8a8984';

export const MAX_TITLE_LENGTH = 300;
export const MAX_BODY_LENGTH = 200_000;
export const MAX_TAG_LENGTH = 60;

export const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export const manifest: CheckinTypeManifest = {
  id: 'notes',
  version: '1.0.0',
  // Comma-separated tag names (case-insensitive); a note matches any of them.
  filterParams: ['note_tag'],
  fields: [
    { name: 'title', kind: 'text', label: 'Title' },
    { name: 'body', kind: 'textarea', label: 'Note' },
    { name: 'tags', kind: 'multi-select', label: 'Tags' },
  ],
  strings: {
    title: 'Note',
    singular: 'note',
    plural: 'notes',
    newCheckIn: 'New note',
    profileTab: 'Notes',
    confirmDelete: 'Are you sure you want to delete this note?',
  },
};

/**
 * Test-only plugin fixture exercising GENERIC storage end to end.
 *
 * This is the reference "newest plugin" a contributor would ship today:
 * a manifest with a field schema, no server-side hooks at all — the
 * framework provides CRUD, timeline, backup, restore, and start-over.
 * Register it with `registerPlugin` before issuing requests.
 */

import type { CheckinTypeServer } from 'wwp-shared';

export const PLUGIN_ID = 'test_generic';

export const genericPlugin: CheckinTypeServer = {
  id: PLUGIN_ID,
  version: '0.1.0',
  filterParams: ['flavor'],
  fields: [
    { name: 'flavor', kind: 'select', label: 'Flavor', required: true, options: [
      { value: 'chocolate', label: 'Chocolate' },
      { value: 'strawberry', label: 'Strawberry' },
    ] },
    { name: 'score', kind: 'rating', label: 'Score', min: 1, max: 5 },
    { name: 'note', kind: 'text', label: 'Note' },
  ],
  strings: {
    title: 'Test Generic',
    singular: 'test generic check-in',
    plural: 'test generic check-ins',
    newCheckIn: 'Log a test check-in',
    profileTab: 'Test Generics',
    confirmDelete: 'Delete this test check-in?',
  },
  // No `storage` key => 'generic'; no server hooks => framework defaults.
  server: {
    settingsKeys: [{ name: 'demo', type: 'string', label: 'Demo setting' }],
  },
};

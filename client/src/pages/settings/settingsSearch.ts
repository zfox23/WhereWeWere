/**
 * Search keywords for the Settings sidebar. Each section lists the headings
 * and terms that live inside it, so searching e.g. "wallpaper" finds Display
 * even though the word isn't in the section's name.
 *
 * Keep these in sync when adding a heading or setting to a tab.
 */

export const CORE_SECTION_KEYWORDS: Record<string, string[]> = {
  account: [
    'Profile', 'Display name', 'Username', 'Password', 'Signed-in devices', 'Sessions',
    'Sign out', 'Webhook URLs secret', 'Webhooks',
  ],
  display: [
    'Distance units', 'Metric', 'Imperial', 'Kilometers', 'Miles', 'Theme', 'Dark mode',
    'Light mode', 'Colors', 'Typography', 'Font', 'Background', 'Wallpaper', 'Pattern',
    'Gradient', 'Photo', 'Shape & Surfaces', 'Corners', 'Glass', 'Maps & Charts', 'Map style',
    'Comfort', 'Motion', 'Animations', 'Accessibility', 'Appearance',
  ],
  notifications: ['Push notifications', 'This device', 'Reminders', 'Alerts'],
  integrations: [
    'Dawarich', 'Immich', 'Photos', 'Location history', 'LLM', 'AI', 'Model', 'API key',
    'Reasoning level', 'Context window', 'Image support',
  ],
  data: [
    'Backup & Restore', 'Export', 'Import', 'Download', 'Jobs', 'Timestamp Reconciliation',
    'Timezones', 'Start Over', 'Danger zone', 'Delete all data',
  ],
  users: ['Add a user', 'Users', 'Accounts', 'Admin', 'Reset password', 'Disable user', 'Delete user'],
};

/** Extra terms for plugin sections, keyed by plugin id (mirrors each plugin's `settingsKeys` labels). */
export const PLUGIN_SECTION_KEYWORDS: Record<string, string[]> = {
  mood: ['Icon pack', 'Activities', 'Reminder times'],
  music: ['Scrobbler key', 'Maloja', 'Session gap', 'Timeline sessions', 'Play timezones', 'Music metadata'],
  food: ['Mealie', 'Meal plan', 'Recipes'],
  notes: [
    'Embedding model', 'Transcription', 'Speaker identification', 'Diarization',
    'Similarity Web', 'Voice notes',
  ],
  location: ['Coasterpedia', 'Weather', 'Open-Meteo', 'Venues'],
  media: ['TMDB', 'Hardcover', 'IGDB', 'Twitch', 'Plex', 'Movies', 'TV', 'Books', 'Games'],
  tracks: ['Activity types'],
  scuba: ['Dives', 'Dive sites'],
  sleep: [],
};

export interface SearchableSection {
  label: string;
  keywords: string[];
}

export interface SectionMatch {
  matches: boolean;
  /** The keyword that matched when the label itself didn't, shown as a hint. */
  hint?: string;
}

/** Every whitespace-separated term in `query` must appear in the label or a keyword. */
export function matchSection(section: SearchableSection, query: string): SectionMatch {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return { matches: true };
  const label = section.label.toLowerCase();
  const keywords = section.keywords.map((k) => k.toLowerCase());
  const haystack = [label, ...keywords].join(' \u0000 ');
  if (!terms.every((t) => haystack.includes(t))) return { matches: false };
  if (terms.every((t) => label.includes(t))) return { matches: true };
  const hintIndex = keywords.findIndex((k) => terms.some((t) => k.includes(t)));
  return { matches: true, hint: hintIndex >= 0 ? section.keywords[hintIndex] : undefined };
}

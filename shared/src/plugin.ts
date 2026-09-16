/**
 * The check-in type plugin contract.
 *
 * A plugin is a build-time TypeScript module that contributes a new check-in
 * type to WhereWeWere. It lives in a single folder (e.g. `plugins/mood/`)
 * containing:
 *
 *   manifest.ts  - pure data: id, version, fields, strings (importable by
 *                  both the client and the server; no React, no Node)
 *   server.ts    - exports the server half (storage, timeline SQL, filters,
 *                  backup/restore, settings schema)
 *   client.tsx   - exports the client half (UI components, strings already in
 *                  the manifest, profile tab, settings sections)
 *
 * Both halves are registered in per-side registries at build time and joined
 * by the plugin `id`.
 *
 * Everything a plugin can omit has a framework-provided default:
 *  - no check-in form UI    -> AutoCheckInForm generated from `fields`
 *  - no timeline card UI    -> AutoCheckInCard generated from `fields`
 *  - no detail page UI      -> generic detail page generated from `fields`
 *  - no filters             -> an "include this type" toggle only
 *  - no profile tab UI      -> a tab showing the count of check-ins
 *  - no settings sections   -> none (backup/restore is always automatic)
 *  - no custom storage      -> the generic `plugin_checkins` JSONB table
 */

import type { PluginField } from './fields';
import type { PluginFilterClause, PluginTimelineEntry } from './timeline';

/**
 * Structural stand-in for a React component so this shared package stays
 * free of a React dependency. Any `React.FC`/function component is
 * assignable to this.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyComponent<P = Record<string, any>> = (props: P) => any;

/** Text strings associated with the check-in type (required). */
export interface CheckinTypeStrings {
  /** Short display name, e.g. "Mood". Used in the FAB, filters, tab bar. */
  title: string;
  /** e.g. "mood check-in" */
  singular: string;
  /** e.g. "mood check-ins" */
  plural: string;
  /** Header of the new check-in page, e.g. "How are you feeling?" */
  newCheckIn: string;
  /** Profile tab label, e.g. "Moods". */
  profileTab: string;
  /** Confirmation dialog when deleting a check-in of this type. */
  confirmDelete: string;
}

/** A plugin-contributed key stored in the generic `plugin_settings` table. */
export interface PluginSettingsKey {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'json';
  label: string;
  default?: unknown;
}

/** Context passed to plugin delete/backup hooks. */
export interface PluginHookContext {
  user_id: string;
  /**
   * Optional transaction client (e.g. a pg PoolClient) that the framework
   * is running these hooks inside. Hooks MUST issue their queries on this
   * client when provided so the whole restore/delete stays atomic; they may
   * open their own connection only when it is absent.
   *
   * Typed loosely to keep this package framework-free.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client?: any;
}

/**
 * Server half of a check-in type plugin.
 *
 * When `storage` is 'generic' (the default) the framework persists check-ins
 * in the shared `plugin_checkins` table, validates `data` against the
 * manifest's `fields`, serves `/api/v1/plugins/:id/checkins` CRUD, includes
 * the type in the unified timeline, and backs up/restores/deletes the data
 * automatically.
 *
 * When `storage` is 'custom' the plugin owns its tables (created by a
 * migration in the main repo) and must implement `buildTimelineSelect`,
 * `backupExport`, `backupImport`, and (for start-over) `deleteUserData`.
 */
/**
 * Everything the unified timeline route knows about a request, handed to a
 * custom-storage plugin so it can build its own WHERE clause.
 */
export interface PluginTimelineContext {
  user_id: string | null;
  /** Inclusive start date (YYYY-MM-DD) in the check-in's local timezone. */
  from: string | null;
  /** Inclusive end date (YYYY-MM-DD) in the check-in's local timezone. */
  to: string | null;
  /** Free-text search query. */
  q: string | null;
  /** This plugin's active filter params (name -> value), from the URL. */
  filterParams: Record<string, string>;
}

export interface CheckinTypeServerPlugin {
  /** Defaults to 'generic'. */
  storage?: 'generic' | 'custom';

  /**
   * Optional plugin-owned API routes. The framework mounts `router` at
   * `/api/v1<mount>` (e.g. mount '/mood-checkins' -> /api/v1/mood-checkins).
   * Custom-storage plugins typically own their CRUD routes this way;
   * generic-storage plugins use the framework's
   * /api/v1/plugins/:id/checkins instead.
   *
   * Typed loosely (an Express Router) to keep this package framework-free.
   */
  api?: {
    mount: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    router: any;
  };

  /**
   * Timeline SELECT branch for this type. The returned SQL must be a single
   * SELECT producing at least these columns:
   *
   *   '<pluginId>' AS type,
   *   id,
   *   user_id,
   *   notes,
   *   checked_in_at,
   *   created_at,
   *   <tz expression> AS timezone,
   *   <jsonb expression> AS data
   *
   * plus any legacy columns the existing client card components expect
   * (during the transition, migrated built-in types keep their wire shape).
   *
   * The framework appends `WHERE <where> ORDER BY checked_in_at DESC
   * LIMIT/OFFSET` (the where comes from buildTimelineWhere).
   *
   * Required for custom storage; ignored for generic storage.
   */
  buildTimelineSelect?: () => { sql: string };

  /**
   * Build the WHERE clause for the timeline branch, combining the shared
   * user/date/search conditions with this plugin's own filter params.
   * Placeholders must be positional starting at $1. Returns null sql when
   * no conditions apply (rare; user_id usually applies).
   *
   * Required for custom storage. Generic storage builds this itself.
   */
  buildTimelineWhere?: (ctx: PluginTimelineContext) => PluginFilterClause;

  /**
   * Extra tables to include in backups for custom storage. For each table
   * the framework runs `select` with [user_id] and stores the rows under
   * `table` in the backup; on restore it runs `insert` row by row
   * ([user_id, ...rowValues] when `userIdFirst` is set, else [...rowValues]).
   * `insert` must be idempotent (ON CONFLICT ... DO NOTHING / DO UPDATE).
   */
  extraBackupTables?: {
    table: string;
    select: string;
    insert: string;
    /** True when the insert statement takes user_id as its first param. */
    userIdFirst?: boolean;
  }[];

  /**
   * Restore order for backups: a sequence of 'primary' (rows restored by
   * backupImport) and extraBackupTables table names. Defaults to
   * ['primary', ...extra table names] when omitted. Use this to satisfy FK
   * ordering (e.g. groups -> activities -> primary -> junctions).
   */
  backupOrder?: string[];

  /**
   * Legacy backup data keys this plugin takes over at import time (e.g. a
   * custom-storage plugin replacing a hard-coded type claims
   * ['moodCheckins', 'moodCheckinActivities']). When the backup contains
   * this plugin's `plugins.<id>` payload, the framework skips the legacy
   * import for these keys and restores via backupImport/extraBackupTables
   * instead. Old backups without a plugins payload keep the legacy path.
   */
  legacyBackupKeys?: string[];

  /** Custom storage: serialize this user's check-in rows for backup. */
  backupExport?: (ctx: PluginHookContext) => Promise<unknown>;

  /**
   * Custom storage: restore rows previously produced by backupExport.
   * Returns the number of rows restored.
   */
  backupImport?: (ctx: PluginHookContext, payload: unknown) => Promise<number>;

  /**
   * Start-over hook: delete all of this user's data for this type. Returns
   * the number of rows deleted. Generic storage implements this
   * automatically.
   */
  deleteUserData?: (ctx: PluginHookContext) => Promise<number>;

  /** Settings keys persisted in the generic `plugin_settings` table. */
  settingsKeys?: PluginSettingsKey[];
}

/** Props passed to a plugin-provided timeline card component. */
export interface CheckinCardProps {
  item: PluginTimelineEntry;
  compact?: boolean;
  /** Integration URLs the app has loaded from settings (immich_url, maloja_url, ...). */
  integrations: Record<string, string | null>;
  /**
   * The plugin's manifest fields. Provided by the framework so the default
   * AutoCheckInCard can render label/value chips without importing the
   * plugin itself. Custom cards may ignore this.
   */
  fields?: PluginField[] | null;
  /** Immich assets resolved for this check-in (when photo enrichment is enabled). */
  // Typed loosely to avoid coupling the contract to the client's asset shapes.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  photos?: any[] | null;
  /** Music scrobbles associated with this check-in. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  scrobbles?: any[];
  /** The user's icon-pack preference (e.g. 'emoji' | 'lucide' | 'nature'). */
  iconPack?: string;
}

/** Props passed to a plugin-provided check-in (create + edit) page. */
export interface CheckInFormProps {
  /** Present when editing an existing check-in. */
  editId?: string | null;
  /** Date (YYYY-MM-DD) to prefill, when opened from a timeline day dot. */
  dateParam?: string | null;
  /** Called after a successful create; the app navigates Home with the new id. */
  onCreated: (id: string) => void;
  /** Called after a successful edit. */
  onUpdated: () => void;
}

/** Props passed to a plugin-provided detail page. */
export interface CheckInDetailProps {
  id: string;
}

/** Props passed to a plugin-provided Home timeline filter section. */
export interface PluginFilterSectionProps {
  /** True when this type is included in the timeline. */
  included: boolean;
  /** True when this type's filters are locked out by another type's filter. */
  filtersDisabled: boolean;
  /** True when the type is excluded (section shown but controls inert). */
  sectionDisabled: boolean;
  /** True when the type toggle is locked out by another type's filter. */
  typeToggleDisabled: boolean;
  /** This plugin's active filter param values (from the URL). */
  params: Record<string, string>;
  onToggleIncluded: () => void;
  onSetParam: (name: string, value: string) => void;
  /** Optional: fetch filter option lists (e.g. distinct values). */
  loadOptions?: () => Promise<Record<string, unknown>>;
}

/** Props passed to a plugin-provided Profile tab. */
export interface PluginProfileTabProps {
  userId: string;
}

/**
 * Client half of a check-in type plugin.
 */
export interface CheckinTypeClientPlugin {
  /** Icon component (e.g. a lucide-react icon) shown in the FAB, filters, etc. */
  icon: AnyComponent<{ size?: number; className?: string }>;
  /** Tailwind text color class for the icon, e.g. 'text-green-500'. */
  iconColor?: string;
  /** Single-keyboard-character hotkey on Home (e.g. 'm'). */
  hotkey?: string;
  /** Ordering weight in the expandable FAB (lower = first). Default 100. */
  fabOrder?: number;
  /** Route of the new check-in page, e.g. '/mood-check-in'. */
  checkInPath: string;
  /**
   * Route pattern for the detail page, e.g. '/mood-checkins/:id'. When
   * omitted the app routes details to `/checkins/:pluginId/:id` and renders
   * the generic detail page.
   */
  detailPath?: string;
  /**
   * Full UI for the check-in (create + edit) page. Omit to get
   * AutoCheckInForm generated from the manifest `fields`.
   */
  checkInForm?: AnyComponent<CheckInFormProps>;
  /** Full UI for the detail page. Omit to get the generic detail page. */
  detailPage?: AnyComponent<CheckInDetailProps>;
  /** Timeline card UI. Omit to get AutoCheckInCard generated from `fields`. */
  timelineCard?: AnyComponent<CheckinCardProps>;
  /**
   * Home timeline filter section. Omit to get the default type toggle only.
   */
  filterSection?: AnyComponent<PluginFilterSectionProps>;
  /** Profile tab content. Omit to get the auto check-in count tab. */
  profileTab?: AnyComponent<PluginProfileTabProps>;
  /** Settings > Integrations section. Optional. */
  integrationsSettings?: AnyComponent<Record<string, unknown>>;
  /** Settings > Data section. Optional. */
  dataSettings?: AnyComponent<{ jobRefreshKey?: number; onImportComplete?: () => void }>;
}

/**
 * Pure-data part of a plugin, shared verbatim by the client and server
 * halves. Lives in `plugins/<name>/manifest.ts`.
 */
export interface CheckinTypeManifest {
  /**
   * Stable unique id, e.g. 'mood'. Used in routes, the timeline `type`
   * column, plugin_checkins.plugin_id, and plugin_settings.plugin_id.
   * Must be a safe SQL/URL identifier: /^[a-z][a-z0-9_]*$/.
   */
  id: string;
  /** Plugin version string (semver). */
  version: string;
  /** The shape of the data stored with each check-in (required). */
  fields: PluginField[];
  /** All text strings associated with the check-in type (required). */
  strings: CheckinTypeStrings;
  /**
   * URL query params this plugin contributes to Home timeline filters
   * (names only, e.g. ['mood', 'activity']). The server scopes these into
   * the plugin's timeline WHERE; the framework keeps plugins' params
   * mutually exclusive with every other type's params, matching the
   * existing type-filter behavior.
   */
  filterParams?: string[];
}

/** Server-side view of a registered plugin: manifest + server half. */
export interface CheckinTypeServer extends CheckinTypeManifest {
  server: CheckinTypeServerPlugin;
}

/** Client-side view of a registered plugin: manifest + client half. */
export interface CheckinTypeClient extends CheckinTypeManifest {
  client: CheckinTypeClientPlugin;
}

/** Full plugin (manifest + both halves), for documentation and tests. */
export interface CheckinTypePlugin extends CheckinTypeManifest {
  server: CheckinTypeServerPlugin;
  client: CheckinTypeClientPlugin;
}

/** Validates plugin id shape. Exported so both registries enforce it. */
export const PLUGIN_ID_PATTERN = /^[a-z][a-z0-9_]*$/;

export function isValidPluginId(id: string): boolean {
  return PLUGIN_ID_PATTERN.test(id);
}

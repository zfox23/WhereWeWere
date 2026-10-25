/**
 * Music plugin constants. Dependency-free on purpose: `server.ts` uses them at
 * module load, while the service modules import the plugin registry (which
 * imports `server.ts`), so they can't live next to code that does.
 */

export const PLUGIN_ID = 'music';
export const DEFAULT_SESSION_GAP_MINUTES = 30;
export const DEFAULT_MIN_SESSION_TRACKS = 3;

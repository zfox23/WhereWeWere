/**
 * Only same-origin, app-relative paths may be opened from a notification
 * (the service worker and the page both apply this). Anything else opens
 * Home.
 */
export function safeNotificationPath(url: unknown): string {
  return typeof url === 'string' && url.startsWith('/') && !url.startsWith('//') && !url.includes('\\') ? url : '/';
}

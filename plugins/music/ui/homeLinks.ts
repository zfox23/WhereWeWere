/**
 * Links to a day on the Home timeline, optionally revealing one listening
 * session there (expanded and highlighted, as the music preview under other
 * check-ins does).
 */

import type { FocusSessionState } from '../../../client/src/components/MusicPreview';

export interface HomeDayLink {
  to: { pathname: string; search: string };
  state?: FocusSessionState;
}

/** Home filtered to `date` (YYYY-MM-DD), revealing `sessionId` when given; null without a date. */
export function homeDayLink(date: string | null | undefined, sessionId?: string | null): HomeDayLink | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return {
    to: { pathname: '/', search: `?from=${date}&to=${date}` },
    ...(sessionId ? { state: { focusSession: sessionId } } : {}),
  };
}

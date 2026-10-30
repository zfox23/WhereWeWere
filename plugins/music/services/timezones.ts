/**
 * Music plugin — per-scrobble timezone assignment. Scrobble sources send only
 * epoch seconds, so each play's zone comes from the core timezone anchors.
 */

export {
  loadTimezoneAnchors,
  resolveTimezones,
  timezoneAt,
  type TimezoneAnchor,
} from '../../../server/src/services/timezoneAnchors';

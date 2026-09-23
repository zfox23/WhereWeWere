/**
 * Location > Settings tab.
 *
 * Self-contained settings tab rendered by the core Settings page through the
 * plugin `settings` slot. Hosts the Swarm import section, moved out of the
 * core Data tab so it lives under Settings > Location.
 */

import { SwarmImportSection } from './SwarmImportSection';

export function LocationSettings() {
  return <SwarmImportSection />;
}

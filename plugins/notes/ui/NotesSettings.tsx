/**
 * Settings > Notes: the tag manager and the text-file and audio-file importers.
 */

import { useState } from 'react';
import { NotesImportSection } from './NotesImportSection';
import { AudioImportSection } from './AudioImportSection';
import { TagManager } from './TagManager';

export function NotesSettings() {
  // An import can create tags: refresh the manager afterwards.
  const [refreshKey, setRefreshKey] = useState(0);
  return (
    <div className="space-y-6">
      <TagManager refreshKey={refreshKey} />
      <NotesImportSection onImported={() => setRefreshKey((k) => k + 1)} />
      <AudioImportSection onImported={() => setRefreshKey((k) => k + 1)} />
    </div>
  );
}

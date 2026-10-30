/**
 * Settings > Notes: the tag manager and the text-file importer.
 */

import { useState } from 'react';
import { NotesImportSection } from './NotesImportSection';
import { TagManager } from './TagManager';

export function NotesSettings() {
  // An import can create tags: refresh the manager afterwards.
  const [refreshKey, setRefreshKey] = useState(0);
  return (
    <div className="space-y-6">
      <TagManager refreshKey={refreshKey} />
      <NotesImportSection onImported={() => setRefreshKey((k) => k + 1)} />
    </div>
  );
}

/** Everything the notes plugin adds to Settings > Integrations. */

import { EmbeddingSettings } from './EmbeddingSettings';
import { TranscriptionSettings } from './TranscriptionSettings';

export function NotesIntegrationSettings() {
  return (
    <>
      <EmbeddingSettings />
      <TranscriptionSettings />
    </>
  );
}

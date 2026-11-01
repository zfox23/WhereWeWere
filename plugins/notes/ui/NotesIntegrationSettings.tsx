/** Everything the notes plugin adds to Settings > Integrations. */

import { EmbeddingSettings } from './EmbeddingSettings';
import { TranscriptionSettings } from './TranscriptionSettings';
import { DiarizationSettings } from './DiarizationSettings';

export function NotesIntegrationSettings() {
  return (
    <>
      <EmbeddingSettings />
      <TranscriptionSettings />
      <DiarizationSettings />
    </>
  );
}

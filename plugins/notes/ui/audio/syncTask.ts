/**
 * Wires the audio upload queue and the sign-out guard into the app. Imported
 * for its side effects by the notes client entry.
 */

import { registerBackgroundTask } from '../../../../client/src/plugins/backgroundTasks';
import { registerSignOutGuard } from '../../../../client/src/utils/signOutGuards';
import { countUnsent, isOrphaned, listRecordings, recoverRecording, requestPersistentStorage } from './recordingStore';
import { processUploads, startUploadQueue } from './uploadQueue';

const UPLOAD_GRACE_MS = 15_000;

/** Recordings whose tab died (crash, closed tab, dead battery) become ordinary unsent recordings. */
export async function recoverOrphans(userId: string): Promise<number> {
  let recovered = 0;
  for (const meta of await listRecordings(userId)) {
    if (isOrphaned(meta) && (await recoverRecording(meta.id))) recovered += 1;
  }
  return recovered;
}

export async function signOutGuard(userId: string): Promise<boolean> {
  await recoverOrphans(userId);
  if ((await countUnsent(userId)) === 0) return true;
  // Try to send them first, but don't hold sign-out hostage to a bad connection.
  await Promise.race([processUploads(userId), new Promise((resolve) => setTimeout(resolve, UPLOAD_GRACE_MS))]);
  const left = await countUnsent(userId);
  if (left === 0) return true;
  return window.confirm(
    `${left === 1 ? '1 audio recording has' : `${left} audio recordings have`} not finished uploading.\n\n`
    + 'Signing out keeps them safely on this device and they will upload the next time you sign in here. '
    + 'Sign out anyway?',
  );
}

registerBackgroundTask((userId) => {
  void requestPersistentStorage();
  void recoverOrphans(userId).catch(() => {});
  return startUploadQueue(userId);
});
registerSignOutGuard(signOutGuard);

/**
 * Bring an existing audio file (voice memo, exported recording...) into the
 * same crash-safe pipeline as a live recording: it is stored in IndexedDB in
 * slices first, then uploaded by the queue.
 */

import { AUDIO_FILE_ACCEPT, audioMimeForName } from '../../audioTypes';
import { appendChunk, createRecording, deleteRecording, updateRecording, type RecordingMeta } from './recordingStore';

export const MAX_AUDIO_BYTES = 1024 * 1024 * 1024;
const SLICE_BYTES = 4 * 1024 * 1024;

export { AUDIO_FILE_ACCEPT };

/** The MIME type the server will accept for this file, or null if it isn't a supported audio file. */
export function audioMimeForFile(file: Pick<File, 'name' | 'type'>): string | null {
  return audioMimeForName(file.name, file.type);
}

export async function importAudioFile(userId: string, file: File): Promise<RecordingMeta> {
  const mime = audioMimeForFile(file);
  if (!mime) throw new Error(`${file.name} isn't a supported audio file (mp3, m4a, wav, ogg, webm, flac or aac).`);
  if (file.size === 0) throw new Error(`${file.name} is empty.`);
  if (file.size > MAX_AUDIO_BYTES) throw new Error(`${file.name} is larger than 1 GB.`);
  const meta = await createRecording({ userId, mime, filename: file.name, deviceLabel: null, source: 'file' });
  try {
    for (let off = 0, seq = 0; off < file.size; off += SLICE_BYTES, seq++) {
      await appendChunk(meta.id, seq, file.slice(off, off + SLICE_BYTES), 0);
    }
  } catch (err) {
    await deleteRecording(meta.id).catch(() => {});
    throw new Error(`Could not store ${file.name} on this device (${err instanceof Error ? err.message : 'storage error'}).`);
  }
  return (await updateRecording(meta.id, { state: 'stopped' }))!;
}

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { config } from '../../../server/src/config';

/** Per-file size cap for note audio (1 GB; 4 h of 256 kbps Opus is ~460 MB). */
export const MAX_AUDIO_BYTES = 1024 * 1024 * 1024;

const EXT_BY_MIME: Record<string, string> = {
  'audio/webm': '.webm',
  'audio/ogg': '.ogg',
  'audio/mp4': '.m4a',
  'audio/x-m4a': '.m4a',
  'audio/aac': '.aac',
  'audio/mpeg': '.mp3',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/flac': '.flac',
  'audio/x-flac': '.flac',
};

/** Extension for an accepted audio MIME type (codec parameters ignored), or null. */
export function audioExtForMime(mime: string): string | null {
  const base = mime.split(';')[0].trim().toLowerCase();
  return EXT_BY_MIME[base] ?? null;
}

/** <dataDir>/<userId>/uploads/note_audio/ */
export function noteAudioDir(userId: string): string {
  return path.join(config.dataDir, userId, 'uploads', 'note_audio');
}

/** Path of the stored original for an audio row. */
export function noteAudioPath(userId: string, audioId: string, ext: string): string {
  return path.join(noteAudioDir(userId), `${audioId}${ext}`);
}

/**
 * Move a finished upload (temp file) into the user's folder, verifying its
 * SHA-256 against what the client computed before the temp file is removed.
 * Copy + unlink rather than rename so it works across filesystems.
 */
export async function storeNoteAudio(
  userId: string,
  tmpPath: string,
  audioId: string,
  ext: string,
  expectedSha256?: string,
): Promise<{ path: string; sha256: string; bytes: number }> {
  const dir = noteAudioDir(userId);
  fs.mkdirSync(dir, { recursive: true });
  const dest = noteAudioPath(userId, audioId, ext);
  await fs.promises.copyFile(tmpPath, dest);
  const sha256 = await sha256File(dest);
  if (expectedSha256 && sha256 !== expectedSha256.toLowerCase()) {
    await fs.promises.unlink(dest).catch(() => {});
    throw new Error('Checksum mismatch; the stored audio does not match the upload');
  }
  const { size } = await fs.promises.stat(dest);
  await fs.promises.unlink(tmpPath).catch(() => {});
  return { path: dest, sha256, bytes: size };
}

export function deleteNoteAudioFile(filePath: string): void {
  fs.unlink(filePath, () => {});
}

export function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(filePath)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });
}

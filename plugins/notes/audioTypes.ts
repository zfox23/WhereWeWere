/**
 * Which audio files the notes plugin accepts. Shared by the server (upload
 * validation, import planning) and the client (file pickers, drag and drop),
 * so a folder drop and the server agree on what "supported" means.
 *
 * `.mp4` is deliberately absent: it is usually video, and a dropped folder
 * must not upload someone's video library. (Voice memos are `.m4a`.)
 */

export const AUDIO_MIME_BY_EXT: Record<string, string> = {
  '.webm': 'audio/webm',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
};

export const ACCEPTED_AUDIO_MIMES: ReadonlySet<string> = new Set([
  'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/flac', 'audio/x-flac',
]);

/** Lower-cased extension including the dot, or '' when the name has none. */
export function extensionOf(name: string): string {
  return /\.[^./\\]+$/.exec(name)?.[0].toLowerCase() ?? '';
}

/**
 * The audio MIME type for a file, from its browser-reported type when that is
 * one we accept, else from its extension; null when it isn't a supported
 * audio file (or is a hidden file such as macOS's `._name.m4a` resource forks).
 */
export function audioMimeForName(name: string, type = ''): string | null {
  const base = name.split(/[\\/]/).pop() ?? name;
  if (base.startsWith('.')) return null;
  const t = type.split(';')[0].trim().toLowerCase();
  if (ACCEPTED_AUDIO_MIMES.has(t)) return t;
  return AUDIO_MIME_BY_EXT[extensionOf(base)] ?? null;
}

export const AUDIO_FILE_ACCEPT = `${Object.keys(AUDIO_MIME_BY_EXT).join(',')},audio/*`;

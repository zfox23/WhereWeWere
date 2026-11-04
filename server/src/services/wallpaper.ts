/**
 * The signed-in user's photo wallpaper (Settings > Display > Background):
 * one image file per user at <dataDir>/<userId>/appearance/wallpaper.<ext>.
 * Account deletion removes it with the rest of <dataDir>/<userId>/.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from '../config';

/** Upload size cap; a phone photo or an Immich preview is well under this. */
export const MAX_WALLPAPER_BYTES = 15 * 1024 * 1024;

const CONTENT_TYPES = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
} as const;

export type WallpaperExt = keyof typeof CONTENT_TYPES;

export const WALLPAPER_EXTS = Object.keys(CONTENT_TYPES) as WallpaperExt[];
export const WALLPAPER_CONTENT_TYPES = Object.values(CONTENT_TYPES);

export function wallpaperContentType(ext: WallpaperExt): string {
  return CONTENT_TYPES[ext];
}

/**
 * Identify an image by its magic bytes (never trust the declared type: the
 * file is served back as an image). Null for anything else.
 */
export function sniffImageType(buf: Buffer): WallpaperExt | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (buf.length >= 12 && buf.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buf.toString('ascii', 8, 12);
    if (brand === 'avif' || brand === 'avis') return 'avif';
  }
  return null;
}

export function wallpaperDir(userId: string): string {
  return path.join(config.dataDir, userId, 'appearance');
}

/** The stored wallpaper, if any. */
export async function findWallpaper(userId: string): Promise<{ path: string; ext: WallpaperExt } | null> {
  const dir = wallpaperDir(userId);
  for (const ext of WALLPAPER_EXTS) {
    const file = path.join(dir, `wallpaper.${ext}`);
    try {
      await fs.access(file);
      return { path: file, ext };
    } catch {
      // not this extension
    }
  }
  return null;
}

/** Replace the wallpaper. Written to a temp file then renamed, so a reader never sees half a file. */
export async function saveWallpaper(userId: string, data: Buffer, ext: WallpaperExt): Promise<void> {
  const dir = wallpaperDir(userId);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.wallpaper-${randomUUID()}.tmp`);
  await fs.writeFile(tmp, data);
  await fs.rename(tmp, path.join(dir, `wallpaper.${ext}`));
  for (const other of WALLPAPER_EXTS) {
    if (other !== ext) await fs.rm(path.join(dir, `wallpaper.${other}`), { force: true });
  }
}

export async function deleteWallpaper(userId: string): Promise<boolean> {
  const existing = await findWallpaper(userId);
  for (const ext of WALLPAPER_EXTS) {
    await fs.rm(path.join(wallpaperDir(userId), `wallpaper.${ext}`), { force: true });
  }
  return existing !== null;
}

/**
 * Restore `appearance/wallpaper.<ext>` from an extracted backup, replacing
 * the current one. Returns whether a wallpaper was restored; a backup without
 * one leaves the current wallpaper alone.
 */
export async function restoreWallpaperFromBackup(userId: string, extractedRoot: string, errors: string[]): Promise<boolean> {
  for (const ext of WALLPAPER_EXTS) {
    const file = path.join(extractedRoot, 'appearance', `wallpaper.${ext}`);
    let data: Buffer;
    try {
      const stat = await fs.stat(file);
      if (stat.size > MAX_WALLPAPER_BYTES) {
        errors.push('Wallpaper in the backup is too large; skipped');
        return false;
      }
      data = await fs.readFile(file);
    } catch {
      continue;
    }
    const actual = sniffImageType(data);
    if (!actual) {
      errors.push('Wallpaper in the backup is not a supported image; skipped');
      return false;
    }
    await saveWallpaper(userId, data, actual);
    return true;
  }
  return false;
}

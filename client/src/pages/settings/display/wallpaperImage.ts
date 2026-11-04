import { MAX_WALLPAPER_BYTES, WALLPAPER_TYPES } from '../../../api/client';

/** Longest edge kept for a wallpaper: sharp on a large screen, small to load. */
const MAX_EDGE = 2560;
/** Files already this small (and an accepted type) are uploaded as they are. */
const KEEP_AS_IS_BYTES = 3 * 1024 * 1024;

/**
 * Turn a picked image into an upload: kept as-is when it's already a small
 * accepted type, otherwise decoded, scaled to MAX_EDGE and re-encoded as JPEG.
 * Throws a user-facing message when the browser can't read the image.
 */
export async function prepareWallpaper(file: Blob): Promise<Blob> {
  const accepted = (WALLPAPER_TYPES as readonly string[]).includes(file.type);
  if (accepted && file.size <= KEEP_AS_IS_BYTES) return file;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('This browser can’t read that image. Try a JPEG, PNG or WebP.');
  }
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Couldn’t prepare the image.');
    ctx.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86));
    if (!blob) throw new Error('Couldn’t prepare the image.');
    if (blob.size > MAX_WALLPAPER_BYTES) throw new Error('That image is too large, even after resizing.');
    return blob;
  } finally {
    bitmap.close();
  }
}

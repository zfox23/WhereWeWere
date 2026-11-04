import { describe, expect, it, vi } from 'vitest';
import { prepareWallpaper } from '../src/pages/settings/display/wallpaperImage';

describe('prepareWallpaper', () => {
  it('uploads a small image of an accepted type unchanged', async () => {
    const file = new Blob([new Uint8Array(1024)], { type: 'image/webp' });
    expect(await prepareWallpaper(file)).toBe(file);
  });

  it('explains when the browser cannot decode an image', async () => {
    vi.stubGlobal('createImageBitmap', () => Promise.reject(new Error('decode')));
    const heic = new Blob([new Uint8Array(1024)], { type: 'image/heic' });
    await expect(prepareWallpaper(heic)).rejects.toThrow(/can’t read that image/);
    vi.unstubAllGlobals();
  });
});

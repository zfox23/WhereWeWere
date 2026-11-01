import { createHash, randomBytes } from 'crypto';
import { describe, expect, it } from 'vitest';
import { Sha256, sha256Blob } from '../../ui/audio/sha256';

const ref = (b: Buffer) => createHash('sha256').update(b).digest('hex');

describe('Sha256', () => {
  it('matches known vectors', () => {
    expect(new Sha256().hex()).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(new Sha256().update(new TextEncoder().encode('abc')).hex()).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('matches node crypto for every length around block boundaries, however it is fed', () => {
    for (const len of [0, 1, 54, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 129, 1000, 4097]) {
      const data = randomBytes(len);
      expect(new Sha256().update(data).hex(), `len ${len}`).toBe(ref(data));
      // split at awkward points
      const h = new Sha256();
      for (let i = 0; i < len; i += 7) h.update(data.subarray(i, Math.min(i + 7, len)));
      expect(h.hex(), `len ${len} split`).toBe(ref(data));
    }
  });

  it('hashes a blob slice by slice', async () => {
    const data = randomBytes(300_000);
    expect(await sha256Blob(new Blob([data]), 64 * 1024 + 3)).toBe(ref(data));
  });
});

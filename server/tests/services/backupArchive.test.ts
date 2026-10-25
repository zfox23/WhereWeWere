import { afterEach, describe, expect, it } from 'vitest';
import { ZipArchive } from 'archiver';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  BACKUP_EXTRACT_LIMITS,
  extractBackupZip,
  removeBackupTempDir,
} from '../../src/services/backupArchive';

function makeZip(files: Record<string, string | Buffer>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = new ZipArchive({ zlib: { level: 9 } });
    const chunks: Buffer[] = [];
    archive.on('data', (c: Buffer) => chunks.push(c));
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', reject);
    for (const [name, content] of Object.entries(files)) archive.append(content, { name });
    archive.finalize();
  });
}

const defaults = { ...BACKUP_EXTRACT_LIMITS };
const roots: string[] = [];

afterEach(() => {
  Object.assign(BACKUP_EXTRACT_LIMITS, defaults);
  while (roots.length) removeBackupTempDir(roots.pop()!);
});

describe('extractBackupZip', () => {
  it('extracts from a buffer', async () => {
    const root = await extractBackupZip(await makeZip({ 'backup.json': '{"a":1}', 'plugins/x.json': '[]' }));
    roots.push(root);
    expect(fs.readFileSync(path.join(root, 'backup.json'), 'utf-8')).toBe('{"a":1}');
    expect(fs.existsSync(path.join(root, 'plugins/x.json'))).toBe(true);
  });

  it('extracts from an uploaded file on disk and leaves that file alone', async () => {
    const zip = await makeZip({ 'backup.json': '{"b":2}' });
    const uploaded = path.join(os.tmpdir(), `wwp-test-upload-${process.pid}.zip`);
    fs.writeFileSync(uploaded, zip);
    try {
      const root = await extractBackupZip(uploaded);
      roots.push(root);
      expect(fs.readFileSync(path.join(root, 'backup.json'), 'utf-8')).toBe('{"b":2}');
      expect(fs.existsSync(uploaded)).toBe(true);
    } finally {
      fs.rmSync(uploaded, { force: true });
    }
  });

  it('rejects an archive with too many entries and cleans up', async () => {
    BACKUP_EXTRACT_LIMITS.maxEntries = 3;
    const zip = await makeZip({ a: '1', b: '2', c: '3', d: '4' });
    const before = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('wherewewere-backup-restore-')).length;
    await expect(extractBackupZip(zip)).rejects.toThrow(/too many entries/);
    const after = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('wherewewere-backup-restore-')).length;
    expect(after).toBe(before);
  });

  it('rejects when the declared extracted size exceeds the total cap', async () => {
    BACKUP_EXTRACT_LIMITS.maxTotalBytes = 1000;
    const zip = await makeZip({ 'big.txt': Buffer.alloc(5000, 'a') });
    await expect(extractBackupZip(zip)).rejects.toThrow(/too large/);
  });

  it('rejects a single oversized entry', async () => {
    BACKUP_EXTRACT_LIMITS.maxEntryBytes = 1000;
    const zip = await makeZip({ 'big.txt': Buffer.alloc(5000, 'a') });
    await expect(extractBackupZip(zip)).rejects.toThrow(/too large/);
  });

  it('rejects a highly compressed entry (zip-bomb shape)', async () => {
    BACKUP_EXTRACT_LIMITS.minBytesForRatioCheck = 1000;
    BACKUP_EXTRACT_LIMITS.maxCompressionRatio = 10;
    const zip = await makeZip({ 'bomb.txt': Buffer.alloc(200_000, 0) });
    await expect(extractBackupZip(zip)).rejects.toThrow(/compression ratio/);
  });
});

/**
 * Backup v2 archive helpers: build the backup ZIP bundle (export) and
 * extract one safely (import).
 *
 * ZIP layout (see plans/backup-v2-zip.md):
 *   backup.json               manifest { format, schemaVersion, exportedAt, user, settings }
 *   plugins/<id>.json         one PluginBackupEntry per plugin
 *   plugins/<id>/files/...    optional plugin-owned files (e.g. tracks GPX)
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import archiver from 'archiver';
import type { Response } from 'express';
import * as unzipper from 'unzipper';
import type { PluginBackupPayload, PluginBackupFile } from '../plugins/backup';

export const BACKUP_FORMAT = 'wherewewere-backup';
export const LATEST_BACKUP_SCHEMA_VERSION = 2;

export interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  schemaVersion: number;
  exportedAt: string;
  user: unknown;
  settings: unknown;
}

/**
 * Zip an entire directory (contents, not the directory itself) into a
 * buffer. Used by tests to rebuild partial bundles.
 */
export function zipDirectory(dir: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 6 } });
    const chunks: Buffer[] = [];
    archive.on('data', (chunk) => chunks.push(chunk));
    archive.on('error', (err) => reject(err));
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.directory(dir, false);
    archive.finalize().catch(reject);
  });
}

/**
 * Stream a backup v2 ZIP to the HTTP response. Resolves when the archive is
 * fully written (and the response finished).
 */
export function streamBackupZip(
  res: Response,
  manifest: BackupManifest,
  pluginsPayload: PluginBackupPayload,
  files: PluginBackupFile[],
): Promise<void> {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 6 } });
    let settled = false;
    const done = (err?: Error) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve();
    };

    archive.on('warning', (err) => {
      done(err instanceof Error ? err : new Error(String(err)));
    });
    archive.on('error', (err) => {
      done(err);
    });
    res.on('close', () => {
      // Client went away mid-transfer: stop the archive. A clean close after
      // a full transfer is the normal completion; only treat an early close
      // (before 'end') as an abort.
      if (!res.writableEnded) {
        archive.abort();
        done();
      }
    });

    res.setHeader('Content-Type', 'application/zip');
    archive.pipe(res);

    archive.append(JSON.stringify(manifest, null, 2), { name: 'backup.json' });
    for (const [pluginId, entry] of Object.entries(pluginsPayload)) {
      archive.append(JSON.stringify(entry, null, 2), { name: `plugins/${pluginId}.json` });
    }
    for (const file of files) {
      if (!fs.existsSync(file.absPath)) continue; // row already fell back to inline
      archive.file(file.absPath, { name: `plugins/${file.pluginId}/${file.zipPath}` });
    }

    archive.finalize().then(() => done(), (err) => done(err));
  });
}

/**
 * Validate an archive entry name: relative, no `..` segments, and the
 * resolved destination must stay inside `root`. Returns the destination
 * path, or null for unsafe names.
 */
function safeArchiveDest(root: string, name: string): string | null {
  if (name.startsWith('/') || name.split(/[\\/]/).some((seg) => seg === '..')) return null;
  const dest = path.resolve(root, name);
  if (dest !== path.resolve(root) && !dest.startsWith(path.resolve(root) + path.sep)) return null;
  return dest;
}

/**
 * Extract a backup ZIP buffer into a fresh temp directory. Rejects entries
 * with absolute paths or `..` segments (path traversal). Returns the
 * extracted root directory; the caller must remove it when done.
 */
export async function extractBackupZip(zipBuffer: Buffer): Promise<string> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wherewewere-backup-restore-'));
  const zipPath = path.join(root, '__backup.zip');

  try {
    fs.writeFileSync(zipPath, zipBuffer);
    const cd = await unzipper.Open.file(zipPath);

    for (const file of cd.files) {
      const name = file.path;
      if (file.type === 'Directory') {
        const dest = safeArchiveDest(root, name);
        if (dest === null) {
          throw new Error(`Blocked unsafe path in backup archive: ${name}`);
        }
        fs.mkdirSync(dest, { recursive: true });
        continue;
      }

      const dest = safeArchiveDest(root, name);
      if (dest === null) {
        throw new Error(`Blocked unsafe path in backup archive: ${name}`);
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true });

      const entry = file.stream();
      await new Promise<void>((resolve, reject) => {
        const out = fs.createWriteStream(dest);
        out.on('finish', () => resolve());
        out.on('error', reject);
        entry.on('error', reject);
        entry.pipe(out);
      });
    }

    fs.unlinkSync(zipPath);
  } catch (err) {
    fs.rmSync(root, { recursive: true, force: true });
    throw err;
  }

  return root;
}

/** Read a JSON file from an extracted backup bundle, or null when absent. */
export function readBackupJsonFile(root: string, relPath: string): unknown | null {
  const abs = path.join(root, relPath);
  if (!abs.startsWith(path.resolve(root) + path.sep) || !fs.existsSync(abs)) return null;
  try {
    return JSON.parse(fs.readFileSync(abs, 'utf-8'));
  } catch {
    return null;
  }
}

/** List `plugins/<id>.json` entries present in an extracted bundle. */
export function listBackupPluginFiles(root: string): string[] {
  const dir = path.join(root, 'plugins');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.slice(0, -'.json'.length));
}

/** Remove an extracted bundle directory, ignoring cleanup failures. */
export function removeBackupTempDir(root: string): void {
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

/**
 * Multer upload factory for plugin-owned file-import endpoints.
 *
 * Plugins that import user files (e.g. Daylio or Sleep as Android exports)
 * previously each re-declared the same disk-storage config (shared temp
 * directory, uuid-prefixed filenames, 50 MB limit). Use this factory
 * instead so all plugin imports land in the same temp directory with the
 * same limits.
 */

import multer from 'multer';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';
import type { Request } from 'express';
import type { FileFilterCallback } from 'multer';

/** Shared temp directory for user-uploaded import files. */
const IMPORT_TMP_DIR = path.join(os.tmpdir(), 'wherewewere-import');

export interface UploadOptions {
  /** Decide whether to accept a file; error to surface when rejecting. */
  fileFilter: (file: Express.Multer.File) => string | null;
  /** Max file size in bytes (default 50 MB). */
  fileSize?: number;
}

export function createImportUpload({
  fileFilter,
  fileSize = 50 * 1024 * 1024,
}: UploadOptions) {
  const storage = multer.diskStorage({
    destination: (_req: Request, _file: Express.Multer.File, cb) => {
      fs.mkdirSync(IMPORT_TMP_DIR, { recursive: true });
      cb(null, IMPORT_TMP_DIR);
    },
    filename: (_req: Request, file: Express.Multer.File, cb) => {
      cb(null, `${uuidv4()}-${file.originalname}`);
    },
  });
  return multer({
    storage,
    fileFilter: (req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
      const error = fileFilter(file);
      if (error) cb(new Error(error));
      else cb(null, true);
    },
    limits: { fileSize },
  });
}

/** Delete a temp import file, ignoring cleanup failures. */
export function removeImportFile(filePath: string): void {
  try {
    fs.unlinkSync(filePath);
  } catch {
    /* ignore */
  }
}

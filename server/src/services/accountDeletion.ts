/**
 * Permanently delete a user account and everything it owns.
 *
 * Almost every owned table cascades from users(id); `checkins` doesn't, and
 * shared venues only record their creator, so those are handled first. One
 * transaction: any leftover reference aborts the whole delete. Uploaded files
 * under DATA_DIR/<user id>/ go after the commit.
 */

import fs from 'fs/promises';
import path from 'path';
import { pool } from '../db';
import { config } from '../config';

export async function deleteUserAccount(userId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM checkins WHERE user_id = $1', [userId]);
    // Venues are a shared catalog: keep the ones this user created.
    await client.query('UPDATE venues SET created_by = NULL WHERE created_by = $1', [userId]);
    await client.query('DELETE FROM users WHERE id = $1', [userId]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  await fs.rm(path.join(config.dataDir, userId), { recursive: true, force: true });
}

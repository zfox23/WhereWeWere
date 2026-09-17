import { query, pool } from '../../src/db';
import { config } from '../../src/config';
import { runMigrations } from '../../src/db/runMigrations';
import { Pool } from 'pg';

import { DEFAULT_USER_ID } from '../../src/constants';

function assertSafeTestDatabase() {
  const dbUrl = config.databaseUrl;
  const parsed = new URL(dbUrl);
  const dbName = parsed.pathname.replace(/^\//, '');

  if (!dbName.toLowerCase().includes('test')) {
    throw new Error(
      `Refusing to run integration tests against non-test database "${dbName}". Set DATABASE_URL to a dedicated test database.`
    );
  }
}

function quoteIdentifier(identifier: string) {
  return `"${identifier.replace(/"/g, '""')}"`;
}

async function ensureTestDatabaseExists() {
  const parsed = new URL(config.databaseUrl);
  const dbName = parsed.pathname.replace(/^\//, '');

  const adminUrl = new URL(config.databaseUrl);
  adminUrl.pathname = '/postgres';

  const adminPool = new Pool({ connectionString: adminUrl.toString() });

  try {
    const existsResult = await adminPool.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [dbName]
    );

    if (existsResult.rowCount === 0) {
      await adminPool.query(`CREATE DATABASE ${quoteIdentifier(dbName)}`);
    }
  } finally {
    await adminPool.end();
  }
}

/**
 * A failed test can release a pool connection that still holds an open or
 * aborted transaction. pg-pool has no public API to reset pooled clients, so
 * reach in and roll back any open transactions; otherwise the poisoned
 * connection surfaces later as "current transaction is aborted" and a
 * silently skipped TRUNCATE leaks data between tests.
 */
async function releaseStaleTransactions() {
  const clients: Array<{ query?: (sql: string) => Promise<unknown> }> =
    ((pool as unknown as { _clients?: unknown[] })._clients ?? []) as Array<{
      query?: (sql: string) => Promise<unknown>;
    }>;
  for (const client of clients) {
    try {
      await client.query?.('ROLLBACK');
    } catch {
      /* dead client or in-flight query — ignore */
    }
  }
}

export async function setupIntegrationDatabase() {
  assertSafeTestDatabase();
  await ensureTestDatabaseExists();
  await releaseStaleTransactions();
  await runMigrations(pool);
}

export async function resetIntegrationDatabase() {
  await releaseStaleTransactions();
  const tableResult = await query(
    `SELECT tablename
     FROM pg_tables
     WHERE schemaname = 'public'
       AND tablename <> 'schema_migrations'`
  );

  const tableNames = tableResult.rows.map((row: { tablename: string }) => row.tablename);
  if (tableNames.length > 0) {
    const quoted = tableNames.map((name: string) => `"${name}"`).join(', ');
    await query(`TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE`);
  }

  await query(
    `INSERT INTO users (id, username, email, password_hash, display_name)
     VALUES ($1, 'default', 'user@wherewewere.local', 'no-auth', 'Default User')
     ON CONFLICT (id) DO NOTHING`,
    [DEFAULT_USER_ID]
  );
}

export async function teardownIntegrationDatabase() {
  await pool.end();
}

export { DEFAULT_USER_ID };

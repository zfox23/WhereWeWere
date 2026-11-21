import { query, pool } from '../../src/db';
import { config } from '../../src/config';
import { runMigrations } from '../../src/db/runMigrations';
import { Pool } from 'pg';

import { DEFAULT_USER_ID } from '../../src/constants';
import { resetLoginThrottle } from '../../src/auth/rateLimit';
import { createTestSession, DEFAULT_SESSION_TOKEN } from './auth';

function assertSafeTestDatabase() {
  const dbUrl = config.databaseUrl;
  const parsed = new URL(dbUrl);
  const dbName = parsed.pathname.replace(/^\//, '');

  if (!dbName.toLowerCase().includes('test')) {
    throw new Error(
      `Refusing to run integration tests against non-test database "${dbName}". Set TEST_DATABASE_URL (e.g. postgres://user:pass@localhost:5432/wherewewere_test) in .env or your shell; the test DB is created automatically.`
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

interface ResetPlan {
  tables: string[];
  /** One query naming the tables that hold any rows. */
  nonEmptySql: string;
  sequences: string[];
}

let resetPlan: ResetPlan | null = null;

async function getResetPlan(): Promise<ResetPlan> {
  if (resetPlan) return resetPlan;
  const tables = (
    await query(
      `SELECT tablename FROM pg_tables
       WHERE schemaname = 'public' AND tablename <> 'schema_migrations'
       ORDER BY tablename`
    )
  ).rows.map((row: { tablename: string }) => row.tablename);
  const sequences = (
    await query(`SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema = 'public'`)
  ).rows.map((row: { sequence_name: string }) => row.sequence_name);
  resetPlan = {
    tables,
    nonEmptySql: tables
      .map((t: string) => `SELECT ${quoteLiteral(t)} AS t WHERE EXISTS (SELECT 1 FROM ${quoteIdentifier(t)})`)
      .join(' UNION ALL '),
    sequences,
  };
  return resetPlan;
}

function quoteLiteral(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

async function truncateAll(plan: ResetPlan) {
  if (plan.tables.length === 0) return;
  await query(`TRUNCATE TABLE ${plan.tables.map(quoteIdentifier).join(', ')} RESTART IDENTITY CASCADE`);
}

/**
 * Empty every table, as `TRUNCATE ... RESTART IDENTITY` of them all would.
 *
 * TRUNCATE gives every table and index a new file, which costs ~0.5 s for
 * ~60 tables even when nearly all are empty (and nearly every table
 * references users, so CASCADE always pulls in the lot). Instead, DELETE
 * from just the tables holding rows - usually a handful - with triggers and
 * foreign-key checks off for that one transaction (session_replication_role,
 * superuser only): every table that holds rows is emptied, so nothing is
 * left dangling. Falls back to TRUNCATE when that isn't allowed.
 */
async function emptyAllTables() {
  const plan = await getResetPlan();
  const nonEmpty = (await query(plan.nonEmptySql)).rows.map((row: { t: string }) => row.t);
  const restartSequences = plan.sequences.map((s) => `ALTER SEQUENCE ${quoteIdentifier(s)} RESTART;`).join(' ');
  if (nonEmpty.length === 0) {
    if (restartSequences) await query(restartSequences);
    return;
  }
  try {
    // One simple-protocol query runs as a single implicit transaction, so
    // SET LOCAL lasts exactly as long as the deletes, and an error rolls
    // the whole thing back (and leaves no open transaction on the client).
    await query(
      `SET LOCAL session_replication_role = replica; ${nonEmpty
        .map((t: string) => `DELETE FROM ${quoteIdentifier(t)};`)
        .join(' ')} ${restartSequences}`
    );
  } catch {
    await truncateAll(plan);
  }
}

export async function resetIntegrationDatabase() {
  await releaseStaleTransactions();
  await emptyAllTables();

  await query(
    `INSERT INTO users (id, username, email, password_hash, display_name, is_admin)
     VALUES ($1, 'default', 'user@wherewewere.local', 'no-auth', 'Default User', TRUE)
     ON CONFLICT (id) DO NOTHING`,
    [DEFAULT_USER_ID]
  );
  // Suites send this session's cookie by default (see helpers/auth.ts).
  await createTestSession(DEFAULT_USER_ID, DEFAULT_SESSION_TOKEN);
  resetLoginThrottle();
}

export async function teardownIntegrationDatabase() {
  await pool.end();
}

export { DEFAULT_USER_ID };

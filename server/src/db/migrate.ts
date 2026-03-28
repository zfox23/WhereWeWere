import fs from 'fs';
import path from 'path';
import { pool } from './index';

async function migrate() {
  const client = await pool.connect();
  try {
    // Create migrations table
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Get applied migrations
    const { rows } = await client.query('SELECT version FROM schema_migrations ORDER BY version');
    const applied = new Set(rows.map((r: any) => r.version));

    // Read migration files
    const migrationsDir = path.resolve(__dirname, 'migrations');
    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const version = parseInt(file.split('_')[0], 10);
      if (applied.has(version)) {
        console.log(`Migration ${file} already applied, skipping.`);
        continue;
      }

      console.log(`Applying migration ${file}...`);
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
        await client.query('COMMIT');
        console.log(`Migration ${file} applied successfully.`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }

    console.log('All migrations applied.');
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});

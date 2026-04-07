import { pool } from './index';
import { runMigrations } from './runMigrations';

async function migrate() {
  try {
    await runMigrations(pool);
    console.log('All migrations applied.');
  } finally {
    await pool.end();
  }
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});

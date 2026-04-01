import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { config } from './config';
import { pool } from './db';
import { checkinsRouter } from './routes/checkins';
import { venuesRouter } from './routes/venues';
import { statsRouter } from './routes/stats';
import { searchRouter } from './routes/search';
import { settingsRouter } from './routes/settings';
import { importRouter } from './routes/import';
import { jobsRouter } from './routes/jobs';
import { scrobblesRouter } from './routes/scrobbles';
import { immichRouter } from './routes/immich';
import { moodCheckinsRouter } from './routes/mood-checkins';
import { moodActivitiesRouter } from './routes/mood-activities';
import { timelineRouter } from './routes/timeline';

const app = express();

app.use(cors());
app.use(express.json());

// API routes
app.use('/api/v1/checkins', checkinsRouter);
app.use('/api/v1/venues', venuesRouter);
app.use('/api/v1/stats', statsRouter);
app.use('/api/v1/search', searchRouter);
app.use('/api/v1/settings', settingsRouter);
app.use('/api/v1/import/swarm', importRouter);
app.use('/api/v1/jobs', jobsRouter);
app.use('/api/v1/scrobbles', scrobblesRouter);
app.use('/api/v1/immich', immichRouter);
app.use('/api/v1/mood-checkins', moodCheckinsRouter);
app.use('/api/v1/mood-activities', moodActivitiesRouter);
app.use('/api/v1/timeline', timelineRouter);

// In production, serve client
if (config.nodeEnv === 'production') {
  const clientDist = path.resolve(__dirname, '../../client/dist');
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

// Run migrations on startup
async function runMigrations() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    const { rows } = await client.query('SELECT version FROM schema_migrations ORDER BY version');
    const applied = new Set(rows.map((r: any) => r.version));

    const migrationsDir = path.resolve(__dirname, 'db/migrations');
    if (!fs.existsSync(migrationsDir)) return;

    const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();

    for (const file of files) {
      const version = parseInt(file.split('_')[0], 10);
      if (applied.has(version)) continue;

      console.log(`Applying migration ${file}...`);
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
        await client.query('COMMIT');
        console.log(`Migration ${file} applied.`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
  } finally {
    client.release();
  }
}

runMigrations()
  .then(() => {
    app.listen(config.port, () => {
      console.log(`WhereWeWere server listening on port ${config.port}`);
    });
  })
  .catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });

export default app;

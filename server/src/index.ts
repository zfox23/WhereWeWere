import express from 'express';
import cors from 'cors';
import path from 'path';
import type { Request, Response, NextFunction } from 'express';
import { config } from './config';
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
import { importDaylioRouter } from './routes/import-daylio';
import { importSleepAsAndroidRouter } from './routes/import-sleep-as-android';
import { webhookSleepAsAndroidRouter } from './routes/webhook-sleep-as-android';
import { pushRouter } from './routes/push';
import { backupRouter } from './routes/backup';
import { sleepEntriesRouter } from './routes/sleep-entries';
import { sendMoodReminder } from './services/pushReminder';
import { runMigrations } from './db/runMigrations';

export function createApp() {
  const app = express();

  if (config.trustProxy) {
    app.set('trust proxy', true);
  }

  const corsOptions: cors.CorsOptions = config.corsOrigins.length > 0
    ? {
      origin: (origin, callback) => {
        // Allow non-browser requests and same-origin navigations without Origin header.
        if (!origin) {
          callback(null, true);
          return;
        }

        if (config.corsOrigins.includes(origin)) {
          callback(null, true);
          return;
        }

        callback(new Error('Origin not allowed by CORS'));
      },
    }
    : {};

  app.use(cors(corsOptions));
  app.use(express.json({ limit: '10mb' }));

  // Container health endpoint for compose/orchestrators.
  app.get('/healthz', (_req, res) => {
    res.status(200).json({ ok: true });
  });

  if (config.apiAccessToken) {
    app.use('/api/v1', (req: Request, res: Response, next: NextFunction) => {
      const token = req.header('x-wherewewere-token');
      if (token !== config.apiAccessToken) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      next();
    });
  }

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
  app.use('/api/v1/import/daylio', importDaylioRouter);
  app.use('/api/v1/import/sleep-as-android', importSleepAsAndroidRouter);
  app.use('/api/v1/webhook/sleep-as-android', webhookSleepAsAndroidRouter);
  app.use('/api/v1/sleep-entries', sleepEntriesRouter);
  app.use('/api/v1/push', pushRouter);
  app.use('/api/v1/backup', backupRouter);

  // In production, serve client
  if (config.nodeEnv === 'production') {
    const clientDist = path.resolve(__dirname, '../../client/dist');
    app.use(express.static(clientDist));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  return app;
}

export async function startServer() {
  await runMigrations();

  // Start mood reminder push scheduler
  const reminderIntervalMs = 60 * 1000; // Check every minute
  setInterval(async () => {
    try {
      await sendMoodReminder();
    } catch (err) {
      console.error('Error in mood reminder scheduler:', err);
    }
  }, reminderIntervalMs);

  const app = createApp();
  app.listen(config.port, () => {
    console.log(`WhereWeWere server listening on port ${config.port}`);
  });
}

if (require.main === module) {
  startServer().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}

const app = createApp();
export default app;

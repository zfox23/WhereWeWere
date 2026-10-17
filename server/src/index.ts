import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { config } from './config';
import { statsRouter } from './routes/stats';
import { settingsRouter } from './routes/settings';
import { jobsRouter } from './routes/jobs';
import { scrobblesRouter } from './routes/scrobbles';
import { immichRouter } from './routes/immich';
import { timelineRouter } from './routes/timeline';
import { backupRouter } from './routes/backup';
import { llmRouter } from './routes/llm';
import { importYamtrackRouter } from './routes/import-yamtrack';
import { companionsRouter } from './routes/companions';
import { runMigrations } from './db/runMigrations';
import { pluginsRouter } from './plugins/routes';
import { allPlugins } from './plugins/registry';

function tokensMatch(provided: string, expected: string): boolean {
  const a = crypto.createHash('sha256').update(provided).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

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
    // No allowlist configured: same-origin only (the bundled nginx proxy and
    // the Vite dev proxy both serve the API from the page's own origin), so
    // arbitrary websites can't read responses from a local instance.
    : { origin: false };

  app.use(cors(corsOptions));
  // Only the legacy JSON backup import needs a huge body; everything else
  // gets a modest limit. body-parser skips already-parsed requests, so the
  // order below matters.
  app.use('/api/v1/backup/import', express.json({ limit: '500mb' }));
  app.use(express.json({ limit: '10mb' }));

  // Container health endpoint for compose/orchestrators.
  app.get('/healthz', (_req, res) => {
    res.status(200).json({ ok: true });
  });

  if (config.apiAccessToken) {
    app.use('/api/v1', (req: Request, res: Response, next: NextFunction) => {
      const token = req.header('x-wherewewere-token') ?? '';
      if (!tokensMatch(token, config.apiAccessToken)) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      next();
    });
  }

  // API routes
  app.use('/api/v1/stats', statsRouter);
  app.use('/api/v1/settings', settingsRouter);
  app.use('/api/v1/jobs', jobsRouter);
  app.use('/api/v1/scrobbles', scrobblesRouter);
  app.use('/api/v1/immich', immichRouter);
  app.use('/api/v1/timeline', timelineRouter);
  app.use('/api/v1/backup', backupRouter);
  app.use('/api/v1/llm', llmRouter);
  app.use('/api/v1/import/yamtrack', importYamtrackRouter);
  app.use('/api/v1/plugins', pluginsRouter);
  app.use('/api/v1/companions', companionsRouter);

  // Plugin-owned API routes (custom-storage plugins mount their own CRUD).
  for (const plugin of allPlugins()) {
    if (plugin.server.api) {
      const mounts = Array.isArray(plugin.server.api)
        ? plugin.server.api
        : [plugin.server.api];
      for (const mount of mounts) {
        app.use(`/api/v1${mount.mount}`, mount.router);
      }
    }
  }

  return app;
}

export async function startServer() {
  await runMigrations();

  const { cleanupStaleJobs } = await import('./services/jobs');
  await cleanupStaleJobs();

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

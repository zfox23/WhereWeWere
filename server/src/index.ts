import express from 'express';
import cors from 'cors';
import type { Request, Response, NextFunction } from 'express';
import { config } from './config';
import { statsRouter } from './routes/stats';
import { settingsRouter } from './routes/settings';
import { jobsRouter } from './routes/jobs';
import { immichRouter } from './routes/immich';
import { timelineRouter } from './routes/timeline';
import { backupRouter } from './routes/backup';
import { llmRouter } from './routes/llm';
import { importYamtrackRouter } from './routes/import-yamtrack';
import { companionsRouter } from './routes/companions';
import { runMigrations } from './db/runMigrations';
import { isUuid } from './services/batching';
import { tokensMatch } from './services/tokens';
import { pluginsRouter } from './plugins/routes';
import { allPlugins } from './plugins/registry';


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

  // Plugin routes that third-party clients call with their own credentials
  // (e.g. multi-scrobbler), so they sit outside the API_ACCESS_TOKEN guard.
  const rootMounts = allPlugins().flatMap((plugin) => {
    const api = plugin.server.rootApi;
    return api ? (Array.isArray(api) ? api : [api]) : [];
  });
  if (rootMounts.length > 0) {
    // Clients that join a base URL ending in "/" to an absolute path (e.g.
    // multi-scrobbler: "http://host:3001/" + "/apis/...") send a doubled
    // slash, which Express would otherwise 404.
    app.use((req: Request, _res: Response, next: NextFunction) => {
      if (req.url.startsWith('//') && rootMounts.some((m) => req.url.replace(/^\/+/, '/').startsWith(m.mount))) {
        req.url = req.url.replace(/^\/+/, '/');
      }
      next();
    });
    for (const mount of rootMounts) {
      app.use(mount.mount, mount.router);
    }
  }

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

  // `user_id` / `venue_id` query params feed uuid columns: a malformed value
  // would surface as a Postgres error (500). Reject it up front with a 400.
  app.use('/api/v1', (req: Request, res: Response, next: NextFunction) => {
    for (const key of ['user_id', 'venue_id']) {
      const value = req.query[key];
      if (value !== undefined && value !== '' && !(typeof value === 'string' && isUuid(value))) {
        res.status(400).json({ error: `${key} must be a valid UUID` });
        return;
      }
    }
    next();
  });

  // API routes
  app.use('/api/v1/stats', statsRouter);
  app.use('/api/v1/settings', settingsRouter);
  app.use('/api/v1/jobs', jobsRouter);
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

  // JSON error responses (Express's default handler renders HTML 500s).
  // Covers upload/body-parser/CORS failures that previously surfaced as a
  // generic 500 page.
  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    const e = err as { status?: number; statusCode?: number; code?: string; type?: string; message?: string };
    let status = e.status ?? e.statusCode ?? 500;
    let message = 'Internal server error';
    if (e.code === 'LIMIT_FILE_SIZE' || e.type === 'entity.too.large') {
      status = 413;
      message = 'Upload is too large';
    } else if (typeof e.code === 'string' && e.code.startsWith('LIMIT_')) {
      status = 400;
      message = e.message || 'Invalid upload';
    } else if (e.type === 'entity.parse.failed') {
      status = 400;
      message = 'Malformed JSON body';
    } else if (e.message === 'Origin not allowed by CORS') {
      status = 403;
      message = e.message;
    } else if (e.message === 'Only backup .json or .zip files are allowed') {
      status = 400;
      message = e.message;
    } else if (status >= 400 && status < 500 && e.message) {
      message = e.message;
    }
    if (status >= 500) console.error('Unhandled request error:', err);
    res.status(status).json({ error: message });
  });

  return app;
}

// One app instance, shared by the server entry point and by tests that import
// the default export (previously startServer built a second one).
const app = createApp();

export async function startServer() {
  await runMigrations();

  const { cleanupStaleJobs } = await import('./services/jobs');
  await cleanupStaleJobs();

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

export default app;

import { vi } from 'vitest';
import path from 'path';
import dotenv from 'dotenv';

// Integration tests TRUNCATE tables, so they must never inherit the app's
// DATABASE_URL. Point them at TEST_DATABASE_URL (shell or root .env) instead.
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) {
  throw new Error(
    'TEST_DATABASE_URL is not set. Integration tests wipe their database, so set it to a dedicated ' +
      'test database (same credentials/port as DATABASE_URL, e.g. ' +
      'postgres://wherewewere:wherewewere@localhost:5432/wherewewere_test) in .env or your shell. ' +
      'The database is created automatically if it does not exist.'
  );
}
process.env.DATABASE_URL = testUrl;

// Every `request(app).<verb>(...)` signs in as the default test user (see
// helpers/auth.ts). Override with `.set('Cookie', ...)` or `.unset('Cookie')`.
vi.mock('supertest', async (importOriginal) => {
  const actual = await importOriginal<typeof import('supertest')>();
  const { DEFAULT_SESSION_COOKIE } = await import('./auth');
  const VERBS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options']);
  const signedIn = ((app: Parameters<typeof actual.default>[0]) => {
    const agent = actual.default(app);
    return new Proxy(agent, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (typeof prop === 'string' && VERBS.has(prop) && typeof value === 'function') {
          return (...args: unknown[]) => value.apply(target, args).set('Cookie', DEFAULT_SESSION_COOKIE);
        }
        return value;
      },
    });
  }) as typeof actual.default;
  return { ...actual, default: signedIn };
});

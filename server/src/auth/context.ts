/**
 * The user a piece of server work is acting for.
 *
 * Authenticated requests (and webhook requests resolved by token) run inside
 * `runAsUser`, so routes, services, plugins, and fire-and-forget work they
 * start (jobs, enrichment) can call `currentUserId()` without threading the id
 * through every helper. Async continuations inherit the context.
 *
 * `currentUserId()` throws outside a user context rather than falling back to
 * a default: data written to the wrong account is far worse than a 500.
 */

import { AsyncLocalStorage, AsyncResource } from 'async_hooks';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

interface UserContext {
  userId: string;
}

const storage = new AsyncLocalStorage<UserContext>();

export function runAsUser<T>(userId: string, fn: () => T): T {
  return storage.run({ userId }, fn);
}

export function currentUserId(): string {
  const ctx = storage.getStore();
  if (!ctx) {
    throw new Error('No user context: this code must run inside an authenticated request or runAsUser()');
  }
  return ctx.userId;
}

/** The current user id, or null outside a user context. */
export function maybeCurrentUserId(): string | null {
  return storage.getStore()?.userId ?? null;
}

/**
 * Wrap middleware that resumes from a stream/event callback (multer, busboy)
 * so the user context survives into the handlers after it. Event emitters run
 * callbacks in the context of the socket that fed them, not the request.
 */
export function preserveUserContext(middleware: RequestHandler): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) =>
    middleware(req, res, AsyncResource.bind(next));
}

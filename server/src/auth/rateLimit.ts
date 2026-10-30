/**
 * In-memory login throttle. Failed attempts are counted per client IP and per
 * username; either bucket reaching the limit blocks further attempts for that
 * key until the window passes. A successful login clears the username bucket.
 *
 * In-memory is fine for a single server process; a restart only resets the
 * counters.
 */

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES_PER_USERNAME = 10;
const MAX_FAILURES_PER_IP = 30;

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

function live(key: string, now: number): Bucket | null {
  const bucket = buckets.get(key);
  if (!bucket) return null;
  if (bucket.resetAt <= now) {
    buckets.delete(key);
    return null;
  }
  return bucket;
}

function keys(ip: string, username: string) {
  return { ipKey: `ip:${ip}`, userKey: `user:${username.toLowerCase()}` };
}

/** Seconds until the caller may retry, or 0 when not throttled. */
export function loginRetryAfter(ip: string, username: string, now = Date.now()): number {
  const { ipKey, userKey } = keys(ip, username);
  const ipBucket = live(ipKey, now);
  const userBucket = live(userKey, now);
  const blockedUntil = Math.max(
    ipBucket && ipBucket.count >= MAX_FAILURES_PER_IP ? ipBucket.resetAt : 0,
    userBucket && userBucket.count >= MAX_FAILURES_PER_USERNAME ? userBucket.resetAt : 0
  );
  return blockedUntil > now ? Math.ceil((blockedUntil - now) / 1000) : 0;
}

export function recordLoginFailure(ip: string, username: string, now = Date.now()): void {
  const { ipKey, userKey } = keys(ip, username);
  for (const key of [ipKey, userKey]) {
    const bucket = live(key, now);
    if (bucket) bucket.count += 1;
    else buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
  }
}

export function recordLoginSuccess(username: string): void {
  buckets.delete(`user:${username.toLowerCase()}`);
}

/** Test hook. */
export function resetLoginThrottle(): void {
  buckets.clear();
}

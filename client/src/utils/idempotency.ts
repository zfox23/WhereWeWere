const MAX_SAFE_RANDOM = 999;

export function makeClientRefId(prefix: 'checkin' | 'mood'): string {
  return `${prefix}:${crypto.randomUUID()}`;
}

export function makeSleepExternalId(): number {
  // Keep the value within JS safe integer range while minimizing collisions.
  return Date.now() * 1000 + Math.floor(Math.random() * (MAX_SAFE_RANDOM + 1));
}
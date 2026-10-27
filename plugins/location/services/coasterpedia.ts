// ============================================================================
// Coasterpedia API client (https://api.coasterpedia.net/v1, read-only).
//
// Every request needs a bearer key (cpk_...) and a descriptive User-Agent;
// without a User-Agent Cloudflare answers 403 before the request reaches the
// API. The data is CC BY-SA 4.0, so anything shown from it must credit
// Coasterpedia contributors and link back to the record's `url`.
// ============================================================================

const BASE_URL = 'https://api.coasterpedia.net/v1';
const TIMEOUT_MS = 15_000;
const MAX_RETRY_WAIT_MS = 5_000;
/** The burst window is 60s, so a patient caller may need to wait that long. */
const PATIENT_RETRY_WAIT_MS = 65_000;
const PATIENT_RETRIES = 3;

/**
 * Coasterpedia asks for a web address and an email in the User-Agent. Set
 * COASTERPEDIA_CONTACT (e.g. "https://example.com; you@example.com") to
 * identify this install; the default only names the app.
 */
export function coasterpediaUserAgent(): string {
  const contact = process.env.COASTERPEDIA_CONTACT || 'self-hosted';
  return `WhereWeWere/1.0 (${contact})`;
}

export class CoasterpediaError extends Error {
  constructor(message: string, readonly status?: number, readonly problemType?: string) {
    super(message);
    this.name = 'CoasterpediaError';
  }

  /** The record no longer exists (deleted or never was), as opposed to not yet settled. */
  get isNotFound(): boolean {
    return this.status === 404 && this.problemType === 'not-found';
  }

  /** The key is missing, unknown or revoked, so every further call will fail too. */
  get isAuthFailure(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

export interface RequestOptions {
  /**
   * For batch work: wait out the full Retry-After (up to a minute) and retry
   * several times, instead of giving up after one short wait.
   */
  patient?: boolean;
}

/** The last path segment of an RFC 9457 problem `type`, e.g. "not-settled". */
async function problemTypeOf(res: Response): Promise<string | undefined> {
  if (!(res.headers.get('content-type') ?? '').includes('json')) return undefined;
  try {
    const body = (await res.json()) as { type?: unknown };
    return typeof body.type === 'string' ? body.type.split('/').pop() : undefined;
  } catch {
    return undefined;
  }
}

export interface CoasterpediaMeasurement {
  value: number;
  unit: string;
  entered?: { value: number; unit: string };
}

export interface CoasterpediaRef {
  id?: number | null;
  name: string;
}

export interface CoasterpediaSummary {
  id: number;
  type?: string;
  name: string;
  status?: string | null;
  park?: CoasterpediaRef;
  country?: { code?: string; name?: string } | null;
}

/** The full attraction record; only fields the card reads are typed. */
export interface CoasterpediaAttraction {
  id: number;
  name: string;
  url: string;
  type: string;
  status: string | null;
  dates?: Record<string, { edtf: string } | null>;
  location?: {
    park?: CoasterpediaRef;
    place?: string | null;
    state?: string | null;
    country?: { code?: string; name?: string } | null;
    area?: { section: string; subsection?: string | null } | null;
  };
  manufacturers?: CoasterpediaRef[];
  products?: { product: CoasterpediaRef; variant: string | null }[];
  designers?: CoasterpediaRef[];
  builders?: CoasterpediaRef[];
  categories?: string[];
  restraints?: string[];
  replaced?: CoasterpediaRef[];
  replaced_by?: CoasterpediaRef[];
  videos?: string[];
  cost?: { text: string };
  stats?: Record<string, unknown>;
  restrictions?: Record<string, unknown> | null;
  coaster?: Record<string, unknown> | null;
  history?: Record<string, unknown>;
}

async function coasterpediaGet<T>(path: string, apiKey: string, opts: RequestOptions = {}): Promise<T> {
  const maxRetries = opts.patient ? PATIENT_RETRIES : 1;
  const maxWait = opts.patient ? PATIENT_RETRY_WAIT_MS : MAX_RETRY_WAIT_MS;
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      // fetch follows the 301 the API sends for a merged record.
      res = await fetch(`${BASE_URL}${path}`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'User-Agent': coasterpediaUserAgent(),
          Accept: 'application/json',
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (res.status === 429 && attempt < maxRetries) {
      const seconds = Number(res.headers.get('retry-after'));
      const wait = Number.isFinite(seconds) ? seconds * 1000 : 1_000;
      await res.body?.cancel().catch(() => {});
      await new Promise((r) => setTimeout(r, Math.min(Math.max(wait, 250), maxWait)));
      continue;
    }
    if (res.ok) return (await res.json()) as T;

    const type = await problemTypeOf(res);
    if (res.status === 401) {
      throw new CoasterpediaError('Coasterpedia does not recognise the API key. Check it in Settings > Location', 401, type);
    }
    if (res.status === 403) {
      throw new CoasterpediaError(
        type === 'key-revoked'
          ? 'The Coasterpedia API key was revoked. Create a new one and save it in Settings > Location'
          : 'Coasterpedia refused the request (403). The key may be revoked, or the request was blocked: check COASTERPEDIA_CONTACT',
        403,
        type,
      );
    }
    if (res.status === 404) {
      throw new CoasterpediaError(
        type === 'not-settled'
          ? 'That Coasterpedia record is new and not in the settled data yet. Try again in a few days'
          : 'Coasterpedia has no such attraction',
        404,
        type,
      );
    }
    if (res.status === 429) throw new CoasterpediaError('Coasterpedia rate limit reached, try again shortly', 429, type);
    throw new CoasterpediaError(`Coasterpedia returned ${res.status}`, res.status, type);
  }
}

/** Search attractions by name; past names match too. */
export async function searchAttractions(name: string, apiKey: string, opts: RequestOptions = {}): Promise<CoasterpediaSummary[]> {
  const body = await coasterpediaGet<{ data: CoasterpediaSummary[] }>(
    `/attractions?q=${encodeURIComponent(name)}&limit=50`,
    apiKey,
    opts,
  );
  return body.data ?? [];
}

/** The settled (vetted) record for one attraction. */
export async function getAttraction(id: number, apiKey: string, opts: RequestOptions = {}): Promise<CoasterpediaAttraction> {
  const body = await coasterpediaGet<{ data: CoasterpediaAttraction }>(`/attractions/${id}`, apiKey, opts);
  return body.data;
}

/** Accepts a bare ID, or a Coasterpedia URL/API URL ending in an ID. Null if neither. */
export function parseAttractionId(input: string): number | null {
  const trimmed = input.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const m = trimmed.match(/\/attractions\/(\d+)(?:[/?#]|$)/);
  return m ? Number(m[1]) : null;
}

export function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export interface VenueMatchContext {
  name: string;
  parentName?: string | null;
  country?: string | null;
}

export type MatchOutcome =
  | { status: 'matched'; attractionId: number }
  | { status: 'ambiguous'; candidates: CoasterpediaSummary[] }
  | { status: 'no_match' };

/**
 * Pick an attraction for a venue. Auto-accepts only when exactly one result
 * has the venue's name; with several same-named results the venue's parent
 * park and country narrow them. Anything else is left for the user to choose.
 */
export function pickMatch(results: CoasterpediaSummary[], venue: VenueMatchContext): MatchOutcome {
  if (results.length === 0) return { status: 'no_match' };

  const key = normalizeName(venue.name);
  let exact = results.filter((r) => normalizeName(r.name) === key);

  if (exact.length > 1) {
    const parentKey = venue.parentName ? normalizeName(venue.parentName) : null;
    if (parentKey) {
      const atPark = exact.filter((r) => r.park?.name && normalizeName(r.park.name) === parentKey);
      if (atPark.length > 0) exact = atPark;
    }
  }
  if (exact.length > 1 && venue.country) {
    const countryKey = normalizeName(venue.country);
    const inCountry = exact.filter(
      (r) =>
        (r.country?.name && normalizeName(r.country.name) === countryKey) ||
        (r.country?.code && normalizeName(r.country.code) === countryKey),
    );
    if (inCountry.length > 0) exact = inCountry;
  }

  if (exact.length === 1) return { status: 'matched', attractionId: exact[0].id };
  return { status: 'ambiguous', candidates: (exact.length > 1 ? exact : results).slice(0, 10) };
}

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
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'CoasterpediaError';
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

async function coasterpediaGet<T>(path: string, apiKey: string): Promise<T> {
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

    if (res.status === 429 && attempt === 0) {
      const seconds = Number(res.headers.get('retry-after'));
      const wait = Number.isFinite(seconds) ? seconds * 1000 : 1_000;
      await res.body?.cancel().catch(() => {});
      await new Promise((r) => setTimeout(r, Math.min(Math.max(wait, 250), MAX_RETRY_WAIT_MS)));
      continue;
    }
    if (res.status === 401) throw new CoasterpediaError('Coasterpedia rejected the API key', 401);
    if (res.status === 404) throw new CoasterpediaError('Coasterpedia has no such attraction', 404);
    if (res.status === 429) throw new CoasterpediaError('Coasterpedia rate limit reached, try again shortly', 429);
    if (!res.ok) throw new CoasterpediaError(`Coasterpedia returned ${res.status}`, res.status);
    return (await res.json()) as T;
  }
}

/** Search attractions by name; past names match too. */
export async function searchAttractions(name: string, apiKey: string): Promise<CoasterpediaSummary[]> {
  const body = await coasterpediaGet<{ data: CoasterpediaSummary[] }>(
    `/attractions?q=${encodeURIComponent(name)}&limit=50`,
    apiKey,
  );
  return body.data ?? [];
}

/** The settled (vetted) record for one attraction. */
export async function getAttraction(id: number, apiKey: string): Promise<CoasterpediaAttraction> {
  const body = await coasterpediaGet<{ data: CoasterpediaAttraction }>(`/attractions/${id}`, apiKey);
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
    .replace(/[̀-ͯ]/g, '')
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

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Track last request time to enforce 1 req/sec rate limit
let lastRequestTime = 0;

async function rateLimitedFetch(url: string): Promise<Response> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < 1100) {
    await delay(1100 - elapsed);
  }
  lastRequestTime = Date.now();
  return fetch(url, {
    headers: { 'User-Agent': 'WhereWeWere/1.0 (self-hosted checkin app)' },
  });
}

export interface ReverseGeocodeResult {
  country?: string;
  state?: string;
  city?: string;
}

export async function reverseGeocode(
  lat: number,
  lng: number
): Promise<ReverseGeocodeResult> {
  try {
    const res = await rateLimitedFetch(
      `${NOMINATIM_BASE}/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1&zoom=10`
    );
    if (!res.ok) return {};
    const data: any = await res.json();
    const addr = data.address || {};
    return {
      country: addr.country,
      state: addr.state,
      city:
        addr.city || addr.town || addr.village || addr.municipality || addr.county,
    };
  } catch {
    return {};
  }
}

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

export interface PlaceSearchResult {
  name: string;
  latitude: number;
  longitude: number;
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

export async function searchPlacesByName(
  q: string,
  limit: number = 5,
): Promise<PlaceSearchResult[]> {
  const query = q.trim();
  if (!query) return [];

  try {
    const safeLimit = Math.min(Math.max(limit, 1), 10);
    const params = new URLSearchParams({
      q: query,
      format: 'jsonv2',
      addressdetails: '1',
      limit: String(safeLimit),
    });
    const res = await rateLimitedFetch(`${NOMINATIM_BASE}/search?${params.toString()}`);
    if (!res.ok) return [];

    const data = (await res.json()) as Array<{
      display_name?: string;
      lat?: string;
      lon?: string;
    }>;

    return data
      .map((item) => {
        const latitude = Number(item.lat);
        const longitude = Number(item.lon);
        if (!item.display_name || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
          return null;
        }
        return {
          name: item.display_name,
          latitude,
          longitude,
        };
      })
      .filter((item): item is PlaceSearchResult => item != null);
  } catch {
    return [];
  }
}

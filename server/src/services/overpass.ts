interface OverpassElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

export interface OSMVenueResult {
  name: string;
  category: string;
  latitude: number;
  longitude: number;
  address: string | null;
  osm_id: string;
}

// OSM tag keys we query and their value-to-category mappings
const OSM_TAG_CATEGORY_MAP: Record<string, Record<string, string>> = {
  amenity: {
    restaurant: 'Food',
    fast_food: 'Fast Food',
    cafe: 'Coffee Shop',
    bar: 'Bar',
    pub: 'Bar',
    nightclub: 'Nightclub',
    pharmacy: 'Pharmacy',
    hospital: 'Hospital',
    clinic: 'Health',
    dentist: 'Health',
    doctors: 'Health',
    school: 'School',
    university: 'University',
    library: 'Library',
    cinema: 'Cinema',
    theatre: 'Theater',
    place_of_worship: 'Place of Worship',
    bank: 'Bank',
    atm: 'ATM',
    fuel: 'Gas Station',
    parking: 'Parking',
    post_office: 'Post Office',
    police: 'Police Station',
    fire_station: 'Fire Station',
    community_centre: 'Community Center',
    marketplace: 'Market',
    ice_cream: 'Ice Cream',
    food_court: 'Food Court',
    biergarten: 'Beer Garden',
  },
  shop: {
    supermarket: 'Grocery Store',
    convenience: 'Convenience Store',
    bakery: 'Bakery',
    butcher: 'Butcher',
    clothes: 'Clothing Store',
    electronics: 'Electronics Store',
    hardware: 'Hardware Store',
    bookshop: 'Bookstore',
    mall: 'Shopping Mall',
    department_store: 'Department Store',
    hairdresser: 'Salon',
    beauty: 'Salon',
    florist: 'Florist',
    gift: 'Gift Shop',
    jewelry: 'Jewelry Store',
    optician: 'Optician',
    shoes: 'Shoe Store',
    sports: 'Sporting Goods',
    toys: 'Toy Store',
  },
  tourism: {
    hotel: 'Hotel',
    motel: 'Motel',
    hostel: 'Hostel',
    museum: 'Museum',
    gallery: 'Art Gallery',
    zoo: 'Zoo',
    aquarium: 'Aquarium',
    theme_park: 'Theme Park',
    viewpoint: 'Viewpoint',
    attraction: 'Attraction',
    information: 'Tourist Info',
    camp_site: 'Campground',
  },
  leisure: {
    park: 'Park',
    playground: 'Playground',
    garden: 'Garden',
    sports_centre: 'Gym',
    fitness_centre: 'Gym',
    swimming_pool: 'Pool',
    stadium: 'Stadium',
    pitch: 'Sports Field',
    golf_course: 'Golf Course',
    dog_park: 'Dog Park',
    beach_resort: 'Beach',
    marina: 'Marina',
  },
  aeroway: {
    aerodrome: 'Airport',
    terminal: 'Airport',
    helipad: 'Airport',
  },
  railway: {
    station: 'Train Station',
    halt: 'Train Station',
    tram_stop: 'Train Station',
    subway_entrance: 'Train Station',
  },
  building: {
    train_station: 'Train Station',
    transportation: 'Transit',
    hospital: 'Hospital',
    university: 'University',
    school: 'School',
    church: 'Place of Worship',
    mosque: 'Place of Worship',
    synagogue: 'Place of Worship',
    stadium: 'Stadium',
  },
  office: {
    government: 'Government',
    company: 'Office',
    coworking: 'Office',
  },
};

// The tag keys we include in the Overpass query
const QUERIED_OSM_TAGS = Object.keys(OSM_TAG_CATEGORY_MAP);

function mapOSMCategory(tags: Record<string, string>): string {
  for (const [tagKey, mappings] of Object.entries(OSM_TAG_CATEGORY_MAP)) {
    const tagValue = tags[tagKey];
    if (tagValue && mappings[tagValue]) {
      return mappings[tagValue];
    }
  }
  // Fallback: return the first recognized tag value or 'Other'
  for (const tagKey of QUERIED_OSM_TAGS) {
    if (tags[tagKey]) {
      // Capitalize the tag value as a fallback category name
      return tags[tagKey].replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    }
  }
  return 'Other';
}

function buildAddress(tags: Record<string, string>): string | null {
  const parts: string[] = [];
  if (tags['addr:housenumber'] && tags['addr:street']) {
    parts.push(`${tags['addr:housenumber']} ${tags['addr:street']}`);
  } else if (tags['addr:street']) {
    parts.push(tags['addr:street']);
  }
  if (tags['addr:city']) {
    parts.push(tags['addr:city']);
  }
  if (tags['addr:state']) {
    parts.push(tags['addr:state']);
  }
  if (tags['addr:postcode']) {
    parts.push(tags['addr:postcode']);
  }
  return parts.length > 0 ? parts.join(', ') : null;
}

export interface EnclosingVenueResult {
  name: string;
  category: string;
  latitude: number;
  longitude: number;
  address: string | null;
  osm_id: string;
}

// --- In-memory cache ---
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const cache = new Map<string, { data: unknown; expires: number }>();

function cacheKey(lat: number, lon: number, query: string | undefined, radius: number): string {
  // Round coordinates to ~111 m precision so nearby requests share cache entries
  const rlat = (Math.round(lat * 1000) / 1000).toFixed(3);
  const rlon = (Math.round(lon * 1000) / 1000).toFixed(3);
  return `${rlat},${rlon}|${radius}|${(query || '').toLowerCase()}`;
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  retries: number = 2,
): Promise<Response> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const response = await fetch(url, init);

    if (response.ok) return response;

    // Retry on 429 (rate limit) or 504 (gateway timeout), but not on other errors
    const retryable = response.status === 429 || response.status === 504;
    if (!retryable || attempt === retries) {
      throw new Error(`Overpass API error: ${response.status} ${response.statusText}`);
    }

    // Exponential backoff: 1 s, then 3 s
    const delayMs = response.status === 429 ? 1000 * (attempt + 1) * 2 : 1000 * (attempt + 1);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  // Unreachable, but satisfies TypeScript
  throw new Error('Overpass API: retries exhausted');
}

export async function searchNearbyVenues(
  lat: number,
  lon: number,
  query?: string,
  radius: number = 500
): Promise<OSMVenueResult[]> {
  // Check cache first
  const key = cacheKey(lat, lon, query, radius);
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) {
    return cached.data as OSMVenueResult[];
  }

  // When the user is searching by name, widen the radius so large features
  // (airports, parks, stadiums) whose centroid may be far from the user's
  // GPS position are still found.
  const searchRadius = query ? Math.max(radius, 3000) : radius;

  const nameFilter = query
    ? `[name~"${query}",i]`
    : '[name]';

  // Build union of node/way/relation for every tag key we track
  const stanzas = QUERIED_OSM_TAGS.flatMap((tag) => [
    `node["${tag}"]${nameFilter}(around:${searchRadius},${lat},${lon});`,
    `way["${tag}"]${nameFilter}(around:${searchRadius},${lat},${lon});`,
    `relation["${tag}"]${nameFilter}(around:${searchRadius},${lat},${lon});`,
  ]);

  const overpassQuery = `
    [out:json][timeout:15];
    (
      ${stanzas.join('\n      ')}
    );
    out center;
  `;

  const response = await fetchWithRetry('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: `data=${encodeURIComponent(overpassQuery)}`,
  });

  const data = (await response.json()) as { elements: OverpassElement[] };

  const results: OSMVenueResult[] = [];

  for (const element of data.elements) {
    const tags = element.tags || {};
    if (!tags.name) continue;

    // For nodes, lat/lon is direct. For ways, use center.
    const latitude = element.lat ?? element.center?.lat;
    const longitude = element.lon ?? element.center?.lon;

    if (latitude === undefined || longitude === undefined) continue;

    results.push({
      name: tags.name,
      category: mapOSMCategory(tags),
      latitude,
      longitude,
      address: buildAddress(tags),
      osm_id: `${element.type}/${element.id}`,
    });
  }

  // Store in cache
  cache.set(key, { data: results, expires: Date.now() + CACHE_TTL_MS });

  // Evict expired entries periodically (keep map from growing unbounded)
  if (cache.size > 100) {
    const now = Date.now();
    for (const [k, v] of cache) {
      if (v.expires < now) cache.delete(k);
    }
  }

  return results;
}

/**
 * Find the most relevant enclosing venue for a given point (e.g. the airport
 * that contains a terminal). Uses the Overpass `is_in` operator for true
 * spatial containment rather than radius-based proximity.
 */
export async function findEnclosingVenue(
  lat: number,
  lon: number,
  excludeOsmId: string,
): Promise<EnclosingVenueResult | null> {
  // Check cache
  const key = `enclosing|${lat.toFixed(4)},${lon.toFixed(4)}`;
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) {
    const results = cached.data as OverpassElement[];
    return pickBestEnclosing(results, excludeOsmId);
  }

  // Build stanzas filtering the is_in results to named features we care about
  const stanzas = QUERIED_OSM_TAGS.flatMap((tag) => [
    `way.enclosing["name"]["${tag}"];`,
    `relation.enclosing["name"]["${tag}"];`,
  ]);

  const overpassQuery = `
    [out:json][timeout:15];
    is_in(${lat},${lon})->.enclosing;
    (
      ${stanzas.join('\n      ')}
    );
    out center;
  `;

  try {
    const response = await fetchWithRetry(
      'https://overpass-api.de/api/interpreter',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(overpassQuery)}`,
      },
      1, // fewer retries — this is a secondary lookup
    );

    const data = (await response.json()) as { elements: OverpassElement[] };
    cache.set(key, { data: data.elements, expires: Date.now() + CACHE_TTL_MS });
    return pickBestEnclosing(data.elements, excludeOsmId);
  } catch {
    // Non-fatal — we just won't link a parent
    return null;
  }
}

// Priority order: prefer specific "place" categories over generic ones
const PARENT_CATEGORY_PRIORITY: Record<string, number> = {
  Airport: 10,
  'Train Station': 10,
  'Shopping Mall': 9,
  Stadium: 9,
  'Theme Park': 9,
  Museum: 8,
  University: 8,
  Hospital: 8,
  Park: 7,
  Zoo: 7,
};

function pickBestEnclosing(
  elements: OverpassElement[],
  excludeOsmId: string,
): EnclosingVenueResult | null {
  let best: { result: EnclosingVenueResult; priority: number } | null = null;

  for (const el of elements) {
    const tags = el.tags || {};
    if (!tags.name) continue;

    const osmId = `${el.type}/${el.id}`;
    if (osmId === excludeOsmId) continue;

    const category = mapOSMCategory(tags);
    const priority = PARENT_CATEGORY_PRIORITY[category] ?? 1;

    // Skip very generic results (landuse, boundaries, etc. that slip through)
    if (category === 'Other') continue;

    const latitude = el.lat ?? el.center?.lat;
    const longitude = el.lon ?? el.center?.lon;
    if (latitude === undefined || longitude === undefined) continue;

    if (!best || priority > best.priority) {
      best = {
        result: {
          name: tags.name,
          category,
          latitude,
          longitude,
          address: buildAddress(tags),
          osm_id: osmId,
        },
        priority,
      };
    }
  }

  return best?.result ?? null;
}

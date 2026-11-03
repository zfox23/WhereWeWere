import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildPhotonVenueUrl,
  clearVenueSearchCache,
  getSearchRadius,
  photonFeatureToVenue,
  searchNearbyVenues,
} from '../services/photonVenues';

const feature = (props: Record<string, unknown>, coords: [number, number] = [-76.6083, 39.2856]) => ({
  geometry: { coordinates: coords },
  properties: { name: 'National Aquarium', osm_type: 'R', osm_id: 14162263, osm_key: 'tourism', osm_value: 'aquarium', ...props },
});

describe('photonFeatureToVenue', () => {
  it('maps OSM type/id to the node|way|relation/<id> form used for dedupe and import', () => {
    expect(photonFeatureToVenue(feature({ osm_type: 'N', osm_id: 1 }))?.osm_id).toBe('node/1');
    expect(photonFeatureToVenue(feature({ osm_type: 'W', osm_id: 2 }))?.osm_id).toBe('way/2');
    expect(photonFeatureToVenue(feature({ osm_type: 'R', osm_id: 3 }))?.osm_id).toBe('relation/3');
  });

  it('reads GeoJSON [lon, lat] coordinates and formats the category', () => {
    expect(photonFeatureToVenue(feature({ osm_key: 'amenity', osm_value: 'fast_food' }))).toMatchObject({
      name: 'National Aquarium',
      category: 'Fast Food',
      latitude: 39.2856,
      longitude: -76.6083,
    });
  });

  it('falls back to the tag key when the value is just "yes"', () => {
    expect(photonFeatureToVenue(feature({ osm_key: 'historic', osm_value: 'yes' }))?.category).toBe('Historic');
  });

  it('builds a comma-separated address /import-osm can split', () => {
    expect(
      photonFeatureToVenue(
        feature({ housenumber: '501', street: 'East Pratt Street', city: 'Baltimore', state: 'Maryland', postcode: '21202' }),
      )?.address,
    ).toBe('501 East Pratt Street, Baltimore, Maryland, 21202');
    expect(photonFeatureToVenue(feature({}))?.address).toBeNull();
  });

  it('drops unnamed features, unknown OSM types and missing coordinates', () => {
    expect(photonFeatureToVenue(feature({ name: '  ' }))).toBeNull();
    expect(photonFeatureToVenue(feature({ osm_type: 'X' }))).toBeNull();
    expect(photonFeatureToVenue({ properties: feature({}).properties })).toBeNull();
  });
});

describe('buildPhotonVenueUrl', () => {
  it('uses /reverse with a km radius and place-tag filters for nearby searches', () => {
    const url = new URL(buildPhotonVenueUrl('https://photon.test', 39.28, -76.59, 2500));
    expect(url.pathname).toBe('/reverse');
    expect(url.searchParams.get('radius')).toBe('2.5');
    expect(url.searchParams.getAll('osm_tag')).toEqual(expect.arrayContaining(['amenity', 'shop', 'highway:rest_area']));
    expect(url.searchParams.has('q')).toBe(false);
  });

  it('uses /api with the query and a bbox around the point for named searches', () => {
    const url = new URL(buildPhotonVenueUrl('https://photon.test', 39.28, -76.59, 5000, 'starbucks'));
    expect(url.pathname).toBe('/api');
    expect(url.searchParams.get('q')).toBe('starbucks');
    const [minLon, minLat, maxLon, maxLat] = url.searchParams.get('bbox')!.split(',').map(Number);
    expect(minLon).toBeLessThan(-76.59);
    expect(maxLon).toBeGreaterThan(-76.59);
    expect(minLat).toBeCloseTo(39.28 - 5000 / 111320, 4);
    expect(maxLat).toBeCloseTo(39.28 + 5000 / 111320, 4);
  });

  it('enforces the minimum radii', () => {
    expect(getSearchRadius(200)).toBe(2500);
    expect(getSearchRadius(200, 'x')).toBe(5000);
    expect(getSearchRadius(8000, 'x')).toBe(8000);
  });
});

describe('searchNearbyVenues', () => {
  beforeEach(() => clearVenueSearchCache());
  afterEach(() => vi.unstubAllGlobals());

  it('dedupes results and drops named matches outside the search circle', async () => {
    const near = feature({ osm_type: 'N', osm_id: 1, name: 'Starbucks' }, [-76.59, 39.281]);
    const far = feature({ osm_type: 'N', osm_id: 2, name: 'Starbucks' }, [-76.535, 39.325]); // bbox corner, ~7 km
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ features: [near, near, far] }))));
    const results = await searchNearbyVenues(39.28, -76.59, 'starbucks', 5000);
    expect(results.map((r) => r.osm_id)).toEqual(['node/1']);
  });

  it('throws when Photon errors, so the route can report it instead of returning nothing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('down', { status: 503, statusText: 'Service Unavailable' })));
    await expect(searchNearbyVenues(10, 10)).rejects.toThrow(/503/);
  });
});

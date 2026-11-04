import { describe, expect, it } from 'vitest';
import {
  MAX_STREETS_SVG_BYTES,
  STREETS_MAX_RADIUS_KM,
  fetchRoads,
  pickHomeRegion,
  projector,
  renderMyPlacesSvg,
  renderStreetsSvg,
  streetsBbox,
  streetsRegion,
} from '../services/placePatterns';

// Around Lisbon, plus one trip far away.
const home = [
  { lat: 38.7223, lon: -9.1393, visits: 40 },
  { lat: 38.7169, lon: -9.1399, visits: 12 },
  { lat: 38.7369, lon: -9.1427, visits: 6 },
  { lat: 38.7078, lon: -9.1366, visits: 3 },
];
const trip = { lat: 40.7128, lon: -74.006, visits: 5 };

describe('place patterns', () => {
  it('centres on the busiest area and ignores far-away trips', () => {
    const region = pickHomeRegion([...home, trip])!;
    expect(region.centerLat).toBeGreaterThan(38.7);
    expect(region.centerLat).toBeLessThan(38.74);
    expect(region.centerLon).toBeGreaterThan(-9.15);
    expect(region.centerLon).toBeLessThan(-9.13);
    expect(region.radiusKm).toBeGreaterThanOrEqual(1.5);
    expect(region.radiusKm).toBeLessThan(5);
  });

  it('has no region without check-ins', () => {
    expect(pickHomeRegion([])).toBeNull();
  });

  it('projects the centre to the middle of the canvas, north up', () => {
    const region = { centerLat: 38.72, centerLon: -9.14, radiusKm: 2 };
    const project = projector(region);
    expect(project(38.72, -9.14)).toEqual([800, 500]);
    const [, yNorth] = project(38.73, -9.14);
    expect(yNorth).toBeLessThan(500);
    const [xEast] = project(38.72, -9.13);
    expect(xEast).toBeGreaterThan(800);
  });

  it('draws a dot per venue in view and a path through visits', () => {
    const region = pickHomeRegion(home)!;
    const visits = home.map(({ lat, lon }) => ({ lat, lon }));
    const svg = renderMyPlacesSvg([...home, trip], visits, region);
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg.match(/<circle /g)).toHaveLength(home.length);
    expect(svg).toContain('<path d="M');
  });

  it('draws known road classes only, grouped by width', () => {
    const region = { centerLat: 38.72, centerLon: -9.14, radiusKm: 2 };
    const svg = renderStreetsSvg(
      [
        { highway: 'primary', points: [{ lat: 38.72, lon: -9.15 }, { lat: 38.72, lon: -9.13 }] },
        { highway: 'primary', points: [{ lat: 38.71, lon: -9.14 }, { lat: 38.73, lon: -9.14 }] },
        { highway: 'footway', points: [{ lat: 38.715, lon: -9.14 }, { lat: 38.725, lon: -9.14 }] },
      ],
      region,
    );
    expect(svg.match(/<path /g)).toHaveLength(1);
    expect(svg).toContain('stroke-width="4"');
  });

  it('keeps Streets to a neighbourhood-sized box matching the view', () => {
    const wide = { centerLat: 40, centerLon: -3.7, radiusKm: 12 };
    const area = streetsRegion(wide);
    expect(area.radiusKm).toBe(STREETS_MAX_RADIUS_KM);
    const [s, w, n, e] = streetsBbox(area);
    const heightKm = (n - s) * 111.32;
    const widthKm = (e - w) * 111.32 * Math.cos((40 * Math.PI) / 180);
    expect(heightKm).toBeCloseTo(2 * 2.5 * 1.1, 1);
    expect(widthKm / heightKm).toBeCloseTo(1.6, 1);
    expect(streetsRegion({ ...wide, radiusKm: 1.8 }).radiusKm).toBe(1.8);
  });

  it('rejects an incomplete Overpass answer instead of drawing it', async () => {
    const region = { centerLat: 38.72, centerLon: -9.14, radiusKm: 2 };
    const partial = async () =>
      new Response(JSON.stringify({ remark: 'runtime error: Query timed out', elements: [] }), { status: 200 });
    await expect(fetchRoads(region, partial)).rejects.toThrow(/incomplete/);
  });

  it('reads roads from a complete Overpass answer, without service roads in the query', async () => {
    const region = { centerLat: 38.72, centerLon: -9.14, radiusKm: 2 };
    let sent = '';
    const ok = async (body: string) => {
      sent = decodeURIComponent(body);
      return new Response(JSON.stringify({
        elements: [
          { tags: { highway: 'primary' }, geometry: [{ lat: 38.72, lon: -9.15 }, { lat: 38.72, lon: -9.13 }] },
          { tags: { name: 'no highway tag' }, geometry: [] },
        ],
      }), { status: 200 });
    };
    const roads = await fetchRoads(region, ok);
    expect(roads).toEqual([{ highway: 'primary', points: [{ lat: 38.72, lon: -9.15 }, { lat: 38.72, lon: -9.13 }] }]);
    expect(sent).not.toContain('service');
    expect(sent).toContain('residential');
  });

  it('falls back to major roads when the full drawing is too large', () => {
    const region = { centerLat: 38.72, centerLon: -9.14, radiusKm: 2 };
    const zigzag = (lat: number) =>
      Array.from({ length: 400 }, (_, i) => ({ lat: lat + (i % 2) * 0.0005, lon: -9.16 + i * 0.0001 }));
    const roads = [
      { highway: 'primary', points: zigzag(38.72) },
      ...Array.from({ length: 600 }, (_, i) => ({ highway: 'residential', points: zigzag(38.705 + i * 0.00005) })),
    ];
    const svg = renderStreetsSvg(roads, region);
    expect(svg.length).toBeLessThanOrEqual(MAX_STREETS_SVG_BYTES);
    expect(svg).toContain('stroke-width="4"');
    expect(svg).not.toContain('stroke-width="1.8"');
  });
});

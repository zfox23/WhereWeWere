import { describe, expect, it } from 'vitest';
import {
  pickHomeRegion,
  projector,
  renderMyPlacesSvg,
  renderStreetsSvg,
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
});

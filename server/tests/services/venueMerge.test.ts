import { describe, expect, it } from 'vitest';
import { areVenuesSimilar, calculateDistanceMeters } from '../../src/services/venueMerge';

describe('calculateDistanceMeters', () => {
  it('returns zero when coordinates match', () => {
    const distance = calculateDistanceMeters(40.7128, -74.006, 40.7128, -74.006);
    expect(distance).toBe(0);
  });

  it('returns realistic value for close-by points', () => {
    const distance = calculateDistanceMeters(40.7128, -74.006, 40.7138, -74.006);
    expect(distance).toBeGreaterThan(100);
    expect(distance).toBeLessThan(120);
  });
});

describe('areVenuesSimilar', () => {
  it('matches venues with same OSM id', () => {
    const result = areVenuesSimilar(
      { name: 'Blue Bottle Coffee', latitude: 37.776, longitude: -122.423, osm_id: '123', swarm_venue_id: null },
      { name: 'Blue Bottle', latitude: 37.7761, longitude: -122.4231, osm_id: '123', swarm_venue_id: null }
    );

    expect(result.isMatch).toBe(true);
    expect(result.reason).toBe('matching-osm-id');
  });

  it('does not match far-away venues even with similar names', () => {
    const result = areVenuesSimilar(
      { name: 'Target', latitude: 37.7749, longitude: -122.4194, osm_id: null, swarm_venue_id: null },
      { name: 'Target Store', latitude: 34.0522, longitude: -118.2437, osm_id: null, swarm_venue_id: null }
    );

    expect(result.isMatch).toBe(false);
    expect(result.reason).toBe('distance-too-large');
  });
});

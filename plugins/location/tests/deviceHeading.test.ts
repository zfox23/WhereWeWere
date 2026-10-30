import { describe, it, expect } from 'vitest';
import { headingFromOrientation, arrowRotation } from '../ui/useDeviceHeading';

describe('headingFromOrientation', () => {
  it('uses the top edge when flat (alpha is counter-clockwise from north)', () => {
    expect(headingFromOrientation(0, 0, 0)).toBeCloseTo(0);
    expect(headingFromOrientation(90, 0, 0)).toBeCloseTo(270);
  });

  it('uses the back of the device when held upright', () => {
    // Upright (beta 90) facing north, then turned to face east (alpha 270).
    expect(headingFromOrientation(0, 90, 0)).toBeCloseTo(0);
    expect(headingFromOrientation(270, 90, 0)).toBeCloseTo(90);
    expect(headingFromOrientation(180, 90, 0)).toBeCloseTo(180);
  });
});

describe('arrowRotation', () => {
  it('falls back to the bearing without a heading', () => {
    expect(arrowRotation(30, null)).toBe(30);
  });
  it('is relative to the heading', () => {
    expect(arrowRotation(90, 90)).toBe(0);
    expect(arrowRotation(10, 20)).toBe(350);
  });
});

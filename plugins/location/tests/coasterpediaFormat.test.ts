import { describe, expect, it } from 'vitest';
import { enteredMeasurement, formatEdtf, formatMeasurement, humanize, youtubeUrl } from '../ui/coasterpediaFormat';

describe('formatMeasurement', () => {
  it('shows metric values as returned', () => {
    expect(formatMeasurement({ value: 225.6, unit: 'm' }, 'metric')).toBe('225.6 m');
    expect(formatMeasurement({ value: 193, unit: 'km/h' }, 'metric')).toBe('193 km/h');
  });
  it('converts to imperial', () => {
    expect(formatMeasurement({ value: 225.6, unit: 'm' }, 'imperial')).toBe('740 ft');
    expect(formatMeasurement({ value: 120, unit: 'km/h' }, 'imperial')).toBe('75 mph');
    expect(formatMeasurement({ value: 107, unit: 'cm' }, 'imperial')).toBe('42 in');
    expect(formatMeasurement({ value: 100, unit: 'kg' }, 'imperial')).toBe('220 lb');
  });
  it('leaves units with no imperial form alone and handles missing values', () => {
    expect(formatMeasurement({ value: 150, unit: 's' }, 'imperial')).toBe('150 s');
    expect(formatMeasurement(null, 'metric')).toBeNull();
    expect(formatMeasurement(undefined, 'imperial')).toBeNull();
  });
});

describe('enteredMeasurement', () => {
  it('exposes the editor-typed value', () => {
    expect(enteredMeasurement({ value: 225.6, unit: 'm', entered: { value: 740, unit: 'ft' } })).toContain('740 ft');
    expect(enteredMeasurement({ value: 1, unit: 'm' })).toBeUndefined();
  });
});

describe('text helpers', () => {
  it('humanizes vocabulary values', () => {
    expect(humanize('under_construction')).toBe('Under construction');
    expect(humanize(null)).toBeNull();
  });
  it('tidies EDTF dates', () => {
    expect(formatEdtf('1996-05-04')).toBe('1996-05-04');
    expect(formatEdtf('[..1989]')).toBe('1989 or earlier');
    expect(formatEdtf('[1982..]')).toBe('1982 or later');
    expect(formatEdtf('1950~')).toBe('1950');
    expect(formatEdtf('199X')).toBe('199?');
  });
  it('builds a YouTube link', () => {
    expect(youtubeUrl('dQw4w9WgXcQ')).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  });
});

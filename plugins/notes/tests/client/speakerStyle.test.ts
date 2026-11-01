import { describe, expect, it } from 'vitest';
import { SPEAKER_STYLES, speakerLabel, speakerNumber, speakerStyle } from '../../ui/audio/speakerStyle';

describe('speaker labels', () => {
  it('reads the number out of an id', () => {
    expect([speakerNumber('S1'), speakerNumber('S12'), speakerNumber('x'), speakerNumber('S')]).toEqual([1, 12, 0, 0]);
  });

  it('uses the name the user gave, else "Speaker N", ignoring blank names', () => {
    expect(speakerLabel('S1', { S1: 'Dad' })).toBe('Dad');
    expect(speakerLabel('S2', { S1: 'Dad' })).toBe('Speaker 2');
    expect(speakerLabel('S1', { S1: '   ' })).toBe('Speaker 1');
    expect(speakerLabel('S3', undefined)).toBe('Speaker 3');
    expect(speakerLabel('odd', {})).toBe('odd');
  });

  it('gives each speaker their own colour and cycles for large groups', () => {
    expect(speakerStyle('S1')).not.toBe(speakerStyle('S2'));
    expect(speakerStyle('S1')).toBe(speakerStyle(`S${SPEAKER_STYLES.length + 1}`));
    expect(speakerStyle('weird')).toBe(SPEAKER_STYLES[0]);
  });
});

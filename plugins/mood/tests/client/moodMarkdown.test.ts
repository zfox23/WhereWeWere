import { describe, expect, it } from 'vitest';
import { moodToMarkdown } from '../../ui/moodMarkdown';

describe('moodToMarkdown', () => {
  it('lists the mood, time, activities and note', () => {
    const md = moodToMarkdown(
      { note: ' Long day.\nGood dinner. ', activities: [{ id: '1', name: 'Work', group_name: 'x' }, { id: '2', name: 'Cooking', group_name: 'x' }] },
      'Good',
      'Tuesday, November 4, 2026 at 7:00 PM CST',
    );
    expect(md).toBe('# Mood: Good\n\n*Tuesday, November 4, 2026 at 7:00 PM CST*\n\n**Activities:** Work, Cooking\n\nLong day.\nGood dinner.\n');
  });

  it('leaves out missing activities and note', () => {
    expect(moodToMarkdown({ note: null, activities: [] }, 'Meh', 'now')).toBe('# Mood: Meh\n\n*now*\n');
  });
});

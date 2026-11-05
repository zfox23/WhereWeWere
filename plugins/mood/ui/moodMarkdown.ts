/** A mood check-in as markdown, for "Copy as markdown" on its detail page. */

import type { MoodCheckIn } from './types';

export function moodToMarkdown(
  checkin: Pick<MoodCheckIn, 'note' | 'activities'>,
  moodLabel: string,
  when: string,
): string {
  const parts = [`# Mood: ${moodLabel}`, `*${when}*`];
  if (checkin.activities?.length) parts.push(`**Activities:** ${checkin.activities.map((a) => a.name).join(', ')}`);
  const note = checkin.note?.trim();
  if (note) parts.push(note);
  return `${parts.join('\n\n')}\n`;
}

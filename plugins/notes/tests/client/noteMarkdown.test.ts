import { describe, expect, it } from 'vitest';
import { noteToMarkdown, transcriptToMarkdown } from '../../ui/noteMarkdown';

const seg = (idx: number, start_ms: number, text: string, speaker: string | null = null) =>
  ({ idx, start_ms, end_ms: start_ms + 1000, text, edited: false, speaker });

describe('noteToMarkdown', () => {
  it('puts the title, time, tags and people above the body', () => {
    const md = noteToMarkdown(
      { title: 'Trip', body: '  Some **bold** text\n\n- a list\n', tags: [{ id: '1', name: 'travel' } as never, { id: '2', name: 'family' } as never], companions: ['Ann', 'Bo'] },
      'Mon, Nov 3, 2026 · 9:00 AM America/Chicago',
    );
    expect(md).toBe('# Trip\n\n*Mon, Nov 3, 2026 · 9:00 AM America/Chicago*\n\n**Tags:** travel, family\n\n**With:** Ann, Bo\n\nSome **bold** text\n\n- a list\n');
  });

  it('falls back to "Note" and leaves out empty sections', () => {
    expect(noteToMarkdown({ title: '  ', body: '', tags: [], companions: [] }, 'today')).toBe('# Note\n\n*today*\n');
  });
});

describe('transcriptToMarkdown', () => {
  it('joins consecutive segments by the same speaker into one turn, using their names', () => {
    const md = transcriptToMarkdown({
      filename: 'call.m4a',
      duration_ms: 125_000,
      speakers: { S1: 'Dad' },
      segments: [seg(0, 0, 'Hi.', 'S1'), seg(1, 2000, 'How are you?', 'S1'), seg(2, 5000, 'Good.', 'S2'), seg(3, 65_000, 'Bye.', 'S1')],
    });
    expect(md).toBe('## call.m4a\n\n*2:05*\n\n**[0:00] Dad:** Hi. How are you?\n\n**[0:05] Speaker 2:** Good.\n\n**[1:05] Dad:** Bye.\n');
  });

  it('keeps one timestamped paragraph per segment without speakers and skips blank ones', () => {
    const md = transcriptToMarkdown({
      filename: 'memo.webm',
      duration_ms: null,
      speakers: {},
      segments: [seg(0, 0, 'First.'), seg(1, 1000, '  '), seg(2, 3000, 'Second.')],
    });
    expect(md).toBe('## memo.webm\n\n**[0:00]** First.\n\n**[0:03]** Second.\n');
  });
});

/**
 * Markdown versions of a note and of an audio transcript, for "Copy as markdown"
 * on the note detail page.
 */

import type { Note, NoteAudioWithTranscript } from './api';
import { formatDuration } from './audio/AudioSection';
import { speakerLabel } from './audio/speakerStyle';

/** The note as markdown: title heading, when it was written, tags and people, then the body as written. */
export function noteToMarkdown(note: Pick<Note, 'title' | 'body' | 'tags' | 'companions'>, when: string): string {
  const parts = [`# ${note.title?.trim() || 'Note'}`, `*${when}*`];
  if (note.tags.length > 0) parts.push(`**Tags:** ${note.tags.map((t) => t.name).join(', ')}`);
  if (note.companions.length > 0) parts.push(`**With:** ${note.companions.join(', ')}`);
  const body = note.body.trim();
  if (body) parts.push(body);
  return `${parts.join('\n\n')}\n`;
}

/**
 * A transcript as markdown: a heading with the file name, then one paragraph
 * per speaker turn (consecutive segments by the same speaker run together),
 * each led by its start time and, when known, who spoke.
 */
export function transcriptToMarkdown(
  audio: Pick<NoteAudioWithTranscript, 'filename' | 'duration_ms' | 'speakers' | 'segments'>,
): string {
  const parts = [`## ${audio.filename}`];
  if (audio.duration_ms) parts.push(`*${formatDuration(audio.duration_ms)}*`);

  let turn: { speaker: string | null; start: number; text: string[] } | null = null;
  const flush = () => {
    if (!turn) return;
    const who = turn.speaker ? ` ${speakerLabel(turn.speaker, audio.speakers)}:` : '';
    parts.push(`**[${formatDuration(turn.start)}]${who}** ${turn.text.join(' ')}`);
  };
  for (const s of audio.segments) {
    const text = s.text.trim();
    if (!text) continue;
    // Without speakers there are no turns to join, so each segment keeps its own timestamp.
    if (turn && s.speaker && turn.speaker === s.speaker) {
      turn.text.push(text);
      continue;
    }
    flush();
    turn = { speaker: s.speaker, start: s.start_ms, text: [text] };
  }
  flush();
  return `${parts.join('\n\n')}\n`;
}

/**
 * Markdown editor keyboard niceties (pure, so they're unit-testable):
 *   Tab / Shift+Tab   indent / outdent the selected lines (2 spaces)
 *   Enter             continue a list item ("- ", "* ", "1. ", "- [ ] "),
 *                     or end the list on an empty item
 * Returns null when the key should keep its default behavior.
 */

export interface EditorState {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

export interface EditorKey {
  key: string;
  shiftKey?: boolean;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
}

const INDENT = '  ';
const LIST_RE = /^(\s*)([-*+]|(\d+)([.)]))(\s+)(\[[ xX]\]\s+)?/;

function lineStart(value: string, pos: number): number {
  return value.lastIndexOf('\n', pos - 1) + 1;
}

function lineEnd(value: string, pos: number): number {
  const end = value.indexOf('\n', pos);
  return end === -1 ? value.length : end;
}

function indentLines(state: EditorState, outdent: boolean): EditorState {
  const { value, selectionStart, selectionEnd } = state;
  const start = lineStart(value, selectionStart);
  // A selection ending at the very start of a line doesn't include that line.
  const endPos = selectionEnd > selectionStart && value[selectionEnd - 1] === '\n' ? selectionEnd - 1 : selectionEnd;
  const end = lineEnd(value, endPos);
  const lines = value.slice(start, end).split('\n');
  let firstDelta = 0;
  let totalDelta = 0;
  const next = lines.map((line, i) => {
    let delta: number;
    let out: string;
    if (outdent) {
      const remove = line.startsWith(INDENT) ? INDENT.length : line.startsWith(' ') || line.startsWith('\t') ? 1 : 0;
      out = line.slice(remove);
      delta = -remove;
    } else {
      out = INDENT + line;
      delta = INDENT.length;
    }
    if (i === 0) firstDelta = delta;
    totalDelta += delta;
    return out;
  });
  const newValue = value.slice(0, start) + next.join('\n') + value.slice(end);
  const collapsed = selectionStart === selectionEnd;
  const newStart = Math.max(start, selectionStart + firstDelta);
  return {
    value: newValue,
    selectionStart: newStart,
    selectionEnd: collapsed ? newStart : Math.max(newStart, selectionEnd + totalDelta),
  };
}

function continueList(state: EditorState): EditorState | null {
  const { value, selectionStart, selectionEnd } = state;
  if (selectionStart !== selectionEnd) return null;
  const start = lineStart(value, selectionStart);
  const line = value.slice(start, selectionStart);
  const match = LIST_RE.exec(line);
  if (!match) return null;

  const [marker, indent, bullet, num, sep, space, task] = match;
  const content = line.slice(marker.length);
  if (content.trim() === '' && value.slice(selectionStart, lineEnd(value, selectionStart)).trim() === '') {
    // Enter on an empty item ends the list: drop the marker.
    const newValue = value.slice(0, start) + value.slice(selectionStart);
    return { value: newValue, selectionStart: start, selectionEnd: start };
  }

  const nextBullet = num ? `${Number(num) + 1}${sep}` : bullet;
  const nextTask = task ? '[ ] ' : '';
  const insert = `\n${indent}${nextBullet}${space}${nextTask}`;
  const newValue = value.slice(0, selectionStart) + insert + value.slice(selectionEnd);
  const pos = selectionStart + insert.length;
  return { value: newValue, selectionStart: pos, selectionEnd: pos };
}

export function applyEditorKey(state: EditorState, key: EditorKey): EditorState | null {
  if (key.altKey || key.ctrlKey || key.metaKey) return null;
  if (key.key === 'Tab') return indentLines(state, Boolean(key.shiftKey));
  if (key.key === 'Enter' && !key.shiftKey) return continueList(state);
  return null;
}

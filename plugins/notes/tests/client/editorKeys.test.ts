import { describe, expect, it } from 'vitest';
import { applyEditorKey } from '../../ui/editorKeys';

/** `|` marks the caret (or `«`..`»` a selection) in the test strings. */
function state(text: string) {
  if (text.includes('«')) {
    const start = text.indexOf('«');
    const end = text.indexOf('»') - 1;
    return { value: text.replace('«', '').replace('»', ''), selectionStart: start, selectionEnd: end };
  }
  const pos = text.indexOf('|');
  return { value: text.replace('|', ''), selectionStart: pos, selectionEnd: pos };
}

function show(s: { value: string; selectionStart: number; selectionEnd: number } | null) {
  if (!s) return null;
  if (s.selectionStart === s.selectionEnd) return `${s.value.slice(0, s.selectionStart)}|${s.value.slice(s.selectionStart)}`;
  return `${s.value.slice(0, s.selectionStart)}«${s.value.slice(s.selectionStart, s.selectionEnd)}»${s.value.slice(s.selectionEnd)}`;
}

const press = (text: string, key: string, shiftKey = false) => show(applyEditorKey(state(text), { key, shiftKey }));

describe('applyEditorKey', () => {
  it('continues bullet, numbered and task lists', () => {
    expect(press('- one|', 'Enter')).toBe('- one\n- |');
    expect(press('  * nested|', 'Enter')).toBe('  * nested\n  * |');
    expect(press('9. nine|', 'Enter')).toBe('9. nine\n10. |');
    expect(press('- [x] done|', 'Enter')).toBe('- [x] done\n- [ ] |');
  });

  it('ends the list on an empty item', () => {
    expect(press('- one\n- |', 'Enter')).toBe('- one\n|');
  });

  it('leaves Enter alone outside lists and with Shift', () => {
    expect(press('plain|', 'Enter')).toBeNull();
    expect(press('- one|', 'Enter', true)).toBeNull();
  });

  it('indents and outdents lines with Tab / Shift+Tab', () => {
    expect(press('- a|', 'Tab')).toBe('  - a|');
    expect(press('  - a|', 'Tab', true)).toBe('- a|');
    expect(press('«a\nb»', 'Tab')).toBe('  «a\n  b»');
    expect(press('  «a\n  b»', 'Tab', true)).toBe('«a\nb»');
  });

  it('ignores modified keys', () => {
    expect(applyEditorKey(state('- a|'), { key: 'Enter', ctrlKey: true })).toBeNull();
  });
});

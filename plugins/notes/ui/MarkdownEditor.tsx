/**
 * Monospace markdown editor with a Write / Preview toggle and list/indent
 * keyboard helpers (see editorKeys.ts).
 */

import { useLayoutEffect, useRef, useState } from 'react';
import { Eye, Pencil } from 'lucide-react';
import { MarkdownNote } from '../../../client/src/components/checkin-card/MarkdownNote';
import { applyEditorKey, type EditorState } from './editorKeys';

export const MONO_FONT = `'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;

interface MarkdownEditorProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function MarkdownEditor({ id, value, onChange, placeholder }: MarkdownEditorProps) {
  const [mode, setMode] = useState<'write' | 'preview'>('write');
  const ref = useRef<HTMLTextAreaElement | null>(null);
  // Caret to restore after a keyboard helper rewrites the value.
  const pendingSelection = useRef<[number, number] | null>(null);

  useLayoutEffect(() => {
    const sel = pendingSelection.current;
    if (sel && ref.current) {
      ref.current.setSelectionRange(sel[0], sel[1]);
      pendingSelection.current = null;
    }
  }, [value]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      // Leave the editor so Tab can move focus again.
      e.currentTarget.blur();
      return;
    }
    const el = e.currentTarget;
    const state: EditorState = { value: el.value, selectionStart: el.selectionStart, selectionEnd: el.selectionEnd };
    const next = applyEditorKey(state, e);
    if (!next) return;
    e.preventDefault();
    pendingSelection.current = [next.selectionStart, next.selectionEnd];
    onChange(next.value);
  };

  const words = value.trim() ? value.trim().split(/\s+/).length : 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <div role="tablist" aria-label="Editor mode" className="inline-flex rounded-lg border border-gray-300 dark:border-gray-600 p-0.5 text-xs">
          {(['write', 'preview'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-medium ${
                mode === m ? 'bg-primary-600 text-white' : 'text-gray-600 dark:text-gray-300'
              }`}
            >
              {m === 'write' ? <Pencil size={12} /> : <Eye size={12} />}
              {m === 'write' ? 'Write' : 'Preview'}
            </button>
          ))}
        </div>
        <span className="text-[11px] text-gray-400 tabular-nums">{words.toLocaleString()} {words === 1 ? 'word' : 'words'}</span>
      </div>
      {mode === 'write' ? (
        <textarea
          id={id}
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          spellCheck
          style={{ fontFamily: MONO_FONT, tabSize: 2 }}
          className="input text-sm leading-relaxed resize-y min-h-[45vh] w-full"
        />
      ) : (
        <div className="min-h-[45vh] rounded-lg border border-gray-200 dark:border-gray-700 bg-white/60 dark:bg-gray-800/40 px-4 py-3">
          {value.trim() ? <MarkdownNote note={value} /> : <p className="text-sm text-gray-400">Nothing to preview yet.</p>}
        </div>
      )}
      <p className="text-[11px] text-gray-400 mt-1">
        Markdown. Tab indents, Enter continues lists, Esc leaves the editor.
      </p>
    </div>
  );
}

import { useEffect, useRef } from 'react';

interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

/** Ctrl+Enter (or ⌘+Enter on macOS): the shared "save this entry" shortcut. */
export function isSubmitHotkey(e: KeyLike): boolean {
  return e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.altKey;
}

/**
 * Page-wide Ctrl/⌘+Enter that submits or updates the current entry,
 * wherever focus is on the page, taking precedence over any field's own
 * Enter handling. Key repeat is ignored so one press is one save. For
 * `<form>` pages pass `() => formRef.current?.requestSubmit()`, so native
 * validation and the form's own submit handler still run.
 *
 * @param onSubmit Called on the hotkey (the latest closure is always used).
 * @param enabled  Set false while saving or when there is nothing to submit.
 */
export function useSubmitHotkey(onSubmit: () => void, enabled = true): void {
  const handlerRef = useRef(onSubmit);
  handlerRef.current = onSubmit;

  useEffect(() => {
    if (!enabled) return;
    // Capture phase, and the event stops here: fields with their own Enter
    // handling (chip inputs, activity filters, the Markdown editor) would
    // otherwise act on the key or cancel it before it reached the page.
    const onKeyDown = (e: KeyboardEvent) => {
      if (!isSubmitHotkey(e)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat) return;
      handlerRef.current();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [enabled]);
}

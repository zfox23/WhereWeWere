/**
 * Unsaved note drafts in localStorage, one per new note / edited note, so a
 * reload or an accidental back doesn't lose a long entry. Storage can be
 * unavailable (private windows, blocked site data): every access is guarded
 * and a missing draft is simply no draft.
 */

export interface NoteDraft {
  title: string;
  body: string;
  tags: string[];
  savedAt: number;
}

const PREFIX = 'wwp:notes:draft:';

export function draftKey(editId: string | null | undefined): string {
  return `${PREFIX}${editId || 'new'}`;
}

export function loadDraft(key: string): NoteDraft | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<NoteDraft>;
    if (typeof parsed.body !== 'string' || typeof parsed.title !== 'string') return null;
    return {
      title: parsed.title,
      body: parsed.body,
      tags: Array.isArray(parsed.tags) ? parsed.tags.filter((t): t is string => typeof t === 'string') : [],
      savedAt: typeof parsed.savedAt === 'number' ? parsed.savedAt : 0,
    };
  } catch {
    return null;
  }
}

export function saveDraft(key: string, draft: Omit<NoteDraft, 'savedAt'>): void {
  try {
    if (!draft.title.trim() && !draft.body.trim() && draft.tags.length === 0) {
      window.localStorage.removeItem(key);
      return;
    }
    window.localStorage.setItem(key, JSON.stringify({ ...draft, savedAt: Date.now() }));
  } catch {
    // Storage full or blocked: the draft just isn't kept.
  }
}

export function clearDraft(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export function sameContent(a: { title: string; body: string; tags: string[] }, b: { title: string; body: string; tags: string[] }): boolean {
  return a.title === b.title && a.body === b.body && a.tags.join('\n') === b.tags.join('\n');
}

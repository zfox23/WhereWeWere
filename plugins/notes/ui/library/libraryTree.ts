/**
 * Note Library tree building (pure): Date (year > month > note) and Tag
 * (tag > year > month > note, "Untagged" last).
 */

import type { LibraryNote, NoteTag } from '../api';

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export interface FolderNode {
  kind: 'folder';
  key: string;
  label: string;
  color?: string;
  count: number;
  children: TreeNode[];
}

export interface NoteLeaf {
  kind: 'note';
  key: string;
  note: LibraryNote;
}

export type TreeNode = FolderNode | NoteLeaf;

export type SortOrder = 'newest' | 'oldest';

function byDate(order: SortOrder) {
  return (a: LibraryNote, b: LibraryNote) => {
    const cmp = a.checked_in_at < b.checked_in_at ? -1 : a.checked_in_at > b.checked_in_at ? 1 : 0;
    return order === 'newest' ? -cmp : cmp;
  };
}

/** Year > month > notes for `notes`, under folder keys prefixed with `prefix`. */
export function dateFolders(notes: LibraryNote[], order: SortOrder, prefix = ''): FolderNode[] {
  const years = new Map<string, Map<string, LibraryNote[]>>();
  for (const n of [...notes].sort(byDate(order))) {
    const y = n.local_date.slice(0, 4);
    const m = n.local_date.slice(5, 7);
    if (!years.has(y)) years.set(y, new Map());
    const months = years.get(y)!;
    if (!months.has(m)) months.set(m, []);
    months.get(m)!.push(n);
  }
  return [...years.entries()].map(([y, months]) => {
    const children: FolderNode[] = [...months.entries()].map(([m, list]) => ({
      kind: 'folder',
      key: `${prefix}${y}-${m}`,
      label: `${m} · ${MONTH_NAMES[Number(m) - 1]}`,
      count: list.length,
      children: list.map((note) => ({ kind: 'note', key: `${prefix}${note.id}`, note })),
    }));
    return {
      kind: 'folder',
      key: `${prefix}${y}`,
      label: y,
      count: children.reduce((s, c) => s + c.count, 0),
      children,
    };
  });
}

/** Tag > year > month > notes; a note sits under each of its tags. */
export function tagFolders(notes: LibraryNote[], tags: NoteTag[], order: SortOrder): FolderNode[] {
  const byTag = new Map<string, LibraryNote[]>();
  const untagged: LibraryNote[] = [];
  for (const n of notes) {
    if (n.tag_ids.length === 0) untagged.push(n);
    for (const id of n.tag_ids) {
      if (!byTag.has(id)) byTag.set(id, []);
      byTag.get(id)!.push(n);
    }
  }
  const folders: FolderNode[] = [...tags]
    .sort((a, b) => a.name.localeCompare(b.name))
    .filter((t) => byTag.has(t.id))
    .map((t) => ({
      kind: 'folder',
      key: `tag:${t.id}`,
      label: t.name,
      color: t.color,
      count: byTag.get(t.id)!.length,
      children: dateFolders(byTag.get(t.id)!, order, `tag:${t.id}/`),
    }));
  if (untagged.length > 0) {
    folders.push({
      kind: 'folder',
      key: 'tag:untagged',
      label: 'Untagged',
      count: untagged.length,
      children: dateFolders(untagged, order, 'tag:untagged/'),
    });
  }
  return folders;
}

/** Keys of the folders on the path to the first note (opened by default). */
export function firstPath(nodes: TreeNode[]): string[] {
  const out: string[] = [];
  let level = nodes;
  while (level.length > 0 && level[0].kind === 'folder') {
    out.push(level[0].key);
    level = level[0].children;
  }
  return out;
}

/** Keys of every folder containing `noteId` (to reveal a selection). */
export function pathTo(nodes: TreeNode[], noteId: string): string[] | null {
  for (const node of nodes) {
    if (node.kind === 'note') {
      if (node.note.id === noteId) return [];
      continue;
    }
    const inner = pathTo(node.children, noteId);
    if (inner) return [node.key, ...inner];
  }
  return null;
}

export function matchesFilter(note: LibraryNote, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (note.title ?? '').toLowerCase().includes(q) || note.excerpt.toLowerCase().includes(q);
}

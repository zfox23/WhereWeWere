import { describe, expect, it } from 'vitest';
import type { LibraryNote } from '../../ui/api';
import { dateFolders, firstPath, matchesFilter, pathTo, tagFolders, type FolderNode, type TreeNode } from '../../ui/library/libraryTree';

function note(id: string, date: string, tagIds: string[] = [], title: string | null = id): LibraryNote {
  return {
    id, title, excerpt: `${id} body`, checked_in_at: `${date}T20:00:00Z`, checkin_timezone: 'UTC',
    local_date: date, word_count: 10, tag_ids: tagIds, theme_id: null,
  };
}

const NOTES = [
  note('a', '2018-08-03', ['t1']),
  note('b', '2018-08-20', ['t1', 't2']),
  note('c', '2017-10-15'),
];
const TAGS = [{ id: 't2', name: 'Journal', color: '#000000' }, { id: 't1', name: 'Dreams', color: '#111111' }];

function labels(nodes: TreeNode[]): unknown[] {
  return nodes.map((n) => (n.kind === 'note' ? n.note.id : [n.label, labels(n.children)]));
}

describe('libraryTree', () => {
  it('builds year > month > notes, newest first or oldest first', () => {
    expect(labels(dateFolders(NOTES, 'newest'))).toEqual([
      ['2018', [['08 · August', ['b', 'a']]]],
      ['2017', [['10 · October', ['c']]]],
    ]);
    expect(labels(dateFolders(NOTES, 'oldest'))[0]).toEqual(['2017', [['10 · October', ['c']]]]);
  });

  it('files a note under each of its tags, with Untagged last', () => {
    const tree = tagFolders(NOTES, TAGS, 'newest');
    expect(tree.map((f) => [f.label, f.count])).toEqual([['Dreams', 2], ['Journal', 1], ['Untagged', 1]]);
    expect(labels(tree[1].children)).toEqual([['2018', [['08 · August', ['b']]]]]);
    // Keys stay unique across tag folders.
    const keys = new Set<string>();
    const walk = (nodes: TreeNode[]) => nodes.forEach((n) => {
      expect(keys.has(n.key)).toBe(false);
      keys.add(n.key);
      if (n.kind === 'folder') walk(n.children);
    });
    walk(tree);
  });

  it('finds paths to open', () => {
    const tree = dateFolders(NOTES, 'newest');
    expect(firstPath(tree)).toEqual(['2018', '2018-08']);
    expect(pathTo(tree, 'c')).toEqual(['2017', '2017-10']);
    expect(pathTo(tree, 'zzz')).toBeNull();
    expect((tree[0] as FolderNode).count).toBe(2);
  });

  it('filters on title and first line', () => {
    expect(matchesFilter(note('x', '2020-01-01', [], 'Night with Jason'), 'jason')).toBe(true);
    expect(matchesFilter(note('x', '2020-01-01', [], null), 'x body')).toBe(true);
    expect(matchesFilter(note('x', '2020-01-01'), 'nope')).toBe(false);
  });
});

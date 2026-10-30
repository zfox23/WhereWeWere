/**
 * Note Library (bottom of Profile > Notes): a two-pane file browser. The
 * left pane browses by Date (year > month > note), by Tag (tag > year >
 * month > note), or as the Similarity Web graph; the right pane reads the
 * selected note. On narrow screens the panes stack and a selection swaps
 * the tree for the reading pane.
 */

import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { ArrowDownWideNarrow, ArrowLeft, ArrowUpNarrowWide, CalendarDays, ChevronRight, Folder, FolderOpen, Library, Loader2, Search, Tags, Waypoints } from 'lucide-react';
import { notes, type Library as LibraryData, type NoteGraph } from '../api';
import { noteHeading } from '../RelatedNotes';
import { TagDot } from '../TagChip';
import { ReadingPane } from './ReadingPane';
import { dateFolders, firstPath, matchesFilter, pathTo, tagFolders, type SortOrder, type TreeNode } from './libraryTree';

const SimilarityWeb = lazy(() => import('./SimilarityWeb'));

type View = 'date' | 'tag' | 'web';

const VIEWS: { id: View; label: string; icon: React.ReactNode }[] = [
  { id: 'date', label: 'Date', icon: <CalendarDays size={14} /> },
  { id: 'tag', label: 'Tag', icon: <Tags size={14} /> },
  { id: 'web', label: 'Similarity Web', icon: <Waypoints size={14} /> },
];

function Tree({ nodes, open, toggle, selectedId, onSelect, depth = 0 }: {
  nodes: TreeNode[];
  open: Set<string>;
  toggle: (key: string) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  depth?: number;
}) {
  return (
    <ul role={depth === 0 ? 'tree' : 'group'} className="text-sm">
      {nodes.map((node) => {
        const pad = { paddingLeft: depth * 14 + 6 };
        if (node.kind === 'note') {
          const selected = node.note.id === selectedId;
          return (
            <li key={node.key} role="treeitem" aria-selected={selected}>
              <button
                type="button"
                onClick={() => onSelect(node.note.id)}
                style={pad}
                className={`flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left ${
                  selected ? 'bg-primary-100 dark:bg-primary-900/40 text-primary-800 dark:text-primary-200' : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
              >
                <span className="ml-4 min-w-0 flex-1 truncate">{noteHeading(node.note.title, node.note.excerpt)}</span>
                <span className="shrink-0 text-[10px] text-gray-400 tabular-nums">{node.note.local_date.slice(8)}</span>
              </button>
            </li>
          );
        }
        const isOpen = open.has(node.key);
        return (
          <li key={node.key} role="treeitem" aria-expanded={isOpen} aria-selected={false}>
            <button
              type="button"
              onClick={() => toggle(node.key)}
              style={pad}
              className="flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-gray-800 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              <ChevronRight size={13} className={`shrink-0 text-gray-400 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
              {node.color ? <TagDot color={node.color} /> : isOpen ? <FolderOpen size={14} className="shrink-0 text-amber-500" /> : <Folder size={14} className="shrink-0 text-amber-500" />}
              <span className="min-w-0 flex-1 truncate font-medium">{node.label}</span>
              <span className="shrink-0 text-[11px] text-gray-400 tabular-nums">{node.count}</span>
            </button>
            {isOpen && (
              <Tree nodes={node.children} open={open} toggle={toggle} selectedId={selectedId} onSelect={onSelect} depth={depth + 1} />
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function NoteLibrary({ refreshKey = 0, similarityThreshold }: { refreshKey?: number; similarityThreshold?: number }) {
  const [view, setView] = useState<View>('date');
  const [order, setOrder] = useState<SortOrder>('newest');
  const [filter, setFilter] = useState('');
  const [library, setLibrary] = useState<LibraryData | null>(null);
  const [graph, setGraph] = useState<NoteGraph | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());

  useEffect(() => {
    notes.library().then(setLibrary).catch((err) => setError(err instanceof Error ? err.message : 'Failed to load the library'));
    setGraph(null);
  }, [refreshKey]);

  useEffect(() => {
    if (view !== 'web' || graph) return;
    notes.graph().then(setGraph).catch((err) => setError(err instanceof Error ? err.message : 'Failed to load the similarity web'));
  }, [view, graph]);

  const tree = useMemo<TreeNode[]>(() => {
    if (!library) return [];
    const list = library.notes.filter((n) => matchesFilter(n, filter));
    return view === 'tag' ? tagFolders(list, library.tags, order) : dateFolders(list, order);
  }, [library, view, order, filter]);

  // Open the first branch on load / view change; while filtering, open everything that matched.
  useEffect(() => {
    if (filter.trim()) {
      const keys: string[] = [];
      const walk = (nodes: TreeNode[]) => nodes.forEach((n) => {
        if (n.kind === 'folder') {
          keys.push(n.key);
          walk(n.children);
        }
      });
      walk(tree);
      setOpen(new Set(keys));
    } else {
      setOpen((prev) => (prev.size > 0 ? prev : new Set(firstPath(tree))));
    }
  }, [tree, filter]);

  const toggle = (key: string) => setOpen((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });

  const select = (id: string) => {
    setSelectedId(id);
    // Reveal the note in the tree (e.g. picked from Related notes or the web).
    const path = pathTo(tree, id);
    if (path) setOpen((prev) => new Set([...prev, ...path]));
  };

  const switchView = (v: View) => {
    setView(v);
    setOpen(new Set());
  };

  return (
    <section className="bg-white/60 dark:bg-gray-900/60 rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3">
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 dark:border-gray-800 p-4">
        <h3 className="mr-auto flex items-center gap-1.5 text-sm font-semibold text-gray-700 dark:text-gray-300">
          <Library size={16} className="text-amber-500" /> Note Library
        </h3>
        <div role="tablist" aria-label="Browse by" className="inline-flex rounded-lg border border-gray-300 dark:border-gray-600 p-0.5 text-xs">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              role="tab"
              aria-selected={view === v.id}
              onClick={() => switchView(v.id)}
              className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-medium ${view === v.id ? 'bg-primary-600 text-white' : 'text-gray-600 dark:text-gray-300'}`}
            >
              {v.icon}{v.label}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="p-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

      {!library ? (
        <div className="flex justify-center p-8"><Loader2 className="animate-spin text-gray-400" /></div>
      ) : library.notes.length === 0 ? (
        <p className="p-6 text-sm text-gray-400">No notes yet. Write one, or import a folder of text files in Settings &gt; Notes.</p>
      ) : view === 'web' ? (
        <div className="grid gap-0 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div className="p-4">
            {!graph ? (
              <div className="flex justify-center p-8"><Loader2 className="animate-spin text-gray-400" /></div>
            ) : graph.nodes.length === 0 ? (
              <p className="text-sm text-gray-400">Run the similarity analysis above to build the web.</p>
            ) : (
              <Suspense fallback={<div className="flex justify-center p-8"><Loader2 className="animate-spin text-gray-400" /></div>}>
                <SimilarityWeb graph={graph} selectedId={selectedId} onSelect={select} defaultThreshold={similarityThreshold} />
              </Suspense>
            )}
          </div>
          <div className="border-t lg:border-t-0 lg:border-l border-gray-100 dark:border-gray-800">
            <ReadingPane noteId={selectedId} onSelect={select} />
          </div>
        </div>
      ) : (
        <div className="grid md:grid-cols-[minmax(15rem,2fr)_minmax(0,3fr)]">
          <div className={`border-gray-100 dark:border-gray-800 md:border-r ${selectedId ? 'hidden md:block' : ''}`}>
            <div className="flex items-center gap-2 p-3">
              <label className="relative flex-1">
                <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="search"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filter by title or first line"
                  aria-label="Filter notes"
                  className="input pl-8 py-1.5 text-sm"
                />
              </label>
              <button
                type="button"
                onClick={() => setOrder((o) => (o === 'newest' ? 'oldest' : 'newest'))}
                title={order === 'newest' ? 'Newest first' : 'Oldest first'}
                aria-label={order === 'newest' ? 'Sorted newest first; switch to oldest first' : 'Sorted oldest first; switch to newest first'}
                className="rounded-lg border border-gray-300 dark:border-gray-600 p-1.5 text-gray-500 hover:text-primary-600"
              >
                {order === 'newest' ? <ArrowDownWideNarrow size={15} /> : <ArrowUpNarrowWide size={15} />}
              </button>
            </div>
            <div className="max-h-[70vh] overflow-y-auto px-2 pb-3">
              {tree.length === 0 ? (
                <p className="px-2 text-sm text-gray-400">No notes match.</p>
              ) : (
                <Tree nodes={tree} open={open} toggle={toggle} selectedId={selectedId} onSelect={select} />
              )}
            </div>
          </div>
          <div className={selectedId ? '' : 'hidden md:block'}>
            {selectedId && (
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                className="md:hidden m-3 mb-0 inline-flex items-center gap-1 text-xs font-medium text-primary-600 dark:text-primary-400"
              >
                <ArrowLeft size={13} /> Back to the library
              </button>
            )}
            <ReadingPane noteId={selectedId} onSelect={select} />
          </div>
        </div>
      )}
    </section>
  );
}

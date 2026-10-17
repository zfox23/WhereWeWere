/**
 * Ranked list view shared by checkin lists and venue lists.
 *
 * Phones get a card list; `md` and wider get a table. Both layouts share the
 * same ranking controls:
 *  - a ⠿ handle that drags with mouse, touch or keyboard (@dnd-kit; only the
 *    handle starts a drag, so touch scrolling still works), and
 *  - a ⋯ menu per row (move up / down / to top, move to a given rank, mark
 *    unranked, remove) as the no-drag path — the practical way to put item 40
 *    at #3 on a phone.
 * Ranked rows form a block on top; unranked rows sit in an "Unranked" section
 * below it, which is also the drop target for clearing a rank. Dragging is only
 * on while sorted by Rank; every other sort is a plain read-only ordering.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowDown, ArrowUp, MoreHorizontal } from 'lucide-react';
import { RankBadge } from './ListsShared';

export type SortDir = 'asc' | 'desc';

export interface RankedColumn<T> {
  /** Sort key; omit for a non-sortable column. */
  key: string;
  label: string;
  render: (item: T) => ReactNode;
  className?: string;
}

export interface RankedSortOption {
  key: string;
  label: string;
  defaultDir: SortDir;
}

interface Props<T> {
  items: T[];
  getId: (item: T) => string;
  getRank: (item: T) => number | null;
  /** Human label for a row, used in aria-labels ("Remove X from …"). */
  getLabel: (item: T) => string;
  columns: RankedColumn<T>[];
  /** Card body (title, meta, rating) for the phone layout. */
  renderCard: (item: T) => ReactNode;
  sortOptions: RankedSortOption[];
  compareBy: (key: string, a: T, b: T) => number;
  compareUnranked: (a: T, b: T) => number;
  /** Persist the ranked ids in their new order (1..n); everyone else is unranked. */
  onReorder: (rankedIds: string[]) => Promise<void>;
  onRemove: (item: T) => void;
}

const UNRANKED_ZONE = 'unranked-zone';
const DESKTOP_QUERY = '(min-width: 768px)';

/** True at `md`+. Defaults to desktop where matchMedia is unavailable (tests). */
function useIsDesktop(): boolean {
  const get = () =>
    typeof window === 'undefined' || typeof window.matchMedia !== 'function'
      ? true
      : window.matchMedia(DESKTOP_QUERY).matches;
  const [isDesktop, setIsDesktop] = useState(get);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(DESKTOP_QUERY);
    const onChange = () => setIsDesktop(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return isDesktop;
}

/** Move `id` to 1-based `rank` within the ranked ids (appending if unranked). */
export function moveToRank(rankedIds: string[], id: string, rank: number): string[] {
  const without = rankedIds.filter((r) => r !== id);
  const at = Math.max(0, Math.min(rank - 1, without.length));
  without.splice(at, 0, id);
  return without;
}

// ---------------------------------------------------------------------------
// Row menu
// ---------------------------------------------------------------------------

function RowMenu({
  label,
  rank,
  rankedCount,
  onMoveTo,
  onUnrank,
  onRemove,
}: {
  label: string;
  rank: number | null;
  rankedCount: number;
  onMoveTo: (rank: number) => void;
  onUnrank: () => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [askingRank, setAskingRank] = useState(false);
  const [rankInput, setRankInput] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  const close = () => {
    setOpen(false);
    setAskingRank(false);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const maxRank = rank == null ? rankedCount + 1 : rankedCount;
  const run = (fn: () => void) => () => {
    close();
    fn();
  };

  const itemClass =
    'w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 disabled:hover:bg-transparent';

  const submitRank = () => {
    const n = Math.floor(Number(rankInput));
    if (!Number.isFinite(n) || n < 1) return;
    close();
    onMoveTo(Math.min(n, maxRank));
  };

  return (
    <div ref={rootRef} className="relative inline-block text-left">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Actions for ${label}`}
        className="p-2 -m-1 rounded-md text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
      >
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <div
          role="menu"
          aria-label={`Actions for ${label}`}
          className="absolute right-0 z-20 mt-1 w-48 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg py-1"
        >
          {askingRank ? (
            <form
              className="flex items-center gap-1.5 px-3 py-2"
              onSubmit={(e) => {
                e.preventDefault();
                submitRank();
              }}
            >
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={maxRank}
                autoFocus
                value={rankInput}
                onChange={(e) => setRankInput(e.target.value)}
                aria-label={`Rank for ${label} (1–${maxRank})`}
                placeholder={`1–${maxRank}`}
                className="w-20 px-2 py-1 text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-md text-gray-800 dark:text-gray-100"
              />
              <button
                type="submit"
                className="px-2 py-1 text-sm rounded-md bg-primary-600 hover:bg-primary-700 text-white"
              >
                Go
              </button>
            </form>
          ) : (
            <>
              {rank == null ? (
                <button type="button" role="menuitem" className={itemClass} onClick={run(() => onMoveTo(rankedCount + 1))}>
                  Rank this
                </button>
              ) : (
                <>
                  <button type="button" role="menuitem" className={itemClass} disabled={rank <= 1} onClick={run(() => onMoveTo(1))}>
                    Move to top
                  </button>
                  <button type="button" role="menuitem" className={itemClass} disabled={rank <= 1} onClick={run(() => onMoveTo(rank - 1))}>
                    Move up
                  </button>
                  <button type="button" role="menuitem" className={itemClass} disabled={rank >= rankedCount} onClick={run(() => onMoveTo(rank + 1))}>
                    Move down
                  </button>
                </>
              )}
              <button type="button" role="menuitem" className={itemClass} onClick={() => setAskingRank(true)}>
                Move to rank…
              </button>
              {rank != null && (
                <button type="button" role="menuitem" className={itemClass} onClick={run(onUnrank)}>
                  Mark unranked
                </button>
              )}
              <button
                type="button"
                role="menuitem"
                className={`${itemClass} text-red-600 dark:text-red-400`}
                onClick={run(onRemove)}
              >
                Remove from list
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Handle
// ---------------------------------------------------------------------------

function DragHandle({
  label,
  attributes,
  listeners,
  setRef,
}: {
  label: string;
  attributes: Record<string, unknown>;
  listeners: Record<string, unknown> | undefined;
  setRef: (el: HTMLElement | null) => void;
}) {
  return (
    <button
      type="button"
      ref={setRef}
      {...attributes}
      {...listeners}
      aria-label={`Drag to reorder ${label}`}
      // touch-action: none lets the handle (and only the handle) capture touch drags.
      style={{ touchAction: 'none' }}
      className="p-2 -m-1 cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 dark:text-gray-600 dark:hover:text-gray-400 select-none"
    >
      ⠿
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function RankedListView<T>({
  items,
  getId,
  getRank,
  getLabel,
  columns,
  renderCard,
  sortOptions,
  compareBy,
  compareUnranked,
  onReorder,
  onRemove,
}: Props<T>) {
  const isDesktop = useIsDesktop();
  const [sortBy, setSortBy] = useState('rank');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const canDrag = sortBy === 'rank';

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const ranked = useMemo(
    () =>
      items
        .filter((i) => getRank(i) != null)
        .sort((a, b) => (getRank(a) as number) - (getRank(b) as number)),
    [items, getRank]
  );
  const unranked = useMemo(
    () => items.filter((i) => getRank(i) == null).sort(compareUnranked),
    [items, getRank, compareUnranked]
  );
  const rankedIds = useMemo(() => ranked.map(getId), [ranked, getId]);

  /** Every row, in the order shown when not in the ranked/unranked sections. */
  const sortedAll = useMemo(() => {
    if (canDrag) return [];
    return [...items].sort((a, b) => {
      const cmp = compareBy(sortBy, a, b);
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [items, canDrag, compareBy, sortBy, sortDir]);

  const handleSort = (key: string) => {
    if (sortBy === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortBy(key);
    setSortDir(sortOptions.find((o) => o.key === key)?.defaultDir ?? 'asc');
  };

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over) return;
    const id = String(active.id);
    if (over.id === UNRANKED_ZONE) {
      if (rankedIds.includes(id)) void onReorder(rankedIds.filter((r) => r !== id));
      return;
    }
    const from = rankedIds.indexOf(id);
    const to = rankedIds.indexOf(String(over.id));
    if (from < 0 || to < 0 || from === to) return;
    void onReorder(arrayMove(rankedIds, from, to));
  };

  const menuFor = (item: T) => (
    <RowMenu
      label={getLabel(item)}
      rank={getRank(item)}
      rankedCount={ranked.length}
      onMoveTo={(rank) => {
        const next = moveToRank(rankedIds, getId(item), rank);
        if (next.length !== rankedIds.length || next.some((v, i) => v !== rankedIds[i])) void onReorder(next);
      }}
      onUnrank={() => void onReorder(rankedIds.filter((r) => r !== getId(item)))}
      onRemove={() => onRemove(item)}
    />
  );

  const sortControls = !isDesktop && (
    <div className="flex items-center gap-2 mb-3">
      <label htmlFor="ranked-list-sort" className="text-xs text-gray-500 dark:text-gray-400">
        Sort by
      </label>
      <select
        id="ranked-list-sort"
        value={sortBy}
        onChange={(e) => handleSort(e.target.value)}
        className="flex-1 min-w-0 px-2 py-1.5 text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-700 dark:text-gray-200"
      >
        {sortOptions.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
        aria-label={sortDir === 'asc' ? 'Ascending (tap for descending)' : 'Descending (tap for ascending)'}
        className="p-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400"
      >
        {sortDir === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
      </button>
    </div>
  );

  // -- Table layout ---------------------------------------------------------

  const headerCell = (key: string, label: string, extraClass = '') => (
    <th
      scope="col"
      aria-sort={sortBy === key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={`py-2 pr-3 font-semibold ${extraClass}`}
    >
      <button
        type="button"
        onClick={() => handleSort(key)}
        className="inline-flex items-center gap-1 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
      >
        {label}
        {sortBy === key && (sortDir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
      </button>
    </th>
  );

  const colSpan = columns.length + 3;

  const tableRow = (item: T, sortable: boolean) => (
    <TableRow
      key={getId(item)}
      id={getId(item)}
      label={getLabel(item)}
      rank={getRank(item)}
      sortable={sortable}
      showHandle={canDrag}
      cells={columns.map((c) => (
        <td key={c.key} className={`py-2.5 pr-3 ${c.className ?? ''}`}>
          {c.render(item)}
        </td>
      ))}
      menu={menuFor(item)}
    />
  );

  const table = (
    <div className="overflow-x-auto -mx-1 px-1">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-gray-200 dark:border-gray-700 text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
            {canDrag && <th scope="col" className="py-2 pr-2 w-8" aria-label="Drag handle" />}
            {headerCell('rank', 'Rank', 'pl-0')}
            {columns.map((c) => (c.key ? headerCell(c.key, c.label) : <th key={c.label} className="py-2 pr-3">{c.label}</th>))}
            <th scope="col" className="py-2 pl-3 w-8" aria-label="Actions" />
          </tr>
        </thead>
        {canDrag ? (
          <>
            <tbody>
              <SortableContext items={rankedIds} strategy={verticalListSortingStrategy}>
                {ranked.map((item) => tableRow(item, true))}
              </SortableContext>
            </tbody>
            <UnrankedTableBody count={unranked.length} colSpan={colSpan}>
              {unranked.map((item) => tableRow(item, false))}
            </UnrankedTableBody>
          </>
        ) : (
          <tbody>{sortedAll.map((item) => tableRow(item, false))}</tbody>
        )}
      </table>
    </div>
  );

  // -- Card layout ----------------------------------------------------------

  const card = (item: T, sortable: boolean) => (
    <CardRow
      key={getId(item)}
      id={getId(item)}
      label={getLabel(item)}
      rank={getRank(item)}
      sortable={sortable}
      showHandle={canDrag}
      body={renderCard(item)}
      menu={menuFor(item)}
    />
  );

  const cards = (
    <>
      {sortControls}
      {canDrag ? (
        <>
          <SortableContext items={rankedIds} strategy={verticalListSortingStrategy}>
            <ul className="space-y-2">{ranked.map((item) => card(item, true))}</ul>
          </SortableContext>
          <UnrankedCards count={unranked.length}>{unranked.map((item) => card(item, false))}</UnrankedCards>
        </>
      ) : (
        <ul className="space-y-2">{sortedAll.map((item) => card(item, false))}</ul>
      )}
    </>
  );

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      {isDesktop ? table : cards}
    </DndContext>
  );
}

// ---------------------------------------------------------------------------
// Rows & unranked sections
// ---------------------------------------------------------------------------

function useRowSortable(id: string, sortable: boolean) {
  const s = useSortable({ id, disabled: !sortable });
  const style = {
    transform: CSS.Transform.toString(s.transform),
    transition: s.transition,
  };
  return { ...s, style };
}

function TableRow({
  id,
  label,
  rank,
  sortable,
  showHandle,
  cells,
  menu,
}: {
  id: string;
  label: string;
  rank: number | null;
  sortable: boolean;
  showHandle: boolean;
  cells: ReactNode;
  menu: ReactNode;
}) {
  const s = useRowSortable(id, sortable);
  return (
    <tr
      ref={s.setNodeRef}
      style={s.style}
      className={[
        'border-b border-gray-100 dark:border-gray-800 last:border-0',
        s.isDragging ? 'opacity-60 bg-gray-50 dark:bg-gray-800/60 relative z-10' : 'hover:bg-gray-50 dark:hover:bg-gray-800/60',
      ].join(' ')}
    >
      {showHandle && (
        <td className="py-2.5 pr-2">
          {sortable ? (
            <DragHandle label={label} attributes={s.attributes as any} listeners={s.listeners as any} setRef={s.setActivatorNodeRef} />
          ) : null}
        </td>
      )}
      <td className="py-2.5 pr-3 tabular-nums w-12">
        <RankBadge rank={rank} />
      </td>
      {cells}
      <td className="py-2.5 pl-3 text-right">{menu}</td>
    </tr>
  );
}

function CardRow({
  id,
  label,
  rank,
  sortable,
  showHandle,
  body,
  menu,
}: {
  id: string;
  label: string;
  rank: number | null;
  sortable: boolean;
  showHandle: boolean;
  body: ReactNode;
  menu: ReactNode;
}) {
  const s = useRowSortable(id, sortable);
  return (
    <li
      ref={s.setNodeRef}
      style={s.style}
      className={[
        'flex items-center gap-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 px-3 py-2.5',
        s.isDragging ? 'opacity-70 shadow-lg relative z-10' : '',
      ].join(' ')}
    >
      {showHandle && (
        <div className="w-6 shrink-0 text-center">
          {sortable ? (
            <DragHandle label={label} attributes={s.attributes as any} listeners={s.listeners as any} setRef={s.setActivatorNodeRef} />
          ) : null}
        </div>
      )}
      <div className="shrink-0 w-7 text-center">
        <RankBadge rank={rank} />
      </div>
      <div className="flex-1 min-w-0">{body}</div>
      <div className="shrink-0">{menu}</div>
    </li>
  );
}

function UnrankedTableBody({ count, colSpan, children }: { count: number; colSpan: number; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: UNRANKED_ZONE });
  return (
    <tbody ref={setNodeRef} className={isOver ? 'bg-primary-50 dark:bg-primary-900/30' : ''}>
      <tr>
        <th
          colSpan={colSpan}
          scope="colgroup"
          className={[
            'py-2 text-left text-xs font-semibold uppercase tracking-wide border-t-2 border-dashed',
            isOver
              ? 'text-primary-700 dark:text-primary-300 border-primary-400'
              : 'text-gray-400 border-gray-200 dark:border-gray-700',
          ].join(' ')}
        >
          {isOver ? 'Drop here to remove the rank' : 'Unranked'}
          {count > 0 && !isOver && <span className="ml-1 normal-case">({count})</span>}
        </th>
      </tr>
      {children}
    </tbody>
  );
}

function UnrankedCards({ count, children }: { count: number; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: UNRANKED_ZONE });
  return (
    <section
      ref={setNodeRef}
      aria-label="Unranked"
      className={[
        'mt-3 rounded-xl border-2 border-dashed p-2 transition-colors',
        isOver ? 'border-primary-400 bg-primary-50 dark:bg-primary-900/30' : 'border-gray-200 dark:border-gray-700',
      ].join(' ')}
    >
      <p className={`px-1 pb-2 text-xs font-semibold uppercase tracking-wide ${isOver ? 'text-primary-700 dark:text-primary-300' : 'text-gray-400'}`}>
        {isOver ? 'Drop here to remove the rank' : 'Unranked'}
        {count > 0 && !isOver && <span className="ml-1 normal-case">({count})</span>}
      </p>
      <ul className="space-y-2">{children}</ul>
    </section>
  );
}

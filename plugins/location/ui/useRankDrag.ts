/**
 * Shared drag-to-rank state for list detail tables (checkin lists and venue
 * lists). Items are identified by `getId`; ranked items form the top block of
 * the table, and dropping a row on the "Unranked" zone clears its rank.
 * Persisting is delegated to `persistOrder`, which receives the ranked ids in
 * their new order (1..n).
 */

import { useMemo, useState } from 'react';
import type { DragEvent } from 'react';

export type DropTarget =
  | { type: 'row'; id: string; pos: 'before' | 'after' }
  | { type: 'unranked' };

interface Options<T> {
  items: T[];
  getId: (item: T) => string;
  getRank: (item: T) => number | null;
  /** Unranked items are listed by this comparator (e.g. newest first). */
  compareUnranked: (a: T, b: T) => number;
  canDrag: boolean;
  persistOrder: (rankedIds: string[]) => Promise<void>;
}

export function useRankDrag<T>({ items, getId, getRank, compareUnranked, canDrag, persistOrder }: Options<T>) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);

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

  /** Rebuild the ranked order for a drop, then persist it. */
  const applyDrop = async (target: DropTarget, draggedId: string) => {
    if (target.type === 'unranked') {
      const nextRanked = ranked.filter((i) => getId(i) !== draggedId);
      if (nextRanked.length === ranked.length) return; // already unranked
      await persistOrder(nextRanked.map(getId));
      return;
    }

    const targetRow = items.find((i) => getId(i) === target.id);
    if (!targetRow || getId(targetRow) === draggedId) return;

    // Dropping onto an unranked row means "append to the end of the ranked block".
    const base = ranked.filter((i) => getId(i) !== draggedId);
    let insertAt: number;
    if (getRank(targetRow) == null) {
      insertAt = base.length;
    } else {
      const idx = base.findIndex((i) => getId(i) === getId(targetRow));
      insertAt = target.pos === 'before' ? idx : idx + 1;
    }
    if (!items.some((i) => getId(i) === draggedId)) return;

    const nextRankedIds = base.map(getId);
    nextRankedIds.splice(Math.max(0, Math.min(insertAt, nextRankedIds.length)), 0, draggedId);

    // No-op when the order didn't actually change.
    const currentRankedIds = ranked.map(getId);
    if (
      nextRankedIds.length === currentRankedIds.length &&
      nextRankedIds.every((v, i) => v === currentRankedIds[i])
    ) {
      return;
    }
    await persistOrder(nextRankedIds);
  };

  const onRowDragStart = (e: DragEvent, id: string) => {
    if (!canDrag) return;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
    setDragId(id);
  };

  const onDragEnd = () => {
    setDragId(null);
    setDropTarget(null);
  };

  const onRowDragOver = (e: DragEvent, id: string) => {
    if (!dragId || !canDrag || id === dragId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = e.currentTarget.getBoundingClientRect();
    const pos: 'before' | 'after' = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
    setDropTarget((prev) =>
      prev && prev.type === 'row' && prev.id === id && prev.pos === pos ? prev : { type: 'row', id, pos }
    );
  };

  const onDrop = async (e: DragEvent, target: DropTarget) => {
    e.preventDefault();
    const id = dragId ?? (e.dataTransfer.getData('text/plain') || null);
    setDropTarget(null);
    setDragId(null);
    if (!id) return;
    await applyDrop(target, id);
  };

  const onRowDrop = (e: DragEvent, id: string) => {
    const pos = dropTarget && dropTarget.type === 'row' && dropTarget.id === id ? dropTarget.pos : 'after';
    void onDrop(e, { type: 'row', id, pos });
  };

  const onUnrankedDragOver = (e: DragEvent) => {
    if (!dragId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropTarget({ type: 'unranked' });
  };

  const onUnrankedDragLeave = () =>
    setDropTarget((prev) => (prev?.type === 'unranked' ? null : prev));

  const dropIndicator = (id: string) => {
    if (!dropTarget || dropTarget.type !== 'row' || dropTarget.id !== id || !dragId) return '';
    return dropTarget.pos === 'before' ? 'border-t-2 border-t-primary-500' : 'border-b-2 border-b-primary-500';
  };

  return {
    ranked,
    unranked,
    dragId,
    unrankedZoneActive: dropTarget?.type === 'unranked' && !!dragId,
    onRowDragStart,
    onDragEnd,
    onRowDragOver,
    onRowDrop,
    onUnrankedDragOver,
    onUnrankedDragLeave,
    onUnrankedDrop: (e: DragEvent) => void onDrop(e, { type: 'unranked' }),
    dropIndicator,
  };
}

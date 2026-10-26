/**
 * The user's music lists, shared by everything that shows a list badge or a
 * list picker. One module-level copy is fetched once and refreshed whenever
 * anything changes a list, so a heart appears the moment an item is added.
 */

import { useEffect, useState } from 'react';
import { music } from './api';
import type { MusicList } from './types';

let lists: MusicList[] | null = null;
/** item key -> how many lists hold it; rebuilt once per change, not per badge. */
let memberships = new Map<string, number>();
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function publish(next: MusicList[]) {
  lists = next;
  memberships = new Map();
  for (const l of next) for (const i of l.items) memberships.set(i.item_key, (memberships.get(i.item_key) ?? 0) + 1);
  listeners.forEach((l) => l());
}

/** Fetch the lists again (after any add, remove, rename or delete). */
export function refreshMusicLists(): Promise<void> {
  loading = music
    .lists()
    .then(publish)
    .catch(() => {
      // Keep what we had; badges are decoration.
      if (lists === null) publish([]);
    })
    .finally(() => {
      loading = null;
    });
  return loading;
}

/** For tests: forget the cache. */
export function resetMusicLists(): void {
  lists = null;
  memberships = new Map();
  loading = null;
  listeners.clear();
}

export function useMusicLists() {
  const [, force] = useState(0);
  useEffect(() => {
    const rerender = () => force((n) => n + 1);
    listeners.add(rerender);
    if (lists === null && loading === null) void refreshMusicLists();
    return () => {
      listeners.delete(rerender);
    };
  }, []);

  return {
    lists: lists ?? [],
    loaded: lists !== null,
    /** Is this item (by `song:<key>` / `album:<ref>`) on any list? */
    has: (itemKey: string | null | undefined) => (itemKey ? memberships.has(itemKey) : false),
    /** How many lists hold it. */
    count: (itemKey: string) => memberships.get(itemKey) ?? 0,
    refresh: refreshMusicLists,
  };
}

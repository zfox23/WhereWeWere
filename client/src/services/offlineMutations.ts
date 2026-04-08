import type { TimelineItem } from '../types';

const API_BASE = '/api/v1';
const DB_NAME = 'wherewewere-offline';
const DB_VERSION = 1;
const STORE_NAME = 'mutations';
const UPDATE_EVENT = 'www-offline-mutations-updated';

export type OfflineEntityType = 'checkin' | 'mood' | 'sleep';
export type OfflineMutationType = 'create' | 'update' | 'delete';

export interface OfflineMutationRecord {
  id: string;
  entityType: OfflineEntityType;
  mutationType: OfflineMutationType;
  method: 'POST' | 'PUT' | 'DELETE';
  path: string;
  entityId?: string;
  payload: Record<string, unknown> | null;
  createdAt: number;
  retryCount: number;
  lastError: string | null;
  status: 'pending' | 'failed';
}

let replayInFlight: Promise<void> | null = null;
let syncInitialized = false;

function getDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function txRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function emitMutationUpdate() {
  window.dispatchEvent(new CustomEvent(UPDATE_EVENT));
}

export function subscribeOfflineMutations(onChange: () => void): () => void {
  const listener = () => onChange();
  window.addEventListener(UPDATE_EVENT, listener);
  return () => window.removeEventListener(UPDATE_EVENT, listener);
}

export async function listOfflineMutations(): Promise<OfflineMutationRecord[]> {
  const db = await getDb();
  const tx = db.transaction(STORE_NAME, 'readonly');
  const records = await txRequest(tx.objectStore(STORE_NAME).getAll()) as OfflineMutationRecord[];
  return records.sort((a, b) => a.createdAt - b.createdAt);
}

export async function enqueueOfflineMutation(input: Omit<OfflineMutationRecord, 'id' | 'createdAt' | 'retryCount' | 'lastError' | 'status'>): Promise<OfflineMutationRecord | null> {
  const db = await getDb();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  const existing = (await txRequest(store.getAll()) as OfflineMutationRecord[])
    .sort((a, b) => a.createdAt - b.createdAt);

  const compacted = compactMutation(existing, input);
  if (!compacted) {
    await txRequest(store.clear());
    for (const record of existing) {
      await txRequest(store.put(record));
    }
    emitMutationUpdate();
    return null;
  }

  await txRequest(store.clear());
  for (const record of compacted.records) {
    await txRequest(store.put(record));
  }

  const created: OfflineMutationRecord = {
    id: crypto.randomUUID(),
    entityType: input.entityType,
    mutationType: input.mutationType,
    method: input.method,
    path: input.path,
    entityId: input.entityId,
    payload: input.payload,
    createdAt: Date.now(),
    retryCount: 0,
    lastError: null,
    status: 'pending',
  };
  await txRequest(store.put(created));
  emitMutationUpdate();
  return created;
}

function compactMutation(existing: OfflineMutationRecord[], next: Omit<OfflineMutationRecord, 'id' | 'createdAt' | 'retryCount' | 'lastError' | 'status'>): { records: OfflineMutationRecord[] } | null {
  if (!next.entityId) {
    return { records: existing };
  }

  const sameEntity = existing.filter((record) => record.entityType === next.entityType && record.entityId === next.entityId);
  let records = existing.slice();

  if (next.mutationType === 'update') {
    records = records.filter((record) => !(record.entityType === next.entityType && record.entityId === next.entityId && record.mutationType === 'update'));
    return { records };
  }

  if (next.mutationType === 'delete') {
    const hasPendingCreate = sameEntity.some((record) => record.mutationType === 'create');
    if (hasPendingCreate) {
      records = records.filter((record) => !(record.entityType === next.entityType && record.entityId === next.entityId));
      return { records };
    }

    records = records.filter((record) => !(record.entityType === next.entityType && record.entityId === next.entityId && record.mutationType === 'update'));
    return { records };
  }

  return { records };
}

export async function replayOfflineMutations(): Promise<void> {
  if (replayInFlight) {
    return replayInFlight;
  }

  replayInFlight = (async () => {
    if (!navigator.onLine) return;

    const db = await getDb();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const records = (await txRequest(store.getAll()) as OfflineMutationRecord[])
      .sort((a, b) => a.createdAt - b.createdAt);

    for (const record of records) {
      try {
        const res = await fetch(`${API_BASE}${record.path}`, {
          method: record.method,
          headers: { 'Content-Type': 'application/json' },
          body: record.payload ? JSON.stringify(record.payload) : undefined,
        });

        const deleteAlreadyGone = record.mutationType === 'delete' && res.status === 404;
        if (res.ok || deleteAlreadyGone) {
          await txRequest(store.delete(record.id));
          continue;
        }

        const error = await res.json().catch(() => ({ message: res.statusText }));
        const nextRecord: OfflineMutationRecord = {
          ...record,
          retryCount: record.retryCount + 1,
          status: 'failed',
          lastError: (error as { message?: string; error?: string }).message
            || (error as { message?: string; error?: string }).error
            || `Request failed (${res.status})`,
        };
        await txRequest(store.put(nextRecord));
      } catch {
        const nextRecord: OfflineMutationRecord = {
          ...record,
          retryCount: record.retryCount + 1,
          status: 'pending',
        };
        await txRequest(store.put(nextRecord));
        break;
      }
    }
    emitMutationUpdate();
  })();

  try {
    await replayInFlight;
  } finally {
    replayInFlight = null;
  }
}

export function initOfflineMutationSync() {
  if (syncInitialized || typeof window === 'undefined') {
    return;
  }

  syncInitialized = true;
  window.addEventListener('online', () => {
    void replayOfflineMutations();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && navigator.onLine) {
      void replayOfflineMutations();
    }
  });

  if (navigator.onLine) {
    void replayOfflineMutations();
  }
}

export async function applyOfflineMutationsToTimeline(serverItems: TimelineItem[]): Promise<TimelineItem[]> {
  const pending = await listOfflineMutations();
  const items = new Map(serverItems.map((item) => [item.id, item]));

  for (const mutation of pending) {
    const payload = mutation.payload || {};
    if (mutation.mutationType === 'create') {
      const optimistic = toOptimisticTimelineItem(mutation);
      if (optimistic) {
        items.set(optimistic.id, optimistic);
      }
      continue;
    }

    if (!mutation.entityId) continue;

    if (mutation.mutationType === 'delete') {
      items.delete(mutation.entityId);
      continue;
    }

    const existing = items.get(mutation.entityId);
    if (!existing) continue;

    if (mutation.entityType === 'checkin') {
      items.set(mutation.entityId, {
        ...existing,
        notes: (payload.notes as string | null | undefined) ?? existing.notes,
        checked_in_at: (payload.checked_in_at as string | undefined) ?? existing.checked_in_at,
      });
    } else if (mutation.entityType === 'mood') {
      items.set(mutation.entityId, {
        ...existing,
        notes: (payload.note as string | null | undefined) ?? existing.notes,
        checked_in_at: (payload.checked_in_at as string | undefined) ?? existing.checked_in_at,
        mood: (payload.mood as number | undefined) ?? existing.mood,
        mood_timezone: (payload.mood_timezone as string | null | undefined) ?? existing.mood_timezone,
      });
    } else {
      items.set(mutation.entityId, {
        ...existing,
        checked_in_at: (payload.started_at as string | undefined) ?? existing.checked_in_at,
        notes: (payload.comment as string | null | undefined) ?? existing.notes,
        sleep_started_at: (payload.started_at as string | undefined) ?? existing.sleep_started_at,
        sleep_ended_at: (payload.ended_at as string | undefined) ?? existing.sleep_ended_at,
        sleep_timezone: (payload.sleep_timezone as string | null | undefined) ?? existing.sleep_timezone,
        sleep_rating: (payload.rating as number | undefined) ?? existing.sleep_rating,
        sleep_comment: (payload.comment as string | null | undefined) ?? existing.sleep_comment,
      });
    }
  }

  return Array.from(items.values()).sort((a, b) => new Date(b.checked_in_at).getTime() - new Date(a.checked_in_at).getTime());
}

function toOptimisticTimelineItem(mutation: OfflineMutationRecord): TimelineItem | null {
  const payload = mutation.payload || {};
  const base = {
    id: `offline:${mutation.id}`,
    user_id: String((payload.user_id as string | undefined) || '00000000-0000-0000-0000-000000000001'),
    created_at: new Date(mutation.createdAt).toISOString(),
    notes: null as string | null,
    checked_in_at: new Date(mutation.createdAt).toISOString(),
  };

  if (mutation.entityType === 'checkin') {
    return {
      ...base,
      type: 'location',
      venue_id: String((payload.venue_id as string | undefined) || ''),
      venue_name: String((payload.venue_name as string | undefined) || 'Offline check-in'),
      notes: (payload.notes as string | null | undefined) ?? null,
      checked_in_at: String((payload.checked_in_at as string | undefined) || base.checked_in_at),
    };
  }

  if (mutation.entityType === 'mood') {
    return {
      ...base,
      type: 'mood',
      notes: (payload.note as string | null | undefined) ?? null,
      checked_in_at: String((payload.checked_in_at as string | undefined) || base.checked_in_at),
      mood: Number((payload.mood as number | undefined) || 0),
      mood_timezone: (payload.mood_timezone as string | null | undefined) ?? null,
      activities: null,
    };
  }

  if (mutation.entityType === 'sleep') {
    return {
      ...base,
      type: 'sleep',
      checked_in_at: String((payload.started_at as string | undefined) || base.checked_in_at),
      notes: (payload.comment as string | null | undefined) ?? null,
      sleep_as_android_id: Number((payload.sleep_as_android_id as number | undefined) || 0),
      sleep_started_at: String((payload.started_at as string | undefined) || base.checked_in_at),
      sleep_ended_at: String((payload.ended_at as string | undefined) || base.checked_in_at),
      sleep_timezone: (payload.sleep_timezone as string | null | undefined) ?? null,
      sleep_rating: Number((payload.rating as number | undefined) || 0),
      sleep_comment: (payload.comment as string | null | undefined) ?? null,
    };
  }

  return null;
}
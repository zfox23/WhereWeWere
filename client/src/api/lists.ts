/**
 * The client half of the shared list kit: the calls every ranked list type
 * serves under `<base>/lists` (see server/src/services/lists/routes.ts).
 * Plugins add their own item calls (what an add body looks like differs).
 */

import { request } from './client';

export function createListsApi<List = any, Item = any>(base: string) {
  const json = (body: unknown) => JSON.stringify(body);
  return {
    list: () => request<List[]>(`${base}/lists`),
    create: (name: string) => request<any>(`${base}/lists`, { method: 'POST', body: json({ name }) }),
    rename: (id: string, name: string) => request<any>(`${base}/lists/${id}`, { method: 'PUT', body: json({ name }) }),
    delete: (id: string) => request<{ message?: string; id: string }>(`${base}/lists/${id}`, { method: 'DELETE' }),
    items: (listId: string) => request<Item[]>(`${base}/lists/${listId}/items`),
    removeItem: (listId: string, itemId: string) =>
      request<unknown>(`${base}/lists/${listId}/items/${itemId}`, { method: 'DELETE' }),
    // Drag-to-rank: the item ids in their new rank order (1..n); everyone else becomes unranked.
    reRank: (listId: string, rankedIds: string[]) =>
      request<{ ranked_ids: string[] }>(`${base}/lists/${listId}/ranks`, { method: 'PUT', body: json({ ranked_ids: rankedIds }) }),
    // A paused "rank by comparing" session.
    rankSession: (listId: string) => request<{ state: any; updated_at: string }>(`${base}/lists/${listId}/rank-session`),
    saveRankSession: (listId: string, state: unknown) =>
      request<{ saved: boolean }>(`${base}/lists/${listId}/rank-session`, { method: 'PUT', body: json({ state }) }),
    discardRankSession: (listId: string) =>
      request<{ deleted: boolean }>(`${base}/lists/${listId}/rank-session`, { method: 'DELETE' }),
  };
}

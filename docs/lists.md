# Lists

Check-in lists, venue lists (Places), media lists and music lists all work the same way: a named list of items, ranked 1..n among the ranked ones (the rest are unranked), reorderable by dragging, and rankable by answering "A or B?" (see "Rank by comparing" in [music.md](music.md)). They share code but keep their own tables, because each item type has its own foreign keys.

## Server

`server/src/services/lists/` is the shared kit. A plugin describes its tables once:

```ts
const kit = createListKit({ lists: 'venue_lists', items: 'venue_list_items', itemId: 'venue_id', sessions: 'venue_rank_sessions' });
mountRankRoutes(venuesRouter, kit, USER_ID);
```

- `mountRankRoutes` serves `PUT /lists/:id/ranks` (the item ids in their new order; everyone else becomes unranked) and `GET/PUT/DELETE /lists/:id/rank-session` (a paused ranking, so it can be resumed).
- The kit also has `ownsList`, `closeGaps` (call after removing an item so ranks stay 1..n), `setRanks`, and `cleanName` / `nameTakenOrThrow` / `listError` for the name rules (400 invalid, 409 taken).
- The plugin writes what differs: the item add and read queries, backup, and Start Over.

A list's tables need: lists with `id` (UUID), `user_id`, `updated_at`; items with `list_id`, `rank INT NULL` and a UUID item id column; and a sessions table (`list_id` UUID primary key referencing the list `ON DELETE CASCADE`, `state` JSONB, `updated_at`). Item ids must be UUIDs.

## Client

`client/src/components/lists/`:

- `ListsIndex` is the index (create, rename, delete).
- `useRankedList` plus `RankedListDetail` is the detail view: loading, drag-to-rank, remove. `RankableListDetail` adds the "Rank by comparing" button and swaps in `RankByComparing`.
- `compareByRank` is the shared rank sort. `ListSectionShell` is the card with a spinner. `useLists` loads the index.
- `ranking/engine.ts` is the pure engine behind "Rank by comparing".
- `client/src/api/lists.ts` `createListsApi(base)` gives the calls every list type serves.

To add a list type to a plugin: create the tables, build a kit and mount the routes, then render `RankableListDetail` with your columns, a card, and a `renderContender` that says how an item looks in a duel.

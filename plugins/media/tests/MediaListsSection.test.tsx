import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  lists: vi.fn(),
  listItems: vi.fn(),
  rankList: vi.fn(),
  removeItemFromList: vi.fn(),
  createList: vi.fn(),
  renameList: vi.fn(),
  deleteList: vi.fn(),
}));
vi.mock('../ui/api', () => ({ media: api }));

import { MediaListsSection } from '../ui/MediaListsSection';

const item = (over: Record<string, unknown> = {}) => ({
  id: 'm1', media_type: 'movie', title: 'Dune', author: null, release_year: 2021, image_url: null,
  added_at: '2026-01-01T00:00:00Z', rank: null, rating: 3, checkin_count: 2,
  last_checkin_at: '2026-01-02T20:00:00Z', last_checkin_timezone: 'UTC', ...over,
});

const renderSection = () => render(<MemoryRouter><MediaListsSection /></MemoryRouter>);

describe('MediaListsSection', () => {
  beforeEach(() => {
    Object.values(api).forEach((m) => m.mockReset());
    window.history.replaceState({}, '', '/profile');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    api.lists.mockResolvedValue([{ id: 'l1', name: 'Watchlist', created_at: '2026-01-01T00:00:00Z', items: [item()] }]);
    api.listItems.mockResolvedValue([item({ rank: 1 }), item({ id: 'm2', title: 'Arrival', rank: 2 })]);
    api.rankList.mockResolvedValue({ ranked_ids: [] });
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('opens a list into its ranked detail view and records it in the URL', async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(await screen.findByRole('button', { name: /^Watchlist/ }));
    expect(await screen.findByText('Arrival')).toBeTruthy();
    expect(api.listItems).toHaveBeenCalledWith('l1');
    await waitFor(() => expect(new URLSearchParams(window.location.search).get('mediaList')).toBe('l1'));
  });

  it('offers rank by comparing on a list of two or more items', async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(await screen.findByRole('button', { name: /^Watchlist/ }));
    const button = (await screen.findByRole('button', { name: 'Rank by comparing' })) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  });

  it('removing an item confirms, removes it and reloads the list', async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(await screen.findByRole('button', { name: /^Watchlist/ }));
    await user.click(await screen.findByRole('button', { name: 'Actions for Dune' }));
    api.removeItemFromList.mockImplementation(async () => {
      api.listItems.mockResolvedValue([item({ id: 'm2', title: 'Arrival', rank: 1 })]);
    });
    await user.click(screen.getByRole('menuitem', { name: 'Remove from list' }));
    expect(window.confirm).toHaveBeenCalledWith('Remove "Dune" from "Watchlist"? The item itself is kept.');
    await waitFor(() => expect(api.removeItemFromList).toHaveBeenCalledWith('l1', 'm1'));
    await waitFor(() => expect(screen.queryByText('Dune')).toBeNull());
  });
});

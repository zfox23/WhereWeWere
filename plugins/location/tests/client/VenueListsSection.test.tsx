import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { VenueListsSection } from '../../ui/VenueListsSection';

const apiMocks = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  rename: vi.fn(),
  delete: vi.fn(),
  items: vi.fn(),
  removeVenue: vi.fn(),
  reRank: vi.fn(),
}));

vi.mock('../../../../client/src/api/client', () => ({
  venueLists: apiMocks,
}));

const ITEM = (over: Partial<Record<string, unknown>> = {}) => ({
  venue_id: 'v1',
  venue_name: 'Steel Vengeance',
  rank: null,
  added_at: '2026-01-01T00:00:00Z',
  city: 'Sandusky',
  state: 'OH',
  country: 'US',
  rating: 5,
  category_name: 'Roller Coaster',
  category_icon: null,
  last_checkin_at: '2026-01-01T19:00:00Z',
  last_checkin_timezone: 'America/New_York',
  checkin_count: 2,
  ...over,
});

describe('VenueListsSection', () => {
  beforeEach(() => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    Object.values(apiMocks).forEach((m) => m.mockReset());
    apiMocks.list.mockResolvedValue([
      {
        id: 'vl1',
        name: 'Favorite coasters',
        created_at: '2026-01-01',
        items: [
          { id: 'v1', name: 'Steel Vengeance', added_at: '2026-01-01', rank: 1 },
          { id: 'v2', name: 'Millennium Force', added_at: '2026-01-02', rank: null },
        ],
      },
    ]);
    apiMocks.items.mockResolvedValue([
      ITEM({ rank: 1 }),
      ITEM({ venue_id: 'v2', venue_name: 'Millennium Force' }),
    ]);
    apiMocks.create.mockResolvedValue({ id: 'vl2', name: 'New' });
    apiMocks.removeVenue.mockResolvedValue({ message: 'ok' });
    apiMocks.reRank.mockImplementation((_id: string, ids: string[]) => Promise.resolve({ ranked_ids: ids }));
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows venue lists with venue counts', async () => {
    render(<VenueListsSection />);
    expect(await screen.findByText('Favorite coasters')).toBeTruthy();
    expect(screen.getByText(/2 venues/)).toBeTruthy();
  });

  it('creates a venue list', async () => {
    const user = userEvent.setup();
    render(<VenueListsSection />);
    await user.type(await screen.findByLabelText('New venue list name'), 'Waterparks');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(apiMocks.create).toHaveBeenCalledWith('Waterparks'));
  });

  it('opens a list detail with ranked rows and a back button', async () => {
    const user = userEvent.setup();
    render(<VenueListsSection />);
    await user.click(await screen.findByRole('button', { name: /^Favorite coasters/ }));
    expect(await screen.findByText('Steel Vengeance')).toBeTruthy();
    expect(screen.getByText('Millennium Force')).toBeTruthy();
    expect(apiMocks.items).toHaveBeenCalledWith('vl1');
    expect(screen.getByText('Unranked')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /Back to lists/ }));
    await waitFor(() => expect(screen.queryByText('Millennium Force')).toBeNull());
  });

  it('removing a ranked venue closes the rank gap via re-rank', async () => {
    const user = userEvent.setup();
    apiMocks.items.mockResolvedValue([
      ITEM({ rank: 1 }),
      ITEM({ venue_id: 'v2', venue_name: 'Millennium Force', rank: 2 }),
    ]);
    render(<VenueListsSection />);
    await user.click(await screen.findByRole('button', { name: /^Favorite coasters/ }));
    await user.click(await screen.findByRole('button', { name: 'Actions for Steel Vengeance' }));
    await user.click(screen.getByRole('menuitem', { name: 'Remove from list' }));

    await waitFor(() => expect(apiMocks.removeVenue).toHaveBeenCalledWith('vl1', 'v1'));
    await waitFor(() => expect(apiMocks.reRank).toHaveBeenCalledWith('vl1', ['v2']));
  });
});

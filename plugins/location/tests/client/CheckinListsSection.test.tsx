import { MemoryRouter } from 'react-router-dom';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { CheckinListsSection } from '../../ui/CheckinListsSection';

const apiMocks = vi.hoisted(() => ({
  listsList: vi.fn(),
  listsCreate: vi.fn(),
  listsRename: vi.fn(),
  listsDelete: vi.fn(),
  listsItems: vi.fn(),
  listsRemoveCheckin: vi.fn(),
  listsReRank: vi.fn(),
}));

vi.mock('../../../../client/src/api/client', () => ({
  checkinLists: {
    list: apiMocks.listsList,
    create: apiMocks.listsCreate,
    rename: apiMocks.listsRename,
    delete: apiMocks.listsDelete,
    items: apiMocks.listsItems,
    removeCheckin: apiMocks.listsRemoveCheckin,
    reRank: apiMocks.listsReRank,
  },
}));

const ITEM = (over: Partial<Record<string, unknown>> = {}) => ({
  checkin_id: 'c1',
  rank: null,
  added_at: '2026-01-01T00:00:00Z',
  checked_in_at: '2026-01-01T19:00:00Z',
  venue_timezone: 'America/New_York',
  notes: null,
  rating: null,
  venue_id: 'v1',
  venue_name: 'Fillmore',
  parent_venue_id: null,
  parent_venue_name: null,
  companions: [] as string[],
  ...over,
});

async function openListDetail(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(await screen.findByRole('button', { name: new RegExp(name) }));
  await screen.findByRole('button', { name: /Back to lists/ });
}

describe('CheckinListsSection', () => {
  beforeEach(() => {
    apiMocks.listsList.mockReset();
    apiMocks.listsCreate.mockReset();
    apiMocks.listsRename.mockReset();
    apiMocks.listsDelete.mockReset();
    apiMocks.listsItems.mockReset();
    apiMocks.listsRemoveCheckin.mockReset();
    apiMocks.listsReRank.mockReset();

    apiMocks.listsList.mockResolvedValue([
      { id: 'cl1', name: 'Concerts', created_at: '2026-01-01', updated_at: '2026-01-02', item_count: 2 },
    ]);
    apiMocks.listsCreate.mockImplementation((name: string) =>
      Promise.resolve({ id: `cl-${name}`, name, created_at: '2026-01-01', item_count: 0 })
    );
    apiMocks.listsRename.mockResolvedValue({ id: 'cl1', name: 'renamed' });
    apiMocks.listsDelete.mockResolvedValue({ message: 'ok', id: 'cl1' });
    apiMocks.listsItems.mockResolvedValue([
      ITEM({ rank: 1 }),
      ITEM({ checkin_id: 'c2', venue_name: 'Apollo' }),
    ]);
    apiMocks.listsRemoveCheckin.mockResolvedValue({ message: 'ok' });
    apiMocks.listsReRank.mockImplementation((_listId: string, ids: string[]) =>
      Promise.resolve({ ranked_ids: ids })
    );
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows the lists index with item counts', async () => {
    render(<MemoryRouter><CheckinListsSection /></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: 'Checkin Lists' })).toBeTruthy();
    expect(screen.getByText('Concerts')).toBeTruthy();
    expect(screen.getByText(/2 check-ins/)).toBeTruthy();
  });

  it('creates a new list', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><CheckinListsSection /></MemoryRouter>);

    await screen.findByRole('heading', { name: 'Checkin Lists' });
    await user.type(screen.getByLabelText('New checkin list name'), 'Broadway');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => {
      expect(apiMocks.listsCreate).toHaveBeenCalledWith('Broadway');
    });
  });

  it('opens a list detail with the table rows and a back button', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><CheckinListsSection /></MemoryRouter>);

    await openListDetail(user, 'Concerts');
    expect(screen.getByText('Fillmore')).toBeTruthy();
    expect(screen.getByText('Apollo')).toBeTruthy();

    // Back to the index.
    await user.click(screen.getByRole('button', { name: /Back to lists/ }));
    await waitFor(() => expect(screen.queryByText('Apollo')).toBeNull());
  });

  it('links venue name and check-in date to their detail pages (new tab)', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><CheckinListsSection /></MemoryRouter>);

    await openListDetail(user, 'Concerts');
    await waitFor(() => expect(screen.getByText('Fillmore')).toBeTruthy());

    const venueLink = screen.getByRole('link', { name: 'Fillmore' });
    expect(venueLink.getAttribute('href')).toBe('/venues/v1');
    expect(venueLink.getAttribute('target')).toBe('_blank');

    const dateLinks = screen.getAllByRole('link', { name: /Jan/ });
    expect(dateLinks[0].getAttribute('href')).toBe('/location-checkins/c1');
    expect(dateLinks[0].getAttribute('target')).toBe('_blank');
  });

  it('removes a check-in from the list via the row action', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><CheckinListsSection /></MemoryRouter>);

    await openListDetail(user, 'Concerts');
    await waitFor(() => expect(screen.getByText('Apollo')).toBeTruthy());

    await user.click(screen.getByRole('button', { name: 'Remove Apollo from Concerts' }));

    await waitFor(() => {
      expect(apiMocks.listsRemoveCheckin).toHaveBeenCalledWith('cl1', 'c2');
    });
    await waitFor(() => expect(screen.queryByText('Apollo')).toBeNull());
  });

  it('shows a drag hint and the unranked drop zone when sorted by rank (default)', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><CheckinListsSection /></MemoryRouter>);

    await openListDetail(user, 'Concerts');
    await waitFor(() => expect(screen.getByText('Fillmore')).toBeTruthy());

    expect(screen.getByText(/Drag rows to rank them/)).toBeTruthy();
    expect(screen.getByText(/^Unranked/)).toBeTruthy();
  });

  it('persists a re-rank when a row is dropped after another ranked row', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><CheckinListsSection /></MemoryRouter>);

    await openListDetail(user, 'Concerts');
    await waitFor(() => expect(screen.getByText('Apollo')).toBeTruthy());

    const apolloRow = screen.getByText('Apollo').closest('tr') as HTMLElement;
    const fillmoreRow = screen.getByText('Fillmore').closest('tr') as HTMLElement;

    // Simulate: drag "Apollo" (unranked) and drop it after "Fillmore" (rank 1).
    // Plain Events lack dataTransfer, so attach a minimal mock.
    const makeDragEvent = (type: string) => {
      const ev = new Event(type, { bubbles: true, cancelable: true }) as Event & { dataTransfer: unknown };
      ev.dataTransfer = { setData: vi.fn(), getData: vi.fn(() => ''), effectAllowed: '', dropEffect: '' };
      return ev;
    };

    await act(async () => {
      apolloRow.dispatchEvent(makeDragEvent('dragstart'));
    });
    await act(async () => {
      fillmoreRow.dispatchEvent(makeDragEvent('dragover'));
    });
    await act(async () => {
      fillmoreRow.dispatchEvent(makeDragEvent('drop'));
    });

    await waitFor(() => {
      expect(apiMocks.listsReRank).toHaveBeenCalledWith('cl1', ['c1', 'c2']);
    });
  });
});

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { VenuesLibrarySection } from '../ui/VenuesLibrarySection';
import type { VenueLibraryItem, VenueList } from '../../../client/src/types';

const libraryMock = vi.fn();
const listsMock = vi.fn();
vi.mock('../../../client/src/api/client', () => ({
  venues: {
    library: (...args: unknown[]) => libraryMock(...args),
  },
  venueLists: {
    list: () => listsMock(),
  },
}));

function makeItem(overrides: Partial<VenueLibraryItem> = {}): VenueLibraryItem {
  return {
    id: 'v1',
    name: 'Blue Bottle',
    category_id: 'cat1',
    category_name: 'Cafe',
    category_icon: '☕',
    address: null,
    city: 'Charlotte',
    state: null,
    country: null,
    rating: 3,
    lists: ['Favorites'],
    last_checkin_at: '2026-05-01T12:00:00Z',
    last_checkin_timezone: 'America/New_York',
    checkin_count: 2,
    ...overrides,
  };
}

// The server does the searching, sorting and paging; this stands in for it.
type Opts = { q?: string; category?: string; list?: string; sort?: string; dir?: string; limit?: number; offset?: number };
const LIST_MEMBERS: Record<string, string[]> = { l2: ['b', 'c'] };
function fakeServer(all: VenueLibraryItem[]) {
  return async (_from: string | undefined, _to: string | undefined, o: Opts = {}) => {
    let rows = all.filter((r) =>
      (!o.q || r.name.toLowerCase().includes(o.q.toLowerCase())) &&
      (!o.category || (r.category_name ?? '').toLowerCase().includes(o.category.toLowerCase())) &&
      (!o.list || (LIST_MEMBERS[o.list] ?? []).includes(r.id)));
    const value = (r: VenueLibraryItem): number | string | null =>
      o.sort === 'name' ? r.name : o.sort === 'rating' ? r.rating : o.sort === 'checkin_count' ? r.checkin_count : r.last_checkin_at;
    const sign = o.dir === 'asc' ? 1 : -1;
    rows = [...rows].sort((x, y) => {
      const vx = value(x), vy = value(y);
      if (vx === vy) return 0;
      if (vx === null) return 1; // nulls last
      if (vy === null) return -1;
      return (vx < vy ? -1 : 1) * sign;
    });
    return { rows: rows.slice(o.offset ?? 0, (o.offset ?? 0) + (o.limit ?? 100)), total: rows.length };
  };
}

const a = makeItem({ id: 'a', name: 'Alpha', rating: 4, last_checkin_at: '2026-03-01T00:00:00Z', checkin_count: 1, lists: [] });
const b = makeItem({ id: 'b', name: 'Bravo', rating: 1, last_checkin_at: '2026-06-01T00:00:00Z', checkin_count: 5, lists: ['Trips'] });
const c = makeItem({ id: 'c', name: 'Charlie', rating: null, last_checkin_at: '2026-04-01T00:00:00Z', checkin_count: 3, lists: ['Trips'] });

function renderSection(props: { from?: string; to?: string } = {}) {
  return render(
    <MemoryRouter initialEntries={['/profile?tab=plugin:location']}>
      <Routes>
        <Route path="/profile" element={<VenuesLibrarySection from={props.from ?? ''} to={props.to ?? ''} />} />
        <Route path="/venues/:id" element={<div>detail</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  libraryMock.mockReset();
  libraryMock.mockImplementation(fakeServer([a, b, c]));
  listsMock.mockReset();
  listsMock.mockResolvedValue([
    { id: 'l1', name: 'Favorites', created_at: '2026-01-01', items: [] },
    { id: 'l2', name: 'Trips', created_at: '2026-01-02', items: [{ id: 'b', name: 'Bravo', added_at: '2026-01-03' }, { id: 'c', name: 'Charlie', added_at: '2026-01-04' }] } satisfies VenueList,
  ]);
});

afterEach(() => {
  cleanup();
});

const lastOpts = () => (libraryMock.mock.calls.at(-1) as unknown[])[2] as Opts;
const order = (...names: string[]) => {
  const els = names.map((n) => screen.getByText(n));
  for (let i = 1; i < els.length; i++) {
    expect(els[i - 1].compareDocumentPosition(els[i])).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  }
};

describe('VenuesLibrarySection (table)', () => {
  it('renders a row per venue and the total', async () => {
    renderSection();
    await waitFor(() => expect(screen.getByText('Alpha')).toBeTruthy());
    expect(screen.getByText('Bravo')).toBeTruthy();
    expect(screen.getByText('Charlie')).toBeTruthy();
    expect(screen.getByText('Showing 3 of 3')).toBeTruthy();
  });

  it('asks the server for the newest check-ins first by default', async () => {
    renderSection();
    await waitFor(() => expect(screen.getByText('Alpha')).toBeTruthy());
    expect(lastOpts()).toMatchObject({ sort: 'last_checkin', dir: 'desc', limit: 100, q: '', category: '' });
    order('Bravo', 'Charlie', 'Alpha');
  });

  it('re-queries sorted by rating, then flips direction, when the Rating header is clicked twice', async () => {
    const user = userEvent.setup();
    renderSection();
    await waitFor(() => expect(screen.getByText('Alpha')).toBeTruthy());
    const ratingHeader = screen.getByRole('button', { name: /Rating/ });
    await user.click(ratingHeader);
    await waitFor(() => expect(lastOpts()).toMatchObject({ sort: 'rating', dir: 'desc' }));
    await waitFor(() => order('Alpha', 'Bravo', 'Charlie')); // 4, 1, unrated last
    await user.click(ratingHeader);
    await waitFor(() => expect(lastOpts()).toMatchObject({ sort: 'rating', dir: 'asc' }));
    await waitFor(() => order('Bravo', 'Alpha', 'Charlie'));
  });

  it('sorts by name ascending when the Venue header is clicked', async () => {
    const user = userEvent.setup();
    renderSection();
    await waitFor(() => expect(screen.getByText('Alpha')).toBeTruthy());
    await user.click(screen.getByRole('button', { name: /Venue/ }));
    await waitFor(() => expect(lastOpts()).toMatchObject({ sort: 'name', dir: 'asc' }));
    await waitFor(() => order('Alpha', 'Bravo', 'Charlie'));
  });

  it('sends the name filter to the server once typing pauses', async () => {
    const user = userEvent.setup();
    renderSection();
    await waitFor(() => expect(screen.getByText('Alpha')).toBeTruthy());
    await user.type(screen.getByLabelText('Filter venues by name'), 'bravo');
    await waitFor(() => expect(screen.queryByText('Alpha')).toBeNull());
    expect(lastOpts().q).toBe('bravo');
    expect(libraryMock.mock.calls.some((c) => (c[2] as Opts).q === 'b')).toBe(false); // not one request per keystroke
    expect(screen.getByText('Bravo')).toBeTruthy();
  });

  it('sends the category filter to the server', async () => {
    const user = userEvent.setup();
    renderSection();
    await waitFor(() => expect(screen.getByText('Alpha')).toBeTruthy());
    await user.type(screen.getByLabelText('Filter venues by category'), 'cafe');
    await waitFor(() => expect(lastOpts().category).toBe('cafe'));
    expect(screen.getByText('Alpha')).toBeTruthy(); // all three are cafes
  });

  it('sends the selected list to the server', async () => {
    const user = userEvent.setup();
    renderSection();
    await waitFor(() => expect(screen.getByText('Alpha')).toBeTruthy());
    await user.selectOptions(screen.getByLabelText('Filter venues by list') as HTMLSelectElement, 'l2');
    await waitFor(() => expect(screen.queryByText('Alpha')).toBeNull());
    expect(lastOpts().list).toBe('l2');
    expect(screen.getByText('Bravo')).toBeTruthy();
    expect(screen.getByText('Charlie')).toBeTruthy();
  });

  it('shows a tailored empty state when a filter excludes everything', async () => {
    const user = userEvent.setup();
    renderSection();
    await waitFor(() => expect(screen.getByText('Alpha')).toBeTruthy());
    await user.type(screen.getByLabelText('Filter venues by name'), 'zzz-no-match');
    await waitFor(() => expect(screen.getByText(/No venues match the current filters/i)).toBeTruthy());
  });

  it('pages: shows the first page and appends the next on Show more', async () => {
    const many = Array.from({ length: 130 }, (_, i) =>
      makeItem({ id: `v${i}`, name: `Venue ${String(i).padStart(3, '0')}`, last_checkin_at: new Date(2026, 0, 1, 0, 0, 130 - i).toISOString() }));
    libraryMock.mockImplementation(fakeServer(many));
    const user = userEvent.setup();
    renderSection();
    expect(await screen.findByText('Showing 100 of 130')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Show more' }));
    expect(await screen.findByText('Showing 130 of 130')).toBeTruthy();
    expect(lastOpts()).toMatchObject({ offset: 100 });
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
  });

  it('ignores a slow answer for a filter that has since changed', async () => {
    const user = userEvent.setup();
    let release: (v: unknown) => void = () => {};
    const slow = new Promise((resolve) => { release = resolve; });
    const fast = fakeServer([a, b, c]);
    libraryMock.mockImplementation((f: string | undefined, t: string | undefined, o: Opts) =>
      o.q === 'bravo' ? slow : fast(f, t, o));
    renderSection();
    await waitFor(() => expect(screen.getByText('Alpha')).toBeTruthy());
    await user.type(screen.getByLabelText('Filter venues by name'), 'bravo');
    await waitFor(() => expect(lastOpts().q).toBe('bravo'));
    await user.clear(screen.getByLabelText('Filter venues by name'));
    await waitFor(() => expect(lastOpts().q).toBe('')); // the newer query has been sent
    release({ rows: [b], total: 1 }); // the stale 'bravo' answer arrives late
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByText('Alpha')).toBeTruthy();
  });
});

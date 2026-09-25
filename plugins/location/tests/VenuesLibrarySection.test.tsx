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

const a = makeItem({ id: 'a', name: 'Alpha', rating: 4, last_checkin_at: '2026-03-01T00:00:00Z', checkin_count: 1, lists: [] });
const b = makeItem({ id: 'b', name: 'Bravo', rating: 1, last_checkin_at: '2026-06-01T00:00:00Z', checkin_count: 5, lists: ['Trips'] });
const c = makeItem({ id: 'c', name: 'Charlie', rating: null, last_checkin_at: '2026-04-01T00:00:00Z', checkin_count: 3, lists: ['Trips'] });

function renderSection(props: { from?: string; to?: string } = {}) {
  return render(
    <MemoryRouter initialEntries={['/profile?tab=places']}>
      <Routes>
        <Route path="/profile" element={<VenuesLibrarySection from={props.from ?? ''} to={props.to ?? ''} />} />
        <Route path="/venues/:id" element={<div>detail</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  libraryMock.mockReset();
  libraryMock.mockResolvedValue([a, b, c]);
  listsMock.mockReset();
  listsMock.mockResolvedValue([
    { id: 'l1', name: 'Favorites', created_at: '2026-01-01', items: [] },
    { id: 'l2', name: 'Trips', created_at: '2026-01-02', items: [{ id: 'b', name: 'Bravo', added_at: '2026-01-03' }, { id: 'c', name: 'Charlie', added_at: '2026-01-04' }] } satisfies VenueList,
  ]);
});

afterEach(() => {
  cleanup();
});

describe('VenuesLibrarySection (table)', () => {
  it('renders a row per venue with name, check-in count, and list names', async () => {
    renderSection();
    await waitFor(() => expect(screen.getByText('Alpha')).toBeTruthy());
    expect(screen.getByText('Bravo')).toBeTruthy();
    expect(screen.getByText('Charlie')).toBeTruthy();
    // "Trips" list column shows on the venues that belong to it.
    expect(screen.getAllByText('Trips').length).toBeGreaterThanOrEqual(2);
  });

  it('defaults to sorting by last check-in, newest first', async () => {
    renderSection();
    await waitFor(() => expect(screen.getByText('Alpha')).toBeTruthy());
    // Bravo (June) before Charlie (April) before Alpha (March).
    const alpha = screen.getByText('Alpha');
    const bravo = screen.getByText('Bravo');
    const charlie = screen.getByText('Charlie');
    expect(bravo.compareDocumentPosition(charlie)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(charlie.compareDocumentPosition(alpha)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('sorts by rating ascending when the Rating header is clicked twice', async () => {
    const user = userEvent.setup();
    renderSection();
    await waitFor(() => expect(screen.getByText('Alpha')).toBeTruthy());
    const ratingHeader = screen.getByRole('button', { name: /Rating/ });
    await user.click(ratingHeader); // first click: rating desc
    await user.click(ratingHeader); // second click: rating asc
    const alpha = screen.getByText('Alpha');
    const bravo = screen.getByText('Bravo');
    const charlie = screen.getByText('Charlie');
    // Unrated (Charlie) first, then Bravo(1), then Alpha(4).
    expect(charlie.compareDocumentPosition(bravo)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(bravo.compareDocumentPosition(alpha)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('sorts by name ascending when the Venue header is clicked', async () => {
    const user = userEvent.setup();
    renderSection();
    await waitFor(() => expect(screen.getByText('Alpha')).toBeTruthy());
    await user.click(screen.getByRole('button', { name: /Venue/ }));
    const alpha = screen.getByText('Alpha');
    const bravo = screen.getByText('Bravo');
    const charlie = screen.getByText('Charlie');
    expect(alpha.compareDocumentPosition(bravo)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(bravo.compareDocumentPosition(charlie)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('filters by name text', async () => {
    const user = userEvent.setup();
    renderSection();
    await waitFor(() => expect(screen.getByText('Alpha')).toBeTruthy());
    await user.type(screen.getByLabelText('Filter venues by name'), 'bravo');
    await waitFor(() => expect(screen.queryByText('Alpha')).toBeNull());
    expect(screen.getByText('Bravo')).toBeTruthy();
  });

  it('filters by category text', async () => {
    const user = userEvent.setup();
    renderSection();
    await waitFor(() => expect(screen.getByText('Alpha')).toBeTruthy());
    await user.type(screen.getByLabelText('Filter venues by category'), 'cafe');
    // All three share the Cafe category, so all remain.
    expect(screen.getByText('Alpha')).toBeTruthy();
    expect(screen.getByText('Bravo')).toBeTruthy();
  });

  it('filters by selected list', async () => {
    const user = userEvent.setup();
    renderSection();
    await waitFor(() => expect(screen.getByText('Alpha')).toBeTruthy());
    const listSelect = screen.getByLabelText('Filter venues by list') as HTMLSelectElement;
    await user.selectOptions(listSelect, 'l2');
    await waitFor(() => expect(screen.queryByText('Alpha')).toBeNull());
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
});

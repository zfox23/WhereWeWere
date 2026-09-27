import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import LocationCheckIn from '../../ui/LocationCheckIn';

const apiMocks = vi.hoisted(() => ({
  checkinsGet: vi.fn(),
  checkinsUpdate: vi.fn(),
  checkinsCreate: vi.fn(),
  checkinsDelete: vi.fn(),
  venuesGet: vi.fn(),
  checkinListsList: vi.fn(),
  checkinListsCreate: vi.fn(),
  companionsNames: vi.fn(),
  refetch: vi.fn(),
}));

vi.mock('../../../../client/src/api/client', () => ({
  checkins: {
    get: apiMocks.checkinsGet,
    create: apiMocks.checkinsCreate,
    update: apiMocks.checkinsUpdate,
    delete: apiMocks.checkinsDelete,
  },
  venues: {
    get: apiMocks.venuesGet,
  },
  checkinLists: {
    list: apiMocks.checkinListsList,
    create: apiMocks.checkinListsCreate,
  },
  companions: {
    names: apiMocks.companionsNames,
    photoUrl: (name: string) => `/api/v1/immich/person-photo?name=${encodeURIComponent(name)}`,
  },
  // No immich_* keys → companion photos stay hidden.
  settings: { get: () => Promise.resolve({}) },
}));

vi.mock('../../ui/LocationContext', () => ({
  useLocation: () => ({ coords: null, nearbyVenues: null, loading: false, refetch: apiMocks.refetch }),
}));

vi.mock('../../ui/MapView', () => ({
  default: () => null,
}));

const EDIT_CHECKIN = {
  id: 'c1',
  venue_id: 'v1',
  venue_name: 'Fillmore',
  parent_venue_id: null,
  parent_venue_name: null,
  notes: 'old note',
  checked_in_at: '2026-01-01T19:00:00Z',
  rating: null,
  companions: [] as string[],
  lists: [] as string[],
};

/** Renders the current route path so tests can assert on navigation. */
function LocationDisplay() {
  const location = useLocation();
  return <div data-testid="current-location">{location.pathname}</div>;
}

describe('LocationCheckIn (edit redirect)', () => {
  beforeEach(() => {
    apiMocks.checkinsGet.mockReset();
    apiMocks.checkinsUpdate.mockReset();
    apiMocks.checkinsCreate.mockReset();
    apiMocks.checkinsDelete.mockReset();
    apiMocks.venuesGet.mockReset();
    apiMocks.checkinListsList.mockReset();
    apiMocks.checkinListsCreate.mockReset();
    apiMocks.companionsNames.mockReset();
    apiMocks.refetch.mockReset();

    apiMocks.checkinsGet.mockResolvedValue(EDIT_CHECKIN);
    apiMocks.checkinsUpdate.mockResolvedValue({ id: 'c1' });
    apiMocks.venuesGet.mockResolvedValue({ latitude: null, longitude: null });
    apiMocks.checkinListsList.mockResolvedValue([]);
    apiMocks.companionsNames.mockResolvedValue([]);
    apiMocks.refetch.mockResolvedValue(null);
  });

  afterEach(() => {
    cleanup();
  });

  it('redirects to the check-in detail page after saving edits', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/location-check-in?edit=c1']}>
        <Routes>
          <Route path="/location-check-in" element={<LocationCheckIn />} />
          <Route path="/location-checkins/:id" element={<div>detail</div>} />
        </Routes>
        <LocationDisplay />
      </MemoryRouter>,
    );

    const notes = await screen.findByLabelText('Note.md');
    await user.clear(notes);
    await user.type(notes, 'updated');
    await user.click(notes);
    await user.keyboard('{Shift>}{Enter}{/Shift}');

    await waitFor(() => {
      expect(apiMocks.checkinsUpdate).toHaveBeenCalledWith(
        'c1',
        expect.objectContaining({ notes: 'updated' }),
      );
    });
    await waitFor(() => {
      expect(screen.getByTestId('current-location').textContent).toBe('/location-checkins/c1');
    });
  });
});

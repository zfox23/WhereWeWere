import { MemoryRouter } from 'react-router-dom';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import LocationCheckInForm from '../../ui/LocationCheckInForm';

const apiMocks = vi.hoisted(() => ({
  checkinsCreate: vi.fn(),
  checkinsUpdate: vi.fn(),
  checkinsDelete: vi.fn(),
  companionsNames: vi.fn(),
  venuesGet: vi.fn(),
  venuesDelete: vi.fn(),
  checkinListsList: vi.fn(),
  checkinListsCreate: vi.fn(),
}));

vi.mock('../../../../client/src/api/client', () => ({
  checkins: {
    create: apiMocks.checkinsCreate,
    update: apiMocks.checkinsUpdate,
    delete: apiMocks.checkinsDelete,
  },
  companions: {
    names: apiMocks.companionsNames,
    photoUrl: (name: string) => `/api/v1/immich/person-photo?name=${encodeURIComponent(name)}`,
  },
  checkinLists: {
    list: apiMocks.checkinListsList,
    create: apiMocks.checkinListsCreate,
  },
  // No immich_* keys → companion photos stay hidden.
  settings: { get: () => Promise.resolve({}) },
  venues: {
    get: apiMocks.venuesGet,
    delete: apiMocks.venuesDelete,
  },
}));

describe('LocationCheckInForm', () => {
  beforeEach(() => {
    apiMocks.checkinsCreate.mockReset();
    apiMocks.checkinsUpdate.mockReset();
    apiMocks.checkinsDelete.mockReset();
    apiMocks.companionsNames.mockReset();
    apiMocks.venuesGet.mockReset();
    apiMocks.venuesDelete.mockReset();
    apiMocks.checkinListsList.mockReset();
    apiMocks.checkinListsCreate.mockReset();

    apiMocks.checkinsCreate.mockResolvedValue({ id: 'checkin-1' });
    apiMocks.checkinListsList.mockResolvedValue([]);
    apiMocks.checkinListsCreate.mockImplementation(
      (name: string) => Promise.resolve({ id: `list-${name}`, name })
    );
    apiMocks.companionsNames.mockResolvedValue([]);
    apiMocks.venuesGet.mockResolvedValue({
      checkin_count: 0,
      category_name: null,
      address: null,
      city: null,
      state: null,
      postal_code: null,
      country: null,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('submits and calls onSuccess when pressing Shift+Enter in notes', async () => {
    const onSuccess = vi.fn();
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <LocationCheckInForm venueId="venue-1" venueName="Test Venue" onSuccess={onSuccess} />
      </MemoryRouter>,
    );

    const notesInput = screen.getByLabelText('Note.md');

    await user.type(notesInput, 'Late night coffee');
    await user.keyboard('{Shift>}{Enter}{/Shift}');

    await waitFor(() => {
      expect(apiMocks.checkinsCreate).toHaveBeenCalledTimes(1);
    });

    expect(apiMocks.checkinsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: '00000000-0000-0000-0000-000000000001',
        venue_id: 'venue-1',
        notes: 'Late night coffee',
        checked_in_at: expect.any(String),
        also_checkin_parent: false,
      }),
    );
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it('includes the selected rating and companions in the create payload', async () => {
    const onSuccess = vi.fn();
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <LocationCheckInForm venueId="venue-1" venueName="Test Venue" onSuccess={onSuccess} />
      </MemoryRouter>,
    );

    // Pick a 3-star rating.
    await user.click(screen.getByRole('radio', { name: '3 stars' }));
    // Add a companion via the "Here With…" chip input.
    await user.type(screen.getByLabelText('Here with (companion names)'), 'Ada{Enter}');
    // Submit with Shift+Enter in the notes field.
    const notesInput = screen.getByLabelText('Note.md');
    await user.click(notesInput);
    await user.keyboard('{Shift>}{Enter}{/Shift}');

    await waitFor(() => {
      expect(apiMocks.checkinsCreate).toHaveBeenCalledTimes(1);
    });

    expect(apiMocks.checkinsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        venue_id: 'venue-1',
        rating: 3,
        companions: ['Ada'],
      }),
    );
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it('includes selected lists in the create payload', async () => {
    apiMocks.checkinListsList.mockResolvedValueOnce([
      { id: 'list-a', name: 'Concerts' },
      { id: 'list-b', name: 'Broadway' },
    ]);
    const onSuccess = vi.fn();
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <LocationCheckInForm venueId="venue-1" venueName="Test Venue" onSuccess={onSuccess} />
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole('button', { name: /Concerts/ }));
    await user.click(screen.getByRole('button', { name: /Broadway/ }));
    const notesInput = screen.getByLabelText('Note.md');
    await user.click(notesInput);
    await user.keyboard('{Shift>}{Enter}{/Shift}');

    await waitFor(() => {
      expect(apiMocks.checkinsCreate).toHaveBeenCalledTimes(1);
    });
    expect(apiMocks.checkinsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ list_ids: ['list-a', 'list-b'] }),
    );
  });

  it('creates a new list and includes it in the create payload', async () => {
    const onSuccess = vi.fn();
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <LocationCheckInForm venueId="venue-1" venueName="Test Venue" onSuccess={onSuccess} />
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText('New list name'), 'Concerts');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => {
      expect(apiMocks.checkinListsCreate).toHaveBeenCalledWith('Concerts');
    });
    // The newly created list is now selected.
    await user.click(screen.getByRole('button', { name: /Concerts/ }));
    const notesInput = screen.getByLabelText('Note.md');
    await user.click(notesInput);
    await user.keyboard('{Shift>}{Enter}{/Shift}');

    await waitFor(() => {
      expect(apiMocks.checkinsCreate).toHaveBeenCalledTimes(1);
    });
    expect(apiMocks.checkinsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ list_ids: ['list-Concerts'] }),
    );
  });

  it('sends the preselected lists on update in edit mode', async () => {
    const onSuccess = vi.fn();
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <LocationCheckInForm
          venueId="venue-1"
          venueName="Test Venue"
          onSuccess={onSuccess}
          editCheckinId="checkin-1"
          initialListIds={['list-a']}
        />
      </MemoryRouter>,
    );

    const notesInput = screen.getByLabelText('Note.md');
    await user.click(notesInput);
    await user.keyboard('{Shift>}{Enter}{/Shift}');

    await waitFor(() => {
      expect(apiMocks.checkinsUpdate).toHaveBeenCalledTimes(1);
    });
    expect(apiMocks.checkinsUpdate).toHaveBeenCalledWith(
      'checkin-1',
      expect.objectContaining({ list_ids: ['list-a'] }),
    );
  });
});

import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import LocationCheckInForm from '../../ui/LocationCheckInForm';

const apiMocks = vi.hoisted(() => ({
  checkinsCreate: vi.fn(),
  checkinsUpdate: vi.fn(),
  checkinsDelete: vi.fn(),
  checkinsCompanionNames: vi.fn(),
  venuesGet: vi.fn(),
  venuesDelete: vi.fn(),
}));

vi.mock('../../../../client/src/api/client', () => ({
  checkins: {
    create: apiMocks.checkinsCreate,
    update: apiMocks.checkinsUpdate,
    delete: apiMocks.checkinsDelete,
    companionNames: apiMocks.checkinsCompanionNames,
  },
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
    apiMocks.checkinsCompanionNames.mockReset();
    apiMocks.venuesGet.mockReset();
    apiMocks.venuesDelete.mockReset();

    apiMocks.checkinsCreate.mockResolvedValue({ id: 'checkin-1' });
    apiMocks.checkinsCompanionNames.mockResolvedValue([]);
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
});

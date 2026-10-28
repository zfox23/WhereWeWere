import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CheckinListening } from '../../src/components/CheckinListening';

const aroundMock = vi.fn();
vi.mock('../../src/api/client', () => ({
  musicListening: { around: (...args: unknown[]) => aroundMock(...args) },
}));

const ID = '11111111-1111-4111-8111-111111111111';

function renderSection() {
  return render(
    <MemoryRouter>
      <CheckinListening checkinId={ID} />
    </MemoryRouter>,
  );
}

describe('CheckinListening', () => {
  afterEach(() => {
    cleanup();
    aroundMock.mockReset();
  });

  it('lists the songs with covers and how long before the check-in they played', async () => {
    aroundMock.mockResolvedValue({
      [ID]: {
        session_id: 'sess-1',
        session_date: '2024-05-01',
        anchor_time: 1000,
        tracks: [
          { artists: ['Khruangbin'], title: 'Newest', time: 980, art_id: 'art-1' },
          { artists: ['Tycho'], title: 'Older', time: 700, art_id: null },
        ],
        has_more: false,
      },
    });
    renderSection();
    await waitFor(() => expect(screen.getByText('Playing just before')).toBeTruthy());
    expect(aroundMock).toHaveBeenCalledWith([ID]);
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'NewestKhruangbinjust before',
      'OlderTycho5 min before',
    ]);
    expect(screen.getAllByRole('link', { name: 'Show album details' })).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Show the whole listening session' }).getAttribute('href')).toBe(
      '/?from=2024-05-01&to=2024-05-01',
    );
  });

  it('renders nothing when nothing was playing or the music plugin is off', async () => {
    aroundMock.mockResolvedValue({});
    const { container } = renderSection();
    await waitFor(() => expect(aroundMock).toHaveBeenCalled());
    expect(container.innerHTML).toBe('');
    cleanup();
    aroundMock.mockRejectedValue(new Error('404'));
    const second = renderSection();
    await waitFor(() => expect(aroundMock).toHaveBeenCalledTimes(2));
    expect(second.container.innerHTML).toBe('');
  });
});

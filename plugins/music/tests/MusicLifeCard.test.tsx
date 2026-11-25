import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MusicLifeCard, rankItems } from '../ui/insights/MusicLifeCard';

const lifeMock = vi.fn();
vi.mock('../ui/api', () => ({
  music: { lifeSoundtrack: (...args: unknown[]) => lifeMock(...args) },
}));

const artist = (name: string, plays: number, lift: number) => ({ name, plays, lift });

const GROUPS = [
  {
    key: 'Sam', label: 'Sam', checkins: 3, plays: 12,
    top_artists: [artist('Usual', 8, 1.0), artist('Rare', 3, 4.2), artist('Once', 1, 9.9)],
    top_songs: [{ ...artist('Tune', 4, 2.0), artists: ['Usual'], song_key: 'tune|usual' }],
  },
  { key: 'Alex', label: 'Alex', checkins: 1, plays: 2, top_artists: [artist('Other', 2, 1.5)], top_songs: [] },
];

function renderCard() {
  render(
    <MemoryRouter>
      <MusicLifeCard from="2024-01-01" to="2024-12-31" />
    </MemoryRouter>,
  );
}

describe('MusicLifeCard', () => {
  beforeEach(() => {
    lifeMock.mockReset().mockImplementation((by: string) =>
      Promise.resolve(
        by === 'mood'
          ? { gap_minutes: 30, groups: [{ key: '5', label: '5', checkins: 1, plays: 1, top_artists: [], top_songs: [] }] }
          : by === 'place'
            ? { gap_minutes: 30, groups: [] }
            : { gap_minutes: 30, groups: GROUPS },
      ),
    );
  });
  afterEach(cleanup);

  it('shows the biggest group, switches group and orders by distinctiveness', async () => {
    const user = userEvent.setup();
    renderCard();
    expect(await screen.findByText('12 plays within 30 min of 3 check-ins')).toBeTruthy();
    expect(lifeMock).toHaveBeenCalledWith('companion', '2024-01-01', '2024-12-31');
    expect(screen.getByRole('link', { name: 'Usual' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Most distinctive' }));
    // "Once" has the highest lift but a single play, and "Usual" plays no more than usual: both left out.
    expect(screen.getAllByRole('link').map((a) => a.textContent)).toEqual(['Rare', 'Tune']);
    expect(screen.getByText('4.2× · 3')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /^Alex/ }));
    expect(screen.getByText('2 plays within 30 min of 1 check-in')).toBeTruthy();
  });

  it('lists the group\'s top genres, each opening its page', async () => {
    lifeMock.mockResolvedValue({ gap_minutes: 30, groups: [{ ...GROUPS[0], top_genres: [artist('trance', 9, 1.8), artist('house', 2, 0.5)] }] });
    renderCard();
    const genres = await screen.findByRole('link', { name: 'trance' });
    expect(genres.getAttribute('href')).toBe('/music/genre?name=trance');
    expect(screen.getByRole('heading', { name: 'Genres' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'house' })).toBeTruthy();
  });

  it('labels moods and explains an empty grouping', async () => {
    const user = userEvent.setup();
    renderCard();
    await screen.findByText(/12 plays/);
    await user.click(screen.getByRole('button', { name: 'Mood' }));
    expect(await screen.findByRole('button', { name: /^Excellent/ })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Places' }));
    await waitFor(() => expect(screen.getByText(/Check in at places/)).toBeTruthy());
  });

  it('ranks items', () => {
    const items = [artist('a', 5, 1), artist('b', 2, 3), artist('c', 1, 9)];
    expect(rankItems(items, 'played').map((i) => i.name)).toEqual(['a', 'b', 'c']);
    expect(rankItems(items, 'distinctive').map((i) => i.name)).toEqual(['b']);
  });
});

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AlbumPage from '../ui/pages/AlbumPage';
import { resetMusicLists } from '../ui/useMusicLists';

const albumViewMock = vi.fn();
vi.mock('../ui/api', () => ({
  albumArtUrl: (id: string, size = 'thumb') => `/art/${id}/${size}`,
  music: { albumView: (...a: unknown[]) => albumViewMock(...a), lists: async () => [] },
}));

const VIEW = {
  album_ref: 'group therapy|above & beyond', art_id: 'a1', matched: true, title: 'Group Therapy', artist: 'Above & Beyond',
  release_date: '2011-06-14', label: 'Anjunabeats', plays: 3, listened_seconds: 900,
  tracks: [{ position: 1, title: 'Sun & Moon', artists: ['Above & Beyond'], length: 321, plays: 3, song_key: 'k' }],
};

const renderAt = (search: string) =>
  render(
    <MemoryRouter initialEntries={[`/music/album${search}`]}>
      <AlbumPage />
    </MemoryRouter>,
  );

describe('AlbumPage', () => {
  beforeEach(() => resetMusicLists());
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows the same details as the modal, without a close button, and titles the tab', async () => {
    albumViewMock.mockResolvedValue(VIEW);
    renderAt('?ref=group+therapy%7Cabove+%26+beyond');
    expect(await screen.findByRole('heading', { name: /Group Therapy/ })).toBeTruthy();
    expect(albumViewMock).toHaveBeenCalledWith({ ref: 'group therapy|above & beyond', artId: null });
    expect(document.body.textContent).toContain('Jun 14, 2011 · Anjunabeats');
    expect(document.body.textContent).toContain('3 scrobbles');
    expect(screen.getByRole('button', { name: 'Add album to list' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull(); // a page, not an overlay
    expect(document.title).toContain('Group Therapy');
  });

  it('opens by cover id when there is no ref', async () => {
    albumViewMock.mockResolvedValue(VIEW);
    renderAt('?art_id=a1');
    await screen.findByRole('heading', { name: /Group Therapy/ });
    expect(albumViewMock).toHaveBeenCalledWith({ ref: null, artId: 'a1' });
  });

  it('says so without an album, and for one that is gone', async () => {
    renderAt('');
    expect(screen.getByText('No album was given.')).toBeTruthy();
    cleanup();
    albumViewMock.mockRejectedValue(new Error('404'));
    renderAt('?ref=nothing%7Cnobody');
    expect(await screen.findByText("Couldn't load this album.")).toBeTruthy();
  });

  it('adds to a list from the page as the modal does', async () => {
    const user = userEvent.setup();
    albumViewMock.mockResolvedValue(VIEW);
    renderAt('?ref=x');
    await user.click(await screen.findByRole('button', { name: 'Add album to list' }));
    expect(await screen.findByRole('dialog', { name: /Add .* to a list/ })).toBeTruthy();
  });
});

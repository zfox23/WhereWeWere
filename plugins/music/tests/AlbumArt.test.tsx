import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AlbumArt } from '../ui/AlbumArt';
import { releaseDateLabel } from '../ui/AlbumModal';

const albumMock = vi.fn();
vi.mock('../ui/api', () => ({
  albumArtUrl: (id: string, size = 'thumb') => `/art/${id}/${size}`,
  music: { album: (...args: unknown[]) => albumMock(...args) },
}));

const ALBUM = {
  id: 'a1',
  title: 'Group Therapy',
  artist: 'Above & Beyond',
  release_date: '2011-06-14',
  label: 'Anjunabeats',
  plays: 3,
  listened_seconds: 900,
  tracks: [
    { position: 1, title: 'Filaments', length: 300, plays: 0 },
    { position: 2, title: 'Sun & Moon', length: 321, plays: 3 },
  ],
};

describe('AlbumArt', () => {
  beforeEach(() => albumMock.mockResolvedValue(ALBUM));
  afterEach(() => {
    cleanup();
    albumMock.mockReset();
  });

  it('renders nothing without a cover', () => {
    const { container } = render(<AlbumArt artId={null} size={24} />);
    expect(container.innerHTML).toBe('');
  });

  it('opens the album details with the large cover, release info and play counts', async () => {
    const user = userEvent.setup();
    const { container } = render(<AlbumArt artId="a1" />);
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/art/a1/thumb');
    await user.click(screen.getByRole('button', { name: 'Show album details' }));
    const dialog = await screen.findByRole('dialog', { name: 'Group Therapy by Above & Beyond' });
    expect(dialog.querySelector('img')?.getAttribute('src')).toBe('/art/a1/large');
    expect(dialog.textContent).toContain('Jun 14, 2011 · Anjunabeats');
    expect(dialog.textContent).toContain('3 scrobbles');
    expect(dialog.textContent).toContain('5:21'); // track length
    expect(dialog.textContent).toContain('3x');
    expect(albumMock).toHaveBeenCalledWith('a1');
  });

  it('closes with Escape, the close button, or the backdrop', async () => {
    const user = userEvent.setup();
    render(<AlbumArt artId="a1" />);
    const open = () => user.click(screen.getByRole('button', { name: 'Show album details' }));
    await open();
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await open();
    await user.click(await screen.findByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await open();
    const dialog = await screen.findByRole('dialog');
    await user.click(dialog.parentElement!);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('disappears when the image fails to load', async () => {
    const { container } = render(<AlbumArt artId="a1" />);
    container.querySelector('img')!.dispatchEvent(new Event('error'));
    await waitFor(() => expect(container.innerHTML).toBe(''));
  });

  it('formats release dates, leaving partial ones as they are', () => {
    expect(releaseDateLabel('2011-06-14')).toBe('Jun 14, 2011');
    expect(releaseDateLabel('2011-06')).toBe('2011-06');
    expect(releaseDateLabel(null)).toBeNull();
  });
});

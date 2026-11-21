import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { libraryHref } from '../ui/libraryLinks';
import { ArtistLinks, SongLink, albumPath, artistPath, songPath } from '../ui/links';

afterEach(cleanup);

describe('libraryHref', () => {
  it('targets the Library subtab of the Music profile', () => {
    expect(libraryHref('artists', 'Above & Beyond')).toBe(
      '/profile?tab=plugin%3Amusic&musicSection=library&musicView=artists&q=Above+%26+Beyond',
    );
    // Songs is the default view, so it is left out.
    expect(libraryHref('songs', 'Soma')).toBe('/profile?tab=plugin%3Amusic&musicSection=library&q=Soma');
  });
});

describe('page paths', () => {
  it('identify songs, artists and albums in the query string', () => {
    expect(songPath('soma|the strokes')).toBe('/music/song?key=soma%7Cthe+strokes');
    expect(artistPath('Above & Beyond')).toBe('/music/artist?name=Above+%26+Beyond');
    expect(albumPath({ albumRef: 'is this it|the strokes' })).toBe('/music/album?ref=is+this+it%7Cthe+strokes');
    expect(albumPath({ artId: 'a1' })).toBe('/music/album?art_id=a1');
  });
});

describe('links', () => {
  it('link each artist to their page, separately', () => {
    const { container } = render(
      <MemoryRouter>
        <ArtistLinks artists={['Men I Trust', 'Guest']} />
      </MemoryRouter>,
    );
    expect(container.textContent).toBe('Men I Trust, Guest');
    expect(screen.getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual([artistPath('Men I Trust'), artistPath('Guest')]);
  });

  it('keep a click from reaching the card around them, and leave a song without a key as text', () => {
    const onCard = vi.fn();
    render(
      <MemoryRouter>
        <div onClick={onCard}>
          <SongLink songKey="k">Soma</SongLink>
          <SongLink songKey={null}>Untitled</SongLink>
        </div>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('link', { name: 'Soma' }));
    expect(onCard).not.toHaveBeenCalled();
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });
});

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ArtistLinks, HomeLibraryLink, libraryHref } from '../ui/libraryLinks';

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

describe('Home links', () => {
  it('open the library in a new tab, without leaking the opener', () => {
    render(<HomeLibraryLink view="songs" q="Soma">Soma</HomeLibraryLink>);
    const a = screen.getByRole('link', { name: 'Soma' });
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('link each artist separately', () => {
    const { container } = render(<ArtistLinks artists={['Men I Trust', 'Guest']} />);
    expect(container.textContent).toBe('Men I Trust, Guest');
    expect(screen.getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual([
      libraryHref('artists', 'Men I Trust'),
      libraryHref('artists', 'Guest'),
    ]);
  });
});

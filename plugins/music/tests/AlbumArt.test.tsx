import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AlbumArt } from '../ui/AlbumArt';
import { AlbumLink } from '../ui/AlbumLink';

vi.mock('../ui/api', () => ({
  albumArtUrl: (id: string, size = 'thumb') => `/art/${id}/${size}`,
}));

function Where() {
  const { pathname, search } = useLocation();
  return <p data-testid="where">{`${pathname}${search}`}</p>;
}

const renderIn = (ui: React.ReactNode) =>
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="*" element={<>{ui}<Where /></>} />
      </Routes>
    </MemoryRouter>,
  );

describe('AlbumArt', () => {
  afterEach(cleanup);

  it('renders nothing without a cover', () => {
    const { container } = render(<MemoryRouter><AlbumArt artId={null} size={24} /></MemoryRouter>);
    expect(container.innerHTML).toBe('');
  });

  it('opens the album\'s page, by its ref or else its cover, without the click reaching the row', async () => {
    const user = userEvent.setup();
    const onRow = vi.fn();
    renderIn(
      <div onClick={onRow}>
        <AlbumArt artId="a1" albumRef="group therapy|above & beyond" />
      </div>,
    );
    const link = screen.getByRole('link', { name: 'Show album' });
    expect(link.querySelector('img')?.getAttribute('src')).toBe('/art/a1/thumb');
    expect(link.getAttribute('href')).toBe('/music/album?ref=group+therapy%7Cabove+%26+beyond');
    await user.click(link);
    expect(screen.getByTestId('where').textContent).toBe('/music/album?ref=group+therapy%7Cabove+%26+beyond');
    expect(onRow).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
    cleanup();
    renderIn(<AlbumArt artId="a1" />);
    expect(screen.getByRole('link', { name: 'Show album' }).getAttribute('href')).toBe('/music/album?art_id=a1');
  });

  it('disappears when the image fails to load', async () => {
    const { container } = render(<MemoryRouter><AlbumArt artId="a1" /></MemoryRouter>);
    container.querySelector('img')!.dispatchEvent(new Event('error'));
    await waitFor(() => expect(container.innerHTML).toBe(''));
  });
});

describe('AlbumLink', () => {
  afterEach(cleanup);

  it('links an album name to its page, and reads "Unknown album" without one', () => {
    renderIn(
      <>
        <AlbumLink albumRef="discovery|daft punk">Discovery</AlbumLink>
        <AlbumLink albumRef={null} />
      </>,
    );
    expect(screen.getByRole('link', { name: 'Discovery' }).getAttribute('href')).toBe('/music/album?ref=discovery%7Cdaft+punk');
    expect(document.body.textContent).toContain('Unknown album');
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });
});

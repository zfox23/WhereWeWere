import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { MusicPreview } from '../../src/components/MusicPreview';
import { CardFooterContext, CardShell } from '../../src/components/checkin-card/CardShell';
import type { ListeningBefore } from '../../src/types';

const listening = (overrides: Partial<ListeningBefore> = {}): ListeningBefore => ({
  session_id: 'sess-1',
  session_date: '2024-05-01',
  tracks: [
    { artists: ['Khruangbin'], title: 'Newest', time: 300 },
    { artists: ['Men I Trust', 'Guest'], title: 'Middle', time: 200 },
    { artists: ['Tycho'], title: 'Oldest', time: 100 },
  ],
  has_more: true,
  ...overrides,
});

function Probe() {
  const loc = useLocation();
  return <div data-testid="probe">{loc.pathname}{loc.search}|{JSON.stringify(loc.state)}</div>;
}

function renderPreview(l: ListeningBefore, compact = false) {
  return render(
    <MemoryRouter initialEntries={['/somewhere']}>
      <Routes>
        <Route path="/somewhere" element={<MusicPreview listening={l} compact={compact} />} />
        <Route path="*" element={<Probe />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('MusicPreview', () => {
  afterEach(cleanup);

  it('lists the plays newest first', () => {
    renderPreview(listening());
    const items = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(items).toEqual(['Khruangbin — Newest', 'Men I Trust, Guest — Middle', 'Tycho — Oldest']);
  });

  it('fades only the oldest play, and only when the session has more', () => {
    renderPreview(listening());
    const items = screen.getAllByRole('listitem');
    expect(items.map((li) => li.getAttribute('data-faded'))).toEqual([null, null, 'true']);
    // A vertical gradient mask that ends fully transparent.
    expect(items[2].style.maskImage).toMatch(/linear-gradient\(.*transparent/);
    expect(items[0].getAttribute('style')).toBeNull();
    cleanup();
    renderPreview(listening({ has_more: false }));
    expect(screen.getAllByRole('listitem').every((li) => !li.hasAttribute('data-faded'))).toBe(true);
  });

  it('renders fewer plays without trouble, and nothing for none', () => {
    renderPreview(listening({ tracks: [{ artists: ['A'], title: 'Only', time: 1 }], has_more: false }));
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    cleanup();
    const { container } = renderPreview(listening({ tracks: [] }));
    expect(container.querySelector('a')).toBeNull();
  });

  const JUMP = '/?from=2024-05-01&to=2024-05-01|{"focusSession":"sess-1"}';

  it('jumps to the session day from the icon link or any preview line', async () => {
    const user = userEvent.setup();
    renderPreview(listening());
    const link = screen.getByRole('link', { name: 'Show this listening session on the timeline' });
    expect(link.getAttribute('href')).toBe('/?from=2024-05-01&to=2024-05-01');
    expect(link.querySelector('svg')).not.toBeNull();
    await user.click(screen.getByText('Middle', { exact: false }).closest('li')!);
    expect(screen.getByTestId('probe').textContent).toBe(JUMP);
    cleanup();
    renderPreview(listening());
    await user.click(screen.getByRole('link', { name: 'Show this listening session on the timeline' }));
    expect(screen.getByTestId('probe').textContent).toBe(JUMP);
  });

  it('links artists and titles to the library in a new tab without jumping to the session', async () => {
    const user = userEvent.setup();
    renderPreview(listening());
    const artist = screen.getByRole('link', { name: 'Khruangbin' });
    const title = screen.getByRole('link', { name: 'Newest' });
    expect(artist.getAttribute('href')).toContain('musicView=artists&q=Khruangbin');
    expect(title.getAttribute('href')).toContain('q=Newest');
    expect([artist.getAttribute('target'), title.getAttribute('target')]).toEqual(['_blank', '_blank']);
    await user.click(title);
    expect(screen.queryByTestId('probe')).toBeNull(); // the preview's own jump did not fire
  });

  it('shows a cover per play; clicking one opens the album instead of jumping', async () => {
    const user = userEvent.setup();
    renderPreview(listening({
      tracks: [
        { artists: ['A'], title: 'With cover', time: 2, art_id: 'art-1' },
        { artists: ['B'], title: 'Without', time: 1, art_id: null },
      ],
      has_more: false,
    }));
    const covers = screen.getAllByRole('link', { name: 'Show album details' });
    expect(covers).toHaveLength(1);
    expect(covers[0].querySelector('img')?.getAttribute('src')).toBe('/api/v1/music/albums/art-1/art');
    await user.click(covers[0]);
    expect(screen.queryByTestId('probe')).toBeNull(); // still on the originating route
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});

describe('CardShell footer', () => {
  afterEach(cleanup);

  it('renders the host-provided footer inside the card, and nothing by default', () => {
    const { rerender } = render(<CardShell><p>body</p></CardShell>);
    expect(screen.queryByText('footer')).toBeNull();
    rerender(
      <CardFooterContext.Provider value={<p>footer</p>}>
        <CardShell><p>body</p></CardShell>
      </CardFooterContext.Provider>,
    );
    const footer = screen.getByText('footer');
    expect(footer.parentElement).toBe(screen.getByText('body').parentElement);
  });
});

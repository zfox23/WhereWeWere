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
  anchor_time: 360,
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

  it('shows only the last song, with a toggle for the earlier ones', async () => {
    const user = userEvent.setup();
    renderPreview(listening());
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Khruangbin — Newest']);
    const toggle = screen.getByRole('button', { name: 'Show 2 earlier songs' });
    expect(toggle.textContent).toBe('+2');
    expect(toggle.getAttribute('title')).toBe('Men I Trust, Guest — Middle\nTycho — Oldest');
    await user.click(toggle);
    expect(screen.queryByTestId('probe')).toBeNull(); // toggling does not jump to the session
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Khruangbin — Newest',
      'Men I Trust, Guest — Middle',
      'Tycho — Oldest',
    ]);
    await user.click(screen.getByRole('button', { name: 'Show only the last song' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });

  it('has no toggle for a single song, and renders nothing for none', () => {
    renderPreview(listening({ tracks: [{ artists: ['A'], title: 'Only', time: 1 }], has_more: true }));
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.queryByRole('button')).toBeNull();
    cleanup();
    const { container } = renderPreview(listening({ tracks: [] }));
    expect(container.querySelector('a')).toBeNull();
  });

  it('shows no album covers', () => {
    renderPreview(listening({ tracks: [{ artists: ['A'], title: 'With cover', time: 2, art_id: 'art-1' }] }));
    expect(screen.queryByRole('link', { name: 'Show album details' })).toBeNull();
    expect(document.querySelector('img')).toBeNull();
  });

  const JUMP = '/?from=2024-05-01&to=2024-05-01|{"focusSession":"sess-1"}';

  it('jumps to the session day from the icon link or any preview line', async () => {
    const user = userEvent.setup();
    renderPreview(listening());
    const link = screen.getByRole('link', { name: 'Show this listening session on the timeline' });
    expect(link.getAttribute('href')).toBe('/?from=2024-05-01&to=2024-05-01');
    expect(link.querySelector('svg')).not.toBeNull();
    await user.click(screen.getByText('Newest', { exact: false }).closest('li')!);
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

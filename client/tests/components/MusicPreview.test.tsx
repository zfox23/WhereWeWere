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

  it('is one link to the session day, carrying the session to reveal', async () => {
    const user = userEvent.setup();
    renderPreview(listening());
    const link = screen.getByRole('link', { name: 'Show this listening session on the timeline' });
    expect(link.getAttribute('href')).toBe('/?from=2024-05-01&to=2024-05-01');
    // The icon and every preview line are inside it, so any of them jumps.
    expect(link.querySelector('svg')).not.toBeNull();
    expect(link.querySelectorAll('li')).toHaveLength(3);
    await user.click(screen.getByText('Middle', { exact: false }));
    expect(screen.getByTestId('probe').textContent).toBe('/?from=2024-05-01&to=2024-05-01|{"focusSession":"sess-1"}');
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

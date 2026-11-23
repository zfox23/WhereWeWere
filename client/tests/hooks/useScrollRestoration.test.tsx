import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, MemoryRouter, Route, Routes, useNavigate, useSearchParams } from 'react-router-dom';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useScrollRestoration } from '../../src/hooks/useScrollRestoration';

function List() {
  useScrollRestoration();
  return <Link to="/detail">Open</Link>;
}

function Detail() {
  const navigate = useNavigate();
  useScrollRestoration();
  return <button type="button" onClick={() => navigate(-1)}>Back</button>;
}

/** Scroll the window and let the hook's next frame record it. */
async function scrollTo(y: number) {
  Object.defineProperty(window, 'scrollY', { value: y, configurable: true });
  await act(async () => {
    window.dispatchEvent(new Event('scroll'));
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  });
}

describe('useScrollRestoration', () => {
  let scrollSpy: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    scrollSpy = vi.fn();
    window.scrollTo = scrollSpy as unknown as typeof window.scrollTo;
  });
  afterEach(cleanup);

  it('puts the window back where it was on Back, and leaves a new page alone', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/list']}>
        <Routes>
          <Route path="/list" element={<List />} />
          <Route path="/detail" element={<Detail />} />
        </Routes>
      </MemoryRouter>,
    );
    await scrollTo(1234);
    await user.click(screen.getByRole('link', { name: 'Open' }));
    expect(scrollSpy).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(scrollSpy).toHaveBeenCalledWith(0, 1234);
  });

  it('waits until the page is ready', async () => {
    const user = userEvent.setup();
    function SlowList() {
      const [ready, setReady] = useState(false);
      useScrollRestoration(ready);
      return (
        <>
          <button type="button" onClick={() => setReady(true)}>Loaded</button>
          <Link to="/detail">Open</Link>
        </>
      );
    }
    render(
      <MemoryRouter initialEntries={['/list']}>
        <Routes>
          <Route path="/list" element={<SlowList />} />
          <Route path="/detail" element={<Detail />} />
        </Routes>
      </MemoryRouter>,
    );
    await scrollTo(500);
    await user.click(screen.getByRole('link', { name: 'Open' }));
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(scrollSpy).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Loaded' }));
    expect(scrollSpy).toHaveBeenCalledWith(0, 500);
  });

  describe('on a page that keeps its settings in the URL', () => {
    function Filtered() {
      const [params, setParams] = useSearchParams();
      useScrollRestoration();
      return (
        <>
          <p>bucket={params.get('bucket') ?? 'month'}</p>
          <button type="button" onClick={() => setParams({ id: params.get('id') ?? '', bucket: 'week' }, { replace: true })}>
            Weeks
          </button>
          <Link to="/filtered?id=2">Other</Link>
          <Link to="/detail">Open</Link>
        </>
      );
    }
    const renderFiltered = () =>
      render(
        <MemoryRouter initialEntries={['/filtered?id=1']}>
          <Routes>
            <Route path="/filtered" element={<Filtered />} />
            <Route path="/detail" element={<Detail />} />
          </Routes>
        </MemoryRouter>,
      );

    it('stays where it is when a setting replaces the entry', async () => {
      const user = userEvent.setup();
      renderFiltered();
      await scrollTo(800);
      await user.click(screen.getByRole('button', { name: 'Weeks' }));
      expect(screen.getByText('bucket=week')).toBeTruthy();
      expect(scrollSpy).not.toHaveBeenCalled();
    });

    it('returns to the same spot on Back after a setting changed, without scrolling again', async () => {
      const user = userEvent.setup();
      renderFiltered();
      await scrollTo(800);
      await user.click(screen.getByRole('button', { name: 'Weeks' }));
      await user.click(screen.getByRole('link', { name: 'Open' }));
      await user.click(screen.getByRole('button', { name: 'Back' }));
      expect(screen.getByText('bucket=week')).toBeTruthy();
      expect(scrollSpy).toHaveBeenCalledWith(0, 800);
    });

    it('starts another item shown by the same page at the top', async () => {
      const user = userEvent.setup();
      renderFiltered();
      await scrollTo(800);
      await user.click(screen.getByRole('link', { name: 'Other' }));
      expect(scrollSpy).toHaveBeenCalledWith(0, 0);
    });
  });
});

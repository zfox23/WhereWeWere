import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
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
});

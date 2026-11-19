import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Home from '../../src/pages/Home';

const timelineListMock = vi.fn();

vi.mock('../../src/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/api/client')>();
  return {
    ...actual,
    timeline: { ...actual.timeline, list: (...args: unknown[]) => timelineListMock(...args) },
    settings: { ...actual.settings, get: () => Promise.resolve({}), update: () => Promise.resolve({}) },
    musicListening: { around: () => Promise.resolve({}) },
  };
});
vi.mock('../../src/plugins/api', () => ({
  plugins: { settings: { get: () => Promise.resolve({}) } },
}));

function Probe() {
  const loc = useLocation();
  return <div data-testid="path">{loc.pathname}{loc.search}</div>;
}

function renderHome() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Probe />
      <Routes>
        <Route path="*" element={<Home />} />
      </Routes>
    </MemoryRouter>,
  );
}

const search = () => screen.getByPlaceholderText('Search check-ins...') as HTMLInputElement;
const lastTypes = () => (timelineListMock.mock.calls.at(-1)?.[0] as Record<string, string>).types;

describe('Home timeline hotkeys', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: true,
      media: query,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
    }));
    vi.stubGlobal('IntersectionObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    vi.stubGlobal('scrollTo', () => {});
    timelineListMock.mockResolvedValue([]);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    timelineListMock.mockReset();
  });

  it('focuses search on /', async () => {
    renderHome();
    fireEvent.keyDown(document.body, { key: '/' });
    expect(document.activeElement).toBe(search());
  });

  it('focuses search on Ctrl+K and ⌘+K, even from another field', async () => {
    renderHome();
    const other = document.createElement('input');
    document.body.appendChild(other);
    other.focus();
    fireEvent.keyDown(other, { key: 'k', ctrlKey: true });
    expect(document.activeElement).toBe(search());
    other.focus();
    fireEvent.keyDown(other, { key: 'k', metaKey: true });
    expect(document.activeElement).toBe(search());
    other.remove();
  });

  it('Esc clears the search, then leaves the box', async () => {
    renderHome();
    const input = search();
    input.focus();
    fireEvent.change(input, { target: { value: 'tacos' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input.value).toBe('');
    expect(document.activeElement).toBe(input);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(document.activeElement).not.toBe(input);
  });

  it('Shift+hotkey shows only that type and focuses search; again returns to All', async () => {
    renderHome();
    await waitFor(() => expect(timelineListMock).toHaveBeenCalled());
    fireEvent.keyDown(document.body, { key: 'L', shiftKey: true });
    expect(document.activeElement).toBe(search());
    await waitFor(() => expect(lastTypes()).toBe('location'));
    // The plain hotkey's check-in route is not opened.
    expect(screen.getByTestId('path').textContent).toBe('/');

    search().blur();
    fireEvent.keyDown(document.body, { key: 'P', shiftKey: true });
    await waitFor(() => expect(lastTypes()).toBe('music'));

    search().blur();
    fireEvent.keyDown(document.body, { key: 'P', shiftKey: true });
    await waitFor(() => expect(lastTypes()).toBeUndefined());
  });

  it('plain hotkey still opens the check-in', () => {
    renderHome();
    fireEvent.keyDown(document.body, { key: 'l' });
    expect(screen.getByTestId('path').textContent).toBe('/location-check-in');
  });
});

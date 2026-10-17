import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider, useTheme } from '../../src/contexts/ThemeContext';

vi.mock('../../src/api/client', () => ({
  settings: { get: () => Promise.resolve({}), update: () => Promise.resolve({}) },
}));

function Probe() {
  const { resolvedTheme } = useTheme();
  return <div data-testid="mode">{resolvedTheme}</div>;
}

beforeEach(() => {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  document.documentElement.removeAttribute('style');
  document.documentElement.classList.remove('dark');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ThemeProvider', () => {
  it('still renders when localStorage throws (blocked site data)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('mode').textContent).toBe('light');
  });

  it('persists a snapshot of the applied theme for the pre-paint script', async () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    await waitFor(() => expect(localStorage.getItem('theme-snapshot')).not.toBeNull());
    const snap = JSON.parse(localStorage.getItem('theme-snapshot')!);
    expect(snap).toMatchObject({ dark: false });
    expect(snap.theme).toBeTruthy();
    expect(snap.style).toContain('--color-primary-500');
  });
});

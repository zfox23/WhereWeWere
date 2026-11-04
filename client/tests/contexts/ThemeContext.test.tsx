import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_APPEARANCE } from 'wwp-shared';
import { APPEARANCE_SYNC_DELAY_MS, ThemeProvider, useTheme } from '../../src/contexts/ThemeContext';

const api = vi.hoisted(() => ({
  get: vi.fn(() => Promise.resolve({} as Record<string, unknown>)),
  update: vi.fn((_data: unknown) => Promise.resolve({})),
}));

vi.mock('../../src/api/client', () => ({
  settings: { get: () => api.get(), update: (data: unknown) => api.update(data) },
}));

let themeApi: ReturnType<typeof useTheme>;
function Capture() {
  themeApi = useTheme();
  return null;
}

function appearanceUpdates() {
  return api.update.mock.calls
    .map(([data]) => (data as { appearance?: unknown }).appearance)
    .filter(Boolean);
}

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
  localStorage.clear();
  api.get.mockReset().mockResolvedValue({});
  api.update.mockReset().mockResolvedValue({});
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
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

  it('records appearance attributes in the snapshot', async () => {
    render(
      <ThemeProvider>
        <Capture />
      </ThemeProvider>,
    );
    act(() => themeApi.setAppearance({ bgPattern: 'grid' }));
    await waitFor(() => {
      const snap = JSON.parse(localStorage.getItem('theme-snapshot')!);
      expect(snap.attrs).toMatchObject({ bgPattern: 'grid', bgGradient: 'soft', font: 'classic', surface: 'frosted' });
    });
    expect(document.documentElement.dataset.bgPattern).toBe('grid');
  });

  it('batches appearance changes into one debounced server update', async () => {
    vi.useFakeTimers();
    render(
      <ThemeProvider>
        <Capture />
      </ThemeProvider>,
    );
    act(() => themeApi.setAppearance({ bgPattern: 'grid' }));
    act(() => themeApi.setAppearance({ bgGradient: 'flat' }));
    expect(appearanceUpdates()).toEqual([]);
    await act(async () => {
      vi.advanceTimersByTime(APPEARANCE_SYNC_DELAY_MS);
    });
    expect(appearanceUpdates()).toEqual([{ bgPattern: 'grid', bgGradient: 'flat' }]);
    expect(themeApi.appearance).toMatchObject({ bgPattern: 'grid', bgGradient: 'flat' });
  });

  it('applies the account appearance over what this browser remembered', async () => {
    localStorage.setItem('appearance', JSON.stringify({ bgPattern: 'linen', bgGradient: 'radial' }));
    api.get.mockResolvedValue({ appearance: { bgPattern: 'crosshatch' } });
    render(
      <ThemeProvider>
        <Capture />
      </ThemeProvider>,
    );
    await waitFor(() => expect(themeApi.appearance.bgPattern).toBe('crosshatch'));
    // Keys the account doesn't have fall back to defaults, not local values.
    expect(themeApi.appearance.bgGradient).toBe('soft');
  });

  it('moves browser-only background choices up to the account once', async () => {
    localStorage.setItem('bg-pattern', 'topographic');
    localStorage.setItem('bg-gradient', 'radial');
    api.get.mockResolvedValue({ appearance: {} });
    render(
      <ThemeProvider>
        <Capture />
      </ThemeProvider>,
    );
    expect(themeApi.appearance).toMatchObject({ bgPattern: 'topographic', bgGradient: 'radial' });
    await waitFor(() =>
      expect(appearanceUpdates()).toEqual([{ bgPattern: 'topographic', bgGradient: 'radial' }]),
    );
  });

  it('removes the legacy keys once the account has them', async () => {
    localStorage.setItem('bg-pattern', 'grid');
    api.get.mockResolvedValue({ appearance: {} });
    render(
      <ThemeProvider>
        <Capture />
      </ThemeProvider>,
    );
    await waitFor(() => expect(localStorage.getItem('bg-pattern')).toBeNull());
  });

  it('keeps the legacy keys to retry when moving them to the account fails', async () => {
    localStorage.setItem('bg-pattern', 'grid');
    api.get.mockResolvedValue({ appearance: {} });
    api.update.mockRejectedValue(new Error('offline'));
    render(
      <ThemeProvider>
        <Capture />
      </ThemeProvider>,
    );
    await waitFor(() => expect(appearanceUpdates()).toEqual([{ bgPattern: 'grid' }]));
    expect(localStorage.getItem('bg-pattern')).toBe('grid');
  });

  it('does not re-upload a cached copy over an emptied account (e.g. after Start Over)', async () => {
    localStorage.setItem('appearance', JSON.stringify({ bgPattern: 'linen', bgGradient: 'radial' }));
    api.get.mockResolvedValue({ appearance: {} });
    render(
      <ThemeProvider>
        <Capture />
      </ThemeProvider>,
    );
    expect(themeApi.appearance.bgPattern).toBe('linen');
    await waitFor(() => expect(themeApi.appearance).toEqual(DEFAULT_APPEARANCE));
    expect(appearanceUpdates()).toEqual([]);
  });

  it('does not let a slow server load undo a change made meanwhile', async () => {
    let resolveGet!: (value: Record<string, unknown>) => void;
    api.get.mockReturnValue(new Promise((resolve) => { resolveGet = resolve; }));
    render(
      <ThemeProvider>
        <Capture />
      </ThemeProvider>,
    );
    act(() => themeApi.setAppearance({ bgPattern: 'none' }));
    await act(async () => resolveGet({ appearance: { bgPattern: 'grid' } }));
    expect(themeApi.appearance.bgPattern).toBe('none');
  });

  it('resets appearance to defaults', async () => {
    render(
      <ThemeProvider>
        <Capture />
      </ThemeProvider>,
    );
    act(() => themeApi.setAppearance({ bgPattern: 'grid', bgGradient: 'flat' }));
    act(() => themeApi.resetAppearance());
    expect(themeApi.appearance).toEqual(DEFAULT_APPEARANCE);
  });
});

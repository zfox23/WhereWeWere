import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const settingsGetMock = vi.fn();
vi.mock('../../src/api/client', () => ({
  companions: {
    photoUrl: (name: string) => `/api/v1/immich/person-photo?name=${encodeURIComponent(name)}`,
  },
  settings: { get: () => settingsGetMock() },
}));

// The hook memoizes the settings lookup module-wide; reset the module graph
// between tests so each test controls the "enabled" state.
async function loadComponent() {
  vi.resetModules();
  return import('../../src/components/CompanionName');
}

function setImmichEnabled(enabled: boolean) {
  settingsGetMock.mockResolvedValue(
    enabled ? { immich_url: 'https://immich.example', immich_api_key: 'key' } : {},
  );
}

beforeEach(() => {
  settingsGetMock.mockReset();
  setImmichEnabled(false);
});

afterEach(() => {
  cleanup();
});

describe('CompanionName / CompanionPhoto', () => {
  it('renders only the name when Immich is disabled', async () => {
    const { CompanionName } = await loadComponent();
    render(<CompanionName name="Ada" />);
    await waitFor(() => expect(screen.getByText('Ada')).toBeTruthy());
    expect(document.querySelector('img')).toBeNull();
  });

  it('renders the featured photo to the left of the name when Immich is enabled', async () => {
    setImmichEnabled(true);
    const { CompanionName } = await loadComponent();
    render(<CompanionName name="Ada Lovelace" />);

    const photo = await waitFor(() => {
      const el = document.querySelector('img');
      if (!el) throw new Error('photo not rendered yet');
      return el as HTMLImageElement;
    });
    expect(photo.getAttribute('src')).toBe(
      '/api/v1/immich/person-photo?name=Ada%20Lovelace',
    );
    expect(photo.previousElementSibling).toBeNull(); // photo is first (left of name)
    expect(screen.getByText('Ada Lovelace')).toBeTruthy();
  });

  it('hides the photo when the lookup fails (e.g. unknown person)', async () => {
    setImmichEnabled(true);
    const { CompanionName } = await loadComponent();
    render(<CompanionName name="Nobody" />);
    const photo = await waitFor(() => {
      const el = document.querySelector('img');
      if (!el) throw new Error('photo not rendered yet');
      return el as HTMLImageElement;
    });
    fireEvent.error(photo);
    await waitFor(() => expect(document.querySelector('img')).toBeNull());
    expect(screen.getByText('Nobody')).toBeTruthy();
  });
});

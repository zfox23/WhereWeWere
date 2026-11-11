import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { AuthProvider } from '../../src/contexts/AuthContext';
import { AuthGate } from '../../src/components/AuthGate';
import Settings from '../../src/pages/Settings';
import { matchSection } from '../../src/pages/settings/settingsSearch';

function mockApi(isAdmin: boolean) {
  const me = {
    id: 'me-id',
    username: 'zach',
    display_name: null,
    is_admin: isAdmin,
    must_change_password: false,
    created_at: '2026-01-01T00:00:00Z',
  };
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input).replace(/^\/api\/v1/, '').split('?')[0];
    const method = (init?.method ?? 'GET').toUpperCase();
    if (url === '/auth/me') return new Response(JSON.stringify(me), { status: 200 });
    return new Response(JSON.stringify(method === 'GET' && url.endsWith('s') ? [] : {}), { status: 200 });
  }));
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}${location.hash}`}</div>;
}

function renderSettings(path = '/settings', { isAdmin = false, entries }: { isAdmin?: boolean; entries?: string[] } = {}) {
  mockApi(isAdmin);
  return render(
    <MemoryRouter initialEntries={entries ?? [path]}>
      <AuthProvider>
        <AuthGate>
          <Settings />
          <LocationProbe />
        </AuthGate>
      </AuthProvider>
    </MemoryRouter>,
  );
}

const nav = async () => screen.findByRole('navigation', { name: 'Settings sections' });
const sectionNames = async () =>
  within(await nav()).getAllByRole('listitem').map((li) => li.textContent?.trim());
const backButton = () => screen.queryByRole('button', { name: 'Settings' });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Settings sidebar', () => {
  it('shows Account by default with no back control', async () => {
    renderSettings();
    expect(await screen.findByRole('heading', { name: 'Profile' })).toBeInTheDocument();
    expect(backButton()).not.toBeInTheDocument();
    const n = await nav();
    expect(within(n).getByRole('heading', { name: 'General' })).toBeInTheDocument();
    expect(within(n).getByRole('heading', { name: 'Check-in types' })).toBeInTheDocument();
    expect(within(n).queryByRole('heading', { name: 'Admin' })).not.toBeInTheDocument();
  });

  it('opens a section and returns to the list with the back control', async () => {
    const user = userEvent.setup();
    renderSettings();
    await user.click(within(await nav()).getByRole('button', { name: 'Display' }));
    expect(await screen.findByRole('heading', { name: /Distance Units/ })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/settings?tab=display');

    await user.click(backButton()!);
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/settings$/);
    expect(backButton()).not.toBeInTheDocument();
  });

  it('back from a deep link clears the section instead of leaving the page', async () => {
    const user = userEvent.setup();
    renderSettings('/settings?tab=plugin:food', { entries: ['/elsewhere', '/settings?tab=plugin:food'] });
    expect(await within(await nav()).findByRole('button', { name: 'Food', current: 'page' })).toBeInTheDocument();
    await user.click(backButton()!);
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/settings$/);
  });

  it('keeps the #mood-activities deep link', async () => {
    renderSettings('/settings#mood-activities');
    expect(await within(await nav()).findByRole('button', { name: 'Mood', current: 'page' })).toBeInTheDocument();
    expect(backButton()).toBeInTheDocument();
  });
});

describe('Settings search', () => {
  it('finds sections by keyword and shows what matched', async () => {
    const user = userEvent.setup();
    renderSettings();
    await user.type(await screen.findByRole('searchbox', { name: 'Search settings' }), 'wallpaper');
    expect(await sectionNames()).toEqual(['DisplayWallpaper']);
  });

  it('finds plugin sections by their settings', async () => {
    const user = userEvent.setup();
    renderSettings();
    await user.type(await screen.findByRole('searchbox', { name: 'Search settings' }), 'mealie');
    const names = within(await nav()).getAllByRole('button', { name: /Food/ });
    expect(names).toHaveLength(1);
    expect(within(await nav()).queryByRole('button', { name: /Account/ })).not.toBeInTheDocument();
  });

  it('never surfaces Users for non-admins', async () => {
    const user = userEvent.setup();
    renderSettings();
    await user.type(await screen.findByRole('searchbox', { name: 'Search settings' }), 'add a user');
    expect(within(await nav()).queryByRole('button', { name: /Users/ })).not.toBeInTheDocument();
    expect(screen.getByText(/No settings match/)).toBeInTheDocument();
  });

  it('surfaces Users for admins', async () => {
    const user = userEvent.setup();
    renderSettings('/settings', { isAdmin: true });
    await user.type(await screen.findByRole('searchbox', { name: 'Search settings' }), 'add a user');
    expect(within(await nav()).getByRole('button', { name: /Users/ })).toBeInTheDocument();
  });

  it('opens the first match on Enter', async () => {
    const user = userEvent.setup();
    renderSettings();
    await user.type(await screen.findByRole('searchbox', { name: 'Search settings' }), 'immich{Enter}');
    expect(screen.getByTestId('location')).toHaveTextContent('/settings?tab=integrations');
  });
});

describe('matchSection', () => {
  const section = { label: 'Display', keywords: ['Wallpaper', 'Dark mode'] };

  it('matches everything on an empty query', () => {
    expect(matchSection(section, '  ')).toEqual({ matches: true });
  });

  it('matches the label without a hint', () => {
    expect(matchSection(section, 'disp')).toEqual({ matches: true });
  });

  it('requires every term and hints the matching keyword', () => {
    expect(matchSection(section, 'dark mode')).toEqual({ matches: true, hint: 'Dark mode' });
    expect(matchSection(section, 'dark wallpaper')).toEqual({ matches: true, hint: 'Wallpaper' });
    expect(matchSection(section, 'dark font')).toEqual({ matches: false });
  });
});

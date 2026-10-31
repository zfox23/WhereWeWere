import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../../src/contexts/AuthContext';
import { AuthGate } from '../../src/components/AuthGate';
import Settings from '../../src/pages/Settings';
import { DeleteUserPanel, UsersTab } from '../../src/pages/settings/UsersTab';
import type { ManagedUser } from '../../src/api/client';

/** fetch stub: GET /auth/me returns `me`, everything else answers from `extra` or {}. */
function mockApi(me: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input).replace(/^\/api\/v1/, '').split('?')[0];
    const method = (init?.method ?? 'GET').toUpperCase();
    if (url === '/auth/me') return new Response(JSON.stringify(me), { status: 200 });
    const key = `${method} ${url}`;
    if (key in extra) {
      const body = extra[key];
      return body === null ? new Response(null, { status: 204 }) : new Response(JSON.stringify(body), { status: 200 });
    }
    return new Response(JSON.stringify(method === 'GET' && url.endsWith('s') ? [] : {}), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const me = (isAdmin: boolean) => ({
  id: 'me-id',
  username: 'zach',
  display_name: null,
  is_admin: isAdmin,
  must_change_password: false,
  created_at: '2026-01-01T00:00:00Z',
});

const managed = (overrides: Partial<ManagedUser> = {}): ManagedUser => ({
  id: 'u2',
  username: 'Sam',
  display_name: 'Sam S.',
  is_admin: false,
  disabled_at: null,
  must_change_password: true,
  created_at: '2026-01-01T00:00:00Z',
  last_seen_at: null,
  ...overrides,
});

function renderSettings(path = '/settings') {
  window.history.replaceState(null, '', path);
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <AuthGate>
          <Settings />
        </AuthGate>
      </AuthProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

describe('Settings → Users tab', () => {
  it('is hidden for non-admins, even when deep-linked', async () => {
    mockApi(me(false));
    renderSettings('/settings?tab=users');
    await screen.findByRole('button', { name: 'Account' });
    expect(screen.queryByRole('button', { name: 'Users' })).not.toBeInTheDocument();
    // Falls back to the Account tab instead of rendering user management.
    expect(await screen.findByRole('heading', { name: 'Profile' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Add a user' })).not.toBeInTheDocument();
  });

  it('is shown for admins', async () => {
    mockApi(me(true), { 'GET /admin/users': [] });
    renderSettings('/settings?tab=users');
    expect(await screen.findByRole('button', { name: 'Users' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Add a user' })).toBeInTheDocument();
  });

  it("gives the admin's own row no actions", async () => {
    mockApi(me(true), {
      'GET /admin/users': [managed({ id: 'me-id', username: 'zach', is_admin: true, must_change_password: false }), managed()],
    });
    render(
      <MemoryRouter>
        <AuthProvider>
          <UsersTab />
        </AuthProvider>
      </MemoryRouter>,
    );
    const own = await screen.findByTestId('user-row-zach');
    expect(within(own).queryByRole('button')).not.toBeInTheDocument();
    const other = screen.getByTestId('user-row-Sam');
    expect(within(other).getByRole('button', { name: /Delete/ })).toBeInTheDocument();
    expect(within(other).getByText('Must change password')).toBeInTheDocument();
  });
});

describe('DeleteUserPanel', () => {
  it('requires typing the exact username before deleting', async () => {
    const fetchMock = mockApi(me(true), { 'DELETE /admin/users/u2': null });
    const onDeleted = vi.fn();
    render(<DeleteUserPanel user={managed()} onDeleted={onDeleted} onCancel={() => {}} />);

    expect(screen.getByText(/all of their data/)).toBeInTheDocument();
    expect(screen.getByText(/Disable/)).toBeInTheDocument();

    const button = screen.getByRole('button', { name: /Delete permanently/ });
    const input = screen.getByLabelText(/to confirm/);
    expect(button).toBeDisabled();

    const user = userEvent.setup();
    await user.type(input, 'sam'); // wrong case: the server compares exactly
    expect(button).toBeDisabled();
    await user.click(button);
    expect(fetchMock).not.toHaveBeenCalled();

    await user.clear(input);
    await user.type(input, 'Sam');
    expect(button).toBeEnabled();
    await user.click(button);

    expect(onDeleted).toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('/api/v1/admin/users/u2');
    expect(init?.method).toBe('DELETE');
    expect(JSON.parse(String(init?.body))).toEqual({ confirm_username: 'Sam' });
  });
});

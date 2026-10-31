import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider, pageNavigation, useAuth } from '../../src/contexts/AuthContext';
import { AuthGate } from '../../src/components/AuthGate';
import { request } from '../../src/api/client';

type Route = { method?: string; path: string; status?: number; body?: unknown; headers?: Record<string, string> };

/** fetch stub answering by method + path; records every call. */
function mockApi(routes: Route[]) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    const route = routes.find((r) => (r.method ?? 'GET') === method && url === `/api/v1${r.path}`);
    if (!route) return new Response(JSON.stringify({ error: `unmocked ${method} ${url}` }), { status: 500 });
    const status = route.status ?? 200;
    return new Response(status === 204 ? null : JSON.stringify(route.body ?? {}), {
      status,
      headers: { 'Content-Type': 'application/json', ...route.headers },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const account = (overrides: Record<string, unknown> = {}) => ({
  id: 'u1',
  username: 'zach',
  display_name: 'Zach',
  is_admin: false,
  must_change_password: false,
  created_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

function SignOutButton() {
  const { signOut } = useAuth();
  return <button onClick={() => void signOut()}>do sign out</button>;
}

function renderApp() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <AuthGate>
          <div>the app</div>
          <SignOutButton />
        </AuthGate>
      </AuthProvider>
    </MemoryRouter>,
  );
}

const unauthenticated = { status: 401, body: { error: 'Not signed in', code: 'unauthenticated' } };

describe('auth gate', () => {
  let reload: ReturnType<typeof vi.fn>;
  let assign: ReturnType<typeof vi.fn>;
  const cachesDelete = vi.fn(async () => true);

  beforeEach(() => {
    reload = vi.fn();
    assign = vi.fn();
    vi.spyOn(pageNavigation, 'reload').mockImplementation(reload);
    vi.spyOn(pageNavigation, 'assign').mockImplementation(assign);
    cachesDelete.mockClear();
    vi.stubGlobal('caches', { delete: cachesDelete });
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('shows the login screen when not signed in, and sends the remember flag', async () => {
    const fetchMock = mockApi([
      { path: '/auth/me', ...unauthenticated },
      { method: 'POST', path: '/auth/login', body: account() },
    ]);
    renderApp();

    await screen.findByRole('heading', { name: 'Sign in' });
    expect(screen.queryByText('the app')).not.toBeInTheDocument();
    expect(screen.getByText('Forgot your password? Ask your administrator.')).toBeInTheDocument();

    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Username'), 'Zach');
    await user.type(screen.getByLabelText('Password'), 'hunter22!');
    await user.click(screen.getByLabelText(/Remember me/));
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await screen.findByText('the app');
    const loginCall = fetchMock.mock.calls.find(([url]) => String(url) === '/api/v1/auth/login')!;
    expect(JSON.parse(String(loginCall[1]!.body))).toEqual({ username: 'Zach', password: 'hunter22!', remember: true });
  });

  it('sends remember: false when the box is left unchecked', async () => {
    const fetchMock = mockApi([
      { path: '/auth/me', ...unauthenticated },
      { method: 'POST', path: '/auth/login', body: account() },
    ]);
    renderApp();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Username'), 'zach');
    await user.type(screen.getByLabelText('Password'), 'hunter22!');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByText('the app');
    const loginCall = fetchMock.mock.calls.find(([url]) => String(url) === '/api/v1/auth/login')!;
    expect(JSON.parse(String(loginCall[1]!.body)).remember).toBe(false);
  });

  it.each([
    [401, { error: 'Invalid username or password' }, {}, 'Wrong username or password.'],
    [429, { error: 'Too many failed attempts. Try again later.' }, { 'Retry-After': '120' }, 'Too many failed attempts. Try again in 2 minutes.'],
    [403, { error: 'This account is disabled' }, {}, 'This account is disabled. Ask your administrator.'],
  ])('shows a friendly error for a %s login response', async (status, body, headers, message) => {
    mockApi([
      { path: '/auth/me', ...unauthenticated },
      { method: 'POST', path: '/auth/login', status, body, headers },
    ]);
    renderApp();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Username'), 'zach');
    await user.type(screen.getByLabelText('Password'), 'wrongpass');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.queryByText('the app')).not.toBeInTheDocument();
    // A failed login is not a "session expired" drop: nothing reloads.
    expect(reload).not.toHaveBeenCalled();
  });

  it('blocks the app behind "Choose a new password" until the password is changed', async () => {
    const fetchMock = mockApi([
      { path: '/auth/me', body: account({ must_change_password: true }) },
      { method: 'PUT', path: '/auth/password', body: account({ must_change_password: false }) },
    ]);
    renderApp();

    await screen.findByRole('heading', { name: 'Choose a new password' });
    expect(screen.queryByText('the app')).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Temporary password'), 'temp-pass-1');
    await user.type(screen.getByLabelText('New password'), 'short');
    await user.type(screen.getByLabelText('Confirm new password'), 'short');
    await user.click(screen.getByRole('button', { name: 'Save and continue' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('at least 8 characters');

    await user.clear(screen.getByLabelText('New password'));
    await user.clear(screen.getByLabelText('Confirm new password'));
    await user.type(screen.getByLabelText('New password'), 'a-better-pass');
    await user.type(screen.getByLabelText('Confirm new password'), 'a-different-pass');
    await user.click(screen.getByRole('button', { name: 'Save and continue' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('don’t match');
    expect(fetchMock.mock.calls.some(([url]) => String(url) === '/api/v1/auth/password')).toBe(false);

    await user.clear(screen.getByLabelText('Confirm new password'));
    await user.type(screen.getByLabelText('Confirm new password'), 'a-better-pass');
    await user.click(screen.getByRole('button', { name: 'Save and continue' }));

    await screen.findByText('the app');
    const call = fetchMock.mock.calls.find(([url]) => String(url) === '/api/v1/auth/password')!;
    expect(JSON.parse(String(call[1]!.body))).toEqual({ current_password: 'temp-pass-1', new_password: 'a-better-pass' });
  });

  it('switches to "Choose a new password" when any request reports password_change_required', async () => {
    mockApi([
      { path: '/auth/me', body: account() },
      { path: '/timeline', status: 403, body: { error: 'You must change your password first', code: 'password_change_required' } },
    ]);
    renderApp();
    await screen.findByText('the app');

    await act(async () => {
      await request('/timeline').catch(() => {});
    });
    await screen.findByRole('heading', { name: 'Choose a new password' });
  });

  it('drops to the login screen and wipes local data when a request comes back 401', async () => {
    mockApi([
      { path: '/auth/me', body: account() },
      { path: '/timeline', ...unauthenticated },
    ]);
    renderApp();
    await screen.findByText('the app');
    localStorage.setItem('wwp:notes:draft:new', '{"title":"secret","body":"diary"}');

    await act(async () => {
      await request('/timeline').catch(() => {});
    });

    await screen.findByRole('heading', { name: 'Sign in' });
    expect(screen.queryByText('the app')).not.toBeInTheDocument();
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(cachesDelete).toHaveBeenCalledWith('api-cache');
    expect(localStorage.getItem('wwp:notes:draft:new')).toBeNull();
  });

  it('sign out ends the session, wipes cached data and drafts, and keeps device preferences', async () => {
    const fetchMock = mockApi([
      { path: '/auth/me', body: account() },
      { method: 'POST', path: '/auth/logout', status: 204 },
    ]);
    renderApp();
    await screen.findByText('the app');

    localStorage.setItem('theme', 'dark');
    localStorage.setItem('bg-pattern', 'dots');
    localStorage.setItem('wwp:notes:draft:new', '{"title":"secret","body":"diary"}');
    localStorage.setItem('wwp:notes:draft:abc', '{"title":"x","body":"y"}');
    sessionStorage.setItem('something', 'private');

    await userEvent.setup().click(screen.getByRole('button', { name: 'do sign out' }));

    await waitFor(() => expect(assign).toHaveBeenCalledWith('/'));
    expect(fetchMock.mock.calls.some(([url, init]) => String(url) === '/api/v1/auth/logout' && init?.method === 'POST')).toBe(true);
    expect(cachesDelete).toHaveBeenCalledWith('api-cache');
    expect(localStorage.getItem('wwp:notes:draft:new')).toBeNull();
    expect(localStorage.getItem('wwp:notes:draft:abc')).toBeNull();
    expect(sessionStorage.length).toBe(0);
    expect(localStorage.getItem('theme')).toBe('dark');
    expect(localStorage.getItem('bg-pattern')).toBe('dots');
  });

  it('reloads when another tab signs out or in, but not for its own sign-in', async () => {
    mockApi([
      { path: '/auth/me', ...unauthenticated },
      { method: 'POST', path: '/auth/login', body: account() },
    ]);
    renderApp();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Username'), 'zach');
    await user.type(screen.getByLabelText('Password'), 'hunter22!');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByText('the app');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(reload).not.toHaveBeenCalled();

    const otherTab = new BroadcastChannel('wwp-auth');
    otherTab.postMessage('account-changed');
    otherTab.close();
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });

  it('still wipes local data when the logout request fails', async () => {
    mockApi([{ path: '/auth/me', body: account() }]);
    renderApp();
    await screen.findByText('the app');
    localStorage.setItem('wwp:notes:draft:new', '{"title":"secret","body":"diary"}');

    await userEvent.setup().click(screen.getByRole('button', { name: 'do sign out' }));

    await waitFor(() => expect(assign).toHaveBeenCalledWith('/'));
    expect(cachesDelete).toHaveBeenCalledWith('api-cache');
    expect(localStorage.getItem('wwp:notes:draft:new')).toBeNull();
  });
});

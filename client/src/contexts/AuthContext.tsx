import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ApiError, auth, type Account } from '../api/client';
import { onAuthFailure } from '../utils/authEvents';
import { wipeLocalUserData } from '../utils/localData';

/**
 * Page navigation used after signing out. A full page load (not a router
 * navigation) is deliberate: module-level caches (the Home feed snapshot,
 * memoized settings readers) would otherwise carry one user's data into the
 * next user's session. Swappable for tests (jsdom can't navigate).
 */
export const pageNavigation = {
  /** Reload the current URL (keeps the deep link for after sign-in). */
  reload: () => window.location.reload(),
  /** Load the app at `url`. */
  assign: (url: string) => window.location.assign(url),
};

/**
 * Tells this app's other open tabs that the signed-in account changed (sign
 * out, sign in) so they reload instead of showing — or writing to — the
 * previous user's data with the new session cookie.
 */
const AUTH_CHANNEL = 'wwp-auth';

function openAuthChannel(): BroadcastChannel | null {
  try {
    return typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(AUTH_CHANNEL);
  } catch {
    return null;
  }
}

export type AuthStatus = 'loading' | 'signed-out' | 'signed-in' | 'error';

interface AuthContextValue {
  status: AuthStatus;
  /** The signed-in account (null unless status is 'signed-in'). */
  user: Account | null;
  /** Why /me failed when status is 'error' (server unreachable etc.). */
  loadError: string | null;
  retry: () => void;
  signIn: (username: string, password: string, remember: boolean) => Promise<Account>;
  /** Replace the cached account (after a profile or password change). */
  setUser: (account: Account) => void;
  /** End this device's session, wipe local data, and go to the login screen. */
  signOut: () => Promise<void>;
  /** End every session of this account (this device included), then as signOut. */
  signOutEverywhere: () => Promise<void>;
}

const noop = async () => {};

// Without a provider (isolated component tests) behave as signed out with
// no-op actions instead of throwing.
const AuthContext = createContext<AuthContextValue>({
  status: 'signed-out',
  user: null,
  loadError: null,
  retry: () => {},
  signIn: () => Promise.reject(new Error('No AuthProvider')),
  setUser: () => {},
  signOut: noop,
  signOutEverywhere: noop,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUserState] = useState<Account | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadKey, setLoadKey] = useState(0);
  // Read by the auth-failure listener without re-subscribing on every change.
  const statusRef = useRef(status);
  statusRef.current = status;
  // One channel for posting and listening: a channel never receives its own
  // messages, so this tab doesn't reload itself.
  const channelRef = useRef<BroadcastChannel | null>(null);
  const broadcastAccountChange = () => {
    try {
      channelRef.current?.postMessage('account-changed');
    } catch {
      // channel closed: nothing to tell
    }
  };

  useEffect(() => {
    let cancelled = false;
    auth
      .me()
      .then((account) => {
        if (cancelled) return;
        setUserState(account);
        setStatus('signed-in');
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          // Not signed in (cookie expired or never set). Whatever an earlier
          // session left on this device is no longer anyone's to read.
          void wipeLocalUserData();
          setStatus('signed-out');
          return;
        }
        setLoadError(err instanceof Error ? err.message : 'Could not reach the server');
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [loadKey]);

  const leave = useCallback(async (destination: 'reload' | 'home') => {
    // Several in-flight requests can fail at once; leave only once.
    statusRef.current = 'signed-out';
    setStatus('signed-out');
    setUserState(null);
    await wipeLocalUserData();
    broadcastAccountChange();
    if (destination === 'reload') pageNavigation.reload();
    else pageNavigation.assign('/');
  }, []);

  useEffect(
    () =>
      onAuthFailure((kind) => {
        if (statusRef.current !== 'signed-in') return;
        if (kind === 'unauthenticated') {
          // Session expired or was revoked elsewhere: reload in place so the
          // user returns to this page after signing in again.
          void leave('reload');
        } else {
          setUserState((prev) => (prev ? { ...prev, must_change_password: true } : prev));
        }
      }),
    [leave],
  );

  // Another tab signed out or in: drop this tab's in-memory data. Storage is
  // shared, so it is already wiped; after the reload /me decides what to show.
  useEffect(() => {
    const channel = openAuthChannel();
    if (!channel) return;
    channelRef.current = channel;
    channel.onmessage = () => {
      if (statusRef.current !== 'loading') pageNavigation.reload();
    };
    return () => {
      channelRef.current = null;
      channel.close();
    };
  }, []);

  const signIn = useCallback(async (username: string, password: string, remember: boolean) => {
    const account = await auth.login(username, password, remember);
    broadcastAccountChange();
    setUserState(account);
    setStatus('signed-in');
    return account;
  }, []);

  const signOut = useCallback(async () => {
    try {
      await auth.logout();
    } catch {
      // Already signed out server-side or unreachable: still wipe locally.
    }
    await leave('home');
  }, [leave]);

  const signOutEverywhere = useCallback(async () => {
    await auth.signOutEverywhere();
    await leave('home');
  }, [leave]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      loadError,
      retry: () => {
        setStatus('loading');
        setLoadError(null);
        setLoadKey((k) => k + 1);
      },
      signIn,
      setUser: (account) => setUserState(account),
      signOut,
      signOutEverywhere,
    }),
    [status, user, loadError, signIn, signOut, signOutEverywhere],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}

/** Name to show for an account: display name, else username. */
export function accountLabel(account: Pick<Account, 'username' | 'display_name'> | null | undefined): string {
  return account?.display_name?.trim() || account?.username || '';
}

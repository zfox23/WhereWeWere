import type { ReactNode } from 'react';
import { Loader2, LogOut, RefreshCw } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import Login, { AuthScreen, FormError } from '../pages/Login';
import { PasswordChangeForm } from './PasswordChangeForm';
import { usePageTitle } from '../utils/pageTitle';

/** Blocks the app until the user replaces a temporary password. */
function ChoosePassword() {
  usePageTitle('Choose a new password');
  const { user, setUser, signOut } = useAuth();
  return (
    <AuthScreen
      title="Choose a new password"
      subtitle={`Signed in as ${user?.username ?? ''}. Your password was set by an administrator; pick your own to continue.`}
    >
      <PasswordChangeForm currentLabel="Temporary password" submitLabel="Save and continue" onChanged={setUser} />
      <button
        type="button"
        onClick={() => void signOut()}
        className="w-full flex items-center justify-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
      >
        <LogOut size={14} />
        Sign out
      </button>
    </AuthScreen>
  );
}

/**
 * Renders the app only for a signed-in user with a usable password. The
 * login screen replaces the app in place (at whatever URL was opened), so a
 * deep link opens once the user signs in.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { status, user, loadError, retry } = useAuth();

  if (status === 'loading') {
    return (
      <div className="app-shell min-h-screen flex items-center justify-center" aria-busy="true">
        <Loader2 className="animate-spin text-primary-600" size={32} aria-label="Loading" />
      </div>
    );
  }
  if (status === 'error') {
    return (
      <AuthScreen title="Can’t reach WhereWeWere">
        <FormError message={loadError} />
        <button type="button" onClick={retry} className="btn-primary w-full">
          <RefreshCw size={16} className="mr-2" />
          Try again
        </button>
      </AuthScreen>
    );
  }
  if (status === 'signed-out' || !user) return <Login />;
  if (user.must_change_password) return <ChoosePassword />;
  return <>{children}</>;
}

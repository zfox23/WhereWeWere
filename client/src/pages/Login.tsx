import { useState, type FormEvent, type ReactNode } from 'react';
import { AlertCircle, Loader2, LogIn } from 'lucide-react';
import { ApiError } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { usePageTitle } from '../utils/pageTitle';

/** Full-screen centered card used by the sign-in and choose-password screens. */
export function AuthScreen({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="app-shell min-h-screen flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm bg-white/70 dark:bg-gray-900/70 backdrop-blur-sm rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3 p-6 space-y-5">
        <div className="text-center space-y-1">
          <div className="font-display text-3xl tracking-wide text-[#ea580c]">WhereWeWere</div>
          <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{title}</h1>
          {subtitle && <p className="text-sm text-gray-500 dark:text-gray-400">{subtitle}</p>}
        </div>
        {children}
      </div>
    </div>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div role="alert" className="flex items-start gap-2 text-sm text-red-600 dark:text-red-400">
      <AlertCircle size={16} className="mt-0.5 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

function retryText(seconds: number | undefined): string {
  if (!seconds) return 'a few minutes';
  if (seconds < 90) return `${seconds} seconds`;
  return `${Math.ceil(seconds / 60)} minutes`;
}

/** Friendly message for a failed sign-in. */
export function loginErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return 'Wrong username or password.';
    if (err.status === 429) return `Too many failed attempts. Try again in ${retryText(err.retryAfter)}.`;
    if (err.status === 403) return 'This account is disabled. Ask your administrator.';
    if (err.status === 400) return 'Enter your username and password.';
    return err.message;
  }
  return 'Could not reach the server. Check your connection and try again.';
}

export default function Login() {
  usePageTitle('Sign in');
  const { signIn } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError('Enter your username and password.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      // On success the auth gate swaps this screen for the app (at the URL
      // the user originally opened).
      await signIn(username.trim(), password, remember);
    } catch (err) {
      setError(loginErrorMessage(err));
      setPassword('');
      setSubmitting(false);
    }
  };

  return (
    <AuthScreen title="Sign in">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div>
          <label htmlFor="login-username" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Username
          </label>
          <input
            id="login-username"
            type="text"
            className="input"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="login-password" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Password
          </label>
          <input
            id="login-password"
            type="password"
            className="input"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <input
            type="checkbox"
            className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          Remember me
          <span className="text-xs text-gray-400 dark:text-gray-500">(30 days on this device)</span>
        </label>
        <FormError message={error} />
        <button type="submit" disabled={submitting} className="btn-primary w-full">
          {submitting ? <Loader2 size={16} className="animate-spin mr-2" /> : <LogIn size={16} className="mr-2" />}
          Sign in
        </button>
        <p className="text-center text-xs text-gray-500 dark:text-gray-400">
          Forgot your password? Ask your administrator.
        </p>
      </form>
    </AuthScreen>
  );
}

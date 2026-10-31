import { useCallback, useEffect, useState } from 'react';
import { User, Check, AlertCircle, Loader2, KeyRound, MonitorSmartphone, LogOut, Webhook, RefreshCw } from 'lucide-react';
import { auth, type AccountSession } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { PasswordChangeForm } from '../../components/PasswordChangeForm';
import { describeUserAgent, formatRelative } from '../../utils/accountFormat';

const SECTION_CLASS =
  'bg-white/60 dark:bg-gray-900/60 rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3 p-6 space-y-4 scroll-mt-24';
const HEADING_CLASS = 'text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2';
const HINT_CLASS = 'text-sm text-gray-500 dark:text-gray-400';

type Message = { type: 'success' | 'error'; text: string } | null;

function StatusMessage({ message }: { message: Message }) {
  if (!message) return null;
  return (
    <div
      role={message.type === 'error' ? 'alert' : 'status'}
      className={`flex items-center gap-2 text-sm ${message.type === 'success' ? 'text-green-600' : 'text-red-600'}`}
    >
      {message.type === 'success' ? <Check size={16} /> : <AlertCircle size={16} />}
      {message.text}
    </div>
  );
}

const errorText = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

function ProfileSection() {
  const { user, setUser } = useAuth();
  const [username, setUsername] = useState(user?.username ?? '');
  const [displayName, setDisplayName] = useState(user?.display_name ?? '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<Message>(null);

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const account = await auth.updateProfile({ username: username.trim(), display_name: displayName });
      setUser(account);
      setUsername(account.username);
      setDisplayName(account.display_name ?? '');
      setMessage({ type: 'success', text: 'Profile updated.' });
    } catch (err) {
      setMessage({ type: 'error', text: errorText(err, 'Failed to save.') });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={SECTION_CLASS}>
      <h2 className={HEADING_CLASS}>
        <User size={20} className="text-gray-600 dark:text-gray-400" />
        Profile
      </h2>
      <div>
        <label htmlFor="account-username" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Username</label>
        <input
          id="account-username"
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="input"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          Used to sign in. 3–30 characters: letters, numbers, _ . - (not case-sensitive).
        </p>
      </div>
      <div>
        <label htmlFor="account-display-name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Display Name</label>
        <input
          id="account-display-name"
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          className="input"
          placeholder="Optional"
        />
      </div>
      <StatusMessage message={message} />
      <button onClick={save} disabled={saving} className="btn-primary">
        {saving ? <Loader2 size={16} className="animate-spin mr-2" /> : null}
        Save Profile
      </button>
    </div>
  );
}

function PasswordSection({ onChanged }: { onChanged: () => void }) {
  const { setUser } = useAuth();
  const [message, setMessage] = useState<Message>(null);
  // Remount the form after success so it starts empty.
  const [formKey, setFormKey] = useState(0);

  return (
    <div className={SECTION_CLASS}>
      <h2 className={HEADING_CLASS}>
        <KeyRound size={20} className="text-gray-600 dark:text-gray-400" />
        Password
      </h2>
      <p className={HINT_CLASS}>Changing your password signs out all your other devices.</p>
      <PasswordChangeForm
        key={formKey}
        onChanged={(account) => {
          setUser(account);
          setFormKey((k) => k + 1);
          setMessage({ type: 'success', text: 'Password changed. Your other devices were signed out.' });
          onChanged();
        }}
      />
      <StatusMessage message={message} />
    </div>
  );
}

function SessionsSection({ refreshKey }: { refreshKey: number }) {
  const { signOut, signOutEverywhere } = useAuth();
  const [sessions, setSessions] = useState<AccountSession[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<Message>(null);

  const load = useCallback(async () => {
    try {
      setSessions(await auth.sessions());
    } catch (err) {
      setMessage({ type: 'error', text: errorText(err, 'Could not load your devices.') });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const revoke = async (session: AccountSession) => {
    setBusyId(session.id);
    setMessage(null);
    try {
      await auth.revokeSession(session.id);
      setSessions((prev) => prev?.filter((s) => s.id !== session.id) ?? prev);
    } catch (err) {
      setMessage({ type: 'error', text: errorText(err, 'Could not sign out that device.') });
    } finally {
      setBusyId(null);
    }
  };

  const everywhere = async () => {
    if (!window.confirm('Sign out on every device, including this one? You will need to sign in again everywhere.')) return;
    setBusyId('everywhere');
    try {
      await signOutEverywhere();
    } catch (err) {
      setMessage({ type: 'error', text: errorText(err, 'Could not sign out everywhere.') });
      setBusyId(null);
    }
  };

  return (
    <div className={SECTION_CLASS}>
      <h2 className={HEADING_CLASS}>
        <MonitorSmartphone size={20} className="text-gray-600 dark:text-gray-400" />
        Signed-in devices
      </h2>
      {sessions === null && !message && <Loader2 size={20} className="animate-spin text-primary-600" />}
      {sessions && (
        <ul className="divide-y divide-gray-100 dark:divide-gray-800">
          {sessions.map((session) => (
            <li key={session.id} className="py-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-medium text-gray-900 dark:text-gray-100 flex flex-wrap items-center gap-2">
                  {describeUserAgent(session.user_agent)}
                  {session.current && (
                    <span className="rounded-full bg-primary-500/10 text-primary-700 dark:text-primary-400 px-2 py-0.5 text-xs">
                      This device
                    </span>
                  )}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  Last active {formatRelative(session.last_seen_at)}
                  {' · '}
                  {session.remember ? 'Remembered' : 'Until the browser closes'}
                  {session.ip ? ` · ${session.ip}` : ''}
                </div>
              </div>
              {!session.current && (
                <button
                  type="button"
                  onClick={() => revoke(session)}
                  disabled={busyId !== null}
                  className="btn-secondary dark:bg-gray-800/70 dark:text-gray-200 dark:border-gray-700 shrink-0"
                >
                  {busyId === session.id ? <Loader2 size={14} className="animate-spin mr-1.5" /> : null}
                  Sign out
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <StatusMessage message={message} />
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void signOut()} disabled={busyId !== null} className="btn-primary">
          <LogOut size={16} className="mr-2" />
          Sign out
        </button>
        <button type="button" onClick={everywhere} disabled={busyId !== null} className="btn-danger">
          {busyId === 'everywhere' ? <Loader2 size={16} className="animate-spin mr-2" /> : null}
          Sign out everywhere
        </button>
      </div>
    </div>
  );
}

function WebhookSecretSection() {
  const [regenerating, setRegenerating] = useState(false);
  const [message, setMessage] = useState<Message>(null);

  const regenerate = async () => {
    if (
      !window.confirm(
        'Regenerate your webhook secret? Every webhook URL you have set up (Sleep as Android, Plex) stops working until you paste the new URL into those apps.',
      )
    ) return;
    setRegenerating(true);
    setMessage(null);
    try {
      await auth.regenerateWebhookToken();
      setMessage({
        type: 'success',
        text: 'New secret generated. Copy the new webhook URLs from the Sleep and Media settings tabs into Sleep as Android and Plex.',
      });
    } catch (err) {
      setMessage({ type: 'error', text: errorText(err, 'Could not regenerate the secret.') });
    } finally {
      setRegenerating(false);
    }
  };

  return (
    <div className={SECTION_CLASS}>
      <h2 className={HEADING_CLASS}>
        <Webhook size={20} className="text-gray-600 dark:text-gray-400" />
        Webhook URLs secret
      </h2>
      <p className={HINT_CLASS}>
        Your webhook URLs (Sleep as Android, Plex) contain a secret that identifies your account. Anyone with one
        of those URLs can post data into your journal. If a URL leaked, regenerate the secret — then update the
        URL in Sleep as Android and Plex, because the old URLs stop working immediately.
      </p>
      <StatusMessage message={message} />
      <button type="button" onClick={regenerate} disabled={regenerating} className="btn-danger">
        {regenerating ? <Loader2 size={16} className="animate-spin mr-2" /> : <RefreshCw size={16} className="mr-2" />}
        Regenerate
      </button>
    </div>
  );
}

export function AccountTab() {
  // Bumped after a password change (other sessions are gone) to reload devices.
  const [sessionsKey, setSessionsKey] = useState(0);
  return (
    <>
      <ProfileSection />
      <PasswordSection onChanged={() => setSessionsKey((k) => k + 1)} />
      <SessionsSection refreshKey={sessionsKey} />
      <WebhookSecretSection />
    </>
  );
}

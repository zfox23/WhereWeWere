import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Users, UserPlus, Loader2, Check, AlertCircle, Copy, Wand2, KeyRound, Shield, ShieldOff, Ban, CircleCheck, Trash2 } from 'lucide-react';
import { adminUsers, type ManagedUser } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { PASSWORD_MIN_LENGTH } from '../../components/PasswordChangeForm';
import { formatRelative, generateTemporaryPassword } from '../../utils/accountFormat';
import { copyText } from '../../utils/clipboard';

const SECTION_CLASS =
  'bg-white/60 dark:bg-gray-900/60 rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3 p-6 space-y-4 scroll-mt-24';
const HEADING_CLASS = 'text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2';
const LABEL_CLASS = 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1';
const SMALL_BUTTON = 'btn-secondary dark:bg-gray-800/70 dark:text-gray-200 dark:border-gray-700 px-3! py-1.5! text-xs';

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

/** Temporary password input with Generate and Copy buttons. */
function TemporaryPasswordField({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  const [copied, setCopied] = useState<boolean | null>(null);
  const copy = async () => setCopied(await copyText(value));
  return (
    <div>
      <label htmlFor={id} className={LABEL_CLASS}>Temporary password</label>
      <div className="flex gap-2">
        <input
          id={id}
          type="text"
          className="input font-mono"
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(e) => {
            setCopied(null);
            onChange(e.target.value);
          }}
        />
        <button
          type="button"
          onClick={() => {
            setCopied(null);
            onChange(generateTemporaryPassword());
          }}
          className="btn-secondary dark:bg-gray-800/70 dark:text-gray-200 dark:border-gray-700 shrink-0"
          title="Generate a random password"
        >
          <Wand2 size={16} className="mr-1.5" />
          Generate
        </button>
        <button
          type="button"
          onClick={copy}
          disabled={!value}
          className="btn-secondary dark:bg-gray-800/70 dark:text-gray-200 dark:border-gray-700 shrink-0"
          aria-label="Copy password"
          title="Copy to clipboard"
        >
          {copied ? <Check size={16} /> : <Copy size={16} />}
        </button>
      </div>
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
        {copied === false
          ? 'Could not copy — select the password and copy it manually.'
          : `At least ${PASSWORD_MIN_LENGTH} characters. Give it to the user; they must choose their own password when they sign in.`}
      </p>
    </div>
  );
}

function CreateUserForm({ onCreated }: { onCreated: (user: ManagedUser) => void }) {
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState(() => generateTemporaryPassword());
  const [isAdmin, setIsAdmin] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<Message>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < PASSWORD_MIN_LENGTH) {
      setMessage({ type: 'error', text: `The temporary password must be at least ${PASSWORD_MIN_LENGTH} characters.` });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const created = await adminUsers.create({
        username: username.trim(),
        password,
        display_name: displayName.trim() || undefined,
        is_admin: isAdmin,
      });
      onCreated(created);
      setMessage({
        type: 'success',
        text: `Created ${created.username}. Share the temporary password with them — they'll choose their own when they first sign in.`,
      });
      setUsername('');
      setDisplayName('');
      setIsAdmin(false);
      setPassword(generateTemporaryPassword());
    } catch (err) {
      setMessage({ type: 'error', text: errorText(err, 'Could not create the user.') });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className={SECTION_CLASS} noValidate>
      <h2 className={HEADING_CLASS}>
        <UserPlus size={20} className="text-gray-600 dark:text-gray-400" />
        Add a user
      </h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="new-user-username" className={LABEL_CLASS}>Username</label>
          <input
            id="new-user-username"
            type="text"
            className="input"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">3–30 characters: letters, numbers, _ . -</p>
        </div>
        <div>
          <label htmlFor="new-user-display-name" className={LABEL_CLASS}>Display name</label>
          <input
            id="new-user-display-name"
            type="text"
            className="input"
            placeholder="Optional"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </div>
      </div>
      <TemporaryPasswordField id="new-user-password" value={password} onChange={setPassword} />
      <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
        <input
          type="checkbox"
          className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
          checked={isAdmin}
          onChange={(e) => setIsAdmin(e.target.checked)}
        />
        Administrator (can manage users)
      </label>
      <StatusMessage message={message} />
      <button type="submit" disabled={saving} className="btn-primary">
        {saving ? <Loader2 size={16} className="animate-spin mr-2" /> : <UserPlus size={16} className="mr-2" />}
        Create user
      </button>
    </form>
  );
}

function Badge({ tone, children }: { tone: 'primary' | 'red' | 'amber'; children: React.ReactNode }) {
  const tones = {
    primary: 'bg-primary-500/10 text-primary-700 dark:text-primary-400',
    red: 'bg-red-500/10 text-red-700 dark:text-red-400',
    amber: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  };
  return <span className={`rounded-full px-2 py-0.5 text-xs ${tones[tone]}`}>{children}</span>;
}

function ResetPasswordPanel({ user, onDone, onCancel }: { user: ManagedUser; onDone: (u: ManagedUser) => void; onCancel: () => void }) {
  const [password, setPassword] = useState(() => generateTemporaryPassword());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (password.length < PASSWORD_MIN_LENGTH) {
      setError(`The temporary password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      onDone(await adminUsers.resetPassword(user.id, password));
    } catch (err) {
      setError(errorText(err, 'Could not reset the password.'));
      setSaving(false);
    }
  };

  return (
    <div className="mt-3 rounded-xl border border-gray-200/70 dark:border-gray-700/70 p-4 space-y-3">
      <p className="text-sm text-gray-600 dark:text-gray-300">
        Set a temporary password for <strong>{user.username}</strong>. They'll be signed out everywhere and must
        choose a new password when they next sign in.
      </p>
      <TemporaryPasswordField id={`reset-${user.id}`} value={password} onChange={setPassword} />
      <StatusMessage message={error ? { type: 'error', text: error } : null} />
      <div className="flex gap-2">
        <button type="button" onClick={submit} disabled={saving} className="btn-primary">
          {saving ? <Loader2 size={16} className="animate-spin mr-2" /> : null}
          Reset password
        </button>
        <button type="button" onClick={onCancel} className="btn-secondary dark:bg-gray-800/70 dark:text-gray-200 dark:border-gray-700">
          Cancel
        </button>
      </div>
    </div>
  );
}

export function DeleteUserPanel({ user, onDeleted, onCancel }: { user: ManagedUser; onDeleted: () => void; onCancel: () => void }) {
  const [typed, setTyped] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Must match exactly: the server compares the username case-sensitively.
  const matches = typed === user.username;

  const submit = async () => {
    if (!matches) return;
    setDeleting(true);
    setError(null);
    try {
      await adminUsers.delete(user.id, typed);
      onDeleted();
    } catch (err) {
      setError(errorText(err, 'Could not delete the user.'));
      setDeleting(false);
    }
  };

  return (
    <div className="mt-3 rounded-xl border border-red-300/70 dark:border-red-800/70 bg-red-50/60 dark:bg-red-950/30 p-4 space-y-3">
      <p className="text-sm text-red-800 dark:text-red-300">
        This permanently deletes <strong>{user.username}</strong> and <strong>all of their data</strong>: check-ins,
        notes, lists, stats, settings and integrations. It cannot be undone. Venues they added to the shared
        catalog are kept.
      </p>
      <p className="text-sm text-gray-600 dark:text-gray-300">
        To keep their data but stop them signing in, use <strong>Disable</strong> instead.
      </p>
      <div>
        <label htmlFor={`delete-${user.id}`} className={LABEL_CLASS}>
          Type <span className="font-mono">{user.username}</span> to confirm
        </label>
        <input
          id={`delete-${user.id}`}
          type="text"
          className="input font-mono"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
        />
      </div>
      <StatusMessage message={error ? { type: 'error', text: error } : null} />
      <div className="flex gap-2">
        <button type="button" onClick={submit} disabled={!matches || deleting} className="btn-danger">
          {deleting ? <Loader2 size={16} className="animate-spin mr-2" /> : <Trash2 size={16} className="mr-2" />}
          Delete permanently
        </button>
        <button type="button" onClick={onCancel} className="btn-secondary dark:bg-gray-800/70 dark:text-gray-200 dark:border-gray-700">
          Cancel
        </button>
      </div>
    </div>
  );
}

type Panel = { userId: string; kind: 'reset' | 'delete' } | null;

function UserRow({
  user,
  isSelf,
  onChanged,
  onDeleted,
}: {
  user: ManagedUser;
  isSelf: boolean;
  onChanged: (user: ManagedUser, note: string) => void;
  onDeleted: (user: ManagedUser) => void;
}) {
  const [panel, setPanel] = useState<Panel>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<ManagedUser>, note: string) => {
    setBusy(true);
    setError(null);
    try {
      onChanged(await action(), note);
    } catch (err) {
      setError(errorText(err, 'Action failed.'));
    } finally {
      setBusy(false);
    }
  };

  const toggleAdmin = () => {
    if (!user.is_admin && !window.confirm(`Make ${user.username} an administrator? They will be able to manage every account.`)) return;
    void run(
      () => adminUsers.setAdmin(user.id, !user.is_admin),
      user.is_admin ? `${user.username} is no longer an administrator.` : `${user.username} is now an administrator.`,
    );
  };
  const toggleDisabled = () => {
    if (!user.disabled_at && !window.confirm(`Disable ${user.username}? They are signed out and can't sign in; their data is kept.`)) return;
    void run(
      () => (user.disabled_at ? adminUsers.enable(user.id) : adminUsers.disable(user.id)),
      user.disabled_at ? `${user.username} can sign in again.` : `${user.username} is disabled.`,
    );
  };

  return (
    <li className="py-4" data-testid={`user-row-${user.username}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-gray-900 dark:text-gray-100">
            <span className="font-mono">{user.username}</span>
            {user.display_name && <span className="text-gray-500 dark:text-gray-400 font-normal">{user.display_name}</span>}
            {isSelf && <Badge tone="primary">You</Badge>}
            {user.is_admin && <Badge tone="primary">Admin</Badge>}
            {user.disabled_at && <Badge tone="red">Disabled</Badge>}
            {user.must_change_password && <Badge tone="amber">Must change password</Badge>}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            Last seen {formatRelative(user.last_seen_at)}
          </div>
        </div>
        {isSelf ? (
          <span className="text-xs text-gray-400 dark:text-gray-500">Manage your own account in the Account tab.</span>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            <button type="button" disabled={busy} onClick={() => setPanel({ userId: user.id, kind: 'reset' })} className={SMALL_BUTTON}>
              <KeyRound size={13} className="mr-1" />
              Reset password
            </button>
            <button type="button" disabled={busy} onClick={toggleAdmin} className={SMALL_BUTTON}>
              {user.is_admin ? <ShieldOff size={13} className="mr-1" /> : <Shield size={13} className="mr-1" />}
              {user.is_admin ? 'Remove admin' : 'Make admin'}
            </button>
            <button type="button" disabled={busy} onClick={toggleDisabled} className={SMALL_BUTTON}>
              {user.disabled_at ? <CircleCheck size={13} className="mr-1" /> : <Ban size={13} className="mr-1" />}
              {user.disabled_at ? 'Enable' : 'Disable'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setPanel({ userId: user.id, kind: 'delete' })}
              className={`${SMALL_BUTTON} text-red-600! dark:text-red-400!`}
            >
              <Trash2 size={13} className="mr-1" />
              Delete
            </button>
          </div>
        )}
      </div>
      <StatusMessage message={error ? { type: 'error', text: error } : null} />
      {panel?.kind === 'reset' && (
        <ResetPasswordPanel
          user={user}
          onCancel={() => setPanel(null)}
          onDone={(updated) => {
            setPanel(null);
            onChanged(updated, `Password reset for ${updated.username}. Share the temporary password with them.`);
          }}
        />
      )}
      {panel?.kind === 'delete' && (
        <DeleteUserPanel user={user} onCancel={() => setPanel(null)} onDeleted={() => onDeleted(user)} />
      )}
    </li>
  );
}

export function UsersTab() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<ManagedUser[] | null>(null);
  const [message, setMessage] = useState<Message>(null);

  const load = useCallback(async () => {
    try {
      setUsers(await adminUsers.list());
    } catch (err) {
      setMessage({ type: 'error', text: errorText(err, 'Could not load users.') });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const sortUsers = (list: ManagedUser[]) =>
    list.slice().sort((a, b) => a.username.toLowerCase().localeCompare(b.username.toLowerCase()));

  return (
    <>
      <div className={SECTION_CLASS}>
        <h2 className={HEADING_CLASS}>
          <Users size={20} className="text-gray-600 dark:text-gray-400" />
          Users
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Everyone's journal is private: administrators manage accounts here but can't see anyone else's data.
        </p>
        <StatusMessage message={message} />
        {users === null && !message && <Loader2 size={20} className="animate-spin text-primary-600" />}
        {users && (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {users.map((u) => (
              <UserRow
                key={u.id}
                user={u}
                isSelf={u.id === me?.id}
                onChanged={(updated, note) => {
                  setUsers((prev) => prev?.map((x) => (x.id === updated.id ? updated : x)) ?? prev);
                  setMessage({ type: 'success', text: note });
                }}
                onDeleted={(deleted) => {
                  setUsers((prev) => prev?.filter((x) => x.id !== deleted.id) ?? prev);
                  setMessage({ type: 'success', text: `Deleted ${deleted.username} and all of their data.` });
                }}
              />
            ))}
          </ul>
        )}
      </div>
      <CreateUserForm onCreated={(created) => setUsers((prev) => sortUsers([...(prev ?? []), created]))} />
    </>
  );
}

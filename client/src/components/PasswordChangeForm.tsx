import { useState, type FormEvent } from 'react';
import { Loader2 } from 'lucide-react';
import { auth, type Account } from '../api/client';
import { FormError } from '../pages/Login';

export const PASSWORD_MIN_LENGTH = 8;

interface PasswordChangeFormProps {
  /** Label for the first field ("Current password" / "Temporary password"). */
  currentLabel?: string;
  submitLabel?: string;
  onChanged: (account: Account) => void;
}

/** Current + new + confirm password form (PUT /auth/password). */
export function PasswordChangeForm({
  currentLabel = 'Current password',
  submitLabel = 'Change password',
  onChanged,
}: PasswordChangeFormProps) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!current) return setError(`Enter your ${currentLabel.toLowerCase()}.`);
    if (next.length < PASSWORD_MIN_LENGTH) {
      return setError(`The new password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
    }
    if (next !== confirm) return setError('The new passwords don’t match.');
    if (next === current) return setError('The new password must be different from the current one.');

    setSaving(true);
    setError(null);
    try {
      const account = await auth.changePassword(current, next);
      setCurrent('');
      setNext('');
      setConfirm('');
      onChanged(account);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to change the password.');
    } finally {
      setSaving(false);
    }
  };

  const field = (id: string, label: string, value: string, set: (v: string) => void, autoComplete: string) => (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{label}</label>
      <input
        id={id}
        type="password"
        className="input"
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => set(e.target.value)}
      />
    </div>
  );

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {field('pw-current', currentLabel, current, setCurrent, 'current-password')}
      {field('pw-new', 'New password', next, setNext, 'new-password')}
      <p className="-mt-2 text-xs text-gray-500 dark:text-gray-400">At least {PASSWORD_MIN_LENGTH} characters.</p>
      {field('pw-confirm', 'Confirm new password', confirm, setConfirm, 'new-password')}
      <FormError message={error} />
      <button type="submit" disabled={saving} className="btn-primary">
        {saving ? <Loader2 size={16} className="animate-spin mr-2" /> : null}
        {submitLabel}
      </button>
    </form>
  );
}

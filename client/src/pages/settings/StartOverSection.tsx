import { useState } from 'react';
import { ShieldAlert, Trash2, Loader2, Check, AlertCircle } from 'lucide-react';
import { backupApi } from '../../api/client';

export function StartOverSection() {
  const [step, setStep] = useState<1 | 2>(1);
  const [firstConfirmation, setFirstConfirmation] = useState('');
  const [secondConfirmation, setSecondConfirmation] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [options, setOptions] = useState({
    delete_all_checkins: false,
    delete_venue_checkins: false,
    delete_mood_checkins: false,
    delete_sleep_entries: false,
    reset_account_settings: false,
    reset_mood_settings: false,
    reset_integrations_settings: false,
  });

  const hasAnySelection = Object.values(options).some(Boolean);
  const canAdvance = firstConfirmation.trim() === 'DELETE MY DATA' && hasAnySelection;
  const canSubmit = secondConfirmation.trim() === 'START OVER' && hasAnySelection;

  const toggleOption = (key: keyof typeof options) => {
    setOptions((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      if (key === 'delete_all_checkins') {
        next.delete_venue_checkins = next.delete_all_checkins;
        next.delete_mood_checkins = next.delete_all_checkins;
        next.delete_sleep_entries = next.delete_all_checkins;
      }
      return next;
    });
  };

  const handleStartOver = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setMessage(null);
    try {
      await backupApi.startOver(firstConfirmation.trim(), secondConfirmation.trim(), options);
      setMessage({ type: 'success', text: 'Selected data has been reset. Reloading...' });
      window.setTimeout(() => window.location.reload(), 1200);
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Start-over failed.' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-red-50/60 dark:bg-red-900/10 backdrop-blur-xl rounded-2xl border border-red-200/80 dark:border-red-900/50 shadow-sm shadow-black/[0.03] p-6 space-y-4">
      <h2 className="text-lg font-semibold text-red-700 dark:text-red-300 flex items-center gap-2">
        <ShieldAlert size={20} />
        Start Over (Danger Zone)
      </h2>
      <p className="text-sm text-red-700/90 dark:text-red-200/90">
        Select exactly what to delete or reset. These actions are permanent.
      </p>

      <div className="space-y-2 rounded-lg border border-red-200/70 dark:border-red-900/40 p-3">
        <label className="flex items-start gap-2 text-sm text-red-900 dark:text-red-100">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={options.delete_all_checkins}
            onChange={() => toggleOption('delete_all_checkins')}
          />
          <span>All Checkins (Venue and Mood)</span>
        </label>
        <label className="flex items-start gap-2 text-sm text-red-900 dark:text-red-100">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={options.delete_venue_checkins}
            disabled={options.delete_all_checkins}
            onChange={() => toggleOption('delete_venue_checkins')}
          />
          <span>All Venue Checkins</span>
        </label>
        <label className="flex items-start gap-2 text-sm text-red-900 dark:text-red-100">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={options.delete_mood_checkins}
            disabled={options.delete_all_checkins}
            onChange={() => toggleOption('delete_mood_checkins')}
          />
          <span>All Mood Checkins</span>
        </label>
        <label className="flex items-start gap-2 text-sm text-red-900 dark:text-red-100">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={options.delete_sleep_entries}
            disabled={options.delete_all_checkins}
            onChange={() => toggleOption('delete_sleep_entries')}
          />
          <span>All Sleep Entries</span>
        </label>
        <label className="flex items-start gap-2 text-sm text-red-900 dark:text-red-100">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={options.reset_account_settings}
            onChange={() => toggleOption('reset_account_settings')}
          />
          <span>Reset Account Settings</span>
        </label>
        <label className="flex items-start gap-2 text-sm text-red-900 dark:text-red-100">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={options.reset_mood_settings}
            onChange={() => toggleOption('reset_mood_settings')}
          />
          <span>Reset Mood Settings (including Activities and Activity Groups)</span>
        </label>
        <label className="flex items-start gap-2 text-sm text-red-900 dark:text-red-100">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={options.reset_integrations_settings}
            onChange={() => toggleOption('reset_integrations_settings')}
          />
          <span>Reset Integrations Settings</span>
        </label>
      </div>

      {step === 1 && (
        <div className="space-y-3">
          <p className="text-xs text-red-800/80 dark:text-red-200/80">
            Step 1 of 2: Type DELETE MY DATA to confirm you understand this is permanent.
          </p>
          <input
            type="text"
            value={firstConfirmation}
            onChange={(e) => setFirstConfirmation(e.target.value)}
            className="input border-red-300/80"
            placeholder="DELETE MY DATA"
          />
          {!hasAnySelection && (
            <p className="text-xs text-red-700">Select at least one reset option above.</p>
          )}
          <button
            type="button"
            disabled={!canAdvance}
            onClick={() => setStep(2)}
            className="btn-secondary disabled:opacity-50"
          >
            Continue to Final Confirmation
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-3">
          <p className="text-xs text-red-800/80 dark:text-red-200/80">
            Step 2 of 2: Type START OVER and submit to run the selected actions.
          </p>
          <input
            type="text"
            value={secondConfirmation}
            onChange={(e) => setSecondConfirmation(e.target.value)}
            className="input border-red-300/80"
            placeholder="START OVER"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setStep(1);
                setSecondConfirmation('');
              }}
              className="btn-secondary"
            >
              Back
            </button>
            <button
              type="button"
              disabled={!canSubmit || submitting}
              onClick={handleStartOver}
              className="inline-flex items-center px-4 py-2 rounded-lg font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50"
            >
              {submitting ? <Loader2 size={16} className="animate-spin mr-2" /> : <Trash2 size={16} className="mr-2" />}
              Run Selected Reset
            </button>
          </div>
        </div>
      )}

      {message && (
        <div className={`flex items-center gap-2 text-sm ${message.type === 'success' ? 'text-green-600 dark:text-green-400' : 'text-red-600'}`}>
          {message.type === 'success' ? <Check size={16} /> : <AlertCircle size={16} />}
          {message.text}
        </div>
      )}
    </div>
  );
}

/**
 * AutoCheckInForm — the default check-in (create + edit) page for plugins
 * that do not ship their own `checkInForm`. Renders one input per manifest
 * field, applies defaults, and persists via the generic plugin check-in
 * API. A timestamp field (field.isTimestamp) drives checked_in_at.
 */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2, Save, Trash2 } from 'lucide-react';
import type { PluginField, CheckInFormProps, CheckinTypeStrings } from 'wwp-shared';
import { plugins } from './api';

type FormValues = Record<string, unknown>;

function initialValuesForFields(fields: PluginField[]): FormValues {
  const out: FormValues = {};
  for (const field of fields) {
    if (field.default !== undefined) {
      out[field.name] = field.kind === 'multi-select' ? [...(field.default as unknown[])] : field.default;
    } else {
      out[field.name] =
        field.kind === 'multi-select' ? []
        : field.kind === 'boolean' ? false
        : field.kind === 'rating' ? (field.min ?? 0)
        : undefined;
    }
  }
  return out;
}

function FieldInput({ field, value, onChange }: { field: PluginField; value: unknown; onChange: (v: unknown) => void }) {
  switch (field.kind) {
    case 'text':
      return (
        <input
          type="text"
          value={(value as string) ?? ''}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
      );
    case 'textarea':
      return (
        <textarea
          value={(value as string) ?? ''}
          placeholder={field.placeholder}
          rows={4}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
      );
    case 'number':
      return (
        <input
          type="number"
          value={(value as number) ?? ''}
          min={field.min}
          max={field.max}
          step={field.step}
          onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
          className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
      );
    case 'integer':
      return (
        <input
          type="number"
          value={(value as number) ?? ''}
          min={field.min}
          max={field.max}
          step={1}
          onChange={(e) => onChange(e.target.value === '' ? undefined : Math.trunc(Number(e.target.value)))}
          className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
      );
    case 'boolean':
      return (
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
          />
          Yes
        </label>
      );
    case 'date':
      return (
        <input
          type="date"
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value || undefined)}
          className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
      );
    case 'datetime':
      return (
        <input
          type="datetime-local"
          value={value ? new Date(value as string).toISOString().slice(0, 16) : ''}
          onChange={(e) => onChange(e.target.value ? new Date(e.target.value).toISOString() : undefined)}
          className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
      );
    case 'rating': {
      const max = field.max ?? 5;
      const min = field.min ?? 0;
      const current = typeof value === 'number' ? value : null;
      return (
        <div className="flex items-center gap-1">
          {Array.from({ length: max - min + 1 }, (_, i) => min + i + 1).map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => onChange(n)}
              className={`flex h-9 w-9 items-center justify-center rounded-lg border text-sm font-semibold transition-colors ${
                current === n
                  ? 'border-primary-500 bg-primary-500 text-white'
                  : 'border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-primary-400'
              }`}
              title={String(n)}
            >
              {n}
            </button>
          ))}
        </div>
      );
    }
    case 'select':
      return (
        <select
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value || undefined)}
          className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
        >
          <option value="" disabled>Select…</option>
          {(field.options ?? []).map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.icon ? `${opt.icon} ` : ''}{opt.label}
            </option>
          ))}
        </select>
      );
    case 'multi-select': {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      const toggle = (v: string) =>
        onChange(selected.includes(v) ? selected.filter((s) => s !== v) : [...selected, v]);
      return (
        <div className="flex flex-wrap gap-1.5">
          {(field.options ?? []).map((opt) => {
            const active = selected.includes(opt.value);
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => toggle(opt.value)}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  active
                    ? 'border-primary-500 bg-primary-500 text-white'
                    : 'border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-primary-400'
                }`}
              >
                {opt.icon ? `${opt.icon} ` : ''}{opt.label}
              </button>
            );
          })}
        </div>
      );
    }
    default:
      return null;
  }
}

export function AutoCheckInForm({ plugin, editId = null }: CheckInFormProps & { plugin: { id: string; fields: PluginField[]; strings: CheckinTypeStrings } }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const dateParam = searchParams.get('date');

  const [values, setValues] = useState<FormValues>(() =>
    initialValuesForFields(plugin.fields),
  );
  const [loading, setLoading] = useState(Boolean(editId));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const timestampField = useMemo(
    () => plugin.fields.find((f) => f.isTimestamp) ?? null,
    [plugin.fields],
  );

  useEffect(() => {
    if (!editId) {
      if (dateParam && timestampField) {
        setValues((v) => ({ ...v, [timestampField.name]: dateParam }));
      }
      return;
    }
    plugins.checkins
      .get(plugin.id, editId)
      .then((row) => {
        const data = { ...(row.data ?? {}) };
        if (timestampField) {
          data[timestampField.name] = row.checked_in_at;
        }
        setValues(data);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [editId, plugin.id, dateParam, timestampField]);

  const setField = (name: string, value: unknown) => setValues((v) => ({ ...v, [name]: value }));

  const timestampValue = timestampField ? values[timestampField.name] : undefined;

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const data = { ...values };
      let checkedInAt: string | null = null;
      if (timestampField) {
        const raw = data[timestampField.name];
        checkedInAt = raw ? String(raw) : null;
        delete data[timestampField.name];
      }
      if (editId) {
        await plugins.checkins.update(plugin.id, editId, {
          checked_in_at: checkedInAt,
          data,
        });
        navigate('/');
      } else {
        const row = await plugins.checkins.create(plugin.id, {
          checked_in_at: checkedInAt,
          data,
        });
        navigate(`/?highlight=${row.id}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!editId) return;
    if (!window.confirm(plugin.strings.confirmDelete ?? 'Delete this check-in?')) return;
    setDeleting(true);
    try {
      await plugins.checkins.remove(plugin.id, editId);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete');
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }

  const title = editId
    ? `Edit ${plugin.strings.singular ?? 'check-in'}`
    : (plugin.strings.newCheckIn ?? 'New check-in');

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{title}</h1>

      <div className="mt-6 space-y-5">
        {plugin.fields.map((field) => (
          <div key={field.name}>
            <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {field.label}
              {field.required && <span className="ml-0.5 text-red-500">*</span>}
              {field.unit && <span className="ml-1 text-xs font-normal text-gray-500">({field.unit})</span>}
            </label>
            <FieldInput field={field} value={values[field.name]} onChange={(v) => setField(field.name, v)} />
          </div>
        ))}
      </div>

      {error && (
        <p className="mt-4 rounded-lg bg-red-50 dark:bg-red-900/20 px-3 py-2 text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      )}

      <div className="mt-6 flex items-center gap-3">
        <button
          type="button"
          onClick={submit}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          <Save className="h-4 w-4" />
          {editId ? 'Save changes' : 'Save'}
        </button>
        {editId && (
          <button
            type="button"
            onClick={remove}
            disabled={deleting}
            className="inline-flex items-center gap-2 rounded-lg border border-red-300 dark:border-red-800 px-4 py-2 text-sm font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"
          >
            {deleting && <Loader2 className="h-4 w-4 animate-spin" />}
            <Trash2 className="h-4 w-4" />
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * SCUBA check-in page (create + edit).
 *
 * Persists via the framework's generic plugin check-in API
 * (`/plugins/scuba/checkins`); the dive's local date + entry time combine
 * into `checked_in_at`, and the less-used logbook fields live in a
 * collapsible "Advanced" section.
 */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronDown, Loader2, Save, Trash2 } from 'lucide-react';
import type { CheckInFormProps } from 'wwp-shared';
import { plugins, type GenericCheckin } from '../../../client/src/plugins/api';

const PLUGIN_ID = 'scuba';

type Values = Record<string, unknown>;

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function localDatePart(iso: string, timeZone: string | null): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone || undefined,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

function timePart(iso: string, timeZone: string | null): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone || undefined,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(iso)).replace('24:', '00:');
  } catch {
    return iso.slice(11, 16);
  }
}

// ---------------------------------------------------------------------------
// Small form controls
// ---------------------------------------------------------------------------

const inputClass =
  'w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500';

function Field({
  label,
  value,
  onChange,
  placeholder,
  className,
}: {
  label: string;
  value: unknown;
  onChange: (v: unknown) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{label}</label>
      <input
        type="text"
        value={(value as string) ?? ''}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={inputClass}
      />
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  unit,
  min,
  max,
  step,
  className,
}: {
  label: string;
  value: unknown;
  onChange: (v: unknown) => void;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
        {label}
        {unit && <span className="ml-1 font-normal text-gray-400">({unit})</span>}
      </label>
      <input
        type="number"
        value={typeof value === 'number' ? value : ''}
        min={min}
        max={max}
        step={step ?? 'any'}
        onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
        className={inputClass}
      />
    </div>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
  className,
}: {
  label: string;
  value: unknown;
  onChange: (v: unknown) => void;
  options: { value: string; label: string }[];
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{label}</label>
      <select value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value || undefined)} className={inputClass}>
        <option value="">—</option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function CheckField({
  label,
  value,
  onChange,
  className,
}: {
  label: string;
  value: unknown;
  onChange: (v: unknown) => void;
  className?: string;
}) {
  return (
    <label className={`flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 ${className ?? ''}`}>
      <input
        type="checkbox"
        checked={Boolean(value)}
        onChange={(e) => onChange(e.target.checked || undefined)}
        className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
      />
      {label}
    </label>
  );
}

function RatingField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const current = typeof value === 'number' ? value : 0;
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{label}</label>
      <div className="flex items-center gap-1">
        {[0, 1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n === 0 ? undefined : n)}
            className={`flex h-8 w-8 items-center justify-center rounded-lg border text-sm font-semibold transition-colors ${
              current === n
                ? 'border-primary-500 bg-primary-500 text-white'
                : 'border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-primary-400'
            }`}
            title={n === 0 ? 'Unrated' : String(n)}
          >
            {n === 0 ? '–' : n}
          </button>
        ))}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white/60 dark:bg-gray-900/60 p-4 space-y-3">
      <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">{title}</h2>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ScubaCheckIn({ editId = null }: CheckInFormProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const dateParam = searchParams.get('date');

  const [date, setDate] = useState<string>(dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : todayIso());
  const [values, setValues] = useState<Values>({});
  const [loading, setLoading] = useState(Boolean(editId));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    if (!editId) return;
    plugins.checkins
      .get(PLUGIN_ID, editId)
      .then((row: GenericCheckin) => {
        setDate(localDatePart(row.checked_in_at, row.checkin_timezone));
        const data = { ...(row.data ?? {}) };
        setValues(data);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [editId]);

  const setField = (name: string, value: unknown) =>
    setValues((v) => {
      const next = { ...v };
      if (value === undefined || value === '' || value === false) delete next[name];
      else next[name] = value;
      return next;
    });

  const entryTime = (values.entry_time as string) || '';

  const checkedInAt = useMemo(() => {
    const time = /^\d{1,2}:\d{2}$/.test(entryTime) ? entryTime : '12:00';
    const parsed = new Date(`${date}T${time}:00`);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }, [date, entryTime]);

  const browserTimezone = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
    } catch {
      return null;
    }
  }, []);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const data: Values = {};
      for (const [k, v] of Object.entries(values)) {
        if (v !== undefined && v !== '' && v !== false) data[k] = v;
      }
      if (editId) {
        await plugins.checkins.update(PLUGIN_ID, editId, {
          checked_in_at: checkedInAt,
          data,
        });
        navigate(`/checkins/${PLUGIN_ID}/${editId}`);
      } else {
        const row = await plugins.checkins.create(PLUGIN_ID, {
          checked_in_at: checkedInAt,
          checkin_timezone: browserTimezone,
          data,
        });
        navigate(`/?highlight=${row.id}`);
        return;
      }
      window.scrollTo(0, 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!editId) return;
    if (!window.confirm('Delete this dive?')) return;
    setDeleting(true);
    try {
      await plugins.checkins.remove(PLUGIN_ID, editId);
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

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
        {editId ? 'Edit dive' : 'Log a dive'}
      </h1>

      <div className="mt-6 space-y-4">
        <Section title="When">
          <div className="grid grid-cols-3 gap-3">
            <Field label="Date" value={date} onChange={(v) => setDate(String(v))} placeholder="YYYY-MM-DD" />
            <Field label="Dive start time" value={entryTime} onChange={(v) => setField('entry_time', v)} placeholder="e.g. 09:10" />
            <NumberField label="Bottom time" value={values.bottom_time} onChange={(v) => setField('bottom_time', v)} unit="min" min={0} step={1} />
          </div>
        </Section>

        <Section title="Where">
          <div className="grid grid-cols-3 gap-3">
            <Field label="Site" value={values.place} onChange={(v) => setField('place', v)} placeholder="e.g. San Carlos Beach" />
            <Field label="City" value={values.city} onChange={(v) => setField('city', v)} />
            <Field label="Country" value={values.country} onChange={(v) => setField('country', v)} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <NumberField label="Latitude" value={values.latitude} onChange={(v) => setField('latitude', v)} step={0.0001} />
            <NumberField label="Longitude" value={values.longitude} onChange={(v) => setField('longitude', v)} step={0.0001} />
            <SelectField
              label="Water"
              value={values.water_type}
              onChange={(v) => setField('water_type', v)}
              options={[
                { value: 'salt', label: 'Saltwater' },
                { value: 'fresh', label: 'Freshwater' },
                { value: 'brackish', label: 'Brackish' },
                { value: 'pool', label: 'Pool' },
              ]}
            />
          </div>
        </Section>

        <Section title="Dive">
          <div className="grid grid-cols-3 gap-3">
            <NumberField label="Max depth" value={values.depth} onChange={(v) => setField('depth', v)} unit="m" min={0} step={0.1} />
            <NumberField label="Average depth" value={values.depth_avg} onChange={(v) => setField('depth_avg', v)} unit="m" min={0} step={0.1} />
            <SelectField
              label="Entry"
              value={values.entry_method}
              onChange={(v) => setField('entry_method', v)}
              options={[
                { value: 'shore', label: 'From shore' },
                { value: 'boat', label: 'From boat' },
                { value: 'surf', label: 'Surf' },
                { value: 'pool', label: 'Pool' },
                { value: 'other', label: 'Other' },
              ]}
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Dive types" value={values.divetype} onChange={(v) => setField('divetype', v)} placeholder="e.g. Drift, Night" />
            <Field label="Buddy" value={values.buddy} onChange={(v) => setField('buddy', v)} />
            <Field label="Divemaster" value={values.divemaster} onChange={(v) => setField('divemaster', v)} />
          </div>
          <RatingField label="Rating" value={values.rating} onChange={(v) => setField('rating', v)} />
        </Section>

        <Section title="Conditions">
          <div className="grid grid-cols-3 gap-3">
            <Field label="Weather" value={values.weather} onChange={(v) => setField('weather', v)} />
            <Field label="Surface" value={values.surface_conditions} onChange={(v) => setField('surface_conditions', v)} placeholder="e.g. 6 foot swells" />
            <Field label="Underwater current" value={values.uw_current} onChange={(v) => setField('uw_current', v)} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <NumberField label="Visibility (0–3)" value={values.visibility} onChange={(v) => setField('visibility', v)} min={0} step={1} />
            <NumberField label="Air temp" value={values.air_temp} onChange={(v) => setField('air_temp', v)} unit="°C" step={0.1} />
            <NumberField label="Water temp" value={values.water_temp} onChange={(v) => setField('water_temp', v)} unit="°C" step={0.1} />
          </div>
        </Section>

        <Section title="Equipment & Gas">
          <div className="grid grid-cols-3 gap-3">
            <SelectField
              label="Tank type"
              value={values.tank_type}
              onChange={(v) => setField('tank_type', v)}
              options={[
                { value: 'aluminum', label: 'Aluminum' },
                { value: 'steel', label: 'Steel' },
                { value: 'other', label: 'Other' },
              ]}
            />
            <NumberField label="Tank size" value={values.tank_size} onChange={(v) => setField('tank_size', v)} min={0} step={0.1} />
            <Field label="Gas" value={values.gas} onChange={(v) => setField('gas', v)} placeholder="e.g. Air, EAN32" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <NumberField label="Start pressure" value={values.start_pressure} onChange={(v) => setField('start_pressure', v)} unit="bar" min={0} step={0.1} />
            <NumberField label="End pressure" value={values.end_pressure} onChange={(v) => setField('end_pressure', v)} unit="bar" min={0} step={0.1} />
            <NumberField label="Weight belt" value={values.weight} onChange={(v) => setField('weight', v)} unit="kg" min={0} step={0.1} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Divesuit" value={values.divesuit} onChange={(v) => setField('divesuit', v)} placeholder="e.g. 8mm Semi-Dry" />
            <Field label="Computer" value={values.computer} onChange={(v) => setField('computer', v)} />
            <Field label="Boat" value={values.boat_name} onChange={(v) => setField('boat_name', v)} />
          </div>
        </Section>

        <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white/60 dark:bg-gray-900/60 overflow-hidden">
          <button
            type="button"
            onClick={() => setShowAdvanced((s) => !s)}
            className="flex w-full items-center justify-between px-4 py-3 text-sm font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/50"
          >
            Advanced (deco, gas loads, trip, provenance)
            <ChevronDown size={16} className={`transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
          </button>
          {showAdvanced && (
            <div className="border-t border-gray-200 dark:border-gray-700 p-4 space-y-3">
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                <CheckField label="Decompression dive" value={values.deco} onChange={(v) => setField('deco', v)} />
                <CheckField label="Repetitive dive" value={values.repetitive} onChange={(v) => setField('repetitive', v)} />
                <CheckField label="Doubles" value={values.dbl_tank} onChange={(v) => setField('dbl_tank', v)} />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Deco stops" value={values.deco_stops} onChange={(v) => setField('deco_stops', v)} />
                <Field label="Surface interval" value={values.surface_interval} onChange={(v) => setField('surface_interval', v)} placeholder="e.g. 54m" />
                <Field label="Altitude" value={values.altitude} onChange={(v) => setField('altitude', v)} />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <NumberField label="O₂ %" value={values.o2} onChange={(v) => setField('o2', v)} min={0} max={100} step={0.1} />
                <NumberField label="He %" value={values.he} onChange={(v) => setField('he', v)} min={0} max={100} step={0.1} />
                <NumberField label="Weighted pressure" value={values.weight_pressure} onChange={(v) => setField('weight_pressure', v)} unit="bar" min={0} step={0.1} />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <NumberField label="Min pPO₂" value={values.min_ppo2} onChange={(v) => setField('min_ppo2', v)} unit="bar" min={0} step={0.1} />
                <NumberField label="Max pPO₂" value={values.max_ppo2} onChange={(v) => setField('max_ppo2', v)} unit="bar" min={0} step={0.1} />
                <Field label="Supply type" value={values.supply_type} onChange={(v) => setField('supply_type', v)} />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <NumberField label="Desaturation time" value={values.desaturation_time} onChange={(v) => setField('desaturation_time', v)} unit="min" min={0} step={1} />
                <NumberField label="No-fly time" value={values.no_fly_time} onChange={(v) => setField('no_fly_time', v)} unit="min" min={0} step={1} />
                <NumberField label="Scrubber time" value={values.scrubber_time} onChange={(v) => setField('scrubber_time', v)} unit="min" min={0} step={1} />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <Field label="CNS" value={values.cns} onChange={(v) => setField('cns', v)} />
                <Field label="Pressure group (start)" value={values.pg_start} onChange={(v) => setField('pg_start', v)} />
                <Field label="Pressure group (end)" value={values.pg_end} onChange={(v) => setField('pg_end', v)} />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Horizontal visibility" value={values.vis_hor} onChange={(v) => setField('vis_hor', v)} placeholder="e.g. 30 ft" />
                <Field label="Vertical visibility" value={values.vis_ver} onChange={(v) => setField('vis_ver', v)} placeholder="e.g. 30 ft" />
                <Field label="Used equipment" value={values.used_equip} onChange={(v) => setField('used_equip', v)} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Shop / operator" value={values.shop} onChange={(v) => setField('shop', v)} />
                <Field label="Trip" value={values.trip} onChange={(v) => setField('trip', v)} />
              </div>
            </div>
          )}
        </div>

        <Section title="Notes">
          <textarea
            value={(values.comments as string) ?? ''}
            placeholder="What did you see? How did the dive go?"
            rows={5}
            onChange={(e) => setField('comments', e.target.value)}
            className={inputClass}
          />
        </Section>

        {error && (
          <p className="rounded-lg bg-red-50 dark:bg-red-900/20 px-3 py-2 text-sm text-red-700 dark:text-red-300">
            {error}
          </p>
        )}

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={submit}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            <Save className="h-4 w-4" />
            {editId ? 'Save changes' : 'Save dive'}
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
    </div>
  );
}

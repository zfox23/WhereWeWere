/**
 * SCUBA dive detail page: /checkins/scuba/:id
 *
 * Read-only grouped view of the stored dive data with a full-text comments
 * section, plus links back to the timeline and to the edit form.
 */

import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Loader2, Pencil, Waves } from 'lucide-react';
import { plugins, type GenericCheckin } from '../../../client/src/plugins/api';
import { formatDate, formatTime } from '../../../client/src/utils/checkin';
import { formatDepth, formatPressure, formatTemp, formatWeight, useScubaUnits } from './units';

const PLUGIN_ID = 'scuba';

function Section({ title, rows }: { title: string; rows: [string, unknown][] }) {
  const visible = rows.filter(([, v]) => v !== null && v !== undefined && v !== '' && v !== false);
  if (visible.length === 0) return null;
  return (
    <section>
      <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">{title}</h2>
      <dl className="mt-2 space-y-1.5">
        {visible.map(([label, value]) => (
          <div key={label} className="flex items-start gap-3">
            <dt className="w-40 shrink-0 text-sm text-gray-500 dark:text-gray-400">{label}</dt>
            <dd className="text-sm text-gray-900 dark:text-gray-100 break-words">{String(value)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export default function ScubaDetail() {
  const { id } = useParams<{ id: string }>();
  const unit = useScubaUnits();
  const [row, setRow] = useState<GenericCheckin | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    plugins.checkins
      .get(PLUGIN_ID, id)
      .then(setRow)
      .catch((err) => {
        if (String(err.message).includes('404') || String(err.message).includes('not found')) {
          setNotFound(true);
        } else {
          setError(err instanceof Error ? err.message : 'Failed to load');
        }
      });
  }, [id]);

  if (notFound) {
    return (
      <div className="py-16 text-center text-sm text-gray-500 dark:text-gray-400">Dive not found.</div>
    );
  }

  if (error) {
    return <div className="py-16 text-center text-sm text-red-600 dark:text-red-400">{error}</div>;
  }

  if (!row) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }

  const d = (row.data ?? {}) as Record<string, unknown>;
  const txt = (key: string): unknown => (typeof d[key] === 'string' && d[key] ? d[key] : null);
  const num = (key: string): number | null => (typeof d[key] === 'number' ? d[key] : null);
  const bool = (key: string): unknown => (d[key] === true ? 'Yes' : null);

  const site = [txt('place'), txt('city')].filter(Boolean).join(', ');

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        to="/"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400"
      >
        <ArrowLeft size={16} />
        Back to timeline
      </Link>

      <div className="mt-4 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white/60 dark:bg-gray-900/60 p-6">
        <div className="flex items-center gap-3">
          <Waves size={22} className="text-cyan-600 dark:text-cyan-400 shrink-0" />
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 truncate">
              {site || 'Dive'}
            </h1>
            <div className="text-sm text-gray-500 dark:text-gray-400">
              {formatDate(row.checked_in_at, row.checkin_timezone)} · {formatTime(row.checked_in_at, row.checkin_timezone)}
              {txt('entry_time') ? ` · dive start ${txt('entry_time')}` : ''}
              {txt('country') ? ` · ${txt('country')}` : ''}
            </div>
          </div>
          <Link
            to={`/scuba-dive?edit=${row.id}`}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 hover:border-primary-400 shrink-0"
          >
            <Pencil size={14} />
            Edit
          </Link>
        </div>

        <div className="mt-6 space-y-6">
          <Section
            title="Dive"
            rows={[
              ['Max depth', formatDepth(num('depth'), unit)],
              ['Average depth', formatDepth(num('depth_avg'), unit)],
              ['Bottom time', num('bottom_time') != null ? `${num('bottom_time')} min` : null],
              ['Water', txt('water_type')],
              ['Entry', txt('entry_method')],
              ['Dive types', txt('divetype')],
              ['Buddy', txt('buddy')],
              ['Divemaster', txt('divemaster')],
              ['Boat', txt('boat_name')],
              ['Rating', num('rating') ? `${num('rating')} / 5` : null],
              ['Repetitive dive', bool('repetitive')],
            ]}
          />
          <Section
            title="Conditions"
            rows={[
              ['Weather', txt('weather')],
              ['Surface', txt('surface_conditions')],
              ['Underwater current', txt('uw_current')],
              ['Visibility (0–3)', num('visibility')],
              ['Horizontal visibility', txt('vis_hor')],
              ['Vertical visibility', txt('vis_ver')],
              ['Air temp', formatTemp(num('air_temp'), unit)],
              ['Water temp', formatTemp(num('water_temp'), unit)],
              ['Altitude', txt('altitude')],
              ['Surface interval', txt('surface_interval')],
            ]}
          />
          <Section
            title="Equipment & Gas"
            rows={[
              ['Tank type', txt('tank_type')],
              ['Tank size', num('tank_size')],
              ['Gas', txt('gas')],
              ['O₂', num('o2') != null ? `${num('o2')} %` : null],
              ['He', num('he') != null ? `${num('he')} %` : null],
              ['Start pressure', formatPressure(num('start_pressure'), unit)],
              ['End pressure', formatPressure(num('end_pressure'), unit)],
              ['Weighted pressure', formatPressure(num('weight_pressure'), unit)],
              ['Min pPO₂', formatPressure(num('min_ppo2'), unit)],
              ['Max pPO₂', formatPressure(num('max_ppo2'), unit)],
              ['Supply type', txt('supply_type')],
              ['Doubles', bool('dbl_tank')],
              ['Weight belt', formatWeight(num('weight'), unit)],
              ['Divesuit', txt('divesuit')],
              ['Computer', txt('computer')],
              ['Used equipment', txt('used_equip')],
            ]}
          />
          <Section
            title="Deco & Trip"
            rows={[
              ['Decompression dive', bool('deco')],
              ['Deco stops', txt('deco_stops')],
              ['Desaturation time', num('desaturation_time') != null ? `${num('desaturation_time')} min` : null],
              ['No-fly time', num('no_fly_time') != null ? `${num('no_fly_time')} min` : null],
              ['Scrubber time', num('scrubber_time') != null ? `${num('scrubber_time')} min` : null],
              ['CNS', txt('cns')],
              ['Pressure group (start)', txt('pg_start')],
              ['Pressure group (end)', txt('pg_end')],
              ['Shop / operator', txt('shop')],
              ['Trip', txt('trip')],
            ]}
          />
          {d.comments != null && (
            <section>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">Comments</h2>
              <p className="mt-2 whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-300">{String(d.comments)}</p>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

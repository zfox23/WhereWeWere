import { useState } from 'react';
import { Link } from 'react-router-dom';
import { FerrisWheel, Loader2, RefreshCw, ChevronDown, ChevronUp, ExternalLink, AlertCircle } from 'lucide-react';
import { venues } from '../../../client/src/api/client';
import type { VenueCoasterpedia } from '../../../client/src/types';
import type { DistanceUnit } from './geo';
import { enteredMeasurement, formatEdtf, formatMeasurement, humanize, youtubeUrl } from './coasterpediaFormat';

interface Props {
  venueId: string;
  coasterpedia: VenueCoasterpedia;
  distanceUnit: DistanceUnit;
  /** Called after a refresh/select so the page re-fetches the venue. */
  onChanged: () => void | Promise<void>;
}

const CARD = 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4 space-y-3';

function Fact({ label, value, title }: { label: string; value: React.ReactNode; title?: string }) {
  if (value == null || value === '') return null;
  return (
    <div title={title}>
      <dt className="text-xs text-gray-500 dark:text-gray-400">{label}</dt>
      <dd className="text-sm text-gray-900 dark:text-gray-100">{value}</dd>
    </div>
  );
}

const names = (refs?: { name: string }[]) => (refs && refs.length ? refs.map((r) => r.name).join(', ') : null);

export default function CoasterpediaCard({ venueId, coasterpedia: cp, distanceUnit, onChanged }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [manual, setManual] = useState('');

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setBusy(false);
    }
  };

  const header = (
    <div className="flex items-center justify-between gap-2">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
        <FerrisWheel size={18} className="text-amber-600 dark:text-amber-400" />
        Coasterpedia
      </h2>
      {cp.has_key && (
        <button
          type="button"
          onClick={() => run(() => venues.coasterpediaRefresh(venueId))}
          disabled={busy}
          className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 disabled:opacity-50"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          Refresh
        </button>
      )}
    </div>
  );

  const errorLine = error && (
    <p className="text-sm text-red-600 flex items-center gap-1"><AlertCircle size={14} />{error}</p>
  );

  const idForm = (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (manual.trim()) run(() => venues.coasterpediaSelect(venueId, manual.trim()));
      }}
    >
      <input
        value={manual}
        onChange={(e) => setManual(e.target.value)}
        placeholder="Coasterpedia attraction ID or URL"
        aria-label="Coasterpedia attraction ID or URL"
        className="flex-1 px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100"
      />
      <button
        type="submit"
        disabled={busy || !manual.trim()}
        className="px-3 py-1.5 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
      >
        Use
      </button>
    </form>
  );

  if (!cp.has_key) {
    return (
      <div className={CARD}>
        {header}
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Add a Coasterpedia API key in <Link to="/settings" className="underline">Settings &rsaquo; Location</Link> to
          look up this ride.
        </p>
      </div>
    );
  }

  const data = cp.data;

  if (!data) {
    return (
      <div className={CARD}>
        {header}
        {cp.status === null && (
          <p className="text-sm text-gray-600 dark:text-gray-400">
            No lookup has run yet. Press Refresh to look this ride up.
          </p>
        )}
        {cp.status === 'error' && (
          <p className="text-sm text-red-600">Lookup failed: {cp.error ?? 'unknown error'}. Press Refresh to retry.</p>
        )}
        {cp.status === 'no_match' && (
          <p className="text-sm text-gray-600 dark:text-gray-400">No Coasterpedia attraction matched this name. Enter its ID or URL:</p>
        )}
        {cp.status === 'ambiguous' && (
          <div className="space-y-2">
            <p className="text-sm text-gray-600 dark:text-gray-400">Several attractions could match. Pick the right one:</p>
            <ul className="space-y-1">
              {(cp.candidates ?? []).map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => run(() => venues.coasterpediaSelect(venueId, c.id))}
                    className="w-full text-left px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 text-sm text-gray-900 dark:text-gray-100"
                  >
                    {c.name}
                    <span className="text-gray-500 dark:text-gray-400">
                      {[c.park?.name, c.country?.name, humanize(c.status)].filter(Boolean).map((p) => ` · ${p}`).join('')}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <p className="text-sm text-gray-600 dark:text-gray-400">Or enter its ID or URL:</p>
          </div>
        )}
        {(cp.status === 'no_match' || cp.status === 'ambiguous' || cp.status === 'error') && idForm}
        {errorLine}
      </div>
    );
  }

  const stats = data.stats ?? {};
  const m = (key: string) => formatMeasurement(stats[key], distanceUnit);
  const tip = (key: string) => enteredMeasurement(stats[key]);
  const loc = data.location ?? {};
  const restrictions = data.restrictions ?? {};
  const coaster = data.coaster ?? {};
  const history = data.history ?? {};
  const products = (data.products ?? [])
    .map((p: { product: { name: string }; variant: string | null }) => (p.variant ? `${p.product.name} (${p.variant})` : p.product.name))
    .join(', ');
  const opened = formatEdtf(data.dates?.opened?.edtf);
  const closed = formatEdtf(data.dates?.closed?.edtf);
  const area = loc.area ? [loc.area.section, loc.area.subsection].filter(Boolean).join(' › ') : null;
  const where = [loc.park?.name ?? null, loc.place, loc.country?.name].filter(Boolean).join(', ');
  const inversions = stats.inversions ? (stats.inversions.track ?? stats.inversions.rider) : null;

  const restrictionRows: [string, string | number | null][] = [
    ['Minimum height', formatMeasurement(restrictions.min_height, distanceUnit)],
    ['Minimum height (unaccompanied)', formatMeasurement(restrictions.min_height_unaccompanied, distanceUnit)],
    ['Maximum height', formatMeasurement(restrictions.max_height, distanceUnit)],
    ['Minimum age', restrictions.min_age ?? null],
    ['Maximum age', restrictions.max_age ?? null],
    ['Minimum weight', formatMeasurement(restrictions.min_weight, distanceUnit)],
    ['Maximum weight', formatMeasurement(restrictions.max_weight, distanceUnit)],
    ['Children only', restrictions.children_only ? 'Yes' : null],
  ];

  return (
    <div className={CARD}>
      {header}

      <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Fact label="Type" value={humanize(data.type)} />
        <Fact label="Status" value={humanize(data.status)} />
        <Fact label="Opened" value={opened} />
        <Fact label="Closed" value={closed} />
        <Fact label="Height" value={m('height')} title={tip('height')} />
        <Fact label="Speed" value={m('speed')} title={tip('speed')} />
        <Fact label="Length" value={m('length')} title={tip('length')} />
        <Fact label="Drop" value={m('drop')} title={tip('drop')} />
        <Fact label="Inversions" value={inversions} />
        <Fact label="Manufacturer" value={names(data.manufacturers)} />
        <Fact label="Model" value={products} />
        <Fact label="Location" value={where} />
        <Fact label="Area" value={area} />
      </dl>

      {expanded && (
        <div className="space-y-4 pt-2 border-t border-gray-200 dark:border-gray-700">
          <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Fact label="Duration" value={formatMeasurement(stats.duration, distanceUnit)} />
            <Fact label="G-force" value={stats.g_force} />
            <Fact label="Max angle" value={stats.max_angle != null ? `${stats.max_angle}°` : null} />
            <Fact label="Designers" value={names(data.designers)} />
            <Fact label="Builders" value={names(data.builders)} />
            <Fact label="Cost" value={data.cost?.text} />
            <Fact label="Track" value={humanize(coaster.track_material)} />
            <Fact label="Supports" value={humanize(coaster.support_material)} />
            <Fact label="Propulsion" value={humanize(coaster.propulsion)} />
            <Fact label="Train manufacturer" value={names(coaster.train_manufacturers)} />
            <Fact label="Restraints" value={data.restraints?.length ? data.restraints.map(humanize).join(', ') : null} />
            <Fact label="Categories" value={data.categories?.length ? data.categories.join(', ') : null} />
            <Fact label="Replaced" value={names(data.replaced)} />
            <Fact label="Replaced by" value={names(data.replaced_by)} />
          </dl>

          {coaster.elements?.length > 0 && (
            <div>
              <h3 className="text-xs text-gray-500 dark:text-gray-400">Elements</h3>
              <p className="text-sm text-gray-900 dark:text-gray-100">{names(coaster.elements)}</p>
            </div>
          )}

          {restrictionRows.some(([, v]) => v != null) && (
            <div>
              <h3 className="text-xs text-gray-500 dark:text-gray-400 mb-1">Rider requirements</h3>
              <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {restrictionRows.map(([label, value]) => <Fact key={label} label={label} value={value} />)}
              </dl>
            </div>
          )}

          {(history.names?.length > 0 || history.locations?.length > 0) && (
            <div>
              <h3 className="text-xs text-gray-500 dark:text-gray-400 mb-1">History</h3>
              <ul className="text-sm text-gray-900 dark:text-gray-100 space-y-0.5">
                {history.names?.map((n: { name: string; start?: { edtf: string } | null; end?: { edtf: string } | null }, i: number) => (
                  <li key={`n${i}`}>
                    Named {n.name}
                    {(n.start || n.end) && ` (${formatEdtf(n.start?.edtf) ?? '?'} – ${formatEdtf(n.end?.edtf) ?? 'present'})`}
                  </li>
                ))}
                {history.locations?.map((l: { park?: { name: string }; place?: string | null; opened?: { edtf: string } | null; closed?: { edtf: string } | null }, i: number) => (
                  <li key={`l${i}`}>
                    Formerly at {[l.park?.name, l.place].filter(Boolean).join(', ') || 'another location'}
                    {(l.opened || l.closed) && ` (${formatEdtf(l.opened?.edtf) ?? '?'} – ${formatEdtf(l.closed?.edtf) ?? '?'})`}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {data.videos?.length > 0 && (
            <div>
              <h3 className="text-xs text-gray-500 dark:text-gray-400 mb-1">Videos</h3>
              <ul className="text-sm space-y-0.5">
                {data.videos.map((id: string, i: number) => (
                  <li key={id}>
                    <a href={youtubeUrl(id)} target="_blank" rel="noreferrer noopener" className="text-primary-600 dark:text-primary-400 hover:underline">
                      Watch on YouTube ({i + 1})
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1 text-sm text-primary-600 dark:text-primary-400 hover:underline"
      >
        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        {expanded ? 'Fewer details' : 'More details'}
      </button>

      {cp.status === 'error' && (
        <p className="text-xs text-red-600">Last refresh failed ({cp.error ?? 'unknown error'}); showing the previous data.</p>
      )}
      {errorLine}

      <p className="text-xs text-gray-500 dark:text-gray-400">
        Data from{' '}
        <a href={data.url} target="_blank" rel="noreferrer noopener" className="underline inline-flex items-center gap-0.5">
          Coasterpedia contributors <ExternalLink size={10} />
        </a>
        , licensed{' '}
        <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer noopener" className="underline">CC BY-SA 4.0</a>.
      </p>
    </div>
  );
}

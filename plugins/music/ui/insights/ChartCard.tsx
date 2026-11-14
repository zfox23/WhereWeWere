import type { ReactNode } from 'react';
import { Loader2 } from 'lucide-react';

/** The Overview's card frame for a chart: icon, title, optional controls, then the body. */
export function ChartCard({
  title,
  icon: Icon,
  controls,
  loading = false,
  children,
}: {
  title: string;
  icon: React.ElementType;
  controls?: ReactNode;
  loading?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      aria-busy={loading}
      className="rounded-2xl border border-white/40 bg-white/60 p-4 shadow-sm shadow-black/3 dark:border-gray-700/40 dark:bg-gray-900/60"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300">
          <Icon size={16} className="text-pink-500" />
          {title}
          {loading && <Loader2 size={14} className="animate-spin text-gray-400" />}
        </h3>
        {controls}
      </div>
      <div className={loading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>{children}</div>
    </section>
  );
}

/** A two-option toggle, like the Library's view switcher but smaller. */
export function Toggle<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`px-2 py-0.5 text-xs font-medium transition-colors ${
            value === o.value
              ? 'bg-primary-600 text-white'
              : 'bg-white/60 text-gray-600 hover:bg-gray-100 dark:bg-gray-900/60 dark:text-gray-300 dark:hover:bg-gray-800'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A small figure: a value and what it is. */
export function MiniStat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <div className="text-lg font-semibold tabular-nums text-gray-900 dark:text-gray-100">{value}</div>
      <div className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</div>
    </div>
  );
}

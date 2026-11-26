/**
 * The waves' "top 8 for this stretch" button: icon only, it re-picks a wave's
 * bands as the most played in the stretch of time in view. The result lasts
 * until it is pressed again (or the page is left); nothing is saved.
 */

import { useState } from 'react';
import { ListRestart, Loader2 } from 'lucide-react';

export interface ViewRange {
  from: string;
  to: string;
}

const day = (date: string) =>
  new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));

/** "Mar 1, 2021 – Jun 30, 2022". */
export const rangeLabel = (r: ViewRange) => (r.from === r.to ? day(r.from) : `${day(r.from)} – ${day(r.to)}`);

/**
 * Re-picks the bands for `range`, the stretch in view. `run` fetches and
 * applies them; a failure leaves the bands as they were and says so.
 */
export function RerankButton({ range, run }: { range: ViewRange | null; run: (range: ViewRange) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const label = range ? `Show the top 8 for ${rangeLabel(range)}` : 'Show the top 8 for the stretch in view';

  const press = async () => {
    if (!range || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      await run(range);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void press()}
      disabled={!range || busy}
      aria-label={failed ? `${label} (the last try failed)` : label}
      title={failed ? "Couldn't load the top 8; try again" : label}
      className={`rounded-lg p-1.5 transition-colors hover:bg-pink-50 hover:text-pink-600 disabled:opacity-40 disabled:hover:bg-transparent dark:hover:bg-pink-900/20 ${
        failed ? 'text-red-500' : 'text-gray-400'
      }`}
    >
      {busy ? <Loader2 size={15} className="animate-spin" /> : <ListRestart size={15} />}
    </button>
  );
}

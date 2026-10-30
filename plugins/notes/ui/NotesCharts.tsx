/**
 * Profile > Notes charts: tag breakdown, tag usage over time (one small
 * multiple per tag, sharing a scale), the writing-rhythm heatmap, and the
 * theme insights from the similarity analysis.
 */

import { useMemo } from 'react';
import { CalendarClock, Layers, Shapes, Tags } from 'lucide-react';
import { OVERFLOW_COLOR } from '../manifest';
import type { NoteStats, NoteTag } from './api';
import { HeatGrid, Panel, useTooltip } from './charts';
import { TagChip, TagDot, tagTimelinePath } from './TagChip';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MAX_TAG_ROWS = 8;

function plural(n: number, one: string, many = `${one}s`) {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

function monthLabel(ym: string) {
  return `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
}

/** Every YYYY-MM from `first` to `last`, inclusive. */
function monthRange(first: string, last: string): string[] {
  const out: string[] = [];
  let y = Number(first.slice(0, 4));
  let m = Number(first.slice(5, 7));
  const end = Number(last.slice(0, 4)) * 12 + Number(last.slice(5, 7));
  while (y * 12 + m <= end && out.length < 600) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Tag breakdown
// ---------------------------------------------------------------------------

export function TagBreakdown({ stats }: { stats: NoteStats }) {
  const { ref, show, hide, layer } = useTooltip();
  const rows = stats.by_tag;
  const max = Math.max(1, ...rows.map((r) => r.notes));
  return (
    <Panel
      title="Tags"
      icon={<Tags size={16} className="text-amber-500" />}
      subtitle="Notes per tag. A note with two tags counts under both."
    >
      {rows.length === 0 ? (
        <p className="text-sm text-gray-400">No tagged notes in this period.</p>
      ) : (
        <div ref={ref} className="relative space-y-1.5" onMouseLeave={hide}>
          {rows.map((r) => {
            const tip = (
              <span>
                <strong>{r.name}</strong> · {plural(r.notes, 'note')} · {plural(r.words, 'word')} · avg {r.avg_words.toLocaleString()} words
              </span>
            );
            return (
              <div
                key={r.id}
                className="grid grid-cols-[minmax(6rem,10rem)_1fr_auto] items-center gap-2"
                onMouseMove={(e) => show(e, tip)}
              >
                <TagChip tag={r} to={tagTimelinePath(r.name)} />
                <div className="h-4 rounded-r bg-transparent">
                  <div className="h-full rounded-r-[4px]" style={{ width: `${(r.notes / max) * 100}%`, minWidth: 3, backgroundColor: r.color }} />
                </div>
                <span className="text-xs text-gray-600 dark:text-gray-300 tabular-nums text-right whitespace-nowrap">
                  {r.notes.toLocaleString()}
                  <span className="text-gray-400"> · {r.avg_words.toLocaleString()} w avg</span>
                </span>
              </div>
            );
          })}
          {stats.totals.untagged > 0 && (
            <p className="pt-1 text-xs text-gray-400">{plural(stats.totals.untagged, 'untagged note')}</p>
          )}
          {layer}
        </div>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Tag usage over time (small multiples)
// ---------------------------------------------------------------------------

export function TagUsage({ stats, tags }: { stats: NoteStats; tags: NoteTag[] }) {
  const { ref, show, hide, layer } = useTooltip();
  const model = useMemo(() => {
    const data = stats.tag_months;
    if (data.length === 0) return null;
    const months = monthRange(data[0].month, data[data.length - 1].month);
    const ranked = stats.by_tag.map((t) => t.id);
    const shown = new Set(ranked.slice(0, MAX_TAG_ROWS));
    const byTag = new Map(tags.map((t) => [t.id, t]));
    const counts = new Map<string, Map<string, number>>();
    const add = (row: string, month: string, n: number) => {
      if (!counts.has(row)) counts.set(row, new Map());
      const m = counts.get(row)!;
      m.set(month, (m.get(month) ?? 0) + n);
    };
    for (const d of data) {
      const row = d.tag_id == null ? 'untagged' : shown.has(d.tag_id) ? d.tag_id : 'other';
      add(row, d.month, d.notes);
    }
    const rows: { key: string; label: string; color: string; tag?: NoteTag }[] = ranked
      .filter((id) => shown.has(id) && byTag.has(id))
      .map((id) => ({ key: id, label: byTag.get(id)!.name, color: byTag.get(id)!.color, tag: byTag.get(id) }));
    if (counts.has('other')) rows.push({ key: 'other', label: 'Other tags', color: OVERFLOW_COLOR });
    if (counts.has('untagged')) rows.push({ key: 'untagged', label: 'Untagged', color: OVERFLOW_COLOR });
    let max = 1;
    for (const m of counts.values()) for (const v of m.values()) max = Math.max(max, v);
    return { months, rows, counts, max };
  }, [stats, tags]);

  return (
    <Panel
      title="Tags over time"
      icon={<CalendarClock size={16} className="text-amber-500" />}
      subtitle="Notes per month, one row per tag, all on the same scale."
    >
      {!model ? (
        <p className="text-sm text-gray-400">No notes in this period.</p>
      ) : (
        <div ref={ref} className="relative space-y-1" onMouseLeave={hide}>
          {model.rows.map((row) => (
            <div key={row.key} className="grid grid-cols-[minmax(6rem,10rem)_1fr] items-end gap-2">
              <span className="truncate pb-0.5">
                {row.tag ? <TagChip tag={row.tag} /> : <span className="text-[11px] text-gray-500 dark:text-gray-400">{row.label}</span>}
              </span>
              <div className="flex h-8 items-end gap-px border-b border-gray-200 dark:border-gray-700">
                {model.months.map((month) => {
                  const v = model.counts.get(row.key)?.get(month) ?? 0;
                  const tip = <span><strong>{row.label}</strong> · {monthLabel(month)} · {plural(v, 'note')}</span>;
                  return (
                    <div key={month} className="flex h-full flex-1 items-end" onMouseMove={(e) => show(e, tip)}>
                      {v > 0 && (
                        <div
                          className="w-full rounded-t-[2px]"
                          style={{ height: `${Math.max(8, (v / model.max) * 100)}%`, backgroundColor: row.color }}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          <div className="grid grid-cols-[minmax(6rem,10rem)_1fr] gap-2 text-[10px] text-gray-400 tabular-nums">
            <span />
            <div className="flex justify-between">
              <span>{monthLabel(model.months[0])}</span>
              {model.months.length > 1 && <span>{monthLabel(model.months[model.months.length - 1])}</span>}
            </div>
          </div>
          {layer}
        </div>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Writing rhythm
// ---------------------------------------------------------------------------

function hourLabel(h: number) {
  if (h === 0) return '12a';
  if (h === 12) return '12p';
  return h < 12 ? `${h}a` : `${h - 12}p`;
}

export function WritingRhythm({ stats }: { stats: NoteStats }) {
  const lookup = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of stats.rhythm) m.set(`${r.dow}|${r.hour}`, r.notes);
    return m;
  }, [stats]);
  const busiest = useMemo(() => {
    const top = [...stats.rhythm].sort((a, b) => b.notes - a.notes)[0];
    return top ? `${DAYS[top.dow - 1]}s around ${hourLabel(top.hour)}` : null;
  }, [stats]);

  return (
    <Panel
      title="Writing rhythm"
      icon={<CalendarClock size={16} className="text-blue-500" />}
      subtitle={<>When you write, in each note’s own time zone.{busiest && <> Most often: <strong className="text-gray-600 dark:text-gray-300">{busiest}</strong>.</>}</>}
    >
      {stats.rhythm.length === 0 ? (
        <p className="text-sm text-gray-400">No notes in this period.</p>
      ) : (
        <HeatGrid
          rows={DAYS.map((d, i) => ({ key: String(i + 1), label: d }))}
          cols={Array.from({ length: 24 }, (_, h) => ({ key: String(h), label: hourLabel(h), show: h % 3 === 0 }))}
          value={(r, c) => lookup.get(`${r}|${c}`) ?? 0}
          describe={(r, c, v) => `${DAYS[Number(r) - 1]} ${hourLabel(Number(c))}–${hourLabel((Number(c) + 1) % 24)}: ${plural(v, 'note')}`}
          unit="notes"
        />
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Theme insights
// ---------------------------------------------------------------------------

export function ThemeInsights({ stats, tags }: { stats: NoteStats; tags: NoteTag[] }) {
  const { ref, show, hide, layer } = useTooltip();
  const themes = stats.themes;
  const max = Math.max(1, ...themes.map((t) => t.notes));
  const years = useMemo(() => [...new Set(stats.theme_years.map((r) => r.year))].sort((a, b) => a - b), [stats]);
  const yearLookup = useMemo(() => new Map(stats.theme_years.map((r) => [`${r.theme_id}|${r.year}`, r.notes])), [stats]);
  const tagLookup = useMemo(() => new Map(stats.theme_tags.map((r) => [`${r.theme_id}|${r.tag_id}`, r.notes])), [stats]);
  const usedTags = useMemo(() => {
    const ids = new Set(stats.theme_tags.map((r) => r.tag_id));
    return stats.by_tag.filter((t) => ids.has(t.id)).slice(0, 10);
  }, [stats]);
  const themeName = (id: string) => themes.find((t) => t.id === id)?.label ?? 'Theme';
  const themeRow = (t: (typeof themes)[number]) => ({
    key: t.id,
    label: <span className="inline-flex items-center gap-1.5"><TagDot color={t.color} />{t.label}</span>,
  });

  if (themes.length === 0) {
    return (
      <Panel title="Themes" icon={<Shapes size={16} className="text-violet-500" />}>
        <p className="text-sm text-gray-400">
          Run the similarity analysis above to group your notes into themes, see how they shift over the years,
          and how they line up with your tags.
        </p>
      </Panel>
    );
  }

  return (
    <div className="space-y-6">
      <Panel
        title="Themes"
        icon={<Shapes size={16} className="text-violet-500" />}
        subtitle="Groups of similar notes found by the analysis, named by your LLM."
      >
        <div ref={ref} className="relative space-y-2" onMouseLeave={hide}>
          {themes.map((t) => (
            <div key={t.id} onMouseMove={(e) => show(e, <span><strong>{t.label}</strong> · {plural(t.notes, 'note')}</span>)}>
              <div className="grid grid-cols-[minmax(7rem,12rem)_1fr_auto] items-center gap-2">
                <span className="inline-flex items-center gap-1.5 truncate text-xs font-medium text-gray-800 dark:text-gray-100">
                  <TagDot color={t.color} /> {t.label}
                </span>
                <div className="h-4">
                  <div className="h-full rounded-r-[4px]" style={{ width: `${(t.notes / max) * 100}%`, minWidth: 3, backgroundColor: t.color }} />
                </div>
                <span className="text-xs text-gray-600 dark:text-gray-300 tabular-nums">{t.notes.toLocaleString()}</span>
              </div>
              {t.description && <p className="ml-4 text-[11px] text-gray-400">{t.description}</p>}
            </div>
          ))}
          {layer}
        </div>
      </Panel>

      {years.length > 1 && (
        <Panel
          title="Themes over the years"
          icon={<CalendarClock size={16} className="text-violet-500" />}
          subtitle="Notes per theme and year."
        >
          <HeatGrid
            rows={themes.map(themeRow)}
            cols={years.map((y) => ({ key: String(y), label: `’${String(y).slice(2)}` }))}
            value={(r, c) => yearLookup.get(`${r}|${c}`) ?? 0}
            describe={(r, c, v) => `${themeName(r)} · ${c}: ${plural(v, 'note')}`}
            unit="notes"
            showValues
            cellMinWidth={26}
          />
        </Panel>
      )}

      {usedTags.length > 0 && (
        <Panel
          title="Themes × tags"
          icon={<Layers size={16} className="text-violet-500" />}
          subtitle="How the themes the analysis found line up with the tags you chose."
        >
          <HeatGrid
            rows={themes.map(themeRow)}
            cols={usedTags.map((t) => ({ key: t.id, label: t.name.length > 10 ? `${t.name.slice(0, 9)}…` : t.name }))}
            value={(r, c) => tagLookup.get(`${r}|${c}`) ?? 0}
            describe={(r, c, v) => `${themeName(r)} × ${tags.find((t) => t.id === c)?.name ?? 'tag'}: ${plural(v, 'note')}`}
            unit="notes"
            showValues
            cellMinWidth={52}
          />
        </Panel>
      )}
    </div>
  );
}

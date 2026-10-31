/**
 * Similarity Web: notes as dots, linked when the analysis found them
 * similar enough (threshold slider). Dots are colored by theme or by tag;
 * theme names float over their clusters. Clicking a dot opens the note in
 * the reading pane. Lazy-loaded (react-force-graph-2d is canvas + d3).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ForceGraph2D, { type ForceGraphMethods, type LinkObject, type NodeObject } from 'react-force-graph-2d';
import { useTheme } from '../../../../client/src/contexts/ThemeContext';
import { OVERFLOW_COLOR } from '../../manifest';
import type { NoteGraph } from '../api';
import { noteHeading } from '../RelatedNotes';
import { TagDot } from '../TagChip';

type ColorBy = 'theme' | 'tag';

interface WebNode {
  id: string;
  label: string;
  date: string;
  mood: boolean;
  themeId: string | null;
  tagIds: string[];
  size: number;
}

interface WebLink {
  source: string;
  target: string;
  similarity: number;
}

interface SimilarityWebProps {
  graph: NoteGraph;
  selectedId: string | null;
  onSelect: (id: string) => void;
  defaultThreshold?: number;
}

export default function SimilarityWeb({ graph, selectedId, onSelect, defaultThreshold = 0.6 }: SimilarityWebProps) {
  const { resolvedTheme } = useTheme();
  const navigate = useNavigate();
  const dark = resolvedTheme === 'dark';
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fgRef = useRef<ForceGraphMethods<NodeObject<WebNode>, LinkObject<WebNode, WebLink>> | undefined>(undefined);
  const [width, setWidth] = useState(600);
  const [colorBy, setColorBy] = useState<ColorBy>('theme');
  const [threshold, setThreshold] = useState(defaultThreshold);
  const [hoverId, setHoverId] = useState<string | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    setWidth(el.clientWidth);
    return () => observer.disconnect();
  }, []);

  const themeById = useMemo(() => new Map(graph.themes.map((t) => [t.id, t])), [graph.themes]);
  const tagById = useMemo(() => new Map(graph.tags.map((t) => [t.id, t])), [graph.tags]);
  const minSim = useMemo(() => Math.min(...graph.edges.map((e) => e.similarity), 1), [graph.edges]);

  // New objects only when the data or threshold change: the simulation keeps
  // node positions on the objects it's given.
  const data = useMemo(() => {
    const nodes: WebNode[] = graph.nodes.map((n) => ({
      id: n.id,
      label: noteHeading(n.title, n.excerpt),
      date: n.local_date,
      mood: n.kind === 'mood',
      themeId: n.theme_id,
      tagIds: n.tag_ids,
      size: 2 + Math.min(4, Math.sqrt(n.word_count) / 10),
    }));
    const links: WebLink[] = graph.edges
      .filter((e) => e.similarity >= threshold)
      .map((e) => ({ source: e.source, target: e.target, similarity: e.similarity }));
    return { nodes, links };
  }, [graph, threshold]);

  const neighbors = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const l of data.links) {
      const s = String(typeof l.source === 'object' ? (l.source as { id: string }).id : l.source);
      const t = String(typeof l.target === 'object' ? (l.target as { id: string }).id : l.target);
      if (!m.has(s)) m.set(s, new Set());
      if (!m.has(t)) m.set(t, new Set());
      m.get(s)!.add(t);
      m.get(t)!.add(s);
    }
    return m;
  }, [data]);

  const colorOf = (n: WebNode): string => {
    if (colorBy === 'theme') return (n.themeId && themeById.get(n.themeId)?.color) || OVERFLOW_COLOR;
    const first = n.tagIds.map((id) => tagById.get(id)).find(Boolean);
    return first?.color ?? OVERFLOW_COLOR;
  };

  const focusId = hoverId ?? selectedId;
  const focusSet = focusId ? neighbors.get(focusId) ?? new Set<string>() : null;
  const ink = dark ? '#f0efec' : '#0b0b0b';
  const surface = dark ? '#111827' : '#ffffff';

  useEffect(() => {
    if (!selectedId || !fgRef.current) return;
    const node = data.nodes.find((n) => n.id === selectedId) as NodeObject<WebNode> | undefined;
    if (node && node.x != null && node.y != null) fgRef.current.centerAt(node.x, node.y, 600);
  }, [selectedId, data.nodes]);

  const legend = colorBy === 'theme'
    ? graph.themes.map((t) => ({ id: t.id, name: t.label, color: t.color }))
    : graph.tags.map((t) => ({ id: t.id, name: t.name, color: t.color }));

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <div className="inline-flex rounded-lg border border-gray-300 dark:border-gray-600 p-0.5" role="radiogroup" aria-label="Color by">
          {(['theme', 'tag'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={colorBy === m}
              onClick={() => setColorBy(m)}
              className={`rounded-md px-2.5 py-1 font-medium ${colorBy === m ? 'bg-primary-600 text-white' : 'text-gray-600 dark:text-gray-300'}`}
            >
              {m === 'theme' ? 'Color by theme' : 'Color by tag'}
            </button>
          ))}
        </div>
        <label className="inline-flex items-center gap-2 text-gray-600 dark:text-gray-300">
          Links at ≥
          <input
            type="range"
            min={Math.floor(minSim * 100) / 100}
            max={0.95}
            step={0.01}
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
            aria-label="Similarity threshold"
          />
          <span className="tabular-nums w-8">{Math.round(threshold * 100)}%</span>
        </label>
        <span className="text-gray-400 tabular-nums">{data.links.length.toLocaleString()} links</span>
      </div>

      <div ref={containerRef} className="relative overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
        <ForceGraph2D<WebNode, WebLink>
          ref={fgRef}
          width={width}
          height={Math.min(560, Math.max(360, width * 0.7))}
          graphData={data}
          backgroundColor={surface}
          nodeId="id"
          nodeLabel={(n) => `${n.label} · ${n.date}`}
          nodeVal={(n) => n.size}
          nodeRelSize={3}
          cooldownTicks={200}
          // Mood check-ins have no reading pane: open their own page.
          onNodeClick={(n) => (n.mood ? navigate(`/mood-checkins/${n.id}`) : onSelect(String(n.id)))}
          onNodeHover={(n) => setHoverId(n ? String(n.id) : null)}
          linkColor={(l) => {
            const s = String((l.source as NodeObject<WebNode>)?.id ?? l.source);
            const t = String((l.target as NodeObject<WebNode>)?.id ?? l.target);
            const lit = focusId && (s === focusId || t === focusId);
            const alpha = lit ? 0.75 : focusId ? 0.06 : 0.12 + (l.similarity - threshold) * 0.8;
            return dark ? `rgba(240,239,236,${alpha})` : `rgba(11,11,11,${alpha})`;
          }}
          linkWidth={(l) => {
            const s = String((l.source as NodeObject<WebNode>)?.id ?? l.source);
            const t = String((l.target as NodeObject<WebNode>)?.id ?? l.target);
            return focusId && (s === focusId || t === focusId) ? 2 : 1;
          }}
          nodeCanvasObject={(n, ctx, scale) => {
            const r = Math.sqrt(n.size) * 3;
            const dim = focusId && n.id !== focusId && !focusSet?.has(String(n.id));
            ctx.globalAlpha = dim ? 0.25 : 1;
            ctx.beginPath();
            // Mood check-ins are squares, notes are dots.
            if (n.mood) ctx.rect((n.x ?? 0) - r, (n.y ?? 0) - r, 2 * r, 2 * r);
            else ctx.arc(n.x ?? 0, n.y ?? 0, r, 0, 2 * Math.PI);
            ctx.fillStyle = colorOf(n);
            ctx.fill();
            // A surface ring keeps overlapping dots apart; the selected one gets an ink ring.
            ctx.lineWidth = (n.id === selectedId ? 2.5 : 1.25) / scale;
            ctx.strokeStyle = n.id === selectedId ? ink : surface;
            ctx.stroke();
            if (n.id === focusId || (focusSet?.has(String(n.id)) && scale > 1.5) || scale > 3) {
              ctx.font = `${11 / scale}px sans-serif`;
              ctx.fillStyle = ink;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'top';
              ctx.fillText(n.label, n.x ?? 0, (n.y ?? 0) + r + 2 / scale);
            }
            ctx.globalAlpha = 1;
          }}
          nodePointerAreaPaint={(n, color, ctx) => {
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(n.x ?? 0, n.y ?? 0, Math.sqrt(n.size) * 3 + 4, 0, 2 * Math.PI);
            ctx.fill();
          }}
          onRenderFramePost={(ctx, scale) => {
            if (colorBy !== 'theme') return;
            // Theme names at the center of their notes.
            const sums = new Map<string, { x: number; y: number; n: number }>();
            for (const node of data.nodes as NodeObject<WebNode>[]) {
              if (!node.themeId || node.x == null || node.y == null) continue;
              const s = sums.get(node.themeId) ?? { x: 0, y: 0, n: 0 };
              s.x += node.x;
              s.y += node.y;
              s.n++;
              sums.set(node.themeId, s);
            }
            ctx.font = `600 ${13 / scale}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            for (const [id, s] of sums) {
              const theme = themeById.get(id);
              if (!theme || s.n < 2) continue;
              const x = s.x / s.n;
              const y = s.y / s.n;
              ctx.lineWidth = 4 / scale;
              ctx.strokeStyle = surface;
              ctx.strokeText(theme.label, x, y);
              ctx.fillStyle = ink;
              ctx.fillText(theme.label, x, y);
            }
          }}
        />
      </div>

      {legend.length > 0 && (
        <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-gray-600 dark:text-gray-300" aria-label="Legend">
          {legend.map((l) => (
            <li key={l.id} className="inline-flex items-center gap-1"><TagDot color={l.color} />{l.name}</li>
          ))}
          <li className="inline-flex items-center gap-1 text-gray-400"><TagDot color={OVERFLOW_COLOR} />{colorBy === 'theme' ? 'Other / no theme' : 'Untagged'}</li>
          {data.nodes.some((n) => n.mood) && <li className="text-gray-400">Squares are mood check-ins</li>}
        </ul>
      )}
    </div>
  );
}

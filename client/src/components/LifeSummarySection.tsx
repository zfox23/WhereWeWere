import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Sparkles, Loader2, Lock, LockOpen, Shuffle, AlertCircle, Image, ImageOff } from 'lucide-react';
import { llm as llmApi, immich as immichApi } from '../api/client';

interface CandidateImage {
  id: string;
  thumbhash: string | null;
  originalFileName: string;
  localDateTime: string;
}

interface LlmConfig {
  configured: boolean;
  imageSupport: boolean;
}

interface SkippedEntry {
  type: string;
  total: number;
  included: number;
}

interface LifeSummaryResult {
  summary: string;
  images_included: number;
  images_skipped: number;
  skipped: SkippedEntry[];
}

const MIN_IMAGES = 3;
const MAX_IMAGES = 10;
const DEFAULT_IMAGE_COUNT = 6;

function localDateIso(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Pick N evenly-spaced indices from an array of length len.
function evenIndices(len: number, n: number): number[] {
  if (len <= 0) return [];
  const count = Math.max(0, Math.min(n, len));
  if (count === 0) return [];
  if (count === 1) return [Math.floor(len / 2)];
  const indices: number[] = [];
  for (let i = 0; i < count; i++) {
    indices.push(Math.round((i * (len - 1)) / (count - 1)));
  }
  // Dedupe while preserving order (rounding can collapse adjacent picks).
  const seen = new Set<number>();
  return indices.filter((idx) => !seen.has(idx) && seen.add(idx));
}

function pickRandom<T>(arr: T[], n: number): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

export function LifeSummarySection({ llmConfig }: { llmConfig: LlmConfig }) {
  const [from, setFrom] = useState(localDateIso(-365));
  const [to, setTo] = useState(localDateIso(0));
  const [candidates, setCandidates] = useState<CandidateImage[]>([]);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [locked, setLocked] = useState<Set<string>>(new Set());
  const [summarizing, setSummarizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LifeSummaryResult | null>(null);
  // Photos are opt-in: text data is always prioritized over images.
  const [includeImages, setIncludeImages] = useState(false);

  const rangeValid = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to;
  const rangeKey = `${from}|${to}`;
  const imageSelectionActive = llmConfig.imageSupport && llmConfig.configured && includeImages;

  // Fetch candidates and (re)initialize selection whenever the range changes
  // (or photos are turned on).
  useEffect(() => {
    let cancelled = false;
    if (!rangeValid || !imageSelectionActive) {
      setCandidates([]);
      setCandidatesLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setCandidatesLoading(true);
    llmApi
      .candidateImages(from, to)
      .then((data) => {
        if (cancelled) return;
        const assets = data.assets || [];
        setCandidates(assets);

        // Auto-select N evenly-spaced images for this range (resets on range change).
        setSelected(evenIndices(assets.length, DEFAULT_IMAGE_COUNT).map((i) => assets[i].id));
        setLocked(new Set());
        setResult(null);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setCandidates([]);
        console.error('Failed to fetch candidate images:', err);
      })
      .finally(() => {
        if (!cancelled) setCandidatesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [from, to, rangeValid, rangeKey, imageSelectionActive]);

  const handleToggleLock = (id: string) => {
    const isSelected = selected.includes(id);
    const isLocked = locked.has(id);

    // Ignore a lock attempt for an unselected image when the selection is full.
    if (!isLocked && !isSelected && selected.length >= MAX_IMAGES) {
      return;
    }

    setLocked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        setSelected((sel) =>
          sel.includes(id) && sel.length > MIN_IMAGES ? sel.filter((s) => s !== id) : sel
        );
      } else {
        next.add(id);
        setSelected((sel) =>
          !sel.includes(id) && sel.length < MAX_IMAGES ? [...sel, id] : sel
        );
      }
      return next;
    });
    setError(null);
  };

  const handleShuffle = () => {
    const lockedIds = candidates.filter((c) => locked.has(c.id)).map((c) => c.id);
    const targetCount = Math.max(MIN_IMAGES, Math.min(MAX_IMAGES, selected.length));
    const slotsNeeded = Math.max(0, targetCount - lockedIds.length);

    // Replace all unlocked selections with images that aren't currently
    // selected, so the shuffle actually brings in new photos from the period.
    const freshPool = candidates.filter((c) => !locked.has(c.id) && !selected.includes(c.id));
    const freshPicks = pickRandom(freshPool, slotsNeeded).map((c) => c.id);

    // Fall back to previously selected unlocked images only when the period
    // doesn't have enough fresh candidates to fill the slots.
    const remaining = slotsNeeded - freshPicks.length;
    const stalePicks =
      remaining > 0
        ? pickRandom(
            candidates.filter((c) => !locked.has(c.id) && selected.includes(c.id)),
            remaining
          ).map((c) => c.id)
        : [];

    setSelected([...lockedIds, ...freshPicks, ...stalePicks]);
    setError(null);
  };

  const handleSummarize = async () => {
    setSummarizing(true);
    setError(null);
    setResult(null);
    try {
      const data = await llmApi.summarize(from, to, imageSelectionActive ? selected : []);
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate summary.');
    } finally {
      setSummarizing(false);
    }
  };

  return (
    <div className="bg-white/60 dark:bg-gray-900/60 rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
          <Sparkles size={16} className="text-purple-500" />
          Life Summary
        </h3>
        {result && (
          <button
            onClick={() => setResult(null)}
            className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {!llmConfig.configured ? (
        <p className="text-sm text-gray-400">
          Configure an LLM in <span className="font-medium">Settings → Integrations → Life Summary (LLM)</span> to
          generate AI summaries of your life.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Start date</label>
              <input
                type="date"
                value={from}
                max={to || undefined}
                onChange={(e) => setFrom(e.target.value)}
                className="input"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">End date</label>
              <input
                type="date"
                value={to}
                min={from || undefined}
                onChange={(e) => setTo(e.target.value)}
                className="input"
              />
            </div>
            <button
              onClick={handleSummarize}
              disabled={summarizing || !rangeValid}
              className="btn-primary"
            >
              {summarizing ? <Loader2 size={16} className="animate-spin mr-2" /> : <Sparkles size={16} className="mr-2" />}
              {summarizing ? 'Summarizing…' : 'Summarize'}
            </button>
            {llmConfig.imageSupport && (
              <button
                onClick={() => setIncludeImages((v) => !v)}
                disabled={summarizing}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  includeImages
                    ? 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 border border-purple-300 dark:border-purple-700'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 border border-transparent'
                }`}
                title="Include Immich photos from this period in the LLM request"
              >
                {includeImages ? <Image size={14} /> : <ImageOff size={14} />}
                {includeImages ? 'Photos included' : 'Include photos'}
              </button>
            )}
          </div>

          {imageSelectionActive && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {candidatesLoading
                    ? 'Loading photos…'
                    : candidates.length === 0
                      ? 'No Immich photos found in this period.'
                      : `${selected.length} of ${candidates.length} photo${candidates.length === 1 ? '' : 's'} selected (3–${MAX_IMAGES}). Lock photos you want to keep, then shuffle the rest.`}
                </p>
                <button
                  onClick={handleShuffle}
                  disabled={candidatesLoading || candidates.length === 0}
                  className="flex items-center gap-1 rounded-lg bg-gray-100 dark:bg-gray-800 px-2.5 py-1.5 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Shuffle size={13} />
                  Shuffle
                </button>
              </div>

              {candidatesLoading ? (
                <div className="flex items-center gap-2 text-xs text-gray-400 py-2">
                  <Loader2 className="animate-spin" size={14} />
                  Fetching photos…
                </div>
              ) : candidates.length > 0 ? (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {[...candidates]
                    .sort((a, b) => {
                      const aSel = selected.includes(a.id) ? 0 : 1;
                      const bSel = selected.includes(b.id) ? 0 : 1;
                      return aSel - bSel;
                    })
                    .map((asset) => {
                    const isSelected = selected.includes(asset.id);
                    const isLocked = locked.has(asset.id);
                    return (
                      <div key={asset.id} className="relative shrink-0 group">
                        <img
                          src={immichApi.thumbnailUrl(asset.id)}
                          alt={asset.originalFileName}
                          title={`${asset.originalFileName} — ${asset.localDateTime}`}
                          className="w-[72px] h-[72px] object-cover rounded-lg border-2 transition-all cursor-pointer"
                          style={{
                            borderColor: isSelected
                              ? isLocked
                                ? 'rgb(168 85 247)'
                                : 'rgb(139 92 246)'
                              : 'transparent',
                          }}
                          onClick={() => handleToggleLock(asset.id)}
                        />
                        <button
                          onClick={() => handleToggleLock(asset.id)}
                          title={isLocked ? 'Unlock (shuffles freely)' : 'Lock (keep selected)'}
                          className={`absolute top-1 right-1 p-1 rounded-md backdrop-blur-sm transition-colors ${
                            isLocked
                              ? 'bg-purple-500/80 text-white hover:bg-purple-600/80'
                              : 'bg-black/40 text-white/80 hover:bg-black/60'
                          }`}
                        >
                          {isLocked ? <Lock size={12} /> : <LockOpen size={12} />}
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 text-sm text-red-600">
              <AlertCircle size={16} />
              {error}
            </div>
          )}

          {summarizing && (
            <div className="flex items-center gap-3 text-sm text-gray-500 dark:text-gray-400 py-4">
              <Loader2 className="animate-spin text-primary-600" size={20} />
              <span>Asking the LLM to summarize your life from {from} to {to}. This can take a while…</span>
            </div>
          )}

          {result && !summarizing && (
            <div className="space-y-2">
              {(result.skipped.length > 0 || result.images_included > 0 || result.images_skipped > 0) && (
                <div className="space-y-1">
                  {result.skipped.length > 0 && (
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                      Context limit reached — only a random sample was included:{' '}
                      {result.skipped
                        .map((s) => `${s.included} of ${s.total} ${s.type}`)
                        .join(', ')}
                      .
                    </p>
                  )}
                  {(result.images_included > 0 || result.images_skipped > 0) && (
                    <p className="text-xs text-gray-400">
                      {result.images_included > 0
                        ? `${result.images_included} photo${result.images_included === 1 ? '' : 's'} included.`
                        : ''}
                      {result.images_skipped > 0
                        ? ` ${result.images_skipped} photo${result.images_skipped === 1 ? '' : 's'} skipped (undecodable).`
                        : ''}
                    </p>
                  )}
                </div>
              )}
              <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-p:leading-relaxed prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 text-gray-700 dark:text-gray-300 rounded-xl bg-white/40 dark:bg-gray-800/40 border border-white/40 dark:border-gray-700/40 p-4">
                <ReactMarkdown
                  components={{ a: ({ ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" /> }}
                >
                  {result.summary}
                </ReactMarkdown>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

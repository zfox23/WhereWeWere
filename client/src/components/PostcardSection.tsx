import { useCallback, useEffect, useState } from 'react';
import { Mail, Loader2, AlertCircle, RefreshCw, Trash2, ExternalLink, ImageOff } from 'lucide-react';
import { llm as llmApi, immich as immichApi } from '../api/client';
import type { Postcard, PostcardSummary } from '../api/client';

interface LlmConfig {
  configured: boolean;
  imageSupport: boolean;
}

/**
 * "Postcard From Your Past" — a new Profile > Reflect section.
 *
 * Pressing "Receive a Postcard" asks the server to find an interesting period
 * in the user's life, generate a mindful two-paragraph message for the back of
 * a virtual postcard, and collage 4-10 Immich photos from that period on the
 * front. Received postcards are persisted server-side and re-viewable from the
 * history list below the button.
 */
export function PostcardSection({ llmConfig, immichUrl }: { llmConfig: LlmConfig; immichUrl: string | null }) {
  const [current, setCurrent] = useState<Postcard | null>(null);
  const [history, setHistory] = useState<PostcardSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [loadingPostcard, setLoadingPostcard] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flipped, setFlipped] = useState(false);

  const refreshHistory = useCallback(async () => {
    try {
      const data = await llmApi.postcardHistory();
      setHistory(data);
    } catch (err) {
      console.error('Failed to load postcard history:', err);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!llmConfig.configured) {
      setHistoryLoading(false);
      return;
    }
    refreshHistory();
  }, [llmConfig.configured, refreshHistory]);

  const handleReceive = async () => {
    setGenerating(true);
    setError(null);
    try {
      const postcard = await llmApi.postcard();
      setCurrent(postcard);
      setFlipped(false);
      // Prepend locally (the server already persisted it) and reconcile with
      // the rest of the history.
      setHistory((prev) => [summaryFromPostcard(postcard), ...prev.filter((h) => h.id !== postcard.id)]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate postcard.');
    } finally {
      setGenerating(false);
    }
  };

  const handleOpenFromHistory = async (id: string) => {
    setLoadingPostcard(true);
    setError(null);
    try {
      const postcard = await llmApi.getPostcard(id);
      setCurrent(postcard);
      setFlipped(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load postcard.');
    } finally {
      setLoadingPostcard(false);
    }
  };

  const handleDelete = async (id: string) => {
    setHistory((prev) => prev.filter((h) => h.id !== id));
    if (current?.id === id) setCurrent(null);
    try {
      await llmApi.deletePostcard(id);
    } catch (err) {
      console.error('Failed to delete postcard:', err);
      refreshHistory();
    }
  };

  return (
    <div className="bg-white/60 dark:bg-gray-900/60 rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
          <Mail size={16} className="text-purple-500" />
          Postcard From Your Past
        </h3>
        {current && !generating && (
          <button
            onClick={() => setCurrent(null)}
            className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            Hide
          </button>
        )}
      </div>

      {!llmConfig.configured ? (
        <p className="text-sm text-gray-400">
          Configure an LLM in <span className="font-medium">Settings → Integrations → Life Summary (LLM)</span> to
          receive a postcard from your past.
        </p>
      ) : (
        <>
          <div className="flex items-center gap-3">
            <button
              onClick={handleReceive}
              disabled={generating}
              className="btn-primary"
            >
              {generating ? (
                <Loader2 size={16} className="animate-spin mr-2" />
              ) : (
                <Mail size={16} className="mr-2" />
              )}
              {generating ? 'Composing your postcard…' : current ? 'Receive another postcard' : 'Receive a Postcard'}
            </button>
            {current && !generating && (
              <button
                onClick={() => setFlipped((f) => !f)}
                className="flex items-center gap-1 rounded-lg bg-gray-100 dark:bg-gray-800 px-3 py-2 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
              >
                <RefreshCw size={13} />
                {flipped ? 'Show front' : 'Show back'}
              </button>
            )}
          </div>

          {error && (
            <div className="flex items-center gap-2 text-sm text-red-600">
              <AlertCircle size={16} />
              {error}
            </div>
          )}

          {generating && (
            <div className="flex items-center gap-3 text-sm text-gray-500 dark:text-gray-400 py-6">
              <Loader2 className="animate-spin text-primary-600" size={20} />
              <span>Finding an interesting time in your life and writing your postcard…</span>
            </div>
          )}

          {current && !generating && (
            <PostcardCard postcard={current} flipped={flipped} onFlip={() => setFlipped((f) => !f)} immichUrl={immichUrl} />
          )}

          {/* History list */}
          {historyLoading ? (
            <div className="flex items-center gap-2 text-xs text-gray-400 py-2">
              <Loader2 className="animate-spin" size={14} />
              Loading postcards…
            </div>
          ) : history.length > 0 ? (
            <div className="space-y-2">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {history.length} postcard{history.length === 1 ? '' : 's'} received
              </p>
              <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                {history.map((item) => (
                  <li key={item.id} className="flex items-center gap-3 py-2">
                    {item.image_ids.length > 0 ? (
                      <img
                        src={immichApi.thumbnailUrl(item.image_ids[0], 'thumbnail')}
                        alt=""
                        className="w-10 h-10 rounded-lg object-cover shrink-0 bg-gray-100 dark:bg-gray-800"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none';
                        }}
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-lg bg-gray-100 dark:bg-gray-800 shrink-0 flex items-center justify-center">
                        <ImageOff size={14} className="text-gray-400" />
                      </div>
                    )}
                    <button
                      onClick={() => handleOpenFromHistory(item.id)}
                      disabled={loadingPostcard}
                      className="flex-1 min-w-0 text-left group"
                    >
                      <div className="text-xs font-medium text-gray-800 dark:text-gray-200 group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors truncate">
                        {item.from} → {item.to}
                        {item.stamp_city && <span className="text-gray-400 font-normal"> · {item.stamp_city}</span>}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{item.message_preview}…</div>
                    </button>
                    <button
                      onClick={() => handleDelete(item.id)}
                      title="Delete this postcard"
                      className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded transition-colors shrink-0"
                    >
                      <Trash2 size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            !loadingPostcard && (
              <p className="text-xs text-gray-400">No postcards yet — press the button to receive one.</p>
            )
          )}

          {loadingPostcard && (
            <div className="flex items-center gap-2 text-xs text-gray-400 py-2">
              <Loader2 className="animate-spin" size={14} />
              Loading postcard…
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Build an optimistic history-list row from a freshly received postcard. */
function summaryFromPostcard(p: Postcard): PostcardSummary {
  return {
    id: p.id ?? '',
    from: p.from,
    to: p.to,
    sender_line: p.sender_line,
    stamp_city: p.stamp_city,
    message_preview: p.message.slice(0, 160),
    image_ids: p.images.map((i) => i.id),
    created_at: p.created_at ?? new Date().toISOString(),
  };
}

/** Deep-link into Immich's search for the postcard's period. */
function buildImmichPeriodUrl(immichUrl: string, from: string, to: string) {
  const query = JSON.stringify({
    takenAfter: `${from}T00:00:00.000Z`,
    takenBefore: `${to}T23:59:59.999Z`,
  });
  return `${immichUrl}/search?query=${encodeURIComponent(query)}`;
}

const HANDWRITING_FONT = `'Segoe Script', 'Bradley Hand', 'Comic Sans MS', cursive`;

/**
 * The flippable postcard. Front: photo collage + stamp + Immich link.
 * Back: To / From lines + the LLM message in a handwriting-style font.
 * Uses a CSS 3D flip (perspective + rotateY) — no extra dependency.
 */
function PostcardCard({
  postcard,
  flipped,
  onFlip,
  immichUrl,
}: {
  postcard: Postcard;
  flipped: boolean;
  onFlip: () => void;
  immichUrl: string | null;
}) {
  const [brokenImages, setBrokenImages] = useState<Set<string>>(new Set());

  return (
    <div
      className="w-full cursor-pointer select-none"
      style={{ perspective: '1600px' }}
      onClick={onFlip}
      role="button"
      tabIndex={0}
      aria-pressed={flipped}
      aria-label={flipped ? 'Flip to show the front of the postcard' : 'Flip to show the message on the back'}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onFlip();
        }
      }}
    >
      <div
        className="relative w-full transition-transform duration-700"
        style={{
          transformStyle: 'preserve-3d',
          transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
          // Fixed aspect so both faces have the same height during the flip.
          aspectRatio: '3 / 2',
        }}
      >
        {/* ---- Front ---- */}
        <div
          className="absolute inset-0 overflow-hidden rounded-xl border border-amber-900/20 bg-[#fdf8ee] dark:bg-[#2a2620] shadow-lg"
          style={{ backfaceVisibility: 'hidden' }}
        >
          <div className="flex h-full gap-2 p-2">
            {/* Collage */}
            <div
              className="flex-1 grid gap-1.5 overflow-hidden"
              style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(88px, 1fr))' }}
            >
              {postcard.images.length === 0 ? (
                <div className="col-span-full flex flex-col items-center justify-center gap-1 text-gray-400 bg-amber-900/5 dark:bg-white/5 rounded-lg">
                  <ImageOff size={20} />
                  <span className="text-xs">
                    {postcard.from} → {postcard.to}
                  </span>
                </div>
              ) : (
                postcard.images.map((img) =>
                  brokenImages.has(img.id) ? (
                    <div
                      key={img.id}
                      className="aspect-square rounded-md bg-amber-900/10 dark:bg-white/10 flex items-center justify-center"
                      title={img.originalFileName}
                    >
                      <ImageOff size={16} className="text-amber-900/40" />
                    </div>
                  ) : (
                    <img
                      key={img.id}
                      src={immichApi.thumbnailUrl(img.id, 'preview')}
                      alt={img.originalFileName}
                      title={`${img.originalFileName} — ${img.localDateTime || postcard.from}`}
                      loading="lazy"
                      className="aspect-square w-full object-cover rounded-md"
                      onError={() =>
                        setBrokenImages((prev) => {
                          const next = new Set(prev);
                          next.add(img.id);
                          return next;
                        })
                      }
                    />
                  )
                )
              )}
            </div>

            {/* Right rail: stamp + address block */}
            <div className="w-1/4 flex flex-col items-center justify-between py-1">
              {/* Stamp */}
              <div className="flex items-start gap-0.5">
                {postcard.stamp_city && (
                  <div
                    className="px-1.5 py-1 rounded-sm border-2 border-dashed border-purple-700/50 bg-purple-50/60 dark:bg-purple-900/20 text-center"
                    style={{ transform: 'rotate(3deg)' }}
                  >
                    <div className="text-[9px] leading-tight font-semibold text-purple-800 dark:text-purple-300 uppercase tracking-wide max-w-[72px] break-words">
                      {postcard.stamp_city}
                    </div>
                    <div className="text-[8px] text-purple-700/70 dark:text-purple-400/70">{postcard.to.slice(0, 7)}</div>
                  </div>
                )}
                {/* Postmark */}
                <div
                  className="w-8 h-8 rounded-full border border-gray-500/40 flex items-center justify-center -ml-1 mt-1"
                  style={{ transform: 'rotate(-12deg)' }}
                >
                  <span className="text-[7px] text-gray-500/70 text-center leading-tight">
                    {postcard.from.slice(5)}
                  </span>
                </div>
              </div>

              {/* To block */}
              <div className="w-full px-1 text-right space-y-0.5">
                <div className="border-b border-gray-400/40 pb-0.5" />
                <div className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">
                  {postcard.addressed_to}
                </div>
                <div className="text-[10px] text-gray-500 dark:text-gray-400">{postcard.sender_line}</div>
              </div>

              {/* Immich link */}
              {immichUrl && (
                <a
                  href={buildImmichPeriodUrl(immichUrl, postcard.from, postcard.to)}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="flex items-center gap-0.5 text-[10px] text-blue-600 dark:text-blue-400 hover:underline self-end"
                >
                  <ExternalLink size={10} />
                  View in Immich
                </a>
              )}
            </div>
          </div>
        </div>

        {/* ---- Back ---- */}
        <div
          className="absolute inset-0 overflow-hidden rounded-xl border border-amber-900/20 bg-[#fdf8ee] dark:bg-[#2a2620] shadow-lg"
          style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
        >
          <div className="flex h-full flex-col p-4">
            <div className="flex justify-between items-start">
              <div className="text-sm text-gray-700 dark:text-gray-300">
                To: <span className="font-semibold">{postcard.addressed_to}</span>
              </div>
              {postcard.stamp_city && (
                <div className="px-1.5 py-1 rounded-sm border-2 border-dashed border-purple-700/50 bg-purple-50/60 dark:bg-purple-900/20 text-center" style={{ transform: 'rotate(3deg)' }}>
                  <div className="text-[9px] leading-tight font-semibold text-purple-800 dark:text-purple-300 uppercase tracking-wide max-w-[80px] break-words">
                    {postcard.stamp_city}
                  </div>
                </div>
              )}
            </div>

            <div
              className="flex-1 overflow-y-auto my-3 pr-1 text-sm leading-relaxed text-gray-800 dark:text-gray-200 whitespace-pre-line"
              style={{ fontFamily: HANDWRITING_FONT }}
            >
              {postcard.message}
            </div>

            <div className="flex items-end justify-between gap-2">
              <div className="text-xs text-gray-500 dark:text-gray-400">
                {postcard.from} → {postcard.to}
              </div>
              <div
                className="text-sm text-gray-700 dark:text-gray-300"
                style={{ fontFamily: HANDWRITING_FONT }}
              >
                {postcard.sender_line}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

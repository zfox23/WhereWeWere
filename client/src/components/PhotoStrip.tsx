import { useState, useEffect, useCallback, useRef } from 'react';
import { ChevronRight } from 'lucide-react';
import { immich as immichApi } from '../api/client';
import type { ImmichAsset } from '../types';

const THUMB_SIZE = 64;
const THUMB_GAP = 4;

interface PhotoStripProps {
  assets: ImmichAsset[];
  moreUrl: string;
  immichUrl: string;
}

export function PhotoStrip({ assets, moreUrl, immichUrl }: PhotoStripProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(assets.length);

  const measure = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const width = el.clientWidth;
    const moreButtonWidth = 40;
    const maxFit = Math.floor((width + THUMB_GAP) / (THUMB_SIZE + THUMB_GAP));
    const maxFitWithMore = Math.floor((width - moreButtonWidth - THUMB_GAP + THUMB_GAP) / (THUMB_SIZE + THUMB_GAP));

    if (maxFit >= assets.length) {
      setVisibleCount(assets.length);
    } else {
      setVisibleCount(Math.max(1, maxFitWithMore));
    }
  }, [assets.length]);

  useEffect(() => {
    measure();
    const observer = new ResizeObserver(measure);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [measure]);

  const hasMore = visibleCount < assets.length;

  return (
    <div ref={containerRef} className="mt-2 flex items-center gap-1">
      {assets.slice(0, visibleCount).map((asset) => (
        <a
          key={asset.id}
          href={`${immichUrl}/photos/${asset.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 rounded-lg overflow-hidden hover:ring-2 hover:ring-primary-400 transition-all"
        >
          <img
            src={immichApi.thumbnailUrl(asset.id)}
            alt={asset.originalFileName}
            width={THUMB_SIZE}
            height={THUMB_SIZE}
            className="object-cover"
            style={{ width: THUMB_SIZE, height: THUMB_SIZE }}
            loading="lazy"
          />
        </a>
      ))}
      {hasMore && (
        <a
          href={moreUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 flex items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors text-xs font-medium text-gray-500 dark:text-gray-400"
          style={{ width: 36, height: THUMB_SIZE }}
          title={`${assets.length - visibleCount} more`}
        >
          <ChevronRight size={16} />
        </a>
      )}
    </div>
  );
}

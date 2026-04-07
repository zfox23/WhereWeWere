import type { ReactNode } from 'react';
import type { ImmichAsset } from '../../types';
import { buildImmichTimeUrl } from '../../utils/checkin';
import { PhotoStrip } from '../PhotoStrip';

interface PhotoSectionProps {
  immichUrl?: string | null;
  assets?: ImmichAsset[] | null;
  checkedInAt: string;
  fallbackLinkContent?: ReactNode;
}

export function PhotoSection({ immichUrl, assets, checkedInAt, fallbackLinkContent }: PhotoSectionProps) {
  if (!immichUrl) {
    return null;
  }

  const hasPhotos = Boolean(assets && assets.length > 0);
  const showInTime = assets === null;

  return (
    <>
      {hasPhotos && (
        <PhotoStrip
          assets={assets!}
          moreUrl={buildImmichTimeUrl(immichUrl, checkedInAt)}
          immichUrl={immichUrl}
        />
      )}

      {showInTime && (
        <div className="flex items-center gap-2 mt-2 text-indigo-600 dark:text-indigo-300">
          {fallbackLinkContent}
          <a
            href={buildImmichTimeUrl(immichUrl, checkedInAt)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs font-medium hover:text-indigo-800 dark:hover:text-indigo-500"
          >
            in time
          </a>
        </div>
      )}
    </>
  );
}
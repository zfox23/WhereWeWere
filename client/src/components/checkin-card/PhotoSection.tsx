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

  return (
    <>
      {hasPhotos && (
        <PhotoStrip
          assets={assets!}
          moreUrl={buildImmichTimeUrl(immichUrl, checkedInAt)}
          immichUrl={immichUrl}
        />
      )}
    </>
  );
}
import { useEffect, useState } from 'react';
import { immich as immichApi } from '../../api/client';
import type { ImmichAsset } from '../../types';

export function useResolvedPhotos(id: string, immichUrl?: string | null, photos?: ImmichAsset[] | null) {
  const [selfFetchedAssets, setSelfFetchedAssets] = useState<ImmichAsset[] | null>(null);

  useEffect(() => {
    if (photos !== undefined || !immichUrl) {
      return;
    }

    let cancelled = false;
    immichApi.photos(id).then((data) => {
      if (!cancelled) {
        setSelfFetchedAssets(data.assets);
      }
    }).catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [id, immichUrl, photos]);

  return photos !== undefined ? photos : selfFetchedAssets;
}
/**
 * An album's details as a page of their own (/music/album?ref=…), so one can be
 * opened in a new tab. The content is the album modal's.
 */

import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { usePageTitle } from '../../../../client/src/utils/pageTitle';
import { useState } from 'react';
import { AlbumDetails } from '../AlbumModal';

export default function AlbumPage() {
  const [params] = useSearchParams();
  const ref = params.get('ref');
  const artId = params.get('art_id');
  const [title, setTitle] = useState<string | null>(null);
  usePageTitle(title ? `Album: ${title}` : 'Album');

  return (
    <div className="space-y-4">
      <Link
        to="/profile?tab=plugin:music"
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
      >
        <ArrowLeft size={14} /> Music
      </Link>
      {ref === null && !artId ? (
        <p className="text-sm text-gray-500">No album was given.</p>
      ) : (
        <AlbumDetails albumRef={ref} artId={ref === null ? artId : null} page onLoaded={(a) => setTitle(a.title)} />
      )}
    </div>
  );
}

/**
 * "Open in Spotify" for a song, album or artist page. Shown only when the user
 * has set up Spotify. The server finds the matching Spotify item the first
 * time (then remembers it); with no confident match the button opens a
 * Spotify search instead. Links open the Spotify app where it is installed.
 */

import { useEffect, useState } from 'react';
import { Loader2, Play, Search } from 'lucide-react';
import { spotify } from './api';
import { useSpotifyStatus } from './useSpotifyStatus';
import type { SpotifyLink } from './types';

export type SpotifyTarget = { kind: 'song'; songKey: string } | { kind: 'album'; ref: string } | { kind: 'artist'; name: string };

const targetKey = (t: SpotifyTarget) => (t.kind === 'song' ? `song|${t.songKey}` : t.kind === 'album' ? `album|${t.ref}` : `artist|${t.name}`);

export function SpotifyButton({ target, className = '' }: { target: SpotifyTarget; className?: string }) {
  const status = useSpotifyStatus();
  const key = targetKey(target);
  const [link, setLink] = useState<{ key: string; link: SpotifyLink | null } | null>(null);
  const configured = status?.configured ?? false;

  useEffect(() => {
    if (!configured) return;
    let cancelled = false;
    spotify
      .link(target)
      .then((l) => !cancelled && setLink({ key, link: l }))
      .catch(() => !cancelled && setLink({ key, link: null }));
    return () => {
      cancelled = true;
    };
    // `key` identifies the target.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configured, key]);

  if (!configured) return null;
  const current = link?.key === key ? link : null;
  const base = `btn-secondary inline-flex items-center gap-1.5 !px-2.5 !py-1 text-xs ${className}`;

  if (!current) {
    return (
      <span className={`${base} opacity-60`} aria-busy="true">
        <Loader2 size={13} className="animate-spin" />
        Spotify
      </span>
    );
  }
  if (!current.link) return null;
  const { url, matched } = current.link;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={base}
      title={matched ? 'Open in Spotify' : "No exact match on Spotify; search for it there"}
    >
      {matched ? <Play size={13} className="text-green-600 dark:text-green-400" /> : <Search size={13} />}
      {matched ? 'Open in Spotify' : 'Search Spotify'}
    </a>
  );
}

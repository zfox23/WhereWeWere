import { useState } from 'react';
import { companions } from '../api/client';
import { useImmichEnabled } from '../hooks/useImmichEnabled';

interface CompanionPhotoProps {
  name: string;
  /** Pixel size (the photo is square). */
  size?: number;
  className?: string;
}

/**
 * Small round featured photo for a companion name, sourced from Immich when
 * the integration is enabled. Renders nothing when Immich is disabled or the
 * lookup fails (unknown person, Immich down, ...) so names degrade gracefully
 * to plain text. The server disk-caches the lookup and tells the browser to
 * cache the image, so a name rendered in several places costs one request.
 */
export function CompanionPhoto({ name, size = 16, className = '' }: CompanionPhotoProps) {
  const enabled = useImmichEnabled();
  const [failed, setFailed] = useState(false);

  if (!enabled || failed) return null;

  return (
    <img
      src={companions.photoUrl(name)}
      alt=""
      aria-hidden
      width={size}
      height={size}
      loading="lazy"
      onError={() => setFailed(true)}
      className={`shrink-0 rounded-full object-cover ${className}`}
      style={{ width: size, height: size }}
    />
  );
}

interface CompanionNameProps {
  name: string;
  className?: string;
  photoSize?: number;
}

/** A companion name with its (optional) Immich featured photo to the left. */
export function CompanionName({ name, className = '', photoSize = 16 }: CompanionNameProps) {
  return (
    <span className={`inline-flex min-w-0 items-center gap-1.5 ${className}`}>
      <CompanionPhoto name={name} size={photoSize} />
      <span className="truncate">{name}</span>
    </span>
  );
}

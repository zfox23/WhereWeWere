/**
 * A note tag rendered as a colored pill. With `to`, it links (e.g. to the
 * Home timeline filtered to that tag).
 */

import { Link } from 'react-router-dom';
import { TAG_TEXT_CLASS, tagChipStyle, type NoteTag } from './api';

interface TagChipProps {
  tag: Pick<NoteTag, 'name' | 'color'>;
  to?: string;
  size?: 'xs' | 'sm';
}

export function TagChip({ tag, to, size = 'xs' }: TagChipProps) {
  const className = `inline-flex items-center gap-1 rounded-full border font-medium whitespace-nowrap ${TAG_TEXT_CLASS} ${
    size === 'sm' ? 'px-2.5 py-0.5 text-xs' : 'px-2 py-px text-[11px]'
  }`;
  const style = tagChipStyle(tag.color);
  const content = (
    <>
      <TagDot color={tag.color} size={size === 'sm' ? 7 : 6} />
      {tag.name}
    </>
  );
  if (to) {
    return (
      <Link to={to} className={`${className} hover:brightness-110`} style={style}>
        {content}
      </Link>
    );
  }
  return <span className={className} style={style}>{content}</span>;
}

/** Home timeline filtered to notes with this tag (a plugin filter pins the timeline to its type). */
export function tagTimelinePath(name: string): string {
  return `/?note_tag=${encodeURIComponent(name)}`;
}

export function TagDot({ color, size = 8 }: { color: string; size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-block shrink-0 rounded-full"
      style={{ width: size, height: size, backgroundColor: color }}
    />
  );
}

import { Clapperboard } from 'lucide-react';
import PluginFilterShell from '../../../client/src/components/filters/PluginFilterShell';
import { MEDIA_SUBTYPE_LIST } from '../utils/media';

const SUBTYPE_LABELS: Record<string, string> = {
  movie: 'Movie',
  tv_show: 'TV Show',
  game: 'Game',
  book: 'Book',
  board_game: 'Board Game',
};

export interface MediaFilterProps {
  included: boolean;
  filtersDisabled: boolean;
  sectionDisabled: boolean;
  typeToggleDisabled: boolean;
  /** Comma-separated selected subtypes (empty = all media). */
  mediaSubtypes: string;
  onToggleIncluded: () => void;
  onSetMediaSubtypes: (value: string) => void;
}

export default function MediaFilter({
  included,
  filtersDisabled,
  sectionDisabled,
  typeToggleDisabled,
  mediaSubtypes,
  onToggleIncluded,
  onSetMediaSubtypes,
}: MediaFilterProps) {
  const selected = new Set(
    mediaSubtypes
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  );

  const toggleSubtype = (subtype: string) => {
    const next = new Set(selected);
    if (next.has(subtype)) {
      next.delete(subtype);
    } else {
      next.add(subtype);
    }
    onSetMediaSubtypes(MEDIA_SUBTYPE_LIST.filter((s) => next.has(s)).join(','));
  };

  return (
    <PluginFilterShell
      icon={<Clapperboard size={16} className="text-violet-500" />}
      label="Media"
      included={included}
      filtersDisabled={filtersDisabled}
      sectionDisabled={sectionDisabled}
      typeToggleDisabled={typeToggleDisabled}
      onToggleIncluded={onToggleIncluded}
    >
      <div>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {MEDIA_SUBTYPE_LIST.map((subtype) => (
            <label
              key={subtype}
              className="inline-flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400 select-none cursor-pointer"
            >
              <input
                type="checkbox"
                checked={selected.has(subtype)}
                disabled={sectionDisabled}
                onChange={() => toggleSubtype(subtype)}
                className="h-3.5 w-3.5 rounded border-gray-300 text-primary-600 focus:ring-primary-500 disabled:cursor-not-allowed"
              />
              {SUBTYPE_LABELS[subtype]}
            </label>
          ))}
        </div>
      </div>
    </PluginFilterShell>
  );
}

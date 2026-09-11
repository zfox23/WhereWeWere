import { MEDIA_SUBTYPE_LIST } from '../../utils/media';

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
    <div className={`rounded-xl border p-3 grid grid-cols-1 gap-3 ${filtersDisabled ? 'border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-900/40 opacity-60' : 'border-violet-200 dark:border-violet-800/60 bg-violet-50/50 dark:bg-violet-950/20'}`}>
      <div>
        <label className="inline-flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
          <input
            type="checkbox"
            checked={included}
            disabled={typeToggleDisabled}
            onChange={onToggleIncluded}
            className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500 disabled:cursor-not-allowed"
          />
          <span>Media</span>
        </label>
      </div>
      {filtersDisabled && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Clear other type filters to enable media filtering.
        </p>
      )}
      <div>
        <label className="text-xs text-gray-500 mb-1 block">Subtype (none = all)</label>
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
    </div>
  );
}

import { Clapperboard } from 'lucide-react';
import PluginFilterShell from '../../../client/src/components/filters/PluginFilterShell';
import { MEDIA_SUBTYPE_LIST, MEDIA_SUBTYPES } from '../utils/media';

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
        <div className="flex flex-wrap gap-1.5">
          {MEDIA_SUBTYPE_LIST.map((subtype) => {
            const config = MEDIA_SUBTYPES[subtype];
            const active = selected.has(subtype);
            return (
              <button
                key={subtype}
                type="button"
                onClick={() => toggleSubtype(subtype)}
                disabled={sectionDisabled}
                aria-pressed={active}
                className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors border disabled:cursor-not-allowed disabled:opacity-50 ${active
                  ? 'bg-primary-500 border-primary-500 text-white'
                  : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                  }`}
              >
                {config.plural}
              </button>
            );
          })}
        </div>
      </div>
    </PluginFilterShell>
  );
}

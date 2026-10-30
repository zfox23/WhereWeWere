/**
 * Notes filter section for the Home timeline: toggle tags (a note matches
 * any selected tag). Writes the `note_tag` param as comma-separated names.
 */

import { useEffect, useState } from 'react';
import { NotebookPen } from 'lucide-react';
import type { PluginFilterSectionProps } from 'wwp-shared';
import PluginFilterShell from '../../../client/src/components/filters/PluginFilterShell';
import { TAG_TEXT_CLASS, notes, tagChipStyle, type NoteTagSummary } from './api';
import { TagDot } from './TagChip';

export function NoteFilter({
  included,
  filtersDisabled,
  sectionDisabled,
  typeToggleDisabled,
  params,
  onToggleIncluded,
  onSetParam,
}: PluginFilterSectionProps) {
  const [tags, setTags] = useState<NoteTagSummary[]>([]);

  useEffect(() => {
    notes.tags().then(setTags).catch(() => setTags([]));
  }, []);

  const selected = (params.note_tag ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const selectedKeys = new Set(selected.map((s) => s.toLowerCase()));

  const toggle = (name: string) => {
    const key = name.toLowerCase();
    const next = selectedKeys.has(key) ? selected.filter((s) => s.toLowerCase() !== key) : [...selected, name];
    onSetParam('note_tag', next.join(','));
  };

  return (
    <PluginFilterShell
      icon={<NotebookPen size={16} className="text-amber-500" />}
      label="Notes"
      included={included}
      filtersDisabled={filtersDisabled}
      sectionDisabled={sectionDisabled}
      typeToggleDisabled={typeToggleDisabled}
      onToggleIncluded={onToggleIncluded}
    >
      {tags.length === 0 ? (
        <p className="text-xs text-gray-400">Tag your notes to filter by tag.</p>
      ) : (
        <div className="flex gap-1.5 flex-wrap">
          {tags.map((tag) => {
            const active = selectedKeys.has(tag.name.toLowerCase());
            return (
              <button
                key={tag.id}
                type="button"
                disabled={sectionDisabled}
                aria-pressed={active}
                onClick={() => toggle(tag.name)}
                style={active ? undefined : tagChipStyle(tag.color)}
                className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors border disabled:cursor-not-allowed disabled:opacity-60 ${
                  active ? 'bg-primary-600 text-white border-primary-600' : TAG_TEXT_CLASS
                }`}
              >
                <TagDot color={tag.color} />
                {tag.name}
                <span className="ml-1 opacity-70 tabular-nums">{tag.note_count}</span>
              </button>
            );
          })}
        </div>
      )}
    </PluginFilterShell>
  );
}

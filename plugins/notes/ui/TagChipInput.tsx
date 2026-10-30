/**
 * Tag picker for notes: chips in each tag's color, autocomplete from the
 * user's tags, and "Create “x”" for a new one (created on save).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import ChipInput from '../../../client/src/components/ChipInput';
import { notes, tagChipStyle, type NoteTagSummary } from './api';
import { TagDot } from './TagChip';

interface TagChipInputProps {
  value: string[];
  onChange: (names: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
}

/** Neutral look for a tag that doesn't exist yet. */
const NEW_TAG_COLOR = '#9ca3af';

export default function TagChipInput({ value, onChange, disabled, placeholder = 'Add tags…' }: TagChipInputProps) {
  const [tags, setTags] = useState<NoteTagSummary[] | null>(null);

  useEffect(() => {
    notes.tags().then(setTags).catch(() => setTags([]));
  }, []);

  const byKey = useMemo(() => new Map((tags ?? []).map((t) => [t.name.toLowerCase(), t])), [tags]);

  // Most-used first; prefix matches before substring matches.
  const loadSuggestions = useCallback(async (q: string) => {
    const list = tags ?? (await notes.tags().catch(() => []));
    const needle = q.toLowerCase();
    return list
      .filter((t) => t.name.toLowerCase().includes(needle))
      .sort((a, b) => {
        const ap = a.name.toLowerCase().startsWith(needle) ? 0 : 1;
        const bp = b.name.toLowerCase().startsWith(needle) ? 0 : 1;
        return ap - bp || b.note_count - a.note_count || a.name.localeCompare(b.name);
      })
      .map((t) => t.name);
  }, [tags]);

  const colorOf = (name: string) => byKey.get(name.toLowerCase())?.color ?? NEW_TAG_COLOR;

  return (
    <ChipInput
      value={value}
      onChange={onChange}
      disabled={disabled}
      loadSuggestions={loadSuggestions}
      renderIcon={(name) => <TagDot color={colorOf(name)} />}
      chipStyle={(name) => tagChipStyle(colorOf(name))}
      createLabel={(name) => `Create tag “${name}”`}
      placeholder={placeholder}
      ariaLabel="Tags"
    />
  );
}

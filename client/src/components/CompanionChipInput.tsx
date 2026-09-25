import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { companions } from '../api/client';

interface CompanionChipInputProps {
  /** Currently selected companion names. */
  value: string[];
  onChange: (names: string[]) => void;
  disabled?: boolean;
}

/**
 * "Here With…" chip input, shared by every check-in type that implements
 * companions. Selected companions render as removable chips; the trailing
 * text field autocompletes from previously-entered companion names (via the
 * core's /companions/names endpoint — the name pool is shared across all
 * companion-aware check-in types). Pressing Enter (or clicking a suggestion)
 * commits the current text as a chip; Backspace on an empty field removes
 * the last chip. Names are de-duplicated case-insensitively.
 */
export default function CompanionChipInput({ value, onChange, disabled = false }: CompanionChipInputProps) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const lowerSet = useMemo(() => new Set(value.map((n) => n.toLowerCase())), [value]);

  // Debounced fetch of suggestion names as the user types.
  const [suggestions, setSuggestions] = useState<string[]>([]);
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = text.trim();
    debounceRef.current = setTimeout(async () => {
      try {
        const names = await companions.names(q || undefined, 50);
        // Exclude names already selected (case-insensitive) and exact dups.
        const seen = new Set<string>();
        const filtered = (names || [])
          .filter((n) => {
            const key = n.toLowerCase();
            if (lowerSet.has(key) || seen.has(key)) return false;
            seen.add(key);
            return true;
          })
          .slice(0, 8);
        setSuggestions(filtered);
      } catch {
        setSuggestions([]);
      }
    }, 180);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [text, lowerSet]);

  // Reset highlight when the suggestion list changes.
  useEffect(() => {
    setHighlight(0);
  }, [suggestions, text]);

  // Close the dropdown on outside click.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const commit = (raw: string) => {
    const name = raw.trim();
    if (!name || lowerSet.has(name.toLowerCase())) {
      setText('');
      setOpen(false);
      return;
    }
    onChange([...value, name]);
    setText('');
    setOpen(false);
    inputRef.current?.focus();
  };

  const removeAt = (index: number) => {
    const next = value.filter((_, i) => i !== index);
    onChange(next);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (open && suggestions[highlight]) {
        commit(suggestions[highlight]);
      } else if (text.trim()) {
        commit(text);
      }
      return;
    }
    if (e.key === 'ArrowDown' && open) {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, suggestions.length - 1));
      return;
    }
    if (e.key === 'ArrowUp' && open) {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
      return;
    }
    if (e.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (e.key === 'Backspace' && text === '' && value.length > 0) {
      e.preventDefault();
      removeAt(value.length - 1);
    }
  };

  const showDropdown = open && suggestions.length > 0;

  return (
    <div ref={containerRef} className="relative">
      <div
        className="flex flex-wrap items-center gap-1.5 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 focus-within:ring-2 focus-within:ring-primary-500 focus-within:border-primary-500 min-h-[42px]"
        onClick={() => inputRef.current?.focus()}
      >
        {value.map((name, i) => (
          <span
            key={`${name}-${i}`}
            className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 border border-primary-200 dark:border-primary-700"
          >
            {name}
            <button
              type="button"
              aria-label={`Remove ${name}`}
              onClick={(e) => {
                e.stopPropagation();
                removeAt(i);
              }}
              className="text-primary-500/70 hover:text-primary-700 dark:hover:text-primary-200"
            >
              <X size={12} />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          value={text}
          disabled={disabled}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={value.length === 0 ? 'Who were you with?' : 'Add another…'}
          aria-label="Here with (companion names)"
          className="flex-1 min-w-[120px] text-sm bg-transparent text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none"
        />
      </div>

      {showDropdown && (
        <ul
          role="listbox"
          className="absolute z-20 left-0 right-0 mt-1 max-h-56 overflow-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg"
        >
          {suggestions.map((name, i) => (
            <li key={name} role="option" aria-selected={i === highlight}>
              <button
                type="button"
                onMouseEnter={() => setHighlight(i)}
                onClick={() => commit(name)}
                className={`w-full text-left px-3 py-2 text-sm ${
                  i === highlight
                    ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-800 dark:text-primary-200'
                    : 'text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700/50'
                }`}
              >
                {name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

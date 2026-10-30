import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { X } from 'lucide-react';

export interface ChipInputProps {
  /** Currently selected names. */
  value: string[];
  onChange: (names: string[]) => void;
  /** Candidate names for the typed text (may include selected ones; they are filtered out). */
  loadSuggestions: (query: string) => Promise<string[]>;
  disabled?: boolean;
  /** Placeholder while nothing is selected / once something is. */
  placeholder?: string;
  morePlaceholder?: string;
  ariaLabel: string;
  /** Leading icon for a chip or suggestion (e.g. a companion photo, a tag color dot). */
  renderIcon?: (name: string) => ReactNode;
  /** Inline style for a chip (e.g. a tag's color); replaces the default primary palette. */
  chipStyle?: (name: string) => CSSProperties | undefined;
  /** Offer "Create “x”" as the last suggestion when the typed text matches no suggestion. */
  createLabel?: (name: string) => string;
}

const DEFAULT_CHIP_CLASS = 'bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 border-primary-200 dark:border-primary-700';

/**
 * Chip input with autocomplete. Selected names render as removable chips; the
 * trailing text field autocompletes from `loadSuggestions`. Pressing Enter (or
 * clicking a suggestion) commits the current text as a chip; Backspace on an
 * empty field removes the last chip. Names are de-duplicated case-insensitively.
 */
export default function ChipInput({
  value,
  onChange,
  loadSuggestions,
  disabled = false,
  placeholder = 'Add…',
  morePlaceholder = 'Add another…',
  ariaLabel,
  renderIcon,
  chipStyle,
  createLabel,
}: ChipInputProps) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  // -1 = nothing highlighted: Enter commits the typed text, and only commits a
  // suggestion once the user arrows into (or hovers) the list.
  const [highlight, setHighlight] = useState(-1);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadRef = useRef(loadSuggestions);
  loadRef.current = loadSuggestions;

  const lowerSet = useMemo(() => new Set(value.map((n) => n.toLowerCase())), [value]);

  // Debounced fetch of suggestion names as the user types.
  const [suggestions, setSuggestions] = useState<string[]>([]);
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    // Nothing to show while the dropdown is closed: skip the request (every
    // form instance would otherwise hit the API on mount).
    if (!open) return;
    let cancelled = false;
    const q = text.trim();
    debounceRef.current = setTimeout(async () => {
      try {
        const names = await loadRef.current(q);
        if (cancelled) return;
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
        if (!cancelled) setSuggestions([]);
      }
    }, 180);
    return () => {
      // Ignore a response that lands after the query changed.
      cancelled = true;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [text, lowerSet, open]);

  // Reset highlight when the suggestion list changes.
  useEffect(() => {
    setHighlight(-1);
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

  const typed = text.trim();
  const offerCreate = Boolean(
    createLabel && typed && !lowerSet.has(typed.toLowerCase())
      && !suggestions.some((s) => s.toLowerCase() === typed.toLowerCase()),
  );
  const options = offerCreate ? [...suggestions, typed] : suggestions;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (open && highlight >= 0 && options[highlight]) {
        commit(options[highlight]);
      } else if (typed) {
        commit(text);
      }
      return;
    }
    if (e.key === 'ArrowDown' && open) {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, options.length - 1));
      return;
    }
    if (e.key === 'ArrowUp' && open) {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, -1));
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

  const showDropdown = open && options.length > 0;

  return (
    <div ref={containerRef} className="relative">
      <div
        className="flex flex-wrap items-center gap-1.5 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 focus-within:ring-2 focus-within:ring-primary-500 focus-within:border-primary-500 min-h-[42px]"
        onClick={() => inputRef.current?.focus()}
      >
        {value.map((name, i) => {
          const style = chipStyle?.(name);
          return (
            <span
              key={`${name}-${i}`}
              style={style}
              className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full border ${style ? 'text-gray-800 dark:text-gray-100' : DEFAULT_CHIP_CLASS}`}
            >
              {renderIcon?.(name)}
              {name}
              <button
                type="button"
                aria-label={`Remove ${name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  removeAt(i);
                }}
                className="opacity-60 hover:opacity-100"
              >
                <X size={12} />
              </button>
            </span>
          );
        })}
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
          placeholder={value.length === 0 ? placeholder : morePlaceholder}
          aria-label={ariaLabel}
          className="flex-1 min-w-[120px] text-sm bg-transparent text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none"
        />
      </div>

      {showDropdown && (
        <ul
          role="listbox"
          className="absolute z-20 left-0 right-0 mt-1 max-h-56 overflow-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg"
        >
          {options.map((name, i) => {
            const isCreate = offerCreate && i === options.length - 1;
            return (
              <li key={isCreate ? `create:${name}` : name} role="option" aria-selected={i === highlight}>
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
                  {isCreate ? (
                    <span className="italic">{createLabel!(name)}</span>
                  ) : (
                    <span className="inline-flex items-center gap-2">
                      {renderIcon?.(name)}
                      {name}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

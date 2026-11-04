import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { safeGetItem, safeSetItem } from '../../../utils/storage';

interface DisplaySectionProps {
  /** Stable id; the open/closed state is remembered per browser under it. */
  id: string;
  title: string;
  icon: React.ElementType<{ size?: number; className?: string }>;
  /** Short summary of the current choice, shown next to the title. */
  summary?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}

const storageKey = (id: string) => `display-section-open:${id}`;

/** A collapsible Settings > Display card. */
export function DisplaySection({ id, title, icon: Icon, summary, defaultOpen = true, children }: DisplaySectionProps) {
  const [open, setOpen] = useState(() => {
    const stored = safeGetItem(storageKey(id));
    return stored === null ? defaultOpen : stored === '1';
  });
  const toggle = () => {
    setOpen((prev) => {
      safeSetItem(storageKey(id), prev ? '0' : '1');
      return !prev;
    });
  };
  const contentId = `display-section-${id}`;

  return (
    <section className="bg-white/60 dark:bg-gray-900/60 rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3">
      <h2>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-controls={contentId}
          className="w-full flex items-center gap-2 p-6 text-left text-lg font-semibold text-gray-900 dark:text-gray-100"
        >
          <Icon size={20} className="text-primary-600 shrink-0" />
          <span>{title}</span>
          {summary && (
            <span className="ml-auto truncate text-sm font-normal text-gray-500 dark:text-gray-400">{summary}</span>
          )}
          <ChevronDown
            size={18}
            className={`shrink-0 text-gray-400 transition-transform ${summary ? '' : 'ml-auto'} ${open ? 'rotate-180' : ''}`}
          />
        </button>
      </h2>
      {open && (
        <div id={contentId} className="px-6 pb-6 space-y-4">
          {children}
        </div>
      )}
    </section>
  );
}

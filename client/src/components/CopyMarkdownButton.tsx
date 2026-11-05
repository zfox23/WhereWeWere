import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { copyText } from '../utils/clipboard';

/**
 * "Copy as markdown" button: builds the markdown when clicked (so it is never
 * stale) and briefly shows "Copied" once it is on the clipboard.
 */
export function CopyMarkdownButton({
  getMarkdown,
  label = 'Copy as markdown',
  ariaLabel,
  className,
  iconSize = 14,
}: {
  getMarkdown: () => string;
  label?: string;
  /** What is being copied, for screen readers, e.g. "Copy note as markdown". */
  ariaLabel?: string;
  className?: string;
  iconSize?: number;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const copy = async () => {
    if (!(await copyText(getMarkdown()))) return;
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      type="button"
      onClick={() => void copy()}
      title={label}
      aria-label={copied ? 'Copied to clipboard' : (ariaLabel ?? label)}
      className={className ?? 'inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors'}
    >
      {copied ? <Check size={iconSize} className="text-green-500" /> : <Copy size={iconSize} />}
      {copied ? 'Copied' : label}
    </button>
  );
}

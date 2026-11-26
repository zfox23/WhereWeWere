/** A read-only value with a Copy button (Settings → Music). */

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { copyText } from '../../../client/src/utils/clipboard';

export function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    copyText(value).then((ok) => {
      if (!ok) return;
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <div>
      <label className="block text-xs text-gray-500 mb-1">{label}</label>
      <div className="flex items-center gap-2">
        <code className="flex-1 min-w-0 truncate rounded-lg bg-gray-100 dark:bg-gray-800 px-3 py-2 text-xs font-mono text-gray-800 dark:text-gray-200">
          {value}
        </code>
        <button
          type="button"
          onClick={copy}
          title={copied ? 'Copied!' : `Copy ${label}`}
          className="shrink-0 flex items-center gap-1 rounded-lg bg-gray-100 dark:bg-gray-800 px-2.5 py-2 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
        >
          {copied ? <Check size={13} className="text-green-500" /> : <Copy size={13} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

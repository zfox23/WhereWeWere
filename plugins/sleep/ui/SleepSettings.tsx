/**
 * Sleep > Settings tab.
 *
 * Self-contained settings tab rendered by the core Settings page through the
 * plugin `settings` slot. Currently hosts the Sleep as Android webhook URL +
 * event counter, moved out of the core Integrations tab so it lives under
 * Settings > Sleep.
 */

import { useEffect, useState } from 'react';
import { Moon, Check, Copy } from 'lucide-react';
import { sleepWebhook } from './api';

export function SleepSettings() {
  const [webhookEventCount, setWebhookEventCount] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const webhookUrl = `${window.location.origin}/api/v1/webhook/sleep-as-android`;

  useEffect(() => {
    sleepWebhook
      .stats()
      .then((data) => setWebhookEventCount(data.count))
      .catch(() => setWebhookEventCount(null));
  }, []);

  const handleCopy = () => {
    navigator.clipboard.writeText(webhookUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="bg-white/60 dark:bg-gray-900/60 rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3 p-6 space-y-4">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
        <Moon size={20} className="text-indigo-500" />
        Sleep as Android
      </h2>

      <p className="text-xs text-gray-500 dark:text-gray-400">
        Enter this URL in Sleep as Android under Settings → Services → Automation → Webhooks to receive live sleep tracking events.
      </p>

      <div className="flex items-center gap-2">
        <code className="flex-1 min-w-0 truncate rounded-lg bg-gray-100 dark:bg-gray-800 px-3 py-2 text-xs font-mono text-gray-800 dark:text-gray-200">
          {webhookUrl}
        </code>
        <button
          onClick={handleCopy}
          title={copied ? 'Copied!' : 'Copy URL'}
          className="shrink-0 flex items-center gap-1 rounded-lg bg-gray-100 dark:bg-gray-800 px-2.5 py-2 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
        >
          {copied ? <Check size={13} className="text-green-500" /> : <Copy size={13} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      <p className="text-xs text-gray-500 dark:text-gray-400">
        {webhookEventCount === null
          ? 'Loading webhook stats…'
          : `${webhookEventCount} Webhook Event${webhookEventCount === 1 ? '' : 's'} Received`}
      </p>
    </div>
  );
}

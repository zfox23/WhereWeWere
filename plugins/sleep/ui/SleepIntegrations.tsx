/**
 * Sleep > Settings > Integrations section.
 *
 * The Sleep as Android webhook URL + event counter, moved out of the core
 * IntegrationsTab. Rendered generically by the core IntegrationsTab through
 * the plugin `integrationsSettings` slot.
 */

import { useEffect, useState } from 'react';
import { Moon, Check, Copy } from 'lucide-react';
import { sleepWebhook } from './api';

export function SleepIntegrations() {
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
    <div className="border-t border-gray-100 dark:border-gray-800 pt-4">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-1.5">
        <Moon size={14} className="text-indigo-500" />
        Sleep as Android
      </h3>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
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
      <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
        {webhookEventCount === null
          ? 'Loading webhook stats…'
          : `${webhookEventCount} Webhook Event${webhookEventCount === 1 ? '' : 's'} Received`}
      </p>
    </div>
  );
}

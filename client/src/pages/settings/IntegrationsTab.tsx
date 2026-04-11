import { useState, useEffect } from 'react';
import { Link2, Moon, Check, AlertCircle, Loader2, Copy } from 'lucide-react';
import { settings, sleepWebhook } from '../../api/client';

interface IntegrationsTabProps {
  initialDawarichUrl: string;
  initialDawarichApiKey: string;
  initialImmichUrl: string;
  initialImmichApiKey: string;
  initialMalojaUrl: string;
}

export function IntegrationsTab({
  initialDawarichUrl,
  initialDawarichApiKey,
  initialImmichUrl,
  initialImmichApiKey,
  initialMalojaUrl,
}: IntegrationsTabProps) {
  const [dawarichUrl, setDawarichUrl] = useState(initialDawarichUrl);
  const [dawarichApiKey, setDawarichApiKey] = useState(initialDawarichApiKey);
  const [immichUrl, setImmichUrl] = useState(initialImmichUrl);
  const [immichApiKey, setImmichApiKey] = useState(initialImmichApiKey);
  const [malojaUrl, setMalojaUrl] = useState(initialMalojaUrl);
  const [integrationSaving, setIntegrationSaving] = useState(false);
  const [integrationMsg, setIntegrationMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [webhookEventCount, setWebhookEventCount] = useState<number | null>(null);
  const [webhookCopied, setWebhookCopied] = useState(false);
  const webhookUrl = `${window.location.origin}/api/v1/webhook/sleep-as-android`;

  useEffect(() => {
    sleepWebhook.stats()
      .then((data) => setWebhookEventCount(data.count))
      .catch(() => setWebhookEventCount(null));
  }, []);

  const handleWebhookCopy = () => {
    navigator.clipboard.writeText(webhookUrl).then(() => {
      setWebhookCopied(true);
      setTimeout(() => setWebhookCopied(false), 2000);
    });
  };

  const saveIntegrations = async () => {
    setIntegrationSaving(true);
    setIntegrationMsg(null);
    try {
      await settings.update({
        dawarich_url: dawarichUrl || null,
        dawarich_api_key: dawarichApiKey || null,
        immich_url: immichUrl || null,
        immich_api_key: immichApiKey || null,
        maloja_url: malojaUrl || null,
      });
      setIntegrationMsg({ type: 'success', text: 'Integration settings saved.' });
    } catch (err) {
      setIntegrationMsg({ type: 'error', text: err instanceof Error ? err.message : 'Failed to save.' });
    } finally {
      setIntegrationSaving(false);
    }
  };

  return (
    <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/[0.03] p-6 space-y-4">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
        <Link2 size={20} className="text-gray-600 dark:text-gray-400" />
        Integrations
      </h2>

      <div className="space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Dawarich</h3>
          <div className="space-y-2">
            <div>
              <label className="block text-xs text-gray-500 mb-1">URL</label>
              <input
                type="url"
                value={dawarichUrl}
                onChange={(e) => setDawarichUrl(e.target.value)}
                className="input"
                placeholder="https://dawarich.example.com"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">API Key</label>
              <input
                type="password"
                value={dawarichApiKey}
                onChange={(e) => setDawarichApiKey(e.target.value)}
                className="input"
                placeholder="Enter API key"
              />
            </div>
          </div>
        </div>

        <div className="border-t border-gray-100 dark:border-gray-800 pt-4">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Immich</h3>
          <div className="space-y-2">
            <div>
              <label className="block text-xs text-gray-500 mb-1">URL</label>
              <input
                type="url"
                value={immichUrl}
                onChange={(e) => setImmichUrl(e.target.value)}
                className="input"
                placeholder="https://immich.example.com"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">API Key</label>
              <input
                type="password"
                value={immichApiKey}
                onChange={(e) => setImmichApiKey(e.target.value)}
                className="input"
                placeholder="Enter API key"
              />
            </div>
          </div>
        </div>

        <div className="border-t border-gray-100 dark:border-gray-800 pt-4">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Maloja</h3>
          <p className="text-xs text-gray-500 mb-2">
            Connect to your Maloja scrobble server to show what music you were listening to around each check-in.
          </p>
          <div>
            <label className="block text-xs text-gray-500 mb-1">URL</label>
            <input
              type="url"
              value={malojaUrl}
              onChange={(e) => setMalojaUrl(e.target.value)}
              className="input"
              placeholder="https://maloja.example.com"
            />
          </div>
        </div>

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
              onClick={handleWebhookCopy}
              title={webhookCopied ? 'Copied!' : 'Copy URL'}
              className="shrink-0 flex items-center gap-1 rounded-lg bg-gray-100 dark:bg-gray-800 px-2.5 py-2 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
            >
              {webhookCopied ? <Check size={13} className="text-green-500" /> : <Copy size={13} />}
              {webhookCopied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            {webhookEventCount === null
              ? 'Loading webhook stats…'
              : `${webhookEventCount} Webhook Event${webhookEventCount === 1 ? '' : 's'} Received`}
          </p>
        </div>
      </div>

      {integrationMsg && (
        <div className={`flex items-center gap-2 text-sm ${integrationMsg.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
          {integrationMsg.type === 'success' ? <Check size={16} /> : <AlertCircle size={16} />}
          {integrationMsg.text}
        </div>
      )}
      <button onClick={saveIntegrations} disabled={integrationSaving} className="btn-primary">
        {integrationSaving ? <Loader2 size={16} className="animate-spin mr-2" /> : null}
        Save Integrations
      </button>
    </div>
  );
}

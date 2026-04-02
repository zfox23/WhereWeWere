import { useState, useEffect } from 'react';
import { Bell, Loader2, Check, AlertCircle, Copy } from 'lucide-react';

interface PushSettingsProps {
  enabled: boolean;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function getServiceWorkerRegistration(timeoutMs = 8000): Promise<ServiceWorkerRegistration> {
  if (!('serviceWorker' in navigator)) {
    throw new Error('Service Worker not supported in this browser.');
  }

  const existing = await navigator.serviceWorker.getRegistration();
  if (existing) {
    return existing;
  }

  const ready = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_, reject) => {
      window.setTimeout(() => reject(new Error('Service worker registration timed out. Refresh and try again.')), timeoutMs);
    }),
  ]);

  return ready;
}

export function PushSettings({ enabled }: PushSettingsProps) {
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [subscriptionCount, setSubscriptionCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [vapidPublicKey, setVapidPublicKey] = useState<string>('');

  useEffect(() => {
    const checkSubscription = async () => {
      try {
        // Fetch VAPID public key
        const keyRes = await fetch('/api/v1/push/vapid-public-key');
        const keyData = await keyRes.json();
        setVapidPublicKey(keyData.publicKey);

        // Check if already subscribed
        if ('serviceWorker' in navigator && 'PushManager' in window) {
          const registration = await getServiceWorkerRegistration();
          const subscription = await registration.pushManager.getSubscription();
          setIsSubscribed(!!subscription);
        }

        // Get subscription list
        const listRes = await fetch('/api/v1/push');
        const subscriptions = await listRes.json();
        setSubscriptionCount(Array.isArray(subscriptions) ? subscriptions.length : 0);
      } catch (err) {
        console.error('Failed to check push subscriptions:', err);
      }
    };

    checkSubscription();
  }, []);

  const handleSubscribe = async () => {
    if (!enabled) {
      setMessage({ type: 'error', text: 'Enable push notifications first.' });
      return;
    }

    setLoading(true);
    setMessage(null);

    try {
      // Request notification permission
      if ('Notification' in window && Notification.permission === 'default') {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          throw new Error('Notification permission denied');
        }
      }

      if (!('PushManager' in window)) {
        throw new Error('Push notifications are not supported in this browser.');
      }

      if (!vapidPublicKey) {
        throw new Error('Push configuration not loaded yet. Please try again.');
      }

      const registration = await getServiceWorkerRegistration();

      const existingSubscription = await registration.pushManager.getSubscription();
      if (existingSubscription) {
        setIsSubscribed(true);
        setMessage({ type: 'success', text: 'Push notifications are already enabled on this device.' });
        return;
      }

      // Subscribe to push
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
      });

      // Send subscription to server
      const res = await fetch('/api/v1/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: subscription.toJSON() }),
      });

      if (!res.ok) throw new Error('Failed to save subscription');

      setIsSubscribed(true);
      setSubscriptionCount((prev) => prev + 1);
      setMessage({ type: 'success', text: 'Push notifications enabled!' });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to subscribe';
      setMessage({ type: 'error', text: errorMessage });
    } finally {
      setLoading(false);
    }
  };

  const handleUnsubscribe = async () => {
    setLoading(true);
    setMessage(null);

    try {
      const registration = await getServiceWorkerRegistration();
      const subscription = await registration.pushManager.getSubscription();

      if (!subscription) {
        throw new Error('No active subscription found');
      }

      const endpoint = subscription.endpoint;

      // Unsubscribe locally
      await subscription.unsubscribe();

      // Notify server
      const res = await fetch('/api/v1/push/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint }),
      });

      if (!res.ok) throw new Error('Failed to remove subscription');

      setIsSubscribed(false);
      setSubscriptionCount((prev) => Math.max(0, prev - 1));
      setMessage({ type: 'success', text: 'Push notifications disabled.' });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to unsubscribe';
      setMessage({ type: 'error', text: errorMessage });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/[0.03] p-6 space-y-4">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
        <Bell size={20} className="text-primary-600" />
        Push Notifications
      </h2>

      <p className="text-sm text-gray-500 dark:text-gray-400">
        Receive mood check-in reminders even when WhereWeWere is not open (requires browser support).
      </p>

      {!enabled && (
        <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400">
          <AlertCircle size={16} />
          Enable notifications to use this feature.
        </div>
      )}

      <div className="space-y-2">
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Status</p>
        <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
              {isSubscribed ? 'Subscribed' : 'Not subscribed'}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {subscriptionCount} device{subscriptionCount !== 1 ? 's' : ''} registered
            </p>
          </div>
          <div
            className={`w-3 h-3 rounded-full ${
              isSubscribed ? 'bg-green-500' : 'bg-gray-400'
            }`}
          />
        </div>
      </div>

      <div className="flex gap-2">
        {!isSubscribed ? (
          <button
            onClick={handleSubscribe}
            disabled={loading || !enabled}
            className="btn-primary"
          >
            {loading ? (
              <>
                <Loader2 size={16} className="animate-spin mr-2" />
                Enabling...
              </>
            ) : (
              <>
                <Bell size={16} className="mr-2" />
                Enable Push Notifications
              </>
            )}
          </button>
        ) : (
          <button
            onClick={handleUnsubscribe}
            disabled={loading}
            className="btn-secondary"
          >
            {loading ? (
              <>
                <Loader2 size={16} className="animate-spin mr-2" />
                Disabling...
              </>
            ) : (
              <>
                <Bell size={16} className="mr-2" />
                Disable Push Notifications
              </>
            )}
          </button>
        )}
      </div>

      {message && (
        <div
          className={`flex items-center gap-2 text-sm ${
            message.type === 'success' ? 'text-green-600' : 'text-red-600'
          }`}
        >
          {message.type === 'success' ? <Check size={16} /> : <AlertCircle size={16} />}
          {message.text}
        </div>
      )}
    </div>
  );
}

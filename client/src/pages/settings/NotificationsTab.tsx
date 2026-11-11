import { useCallback, useEffect, useState } from 'react';
import { Bell, BellOff, Check, AlertCircle, Loader2, Send } from 'lucide-react';
import type { CheckinTypeClient } from 'wwp-shared';
import { notificationsApi, type PluginNotificationsInfo } from '../../api/client';
import { allClientPlugins } from '../../plugins/registry';
import { ToggleRow } from '../../components/ToggleRow';
import {
  deviceTimeZone,
  disablePushOnThisDevice,
  enablePushOnThisDevice,
  getDevicePushState,
  type DevicePushState,
} from '../../services/push';

const SECTION_CLASS =
  'bg-white/60 dark:bg-gray-900/60 rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3 p-6 space-y-4';
const HEADING_CLASS = 'text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2';
const HINT_CLASS = 'text-sm text-gray-500 dark:text-gray-400';

type Message = { type: 'success' | 'error'; text: string } | null;

function StatusMessage({ message }: { message: Message }) {
  if (!message) return null;
  return (
    <div
      role={message.type === 'error' ? 'alert' : 'status'}
      className={`flex items-center gap-2 text-sm ${message.type === 'success' ? 'text-green-600' : 'text-red-600'}`}
    >
      {message.type === 'success' ? <Check size={16} /> : <AlertCircle size={16} />}
      {message.text}
    </div>
  );
}

const errorText = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

/** Plugins whose manifest declares notification triggers. */
const NOTIFYING_PLUGINS: CheckinTypeClient[] = allClientPlugins().filter((p) => p.notifications?.triggers?.length);

function DeviceSection({
  state,
  onChange,
}: {
  state: DevicePushState;
  onChange: (state: DevicePushState) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<Message>(null);

  const toggle = async (on: boolean) => {
    setBusy(true);
    setMessage(null);
    try {
      if (on) {
        const next = await enablePushOnThisDevice();
        onChange(next);
        if (next.permission === 'denied') {
          setMessage({ type: 'error', text: 'Notifications are blocked for this site. Allow them in your browser or app settings, then try again.' });
        } else if (!next.subscribed) {
          setMessage({ type: 'error', text: 'Notifications were not allowed.' });
        }
      } else {
        await disablePushOnThisDevice();
        onChange({ ...state, subscribed: false, endpoint: null });
      }
    } catch (err) {
      setMessage({ type: 'error', text: errorText(err, 'Could not change notifications on this device.') });
    } finally {
      setBusy(false);
    }
  };

  const sendTest = async () => {
    if (!state.endpoint) return;
    setTesting(true);
    setMessage(null);
    try {
      await notificationsApi.test(state.endpoint);
      setMessage({ type: 'success', text: 'Test notification sent.' });
    } catch (err) {
      setMessage({ type: 'error', text: errorText(err, 'Could not send a test notification.') });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className={SECTION_CLASS}>
      <h2 className={HEADING_CLASS}>
        <Bell size={20} className="text-gray-600 dark:text-gray-400" />
        This device
      </h2>
      {state.support === 'needs-install' && (
        <p className={HINT_CLASS}>
          To get notifications on iPhone or iPad, add WhereWeWere to your Home Screen (Share → Add to Home Screen) and
          open it from there.
        </p>
      )}
      {state.support === 'unsupported' && (
        <p className={HINT_CLASS}>This browser doesn't support notifications.</p>
      )}
      {state.support === 'supported' && (
        <>
          <ToggleRow
            label="Notifications on this device"
            description="Sent by the server, so they arrive even when the app is closed. Each device is turned on separately."
            checked={state.subscribed}
            disabled={busy}
            onChange={(on) => void toggle(on)}
          />
          {state.permission === 'denied' && !state.subscribed && (
            <p className={HINT_CLASS}>
              Notifications are blocked for this site. On Android, long-press the app icon → App info → Notifications
              (or the site settings in your browser) to allow them.
            </p>
          )}
          {state.subscribed && (
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" className="btn-secondary flex items-center gap-2" onClick={sendTest} disabled={testing}>
                {testing ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                Send test notification
              </button>
              <span className={HINT_CLASS}>Times follow this device's timezone ({deviceTimeZone()}).</span>
            </div>
          )}
        </>
      )}
      <StatusMessage message={message} />
    </div>
  );
}

function PluginSection({
  plugin,
  info,
  deviceOn,
  onToggled,
}: {
  plugin: CheckinTypeClient;
  info: PluginNotificationsInfo | undefined;
  deviceOn: boolean;
  onToggled: (enabled: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const enabled = info?.enabled === true;
  const Icon = plugin.client.icon;
  const Extra = plugin.client.notificationSettings as React.ComponentType<{ enabled: boolean }> | undefined;
  const triggers = plugin.notifications?.triggers ?? [];

  const toggle = async (on: boolean) => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await notificationsApi.setPluginEnabled(plugin.id, on);
      onToggled(result.enabled);
    } catch (err) {
      setMessage({ type: 'error', text: errorText(err, 'Could not save.') });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={SECTION_CLASS}>
      <h2 className={HEADING_CLASS}>
        <Icon size={20} className={plugin.client.iconColor ?? 'text-gray-600 dark:text-gray-400'} />
        {plugin.strings.title}
      </h2>
      <ToggleRow
        label={triggers.length === 1 ? triggers[0].label : `${plugin.strings.title} notifications`}
        description={
          triggers.length === 1
            ? triggers[0].description
            : triggers.map((t) => t.label).join(' · ')
        }
        checked={enabled}
        disabled={busy || !info}
        onChange={(on) => void toggle(on)}
      />
      {!deviceOn && enabled && (
        <p className={HINT_CLASS}>Turn on notifications for this device above to receive these here.</p>
      )}
      <StatusMessage message={message} />
      {Extra && <Extra enabled={enabled} />}
    </div>
  );
}

/** Settings > Notifications: this device's opt-in, then each plugin's notifications. */
export function NotificationsTab() {
  const [device, setDevice] = useState<DevicePushState | null>(null);
  const [pluginInfo, setPluginInfo] = useState<PluginNotificationsInfo[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    const [deviceResult, pluginsResult] = await Promise.allSettled([getDevicePushState(), notificationsApi.plugins()]);
    if (deviceResult.status === 'fulfilled') setDevice(deviceResult.value);
    else setDevice({ support: 'unsupported', permission: 'unsupported', subscribed: false, endpoint: null });
    if (pluginsResult.status === 'fulfilled') setPluginInfo(pluginsResult.value);
    else setLoadError(errorText(pluginsResult.reason, 'Could not load notification settings.'));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!device) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="animate-spin text-primary-600" size={24} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <DeviceSection state={device} onChange={setDevice} />
      {loadError && <StatusMessage message={{ type: 'error', text: loadError }} />}
      {NOTIFYING_PLUGINS.length === 0 && (
        <div className={SECTION_CLASS}>
          <p className={`${HINT_CLASS} flex items-center gap-2`}>
            <BellOff size={16} /> No features offer notifications yet.
          </p>
        </div>
      )}
      {NOTIFYING_PLUGINS.map((plugin) => (
        <PluginSection
          key={plugin.id}
          plugin={plugin}
          info={pluginInfo?.find((p) => p.id === plugin.id)}
          deviceOn={device.subscribed}
          onToggled={(enabled) =>
            setPluginInfo((prev) => (prev ?? []).map((p) => (p.id === plugin.id ? { ...p, enabled } : p)))
          }
        />
      ))}
    </div>
  );
}

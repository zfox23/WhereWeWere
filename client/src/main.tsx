import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import '@fontsource/bebas-neue/400.css';
import '@fontsource/lato/400.css';
import '@fontsource/lato/400-italic.css';
import '@fontsource/lato/700.css';
import '@fontsource/ibm-plex-mono/400.css';
import './index.css';
import {
  entryScriptPath,
  entryScriptPathFromHtml,
  isUserEditing,
  reloadWhenIdle,
  shouldReloadForBuild,
} from './utils/swUpdate';
import { safeNotificationPath } from './utils/notificationPath';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);

// Keeping the page on the latest build. A deployment is detected by fetching
// the HTML shell straight from the server and comparing its hashed entry
// script with the one this page runs. That doesn't depend on the service
// worker having noticed or finished installing the new build, and navigations
// are network-first (sw-custom.ts), so a reload always lands on the new build.
const UPDATE_TARGET_KEY = 'wwp-update-target';
const UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1000;
const runningBuild = entryScriptPath(document, window.location.origin);
let reloadScheduled = false;
let checkInFlight = false;
let takeoverCheckQueued = false;

function readUpdateTarget(): string | null {
  try {
    return sessionStorage.getItem(UPDATE_TARGET_KEY);
  } catch {
    return null;
  }
}

function reloadForUpdate(target: string | null) {
  if (reloadScheduled) return;
  reloadScheduled = true;
  reloadWhenIdle(
    () => {
      try {
        if (target) sessionStorage.setItem(UPDATE_TARGET_KEY, target);
      } catch {
        // Without storage we only lose the reload-loop guard.
      }
      window.location.reload();
    },
    () => isUserEditing(window.location.pathname, window.location.search, document.activeElement)
  );
}

/**
 * `ignoreLastAttempt`: a new worker just took control, so its precached shell
 * is the new build and a reload lands on it even offline. Retry even if an
 * earlier reload toward that build fell back to the old cached shell.
 */
async function checkForNewBuild(ignoreLastAttempt = false) {
  if (reloadScheduled || !navigator.onLine) return;
  if (checkInFlight) {
    // Don't drop a takeover check behind an ordinary one: rerun it afterwards.
    if (ignoreLastAttempt) takeoverCheckQueued = true;
    return;
  }
  checkInFlight = true;
  try {
    // The query string keeps the service worker's precache from answering.
    const res = await fetch(`/index.html?build-check=${Date.now()}`, { cache: 'no-store' });
    // A 502 from a proxy while the container restarts is not a new build.
    if (!res.ok) return;
    const latest = entryScriptPathFromHtml(await res.text(), window.location.origin);
    const lastAttempted = ignoreLastAttempt ? null : readUpdateTarget();
    if (shouldReloadForBuild(runningBuild, latest, lastAttempted)) reloadForUpdate(latest);
  } catch {
    // Offline or server restarting: try again on the next trigger.
  } finally {
    checkInFlight = false;
    if (takeoverCheckQueued) {
      takeoverCheckQueued = false;
      void checkForNewBuild(true);
    }
  }
}

if ('serviceWorker' in navigator && !import.meta.env.DEV) {
  let registration: ServiceWorkerRegistration | undefined;

  // Also refresh the service worker itself so the offline copy stays current.
  // Browsers only do that on navigations, which an installed PWA resumed from
  // the background never makes.
  const checkForUpdates = () => {
    if (document.visibilityState !== 'visible') return;
    if (registration && !registration.installing && navigator.onLine) {
      registration.update().catch(() => {});
    }
    void checkForNewBuild();
  };

  registerSW({
    immediate: true,
    onRegisteredSW(_swUrl, r) {
      registration = r;
    },
    // Without this the plugin reloads the page itself (when another tab or the
    // browser found the update), even while the user is typing.
    onNeedReload: () => void checkForNewBuild(true),
  });

  // A new worker took over (it activates itself: skipWaiting + clientsClaim).
  navigator.serviceWorker.addEventListener('controllerchange', () => void checkForNewBuild(true));
  document.addEventListener('visibilitychange', checkForUpdates);
  window.addEventListener('focus', checkForUpdates);
  window.addEventListener('online', checkForUpdates);
  setInterval(checkForUpdates, UPDATE_CHECK_INTERVAL_MS);
} else if ('serviceWorker' in navigator) {
  // Dev: the dev-server worker, no build checks (Vite HMR handles updates).
  registerSW({ immediate: true });
}

// An old page that lazy-loads a chunk removed by a newer deployment gets a 404
// for it. Move to the new build instead of leaving a broken screen.
window.addEventListener('vite:preloadError', () => void checkForNewBuild());

// A notification was tapped while the app was open but the service worker
// couldn't navigate this window itself.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type !== 'notification-click') return;
    const path = safeNotificationPath(event.data.url);
    if (`${window.location.pathname}${window.location.search}` !== path) window.location.assign(path);
  });
}

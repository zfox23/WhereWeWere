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
import { isUserEditing, reloadWhenIdle } from './utils/swUpdate';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);

// Let vite-plugin-pwa choose the correct service worker URL in dev/prod.
if ('serviceWorker' in navigator) {
  registerSW({ immediate: true });

  // The new worker activates itself (skipWaiting + clients.claim). Reload to
  // pick up the new bundle, but not while the user is mid-form: wait until
  // they are on a non-form page with no focused field.
  const hadController = Boolean(navigator.serviceWorker.controller);
  let cancelPendingReload: (() => void) | null = null;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // The first install also fires controllerchange (clients.claim): nothing to refresh then.
    if (!hadController || cancelPendingReload) return;
    cancelPendingReload = reloadWhenIdle(
      () => window.location.reload(),
      () => isUserEditing(window.location.pathname, window.location.search, document.activeElement)
    );
  });
}

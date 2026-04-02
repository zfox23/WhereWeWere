import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import './index.css';
import { startGeofenceWatcher } from './services/geofence';
import { startMoodReminderScheduler } from './services/moodReminders';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);

// Start geofence watcher for dwell-based check-in notifications
startGeofenceWatcher();
startMoodReminderScheduler();

// Let vite-plugin-pwa choose the correct service worker URL in dev/prod.
if ('serviceWorker' in navigator) {
  registerSW({ immediate: true });
}

// Handle notification clicks from service worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'notification-click' && event.data.url) {
      window.location.href = event.data.url;
    }
  });
}

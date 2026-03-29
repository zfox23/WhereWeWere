import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import { startGeofenceWatcher } from './services/geofence';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);

// Start geofence watcher for dwell-based check-in notifications
startGeofenceWatcher();

// Handle notification clicks from service worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'notification-click' && event.data.url) {
      window.location.href = event.data.url;
    }
  });
}

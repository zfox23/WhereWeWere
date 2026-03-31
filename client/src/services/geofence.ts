import { haversineDistance } from '../utils/geo';

const DWELL_TIME_MS = 10 * 60 * 1000; // 10 minutes
const DWELL_RADIUS_M = 100; // 100 meters

interface DwellState {
  lat: number;
  lng: number;
  since: number;
  notified: boolean;
}

let watchId: number | null = null;
let dwellState: DwellState | null = null;

function onPosition(position: GeolocationPosition) {
  const { latitude, longitude } = position.coords;
  const now = Date.now();

  if (!dwellState) {
    dwellState = { lat: latitude, lng: longitude, since: now, notified: false };
    return;
  }

  const distance = haversineDistance(dwellState.lat, dwellState.lng, latitude, longitude);

  if (distance > DWELL_RADIUS_M) {
    // User moved — reset
    dwellState = { lat: latitude, lng: longitude, since: now, notified: false };
    return;
  }

  // User is still in the same area
  const dwellDuration = now - dwellState.since;
  if (dwellDuration >= DWELL_TIME_MS && !dwellState.notified) {
    dwellState.notified = true;
    showCheckinNotification(latitude, longitude);
  }
}

async function showCheckinNotification(lat: number, lng: number) {
  if (Notification.permission !== 'granted') return;

  const reg = await navigator.serviceWorker?.ready;
  if (reg) {
    reg.showNotification('Check in here?', {
      body: 'You\'ve been here a while. Tap to check in.',
      icon: '/icon-192.svg',
      tag: 'dwell-checkin',
      data: { url: `/check-in?lat=${lat}&lon=${lng}` },
      requireInteraction: false,
    });
  } else {
    // Fallback to Notification API
    const n = new Notification('Check in here?', {
      body: 'You\'ve been here a while. Tap to check in.',
      icon: '/icon-192.svg',
      tag: 'dwell-checkin',
    });
    n.onclick = () => {
      window.focus();
      window.location.href = `/check-in?lat=${lat}&lon=${lng}`;
    };
  }
}

export function startGeofenceWatcher() {
  if (!('geolocation' in navigator)) return;
  if (watchId !== null) return;

  // Request notification permission
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }

  watchId = navigator.geolocation.watchPosition(onPosition, undefined, {
    enableHighAccuracy: true,
    maximumAge: 60000,
    timeout: 30000,
  });
}

export function stopGeofenceWatcher() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  dwellState = null;
}

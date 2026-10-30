import { useEffect, useState } from 'react';

type OrientationEventWithCompass = DeviceOrientationEvent & { webkitCompassHeading?: number };
type IOSOrientationEvent = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<string> };

function screenAngle(): number {
  return window.screen?.orientation?.angle ?? 0;
}

/** Compass heading in degrees clockwise from north, or null when unsupported/denied. */
export function useDeviceHeading(enabled = true): number | null {
  const [heading, setHeading] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined' || !('DeviceOrientationEvent' in window)) return;

    const onOrientation = (e: Event) => {
      const event = e as OrientationEventWithCompass;
      let value: number | null = null;
      if (typeof event.webkitCompassHeading === 'number') {
        value = event.webkitCompassHeading; // iOS: already clockwise from north
      } else if (event.alpha != null && (event.absolute || e.type === 'deviceorientationabsolute')) {
        value = 360 - event.alpha;
      }
      if (value == null || Number.isNaN(value)) return;
      setHeading((value + screenAngle() + 360) % 360);
    };

    const listen = () => {
      window.addEventListener('deviceorientationabsolute', onOrientation);
      window.addEventListener('deviceorientation', onOrientation);
    };

    const requestPermission = (DeviceOrientationEvent as IOSOrientationEvent).requestPermission;
    let cleanupGesture: (() => void) | undefined;

    if (typeof requestPermission === 'function') {
      // iOS requires permission to be requested from a user gesture.
      const onGesture = () => {
        cleanupGesture?.();
        requestPermission.call(DeviceOrientationEvent)
          .then((state) => { if (state === 'granted') listen(); })
          .catch(() => {});
      };
      document.addEventListener('click', onGesture);
      document.addEventListener('touchend', onGesture);
      cleanupGesture = () => {
        document.removeEventListener('click', onGesture);
        document.removeEventListener('touchend', onGesture);
      };
    } else {
      listen();
    }

    return () => {
      cleanupGesture?.();
      window.removeEventListener('deviceorientationabsolute', onOrientation);
      window.removeEventListener('deviceorientation', onOrientation);
    };
  }, [enabled]);

  return heading;
}

/** Rotation for a bearing-to-target arrow, relative to the device heading when known. */
export function arrowRotation(bearing: number, heading: number | null): number {
  return heading == null ? bearing : (bearing - heading + 360) % 360;
}

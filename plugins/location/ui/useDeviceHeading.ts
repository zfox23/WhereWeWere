import { useEffect, useState } from 'react';

type OrientationEventWithCompass = DeviceOrientationEvent & { webkitCompassHeading?: number };
type IOSOrientationEvent = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<string> };

const rad = Math.PI / 180;

/**
 * Compass heading from absolute orientation angles, valid at any tilt. Uses the direction the
 * back of the device points when it is held upright, or the top edge (plus screen rotation)
 * when it is lying closer to flat.
 */
export function headingFromOrientation(alpha: number, beta: number, gamma: number, screenAngleDeg = 0): number {
  const cA = Math.cos(alpha * rad), sA = Math.sin(alpha * rad);
  const cB = Math.cos(beta * rad), sB = Math.sin(beta * rad);
  const cG = Math.cos(gamma * rad), sG = Math.sin(gamma * rad);

  const backEast = -(cA * sG + sA * sB * cG);
  const backNorth = -(sA * sG - cA * sB * cG);
  const topEast = -sA * cB;
  const topNorth = cA * cB;

  const backMagnitude = Math.hypot(backEast, backNorth);
  const topMagnitude = Math.hypot(topEast, topNorth);
  const degrees = backMagnitude >= topMagnitude
    ? Math.atan2(backEast, backNorth) / rad
    : Math.atan2(topEast, topNorth) / rad + screenAngleDeg;
  return (degrees + 360) % 360;
}

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
        value = (event.webkitCompassHeading + screenAngle() + 360) % 360; // iOS: clockwise from north
      } else if (
        event.alpha != null && event.beta != null && event.gamma != null
        && (event.absolute || e.type === 'deviceorientationabsolute')
      ) {
        value = headingFromOrientation(event.alpha, event.beta, event.gamma, screenAngle());
      }
      if (value == null || Number.isNaN(value)) return;
      setHeading(value);
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

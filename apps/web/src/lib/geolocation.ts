export type DeviceCoords = {
  lat: number;
  lng: number;
  accuracyMeters?: number;
};

/**
 * Reads the phone / laptop GPS via the browser.
 * Needs HTTPS (or localhost) and the user allowing location access.
 */
export function captureDeviceLocation(options?: {
  timeoutMs?: number;
  highAccuracy?: boolean;
}): Promise<DeviceCoords> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return Promise.reject(
      new Error('This device or browser cannot share GPS. Use paste or Look up instead.'),
    );
  }

  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          lat: Number(pos.coords.latitude.toFixed(6)),
          lng: Number(pos.coords.longitude.toFixed(6)),
          accuracyMeters:
            typeof pos.coords.accuracy === 'number'
              ? Math.round(pos.coords.accuracy)
              : undefined,
        });
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          reject(
            new Error(
              'Location permission blocked. Allow location for this site in your phone browser, then try again.',
            ),
          );
          return;
        }
        if (err.code === err.TIMEOUT) {
          reject(new Error('GPS timed out. Stand outdoors or wait a moment, then try again.'));
          return;
        }
        reject(new Error(err.message || 'Could not read GPS on this device.'));
      },
      {
        enableHighAccuracy: options?.highAccuracy !== false,
        timeout: options?.timeoutMs ?? 20000,
        maximumAge: 0,
      },
    );
  });
}

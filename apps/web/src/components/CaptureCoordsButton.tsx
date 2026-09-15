'use client';

import { useState } from 'react';
import { captureDeviceLocation } from '@/lib/geolocation';

type Props = {
  onCapture: (coords: { lat: number; lng: number; accuracyMeters?: number }) => void | Promise<void>;
  label?: string;
  busyLabel?: string;
  className?: string;
};

export function CaptureCoordsButton({
  onCapture,
  label = 'Use my phone GPS',
  busyLabel = 'Reading GPS…',
  className = 'btn',
}: Props) {
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState('');
  const [error, setError] = useState('');

  async function run() {
    if (busy) return;
    setBusy(true);
    setError('');
    setHint('');
    try {
      const coords = await captureDeviceLocation();
      await onCapture(coords);
      setHint(
        coords.accuracyMeters != null
          ? `Captured (±${coords.accuracyMeters} m). ${coords.lat}, ${coords.lng}`
          : `Captured ${coords.lat}, ${coords.lng}`,
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="capture-coords">
      <button type="button" className={className} onClick={run} disabled={busy}>
        {busy ? busyLabel : label}
      </button>
      {hint && <p className="muted capture-coords-msg">{hint}</p>}
      {error && <p className="error capture-coords-msg">{error}</p>}
    </div>
  );
}

'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { api } from '@/lib/api';
import type { LocationNotice } from '@/components/NotificationBell';

export default function SiteCaptureListPage() {
  const [items, setItems] = useState<LocationNotice[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    api<LocationNotice[]>('/projects/needs-location')
      .then(setItems)
      .catch((e) => setError(e.message));
  }, []);

  return (
    <AppShell>
      <div className="capture-mobile">
        <h1>Capture on site</h1>
        <p className="muted">
          Only opened projects (ACTIVE after MD approval) appear here. Capture GPS at the plot, not
          at site visit.
        </p>
        {error && <p className="error">{error}</p>}
        {!error && items.length === 0 && (
          <p className="muted" style={{ marginTop: '1rem' }}>
            Nothing waiting. Opened projects either have GPS, or none need capture yet.
          </p>
        )}
        <ul className="site-capture-list">
          {items.map((n) => (
            <li key={n.id}>
              <Link href={`/projects/${n.id}/capture`} className="site-capture-card">
                <strong>{n.name}</strong>
                <span>
                  {n.code}
                  {n.client?.name ? ` · ${n.client.name}` : ''}
                  {n.standNumber != null ? ` · Stand ${n.standNumber}` : ''}
                </span>
                <em>Capture GPS →</em>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </AppShell>
  );
}

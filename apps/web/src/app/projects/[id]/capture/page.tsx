'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { CaptureCoordsButton } from '@/components/CaptureCoordsButton';
import { LoadingState } from '@/components/LoadingState';
import { api } from '@/lib/api';

type Project = {
  id: string;
  code: string;
  name: string;
  status: string;
  address?: string | null;
  locationNotes?: string | null;
  locationLat?: number | null;
  locationLng?: number | null;
  standNumber?: number | null;
  client?: { name: string };
  standPackage?: { id: string; name: string; code?: string } | null;
};

export default function CaptureLocationPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  async function load() {
    const p = await api<Project>(`/projects/${id}`);
    setProject(p);
  }

  useEffect(() => {
    if (!id) return;
    load().catch((e) => setError(e.message));
  }, [id]);

  if (!project) {
    return (
      <AppShell>
        <div className="capture-mobile">
          {error ? <p className="error">{error}</p> : <LoadingState label="Loading project…" />}
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="capture-mobile">
        <Link href="/projects" className="muted">
          ← Back
        </Link>
        <p className="capture-kicker">On-site GPS</p>
        <h1>{project.name}</h1>
        <p className="capture-meta">
          {project.code}
          {project.client?.name ? ` · ${project.client.name}` : ''}
          {project.standNumber != null ? ` · Stand ${project.standNumber}` : ''}
        </p>
        {project.standPackage && (
          <p className="muted">
            Company package <strong>{project.standPackage.name}</strong>: one site location is shared
            by all stands. Capturing GPS here updates every project in the package.
          </p>
        )}
        {(project.address || project.locationNotes) && (
          <p className="muted">{project.address || project.locationNotes}</p>
        )}

        {error && <p className="error">{error}</p>}

        {saved || (project.locationLat != null && project.locationLng != null) ? (
          <div className="capture-success">
            <strong>Coordinates saved</strong>
            <p>
              {project.locationLat}, {project.locationLng}
            </p>
            {project.standPackage && (
              <p className="muted">Applied to all stands in this package.</p>
            )}
            <div className="row-actions" style={{ marginTop: 16 }}>
              <button type="button" className="btn" onClick={() => router.push('/map')}>
                View map
              </button>
              <button
                type="button"
                className="btn secondary"
                onClick={() => router.push('/site-capture')}
              >
                Next project needing GPS
              </button>
            </div>
          </div>
        ) : (
          <div className="capture-action-card">
            <p>
              Stand on the plot, then tap below and allow location. This sets the map pin for client
              presentations.
            </p>
            <CaptureCoordsButton
              className="btn capture-big-btn"
              label="Capture my location"
              busyLabel="Reading phone GPS…"
              onCapture={async (coords) => {
                setError('');
                await api(`/projects/${id}`, {
                  method: 'PATCH',
                  body: JSON.stringify({
                    locationLat: coords.lat,
                    locationLng: coords.lng,
                  }),
                });
                setSaved(true);
                await load();
                window.dispatchEvent(new Event('nomchael:notifications-refresh'));
              }}
            />
          </div>
        )}
      </div>
    </AppShell>
  );
}

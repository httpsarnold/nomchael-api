'use client';

import dynamic from 'next/dynamic';
import { AppShell } from '@/components/AppShell';

const ProjectMap = dynamic(() => import('@/components/ProjectMap'), { ssr: false });

export default function MapPage() {
  return (
    <AppShell>
      <h1>Project map</h1>
      <p className="muted">
        Show clients running and finished sites. GPS is captured on site from each project page.
      </p>
      <div className="panel" style={{ marginTop: '1rem' }}>
        <ProjectMap />
      </div>
      <div className="panel" style={{ marginTop: '1rem' }}>
        <h3>When to capture coordinates</h3>
        <ol className="muted" style={{ margin: '0.5rem 0 0', paddingLeft: '1.25rem' }}>
          <li>Create the project in the office. A notification appears with the project name.</li>
          <li>
            On site: tap the bell → tap the project → <strong>Capture my location</strong>.
          </li>
          <li>Or open Operations → Capture GPS on site for the mobile list.</li>
        </ol>
      </div>
    </AppShell>
  );
}

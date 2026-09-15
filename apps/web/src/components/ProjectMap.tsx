'use client';

import { useEffect, useMemo, useState } from 'react';
import { MapContainer, Marker, Popup, TileLayer } from 'react-leaflet';
import L from 'leaflet';
import Link from 'next/link';
import { api } from '@/lib/api';

const singleIcon = L.icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

function countIcon(count: number) {
  return L.divIcon({
    className: 'map-count-marker',
    html: `<div class="map-count-pin"><span>${count}</span></div>`,
    iconSize: [40, 40],
    iconAnchor: [20, 40],
  });
}

type MapView = 'showcase' | 'running' | 'finished' | 'all';

type MarkerRow = {
  id: string;
  code: string;
  name: string;
  status: string;
  address?: string;
  standNumber?: number | null;
  locationLat: number;
  locationLng: number;
  client?: { name: string };
  standPackage?: { id: string; name: string; code: string } | null;
};

type SiteCluster = {
  key: string;
  locationLat: number;
  locationLng: number;
  projects: MarkerRow[];
  packageName?: string;
  clientName?: string;
  address?: string;
};

function clusterMarkers(markers: MarkerRow[]): SiteCluster[] {
  const groups = new Map<string, MarkerRow[]>();
  for (const m of markers) {
    const key = m.standPackage?.id
      ? `pkg:${m.standPackage.id}`
      : `loc:${m.locationLat.toFixed(5)},${m.locationLng.toFixed(5)}`;
    const list = groups.get(key) || [];
    list.push(m);
    groups.set(key, list);
  }

  return Array.from(groups.entries()).map(([key, projects]) => {
    const first = projects[0];
    return {
      key,
      locationLat: first.locationLat,
      locationLng: first.locationLng,
      projects,
      packageName: first.standPackage?.name,
      clientName: first.client?.name,
      address: first.address,
    };
  });
}

export default function ProjectMap() {
  const [view, setView] = useState<MapView>('showcase');
  const [markers, setMarkers] = useState<MarkerRow[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    setError('');
    api<MarkerRow[]>(`/projects/map?view=${view}`)
      .then(setMarkers)
      .catch((e) => setError(e.message));
  }, [view]);

  const sites = useMemo(() => clusterMarkers(markers), [markers]);

  const center: [number, number] = useMemo(
    () =>
      sites.length > 0
        ? [sites[0].locationLat, sites[0].locationLng]
        : [-17.8292, 31.0522],
    [sites],
  );

  const projectTotal = markers.length;

  return (
    <div>
      <div className="row-actions" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
        {(
          [
            ['showcase', 'Client showcase'],
            ['running', 'Running'],
            ['finished', 'Finished'],
            ['all', 'All with coords'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={`btn ${view === key ? '' : 'secondary'}`}
            onClick={() => setView(key)}
          >
            {label}
          </button>
        ))}
      </div>
      {error && <p className="error">{error}</p>}
      <MapContainer
        key={`${view}-${center[0]}-${center[1]}-${sites.length}`}
        center={center}
        zoom={11}
        style={{ height: 420, width: '100%' }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {sites.map((site) => {
          const count = site.projects.length;
          const icon = count > 1 ? countIcon(count) : singleIcon;
          return (
            <Marker
              key={site.key}
              position={[site.locationLat, site.locationLng]}
              icon={icon}
            >
              <Popup>
                <strong>
                  {site.packageName
                    ? `${site.packageName} · ${count} project${count === 1 ? '' : 's'}`
                    : count > 1
                      ? `${count} projects at this site`
                      : `${site.projects[0].code}: ${site.projects[0].name}`}
                </strong>
                <br />
                {site.clientName}
                {site.address ? (
                  <>
                    <br />
                    {site.address}
                  </>
                ) : null}
                <ul style={{ margin: '8px 0 0', paddingLeft: 16 }}>
                  {site.projects
                    .slice()
                    .sort((a, b) => (a.standNumber || 0) - (b.standNumber || 0))
                    .map((p) => (
                      <li key={p.id}>
                        <Link href={`/projects/${p.id}`}>
                          {p.standNumber != null ? `Stand ${p.standNumber}` : p.code}: {p.name} (
                          {p.status})
                        </Link>
                      </li>
                    ))}
                </ul>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>
      {sites.length === 0 && (
        <p className="muted" style={{ marginTop: 8 }}>
          No pins for this view yet.
        </p>
      )}
      <p className="muted" style={{ marginTop: 8 }}>
        Showing {sites.length} site{sites.length === 1 ? '' : 's'} · {projectTotal} project
        {projectTotal === 1 ? '' : 's'}
      </p>
    </div>
  );
}

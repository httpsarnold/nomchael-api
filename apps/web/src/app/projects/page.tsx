'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { LoadingState } from '@/components/LoadingState';
import { api, money } from '@/lib/api';

type Project = {
  id: string;
  code: string;
  name: string;
  status: string;
  propertyType?: string;
  amountDueCents: number;
  completionPercent: number;
  address?: string | null;
  locationNotes?: string | null;
  client: { name: string };
};

function statusLabel(status: string) {
  if (status === 'ACTIVE') return 'File open';
  if (status === 'DRAFT') return 'Registered';
  if (status === 'QUOTED') return 'Quoted';
  return status.replace(/_/g, ' ');
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api<Project[]>('/projects')
      .then(setProjects)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return projects.filter((p) => {
      if (statusFilter && p.status !== statusFilter) return false;
      if (!q) return true;
      const hay = [
        p.code,
        p.name,
        p.client?.name,
        p.propertyType,
        p.address,
        p.locationNotes,
        statusLabel(p.status),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [projects, search, statusFilter]);

  return (
    <AppShell>
      <h1>All projects</h1>
      {error && <p className="error">{error}</p>}
      {loading && <LoadingState label="Loading projects…" />}

      {!loading && (
        <>
          <div className="panel" style={{ marginTop: '1rem' }}>
            <h3>Project areas</h3>
            <div className="project-hub-links">
              <Link className="project-hub-card" href="/open-project">
                <strong>Open a project</strong>
                <span>Site visit → quote → MD opens the file</span>
              </Link>
              <Link className="project-hub-card" href="/timeline">
                <strong>Project timeline</strong>
                <span>Deadlines, overlaps, labour order</span>
              </Link>
              <Link className="project-hub-card" href="/site-visits">
                <strong>Site visits</strong>
                <span>Schedule and take visit fees</span>
              </Link>
              <Link className="project-hub-card" href="/quotations">
                <strong>Quotations</strong>
                <span>Build and send quotes</span>
              </Link>
              <Link className="project-hub-card" href="/stock">
                <strong>Materials</strong>
                <span>Stores, purchase and use on site</span>
              </Link>
              <Link className="project-hub-card" href="/map">
                <strong>Project map</strong>
                <span>Sites with GPS on file</span>
              </Link>
            </div>
          </div>

          <div className="panel" style={{ marginTop: '1rem' }}>
            <div
              className="row-actions"
              style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}
            >
              <h3 style={{ margin: 0 }}>Portfolio</h3>
              <Link className="btn secondary" href="/timeline">
                Open programme Gantt
              </Link>
            </div>
            <div
              className="row-actions"
              style={{ flexWrap: 'wrap', gap: 12, marginTop: 12, alignItems: 'flex-end' }}
            >
              <label style={{ flex: '1 1 240px', minWidth: 200 }}>
                Search projects
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Code, name, client, address…"
                />
              </label>
              <label style={{ minWidth: 160 }}>
                Status
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                  <option value="">All statuses</option>
                  <option value="DRAFT">Registered</option>
                  <option value="QUOTED">Quoted</option>
                  <option value="ACTIVE">File open</option>
                  <option value="ON_HOLD">On hold</option>
                  <option value="COMPLETED">Completed</option>
                </select>
              </label>
            </div>
            <p className="muted" style={{ marginTop: 8 }}>
              Showing {filtered.length} of {projects.length} project
              {projects.length === 1 ? '' : 's'}
            </p>

            <div className="table-wrap" style={{ marginTop: 12 }}>
              <table>
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Name</th>
                    <th>Client</th>
                    <th>Status</th>
                    <th>Type</th>
                    <th>Progress</th>
                    <th>Due</th>
                    <th>Open</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <Link href={`/projects/${p.id}`}>{p.code}</Link>
                      </td>
                      <td>{p.name}</td>
                      <td>{p.client?.name}</td>
                      <td>
                        <span className="badge">{statusLabel(p.status)}</span>
                      </td>
                      <td>{(p.propertyType || 'SINGLE_HOME').replace(/_/g, ' ')}</td>
                      <td>{p.completionPercent}%</td>
                      <td>{money(p.amountDueCents)}</td>
                      <td>
                        <div className="row-actions" style={{ flexWrap: 'wrap', gap: 4 }}>
                          <Link className="btn secondary" href={`/projects/${p.id}`}>
                            File
                          </Link>
                          <Link className="btn secondary" href={`/timeline?projectId=${p.id}`}>
                            Timeline
                          </Link>
                          <Link
                            className="btn secondary"
                            href={`/quotations?projectId=${p.id}`}
                          >
                            Quote
                          </Link>
                          <Link className="btn secondary" href={`/stock?projectId=${p.id}`}>
                            Stock
                          </Link>
                          <Link
                            className="btn secondary"
                            href={`/projects/${p.id}#project-payments`}
                          >
                            Pay
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!filtered.length && (
                    <tr>
                      <td colSpan={8} className="muted">
                        {search.trim() || statusFilter
                          ? 'No projects match this search.'
                          : 'No projects yet. Start from Open a project.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </AppShell>
  );
}

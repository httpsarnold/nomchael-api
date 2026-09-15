'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import { AppShell } from '@/components/AppShell';
import { LoadingState } from '@/components/LoadingState';
import { api, getUser, money } from '@/lib/api';

type Dash = {
  kpis: {
    openProjects: number;
    totalProjects: number;
    completedProjects: number;
    clients: number;
    employees: number;
    suppliers: number;
    pendingQuotations: number;
    pendingShortfalls: number;
    revenueOpenCents: number;
    quotedTotalCents: number;
    amountDueCents: number;
    projectExpenseCents: number;
    generalExpenseCents: number;
    profitCents: number;
    collectionRate: number;
  };
  byStatus: { status: string; count: number }[];
  byProject: {
    id: string;
    code: string;
    name: string;
    status: string;
    clientName: string;
    revenueCents: number;
    expenseCents: number;
    profitCents: number;
    amountDueCents: number;
    completionPercent: number;
  }[];
  attention: {
    id: string;
    code: string;
    name: string;
    amountDueCents: number;
    completionPercent: number;
    status: string;
  }[];
  pendingShortfalls: { id: string; amountCents: number; projectCode: string }[];
  recentPayments: { id: string }[];
};

const STATUS_COLORS: Record<string, string> = {
  DRAFT: '#94a3b8',
  QUOTED: '#38bdf8',
  ACTIVE: '#2563eb',
  ON_HOLD: '#f59e0b',
  COMPLETED: '#16a34a',
  CANCELLED: '#ef4444',
};

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function formatDate(d = new Date()) {
  return d.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export default function DashboardPage() {
  const [data, setData] = useState<Dash | null>(null);
  const [error, setError] = useState('');
  const [firstName, setFirstName] = useState('there');
  const [role, setRole] = useState('');

  useEffect(() => {
    const u = getUser();
    if (u?.fullName) setFirstName(u.fullName.split(' ')[0]);
    if (u?.role) setRole(u.role.replace(/_/g, ' '));
    api<Dash>('/dashboard')
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);

  const pieData = useMemo(
    () =>
      (data?.byStatus || [])
        .filter((s) => s.count > 0)
        .map((s) => ({ name: s.status, value: s.count })),
    [data],
  );

  const needsCount =
    (data?.kpis.pendingShortfalls || 0) +
    (data?.kpis.pendingQuotations || 0) +
    (data?.attention.filter((a) => a.amountDueCents > 0).length || 0);

  const avgProgress = data?.byProject.length
    ? Math.round(
        data.byProject.reduce((s, p) => s + p.completionPercent, 0) / data.byProject.length,
      )
    : 0;

  return (
    <AppShell>
      <div className="home-greeting">
        <h1>
          {greeting()}, {firstName}.
        </h1>
        <div className="date">{formatDate()}</div>
        <div className="role-badges">
          {role && <span className="badge">{role}</span>}
          <span className="badge">Nomchael ERP</span>
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      {!data && !error && <LoadingState label="Loading portfolio…" />}

      {data && (
        <>
          <div className="section-kicker">Needs you</div>
          <Link href="/finance" className="needs-card">
            <div className="needs-icon">Inbox</div>
            <div>
              <strong>
                {needsCount} finance and project items need attention
              </strong>
              <div className="muted" style={{ fontSize: '0.85rem', marginTop: 2 }}>
                {data.kpis.pendingShortfalls} shortfalls · {data.kpis.pendingQuotations}{' '}
                open quotations · {money(data.kpis.amountDueCents)} outstanding
              </div>
            </div>
          </Link>

          <div className="section-kicker">Operations</div>
          <Link href="/projects" className="project-picker">
            <div>
              <strong>No workspace locked</strong>
              <div className="muted" style={{ fontSize: '0.88rem', marginTop: 2 }}>
                Pick a project to unlock stages, stock, labour and site expenses.
              </div>
            </div>
            <span aria-hidden>→</span>
          </Link>
          <div className="grid grid-3">
            <Link href="/open-project" className="action-card">
              <strong>Open a project</strong>
              <span>Stage by stage: quote, client agree, then open the file</span>
            </Link>
            <Link href="/dashboard" className="action-card">
              <strong>Portfolio analytics</strong>
              <span>Status mix, cash and delivery</span>
            </Link>
            <Link href="/quotations" className="action-card">
              <strong>Quotations</strong>
              <span>Stage pricing and WhatsApp send</span>
            </Link>
          </div>

          <div className="section-kicker">Finance</div>
          <div className="grid grid-3">
            <Link href="/finance" className="action-card">
              <strong>Finance desk</strong>
              <span>Income, spend, debtors &amp; creditors</span>
            </Link>
            <Link href="/stock" className="action-card">
              <strong>Buy for client</strong>
              <span>Stock vs quotation; cash or credit</span>
            </Link>
            <Link href="/reports" className="action-card">
              <strong>Statements</strong>
              <span>Period reports and client PDFs</span>
            </Link>
          </div>

          <div style={{ marginTop: '1.75rem' }}>
            <h1>Portfolio Analytics</h1>
            <p className="muted">
              Status mix, collection progress and delivery across every project.
            </p>
          </div>

          <div className="info-banner">
            <span>ℹ</span>
            <span>
              Tip: open a project workspace to tick stages, attach expenses and manage stock against
              the quotation.
            </span>
          </div>

          <div className="grid grid-4">
            <div className="stat-card">
              <div>
                <div className="label">Total projects</div>
                <div className="value">{data.kpis.totalProjects}</div>
                <div className="hint">Portfolio items</div>
              </div>
              <div className="stat-icon">▦</div>
            </div>
            <div className="stat-card">
              <div>
                <div className="label">Active projects</div>
                <div className="value">{data.kpis.openProjects}</div>
                <div className="hint">In progress / quoted</div>
              </div>
              <div className="stat-icon green">↗</div>
            </div>
            <div className="stat-card">
              <div>
                <div className="label">Amount due</div>
                <div className="value" style={{ fontSize: '1.25rem' }}>
                  {money(data.kpis.amountDueCents)}
                </div>
                <div className="hint">Needs collection</div>
              </div>
              <div className="stat-icon red">!</div>
            </div>
            <div className="stat-card">
              <div>
                <div className="label">Completed</div>
                <div className="value">{data.kpis.completedProjects}</div>
                <div className="hint">Projects done</div>
              </div>
              <div className="stat-icon green">✓</div>
            </div>
          </div>

          <div className="section-kicker">Quick glance</div>
          <div className="grid grid-4">
            <div className="panel chart-panel">
              <h3>Projects by status</h3>
              {pieData.length === 0 ? (
                <p className="muted">No projects yet.</p>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={55}
                      outerRadius={80}
                      paddingAngle={2}
                    >
                      {pieData.map((entry) => (
                        <Cell
                          key={entry.name}
                          fill={STATUS_COLORS[entry.name] || '#2563eb'}
                        />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                    <text
                      x="50%"
                      y="50%"
                      textAnchor="middle"
                      dominantBaseline="middle"
                      style={{ fontSize: 22, fontWeight: 700 }}
                    >
                      {data.kpis.totalProjects}
                    </text>
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="panel">
              <h3>Collection progress</h3>
              <div className="value" style={{ fontSize: '2rem', fontWeight: 750, margin: '1rem 0 0.35rem' }}>
                {data.kpis.collectionRate}%
              </div>
              <div className="progress" style={{ height: 10 }}>
                <div
                  className="progress-bar"
                  style={{ width: `${Math.min(100, data.kpis.collectionRate)}%` }}
                />
              </div>
              <p className="muted" style={{ marginTop: 8, fontSize: '0.85rem' }}>
                Paid {money(data.kpis.revenueOpenCents)} of quoted{' '}
                {money(data.kpis.quotedTotalCents)}
              </p>
            </div>

            <div className="panel">
              <h3>Average stage progress</h3>
              <div className="value" style={{ fontSize: '2rem', fontWeight: 750, margin: '1rem 0 0.35rem' }}>
                {avgProgress}%
              </div>
              <div className="progress" style={{ height: 10 }}>
                <div className="progress-bar" style={{ width: `${avgProgress}%` }} />
              </div>
              <p className="muted" style={{ marginTop: 8, fontSize: '0.85rem' }}>
                Completed vs remaining stages on open sites
              </p>
            </div>

            <div className="panel">
              <h3>Company profit</h3>
              <div className="value" style={{ fontSize: '1.55rem', fontWeight: 750, margin: '1rem 0 0.35rem' }}>
                {money(data.kpis.profitCents)}
              </div>
              <p className="muted" style={{ fontSize: '0.85rem' }}>
                Project exp {money(data.kpis.projectExpenseCents)}
                <br />
                General exp {money(data.kpis.generalExpenseCents)}
              </p>
            </div>
          </div>

          <div className="panel" style={{ marginTop: '1rem' }}>
            <div className="panel-head">
              <h3>Open projects</h3>
              <Link href="/projects" className="muted">
                View all
              </Link>
            </div>
            {data.byProject.length === 0 ? (
              <div className="empty-block">
                <p className="muted">Create a client and open a project to populate analytics.</p>
                <Link className="btn" href="/projects">
                  Open a project
                </Link>
              </div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Code</th>
                      <th>Project</th>
                      <th>Client</th>
                      <th>Status</th>
                      <th>Due</th>
                      <th>Progress</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byProject.map((p) => (
                      <tr key={p.id}>
                        <td>
                          <Link href={`/projects/${p.id}`}>{p.code}</Link>
                        </td>
                        <td>
                          <Link href={`/projects/${p.id}`}>{p.name}</Link>
                        </td>
                        <td>{p.clientName}</td>
                        <td>
                          <span className="badge">{p.status}</span>
                        </td>
                        <td>{money(p.amountDueCents)}</td>
                        <td style={{ minWidth: 120 }}>
                          <div className="progress">
                            <div
                              className="progress-bar"
                              style={{ width: `${p.completionPercent}%` }}
                            />
                          </div>
                          <span className="muted" style={{ fontSize: '0.78rem' }}>
                            {p.completionPercent}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </AppShell>
  );
}

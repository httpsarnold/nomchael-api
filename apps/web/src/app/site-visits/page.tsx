'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { BusyOverlay, LoadingState, SavePulse } from '@/components/LoadingState';
import { api, money } from '@/lib/api';

export default function SiteVisitsPage() {
  const [visits, setVisits] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [savedFlash, setSavedFlash] = useState('');
  const [form, setForm] = useState({
    clientId: '',
    projectId: '',
    address: '',
    fee: '',
    scheduledAt: '',
    notes: '',
  });
  const [payFees, setPayFees] = useState<Record<string, string>>({});

  async function load() {
    const [v, c, p] = await Promise.all([
      api('/site-visits'),
      api('/clients'),
      api('/projects'),
    ]);
    setVisits(v as any[]);
    setClients(c as any[]);
    setProjects(p as any[]);
  }

  useEffect(() => {
    setLoading(true);
    load()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const clientProjects = projects.filter((p) => p.clientId === form.clientId);

  async function createVisit(e: FormEvent) {
    e.preventDefault();
    setError('');
    const feeDollars = Number(form.fee);
    if (!Number.isFinite(feeDollars) || feeDollars <= 0) {
      setError('Enter the visit fee your company is charging for this site (amounts vary).');
      return;
    }
    if (!form.scheduledAt) {
      setError('Set the site visit date and time so it can show on the programme Gantt.');
      return;
    }
    setBusy(true);
    try {
      await api('/site-visits', {
        method: 'POST',
        body: JSON.stringify({
          clientId: form.clientId,
          projectId: form.projectId || undefined,
          address: form.address || undefined,
          feeCents: Math.round(feeDollars * 100),
          scheduledAt: new Date(form.scheduledAt).toISOString(),
          notes: form.notes || undefined,
        }),
      });
      setForm({
        clientId: form.clientId,
        projectId: '',
        address: '',
        fee: '',
        scheduledAt: '',
        notes: '',
      });
      setSavedFlash('Site visit scheduled');
      window.setTimeout(() => setSavedFlash(''), 2400);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function payVisit(visit: any) {
    setError('');
    if (!visit.projectId && !form.projectId) {
      setError('Link or select a project before taking the site visit fee.');
      return;
    }
    const typed = payFees[visit.id];
    const feeDollars = Number(
      typed != null && typed !== '' ? typed : Number(visit.feeCents) > 0 ? Number(visit.feeCents) / 100 : NaN,
    );
    if (!Number.isFinite(feeDollars) || feeDollars <= 0) {
      setError(`Enter the fee to collect for ${visit.code}. Your company sets this per visit.`);
      return;
    }
    setBusy(true);
    try {
      if (!visit.projectId && form.projectId) {
        await api(`/site-visits/${visit.id}/link-project`, {
          method: 'PATCH',
          body: JSON.stringify({ projectId: form.projectId }),
        });
      }
      await api(`/site-visits/${visit.id}/pay`, {
        method: 'POST',
        body: JSON.stringify({
          projectId: visit.projectId || form.projectId,
          method: 'CASH',
          feeCents: Math.round(feeDollars * 100),
        }),
      });
      setSavedFlash('Site visit fee paid · ready to quote');
      window.setTimeout(() => setSavedFlash(''), 2400);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function completeVisit(id: string) {
    setBusy(true);
    try {
      await api(`/site-visits/${id}/complete`, { method: 'POST' });
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      {busy && <BusyOverlay label="Saving…" />}
      <h1>Site visits</h1>
      <p className="muted">
        Schedule each visit with a date and time (it appears on the{' '}
        <Link href="/timeline">Project timeline</Link> Gantt). A paid site visit is required before
        you can create a quotation.{' '}
        <Link href="/open-project">Open a project</Link> after the fee is paid.
      </p>
      {error && <p className="error">{error}</p>}
      {savedFlash && <SavePulse label={savedFlash} />}
      {loading && <LoadingState label="Loading site visits…" />}

      {!loading && (
        <div className="grid grid-2" style={{ marginTop: '1rem' }}>
          <div className="panel">
            <h3>Schedule site visit</h3>
            <form className="form" onSubmit={createVisit}>
              <label>
                Client
                <select
                  required
                  value={form.clientId}
                  onChange={(e) =>
                    setForm({ ...form, clientId: e.target.value, projectId: '' })
                  }
                >
                  <option value="">Select…</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Project / site shell (optional now)
                <select
                  value={form.projectId}
                  onChange={(e) => setForm({ ...form, projectId: e.target.value })}
                >
                  <option value="">Select later…</option>
                  {clientProjects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.code} {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Site address
                <input
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                />
              </label>
              <label>
                Visit date and time
                <input
                  required
                  type="datetime-local"
                  value={form.scheduledAt}
                  onChange={(e) => setForm({ ...form, scheduledAt: e.target.value })}
                />
              </label>
              <label>
                Visit fee for this job (USD)
                <input
                  required
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={form.fee}
                  placeholder="You set this (varies)"
                  onChange={(e) => setForm({ ...form, fee: e.target.value })}
                />
              </label>
              <label>
                Notes
                <input
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </label>
              <button className="btn" type="submit" disabled={busy}>
                Schedule visit
              </button>
            </form>
          </div>

          <div className="panel">
            <h3>All visits</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Client</th>
                    <th>Project</th>
                    <th>When</th>
                    <th>Fee</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {visits.map((v) => (
                    <tr key={v.id}>
                      <td>{v.code}</td>
                      <td>{v.client?.name}</td>
                      <td>
                        {v.project ? `${v.project.code}` : '—'}
                      </td>
                      <td>
                        {v.scheduledAt
                          ? new Date(v.scheduledAt).toLocaleString(undefined, {
                              dateStyle: 'medium',
                              timeStyle: 'short',
                            })
                          : '—'}
                      </td>
                      <td>
                        {Number(v.feeCents) > 0 ? money(v.feeCents) : <span className="muted">Set at payment</span>}
                      </td>
                      <td>
                        <span className="badge">{v.status}</span>
                      </td>
                      <td className="row-actions">
                        {v.status === 'SCHEDULED' && (
                          <>
                            <input
                              type="number"
                              min="0.01"
                              step="0.01"
                              style={{ width: 100 }}
                              placeholder="Fee"
                              value={
                                payFees[v.id] ??
                                (Number(v.feeCents) > 0 ? String(Number(v.feeCents) / 100) : '')
                              }
                              onChange={(e) =>
                                setPayFees((prev) => ({ ...prev, [v.id]: e.target.value }))
                              }
                            />
                            <button
                              type="button"
                              className="btn"
                              onClick={() => payVisit(v)}
                              disabled={busy}
                            >
                              Take fee
                            </button>
                          </>
                        )}
                        {v.status === 'PAID' && (
                          <button
                            type="button"
                            className="btn secondary"
                            onClick={() => completeVisit(v.id)}
                            disabled={busy}
                          >
                            Mark done
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!visits.length && (
                    <tr>
                      <td colSpan={7} className="muted">
                        No site visits yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}

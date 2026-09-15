'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AppShell } from '@/components/AppShell';
import { LoadingState } from '@/components/LoadingState';
import { ProjectProgressVisual } from '@/components/ProjectProgressVisual';
import { api, downloadPdf, money } from '@/lib/api';

function statusMeaning(status: string) {
  if (status === 'DRAFT') return 'Registered. Not opened yet. Start quoting.';
  if (status === 'QUOTED') return 'Quoted. Waiting for client agreement and MD approval before the file opens.';
  if (status === 'ACTIVE') return 'File open. Site work and payments can run.';
  if (status === 'ON_HOLD') return 'On hold.';
  if (status === 'COMPLETED') return 'Completed.';
  if (status === 'CANCELLED') return 'Cancelled.';
  return status.replace(/_/g, ' ');
}

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;
  const [project, setProject] = useState<any>(null);
  const [pnl, setPnl] = useState<any>(null);
  const [labour, setLabour] = useState({ stageId: '', labourCents: '' });
  const [expense, setExpense] = useState({
    category: 'Site food',
    description: '',
    amount: '',
    kind: 'PROJECT_SITE',
  });
  const [payment, setPayment] = useState({ amount: '', method: 'CASH' });
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [creatingQuote, setCreatingQuote] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);

  async function downloadProjectPdf() {
    setError('');
    setPdfBusy(true);
    try {
      await downloadPdf(`/projects/${id}/pdf`, `project-${project?.code || id}.pdf`);
      setInfo('Project PDF downloaded.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPdfBusy(false);
    }
  }

  async function downloadLedgerPdf() {
    setError('');
    setPdfBusy(true);
    try {
      await downloadPdf(
        `/projects/${id}/ledger/pdf`,
        `ledger-${project?.code || id}.pdf`,
      );
      setInfo('Project DR/CR ledger PDF downloaded.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPdfBusy(false);
    }
  }

  async function downloadQuotePdf(quoteId: string, version: number) {
    setError('');
    setPdfBusy(true);
    try {
      await downloadPdf(
        `/quotations/${quoteId}/pdf`,
        `quotation-${project?.code || id}-v${version}.pdf`,
      );
      setInfo(`Quotation v${version} PDF downloaded.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPdfBusy(false);
    }
  }

  async function loadProjectOnly() {
    const p = await api(`/projects/${id}`);
    setProject(p);
  }

  async function load() {
    const [p, r] = await Promise.all([
      api(`/projects/${id}`),
      api(`/reports/project/${id}/pnl`).catch(() => null),
    ]);
    setProject(p);
    setPnl(r);
  }

  useEffect(() => {
    if (id) load().catch((e) => setError(e.message));
  }, [id]);

  useEffect(() => {
    if (typeof window === 'undefined' || !id) return;
    const q = new URLSearchParams(window.location.search);
    if (q.get('registered') === '1') {
      setInfo(
        'Project registered. Start quoting below. The file opens only after the client agrees and MD approves.',
      );
      router.replace(`/projects/${id}`, { scroll: false });
    } else if (q.get('opened') === '1') {
      setInfo('File opened. Project is ACTIVE. You can run stages, stock and payments.');
      router.replace(`/projects/${id}`, { scroll: false });
    }
  }, [id, router]);

  async function toggleStage(stageId: string, completed: boolean) {
    await api(`/projects/${id}/stages/${stageId}/complete`, {
      method: 'POST',
      body: JSON.stringify({ completed: !completed }),
    });
    await loadProjectOnly();
  }

  async function saveLabour(e: FormEvent) {
    e.preventDefault();
    await api(`/quotations/projects/${id}/stages/${labour.stageId}/labour`, {
      method: 'POST',
      body: JSON.stringify({ labourCents: Math.round(Number(labour.labourCents) * 100) }),
    });
    setLabour({ stageId: '', labourCents: '' });
    await loadProjectOnly();
  }

  async function createQuote() {
    setError('');
    setCreatingQuote(true);
    try {
      const quote = await api<{ id: string }>('/quotations', {
        method: 'POST',
        body: JSON.stringify({ projectId: id }),
      });
      router.push(`/quotations?quoteId=${quote.id}`);
    } catch (err) {
      setError((err as Error).message);
      setCreatingQuote(false);
    }
  }

  async function addExpense(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (Number(project?.amountPaidCents || 0) <= 0) {
      setError('Record client income (Take payment) before recording a project expense.');
      return;
    }
    try {
      await api('/expenses', {
        method: 'POST',
        body: JSON.stringify({
          scope: 'PROJECT',
          kind: 'PROJECT_SITE',
          projectId: id,
          category: expense.category,
          description: expense.description,
          amountCents: Math.round(Number(expense.amount) * 100),
        }),
      });
      setExpense({ category: 'Site food', description: '', amount: '', kind: 'PROJECT_SITE' });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function addPayment(e: FormEvent) {
    e.preventDefault();
    await api('/payments', {
      method: 'POST',
      body: JSON.stringify({
        projectId: id,
        amountCents: Math.round(Number(payment.amount) * 100),
        method: payment.method,
        print: true,
      }),
    });
    setPayment({ amount: '', method: 'CASH' });
    await load();
  }

  if (!project) {
    return (
      <AppShell>
        {error ? <p className="error">{error}</p> : <LoadingState label="Loading project…" />}
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="project-header">
        <div>
          <div className="row-actions" style={{ alignItems: 'center', marginBottom: 6 }}>
            <Link href="/projects" className="muted">
              ← All projects
            </Link>
            <span className="badge">{project.status}</span>
          </div>
          <h1>{project.name}</h1>
          <div className="meta">
            {project.code} · {project.client?.name} ·{' '}
            {(project.propertyType || 'SINGLE_HOME').replace(/_/g, ' ')}
            {project.unitCount > 1 ? ` · ${project.unitCount} homes` : ''} ·{' '}
            {project.bedrooms || 0} bed / {project.bathrooms || 0} bath ·{' '}
            {project.address || project.locationNotes || 'No address'}
          </div>
        </div>
        <div style={{ minWidth: 160 }}>
          <div className="muted" style={{ fontSize: '0.8rem', marginBottom: 4 }}>
            Progress {project.completionPercent}%
          </div>
          <div className="progress" style={{ height: 10 }}>
            <div
              className="progress-bar"
              style={{ width: `${project.completionPercent}%`, background: '#16a34a' }}
            />
          </div>
          <button
            type="button"
            className="btn secondary"
            style={{ marginTop: 10, width: '100%' }}
            disabled={pdfBusy}
            onClick={downloadProjectPdf}
          >
            {pdfBusy ? 'Preparing PDF…' : 'Download project PDF'}
          </button>
        </div>
      </div>

      <div className="tabs">
        <a className="tab active" href="#overview">
          Overview
        </a>
        <a className="tab" href="#stages">
          Stages
        </a>
        <Link className="tab" href={`/quotations?projectId=${id}`}>
          Quotations
        </Link>
        <Link className="tab" href={`/stock?projectId=${id}`}>
          Materials
        </Link>
        <Link className="tab" href={`/timeline?projectId=${id}`}>
          Project timeline
        </Link>
        <a className="tab" href="#project-payments">
          Payments
        </a>
      </div>

      <div className="info-banner">
        <span>ℹ</span>
        <span>{statusMeaning(project.status)}</span>
      </div>

      {info && (
        <div className="info-banner" style={{ marginTop: '0.75rem', borderColor: '#16a34a' }}>
          <span>✓</span>
          <span>{info}</span>
        </div>
      )}

      {error && <p className="error">{error}</p>}

      <div id="overview" className="panel" style={{ marginTop: '1rem' }}>
        <ProjectProgressVisual
          projectCode={project.code}
          completionPercent={project.completionPercent}
          plannedStartAt={project.plannedStartAt}
          plannedEndAt={project.plannedEndAt}
          stages={project.stages || []}
        />
      </div>

      {project.status !== 'ACTIVE' && project.status !== 'COMPLETED' && (
        <div className="panel" style={{ marginTop: '1rem' }}>
          <h3>Start quoting</h3>
          <p className="muted" style={{ marginTop: 0 }}>
            Build the quotation, send it to the client, mark when they agree, then MD opens the
            file. You can also start a quote from Quotations without opening a file first.
          </p>
          <button className="btn" type="button" onClick={createQuote} disabled={creatingQuote}>
            {creatingQuote ? 'Opening quotation…' : 'New quotation'}
          </button>
        </div>
      )}

      <div className="panel" style={{ marginTop: '1rem' }}>
        <h3>Download PDFs</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          Project dossier covers stages, money, quotes and stock. DR/CR ledger is the project audit
          balance for payments vs spend and supplier credit.
        </p>
        <div className="row-actions">
          <button
            type="button"
            className="btn"
            disabled={pdfBusy}
            onClick={downloadProjectPdf}
          >
            {pdfBusy ? 'Preparing PDF…' : 'Download project PDF'}
          </button>
          <button
            type="button"
            className="btn secondary"
            disabled={pdfBusy}
            onClick={downloadLedgerPdf}
          >
            Download DR/CR ledger PDF
          </button>
        </div>
        {project.quotations?.length > 0 && (
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table>
              <thead>
                <tr>
                  <th>Quotation</th>
                  <th>Status</th>
                  <th>Total</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {project.quotations.map((q: any) => (
                  <tr key={q.id}>
                    <td>v{q.version}</td>
                    <td>
                      <span className="badge">{q.status}</span>
                    </td>
                    <td>{money(q.totalCents)}</td>
                    <td>
                      <button
                        type="button"
                        className="btn secondary"
                        disabled={pdfBusy}
                        onClick={() => downloadQuotePdf(q.id, q.version)}
                      >
                        Download PDF
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className={`gps-banner ${project.locationLat == null ? 'gps-banner-needed' : ''}`}>
        <div>
          <strong>
            {project.locationLat != null && project.locationLng != null
              ? 'Site GPS on file'
              : project.status === 'ACTIVE'
                ? 'Capture GPS on site'
                : 'GPS after file open'}
          </strong>
          <span className="muted">
            {project.locationLat != null && project.locationLng != null
              ? `${project.locationLat}, ${project.locationLng}`
              : project.status === 'ACTIVE'
                ? 'File is open. Capture coordinates at the plot (not at site visit).'
                : 'Coordinates are captured after MD opens the file, not during site visit or quoting.'}
          </span>
        </div>
        {project.status === 'ACTIVE' ? (
          <Link className="btn" href={`/projects/${id}/capture`}>
            {project.locationLat != null ? 'Update GPS' : 'Capture on site'}
          </Link>
        ) : (
          <span className="badge">Wait for ACTIVE</span>
        )}
      </div>

      <div className="section-kicker">This project</div>
      <div className="client-balance-banner">
        <div>
          <div className="label">Client balance</div>
          <div className="value">{money(project.amountDueCents)}</div>
          <div className="hint">
            {project.client?.name || 'Client'} still owes this against the quotation
          </div>
        </div>
        <div className="client-balance-split">
          <div>
            <span>Quoted</span>
            <strong>{money(project.quotationTotalCents)}</strong>
          </div>
          <div>
            <span>Paid</span>
            <strong>{money(project.amountPaidCents)}</strong>
          </div>
          <div>
            <span>Balance due</span>
            <strong>{money(project.amountDueCents)}</strong>
          </div>
        </div>
      </div>
      <div className="grid grid-4">
        <div className="stat-card">
          <div>
            <div className="label">Property</div>
            <div className="value" style={{ fontSize: '1.05rem' }}>
              {(project.propertyType || 'SINGLE_HOME').replace(/_/g, ' ')}
            </div>
            <div className="hint">
              {project.unitCount || 1} home{(project.unitCount || 1) > 1 ? 's' : ''}
              {Number(project.storeys) >= 2
                ? ` · upstairs (${project.storeys} storeys)`
                : ' · ground floor only'}
              {project.floorAreaSqm ? ` · ${project.floorAreaSqm} m² each` : ''}
            </div>
          </div>
          <div className="stat-icon">⌂</div>
        </div>
        <div className="stat-card">
          <div>
            <div className="label">Quoted</div>
            <div className="value" style={{ fontSize: '1.25rem' }}>
              {money(project.quotationTotalCents)}
            </div>
            <div className="hint">Contract value</div>
          </div>
          <div className="stat-icon">$</div>
        </div>
        <div className="stat-card">
          <div>
            <div className="label">Paid</div>
            <div className="value" style={{ fontSize: '1.25rem' }}>
              {money(project.amountPaidCents)}
            </div>
            <div className="hint">Received from client</div>
          </div>
          <div className="stat-icon green">✓</div>
        </div>
        <div className="stat-card">
          <div>
            <div className="label">Client balance</div>
            <div className="value" style={{ fontSize: '1.25rem' }}>
              {money(project.amountDueCents)}
            </div>
            <div className="hint">Progress {project.completionPercent}%</div>
          </div>
          <div className="stat-icon">⚖</div>
        </div>
      </div>

      {(project.rooms?.length > 0 || project.propertyNotes) && (
        <div className="panel" style={{ marginTop: '1rem' }}>
          <h3>Room schedule</h3>
          {project.propertyNotes && (
            <p className="muted" style={{ marginBottom: 8 }}>
              {project.propertyNotes}
            </p>
          )}
          {project.rooms?.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Label</th>
                    <th>Qty</th>
                    <th>Floor</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {project.rooms.map((r: any) => (
                    <tr key={r.id}>
                      <td>{String(r.roomType).replace(/_/g, ' ')}</td>
                      <td>{r.label || '—'}</td>
                      <td>{r.quantity}</td>
                      <td>{r.floorLevel || '—'}</td>
                      <td>{r.notes || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-2" style={{ marginTop: '1rem' }}>
        <div className="panel" id="stages">
          <div className="panel-head">
            <h3>Stages</h3>
            <button
              className="btn secondary"
              type="button"
              onClick={createQuote}
              disabled={creatingQuote}
            >
              {creatingQuote ? 'Opening…' : 'New quotation'}
            </button>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Stage</th>
                  <th>Plan</th>
                  <th>Schedule</th>
                  <th>Labour</th>
                  <th>Done</th>
                </tr>
              </thead>
              <tbody>
                {project.stages?.map((s: any) => {
                  const end = s.plannedEndAt ? new Date(s.plannedEndAt) : null;
                  const now = new Date();
                  let schedule = 'No plan';
                  let danger = false;
                  if (s.isCompleted) schedule = 'Done';
                  else if (end) {
                    const behind = Math.max(
                      0,
                      Math.round((now.getTime() - end.getTime()) / 86400000),
                    );
                    if (behind > 0) {
                      schedule = `${behind}d behind`;
                      danger = true;
                    } else schedule = 'On track';
                  }
                  return (
                    <tr key={s.id}>
                      <td>{s.name}</td>
                      <td className="muted" style={{ fontSize: '0.85rem' }}>
                        {s.plannedStartAt || s.plannedEndAt
                          ? `${s.plannedStartAt ? new Date(s.plannedStartAt).toLocaleDateString() : '—'} → ${s.plannedEndAt ? new Date(s.plannedEndAt).toLocaleDateString() : '—'}`
                          : '—'}
                      </td>
                      <td>
                        <span className={`badge${danger ? ' danger' : s.isCompleted ? ' ok' : ''}`}>
                          {schedule}
                        </span>
                      </td>
                      <td>{money(s.labourCents)}</td>
                      <td>
                        <button
                          className={`btn ${s.isCompleted ? '' : 'secondary'}`}
                          type="button"
                          onClick={() => toggleStage(s.id, s.isCompleted)}
                        >
                          {s.isCompleted ? 'Completed' : 'Mark done'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <form className="form" onSubmit={saveLabour} style={{ marginTop: '1rem' }}>
            <h3>Set stage labour</h3>
            <label>
              Stage
              <select
                required
                value={labour.stageId}
                onChange={(e) => setLabour({ ...labour, stageId: e.target.value })}
              >
                <option value="">Select…</option>
                {project.stages?.map((s: any) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Labour amount (USD)
              <input
                required
                value={labour.labourCents}
                onChange={(e) => setLabour({ ...labour, labourCents: e.target.value })}
              />
            </label>
            <button className="btn" type="submit">
              Save labour
            </button>
          </form>
        </div>

        <div className="panel" id="project-payments">
          <h3>Project payments & costs</h3>
          <p className="muted" style={{ marginTop: 0 }}>
            Money for <strong>{project.code}</strong> only. Site visit fees and quotation payments
            for this job appear here.
          </p>
          {pnl && (
            <>
              <p className="muted">Revenue: {money(pnl.revenueCents)}</p>
              <p className="muted">
                {pnl.siteVisitFeeRevenueCents != null && (
                  <>
                    Site visit fees: {money(pnl.siteVisitFeeRevenueCents)}
                    {' · '}
                  </>
                )}
                Expenses: {money(pnl.totalExpenseCents)}
              </p>
              <p>
                <strong>Profit: {money(pnl.profitCents)}</strong>
              </p>
              <div style={{ height: 220 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={[
                      { name: 'Revenue', value: pnl.revenueCents / 100 },
                      { name: 'Expenses', value: pnl.totalExpenseCents / 100 },
                      { name: 'Profit', value: pnl.profitCents / 100 },
                    ]}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="value" fill="#2563eb" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </>
          )}

          <div className="table-wrap" style={{ marginTop: '1rem' }}>
            <h3 style={{ marginTop: 0 }}>Payments on this project</h3>
            <table>
              <thead>
                <tr>
                  <th>Receipt</th>
                  <th>Type</th>
                  <th>When</th>
                  <th>Method</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {(project.payments || []).map((p: any) => (
                  <tr key={p.id}>
                    <td>{p.receiptNumber}</td>
                    <td>
                      {p.purpose === 'SITE_VISIT' ? (
                        <span className="badge ok">Site visit</span>
                      ) : (
                        <span className="badge">Project</span>
                      )}
                    </td>
                    <td>{new Date(p.paidAt).toLocaleDateString()}</td>
                    <td>{p.method}</td>
                    <td>{money(p.amountCents)}</td>
                  </tr>
                ))}
                {!(project.payments || []).length && (
                  <tr>
                    <td colSpan={5} className="muted">
                      No payments recorded on this project yet
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <form className="form" onSubmit={addPayment} style={{ marginTop: '1rem' }}>
            <h3>1. Record payment + Epson receipt</h3>
            <p className="muted" style={{ marginTop: 0 }}>
              Client balance on this project: <strong>{money(project.amountDueCents)}</strong>
              {' · '}
              Paid {money(project.amountPaidCents)} of {money(project.quotationTotalCents)}
            </p>
            <label>
              Amount (USD)
              <input
                required
                value={payment.amount}
                onChange={(e) => setPayment({ ...payment, amount: e.target.value })}
              />
            </label>
            <label>
              Method
              <select
                value={payment.method}
                onChange={(e) => setPayment({ ...payment, method: e.target.value })}
              >
                <option value="CASH">Cash</option>
                <option value="BANK_TRANSFER">Bank transfer</option>
                <option value="MOBILE_MONEY">Mobile money</option>
                <option value="CHEQUE">Cheque</option>
              </select>
            </label>
            <button className="btn" type="submit">
              Take payment for {project.code}
            </button>
          </form>
          <form className="form" onSubmit={addExpense} style={{ marginTop: '1rem' }}>
            <h3>2. Site costs on this project</h3>
            {Number(project.amountPaidCents || 0) <= 0 ? (
              <p className="error" style={{ marginTop: 0 }}>
                Take a client payment first. Project costs are only allowed after income is recorded.
              </p>
            ) : (
              <p className="muted" style={{ marginTop: 0 }}>
                Food and other site costs charge this client project. Personal fuel for an employee
                is recorded on the <Link href="/finance">Finance desk</Link> (not here). Materials
                go through <Link href={`/stock?projectId=${id}`}>Stores &amp; Stock</Link>.
              </p>
            )}
            <label>
              Category
              <select
                value={expense.category}
                onChange={(e) => setExpense({ ...expense, category: e.target.value })}
                disabled={Number(project.amountPaidCents || 0) <= 0}
              >
                <option>Site food</option>
                <option>Machinery hire</option>
                <option>Transport</option>
                <option>Other</option>
              </select>
            </label>
            <label>
              Description
              <input
                required
                value={expense.description}
                onChange={(e) => setExpense({ ...expense, description: e.target.value })}
                disabled={Number(project.amountPaidCents || 0) <= 0}
              />
            </label>
            <label>
              Amount (USD)
              <input
                required
                value={expense.amount}
                onChange={(e) => setExpense({ ...expense, amount: e.target.value })}
                disabled={Number(project.amountPaidCents || 0) <= 0}
              />
            </label>
            <button
              className="btn"
              type="submit"
              disabled={Number(project.amountPaidCents || 0) <= 0}
            >
              Save cost on {project.code}
            </button>
          </form>
        </div>
      </div>
    </AppShell>
  );
}

'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AppShell } from '@/components/AppShell';
import { LoadingState } from '@/components/LoadingState';
import { api, downloadPdf, money } from '@/lib/api';

type Period = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';

const PERIODS: { id: Period; label: string }[] = [
  { id: 'daily', label: 'Daily' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'quarterly', label: 'Quarterly' },
  { id: 'yearly', label: 'Yearly' },
];

export default function ReportsPage() {
  const [period, setPeriod] = useState<Period>('monthly');
  const [projectId, setProjectId] = useState('');
  const [projects, setProjects] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [clientId, setClientId] = useState('');
  const [clientLabel, setClientLabel] = useState('');
  const [clientSearch, setClientSearch] = useState('');
  const [clientMenuOpen, setClientMenuOpen] = useState(false);
  const [clientSearching, setClientSearching] = useState(false);
  const [clientFrom, setClientFrom] = useState('');
  const [clientTo, setClientTo] = useState('');
  const [clientStatement, setClientStatement] = useState<any>(null);
  const [clientBusy, setClientBusy] = useState(false);
  const clientSearchRef = useRef<HTMLDivElement>(null);
  const [statement, setStatement] = useState<any>(null);
  const [income, setIncome] = useState<any>(null);
  const [balance, setBalance] = useState<any>(null);
  const [csv, setCsv] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  async function loadProjects() {
    setProjects(await api('/projects'));
  }

  async function loadClients(search = '') {
    const path = search.trim()
      ? `/clients?q=${encodeURIComponent(search.trim())}`
      : '/clients';
    setClients(await api(path));
  }

  async function loadStatements() {
    setLoading(true);
    setError('');
    const q = new URLSearchParams({ period });
    if (projectId) q.set('projectId', projectId);

    const results = await Promise.allSettled([
      api(`/reports/company/period-statement?${q.toString()}`),
      api('/reports/company/income-statement'),
      api('/reports/company/balance-sheet'),
      api<{ csv: string }>('/reports/company/accounting-csv'),
    ]);

    const [s, i, b, c] = results;
    if (s.status === 'fulfilled') setStatement(s.value);
    if (i.status === 'fulfilled') setIncome(i.value);
    if (b.status === 'fulfilled') setBalance(b.value);
    if (c.status === 'fulfilled') setCsv(c.value.csv);

    const failed = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    if (failed.length === results.length) {
      setError(failed[0]?.reason?.message || 'Failed to load reports');
    } else if (failed.length) {
      setError('Some report sections could not load. Showing what is available.');
    }
    setLoading(false);
  }

  useEffect(() => {
    Promise.all([loadProjects(), loadClients()]).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    loadStatements().catch((e) => {
      setError(e.message);
      setLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, projectId]);

  useEffect(() => {
    const term = clientSearch.trim();
    if (!clientMenuOpen) return;
    const t = setTimeout(() => {
      setClientSearching(true);
      loadClients(term)
        .catch((e) => setError(e.message))
        .finally(() => setClientSearching(false));
    }, 250);
    return () => clearTimeout(t);
  }, [clientSearch, clientMenuOpen]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!clientSearchRef.current?.contains(e.target as Node)) {
        setClientMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const selectedClientName = useMemo(() => {
    if (clientLabel) return clientLabel;
    return clients.find((c) => c.id === clientId)?.name || '';
  }, [clientLabel, clients, clientId]);

  function pickClient(c: any) {
    setClientId(c.id);
    setClientLabel(c.name);
    setClientSearch(c.name);
    setClientMenuOpen(false);
    setClientStatement(null);
  }

  function clearClient() {
    setClientId('');
    setClientLabel('');
    setClientSearch('');
    setClientStatement(null);
    loadClients().catch(() => undefined);
  }

  async function loadClientStatement() {
    if (!clientId) {
      setClientStatement(null);
      return;
    }
    setClientBusy(true);
    setError('');
    try {
      const q = new URLSearchParams();
      if (clientFrom) q.set('from', clientFrom);
      if (clientTo) q.set('to', clientTo);
      const qs = q.toString();
      const data = await api(`/clients/${clientId}/statement${qs ? `?${qs}` : ''}`);
      setClientStatement(data);
    } catch (e: any) {
      setError(e.message || 'Failed to load client statement');
      setClientStatement(null);
    } finally {
      setClientBusy(false);
    }
  }

  async function downloadClientPdf() {
    if (!clientId) return;
    setClientBusy(true);
    setError('');
    try {
      const q = new URLSearchParams();
      if (clientFrom) q.set('from', clientFrom);
      if (clientTo) q.set('to', clientTo);
      const qs = q.toString();
      const name = clientLabel || clientStatement?.client?.name || 'client';
      await downloadPdf(
        `/clients/${clientId}/statement/pdf${qs ? `?${qs}` : ''}`,
        `client-statement-${name}.pdf`,
      );
    } catch (e: any) {
      setError(e.message || 'PDF download failed');
    } finally {
      setClientBusy(false);
    }
  }

  function downloadCsv() {
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nomchael-income-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const summary = statement?.summary;

  return (
    <AppShell>
      <h1>Reports & statements</h1>
      <p className="muted">
        Daily, weekly, monthly, quarterly and yearly statements for money in, stock buys, stock use
        and leftovers.
      </p>
      {loading && <LoadingState label="Loading statements…" />}
      {error && <p className="error">{error}</p>}

      <div className="panel" style={{ marginTop: '1rem' }}>
        <h3>Individual client statement</h3>
        <p className="muted">
          Pick a client to view quoted totals, payments and outstanding balance. Download a PDF for
          that client only.
        </p>
        <div className="row-actions" style={{ flexWrap: 'wrap', gap: 12, marginTop: 12, alignItems: 'flex-end' }}>
          <div ref={clientSearchRef} style={{ position: 'relative', minWidth: 280, flex: '1 1 280px' }}>
            <label style={{ display: 'block' }}>
              Search client
              <input
                value={clientSearch}
                placeholder="Type name, phone, or company…"
                autoComplete="off"
                onFocus={() => setClientMenuOpen(true)}
                onChange={(e) => {
                  setClientSearch(e.target.value);
                  setClientMenuOpen(true);
                  if (clientId && e.target.value !== selectedClientName) {
                    setClientId('');
                    setClientLabel('');
                    setClientStatement(null);
                  }
                }}
              />
            </label>
            {clientMenuOpen && (
              <div
                className="panel"
                style={{
                  position: 'absolute',
                  zIndex: 20,
                  left: 0,
                  right: 0,
                  marginTop: 4,
                  maxHeight: 260,
                  overflowY: 'auto',
                  padding: 0,
                }}
              >
                {clientSearching && (
                  <p className="muted" style={{ margin: 0, padding: '0.75rem' }}>
                    Searching…
                  </p>
                )}
                {!clientSearching &&
                  clients.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className="btn secondary"
                      style={{
                        display: 'block',
                        width: '100%',
                        textAlign: 'left',
                        borderRadius: 0,
                        border: 'none',
                        borderBottom: '1px solid var(--border, #e5e7eb)',
                      }}
                      onClick={() => pickClient(c)}
                    >
                      <strong>{c.name}</strong>
                      <span className="muted" style={{ display: 'block', fontSize: '0.85rem' }}>
                        {c.type === 'COMPANY' ? 'Company' : 'Person'}
                        {c.phone ? ` · ${c.phone}` : ''}
                        {c.parentClient?.name ? ` · under ${c.parentClient.name}` : ''}
                        {typeof c._count?.projects === 'number'
                          ? ` · ${c._count.projects} project${c._count.projects === 1 ? '' : 's'}`
                          : ''}
                      </span>
                    </button>
                  ))}
                {!clientSearching && !clients.length && (
                  <p className="muted" style={{ margin: 0, padding: '0.75rem' }}>
                    No clients match “{clientSearch.trim() || '…'}”
                  </p>
                )}
              </div>
            )}
            {clientId && (
              <p className="muted" style={{ margin: '6px 0 0' }}>
                Selected: <strong style={{ color: 'inherit' }}>{selectedClientName}</strong>{' '}
                <button type="button" className="btn secondary" style={{ padding: '2px 8px' }} onClick={clearClient}>
                  Clear
                </button>
              </p>
            )}
          </div>
          <label>
            From (optional)
            <input type="date" value={clientFrom} onChange={(e) => setClientFrom(e.target.value)} />
          </label>
          <label>
            To (optional)
            <input type="date" value={clientTo} onChange={(e) => setClientTo(e.target.value)} />
          </label>
          <button
            type="button"
            className="btn secondary"
            disabled={!clientId || clientBusy}
            onClick={() => loadClientStatement()}
          >
            {clientBusy ? 'Loading…' : 'View statement'}
          </button>
          <button
            type="button"
            className="btn"
            disabled={!clientId || clientBusy}
            onClick={() => downloadClientPdf()}
          >
            Download PDF
          </button>
        </div>
        {clientStatement && (
          <div style={{ marginTop: '1rem' }}>
            <p>
              <strong>{clientStatement.client.name}</strong>
              <span className="muted">
                {' '}
                · {clientStatement.summary.projectCount} project
                {clientStatement.summary.projectCount === 1 ? '' : 's'}
              </span>
            </p>
            <div className="grid grid-4" style={{ marginTop: 8 }}>
              <div className="stat-card">
                <div>
                  <div className="label">Quoted</div>
                  <div className="value" style={{ fontSize: '1.1rem' }}>
                    {money(clientStatement.summary.quotedTotalCents)}
                  </div>
                </div>
              </div>
              <div className="stat-card">
                <div>
                  <div className="label">Paid</div>
                  <div className="value" style={{ fontSize: '1.1rem' }}>
                    {money(clientStatement.summary.paidTotalCents)}
                  </div>
                </div>
              </div>
              <div className="stat-card">
                <div>
                  <div className="label">Outstanding</div>
                  <div className="value" style={{ fontSize: '1.1rem' }}>
                    {money(clientStatement.summary.outstandingCents)}
                  </div>
                </div>
              </div>
              <div className="stat-card">
                <div>
                  <div className="label">Payments listed</div>
                  <div className="value" style={{ fontSize: '1.1rem' }}>
                    {money(clientStatement.summary.paymentsInPeriodCents)}
                  </div>
                </div>
              </div>
            </div>
            <div className="table-wrap" style={{ marginTop: 12 }}>
              <table>
                <thead>
                  <tr>
                    <th>Project</th>
                    <th>Status</th>
                    <th>Quoted</th>
                    <th>Paid</th>
                    <th>Due</th>
                  </tr>
                </thead>
                <tbody>
                  {clientStatement.projects.map((p: any) => (
                    <tr key={p.id}>
                      <td>
                        {p.code} {p.name}
                      </td>
                      <td>{p.status}</td>
                      <td>{money(p.quotationTotalCents)}</td>
                      <td>{money(p.amountPaidCents)}</td>
                      <td>{money(p.outstandingCents)}</td>
                    </tr>
                  ))}
                  {!clientStatement.projects.length && (
                    <tr>
                      <td colSpan={5} className="muted">
                        No projects for this client
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <div className="panel" style={{ marginTop: '1rem' }}>
        <h3>Money cycle on a project</h3>
        <ol className="muted" style={{ margin: '0.5rem 0 0', paddingLeft: '1.25rem' }}>
          <li>
            Site visit fee is company revenue (cash in). It does not reduce the quotation balance.
          </li>
          <li>
            Client pays against the quotation (Finance → payment on the project). Cash comes in;
            amount paid on the project rises.
          </li>
          <li>
            Buy materials into that project’s stock (Stores). Purchase cost is charged as a project
            materials expense. Excess above quotation needs a funding source.
          </li>
          <li>Use stock on site as stages progress (Stores → Use on site).</li>
          <li>
            Leftover stock stays on the project until you transfer it, sell it, or return it to the
            owner.
          </li>
        </ol>
      </div>

      <div className="panel" style={{ marginTop: '1rem' }}>
        <div className="row-actions" style={{ flexWrap: 'wrap', marginBottom: 12 }}>
          {PERIODS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`btn ${period === p.id ? '' : 'secondary'}`}
              onClick={() => setPeriod(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <label style={{ maxWidth: 360 }}>
          Project filter (optional)
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">All projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} {p.name}
              </option>
            ))}
          </select>
        </label>
        {statement && (
          <p className="muted" style={{ marginTop: 8 }}>
            {period.toUpperCase()} statement · {new Date(statement.from).toLocaleDateString()} to{' '}
            {new Date(statement.to).toLocaleDateString()}
          </p>
        )}
      </div>

      {summary && (
        <div className="grid grid-4" style={{ marginTop: '1rem' }}>
          <div className="stat-card">
            <div>
              <div className="label">Project payments</div>
              <div className="value" style={{ fontSize: '1.15rem' }}>
                {money(summary.projectPaymentsCents ?? summary.clientPaymentsCents)}
              </div>
            </div>
          </div>
          <div className="stat-card">
            <div>
              <div className="label">Site visit fees (revenue)</div>
              <div className="value" style={{ fontSize: '1.15rem' }}>
                {money(summary.siteVisitFeesCents || 0)}
              </div>
            </div>
          </div>
          <div className="stat-card">
            <div>
              <div className="label">Stock purchase cost</div>
              <div className="value" style={{ fontSize: '1.15rem' }}>
                {money(summary.stockPurchaseExpenseCents)}
              </div>
            </div>
          </div>
          <div className="stat-card">
            <div>
              <div className="label">Stock used (qty)</div>
              <div className="value" style={{ fontSize: '1.15rem' }}>
                {summary.stockUsedQty}
              </div>
            </div>
          </div>
        </div>
      )}

      {statement && (
        <div className="grid grid-2" style={{ marginTop: '1rem' }}>
          <div className="panel">
            <h3>Payments in period</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Receipt</th>
                    <th>Type</th>
                    <th>Client</th>
                    <th>Project</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {statement.payments.map((p: any) => (
                    <tr key={p.id}>
                      <td>{p.receiptNumber}</td>
                      <td>
                        {p.purpose === 'SITE_VISIT' ? (
                          <span className="badge ok">Site visit revenue</span>
                        ) : (
                          <span className="badge">Project</span>
                        )}
                      </td>
                      <td>{p.clientName}</td>
                      <td>{p.projectCode}</td>
                      <td>{money(p.amountCents)}</td>
                    </tr>
                  ))}
                  {!statement.payments.length && (
                    <tr>
                      <td colSpan={5} className="muted">
                        No payments in this period
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
          <div className="panel">
            <h3>Stock movements in period</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Item</th>
                    <th>Project</th>
                    <th>Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {statement.stockMovements.map((m: any) => (
                    <tr key={m.id}>
                      <td>{m.type}</td>
                      <td>
                        {m.itemName} ({m.unit})
                      </td>
                      <td>{m.projectCode}</td>
                      <td>{m.quantity}</td>
                    </tr>
                  ))}
                  {!statement.stockMovements.length && (
                    <tr>
                      <td colSpan={4} className="muted">
                        No stock movements in this period
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
          <div className="panel">
            <h3>Leftover stock now</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Project</th>
                    <th>Item</th>
                    <th>Remaining</th>
                  </tr>
                </thead>
                <tbody>
                  {statement.leftoverStock.map((s: any, idx: number) => (
                    <tr key={`${s.projectCode}-${s.itemName}-${idx}`}>
                      <td>{s.projectCode}</td>
                      <td>
                        {s.itemName} ({s.unit})
                      </td>
                      <td>
                        <strong>{s.qtyRemaining}</strong>
                      </td>
                    </tr>
                  ))}
                  {!statement.leftoverStock.length && (
                    <tr>
                      <td colSpan={3} className="muted">
                        No leftover stock
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
          <div className="panel">
            <h3>Expenses in period</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Category</th>
                    <th>Description</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {statement.expenses.slice(0, 20).map((e: any) => (
                    <tr key={e.id}>
                      <td>{e.category}</td>
                      <td>{e.description}</td>
                      <td>{money(e.amountCents)}</td>
                    </tr>
                  ))}
                  {!statement.expenses.length && (
                    <tr>
                      <td colSpan={3} className="muted">
                        No expenses in this period
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {income && (
        <div className="grid grid-2" style={{ marginTop: '1rem' }}>
          <div className="panel">
            <h3>Income statement (YTD)</h3>
            <p>Project payments: {money(income.revenue.projectPaymentsCents)}</p>
            <p>
              Site visit fees (revenue):{' '}
              {money(income.revenue.siteVisitFeesCents || 0)}
            </p>
            <p>Stock sales: {money(income.revenue.stockSalesCents)}</p>
            <p>Total revenue: {money(income.revenue.totalCents)}</p>
            <p>Cost of sales: {money(income.costOfSales.totalCents)}</p>
            <p>Gross profit: {money(income.grossProfitCents)}</p>
            <p>Operating expenses: {money(income.operatingExpenses.totalCents)}</p>
            <p>
              <strong>Net profit: {money(income.netProfitCents)}</strong>
            </p>
            {csv && (
              <button className="btn secondary" type="button" onClick={downloadCsv}>
                Download accounting CSV
              </button>
            )}
            <div style={{ height: 280, marginTop: 16 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={[
                    {
                      name: 'Project',
                      value: income.revenue.projectPaymentsCents / 100,
                    },
                    {
                      name: 'Site visit',
                      value: (income.revenue.siteVisitFeesCents || 0) / 100,
                    },
                    { name: 'Stock', value: income.revenue.stockSalesCents / 100 },
                    { name: 'Net', value: income.netProfitCents / 100 },
                  ]}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="value" fill="#1d4ed8" name="USD" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          {balance && (
            <div className="panel">
              <h3>Balance sheet</h3>
              <p>Cash: {money(balance.assets.cashAndEquivalentsCents)}</p>
              <p>Receivables: {money(balance.assets.accountsReceivableCents)}</p>
              <p>Total assets: {money(balance.assets.totalCents)}</p>
              <p>Equity (approx): {money(balance.equity.totalCents)}</p>
            </div>
          )}
        </div>
      )}
    </AppShell>
  );
}

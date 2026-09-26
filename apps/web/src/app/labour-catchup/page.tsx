'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { LoadingState } from '@/components/LoadingState';
import { api, downloadFile, money } from '@/lib/api';

type Trail = {
  labourQuotedCents: number;
  discountCents: number;
  netDueCents: number;
  cashReceivedCents: number;
  fundUsesCents: number;
  stillAvailableCents: number;
  clientOwesCents: number;
};

type CatchupRow = {
  id: string;
  code: string;
  name: string;
  kind: string;
  catchupStageLabel?: string;
  client?: { name: string; phone: string };
  estateProgramme?: { id: string; name: string; code: string } | null;
  trail: Trail;
};

function LabourCatchupInner() {
  const searchParams = useSearchParams();
  const queryId = searchParams.get('id') || '';

  const [rows, setRows] = useState<CatchupRow[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState<any>(null);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    clientId: '',
    clientName: '',
    clientPhone: '',
    name: '',
    address: '',
    labourQuoted: '',
    discount: '',
    discountReason: '',
    catchupStageLabel: '',
    cashReceived: '',
  });

  const [receiptAmount, setReceiptAmount] = useState('');
  const [fundForm, setFundForm] = useState({
    amount: '',
    category: 'COMPANY_DEBT',
    description: '',
  });

  async function loadList() {
    const list = await api<CatchupRow[]>('/labour-catchup');
    setRows(list);
  }

  async function loadDetail(id: string) {
    const d = await api(`/labour-catchup/${id}`);
    setDetail(d);
    setSelectedId(id);
  }

  useEffect(() => {
    setLoading(true);
    Promise.all([api('/clients'), loadList()])
      .then(([c]) => setClients(c as any[]))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!queryId) return;
    loadDetail(queryId).catch((e) => setError(e.message));
  }, [queryId]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    setInfo('');
    try {
      const created = await api<any>('/labour-catchup', {
        method: 'POST',
        body: JSON.stringify({
          clientId: form.clientId || undefined,
          clientName: form.clientId ? undefined : form.clientName,
          clientPhone: form.clientId ? undefined : form.clientPhone,
          name: form.name,
          address: form.address || undefined,
          labourQuotedCents: Math.round(Number(form.labourQuoted) * 100),
          discountCents: Math.round(Number(form.discount || 0) * 100),
          discountReason: form.discountReason || undefined,
          catchupStageLabel: form.catchupStageLabel || undefined,
          cashReceivedCents: form.cashReceived
            ? Math.round(Number(form.cashReceived) * 100)
            : undefined,
        }),
      });
      setForm({
        clientId: '',
        clientName: '',
        clientPhone: '',
        name: '',
        address: '',
        labourQuoted: '',
        discount: '',
        discountReason: '',
        catchupStageLabel: '',
        cashReceived: '',
      });
      setInfo('Catch-up job registered.');
      await loadList();
      await loadDetail(created.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function addReceipt(e: FormEvent) {
    e.preventDefault();
    if (!selectedId) return;
    setSaving(true);
    setError('');
    try {
      await api('/payments', {
        method: 'POST',
        body: JSON.stringify({
          projectId: selectedId,
          amountCents: Math.round(Number(receiptAmount) * 100),
          purpose: 'LABOUR',
          print: false,
          notes: 'Labour catch-up receipt',
        }),
      });
      setReceiptAmount('');
      setInfo('Labour cash recorded.');
      await loadDetail(selectedId);
      await loadList();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function addFundUse(e: FormEvent) {
    e.preventDefault();
    if (!selectedId) return;
    setSaving(true);
    setError('');
    try {
      await api(`/labour-catchup/${selectedId}/fund-uses`, {
        method: 'POST',
        body: JSON.stringify({
          amountCents: Math.round(Number(fundForm.amount) * 100),
          category: fundForm.category,
          description: fundForm.description || undefined,
        }),
      });
      setFundForm({ amount: '', category: 'COMPANY_DEBT', description: '' });
      setInfo('Fund use recorded.');
      await loadDetail(selectedId);
      await loadList();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <h1>Labour catch-up</h1>
      <p className="muted">
        Register past jobs where site visit and quotations already happened. Track labour profit:
        quoted, discount, cash in, and where that money went.
      </p>
      {error && <p className="error">{error}</p>}
      {info && <p className="success">{info}</p>}
      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem' }}>
        <button
          type="button"
          className="btn secondary"
          onClick={() =>
            downloadFile('/labour-catchup/export', 'labour-catchup.csv').catch((e) =>
              setError(e.message),
            )
          }
        >
          Export CSV
        </button>
        <Link href="/estates" className="btn secondary">
          Estates
        </Link>
        <Link href="/bulk-labour" className="btn secondary">
          Bulk Labour
        </Link>
      </div>

      {loading && <LoadingState label="Loading catch-up jobs…" />}
      {!loading && (
        <div className="grid grid-2" style={{ marginTop: '0.5rem' }}>
          <div className="panel">
            <h3>Register past job</h3>
            <form className="form" onSubmit={onCreate}>
              <label>
                Existing client (optional)
                <select
                  value={form.clientId}
                  onChange={(e) => setForm({ ...form, clientId: e.target.value })}
                >
                  <option value="">New client below</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} · {c.phone}
                    </option>
                  ))}
                </select>
              </label>
              {!form.clientId && (
                <>
                  <label>
                    Client name
                    <input
                      required
                      value={form.clientName}
                      onChange={(e) => setForm({ ...form, clientName: e.target.value })}
                    />
                  </label>
                  <label>
                    Phone
                    <input
                      required
                      value={form.clientPhone}
                      onChange={(e) => setForm({ ...form, clientPhone: e.target.value })}
                    />
                  </label>
                </>
              )}
              <label>
                Site / job name
                <input
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </label>
              <label>
                Address
                <input
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                />
              </label>
              <label>
                Stage context (optional)
                <input
                  placeholder="e.g. Roof / Finishing"
                  value={form.catchupStageLabel}
                  onChange={(e) => setForm({ ...form, catchupStageLabel: e.target.value })}
                />
              </label>
              <label>
                Labour quoted
                <input
                  required
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.labourQuoted}
                  onChange={(e) => setForm({ ...form, labourQuoted: e.target.value })}
                />
              </label>
              <label>
                Discount
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.discount}
                  onChange={(e) => setForm({ ...form, discount: e.target.value })}
                />
              </label>
              <label>
                Discount reason
                <input
                  value={form.discountReason}
                  onChange={(e) => setForm({ ...form, discountReason: e.target.value })}
                />
              </label>
              <label>
                Cash already received (optional)
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.cashReceived}
                  onChange={(e) => setForm({ ...form, cashReceived: e.target.value })}
                />
              </label>
              <button type="submit" className="btn" disabled={saving}>
                {saving ? 'Saving…' : 'Open catch-up file'}
              </button>
            </form>
          </div>

          <div className="panel">
            <h3>Jobs</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Job</th>
                    <th>Owner</th>
                    <th>Quoted</th>
                    <th>Cash in</th>
                    <th>Owes</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.id}
                      style={{
                        cursor: 'pointer',
                        background: selectedId === r.id ? 'rgba(0,0,0,0.04)' : undefined,
                      }}
                      onClick={() => loadDetail(r.id).catch((e) => setError(e.message))}
                    >
                      <td>
                        {r.code}
                        <div className="muted">{r.name}</div>
                      </td>
                      <td>{r.client?.name}</td>
                      <td>{money(r.trail.labourQuotedCents)}</td>
                      <td>{money(r.trail.cashReceivedCents)}</td>
                      <td>{money(r.trail.clientOwesCents)}</td>
                    </tr>
                  ))}
                  {!rows.length && (
                    <tr>
                      <td colSpan={5} className="muted">
                        No catch-up jobs yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {detail && (
        <div className="panel" style={{ marginTop: '1rem' }}>
          <h3>
            Money trail · {detail.code} · {detail.name}
          </h3>
          <p className="muted">
            Owner: {detail.client?.name}
            {detail.catchupStageLabel ? ` · Stage: ${detail.catchupStageLabel}` : ''}
            {detail.estateProgramme ? (
              <>
                {' '}
                · Estate:{' '}
                <Link href={`/estates/${detail.estateProgramme.id}`}>
                  {detail.estateProgramme.name}
                </Link>
              </>
            ) : null}
          </p>
          <div className="grid grid-3" style={{ marginBottom: '1rem' }}>
            <div>
              <div className="muted">Labour quoted</div>
              <strong>{money(detail.trail.labourQuotedCents)}</strong>
            </div>
            <div>
              <div className="muted">Discount</div>
              <strong>{money(detail.trail.discountCents)}</strong>
            </div>
            <div>
              <div className="muted">Net due</div>
              <strong>{money(detail.trail.netDueCents)}</strong>
            </div>
            <div>
              <div className="muted">Cash received</div>
              <strong>{money(detail.trail.cashReceivedCents)}</strong>
            </div>
            <div>
              <div className="muted">Uses / company draws</div>
              <strong>{money(detail.trail.fundUsesCents)}</strong>
            </div>
            <div>
              <div className="muted">Still available</div>
              <strong>{money(detail.trail.stillAvailableCents)}</strong>
            </div>
            <div>
              <div className="muted">Client still owes</div>
              <strong>{money(detail.trail.clientOwesCents)}</strong>
            </div>
          </div>

          <div className="grid grid-2">
            <form className="form" onSubmit={addReceipt}>
              <h4>Record labour cash</h4>
              <label>
                Amount
                <input
                  required
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={receiptAmount}
                  onChange={(e) => setReceiptAmount(e.target.value)}
                />
              </label>
              <button type="submit" className="btn" disabled={saving}>
                Add receipt
              </button>
            </form>
            <form className="form" onSubmit={addFundUse}>
              <h4>Where cash went</h4>
              <label>
                Amount
                <input
                  required
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={fundForm.amount}
                  onChange={(e) => setFundForm({ ...fundForm, amount: e.target.value })}
                />
              </label>
              <label>
                Category
                <select
                  value={fundForm.category}
                  onChange={(e) => setFundForm({ ...fundForm, category: e.target.value })}
                >
                  <option value="COMPANY_DEBT">Company debt / float</option>
                  <option value="PAID_TO_LABOUR">Paid to labour</option>
                  <option value="OTHER_PROJECT">Other project</option>
                  <option value="OPERATIONS">Operations</option>
                  <option value="OTHER">Other</option>
                </select>
              </label>
              <label>
                Note
                <input
                  value={fundForm.description}
                  onChange={(e) =>
                    setFundForm({ ...fundForm, description: e.target.value })
                  }
                />
              </label>
              <button type="submit" className="btn" disabled={saving}>
                Record use
              </button>
            </form>
          </div>

          <div className="grid grid-2" style={{ marginTop: '1rem' }}>
            <div>
              <h4>Receipts</h4>
              <ul>
                {(detail.payments || []).map((p: any) => (
                  <li key={p.id}>
                    {money(p.amountCents)} · {p.receiptNumber} ·{' '}
                    {new Date(p.paidAt).toLocaleDateString()}
                  </li>
                ))}
                {!detail.payments?.length && <li className="muted">None yet</li>}
              </ul>
            </div>
            <div>
              <h4>Fund uses</h4>
              <ul>
                {(detail.fundUses || []).map((u: any) => (
                  <li key={u.id}>
                    {money(u.amountCents)} · {u.category}
                    {u.description ? ` · ${u.description}` : ''}{' '}
                    <button
                      type="button"
                      className="btn secondary"
                      style={{ padding: '0.1rem 0.4rem', fontSize: '0.75rem' }}
                      onClick={() =>
                        api(`/fund-uses/${u.id}`, { method: 'DELETE' })
                          .then(() => loadDetail(selectedId))
                          .then(() => loadList())
                          .catch((e) => setError(e.message))
                      }
                    >
                      Remove
                    </button>
                  </li>
                ))}
                {!detail.fundUses?.length && <li className="muted">None yet</li>}
              </ul>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default function LabourCatchupPage() {
  return (
    <AppShell>
      <Suspense fallback={<LoadingState label="Loading…" />}>
        <LabourCatchupInner />
      </Suspense>
    </AppShell>
  );
}

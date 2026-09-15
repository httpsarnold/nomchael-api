'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { BusyOverlay, LoadingState, SavePulse } from '@/components/LoadingState';
import { api, money } from '@/lib/api';

export default function StockPage() {
  const [items, setItems] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [filterProjectId, setFilterProjectId] = useState('');
  const [action, setAction] = useState({
    id: '',
    type: 'purchase',
    quantity: '',
    unitPrice: '',
    toProjectId: '',
    transportFee: '',
    fundingSource: 'PROJECT',
    fundedByProjectId: '',
    paymentTerms: 'CASH',
    supplierId: '',
  });
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [savedFlash, setSavedFlash] = useState('');

  async function load() {
    const [s, p, sup] = await Promise.all([
      api('/stock'),
      api('/projects'),
      api('/suppliers'),
    ]);
    setItems(s as any[]);
    setProjects(p as any[]);
    setSuppliers(sup as any[]);
  }

  useEffect(() => {
    setLoading(true);
    load()
      .then(() => {
        if (typeof window === 'undefined') return;
        const projectId = new URLSearchParams(window.location.search).get('projectId');
        if (projectId) setFilterProjectId(projectId);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const selected = useMemo(
    () => items.find((i) => i.id === action.id) || null,
    [items, action.id],
  );

  const visibleItems = useMemo(
    () =>
      filterProjectId ? items.filter((i) => i.projectId === filterProjectId) : items,
    [items, filterProjectId],
  );

  const linkedItems = useMemo(
    () => visibleItems.filter((i) => i.quotationLineItemId || i.quotedQty != null),
    [visibleItems],
  );
  const orphanItems = useMemo(
    () => visibleItems.filter((i) => !i.quotationLineItemId && i.quotedQty == null),
    [visibleItems],
  );

  const purchaseQty = Number(action.quantity) || 0;
  const stillOnQuote =
    selected?.stillOnQuote == null ? null : Number(selected.stillOnQuote);
  const excessQty =
    action.type === 'purchase' && stillOnQuote != null
      ? Math.max(0, purchaseQty - stillOnQuote)
      : 0;

  async function runAction(e: FormEvent) {
    e.preventDefault();
    setError('');
    setInfo('');
    const qty = Number(action.quantity);
    setBusy(true);
    try {
      if (action.type === 'purchase') {
        if (!action.unitPrice) {
          setError('Unit price is required. Purchase cost is charged to the project.');
          return;
        }
        if (excessQty > 0 && action.fundingSource === 'PROJECT') {
          setError('This buy is above the quotation. Choose where the excess money comes from.');
          return;
        }
        if (action.paymentTerms === 'CREDIT' && !action.supplierId) {
          setError('Select the supplier when buying on credit so we can track what we owe.');
          return;
        }
        const result = await api<any>(`/stock/${action.id}/purchase`, {
          method: 'POST',
          body: JSON.stringify({
            quantity: qty,
            unitPriceCents: Math.round(Number(action.unitPrice) * 100),
            fundingSource: excessQty > 0 ? action.fundingSource : 'PROJECT',
            fundedByProjectId:
              action.fundingSource === 'OTHER_PROJECT'
                ? action.fundedByProjectId || undefined
                : undefined,
            paymentTerms: action.paymentTerms,
            supplierId: action.supplierId || undefined,
          }),
        });
        if (result.purchase) {
          setInfo(
            `Charged ${money(result.purchase.projectCostCents)} to this project` +
              (result.purchase.excessCostCents > 0
                ? ` · excess ${money(result.purchase.excessCostCents)} from ${result.purchase.fundingSource}`
                : '') +
              (result.purchase.paymentTerms === 'CREDIT'
                ? ` · on credit (creditor recorded)`
                : '') +
              (result.purchase.overQuote ? ` · ${result.purchase.overQuote}` : ''),
          );
        }
        setSavedFlash(
          action.paymentTerms === 'CREDIT'
            ? 'Purchase on credit · project cost + creditor balance posted'
            : 'Purchase saved · materials expense posted',
        );
      } else if (action.type === 'use') {
        await api(`/stock/${action.id}/use`, {
          method: 'POST',
          body: JSON.stringify({ quantity: qty }),
        });
        setSavedFlash('Use on site recorded');
      } else if (action.type === 'sell') {
        await api(`/stock/${action.id}/sell`, {
          method: 'POST',
          body: JSON.stringify({
            quantity: qty,
            unitPriceCents: Math.round(Number(action.unitPrice) * 100),
          }),
        });
        setSavedFlash('Sale recorded');
      } else if (action.type === 'return') {
        await api(`/stock/${action.id}/return`, {
          method: 'POST',
          body: JSON.stringify({ quantity: qty }),
        });
        setSavedFlash('Return recorded');
      } else if (action.type === 'transfer') {
        await api(`/stock/${action.id}/transfer`, {
          method: 'POST',
          body: JSON.stringify({
            toProjectId: action.toProjectId,
            quantity: qty,
            transportFeeCents: Math.round(Number(action.transportFee || 0) * 100),
          }),
        });
        setSavedFlash('Transfer recorded');
      }
      window.setTimeout(() => setSavedFlash(''), 2400);
      setAction({
        id: '',
        type: 'purchase',
        quantity: '',
        unitPrice: '',
        toProjectId: '',
        transportFee: '',
        fundingSource: 'PROJECT',
        fundedByProjectId: '',
        paymentTerms: 'CASH',
        supplierId: '',
      });
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      {busy && <BusyOverlay label="Updating stock…" />}
      <h1>Stores &amp; Stock</h1>
      <p className="muted">
        Stock does not appear until the client has paid. Quotation lines stay on the quote only.
        After payment, Stores shows those materials so you can purchase and use them.
      </p>
      {filterProjectId && (
        <p className="muted">
          Showing stock for this project only.{' '}
          <button
            type="button"
            className="btn secondary"
            style={{ padding: '2px 8px' }}
            onClick={() => setFilterProjectId('')}
          >
            Show all projects
          </button>
        </p>
      )}
      {error && <p className="error">{error}</p>}
      {loading && <LoadingState label="Loading stock…" />}
      {!loading && (
        <>
          {info && <p className="muted">{info}</p>}
          {savedFlash && <SavePulse label={savedFlash} />}

          <div className="panel" style={{ marginTop: '1rem' }}>
            <h3>Stock movement (quoted lines only)</h3>
            <form className="form" onSubmit={runAction}>
              <label>
                Stock line
                <select
                  required
                  value={action.id}
                  onChange={(e) => setAction({ ...action, id: e.target.value })}
                >
                  <option value="">Select quoted line…</option>
                  {linkedItems.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.project?.code} · {i.itemName} (quoted {i.quotedQty ?? '—'}, rem{' '}
                      {i.qtyRemaining})
                    </option>
                  ))}
                </select>
              </label>
              {!linkedItems.length && (
                <p className="muted" style={{ margin: 0 }}>
                  No quotation-linked stock yet. Build the quotation first.
                </p>
              )}
              <label>
                Action
                <select
                  value={action.type}
                  onChange={(e) => setAction({ ...action, type: e.target.value })}
                >
                  <option value="purchase">Purchase in</option>
                  <option value="use">Use on site</option>
                  <option value="sell">Sell leftover (revenue)</option>
                  <option value="return">Return to owner</option>
                  <option value="transfer">Transfer to project</option>
                </select>
              </label>
              <label>
                Quantity
                <input
                  required
                  value={action.quantity}
                  onChange={(e) => setAction({ ...action, quantity: e.target.value })}
                />
              </label>
              {action.type === 'purchase' && selected && (
                <p className="muted" style={{ margin: 0 }}>
                  Quotation still allows {selected.stillOnQuote} {selected.unit} on this project
                  budget.
                </p>
              )}
              {(action.type === 'purchase' || action.type === 'sell') && (
                <label>
                  Unit price
                  <input
                    required={action.type === 'purchase'}
                    value={action.unitPrice}
                    onChange={(e) => setAction({ ...action, unitPrice: e.target.value })}
                  />
                </label>
              )}
              {action.type === 'purchase' && (
                <>
                  <label>
                    Pay supplier
                    <select
                      value={action.paymentTerms}
                      onChange={(e) => setAction({ ...action, paymentTerms: e.target.value })}
                    >
                      <option value="CASH">Cash / bank now</option>
                      <option value="CREDIT">On credit (we owe supplier)</option>
                    </select>
                  </label>
                  <label>
                    Supplier{action.paymentTerms === 'CREDIT' ? ' (required)' : ' (optional)'}
                    <select
                      required={action.paymentTerms === 'CREDIT'}
                      value={action.supplierId}
                      onChange={(e) => setAction({ ...action, supplierId: e.target.value })}
                    >
                      <option value="">Select…</option>
                      {suppliers.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                          {s.company ? ` · ${s.company}` : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                  {action.paymentTerms === 'CREDIT' && (
                    <p className="muted" style={{ margin: 0 }}>
                      Project cost is posted now. The supplier appears under Creditors until we pay
                      them.
                    </p>
                  )}
                </>
              )}
              {action.type === 'purchase' && excessQty > 0 && (
                <>
                  <p className="error" style={{ margin: 0 }}>
                    Excess of {excessQty} {selected?.unit}: choose funding source.
                  </p>
                  <label>
                    Excess funded by
                    <select
                      required
                      value={action.fundingSource}
                      onChange={(e) => setAction({ ...action, fundingSource: e.target.value })}
                    >
                      <option value="PROJECT">This project (not allowed for excess)</option>
                      <option value="COMPANY">Company float</option>
                      <option value="CLIENT">Client extra payment</option>
                      <option value="OTHER_PROJECT">Another project</option>
                    </select>
                  </label>
                  {action.fundingSource === 'OTHER_PROJECT' && (
                    <label>
                      Funding project
                      <select
                        required
                        value={action.fundedByProjectId}
                        onChange={(e) =>
                          setAction({ ...action, fundedByProjectId: e.target.value })
                        }
                      >
                        <option value="">Select…</option>
                        {projects
                          .filter((p) => p.id !== selected?.projectId)
                          .map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.code} {p.name}
                            </option>
                          ))}
                      </select>
                    </label>
                  )}
                </>
              )}
              {action.type === 'transfer' && (
                <>
                  <label>
                    To project
                    <select
                      required
                      value={action.toProjectId}
                      onChange={(e) => setAction({ ...action, toProjectId: e.target.value })}
                    >
                      <option value="">Select…</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.code} {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Transport fee
                    <input
                      value={action.transportFee}
                      onChange={(e) => setAction({ ...action, transportFee: e.target.value })}
                    />
                  </label>
                </>
              )}
              <button className="btn" type="submit" disabled={busy || !linkedItems.length}>
                {busy ? 'Saving…' : 'Apply'}
              </button>
            </form>
          </div>

          <div className="panel" style={{ marginTop: '1rem' }}>
            <h3>Stock by project (from quotations)</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Project</th>
                    <th>Item</th>
                    <th>Source</th>
                    <th>Quoted</th>
                    <th>Purchased</th>
                    <th>Used</th>
                    <th>Sold</th>
                    <th>Returned</th>
                    <th>Remaining</th>
                  </tr>
                </thead>
                <tbody>
                  {linkedItems.map((i) => (
                    <tr key={i.id}>
                      <td>{i.project?.code}</td>
                      <td>
                        {i.itemName} ({i.unit})
                      </td>
                      <td>
                        <span className="badge ok">Quotation</span>
                      </td>
                      <td>{i.quotedQty ?? '—'}</td>
                      <td>{i.qtyPurchased}</td>
                      <td>{i.qtyUsed}</td>
                      <td>{i.qtySold}</td>
                      <td>{i.qtyReturned}</td>
                      <td>
                        <strong>{i.qtyRemaining}</strong>
                      </td>
                    </tr>
                  ))}
                  {!linkedItems.length && (
                    <tr>
                      <td colSpan={9} className="muted">
                        No quotation-linked stock yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {orphanItems.length > 0 && (
              <div style={{ marginTop: '1rem' }}>
                <h3 style={{ marginBottom: 6 }}>Orphan lines (not from quotation)</h3>
                <p className="muted" style={{ marginTop: 0 }}>
                  These were created outside the lifecycle. Purchases against them are blocked. Prefer
                  deleting unused orphans and buying only quotation lines.
                </p>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Project</th>
                        <th>Item</th>
                        <th>Purchased</th>
                        <th>Remaining</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orphanItems.map((i) => (
                        <tr key={i.id}>
                          <td>{i.project?.code}</td>
                          <td>
                            {i.itemName} ({i.unit})
                          </td>
                          <td>{i.qtyPurchased}</td>
                          <td>{i.qtyRemaining}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </AppShell>
  );
}

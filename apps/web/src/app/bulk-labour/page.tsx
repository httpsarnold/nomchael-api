'use client';

import Link from 'next/link';
import { FormEvent, Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { BusyOverlay, LoadingState } from '@/components/LoadingState';
import { api, money } from '@/lib/api';

type HouseFilter = 'all' | 'discounted' | 'no_discount' | 'owes';

function BulkLabourInner() {
  const search = useSearchParams();
  const presetEstate = search.get('estate') || '';

  const [estates, setEstates] = useState<any[]>([]);
  const [estateId, setEstateId] = useState(presetEstate);
  const [estate, setEstate] = useState<any>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState<HouseFilter>('all');
  const [action, setAction] = useState<
    | 'CASH_RECEIVED'
    | 'SET_LABOUR_QUOTED'
    | 'FUND_USE'
    | 'SET_DISCOUNT'
    | 'LABOUR_USED'
    | 'PAY_IN_FULL'
  >('CASH_RECEIVED');
  const [amount, setAmount] = useState('3000');
  const [category, setCategory] = useState('COMPANY_DEBT');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function loadEstates() {
    const list = await api<any[]>('/estates');
    setEstates(list);
    if (!estateId && list[0]) setEstateId(list[0].id);
  }

  async function loadEstate(id: string) {
    if (!id) {
      setEstate(null);
      return;
    }
    const e = await api(`/estates/${id}`);
    setEstate(e);
    setSelected({});
  }

  useEffect(() => {
    setLoading(true);
    loadEstates()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (presetEstate) setEstateId(presetEstate);
  }, [presetEstate]);

  useEffect(() => {
    if (!estateId) return;
    loadEstate(estateId).catch((e) => setError(e.message));
  }, [estateId]);

  const filteredHouses = useMemo(() => {
    const houses = estate?.projects || [];
    if (filter === 'discounted') {
      return houses.filter((h: any) => Number(h.trail?.discountCents || 0) > 0);
    }
    if (filter === 'no_discount') {
      return houses.filter((h: any) => Number(h.trail?.discountCents || 0) <= 0);
    }
    if (filter === 'owes') {
      return houses.filter((h: any) => Number(h.trail?.clientOwesCents || 0) > 0);
    }
    return houses;
  }, [estate, filter]);

  const selectedIds = useMemo(
    () =>
      filteredHouses
        .map((h: any) => h.id)
        .filter((id: string) => selected[id]),
    [filteredHouses, selected],
  );

  const selectedOwesTotal = useMemo(
    () =>
      filteredHouses
        .filter((h: any) => selected[h.id])
        .reduce((s: number, h: any) => s + Number(h.trail?.clientOwesCents || 0), 0),
    [filteredHouses, selected],
  );

  function selectFiltered(on: boolean) {
    const next = { ...selected };
    for (const h of filteredHouses) next[h.id] = on;
    setSelected(next);
  }

  function selectByDiscount(discounted: boolean) {
    if (!estate?.projects) return;
    const next: Record<string, boolean> = {};
    for (const h of estate.projects) {
      const hasDiscount = Number(h.trail?.discountCents || 0) > 0;
      const owes = Number(h.trail?.clientOwesCents || 0) > 0;
      next[h.id] = discounted ? hasDiscount && owes : !hasDiscount && owes;
    }
    setSelected(next);
    setFilter(discounted ? 'discounted' : 'no_discount');
    setAction('PAY_IN_FULL');
  }

  async function runBulk(
    projectIds: string[],
    bulkAction: typeof action,
    amountCents?: number,
  ) {
    if (!projectIds.length) {
      setError('Select at least one house');
      return;
    }
    setSaving(true);
    setError('');
    setInfo('');
    try {
      const result = await api<any>('/bulk-labour', {
        method: 'POST',
        body: JSON.stringify({
          estateProgrammeId: estateId,
          projectIds,
          action: bulkAction,
          amountCents:
            bulkAction === 'PAY_IN_FULL'
              ? 0
              : amountCents ?? Math.round(Number(amount) * 100),
          category: bulkAction === 'FUND_USE' ? category : undefined,
          notes: notes || undefined,
        }),
      });
      setEstate(result.estate);
      setInfo(
        bulkAction === 'PAY_IN_FULL'
          ? `Paid in full on ${result.applied} house(s). Outstanding cleared where they owed.`
          : `Applied ${money(Math.round(Number(amount) * 100))} to ${result.applied} house(s). Trends updated.`,
      );
      setSelected({});
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function onApply(e: FormEvent) {
    e.preventDefault();
    await runBulk(selectedIds, action);
  }

  async function payInFullSelected() {
    await runBulk(selectedIds, 'PAY_IN_FULL');
  }

  async function payInFullDiscounted() {
    const ids = (estate?.projects || [])
      .filter(
        (h: any) =>
          Number(h.trail?.discountCents || 0) > 0 &&
          Number(h.trail?.clientOwesCents || 0) > 0,
      )
      .map((h: any) => h.id);
    setFilter('discounted');
    setSelected(Object.fromEntries(ids.map((id: string) => [id, true])));
    await runBulk(ids, 'PAY_IN_FULL');
  }

  async function payInFullNoDiscount() {
    const ids = (estate?.projects || [])
      .filter(
        (h: any) =>
          Number(h.trail?.discountCents || 0) <= 0 &&
          Number(h.trail?.clientOwesCents || 0) > 0,
      )
      .map((h: any) => h.id);
    setFilter('no_discount');
    setSelected(Object.fromEntries(ids.map((id: string) => [id, true])));
    await runBulk(ids, 'PAY_IN_FULL');
  }

  const t = estate?.trends;

  return (
    <>
      {saving && (
        <BusyOverlay label={`Applying to ${selectedIds.length || 'selected'} house(s)…`} />
      )}
      <h1>Bulk Labour</h1>
      <p className="muted">
        Filter discounted vs full-price houses, apply the same amount, or pay outstanding in full
        (each house clears what they still owe after discount).
      </p>
      {error && <p className="error">{error}</p>}
      {info && <p className="success">{info}</p>}
      {loading && <LoadingState label="Loading…" />}

      {!loading && (
        <>
          <div className="panel" style={{ marginBottom: '1rem' }}>
            <label>
              Estate file
              <select
                value={estateId}
                onChange={(e) => setEstateId(e.target.value)}
                disabled={saving}
              >
                <option value="">Select estate</option>
                {estates.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.code} · {e.name} ({e.houseCount} houses)
                  </option>
                ))}
              </select>
            </label>
            {!estates.length && (
              <p className="muted">
                No estates yet. <Link href="/estates">Create one</Link>.
              </p>
            )}
          </div>

          {estate && (
            <>
              <div className="panel" style={{ marginBottom: '1rem' }}>
                <h3>
                  Trends · <Link href={`/estates/${estate.id}`}>{estate.name}</Link>
                </h3>
                <div className="grid grid-3">
                  <div>
                    <div className="muted">Cash in</div>
                    <strong>{money(t.cashReceivedCents)}</strong>
                  </div>
                  <div>
                    <div className="muted">Fund uses</div>
                    <strong>{money(t.fundUsesCents)}</strong>
                  </div>
                  <div>
                    <div className="muted">Client owes</div>
                    <strong>{money(t.clientOwesCents)}</strong>
                  </div>
                </div>
              </div>

              <div className="panel" style={{ marginBottom: '1rem' }}>
                <h3>Pay in full (by discount group)</h3>
                <p className="muted">
                  Automatically records cash received equal to what each house still owes (after any
                  discount). Houses already paid in full are skipped.
                </p>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn"
                    disabled={saving}
                    onClick={() => payInFullDiscounted()}
                  >
                    Discounted houses · Pay in full
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={saving}
                    onClick={() => payInFullNoDiscount()}
                  >
                    Non-discounted houses · Pay in full
                  </button>
                  <button
                    type="button"
                    className="btn secondary"
                    disabled={saving}
                    onClick={() => selectByDiscount(true)}
                  >
                    Select discounted (owing)
                  </button>
                  <button
                    type="button"
                    className="btn secondary"
                    disabled={saving}
                    onClick={() => selectByDiscount(false)}
                  >
                    Select non-discounted (owing)
                  </button>
                </div>
              </div>

              <div className="grid grid-2">
                <div
                  className="panel"
                  style={{
                    opacity: saving ? 0.6 : 1,
                    pointerEvents: saving ? 'none' : undefined,
                  }}
                >
                  <h3>Select houses</h3>
                  <label>
                    Filter
                    <select
                      value={filter}
                      onChange={(e) => {
                        setFilter(e.target.value as HouseFilter);
                        setSelected({});
                      }}
                    >
                      <option value="all">All houses</option>
                      <option value="discounted">Discounted houses only</option>
                      <option value="no_discount">Non-discounted houses only</option>
                      <option value="owes">Still owe us</option>
                    </select>
                  </label>
                  <div style={{ display: 'flex', gap: '0.5rem', margin: '0.5rem 0' }}>
                    <button
                      type="button"
                      className="btn secondary"
                      onClick={() => selectFiltered(true)}
                    >
                      Select filtered
                    </button>
                    <button
                      type="button"
                      className="btn secondary"
                      onClick={() => selectFiltered(false)}
                    >
                      Clear
                    </button>
                  </div>
                  <div className="table-wrap" style={{ maxHeight: 420, overflow: 'auto' }}>
                    <table>
                      <thead>
                        <tr>
                          <th></th>
                          <th>#</th>
                          <th>Owner</th>
                          <th>Discount</th>
                          <th>Cash in</th>
                          <th>Owes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredHouses.map((h: any) => (
                          <tr key={h.id}>
                            <td>
                              <input
                                type="checkbox"
                                checked={!!selected[h.id]}
                                onChange={(e) =>
                                  setSelected({ ...selected, [h.id]: e.target.checked })
                                }
                              />
                            </td>
                            <td>{h.unitNumber}</td>
                            <td>{h.client?.name}</td>
                            <td>
                              {Number(h.trail?.discountCents || 0) > 0
                                ? money(h.trail.discountCents)
                                : '—'}
                            </td>
                            <td>{money(h.trail.cashReceivedCents)}</td>
                            <td>{money(h.trail.clientOwesCents)}</td>
                          </tr>
                        ))}
                        {!filteredHouses.length && (
                          <tr>
                            <td colSpan={6} className="muted">
                              No houses in this filter.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <p className="muted">
                    {selectedIds.length} selected
                    {selectedOwesTotal > 0
                      ? ` · selected still owe ${money(selectedOwesTotal)}`
                      : ''}
                  </p>
                </div>

                <div className="panel">
                  <h3>Apply same amount</h3>
                  <form className="form" onSubmit={onApply}>
                    <fieldset disabled={saving} style={{ border: 0, padding: 0, margin: 0 }}>
                      <label>
                        Action
                        <select
                          value={action}
                          onChange={(e) => setAction(e.target.value as typeof action)}
                        >
                          <option value="CASH_RECEIVED">
                            Record cash received (income in)
                          </option>
                          <option value="PAY_IN_FULL">
                            Pay in full (each house clears what they owe)
                          </option>
                          <option value="LABOUR_USED">
                            Labour used per house (reduces available income)
                          </option>
                          <option value="SET_DISCOUNT">Grant discount</option>
                          <option value="SET_LABOUR_QUOTED">Set labour quoted</option>
                          <option value="FUND_USE">Other fund use / company draw</option>
                        </select>
                      </label>
                      {action !== 'PAY_IN_FULL' && (
                        <label>
                          Amount (same for each selected house)
                          <input
                            required
                            type="number"
                            min={action === 'SET_DISCOUNT' ? '0' : '0.01'}
                            step="0.01"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                          />
                        </label>
                      )}
                      {action === 'PAY_IN_FULL' && (
                        <p className="muted">
                          Each selected house is paid for its own outstanding balance (quoted −
                          discount − cash already in). Selected total owing:{' '}
                          <strong>{money(selectedOwesTotal)}</strong>
                        </p>
                      )}
                      {action === 'SET_DISCOUNT' && (
                        <p className="muted">
                          Discount reduces net due for each selected house.
                        </p>
                      )}
                      {action === 'LABOUR_USED' && (
                        <p className="muted">
                          Allocates labour spent on each selected house (e.g. 3000).
                        </p>
                      )}
                      {action === 'FUND_USE' && (
                        <label>
                          Category
                          <select
                            value={category}
                            onChange={(e) => setCategory(e.target.value)}
                          >
                            <option value="COMPANY_DEBT">Company debt / float</option>
                            <option value="PAID_TO_LABOUR">Paid to labour</option>
                            <option value="OTHER_PROJECT">Other project</option>
                            <option value="OPERATIONS">Operations</option>
                            <option value="OTHER">Other</option>
                          </select>
                        </label>
                      )}
                      <label>
                        Note
                        <input value={notes} onChange={(e) => setNotes(e.target.value)} />
                      </label>
                      <button
                        type="submit"
                        className="btn"
                        disabled={saving || !selectedIds.length}
                      >
                        {saving ? (
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.5rem',
                            }}
                          >
                            <span className="spinner" aria-hidden />
                            Applying…
                          </span>
                        ) : action === 'PAY_IN_FULL' ? (
                          `Pay in full · ${selectedIds.length} house(s)`
                        ) : (
                          `Apply to ${selectedIds.length || 0} house(s)`
                        )}
                      </button>
                      {action !== 'PAY_IN_FULL' && selectedIds.length > 0 && (
                        <button
                          type="button"
                          className="btn secondary"
                          style={{ marginTop: '0.5rem' }}
                          disabled={saving || selectedOwesTotal <= 0}
                          onClick={() => payInFullSelected()}
                        >
                          Or pay selected in full ({money(selectedOwesTotal)})
                        </button>
                      )}
                    </fieldset>
                  </form>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}

export default function BulkLabourPage() {
  return (
    <AppShell>
      <Suspense fallback={<LoadingState label="Loading…" />}>
        <BulkLabourInner />
      </Suspense>
    </AppShell>
  );
}

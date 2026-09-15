'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { LoadingState } from '@/components/LoadingState';
import { api, downloadPdf, getUser, money } from '@/lib/api';

export default function FinancePage() {
  const [payments, setPayments] = useState<any[]>([]);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [shortfalls, setShortfalls] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [debtors, setDebtors] = useState<any>(null);
  const [creditors, setCreditors] = useState<any>(null);
  const [stock, setStock] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [txSearch, setTxSearch] = useState('');

  const [payForm, setPayForm] = useState({ projectId: '', amount: '', method: 'CASH' });
  const [expenseForm, setExpenseForm] = useState({
    kind: 'PROJECT_SITE',
    projectId: '',
    employeeId: '',
    category: 'Site food',
    description: '',
    amount: '',
  });
  const [creditorPay, setCreditorPay] = useState({
    supplierId: '',
    amount: '',
    method: 'CASH',
    reference: '',
  });
  const [shortfallForm, setShortfallForm] = useState({ projectId: '', amount: '', reason: '' });
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(true);
  const user = typeof window !== 'undefined' ? getUser() : null;
  const canApprove =
    user?.role === 'MANAGING_DIRECTOR' || user?.role === 'SUPER_ADMIN';

  async function load() {
    const [p, e, s, pr, emp, sup, deb, cred, st] = await Promise.all([
      api('/payments'),
      api('/expenses'),
      api('/shortfalls'),
      api('/projects'),
      api('/employees'),
      api('/suppliers'),
      api('/suppliers/debtors'),
      api('/suppliers/creditors'),
      api('/stock'),
    ]);
    setPayments(p as any[]);
    setExpenses(e as any[]);
    setShortfalls(s as any[]);
    setProjects(pr as any[]);
    setEmployees((emp as any[]).filter((x) => x.isActive !== false));
    setSuppliers(sup as any[]);
    setDebtors(deb);
    setCreditors(cred);
    setStock(st as any[]);
  }

  useEffect(() => {
    setLoading(true);
    load()
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const q = search.trim().toLowerCase();
  const filteredProjects = useMemo(() => {
    if (!q) return projects;
    return projects.filter((p) =>
      `${p.code} ${p.name} ${p.client?.name || ''} ${p.status}`
        .toLowerCase()
        .includes(q),
    );
  }, [projects, q]);

  const overQuoteStock = useMemo(
    () =>
      stock.filter((i) => {
        const quoted = i.quotedQty == null ? null : Number(i.quotedQty);
        const bought = Number(i.qtyPurchased || 0);
        return quoted != null && bought > quoted + 0.0001;
      }),
    [stock],
  );

  const cashShortProjects = useMemo(
    () =>
      projects.filter((p) => {
        const paid = Number(p.amountPaidCents || 0);
        const due = Number(p.amountDueCents ?? p.quotationTotalCents - p.amountPaidCents);
        return paid > 0 && due > 0 && p.status === 'ACTIVE';
      }),
    [projects],
  );

  const txQ = txSearch.trim().toLowerCase();
  const filteredPayments = useMemo(() => {
    if (!txQ) return payments.slice(0, 40);
    return payments.filter((p) =>
      `${p.receiptNumber} ${p.project?.code} ${p.project?.client?.name || ''} ${p.method}`
        .toLowerCase()
        .includes(txQ),
    );
  }, [payments, txQ]);

  const filteredExpenses = useMemo(() => {
    if (!txQ) return expenses.slice(0, 40);
    return expenses.filter((e) =>
      `${e.scope} ${e.kind} ${e.category} ${e.description} ${e.project?.code || ''} ${e.employee?.fullName || ''}`
        .toLowerCase()
        .includes(txQ),
    );
  }, [expenses, txQ]);

  async function takePayment(e: FormEvent) {
    e.preventDefault();
    setError('');
    setInfo('');
    await api('/payments', {
      method: 'POST',
      body: JSON.stringify({
        projectId: payForm.projectId,
        amountCents: Math.round(Number(payForm.amount) * 100),
        method: payForm.method,
      }),
    });
    setPayForm({ projectId: '', amount: '', method: 'CASH' });
    setInfo('Client payment recorded. Stock can be bought against the quotation.');
    await load();
  }

  async function addExpense(e: FormEvent) {
    e.preventDefault();
    setError('');
    setInfo('');
    const kind = expenseForm.kind;
    const scope = kind === 'PERSONAL' || kind === 'COMPANY' ? 'GENERAL' : 'PROJECT';
    await api('/expenses', {
      method: 'POST',
      body: JSON.stringify({
        scope,
        kind: kind === 'COMPANY' ? 'STANDARD' : kind,
        projectId: scope === 'PROJECT' ? expenseForm.projectId : undefined,
        employeeId: kind === 'PERSONAL' ? expenseForm.employeeId : undefined,
        category: expenseForm.category,
        description: expenseForm.description,
        amountCents: Math.round(Number(expenseForm.amount) * 100),
      }),
    });
    setExpenseForm({
      kind: 'PROJECT_SITE',
      projectId: '',
      employeeId: '',
      category: 'Site food',
      description: '',
      amount: '',
    });
    setInfo('Expense recorded.');
    await load();
  }

  async function payCreditor(e: FormEvent) {
    e.preventDefault();
    setError('');
    setInfo('');
    await api('/suppliers/pay', {
      method: 'POST',
      body: JSON.stringify({
        supplierId: creditorPay.supplierId,
        amountCents: Math.round(Number(creditorPay.amount) * 100),
        method: creditorPay.method,
        reference: creditorPay.reference || undefined,
      }),
    });
    setCreditorPay({ supplierId: '', amount: '', method: 'CASH', reference: '' });
    setInfo('Creditor payment allocated against open payables.');
    await load();
  }

  async function createShortfall(e: FormEvent) {
    e.preventDefault();
    await api('/shortfalls', {
      method: 'POST',
      body: JSON.stringify({
        projectId: shortfallForm.projectId,
        amountCents: Math.round(Number(shortfallForm.amount) * 100),
        reason: shortfallForm.reason,
      }),
    });
    setShortfallForm({ projectId: '', amount: '', reason: '' });
    await load();
  }

  async function decide(id: string, approve: boolean) {
    await api(`/shortfalls/${id}/decide`, {
      method: 'POST',
      body: JSON.stringify({ approve }),
    });
    await load();
  }

  async function downloadCreditorStatement(supplierId: string, name: string) {
    setError('');
    try {
      await downloadPdf(
        `/suppliers/${supplierId}/statement/pdf`,
        `creditor-${name.replace(/\s+/g, '-')}.pdf`,
      );
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <AppShell>
      <h1>Finance desk</h1>
      <p className="muted">
        Search a project, take income, buy for the client, record site or personal costs, and settle
        suppliers. Debtors (clients who owe us) and creditors (suppliers we owe) live here.
      </p>
      {error && <p className="error">{error}</p>}
      {info && <p className="muted">{info}</p>}
      {loading && <LoadingState label="Loading finance…" />}
      {!loading && (
        <>
          <div className="panel" style={{ marginTop: '1rem' }}>
            <label style={{ display: 'block', marginBottom: 0 }}>
              Quick search projects / clients
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Code, client, project name…"
              />
            </label>
            {q && (
              <div className="table-wrap" style={{ marginTop: 12 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Project</th>
                      <th>Client</th>
                      <th>Due</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredProjects.slice(0, 12).map((p) => (
                      <tr key={p.id}>
                        <td>
                          {p.code} {p.name}
                        </td>
                        <td>{p.client?.name}</td>
                        <td>
                          {money(
                            p.amountDueCents ??
                              Number(p.quotationTotalCents || 0) - Number(p.amountPaidCents || 0),
                          )}
                        </td>
                        <td className="row-actions">
                          <button
                            type="button"
                            className="btn secondary"
                            onClick={() => setPayForm({ ...payForm, projectId: p.id })}
                          >
                            Pay in
                          </button>
                          <Link className="btn secondary" href={`/stock?projectId=${p.id}`}>
                            Buy stock
                          </Link>
                          <Link className="btn secondary" href={`/projects/${p.id}`}>
                            File
                          </Link>
                          <button
                            type="button"
                            className="btn secondary"
                            onClick={() =>
                              downloadPdf(
                                `/projects/${p.id}/ledger/pdf`,
                                `ledger-${p.code}.pdf`,
                              ).catch((err) => setError(err.message))
                            }
                          >
                            DR/CR PDF
                          </button>
                        </td>
                      </tr>
                    ))}
                    {!filteredProjects.length && (
                      <tr>
                        <td colSpan={4} className="muted">
                          No projects match.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="grid grid-3" style={{ marginTop: '1rem' }}>
            <div className="stat-card">
              <div>
                <div className="label">Debtors (clients owe)</div>
                <div className="value" style={{ fontSize: '1.25rem' }}>
                  {money(debtors?.totalOwedCents || 0)}
                </div>
              </div>
            </div>
            <div className="stat-card">
              <div>
                <div className="label">Creditors (we owe suppliers)</div>
                <div className="value" style={{ fontSize: '1.25rem' }}>
                  {money(creditors?.totalOwedCents || 0)}
                </div>
              </div>
            </div>
            <div className="stat-card">
              <div>
                <div className="label">Over-quote stock lines</div>
                <div className="value" style={{ fontSize: '1.25rem' }}>
                  {overQuoteStock.length}
                </div>
              </div>
            </div>
          </div>

          {(overQuoteStock.length > 0 || shortfalls.some((s) => s.status === 'PENDING')) && (
            <div className="panel" style={{ marginTop: '1rem' }}>
              <h3>Needs attention</h3>
              {overQuoteStock.length > 0 && (
                <>
                  <p className="muted" style={{ marginTop: 0 }}>
                    Bought more than quoted (system already required alternate funding):
                  </p>
                  <ul>
                    {overQuoteStock.slice(0, 8).map((i) => (
                      <li key={i.id}>
                        {i.project?.code}: {i.itemName} bought {i.qtyPurchased} / quoted{' '}
                        {i.quotedQty} {i.unit}{' '}
                        <Link href={`/stock?projectId=${i.projectId}`}>Open stock</Link>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {cashShortProjects.length > 0 && (
                <p className="muted">
                  {cashShortProjects.length} active project(s) still have client balance due.
                </p>
              )}
            </div>
          )}

          <div className="grid grid-2" style={{ marginTop: '1rem' }}>
            <div className="panel">
              <h3>1. Client income</h3>
              <form className="form" onSubmit={takePayment}>
                <label>
                  Project
                  <select
                    required
                    value={payForm.projectId}
                    onChange={(e) => setPayForm({ ...payForm, projectId: e.target.value })}
                  >
                    <option value="">Select…</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.code} {p.name} · {p.client?.name || ''}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Amount
                  <input
                    required
                    value={payForm.amount}
                    onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })}
                  />
                </label>
                <label>
                  Method
                  <select
                    value={payForm.method}
                    onChange={(e) => setPayForm({ ...payForm, method: e.target.value })}
                  >
                    <option value="CASH">Cash</option>
                    <option value="BANK_TRANSFER">Bank transfer</option>
                    <option value="MOBILE_MONEY">Mobile money</option>
                    <option value="CHEQUE">Cheque</option>
                    <option value="OTHER">Other</option>
                  </select>
                </label>
                <button className="btn" type="submit">
                  Record payment
                </button>
              </form>
              <p className="muted">
                After payment, buy materials on{' '}
                <Link href="/stock">Stores &amp; Stock</Link> against the quotation tally.
              </p>
            </div>

            <div className="panel">
              <h3>2. Spend (personal vs project)</h3>
              <form className="form" onSubmit={addExpense}>
                <label>
                  Type
                  <select
                    value={expenseForm.kind}
                    onChange={(e) => {
                      const kind = e.target.value;
                      setExpenseForm({
                        ...expenseForm,
                        kind,
                        category:
                          kind === 'PERSONAL'
                            ? 'Fuel'
                            : kind === 'PROJECT_SITE'
                              ? 'Site food'
                              : 'Operations',
                      });
                    }}
                  >
                    <option value="PROJECT_SITE">Project site (charges client project)</option>
                    <option value="PERSONAL">Personal (employee: fuel, allowance)</option>
                    <option value="COMPANY">Company general</option>
                  </select>
                </label>
                {expenseForm.kind === 'PROJECT_SITE' && (
                  <label>
                    Project
                    <select
                      required
                      value={expenseForm.projectId}
                      onChange={(e) =>
                        setExpenseForm({ ...expenseForm, projectId: e.target.value })
                      }
                    >
                      <option value="">Select…</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.code} {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {expenseForm.kind === 'PERSONAL' && (
                  <label>
                    Employee
                    <select
                      required
                      value={expenseForm.employeeId}
                      onChange={(e) =>
                        setExpenseForm({ ...expenseForm, employeeId: e.target.value })
                      }
                    >
                      <option value="">Select from staff…</option>
                      {employees.map((emp) => (
                        <option key={emp.id} value={emp.id}>
                          {emp.fullName}
                          {emp.roleTitle ? ` · ${emp.roleTitle}` : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label>
                  Category
                  <input
                    value={expenseForm.category}
                    onChange={(e) =>
                      setExpenseForm({ ...expenseForm, category: e.target.value })
                    }
                  />
                </label>
                <label>
                  Description
                  <input
                    required
                    value={expenseForm.description}
                    onChange={(e) =>
                      setExpenseForm({ ...expenseForm, description: e.target.value })
                    }
                  />
                </label>
                <label>
                  Amount
                  <input
                    required
                    value={expenseForm.amount}
                    onChange={(e) => setExpenseForm({ ...expenseForm, amount: e.target.value })}
                  />
                </label>
                <button className="btn" type="submit">
                  Record expense
                </button>
              </form>
            </div>
          </div>

          <div className="grid grid-2" style={{ marginTop: '1rem' }}>
            <div className="panel">
              <h3>Debtors</h3>
              <p className="muted" style={{ marginTop: 0 }}>
                Clients with outstanding quotation balances.
              </p>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Client</th>
                      <th>Owes</th>
                      <th>Projects</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(debtors?.debtors || []).slice(0, 15).map((d: any) => (
                      <tr key={d.clientId}>
                        <td>
                          <Link href={`/clients/${d.clientId}`}>{d.clientName}</Link>
                        </td>
                        <td>{money(d.owedCents)}</td>
                        <td>{d.projects}</td>
                      </tr>
                    ))}
                    {!debtors?.debtors?.length && (
                      <tr>
                        <td colSpan={3} className="muted">
                          No open debtors.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="panel">
              <h3>Creditors</h3>
              <p className="muted" style={{ marginTop: 0 }}>
                Suppliers with stock or invoices on credit. Pay them here; statement PDF available.
              </p>
              <form className="form" onSubmit={payCreditor} style={{ marginBottom: 12 }}>
                <label>
                  Supplier
                  <select
                    required
                    value={creditorPay.supplierId}
                    onChange={(e) =>
                      setCreditorPay({ ...creditorPay, supplierId: e.target.value })
                    }
                  >
                    <option value="">Select…</option>
                    {(creditors?.creditors || []).map((c: any) => (
                      <option key={c.supplierId} value={c.supplierId}>
                        {c.supplierName} · owes {money(c.owedCents)}
                      </option>
                    ))}
                    {!(creditors?.creditors || []).length &&
                      suppliers.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Amount to pay
                  <input
                    required
                    value={creditorPay.amount}
                    onChange={(e) => setCreditorPay({ ...creditorPay, amount: e.target.value })}
                  />
                </label>
                <label>
                  Method
                  <select
                    value={creditorPay.method}
                    onChange={(e) => setCreditorPay({ ...creditorPay, method: e.target.value })}
                  >
                    <option value="CASH">Cash</option>
                    <option value="BANK_TRANSFER">Bank transfer</option>
                    <option value="MOBILE_MONEY">Mobile money</option>
                    <option value="CHEQUE">Cheque</option>
                  </select>
                </label>
                <label>
                  Reference
                  <input
                    value={creditorPay.reference}
                    onChange={(e) =>
                      setCreditorPay({ ...creditorPay, reference: e.target.value })
                    }
                  />
                </label>
                <button className="btn" type="submit">
                  Pay creditor
                </button>
              </form>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Supplier</th>
                      <th>Owed</th>
                      <th>Projects on credit</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {(creditors?.creditors || []).map((c: any) => (
                      <tr key={c.supplierId}>
                        <td>{c.supplierName}</td>
                        <td>{money(c.owedCents)}</td>
                        <td>{(c.projectsOnCredit || []).join(', ') || '—'}</td>
                        <td>
                          <button
                            type="button"
                            className="btn secondary"
                            onClick={() =>
                              downloadCreditorStatement(c.supplierId, c.supplierName)
                            }
                          >
                            Statement PDF
                          </button>
                        </td>
                      </tr>
                    ))}
                    {!creditors?.creditors?.length && (
                      <tr>
                        <td colSpan={4} className="muted">
                          No open creditors. Buy stock “on credit” to create them.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="grid grid-2" style={{ marginTop: '1rem' }}>
            <div className="panel">
              <h3>Request shortfall (MD approval)</h3>
              <form className="form" onSubmit={createShortfall}>
                <label>
                  Project
                  <select
                    required
                    value={shortfallForm.projectId}
                    onChange={(e) =>
                      setShortfallForm({ ...shortfallForm, projectId: e.target.value })
                    }
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
                  Amount
                  <input
                    required
                    value={shortfallForm.amount}
                    onChange={(e) =>
                      setShortfallForm({ ...shortfallForm, amount: e.target.value })
                    }
                  />
                </label>
                <label>
                  Reason
                  <textarea
                    required
                    value={shortfallForm.reason}
                    onChange={(e) =>
                      setShortfallForm({ ...shortfallForm, reason: e.target.value })
                    }
                  />
                </label>
                <button className="btn warn" type="submit">
                  Submit shortfall
                </button>
              </form>
            </div>
            <div className="panel">
              <h3>Shortfalls</h3>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Project</th>
                      <th>Amount</th>
                      <th>Status</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {shortfalls.map((s) => (
                      <tr key={s.id}>
                        <td>{s.project?.code}</td>
                        <td>{money(s.amountCents)}</td>
                        <td>
                          <span className="badge">{s.status}</span>
                        </td>
                        <td className="row-actions">
                          {canApprove && s.status === 'PENDING' && (
                            <>
                              <button
                                className="btn"
                                type="button"
                                onClick={() => decide(s.id, true)}
                              >
                                Approve
                              </button>
                              <button
                                className="btn danger"
                                type="button"
                                onClick={() => decide(s.id, false)}
                              >
                                Reject
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="panel" style={{ marginTop: '1rem' }}>
            <h3>Transaction search</h3>
            <label>
              Search payments &amp; expenses
              <input
                value={txSearch}
                onChange={(e) => setTxSearch(e.target.value)}
                placeholder="Receipt, project, employee, category…"
              />
            </label>
            <div className="grid grid-2" style={{ marginTop: 12 }}>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Receipt</th>
                      <th>Project</th>
                      <th>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPayments.map((p) => (
                      <tr key={p.id}>
                        <td>{p.receiptNumber}</td>
                        <td>{p.project?.code}</td>
                        <td>{money(p.amountCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Kind</th>
                      <th>Detail</th>
                      <th>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredExpenses.map((e) => (
                      <tr key={e.id}>
                        <td>
                          {e.kind === 'PERSONAL'
                            ? 'Personal'
                            : e.scope === 'PROJECT'
                              ? 'Project'
                              : 'Company'}
                        </td>
                        <td>
                          {e.category}: {e.description}
                          {e.employee?.fullName ? ` · ${e.employee.fullName}` : ''}
                          {e.project?.code ? ` · ${e.project.code}` : ''}
                        </td>
                        <td>{money(e.amountCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}
    </AppShell>
  );
}

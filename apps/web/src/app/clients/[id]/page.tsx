'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { LoadingState } from '@/components/LoadingState';
import { PropertyDetailsFields } from '@/components/PropertyDetailsFields';
import { api, downloadPdf, money } from '@/lib/api';
import {
  PROPERTY_TYPES,
  defaultsForPropertyType,
  propertyPayloadFromForm,
} from '@/lib/propertyDetails';
import { suggestedStagesForPropertyType } from '@/lib/propertyStages';

const STATUSES = ['DRAFT', 'QUOTED', 'ON_HOLD', 'COMPLETED', 'CANCELLED'];

type Stand = {
  id: string;
  code: string;
  name: string;
  status: string;
  standNumber?: number;
  clientId: string;
  completionPercent?: number;
};

type Package = {
  id: string;
  code: string;
  name: string;
  standCount: number;
  accountMode: 'SHARED' | 'SPLIT';
  projects: Stand[];
  _count?: { projects: number };
};

type ClientDetail = {
  id: string;
  name: string;
  type: 'INDIVIDUAL' | 'COMPANY';
  phone: string;
  whatsapp?: string;
  address?: string;
  contactPerson?: string;
  registrationNo?: string;
  projects: Array<{
    id: string;
    code: string;
    name: string;
    status: string;
    standPackage?: { id: string; name: string } | null;
  }>;
  standPackages: Package[];
  childAccounts: Array<{ id: string; name: string; _count: { projects: number } }>;
  ledger: Array<{
    id: string;
    entryType: string;
    description: string;
    amountCents: number;
    balanceCents: number;
    createdAt: string;
  }>;
};

const emptyPkg = {
  name: '',
  standCount: '10',
  propertyType: 'SINGLE_HOME',
  unitCount: '1',
  storeys: '1',
  bedrooms: '3',
  bathrooms: '2',
  kitchens: '1',
  lounges: '1',
  otherRooms: '0',
  floorAreaSqm: '',
  address: '',
  locationNotes: '',
  propertyNotes: '',
};

export default function ClientDetailPage() {
  const params = useParams();
  const id = String(params.id);
  const [client, setClient] = useState<ClientDetail | null>(null);
  const [activePkgId, setActivePkgId] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkStatus, setBulkStatus] = useState('ON_HOLD');
  const [pkgForm, setPkgForm] = useState(emptyPkg);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);

  async function load() {
    const data = await api<ClientDetail>(`/clients/${id}`);
    setClient(data);
    if (!activePkgId && data.standPackages[0]) {
      setActivePkgId(data.standPackages[0].id);
    }
  }

  async function downloadStatement() {
    if (!client) return;
    setPdfBusy(true);
    setError('');
    try {
      await downloadPdf(
        `/clients/${id}/statement/pdf`,
        `client-statement-${client.name}.pdf`,
      );
    } catch (e: any) {
      setError(e.message || 'PDF download failed');
    } finally {
      setPdfBusy(false);
    }
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const activePkg = useMemo(
    () => client?.standPackages.find((p) => p.id === activePkgId) || client?.standPackages[0],
    [client, activePkgId],
  );

  useEffect(() => {
    setSelected([]);
  }, [activePkg?.id]);

  async function createPackage(e: FormEvent) {
    e.preventDefault();
    if (!client || busy) return;
    setBusy(true);
    setError('');
    try {
      const property = propertyPayloadFromForm(pkgForm);
      const created = await api<Package>('/stand-packages', {
        method: 'POST',
        body: JSON.stringify({
          clientId: client.id,
          name: pkgForm.name.trim(),
          standCount: Number(pkgForm.standCount) || 1,
          ...property,
          address: pkgForm.address || undefined,
          locationNotes: pkgForm.locationNotes || undefined,
          stageTemplateNames: suggestedStagesForPropertyType(pkgForm.propertyType),
        }),
      });
      setPkgForm(emptyPkg);
      window.dispatchEvent(new Event('nomchael:notifications-refresh'));
      await load();
      setActivePkgId(created.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function toggleStand(standId: string) {
    setSelected((prev) =>
      prev.includes(standId) ? prev.filter((x) => x !== standId) : [...prev, standId],
    );
  }

  function selectAllStands() {
    if (!activePkg) return;
    setSelected(activePkg.projects.map((p) => p.id));
  }

  async function runBulk(all: boolean, action: 'status' | 'split' | 'merge') {
    if (!activePkg || busy) return;
    if (!all && !selected.length) {
      setError('Select stands first, or use Update all.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const body = { all, projectIds: all ? undefined : selected };
      if (action === 'status') {
        await api(`/stand-packages/${activePkg.id}/bulk-update`, {
          method: 'POST',
          body: JSON.stringify({ ...body, status: bulkStatus }),
        });
      } else if (action === 'split') {
        await api(`/stand-packages/${activePkg.id}/split-accounts`, {
          method: 'POST',
          body: JSON.stringify(body),
        });
      } else {
        await api(`/stand-packages/${activePkg.id}/merge-accounts`, {
          method: 'POST',
          body: JSON.stringify(body),
        });
      }
      await load();
      setSelected([]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!client) {
    return (
      <AppShell>
        {error ? <p className="error">{error}</p> : <LoadingState label="Loading client…" />}
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="row-actions" style={{ justifyContent: 'space-between' }}>
        <div>
          <p className="muted" style={{ marginBottom: 4 }}>
            <Link href="/clients">Clients</Link>
          </p>
          <h1>{client.name}</h1>
          <p className="muted">
            {client.type === 'COMPANY' ? 'Company' : 'Person'} · {client.whatsapp || client.phone}
            {client.contactPerson ? ` · ${client.contactPerson}` : ''}
          </p>
        </div>
        <button
          type="button"
          className="btn"
          disabled={pdfBusy}
          onClick={() => downloadStatement()}
        >
          {pdfBusy ? 'Preparing…' : 'Download statement PDF'}
        </button>
      </div>
      {error && <p className="error">{error}</p>}

      {client.type === 'COMPANY' && (
        <div className="grid grid-2" style={{ marginTop: '1rem' }}>
          <div className="panel">
            <h3>New stand package</h3>
            <p className="muted">
              Allocate identical stands under this company. Default: one shared company account.
            </p>
            <form className="form" onSubmit={createPackage}>
              <label>
                Package name
                <input
                  required
                  value={pkgForm.name}
                  onChange={(e) => setPkgForm({ ...pkgForm, name: e.target.value })}
                  placeholder="e.g. Borrowdale Phase 2"
                />
              </label>
              <label>
                Number of stands
                <input
                  type="number"
                  min={1}
                  max={500}
                  required
                  value={pkgForm.standCount}
                  onChange={(e) => setPkgForm({ ...pkgForm, standCount: e.target.value })}
                />
              </label>
              <label>
                Property type
                <select
                  value={pkgForm.propertyType}
                  onChange={(e) =>
                    setPkgForm((f) => ({
                      ...f,
                      propertyType: e.target.value,
                      ...defaultsForPropertyType(e.target.value),
                      propertyNotes: f.propertyNotes,
                    }))
                  }
                >
                  {PROPERTY_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
              <PropertyDetailsFields
                form={pkgForm}
                onChange={(patch) => setPkgForm((f) => ({ ...f, ...patch }))}
              />
              <label>
                Estate / site address
                <input
                  value={pkgForm.address}
                  onChange={(e) => setPkgForm({ ...pkgForm, address: e.target.value })}
                />
              </label>
              <label>
                Location notes
                <input
                  value={pkgForm.locationNotes}
                  onChange={(e) => setPkgForm({ ...pkgForm, locationNotes: e.target.value })}
                />
              </label>
              <p className="muted">
                Map GPS is captured later on each stand when you visit site (open the stand project
                on your phone).
              </p>
              <button className="btn" type="submit" disabled={busy}>
                {busy ? 'Creating…' : 'Create stands'}
              </button>
            </form>
          </div>

          <div className="panel">
            <h3>Stand packages</h3>
            {!client.standPackages.length && (
              <p className="muted">No packages yet. Create one on the left.</p>
            )}
            {client.standPackages.length > 0 && (
              <>
                <label>
                  Active package
                  <select
                    value={activePkg?.id || ''}
                    onChange={(e) => setActivePkgId(e.target.value)}
                  >
                    {client.standPackages.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.code}: {p.name} ({p.standCount} stands · {p.accountMode})
                      </option>
                    ))}
                  </select>
                </label>

                {activePkg && (
                  <>
                    <div className="row-actions" style={{ marginTop: 12 }}>
                      <button type="button" className="btn secondary" onClick={selectAllStands}>
                        Select all
                      </button>
                      <button type="button" className="btn secondary" onClick={() => setSelected([])}>
                        Clear
                      </button>
                      <select value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value)}>
                        {STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="btn"
                        disabled={busy}
                        onClick={() => runBulk(false, 'status')}
                      >
                        Update selected
                      </button>
                      <button
                        type="button"
                        className="btn"
                        disabled={busy}
                        onClick={() => runBulk(true, 'status')}
                      >
                        Update all
                      </button>
                    </div>
                    <div className="row-actions" style={{ marginTop: 8 }}>
                      <button
                        type="button"
                        className="btn secondary"
                        disabled={busy}
                        onClick={() => runBulk(false, 'split')}
                      >
                        Split selected to own account
                      </button>
                      <button
                        type="button"
                        className="btn secondary"
                        disabled={busy}
                        onClick={() => runBulk(true, 'split')}
                      >
                        Split all
                      </button>
                      <button
                        type="button"
                        className="btn secondary"
                        disabled={busy}
                        onClick={() => runBulk(false, 'merge')}
                      >
                        Merge selected to company
                      </button>
                      <button
                        type="button"
                        className="btn secondary"
                        disabled={busy}
                        onClick={() => runBulk(true, 'merge')}
                      >
                        Merge all
                      </button>
                    </div>
                    <p className="muted" style={{ marginTop: 8 }}>
                      Account mode: {activePkg.accountMode}. Default is one company wallet; split
                      only when the exercise needs separate books.
                    </p>
                    <div className="table-wrap" style={{ marginTop: 12 }}>
                      <table>
                        <thead>
                          <tr>
                            <th></th>
                            <th>Stand</th>
                            <th>Code</th>
                            <th>Status</th>
                            <th>Account</th>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {activePkg.projects.map((s) => (
                            <tr key={s.id}>
                              <td>
                                <input
                                  type="checkbox"
                                  checked={selected.includes(s.id)}
                                  onChange={() => toggleStand(s.id)}
                                />
                              </td>
                              <td>{s.standNumber ?? '—'}</td>
                              <td>{s.code}</td>
                              <td>{s.status}</td>
                              <td>
                                {s.clientId === client.id ? 'Company' : 'Split'}
                              </td>
                              <td>
                                <Link href={`/projects/${s.id}`}>Open</Link>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-2" style={{ marginTop: '1rem' }}>
        <div className="panel">
          <h3>Projects</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Name</th>
                  <th>Status</th>
                  <th>Package</th>
                </tr>
              </thead>
              <tbody>
                {client.projects.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link href={`/projects/${p.id}`}>{p.code}</Link>
                    </td>
                    <td>{p.name}</td>
                    <td>{p.status}</td>
                    <td>{p.standPackage?.name || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="panel">
          <h3>Company / client account</h3>
          {client.childAccounts?.length > 0 && (
            <p className="muted" style={{ marginBottom: 8 }}>
              Split accounts: {client.childAccounts.map((a) => a.name).join(', ')}
            </p>
          )}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Type</th>
                  <th>Description</th>
                  <th>Amount</th>
                  <th>Balance</th>
                </tr>
              </thead>
              <tbody>
                {(client.ledger || []).map((e) => (
                  <tr key={e.id}>
                    <td>{new Date(e.createdAt).toLocaleDateString()}</td>
                    <td>{e.entryType}</td>
                    <td>{e.description}</td>
                    <td>{money(e.amountCents)}</td>
                    <td>{money(e.balanceCents)}</td>
                  </tr>
                ))}
                {!client.ledger?.length && (
                  <tr>
                    <td colSpan={5} className="muted">
                      No ledger entries yet
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

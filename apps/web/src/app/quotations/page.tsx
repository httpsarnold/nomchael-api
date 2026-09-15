'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { BusyOverlay, LoadingState, SavePulse } from '@/components/LoadingState';
import { QuotationStatement } from '@/components/QuotationStatement';
import { api, downloadPdf, getUser, money } from '@/lib/api';
import { PROPERTY_TYPES, defaultsForPropertyType, storeysLabel } from '@/lib/propertyDetails';

function statusLabel(status: string) {
  if (status === 'PENDING_MD_APPROVAL') return 'Awaiting MD approval';
  if (status === 'SENT') return 'Sent to client';
  if (status === 'ACCEPTED') return 'File opened (accepted)';
  return status.replace(/_/g, ' ');
}

function propertyTypeLabel(type?: string) {
  return PROPERTY_TYPES.find((t) => t.value === type)?.label || type || 'Single home';
}

function totalRooms(project?: any) {
  if (!project) return 0;
  return (
    Number(project.bedrooms || 0) +
    Number(project.bathrooms || 0) +
    Number(project.kitchens || 0) +
    Number(project.lounges || 0) +
    Number(project.otherRooms || 0)
  );
}

function specsSummary(project?: any) {
  if (!project) return '—';
  const parts: string[] = [propertyTypeLabel(project.propertyType)];
  if (project.unitCount > 1) parts.push(`${project.unitCount} units`);
  if (Number(project.storeys) >= 2) parts.push(storeysLabel(project.storeys));
  else if (Number(project.storeys) === 1) parts.push('ground floor only');
  if (project.bedrooms) parts.push(`${project.bedrooms} bed`);
  if (project.bathrooms) parts.push(`${project.bathrooms} bath`);
  const rooms = totalRooms(project);
  if (rooms) parts.push(`${rooms} rooms`);
  if (project.floorAreaSqm) parts.push(`${project.floorAreaSqm} m²`);
  return parts.join(' · ');
}

/** Match past quotations by project/client text or property specs (rooms, m², type). */
function quotationMatchesSearch(q: any, raw: string) {
  const query = raw.trim().toLowerCase();
  if (!query) return true;
  const p = q.project || {};
  const rooms = totalRooms(p);
  const area = Number(p.floorAreaSqm || 0);
  const typeLabel = propertyTypeLabel(p.propertyType).toLowerCase();
  const typeRaw = String(p.propertyType || '').toLowerCase().replace(/_/g, ' ');

  const haystack = [
    p.code,
    p.name,
    p.client?.name,
    p.propertyNotes,
    p.address,
    typeLabel,
    typeRaw,
    specsSummary(p),
    `${p.bedrooms} bed`,
    `${p.bedrooms} bedroom`,
    `${p.bedrooms} bedrooms`,
    `${p.bathrooms} bath`,
    `${p.bathrooms} bathroom`,
    `${rooms} room`,
    `${rooms} rooms`,
    `${p.unitCount} unit`,
    `${p.unitCount} units`,
    `${p.unitCount} flat`,
    `${p.unitCount} flats`,
    storeysLabel(p.storeys),
    Number(p.storeys) >= 2 ? 'upstairs' : 'ground floor',
    Number(p.storeys) >= 2 ? 'double storey' : 'single storey',
    `${area} m2`,
    `${area} m²`,
    `${area} sqm`,
    `${area} sq m`,
    statusLabel(q.status),
    `v${q.version}`,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  const tokens = query.split(/\s+/).filter(Boolean);
  return tokens.every((token) => {
    if (haystack.includes(token)) return true;

    // "4rooms" / "1000sqm" / "4bed"
    const roomMatch = token.match(/^(\d+(?:\.\d+)?)(?:rooms?|beds?|bedrooms?)?$/);
    if (roomMatch) {
      const n = Number(roomMatch[1]);
      if (
        n === rooms ||
        n === Number(p.bedrooms || 0) ||
        n === Number(p.bathrooms || 0) ||
        n === Number(p.unitCount || 0)
      ) {
        return true;
      }
    }
    const areaMatch = token.match(/^(\d+(?:\.\d+)?)(?:m2|m²|sqm|sq)?$/);
    if (areaMatch && area) {
      const n = Number(areaMatch[1]);
      if (Math.abs(area - n) < 0.5) return true;
      // allow approximate "around 1000"
      if (area >= n * 0.9 && area <= n * 1.1) return true;
    }
    if (token.includes('upstair') || token.includes('double') || token === '2storey') {
      if (Number(p.storeys) >= 2) return true;
    }
    if (
      (token.includes('apart') || token === 'flat') &&
      (typeRaw.includes('flat') || typeRaw.includes('apartment'))
    ) {
      return true;
    }
    if (token.includes('house') && (typeRaw.includes('home') || typeRaw.includes('house'))) {
      return true;
    }
    return false;
  });
}

export default function QuotationsPage() {
  const router = useRouter();
  const [quotations, setQuotations] = useState<any[]>([]);
  const [quoteSearch, setQuoteSearch] = useState('');
  const [projects, setProjects] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [item, setItem] = useState({
    description: '',
    quantity: '1',
    unit: 'bags',
    unitPrice: '',
    projectStageId: '',
    type: 'MATERIAL',
  });
  const [optItem, setOptItem] = useState('');
  const [options, setOptions] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [starting, setStarting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [openingQuote, setOpeningQuote] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState('Updating…');
  const [savedFlash, setSavedFlash] = useState('');
  const [startMode, setStartMode] = useState<'existing' | 'new'>('new');
  const [startForm, setStartForm] = useState({
    projectId: '',
    clientId: '',
    name: '',
    propertyType: 'SINGLE_HOME',
    address: '',
  });
  const [catalog, setCatalog] = useState<any[]>([]);
  const [catalogPick, setCatalogPick] = useState<Record<string, { on: boolean; qty: string; price: string }>>(
    {},
  );
  const [catalogFilter, setCatalogFilter] = useState('');
  const [labourForm, setLabourForm] = useState({ stageId: '', amount: '' });
  const [equipmentForm, setEquipmentForm] = useState({
    description: '',
    quantity: '1',
    unit: 'days',
    unitPrice: '',
  });
  const user = getUser();
  const canMdApprove =
    user?.role === 'MANAGING_DIRECTOR' || user?.role === 'SUPER_ADMIN';

  const quoteReadyProjects = projects.filter(
    (p) => p.status === 'DRAFT' || p.status === 'QUOTED',
  );

  const filteredQuotations = useMemo(
    () => quotations.filter((q) => quotationMatchesSearch(q, quoteSearch)),
    [quotations, quoteSearch],
  );

  async function load() {
    const [q, p, c] = await Promise.all([
      api('/quotations'),
      api('/projects'),
      api('/clients'),
    ]);
    setQuotations(q as any[]);
    setProjects(p as any[]);
    setClients(c as any[]);
  }

  async function loadCatalog() {
    if (catalog.length) return;
    setCatalogLoading(true);
    try {
      setCatalog(await api('/catalog'));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCatalogLoading(false);
    }
  }

  function applyQuote(updated: any) {
    setSelected(updated);
    setQuotations((prev) => {
      const idx = prev.findIndex((q) => q.id === updated.id);
      if (idx < 0) return [updated, ...prev];
      const next = [...prev];
      next[idx] = {
        ...next[idx],
        ...updated,
        project: updated.project || next[idx].project,
      };
      return next;
    });
  }

  useEffect(() => {
    setLoading(true);
    load()
      .then(() => {
        if (typeof window === 'undefined') return;
        const params = new URLSearchParams(window.location.search);
        const quoteId = params.get('quoteId');
        const projectId = params.get('projectId');
        if (quoteId) openQuote(quoteId);
        else if (projectId) {
          setStartMode('existing');
          setStartForm((f) => ({ ...f, projectId }));
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (selected?.status === 'DRAFT') {
      loadCatalog().catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, selected?.status]);

  function flashSaved(message = 'Saved to database') {
    setSavedFlash(message);
    window.setTimeout(() => setSavedFlash(''), 2400);
  }

  async function openQuote(id: string) {
    setOpeningQuote(true);
    setError('');
    try {
      setSelected(await api(`/quotations/${id}`));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOpeningQuote(false);
    }
  }

  async function startQuotation(e: FormEvent) {
    e.preventDefault();
    setError('');
    setInfo('');
    setStarting(true);
    try {
      let projectId = startForm.projectId;

      if (startMode === 'new') {
        if (!startForm.clientId || !startForm.name.trim()) {
          setError('Client and project name are required to start a quotation.');
          setStarting(false);
          return;
        }
        const defaults = defaultsForPropertyType(startForm.propertyType);
        const created = await api<{ id: string }>('/projects', {
          method: 'POST',
          body: JSON.stringify({
            name: startForm.name.trim(),
            clientId: startForm.clientId,
            address: startForm.address || undefined,
            propertyType: startForm.propertyType,
            unitCount: Number(defaults.unitCount) || 1,
            bedrooms: Number(defaults.bedrooms) || 0,
            bathrooms: Number(defaults.bathrooms) || 0,
            kitchens: Number(defaults.kitchens) || 0,
            lounges: Number(defaults.lounges) || 0,
            otherRooms: Number(defaults.otherRooms) || 0,
          }),
        });
        projectId = created.id;
      } else if (!projectId) {
        setError('Select a registered project.');
        setStarting(false);
        return;
      }

      const quote = await api<{ id: string }>('/quotations', {
        method: 'POST',
        body: JSON.stringify({ projectId }),
      });
      setStartForm({
        projectId: '',
        clientId: '',
        name: '',
        propertyType: 'SINGLE_HOME',
        address: '',
      });
      setInfo(
        'Quotation started. Add line items, send to the client. The file opens only after they agree and MD approves.',
      );
      const full = await api<any>(`/quotations/${quote.id}`);
      applyQuote(full);
      router.replace(`/quotations?quoteId=${quote.id}`, { scroll: false });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setStarting(false);
    }
  }

  async function addItem(e: FormEvent) {
    e.preventDefault();
    if (!selected) return;
    const updated = await api<any>(`/quotations/${selected.id}/items`, {
      method: 'POST',
      body: JSON.stringify({
        multiplyByStructures: true,
        items: [
          {
            description: item.description,
            quantity: Number(item.quantity),
            unit: item.unit,
            unitPriceCents: Math.round(Number(item.unitPrice) * 100),
            projectStageId: item.projectStageId || undefined,
            type: item.type,
          },
        ],
      }),
    });
    setItem({
      description: '',
      quantity: '1',
      unit: 'bags',
      unitPrice: '',
      projectStageId: '',
      type: 'MATERIAL',
    });
    applyQuote(updated);
  }

  async function importCatalog() {
    if (!selected) return;
    setError('');
    const items = Object.entries(catalogPick)
      .filter(([, v]) => v.on)
      .map(([catalogItemId, v]) => ({
        catalogItemId,
        quantity: Number(v.qty) || 1,
        unitPriceCents: v.price ? Math.round(Number(v.price) * 100) : undefined,
      }));
    if (!items.length) {
      setError('Select at least one material from the catalog.');
      return;
    }
    setActionBusy(true);
    setBusyLabel('Saving materials to database…');
    try {
      const updated = await api<any>(`/quotations/${selected.id}/import-catalog`, {
        method: 'POST',
        body: JSON.stringify({ items, multiplyByStructures: true }),
      });
      setCatalogPick({});
      applyQuote(updated);
      const count = updated.structures?.count || 1;
      setInfo(
        count > 1
          ? `Imported ${items.length} line(s). Quantities × ${count} ${updated.structures.label}. Saved on quotation (stock waits for payment).`
          : `Imported ${items.length} line(s). Saved on quotation (stock waits for payment).`,
      );
      flashSaved('Materials saved on quotation');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setActionBusy(false);
    }
  }

  async function updateLine(lineId: string, quantity: number, unitPrice: number) {
    if (!selected) return;
    const updated = await api<any>(`/quotations/${selected.id}/items/${lineId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        quantity,
        unitPriceCents: Math.round(unitPrice * 100),
      }),
    });
    applyQuote(updated);
  }

  async function removeLine(lineId: string) {
    if (!selected) return;
    const updated = await api<any>(`/quotations/${selected.id}/items/${lineId}`, {
      method: 'DELETE',
    });
    applyQuote(updated);
    setInfo('Line deleted from database.');
    flashSaved('Line deleted from database');
  }

  async function saveLabour(e: FormEvent) {
    e.preventDefault();
    if (!selected?.projectId || !labourForm.stageId || !labourForm.amount) return;
    setError('');
    setBusyLabel('Saving labour to database…');
    setActionBusy(true);
    try {
      const result = await api<any>(
        `/quotations/projects/${selected.projectId}/stages/${labourForm.stageId}/labour`,
        {
          method: 'POST',
          body: JSON.stringify({
            labourCents: Math.round(Number(labourForm.amount) * 100),
            multiplyByStructures: true,
            quotationId: selected.id,
          }),
        },
      );
      if (result.quotation) applyQuote(result.quotation);
      else applyQuote(await api(`/quotations/${selected.id}`));
      setLabourForm({ stageId: '', amount: '' });
      setInfo('Labour saved to database.');
      flashSaved('Labour saved to database');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setActionBusy(false);
    }
  }

  async function addEquipment(e: FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setBusyLabel('Saving equipment hire…');
    setActionBusy(true);
    setError('');
    try {
      const updated = await api<any>(`/quotations/${selected.id}/items`, {
        method: 'POST',
        body: JSON.stringify({
          multiplyByStructures: false,
          items: [
            {
              description: equipmentForm.description,
              quantity: Number(equipmentForm.quantity) || 1,
              unit: equipmentForm.unit || 'days',
              unitPriceCents: Math.round(Number(equipmentForm.unitPrice) * 100),
              type: 'EQUIPMENT',
            },
          ],
        }),
      });
      applyQuote(updated);
      setEquipmentForm({ description: '', quantity: '1', unit: 'days', unitPrice: '' });
      setInfo('Equipment hire added to quotation.');
      flashSaved('Equipment hire saved');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setActionBusy(false);
    }
  }

  async function sendWhatsapp() {
    if (!selected) return;
    setError('');
    setBusyLabel('Sending quotation…');
    setActionBusy(true);
    try {
      await api(`/quotations/${selected.id}/send-whatsapp`, { method: 'POST' });
      setInfo('Quotation sent to the client. When they agree, mark client agreed below.');
      applyQuote(await api(`/quotations/${selected.id}`));
      flashSaved('Send recorded');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setActionBusy(false);
    }
  }

  async function clientAgreed() {
    if (!selected) return;
    setError('');
    setBusyLabel('Recording agreement…');
    setActionBusy(true);
    try {
      await api(`/quotations/${selected.id}/accept`, { method: 'POST' });
      window.dispatchEvent(new Event('nomchael:notifications-refresh'));
      setInfo('Client agreement recorded. Waiting for Managing Director to open the file.');
      applyQuote(await api(`/quotations/${selected.id}`));
      flashSaved('Agreement saved');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setActionBusy(false);
    }
  }

  async function mdDecide(approve: boolean) {
    if (!selected) return;
    setError('');
    setBusyLabel(approve ? 'Opening project file…' : 'Saving rejection…');
    setActionBusy(true);
    try {
      const result = await api<any>(`/quotations/${selected.id}/md-decide`, {
        method: 'POST',
        body: JSON.stringify({
          approve,
          rejectionReason: approve ? undefined : rejectReason || undefined,
        }),
      });
      setRejectReason('');
      window.dispatchEvent(new Event('nomchael:notifications-refresh'));
      if (approve) {
        const projectId = result.projectId || result.project?.id || selected.projectId;
        router.push(`/projects/${projectId}?opened=1`);
        return;
      }
      setInfo('Quotation rejected by MD.');
      applyQuote(await api(`/quotations/${selected.id}`));
      flashSaved('Rejection saved');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setActionBusy(false);
    }
  }

  async function optimize() {
    if (!selected || !optItem) return;
    const res = await api<any[]>(
      `/suppliers/optimize?item=${encodeURIComponent(optItem)}&projectId=${selected.projectId}&quantity=1`,
    );
    setOptions(res);
  }

  async function applyOptimized(opt: any) {
    if (!selected) return;
    const updated = await api<any>(`/quotations/${selected.id}/items`, {
      method: 'POST',
      body: JSON.stringify({
        multiplyByStructures: true,
        items: [
          {
            description: opt.itemName,
            quantity: 1,
            unit: opt.unit,
            unitPriceCents: opt.unitPriceCents,
            supplierId: opt.supplierId,
            type: 'MATERIAL',
          },
        ],
      }),
    });
    applyQuote(updated);
  }

  return (
    <AppShell>
      {(starting || actionBusy) && (
        <BusyOverlay label={starting ? 'Starting quotation…' : busyLabel} />
      )}
      <h1>Quotations</h1>
      <p className="muted">
        A paid site visit is required before starting a quotation. Materials, labour and equipment
        hire save on the quote as you build. Stores only after client project payment. File opens
        after client agree + MD approve. Manage visits under Site visits.
      </p>
      {error && <p className="error">{error}</p>}
      {info && (
        <div className="info-banner" style={{ marginTop: '0.75rem', borderColor: '#16a34a' }}>
          <span>✓</span>
          <span>{info}</span>
        </div>
      )}
      {loading && <LoadingState label="Loading quotations…" />}

      {!loading && (
      <>
      <div className="panel" style={{ marginTop: '1rem' }}>
        <h3>Start a quotation (before opening the file)</h3>
        <div className="row-actions" style={{ marginBottom: 12 }}>
          <button
            type="button"
            className={`btn ${startMode === 'new' ? '' : 'secondary'}`}
            onClick={() => setStartMode('new')}
          >
            New registered site + quote
          </button>
          <button
            type="button"
            className={`btn ${startMode === 'existing' ? '' : 'secondary'}`}
            onClick={() => setStartMode('existing')}
          >
            Quote an existing registered project
          </button>
        </div>
        <form className="form" onSubmit={startQuotation}>
          {startMode === 'new' ? (
            <>
              <label>
                Client
                <select
                  required
                  value={startForm.clientId}
                  onChange={(e) => setStartForm({ ...startForm, clientId: e.target.value })}
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
                Site / project name
                <input
                  required
                  value={startForm.name}
                  onChange={(e) => setStartForm({ ...startForm, name: e.target.value })}
                  placeholder="e.g. Chishawasha house"
                />
              </label>
              <label>
                Property type
                <select
                  value={startForm.propertyType}
                  onChange={(e) => setStartForm({ ...startForm, propertyType: e.target.value })}
                >
                  {PROPERTY_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Site address (optional)
                <input
                  value={startForm.address}
                  onChange={(e) => setStartForm({ ...startForm, address: e.target.value })}
                />
              </label>
            </>
          ) : (
            <label>
              Registered project (not open yet)
              <select
                required
                value={startForm.projectId}
                onChange={(e) => setStartForm({ ...startForm, projectId: e.target.value })}
              >
                <option value="">Select…</option>
                {quoteReadyProjects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code} {p.name} ({p.status === 'DRAFT' ? 'Registered' : 'Quoted'})
                  </option>
                ))}
              </select>
            </label>
          )}
          <button className="btn" type="submit" disabled={starting}>
            {starting ? 'Starting…' : 'Start quotation'}
          </button>
        </form>
      </div>

      <div className="grid grid-2" style={{ marginTop: '1rem' }}>
        <div className="panel">
          <h3>All quotations</h3>
          <p className="muted" style={{ marginTop: 0 }}>
            Search past quotes by property specs so you can reuse similar work (rooms, floor area,
            house or apartment type).
          </p>
          <label style={{ display: 'block', marginBottom: 12 }}>
            Search quotations
            <input
              value={quoteSearch}
              onChange={(e) => setQuoteSearch(e.target.value)}
              placeholder="e.g. 4 rooms, 1000 sqm, apartment, 3 bed…"
            />
          </label>
          <p className="muted" style={{ marginTop: 0 }}>
            Showing {filteredQuotations.length} of {quotations.length}
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Specs</th>
                  <th>Ver</th>
                  <th>Status</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {filteredQuotations.map((q) => (
                  <tr key={q.id} style={{ cursor: 'pointer' }} onClick={() => openQuote(q.id)}>
                    <td>
                      {q.project?.code} {q.project?.name}
                      {q.project?.client?.name ? (
                        <div className="muted" style={{ fontSize: '0.8rem' }}>
                          {q.project.client.name}
                        </div>
                      ) : null}
                    </td>
                    <td style={{ fontSize: '0.85rem' }}>{specsSummary(q.project)}</td>
                    <td>v{q.version}</td>
                    <td>
                      <span className="badge">{statusLabel(q.status)}</span>
                    </td>
                    <td>{money(q.totalCents)}</td>
                  </tr>
                ))}
                {!filteredQuotations.length && (
                  <tr>
                    <td colSpan={5} className="muted">
                      {quoteSearch.trim()
                        ? `No past quotations match “${quoteSearch.trim()}”. Try rooms, m², or property type.`
                        : 'No quotations yet.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          {openingQuote ? (
            <LoadingState label="Opening quotation…" />
          ) : selected ? (
            <>
              {savedFlash && <SavePulse label={savedFlash} />}
              <h3>
                {selected.project?.name} v{selected.version}{' '}
                <span className="badge">{statusLabel(selected.status)}</span>
              </h3>
              <QuotationStatement
                quote={selected}
                editable={selected.status === 'DRAFT'}
                onRemoveLine={removeLine}
              />
              {selected.structures?.count > 1 && (
                <div className="info-banner" style={{ borderColor: '#93c5fd', marginTop: '0.75rem' }}>
                  <span>×</span>
                  <span>
                    Structure multiplier: <strong>{selected.structures.count}</strong>{' '}
                    {selected.structures.label}. Catalog qty is per structure, then multiplied on
                    import.
                  </span>
                </div>
              )}
              {selected.project?.status && selected.project.status !== 'ACTIVE' && (
                <p className="muted">
                  Project file status: {selected.project.status} (not open yet until MD approves).
                </p>
              )}
              {selected.status === 'PENDING_MD_APPROVAL' && (
                <p className="muted">
                  Client agreed. Waiting for Managing Director to open the file.
                </p>
              )}
              {selected.status === 'ACCEPTED' && selected.mdApprovedBy && (
                <p className="muted">
                  File opened by {selected.mdApprovedBy.fullName}
                  {selected.mdApprovedAt
                    ? ` on ${new Date(selected.mdApprovedAt).toLocaleDateString()}`
                    : ''}
                  .
                </p>
              )}
              {selected.status === 'REJECTED' && (
                <p className="error">
                  Rejected by MD
                  {selected.mdRejectionReason ? `: ${selected.mdRejectionReason}` : ''}
                </p>
              )}
              <div className="row-actions">
                {(selected.status === 'DRAFT' || selected.status === 'SENT') && (
                  <button className="btn" type="button" onClick={sendWhatsapp}>
                    Send to client (WhatsApp)
                  </button>
                )}
                {selected.status === 'SENT' && (
                  <button className="btn warn" type="button" onClick={clientAgreed}>
                    Client agreed → send to MD
                  </button>
                )}
                {selected.status === 'DRAFT' && (
                  <button className="btn secondary" type="button" onClick={clientAgreed}>
                    Client agreed (no WhatsApp) → MD
                  </button>
                )}
                {canMdApprove && selected.status === 'PENDING_MD_APPROVAL' && (
                  <>
                    <button className="btn" type="button" onClick={() => mdDecide(true)}>
                      MD approve &amp; open file
                    </button>
                    <button className="btn secondary" type="button" onClick={() => mdDecide(false)}>
                      MD reject
                    </button>
                  </>
                )}
                <button
                  type="button"
                  className="btn secondary"
                  onClick={() =>
                    downloadPdf(
                      `/quotations/${selected.id}/pdf`,
                      `quotation-${selected.project?.code || 'quote'}-v${selected.version}.pdf`,
                    ).catch((e) => setError(e.message))
                  }
                >
                  Download PDF
                </button>
              </div>
              {canMdApprove && selected.status === 'PENDING_MD_APPROVAL' && (
                <label style={{ display: 'block', marginTop: '0.75rem' }}>
                  Rejection reason (optional)
                  <input
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="Why this quotation is rejected"
                  />
                </label>
              )}
              <div className="table-wrap" style={{ marginTop: '1rem' }}>
                <table>
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Qty</th>
                      <th>Unit price</th>
                      <th>Total</th>
                      {selected.status === 'DRAFT' && <th></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {selected.lineItems?.map((li: any) => (
                      <tr key={li.id}>
                        <td>
                          {li.description}
                          {li.catalogItemId ? (
                            <div className="muted" style={{ fontSize: '0.75rem' }}>
                              from catalog
                            </div>
                          ) : null}
                        </td>
                        <td>
                          {selected.status === 'DRAFT' ? (
                            <input
                              style={{ width: 70 }}
                              defaultValue={li.quantity}
                              onBlur={(e) =>
                                updateLine(
                                  li.id,
                                  Number(e.target.value),
                                  Number(li.unitPriceCents) / 100,
                                )
                              }
                            />
                          ) : (
                            <>
                              {li.quantity} {li.unit}
                            </>
                          )}
                        </td>
                        <td>
                          {selected.status === 'DRAFT' ? (
                            <input
                              style={{ width: 90 }}
                              defaultValue={(Number(li.unitPriceCents) / 100).toFixed(2)}
                              onBlur={(e) =>
                                updateLine(li.id, Number(li.quantity), Number(e.target.value))
                              }
                            />
                          ) : (
                            money(li.unitPriceCents)
                          )}
                        </td>
                        <td>{money(li.totalCents)}</td>
                        {selected.status === 'DRAFT' && (
                          <td>
                            <button
                              className="btn secondary"
                              type="button"
                              onClick={() => removeLine(li.id)}
                            >
                              Remove
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {selected.status === 'DRAFT' && (
                <>
                  <div className="form" style={{ marginTop: '1rem' }}>
                    <h3>Import from material catalog</h3>
                    <p className="muted" style={{ marginTop: 0 }}>
                      Qty below is <strong>per structure</strong>
                      {selected.structures?.count > 1
                        ? ` and will multiply × ${selected.structures.count} ${selected.structures.label}`
                        : ''}
                      . Changing quote price does not change the catalog.
                    </p>
                    <label>
                      Filter catalog
                      <input
                        value={catalogFilter}
                        onChange={(e) => setCatalogFilter(e.target.value)}
                        placeholder="cement, brick…"
                      />
                    </label>
                    <div className="table-wrap" style={{ maxHeight: 220, overflow: 'auto' }}>
                      {catalogLoading ? (
                        <LoadingState compact label="Loading catalog…" />
                      ) : (
                      <table>
                        <thead>
                          <tr>
                            <th></th>
                            <th>Item</th>
                            <th>Default</th>
                            <th>
                              Qty per{' '}
                              {selected.structures?.label === 'stands' ? 'stand' : 'unit'}
                            </th>
                            <th>Quote price</th>
                          </tr>
                        </thead>
                        <tbody>
                          {catalog
                            .filter((c) => {
                              const f = catalogFilter.trim().toLowerCase();
                              if (!f) return true;
                              return (
                                c.name.toLowerCase().includes(f) ||
                                (c.category || '').toLowerCase().includes(f)
                              );
                            })
                            .map((c) => {
                              const pick = catalogPick[c.id] || {
                                on: false,
                                qty: '1',
                                price: (Number(c.defaultUnitPriceCents) / 100).toFixed(2),
                              };
                              return (
                                <tr key={c.id}>
                                  <td>
                                    <input
                                      type="checkbox"
                                      checked={pick.on}
                                      onChange={(e) =>
                                        setCatalogPick({
                                          ...catalogPick,
                                          [c.id]: { ...pick, on: e.target.checked },
                                        })
                                      }
                                    />
                                  </td>
                                  <td>
                                    {c.name}
                                    <div className="muted" style={{ fontSize: '0.75rem' }}>
                                      {c.unit} · {c.category || 'General'}
                                    </div>
                                  </td>
                                  <td>{money(c.defaultUnitPriceCents)}</td>
                                  <td>
                                    <input
                                      style={{ width: 60 }}
                                      value={pick.qty}
                                      onChange={(e) =>
                                        setCatalogPick({
                                          ...catalogPick,
                                          [c.id]: { ...pick, qty: e.target.value },
                                        })
                                      }
                                    />
                                  </td>
                                  <td>
                                    <input
                                      style={{ width: 80 }}
                                      value={pick.price}
                                      onChange={(e) =>
                                        setCatalogPick({
                                          ...catalogPick,
                                          [c.id]: { ...pick, price: e.target.value },
                                        })
                                      }
                                    />
                                  </td>
                                </tr>
                              );
                            })}
                        </tbody>
                      </table>
                      )}
                    </div>
                    <button className="btn" type="button" onClick={importCatalog} disabled={actionBusy || catalogLoading}>
                      {actionBusy ? 'Updating statement…' : 'Import selected into quotation'}
                    </button>
                  </div>

                  <form className="form" onSubmit={saveLabour} style={{ marginTop: '1rem' }}>
                    <h3>Add labour by stage</h3>
                    <p className="muted" style={{ marginTop: 0 }}>
                      Amount is per structure and multiplies by units/stands onto the statement.
                    </p>
                    <label>
                      Stage
                      <select
                        required
                        value={labourForm.stageId}
                        onChange={(e) => setLabourForm({ ...labourForm, stageId: e.target.value })}
                      >
                        <option value="">Select…</option>
                        {selected.project?.stages?.map((s: any) => (
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
                        value={labourForm.amount}
                        onChange={(e) => setLabourForm({ ...labourForm, amount: e.target.value })}
                      />
                    </label>
                    <button className="btn secondary" type="submit">
                      Add labour to statement
                    </button>
                  </form>

                  <form className="form" onSubmit={addEquipment} style={{ marginTop: '1rem' }}>
                    <h3>Equipment hire</h3>
                    <p className="muted" style={{ marginTop: 0 }}>
                      Excavator, scaffolding, mixer, and other hire go on the quotation here.
                    </p>
                    <label>
                      Equipment
                      <input
                        required
                        value={equipmentForm.description}
                        onChange={(e) =>
                          setEquipmentForm({ ...equipmentForm, description: e.target.value })
                        }
                        placeholder="e.g. Excavator hire"
                      />
                    </label>
                    <label>
                      Qty
                      <input
                        required
                        value={equipmentForm.quantity}
                        onChange={(e) =>
                          setEquipmentForm({ ...equipmentForm, quantity: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      Unit
                      <input
                        value={equipmentForm.unit}
                        onChange={(e) =>
                          setEquipmentForm({ ...equipmentForm, unit: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      Unit price (USD)
                      <input
                        required
                        value={equipmentForm.unitPrice}
                        onChange={(e) =>
                          setEquipmentForm({ ...equipmentForm, unitPrice: e.target.value })
                        }
                      />
                    </label>
                    <button className="btn secondary" type="submit" disabled={actionBusy}>
                      Add equipment hire
                    </button>
                  </form>

                  <form className="form" onSubmit={addItem} style={{ marginTop: '1rem' }}>
                    <h3>Add custom line (not in catalog)</h3>
                    <p className="muted" style={{ marginTop: 0 }}>
                      Qty is per structure and multiplies by{' '}
                      {selected.structures?.count > 1
                        ? `${selected.structures.count} ${selected.structures.label}`
                        : '1 structure'}
                      .
                    </p>
                    <label>
                      Description
                      <input
                        required
                        value={item.description}
                        onChange={(e) => setItem({ ...item, description: e.target.value })}
                      />
                    </label>
                    <label>
                      Stage
                      <select
                        value={item.projectStageId}
                        onChange={(e) => setItem({ ...item, projectStageId: e.target.value })}
                      >
                        <option value="">None</option>
                        {selected.project?.stages?.map((s: any) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="grid grid-3">
                      <label>
                        Qty
                        <input
                          value={item.quantity}
                          onChange={(e) => setItem({ ...item, quantity: e.target.value })}
                        />
                      </label>
                      <label>
                        Unit
                        <input
                          value={item.unit}
                          onChange={(e) => setItem({ ...item, unit: e.target.value })}
                        />
                      </label>
                      <label>
                        Unit price
                        <input
                          required
                          value={item.unitPrice}
                          onChange={(e) => setItem({ ...item, unitPrice: e.target.value })}
                        />
                      </label>
                    </div>
                    <button className="btn" type="submit">
                      Add item
                    </button>
                  </form>

                  <div className="form" style={{ marginTop: '1rem' }}>
                    <h3>Price optimize (supplier compare)</h3>
                    <label>
                      Item name
                      <input value={optItem} onChange={(e) => setOptItem(e.target.value)} />
                    </label>
                    <button className="btn secondary" type="button" onClick={optimize}>
                      Compare suppliers
                    </button>
                    {options.length > 0 && (
                      <div className="table-wrap" style={{ marginTop: 8 }}>
                        <table>
                          <thead>
                            <tr>
                              <th>Supplier</th>
                              <th>Landed</th>
                              <th></th>
                            </tr>
                          </thead>
                          <tbody>
                            {options.map((o) => (
                              <tr key={`${o.supplierId}-${o.itemName}`}>
                                <td>{o.supplierName}</td>
                                <td>{money(o.unitPriceCents)}</td>
                                <td>
                                  <button
                                    type="button"
                                    className="btn secondary"
                                    onClick={() => applyOptimized(o)}
                                  >
                                    Use
                                  </button>
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
            </>
          ) : (
            <p className="muted">Select a quotation, or start one above.</p>
          )}
        </div>
      </div>
      </>
      )}
    </AppShell>
  );
}

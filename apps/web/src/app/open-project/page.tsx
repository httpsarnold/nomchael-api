'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { BusyOverlay, LoadingState, SavePulse } from '@/components/LoadingState';
import { PropertyDetailsFields } from '@/components/PropertyDetailsFields';
import { QuotationStatement } from '@/components/QuotationStatement';
import { api, downloadPdf, getUser, money } from '@/lib/api';
import {
  PROPERTY_TYPES,
  defaultsForPropertyType,
  propertyPayloadFromForm,
  type PropertyFormValues,
} from '@/lib/propertyDetails';
import { suggestedStagesForPropertyType } from '@/lib/propertyStages';

const STAGES = [
  {
    id: 1,
    title: 'Client & site',
    blurb: 'Register a closed shell. File is not open yet.',
  },
  {
    id: 2,
    title: 'Site visit',
    blurb: 'Schedule and take the visit fee before quoting.',
  },
  {
    id: 3,
    title: 'Build quotation',
    blurb: 'Materials, labour and equipment hire.',
  },
  {
    id: 4,
    title: 'Send to client',
    blurb: 'Share the quotation and wait for their reply.',
  },
  {
    id: 5,
    title: 'Client agrees',
    blurb: 'Record agreement and send to the Managing Director.',
  },
  {
    id: 6,
    title: 'Open the file',
    blurb: 'MD approves. Project becomes ACTIVE and work can start.',
  },
] as const;

function toLocalDateTimeInput(value?: string | null) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalDateTimeInput(value: string) {
  if (!value) return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

function formatVisitWhen(value?: string | null) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function stageFromQuote(quote: any | null, hasShell: boolean, visitPaid: boolean): number {
  if (!hasShell) return 1;
  if (!visitPaid || !quote) return 2;
  if (quote.status === 'DRAFT') return 3;
  if (quote.status === 'SENT') return 4;
  if (quote.status === 'PENDING_MD_APPROVAL') return 5;
  if (quote.status === 'ACCEPTED') return 6;
  if (quote.status === 'REJECTED') return 3;
  return 3;
}

export default function OpenProjectWizardPage() {
  const router = useRouter();
  const user = getUser();
  const canMdApprove =
    user?.role === 'MANAGING_DIRECTOR' || user?.role === 'SUPER_ADMIN';

  const [clients, setClients] = useState<any[]>([]);
  const [catalog, setCatalog] = useState<any[]>([]);
  const [quote, setQuote] = useState<any>(null);
  const [project, setProject] = useState<any>(null);
  const [siteVisit, setSiteVisit] = useState<any>(null);
  const [visitFee, setVisitFee] = useState('');
  const [visitWhen, setVisitWhen] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState('Working…');
  const [savedFlash, setSavedFlash] = useState('');
  const [loading, setLoading] = useState(true);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [manualStage, setManualStage] = useState<number | null>(null);
  const [catalogFilter, setCatalogFilter] = useState('');
  const [catalogPick, setCatalogPick] = useState<
    Record<string, { on: boolean; qty: string; price: string }>
  >({});
  const [rejectReason, setRejectReason] = useState('');
  const [equipmentForm, setEquipmentForm] = useState({
    description: '',
    quantity: '1',
    unit: 'days',
    unitPrice: '',
  });
  const [shellForm, setShellForm] = useState<
    PropertyFormValues & { clientId: string; name: string; address: string; companyStandCount: string }
  >({
    ...(defaultsForPropertyType('SINGLE_HOME') as PropertyFormValues),
    clientId: '',
    name: '',
    address: '',
    propertyType: 'SINGLE_HOME',
    companyStandCount: '1',
    propertyNotes: '',
  });

  const [labourForm, setLabourForm] = useState({ stageId: '', amount: '' });
  const [removingLineId, setRemovingLineId] = useState<string | null>(null);
  const statementRef = useRef<HTMLDivElement | null>(null);

  const selectedClient = clients.find((c) => c.id === shellForm.clientId);
  const isCompany = selectedClient?.type === 'COMPANY';
  const needsUnitCount = true; // All property types carry a homes/units multiplier for quotations

  const visitPaid =
    siteVisit?.status === 'PAID' || siteVisit?.status === 'COMPLETED';
  const derivedStage = stageFromQuote(quote, Boolean(project), visitPaid);
  const stage = manualStage ?? derivedStage;

  async function refreshQuote(id: string) {
    const q = await api<any>(`/quotations/${id}`);
    setQuote(q);
    setProject(q.project || null);
    if (q.projectId) {
      const visits = await api<any[]>(`/site-visits?projectId=${q.projectId}`);
      const paid = (visits || []).find(
        (v) => v.status === 'PAID' || v.status === 'COMPLETED',
      );
      setSiteVisit(paid || visits?.[0] || null);
    }
    return q;
  }

  async function loadVisitForProject(projectId: string) {
    const visits = await api<any[]>(`/site-visits?projectId=${projectId}`);
    const paid = (visits || []).find(
      (v) => v.status === 'PAID' || v.status === 'COMPLETED',
    );
    const visit = paid || visits?.[0] || null;
    setSiteVisit(visit);
    if (visit && Number(visit.feeCents) > 0) {
      setVisitFee(String(Number(visit.feeCents) / 100));
    } else if (visit && Number(visit.feeCents) === 0) {
      setVisitFee('');
    }
    if (visit?.scheduledAt) {
      setVisitWhen(toLocalDateTimeInput(visit.scheduledAt));
    }
    return visit;
  }

  useEffect(() => {
    setLoading(true);
    const quoteId =
      typeof window !== 'undefined'
        ? new URLSearchParams(window.location.search).get('quoteId')
        : null;
    const projectId =
      typeof window !== 'undefined'
        ? new URLSearchParams(window.location.search).get('projectId')
        : null;

    Promise.all([
      api('/clients').then((c) => setClients(c as any[])),
      quoteId
        ? refreshQuote(quoteId)
        : projectId
          ? api(`/projects/${projectId}`).then(async (p: any) => {
              setProject(p);
              await loadVisitForProject(p.id);
            })
          : Promise.resolve(null),
    ])
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (stage !== 3 || catalog.length) return;
    setCatalogLoading(true);
    api('/catalog')
      .then((cat) => setCatalog(cat as any[]))
      .catch((e) => setError(e.message))
      .finally(() => setCatalogLoading(false));
  }, [stage, catalog.length]);

  const filteredCatalog = useMemo(() => {
    const f = catalogFilter.trim().toLowerCase();
    if (!f) return catalog;
    return catalog.filter(
      (c) =>
        c.name.toLowerCase().includes(f) ||
        (c.category || '').toLowerCase().includes(f),
    );
  }, [catalog, catalogFilter]);

  async function startShell(e: FormEvent) {
    e.preventDefault();
    setError('');
    setInfo('');
    setBusy(true);
    try {
      if (!shellForm.clientId || !shellForm.name.trim()) {
        setError('Client and site name are required.');
        setBusy(false);
        return;
      }

      const property = propertyPayloadFromForm(shellForm);
      let projectId = '';
      let infoMsg = '';

      if (isCompany) {
        const standCount = Math.max(1, Number(shellForm.companyStandCount) || 1);
        if (standCount < 1) {
          setError('Enter how many stands / units we are doing for this company.');
          setBusy(false);
          return;
        }
        const pkg = await api<any>('/stand-packages', {
          method: 'POST',
          body: JSON.stringify({
            clientId: shellForm.clientId,
            name: shellForm.name.trim(),
            standCount,
            ...property,
            unitCount: 1,
            address: shellForm.address || undefined,
            stageTemplateNames: suggestedStagesForPropertyType(shellForm.propertyType),
          }),
        });
        projectId = pkg.projects?.[0]?.id;
        if (!projectId) throw new Error('Stand package created but no stand project returned.');
        infoMsg = `Registered company package with ${standCount} stand${standCount === 1 ? '' : 's'}. Next: pay for the site visit before quoting.`;
      } else {
        if (needsUnitCount && Number(shellForm.unitCount || 0) < 1) {
          setError('Enter how many homes / units are being built (quotation multiplies by this).');
          setBusy(false);
          return;
        }
        const created = await api<any>('/projects', {
          method: 'POST',
          body: JSON.stringify({
            name: shellForm.name.trim(),
            clientId: shellForm.clientId,
            address: shellForm.address || undefined,
            ...property,
            stageTemplateNames: suggestedStagesForPropertyType(shellForm.propertyType),
          }),
        });
        projectId = created.id;
        const units = Number(created.unitCount || property.unitCount || 1);
        infoMsg =
          units > 1
            ? `Registered ${created.code} with ${units} homes/units. Quotation will multiply by ${units}. Next: pay for the site visit before quoting.`
            : `Registered ${created.code}. Next: pay for the site visit before quoting.`;
      }

      setProject(await api(`/projects/${projectId}`));
      const visit = await api<any>('/site-visits', {
        method: 'POST',
        body: JSON.stringify({
          clientId: shellForm.clientId,
          projectId,
          address: shellForm.address || undefined,
          // Fee is set by the company when taking payment (varies per visit).
          feeCents: 0,
          scheduledAt: fromLocalDateTimeInput(visitWhen),
        }),
      });
      setSiteVisit(visit);
      setVisitFee('');
      if (visit.scheduledAt) setVisitWhen(toLocalDateTimeInput(visit.scheduledAt));
      setManualStage(2);
      setInfo(
        `${infoMsg} Set the visit date and time (shows on the programme Gantt), enter the fee, then take payment.`,
      );
      router.replace(`/open-project?projectId=${projectId}`, { scroll: false });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function paySiteVisit() {
    if (!siteVisit || !project) return;
    const feeDollars = Number(visitFee);
    if (!Number.isFinite(feeDollars) || feeDollars <= 0) {
      setError('Enter the site visit fee for this job. You set the amount (it varies by visit).');
      return;
    }
    setBusyLabel('Taking site visit fee…');
    setBusy(true);
    setError('');
    try {
      await api(`/site-visits/${siteVisit.id}/pay`, {
        method: 'POST',
        body: JSON.stringify({
          projectId: project.id,
          method: 'CASH',
          feeCents: Math.round(feeDollars * 100),
        }),
      });
      await loadVisitForProject(project.id);
      setInfo('Site visit fee paid. You can start the quotation.');
      flashSaved('Site visit paid');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function startQuotationAfterVisit() {
    if (!project) return;
    setBusyLabel('Starting quotation…');
    setBusy(true);
    setError('');
    try {
      const q = await api<any>('/quotations', {
        method: 'POST',
        body: JSON.stringify({ projectId: project.id }),
      });
      await refreshQuote(q.id);
      setManualStage(3);
      setInfo('Quotation started. Add materials, labour and equipment hire.');
      router.replace(`/open-project?quoteId=${q.id}`, { scroll: false });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function addEquipment(e: FormEvent) {
    e.preventDefault();
    if (!quote) return;
    setBusyLabel('Saving equipment hire…');
    setBusy(true);
    setError('');
    try {
      const updated = await api<any>(`/quotations/${quote.id}/items`, {
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
      setQuote(updated);
      setProject(updated.project || null);
      setEquipmentForm({ description: '', quantity: '1', unit: 'days', unitPrice: '' });
      flashSaved('Equipment hire saved on quotation');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function flashSaved(message = 'Saved to database') {
    setSavedFlash(message);
    window.setTimeout(() => setSavedFlash(''), 2400);
  }

  async function importCatalog() {
    if (!quote) return;
    setError('');
    const items = Object.entries(catalogPick)
      .filter(([, v]) => v.on)
      .map(([catalogItemId, v]) => ({
        catalogItemId,
        quantity: Number(v.qty) || 1,
        unitPriceCents: v.price ? Math.round(Number(v.price) * 100) : undefined,
      }));
    if (!items.length) {
      setError('Select at least one catalog material.');
      return;
    }
    setBusyLabel('Saving materials to database…');
    setBusy(true);
    try {
      const updated = await api<any>(`/quotations/${quote.id}/import-catalog`, {
        method: 'POST',
        body: JSON.stringify({ items, multiplyByStructures: true }),
      });
      setQuote(updated);
      setProject(updated.project || null);
      setCatalogPick({});
      const count = updated.structures?.count || 1;
      setInfo(
        count > 1
          ? `Added ${items.length} material line(s). Quantities × ${count} ${updated.structures.label}. Saved on the quotation (stock waits for client payment).`
          : `Added ${items.length} material line(s). Saved on the quotation (stock waits for client payment).`,
      );
      flashSaved('Materials saved on quotation');
      statementRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function removeLine(lineId: string) {
    if (!quote) return;
    setError('');
    setRemovingLineId(lineId);
    try {
      const updated = await api<any>(`/quotations/${quote.id}/items/${lineId}`, {
        method: 'DELETE',
      });
      setQuote(updated);
      setProject(updated.project || null);
      setInfo('Line removed and database updated.');
      flashSaved('Line deleted from database');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRemovingLineId(null);
    }
  }

  async function saveLabour(e: FormEvent) {
    e.preventDefault();
    if (!quote?.projectId || !labourForm.stageId || !labourForm.amount) return;
    setError('');
    setBusyLabel('Saving labour to database…');
    setBusy(true);
    try {
      const result = await api<any>(
        `/quotations/projects/${quote.projectId}/stages/${labourForm.stageId}/labour`,
        {
          method: 'POST',
          body: JSON.stringify({
            labourCents: Math.round(Number(labourForm.amount) * 100),
            multiplyByStructures: true,
            quotationId: quote.id,
          }),
        },
      );
      if (result.quotation) {
        setQuote(result.quotation);
        setProject(result.quotation.project || null);
      } else {
        await refreshQuote(quote.id);
      }
      setLabourForm({ stageId: '', amount: '' });
      const count = result.structures?.count || quote.structures?.count || 1;
      setInfo(
        count > 1
          ? `Labour saved to database and multiplied × ${count}.`
          : 'Labour saved to database.',
      );
      flashSaved('Labour saved to database');
      statementRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function sendToClient() {
    if (!quote) return;
    setBusyLabel('Sending quotation…');
    setBusy(true);
    setError('');
    try {
      await api(`/quotations/${quote.id}/send-whatsapp`, { method: 'POST' });
      await refreshQuote(quote.id);
      setManualStage(4);
      setInfo('Quotation sent. When the client agrees, move to the next stage.');
      flashSaved('Send recorded');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function clientAgreed() {
    if (!quote) return;
    setBusyLabel('Recording agreement…');
    setBusy(true);
    setError('');
    try {
      await api(`/quotations/${quote.id}/accept`, { method: 'POST' });
      window.dispatchEvent(new Event('nomchael:notifications-refresh'));
      await refreshQuote(quote.id);
      setManualStage(5);
      setInfo('Client agreement recorded. Waiting for MD to open the file.');
      flashSaved('Agreement saved');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function openFile(approve: boolean) {
    if (!quote) return;
    setBusyLabel(approve ? 'Opening project file…' : 'Saving rejection…');
    setBusy(true);
    setError('');
    try {
      const result = await api<any>(`/quotations/${quote.id}/md-decide`, {
        method: 'POST',
        body: JSON.stringify({
          approve,
          rejectionReason: approve ? undefined : rejectReason || undefined,
        }),
      });
      window.dispatchEvent(new Event('nomchael:notifications-refresh'));
      if (approve) {
        const projectId = result.projectId || result.project?.id || quote.projectId;
        router.push(`/projects/${projectId}?opened=1`);
        return;
      }
      setRejectReason('');
      await refreshQuote(quote.id);
      setManualStage(3);
      setInfo('MD rejected the quotation. Rebuild or revise, then send again.');
      flashSaved('Rejection saved');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function goStage(n: number) {
    // Only allow stages already reached (or stage 1). No skipping past unpaid visit / missing quote.
    if (n === 1 || (project && n <= derivedStage)) setManualStage(n);
  }

  return (
    <AppShell>
      {busy && <BusyOverlay label={busyLabel} />}
      <h1>Open a project</h1>
      <p className="muted">
        A file cannot open without a paid site visit and a quotation. Order: client & site → site
        visit fee → build quotation → send → client agrees → MD opens the file.
      </p>
      {error && <p className="error">{error}</p>}
      {info && (
        <div className="info-banner" style={{ borderColor: '#16a34a' }}>
          <span>✓</span>
          <span>{info}</span>
        </div>
      )}
      {loading && <LoadingState label="Loading wizard…" />}

      {!loading && (
      <>
      <ol className="open-stages">
        {STAGES.map((s) => {
          const state =
            s.id < derivedStage ? 'done' : s.id === stage ? 'current' : 'todo';
          const reachable = s.id === 1 || (Boolean(project) && s.id <= derivedStage);
          return (
            <li key={s.id} className={`open-stage ${state}`}>
              <button
                type="button"
                className="open-stage-btn"
                disabled={!reachable}
                title={
                  reachable
                    ? undefined
                    : 'Complete the earlier stages first (paid site visit and quotation required before opening)'
                }
                onClick={() => goStage(s.id)}
              >                <span className="open-stage-num">{s.id}</span>
                <span className="open-stage-copy">
                  <strong>{s.title}</strong>
                  <span>{s.blurb}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      {(project || quote) && (
        <div className="panel" style={{ marginTop: '1rem' }}>
          <strong>
            {project?.code || quote?.project?.code} {project?.name || quote?.project?.name}
          </strong>
          <span className="muted" style={{ marginLeft: 8 }}>
            Project: {project?.status || quote?.project?.status || '—'} · Quote:{' '}
            {quote?.status || '—'}
            {quote ? ` · ${money(quote.totalCents)}` : ''}
          </span>
        </div>
      )}

      {stage === 1 && (
        <div className="panel" style={{ marginTop: '1rem' }}>
          <h3>Stage 1: Client &amp; site</h3>
          <p className="muted">
            This only registers a DRAFT shell for quoting. It does not open the project file. Set how
            many homes (or units) are being built. Line items and labour on the quotation multiply by
            that number. For a company, set how many stands we are doing.
          </p>
          <form className="form" onSubmit={startShell}>
            <label>
              Client
              <select
                required
                value={shellForm.clientId}
                onChange={(e) => setShellForm({ ...shellForm, clientId: e.target.value })}
              >
                <option value="">Select…</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.type === 'COMPANY' ? ' · Company' : ''}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Site / project name
              <input
                required
                value={shellForm.name}
                onChange={(e) => setShellForm({ ...shellForm, name: e.target.value })}
              />
            </label>
            <label>
              Property type
              <select
                value={shellForm.propertyType}
                onChange={(e) => {
                  const propertyType = e.target.value;
                  setShellForm((f) => ({
                    ...f,
                    propertyType,
                    ...defaultsForPropertyType(propertyType),
                    propertyNotes: f.propertyNotes,
                    companyStandCount: f.companyStandCount,
                  }));
                }}
              >
                {PROPERTY_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>

            {isCompany && (
              <label>
                How many stands / units are we doing for this company?
                <input
                  type="number"
                  min={1}
                  max={500}
                  required
                  value={shellForm.companyStandCount}
                  onChange={(e) =>
                    setShellForm({ ...shellForm, companyStandCount: e.target.value })
                  }
                />
              </label>
            )}

            <PropertyDetailsFields
              form={shellForm}
              onChange={(patch) => setShellForm((f) => ({ ...f, ...patch }))}
              showNotes={!isCompany}
            />

            {needsUnitCount && !isCompany && (
              <p className="muted" style={{ marginTop: 0 }}>
                Quotation totals multiply by the number of homes / units above (materials and labour
                per home × count).
              </p>
            )}

            <label>
              Address (optional)
              <input
                value={shellForm.address}
                onChange={(e) => setShellForm({ ...shellForm, address: e.target.value })}
              />
            </label>
            <button className="btn" type="submit" disabled={busy}>
              {busy ? 'Registering…' : 'Register site'}
            </button>
          </form>
        </div>
      )}

      {stage === 2 && project && (
        <div className="panel" style={{ marginTop: '1rem' }}>
          <h3>Stage 2: Site visit</h3>
          <p className="muted">
            Schedule the visit date and time (it appears on the programme Gantt). Your company sets
            the fee for each visit (amounts vary). Someone must pay before a quotation can start.
          </p>
          {!siteVisit ? (
            <>
              <label style={{ display: 'block', marginBottom: 12, maxWidth: 320 }}>
                Visit date and time
                <input
                  type="datetime-local"
                  required
                  value={visitWhen}
                  onChange={(e) => setVisitWhen(e.target.value)}
                />
              </label>
              <label style={{ display: 'block', marginBottom: 12, maxWidth: 280 }}>
                Visit fee for this job (USD)
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  required
                  value={visitFee}
                  placeholder="Enter amount"
                  onChange={(e) => setVisitFee(e.target.value)}
                />
              </label>
              <button
                className="btn"
                type="button"
                disabled={busy}
                onClick={async () => {
                  if (!visitWhen) {
                    setError('Set the site visit date and time so it can show on the programme Gantt.');
                    return;
                  }
                  const feeDollars = Number(visitFee);
                  if (!Number.isFinite(feeDollars) || feeDollars <= 0) {
                    setError('Enter the visit fee your company is charging for this site.');
                    return;
                  }
                  setBusy(true);
                  setError('');
                  try {
                    const visit = await api<any>('/site-visits', {
                      method: 'POST',
                      body: JSON.stringify({
                        clientId: project.clientId || shellForm.clientId,
                        projectId: project.id,
                        address: project.address || shellForm.address || undefined,
                        feeCents: Math.round(feeDollars * 100),
                        scheduledAt: fromLocalDateTimeInput(visitWhen),
                      }),
                    });
                    setSiteVisit(visit);
                  } catch (err) {
                    setError((err as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Schedule site visit
              </button>
            </>
          ) : (
            <>
              <p>
                <strong>{siteVisit.code}</strong>
                {formatVisitWhen(siteVisit.scheduledAt) ? (
                  <> · {formatVisitWhen(siteVisit.scheduledAt)}</>
                ) : (
                  <> · Date/time not set</>
                )}
                {Number(siteVisit.feeCents) > 0 ? (
                  <> · Fee {money(siteVisit.feeCents)}</>
                ) : (
                  <> · Fee not set yet</>
                )}{' '}
                · <span className="badge">{siteVisit.status}</span>
              </p>
              {(siteVisit.status === 'SCHEDULED' || siteVisit.status === 'PAID') && (
                <label style={{ display: 'block', marginBottom: 12, maxWidth: 320 }}>
                  Visit date and time
                  <input
                    type="datetime-local"
                    value={visitWhen}
                    onChange={(e) => setVisitWhen(e.target.value)}
                  />
                </label>
              )}
              {(siteVisit.status === 'SCHEDULED' || siteVisit.status === 'PAID') && (
                <button
                  className="btn secondary"
                  type="button"
                  style={{ marginRight: 8, marginBottom: 12 }}
                  disabled={busy || !visitWhen}
                  onClick={async () => {
                    if (!visitWhen) {
                      setError('Set the site visit date and time.');
                      return;
                    }
                    setBusy(true);
                    setError('');
                    try {
                      const updated = await api<any>(`/site-visits/${siteVisit.id}/schedule`, {
                        method: 'PATCH',
                        body: JSON.stringify({
                          scheduledAt: fromLocalDateTimeInput(visitWhen),
                        }),
                      });
                      setSiteVisit(updated);
                      setInfo('Site visit date/time saved. It shows on Project timeline Gantt.');
                      flashSaved('Visit schedule saved');
                    } catch (err) {
                      setError((err as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Save visit time
                </button>
              )}
              {(siteVisit.status === 'SCHEDULED') && (
                <>
                  <label style={{ display: 'block', marginBottom: 12, maxWidth: 280 }}>
                    Fee to collect (USD)
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      required
                      value={visitFee}
                      placeholder="Enter amount for this visit"
                      onChange={(e) => setVisitFee(e.target.value)}
                    />
                  </label>
                  <button className="btn" type="button" disabled={busy} onClick={paySiteVisit}>
                    Take site visit fee
                  </button>
                </>
              )}
              {visitPaid && !quote && (
                <button
                  className="btn"
                  type="button"
                  style={{ marginLeft: 8 }}
                  disabled={busy}
                  onClick={startQuotationAfterVisit}
                >
                  Start quotation
                </button>
              )}
              {visitPaid && quote && (
                <button className="btn" type="button" onClick={() => setManualStage(3)}>
                  Continue to quotation
                </button>
              )}
            </>
          )}
        </div>
      )}

      {stage === 3 && quote && (
        <div style={{ marginTop: '1rem' }}>
          <h3>Stage 3: Build quotation</h3>
          <p className="muted">
            Each material or labour add is saved on the quotation immediately. Stock in Stores only
            appears after the client pays. MD open does not invent inventory by itself.
            {quote.structures?.count > 1
              ? ` Quantities multiply × ${quote.structures.count} ${quote.structures.label}.`
              : ''}
          </p>

          <div className="quote-build-grid">
            <div className="panel">
              <h3 style={{ marginTop: 0 }}>1. Materials</h3>
              <label>
                Filter catalog
                <input
                  value={catalogFilter}
                  onChange={(e) => setCatalogFilter(e.target.value)}
                  placeholder="cement, brick…"
                />
              </label>
              <div className="table-wrap" style={{ maxHeight: 280, overflow: 'auto', marginTop: 8 }}>
                {catalogLoading ? (
                  <LoadingState compact label="Loading catalog…" />
                ) : (
                <table>
                  <thead>
                    <tr>
                      <th></th>
                      <th>Material</th>
                      <th>Default</th>
                      <th>Qty/{quote.structures?.label === 'stands' ? 'stand' : 'unit'}</th>
                      <th>Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCatalog.map((c) => {
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
                              {c.unit}
                            </div>
                          </td>
                          <td>{money(c.defaultUnitPriceCents)}</td>
                          <td>
                            <input
                              style={{ width: 58 }}
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
                              style={{ width: 72 }}
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
              <button
                className="btn"
                type="button"
                style={{ marginTop: 12 }}
                disabled={busy || catalogLoading}
                onClick={importCatalog}
              >
                {busy ? 'Updating statement…' : 'Import selected into statement'}
              </button>

              <h3 style={{ marginTop: '1.5rem' }}>2. Labour by stage</h3>
              <p className="muted" style={{ marginTop: 0 }}>
                Enter labour amount per structure. It multiplies by units/stands and appears on the
                statement total.
              </p>
              <form className="form" onSubmit={saveLabour}>
                <label>
                  Stage
                  <select
                    required
                    value={labourForm.stageId}
                    onChange={(e) => setLabourForm({ ...labourForm, stageId: e.target.value })}
                  >
                    <option value="">Select stage…</option>
                    {(quote.project?.stages || []).map((s: any) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                        {Number(s.labourCents) > 0
                          ? ` (current ${money(s.labourCents)})`
                          : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Labour amount per {quote.structures?.label === 'stands' ? 'stand' : 'unit'} (USD)
                  <input
                    required
                    value={labourForm.amount}
                    onChange={(e) => setLabourForm({ ...labourForm, amount: e.target.value })}
                    placeholder="e.g. 800"
                  />
                </label>
                <button className="btn secondary" type="submit" disabled={busy}>
                  {busy ? 'Saving labour…' : 'Add labour to statement'}
                </button>
              </form>

              <h3 style={{ marginTop: '1.5rem' }}>3. Equipment hire</h3>
              <p className="muted" style={{ marginTop: 0 }}>
                Add hired plant or tools (excavator, scaffolding, mixer, etc.) as quotation lines.
              </p>
              <form className="form" onSubmit={addEquipment}>
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
                    onChange={(e) => setEquipmentForm({ ...equipmentForm, unit: e.target.value })}
                    placeholder="days"
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
                <button className="btn secondary" type="submit" disabled={busy}>
                  Add equipment hire
                </button>
              </form>

              <div className="row-actions" style={{ marginTop: 16 }}>
                <button
                  className="btn"
                  type="button"
                  disabled={busy || !quote.lineItems?.length}
                  onClick={() => setManualStage(4)}
                >
                  Next: send to client
                </button>
              </div>
            </div>

            <div ref={statementRef} className="quote-statement-sticky">
              <div className="row-actions" style={{ marginBottom: 8 }}>
                <strong>Live official statement</strong>
                <button
                  type="button"
                  className="btn secondary"
                  onClick={() =>
                    downloadPdf(
                      `/quotations/${quote.id}/pdf`,
                      `quotation-${quote.project?.code || project?.code || 'quote'}-v${quote.version}.pdf`,
                    ).catch((e) => setError(e.message))
                  }
                >
                  Download PDF
                </button>
              </div>
              {savedFlash && <SavePulse label={savedFlash} />}
              <QuotationStatement
                quote={quote}
                editable
                onRemoveLine={removeLine}
                removingLineId={removingLineId}
              />
            </div>
          </div>
        </div>
      )}

      {stage === 4 && quote && (
        <div className="panel" style={{ marginTop: '1rem' }}>
          <h3>Stage 4: Send to client</h3>
          <p className="muted">
            Review the official statement, then send it to the client.
          </p>
          <QuotationStatement quote={quote} />
          <div className="row-actions" style={{ marginTop: 12 }}>
            {(quote.status === 'DRAFT' || quote.status === 'SENT') && (
              <button className="btn" type="button" disabled={busy} onClick={sendToClient}>
                {busy ? 'Sending…' : 'Send to client (WhatsApp)'}
              </button>
            )}
            {quote.status === 'SENT' && (
              <button className="btn" type="button" onClick={() => setManualStage(5)}>
                Next: client agrees
              </button>
            )}
            <button className="btn secondary" type="button" onClick={() => setManualStage(3)}>
              Back to quotation
            </button>
            <button
              type="button"
              className="btn secondary"
              onClick={() =>
                downloadPdf(
                  `/quotations/${quote.id}/pdf`,
                  `quotation-${quote.project?.code || project?.code || 'quote'}-v${quote.version}.pdf`,
                ).catch((e) => setError(e.message))
              }
            >
              Download PDF statement
            </button>
          </div>
        </div>
      )}

      {stage === 5 && quote && (
        <div className="panel" style={{ marginTop: '1rem' }}>
          <h3>Stage 5: Client agrees</h3>
          <p className="muted">
            Only mark this when the client has accepted this official quotation. That queues MD to
            open the file.
          </p>
          <QuotationStatement quote={quote} />
          <div className="row-actions" style={{ marginTop: 12 }}>
            {(quote.status === 'SENT' || quote.status === 'DRAFT') && (
              <button className="btn warn" type="button" disabled={busy} onClick={clientAgreed}>
                Client agreed → send to MD
              </button>
            )}
            {quote.status === 'PENDING_MD_APPROVAL' && (
              <button className="btn" type="button" onClick={() => setManualStage(6)}>
                Next: open the file
              </button>
            )}
          </div>
        </div>
      )}

      {stage === 6 && quote && (
        <div className="panel" style={{ marginTop: '1rem' }}>
          <h3>Stage 6: Open the file</h3>
          <QuotationStatement quote={quote} />
          {quote.status === 'PENDING_MD_APPROVAL' ? (
            canMdApprove ? (
              <>
                <p className="muted">
                  MD approval opens the project (ACTIVE). Stock still waits for client payment.
                  After payment, buy materials on Stores &amp; Stock.
                </p>
                <label>
                  Rejection reason (if rejecting)
                  <input
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                  />
                </label>
                <div className="row-actions" style={{ marginTop: 12 }}>
                  <button className="btn" type="button" disabled={busy} onClick={() => openFile(true)}>
                    MD approve &amp; open file
                  </button>
                  <button
                    className="btn secondary"
                    type="button"
                    disabled={busy}
                    onClick={() => openFile(false)}
                  >
                    MD reject
                  </button>
                </div>
              </>
            ) : (
              <p className="muted">
                Waiting for Managing Director or Super Admin to open the file. You will get a
                notification when it is ready.
              </p>
            )
          ) : quote.status === 'ACCEPTED' ? (
            <div className="row-actions">
              <button
                className="btn"
                type="button"
                onClick={() => router.push(`/projects/${quote.projectId}?opened=1`)}
              >
                Go to open project
              </button>
            </div>
          ) : (
            <p className="muted">Complete the earlier stages first. Current quote: {quote.status}.</p>
          )}
        </div>
      )}
      </>
      )}
    </AppShell>
  );
}

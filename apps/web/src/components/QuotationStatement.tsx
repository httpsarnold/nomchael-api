'use client';

import { money } from '@/lib/api';
import { storeysLabel } from '@/lib/propertyDetails';

type LineItem = {
  id: string;
  type?: string;
  description: string;
  quantity: number | string;
  unit: string;
  unitPriceCents: number;
  totalCents: number;
};

type QuotationStatementProps = {
  quote: {
    id: string;
    version: number;
    status: string;
    totalCents: number;
    createdAt?: string;
    sentAt?: string | null;
    lineItems?: LineItem[];
    structures?: {
      count: number;
      label: string;
      packageName?: string | null;
      packageCode?: string | null;
    };
    project?: {
      code: string;
      name: string;
      address?: string | null;
      locationNotes?: string | null;
      propertyType?: string | null;
      unitCount?: number;
      storeys?: number;
      client?: {
        name: string;
        phone?: string | null;
        whatsapp?: string | null;
        address?: string | null;
        type?: string;
      };
      stages?: { id?: string; name: string; labourCents: number }[];
    };
  };
  editable?: boolean;
  onRemoveLine?: (lineId: string) => void;
  removingLineId?: string | null;
};

function statusPhrase(status: string) {
  if (status === 'DRAFT') return 'Draft quotation';
  if (status === 'SENT') return 'Sent to client';
  if (status === 'PENDING_MD_APPROVAL') return 'Client agreed · awaiting MD';
  if (status === 'ACCEPTED') return 'Accepted · file open';
  if (status === 'REJECTED') return 'Rejected';
  return status.replace(/_/g, ' ');
}

export function QuotationStatement({
  quote,
  editable = false,
  onRemoveLine,
  removingLineId = null,
}: QuotationStatementProps) {
  const project = quote.project;
  const client = project?.client;
  const lines = quote.lineItems || [];
  const labourLines = (project?.stages || []).filter((s) => Number(s.labourCents) > 0);
  const materialsTotal = lines.reduce((s, li) => s + Number(li.totalCents || 0), 0);
  const labourTotal = labourLines.reduce((s, st) => s + Number(st.labourCents || 0), 0);
  const issued = quote.sentAt || quote.createdAt;
  const structureNote =
    quote.structures && quote.structures.count > 1
      ? `Quantities cover ${quote.structures.count} ${quote.structures.label}${
          quote.structures.packageCode
            ? ` (${quote.structures.packageCode} ${quote.structures.packageName || ''})`
            : ''
        }.`
      : null;
  const showActions = editable && quote.status === 'DRAFT' && !!onRemoveLine;

  return (
    <article className="quote-statement" aria-label="Official quotation statement">
      <header className="quote-statement-head">
        <div>
          <p className="quote-statement-kicker">Official quotation</p>
          <h2>Nomchael Construction</h2>
          <p className="muted">Zimbabwe · Construction ERP quotation statement</p>
        </div>
        <div className="quote-statement-meta">
          <div>
            <span>Document</span>
            <strong>
              QT-{project?.code || '—'}-v{quote.version}
            </strong>
          </div>
          <div>
            <span>Status</span>
            <strong>{statusPhrase(quote.status)}</strong>
          </div>
          <div>
            <span>Date</span>
            <strong>
              {issued ? new Date(issued).toLocaleDateString() : new Date().toLocaleDateString()}
            </strong>
          </div>
        </div>
      </header>

      <div className="quote-statement-parties">
        <section>
          <h3>Prepared for</h3>
          <p>
            <strong>{client?.name || 'Client'}</strong>
          </p>
          <p className="muted">{client?.type === 'COMPANY' ? 'Company client' : 'Individual client'}</p>
          <p className="muted">{client?.whatsapp || client?.phone || 'No phone on file'}</p>
          <p className="muted">{client?.address || 'No client address on file'}</p>
        </section>
        <section>
          <h3>Project / site</h3>
          <p>
            <strong>
              {project?.code} {project?.name}
            </strong>
          </p>
          <p className="muted">
            {(project?.propertyType || 'SINGLE_HOME').replace(/_/g, ' ')}
            {project?.unitCount && project.unitCount > 1 ? ` · ${project.unitCount} units` : ''}
            {project?.storeys != null ? ` · ${storeysLabel(project.storeys)}` : ''}
          </p>
          <p className="muted">
            {project?.address || project?.locationNotes || 'Site address to be confirmed'}
          </p>
          {structureNote && <p className="quote-statement-note">{structureNote}</p>}
        </section>
      </div>

      <div className="quote-statement-table-wrap">
        <table className="quote-statement-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Description</th>
              <th>Qty</th>
              <th>Unit price</th>
              <th>Amount</th>
              {showActions && <th></th>}
            </tr>
          </thead>
          <tbody>
            {lines.map((li, idx) => (
              <tr key={li.id}>
                <td>{idx + 1}</td>
                <td>
                  {li.type === 'EQUIPMENT' ? 'Hire: ' : ''}
                  {li.description}
                  {li.type === 'EQUIPMENT' ? (
                    <div className="muted" style={{ fontSize: '0.75rem' }}>
                      Equipment hire
                    </div>
                  ) : null}
                </td>
                <td>
                  {li.quantity} {li.unit}
                </td>
                <td>{money(li.unitPriceCents)}</td>
                <td>{money(li.totalCents)}</td>
                {showActions && (
                  <td>
                    <button
                      type="button"
                      className="btn secondary"
                      style={{ padding: '0.25rem 0.55rem', fontSize: '0.78rem' }}
                      disabled={removingLineId === li.id}
                      onClick={() => onRemoveLine?.(li.id)}
                    >
                      {removingLineId === li.id ? 'Removing…' : 'Delete'}
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {!lines.length && (
              <tr>
                <td colSpan={showActions ? 6 : 5} className="muted">
                  Select materials on the left. Lines appear here as soon as you import them.
                </td>
              </tr>
            )}
            {labourLines.map((st) => (
              <tr key={`labour-${st.name}`}>
                <td></td>
                <td>Labour: {st.name}</td>
                <td>1 lot</td>
                <td>{money(st.labourCents)}</td>
                <td>{money(st.labourCents)}</td>
                {showActions && <td></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <footer className="quote-statement-foot">
        <div className="quote-statement-terms">
          <h3>Terms</h3>
          <ul>
            <li>This quotation is valid subject to Managing Director approval before work starts.</li>
            <li>Material prices may be adjusted if supplier market rates change before purchase.</li>
            <li>Acceptance by the client authorises Nomchael to open the project file.</li>
          </ul>
        </div>
        <div className="quote-statement-totals">
          <div>
            <span>Materials</span>
            <strong>{money(materialsTotal)}</strong>
          </div>
          <div>
            <span>Labour</span>
            <strong>{money(labourTotal)}</strong>
          </div>
          <div className="quote-statement-grand">
            <span>Total due</span>
            <strong>{money(quote.totalCents)}</strong>
          </div>
        </div>
      </footer>

      <div className="quote-statement-sign">
        <div>
          <span>Prepared by Nomchael Construction</span>
          <em>Authorised quotation statement</em>
        </div>
        <div>
          <span>Client acceptance</span>
          <em>Sign / WhatsApp confirm</em>
        </div>
      </div>
    </article>
  );
}

import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import PDFDocument from 'pdfkit';
import { PrismaService } from '../prisma/prisma.service';
import { serializeMoney } from '../common/money';

@Injectable()
export class ClientsService {
  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  /** Client IDs covered by this statement (self + child split accounts). */
  private async statementClientIds(clientId: string): Promise<string[]> {
    const children = await this.prisma.client.findMany({
      where: { parentClientId: clientId },
      select: { id: true },
    });
    return [clientId, ...children.map((c) => c.id)];
  }

  async getStatement(clientId: string, from?: string, to?: string) {
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      include: {
        parentClient: { select: { id: true, name: true } },
        childAccounts: { select: { id: true, name: true } },
      },
    });
    if (!client) throw new NotFoundException('Client not found');

    const clientIds = await this.statementClientIds(clientId);
    const fromDate = from ? new Date(from) : undefined;
    const toDate = to ? new Date(to) : undefined;
    if (toDate) toDate.setHours(23, 59, 59, 999);

    const paidAtFilter =
      fromDate || toDate
        ? {
            ...(fromDate ? { gte: fromDate } : {}),
            ...(toDate ? { lte: toDate } : {}),
          }
        : undefined;

    const projects = await this.prisma.project.findMany({
      where: { clientId: { in: clientIds } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        code: true,
        name: true,
        status: true,
        quotationTotalCents: true,
        amountPaidCents: true,
        clientId: true,
        standNumber: true,
      },
    });

    const payments = await this.prisma.payment.findMany({
      where: {
        deletedAt: null,
        project: { clientId: { in: clientIds } },
        ...(paidAtFilter ? { paidAt: paidAtFilter } : {}),
      },
      orderBy: { paidAt: 'desc' },
      include: {
        project: { select: { id: true, code: true, name: true } },
      },
      take: 500,
    });

    const quotations = await this.prisma.quotation.findMany({
      where: { project: { clientId: { in: clientIds } } },
      orderBy: [{ createdAt: 'desc' }],
      include: {
        project: { select: { id: true, code: true, name: true } },
      },
      take: 200,
    });

    const ledger = await this.prisma.clientLedgerEntry.findMany({
      where: {
        clientId: { in: clientIds },
        ...(fromDate || toDate
          ? {
              createdAt: {
                ...(fromDate ? { gte: fromDate } : {}),
                ...(toDate ? { lte: toDate } : {}),
              },
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    let quotedTotal = 0n;
    let paidTotal = 0n;
    for (const p of projects) {
      quotedTotal += p.quotationTotalCents;
      paidTotal += p.amountPaidCents;
    }
    const outstandingTotal = quotedTotal - paidTotal;
    const paymentsInPeriod = payments.reduce((s, p) => s + p.amountCents, 0n);

    const projectRows = projects.map((p) => ({
      ...p,
      outstandingCents: p.quotationTotalCents - p.amountPaidCents,
    }));

    return serializeMoney({
      client: {
        id: client.id,
        name: client.name,
        type: client.type,
        phone: client.phone,
        whatsapp: client.whatsapp,
        email: client.email,
        address: client.address,
        contactPerson: client.contactPerson,
        registrationNo: client.registrationNo,
        parentClient: client.parentClient,
        childAccounts: client.childAccounts,
      },
      period: {
        from: fromDate?.toISOString() ?? null,
        to: toDate?.toISOString() ?? null,
      },
      generatedAt: new Date().toISOString(),
      summary: {
        projectCount: projects.length,
        quotedTotalCents: quotedTotal,
        paidTotalCents: paidTotal,
        outstandingCents: outstandingTotal,
        paymentsInPeriodCents: paymentsInPeriod,
      },
      projects: projectRows,
      payments,
      quotations,
      ledger,
    });
  }

  async buildStatementPdfBuffer(
    clientId: string,
    from?: string,
    to?: string,
  ): Promise<{ buffer: Buffer; filename: string }> {
    // serializeMoney turns BigInt → number for PDF formatting
    const statement = (await this.getStatement(clientId, from, to)) as any;
    const company = this.config.get('COMPANY_NAME') || 'Nomchael Construction';
    const currency = this.config.get('CURRENCY') || 'USD';
    const moneyFmt = (cents: number) => `${currency} ${(Number(cents) / 100).toFixed(2)}`;
    const day = (d?: string | Date | null) => {
      if (!d) return '—';
      const s = typeof d === 'string' ? d : d.toISOString();
      return s.slice(0, 10);
    };

    const c = statement.client;
    const summary = statement.summary;
    const period = statement.period;
    const projects = statement.projects as any[];
    const payments = statement.payments as any[];
    const quotations = statement.quotations as any[];

    const safeName = String(c.name).replace(/[^\w.\-]+/g, '_').slice(0, 40);
    const buffer = await new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ margin: 48, size: 'A4' });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const left = doc.page.margins.left;
      const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      let y = 48;

      const ensure = (need = 40) => {
        if (y + need > 760) {
          doc.addPage();
          y = 48;
        }
      };
      const heading = (title: string) => {
        ensure(36);
        y += 8;
        doc.fontSize(12).fillColor('#0f172a').text(title, left, y);
        y += 16;
        doc.moveTo(left, y).lineTo(left + width, y).strokeColor('#e5e7eb').stroke();
        y += 10;
      };
      const row = (label: string, value: string) => {
        ensure(18);
        doc.fontSize(9).fillColor('#64748b').text(label, left, y, { width: 130 });
        doc.fillColor('#0f172a').text(value, left + 140, y, { width: width - 140 });
        y += 15;
      };

      doc.fontSize(18).fillColor('#0f172a').text(company, left, y);
      y += 22;
      doc.fontSize(10).fillColor('#64748b').text('CLIENT ACCOUNT STATEMENT', left, y);
      y += 18;
      doc.moveTo(left, y).lineTo(left + width, y).strokeColor('#e5e7eb').stroke();
      y += 14;

      heading('Client');
      row('Name', c.name);
      row('Type', c.type);
      if (c.contactPerson) row('Contact', c.contactPerson);
      if (c.registrationNo) row('Registration', c.registrationNo);
      row('Phone', c.whatsapp || c.phone || '—');
      if (c.email) row('Email', c.email);
      row('Address', c.address || '—');
      row(
        'Period',
        period.from || period.to
          ? `${day(period.from)} to ${day(period.to)}`
          : 'All activity',
      );

      heading('Account summary');
      row('Projects', String(summary.projectCount));
      row('Quoted total', moneyFmt(summary.quotedTotalCents));
      row('Paid total', moneyFmt(summary.paidTotalCents));
      row('Outstanding', moneyFmt(summary.outstandingCents));
      if (period.from || period.to) {
        row('Payments in period', moneyFmt(summary.paymentsInPeriodCents));
      }

      heading('Projects');
      if (!projects.length) {
        doc.fontSize(9).fillColor('#64748b').text('No projects for this client.', left, y);
        y += 14;
      } else {
        doc.fontSize(8).fillColor('#64748b');
        doc.text('Project', left, y, { width: 160 });
        doc.text('Quoted', left + 170, y, { width: 80 });
        doc.text('Paid', left + 260, y, { width: 80 });
        doc.text('Due', left + 350, y, { width: 80 });
        y += 12;
        doc.fontSize(9).fillColor('#0f172a');
        for (const p of projects) {
          ensure(16);
          doc.text(`${p.code} ${p.name}`, left, y, { width: 160 });
          doc.text(moneyFmt(p.quotationTotalCents), left + 170, y, { width: 80 });
          doc.text(moneyFmt(p.amountPaidCents), left + 260, y, { width: 80 });
          doc.text(moneyFmt(p.outstandingCents), left + 350, y, { width: 80 });
          y += 14;
        }
      }

      heading('Quotations');
      if (!quotations.length) {
        doc.fontSize(9).fillColor('#64748b').text('No quotations yet.', left, y);
        y += 14;
      } else {
        for (const q of quotations.slice(0, 80)) {
          ensure(16);
          doc
            .fontSize(9)
            .fillColor('#0f172a')
            .text(
              `${q.project.code} · v${q.version} · ${String(q.status).replace(/_/g, ' ')} · ${moneyFmt(q.totalCents)} · ${day(q.createdAt)}`,
              left,
              y,
              { width },
            );
          y += 14;
        }
      }

      heading('Payments');
      if (!payments.length) {
        doc.fontSize(9).fillColor('#64748b').text('No payments in this period.', left, y);
        y += 14;
      } else {
        for (const p of payments.slice(0, 120)) {
          ensure(16);
          doc
            .fontSize(9)
            .fillColor('#0f172a')
            .text(
              `${day(p.paidAt)} · ${p.project.code} · ${p.receiptNumber} · ${p.purpose || 'PROJECT'} · ${moneyFmt(p.amountCents)} · ${p.method}`,
              left,
              y,
              { width },
            );
          y += 14;
        }
      }

      y += 16;
      ensure(40);
      doc
        .fontSize(8)
        .fillColor('#64748b')
        .text(
          `Generated ${new Date().toISOString().slice(0, 19).replace('T', ' ')} · Nomchael Construction ERP`,
          left,
          y,
          { width },
        );

      doc.end();
    });

    return { buffer, filename: `client-statement-${safeName}.pdf` };
  }
}

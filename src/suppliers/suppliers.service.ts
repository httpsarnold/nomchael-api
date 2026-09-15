import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PayableStatus,
  PaymentMethod,
  Prisma,
} from '@prisma/client';
import PDFDocument from 'pdfkit';
import { PrismaService } from '../prisma/prisma.service';
import { serializeMoney } from '../common/money';

@Injectable()
export class SuppliersService {
  constructor(private prisma: PrismaService) {}

  private async latestBalance(supplierId: string): Promise<bigint> {
    const last = await this.prisma.supplierLedgerEntry.findFirst({
      where: { supplierId },
      orderBy: { createdAt: 'desc' },
      select: { balanceCents: true },
    });
    return last?.balanceCents ?? 0n;
  }

  async appendLedger(
    supplierId: string,
    entryType: string,
    amountCents: bigint,
    description: string,
    referenceId?: string,
    projectId?: string,
  ) {
    const prev = await this.latestBalance(supplierId);
    const balanceCents = prev + amountCents;
    return this.prisma.supplierLedgerEntry.create({
      data: {
        supplierId,
        projectId,
        entryType,
        amountCents,
        balanceCents,
        description,
        referenceId,
      },
    });
  }

  /** Record that we owe a supplier (credit purchase). */
  async createPayable(input: {
    supplierId: string;
    projectId?: string | null;
    stockMovementId?: string | null;
    description: string;
    amountCents: number;
    invoiceRef?: string;
    dueAt?: string;
  }) {
    if (input.amountCents < 1) {
      throw new BadRequestException('Payable amount must be positive');
    }
    await this.prisma.supplier.findUniqueOrThrow({ where: { id: input.supplierId } });

    const payable = await this.prisma.supplierPayable.create({
      data: {
        supplierId: input.supplierId,
        projectId: input.projectId || null,
        stockMovementId: input.stockMovementId || null,
        description: input.description,
        amountCents: BigInt(input.amountCents),
        invoiceRef: input.invoiceRef,
        dueAt: input.dueAt ? new Date(input.dueAt) : null,
        status: PayableStatus.OPEN,
      },
      include: {
        supplier: true,
        project: { select: { id: true, code: true, name: true } },
      },
    });

    await this.appendLedger(
      input.supplierId,
      'CREDIT_PURCHASE',
      BigInt(input.amountCents),
      input.description,
      payable.id,
      input.projectId || undefined,
    );

    return serializeMoney(payable);
  }

  async listPayables(status?: PayableStatus, supplierId?: string, projectId?: string) {
    const list = await this.prisma.supplierPayable.findMany({
      where: {
        ...(status ? { status } : { status: { in: [PayableStatus.OPEN, PayableStatus.PARTIAL] } }),
        ...(supplierId ? { supplierId } : {}),
        ...(projectId ? { projectId } : {}),
      },
      include: {
        supplier: { select: { id: true, name: true, company: true, phone: true } },
        project: { select: { id: true, code: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return list.map((p) =>
      serializeMoney({
        ...p,
        balanceCents: Number(p.amountCents) - Number(p.amountPaidCents),
      }),
    );
  }

  /** Creditors summary: open AP by supplier. */
  async creditorsSummary() {
    const open = await this.prisma.supplierPayable.findMany({
      where: { status: { in: [PayableStatus.OPEN, PayableStatus.PARTIAL] } },
      include: {
        supplier: { select: { id: true, name: true, company: true, phone: true } },
        project: { select: { id: true, code: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const bySupplier = new Map<
      string,
      {
        supplierId: string;
        supplierName: string;
        company: string | null;
        phone: string | null;
        owedCents: number;
        payables: number;
        projectsOnCredit: string[];
      }
    >();

    for (const p of open) {
      const bal = Number(p.amountCents) - Number(p.amountPaidCents);
      if (bal <= 0) continue;
      const cur = bySupplier.get(p.supplierId) || {
        supplierId: p.supplierId,
        supplierName: p.supplier.name,
        company: p.supplier.company,
        phone: p.supplier.phone,
        owedCents: 0,
        payables: 0,
        projectsOnCredit: [] as string[],
      };
      cur.owedCents += bal;
      cur.payables += 1;
      if (p.project?.code && !cur.projectsOnCredit.includes(p.project.code)) {
        cur.projectsOnCredit.push(p.project.code);
      }
      bySupplier.set(p.supplierId, cur);
    }

    const creditors = [...bySupplier.values()].sort((a, b) => b.owedCents - a.owedCents);
    const totalOwedCents = creditors.reduce((s, c) => s + c.owedCents, 0);

    return {
      totalOwedCents,
      creditors,
      openPayables: open.map((p) =>
        serializeMoney({
          ...p,
          balanceCents: Number(p.amountCents) - Number(p.amountPaidCents),
        }),
      ),
    };
  }

  /** Debtors: clients with outstanding quotation balances. */
  async debtorsSummary() {
    const projects = await this.prisma.project.findMany({
      where: {
        quotationTotalCents: { gt: 0 },
      },
      select: {
        id: true,
        code: true,
        name: true,
        status: true,
        quotationTotalCents: true,
        amountPaidCents: true,
        client: { select: { id: true, name: true, phone: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 300,
    });

    const rows = projects
      .map((p) => ({
        projectId: p.id,
        code: p.code,
        name: p.name,
        status: p.status,
        clientId: p.client.id,
        clientName: p.client.name,
        clientPhone: p.client.phone,
        quotedCents: Number(p.quotationTotalCents),
        paidCents: Number(p.amountPaidCents),
        owedCents: Number(p.quotationTotalCents) - Number(p.amountPaidCents),
      }))
      .filter((r) => r.owedCents > 0)
      .sort((a, b) => b.owedCents - a.owedCents);

    const byClient = new Map<
      string,
      { clientId: string; clientName: string; phone: string | null; owedCents: number; projects: number }
    >();
    for (const r of rows) {
      const cur = byClient.get(r.clientId) || {
        clientId: r.clientId,
        clientName: r.clientName,
        phone: r.clientPhone,
        owedCents: 0,
        projects: 0,
      };
      cur.owedCents += r.owedCents;
      cur.projects += 1;
      byClient.set(r.clientId, cur);
    }

    return {
      totalOwedCents: rows.reduce((s, r) => s + r.owedCents, 0),
      debtors: [...byClient.values()].sort((a, b) => b.owedCents - a.owedCents),
      projects: rows,
    };
  }

  async payCreditor(input: {
    supplierId: string;
    amountCents: number;
    method?: PaymentMethod;
    reference?: string;
    notes?: string;
    payableIds?: string[];
    createdById?: string;
  }) {
    if (input.amountCents < 1) {
      throw new BadRequestException('Payment amount must be positive');
    }
    await this.prisma.supplier.findUniqueOrThrow({ where: { id: input.supplierId } });

    const candidates = await this.prisma.supplierPayable.findMany({
      where: {
        supplierId: input.supplierId,
        status: { in: [PayableStatus.OPEN, PayableStatus.PARTIAL] },
        ...(input.payableIds?.length ? { id: { in: input.payableIds } } : {}),
      },
      orderBy: { createdAt: 'asc' },
    });

    if (!candidates.length) {
      throw new BadRequestException('No open payables for this supplier');
    }

    let remaining = input.amountCents;
    const allocations: { payableId: string; amountCents: number }[] = [];

    for (const p of candidates) {
      if (remaining <= 0) break;
      const bal = Number(p.amountCents) - Number(p.amountPaidCents);
      if (bal <= 0) continue;
      const apply = Math.min(remaining, bal);
      allocations.push({ payableId: p.id, amountCents: apply });
      remaining -= apply;
    }

    const applied = input.amountCents - remaining;
    if (applied < 1) {
      throw new BadRequestException('Nothing to allocate against open payables');
    }

    const payment = await this.prisma.$transaction(async (tx) => {
      const pay = await tx.supplierPayment.create({
        data: {
          supplierId: input.supplierId,
          amountCents: BigInt(applied),
          method: input.method || PaymentMethod.CASH,
          reference: input.reference,
          notes: input.notes,
          createdById: input.createdById,
        },
      });

      for (const a of allocations) {
        await tx.supplierPaymentAllocation.create({
          data: {
            supplierPaymentId: pay.id,
            payableId: a.payableId,
            amountCents: BigInt(a.amountCents),
          },
        });
        const payable = candidates.find((c) => c.id === a.payableId)!;
        const newPaid = Number(payable.amountPaidCents) + a.amountCents;
        const status =
          newPaid >= Number(payable.amountCents)
            ? PayableStatus.PAID
            : PayableStatus.PARTIAL;
        await tx.supplierPayable.update({
          where: { id: a.payableId },
          data: { amountPaidCents: BigInt(newPaid), status },
        });
      }

      return pay;
    });

    await this.appendLedger(
      input.supplierId,
      'PAYMENT',
      -BigInt(applied),
      input.notes || `Payment to creditor${input.reference ? ` (${input.reference})` : ''}`,
      payment.id,
    );

    if (remaining > 0) {
      // Overpayment kept as credit balance (negative AP) via ledger only
    }

    return serializeMoney({
      ...payment,
      allocatedCents: applied,
      unallocatedCents: remaining,
      allocations,
    });
  }

  async getStatement(supplierId: string, from?: string, to?: string) {
    const supplier = await this.prisma.supplier.findUniqueOrThrow({
      where: { id: supplierId },
    });

    const fromDate = from ? new Date(from) : undefined;
    const toDate = to ? new Date(to) : undefined;
    const dateFilter: Prisma.SupplierLedgerEntryWhereInput =
      fromDate || toDate
        ? {
            createdAt: {
              ...(fromDate ? { gte: fromDate } : {}),
              ...(toDate ? { lte: toDate } : {}),
            },
          }
        : {};

    const ledger = await this.prisma.supplierLedgerEntry.findMany({
      where: { supplierId, ...dateFilter },
      orderBy: { createdAt: 'asc' },
    });

    const payables = await this.prisma.supplierPayable.findMany({
      where: { supplierId },
      include: { project: { select: { code: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });

    const payments = await this.prisma.supplierPayment.findMany({
      where: { supplierId },
      include: { allocations: true },
      orderBy: { paidAt: 'desc' },
    });

    const balanceCents = Number(await this.latestBalance(supplierId));
    const openCents = payables
      .filter((p) => p.status === PayableStatus.OPEN || p.status === PayableStatus.PARTIAL)
      .reduce((s, p) => s + Number(p.amountCents) - Number(p.amountPaidCents), 0);

    return serializeMoney({
      supplier,
      period: { from: from || null, to: to || null },
      summary: {
        balanceCents,
        openPayableCents: openCents,
        totalCreditedCents: ledger
          .filter((e) => Number(e.amountCents) > 0)
          .reduce((s, e) => s + Number(e.amountCents), 0),
        totalPaidCents: ledger
          .filter((e) => Number(e.amountCents) < 0)
          .reduce((s, e) => s + Math.abs(Number(e.amountCents)), 0),
      },
      ledger,
      payables,
      payments,
    });
  }

  async statementPdf(supplierId: string, from?: string, to?: string) {
    const statement = (await this.getStatement(supplierId, from, to)) as any;
    const s = statement.supplier;
    const summary = statement.summary;
    const ledger = statement.ledger as any[];

    const buffer: Buffer = await new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 48, size: 'A4' });
      const chunks: Buffer[] = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const money = (cents: number) =>
        `$${(Number(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

      doc.fontSize(18).text('Supplier / Creditor Statement', { align: 'left' });
      doc.moveDown(0.3);
      doc.fontSize(11).fillColor('#333').text(s.name);
      if (s.company) doc.text(s.company);
      if (s.phone) doc.text(`Phone: ${s.phone}`);
      if (s.email) doc.text(`Email: ${s.email}`);
      doc.moveDown();
      doc
        .fontSize(10)
        .fillColor('#555')
        .text(
          `Period: ${statement.period.from || 'start'} to ${statement.period.to || 'now'}`,
        );
      doc.moveDown();

      doc.fontSize(12).fillColor('#000').text('Summary');
      doc.fontSize(10).text(`Balance owed (ledger): ${money(summary.balanceCents)}`);
      doc.text(`Open payables: ${money(summary.openPayableCents)}`);
      doc.text(`Total credited (purchases on account): ${money(summary.totalCreditedCents)}`);
      doc.text(`Total paid: ${money(summary.totalPaidCents)}`);
      doc.moveDown();

      doc.fontSize(12).text('Ledger');
      doc.moveDown(0.3);
      for (const row of ledger) {
        const amt = Number(row.amountCents);
        const side = amt >= 0 ? 'CR (owe more)' : 'DR (payment)';
        doc
          .fontSize(9)
          .fillColor('#000')
          .text(
            `${new Date(row.createdAt).toLocaleDateString('en-GB')}  ${row.entryType}  ${side}  ${money(
              Math.abs(amt),
            )}  bal ${money(row.balanceCents)}`,
          );
        doc.fillColor('#555').text(`  ${row.description}`);
        doc.moveDown(0.2);
        if (doc.y > 750) doc.addPage();
      }

      if (!ledger.length) {
        doc.fontSize(10).fillColor('#555').text('No ledger entries in this period.');
      }

      doc.end();
    });

    const safe = String(s.name || 'supplier')
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase();
    return { buffer, filename: `creditor-statement-${safe}.pdf` };
  }
}

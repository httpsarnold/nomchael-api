import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PaymentMethod, PaymentPurpose, SiteVisitStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { serializeMoney } from '../common/money';
import { PrintingService } from '../printing/printing.service';
import { StockService } from '../stock/stock.service';

@Injectable()
export class PaymentsService {
  constructor(
    private prisma: PrismaService,
    private printing: PrintingService,
    private stock: StockService,
  ) {}

  async nextReceipt() {
    const counter = await this.prisma.counter.upsert({
      where: { id: 'receipt' },
      create: { id: 'receipt', value: 1 },
      update: { value: { increment: 1 } },
    });
    return `RCP-${String(counter.value).padStart(6, '0')}`;
  }

  async create(data: {
    projectId: string;
    amountCents: number;
    method?: PaymentMethod;
    reference?: string;
    notes?: string;
    createdById?: string;
    print?: boolean;
    purpose?: PaymentPurpose | string;
    siteVisitId?: string;
  }) {
    const purpose =
      String(data.purpose || 'PROJECT') === 'SITE_VISIT'
        ? PaymentPurpose.SITE_VISIT
        : PaymentPurpose.PROJECT;

    const project = await this.prisma.project.findUnique({
      where: { id: data.projectId },
      include: { client: true },
    });
    if (!project) throw new NotFoundException('Project not found');

    if (purpose === PaymentPurpose.SITE_VISIT) {
      if (!data.siteVisitId) {
        throw new BadRequestException('siteVisitId is required for site visit payments');
      }
      const visit = await this.prisma.siteVisit.findUnique({ where: { id: data.siteVisitId } });
      if (!visit) throw new NotFoundException('Site visit not found');
      if (visit.status === SiteVisitStatus.PAID || visit.status === SiteVisitStatus.COMPLETED) {
        throw new BadRequestException('Site visit is already paid');
      }
    }

    const receiptNumber = await this.nextReceipt();
    const payment = await this.prisma.payment.create({
      data: {
        projectId: data.projectId,
        siteVisitId: data.siteVisitId || null,
        purpose,
        amountCents: BigInt(data.amountCents),
        method: data.method || PaymentMethod.CASH,
        reference: data.reference,
        notes: data.notes,
        receiptNumber,
        createdById: data.createdById,
      },
    });

    let newPaid = project.amountPaidCents;
    let stockSeed: { created: number; quotationId: string | null; reason: string } | null = null;

    if (purpose === PaymentPurpose.PROJECT) {
      newPaid = project.amountPaidCents + BigInt(data.amountCents);
      await this.prisma.project.update({
        where: { id: project.id },
        data: { amountPaidCents: newPaid },
      });
      stockSeed = await this.stock.seedFromPayment(project.id);
    } else if (data.siteVisitId) {
      await this.prisma.siteVisit.update({
        where: { id: data.siteVisitId },
        data: {
          status: SiteVisitStatus.PAID,
          paidAt: new Date(),
          projectId: project.id,
        },
      });
    }

    const lastLedger = await this.prisma.clientLedgerEntry.findFirst({
      where: { clientId: project.clientId },
      orderBy: { createdAt: 'desc' },
    });
    const prev = lastLedger?.balanceCents || 0n;
    await this.prisma.clientLedgerEntry.create({
      data: {
        clientId: project.clientId,
        projectId: project.id,
        entryType: purpose === PaymentPurpose.SITE_VISIT ? 'SITE_VISIT_FEE' : 'PAYMENT',
        amountCents: BigInt(data.amountCents),
        balanceCents: prev - BigInt(data.amountCents),
        description:
          purpose === PaymentPurpose.SITE_VISIT
            ? `Site visit fee revenue ${receiptNumber}`
            : `Payment ${receiptNumber}`,
        referenceId: payment.id,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        userId: data.createdById,
        action: purpose === PaymentPurpose.SITE_VISIT ? 'SITE_VISIT_PAYMENT' : 'PAYMENT_CREATE',
        entityType: 'Payment',
        entityId: payment.id,
        metadata: {
          amountCents: data.amountCents,
          projectId: project.id,
          purpose,
          siteVisitId: data.siteVisitId,
        },
      },
    });

    let printResult: { queued?: boolean; error?: string } | null = null;
    if (data.print !== false) {
      void this.printing
        .printReceipt({
          receiptNumber,
          clientName: project.client.name,
          projectName:
            purpose === PaymentPurpose.SITE_VISIT
              ? `Site visit · ${project.name}`
              : project.name,
          amountCents: data.amountCents,
          method: payment.method,
          paidAt: payment.paidAt,
        })
        .then(async () => {
          await this.prisma.payment.update({
            where: { id: payment.id },
            data: { printedAt: new Date() },
          });
        })
        .catch(() => undefined);
      printResult = { queued: true };
    }

    return serializeMoney({
      ...payment,
      printResult,
      amountDueCents: Number(project.quotationTotalCents - newPaid),
      stockSeed,
    });
  }

  async findAll() {
    const list = await this.prisma.payment.findMany({
      where: { deletedAt: null },
      include: {
        project: { include: { client: true } },
        siteVisit: { select: { id: true, code: true, status: true } },
      },
      orderBy: { paidAt: 'desc' },
      take: 200,
    });
    return list.map((p) => serializeMoney(p));
  }

  async reprint(id: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id },
      include: { project: { include: { client: true } } },
    });
    if (!payment) throw new NotFoundException('Payment not found');
    const printResult = await this.printing.printReceipt({
      receiptNumber: payment.receiptNumber,
      clientName: payment.project.client.name,
      projectName: payment.project.name,
      amountCents: Number(payment.amountCents),
      method: payment.method,
      paidAt: payment.paidAt,
    });
    await this.prisma.payment.update({
      where: { id },
      data: { printedAt: new Date() },
    });
    return { printResult };
  }
}

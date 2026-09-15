import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LineItemType, ProjectStatus, QuotationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { serializeMoney } from '../common/money';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { ConfigService } from '@nestjs/config';
import PDFDocument from 'pdfkit';
import { StockService } from '../stock/stock.service';
import { SiteVisitsService } from '../site-visits/site-visits.service';

interface LineItemInput {
  projectStageId?: string;
  catalogItemId?: string;
  type?: LineItemType;
  description: string;
  quantity: number;
  unit?: string;
  unitPriceCents: number;
  supplierId?: string;
}

@Injectable()
export class QuotationsService {
  constructor(
    private prisma: PrismaService,
    private whatsapp: WhatsappService,
    private config: ConfigService,
    private stock: StockService,
    private siteVisits: SiteVisitsService,
  ) {}

  async structureMultiplier(projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: {
        standPackage: { select: { id: true, standCount: true, name: true, code: true } },
      },
    });
    if (!project) throw new NotFoundException('Project not found');

    if (project.standPackage && project.standPackage.standCount > 1) {
      return {
        count: project.standPackage.standCount,
        label: 'stands',
        source: 'STAND_PACKAGE' as const,
        packageName: project.standPackage.name,
        packageCode: project.standPackage.code,
        unitCount: project.unitCount,
      };
    }

    const count = Math.max(1, project.unitCount || 1);
    return {
      count,
      label: count === 1 ? 'structure' : 'units',
      source: 'PROJECT_UNITS' as const,
      packageName: null as string | null,
      packageCode: null as string | null,
      unitCount: project.unitCount,
    };
  }

  async create(projectId: string, notes?: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: { stages: true },
    });
    if (!project) throw new NotFoundException('Project not found');

    await this.siteVisits.assertPaidVisitForQuote(projectId);

    const last = await this.prisma.quotation.findFirst({
      where: { projectId },
      orderBy: { version: 'desc' },
    });

    const quotation = await this.prisma.quotation.create({
      data: {
        projectId,
        version: (last?.version || 0) + 1,
        status: QuotationStatus.DRAFT,
        notes,
      },
      include: { lineItems: true, project: { include: { client: true, stages: true } } },
    });
    return serializeMoney(quotation);
  }

  async addLineItems(
    quotationId: string,
    items: LineItemInput[],
    options?: { multiplyByStructures?: boolean },
  ) {
    const quotation = await this.prisma.quotation.findUnique({ where: { id: quotationId } });
    if (!quotation) throw new NotFoundException('Quotation not found');
    if (quotation.status !== QuotationStatus.DRAFT) {
      throw new BadRequestException('Only draft quotations can be edited');
    }

    const multiply = options?.multiplyByStructures !== false;
    const structures = multiply
      ? await this.structureMultiplier(quotation.projectId)
      : { count: 1, label: 'structure' };

    const rows: {
      quotationId: string;
      projectStageId?: string;
      catalogItemId?: string;
      type: LineItemType;
      description: string;
      quantity: number;
      unit: string;
      unitPriceCents: bigint;
      totalCents: bigint;
      supplierId?: string;
    }[] = [];

    for (const item of items) {
      const qtyPerStructure = item.quantity || 1;
      const qty = qtyPerStructure * structures.count;
      const total = BigInt(Math.round(qty * item.unitPriceCents));
      const description =
        structures.count > 1 && multiply
          ? `${item.description} (${qtyPerStructure} × ${structures.count} ${structures.label})`
          : item.description;
      rows.push({
        quotationId,
        projectStageId: item.projectStageId,
        catalogItemId: item.catalogItemId,
        type: item.type || LineItemType.MATERIAL,
        description,
        quantity: qty,
        unit: item.unit || 'ea',
        unitPriceCents: BigInt(item.unitPriceCents),
        totalCents: total,
        supplierId: item.supplierId,
      });
    }

    if (rows.length) {
      await this.prisma.quotationLineItem.createMany({ data: rows });
    }

    await this.recalc(quotationId);
    // Stock is seeded only after client payment (not while quoting)
    return this.findOne(quotationId);
  }

  async importCatalogItems(
    quotationId: string,
    entries: {
      catalogItemId: string;
      quantity?: number;
      unitPriceCents?: number;
      multiplyByStructures?: boolean;
    }[],
  ) {
    const quotation = await this.prisma.quotation.findUnique({ where: { id: quotationId } });
    if (!quotation) throw new NotFoundException('Quotation not found');
    if (quotation.status !== QuotationStatus.DRAFT) {
      throw new BadRequestException('Only draft quotations can be edited');
    }
    if (!entries?.length) throw new BadRequestException('Select at least one catalog item');

    const ids = entries.map((e) => e.catalogItemId);
    const catalog = await this.prisma.catalogItem.findMany({
      where: { id: { in: ids }, isActive: true },
    });
    if (!catalog.length) throw new BadRequestException('No active catalog items found');

    const byId = new Map(catalog.map((c) => [c.id, c]));
    const items: LineItemInput[] = [];
    const multiplyByStructures = !entries.every((e) => e.multiplyByStructures === false);

    for (const entry of entries) {
      const c = byId.get(entry.catalogItemId);
      if (!c) continue;
      items.push({
        catalogItemId: c.id,
        description: c.name,
        quantity: entry.quantity ?? 1,
        unit: c.unit,
        unitPriceCents:
          entry.unitPriceCents != null
            ? Math.round(entry.unitPriceCents)
            : Number(c.defaultUnitPriceCents),
        type: LineItemType.MATERIAL,
      });
    }
    if (!items.length) throw new BadRequestException('No matching catalog items to import');
    await this.addLineItems(quotationId, items, { multiplyByStructures });
    return this.findOne(quotationId);
  }

  async updateLineItem(
    quotationId: string,
    lineItemId: string,
    patch: { quantity?: number; unitPriceCents?: number; description?: string; unit?: string },
  ) {
    const quotation = await this.prisma.quotation.findUnique({ where: { id: quotationId } });
    if (!quotation) throw new NotFoundException('Quotation not found');
    if (quotation.status !== QuotationStatus.DRAFT) {
      throw new BadRequestException('Only draft quotations can be edited');
    }

    const line = await this.prisma.quotationLineItem.findFirst({
      where: { id: lineItemId, quotationId },
    });
    if (!line) throw new NotFoundException('Line item not found');

    const quantity = patch.quantity != null ? patch.quantity : Number(line.quantity);
    const unitPriceCents =
      patch.unitPriceCents != null ? Math.round(patch.unitPriceCents) : Number(line.unitPriceCents);
    if (quantity < 0 || unitPriceCents < 0) {
      throw new BadRequestException('Quantity and unit price must be zero or more');
    }

    await this.prisma.quotationLineItem.update({
      where: { id: lineItemId },
      data: {
        quantity,
        unitPriceCents: BigInt(unitPriceCents),
        totalCents: BigInt(Math.round(quantity * unitPriceCents)),
        ...(patch.description != null ? { description: patch.description } : {}),
        ...(patch.unit != null ? { unit: patch.unit } : {}),
      },
    });
    await this.recalc(quotationId);
    return this.findOne(quotationId);
  }

  async removeLineItem(quotationId: string, lineItemId: string) {
    const quotation = await this.prisma.quotation.findUnique({ where: { id: quotationId } });
    if (!quotation) throw new NotFoundException('Quotation not found');
    if (quotation.status !== QuotationStatus.DRAFT) {
      throw new BadRequestException('Only draft quotations can be edited');
    }
    const line = await this.prisma.quotationLineItem.findFirst({
      where: { id: lineItemId, quotationId },
    });
    if (!line) throw new NotFoundException('Line item not found');

    const linked = await this.prisma.projectStock.findMany({
      where: { quotationLineItemId: lineItemId },
    });
    for (const stock of linked) {
      const used =
        Number(stock.qtyPurchased) > 0 ||
        Number(stock.qtyUsed) > 0 ||
        Number(stock.qtySold) > 0 ||
        Number(stock.qtyReturned) > 0 ||
        Number(stock.qtyTransferredOut) > 0 ||
        Number(stock.qtyTransferredIn) > 0;
      if (used) {
        await this.prisma.projectStock.update({
          where: { id: stock.id },
          data: { quotationLineItemId: null },
        });
      } else {
        await this.prisma.projectStock.delete({ where: { id: stock.id } });
      }
    }

    await this.prisma.quotationLineItem.delete({ where: { id: lineItemId } });
    await this.recalc(quotationId);
    return this.findOne(quotationId);
  }

  async recalc(quotationId: string) {
    const items = await this.prisma.quotationLineItem.findMany({ where: { quotationId } });
    const stagesLabour = await this.prisma.quotation.findUnique({
      where: { id: quotationId },
      include: { project: { include: { stages: true } } },
    });
    const itemsTotal = items.reduce((s, i) => s + i.totalCents, 0n);
    const labourTotal =
      stagesLabour?.project.stages.reduce((s, st) => s + st.labourCents, 0n) || 0n;
    const totalCents = itemsTotal + labourTotal;
    const quotation = await this.prisma.quotation.update({
      where: { id: quotationId },
      data: { totalCents },
      include: {
        lineItems: true,
        project: { include: { client: true, stages: { orderBy: { sortOrder: 'asc' } } } },
      },
    });
    return serializeMoney(quotation);
  }

  async findAll() {
    const list = await this.prisma.quotation.findMany({
      include: { project: { include: { client: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return list.map((q) => serializeMoney(q));
  }

  async findOne(id: string) {
    const q = await this.prisma.quotation.findUnique({
      where: { id },
      include: {
        lineItems: { include: { supplier: true, projectStage: true, catalogItem: true } },
        project: {
          include: {
            client: true,
            stages: { orderBy: { sortOrder: 'asc' } },
            standPackage: { select: { id: true, code: true, name: true, standCount: true } },
          },
        },
        mdApprovedBy: { select: { id: true, fullName: true, role: true } },
      },
    });
    if (!q) throw new NotFoundException('Quotation not found');
    const structures = await this.structureMultiplier(q.projectId);
    return serializeMoney({ ...q, structures });
  }

  async buildPdfBuffer(quotationId: string): Promise<Buffer> {
    const q = await this.prisma.quotation.findUnique({
      where: { id: quotationId },
      include: {
        lineItems: { orderBy: { createdAt: 'asc' } },
        project: { include: { client: true, stages: { orderBy: { sortOrder: 'asc' } } } },
      },
    });
    if (!q) throw new NotFoundException('Quotation not found');
    const company = this.config.get('COMPANY_NAME') || 'Nomchael Construction';
    const currency = this.config.get('CURRENCY') || 'USD';
    const structures = await this.structureMultiplier(q.projectId);
    const moneyFmt = (cents: bigint | number) =>
      `${currency} ${(Number(cents) / 100).toFixed(2)}`;

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 48, size: 'A4' });
      const chunks: Buffer[] = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const left = doc.page.margins.left;
      const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;

      doc.fontSize(18).fillColor('#0f172a').text(company, left, 48);
      doc.fontSize(10).fillColor('#64748b').text('OFFICIAL QUOTATION STATEMENT', left, 72);
      doc
        .moveTo(left, 92)
        .lineTo(left + width, 92)
        .strokeColor('#e5e7eb')
        .stroke();

      doc.fontSize(10);
      let y = 108;
      const meta = (label: string, value: string) => {
        doc.fillColor('#64748b').text(label, left, y, { width: 110 });
        doc.fillColor('#0f172a').text(value, left + 120, y, { width: width - 120 });
        y += 16;
      };
      meta('Document', `QT-${q.project.code}-v${q.version}`);
      meta('Status', q.status.replace(/_/g, ' '));
      meta('Project', `${q.project.code} ${q.project.name}`);
      meta('Client', q.project.client.name);
      meta('Phone', q.project.client.whatsapp || q.project.client.phone || '—');
      meta('Site', q.project.address || q.project.client.address || '—');
      {
        const storeys = Math.max(1, Number((q.project as any).storeys) || 1);
        const levels =
          storeys <= 1
            ? 'Ground floor only (no upstairs)'
            : storeys === 2
              ? 'Has upstairs (double storey)'
              : `${storeys} storeys (has upstairs)`;
        meta('Levels', levels);
      }
      if (structures.count > 1) meta('Structures', `${structures.count} ${structures.label}`);
      y += 10;

      doc.fontSize(11).fillColor('#0f172a').text('Line items', left, y);
      y += 18;
      doc.fontSize(8).fillColor('#64748b');
      doc.text('#', left, y, { width: 24 });
      doc.text('Description', left + 28, y, { width: 220 });
      doc.text('Qty', left + 250, y, { width: 70 });
      doc.text('Unit price', left + 320, y, { width: 80 });
      doc.text('Amount', left + 410, y, { width: 90, align: 'right' });
      y += 12;
      doc.moveTo(left, y).lineTo(left + width, y).strokeColor('#e5e7eb').stroke();
      y += 8;

      doc.fontSize(9).fillColor('#0f172a');
      let idx = 1;
      for (const item of q.lineItems) {
        if (y > 720) {
          doc.addPage();
          y = 48;
        }
        const prefix = item.type === 'EQUIPMENT' ? 'Hire: ' : '';
        doc.text(String(idx++), left, y, { width: 24 });
        doc.text(`${prefix}${item.description}`, left + 28, y, { width: 220 });
        doc.text(`${item.quantity} ${item.unit}`, left + 250, y, { width: 70 });
        doc.text(moneyFmt(item.unitPriceCents), left + 320, y, { width: 80 });
        doc.text(moneyFmt(item.totalCents), left + 410, y, { width: 90, align: 'right' });
        y += 16;
      }

      for (const stage of q.project.stages) {
        if (Number(stage.labourCents) <= 0) continue;
        if (y > 720) {
          doc.addPage();
          y = 48;
        }
        doc.text(String(idx++), left, y, { width: 24 });
        doc.text(`Labour: ${stage.name}`, left + 28, y, { width: 220 });
        doc.text('1 lot', left + 250, y, { width: 70 });
        doc.text(moneyFmt(stage.labourCents), left + 320, y, { width: 80 });
        doc.text(moneyFmt(stage.labourCents), left + 410, y, { width: 90, align: 'right' });
        y += 16;
      }

      y += 12;
      doc.moveTo(left, y).lineTo(left + width, y).strokeColor('#e5e7eb').stroke();
      y += 14;
      doc.fontSize(13).fillColor('#0f172a').text(`TOTAL  ${moneyFmt(q.totalCents)}`, left, y, {
        width,
        align: 'right',
      });
      y += 28;
      doc
        .fontSize(9)
        .fillColor('#64748b')
        .text(
          'Acceptance by the client authorises Nomchael to open the project file after MD approval.',
          left,
          y,
          { width },
        );
      doc.end();
    });
  }

  async sendToWhatsapp(quotationId: string) {
    const q = await this.recalc(quotationId);
    const phone = q.project.client.whatsapp || q.project.client.phone;
    const currency = this.config.get('CURRENCY') || 'USD';
    const company = this.config.get('COMPANY_NAME') || 'Nomchael Construction';
    const message = `${company}: Quotation v${q.version} for project ${q.project.name} (${q.project.code}). Total: ${currency} ${(Number(q.totalCents) / 100).toFixed(2)}. Please reply to confirm.`;
    const result = await this.whatsapp.sendText(phone, message);
    const updated = await this.prisma.quotation.update({
      where: { id: quotationId },
      data: {
        status: QuotationStatus.SENT,
        sentAt: new Date(),
        whatsappMessageId: String(result.id || ''),
      },
      include: { project: { include: { client: true } }, lineItems: true },
    });
    await this.prisma.project.update({
      where: { id: updated.projectId },
      data: { status: ProjectStatus.QUOTED, quotationTotalCents: updated.totalCents },
    });
    return serializeMoney({ ...updated, whatsapp: result });
  }

  async accept(quotationId: string) {
    const q = await this.prisma.quotation.findUnique({
      where: { id: quotationId },
      include: { lineItems: true },
    });
    if (!q) throw new NotFoundException('Quotation not found');
    if (
      q.status !== QuotationStatus.DRAFT &&
      q.status !== QuotationStatus.SENT &&
      q.status !== QuotationStatus.PENDING_MD_APPROVAL
    ) {
      throw new BadRequestException(
        'Only draft or sent quotations can be submitted for Managing Director approval',
      );
    }

    await this.prisma.quotation.updateMany({
      where: {
        projectId: q.projectId,
        id: { not: quotationId },
        status: {
          in: [QuotationStatus.ACCEPTED, QuotationStatus.PENDING_MD_APPROVAL],
        },
      },
      data: { status: QuotationStatus.SUPERSEDED },
    });

    const updated = await this.prisma.quotation.update({
      where: { id: quotationId },
      data: {
        status: QuotationStatus.PENDING_MD_APPROVAL,
        acceptedAt: new Date(),
        mdApprovedAt: null,
        mdApprovedById: null,
        mdRejectionReason: null,
      },
      include: {
        project: { include: { client: true } },
        lineItems: true,
        mdApprovedBy: { select: { id: true, fullName: true } },
      },
    });

    await this.prisma.project.update({
      where: { id: q.projectId },
      data: {
        status: ProjectStatus.QUOTED,
        quotationTotalCents: q.totalCents,
      },
    });

    return serializeMoney(updated);
  }

  async mdDecide(
    quotationId: string,
    user: { id: string },
    approve: boolean,
    rejectionReason?: string,
  ) {
    const q = await this.prisma.quotation.findUnique({
      where: { id: quotationId },
      include: { lineItems: true },
    });
    if (!q) throw new NotFoundException('Quotation not found');
    if (q.status !== QuotationStatus.PENDING_MD_APPROVAL) {
      throw new BadRequestException(
        'Quotation is not waiting for Managing Director approval',
      );
    }

    if (!approve) {
      const rejected = await this.prisma.quotation.update({
        where: { id: quotationId },
        data: {
          status: QuotationStatus.REJECTED,
          mdRejectionReason: rejectionReason || 'Rejected by Managing Director',
          mdApprovedById: user.id,
          mdApprovedAt: new Date(),
        },
        include: {
          project: { include: { client: true } },
          lineItems: true,
          mdApprovedBy: { select: { id: true, fullName: true } },
        },
      });
      return serializeMoney(rejected);
    }

    // File open requires paid site visit + this quotation path (client already agreed).
    await this.siteVisits.assertPaidVisitForQuote(q.projectId);

    const updated = await this.prisma.quotation.update({
      where: { id: quotationId },
      data: {
        status: QuotationStatus.ACCEPTED,
        mdApprovedAt: new Date(),
        mdApprovedById: user.id,
        mdRejectionReason: null,
      },
      include: {
        project: { include: { client: true } },
        lineItems: true,
        mdApprovedBy: { select: { id: true, fullName: true } },
      },
    });

    await this.prisma.project.update({
      where: { id: q.projectId },
      data: {
        status: ProjectStatus.ACTIVE,
        quotationTotalCents: q.totalCents,
      },
    });

    // If client already paid, seed stock now that the quote is accepted
    await this.stock.seedFromPayment(q.projectId);

    return serializeMoney(updated);
  }

  async pendingMdApproval() {
    const list = await this.prisma.quotation.findMany({
      where: { status: QuotationStatus.PENDING_MD_APPROVAL },
      include: { project: { include: { client: true } } },
      orderBy: { acceptedAt: 'asc' },
    });
    return list.map((q) =>
      serializeMoney({
        ...q,
        title: 'Quotation awaiting MD approval',
        message: `${q.project.name} · v${q.version}`,
      }),
    );
  }

  async setStageLabour(
    projectId: string,
    stageId: string,
    labourCents: number,
    options?: { multiplyByStructures?: boolean; quotationId?: string },
  ) {
    const multiply = options?.multiplyByStructures !== false;
    const structures = multiply
      ? await this.structureMultiplier(projectId)
      : { count: 1, label: 'structure' };
    const amount = BigInt(Math.round(labourCents * structures.count));

    const stage = await this.prisma.projectStage.update({
      where: { id: stageId },
      data: { labourCents: amount },
    });

    let quotationId = options?.quotationId;
    if (!quotationId) {
      const draft = await this.prisma.quotation.findFirst({
        where: { projectId, status: QuotationStatus.DRAFT },
        orderBy: { version: 'desc' },
      });
      quotationId = draft?.id;
    }
    if (quotationId) {
      await this.recalc(quotationId);
      return {
        stage: serializeMoney(stage),
        quotation: await this.findOne(quotationId),
        structures,
        labourEnteredCents: labourCents,
        labourPostedCents: Number(amount),
      };
    }
    return {
      stage: serializeMoney(stage),
      quotation: null,
      structures,
      labourEnteredCents: labourCents,
      labourPostedCents: Number(amount),
    };
  }
}

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ProjectStatus, PropertyType, RoomType, QuotationStatus, SiteVisitStatus } from '@prisma/client';
import PDFDocument from 'pdfkit';
import { suggestedStagesForPropertyType } from '../shared';
import { PrismaService } from '../prisma/prisma.service';
import { serializeMoney } from '../common/money';
import { SiteVisitsService } from '../site-visits/site-visits.service';

export interface RoomInput {
  roomType: RoomType;
  label?: string;
  quantity?: number;
  floorLevel?: string;
  notes?: string;
}

export interface CreateProjectDto {
  name: string;
  description?: string;
  clientId: string;
  address?: string;
  locationLat?: number;
  locationLng?: number;
  locationNotes?: string;
  propertyType?: PropertyType;
  unitCount?: number;
  storeys?: number;
  bedrooms?: number;
  bathrooms?: number;
  kitchens?: number;
  lounges?: number;
  otherRooms?: number;
  floorAreaSqm?: number;
  propertyNotes?: string;
  rooms?: RoomInput[];
  stageTemplateNames?: string[];
  startFromTemplateName?: string;
  standPackageId?: string;
  standNumber?: number;
}

@Injectable()
export class ProjectsService {
  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private siteVisits: SiteVisitsService,
  ) {}

  async nextCode() {
    const counter = await this.prisma.counter.upsert({
      where: { id: 'project' },
      create: { id: 'project', value: 1 },
      update: { value: { increment: 1 } },
    });
    return `PRJ-${String(counter.value).padStart(5, '0')}`;
  }

  private buildRoomsFromCounts(dto: CreateProjectDto): RoomInput[] {
    if (dto.rooms?.length) return dto.rooms;
    const rooms: RoomInput[] = [];
    if (dto.bedrooms) rooms.push({ roomType: RoomType.BEDROOM, quantity: dto.bedrooms });
    if (dto.bathrooms) rooms.push({ roomType: RoomType.BATHROOM, quantity: dto.bathrooms });
    if (dto.kitchens) rooms.push({ roomType: RoomType.KITCHEN, quantity: dto.kitchens });
    if (dto.lounges) rooms.push({ roomType: RoomType.LOUNGE, quantity: dto.lounges });
    if (dto.otherRooms) rooms.push({ roomType: RoomType.OTHER, quantity: dto.otherRooms });
    return rooms;
  }

  async create(dto: CreateProjectDto) {
    const client = await this.prisma.client.findUnique({ where: { id: dto.clientId } });
    if (!client) throw new NotFoundException('Client not found');

    const name = dto.name.trim();
    if (!name) throw new BadRequestException('Project name is required');

    const existing = await this.prisma.project.findFirst({
      where: {
        clientId: dto.clientId,
        name: { equals: name, mode: 'insensitive' },
        status: { not: ProjectStatus.CANCELLED },
      },
    });
    if (existing) {
      throw new ConflictException(
        `A project named "${existing.name}" already exists for this client (${existing.code}). You cannot create the same project twice.`,
      );
    }

    const templates = await this.prisma.stageTemplate.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
    const propertyType = dto.propertyType || PropertyType.SINGLE_HOME;
    const suggestedNames = suggestedStagesForPropertyType(propertyType);

    let stageNames: string[] = [...suggestedNames];
    if (dto.stageTemplateNames?.length) {
      stageNames = dto.stageTemplateNames;
    } else if (dto.startFromTemplateName) {
      const startName = dto.startFromTemplateName.toLowerCase();
      const startIdx = stageNames.findIndex((n) => n.toLowerCase() === startName);
      if (startIdx >= 0) {
        stageNames = stageNames.slice(startIdx);
      } else {
        const start = templates.find((t) => t.name.toLowerCase() === startName);
        if (!start) throw new BadRequestException('Start stage template not found');
        stageNames = templates.filter((t) => t.sortOrder >= start.sortOrder).map((t) => t.name);
      }
    }

    if (!stageNames.length) {
      stageNames = templates.map((t) => t.name);
    }

    const rooms = this.buildRoomsFromCounts(dto);
    const code = await this.nextCode();
    if (dto.locationLat != null || dto.locationLng != null) {
      throw new BadRequestException(
        'Do not capture site coordinates at registration or site visit. Capture GPS after the project file is opened (MD-approved quotation).',
      );
    }
    const project = await this.prisma.project.create({
      data: {
        code,
        name,
        description: dto.description,
        clientId: dto.clientId,
        address: dto.address,
        locationNotes: dto.locationNotes,
        propertyType: dto.propertyType || PropertyType.SINGLE_HOME,
        unitCount: dto.unitCount ?? 1,
        storeys: Math.max(1, dto.storeys ?? 1),
        bedrooms: dto.bedrooms ?? 0,
        bathrooms: dto.bathrooms ?? 0,
        kitchens: dto.kitchens ?? 0,
        lounges: dto.lounges ?? 0,
        otherRooms: dto.otherRooms ?? 0,
        floorAreaSqm: dto.floorAreaSqm,
        propertyNotes: dto.propertyNotes,
        standPackageId: dto.standPackageId,
        standNumber: dto.standNumber,
        status: ProjectStatus.DRAFT,
        stages: {
          create: stageNames.map((name, idx) => ({
            name,
            sortOrder: idx + 1,
            templateName: name,
          })),
        },
        rooms: {
          create: rooms.map((r) => ({
            roomType: r.roomType,
            label: r.label,
            quantity: r.quantity ?? 1,
            floorLevel: r.floorLevel,
            notes: r.notes,
          })),
        },
      },
      include: {
        stages: { orderBy: { sortOrder: 'asc' } },
        rooms: true,
        client: true,
      },
    });
    return serializeMoney(project);
  }

  async findAll() {
    const projects = await this.prisma.project.findMany({
      select: {
        id: true,
        code: true,
        name: true,
        status: true,
        clientId: true,
        standPackageId: true,
        standNumber: true,
        propertyType: true,
        unitCount: true,
        bedrooms: true,
        bathrooms: true,
        kitchens: true,
        lounges: true,
        otherRooms: true,
        quotationTotalCents: true,
        amountPaidCents: true,
        createdAt: true,
        updatedAt: true,
        client: { select: { id: true, name: true } },
        stages: { select: { isCompleted: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return projects.map((p) => {
      const completed = p.stages.filter((s) => s.isCompleted).length;
      const total = p.stages.length || 1;
      const roomTotal = p.bedrooms + p.bathrooms + p.kitchens + p.lounges + p.otherRooms;
      return serializeMoney({
        ...p,
        stages: undefined,
        totalRooms: roomTotal,
        completionPercent: Math.round((completed / total) * 100),
        amountDueCents: Number(p.quotationTotalCents - p.amountPaidCents),
      });
    });
  }

  async findOne(id: string) {
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: {
        client: { select: { id: true, name: true, phone: true, whatsapp: true, address: true, type: true } },
        standPackage: {
          select: {
            id: true,
            code: true,
            name: true,
            accountMode: true,
            standCount: true,
            _count: { select: { projects: true } },
          },
        },
        rooms: { orderBy: { createdAt: 'asc' } },
        stages: { orderBy: { sortOrder: 'asc' } },
        quotations: {
          orderBy: { version: 'desc' },
          take: 10,
          select: {
            id: true,
            version: true,
            status: true,
            totalCents: true,
            sentAt: true,
            acceptedAt: true,
            createdAt: true,
          },
        },
        expenses: {
          where: { deletedAt: null },
          orderBy: { expenseDate: 'desc' },
          take: 30,
        },
        payments: {
          where: { deletedAt: null },
          orderBy: { paidAt: 'desc' },
          take: 30,
        },
        stockItems: { take: 50 },
        assignments: {
          include: { employee: { select: { id: true, fullName: true, roleTitle: true } } },
          take: 30,
        },
        shortfalls: { orderBy: { createdAt: 'desc' }, take: 20 },
        invoices: { where: { deletedAt: null }, orderBy: { issuedAt: 'desc' }, take: 20 },
      },
    });
    if (!project) throw new NotFoundException('Project not found');
    const completed = project.stages.filter((s) => s.isCompleted).length;
    const total = project.stages.length || 1;
    const roomTotal =
      project.bedrooms +
        project.bathrooms +
        project.kitchens +
        project.lounges +
        project.otherRooms ||
      project.rooms.reduce((s, r) => s + r.quantity, 0);
    return serializeMoney({
      ...project,
      totalRooms: roomTotal,
      completionPercent: Math.round((completed / total) * 100),
      amountDueCents: Number(project.quotationTotalCents - project.amountPaidCents),
    });
  }

  async buildPdfBuffer(projectId: string): Promise<{ buffer: Buffer; filename: string }> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: {
        client: true,
        stages: { orderBy: { sortOrder: 'asc' } },
        quotations: { orderBy: { version: 'desc' }, take: 10 },
        payments: {
          where: { deletedAt: null },
          orderBy: { paidAt: 'desc' },
          take: 40,
        },
        expenses: {
          where: { deletedAt: null },
          orderBy: { expenseDate: 'desc' },
          take: 40,
        },
        stockItems: {
          include: { quotationLineItem: { select: { quantity: true } } },
          orderBy: { itemName: 'asc' },
          take: 80,
        },
      },
    });
    if (!project) throw new NotFoundException('Project not found');

    const company = this.config.get('COMPANY_NAME') || 'Nomchael Construction';
    const currency = this.config.get('CURRENCY') || 'USD';
    const moneyFmt = (cents: bigint | number) =>
      `${currency} ${(Number(cents) / 100).toFixed(2)}`;
    const completed = project.stages.filter((s) => s.isCompleted).length;
    const totalStages = project.stages.length || 1;
    const pct = Math.round((completed / totalStages) * 100);
    const due = Number(project.quotationTotalCents - project.amountPaidCents);
    const day = (d?: Date | null) => (d ? d.toISOString().slice(0, 10) : '—');

    const buffer = await new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ margin: 48, size: 'A4' });
      const chunks: Buffer[] = [];
      doc.on('data', (c) => chunks.push(c));
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
      doc.fontSize(10).fillColor('#64748b').text('PROJECT DOSSIER PDF', left, y);
      y += 18;
      doc.moveTo(left, y).lineTo(left + width, y).strokeColor('#e5e7eb').stroke();
      y += 14;

      heading('Project');
      row('Code', project.code);
      row('Name', project.name);
      row('Status', project.status);
      row('Progress', `${pct}% (${completed}/${totalStages} stages)`);
      row('Property', (project.propertyType || 'SINGLE_HOME').replace(/_/g, ' '));
      row('Address', project.address || project.locationNotes || '—');
      row('Planned', `${day(project.plannedStartAt)} to ${day(project.plannedEndAt)}`);

      heading('Client');
      row('Name', project.client.name);
      row('Type', project.client.type);
      row('Phone', project.client.whatsapp || project.client.phone || '—');
      row('Address', project.client.address || '—');

      heading('Money');
      row('Quoted total', moneyFmt(project.quotationTotalCents));
      row('Paid (project)', moneyFmt(project.amountPaidCents));
      row('Outstanding', moneyFmt(due));

      heading('Stages / timeline');
      doc.fontSize(8).fillColor('#64748b');
      doc.text('Stage', left, y, { width: 150 });
      doc.text('Plan', left + 160, y, { width: 150 });
      doc.text('Status', left + 320, y, { width: 150 });
      y += 12;
      doc.fontSize(9).fillColor('#0f172a');
      for (const s of project.stages) {
        ensure(16);
        doc.text(s.name, left, y, { width: 150 });
        doc.text(`${day(s.plannedStartAt)} → ${day(s.plannedEndAt)}`, left + 160, y, {
          width: 150,
        });
        doc.text(s.isCompleted ? `Done ${day(s.completedAt)}` : 'Open', left + 320, y, {
          width: 150,
        });
        y += 14;
      }

      heading('Quotations');
      if (!project.quotations.length) {
        doc.fontSize(9).fillColor('#64748b').text('No quotations yet.', left, y);
        y += 14;
      } else {
        for (const q of project.quotations) {
          ensure(16);
          doc
            .fontSize(9)
            .fillColor('#0f172a')
            .text(
              `v${q.version} · ${q.status.replace(/_/g, ' ')} · ${moneyFmt(q.totalCents)} · ${day(q.createdAt)}`,
              left,
              y,
              { width },
            );
          y += 14;
        }
      }

      heading('Payments');
      if (!project.payments.length) {
        doc.fontSize(9).fillColor('#64748b').text('No payments yet.', left, y);
        y += 14;
      } else {
        for (const p of project.payments) {
          ensure(16);
          doc
            .fontSize(9)
            .fillColor('#0f172a')
            .text(
              `${day(p.paidAt)} · ${p.receiptNumber} · ${p.purpose || 'PROJECT'} · ${moneyFmt(p.amountCents)} · ${p.method}`,
              left,
              y,
              { width },
            );
          y += 14;
        }
      }

      heading('Expenses');
      if (!project.expenses.length) {
        doc.fontSize(9).fillColor('#64748b').text('No expenses yet.', left, y);
        y += 14;
      } else {
        for (const e of project.expenses) {
          ensure(16);
          doc
            .fontSize(9)
            .fillColor('#0f172a')
            .text(
              `${day(e.expenseDate)} · ${e.category} · ${e.description} · ${moneyFmt(e.amountCents)}`,
              left,
              y,
              { width },
            );
          y += 14;
        }
      }

      heading('Stock (quoted / purchased)');
      if (!project.stockItems.length) {
        doc.fontSize(9).fillColor('#64748b').text('No stock lines (needs payment + accepted quote).', left, y);
        y += 14;
      } else {
        for (const s of project.stockItems) {
          ensure(16);
          const quoted = s.quotationLineItem ? Number(s.quotationLineItem.quantity) : '—';
          doc
            .fontSize(9)
            .fillColor('#0f172a')
            .text(
              `${s.itemName} (${s.unit}) · quoted ${quoted} · purchased ${s.qtyPurchased} · used ${s.qtyUsed}`,
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
        .text(`Generated ${new Date().toISOString().slice(0, 19).replace('T', ' ')} · Nomchael Construction ERP`, left, y, {
          width,
        });

      doc.end();
    });

    return { buffer, filename: `project-${project.code}.pdf` };
  }

  /**
   * Project DR/CR running balance:
   * CR = client income (payments) and quotation credits.
   * DR = project expenses (materials, site costs, wages allocations as expenses).
   * Closing balance ≈ quoted − paid for debtor view, plus spend vs income for cash audit.
   */
  async projectLedger(id: string) {
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: {
        client: { select: { id: true, name: true, phone: true } },
        payments: {
          where: { deletedAt: null, purpose: 'PROJECT' },
          orderBy: { paidAt: 'asc' },
        },
        expenses: {
          where: { deletedAt: null, scope: 'PROJECT' },
          include: { employee: { select: { fullName: true } } },
          orderBy: { expenseDate: 'asc' },
        },
        supplierPayables: {
          where: { status: { in: ['OPEN', 'PARTIAL'] } },
          include: { supplier: { select: { name: true } } },
        },
      },
    });
    if (!project) throw new NotFoundException('Project not found');

    type Row = {
      at: string;
      type: string;
      description: string;
      debitCents: number;
      creditCents: number;
      balanceCents: number;
      referenceId?: string;
    };

    const events: { at: Date; type: string; description: string; debit: number; credit: number; referenceId?: string }[] =
      [];

    // Opening: quotation as amount the client owes (debit debtor / credit revenue booked)
    if (Number(project.quotationTotalCents) > 0) {
      events.push({
        at: project.createdAt,
        type: 'QUOTATION',
        description: 'Approved / recorded quotation total (client debtor)',
        debit: Number(project.quotationTotalCents),
        credit: 0,
        referenceId: project.id,
      });
    }

    for (const p of project.payments) {
      events.push({
        at: p.paidAt,
        type: 'PAYMENT',
        description: `Client payment ${p.receiptNumber} (${p.method})`,
        debit: 0,
        credit: Number(p.amountCents),
        referenceId: p.id,
      });
    }

    for (const e of project.expenses) {
      const who = e.employee?.fullName ? ` · ${e.employee.fullName}` : '';
      events.push({
        at: e.expenseDate,
        type: 'EXPENSE',
        description: `${e.category}: ${e.description}${who}`,
        debit: Number(e.amountCents),
        credit: 0,
        referenceId: e.id,
      });
    }

    events.sort((a, b) => a.at.getTime() - b.at.getTime());

    let running = 0;
    const lines: Row[] = events.map((ev) => {
      // Debtor balance: +debit (quote/spend pressure) −credit (payments)
      // For audit PDF we show DR/CR columns and a running "client account" balance (quote − paid)
      // plus separately track spend.
      running += ev.debit - ev.credit;
      return {
        at: ev.at.toISOString(),
        type: ev.type,
        description: ev.description,
        debitCents: ev.debit,
        creditCents: ev.credit,
        balanceCents: running,
        referenceId: ev.referenceId,
      };
    });

    const paidCents = Number(project.amountPaidCents);
    const quotedCents = Number(project.quotationTotalCents);
    const expenseCents = project.expenses.reduce((s, e) => s + Number(e.amountCents), 0);
    const creditorCents = project.supplierPayables.reduce(
      (s, p) => s + Number(p.amountCents) - Number(p.amountPaidCents),
      0,
    );

    return serializeMoney({
      project: {
        id: project.id,
        code: project.code,
        name: project.name,
        status: project.status,
        client: project.client,
      },
      summary: {
        quotedCents,
        paidCents,
        clientOwesCents: quotedCents - paidCents,
        projectSpendCents: expenseCents,
        cashSurplusCents: paidCents - expenseCents,
        stockOnCreditCents: creditorCents,
        creditors: project.supplierPayables.map((p) => ({
          id: p.id,
          supplier: p.supplier.name,
          balanceCents: Number(p.amountCents) - Number(p.amountPaidCents),
          description: p.description,
        })),
      },
      lines,
    });
  }

  async projectLedgerPdf(id: string) {
    const ledger = (await this.projectLedger(id)) as any;
    const p = ledger.project;
    const summary = ledger.summary;
    const lines = ledger.lines as any[];
    const company = this.config.get('COMPANY_NAME') || 'Nomchael Construction';
    const currency = this.config.get('CURRENCY') || 'USD';
    const moneyFmt = (cents: number) =>
      `${currency} ${(Number(cents) / 100).toFixed(2)}`;

    const buffer = await new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ margin: 48, size: 'A4' });
      const chunks: Buffer[] = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.fontSize(16).text(`${company}`);
      doc.fontSize(12).text('Project DR / CR statement');
      doc.moveDown(0.4);
      doc.fontSize(10).text(`${p.code} · ${p.name}`);
      doc.text(`Client: ${p.client?.name || '—'}`);
      doc.text(`Status: ${p.status}`);
      doc.moveDown();

      doc.fontSize(11).text('Summary');
      doc.fontSize(9);
      doc.text(`Quoted (CR revenue / DR debtor): ${moneyFmt(summary.quotedCents)}`);
      doc.text(`Paid by client (CR): ${moneyFmt(summary.paidCents)}`);
      doc.text(`Client still owes (debtor): ${moneyFmt(summary.clientOwesCents)}`);
      doc.text(`Project expenditure (DR): ${moneyFmt(summary.projectSpendCents)}`);
      doc.text(`Cash on project (paid − spend): ${moneyFmt(summary.cashSurplusCents)}`);
      doc.text(`Stock still on supplier credit (creditor): ${moneyFmt(summary.stockOnCreditCents)}`);
      if (summary.creditors?.length) {
        doc.moveDown(0.3);
        doc.text('Open supplier credit on this project:');
        for (const c of summary.creditors) {
          doc.text(`  · ${c.supplier}: ${moneyFmt(c.balanceCents)} — ${c.description}`);
        }
      }
      doc.moveDown();

      doc.fontSize(11).text('Ledger');
      doc.moveDown(0.2);
      doc.fontSize(8).fillColor('#555');
      doc.text('Date', 48, doc.y, { continued: true, width: 70 });
      doc.text('Type', 118, doc.y, { continued: true, width: 70 });
      doc.text('DR', 350, doc.y, { continued: true, width: 70 });
      doc.text('CR', 420, doc.y, { continued: true, width: 70 });
      doc.text('Bal', 490, doc.y);
      doc.fillColor('#000');
      doc.moveDown(0.3);

      for (const row of lines) {
        if (doc.y > 750) doc.addPage();
        const d = new Date(row.at).toLocaleDateString('en-GB');
        doc.fontSize(8);
        doc.text(d, 48, doc.y, { continued: false, width: 70 });
        const y = doc.y - 10;
        doc.text(row.type, 118, y, { width: 60 });
        doc.text(row.debitCents ? moneyFmt(row.debitCents) : '—', 350, y, { width: 65 });
        doc.text(row.creditCents ? moneyFmt(row.creditCents) : '—', 420, y, { width: 65 });
        doc.text(moneyFmt(row.balanceCents), 490, y, { width: 65 });
        doc.text(row.description, 118, y + 10, { width: 220 });
        doc.moveDown(0.8);
      }

      if (!lines.length) {
        doc.fontSize(10).fillColor('#555').text('No ledger lines yet.');
      }

      doc.end();
    });

    return { buffer, filename: `project-ledger-${p.code}.pdf` };
  }

  async update(
    id: string,
    dto: Partial<{
      name: string;
      description: string;
      address: string;
      locationLat: number;
      locationLng: number;
      locationNotes: string;
      status: ProjectStatus;
      propertyType: PropertyType;
      unitCount: number;
      storeys: number;
      bedrooms: number;
      bathrooms: number;
      kitchens: number;
      lounges: number;
      otherRooms: number;
      floorAreaSqm: number;
      propertyNotes: string;
    }>,
  ) {
    if (dto.status === ProjectStatus.ACTIVE) {
      await this.siteVisits.assertPaidVisitForQuote(id);
      const approved = await this.prisma.quotation.findFirst({
        where: {
          projectId: id,
          status: QuotationStatus.ACCEPTED,
          mdApprovedAt: { not: null },
        },
      });
      if (!approved) {
        throw new BadRequestException(
          'Cannot open the project file without a paid site visit and an MD-approved quotation. Use Open a project: site visit → quote → client agrees → MD opens the file.',
        );
      }
    }

    const existing = await this.prisma.project.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Project not found');

    const locationTouched =
      dto.locationLat !== undefined || dto.locationLng !== undefined || dto.address !== undefined;
    const settingCoords =
      dto.locationLat !== undefined || dto.locationLng !== undefined;
    if (settingCoords) {
      const allowed =
        existing.status === ProjectStatus.ACTIVE ||
        dto.status === ProjectStatus.ACTIVE;
      if (!allowed) {
        throw new BadRequestException(
          'Site coordinates are captured after the project file is opened (MD-approved quotation), not at site visit or while the project is still a draft/quote.',
        );
      }
    }

    const project = await this.prisma.project.update({
      where: { id },
      data: dto,
      include: {
        stages: true,
        rooms: true,
        client: true,
        standPackage: { select: { id: true, code: true, name: true, accountMode: true } },
      },
    });

    // Company stand packages share one site GPS: sync to every stand in the package
    if (locationTouched && existing.standPackageId) {
      await this.prisma.project.updateMany({
        where: { standPackageId: existing.standPackageId },
        data: {
          ...(dto.locationLat !== undefined ? { locationLat: dto.locationLat } : {}),
          ...(dto.locationLng !== undefined ? { locationLng: dto.locationLng } : {}),
          ...(dto.locationNotes !== undefined ? { locationNotes: dto.locationNotes } : {}),
          ...(dto.address !== undefined ? { address: dto.address } : {}),
        },
      });
      await this.prisma.standPackage.update({
        where: { id: existing.standPackageId },
        data: {
          ...(dto.locationLat !== undefined ? { locationLat: dto.locationLat } : {}),
          ...(dto.locationLng !== undefined ? { locationLng: dto.locationLng } : {}),
          ...(dto.locationNotes !== undefined ? { locationNotes: dto.locationNotes } : {}),
          ...(dto.address !== undefined ? { address: dto.address } : {}),
        },
      });
    }

    return serializeMoney(project);
  }

  async addRoom(projectId: string, room: RoomInput) {
    await this.prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    const created = await this.prisma.projectRoom.create({
      data: {
        projectId,
        roomType: room.roomType,
        label: room.label,
        quantity: room.quantity ?? 1,
        floorLevel: room.floorLevel,
        notes: room.notes,
      },
    });

    const field =
      room.roomType === RoomType.BEDROOM
        ? 'bedrooms'
        : room.roomType === RoomType.BATHROOM
          ? 'bathrooms'
          : room.roomType === RoomType.KITCHEN
            ? 'kitchens'
            : room.roomType === RoomType.LOUNGE
              ? 'lounges'
              : 'otherRooms';
    await this.prisma.project.update({
      where: { id: projectId },
      data: { [field]: { increment: room.quantity ?? 1 } },
    });

    return created;
  }

  async addStage(projectId: string, name: string, labourCents = 0) {
    const max = await this.prisma.projectStage.aggregate({
      where: { projectId },
      _max: { sortOrder: true },
    });
    const stage = await this.prisma.projectStage.create({
      data: {
        projectId,
        name,
        labourCents,
        sortOrder: (max._max.sortOrder || 0) + 1,
      },
    });
    return serializeMoney(stage);
  }

  async completeStage(projectId: string, stageId: string, completed = true) {
    const stage = await this.prisma.projectStage.findFirst({
      where: { id: stageId, projectId },
    });
    if (!stage) throw new NotFoundException('Stage not found');
    const updated = await this.prisma.projectStage.update({
      where: { id: stageId },
      data: {
        isCompleted: completed,
        completedAt: completed ? new Date() : null,
        actualStartAt: completed && !stage.actualStartAt ? new Date() : stage.actualStartAt,
      },
    });
    return serializeMoney(updated);
  }

  async updateStagePlan(
    projectId: string,
    stageId: string,
    data: { plannedStartAt?: string | null; plannedEndAt?: string | null; actualStartAt?: string | null },
  ) {
    const stage = await this.prisma.projectStage.findFirst({
      where: { id: stageId, projectId },
    });
    if (!stage) throw new NotFoundException('Stage not found');

    const plannedStartAt =
      data.plannedStartAt === undefined
        ? undefined
        : data.plannedStartAt
          ? new Date(data.plannedStartAt)
          : null;
    const plannedEndAt =
      data.plannedEndAt === undefined
        ? undefined
        : data.plannedEndAt
          ? new Date(data.plannedEndAt)
          : null;
    const actualStartAt =
      data.actualStartAt === undefined
        ? undefined
        : data.actualStartAt
          ? new Date(data.actualStartAt)
          : null;

    if (plannedStartAt && plannedEndAt && plannedEndAt < plannedStartAt) {
      throw new BadRequestException('Stage planned end must be on or after planned start');
    }

    const updated = await this.prisma.projectStage.update({
      where: { id: stageId },
      data: {
        ...(plannedStartAt !== undefined ? { plannedStartAt } : {}),
        ...(plannedEndAt !== undefined ? { plannedEndAt } : {}),
        ...(actualStartAt !== undefined ? { actualStartAt } : {}),
      },
    });
    return serializeMoney(updated);
  }

  async updateProjectPlan(
    projectId: string,
    data: { plannedStartAt?: string | null; plannedEndAt?: string | null },
  ) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Project not found');

    const plannedStartAt =
      data.plannedStartAt === undefined
        ? undefined
        : data.plannedStartAt
          ? new Date(data.plannedStartAt)
          : null;
    const plannedEndAt =
      data.plannedEndAt === undefined
        ? undefined
        : data.plannedEndAt
          ? new Date(data.plannedEndAt)
          : null;

    if (plannedStartAt && plannedEndAt && plannedEndAt < plannedStartAt) {
      throw new BadRequestException('Project planned end must be on or after planned start');
    }

    return serializeMoney(
      await this.prisma.project.update({
        where: { id: projectId },
        data: {
          ...(plannedStartAt !== undefined ? { plannedStartAt } : {}),
          ...(plannedEndAt !== undefined ? { plannedEndAt } : {}),
        },
        include: {
          client: true,
          stages: { orderBy: { sortOrder: 'asc' } },
        },
      }),
    );
  }

  private daysBetween(a: Date, b: Date) {
    return Math.round((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));
  }

  async scheduleOverview() {
    const now = new Date();
    const projects = await this.prisma.project.findMany({
      where: {
        status: {
          in: [
            ProjectStatus.DRAFT,
            ProjectStatus.ACTIVE,
            ProjectStatus.ON_HOLD,
            ProjectStatus.QUOTED,
          ],
        },
      },
      include: {
        client: { select: { id: true, name: true } },
        stages: { orderBy: { sortOrder: 'asc' } },
        siteVisits: {
          where: { status: { not: SiteVisitStatus.CANCELLED } },
          orderBy: { scheduledAt: 'asc' },
          select: {
            id: true,
            code: true,
            status: true,
            scheduledAt: true,
            feeCents: true,
            address: true,
          },
        },
        assignments: {
          include: {
            employee: {
              select: { id: true, fullName: true, roleTitle: true, phone: true, isActive: true },
            },
          },
          orderBy: { startDate: 'asc' },
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    });

    return projects.map((p) => {
      const stages = p.stages.map((s) => {
        let daysBehind = 0;
        let status: 'DONE' | 'ON_TRACK' | 'LAGGING' | 'UNPLANNED' = 'UNPLANNED';
        if (s.isCompleted) status = 'DONE';
        else if (s.plannedEndAt) {
          daysBehind = Math.max(0, this.daysBetween(now, s.plannedEndAt));
          status = daysBehind > 0 ? 'LAGGING' : 'ON_TRACK';
        }
        return {
          id: s.id,
          name: s.name,
          sortOrder: s.sortOrder,
          isCompleted: s.isCompleted,
          plannedStartAt: s.plannedStartAt,
          plannedEndAt: s.plannedEndAt,
          actualStartAt: s.actualStartAt,
          completedAt: s.completedAt,
          daysBehind,
          status,
        };
      });

      const laggingStages = stages.filter((s) => s.status === 'LAGGING');
      let projectDaysBehind = 0;
      let projectStatus: 'DONE' | 'ON_TRACK' | 'LAGGING' | 'UNPLANNED' = 'UNPLANNED';
      if (p.status === ProjectStatus.COMPLETED) projectStatus = 'DONE';
      else if (p.plannedEndAt) {
        projectDaysBehind = Math.max(0, this.daysBetween(now, p.plannedEndAt));
        projectStatus = projectDaysBehind > 0 ? 'LAGGING' : 'ON_TRACK';
      } else if (laggingStages.length) {
        projectDaysBehind = Math.max(...laggingStages.map((s) => s.daysBehind));
        projectStatus = 'LAGGING';
      } else if (stages.some((s) => s.status === 'ON_TRACK' || s.status === 'DONE')) {
        projectStatus = 'ON_TRACK';
      }

      return serializeMoney({
        id: p.id,
        code: p.code,
        name: p.name,
        status: p.status,
        client: p.client,
        plannedStartAt: p.plannedStartAt,
        plannedEndAt: p.plannedEndAt,
        projectDaysBehind,
        projectStatus,
        laggingStageCount: laggingStages.length,
        stages,
        siteVisits: p.siteVisits,
        people: p.assignments.map((a) => ({
          assignmentId: a.id,
          employeeId: a.employee.id,
          fullName: a.employee.fullName,
          roleTitle: a.employee.roleTitle,
          phone: a.employee.phone,
          isActive: a.employee.isActive,
          startDate: a.startDate,
          endDate: a.endDate,
          daysWorked: Number(a.daysWorked),
          dailyWageCents: a.dailyWageCents,
          notes: a.notes,
        })),
      });
    });
  }

  async laggingProjects() {
    const all = await this.scheduleOverview();
    return all
      .filter((p) => p.projectStatus === 'LAGGING')
      .sort((a, b) => b.projectDaysBehind - a.projectDaysBehind);
  }

  async needsLocation() {
    const projects = await this.prisma.project.findMany({
      where: {
        // GPS only after the site/file is opened (MD-approved quotation → ACTIVE)
        status: ProjectStatus.ACTIVE,
        OR: [{ locationLat: null }, { locationLng: null }],
      },
      select: {
        id: true,
        code: true,
        name: true,
        status: true,
        address: true,
        standNumber: true,
        standPackageId: true,
        createdAt: true,
        client: { select: { id: true, name: true } },
        standPackage: {
          select: {
            id: true,
            code: true,
            name: true,
            standCount: true,
            _count: { select: { projects: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    // One GPS notice per stand package (shared site), plus single projects
    const seenPackages = new Set<string>();
    const notices = [];
    for (const p of projects) {
      if (p.standPackageId) {
        if (seenPackages.has(p.standPackageId)) continue;
        seenPackages.add(p.standPackageId);
        const count = p.standPackage?._count.projects || p.standPackage?.standCount || 1;
        notices.push({
          ...p,
          title: 'Assign site coordinates',
          message: `${p.standPackage?.name || p.name}: ${count} projects share this site`,
          projectCount: count,
        });
        continue;
      }
      notices.push({
        ...p,
        title: 'Assign site coordinates',
        message: `Capture GPS for ${p.name}`,
        projectCount: 1,
      });
    }
    return notices.slice(0, 50);
  }

  async mapMarkers(view: 'all' | 'running' | 'finished' | 'showcase' = 'showcase') {
    const statusFilter =
      view === 'running'
        ? { in: [ProjectStatus.ACTIVE, ProjectStatus.QUOTED, ProjectStatus.ON_HOLD] }
        : view === 'finished'
          ? { in: [ProjectStatus.COMPLETED] }
          : view === 'showcase'
            ? { in: [ProjectStatus.ACTIVE, ProjectStatus.COMPLETED, ProjectStatus.QUOTED] }
            : undefined;

    const projects = await this.prisma.project.findMany({
      where: {
        locationLat: { not: null },
        locationLng: { not: null },
        ...(statusFilter ? { status: statusFilter } : { status: { not: ProjectStatus.CANCELLED } }),
      },
      select: {
        id: true,
        code: true,
        name: true,
        status: true,
        address: true,
        propertyType: true,
        standNumber: true,
        locationLat: true,
        locationLng: true,
        client: { select: { id: true, name: true, type: true } },
        standPackage: { select: { id: true, name: true, code: true } },
      },
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
    });
    return projects;
  }

  async geocode(query: string) {
    const q = query.trim();
    if (!q) throw new BadRequestException('Search text is required');
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('q', q);
    url.searchParams.set('format', 'json');
    url.searchParams.set('limit', '5');
    const res = await fetch(url.toString(), {
      headers: {
        'User-Agent': 'NomchaelConstructionERP/1.0 (project-map)',
        Accept: 'application/json',
      },
    });
    if (!res.ok) throw new BadRequestException('Could not look up that place right now');
    const rows = (await res.json()) as Array<{
      display_name: string;
      lat: string;
      lon: string;
    }>;
    return rows.map((r) => ({
      label: r.display_name,
      locationLat: Number(r.lat),
      locationLng: Number(r.lon),
    }));
  }
}

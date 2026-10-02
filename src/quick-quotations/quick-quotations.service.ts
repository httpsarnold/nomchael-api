import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { PrismaService } from '../prisma/prisma.service';
import { serializeMoney } from '../common/money';
import { NOMCHAEL_LOGO_PNG } from '../common/logo';

export type QuickQuotationMaterialInput = {
  quantity?: number | null;
  unit?: string;
  description: string;
  unitPriceCents?: number | null;
  totalCents?: number | null;
};

export type QuickQuotationLabourInput = {
  description: string;
  amountCents: number;
};

export type QuickQuotationSectionInput = {
  name?: string;
  materials?: QuickQuotationMaterialInput[];
  labour?: QuickQuotationLabourInput[];
};

export type QuickQuotationInput = {
  clientName: string;
  clientPhone?: string;
  clientAddress?: string;
  title?: string;
  subject?: string;
  quoteDate?: string;
  preparedBy?: string;
  notes?: string;
  validUntil?: string;
  discountCents?: number;
  sections: QuickQuotationSectionInput[];
};

const COMPANY = {
  tagline1: 'Specialists in Construction, Plumbing, Electrical works, Equipment Hire,',
  tagline2: '& General Maintenance',
  address: ['16 Slot Pleasant Valley', 'Tynwald South', 'Harare'],
  phones: ['+263 772 737 955', '+263 776 672 342'],
};

const NAVY = '#1f3864';

const DETAIL_INCLUDE = {
  sections: {
    orderBy: { sortOrder: 'asc' as const },
    include: {
      items: { orderBy: [{ kind: 'asc' as const }, { sortOrder: 'asc' as const }] },
    },
  },
};

type PreparedSection = {
  sortOrder: number;
  name: string;
  materialsTotalCents: bigint;
  labourTotalCents: bigint;
  items: {
    kind: 'MATERIAL' | 'LABOUR';
    sortOrder: number;
    description: string;
    unit: string | null;
    quantity: number | null;
    unitPriceCents: bigint | null;
    totalCents: bigint;
  }[];
};

function optionalNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

@Injectable()
export class QuickQuotationsService {
  constructor(private prisma: PrismaService) {}

  private async nextNumber() {
    const counter = await this.prisma.counter.upsert({
      where: { id: 'quick-quotation' },
      create: { id: 'quick-quotation', value: 1 },
      update: { value: { increment: 1 } },
    });
    return `QQ-${String(counter.value).padStart(5, '0')}`;
  }

  private prepare(dto: QuickQuotationInput) {
    const clientName = dto.clientName?.trim();
    if (!clientName) throw new BadRequestException('Customer name is required');

    const sections: PreparedSection[] = [];
    (dto.sections || []).forEach((s, sIdx) => {
      const label = s.name?.trim() || `Section ${sIdx + 1}`;
      const items: PreparedSection['items'] = [];
      let materials = 0;
      let labour = 0;

      (s.materials || [])
        .filter((m) => m.description?.trim())
        .forEach((m, idx) => {
          const quantity = optionalNumber(m.quantity);
          const unitPrice = optionalNumber(m.unitPriceCents);
          const lump = optionalNumber(m.totalCents);
          if (quantity !== null && quantity < 0) {
            throw new BadRequestException(`${label}, material ${idx + 1}: quantity cannot be negative`);
          }
          if ((unitPrice !== null && unitPrice < 0) || (lump !== null && lump < 0)) {
            throw new BadRequestException(`${label}, material ${idx + 1}: cost cannot be negative`);
          }
          const total =
            quantity !== null && unitPrice !== null
              ? Math.round(quantity * unitPrice)
              : Math.round(lump ?? 0);
          materials += total;
          items.push({
            kind: 'MATERIAL',
            sortOrder: idx,
            description: m.description.trim(),
            unit: m.unit?.trim() || null,
            quantity,
            unitPriceCents: unitPrice !== null ? BigInt(Math.round(unitPrice)) : null,
            totalCents: BigInt(total),
          });
        });

      (s.labour || [])
        .filter((l) => l.description?.trim())
        .forEach((l, idx) => {
          const amount = Math.round(Number(l.amountCents) || 0);
          if (amount < 0) {
            throw new BadRequestException(`${label}, labour ${idx + 1}: amount cannot be negative`);
          }
          labour += amount;
          items.push({
            kind: 'LABOUR',
            sortOrder: idx,
            description: l.description.trim(),
            unit: null,
            quantity: null,
            unitPriceCents: null,
            totalCents: BigInt(amount),
          });
        });

      if (!items.length && !s.name?.trim()) return;
      sections.push({
        sortOrder: sections.length,
        name: s.name?.trim() || '',
        materialsTotalCents: BigInt(materials),
        labourTotalCents: BigInt(labour),
        items,
      });
    });

    if (!sections.some((s) => s.items.length)) {
      throw new BadRequestException('Add at least one material or labour line');
    }

    const materialsTotal = sections.reduce((t, s) => t + Number(s.materialsTotalCents), 0);
    const labourTotal = sections.reduce((t, s) => t + Number(s.labourTotalCents), 0);
    const subtotal = materialsTotal + labourTotal;
    const discount = Math.min(Math.max(0, Math.round(dto.discountCents || 0)), subtotal);

    return {
      header: {
        clientName,
        clientPhone: dto.clientPhone?.trim() || null,
        clientAddress: dto.clientAddress?.trim() || null,
        title: dto.title?.trim() || null,
        subject: dto.subject?.trim() || 'BILL OF QUANTITIES',
        quoteDate: dto.quoteDate ? new Date(dto.quoteDate) : new Date(),
        preparedBy: dto.preparedBy?.trim() || null,
        notes: dto.notes?.trim() || null,
        validUntil: dto.validUntil ? new Date(dto.validUntil) : null,
        materialsTotalCents: BigInt(materialsTotal),
        labourTotalCents: BigInt(labourTotal),
        subtotalCents: BigInt(subtotal),
        discountCents: BigInt(discount),
        totalCents: BigInt(subtotal - discount),
      },
      sections,
    };
  }

  private async writeSections(quickQuotationId: string, sections: PreparedSection[]) {
    for (const s of sections) {
      const { items, ...data } = s;
      const section = await this.prisma.quickQuotationSection.create({
        data: { ...data, quickQuotationId },
      });
      if (items.length) {
        await this.prisma.quickQuotationItem.createMany({
          data: items.map((i) => ({ ...i, quickQuotationId, sectionId: section.id })),
        });
      }
    }
  }

  async list(search?: string) {
    const q = search?.trim();
    const rows = await this.prisma.quickQuotation.findMany({
      where: q
        ? {
            OR: [
              { clientName: { contains: q, mode: 'insensitive' } },
              { number: { contains: q, mode: 'insensitive' } },
              { title: { contains: q, mode: 'insensitive' } },
            ],
          }
        : undefined,
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { _count: { select: { items: true, sections: true } } },
    });
    return serializeMoney(rows);
  }

  async get(id: string) {
    const row = await this.prisma.quickQuotation.findUnique({
      where: { id },
      include: DETAIL_INCLUDE,
    });
    if (!row) throw new NotFoundException('Quotation not found');
    return serializeMoney(row);
  }

  async create(dto: QuickQuotationInput, createdById?: string) {
    const { header, sections } = this.prepare(dto);
    const number = await this.nextNumber();
    const created = await this.prisma.quickQuotation.create({
      data: { ...header, number, createdById },
    });
    await this.writeSections(created.id, sections);
    return this.get(created.id);
  }

  async update(id: string, dto: QuickQuotationInput) {
    const existing = await this.prisma.quickQuotation.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Quotation not found');
    const { header, sections } = this.prepare(dto);
    await this.prisma.quickQuotationItem.deleteMany({ where: { quickQuotationId: id } });
    await this.prisma.quickQuotationSection.deleteMany({ where: { quickQuotationId: id } });
    await this.prisma.quickQuotation.update({ where: { id }, data: header });
    await this.writeSections(id, sections);
    return this.get(id);
  }

  async remove(id: string) {
    await this.prisma.quickQuotation.delete({ where: { id } }).catch(() => {
      throw new NotFoundException('Quotation not found');
    });
    return { ok: true };
  }

  async buildPdf(id: string): Promise<{ buffer: Buffer; filename: string }> {
    const q = await this.prisma.quickQuotation.findUnique({
      where: { id },
      include: DETAIL_INCLUDE,
    });
    if (!q) throw new NotFoundException('Quotation not found');

    const amount = (cents: bigint | number) =>
      (Number(cents) / 100).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    const longDate = (d: Date) =>
      d.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'Africa/Harare',
      });
    const unitText = (u: string) => u.replace(/\bm3\b/gi, 'm³').replace(/\bm2\b/gi, 'm²');
    const qtyText = (n: number | null, unit: string | null) => {
      const num =
        n === null
          ? ''
          : Number.isInteger(n)
            ? String(n)
            : n.toLocaleString('en-US', { maximumFractionDigits: 3 });
      if (!unit) return num;
      const u = unitText(unit);
      return num && !/^[a-zA-Z³²]+$/.test(u) ? `${num} ${u}` : `${num}${u}`;
    };

    const buffer = await new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ margin: 48, size: 'A4' });
      const chunks: Buffer[] = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const left = doc.page.margins.left;
      const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const bottom = doc.page.height - doc.page.margins.bottom;
      let y = 36;

      const logoH = 64;
      const logoW = 120;
      doc.image(NOMCHAEL_LOGO_PNG, left + (width - logoW) / 2, y, {
        fit: [logoW, logoH],
        align: 'center',
      });
      y += logoH + 6;
      doc.font('Times-Bold').fontSize(11).fillColor(NAVY);
      doc.text(COMPANY.tagline1, left, y, { width, align: 'center' });
      y += 13;
      doc.text(COMPANY.tagline2, left, y, { width, align: 'center' });
      y += 14;

      doc.font('Times-Roman').fontSize(10).fillColor('#334155');
      COMPANY.address.forEach((line, i) => doc.text(line, left, y + i * 12, { width: width / 2 }));
      doc.fontSize(12);
      COMPANY.phones.forEach((line, i) =>
        doc.text(line, left + width / 2, y + 10 + i * 16, { width: width / 2, align: 'right' }),
      );
      y += 50;
      doc.moveTo(left, y).lineTo(left + width, y).lineWidth(1.6).strokeColor('#000').stroke();
      doc.lineWidth(1);
      y += 20;

      doc.font('Helvetica-Bold').fontSize(10).fillColor('#000');
      const headerLine = (text: string, underline = false) => {
        doc.text(text, left, y, { width, underline });
        y += doc.heightOfString(text, { width }) + 10;
      };
      headerLine(`Date: ${longDate(q.quoteDate)}`);
      headerLine(`Customer: ${q.clientName}`);
      doc.font('Helvetica').fontSize(9.5);
      const extras = [
        q.clientPhone ? `Phone: ${q.clientPhone}` : null,
        q.clientAddress ? `Address: ${q.clientAddress}` : null,
        q.title ? `Project: ${q.title}` : null,
        q.validUntil ? `Valid until: ${longDate(q.validUntil)}` : null,
      ].filter(Boolean) as string[];
      if (extras.length) {
        extras.forEach((t) => {
          doc.text(t, left, y, { width });
          y += 13;
        });
        y += 6;
      }
      doc.font('Helvetica-Bold').fontSize(10);
      headerLine(`RE: ${q.subject}`, true);
      y -= 2;

      const cols = [
        { w: 66, align: 'left' as const },
        { w: width - 66 - 82 - 88, align: 'left' as const },
        { w: 82, align: 'right' as const },
        { w: 88, align: 'right' as const },
      ];
      const pad = 3;
      const rowH = (cells: string[], bold: boolean) => {
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
        return (
          Math.max(
            14,
            ...cells.map((c, i) => doc.heightOfString(c || ' ', { width: cols[i].w - pad * 2 })),
          ) +
          pad * 2 -
          2
        );
      };
      const drawRow = (cells: string[], opts: { bold?: boolean[] | boolean } = {}) => {
        const boldAt = (i: number) =>
          Array.isArray(opts.bold) ? !!opts.bold[i] : !!opts.bold;
        const h = rowH(cells, boldAt(1) || boldAt(3));
        if (y + h > bottom) {
          doc.addPage();
          y = 48;
        }
        let x = left;
        cells.forEach((c, i) => {
          doc.rect(x, y, cols[i].w, h).strokeColor('#000').lineWidth(0.6).stroke();
          if (c) {
            doc
              .font(boldAt(i) ? 'Helvetica-Bold' : 'Helvetica')
              .fontSize(9)
              .fillColor('#000')
              .text(c, x + pad, y + pad, { width: cols[i].w - pad * 2, align: cols[i].align });
          }
          x += cols[i].w;
        });
        y += h;
      };

      drawRow(['Qty', 'Description', 'Unit Cost\n(US$)', 'Total Cost\n(US$)'], { bold: true });

      for (const s of q.sections) {
        const materials = s.items.filter((i) => i.kind === 'MATERIAL');
        const labour = s.items.filter((i) => i.kind === 'LABOUR');
        if (s.name) drawRow(['', s.name, '', ''], { bold: [false, true] });
        for (const m of materials) {
          drawRow([
            qtyText(m.quantity, m.unit),
            m.description,
            m.unitPriceCents !== null ? amount(m.unitPriceCents) : '',
            m.totalCents > 0n || m.unitPriceCents !== null ? amount(m.totalCents) : '',
          ]);
        }
        if (materials.length) {
          const priced = materials.some((m) => m.unitPriceCents !== null || m.totalCents > 0n);
          drawRow(['', 'Total Material Cost', '', priced ? amount(s.materialsTotalCents) : ''], {
            bold: [false, true, false, true],
          });
        }
        if (labour.length) {
          if (materials.length) drawRow(['', '', '', '']);
          drawRow(['', 'Labour', '', ''], { bold: [false, true] });
          for (const l of labour) drawRow(['', l.description, '', amount(l.totalCents)]);
          drawRow(['', 'Total Labour Cost', '', amount(s.labourTotalCents)], {
            bold: [false, true, false, true],
          });
        }
        drawRow(['', '', '', '']);
      }

      y += 18;
      const ensure = (h: number) => {
        if (y + h > bottom) {
          doc.addPage();
          y = 48;
        }
      };
      const summary = (label: string, value: string) => {
        ensure(18);
        doc.font('Helvetica-Bold').fontSize(10).fillColor('#000');
        doc.text(`${label} US$${value}`, left, y, { width });
        y += 18;
      };
      if (Number(q.materialsTotalCents) > 0) {
        summary('Total material cost for the whole house', amount(q.materialsTotalCents));
      }
      if (Number(q.labourTotalCents) > 0) summary('Total Labour Cost', amount(q.labourTotalCents));
      if (Number(q.discountCents) > 0) summary('Less discount', amount(q.discountCents));
      if (Number(q.materialsTotalCents) > 0 && Number(q.labourTotalCents) > 0) {
        summary('Grand Total', amount(q.totalCents));
      } else if (Number(q.discountCents) > 0) {
        summary('Total', amount(q.totalCents));
      }

      if (q.notes) {
        y += 8;
        ensure(40);
        doc.font('Helvetica-Bold').fontSize(10).text('Notes:', left, y, { width });
        y += 14;
        doc.font('Helvetica').fontSize(9.5).text(q.notes, left, y, { width });
        y += doc.heightOfString(q.notes, { width }) + 6;
      }

      y += 20;
      ensure(20);
      doc
        .font('Helvetica-Bold')
        .fontSize(10)
        .fillColor('#000')
        .text(`Prepared by: ${q.preparedBy || '……………………………………'}`, left, y, { width });

      doc.end();
    });

    const safeName = q.clientName.replace(/[^\w.\-]+/g, '_').slice(0, 40);
    return { buffer, filename: `${q.number}-${safeName}.pdf` };
  }
}

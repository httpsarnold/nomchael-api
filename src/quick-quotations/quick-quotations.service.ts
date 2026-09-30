import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import PDFDocument from 'pdfkit';
import { PrismaService } from '../prisma/prisma.service';
import { serializeMoney } from '../common/money';

export type QuickQuotationItemInput = {
  description: string;
  unit?: string;
  quantity: number;
  unitPriceCents: number;
};

export type QuickQuotationInput = {
  clientName: string;
  clientPhone?: string;
  clientAddress?: string;
  title?: string;
  notes?: string;
  validUntil?: string;
  discountCents?: number;
  items: QuickQuotationItemInput[];
};

@Injectable()
export class QuickQuotationsService {
  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

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
    if (!clientName) throw new BadRequestException('Client name is required');
    const items = (dto.items || [])
      .filter((i) => i.description?.trim())
      .map((i, idx) => {
        const quantity = Number(i.quantity);
        const unitPriceCents = Math.round(Number(i.unitPriceCents));
        if (!Number.isFinite(quantity) || quantity <= 0) {
          throw new BadRequestException(`Line ${idx + 1}: quantity must be more than 0`);
        }
        if (!Number.isFinite(unitPriceCents) || unitPriceCents < 0) {
          throw new BadRequestException(`Line ${idx + 1}: unit price cannot be negative`);
        }
        return {
          sortOrder: idx + 1,
          description: i.description.trim(),
          unit: i.unit?.trim() || null,
          quantity,
          unitPriceCents: BigInt(unitPriceCents),
          totalCents: BigInt(Math.round(quantity * unitPriceCents)),
        };
      });
    if (!items.length) throw new BadRequestException('Add at least one item');
    const subtotal = items.reduce((s, i) => s + Number(i.totalCents), 0);
    const discount = Math.min(Math.max(0, Math.round(dto.discountCents || 0)), subtotal);
    return {
      header: {
        clientName,
        clientPhone: dto.clientPhone?.trim() || null,
        clientAddress: dto.clientAddress?.trim() || null,
        title: dto.title?.trim() || null,
        notes: dto.notes?.trim() || null,
        validUntil: dto.validUntil ? new Date(dto.validUntil) : null,
        subtotalCents: BigInt(subtotal),
        discountCents: BigInt(discount),
        totalCents: BigInt(subtotal - discount),
      },
      items,
    };
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
      include: { _count: { select: { items: true } } },
    });
    return serializeMoney(rows);
  }

  async get(id: string) {
    const row = await this.prisma.quickQuotation.findUnique({
      where: { id },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!row) throw new NotFoundException('Quotation not found');
    return serializeMoney(row);
  }

  async create(dto: QuickQuotationInput, createdById?: string) {
    const { header, items } = this.prepare(dto);
    const number = await this.nextNumber();
    const created = await this.prisma.quickQuotation.create({
      data: { ...header, number, createdById, items: { create: items } },
    });
    return this.get(created.id);
  }

  async update(id: string, dto: QuickQuotationInput) {
    const existing = await this.prisma.quickQuotation.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Quotation not found');
    const { header, items } = this.prepare(dto);
    await this.prisma.$transaction([
      this.prisma.quickQuotationItem.deleteMany({ where: { quickQuotationId: id } }),
      this.prisma.quickQuotation.update({
        where: { id },
        data: { ...header, items: { create: items } },
      }),
    ]);
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
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!q) throw new NotFoundException('Quotation not found');
    const company = this.config.get('COMPANY_NAME') || 'Nomchael Construction';
    const currency = this.config.get('CURRENCY') || 'USD';
    const money = (cents: bigint | number) =>
      `${currency} ${(Number(cents) / 100).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
    const day = (d: Date) => d.toISOString().slice(0, 10);
    const qty = (n: number) =>
      Number.isInteger(n) ? String(n) : n.toLocaleString('en-US', { maximumFractionDigits: 3 });

    const buffer = await new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ margin: 48, size: 'A4' });
      const chunks: Buffer[] = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const left = doc.page.margins.left;
      const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const bottom = doc.page.height - doc.page.margins.bottom;
      let y = 48;

      doc.fontSize(18).fillColor('#0f172a').text(company, left, y);
      doc.fontSize(20).fillColor('#b45309').text('QUOTATION', left, y, { width, align: 'right' });
      y += 30;
      doc.moveTo(left, y).lineTo(left + width, y).strokeColor('#e5e7eb').stroke();
      y += 14;

      const colW = width / 2 - 10;
      const startY = y;
      doc.fontSize(8).fillColor('#64748b').text('QUOTED TO', left, y);
      y += 12;
      doc.fontSize(11).fillColor('#0f172a').text(q.clientName, left, y, { width: colW });
      y += 15;
      doc.fontSize(9).fillColor('#334155');
      if (q.clientPhone) {
        doc.text(q.clientPhone, left, y, { width: colW });
        y += 13;
      }
      if (q.clientAddress) {
        doc.text(q.clientAddress, left, y, { width: colW });
        y += doc.heightOfString(q.clientAddress, { width: colW }) + 2;
      }

      let ry = startY;
      const meta = (label: string, value: string) => {
        doc.fontSize(9).fillColor('#64748b').text(label, left + width / 2 + 10, ry, { width: 90 });
        doc.fillColor('#0f172a').text(value, left + width / 2 + 100, ry, {
          width: colW - 90,
          align: 'right',
        });
        ry += 14;
      };
      meta('Quotation no.', q.number);
      meta('Date', day(q.createdAt));
      if (q.validUntil) meta('Valid until', day(q.validUntil));
      y = Math.max(y, ry) + 10;

      if (q.title) {
        doc.fontSize(11).fillColor('#0f172a').text(q.title, left, y, { width });
        y += doc.heightOfString(q.title, { width }) + 8;
      }

      const cols = [
        { label: '#', w: 24, align: 'left' as const },
        { label: 'Description', w: width - 24 - 60 - 50 - 90 - 95, align: 'left' as const },
        { label: 'Qty', w: 60, align: 'right' as const },
        { label: 'Unit', w: 50, align: 'left' as const },
        { label: 'Unit price', w: 90, align: 'right' as const },
        { label: 'Amount', w: 95, align: 'right' as const },
      ];
      const pad = 4;
      const drawHeader = () => {
        doc.rect(left, y, width, 20).fill('#f1f5f9');
        let x = left;
        doc.fontSize(8).fillColor('#334155');
        for (const c of cols) {
          doc.text(c.label, x + pad, y + 6, { width: c.w - pad * 2, align: c.align });
          x += c.w;
        }
        y += 20;
      };
      drawHeader();

      q.items.forEach((item, idx) => {
        const cells = [
          String(idx + 1),
          item.description,
          qty(item.quantity),
          item.unit || '',
          money(item.unitPriceCents),
          money(item.totalCents),
        ];
        doc.fontSize(9);
        const h =
          Math.max(
            ...cells.map((c, i) => doc.heightOfString(c || ' ', { width: cols[i].w - pad * 2 })),
          ) +
          pad * 2;
        if (y + h > bottom - 90) {
          doc.addPage();
          y = 48;
          drawHeader();
        }
        let x = left;
        doc.fillColor('#0f172a');
        cells.forEach((c, i) => {
          doc.text(c, x + pad, y + pad, { width: cols[i].w - pad * 2, align: cols[i].align });
          x += cols[i].w;
        });
        y += h;
        doc.moveTo(left, y).lineTo(left + width, y).strokeColor('#e5e7eb').stroke();
      });

      y += 12;
      if (y > bottom - 90) {
        doc.addPage();
        y = 48;
      }
      const totalLine = (label: string, value: string, strong = false) => {
        doc
          .fontSize(strong ? 12 : 9)
          .fillColor(strong ? '#0f172a' : '#64748b')
          .text(label, left + width - 280, y, { width: 150, align: 'right' });
        doc
          .fillColor('#0f172a')
          .text(value, left + width - 125, y, { width: 125, align: 'right' });
        y += strong ? 20 : 15;
      };
      if (Number(q.discountCents) > 0) {
        totalLine('Subtotal', money(q.subtotalCents));
        totalLine('Discount', `- ${money(q.discountCents)}`);
      }
      totalLine('TOTAL', money(q.totalCents), true);

      if (q.notes) {
        y += 10;
        if (y > bottom - 40) {
          doc.addPage();
          y = 48;
        }
        doc.fontSize(8).fillColor('#64748b').text('NOTES', left, y);
        y += 12;
        doc.fontSize(9).fillColor('#334155').text(q.notes, left, y, { width });
      }

      doc.end();
    });

    const safeName = q.clientName.replace(/[^\w.\-]+/g, '_').slice(0, 40);
    return { buffer, filename: `${q.number}-${safeName}.pdf` };
  }
}

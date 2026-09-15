import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ShortfallStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { serializeMoney } from '../common/money';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ShortfallsService {
  constructor(
    private prisma: PrismaService,
    private whatsapp: WhatsappService,
    private config: ConfigService,
  ) {}

  async create(projectId: string, amountCents: number, reason: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Project not found');
    const shortfall = await this.prisma.shortfall.create({
      data: { projectId, amountCents: BigInt(amountCents), reason },
      include: { project: { include: { client: true } } },
    });
    await this.prisma.auditLog.create({
      data: {
        action: 'SHORTFALL_CREATE',
        entityType: 'Shortfall',
        entityId: shortfall.id,
        metadata: { amountCents, projectId },
      },
    });
    return serializeMoney(shortfall);
  }

  async findAll() {
    const list = await this.prisma.shortfall.findMany({
      include: { project: { include: { client: true } }, approvedBy: true, invoice: true },
      orderBy: { createdAt: 'desc' },
    });
    return list.map((s) => serializeMoney(s));
  }

  async approve(id: string, approver: { id: string; role: UserRole }, approve: boolean, rejectionReason?: string) {
    if (
      approver.role !== UserRole.MANAGING_DIRECTOR &&
      approver.role !== UserRole.SUPER_ADMIN
    ) {
      throw new ForbiddenException('Managing Director approval required');
    }
    const shortfall = await this.prisma.shortfall.findUnique({
      where: { id },
      include: { project: { include: { client: true } } },
    });
    if (!shortfall) throw new NotFoundException('Shortfall not found');
    if (shortfall.status !== ShortfallStatus.PENDING) {
      throw new BadRequestException('Shortfall already processed');
    }

    if (!approve) {
      const rejected = await this.prisma.shortfall.update({
        where: { id },
        data: {
          status: ShortfallStatus.REJECTED,
          approvedById: approver.id,
          approvedAt: new Date(),
          rejectionReason,
        },
        include: { project: { include: { client: true } } },
      });
      return serializeMoney(rejected);
    }

    const invCounter = await this.prisma.counter.upsert({
      where: { id: 'invoice' },
      create: { id: 'invoice', value: 1 },
      update: { value: { increment: 1 } },
    });
    const invoiceNumber = `INV-${String(invCounter.value).padStart(6, '0')}`;
    const invoice = await this.prisma.invoice.create({
      data: {
        projectId: shortfall.projectId,
        invoiceNumber,
        amountCents: shortfall.amountCents,
        description: `Shortfall: ${shortfall.reason}`,
      },
    });

    const updated = await this.prisma.shortfall.update({
      where: { id },
      data: {
        status: ShortfallStatus.INVOICED,
        approvedById: approver.id,
        approvedAt: new Date(),
        invoiceId: invoice.id,
      },
      include: { project: { include: { client: true } }, invoice: true },
    });

    await this.prisma.project.update({
      where: { id: shortfall.projectId },
      data: {
        quotationTotalCents: { increment: shortfall.amountCents },
      },
    });

    const currency = this.config.get('CURRENCY') || 'USD';
    const company = this.config.get('COMPANY_NAME') || 'Nomchael Construction';
    const phone = updated.project.client.whatsapp || updated.project.client.phone;
    await this.whatsapp.sendText(
      phone,
      `${company}: Shortfall invoice ${invoiceNumber} for ${updated.project.name}. Amount: ${currency} ${(Number(shortfall.amountCents) / 100).toFixed(2)}. Reason: ${shortfall.reason}`,
    );

    return serializeMoney(updated);
  }
}

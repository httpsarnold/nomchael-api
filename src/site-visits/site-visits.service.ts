import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PaymentMethod, SiteVisitStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { serializeMoney } from '../common/money';

@Injectable()
export class SiteVisitsService {
  constructor(private prisma: PrismaService) {}

  async nextCode() {
    const counter = await this.prisma.counter.upsert({
      where: { id: 'site-visit' },
      create: { id: 'site-visit', value: 1 },
      update: { value: { increment: 1 } },
    });
    return `SV-${String(counter.value).padStart(5, '0')}`;
  }

  async create(data: {
    clientId: string;
    projectId?: string;
    address?: string;
    feeCents?: number;
    scheduledAt?: string;
    notes?: string;
  }) {
    const client = await this.prisma.client.findUnique({ where: { id: data.clientId } });
    if (!client) throw new NotFoundException('Client not found');
    const feeCents = data.feeCents != null ? Math.round(Number(data.feeCents)) : 0;
    if (feeCents < 0) {
      throw new BadRequestException('Site visit fee cannot be negative');
    }

    if (data.projectId) {
      const project = await this.prisma.project.findUnique({ where: { id: data.projectId } });
      if (!project) throw new NotFoundException('Project not found');
      if (project.clientId !== data.clientId) {
        throw new BadRequestException('Project does not belong to this client');
      }
    }

    const visit = await this.prisma.siteVisit.create({
      data: {
        code: await this.nextCode(),
        clientId: data.clientId,
        projectId: data.projectId || null,
        address: data.address || client.address || null,
        feeCents: BigInt(feeCents),
        status: SiteVisitStatus.SCHEDULED,
        scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : null,
        notes: data.notes,
      },
      include: {
        client: true,
        project: { select: { id: true, code: true, name: true, status: true } },
      },
    });
    return serializeMoney(visit);
  }

  async findAll(filters?: { clientId?: string; projectId?: string; status?: SiteVisitStatus }) {
    const list = await this.prisma.siteVisit.findMany({
      where: {
        ...(filters?.clientId ? { clientId: filters.clientId } : {}),
        ...(filters?.projectId ? { projectId: filters.projectId } : {}),
        ...(filters?.status ? { status: filters.status } : {}),
      },
      include: {
        client: { select: { id: true, name: true, phone: true, type: true } },
        project: { select: { id: true, code: true, name: true, status: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return list.map((v) => serializeMoney(v));
  }

  async findOne(id: string) {
    const visit = await this.prisma.siteVisit.findUnique({
      where: { id },
      include: {
        client: true,
        project: true,
        payments: { orderBy: { paidAt: 'desc' } },
      },
    });
    if (!visit) throw new NotFoundException('Site visit not found');
    return serializeMoney(visit);
  }

  async linkProject(id: string, projectId: string) {
    const visit = await this.prisma.siteVisit.findUnique({ where: { id } });
    if (!visit) throw new NotFoundException('Site visit not found');
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Project not found');
    if (project.clientId !== visit.clientId) {
      throw new BadRequestException('Project client must match the site visit client');
    }
    const updated = await this.prisma.siteVisit.update({
      where: { id },
      data: { projectId },
      include: {
        client: true,
        project: { select: { id: true, code: true, name: true, status: true } },
      },
    });
    return serializeMoney(updated);
  }

  async setSchedule(id: string, scheduledAt: string) {
    const visit = await this.prisma.siteVisit.findUnique({ where: { id } });
    if (!visit) throw new NotFoundException('Site visit not found');
    if (visit.status === SiteVisitStatus.CANCELLED) {
      throw new BadRequestException('Cannot schedule a cancelled site visit');
    }
    const when = new Date(scheduledAt);
    if (Number.isNaN(when.getTime())) {
      throw new BadRequestException('Enter a valid date and time for the site visit');
    }
    const updated = await this.prisma.siteVisit.update({
      where: { id },
      data: { scheduledAt: when },
      include: {
        client: { select: { id: true, name: true, phone: true, type: true } },
        project: { select: { id: true, code: true, name: true, status: true } },
      },
    });
    return serializeMoney(updated);
  }

  async markCompleted(id: string) {
    const visit = await this.prisma.siteVisit.findUnique({ where: { id } });
    if (!visit) throw new NotFoundException('Site visit not found');
    if (visit.status !== SiteVisitStatus.PAID && visit.status !== SiteVisitStatus.COMPLETED) {
      throw new BadRequestException('Site visit must be paid before marking completed');
    }
    const updated = await this.prisma.siteVisit.update({
      where: { id },
      data: { status: SiteVisitStatus.COMPLETED, completedAt: new Date() },
      include: {
        client: true,
        project: { select: { id: true, code: true, name: true, status: true } },
      },
    });
    return serializeMoney(updated);
  }

  /** Paid (or completed) visit for this project, or a paid visit for the client not yet tied to another project. */
  async assertPaidVisitForQuote(projectId: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Project not found');

    const linked = await this.prisma.siteVisit.findFirst({
      where: {
        projectId,
        status: { in: [SiteVisitStatus.PAID, SiteVisitStatus.COMPLETED] },
      },
      orderBy: { paidAt: 'desc' },
    });
    if (linked) return linked;

    const clientPaid = await this.prisma.siteVisit.findFirst({
      where: {
        clientId: project.clientId,
        status: { in: [SiteVisitStatus.PAID, SiteVisitStatus.COMPLETED] },
        OR: [{ projectId: null }, { projectId }],
      },
      orderBy: { paidAt: 'desc' },
    });
    if (!clientPaid) {
      throw new BadRequestException(
        'A paid site visit is required before creating a quotation. Schedule and take the visit fee first.',
      );
    }

    if (!clientPaid.projectId) {
      await this.prisma.siteVisit.update({
        where: { id: clientPaid.id },
        data: { projectId },
      });
    }
    return clientPaid;
  }

  async pay(
    id: string,
    data: {
      projectId?: string;
      feeCents?: number;
      method?: PaymentMethod;
      reference?: string;
      notes?: string;
      createdById?: string;
      print?: boolean;
    },
  ) {
    const visit = await this.prisma.siteVisit.findUnique({
      where: { id },
      include: { client: true },
    });
    if (!visit) throw new NotFoundException('Site visit not found');
    if (visit.status === SiteVisitStatus.CANCELLED) {
      throw new BadRequestException('Cannot pay a cancelled site visit');
    }
    if (visit.status === SiteVisitStatus.PAID || visit.status === SiteVisitStatus.COMPLETED) {
      throw new BadRequestException('Site visit is already paid');
    }

    let projectId = data.projectId || visit.projectId || undefined;
    if (!projectId) {
      throw new BadRequestException(
        'Link a project (register the site shell) before taking the site visit payment',
      );
    }

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: { client: true },
    });
    if (!project) throw new NotFoundException('Project not found');
    if (project.clientId !== visit.clientId) {
      throw new BadRequestException('Payment project must match the visit client');
    }

    const feeCents =
      data.feeCents != null ? Math.round(Number(data.feeCents)) : Number(visit.feeCents);
    if (!feeCents || feeCents < 1) {
      throw new BadRequestException(
        'Enter the site visit fee for this job. The amount is set by the company and varies by visit.',
      );
    }

    const updated =
      feeCents !== Number(visit.feeCents)
        ? await this.prisma.siteVisit.update({
            where: { id },
            data: { feeCents: BigInt(feeCents) },
            include: { client: true },
          })
        : visit;

    return { visit: updated, project };
  }
}

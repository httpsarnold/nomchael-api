import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  FundUseCategory,
  EstateLedgerKind,
  PaymentMethod,
  PaymentPurpose,
  ProjectKind,
  ProjectStatus,
  PropertyType,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { serializeMoney } from '../common/money';
import { buildTablePdf } from '../common/table-pdf';
import { PaymentsService } from '../payments/payments.service';

export type ExportFormat = 'csv' | 'pdf';

type OwnerInput = {
  clientId?: string;
  name?: string;
  phone?: string;
};

function csvEscape(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(rows: unknown[][]): string {
  return rows.map((r) => r.map(csvEscape).join(',')).join('\n');
}

@Injectable()
export class LabourRevenueService {
  constructor(
    private prisma: PrismaService,
    private payments: PaymentsService,
  ) {}

  private async nextProjectCode() {
    const counter = await this.prisma.counter.upsert({
      where: { id: 'project' },
      create: { id: 'project', value: 1 },
      update: { value: { increment: 1 } },
    });
    return `PRJ-${String(counter.value).padStart(5, '0')}`;
  }

  private async nextEstateCode() {
    const counter = await this.prisma.counter.upsert({
      where: { id: 'estate' },
      create: { id: 'estate', value: 1 },
      update: { value: { increment: 1 } },
    });
    return `EST-${String(counter.value).padStart(4, '0')}`;
  }

  private moneyTrail(project: {
    labourQuotedCents: bigint;
    discountCents: bigint;
    payments?: { purpose: PaymentPurpose; amountCents: bigint; deletedAt: Date | null }[];
    fundUses?: { amountCents: bigint }[];
  }) {
    const labourQuotedCents = Number(project.labourQuotedCents || 0n);
    const discountCents = Number(project.discountCents || 0n);
    const netDueCents = labourQuotedCents - discountCents;
    const cashReceivedCents = (project.payments || [])
      .filter((p) => !p.deletedAt && p.purpose === PaymentPurpose.LABOUR)
      .reduce((s, p) => s + Number(p.amountCents), 0);
    const fundUsesCents = (project.fundUses || []).reduce(
      (s, u) => s + Number(u.amountCents),
      0,
    );
    return {
      labourQuotedCents,
      discountCents,
      netDueCents,
      cashReceivedCents,
      fundUsesCents,
      stillAvailableCents: cashReceivedCents - fundUsesCents,
      clientOwesCents: netDueCents - cashReceivedCents,
    };
  }

  async listCatchups() {
    const list = await this.prisma.project.findMany({
      where: {
        kind: { in: [ProjectKind.LEGACY, ProjectKind.ESTATE_UNIT] },
        status: { not: ProjectStatus.CANCELLED },
      },
      include: {
        client: true,
        estateProgramme: { select: { id: true, code: true, name: true } },
        payments: { where: { deletedAt: null } },
        fundUses: true,
      },
      orderBy: { updatedAt: 'desc' },
      take: 300,
    });
    return list.map((p) =>
      serializeMoney({
        ...p,
        trail: this.moneyTrail(p),
      }),
    );
  }

  async getTrail(projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: {
        client: true,
        estateProgramme: true,
        payments: {
          where: { deletedAt: null, purpose: PaymentPurpose.LABOUR },
          orderBy: { paidAt: 'desc' },
        },
        fundUses: { orderBy: { usedAt: 'desc' }, include: { createdBy: true } },
      },
    });
    if (!project) throw new NotFoundException('Project not found');
    if (project.kind === ProjectKind.STANDARD) {
      throw new BadRequestException('Not a labour catch-up / estate unit project');
    }
    return serializeMoney({
      ...project,
      trail: this.moneyTrail(project),
    });
  }

  async createCatchup(dto: {
    clientId?: string;
    clientName?: string;
    clientPhone?: string;
    name: string;
    address?: string;
    labourQuotedCents: number;
    discountCents?: number;
    discountReason?: string;
    catchupStageLabel?: string;
    cashReceivedCents?: number;
    createdById?: string;
  }) {
    const name = dto.name?.trim();
    if (!name) throw new BadRequestException('Site / job name is required');
    if (dto.labourQuotedCents === undefined || dto.labourQuotedCents < 0) {
      throw new BadRequestException('Labour quoted amount is required');
    }

    let clientId = dto.clientId;
    if (!clientId) {
      const clientName = dto.clientName?.trim();
      const phone = dto.clientPhone?.trim();
      if (!clientName || !phone) {
        throw new BadRequestException('Client id or name + phone required');
      }
      const client = await this.prisma.client.create({
        data: { name: clientName, phone },
      });
      clientId = client.id;
    } else {
      const client = await this.prisma.client.findUnique({ where: { id: clientId } });
      if (!client) throw new NotFoundException('Client not found');
    }

    const code = await this.nextProjectCode();
    const discountCents = Math.max(0, Math.round(dto.discountCents || 0));
    const labourQuotedCents = Math.round(dto.labourQuotedCents);

    const project = await this.prisma.project.create({
      data: {
        code,
        name,
        address: dto.address,
        clientId,
        kind: ProjectKind.LEGACY,
        status: ProjectStatus.ACTIVE,
        labourQuotedCents: BigInt(labourQuotedCents),
        discountCents: BigInt(discountCents),
        discountReason: dto.discountReason || null,
        catchupStageLabel: dto.catchupStageLabel || null,
      },
      include: { client: true },
    });

    if (dto.cashReceivedCents && dto.cashReceivedCents > 0) {
      await this.payments.create({
        projectId: project.id,
        amountCents: Math.round(dto.cashReceivedCents),
        purpose: PaymentPurpose.LABOUR,
        notes: 'Catch-up labour receipt',
        createdById: dto.createdById,
        print: false,
      });
    }

    await this.prisma.auditLog.create({
      data: {
        userId: dto.createdById,
        action: 'LABOUR_CATCHUP_CREATE',
        entityType: 'Project',
        entityId: project.id,
        metadata: { labourQuotedCents, discountCents },
      },
    });

    return this.getTrail(project.id);
  }

  async updateDiscount(
    projectId: string,
    discountCents: number,
    discountReason?: string,
  ) {
    const project = await this.requireLabourProject(projectId);
    await this.prisma.project.update({
      where: { id: project.id },
      data: {
        discountCents: BigInt(Math.max(0, Math.round(discountCents))),
        discountReason: discountReason || null,
      },
    });
    return this.getTrail(projectId);
  }

  async updateLabourQuoted(projectId: string, labourQuotedCents: number) {
    const project = await this.requireLabourProject(projectId);
    await this.prisma.project.update({
      where: { id: project.id },
      data: { labourQuotedCents: BigInt(Math.max(0, Math.round(labourQuotedCents))) },
    });
    return this.getTrail(projectId);
  }

  async addFundUse(
    projectId: string,
    data: {
      amountCents: number;
      category?: FundUseCategory | string;
      description?: string;
      usedAt?: string;
      createdById?: string;
    },
  ) {
    await this.requireLabourProject(projectId);
    if (!data.amountCents || data.amountCents <= 0) {
      throw new BadRequestException('Amount must be positive');
    }
    const category = this.parseFundCategory(data.category);
    const use = await this.prisma.projectFundUse.create({
      data: {
        projectId,
        amountCents: BigInt(Math.round(data.amountCents)),
        category,
        description: data.description,
        usedAt: data.usedAt ? new Date(data.usedAt) : new Date(),
        createdById: data.createdById,
      },
    });
    return serializeMoney({ use, trail: (await this.getTrail(projectId)).trail });
  }

  async deleteFundUse(id: string) {
    const existing = await this.prisma.projectFundUse.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Fund use not found');
    await this.prisma.projectFundUse.delete({ where: { id } });
    return this.getTrail(existing.projectId);
  }

  private parseFundCategory(raw?: FundUseCategory | string): FundUseCategory {
    const v = String(raw || 'COMPANY_DEBT').toUpperCase();
    if (Object.values(FundUseCategory).includes(v as FundUseCategory)) {
      return v as FundUseCategory;
    }
    return FundUseCategory.OTHER;
  }

  private async requireLabourProject(projectId: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Project not found');
    if (project.kind === ProjectKind.STANDARD) {
      throw new BadRequestException('Not a labour catch-up / estate unit project');
    }
    return project;
  }

  async listEstates() {
    const estates = await this.prisma.estateProgramme.findMany({
      orderBy: { createdAt: 'desc' },
    });
    if (!estates.length) return [];

    const estateIds = estates.map((e) => e.id);
    const projects = await this.prisma.project.findMany({
      where: { estateProgrammeId: { in: estateIds } },
      select: {
        id: true,
        estateProgrammeId: true,
        labourQuotedCents: true,
        discountCents: true,
      },
    });
    const projectIds = projects.map((p) => p.id);
    const [payments, fundUses, ledger] = await Promise.all([
      projectIds.length
        ? this.prisma.payment.findMany({
            where: {
              projectId: { in: projectIds },
              deletedAt: null,
              purpose: PaymentPurpose.LABOUR,
            },
            select: { projectId: true, amountCents: true },
          })
        : Promise.resolve([]),
      projectIds.length
        ? this.prisma.projectFundUse.findMany({
            where: { projectId: { in: projectIds } },
            select: { projectId: true, amountCents: true },
          })
        : Promise.resolve([]),
      this.prisma.estateLedgerEntry.findMany({
        where: { estateProgrammeId: { in: estateIds } },
        select: { estateProgrammeId: true, kind: true, amountCents: true },
      }),
    ]);

    const cashByProject = new Map<string, number>();
    for (const p of payments) {
      cashByProject.set(
        p.projectId,
        (cashByProject.get(p.projectId) || 0) + Number(p.amountCents),
      );
    }
    const usesByProject = new Map<string, number>();
    for (const u of fundUses) {
      usesByProject.set(
        u.projectId,
        (usesByProject.get(u.projectId) || 0) + Number(u.amountCents),
      );
    }

    const projectsByEstate = new Map<string, typeof projects>();
    for (const p of projects) {
      const key = p.estateProgrammeId || '';
      if (!projectsByEstate.has(key)) projectsByEstate.set(key, []);
      projectsByEstate.get(key)!.push(p);
    }

    const ledgerByEstate = new Map<string, { expenses: number; borrowings: number; repayments: number }>();
    for (const e of ledger) {
      const cur = ledgerByEstate.get(e.estateProgrammeId) || {
        expenses: 0,
        borrowings: 0,
        repayments: 0,
      };
      const amt = Number(e.amountCents);
      if (e.kind === EstateLedgerKind.EXPENSE) cur.expenses += amt;
      else if (e.kind === EstateLedgerKind.BORROWING) cur.borrowings += amt;
      else if (e.kind === EstateLedgerKind.REPAYMENT) cur.repayments += amt;
      ledgerByEstate.set(e.estateProgrammeId, cur);
    }

    return estates.map((estate) => {
      const houses = projectsByEstate.get(estate.id) || [];
      let labourQuotedCents = 0;
      let discountCents = 0;
      let cashReceivedCents = 0;
      let fundUsesCents = 0;
      for (const h of houses) {
        labourQuotedCents += Number(h.labourQuotedCents);
        discountCents += Number(h.discountCents);
        cashReceivedCents += cashByProject.get(h.id) || 0;
        fundUsesCents += usesByProject.get(h.id) || 0;
      }
      const led = ledgerByEstate.get(estate.id) || {
        expenses: 0,
        borrowings: 0,
        repayments: 0,
      };
      const netDueCents = labourQuotedCents - discountCents;
      const cashAtHandCents =
        cashReceivedCents -
        fundUsesCents -
        led.expenses -
        led.borrowings +
        led.repayments;
      return serializeMoney({
        ...estate,
        projects: [],
        trends: {
          houseCount: houses.length,
          labourQuotedCents,
          discountCents,
          netDueCents,
          cashReceivedCents,
          fundUsesCents,
          expensesCents: led.expenses,
          borrowingsCents: led.borrowings,
          repaymentsCents: led.repayments,
          borrowingsOutstandingCents: led.borrowings - led.repayments,
          stillAvailableCents: cashAtHandCents,
          cashAtHandCents,
          clientOwesCents: netDueCents - cashReceivedCents,
        },
      });
    });
  }

  async getEstate(id: string) {
    const estate = await this.prisma.estateProgramme.findUnique({
      where: { id },
      include: {
        projects: {
          select: {
            id: true,
            code: true,
            name: true,
            unitNumber: true,
            labourQuotedCents: true,
            discountCents: true,
            discountReason: true,
            catchupStageLabel: true,
            currentStageLabel: true,
            currentStageUpdatedAt: true,
            kind: true,
            status: true,
            client: { select: { id: true, name: true, phone: true } },
            payments: {
              where: { deletedAt: null, purpose: PaymentPurpose.LABOUR },
              select: {
                id: true,
                amountCents: true,
                purpose: true,
                deletedAt: true,
                paidAt: true,
                receiptNumber: true,
              },
            },
            fundUses: {
              select: {
                id: true,
                amountCents: true,
                category: true,
                description: true,
                usedAt: true,
              },
            },
          },
          orderBy: { unitNumber: 'asc' },
        },
      },
    });
    if (!estate) throw new NotFoundException('Estate not found');
    const ledger = await this.prisma.estateLedgerEntry.findMany({
      where: { estateProgrammeId: id },
      orderBy: { entryDate: 'desc' },
    });
    return this.serializeEstate({ ...estate, ledgerEntries: ledger } as any);
  }

  private serializeEstate(estate: any) {
    if (!estate) throw new NotFoundException('Estate not found');
    const houses = (estate.projects || []).map((p: any) => ({
      ...p,
      trail: this.moneyTrail(p),
    }));
    const labourQuotedCents = houses.reduce(
      (s: number, h: any) => s + h.trail.labourQuotedCents,
      0,
    );
    const discountCents = houses.reduce(
      (s: number, h: any) => s + h.trail.discountCents,
      0,
    );
    const netDueCents = houses.reduce((s: number, h: any) => s + h.trail.netDueCents, 0);
    const cashReceivedCents = houses.reduce(
      (s: number, h: any) => s + h.trail.cashReceivedCents,
      0,
    );
    const fundUsesCents = houses.reduce(
      (s: number, h: any) => s + h.trail.fundUsesCents,
      0,
    );
    const labourUsedCents = houses.reduce(
      (s: number, h: any) =>
        s +
        (h.fundUses || [])
          .filter((u: any) => u.category === 'PAID_TO_LABOUR')
          .reduce((a: number, u: any) => a + Number(u.amountCents), 0),
      0,
    );
    const otherFundUsesCents = fundUsesCents - labourUsedCents;

    const ledger = estate.ledgerEntries || [];
    const expensesCents = ledger
      .filter((e: any) => e.kind === 'EXPENSE' || e.kind === EstateLedgerKind.EXPENSE)
      .reduce((s: number, e: any) => s + Number(e.amountCents), 0);
    const borrowingsCents = ledger
      .filter((e: any) => e.kind === 'BORROWING' || e.kind === EstateLedgerKind.BORROWING)
      .reduce((s: number, e: any) => s + Number(e.amountCents), 0);
    const repaymentsCents = ledger
      .filter((e: any) => e.kind === 'REPAYMENT' || e.kind === EstateLedgerKind.REPAYMENT)
      .reduce((s: number, e: any) => s + Number(e.amountCents), 0);
    const borrowingsOutstandingCents = borrowingsCents - repaymentsCents;

    const cashAtHandCents =
      cashReceivedCents - fundUsesCents - expensesCents - borrowingsCents + repaymentsCents;

    const trends = {
      houseCount: houses.length,
      labourQuotedCents,
      discountCents,
      netDueCents,
      cashReceivedCents,
      fundUsesCents,
      labourUsedCents,
      otherFundUsesCents,
      expensesCents,
      borrowingsCents,
      repaymentsCents,
      borrowingsOutstandingCents,
      stillAvailableCents: cashAtHandCents,
      cashAtHandCents,
      clientOwesCents: houses.reduce(
        (s: number, h: any) => s + h.trail.clientOwesCents,
        0,
      ),
    };
    return serializeMoney({
      ...estate,
      projects: houses,
      ledgerEntries: ledger,
      trends,
    });
  }

  async getEstateStatement(estateId: string) {
    const estate = await this.getEstate(estateId);
    const t = estate.trends;
    const lines: {
      date: string;
      description: string;
      debitCents: number;
      creditCents: number;
      section: string;
    }[] = [];

    lines.push({
      date: '',
      description: `Labour quoted (${t.houseCount} houses)`,
      debitCents: 0,
      creditCents: t.labourQuotedCents,
      section: 'CONTRACT',
    });
    if (t.discountCents > 0) {
      lines.push({
        date: '',
        description: 'Discounts granted to clients',
        debitCents: t.discountCents,
        creditCents: 0,
        section: 'CONTRACT',
      });
    }
    lines.push({
      date: '',
      description: 'Net due after discount',
      debitCents: 0,
      creditCents: t.netDueCents,
      section: 'CONTRACT',
    });

    for (const h of estate.projects || []) {
      for (const p of h.payments || []) {
        lines.push({
          date: p.paidAt || '',
          description: `Cash received · ${h.name} · ${h.client?.name || ''} · ${p.receiptNumber || ''}`,
          debitCents: Number(p.amountCents),
          creditCents: 0,
          section: 'INCOME',
        });
      }
      for (const u of h.fundUses || []) {
        const isLabour = u.category === 'PAID_TO_LABOUR';
        lines.push({
          date: u.usedAt || '',
          description: `${isLabour ? 'Labour used' : `Fund use (${u.category})`} · ${h.name}${
            u.description ? ` · ${u.description}` : ''
          }`,
          debitCents: 0,
          creditCents: Number(u.amountCents),
          section: isLabour ? 'LABOUR_USED' : 'FUND_USE',
        });
      }
    }

    for (const e of estate.ledgerEntries || []) {
      const kind = String(e.kind);
      if (kind === 'EXPENSE') {
        lines.push({
          date: e.entryDate || '',
          description: `Expense · ${e.partyName || 'Estate'}${
            e.description ? ` · ${e.description}` : ''
          }`,
          debitCents: 0,
          creditCents: Number(e.amountCents),
          section: 'EXPENSE',
        });
      } else if (kind === 'BORROWING') {
        lines.push({
          date: e.entryDate || '',
          description: `Borrowed from estate · ${e.partyName || 'Borrower'}${
            e.description ? ` · ${e.description}` : ''
          } (must repay)`,
          debitCents: Number(e.amountCents),
          creditCents: Number(e.amountCents),
          section: 'BORROWING',
        });
      } else if (kind === 'REPAYMENT') {
        lines.push({
          date: e.entryDate || '',
          description: `Repayment · ${e.partyName || 'Borrower'}${
            e.description ? ` · ${e.description}` : ''
          }`,
          debitCents: Number(e.amountCents),
          creditCents: 0,
          section: 'REPAYMENT',
        });
      }
    }

    lines.push({
      date: '',
      description: 'Cash at hand (on ground)',
      debitCents: t.cashAtHandCents,
      creditCents: 0,
      section: 'BALANCE',
    });

    const totalDebit = lines.reduce((s, l) => s + l.debitCents, 0);
    const totalCredit = lines.reduce((s, l) => s + l.creditCents, 0);

    const borrowersMap = new Map<string, number>();
    for (const e of estate.ledgerEntries || []) {
      const name = e.partyName || 'Unknown';
      if (String(e.kind) === 'BORROWING') {
        borrowersMap.set(name, (borrowersMap.get(name) || 0) + Number(e.amountCents));
      } else if (String(e.kind) === 'REPAYMENT') {
        borrowersMap.set(name, (borrowersMap.get(name) || 0) - Number(e.amountCents));
      }
    }
    const borrowers = [...borrowersMap.entries()]
      .filter(([, cents]) => cents !== 0)
      .map(([name, outstandingCents]) => ({
        name,
        outstandingCents,
        // Financially: they owe the estate (debtors). Shown as "borrowers to repay".
        role: outstandingCents > 0 ? 'DEBTOR' : 'OVERPAID',
      }));

    const expenses = (estate.ledgerEntries || [])
      .filter((e: any) => String(e.kind) === 'EXPENSE')
      .map((e: any) => ({
        id: e.id,
        partyName: e.partyName,
        description: e.description,
        amountCents: Number(e.amountCents),
        entryDate: e.entryDate,
      }));

    return serializeMoney({
      estate: {
        id: estate.id,
        code: estate.code,
        name: estate.name,
        houseCount: t.houseCount,
      },
      summary: t,
      lines,
      totals: { debitCents: totalDebit, creditCents: totalCredit },
      expenses,
      borrowers,
      note:
        'Borrowings taken from this estate must be repaid (debtors of the estate). Expenses reduce cash at hand. Labour used reduces cash at hand.',
    });
  }

  async addEstateLedgerEntry(
    estateId: string,
    dto: {
      kind: 'EXPENSE' | 'BORROWING' | 'REPAYMENT' | EstateLedgerKind;
      amountCents: number;
      partyName?: string;
      description?: string;
      projectId?: string;
      entryDate?: string;
      createdById?: string;
    },
  ) {
    const estate = await this.prisma.estateProgramme.findUnique({ where: { id: estateId } });
    if (!estate) throw new NotFoundException('Estate not found');
    if (!dto.amountCents || dto.amountCents <= 0) {
      throw new BadRequestException('Amount must be positive');
    }
    const kind = String(dto.kind).toUpperCase() as EstateLedgerKind;
    if (!Object.values(EstateLedgerKind).includes(kind)) {
      throw new BadRequestException('Invalid ledger kind');
    }
    if ((kind === EstateLedgerKind.BORROWING || kind === EstateLedgerKind.REPAYMENT) && !dto.partyName?.trim()) {
      throw new BadRequestException('Borrower / party name is required');
    }

    await this.prisma.estateLedgerEntry.create({
      data: {
        estateProgrammeId: estateId,
        projectId: dto.projectId || null,
        kind,
        amountCents: BigInt(Math.round(dto.amountCents)),
        partyName: dto.partyName?.trim() || null,
        description: dto.description?.trim() || null,
        entryDate: dto.entryDate ? new Date(dto.entryDate) : new Date(),
        createdById: dto.createdById,
      },
    });

    return this.getEstateStatement(estateId);
  }

  async deleteEstateLedgerEntry(id: string) {
    const existing = await this.prisma.estateLedgerEntry.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Ledger entry not found');
    await this.prisma.estateLedgerEntry.delete({ where: { id } });
    return this.getEstateStatement(existing.estateProgrammeId);
  }

  async createEstate(dto: {
    name: string;
    description?: string;
    houseCount: number;
    baseLabourCents: number;
    propertyType?: PropertyType;
    bedrooms?: number;
    bathrooms?: number;
    kitchens?: number;
    lounges?: number;
    otherRooms?: number;
    storeys?: number;
    floorAreaSqm?: number;
    propertyNotes?: string;
    address?: string;
    locationNotes?: string;
    owners?: OwnerInput[];
    catchupStageLabel?: string;
    currentStageLabel?: string;
    createdById?: string;
  }) {
    const name = dto.name?.trim();
    if (!name) throw new BadRequestException('Estate name is required');
    if (!dto.houseCount || dto.houseCount < 1 || dto.houseCount > 500) {
      throw new BadRequestException('House count must be between 1 and 500');
    }
    const baseLabourCents = Math.max(0, Math.round(dto.baseLabourCents || 0));
    const owners = dto.owners || [];

    const code = await this.nextEstateCode();
    const estate = await this.prisma.estateProgramme.create({
      data: {
        code,
        name,
        description: dto.description,
        houseCount: dto.houseCount,
        baseLabourCents: BigInt(baseLabourCents),
        propertyType: dto.propertyType || PropertyType.SINGLE_HOME,
        bedrooms: dto.bedrooms ?? 0,
        bathrooms: dto.bathrooms ?? 0,
        kitchens: dto.kitchens ?? 0,
        lounges: dto.lounges ?? 0,
        otherRooms: dto.otherRooms ?? 0,
        storeys: Math.max(1, dto.storeys ?? 1),
        floorAreaSqm: dto.floorAreaSqm,
        propertyNotes: dto.propertyNotes,
        address: dto.address,
        locationNotes: dto.locationNotes,
      },
    });

    const clientIds: string[] = [];
    const clientsToCreate: { id: string; name: string; phone: string }[] = [];
    for (let i = 1; i <= dto.houseCount; i++) {
      const owner = owners[i - 1] || {};
      if (owner.clientId) {
        clientIds.push(owner.clientId);
      } else {
        const id = randomUUID().replace(/-/g, '').slice(0, 24);
        clientsToCreate.push({
          id,
          name: owner.name?.trim() || `${name} house ${i}`,
          phone:
            owner.phone?.trim() ||
            `pending-${Date.now()}-${i}-${Math.floor(Math.random() * 9999)}`,
        });
        clientIds.push(id);
      }
    }

    if (clientsToCreate.length) {
      await this.prisma.client.createMany({ data: clientsToCreate });
    }

    const existingIds = owners
      .map((o) => o.clientId)
      .filter((id): id is string => !!id);
    if (existingIds.length) {
      const found = await this.prisma.client.findMany({
        where: { id: { in: existingIds } },
        select: { id: true },
      });
      if (found.length !== new Set(existingIds).size) {
        throw new NotFoundException('One or more owner clients were not found');
      }
    }

    const counter = await this.prisma.counter.upsert({
      where: { id: 'project' },
      create: { id: 'project', value: dto.houseCount },
      update: { value: { increment: dto.houseCount } },
    });
    const end = counter.value;
    const start = end - dto.houseCount + 1;
    const propertyType = dto.propertyType || PropertyType.SINGLE_HOME;
    const startStage = dto.catchupStageLabel?.trim() || null;
    const currentStage = dto.currentStageLabel?.trim() || startStage;

    const projectRows = [];
    for (let i = 1; i <= dto.houseCount; i++) {
      projectRows.push({
        id: randomUUID().replace(/-/g, '').slice(0, 24),
        code: `PRJ-${String(start + i - 1).padStart(5, '0')}`,
        name: `${name} · House ${i}`,
        address: dto.address,
        clientId: clientIds[i - 1],
        kind: ProjectKind.ESTATE_UNIT,
        status: ProjectStatus.ACTIVE,
        estateProgrammeId: estate.id,
        unitNumber: i,
        labourQuotedCents: BigInt(baseLabourCents),
        catchupStageLabel: startStage,
        currentStageLabel: currentStage,
        currentStageUpdatedAt: currentStage ? new Date() : null,
        propertyType,
        bedrooms: dto.bedrooms ?? 0,
        bathrooms: dto.bathrooms ?? 0,
        kitchens: dto.kitchens ?? 0,
        lounges: dto.lounges ?? 0,
        otherRooms: dto.otherRooms ?? 0,
        storeys: Math.max(1, dto.storeys ?? 1),
        floorAreaSqm: dto.floorAreaSqm,
        propertyNotes: dto.propertyNotes,
      });
    }

    await this.prisma.project.createMany({ data: projectRows });

    await this.prisma.auditLog.create({
      data: {
        userId: dto.createdById,
        action: 'ESTATE_CREATE',
        entityType: 'EstateProgramme',
        entityId: estate.id,
        metadata: { houseCount: dto.houseCount, baseLabourCents },
      },
    });

    return this.getEstate(estate.id);
  }

  private async resolveOwnerClient(owner: OwnerInput, fallbackName: string) {
    if (owner.clientId) {
      const existing = await this.prisma.client.findUnique({
        where: { id: owner.clientId },
      });
      if (!existing) throw new NotFoundException(`Owner client not found: ${owner.clientId}`);
      return existing.id;
    }
    const name = owner.name?.trim() || fallbackName;
    const phone =
      owner.phone?.trim() || `pending-${Date.now()}-${Math.floor(Math.random() * 9999)}`;
    const created = await this.prisma.client.create({
      data: { name, phone },
    });
    return created.id;
  }

  async updateEstateHouse(
    estateId: string,
    projectId: string,
    dto: {
      houseName?: string;
      ownerName?: string;
      ownerPhone?: string;
      discountCents?: number;
      discountReason?: string;
      labourQuotedCents?: number;
      catchupStageLabel?: string;
      currentStageLabel?: string;
    },
  ) {
    const project = await this.prisma.project.findFirst({
      where: {
        id: projectId,
        estateProgrammeId: estateId,
        kind: ProjectKind.ESTATE_UNIT,
      },
      include: { client: true },
    });
    if (!project) throw new NotFoundException('House not found in this estate');

    if (dto.ownerName?.trim() || dto.ownerPhone?.trim()) {
      await this.prisma.client.update({
        where: { id: project.clientId },
        data: {
          ...(dto.ownerName?.trim() ? { name: dto.ownerName.trim() } : {}),
          ...(dto.ownerPhone?.trim() ? { phone: dto.ownerPhone.trim() } : {}),
        },
      });
    }

    await this.prisma.project.update({
      where: { id: projectId },
      data: {
        ...(dto.houseName?.trim() ? { name: dto.houseName.trim() } : {}),
        ...(dto.discountCents !== undefined
          ? {
              discountCents: BigInt(Math.max(0, Math.round(dto.discountCents))),
              discountReason: dto.discountReason?.trim() || null,
            }
          : dto.discountReason !== undefined
            ? { discountReason: dto.discountReason?.trim() || null }
            : {}),
        ...(dto.labourQuotedCents !== undefined
          ? {
              labourQuotedCents: BigInt(
                Math.max(0, Math.round(dto.labourQuotedCents)),
              ),
            }
          : {}),
        ...(dto.catchupStageLabel !== undefined
          ? { catchupStageLabel: dto.catchupStageLabel.trim() || null }
          : {}),
        ...(dto.currentStageLabel !== undefined &&
        (dto.currentStageLabel.trim() || null) !== project.currentStageLabel
          ? {
              currentStageLabel: dto.currentStageLabel.trim() || null,
              currentStageUpdatedAt: new Date(),
            }
          : {}),
      },
    });

    return this.getEstate(estateId);
  }

  async bulkAssignStages(
    estateId: string,
    dto: {
      projectIds: string[];
      catchupStageLabel?: string;
      currentStageLabel?: string;
      createdById?: string;
    },
  ) {
    if (!dto.projectIds?.length) {
      throw new BadRequestException('Select at least one house');
    }
    if (dto.catchupStageLabel === undefined && dto.currentStageLabel === undefined) {
      throw new BadRequestException('Choose a start stage, a current stage, or both');
    }
    const where = {
      id: { in: dto.projectIds },
      estateProgrammeId: estateId,
      kind: ProjectKind.ESTATE_UNIT,
    };
    const data: Record<string, unknown> = {};
    if (dto.catchupStageLabel !== undefined) {
      data.catchupStageLabel = dto.catchupStageLabel.trim() || null;
    }
    if (dto.currentStageLabel !== undefined) {
      data.currentStageLabel = dto.currentStageLabel.trim() || null;
      data.currentStageUpdatedAt = new Date();
    }
    const result = await this.prisma.project.updateMany({ where, data });

    await this.prisma.auditLog.create({
      data: {
        userId: dto.createdById,
        action: 'ESTATE_STAGE_BULK',
        entityType: 'EstateProgramme',
        entityId: estateId,
        metadata: {
          count: result.count,
          catchupStageLabel: dto.catchupStageLabel ?? null,
          currentStageLabel: dto.currentStageLabel ?? null,
        },
      },
    });

    const estate = await this.getEstate(estateId);
    return { applied: result.count, estate };
  }

  private async stageOrder() {
    const templates = await this.prisma.stageTemplate.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: { name: true },
    });
    return templates.map((t) => t.name);
  }

  private stageRows(houses: any[], order: string[]) {
    const idx = (label?: string | null) => {
      if (!label) return -1;
      const i = order.findIndex((n) => n.toLowerCase() === label.trim().toLowerCase());
      return i;
    };
    return houses.map((h: any) => {
      const startIdx = idx(h.catchupStageLabel);
      const currentIdx = idx(h.currentStageLabel);
      return {
        projectId: h.id,
        code: h.code,
        unitNumber: h.unitNumber,
        houseName: h.name,
        ownerName: h.client?.name || '',
        ownerPhone: h.client?.phone || '',
        startStage: h.catchupStageLabel || null,
        currentStage: h.currentStageLabel || null,
        currentStageUpdatedAt: h.currentStageUpdatedAt || null,
        stagesAdvanced:
          startIdx >= 0 && currentIdx >= 0 ? currentIdx - startIdx : null,
        currentStageIndex: currentIdx,
      };
    });
  }

  private stageSummary(rows: ReturnType<LabourRevenueService['stageRows']>, order: string[]) {
    const countBy = (key: 'startStage' | 'currentStage') => {
      const map = new Map<string, number>();
      for (const r of rows) {
        const k = r[key] || 'Not set';
        map.set(k, (map.get(k) || 0) + 1);
      }
      const rank = (label: string) => {
        const i = order.findIndex((n) => n.toLowerCase() === label.toLowerCase());
        return i >= 0 ? i : label === 'Not set' ? 10_000 : 5_000;
      };
      return [...map.entries()]
        .map(([stage, houses]) => ({ stage, houses }))
        .sort((a, b) => rank(a.stage) - rank(b.stage));
    };
    const advanced = rows.filter((r) => r.stagesAdvanced !== null);
    return {
      houseCount: rows.length,
      withStartStage: rows.filter((r) => r.startStage).length,
      withCurrentStage: rows.filter((r) => r.currentStage).length,
      progressedHouses: advanced.filter((r) => (r.stagesAdvanced || 0) > 0).length,
      averageStagesAdvanced: advanced.length
        ? Math.round(
            (advanced.reduce((s, r) => s + (r.stagesAdvanced || 0), 0) / advanced.length) * 10,
          ) / 10
        : null,
      byCurrentStage: countBy('currentStage'),
      byStartStage: countBy('startStage'),
    };
  }

  async getEstateStageReport(estateId: string) {
    const estate = await this.prisma.estateProgramme.findUnique({
      where: { id: estateId },
      select: {
        id: true,
        code: true,
        name: true,
        projects: {
          where: { kind: ProjectKind.ESTATE_UNIT },
          select: {
            id: true,
            code: true,
            name: true,
            unitNumber: true,
            catchupStageLabel: true,
            currentStageLabel: true,
            currentStageUpdatedAt: true,
            client: { select: { name: true, phone: true } },
          },
          orderBy: { unitNumber: 'asc' },
        },
      },
    });
    if (!estate) throw new NotFoundException('Estate not found');
    const order = await this.stageOrder();
    const rows = this.stageRows(estate.projects, order);
    return {
      estate: { id: estate.id, code: estate.code, name: estate.name },
      stageOrder: order,
      rows,
      summary: this.stageSummary(rows, order),
    };
  }

  async getAllEstatesStageReport() {
    const estates = await this.prisma.estateProgramme.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        code: true,
        name: true,
        projects: {
          where: { kind: ProjectKind.ESTATE_UNIT },
          select: {
            id: true,
            code: true,
            name: true,
            unitNumber: true,
            catchupStageLabel: true,
            currentStageLabel: true,
            currentStageUpdatedAt: true,
            client: { select: { name: true, phone: true } },
          },
          orderBy: { unitNumber: 'asc' },
        },
      },
    });
    const order = await this.stageOrder();
    return {
      stageOrder: order,
      estates: estates.map((e) => {
        const rows = this.stageRows(e.projects, order);
        return {
          id: e.id,
          code: e.code,
          name: e.name,
          summary: this.stageSummary(rows, order),
        };
      }),
    };
  }

  async exportEstateStageReport(
    estateId: string,
    format: ExportFormat = 'csv',
  ): Promise<Buffer> {
    const report = await this.getEstateStageReport(estateId);
    const s = report.summary;
    const rows: unknown[][] = [
      ['Estate', report.estate.name],
      ['Code', report.estate.code],
      ['Houses', s.houseCount],
      ['Houses with start stage', s.withStartStage],
      ['Houses with current stage', s.withCurrentStage],
      ['Houses that progressed', s.progressedHouses],
      ['Average stages advanced', s.averageStagesAdvanced ?? ''],
      [],
      ['Current stage', 'Houses'],
      ...s.byCurrentStage.map((x) => [x.stage, x.houses]),
      [],
      ['Start stage (when received)', 'Houses'],
      ...s.byStartStage.map((x) => [x.stage, x.houses]),
      [],
      [
        'Unit',
        'Code',
        'House',
        'Owner',
        'Phone',
        'Start stage',
        'Current stage',
        'Stages advanced',
        'Stage updated',
      ],
      ...report.rows.map((r) => [
        r.unitNumber,
        r.code,
        r.houseName,
        r.ownerName,
        r.ownerPhone,
        r.startStage || '',
        r.currentStage || '',
        r.stagesAdvanced ?? '',
        r.currentStageUpdatedAt
          ? new Date(r.currentStageUpdatedAt).toISOString().slice(0, 10)
          : '',
      ]),
    ];
    if (format === 'pdf') {
      return buildTablePdf({
        title: 'Estate stage report',
        subtitle: `${report.estate.code} ${report.estate.name}`,
        rows,
      });
    }
    return Buffer.from(toCsv(rows), 'utf8');
  }

  async addEstateHouse(
    estateId: string,
    dto: {
      houseName?: string;
      ownerName?: string;
      ownerPhone?: string;
      labourQuotedCents?: number;
      discountCents?: number;
      discountReason?: string;
      catchupStageLabel?: string;
      currentStageLabel?: string;
      cashReceivedCents?: number;
      createdById?: string;
    },
  ) {
    const estate = await this.prisma.estateProgramme.findUnique({
      where: { id: estateId },
      include: {
        projects: { select: { unitNumber: true }, orderBy: { unitNumber: 'desc' }, take: 1 },
      },
    });
    if (!estate) throw new NotFoundException('Estate not found');

    const nextUnit = (estate.projects[0]?.unitNumber || estate.houseCount || 0) + 1;
    const labourQuotedCents = Math.max(
      0,
      Math.round(
        dto.labourQuotedCents !== undefined
          ? dto.labourQuotedCents
          : Number(estate.baseLabourCents),
      ),
    );
    const discountCents = Math.max(0, Math.round(dto.discountCents || 0));
    const clientId = await this.resolveOwnerClient(
      { name: dto.ownerName, phone: dto.ownerPhone },
      `${estate.name} house ${nextUnit}`,
    );
    const code = await this.nextProjectCode();
    const houseName =
      dto.houseName?.trim() || `${estate.name} · House ${nextUnit}`;

    const project = await this.prisma.project.create({
      data: {
        code,
        name: houseName,
        address: estate.address,
        clientId,
        kind: ProjectKind.ESTATE_UNIT,
        status: ProjectStatus.ACTIVE,
        estateProgrammeId: estate.id,
        unitNumber: nextUnit,
        labourQuotedCents: BigInt(labourQuotedCents),
        discountCents: BigInt(discountCents),
        discountReason: dto.discountReason || null,
        catchupStageLabel: dto.catchupStageLabel?.trim() || null,
        currentStageLabel:
          dto.currentStageLabel?.trim() || dto.catchupStageLabel?.trim() || null,
        currentStageUpdatedAt:
          dto.currentStageLabel?.trim() || dto.catchupStageLabel?.trim() ? new Date() : null,
        propertyType: estate.propertyType,
        bedrooms: estate.bedrooms,
        bathrooms: estate.bathrooms,
        kitchens: estate.kitchens,
        lounges: estate.lounges,
        otherRooms: estate.otherRooms,
        storeys: estate.storeys,
        floorAreaSqm: estate.floorAreaSqm,
        propertyNotes: estate.propertyNotes,
      },
    });

    await this.prisma.estateProgramme.update({
      where: { id: estateId },
      data: { houseCount: { increment: 1 } },
    });

    if (dto.cashReceivedCents && dto.cashReceivedCents > 0) {
      await this.payments.create({
        projectId: project.id,
        amountCents: Math.round(dto.cashReceivedCents),
        purpose: PaymentPurpose.LABOUR,
        notes: 'Catch-up labour receipt (new estate house)',
        createdById: dto.createdById,
        print: false,
      });
    }

    await this.prisma.auditLog.create({
      data: {
        userId: dto.createdById,
        action: 'ESTATE_HOUSE_ADD',
        entityType: 'EstateProgramme',
        entityId: estateId,
        metadata: { projectId: project.id, unitNumber: nextUnit, labourQuotedCents },
      },
    });

    return this.getEstate(estateId);
  }

  async bulkApply(dto: {
    estateProgrammeId: string;
    projectIds: string[];
    action:
      | 'CASH_RECEIVED'
      | 'SET_LABOUR_QUOTED'
      | 'FUND_USE'
      | 'SET_DISCOUNT'
      | 'LABOUR_USED'
      | 'PAY_IN_FULL';
    amountCents?: number;
    category?: FundUseCategory | string;
    description?: string;
    notes?: string;
    createdById?: string;
  }) {
    if (!dto.projectIds?.length) {
      throw new BadRequestException('Select at least one house');
    }
    const amount = Math.round(dto.amountCents || 0);
    if (dto.action !== 'PAY_IN_FULL' && dto.action !== 'SET_DISCOUNT' && amount <= 0) {
      throw new BadRequestException('Amount must be positive');
    }
    if (dto.action === 'SET_DISCOUNT' && amount < 0) {
      throw new BadRequestException('Amount must be zero or positive');
    }
    const estate = await this.prisma.estateProgramme.findUnique({
      where: { id: dto.estateProgrammeId },
    });
    if (!estate) throw new NotFoundException('Estate not found');

    const projects = await this.prisma.project.findMany({
      where: {
        id: { in: dto.projectIds },
        estateProgrammeId: dto.estateProgrammeId,
        kind: ProjectKind.ESTATE_UNIT,
      },
      include: {
        payments: { where: { deletedAt: null } },
        fundUses: true,
      },
    });
    if (projects.length !== dto.projectIds.length) {
      throw new BadRequestException(
        'Some selected houses do not belong to this estate',
      );
    }

    let appliedCount = projects.length;

    if (dto.action === 'SET_LABOUR_QUOTED') {
      await this.prisma.project.updateMany({
        where: { id: { in: dto.projectIds } },
        data: { labourQuotedCents: BigInt(amount) },
      });
    } else if (dto.action === 'SET_DISCOUNT') {
      await this.prisma.project.updateMany({
        where: { id: { in: dto.projectIds } },
        data: {
          discountCents: BigInt(amount),
          discountReason: dto.notes || dto.description || 'Bulk discount',
        },
      });
    } else if (dto.action === 'LABOUR_USED' || dto.action === 'FUND_USE') {
      const category =
        dto.action === 'LABOUR_USED'
          ? FundUseCategory.PAID_TO_LABOUR
          : this.parseFundCategory(dto.category);
      await this.prisma.projectFundUse.createMany({
        data: projects.map((p) => ({
          id: randomUUID().replace(/-/g, '').slice(0, 24),
          projectId: p.id,
          amountCents: BigInt(amount),
          category,
          description:
            dto.description ||
            dto.notes ||
            (dto.action === 'LABOUR_USED'
              ? 'Labour used (allocated from income)'
              : 'Bulk fund use'),
          createdById: dto.createdById,
        })),
      });
    } else if (dto.action === 'PAY_IN_FULL') {
      const owing = projects
        .map((p) => ({ project: p, trail: this.moneyTrail(p) }))
        .filter((x) => x.trail.clientOwesCents > 0);
      if (!owing.length) {
        throw new BadRequestException(
          'None of the selected houses still owe labour cash',
        );
      }
      appliedCount = owing.length;
      const counter = await this.prisma.counter.upsert({
        where: { id: 'receipt' },
        create: { id: 'receipt', value: owing.length },
        update: { value: { increment: owing.length } },
      });
      const end = counter.value;
      const start = end - owing.length + 1;
      const paymentRows = owing.map((x, idx) => ({
        id: randomUUID().replace(/-/g, '').slice(0, 24),
        projectId: x.project.id,
        purpose: PaymentPurpose.LABOUR,
        amountCents: BigInt(x.trail.clientOwesCents),
        method: PaymentMethod.CASH,
        notes: dto.notes || 'Pay in full (outstanding labour)',
        receiptNumber: `RCP-${String(start + idx).padStart(6, '0')}`,
        createdById: dto.createdById,
      }));
      await this.prisma.payment.createMany({ data: paymentRows });
      await this.prisma.clientLedgerEntry.createMany({
        data: paymentRows.map((pay, idx) => ({
          id: randomUUID().replace(/-/g, '').slice(0, 24),
          clientId: owing[idx].project.clientId,
          projectId: owing[idx].project.id,
          entryType: 'LABOUR_PAYMENT',
          amountCents: pay.amountCents,
          balanceCents: 0n,
          description: `Labour receipt ${pay.receiptNumber} (pay in full)`,
          referenceId: pay.id,
        })),
      });
    } else if (dto.action === 'CASH_RECEIVED') {
      const counter = await this.prisma.counter.upsert({
        where: { id: 'receipt' },
        create: { id: 'receipt', value: projects.length },
        update: { value: { increment: projects.length } },
      });
      const end = counter.value;
      const start = end - projects.length + 1;
      const paymentRows = projects.map((p, idx) => ({
        id: randomUUID().replace(/-/g, '').slice(0, 24),
        projectId: p.id,
        purpose: PaymentPurpose.LABOUR,
        amountCents: BigInt(amount),
        method: PaymentMethod.CASH,
        notes: dto.notes || 'Bulk labour receipt',
        receiptNumber: `RCP-${String(start + idx).padStart(6, '0')}`,
        createdById: dto.createdById,
      }));
      await this.prisma.payment.createMany({ data: paymentRows });
      await this.prisma.clientLedgerEntry.createMany({
        data: paymentRows.map((pay, idx) => ({
          id: randomUUID().replace(/-/g, '').slice(0, 24),
          clientId: projects[idx].clientId,
          projectId: projects[idx].id,
          entryType: 'LABOUR_PAYMENT',
          amountCents: BigInt(amount),
          balanceCents: 0n,
          description: `Labour receipt ${pay.receiptNumber}`,
          referenceId: pay.id,
        })),
      });
    } else {
      throw new BadRequestException('Unknown bulk action');
    }

    await this.prisma.auditLog.create({
      data: {
        userId: dto.createdById,
        action: 'BULK_LABOUR_APPLY',
        entityType: 'EstateProgramme',
        entityId: dto.estateProgrammeId,
        metadata: {
          action: dto.action,
          amountCents: amount,
          projectIds: dto.projectIds,
          appliedCount,
        },
      },
    });

    const estateView = await this.getEstate(dto.estateProgrammeId);
    return { applied: appliedCount, estate: estateView };
  }

  async exportEstateExcel(id: string, format: ExportFormat = 'csv'): Promise<Buffer> {
    const estate = await this.getEstate(id);
    const rows: unknown[][] = [
      ['Estate', estate.name],
      ['Code', estate.code],
      ['Houses', estate.trends.houseCount],
      ['Labour quoted', estate.trends.labourQuotedCents / 100],
      ['Discounts', estate.trends.discountCents / 100],
      ['Net due', estate.trends.netDueCents / 100],
      ['Cash received', estate.trends.cashReceivedCents / 100],
      ['Fund uses', estate.trends.fundUsesCents / 100],
      ['Still available', estate.trends.stillAvailableCents / 100],
      ['Client owes', estate.trends.clientOwesCents / 100],
      [],
      [
        'Unit',
        'Code',
        'House',
        'Owner',
        'Phone',
        'Start stage',
        'Current stage',
        'Labour quoted',
        'Discount',
        'Discount reason',
        'Net due',
        'Cash in',
        'Fund uses',
        'Available',
        'Client owes',
      ],
    ];
    for (const h of estate.projects) {
      rows.push([
        h.unitNumber,
        h.code,
        h.name,
        h.client?.name,
        h.client?.phone,
        h.catchupStageLabel || '',
        h.currentStageLabel || '',
        h.trail.labourQuotedCents / 100,
        h.trail.discountCents / 100,
        h.discountReason || '',
        h.trail.netDueCents / 100,
        h.trail.cashReceivedCents / 100,
        h.trail.fundUsesCents / 100,
        h.trail.stillAvailableCents / 100,
        h.trail.clientOwesCents / 100,
      ]);
    }
    if (format === 'pdf') {
      return buildTablePdf({
        title: 'Estate labour statement',
        subtitle: `${estate.code} ${estate.name}`,
        rows,
      });
    }
    return Buffer.from(toCsv(rows), 'utf8');
  }

  async exportCatchupsExcel(format: ExportFormat = 'csv'): Promise<Buffer> {
    const list = await this.listCatchups();
    const rows: unknown[][] = [
      [
        'Kind',
        'Code',
        'Name',
        'Owner',
        'Estate',
        'Labour quoted',
        'Discount',
        'Net due',
        'Cash in',
        'Fund uses',
        'Available',
        'Client owes',
      ],
    ];
    for (const p of list) {
      rows.push([
        p.kind,
        p.code,
        p.name,
        p.client?.name,
        p.estateProgramme?.name || '',
        p.trail.labourQuotedCents / 100,
        p.trail.discountCents / 100,
        p.trail.netDueCents / 100,
        p.trail.cashReceivedCents / 100,
        p.trail.fundUsesCents / 100,
        p.trail.stillAvailableCents / 100,
        p.trail.clientOwesCents / 100,
      ]);
    }
    if (format === 'pdf') {
      return buildTablePdf({
        title: 'Labour catch-up files',
        rows,
        firstBlockIsTable: true,
      });
    }
    return Buffer.from(toCsv(rows), 'utf8');
  }
}

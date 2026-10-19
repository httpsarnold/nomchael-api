import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  FundUseCategory,
  EstateExpenseCategory,
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
    buildingMatchDiscountCents?: bigint | null;
    payments?: { purpose: PaymentPurpose; amountCents: bigint; deletedAt: Date | null }[];
    fundUses?: { amountCents: bigint }[];
  }) {
    const labourQuotedCents = Number(project.labourQuotedCents || 0n);
    const discountCents = Number(project.discountCents || 0n);
    const buildingMatchDiscountCents = Number(project.buildingMatchDiscountCents || 0n);
    const netDueCents = labourQuotedCents - discountCents - buildingMatchDiscountCents;
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
      buildingMatchDiscountCents,
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
        buildingMatchDiscountCents: true,
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
        select: {
          estateProgrammeId: true,
          kind: true,
          expenseCategory: true,
          amountCents: true,
        },
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

    const ledgerByEstate = new Map<
      string,
      {
        expenses: number;
        companyExpenses: number;
        projectExpenses: number;
        borrowings: number;
        repayments: number;
      }
    >();
    for (const e of ledger) {
      const cur = ledgerByEstate.get(e.estateProgrammeId) || {
        expenses: 0,
        companyExpenses: 0,
        projectExpenses: 0,
        borrowings: 0,
        repayments: 0,
      };
      const amt = Number(e.amountCents);
      if (e.kind === EstateLedgerKind.EXPENSE) {
        cur.expenses += amt;
        if (e.expenseCategory === EstateExpenseCategory.PROJECT) cur.projectExpenses += amt;
        else cur.companyExpenses += amt;
      } else if (e.kind === EstateLedgerKind.BORROWING) cur.borrowings += amt;
      else if (e.kind === EstateLedgerKind.REPAYMENT) cur.repayments += amt;
      ledgerByEstate.set(e.estateProgrammeId, cur);
    }

    return estates.map((estate) => {
      const houses = projectsByEstate.get(estate.id) || [];
      let labourQuotedCents = 0;
      let discountCents = 0;
      let buildingMatchDiscountCents = 0;
      let cashReceivedCents = 0;
      let fundUsesCents = 0;
      for (const h of houses) {
        labourQuotedCents += Number(h.labourQuotedCents);
        discountCents += Number(h.discountCents);
        buildingMatchDiscountCents += Number(h.buildingMatchDiscountCents);
        cashReceivedCents += cashByProject.get(h.id) || 0;
        fundUsesCents += usesByProject.get(h.id) || 0;
      }
      const led = ledgerByEstate.get(estate.id) || {
        expenses: 0,
        companyExpenses: 0,
        projectExpenses: 0,
        borrowings: 0,
        repayments: 0,
      };
      const netDueCents = labourQuotedCents - discountCents - buildingMatchDiscountCents;
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
          buildingMatchDiscountCents,
          netDueCents,
          cashReceivedCents,
          fundUsesCents,
          expensesCents: led.expenses,
          companyExpensesCents: led.companyExpenses,
          projectExpensesCents: led.projectExpenses,
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
            estateBoqId: true,
            allocatedLabourCents: true,
            buildingMatchDiscountCents: true,
            estateBoq: { select: { id: true, name: true } },
            boqLines: {
              orderBy: { sortOrder: 'asc' },
              select: {
                id: true,
                stageName: true,
                sectionName: true,
                sortOrder: true,
                amountCents: true,
              },
            },
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
        boqs: {
          orderBy: { createdAt: 'asc' },
          include: { lines: { orderBy: { sortOrder: 'asc' } } },
        },
      },
    });
    if (!estate) throw new NotFoundException('Estate not found');
    const ledger = await this.prisma.estateLedgerEntry.findMany({
      where: { estateProgrammeId: id },
      orderBy: { entryDate: 'desc' },
    });
    const stageCatalog = await this.stageCatalog();
    return this.serializeEstate({ ...estate, ledgerEntries: ledger, stageCatalog } as any);
  }

  private serializeEstate(estate: any) {
    if (!estate) throw new NotFoundException('Estate not found');
    const catalog = estate.stageCatalog || [];
    const houses = (estate.projects || []).map((p: any) => {
      const priced = (p.boqLines || []).length
        ? this.priceSnapshot(p.boqLines, p.catchupStageLabel, catalog)
        : null;
      return {
        ...p,
        trail: this.moneyTrail(p),
        boqStages: priced?.stages || [],
      };
    });
    const labourQuotedCents = houses.reduce(
      (s: number, h: any) => s + h.trail.labourQuotedCents,
      0,
    );
    const discountCents = houses.reduce(
      (s: number, h: any) => s + h.trail.discountCents,
      0,
    );
    const buildingMatchDiscountCents = houses.reduce(
      (s: number, h: any) => s + h.trail.buildingMatchDiscountCents,
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
    const expenseRows = ledger.filter(
      (e: any) => e.kind === 'EXPENSE' || e.kind === EstateLedgerKind.EXPENSE,
    );
    const expensesCents = expenseRows.reduce(
      (s: number, e: any) => s + Number(e.amountCents),
      0,
    );
    const projectExpensesCents = expenseRows
      .filter((e: any) => e.expenseCategory === EstateExpenseCategory.PROJECT)
      .reduce((s: number, e: any) => s + Number(e.amountCents), 0);
    const companyExpensesCents = expensesCents - projectExpensesCents;
    const borrowingsCents = ledger
      .filter((e: any) => e.kind === 'BORROWING' || e.kind === EstateLedgerKind.BORROWING)
      .reduce((s: number, e: any) => s + Number(e.amountCents), 0);
    const repaymentsCents = ledger
      .filter((e: any) => e.kind === 'REPAYMENT' || e.kind === EstateLedgerKind.REPAYMENT)
      .reduce((s: number, e: any) => s + Number(e.amountCents), 0);
    const borrowingsOutstandingCents = borrowingsCents - repaymentsCents;

    // Labour account: cash received for labour, spent on labour / project costs / borrowings.
    const labourBalanceCents =
      cashReceivedCents -
      labourUsedCents -
      otherFundUsesCents -
      projectExpensesCents -
      borrowingsCents +
      repaymentsCents;

    // Company / profit account: margin on the file after labour + project costs, then company spend.
    const profitEarnedCents = netDueCents - labourUsedCents - projectExpensesCents;
    const profitBalanceCents = profitEarnedCents - companyExpensesCents;

    // Physical cash still one pot: labour cash left after company expenses paid from profit.
    const cashAtHandCents = labourBalanceCents - companyExpensesCents;

    const trends = {
      houseCount: houses.length,
      labourQuotedCents,
      discountCents,
      buildingMatchDiscountCents,
      netDueCents,
      cashReceivedCents,
      fundUsesCents,
      labourUsedCents,
      otherFundUsesCents,
      expensesCents,
      companyExpensesCents,
      projectExpensesCents,
      borrowingsCents,
      repaymentsCents,
      borrowingsOutstandingCents,
      labourBalanceCents,
      profitEarnedCents,
      profitBalanceCents,
      stillAvailableCents: cashAtHandCents,
      cashAtHandCents,
      clientOwesCents: houses.reduce(
        (s: number, h: any) => s + h.trail.clientOwesCents,
        0,
      ),
    };
    const { stageCatalog: _stageCatalog, ...estateRest } = estate;
    return serializeMoney({
      ...estateRest,
      projects: houses,
      ledgerEntries: ledger,
      trends,
    });
  }

  async getEstateStatement(estateId: string) {
    const estate = await this.getEstate(estateId);
    const t = estate.trends;
    type LedgerLine = {
      date: string;
      description: string;
      debitCents: number;
      creditCents: number;
      section: string;
    };

    const labourLines: LedgerLine[] = [];
    const profitLines: LedgerLine[] = [];

    // --- Labour account: cash for labour work ---
    labourLines.push({
      date: '',
      description: `Labour quoted (${t.houseCount} houses)`,
      debitCents: 0,
      creditCents: t.labourQuotedCents,
      section: 'CONTRACT',
    });
    if (t.discountCents > 0) {
      labourLines.push({
        date: '',
        description: 'Discounts granted to clients',
        debitCents: t.discountCents,
        creditCents: 0,
        section: 'CONTRACT',
      });
    }
    if (t.buildingMatchDiscountCents) {
      const match = t.buildingMatchDiscountCents;
      labourLines.push({
        date: '',
        description: 'Building match discount',
        debitCents: match > 0 ? match : 0,
        creditCents: match < 0 ? Math.abs(match) : 0,
        section: 'CONTRACT',
      });
    }
    labourLines.push({
      date: '',
      description: 'Net labour due after discount',
      debitCents: 0,
      creditCents: t.netDueCents,
      section: 'CONTRACT',
    });

    for (const h of estate.projects || []) {
      for (const p of h.payments || []) {
        labourLines.push({
          date: p.paidAt || '',
          description: `Labour cash in · ${h.name} · ${h.client?.name || ''} · ${
            p.receiptNumber || ''
          }`,
          debitCents: Number(p.amountCents),
          creditCents: 0,
          section: 'INCOME',
        });
      }
      for (const u of h.fundUses || []) {
        const isLabour = u.category === 'PAID_TO_LABOUR';
        labourLines.push({
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

    const houseNameById = new Map<string, string>(
      (estate.projects || []).map((h: any) => [h.id, h.name]),
    );

    for (const e of estate.ledgerEntries || []) {
      const kind = String(e.kind);
      if (kind === 'EXPENSE') {
        const isProject = e.expenseCategory === EstateExpenseCategory.PROJECT;
        const houseLabel =
          isProject && e.projectId ? houseNameById.get(e.projectId) || 'House' : null;
        const desc = `${isProject ? 'Project expense' : 'Company expense'}${
          houseLabel ? ` · ${houseLabel}` : ''
        } · ${e.partyName || 'Estate'}${e.description ? ` · ${e.description}` : ''}`;
        const line: LedgerLine = {
          date: e.entryDate || '',
          description: desc,
          debitCents: 0,
          creditCents: Number(e.amountCents),
          section: isProject ? 'PROJECT_EXPENSE' : 'COMPANY_EXPENSE',
        };
        if (isProject) labourLines.push(line);
        else profitLines.push(line);
      } else if (kind === 'BORROWING') {
        labourLines.push({
          date: e.entryDate || '',
          description: `Borrowed from labour pot · ${e.partyName || 'Borrower'}${
            e.description ? ` · ${e.description}` : ''
          } (must repay)`,
          debitCents: Number(e.amountCents),
          creditCents: Number(e.amountCents),
          section: 'BORROWING',
        });
      } else if (kind === 'REPAYMENT') {
        labourLines.push({
          date: e.entryDate || '',
          description: `Repayment into labour pot · ${e.partyName || 'Borrower'}${
            e.description ? ` · ${e.description}` : ''
          }`,
          debitCents: Number(e.amountCents),
          creditCents: 0,
          section: 'REPAYMENT',
        });
      }
    }

    labourLines.push({
      date: '',
      description: 'Labour account balance',
      debitCents: t.labourBalanceCents,
      creditCents: 0,
      section: 'BALANCE',
    });

    // --- Company / profit account ---
    profitLines.unshift({
      date: '',
      description:
        'Profit earned (net labour due − labour used − project expenses)',
      debitCents: 0,
      creditCents: Math.max(0, t.profitEarnedCents),
      section: 'PROFIT',
    });
    if (t.profitEarnedCents < 0) {
      profitLines.unshift({
        date: '',
        description: 'Loss on labour file (labour used + project expenses above net due)',
        debitCents: Math.abs(t.profitEarnedCents),
        creditCents: 0,
        section: 'PROFIT',
      });
    }
    profitLines.push({
      date: '',
      description: 'Company / profit account balance',
      debitCents: Math.max(0, t.profitBalanceCents),
      creditCents: t.profitBalanceCents < 0 ? Math.abs(t.profitBalanceCents) : 0,
      section: 'BALANCE',
    });

    const sumDr = (rows: LedgerLine[]) => rows.reduce((s, l) => s + l.debitCents, 0);
    const sumCr = (rows: LedgerLine[]) => rows.reduce((s, l) => s + l.creditCents, 0);

    // Combined lines kept for older UI / exports that still read `lines`.
    const lines = [
      ...labourLines.map((l) => ({ ...l, account: 'LABOUR' })),
      ...profitLines.map((l) => ({ ...l, account: 'COMPANY' })),
      {
        date: '',
        description: 'Cash at hand (labour balance − company expenses)',
        debitCents: t.cashAtHandCents,
        creditCents: 0,
        section: 'BALANCE',
        account: 'CASH',
      },
    ];

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
        role: outstandingCents > 0 ? 'DEBTOR' : 'OVERPAID',
      }));

    const expenses = (estate.ledgerEntries || [])
      .filter((e: any) => String(e.kind) === 'EXPENSE')
      .map((e: any) => ({
        id: e.id,
        expenseCategory: e.expenseCategory || EstateExpenseCategory.COMPANY,
        projectId: e.projectId || null,
        projectName: e.projectId ? houseNameById.get(e.projectId) || null : null,
        partyName: e.partyName,
        description: e.description,
        amountCents: Number(e.amountCents),
        entryDate: e.entryDate,
        account:
          e.expenseCategory === EstateExpenseCategory.PROJECT ? 'LABOUR' : 'COMPANY',
      }));

    return serializeMoney({
      estate: {
        id: estate.id,
        code: estate.code,
        name: estate.name,
        houseCount: t.houseCount,
      },
      summary: t,
      labourAccount: {
        name: 'Labour account',
        balanceCents: t.labourBalanceCents,
        lines: labourLines,
        totals: { debitCents: sumDr(labourLines), creditCents: sumCr(labourLines) },
      },
      companyAccount: {
        name: 'Company / profit account',
        earnedCents: t.profitEarnedCents,
        balanceCents: t.profitBalanceCents,
        lines: profitLines,
        totals: { debitCents: sumDr(profitLines), creditCents: sumCr(profitLines) },
      },
      lines,
      totals: { debitCents: sumDr(lines), creditCents: sumCr(lines) },
      expenses,
      borrowers,
      note:
        'Two accounts: project expenses come from the labour account; company expenses come from profit (net labour due − labour used − project expenses). Cash at hand = labour balance − company expenses. Borrowings come from the labour pot and must be repaid.',
    });
  }

  async addEstateLedgerEntry(
    estateId: string,
    dto: {
      kind: 'EXPENSE' | 'BORROWING' | 'REPAYMENT' | EstateLedgerKind;
      amountCents: number;
      partyName?: string;
      description?: string;
      expenseCategory?: 'COMPANY' | 'PROJECT' | EstateExpenseCategory;
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

    let expenseCategory: EstateExpenseCategory | null = null;
    let projectId: string | null = null;
    if (kind === EstateLedgerKind.EXPENSE) {
      const cat = String(dto.expenseCategory || 'COMPANY').toUpperCase() as EstateExpenseCategory;
      if (!Object.values(EstateExpenseCategory).includes(cat)) {
        throw new BadRequestException('Expense category must be COMPANY or PROJECT');
      }
      expenseCategory = cat;
      if (cat === EstateExpenseCategory.PROJECT) {
        if (!dto.projectId?.trim()) {
          throw new BadRequestException('Choose the house for a project expense');
        }
        const house = await this.prisma.project.findFirst({
          where: { id: dto.projectId, estateProgrammeId: estateId },
          select: { id: true },
        });
        if (!house) throw new BadRequestException('That house is not on this estate');
        projectId = house.id;
      }
      if (!dto.description?.trim()) {
        throw new BadRequestException('Say what the expense was for');
      }
    }

    await this.prisma.estateLedgerEntry.create({
      data: {
        estateProgrammeId: estateId,
        projectId,
        kind,
        expenseCategory,
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
      include: { client: true, boqLines: { select: { id: true } } },
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

    const hasBoq = project.boqLines.length > 0;
    const nextStart =
      dto.catchupStageLabel !== undefined
        ? dto.catchupStageLabel.trim() || null
        : project.catchupStageLabel;

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
        ...(!hasBoq && dto.labourQuotedCents !== undefined
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

    if (hasBoq && dto.catchupStageLabel !== undefined) {
      await this.repriceHouseFromSnapshot(projectId, nextStart, project.allocatedLabourCents);
    }

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

    if (dto.catchupStageLabel !== undefined) {
      const start = dto.catchupStageLabel.trim() || null;
      const houses = await this.prisma.project.findMany({
        where: { ...where, boqLines: { some: {} } },
        select: { id: true, allocatedLabourCents: true },
      });
      for (const house of houses) {
        await this.repriceHouseFromSnapshot(house.id, start, house.allocatedLabourCents);
      }
    }

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

  private async stageCatalog() {
    return this.prisma.stageTemplate.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: { name: true, sortOrder: true },
    });
  }

  private async stageOrder() {
    const templates = await this.stageCatalog();
    return {
      order: templates.map((t) => t.name),
      construction: templates.filter((t) => t.sortOrder < 100).map((t) => t.name),
      legacy: templates.filter((t) => t.sortOrder >= 100).map((t) => t.name),
    };
  }

  private lineLabel(line: { sectionName?: string | null; stageName: string }) {
    return line.stageName.trim();
  }

  private startSortOrder(
    label: string | null | undefined,
    catalog: { name: string; sortOrder: number }[],
    lines: { sectionName?: string | null; stageName: string; sortOrder: number }[],
  ) {
    const name = label?.trim();
    if (!name) return null;
    const lower = name.toLowerCase();
    const bare = this.quoteDescription(name);
    const labelled = lines.find((l) => {
      const stage = this.lineLabel(l).toLowerCase();
      return stage === lower || stage === bare;
    });
    if (labelled) return labelled.sortOrder;
    const resolved = this.resolveQuoteStage(
      name,
      lines.map((l) => this.lineLabel(l)),
    );
    if (resolved) {
      const match = lines.find((l) => this.lineLabel(l).toLowerCase() === resolved.toLowerCase());
      if (match) return match.sortOrder;
    }
    const line = lines.find((l) => {
      const stage = l.stageName.toLowerCase();
      return stage === lower || stage === bare;
    });
    if (line) return line.sortOrder;
    const template = catalog.find((t) => t.name.toLowerCase() === lower);
    if (template) return template.sortOrder;
    return null;
  }

  /** Older template names, pointed at the quotation description they stand for. */
  private quoteStageAlias(label: string): { description: string; pick: 'first' | 'last' } | null {
    const aliases: Record<string, { description: string; pick: 'first' | 'last' }> = {
      'back filling and compacting concrete slab': { description: 'concrete slab', pick: 'first' },
      'concrete roof deck 1': { description: 'concrete roof deck', pick: 'first' },
      'concrete roof deck 2': { description: 'concrete roof deck', pick: 'first' },
      'roof deck steel fixing 1': { description: 'roof deck steel fixing', pick: 'first' },
      'roof deck steel fixing 2': { description: 'roof deck steel fixing', pick: 'first' },
      'parapet and wall coping': { description: 'parrapet and wall couping', pick: 'first' },
      'site clearing': { description: 'land clearing', pick: 'first' },
      foundation: { description: 'concrete bases', pick: 'first' },
      slab: { description: 'concrete slab', pick: 'first' },
      walls: { description: 'average level', pick: 'first' },
      'average level': { description: 'average level', pick: 'last' },
      'window level': { description: 'window level', pick: 'last' },
      'steel structure': { description: 'steel fixing of ring beam', pick: 'first' },
      'roof structure': { description: 'wall plate', pick: 'first' },
      plumbing: { description: 'plumbing fix and supply', pick: 'first' },
    };
    return aliases[label] || null;
  }

  private quoteDescription(stage: string) {
    const parts = stage.split(' · ');
    return (parts.length > 1 ? parts.slice(1).join(' · ') : stage).trim().toLowerCase();
  }

  /** Stored labels such as Walls or Site Clearing become the matching quotation stage. */
  private resolveQuoteStage(label: string | null | undefined, quoteLabels: string[]) {
    const raw = label?.trim() || '';
    if (!raw || !quoteLabels.length) return raw || null;
    const lower = raw.toLowerCase();
    const exact = quoteLabels.find((stage) => stage.toLowerCase() === lower);
    if (exact) return exact;
    const bare = this.quoteDescription(raw);
    const keys = bare !== lower ? [lower, bare] : [lower];
    const pick = (description: string, which: 'first' | 'last') => {
      const matches = quoteLabels.filter((stage) => this.quoteDescription(stage) === description);
      if (!matches.length) return '';
      return which === 'first' ? matches[0] : matches[matches.length - 1];
    };
    for (const key of keys) {
      const alias = this.quoteStageAlias(key);
      if (!alias) continue;
      const aliased = pick(alias.description, alias.pick);
      if (aliased) return aliased;
    }
    for (const key of keys) {
      const described = pick(key, 'last');
      if (described) return described;
    }
    for (const key of keys) {
      const stripped = key.replace(/ \d+$/, '');
      if (stripped === key) continue;
      const numbered = pick(stripped, 'first');
      if (numbered) return numbered;
    }
    return raw;
  }

  private quoteStageLabels(
    boqs: { lines?: { sectionName?: string | null; stageName: string; sortOrder: number }[] }[],
  ) {
    const lists = (boqs || [])
      .map((boq) => [...(boq.lines || [])].sort((a, b) => a.sortOrder - b.sortOrder))
      .sort((a, b) => b.length - a.length);
    const seen = new Set<string>();
    const labels: string[] = [];
    for (const lines of lists) {
      for (const line of lines) {
        const label = this.lineLabel(line);
        const key = label.toLowerCase();
        if (!label || seen.has(key)) continue;
        seen.add(key);
        labels.push(label);
      }
    }
    return labels;
  }

  private priceSnapshot(
    lines: {
      id?: string;
      sectionName?: string | null;
      stageName: string;
      sortOrder: number;
      amountCents: bigint | number;
    }[],
    startLabel: string | null | undefined,
    catalog: { name: string; sortOrder: number }[],
  ) {
    const start = this.startSortOrder(startLabel, catalog, lines);
    let labourQuotedCents = 0;
    const stages = [...lines]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((l) => {
        const included = start === null || l.sortOrder >= start;
        const amountCents = Number(l.amountCents);
        if (included) labourQuotedCents += amountCents;
        return {
          id: l.id,
          sectionName: l.sectionName || '',
          stageName: l.stageName,
          sortOrder: l.sortOrder,
          amountCents,
          included,
        };
      });
    return { labourQuotedCents, stages };
  }

  private normalizeBoqLines(
    lines: { sectionName?: string; stageName?: string; sortOrder?: number; amountCents?: number }[],
  ) {
    const cleaned = (lines || [])
      .map((l, i) => ({
        sectionName: l.sectionName?.trim() || null,
        stageName: l.stageName?.trim() || '',
        sortOrder: Number.isFinite(Number(l.sortOrder)) ? Number(l.sortOrder) : i + 1,
        amountCents: Math.max(0, Math.round(Number(l.amountCents) || 0)),
      }))
      .filter((l) => l.stageName);
    if (!cleaned.length) throw new BadRequestException('Add at least one description');
    return cleaned;
  }

  async createEstateBoq(
    estateId: string,
    dto: {
      name: string;
      notes?: string;
      lines: { sectionName?: string; stageName?: string; sortOrder?: number; amountCents?: number }[];
    },
  ) {
    const estate = await this.prisma.estateProgramme.findUnique({ where: { id: estateId } });
    if (!estate) throw new NotFoundException('Estate not found');
    const name = dto.name?.trim();
    if (!name) throw new BadRequestException('BOQ name is required');
    const lines = this.normalizeBoqLines(dto.lines);
    const created = await this.prisma.estateBoq.create({
      data: {
        estateProgrammeId: estateId,
        name,
        notes: dto.notes?.trim() || null,
        lines: {
          create: lines.map((l) => ({
            sectionName: l.sectionName,
            stageName: l.stageName,
            sortOrder: l.sortOrder,
            amountCents: BigInt(l.amountCents),
          })),
        },
      },
      include: { lines: { orderBy: { sortOrder: 'asc' } } },
    });
    return serializeMoney(created);
  }

  async updateEstateBoq(
    estateId: string,
    boqId: string,
    dto: {
      name?: string;
      notes?: string;
      lines?: { sectionName?: string; stageName?: string; sortOrder?: number; amountCents?: number }[];
    },
  ) {
    const existing = await this.prisma.estateBoq.findFirst({
      where: { id: boqId, estateProgrammeId: estateId },
    });
    if (!existing) throw new NotFoundException('BOQ not found');
    const name = dto.name !== undefined ? dto.name.trim() : existing.name;
    if (!name) throw new BadRequestException('BOQ name is required');
    const lines = dto.lines ? this.normalizeBoqLines(dto.lines) : null;
    const updated = await this.prisma.$transaction(async (tx) => {
      if (lines) {
        await tx.estateBoqLine.deleteMany({ where: { estateBoqId: boqId } });
      }
      return tx.estateBoq.update({
        where: { id: boqId },
        data: {
          name,
          ...(dto.notes !== undefined ? { notes: dto.notes.trim() || null } : {}),
          ...(lines
            ? {
                lines: {
                  create: lines.map((l) => ({
                    sectionName: l.sectionName,
                    stageName: l.stageName,
                    sortOrder: l.sortOrder,
                    amountCents: BigInt(l.amountCents),
                  })),
                },
              }
            : {}),
        },
        include: { lines: { orderBy: { sortOrder: 'asc' } } },
      });
    });
    return serializeMoney(updated);
  }

  async deleteEstateBoq(estateId: string, boqId: string) {
    const existing = await this.prisma.estateBoq.findFirst({
      where: { id: boqId, estateProgrammeId: estateId },
    });
    if (!existing) throw new NotFoundException('BOQ not found');
    await this.prisma.estateBoq.delete({ where: { id: boqId } });
    return { ok: true };
  }

  async applyEstateBoq(
    estateId: string,
    boqId: string,
    dto: { projectIds: string[]; createdById?: string },
  ) {
    if (!dto.projectIds?.length) throw new BadRequestException('Select at least one house');
    const boq = await this.prisma.estateBoq.findFirst({
      where: { id: boqId, estateProgrammeId: estateId },
      include: { lines: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!boq) throw new NotFoundException('BOQ not found');
    if (!boq.lines.length) throw new BadRequestException('This BOQ has no stages');
    const houses = await this.prisma.project.findMany({
      where: {
        id: { in: dto.projectIds },
        estateProgrammeId: estateId,
        kind: ProjectKind.ESTATE_UNIT,
      },
    });
    if (houses.length !== dto.projectIds.length) {
      throw new BadRequestException('Some selected houses do not belong to this estate');
    }
    const catalog = await this.stageCatalog();
    await this.prisma.$transaction(
      async (tx) => {
        for (const house of houses) {
          const existingCount = await tx.projectBoqLine.count({ where: { projectId: house.id } });
          let allocated = house.allocatedLabourCents;
          if (allocated == null && existingCount === 0 && Number(house.labourQuotedCents) > 0) {
            allocated = house.labourQuotedCents;
          }
          await tx.projectBoqLine.deleteMany({ where: { projectId: house.id } });
          await tx.projectBoqLine.createMany({
            data: boq.lines.map((l) => ({
              projectId: house.id,
              sectionName: l.sectionName,
              stageName: l.stageName,
              sortOrder: l.sortOrder,
              amountCents: l.amountCents,
            })),
          });
          const priced = this.priceSnapshot(boq.lines, house.catchupStageLabel, catalog);
          const buildingMatch =
            allocated == null ? 0 : priced.labourQuotedCents - Number(allocated);
          await tx.project.update({
            where: { id: house.id },
            data: {
              estateBoqId: boq.id,
              allocatedLabourCents: allocated,
              labourQuotedCents: BigInt(priced.labourQuotedCents),
              buildingMatchDiscountCents: BigInt(buildingMatch),
            },
          });
        }
      },
      { timeout: 60000 },
    );
    await this.prisma.auditLog.create({
      data: {
        userId: dto.createdById,
        action: 'ESTATE_BOQ_APPLY',
        entityType: 'EstateProgramme',
        entityId: estateId,
        metadata: { boqId, projectIds: dto.projectIds },
      },
    });
    return this.getEstate(estateId);
  }

  async clearEstateHouseBoq(estateId: string, projectId: string, userId?: string) {
    const house = await this.prisma.project.findFirst({
      where: {
        id: projectId,
        estateProgrammeId: estateId,
        kind: ProjectKind.ESTATE_UNIT,
      },
      include: { boqLines: { select: { id: true } }, estateBoq: { select: { id: true, name: true } } },
    });
    if (!house) throw new NotFoundException('House not found in this estate');
    if (!house.estateBoqId && house.boqLines.length === 0) {
      throw new BadRequestException('This house has no quotation');
    }
    const restored =
      house.allocatedLabourCents != null ? house.allocatedLabourCents : house.labourQuotedCents;
    await this.prisma.$transaction(async (tx) => {
      await tx.projectBoqLine.deleteMany({ where: { projectId } });
      await tx.project.update({
        where: { id: projectId },
        data: {
          estateBoqId: null,
          allocatedLabourCents: null,
          buildingMatchDiscountCents: 0n,
          labourQuotedCents: restored,
        },
      });
    });
    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'ESTATE_BOQ_CLEAR',
        entityType: 'Project',
        entityId: projectId,
        metadata: { estateId, boqId: house.estateBoqId, boqName: house.estateBoq?.name || null },
      },
    });
    return this.getEstate(estateId);
  }

  private async repriceHouseFromSnapshot(
    projectId: string,
    startLabel: string | null,
    allocatedLabourCents: bigint | null,
  ) {
    const lines = await this.prisma.projectBoqLine.findMany({
      where: { projectId },
      orderBy: { sortOrder: 'asc' },
    });
    if (!lines.length) return;
    const catalog = await this.stageCatalog();
    const priced = this.priceSnapshot(lines, startLabel, catalog);
    const buildingMatch =
      allocatedLabourCents == null ? 0 : priced.labourQuotedCents - Number(allocatedLabourCents);
    await this.prisma.project.update({
      where: { id: projectId },
      data: {
        labourQuotedCents: BigInt(priced.labourQuotedCents),
        buildingMatchDiscountCents: BigInt(buildingMatch),
      },
    });
  }

  private completionPercent(label: string | null | undefined, sequences: string[][]) {
    const name = label?.trim().toLowerCase();
    if (!name) return null;
    for (const sequence of sequences) {
      if (!sequence.length) continue;
      const index = sequence.findIndex((stage) => stage.toLowerCase() === name);
      if (index >= 0) return Math.round(((index + 1) / sequence.length) * 100);
    }
    return null;
  }

  private stageRows(
    houses: any[],
    order: string[],
    sequences: string[][],
    quoteLabels: string[] = [],
  ) {
    const sequence = quoteLabels.length ? quoteLabels : order;
    const idx = (label?: string | null) => {
      if (!label) return -1;
      return sequence.findIndex((n) => n.toLowerCase() === label.trim().toLowerCase());
    };
    return houses.map((h: any) => {
      const startStage = this.resolveQuoteStage(h.catchupStageLabel, quoteLabels);
      const currentStage = this.resolveQuoteStage(h.currentStageLabel, quoteLabels);
      const startIdx = idx(startStage);
      const currentIdx = idx(currentStage);
      return {
        projectId: h.id,
        code: h.code,
        unitNumber: h.unitNumber,
        houseName: h.name,
        ownerName: h.client?.name || '',
        ownerPhone: h.client?.phone || '',
        startStage,
        currentStage,
        currentStageUpdatedAt: h.currentStageUpdatedAt || null,
        stagesAdvanced:
          startIdx >= 0 && currentIdx >= 0 ? currentIdx - startIdx : null,
        currentStageIndex: currentIdx,
        completionPercent: this.completionPercent(
          currentStage,
          quoteLabels.length ? [quoteLabels, ...sequences] : sequences,
        ),
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
    const withCompletion = rows.filter((r) => r.completionPercent !== null);
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
      averageCompletionPercent: withCompletion.length
        ? Math.round(
            withCompletion.reduce((s, r) => s + (r.completionPercent || 0), 0) /
              withCompletion.length,
          )
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
        boqs: {
          select: {
            lines: {
              orderBy: { sortOrder: 'asc' },
              select: { sectionName: true, stageName: true, sortOrder: true },
            },
          },
        },
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
    const { order, construction, legacy } = await this.stageOrder();
    const quoteLabels = this.quoteStageLabels(estate.boqs);
    const rows = this.stageRows(
      estate.projects,
      order,
      [quoteLabels, construction, legacy],
      quoteLabels,
    );
    const rank = quoteLabels.length ? quoteLabels : order;
    return {
      estate: { id: estate.id, code: estate.code, name: estate.name },
      stageOrder: rank,
      rows,
      summary: this.stageSummary(rows, rank),
    };
  }

  async getAllEstatesStageReport() {
    const estates = await this.prisma.estateProgramme.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        code: true,
        name: true,
        boqs: {
          select: {
            lines: {
              orderBy: { sortOrder: 'asc' },
              select: { sectionName: true, stageName: true, sortOrder: true },
            },
          },
        },
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
    const { order, construction, legacy } = await this.stageOrder();
    return {
      stageOrder: order,
      estates: estates.map((e) => {
        const quoteLabels = this.quoteStageLabels(e.boqs);
        const rows = this.stageRows(
          e.projects,
          order,
          [quoteLabels, construction, legacy],
          quoteLabels,
        );
        return {
          id: e.id,
          code: e.code,
          name: e.name,
          summary: this.stageSummary(rows, quoteLabels.length ? quoteLabels : order),
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
      ['Average completion %', s.averageCompletionPercent ?? ''],
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
        'Completion %',
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
        r.completionPercent ?? '',
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
      estateBoqId?: string;
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
    let labourQuotedCents = Math.max(
      0,
      Math.round(
        dto.labourQuotedCents !== undefined
          ? dto.labourQuotedCents
          : Number(estate.baseLabourCents),
      ),
    );
    const discountCents = Math.max(0, Math.round(dto.discountCents || 0));
    const boq = dto.estateBoqId
      ? await this.prisma.estateBoq.findFirst({
          where: { id: dto.estateBoqId, estateProgrammeId: estateId },
          include: { lines: { orderBy: { sortOrder: 'asc' } } },
        })
      : null;
    if (dto.estateBoqId && !boq) throw new NotFoundException('BOQ not found on this estate');
    if (boq) {
      if (!boq.lines.length) throw new BadRequestException('This BOQ has no stages');
      const catalog = await this.stageCatalog();
      labourQuotedCents = this.priceSnapshot(
        boq.lines,
        dto.catchupStageLabel,
        catalog,
      ).labourQuotedCents;
    }
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
        estateBoqId: boq?.id || null,
        buildingMatchDiscountCents: 0n,
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

    if (boq) {
      await this.prisma.projectBoqLine.createMany({
        data: boq.lines.map((l) => ({
          projectId: project.id,
          sectionName: l.sectionName,
          stageName: l.stageName,
          sortOrder: l.sortOrder,
          amountCents: l.amountCents,
        })),
      });
    }

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
      ['Building match discount', (estate.trends.buildingMatchDiscountCents || 0) / 100],
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
        'Building match discount',
        'BOQ',
        'Stage amounts',
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
        (h.trail.buildingMatchDiscountCents || 0) / 100,
        h.estateBoq?.name || '',
        (h.boqStages || [])
          .map(
            (s: any) =>
              `${s.stageName} ${s.amountCents / 100}${s.included ? '' : ' (not charged)'}`,
          )
          .join('; '),
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

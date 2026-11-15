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
import { boqStageLabels, resolveQuoteStage, resolveQuoteStageIndex } from './quote-stages';

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
      buildingMatchDiscountCents: 0,
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
        catchupStageLabel: true,
        estateExpenseListId: true,
        estateBoqId: true,
      },
    });
    const projectIds = projects.map((p) => p.id);
    const [payments, fundUses, ledger, expenseLists, groupExpenses, catalog] = await Promise.all([
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
      this.prisma.estateExpenseList.findMany({
        where: { estateProgrammeId: { in: estateIds } },
        include: {
          lines: true,
          boq: {
            include: {
              lines: { select: { sectionName: true, stageName: true, sortOrder: true } },
            },
          },
        },
      }),
      this.prisma.estateGroupExpense.findMany({
        where: { estateProgrammeId: { in: estateIds } },
        select: { estateBoqId: true, amountCents: true },
      }),
      this.stageCatalog(),
    ]);
    const expenseListById = new Map(expenseLists.map((list) => [list.id, list]));
    const groupExpenseByBoq = new Map<string, number>();
    for (const expense of groupExpenses) {
      groupExpenseByBoq.set(
        expense.estateBoqId,
        (groupExpenseByBoq.get(expense.estateBoqId) || 0) + Number(expense.amountCents),
      );
    }

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
      let cashReceivedCents = 0;
      let fundUsesCents = 0;
      let stageExpenseCents = 0;
      let groupExpenseCents = 0;
      for (const h of houses) {
        labourQuotedCents += Number(h.labourQuotedCents);
        discountCents += Number(h.discountCents);
        cashReceivedCents += cashByProject.get(h.id) || 0;
        fundUsesCents += usesByProject.get(h.id) || 0;
        const list = h.estateExpenseListId ? expenseListById.get(h.estateExpenseListId) : null;
        if (list) {
          stageExpenseCents += this.priceHouseExpenses(list, h.catchupStageLabel, catalog).includedCents;
        }
        if (h.estateBoqId) groupExpenseCents += groupExpenseByBoq.get(h.estateBoqId) || 0;
      }
      const led = ledgerByEstate.get(estate.id) || {
        expenses: 0,
        companyExpenses: 0,
        projectExpenses: 0,
        borrowings: 0,
        repayments: 0,
      };
      const netDueCents = labourQuotedCents - discountCents;
      const cashAtHandCents =
        cashReceivedCents -
        fundUsesCents -
        led.expenses -
        stageExpenseCents -
        groupExpenseCents -
        led.borrowings +
        led.repayments;
      return serializeMoney({
        ...estate,
        projects: [],
        trends: {
          houseCount: houses.length,
          labourQuotedCents,
          discountCents,
          buildingMatchDiscountCents: 0,
          netDueCents,
          cashReceivedCents,
          fundUsesCents,
          expensesCents: led.expenses + stageExpenseCents + groupExpenseCents,
          companyExpensesCents: led.companyExpenses,
          stageExpenseCents,
          groupExpenseCents,
          ledgerProjectExpensesCents: led.projectExpenses,
          projectExpensesCents: led.projectExpenses + stageExpenseCents + groupExpenseCents,
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
            estateExpenseListId: true,
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
        expenseLists: {
          orderBy: { createdAt: 'asc' },
          include: {
            lines: { orderBy: { sortOrder: 'asc' } },
            boq: {
              select: {
                id: true,
                name: true,
                lines: {
                  orderBy: { sortOrder: 'asc' },
                  select: {
                    sectionName: true,
                    stageName: true,
                    sortOrder: true,
                    amountCents: true,
                  },
                },
              },
            },
          },
        },
        groupExpenses: {
          orderBy: { createdAt: 'asc' },
          include: { boq: { select: { id: true, name: true } } },
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
    const listsById = new Map((estate.expenseLists || []).map((list: any) => [list.id, list]));
    const groupByBoq = new Map<string, any[]>();
    for (const expense of estate.groupExpenses || []) {
      const rows = groupByBoq.get(expense.estateBoqId) || [];
      rows.push(expense);
      groupByBoq.set(expense.estateBoqId, rows);
    }
    const houses = (estate.projects || []).map((p: any) => {
      const priced = (p.boqLines || []).length
        ? this.priceSnapshot(p.boqLines, p.catchupStageLabel, catalog)
        : null;
      const expense = this.priceHouseExpenses(
        p.estateExpenseListId ? (listsById.get(p.estateExpenseListId) as any) : null,
        p.catchupStageLabel,
        catalog,
      );
      const groupRows = p.estateBoqId ? groupByBoq.get(p.estateBoqId) || [] : [];
      const groupExpenseCents = groupRows.reduce(
        (sum: number, row: any) => sum + Number(row.amountCents),
        0,
      );
      const trail = this.moneyTrail(p);
      const expenseIncludedCents = expense.includedCents;
      // Client bill (stages from start − discount) vs our stage+group cost on those stages.
      const jobCostCents = expenseIncludedCents + groupExpenseCents;
      const marginCents = trail.netDueCents - jobCostCents;
      return {
        ...p,
        trail,
        boqStages: priced?.stages || [],
        expenseList: expense.listId
          ? { id: expense.listId, name: expense.listName, quotationName: expense.quotationName }
          : null,
        expenseStages: expense.stages,
        expenseIncludedCents,
        groupExpenses: groupRows.map((row: any) => ({
          id: row.id,
          description: row.description,
          amountCents: Number(row.amountCents),
        })),
        groupExpenseCents,
        jobCostCents,
        marginCents,
      };
    });
    const expenseLists = (estate.expenseLists || []).map((list: any) => {
      const view = this.priceHouseExpenses(list, null, catalog);
      return {
        id: list.id,
        name: list.name,
        estateBoqId: list.estateBoqId,
        boq: list.boq ? { id: list.boq.id, name: list.boq.name } : null,
        stages: view.stages,
        ready: view.ready,
        missingCount: view.missingCount,
        enteredCents: view.includedCents,
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
    const ledgerProjectExpensesCents = expenseRows
      .filter((e: any) => e.expenseCategory === EstateExpenseCategory.PROJECT)
      .reduce((s: number, e: any) => s + Number(e.amountCents), 0);
    const stageExpenseCents = houses.reduce(
      (s: number, h: any) => s + Number(h.expenseIncludedCents || 0),
      0,
    );
    const groupExpenseCents = houses.reduce(
      (s: number, h: any) => s + Number(h.groupExpenseCents || 0),
      0,
    );
    const projectExpensesCents = ledgerProjectExpensesCents + stageExpenseCents + groupExpenseCents;
    const companyExpensesCents = expensesCents - ledgerProjectExpensesCents;
    const expensesWithStagesCents = expensesCents + stageExpenseCents + groupExpenseCents;
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
      expensesCents: expensesWithStagesCents,
      companyExpensesCents,
      ledgerProjectExpensesCents,
      stageExpenseCents,
      groupExpenseCents,
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
      // Quotation net due vs stage+group expenses (food etc.) — margin before labour cash uses.
      jobCostCents: houses.reduce((s: number, h: any) => s + Number(h.jobCostCents || 0), 0),
      marginCents: houses.reduce((s: number, h: any) => s + Number(h.marginCents || 0), 0),
    };
    const { stageCatalog: _stageCatalog, ...estateRest } = estate;
    const groupExpenses = (estate.groupExpenses || []).map((expense: any) => {
      const matched = houses.filter((house: any) => house.estateBoqId === expense.estateBoqId);
      const amountCents = Number(expense.amountCents);
      return {
        id: expense.id,
        description: expense.description,
        partyName: expense.partyName || '',
        amountCents,
        estateBoqId: expense.estateBoqId,
        boq: expense.boq ? { id: expense.boq.id, name: expense.boq.name } : null,
        houseCount: matched.length,
        totalCents: amountCents * matched.length,
      };
    });
    return serializeMoney({
      ...estateRest,
      projects: houses,
      expenseLists,
      groupExpenses,
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

    const housesOnExpenseList = (estate.projects || []).filter((h: any) => h.expenseList?.id);
    if (housesOnExpenseList.length) {
      labourLines.push({
        date: '',
        description: `Stage expenses (${housesOnExpenseList.length} house${
          housesOnExpenseList.length === 1 ? '' : 's'
        })`,
        debitCents: 0,
        creditCents: housesOnExpenseList.reduce(
          (sum: number, h: any) => sum + Number(h.expenseIncludedCents || 0),
          0,
        ),
        section: 'STAGE_EXPENSE',
      });
    }

    const housesOnGroupExpense = (estate.projects || []).filter(
      (h: any) => Number(h.groupExpenseCents || 0) > 0,
    );
    if (housesOnGroupExpense.length) {
      labourLines.push({
        date: '',
        description: `Group expenses (${housesOnGroupExpense.length} house${
          housesOnGroupExpense.length === 1 ? '' : 's'
        })`,
        debitCents: 0,
        creditCents: housesOnGroupExpense.reduce(
          (sum: number, h: any) => sum + Number(h.groupExpenseCents || 0),
          0,
        ),
        section: 'GROUP_EXPENSE',
      });
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
      include: {
        client: true,
        estateBoq: { select: { name: true } },
        boqLines: { select: { id: true, stageName: true, sortOrder: true } },
      },
    });
    if (!project) throw new NotFoundException('House not found in this estate');
    if (project.boqLines.length) {
      // Start stage must be on this house's BOQ (it cuts the bill).
      // Current stage is progress and may be outside the quotation.
      const boqName = project.estateBoq?.name || '';
      if (dto.catchupStageLabel !== undefined) {
        dto.catchupStageLabel = this.stageOnBoq(
          dto.catchupStageLabel,
          project.boqLines,
          boqName,
          project.name,
        );
      }
    }

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
      await this.repriceHouseFromSnapshot(projectId, nextStart);
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
    const projectIds = [...new Set(dto.projectIds)];
    const where = {
      id: { in: projectIds },
      estateProgrammeId: estateId,
      kind: ProjectKind.ESTATE_UNIT,
    };
    const targets = await this.prisma.project.findMany({
      where,
      select: {
        id: true,
        name: true,
        allocatedLabourCents: true,
        estateBoq: { select: { name: true } },
        boqLines: { select: { stageName: true, sortOrder: true } },
      },
    });
    if (targets.length !== projectIds.length) {
      throw new BadRequestException('Some selected houses do not belong to this estate');
    }
    // Start stage must be on each house's BOQ. Current stage is progress (any label).
    const updates = targets.map((house) => {
      const hasBoq = house.boqLines.length > 0;
      const boqName = house.estateBoq?.name || '';
      const start =
        dto.catchupStageLabel !== undefined
          ? (hasBoq
              ? this.stageOnBoq(dto.catchupStageLabel, house.boqLines, boqName, house.name)
              : dto.catchupStageLabel.trim()) || null
          : undefined;
      const current =
        dto.currentStageLabel !== undefined
          ? dto.currentStageLabel.trim() || null
          : undefined;
      return { house, hasBoq, start, current };
    });
    await this.prisma.$transaction(
      async (tx) => {
        for (const { house, start, current } of updates) {
          await tx.project.update({
            where: { id: house.id },
            data: {
              ...(start !== undefined ? { catchupStageLabel: start } : {}),
              ...(current !== undefined
                ? { currentStageLabel: current, currentStageUpdatedAt: new Date() }
                : {}),
            },
          });
        }
      },
      { timeout: 60000 },
    );
    const result = { count: updates.length };

    if (dto.catchupStageLabel !== undefined) {
      for (const { house, hasBoq, start } of updates) {
        if (!hasBoq) continue;
        await this.repriceHouseFromSnapshot(house.id, start ?? null);
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

  /**
   * Where a house starts on its BOQ. Only the BOQ's own stages count: a stage that is not
   * on the BOQ gives no start (the whole BOQ is charged), never a position from elsewhere.
   */
  private startSortOrder(
    label: string | null | undefined,
    _catalog: { name: string; sortOrder: number }[],
    lines: { sectionName?: string | null; stageName: string; sortOrder: number }[],
  ) {
    if (!label?.trim()) return null;
    const ordered = [...lines].sort((a, b) => a.sortOrder - b.sortOrder);
    const index = resolveQuoteStageIndex(
      label,
      ordered.map((line) => this.lineLabel(line)),
    );
    return index < 0 ? null : ordered[index].sortOrder;
  }

  /**
   * A stage chosen for a house must be one of the stages on that house's BOQ.
   * Returns the BOQ's own spelling of the stage ('' clears it).
   */
  private stageOnBoq(
    label: string | null | undefined,
    lines: { stageName: string; sortOrder: number }[],
    boqName: string,
    houseName: string,
  ) {
    const wanted = label?.trim() || '';
    if (!wanted) return '';
    const resolved = resolveQuoteStage(wanted, boqStageLabels(lines), true);
    if (!resolved) {
      throw new BadRequestException(
        `"${wanted}" is not a stage on ${boqName || 'this BOQ'} (${houseName}). A house only has the stages of its BOQ.`,
      );
    }
    return resolved;
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

  private stageKey(sectionName?: string | null, stageName?: string | null) {
    return `${(sectionName || '').trim().toLowerCase()}||${(stageName || '').trim().toLowerCase()}`;
  }

  private priceHouseExpenses(
    list: {
      id: string;
      name: string;
      lines?: {
        sectionName?: string | null;
        stageName: string;
        sortOrder: number;
        amountCents: bigint | number;
      }[];
      boq?: {
        id?: string;
        name?: string;
        lines?: { sectionName?: string | null; stageName: string; sortOrder: number }[];
      } | null;
    } | null | undefined,
    startLabel: string | null | undefined,
    catalog: { name: string; sortOrder: number }[],
  ) {
    if (!list) {
      return {
        listId: null as string | null,
        listName: null as string | null,
        quotationName: '',
        stages: [] as {
          sectionName: string;
          stageName: string;
          sortOrder: number;
          amountCents: number | null;
          entered: boolean;
          included: boolean;
          message: string;
        }[],
        includedCents: 0,
        missingCount: 0,
        ready: false,
      };
    }
    const boqLines = [...(list.boq?.lines || [])].sort((a, b) => a.sortOrder - b.sortOrder);
    const start = this.startSortOrder(startLabel, catalog, boqLines);
    const entered = new Map(
      (list.lines || []).map((line) => [this.stageKey(line.sectionName, line.stageName), line]),
    );
    let includedCents = 0;
    const stages = boqLines.map((line) => {
      const hit = entered.get(this.stageKey(line.sectionName, line.stageName));
      const amountCents = hit ? Number(hit.amountCents) : null;
      const hasAmount = !!hit;
      const included = hasAmount && (start === null || line.sortOrder >= start);
      if (included && amountCents) includedCents += amountCents;
      return {
        sectionName: line.sectionName || '',
        stageName: line.stageName,
        sortOrder: line.sortOrder,
        amountCents,
        entered: hasAmount,
        included,
        message: hasAmount ? '' : 'This stage from the quotation has not been entered yet.',
      };
    });
    return {
      listId: list.id,
      listName: list.name,
      quotationName: list.boq?.name || '',
      stages,
      includedCents,
      missingCount: stages.filter((stage) => !stage.entered).length,
      ready: stages.length > 0 && stages.every((stage) => stage.entered),
    };
  }

  private expenseLinesForQuotation(
    boqLines: { sectionName?: string | null; stageName: string; sortOrder: number }[],
    submitted: {
      sectionName?: string | null;
      stageName?: string | null;
      amountCents?: number | null;
    }[],
  ) {
    const quotation = new Map(
      boqLines.map((line) => [this.stageKey(line.sectionName, line.stageName), line]),
    );
    const seen = new Set<string>();
    const saved: {
      sectionName: string | null;
      stageName: string;
      sortOrder: number;
      amountCents: number;
    }[] = [];
    for (const line of submitted || []) {
      const stageName = line.stageName?.trim() || '';
      if (!stageName) continue;
      const key = this.stageKey(line.sectionName, stageName);
      const match = quotation.get(key);
      if (!match) {
        const label = line.sectionName?.trim()
          ? `${line.sectionName.trim()} · ${stageName}`
          : stageName;
        throw new BadRequestException(`${label} is not on this quotation`);
      }
      if (seen.has(key)) {
        throw new BadRequestException(`${match.stageName} is already on this list`);
      }
      seen.add(key);
      if (line.amountCents === undefined || line.amountCents === null) continue;
      const amountCents = Math.round(Number(line.amountCents));
      if (!Number.isFinite(amountCents) || amountCents < 0) {
        throw new BadRequestException(`Enter an amount for ${match.stageName}`);
      }
      saved.push({
        sectionName: match.sectionName?.trim() || null,
        stageName: match.stageName,
        sortOrder: match.sortOrder,
        amountCents,
      });
    }
    return saved;
  }

  private async requireEstateExpenseQuotation(estateId: string, estateBoqId: string) {
    const boq = await this.prisma.estateBoq.findFirst({
      where: { id: estateBoqId, estateProgrammeId: estateId },
      include: { lines: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!boq) throw new NotFoundException('Quotation not found');
    if (!boq.lines.length) throw new BadRequestException('This quotation has no stages');
    return boq;
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

  async createEstateExpenseList(
    estateId: string,
    dto: {
      name: string;
      estateBoqId: string;
      lines?: {
        sectionName?: string | null;
        stageName?: string | null;
        amountCents?: number | null;
      }[];
    },
  ) {
    const name = dto.name?.trim();
    if (!name) throw new BadRequestException('Expense list name is required');
    const boq = await this.requireEstateExpenseQuotation(estateId, dto.estateBoqId);
    const lines = this.expenseLinesForQuotation(boq.lines, dto.lines || []);
    await this.prisma.estateExpenseList.create({
      data: {
        estateProgrammeId: estateId,
        estateBoqId: boq.id,
        name,
        lines: {
          create: lines.map((line) => ({
            sectionName: line.sectionName,
            stageName: line.stageName,
            sortOrder: line.sortOrder,
            amountCents: BigInt(line.amountCents),
          })),
        },
      },
    });
    return this.getEstate(estateId);
  }

  async updateEstateExpenseList(
    estateId: string,
    listId: string,
    dto: {
      name?: string;
      estateBoqId?: string;
      lines?: {
        sectionName?: string | null;
        stageName?: string | null;
        amountCents?: number | null;
      }[];
    },
  ) {
    const existing = await this.prisma.estateExpenseList.findFirst({
      where: { id: listId, estateProgrammeId: estateId },
    });
    if (!existing) throw new NotFoundException('Expense list not found');
    if (dto.estateBoqId && dto.estateBoqId !== existing.estateBoqId) {
      throw new BadRequestException(
        'This list follows one quotation. Create another list for a different quotation.',
      );
    }
    const name = dto.name !== undefined ? dto.name.trim() : existing.name;
    if (!name) throw new BadRequestException('Expense list name is required');
    const boq = await this.requireEstateExpenseQuotation(estateId, existing.estateBoqId);
    const lines = dto.lines ? this.expenseLinesForQuotation(boq.lines, dto.lines) : null;
    await this.prisma.$transaction(async (tx) => {
      if (lines) {
        await tx.estateExpenseListLine.deleteMany({ where: { estateExpenseListId: listId } });
      }
      await tx.estateExpenseList.update({
        where: { id: listId },
        data: {
          name,
          ...(lines
            ? {
                lines: {
                  create: lines.map((line) => ({
                    sectionName: line.sectionName,
                    stageName: line.stageName,
                    sortOrder: line.sortOrder,
                    amountCents: BigInt(line.amountCents),
                  })),
                },
              }
            : {}),
        },
      });
    });
    return this.getEstate(estateId);
  }

  async deleteEstateExpenseList(estateId: string, listId: string) {
    const existing = await this.prisma.estateExpenseList.findFirst({
      where: { id: listId, estateProgrammeId: estateId },
    });
    if (!existing) throw new NotFoundException('Expense list not found');
    await this.prisma.estateExpenseList.delete({ where: { id: listId } });
    return this.getEstate(estateId);
  }

  async createEstateGroupExpense(
    estateId: string,
    dto: {
      estateBoqId: string;
      description: string;
      amountCents: number;
      partyName?: string;
      createdById?: string;
    },
  ) {
    const description = dto.description?.trim();
    if (!description) throw new BadRequestException('Say what the group expense was for');
    const amountCents = Math.round(Number(dto.amountCents));
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      throw new BadRequestException('Enter the amount for this group expense');
    }
    const boq = await this.prisma.estateBoq.findFirst({
      where: { id: dto.estateBoqId, estateProgrammeId: estateId },
      select: { id: true },
    });
    if (!boq) throw new NotFoundException('Quotation not found');
    await this.prisma.estateGroupExpense.create({
      data: {
        estateProgrammeId: estateId,
        estateBoqId: boq.id,
        description,
        amountCents: BigInt(amountCents),
        partyName: dto.partyName?.trim() || null,
        createdById: dto.createdById || null,
      },
    });
    return this.getEstate(estateId);
  }

  private expenseListFitsHouse(
    listBoq: { id: string; name: string } | null | undefined,
    house: { estateBoqId: string | null; estateBoq?: { name: string } | null },
  ) {
    if (!listBoq?.name || !house.estateBoqId || !house.estateBoq?.name) return false;
    if (house.estateBoqId === listBoq.id) return true;
    const listName = listBoq.name.trim().toLowerCase();
    const base = listName.replace(/\s+labour stages$/, '');
    return base !== listName && base === house.estateBoq.name.trim().toLowerCase();
  }

  async deleteEstateGroupExpense(estateId: string, expenseId: string) {
    const existing = await this.prisma.estateGroupExpense.findFirst({
      where: { id: expenseId, estateProgrammeId: estateId },
    });
    if (!existing) throw new NotFoundException('Group expense not found');
    await this.prisma.estateGroupExpense.delete({ where: { id: expenseId } });
    return this.getEstate(estateId);
  }

  async applyEstateExpenseList(
    estateId: string,
    listId: string,
    dto: { projectIds: string[] },
  ) {
    if (!dto.projectIds?.length) throw new BadRequestException('Select at least one house');
    const list = await this.prisma.estateExpenseList.findFirst({
      where: { id: listId, estateProgrammeId: estateId },
      include: {
        lines: true,
        boq: { include: { lines: { orderBy: { sortOrder: 'asc' } } } },
      },
    });
    if (!list) throw new NotFoundException('Expense list not found');
    const priced = this.priceHouseExpenses(list, null, []);
    if (!priced.ready) {
      throw new BadRequestException(
        'Enter an expense amount for every stage on the quotation before applying this list',
      );
    }
    const houses = await this.prisma.project.findMany({
      where: {
        id: { in: dto.projectIds },
        estateProgrammeId: estateId,
        kind: ProjectKind.ESTATE_UNIT,
      },
      select: {
        id: true,
        name: true,
        estateBoqId: true,
        catchupStageLabel: true,
        estateBoq: { select: { id: true, name: true } },
      },
    });
    if (houses.length !== dto.projectIds.length) {
      throw new BadRequestException('Some selected houses do not belong to this estate');
    }
    const unfit = houses.filter((house) => !this.expenseListFitsHouse(list.boq, house));
    if (unfit.length) {
      throw new BadRequestException(
        `${list.name} follows ${list.boq?.name || 'one quotation'}. These houses are not on that quotation: ${unfit
          .map((house) => house.name)
          .join(', ')}.`,
      );
    }
    const stageLabels = boqStageLabels(list.boq?.lines || []);
    const unresolved = houses.filter(
      (house) =>
        !!house.catchupStageLabel?.trim() &&
        !resolveQuoteStage(house.catchupStageLabel, stageLabels, true),
    );
    if (unresolved.length) {
      throw new BadRequestException(
        `The start stage is not on this expense list, so the earlier stages cannot be removed: ${unresolved
          .map((house) => `${house.name} (${house.catchupStageLabel})`)
          .join(', ')}.`,
      );
    }
    await this.prisma.project.updateMany({
      where: { id: { in: houses.map((house) => house.id) } },
      data: { estateExpenseListId: list.id },
    });
    return this.getEstate(estateId);
  }

  async clearEstateHouseExpenseList(estateId: string, projectId: string) {
    const house = await this.prisma.project.findFirst({
      where: { id: projectId, estateProgrammeId: estateId, kind: ProjectKind.ESTATE_UNIT },
      select: { id: true, estateExpenseListId: true },
    });
    if (!house) throw new NotFoundException('House not found');
    if (!house.estateExpenseListId) {
      throw new BadRequestException('This house has no stage expense list');
    }
    await this.prisma.project.update({
      where: { id: house.id },
      data: { estateExpenseListId: null },
    });
    return this.getEstate(estateId);
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
    // A stage expense list follows one BOQ. A house moving to a different BOQ cannot keep
    // a list that was built on the old one, or its stage expenses would be worked out
    // against stages it no longer has.
    const expenseLists = await this.prisma.estateExpenseList.findMany({
      where: { estateProgrammeId: estateId },
      select: { id: true, boq: { select: { id: true, name: true } } },
    });
    await this.prisma.$transaction(
      async (tx) => {
        for (const house of houses) {
          const linkedList = expenseLists.find((list) => list.id === house.estateExpenseListId);
          const staleExpenseList =
            !!linkedList &&
            !this.expenseListFitsHouse(linkedList.boq, {
              estateBoqId: boq.id,
              estateBoq: { name: boq.name },
            });
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
          // Start stage must sit on this BOQ (aliases allowed) — it cuts the bill.
          // Current stage is progress only and may be a label outside the quotation (e.g. Walls).
          const boqLabels = boqStageLabels(boq.lines);
          const startStage = resolveQuoteStage(house.catchupStageLabel, boqLabels, true) || null;
          const currentStage = house.currentStageLabel?.trim() || null;
          const priced = this.priceSnapshot(boq.lines, startStage, catalog);
          await tx.project.update({
            where: { id: house.id },
            data: {
              estateBoqId: boq.id,
              ...(staleExpenseList ? { estateExpenseListId: null } : {}),
              catchupStageLabel: startStage,
              currentStageLabel: currentStage,
              allocatedLabourCents: null,
              labourQuotedCents: BigInt(priced.labourQuotedCents),
              buildingMatchDiscountCents: 0n,
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
    await this.prisma.$transaction(async (tx) => {
      await tx.projectBoqLine.deleteMany({ where: { projectId } });
      await tx.project.update({
        where: { id: projectId },
        data: {
          estateBoqId: null,
          allocatedLabourCents: null,
          buildingMatchDiscountCents: 0n,
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

  private async repriceHouseFromSnapshot(projectId: string, startLabel: string | null) {
    const lines = await this.prisma.projectBoqLine.findMany({
      where: { projectId },
      orderBy: { sortOrder: 'asc' },
    });
    if (!lines.length) return;
    const catalog = await this.stageCatalog();
    const priced = this.priceSnapshot(lines, startLabel, catalog);
    await this.prisma.project.update({
      where: { id: projectId },
      data: {
        labourQuotedCents: BigInt(priced.labourQuotedCents),
        buildingMatchDiscountCents: 0n,
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
    return houses.map((h: any) => {
      // A house with a BOQ has exactly that BOQ's stages. Anything else it might still
      // carry from before is not shown. Houses without a BOQ follow the estate's stages.
      const ownLabels: string[] = (h.boqLines || []).length ? boqStageLabels(h.boqLines) : [];
      const hasBoq = ownLabels.length > 0;
      const labels = hasBoq ? ownLabels : quoteLabels;
      const sequence = labels.length ? labels : order;
      const idx = (label?: string | null) => {
        if (!label) return -1;
        return sequence.findIndex((n) => n.toLowerCase() === label.trim().toLowerCase());
      };
      const startStage = resolveQuoteStage(h.catchupStageLabel, labels, hasBoq);
      // Progress label is stored as-is (may be outside the BOQ, e.g. Walls).
      const currentStage = (h.currentStageLabel || '').trim();
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
          hasBoq ? [ownLabels] : labels.length ? [labels, ...sequences] : sequences,
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
            boqLines: {
              orderBy: { sortOrder: 'asc' },
              select: { stageName: true, sortOrder: true },
            },
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
            boqLines: {
              orderBy: { sortOrder: 'asc' },
              select: { stageName: true, sortOrder: true },
            },
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
      const houseLabel = dto.houseName?.trim() || 'new house';
      dto.catchupStageLabel = this.stageOnBoq(dto.catchupStageLabel, boq.lines, boq.name, houseLabel);
      dto.currentStageLabel = this.stageOnBoq(dto.currentStageLabel, boq.lines, boq.name, houseLabel);
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

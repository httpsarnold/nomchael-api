import { Controller, Get, UseGuards } from '@nestjs/common';
import { ExpenseScope, ProjectStatus, QuotationStatus, ShortfallStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('dashboard')
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(private prisma: PrismaService) {}

  @Get()
  async summary() {
    const now = new Date();
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);

    // Keep to a small number of round-trips (Supabase EU latency adds up when queued)
    const [projects, payments, expenses, clientsCount, employeesCount, suppliersCount, pendingShortfalls, draftQuotations, stockItems] =
      await Promise.all([
        this.prisma.project.findMany({
          select: {
            id: true,
            code: true,
            name: true,
            status: true,
            quotationTotalCents: true,
            amountPaidCents: true,
            client: { select: { name: true } },
            stages: { select: { isCompleted: true } },
          },
          orderBy: { updatedAt: 'desc' },
          take: 200,
        }),
        this.prisma.payment.findMany({
          where: { deletedAt: null },
          select: {
            id: true,
            receiptNumber: true,
            amountCents: true,
            method: true,
            paidAt: true,
            project: { select: { code: true, client: { select: { name: true } } } },
          },
          orderBy: { paidAt: 'desc' },
          take: 100,
        }),
        this.prisma.expense.findMany({
          where: { deletedAt: null },
          select: {
            id: true,
            category: true,
            description: true,
            amountCents: true,
            scope: true,
            expenseDate: true,
            projectId: true,
            project: { select: { code: true } },
          },
          orderBy: { expenseDate: 'desc' },
          take: 100,
        }),
        this.prisma.client.count(),
        this.prisma.employee.count({ where: { isActive: true } }),
        this.prisma.supplier.count({ where: { isActive: true } }),
        this.prisma.shortfall.findMany({
          where: { status: ShortfallStatus.PENDING },
          select: {
            id: true,
            amountCents: true,
            reason: true,
            project: { select: { code: true, name: true } },
          },
          take: 10,
        }),
        this.prisma.quotation.count({
          where: { status: { in: [QuotationStatus.DRAFT, QuotationStatus.SENT] } },
        }),
        this.prisma.projectStock.findMany({
          select: {
            id: true,
            itemName: true,
            unit: true,
            qtyPurchased: true,
            qtyUsed: true,
            qtySold: true,
            qtyReturned: true,
            qtyTransferredOut: true,
            qtyTransferredIn: true,
            project: { select: { code: true, name: true } },
          },
          take: 40,
        }),
      ]);

    const openStatuses: ProjectStatus[] = [
      ProjectStatus.ACTIVE,
      ProjectStatus.QUOTED,
      ProjectStatus.ON_HOLD,
    ];
    const open = projects.filter((p) => openStatuses.includes(p.status));
    const completed = projects.filter((p) => p.status === ProjectStatus.COMPLETED).length;

    const revenueOpen = open.reduce((s, p) => s + Number(p.amountPaidCents), 0);
    const dueOpen = open.reduce(
      (s, p) => s + Number(p.quotationTotalCents - p.amountPaidCents),
      0,
    );
    const quotedTotal = open.reduce((s, p) => s + Number(p.quotationTotalCents), 0);

    const projectExp = expenses
      .filter((e) => e.scope === ExpenseScope.PROJECT)
      .reduce((s, e) => s + Number(e.amountCents), 0);
    const generalExp = expenses
      .filter((e) => e.scope === ExpenseScope.GENERAL)
      .reduce((s, e) => s + Number(e.amountCents), 0);
    const totalPayments = payments.reduce((s, p) => s + Number(p.amountCents), 0);
    const profit = totalPayments - projectExp - generalExp;

    const expenseMap = new Map<string, number>();
    for (const e of expenses) {
      if (!e.projectId || e.scope !== ExpenseScope.PROJECT) continue;
      expenseMap.set(e.projectId, (expenseMap.get(e.projectId) || 0) + Number(e.amountCents));
    }

    const byStatus = [
      { status: 'DRAFT', count: projects.filter((p) => p.status === ProjectStatus.DRAFT).length },
      { status: 'QUOTED', count: projects.filter((p) => p.status === ProjectStatus.QUOTED).length },
      { status: 'ACTIVE', count: projects.filter((p) => p.status === ProjectStatus.ACTIVE).length },
      { status: 'ON_HOLD', count: projects.filter((p) => p.status === ProjectStatus.ON_HOLD).length },
      { status: 'COMPLETED', count: completed },
    ];

    const byProject = open.map((p) => {
      const exp = expenseMap.get(p.id) || 0;
      const rev = Number(p.amountPaidCents);
      return {
        id: p.id,
        code: p.code,
        name: p.name,
        status: p.status,
        clientName: p.client?.name || '',
        revenueCents: rev,
        expenseCents: exp,
        profitCents: rev - exp,
        amountDueCents: Number(p.quotationTotalCents - p.amountPaidCents),
        quotationTotalCents: Number(p.quotationTotalCents),
        completionPercent: Math.round(
          (p.stages.filter((s) => s.isCompleted).length / (p.stages.length || 1)) * 100,
        ),
      };
    });

    const attention = [...byProject]
      .filter((p) => p.amountDueCents > 0 || p.completionPercent < 100)
      .sort((a, b) => b.amountDueCents - a.amountDueCents)
      .slice(0, 8);

    const months: {
      label: string;
      revenueCents: number;
      expenseCents: number;
      profitCents: number;
    }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59);
      const label = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const revenueCents = payments
        .filter((p) => p.paidAt >= sixMonthsAgo && p.paidAt >= d && p.paidAt <= end)
        .reduce((s, p) => s + Number(p.amountCents), 0);
      const expenseCents = expenses
        .filter((e) => e.expenseDate >= sixMonthsAgo && e.expenseDate >= d && e.expenseDate <= end)
        .reduce((s, e) => s + Number(e.amountCents), 0);
      months.push({
        label,
        revenueCents,
        expenseCents,
        profitCents: revenueCents - expenseCents,
      });
    }

    const recentPayments = payments.slice(0, 8).map((p) => ({
      id: p.id,
      receiptNumber: p.receiptNumber,
      amountCents: Number(p.amountCents),
      method: p.method,
      paidAt: p.paidAt,
      projectCode: p.project.code,
      clientName: p.project.client?.name,
    }));

    const recentExpenses = expenses.slice(0, 8).map((e) => ({
      id: e.id,
      category: e.category,
      description: e.description,
      amountCents: Number(e.amountCents),
      scope: e.scope,
      expenseDate: e.expenseDate,
      projectCode: e.project?.code,
    }));

    const lowStock = stockItems
      .map((i) => {
        const remaining =
          Number(i.qtyPurchased) +
          Number(i.qtyTransferredIn) -
          Number(i.qtyUsed) -
          Number(i.qtySold) -
          Number(i.qtyReturned) -
          Number(i.qtyTransferredOut);
        return {
          id: i.id,
          itemName: i.itemName,
          unit: i.unit,
          qtyRemaining: remaining,
          projectCode: i.project?.code,
          projectName: i.project?.name,
        };
      })
      .filter((i) => i.qtyRemaining > 0 && i.qtyRemaining <= 5)
      .slice(0, 6);

    return {
      kpis: {
        openProjects: open.length,
        totalProjects: projects.length,
        completedProjects: completed,
        clients: clientsCount,
        employees: employeesCount,
        suppliers: suppliersCount,
        pendingQuotations: draftQuotations,
        pendingShortfalls: pendingShortfalls.length,
        revenueOpenCents: revenueOpen,
        quotedTotalCents: quotedTotal,
        amountDueCents: dueOpen,
        projectExpenseCents: projectExp,
        generalExpenseCents: generalExp,
        profitCents: profit,
        collectionRate:
          quotedTotal > 0 ? Math.round((revenueOpen / quotedTotal) * 100) : 0,
      },
      byStatus,
      byProject,
      attention,
      monthly: months,
      pendingShortfalls: pendingShortfalls.map((s) => ({
        id: s.id,
        amountCents: Number(s.amountCents),
        reason: s.reason,
        projectCode: s.project.code,
        projectName: s.project.name,
      })),
      recentPayments,
      recentExpenses,
      lowStock,
    };
  }
}

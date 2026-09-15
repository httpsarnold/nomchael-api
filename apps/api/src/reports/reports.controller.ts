import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ExpenseScope, PaymentPurpose, ProjectStatus, StockMovementType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('reports')
@UseGuards(JwtAuthGuard)
export class ReportsController {
  constructor(private prisma: PrismaService) {}

  @Get('project/:id/pnl')
  async projectPnl(@Param('id') id: string) {
    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id },
      include: {
        expenses: { where: { deletedAt: null } },
        payments: { where: { deletedAt: null } },
        assignments: true,
        stockItems: { include: { movements: true } },
        stages: true,
      },
    });

    const projectPaymentCents = project.payments
      .filter((p) => p.purpose !== PaymentPurpose.SITE_VISIT)
      .reduce((s, p) => s + Number(p.amountCents), 0);
    const siteVisitFeeCents = project.payments
      .filter((p) => p.purpose === PaymentPurpose.SITE_VISIT)
      .reduce((s, p) => s + Number(p.amountCents), 0);
    const revenuePayments = projectPaymentCents + siteVisitFeeCents;
    const stockSales = project.stockItems
      .flatMap((i) => i.movements)
      .filter((m) => m.type === StockMovementType.SELL)
      .reduce((s, m) => s + Number(m.quantity) * Number(m.unitPriceCents || 0), 0);
    const revenue = revenuePayments + stockSales;

    const expenses = project.expenses.reduce((s, e) => s + Number(e.amountCents), 0);
    const labour = project.assignments.reduce(
      (s, a) => s + Math.round(Number(a.dailyWageCents) * Number(a.daysWorked)),
      0,
    );
    const stageLabour = project.stages.reduce((s, st) => s + Number(st.labourCents), 0);
    const totalExpenses = expenses + labour;
    const profit = revenue - totalExpenses;

    return {
      projectId: id,
      code: project.code,
      name: project.name,
      quotationTotalCents: Number(project.quotationTotalCents),
      amountPaidCents: Number(project.amountPaidCents),
      amountDueCents: Number(project.quotationTotalCents - project.amountPaidCents),
      revenueCents: revenue,
      paymentRevenueCents: revenuePayments,
      projectPaymentRevenueCents: projectPaymentCents,
      siteVisitFeeRevenueCents: siteVisitFeeCents,
      stockSaleRevenueCents: stockSales,
      expenseCents: expenses,
      labourAssignmentCents: labour,
      stageLabourQuotedCents: stageLabour,
      totalExpenseCents: totalExpenses,
      profitCents: profit,
      expenseBreakdown: project.expenses.map((e) => ({
        category: e.category,
        description: e.description,
        amountCents: Number(e.amountCents),
        date: e.expenseDate,
      })),
    };
  }

  @Get('company/income-statement')
  async incomeStatement(@Query('from') from?: string, @Query('to') to?: string) {
    const fromDate = from ? new Date(from) : new Date(new Date().getFullYear(), 0, 1);
    const toDate = to ? new Date(to) : new Date();

    const payments = await this.prisma.payment.findMany({
      where: { deletedAt: null, paidAt: { gte: fromDate, lte: toDate } },
    });
    const stockSales = await this.prisma.stockMovement.findMany({
      where: { type: StockMovementType.SELL, createdAt: { gte: fromDate, lte: toDate } },
    });
    const expenses = await this.prisma.expense.findMany({
      where: { deletedAt: null, expenseDate: { gte: fromDate, lte: toDate } },
    });
    const assignments = await this.prisma.projectAssignment.findMany();

    const projectPayments = payments.filter((p) => p.purpose !== PaymentPurpose.SITE_VISIT);
    const siteVisitPayments = payments.filter((p) => p.purpose === PaymentPurpose.SITE_VISIT);
    const revenueProjectPayments = projectPayments.reduce((s, p) => s + Number(p.amountCents), 0);
    const revenueSiteVisitFees = siteVisitPayments.reduce((s, p) => s + Number(p.amountCents), 0);
    const revenueStock = stockSales.reduce(
      (s, m) => s + Number(m.quantity) * Number(m.unitPriceCents || 0),
      0,
    );
    const projectExpenses = expenses
      .filter((e) => e.scope === ExpenseScope.PROJECT)
      .reduce((s, e) => s + Number(e.amountCents), 0);
    const generalExpenses = expenses
      .filter((e) => e.scope === ExpenseScope.GENERAL)
      .reduce((s, e) => s + Number(e.amountCents), 0);
    const wages = assignments.reduce(
      (s, a) => s + Math.round(Number(a.dailyWageCents) * Number(a.daysWorked)),
      0,
    );

    const revenue = revenueProjectPayments + revenueSiteVisitFees + revenueStock;
    const cogsLike = projectExpenses + wages;
    const grossProfit = revenue - cogsLike;
    const netProfit = grossProfit - generalExpenses;

    return {
      format: 'INCOME_STATEMENT',
      period: { from: fromDate.toISOString(), to: toDate.toISOString() },
      revenue: {
        projectPaymentsCents: revenueProjectPayments,
        siteVisitFeesCents: revenueSiteVisitFees,
        stockSalesCents: revenueStock,
        totalCents: revenue,
      },
      costOfSales: {
        projectExpensesCents: projectExpenses,
        wagesCents: wages,
        totalCents: cogsLike,
      },
      grossProfitCents: grossProfit,
      operatingExpenses: {
        generalCompanyCents: generalExpenses,
        totalCents: generalExpenses,
      },
      netProfitCents: netProfit,
    };
  }

  private periodRange(period: string, asOf?: string) {
    const end = asOf ? new Date(asOf) : new Date();
    const start = new Date(end);
    switch (period) {
      case 'daily':
        start.setHours(0, 0, 0, 0);
        break;
      case 'weekly':
        start.setDate(end.getDate() - 6);
        start.setHours(0, 0, 0, 0);
        break;
      case 'monthly':
        start.setDate(1);
        start.setHours(0, 0, 0, 0);
        break;
      case 'quarterly': {
        const q = Math.floor(end.getMonth() / 3) * 3;
        start.setMonth(q, 1);
        start.setHours(0, 0, 0, 0);
        break;
      }
      case 'yearly':
        start.setMonth(0, 1);
        start.setHours(0, 0, 0, 0);
        break;
      default:
        start.setDate(1);
        start.setHours(0, 0, 0, 0);
    }
    const to = new Date(end);
    to.setHours(23, 59, 59, 999);
    return { from: start, to };
  }

  @Get('company/period-statement')
  async periodStatement(
    @Query('period') period: string = 'monthly',
    @Query('asOf') asOf?: string,
    @Query('projectId') projectId?: string,
  ) {
    const allowed = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'];
    const key = allowed.includes(period) ? period : 'monthly';
    const { from, to } = this.periodRange(key, asOf);

    const payments = await this.prisma.payment.findMany({
      where: {
        deletedAt: null,
        paidAt: { gte: from, lte: to },
        ...(projectId ? { projectId } : {}),
      },
      include: { project: { select: { code: true, name: true, client: { select: { name: true } } } } },
      orderBy: { paidAt: 'desc' },
    });

    const expenses = await this.prisma.expense.findMany({
      where: {
        deletedAt: null,
        expenseDate: { gte: from, lte: to },
        ...(projectId ? { projectId } : {}),
      },
      include: { project: { select: { code: true, name: true } } },
      orderBy: { expenseDate: 'desc' },
    });

    const stockMoves = await this.prisma.stockMovement.findMany({
      where: {
        createdAt: { gte: from, lte: to },
        ...(projectId
          ? { projectStock: { projectId } }
          : {}),
      },
      include: {
        projectStock: {
          select: {
            itemName: true,
            unit: true,
            projectId: true,
            project: { select: { code: true, name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const stockLines = await this.prisma.projectStock.findMany({
      where: projectId ? { projectId } : undefined,
      include: { project: { select: { code: true, name: true } } },
    });

    const remaining = (s: (typeof stockLines)[number]) =>
      Number(s.qtyPurchased) +
      Number(s.qtyTransferredIn) -
      Number(s.qtyUsed) -
      Number(s.qtySold) -
      Number(s.qtyReturned) -
      Number(s.qtyTransferredOut);

    const projectPaymentRows = payments.filter((p) => p.purpose !== PaymentPurpose.SITE_VISIT);
    const siteVisitPaymentRows = payments.filter((p) => p.purpose === PaymentPurpose.SITE_VISIT);
    const projectPaymentsTotal = projectPaymentRows.reduce((s, p) => s + Number(p.amountCents), 0);
    const siteVisitFeesTotal = siteVisitPaymentRows.reduce((s, p) => s + Number(p.amountCents), 0);
    const paymentsTotal = projectPaymentsTotal + siteVisitFeesTotal;
    const materialBuys = expenses.filter((e) => e.category === 'Materials');
    const materialBuyCents = materialBuys.reduce((s, e) => s + Number(e.amountCents), 0);
    const expenseTotal = expenses.reduce((s, e) => s + Number(e.amountCents), 0);

    const purchases = stockMoves.filter((m) => m.type === StockMovementType.PURCHASE);
    const uses = stockMoves.filter((m) => m.type === StockMovementType.USE);
    const sales = stockMoves.filter((m) => m.type === StockMovementType.SELL);
    const purchaseQty = purchases.reduce((s, m) => s + Number(m.quantity), 0);
    const useQty = uses.reduce((s, m) => s + Number(m.quantity), 0);
    const sellQty = sales.reduce((s, m) => s + Number(m.quantity), 0);
    const sellRevenue = sales.reduce(
      (s, m) => s + Number(m.quantity) * Number(m.unitPriceCents || 0),
      0,
    );
    const leftoverLines = stockLines
      .map((s) => ({
        projectCode: s.project.code,
        projectName: s.project.name,
        itemName: s.itemName,
        unit: s.unit,
        qtyRemaining: remaining(s),
      }))
      .filter((s) => s.qtyRemaining > 0);

    return {
      period: key,
      from: from.toISOString(),
      to: to.toISOString(),
      projectId: projectId || null,
      summary: {
        clientPaymentsCents: paymentsTotal,
        projectPaymentsCents: projectPaymentsTotal,
        siteVisitFeesCents: siteVisitFeesTotal,
        stockPurchaseExpenseCents: materialBuyCents,
        allExpensesCents: expenseTotal,
        stockSaleRevenueCents: sellRevenue,
        netCashMovementCents: paymentsTotal + sellRevenue - expenseTotal,
        stockPurchasedQty: purchaseQty,
        stockUsedQty: useQty,
        stockSoldQty: sellQty,
        leftoverLineCount: leftoverLines.length,
      },
      payments: payments.map((p) => ({
        id: p.id,
        receiptNumber: p.receiptNumber,
        purpose: p.purpose,
        amountCents: Number(p.amountCents),
        paidAt: p.paidAt,
        projectCode: p.project.code,
        projectName: p.project.name,
        clientName: p.project.client.name,
      })),
      expenses: expenses.map((e) => ({
        id: e.id,
        category: e.category,
        description: e.description,
        amountCents: Number(e.amountCents),
        scope: e.scope,
        expenseDate: e.expenseDate,
        projectCode: e.project?.code || null,
      })),
      stockMovements: stockMoves.map((m) => ({
        id: m.id,
        type: m.type,
        quantity: Number(m.quantity),
        unitPriceCents: m.unitPriceCents != null ? Number(m.unitPriceCents) : null,
        fundingSource: m.fundingSource,
        itemName: m.projectStock.itemName,
        unit: m.projectStock.unit,
        projectCode: m.projectStock.project.code,
        createdAt: m.createdAt,
      })),
      leftoverStock: leftoverLines,
      cycle: [
        '1. Site visit fee is company revenue (separate from quotation balance).',
        '2. Client pays against the quotation (Finance / project payment).',
        '3. Buy materials into that project stock (Stores). Cost hits the project.',
        '4. Use stock on site as work progresses.',
        '5. Leftover can stay on the project, transfer, sell, or return to owner.',
      ],
    };
  }

  @Get('company/balance-sheet')
  async balanceSheet() {
    const projects = await this.prisma.project.findMany({
      where: { status: { in: [ProjectStatus.ACTIVE, ProjectStatus.QUOTED, ProjectStatus.ON_HOLD] } },
    });
    const receivables = projects.reduce(
      (s, p) => s + Number(p.quotationTotalCents - p.amountPaidCents),
      0,
    );
    const cashReceived = await this.prisma.payment.aggregate({
      where: { deletedAt: null },
      _sum: { amountCents: true },
    });
    const expenses = await this.prisma.expense.aggregate({
      where: { deletedAt: null },
      _sum: { amountCents: true },
    });
    const stock = await this.prisma.projectStock.findMany();
    const stockLines = stock.length;

    const payables = await this.prisma.supplierPayable.findMany({
      where: { status: { in: ['OPEN', 'PARTIAL'] } },
    });
    const accountsPayable = payables.reduce(
      (s, p) => s + Number(p.amountCents) - Number(p.amountPaidCents),
      0,
    );
    const pendingShortfalls = await this.prisma.shortfall.aggregate({
      where: { status: 'PENDING' },
      _sum: { amountCents: true },
    });
    const pendingShortfallsCents = Number(pendingShortfalls._sum.amountCents || 0);

    const cash = Number(cashReceived._sum.amountCents || 0);
    const totalLiabilities = accountsPayable + pendingShortfallsCents;
    const totalAssets = cash + receivables;
    const equity = totalAssets - totalLiabilities;

    return {
      format: 'BALANCE_SHEET',
      asOf: new Date().toISOString(),
      assets: {
        cashAndEquivalentsCents: cash,
        accountsReceivableCents: receivables,
        stockLineCount: stockLines,
        totalCents: totalAssets,
      },
      liabilities: {
        accountsPayableCents: accountsPayable,
        pendingShortfallsCents,
        totalCents: totalLiabilities,
      },
      equity: {
        retainedEarningsApproxCents: equity,
        totalCents: equity,
      },
    };
  }

  @Get('company/accounting-csv')
  async accountingCsv() {
    const statement = await this.incomeStatement();
    const rows = [
      ['Account', 'Amount'],
      ['Revenue - Project Payments', (statement.revenue.projectPaymentsCents / 100).toFixed(2)],
      ['Revenue - Site Visit Fees', (statement.revenue.siteVisitFeesCents / 100).toFixed(2)],
      ['Revenue - Stock Sales', (statement.revenue.stockSalesCents / 100).toFixed(2)],
      ['Total Revenue', (statement.revenue.totalCents / 100).toFixed(2)],
      ['Project Expenses', (statement.costOfSales.projectExpensesCents / 100).toFixed(2)],
      ['Wages', (statement.costOfSales.wagesCents / 100).toFixed(2)],
      ['Gross Profit', (statement.grossProfitCents / 100).toFixed(2)],
      ['General Expenses', (statement.operatingExpenses.generalCompanyCents / 100).toFixed(2)],
      ['Net Profit', (statement.netProfitCents / 100).toFixed(2)],
    ];
    return {
      filename: `nomchael-income-${new Date().toISOString().slice(0, 10)}.csv`,
      csv: rows.map((r) => r.join(',')).join('\n'),
      statement,
    };
  }
}

import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import {
  LineItemType,
  Prisma,
  QuotationStatus,
  StockMovementType,
  StockPaymentTerms,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { serializeMoney } from '../common/money';
import { SuppliersService } from '../suppliers/suppliers.service';

@Injectable()
export class StockService {
  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => SuppliersService))
    private suppliers: SuppliersService,
  ) {}

  remaining(stock: {
    qtyPurchased: Prisma.Decimal;
    qtyUsed: Prisma.Decimal;
    qtySold: Prisma.Decimal;
    qtyReturned: Prisma.Decimal;
    qtyTransferredOut: Prisma.Decimal;
    qtyTransferredIn: Prisma.Decimal;
  }) {
    return (
      Number(stock.qtyPurchased) +
      Number(stock.qtyTransferredIn) -
      Number(stock.qtyUsed) -
      Number(stock.qtySold) -
      Number(stock.qtyReturned) -
      Number(stock.qtyTransferredOut)
    );
  }

  async listByProject(projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { amountPaidCents: true, code: true },
    });
    if (!project) throw new NotFoundException('Project not found');
    if (Number(project.amountPaidCents) <= 0) {
      return [];
    }

    const items = await this.prisma.projectStock.findMany({
      where: { projectId },
      include: {
        movements: { orderBy: { createdAt: 'desc' }, take: 5 },
        quotationLineItem: true,
      },
    });
    return items.map((i) =>
      serializeMoney({
        ...i,
        qtyRemaining: this.remaining(i),
      }),
    );
  }

  async listAll() {
    const items = await this.prisma.projectStock.findMany({
      where: {
        project: { amountPaidCents: { gt: 0n } },
      },
      include: {
        project: { select: { id: true, code: true, name: true, amountPaidCents: true } },
        quotationLineItem: { select: { id: true, quantity: true, unitPriceCents: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    });
    return items.map((i) => {
      const quotedQty = i.quotationLineItem ? Number(i.quotationLineItem.quantity) : null;
      const stillOnQuote =
        quotedQty == null ? null : Math.max(0, quotedQty - Number(i.qtyPurchased));
      return serializeMoney({
        ...i,
        qtyRemaining: this.remaining(i),
        quotedQty,
        stillOnQuote,
      });
    });
  }

  /**
   * Stock only exists after client payment. Seeds planned rows from the accepted quotation.
   */
  async seedFromPayment(projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, code: true, amountPaidCents: true },
    });
    if (!project) throw new NotFoundException('Project not found');
    if (Number(project.amountPaidCents) <= 0) {
      return { created: 0, quotationId: null, reason: 'NO_PAYMENT' as const };
    }

    const source = await this.prisma.quotation.findFirst({
      where: { projectId, status: QuotationStatus.ACCEPTED },
      orderBy: { version: 'desc' },
      include: { lineItems: { where: { type: LineItemType.MATERIAL } } },
    });
    if (!source?.lineItems?.length) {
      return { created: 0, quotationId: null, reason: 'NO_ACCEPTED_QUOTE' as const };
    }

    const existing = await this.prisma.projectStock.findMany({
      where: {
        projectId,
        quotationLineItemId: { in: source.lineItems.map((i) => i.id) },
      },
      select: { quotationLineItemId: true },
    });
    const have = new Set(existing.map((e) => e.quotationLineItemId));
    const toCreate = source.lineItems
      .filter((item) => !have.has(item.id))
      .map((item) => ({
        projectId,
        quotationLineItemId: item.id,
        catalogItemId: item.catalogItemId || undefined,
        itemName: item.description,
        unit: item.unit,
        qtyPurchased: 0,
      }));

    if (toCreate.length) {
      await this.prisma.projectStock.createMany({ data: toCreate });
    }

    return { created: toCreate.length, quotationId: source.id, reason: 'OK' as const };
  }

  async purchase(
    projectStockId: string,
    quantity: number,
    unitPriceCents?: number,
    notes?: string,
    fundingSource?: 'PROJECT' | 'COMPANY' | 'CLIENT' | 'OTHER_PROJECT',
    fundedByProjectId?: string,
    paymentTerms: 'CASH' | 'CREDIT' = 'CASH',
    supplierId?: string,
  ) {
    if (unitPriceCents == null || unitPriceCents < 0) {
      throw new BadRequestException('Unit price is required when buying stock');
    }

    if (paymentTerms === 'CREDIT' && !supplierId) {
      throw new BadRequestException(
        'Select the supplier when buying on credit so we can track the creditor balance.',
      );
    }

    const stock = await this.prisma.projectStock.findUnique({
      where: { id: projectStockId },
      include: {
        project: { select: { id: true, code: true, name: true, amountPaidCents: true } },
        quotationLineItem: true,
      },
    });
    if (!stock) throw new NotFoundException('Stock item not found');

    if (!stock.quotationLineItemId) {
      throw new BadRequestException(
        `Stock line "${stock.itemName}" is not linked to a quotation. Remove orphan lines and buy only materials that came from the approved quote lifecycle.`,
      );
    }

    const quotedQty = stock.quotationLineItem ? Number(stock.quotationLineItem.quantity) : null;
    const alreadyBought = Number(stock.qtyPurchased);
    const stillOnQuote =
      quotedQty == null ? quantity : Math.max(0, quotedQty - alreadyBought);
    const projectFundedQty = Math.min(quantity, stillOnQuote);
    const excessQty = Math.round((quantity - projectFundedQty) * 10000) / 10000;

    if (projectFundedQty > 0 && Number(stock.project.amountPaidCents) <= 0) {
      throw new BadRequestException(
        `Cannot buy project stock (or charge materials) on ${stock.project.code} before client income. Take a payment first.`,
      );
    }

    if (excessQty > 0) {
      if (!fundingSource || fundingSource === 'PROJECT') {
        throw new BadRequestException(
          `Buying ${excessQty} ${stock.unit} above the quotation needs a funding source (company, client, or another project)`,
        );
      }
      if (fundingSource === 'CLIENT' && Number(stock.project.amountPaidCents) <= 0) {
        throw new BadRequestException(
          `Cannot charge excess stock to the client on ${stock.project.code} before client income. Take a payment first.`,
        );
      }
      if (fundingSource === 'OTHER_PROJECT') {
        if (!fundedByProjectId) {
          throw new BadRequestException('Select which project is funding the excess stock');
        }
        if (fundedByProjectId === stock.projectId) {
          throw new BadRequestException('Funding project must be different from the stock project');
        }
        const funder = await this.prisma.project.findUnique({
          where: { id: fundedByProjectId },
          select: { id: true, code: true, amountPaidCents: true },
        });
        if (!funder) throw new NotFoundException('Funding project not found');
        if (Number(funder.amountPaidCents) <= 0) {
          throw new BadRequestException(
            `Funding project ${funder.code} has no client income yet. Take a payment on that project first.`,
          );
        }
      }
    }

    const totalCents = Math.round(quantity * unitPriceCents);
    const projectCostCents = Math.round(projectFundedQty * unitPriceCents);
    const excessCostCents = totalCents - projectCostCents;
    const terms = paymentTerms === 'CREDIT' ? StockPaymentTerms.CREDIT : StockPaymentTerms.CASH;

    const movement = await this.prisma.stockMovement.create({
      data: {
        projectStockId,
        type: StockMovementType.PURCHASE,
        quantity,
        unitPriceCents: BigInt(unitPriceCents),
        relatedProjectId: fundingSource === 'OTHER_PROJECT' ? fundedByProjectId : null,
        fundingSource: excessQty > 0 ? fundingSource : 'PROJECT',
        paymentTerms: terms,
        supplierId: supplierId || null,
        notes: [
          notes,
          terms === StockPaymentTerms.CREDIT ? 'Bought on credit (accounts payable)' : null,
          excessQty > 0
            ? `Excess ${excessQty} ${stock.unit} funded by ${fundingSource}${
                fundedByProjectId ? ` (${fundedByProjectId})` : ''
              }`
            : null,
        ]
          .filter(Boolean)
          .join(' · '),
      },
    });

    const updated = await this.prisma.projectStock.update({
      where: { id: projectStockId },
      data: { qtyPurchased: { increment: quantity } },
    });

    // Accrue project cost either way (cash or credit). Credit also creates AP.
    if (projectCostCents > 0) {
      await this.prisma.expense.create({
        data: {
          scope: 'PROJECT',
          projectId: stock.projectId,
          category: 'Materials',
          description: `Stock purchase${
            terms === StockPaymentTerms.CREDIT ? ' (on credit)' : ''
          }: ${quantity} ${stock.unit} ${stock.itemName} @ project share`,
          amountCents: BigInt(projectCostCents),
        },
      });
    }

    if (excessCostCents > 0 && fundingSource) {
      if (fundingSource === 'COMPANY') {
        await this.prisma.expense.create({
          data: {
            scope: 'GENERAL',
            category: 'Materials',
            description: `Excess stock for ${stock.project.code}: ${excessQty} ${stock.unit} ${stock.itemName} (company funded)`,
            amountCents: BigInt(excessCostCents),
          },
        });
      } else if (fundingSource === 'CLIENT') {
        await this.prisma.expense.create({
          data: {
            scope: 'PROJECT',
            projectId: stock.projectId,
            category: 'Materials',
            description: `Excess stock (client funded): ${excessQty} ${stock.unit} ${stock.itemName}`,
            amountCents: BigInt(excessCostCents),
          },
        });
      } else if (fundingSource === 'OTHER_PROJECT' && fundedByProjectId) {
        await this.prisma.expense.create({
          data: {
            scope: 'PROJECT',
            projectId: fundedByProjectId,
            category: 'Materials',
            description: `Excess stock funded for ${stock.project.code}: ${excessQty} ${stock.unit} ${stock.itemName}`,
            amountCents: BigInt(excessCostCents),
          },
        });
      }
    }

    let payable: unknown = null;
    if (terms === StockPaymentTerms.CREDIT && supplierId && totalCents > 0) {
      payable = await this.suppliers.createPayable({
        supplierId,
        projectId: stock.projectId,
        stockMovementId: movement.id,
        description: `Credit stock: ${quantity} ${stock.unit} ${stock.itemName} for ${stock.project.code}`,
        amountCents: totalCents,
      });
    }

    return serializeMoney({
      ...updated,
      qtyRemaining: this.remaining(updated),
      purchase: {
        totalCents,
        projectCostCents,
        excessCostCents,
        projectFundedQty,
        excessQty,
        fundingSource: excessQty > 0 ? fundingSource : 'PROJECT',
        paymentTerms: terms,
        overQuote:
          excessQty > 0
            ? `Buying ${excessQty} ${stock.unit} more than quoted for ${stock.itemName}`
            : null,
        payable,
      },
    });
  }

  async use(projectStockId: string, quantity: number, notes?: string) {
    const stock = await this.prisma.projectStock.findUnique({ where: { id: projectStockId } });
    if (!stock) throw new NotFoundException('Stock item not found');
    if (this.remaining(stock) < quantity) throw new BadRequestException('Insufficient stock');
    await this.prisma.stockMovement.create({
      data: { projectStockId, type: StockMovementType.USE, quantity, notes },
    });
    const updated = await this.prisma.projectStock.update({
      where: { id: projectStockId },
      data: { qtyUsed: { increment: quantity } },
    });
    return serializeMoney({ ...updated, qtyRemaining: this.remaining(updated) });
  }

  async sell(projectStockId: string, quantity: number, unitPriceCents: number, notes?: string) {
    const stock = await this.prisma.projectStock.findUnique({
      where: { id: projectStockId },
      include: { project: true },
    });
    if (!stock) throw new NotFoundException('Stock item not found');
    if (this.remaining(stock) < quantity) throw new BadRequestException('Insufficient stock');
    await this.prisma.stockMovement.create({
      data: {
        projectStockId,
        type: StockMovementType.SELL,
        quantity,
        unitPriceCents: BigInt(unitPriceCents),
        notes,
      },
    });
    const updated = await this.prisma.projectStock.update({
      where: { id: projectStockId },
      data: { qtySold: { increment: quantity } },
    });
    // Record as project revenue via payment-like ledger note (expense negative = revenue tracked in reports via stock sell)
    await this.prisma.auditLog.create({
      data: {
        action: 'STOCK_SELL',
        entityType: 'ProjectStock',
        entityId: projectStockId,
        metadata: {
          quantity,
          unitPriceCents,
          revenueCents: Math.round(quantity * unitPriceCents),
          projectId: stock.projectId,
        },
      },
    });
    return serializeMoney({ ...updated, qtyRemaining: this.remaining(updated) });
  }

  async returnToOwner(projectStockId: string, quantity: number, notes?: string) {
    const stock = await this.prisma.projectStock.findUnique({
      where: { id: projectStockId },
      include: { project: true, quotationLineItem: true },
    });
    if (!stock) throw new NotFoundException('Stock item not found');
    if (this.remaining(stock) < quantity) throw new BadRequestException('Insufficient stock');
    await this.prisma.stockMovement.create({
      data: { projectStockId, type: StockMovementType.RETURN_TO_OWNER, quantity, notes },
    });
    const updated = await this.prisma.projectStock.update({
      where: { id: projectStockId },
      data: { qtyReturned: { increment: quantity } },
    });
    const unitPrice = stock.quotationLineItem
      ? Number(stock.quotationLineItem.unitPriceCents)
      : 0;
    const credit = Math.round(quantity * unitPrice);
    if (credit > 0) {
      await this.prisma.project.update({
        where: { id: stock.projectId },
        data: { quotationTotalCents: { decrement: credit } },
      });
    }
    return serializeMoney({ ...updated, qtyRemaining: this.remaining(updated), creditCents: credit });
  }

  async transfer(
    projectStockId: string,
    toProjectId: string,
    quantity: number,
    transportFeeCents = 0,
    notes?: string,
  ) {
    const stock = await this.prisma.projectStock.findUnique({ where: { id: projectStockId } });
    if (!stock) throw new NotFoundException('Stock item not found');
    if (this.remaining(stock) < quantity) throw new BadRequestException('Insufficient stock');

    await this.prisma.stockMovement.create({
      data: {
        projectStockId,
        type: StockMovementType.TRANSFER_OUT,
        quantity,
        transportFeeCents: BigInt(transportFeeCents),
        relatedProjectId: toProjectId,
        notes,
      },
    });
    const updated = await this.prisma.projectStock.update({
      where: { id: projectStockId },
      data: { qtyTransferredOut: { increment: quantity } },
    });

    let target = await this.prisma.projectStock.findFirst({
      where: { projectId: toProjectId, itemName: stock.itemName, unit: stock.unit },
    });
    if (!target) {
      target = await this.prisma.projectStock.create({
        data: {
          projectId: toProjectId,
          itemName: stock.itemName,
          unit: stock.unit,
        },
      });
    }
    await this.prisma.stockMovement.create({
      data: {
        projectStockId: target.id,
        type: StockMovementType.TRANSFER_IN,
        quantity,
        transportFeeCents: BigInt(transportFeeCents),
        relatedProjectId: stock.projectId,
        notes,
      },
    });
    await this.prisma.projectStock.update({
      where: { id: target.id },
      data: { qtyTransferredIn: { increment: quantity } },
    });

    if (transportFeeCents > 0) {
      await this.prisma.expense.create({
        data: {
          scope: 'PROJECT',
          projectId: toProjectId,
          category: 'Transport',
          description: `Stock transfer of ${quantity} ${stock.unit} ${stock.itemName}`,
          amountCents: BigInt(transportFeeCents),
        },
      });
    }

    return serializeMoney({ ...updated, qtyRemaining: this.remaining(updated), toProjectId });
  }

  async createItem(projectId: string, itemName: string, unit = 'ea', quotationLineItemId?: string) {
    if (!quotationLineItemId) {
      throw new BadRequestException(
        'Stock lines must come from the quotation. Add materials on the quotation first; they appear here automatically. You cannot create stock from nowhere.',
      );
    }

    const line = await this.prisma.quotationLineItem.findUnique({
      where: { id: quotationLineItemId },
      include: { quotation: { select: { projectId: true } } },
    });
    if (!line) throw new BadRequestException('Quotation line not found');
    if (line.quotation.projectId !== projectId) {
      throw new BadRequestException('Quotation line does not belong to this project');
    }

    const existing = await this.prisma.projectStock.findFirst({
      where: { quotationLineItemId },
    });
    if (existing) {
      return serializeMoney({ ...existing, qtyRemaining: this.remaining(existing) });
    }

    const item = await this.prisma.projectStock.create({
      data: {
        projectId,
        itemName: itemName || line.description,
        unit: unit || line.unit,
        quotationLineItemId,
        catalogItemId: line.catalogItemId || undefined,
      },
    });
    return serializeMoney({ ...item, qtyRemaining: 0 });
  }
}

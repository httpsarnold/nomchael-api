import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  IsArray,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { PayableStatus, PaymentMethod } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { haversineKm, serializeMoney } from '../common/money';
import { ConfigService } from '@nestjs/config';
import { SuppliersService } from './suppliers.service';
import type { Response } from 'express';

class SupplierDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  company?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsNumber()
  locationLat?: number;

  @IsOptional()
  @IsNumber()
  locationLng?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

class PriceDto {
  @IsString()
  supplierId!: string;

  @IsString()
  itemName!: string;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsNumber()
  @Min(0)
  unitPriceCents!: number;

  @IsOptional()
  @IsString()
  company?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

class PayCreditorDto {
  @IsString()
  supplierId!: string;

  @IsNumber()
  @Min(1)
  amountCents!: number;

  @IsOptional()
  @IsEnum(PaymentMethod)
  method?: PaymentMethod;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  payableIds?: string[];
}

class ManualPayableDto {
  @IsString()
  supplierId!: string;

  @IsOptional()
  @IsString()
  projectId?: string;

  @IsString()
  description!: string;

  @IsNumber()
  @Min(1)
  amountCents!: number;

  @IsOptional()
  @IsString()
  invoiceRef?: string;

  @IsOptional()
  @IsString()
  dueAt?: string;
}

@Controller('suppliers')
@UseGuards(JwtAuthGuard)
export class SuppliersController {
  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private suppliers: SuppliersService,
  ) {}

  @Get()
  async findAll() {
    const list = await this.prisma.supplier.findMany({
      include: { prices: { orderBy: { recordedAt: 'desc' }, take: 5 } },
      orderBy: { name: 'asc' },
    });
    return list.map((s) => serializeMoney(s));
  }

  @Post()
  create(@Body() dto: SupplierDto) {
    return this.prisma.supplier.create({ data: dto });
  }

  @Post('prices')
  async recordPrice(@Body() dto: PriceDto) {
    const price = await this.prisma.supplierPrice.create({
      data: {
        supplierId: dto.supplierId,
        itemName: dto.itemName,
        unit: dto.unit || 'ea',
        unitPriceCents: BigInt(dto.unitPriceCents),
        company: dto.company,
        notes: dto.notes,
      },
      include: { supplier: true },
    });
    return serializeMoney(price);
  }

  @Get('prices')
  async listPrices(@Query('item') item?: string) {
    const list = await this.prisma.supplierPrice.findMany({
      where: item ? { itemName: { contains: item, mode: 'insensitive' } } : undefined,
      include: { supplier: true },
      orderBy: { recordedAt: 'desc' },
      take: 200,
    });
    return list.map((p) => serializeMoney(p));
  }

  @Get('optimize')
  async optimize(
    @Query('item') item: string,
    @Query('projectId') projectId?: string,
    @Query('quantity') quantity = '1',
  ) {
    if (!item) return [];
    const qty = Number(quantity) || 1;
    const transportPerKm = Number(this.config.get('TRANSPORT_COST_PER_KM_CENTS') || 50);

    let projectLat: number | null = null;
    let projectLng: number | null = null;
    if (projectId) {
      const project = await this.prisma.project.findUnique({ where: { id: projectId } });
      projectLat = project?.locationLat ?? null;
      projectLng = project?.locationLng ?? null;
    }

    const prices = await this.prisma.supplierPrice.findMany({
      where: { itemName: { contains: item, mode: 'insensitive' } },
      include: { supplier: true },
      orderBy: { recordedAt: 'desc' },
    });

    const latest = new Map<string, (typeof prices)[0]>();
    for (const p of prices) {
      if (!latest.has(p.supplierId)) latest.set(p.supplierId, p);
    }

    const options = [...latest.values()].map((p) => {
      let distanceKm = 0;
      let transportCents = 0;
      if (
        projectLat != null &&
        projectLng != null &&
        p.supplier.locationLat != null &&
        p.supplier.locationLng != null
      ) {
        distanceKm = haversineKm(
          projectLat,
          projectLng,
          p.supplier.locationLat,
          p.supplier.locationLng,
        );
        transportCents = Math.round(distanceKm * transportPerKm);
      }
      const unitPrice = Number(p.unitPriceCents);
      const landedUnit = unitPrice + transportCents;
      return {
        supplierId: p.supplierId,
        supplierName: p.supplier.name,
        supplierCompany: p.supplier.company,
        supplierAddress: p.supplier.address,
        itemName: p.itemName,
        unit: p.unit,
        unitPriceCents: unitPrice,
        distanceKm: Math.round(distanceKm * 10) / 10,
        transportCents,
        landedUnitCents: landedUnit,
        totalLandedCents: Math.round(landedUnit * qty),
        recordedAt: p.recordedAt,
      };
    });

    options.sort((a, b) => a.landedUnitCents - b.landedUnitCents);
    return options;
  }

  @Get('creditors')
  creditors() {
    return this.suppliers.creditorsSummary();
  }

  @Get('debtors')
  debtors() {
    return this.suppliers.debtorsSummary();
  }

  @Get('payables')
  payables(
    @Query('status') status?: PayableStatus,
    @Query('supplierId') supplierId?: string,
    @Query('projectId') projectId?: string,
  ) {
    return this.suppliers.listPayables(status, supplierId, projectId);
  }

  @Post('payables')
  createPayable(@Body() dto: ManualPayableDto) {
    return this.suppliers.createPayable(dto);
  }

  @Post('pay')
  payCreditor(@Body() dto: PayCreditorDto, @Req() req: { user: { id: string } }) {
    return this.suppliers.payCreditor({ ...dto, createdById: req.user.id });
  }

  @Get(':id/statement')
  statement(
    @Param('id') id: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.suppliers.getStatement(id, from, to);
  }

  @Get(':id/statement/pdf')
  async statementPdf(
    @Param('id') id: string,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Res() res: Response,
  ) {
    const { buffer, filename } = await this.suppliers.statementPdf(id, from, to);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const s = await this.prisma.supplier.findUniqueOrThrow({
      where: { id },
      include: { prices: { orderBy: { recordedAt: 'desc' } } },
    });
    const balance = await this.prisma.supplierLedgerEntry.findFirst({
      where: { supplierId: id },
      orderBy: { createdAt: 'desc' },
      select: { balanceCents: true },
    });
    return serializeMoney({
      ...s,
      owedCents: Number(balance?.balanceCents || 0),
    });
  }
}

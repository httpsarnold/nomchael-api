import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StockService } from './stock.service';

class CreateStockDto {
  @IsString()
  projectId!: string;

  @IsString()
  itemName!: string;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @IsString()
  quotationLineItemId?: string;
}

class QtyDto {
  @IsNumber()
  @Min(0.0001)
  quantity!: number;

  @IsOptional()
  @IsNumber()
  unitPriceCents?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  fundingSource?: 'PROJECT' | 'COMPANY' | 'CLIENT' | 'OTHER_PROJECT';

  @IsOptional()
  @IsString()
  fundedByProjectId?: string;

  @IsOptional()
  @IsString()
  paymentTerms?: 'CASH' | 'CREDIT';

  @IsOptional()
  @IsString()
  supplierId?: string;
}

class TransferDto {
  @IsString()
  toProjectId!: string;

  @IsNumber()
  @Min(0.0001)
  quantity!: number;

  @IsOptional()
  @IsNumber()
  transportFeeCents?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

@Controller('stock')
@UseGuards(JwtAuthGuard)
export class StockController {
  constructor(private stock: StockService) {}

  @Get()
  listAll(@Query('projectId') projectId?: string) {
    if (projectId) return this.stock.listByProject(projectId);
    return this.stock.listAll();
  }

  @Post()
  create(@Body() dto: CreateStockDto) {
    return this.stock.createItem(dto.projectId, dto.itemName, dto.unit, dto.quotationLineItemId);
  }

  @Post(':id/purchase')
  purchase(@Param('id') id: string, @Body() dto: QtyDto) {
    return this.stock.purchase(
      id,
      dto.quantity,
      dto.unitPriceCents,
      dto.notes,
      dto.fundingSource,
      dto.fundedByProjectId,
      dto.paymentTerms || 'CASH',
      dto.supplierId,
    );
  }

  @Post(':id/use')
  use(@Param('id') id: string, @Body() dto: QtyDto) {
    return this.stock.use(id, dto.quantity, dto.notes);
  }

  @Post(':id/sell')
  sell(@Param('id') id: string, @Body() dto: QtyDto) {
    return this.stock.sell(id, dto.quantity, dto.unitPriceCents || 0, dto.notes);
  }

  @Post(':id/return')
  returnToOwner(@Param('id') id: string, @Body() dto: QtyDto) {
    return this.stock.returnToOwner(id, dto.quantity, dto.notes);
  }

  @Post(':id/transfer')
  transfer(@Param('id') id: string, @Body() dto: TransferDto) {
    return this.stock.transfer(
      id,
      dto.toProjectId,
      dto.quantity,
      dto.transportFeeCents || 0,
      dto.notes,
    );
  }
}

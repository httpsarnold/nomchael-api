import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { IsArray, IsBoolean, IsEnum, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { LineItemType, UserRole } from '@prisma/client';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../common/roles.decorator';
import { QuotationsService } from './quotations.service';

class CreateQuotationDto {
  @IsString()
  projectId!: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

class LineItemDto {
  @IsOptional()
  @IsString()
  projectStageId?: string;

  @IsOptional()
  @IsString()
  catalogItemId?: string;

  @IsOptional()
  @IsEnum(LineItemType)
  type?: LineItemType;

  @IsString()
  description!: string;

  @IsNumber()
  @Min(0)
  quantity!: number;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsNumber()
  unitPriceCents!: number;

  @IsOptional()
  @IsString()
  supplierId?: string;
}

class AddItemsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LineItemDto)
  items!: LineItemDto[];

  @IsOptional()
  @IsBoolean()
  multiplyByStructures?: boolean;
}

class ImportCatalogEntryDto {
  @IsString()
  catalogItemId!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  quantity?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  unitPriceCents?: number;

  @IsOptional()
  @IsBoolean()
  multiplyByStructures?: boolean;
}

class ImportCatalogDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImportCatalogEntryDto)
  items!: ImportCatalogEntryDto[];

  @IsOptional()
  @IsBoolean()
  multiplyByStructures?: boolean;
}

class UpdateLineItemDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  quantity?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  unitPriceCents?: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  unit?: string;
}

class LabourDto {
  @IsNumber()
  labourCents!: number;

  @IsOptional()
  @IsBoolean()
  multiplyByStructures?: boolean;

  @IsOptional()
  @IsString()
  quotationId?: string;
}

class MdDecideDto {
  @IsBoolean()
  approve!: boolean;

  @IsOptional()
  @IsString()
  rejectionReason?: string;
}

@Controller('quotations')
@UseGuards(JwtAuthGuard)
export class QuotationsController {
  constructor(private quotations: QuotationsService) {}

  @Get()
  findAll() {
    return this.quotations.findAll();
  }

  @Get('pending-md')
  pendingMd() {
    return this.quotations.pendingMdApproval();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.quotations.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateQuotationDto) {
    return this.quotations.create(dto.projectId, dto.notes);
  }

  @Post(':id/items')
  addItems(@Param('id') id: string, @Body() dto: AddItemsDto) {
    return this.quotations.addLineItems(id, dto.items, {
      multiplyByStructures: dto.multiplyByStructures,
    });
  }

  @Post(':id/import-catalog')
  importCatalog(@Param('id') id: string, @Body() dto: ImportCatalogDto) {
    const items = dto.items.map((item) => ({
      ...item,
      multiplyByStructures: item.multiplyByStructures ?? dto.multiplyByStructures,
    }));
    return this.quotations.importCatalogItems(id, items);
  }

  @Patch(':id/items/:itemId')
  updateItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateLineItemDto,
  ) {
    return this.quotations.updateLineItem(id, itemId, dto);
  }

  @Delete(':id/items/:itemId')
  removeItem(@Param('id') id: string, @Param('itemId') itemId: string) {
    return this.quotations.removeLineItem(id, itemId);
  }

  @Post(':id/send-whatsapp')
  send(@Param('id') id: string) {
    return this.quotations.sendToWhatsapp(id);
  }

  @Post(':id/accept')
  accept(@Param('id') id: string) {
    return this.quotations.accept(id);
  }

  @Post(':id/md-decide')
  @UseGuards(RolesGuard)
  @Roles(UserRole.MANAGING_DIRECTOR, UserRole.SUPER_ADMIN)
  mdDecide(
    @Param('id') id: string,
    @Body() dto: MdDecideDto,
    @Req() req: { user: { id: string } },
  ) {
    return this.quotations.mdDecide(id, req.user, dto.approve, dto.rejectionReason);
  }

  @Get(':id/pdf')
  async pdf(@Param('id') id: string, @Res() res: Response) {
    const buf = await this.quotations.buildPdfBuffer(id);
    const q = await this.quotations.findOne(id);
    const code = (q as any)?.project?.code || id;
    const version = (q as any)?.version || 1;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="quotation-${code}-v${version}.pdf"`,
    );
    res.setHeader('Content-Length', buf.length);
    res.send(buf);
  }

  @Post('projects/:projectId/stages/:stageId/labour')
  setLabour(
    @Param('projectId') projectId: string,
    @Param('stageId') stageId: string,
    @Body() dto: LabourDto,
  ) {
    return this.quotations.setStageLabour(projectId, stageId, dto.labourCents, {
      multiplyByStructures: dto.multiplyByStructures,
      quotationId: dto.quotationId,
    });
  }
}

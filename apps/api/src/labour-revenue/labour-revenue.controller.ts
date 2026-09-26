import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
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
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { FundUseCategory, PropertyType } from '@prisma/client';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { LabourRevenueService } from './labour-revenue.service';

class CatchupDto {
  @IsOptional()
  @IsString()
  clientId?: string;

  @IsOptional()
  @IsString()
  clientName?: string;

  @IsOptional()
  @IsString()
  clientPhone?: string;

  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsNumber()
  @Min(0)
  labourQuotedCents!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  discountCents?: number;

  @IsOptional()
  @IsString()
  discountReason?: string;

  @IsOptional()
  @IsString()
  catchupStageLabel?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  cashReceivedCents?: number;
}

class OwnerDto {
  @IsOptional()
  @IsString()
  clientId?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  phone?: string;
}

class CreateEstateDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNumber()
  @Min(1)
  houseCount!: number;

  @IsNumber()
  @Min(0)
  baseLabourCents!: number;

  @IsOptional()
  @IsEnum(PropertyType)
  propertyType?: PropertyType;

  @IsOptional()
  @IsNumber()
  bedrooms?: number;

  @IsOptional()
  @IsNumber()
  bathrooms?: number;

  @IsOptional()
  @IsNumber()
  kitchens?: number;

  @IsOptional()
  @IsNumber()
  lounges?: number;

  @IsOptional()
  @IsNumber()
  otherRooms?: number;

  @IsOptional()
  @IsNumber()
  storeys?: number;

  @IsOptional()
  @IsNumber()
  floorAreaSqm?: number;

  @IsOptional()
  @IsString()
  propertyNotes?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  locationNotes?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OwnerDto)
  owners?: OwnerDto[];
}

class BulkLabourDto {
  @IsString()
  estateProgrammeId!: string;

  @IsArray()
  @IsString({ each: true })
  projectIds!: string[];

  @IsString()
  action!:
    | 'CASH_RECEIVED'
    | 'SET_LABOUR_QUOTED'
    | 'FUND_USE'
    | 'SET_DISCOUNT'
    | 'LABOUR_USED'
    | 'PAY_IN_FULL';

  @IsOptional()
  @IsNumber()
  @Min(0)
  amountCents?: number;

  @IsOptional()
  @IsEnum(FundUseCategory)
  category?: FundUseCategory;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

class AddEstateHouseDto {
  @IsOptional()
  @IsString()
  houseName?: string;

  @IsOptional()
  @IsString()
  ownerName?: string;

  @IsOptional()
  @IsString()
  ownerPhone?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  labourQuotedCents?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  discountCents?: number;

  @IsOptional()
  @IsString()
  discountReason?: string;

  @IsOptional()
  @IsString()
  catchupStageLabel?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  cashReceivedCents?: number;
}

class UpdateEstateHouseDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  houseName?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  ownerName?: string;

  @IsOptional()
  @IsString()
  ownerPhone?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  discountCents?: number;

  @IsOptional()
  @IsString()
  discountReason?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  labourQuotedCents?: number;
}

class FundUseDto {
  @IsNumber()
  @Min(1)
  amountCents!: number;

  @IsOptional()
  @IsEnum(FundUseCategory)
  category?: FundUseCategory;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  usedAt?: string;
}

class DiscountDto {
  @IsNumber()
  @Min(0)
  discountCents!: number;

  @IsOptional()
  @IsString()
  discountReason?: string;
}

class LabourQuotedDto {
  @IsNumber()
  @Min(0)
  labourQuotedCents!: number;
}

class EstateLedgerDto {
  @IsString()
  kind!: 'EXPENSE' | 'BORROWING' | 'REPAYMENT';

  @IsNumber()
  @Min(1)
  amountCents!: number;

  @IsOptional()
  @IsString()
  partyName?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsString()
  entryDate?: string;
}

@Controller()
@UseGuards(JwtAuthGuard)
export class LabourRevenueController {
  constructor(private labour: LabourRevenueService) {}

  @Get('labour-catchup')
  listCatchups() {
    return this.labour.listCatchups();
  }

  @Get('labour-catchup/export')
  async exportCatchups(@Res() res: Response) {
    const buf = await this.labour.exportCatchupsExcel();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="labour-catchup.csv"',
    );
    res.send(buf);
  }

  @Get('labour-catchup/:id')
  getTrail(@Param('id') id: string) {
    return this.labour.getTrail(id);
  }

  @Post('labour-catchup')
  createCatchup(
    @Body() dto: CatchupDto,
    @Req() req: { user: { id: string } },
  ) {
    return this.labour.createCatchup({ ...dto, createdById: req.user.id });
  }

  @Patch('labour-catchup/:id/discount')
  updateDiscount(@Param('id') id: string, @Body() dto: DiscountDto) {
    return this.labour.updateDiscount(id, dto.discountCents, dto.discountReason);
  }

  @Patch('labour-catchup/:id/labour-quoted')
  updateLabourQuoted(@Param('id') id: string, @Body() dto: LabourQuotedDto) {
    return this.labour.updateLabourQuoted(id, dto.labourQuotedCents);
  }

  @Post('labour-catchup/:id/fund-uses')
  addFundUse(
    @Param('id') id: string,
    @Body() dto: FundUseDto,
    @Req() req: { user: { id: string } },
  ) {
    return this.labour.addFundUse(id, { ...dto, createdById: req.user.id });
  }

  @Delete('fund-uses/:id')
  deleteFundUse(@Param('id') id: string) {
    return this.labour.deleteFundUse(id);
  }

  @Get('estates')
  listEstates() {
    return this.labour.listEstates();
  }

  @Get('estates/:id')
  getEstate(@Param('id') id: string) {
    return this.labour.getEstate(id);
  }

  @Patch('estates/:estateId/houses/:projectId')
  updateEstateHouse(
    @Param('estateId') estateId: string,
    @Param('projectId') projectId: string,
    @Body() dto: UpdateEstateHouseDto,
  ) {
    return this.labour.updateEstateHouse(estateId, projectId, dto);
  }

  @Post('estates/:id/houses')
  addEstateHouse(
    @Param('id') id: string,
    @Body() dto: AddEstateHouseDto,
    @Req() req: { user: { id: string } },
  ) {
    return this.labour.addEstateHouse(id, { ...dto, createdById: req.user.id });
  }

  @Post('estates')
  createEstate(
    @Body() dto: CreateEstateDto,
    @Req() req: { user: { id: string } },
  ) {
    return this.labour.createEstate({ ...dto, createdById: req.user.id });
  }

  @Get('estates/:id/statement')
  getEstateStatement(@Param('id') id: string) {
    return this.labour.getEstateStatement(id);
  }

  @Post('estates/:id/ledger')
  addEstateLedger(
    @Param('id') id: string,
    @Body() dto: EstateLedgerDto,
    @Req() req: { user: { id: string } },
  ) {
    return this.labour.addEstateLedgerEntry(id, {
      ...dto,
      createdById: req.user.id,
    });
  }

  @Delete('estate-ledger/:id')
  deleteEstateLedger(@Param('id') id: string) {
    return this.labour.deleteEstateLedgerEntry(id);
  }

  @Get('estates/:id/export')
  async exportEstate(@Param('id') id: string, @Res() res: Response) {
    const buf = await this.labour.exportEstateExcel(id);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="estate-${id}.csv"`,
    );
    res.send(buf);
  }

  @Post('bulk-labour')
  bulkApply(
    @Body() dto: BulkLabourDto,
    @Req() req: { user: { id: string } },
  ) {
    return this.labour.bulkApply({ ...dto, createdById: req.user.id });
  }

  @Get('bulk-labour/estates')
  listForBulk(@Query('id') id?: string) {
    if (id) return this.labour.getEstate(id);
    return this.labour.listEstates();
  }
}

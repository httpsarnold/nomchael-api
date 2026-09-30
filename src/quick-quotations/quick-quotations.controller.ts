import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ArrayMinSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { QuickQuotationsService } from './quick-quotations.service';

class QuickQuotationItemDto {
  @IsString()
  @MinLength(1)
  description!: string;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsNumber()
  @Min(0)
  quantity!: number;

  @IsNumber()
  @Min(0)
  unitPriceCents!: number;
}

class QuickQuotationDto {
  @IsString()
  @MinLength(1)
  clientName!: string;

  @IsOptional()
  @IsString()
  clientPhone?: string;

  @IsOptional()
  @IsString()
  clientAddress?: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  validUntil?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  discountCents?: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => QuickQuotationItemDto)
  items!: QuickQuotationItemDto[];
}

@Controller('quick-quotations')
@UseGuards(JwtAuthGuard)
export class QuickQuotationsController {
  constructor(private quick: QuickQuotationsService) {}

  @Get()
  list(@Query('q') q?: string) {
    return this.quick.list(q);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.quick.get(id);
  }

  @Get(':id/pdf')
  async pdf(@Param('id') id: string, @Res() res: Response) {
    const { buffer, filename } = await this.quick.buildPdf(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }

  @Post()
  create(@Body() dto: QuickQuotationDto, @Req() req: { user: { id: string } }) {
    return this.quick.create(dto, req.user.id);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: QuickQuotationDto) {
    return this.quick.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.quick.remove(id);
  }
}

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IsBoolean, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { serializeMoney } from '../common/money';

class CatalogItemDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsNumber()
  @Min(0)
  defaultUnitPriceCents!: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

class UpdateCatalogItemDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  defaultUnitPriceCents?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

@Controller('catalog')
@UseGuards(JwtAuthGuard)
export class CatalogController {
  constructor(private prisma: PrismaService) {}

  @Get()
  async findAll(@Query('q') q?: string, @Query('activeOnly') activeOnly?: string) {
    const onlyActive = activeOnly !== 'false';
    const list = await this.prisma.catalogItem.findMany({
      where: {
        ...(onlyActive ? { isActive: true } : {}),
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: 'insensitive' } },
                { category: { contains: q, mode: 'insensitive' } },
                { description: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
    return list.map((i) => serializeMoney(i));
  }

  @Post()
  async create(@Body() dto: CatalogItemDto) {
    const name = dto.name.trim();
    if (!name) throw new BadRequestException('Name is required');
    const existing = await this.prisma.catalogItem.findUnique({ where: { name } });
    if (existing) {
      throw new BadRequestException(`Catalog already has "${name}". Update that item instead.`);
    }
    const created = await this.prisma.catalogItem.create({
      data: {
        name,
        unit: dto.unit || 'ea',
        description: dto.description,
        category: dto.category,
        defaultUnitPriceCents: BigInt(Math.round(dto.defaultUnitPriceCents)),
        isActive: dto.isActive ?? true,
      },
    });
    return serializeMoney(created);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateCatalogItemDto) {
    const item = await this.prisma.catalogItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Catalog item not found');

    if (dto.name && dto.name.trim() !== item.name) {
      const clash = await this.prisma.catalogItem.findUnique({
        where: { name: dto.name.trim() },
      });
      if (clash) throw new BadRequestException(`Catalog already has "${dto.name.trim()}"`);
    }

    const updated = await this.prisma.catalogItem.update({
      where: { id },
      data: {
        ...(dto.name != null ? { name: dto.name.trim() } : {}),
        ...(dto.unit != null ? { unit: dto.unit } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.category !== undefined ? { category: dto.category } : {}),
        ...(dto.defaultUnitPriceCents != null
          ? { defaultUnitPriceCents: BigInt(Math.round(dto.defaultUnitPriceCents)) }
          : {}),
        ...(dto.isActive != null ? { isActive: dto.isActive } : {}),
      },
    });
    return serializeMoney(updated);
  }
}

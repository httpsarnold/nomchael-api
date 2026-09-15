import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

class StageTemplateDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsInt()
  @Min(0)
  sortOrder!: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

@Controller('stage-templates')
@UseGuards(JwtAuthGuard)
export class StageTemplatesController {
  constructor(private prisma: PrismaService) {}

  @Get()
  findAll() {
    return this.prisma.stageTemplate.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  @Get('all')
  findAllIncludingInactive() {
    return this.prisma.stageTemplate.findMany({ orderBy: { sortOrder: 'asc' } });
  }

  @Post()
  create(@Body() dto: StageTemplateDto) {
    return this.prisma.stageTemplate.create({ data: dto });
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: Partial<StageTemplateDto>) {
    return this.prisma.stageTemplate.update({ where: { id }, data: dto });
  }
}

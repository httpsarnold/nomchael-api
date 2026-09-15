import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { PaymentMethod, SiteVisitStatus } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SiteVisitsService } from './site-visits.service';
import { PaymentsService } from '../payments/payments.service';

class CreateSiteVisitDto {
  @IsString()
  clientId!: string;

  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsString()
  address?: string;

  /** Optional at schedule time. Company sets the real fee when taking payment (varies per visit). */
  @IsOptional()
  @IsNumber()
  @Min(0)
  feeCents?: number;

  @IsOptional()
  @IsString()
  scheduledAt?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

class PaySiteVisitDto {
  @IsOptional()
  @IsString()
  projectId?: string;

  /** Required unless the visit already has a fee. You set this amount when collecting payment. */
  @IsOptional()
  @IsNumber()
  @Min(1)
  feeCents?: number;

  @IsOptional()
  @IsString()
  method?: PaymentMethod;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  print?: boolean;
}

class LinkProjectDto {
  @IsString()
  projectId!: string;
}

class ScheduleSiteVisitDto {
  @IsString()
  scheduledAt!: string;
}

@Controller('site-visits')
@UseGuards(JwtAuthGuard)
export class SiteVisitsController {
  constructor(
    private visits: SiteVisitsService,
    private payments: PaymentsService,
  ) {}

  @Get()
  findAll(
    @Query('clientId') clientId?: string,
    @Query('projectId') projectId?: string,
    @Query('status') status?: SiteVisitStatus,
  ) {
    return this.visits.findAll({ clientId, projectId, status });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.visits.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateSiteVisitDto) {
    return this.visits.create(dto);
  }

  @Patch(':id/link-project')
  linkProject(@Param('id') id: string, @Body() dto: LinkProjectDto) {
    return this.visits.linkProject(id, dto.projectId);
  }

  @Patch(':id/schedule')
  setSchedule(@Param('id') id: string, @Body() dto: ScheduleSiteVisitDto) {
    return this.visits.setSchedule(id, dto.scheduledAt);
  }

  @Post(':id/pay')
  async pay(
    @Param('id') id: string,
    @Body() dto: PaySiteVisitDto,
    @Req() req: { user: { id: string } },
  ) {
    const { visit, project } = await this.visits.pay(id, dto);
    return this.payments.create({
      projectId: project.id,
      siteVisitId: visit.id,
      purpose: 'SITE_VISIT',
      amountCents: Number(visit.feeCents),
      method: dto.method,
      reference: dto.reference,
      notes: dto.notes || `Site visit fee ${visit.code}`,
      createdById: req.user.id,
      print: dto.print,
    });
  }

  @Post(':id/complete')
  complete(@Param('id') id: string) {
    return this.visits.markCompleted(id);
  }
}

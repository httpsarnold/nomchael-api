import { Body, Controller, Get, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ProjectStatus, PropertyType, RoomType } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ProjectsService } from './projects.service';

class RoomBody {
  @IsEnum(RoomType)
  roomType!: RoomType;

  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;

  @IsOptional()
  @IsString()
  floorLevel?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

class CreateProjectBody {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsString()
  clientId!: string;

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
  locationNotes?: string;

  @IsOptional()
  @IsEnum(PropertyType)
  propertyType?: PropertyType;

  @IsOptional()
  @IsInt()
  @Min(1)
  unitCount?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  storeys?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  bedrooms?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  bathrooms?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  kitchens?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  lounges?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  otherRooms?: number;

  @IsOptional()
  @IsNumber()
  floorAreaSqm?: number;

  @IsOptional()
  @IsString()
  propertyNotes?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RoomBody)
  rooms?: RoomBody[];

  @IsOptional()
  @IsArray()
  stageTemplateNames?: string[];

  @IsOptional()
  @IsString()
  startFromTemplateName?: string;
}

class UpdateProjectBody {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

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
  locationNotes?: string;

  @IsOptional()
  @IsEnum(ProjectStatus)
  status?: ProjectStatus;

  @IsOptional()
  @IsEnum(PropertyType)
  propertyType?: PropertyType;

  @IsOptional()
  @IsInt()
  @Min(1)
  unitCount?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  storeys?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  bedrooms?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  bathrooms?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  kitchens?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  lounges?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  otherRooms?: number;

  @IsOptional()
  @IsNumber()
  floorAreaSqm?: number;

  @IsOptional()
  @IsString()
  propertyNotes?: string;
}

class AddStageBody {
  @IsString()
  name!: string;

  @IsOptional()
  @IsNumber()
  labourCents?: number;
}

@Controller('projects')
@UseGuards(JwtAuthGuard)
export class ProjectsController {
  constructor(private projects: ProjectsService) {}

  @Get()
  findAll() {
    return this.projects.findAll();
  }

  @Get('needs-location')
  needsLocation() {
    return this.projects.needsLocation();
  }

  @Get('schedule')
  schedule() {
    return this.projects.scheduleOverview();
  }

  @Get('lagging')
  lagging() {
    return this.projects.laggingProjects();
  }

  @Get('map')
  map(@Query('view') view?: 'all' | 'running' | 'finished' | 'showcase') {
    return this.projects.mapMarkers(view || 'showcase');
  }

  @Get('geocode')
  geocode(@Query('q') q: string) {
    return this.projects.geocode(q || '');
  }

  @Get(':id/pdf')
  async pdf(@Param('id') id: string, @Res() res: Response) {
    const { buffer, filename } = await this.projects.buildPdfBuffer(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  }

  @Get(':id/ledger')
  ledger(@Param('id') id: string) {
    return this.projects.projectLedger(id);
  }

  @Get(':id/ledger/pdf')
  async ledgerPdf(@Param('id') id: string, @Res() res: Response) {
    const { buffer, filename } = await this.projects.projectLedgerPdf(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.projects.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateProjectBody) {
    return this.projects.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateProjectBody) {
    return this.projects.update(id, dto);
  }

  @Post(':id/rooms')
  addRoom(@Param('id') id: string, @Body() dto: RoomBody) {
    return this.projects.addRoom(id, dto);
  }

  @Post(':id/stages')
  addStage(@Param('id') id: string, @Body() dto: AddStageBody) {
    return this.projects.addStage(id, dto.name, dto.labourCents || 0);
  }

  @Post(':id/stages/:stageId/complete')
  complete(
    @Param('id') id: string,
    @Param('stageId') stageId: string,
    @Body() body: { completed?: boolean },
  ) {
    return this.projects.completeStage(id, stageId, body.completed !== false);
  }

  @Patch(':id/plan')
  updatePlan(
    @Param('id') id: string,
    @Body() body: { plannedStartAt?: string | null; plannedEndAt?: string | null },
  ) {
    return this.projects.updateProjectPlan(id, body);
  }

  @Patch(':id/stages/:stageId/plan')
  updateStagePlan(
    @Param('id') id: string,
    @Param('stageId') stageId: string,
    @Body()
    body: {
      plannedStartAt?: string | null;
      plannedEndAt?: string | null;
      actualStartAt?: string | null;
    },
  ) {
    return this.projects.updateStagePlan(id, stageId, body);
  }
}

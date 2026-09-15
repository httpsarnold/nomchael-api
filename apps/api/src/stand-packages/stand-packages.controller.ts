import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';
import { ProjectStatus, PropertyType } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StandPackagesService } from './stand-packages.service';

class CreateStandPackageBody {
  @IsString()
  clientId!: string;

  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsInt()
  @Min(1)
  standCount!: number;

  @IsOptional()
  @IsEnum(PropertyType)
  propertyType?: PropertyType;

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
  @IsArray()
  stageTemplateNames?: string[];

  @IsOptional()
  @IsString()
  startFromTemplateName?: string;
}

class BulkUpdateBody {
  @IsOptional()
  @IsBoolean()
  all?: boolean;

  @IsOptional()
  @IsArray()
  projectIds?: string[];

  @IsOptional()
  @IsEnum(ProjectStatus)
  status?: ProjectStatus;

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
  @IsString()
  propertyNotes?: string;

  @IsOptional()
  @IsEnum(PropertyType)
  propertyType?: PropertyType;

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
}

class AccountSplitBody {
  @IsOptional()
  @IsBoolean()
  all?: boolean;

  @IsOptional()
  @IsArray()
  projectIds?: string[];

  @IsOptional()
  @IsString()
  accountName?: string;
}

class AccountMergeBody {
  @IsOptional()
  @IsBoolean()
  all?: boolean;

  @IsOptional()
  @IsArray()
  projectIds?: string[];
}

@Controller('stand-packages')
@UseGuards(JwtAuthGuard)
export class StandPackagesController {
  constructor(private standPackages: StandPackagesService) {}

  @Get()
  findAll(@Query('clientId') clientId?: string) {
    return this.standPackages.findAll(clientId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.standPackages.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateStandPackageBody) {
    return this.standPackages.create(dto);
  }

  @Post(':id/bulk-update')
  bulkUpdate(@Param('id') id: string, @Body() dto: BulkUpdateBody) {
    return this.standPackages.bulkUpdate(id, dto);
  }

  @Post(':id/split-accounts')
  splitAccounts(@Param('id') id: string, @Body() dto: AccountSplitBody) {
    return this.standPackages.splitAccounts(id, dto);
  }

  @Post(':id/merge-accounts')
  mergeAccounts(@Param('id') id: string, @Body() dto: AccountMergeBody) {
    return this.standPackages.mergeAccounts(id, dto);
  }
}

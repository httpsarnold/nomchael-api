import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { IsBoolean, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../common/roles.decorator';
import { ShortfallsService } from './shortfalls.service';

class CreateShortfallDto {
  @IsString()
  projectId!: string;

  @IsNumber()
  @Min(1)
  amountCents!: number;

  @IsString()
  reason!: string;
}

class DecideDto {
  @IsBoolean()
  approve!: boolean;

  @IsOptional()
  @IsString()
  rejectionReason?: string;
}

@Controller('shortfalls')
@UseGuards(JwtAuthGuard)
export class ShortfallsController {
  constructor(private shortfalls: ShortfallsService) {}

  @Get()
  findAll() {
    return this.shortfalls.findAll();
  }

  @Post()
  create(@Body() dto: CreateShortfallDto) {
    return this.shortfalls.create(dto.projectId, dto.amountCents, dto.reason);
  }

  @Post(':id/decide')
  @UseGuards(RolesGuard)
  @Roles(UserRole.MANAGING_DIRECTOR, UserRole.SUPER_ADMIN)
  decide(
    @Param('id') id: string,
    @Body() dto: DecideDto,
    @Req() req: { user: { id: string; role: UserRole } },
  ) {
    return this.shortfalls.approve(id, req.user, dto.approve, dto.rejectionReason);
  }
}

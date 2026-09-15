import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { IsBoolean, IsEnum, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { PaymentMethod } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PaymentsService } from './payments.service';

class CreatePaymentDto {
  @IsString()
  projectId!: string;

  @IsNumber()
  @Min(1)
  amountCents!: number;

  @IsOptional()
  @IsEnum(PaymentMethod)
  method?: PaymentMethod;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsBoolean()
  print?: boolean;
}

@Controller('payments')
@UseGuards(JwtAuthGuard)
export class PaymentsController {
  constructor(private payments: PaymentsService) {}

  @Get()
  findAll() {
    return this.payments.findAll();
  }

  @Post()
  create(@Body() dto: CreatePaymentDto, @Req() req: { user: { id: string } }) {
    return this.payments.create({ ...dto, createdById: req.user.id });
  }

  @Post(':id/reprint')
  reprint(@Param('id') id: string) {
    return this.payments.reprint(id);
  }
}

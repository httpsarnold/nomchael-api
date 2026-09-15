import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { serializeMoney } from '../common/money';

class CreateInvoiceDto {
  @IsString()
  projectId!: string;

  @IsNumber()
  @Min(1)
  amountCents!: number;

  @IsOptional()
  @IsString()
  description?: string;
}

@Controller('invoices')
@UseGuards(JwtAuthGuard)
export class InvoicesController {
  constructor(private prisma: PrismaService) {}

  @Get()
  async findAll() {
    const list = await this.prisma.invoice.findMany({
      where: { deletedAt: null },
      include: { project: { include: { client: true } } },
      orderBy: { issuedAt: 'desc' },
    });
    return list.map((i) => serializeMoney(i));
  }

  @Post()
  async create(@Body() dto: CreateInvoiceDto) {
    const counter = await this.prisma.counter.upsert({
      where: { id: 'invoice' },
      create: { id: 'invoice', value: 1 },
      update: { value: { increment: 1 } },
    });
    const invoice = await this.prisma.invoice.create({
      data: {
        projectId: dto.projectId,
        invoiceNumber: `INV-${String(counter.value).padStart(6, '0')}`,
        amountCents: BigInt(dto.amountCents),
        description: dto.description,
      },
      include: { project: { include: { client: true } } },
    });
    return serializeMoney(invoice);
  }
}

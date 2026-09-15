import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { IsEmail, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { ClientType } from '@prisma/client';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { serializeMoney } from '../common/money';
import { normalizePhoneDigits, formatPhoneDisplay } from '../common/phone';
import { ClientsService } from './clients.service';

class ClientDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  phone!: string;

  @IsOptional()
  @IsString()
  whatsapp?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsEnum(ClientType)
  type?: ClientType;

  @IsOptional()
  @IsString()
  contactPerson?: string;

  @IsOptional()
  @IsString()
  registrationNo?: string;

  @IsOptional()
  @IsString()
  parentClientId?: string;
}

@Controller('clients')
@UseGuards(JwtAuthGuard)
export class ClientsController {
  constructor(
    private prisma: PrismaService,
    private clients: ClientsService,
  ) {}

  @Get()
  async findAll(@Query('type') type?: ClientType, @Query('q') q?: string) {
    const term = q?.trim();
    const clients = await this.prisma.client.findMany({
      where: {
        ...(type ? { type } : {}),
        ...(term
          ? {
              OR: [
                { name: { contains: term, mode: 'insensitive' } },
                { phone: { contains: term, mode: 'insensitive' } },
                { whatsapp: { contains: term, mode: 'insensitive' } },
                { email: { contains: term, mode: 'insensitive' } },
                { contactPerson: { contains: term, mode: 'insensitive' } },
                { registrationNo: { contains: term, mode: 'insensitive' } },
              ],
            }
          : { parentClientId: null }),
      },
      include: {
        _count: { select: { projects: true, standPackages: true, childAccounts: true } },
        ledger: { orderBy: { createdAt: 'desc' }, take: 1 },
        parentClient: { select: { id: true, name: true } },
      },
      orderBy: { name: 'asc' },
      take: term ? 40 : 500,
    });
    return clients.map((c) =>
      serializeMoney({
        ...c,
        balanceCents: c.ledger[0]?.balanceCents ?? 0n,
        ledger: undefined,
      }),
    );
  }

  @Get(':id/statement/pdf')
  async statementPdf(
    @Param('id') id: string,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Res() res: Response,
  ) {
    const { buffer, filename } = await this.clients.buildStatementPdfBuffer(id, from, to);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  }

  @Get(':id/statement')
  statement(
    @Param('id') id: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.clients.getStatement(id, from, to);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const client = await this.prisma.client.findUniqueOrThrow({
      where: { id },
      include: {
        projects: {
          orderBy: { createdAt: 'desc' },
          include: {
            standPackage: { select: { id: true, code: true, name: true } },
          },
        },
        standPackages: {
          orderBy: { createdAt: 'desc' },
          include: {
            _count: { select: { projects: true } },
            projects: {
              select: {
                id: true,
                code: true,
                name: true,
                status: true,
                standNumber: true,
                clientId: true,
              },
              orderBy: { standNumber: 'asc' },
            },
          },
        },
        childAccounts: {
          include: { _count: { select: { projects: true } } },
        },
        parentClient: { select: { id: true, name: true } },
        ledger: { orderBy: { createdAt: 'desc' }, take: 50 },
      },
    });
    return serializeMoney(client);
  }

  @Post()
  create(@Body() dto: ClientDto) {
    const phone = formatPhoneDisplay(normalizePhoneDigits(dto.phone));
    const whatsapp = formatPhoneDisplay(
      normalizePhoneDigits(dto.whatsapp || dto.phone),
    );
    if (!phone) {
      throw new BadRequestException(
        'Enter a valid phone. UK example: 447588830800 or +44 7588 830800. Zimbabwe: 0771234567 or +263…',
      );
    }
    return this.prisma.client.create({
      data: {
        name: dto.name,
        phone,
        whatsapp: whatsapp || phone,
        email: dto.email,
        address: dto.address,
        notes: dto.notes,
        type: dto.type || ClientType.INDIVIDUAL,
        contactPerson: dto.contactPerson,
        registrationNo: dto.registrationNo,
        parentClientId: dto.parentClientId,
      },
    });
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: Partial<ClientDto>) {
    const data: Record<string, unknown> = { ...dto };
    if (dto.phone != null) data.phone = formatPhoneDisplay(normalizePhoneDigits(dto.phone));
    if (dto.whatsapp != null) {
      data.whatsapp = formatPhoneDisplay(normalizePhoneDigits(dto.whatsapp));
    }
    return this.prisma.client.update({ where: { id }, data });
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.prisma.client.delete({ where: { id } });
  }
}

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { IsEnum, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { ExpenseKind, ExpenseScope } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { serializeMoney } from '../common/money';

class CreateExpenseDto {
  @IsEnum(ExpenseScope)
  scope!: ExpenseScope;

  @IsOptional()
  @IsEnum(ExpenseKind)
  kind?: ExpenseKind;

  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsString()
  employeeId?: string;

  @IsString()
  category!: string;

  @IsString()
  description!: string;

  @IsNumber()
  @Min(1)
  amountCents!: number;

  @IsOptional()
  @IsString()
  expenseDate?: string;
}

@Controller('expenses')
@UseGuards(JwtAuthGuard)
export class ExpensesController {
  constructor(private prisma: PrismaService) {}

  /** Project expenses require client income (payment) first. */
  private async assertProjectHasIncome(projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, code: true, name: true, amountPaidCents: true },
    });
    if (!project) throw new BadRequestException('Project not found');
    if (Number(project.amountPaidCents) <= 0) {
      throw new BadRequestException(
        `Cannot record an expense on ${project.code} before client income. Take a payment first.`,
      );
    }
    return project;
  }

  @Get()
  async findAll(
    @Query('scope') scope?: ExpenseScope,
    @Query('projectId') projectId?: string,
    @Query('kind') kind?: ExpenseKind,
    @Query('employeeId') employeeId?: string,
    @Query('q') q?: string,
  ) {
    const query = (q || '').trim();
    const list = await this.prisma.expense.findMany({
      where: {
        deletedAt: null,
        ...(scope ? { scope } : {}),
        ...(projectId ? { projectId } : {}),
        ...(kind ? { kind } : {}),
        ...(employeeId ? { employeeId } : {}),
        ...(query
          ? {
              OR: [
                { description: { contains: query, mode: 'insensitive' } },
                { category: { contains: query, mode: 'insensitive' } },
                { project: { code: { contains: query, mode: 'insensitive' } } },
                { project: { name: { contains: query, mode: 'insensitive' } } },
                { employee: { fullName: { contains: query, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      include: {
        project: true,
        employee: { select: { id: true, fullName: true, roleTitle: true } },
        createdBy: { select: { id: true, fullName: true } },
      },
      orderBy: { expenseDate: 'desc' },
      take: 300,
    });
    return list.map((e) => serializeMoney(e));
  }

  @Post()
  async create(@Body() dto: CreateExpenseDto, @Req() req: { user: { id: string } }) {
    const kind = dto.kind || ExpenseKind.STANDARD;
    let scope = dto.scope;
    let projectId: string | null = null;
    let employeeId: string | null = null;

    if (kind === ExpenseKind.PERSONAL) {
      // Personal company cost tied to an employee (fuel allowance, etc.)
      scope = ExpenseScope.GENERAL;
      if (!dto.employeeId) {
        throw new BadRequestException(
          'Personal expenses must be linked to an employee from the staff database.',
        );
      }
      const emp = await this.prisma.employee.findUnique({ where: { id: dto.employeeId } });
      if (!emp || !emp.isActive) {
        throw new BadRequestException('Select an active employee for this personal expense.');
      }
      employeeId = emp.id;
    } else if (kind === ExpenseKind.PROJECT_SITE || scope === ExpenseScope.PROJECT) {
      // Site costs (food for crew, etc.) charge the client project
      scope = ExpenseScope.PROJECT;
      if (!dto.projectId) {
        throw new BadRequestException('projectId is required for project / site expenses');
      }
      await this.assertProjectHasIncome(dto.projectId);
      projectId = dto.projectId;
      employeeId = dto.employeeId || null;
      const category = (dto.category || '').trim().toLowerCase();
      if (category === 'materials' || category === 'material') {
        throw new BadRequestException(
          'Materials must follow the project lifecycle: quote → client payment → purchase on Stores & Stock. Do not record materials as a freeform expense.',
        );
      }
    } else {
      // STANDARD GENERAL company expense
      scope = ExpenseScope.GENERAL;
      employeeId = dto.employeeId || null;
    }

    const expense = await this.prisma.expense.create({
      data: {
        scope,
        kind: kind === ExpenseKind.PROJECT_SITE ? ExpenseKind.PROJECT_SITE : kind,
        projectId,
        employeeId,
        category: dto.category,
        description: dto.description,
        amountCents: BigInt(dto.amountCents),
        expenseDate: dto.expenseDate ? new Date(dto.expenseDate) : new Date(),
        createdById: req.user.id,
      },
      include: {
        project: true,
        employee: { select: { id: true, fullName: true } },
      },
    });
    await this.prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'EXPENSE_CREATE',
        entityType: 'Expense',
        entityId: expense.id,
        metadata: {
          amountCents: dto.amountCents,
          scope,
          kind,
          employeeId,
          projectId,
        },
      },
    });
    return serializeMoney(expense);
  }
}

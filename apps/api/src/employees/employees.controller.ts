import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { serializeMoney } from '../common/money';

class EmployeeDto {
  @IsString()
  fullName!: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  roleTitle?: string;

  @IsOptional()
  @IsNumber()
  dailyWageCents?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

class AssignDto {
  @IsString()
  projectId!: string;

  @IsString()
  employeeId!: string;

  @IsOptional()
  @IsNumber()
  dailyWageCents?: number;

  @IsOptional()
  @IsNumber()
  daysWorked?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

@Controller('employees')
@UseGuards(JwtAuthGuard)
export class EmployeesController {
  constructor(private prisma: PrismaService) {}

  @Get()
  async findAll() {
    const list = await this.prisma.employee.findMany({
      include: { assignments: { include: { project: true } } },
      orderBy: { fullName: 'asc' },
    });
    return list.map((e) => serializeMoney(e));
  }

  @Post()
  async create(@Body() dto: EmployeeDto) {
    const emp = await this.prisma.employee.create({
      data: {
        fullName: dto.fullName,
        phone: dto.phone,
        email: dto.email,
        roleTitle: dto.roleTitle,
        dailyWageCents: BigInt(dto.dailyWageCents || 0),
        notes: dto.notes,
        hiredAt: new Date(),
      },
    });
    return serializeMoney(emp);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: Partial<EmployeeDto>) {
    const emp = await this.prisma.employee.update({
      where: { id },
      data: {
        ...dto,
        dailyWageCents:
          dto.dailyWageCents != null ? BigInt(dto.dailyWageCents) : undefined,
      },
    });
    return serializeMoney(emp);
  }

  @Post('assign')
  async assign(@Body() dto: AssignDto) {
    const employee = await this.prisma.employee.findUnique({ where: { id: dto.employeeId } });
    if (!employee) throw new Error('Employee not found');
    const assignment = await this.prisma.projectAssignment.create({
      data: {
        projectId: dto.projectId,
        employeeId: dto.employeeId,
        dailyWageCents: BigInt(dto.dailyWageCents ?? Number(employee.dailyWageCents)),
        daysWorked: dto.daysWorked || 0,
        notes: dto.notes,
      },
      include: { employee: true, project: true },
    });
    return serializeMoney(assignment);
  }

  @Patch('assignments/:id')
  async updateAssignment(
    @Param('id') id: string,
    @Body() body: { daysWorked?: number; endDate?: string; notes?: string },
  ) {
    const assignment = await this.prisma.projectAssignment.update({
      where: { id },
      data: {
        daysWorked: body.daysWorked,
        endDate: body.endDate ? new Date(body.endDate) : undefined,
        notes: body.notes,
      },
      include: { employee: true, project: true },
    });
    return serializeMoney(assignment);
  }

  @Get('project/:projectId')
  async byProject(@Param('projectId') projectId: string) {
    const list = await this.prisma.projectAssignment.findMany({
      where: { projectId },
      include: { employee: true },
    });
    return list.map((a) =>
      serializeMoney({
        ...a,
        labourCostCents: Math.round(Number(a.dailyWageCents) * Number(a.daysWorked)),
      }),
    );
  }
}

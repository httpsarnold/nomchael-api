import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AccountMode,
  ClientType,
  ProjectStatus,
  PropertyType,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { suggestedStagesForPropertyType } from '../shared';
import { PrismaService } from '../prisma/prisma.service';
import { serializeMoney } from '../common/money';

export interface CreateStandPackageDto {
  clientId: string;
  name: string;
  description?: string;
  standCount: number;
  propertyType?: PropertyType;
  bedrooms?: number;
  bathrooms?: number;
  kitchens?: number;
  lounges?: number;
  otherRooms?: number;
  storeys?: number;
  floorAreaSqm?: number;
  propertyNotes?: string;
  address?: string;
  locationLat?: number;
  locationLng?: number;
  locationNotes?: string;
  stageTemplateNames?: string[];
  startFromTemplateName?: string;
}

export interface BulkUpdateDto {
  all?: boolean;
  projectIds?: string[];
  status?: ProjectStatus;
  address?: string;
  locationLat?: number | null;
  locationLng?: number | null;
  locationNotes?: string;
  propertyNotes?: string;
  propertyType?: PropertyType;
  bedrooms?: number;
  bathrooms?: number;
  kitchens?: number;
  lounges?: number;
  otherRooms?: number;
  floorAreaSqm?: number | null;
}

@Injectable()
export class StandPackagesService {
  constructor(private prisma: PrismaService) {}

  private async nextPackageCode() {
    const counter = await this.prisma.counter.upsert({
      where: { id: 'stand-package' },
      create: { id: 'stand-package', value: 1 },
      update: { value: { increment: 1 } },
    });
    return `PKG-${String(counter.value).padStart(4, '0')}`;
  }

  async create(dto: CreateStandPackageDto) {
    const client = await this.prisma.client.findUnique({ where: { id: dto.clientId } });
    if (!client) throw new NotFoundException('Client not found');
    if (client.type !== ClientType.COMPANY) {
      throw new BadRequestException('Stand packages can only be created for company clients');
    }
    if (!dto.standCount || dto.standCount < 1 || dto.standCount > 500) {
      throw new BadRequestException('Stand count must be between 1 and 500');
    }

    const name = dto.name.trim();
    if (!name) throw new BadRequestException('Package name is required');

    const code = await this.nextPackageCode();
    const pkg = await this.prisma.standPackage.create({
      data: {
        code,
        name,
        description: dto.description,
        clientId: dto.clientId,
        standCount: dto.standCount,
        propertyType: dto.propertyType || PropertyType.SINGLE_HOME,
        bedrooms: dto.bedrooms ?? 0,
        bathrooms: dto.bathrooms ?? 0,
        kitchens: dto.kitchens ?? 0,
        lounges: dto.lounges ?? 0,
        otherRooms: dto.otherRooms ?? 0,
        storeys: Math.max(1, dto.storeys ?? 1),
        floorAreaSqm: dto.floorAreaSqm,
        propertyNotes: dto.propertyNotes,
        address: dto.address,
        locationLat: dto.locationLat,
        locationLng: dto.locationLng,
        locationNotes: dto.locationNotes,
      },
    });

    const propertyType = dto.propertyType || PropertyType.SINGLE_HOME;
    let stageNames =
      dto.stageTemplateNames?.length
        ? dto.stageTemplateNames
        : suggestedStagesForPropertyType(propertyType);
    if (dto.startFromTemplateName) {
      const startName = dto.startFromTemplateName.toLowerCase();
      const startIdx = stageNames.findIndex((n) => n.toLowerCase() === startName);
      if (startIdx >= 0) stageNames = stageNames.slice(startIdx);
    }
    if (!stageNames.length) {
      const templates = await this.prisma.stageTemplate.findMany({
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
      });
      stageNames = templates.map((t) => t.name);
    }

    const counter = await this.prisma.counter.upsert({
      where: { id: 'project' },
      create: { id: 'project', value: dto.standCount },
      update: { value: { increment: dto.standCount } },
    });
    const end = counter.value;
    const start = end - dto.standCount + 1;

    const projectRows = [];
    for (let i = 1; i <= dto.standCount; i++) {
      const id = randomUUID().replace(/-/g, '').slice(0, 24);
      projectRows.push({
        id,
        code: `PRJ-${String(start + i - 1).padStart(5, '0')}`,
        name: `${name} · Stand ${i}`,
        clientId: dto.clientId,
        address: dto.address,
        locationLat: dto.locationLat,
        locationLng: dto.locationLng,
        locationNotes: dto.locationNotes,
        propertyType,
        unitCount: 1,
        storeys: Math.max(1, dto.storeys ?? 1),
        bedrooms: dto.bedrooms ?? 0,
        bathrooms: dto.bathrooms ?? 0,
        kitchens: dto.kitchens ?? 0,
        lounges: dto.lounges ?? 0,
        otherRooms: dto.otherRooms ?? 0,
        floorAreaSqm: dto.floorAreaSqm,
        propertyNotes: dto.propertyNotes,
        standPackageId: pkg.id,
        standNumber: i,
        status: ProjectStatus.DRAFT,
      });
    }

    await this.prisma.project.createMany({ data: projectRows });
    const stageRows = projectRows.flatMap((p) =>
      stageNames.map((stageName, idx) => ({
        id: randomUUID().replace(/-/g, '').slice(0, 24),
        projectId: p.id,
        name: stageName,
        sortOrder: idx + 1,
        templateName: stageName,
      })),
    );
    if (stageRows.length) {
      await this.prisma.projectStage.createMany({ data: stageRows });
    }

    const createdProjects = await this.prisma.project.findMany({
      where: { standPackageId: pkg.id },
      include: { stages: { orderBy: { sortOrder: 'asc' } }, client: true },
      orderBy: { standNumber: 'asc' },
    });

    return serializeMoney({
      ...pkg,
      projects: createdProjects,
    });
  }

  async findAll(clientId?: string) {
    const packages = await this.prisma.standPackage.findMany({
      where: clientId ? { clientId } : undefined,
      include: {
        client: { select: { id: true, name: true, type: true } },
        projects: {
          select: {
            id: true,
            code: true,
            name: true,
            status: true,
            standNumber: true,
            clientId: true,
            quotationTotalCents: true,
            amountPaidCents: true,
            locationLat: true,
            locationLng: true,
          },
          orderBy: { standNumber: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return packages.map((p) => serializeMoney(p));
  }

  async findOne(id: string) {
    const pkg = await this.prisma.standPackage.findUnique({
      where: { id },
      include: {
        client: true,
        projects: {
          include: {
            client: { select: { id: true, name: true, type: true, parentClientId: true } },
            stages: { select: { isCompleted: true } },
          },
          orderBy: { standNumber: 'asc' },
        },
      },
    });
    if (!pkg) throw new NotFoundException('Stand package not found');
    return serializeMoney({
      ...pkg,
      projects: pkg.projects.map((p) => {
        const completed = p.stages.filter((s) => s.isCompleted).length;
        const total = p.stages.length || 1;
        return {
          ...p,
          stages: undefined,
          completionPercent: Math.round((completed / total) * 100),
        };
      }),
    });
  }

  private async resolveTargets(packageId: string, dto: { all?: boolean; projectIds?: string[] }) {
    const projects = await this.prisma.project.findMany({
      where: { standPackageId: packageId },
      select: { id: true },
    });
    if (!projects.length) throw new BadRequestException('No stands in this package');

    if (dto.all) return projects.map((p) => p.id);

    const ids = dto.projectIds || [];
    if (!ids.length) {
      throw new BadRequestException('Select stands or choose update all');
    }
    const allowed = new Set(projects.map((p) => p.id));
    const invalid = ids.filter((id) => !allowed.has(id));
    if (invalid.length) throw new BadRequestException('Some selected stands are not in this package');
    return ids;
  }

  async bulkUpdate(packageId: string, dto: BulkUpdateDto) {
    await this.prisma.standPackage.findUniqueOrThrow({ where: { id: packageId } });
    const ids = await this.resolveTargets(packageId, dto);

    const data: Record<string, unknown> = {};
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.address !== undefined) data.address = dto.address;
    if (dto.locationLat !== undefined) data.locationLat = dto.locationLat;
    if (dto.locationLng !== undefined) data.locationLng = dto.locationLng;
    if (dto.locationNotes !== undefined) data.locationNotes = dto.locationNotes;
    if (dto.propertyNotes !== undefined) data.propertyNotes = dto.propertyNotes;
    if (dto.propertyType !== undefined) data.propertyType = dto.propertyType;
    if (dto.bedrooms !== undefined) data.bedrooms = dto.bedrooms;
    if (dto.bathrooms !== undefined) data.bathrooms = dto.bathrooms;
    if (dto.kitchens !== undefined) data.kitchens = dto.kitchens;
    if (dto.lounges !== undefined) data.lounges = dto.lounges;
    if (dto.otherRooms !== undefined) data.otherRooms = dto.otherRooms;
    if (dto.floorAreaSqm !== undefined) data.floorAreaSqm = dto.floorAreaSqm;

    if (dto.status === ProjectStatus.ACTIVE) {
      throw new BadRequestException(
        'Cannot bulk-open stands to File open. Each stand needs a paid site visit and an MD-approved quotation (Open a project / Quotations).',
      );
    }

    if (!Object.keys(data).length) {
      throw new BadRequestException('No update fields provided');
    }

    await this.prisma.project.updateMany({
      where: { id: { in: ids } },
      data,
    });

    return this.findOne(packageId);
  }

  async splitAccounts(
    packageId: string,
    dto: { all?: boolean; projectIds?: string[]; accountName?: string },
  ) {
    const pkg = await this.prisma.standPackage.findUniqueOrThrow({
      where: { id: packageId },
      include: { client: true },
    });
    const ids = await this.resolveTargets(packageId, dto);

    const accountName =
      dto.accountName?.trim() ||
      `${pkg.client.name} · ${pkg.name} · split ${new Date().toISOString().slice(0, 10)}`;

    const account = await this.prisma.client.create({
      data: {
        name: accountName,
        phone: pkg.client.phone,
        whatsapp: pkg.client.whatsapp,
        email: pkg.client.email,
        address: pkg.client.address,
        type: ClientType.COMPANY,
        parentClientId: pkg.clientId,
        contactPerson: pkg.client.contactPerson,
        notes: `Split account for package ${pkg.code}`,
      },
    });

    await this.prisma.project.updateMany({
      where: { id: { in: ids } },
      data: { clientId: account.id },
    });

    await this.prisma.standPackage.update({
      where: { id: packageId },
      data: { accountMode: AccountMode.SPLIT },
    });

    return this.findOne(packageId);
  }

  async mergeAccounts(packageId: string, dto: { all?: boolean; projectIds?: string[] }) {
    const pkg = await this.prisma.standPackage.findUniqueOrThrow({ where: { id: packageId } });
    const ids = await this.resolveTargets(packageId, dto);

    await this.prisma.project.updateMany({
      where: { id: { in: ids } },
      data: { clientId: pkg.clientId },
    });

    const remainingSplit = await this.prisma.project.count({
      where: {
        standPackageId: packageId,
        clientId: { not: pkg.clientId },
      },
    });

    if (!remainingSplit) {
      await this.prisma.standPackage.update({
        where: { id: packageId },
        data: { accountMode: AccountMode.SHARED },
      });
    }

    return this.findOne(packageId);
  }
}

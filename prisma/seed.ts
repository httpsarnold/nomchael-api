import { PrismaClient, UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { DEFAULT_STAGE_TEMPLATES } from '../src/shared';

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash('admin123', 10);

  const users = [
    {
      email: 'admin@nomchael.local',
      fullName: 'System Admin',
      role: UserRole.SUPER_ADMIN,
    },
    {
      email: 'md@nomchael.local',
      fullName: 'Managing Director',
      role: UserRole.MANAGING_DIRECTOR,
    },
    {
      email: 'accounts@nomchael.local',
      fullName: 'Accountant',
      role: UserRole.ACCOUNTANT,
    },
    {
      email: 'pm@nomchael.local',
      fullName: 'Project Manager',
      role: UserRole.PROJECT_MANAGER,
    },
    {
      email: 'clerk@nomchael.local',
      fullName: 'Site Clerk',
      role: UserRole.SITE_CLERK,
    },
  ];

  for (const u of users) {
    await prisma.user.upsert({
      where: { email: u.email },
      create: { ...u, passwordHash },
      update: { fullName: u.fullName, role: u.role, passwordHash },
    });
  }

  for (const stage of DEFAULT_STAGE_TEMPLATES) {
    await prisma.stageTemplate.upsert({
      where: { name: stage.name },
      create: { name: stage.name, sortOrder: stage.sortOrder },
      update: { sortOrder: stage.sortOrder, isActive: true },
    });
  }

  const defaultCatalog: {
    name: string;
    unit: string;
    category: string;
    defaultUnitPriceCents: bigint;
    description?: string;
  }[] = [
    { name: 'Cement 50kg', unit: 'bags', category: 'Cement & binders', defaultUnitPriceCents: 1250n },
    { name: 'River sand', unit: 'm3', category: 'Aggregates', defaultUnitPriceCents: 4500n },
    { name: 'Pit sand', unit: 'm3', category: 'Aggregates', defaultUnitPriceCents: 3500n },
    { name: 'Stone / crush', unit: 'm3', category: 'Aggregates', defaultUnitPriceCents: 5500n },
    { name: 'Common brick', unit: 'each', category: 'Brickwork', defaultUnitPriceCents: 18n },
    { name: 'Face brick', unit: 'each', category: 'Brickwork', defaultUnitPriceCents: 35n },
    { name: 'Stock brick', unit: 'each', category: 'Brickwork', defaultUnitPriceCents: 22n },
    { name: 'Y12 reinforcement bar', unit: 'm', category: 'Steel', defaultUnitPriceCents: 280n },
    { name: 'Y16 reinforcement bar', unit: 'm', category: 'Steel', defaultUnitPriceCents: 420n },
    { name: 'Binding wire', unit: 'kg', category: 'Steel', defaultUnitPriceCents: 250n },
    { name: 'Damp proof course', unit: 'm', category: 'Damp proofing', defaultUnitPriceCents: 120n },
    { name: 'Damp proof membrane', unit: 'm2', category: 'Damp proofing', defaultUnitPriceCents: 180n },
    { name: 'Timber truss / rafter', unit: 'm', category: 'Roofing', defaultUnitPriceCents: 650n },
    { name: 'IBR roof sheet', unit: 'm', category: 'Roofing', defaultUnitPriceCents: 950n },
    { name: 'Roof nail / screw pack', unit: 'packs', category: 'Roofing', defaultUnitPriceCents: 800n },
    { name: 'Window standard', unit: 'each', category: 'Openings', defaultUnitPriceCents: 8500n },
    { name: 'External door', unit: 'each', category: 'Openings', defaultUnitPriceCents: 12000n },
    { name: 'Internal door', unit: 'each', category: 'Openings', defaultUnitPriceCents: 6500n },
    { name: 'Plaster sand', unit: 'm3', category: 'Plaster', defaultUnitPriceCents: 4000n },
    { name: 'Gypsum plaster', unit: 'bags', category: 'Plaster', defaultUnitPriceCents: 1800n },
    { name: 'Floor tiles', unit: 'm2', category: 'Finishes', defaultUnitPriceCents: 2200n },
    { name: 'Wall tiles', unit: 'm2', category: 'Finishes', defaultUnitPriceCents: 1800n },
    { name: 'Emulsion paint 20L', unit: 'drums', category: 'Paint', defaultUnitPriceCents: 5500n },
    { name: 'PVC pipe 110mm', unit: 'm', category: 'Plumbing', defaultUnitPriceCents: 450n },
    { name: 'Electrical cable 2.5mm', unit: 'm', category: 'Electrical', defaultUnitPriceCents: 120n },
  ];

  for (const item of defaultCatalog) {
    await prisma.catalogItem.upsert({
      where: { name: item.name },
      create: {
        name: item.name,
        unit: item.unit,
        category: item.category,
        description: item.description,
        defaultUnitPriceCents: item.defaultUnitPriceCents,
        isActive: true,
      },
      update: {
        unit: item.unit,
        category: item.category,
        // Keep existing company-edited prices; only fill description/category/unit
        description: item.description,
        isActive: true,
      },
    });
  }
  console.log(`Material catalog defaults ensured (${defaultCatalog.length} items).`);

  const projectCount = await prisma.project.count();
  if (projectCount === 0) {
    const client = await prisma.client.create({
      data: {
        name: 'Takudzwa Moyo',
        phone: '+263771234567',
        whatsapp: '+263771234567',
        address: 'Chishawasha, Harare',
        notes: 'Demo client for dashboard',
      },
    });

    const client2 = await prisma.client.create({
      data: {
        name: 'Shelter Developments',
        phone: '+263772345678',
        whatsapp: '+263772345678',
        address: 'Borrowdale, Harare',
      },
    });

    await prisma.counter.upsert({
      where: { id: 'project' },
      create: { id: 'project', value: 2 },
      update: { value: 2 },
    });

    const project = await prisma.project.create({
      data: {
        code: 'PRJ-00001',
        name: 'Takudzwa Home Rebuild',
        status: 'ACTIVE',
        address: 'Chishawasha',
        locationNotes: 'Takudzwa home in Chishawasha',
        locationLat: -17.7833,
        locationLng: 31.1833,
        clientId: client.id,
        quotationTotalCents: 12500000n,
        amountPaidCents: 4500000n,
        stages: {
          create: [
            { name: 'Foundation', sortOrder: 1, labourCents: 800000n, isCompleted: true, completedAt: new Date() },
            { name: 'Walls', sortOrder: 2, labourCents: 1200000n, isCompleted: true, completedAt: new Date() },
            { name: 'Roof Structure', sortOrder: 3, labourCents: 900000n, isCompleted: false },
            { name: 'Windows & Doors', sortOrder: 4, labourCents: 600000n, isCompleted: false },
            { name: 'Finishing', sortOrder: 5, labourCents: 700000n, isCompleted: false },
          ],
        },
      },
    });

    await prisma.project.create({
      data: {
        code: 'PRJ-00002',
        name: 'Borrowdale Extension',
        status: 'QUOTED',
        address: 'Borrowdale',
        locationLat: -17.78,
        locationLng: 31.08,
        clientId: client2.id,
        quotationTotalCents: 8200000n,
        amountPaidCents: 0n,
        stages: {
          create: [
            { name: 'Windows & Doors', sortOrder: 1, labourCents: 500000n },
            { name: 'Plastering', sortOrder: 2, labourCents: 400000n },
            { name: 'Painting', sortOrder: 3, labourCents: 350000n },
          ],
        },
      },
    });

    await prisma.counter.upsert({
      where: { id: 'receipt' },
      create: { id: 'receipt', value: 1 },
      update: { value: 1 },
    });

    await prisma.payment.create({
      data: {
        projectId: project.id,
        amountCents: 4500000n,
        method: 'BANK_TRANSFER',
        receiptNumber: 'RCP-000001',
        notes: 'Deposit on foundation and walls',
      },
    });

    await prisma.expense.createMany({
      data: [
        {
          scope: 'PROJECT',
          projectId: project.id,
          category: 'Materials',
          description: 'Cement and river sand',
          amountCents: 1800000n,
        },
        {
          scope: 'PROJECT',
          projectId: project.id,
          category: 'Machinery hire',
          description: 'Concrete mixer hire',
          amountCents: 350000n,
        },
        {
          scope: 'GENERAL',
          category: 'Operations',
          description: 'Office fuel and running costs',
          amountCents: 220000n,
        },
      ],
    });

    const supplier = await prisma.supplier.create({
      data: {
        name: 'Chitungwiza Build Mart',
        company: 'Build Mart Pvt Ltd',
        address: 'Chitungwiza',
        locationLat: -18.0128,
        locationLng: 31.0756,
        phone: '+263773000111',
      },
    });

    await prisma.supplierPrice.create({
      data: {
        supplierId: supplier.id,
        itemName: 'Cement 50kg',
        unit: 'bags',
        unitPriceCents: 1250n,
        company: 'Build Mart',
      },
    });

    await prisma.employee.create({
      data: {
        fullName: 'Farai Ncube',
        roleTitle: 'Bricklayer',
        dailyWageCents: 2500n,
        phone: '+263774001122',
        isActive: true,
        hiredAt: new Date(),
      },
    });

    await prisma.projectStock.create({
      data: {
        projectId: project.id,
        itemName: 'Cement 50kg',
        unit: 'bags',
        qtyPurchased: 20,
        qtyUsed: 10,
      },
    });

    console.log('Demo projects, payments and expenses seeded for dashboard.');
  }

  console.log('Seed complete. Default password for all users: admin123');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

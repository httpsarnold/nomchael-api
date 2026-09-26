/**
 * Wipe all business data for go-live.
 * Keeps schema. Re-seeds login users, stage templates, and catalog defaults only.
 * Does NOT create demo clients / projects / payments.
 *
 * Run: npx ts-node --transpile-only prisma/wipe-live.ts
 */
import { PrismaClient, UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { DEFAULT_STAGE_TEMPLATES } from '@nomchael/shared';

const prisma = new PrismaClient();

const TABLES = [
  'SupplierPaymentAllocation',
  'SupplierPayment',
  'SupplierLedgerEntry',
  'SupplierPayable',
  'StockMovement',
  'ProjectStock',
  'QuotationLineItem',
  'Quotation',
  'Payment',
  'Expense',
  'Shortfall',
  'Invoice',
  'ProjectAssignment',
  'ProjectFundUse',
  'EstateLedgerEntry',
  'ProjectRoom',
  'ProjectStage',
  'SiteVisit',
  'ClientLedgerEntry',
  'SupplierPrice',
  'AuditLog',
  'Project',
  'EstateProgramme',
  'StandPackage',
  'Client',
  'Employee',
  'Supplier',
  'CatalogItem',
  'Counter',
  'StageTemplate',
  'User',
];

async function wipe() {
  console.log('Wiping all tables…');
  for (const table of TABLES) {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" RESTART IDENTITY CASCADE;`);
    console.log(`  truncated ${table}`);
  }
}

async function seedEssentials() {
  console.log('Seeding live essentials (users, stages, catalog)…');
  const passwordHash = await bcrypt.hash('admin123', 10);

  const users = [
    { email: 'admin@nomchael.local', fullName: 'System Admin', role: UserRole.SUPER_ADMIN },
    { email: 'md@nomchael.local', fullName: 'Managing Director', role: UserRole.MANAGING_DIRECTOR },
    { email: 'accounts@nomchael.local', fullName: 'Accountant', role: UserRole.ACCOUNTANT },
    { email: 'pm@nomchael.local', fullName: 'Project Manager', role: UserRole.PROJECT_MANAGER },
    { email: 'clerk@nomchael.local', fullName: 'Site Clerk', role: UserRole.SITE_CLERK },
  ];

  for (const u of users) {
    await prisma.user.create({ data: { ...u, passwordHash } });
  }

  for (const stage of DEFAULT_STAGE_TEMPLATES) {
    await prisma.stageTemplate.create({
      data: { name: stage.name, sortOrder: stage.sortOrder, isActive: true },
    });
  }

  const defaultCatalog: {
    name: string;
    unit: string;
    category: string;
    defaultUnitPriceCents: bigint;
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
    await prisma.catalogItem.create({
      data: {
        name: item.name,
        unit: item.unit,
        category: item.category,
        defaultUnitPriceCents: item.defaultUnitPriceCents,
        isActive: true,
      },
    });
  }

  console.log('Live essentials ready.');
  console.log('Logins (password admin123):');
  for (const u of users) console.log(`  ${u.email}`);
}

async function main() {
  await wipe();
  await seedEssentials();
  const counts = {
    users: await prisma.user.count(),
    clients: await prisma.client.count(),
    projects: await prisma.project.count(),
    estates: await prisma.estateProgramme.count(),
    payments: await prisma.payment.count(),
    catalog: await prisma.catalogItem.count(),
  };
  console.log('Counts after wipe:', counts);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

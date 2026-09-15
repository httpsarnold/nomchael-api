export enum UserRole {
  SUPER_ADMIN = 'SUPER_ADMIN',
  MANAGING_DIRECTOR = 'MANAGING_DIRECTOR',
  ACCOUNTANT = 'ACCOUNTANT',
  PROJECT_MANAGER = 'PROJECT_MANAGER',
  SITE_CLERK = 'SITE_CLERK',
  VIEWER = 'VIEWER',
}

export enum ProjectStatus {
  DRAFT = 'DRAFT',
  QUOTED = 'QUOTED',
  ACTIVE = 'ACTIVE',
  ON_HOLD = 'ON_HOLD',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export enum QuotationStatus {
  DRAFT = 'DRAFT',
  SENT = 'SENT',
  PENDING_MD_APPROVAL = 'PENDING_MD_APPROVAL',
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
  SUPERSEDED = 'SUPERSEDED',
}

export enum ExpenseScope {
  PROJECT = 'PROJECT',
  GENERAL = 'GENERAL',
}

export enum ShortfallStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  INVOICED = 'INVOICED',
}

export enum StockMovementType {
  PURCHASE = 'PURCHASE',
  USE = 'USE',
  SELL = 'SELL',
  RETURN_TO_OWNER = 'RETURN_TO_OWNER',
  TRANSFER_OUT = 'TRANSFER_OUT',
  TRANSFER_IN = 'TRANSFER_IN',
}

export enum LineItemType {
  MATERIAL = 'MATERIAL',
  LABOUR = 'LABOUR',
  OTHER = 'OTHER',
}

export enum PropertyType {
  SINGLE_HOME = 'SINGLE_HOME',
  CLUSTER = 'CLUSTER',
  TOWNHOUSE = 'TOWNHOUSE',
  FLAT_APARTMENT = 'FLAT_APARTMENT',
  WAREHOUSE = 'WAREHOUSE',
  COMMERCIAL = 'COMMERCIAL',
  MIXED_USE = 'MIXED_USE',
  OTHER = 'OTHER',
}

export enum RoomType {
  BEDROOM = 'BEDROOM',
  BATHROOM = 'BATHROOM',
  TOILET = 'TOILET',
  KITCHEN = 'KITCHEN',
  LOUNGE = 'LOUNGE',
  DINING = 'DINING',
  STORE = 'STORE',
  GARAGE = 'GARAGE',
  OFFICE = 'OFFICE',
  PASSAGE = 'PASSAGE',
  OTHER = 'OTHER',
}

export enum ClientType {
  INDIVIDUAL = 'INDIVIDUAL',
  COMPANY = 'COMPANY',
}

export enum AccountMode {
  SHARED = 'SHARED',
  SPLIT = 'SPLIT',
}

export const PROPERTY_TYPE_LABELS: Record<PropertyType, string> = {
  [PropertyType.SINGLE_HOME]: 'Single home',
  [PropertyType.CLUSTER]: 'Cluster',
  [PropertyType.TOWNHOUSE]: 'Townhouse',
  [PropertyType.FLAT_APARTMENT]: 'Flat / apartment',
  [PropertyType.WAREHOUSE]: 'Warehouse',
  [PropertyType.COMMERCIAL]: 'Commercial',
  [PropertyType.MIXED_USE]: 'Mixed use',
  [PropertyType.OTHER]: 'Other',
};

export const ROLE_HIERARCHY: Record<UserRole, number> = {
  [UserRole.SUPER_ADMIN]: 100,
  [UserRole.MANAGING_DIRECTOR]: 90,
  [UserRole.ACCOUNTANT]: 70,
  [UserRole.PROJECT_MANAGER]: 60,
  [UserRole.SITE_CLERK]: 40,
  [UserRole.VIEWER]: 10,
};

export function hasMinRole(userRole: UserRole, minRole: UserRole): boolean {
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[minRole];
}

export const DEFAULT_STAGE_TEMPLATES = [
  { name: 'Site Clearing', sortOrder: 1 },
  { name: 'Foundation', sortOrder: 2 },
  { name: 'Slab', sortOrder: 3 },
  { name: 'Walls', sortOrder: 4 },
  { name: 'Steel Structure', sortOrder: 5 },
  { name: 'Roof Structure', sortOrder: 6 },
  { name: 'Roof Covering', sortOrder: 7 },
  { name: 'Cladding', sortOrder: 8 },
  { name: 'Windows & Doors', sortOrder: 9 },
  { name: 'Shopfront / Entrances', sortOrder: 10 },
  { name: 'Loading Bays', sortOrder: 11 },
  { name: 'Partitioning', sortOrder: 12 },
  { name: 'Plastering', sortOrder: 13 },
  { name: 'Ceilings', sortOrder: 14 },
  { name: 'Flooring', sortOrder: 15 },
  { name: 'Plumbing', sortOrder: 16 },
  { name: 'Electrical', sortOrder: 17 },
  { name: 'HVAC', sortOrder: 18 },
  { name: 'Painting', sortOrder: 19 },
  { name: 'External Works', sortOrder: 20 },
  { name: 'Finishing', sortOrder: 21 },
] as const;

const RESIDENTIAL_STAGES = [
  'Site Clearing',
  'Foundation',
  'Slab',
  'Walls',
  'Roof Structure',
  'Roof Covering',
  'Windows & Doors',
  'Plastering',
  'Flooring',
  'Plumbing',
  'Electrical',
  'Painting',
  'Finishing',
] as const;

const WAREHOUSE_STAGES = [
  'Site Clearing',
  'Foundation',
  'Slab',
  'Steel Structure',
  'Roof Structure',
  'Roof Covering',
  'Cladding',
  'Windows & Doors',
  'Loading Bays',
  'Flooring',
  'Plumbing',
  'Electrical',
  'External Works',
  'Painting',
  'Finishing',
] as const;

const COMMERCIAL_STAGES = [
  'Site Clearing',
  'Foundation',
  'Slab',
  'Walls',
  'Steel Structure',
  'Roof Structure',
  'Roof Covering',
  'Shopfront / Entrances',
  'Windows & Doors',
  'Partitioning',
  'Plastering',
  'Ceilings',
  'Flooring',
  'Plumbing',
  'Electrical',
  'HVAC',
  'Painting',
  'External Works',
  'Finishing',
] as const;

const MIXED_USE_STAGES = [
  'Site Clearing',
  'Foundation',
  'Slab',
  'Walls',
  'Steel Structure',
  'Roof Structure',
  'Roof Covering',
  'Shopfront / Entrances',
  'Windows & Doors',
  'Partitioning',
  'Plastering',
  'Ceilings',
  'Flooring',
  'Plumbing',
  'Electrical',
  'HVAC',
  'Painting',
  'External Works',
  'Finishing',
] as const;

/** Suggested build stages for each property / building type. */
export const PROPERTY_STAGE_SUGGESTIONS: Record<PropertyType, readonly string[]> = {
  [PropertyType.SINGLE_HOME]: RESIDENTIAL_STAGES,
  [PropertyType.TOWNHOUSE]: RESIDENTIAL_STAGES,
  [PropertyType.CLUSTER]: RESIDENTIAL_STAGES,
  [PropertyType.FLAT_APARTMENT]: RESIDENTIAL_STAGES,
  [PropertyType.WAREHOUSE]: WAREHOUSE_STAGES,
  [PropertyType.COMMERCIAL]: COMMERCIAL_STAGES,
  [PropertyType.MIXED_USE]: MIXED_USE_STAGES,
  [PropertyType.OTHER]: [
    'Site Clearing',
    'Foundation',
    'Slab',
    'Walls',
    'Roof Structure',
    'Roof Covering',
    'Windows & Doors',
    'Plumbing',
    'Electrical',
    'Painting',
    'Finishing',
  ],
};

export function suggestedStagesForPropertyType(type: PropertyType | string): string[] {
  const key = type as PropertyType;
  return [...(PROPERTY_STAGE_SUGGESTIONS[key] || PROPERTY_STAGE_SUGGESTIONS[PropertyType.OTHER])];
}

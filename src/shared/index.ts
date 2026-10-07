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
  { name: 'Land Clearing', sortOrder: 1 },
  { name: 'Setting out', sortOrder: 2 },
  { name: 'Trench excavation', sortOrder: 3 },
  { name: 'Concrete Bases', sortOrder: 4 },
  { name: 'Back filling and compacting Concrete Slab', sortOrder: 5 },
  { name: 'Fixing of bases, columns and ground beams', sortOrder: 6 },
  { name: 'Shuttering of bases columns and beams', sortOrder: 7 },
  { name: 'Average level', sortOrder: 8 },
  { name: 'Window level', sortOrder: 9 },
  { name: 'Shuttering of ring beam', sortOrder: 10 },
  { name: 'Steel fixing', sortOrder: 11 },
  { name: 'Wall plate FF', sortOrder: 12 },
  { name: 'Concrete roof deck 1', sortOrder: 13 },
  { name: 'Concrete roof deck 2', sortOrder: 14 },
  { name: 'Roof deck steel fixing 1', sortOrder: 15 },
  { name: 'Roof deck steel fixing 2', sortOrder: 16 },
  { name: 'Parapet and wall coping', sortOrder: 17 },
  { name: 'Plumbing fix and supply', sortOrder: 18 },
  // Kept for older project files / commercial builds
  { name: 'Site Clearing', sortOrder: 100 },
  { name: 'Foundation', sortOrder: 101 },
  { name: 'Slab', sortOrder: 102 },
  { name: 'Walls', sortOrder: 103 },
  { name: 'Steel Structure', sortOrder: 104 },
  { name: 'Roof Structure', sortOrder: 105 },
  { name: 'Roof Covering', sortOrder: 106 },
  { name: 'Cladding', sortOrder: 107 },
  { name: 'Windows & Doors', sortOrder: 108 },
  { name: 'Shopfront / Entrances', sortOrder: 109 },
  { name: 'Loading Bays', sortOrder: 110 },
  { name: 'Partitioning', sortOrder: 111 },
  { name: 'Plastering', sortOrder: 112 },
  { name: 'Ceilings', sortOrder: 113 },
  { name: 'Flooring', sortOrder: 114 },
  { name: 'Plumbing', sortOrder: 115 },
  { name: 'Electrical', sortOrder: 116 },
  { name: 'HVAC', sortOrder: 117 },
  { name: 'Painting', sortOrder: 118 },
  { name: 'External Works', sortOrder: 119 },
  { name: 'Finishing', sortOrder: 120 },
] as const;

const RESIDENTIAL_STAGES = [
  'Land Clearing',
  'Setting out',
  'Trench excavation',
  'Concrete Bases',
  'Back filling and compacting Concrete Slab',
  'Fixing of bases, columns and ground beams',
  'Shuttering of bases columns and beams',
  'Average level',
  'Window level',
  'Shuttering of ring beam',
  'Steel fixing',
  'Wall plate FF',
  'Concrete roof deck 1',
  'Concrete roof deck 2',
  'Roof deck steel fixing 1',
  'Roof deck steel fixing 2',
  'Parapet and wall coping',
  'Plumbing fix and supply',
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

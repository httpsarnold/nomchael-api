export const PROPERTY_TYPES = [
  { value: 'SINGLE_HOME', label: 'Single home' },
  { value: 'CLUSTER', label: 'Cluster' },
  { value: 'TOWNHOUSE', label: 'Townhouse' },
  { value: 'FLAT_APARTMENT', label: 'Flat / apartment' },
  { value: 'WAREHOUSE', label: 'Warehouse' },
  { value: 'COMMERCIAL', label: 'Commercial' },
  { value: 'MIXED_USE', label: 'Mixed use' },
  { value: 'OTHER', label: 'Other' },
] as const;

export type PropertyTypeValue = (typeof PROPERTY_TYPES)[number]['value'];

export type PropertyDetailField =
  | 'unitCount'
  | 'storeys'
  | 'bedrooms'
  | 'bathrooms'
  | 'kitchens'
  | 'lounges'
  | 'otherRooms'
  | 'floorAreaSqm';

export type PropertyDetailProfile = {
  sectionTitle: string;
  hint: string;
  notesPlaceholder: string;
  fields: PropertyDetailField[];
  labels: Partial<Record<PropertyDetailField, string>>;
};

export const PROPERTY_DETAIL_PROFILES: Record<PropertyTypeValue, PropertyDetailProfile> = {
  SINGLE_HOME: {
    sectionTitle: 'Home details',
    hint: 'How many homes, and rooms for each home. The quotation multiplies by the number of homes.',
    notesPlaceholder: 'e.g. double garage, servant quarters, borehole',
    fields: [
      'unitCount',
      'storeys',
      'bedrooms',
      'bathrooms',
      'kitchens',
      'lounges',
      'otherRooms',
      'floorAreaSqm',
    ],
    labels: {
      unitCount: 'How many homes are being built',
      storeys: 'Levels / upstairs',
      bedrooms: 'Bedrooms per home',
      bathrooms: 'Bathrooms per home',
      kitchens: 'Kitchens per home',
      lounges: 'Lounges per home',
      otherRooms: 'Other rooms per home (garage, store…)',
      floorAreaSqm: 'Floor area per home (m²)',
    },
  },
  CLUSTER: {
    sectionTitle: 'Cluster details',
    hint: 'How many units, and rooms for each unit. The quotation multiplies by the number of units.',
    notesPlaceholder: 'e.g. shared driveway, perimeter wall, identical finishes',
    fields: [
      'unitCount',
      'storeys',
      'bedrooms',
      'bathrooms',
      'kitchens',
      'lounges',
      'otherRooms',
      'floorAreaSqm',
    ],
    labels: {
      unitCount: 'Number of units / homes',
      storeys: 'Levels / upstairs per unit',
      bedrooms: 'Bedrooms per unit',
      bathrooms: 'Bathrooms per unit',
      kitchens: 'Kitchens per unit',
      lounges: 'Lounges per unit',
      otherRooms: 'Other rooms per unit',
      floorAreaSqm: 'Floor area per unit (m²)',
    },
  },
  TOWNHOUSE: {
    sectionTitle: 'Townhouse details',
    hint: 'How many townhouses, and rooms for each. The quotation multiplies by this count.',
    notesPlaceholder: 'e.g. end unit, private yard, carport',
    fields: [
      'unitCount',
      'storeys',
      'bedrooms',
      'bathrooms',
      'kitchens',
      'lounges',
      'otherRooms',
      'floorAreaSqm',
    ],
    labels: {
      unitCount: 'How many townhouses are being built',
      storeys: 'Levels / upstairs',
      bedrooms: 'Bedrooms per townhouse',
      bathrooms: 'Bathrooms per townhouse',
      kitchens: 'Kitchens per townhouse',
      lounges: 'Lounges per townhouse',
      otherRooms: 'Other rooms per townhouse',
      floorAreaSqm: 'Floor area per townhouse (m²)',
    },
  },
  FLAT_APARTMENT: {
    sectionTitle: 'Apartment details',
    hint: 'Block size and rooms per flat. The quotation multiplies by the number of flats.',
    notesPlaceholder: 'e.g. 3-storey walk-up, lifts, parking bays',
    fields: [
      'unitCount',
      'storeys',
      'bedrooms',
      'bathrooms',
      'kitchens',
      'lounges',
      'otherRooms',
      'floorAreaSqm',
    ],
    labels: {
      unitCount: 'Number of flats',
      storeys: 'Building storeys (mention upstairs levels)',
      bedrooms: 'Bedrooms per flat',
      bathrooms: 'Bathrooms per flat',
      kitchens: 'Kitchens per flat',
      lounges: 'Lounges per flat',
      otherRooms: 'Other rooms per flat',
      floorAreaSqm: 'Floor area per flat (m²)',
    },
  },
  WAREHOUSE: {
    sectionTitle: 'Warehouse details',
    hint: 'Industrial space, not residential rooms.',
    notesPlaceholder: 'e.g. roller doors, yard, cold room, mezzanine',
    fields: ['floorAreaSqm', 'otherRooms', 'bathrooms', 'kitchens'],
    labels: {
      floorAreaSqm: 'Warehouse floor area (m²)',
      otherRooms: 'Bays / stores / loading doors',
      bathrooms: 'Toilets / ablutions',
      kitchens: 'Tea rooms / staff kitchens',
    },
  },
  COMMERCIAL: {
    sectionTitle: 'Commercial details',
    hint: 'Offices, shops or other commercial space.',
    notesPlaceholder: 'e.g. ground-floor retail, partitioned offices, parking',
    fields: ['floorAreaSqm', 'otherRooms', 'bathrooms', 'kitchens', 'lounges'],
    labels: {
      floorAreaSqm: 'Floor area (m²)',
      otherRooms: 'Offices / shops / units',
      bathrooms: 'Toilets',
      kitchens: 'Pantries / kitchens',
      lounges: 'Reception / waiting areas',
    },
  },
  MIXED_USE: {
    sectionTitle: 'Mixed-use details',
    hint: 'Residential units plus commercial notes.',
    notesPlaceholder: 'e.g. shops downstairs, flats upstairs, shared parking',
    fields: [
      'unitCount',
      'storeys',
      'bedrooms',
      'bathrooms',
      'kitchens',
      'lounges',
      'otherRooms',
      'floorAreaSqm',
    ],
    labels: {
      unitCount: 'Residential units',
      storeys: 'Levels / upstairs',
      bedrooms: 'Bedrooms per unit',
      bathrooms: 'Bathrooms per unit',
      kitchens: 'Kitchens per unit',
      lounges: 'Lounges per unit',
      otherRooms: 'Shops / offices / other spaces',
      floorAreaSqm: 'Total floor area (m²)',
    },
  },
  OTHER: {
    sectionTitle: 'Property details',
    hint: 'Describe the building in notes; add counts that apply.',
    notesPlaceholder: 'Describe the property type and what is being built',
    fields: ['floorAreaSqm', 'otherRooms', 'bathrooms', 'kitchens'],
    labels: {
      floorAreaSqm: 'Floor area (m²)',
      otherRooms: 'Spaces / rooms',
      bathrooms: 'Bathrooms / toilets',
      kitchens: 'Kitchens',
    },
  },
};

export type PropertyFormValues = {
  propertyType: string;
  unitCount: string;
  storeys: string;
  bedrooms: string;
  bathrooms: string;
  kitchens: string;
  lounges: string;
  otherRooms: string;
  floorAreaSqm: string;
  propertyNotes: string;
};

const ALL_COUNT_FIELDS: PropertyDetailField[] = [
  'unitCount',
  'storeys',
  'bedrooms',
  'bathrooms',
  'kitchens',
  'lounges',
  'otherRooms',
  'floorAreaSqm',
];

/** Human label for storeys / upstairs (shown on quotes and search). */
export function storeysLabel(storeys?: number | null) {
  const n = Math.max(1, Number(storeys) || 1);
  if (n <= 1) return 'Ground floor only (no upstairs)';
  if (n === 2) return 'Has upstairs (double storey)';
  return `${n} storeys (has upstairs)`;
}

export function getPropertyProfile(type: string): PropertyDetailProfile {
  return (
    PROPERTY_DETAIL_PROFILES[type as PropertyTypeValue] || PROPERTY_DETAIL_PROFILES.OTHER
  );
}

/** Zero out fields that do not apply to the selected property type. */
export function propertyPayloadFromForm(form: PropertyFormValues) {
  const profile = getPropertyProfile(form.propertyType);
  const active = new Set(profile.fields);

  const num = (key: PropertyDetailField, fallback = 0) => {
    if (!active.has(key)) return fallback;
    const raw = form[key];
    if (raw === '' || raw == null) return key === 'floorAreaSqm' ? undefined : fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  };

  return {
    propertyType: form.propertyType,
    unitCount: active.has('unitCount') ? Math.max(1, Number(form.unitCount) || 1) : 1,
    storeys: active.has('storeys') ? Math.max(1, Number(form.storeys) || 1) : 1,
    bedrooms: num('bedrooms', 0) as number,
    bathrooms: num('bathrooms', 0) as number,
    kitchens: num('kitchens', 0) as number,
    lounges: num('lounges', 0) as number,
    otherRooms: num('otherRooms', 0) as number,
    floorAreaSqm: num('floorAreaSqm') as number | undefined,
    propertyNotes: form.propertyNotes || undefined,
  };
}

export function defaultsForPropertyType(type: string): Partial<PropertyFormValues> {
  switch (type) {
    case 'SINGLE_HOME':
    case 'TOWNHOUSE':
      return {
        unitCount: '1',
        storeys: '1',
        bedrooms: '3',
        bathrooms: '2',
        kitchens: '1',
        lounges: '1',
        otherRooms: '0',
        floorAreaSqm: '',
      };
    case 'CLUSTER':
    case 'FLAT_APARTMENT':
      return {
        unitCount: '4',
        storeys: '1',
        bedrooms: '2',
        bathrooms: '1',
        kitchens: '1',
        lounges: '1',
        otherRooms: '0',
        floorAreaSqm: '',
      };
    case 'MIXED_USE':
      return {
        unitCount: '2',
        storeys: '2',
        bedrooms: '2',
        bathrooms: '1',
        kitchens: '1',
        lounges: '1',
        otherRooms: '1',
        floorAreaSqm: '',
      };
    case 'WAREHOUSE':
      return {
        unitCount: '1',
        storeys: '1',
        bedrooms: '0',
        bathrooms: '2',
        kitchens: '1',
        lounges: '0',
        otherRooms: '4',
        floorAreaSqm: '',
      };
    case 'COMMERCIAL':
      return {
        unitCount: '1',
        storeys: '1',
        bedrooms: '0',
        bathrooms: '2',
        kitchens: '1',
        lounges: '1',
        otherRooms: '4',
        floorAreaSqm: '',
      };
    default:
      return {
        unitCount: '1',
        storeys: '1',
        bedrooms: '0',
        bathrooms: '0',
        kitchens: '0',
        lounges: '0',
        otherRooms: '0',
        floorAreaSqm: '',
      };
  }
}

export { ALL_COUNT_FIELDS };

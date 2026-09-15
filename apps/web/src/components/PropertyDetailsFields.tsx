'use client';

import {
  getPropertyProfile,
  type PropertyDetailField,
  type PropertyFormValues,
} from '@/lib/propertyDetails';

type Props = {
  form: PropertyFormValues;
  onChange: (patch: Partial<PropertyFormValues>) => void;
  showNotes?: boolean;
};

const FIELD_ORDER: PropertyDetailField[] = [
  'unitCount',
  'storeys',
  'bedrooms',
  'bathrooms',
  'kitchens',
  'lounges',
  'otherRooms',
  'floorAreaSqm',
];

const DEFAULT_LABELS: Record<PropertyDetailField, string> = {
  unitCount: 'Number of units',
  storeys: 'Levels / upstairs',
  bedrooms: 'Bedrooms',
  bathrooms: 'Bathrooms',
  kitchens: 'Kitchens',
  lounges: 'Lounges',
  otherRooms: 'Other rooms',
  floorAreaSqm: 'Floor area (m²)',
};

const STOREY_OPTIONS = [
  { value: '1', label: 'Ground floor only (no upstairs)' },
  { value: '2', label: 'Has upstairs (double storey)' },
  { value: '3', label: '3 storeys (has upstairs)' },
  { value: '4', label: '4 storeys (has upstairs)' },
];

export function PropertyDetailsFields({ form, onChange, showNotes = true }: Props) {
  const profile = getPropertyProfile(form.propertyType);
  const fields = FIELD_ORDER.filter((f) => profile.fields.includes(f));

  return (
    <div className="property-details">
      <div className="section-kicker" style={{ marginTop: 0 }}>
        {profile.sectionTitle}
      </div>
      <p className="muted" style={{ marginTop: 0, marginBottom: '0.75rem' }}>
        {profile.hint}
      </p>
      <div className="grid grid-2">
        {fields.map((field) =>
          field === 'storeys' ? (
            <label key={field}>
              {profile.labels[field] || DEFAULT_LABELS[field]}
              <select
                required
                value={form.storeys || '1'}
                onChange={(e) => onChange({ storeys: e.target.value })}
              >
                {STOREY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label key={field}>
              {profile.labels[field] || DEFAULT_LABELS[field]}
              <input
                type="number"
                min={field === 'unitCount' ? 1 : 0}
                step={field === 'floorAreaSqm' ? '0.1' : '1'}
                value={form[field]}
                onChange={(e) => onChange({ [field]: e.target.value })}
                required={
                  field === 'unitCount' ||
                  (field === 'floorAreaSqm' && form.propertyType === 'WAREHOUSE')
                }
              />
            </label>
          ),
        )}
      </div>
      {showNotes && (
        <label style={{ marginTop: '0.75rem', display: 'block' }}>
          Property notes
          <textarea
            value={form.propertyNotes}
            onChange={(e) => onChange({ propertyNotes: e.target.value })}
            placeholder={profile.notesPlaceholder}
          />
        </label>
      )}
    </div>
  );
}

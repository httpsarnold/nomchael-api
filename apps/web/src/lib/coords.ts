export type GeoHit = {
  label: string;
  locationLat: number;
  locationLng: number;
};

/** Accepts "lat, lng" or "lat lng" paste from Google Maps / OSM. */
export function parseCoordsPaste(value: string): { lat: number; lng: number } | null {
  const cleaned = value.trim().replace(/^\(/, '').replace(/\)$/, '');
  const parts = cleaned.split(/[,;\s]+/).filter(Boolean);
  if (parts.length < 2) return null;
  const lat = Number(parts[0]);
  const lng = Number(parts[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

/**
 * Normalize phones for WhatsApp / storage (digits only, with country code, no +).
 * Zimbabwe (263) is the default for ambiguous local numbers.
 * UK (44) is detected from +44, 0044, or 11-digit 07… mobiles.
 */
export function normalizePhoneDigits(
  input: string | null | undefined,
  defaultCountry: 'ZW' | 'UK' | 'AUTO' = 'AUTO',
): string {
  if (!input) return '';
  let raw = String(input).trim();
  if (!raw) return '';

  // Keep leading + for a moment, strip other junk
  raw = raw.replace(/[^\d+]/g, '');
  if (raw.startsWith('00')) raw = raw.slice(2);
  if (raw.startsWith('+')) raw = raw.slice(1);
  raw = raw.replace(/\D/g, '');

  if (!raw) return '';

  // Already international
  if (raw.startsWith('44') && raw.length >= 11 && raw.length <= 13) return raw;
  if (raw.startsWith('263') && raw.length >= 12 && raw.length <= 13) return raw;

  // Local formats
  if (raw.startsWith('0')) {
    const national = raw.slice(1);
    // UK mobiles: 07xxx xxxxxx → 11 digits with leading 0
    if (raw.length === 11 && raw.startsWith('07')) {
      return `44${national}`;
    }
    // Zimbabwe mobiles: 07xx xxx xxx → 10 digits with leading 0
    if (raw.length === 10 && raw.startsWith('07')) {
      return `263${national}`;
    }
    // Explicit default when length is ambiguous
    if (defaultCountry === 'UK') return `44${national}`;
    if (defaultCountry === 'ZW') return `263${national}`;
    // AUTO: prefer ZW for Nomchael (Zimbabwe company), unless looks like UK length
    if (raw.length >= 11) return `44${national}`;
    return `263${national}`;
  }

  // Bare national without 0 (e.g. 7588830800 UK or 771234567 ZW)
  if (raw.length === 10 && raw.startsWith('7')) {
    // Could be UK mobile without leading 0
    if (defaultCountry === 'ZW') return `263${raw}`;
    return `44${raw}`;
  }
  if (raw.length === 9 && raw.startsWith('7')) {
    return `263${raw}`;
  }

  return raw;
}

export function formatPhoneDisplay(digits: string): string {
  const d = normalizePhoneDigits(digits);
  if (!d) return '';
  if (d.startsWith('44')) return `+${d}`;
  if (d.startsWith('263')) return `+${d}`;
  return `+${d}`;
}

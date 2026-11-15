// Lengths are stored in the job as millimetres (plain numbers). The engine
// works in whole micrometres ("u") so every sum and comparison is exact.

export const U_PER_MM = 1000;
export const MM_PER_IN = 25.4;

export const toU = (mm) => Math.round(mm * U_PER_MM);
export const toMm = (u) => u / U_PER_MM;

/**
 * Parse what a person typed into a length field.
 * Accepts decimals ("596.5", "596,5"), fractions ("3/4", "23 1/2", "23-1/2"),
 * and an optional unit suffix (mm, cm, in, ") that overrides the job unit.
 * Returns millimetres, null for an empty field, or NaN if it can't be read.
 */
export function parseLength(text, units = 'mm') {
  if (text == null) return null;
  let s = String(text).trim().toLowerCase();
  if (s === '') return null;

  let unit = units;
  const suffix = s.match(/(mm|cm|inches|inch|in|"|”|″)\s*$/);
  if (suffix) {
    unit = suffix[1] === 'mm' ? 'mm' : suffix[1] === 'cm' ? 'cm' : 'in';
    s = s.slice(0, suffix.index).trim();
  }
  if (s === '') return NaN;

  let value;
  const frac = s.match(/^(?:(\d+(?:[.,]\d+)?)[\s-]+)?(\d+)\s*\/\s*(\d+)$/);
  if (frac) {
    const whole = frac[1] ? Number(frac[1].replace(',', '.')) : 0;
    const den = Number(frac[3]);
    if (den === 0) return NaN;
    value = whole + Number(frac[2]) / den;
  } else if (/^\d*[.,]?\d+$/.test(s) || /^\d+[.,]$/.test(s)) {
    value = Number(s.replace(',', '.'));
  } else {
    return NaN;
  }
  if (!Number.isFinite(value)) return NaN;
  if (unit === 'in') return value * MM_PER_IN;
  if (unit === 'cm') return value * 10;
  return value;
}

function trimZeros(str) {
  return str.includes('.') ? str.replace(/\.?0+$/, '') : str;
}

function gcd(a, b) {
  while (b) [a, b] = [b, a % b];
  return a;
}

/** Format millimetres for display in the given unit (no unit suffix). */
export function formatLength(mm, units = 'mm') {
  if (mm == null || !Number.isFinite(mm)) return '';
  if (units === 'in') {
    const inches = mm / MM_PER_IN;
    const n = Math.round(inches * 64);
    if (Math.abs(inches - n / 64) < 0.0004) {
      const whole = Math.floor(n / 64);
      const rem = n - whole * 64;
      if (rem === 0) return String(whole);
      const g = gcd(rem, 64);
      const f = `${rem / g}/${64 / g}`;
      return whole ? `${whole} ${f}` : f;
    }
    return trimZeros(inches.toFixed(3));
  }
  return trimZeros(mm.toFixed(2));
}

/** Format an engine length (micrometres). */
export const formatU = (u, units = 'mm') => formatLength(u / U_PER_MM, units);

export const unitSuffix = (units) => (units === 'in' ? '″' : ' mm');

/** Format an engine area (square micrometres) as m² or ft². */
export function formatArea(u2, units = 'mm') {
  const m2 = u2 / 1e12;
  if (units === 'in') return `${(m2 * 10.7639104).toFixed(1)} ft²`;
  return `${m2.toFixed(2)} m²`;
}

/** Format a running length (micrometres) as m or ft. */
export function formatRun(u, units = 'mm') {
  const m = u / 1e6;
  if (units === 'in') return `${(m * 3.2808399).toFixed(1)} ft`;
  return `${m.toFixed(1)} m`;
}

// Small color toolkit: parsing, HSL conversion, mixing, WCAG contrast.

export function parseColor(input) {
  if (!input) return null;
  const s = String(input).trim().toLowerCase();
  let m = s.match(/^#([0-9a-f]{3})$/);
  if (m) return [...m[1]].map((c) => parseInt(c + c, 16));
  m = s.match(/^#([0-9a-f]{6})/);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  m = s.match(/^rgba?\(([^)]+)\)/);
  if (m) {
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(parseFloat);
    if (p.length >= 4 && p[3] === 0) return null; // fully transparent
    return p.slice(0, 3).map((v) => Math.round(v));
  }
  return null;
}

export const toHex = (rgb) => '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase();

export function normalizeHex(input) {
  const rgb = parseColor(input);
  return rgb ? toHex(rgb) : null;
}

export function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, s, l];
}

export function hslToRgb([h, s, l]) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

export const hslHex = (h, s, l) => toHex(hslToRgb([h, s, l]));
export const hexToHsl = (hex) => rgbToHsl(parseColor(hex));

export function mix(hexA, hexB, t) {
  const a = parseColor(hexA), b = parseColor(hexB);
  return toHex(a.map((v, i) => v + (b[i] - v) * t));
}

export function luminance(hex) {
  const [r, g, b] = parseColor(hex).map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

// Readable text color (black-ish or white) for a given background.
export const readableOn = (bg, dark = '#111111', light = '#FFFFFF') => (contrast(bg, light) >= contrast(bg, dark) ? light : dark);

// Nudge a color's lightness until it reaches `min` contrast against `bg`.
export function ensureContrast(fg, bg, min = 4.5) {
  if (contrast(fg, bg) >= min) return fg;
  const [h, s, l] = hexToHsl(fg);
  const darker = luminance(bg) > 0.5;
  for (let i = 1; i <= 40; i++) {
    const next = hslHex(h, s, Math.max(0, Math.min(1, l + (darker ? -i : i) * 0.02)));
    if (contrast(next, bg) >= min) return next;
  }
  return darker ? '#000000' : '#FFFFFF';
}

export const isNeutral = (hex, tol = 0.12) => hexToHsl(hex)[1] < tol;
export const hueDistance = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

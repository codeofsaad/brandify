// Brand-aware chart palettes, built in OKLCH (perceptually uniform: equal L and C look equally light and equally vivid).
//
// Principles (Datawrapper data-vis guidance; Ottosson's OKLab):
//  - Categorical: <= 7 colors plus one grey, each its own hue, with lightness varied so they stay apart for colorblind readers.
//  - Companion hues come from a harmony rule anchored on the brand's own hue (analogous neighbours plus a warm/cool
//    complement), never from an even sweep of the colour wheel, so a blue brand does not get pink or neon green.
//  - Chroma of the companions follows the brand's own vividness, capped low enough to look professional.
//  - Sequential: built mainly on lightness (works in greyscale), one hue.  Diverging: two hues through a light neutral.

// ---------- OKLab / OKLCH ----------

const toLinear = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const fromLinear = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);

export function hexToOklab(hex) {
  const [r, g, b] = hexToRgb(hex).map(toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToLinearRgb([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const inGamut = (rgb) => rgb.every((v) => v >= -0.0005 && v <= 1.0005);
const toHex = (rgb) =>
  '#' + rgb.map((v) => Math.round(Math.min(1, Math.max(0, fromLinear(Math.min(1, Math.max(0, v))))) * 255).toString(16).padStart(2, '0')).join('').toUpperCase();

export function hexToOklch(hex) {
  const [L, a, b] = hexToOklab(hex);
  return { L, C: Math.hypot(a, b), h: ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360 };
}

// OKLCH -> hex. If the colour is outside sRGB, reduce chroma until it fits (keeps lightness and hue).
export function oklchToHex(L, C, h) {
  const hr = (h * Math.PI) / 180;
  let c = C;
  for (let i = 0; i < 24; i++) {
    const rgb = oklabToLinearRgb([L, c * Math.cos(hr), c * Math.sin(hr)]);
    if (inGamut(rgb)) return toHex(rgb);
    c *= 0.93;
  }
  return toHex(oklabToLinearRgb([L, 0, 0]));
}

const oklabHex = ([L, a, b]) => {
  const C = Math.hypot(a, b);
  const h = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
  return oklchToHex(L, C, h);
};

export const deltaE = (hexA, hexB) => {
  const a = hexToOklab(hexA);
  const b = hexToOklab(hexB);
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
};

// Deuteranopia simulation (Machado et al. 2009, full severity) so we can check colours stay apart for colorblind readers.
function simulateDeuteranopia(hex) {
  const [r, g, b] = hexToRgb(hex).map(toLinear);
  return toHex([
    0.367322 * r + 0.860646 * g - 0.227968 * b,
    0.280085 * r + 0.672501 * g + 0.047413 * b,
    -0.01182 * r + 0.04294 * g + 0.968881 * b,
  ]);
}

const hueGap = (a, b) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};
const norm = (h) => ((h % 360) + 360) % 360;
// Reds-to-magentas that read as pink: only allowed when the brand itself lives near them.
const inPinkBand = (h) => norm(h) >= 315 || norm(h) <= 30;
const isChromatic = ({ L, C }) => C >= 0.045 && L > 0.2 && L < 0.92;

// ---------- categorical ----------

// Companion hues relative to the anchor: [hue offset, target lightness]. Order = preference.
const COMPANIONS = [
  [180, 0.72], // warm/cool complement
  [-38, 0.64], // analogous neighbour
  [38, 0.58], // analogous neighbour on the other side
  [215, 0.77], // second complement-side hue
  [-75, 0.6],
  [75, 0.68],
  [145, 0.7],
  [-115, 0.66],
  [110, 0.64],
];

/**
 * @param {object} p
 * @param {string[]} p.brand       chromatic brand colours in priority order (hex)
 * @param {{hex:string, weight:number}[]} p.harvest  colours measured on the company's site (UI colours, not photos)
 * @param {string[]} p.neutrals    neutral brand colours (used only for the grey slot tint)
 * @returns {{ categorical: {hex:string, source:string}[], anchor: object }}
 */
export function buildCategorical({ brand = [], harvest = [], neutrals = [] }) {
  const chromatic = brand.map((hex) => ({ hex, ...hexToOklch(hex) })).filter(isChromatic);
  const anchor = chromatic[0] || { hex: null, L: 0.62, C: 0.07, h: 250 }; // steel blue when the brand has no colour
  const brandC = chromatic.length ? chromatic.reduce((s, c) => s + c.C, 0) / chromatic.length : 0.07;
  const C_t = Math.min(0.13, Math.max(0.06, brandC * 0.78)); // companions: follow the brand's vividness, never neon
  const pinkAllowed = chromatic.some((c) => hueGap(c.h, 345) <= 60);

  const out = [];
  let minGap = 0.1; // how far apart two categorical colours must be (OKLab distance); relaxed for very muted brands
  const add = (hex, source) => {
    if (out.length >= 7) return false;
    if (out.some((o) => deltaE(o.hex, hex) < minGap)) return false;
    out.push({ hex, source });
    return true;
  };

  // 1) the brand's own colours, exactly as given (a brand with no colour of its own gets a calm steel-blue lead)
  chromatic.slice(0, 2).forEach((c) => add(c.hex, 'brand'));
  if (!chromatic.length) add(oklchToHex(0.56, C_t, anchor.h), 'derived');

  // 2) colours the company actually uses in its interface, if they sit in a harmonious place relative to the anchor
  const usable = harvest
    .map((x) => ({ ...x, ...hexToOklch(x.hex) }))
    .filter((x) => isChromatic(x) && x.L > 0.3 && x.L < 0.86)
    .filter((x) => hueGap(x.h, anchor.h) <= 60 || hueGap(x.h, anchor.h + 180) <= 35 || x.weight >= 0.08)
    .filter((x) => pinkAllowed || !inPinkBand(x.h) || x.weight >= 0.15)
    .sort((a, b) => b.weight - a.weight);
  for (const x of usable) {
    if (out.length >= 4) break;
    add(x.hex, 'site');
  }

  // 3) harmony-derived companions fill the rest
  const tryCompanion = (off, L) => {
    let h = norm(anchor.h + off);
    if (inPinkBand(h) && !pinkAllowed) return false;
    const greenBoost = h > 100 && h < 165 ? 0.85 : 1; // greens look neon fastest
    const warmCap = h < 62 || h >= 315 ? 0.68 : 0.76; // light warm hues read as salmon/pink; keep them amber/terracotta
    for (const dL of [0, 0.06, -0.06, 0.1, -0.1]) {
      const hex = oklchToHex(Math.min(warmCap, Math.max(0.5, L + dL)), C_t * greenBoost, h);
      if (add(hex, 'derived')) return true;
    }
    return false;
  };
  for (const [off, L] of COMPANIONS) {
    if (out.length >= 7) break;
    tryCompanion(off, L);
  }
  // a very muted brand can run out of distinct colours: allow slightly closer ones rather than a tiny palette
  if (out.length < 6) {
    minGap = 0.07;
    for (const [off, L] of COMPANIONS) {
      if (out.length >= 7) break;
      tryCompanion(off, L);
    }
  }
  // still short (very close-hued brand): fall back to lightness steps of the anchor hue
  for (let L = 0.52; out.length < 7 && L < 0.82; L += 0.06) add(oklchToHex(L, C_t, anchor.h), 'derived');

  // 4) colourblind safety: separate any pair that collapses under deuteranopia by nudging lightness
  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    for (let i = 1; i < out.length; i++) {
      for (let j = 0; j < i; j++) {
        if (out[i].source === 'brand') continue;
        if (deltaE(simulateDeuteranopia(out[i].hex), simulateDeuteranopia(out[j].hex)) < 0.045) {
          const o = hexToOklch(out[i].hex);
          const L = Math.min(0.8, Math.max(0.5, o.L + (i % 2 ? 0.07 : -0.07)));
          out[i] = { hex: oklchToHex(L, o.C, o.h), source: out[i].source };
          changed = true;
        }
      }
    }
    if (!changed) break;
  }

  // 5) a neutral for "other" / context, faintly tinted with the brand hue
  const neutralHex = oklchToHex(0.66, 0.018, anchor.h);
  out.push({ hex: neutralHex, source: 'neutral' });
  return { categorical: out, anchor, C_t, pinkAllowed };
}

// ---------- sequential & diverging ----------

export function buildSequential(anchor, C_t) {
  const Cs = Math.min(0.16, Math.max(0.06, anchor.C || C_t));
  const L = [0.96, 0.89, 0.81, 0.71, 0.61, 0.5, 0.38]; // lightness does the work, so it still reads in greyscale
  const bell = [0.12, 0.38, 0.68, 0.92, 1, 0.9, 0.7];
  return L.map((l, i) => oklchToHex(l, Cs * bell[i], anchor.h));
}

export function buildDiverging(anchor, C_t, { accent = null, pinkAllowed = false } = {}) {
  const left = { h: anchor.h, L: 0.44, C: Math.min(0.16, C_t * 1.3) };
  let hR = norm(anchor.h + 180);
  const acc = accent ? hexToOklch(accent) : null;
  if (acc && isChromatic(acc) && hueGap(acc.h, anchor.h) >= 80 && (pinkAllowed || !inPinkBand(acc.h))) hR = acc.h;
  else if (inPinkBand(hR) && !pinkAllowed) hR = 60; // amber
  const right = { h: hR, L: 0.5, C: Math.min(0.16, C_t * 1.3) };
  const mid = [0.95, 0, 0]; // light grey midpoint, not white
  const ab = ({ L, C, h }) => [L, C * Math.cos((h * Math.PI) / 180), C * Math.sin((h * Math.PI) / 180)];
  const lerp = (p, q, t) => p.map((v, i) => v + (q[i] - v) * t);
  const [A, B] = [ab(left), ab(right)];
  const steps = [0, 0.34, 0.67];
  return [
    ...steps.map((t) => oklabHex(lerp(A, mid, t))), // strong -> light
    oklabHex(mid),
    ...[...steps].reverse().map((t) => oklabHex(lerp(B, mid, t))), // light -> strong
  ];
}

export function generatePalettes({ brand, harvest, neutrals, accent }) {
  const { categorical, anchor, C_t, pinkAllowed } = buildCategorical({ brand, harvest, neutrals });
  return {
    categorical: categorical.map((c) => c.hex),
    sources: categorical.map((c) => c.source),
    sequential: buildSequential(anchor, C_t),
    diverging: buildDiverging(anchor, C_t, { accent, pinkAllowed }),
  };
}

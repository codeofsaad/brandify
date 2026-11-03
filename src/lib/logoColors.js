// When Simple Icons has no official colour for the brand, the logo itself is the next best statement of the brand's colour.
// The logo is rendered in the browser and its colours read the same way as a screenshot's (area-weighted, anti-aliasing removed).
import { fetchLogoAsset } from './logo.js';
import { analyzeShots } from './screenshot.js';
import { toHex } from './color.js';
import { hexToOklch } from './palette.js';

const loadImage = (src) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error('logo could not be drawn'));
  img.src = src;
});

// Draw the logo large enough to read, on a transparent canvas (transparent pixels are ignored by the analysis).
async function toPngDataUrl(asset) {
  const src = asset.kind === 'svg' ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(asset.svg)}` : asset.dataUri;
  const img = await loadImage(src);
  const w = img.naturalWidth || 400;
  const h = img.naturalHeight || 200;
  const scale = 400 / Math.max(w, 1);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * scale));
  c.height = Math.max(1, Math.round(h * scale));
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/png');
}

// Wordmarks and symbols first; dark-theme files keep their real colours (light-theme files are usually all white).
const rank = (l) => (l.kind === 'logo' ? 0 : l.kind === 'symbol' ? 1 : 2) * 2 + (l.theme === 'dark' ? 0 : 1);

// The main ink colour of a logo, grey or not: the biggest colour that isn't the background (transparent, or a plain
// white/near-white square like an app icon). Used when a logo has no vivid colour but is still the brand's own colour.
async function inkOf(dataUrl) {
  const img = await loadImage(dataUrl);
  const c = document.createElement('canvas');
  c.width = Math.min(200, img.naturalWidth || 200);
  c.height = Math.max(1, Math.round(c.width * ((img.naturalHeight || 1) / (img.naturalWidth || 1))));
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  const bins = new Map();
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 200) continue;
    const { L } = hexToOklch(toHex([d[i], d[i + 1], d[i + 2]]));
    if (L > 0.9) continue; // white or near-white is the background, not the brand
    const k = ((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4);
    const b = bins.get(k) || { n: 0, r: 0, g: 0, b: 0 };
    b.n++; b.r += d[i]; b.g += d[i + 1]; b.b += d[i + 2];
    bins.set(k, b);
  }
  // Anti-aliasing and soft edges create many faint in-between colours, so ignore bins that hold almost nothing.
  const total = [...bins.values()].reduce((t, b) => t + b.n, 0);
  const best = [...bins.values()].sort((x, y) => y.n - x.n)[0];
  if (!best || best.n < Math.max(20, total * 0.04)) return null;
  const hex = toHex([best.r / best.n, best.g / best.n, best.b / best.n]);
  return hexToOklch(hex).L < 0.85 ? hex : null;
}

/**
 * Reads the page's logo for the brand's colours.
 * @returns {Promise<{colors: string[], ink: string|null}>} vivid colours (most prominent first) if the logo has any; otherwise
 *   its main ink colour, even if grey, so a grey-and-white brand still gets a primary that really comes from its logo.
 */
export async function readLogo(logos = []) {
  const pool = logos.some((l) => l.kind === 'logo') ? logos.filter((l) => l.kind === 'logo') : logos;
  let ink = null;
  for (const logo of [...pool].sort((a, b) => rank(a) - rank(b)).slice(0, 4)) {
    try {
      const asset = await fetchLogoAsset(logo);
      if (asset.failed) continue;
      const png = await toPngDataUrl(asset);
      const a = await analyzeShots([{ dataUrl: png }]);
      if (a.series.length) return { colors: a.series.slice(0, 3), ink: null };
      ink ||= await inkOf(png).catch(() => null);
    } catch {
      /* try the next logo */
    }
  }
  return { colors: [], ink };
}

/**
 * @param {{kind:string, theme:string, url:string, pngUrl?:string}[]} logos
 * @returns {Promise<string[]>} up to 3 vivid brand colours (hex), most prominent first; [] if the logo is black/white/grey
 */
export async function colorsFromLogos(logos = []) {
  return (await readLogo(logos)).colors;
}

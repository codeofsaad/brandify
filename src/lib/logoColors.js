// When Simple Icons has no official colour for the brand, the logo itself is the next best statement of the brand's colour.
// The logo is rendered in the browser and its colours read the same way as a screenshot's (area-weighted, anti-aliasing removed).
import { fetchLogoAsset } from './logo.js';
import { analyzeShots } from './screenshot.js';

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

/**
 * @param {{kind:string, theme:string, url:string, pngUrl?:string}[]} logos
 * @returns {Promise<string[]>} up to 3 brand colours (hex), most prominent first; [] if the logo is black/white/grey
 */
export async function colorsFromLogos(logos = []) {
  // The logo on the page is the brand's statement; small site icons (favicons, app icons) only if there is nothing else.
  const pool = logos.some((l) => l.kind === 'logo') ? logos.filter((l) => l.kind === 'logo') : logos;
  for (const logo of [...pool].sort((a, b) => rank(a) - rank(b)).slice(0, 4)) {
    try {
      const asset = await fetchLogoAsset(logo);
      if (asset.failed) continue;
      const a = await analyzeShots([{ dataUrl: await toPngDataUrl(asset) }]);
      if (a.series.length) return a.series.slice(0, 3);
    } catch {
      /* try the next logo */
    }
  }
  return [];
}

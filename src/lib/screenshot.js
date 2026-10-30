// Reads a customer screenshot (an existing dashboard, a slide) entirely in the browser: nothing is uploaded or stored.
// Returns the real colours it uses, whether it is a light or dark design, and the background/surface/text colours.
import { rgbToOklab, deltaE, hexToOklch } from './palette.js';

const MAX_FILES = 4;
const MAX_BYTES = 12 * 1024 * 1024;
export const LIMITS = { MAX_FILES, MAX_BYTES };

const toHex = (r, g, b) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();
const lum = (r, g, b) => {
  const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrast = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('That file could not be read as an image.'));
    img.src = src;
  });
}

// File or Blob -> { id, name, dataUrl (resized, for display and the eyedropper), width, height }
export async function readImageFile(file) {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('Use a PNG, JPG or WebP screenshot.');
  if (file.size > MAX_BYTES) throw new Error('That screenshot is over 12 MB. Try a smaller capture.');
  const raw = await new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = () => rej(new Error('Could not read that file.'));
    fr.readAsDataURL(file);
  });
  const img = await loadImage(raw);
  const scale = Math.min(1, 1600 / img.naturalWidth);
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d').drawImage(img, 0, 0, w, h);
  return { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name: file.name || 'pasted-screenshot.png', dataUrl: c.toDataURL('image/png'), width: w, height: h };
}

// Average a small patch around a point (fractions 0..1 of the image) so a click lands on the real colour, not antialiasing.
export async function sampleColor(dataUrl, fx, fy) {
  const img = await loadImage(dataUrl);
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const x = Math.min(c.width - 1, Math.max(0, Math.round(fx * c.width)));
  const y = Math.min(c.height - 1, Math.max(0, Math.round(fy * c.height)));
  const r = 1;
  const d = ctx.getImageData(Math.max(0, x - r), Math.max(0, y - r), Math.min(c.width - x + r, 2 * r + 1), Math.min(c.height - y + r, 2 * r + 1)).data;
  let R = 0, G = 0, B = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) { R += d[i]; G += d[i + 1]; B += d[i + 2]; n++; }
  return toHex(R / n, G / n, B / n);
}

// Reads one screenshot: histogram of 5-bit colour bins, merged where colours look alike (OKLab).
async function analyzeOne(shot) {
  const img = await loadImage(shot.dataUrl);
  const scale = Math.min(1, 360 / img.naturalWidth);
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;

  const bins = new Map();
  const edgeBins = new Map(); // the page margins (left, right, bottom) show the true page background
  const mx = Math.max(2, Math.round(w * 0.03)), my = Math.max(2, Math.round(h * 0.04));
  let total = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (d[i + 3] < 200) continue;
      const k = ((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3);
      bins.set(k, (bins.get(k) || 0) + 1);
      total++;
      if (x < mx || x >= w - mx || y >= h - my) edgeBins.set(k, (edgeBins.get(k) || 0) + 1);
    }
  }
  if (!total) throw new Error('The screenshot looks empty.');

  const clusters = [];
  for (const [k, n] of [...bins.entries()].sort((a, b) => b[1] - a[1])) {
    const r = ((k >> 10) & 31) * 8 + 4, g = ((k >> 5) & 31) * 8 + 4, b = (k & 31) * 8 + 4;
    const lab = rgbToOklab(r, g, b);
    let best = null, bestD = 0.04;
    for (const cl of clusters) {
      const dd = Math.hypot(cl.lab[0] - lab[0], cl.lab[1] - lab[1], cl.lab[2] - lab[2]);
      if (dd < bestD) { best = cl; bestD = dd; }
    }
    if (best) {
      const t = best.n + n;
      best.rgb = best.rgb.map((v, i) => (v * best.n + [r, g, b][i] * n) / t);
      best.lab = best.lab.map((v, i) => (v * best.n + lab[i] * n) / t);
      best.n = t;
    } else if (clusters.length < 40) clusters.push({ rgb: [r, g, b], lab, n });
  }
  for (const cl of clusters) {
    cl.share = cl.n / total;
    cl.hex = toHex(...cl.rgb);
    cl.L = cl.lab[0];
    cl.C = Math.hypot(cl.lab[1], cl.lab[2]);
    cl.lum = lum(...cl.rgb);
  }
  clusters.sort((a, b) => b.n - a.n);

  // background = the most common colour along the margins (falls back to the largest area)
  const topEdge = [...edgeBins.entries()].sort((a, b) => b[1] - a[1])[0];
  let bg = clusters[0];
  if (topEdge) {
    const k = topEdge[0];
    const lab = rgbToOklab(((k >> 10) & 31) * 8 + 4, ((k >> 5) & 31) * 8 + 4, (k & 31) * 8 + 4);
    const near = clusters.map((cl) => ({ cl, dd: Math.hypot(cl.lab[0] - lab[0], cl.lab[1] - lab[1], cl.lab[2] - lab[2]) })).sort((a, b) => a.dd - b.dd)[0];
    if (near && near.dd < 0.06) bg = near.cl;
  }
  const dark = bg.L < 0.45;

  // surface = the biggest flat panel colour close to the background (cards, tiles)
  const surfaceC = clusters.filter((c) => c !== bg && c.share >= 0.02 && c.C < 0.06 && deltaE(c.hex, bg.hex) > 0.012 && deltaE(c.hex, bg.hex) < 0.18).sort((a, b) => b.n - a.n)[0];
  const surfaceLum = surfaceC?.lum ?? bg.lum;
  // text = the most common neutral that clearly contrasts with both the background and the panels
  const textC = clusters
    .filter((c) => c.C < 0.05 && contrast(c.lum, bg.lum) >= 4.5 && contrast(c.lum, surfaceLum) >= 4.5 && c.share >= 0.002)
    .sort((a, b) => b.n - a.n)[0];

  // brand-ish colours: saturated, mid-light, not tiny; ranked by area x vividness, near-duplicates dropped
  // Where two colours meet (a bar's edge on its background), anti-aliasing creates in-between pixels that look like extra
  // colours. A candidate that sits on the line between two bigger colours is treated as such a blend and dropped.
  const distToSegment = (p, a, b) => {
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
    const len2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2 || 1;
    const t = Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / len2));
    return Math.hypot(p[0] - (a[0] + ab[0] * t), p[1] - (a[1] + ab[1] * t), p[2] - (a[2] + ab[2] * t));
  };
  const isBlend = (c) => {
    const bigger = clusters.filter((o) => o !== c && o.n > c.n);
    for (let i = 0; i < bigger.length; i++)
      for (let j = i + 1; j < bigger.length; j++)
        if (Math.hypot(...bigger[i].lab.map((v, k) => v - bigger[j].lab[k])) > 0.08 && distToSegment(c.lab, bigger[i].lab, bigger[j].lab) < 0.035) return true;
    return false;
  };
  const chroma = clusters
    .filter((c) => c.C >= 0.06 && c.L > 0.2 && c.L < 0.93 && c.share >= 0.002 && !isBlend(c))
    .sort((a, b) => b.share ** 0.7 * b.C - a.share ** 0.7 * a.C);
  const series = [];
  for (const c of chroma) if (series.length < 8 && series.every((s) => deltaE(s, c.hex) > 0.07)) series.push(c.hex);

  return {
    theme: dark ? 'dark' : 'light',
    background: bg.hex,
    surface: surfaceC?.hex || (dark ? '#1B1B1B' : '#FFFFFF'),
    text: textC?.hex || (dark ? '#F3F3F3' : '#1A1A1A'),
    series,
    photoHeavy: clusters.filter((c) => c.share >= 0.005).length > 16 && chroma.reduce((s, c) => s + c.share, 0) > 0.35,
  };
}

// Several screenshots: the first one sets the theme and base colours (mixing a dark and a light design would give
// nonsense); the others only add chart/brand colours.
export async function analyzeShots(shots) {
  const results = [];
  for (const shot of shots) results.push(await analyzeOne(shot));
  const base = results[0];
  const series = [];
  const add = (c) => { if (c && series.length < 8 && series.every((s) => deltaE(s, c) > 0.07)) series.push(c); };
  // The first screenshot's own top colours lead, so primary and accent stay a matching pair from one design...
  base.series.slice(0, 2).forEach(add);
  // ...then the other screenshots (and the rest of the first) add chart colours, taking turns.
  for (let i = 0; i < 8; i++) for (const r of results) add(r.series[i]);
  const primary = series[0] || null;
  const hueGap = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
  const accent = primary ? series.slice(1).find((h) => hueGap(hexToOklch(h).h, hexToOklch(primary).h) >= 40) || null : null;
  return { theme: base.theme, background: base.background, surface: base.surface, text: base.text, primary, accent, series, photoHeavy: results.some((r) => r.photoHeavy), shots: shots.length };
}

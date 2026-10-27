// Turns raw Brandfetch data + measured site styles into an editable design model.
// Every value carries a provenance tag: 'brandfetch' | 'measured' | 'derived' | 'default' | 'edited'.
import {
  parseColor, normalizeHex, hexToHsl, hslHex, mix, ensureContrast, isNeutral, hueDistance, readableOn, contrast,
} from './color.js';
import { canonicalGoogleName, firstFamily, isWebAvailable, suggestSubstitute } from './fonts.js';

const px = (v) => (v == null ? NaN : parseFloat(v));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ---------- colors ----------

function chromaticStats(site) {
  const entries = [];
  const add = (list, weight = 1) =>
    (list || []).forEach(({ value, count }) => {
      const hex = normalizeHex(value);
      if (hex) entries.push({ hex, count: count * weight });
    });
  add(site?.colors?.text);
  add(site?.colors?.links, 3);
  add(site?.colors?.backgrounds);
  add(site?.buttons?.bg, 3);
  const total = entries.reduce((s, e) => s + e.count, 0) || 1;
  const chromatic = new Map();
  for (const e of entries) {
    // Very dark / very light tints are text and backgrounds, not brand colors.
    const l = hexToHsl(e.hex)[2];
    if (!isNeutral(e.hex, 0.25) && l > 0.22 && l < 0.92) chromatic.set(e.hex, (chromatic.get(e.hex) || 0) + e.count);
  }
  const ranked = [...chromatic.entries()].sort((a, b) => b[1] - a[1]).map(([hex, count]) => ({ hex, count }));
  const share = ranked.reduce((s, e) => s + e.count, 0) / total;
  return { ranked, share };
}

export function categorical(primary, accent) {
  const seeds = [primary, accent].filter(Boolean).filter((c) => !isNeutral(c, 0.1));
  const base = seeds[0] || primary || '#0176D3';
  const [bh, bs, bl] = hexToHsl(base);
  const s = clamp(bs, 0.45, 0.72);
  const l = clamp(bl, 0.4, 0.55);
  const out = [...seeds];
  if (!seeds.length && primary) out.push(primary);
  const hues = out.map((c) => hexToHsl(c)[0]);
  for (const off of [150, 60, 210, 300, 100, 20, 255, 330]) {
    if (out.length >= 7) break;
    const h = (bh + off) % 360;
    if (hues.every((x) => hueDistance(x, h) >= 28)) {
      out.push(hslHex(h, s, l));
      hues.push(h);
    }
  }
  while (out.length < 7) out.push(hslHex((bh + out.length * 47) % 360, s, l));
  out.push('#8A949E'); // neutral slot for "other"
  return out.slice(0, 8);
}

export function sequential(base) {
  const [h, s] = hexToHsl(base);
  const sat = isNeutral(base, 0.08) ? 0.04 : clamp(s, 0.35, 0.85);
  return [0.94, 0.85, 0.74, 0.62, 0.5, 0.38, 0.26].map((l) => hslHex(h, l > 0.8 ? sat * 0.8 : sat, l));
}

function divergingRamp(low, high) {
  const mid = '#F2F2F0';
  const left = [1, 0.7, 0.4].map((t) => mix(mid, low, t));
  const right = [0.4, 0.7, 1].map((t) => mix(mid, high, t));
  return [...left, mid, ...right];
}

export function derivePalettes(colors) {
  const { primary, accent } = colors;
  const seqBase = isNeutral(primary, 0.1) && accent ? accent : primary;
  let low = isNeutral(primary, 0.1) ? (accent ? accent : '#2B6CB0') : primary;
  let high = accent && hueDistance(hexToHsl(low)[0], hexToHsl(accent)[0]) > 40 && !isNeutral(accent, 0.1) ? accent : null;
  if (!high) {
    const [h, s, l] = hexToHsl(low);
    high = hslHex((h + 180) % 360, clamp(s, 0.5, 0.75), clamp(l, 0.4, 0.55));
  }
  if (isNeutral(primary, 0.1) && accent) {
    const [h, s, l] = hexToHsl(accent);
    low = accent;
    high = hslHex((h + 180) % 360, clamp(s, 0.5, 0.75), clamp(l, 0.4, 0.55));
  }
  return {
    categorical: categorical(primary, accent),
    sequential: sequential(seqBase),
    diverging: divergingRamp(low, high),
  };
}

function pickColors(brand, site) {
  const bf = (type) => normalizeHex((brand.colors || []).find((c) => c.type === type)?.hex);
  const bfAll = (brand.colors || []).map((c) => ({ hex: normalizeHex(c.hex), type: c.type })).filter((c) => c.hex);
  const bfBrand = bf('brand') || bf('primary');
  const bfAccent = bf('accent');
  const bfDark = bf('dark');
  const bfLight = bf('light');

  const stats = site ? chromaticStats(site) : { ranked: [], share: 0 };
  const monochrome = site ? stats.share < 0.08 : !(bfBrand || bfAccent);
  const prov = {};
  const alternatives = { primary: [], accent: [] };

  let primary, accent;
  if (monochrome) {
    primary = bfDark || '#111111';
    prov.primary = bfDark ? 'brandfetch' : 'default';
    accent = bfAccent || bfBrand || stats.ranked[0]?.hex || null;
    prov.accent = accent ? (bfAccent || bfBrand ? 'brandfetch' : 'measured') : 'default';
  } else {
    const measured = stats.ranked[0]?.hex;
    primary = measured || bfBrand || bfAccent;
    prov.primary = measured ? 'measured' : 'brandfetch';
    if (measured && bfBrand && bfBrand !== measured) alternatives.primary.push({ hex: bfBrand, source: 'brandfetch' });
    const hueOf = (c) => hexToHsl(c)[0];
    const candidates = [bfAccent, bfBrand, ...stats.ranked.slice(1).map((r) => r.hex)].filter(Boolean);
    const usable = (c) => {
      const [h, s, l] = hexToHsl(c);
      return hueDistance(h, hueOf(primary)) > 25 && s > 0.3 && l > 0.22 && l < 0.85;
    };
    accent = candidates.find(usable) || null;
    prov.accent = accent ? (accent === bfAccent || accent === bfBrand ? 'brandfetch' : 'measured') : 'default';
  }
  if (!primary) {
    primary = '#0176D3';
    prov.primary = 'default';
  }
  if (!accent) {
    const [h, s, l] = hexToHsl(primary);
    accent = isNeutral(primary, 0.1) ? '#0176D3' : hslHex((h + 150) % 360, clamp(s, 0.5, 0.75), clamp(l, 0.42, 0.55));
    prov.accent = 'derived';
  }

  const background = monochrome ? '#FFFFFF' : mix('#FFFFFF', primary, 0.035);
  prov.background = 'derived';
  const surface = '#FFFFFF';
  prov.surface = 'default';

  const measuredText = (site?.colors?.text || []).map((t) => normalizeHex(t.value)).find((h) => h && isNeutral(h, 0.2) && contrast(h, '#FFFFFF') > 7);
  const text = measuredText && measuredText !== '#000000' ? measuredText : bfDark && bfDark !== '#000000' ? bfDark : measuredText || '#1B1B1B';
  prov.text = measuredText ? 'measured' : bfDark ? 'brandfetch' : 'default';
  const textMuted = ensureContrast(mix(text, surface, 0.4), surface, 4.5);
  prov.textMuted = 'derived';
  const border = mix(text, surface, monochrome ? 0.78 : 0.86);
  prov.border = 'derived';

  const redText = (site?.colors?.text || []).map((t) => normalizeHex(t.value)).find((h) => h && !isNeutral(h, 0.3) && (hexToHsl(h)[0] < 20 || hexToHsl(h)[0] > 340));
  const semantic = { success: '#2E844A', warning: '#DD7A01', danger: redText || '#BA0517' };
  prov.success = prov.warning = 'default';
  prov.danger = redText ? 'measured' : 'default';

  const colors = { primary, accent, background, surface, text, textMuted, border, ...semantic };
  return { colors, prov, alternatives, monochrome, bfAll };
}

// ---------- typography ----------

function pickTypography(brand, site, monochrome) {
  const fonts = brand.fonts || [];
  const bfTitle = fonts.find((f) => f.type === 'title');
  const bfBody = fonts.find((f) => f.type === 'body');
  const t = site?.typography || {};
  const headEl = t.h1 || t.h2 || t.h3;
  const bodyEl = t.body || t['nav a'] || t.p;
  const upper = headEl?.textTransform === 'uppercase';

  function resolve(role, bf, measuredStack) {
    const measuredName = firstFamily(measuredStack);
    const brandName = bf?.name || measuredName || null;
    const candidates = [
      measuredName && { name: measuredName, source: 'measured' },
      bf && { name: bf.name, source: 'brandfetch' },
    ].filter(Boolean);
    const web = candidates.find((c) => isWebAvailable(c.name));
    if (web) {
      return { family: canonicalGoogleName(web.name), source: web.source, brandName: brandName, isSubstitute: false, alternatives: candidates.filter((c) => c !== web) };
    }
    const sub = suggestSubstitute(brandName, role, { uppercase: upper });
    return { family: sub, source: 'derived', brandName, isSubstitute: Boolean(brandName), alternatives: candidates };
  }

  const heading = resolve('heading', bfTitle, headEl?.family);
  const body = resolve('body', bfBody, bodyEl?.family);
  const tracking = headEl ? px(headEl.letterSpacing) / px(headEl.size) : 0;
  heading.weight = clamp(parseInt(headEl?.weight) || 700, 300, 800);
  heading.transform = upper ? 'uppercase' : 'none';
  heading.tracking = Number.isFinite(tracking) ? Math.round(tracking * 100) / 100 : 0;
  body.weight = 400;
  return { heading, body };
}

// ---------- shape / feel ----------

function median(arr) {
  const a = arr.filter(Number.isFinite).sort((x, y) => x - y);
  return a.length ? a[Math.floor(a.length / 2)] : NaN;
}

function pickShape(site, monochrome) {
  const prov = {};
  const hasSite = Boolean(site);
  const topPx = (list) => px(list?.[0]?.value);

  const shadowEntries = (site?.cards?.shadow || []).filter((s) => s.value !== 'none');
  const hasShadow = shadowEntries.some((s) => s.count >= 3);
  let shadow = 'none';
  if (hasShadow) {
    const m = shadowEntries[0].value.match(/rgba?\([^)]*,\s*([\d.]+)\)/);
    const alpha = m ? parseFloat(m[1]) : 0.1;
    shadow = alpha > 0.13 ? 'medium' : 'soft';
  }

  const cardRadii = (site?.cards?.radius || []).map((r) => px(r.value));
  let cardRadius = hasShadow ? cardRadii.find((r) => r > 0) ?? topPx(site?.cards?.radius) : topPx(site?.cards?.radius);
  let buttonRadius = topPx(site?.buttons?.radius);
  if (!Number.isFinite(cardRadius)) cardRadius = hasSite ? 0 : 6;
  if (!Number.isFinite(buttonRadius)) buttonRadius = cardRadius;
  cardRadius = clamp(Math.round(cardRadius), 0, 24);
  buttonRadius = clamp(Math.round(buttonRadius), 0, 999);
  prov.radius = hasSite ? 'measured' : 'default';
  prov.shadow = hasSite ? 'measured' : 'default';

  const btnBorder = site?.buttons?.border?.[0]?.value || '';
  const borderWidth = hasSite && (/^1px solid/.test(btnBorder) || (site?.buttons?.border || []).slice(0, 2).some((b) => /^1px solid rgb\(0, 0, 0\)/.test(b.value))) ? 1 : 0;

  const pads = (site?.spacing?.sectionPaddingTop || []).map((p) => px(p.value)).filter((v) => v > 0);
  const pad = median(pads);
  const density = !hasSite ? 'comfortable' : pad >= 48 ? 'spacious' : pad > 0 && pad <= 12 ? 'compact' : 'comfortable';
  prov.density = hasSite ? 'measured' : 'default';

  return {
    cardRadius,
    buttonRadius,
    shadow,
    borderWidth,
    density,
    gridlines: monochrome || cardRadius === 0 ? 'minimal' : 'light',
    barRadius: Math.min(cardRadius, 4),
    lineWidth: 2,
    prov,
  };
}

// ---------- logos ----------

export function collectLogos(brand) {
  const out = [];
  for (const l of brand.logos || []) {
    const svg = l.formats?.find((f) => f.format === 'svg');
    const png = l.formats?.find((f) => f.format === 'png');
    const any = l.formats?.[0];
    const f = svg || png || any;
    if (!f?.src) continue;
    out.push({
      id: `${l.type}-${l.theme}-${out.length}`,
      kind: l.type,
      theme: l.theme, // 'dark' = dark-colored mark for light backgrounds; 'light' = light-colored mark for dark backgrounds
      format: f.format,
      url: f.src,
      pngUrl: png?.src || null,
      uploaded: Boolean(l.uploaded),
      fileName: l.fileName,
    });
  }
  return out;
}

function pickLogo(logos) {
  return (
    logos.find((l) => l.kind === 'logo' && l.theme === 'dark') ||
    logos.find((l) => l.kind === 'logo') ||
    logos.find((l) => l.kind === 'symbol') ||
    logos[0] ||
    null
  );
}

// ---------- entry point ----------

export function synthesize({ brand, site, demo }) {
  const { colors, prov, alternatives, monochrome } = pickColors(brand, site);
  const typography = pickTypography(brand, site, monochrome);
  const shape = pickShape(site, monochrome);
  const logos = collectLogos(brand);
  const notes = [];
  if (demo) notes.push('Brandfetch data is from built-in demo fixtures (no API key set).');
  if (!site) notes.push('The live website could not be analyzed, so shape, spacing and fonts use defaults.');
  else if (site.status !== 'ok') notes.push(`Website analysis was partial (${site.status}).`);
  if (monochrome) notes.push('This brand is essentially monochrome; the accent color is used sparingly.');
  for (const k of ['heading', 'body']) {
    if (typography[k].isSubstitute) notes.push(`"${typography[k].brandName}" is a custom font and not available on the web; substituting ${typography[k].family}.`);
  }

  return {
    company: {
      name: brand.name,
      domain: brand.domain,
      description: brand.description || '',
      industry: brand.company?.industries?.slice(-1)[0]?.name || '',
      founded: brand.company?.foundedYear || null,
    },
    colors,
    prov: { ...prov, ...Object.fromEntries(Object.keys(typography).map((k) => [`font-${k}`, typography[k].source])) },
    alternatives,
    palettes: derivePalettes(colors),
    typography,
    shape,
    logos,
    logoId: pickLogo(logos)?.id || null,
    monochrome,
    screenshot: site?.screenshot || null,
    siteUrl: site?.url || null,
    character: null, // optional, filled by screenshot analysis
    notes,
    detected: null, // set below
  };
}

export function withDetected(model) {
  return { ...model, detected: JSON.parse(JSON.stringify({ ...model, detected: null })) };
}

export { readableOn };

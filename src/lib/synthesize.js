// Turns raw Brandfetch data + measured site styles into an editable design model.
// Every value carries a provenance tag: 'brandfetch' | 'measured' | 'derived' | 'default' | 'edited'.
import {
  parseColor, normalizeHex, hexToHsl, hslHex, mix, ensureContrast, isNeutral, hueDistance, readableOn, contrast,
} from './color.js';
import { canonicalGoogleName, firstFamily, isWebAvailable, matchFonts } from './fonts.js';
import { generatePalettes, hexToOklch, deriveAccent } from './palette.js';

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

// Colours the company's interface actually uses (CSS, icons), weighted by how much of its chromatic colour they cover.
function harvestFromSite(site) {
  const merged = new Map();
  for (const { value, count } of site?.colors?.all || []) {
    const hex = normalizeHex(value);
    if (!hex) continue;
    const { L, C } = hexToOklch(hex);
    if (C < 0.045 || L < 0.2 || L > 0.92) continue; // greys, near-black and near-white are not accents
    merged.set(hex, (merged.get(hex) || 0) + count);
  }
  const total = [...merged.values()].reduce((s, n) => s + n, 0) || 1;
  return [...merged.entries()].map(([hex, n]) => ({ hex, weight: n / total })).sort((a, b) => b.weight - a.weight).slice(0, 12);
}

// ctx: { extras: brand colours beyond primary/accent, harvest: colours measured on the site }
export function derivePalettes(colors, ctx = {}) {
  return generatePalettes({
    // An accent we invented (the brand has none) must not steer the palette; only real brand colours do.
    brand: [colors.primary, ctx.accentIsInvented ? null : colors.accent, ...(ctx.extras || [])].filter(Boolean),
    harvest: ctx.harvest || [],
    accent: colors.accent,
  });
}

function pickColors(brand, site) {
  const bf = (type) => normalizeHex((brand.colors || []).find((c) => c.type === type)?.hex);
  const bfAll = (brand.colors || []).map((c) => ({ hex: normalizeHex(c.hex), type: c.type })).filter((c) => c.hex);
  const bfBrand = bf('brand') || bf('primary');
  const bfAccent = bf('accent');
  const bfDark = bf('dark');
  const bfLight = bf('light');

  // Brandfetch sometimes lists a pale gray as the "accent" of a black-and-white brand. Only trust real colors.
  const realColor = (c) => {
    if (!c) return null;
    const [, sat, light] = hexToHsl(c);
    return sat >= 0.12 && light > 0.15 && light < 0.9 ? c : null;
  };
  const brandUse = realColor(bfBrand);
  const accentUse = realColor(bfAccent);

  const stats = site ? chromaticStats(site) : { ranked: [], share: 0 };
  const monochrome = site ? stats.share < 0.08 : !(brandUse || accentUse);
  const prov = {};
  const alternatives = { primary: [], accent: [] };

  let primary, accent;
  if (monochrome) {
    primary = bfDark || '#111111';
    prov.primary = bfDark ? 'brandfetch' : 'default';
    accent = accentUse || brandUse || stats.ranked[0]?.hex || null;
    prov.accent = accent ? (accentUse || brandUse ? 'brandfetch' : 'measured') : 'default';
  } else {
    const measured = stats.ranked[0]?.hex;
    primary = measured || brandUse || accentUse;
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
    accent = isNeutral(primary, 0.1) ? '#0176D3' : deriveAccent(primary) || '#0176D3';
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
    const weight = role === 'heading' ? clamp(parseInt(headEl?.weight) || 700, 300, 800) : 400;
    const suggestions = matchFonts({ name: brandName, role, weight, uppercase: role === 'heading' && upper });
    return { family: suggestions[0].family, source: 'derived', brandName, isSubstitute: Boolean(brandName), alternatives: candidates, suggestions };
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

// Button corner radius from the prominent (filled or outlined) buttons. 999 means fully rounded (pill).
function buttonRadiusFromSamples(samples) {
  if (!samples?.length) return null;
  const prominent = samples.filter((b) => b.prom);
  const pool = prominent.length >= 2 ? prominent : samples.filter((b) => b.w >= 40 && b.h >= 24);
  if (!pool.length) return null;
  if (pool.filter((b) => b.pill).length / pool.length >= 0.5) return 999;
  const radii = pool.filter((b) => !b.pill).map((b) => b.r).sort((a, b) => a - b);
  return radii[Math.floor(radii.length / 2)];
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

  const cardRadii = (site?.cards?.radius || []).filter((r) => !String(r.value).endsWith('%')).map((r) => px(r.value));
  let cardRadius = hasShadow ? cardRadii.find((r) => r > 0) ?? topPx(site?.cards?.radius) : topPx(site?.cards?.radius);
  let buttonRadius = buttonRadiusFromSamples(site?.buttons?.samples) ?? topPx(site?.buttons?.radius);
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

export function synthesize({ brand, site, demo, screenshot = null, screenshotSource = null, siteError = null }) {
  const { colors, prov, alternatives, monochrome, bfAll } = pickColors(brand, site);
  // Extra colours that inform the chart palettes: the brand's other listed colours, and what the site's interface uses.
  const paletteContext = {
    extras: [...(alternatives.primary || []).map((a) => a.hex), ...(bfAll || []).filter((c) => ['brand', 'primary', 'accent'].includes(c.type)).map((c) => c.hex)],
    harvest: harvestFromSite(site),
    accentIsInvented: prov.accent === 'derived' || prov.accent === 'default',
  };
  const typography = pickTypography(brand, site, monochrome);
  const shape = pickShape(site, monochrome);
  const logos = collectLogos(brand);
  const notes = [];
  if (demo) notes.push('Brandfetch data is from built-in demo fixtures (no API key set).');
  if (!site) {
    notes.push(
      siteError
        ? `The website could not be analyzed automatically (${siteError.replace(/\.$/, '')}), so corners, shadows, spacing and fonts use Brandfetch data and sensible defaults. Adjust them in the Shape and feel step.`
        : 'The live website could not be analyzed, so shape, spacing and fonts use defaults.',
    );
  }
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
    paletteContext,
    palettes: derivePalettes(colors, paletteContext),
    typography,
    shape,
    logos,
    logoId: pickLogo(logos)?.id || null,
    monochrome,
    screenshot: site?.screenshot || screenshot || null,
    screenshotSource: site?.screenshot ? 'live' : screenshotSource,
    siteMeasured: Boolean(site),
    siteUrl: site?.url || null,
    notes,
    detected: null, // set below
  };
}

export function withDetected(model) {
  return { ...model, detected: JSON.parse(JSON.stringify({ ...model, detected: null })) };
}

export { readableOn };

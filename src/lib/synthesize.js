// Turns the brand's identity (name, logos, official colour) + measured site styles into an editable design model.
// Every value carries a provenance tag: 'simpleicons' | 'logo' | 'measured' | 'screenshot' | 'derived' | 'default' | 'edited'.
import {
  parseColor, normalizeHex, hexToHsl, hslHex, mix, ensureContrast, isNeutral, hueDistance, readableOn, contrast,
} from './color.js';
import { canonicalGoogleName, firstFamily, isWebAvailable, matchFonts } from './fonts.js';
import { generatePalettes, hexToOklch, deriveAccent, deltaE } from './palette.js';

const px = (v) => (v == null ? NaN : parseFloat(v));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ---------- colors ----------

// Colours a browser paints on plain, unstyled links. They show up on many pages but belong to no brand.
const BROWSER_DEFAULTS = new Set(['#0000EE', '#551A8B', '#EE0000', '#0000FF']);

function chromaticStats(site) {
  const entries = [];
  const add = (list, weight = 1) =>
    (list || []).forEach(({ value, count }) => {
      const hex = normalizeHex(value);
      if (hex && !BROWSER_DEFAULTS.has(hex)) entries.push({ hex, count: count * weight });
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
    if (!hex || BROWSER_DEFAULTS.has(hex)) continue;
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
    reference: ctx.reference || [],
    brandSource: ctx.fromReference ? 'screenshot' : 'brand',
  });
}

// True when the brand has at least one real (not grey) brand/primary/accent colour.
export function brandHasColor(brand) {
  return (brand.colors || []).some((c) => {
    if (!['brand', 'primary', 'accent'].includes(c.type)) return false;
    const hex = normalizeHex(c.hex);
    if (!hex) return false;
    const [, sat, light] = hexToHsl(hex);
    return sat >= 0.12 && light > 0.15 && light < 0.9;
  });
}

function pickColors(brand, site, logoColors = [], logoInk = null) {
  const bf = (type) => normalizeHex((brand.colors || []).find((c) => c.type === type)?.hex);
  const bfAll = (brand.colors || []).map((c) => ({ hex: normalizeHex(c.hex), type: c.type, source: c.source })).filter((c) => c.hex);
  // Where a brand colour came from: an official source such as Simple Icons, or the user.
  const bfSource = (hex) => bfAll.find((c) => c.hex === hex)?.source || 'edited';
  const bfBrand = bf('brand') || bf('primary');
  const bfAccent = bf('accent');
  const bfDark = bf('dark');
  const bfLight = bf('light');

  // A pale gray listed as the "accent" of a black-and-white brand is not a colour. Only trust real colors.
  const realColor = (c) => {
    if (!c) return null;
    const [, sat, light] = hexToHsl(c);
    return sat >= 0.12 && light > 0.15 && light < 0.9 ? c : null;
  };
  const brandUse = realColor(bfBrand);
  const accentUse = realColor(bfAccent);

  const stats = site ? chromaticStats(site) : { ranked: [], share: 0 };
  // The brand's own colours come first. A brand with a real brand/primary colour is never "monochrome";
  // otherwise the website decides whether the design is essentially black and white.
  const logoUse = (logoColors || []).filter((c) => realColor(c));
  // An official black or white (Simple Icons) means the brand really is monochrome: its logo can supply the accent, not the primary.
  const officialNeutral = !brandUse && bfAll.some((c) => c.source === 'simpleicons');
  const monochrome = brandUse ? false : officialNeutral ? true : !accentUse && logoUse.length ? false : site ? stats.share < 0.08 : !(brandUse || accentUse);
  const prov = {};
  const alternatives = { primary: [], accent: [] };

  let primary, accent;
  if (monochrome) {
    // A black-and-white brand's primary is its official black (or the default near-black when none is known).
    const official = officialNeutral ? bfAll.find((c) => c.source === 'simpleicons')?.hex : null;
    const officialNeutralHex = official && hexToHsl(official)[2] < 0.5 ? official : null; // a white logo colour can't be a primary
    // Order: an official colour, then the logo's own ink (even grey: it is the brand's colour), and only then the default.
    primary = bfDark || officialNeutralHex || logoInk || '#111111';
    prov.primary = bfDark || officialNeutralHex ? bfSource(bfDark || officialNeutralHex) : logoInk ? 'logo' : 'default';
    accent = accentUse || brandUse || logoUse[0] || stats.ranked[0]?.hex || harvestFromSite(site)[0]?.hex || null;
    prov.accent = accent ? (accentUse || brandUse ? bfSource(accent) : accent === logoUse[0] ? 'logo' : 'measured') : 'default';
  } else {
    const measured = stats.ranked[0]?.hex;
    const bfOrder = [...new Set([brandUse, accentUse, ...bfAll.filter((c) => ['brand', 'primary'].includes(c.type) && realColor(c.hex)).map((c) => c.hex)].filter(Boolean))];
    // Order of trust: the official brand colour (Simple Icons), then the logo itself, then whatever the website happens to use.
    const ordered = [...bfOrder, ...logoUse.filter((c) => !bfOrder.includes(c))];
    const sourceOf = (c) => (bfOrder.includes(c) ? bfSource(c) : logoUse.includes(c) ? 'logo' : 'measured');
    // Colour from the brand or its logo, then the website's own colour, then the logo's grey ink.
    primary = ordered[0] || measured || logoInk;
    prov.primary = ordered[0] ? sourceOf(ordered[0]) : measured ? 'measured' : logoInk ? 'logo' : 'measured';
    if (ordered[0] && measured && deltaE(ordered[0], measured) > 0.06) alternatives.primary.push({ hex: measured, source: 'measured' });
    const usable = (c) => {
      const [h, sat, l] = hexToHsl(c);
      return hueDistance(h, hexToHsl(primary)[0]) > 25 && sat > 0.3 && l > 0.22 && l < 0.85;
    };
    // The accent is a second colour the brand really uses: another logo colour, then the site's own colours (buttons, links,
    // then every colour in its interface and icons). Only when none of those fits is one invented.
    accent = [...ordered.slice(1), ...stats.ranked.map((r) => r.hex), ...harvestFromSite(site).map((h) => h.hex)].find(usable) || null;
    prov.accent = accent ? sourceOf(accent) : 'default';
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
  prov.text = measuredText ? 'measured' : bfDark ? bfSource(bfDark) : 'default';
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
      bf && { name: bf.name, source: 'brand' },
    ].filter(Boolean);
    const web = candidates.find((c) => isWebAvailable(c.name));
    if (web) {
      return { family: canonicalGoogleName(web.name), source: web.source, brandName: brandName, isSubstitute: false, alternatives: candidates.filter((c) => c !== web) };
    }
    const weight = role === 'heading' ? clamp(parseInt(headEl?.weight) || 700, 300, 800) : 400;
    const suggestions = matchFonts({ name: brandName, role, weight, uppercase: role === 'heading' && upper });
    const isSystem = /^(-apple-system|blinkmacsystemfont|system-ui|ui-sans-serif|segoe ui|sf pro|san francisco)/i.test(brandName || '');
    return { family: suggestions[0].family, source: 'derived', brandName, isSubstitute: Boolean(brandName), isSystem, alternatives: candidates, suggestions };
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

// A customer screenshot is their real app, so the colours read from it outrank the website's and the brand's.
function applyReference(colors, prov, a) {
  if (a.primary) { colors.primary = a.primary; prov.primary = 'screenshot'; }
  if (a.accent) { colors.accent = a.accent; prov.accent = 'screenshot'; }
  colors.background = a.background; prov.background = 'screenshot';
  colors.surface = a.surface; prov.surface = 'screenshot';
  colors.text = a.text; prov.text = 'screenshot';
  colors.textMuted = ensureContrast(mix(a.text, a.surface, 0.4), a.surface, 4.5); prov.textMuted = 'derived';
  colors.border = mix(a.text, a.surface, a.theme === 'dark' ? 0.78 : 0.86); prov.border = 'derived';
}

export function synthesize({ brand, site, screenshot = null, screenshotSource = null, siteError = null, reference = null, screenshotOnly = false, logoColors = [], logoInk = null }) {
  const { colors, prov, alternatives, monochrome: baseMono, bfAll } = pickColors(brand, site, logoColors, logoInk);
  const analysis = reference?.analysis || null;
  const baseColors = { ...colors }; // what the brand and website said, kept so the user can switch back
  const baseProv = { ...prov };
  if (analysis) applyReference(colors, prov, analysis);
  const monochrome = analysis ? !analysis.primary : baseMono;
  // Extra colours that inform the chart palettes: the brand's other listed colours, and what the site's interface uses.
  const paletteContext = {
    extras: [...(alternatives.primary || []).map((a) => a.hex), ...(bfAll || []).filter((c) => ['brand', 'primary', 'accent'].includes(c.type)).map((c) => c.hex)],
    harvest: harvestFromSite(site),
    accentIsInvented: prov.accent === 'derived' || prov.accent === 'default',
    reference: analysis?.series || [],
    fromReference: Boolean(analysis?.primary), // label chart colours "Screenshot" only if it really supplied brand colours
  };
  const typography = pickTypography(brand, site, monochrome);
  const shape = pickShape(site, monochrome);
  const logos = collectLogos(brand);
  const notes = [];
  if (!site && !screenshotOnly) {
    notes.push(
      siteError
        ? `The website could not be analyzed automatically (${String(siteError).split(/\n| at /)[0].replace(/^page\.evaluate:\s*/i, '').slice(0, 140).replace(/\.$/, '')}), so corners, shadows, spacing and fonts use Brandfetch data and sensible defaults. Adjust them in the Shape and feel step.`
        : 'The live website could not be analyzed, so shape, spacing and fonts use defaults.',
    );
  }
  else if (site && site.status !== 'ok') notes.push(`Website analysis was partial (${site.status}).`);
  if (analysis) {
    notes.push(`Colors were read from ${analysis.shots === 1 ? 'your reference screenshot' : `${analysis.shots} reference screenshots`} (${analysis.theme} design), and they take priority over the website's colors.`);
    if (analysis.photoHeavy) notes.push('The screenshot contains a lot of photography, so some colors may come from images rather than the interface. Check the palette.');
    if (!site) notes.push('Fonts, corners, shadows and spacing are not read from screenshots yet, so they are defaults. Compare with your screenshot and adjust the Shape step.');
  }
  if (monochrome) notes.push('This brand is essentially monochrome; the accent color is used sparingly.');
  for (const k of ['heading', 'body']) {
    const f = typography[k];
    if (f.isSystem) notes.push(`"${f.brandName}" is a system font, so it can't be bundled; using ${f.family}.`);
    else if (f.isSubstitute) notes.push(`"${f.brandName}" is a custom font and not available on the web; substituting ${f.family}.`);
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
    screenshotOnly,
    reference: analysis ? { analysis, count: analysis.shots } : null,
    baseColors,
    baseProv,
    baseMonochrome: baseMono,
    colorSource: analysis ? 'screenshot' : 'website',
    siteUrl: site?.url || null,
    notes,
    detected: null, // set below
  };
}

export function withDetected(model) {
  return { ...model, detected: JSON.parse(JSON.stringify({ ...model, detected: null })) };
}

export { readableOn };


// Add a screenshot to a company that is already loaded: its colors take over and the chart palettes are rebuilt.
export function applyReferenceToModel(n, analysis) {
  if (!n.baseColors) { n.baseColors = { ...n.colors }; n.baseProv = { ...n.prov }; n.baseMonochrome = n.monochrome; }
  applyReference(n.colors, n.prov, analysis);
  n.colorSource = 'screenshot';
  n.paletteContext = { ...n.paletteContext, reference: analysis.series, fromReference: Boolean(analysis.primary), accentIsInvented: !analysis.accent };
  n.palettes = derivePalettes(n.colors, n.paletteContext);
  n.reference = { analysis, count: analysis.shots };
  n.monochrome = !analysis.primary;
  n.notes = [
    ...n.notes.filter((x) => !x.startsWith('Colors were read from')),
    `Colors were read from ${analysis.shots === 1 ? 'your reference screenshot' : `${analysis.shots} reference screenshots`} (${analysis.theme} design), and they take priority over the website's colors.`,
  ];
}


// Switch the colours back to what the brand and website said (the screenshot stays attached for reference).
export function useWebsiteColors(n) {
  if (!n.baseColors) return;
  n.colors = { ...n.baseColors };
  for (const k of Object.keys(n.baseProv)) n.prov[k] = n.baseProv[k];
  // An accent we invented (not a real brand colour) must not steer the chart palette again once the screenshot is gone.
  n.paletteContext = { ...n.paletteContext, reference: [], fromReference: false, accentIsInvented: n.baseProv.accent === 'derived' || n.baseProv.accent === 'default' };
  n.palettes = derivePalettes(n.colors, n.paletteContext);
  n.monochrome = n.baseMonochrome;
  n.colorSource = 'website';
  n.notes = n.notes.filter((x) => !x.startsWith('Colors were read from'));
}

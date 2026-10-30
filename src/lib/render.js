// Model -> design.md text, plus CSS variables used by the live preview.
import { cssStack } from './fonts.js';
import { contrast, readableOn } from './color.js';

export const SHADOWS = {
  none: 'none',
  soft: '0 1px 8px rgba(0,0,0,0.08)',
  medium: '0 4px 20px rgba(0,0,0,0.14)',
};
export const DENSITY = {
  compact: { pad: 12, gap: 12, label: 'compact' },
  comfortable: { pad: 18, gap: 16, label: 'comfortable' },
  spacious: { pad: 26, gap: 24, label: 'spacious' },
};

// A card with no border and no shadow is invisible on a white page, so flat brands get a 1px hairline.
export const effectiveBorder = (shape) => shape.borderWidth || (shape.shadow === 'none' ? 1 : 0);

export const selectedLogo = (m) => m.logos.find((l) => l.id === m.logoId) || null;

// Uploaded logos are data URLs; reference them by file name instead of embedding megabytes of base64.
const logoRef = (l) => (l.url.startsWith('data:') ? `uploaded file "${l.fileName || 'logo'}" (supply this file with the app)` : l.url);

export function cssVars(m) {
  const d = DENSITY[m.shape.density];
  return {
    '--bg': m.colors.background,
    '--surface': m.colors.surface,
    '--text': m.colors.text,
    '--muted': m.colors.textMuted,
    '--border': m.colors.border,
    '--primary': m.colors.primary,
    '--on-primary': readableOn(m.colors.primary),
    '--accent': m.colors.accent,
    '--on-accent': readableOn(m.colors.accent),
    '--success': m.colors.success,
    '--warning': m.colors.warning,
    '--danger': m.colors.danger,
    '--radius': `${m.shape.cardRadius}px`,
    '--btn-radius': `${m.shape.buttonRadius}px`,
    '--shadow': SHADOWS[m.shape.shadow],
    '--bw': `${effectiveBorder(m.shape)}px`,
    '--pad': `${d.pad}px`,
    '--gap': `${d.gap}px`,
    '--font-heading': cssStack(m.typography.heading.family),
    '--font-body': cssStack(m.typography.body.family),
    '--h-weight': m.typography.heading.weight,
    '--h-transform': m.typography.heading.transform,
    '--h-tracking': `${m.typography.heading.tracking}em`,
  };
}

function intent(m) {
  const s = m.shape;
  const parts = [];
  parts.push(s.cardRadius === 0 ? 'sharp, square-cornered' : s.cardRadius >= 12 ? 'soft and rounded' : 'gently rounded');
  parts.push(s.shadow === 'none' ? 'flat (no shadows)' : s.shadow === 'soft' ? 'lightly elevated' : 'strongly elevated');
  parts.push(s.density === 'compact' ? 'dense and compact' : s.density === 'spacious' ? 'airy and spacious' : 'balanced in density');
  if (m.typography.heading.transform === 'uppercase') parts.push('with uppercase headings');
  const color = m.monochrome
    ? `Color is mostly monochrome (${m.colors.primary} on ${m.colors.background}); the accent ${m.colors.accent} is used sparingly for emphasis.`
    : `Color leads with ${m.colors.primary}, with ${m.colors.accent} as the emphasis color.`;
  return `${m.company.name} data apps should feel ${parts.join(', ')}. ${color}`;
}

const src = (m, k) => ({ brandfetch: 'Brandfetch', measured: 'measured on site', derived: 'derived', default: 'default', edited: 'edited by you' }[m.prov[k]] || '');

function logoSection(logo, asset) {
  if (!logo) return 'No logo selected.';
  const what = `${logo.kind === 'logo' ? 'wordmark' : logo.kind} (${logo.theme === 'dark' ? 'dark mark for light backgrounds' : 'light mark for dark backgrounds'}), ${logo.format.toUpperCase()}`;
  let embedded;
  if (!asset) embedded = 'The logo file is embedded here when the design file is generated.';
  else if (asset.failed) embedded = `The logo could not be embedded automatically (${asset.reason}). Ask the user to attach the logo file.`;
  else if (asset.kind === 'svg') embedded = `**Embedded logo. Use this; do not download it.** Paste this SVG inline in the app header:\n\n\`\`\`svg\n${asset.svg}\n\`\`\``;
  else embedded = `**Embedded logo. Use this; do not download it.** Use this data URI as the image source:\n\n\`\`\`text\n${asset.dataUri}\n\`\`\``;
  return `Selected: ${what}\n\n${embedded}\n\nOriginal source (may require access, so prefer the embedded copy): ${logoRef(logo)}\n\nKeep clear space equal to the logo height around it and do not recolor it.`;
}

export function renderDesignMd(m, { logoAsset = null } = {}) {
  const c = m.colors;
  const t = m.typography;
  const s = m.shape;
  const d = DENSITY[s.density];
  const logo = selectedLogo(m);
  const roleRows = [
    ['Primary', c.primary, 'primary buttons, selected state, key marks, links'],
    ['Accent', c.accent, 'highlights, secondary series, callouts'],
    ['Background', c.background, 'page background'],
    ['Surface', c.surface, 'cards, tiles, tables'],
    ['Text', c.text, 'body text, titles'],
    ['Text muted', c.textMuted, 'axis labels, captions'],
    ['Border', c.border, 'dividers, card outlines, gridlines'],
    ['Success', c.success, 'positive change'],
    ['Warning', c.warning, 'caution'],
    ['Danger', c.danger, 'negative change, errors'],
  ];
  const keys = ['primary', 'accent', 'background', 'surface', 'text', 'textMuted', 'border', 'success', 'warning', 'danger'];
  const colorTable = roleRows
    .map(([name, hex, use], i) => `| ${name} | \`${hex}\` | ${use} | ${src(m, keys[i])} |`)
    .join('\n');

  const pal = (arr) => arr.map((h) => `\`${h}\``).join(' ');
  const hf = t.heading;
  const bf = t.body;
  const fontNote = (f, label) =>
    f.isSubstitute
      ? `${label}: **${f.family}** (substitute for the custom brand font "${f.brandName}", which isn't available on the web)`
      : `${label}: **${f.family}**${f.brandName && f.brandName !== f.family ? ` (brand lists "${f.brandName}")` : ''}`;

  const tokens = {
    name: m.company.name,
    colors: c,
    palettes: m.palettes,
    typography: { heading: { family: hf.family, weight: hf.weight, transform: hf.transform, tracking: hf.tracking }, body: { family: bf.family, weight: bf.weight } },
    shape: { cardRadius: s.cardRadius, buttonRadius: s.buttonRadius, shadow: SHADOWS[s.shadow], borderWidth: effectiveBorder(s), density: s.density },
    chart: { gridlines: s.gridlines, barRadius: s.barRadius, lineWidth: s.lineWidth },
    logo: logo ? { kind: logo.kind, embedded: Boolean(logoAsset && !logoAsset.failed), source: logoRef(logo) } : null,
  };

  const cssBlock = Object.entries(cssVars(m)).map(([k, v]) => `  ${k}: ${v};`).join('\n');
  const dos = [
    `Use \`${c.primary}\` as the lead color; reserve \`${c.accent}\` for emphasis so it stays meaningful.`,
    `Keep corners at ${s.cardRadius}px on cards and ${s.buttonRadius >= 999 ? 'fully rounded' : s.buttonRadius + 'px'} on buttons.`,
    s.shadow === 'none' ? 'Separate surfaces with borders and whitespace, not shadows.' : 'Use the shadow token on cards only; never stack shadows.',
    hf.transform === 'uppercase' ? 'Set headings and KPI labels in uppercase.' : 'Use sentence case for headings.',
    'Pull series colors from the categorical palette in order; never reuse the accent for an unrelated series.',
  ];
  const donts = [
    'Do not introduce colors outside the tokens above (except neutral tints of Text).',
    s.cardRadius === 0 ? 'Do not round corners anywhere.' : 'Do not mix sharp and rounded corners in one view.',
    s.shadow === 'none' ? 'Do not add drop shadows, glows, or gradients.' : 'Do not add heavy shadows or glows.',
    'Do not use more than 6 categorical colors in a single chart; group the rest into "Other".',
    'Do not place text on a background with less than 4.5:1 contrast.',
  ];

  const lowContrast = [
    ['Text on Surface', c.text, c.surface],
    ['Muted text on Surface', c.textMuted, c.surface],
    ['Primary on Surface', c.primary, c.surface],
  ].map(([n, a, b]) => `${n}: ${contrast(a, b).toFixed(1)}:1`).join(' · ');

  return `# Design Guide: ${m.company.name}

> **For Claude / data app builders:** treat this file as binding when you design a Tableau data app for ${m.company.name}. Use the tokens in the JSON block at the bottom for exact values, apply the component and chart rules below, and prefer these over generic defaults. Where this file is silent, choose the option closest to the design intent.

## Design intent

${intent(m)}

${m.company.description ? `*About the company:* ${m.company.description}\n` : ''}${m.company.industry ? `*Industry:* ${m.company.industry}\n` : ''}
## Color

| Role | Value | Use for | Source |
|---|---|---|---|
${colorTable}

Contrast check: ${lowContrast}

### Chart palettes

- **Categorical** (in order): ${pal(m.palettes.categorical)}${m.palettes.sources ? '\n  - Sources in order: ' + m.palettes.sources.join(', ') + ' (brand and site colors are the company\'s own; derived colors were chosen to harmonize with them; use at most 7 colors per chart plus the neutral for context)' : ''}
- **Sequential** (light → dark): ${pal(m.palettes.sequential)}
- **Diverging** (negative → positive): ${pal(m.palettes.diverging)}

Use categorical for unordered categories, sequential for magnitude, and diverging only when the data has a meaningful midpoint (e.g. variance to target).

## Typography

- ${fontNote(hf, 'Headings')}, weight ${hf.weight}, ${hf.transform === 'uppercase' ? 'UPPERCASE' : 'sentence case'}${hf.tracking ? `, letter-spacing ${hf.tracking}em` : ''}
- ${fontNote(bf, 'Body and chart labels')}, weight ${bf.weight}
- Scale: KPI value 32px / heading 20px / subheading 14px / body 14px / axis label 12px
- Both fonts are available from Google Fonts.

## Shape, depth and spacing

- Card radius **${s.cardRadius}px**, button radius **${s.buttonRadius >= 999 ? 'pill' : s.buttonRadius + 'px'}**, border width ${effectiveBorder(s)}px
- Elevation: **${s.shadow}** (\`${SHADOWS[s.shadow]}\`)
- Density: **${d.label}**; card padding ${d.pad}px, gap between cards ${d.gap}px

## Components

- **Header:** ${logo ? `${logo.kind === "logo" ? "wordmark logo" : logo.kind + " mark"} (embedded in the Logo section below) at left, height 28–36px,` : 'company name in the heading font'} on ${c.surface}; ${s.borderWidth || s.shadow === 'none' ? 'a 1px bottom border' : 'subtle shadow'}.
- **KPI tile:** surface background, label in muted text${hf.transform === 'uppercase' ? ' (uppercase)' : ''}, value in the heading font at 32px, delta in success/danger color.
- **Chart card:** title in the heading font, optional one-line subtitle in muted text, chart below. Card radius ${s.cardRadius}px.
- **Filters:** compact controls on the surface color with ${s.borderWidth || 1}px border; selected state uses the primary color.
- **Tables:** header row in muted text, row dividers in the border color, no zebra striping${s.density === 'compact' ? ', tight row height (32px)' : ''}.
- **Buttons:** primary = ${c.primary} fill with ${readableOn(c.primary)} text; secondary = transparent with ${s.borderWidth || 1}px primary border.

## Chart style

- Gridlines: **${s.gridlines}** ${s.gridlines === 'minimal' ? '(horizontal only, very light, or none when values are labeled)' : '(light horizontal lines in the border color)'}
- Bars: corner radius ${s.barRadius}px; keep a consistent gap of about 30% of bar width.
- Lines: ${s.lineWidth}px stroke, round caps; add end-point markers only for the latest value.
- Label directly on marks where possible; keep legends to one line.
- Axis labels and ticks use the muted text color at 12px.
- Highlight one series or bar with the primary color and de-emphasize the rest with neutral tints when telling a single story.

## Build notes for Claude

- **Use the embedded logo** from the Logo section directly (inline SVG or data URI). Data apps often cannot reach the internet, so never depend on a logo link.
- **Size charts to their container.** Measure the container's pixel width (for example with a ResizeObserver) and draw the SVG at that size, or use a viewBox with the container's aspect ratio. Never stretch a small fixed-size drawing across a wide card; it makes labels and markers oversized.
- **Keep text and marks at fixed sizes** whatever the chart width: axis and label text 11–12px, data-point markers 3–4px radius, and the line weight given above.
- **Fonts:** use the Google Fonts named above, with the generic family as a fallback if they cannot load.

## Do

${dos.map((x) => `- ${x}`).join('\n')}

## Don't

${donts.map((x) => `- ${x}`).join('\n')}

## Logo

${logoSection(logo, logoAsset)}

## Provenance and notes

- Brand data: Brandfetch (${m.company.domain}); look-and-feel measured from ${m.siteUrl || 'n/a (website analysis unavailable)'}
${m.notes.map((n) => `- ${n}`).join('\n')}
- Generated by Brandify. Review values marked "derived" or "default" before client-facing use.

## Tokens

\`\`\`css
:root {
${cssBlock}
}
\`\`\`

\`\`\`json
${JSON.stringify(tokens, null, 2)}
\`\`\`
`;
}

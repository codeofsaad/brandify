// Usage: node scripts/palette-sheet.mjs <out.png>
// Renders generated palettes for a set of brands so they can be judged by eye.
import { chromium } from 'playwright';
import { derivePalettes } from '../src/lib/synthesize.js';

const brands = [
  ['Anker (black + light blue)', { primary: '#111111', accent: '#40C7FB' }],
  ['Stripe (purple)', { primary: '#533AFD', accent: '#E29536' }],
  ['Regeneron (blue + magenta)', { primary: '#2169E6', accent: '#D50057' }],
  ['Samsung (deep blue)', { primary: '#1428A0', accent: '#007AFF' }],
  ['Tableau / Salesforce blue', { primary: '#0176D3', accent: '#032D60' }],
  ['Spotify (green + black)', { primary: '#191414', accent: '#1DB954' }],
  ['Coca-Cola (red)', { primary: '#F40009', accent: '#000000' }],
  ['adidas (black + green)', { primary: '#000000', accent: '#408267' }],
  ['Nike (black & white, accent invented)', { primary: '#111111', accent: '#0176D3', invented: true }],
];
const row = (hexes, srcs, h = 34) => `<div class="r">${hexes.map((c, i) => `<div class="c"><i style="background:${c};height:${h}px"></i>${srcs ? `<small>${srcs[i]}</small>` : ''}</div>`).join('')}</div>`;
const html = `<body style="font:12px Inter,system-ui;margin:16px;width:980px">${brands
  .map(([name, colors]) => {
    const p = derivePalettes(colors, { accentIsInvented: colors.invented });
    return `<div style="margin-bottom:14px"><b style="font-size:13px">${name}</b> <span style="color:#777">primary ${colors.primary} · accent ${colors.accent}</span>${row(p.categorical, p.sources)}<div style="display:flex;gap:24px">${row(p.sequential, null, 14)}${row(p.diverging, null, 14)}</div></div>`;
  })
  .join('')}<style>.r{display:flex;gap:4px;margin:4px 0;flex:1}.c{flex:1;text-align:center}.c i{display:block;border-radius:5px;box-shadow:inset 0 0 0 1px #0002}small{color:#666;font-size:10px}</style></body>`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1012, height: 900 } });
await page.setContent(html);
await page.screenshot({ path: process.argv[2], fullPage: true });
await browser.close();
for (const [name, colors] of brands) {
  const p = derivePalettes(colors, { accentIsInvented: colors.invented });
  console.log(name.padEnd(30), p.categorical.join(' '), '|', p.sources.join(','));
}

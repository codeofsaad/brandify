// Usage: node scripts/test-render.mjs <domain> [--character]
// Renders design.md from the demo fixture + saved style.json and prints the character/tokens parts.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { synthesize } from '../src/lib/synthesize.js';
import { renderDesignMd } from '../src/lib/render.js';

const [domain, flag] = process.argv.slice(2);
const read = (p) => JSON.parse(readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8'));
const brand = read('../server/fixtures/brands.json')[domain];
let site = null;
try { site = read(`../out/${domain}/style.json`); } catch {}
const m = synthesize({ brand, site, demo: true });
if (flag === '--character') {
  m.character = { mood: 'bold, athletic, youthful', imagery: 'Full-bleed lifestyle photography.', decoration: 'none', rhythm: 'Airy with large type.', rules: ['Keep imagery out of the dashboard.', 'Use black for emphasis.'] };
}
const md = renderDesignMd(m);
console.log(md.length, 'chars');
console.log(md.includes('## Visual character') ? 'HAS character section' : 'no character section');
const i = md.indexOf('## Visual character');
if (i >= 0) console.log(md.slice(i, i + 600));
console.log(md.includes('"character"') ? 'tokens include character' : 'tokens exclude character');

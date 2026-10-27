// Usage: node scripts/test-synth.mjs <domain>
// Runs synthesize() on the demo fixture + saved out/<domain>/style.json and prints the result.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { synthesize } from '../src/lib/synthesize.js';

const domain = process.argv[2];
const read = (p) => JSON.parse(readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8'));
const brand = read('../server/fixtures/brands.json')[domain];
let site = null;
try { site = read(`../out/${domain}/style.json`); } catch {}
const m = synthesize({ brand, site, demo: true });
const { logos, detected, ...rest } = m;
console.log(JSON.stringify(rest, null, 2));
console.log('logos:', logos.map((l) => `${l.kind}/${l.theme}/${l.format}`).join(', '), '→ selected', m.logoId);

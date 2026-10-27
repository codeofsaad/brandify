// Usage: node scripts/extract-style.mjs <url-or-domain>
// Thin CLI around server/extract.mjs. Writes out/<domain>/style.json and home.png.
import { extractSite } from '../server/extract.mjs';

const input = process.argv[2];
if (!input) {
  console.error('Usage: node scripts/extract-style.mjs <url-or-domain>');
  process.exit(1);
}
const r = await extractSite(input);
console.log(`${r.domain}: ${r.status}`);

// Usage: node scripts/check-shape.mjs <domain>...   Measures live sites and prints the shape the app would choose.
import { extractSite } from '../server/extract.mjs';
import { synthesize } from '../src/lib/synthesize.js';

for (const d of process.argv.slice(2)) {
  try {
    const site = await extractSite(d);
    if (site.blocked) { console.log(d.padEnd(18), 'BLOCKED:', site.reason); continue; }
    const m = synthesize({ brand: { name: d, domain: d, colors: [], fonts: [], logos: [] }, site, demo: false });
    const s = m.shape;
    const prom = (site.buttons.samples || []).filter((b) => b.prom);
    console.log(d.padEnd(18), `buttons ${s.buttonRadius >= 999 ? 'PILL' : s.buttonRadius + 'px'}`.padEnd(16), `cards ${s.cardRadius}px`.padEnd(12), `shadow ${s.shadow}`.padEnd(14), `density ${s.density}`.padEnd(18), `(${prom.length} prominent of ${site.buttons.count} buttons; ${prom.filter((b) => b.pill).length} pill)`);
  } catch (e) { console.log(d.padEnd(18), 'ERROR', e.message.split('\n')[0]); }
}

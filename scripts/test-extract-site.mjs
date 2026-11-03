// Runs the real extractSite() (headless Chromium) against a public page in both modes. Needs internet.
// Catches crashes in the extraction pipeline itself, which the sampleStyles-only test cannot.
import { extractSite } from '../server/extract.mjs';

const quiet = console.log;
let failed = 0;
const check = (name, ok) => { quiet(`${ok ? 'PASS' : 'FAIL'} ${name}`); if (!ok) failed++; };
for (const light of ['1', '0']) {
  process.env.BRANDIFY_LIGHT = light;
  console.log = () => {};
  let r, err;
  try { r = await extractSite('example.com'); } catch (e) { err = e; }
  console.log = quiet;
  check(`${light === '1' ? 'light' : 'full'} mode: extractSite does not throw${err ? ` (${err.message})` : ''}`, !err);
  if (r) {
    check(`${light === '1' ? 'light' : 'full'} mode: page was measured`, r.status === 'ok' && Boolean(r.typography?.body?.family) && Array.isArray(r.colors?.all));
    check(`${light === '1' ? 'light' : 'full'} mode: identity collected`, Boolean(r.identity));
  }
}
process.exit(failed ? 1 : 0);

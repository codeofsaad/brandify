// Usage: node scripts/test-extract.mjs
// Regression test for the page-measuring function: runs it on a fixed page and checks the answers.
// (An earlier version crashed on real pages and the app silently fell back to defaults.)
import { chromium } from 'playwright';
import { sampleStyles } from '../server/extract.mjs';

const html = `<body style="margin:0;font:16px sans-serif">
  <nav>${'<a href="#" class="btn-link" style="display:inline-block;padding:8px 12px;border-radius:0">Link</a>'.repeat(10)}</nav>
  <button class="cta" style="padding:12px 28px;background:#c8102e;color:#fff;border:0;border-radius:999px">Order now</button>
  <button class="cta" style="padding:12px 28px;background:#c8102e;color:#fff;border:0;border-radius:50%">Join</button>
  <button class="cta" style="padding:12px 28px;background:#fff;color:#c8102e;border:2px solid #c8102e;border-radius:9999px">Menu</button>
  <div style="margin:20px;width:300px;height:140px;border-radius:12px;box-shadow:0 2px 10px rgba(0,0,0,.1);background:#fff"></div>
  <svg width="20" height="20"><circle cx="10" cy="10" r="8" fill="#0a7cff"/></svg>
</body>`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
await page.setContent(html);
const r = await page.evaluate(sampleStyles);
await browser.close();

const checks = [
  ['measuring does not crash', Boolean(r)],
  ['finds the buttons', r.buttons.count >= 3],
  ['records per-button samples', Array.isArray(r.buttons.samples) && r.buttons.samples.length >= 3],
  ['marks the three CTAs as prominent', r.buttons.samples.filter((b) => b.prom).length === 3],
  ['marks the CTAs as pills', r.buttons.samples.filter((b) => b.prom && b.pill).length === 3],
  ['plain text links are not prominent', r.buttons.samples.filter((b) => !b.prom).length >= 10],
  ['collects every colour the page uses', Array.isArray(r.colors.all) && r.colors.all.length > 0],
  ['sees the red brand colour', r.colors.all.some((c) => c.value === 'rgb(200, 16, 46)')],
  ['finds the card and its shadow', r.cards.count >= 1 && r.cards.shadow.some((s) => s.value !== 'none')],
];
let failed = 0;
for (const [name, ok] of checks) { console.log(ok ? 'PASS' : 'FAIL', name); if (!ok) failed++; }
process.exit(failed ? 1 : 0);

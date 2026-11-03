// Usage: node scripts/test-remove-screenshot.mjs <url> [domain]
// Pulls a company, adds a reference screenshot on the Colors step, removes it, and checks the colors come back exactly.
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';

const [url, domain = 'stripe.com'] = process.argv.slice(2);
const fixture = fileURLToPath(new URL('./fixtures/dark-dashboard.png', import.meta.url));
const fixture2 = fileURLToPath(new URL('./fixtures/light-dashboard.png', import.meta.url));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.goto(url, { waitUntil: 'networkidle' });
await page.fill('.start-input', domain);
await page.click('.start-go');
await page.waitForSelector('.flow li.on .flow-t:has-text("Colors")', { timeout: 120000 });
await page.waitForTimeout(500);

const read = () => page.evaluate(() => {
  const roles = {};
  for (const r of document.querySelectorAll('.role')) roles[r.querySelector('b').textContent] = `${r.querySelector('.hex').value}/${r.querySelector('.badge')?.textContent}`;
  const pal = [...document.querySelectorAll('.pal')][0];
  roles.palette = [...pal.querySelectorAll('.pal-src')].map((x) => x.textContent).join(',');
  return roles;
});
let failed = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + extra}`); if (!ok) failed++; };
const before = await read();

const input = page.locator('input[type=file]').first();
await input.setInputFiles(fixture);
await page.waitForSelector('.thumb');
await page.waitForTimeout(800);
const withShot = await read();
check('adding a screenshot changes the primary', withShot.Primary !== before.Primary, JSON.stringify({ before: before.Primary, withShot: withShot.Primary }));

await page.locator('.thumb button').first().click();
await page.waitForTimeout(800);
const after = await read();
check('removing the only screenshot restores the primary', after.Primary === before.Primary, `${before.Primary} -> ${after.Primary}`);
check('... and the accent', after.Accent === before.Accent, `${before.Accent} -> ${after.Accent}`);
check('... and the background and text', after.Background === before.Background && after.Text === before.Text);
check('... and the chart palette sources', after.palette === before.palette, `${before.palette} -> ${after.palette}`);
check('no screenshot badges remain', !Object.values(after).some((v) => /Screenshot/.test(v)));

// two screenshots, remove one: the other still applies
await input.setInputFiles([fixture, fixture2]);
await page.waitForFunction(() => document.querySelectorAll('.thumb').length === 2);
await page.waitForTimeout(800);
await page.locator('.thumb button').nth(1).click();
await page.waitForTimeout(800);
const one = await read();
check('removing one of two keeps screenshot colors', /Screenshot/.test(one.Primary), one.Primary);
await page.locator('.thumb button').first().click();
await page.waitForTimeout(800);
const none = await read();
check('removing the last one restores again', none.Primary === before.Primary, `${before.Primary} -> ${none.Primary}`);
await browser.close();
process.exit(failed ? 1 : 0);

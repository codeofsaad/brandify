// Usage: node scripts/test-shape-layout.mjs <url> <screenshotPath> <outDir>
// Checks the Shape step: no control moves or resizes when the button corner setting changes.
import { chromium } from 'playwright';

const [url, shot, out] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(url, { waitUntil: 'networkidle' });
await page.setInputFiles('.start-card input[type=file]', shot);
await page.waitForSelector('.thumb');
await page.fill('.start-card .field input', 'Acme');
await page.click('.start-go');
await page.waitForSelector('.flow li.on .flow-t:has-text("Colors")');
await page.locator('.flow li button').nth(3).click();
await page.waitForSelector('.feel-grid');
await page.waitForTimeout(900);

const layout = () => page.evaluate(() => [...document.querySelectorAll('.ctl')].map((c) => { const r = c.getBoundingClientRect(); return [c.querySelector('.ctl-l').innerText.trim(), Math.round(r.left), Math.round(r.top + window.scrollY), Math.round(r.width), Math.round(r.height)].join(' '); }));
const states = {};
const setCorners = async (mode) => {
  if (mode === 'pill') { await page.locator('.pill-toggle input').check(); }
  else {
    if (await page.locator('.pill-toggle input').isChecked()) await page.locator('.pill-toggle input').uncheck();
    const slider = page.locator('.ctl', { hasText: 'Button corners' }).locator('input[type=range]');
    await slider.evaluate((el, v) => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }, mode === 'square' ? '0' : '12');
  }
  await page.waitForTimeout(250);
};
for (const mode of ['square', 'rounded', 'pill', 'rounded']) {
  await setCorners(mode);
  states[mode + (states[mode] ? '2' : '')] = await layout();
  if (mode === 'rounded' && !states.rounded2) await page.screenshot({ path: `${out}/9-shape-rounded.png` });
  if (mode === 'pill') await page.screenshot({ path: `${out}/10-shape-pill.png` });
}
const base = JSON.stringify(states.square);
const moved = Object.entries(states).filter(([, v]) => JSON.stringify(v) !== base).map(([k]) => k);
const pillState = await page.evaluate(() => ({ valueShown: document.querySelector('.ctl:nth-child(2) .ctl-head b').innerText, sliderDisabled: document.querySelector('.ctl:nth-child(2) input[type=range]').disabled }));
console.log(JSON.stringify({ controls: states.square, statesThatMovedAnyControl: moved, pillState, errors }, null, 1));
await browser.close();

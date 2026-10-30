// Usage: node scripts/test-color-source.mjs <url> <screenshotPath> <outDir>
// Pulls a company with a screenshot, then switches the color source back and forth.
import { chromium } from 'playwright';

const [url, shot, out] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(url, { waitUntil: 'networkidle' });
await page.fill('.start-input', 'nike');
await page.waitForSelector('.results li', { timeout: 10000 });
await page.locator('.results li button').first().click();
await page.setInputFiles('.start-card input[type=file]', shot);
await page.waitForSelector('.thumb');
await page.click('.start-go');
await page.waitForSelector('.flow li.on .flow-t:has-text("Colors")', { timeout: 90000 });
await page.waitForTimeout(900);

const read = () => page.evaluate(() => {
  const role = (n) => { const r = [...document.querySelectorAll('.role')].find((x) => x.querySelector('b').textContent === n); return [r.querySelector('.hex').value, r.querySelector('.badge')?.textContent]; };
  const pal = [...document.querySelectorAll('.pal')][0];
  return { primary: role('Primary'), accent: role('Accent'), background: role('Background'), text: role('Text'), series: [...pal.querySelectorAll('.pal-src')].map((x) => x.textContent).join(','), switchValue: document.querySelector('.color-source .seg .on')?.textContent };
});
const withShot = await read();
await page.locator('.color-source .seg button', { hasText: 'Website' }).click();
await page.waitForTimeout(500);
const website = await read();
await page.screenshot({ path: `${out}/7-website-colors.png` });
await page.locator('.color-source .seg button', { hasText: 'screenshot' }).click();
await page.waitForTimeout(500);
const back = await read();
console.log(JSON.stringify({ withShot, website, back, errors }, null, 1));
await browser.close();

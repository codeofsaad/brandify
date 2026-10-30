// Usage: node scripts/test-skip.mjs <url>   (server must be running with BRANDIFY_TEST_DELAY_MS set high)
// Starts a pull against a deliberately slow server, waits for the Skip option, uses it, and reports the outcome.
import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
await page.goto(process.argv[2], { waitUntil: 'networkidle' });
await page.fill('.search input', 'nike.com');
await page.click('.search .btn-primary');
await page.waitForSelector('.loading-card');
const t0 = Date.now();
await page.waitForTimeout(6000);
const early = { text: (await page.locator('.loading-body').innerText()).replace(/\n+/g, ' | '), skipVisible: await page.locator('.slow-hint').count() };
await page.waitForSelector('.slow-hint', { timeout: 30000 });
const appearedAfter = Math.round((Date.now() - t0) / 1000);
const hint = (await page.locator('.slow-hint').innerText()).replace(/\n+/g, ' ');
await page.click('.slow-hint .linkbtn');
await page.waitForSelector('.flow li.on .flow-t:has-text("Colors")', { timeout: 15000 });
const after = await page.evaluate(() => ({
  step: document.querySelector('.flow li.on .flow-t')?.textContent,
  primary: document.querySelector('.role .hex')?.value,
  previewShot: document.querySelector('.preview-wrap') ? 'preview present' : 'none',
}));
await page.locator('.preview-head .seg button').nth(1).click();
const shot = await page.evaluate(() => ({ src: document.querySelector('.site-shot img')?.src?.slice(0, 60), note: document.querySelector('.shot-note')?.textContent }));
await page.locator('.flow li button').nth(5).click();
await page.waitForSelector('.notes li');
const notes = await page.$$eval('.notes li', (els) => els.map((e) => e.textContent.slice(0, 110)));
console.log(JSON.stringify({ early, skipAppearedAfterSeconds: appearedAfter, hint, after, shot, notes }, null, 2));
await browser.close();

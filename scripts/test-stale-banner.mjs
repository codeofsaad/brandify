// Usage: node scripts/test-stale-banner.mjs <url>
// Loads the app, then makes /api/status report a different build and checks that the update banner appears.
import { chromium } from 'playwright';

const url = process.argv[2];
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(url, { waitUntil: 'networkidle' });
const before = await page.locator('.update-banner').count();
await page.route('**/api/status', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ build: 'a-newer-build', analysisEnabled: false }) }));
await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
await page.waitForSelector('.update-banner', { timeout: 5000 }).catch(() => {});
const after = await page.locator('.update-banner').count();
const text = after ? (await page.locator('.update-banner').innerText()).slice(0, 120) : null;
console.log(JSON.stringify({ bannerBefore: before, bannerAfter: after, text }));
await browser.close();

// Usage: node scripts/probe-site.mjs <url>
// Compares plain headless Chromium vs. a less detectable configuration on one URL.
import { chromium } from 'playwright';

const url = process.argv[2];
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function attempt(label, { stealth }) {
  const browser = await chromium.launch({ args: stealth ? ['--disable-blink-features=AutomationControlled'] : [] });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent: UA,
    locale: 'en-US',
    ...(stealth ? { extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9', 'Sec-Fetch-Site': 'none' } } : {}),
  });
  if (stealth) {
    await ctx.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
      window.chrome = window.chrome || { runtime: {} };
    });
  }
  const page = await ctx.newPage();
  let status = '?';
  try {
    const r = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    status = r?.status();
    await page.waitForTimeout(2500);
  } catch (e) {
    status = `error: ${e.message.split('\n')[0]}`;
  }
  const info = await page.evaluate(() => ({ title: document.title, textLen: document.body?.innerText.length || 0, snippet: (document.body?.innerText || '').slice(0, 80).replace(/\s+/g, ' ') }));
  console.log(label.padEnd(8), 'http', status, '| title:', info.title, '| text chars:', info.textLen, '|', info.snippet);
  await browser.close();
}

await attempt('plain', { stealth: false });
await attempt('stealth', { stealth: true });

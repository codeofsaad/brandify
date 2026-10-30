// Usage: node scripts/test-primary-sources.mjs <url> <domain>...
// Pulls each company in the real app and prints the Primary/Accent it ends up with, and where they came from.
import { chromium } from 'playwright';

const [url, ...domains] = process.argv.slice(2);
const browser = await chromium.launch();
for (const d of domains) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.fill('.start-input', d);
  await page.click('.start-go');
  try {
    await page.waitForSelector('.flow li.on .flow-t:has-text("Colors")', { timeout: 90000 });
    await page.waitForTimeout(500);
    const r = await page.evaluate(() => {
      const role = (n) => { const x = [...document.querySelectorAll('.role')].find((e) => e.querySelector('b').textContent === n); return `${x.querySelector('.hex').value} (${x.querySelector('.badge')?.textContent})`; };
      return { primary: role('Primary'), accent: role('Accent'), alt: document.querySelector('.alt')?.innerText.replace(/\n+/g, ' ') || '-' };
    });
    console.log(d.padEnd(20), 'primary', r.primary.padEnd(28), 'accent', r.accent.padEnd(28), '| alt:', r.alt);
  } catch (e) { console.log(d.padEnd(20), 'ERROR', e.message.split('\n')[0]); }
  await page.close();
}
await browser.close();

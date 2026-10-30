// Usage: node scripts/test-screenshot-flow.mjs <url> <shotsDir> <outDir>
// Drives the app: screenshot-only start, results on the Colors step, the eyedropper, and pasting a second screenshot.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const [url, dir, out] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(url, { waitUntil: 'networkidle' });

// 1) start screen, screenshot only
await page.screenshot({ path: `${out}/0-start-empty.png` });
await page.setInputFiles('.start-card input[type=file]', `${dir}/dark-dashboard.png`);
await page.waitForSelector('.thumb');
const labelBefore = await page.locator('.start-go').innerText();
const disabledBefore = await page.locator('.start-go').isDisabled();
await page.fill('.start-card .field input', 'Acme Logistics');
const labelAfter = await page.locator('.start-go').innerText();
await page.screenshot({ path: `${out}/1-start.png` });
await page.click('.start-go');
await page.waitForSelector('.flow li.on .flow-t:has-text("Colors")', { timeout: 20000 });

const read = () => page.evaluate(() => {
  const roles = {};
  document.querySelectorAll('.role').forEach((r) => { roles[r.querySelector('b').textContent] = [r.querySelector('.hex').value, r.querySelector('.badge')?.textContent]; });
  return {
    roles,
    cats: [...document.querySelectorAll('.pal')][0] ? [...[...document.querySelectorAll('.pal')][0].querySelectorAll('.pal-cell')].map((c) => (c.querySelector('.pal-src')?.textContent || '')) : [],
    tabs: [...document.querySelectorAll('.preview-head .seg button')].map((b) => b.textContent),
    chip: document.querySelector('.co-chip')?.innerText.replace(/\n+/g, ' · '),
  };
});
await page.waitForTimeout(900);
const afterStart = await read();
await page.screenshot({ path: `${out}/2-colors.png` });

// 2) eyedropper: pick Accent from a teal bar in the screenshot
await page.locator('.role', { hasText: 'Accent' }).locator('.pick').click();
await page.waitForSelector('.pick-banner');
const img = page.locator('.site-shot img').first();
const box = await img.boundingBox();
await page.mouse.click(box.x + box.width * (212 / 1200), box.y + box.height * (500 / 720)); // second bar = teal
await page.waitForTimeout(400);
const afterPick = await read();
await page.screenshot({ path: `${out}/3-picked.png` });

// 3) paste a second screenshot on the Colors step (Cmd/Ctrl+V)
const b64 = readFileSync(`${dir}/light-dashboard.png`).toString('base64');
await page.evaluate(async (b64) => {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const file = new File([bytes], 'pasted.png', { type: 'image/png' });
  const dt = new DataTransfer(); dt.items.add(file);
  window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
}, b64);
await page.waitForTimeout(1500);
const afterPaste = await read();
const thumbs = await page.locator('.ref-shortcut .thumb').count();
await page.waitForTimeout(600);
await page.screenshot({ path: `${out}/4-two-shots.png` });

console.log(JSON.stringify({ start: { labelBefore, disabledBefore, labelAfter }, afterStart, afterPick: { accent: afterPick.roles.Accent }, afterPaste: { thumbs, tabs: afterPaste.tabs, primary: afterPaste.roles.Primary, background: afterPaste.roles.Background, text: afterPaste.roles.Text, cats: afterPaste.cats }, errors }, null, 1));
await browser.close();

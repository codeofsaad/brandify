// Usage: node scripts/test-select-then-shot.mjs <url> <screenshotPath> <outDir>
// Search a company, click the suggestion, make sure nothing loads yet, add a screenshot, then press Continue.
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
await page.waitForTimeout(1500);
const afterClick = await page.evaluate(() => ({
  step: document.querySelector('.flow li.on .flow-t')?.textContent,
  loading: !!document.querySelector('.loading-card'),
  picked: document.querySelector('.picked')?.innerText.replace(/\n+/g, ' · '),
  suggestionsStillShown: document.querySelectorAll('.results li').length,
  hint: document.querySelector('.picked-hint')?.innerText,
  button: document.querySelector('.start-go')?.innerText,
  inputValue: document.querySelector('.start-input')?.value,
}));
await page.screenshot({ path: `${out}/5-selected.png` });

await page.setInputFiles('.start-card input[type=file]', shot);
await page.waitForSelector('.thumb');
const labelWithShot = await page.locator('.start-go').innerText();
await page.screenshot({ path: `${out}/6-selected-plus-shot.png` });

// typing a different name after choosing must drop the selection
await page.fill('.start-input', 'nikex');
const clearedOnEdit = (await page.locator('.picked').count()) === 0;
await page.fill('.start-input', 'nike');
await page.waitForSelector('.results li');
await page.locator('.results li button').first().click();

await page.click('.start-go');
await page.waitForSelector('.flow li.on .flow-t:has-text("Colors")', { timeout: 90000 });
await page.waitForTimeout(800);
const final = await page.evaluate(() => ({
  chip: document.querySelector('.co-chip')?.innerText.replace(/\n+/g, ' · '),
  primary: [document.querySelector('.role .hex')?.value, document.querySelector('.role .badge')?.textContent],
  tabs: [...document.querySelectorAll('.preview-head .seg button')].map((b) => b.textContent),
}));
console.log(JSON.stringify({ afterClick, labelWithShot, clearedOnEdit, final, errors }, null, 1));
await browser.close();

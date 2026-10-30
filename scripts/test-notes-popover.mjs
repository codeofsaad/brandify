// Usage: node scripts/test-notes-popover.mjs <url> <screenshotPath> <outDir>
// Company + screenshot through to the Review step: the warnings must be hidden behind a hover chip.
import { chromium } from 'playwright';

const [url, shot, out] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
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
await page.locator('.flow li button').nth(5).click();
await page.waitForSelector('.notes-chip');
await page.waitForTimeout(800);

const state = () => page.evaluate(() => {
  const pop = document.querySelector('.notes-pop');
  return { popoverVisible: pop ? getComputedStyle(pop).display !== 'none' : false };
});
const before = await state();
const legacyListVisible = (await page.locator('ul.notes').count()) > 0;
const chipText = await page.locator('.notes-chip').innerText();
await page.screenshot({ path: `${out}/11-review-collapsed.png` });
await page.locator('.notes-chip').hover();
await page.waitForTimeout(300);
const hovered = await state();
const notes = await page.locator('.notes-pop li').allInnerTexts();
await page.screenshot({ path: `${out}/12-review-hover.png` });
await page.mouse.move(5, 5);
await page.waitForTimeout(300);
const after = await state();
// keyboard: focus opens it too
await page.locator('.notes-chip').focus();
const focused = await state();
console.log(JSON.stringify({ chipText, legacyListVisible, popoverBeforeHover: before.popoverVisible, popoverOnHover: hovered.popoverVisible, popoverAfterLeaving: after.popoverVisible, popoverOnKeyboardFocus: focused.popoverVisible, notes, errors }, null, 1));
await browser.close();

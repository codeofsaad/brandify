// Usage: node scripts/smoke.mjs [url]
// Loads the running app in headless Chromium and reports render state and console errors.
import { chromium } from 'playwright';

const url = process.argv[2] || 'http://localhost:5173/';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()}`));
await page.goto(url, { waitUntil: 'networkidle' });
const state = await page.evaluate(() => ({
  title: document.title,
  h1: document.querySelector('h1')?.textContent,
  steps: document.querySelectorAll('.flow li').length,
  input: document.querySelector('.search input')?.placeholder,
  bar: Boolean(document.querySelector('.bar')),
}));
console.log(JSON.stringify(state));
console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'no console errors');
await browser.close();

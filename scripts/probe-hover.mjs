// Usage: node scripts/probe-hover.mjs <url> [query]
// Types a query, hovers the first search result, and records what changes on the page for ~3s.
import { chromium } from 'playwright';

const url = process.argv[2];
const query = process.argv[3] || 'samsung';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await page.goto(url, { waitUntil: 'networkidle' });
await page.locator('.search input').click();
await page.keyboard.type(query, { delay: 120 });
await page.waitForSelector('.results li', { timeout: 8000 });
await page.waitForTimeout(1200); // let the list settle

const box = await page.locator('.results li').first().boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 8 });

const report = await page.evaluate(() => new Promise((resolve) => {
  const btn = document.querySelector('.results li button');
  const img = btn.querySelector('img');
  const samples = [];
  const shifts = [];
  new PerformanceObserver((l) => l.getEntries().forEach((e) => shifts.push(Math.round(e.value * 1000) / 1000))).observe({ type: 'layout-shift', buffered: false });
  let mutations = 0;
  new MutationObserver((r) => (mutations += r.length)).observe(document.body, { subtree: true, childList: true, attributes: true });
  const t0 = performance.now();
  const tick = () => {
    const r = btn.getBoundingClientRect();
    samples.push({
      t: Math.round(performance.now() - t0),
      bg: getComputedStyle(btn).backgroundColor,
      hovered: btn.matches(':hover'),
      top: Math.round(r.top * 10) / 10,
      anims: document.getAnimations().filter((a) => a.playState === 'running').length,
      imgComplete: img?.complete,
      imgSrc: img?.currentSrc?.slice(-30),
    });
    if (performance.now() - t0 < 3000) requestAnimationFrame(tick);
    else {
      const uniq = (k) => [...new Set(samples.map((s) => s[k]))];
      const flips = samples.filter((s, i) => i && s.hovered !== samples[i - 1].hovered).length;
      resolve({
        frames: samples.length,
        hoverStateFlips: flips,
        backgrounds: uniq('bg'),
        topPositions: uniq('top'),
        maxRunningAnimations: Math.max(...samples.map((s) => s.anims)),
        imageSrcVariants: uniq('imgSrc').length,
        imageIncomplete: samples.some((s) => s.imgComplete === false),
        layoutShifts: shifts,
        domMutations: mutations,
      });
    }
  };
  requestAnimationFrame(tick);
}));
console.log(JSON.stringify(report, null, 2));
await browser.close();

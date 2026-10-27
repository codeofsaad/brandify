// Loads a company site in headless Chromium and samples computed styles.
// Returns raw tallies; interpretation happens in src/lib/synthesize.js.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { assertPublicUrl } from './security.mjs';

const OUT_ROOT = fileURLToPath(new URL('../out/', import.meta.url));

export function siteUrl(input) {
  if (input.startsWith('http')) return input;
  return `https://www.${input.replace(/^www\./, '')}`;
}

export async function extractSite(input) {
  const url = siteUrl(input);
  await assertPublicUrl(url); // refuse localhost / private network targets
  const domain = new URL(url).hostname.replace(/^www\./, '');
  const dir = `${OUT_ROOT}${domain}/`;
  mkdirSync(dir, { recursive: true });

  // Containers (Heroku, Docker) usually can't use Chromium's user-namespace sandbox.
  const hosted = process.env.NODE_ENV === 'production' || process.env.BRANDIFY_NO_SANDBOX === '1';
  const browser = await chromium.launch({ args: hosted ? ['--no-sandbox', '--disable-dev-shm-usage'] : [] });
  try {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    });
    // Every request the page makes (including redirects and subresources) must target a public host.
    await ctx.route('**/*', async (route) => {
      try {
        const u = new URL(route.request().url());
        if (u.protocol === 'data:' || u.protocol === 'blob:' || u.protocol === 'about:') return route.continue();
        await assertPublicUrl(u.href);
        return route.continue();
      } catch {
        return route.abort('blockedbyclient');
      }
    });
    const page = await ctx.newPage();

    let status = 'ok';
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(2500);
      for (const name of [/accept all/i, /accept/i, /agree/i, /got it/i]) {
        const btn = page.getByRole('button', { name }).first();
        if (await btn.isVisible().catch(() => false)) {
          await btn.click({ timeout: 2000 }).catch(() => {});
          break;
        }
      }
      await page.waitForTimeout(800);
    } catch (e) {
      status = `navigation problem: ${e.message.split('\n')[0]}`;
    }

    await page.screenshot({ path: `${dir}home.png` });
    const style = await page.evaluate(sampleStyles);
    const result = { url, domain, status, screenshot: `/out/${domain}/home.png`, ...style };
    writeFileSync(`${dir}style.json`, JSON.stringify(result, null, 2));
    return result;
  } finally {
    await browser.close();
  }
}

// Runs inside the page.
function sampleStyles() {
  const px = (v) => (v ? parseFloat(v) : 0);
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 4 && r.height > 4 && cs.visibility !== 'hidden' && cs.display !== 'none';
  };
  const tally = (arr) => {
    const m = new Map();
    for (const v of arr) if (v != null && v !== '') m.set(v, (m.get(v) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([value, count]) => ({ value, count }));
  };
  const all = [...document.querySelectorAll('body *')].filter(visible).slice(0, 4000);

  const buttons = all.filter(
    (el) =>
      el.matches('button, a[role=button], input[type=submit], [class*=btn], [class*=button], [class*=cta]') &&
      el.textContent.trim().length > 0 &&
      el.textContent.trim().length < 40,
  );
  const btn = buttons.map((el) => {
    const cs = getComputedStyle(el);
    return {
      radius: cs.borderTopLeftRadius,
      bg: cs.backgroundColor,
      color: cs.color,
      border: `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}`,
      textTransform: cs.textTransform,
      fontWeight: cs.fontWeight,
      letterSpacing: cs.letterSpacing,
    };
  });

  const cards = all.filter((el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 160 || r.height < 100 || r.width > 900) return false;
    const cs = getComputedStyle(el);
    return cs.boxShadow !== 'none' || px(cs.borderTopWidth) > 0 || px(cs.borderTopLeftRadius) > 0;
  });
  const card = cards.slice(0, 60).map((el) => {
    const cs = getComputedStyle(el);
    return { radius: cs.borderTopLeftRadius, shadow: cs.boxShadow, border: `${cs.borderTopWidth} ${cs.borderTopColor}`, bg: cs.backgroundColor };
  });

  const typography = {};
  for (const sel of ['h1', 'h2', 'h3', 'p', 'nav a', 'body']) {
    const el = [...document.querySelectorAll(sel)].find(visible);
    if (!el) continue;
    const cs = getComputedStyle(el);
    typography[sel] = {
      family: cs.fontFamily,
      size: cs.fontSize,
      weight: cs.fontWeight,
      letterSpacing: cs.letterSpacing,
      textTransform: cs.textTransform,
      color: cs.color,
      sample: el.textContent.trim().slice(0, 60),
    };
  }

  const bodyW = document.documentElement.clientWidth;
  const sections = [...document.querySelectorAll('section, main > div')].filter(visible).slice(0, 20);
  return {
    title: document.title,
    buttons: {
      count: btn.length,
      radius: tally(btn.map((b) => b.radius)),
      bg: tally(btn.map((b) => b.bg)),
      color: tally(btn.map((b) => b.color)),
      border: tally(btn.map((b) => b.border)),
      textTransform: tally(btn.map((b) => b.textTransform)),
      fontWeight: tally(btn.map((b) => b.fontWeight)),
      letterSpacing: tally(btn.map((b) => b.letterSpacing)),
    },
    cards: { count: cards.length, radius: tally(card.map((c) => c.radius)), shadow: tally(card.map((c) => c.shadow)), border: tally(card.map((c) => c.border)), bg: tally(card.map((c) => c.bg)) },
    typography,
    colors: {
      backgrounds: tally(all.map((el) => getComputedStyle(el).backgroundColor).filter((c) => c !== 'rgba(0, 0, 0, 0)')),
      text: tally(all.map((el) => getComputedStyle(el).color)),
      links: tally([...document.querySelectorAll('a')].filter(visible).map((a) => getComputedStyle(a).color)),
    },
    spacing: {
      sectionPaddingTop: tally(sections.map((s) => getComputedStyle(s).paddingTop)),
      containerWidths: tally(all.filter((el) => { const w = el.getBoundingClientRect().width; return w > 600 && w < bodyW - 10; }).map((el) => Math.round(el.getBoundingClientRect().width))),
    },
  };
}

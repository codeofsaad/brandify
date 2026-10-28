// Loads a company site in headless Chromium and samples computed styles.
// Returns raw tallies; interpretation happens in src/lib/synthesize.js.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { assertPublicUrl } from './security.mjs';

const OUT_ROOT = fileURLToPath(new URL('../out/', import.meta.url));

// Step-by-step timing in the app log, so a slow or stuck analysis can be diagnosed from `heroku logs`.
function memSnapshot() {
  const mb = (n) => `${Math.round(n / 1048576)}MB`;
  let cg = '';
  try {
    cg = ` cgroup=${mb(Number(readFileSync('/sys/fs/cgroup/memory.current', 'utf8')))}/${(readFileSync('/sys/fs/cgroup/memory.max', 'utf8').trim())}`;
  } catch {}
  return `rss=${mb(process.memoryUsage().rss)}${cg}`;
}
function makeLog(label) {
  const t0 = Date.now();
  return (msg) => console.log(`[site ${label}] +${((Date.now() - t0) / 1000).toFixed(1)}s ${msg} (${memSnapshot()})`);
}

// On Heroku (Linux, buildpack stack) there are no system browser libraries, so use the self-contained
// Chromium from @sparticuz/chromium. Locally (macOS) use the Chromium that `playwright install` fetched.
async function launchBrowser(log = () => {}) {
  const hosted = process.env.NODE_ENV === 'production' || process.env.BRANDIFY_HOSTED === '1' || Boolean(process.env.DYNO) || process.env.BRANDIFY_NO_SANDBOX === '1';
  if (hosted && process.platform === 'linux' && process.env.BRANDIFY_CHROMIUM !== 'system') {
    const { default: bundled } = await import('@sparticuz/chromium');
    log('preparing bundled Chromium');
    const executablePath = await bundled.executablePath();
    log(`Chromium ready at ${executablePath}`);
    return chromium.launch({
      executablePath,
      args: [...bundled.args, '--no-sandbox', '--disable-dev-shm-usage'],
      timeout: 45000,
    });
  }
  // Containers usually can't use Chromium's user-namespace sandbox.
  return chromium.launch({ args: hosted ? ['--no-sandbox', '--disable-dev-shm-usage'] : [] });
}

// Light mode (default on hosted small dynos): skip images/video/fonts and slow page-interaction steps, and skip the live
// screenshot (Brandfetch's saved screenshot is used instead). Computed styles do not need those resources.
const isLight = () => process.env.BRANDIFY_LIGHT === '1' || (process.env.BRANDIFY_LIGHT !== '0' && (process.env.NODE_ENV === 'production' || process.env.BRANDIFY_HOSTED === '1' || Boolean(process.env.DYNO)));

export function siteUrl(input) {
  if (input.startsWith('http')) return input;
  return `https://www.${input.replace(/^www\./, '')}`;
}

export async function extractSite(input) {
  const url = siteUrl(input);
  const log = makeLog(new URL(url).hostname);
  const light = isLight();
  log(`start (${light ? 'light' : 'full'} mode)`);
  await assertPublicUrl(url); // refuse localhost / private network targets
  log('url allowed');
  const domain = new URL(url).hostname.replace(/^www\./, '');
  const dir = `${OUT_ROOT}${domain}/`;
  mkdirSync(dir, { recursive: true });

  const browser = await launchBrowser(log);
  log('browser launched');
  // Hard stop: closing the browser makes every pending step reject, so a stuck page can never hang the job.
  const deadline = setTimeout(() => {
    log('deadline reached (80s); closing browser');
    browser.close().catch(() => {});
  }, 80000);
  try {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    });
    // Every request the page makes (including redirects and subresources) must target a public host.
    await ctx.route('**/*', async (route) => {
      try {
        if (light && ['image', 'media', 'font', 'websocket', 'eventsource'].includes(route.request().resourceType())) return route.abort();
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
    let httpStatus = 0;
    try {
      log('navigating');
      const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      httpStatus = resp?.status() ?? 0;
      log(`loaded, http ${httpStatus}`);
      await page.waitForLoadState('networkidle', { timeout: light ? 4000 : 15000 }).catch(() => {});
      log('settled');
      await page.waitForTimeout(light ? 800 : 2500);
      if (!light) {
        // Role-based lookups are expensive on heavy pages, so the cookie-banner click is skipped in light mode.
        for (const name of [/accept all/i, /accept/i, /agree/i, /got it/i]) {
          const btn = page.getByRole('button', { name }).first();
          if (await btn.isVisible().catch(() => false)) {
            await btn.click({ timeout: 2000 }).catch(() => {});
            break;
          }
        }
        await page.waitForTimeout(800);
      }
      log('ready to measure');
    } catch (e) {
      status = `navigation problem: ${e.message.split('\n')[0]}`;
      log(status);
    }

    // Many large sites refuse automated browsers and serve an error page. Never measure or screenshot that page.
    const blockReason = await detectBlock(page, httpStatus);
    if (blockReason) {
      const result = { url, domain, status: 'blocked', blocked: true, httpStatus, reason: blockReason };
      writeFileSync(`${dir}style.json`, JSON.stringify(result, null, 2));
      return result;
    }

    log(light ? 'measuring styles (no live screenshot in light mode)' : 'taking screenshot and measuring styles');
    if (!light) await page.screenshot({ path: `${dir}home.png` });
    const style = await page.evaluate(sampleStyles);
    log('done');
    const result = { url, domain, status, screenshot: light ? null : `/out/${domain}/home.png`, ...style };
    writeFileSync(`${dir}style.json`, JSON.stringify(result, null, 2));
    return result;
  } finally {
    clearTimeout(deadline);
    await browser.close().catch(() => {});
  }
}

const BLOCK_RE = /access denied|forbidden|request blocked|captcha|are you (a )?robot|verify you are (a )?human|unusual traffic|attention required|just a moment|pardon our interruption|security check/i;

async function detectBlock(page, httpStatus) {
  const probe = await page.evaluate(() => ({ title: document.title || '', text: (document.body?.innerText || '').trim() })).catch(() => ({ title: '', text: '' }));
  const looksBlocked = BLOCK_RE.test(`${probe.title} ${probe.text.slice(0, 400)}`) && probe.text.length < 1500;
  if (httpStatus >= 400 && (looksBlocked || probe.text.length < 800)) return `The site returned HTTP ${httpStatus} to an automated browser.`;
  if (looksBlocked) return 'The site showed a bot-protection page to an automated browser.';
  if (probe.text.length < 40) return 'The page was empty when loaded by an automated browser.';
  return null;
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

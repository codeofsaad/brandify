import express from 'express';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { extractSite } from './extract.mjs';
import { requirePassword, rateLimit } from './security.mjs';
import { harvestIdentity, findViaHttp } from './identity.mjs';
import { iconFor } from './icons.mjs';

// The Fir Node buildpack does not set NODE_ENV at runtime, so hosting is detected explicitly:
// BRANDIFY_HOSTED=1 (set as a config var), NODE_ENV=production, or Heroku's DYNO variable.
const PRODUCTION = process.env.NODE_ENV === 'production' || process.env.BRANDIFY_HOSTED === '1' || Boolean(process.env.DYNO);
// In production the platform assigns PORT; in dev PORT may belong to other tools, so use a dedicated variable.
const PORT = PRODUCTION ? process.env.PORT || 8080 : process.env.BRANDIFY_API_PORT || 5174;
const PASSWORD = process.env.BRANDIFY_PASSWORD || '';
// BRANDIFY_AUTH=sso means the platform already authenticates every visitor (Heroku internal space behind Okta SSO).
const SSO = process.env.BRANDIFY_AUTH === 'sso';
if (PRODUCTION && !PASSWORD && !SSO) {
  console.error('Refusing to start in production without BRANDIFY_PASSWORD (or BRANDIFY_AUTH=sso when the platform enforces SSO).');
  process.exit(1);
}
const API_KEY = process.env.BRANDFETCH_API_KEY || '';
const CLIENT_ID = process.env.BRANDFETCH_CLIENT_ID || '';

const fixtures = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/brands.json', import.meta.url)), 'utf8'));

const app = express();
app.set('trust proxy', 1); // behind Heroku's router, so req.ip is the real client
app.disable('x-powered-by');
app.set('etag', false);
if (PASSWORD) app.use(requirePassword(PASSWORD));
app.use(express.json({ limit: '100kb' }));
app.use(['/api/search', '/api/logo'], rateLimit({ windowMs: 60 * 1000, max: 60 }));
// Only the expensive POSTs are limited; job polling (GET /api/site/job/:id) must not count.
app.use(['/api/brand', '/api/site/start'], rateLimit({ windowMs: 15 * 60 * 1000, max: 40 }));
const DOMAIN_RE = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;
// Screenshots are overwritten on every pull under the same URL, so the browser must never cache them.
app.use('/out', express.static(fileURLToPath(new URL('../out/', import.meta.url)), { setHeaders: (res) => res.set('Cache-Control', 'no-store') }));

const cleanDomain = (v) =>
  String(v || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split(/[/?#]/)[0];


// Identifies the deployed web app so an already-open browser tab can tell it is out of date (set once dist is read).
let BUILD_ID = 'dev';

app.get('/api/status', (_req, res) => {
  res.json({
    build: BUILD_ID,
    brandfetchKey: Boolean(API_KEY),
    searchEnabled: Boolean(CLIENT_ID),
    demoBrands: Object.keys(fixtures),
  });
});

// Company name -> candidate brands. Uses Brandfetch Brand Search when a client id is set.
app.get('/api/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json([]);
  const local = Object.values(fixtures)
    .filter((b) => b.name.toLowerCase().includes(q.toLowerCase()) || b.domain.includes(q.toLowerCase()))
    .map((b) => ({ name: b.name, domain: b.domain, icon: b.logos.find((l) => l.type === 'icon')?.formats[0]?.src, demo: true }));
  if (!CLIENT_ID) {
    const looksLikeDomain = q.includes('.');
    return res.json(looksLikeDomain && !local.length ? [{ name: cleanDomain(q), domain: cleanDomain(q) }] : local);
  }
  try {
    const r = await fetch(`https://api.brandfetch.io/v2/search/${encodeURIComponent(q)}?c=${CLIENT_ID}`);
    const list = r.ok ? await r.json() : [];
    res.json(list.slice(0, 6).map((b) => ({ name: b.name, domain: b.domain, icon: b.icon })));
  } catch {
    res.json(local);
  }
});

// Brandfetch charges a credit per brand lookup, so a successful answer is kept for a week and repeat pulls are free.
const BRAND_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const BRAND_CACHE_MAX = 300;
const brandCache = new Map(); // domain -> { brand, at }

// Once Brandfetch says the credits are gone, stop asking for a while: every pull would just fail first. Retried hourly,
// and a restart (for example after swapping in a new key) clears it. BRANDFETCH_DISABLED=1 skips Brandfetch entirely.
const CREDITS_RETRY_MS = 60 * 60 * 1000;
let creditsOutUntil = process.env.BRANDFETCH_DISABLED === '1' ? Infinity : 0;
const noCredits = () => Object.assign(new Error('Brandfetch has no API credits left, so the name, logo and colors are read from the company website instead.'), { status: 503, code: 'no_credits' });

async function brandfetchError(r, domain) {
  const body = await r.json().catch(() => ({}));
  if (body.error === 'no_api_credits') {
    creditsOutUntil = Date.now() + CREDITS_RETRY_MS;
    console.log('Brandfetch reports no API credits; using the website fallback for the next hour');
    return noCredits();
  }
  if (r.status === 404) return Object.assign(new Error(`Brandfetch has no brand data for ${domain}. Check the spelling, or upload a screenshot or logo instead.`), { status: 404, code: 'not_found' });
  if (r.status === 429) return Object.assign(new Error('Brandfetch is rate limiting requests. Wait a minute and try again.'), { status: 429, code: 'rate_limited' });
  return Object.assign(new Error(`Brandfetch returned ${r.status} for ${domain}`), { status: r.status });
}

async function fetchBrand(domain) {
  const hit = brandCache.get(domain);
  if (hit && Date.now() - hit.at < BRAND_TTL_MS) return { brand: hit.brand, demo: false };
  if (API_KEY && Date.now() < creditsOutUntil && !fixtures[domain]) throw noCredits();
  if (API_KEY && Date.now() >= creditsOutUntil) {
    const r = await fetch(`https://api.brandfetch.io/v2/brands/${domain}`, { headers: { Authorization: `Bearer ${API_KEY}` } });
    if (r.ok) {
      const brand = await r.json();
      if (brandCache.size >= BRAND_CACHE_MAX) brandCache.delete(brandCache.keys().next().value);
      brandCache.set(domain, { brand, at: Date.now() });
      return { brand, demo: false };
    }
    if (!fixtures[domain]) throw await brandfetchError(r, domain);
  }
  if (fixtures[domain]) return { brand: fixtures[domain], demo: true };
  throw Object.assign(new Error('No Brandfetch API key is set and no demo data exists for this company. Add BRANDFETCH_API_KEY to .env.'), { status: 401, code: 'no_key' });
}

// When a site blocks automated browsers, use Brandfetch's own screenshot so the preview still has something real.
async function fallbackScreenshot(url, domain) {
  if (!url || !/^https:\/\/cdn\.brandfetch\.io\//.test(url)) return null;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 8 * 1024 * 1024) return null;
    const dir = fileURLToPath(new URL(`../out/${domain}/`, import.meta.url));
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${dir}home.png`, buf);
    return `/out/${domain}/home.png`;
  } catch {
    return null;
  }
}

// Downloads a logo so the browser can embed it in the design file. Only Brandfetch's CDN is allowed, so this cannot be
// pointed at other hosts. The sandbox CSP stops any script inside an SVG from running if someone opens it directly.
app.get('/api/logo', async (req, res) => {
  let u;
  try {
    u = new URL(String(req.query.url || ''));
  } catch {
    return res.status(400).json({ error: 'Invalid logo address.' });
  }
  if (u.protocol !== 'https:' || u.hostname !== 'cdn.brandfetch.io') return res.status(400).json({ error: 'Only Brandfetch logo addresses are allowed.' });
  try {
    const r = await fetch(u.href, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) return res.status(502).json({ error: `The logo could not be downloaded (${r.status}).` });
    const type = (r.headers.get('content-type') || '').split(';')[0];
    if (!/^image\/(svg\+xml|png|jpeg|webp)$/.test(type)) return res.status(502).json({ error: 'Unexpected logo file type.' });
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 2 * 1024 * 1024) return res.status(502).json({ error: 'The logo file is too large.' });
    res
      .set({ 'Content-Type': type, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'" })
      .send(buf);
  } catch (e) {
    res.status(502).json({ error: `The logo could not be downloaded: ${e.message}` });
  }
});

// Brandfetch identity data only. This returns quickly; the slow website analysis runs as a background job below,
// because Heroku's router drops any request that takes longer than 30 seconds.
app.post('/api/brand', async (req, res) => {
  const domain = cleanDomain(req.body?.domain);
  if (!domain || !DOMAIN_RE.test(domain) || domain.length > 253) return res.status(400).json({ error: 'Enter a valid company name or domain.' });
  try {
    const { brand, demo } = await fetchBrand(domain);
    res.json({ brand, demo });
  } catch (e) {
    // Brandfetch could not answer (no credits, unknown brand, rate limit, outage). Hand back an empty brand and say why,
    // so the app can read the name, logo and colours from the company's own website instead.
    const label = domain.split('.')[0].replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    console.log(`[brand ${domain}] Brandfetch unavailable (${e.code || e.status}); using the website instead`);
    res.json({
      brand: { name: label, domain, description: '', colors: [], fonts: [], logos: [] },
      demo: false,
      icon: await iconFor(domain),
      fallback: { code: e.code || 'unavailable', message: e.message },
    });
  }
});

// ----- background website-analysis jobs -----
const jobs = new Map(); // id -> { status: 'queued' | 'running' | 'done' | 'error', result?, error?, at }
let queue = Promise.resolve(); // one browser at a time: Chromium is heavy and dynos are small
const JOB_TTL_MS = 15 * 60 * 1000;
const JOB_TIMEOUT_MS = 70 * 1000;
setInterval(() => {
  for (const [id, j] of jobs) if (Date.now() - j.at > JOB_TTL_MS) jobs.delete(id);
}, 60 * 1000).unref();

const withTimeout = (promise, ms, message) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms).unref())]);

async function analyzeSite({ input, domain, screenshotUrl, wantIdentity = false }) {
  if (Number(process.env.BRANDIFY_TEST_DELAY_MS) > 0) await new Promise((r) => setTimeout(r, Number(process.env.BRANDIFY_TEST_DELAY_MS))); // testing only
  let site = null;
  let siteError = null;
  try {
    const r = await withTimeout(extractSite(input), JOB_TIMEOUT_MS, 'The website took too long to analyze');
    if (r.blocked) siteError = r.reason;
    else site = r;
  } catch (e) {
    siteError = e.message;
  }
  // Without Brandfetch the website supplies the name, description and logos. A page that refused the browser is read
  // over plain HTTP instead (many sites block automation but still serve their icons).
  let identity = null;
  if (wantIdentity) {
    try {
      const fromPage = site?.identity?.candidates?.length ? await withTimeout(harvestIdentity(site.identity, domain), 15000, 'logo download timed out') : null;
      identity = fromPage?.logos.length ? fromPage : null;
      if (!identity) {
        const viaHttp = await withTimeout(harvestIdentity(await findViaHttp(domain), domain), 20000, 'logo download timed out');
        identity = { name: fromPage?.name || viaHttp.name, description: fromPage?.description || viaHttp.description, logos: viaHttp.logos };
      }
    } catch (e) {
      console.log(`[identity ${domain}] ${e.message}`);
    }
  }
  const icon = wantIdentity ? await iconFor(domain, identity?.name) : null; // matched on the site's own name as well as the domain
  if (site) delete site.identity; // raw candidates (including SVG markup) are not needed by the browser
  // Nothing measured from a blocked or failed page is trustworthy; fall back to Brandfetch's screenshot.
  const live = site?.screenshot || null;
  const fallback = live ? null : await fallbackScreenshot(screenshotUrl, domain);
  const screenshot = live || fallback;
  return {
    site,
    siteError,
    identity,
    icon,
    screenshot: screenshot ? `${screenshot}?v=${Date.now()}` : null,
    screenshotSource: screenshot ? (live ? 'live' : 'brandfetch') : null,
  };
}

app.post('/api/site/start', (req, res) => {
  const rawUrl = String(req.body?.url || '').trim();
  const domain = rawUrl ? cleanDomain(rawUrl) : cleanDomain(req.body?.domain);
  if (!domain || !DOMAIN_RE.test(domain) || domain.length > 253) return res.status(400).json({ error: 'Enter a valid website.' });
  const id = randomUUID();
  const job = { status: 'queued', at: Date.now() };
  jobs.set(id, job);
  const input = rawUrl || domain;
  queue = queue.then(async () => {
    job.status = 'running';
    const t0 = Date.now();
    console.log(`[job ${id.slice(0, 8)}] start ${domain}`);
    try {
      job.result = await analyzeSite({ input, domain, screenshotUrl: req.body?.screenshotUrl, wantIdentity: req.body?.identity === true });
      job.status = 'done';
      console.log(`[job ${id.slice(0, 8)}] done in ${((Date.now() - t0) / 1000).toFixed(1)}s: ${job.result.site ? 'measured site' : `no site (${job.result.siteError})`}`);
    } catch (e) {
      job.error = e.message;
      job.status = 'error';
      console.log(`[job ${id.slice(0, 8)}] error after ${((Date.now() - t0) / 1000).toFixed(1)}s: ${e.message}`);
    }
  });
  res.json({ jobId: id });
});

app.get('/api/site/job/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Unknown or expired job.' });
  // How many analyses are ahead of this one (jobs run one at a time).
  let ahead = 0;
  if (job.status === 'queued') for (const j of jobs.values()) if (j !== job && j.at < job.at && (j.status === 'queued' || j.status === 'running')) ahead++;
  res.json({ status: job.status, ahead, result: job.result, error: job.error });
});

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
if (existsSync(dist)) {
  // Buildpack builds stamp every file with the same fixed date, so ETag/Last-Modified (size + date) can claim a changed
  // index.html is "not modified" and browsers keep a page pointing at deleted scripts. Disable validators, never cache the
  // HTML, and cache the content-hashed assets forever.
  app.use(
    express.static(dist, {
      etag: false,
      lastModified: false,
      index: false,
      setHeaders: (res, filePath) => {
        res.set('Cache-Control', filePath.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-store');
      },
    }),
  );
  // Read the HTML once and send it from memory: no file date, no ETag, so a browser can never get a stale 304.
  const indexHtml = readFileSync(`${dist}index.html`, 'utf8');
  BUILD_ID = createHash('sha1').update(indexHtml).digest('hex').slice(0, 10);
  const sendIndex = (_req, res) => res.set('Cache-Control', 'no-store').type('html').send(indexHtml);
  app.get('/', sendIndex);
  // Single-page app: unknown routes get index.html, but a missing script/style must be a real 404, never HTML.
  app.get(/^\/(?!api\/|out\/|assets\/).*/, sendIndex);
}

// Heroku Fir spaces route over IPv6, so production binds to '::' (dual-stack) instead of IPv4 only.
const HOST = PRODUCTION ? '::' : undefined;
app.listen(PORT, HOST, () =>
  console.log(`Brandify on port ${PORT}${HOST ? ` (${HOST})` : ''}  brandfetch key: ${API_KEY ? 'yes' : 'no, demo data only'}  auth: ${PASSWORD ? 'password' : SSO ? 'sso' : 'none (dev)'}`),
);

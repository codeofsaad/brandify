import express from 'express';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { extractSite } from './extract.mjs';
import { requirePassword, rateLimit } from './security.mjs';

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
app.use(['/api/brand', '/api/site/start', '/api/analyze'], rateLimit({ windowMs: 15 * 60 * 1000, max: 40 }));
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

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';
const ANALYSIS_MODEL = process.env.BRANDIFY_ANALYSIS_MODEL || 'claude-sonnet-5-5';

// Identifies the deployed web app so an already-open browser tab can tell it is out of date (set once dist is read).
let BUILD_ID = 'dev';

app.get('/api/status', (_req, res) => {
  res.json({
    build: BUILD_ID,
    brandfetchKey: Boolean(API_KEY),
    searchEnabled: Boolean(CLIENT_ID),
    analysisEnabled: Boolean(ANTHROPIC_KEY),
    demoBrands: Object.keys(fixtures),
  });
});

const ANALYSIS_PROMPT = `You are a brand designer reviewing a screenshot of a company's homepage. Describe its visual character so that someone building a data dashboard for this company can make it feel native to the brand.

Reply with ONLY a JSON object, no prose, with these string fields:
- "mood": 4-12 words on overall mood and tone
- "imagery": one sentence on imagery style (photography, illustration, abstract, none) and how heavily it is used
- "decoration": one sentence on gradients, patterns, rules, shapes or other decorative devices, and where they appear ("none" if none)
- "rhythm": one sentence on layout density, whitespace and alignment
and an array field:
- "rules": 3-5 short imperative rules for a data dashboard (e.g. "Use a thin gradient rule above section titles, never as a chart fill"). Rules must be concrete and about charts, KPI tiles, tables, headers or color use.

Base everything on what is visible. Do not invent facts about the company.`;

// Optional: Claude looks at the site screenshot and describes the visual character.
app.post('/api/analyze', async (req, res) => {
  if (!ANTHROPIC_KEY) {
    return res.status(501).json({ error: 'Screenshot analysis is off. Add ANTHROPIC_API_KEY to .env and restart.' });
  }
  const domain = cleanDomain(req.body?.domain);
  const file = fileURLToPath(new URL(`../out/${domain}/home.png`, import.meta.url));
  if (!domain || !DOMAIN_RE.test(domain) || !existsSync(file)) return res.status(404).json({ error: 'No website screenshot is available for this company.' });
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: ANALYSIS_MODEL,
        max_tokens: 800,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: 'image/png', data: readFileSync(file).toString('base64') } },
              { type: 'text', text: ANALYSIS_PROMPT },
            ],
          },
        ],
      }),
    });
    const body = await r.json();
    if (!r.ok) return res.status(502).json({ error: body?.error?.message || `Anthropic API returned ${r.status}` });
    const text = body.content?.find((b) => b.type === 'text')?.text || '';
    const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
    const parsed = JSON.parse(json);
    res.json({
      mood: String(parsed.mood || ''),
      imagery: String(parsed.imagery || ''),
      decoration: String(parsed.decoration || ''),
      rhythm: String(parsed.rhythm || ''),
      rules: Array.isArray(parsed.rules) ? parsed.rules.map(String).slice(0, 6) : [],
    });
  } catch (e) {
    res.status(502).json({ error: `Analysis failed: ${e.message}` });
  }
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

async function fetchBrand(domain) {
  if (API_KEY) {
    const r = await fetch(`https://api.brandfetch.io/v2/brands/${domain}`, { headers: { Authorization: `Bearer ${API_KEY}` } });
    if (r.ok) return { brand: await r.json(), demo: false };
    if (!fixtures[domain]) throw Object.assign(new Error(`Brandfetch returned ${r.status} for ${domain}`), { status: r.status });
  }
  if (fixtures[domain]) return { brand: fixtures[domain], demo: true };
  throw Object.assign(new Error('No Brandfetch API key is set and no demo data exists for this company. Add BRANDFETCH_API_KEY to .env.'), { status: 401 });
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
    res.status(e.status || 502).json({ error: e.message });
  }
});

// ----- background website-analysis jobs -----
const jobs = new Map(); // id -> { status: 'queued' | 'running' | 'done' | 'error', result?, error?, at }
let queue = Promise.resolve(); // one browser at a time: Chromium is heavy and dynos are small
const JOB_TTL_MS = 15 * 60 * 1000;
const JOB_TIMEOUT_MS = 100 * 1000;
setInterval(() => {
  for (const [id, j] of jobs) if (Date.now() - j.at > JOB_TTL_MS) jobs.delete(id);
}, 60 * 1000).unref();

const withTimeout = (promise, ms, message) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms).unref())]);

async function analyzeSite({ input, domain, screenshotUrl }) {
  let site = null;
  let siteError = null;
  try {
    const r = await withTimeout(extractSite(input), JOB_TIMEOUT_MS, 'The website took too long to analyze');
    if (r.blocked) siteError = r.reason;
    else site = r;
  } catch (e) {
    siteError = e.message;
  }
  // Nothing measured from a blocked or failed page is trustworthy; fall back to Brandfetch's screenshot.
  const live = site?.screenshot || null;
  const fallback = live ? null : await fallbackScreenshot(screenshotUrl, domain);
  const screenshot = live || fallback;
  return {
    site,
    siteError,
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
      job.result = await analyzeSite({ input, domain, screenshotUrl: req.body?.screenshotUrl });
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
  res.json({ status: job.status, result: job.result, error: job.error });
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

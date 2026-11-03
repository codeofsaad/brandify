import express from 'express';
import { readFileSync, existsSync } from 'node:fs';
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
// Brandfetch's free search API (client id only) is used just to turn a typed company name into a domain.
const CLIENT_ID = process.env.BRANDFETCH_CLIENT_ID || '';

const app = express();
app.set('trust proxy', 1); // behind Heroku's router, so req.ip is the real client
app.disable('x-powered-by');
app.set('etag', false);
if (PASSWORD) app.use(requirePassword(PASSWORD));
app.use(express.json({ limit: '100kb' }));
app.use('/api/search', rateLimit({ windowMs: 60 * 1000, max: 60 }));
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
    searchEnabled: Boolean(CLIENT_ID),
  });
});

// Company name -> candidate domains. Uses Brandfetch's free search when a client id is set; otherwise type a domain.
app.get('/api/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json([]);
  if (!CLIENT_ID) return res.json(q.includes('.') ? [{ name: cleanDomain(q), domain: cleanDomain(q) }] : []);
  try {
    const r = await fetch(`https://api.brandfetch.io/v2/search/${encodeURIComponent(q)}?c=${CLIENT_ID}`);
    const list = r.ok ? await r.json() : [];
    res.json(list.slice(0, 6).map((b) => ({ name: b.name, domain: b.domain, icon: b.icon })));
  } catch {
    res.json([]);
  }
});

// A company starts as just a name and domain; the name, description and logos come from its website (the analysis job
// below) and the official brand colour from Simple Icons. This returns at once because Heroku's router drops any request
// that takes longer than 30 seconds, so the slow website analysis runs as a background job.
app.post('/api/brand', async (req, res) => {
  const domain = cleanDomain(req.body?.domain);
  if (!domain || !DOMAIN_RE.test(domain) || domain.length > 253) return res.status(400).json({ error: 'Enter a valid company name or domain.' });
  const label = domain.split('.')[0].replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  res.json({
    brand: { name: label, domain, description: '', colors: [], fonts: [], logos: [] },
    icon: await iconFor(domain),
  });
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

async function analyzeSite({ input, domain }) {
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
  // The website supplies the name, description and logos. A page that refused the browser is read over plain HTTP
  // instead (many sites block automation but still serve their icons).
  let identity = null;
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
  const icon = await iconFor(domain, identity?.name); // matched on the site's own name as well as the domain
  if (site) delete site.identity; // raw candidates (including SVG markup) are not needed by the browser
  return {
    site,
    siteError,
    identity,
    icon,
    screenshot: null,
    screenshotSource: null,
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
      job.result = await analyzeSite({ input, domain });
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
  console.log(`Brandify on port ${PORT}${HOST ? ` (${HOST})` : ''}  name search: ${CLIENT_ID ? 'yes' : 'no (type a domain)'}  auth: ${PASSWORD ? 'password' : SSO ? 'sso' : 'none (dev)'}`),
);

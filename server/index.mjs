import express from 'express';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { extractSite } from './extract.mjs';
import { requirePassword, rateLimit } from './security.mjs';

const PRODUCTION = process.env.NODE_ENV === 'production';
// In production the platform assigns PORT; in dev PORT may belong to other tools, so use a dedicated variable.
const PORT = PRODUCTION ? process.env.PORT || 8080 : process.env.BRANDIFY_API_PORT || 5174;
const PASSWORD = process.env.BRANDIFY_PASSWORD || '';
if (PRODUCTION && !PASSWORD) {
  console.error('Refusing to start in production without BRANDIFY_PASSWORD. Set it to protect the app and your API credits.');
  process.exit(1);
}
const API_KEY = process.env.BRANDFETCH_API_KEY || '';
const CLIENT_ID = process.env.BRANDFETCH_CLIENT_ID || '';

const fixtures = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/brands.json', import.meta.url)), 'utf8'));

const app = express();
app.set('trust proxy', 1); // behind Heroku's router, so req.ip is the real client
app.disable('x-powered-by');
if (PASSWORD) app.use(requirePassword(PASSWORD));
app.use(express.json({ limit: '100kb' }));
app.use('/api/search', rateLimit({ windowMs: 60 * 1000, max: 60 }));
app.use(['/api/brand', '/api/site', '/api/analyze'], rateLimit({ windowMs: 15 * 60 * 1000, max: 30 }));
const DOMAIN_RE = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;
app.use('/out', express.static(fileURLToPath(new URL('../out/', import.meta.url))));

const cleanDomain = (v) =>
  String(v || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split(/[/?#]/)[0];

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';
const ANALYSIS_MODEL = process.env.BRANDIFY_ANALYSIS_MODEL || 'claude-sonnet-5-5';

app.get('/api/status', (_req, res) => {
  res.json({
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

// Website analysis only (used by the manual entry path).
app.post('/api/site', async (req, res) => {
  const url = String(req.body?.url || '').trim();
  if (!url) return res.status(400).json({ error: 'url required' });
  try {
    res.json(await extractSite(url));
  } catch (e) {
    res.status(502).json({ error: `Could not analyze that website: ${e.message}` });
  }
});

// Brandfetch identity data + live-site style extraction, in parallel.
app.post('/api/brand', async (req, res) => {
  const domain = cleanDomain(req.body?.domain);
  if (!domain || !DOMAIN_RE.test(domain) || domain.length > 253) return res.status(400).json({ error: 'Enter a valid company name or domain.' });
  const [brandR, siteR] = await Promise.allSettled([fetchBrand(domain), extractSite(domain)]);
  if (brandR.status === 'rejected') {
    return res.status(brandR.reason.status || 502).json({ error: brandR.reason.message });
  }
  res.json({
    brand: brandR.value.brand,
    demo: brandR.value.demo,
    site: siteR.status === 'fulfilled' ? siteR.value : null,
    siteError: siteR.status === 'rejected' ? siteR.reason.message : null,
  });
});

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
if (existsSync(dist)) {
  app.use(express.static(dist));
  // Single-page app: unknown non-API routes get index.html.
  app.get(/^\/(?!api\/|out\/).*/, (_req, res) => res.sendFile(`${dist}index.html`));
}

app.listen(PORT, () => console.log(`Brandify API on http://localhost:${PORT}  (brandfetch key: ${API_KEY ? 'yes' : 'no, demo data only'})`));

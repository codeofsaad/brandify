// Brand identity taken from a company's own website: name, description and logo files.
// Everything downloaded here is fetched by the server,
// never by the browser, so every hop goes through the same public-host check as the site analysis.
import { assertPublicUrl } from './security.mjs';

const MAX_SVG = 150 * 1024;
const MAX_RASTER = 200 * 1024; // the design file embeds the logo, so larger files could not be used anyway
const MAX_HTML = 600 * 1024;
const RASTER = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico' };

// GET with manual redirects (each hop must be a public host), a size cap and a timeout.
async function safeFetch(raw, { maxBytes, timeoutMs = 8000 }) {
  let url = raw;
  for (let hop = 0; hop < 4; hop++) {
    await assertPublicUrl(url);
    const r = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', Accept: '*/*' },
    });
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
      url = new URL(r.headers.get('location'), url).href;
      continue;
    }
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const len = Number(r.headers.get('content-length') || 0);
    if (len > maxBytes) throw new Error('too large');
    const chunks = [];
    let size = 0;
    for await (const c of r.body) {
      size += c.length;
      if (size > maxBytes) throw new Error('too large');
      chunks.push(c);
    }
    return { buf: Buffer.concat(chunks), type: (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase(), url };
  }
  throw new Error('too many redirects');
}

const sniff = (buf) => {
  const head = buf.subarray(0, 12);
  if (head[0] === 0x89 && head[1] === 0x50) return 'image/png';
  if (head[0] === 0xff && head[1] === 0xd8) return 'image/jpeg';
  if (head.toString('ascii', 0, 4) === 'RIFF' && head.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (head.toString('ascii', 0, 3) === 'GIF') return 'image/gif';
  if (head[0] === 0 && head[1] === 0 && head[2] === 1 && head[3] === 0) return 'image/x-icon';
  if (/^\s*(<\?xml|<svg)/i.test(buf.subarray(0, 200).toString('utf8'))) return 'image/svg+xml';
  return '';
};

// candidate: { kind: 'logo' | 'symbol', url?, svg? } -> a logo entry with the file embedded as a data URL.
async function download(candidate, domain, i) {
  let type;
  let buf;
  if (candidate.svg) {
    buf = Buffer.from(candidate.svg, 'utf8');
    type = 'image/svg+xml';
  } else if (candidate.url.startsWith('data:image/')) {
    const m = candidate.url.match(/^data:([^;,]+)(;base64)?,(.*)$/s);
    if (!m) return null;
    type = m[1].toLowerCase();
    buf = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]), 'utf8');
  } else {
    const r = await safeFetch(candidate.url, { maxBytes: Math.max(MAX_SVG, MAX_RASTER) });
    buf = r.buf;
    type = RASTER[r.type] || r.type === 'image/svg+xml' ? r.type : sniff(buf); // servers often label icons wrongly
  }
  if (type === 'image/svg+xml') {
    if (buf.length > MAX_SVG || !/<svg[\s>]/i.test(buf.toString('utf8', 0, 2000))) return null;
    return { type: candidate.kind, theme: 'dark', formats: [{ format: 'svg', src: `data:image/svg+xml;base64,${buf.toString('base64')}` }], uploaded: false, fileName: `${domain}-${candidate.kind}-${i + 1}.svg` };
  }
  const format = RASTER[type];
  if (!format || buf.length > MAX_RASTER || buf.length < 100) return null;
  return { type: candidate.kind, theme: 'dark', formats: [{ format, src: `data:${type};base64,${buf.toString('base64')}` }], uploaded: false, fileName: `${domain}-${candidate.kind}-${i + 1}.${format}` };
}

/**
 * @param {{name?:string, description?:string, candidates:{kind:string, url?:string, svg?:string}[]}} found  what was seen on the page
 * @returns {Promise<{name:string, description:string, logos:object[]}>}
 */
export async function harvestIdentity(found, domain) {
  const seen = new Set();
  const list = (found.candidates || []).filter((c) => {
    const key = c.svg ? c.svg.slice(0, 200) : c.url;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const settled = await Promise.allSettled(list.slice(0, 6).map((c, i) => download(c, domain, i)));
  const logos = settled.map((s) => (s.status === 'fulfilled' ? s.value : null)).filter(Boolean).slice(0, 4);
  return { name: decode(found.name), description: decode(found.description), logos };
}

// ---------- when no browser could read the page (bot protection, timeouts): plain HTTP ----------

const attr = (tag, name) => tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'))?.slice(2).find((x) => x != null);
// Page source escapes text (&#x27; for an apostrophe), and some sites escape it twice, so decode until nothing changes.
const NAMED = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', reg: '®', trade: '™', copy: '©' };
const decodeOnce = (s) =>
  s.replace(/&(?:#x([0-9a-f]+)|#(\d+)|([a-z]+));/gi, (m, hex, dec, name) => {
    if (name) return NAMED[name.toLowerCase()] ?? m;
    const code = hex ? parseInt(hex, 16) : parseInt(dec, 10);
    return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
  });
export function decode(s) {
  let out = String(s || '');
  for (let i = 0; i < 3; i++) {
    const next = decodeOnce(out);
    if (next === out) break;
    out = next;
  }
  return out.trim();
}

export async function findViaHttp(domain) {
  const found = { name: '', description: '', candidates: [] };
  let base = `https://www.${domain}/`;
  try {
    const page = await safeFetch(base, { maxBytes: MAX_HTML, timeoutMs: 8000 });
    base = page.url;
    const html = page.buf.toString('utf8');
    const icons = [];
    for (const tag of html.match(/<(meta|link)\b[^>]*>/gi) || []) {
      if (/^<meta/i.test(tag)) {
        const key = (attr(tag, 'property') || attr(tag, 'name') || '').toLowerCase();
        const content = decode(attr(tag, 'content'));
        if (key === 'og:site_name' || key === 'application-name') found.name ||= content;
        if (key === 'description' || key === 'og:description') found.description ||= content;
      } else {
        const rel = (attr(tag, 'rel') || '').toLowerCase();
        const href = decode(attr(tag, 'href'));
        if (href && /\bapple-touch-icon\b/.test(rel)) icons.unshift(href);
        else if (href && /\bicon\b/.test(rel)) icons.push(href);
      }
    }
    for (const href of icons.slice(0, 3)) {
      try {
        found.candidates.push({ kind: 'symbol', url: new URL(href, base).href });
      } catch {}
    }
  } catch {
    /* the page itself is unreachable; try the standard icon locations below */
  }
  if (!found.candidates.length) {
    for (const p of ['/apple-touch-icon.png', '/favicon.ico']) found.candidates.push({ kind: 'symbol', url: new URL(p, base).href });
  }
  return found;
}

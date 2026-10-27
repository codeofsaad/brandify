// Protections for running Brandify on a public URL:
//  - shared-password HTTP Basic auth
//  - per-IP rate limiting for the expensive endpoints
//  - SSRF guard so the website analyzer can only reach public internet hosts
import { timingSafeEqual } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import net from 'node:net';

// ---------- auth ----------

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

// Any username is accepted; only the password is checked.
export function requirePassword(password) {
  return (req, res, next) => {
    const header = req.headers.authorization || '';
    if (header.startsWith('Basic ')) {
      const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
      const given = decoded.slice(decoded.indexOf(':') + 1);
      if (safeEqual(given, password)) return next();
    }
    res.set('WWW-Authenticate', 'Basic realm="Brandify", charset="UTF-8"');
    res.status(401).send('Authentication required.');
  };
}

// ---------- rate limit ----------

export function rateLimit({ windowMs = 15 * 60 * 1000, max = 30 } = {}) {
  const hits = new Map(); // ip -> timestamps
  setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [ip, list] of hits) {
      const fresh = list.filter((t) => t > cutoff);
      if (fresh.length) hits.set(ip, fresh);
      else hits.delete(ip);
    }
  }, windowMs).unref();

  return (req, res, next) => {
    const now = Date.now();
    const list = (hits.get(req.ip) || []).filter((t) => t > now - windowMs);
    if (list.length >= max) {
      const retry = Math.ceil((list[0] + windowMs - now) / 1000);
      res.set('Retry-After', String(retry));
      return res.status(429).json({ error: `Too many requests. Try again in ${Math.ceil(retry / 60)} minute(s).` });
    }
    list.push(now);
    hits.set(req.ip, list);
    next();
  };
}

// ---------- SSRF guard ----------

function isPrivateIPv4(ip) {
  const [a, b] = ip.split('.').map(Number);
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local incl. cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    a >= 224 // multicast / reserved
  );
}

export function isPrivateIp(ip) {
  if (net.isIPv4(ip)) return isPrivateIPv4(ip);
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v === '::1' || v === '::') return true;
    if (v.startsWith('fc') || v.startsWith('fd') || /^fe[89ab]/.test(v)) return true;
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIPv4(mapped[1]);
    return false;
  }
  return true; // not a valid IP: treat as unsafe
}

const hostCache = new Map(); // hostname -> { ok, at }

// Throws unless every address the hostname resolves to is public.
export async function assertPublicHost(hostname) {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) {
    throw new Error('That address is not allowed.');
  }
  const cached = hostCache.get(host);
  if (cached && Date.now() - cached.at < 5 * 60 * 1000) {
    if (!cached.ok) throw new Error('That address is not allowed.');
    return;
  }
  let ok = false;
  try {
    const addrs = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
    ok = addrs.length > 0 && addrs.every((a) => !isPrivateIp(a.address));
  } catch {
    ok = false;
  }
  hostCache.set(host, { ok, at: Date.now() });
  if (!ok) throw new Error('That address is not allowed or could not be resolved.');
}

export async function assertPublicUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new Error('Invalid URL.');
  }
  if (!/^https?:$/.test(u.protocol)) throw new Error('Only http and https addresses are allowed.');
  await assertPublicHost(u.hostname);
  return u;
}

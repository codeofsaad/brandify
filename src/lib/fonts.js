// Web-safe font handling: the Google Fonts catalog (bundled, ~930 families), availability checks, and matching for
// custom brand fonts that cannot be used on the web.
//
// The catalog loads in the background (dynamic import, ~37 KB) and matching is pure in-memory scoring, so none of this
// adds waiting to a company pull.

// Fallback used until the catalog has loaded (and if it ever fails to).
export const GOOGLE_FONTS = [
  'Inter', 'Roboto', 'Roboto Condensed', 'Open Sans', 'Lato', 'Montserrat', 'Poppins', 'Source Sans 3',
  'Work Sans', 'IBM Plex Sans', 'DM Sans', 'Nunito Sans', 'Public Sans', 'Libre Franklin', 'Manrope', 'Rubik',
  'Fira Sans', 'Archivo', 'Barlow', 'Barlow Condensed', 'Oswald', 'Jost', 'Source Serif 4', 'Merriweather',
  'Playfair Display', 'Lora', 'IBM Plex Serif',
];

// ---------- catalog ----------

// Each row: [family, category, weights, width, thickness400, thickness700, popularityRank]
// category: s sans, r serif, k slab, m mono, d display.  weights: digits, e.g. "3456789" = 300..900.
let CATALOG = null;
let BY_KEY = new Map();
let loading = null;

const norm = (s) => String(s || '').toLowerCase().replace(/["']/g, '').trim();
const key = (s) => norm(s).replace(/[^a-z0-9]+/g, '');

export function ensureCatalog() {
  if (CATALOG) return Promise.resolve(CATALOG);
  loading ||= import('../data/google-fonts.json')
    .then((m) => {
      CATALOG = m.default.map(([family, cat, weights, width, t4, t7, pop]) => ({ family, cat, weights, width, t4, t7, pop }));
      BY_KEY = new Map(CATALOG.map((f) => [key(f.family), f]));
      return CATALOG;
    })
    .catch(() => null);
  return loading;
}

const CAT_LABEL = { s: 'Sans serif', r: 'Serif', k: 'Slab serif', m: 'Monospace', d: 'Display' };

// The dropdown shows only familiar fonts so it is easy to choose from. Matching still searches the whole catalog, and
// anything it suggests (or the brand already uses) is pinned at the top of the list.
const COMMON = [
  ['Sans serif', ['Inter', 'Roboto', 'Open Sans', 'Lato', 'Montserrat', 'Poppins', 'Source Sans 3', 'Work Sans', 'DM Sans', 'Nunito Sans', 'IBM Plex Sans', 'Libre Franklin', 'Barlow', 'Jost']],
  ['Condensed', ['Roboto Condensed', 'Barlow Condensed', 'Oswald', 'Archivo Narrow']],
  ['Serif', ['Source Serif 4', 'Merriweather', 'Playfair Display', 'Lora', 'EB Garamond']],
  ['Monospace', ['IBM Plex Mono']],
];

// @param pinned family names to show first (the current font and its suggestions)
export function fontGroups(pinned = []) {
  const common = new Set(COMMON.flatMap(([, list]) => list));
  const extras = [...new Set(pinned.filter(Boolean))].filter((f) => !common.has(f));
  return [...(extras.length ? [['Suggested for this brand', extras]] : []), ...COMMON];
}

export function canonicalGoogleName(family) {
  if (!family) return null;
  if (CATALOG) return BY_KEY.get(key(family))?.family || null;
  return GOOGLE_FONTS.find((f) => key(f) === key(family)) || null;
}

export const isWebAvailable = (family) => Boolean(canonicalGoogleName(family));

// First family in a CSS font-family stack that is not a generic keyword.
export function firstFamily(stack) {
  if (!stack) return null;
  const generic = new Set(['sans-serif', 'serif', 'monospace', 'system-ui', 'cursive', 'fantasy', 'ui-sans-serif', 'ui-serif', '-apple-system', 'blinkmacsystemfont', 'helvetica', 'arial']);
  for (const part of stack.split(',')) {
    const f = part.trim().replace(/^["']|["']$/g, '');
    if (f && !generic.has(f.toLowerCase())) return f;
  }
  return null;
}

// ---------- matching ----------

// Well-known brand/commercial fonts and the free Google font that looks closest. Patterns run on the normalized name.
const LOOKALIKES = [
  [/helvetica|neuehaas|haasgrotesk|univers|akzidenz|arial|sfpro|sanfrancisco|segoe|graphik|sohne|söhne|aktiv|suisse|generalsans|salesforcesans|systemui/, 'Inter', 'Neutral grotesque, like Helvetica and similar'],
  [/gotham|proxima|metropolis|brandon|montforanker|^mont/, 'Montserrat', 'Geometric sans with wide, even letters'],
  [/avenir|nunito|museosans/, 'Nunito Sans', 'Friendly, rounded-feeling sans'],
  [/circular|cerebri|productsans|googlesans|sharpsans|samsungsharp|samsungone/, 'DM Sans', 'Clean geometric sans'],
  [/futura|avantgarde|centurygothic|itcavant|bauhaus/, 'Jost', 'Futura-style geometric sans'],
  [/dincondensed|bahnschriftcondensed|adidasfg|knockout|tradegothiccondensed|leaguegothic|haettenschweiler/, 'Barlow Condensed', 'Condensed, sporty grotesque'],
  [/^din|altedin|karbon|akko|adihaus|bahnschrift/, 'Barlow', 'DIN-style engineered sans'],
  [/impact|anton/, 'Anton', 'Heavy condensed display'],
  [/gillsans/, 'Cabin', 'Humanist sans with a classic feel'],
  [/frutiger|myriad|whitney|sourcesans/, 'Source Sans 3', 'Humanist sans, very readable'],
  [/franklin|tradegothic|newsgothic/, 'Libre Franklin', 'American gothic grotesque'],
  [/georgia/, 'Gelasio', 'Georgia-metric serif'],
  [/timesnewroman|^times|tinos/, 'Tinos', 'Times-metric serif'],
  [/garamond|sabon/, 'EB Garamond', 'Classic Garamond revival'],
  [/baskerville/, 'Libre Baskerville', 'Baskerville revival'],
  [/didot|bodoni/, 'Playfair Display', 'High-contrast display serif'],
  [/caslon/, 'Libre Caslon Text', 'Caslon revival'],
  [/palatino|minion|bookantiqua|charter/, 'Crimson Pro', 'Book serif'],
  [/rockwell|clarendon|museoslab|archer|slab/, 'Roboto Slab', 'Sturdy slab serif'],
  [/courier|consolas|menlo|sfmono|monaco|lucidaconsole/, 'IBM Plex Mono', 'Clean monospace'],
  [/vagrounded|varela|quicksand/, 'Nunito', 'Rounded sans'],
];

const WORKHORSES = ['Inter', 'Roboto', 'Open Sans', 'Source Sans 3', 'Work Sans', 'DM Sans', 'IBM Plex Sans', 'Public Sans', 'Lato', 'Nunito Sans'];
const CONDENSED_FAMILIES = /condensed|narrow|compressed|oswald|anton|bebasneue|leaguegothic|antonio|teko|fjalla|pathwaygothic|bigshoulders|sairacondensed/;

// Generic words say nothing about a design, so they must not make two names look alike.
const NOISE = /display|text|sans|serif|medium|regular|bold|light|semibold|black|pro|variable|var|next|now|std|new|itc|mt|ltd|book|roman/gi;

function bigrams(s) {
  const t = key(String(s).replace(NOISE, ' '));
  const out = new Map();
  for (let i = 0; i < t.length - 1; i++) out.set(t.slice(i, i + 2), (out.get(t.slice(i, i + 2)) || 0) + 1);
  return out;
}
function dice(a, b) {
  const A = bigrams(a), B = bigrams(b);
  let hit = 0, total = 0;
  for (const [g, n] of A) { total += n; if (B.has(g)) hit += Math.min(n, B.get(g)); }
  for (const n of B.values()) total += n;
  return total ? (2 * hit) / total : 0;
}

/**
 * Closest free Google fonts for a brand font that can't be used on the web.
 * @param {{name:string, role:'heading'|'body', weight?:number, uppercase?:boolean}} p
 * @returns {{family:string, reason:string}[]} up to 3 distinct suggestions, best first
 */
export function matchFonts({ name, role = 'body', weight = 400, uppercase = false }) {
  const n = key(name);
  const out = [];
  const add = (family, reason) => {
    const canon = canonicalGoogleName(family);
    if (canon && !out.some((o) => o.family === canon)) out.push({ family: canon, reason });
  };

  // 1) curated lookalikes: the most reliable signal
  for (const [re, family, reason] of LOOKALIKES) {
    if (re.test(n)) {
      if (family === 'Barlow' && role === 'heading' && uppercase) add('Barlow Condensed', 'DIN-style, condensed for uppercase headings');
      add(family, reason);
    }
  }

  // 2) score the catalog on traits we can infer
  if (CATALOG) {
    const wantSerif = /serif|garamond|georgia|times|minion|caslon|baskerville|didot|bodoni|palatino/.test(n) && !/sans/.test(n);
    const wantMono = /mono|code|courier|consolas/.test(n);
    const wantSlab = /slab|rockwell|clarendon/.test(n);
    const wantCond = CONDENSED_FAMILIES.test(n) || (role === 'heading' && uppercase && weight >= 600 && !wantSerif);
    const wantWeightDigit = String(Math.round(Math.min(900, Math.max(100, weight)) / 100));
    const scored = CATALOG.map((f) => {
      let s = 0;
      const want = wantMono ? 'm' : wantSlab ? 'k' : wantSerif ? 'r' : 's';
      if (f.cat === want) s += 3;
      else if (f.cat === 'd' && role === 'heading' && !wantSerif) s += 0.8;
      else s -= 3;
      const isCond = CONDENSED_FAMILIES.test(key(f.family));
      if (wantCond) s += isCond ? 2.5 : -0.5;
      else if (isCond) s -= 3;
      if (f.weights.includes(wantWeightDigit)) s += 1.2;
      else s -= 2;
      s += 3.5 * dice(name || '', f.family); // similar names often mean a similar design
      s += Math.max(0, 1.6 - f.pop / 60); // widely used, well-built fonts first
      s -= Math.min(2.5, f.pop / 350); // obscure fonts are rarely a good stand-in
      if (role === 'body' && WORKHORSES.includes(f.family)) s += 1.2;
      return { f, s };
    })
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s);
    const why = wantCond ? 'Condensed, suits uppercase headings' : wantSerif ? 'Serif with a similar tone' : wantMono ? 'Monospace' : wantSlab ? 'Slab serif' : role === 'body' ? 'Readable all-round sans' : 'Sturdy sans for headings';
    for (const { f } of scored) {
      if (out.length >= 3) break;
      add(f.family, why);
    }
  }

  // 3) safety net before the catalog is ready
  if (!out.length) add(role === 'heading' && uppercase ? 'Barlow Condensed' : 'Inter', 'Safe default');
  return out.slice(0, 3);
}

// Kept for older call sites: the single best match.
export const suggestSubstitute = (name, role, opts = {}) => matchFonts({ name, role, ...opts })[0].family;

// ---------- loading fonts for previews ----------

const loaded = new Set();
// Injects a Google Fonts stylesheet once per family so previews render correctly.
export function loadFont(family) {
  const canon = canonicalGoogleName(family);
  if (!canon || loaded.has(canon) || typeof document === 'undefined') return;
  loaded.add(canon);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${canon.replace(/ /g, '+')}:wght@300;400;500;600;700;800&display=swap`;
  document.head.appendChild(link);
}

export const genericFor = (family) => (/serif|merriweather|playfair|lora|garamond|baskerville|caslon|crimson|gelasio|tinos/i.test(family) && !/sans/i.test(family) ? 'serif' : /mono/i.test(family) ? 'monospace' : 'sans-serif');
export const cssStack = (family) => `'${family}', ${genericFor(family)}`;

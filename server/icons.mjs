// Official brand color and a clean SVG mark from Simple Icons (CC0 data, ~3,400 brands, no account or credits).
// Used when Brandfetch can't answer. The match must be exact: a wrong brand's color is worse than no color.
let index = null; // normalized slug/title -> icon

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

async function load() {
  if (index) return index;
  const mod = await import('simple-icons');
  index = new Map();
  for (const [key, icon] of Object.entries(mod)) {
    if (!key.startsWith('si') || !icon?.hex || !icon?.svg) continue;
    for (const name of [icon.slug, icon.title]) {
      const k = norm(name);
      // Two brands sharing a name is ambiguous, so neither is used.
      index.set(k, index.has(k) && index.get(k) !== icon ? null : icon);
    }
  }
  return index;
}

/**
 * @param {string} domain e.g. "nike.com"
 * @param {string=} name  the company's own name from its website, when known
 * @returns {Promise<{title:string, slug:string, hex:string, svg:string, source:string}|null>}
 */
export async function iconFor(domain, name) {
  try {
    const idx = await load();
    const label = domain.replace(/^www\./, '').split('.')[0];
    const icon = idx.get(norm(label)) || (name ? idx.get(norm(name)) : null);
    if (!icon) return null;
    // The SVG ships without a fill (so it renders black); paint it in the brand colour.
    const svg = icon.svg.replace('<svg ', `<svg fill="#${icon.hex}" `);
    return { title: icon.title, slug: icon.slug, hex: `#${icon.hex.toUpperCase()}`, svg, source: icon.source || '' };
  } catch {
    return null;
  }
}

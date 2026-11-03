// Turns the selected logo into something that can live inside the design file itself, so a data app never has to
// download it: sanitized inline SVG, or a base64 data URI for PNG/JPG/WebP.

const MAX_SVG = 150 * 1024;
const MAX_RASTER = 200 * 1024;
const BLOCKED_TAGS = new Set(['script', 'foreignobject', 'iframe', 'object', 'embed', 'audio', 'video', 'animate', 'animatetransform', 'set', 'image']);

// Removes anything executable or externally linked from an SVG. Returns the cleaned markup, or null if it isn't a valid SVG.
export function sanitizeSvg(text) {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = doc.documentElement;
  if (doc.querySelector('parsererror') || root.localName.toLowerCase() !== 'svg') return null;
  const all = [root, ...root.querySelectorAll('*')];
  for (const el of all) {
    if (el !== root && BLOCKED_TAGS.has(el.localName.toLowerCase())) {
      el.remove();
      continue;
    }
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();
      const isLink = name === 'href' || name === 'xlink:href';
      if (name.startsWith('on') || (isLink && !value.startsWith('#')) || value.includes('javascript:')) el.removeAttribute(attr.name);
    }
    if (el.localName.toLowerCase() === 'style') {
      el.textContent = el.textContent.replace(/@import[^;]*;?/gi, '').replace(/url\(\s*['"]?(?!#)[^)]*\)/gi, 'none');
    }
  }
  return new XMLSerializer().serializeToString(root).replace(/<\?xml[^>]*\?>/, '').replace(/>\s+</g, '><').trim();
}

function decodeDataUrl(dataUrl) {
  const [head, body = ''] = dataUrl.split(',');
  const isB64 = /;base64/i.test(head);
  return { mime: head.slice(5).split(';')[0], text: isB64 ? atob(body) : decodeURIComponent(body), raw: dataUrl };
}

// Returns { kind: 'svg', svg } | { kind: 'raster', mime, dataUri } | { failed: true, reason }.
export async function fetchLogoAsset(logo) {
  try {
    if (logo.url.startsWith('data:')) {
      const d = decodeDataUrl(logo.url);
      if (d.mime.includes('svg')) {
        const svg = sanitizeSvg(d.text);
        return svg && svg.length <= MAX_SVG ? { kind: 'svg', svg } : { failed: true, reason: 'The uploaded SVG could not be read.' };
      }
      return d.raw.length <= MAX_RASTER * 1.4 ? { kind: 'raster', mime: d.mime, dataUri: d.raw } : { failed: true, reason: 'The uploaded logo is too large to embed.' };
    }
  } catch {
    /* fall through */
  }
  return { failed: true, reason: 'The logo file could not be read.' };
}

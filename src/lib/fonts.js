// Web-safe font handling: a curated Google Fonts list plus substitution hints for custom brand fonts.

export const GOOGLE_FONTS = [
  'Inter', 'Roboto', 'Roboto Condensed', 'Open Sans', 'Lato', 'Montserrat', 'Poppins', 'Source Sans 3',
  'Work Sans', 'IBM Plex Sans', 'DM Sans', 'Nunito Sans', 'Public Sans', 'Libre Franklin', 'Manrope', 'Rubik',
  'Fira Sans', 'Archivo', 'Barlow', 'Barlow Condensed', 'Oswald', 'Jost', 'Source Serif 4', 'Merriweather',
  'Playfair Display', 'Lora', 'IBM Plex Serif',
];

const norm = (s) => s.toLowerCase().replace(/["']/g, '').trim();

export function isWebAvailable(family) {
  if (!family) return false;
  return GOOGLE_FONTS.some((f) => norm(f) === norm(family));
}

export function canonicalGoogleName(family) {
  return GOOGLE_FONTS.find((f) => norm(f) === norm(family)) || null;
}

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

// Suggest a Google Font that approximates a custom brand font.
export function suggestSubstitute(name, role, { uppercase = false } = {}) {
  const n = norm(name || '');
  if (/condensed|narrow|compressed/.test(n)) return 'Barlow Condensed';
  if (/\bdin\b|din /.test(n) || n.includes('din')) return role === 'heading' && uppercase ? 'Barlow Condensed' : 'Barlow';
  if (/avant|futura|gotham|geometric/.test(n)) return 'Jost';
  if (/garamond|georgia|times|serif|minion|caslon/.test(n) && !/sans/.test(n)) return 'Source Serif 4';
  if (/salesforce|sf pro|segoe|helvetica|neue|univers|sans/.test(n)) return 'Inter';
  if (role === 'heading' && uppercase) return 'Barlow Condensed';
  return 'Inter';
}

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

export const genericFor = (family) => (/serif|merriweather|playfair|lora|garamond/i.test(family) && !/sans/i.test(family) ? 'serif' : 'sans-serif');
export const cssStack = (family) => `'${family}', ${genericFor(family)}`;

// Usage: node scripts/summarize-style.mjs <domain>
// Prints a compact summary of out/<domain>/style.json (read-only).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const domain = process.argv[2];
if (!domain) {
  console.error('Usage: node scripts/summarize-style.mjs <domain>');
  process.exit(1);
}
const j = JSON.parse(readFileSync(fileURLToPath(new URL(`../out/${domain}/style.json`, import.meta.url)), 'utf8'));
const t = (a) => a.map((x) => `${x.value} ×${x.count}`).join(' | ');

console.log(`=== ${domain} (${j.status}) ${j.title}`);
console.log(`buttons: ${j.buttons.count}`);
console.log(`  radius: ${t(j.buttons.radius)}`);
console.log(`  bg: ${t(j.buttons.bg)}`);
console.log(`  text-transform: ${t(j.buttons.textTransform)}`);
console.log(`  weight: ${t(j.buttons.fontWeight)}`);
console.log(`  border: ${t(j.buttons.border)}`);
console.log(`cards: ${j.cards.count}`);
console.log(`  radius: ${t(j.cards.radius)}`);
console.log(`  shadow: ${t(j.cards.shadow)}`);
for (const [k, v] of Object.entries(j.typography)) {
  console.log(`type ${k}: ${v.family.slice(0, 50)} ${v.size}/${v.weight} ${v.textTransform} ls=${v.letterSpacing} | ${v.sample}`);
}
console.log(`bgs: ${t(j.colors.backgrounds)}`);
console.log(`text: ${t(j.colors.text)}`);
console.log(`links: ${t(j.colors.links)}`);
console.log(`sectionPad: ${t(j.spacing.sectionPaddingTop)}`);
console.log(`containers: ${t(j.spacing.containerWidths)}`);
console.log(`cssVariables: ${j.cssVariableCount}`);

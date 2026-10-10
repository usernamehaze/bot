// Cassie's logo — option C, "the Character": Cursor Cassie's pointer with her two caret eyes.
// Draws every app / extension icon from one shape:  node promo/brand/mark.cjs
const fs = require('fs');
const path = require('path');
const { chromium } = require(path.join(__dirname, '../../tests/node_modules/playwright'));
const ROOT = path.join(__dirname, '../..');
const INK = '#121117', WHITE = '#ffffff';
// the pointer (same as the cursor everywhere in Cassie), softened by a round stroke
const P = 'M108 90 L395 259 L275 281 L342 399 L287 422 L225 300 L108 382 Z';
const mark = (fill, eyes, withEyes = true) => `<path d="${P}" fill="${fill}" stroke="${fill}" stroke-width="56" stroke-linejoin="round"/>` +
  (withEyes ? `<rect x="168" y="196" width="22" height="70" rx="11" fill="${eyes}"/><rect x="236" y="214" width="22" height="70" rx="11" fill="${eyes}"/>` : '');
// the mark's box (with the stroke) is about x 80…423, y 62…450 — centred in a 512 square
const icon = ({ size, rounded = true, scale = 0.74, eyes = true }) => {
  const s = scale, tx = 256 - 251.5 * s + 10 * s, ty = 256 - 256 * s + 6 * s;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
    <rect width="512" height="512" rx="${rounded ? 116 : 0}" fill="${INK}"/>
    <g transform="translate(${tx.toFixed(1)} ${ty.toFixed(1)}) scale(${s})">${mark(WHITE, INK, eyes)}</g></svg>`;
};
module.exports = { P, mark, icon };
if (require.main === module) (async () => {
  const out = [
    ['icons/icon-192.png', { size: 192 }], ['icons/icon-512.png', { size: 512 }],
    ['icons/icon-maskable-192.png', { size: 192, rounded: false, scale: 0.6 }], ['icons/icon-maskable-512.png', { size: 512, rounded: false, scale: 0.6 }],
    ['extension/icons/icon-16.png', { size: 16, eyes: false, scale: 0.86 }], ['extension/icons/icon-32.png', { size: 32, scale: 0.84 }],
    ['extension/icons/icon-48.png', { size: 48, scale: 0.8 }], ['extension/icons/icon-128.png', { size: 128 }],
  ];
  const b = await chromium.launch();
  const page = await b.newPage();
  for (const [file, o] of out) {
    await page.setViewportSize({ width: o.size, height: o.size });
    await page.setContent(`<html><body style="margin:0;background:transparent">${icon(o)}</body></html>`);
    await page.screenshot({ path: path.join(ROOT, file), omitBackground: true, clip: { x: 0, y: 0, width: o.size, height: o.size } });
    console.log('wrote', file);
  }
  fs.writeFileSync(path.join(ROOT, 'icons/logo.svg'), icon({ size: 512 }));
  await b.close();
})();

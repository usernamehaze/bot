// Renders the still frame around each filmed scene (caption + window) and the window's mask.
//   node promo/ad3/frames.cjs <out-dir>          (site served at :4700)
const fs = require('fs');
const path = require('path');
const { chromium } = require(path.join(__dirname, '../../tests/node_modules/playwright'));
const BASE = process.env.BASE || 'http://localhost:4700';
const OUT = path.resolve(process.argv[2] || 'ad3-out');
(async () => {
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  fs.mkdirSync(OUT, { recursive: true });
  for (const e of JSON.parse(fs.readFileSync(path.join(__dirname, 'script.json'), 'utf8'))) {
    if (!e.cap) continue;
    await page.goto(`${BASE}/promo/ad3/frame.html?b=${encodeURIComponent(e.cap)}&s=${encodeURIComponent(e.sub || '')}`);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(OUT, `bg-${e.key}.png`) });
  }
  await page.goto(`${BASE}/promo/ad3/frame.html?mask=1`);
  await page.screenshot({ path: path.join(OUT, 'mask.png') });
  await b.close();
  console.log('frames written to', OUT);
})();

// The screens on the landing page's laptop and phone (index.html, landing/story.js "show"):
// the Labs shelf, the human body pulling apart (18 frames of the "Pull it apart" slider),
// the 3D solar system (overview, Earth, Saturn, Jupiter, Mars), and the same on a phone.
//   node promo/hero/devices.cjs [shelf|body|space|phone]   (the site served at BASE, default :4650)
//   python3 promo/hero/devices.py                          (raw PNGs → landing/hero/lx-*.webp)
const fs = require('fs');
const path = require('path');
const { chromium } = require(path.join(__dirname, '../../tests/node_modules/playwright'));
const BASE = process.env.BASE || 'http://localhost:4650';
const RAW = path.join(__dirname, 'raw');
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const seed = (tab) => JSON.stringify({ profile: { name: 'Ana', role: 'student', grade: 'Grade 10', age: 16, at: 1 }, seenVersion: '999', analytics: { usage: false }, tab });
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
async function page(b, viewport, dpr, phone) {
  const ctx = await b.newContext({ viewport, deviceScaleFactor: dpr, isMobile: phone, hasTouch: phone, userAgent: phone ? IPHONE : undefined, serviceWorkers: 'block' });
  await ctx.addInitScript((s) => { window.CASSIE_SERVER = ''; if (!sessionStorage.getItem('s')) { localStorage.setItem('cassie.v2', s); sessionStorage.setItem('s', 1); } }, seed(phone ? 'home' : 'chat'));
  await ctx.route(/wikipedia|worldbank|workers\.dev|fonts\.g|groq|pollinations/, (r) => r.abort());
  return ctx.newPage();
}
const bodyReady = (p) => p.waitForFunction(() => document.querySelector('.x3d-loading') && document.querySelector('.x3d-loading').hidden && +((document.querySelector('.x3d-count b') || {}).textContent || '0').replace(/\D/g, '') > 50, null, { timeout: 120000 });
const shot = (p, name) => p.screenshot({ path: path.join(RAW, name + '.png') }).then(() => console.log('took', name));
(async () => {
  fs.mkdirSync(RAW, { recursive: true });
  const only = process.argv[2] || 'all', b = await chromium.launch({ args: ARGS });
  if (only === 'all' || only === 'shelf') { // tall, so its cards can be tapped where they are (see story.js: 395 and 568)
    const p = await page(b, { width: 1600, height: 2080 }, 1, false);
    await p.goto(BASE + '/app.html'); await p.waitForTimeout(1500);
    await p.evaluate(() => openLabs()); await p.waitForSelector('.labs:not([hidden]) .labs-card'); await p.waitForTimeout(800);
    await shot(p, 'shelf'); await p.context().close();
  }
  if (only === 'all' || only === 'body') {
    const p = await page(b, { width: 1600, height: 1000 }, 1, false);
    await p.goto(BASE + '/app.html?explore=body'); await bodyReady(p);
    await p.click('.x3d-seg [data-look="front"]').catch(() => {}); await p.waitForTimeout(2500);
    for (let i = 0; i < 18; i++) {
      await p.locator('.x3d-spread').fill(String(Math.round((100 * i) / 17))); await p.locator('.x3d-spread').dispatchEvent('change');
      await p.waitForTimeout(1800); await shot(p, 'body-' + String(i).padStart(2, '0'));
    }
    await p.context().close();
  }
  if (only === 'all' || only === 'space') {
    const p = await page(b, { width: 1600, height: 1000 }, 1, false);
    await p.goto(BASE + '/app.html?lab=space3d'); await p.waitForSelector('.lab-stage canvas.lab-3d', { timeout: 60000 }); await p.waitForTimeout(6000);
    await shot(p, 'space-0');
    let k = 1;
    for (const name of ['Earth', 'Saturn', 'Jupiter', 'Mars']) { await p.locator(`.lab3d-label:text-is("${name}")`).first().evaluate((e) => e.click()); await p.waitForTimeout(7000); await shot(p, 'space-' + k++); }
    await p.context().close();
  }
  if (only === 'all' || only === 'phone') { // an iPhone 15's screen below its status bar (the page draws the status bar)
    let p = await page(b, { width: 393, height: 798 }, 2, true);
    await p.goto(BASE + '/app.html'); await p.waitForTimeout(1500);
    await p.evaluate(() => openLabs()); await p.waitForSelector('.labs:not([hidden]) .labs-card'); await p.waitForTimeout(800);
    await shot(p, 'phone-labs'); await p.context().close();
    p = await page(b, { width: 393, height: 798 }, 2, true);
    await p.goto(BASE + '/app.html?explore=body'); await bodyReady(p); await p.waitForTimeout(2500);
    await shot(p, 'phone-body'); await p.context().close();
    p = await page(b, { width: 393, height: 798 }, 2, true);
    await p.goto(BASE + '/app.html?lab=space3d'); await p.waitForSelector('.lab-stage canvas.lab-3d', { timeout: 60000 }); await p.waitForTimeout(5000);
    await p.locator('.lab3d-label:text-is("Earth")').first().evaluate((e) => e.click()); await p.waitForTimeout(7000);
    await shot(p, 'phone-earth'); await p.context().close();
  }
  await b.close();
})();

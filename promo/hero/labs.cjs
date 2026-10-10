// The Labs screens for the 3D laptop and phone in the landing page's hero (see promo/README.md).
//   node promo/hero/labs.cjs [name…]    (the site served at :4700)
// laptop-labs-tall: the Labs shelf on a tall window, so it can scroll on the laptop's screen;
// laptop-cells: the cell lab; phone-labs / phone-lab: the same on a phone.
const fs = require('fs');
const path = require('path');
const { chromium } = require(path.join(__dirname, '../../tests/node_modules/playwright'));
const BASE = process.env.BASE || 'http://localhost:4700';
const RAW = path.join(__dirname, 'raw');
const APP_VERSION = fs.readFileSync(path.join(__dirname, '../../app.js'), 'utf8').match(/APP_VERSION = '([^']+)'/)[1];
const seed = JSON.stringify({ profile: { name: 'Mika', role: 'student', grade: 'Grade 10', age: 16, gender: 'female', at: 1 }, seenVersion: APP_VERSION, analytics: { usage: false, topics: false }, lite: 'on' });
const SHOTS = [
  ['laptop-labs-tall', { width: 1280, height: 2400 }, 1.25, null],
  ['laptop-cells', { width: 1280, height: 800 }, 1.25, 'cells3d'],
  ['laptop-pendulum', { width: 1280, height: 800 }, 1.25, 'pendulum'],
  ['phone-labs', { width: 390, height: 844 }, 3, null],
  ['phone-lab', { width: 390, height: 844 }, 3, 'solar'],
];
(async () => {
  fs.mkdirSync(RAW, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const only = process.argv.slice(2);
  for (const [name, viewport, scale, lab] of SHOTS) {
    if (only.length && !only.includes(name)) continue;
    const phone = viewport.width < 600;
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: scale, serviceWorkers: 'block', hasTouch: phone, isMobile: phone });
    await ctx.addInitScript((s) => { window.CASSIE_SERVER = ''; localStorage.setItem('cassie.v2', s); }, seed);
    await ctx.route(/workers\.dev|groq|huggingface|pollinations|wikipedia|worldbank/, (r) => r.abort());
    const p = await ctx.newPage();
    await p.goto(BASE + '/app.html' + (lab ? '?lab=' + lab : '')); await p.waitForSelector('#prompt-input');
    if (!lab) { await p.click('#labs-btn'); await p.waitForSelector('.labs:not([hidden]) .labs-card', { timeout: 20000 }); }
    await p.waitForTimeout(lab ? 9000 : 2500);
    await p.screenshot({ path: path.join(RAW, name + '.png') });
    console.log('took', name);
    await ctx.close();
  }
  await browser.close();
})();

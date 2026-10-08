// Records the footage for the 1-minute tour (promo/cassie-ad-60s.mp4), frame by frame.
// Every scene is the real thing: the landing page's demos, and the real app (app.html?lab=…).
// Playwright's fake clock moves time forward 1/30 s per frame, so even the 3D scenes come out
// smooth and the same every time. A drawn cursor shows where the "student" points.
//
//   node promo/ad3/record.cjs <out-dir> [scene …]      (needs the site served at :4700, see README)
const fs = require('fs');
const path = require('path');
const { chromium } = require(path.join(__dirname, '../../tests/node_modules/playwright'));

const BASE = process.env.BASE || 'http://localhost:4700';
const FPS = 30;
const OUT = path.resolve(process.argv[2] || 'ad3-out');
const ONLY = process.argv.slice(3);
const APP_VERSION = fs.readFileSync(path.join(__dirname, '../../app.js'), 'utf8').match(/APP_VERSION = '([^']+)'/)[1];
const SEED = JSON.stringify({ profile: { name: 'Mika', role: 'student', grade: 'Grade 10', field: '', age: 16, at: 1 }, seenVersion: APP_VERSION, analytics: { usage: false, topics: false }, lite: 'off' });

// the cursor the viewer sees (Playwright's mouse is invisible)
function cursorScript() {
  const add = () => {
    if (document.getElementById('__cur')) return;
    const c = document.createElement('div');
    c.id = '__cur';
    c.innerHTML = '<svg viewBox="100 80 305 350" width="30" height="34"><path d="M108 90 L395 259 L275 281 L342 399 L287 422 L225 300 L108 382 Z" fill="#fff" stroke="#0b0a0f" stroke-width="20" stroke-linejoin="round" paint-order="stroke"/></svg>';
    c.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;display:none;transform-origin:3px 3px;filter:drop-shadow(0 3px 5px rgba(0,0,0,.45))';
    document.documentElement.appendChild(c);
    let x = 0, y = 0, s = 1;
    const put = () => { c.style.transform = `translate(${x - 3}px, ${y - 3}px) scale(${s})`; };
    addEventListener('mousemove', (e) => { x = e.clientX; y = e.clientY; c.style.display = 'block'; put(); }, true);
    addEventListener('mousedown', () => { s = 0.82; put(); }, true);
    addEventListener('mouseup', () => { s = 1; put(); }, true);
  };
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', add); else add();
}
// the talk demo plays Bella's clip; on a fake clock the audio is played back on that clock instead
function fakeAudio() {
  const P = HTMLAudioElement.prototype, D = 8.7;
  const st = new WeakMap();
  const S = (a) => { if (!st.has(a)) st.set(a, { start: 0, at: 0, paused: true, ended: false }); return st.get(a); };
  Object.defineProperty(P, 'duration', { get() { return D; } });
  Object.defineProperty(P, 'paused', { get() { return S(this).paused; } });
  Object.defineProperty(P, 'ended', { get() { return S(this).ended; } });
  Object.defineProperty(P, 'currentTime', { get() { const s = S(this); return s.paused ? s.at : Math.min(D, s.at + (performance.now() - s.start) / 1000); }, set(v) { S(this).at = v; } });
  P.play = function () { const s = S(this); s.paused = false; s.ended = false; s.start = performance.now(); clearTimeout(s.t); s.t = setTimeout(() => { s.paused = true; s.ended = true; s.at = D; this.dispatchEvent(new Event('ended')); }, (D - s.at) * 1000); return Promise.resolve(); };
  P.pause = function () { const s = S(this); if (s.paused) return; s.at = this.currentTime; s.paused = true; clearTimeout(s.t); this.dispatchEvent(new Event('pause')); };
}

const ease = (k) => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2);
const center = async (page, sel) => { const b = await page.locator(sel).first().boundingBox(); if (!b) throw new Error('not found: ' + sel); return [b.x + b.width / 2, b.y + b.height / 2]; };
// the landing page, cut down to one thing filling the screen
const FOCUS_TRY = `.nav,.strip,#try-hint,.try-note,#try-page .tp-meta{display:none!important} .hero,.hero .inner{min-height:720px!important} .hero .inner{grid-template-columns:1fr!important;padding:18px 0!important;justify-items:center;align-items:start!important} .hero .inner>div:first-child{display:none!important} .try{width:860px} #try-page p.tp-text{font-size:20px} #try-page h3{font-size:30px} #try-bot{right:-10px;bottom:-30px;width:110px;height:110px} .rv{opacity:1!important;transform:none!important;transition:none!important}`;
const FOCUS_DESK = `html{scroll-behavior:auto!important} .nav{display:none!important} .rv{opacity:1!important;transform:none!important;transition:none!important} #desk .head{display:none} .desk-sec{padding:0!important} #desk .wrap{width:1240px} .dk-stage{height:680px!important} .dk{border-radius:22px}`;

/* Each scene: where it opens, how it gets ready (real time), then what happens on the film's clock.
   cursor: [t, x, y] keyframes (eased between); events: [t, async (page) => …]. */
const SCENES = {
  highlight: {
    url: '/index.html', viewport: { width: 1000, height: 562 }, // filmed closer up

    async setup(page) {
      await page.addStyleTag({ content: FOCUS_TRY });
      await page.waitForTimeout(800);
      const r = await page.evaluate(() => { const b = [...document.querySelectorAll('#try-page b[data-term]')].find((x) => x.textContent === 'cellular respiration'); const g = document.createRange(); g.selectNodeContents(b); const q = g.getBoundingClientRect(); return [q.left, q.right, q.top + q.height / 2]; });
      return { a: [r[0] + 1, r[2]], z: [r[1] - 1, r[2]] };
    },
    script: ({ a, z }) => ({
      cursor: [[0, 900, 560], [0.9, a[0], a[1]], [1.05, a[0], a[1]], [1.6, z[0], z[1]]],
      events: [[1.0, (p) => p.mouse.down()], [1.65, (p) => p.mouse.up()],
        [2.0, async (p) => { const [x, y] = await center(p, '#try-pop [data-act="explain"]'); SCENES.highlight.go = [x, y]; }],
        [2.75, (p) => p.mouse.down()], [2.8, (p) => p.mouse.up()]],
      after: (t) => (t > 2.0 && SCENES.highlight.go ? lerp([z[0], z[1]], SCENES.highlight.go, (t - 2.0) / 0.7) : null),
    }),
  },
  reviewer: {
    dur: 5.0, url: '/index.html',
    async setup(page) {
      await page.addStyleTag({ content: FOCUS_DESK });
      await page.evaluate(() => { document.querySelector('.dk').scrollIntoView({ block: 'center' }); });
      await page.waitForSelector('#desk-stage .sn-cv');
      await page.click('#desk [data-demo="files"]');
      await page.waitForSelector('.fl-file');
      await page.evaluate(() => { document.querySelector('.dk').scrollIntoView({ block: 'center' }); });
      await page.waitForTimeout(300);
      await page.mouse.move(1270, 715);
      return { f: await center(page, '.fl-file[data-f="pptx"]') };
    },
    script: ({ f }) => ({ cursor: [[0, 900, 650], [0.8, f[0], f[1]]], events: [[0.95, (p) => p.mouse.down()], [1.0, (p) => p.mouse.up()]] }),
  },
  talk: {
    dur: 4.8, url: '/index.html', init: fakeAudio,
    async setup(page) {
      await page.addStyleTag({ content: FOCUS_DESK });
      await page.evaluate(() => { document.querySelector('.dk').scrollIntoView({ block: 'center' }); });
      await page.waitForSelector('#desk-stage .sn-cv');
      await page.click('#desk [data-demo="talk"]');
      await page.waitForSelector('.tk-mic');
      await page.evaluate(() => { document.querySelector('.dk').scrollIntoView({ block: 'center' }); });
      await page.waitForTimeout(300);
      await page.mouse.move(1270, 715);
      return { m: await center(page, '.tk-mic') };
    },
    script: ({ m }) => ({ cursor: [[0, 1100, 650], [0.7, m[0], m[1]], [1.1, m[0], m[1]], [1.7, m[0] + 230, m[1] + 80]], events: [[0.85, (p) => p.mouse.down()], [0.9, (p) => p.mouse.up()]] }),
  },
  labs: {
    dur: 5.6, url: '/app.html?lab=projectile',
    async setup(page) {
      await page.waitForSelector('.lab-stage canvas'); await page.waitForTimeout(1200);
      const s = await page.locator('.lab-stage').boundingBox();
      return { s, l: await center(page, '.lab-stage button:has-text("Launch")') };
    },
    script: ({ s, l }) => {
      const a = [s.x + 180, s.y + s.height - 160], b = [s.x + 330, s.y + s.height - 330];
      return { cursor: [[0, 640, 300], [0.6, a[0], a[1]], [0.75, a[0], a[1]], [1.5, b[0], b[1]], [1.7, b[0], b[1]], [2.3, l[0], l[1]]],
        events: [[0.7, (p) => p.mouse.down()], [1.6, (p) => p.mouse.up()], [2.4, (p) => p.mouse.down()], [2.45, (p) => p.mouse.up()]] };
    },
  },
  space: {
    dur: 5.2, url: '/app.html?lab=space3d',
    async setup(page) {
      await page.waitForSelector('.lab-stage canvas'); await page.waitForTimeout(3500);
      return { mw: await center(page, '.lab-panel button:text-is("Milky Way")'), un: await center(page, '.lab-panel button:text-is("Universe")') };
    },
    script: ({ mw, un }) => ({
      cursor: [[0, 420, 300], [0.25, 420, 300], [1.2, 560, 330], [1.9, mw[0], mw[1]], [3.2, mw[0], mw[1]], [3.6, un[0], un[1]]],
      events: [[0.3, (p) => p.mouse.down()], [1.2, (p) => p.mouse.up()], [2.0, (p) => p.mouse.down()], [2.05, (p) => p.mouse.up()], [3.7, (p) => p.mouse.down()], [3.75, (p) => p.mouse.up()]],
    }),
  },
  body: {
    dur: 5.6, url: '/app.html?lab=body3d',
    async setup(page) {
      await page.click('text=Human body 3D');
      await page.waitForFunction(() => /\d+\s*parts showing/.test(document.body.innerText), null, { timeout: 90000 });
      await page.waitForTimeout(4000);
      // close the "Look around" panel so the body has the screen
      await page.evaluate(() => { const h = [...document.querySelectorAll('*')].find((e) => e.children.length <= 2 && e.textContent.trim() === 'Look around' && !e.closest('button')); const x = h && h.parentElement.querySelector('button'); if (x) x.click(); });
      await page.waitForTimeout(800);
      await page.mouse.move(1270, 715);
      return { q: await center(page, 'input[placeholder^="Find a part"]') };
    },
    script: ({ q }) => ({
      cursor: [[0, 900, 380], [0.2, 900, 380], [1.5, 700, 380], [2.2, q[0], q[1]]],
      events: [[0.25, (p) => p.mouse.down()], [1.5, (p) => p.mouse.up()], [2.3, (p) => p.mouse.down()], [2.35, (p) => p.mouse.up()],
        ...'heart'.split('').map((ch, i) => [2.5 + i * 0.09, (p) => p.keyboard.type(ch)]),
        [3.1, async (p) => { SCENES.body.go = await center(p, '.x3d-results:not([hidden]) button'); }], // after the search's 120 ms pause
        [3.6, (p) => p.mouse.down()], [3.65, (p) => p.mouse.up()]],
      after: (t) => (t > 3.1 && SCENES.body.go ? lerp(q, SCENES.body.go, (t - 3.1) / 0.45) : null),
    }),
  },
  rocket: {
    dur: 4.0, url: '/app.html?lab=rocket',
    async setup(page) {
      await page.waitForSelector('.lab-stage canvas'); await page.waitForTimeout(5000);
      // the starting rocket is too weak to lift off (that's a lesson in the lab): give it more thrust first
      const sl = await page.locator('.lab-panel input[type="range"]').first().boundingBox();
      await page.mouse.click(sl.x + sl.width * 0.8, sl.y + sl.height / 2);
      await page.waitForTimeout(1500);
      return { l: await center(page, '.lab-stage button:has-text("Launch")') };
    },
    script: ({ l }) => ({ cursor: [[0, 700, 500], [0.5, l[0], l[1]]], events: [[0.6, (p) => p.mouse.down()], [0.65, (p) => p.mouse.up()]] }),
  },
  atlas: {
    dur: 5.0, url: '/app.html?lab=atlas',
    async setup(page) {
      await page.waitForSelector('.atlas-map svg, .lab-stage svg, .lab-stage canvas'); await page.waitForTimeout(2000);
      return { i: await center(page, '.lab-panel input'), b: await center(page, '.lab-panel button:text-is("Search")') };
    },
    script: ({ i, b }) => ({
      cursor: [[0, 500, 400], [0.5, i[0], i[1]], [1.75, i[0], i[1]], [2.05, b[0], b[1]]],
      events: [[0.6, (p) => p.mouse.down()], [0.65, (p) => p.mouse.up()],
        ...'Philippines'.split('').map((ch, i2) => [0.8 + i2 * 0.08, (p) => p.keyboard.type(ch)]), [2.15, (p) => p.mouse.down()], [2.2, (p) => p.mouse.up()]],
    }),
  },
  puzzles: {
    dur: 3.9, url: '/app.html?lab=mirrors',
    async setup(page) {
      await page.waitForSelector('.lab-stage canvas'); await page.waitForTimeout(1200);
      return {};
    },
    script: () => {
      const A = [488, 477], B = [488, 386], C = [397, 386];
      return { cursor: [[0, 640, 640], [0.5, A[0], A[1]], [1.1, A[0], A[1]], [1.4, B[0], B[1]], [2.0, B[0], B[1]], [2.3, C[0], C[1]]],
        events: [[0.6, (p) => p.mouse.down()], [0.65, (p) => p.mouse.up()], [1.5, (p) => p.mouse.down()], [1.55, (p) => p.mouse.up()], [2.4, (p) => p.mouse.down()], [2.45, (p) => p.mouse.up()]] };
    },
  },
};
// title cards: promo/ad3/titles.html?k=…, full frame
for (const k of ['hook', 'meet', 'private', 'cta']) {
  SCENES[k] = { url: '/promo/ad3/titles.html?k=' + k, full: true, async setup(page) { await page.waitForTimeout(600); return {}; }, script: () => ({ cursor: [], events: [] }) };
}
// how long each scene runs comes from script.json (the voice-over lines and captions live there too)
for (const e of JSON.parse(fs.readFileSync(path.join(__dirname, 'script.json'), 'utf8'))) SCENES[e.key].dur = e.dur;
const lerp = (a, b, k) => { const e = ease(Math.max(0, Math.min(1, k))); return [a[0] + (b[0] - a[0]) * e, a[1] + (b[1] - a[1]) * e]; };
function cursorAt(keys, t) {
  if (!keys.length || t < keys[0][0]) return null;
  for (let i = 1; i < keys.length; i++) if (t <= keys[i][0]) { const [t0, x0, y0] = keys[i - 1], [t1, x1, y1] = keys[i]; return lerp([x0, y0], [x1, y1], (t - t0) / (t1 - t0 || 1)); }
  const l = keys[keys.length - 1]; return [l[1], l[2]];
}

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const names = ONLY.length ? ONLY : Object.keys(SCENES);
  for (const name of names) {
    const sc = SCENES[name];
    const dir = path.join(OUT, name); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
    const vp = sc.viewport || { width: 1280, height: 720 };
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: sc.full ? 1920 / vp.width : 1472 / vp.width, serviceWorkers: 'block' });
    await ctx.addInitScript((s) => { window.CASSIE_SERVER = ''; try { localStorage.setItem('cassie.v2', s); } catch (e) { /* ignore */ } }, SEED);
    if (!sc.full) await ctx.addInitScript(cursorScript);
    if (sc.init) await ctx.addInitScript(sc.init);
    await ctx.route(/cassie-3d\.js/, (r) => r.abort()); // the hero's moving marble (a still one shows instead)
    await ctx.route(/wikipedia\.org|worldbank\.org/, (r) => r.abort());
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(BASE + sc.url);
    const data = await sc.setup(page);
    const cdp = await ctx.newCDPSession(page);
    await page.clock.install();
    // pause it: from here on, time only moves when a frame is filmed
    await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 50);
    await page.evaluate(() => window.__start && window.__start()); // the title cards start their clock
    const { cursor, events, after } = sc.script(data);
    const todo = [...events].sort((a, b) => a[0] - b[0]);
    const N = Math.round(sc.dur * FPS);
    for (let f = 0; f < N; f++) {
      const t = f / FPS;
      const pos = (after && after(t)) || cursorAt(cursor, t);
      if (pos) await page.mouse.move(pos[0], pos[1]);
      while (todo.length && todo[0][0] <= t) await todo.shift()[1](page);
      await page.clock.runFor(1000 / FPS);
      // (Playwright's own screenshot waits for an animation frame, which the fake clock holds back)
      await new Promise((r) => setTimeout(r, sc.settle || 30));
      const { data: jpg } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 92 });
      fs.writeFileSync(path.join(dir, `f_${String(f).padStart(5, '0')}.jpg`), Buffer.from(jpg, 'base64'));
    }
    console.log(name, N, 'frames', errs.length ? 'errors: ' + errs.join('; ') : '');
    await ctx.close();
  }
  await browser.close();
})();

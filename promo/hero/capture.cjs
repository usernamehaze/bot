// Takes the real Cassie screens shown on the laptop and phone in the landing page's hero.
//   node promo/hero/capture.cjs        (the site served at :4700 — see promo/README.md)
// Answers come from a scripted stand-in for the AI, so every run looks the same.
const fs = require('fs');
const path = require('path');
const { chromium } = require(path.join(__dirname, '../../tests/node_modules/playwright'));
const BASE = process.env.BASE || 'http://localhost:4700';
const OUT = path.join(__dirname, '../../landing/hero');
const RAW = path.join(__dirname, 'raw');
const APP_VERSION = fs.readFileSync(path.join(__dirname, '../../app.js'), 'utf8').match(/APP_VERSION = '([^']+)'/)[1];
const seed = (extra = {}) => JSON.stringify({ profile: { name: 'Mika', role: 'student', grade: 'Grade 10', age: 16, gender: 'female', at: 1 }, seenVersion: APP_VERSION, analytics: { usage: false, topics: false }, lite: 'on', groqKey: 'gsk_demo', ...extra });
const ANSWERS = [
  [/roots|parabola|x²|x\^2/i, 'Let’s find where the parabola crosses the x-axis.\n\n**1. Set y = 0:** x² − 2x − 3 = 0\n\n**2. Factor:** (x − 3)(x + 1) = 0, so **x = 3** or **x = −1**.\n\n**3. The vertex** is halfway between them: x = 1, so y = 1 − 2 − 3 = **−4**.\n\n```cassie-board\n{"type":"graph","title":"y = x² − 2x − 3","fn":"x^2-2*x-3","xrange":[-3,5]}\n```\n\nNow you try: where does it cross the **y-axis**?'],
  [/photosynthesis/i, 'Plants are like little kitchens! 🌱\n\nThey take three ingredients:\n- **sunlight** (the stove’s heat)\n- **water** from the roots\n- **carbon dioxide** from the air\n\n…and cook them into **glucose**, the sugar they live on. The leftover is **oxygen** — the air you breathe.\n\n**6CO₂ + 6H₂O + light → C₆H₁₂O₆ + 6O₂**\n\nWant a quick 3-question quiz on it?'],
];
async function context(browser, viewport, scale, extra) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: scale, serviceWorkers: 'block', hasTouch: viewport.width < 600, isMobile: viewport.width < 600 });
  await ctx.addInitScript((s) => { window.CASSIE_SERVER = ''; if (!sessionStorage.getItem('seeded')) { localStorage.setItem('cassie.v2', s); sessionStorage.setItem('seeded', '1'); } }, seed(extra));
  await ctx.route(/workers\.dev|huggingface|pollinations|wikipedia|worldbank/, (r) => r.abort());
  await ctx.route(/api\.groq\.com/, async (r) => {
    if (r.request().url().endsWith('/models')) return r.fulfill({ json: { data: [{ id: 'openai/gpt-oss-120b' }] } });
    const body = JSON.parse(r.request().postData() || '{}');
    const q = JSON.stringify(body.messages || '').slice(-600);
    const text = (ANSWERS.find(([re]) => re.test(q)) || [0, 'Here you go!'])[1];
    if (body.stream) return r.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: (text.match(/\S+\s*/g) || []).map((w) => `data: ${JSON.stringify({ choices: [{ delta: { content: w } }] })}\n\n`).join('') + 'data: [DONE]\n\n' });
    return r.fulfill({ json: { choices: [{ message: { role: 'assistant', content: text } }] } });
  });
  return ctx;
}
async function ask(page, q) {
  await page.fill('#prompt-input', q);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('.bubble-assistant').length && !document.querySelector('.typing, .thinking-bubble'), null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2500);
}
async function shot(page, name) {
  const raw = path.join(RAW, name + '.png');
  await page.screenshot({ path: raw });
  console.log('took', name);
}
(async () => {
  fs.mkdirSync(RAW, { recursive: true }); fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const only = process.argv.slice(2);
  const want = (n) => !only.length || only.includes(n);
  // laptop: 1440 × 900
  const L = { width: 1280, height: 800 };
  if (want('laptop-chat')) {
    const ctx = await context(browser, L, 1.25); const p = await ctx.newPage();
    await p.goto(BASE + '/app.html'); await p.waitForSelector('#prompt-input');
    await ask(p, 'Graph y = x² − 2x − 3 and find its roots');
    await p.evaluate(() => { const u = document.querySelector('.bubble-user'); if (u) u.scrollIntoView({ block: 'start' }); });
    await p.waitForTimeout(600);
    await shot(p, 'laptop-chat'); await ctx.close();
  }
  for (const [name, lab, wait] of [['laptop-labs', null, 3000], ['laptop-space', 'space3d', 7000], ['laptop-body', 'body3d', 0]]) {
    if (!want(name)) continue;
    const ctx = await context(browser, L, 1.25); const p = await ctx.newPage();
    await p.goto(BASE + '/app.html' + (lab ? '?lab=' + lab : '')); await p.waitForSelector('#prompt-input');
    if (!lab) { await p.click('#labs-btn'); await p.waitForSelector('.labs:not([hidden]) .labs-card', { timeout: 20000 }); }
    if (lab === 'body3d') {
      await p.click('text=Human body 3D');
      await p.waitForFunction(() => /\d+\s*parts showing/.test(document.body.innerText), null, { timeout: 120000 });
      await p.waitForTimeout(3000);
      await p.evaluate(() => { const h = [...document.querySelectorAll('*')].find((e) => e.children.length <= 2 && e.textContent.trim() === 'Look around' && !e.closest('button')); const x = h && h.parentElement.querySelector('button'); if (x) x.click(); });
      await p.fill('input[placeholder^="Find a part"]', 'heart'); await p.waitForTimeout(500);
      await p.click('.x3d-results:not([hidden]) button'); await p.waitForTimeout(5000);
    }
    await p.waitForTimeout(wait);
    await shot(p, name); await ctx.close();
  }
  // phone: 390 × 844
  const P = { width: 390, height: 844 };
  if (want('phone-chat')) {
    const ctx = await context(browser, P, 3); const p = await ctx.newPage();
    await p.goto(BASE + '/app.html'); await p.waitForSelector('#prompt-input');
    await ask(p, 'Explain photosynthesis like I’m 10');
    await shot(p, 'phone-chat'); await ctx.close();
  }
  if (want('phone-puzzle')) {
    const ctx = await context(browser, P, 3); const p = await ctx.newPage();
    await p.goto(BASE + '/app.html?lab=sudoku'); await p.waitForSelector('.sdk-grid', { timeout: 20000 });
    await p.waitForTimeout(1500);
    await shot(p, 'phone-puzzle'); await ctx.close();
  }
  await browser.close();
})();

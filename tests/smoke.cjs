/* Cassie smoke tests — opens the real app in Chromium (phone size) and checks the
   main features still work. The AI is faked, so the tests are free, fast, and
   don't need any keys.

     cd tests && npm install && npm test

   Each test prints PASS or FAIL. The run fails if any test fails. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium, devices } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const APP_PORT = 4640, SERVER_PORT = 4641;
const APP = `http://localhost:${APP_PORT}/app.html`;
const SERVER = `http://localhost:${SERVER_PORT}`;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.webm': 'video/webm', '.mp4': 'video/mp4', '.jpg': 'image/jpeg' };
// The site's response headers, read from _headers. The security policy is the real one, except that
// the page may talk to the fake Cassie server (instead of the real one) and stays on plain http.
const SITE_HEADERS = (() => {
  const out = {};
  for (const line of fs.readFileSync(path.join(ROOT, '_headers'), 'utf8').split('\n')) {
    const m = line.match(/^\s+([\w-]+):\s*(.+)$/);
    if (m) out[m[1].toLowerCase()] = m[2].trim();
  }
  out['content-security-policy'] = out['content-security-policy']
    .replace('https://cassie.failanzahazel.workers.dev', 'https://cassie.failanzahazel.workers.dev ' + SERVER)
    .replace(/;\s*upgrade-insecure-requests/, '');
  delete out['strict-transport-security'];
  return out;
})();
// Anything the security policy blocks is a bug (a test fails on it), so it's caught before it ships.
const cspViolations = [];
function watchCsp(ctx) {
  ctx.on('console', (m) => { if (m.type() === 'error' && /Content Security Policy/i.test(m.text())) cspViolations.push(m.text().slice(0, 300)); });
  return ctx;
}
function staticServer() {
  return http.createServer((req, res) => {
    let p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
    if (!p.startsWith(ROOT) || !fs.existsSync(p)) { res.writeHead(404); return res.end(); }
    // the same headers as the real site (_headers): cross-origin isolated + the security policy
    res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream', ...SITE_HEADERS });
    fs.createReadStream(p).pipe(res);
  }).listen(APP_PORT);
}

/* ---------- helpers ---------- */
const APP_VERSION = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8').match(/APP_VERSION = '([^']+)'/)[1];
const PROFILE = { name: 'Test', role: 'student', grade: 'Grade 10', field: '', age: 16, at: 1 };
// Google's sign-in page, faked: it sends the student back to the app like Google does (#id_token=…&state=…),
// with a token for the nonce it was given. ctx.google says who signs in: { sub, email, badSig }, { cancel: true }
// (Google's "access_denied"), or { stay: true } (the student just sits on Google's page).
async function fakeGoogle(ctx) {
  await ctx.route(/accounts\.google\.com\/o\/oauth2\/v2\/auth/, async (route) => {
    const q = new URL(route.request().url()).searchParams, who = ctx.google || {};
    const back = q.get('redirect_uri');
    if (who.stay) return route.fulfill({ contentType: 'text/html', body: '<title>Sign in with Google</title><p>Choose an account</p>' });
    const answer = who.cancel ? new URLSearchParams({ state: q.get('state'), error: 'access_denied' })
      : new URLSearchParams({ state: q.get('state'), id_token: await idToken({ provider: 'google', sub: who.sub, email: who.email, badSig: who.badSig, nonce: q.get('nonce') }), authuser: '0' });
    ctx.googleAsked = { clientId: q.get('client_id'), back, type: q.get('response_type') };
    return route.fulfill({ contentType: 'text/html', body: `<script>location.replace(${JSON.stringify(back + '#' + answer)})</script>` });
  });
}
// tap "Continue with Google" as someone, and wait until Cassie's page is back
async function googleTap(page, ctx, who) {
  ctx.google = who;
  await page.click('.auth-google');
  await page.waitForURL(/app\.html$/, { timeout: 15000 });
}
// an ID token signed with the fake server's test keys (like Google's or Apple's)
const idToken = async (o) => (await fetch(SERVER + '/__idtoken', { method: 'POST', body: JSON.stringify(o) })).text();
async function open(browser, { server = true, state = {}, fakeGroq, lite = 'on', device = 'Pixel 7', viewport, touch, scale, setup } = {}) {
  const ctx = await browser.newContext({ ...devices[device], ...(viewport ? { viewport } : {}), ...(touch ? { hasTouch: true } : {}), ...(scale ? { deviceScaleFactor: scale } : {}), acceptDownloads: true });
  const seed = state && { profile: PROFILE, seenVersion: APP_VERSION, analytics: { usage: true, topics: false }, lite, tab: 'chat', plan: { plan: 'pro', until: 0 }, ...state }; // (Pro, so the Plus extras are there; a test passes plan: null for Free)
  await ctx.addInitScript(([srv, seedJson]) => {
    window.CASSIE_SERVER = srv; // '' = no server (never the real one in tests)
    if (seedJson && !sessionStorage.getItem('seeded')) { sessionStorage.setItem('cassie.deskPage', 'chat'); /* (a computer starts on Home, with no ask box: the tests start in a new chat, and the dashboard tests open Home) */ localStorage.setItem('cassie.v2', seedJson); localStorage.setItem('cassie.labs.ui', '{"tries":"max"}'); sessionStorage.setItem('seeded', '1'); } // (the tests read the goals: keep "Try this" open on phone screens)
  }, [server ? SERVER : '', seed ? JSON.stringify(seed) : '']);
  await ctx.route(/pollinations\.ai/, (route) => route.fulfill({ body: PNG, contentType: 'image/png' }));
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await ctx.route(/workers\.dev/, (route) => route.abort()); // never touch the real Cassie server
  await fakeGoogle(ctx); // never the real Google
  await ctx.route(/appleid\.apple\.com/, (route) => route.abort()); // never the real Apple (a test brings its own)
  if (setup) await setup(ctx);
  await ctx.route(/wikipedia\.org|worldbank\.org/, (route) => route.abort()); // the atlas's live lookups (a test brings its own)
  const groqCalls = [];
  await ctx.route(/api\.groq\.com/, async (route) => {
    const req = route.request();
    if (req.url().endsWith('/models')) return route.fulfill({ json: { data: [{ id: 'openai/gpt-oss-120b' }, { id: 'llama-3.3-70b-versatile' }, { id: 'meta-llama/llama-4-scout-17b-16e-instruct' }] } });
    const body = JSON.parse(req.postData() || '{}');
    groqCalls.push(body);
    const out = fakeGroq ? await fakeGroq(body, groqCalls.length) : { text: 'Own-key answer.' };
    if (out.status) return route.fulfill({ status: out.status, json: { error: { message: out.message || 'error' } }, headers: out.headers || {} });
    if (body.stream) { // like Groq: the answer as server-sent events, a few words at a time
      const sse = (out.text.match(/\S+\s*/g) || [out.text]).map((w) => `data: ${JSON.stringify({ choices: [{ delta: { content: w } }] })}\n\n`).join('') + 'data: [DONE]\n\n';
      return route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: sse });
    }
    return route.fulfill({ json: { choices: [{ message: { role: 'assistant', content: out.text } }] } });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(APP);
  return { ctx, page, errors, groqCalls };
}
// A lab card says "Opening…" at once and opens its lab a frame later (so the tap shows at once): wait for it
// Labs is open: the shelf on a computer, the Labs tab on a phone
const LABS_READY = '.labs:not([hidden]) :is(.labs-card, .lp-card, .lp-row) >> visible=true'; // (the first one that shows: a list can hide the others)
async function openCard(page, sel) {
  // a phone: the Labs tab has no shelf grid; find the lab under its filter, as a student would, and tap its row
  const id = (sel.match(/data-lab="([^"]+)"/) || [])[1];
  if (id && !(await page.locator(sel).first().isVisible().catch(() => false)) && await page.locator('.labs:not([hidden]) .lp:not([hidden])').count()) {
    for (const chip of ['3d', 'science', 'maths', 'tools', 'games']) {
      await page.click(`.lp-chips [data-lp="${chip}"]`);
      if (await page.locator(`.lp-row[data-lab="${id}"]`).count()) { sel = `.lp-row[data-lab="${id}"]`; break; }
    }
  }
  await page.click(sel);
  await page.waitForSelector('.lab-view:not([hidden]) .lab-controls > *, .x3d:not([hidden])', { timeout: 20000 });
}
// the 3D models are opened from Labs (the 3D shelf)
// Labs and Settings: a button in the top bar on a computer, a tab in the tab bar on a phone
const tapLabs = async (page) => { if (await page.locator('.labs:not([hidden]) .labs-shelf:not([hidden])').count()) return; await page.click(await page.locator('#labs-btn').isVisible() ? '#labs-btn' : '#tabbar [data-tab="labs"]'); }; // (already on the shelf: nothing to tap)
const tapSettings = async (page) => { await page.click(await page.locator('#settings-btn').isVisible() ? '#settings-btn' : '#tabbar [data-tab="you"]'); await page.evaluate(() => setPage('all')); }; // (You opens your profile first)
async function open3d(page, id) {
  await tapLabs(page);
  await page.waitForSelector(LABS_READY, { timeout: 20000 });
  if (await page.locator('.lp:not([hidden])').count()) { await page.click('.lp-chips [data-lp="3d"]'); await openCard(page, `.lp-row[data-lab="${id}"]`); return; } // (a phone: the Labs tab's 3D list)
  await page.click('.labs-chips [data-subject="3d"]');
  await openCard(page, `.labs-grid [data-lab="${id}"]`);
}
// waits for some text in a part of the page, checking on a timer (a page busy drawing 3D in
// software barely gets to draw a frame, and the usual frame-by-frame check then times out)
const seen = (page, sel, text = '', timeout = 30000) => page.waitForFunction(([s, t]) => [...document.querySelectorAll(s)].some((e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden' && e.textContent.includes(t)), [sel, text], { timeout, polling: 250 });
async function ask(page, text) {
  await page.evaluate(() => { if (document.body.classList.contains('desk-on')) deskGo('chat'); }); // (a computer's dashboard pages have no ask box)
  const before = await page.locator('#chat-log .bubble-assistant').count();
  await page.fill('#prompt-input', text);
  await page.press('#prompt-input', 'Enter');
  await page.waitForFunction((n) => {
    const all = document.querySelectorAll('#chat-log .bubble-assistant');
    const last = all[all.length - 1];
    return all.length > n && last && !last.querySelector('.typing-dots');
  }, before, { timeout: 20000 });
  return page.locator('#chat-log .bubble-assistant').last();
}
async function serverMode(m) {
  return (await fetch(`${SERVER}/__mode`, { method: 'POST', body: JSON.stringify(m) })).json();
}
async function serverStats() {
  return (await fetch(`${SERVER}/stats?days=7`, { headers: { authorization: 'Bearer test-admin-token-0123456789' } })).json();
}
function expect(cond, msg) { if (!cond) throw new Error(msg); }

/* ---------- the tests ---------- */
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
// the slowest tests (40 seconds or more each): the full suite runs them, the fast one (SUITE=fast) skips them
test.slow = (name, fn) => tests.push({ name, fn, slow: true });

// the first run: past Welcome, Intro (Get started) and the four questions (answers given, else Skip for now), to the sign-in page
async function toSignIn(page, answers = {}) {
  await page.waitForSelector('.fr-start', { timeout: 8000 });
  await page.click('.fr-start');
  await onboard(page, answers);
  await page.waitForSelector('.auth-page', { timeout: 5000 });
}
// the four questions (from the first one left out, Skip for now)
async function onboard(page, { name, who, age, goals = [], style } = {}) {
  await page.waitForSelector('.fr-ob', { timeout: 8000 });
  const steps = [
    name && (async () => { await page.fill('.fr-ob input[name=name]', name); }),
    who && (async () => { await page.click(`.fr-ob [data-who=${who}]`); if (age != null) await page.fill('.fr-ob input[name=age]', String(age)); }),
    goals.length && (async () => { for (const g of goals) await page.click(`.fr-ob [data-goal=${g}]`); }),
    style && (async () => { await page.click(`.fr-ob [data-style=${style}]`); }),
  ];
  for (let k = 0; k < 4; k++) {
    await page.waitForSelector(`.fr-count >> text=${k + 1} of 4`, { timeout: 5000 });
    if (!steps.slice(k).some(Boolean)) { await page.click('.fr-skip'); break; }
    if (steps[k]) await steps[k]();
    await page.click('.fr-go');
  }
  await page.waitForSelector('.fr', { state: 'detached', timeout: 5000 });
}

test('first run: Welcome, Intro, Sign in, then four questions a screen at a time (Back, Skip, a reload carries on), saving the same profile; a returning student goes straight in', async (b) => {
  let { ctx, page, errors } = await open(b, { state: null });
  // 1. Welcome: Cassie, her name, one line and a loading indicator, for a moment
  await page.waitForSelector('.fr-welcome', { timeout: 5000 });
  const w = await page.locator('.fr-welcome').innerText();
  expect(/Cassie/.test(w) && /Your study buddy\./.test(w) && await page.locator('.fr-welcome [role=progressbar]').count() === 1, 'the welcome: ' + w);
  const t0 = Date.now();
  // 2. Intro: one card and a big Get started
  await page.waitForSelector('.fr-intro', { timeout: 4000 });
  const waited = Date.now() - t0;
  expect(waited < 3000, 'the welcome shows for 1 to 3 seconds: ' + waited);
  expect(/Study smarter with Cassie/.test(await page.locator('.fr-intro').innerText()), 'the intro says what Cassie is');
  if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/fr-intro.png' });
  expect(await page.locator('.fr-intro button').count() === 1 && await page.locator('.fr-intro .fr-start').innerText() === 'Get started', 'one button: Get started');
  await page.click('.fr-start');
  // 3. The questions: 1 of 4 to 4 of 4
  await page.waitForSelector('.fr-ob', { timeout: 5000 });
  expect(/1 of 4/.test(await page.locator('.fr-count').innerText()) && /What should Cassie call you\?/.test(await page.locator('.fr-h').innerText()), 'step 1: the name');
  await page.click('.fr-go');
  expect(/Type your name/.test(await page.locator('.fr-err').innerText()), 'Next with no name says what to do');
  await page.fill('.fr-ob input[name=name]', 'Hazel');
  if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/fr-1.png' });
  await page.click('.fr-go');
  await page.waitForSelector('.fr-count >> text=2 of 4');
  expect(/Where are you in your learning\?/.test(await page.locator('.fr-h').innerText()), 'step 2: where you are');
  // Back keeps the answer
  await page.click('.fr-back');
  await page.waitForSelector('.fr-count >> text=1 of 4');
  expect(await page.inputValue('.fr-ob input[name=name]') === 'Hazel', 'Back keeps the name');
  await page.click('.fr-go');
  await page.waitForSelector('.fr-count >> text=2 of 4');
  const levels = await page.$$eval('.fr-ob [data-who]', (o) => o.map((x) => x.textContent));
  expect(levels.join('|') === 'Nursery or Kindergarten|Elementary|Junior High|Senior High|College / University|Reviewing for a board exam|Teacher or parent|Working / lifelong learner', 'everyone has a pill: ' + levels);
  await page.click('.fr-go');
  expect(/Tap the one that fits you/.test(await page.locator('.fr-err').innerText()), 'Next with no pick says what to do');
  await page.click('.fr-ob [data-who=jhs]');
  await page.fill('.fr-ob input[name=age]', '15');
  // a reload carries on at the same step, with the answers
  await page.reload();
  await page.waitForSelector('.fr-count >> text=2 of 4', { timeout: 5000 });
  expect(!(await page.locator('.fr-welcome, .fr-intro').count()), 'no welcome or intro again mid-way');
  expect(await page.getAttribute('.fr-ob [data-who=jhs]', 'aria-checked') === 'true' && await page.inputValue('.fr-ob input[name=age]') === '15', 'the answers are back after a reload');
  if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/fr-2.png' });
  await page.click('.fr-go');
  await page.waitForSelector('.fr-count >> text=3 of 4');
  await page.click('.fr-ob [data-goal=exam]'); await page.click('.fr-ob [data-goal=labs]');
  if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/fr-3.png' });
  await page.click('.fr-go');
  await page.waitForSelector('.fr-count >> text=4 of 4');
  expect(/Start studying/.test(await page.locator('.fr-go').innerText()), 'the last step says Start studying');
  await page.click('.fr-ob [data-style=deep]');
  if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/fr-4.png' });
  await page.click('.fr-go');
  await page.waitForSelector('.fr', { state: 'detached', timeout: 5000 });
  // 4. Then sign in: Google and Apple come first (when the server has them), then email, then a guest
  await page.waitForSelector('.auth-page', { timeout: 5000 });
  expect(await page.evaluate(() => { const p = document.querySelector('.auth-providers'), e = document.querySelector('.auth-page input[name=email]'); return !!(p.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING); }), 'Google and Apple above email');
  expect(await page.locator('.auth-skip').innerText() === 'Continue as a guest', 'Continue as a guest');
  expect(await page.inputValue('.auth-form input[name=age]') === '15', 'the age from the questions is filled in for signing up');
  if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/fr-signin.png' });
  await page.click('.auth-skip');
  await page.waitForFunction(() => !document.querySelector('.auth-page') && document.activeElement && document.activeElement.id === 'prompt-input', null, { timeout: 5000 });
  const st = await page.evaluate(() => JSON.parse(localStorage.getItem('cassie.v2')));
  const p = st.profile;
  expect(p && p.name === 'Hazel' && p.grade === 'Junior High' && p.age === 15 && p.gender === 'none' && p.role === 'student' && p.field === '' && p.at > 0, 'the profile, as the old form saved it: ' + JSON.stringify(p));
  expect(st.audience === 'student' && st.level === 'middle' && st.analytics.usage === true && st.analytics.topics === false, 'audience, level and counts as before: ' + JSON.stringify([st.audience, st.level, st.analytics]));
  expect(JSON.stringify(st.helpWith) === '["exam","labs"]' && st.answerStyle === 'deep', 'what they came for, and how they like to learn: ' + JSON.stringify([st.helpWith, st.answerStyle]));
  expect(await page.evaluate(() => localStorage.getItem('cassie.firstRun')) === null, 'the first run is finished');
  // a returning student goes straight in (no welcome)
  await page.reload();
  await page.waitForTimeout(1000);
  expect(!(await page.locator('.fr, .auth-page').count()), 'no first run for a returning student');
  // and from the website's Open Cassie: the welcome for under a second, then straight in
  const t1 = Date.now();
  await page.goto(APP.replace('app.html', 'start.html'));
  await page.waitForURL(/app(\.html)?$/, { timeout: 5000 });
  const took = Date.now() - t1;
  expect(took < 1500, 'start.html goes in quickly: ' + took + 'ms'); // (its welcome shows 0.4s; the rest is loading)
  await page.waitForTimeout(600);
  expect(!(await page.locator('.fr, .auth-page').count()), 'straight to the home screen');
  expect(errors.length === 0, 'page errors: ' + errors.join('; '));
  await ctx.close();
  // Skip on every step: still a profile, with nothing made up
  ({ ctx, page, errors } = await open(b, { state: null }));
  await toSignIn(page);
  await page.click('.auth-skip');
  await page.waitForSelector('.auth-page', { state: 'detached', timeout: 5000 });
  const q = await page.evaluate(() => JSON.parse(localStorage.getItem('cassie.v2')).profile);
  expect(q && q.name === '' && q.grade === '' && q.age === 0 && q.gender === 'none', 'skipped: an empty profile: ' + JSON.stringify(q));
  expect(await page.waitForFunction(() => document.activeElement && document.activeElement.id === 'prompt-input', null, { timeout: 3000 }).then(() => true, () => false), 'skipped: straight to the ask box');
  expect(errors.length === 0, 'page errors: ' + errors.join('; '));
  await ctx.close();
});

test('the four first questions fit everyone: name, where you are, what brings you, how you like to learn; Home greets you by name and puts what you came for first; Skip for now on any screen goes straight to the ask box', async (b) => {
  let { ctx, page, errors } = await open(b, { state: null, device: 'iPhone 13', viewport: { width: 360, height: 740 } });
  await page.waitForSelector('.fr-start', { timeout: 8000 }); await page.click('.fr-start');
  await page.waitForSelector('.fr-ob', { timeout: 5000 });
  const skip = await page.evaluate(() => { const k = document.querySelector('.fr-skip'), r = k.getBoundingClientRect(); return { text: k.textContent, top: r.top, right: innerWidth - r.right, h: r.height, wide: document.documentElement.scrollWidth <= innerWidth }; });
  expect(skip.text === 'Skip for now' && skip.top < 80 && skip.right < 40 && skip.h >= 43.5 && skip.wide, 'Skip for now sits in the top corner, 44px, no sideways scroll at 360px: ' + JSON.stringify(skip));
  await onboard(page, { name: 'Haze', who: 'board', age: 23, goals: ['read'], style: 'deep' });
  await page.waitForSelector('.auth-page', { timeout: 5000 }); await page.click('.auth-skip');
  expect(await page.waitForFunction(() => document.activeElement && document.activeElement.id === 'prompt-input', null, { timeout: 3000 }).then(() => true, () => false), 'done: straight to the ask box');
  expect(!(await page.locator('.tour-offer, .fr, .plus-sheet').count()), 'no extra screen after the questions');
  const r = await page.evaluate(() => ({ p: state.profile, line: profileLine(state.profile), sys: buildSystemPrompt({ tutor: true }), level: state.level }));
  expect(r.p.grade === 'Board exam reviewee' && r.level === 'college' && /reviewing for a board exam/.test(r.line), 'a board exam reviewee: ' + JSON.stringify([r.p, r.level]));
  expect(/They like deep answers/.test(r.sys), 'how they like to learn reaches Cassie');
  await page.evaluate(() => window.CassieNative.go('home'));
  await page.waitForSelector('#home .hub-me', { timeout: 5000 });
  expect(/^(Morning|Afternoon|Evening), Haze$/.test(await page.locator('#home .hub-me').innerText()), 'Home greets them by name');
  const boxes = await page.$$eval('#home .hub-box', (bs) => bs.map((x) => x.dataset.hub));
  expect(boxes[0] === 'research', 'readings and PDFs put Research first: ' + boxes);
  expect(!errors.length, 'page errors: ' + errors.join('; '));
  await ctx.close();
  // Skip for now on the first screen
  ({ ctx, page, errors } = await open(b, { state: null }));
  await page.waitForSelector('.fr-start', { timeout: 8000 }); await page.click('.fr-start');
  await page.waitForSelector('.fr-count >> text=1 of 4', { timeout: 5000 });
  await page.click('.fr-skip');
  await page.waitForSelector('.auth-page', { timeout: 5000 }); await page.click('.auth-skip');
  await page.waitForFunction(() => !document.querySelector('.fr') && document.activeElement && document.activeElement.id === 'prompt-input', null, { timeout: 5000 });
  expect(await page.evaluate(() => !!state.profile && state.setupLater === false && localStorage.getItem('cassie.firstRun') === null), 'skipped: a profile, and the first run is over');
  expect(!(await page.locator('.tour-offer').count()), 'skipped: no tour popping up');
  expect(!errors.length, 'page errors: ' + errors.join('; '));
  await ctx.close();
});

test('web search for everyone: with no Gemini key of their own, Web asks Cassie’s server, which answers from Google Search with Sources; a question about a show gets a Search the web chip under the answer; past the daily cap a kind message', async (b) => {
  await fetch(`${SERVER}/__reset`);
  const gem0 = (await serverMode({})).gemini; // (the server's Gemini key is on unless 'off')
  await serverMode({ groq: 'ok', ai: 'ok', gemini: gem0 === 'off' ? 'busy' : gem0, webDaily: 2, webSearch: 'ok', webCalls: [] });
  const { ctx, page, errors } = await open(b, {});
  try {
    expect(await page.evaluate(() => !state.geminiKey), 'no Gemini key of their own');
    await ask(page, 'What is the plot of the drama Doctor X?');
    await page.waitForSelector('#chat-log .web-chip', { timeout: 5000 });
    const chip = await page.locator('#chat-log .web-chip').boundingBox();
    expect(/Search the web/.test(await page.locator('#chat-log .web-chip').innerText()) && chip.height >= 43.5, 'the chip: Search the web, 44px');
    const before = await page.locator('#chat-log .bubble-assistant').count();
    await page.click('#chat-log .web-chip');
    await page.waitForFunction((n) => document.querySelectorAll('#chat-log .bubble-assistant').length > n && /Sources/.test([...document.querySelectorAll('#chat-log .bubble-assistant')].at(-1).innerText), before, { timeout: 10000 });
    const last = await page.locator('#chat-log .bubble-assistant').last().innerText();
    expect(/freelance surgeon/.test(last) && /example\.com/.test(last) && /example\.org/.test(last), 'the answer from the web, with its Sources: ' + last);
    const calls = (await serverMode({})).webCalls || [];
    expect(calls.length === 1 && /Doctor X/.test(calls[0].q) && calls[0].system, 'the server searched once with the question: ' + JSON.stringify(calls));
    expect(!(await page.locator('#chat-log .web-chip').count()), 'the chip is gone once used');
    // a question that isn't about the world or anything recent: no chip
    await ask(page, 'Explain photosynthesis simply');
    expect(!(await page.locator('#chat-log .bubble-assistant').last().locator('.web-chip').count()), 'no chip on a school question');
    // the daily cap (2 here): the 2nd search works, the 3rd says so kindly and nothing is searched
    await page.evaluate(() => runWebCheck('Latest Doctor X season?'));
    await page.waitForFunction(() => (document.querySelectorAll('#chat-log .bubble-assistant') || []).length && /Sources/.test([...document.querySelectorAll('#chat-log .bubble-assistant')].at(-1).innerText), null, { timeout: 10000 });
    await page.evaluate(() => runWebCheck('Who stars in Doctor X?'));
    await page.waitForFunction(() => /used today’s 2 free web searches/.test(document.getElementById('chat-log').innerText), null, { timeout: 10000 });
    const msg = await page.evaluate(() => document.getElementById('chat-log').innerText.match(/You’ve used today’s 2 free web searches[^\n]*/)[0]);
    expect(/come back at midnight/.test(msg) && /Plus and Pro get 30 a day/.test(msg) && !/[–—]/.test(msg), 'the cap message: ' + msg);
    expect(((await serverMode({})).webCalls || []).length === 2, 'nothing searched past the cap');
    expect(!errors.length, 'page errors: ' + errors.join('; '));
  } finally { await ctx.close(); await serverMode({ gemini: gem0, webDaily: null, webCalls: [] }); await fetch(`${SERVER}/__reset`); }
});

test('the service worker: a file with its version in the address (app.js?v=…) comes from the device once fetched (no network), a file without one is still checked with the network each time', async () => {
  const handlers = [], store = new Map(), fetched = [];
  const cacheObj = { match: async (r) => store.get(typeof r === 'string' ? r : r.url), put: async (r, res) => { store.set(typeof r === 'string' ? r : r.url, res); }, addAll: async () => {} };
  const self = { location: { origin: 'https://askcassie.study' }, addEventListener: (t, f) => { if (t === 'fetch') handlers.push(f); }, skipWaiting() {}, clients: { claim() {} }, registration: { scope: 'https://askcassie.study/' } };
  const caches = { open: async () => cacheObj, match: async (r) => store.get(r.url || r), keys: async () => [], delete: async () => true };
  const fakeFetch = async (r) => { const url = typeof r === 'string' ? r : r.url; fetched.push(url); return new Response('file ' + url, { status: 200 }); };
  new Function('self', 'caches', 'fetch', fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8'))(self, caches, fakeFetch);
  const get = async (url) => {
    let p = null;
    const ev = { request: new Request(url), respondWith: (x) => { p = x; } };
    for (const h of handlers) h(ev);
    return p ? (await p).text() : null;
  };
  const V = 'https://askcassie.study/app.js?v=181', plain = 'https://askcassie.study/icons/icon-192.png';
  expect(/file/.test(await get(V)) && /file/.test(await get(V)), 'the versioned file loads both times');
  expect(fetched.filter((u) => u === V).length === 1, 'a versioned file: the network once, then the device: ' + JSON.stringify(fetched));
  await get(plain); await get(plain);
  expect(fetched.filter((u) => u === plain).length === 2, 'a file without a version: checked with the network each time: ' + JSON.stringify(fetched));
});

test('a server that never answers: the chat gives up with a plain message (no endless spinner)', async (b) => {
  const { ctx, page, errors } = await open(b, {});
  try {
    let hang = true;
    await page.route(/\/chat$/, async (route) => { if (hang) return; return route.continue(); }); // (never answered while hang is on)
    await page.evaluate(() => { SERVER_WAIT.chat = 1500; });
    const t0 = Date.now();
    await page.fill('#prompt-input', 'What is osmosis?');
    await page.press('#prompt-input', 'Enter');
    await page.waitForSelector('#chat-log .bubble-assistant.error', { timeout: 8000 });
    const msg = await page.locator('#chat-log .bubble-assistant.error').last().innerText();
    expect(/took too long/.test(msg) && Date.now() - t0 < 8000, 'a plain message, soon: ' + msg);
    expect(!(await page.locator('#chat-log .typing, #chat-log .bubble-typing').count()), 'no spinner left behind');
    hang = false;
    expect(!errors.length, 'page errors: ' + errors.join('; '));
  } finally { await ctx.close(); }
});

test('a simpler start: a brand-new student sees their 4 most useful tools on Home and More tools for the rest (what they came for first); a returning one sees them all; API keys sit in Settings, Advanced, not under Account', async (b) => {
  const { ctx, page, errors } = await open(b, { device: 'iPhone 13', state: { helpWith: ['labs'], tab: 'home' } });
  try {
    await page.evaluate(() => window.CassieNative && window.CassieNative.go('home'));
    await page.waitForSelector('#home .hub-box', { timeout: 8000 });
    const first = await page.$$eval('#home .hub-box', (bs) => bs.map((x) => x.dataset.hub));
    expect(first.length === 4 && first[0] === 'lab' && first.includes('games'), 'new: 4 boxes, labs first for a labs fan: ' + first);
    const more = page.locator('#home .hub-more');
    const bb = await more.boundingBox();
    expect(/More tools/.test(await more.innerText()) && bb.height >= 44, 'More tools, 44px');
    await more.click();
    const all = await page.$$eval('#home .hub-box', (bs) => bs.map((x) => x.dataset.hub));
    expect(all.length > 4 && all.includes('room') && !(await page.locator('#home .hub-more').count()), 'More tools shows the rest (the study room too): ' + all);
    // a returning student (a chat already) on a phone: with goals, still their 4 and More tools; with none, every box at once
    await page.evaluate(() => { state.chats.push({ id: 'c1', title: 'Cells', messages: [{ role: 'user', content: 'hi' }], updatedAt: Date.now() }); hubMoreOpen = false; save(); refreshHub(); });
    await page.waitForFunction(() => document.querySelectorAll('#home .hub-box').length === 4 && document.querySelector('#home .hub-more'), null, { timeout: 5000 });
    await page.evaluate(() => { state.helpWith = []; save(); refreshHub(); });
    await page.waitForFunction(() => document.querySelectorAll('#home .hub-box').length > 4 && !document.querySelector('#home .hub-more'), null, { timeout: 5000 });
    // API keys: under Advanced, not Account
    const where = await page.evaluate(() => { const k = document.getElementById('settings-keys'); return { sec: k.closest('.set-sec').dataset.sec, title: k.closest('.set-sec').querySelector('.set-sec-h').textContent }; });
    expect(where.sec === 'advanced' && where.title === 'Advanced', 'API keys are in Advanced: ' + JSON.stringify(where));
    expect(!errors.length, 'page errors: ' + errors.join('; '));
  } finally { await ctx.close(); }
});

test('an account keeps the study streak and Labs progress: cleared from the browser, they come back on sign in (the later streak wins), and the privacy page says so', async (b) => {
  const { ctx, page, errors } = await open(b, { server: false, state: { groqKey: 'gsk_test' } });
  try {
    await page.waitForFunction(() => !!window.CassieMemory);
    const day = await page.evaluate(() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); });
    const saved = await page.evaluate((today) => {
      localStorage.setItem('cassie.mem.v1', JSON.stringify({ v: 1, topics: {}, facts: [], streak: { count: 6, lastDay: today }, focusMinutes: 90 }));
      localStorage.setItem('cassie.labs', JSON.stringify({ 'cell-explorer': [true, false, true] }));
      return null;
    }, day);
    await page.reload(); await page.waitForFunction(() => !!window.CassieMemory);
    const data = await page.evaluate(() => accountData());
    expect(data.streak && data.streak.count === 6 && data.streak.lastDay === day && data.labs['cell-explorer'][2] === true, 'the account gets the streak and the Labs ticks: ' + JSON.stringify([data.streak, data.labs]));
    expect(!JSON.stringify(data.streak).includes('topic'), 'only numbers and a date, never what was studied');
    // the browser is cleared, then the account comes back
    const back = await page.evaluate((d) => { window.CassieMemory.clearAll(); localStorage.removeItem('cassie.labs'); applyAccountData(d); return { streak: window.CassieMemory.stats().streak, labs: labsProgress() }; }, data);
    expect(back.streak === 6 && back.labs['cell-explorer'][0] === true && back.labs['cell-explorer'][1] === false, 'back after clearing: ' + JSON.stringify(back));
    // a longer streak already on this device is kept
    const kept = await page.evaluate((d) => { window.CassieMemory.mergeStreak({ count: 2, lastDay: d.streak.lastDay }); return window.CassieMemory.stats().streak; }, data);
    expect(kept === 6, 'the longer streak stays: ' + kept);
    expect(/study streak/.test(fs.readFileSync(path.join(ROOT, 'privacy.html'), 'utf8')) && /Learn tries/.test(fs.readFileSync(path.join(ROOT, 'privacy.html'), 'utf8')), 'the privacy page says the streak and Labs progress go with an account');
    expect(!errors.length, 'page errors: ' + errors.join('; '));
  } finally { await ctx.close(); }
});

test('an update reaches every device: the pages, the service worker cache and the Labs modules (the Museum too) carry one version, so a browser never keeps an old Labs', async () => {
  const read = (f) => fs.readFileSync(require('path').join(ROOT, f), 'utf8');
  const v = (read('sw.js').match(/cassie-v(\d+)/) || [])[1];
  const pages = ['app.html', 'start.html', 'index.html', 'bot.html', 'rescue.html', 'let.html'].map((f) => [f, [...read(f).matchAll(/\.(?:js|css)\?v=(\d+)/g)].map((m) => m[1])]);
  const off = pages.filter(([, vs]) => vs.some((x) => x !== v)).map(([f]) => f);
  expect(v && !off.length, 'pages on another version than the service worker (cassie-v' + v + '): ' + off.join());
  const app = read('app.js'), labs = read('labs/labs.js');
  expect(app.includes("import('./labs/labs.js?v=" + v + "')"), 'the app loads Labs with the current version');
  expect(labs.includes("from './museum.js?v=" + v + "'"), 'Labs loads the Museum with the current version');
  expect(app.includes("import('./explore/cell3d.js?v=" + v + "')"), 'the app loads the 3D views (the human body) with the current version');
});

test('questions first: a new user sees one Get started button, answers the 4 questions, then the sign-in page offers Continue as a guest, and a guest lands on the ask box with the profile saved; a reload goes straight in', async (b) => {
  for (const [device, viewport] of [['Pixel 7', undefined], ['Desktop Chrome', { width: 1280, height: 800 }]]) {
    const { ctx, page, errors } = await open(b, { state: null, device, viewport });
    try {
      await page.waitForSelector('.fr-intro .fr-start', { timeout: 8000 });
      expect(await page.locator('.fr-intro .fr-start').innerText() === 'Get started' && !(await page.locator('.fr-intro .fr-ask').count()), `${device}: one Get started, no Ask your first question`);
      expect(await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('fr-start')), `${device}: Get started has focus`);
      await page.click('.fr-intro .fr-start');
      await page.waitForSelector('.fr-ob', { timeout: 5000 });
      expect(!(await page.locator('.auth-page').count()), `${device}: the questions come before signing in`);
      await onboard(page, { name: 'Lia', who: 'college', age: 19, goals: ['homework'], style: 'brief' });
      await page.waitForSelector('.auth-page', { timeout: 5000 });
      expect(/Continue as a guest/.test(await page.locator('.auth-skip').innerText()) && await page.locator('.auth-skip').isVisible(), `${device}: then the sign-in page, with Continue as a guest`);
      await page.click('.auth-skip');
      await page.waitForFunction(() => !document.querySelector('.auth-page, .fr') && document.activeElement && document.activeElement.id === 'prompt-input', null, { timeout: 5000 });
      const st = await page.evaluate(() => ({ p: state.profile, help: state.helpWith, style: state.answerStyle, guest: state.skippedAuth, fr: localStorage.getItem('cassie.firstRun') }));
      expect(st.p && st.p.name === 'Lia' && st.p.grade === 'College' && st.p.age === 19 && JSON.stringify(st.help) === '["homework"]' && st.style === 'brief' && st.guest === true && st.fr === null, `${device}: the guest's answers are kept: ` + JSON.stringify(st));
      await page.reload();
      await page.waitForSelector('#prompt-input');
      await page.waitForTimeout(800);
      expect(!(await page.locator('.fr, .auth-page').count()), `${device}: a reload goes straight back in`);
      expect(!errors.length, `${device}: page errors: ` + errors.join('; '));
    } finally { await ctx.close(); }
  }
});

test('every age is welcome: nursery to work, with an account too', async (b) => {
  const { ctx, page } = await open(b, { state: null });
  await toSignIn(page, { name: 'Mia', who: 'elem', age: 4 });
  expect(await page.locator('.auth-brand svg').count() === 1 && !(await page.locator('img[src*="cassie-hero"]').count()), 'the sign-in page shows Cassie’s logo, not the 3D picture');
  expect(!/13 and up/.test(await page.locator('.auth-page').innerText()), 'no age limit on the sign-in page');
  const signupStatus = (body) => page.evaluate(async ([srv, bb]) => (await fetch(srv + '/auth/signup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(bb) })).status, [SERVER, body]);
  expect(await signupStatus({ email: `kid${Date.now()}@example.com`, password: 'secret-pass-1', age: 6 }) === 200, 'a 6-year-old can make an account');
  await page.click('.auth-skip');
  await page.waitForSelector('.auth-page', { state: 'detached', timeout: 5000 });
  const r = await page.evaluate(() => ({ p: state.profile, an: state.analytics, line: profileLine(state.profile) }));
  expect(r.p.age === 4 && r.p.grade === 'Elementary', 'a 4-year-old can use Cassie: ' + JSON.stringify(r.p));
  await page.evaluate(() => openProfile(false));
  const all = await page.$$eval('.profile-card select[name=grade] option', (o) => o.map((x) => x.textContent));
  expect(all.includes('Nursery') && all.includes('Elementary') && all.includes('4th year college') && all.includes('Board exam reviewee') && all.includes('Working professional') && await page.inputValue('.profile-card select[name=grade]') === 'Elementary', 'the profile form has every level, and shows the one picked: ' + all);
  await page.evaluate(() => document.querySelector('.profile-overlay').remove());
  expect(!r.an.usage && !r.an.topics, 'nothing is counted for a young child');
  expect(/very young child/.test(r.line), 'Cassie talks simply to a little one');
  // a working person
  await page.evaluate(() => openProfile(false));
  await page.selectOption('.profile-card select[name=grade]', 'Working professional');
  await page.fill('.profile-card input[name=age]', '30');
  await page.click('.profile-card .pf-go');
  await page.waitForSelector('.profile-overlay', { state: 'detached' });
  expect(await page.evaluate(() => state.profile.role === 'pro' && state.audience === 'pro'), 'Working professional sets the professional mode');
  await ctx.close();
});

test('accounts: sign up, profile syncs, sign in on another device gets it back', async (b) => {
  const email = `hazel${Date.now()}@example.com`;
  // device 1: answer the profile questions, then create an account
  let { ctx, page } = await open(b, { state: null });
  await toSignIn(page, { name: 'Hazel', who: 'shs', age: 16 });
  expect(await page.inputValue('.auth-form input[name=age]') === '16', 'the age from the questions is filled in');
  expect(await page.locator('.auth-title').textContent() === 'Create your Cassie account', 'should open on sign up');
  await page.fill('.auth-form input[name=email]', email);
  const signupStatus = (body) => page.evaluate(async ([srv, b]) => (await fetch(srv + '/auth/signup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).status, [SERVER, body]);
  expect(await signupStatus({ email: 'x@mailinator.com', password: 'secret-pass-1', age: 20 }) === 400, 'throwaway email allowed');
  await page.fill('.auth-form input[name=age]', '16');
  await page.fill('.auth-form input[name=password]', 'short');
  await page.click('.auth-go');
  expect(/at least 8 letters or numbers.*Add 3 more/.test(await page.locator('.auth-pw ~ .field-err, .auth-field .field-err:not([hidden])').last().textContent()), 'short password not caught under its field');
  await page.fill('.auth-form input[name=password]', 'secret-pass-1');
  await page.click('.auth-go');
  await page.waitForFunction(() => !document.querySelector('.auth-page, .fr') && document.activeElement && document.activeElement.id === 'prompt-input', null, { timeout: 10000 });
  expect(await page.evaluate(() => state.profile.name === 'Hazel' && localStorage.getItem('cassie.firstRun') === null), 'signed up: the answers are kept, no questions again, on to the ask box');
  await page.waitForFunction(() => lastSynced.includes('"name":"Hazel"'), null, { timeout: 5000 }); // (saved to the account)
  await page.waitForTimeout(800);
  await ctx.close();
  // device 2: sign in → the profile comes back, no questions asked
  ({ ctx, page } = await open(b, { state: null }));
  await toSignIn(page);
  await page.click('.auth-switch [data-to=signin]');
  await page.fill('.auth-form input[name=email]', email);
  await page.fill('.auth-form input[name=password]', 'wrong-password');
  await page.click('.auth-go');
  await page.waitForSelector('.auth-form .field-err:not([hidden])');
  expect(/don’t match/.test(await page.locator('.auth-form .field-err:not([hidden])').textContent()), 'wrong password not shown under the password');
  await page.fill('.auth-form input[name=password]', 'secret-pass-1');
  await page.click('.auth-go');
  await page.waitForSelector('.auth-page', { state: 'detached' });
  const p = await page.evaluate(() => state.profile);
  expect(p && p.name === 'Hazel' && p.grade === 'Senior High', 'profile did not come back: ' + JSON.stringify(p));
  expect(await page.locator('.profile-overlay, .fr').count() === 0, 'asked the profile questions again');
  await tapSettings(page);
  expect(/Signed in as/.test(await page.locator('#account-row').textContent()), 'settings should say signed in');
  await ctx.close();
});

/* ---------- Sign in with Google and Apple (fake server, test keys) ---------- */
// Apple's sign-in page, faked: it posts back to Cassie's server like Apple does (form_post), with an
// ID token for the nonce it was given, or "user_cancelled_authorize" when the test says cancel.
function fakeApple(who) {
  return (ctx) => ctx.route(/appleid\.apple\.com\/auth\/authorize/, async (route) => {
    const q = new URL(route.request().url()).searchParams;
    const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    const fields = who.cancel ? { state: q.get('state'), error: 'user_cancelled_authorize' }
      : { state: q.get('state'), id_token: await idToken({ provider: 'apple', sub: who.sub, email: who.email, nonce: q.get('nonce') }), user: JSON.stringify({ name: { firstName: 'Ana' } }) };
    expect(q.get('client_id') === 'test.apple.services' && q.get('response_mode') === 'form_post' && q.get('redirect_uri') === SERVER + '/auth/apple/callback', 'Apple was opened with the wrong settings: ' + route.request().url());
    return route.fulfill({ contentType: 'text/html', body: `<form method="post" action="${esc(q.get('redirect_uri'))}">${Object.entries(fields).map(([k, v]) => `<input type="hidden" name="${k}" value="${esc(v)}">`).join('')}</form><script>document.forms[0].submit()</script>` });
  });
}
const savedAccount = (page) => page.evaluate(() => ({ account: state.account, plan: state.plan, token: localStorage.getItem('cassie.auth') }));
const authErr = (page) => page.locator('.auth-err:not([hidden])').textContent();

// Google sends the student back only to addresses listed under "Authorized redirect URIs" for the
// OAuth client in Google Cloud Console, exactly. These are the ones registered there (server/README.md):
// change the app's return address and this list (and the console) together.
const GOOGLE_REDIRECT_URIS = ['https://askcassie.study/app.html'];
test('leftover code stays out: styles for the old phone Home and the old landing sections, and two functions nothing called, aren’t back', async () => {
  const css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8'), landing = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const gone = (src, names) => names.filter((n) => new RegExp('\\.' + n + '(?![\\w-])').test(src));
  const back = gone(css, ['home-head', 'home-hi', 'home-round', 'home-avatar', 'home-tiles', 'home-today', 'today-card', 'home-sec', 'home-link', 'recent', 'recent-go', 'home-ask', 'tile', 'chat-empty', 'home-bar', 'hub-head', 'hub-bot-s', 'hub-sub']);
  expect(!back.length, 'style.css has styles nothing uses again: ' + back.join(', '));
  const back2 = gone(landing, ['steps', 'step', 'bento', 'span2', 'span3', 'span4', 'span6']).concat(/\.tile\.(v|dark)\b/.test(landing) ? ['tile.v / tile.dark'] : []);
  expect(!back2.length, 'index.html has styles for sections it no longer has: ' + back2.join(', '));
  expect(!/function accentInk\b/.test(fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8')) && !/hasPreview/.test(fs.readFileSync(path.join(ROOT, 'labs/previews.js'), 'utf8')), 'accentInk and hasPreview are gone (nothing called them)');
  // the second sweep: a helper nothing calls, a mood map whose answer was always replaced, a style no page uses,
  // an attribute nothing reads, checks that can't fail, an option nobody passes, and a promo tool whose pictures nothing uses
  const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  const app = read('app.js');
  expect(!/const ago = /.test(read('native.js')), 'native.js: ago() is gone');
  expect(!/EMOTE_TO_3D/.test(app) && !/dataset\.aud = /.test(app), 'app.js: EMOTE_TO_3D and the doodle hook are gone');
  const always = app.match(/typeof (syncAccount|updateBackdrop|mascotSay|resetIdle|keepMascotClear|updateModelPill|authToken|setQuizLabel|renderChatList|set3D|updateMemoryDot|renderAudience|fillYou) === 'function'|typeof bot2d !== 'undefined'/g);
  expect(!always, 'app.js: no checks for functions that always exist: ' + always);
  expect(!/\.refer\b/.test(landing), 'index.html: the .refer style is gone');
  expect(!/opts\.clock|CASSIE_FLAT/.test(read('cassie-bot.js')), 'cassie-bot.js: the unused clock option is gone');
  expect(!/older Chrome/.test(read('extension/background.js') + read('extension/popup.js')), 'the extension needs Chrome 116+: no guards for older ones');
  expect(!fs.existsSync(path.join(ROOT, 'promo/hero/capture.cjs')) && !/capture\.cjs/.test(read('promo/README.md')), 'promo/hero/capture.cjs is gone');
  // (a plugin switched on for every Claude session in this project, from someone else's GitHub: not without asking)
  expect(!fs.existsSync(path.join(ROOT, '.claude/settings.json')) || !/enabledPlugins/.test(read('.claude/settings.json')), 'no third-party plugin is switched on for the project');
});

// The real server (server/worker.js) on a real SQLite database (Node's own, standing in for Cloudflare D1):
// every query it sends must be valid, and study rooms, scores and accounts must work end to end.
function fakeD1() {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(':memory:'), plain = (r) => (r ? { ...r } : null);
  const reads = (sql) => /^\s*(SELECT|WITH)\b/i.test(sql) || /\bRETURNING\b/i.test(sql);
  const exec = (sql, args) => { const p = db.prepare(sql); if (reads(sql)) return { results: p.all(...args).map(plain), success: true }; const r = p.run(...args); return { results: [], success: true, meta: { changes: Number(r.changes) } }; };
  const stmt = (sql, args = []) => ({ sql, args, bind: (...a) => stmt(sql, a),
    first: async (col) => { D.trips++; const r = plain(db.prepare(sql).get(...args)); return r && col ? r[col] : r; },
    all: async () => (D.trips++, exec(sql, args)), run: async () => (D.trips++, exec(sql, args)) });
  const D = { db, trips: 0, prepare(sql) { return stmt(sql); },
    async batch(list) { D.trips++; db.exec('BEGIN'); try { const out = list.map((s) => exec(s.sql, s.args)); db.exec('COMMIT'); return out; } catch (e) { db.exec('ROLLBACK'); throw e; } } };
  return D;
}
async function realServer(env = {}) {
  process.removeAllListeners('warning'); // (node:sqlite says it's experimental)
  const w = (await import(require('url').pathToFileURL(path.join(ROOT, 'server/worker.js')).href + '?fresh=' + Math.random())).default;
  const DB = fakeD1();
  const call = async (method, p, body, headers = {}) => {
    const pending = [];
    const res = await w.fetch(new Request('https://cassie.failanzahazel.workers.dev' + p, { method, headers: { origin: 'https://askcassie.study', 'cf-connecting-ip': '203.0.113.7', ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined }), { DB, ...env }, { waitUntil: (x) => pending.push(x) });
    await Promise.all(pending);
    const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch (e) { /* not JSON */ }
    return { status: res.status, json, text, headers: res.headers };
  };
  return { call, DB, w };
}
test('the real server: file sections (big PDFs read in parts) share an app-wide budget a minute, so chat questions never wait on them; past it a wait the app handles by itself (retry-after up to 30 s)', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u, o) => (/api\.groq\.com/.test(String(u)) ? new Response(JSON.stringify({ choices: [{ message: { content: 'A section summary.' } }] }), { status: 200, headers: { 'content-type': 'application/json' } }) : realFetch(u, o));
  try {
    const { call } = await realServer({ GROQ_KEY: 'gsk_test_fake', SECTION_PER_MIN: '3', DAILY_LIMIT: '500', FREE_DAILY_QUESTIONS: '500' });
    const msg = (t) => [{ role: 'user', content: t }];
    const parts = [];
    for (let i = 0; i < 4; i++) parts.push(await call('POST', '/chat', { uid: `part-uid-${i}x`, messages: msg('Summarise section ' + i) }));
    expect(parts.slice(0, 3).every((r) => r.status === 200), 'the first 3 sections this minute: ' + parts.map((r) => r.status).join(','));
    const busy = parts[3], wait = +busy.headers.get('retry-after');
    expect(busy.status === 429 && busy.json.error.code === 'sections_busy' && wait >= 1 && wait <= 30, 'the 4th waits (the app retries by itself): ' + busy.status + ' ' + busy.text + ' retry-after ' + wait);
    const q = await call('POST', '/chat', { uid: 'chat-uid-1x', q: 1, messages: msg('What is osmosis?') });
    expect(q.status === 200, 'a chat question is never held back by file sections: ' + q.status + ' ' + q.text.slice(0, 120));
  } finally { globalThis.fetch = realFetch; }
});

test('the real server on a real database: study rooms (make, join, draw, see each other), the puzzle score board and accounts (sign up, save, plan, sign out) all work, and a paid plan is read from the session', async () => {
  const { call, DB } = await realServer({ DAILY_LIMIT: '0', PLUS_DAILY_LIMIT: '0' });
  const A = 'aaaaaaaa-1', B = 'bbbbbbbb-2', C = 'cccccccc-3';
  // a study room
  const made = await call('POST', '/room/create', { uid: A, name: 'Ana', title: 'Bio' });
  expect(made.status === 200 && /^[A-Z0-9]{6}$/.test(made.json.code), 'a room is made: ' + made.text);
  const code = made.json.code;
  const joined = await call('POST', '/room/join', { uid: B, name: 'Ben', code });
  expect(joined.status === 200 && joined.json.members.map((m) => m.uid).sort().join() === [A, B].join(), 'Ben joins and sees both: ' + joined.text);
  const drew = await call('POST', '/room/ops', { uid: A, code, ops: [{ t: 'add', id: 's1', pts: [[0, 0], [10, 10]] }] });
  expect(drew.status === 200 && drew.json.n === 1, 'Ana draws a line: ' + drew.text);
  const stranger = await call('POST', '/room/ops', { uid: C, code, ops: [{ t: 'add', id: 's2' }] });
  expect(stranger.status === 403, 'someone not in the room can’t draw: ' + stranger.status);
  const benPoll = await call('GET', `/room/poll?code=${code}&uid=${B}&since=0&p=${encodeURIComponent(JSON.stringify({ x: 5, y: 6 }))}`);
  expect(benPoll.status === 200 && benPoll.json.ops.length === 1 && benPoll.json.ops[0].op.id === 's1' && benPoll.json.members.length === 2, 'Ben gets Ana’s line: ' + benPoll.text);
  await call('GET', `/room/poll?code=${code}&uid=${C}&since=0&p=${encodeURIComponent(JSON.stringify({ x: 9, y: 9 }))}`);
  const t0 = DB.trips, anaPoll = await call('GET', `/room/poll?code=${code}&uid=${A}&since=1`);
  expect(DB.trips - t0 === 1, 'a poll (sent about once a second by everyone in a room) is one trip to the database: ' + (DB.trips - t0));
  expect(anaPoll.status === 200 && anaPoll.json.ops.length === 0 && anaPoll.json.here.length === 1 && anaPoll.json.here[0].uid === B && anaPoll.json.here[0].p.x === 5, 'Ana sees Ben’s pointer, and only a member’s: ' + anaPoll.text);
  const gone = await call('GET', `/room/poll?code=ZZZZZZ&uid=${A}&since=0`);
  expect(gone.status === 404 && gone.json.gone, 'a room that doesn’t exist says so: ' + gone.text);
  // the puzzle score board
  const day = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  for (const [uid, name, value, shown] of [[A, 'Ana', 100, '1:40'], [B, 'Ben', 90, '1:30']]) {
    const r = await call('POST', '/scores/submit', { uid, name, game: 'sudoku', value, shown, day });
    expect(r.status === 200, 'a score is saved: ' + r.text);
  }
  const t1 = DB.trips, board = await call('GET', `/scores/today?uid=${A}`);
  expect(DB.trips - t1 === 1, 'the score board is one read: ' + (DB.trips - t1));
  expect(board.status === 200 && board.json.top[0].name === 'Ben' && board.json.me.rank === 2 && board.json.me.games.sudoku.shown === '1:40' && board.json.week.table.length === 2 && board.json.week.table[1].me, 'today’s board and the week: ' + board.text);
  // an account
  const up = await call('POST', '/auth/signup', { email: 'mika@example.com', password: 'longenough1', age: 16, name: 'Mika' });
  expect(up.status === 200 && up.json.token && up.json.account.email === 'mika@example.com' && up.json.plan.plan === 'free', 'sign up: ' + up.text);
  const auth = { authorization: 'Bearer ' + up.json.token };
  const saved = await call('POST', '/auth/save', { data: { profile: { name: 'Mika R' }, cards: [1, 2] } }, auth);
  expect(saved.status === 200 && saved.json.saved, 'save: ' + saved.text);
  const me = await call('GET', '/auth/me', null, auth);
  expect(me.status === 200 && me.json.account.name === 'Mika R' && me.json.account.data.cards.length === 2 && me.json.account.password === true && me.json.plan.plan === 'free', 'me: ' + me.text);
  // a paid plan: read from the session (the chat limit says "fair-use", not "free questions")
  const ask = (headers) => call('POST', '/chat', { messages: [{ role: 'user', content: 'hi' }], uid: A, q: 1 }, headers);
  expect(/free questions/.test((await ask({})).text), 'no sign-in: the free allowance');
  const id = DB.db.prepare('SELECT id FROM accounts WHERE email = ?').get('mika@example.com').id;
  DB.db.prepare('INSERT INTO plans (account, plan, until) VALUES (?, ?, ?)').run(id, 'plus', Date.now() + 864e5);
  const t2 = DB.trips;
  expect(/fair-use/.test((await ask(auth)).text), 'signed in with Plus: the paid allowance');
  expect(DB.trips - t2 <= 3, 'a signed-in question: its plan in one read (then the allowance): ' + (DB.trips - t2));
  const me1 = await call('GET', '/auth/me', null, auth);
  const t3 = DB.trips, me2 = await call('GET', '/auth/me', null, auth);
  expect(me2.json.plan.plan === 'plus' && me1.json.plan.plan === 'plus', 'me shows the plan: ' + me2.text);
  expect(DB.trips - t3 === 2, '/auth/me: the account, then one batch: ' + (DB.trips - t3));
  const out = await call('POST', '/auth/logout', {}, auth);
  expect(out.status === 200 && (await call('GET', '/auth/me', null, auth)).status === 401, 'signed out: the session is gone');
});

test('the real server: the studio voice uses the model set in ELEVENLABS_MODEL, and with Eleven v4 sends only the settings v4 takes (no "style")', async () => {
  const sent = [], realFetch = globalThis.fetch, hadCaches = 'caches' in globalThis;
  globalThis.caches = { default: { match: async () => null, put: async () => {} } }; // (Cloudflare's edge cache, empty)
  globalThis.fetch = async (u, o) => { if (/elevenlabs\.io/.test(String(u))) { sent.push({ url: String(u), body: JSON.parse(o.body) }); return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'audio/mpeg' } }); } return realFetch(u, o); };
  try {
    for (const [model, voice, style] of [[undefined, 'man', true], ['eleven_v4_turbo', 'man', false], ['eleven_v4', 'woman', false]]) {
      const { call } = await realServer({ ELEVENLABS_API_KEY: 'test-key', ...(model ? { ELEVENLABS_MODEL: model } : {}) });
      sent.length = 0;
      const up = await call('POST', '/auth/signup', { email: 'model@example.com', password: 'longenough1', age: 20 }); // (the studio voice is for accounts)
      const r = await call('POST', '/speak', { text: 'Hello from Cassie ' + model, voice, uid: 'aaaaaaaa-1' }, { authorization: 'Bearer ' + up.json.token });
      const b = sent[0] && sent[0].body;
      expect(r.status === 200 && b, `${model || 'the default'}: Cassie speaks: ` + r.status + ' ' + r.text.slice(0, 120));
      expect(b.model_id === (model || 'eleven_flash_v2_5'), 'the model sent: ' + b.model_id);
      // Jessica for a woman's voice, Chris for a man's (ElevenLabs' standard voices)
      expect(sent[0].url.includes(voice === 'man' ? '/iP95p4xoKVk53GoZ742B?' : '/cgSgspJ2msm6clMCkdW9?'), `${voice}: ${voice === 'man' ? 'Chris' : 'Jessica'}: ` + sent[0].url);
      expect(('style' in b.voice_settings) === style, `${model || 'flash'} ${voice}: style ${style ? 'sent' : 'left out'}: ` + JSON.stringify(b.voice_settings));
    }
  } finally { globalThis.fetch = realFetch; if (!hadCaches) delete globalThis.caches; }
});

test('the real server: the studio voice counts the ElevenLabs account’s own credits, and when they run out it rests until they’re back instead of asking again and again', async () => {
  const realFetch = globalThis.fetch, hadCaches = 'caches' in globalThis;
  globalThis.caches = { default: { match: async () => null, put: async () => {} } };
  let eleven = { sub: null, tts: 0 };
  globalThis.fetch = async (u, o) => {
    const url = String(u);
    if (/elevenlabs\.io\/v1\/user\/subscription/.test(url)) return eleven.sub ? new Response(JSON.stringify(eleven.sub), { status: 200 }) : new Response('{"detail":{"status":"missing_permissions"}}', { status: 401 });
    if (/elevenlabs\.io/.test(url)) { eleven.tts++; return eleven.out ? new Response(JSON.stringify({ detail: { code: 'quota_exceeded', message: 'This request exceeds your quota of 10000. You have 0 credits remaining.' } }), { status: 401 }) : new Response(new Uint8Array([1, 2]), { status: 200 }); }
    return realFetch(u, o);
  };
  try {
    // the account has 40 credits left, renewed on a known day: that's what Cassie says is left
    let s1 = await realServer({ ELEVENLABS_API_KEY: 'k', SPEAK_MONTHLY_CHARS: '125000' });
    const reset = Date.UTC(2026, 10, 3, 4) / 1000;
    eleven.sub = { character_limit: 100000, character_count: 99960, next_character_count_reset_unix: reset };
    const signup = async (srv) => ({ authorization: 'Bearer ' + (await srv.call('POST', '/auth/signup', { email: 'credits@example.com', password: 'longenough1', age: 20 })).json.token }); // (the studio voice is for accounts)
    const left = await s1.call('GET', '/speak?uid=aaaaaaaa-1', null, await signup(s1));
    expect(left.json.on && left.json.left === 40 && left.json.back === '2026-11-03', 'the account’s own credits and renewal day: ' + left.text);
    // a key that can't read its account, and the credits run out: one try, then resting (no more calls)
    const s2 = await realServer({ ELEVENLABS_API_KEY: 'k' });
    eleven = { sub: null, tts: 0, out: true };
    const ext = await signup(s2);
    const a = await s2.call('POST', '/speak', { text: 'Hello there.', uid: 'aaaaaaaa-1' }, ext);
    const b2 = await s2.call('POST', '/speak', { text: 'And again.', uid: 'aaaaaaaa-1' }, ext);
    expect(a.status === 429 && b2.status === 429 && eleven.tts === 1, 'out of credits: resting (429), and ElevenLabs asked once: ' + JSON.stringify([a.status, b2.status, eleven.tts]));
    const after = await s2.call('GET', '/speak?uid=aaaaaaaa-1', null, ext);
    const d = new Date(Date.now() + 8 * 3600e3), first = `${d.getUTCMonth() === 11 ? d.getUTCFullYear() + 1 : d.getUTCFullYear()}-${String(d.getUTCMonth() === 11 ? 1 : d.getUTCMonth() + 2).padStart(2, '0')}-01`;
    expect(after.json.on && after.json.left === 0 && after.json.back === first, 'the app is told it’s resting (until the 1st when the key can’t say): ' + after.text);
    const probs = s2.DB.db.prepare("SELECT text FROM feedback WHERE feature = 'voice: elevenlabs'").all().map((r) => r.text);
    expect(probs.length === 1 && probs[0] === 'out of credits', 'the dashboard gets one plain line, not one per try: ' + JSON.stringify(probs));
  } finally { globalThis.fetch = realFetch; if (!hadCaches) delete globalThis.caches; }
});

test('studio voice by the month, per account: Free 7,500, Plus 15,000 and Pro 30,000 characters with no daily limit; a guest in the app is told to sign in; past the month a kind message (x-speak mine) the app explains; Cassie says when half is used; podcasts have no daily rule', async (b) => {
  const realFetch = globalThis.fetch, hadCaches = 'caches' in globalThis;
  globalThis.caches = { default: { match: async () => null, put: async () => {} } };
  globalThis.fetch = async (u, o) => (/elevenlabs\.io\/v1\/user\/subscription/.test(String(u)) ? new Response('{}', { status: 401 }) : /elevenlabs\.io/.test(String(u)) ? new Response(new Uint8Array([1, 2]), { status: 200, headers: { 'content-type': 'audio/mpeg' } }) : realFetch(u, o));
  try {
    const { call, DB } = await realServer({ ELEVENLABS_API_KEY: 'k' });
    const hd = (r, k) => (r.headers && r.headers.get ? r.headers.get(k) : '') || '';
    // a guest in the app: no studio voice, and the reason
    const g = await call('GET', '/speak?uid=aaaaaaaa-guest');
    expect(g.json.guest === true && g.json.left === 0, 'a guest: none, signs in for it: ' + g.text);
    const gp = await call('POST', '/speak', { text: 'Hello', uid: 'aaaaaaaa-guest' });
    expect(gp.status === 401 && hd(gp, 'x-speak') === 'guest' && /Sign in/.test(gp.text), 'a guest asking: 401, sign in: ' + gp.status + ' ' + gp.text);
    // a Free account: 7,500 this month, more than a day's old 12,000 limit is fine on Plus
    const up = await call('POST', '/auth/signup', { email: 'voice@example.com', password: 'longenough1', age: 20 });
    const auth = { authorization: 'Bearer ' + up.json.token };
    const f = await call('GET', '/speak?uid=aaaaaaaa-free', null, auth);
    expect(f.json.max === 7500 && f.json.left === 7500 && f.json.plan === 'free' && f.json.used === 0, 'Free: 7,500 a month: ' + f.text);
    const said = [];
    for (let i = 0; i < 13; i++) said.push((await call('POST', '/speak', { text: `Line ${i} ` + 'x'.repeat(600), uid: 'aaaaaaaa-free' }, auth)).status);
    expect(said.slice(0, 12).every((st) => st === 200) && said[12] === 429, 'Free: 12 lines (about 7,300) spoken, the 13th is past the month: ' + said.join(','));
    const past = await call('POST', '/speak', { text: 'One more ' + 'z'.repeat(600), uid: 'aaaaaaaa-free' }, auth);
    expect(past.status === 429 && hd(past, 'x-speak') === 'mine' && /this month’s studio voice/.test(past.text), 'past the month: 429, x-speak mine: ' + past.text);
    const f2 = await call('GET', '/speak?uid=aaaaaaaa-free', null, auth);
    expect(f2.json.used <= 7500 && f2.json.left < 700, 'a refused line is not counted: ' + f2.text);
    // Plus: 15,000 a month and no daily limit (14,000 in one day, all spoken)
    const id = DB.db.prepare('SELECT id FROM accounts WHERE email = ?').get('voice@example.com').id;
    DB.db.prepare('INSERT INTO plans (account, plan, until) VALUES (?, ?, ?)').run(id, 'plus', Date.now() + 864e5);
    const p0 = await call('GET', '/speak?uid=aaaaaaaa-free', null, auth);
    expect(p0.json.max === 15000 && p0.json.plan === 'plus', 'Plus: 15,000 a month: ' + p0.text);
    const more = [];
    for (let i = 0; i < 10; i++) more.push((await call('POST', '/speak', { text: `More ${i} ` + 'y'.repeat(690), uid: 'aaaaaaaa-free' }, auth)).status);
    expect(more.every((st) => st === 200), 'Plus: no daily limit, 14,000 in a day: ' + more.join(','));
    DB.db.prepare('UPDATE plans SET plan = ? WHERE account = ?').run('pro', id);
    expect((await call('GET', '/speak?uid=aaaaaaaa-free', null, auth)).json.max === 30000, 'Pro: 30,000 a month');
  } finally { globalThis.fetch = realFetch; if (!hadCaches) delete globalThis.caches; }
  // the app: signed in, half the month used: Cassie says so once; the voice runs out partway through a Listen and the line says why
  const { ctx, page, errors } = await open(b, { server: false, device: 'Desktop Chrome', state: { groqKey: 'gsk_test', hearing: 'fast', account: { email: 'v@example.com', name: 'V', providers: [] } }, fakeGroq: () => ({ text: Array.from({ length: 8 }, (_, i) => `Sentence ${i + 1} about cells and what they need to live.`).join(' ') }) });
  await ctx.addInitScript(FAKE_VOICE, { studio: { failFrom: 1, failStatus: 429, failHeaders: { 'x-speak': 'mine' } } });
  await page.reload();
  await page.waitForFunction(() => window.CassieVoice.studio.known() && window.CassieVoice.studio.on(), null, { timeout: 5000 });
  await ask(page, 'What do cells need?');
  await page.click('.bubble-assistant .listen-btn');
  await page.waitForFunction(() => window.__notes.length > 0, null, { timeout: 15000 });
  const note = (await page.evaluate(() => window.__notes))[0];
  expect(/used this month’s studio voice/.test(note) && /comes back on/.test(note), 'the line says why and when: ' + note);
  expect(!errors.length, 'page errors: ' + errors.join('; '));
  await ctx.close();
  // half the month used: a note once (not again after a reload); a guest is told to sign in, and a podcast asks them to
  for (const [who, studio] of [['half', { max: 7500, used: 3800, left: 3700 }], ['guest', { guest: true }]]) {
    const o = await open(b, { server: false, device: 'Pixel 7', state: { groqKey: 'gsk_test', ...(who === 'half' ? { account: { email: 'v@example.com', name: 'V', providers: [] } } : {}) } });
    await o.ctx.addInitScript(FAKE_VOICE, { studio });
    await o.page.reload();
    await o.page.waitForFunction(() => window.CassieVoice.studio.known(), null, { timeout: 5000 });
    if (who === 'half') {
      await o.page.waitForSelector('.voice-half', { timeout: 5000 });
      const t = await o.page.locator('.voice-half').innerText();
      expect(/used half of this month’s studio voice/.test(t) && /3,700 of 7,500/.test(t) && !/[–—]/.test(t), 'the half note: ' + t);
      await o.page.reload();
      await o.page.waitForFunction(() => window.CassieVoice.studio.known(), null, { timeout: 5000 });
      await o.page.waitForTimeout(800);
      expect(!(await o.page.locator('.voice-half').count()), 'said once a month');
      await o.page.evaluate(() => openPodcast('Cells need energy.', 'Cells'));
      const facts = await o.page.locator('.pod-sheet').innerText();
      expect(/No daily limit/.test(facts) && !/Back tomorrow|one a day|one a week/.test(facts) && !(await o.page.locator('.pod-go').isDisabled()), 'a podcast: no daily rule: ' + facts);
    } else {
      expect(await o.page.evaluate(() => window.CassieVoice.studio.guest()), 'a guest');
      await o.page.evaluate(() => openPodcast('Cells need energy.', 'Cells'));
      await o.page.waitForSelector('.pod-sheet .pod-go', { state: 'visible' }); await o.page.waitForTimeout(400);
      const facts = await o.page.locator('.pod-sheet').innerText();
      expect(/isn’t available for guests/.test(facts) && await o.page.locator('.pod-go').innerText() === 'Sign in', 'a guest podcast asks to sign in: ' + facts);
    }
    expect(!o.errors.length, `${who}: page errors: ` + o.errors.join('; '));
    await o.ctx.close();
  }
});

test('the real server: a picture that fails gives the use back to whoever it was counted to (with no id it is counted per network)', async () => {
  const { call, DB } = await realServer({ AI: { run: async () => { throw new Error('busy'); } } });
  const used = (k) => (DB.db.prepare('SELECT n FROM quota WHERE k = ?').get(k) || { n: 0 }).n;
  for (const [uid, key] of [[undefined, 'img:an:203.0.113.7'], ['aaaaaaaa-1', 'img:u:aaaaaaaa-1']]) {
    const r = await call('POST', '/image', { prompt: 'a cat', ...(uid ? { uid } : {}) });
    expect(r.status === 503, 'the picture failed: ' + r.status);
    expect(used(key) === 0 && used('img:i:203.0.113.7') === 0, `${key} was given back: ${used(key)}`);
  }
});

test('signed in: the account is asked for once at start-up, and opening Labs right after doesn’t ask again', async (b) => {
  let asked = 0;
  const { ctx, page, errors } = await open(b, { device: 'Desktop Chrome', viewport: { width: 1280, height: 800 }, setup: async (c) => {
    await c.addInitScript(() => { try { localStorage.setItem('cassie.auth', 'tok_' + 'x'.repeat(30)); } catch (e) { /* */ } });
    await c.route(/\/auth\/me/, (r) => { asked++; r.fulfill({ json: { account: { email: 'mika@example.com', name: 'Mika', providers: [], data: null }, plan: { plan: 'free', until: 0 } } }); });
    await c.route(/\/auth\/save/, (r) => r.fulfill({ json: { saved: true } })); // (it then saves this device's profile to the account)
  } });
  await page.waitForTimeout(1500);
  await page.evaluate(() => openLabs());
  await page.waitForTimeout(1500);
  expect(asked === 1 && (await page.evaluate(() => authToken())), 'the account was asked for ' + asked + ' times (still signed in)');
  expect(!errors.length, 'page errors: ' + errors.join('; '));
  await ctx.close();
});

test('the extension asks Groq for its model list once per key (not on every picture)', async () => {
  const ext = path.join(ROOT, 'extension');
  const profile = fs.mkdtempSync(path.join(require('os').tmpdir(), 'cassie-ext-'));
  const ctx = await chromium.launchPersistentContext(profile, {
    headless: true, ...(fs.existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : { channel: 'chromium' }),
    args: ['--headless=new', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  try {
    let sw = null;
    for (let i = 0; i < 80 && !sw; i++) { for (const w of ctx.serviceWorkers()) if (/\/background\.js$/.test(w.url()) && await w.evaluate(() => typeof groqVisionCandidates === 'function').catch(() => false)) { sw = w; break; } if (!sw) await new Promise((r) => setTimeout(r, 250)); }
    expect(sw, 'the extension started');
    const r = await sw.evaluate(async () => {
      let calls = 0; const real = self.fetch;
      self.fetch = async (u, o) => { if (/\/models$/.test(String(u))) { calls++; return new Response(JSON.stringify({ data: [{ id: 'meta-llama/llama-4-scout-17b-16e-instruct' }, { id: 'openai/gpt-oss-120b' }] }), { status: 200 }); } return real(u, o); };
      try { const a = await groqVisionCandidates('key-one'), b = await groqVisionCandidates('key-one'); await groqVisionCandidates('key-two'); return { calls, a, b }; } finally { self.fetch = real; }
    });
    expect(r.calls === 2 && r.a.join() === 'meta-llama/llama-4-scout-17b-16e-instruct' && r.b.join() === r.a.join(), 'one models request per key: ' + JSON.stringify(r));
  } finally { await ctx.close(); fs.rmSync(profile, { recursive: true, force: true }); }
});

test('an old saved Gemini key (apiKey) moves to geminiKey, is removed from what’s stored, and never reaches a backup file', async (b) => {
  const { ctx, page, errors } = await open(b, { device: 'Desktop Chrome', viewport: { width: 1280, height: 800 }, state: { apiKey: 'AIzaOLDKEY1234567890' } });
  const st = await page.evaluate(() => JSON.parse(localStorage.getItem('cassie.v2')));
  expect(st.geminiKey === 'AIzaOLDKEY1234567890' && !('apiKey' in st), 'moved and dropped: ' + JSON.stringify({ gemini: st.geminiKey, apiKey: st.apiKey }));
  const [dl] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => exportBackup())]);
  const text = fs.readFileSync(await dl.path(), 'utf8');
  expect(!/AIzaOLDKEY/.test(text), 'the backup file has no key in it');
  expect(!errors.length, 'page errors: ' + errors.join('; '));
  await ctx.close();
});

test('askcassie.study is Cassie’s main address: the server lets it (and www) use Cassie but not other sites (askcassie.pages.dev and the old GitHub Pages copy neither), the extension opens it and talks to it, and what Cassie shares names it', async () => {
  const w = (await import(require('url').pathToFileURL(path.join(ROOT, 'server/worker.js')).href)).default;
  for (const [o, ok] of [['https://askcassie.study', true], ['https://www.askcassie.study', true], ['https://askcassie.pages.dev', false], ['https://usernamehaze.github.io', false], ['https://askcassie.study.evil.example', false], ['https://evil.example', false]]) {
    const r = await w.fetch(new Request('https://cassie.failanzahazel.workers.dev/chat', { method: 'OPTIONS', headers: { origin: o } }), {}, { waitUntil() {} });
    expect((r.headers.get('access-control-allow-origin') === o) === ok, `the server ${ok ? 'lets' : 'doesn’t let'} ${o} use it: ` + r.headers.get('access-control-allow-origin'));
  }
  const man = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension/manifest.json'), 'utf8'));
  expect(man.homepage_url === 'https://askcassie.study/', 'the extension’s home page: ' + man.homepage_url);
  const bridge = man.content_scripts.find((c) => c.js.includes('bridge.js'));
  for (const m of ['https://askcassie.study/*', 'https://www.askcassie.study/*', 'https://askcassie.pages.dev/*']) expect(bridge.matches.includes(m), 'the extension talks to Cassie on ' + m + ': ' + bridge.matches);
  const bg = fs.readFileSync(path.join(ROOT, 'extension/background.js'), 'utf8');
  expect(/CASSIE_APP_URL = 'https:\/\/askcassie\.study\/app\.html'/.test(bg) && /'https:\/\/askcassie\.study\/extension-version\.json'/.test(bg), 'the extension opens askcassie.study and checks it for updates');
  const pop = fs.readFileSync(path.join(ROOT, 'extension/popup.js'), 'utf8') + fs.readFileSync(path.join(ROOT, 'extension/popup.html'), 'utf8');
  expect(!/askcassie\.pages\.dev/.test(pop), 'the extension’s download link is on askcassie.study');
  for (const f of ['app.js', 'bot.html', 'server/worker.src.js']) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/DEFAULT_ORIGINS = \[[^\]]*\]/, '').replace(/\(default: [^)]*\)/g, '');
    expect(!/askcassie\.pages\.dev/.test(src), f + ' names askcassie.study, not askcassie.pages.dev');
  }
});

test('sign in with Google: the return address sent to Google is one registered in Google Cloud, on every site Cassie runs on', async (b) => {
  await serverMode({ noGoogle: false, noApple: false });
  // each site, served from this folder at its real address (Cloudflare Pages serves the app at /app)
  const SITES = [['askcassie.study', 'https://askcassie.study', '', '/app']];
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2' };
  for (const [name, origin, base, start] of SITES) {
    const { ctx, page, errors } = await open(b, { state: null, setup: async (c) => {
      // (an https page can't call the http test server: the real server's address stands in, and every
      // call to it goes to the test server, never the real one)
      await c.addInitScript(() => { window.CASSIE_SERVER = 'https://cassie.failanzahazel.workers.dev'; });
      await c.route(/^https:\/\/cassie\.failanzahazel\.workers\.dev\//, async (route) => {
        const rq = route.request(), u = SERVER + new URL(rq.url()).pathname + new URL(rq.url()).search;
        const r = await fetch(u, { method: rq.method(), headers: { ...rq.headers() }, body: ['GET', 'HEAD'].includes(rq.method()) ? undefined : rq.postDataBuffer() });
        return route.fulfill({ status: r.status, headers: Object.fromEntries(r.headers), body: Buffer.from(await r.arrayBuffer()) });
      });
      await c.route((u) => u.origin === origin, (route) => {
        let f = new URL(route.request().url()).pathname.slice(base.length) || '/';
        if (f === '/' || f === '/app') f = '/app.html';
        const file = path.join(ROOT, decodeURIComponent(f));
        if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return route.fulfill({ status: 404, body: '' });
        return route.fulfill({ body: fs.readFileSync(file), contentType: types[path.extname(file)] || 'application/octet-stream' });
      });
    } });
    try {
      await page.goto(origin + start);
      await page.evaluate(() => { localStorage.removeItem('cassie.v2'); localStorage.setItem('cassie.firstRun', JSON.stringify({ step: 'auth' })); });
      await page.goto(origin + start);
      await page.waitForSelector('.auth-google:not([hidden])', { timeout: 15000 });
      ctx.google = { stay: true }; ctx.googleAsked = null;
      await page.click('.auth-google');
      await page.waitForFunction(() => /Choose an account/.test(document.body.innerText), null, { timeout: 15000 });
      const asked = ctx.googleAsked || {};
      const sent = await page.evaluate(() => new URL(location.href).searchParams.get('redirect_uri'));
      expect(GOOGLE_REDIRECT_URIS.includes(sent), `${name}: Cassie asks Google to send the student back to ${sent}, which isn't one of the registered addresses: ${GOOGLE_REDIRECT_URIS.join(', ')}`);
      expect(!/[?#]/.test(sent) && sent.startsWith(origin + '/'), `${name}: the return address is plain, on this site: ${sent}`);
      expect(errors.length === 0, `${name}: page errors: ` + errors.join(' | '));
    } finally { await ctx.close(); }
  }
});

test('sign in with Google: a new account, and a bad token shows a friendly message', async (b) => {
  await serverMode({ noGoogle: false, noApple: false });
  await fetch(SERVER + '/__reset');
  const { ctx, page, errors } = await open(b, { state: null });
  try {
    await toSignIn(page);
    await page.waitForSelector('.auth-google:not([hidden])');
    await page.waitForSelector('.auth-apple:not([hidden])');
    expect(await page.locator('.auth-or').isVisible(), 'the "or" line should show with the buttons');
    for (const sel of ['.auth-google', '.auth-apple']) expect((await page.locator(sel).boundingBox()).height >= 44, sel + ' is under 44px tall');
    expect(!/[–—]/.test(await page.locator('.auth-page').innerText()), 'a dash on the sign-in page');
    // a token that isn't really Google's: a plain-words message, not signed in
    await googleTap(page, ctx, { sub: 'g-bad', email: 'bad@example.com', badSig: true });
    await page.waitForSelector('.auth-err:not([hidden])');
    expect(await authErr(page) === await page.evaluate(() => CassieErrors.say('google_failed')), 'bad token message: ' + await authErr(page));
    expect(!(await savedAccount(page)).token, 'a bad token signed someone in');
    // a new person with Google: signed in, the answers from before kept (no questions again)
    const email = `gnew${Date.now()}@example.com`;
    await googleTap(page, ctx, { sub: 'g-new-' + Date.now(), email });
    await page.waitForSelector('.auth-page', { state: 'detached' });
    expect(!(await page.locator('.fr-ob').count()) && await page.evaluate(() => !!state.profile && localStorage.getItem('cassie.firstRun') === null), 'the questions were answered before signing in: not asked again');
    const s = await savedAccount(page);
    expect(s.token && s.account.email === email && s.account.providers.join() === 'google' && s.plan && s.plan.plan === 'free', 'new Google account not saved: ' + JSON.stringify(s));
    expect(errors.length === 0, 'page errors: ' + errors.join(' | '));
  } finally { await ctx.close(); }
});

test('sign in with Google: an email account links after its password once, and the password still works', async (b) => {
  await fetch(SERVER + '/__reset');
  const post = async (path, body, token) => { const r = await fetch(SERVER + path, { method: body ? 'POST' : 'GET', headers: { origin: 'http://localhost:4640', 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, ...(await r.json()) }; };
  const email = `glink${Date.now()}@example.com`, sub = 'g-link-' + Date.now();
  expect((await post('/auth/signup', { email, password: 'secret-pass-1', age: 17 })).token, 'signup failed');
  let { ctx, page } = await open(b, { state: null });
  try {
    await toSignIn(page);
    await page.waitForSelector('.auth-google:not([hidden])');
    await googleTap(page, ctx, { sub, email });
    // the account has a password: Cassie asks for it once
    await seen(page, '.auth-title', 'Link Google to your Cassie account', 5000);
    expect(await page.inputValue('.auth-form input[name=email]') === email && await page.locator('.auth-form input[name=email]').getAttribute('readonly') !== null, 'the email to link should show, locked');
    expect(await page.locator('.auth-google').isHidden() && await page.locator('.auth-apple').isHidden(), 'no provider buttons while linking');
    await page.fill('.auth-form input[name=password]', 'not-the-password');
    await page.click('.auth-go');
    await page.waitForSelector('.auth-form .field-err:not([hidden])');
    expect(await page.locator('.auth-form .field-err:not([hidden])').textContent() === await page.evaluate(() => CassieErrors.say('link_wrong_password')), 'wrong password message: ' + await page.locator('.auth-form .field-err:not([hidden])').textContent());
    await page.fill('.auth-form input[name=password]', 'secret-pass-1');
    await page.click('.auth-go');
    await page.waitForSelector('.auth-page', { state: 'detached' });
    const s = await savedAccount(page);
    expect(s.token && s.account.email === email && s.account.providers.join() === 'google', 'not linked: ' + JSON.stringify(s));
  } finally { await ctx.close(); }
  // the password still works, and the account now has both ways in
  const login = await post('/auth/login', { email, password: 'secret-pass-1' });
  expect(login.token && login.account.password === true && login.account.providers.join() === 'google', 'password sign-in after linking: ' + JSON.stringify(login));
  // Google again (another device): straight in, no password asked
  ({ ctx, page } = await open(b, { state: null }));
  try {
    await toSignIn(page);
    await page.waitForSelector('.auth-google:not([hidden])');
    await googleTap(page, ctx, { sub, email });
    await page.waitForSelector('.auth-page', { state: 'detached' });
    expect((await savedAccount(page)).account.email === email, 'Google again should sign straight in');
  } finally { await ctx.close(); }
  // "I don't know this password": the old password goes, other devices are signed out, Google signs in
  const email2 = `gforget${Date.now()}@example.com`;
  const old = await post('/auth/signup', { email: email2, password: 'secret-pass-2', age: 17 });
  ({ ctx, page } = await open(b, { state: null }));
  try {
    await toSignIn(page);
    await page.waitForSelector('.auth-google:not([hidden])');
    await googleTap(page, ctx, { sub: sub + '-2', email: email2 });
    await seen(page, '.auth-title', 'Link Google', 5000);
    expect(/signs out other devices/.test(await page.locator('.auth-forgot').textContent()), 'should say what “I don’t know this password” does');
    await page.click('.auth-switch [data-to=forget]');
    await page.waitForSelector('.auth-page', { state: 'detached' });
    expect((await savedAccount(page)).account.email === email2, 'not signed in after “I don’t know this password”');
  } finally { await ctx.close(); }
  expect((await post('/auth/me', null, old.token)).status === 401, 'the other device should be signed out');
  const gone = await post('/auth/login', { email: email2, password: 'secret-pass-2' });
  expect(gone.status === 401 && gone.code === 'google_account', 'the old password should be gone: ' + JSON.stringify(gone));
});

test('sign in with Google never leaves a blank screen: signed in, cancelled, a server error and a server that never answers each end within 15 seconds', async (b) => {
  await fetch(SERVER + '/__reset');
  const say = (page, key) => page.evaluate((k) => CassieErrors.say(k), key);
  // the error and its Try again button, or signed in, within 15 seconds of tapping Google
  const endsWithin = async (page, t0, what) => {
    await page.waitForFunction(() => !document.querySelector('.auth-page') || (!document.querySelector('.auth-err').hidden && !document.querySelector('.auth-retry').hidden), null, { timeout: 15000, polling: 100 });
    const ms = Date.now() - t0;
    expect(ms <= 15000, `${what}: took ${ms}ms`);
    return ms;
  };
  const { ctx, page, errors } = await open(b, { state: null });
  try {
    await toSignIn(page);
    await page.waitForSelector('.auth-google:not([hidden])');
    // 1. a closed popup, in today's terms: the student leaves Google's page without picking (the back button)
    ctx.google = { stay: true };
    let t0 = Date.now();
    await page.click('.auth-google');
    expect(await page.locator('.auth-busy').isVisible() || /accounts\.google/.test(page.url()), 'tapping Google shows "Opening Google…" (never a blank page)');
    await page.waitForURL(/accounts\.google\.com/, { timeout: 10000 });
    await page.goBack();
    await endsWithin(page, t0, 'back from Google');
    expect(await page.locator('.auth-err').innerText() === await say(page, 'google_cancelled'), 'back from Google: ' + await page.locator('.auth-err').innerText());
    // ... and Google's own "cancel" answer says the same
    ctx.google = { cancel: true };
    t0 = Date.now();
    await googleTap(page, ctx, { cancel: true });
    await endsWithin(page, t0, 'cancelled at Google');
    expect(await page.locator('.auth-err').innerText() === await say(page, 'google_cancelled'), 'cancelled at Google: ' + await page.locator('.auth-err').innerText());
    // 2. Cassie's server breaks: plain words (never its raw "Internal error") and Try again
    await serverMode({ googleAuth: 'error' });
    t0 = Date.now();
    await googleTap(page, ctx, { sub: 'g-err-' + Date.now(), email: `gerr${Date.now()}@example.com` });
    await endsWithin(page, t0, 'server error');
    expect(await page.locator('.auth-err').innerText() === await say(page, 'unknown'), 'server error: ' + await page.locator('.auth-err').innerText());
    // 3. Cassie's server never answers: "Signing you in…" while waiting, then plain words and Try again
    await serverMode({ googleAuth: 'hang' });
    t0 = Date.now();
    await googleTap(page, ctx, { sub: 'g-hang-' + Date.now(), email: `ghang${Date.now()}@example.com` });
    await page.waitForSelector('.auth-busy:not([hidden])', { timeout: 3000 });
    expect(/Signing you in/.test(await page.locator('.auth-busy').innerText()), 'the wait shows "Signing you in…"');
    const ms = await endsWithin(page, t0, 'server never answers');
    expect(ms >= 9000 && await page.locator('.auth-err').innerText() === await say(page, 'timeout'), `server never answers: ${ms}ms, ` + await page.locator('.auth-err').innerText());
    // 4. it works again: Try again goes back to Google and the student is signed in
    await serverMode({ googleAuth: 'ok' });
    const email = `gok${Date.now()}@example.com`;
    ctx.google = { sub: 'g-ok-' + Date.now(), email };
    t0 = Date.now();
    await page.click('.auth-retry');
    await page.waitForURL(/app\.html$/, { timeout: 15000 });
    await endsWithin(page, t0, 'signed in');
    const s = await savedAccount(page);
    expect(s.token && s.account.email === email && s.account.providers.join() === 'google', 'Try again then signed in: ' + JSON.stringify(s));
    expect(ctx.googleAsked.type === 'id_token' && ctx.googleAsked.clientId === 'test-client-id' && ctx.googleAsked.back === APP, 'Google is asked for an ID token, back to this page: ' + JSON.stringify(ctx.googleAsked));
    expect(!errors.length, 'page errors: ' + errors.join(' | '));
  } finally { await serverMode({ googleAuth: 'ok' }); await ctx.close(); }
});

test('sign in with Apple: there and back, cancel is explained, and the plan is the same every way in', async (b) => {
  await fetch(SERVER + '/__reset');
  const post = async (path, body) => { const r = await fetch(SERVER + path, { method: 'POST', headers: { origin: 'http://localhost:4640', 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, ...(await r.json()) }; };
  const who = { cancel: true, sub: 'a-new-' + Date.now(), email: `anew${Date.now()}@privaterelay.appleid.com` };
  let { ctx, page, errors } = await open(b, { state: null, setup: fakeApple(who) });
  try {
    // cancelled at Apple: back on the sign-in page with a plain-words message
    await toSignIn(page, { name: 'Ava' });
    await page.waitForSelector('.auth-apple:not([hidden])');
    await page.click('.auth-apple');
    await page.waitForURL(/app\.html$/, { timeout: 15000 });
    await page.waitForSelector('.auth-err:not([hidden])', { timeout: 10000 });
    expect(await authErr(page) === await page.evaluate(() => CassieErrors.say('apple_cancelled')), 'cancel message: ' + await authErr(page));
    expect(!page.url().includes('cassie-auth'), 'the answer should be taken out of the address');
    // a new person with Apple: signed in, and the answers given before go with the account (no questions again)
    who.cancel = false;
    await page.click('.auth-apple');
    await page.waitForURL(/app\.html$/, { timeout: 15000 });
    await page.waitForFunction(() => !!localStorage.getItem('cassie.auth') && !document.querySelector('.auth-page'), null, { timeout: 10000 });
    const s = await savedAccount(page);
    expect(s.token && s.account.email === who.email && s.account.providers.join() === 'apple', 'new Apple account not saved: ' + JSON.stringify(s));
    expect(await page.evaluate(() => state.profile && state.profile.name === 'Ava' && !document.querySelector('.fr-ob') && localStorage.getItem('cassie.firstRun') === null), 'the answers are kept, no questions again');
    expect(errors.length === 0, 'page errors: ' + errors.join(' | '));
  } finally { await ctx.close(); }
  // an answer this tab didn't ask for is ignored
  ({ ctx, page } = await open(b, { state: null }));
  try {
    await page.goto('about:blank');
    await page.goto(APP + '#cassie-auth=' + encodeURIComponent(JSON.stringify({ type: 'cassie-auth', provider: 'apple', nonce: 'x'.repeat(32), token: 'stolen', account: { email: 'x@example.com' } })));
    // never used, never silent: the sign-in page says why, with Try again
    await page.waitForSelector('.auth-page .auth-retry:not([hidden])', { timeout: 8000 });
    expect(await authErr(page) === await page.evaluate(() => CassieErrors.say('signin_mismatch')), 'a stolen answer is explained: ' + await authErr(page));
    expect(!(await savedAccount(page)).token && !page.url().includes('cassie-auth'), 'an answer from another tab signed in');
  } finally { await ctx.close(); }

  // the plan: an email account with Plus shows Plus by email, by Apple and by Google
  const email = `aplan${Date.now()}@example.com`;
  expect((await post('/auth/signup', { email, password: 'secret-pass-1', age: 17 })).token, 'signup failed');
  const grant = await (await fetch(SERVER + '/admin/plan', { method: 'POST', headers: { authorization: 'Bearer test-admin-token-0123456789', 'content-type': 'application/json' }, body: JSON.stringify({ email, plan: 'plus', days: 30 }) })).json();
  expect(grant && !grant.error, 'plan not given: ' + JSON.stringify(grant));
  const byEmail = (await post('/auth/login', { email, password: 'secret-pass-1' })).plan;
  const who2 = { sub: 'a-plan-' + Date.now(), email };
  ({ ctx, page } = await open(b, { state: { plan: null }, setup: fakeApple(who2) }));
  let byApple;
  try {
    await page.evaluate(() => openAuth({ mode: 'signin' }));
    await page.waitForSelector('.auth-apple:not([hidden])');
    await page.click('.auth-apple');
    await page.waitForURL(/app\.html$/, { timeout: 15000 });
    await seen(page, '.auth-title', 'Link Apple to your Cassie account', 10000);
    await page.fill('.auth-form input[name=password]', 'secret-pass-1');
    await page.click('.auth-go');
    await page.waitForSelector('.auth-page', { state: 'detached' });
    byApple = (await savedAccount(page)).plan;
    expect(await page.evaluate(() => planName()) === 'plus', 'the app should show Plus after Apple sign-in');
  } finally { await ctx.close(); }
  const byGoogle = (await post('/auth/google', { credential: await idToken({ provider: 'google', sub: 'g-plan-' + Date.now(), email }), password: 'secret-pass-1' })).plan;
  expect([byEmail, byApple, byGoogle].every((p) => p && p.plan === 'plus' && p.until === byEmail.until), 'plans differ: ' + JSON.stringify([byEmail, byApple, byGoogle]));
});

test('sign in with Google and Apple: a provider the server has no ID for has no button', async (b) => {
  try {
    await serverMode({ noGoogle: true, noApple: false });
    let { ctx, page } = await open(b, { state: null });
    await toSignIn(page);
    await page.evaluate(() => authProviders());
    await page.waitForSelector('.auth-apple:not([hidden])');
    expect(await page.locator('.auth-google').isHidden(), 'Google button shown with no GOOGLE_CLIENT_ID');
    await ctx.close();
    await serverMode({ noGoogle: false, noApple: true });
    ({ ctx, page } = await open(b, { state: null }));
    await toSignIn(page);
    await page.waitForSelector('.auth-google:not([hidden])');
    expect(await page.locator('.auth-apple').isHidden(), 'Apple button shown with no APPLE_SERVICES_ID');
    await ctx.close();
    await serverMode({ noGoogle: true, noApple: true });
    ({ ctx, page } = await open(b, { state: null }));
    await toSignIn(page);
    await page.evaluate(() => authProviders());
    await page.waitForTimeout(200);
    expect(await page.locator('.auth-google').isHidden() && await page.locator('.auth-apple').isHidden() && await page.locator('.auth-or').isHidden(), 'no providers: no buttons and no "or" line');
    await page.click('.auth-switch [data-to=signin]');
    await page.click('.auth-switch [data-to=forgot]');
    expect(/aren’t available yet/.test(await page.locator('.auth-forgot').textContent()), 'forgot password should not point at a hidden button');
    await ctx.close();
  } finally { await serverMode({ noGoogle: false, noApple: false }); }
});

test('uploads are used to answer, then dropped: a file’s words, name and bytes are in no table and no log on the server', async (b) => {
  const MARK = 'Zqx' + Math.random().toString(36).slice(2, 10).replace(/\d/g, 'k'); // a word found nowhere else
  const { ctx, page } = await open(b, { state: { groqKey: '' } }); // no key: everything goes through Cassie's server
  // a Word file and a PDF with the marker in their words and their names, and a photo of random pixels
  const files = await page.evaluate(async (mark) => {
    const b64 = async (blob) => { const u = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (const x of u) s += String.fromCharCode(x); return btoa(s); };
    const md = `# ${mark} notes\n\nThe ${mark} cell divides in four phases: prophase, metaphase, anaphase, telophase.`;
    const c = document.createElement('canvas'); c.width = 64; c.height = 64; const g = c.getContext('2d');
    for (let i = 0; i < 400; i++) { g.fillStyle = `rgb(${Math.random() * 255 | 0},${Math.random() * 255 | 0},${Math.random() * 255 | 0})`; g.fillRect(Math.random() * 64, Math.random() * 64, 4, 4); }
    return { docx: await b64(await window.CassieExport.toDocx(md, mark)), pdf: await b64(await window.CassieExport.toPdf(md, mark)), png: c.toDataURL('image/png').split(',')[1] };
  }, MARK);
  const attach = async (name, mimeType, base64) => {
    await page.setInputFiles('#file-input', { name, mimeType, buffer: Buffer.from(base64, 'base64') });
    await page.waitForSelector('#attach-preview:not([hidden])', { timeout: 10000 });
  };
  await attach(`${MARK}-notes.docx`, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', files.docx);
  await ask(page, 'Make me a reviewer from this file');
  await page.evaluate(() => createNewChat());
  await attach(`${MARK}-module.pdf`, 'application/pdf', files.pdf);
  await ask(page, 'What is this about?');
  await page.evaluate(() => createNewChat());
  await attach(`${MARK}-photo.png`, 'image/png', files.png);
  await ask(page, 'What is in this photo?');
  // an answer that fails everywhere: the server writes what went wrong in its problem log
  await serverMode({ groq: 'down', groqVision: 'down', ai: 'down', aiVision: 'down' });
  await page.evaluate(() => createNewChat());
  await attach(`${MARK}-again.png`, 'image/png', files.png);
  await page.fill('#prompt-input', `Read ${MARK} in this photo`); await page.press('#prompt-input', 'Enter');
  await page.waitForSelector('#chat-log .bubble.error', { timeout: 30000 });
  await serverMode({ groq: 'ok', groqVision: 'ok', ai: 'ok', aiVision: 'ok' });
  // an automatic error report about a file (its message holds the file's name), and the same from an older app
  await page.evaluate((m) => reportAuto('chat', CassieErrors.say('file_kind', { name: m + '-notes.xyz' })), MARK);
  await page.evaluate(async ([srv, m]) => fetch(srv + '/f', { method: 'POST', body: JSON.stringify({ uid: 'old-app-1234', kind: 'auto', feature: 'chat', text: `Couldn’t read ${m}-notes.pdf` }) }), [SERVER, MARK]);
  await page.waitForTimeout(800);
  const dump = await (await fetch(SERVER + '/__dump')).json();
  // it really went to the AI (so the check below means something)...
  expect(dump.sentToAI.includes(MARK), 'the file’s words were sent to the AI to answer');
  expect(dump.tables.feedback.some((r) => r.kind === 'auto' && r.text === 'file_kind') && dump.tables.feedback.some((r) => r.kind === 'auto' && r.text === 'other'), 'the error reports arrived (as message keys only)');
  expect(dump.tables.feedback.some((r) => r.kind === 'error' && /chat: picture/.test(r.feature)), 'the failed answer is in the server’s problem log: ' + JSON.stringify(dump.tables.feedback.map((r) => r.feature)));
  // ...and nothing of it stayed: no words, no names, no bytes, in any table or log
  const kept = JSON.stringify({ tables: dump.tables, logs: dump.logs });
  const slices = (b64) => [0.25, 0.5, 0.75].map((f) => b64.slice(Math.floor(b64.length * f), Math.floor(b64.length * f) + 32));
  expect(!kept.toLowerCase().includes(MARK.toLowerCase()), 'an upload’s words or name were kept: ' + (kept.match(new RegExp('.{0,80}' + MARK + '.{0,80}', 'i')) || [''])[0]);
  for (const [kind, b64] of Object.entries(files)) for (const s of slices(b64)) expect(!kept.includes(s), `the ${kind} file’s bytes were kept`);
  expect(!/metaphase|anaphase|telophase/i.test(kept), 'a file’s words were kept');
  await ctx.close();
});

test('support.html: the help page the stores link to loads with no errors, every link on it works, it gives the same contact as privacy.html, reads well on a phone and in dark mode, and the landing footer links to it', async (b) => {
  const { contrastIssues } = require('./ui-checks.cjs');
  const ctx = await b.newContext({ viewport: { width: 375, height: 740 }, serviceWorkers: 'block' });
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  const res = await page.goto(`http://localhost:${APP_PORT}/support.html`);
  expect(res.ok(), 'support.html is on the site: ' + res.status());
  const text = await page.evaluate(() => document.body.innerText);
  expect(!/[\u2013\u2014]/.test(text), 'no long dashes on the page');
  const mail = (h) => (h.match(/[\w.+-]+@[\w-]+\.[\w.]+/) || [])[0];
  const privacyMail = mail(fs.readFileSync(path.join(ROOT, 'privacy.html'), 'utf8').split('<h2>Contact</h2>')[1] || '');
  expect(privacyMail && (await page.locator(`a[href="mailto:${privacyMail}"]`).count()) === 1, `the contact email is privacy.html's (${privacyMail})`);
  // (Cassie's own address, the same on every page that gives one)
  const termsMail = mail(fs.readFileSync(path.join(ROOT, 'terms.html'), 'utf8').split('<h2>Contact</h2>')[1] || '');
  expect(privacyMail === 'askcassie.study@gmail.com' && termsMail === privacyMail, `privacy.html and terms.html give Cassie's own email: ${privacyMail}, ${termsMail}`);
  expect(/Report a problem or suggest something/.test(text) && /Report a problem or suggest something/.test(fs.readFileSync(path.join(ROOT, 'app.html'), 'utf8')), 'it names the app’s own Report a problem button');
  // every link on the page (on this site) answers
  const links = await page.evaluate(() => [...document.querySelectorAll('a[href]')].map((a) => a.href).filter((h) => h.startsWith(location.origin)));
  // (the extension zip is made when the site is built, like the landing page's own download link)
  for (const l of links) { if (/cassie-extension\.zip$/.test(l)) { expect(fs.existsSync(path.join(ROOT, '_site/cassie-extension.zip')), 'the built site has the extension download'); continue; } const r = await page.request.get(l); expect(r.ok(), 'a link on the help page is broken: ' + l + ' ' + r.status()); }
  expect(links.length >= 4, 'it links home, privacy, terms and the extension in the store: ' + links.length);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no sideways scroll on a phone');
  for (const scheme of ['light', 'dark']) { await page.emulateMedia({ colorScheme: scheme }); await page.waitForTimeout(150); const { bad } = await contrastIssues(page, 'body'); expect(!bad.length, `readable in ${scheme} mode: ` + bad.join(' | ')); }
  expect(!errors.length, 'page errors: ' + errors.join('; '));
  await page.goto(`http://localhost:${APP_PORT}/index.html`);
  expect(await page.locator('footer a[href="support.html"]').count() === 1, 'the landing page footer links to Help');
  await ctx.close();
});

test('terms.html: every paid plan is a pass that never renews by itself (Monthly 30 days, the Semester Pasado Pass, Yearly 12 months), each with a reminder before it ends and 7 days to change your mind (no payment code yet)', async (b) => {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${APP_PORT}/terms.html`);
  const paid = await page.evaluate(() => { const h = [...document.querySelectorAll('h2')].find((x) => /Paid plans/.test(x.textContent)); let t = '', n = h && h.nextElementSibling; while (n && n.tagName !== 'H2') { t += n.innerText + '\n'; n = n.nextElementSibling; } return t; });
  expect(/one payment for a set time, and they never renew by themselves/.test(paid) && /Nothing is ever charged again unless you choose to buy another pass/.test(paid), 'terms: passes never renew, nothing is charged again: ' + paid);
  expect(/Monthly: one payment for 30 days\.\s*It never renews/.test(paid) && /a few days before it ends/.test(paid), 'terms: Monthly is 30 days, with a reminder before it ends: ' + paid);
  expect(/A Semester pass (\(the Pasado Pass\) )?is one payment and never renews/.test(paid) && /about a week before it ends/.test(paid), 'terms: the Semester pass never renews, with a reminder: ' + paid);
  expect(/Yearly: one payment for 12 months\.\s*It never renews, and we remind you\s+in the app a month before it ends/.test(paid), 'terms: Yearly is 12 months, with a reminder a month before: ' + paid);
  expect(/7 days to change your mind/.test(paid), 'terms: 7 days to change your mind');
  expect(!/renews automatically|until you cancel|before every renewal/i.test(paid), 'terms promise nothing about renewing: ' + paid);
  const all = await page.locator('body').innerText();
  expect(!/[—–]/.test(all), 'no dashes in the terms');
  await ctx.close();
  // and still no payment code anywhere until the payment account is ready
  const code = ['app.js', 'server/worker.src.js', 'extension/background.js', 'landing/landing.js'].map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  expect(!/lemonsqueezy\.com|LEMON_API_KEY/i.test(code) && !/\b(?:sk|pk)_(?:test|live)_[A-Za-z0-9]{8,}|whsk_[A-Za-z0-9]{8,}/.test(code), 'payments go through PayMongo only, and no key is ever written in the code (keys are Cloudflare Secrets)');
  expect(/Payments are made on PayMongo's secure page/.test(paid.replace(/’/g, "'")) && /Cassie never sees your card number/.test(paid) && /A US\$ price is charged in pesos/.test(paid), 'terms: how paying works');
});

test('the pricing page and the app’s Plans say exactly what the server allows: questions, smarter answers and pictures per plan, nothing unlimited but your own key, nothing that isn’t built', async (b) => {
  const src = fs.readFileSync(path.join(ROOT, 'server/worker.src.js'), 'utf8');
  const num = (name) => +src.match(new RegExp(`env\\.${name}, (\\d+)\\)`))[1];
  const lim = {
    free: { q: num('FREE_DAILY_QUESTIONS'), smart: num('FREE_CLAUDE_LIMIT'), gpic: num('FREE_PICTURES_WEEK') },
    plus: { q: num('PLUS_DAILY_QUESTIONS'), smart: num('PLUS_CLAUDE_LIMIT'), gpic: num('PLUS_PICTURES_DAY') },
    pro: { q: num('PRO_DAILY_QUESTIONS'), smartest: num('PRO_CLAUDE_LIMIT'), smart: num('PRO_HAIKU_LIMIT'), gpic: num('PRO_PICTURES_DAY') },
  };
  const quick = +src.match(/env\.IMAGE_LIMIT \|\| (\d+)/)[1];
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${APP_PORT}/index.html`);
  const plan = async (name) => (await page.locator('#pricing .plan', { has: page.locator(`h3:text-is("${name}")`) }).innerText()).replace(/\s+/g, ' ');
  const [free, plus, pro] = [await plan('Free'), await plan('Plus'), await plan('Pro')];
  expect(free.includes(`${lim.free.q} questions a day`) && free.includes(`${quick} quick pictures a day, plus ${lim.free.gpic} Gemini pictures a week`), 'Free matches the server: ' + free);
  expect(plus.includes(`${lim.plus.q} questions a day`) && plus.includes(`${lim.plus.smart} answers a day from Cassie’s smarter model (Free gets ${lim.free.smart})`) && plus.includes(`${lim.plus.gpic} Gemini pictures a day`), 'Plus matches the server: ' + plus);
  expect(pro.includes(`${lim.pro.q} questions a day`) && pro.includes(`${lim.pro.smartest} answers a day from Cassie’s smartest model, then ${lim.pro.smart} from the smarter one`) && pro.includes(`${lim.pro.gpic} Gemini pictures a day`), 'Pro matches the server: ' + pro);
  const all = (await page.locator('#pricing').innerText()) + ' ' + (await page.locator('#faq').textContent());
  const unlimited = all.match(/[^.:\n]*unlimited[^.\n]*/gi) || [];
  expect(unlimited.every((x) => /own free (API )?key/i.test(x)), 'only your own key is unlimited: ' + unlimited.join(' | '));
  expect(!/research runs|file reviewers? a month|minutes of listening|Refer a classmate|Priority when/i.test(all), 'nothing the code doesn’t do (monthly reviewer or research counts, listening minutes, referrals, priority)');
  expect(/20 questions a day, 20 quick pictures a day and 3 Gemini pictures a week/.test(all), 'the FAQ says the same as the Free plan');
  expect(!/[—–]/.test(all), 'no dashes');
  await ctx.close();
  // the app's Plans page says the same
  const app = fs.readFileSync(path.join(ROOT, 'app.html'), 'utf8');
  const plans = app.slice(app.indexOf('class="set-plans"'), app.indexOf('</section>', app.indexOf('class="set-plans"'))).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  expect(plans.includes(`${lim.free.q} questions a day`) && plans.includes(`${lim.plus.q} questions a day`) && plans.includes(`${lim.plus.gpic} Gemini pictures a day`) && plans.includes(`${quick} quick pictures a day, plus ${lim.free.gpic} Gemini pictures a week`), 'the app’s Plans match the server: ' + plans);
  expect(!/research runs|file reviewers|Unlimited (questions|voice)|Unlimited means/i.test(plans), 'the app’s Plans promise nothing the code doesn’t do: ' + plans);
  // Pro too, and the at-a-glance table, with the server's own numbers
  expect(plans.includes(`${lim.pro.q} questions a day`) && plans.includes(`${lim.pro.smartest} answers a day from Cassie’s smartest model, then ${lim.pro.smart} from the smarter one`) && plans.includes(`${lim.pro.gpic} Gemini pictures a day`), 'the app’s Pro matches the server: ' + plans);
  const row = (name) => (plans.match(new RegExp(name + ' (.+?) (?=Questions a day|Smarter answers a day|Gemini pictures|Free Plus)')) || [])[1] || '';
  expect(row('Questions a day') === `${lim.free.q} ${lim.plus.q} ${lim.pro.q}` && row('Smarter answers a day') === `${lim.free.smart} ${lim.plus.smart} ${lim.pro.smartest} smartest, then ${lim.pro.smart}`, 'the table matches the server: ' + JSON.stringify([row('Questions a day'), row('Smarter answers a day')]));
});

// a student a few days in: two exam plans, a week of study, chats and flashcards (for the computer's pages)
function deskSeed() {
  const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const add = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const progress = { [today]: { answered: 6, right: 5, quizzes: 1, cardsUp: 3, tasks: 1, focus: 25 }, [add(today, -1)]: { answered: 10, right: 7, quizzes: 2, fixed: 2, focus: 50 }, [add(today, -7)]: { answered: 4, right: 2, quizzes: 1, focus: 25 } /* (7 days ago: always last week, even on a Monday) */ };
  const exams = [
    { id: 'ex1', name: 'Gen Chem finals', date: add(today, 5), topics: 'Stoichiometry, gas laws', from: today, at: 1, stats: {}, marks: { stoichiometry: 'rrwr' }, days: [{ date: today, tasks: [{ kind: 'learn', topic: 'Stoichiometry', done: true }, { kind: 'quiz', topic: 'Gas laws' }] }, { date: add(today, 1), tasks: [{ kind: 'cards', topic: 'Gas laws' }, { kind: 'mistakes' }] }] },
    { id: 'ex2', name: 'Bio 1 midterm', date: add(today, 12), topics: 'Cells', from: today, at: 2, stats: {}, days: [{ date: add(today, 2), tasks: [{ kind: 'learn', topic: 'Cells' }, { kind: 'quiz', topic: 'Cells' }] }] },
  ];
  const now = Date.now();
  const chats = [
    { id: 'c1', title: 'Moles and molar mass', messages: [{ role: 'user', content: 'What is a mole?' }, { role: 'assistant', content: 'A mole is a count.' }], updatedAt: now - 3600e3 },
    { id: 'c2', title: 'Photosynthesis steps', messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'c' }, { role: 'assistant', content: 'd' }], updatedAt: now - 86400e3 },
    { id: 'c3', title: '', messages: [], updatedAt: now },
  ];
  const cards = Array.from({ length: 8 }, (_, i) => ({ id: 'k' + i, f: 'Q' + i, b: 'A' + i, deck: 'Chem', box: i < 5 ? 4 : 1, due: 0, at: 0 }));
  return { today, add, state: { progress, exams, chats, currentId: 'c3', cards, tour: 'done', extVideoSeen: true, groqKey: 'gsk_test' } };
}

test('computer Home is a study dashboard: Hi and the two main buttons, four real numbers, the week’s chart, Next up, exam plans, recent chats, the readiness gauge and the focus timer (also in the top bar while it runs); the sidebar has Menu and General and the Chrome card; the top bar has search (Ctrl K), the bell and you; phones never see any of it', async (b) => {
  const seed = deskSeed();
  for (const [scheme, viewport] of [['light', { width: 1280, height: 800 }], ['dark', { width: 1440, height: 900 }]]) {
    const { ctx, page, errors } = await open(b, { device: 'Desktop Chrome', viewport, server: false, state: seed.state });
    await page.emulateMedia({ colorScheme: scheme });
    await page.evaluate(() => deskGo('home'));
    await page.waitForSelector('#chat-log .desk-home', { timeout: 8000 });
    const H = await page.evaluate(() => {
      const d = document.querySelector('.desk-home'), t = (s) => (d.querySelector(s) || {}).textContent || '';
      return { title: t('.dk-title'), acts: [...d.querySelectorAll('.dk-acts .dk-btn')].map((x) => x.textContent.trim()), stats: [...d.querySelectorAll('.dk-stat')].map((x) => x.querySelector('h2').textContent + '=' + x.querySelector('b').textContent),
        bars: [...d.querySelectorAll('.dk-bar')].map((x) => x.getAttribute('aria-label')), next: t('.dk-next-what') + ' | ' + t('.dk-next-when'), plans: [...d.querySelectorAll('.dk-plans .dk-row b')].map((x) => x.textContent), chats: [...d.querySelectorAll('.dk-chats .dk-row b')].map((x) => x.textContent),
        gauge: (d.querySelector('.dk-gauge') || { getAttribute: () => '' }).getAttribute('aria-label'), timer: t('.dk-time') };
    });
    expect(H.title === 'Hi, Test' && H.acts.join() === 'Ask Cassie,Add my notes', `${viewport.width}: the greeting and buttons: ` + JSON.stringify(H));
    expect(H.stats.join('|') === 'Questions this week=3|Cards learned=5|Day streak=0|Exam readiness=38%', `${viewport.width}: the four numbers come from what's saved: ` + H.stats.join('|'));
    expect(H.bars.length === 7 && H.bars.some((l) => /: 10 things studied/.test(l) || /: 13 things studied/.test(l)), `${viewport.width}: a bar a day from the saved counts: ` + H.bars.join(' / '));
    expect(H.next === 'Quiz me on Gas laws | Today · Gen Chem finals', 'Next up is the next task not done: ' + H.next);
    expect(H.plans.join() === 'Gen Chem finals,Bio 1 midterm' && H.chats.join() === 'Moles and molar mass,Photosynthesis steps', 'plans and chats: ' + JSON.stringify([H.plans, H.chats]));
    expect(/38% ready for Gen Chem finals/.test(H.gauge), 'the gauge: ' + H.gauge);
    if (process.env.SHOTS) { await page.waitForTimeout(600); await page.screenshot({ path: `${process.env.SHOTS}/desk-home-${viewport.width}-${scheme}.png` }); }
    if (scheme === 'light') {
      // the sidebar and the top bar
      const side = await page.evaluate(() => ({ groups: [...document.querySelectorAll('.side-group')].map((x) => x.textContent), nav: [...document.querySelectorAll('.side-nav [data-page], .side-nav a')].filter((x) => !x.hidden).map((x) => x.querySelector('span').textContent.trim()), badge: document.querySelector('#side-nav [data-page="plan"] .side-badge').textContent, apps: [...document.querySelectorAll('#side-apps .side-tool')].map((x) => x.dataset.tip).join(), general: [...document.querySelectorAll('#side-general .side-tool')].filter((x) => !x.hidden).map((x) => x.dataset.tip).join(), topIcons: [...document.querySelectorAll('.topbar-actions > button')].filter((x) => x.getClientRects().length).map((x) => x.id).join(), ask: getComputedStyle(document.getElementById('composer')).display, ext: document.querySelector('.side-ext').getAttribute('href'), pomo: getComputedStyle(document.getElementById('pomo')).display }));
      expect(side.groups.join() === 'Menu,General' && side.nav.join() === 'Home,Chats,Study plan,Lessons,Calendar,Progress,Help' && side.apps === 'Learn,Games,Board' && side.general === 'Settings,Memory,Help' && side.badge === '1' && side.ext === 'https://chromewebstore.google.com/detail/hnafgijhojdheggkcjliffbgpdhikbpj' && side.pomo === 'none', 'the sidebar: ' + JSON.stringify(side));
      expect(await page.locator('#side-nav [data-page="home"]').getAttribute('aria-current') === 'page', 'Home is the page you are on');
      expect(side.topIcons === 'top-bell,top-me' && side.ask === 'none', 'like the reference: only the bell and you in the top bar, and no ask box on Home: ' + JSON.stringify(side));
      // search: Ctrl K, then pages, tools and chats as you type
      await page.keyboard.press('Control+k');
      expect(await page.evaluate(() => document.activeElement.id === 'top-q'), 'Ctrl K opens search');
      await page.keyboard.type('mol');
      await page.waitForSelector('#top-results:not([hidden]) [role="option"]');
      expect((await page.locator('#top-results [role="option"]').allInnerTexts()).some((t) => /Moles and molar mass/.test(t)), 'a chat is found');
      await page.keyboard.press('Escape');
      await page.click('#top-bell');
      expect(await page.locator('#top-remind .hub-chat').count() === 4, 'the bell shows the reminders');
      await page.keyboard.press('Escape');
      expect(await page.locator('#top-me b').innerText() === 'Test', 'you, in the top bar');
      // the timer: from the card, and in the top bar while it runs
      await page.click('.dk-tgo');
      await page.waitForFunction(() => !document.getElementById('top-timer').hidden && /Pause/.test(document.querySelector('.dk-tgo').getAttribute('aria-label')), null, { timeout: 4000 });
      await page.click('.dk-tstop');
      await page.waitForFunction(() => document.getElementById('top-timer').hidden, null, { timeout: 4000 });
      // each button does its job: Ask Cassie, the ↗ on cards and the streak, Start studying
      await page.click('.dk-acts [data-dk="ask"]');
      expect(await page.evaluate(() => document.activeElement.id === 'prompt-input'), 'Ask Cassie: the ask box');
      await page.click('#side-nav [data-page="home"]'); await page.waitForSelector('#chat-log .desk-home');
      await page.click('.dk-stat [data-dk="cards"]');
      await page.waitForSelector('.fc:not([hidden])', { timeout: 4000 }); await page.click('.fc-x'); await page.waitForSelector('.fc', { state: 'hidden' });
      await page.click('.dk-stat [data-dk="progress"]');
      await page.waitForSelector('#chat-log .desk-progress', { timeout: 4000 });
      await page.click('#side-nav [data-page="home"]'); await page.waitForSelector('#chat-log .desk-home');
      // a chat, then Home again from the sidebar
      await page.click('.dk-chats .dk-row');
      await page.waitForFunction(() => !document.querySelector('.desk-home') && document.querySelector('#side-nav [data-page="chats"]').getAttribute('aria-current') === 'page', null, { timeout: 4000 });
      await page.click('#side-nav [data-page="home"]');
      await page.waitForSelector('#chat-log .desk-home', { timeout: 4000 });
    }
    expect(!errors.length, 'page errors: ' + errors.join('; '));
    await ctx.close();
  }
  // a phone: none of it
  const { ctx, page } = await open(b, { device: 'iPhone 13', server: false, state: { ...seed.state, tab: 'home' } });
  await page.waitForSelector('#home .hub', { timeout: 8000 });
  expect(await page.evaluate(() => !document.querySelector('.desk-home') && [...document.querySelectorAll('.desk-only')].every((x) => !x.getBoundingClientRect().width)), 'phones never see the dashboard or the computer parts');
  await ctx.close();
});

test('computer pages: Study plan is a board (Today, Coming up, Done) with filters and ticks, then the full exam plans; Calendar shows the month with exam days and tasks, Today and Coming up; Progress draws this week against last week with tooltips and the week’s numbers; each opens from the sidebar and a question turns it back into a chat', async (b) => {
  const seed = deskSeed();
  for (const [scheme, viewport] of [['light', { width: 1280, height: 800 }], ['dark', { width: 1440, height: 900 }]]) {
    const { ctx, page, errors, groqCalls } = await open(b, { device: 'Desktop Chrome', viewport, server: false, state: seed.state, fakeGroq: () => ({ text: 'Sure!' }) });
    await page.emulateMedia({ colorScheme: scheme });
    await page.evaluate(() => deskGo('home'));
    await page.waitForSelector('#chat-log .desk-home', { timeout: 8000 });
    const shot = async (n) => { if (process.env.SHOTS) { await page.waitForTimeout(500); await page.screenshot({ path: `${process.env.SHOTS}/desk-${n}-${viewport.width}-${scheme}.png` }); } };
    // Study plan
    await page.click('#side-nav [data-page="plan"]');
    await page.waitForSelector('#chat-log .desk-plan', { timeout: 4000 });
    const cols = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.dk-col')].map((c) => [c.dataset.col, [...c.querySelectorAll('.dk-task-go')].map((x) => x.textContent)])));
    let C = await cols();
    expect(C.now.join() === 'Quiz me on Gas laws' && C.next.join() === '10 flashcards on Gas laws,Review my mistakes,Learn Cells with Cassie,Quiz me on Cells' && C.done.join() === 'Learn Stoichiometry with Cassie', 'the board: ' + JSON.stringify(C));
    expect(await page.locator('#side-nav [data-page="plan"]').getAttribute('aria-current') === 'page' && await page.locator('#chat-log .desk-plan .ex-plan').count() === 2, 'Study plan is the page; the plans in full under the board');
    await shot('plan');
    await page.click('.dk-chip[data-f="quiz"]');
    C = await cols();
    expect(C.now.join() === 'Quiz me on Gas laws' && C.next.join() === 'Quiz me on Cells' && !C.done.length, 'Quizzes only: ' + JSON.stringify(C));
    await page.click('.dk-chip[data-f="all"]');
    await page.click('[data-col="now"] .ex-check');
    await page.waitForFunction(() => document.querySelectorAll('[data-col="done"] .dk-task').length === 2 && document.querySelector('#side-nav [data-page="plan"] .side-badge').hidden, null, { timeout: 4000 });
    expect(await page.evaluate(() => state.exams[0].days[0].tasks[1].done === true), 'the tick is saved on the task');
    // Calendar
    await page.click('#side-nav [data-page="calendar"]');
    await page.waitForSelector('#chat-log .desk-cal', { timeout: 4000 });
    const K = await page.evaluate(() => ({ exam: [...document.querySelectorAll('.dk-examday')].map((d) => d.getAttribute('aria-label')), today: [...document.querySelectorAll('.dk-today-list b')].map((x) => x.textContent), soon: [...document.querySelectorAll('.dk-soon .dk-soon-what')].map((x) => x.textContent), legend: [...document.querySelectorAll('.dk-cal-legend .dk-lg')].map((x) => x.textContent) }));
    expect(K.today.join() === 'Learn Stoichiometry with Cassie,Quiz me on Gas laws' && K.soon[0] === '10 flashcards on Gas laws' && K.soon.includes('Gen Chem finals exam') && K.legend.join() === 'Exam day,Learn,Quiz,Flashcards,Mistakes,Focus', 'Today, Coming up and the legend: ' + JSON.stringify(K));
    const examInMonth = seed.add(seed.today, 5).slice(0, 7) === seed.today.slice(0, 7);
    if (examInMonth) expect(K.exam.some((l) => /Gen Chem finals exam/.test(l)), 'the exam day is marked: ' + JSON.stringify(K.exam));
    await shot('calendar');
    const m0 = await page.locator('.dk-month h2').innerText();
    await page.click('[data-dk="next"]');
    expect(await page.locator('.dk-month h2').innerText() !== m0, 'next month');
    await page.click('[data-dk="today"]');
    expect(await page.locator('.dk-month h2').innerText() === m0, 'Today comes back');
    // Progress
    await page.click('#side-nav [data-page="progress"]');
    await page.waitForSelector('#chat-log .desk-progress .hub-week', { timeout: 4000 });
    const P = await page.evaluate(() => ({ pts: [...document.querySelectorAll('.dk-pt')].map((g) => g.getAttribute('aria-label')), now: !!document.querySelector('.dk-now').getAttribute('d'), last: !!document.querySelector('.dk-last').getAttribute('d') }));
    expect(P.pts.length === 7 && P.now && P.last && P.pts.some((l) => /last week 4$/.test(l)), 'the chart: ' + JSON.stringify(P));
    await page.locator('.dk-pt').first().focus();
    expect(await page.locator('.dk-tip').isVisible() && /Last week/.test(await page.locator('.dk-tip').innerText()), 'a tooltip on focus');
    await shot('progress');
    // no ask box on the pages (like the reference): Chats, New chat, then a question
    expect(await page.evaluate(() => getComputedStyle(document.getElementById('composer')).display === 'none'), 'no ask box on Progress');
    await page.click('#side-nav [data-page="chats"]');
    await page.waitForSelector('#chat-log .desk-chats .dk-chat-card', { timeout: 4000 });
    expect((await page.locator('.dk-chat-card b').allInnerTexts()).join() === 'Moles and molar mass,Photosynthesis steps', 'Chats lists every chat');
    await shot('chats');
    await page.click('.desk-chats [data-dk="ask"]');
    expect(await page.evaluate(() => document.activeElement.id === 'prompt-input'), 'New chat: the ask box, ready');
    await page.fill('#prompt-input', 'What is a mole?'); await page.press('#prompt-input', 'Enter');
    await page.waitForSelector('#chat-log .bubble-assistant', { timeout: 8000 });
    expect(!(await page.locator('#chat-log .home-desk').count()) && groqCalls.length >= 1, 'the page became a chat');
    await page.click('#side-nav [data-page="home"]');
    await page.waitForSelector('#chat-log .desk-home', { timeout: 4000 });
    expect(!errors.length, 'page errors: ' + errors.join('; '));
    await ctx.close();
  }
});

test('computer Settings is a page: its parts listed on the left (You, Account, Study, Appearance, Voice and sound, Privacy and data, Plans, Help, All settings), each opening on the right; Appearance has colours by name (Cassie, Monochrome, Forest, Ocean, Plum, Ember) that pick the colour; a phone’s Settings is unchanged', async (b) => {
  for (const [scheme, viewport] of [['light', { width: 1280, height: 800 }], ['dark', { width: 1440, height: 900 }]]) {
    const { ctx, page, errors } = await open(b, { device: 'Desktop Chrome', viewport, server: false, state: { ...deskSeed().state } });
    await page.emulateMedia({ colorScheme: scheme });
    await page.evaluate(() => deskGo('home'));
    await page.waitForSelector('#chat-log .desk-home', { timeout: 8000 });
    await page.click('#side-general #settings-btn');
    await page.waitForSelector('#settings-panel:not([hidden]) .set-nav', { timeout: 4000 });
    const nav = await page.evaluate(() => [...document.querySelectorAll('.set-nav [data-go]')].map((x) => x.textContent));
    expect(nav.join() === 'You,Account,Study,Appearance,Voice and sound,Privacy and data,Plans,Help,Advanced,All settings', 'the list: ' + nav.join());
    const geo = await page.evaluate(() => { const n = document.querySelector('.set-nav').getBoundingClientRect(), c = document.querySelector('.settings-card').getBoundingClientRect(); return { navLeft: n.left - c.left, navW: n.width, cardW: c.width }; });
    expect(geo.navLeft < 40 && geo.navW >= 200 && geo.cardW > 900, 'the list on the left of a wide page: ' + JSON.stringify(geo));
    for (const [go, title, inside] of [['study', 'Study', '#level-select'], ['voice', 'Voice and sound', '#voice-gender-select'], ['plans', 'Plans', '.plan-compare'], ['appearance', 'Appearance', '#accent-swatches']]) {
      await page.click(`.set-nav [data-go="${go}"]`);
      expect(await page.locator('#set-title').innerText() === title && await page.locator(inside).isVisible() && await page.locator(`.set-nav [data-go="${go}"]`).getAttribute('aria-current') === 'page', `${go} opens on the right`);
    }
    const names = await page.evaluate(() => [...document.querySelectorAll('.accent-chip')].map((x) => x.textContent));
    expect(names.join() === 'Cassie,Monochrome,Forest,Ocean,Plum,Ember', 'colours by name: ' + names.join());
    await page.click('.accent-chip[data-accent="#1d4ed8"]');
    expect(await page.evaluate(() => accentChoice()) === '#1d4ed8' && await page.locator('.accent-chip[data-accent="#1d4ed8"]').getAttribute('aria-pressed') === 'true', 'Ocean picks blue');
    if (process.env.SHOTS) { await page.waitForTimeout(500); await page.screenshot({ path: `${process.env.SHOTS}/desk-settings-${viewport.width}-${scheme}.png` }); }
    const { bad } = await require('./ui-checks.cjs').contrastIssues(page, '#settings-panel');
    expect(!bad.length, `${scheme}: every word readable: ` + bad.join(' | '));
    await page.click('.accent-chip[data-accent="cassie"]');
    await page.click('#settings-x');
    expect(!errors.length, 'page errors: ' + errors.join('; '));
    await ctx.close();
  }
  // a phone: no list on the left, no colours by name
  const { ctx, page } = await open(b, { device: 'iPhone 13', server: false });
  await page.evaluate(() => openSettings('appearance'));
  await page.waitForSelector('#settings-panel:not([hidden])');
  expect(await page.evaluate(() => !document.querySelector('.set-nav').getBoundingClientRect().width && !document.querySelector('.accent-named').getBoundingClientRect().width), 'a phone’s Settings is unchanged');
  await ctx.close();
});

test('a new chat on a computer: no big Cassie over the title (the floating one stays), and the title shows in full', async (b) => {
  const { ctx, page, errors } = await open(b, { device: 'Desktop Chrome', viewport: { width: 1280, height: 800 }, server: false, state: deskSeed().state });
  await page.evaluate(() => deskGo('chat'));
  await page.waitForSelector('#chat-log .desk-chat .dk-title');
  await page.waitForTimeout(600);
  const T = await page.evaluate(() => { const t = document.querySelector('.desk-chat .dk-title'), r = t.getBoundingClientRect(); const pts = [[0.1, 0.5], [0.5, 0.5], [0.9, 0.5]].map(([x, y]) => { const e = document.elementFromPoint(r.left + r.width * x, r.top + r.height * y); return !!e && (e === t || t.contains(e)); }); return { bot: !!document.querySelector('.dk-chat-bot'), clear: pts.every(Boolean), mascot: !!document.getElementById('mascot') }; });
  expect(!T.bot && T.clear && T.mascot, 'no big Cassie, nothing over the title, the floating one is still there: ' + JSON.stringify(T));
  if (process.env.SHOTS) for (const scheme of ['light', 'dark']) { await page.emulateMedia({ colorScheme: scheme }); await page.waitForTimeout(800); await page.screenshot({ path: `${process.env.SHOTS}/new-chat-${scheme}.png` }); }
  expect(!errors.length, 'page errors: ' + errors.join('; '));
  await ctx.close();
});

test('computers: whatever you open last is in front: from Settings, Memory, Labs, Games, Board, Flashcards, Home and Calendar each show on top and Settings closes; Settings opened over Memory is on top', async (b) => {
  const { ctx, page, errors } = await open(b, { device: 'Desktop Chrome', viewport: { width: 1280, height: 800 }, server: false, state: deskSeed().state });
  await page.evaluate(() => deskGo('home'));
  await page.waitForSelector('#chat-log .desk-home');
  // what is on top in the middle of where each one shows
  const front = (sel) => page.evaluate((s) => { const el = document.querySelector(s); if (!el || !el.getClientRects().length) return 'not shown'; const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + Math.min(r.height / 2, 200), hit = document.elementFromPoint(x, y); return hit && (el === hit || el.contains(hit)) ? 'front' : 'behind ' + (hit ? (hit.id || hit.className || hit.tagName) : 'nothing'); }, sel);
  const openSettingsNow = async () => { await page.click('#side-general #settings-btn'); await page.waitForSelector('#settings-panel:not([hidden])'); };
  const CASES = [
    ['Memory', '#side-general #memory-btn', '#memory-panel'],
    ['Labs', '#side-apps #labs-btn', '.labs:not([hidden])'],
    ['Games', '#side-apps #games-btn', '.labs:not([hidden])'],
    ['Board', '#side-apps #board-btn', '.csk-panel'],
    ['Flashcards', '#side-tools .side-tool[data-tip="Flashcards"]', '.fc:not([hidden])'],
    ['Home', '#side-nav [data-page="home"]', '#chat-log .desk-home'],
    ['Calendar', '#side-nav [data-page="calendar"]', '#chat-log .desk-cal'],
  ];
  for (const [name, btn, shows] of CASES) {
    await openSettingsNow();
    if (name === 'Flashcards') await page.evaluate(() => setToolsOpen(true));
    await page.click(btn);
    await page.waitForSelector(shows, { timeout: 8000 });
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => document.getElementById('settings-panel').hidden), `${name}: Settings closed`);
    const f = await front(shows);
    expect(f === 'front', `${name} is in front after Settings: ` + f);
    if (process.env.SHOTS && name === 'Memory') { for (const scheme of ['light', 'dark']) { await page.emulateMedia({ colorScheme: scheme }); await page.waitForTimeout(700); await page.screenshot({ path: `${process.env.SHOTS}/memory-over-settings-${scheme}.png` }); } await page.emulateMedia({ colorScheme: 'light' }); }
    // close what opened, the way a student would
    await page.keyboard.press('Escape'); await page.waitForTimeout(250);
    await page.evaluate(() => { document.querySelectorAll('.labs:not([hidden]) .labs-x, .fc:not([hidden]) .fc-x').forEach((x) => x.click()); if (window.CassieSketch && window.CassieSketch.isOpen()) window.CassieSketch.close(); closeMemory(); });
    await page.waitForTimeout(250);
  }
  // the other way round: Memory, then Settings on top of it
  await page.click('#side-general #memory-btn');
  await page.waitForSelector('#memory-panel:not([hidden])');
  await openSettingsNow();
  expect(await page.evaluate(() => document.getElementById('memory-panel').hidden) && await front('#settings-panel .settings-card') === 'front', 'Settings opened over Memory is in front');
  expect(!errors.length, 'page errors: ' + errors.join('; '));
  await ctx.close();
});

test('computers: scrollbars in Cassie’s colours (the chat, the sidebar, Settings), following the picked colour in light and dark; phones keep their own', async (b) => {
  const { ctx, page, errors } = await open(b, { device: 'Desktop Chrome', viewport: { width: 1280, height: 800 }, server: false, state: deskSeed().state });
  await page.evaluate(() => deskGo('home'));
  await page.waitForSelector('#chat-log .desk-home');
  // the colour each scrollbar should be: the picked colour, softened toward the page (worked out by the browser)
  const read = () => page.evaluate(() => {
    const probe = document.createElement('i'); probe.style.color = 'color-mix(in srgb, var(--primary) 55%, var(--surface))'; document.body.appendChild(probe);
    const want = getComputedStyle(probe).color; probe.remove();
    const of = (el) => (getComputedStyle(el).scrollbarColor || '').split(/ (?=rgba?\(|color\()/)[0];
    return { want, chat: of(document.getElementById('chat-log')), side: of(document.getElementById('sidebar')), card: of(document.querySelector('#settings-panel .settings-card')) };
  });
  const seen = [];
  for (const [pick, scheme] of [['cassie', 'light'], ['#1d4ed8', 'light'], ['#1d4ed8', 'dark']]) {
    await page.evaluate((c) => setAccent(c), pick); await page.emulateMedia({ colorScheme: scheme }); await page.waitForTimeout(400);
    const S = await read();
    expect(S.chat === S.want && S.side === S.want && S.card === S.want, `${pick} ${scheme}: every scrollbar is the picked colour: ` + JSON.stringify(S));
    seen.push(S.want);
  }
  expect(new Set(seen).size === 3, 'it changes with the colour and the theme: ' + JSON.stringify(seen));
  if (process.env.SHOTS) { await page.evaluate(() => setAccent('cassie')); for (const scheme of ['light', 'dark']) { await page.emulateMedia({ colorScheme: scheme }); await page.waitForTimeout(700); await page.screenshot({ path: `${process.env.SHOTS}/scrollbar-${scheme}.png` }); } }
  await page.evaluate(() => setAccent('cassie'));
  expect(!errors.length, 'page errors: ' + errors.join('; '));
  await ctx.close();
  // a phone: the system's own
  const ph = await open(b, { device: 'iPhone 13', server: false });
  expect(await ph.page.evaluate(() => getComputedStyle(document.getElementById('chat-log')).scrollbarColor === 'auto'), 'a phone keeps its own scrollbars');
  await ph.ctx.close();
});

test('snap a problem: a camera button in the ask box on phones opens the back camera (accept image, capture environment); one snap is sent at once with a step by step ask, the photo goes to Cassie and she answers; typed words go with it; computers keep the clip only', async (b) => {
  const { ctx, page, errors } = await open(b, { device: 'iPhone 13', state: { groqKey: '' } }); // (no key: Cassie's server reads the photo)
  await page.evaluate(() => { const t = document.querySelector('.tabbar [data-tab="chat"]'); if (t && t.offsetParent) t.click(); });
  const sent = []; page.on('request', (rq) => { const d = rq.postData() || ''; if (/image_url|inlineData|"image"/.test(d)) sent.push(d); });
  const cam = await page.evaluate(() => { const i = document.getElementById('camera-input'), bt = document.getElementById('camera-btn'), r = bt.getBoundingClientRect(); return { accept: i.accept, capture: i.getAttribute('capture'), shown: r.width >= 40 && r.height >= 40, label: bt.getAttribute('aria-label') }; });
  expect(cam.accept === 'image/*' && cam.capture === 'environment' && cam.shown && /camera/i.test(cam.label), 'a camera button that opens the back camera: ' + JSON.stringify(cam));
  const png = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 80; c.height = 40; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 80, 40); g.fillStyle = '#000'; g.font = '20px sans-serif'; g.fillText('2x=8', 8, 28); return c.toDataURL('image/png').split(',')[1]; });
  // the camera's button opens the picker the phone shows as its camera
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('#camera-btn')]);
  expect(!chooser.isMultiple(), 'one photo at a time');
  await chooser.setFiles({ name: 'snap.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await page.waitForFunction(() => { const a = [...document.querySelectorAll('#chat-log .bubble-assistant')].pop(); return a && !a.querySelector('.typing-dots') && a.innerText.trim().length > 3; }, null, { timeout: 30000 });
  const user = await page.locator('#chat-log .bubble-user').last().innerText();
  expect(/Solve this step by step/.test(user), 'sent at once with a step by step ask: ' + user);
  expect(sent.length >= 1 && sent.some((d) => /data:image\/(png|jpeg|webp)/.test(d) && /Solve this step by step/.test(d)), 'the photo and the ask went to Cassie together: ' + sent.length);
  // typed words go with the snap instead
  await page.fill('#prompt-input', 'Only check my answer: x = 4');
  await page.setInputFiles('#camera-input', { name: 'snap2.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await page.waitForFunction(() => /Only check my answer/.test([...document.querySelectorAll('#chat-log .bubble-user')].pop().innerText), null, { timeout: 30000 });
  if (process.env.SHOTS) { await page.waitForTimeout(800); await page.screenshot({ path: process.env.SHOTS + '/camera-phone.png' }); }
  expect(!errors.length, 'page errors: ' + errors.join('; '));
  await ctx.close();
  // a computer: the clip only
  const d = await open(b, { device: 'Desktop Chrome', viewport: { width: 1280, height: 800 }, server: false, state: { groqKey: 'gsk_test' } });
  expect(await d.page.evaluate(() => !document.getElementById('camera-btn').getClientRects().length && !!document.getElementById('attach-btn').getClientRects().length), 'a computer has the clip, no camera button');
  await d.ctx.close();
});

test('podcast mode: under a long answer (and from a file in Study tools), the cost and the allowance first, then Jessica and Chris talk it through: a transcript, Back, Play, Skip, speed and an MP3 download; no daily or weekly rule (it comes out of the monthly voice); a resting voice says so and keeps the script', async (b) => {
  const LINES = [['Jessica', 'Welcome! Today we talk about photosynthesis.'], ['Chris', 'So how do plants make food?'], ['Jessica', 'They use light, water and carbon dioxide to make glucose.'], ['Chris', 'Recap: light, water, carbon dioxide make glucose and oxygen.']];
  const LONG = 'Photosynthesis is how plants make food. ' + 'Plants use light, water and carbon dioxide to make glucose and oxygen in their leaves. '.repeat(10);
  const fakeGroq = (body) => ({ text: /podcast script/.test(JSON.stringify(body.messages)) ? JSON.stringify({ lines: LINES.map(([who, say]) => ({ who, say })) }) : LONG });
  const wavB64 = () => { const n = 400, buf = Buffer.alloc(44 + n * 2); buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(8000, 24); buf.writeUInt32LE(16000, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40); return buf; };
  const voice = (said, mode) => async (c) => c.route(/\/speak(\?|$)/, (route) => {
    const rq = route.request();
    if (rq.method() !== 'POST') return route.fulfill({ json: { on: true, left: 9000, back: '2026-11-01' } });
    said.push(JSON.parse(rq.postData()));
    if (mode === 'day') return route.fulfill({ status: 429, headers: { 'x-speak': 'day', 'access-control-expose-headers': 'x-speak' }, json: { error: { message: 'That’s a lot of listening today.' } } });
    return route.fulfill({ status: 200, headers: { 'content-type': 'audio/wav', 'x-speak': 'new' }, body: wavB64() });
  });
  for (const [label, device, viewport, plan] of [['phone Free', 'iPhone 13', { width: 390, height: 844 }, null], ['computer Plus', 'Desktop Chrome', { width: 1280, height: 800 }, { plan: 'plus', until: 0 }]]) {
    const said = [];
    const { ctx, page, errors } = await open(b, { device, viewport, scale: 1, state: { groqKey: 'gsk_test', plan }, fakeGroq, setup: voice(said) });
    await page.evaluate(() => { const t = document.querySelector('.tabbar [data-tab="chat"]'); if (t && t.offsetParent) t.click(); });
    expect(await page.evaluate(() => HOME_EXAMPLES.some((x) => x.label === 'Podcast my notes')), 'Podcast my notes is in Study tools');
    await page.waitForFunction(() => window.CassieVoice.studio.known(), null, { timeout: 5000 });
    await ask(page, 'Explain photosynthesis for my review');
    await page.click('#chat-log .bubble-assistant .pod-make');
    await page.waitForSelector('.pod-sheet');
    const first = (await page.locator('.pod-sheet').innerText()).replace(/\s+/g, ' ');
    expect(/2,700 characters of Cassie’s voice, and you have 9,000 left this month/.test(first) && /No daily limit/.test(first), `${label}: the cost and the allowance first: ` + first);
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/podcast-cost-${viewport.width}.png` });
    await page.click('.pod-go');
    await page.waitForSelector('.pod-line', { timeout: 10000 });
    const T = await page.evaluate(() => [...document.querySelectorAll('.pod-line')].map((l) => l.querySelector('b').textContent + ': ' + l.querySelector('span').textContent));
    expect(T.length === 4 && T[0].startsWith('Jessica: Welcome') && T[1].startsWith('Chris:'), `${label}: the transcript, two voices: ` + JSON.stringify(T));
    // play: line by line, Jessica in the woman's voice, Chris in the man's, the transcript follows
    await page.click('.pod-play');
    await page.waitForFunction(() => +((document.querySelector('.pod-line.on') || {}).dataset || {}).i >= 2, null, { timeout: 10000 });
    expect(said.length >= 3 && said[0].voice === 'woman' && said[1].voice === 'man' && said[0].text.startsWith('Welcome'), `${label}: each line in its own voice: ` + JSON.stringify(said.map((x) => x.voice)));
    await page.click('[data-p="speed"]');
    expect(await page.locator('[data-p="speed"]').innerText() === '1.25x', 'speed');
    await page.click('.pod-line[data-i="0"]');
    await page.waitForFunction(() => document.querySelector('.pod-line.on').dataset.i === '0' || document.querySelector('.pod-line.on').dataset.i === '1', null, { timeout: 4000 });
    for (const scheme of ['light', 'dark']) { await page.emulateMedia({ colorScheme: scheme }); await page.waitForTimeout(500); if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/podcast-${viewport.width}-${scheme}.png` }); const { bad } = await require('./ui-checks.cjs').contrastIssues(page, '.pod-sheet'); expect(!bad.length, `${label} ${scheme}: readable: ` + bad.join(' | ')); }
    await page.emulateMedia({ colorScheme: 'light' });
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), page.click('[data-p="dl"]')]);
    expect(/podcast\.mp3$/.test(dl.suggestedFilename()), 'one MP3 to keep: ' + dl.suggestedFilename());
    await page.click('.pod-x');
    // no daily or weekly rule: another one straight away (the voice it uses comes off the month)
    await page.click('#chat-log .bubble-assistant .pod-make');
    const again = (await page.locator('.pod-sheet').innerText()).replace(/\s+/g, ' ');
    expect(!/Your next one|Back tomorrow/.test(again) && !(await page.locator('.pod-go').isDisabled()) && await page.locator('.pod-go').innerText() === 'Make my podcast', `${label}: another one now: ` + again);
    expect(!errors.length, 'page errors: ' + errors.join('; '));
    await ctx.close();
  }
  // a resting voice: it says why, and the script stays to read (and to download)
  const said = [];
  const { ctx, page } = await open(b, { device: 'iPhone 13', state: { groqKey: 'gsk_test' }, fakeGroq, setup: voice(said, 'day') });
  await page.evaluate(() => { const t = document.querySelector('.tabbar [data-tab="chat"]'); if (t && t.offsetParent) t.click(); });
  await page.waitForFunction(() => window.CassieVoice.studio.known(), null, { timeout: 5000 });
  await ask(page, 'Explain photosynthesis');
  await page.click('#chat-log .bubble-assistant .pod-make');
  await page.click('.pod-go');
  await page.waitForSelector('.pod-line');
  await page.click('.pod-play');
  await page.waitForFunction(() => /listened to Cassie a lot today/.test(document.querySelector('.pod-note').textContent), null, { timeout: 6000 });
  expect(await page.locator('.pod-line').count() === 4, 'the script stays');
  await ctx.close();
});

test('the Exam Rescue Plan (free, from the landing page): subject, day and topics make a day by day plan at once, made on the device (nothing sent anywhere): each topic learned, then flashcards, then a quiz on a later day, at most 3 a day, a light last day, how to study each task and an exam day checklist; too few days says what gets only a quick look; Save it in Cassie keeps it as an exam plan (a new student keeps it through sign up; Free with a plan already is told); readable in light and dark', async (b) => {
  const RESCUE = APP.replace('app.html', 'rescue.html');
  const land = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  expect((land.match(/href="rescue\.html"/g) || []).length >= 2, 'the landing page links to it (the hero and the footer)');
  expect(/rescue\.html let\.html rescue\.css rescue\.js/.test(fs.readFileSync(path.join(ROOT, 'scripts/build-site.sh'), 'utf8')), 'the site build publishes it');
  const day = (n) => new Date(Date.now() + 8 * 3600e3 + n * 864e5).toISOString().slice(0, 10);
  for (const [device, viewport] of [['Pixel 7', null], ['Desktop Chrome', { width: 1280, height: 800 }]]) {
    const { ctx, page, errors } = await open(b, { device, viewport, state: { exams: [] } });
    const away = [];
    page.on('request', (r) => { const u = new URL(r.url()); if (/rescue\.html/.test(r.frame().url()) && u.origin !== new URL(APP).origin) away.push(u.href); }); // (the rescue page's own requests)
    await page.goto(RESCUE);
    for (const scheme of ['light', 'dark']) { await page.emulateMedia({ colorScheme: scheme }); await page.waitForTimeout(150); const { bad } = await require('./ui-checks.cjs').contrastIssues(page, 'body'); expect(!bad.length, 'the form, ' + scheme + ': readable: ' + bad.join(' | ')); }
    await page.emulateMedia({ colorScheme: 'light' });
    await page.click('.rs-go');
    expect(/What is the exam/.test(await page.locator('#rs-err').innerText()), 'nothing typed: it says what to fill in');
    await page.fill('[name=subject]', 'Biology midterm');
    await page.fill('[name=date]', day(-1));
    await page.fill('[name=topics]', 'Cells');
    await page.click('#rs-form .rs-go');
    expect(/has passed/.test(await page.locator('#rs-err').innerText()), 'a day that has passed is refused');
    await page.fill('[name=date]', day(7));
    await page.fill('[name=topics]', 'Cells\nPhotosynthesis\nRespiration\nGenetics');
    await page.click('#rs-form .rs-go');
    await page.waitForSelector('#rs-plan:not([hidden]) .rs-day');
    await page.waitForTimeout(1200); // (it scrolls to the plan)
    const plan = await page.evaluate((d) => CassieRescue.makePlan({ name: 'Biology midterm', date: d, topics: 'Cells\nPhotosynthesis\nRespiration\nGenetics' }), day(7));
    expect(plan.days.length === 7 && plan.days.every((x) => x.tasks.length >= 1 && x.tasks.length <= 3) && plan.days[6].date === day(6) && !plan.dropped.length, 'a week: every day until the day before, 1 to 3 tasks a day: ' + JSON.stringify(plan.days.map((x) => x.tasks.length)));
    for (const t of ['Cells', 'Photosynthesis', 'Respiration', 'Genetics']) {
      const when = (k) => plan.days.findIndex((x) => x.tasks.some((y) => y.kind === k && y.topic === t));
      expect(when('learn') >= 0 && when('cards') > when('learn') && when('quiz') > when('cards'), `${t}: learned, then flashcards, then a quiz on later days: ` + [when('learn'), when('cards'), when('quiz')]);
    }
    expect(plan.days[6].tasks.every((x) => x.kind === 'mistakes' || x.kind === 'focus'), 'the last day is light: mistakes and a last look');
    expect(plan.days.every((x) => new Set(x.tasks.map((t) => t.kind + t.topic)).size === x.tasks.length), 'never the same task twice in a day: ' + JSON.stringify(plan.days.map((x) => x.tasks.map((t) => t.kind))));
    const shown = await page.locator('#rs-plan').innerText();
    expect(/Biology midterm/.test(shown) && /Learn Cells/.test(shown) && /explain it out loud/.test(shown) && /about \d+ min/.test(shown) && /Sleep at least 7 hours/.test(shown), 'the plan says what, how and for how long, and the exam day checklist');
    expect(!/[–—]/.test(await page.locator('body').innerText()), 'no dashes');
    expect(!away.length, 'made on the device: nothing sent anywhere: ' + away.join(', '));
    // two days with five topics: says what gets only a quick look
    const tight = await page.evaluate((d) => CassieRescue.makePlan({ name: 'Chem', date: d, topics: 'A,B,C,D,E,F,G' }), day(1));
    expect(tight.days.length === 1 && tight.days[0].tasks.length === 3 && tight.dropped.length >= 4, 'exam tomorrow: today only, the rest named: ' + JSON.stringify(tight));
    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme }); await page.waitForTimeout(200);
      if (process.env.SHOTS) { await page.screenshot({ path: `${process.env.SHOTS}/rescue-${viewport ? viewport.width : 'phone'}-${scheme}.png`, fullPage: false }); await page.locator('#rs-plan').screenshot({ path: `${process.env.SHOTS}/rescue-plan-${viewport ? viewport.width : 'phone'}-${scheme}.png` }); }
      const { bad } = await require('./ui-checks.cjs').contrastIssues(page, 'main');
      expect(!bad.length, scheme + ': readable: ' + bad.join(' | '));
    }
    await page.emulateMedia({ colorScheme: 'light' });
    const over = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    expect(over <= 0, 'nothing off the side: ' + over);
    // Save it in Cassie: an exam plan in the app, ready
    await Promise.all([page.waitForURL(/app\.html/), page.click('#rs-save')]);
    await page.waitForSelector('.ex-ready-sheet', { timeout: 8000 });
    const kept = await page.evaluate(() => ({ exams: state.exams, left: localStorage.getItem('cassie.rescue'), url: location.search }));
    const ex = kept.exams[0];
    expect(kept.exams.length === 1 && ex.name === 'Biology midterm' && ex.date === day(7) && ex.days.length === 7 && ex.days.every((x) => x.tasks.every((t) => t.id && t.done === false)), 'kept as an exam plan: ' + JSON.stringify(ex && ex.days.length));
    expect(kept.left === null && kept.url === '', 'handed over once (and the address is tidy)');
    expect(/Biology midterm/.test(await page.locator('.ex-ready-sheet').innerText()), 'Your Exam Plan is ready');
    expect(!errors.length, 'page errors: ' + errors.join('; '));
    await ctx.close();
  }
  // a new student: the plan is kept, and the first questions have the exam filled in (not made twice)
  {
    const { ctx, page } = await open(b, { state: null });
    await page.goto(RESCUE);
    await page.fill('[name=subject]', 'History quiz'); await page.fill('[name=date]', day(4)); await page.fill('[name=topics]', 'Rizal\nRevolution');
    await page.click('#rs-form .rs-go');
    await Promise.all([page.waitForURL(/app\.html/), page.click('#rs-save')]);
    await page.waitForFunction(() => Array.isArray(state.exams) && state.exams.length === 1);
    expect(await page.evaluate(() => state.exams[0].name === 'History quiz' && !state.profile), 'kept for a new student (who then signs up as always)');
    await ctx.close();
  }
  // Free with a plan already: told, and the rescue plan waits
  {
    const old = { id: 'exold', name: 'Math', date: day(10), topics: 'Algebra', from: day(0), at: Date.now(), days: [{ date: day(0), tasks: [{ id: 'a', kind: 'learn', topic: 'Algebra', done: false }] }], stats: {} };
    const { ctx, page } = await open(b, { state: { plan: null, exams: [old] } });
    await page.goto(RESCUE);
    await page.fill('[name=subject]', 'Physics'); await page.fill('[name=date]', day(3)); await page.fill('[name=topics]', 'Forces');
    await page.click('#rs-form .rs-go');
    await Promise.all([page.waitForURL(/app\.html/), page.click('#rs-save')]);
    await page.waitForSelector('.plus-sheet', { timeout: 8000 });
    const s = await page.evaluate(() => ({ n: state.exams.length, text: document.querySelector('.plus-sheet').innerText, left: !!localStorage.getItem('cassie.rescue') }));
    expect(s.n === 1 && /Exam Rescue Plan/.test(s.text) && s.left, 'Free keeps one plan: it says so, and the new one waits: ' + JSON.stringify(s));
    await ctx.close();
  }
});
test('Share my plan: the LET and Rescue plans become a 1080x1350 picture made on the device (the exam, the days to go, the first days, a dot a day, Made free with Cassie and the link); a phone opens its share sheet with the link, a computer saves it; long names stay inside', async (b) => {
  const LET = APP.replace('app.html', 'let.html'), RESCUE = APP.replace('app.html', 'rescue.html');
  const day = (n) => new Date(Date.now() + 8 * 3600e3 + n * 864e5).toISOString().slice(0, 10);
  // a computer: the picture is saved
  let { ctx, page, errors } = await open(b, { device: 'Desktop Chrome', viewport: { width: 1280, height: 800 }, state: { exams: [] } });
  try {
    const away = [];
    page.on('request', (r) => { const u = new URL(r.url()); if (u.origin !== new URL(APP).origin && !u.protocol.startsWith('blob')) away.push(u.href); });
    await page.goto(LET);
    await page.fill('[name=date]', day(45));
    await page.click('#rs-form .rs-go');
    await page.waitForSelector('#rs-plan:not([hidden]) .rs-day');
    expect(await page.locator('#rs-share').innerText() === 'Share my plan', 'a Share my plan button under the plan');
    away.length = 0;
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#rs-share')]);
    expect(dl.suggestedFilename() === 'my-let-plan.png', 'saved as my-let-plan.png: ' + dl.suggestedFilename());
    const file = await dl.path();
    const png = fs.readFileSync(file);
    expect(png.readUInt32BE(16) === 1080 && png.readUInt32BE(20) === 1350, 'a 1080 x 1350 picture: ' + png.readUInt32BE(16) + 'x' + png.readUInt32BE(20));
    if (process.env.SHOTS) fs.copyFileSync(file, process.env.SHOTS + '/share-let.png');
    await page.waitForFunction(() => /Saved to your downloads/.test(document.querySelector('#rs-share-msg').textContent));
    expect(!away.length, 'nothing sent anywhere: ' + away.join(' '));
    // what is drawn: words in the title, the big number, the days, the footer; nothing past the right margin
    const drawn = await page.evaluate((d) => {
      const plan = CassieRescue.makePlan({ name: 'LET Secondary: Technology and Livelihood Education with a very long major name that goes on', date: d, topics: CassieRescue.letTopics('secondary', 'Technology and Livelihood Education').join('\n') });
      const c = CassieRescue.planPicture(plan, true), g = c.getContext('2d');
      const lit = (x, y, w, h) => { const px = g.getImageData(x, y, w, h).data; let n = 0; for (let i = 0; i < px.length; i += 4) if (px[i] + px[i + 1] + px[i + 2] > 300) n++; return n; };
      return { title: lit(84, 160, 900, 180), big: lit(84, 360, 600, 200), foot: lit(84, 1180, 700, 90), edge: lit(1040, 0, 40, 1350), days: plan.days.length };
    }, day(45));
    expect(drawn.title > 2000 && drawn.big > 2000 && drawn.foot > 1000, 'the title, the days to go and the footer are drawn: ' + JSON.stringify(drawn));
    expect(drawn.edge === 0, 'nothing runs past the right edge, even a very long name: ' + JSON.stringify(drawn));
    expect(!errors.length, 'page errors: ' + errors.join('; '));
  } finally { await ctx.close(); }
  // a phone: its share sheet, with the picture and the link to get one
  ({ ctx, page, errors } = await open(b, { device: 'Pixel 7', state: { exams: [] } }));
  try {
    await page.addInitScript(() => { window.__shared = null; navigator.canShare = (d) => !!(d && d.files); navigator.share = async (d) => { window.__shared = { files: d.files.map((f) => [f.name, f.type, f.size]), text: d.text }; }; });
    await page.goto(RESCUE);
    await page.fill('[name=subject]', 'Biology midterm');
    await page.fill('[name=date]', day(6));
    await page.fill('[name=topics]', 'Cells\nPhotosynthesis\nRespiration');
    await page.click('#rs-form .rs-go');
    await page.waitForSelector('#rs-plan:not([hidden]) .rs-day');
    await page.click('#rs-share');
    await page.waitForFunction(() => window.__shared);
    const sh = await page.evaluate(() => window.__shared);
    expect(sh.files.length === 1 && sh.files[0][0] === 'my-exam-plan.png' && sh.files[0][1] === 'image/png' && sh.files[0][2] > 10000, 'the picture goes to the share sheet: ' + JSON.stringify(sh.files));
    expect(/made free with Cassie/.test(sh.text) && /https:\/\/askcassie\.study\/rescue\.html/.test(sh.text), 'with the link to get one: ' + sh.text);
    expect(/Shared/.test(await page.locator('#rs-share-msg').innerText()), 'it says it was shared');
    const tap = await page.locator('#rs-share').boundingBox();
    expect(tap.height >= 44, 'the button is easy to tap: ' + tap.height);
    if (process.env.SHOTS) { const png = await page.evaluate((d) => CassieRescue.planPicture(CassieRescue.makePlan({ name: 'Biology midterm', date: d, topics: 'Cells\nPhotosynthesis\nRespiration' }), false).toDataURL('image/png'), day(6)); fs.writeFileSync(process.env.SHOTS + '/share-rescue.png', Buffer.from(png.split(',')[1], 'base64')); }
    expect(!errors.length, 'page errors: ' + errors.join('; '));
  } finally { await ctx.close(); }
});

test('the LET Rescue Plan (let.html, linked from the Rescue Plan and the landing page): the level fills in the LET topics (Professional Education, General Education, and the major for Secondary, which is asked for); a review of months quizzes every topic twice; the plan is called by the level and major, with the LET exam day list; the student can change the topics; made on the device; Save it in Cassie keeps it as an exam plan; readable in light and dark', async (b) => {
  const LET = APP.replace('app.html', 'let.html');
  expect(/href="let\.html"/.test(fs.readFileSync(path.join(ROOT, 'rescue.html'), 'utf8')) && /href="let\.html"/.test(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')), 'linked from the Rescue Plan and the landing page');
  expect(/ let\.html /.test(fs.readFileSync(path.join(ROOT, 'scripts/build-site.sh'), 'utf8')), 'the site build publishes it');
  const day = (n) => new Date(Date.now() + 8 * 3600e3 + n * 864e5).toISOString().slice(0, 10);
  for (const [device, viewport] of [['Pixel 7', null], ['Desktop Chrome', { width: 1280, height: 800 }]]) {
    const { ctx, page, errors } = await open(b, { device, viewport, state: { exams: [] } });
    const away = [];
    page.on('request', (r) => { const u = new URL(r.url()); if (/let\.html/.test(r.frame().url()) && u.origin !== new URL(APP).origin) away.push(u.href); });
    await page.goto(LET);
    const elem = (await page.inputValue('[name=topics]')).split('\n');
    expect(elem.length === 14 && elem.includes('Assessment of Learning') && elem.includes('Filipino') && await page.locator('[name=major]').isHidden(), 'Elementary: Professional and General Education filled in, no major: ' + elem.length);
    for (const scheme of ['light', 'dark']) { await page.emulateMedia({ colorScheme: scheme }); await page.waitForTimeout(150); const { bad } = await require('./ui-checks.cjs').contrastIssues(page, 'body'); expect(!bad.length, 'the form, ' + scheme + ': readable: ' + bad.join(' | ')); }
    await page.emulateMedia({ colorScheme: 'light' });
    await page.selectOption('[name=level]', 'secondary');
    expect(await page.locator('[name=major]').isVisible(), 'Secondary asks for the major');
    await page.fill('[name=date]', day(120));
    await page.click('#rs-form .rs-go');
    expect(/major/.test(await page.locator('#rs-err').innerText()), 'no major: it asks');
    await page.fill('[name=major]', 'English');
    const sec = (await page.inputValue('[name=topics]')).split('\n');
    expect(sec.length === 17 && sec[0] === 'English: the content' && sec.includes('English: teaching it'), 'Secondary: the major first, then the rest: ' + sec.slice(0, 3));
    await page.click('#rs-form .rs-go');
    await page.waitForSelector('#rs-plan:not([hidden]) .rs-day');
    await page.waitForTimeout(1200);
    const shown = await page.locator('#rs-plan').innerText();
    expect(/Your LET Rescue Plan/i.test(shown) && /LET Secondary: English/.test(shown) && /Notice of Admission/.test(shown) && /Learn English: the content/.test(shown), 'called by the level and major, with the LET exam day list');
    const plan = await page.evaluate((d) => CassieRescue.makePlan({ name: 'LET Secondary: English', date: d, topics: CassieRescue.letTopics('secondary', 'English').join('\n') }), day(120));
    const n = (k, t) => plan.days.reduce((a, x) => a + x.tasks.filter((y) => y.kind === k && y.topic === t).length, 0);
    expect(!plan.dropped.length && sec.every((t) => n('learn', t) === 1 && n('quiz', t) === 2), 'months of review: every topic learned once and quizzed twice: ' + JSON.stringify(sec.map((t) => n('quiz', t))));
    expect(plan.days.every((x) => x.tasks.length <= 3 && x.date < day(120)) && plan.days[plan.days.length - 1].tasks.every((x) => x.kind === 'mistakes' || x.kind === 'focus'), 'at most 3 a day, a light last day');
    expect(!/[–—]/.test(await page.locator('body').innerText()), 'no dashes');
    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme }); await page.waitForTimeout(200);
      if (process.env.SHOTS) await page.locator('#rs-plan').screenshot({ path: `${process.env.SHOTS}/let-plan-${viewport ? viewport.width : 'phone'}-${scheme}.png` });
      const { bad } = await require('./ui-checks.cjs').contrastIssues(page, 'main');
      expect(!bad.length, scheme + ': readable: ' + bad.join(' | '));
    }
    await page.emulateMedia({ colorScheme: 'light' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 0, 'nothing off the side');
    // the student's own topics stay when the major changes
    await page.fill('[name=topics]', 'Grammar\nLiterature');
    await page.fill('[name=major]', 'Filipino');
    expect(await page.inputValue('[name=topics]') === 'Grammar\nLiterature', 'edited topics are kept');
    await page.fill('[name=major]', 'English');
    await page.click('#rs-form .rs-go');
    await page.waitForTimeout(400);
    await Promise.all([page.waitForURL(/app\.html/), page.click('#rs-save')]);
    await page.waitForSelector('.ex-ready-sheet', { timeout: 8000 });
    const ex = await page.evaluate(() => state.exams[0]);
    expect(ex && ex.name === 'LET Secondary: English' && ex.date === day(120) && /Grammar/.test(ex.topics), 'kept in Cassie as an exam plan: ' + JSON.stringify(ex && { name: ex.name, topics: ex.topics }));
    expect(!away.length, 'made on the device: ' + away.join(', '));
    expect(!errors.length, 'page errors: ' + errors.join('; '));
    await ctx.close();
  }
});
// a VAPID key pair made here for the test only (never kept)
async function testVapid() {
  const { subtle } = require('crypto').webcrypto;
  const kp = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const raw = Buffer.from(await subtle.exportKey('raw', kp.publicKey)).toString('base64url');
  return { pub: raw, priv: (await subtle.exportKey('jwk', kp.privateKey)).d };
}
test('reminders on the server: only a browser’s push service is kept; once an hour Cassie sends an empty push to whoever picked this hour, at most once a day, never in quiet hours, only when a card is due today or the streak ends tonight; signed with the Cassie key; a push address the browser dropped is forgotten', async () => {
  const keys = await testVapid();
  const off = await realServer({});
  expect((await off.call('GET', '/push/key')).json.on === false, 'no keys: reminders are off');
  expect((await off.call('POST', '/push/subscribe', { id: 'abcdefgh-1', endpoint: 'https://fcm.googleapis.com/fcm/send/x' })).status === 503, 'no keys: nothing is kept');
  const { call, DB, w } = await realServer({ VAPID_PUBLIC_KEY: keys.pub, VAPID_PRIVATE_KEY: keys.priv });
  const key = await call('GET', '/push/key');
  expect(key.json.on && key.json.key === keys.pub, 'the public key for the browser: ' + key.text);
  for (const ep of ['https://evil.example.com/push', 'http://fcm.googleapis.com/fcm/send/x', 'https://fcm.googleapis.com.evil.com/x', 'not a url']) expect((await call('POST', '/push/subscribe', { id: 'abcdefgh-9', endpoint: ep })).status === 400, 'only a browser’s push service: ' + ep);
  const T = Date.UTC(2026, 9, 21, 19, 5); // 7:05 PM (UTC, and tz 0)
  const yday = '2026-10-20', base = { hour: 19, quietFrom: 22, quietTo: 7, tz: 0 };
  const subs = {
    due: { ...base, endpoint: 'https://fcm.googleapis.com/fcm/send/due', nextDue: T + 3600e3 }, // a card due later today
    nothing: { ...base, endpoint: 'https://fcm.googleapis.com/fcm/send/nothing', nextDue: T + 3 * 864e5 },
    streak: { ...base, endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/streak', streak: 4, streakDay: yday },
    done: { ...base, endpoint: 'https://web.push.apple.com/done', streak: 4, streakDay: '2026-10-21', nextDue: 0 }, // (studied today)
    gone: { ...base, endpoint: 'https://fcm.googleapis.com/fcm/send/gone', nextDue: T - 1000 },
    quiet: { ...base, hour: 23, endpoint: 'https://fcm.googleapis.com/fcm/send/quiet', nextDue: T - 1000 },
    later: { ...base, hour: 20, endpoint: 'https://fcm.googleapis.com/fcm/send/later', nextDue: T - 1000 },
    manila: { ...base, hour: 3, tz: 480, endpoint: 'https://fcm.googleapis.com/fcm/send/manila', nextDue: T + 3600e3 }, // 3:05 AM in Manila, quiet
  };
  for (const [name, s] of Object.entries(subs)) { const r = await call('POST', '/push/subscribe', { id: 'id-' + name + '-0000', ...s }); expect(r.status === 200, 'kept: ' + name + ' ' + r.text); }
  const rows = await DB.prepare('SELECT * FROM push_subs').all();
  expect(rows.results.length === 8 && rows.results.every((r) => Object.keys(r).sort().join() === 'at,endpoint,hour,id,last_sent,next_due,qfrom,qto,streak,streak_day,tz'), 'only times and counts are kept: ' + JSON.stringify(rows.results[0]));
  const realFetch = globalThis.fetch, sent = [];
  globalThis.fetch = async (u, o = {}) => { sent.push({ u: String(u), o }); return new Response('', { status: /gone/.test(u) ? 410 : 201 }); };
  const cron = async (at) => { sent.length = 0; const pending = []; await w.scheduled({ scheduledTime: at }, { DB, VAPID_PUBLIC_KEY: keys.pub, VAPID_PRIVATE_KEY: keys.priv }, { waitUntil: (x) => pending.push(x) }); await Promise.all(pending); return sent.map((s) => s.u.split('/').pop()).sort(); };
  try {
    let got = await cron(T);
    expect(got.join() === 'due,gone,streak', 'at 7 PM: a card due today, a streak ending tonight (and the dropped one is tried), nothing else: ' + got.join());
    const one = sent.find((s) => /due$/.test(s.u));
    expect(one.o.method === 'POST' && !one.o.body && one.o.headers.ttl && one.o.headers['content-length'] === '0', 'an empty push (the words are written on the phone): ' + JSON.stringify(one.o.headers));
    const m = one.o.headers.authorization.match(/^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/);
    expect(m && m[4] === keys.pub, 'signed, with the Cassie key: ' + one.o.headers.authorization.slice(0, 40));
    const claims = JSON.parse(Buffer.from(m[2], 'base64url').toString());
    expect(claims.aud === 'https://fcm.googleapis.com' && claims.exp > T / 1000 - 1e9 && /^mailto:/.test(claims.sub), 'for that push service: ' + JSON.stringify(claims));
    const { subtle } = require('crypto').webcrypto;
    const pk = await subtle.importKey('raw', Buffer.from(keys.pub, 'base64url'), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    expect(await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pk, Buffer.from(m[3], 'base64url'), Buffer.from(m[1] + '.' + m[2])), 'the signature checks out with the public key');
    const left = (await DB.prepare('SELECT id FROM push_subs').all()).results.map((r) => r.id);
    expect(!left.includes('id-gone-0000') && left.length === 7, 'a push address the browser dropped (410) is forgotten: ' + left.join());
    expect((await cron(T + 20 * 60e3)).length === 0, 'once a day: not again in the same hour');
    got = await cron(T + 3600e3);
    expect(got.join() === 'later', 'at 8 PM: the one who picked 8 PM: ' + got.join());
    // the app says what changed: nothing due now
    await call('POST', '/push/state', { id: 'id-due-0000', nextDue: T + 5 * 864e5, streak: 0, streakDay: '' });
    got = await cron(T + 864e5);
    expect(!got.includes('due') && !got.includes('streak'), 'the next day: nothing due and no streak ending, so no reminder: ' + got.join());
    await call('POST', '/push/unsubscribe', { id: 'id-later-0000' });
    expect(!(await DB.prepare('SELECT id FROM push_subs').all()).results.some((r) => r.id === 'id-later-0000'), 'turning reminders off forgets the push address');
  } finally { globalThis.fetch = realFetch; }
});
test('reminders in Settings: on with a tap (asks to allow notifications), a time to remind and quiet hours (a time in the quiet hours is refused), only times and counts go to Cassie, the phone writes the words itself (how many cards are due and one of them, or the streak); off forgets it; an iPhone is told to add Cassie to the Home Screen first', async (b) => {
  const keys = await testVapid();
  const posts = [];
  const setup = async (c) => {
    await c.grantPermissions(['notifications'], { origin: 'http://localhost:' + APP_PORT });
    await c.addInitScript(() => { // (no real push service in a test: the browser's own subscribe, faked)
      let sub = null;
      if (window.PushManager) {
        PushManager.prototype.getSubscription = async () => sub;
        PushManager.prototype.subscribe = async (o) => { window.__pushOpts = o; sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/test-device', unsubscribe: async () => { sub = null; return true; } }; return sub; };
      }
    });
    await c.route(/\/push\//, (route) => { const rq = route.request(); if (rq.method() === 'GET') return route.fulfill({ json: { on: true, key: keys.pub } }); posts.push({ path: new URL(rq.url()).pathname, body: JSON.parse(rq.postData() || '{}') }); return route.fulfill({ json: { ok: true } }); });
  };
  const now = Date.now();
  const cards = [{ id: 'c1', f: 'Mitochondria', b: 'The powerhouse of the cell', deck: 'Bio', box: 1, due: now - 60e3, at: now }, { id: 'c2', f: 'Ribosome', b: 'Makes proteins', deck: 'Bio', box: 1, due: now - 30e3, at: now }];
  for (const [device, viewport] of [['Pixel 7', null], ['Desktop Chrome', { width: 1280, height: 800 }]]) {
    posts.length = 0;
    const { ctx, page, errors } = await open(b, { device, viewport, state: { cards }, setup });
    await page.evaluate(() => navigator.serviceWorker.ready);
    await tapSettings(page);
    await page.evaluate(() => setPage('study'));
    await page.locator('#remind-toggle').check();
    await page.waitForFunction(() => state.remind && state.remind.on, null, { timeout: 8000 });
    const sub = posts.find((p) => p.path === '/push/subscribe');
    expect(sub && sub.body.endpoint === 'https://fcm.googleapis.com/fcm/send/test-device' && sub.body.hour === 19 && sub.body.quietFrom === 22 && sub.body.quietTo === 7 && typeof sub.body.tz === 'number' && sub.body.nextDue === cards[0].due, 'on: the push address, the hour, quiet hours, time zone and when the next card is due: ' + JSON.stringify(sub && sub.body));
    expect(!JSON.stringify(posts).includes('Mitochondria'), 'no card words go to Cassie');
    expect(await page.evaluate(() => new Uint8Array(window.__pushOpts.applicationServerKey).length === 65 && window.__pushOpts.userVisibleOnly), 'subscribed with Cassie’s public key, notifications shown');
    expect(/reminds you at 7:00 PM, never between 10:00 PM and 7:00 AM/.test(await page.locator('#remind-note').innerText()), 'it says when: ' + await page.locator('#remind-note').innerText());
    // the phone writes the words: what's due and one of the cards
    let sw = null;
    for (let i = 0; i < 40 && !sw; i++) { sw = ctx.serviceWorkers().find((w) => /\/sw\.js$/.test(w.url())); if (!sw) await page.waitForTimeout(250); }
    expect(sw, 'the service worker is there');
    let text = await sw.evaluate(() => remindText());
    expect(text === '2 cards are due today, like Mitochondria. A 5 minute review keeps them.', 'the reminder, written on the phone: ' + text);
    await page.evaluate(() => { const y = new Date(Date.now() - 864e5); const d = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`; return caches.open('cassie-remind').then((c) => c.put('/__remind', new Response(JSON.stringify({ due: [], soon: [], streak: 6, streakDay: d })))); });
    text = await sw.evaluate(() => remindText());
    expect(text === 'Your 6 day streak ends tonight. One question keeps it going.', 'or the streak: ' + text);
    // a time in the quiet hours is refused
    await page.selectOption('#remind-hour', '23');
    await page.waitForFunction(() => /quiet hours/.test(document.getElementById('remind-note').textContent));
    expect(await page.evaluate(() => state.remind.hour === 19 && document.getElementById('remind-hour').value === '19'), 'stays at 7 PM');
    await page.selectOption('#remind-hour', '20');
    await page.waitForFunction(() => state.remind.hour === 20);
    expect(posts.filter((p) => p.path === '/push/subscribe').pop().body.hour === 20, 'a new time is sent');
    // a new card: only the new "next due" goes, once
    const n0 = posts.length;
    await page.evaluate(() => { state.cards.push({ id: 'c3', f: 'Golgi', b: 'Packages', deck: 'Bio', box: 0, due: Date.now() - 120e3, at: Date.now() }); save(); });
    await page.waitForTimeout(2200);
    const st = posts.slice(n0).filter((p) => p.path === '/push/state');
    expect(st.length === 1 && st[0].body.nextDue < cards[0].due && !('cards' in st[0].body), 'the next due time is updated: ' + JSON.stringify(st));
    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme }); await page.waitForTimeout(300);
      await page.locator('.remind-row').scrollIntoViewIfNeeded();
      if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/remind-${viewport ? viewport.width : 'phone'}-${scheme}.png` });
      const { bad } = await require('./ui-checks.cjs').contrastIssues(page, '.remind-row');
      expect(!bad.length, scheme + ': readable: ' + bad.join(' | '));
    }
    await page.emulateMedia({ colorScheme: 'light' });
    await page.locator('#remind-toggle').uncheck();
    await page.waitForFunction(() => !state.remind.on);
    await page.waitForTimeout(300);
    expect(posts.some((p) => p.path === '/push/unsubscribe') && await page.evaluate(() => navigator.serviceWorker.ready.then((r) => r.pushManager.getSubscription()).then((s) => s === null)), 'off: forgotten here and on Cassie');
    expect(!errors.length, 'page errors: ' + errors.join('; '));
    await ctx.close();
  }
  // an iPhone in Safari (not from the Home Screen) has no push
  const { ctx, page } = await open(b, { device: 'iPhone 13', setup: async (c) => c.addInitScript(() => { delete window.PushManager; }) });
  await tapSettings(page);
  await page.evaluate(() => setPage('study'));
  expect(await page.locator('#remind-toggle').isDisabled() && /add Cassie to your Home Screen first/.test(await page.locator('#remind-note').innerText()), 'iPhone: add Cassie to the Home Screen first: ' + await page.locator('#remind-note').innerText());
  if (process.env.SHOTS) { await page.locator('.remind-row').scrollIntoViewIfNeeded(); await page.screenshot({ path: `${process.env.SHOTS}/remind-iphone.png` }); }
  await ctx.close();
});
test('the app’s Plans show all three (Free, Plus, Pro) with an at-a-glance table that fits a phone: Pro’s price and limits, Plus still Best for school, no sideways scrolling', async (b) => {
  const { ctx, page, errors } = await open(b, { device: 'iPhone 13', scale: 1, server: false, state: { plan: null, groqKey: 'gsk_test' } });
  await page.evaluate(() => openSettings('plans'));
  await page.waitForSelector('.set-plans', { state: 'visible', timeout: 8000 });
  const names = await page.locator('.set-plans .plan h3').allInnerTexts();
  expect(names.join() === 'Free,Plus,Pro', 'three plans: ' + names.join());
  // prices a month first (smaller numbers), with no Pasado Pass yet
  const text = async (sel) => (await page.locator(sel).innerText()).replace(/\s+/g, ' ');
  expect(await page.locator('.set-plans [data-bill="m"]').getAttribute('aria-pressed') === 'true', 'Monthly is picked at first');
  let plus = await text('.set-plans .plan-plus'), pro = await text('.set-plans .plan-pro');
  expect(/₱149 a month/.test(plus) && !/₱599 a semester/.test(plus) && !/Pasado Pass/.test(plus) && /One payment for 30 days\. Never renews\. 7 days to change your mind\. Or ₱599 once for the whole semester\./.test(plus), 'Plus, a month: ' + plus);
  expect(/₱499 a month/.test(pro) && !/₱1,999 a semester/.test(pro) && /150 questions a day/.test(pro) && /20 Gemini pictures a day/.test(pro) && /Get Pro early/.test(pro), 'Pro, a month: ' + pro);
  const priceRow = () => page.evaluate(() => [...document.querySelectorAll('.set-plans .plan-compare tbody tr:first-child td')].map((x) => x.innerText.trim()).join('|'));
  expect(await priceRow() === '₱0|₱149 a month|₱499 a month', 'the table, a month: ' + await priceRow());
  if (process.env.SHOTS) { await page.waitForTimeout(400); await page.screenshot({ path: process.env.SHOTS + '/plans-monthly.png' }); await page.locator('.set-plans .plan-plus').scrollIntoViewIfNeeded(); await page.waitForTimeout(300); await page.screenshot({ path: process.env.SHOTS + '/plans-monthly-plus.png' }); await page.locator('.set-plans .bill-seg').scrollIntoViewIfNeeded(); }
  // Semester: the one-payment prices and the Pasado Pass
  await page.click('.set-plans [data-bill="s"]');
  plus = await text('.set-plans .plan-plus'); pro = await text('.set-plans .plan-pro');
  expect(/₱599 a semester, about ₱4 a day/.test(plus) && /Pasado Pass/.test(plus) && !/₱149 a month Renews/.test(plus), 'Plus, a semester: ' + plus);
  expect(/₱1,999 a semester, about ₱13 a day/.test(pro) && /Or ₱499 a month/.test(pro), 'Pro, a semester: ' + pro);
  expect(await page.locator('.set-plans [data-bill="s"]').getAttribute('aria-pressed') === 'true', 'Semester is shown as picked');
  expect(/Best for school/.test(await page.locator('.set-plans .plan-plus').innerText()) && !(await page.locator('.set-plans .plan-pro .plan-badge').count()), 'only Plus is Best for school');
  const T = await page.evaluate(() => {
    const t = document.querySelector('.set-plans .plan-compare'), box = document.querySelector('.set-plans');
    return t && { cols: [...t.querySelectorAll('thead th')].map((x) => x.textContent.trim()), w: t.getBoundingClientRect().width, right: t.getBoundingClientRect().right, inner: innerWidth, scroll: box.scrollWidth - box.clientWidth, price: [...t.querySelectorAll('tbody tr:first-child td')].map((x) => x.textContent) };
  });
  expect(T && T.cols.slice(1).join() === 'Free,Plus,Pro' && T.price.join('|').replace(/₱149 a month|₱499 a month/g, '') === '₱0|₱599 a semester|₱1,999 a semester', 'the table compares all three: ' + JSON.stringify(T));
  expect(T.right <= T.inner && T.scroll <= 1, 'it fits a phone, no sideways scrolling: ' + JSON.stringify(T));
  if (process.env.SHOTS) { await page.waitForTimeout(500); await page.screenshot({ path: process.env.SHOTS + '/plans-phone.png' }); await page.locator('.set-plans .plan-pro').scrollIntoViewIfNeeded(); await page.waitForTimeout(400); await page.screenshot({ path: process.env.SHOTS + '/plans-phone-pro.png' }); }
  expect(!errors.length, 'page errors: ' + errors.join('; '));
  await ctx.close();
});

test('the website’s Get the Pasado Pass early: an email field, a refused throwaway email says why, then “you’re on the early list”; the app’s Plans buttons open the same list', async (b) => {
  const { contrastIssues } = require('./ui-checks.cjs');
  await serverMode({ groq: 'ok', ai: 'ok' });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript((srv) => { window.CASSIE_SERVER = srv; }, SERVER);
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.goto(`http://localhost:${APP_PORT}/index.html#pricing`);
    const go = page.locator('#pricing [data-plan="plus"]');
    expect(await go.innerText() === 'Get Plus early', 'the button says what you get (Monthly first): ' + await go.innerText());
    await go.click();
    await page.waitForSelector('#pricing [data-early="plus"]:not([hidden]) input');
    if (process.env.SHOTS) await page.locator('#pricing .plan.feat').screenshot({ path: process.env.SHOTS + '/pricing-pass.png' });
    expect(await page.evaluate(() => document.activeElement && document.activeElement.id === 'early-plus'), 'the email field has focus');
    expect(!(await go.isVisible()), 'the button makes way for the email field (not both)');
    await page.fill('#early-plus', 'x@yopmail.com');
    await page.click('#pricing [data-early="plus"] button');
    await page.waitForFunction(() => document.querySelector('[data-early="plus"] .early-msg').textContent.length > 0);
    expect(/email/i.test(await page.locator('[data-early="plus"] .early-msg').innerText()), 'a throwaway email is refused, with why');
    const mail = `site${Date.now()}@example.com`;
    await page.fill('#early-plus', mail);
    await page.press('#early-plus', 'Enter');
    await page.waitForSelector('#pricing .early-done');
    expect((await page.locator('#pricing .early-done').innerText()).includes(mail), 'it says who Cassie will email');
    if (process.env.SHOTS) await page.locator('#pricing .plan.feat').screenshot({ path: process.env.SHOTS + '/pricing-pass-done.png' });
    await page.waitForTimeout(900); // (the cards ease in as they scroll into view)
    const { bad } = await contrastIssues(page, '#pricing .plan.feat');
    expect(!bad.length, 'the early list reads clearly: ' + bad.join(' | '));
    const g = await page.evaluate(() => ({ wide: document.documentElement.scrollWidth > innerWidth + 1, small: [...document.querySelectorAll('#pricing button, #pricing .btn, #pricing input')].filter((e) => e.offsetParent && e.getBoundingClientRect().height < 44).map((e) => e.textContent.trim() || e.id) }));
    expect(!g.wide && !g.small.length, 'nothing spills sideways and every control is 44px: ' + JSON.stringify(g));
    const list = await (await fetch(SERVER + '/admin/early', { headers: { authorization: 'Bearer test-admin-token-0123456789' } })).json();
    expect((list.list || []).some((r) => r.email === mail && r.src === 'site' && r.plan === 'plus'), 'the owner sees it, from the website');
    expect(!errors.length, 'page errors: ' + errors.join('; '));
  } finally { await ctx.close(); }
  // the app's Plans: both buttons open the early list
  const { ctx: actx, page: app } = await open(b, { state: { plan: null } });
  try {
    await app.evaluate(() => openSettings('plans'));
    await app.waitForSelector('.set-plans', { state: 'visible', timeout: 8000 });
    await app.click('.set-plans [data-early="plus"]');
    await app.waitForSelector('.plus-sheet .plus-join');
    expect(/Get the Pasado Pass first/.test(await app.locator('.plus-sheet h3').innerText()), 'the Plans button opens the early list');
  } finally { await fetch(`${SERVER}/__reset`); await actx.close(); }
});

test('buying a plan: sign in first, then PayMongo’s checkout (pesos; a US$ plan is charged its peso price, card only), the signed “paid” message gives the plan once (a forged one is refused, a wrong amount gives nothing, buying again adds the days), the return screen says until when and what was paid, a reminder before it ends, the dashboard counts it (view-only password too), and the website’s buttons buy', async (b) => {
  const crypto = require('crypto');
  const post = (p, body, headers = {}) => fetch(SERVER + p, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  // a test key (sk_test_…): the public site stays on the early list, and only a listed tester can buy
  const tmail = `tester${Date.now()}@example.com`, omail = `other${Date.now()}@example.com`;
  await serverMode({ payOn: true, paymongo: 'ok', payTesters: tmail });
  const cfgT = await (await fetch(SERVER + '/config', { headers: { origin: 'http://localhost' } })).json();
  expect(cfgT.pay === false && cfgT.test === true && cfgT.prices && cfgT.prices.php.plus.month.php === 149, 'a test key: payments stay off for everyone, with the prices ready: ' + JSON.stringify([cfgT.pay, cfgT.test]));
  const tokOf = async (email) => (await (await post('/auth/signup', { email, password: 'secret-pass-1', age: 20 })).json()).token;
  const other = await post('/pay/checkout', { plan: 'plus', bill: 'month', cur: 'php' }, { authorization: 'Bearer ' + await tokOf(omail) });
  const tester = await (await post('/pay/checkout', { plan: 'plus', bill: 'month', cur: 'php' }, { authorization: 'Bearer ' + await tokOf(tmail) })).json();
  expect(other.status === 403 && /^https:\/\/checkout\.paymongo\.com\//.test(tester.url || ''), 'with a test key, nobody but a listed tester can buy (no free plans with PayMongo’s test cards): ' + other.status);
  await serverMode({ payOn: 'live', payTesters: '' });
  const dump = async () => (await (await fetch(`${SERVER}/__dump`)).json()).tables;
  const paidEvent = (session, ref, centavos, method = 'gcash') => JSON.stringify({ data: { id: 'evt_test', attributes: { type: 'checkout_session.payment.paid', livemode: false, data: { id: session, attributes: { reference_number: ref, payments: [{ id: 'pay_test_' + ref.slice(-6), attributes: { amount: centavos, source: { type: method } } }] } } } } });
  const signed = (raw, secret = 'whsk_test_fake_paymongo') => { const t = Math.floor(Date.now() / 1000); return { 'paymongo-signature': `t=${t},te=${crypto.createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')},li=` }; };
  const { ctx, page, errors } = await open(b, { state: { plan: null } });
  try {
    await page.route('https://checkout.paymongo.com/**', (r) => r.fulfill({ contentType: 'text/html', body: '<title>PayMongo checkout</title><h1>PayMongo checkout</h1>' }));
    const cfg = await page.evaluate(async (srv) => (await fetch(srv + '/config')).json(), SERVER);
    expect(cfg.pay === true && cfg.prices.php.plus.month.php === 149 && cfg.prices.usd.plus.month.shown === 'US$7.99' && cfg.prices.usd.plus.month.php === 499 && cfg.prices.php.pro.sem.php === 1999, 'the server says payments are on, with every price (US$7.99 is charged ₱499): ' + JSON.stringify(cfg.prices && cfg.prices.usd.plus));
    // signed out: Get Plus asks to sign in first, then goes on to PayMongo by itself
    await page.waitForFunction(() => serverPay === true, null, { timeout: 5000 });
    await page.evaluate(() => plusSheet('More questions today', 'You’ve used today’s free questions.', 'limit'));
    const buy = page.locator('.plus-sheet .plus-buy[data-bill="month"]');
    const cur = await page.evaluate(() => payCur());
    expect(new RegExp(cur === 'usd' ? 'US\\$7\\.99 for 30 days \\(charged as ₱499\\)' : '₱149 for 30 days').test(await buy.innerText()) && /Pasado Pass/.test(await page.locator('.plus-sheet .plus-buy[data-bill="sem"]').innerText()), 'the sheet’s buttons buy, with the price: ' + await buy.innerText());
    await buy.click();
    await page.waitForSelector('.auth-page .auth-form', { timeout: 5000 });
    const mail = `buyer${Date.now()}@example.com`;
    await page.fill('.auth-form input[name=email]', mail); await page.fill('.auth-form input[name=age]', '19'); await page.fill('.auth-form input[name=password]', 'secret-pass-1');
    await Promise.all([page.waitForURL(/checkout\.paymongo\.com\/cs_test_/, { timeout: 15000 }), page.click('.auth-go')]);
    const mode1 = await serverMode({});
    const sent = mode1.paymongoCalls.at(-1), at = sent.body.data.attributes, item = at.line_items[0];
    expect(/^Basic /.test(sent.auth) && Buffer.from(sent.auth.slice(6), 'base64').toString() === 'sk_live_fake_paymongo:', 'PayMongo is asked with the secret key from Cloudflare (never from the page)');
    expect(item.currency === 'PHP' && item.amount === (cur === 'usd' ? 49900 : 14900) && item.quantity === 1 && /Cassie Plus, 30 days/.test(item.name) && (cur === 'usd' ? /US\$7\.99, charged as ₱499 \(PHP\)/.test(item.description) : /Never renews/.test(item.description)), 'one pass, in pesos, at the server’s price: ' + JSON.stringify(item));
    expect(JSON.stringify(at.payment_method_types) === (cur === 'usd' ? '["card"]' : '["card","gcash","paymaya"]') && /\/app\.html\?paid=cas_[a-f0-9]{24}$/.test(at.success_url) && /paid=cancel$/.test(at.cancel_url) && at.send_email_receipt === true && at.billing.email === mail, 'GCash, Maya and card (a US$ plan: card), back to Cassie after, a receipt by email: ' + JSON.stringify([at.payment_method_types, at.success_url]));
    let pay = (await dump()).payments.find((x) => x.id === at.reference_number);
    expect(pay && pay.status === 'pending' && pay.plan === 'plus' && pay.bill === 'month' && pay.live === 1 && !(await dump()).plans.some((x) => x.note && x.note.includes(pay.id)), 'a pending payment, and no plan until PayMongo says it’s paid');
    // a forged "paid" message gives nothing; PayMongo's signed one gives the plan, once
    const raw = paidEvent(pay.session, pay.id, pay.php * 100);
    expect((await post('/pay/webhook', raw, signed(raw, 'whsk_wrong_secret'))).status === 401 && (await post('/pay/webhook', raw, {})).status === 401, 'a message without PayMongo’s signature is refused');
    expect((await dump()).payments.find((x) => x.id === pay.id).status === 'pending', 'and nothing was given');
    expect((await post('/pay/webhook', raw, signed(raw))).status === 200, 'the signed message is taken, with the plain 200 PayMongo asks for');
    let t1 = await dump();
    const acct = t1.accounts.find((x) => x.email === mail), plan1 = t1.plans.find((x) => x.account === acct.id);
    expect(plan1 && plan1.plan === 'plus' && Math.abs(plan1.until - Date.now() - 30 * 864e5) < 120e3 && /paid month/.test(plan1.note) && t1.payments.find((x) => x.id === pay.id).status === 'paid' && t1.payments.find((x) => x.id === pay.id).method === 'gcash', 'Plus for 30 days, the payment marked paid (GCash): ' + JSON.stringify(plan1));
    await post('/pay/webhook', raw, signed(raw)); // (PayMongo may send it twice)
    expect((await dump()).plans.find((x) => x.account === acct.id).until === plan1.until, 'sent twice, given once');
    // back in Cassie: until when, and what was paid
    await page.goto(APP + '?paid=' + pay.id);
    await page.waitForFunction(() => /You have Cassie Plus until/.test((document.querySelector('.pay-sheet h3') || {}).textContent || ''), null, { timeout: 15000 });
    const back = await page.locator('.pay-sheet').innerText();
    expect((cur === 'usd' ? /Paid ₱499 \(US\$7\.99\)/ : /Paid ₱149\b/).test(back) && /never renews by itself/.test(back) && !/[?&]paid=/.test(page.url()), 'the return screen: until when, what was paid, never renews: ' + back);
    if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/paid-return.png' });
    await page.click('.pay-sheet .plus-ok');
    expect(await page.evaluate(() => planName()) === 'plus', 'the app knows it has Plus');
    // buying again before it ends adds the days on; a wrong amount gives nothing
    const token = await page.evaluate(() => localStorage.getItem('cassie.auth'));
    const again = await (await post('/pay/checkout', { plan: 'plus', bill: 'sem', cur: 'php' }, { authorization: 'Bearer ' + token })).json();
    expect(/^https:\/\/checkout\.paymongo\.com\//.test(again.url) && again.php === 599, 'a semester pass: ₱599');
    const p2 = (await dump()).payments.find((x) => x.id === again.id);
    const bad = paidEvent(p2.session, p2.id, 100);
    await post('/pay/webhook', bad, signed(bad));
    expect((await dump()).payments.find((x) => x.id === p2.id).status === 'mismatch' && (await dump()).plans.find((x) => x.account === acct.id).until === plan1.until, 'paid the wrong amount: no plan');
    const p3 = await (await post('/pay/checkout', { plan: 'plus', bill: 'sem', cur: 'php' }, { authorization: 'Bearer ' + token })).json();
    const r3 = (await dump()).payments.find((x) => x.id === p3.id), ok3 = paidEvent(r3.session, r3.id, 59900, 'card');
    await post('/pay/webhook', ok3, signed(ok3));
    const plan3 = (await dump()).plans.find((x) => x.account === acct.id);
    expect(Math.abs(plan3.until - plan1.until - 152 * 864e5) < 5000 && /paid sem/.test(plan3.note), 'buying again before it ends adds the semester on top: ' + JSON.stringify(plan3));
    // the page can't set its own price, and signed out it can't buy
    expect((await post('/pay/checkout', { plan: 'plus', bill: 'month', cur: 'php', php: 1 }, { authorization: 'Bearer ' + token }).then((r) => r.json())).php === 149, 'a price sent by the page is ignored');
    expect((await post('/pay/checkout', { plan: 'plus', bill: 'month' })).status === 401, 'signed out: no checkout');
    // the reminder: a few days before it ends, once a day
    await page.evaluate(() => { state.plan = { plan: 'plus', until: Date.now() + 2 * 864e5 + 3600e3, bill: 'month' }; state.planRemindedDay = ''; planReminder(); });
    const rem = await page.locator('.pay-sheet').innerText();
    expect(/Your Cassie Plus ends in 3 days|Your Cassie Plus ends in 2 days/.test(rem) && /never renews by itself/.test(rem) && /Get 30 days more/.test(rem), 'a reminder before it ends, with a way to get more: ' + rem);
    await page.click('.pay-sheet .plus-ok');
    await page.evaluate(() => planReminder());
    expect(await page.locator('.pay-sheet').count() === 0, 'once a day');
    // the dashboard: test payments counted apart; the view-only password reads it, but can't give plans
    const st = await (await fetch(`${SERVER}/stats?days=7`, { headers: { authorization: 'Bearer test-view-token-0123456789' } })).json();
    expect(st.payments && st.payments.php === 0 && st.payments.tests >= 2 && st.payments.list.some((x) => x.email === mail && x.live === 0) && st.payments.active.plus >= 1, 'the view-only password reads the payments (test ones apart): ' + JSON.stringify({ ...st.payments, list: st.payments && st.payments.list.length }));
    expect((await fetch(`${SERVER}/admin/plan?email=${encodeURIComponent(mail)}`, { headers: { authorization: 'Bearer test-view-token-0123456789' } })).status === 401, 'the view-only password can’t give or see plans');
    // Connect PayMongo (owner password only): makes the webhook to /pay/webhook once, and shows its secret that once
    const hookBy = (tok) => fetch(`${SERVER}/admin/paymongo-webhook`, { method: 'POST', headers: { authorization: 'Bearer ' + tok } });
    expect((await hookBy('test-view-token-0123456789')).status === 401, 'the view-only password can’t connect PayMongo');
    const made = await (await hookBy('test-admin-token-0123456789')).json();
    const hookCall = (await serverMode({})).paymongoCalls.filter((c) => /\/v1\/webhooks$/.test(c.url) && c.body.data).at(-1);
    expect(made.created && made.secret === 'whsk_live_made_by_test' && /\/pay\/webhook$/.test(made.url) && JSON.stringify(hookCall.body.data.attributes.events) === '["checkout_session.payment.paid"]', 'Connect PayMongo makes the webhook for paid checkouts, and shows its secret: ' + JSON.stringify(made));
    const twice = await (await hookBy('test-admin-token-0123456789')).json();
    expect(twice.exists && !twice.secret, 'pressed again: it says it is connected, and never shows a secret again');
    expect(!JSON.stringify((await dump())).includes('whsk_live_made_by_test'), 'the secret is never kept on Cassie’s server');
    expect(!errors.length, 'page errors: ' + errors.join('; '));
  } finally { await ctx.close(); }
  // the website: with payments on, Get Plus buys (in the app), and a US$ price says its pesos
  const wctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  await wctx.addInitScript((srv) => { window.CASSIE_SERVER = srv; }, SERVER);
  const w = await wctx.newPage();
  try {
    await w.goto(`http://localhost:${APP_PORT}/index.html#pricing`);
    await w.waitForFunction(() => document.querySelector('[data-plan="plus"]').textContent === 'Get Plus' || document.querySelector('[data-plan="plus"]').textContent === 'Get the Pasado Pass', null, { timeout: 5000 });
    await w.click('#pricing [data-cur="usd"]');
    expect(await w.locator('[data-php-note="plus"]').innerText() === 'Charged as ₱499 (PHP). Your bank converts it.' && /US\$7\.99/.test(await w.locator('[data-price="plus"]').innerText()), 'a US$ price, and the pesos it is charged as');
    expect(await w.locator('[data-plan="pro"]').innerText() === 'Get Pro', 'Pro buys too');
    await w.click('#pricing [data-bill="sem"]');
    await Promise.all([w.waitForURL(/app\.html\?buy=plus-sem-usd/, { timeout: 8000 }), w.click('#pricing [data-plan="plus"]')]);
  } finally { await wctx.close(); await serverMode({ payOn: false }); await fetch(`${SERVER}/__reset`); }
});

test('the Pasado Pass: the pricing page opens on Monthly (₱149), the semester pass one tap away, its price a day in ₱ and $, Never renews and 7 days to change your mind; every promise is in the terms; the app’s Plans and Plus sheet say the same; no “Most popular”', async (b) => {
  const terms = fs.readFileSync(path.join(ROOT, 'terms.html'), 'utf8').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${APP_PORT}/index.html`);
  await page.click('#pricing [data-cur="php"]');
  const plus = async () => (await page.locator('#pricing .plan', { has: page.locator('h3:text-is("Plus")') }).innerText()).replace(/\s+/g, ' ');
  expect(await page.locator('#pricing [data-bill="month"]').evaluate((e) => e.classList.contains('on')), 'the Billing switch opens on Monthly');
  let p = await plus();
  expect(/₱149/.test(p) && /One payment for 30 days\. Never renews/.test(p) && /no subscription/.test(p) && !(await page.locator('#pricing [data-pass]').isVisible()) && await page.locator('#pricing [data-plan="plus"]').innerText() === 'Get Plus early', 'Monthly first: ₱149 for 30 days, never renews, Get Plus early (no Pasado Pass label): ' + p);
  expect(await page.locator('#pricing [data-anchor]').innerText() === '₱149 a month: about ₱5 a day, less than one hour with a tutor.', 'the comparison line follows Monthly: ' + await page.locator('#pricing [data-anchor]').innerText());
  expect(/From ₱149 a month, or one payment covers your whole semester/.test(await page.locator('#pricing .sub').innerText()), 'the sub says both');
  await page.click('#pricing [data-bill="sem"]');
  p = await plus();
  expect(await page.locator('#pricing [data-plan="plus"]').innerText() === 'Get the Pasado Pass early', 'Semester: the button is the Pasado Pass');
  expect(/Pasado Pass/.test(p) && /₱599/.test(p) && /about ₱4 a day/.test(p) && /One payment for 5 months\. Never renews\. 7 days to change your mind\./.test(p), 'the Plus card is the Pasado Pass: ' + p);
  expect(/Best for school/i.test(p) && /Your exam, planned day by day/.test(p) && /up to 5 exam plans/i.test(p) && /Plus these bonuses/i.test(p) && /All the 3D, any time/.test(p), 'the result first, then the named bonuses: ' + p);
  expect(/Everything in Free, including the Finals Reviewer Kit/.test(await page.locator('#pricing .plan.feat details.all').textContent()), 'what Free has too sits under See everything');
  expect(await page.locator('#pricing [data-anchor]').innerText() === '₱599 for the whole semester: about ₱4 a day, less than one hour with a tutor.', 'the comparison line: ' + await page.locator('#pricing [data-anchor]').innerText());
  expect(/Pasado ka dito\./.test(await page.locator('#pricing h2').innerText()) && /the Pasado Pass gets you ready/.test(await page.locator('#pricing .sub').innerText()) && /one payment covers your whole semester/i.test(await page.locator('#pricing .sub').innerText()), 'the headline and sub lead with the result');
  await page.click('#pricing [data-cur="usd"]');
  p = await plus();
  expect(/US\$31\.99/.test(p) && /about US\$0\.21 a day/.test(p) && await page.locator('#pricing [data-anchor]').innerText() === 'US$31.99 for the whole semester: about US$0.21 a day.', 'Worldwide: the US$ price a day (US$, so nobody reads it as their own dollars): ' + p);
  await page.click('#pricing [data-cur="php"]');
  await page.click('#pricing [data-bill="month"]');
  p = await plus();
  expect(!(await page.locator('#pricing [data-pass]').isVisible()) && /₱149/.test(p) && /One payment for 30 days\. Never renews/.test(p), 'Monthly: no Pasado Pass label, and it says it renews until you cancel: ' + p);
  // every promise on the page is in the terms
  const faq = (await page.locator('#faq').textContent()).replace(/\s+/g, ' ');
  expect(/What is the Pasado Pass\?/.test(faq) && /5 months for one payment of ₱599/.test(faq), 'the FAQ explains the Pasado Pass');
  const promises = [
    [/Never renews/i, /Semester pass \(the Pasado Pass\) is one payment and never renews/],
    [/One payment for 5 months/, /lasts 5 months/],
    [/7 days to change your mind/, /7 days to change your mind\. If you're not happy with the first payment for any plan, email askcassie\.study@gmail\.com within 7 days of paying and you get all of it back\. No questions asked\./],
    [/One payment for 30 days/, /Monthly: one payment for 30 days\.<\/strong> It never renews|Monthly: one payment for 30 days\. It never renews/],
    [/does the monthly plan renew by itself\?/i, /never renew by themselves/],
    [/about a week before it does/, /about a week before it ends/],
    [/askcassie\.study@gmail\.com within 7 days of paying and you get all of it back, no questions asked/, /askcassie\.study@gmail\.com within 7 days of paying and you get all of it back\. No questions asked/],
  ];
  const monthly = await page.locator('#pricing').innerText();
  await page.click('#pricing [data-bill="sem"]');
  const onPage = monthly + ' ' + (await page.locator('#pricing').innerText()) + ' ' + faq;
  for (const [said, inTerms] of promises) expect(said.test(onPage) && inTerms.test(terms), `the page says ${said} and the terms say ${inTerms}`);
  expect(/Founding price\. If you buy your next pass before the one you have ends, you keep the price you started with/.test(terms), 'the founding price is in the terms');
  // nothing renews by itself: no page, no plan and no term says it does
  const said = [fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), fs.readFileSync(path.join(ROOT, 'app.html'), 'utf8'), fs.readFileSync(path.join(ROOT, 'landing/landing.js'), 'utf8'), terms, onPage].join(' ');
  expect(!/renews (?:each|every|automatically)|until you cancel|cancel any ?time|billed (?:monthly|yearly)|before (?:each|every) renewal/i.test(said), 'no plan renews by itself, and nothing says one does: ' + (said.match(/.{40}(?:renews (?:each|every|automatically)|until you cancel|cancel any ?time|billed (?:monthly|yearly)|before (?:each|every) renewal).{20}/i) || [''])[0]);
  expect(!/[—–]/.test(onPage), 'no dashes on the pricing page');
  await ctx.close();
  // the phone sizes: nothing spills sideways, every pricing button is 44px
  for (const vp of [{ width: 390, height: 844 }, { width: 360, height: 740 }, { width: 1280, height: 800 }]) {
    const c = await b.newContext({ viewport: vp, hasTouch: vp.width < 500 });
    const pg = await c.newPage();
    await pg.goto(`http://localhost:${APP_PORT}/index.html#pricing`);
    await pg.waitForTimeout(600);
    const g = await pg.evaluate(() => ({ wide: document.documentElement.scrollWidth > innerWidth + 1, small: [...document.querySelectorAll('#pricing button, #pricing .btn')].filter((e) => e.offsetParent && e.getBoundingClientRect().height < 44).map((e) => e.textContent.trim() + ' ' + Math.round(e.getBoundingClientRect().height)) }));
    expect(!g.wide && !g.small.length, `${vp.width}x${vp.height}: ` + JSON.stringify(g));
    await c.close();
  }
  // the app says the same: Settings, Plans and the Plus sheet
  const { ctx: actx, page: app, errors } = await open(b, { server: false, state: { plan: null } });
  await app.evaluate(() => openSettings('plans'));
  await app.waitForSelector('.set-plans', { state: 'visible', timeout: 8000 });
  await app.click('.set-plans [data-bill="s"]'); // (a month shows first; the pass is under Semester)
  const plans = (await app.locator('.set-plans').innerText()).replace(/\s+/g, ' ');
  expect(/Best for school/.test(plans) && /Pasado Pass/.test(plans) && /₱599 a semester, about ₱4 a day/.test(plans) && /One payment for 5 months\. Never renews\. 7 days to change your mind\./.test(plans) && !/Most popular/.test(plans), 'the app’s Plans: ' + plans);
  await app.evaluate(() => { closeSettings(); plusSheet('The 3D human body'); });
  const foot = await app.locator('.plus-sheet .plus-foot').innerText();
  expect(/Pasado Pass, one payment of ₱599 for your whole semester\. It never renews, and you have 7 days to change your mind\./.test(foot), 'the Plus sheet: ' + foot);
  expect(await app.locator('.plus-sheet .plus-see').getAttribute('href') === 'index.html#pricing', 'its link still goes to the plans');
  const [go, ok] = [await app.locator('.plus-sheet .plus-see').boundingBox(), await app.locator('.plus-sheet .plus-ok').boundingBox()];
  expect(ok.height >= 44 && Math.abs(ok.height - go.height) < 1, 'Not now is the same size: ' + JSON.stringify([go, ok]));
  expect(!errors.length, 'page errors: ' + errors.join('; '));
  await actx.close();
  // "Most popular" is gone everywhere
  for (const f of ['index.html', 'app.html', 'app.js', 'landing/landing.js']) expect(!/Most popular/i.test(fs.readFileSync(path.join(ROOT, f), 'utf8')), `no “Most popular” in ${f}`);
});

test('the FAQ tells the truth: what an account syncs is what the app syncs, chats stay on the device, and paying lists only what Lemon Squeezy offers (no GCash or Maya yet)', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const answer = (q) => { const m = html.match(new RegExp(`<summary>${q}</summary><p>([\\s\\S]*?)</p>`)); return m ? m[1].replace(/<[^>]+>/g, '') : ''; };
  const notes = answer('Where do my notes and chats go\\?'), pay = answer('How do I pay from the Philippines\\?');
  const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const synced = app.match(/function accountData\(\) \{\s*return \{([^\n]+)\};/)[1].match(/(\w+):/g).map((k) => k.slice(0, -1));
  const SAYS = { profile: 'profile', mistakes: 'saved quiz mistakes', cards: 'flashcards', exams: 'exam plans', progress: 'weekly study counts', audience: 'settings', level: 'settings', accent: 'settings', citationStyle: 'settings', textSize: 'settings', easyRead: 'settings', analytics: 'settings', tour: 'settings', answerStyle: 'settings', helpWith: 'settings', streak: 'study streak', labs: 'Learn progress' };
  for (const k of synced) expect(SAYS[k] && notes.includes(SAYS[k]), `the FAQ names what syncs: ${k} (“${SAYS[k]}”) in: ` + notes);
  expect(!synced.includes('chats') && /Your chats stay on your device/.test(notes), 'chats are not synced, and the FAQ says so');
  expect(/Lemon Squeezy/.test(pay) && /debit or credit card, Google Pay or Apple Pay/.test(pay) && /GCash and Maya aren’t offered yet/.test(pay) && !/pay in pesos with local options/.test(pay), 'paying lists only what is offered: ' + pay);
  expect(!/[—–]/.test(notes + pay), 'no dashes');
});

test('the Grand Slam offer doc has its 8 sections, names a file for what Cassie gives today, and has no dashes', async () => {
  const doc = fs.readFileSync(path.join(ROOT, 'docs/grand-slam-offer.md'), 'utf8');
  const heads = ['What Cassie gives today', 'Dream outcomes by audience', 'Value equation scores', 'Obstacles to solutions', 'The offer', 'Copy ready to paste', 'Changes ranked by impact', 'What not to do, and why'];
  const found = [...doc.matchAll(/^## (\d)\. (.+)$/gm)].map((m) => `${m[1]}. ${m[2].trim()}`);
  expect(found.join('|') === heads.map((h, i) => `${i + 1}. ${h}`).join('|'), 'the 8 sections, in order: ' + found.join(' | '));
  const today = doc.split(/^## 2\./m)[0].split('\n').filter((l) => /^\| (Free|Plus|Pro) \|/.test(l));
  expect(today.length >= 10 && today.every((l) => /`[\w./-]+(\.js|\.html)`|`[\w-]+\/`/.test(l)), 'every feature row names its file: ' + today.filter((l) => !/`[\w./-]+(\.js|\.html)`|`[\w-]+\/`/.test(l)).join(' / '));
  expect(!/[—–]/.test(doc), 'no em or en dashes in the doc');
});

test('privacy.html explains every table Cassie’s server keeps (a new table fails until the page says what it holds), names the reminders, the early list and the plan, has a Chrome extension section with the Limited Use promise, and the store guide links the privacy page, not the help page', async () => {
  const src = fs.readFileSync(path.join(ROOT, 'server/worker.src.js'), 'utf8');
  const tables = [...src.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]);
  const page = fs.readFileSync(path.join(ROOT, 'privacy.html'), 'utf8').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const SAID = { // [the table, what privacy.html must say about it]
    users: /Anonymous usage counts/, events: /Anonymous usage counts/, words: /topic words/, feedback: /Problem reports/, quota: /Counts for fair limits/,
    chats: /Counts for fair limits/, accounts: /Your account/, sessions: /your sign ins/, health: null /* (Cassie's own checks: no one's data) */,
    rooms: /Study rooms/, room_members: /Study rooms/, room_ops: /Study rooms/, room_here: /where your pointer is/, plans: /your plan \(Free, Plus or Pro\) and when it ends/,
    scores: /Daily puzzles/, identities: /Google or Apple, we keep which one/, push_subs: /Study reminders/, early: /The early list/, payments: /Payments\s*, if you buy a plan/,
  };
  const unknown = tables.filter((t) => !(t in SAID));
  expect(!unknown.length, 'the server keeps a table privacy.html doesn’t explain: ' + unknown.join(', ') + '. Say on the page what it holds, then add it here.');
  const missing = tables.filter((t) => SAID[t] && !SAID[t].test(page));
  expect(!missing.length, 'privacy.html doesn’t say what these hold: ' + missing.join(', '));
  expect(/Turning reminders off deletes it from our server/.test(page) && /notification service/.test(page), 'the reminders: what is kept, who delivers them, and how to delete');
  expect(/The Chrome extension/.test(page) && /Limited Use/.test(page) && /does not read pages on its own/.test(page) && /Ask about this file/.test(page), 'the extension: what it reads, when, and the Limited Use promise');
  expect(/Anthropic \(Claude\)\s*: writes Cassie’s smarter answers: a few a day on Free/.test(page.replace(/'/g, '’')), 'Claude answers on Free too (Free gets a few smarter answers a day)');
  const stores = fs.readFileSync(path.join(ROOT, 'STORES.md'), 'utf8');
  expect(/Privacy policy URL:\*\* `https:\/\/askcassie\.study\/privacy\.html`/.test(stores), 'the store guide says the privacy URL is privacy.html');
  expect(!/[—–]/.test(page), 'no dashes');
});

test('privacy.html names every outside service the code calls (a new one fails until the page says what it gets)', async () => {
  // every web address in Cassie's own code (not the bundled libraries): a service it calls, or one of these
  const NOT_A_SERVICE = {
    'schemas.openxmlformats.org': 'names inside Word and PowerPoint files', 'www.w3.org': 'SVG and XML names',
    'askcassie.study': 'Cassie’s own site', 'www.askcassie.study': 'Cassie’s own site', 'askcassie.pages.dev': 'Cassie’s own site', 'usernamehaze.github.io': 'Cassie’s own site', 'speak.cassie': 'a cache key, not a site',
    'scholar.google.com': 'a link the student taps', 'doi.org': 'citation links',
    'chromewebstore.google.com': 'a link the student taps (Add to Chrome: the extension in the Chrome Web Store)',
    'commons.wikimedia.org': 'a link the student taps (where a museum picture comes from; the pictures are kept in the app)',
    'epa.culturalcenter.gov.ph': 'a museum picture’s credit link', '21am.culturalcenter.gov.ph': 'a museum picture’s credit link', 'salcedoauctions.com': 'a museum picture’s credit link', 'www.artandmarket.net': 'a museum picture’s credit link',
    'ncmh.gov.ph': 'where care.js’s crisis numbers were checked (a note in the code)',
  };
  const SERVICES = [ // [which addresses, the name privacy.html must use]
    [/^api\.groq\.com$/, 'Groq'], [/^generativelanguage\.googleapis\.com$/, 'Google Gemini'], [/^api\.anthropic\.com$/, 'Anthropic'],
    [/^api\.elevenlabs\.io$/, 'ElevenLabs'], [/^image\.pollinations\.ai$/, 'Pollinations'], [/^api\.openalex\.org$/, 'OpenAlex'],
    [/\.wikipedia\.org$/, 'Wikipedia'], [/^api\.worldbank\.org$/, 'World Bank'], [/^huggingface\.co$/, 'Hugging Face'],
    [/^(accounts|www)\.google(apis)?\.com$|^docs\.google\.com$/, 'Google'], [/^appleid\.apple\.com$/, 'Apple'], [/^api\.paymongo\.com$/, 'PayMongo'],
    [/\.workers\.dev$/, 'Cloudflare'], // Cassie's own server runs on Cloudflare
  ];
  const libs = /three\.module|GLTFLoader|OrbitControls|BufferGeometryUtils|RoomEnvironment|RoundedBoxGeometry|meshopt/;
  const files = [...fs.readdirSync(ROOT).filter((f) => f.endsWith('.js')),
    ...['labs', 'explore', 'extension'].flatMap((d) => fs.readdirSync(path.join(ROOT, d)).filter((f) => f.endsWith('.js')).map((f) => d + '/' + f)),
    'server/worker.src.js'].filter((f) => !libs.test(f));
  const code = files.map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  const hosts = [...new Set([...code.matchAll(/https?:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)].map((m) => m[1].toLowerCase()))];
  const needed = new Set(), unknown = [];
  for (const h of hosts) {
    if (NOT_A_SERVICE[h]) continue;
    const s = SERVICES.find(([re]) => re.test(h));
    if (s) needed.add(s[1]); else unknown.push(h);
  }
  // services reached without a web address in our code
  if (/env\.AI\.run\(/.test(code)) needed.add('Cloudflare'); // Workers AI
  if (/voice-worker/.test(fs.readFileSync(path.join(ROOT, 'voice.js'), 'utf8'))) needed.add('Hugging Face'); // (only if the on-device voice model were used again)
  if (/SpeechRecognition/.test(code)) { needed.add('Google'); needed.add('Apple'); } // the browser's own speech-to-text
  expect(!unknown.length, 'Cassie calls a service privacy.html doesn’t know about: ' + unknown.join(', ') + '. Name it on the page (what it gets and why) and add it to this test.');
  const page = fs.readFileSync(path.join(ROOT, 'privacy.html'), 'utf8').replace(/<[^>]+>/g, ' ');
  const missing = [...needed].filter((n) => !page.includes(n));
  expect(!missing.length, 'privacy.html doesn’t name: ' + missing.join(', '));
  expect(needed.size >= 11, 'the scan found the services (sanity): ' + [...needed].join(', '));
  // and it says the rest of what it promises, in plain words with no dashes
  expect(/uses AI/.test(page) && /not kept/.test(page) && /Delete account/.test(page) && !/[–—]/.test(page), 'privacy.html says Cassie uses AI, that uploads are not kept, how to delete, with no dashes');
});

test('what the server keeps for a while goes when its time is up: rooms after a day, daily limit counts (IP addresses) after their day, a deleted account’s plan with it', async (b) => {
  const { ctx, page } = await open(b, { state: { groqKey: '' } });
  const call = (p, body, token) => page.evaluate(async ([srv, p, body, token]) => { const r = await fetch(srv + p, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) }); return r.json().catch(() => ({})); }, [SERVER, p, body, token]);
  const dump = async () => (await (await fetch(SERVER + '/__dump')).json()).tables;
  // a study room with a drawing in it, and a question (it counts toward today's limits, by IP too)
  const room = await call('/room/create', { uid: 'tidy-test-ana', name: 'Ana' });
  expect(/^[A-Z0-9]{6}$/.test(room.code || ''), 'a room: ' + JSON.stringify(room));
  await call('/room/ops', { uid: 'tidy-test-ana', code: room.code, ops: [{ t: 'add', s: { tool: 'pen', pts: [[1, 2], [3, 4]] } }] });
  await ask(page, 'what is osmosis');
  let t = await dump();
  expect(t.rooms.some((r) => r.code === room.code) && t.room_ops.length && t.quota.some((r) => /^i:/.test(r.k)), 'the room and today’s counts are there');
  // a day later, with nobody making a new room: the scheduled tidy-up takes them away
  await fetch(SERVER + '/__age'); await fetch(SERVER + '/__cron');
  t = await dump();
  expect(!t.rooms.some((r) => r.code === room.code) && !t.room_ops.some((r) => r.code === room.code) && !t.room_members.some((r) => r.code === room.code), 'a day-old room and everything in it is gone');
  expect(!t.quota.some((r) => r.day < '2026' || /^2000/.test(r.day)), 'yesterday’s limit counts (with IP addresses) are gone: ' + JSON.stringify(t.quota.slice(0, 3)));
  expect(t.quota.some((r) => r.k === 'SP:month'), 'this month’s allowance stays until the month ends');
  // Delete my account: the account, its sign ins and its plan
  const email = `tidy${Date.now()}@example.com`;
  const acc = await call('/auth/signup', { email, password: 'secret-pass-1', age: 20 });
  expect(acc.token, 'signed up: ' + JSON.stringify(acc));
  await fetch(SERVER + '/admin/plan', { method: 'POST', headers: { authorization: 'Bearer test-admin-token-0123456789', 'content-type': 'application/json' }, body: JSON.stringify({ email, plan: 'plus', days: 30 }) });
  t = await dump();
  const id = (t.accounts.find((r) => r.email === email) || {}).id;
  expect(id && t.plans.some((r) => r.account === id), 'the account has a plan');
  const del = await call('/auth/delete', {}, acc.token);
  expect(del.deleted, 'deleted: ' + JSON.stringify(del));
  t = await dump();
  expect(!t.accounts.some((r) => r.id === id) && !t.plans.some((r) => r.account === id) && !t.sessions.some((r) => r.account === id) && !t.identities.some((r) => r.account === id), 'nothing of the account is left, its plan included');
  await ctx.close();
});

// a student at risk: the messages Cassie must answer with care, and study questions she must not
const CARE_AT_RISK = [
  'I want to kill myself',
  'i don’t want to live anymore, nobody would even notice',
  'I’ve been cutting myself again and I can’t stop',
  'gusto ko nang mamatay', // Tagalog
  'ayoko na talaga, magpapakamatay na lang ako', // Tagalog
  'pagod na ako sa lahat, I just want to end my life na', // Taglish
];
const CARE_ACADEMIC = [
  'The character kills himself at the end of the novel. What does it symbolize?',
  'Explain cell suicide (apoptosis) in simple terms.',
  'Why did Romeo kill himself in Romeo and Juliet?',
  'Bakit nagpakamatay ang tauhan sa nobela?',
  'What is the suicide squeeze in baseball?',
  'Summarize Durkheim’s study of suicide rates for my sociology report.',
];
// the verified lines (care.js: NCMH's own Contact Us page) as they must show
const CARE_NUMBERS = ['1553', '1800 1888 1553', '0919 057 1553', '0917 899 8727', '0966 351 4518'];
const careShows = (text) => /NCMH Crisis Hotline/.test(text) && CARE_NUMBERS.every((n) => text.includes(n));

test('care first in the chat: 6 at-risk messages (English, Tagalog, Taglish) get care and the verified crisis lines, 6 study questions get a normal answer', async (b) => {
  const { ctx, page, errors, groqCalls } = await open(b, { state: { groqKey: 'gsk_test' }, fakeGroq: () => ({ text: 'Here is a normal study answer.' }) });
  const cares = async () => ((await serverStats()).chats || []).reduce((n, r) => n + (r.src === 'care' ? r.n : 0), 0);
  const before = await cares();
  for (const m of CARE_AT_RISK) {
    const asked = groqCalls.length;
    const a = await ask(page, m);
    const t = await a.innerText();
    expect(await a.evaluate((e) => e.classList.contains('bubble-care')), `care for: ${m}`);
    expect(careShows(t), `the verified numbers for: ${m}: ${t.slice(0, 200)}`);
    expect(await a.locator('a.care-num[href^="tel:"]').count() === CARE_NUMBERS.length, 'every number is a button to call');
    const fil = /mamatay|magpapakamatay|pagod na ako/.test(m);
    expect(fil ? /Ligtas ka ba ngayon\?/.test(t) && /nakatatandang pinagkakatiwalaan/.test(t) : /Are you safe right now\?/.test(t) && /adult you trust/.test(t), `asks if they’re safe, and to tell a trusted adult (${fil ? 'Filipino' : 'English'}): ${m}`);
    expect(!/[–—]/.test(t), 'no dashes');
    expect(groqCalls.length === asked, 'no AI was asked first: ' + m);
  }
  // Cassie keeps listening: the chat goes on as normal
  expect(await page.locator('#prompt-input').isEnabled(), 'the chat stays open');
  for (const m of CARE_ACADEMIC) {
    const asked = groqCalls.length;
    const a = await ask(page, m);
    const t = await a.innerText();
    expect(!(await a.evaluate((e) => e.classList.contains('bubble-care'))) && !/1553|NCMH/.test(t), 'no care for a study question: ' + m);
    expect(groqCalls.length === asked + 1 && /normal study answer/.test(t), 'the AI answers it: ' + m);
  }
  expect(await page.locator('.bubble-care').count() === CARE_AT_RISK.length, 'care shows for exactly the at-risk messages');
  // the AI was told how to judge it too, and never to write a number itself
  expect(/\[\[CARE\]\]/.test(groqCalls.at(-1).messages[0].content) && /Never write any phone number/.test(groqCalls.at(-1).messages[0].content), 'the system prompt has the care rule');
  // the dashboard counts it, with nothing else: no words, no id
  await page.waitForTimeout(500);
  expect(await cares() === before + CARE_AT_RISK.length, 'the dashboard counts each time');
  const dump = JSON.stringify((await (await fetch(SERVER + '/__dump')).json()).tables);
  expect(!/kill myself|mamatay|magpapakamatay|cutting myself|end my life/i.test(dump), 'none of the words reach the server');
  // a saved chat shows the care card again when it's opened
  await page.reload();
  await page.waitForSelector('.bubble-care', { timeout: 10000 });
  expect(careShows(await page.locator('.bubble-care').last().innerText()), 'the care card comes back with the chat');
  expect(errors.length === 0, 'page errors: ' + errors.join('; '));
  await ctx.close();
});

test('care everywhere: Talk with Cassie says it gently with the lines on screen, Labs Ask Cassie, the AI’s own judgement, Cassie’s server and the Shortcut', async (b) => {
  const SUBTLE = 'everything feels pointless and I just want it all to stop forever';
  const fake = (body) => {
    const last = JSON.stringify(body.messages.at(-1));
    return { text: /want it all to stop/.test(last) ? '[[CARE]] That sounds really heavy, and I’m glad you told me. You matter. Are you safe right now?' : 'A normal answer about the lab.' };
  };
  const { ctx, page, errors } = await open(b, { state: { groqKey: 'gsk_test', hearing: 'fast' }, fakeGroq: fake });
  await ctx.addInitScript(FAKE_VOICE, {});
  await page.reload();
  // the AI's own judgement in the chat: its warm words, then the verified lines (never its own number)
  const a = await ask(page, SUBTLE);
  const t = await a.innerText();
  expect(await a.evaluate((e) => e.classList.contains('bubble-care')) && /That sounds really heavy/.test(t) && careShows(t) && !/\[\[CARE\]\]/.test(t), 'the AI noticed, and the lines show under its words: ' + t.slice(0, 160));
  // Talk with Cassie: said gently out loud, the numbers on screen
  await page.click('#voice-btn');
  await page.waitForFunction(() => document.querySelector('.vc') && document.querySelector('.vc').dataset.phase === 'listening', null, { timeout: 5000 });
  await page.evaluate(() => window.__say('ayoko na, gusto ko nang mamatay'));
  await page.waitForFunction(() => window.__shown.some((t) => /Ligtas ka ba ngayon/.test(t)), null, { timeout: 15000 });
  const said = await page.evaluate(() => window.__shown.find((t) => /Ligtas ka ba ngayon/.test(t)));
  expect(!/\d{3}/.test(said) && /screen/.test(said), 'the numbers aren’t read out, she points to the screen: ' + said);
  expect(careShows(await page.locator('.vc-care').innerText()) && await page.locator('.vc-care').isVisible(), 'the lines are on the voice screen');
  await page.waitForFunction(() => document.querySelector('.vc').dataset.phase === 'listening', null, { timeout: 15000 });
  await page.click('.vc-x');
  // Labs: Ask Cassie in a lab
  await page.evaluate(() => openLabs('projectile'));
  await page.waitForSelector('.lab-view:not([hidden]) .lab-ask', { timeout: 20000 });
  await page.click('.lab-ask');
  await page.waitForSelector('.lab-helper:not([hidden]) .hp-ask input', { timeout: 10000 });
  await page.fill('.lab-helper .hp-ask input', 'I want to hurt myself');
  await page.press('.lab-helper .hp-ask input', 'Enter');
  await page.waitForSelector('.lab-helper .hp-care', { timeout: 5000 });
  expect(careShows(await page.locator('.lab-helper .hp-care').innerText()), 'care in the lab, with the lines');
  await page.fill('.lab-helper .hp-ask input', 'Why does the ball curve down?');
  await page.press('.lab-helper .hp-ask input', 'Enter');
  await seen(page, '.lab-helper .hp-a', 'A normal answer about the lab', 15000);
  expect(await page.locator('.lab-helper .hp-care').count() === 1, 'a lab question is just answered (Cassie keeps listening)');
  // Cassie's server (any app, the extension with no key): a question the student typed, before any limit or AI
  const viaServer = (content, q = 1) => page.evaluate(async ([srv, content, q]) => { const r = await fetch(srv + '/chat', { method: 'POST', body: JSON.stringify({ uid: 'care-test-1234', q, messages: [{ role: 'user', content }] }) }); return { src: r.headers.get('x-cassie-source'), text: (await r.json()).choices?.[0]?.message?.content || '' }; }, [SERVER, content, q]);
  let r = await viaServer('papatayin ko na lang ang sarili ko');
  expect(r.src === 'care' && careShows(r.text) && /Ligtas ka ba ngayon/.test(r.text), 'the server answers with care: ' + JSON.stringify(r).slice(0, 200));
  r = await viaServer('Explain cell suicide (apoptosis) in simple terms.');
  expect(r.src !== 'care' && !/1553/.test(r.text), 'and answers a study question normally');
  r = await viaServer('[I attached the file "novel.pdf": a PDF.] Summarize chapter 3\n\n(Excerpt from the start of the file:)\nI want to kill myself, said the old man.');
  expect(r.src !== 'care', 'a file’s own words never set it off');
  // the iPhone Shortcut
  const shortcut = await (await fetch(SERVER + '/ask?text=' + encodeURIComponent('I want to end my life'))).text();
  expect(careShows(shortcut) && /Are you safe right now/.test(shortcut), 'the Shortcut answers with care: ' + shortcut.slice(0, 120));
  expect(errors.length === 0, 'page errors: ' + errors.join('; '));
  await ctx.close();
});

test('care in the Chrome extension: a typed question gets care and the lines before any AI, the AI’s own judgement adds them, and its copy of care.js is the app’s', async () => {
  expect(fs.readFileSync(path.join(ROOT, 'extension/care.js'), 'utf8') === fs.readFileSync(path.join(ROOT, 'care.js'), 'utf8'), 'extension/care.js differs from care.js: copy it over');
  const ext = path.join(ROOT, 'extension');
  const profile = fs.mkdtempSync(path.join(require('os').tmpdir(), 'cassie-ext-'));
  const ctx = await chromium.launchPersistentContext(profile, {
    headless: true, ...(fs.existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : { channel: 'chromium' }),
    args: ['--headless=new', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  try {
    await ctx.route(/api\.groq\.com|workers\.dev|fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
    let sw = null;
    for (let i = 0; i < 80 && !sw; i++) {
      for (const w of ctx.serviceWorkers()) if (/\/background\.js$/.test(w.url()) && await w.evaluate(() => typeof careOf === 'function').catch(() => false)) { sw = w; break; }
      if (!sw) await new Promise((r) => setTimeout(r, 250));
    }
    expect(sw, 'the Cassie extension did not start');
    // what goes to Cassie's server for the count (the worker's own requests, recorded where they're made)
    await sw.evaluate(() => { self.__care = []; const real = self.fetch; self.fetch = (u, o) => (/\/care$/.test(String(u)) ? (self.__care.push({ body: (o && o.body) || '', url: String(u) }), Promise.resolve(new Response(null, { status: 204 }))) : real(u, o)); });
    // the AI's own judgement: its words, then the verified lines; and the rule is in its system prompt
    const flagged = await sw.evaluate(() => careOf('[[CARE]] That sounds so hard. You matter. Ligtas ka ba ngayon?', { typed: 'pagod na ako sa lahat ng ito' }));
    expect(careShows(flagged) && /That sounds so hard/.test(flagged) && !/\[\[CARE\]\]/.test(flagged), 'the AI’s flag adds the lines: ' + flagged.slice(0, 120));
    expect(await sw.evaluate(() => SYSTEM_PROMPT.includes(CassieCare.MARK) && /Never write any phone number/.test(SYSTEM_PROMPT)), 'the extension’s system prompt has the care rule');
    expect(await sw.evaluate(() => careOf('Photosynthesis makes glucose.', { typed: 'what is photosynthesis' })) === 'Photosynthesis makes glucose.', 'a normal answer is left alone');
    // the popup: a typed question gets care at once, with no AI and nothing but a count sent
    const id = new URL(sw.url()).host;
    const page = await ctx.newPage();
    await page.goto(`chrome-extension://${id}/popup.html`);
    await page.fill('#page-q', 'gusto ko nang mamatay');
    await page.click('#page-ask');
    await page.waitForFunction(() => /1553/.test(document.getElementById('page-answer').textContent), null, { timeout: 5000 });
    const t = await page.locator('#page-answer').innerText();
    expect(careShows(t) && /Ligtas ka ba ngayon/.test(t), 'care in the popup: ' + t.slice(0, 120));
    await page.waitForTimeout(500);
    const counted = await sw.evaluate(() => self.__care);
    expect(counted.length === 2 && counted.every((c) => c.body === '' && /\/care$/.test(c.url)), 'a count each time (the AI’s flag and the popup), with nothing in it: ' + JSON.stringify(counted));
  } finally { await ctx.close(); fs.rmSync(profile, { recursive: true, force: true }); }
});

test('Teach me and Ask Cassie in the extension: she speaks, points at the right part and draws on the page; voice off never speaks and Next moves on; a canvas page is taught from a picture; a snip is taught inside the snip; a page she can’t draw on is taught in the panel with the reason; Escape leaves no trace; Ask answers in the panel and points', async () => {
  for (const f of ['errors.js', 'sketch.js']) expect(fs.readFileSync(path.join(ROOT, 'extension', f), 'utf8') === fs.readFileSync(path.join(ROOT, f), 'utf8'), `extension/${f} differs from ${f}: copy it over`);
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension/manifest.json'), 'utf8'));
  expect(manifest.content_scripts[0].js.join() === 'sketch.js,board.js,care.js,mic.js,content.js,errors.js,teach.js', 'teach.js runs after the board on every page: ' + manifest.content_scripts[0].js.join());
  expect(manifest.permissions.slice().sort().join() === 'activeTab,contextMenus,scripting,sidePanel,storage', 'no new permissions: ' + manifest.permissions.join());
  const ext = path.join(ROOT, 'extension');
  const profile = fs.mkdtempSync(path.join(require('os').tmpdir(), 'cassie-ext-'));
  const ctx = await chromium.launchPersistentContext(profile, {
    headless: true, viewport: { width: 1200, height: 800 }, ...(fs.existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : { channel: 'chromium' }),
    args: ['--headless=new', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--autoplay-policy=no-user-gesture-required'],
  });
  try {
    await ctx.route(/api\.groq\.com|workers\.dev|fonts\.(googleapis|gstatic)\.com|askcassie\.pages\.dev/, (route) => route.abort());
    let sw = null;
    for (let i = 0; i < 80 && !sw; i++) {
      for (const w of ctx.serviceWorkers()) if (/\/background\.js$/.test(w.url()) && await w.evaluate(() => typeof readPicture === 'function').catch(() => false)) { sw = w; break; }
      if (!sw) await new Promise((r) => setTimeout(r, 250));
    }
    expect(sw, 'the Cassie extension did not start');
    // the AI, faked: it answers from what it was given (the numbered parts, a snip, a question), with some bad steps and shapes mixed in
    await sw.evaluate(() => {
      self.__asked = [];
      self.readPicture = async (keys, msg) => {
        const p = String(msg.prompt || '');
        self.__asked.push({ prompt: p, image: String(msg.image || '').slice(0, 22), log: msg.log || null });
        const num = (what) => { const m = p.match(new RegExp('^(\\d+)\\. ' + what, 'm')); return m ? +m[1] : 0; };
        if (/they snipped it/.test(p)) return JSON.stringify({ steps: [{ say: 'Look at this part of your snip.', point: { x: 0.5, y: 0.5 }, draw: [{ shape: 'circle', x: 0.5, y: 0.5, r: 0.2 }, { shape: 'arrow', from: [0.1, 0.9], to: [0.45, 0.55] }] }] });
        const h = num('heading "Photosynthesis"'), t = num('table heading "Stage"');
        if (/The student asks/.test(p)) return JSON.stringify({ answer: 'Plants make their own food from light.', steps: [{ say: 'The heading names the topic.', point: h }] });
        if (h) return '```json\n' + JSON.stringify({ steps: [
          { say: 'This page is about photosynthesis.', point: h, draw: [{ shape: 'circle', el: h }, { shape: 'arrow', to_el: t }, { shape: 'explode', el: h }] },
          { point: t }, { say: 42 },
          { say: 'The table shows the two stages.', point: t, draw: [{ shape: 'underline', el: t }, { shape: 'graph', fn: 'x^2', x: 0.6, y: 0.5, w: 0.3, h: 0.3 }] },
          { say: 'A bad pointer is ignored.', point: { el: 999 }, draw: [{ shape: 'circle', x: 7, y: 'a' }] },
        ] }) + '\n```';
        const tabs = await chrome.tabs.query({ active: true }).catch(() => []);
        if (tabs.some((t) => /blocked\.html/.test(t.url || ''))) return JSON.stringify({ steps: [{ say: 'The heading names the law.', point: { x: 0.1, y: 0.09 } }] });
        return JSON.stringify({ steps: [{ say: 'The chart shows sales going up.', point: { x: 0.05, y: 0.5 }, draw: [{ shape: 'circle', x: 0.05, y: 0.5, r: 0.03 }] }, { say: 'It rises faster at the end.', point: { x: 0.8, y: 0.2 } }] });
      };
    });
    // Bella's studio voice, faked in the background: what's left (self.__voice.left), and each sentence as a
    // tiny WAV, failing from the failFrom-th one on
    const wav = (() => { const n = 800, buf = Buffer.alloc(44 + n * 2); buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(8000, 24); buf.writeUInt32LE(16000, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40); return buf; })();
    await sw.evaluate((b64) => {
      self.__clips = []; self.__voice = { left: 9000, failFrom: null };
      self.speakLeft = async () => ({ on: true, left: self.__voice.left, back: '2026-11-01' });
      self.speakClip = async (text) => { const ok = self.__voice.failFrom == null || self.__clips.length < self.__voice.failFrom; self.__clips.push({ text, ok }); if (!ok) throw new Error('voice 502'); return { audio: b64 }; };
    }, wav.toString('base64'));
    const clips = () => sw.evaluate(() => self.__clips.slice());
    const asked = () => sw.evaluate(() => self.__asked.splice(0));
    const setting = (o) => sw.evaluate((o) => chrome.storage.local.set(o), o);
    const id = new URL(sw.url()).host;
    const tabPage = ctx.pages()[0] || await ctx.newPage();
    // the panel in its own small window, so the test page stays the tab being looked at
    const panelOpened = ctx.waitForEvent('page', { timeout: 15000 });
    await sw.evaluate(() => chrome.windows.create({ url: chrome.runtime.getURL('panel.html?float=1'), type: 'popup', width: 420, height: 760 }));
    const panel = await panelOpened;
    await panel.waitForSelector('#t-teach');
    for (const b of ['#t-teach', '#t-ask', '#t-snip']) expect((await panel.locator(b).boundingBox()).height >= 44, b + ' is at least 44px tall');
    const words = await panel.locator('.tools').innerText();
    expect(/Teach me/.test(words) && /Ask Cassie/.test(words), 'the panel has Teach me and Ask Cassie: ' + words);
    const HOST = '#cassie-teach-host-92f1';
    const lesson = () => tabPage.evaluate((h) => { const n = document.querySelector(h); return n && { step: n.dataset.step, spoken: n.dataset.spoken, drawn: n.dataset.drawn, frame: n.dataset.frame || "" }; }, HOST);
    const cursorAt = (p) => p.evaluate((h) => { const c = document.querySelector(h).shadowRoot.querySelector('.ct-cursor'); return c.classList.contains('on') ? [+c.dataset.x, +c.dataset.y] : null; }, HOST);
    const ink = (p, box) => p.evaluate(([h, box]) => {
      const c = document.querySelector(h).shadowRoot.querySelector('canvas'), k = c.width / c.clientWidth, d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let inside = 0, outside = 0;
      for (let y = 0; y < c.height; y += 2) for (let x = 0; x < c.width; x += 2) {
        if (d[(y * c.width + x) * 4 + 3] < 40) continue;
        const X = x / k, Y = y / k;
        if (!box || (X >= box[0] && X <= box[2] && Y >= box[1] && Y <= box[3])) inside++; else outside++;
      }
      return { inside, outside };
    }, [HOST, box]);

    // 1. a page with headings and a table: she speaks step 1, points at the heading, draws a circle and an arrow
    await setting({ teachVoice: 'on', teachAuto: 'off' });
    await tabPage.goto(`http://localhost:${APP_PORT}/tests/fixtures/teach/page.html`);
    await tabPage.bringToFront(); await tabPage.waitForTimeout(800);
    await panel.click('#t-teach');
    await tabPage.waitForSelector(HOST, { state: 'attached', timeout: 20000 });
    await tabPage.waitForFunction((h) => +document.querySelector(h).dataset.spoken >= 1, HOST, { timeout: 8000 });
    let l = await lesson();
    expect(l.step === '0' && l.drawn === 'circle,arrow', 'step 1 draws a circle and an arrow (the bad shape is left out): ' + JSON.stringify(l));
    let q = await asked();
    expect(q.length === 1 && /heading "Photosynthesis"/.test(q[0].prompt) && /table heading "Stage"/.test(q[0].prompt) && /^data:image\/png/.test(q[0].image), 'she was given the numbered parts and a picture of the tab: ' + JSON.stringify(q.map((x) => [x.image, x.prompt.slice(0, 200)])));
    expect(q.every((x) => !x.log), 'nothing she was shown is kept (no log)');
    await tabPage.waitForTimeout(1500);
    const h1 = await tabPage.evaluate(() => { const r = document.querySelector('h1').getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; });
    const at1 = await cursorAt(tabPage);
    expect(at1 && at1[0] >= h1[0] && at1[0] <= h1[2] && at1[1] >= h1[1] && at1[1] <= h1[3], `the arrow lands on the heading: ${at1} in ${h1}`);
    const drawn1 = await ink(tabPage, null);
    expect(drawn1.inside > 200, 'the circle and the arrow are drawn on the layer: ' + JSON.stringify(drawn1));
    expect(await panel.locator('.teach-on').isVisible(), 'the panel says she is teaching on the page');
    // the layer never blocks the page: a tap goes through to the page, and she never taps or types herself
    expect(await tabPage.evaluate((h) => getComputedStyle(document.querySelector(h)).pointerEvents === 'none' && window.taps === 0 && window.keys === 0, HOST), 'the layer lets taps through, and Cassie tapped and typed nothing');
    await tabPage.click('#tap');
    expect(await tabPage.evaluate(() => window.taps) === 1, 'a tap on the page reaches the page while she teaches');
    const card = tabPage.locator(`${HOST} .ct-card`);
    for (const b of ['.ct-voice', '.ct-auto', '.ct-x', '.ct-back', '.ct-next']) { const bb = await card.locator(b).boundingBox(); expect(bb.height >= 44 && bb.width >= 44, b + ' is 44px: ' + JSON.stringify(bb)); }
    const cardText = await card.innerText();
    expect(!/[—–]/.test(cardText), 'no dashes on her card: ' + cardText);
    // the steps that made no sense were skipped: 3 good steps, no error
    expect(/1 of 3/.test(cardText), 'bad steps are skipped with nothing on screen: ' + cardText);

    let cl = await clips();
    expect(cl.length === 1 && cl[0].ok && cl[0].text === 'This page is about photosynthesis.', 'step 1 was said in Bella’s voice: ' + JSON.stringify(cl));
    expect(await card.locator('.ct-vnote').isHidden(), 'no line when she can speak');

    // 6. Escape removes the layer, the arrow and the card
    await tabPage.keyboard.press('Escape');
    await tabPage.waitForTimeout(300);
    expect(await tabPage.evaluate(() => !document.querySelector('[id^="cassie-teach"]') && !document.querySelector('.ct-card, .ct-cursor, canvas.ct-ink')), 'Escape leaves no trace of the lesson on the page');

    // Bella only: too little left for the lesson, so every step is typed and the card says so once
    const LINE = await panel.evaluate(() => CassieErrors.say('voice_typing'));
    await sw.evaluate(() => { self.__voice.left = 20; });
    let n0 = (await clips()).length;
    await panel.click('#t-teach');
    await tabPage.waitForSelector(HOST, { state: 'attached', timeout: 20000 });
    await tabPage.waitForFunction((h) => { const n = document.querySelector(h).shadowRoot.querySelector('.ct-vnote'); return n && !n.hidden; }, HOST, { timeout: 8000 });
    expect(await card.locator('.ct-vnote').innerText() === LINE, 'the one line on the card: ' + await card.locator('.ct-vnote').innerText());
    await tabPage.click(`${HOST} .ct-next`);
    await tabPage.waitForTimeout(600);
    l = await lesson();
    expect(l.step === '1' && l.spoken === '0' && (await clips()).length === n0, 'nothing spoken, and Next moves on: ' + JSON.stringify(l));
    await tabPage.keyboard.press('Escape');
    await asked();
    // Bella fails at step 2: tried once more, then the rest is typed with the line; no other voice
    await sw.evaluate(() => { self.__voice.left = 9000; self.__voice.failFrom = self.__clips.length + 1; });
    n0 = (await clips()).length;
    await panel.click('#t-teach');
    await tabPage.waitForSelector(HOST, { state: 'attached', timeout: 20000 });
    await tabPage.waitForFunction((h) => +document.querySelector(h).dataset.spoken >= 1, HOST, { timeout: 8000 });
    await tabPage.click(`${HOST} .ct-next`);
    await tabPage.waitForFunction((h) => { const n = document.querySelector(h).shadowRoot.querySelector('.ct-vnote'); return n && !n.hidden; }, HOST, { timeout: 8000 });
    await tabPage.click(`${HOST} .ct-next`);
    await tabPage.waitForTimeout(800);
    cl = (await clips()).slice(n0);
    l = await lesson();
    expect(cl.length === 3 && cl[0].ok && cl.slice(1).every((x) => !x.ok && x.text === 'The table shows the two stages.') && l.spoken === '1' && l.step === '2', 'step 1 said, step 2 tried twice, step 3 typed: ' + JSON.stringify([cl, l]));
    expect(await card.locator('.ct-vnote').innerText() === LINE, 'the same line');
    await tabPage.keyboard.press('Escape');
    await sw.evaluate(() => { self.__voice.failFrom = null; });
    await asked();

    // 2. voice off (remembered from the card's switch): no speech at all, and Next moves on
    await panel.click('#t-teach');
    await tabPage.waitForSelector(HOST, { state: 'attached', timeout: 20000 });
    await tabPage.click(`${HOST} .ct-voice`);
    expect(await sw.evaluate(() => chrome.storage.local.get('teachVoice').then((o) => o.teachVoice)) === 'off', 'the voice switch is remembered');
    await tabPage.keyboard.press('Escape');
    await asked();
    await panel.click('#t-teach');
    await tabPage.waitForSelector(HOST, { state: 'attached', timeout: 20000 });
    await tabPage.waitForTimeout(1500);
    l = await lesson();
    expect(l.spoken === '0' && l.step === '0', 'voice off: no speech: ' + JSON.stringify(l));
    expect(/Voice off/.test(await card.locator('.ct-voice').innerText()), 'the card shows Voice off');
    await tabPage.click(`${HOST} .ct-next`);
    await tabPage.waitForTimeout(400);
    l = await lesson();
    expect(l.step === '1' && l.spoken === '0' && l.drawn === 'underline,graph', 'Next moves to step 2, still silent: ' + JSON.stringify(l));
    // with Auto on, steps move on by themselves (no "Keep going")
    await tabPage.click(`${HOST} .ct-auto`);
    await tabPage.waitForFunction((h) => document.querySelector(h).dataset.step === '2', HOST, { timeout: 12000 });
    await tabPage.keyboard.press('Escape');
    await asked();

    // 3. a page drawn on a canvas: she reads a picture of it and points by place
    await setting({ teachAuto: 'off' });
    await tabPage.goto(`http://localhost:${APP_PORT}/tests/fixtures/teach/canvas.html`);
    await tabPage.waitForTimeout(800);
    await panel.click('#t-teach');
    await tabPage.waitForSelector(HOST, { state: 'attached', timeout: 20000 });
    await tabPage.waitForTimeout(1500);
    q = await asked();
    expect(q.length === 1 && /^data:image\/png/.test(q[0].image) && !/numbered/.test(q[0].prompt) && /a spot on the picture/.test(q[0].prompt), 'the canvas page goes as a picture, with no numbered parts: ' + (q[0] && q[0].prompt.slice(0, 300)));
    const vp = await tabPage.evaluate(() => [innerWidth, innerHeight]);
    const at3 = await cursorAt(tabPage);
    // (shares of the screenshot, which can be smaller than the window; she points at the chart's axis, not blank canvas)
    const fr = (await lesson()).frame.split('x').map(Number);
    expect(at3 && Math.abs(at3[0] - 0.05 * fr[0]) <= 3 && Math.abs(at3[1] - 0.5 * fr[1]) <= 3, `the arrow points by place (x 5%, y 50%) on the chart's axis: ${at3} on ${fr}`);
    await tabPage.keyboard.press('Escape');

    // 4. Snip, then Teach me: she points and draws inside the snipped part
    await panel.click('#t-snip');
    await panel.waitForSelector('.crop img', { timeout: 15000 });
    await panel.waitForFunction(() => document.querySelector('.crop img').naturalWidth > 0);
    const cb = await panel.locator('.crop').boundingBox();
    await panel.mouse.move(cb.x + cb.width * 0.25, cb.y + cb.height * 0.25);
    await panel.mouse.down();
    await panel.mouse.move(cb.x + cb.width * 0.5, cb.y + cb.height * 0.5, { steps: 4 });
    await panel.mouse.move(cb.x + cb.width * 0.75, cb.y + cb.height * 0.75, { steps: 4 });
    await panel.mouse.up();
    await panel.waitForSelector('#snip-teach', { timeout: 5000 });
    expect((await panel.locator('#snip-teach').boundingBox()).height >= 44, 'Teach me here is 44px');
    await panel.click('#snip-teach');
    await tabPage.waitForSelector(HOST, { state: 'attached', timeout: 20000 });
    await tabPage.waitForTimeout(2000);
    q = await asked();
    expect(q.length === 1 && /they snipped it/.test(q[0].prompt) && /^data:image\/jpeg/.test(q[0].image), 'the snip goes to her as the picture: ' + JSON.stringify(q.map((x) => x.image)));
    const at4 = await cursorAt(tabPage);
    expect(at4 && Math.abs(at4[0] - 0.5 * vp[0]) <= 6 && Math.abs(at4[1] - 0.5 * vp[1]) <= 6, `the arrow points at the middle of the snip: ${at4} on ${vp}`);
    const inSnip = await ink(tabPage, [0.25 * vp[0] - 12, 0.25 * vp[1] - 12, 0.75 * vp[0] + 12, 0.75 * vp[1] + 12]);
    expect(inSnip.inside > 150 && inSnip.outside === 0, 'her circle and arrow are drawn inside the snip only: ' + JSON.stringify(inSnip));
    expect((await lesson()).drawn === 'circle,arrow', 'the snip lesson drew a circle and an arrow');
    await tabPage.keyboard.press('Escape');

    // 7. Ask Cassie about the page: the answer is in the panel, and she points at what she means
    await tabPage.goto(`http://localhost:${APP_PORT}/tests/fixtures/teach/page.html`);
    await tabPage.waitForTimeout(800);
    await panel.click('#t-ask');
    expect((await panel.locator('.ask-page input').boundingBox()).height >= 44, 'the question box is 44px');
    await panel.fill('.ask-page input', 'What is this page about?');
    await panel.press('.ask-page input', 'Enter');
    await panel.waitForFunction(() => /Plants make their own food from light/.test(document.querySelector('.ask-page .answer').innerText), null, { timeout: 20000 });
    await tabPage.waitForSelector(HOST, { state: 'attached', timeout: 10000 });
    await tabPage.waitForTimeout(1500);
    q = await asked();
    expect(q.length === 1 && /The student asks: "What is this page about\?"/.test(q[0].prompt) && !q[0].log, 'her question went with the page, and is not kept');
    const h1b = await tabPage.evaluate(() => { const r = document.querySelector('h1').getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; });
    const at7 = await cursorAt(tabPage);
    expect(at7 && at7[0] >= h1b[0] && at7[0] <= h1b[2] && at7[1] >= h1b[1] && at7[1] <= h1b[3], `she points at what she means: ${at7} in ${h1b}`);
    await tabPage.click(`${HOST} .ct-x`);
    await tabPage.waitForTimeout(300);
    expect(await tabPage.evaluate((h) => !document.querySelector(h), HOST), 'the close button removes the lesson too');

    // 5. a page the extension can't draw on: the panel shows the picture of the tab, the reason, and the lesson there
    await tabPage.goto(`http://localhost:${APP_PORT}/tests/fixtures/teach/blocked.html`);
    await tabPage.waitForTimeout(800);
    await panel.click('#t-teach');
    await panel.waitForSelector('.teach-why, .teach-err', { timeout: 20000 });
    expect(await panel.locator('.teach-why').count(), 'the panel shows the lesson, not: ' + await panel.locator('#view').innerText());
    const why = await panel.locator('.teach-why').innerText();
    expect(why === await panel.evaluate(() => CassieErrors.say('teach_where_page')) && !/[—–]/.test(why), 'one plain sentence says why: ' + why);
    await panel.waitForFunction((h) => { const n = document.querySelector(h); return n && n.dataset.step === '0'; }, HOST, { timeout: 8000 });
    expect(/^data:image\/png/.test(await panel.evaluate((h) => document.querySelector(h).shadowRoot.querySelector('.ct-shot img').src, HOST)), 'the panel shows the picture of the tab');
    expect(await panel.evaluate((h) => document.querySelector(h).shadowRoot.querySelector('.ct-cursor').classList.contains('on'), HOST), 'and points on it');
    expect(await tabPage.evaluate((h) => !document.querySelector(h), HOST), 'nothing is put on the page');
    // the reasons for the browser's own pages, its PDF viewer and the stores
    const whys = await panel.evaluate(() => ['chrome://settings', '', 'https://example.com/notes.pdf', 'https://chromewebstore.google.com/detail/x', 'https://microsoftedge.microsoft.com/addons/detail/x'].map((url) => whyNotHere({ url })));
    expect(whys.join() === 'teach_where_browser,teach_where_browser,teach_where_pdf,teach_where_store,teach_where_store', 'each place gets its reason: ' + whys.join());
    // the AI failing: a plain words error with Try again, through CassieErrors
    await sw.evaluate(() => { self.readPicture = async () => { throw new Error('boom'); }; });
    await panel.click('#t-teach');
    await panel.waitForSelector('.teach-err', { timeout: 20000 });
    const err = await panel.locator('.teach-err').innerText();
    expect(err.includes(await panel.evaluate(() => CassieErrors.say('teach_failed'))) && /Try again/.test(err) && !/boom/.test(err), 'a failed lesson says so in plain words with Try again: ' + err);
    expect((await panel.locator('.teach-err button').boundingBox()).height >= 44, 'Try again is 44px');
    // the parser on its own: only well-formed steps and shapes are kept
    const parsed = await panel.evaluate(() => CassieTeach.parse('{"steps":[{"say":"ok","point":{"x":2,"y":0.5},"draw":[{"shape":"polygon","points":[[0,0],[1,0]]},{"shape":"curve","points":[[0,0],[0.5,0.5]]},{"shape":"graph","fn":"alert(1)","x":0.1,"y":0.1,"w":0.5,"h":0.5}]},"junk",{"say":"two","point":{"selector":"h1"}}]}', 0));
    expect(parsed.length === 2 && parsed[0].point === null && parsed[0].draw.map((d) => d.shape).join() === 'curve' && parsed[1].point.selector === 'h1', 'the parser keeps only what makes sense: ' + JSON.stringify(parsed));
  } finally { await ctx.close(); fs.rmSync(profile, { recursive: true, force: true }); }
});

test('Cursor Cassie on the page (like Clicky): her cursor follows the mouse when on and is gone when off; Teach me this page from the floating menu points and draws one step at a time, earlier steps stay in grey, × or Escape leaves nothing; the card says where lessons are kept; the lesson is saved in Your lessons with its steps and picture, opens in the Cassie app and can be deleted; voice off never speaks; nothing is read before she is asked', async () => {
  const ext = path.join(ROOT, 'extension');
  const profile = fs.mkdtempSync(path.join(require('os').tmpdir(), 'cassie-ext-'));
  const ctx = await chromium.launchPersistentContext(profile, {
    headless: true, viewport: { width: 1200, height: 800 }, ...(fs.existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : { channel: 'chromium' }),
    args: ['--headless=new', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  try {
    // the real site address, served from this repo, so "Open in Cassie" reaches the app
    await ctx.route(/askcassie\.pages\.dev/, async (route) => {
      const u = new URL(route.request().url());
      return route.fulfill({ response: await route.fetch({ url: `http://localhost:${APP_PORT}${u.pathname}` }) });
    });
    await ctx.route(/api\.groq\.com|workers\.dev|fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
    await ctx.addInitScript(([seed, srv]) => { if (location.hostname !== 'askcassie.pages.dev') return; window.CASSIE_SERVER = srv; if (!localStorage.getItem('cassie.v2')) localStorage.setItem('cassie.v2', seed); }, [JSON.stringify({ profile: PROFILE, seenVersion: APP_VERSION, lite: 'on' }), SERVER]);
    let sw = null;
    for (let i = 0; i < 80 && !sw; i++) {
      for (const w of ctx.serviceWorkers()) if (/\/background\.js$/.test(w.url()) && await w.evaluate(() => typeof readPicture === 'function').catch(() => false)) { sw = w; break; }
      if (!sw) await new Promise((r) => setTimeout(r, 250));
    }
    expect(sw, 'the Cassie extension did not start');
    // the AI, faked; and every picture of the tab is counted
    await sw.evaluate(() => {
      self.__asked = []; self.__shots = 0;
      const cap = chrome.tabs.captureVisibleTab.bind(chrome.tabs);
      chrome.tabs.captureVisibleTab = (...a) => { self.__shots++; return cap(...a); };
      self.readPicture = async (keys, msg) => {
        const p = String(msg.prompt || '');
        self.__asked.push({ prompt: p, log: msg.log || null });
        const num = (what) => { const m = p.match(new RegExp('^(\\d+)\\. ' + what, 'm')); return m ? +m[1] : 0; };
        const h = num('heading "Photosynthesis"'), t = num('table heading "Stage"');
        if (/The student asks/.test(p)) return JSON.stringify({ answer: 'Plants make their own food from light.', steps: [{ say: 'The heading names the topic.', point: h, draw: [{ shape: 'underline', el: h }] }] });
        return JSON.stringify({ steps: [
          { say: 'This page is about photosynthesis.', point: h, draw: [{ shape: 'box', el: h }] },
          { say: 'The table shows the two stages.', point: t, draw: [{ shape: 'box', el: t }] },
          { say: 'That is the big idea.', point: h },
        ] });
      };
    });
    const store = (k) => sw.evaluate((k) => chrome.storage.local.get(k).then((o) => o[k]), k);
    const reads = () => sw.evaluate(() => ({ asked: self.__asked.length, shots: self.__shots }));
    await sw.evaluate(() => chrome.storage.local.set({ teachVoice: 'off', teachAuto: 'off' }));
    const tab = ctx.pages()[0] || await ctx.newPage();
    await tab.goto(`http://localhost:${APP_PORT}/tests/fixtures/teach/page.html`);
    await tab.bringToFront(); await tab.waitForTimeout(1000);
    const HOST = '#cassie-teach-host-92f1', FOLLOW = '#cassie-follow-92f1';
    const follower = () => tab.evaluate((f) => { const n = document.querySelector(f); return n ? { shown: getComputedStyle(n).display !== 'none', at: n.getBoundingClientRect().toJSON(), pe: getComputedStyle(n).pointerEvents } : null; }, FOLLOW);
    const lesson = () => tab.evaluate((h) => { const n = document.querySelector(h); return n && { step: n.dataset.step, spoken: n.dataset.spoken, drawn: n.dataset.drawn, past: n.dataset.past }; }, HOST);
    const box = (sel) => tab.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; }, sel);
    const openMenu = async () => { if (!await tab.locator('.dock.open').count()) { const hb = await tab.locator('.dock-handle').boundingBox(); await tab.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2, { steps: 2 }); } await tab.waitForSelector('.dock.open .dock-tray', { timeout: 5000 }); };
    const cursorAt = () => tab.evaluate((h) => { const c = document.querySelector(h).shadowRoot.querySelector('.ct-cursor'); return c.classList.contains('on') ? [+c.dataset.x, +c.dataset.y] : null; }, HOST);
    // the ink on her see-through layer, sorted into dark (this step) and light grey (earlier steps), inside a box or not
    const ink = (b) => tab.evaluate(([h, b]) => {
      const c = document.querySelector(h).shadowRoot.querySelector('canvas'), k = c.width / c.clientWidth, d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      const o = { darkIn: 0, darkOut: 0, greyIn: 0, greyOut: 0 };
      for (let y = 0; y < c.height; y += 2) for (let x = 0; x < c.width; x += 2) {
        const i = (y * c.width + x) * 4;
        if (d[i + 3] < 200) continue;
        const inside = b && x / k >= b[0] && x / k <= b[2] && y / k >= b[1] && y / k <= b[3];
        if (d[i] < 70 && d[i + 1] < 70) o[inside ? 'darkIn' : 'darkOut']++;
        else if (d[i] >= 160 && d[i] <= 200 && Math.abs(d[i] - d[i + 1]) < 10) o[inside ? 'greyIn' : 'greyOut']++;
      }
      return o;
    }, [HOST, b]);

    // 1. before she is asked: no cursor beside the mouse yet, and nothing is read from the page
    await tab.mouse.move(300, 300); await tab.mouse.move(320, 320, { steps: 3 });
    await tab.waitForTimeout(300);
    let f = await follower();
    expect(!f || !f.shown, 'her cursor is off until the first lesson: ' + JSON.stringify(f));
    expect(await store('teachCursor') === undefined, 'the cursor switch starts unset');
    let r0 = await reads();
    expect(r0.asked === 0 && r0.shots === 0, 'nothing is read from the page before the student asks: ' + JSON.stringify(r0));

    // 2. the floating menu: Ask Cassie about this page, Teach me this page, and the cursor switch, all 44px
    await openMenu();
    for (const s of ['.fab-teach', '.dock-cur']) { const bb = await tab.locator(s).boundingBox(); expect(bb.height >= 44 && bb.width >= 44, s + ' is 44px: ' + JSON.stringify(bb)); }
    expect(await tab.locator('.fab-teach').getAttribute('aria-label') === 'Teach me this page', 'the menu says Teach me this page');
    r0 = await reads();
    expect(r0.asked === 0 && r0.shots === 0, 'opening the menu reads nothing: ' + JSON.stringify(r0));

    // 3. Teach me this page: the arrow lands on the heading, step 1 draws only its box
    await tab.click('.fab-teach');
    await tab.waitForSelector(HOST, { state: 'attached', timeout: 20000 });
    await tab.waitForTimeout(1800);
    const q = await sw.evaluate(() => self.__asked.slice());
    expect(q.length === 1 && /heading "Photosynthesis"/.test(q[0].prompt) && !q[0].log, 'one look at the page, with its numbered parts, not kept: ' + q.length);
    expect((await reads()).shots === 1, 'one picture of the tab, taken when asked');
    let l = await lesson();
    expect(l.step === '0' && l.drawn === 'box' && l.past === '0', 'step 1 draws one box: ' + JSON.stringify(l));
    const h1 = await box('h1'), th = await box('th');
    let at = await cursorAt();
    expect(at && at[0] >= h1[0] && at[0] <= h1[2] && at[1] >= h1[1] && at[1] <= h1[3], `the arrow lands on the heading: ${at} in ${h1}`);
    const thPad = [th[0] - 14, th[1] - 14, th[2] + 14, th[3] + 14];
    let k1 = await ink(thPad);
    expect(k1.darkOut > 100 && k1.darkIn === 0 && k1.greyIn === 0 && k1.greyOut < k1.darkOut / 4, 'step 1 draws at the heading only, nothing yet at the table: ' + JSON.stringify(k1));
    f = await follower();
    expect(await store('teachCursor') === 'on' && (!f || !f.shown), 'the first lesson turns her cursor on; it waits while she teaches: ' + JSON.stringify(f));
    expect(await tab.evaluate(() => window.taps === 0 && window.keys === 0), 'she clicked and typed nothing');
    const card = tab.locator(`${HOST} .ct-card`);
    const note = await card.locator('.ct-note').innerText();
    expect(note === 'When you’re done, close this. Everything Cassie taught is saved in the Cassie side panel.', 'the card says where the lesson is kept: ' + note);
    expect(!/[—–]/.test(await card.innerText()), 'no dashes on her card');

    // 4. Next: she glides to the table and draws there; the heading's box stays, in light grey (voice off: never speaks)
    await tab.click(`${HOST} .ct-next`);
    await tab.waitForTimeout(1800);
    l = await lesson();
    expect(l.step === '1' && l.drawn === 'box' && l.past === '1' && l.spoken === '0', 'Next moves on, with the first step kept and no speech: ' + JSON.stringify(l));
    at = await cursorAt();
    expect(at && at[0] >= th[0] && at[0] <= th[2] && at[1] >= th[1] && at[1] <= th[3], `the arrow moves to the table: ${at} in ${th}`);
    const k2 = await ink(thPad);
    expect(k2.darkIn > 20 && k2.darkOut === 0 && k2.greyOut > 400, 'this step is dark at the table, the earlier box is light grey: ' + JSON.stringify(k2));
    await tab.click(`${HOST} .ct-next`);
    await tab.waitForTimeout(800);
    l = await lesson();
    expect(l.step === '2' && l.past === '2' && l.spoken === '0', 'Next still works with voice off: ' + JSON.stringify(l));

    // 5. Escape: every drawing and her arrow leave the page; her cursor comes back beside the mouse
    await tab.keyboard.press('Escape');
    await tab.waitForTimeout(400);
    expect(await tab.evaluate(() => !document.querySelector('[id^="cassie-teach"]') && !document.querySelector('canvas, .ct-card, .ct-cursor')), 'Escape leaves nothing of the lesson on the page');
    await tab.mouse.move(400, 420, { steps: 3 });
    await tab.waitForTimeout(300);
    f = await follower();
    expect(f && f.shown && f.pe === 'none' && Math.abs(f.at.left - 416) <= 1 && Math.abs(f.at.top - 438) <= 1, 'her cursor follows the mouse, a little down and right, and takes no taps: ' + JSON.stringify(f));
    await tab.mouse.move(600, 200, { steps: 3 });
    await tab.waitForTimeout(300);
    f = await follower();
    expect(f.shown && Math.abs(f.at.left - 616) <= 1 && Math.abs(f.at.top - 218) <= 1, 'and keeps following: ' + JSON.stringify(f.at));
    // a tap under her cursor reaches the page (she never covers what the student points at)
    const tapBox = await box('#tap');
    await tab.mouse.click((tapBox[0] + tapBox[2]) / 2, (tapBox[1] + tapBox[3]) / 2);
    expect(await tab.evaluate(() => window.taps) === 1, 'the button under the mouse still takes the tap');

    // 6. the lesson is saved: the page title, each step's words, and a picture with the drawings
    let saved = await store('teachLessons');
    expect(Array.isArray(saved) && saved.length === 1 && saved[0].title === 'Photosynthesis notes' && saved[0].steps.join('|') === 'This page is about photosynthesis.|The table shows the two stages.|That is the big idea.' && /^data:image\/jpeg/.test(saved[0].pic) && saved[0].pic.length > 2000, 'the lesson is kept: ' + JSON.stringify(saved && saved.map((x) => ({ ...x, pic: String(x.pic).slice(0, 30) }))));

    // 7. the cursor switch in the floating menu turns her off (gone), and back on
    await openMenu();
    expect(await tab.locator('.dock-cur').getAttribute('aria-pressed') === 'true', 'the menu switch shows on');
    await tab.click('.dock-cur');
    await tab.waitForTimeout(300);
    await tab.mouse.move(500, 500, { steps: 3 });
    await tab.waitForTimeout(300);
    f = await follower();
    expect(await store('teachCursor') === 'off' && (!f || !f.shown), 'off: her cursor is gone: ' + JSON.stringify(f));

    // 8. Ask from the floating button: the answer shows in the popover, and she points at it
    await openMenu();
    await tab.click('.dock .fab:not(.fab-teach)');
    await tab.waitForSelector('.page-input', { timeout: 5000 });
    await tab.fill('.page-input', 'What is this page about?');
    await tab.click('.page-ask-btn');
    await tab.waitForSelector(HOST, { state: 'attached', timeout: 20000 });
    await tab.waitForFunction(() => /Plants make their own food from light/.test(document.querySelector('#cassie-ext-host-92f1').shadowRoot.textContent), null, { timeout: 10000 });
    await tab.waitForTimeout(1500);
    at = await cursorAt();
    expect(at && at[0] >= h1[0] && at[0] <= h1[2] && at[1] >= h1[1] && at[1] <= h1[3], `Ask points at the heading too: ${at} in ${h1}`);
    expect((await lesson()).drawn === 'underline', 'and draws');
    await tab.click(`${HOST} .ct-x`);
    await tab.waitForTimeout(400);
    expect(await tab.evaluate(() => !document.querySelector('[id^="cassie-teach"]')), '× leaves nothing on the page');
    saved = await store('teachLessons');
    expect(saved.length === 2 && saved[0].q === 'What is this page about?', 'newest first, with the question: ' + saved.map((x) => x.q).join('|'));

    // 9. the side panel: the cursor switch, and Your lessons with steps and picture; Open in Cassie; Delete
    const panelOpened = ctx.waitForEvent('page', { timeout: 15000 });
    await sw.evaluate(() => chrome.windows.create({ url: chrome.runtime.getURL('panel.html?float=1'), type: 'popup', width: 420, height: 900 }));
    const panel = await panelOpened;
    await panel.waitForSelector('.lessons .lesson', { timeout: 10000 });
    const sw2 = panel.locator('.cur-switch');
    expect(await sw2.getAttribute('aria-pressed') === 'false' && (await sw2.boundingBox()).height >= 44, 'the panel switch shows off, 44px');
    await sw2.click();
    await tab.bringToFront();
    await tab.mouse.move(250, 260, { steps: 3 });
    await tab.waitForTimeout(400);
    f = await follower();
    expect(await store('teachCursor') === 'on' && f && f.shown, 'the panel switch turns her cursor back on: ' + JSON.stringify(f));
    const lessons = panel.locator('.lessons .lesson');
    expect(await lessons.count() === 2 && /Your lessons/.test(await panel.locator('.lessons').innerText()), 'Your lessons lists both');
    const first = lessons.nth(1); // (the Teach me lesson; the newest is first)
    expect(/Photosynthesis notes/.test(await first.innerText()), 'it has the page title');
    await first.locator('summary').click();
    expect((await first.locator('ol li').allInnerTexts()).join('|') === saved[1].steps.join('|'), 'it has every step');
    expect(/^data:image\/jpeg/.test(await first.locator('img').getAttribute('src')) && await first.locator('img').evaluate((i) => i.naturalWidth === 480), 'it has the picture');
    for (const b of await panel.locator('.lessons button, .lessons summary').all()) { const bb = await b.boundingBox(); if (bb) expect(bb.height >= 44, 'lesson buttons are 44px: ' + await b.innerText()); }
    expect(!/[—–]/.test(await panel.locator('.lessons').innerText()), 'no dashes in Your lessons');
    const appOpened = ctx.waitForEvent('page', { timeout: 15000 });
    await first.locator('[data-open]').click();
    const app = await appOpened;
    await app.waitForLoadState().catch(() => {});
    if (!/askcassie\.pages\.dev/.test(await app.evaluate(() => location.host).catch(() => ''))) await app.goto(app.url().startsWith('chrome-error') ? 'https://askcassie.pages.dev/app.html' : app.url()); // (the test's stand-in for the site is set up a moment after a new tab's first load)
    await app.waitForFunction(() => typeof state === 'object' && state.chats.some((c) => (c.messages || []).some((m) => /lesson you taught me on a page called “Photosynthesis notes”/.test(m.content || m.text || ''))), null, { timeout: 20000 });
    const att = await app.evaluate(() => JSON.stringify(state.chats.flatMap((c) => c.messages || []).filter((m) => /lesson you taught me/.test(m.content || m.text || ''))).slice(0, 800));
    expect(/Cassie lesson\.txt|The table shows the two stages/.test(att), 'the lesson reached the app chat with its words: ' + att);
    await app.close();
    await first.locator('[data-del]').click();
    await panel.waitForFunction(() => document.querySelectorAll('.lessons .lesson').length === 1);
    expect((await store('teachLessons')).length === 1, 'Delete removes one lesson');
    panel.once('dialog', (d) => d.accept());
    await panel.click('.lessons-clear');
    await panel.waitForFunction(() => !document.querySelector('.lessons .lesson'));
    expect((await store('teachLessons')).length === 0, 'Delete all removes every lesson');
  } finally { await ctx.close(); fs.rmSync(profile, { recursive: true, force: true }); }
});

test('the landing page’s moving background: it doesn’t measure the page every frame, and stops drawing once scrolled out of sight (a jump down the page froze for about 100 ms)', async (b) => {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  // count the background's frames, and every time its box is measured
  await page.addInitScript(() => {
    window.__bg = { draws: 0, reads: 0 };
    for (const P of [window.WebGLRenderingContext, window.WebGL2RenderingContext].filter(Boolean)) {
      const d = P.prototype.drawArrays;
      P.prototype.drawArrays = function (...a) { if (this.canvas.parentElement && this.canvas.parentElement.id === 'hero-bg') window.__bg.draws++; return d.apply(this, a); };
    }
    for (const k of ['clientWidth', 'clientHeight']) {
      const g = Object.getOwnPropertyDescriptor(Element.prototype, k).get;
      Object.defineProperty(Element.prototype, k, { configurable: true, get() { if (this.id === 'hero-bg') window.__bg.reads++; return g.call(this); } });
    }
  });
  await page.goto(APP.replace('app.html', 'index.html'));
  await page.waitForFunction(() => window.__bg.draws > 3, null, { timeout: 15000 });
  const a = await page.evaluate(() => ({ ...window.__bg }));
  await page.waitForTimeout(1500);
  const c = await page.evaluate(() => ({ ...window.__bg }));
  expect(c.draws - a.draws >= 5, 'the background moves while on screen: ' + JSON.stringify([a, c]));
  expect(c.reads - a.reads <= 2, 'its box isn’t measured every frame: ' + JSON.stringify([a, c]));
  await page.locator('.nav a', { hasText: 'FAQ' }).first().click();
  await page.waitForTimeout(800);
  const d = await page.evaluate(() => ({ ...window.__bg }));
  await page.waitForTimeout(1500);
  const e = await page.evaluate(() => ({ ...window.__bg }));
  expect(e.draws - d.draws <= 1, 'scrolled out of sight, it stops drawing: ' + JSON.stringify([d, e]));
  await page.evaluate(() => scrollTo(0, 0)); await page.waitForTimeout(1500);
  const f = await page.evaluate(() => ({ ...window.__bg }));
  expect(f.draws - e.draws >= 5, 'back in sight, it moves again: ' + JSON.stringify([e, f]));
  await ctx.close();
});

test('the Chrome extension: its button sits beside Open Cassie on computers (none on phones), every download link carries the extension’s version, the built zip is that version, and an old copy is told a new one is ready', async (b) => {
  const extver = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension/manifest.json'), 'utf8')).version;
  // the build: the zip on the site is the extension as it is now, and extension-version.json says so
  const built = path.join(ROOT, '_site');
  expect(fs.existsSync(path.join(built, 'cassie-extension.zip')), 'run bash scripts/build-site.sh first');
  const zipped = JSON.parse(require('child_process').execFileSync('unzip', ['-p', path.join(built, 'cassie-extension.zip'), 'cassie-extension/manifest.json'], { encoding: 'utf8' })).version;
  expect(zipped === extver, `the built zip is version ${zipped}, the extension is ${extver}`);
  expect(JSON.parse(fs.readFileSync(path.join(built, 'extension-version.json'), 'utf8')).version === extver, 'extension-version.json has the extension’s version');
  const site = fs.readFileSync(path.join(built, 'index.html'), 'utf8');
  expect(site.includes('Version ' + extver), 'the built page shows Version ' + extver);
  // a computer: the button is in the header, just before Open Cassie, on one line at 1024, 1280 and 1440
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(APP.replace('app.html', 'index.html'));
  const head = page.locator('.nav a[data-ext]');
  expect(await head.count() === 1 && await head.isVisible(), 'the extension button is in the header');
  expect((await page.locator('[data-ext-version]').innerText()).trim() === 'Version ' + extver, 'Version ' + extver + ' under the button');
  expect(await page.locator('.final a[data-ext]').count() === 0, 'the last section has no extension button');
  expect(await page.locator('details a[data-ext]').count() === 1, 'the FAQ still has its link');
  for (const width of [1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    const g = await page.evaluate(() => {
      const ext = document.querySelector('.nav a[data-ext]').getBoundingClientRect();
      const open = document.querySelector('.nav a[href="start.html"]').getBoundingClientRect();
      const nav = document.querySelector('.nav'); const n = nav.getBoundingClientRect();
      const kids = [...nav.querySelectorAll('a, .btn')].filter((e) => e.offsetParent).map((e) => e.getBoundingClientRect());
      return { gap: open.left - ext.right, same: Math.abs((ext.top + ext.bottom) / 2 - (open.top + open.bottom) / 2), over: nav.scrollWidth > nav.clientWidth + 1 || kids.some((r) => r.right > innerWidth || r.left < 0), page: document.documentElement.scrollWidth > innerWidth, extH: ext.height, openH: open.height };
    });
    expect(g.gap >= 0 && g.gap <= 24 && g.same < 6, `${width}: the button sits just before Open Cassie: ` + JSON.stringify(g));
    expect(!g.over, `${width}: the header doesn’t wrap or overflow: ` + JSON.stringify(g));
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  expect(errors.length === 0, 'page errors: ' + errors.join('; '));
  // the tap test on the header (a mouse; its own watcher, not the page's errors)
  const { tapResponseIssues } = require('./ui-checks.cjs');
  ctx.on('page', (p) => { if (p !== page) p.close().catch(() => {}); });
  const reopen = async () => { await page.goto(APP.replace('app.html', 'index.html')); return page; };
  const issues = await tapResponseIssues(page, { reopen, touch: false, scope: '.nav', settle: true });
  expect(!issues.length, 'the header’s controls answer a tap: ' + JSON.stringify(issues).slice(0, 600));
  await ctx.close();
  // a touch screen wide enough for it: 44px tall; a phone: no extension button
  const tab = await b.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
  const tp = await tab.newPage(); await tp.goto(APP.replace('app.html', 'index.html'));
  const hs = await tp.evaluate(() => [...document.querySelectorAll('.nav .btn')].filter((e) => e.offsetParent).map((e) => Math.round(e.getBoundingClientRect().height)));
  expect(hs.length >= 2 && hs.every((h) => h >= 44), 'header buttons are 44px tall on a touch screen: ' + hs);
  await tab.close();
  const phone = await b.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const pp = await phone.newPage(); await pp.goto(APP.replace('app.html', 'index.html'));
  expect(!(await pp.locator('.nav a[data-ext]').isVisible()), '390x844: no extension button in the header');
  expect(await pp.locator('.nav a[href="start.html"]').isVisible(), '390x844: Open Cassie is still there');
  await phone.close();
  // the extension: a newer version on the site shows the note in the popup; the same version doesn't
  const ext = path.join(ROOT, 'extension');
  const profile = fs.mkdtempSync(path.join(require('os').tmpdir(), 'cassie-ext-'));
  const ectx = await chromium.launchPersistentContext(profile, {
    headless: true, ...(fs.existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : { channel: 'chromium' }),
    args: ['--headless=new', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  try {
    await ectx.route(/api\.groq\.com|workers\.dev|fonts\.(googleapis|gstatic)\.com|askcassie\.pages\.dev/, (route) => route.abort());
    let sw = null;
    for (let i = 0; i < 80 && !sw; i++) {
      for (const w of ectx.serviceWorkers()) if (/\/background\.js$/.test(w.url()) && await w.evaluate(() => typeof checkForUpdate === 'function').catch(() => false)) { sw = w; break; }
      if (!sw) await new Promise((r) => setTimeout(r, 250));
    }
    expect(sw, 'the Cassie extension did not start');
    const id = new URL(sw.url()).host;
    // the site's file, faked: what the worker asks for is recorded (one request, nothing in it)
    const fake = async (version) => sw.evaluate(async (v) => {
      self.__asked = []; await chrome.storage.local.remove('cassieUpdate');
      self.CASSIE_UPDATE_URL = 'https://askcassie.pages.dev/extension-version.json';
      self.fetch = (u, o) => { self.__asked.push({ u: String(u), body: o && o.body, credentials: o && o.credentials }); return Promise.resolve(new Response(JSON.stringify({ version: v }), { headers: { 'content-type': 'application/json' } })); };
    }, version);
    const popup = async () => { const p = await ectx.newPage(); await p.goto(`chrome-extension://${id}/popup.html`); await p.waitForTimeout(700); return p; };
    const [maj, min] = extver.split('.').map(Number);
    await fake(`${maj}.${min + 1}.0`);
    let p = await popup();
    expect(await p.locator('#update-note').isVisible(), 'a newer version on the site: the popup says so');
    const note = await p.locator('#update-note').innerText();
    expect(/A new version of Cassie is ready\. Download it, then press Reload on Cassie in chrome:\/\/extensions\./.test(note) && !/[—–]/.test(note), 'the note: ' + note);
    expect(/^https:\/\/askcassie\.study\/cassie-extension\.zip/.test(await p.locator('#update-get').getAttribute('href')), 'Download goes to the zip on the site');
    expect((await p.locator('#update-get').boundingBox()).height >= 44, 'Download is 44px tall');
    let asked = await sw.evaluate(() => self.__asked);
    expect(asked.length === 1 && /\/extension-version\.json$/.test(asked[0].u) && !asked[0].body && asked[0].credentials === 'omit', 'one request for the file, nothing sent: ' + JSON.stringify(asked));
    await p.close();
    // a second open the same day asks nothing
    p = await popup(); asked = await sw.evaluate(() => self.__asked);
    expect(asked.length === 1, 'at most once a day: ' + asked.length + ' requests');
    await p.close();
    await fake(extver);
    p = await popup();
    expect(!(await p.locator('#update-note').isVisible()), 'the same version: no note');
    await p.close();
  } finally { await ectx.close(); fs.rmSync(profile, { recursive: true, force: true }); }
});

test('the extension comes from the browser store in one click (no download): every link goes to the store, Edge, Opera and Brave are named, Firefox is told it is coming, and a store copy never asks to download an update', async (b) => {
  const STORE = 'https://chromewebstore.google.com/detail/hnafgijhojdheggkcjliffbgpdhikbpj';
  // no page links to the zip any more
  for (const f of ['index.html', 'app.html', 'support.html', 'tour.js']) expect(!/href="cassie-extension\.zip/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')), f + ' still links to the zip download');
  const UA = {
    chrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
    edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
    opera: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 OPR/125.0.0.0',
    firefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0) Gecko/20100101 Firefox/144.0',
  };
  const want = { chrome: ['Add to Chrome', STORE], edge: ['Add to Edge', STORE], opera: ['Add to Opera', STORE], firefox: ['Coming to Firefox', 'support.html#firefox'] };
  for (const [who, ua] of Object.entries(UA)) {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, userAgent: ua, serviceWorkers: 'block' });
    const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(APP.replace('app.html', 'index.html'));
    const got = await page.evaluate(() => [...document.querySelectorAll('a[data-ext]')].map((a) => ({ t: a.textContent.trim(), h: a.getAttribute('href'), d: a.hasAttribute('download') })));
    expect(got.length >= 3 && got.every((l) => l.h === want[who][1] && !l.d), who + ': every extension link goes to ' + want[who][1] + ': ' + JSON.stringify(got));
    expect(got.filter((l) => l.t === want[who][0]).length === 2, who + ': the header and the FAQ say ' + want[who][0] + ': ' + JSON.stringify(got));
    expect(!errors.length, who + ': page errors: ' + errors.join('; '));
    await ctx.close();
  }
  // the app's sidebar names the browser too
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, userAgent: UA.edge, serviceWorkers: 'block' });
  const page = await ctx.newPage(); await page.goto(APP);
  const side = await page.evaluate(() => { const a = document.querySelector('a.side-ext'); return a && { t: a.querySelector('b').textContent, h: a.getAttribute('href'), d: a.hasAttribute('download') }; });
  expect(side && side.t === 'Cassie for Edge' && side.h === STORE && !side.d, 'the sidebar: ' + JSON.stringify(side));
  await ctx.close();
  // a copy from a store (its manifest has an update_url): a newer version on the site shows no Download note
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'cassie-store-'));
  fs.cpSync(path.join(ROOT, 'extension'), tmp, { recursive: true });
  const man = JSON.parse(fs.readFileSync(path.join(tmp, 'manifest.json'), 'utf8')); man.update_url = 'https://clients2.google.com/service/update2/crx';
  fs.writeFileSync(path.join(tmp, 'manifest.json'), JSON.stringify(man));
  const profile = fs.mkdtempSync(path.join(require('os').tmpdir(), 'cassie-ext-'));
  const ectx = await chromium.launchPersistentContext(profile, {
    headless: true, ...(fs.existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : { channel: 'chromium' }),
    args: ['--headless=new', `--disable-extensions-except=${tmp}`, `--load-extension=${tmp}`],
  });
  try {
    await ectx.route(/api\.groq\.com|workers\.dev|fonts\.(googleapis|gstatic)\.com|askcassie\.pages\.dev/, (route) => route.abort());
    let sw = null;
    for (let i = 0; i < 80 && !sw; i++) {
      for (const w of ectx.serviceWorkers()) if (/\/background\.js$/.test(w.url()) && await w.evaluate(() => typeof checkForUpdate === 'function').catch(() => false)) { sw = w; break; }
      if (!sw) await new Promise((r) => setTimeout(r, 250));
    }
    expect(sw, 'the Cassie extension did not start');
    await sw.evaluate(async () => { await chrome.storage.local.remove('cassieUpdate'); self.CASSIE_UPDATE_URL = 'https://askcassie.pages.dev/extension-version.json'; self.fetch = () => Promise.resolve(new Response(JSON.stringify({ version: '99.0.0' }), { headers: { 'content-type': 'application/json' } })); });
    const p = await ectx.newPage(); await p.goto(`chrome-extension://${new URL(sw.url()).host}/popup.html`); await p.waitForTimeout(700);
    expect(!(await p.locator('#update-note').isVisible()), 'a store copy: no Download note (the store updates it)');
  } finally { await ectx.close(); fs.rmSync(profile, { recursive: true, force: true }); fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('no key: Cassie answers through the server', async (b) => {
  await serverMode({ groq: 'ok', ai: 'ok', reply: '' });
  const { ctx, page, errors } = await open(b);
  const a = await ask(page, 'What is photosynthesis?');
  expect(/Hello from the server/.test(await a.textContent()), 'no server answer: ' + await a.textContent());
  expect(errors.length === 0, 'page errors: ' + errors.join('; '));
  await ctx.close();
});

test('server backup brain answers when Groq is down', async (b) => {
  await serverMode({ groq: 'down', ai: 'ok' });
  const { ctx, page } = await open(b);
  const a = await ask(page, 'Explain gravity');
  expect(/Backup brain/.test(await a.textContent()), 'no backup answer: ' + await a.textContent());
  await serverMode({ groq: 'ok' });
  await ctx.close();
});

test('free questions: only what the student asks counts (file sections and helpers don’t), and the limit says so', async (b) => {
  await serverMode({ groq: 'ok', ai: 'ok', dailyAll: 50, freeQuestions: 3 });
  const { ctx, page } = await open(b);
  try {
    const call = (q) => page.evaluate(async ([srv, qq]) => { const r = await fetch(srv + '/chat', { method: 'POST', body: JSON.stringify({ uid: installId(), q: qq ? 1 : undefined, messages: [{ role: 'user', content: 'hi' }] }) }); return [r.status, r.headers.get('x-cassie-left')]; }, [SERVER, q]);
    for (let i = 0; i < 6; i++) expect((await call(false))[0] === 200, 'a file section / helper call is not a question');
    for (let i = 0; i < 3; i++) { const [st, left] = await call(true); expect(st === 200 && +left === 2 - i, `question ${i + 1}: ${st} left ${left}`); }
    expect((await call(true))[0] === 429, 'the 4th question is over the limit');
    expect((await call(false))[0] === 200, 'helpers still work after the questions run out');
    const a = await ask(page, 'One more question');
    expect(/3 free questions/.test(await a.textContent()), 'the message says how many: ' + await a.textContent());
  } finally { await serverMode({ dailyAll: null, freeQuestions: null }); await fetch(`${SERVER}/__reset`); await ctx.close(); }
});

test('out of free questions: Cassie offers the Pasado Pass early list right there (signed out with an email, signed in in one tap), and the owner sees the list', async (b) => {
  await serverMode({ groq: 'ok', ai: 'ok' });
  const { ctx, page, errors } = await open(b);
  try {
    await page.evaluate(async (srv) => {
      for (let i = 0; i < 5; i++) await fetch(srv + '/chat', { method: 'POST', body: JSON.stringify({ uid: installId(), messages: [{ role: 'user', content: 'hi' }] }) });
    }, SERVER);
    const a = await ask(page, 'One more question');
    const t = await a.textContent();
    expect(/free questions/.test(t) && /Pasado Pass/.test(t) && /own free Groq key/.test(t), 'the daily-limit message: ' + t);
    expect(await a.locator('.early-chip').count() === 1 && await a.locator('.retry-btn').count() === 0, 'the way to keep going, and no Try again (it would only fail until midnight)');
    await a.locator('.early-chip').click();
    await page.waitForSelector('.plus-sheet .plus-join');
    expect(/More questions today/.test(await page.locator('.plus-sheet h3').innerText()), 'the sheet says what it is for');
    if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/limit-offer.png' });
    expect(await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('plus-join')), 'the join button has focus');
    await page.click('.plus-sheet .plus-join');
    await page.waitForSelector('.plus-sheet .plus-early:not([hidden]) input');
    await page.fill('.plus-sheet .plus-early input', 'juan@mailinator.com');
    await page.click('.plus-sheet .plus-join');
    await page.waitForSelector('.plus-sheet .plus-err:not([hidden])');
    expect(/email/i.test(await page.locator('.plus-sheet .plus-err').innerText()), 'a throwaway email is refused, with why');
    const mail = `early${Date.now()}@example.com`;
    await page.fill('.plus-sheet .plus-early input', mail);
    await page.press('.plus-sheet .plus-early input', 'Enter');
    await page.waitForSelector('.plus-sheet .plus-done');
    expect((await page.locator('.plus-sheet .plus-done').innerText()).includes(mail), 'it says who Cassie will email');
    // next time the sheet remembers
    await page.click('.plus-sheet .plus-ok');
    await page.evaluate(() => plusSheet('The 3D human body'));
    expect(await page.locator('.plus-sheet .plus-done').count() === 1 && await page.locator('.plus-sheet .plus-join').count() === 0, 'already on the list: no button again');
    await page.click('.plus-sheet .plus-ok');
    // signed in: the account's email, no typing
    const acct = `earlyacct${Date.now()}@example.com`;
    const joined = await page.evaluate(async ([srv, em]) => {
      const su = await (await fetch(srv + '/auth/signup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: em, password: 'secret-pass-1', age: 17 }) })).json();
      const r = await fetch(srv + '/early', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + su.token }, body: JSON.stringify({ src: 'plus' }) });
      return [r.status, await r.json()];
    }, [SERVER, acct]);
    expect(joined[0] === 200 && joined[1].email === acct, 'signed in joins in one tap: ' + JSON.stringify(joined));
    const list = await (await fetch(SERVER + '/admin/early', { headers: { authorization: 'Bearer test-admin-token-0123456789' } })).json();
    const mine = (list.list || []).filter((r) => r.email === mail || r.email === acct).map((r) => r.email + ':' + r.src).sort();
    expect(mine.join() === [acct + ':plus', mail + ':limit'].sort().join(), 'the owner sees both, and where they joined: ' + JSON.stringify(mine));
    expect((await fetch(SERVER + '/admin/early')).status === 401, 'the list needs the owner password');
    expect(!errors.length, 'page errors: ' + errors.join('; '));
  } finally { await fetch(`${SERVER}/__reset`); await ctx.close(); }
});

test('no Student / Professional switch at the top (phone and computer); a switch flipped to Professional before is undone, and only a Working professional profile gets the work-style answers; no doodle wallpaper behind the chat', async (b) => {
  for (const [device, viewport] of [['iPhone 13', { width: 390, height: 844 }], ['Desktop Chrome', { width: 1280, height: 800 }]]) {
    const { ctx, page, groqCalls } = await open(b, { device, viewport, server: false, state: { groqKey: 'gsk_test', audience: 'pro', profile: { name: 'Mika', role: 'student', grade: 'Grade 10', age: 16, at: 1 } }, fakeGroq: () => ({ text: 'Hi!' }) });
    expect(await page.locator('#aud-switch, [data-aud], .aud-switch').count() === 0, `${viewport.width}: the switch is gone`);
    expect(await page.evaluate(() => state.audience) === 'student', `${viewport.width}: the old Professional choice is undone`);
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/topbar-${viewport.width}.png`, clip: { x: 0, y: 0, width: viewport.width, height: 90 } });
    await ask(page, 'hello');
    expect(!/working professional/.test(groqCalls.at(-1).messages[0].content), `${viewport.width}: a student gets study answers`);
    expect(await page.locator('#aud-bg, .pat').count() === 0, 'the doodle wallpaper is gone (Apple: branding defers to content)');
    expect(await page.locator('.rate-row, .beta-tag').count() === 0, 'thumbs or Beta still showing');
    await ctx.close();
  }
  // a Working professional profile still gets the colleague style
  const { ctx, page, groqCalls } = await open(b, { server: false, state: { groqKey: 'gsk_test', profile: { name: 'Ana', role: 'pro', grade: '', age: 30, at: 1 } }, fakeGroq: () => ({ text: 'Hi!' }) });
  await ask(page, 'hello');
  expect(/working professional/.test(groqCalls.at(-1).messages[0].content) && await page.evaluate(() => state.audience) === 'pro', 'Working professional: the work-style answers');
  await ctx.close();
});

test('Report a problem from Settings', async (b) => {
  const { ctx, page } = await open(b);
  await tapSettings(page);
  await page.click('#report-btn');
  await page.fill('.profile-card textarea', 'The board did not open on my phone');
  await page.click('.profile-card .pf-go');
  await page.waitForSelector('text=Thank you!');
  const d = await serverStats();
  expect(d.reports.some((r) => r.kind === 'report' && /board did not open/.test(r.text)), 'report missing');
  await ctx.close();
});

test('usage counts reach the dashboard', async (b) => {
  const { ctx, page } = await open(b);
  await ask(page, 'Teach me fractions');
  await page.evaluate(() => flushTrack());
  await page.waitForTimeout(500);
  const d = await serverStats();
  expect(d.totals.users >= 1 && d.features.some((f) => f.name === 'chat'), 'no usage recorded: ' + JSON.stringify(d.features));
  await ctx.close();
});

test('own Groq key answers directly', async (b) => {
  const { ctx, page, groqCalls } = await open(b, { server: false, state: { groqKey: 'gsk_test' } });
  const a = await ask(page, 'What is 2 + 2?');
  expect(/Own-key answer/.test(await a.textContent()), 'no own-key answer');
  expect(groqCalls.length === 1, 'expected one Groq call, got ' + groqCalls.length);
  await ctx.close();
});

test('own key out of questions → the server takes over', async (b) => {
  const { ctx, page } = await open(b, {
    state: { groqKey: 'gsk_test' },
    fakeGroq: () => ({ status: 429, message: 'Rate limit reached for tokens per day. Please try again in 3h20m.', headers: { 'retry-after': '12000' } }),
  });
  const a = await ask(page, 'What is a noun?');
  expect(/Hello from the server/.test(await a.textContent()), 'server did not take over: ' + await a.textContent());
  await ctx.close();
});

test('an error offers Try again, and it works', async (b) => {
  let fail = true;
  const { ctx, page } = await open(b, { server: false, state: { groqKey: 'gsk_test' }, fakeGroq: () => (fail ? { status: 500, message: 'Internal error' } : { text: 'Worked this time.' }) });
  const a = await ask(page, 'Why is the sky blue?');
  expect(await a.locator('.retry-btn').count() === 1, 'no Try again: ' + await a.textContent());
  fail = false;
  await a.locator('.retry-btn').click();
  await page.waitForSelector('text=Worked this time.', { timeout: 10000 });
  const users = await page.locator('#chat-log .bubble-user').count();
  expect(users === 1, 'question was duplicated: ' + users);
  await ctx.close();
});

test('graph request draws on the board', async (b) => {
  const { ctx, page } = await open(b, { server: false, state: { groqKey: 'gsk_test' }, fakeGroq: () => ({ text: 'Here is the graph of the parabola. It crosses the x-axis at -2 and 2.' }) });
  const a = await ask(page, 'graph y = x^2 - 4');
  expect(await a.locator('.cassie-board canvas').count() >= 1, 'no board canvas');
  await ctx.close();
});

test('picture request makes a real picture, not ASCII art', async (b) => {
  const { ctx, page } = await open(b, { server: false, state: { groqKey: 'gsk_test' } });
  const a = await ask(page, 'can you make me a picture of a red apple');
  await page.waitForSelector('#chat-log img', { timeout: 10000 });
  const src = await page.locator('#chat-log img').last().getAttribute('src');
  expect(/pollinations|^data:|^blob:/.test(src || ''), 'unexpected image src: ' + src);
  expect(!/```/.test(await a.textContent()), 'ASCII art in reply');
  // asked like a photographer would: camera, lens, light, and what to avoid; no glossy buzzwords
  const words = decodeURIComponent(src || '');
  expect(/real photograph of a red apple/i.test(words) && /\d+mm f\/[\d.]+ lens/.test(words) && /Avoid: CGI/.test(words), 'not a photographic prompt: ' + words.slice(0, 300));
  expect(!/hyperrealistic|photorealistic|stunning|4k|8k|masterpiece/i.test(words) && !/enhance=true/.test(words), 'buzzwords or the enhancer in a photo prompt: ' + words.slice(0, 300));
  // a style the student asks for, and a labelled diagram, are not turned into photos
  const kinds = await page.evaluate(() => [imageKind('a cartoon cat'), imageKind('a labeled diagram of a plant cell'), imageKind('a plant cell under a microscope'), picturePrompt('a plant cell under a microscope')]);
  expect(kinds[0] === 'art' && kinds[1] === 'diagram' && kinds[2] === 'photo' && /micrograph/.test(kinds[3]), 'wrong picture kinds: ' + kinds.join(' | '));
  // no people unless the student asks for them; when they do, everyone is modestly dressed
  expect(/No people, no faces/.test(words), 'an apple picture says no people: ' + words.slice(0, 400));
  const ppl = await page.evaluate(() => [picturePrompt('farmers planting rice'), picturePrompt('a cartoon volcano'), picturePrompt('a labeled diagram of the heart')]);
  expect(/modestly dressed/.test(ppl[0]) && !/No people/.test(ppl[0]) && /No people/.test(ppl[1]) && /No people/.test(ppl[2]), 'safety words: ' + ppl.join(' | '));
  await ctx.close();
});

test('“a photo of the answer” saves Cassie’s answer as a picture — the picture maker never gets “the answer” as words', async (b) => {
  const { ctx, page } = await open(b, { server: false, device: 'Desktop Chrome', state: { groqKey: 'gsk_test' }, fakeGroq: () => ({ text: '**Answer: No, this map is not 2-colorable.** Three regions meet at one point, so there is a circuit of 3 (an odd number).' }) });
  const made = [];
  await ctx.route(/pollinations\.ai/, (route) => { made.push(route.request().url()); return route.fulfill({ body: PNG, contentType: 'image/png' }); });
  await ask(page, 'Is a map where three regions meet at one point 2-colorable?');
  await page.fill('#prompt-input', 'generate a photo of the answer');
  await page.press('#prompt-input', 'Enter');
  await page.waitForSelector('#chat-log .bubble img.chat-img[src^="data:image/png"]', { timeout: 15000 });
  if (process.env.SHOTS) { const src = await page.locator('#chat-log .bubble img.chat-img').last().getAttribute('src'); require('fs').writeFileSync(process.env.SHOTS + '/answer-picture.png', Buffer.from(src.split(',')[1], 'base64')); }
  const last = await page.locator('#chat-log .bubble').last().innerText();
  expect(/my answer as a picture/i.test(last) && /Download image/.test(last), 'the answer picture: ' + last);
  expect(made.length === 0, 'the picture maker was not asked: ' + made.join(' '));
  // "a picture of it" pictures what we talked about, never the word "it"
  const subj = await page.evaluate(() => [ANSWER_SUBJECT_RE.test('your answer'), ANSWER_SUBJECT_RE.test('the solution'), PRONOUN_SUBJECT_RE.test('it'), ANSWER_SUBJECT_RE.test('a volcano')]);
  expect(subj.join() === 'true,true,true,false', 'subject words: ' + subj.join());
  await ctx.close();
});

test('picture: when the free service fails, the server makes it', async (b) => {
  await serverMode({ ai: 'ok' });
  const { ctx, page } = await open(b);
  await ctx.route(/pollinations\.ai/, (route) => route.abort()); // the free service is down
  await page.fill('#prompt-input', 'generate a detailed picture of a futuristic city at night with flying cars and neon signs');
  await page.press('#prompt-input', 'Enter');
  await page.waitForSelector('#chat-log img[src^="data:image"]', { timeout: 30000 });
  const m = await serverMode({});
  expect(/futuristic city/.test(m.lastImagePrompt || '') && /24mm/.test(m.lastImagePrompt), 'server did not get the photographic prompt: ' + m.lastImagePrompt);
  await ctx.close();
});

test('flashcards: Cassie makes cards from an answer, spaced-repetition study, mistakes → cards, Anki export', async (b) => {
  const ANSWER = 'Photosynthesis is how plants make food. Chlorophyll in the chloroplasts captures sunlight. Water and carbon dioxide become glucose, and oxygen is released as a by-product of the light reactions.';
  const CARDS = JSON.stringify([{ front: 'Where does photosynthesis happen?', back: 'In the chloroplasts.' }, { front: 'What does chlorophyll do?', back: 'It captures sunlight.' }, { front: 'What gas is released?', back: 'Oxygen.' }]);
  const { ctx, page, errors, groqCalls } = await open(b, { server: false, state: { groqKey: 'gsk_test', mistakes: [{ q: 'What is the powerhouse of the cell?', a: 'mitochondria', at: 1, due: 1, misses: 1 }] },
    fakeGroq: (body) => ({ text: /Make flashcards/.test(JSON.stringify(body)) ? 'Here you go:\n' + CARDS : ANSWER }) });
  const a = await ask(page, 'Explain photosynthesis');
  await a.locator('.fc-make').click();
  await page.waitForFunction(() => /3 cards: Study/.test(document.querySelector('.fc-make').textContent), null, { timeout: 10000 });
  expect(/Use only what the text says/.test(JSON.stringify(groqCalls.at(-1))) && /Chlorophyll/.test(JSON.stringify(groqCalls.at(-1))), 'Cassie makes the cards from that answer');
  // study: the first card's front, flip, then grade
  await a.locator('.fc-make').click();
  await page.waitForSelector('.fc:not([hidden]) .fc-card', { timeout: 3000 });
  expect(/Where does photosynthesis happen/.test(await page.locator('.fc-card').innerText()), 'the question shows first');
  if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/flashcard-front.png' });
  await page.click('.fc-card');
  expect(/chloroplasts/.test(await page.locator('.fc-card').innerText()), 'tapping shows the answer');
  expect(/1 d/.test(await page.locator('.fc-grade.good').innerText()), 'Good says when it comes back');
  if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/flashcard-back.png' });
  await page.click('.fc-grade.good');
  await page.click('.fc-card'); await page.click('.fc-grade.again');   // missed: comes back this session
  await page.click('.fc-card'); await page.keyboard.press('4');        // easy, with the keyboard
  // the missed card is back
  expect(/What does chlorophyll do/.test(await page.locator('.fc-card').innerText()), 'a card marked Again comes back in the same session');
  await page.click('.fc-card'); await page.click('.fc-grade.good');
  await page.waitForSelector('.fc-done', { timeout: 3000 });
  const cards = await page.evaluate(() => JSON.parse(localStorage.getItem('cassie.v2')).cards);
  expect(cards.length === 3 && cards.every((c) => c.due > Date.now()), 'every card is scheduled for later: ' + JSON.stringify(cards.map((c) => [c.box, c.due - Date.now()])));
  // mistakes → cards, and the deck list
  await page.click('.fc-back');
  await page.click('[data-mistakes]');
  await page.waitForSelector('.fc-note >> text=added to “My quiz mistakes”');
  expect(await page.locator('.fc-decks li').count() === 2, 'two decks');
  if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/flashcard-decks.png' });
  // export for Anki: a tab-separated file with the deck in its header
  await page.locator('.fc-decks li', { hasText: 'My quiz mistakes' }).locator('summary').click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('.fc-decks li', { hasText: 'My quiz mistakes' }).locator('[data-anki]').click()]);
  const txt = fs.readFileSync(await dl.path(), 'utf8');
  expect(/#separator:tab/.test(txt) && /#deck:My quiz mistakes/.test(txt) && /powerhouse of the cell\?\tmitochondria/.test(txt), 'Anki file: ' + txt);
  // the home screen shows cards that are due
  await page.click('.fc-x');
  await page.evaluate(() => document.getElementById('new-chat-btn').click());
  await page.waitForSelector('.study-cards >> text=Flashcards to review (1)', { timeout: 3000 });
  expect(errors.length === 0, 'page errors: ' + errors.join('; '));
  await ctx.close();
});

test('study room: two students draw on the same board, live (code, link, undo only your own)', async (b) => {
  const A = await open(b, { device: 'Desktop Chrome', state: { profile: { ...PROFILE, name: 'Ana Reyes' } } });
  const B = await open(b, { device: 'Desktop Chrome', state: { profile: { ...PROFILE, name: 'Ben Cruz' } } });
  const draw = async (page, x0, y0) => {
    const box = await page.locator('.csk-live').boundingBox();
    await page.mouse.move(box.x + box.width * x0, box.y + box.height * y0); await page.mouse.down();
    await page.mouse.move(box.x + box.width * (x0 + 0.2), box.y + box.height * (y0 + 0.1), { steps: 6 }); await page.mouse.up();
  };
  const count = (page) => page.evaluate(() => window.CassieSketch.session().strokeCount());
  try {
    // Ana opens the board and starts a room
    await A.page.click('#board-btn');
    await A.page.click('.csk-btn:has-text("Study together")');
    await A.page.click('[data-room="new"]');
    await A.page.waitForSelector('.csk-room:not([hidden]) b', { timeout: 10000 });
    const code = await A.page.locator('.csk-room b').innerText();
    expect(/^[A-Z0-9]{6}$/.test(code), 'a 6-letter room code: ' + code);
    // Ben opens the invite link
    await B.page.goto(APP + '?room=' + code);
    await B.page.waitForSelector('.csk-room:not([hidden]) b', { timeout: 10000 });
    await A.page.waitForFunction(() => /Ben/.test(document.querySelector('.csk-who').textContent) && /Ana \(you\)/.test(document.querySelector('.csk-who').textContent), null, { timeout: 10000 });
    // Ana draws → Ben sees it
    await draw(A.page, 0.2, 0.3);
    await B.page.waitForFunction(() => window.CassieSketch.session().strokeCount() === 1, null, { timeout: 8000 });
    // Ben draws → Ana sees both
    await draw(B.page, 0.5, 0.6);
    await A.page.waitForFunction(() => window.CassieSketch.session().strokeCount() === 2, null, { timeout: 8000 });
    if (process.env.SHOTS) await A.page.screenshot({ path: process.env.SHOTS + '/study-room.png' });
    // a hidden tab checks the room every 15 s (not every 4), and checks at once when it's back
    const polls = []; B.page.on('request', (r) => { if (/\/room\/poll/.test(r.url())) polls.push(Date.now()); });
    const hide = (h) => B.page.evaluate((h) => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => h }); document.dispatchEvent(new Event('visibilitychange')); }, h);
    await hide(true); await B.page.waitForTimeout(1500); polls.length = 0;
    await B.page.waitForTimeout(5000);
    expect(polls.length === 0, 'a hidden tab didn’t check the room for 5 s: ' + polls.length);
    await hide(false); await B.page.waitForTimeout(600);
    expect(polls.length >= 1, 'back to the tab: it checks at once');
    // Ben's undo takes away only Ben's stroke, for everyone
    await B.page.click('[data-act="undo"]');
    await A.page.waitForFunction(() => window.CassieSketch.session().strokeCount() === 1, null, { timeout: 8000 });
    expect(await count(B.page) === 1, 'Ana’s stroke stays on Ben’s board');
    // clear only clears your own
    B.page.once('dialog', (d) => d.accept());
    await draw(B.page, 0.6, 0.2);
    await A.page.waitForFunction(() => window.CassieSketch.session().strokeCount() === 2, null, { timeout: 8000 });
    await B.page.click('[data-act="clear"]');
    await A.page.waitForFunction(() => window.CassieSketch.session().strokeCount() === 1, null, { timeout: 8000 });
    // someone who joins later gets the whole board
    const C = await open(b, { device: 'Desktop Chrome', state: { profile: { ...PROFILE, name: 'Cara' } } });
    await C.page.goto(APP + '?room=' + code);
    await C.page.waitForFunction(() => window.CassieSketch && window.CassieSketch.session() && window.CassieSketch.session().strokeCount() === 1, null, { timeout: 10000 });
    await C.ctx.close();
    // a wrong code is explained
    await A.page.click('[data-act="close"]');
    await A.page.evaluate(() => openRoomChooser());
    await A.page.fill('.room-join input', 'ZZZZZZ');
    await A.page.click('.room-join button');
    await A.page.waitForSelector('.room-err:not([hidden]) >> text=There’s no room with that code. Rooms last one day', { timeout: 5000 });
    expect(A.errors.length === 0 && B.errors.length === 0, 'page errors: ' + A.errors.concat(B.errors).join('; '));
  } finally { await A.ctx.close(); await B.ctx.close(); }
});

test('study room: studying together — chat, Cassie for everyone, shared flashcards (kept in your own after), a group quiz, notes (kept as a chat after), a timer', async (b) => {
  const QUIZ = JSON.stringify([{ q: 'What makes ATP?', o: ['Mitochondria', 'Ribosome', 'Nucleus', 'Golgi'], a: 0, why: 'Mitochondria release energy as ATP.' }, { q: 'Where is DNA kept?', o: ['Vacuole', 'Nucleus', 'Wall', 'Membrane'], a: 1, why: 'The nucleus holds the DNA.' }]);
  const fake = (body) => ({ text: /multiple-choice quiz/.test(JSON.stringify(body.messages)) ? QUIZ : 'Plants make glucose from light, water and carbon dioxide.' });
  const cards = [{ id: 'c1', f: 'Powerhouse of the cell?', b: 'Mitochondria', deck: 'Biology', box: 0, due: 0, at: 0 }, { id: 'c2', f: 'Where is DNA?', b: 'Nucleus', deck: 'Biology', box: 0, due: 0, at: 0 }];
  const A = await open(b, { device: 'Desktop Chrome', fakeGroq: fake, state: { groqKey: 'gsk_test', cards, profile: { ...PROFILE, name: 'Ana Reyes' } } });
  const B = await open(b, { device: 'Desktop Chrome', fakeGroq: fake, state: { groqKey: 'gsk_test', profile: { ...PROFILE, name: 'Ben Cruz' } } });
  try {
    await A.page.click('#board-btn');
    await A.page.click('.csk-btn:has-text("Study together")');
    await A.page.click('[data-room="new"]');
    await A.page.waitForSelector('.csk-room:not([hidden]) b', { timeout: 10000 });
    const code = await A.page.locator('.csk-room b').innerText();
    await B.page.goto(APP + '?room=' + code);
    await B.page.waitForSelector('[data-room-act="study"]', { timeout: 10000 });
    await A.page.waitForFunction(() => /Ben/.test(document.querySelector('.csk-who').textContent), null, { timeout: 10000 });
    // chat
    await A.page.click('[data-room-act="study"]');
    await A.page.fill('.sr-foot .sr-in', 'Hi Ben! Ready for bio?');
    await A.page.click('.sr-foot [data-act="send"]');
    await B.page.waitForFunction(() => /Study together \(1\)/.test(document.querySelector('[data-room-act="study"]').textContent), null, { timeout: 8000 });
    await B.page.click('[data-room-act="study"]');
    await B.page.waitForSelector('.sr-msg >> text=Hi Ben! Ready for bio?', { timeout: 5000 });
    expect(/Ana/.test(await B.page.locator('.sr-msg b').first().innerText()), 'Ben sees who wrote it');
    // Cassie answers for everyone
    await A.page.fill('.sr-foot .sr-in', 'What is photosynthesis?');
    await A.page.click('.sr-foot [data-act="ask"]');
    await B.page.waitForSelector('.sr-share >> text=Plants make glucose', { timeout: 10000 });
    if (process.env.SHOTS) await B.page.screenshot({ path: process.env.SHOTS + '/study-chat.png' });
    expect(/Ana asked Cassie for everyone/.test(await B.page.locator('.sr-share small').innerText()), 'Ben sees Ana asked Cassie');
    // shared flashcards: Ana shares, Ben flips, both mark
    await A.page.click('.sr-tabs [data-tab="cards"]');
    await A.page.click('[data-share-deck="0"]');
    await B.page.click('.sr-tabs [data-tab="cards"]');
    await B.page.waitForSelector('.sr-card >> text=Powerhouse of the cell?', { timeout: 8000 });
    await B.page.click('.sr-card');
    await A.page.waitForSelector('.sr-card .sr-ans >> text=Mitochondria', { timeout: 8000 });
    if (process.env.SHOTS) await A.page.screenshot({ path: process.env.SHOTS + '/study-cards.png' });
    await A.page.click('[data-act="got"]');
    await B.page.click('[data-act="miss"]');
    await A.page.waitForFunction(() => /Ana ✓/.test(document.querySelector('.sr-body').textContent) && /Ben ✗/.test(document.querySelector('.sr-body').textContent), null, { timeout: 8000 });
    await B.page.click('[data-act="next"]');
    await A.page.waitForSelector('.sr-card >> text=Where is DNA?', { timeout: 8000 });
    // Ben keeps the deck: the room ends after a day, the cards stay in his own flashcards
    await B.page.click('[data-act="keepdeck"]');
    await B.page.waitForSelector('[data-act="keepdeck"] >> text=Saved 2 cards to “Biology”', { timeout: 4000 });
    expect(await B.page.evaluate(() => (state.cards || []).filter((c) => c.deck === 'Biology').map((c) => c.f).sort().join('|')) === 'Powerhouse of the cell?|Where is DNA?', 'the deck is in Ben’s flashcards');
    // a group quiz with a score board
    await B.page.click('.sr-tabs [data-tab="quiz"]');
    await B.page.fill('.sr-foot .sr-in', 'cells');
    await B.page.click('.sr-foot [data-act="quiz"]');
    await A.page.click('.sr-tabs [data-tab="quiz"]');
    await A.page.waitForSelector('.sr-q >> text=What makes ATP?', { timeout: 10000 });
    await A.page.click('[data-ans="0|0"]'); await A.page.click('[data-ans="1|1"]');
    await B.page.waitForSelector('.sr-q >> text=What makes ATP?', { timeout: 5000 });
    await B.page.click('[data-ans="0|2"]');
    await B.page.waitForFunction(() => { const t = (document.querySelector('.sr-board') || {}).textContent || ''; return /Ana\s*2 \/ 2/.test(t) && /You\s*0 \/ 2/.test(t); }, null, { timeout: 8000 });
    expect(await B.page.locator('[data-ans="0|0"].right').count() === 1 && await B.page.locator('[data-ans="0|2"].wrong').count() === 1, 'Ben sees the right answer and his wrong pick');
    if (process.env.SHOTS) await B.page.screenshot({ path: process.env.SHOTS + '/study-quiz.png' });
    // notes, and only your own can be removed
    await A.page.click('.sr-tabs [data-tab="notes"]');
    await A.page.fill('.sr-foot .sr-in', 'Source: OpenStax Biology ch. 7');
    await A.page.click('.sr-foot [data-act="note"]');
    await B.page.click('.sr-tabs [data-tab="notes"]');
    await B.page.waitForSelector('.sr-note >> text=OpenStax', { timeout: 8000 });
    expect(await B.page.locator('.sr-note button:not(.sr-btn)').count() === 0, 'Ben can’t remove Ana’s note');
    // Ben keeps the notes too: a chat of his own
    await B.page.click('[data-act="keepnotes"]');
    await B.page.waitForSelector('[data-act="keepnotes"] >> text=Saved to your chats', { timeout: 4000 });
    const kept = await B.page.evaluate((c) => { const ch = state.chats.find((x) => x.title === 'Study room notes · ' + c); return ch && ch.messages[0].content; }, code);
    expect(kept && /OpenStax Biology ch\. 7/.test(kept) && /Ana/.test(kept), 'the notes are in Ben’s chats: ' + kept);
    if (process.env.SHOTS) await B.page.screenshot({ path: process.env.SHOTS + '/study-keep-notes.png' });
    // a focus timer for everyone
    await A.page.click('.sr-head [data-act="timer"]');
    await B.page.waitForFunction(() => /⏱ (25|24):/.test(document.querySelector('.sr-tm').textContent), null, { timeout: 8000 });
    // someone joining late sees it all
    const C = await open(b, { device: 'Desktop Chrome', state: { profile: { ...PROFILE, name: 'Cara' } } });
    await C.page.goto(APP + '?room=' + code);
    await C.page.waitForSelector('[data-room-act="study"]', { timeout: 10000 });
    await C.page.click('[data-room-act="study"]');
    await C.page.waitForSelector('.sr-share >> text=Plants make glucose', { timeout: 10000 });
    await C.ctx.close();
    expect(await A.page.locator('.sr-warn').isHidden(), 'the server takes study steps');
    expect(A.errors.length === 0 && B.errors.length === 0, 'page errors: ' + A.errors.concat(B.errors).join('; '));
  } finally { await A.ctx.close(); await B.ctx.close(); }
});

test('board room: sticky notes, flashcards on the board, live cursors with names, a laser, quick shapes, Cassie checks the board for everyone', async (b) => {
  const fake = () => ({ text: 'Step 2 is right; in step 3 you dropped a minus sign.' });
  const A = await open(b, { device: 'Desktop Chrome', fakeGroq: fake, state: { groqKey: 'gsk_test', profile: { ...PROFILE, name: 'Ana Reyes' } } });
  const B = await open(b, { device: 'Desktop Chrome', fakeGroq: fake, state: { groqKey: 'gsk_test', profile: { ...PROFILE, name: 'Ben Cruz' } } });
  const at = async (page, fx, fy) => { const box = await page.locator('.csk-live').boundingBox(); return [box.x + box.width * fx, box.y + box.height * fy]; };
  const objs = (page) => page.evaluate(() => window.CassieSketch.session().objects());
  try {
    await A.page.click('#board-btn');
    await A.page.click('.csk-btn:has-text("Study together")');
    await A.page.click('[data-room="new"]');
    await A.page.waitForSelector('.csk-room:not([hidden]) b', { timeout: 10000 });
    const code = await A.page.locator('.csk-room b').innerText();
    await B.page.goto(APP + '?room=' + code);
    await B.page.waitForSelector('.csk-room:not([hidden]) b', { timeout: 10000 });
    await A.page.waitForFunction(() => /Ben/.test(document.querySelector('.csk-who').textContent), null, { timeout: 10000 });
    // Ana adds a pink sticky note — Ben sees it with her name on it
    await A.page.click('[data-tool="note"]');
    await A.page.click('.csk-pop [data-pop="nc"][title="Pink"]');
    await A.page.mouse.click(...(await at(A.page, 0.25, 0.3)));
    await A.page.waitForSelector('.csk-notebox');
    await A.page.keyboard.type('Thesis: sleep helps memory');
    await A.page.keyboard.press('Enter');
    await B.page.waitForFunction(() => { const o = window.CassieSketch.session().objects(); return o.length === 1 && o[0].tool === 'note' && /sleep helps memory/.test(o[0].text) && o[0].n === 'Ana' && o[0].color === '#ffc9de'; }, null, { timeout: 8000 });
    // Ana's pointer shows on Ben's board with her name, and what she's doing
    for (let i = 0; i < 6; i++) { await A.page.mouse.move(...(await at(A.page, 0.5 + i * 0.03, 0.6))); await A.page.waitForTimeout(80); }
    await B.page.waitForSelector('.csk-cur:not([hidden]) >> text=Ana', { timeout: 8000 });
    await A.page.click('[data-tool="pen"]');
    await A.page.mouse.move(...(await at(A.page, 0.55, 0.7))); await A.page.mouse.down();
    let sawDrawing = false;
    for (let i = 0; i < 24 && !sawDrawing; i++) {
      await A.page.mouse.move(...(await at(A.page, 0.55 + i * 0.008, 0.7 + (i % 2) * 0.01)));
      await A.page.waitForTimeout(90);
      sawDrawing = await B.page.evaluate(() => [...document.querySelectorAll('.csk-cur span')].some((s) => /Ana · drawing/.test(s.textContent)));
    }
    await A.page.mouse.up();
    if (!sawDrawing) await B.page.waitForFunction(() => [...document.querySelectorAll('.csk-cur span')].some((s) => /Ana · drawing/.test(s.textContent)), null, { timeout: 5000 });
    // Ben's laser shows on Ana's board, then fades away by itself
    await B.page.click('[data-tool="laser"]');
    await B.page.mouse.move(...(await at(B.page, 0.3, 0.75))); await B.page.mouse.down();
    for (let i = 0; i < 10; i++) { await B.page.mouse.move(...(await at(B.page, 0.3 + i * 0.03, 0.75))); await B.page.waitForTimeout(40); }
    await B.page.mouse.up();
    const lit = (want) => { const c = document.querySelector('.csk-fx'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let on = false; for (let i = 3; i < d.length && !on; i += 4 * 7) if (d[i] > 40) on = true; return on === want; };
    await A.page.waitForFunction(lit, true, { timeout: 8000, polling: 50 });
    expect(await B.page.evaluate(() => window.CassieSketch.session().strokeCount()) === 2, 'the laser isn’t saved on the board');
    await A.page.waitForFunction(lit, false, { timeout: 6000 });
    // Ben drops two flashcards on the board
    await B.page.click('[data-act="cards"]');
    await B.page.fill('.csk-pop textarea', 'Osmosis – water moving across a membrane\nMitosis: one cell splitting into two identical cells');
    await B.page.click('.csk-pop [data-pop="drop"]');
    await A.page.waitForFunction(() => window.CassieSketch.session().objects().filter((o) => o.tool === 'card').length === 2, null, { timeout: 8000 });
    // Ana flips one (Move tool, tap) and drags the other — Ben sees both
    await A.page.click('[data-tool="select"]');
    const cards = (await objs(A.page)).filter((o) => o.tool === 'card');
    const on = (page, x, y) => page.evaluate((p) => window.CassieSketch.session().screenOf(p), [x, y]);
    const c0 = cards[0], c1 = cards[1];
    await A.page.mouse.click(...(await on(A.page, c0.x + c0.w / 2, c0.y + c0.h / 2)));
    await B.page.waitForFunction((id) => window.CassieSketch.session().objects().find((o) => o.id === id).flip === true, c0.id, { timeout: 8000 });
    await A.page.mouse.move(...(await on(A.page, c1.x + 20, c1.y + 20))); await A.page.mouse.down();
    const to = await on(A.page, c1.x + 20, c1.y + 220); await A.page.mouse.move(to[0], to[1], { steps: 8 }); await A.page.mouse.up();
    await B.page.waitForFunction(([id, y]) => Math.abs(window.CassieSketch.session().objects().find((o) => o.id === id).y - y) < 4, [c1.id, c1.y + 200], { timeout: 8000 });
    if (process.env.SHOTS) await A.page.screenshot({ path: process.env.SHOTS + '/board-room-tools.png' });
    // Ben can move Ana's note but can't throw it away
    await B.page.click('[data-tool="select"]');
    const note = (await objs(B.page)).find((o) => o.tool === 'note');
    await B.page.mouse.click(...(await on(B.page, note.x + 30, note.y + 30)));
    await B.page.keyboard.press('Delete');
    await B.page.waitForTimeout(1500);
    expect((await objs(A.page)).some((o) => o.tool === 'note'), 'Ana’s note stays');
    // a quick shape: a Venn diagram where Ana taps
    await A.page.click('[data-act="shapes"]');
    await A.page.click('.csk-pop [data-k="venn2"]');
    await A.page.mouse.click(...(await at(A.page, 0.7, 0.5)));
    await B.page.waitForFunction(() => window.CassieSketch.session().strokeCount() === 5, null, { timeout: 8000 });
    // Ana asks Cassie to check the board: everyone sees the answer
    await A.page.click('[data-room-act="check"]');
    await A.page.waitForSelector('.csk-note >> text=dropped a minus sign', { timeout: 10000 });
    await B.page.waitForSelector('.csk-note >> text=Ana asked Cassie to check the board', { timeout: 10000 });
    expect(/dropped a minus sign/.test(await B.page.locator('.csk-note').innerText()), 'Ben sees Cassie’s answer');
    const sent = JSON.stringify(A.groqCalls.at(-1).messages);
    expect(/sticky note \(Ana\): Thesis: sleep helps memory/.test(sent) && /flashcard: Osmosis → water moving/.test(sent), 'Cassie is told what the notes and cards say');
    expect(A.errors.length === 0 && B.errors.length === 0, 'page errors: ' + A.errors.concat(B.errors).join('; '));
  } finally { await A.ctx.close(); await B.ctx.close(); }
});

test('board: Cassie writes flashcards for it, notes sort into colour groups, and it saves as PNG, PDF and a board file that opens again', async (b) => {
  const fake = (body) => ({ text: /flashcards about/.test(JSON.stringify(body.messages)) ? JSON.stringify([{ f: 'What is evaporation?', b: 'Water turning into vapour.' }, { f: 'What is condensation?', b: 'Vapour turning back into droplets.' }, { f: 'What is precipitation?', b: 'Water falling as rain or snow.' }]) : 'ok' });
  const { ctx, page, errors } = await open(b, { device: 'Desktop Chrome', fakeGroq: fake, state: { groqKey: 'gsk_test' } });
  const at = async (fx, fy) => { const box = await page.locator('.csk-live').boundingBox(); return [box.x + box.width * fx, box.y + box.height * fy]; };
  const note = async (title, fx, fy, text) => {
    await page.click('[data-tool="note"]');
    if (!(await page.locator('.csk-pop').count())) await page.click('[data-tool="note"]');
    await page.click(`.csk-pop [data-pop="nc"][title="${title}"]`);
    await page.mouse.click(...(await at(fx, fy)));
    await page.waitForSelector('.csk-notebox');
    await page.keyboard.type(text); await page.keyboard.press('Enter');
  };
  await page.click('#board-btn');
  await page.click('[data-act="cards"]');
  await page.fill('.csk-pop .csk-topic', 'the water cycle');
  await page.click('.csk-pop [data-pop="make"]');
  await page.waitForFunction(() => window.CassieSketch.session().objects().filter((o) => o.tool === 'card').length === 3, null, { timeout: 20000 }); // (Cassie's reply is slower when the machine is busy)
  expect(await page.locator('[data-tool="select"].on').count() === 1, 'the Move tool is picked so the cards can be flipped');
  // with the pen on, dragging a card moves it — it doesn't draw on the board
  await page.click('[data-tool="pen"]');
  const card = (await page.evaluate(() => window.CassieSketch.session().objects()))[0];
  const on = (x, y) => page.evaluate((p) => window.CassieSketch.session().screenOf(p), [x, y]);
  await page.mouse.move(...(await on(card.x + 30, card.y + 30))); await page.mouse.down();
  const to = await on(card.x + 30, card.y + 130); await page.mouse.move(to[0], to[1], { steps: 8 }); await page.mouse.up();
  const moved = (await page.evaluate(() => window.CassieSketch.session().objects())).find((o) => o.id === card.id);
  expect(Math.abs(moved.y - card.y - 100) < 3 && await page.evaluate(() => window.CassieSketch.session().strokeCount()) === 3, 'the card moved and nothing was drawn: ' + (moved.y - card.y));
  // and a tool that's on switches off when tapped again (back to Move)
  await page.click('[data-tool="pen"]');
  expect(await page.locator('[data-tool="select"].on').count() === 1 && await page.locator('[data-tool="pen"].on').count() === 0, 'tapping the pen again switches it off');
  // notes in two colours, mixed up — then sorted into a column per colour
  await note('Yellow', 0.1, 0.12, 'Intro');
  await note('Green', 0.9, 0.85, 'Method');
  await note('Yellow', 0.5, 0.88, 'Background');
  await page.click('[data-tool="note"]');
  if (!(await page.locator('.csk-pop').count())) await page.click('[data-tool="note"]');
  await page.click('.csk-pop [data-pop="tidy"]');
  const ns = (await page.evaluate(() => window.CassieSketch.session().objects())).filter((o) => o.tool === 'note');
  const yel = ns.filter((n) => n.color === '#fff1a6'), grn = ns.filter((n) => n.color === '#c8f0c4');
  expect(yel.length === 2 && grn.length === 1 && yel[0].x === yel[1].x && grn[0].x > yel[0].x && yel[0].y !== yel[1].y, 'yellow notes stack in one column, green beside them: ' + JSON.stringify(ns.map((n) => [n.color, n.x, n.y])));
  // the coordinate grid, logic gates and flowchart drop in
  for (const k of ['grid', 'gates', 'flow']) { await page.click('[data-act="shapes"]'); await page.click(`.csk-pop [data-k="${k}"]`); await page.mouse.click(...(await at(0.5, 0.5))); }
  if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/board-tools.png' });
  const before = await page.evaluate(() => window.CassieSketch.session().strokeCount());
  // save: a picture, a PDF, and a board file
  const save = async (k) => { await page.click('[data-act="save"]'); const [dl] = await Promise.all([page.waitForEvent('download'), page.click(`.csk-pop [data-pop="${k}"]`)]); return fs.readFileSync(await dl.path()); };
  const png = await save('png'), pdf = await save('pdf'), json = await save('json');
  expect(png.slice(1, 4).toString() === 'PNG', 'a PNG');
  expect(pdf.slice(0, 5).toString() === '%PDF-' && /\/DCTDecode/.test(pdf.toString('latin1')) && /%%EOF\s*$/.test(pdf.toString('latin1')), 'a PDF with the board in it');
  const data = JSON.parse(json.toString());
  expect(data.cassie === 'board' && data.strokes.length === before && data.strokes.some((s) => s.tool === 'card' && /evaporation/.test(s.f)), 'the board file has everything');
  // start over, then open the file again
  page.once('dialog', (d) => d.accept());
  await page.click('[data-act="clear"]');
  await page.waitForFunction(() => window.CassieSketch.session().strokeCount() === 0);
  const file = path.join(require('os').tmpdir(), 'cassie-board-test.json'); fs.writeFileSync(file, json);
  await page.click('[data-act="save"]');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('.csk-pop [data-pop="open"]')]);
  await chooser.setFiles(file);
  await page.waitForFunction((n) => window.CassieSketch.session().strokeCount() === n, before, { timeout: 5000 });
  expect((await page.evaluate(() => window.CassieSketch.session().objects())).filter((o) => o.tool === 'note').length === 3, 'notes are back');
  expect(errors.length === 0, 'page errors: ' + errors.join('; '));
  await ctx.close();
});

test('an exam plan from Home: the form makes the plan and closes by itself, and the whole plan opens only with its button', async (b) => {
  const fakeGroq = (body) => {
    const t = JSON.stringify(body);
    if (!/day by day study plan/.test(t)) return { text: 'Hi!' };
    const [, from] = t.match(/Plan these days: (\d{4}-\d{2}-\d{2}) to/);
    return { text: JSON.stringify({ days: [{ date: from, tasks: [{ kind: 'learn', topic: 'Stoichiometry' }, { kind: 'quiz', topic: 'Stoichiometry' }] }] }) };
  };
  const { ctx, page, errors, groqCalls } = await open(b, { device: 'iPhone 13', scale: 1, server: false, lite: 'off', state: { profile: null, groqKey: 'gsk_test', tab: 'home', plan: null }, fakeGroq });
  const date = await page.evaluate(() => dayAdd(phDay(), 6));
  await page.waitForSelector('.fr-start', { timeout: 8000 }); await page.click('.fr-start');
  if (await page.locator('.auth-skip').count()) await page.click('.auth-skip');
  await onboard(page, { name: 'Mika', who: 'shs' });
  await page.evaluate(() => openExamSheet());
  await page.fill('.ex-sheet input[name=name]', 'Gen Chem finals'); await page.fill('.ex-sheet input[name=date]', date); await page.fill('.ex-sheet textarea[name=topics]', 'Stoichiometry, gas laws');
  await page.click('.ex-sheet .ex-make');
  await page.waitForFunction(() => (state.exams || []).length === 1, null, { timeout: 10000 });
  const asked = groqCalls.filter((c) => /day by day study plan/.test(JSON.stringify(c)));
  expect(asked.length === 1 && /Gen Chem finals/.test(JSON.stringify(asked[0])) && /Stoichiometry, gas laws/.test(JSON.stringify(asked[0])), 'Cassie was asked for the plan with what was typed');
  expect(!(await page.locator('.ex-sheet').count()), 'the form closed by itself once the plan was made');
  await page.waitForSelector('#home .hub .ex-plan', { timeout: 10000 });
  // the whole plan: hidden until its button, then shown
  const days = page.locator('#home .hub .ex-plan .ex-days');
  expect(!(await days.isVisible()), 'the whole plan is hidden at first');
  await page.click('#home .hub .ex-plan .ex-all');
  expect(await days.isVisible(), 'See the whole plan shows it');
  expect(!errors.length, 'page errors: ' + errors.join('; '));
  await ctx.close();
});

test('a new exam plan: the card says Your Exam Plan with the subject and topics, then See my exam plan goes to the plan (phone: from the Chat tab; computer: from a chat); the sidebar Menu is a pill with an arrow that opens the tools', async (b) => {
  const fakeGroq = (body) => {
    const t = JSON.stringify(body);
    if (!/day by day study plan/.test(t)) return { text: 'Hi!' };
    const [, from] = t.match(/Plan these days: (\d{4}-\d{2}-\d{2}) to/);
    return { text: JSON.stringify({ days: [{ date: from, tasks: [{ kind: 'learn', topic: 'Stoichiometry' }, { kind: 'quiz', topic: 'Gas laws' }] }] }) };
  };
  const inView = (page, sel) => page.evaluate((s) => { const e = [...document.querySelectorAll(s)].find((x) => x.offsetParent); const r = e && e.getBoundingClientRect(); return !!r && r.height > 0 && r.top < innerHeight && r.bottom > 0; }, sel);
  for (const [device, viewport, where] of [['iPhone 13', { width: 390, height: 844 }, '#home .hub .ex-plan'], ['Desktop Chrome', { width: 1280, height: 800 }, '#chat-log .ex-plan']]) {
    const phone = viewport.width < 700;
    const { ctx, page, errors } = await open(b, { device, viewport, scale: 1, server: false, lite: 'off', state: { profile: null, groqKey: 'gsk_test', tab: 'home', plan: null }, fakeGroq });
    const date = await page.evaluate(() => dayAdd(phDay(), 6));
    await page.waitForSelector('.fr-start', { timeout: 8000 }); await page.click('.fr-start');
    if (await page.locator('.auth-skip').count()) await page.click('.auth-skip');
    await onboard(page, { name: 'Mika', who: 'shs' });
    await page.evaluate((d) => openExamSheet({ name: 'Gen Chem finals', date: d, topics: 'Stoichiometry, gas laws', auto: true, then: (e) => { window.madePlan = e; } }), date);
    await page.waitForFunction(() => (state.exams || []).length === 1 && window.madePlan, null, { timeout: 10000 });
    // the card: Your Exam Plan, then what subject and what topics (a computer: Home lists the plan, Study plan has the card)
    if (!phone) { await page.evaluate(() => deskGo('home')); await page.waitForSelector('#chat-log .dk-plans .dk-row', { timeout: 10000 }); expect(await page.locator('#chat-log .dk-plans .dk-row b').first().innerText() === 'Gen Chem finals', 'Home lists the new plan'); await page.evaluate(() => deskGo('plan')); }
    const card = page.locator(where).first();
    await card.waitFor({ timeout: 10000 });
    const head = await card.locator('.ex-head').innerText();
    if (!phone) await page.evaluate(() => deskGo('home'));
    expect(/^Your Exam Plan\b/.test(head) && /Subject:\s*Gen Chem finals/.test(head) && /Topics:\s*Stoichiometry, gas laws/.test(head), `${viewport.width}: the card says Your Exam Plan, the subject and the topics: ` + head);
    await page.evaluate(() => examReadySheet(window.madePlan));
    await page.waitForSelector('.ex-ready-sheet', { timeout: 5000 });
    const sheet = await page.locator('.ex-ready-sheet').innerText();
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/exam-ready-${viewport.width}.png` });
    expect(/Your Exam Plan is ready/.test(sheet) && /Subject:\s*Gen Chem finals/.test(sheet) && /Topics:\s*Stoichiometry, gas laws/.test(sheet) && /Exam day:/.test(sheet), `${viewport.width}: after the tour, the plan with its subject, day and topics: ` + sheet);
    // somewhere else, then See my exam plan brings the plan back into view
    if (phone) await page.evaluate(() => window.CassieNative.go('chat'));
    else await page.evaluate(() => { state.messages.push({ role: 'user', content: 'hi' }, { role: 'assistant', content: 'Hello!' }); save(); renderHistory(); });
    expect(!(await inView(page, where)), `${viewport.width}: the plan is out of sight first`);
    await page.click('.ex-ready-sheet .exr-see');
    await page.waitForFunction((s) => { const e = [...document.querySelectorAll(s)].find((x) => x.offsetParent); const r = e && e.getBoundingClientRect(); return !!r && r.top < innerHeight && r.bottom > 0; }, where, { timeout: 5000 });
    expect(!(await page.locator('.ex-ready-sheet').count()), `${viewport.width}: the prompt closed`);
    if (process.env.SHOTS) { await page.waitForTimeout(600); await page.screenshot({ path: `${process.env.SHOTS}/exam-card-${viewport.width}.png` }); }
    // the sidebar Menu: a pill (round ends, a visible edge) with an arrow, and it opens the tools (a computer: Menu is the pages above it, so the pill says Study tools)
    if (phone) { await page.evaluate(() => window.CassieNative.go('chat')); await page.tap('#menu-btn'); await page.waitForFunction(() => document.getElementById('sidebar').classList.contains('open'), null, { timeout: 2000 }); await page.waitForTimeout(300); }
    else if (!(await page.evaluate(() => document.body.classList.contains('side-open')))) { await page.click('#side-toggle'); await page.waitForTimeout(350); }
    const pill = await page.evaluate(() => {
      const m = document.getElementById('side-menu-toggle'), cs = getComputedStyle(m), r = m.getBoundingClientRect(), svg = m.querySelector('svg');
      return { h: r.height, w: r.width, side: document.getElementById('sidebar').getBoundingClientRect().width, radius: parseFloat(cs.borderTopLeftRadius), border: parseFloat(cs.borderTopWidth), bg: cs.backgroundColor, arrow: !!svg && getComputedStyle(svg).display !== 'none' && svg.getBoundingClientRect().width > 0, text: m.innerText.trim() };
    });
    expect(pill.radius >= pill.h / 2 - 1 && pill.border >= 1 && pill.bg !== 'rgba(0, 0, 0, 0)' && pill.arrow && pill.w < pill.side * 0.6 && (phone ? /^menu$/i : /^study tools$/i).test(pill.text), `${viewport.width}: Menu is an oval pill with an arrow: ` + JSON.stringify(pill));
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/menu-pill-${viewport.width}.png` });
    await page.click('#side-menu-toggle');
    expect(await page.locator('#side-menu-toggle').getAttribute('aria-expanded') === 'true' && await page.locator('#side-tools .side-tool').first().isVisible(), `${viewport.width}: the pill opens the tools`);
    expect(!errors.length, 'page errors: ' + errors.join('; '));
    await ctx.close();
  }
});

test('exam plans from notes: Free can use notes once (the plan is made from the notes, with no topics typed); after that, notes are Plus', async (b) => {
  const fakeGroq = (body) => {
    const t = JSON.stringify(body);
    if (!/day by day study plan/.test(t)) return { text: 'Hi!' };
    const [, from] = t.match(/Plan these days: (\d{4}-\d{2}-\d{2}) to/);
    return { text: JSON.stringify({ days: [{ date: from, tasks: [{ kind: 'learn', topic: 'Photosynthesis' }, { kind: 'quiz', topic: 'Cell respiration' }] }] }) };
  };
  const notes = path.join(require('os').tmpdir(), 'bio-notes.txt');
  fs.writeFileSync(notes, 'Biology finals reviewer\nLesson 1: Photosynthesis. Light reactions in the thylakoid make ATP and NADPH.\nLesson 2: Cell respiration. Glycolysis, the Krebs cycle and the electron transport chain.');
  const { ctx, page, errors, groqCalls } = await open(b, { device: 'iPhone 13', scale: 1, server: false, lite: 'off', state: { profile: null, groqKey: 'gsk_test', tab: 'home', plan: null }, fakeGroq });
  const date = await page.evaluate(() => dayAdd(phDay(), 5));
  await page.waitForSelector('.fr-start', { timeout: 8000 }); await page.click('.fr-start');
  if (await page.locator('.auth-skip').count()) await page.click('.auth-skip');
  await onboard(page, { name: 'Bea' });
  await page.evaluate(() => openExamSheet());
  expect(await page.locator('.ex-sheet .ex-file-btn').innerText() === 'Use my notes (free once)', 'Free: notes, once');
  await page.fill('.ex-sheet input[name=name]', 'Bio finals'); await page.fill('.ex-sheet input[name=date]', date);
  await page.click('.ex-sheet .ex-file-btn').catch(() => {});
  await page.setInputFiles('.ex-sheet .ex-file input', notes);
  await page.waitForSelector('.ex-sheet .ex-file-name >> text=bio-notes.txt', { timeout: 8000 });
  await page.click('.ex-sheet .ex-make');
  await page.waitForFunction(() => (state.exams || []).length === 1, null, { timeout: 10000 });
  const asked = JSON.stringify(groqCalls.filter((c) => /day by day study plan/.test(JSON.stringify(c))));
  expect(/Bio finals/.test(asked) && /the topics in the notes below/.test(asked) && /Krebs cycle/.test(asked), 'Cassie planned from the notes');
  expect(await page.evaluate(() => state.freeNotesPlan === true), 'Free’s one plan from notes is used');
  // the next plan: notes are Plus
  await page.evaluate(() => { state.exams = []; save(); openExamSheet(); });
  expect(await page.locator('.ex-sheet .ex-file-btn').innerText() === 'Use my notes (Plus)', 'after the free one, notes say Plus');
  await page.click('.ex-sheet .ex-file-btn');
  await page.waitForSelector('.plus-sheet', { timeout: 3000 });
  expect(!errors.length, 'page errors: ' + errors.join('; '));
  await ctx.close();
});

test('Taglish and named exams: a question in Taglish is sent with the rule to answer in Taglish (chat and files), and the pricing names real exams and says you can ask in Taglish', async (b) => {
  const { ctx, page, errors, groqCalls } = await open(b, { server: false, state: { groqKey: 'gsk_test' }, fakeGroq: () => ({ text: 'Ang **mole** ay 6.02 × 10^23 particles.' }) });
  await ask(page, 'Ano ba yung mole sa chem? Di ko gets yung concept');
  const sys = groqCalls.at(-1).messages[0].content;
  expect(/Taglish \(English and Filipino mixed\) gets natural Taglish/.test(sys) && /technical terms in English/.test(sys), 'the chat prompt says to answer in Taglish when asked in Taglish');
  const doc = await page.evaluate(() => leanDocSystem());
  expect(/Taglish/.test(doc), 'the file prompt says it too');
  await page.goto(APP.replace('app.html', 'index.html'));
  const pricing = await page.locator('#pricing').innerText();
  expect(/name your exam, like Gen Chem finals, Pre-Calc, the NLE or the LET/i.test(pricing), 'the pricing names real exams: ' + pricing.slice(0, 300));
  expect(/Ready on exam day, for Gen Chem, Pre-Calc, the NLE, the LET or any exam you name/.test(pricing), 'Plus names them too');
  expect(/Ask in Taglish, Filipino or English/.test(pricing), 'Free says you can ask in Taglish');
  expect(!/[–—]/.test(pricing), 'no long dashes');
  expect(!errors.length, 'page errors: ' + errors.join('; '));
  await ctx.close();
});

test('exam readiness: practice quiz answers on a plan’s topics show how ready you are (a topic not yet practised counts as 0), from an exam task’s quiz and from Quiz me with a topic typed', async (b) => {
  const { ctx, page, errors } = await open(b, { device: 'iPhone 13', scale: 1, lite: 'off', server: false, state: { groqKey: 'gsk_test', tab: 'home', plan: null, chats: [{ id: 'h1', title: 'Moles', messages: [{ role: 'user', content: 'What is a mole?' }, { role: 'assistant', content: 'A count.' }], updatedAt: Date.now() }] } });
  const hub = '#home .hub';
  await page.waitForSelector(`${hub} .ex-new`, { timeout: 10000 });
  const card = async () => { await page.evaluate(() => refreshHub()); return page.locator(`${hub} .ex-plan`).first(); };
  await page.evaluate(() => {
    const today = phDay();
    state.exams = [{ id: 'exA', name: 'Gen Chem finals', date: dayAdd(today, 5), topics: 'Stoichiometry, gas laws', from: today, at: Date.now(), stats: {},
      days: [{ date: today, tasks: [{ kind: 'learn', topic: 'Stoichiometry' }, { kind: 'quiz', topic: 'Stoichiometry' }] }, { date: dayAdd(today, 1), tasks: [{ kind: 'quiz', topic: 'Gas laws' }, { kind: 'mistakes', topic: '' }] }] }];
    save();
  });
  expect(await (await card()).locator('.ex-ready').count() === 0, 'nothing practised yet: no readiness line');
  // the exam task's quiz: 3 right of 4 on Stoichiometry, Gas laws not yet practised
  await page.evaluate(() => { quizStarted('Stoichiometry'); captureQuizMarks('[[GOT: q1 || a]] [[GOT: q2 || a]] [[MISSED: q3 || a]] [[GOT: q4 || a]]'); });
  let c = await card();
  expect(/^38% ready/.test(await c.locator('.ex-ready-row').innerText()) && /1 of 2 topics practised/.test(await c.locator('.ex-ready').innerText()), '75% on one topic of two: 38% ready: ' + await c.locator('.ex-ready').innerText());
  expect(await c.locator('.ex-bar').getAttribute('aria-valuenow') === '38', 'the bar says 38');
  // Quiz me with "gas laws" typed: it counts for the plan's Gas laws
  await page.evaluate(() => { quizStarted('gas laws'); captureQuizMarks('[[GOT: g1 || a]] [[GOT: g2 || a]]'); });
  c = await card();
  expect(/^88% ready/.test(await c.locator('.ex-ready-row').innerText()) && /2 of 2 topics practised/.test(await c.locator('.ex-ready').innerText()) && /not a promise about the grade/.test(await c.locator('.ex-ready').innerText()), '(75 + 100) / 2: ' + await c.locator('.ex-ready').innerText());
  // a quiz on something else doesn't count
  await page.evaluate(() => { quizStarted('Photosynthesis'); captureQuizMarks('[[MISSED: p1 || a]]'); });
  expect(/^88% ready/.test(await (await card()).locator('.ex-ready-row').innerText()), 'another subject’s quiz leaves it as it was');
  expect(!/[\u2013\u2014]/.test(await page.locator(hub).innerText()) && !errors.length, 'no dashes, no page errors: ' + errors.join('; '));
  await ctx.close();
});

test('exam plans: Cassie makes a dated day by day plan, today’s tasks open their feature and stay ticked after a reload, a missed day moves on (never more than 3 a day), Free keeps 1 plan and Plus 5, a bad reply shows Try again, and the plan closes with a summary', async (b) => {
  // Cassie's plan, faked from what she was asked: the days she was given, a few tasks a day, plus some junk to leave out
  let broken = false;
  const fakeGroq = (body) => {
    const t = JSON.stringify(body);
    if (!/day by day study plan/.test(t)) return { text: 'Question 1: What is a mole?' };
    if (broken) return { text: 'Sorry, here is a plan: day one study hard.' };
    const [, from, last] = t.match(/Plan these days: (\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})/);
    const days = [];
    for (let d = new Date(from + 'T00:00:00Z'), k = 0; d.toISOString().slice(0, 10) <= last; d.setUTCDate(d.getUTCDate() + 1), k++) {
      const date = d.toISOString().slice(0, 10);
      days.push({ date, tasks: k === 0
        ? [{ kind: 'learn', topic: 'Stoichiometry' }, { kind: 'quiz', topic: 'Stoichiometry' }, { kind: 'cards', topic: 'Stoichiometry' }, { kind: 'focus', topic: 'Moles' }, { kind: 'dance', topic: 'x' }]
        : [{ kind: k % 2 ? 'mistakes' : 'quiz', topic: 'Gas laws' }] });
    }
    days.push({ date: '1999-01-01', tasks: [{ kind: 'quiz', topic: 'Too early' }] });
    return { text: '```json\n' + JSON.stringify({ days }) + '\n```' };
  };
  const seed = { groqKey: 'gsk_test', tab: 'home', plan: null, chats: [{ id: 'h1', title: 'Moles', messages: [{ role: 'user', content: 'What is a mole?' }, { role: 'assistant', content: 'A count.' }], updatedAt: Date.now() }] };
  const { ctx, page, errors, groqCalls } = await open(b, { device: 'iPhone 13', scale: 1, lite: 'off', server: false, state: seed, fakeGroq });
  page.on('dialog', (d) => d.accept().catch(() => {}));
  const hub = '#home .hub';
  await page.waitForSelector(`${hub} .ex-new`, { timeout: 10000 });
  const today = await page.evaluate(() => phDay()), inDays = (n) => page.evaluate(([d, n]) => dayAdd(d, n), [today, n]);
  // the form checks each field in plain words
  await page.click(`${hub} .ex-new`);
  await page.waitForSelector('.ex-sheet .ex-form');
  for (const sel of ['.ex-field input[name=name]', '.ex-field input[name=date]', '.ex-field textarea', '.ex-make', '.ex-cancel', '.ex-file-btn']) { const bb = await page.locator('.ex-sheet ' + sel).boundingBox(); expect(bb && bb.height >= 44, `${sel} is 44px: ` + JSON.stringify(bb)); }
  await page.click('.ex-make');
  const errs = await page.locator('.ex-sheet .field-err:not([hidden])').allInnerTexts();
  expect(errs.includes(await page.evaluate(() => CassieErrors.say('exam_name_needed'))) && errs.includes(await page.evaluate(() => CassieErrors.say('exam_date_needed'))), 'empty fields say what to do: ' + errs.join(' | '));
  // Plans from your notes are Plus (once Free's one from notes is used)
  await page.evaluate(() => { state.freeNotesPlan = true; });
  await page.click('.ex-file-btn');
  await page.waitForSelector('.plus-sheet');
  expect(/Plans from your notes comes with Plus/.test(await page.locator('.plus-sheet h3').innerText()), 'a plan from a file is a Plus extra');
  await page.click('.plus-sheet .plus-ok');
  // a bad reply: the error in plain words, with Try again (and the form stays filled)
  broken = true;
  await page.fill('.ex-sheet input[name=name]', 'Gen Chem finals');
  await page.fill('.ex-sheet input[name=date]', await inDays(5));
  await page.fill('.ex-sheet textarea', 'Stoichiometry, gas laws');
  await page.click('.ex-make');
  await page.waitForSelector('.ex-sheet .ex-again', { timeout: 10000 });
  expect((await page.locator('.ex-sheet .ex-status').innerText()).includes(await page.evaluate(() => CassieErrors.say('exam_plan_failed'))), 'a bad plan says so with Try again');
  expect((await page.locator('.ex-again').boundingBox()).height >= 44, 'Try again is 44px');
  broken = false;
  await page.click('.ex-again');
  await page.waitForSelector(`${hub} .ex-plan`, { timeout: 10000 });
  const asked = groqCalls.filter((c) => /day by day study plan/.test(JSON.stringify(c)));
  expect(asked.length === 2 && /Exam: \\"Gen Chem finals\\"/.test(JSON.stringify(asked[1])) && /Stoichiometry, gas laws/.test(JSON.stringify(asked[1])), 'Cassie was asked for the plan, with the exam and its topics');
  const plan = await page.evaluate(() => state.exams[0]);
  expect(plan.days[0].date === today && plan.days.at(-1).date === await inDays(4) && plan.days.length === 5, 'the plan runs from today to the day before the exam: ' + plan.days.map((d) => d.date).join(','));
  expect(plan.days.every((d) => d.tasks.length >= 1 && d.tasks.length <= 3) && plan.days.flatMap((d) => d.tasks).every((t) => ['learn', 'quiz', 'cards', 'mistakes', 'focus'].includes(t.kind)), 'every day has 1 to 3 real tasks, junk left out: ' + JSON.stringify(plan.days.map((d) => d.tasks.map((t) => t.kind))));
  expect(plan.days[1].tasks[0].kind === 'focus' && plan.days[1].tasks.length === 2, 'a 4th task on a day moves to the next day: ' + JSON.stringify(plan.days[1].tasks));
  // today's tasks on Home
  const labels = await page.locator(`${hub} .ex-plan .ex-task`).allInnerTexts();
  expect(labels.join('|') === 'Learn Stoichiometry with Cassie|Quiz me on Stoichiometry|10 flashcards on Stoichiometry', 'today’s three tasks: ' + labels.join(' | '));
  for (const sel of ['.ex-check', '.ex-task', '.ex-all', '.ex-del']) { const bb = await page.locator(`${hub} .ex-plan ${sel}`).first().boundingBox(); expect(bb.height >= 44 && bb.width >= 44, `${sel} is 44px: ` + JSON.stringify(bb)); }
  const homeText = await page.locator(hub).innerText();
  expect(!/[—–]/.test(homeText), 'no dashes on Home');
  // tick one; it stays ticked after a reload
  await page.click(`${hub} .ex-plan .ex-check >> nth=0`);
  await page.reload();
  await page.waitForSelector(`${hub} .ex-plan`, { timeout: 10000 });
  expect(await page.locator(`${hub} .ex-plan .ex-check input >> nth=0`).isChecked() && !(await page.locator(`${hub} .ex-plan .ex-check input >> nth=1`).isChecked()), 'the tick is kept after a reload');
  const total = await page.evaluate(() => state.exams[0].days.flatMap((d) => d.tasks).length);
  expect(new RegExp(`1 of ${total} tasks done`).test(await page.locator(`${hub} .ex-head small`).innerText()) && total === 8, 'the plan counts it: ' + await page.locator(`${hub} .ex-head small`).innerText());
  // each task opens its feature: the quiz in the chat, the flashcards
  const n0 = groqCalls.length;
  await page.click(`${hub} .ex-plan .ex-task >> nth=1`);
  await page.waitForFunction((n) => window.__quizAsked || document.querySelector('#quiz-btn.active'), n0, { timeout: 8000 });
  await page.waitForFunction(() => /Quiz me on: Stoichiometry/.test(JSON.stringify(state.messages)), null, { timeout: 8000 });
  await page.evaluate(() => CassieNative.go('home'));
  await page.waitForSelector(`${hub} .ex-plan`);
  await page.click(`${hub} .ex-plan .ex-task >> nth=2`);
  await page.waitForSelector('.fc:not([hidden])', { timeout: 8000 });
  await page.evaluate(() => CassieNative.go('home'));
  // a missed day: its tasks move to the next days, never more than 3 on a day
  const moved = await page.evaluate(([today]) => {
    const t = (k) => ({ id: 'x' + k + Math.random(), kind: 'quiz', topic: 'T' + k, done: false });
    const e = { id: 'm', name: 'Mock', from: dayAdd(today, -2), date: dayAdd(today, 4), days: [
      { date: dayAdd(today, -2), tasks: [t(1), { ...t(2), done: true }] }, { date: dayAdd(today, -1), tasks: [t(3), t(4), t(5)] },
      { date: today, tasks: [t(6), t(7)] }, { date: dayAdd(today, 1), tasks: [t(8), t(9), t(10)] }] };
    reflowExam(e, today);
    return e.days.map((d) => [d.date, d.tasks.map((x) => x.topic)]);
  }, [today]);
  const per = Object.fromEntries(moved);
  expect(per[await inDays(-2)].length === 1 && !per[await inDays(-1)], 'missed days keep only what was done: ' + JSON.stringify(moved));
  expect(Object.values(per).every((x) => x.length <= 3) && per[today].join() === 'T6,T7,T1' && per[await inDays(2)].join() === 'T3,T4,T5', 'missed tasks move to the next days with room (max 3 a day): ' + JSON.stringify(moved));
  // Free keeps one plan: a 2nd shows the Plus sheet, and the plan stays
  await page.click(`${hub} .ex-new`);
  await page.waitForSelector('.plus-sheet');
  expect(/More exam plans comes with Plus/.test(await page.locator('.plus-sheet h3').innerText()) && await page.locator('.ex-sheet').count() === 0, 'Free: a 2nd plan shows the Plus sheet');
  await page.click('.plus-sheet .plus-ok');
  expect(await page.evaluate(() => state.exams.length) === 1, 'Free keeps the plan it has');
  // Plus can make 5
  await page.evaluate(() => { state.plan = { plan: 'plus', until: Date.now() + 30 * 864e5 }; save(); refreshHub(); }); // (30 days: far from its end, so no reminder)
  for (let k = 2; k <= 5; k++) {
    await page.click(`${hub} .ex-new`);
    await page.waitForSelector('.ex-sheet .ex-form');
    await page.fill('.ex-sheet input[name=name]', `Exam ${k}`);
    await page.fill('.ex-sheet input[name=date]', await inDays(3 + k));
    await page.fill('.ex-sheet textarea', 'Gas laws');
    await page.click('.ex-make');
    await page.waitForFunction((k) => state.exams.length === k && !document.querySelector('.ex-sheet'), k, { timeout: 10000 });
  }
  expect(await page.locator(`${hub} .ex-plan`).count() === 5 && await page.locator(`${hub} .ex-new`).count() === 0 && /5 exam plans, the most at once/.test(await page.locator(`${hub} .ex-full`).innerText()), 'Plus: 5 plans, then no more');
  // after the exam: the plan closes with what was done
  await page.evaluate(([d]) => { const e = state.exams[0]; e.date = d; e.stats = { quizzes: 2, fixed: 3 }; save(); refreshHub(); }, [await inDays(-1)]);
  const done = await page.locator(`${hub} .ex-done`).innerText();
  expect(/Gen Chem finals: your plan is done/.test(done) && /Tasks done: 1 of /.test(done) && /Quizzes taken: 2/.test(done) && /Mistakes fixed: 3/.test(done), 'the summary: ' + done);
  await page.click(`${hub} .ex-done .ex-close`);
  expect(await page.evaluate(() => state.exams.length) === 4, 'Close removes the finished plan');
  expect(!errors.length, 'page errors: ' + errors.join('; '));
  await ctx.close();
});

test('your week: real counts after a quiz, a mistake review and a flashcard session, against last week; an empty week shows what to do; it shares as a picture', async (b) => {
  const replies = { quiz: 'Correct!\n[[GOT: What is 2+2? || 4]]\n[[MISSED: What is H2O? || water]]\nQuestion 2: next?', review: 'Yes!\n[[GOT: What is the powerhouse of the cell? || mitochondria]]' };
  const fakeGroq = (body) => { const msgs = (body.messages || []).filter((m) => m.role === 'user'), t = JSON.stringify(msgs.at(-1) || ''); return { text: /review the quiz questions I got wrong/.test(t) ? replies.review : /Quiz me on/.test(t) ? 'Question 1: What is 2+2?' : replies.quiz }; };
  const lastMon = (() => { const d = new Date(Date.now() + 8 * 3600e3); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) - 7); return d.toISOString().slice(0, 10); })();
  const seed = { groqKey: 'gsk_test', tab: 'chat', chats: [{ id: 'h1', title: 'Cells', messages: [{ role: 'user', content: 'cells' }, { role: 'assistant', content: 'ok' }], updatedAt: Date.now() }],
    mistakes: [{ q: 'What is the powerhouse of the cell?', a: 'mitochondria', at: 1, due: 1, misses: 1 }],
    cards: [{ id: 'c1', f: 'What is a cell?', b: 'The unit of life.', deck: 'Bio', box: 0, due: 0, at: 0 }] };
  const { ctx, page, errors } = await open(b, { device: 'Desktop Chrome', viewport: { width: 1280, height: 800 }, lite: 'off', server: false, state: seed, fakeGroq });
  const home = async () => { await page.evaluate(() => deskGo('progress')); await page.waitForSelector('#chat-log .desk-progress .hub-week', { timeout: 10000 }).catch(async (e) => { throw new Error(e.message + ' | ' + errors.join('; ') + ' | ' + await page.evaluate(() => document.getElementById('chat-log').innerHTML.slice(0, 300))); }); }; // (a computer: the Progress page)
  // nothing this week yet: what to do, not zeros
  await home();
  expect(await page.locator('#chat-log .hub-week .empty-state').count() === 1 && /Take a quick quiz/.test(await page.locator('#chat-log .hub-week').innerText()), 'an empty week says what to do');
  // a quiz (one right, one missed), a mistake review (the saved one, right) and a flashcard session (Good)
  await page.evaluate(() => deskGo('chat')); // (a computer: Progress has no ask box; a new chat does)
  await page.fill('#prompt-input', 'maths');
  await page.click('#quiz-btn');
  await page.waitForSelector('text=Question 1');
  await ask(page, '4');
  await page.click('#quiz-btn'); // stop
  await page.evaluate(() => reviewMistakes(true));
  await page.waitForFunction(() => !(state.mistakes || []).some((m) => /powerhouse/.test(m.q) && !m.right), null, { timeout: 8000 });
  await page.evaluate(() => window.CassieCards.open());
  await page.click('.fc [data-study], .fc-study, .fc .fc-go', { timeout: 3000 }).catch(() => {});
  await page.waitForSelector('.fc-card', { timeout: 8000 });
  await page.click('.fc-card'); await page.click('.fc-grade.good');
  await page.click('.fc-x');
  await page.waitForSelector('.fc', { state: 'hidden' });
  // seed last week, then Home
  await page.evaluate((d) => { state.progress[d] = { quizzes: 4, fixed: 1, cardsUp: 7, focus: 50, tasks: 2, answered: 10, right: 8 }; save(); }, lastMon);
  await home();
  const row = async (k) => (await page.locator(`#chat-log .hub-week [data-k="${k}"]`).innerText()).replace(/\s+/g, ' ');
  const want = { fixed: /^1 mistakes fixed last week 1$/, cardsUp: /^1 flashcards moved up a level last week 7$/, quizzes: /^2 quizzes taken, 67% right last week 4$/, days: /^1 days studied last week 1$/, focus: /^0 focus minutes last week 50$/, tasks: /^0 exam plan tasks done last week 2$/ };
  for (const [k, re] of Object.entries(want)) { const t = await row(k); expect(re.test(t), `${k}: ` + t); }
  const card = await page.locator('#chat-log .hub-week').innerText();
  expect(!/[—–]/.test(card), 'no dashes on the card');
  expect((await page.locator('#chat-log .wk-share').boundingBox()).height >= 44, 'Share my week is 44px');
  // it shares as a picture (saved here: this browser can't share files)
  const dl = page.waitForEvent('download', { timeout: 8000 });
  await page.click('#chat-log .wk-share');
  const file = await dl;
  expect(file.suggestedFilename() === 'my-week-with-cassie.png', 'the week as a picture: ' + file.suggestedFilename());
  // (the moving background takes 0.7 s to fade to the new colors: on a busy machine 0.8 s caught it halfway, too light behind dark mode's grey words)
  // (each card in the middle of the screen: one scrolled up under the see-through top bar is half covered, not unreadable)
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme }); await page.waitForTimeout(1600);
    for (const [pg, sel] of [['progress', '#chat-log .hub-week'], ['plan', '#chat-log .hub-exam']]) {
      await page.evaluate((x) => deskGo(x), pg); await page.waitForSelector(sel, { timeout: 4000 }); await page.waitForTimeout(300);
      await page.evaluate((s) => document.querySelector(s).scrollIntoView({ block: 'center', behavior: 'instant' }), sel); await page.waitForTimeout(200);
      const { bad } = await require('./ui-checks.cjs').contrastIssues(page, sel); expect(!bad.length, `the week card (${scheme}): ` + bad.join(' | '));
    }
  }
  expect(!errors.length, 'page errors: ' + errors.join('; '));
  await ctx.close();
  // the three sizes: nothing spills off the screen, every control on it is 44px
  for (const [device, viewport] of [['iPhone 13', { width: 390, height: 844 }], ['Galaxy S9+', { width: 360, height: 740 }], ['Desktop Chrome', { width: 1280, height: 800 }]]) {
    const st = { ...seed, tab: 'home', progress: { [lastMon]: { quizzes: 1 } }, exams: [{ id: 'e1', name: 'Physics long test', date: '2099-01-01', from: '2000-01-01', days: [{ date: new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10), tasks: [{ id: 't1', kind: 'quiz', topic: 'Vectors', done: false }, { id: 't2', kind: 'mistakes', topic: '', done: false }] }], stats: {} }] };
    st.progress[new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)] = { quizzes: 1, answered: 2, right: 1 };
    const r = await open(b, { device, viewport, scale: 1, lite: 'off', server: false, state: st });
    // (a computer: the week is on Progress and the plans on Study plan)
    for (const [hub, pg] of viewport.width < 761 ? [['#home .hub', '']] : [['#chat-log .desk-progress', 'progress'], ['#chat-log .desk-plan', 'plan']]) {
    if (pg) await r.page.evaluate((x) => deskGo(x), pg);
    await r.page.waitForSelector(`${hub} ${pg === 'plan' ? '.ex-plan' : '.wk-card'}`, { timeout: 10000 });
      const g = await r.page.evaluate((h) => { const els = [...document.querySelectorAll(`${h} .hub-exam button, ${h} .hub-exam label.ex-check, ${h} .hub-week button`)].filter((e) => e.offsetParent); return { small: els.filter((e) => { const r = e.getBoundingClientRect(); return r.height < 44 || r.width < 44; }).map((e) => e.className + ' ' + Math.round(e.getBoundingClientRect().height)), wide: document.documentElement.scrollWidth > innerWidth + 1 }; }, hub);
      expect(!g.small.length && !g.wide, `${viewport.width}x${viewport.height}: ` + JSON.stringify(g));
    }
    expect(!r.errors.length, 'page errors: ' + r.errors.join('; '));
    await r.ctx.close();
  }
});

test('quiz saves missed questions for Review my mistakes', async (b) => {
  const replies = [
    'Question 1: What is the powerhouse of the cell?',
    'Not quite — it is the mitochondria.\n[[MISSED: What is the powerhouse of the cell? || mitochondria]]\n\nQuestion 2: What carries genetic information?',
  ];
  const { ctx, page } = await open(b, { server: false, state: { groqKey: 'gsk_test' }, fakeGroq: (body, n) => ({ text: replies[Math.min(n - 1, 1)] }) });
  await page.fill('#prompt-input', 'cells');
  await page.click('#quiz-btn');
  await page.waitForSelector('text=Question 1');
  const a = await ask(page, 'the nucleus');
  const t = await a.textContent();
  expect(!/\[\[/.test(t), 'marker visible: ' + t);
  const m = await page.evaluate(() => JSON.parse(localStorage.getItem('cassie.v2')).mistakes || []);
  expect(m.length === 1 && /powerhouse/.test(m[0].q) && m[0].a === 'mitochondria', 'mistake not saved: ' + JSON.stringify(m));
  await page.click('#quiz-btn'); // stop
  await page.waitForSelector('text=Review my mistakes');
  await page.evaluate(() => { document.getElementById('new-chat-btn').click(); });
  await page.waitForSelector('.review-mistakes', { timeout: 5000 });
  await ctx.close();
});

test('attach a Word file and Cassie reads it', async (b) => {
  const { ctx, page, groqCalls } = await open(b, { server: false, state: { groqKey: 'gsk_test' }, fakeGroq: () => ({ text: '**Reviewer**\n- Mitosis has four phases.' }) });
  // make a real .docx with Cassie's own exporter, then attach it
  const docx = await page.evaluate(async () => {
    const blob = await window.CassieExport.toDocx('# Mitosis\n\nMitosis has four phases: prophase, metaphase, anaphase, telophase.', 'Mitosis');
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = ''; for (const x of buf) s += String.fromCharCode(x);
    return btoa(s);
  });
  await page.setInputFiles('#file-input', { name: 'mitosis.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from(docx, 'base64') });
  await page.waitForSelector('#attach-preview:not([hidden])', { timeout: 10000 });
  await ask(page, 'Make me a reviewer from this file');
  const sent = JSON.stringify(groqCalls);
  expect(/prophase/.test(sent), 'file text was not sent to the AI');
  await ctx.close();
});

test('a long PDF is read in parts even when the model says "too long"', async (b) => {
  const LIMIT = 14000; // pretend the model can only take this many characters
  const { ctx, page, groqCalls } = await open(b, { server: false, state: { groqKey: 'gsk_test' }, fakeGroq: (body) => {
    const len = JSON.stringify(body.messages).length;
    if (len > LIMIT) return { status: 400, message: 'Please reduce the length of the messages or completion.' };
    return { text: /Complete study notes/.test(JSON.stringify(body.messages)) ? '**Reviewer** — cells, DNA and enzymes.' : '- notes for this part' };
  } });
  const pdf = await page.evaluate(async () => {
    const para = 'Cells are the basic unit of life. DNA stores genetic information. Enzymes speed up reactions. ';
    const md = Array.from({ length: 40 }, (_, i) => `## Chapter ${i + 1}\n\n${para.repeat(12)}`).join('\n\n');
    const blob = await window.CassieExport.toPdf(md, 'Biology');
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = ''; for (const x of buf) s += String.fromCharCode(x);
    return btoa(s);
  });
  await page.setInputFiles('#file-input', { name: 'biology.pdf', mimeType: 'application/pdf', buffer: Buffer.from(pdf, 'base64') });
  const a = await ask(page, 'Read this whole file and make me a complete reviewer of it.');
  const t = await a.textContent();
  expect(/Reviewer/.test(t), 'no reviewer, got: ' + t.slice(0, 200));
  expect(groqCalls.length > 3, 'expected the file to be read in parts');
  // and "pages 2-3" keeps only those pages
  const only = await page.evaluate(() => pagesAskedFor('[Page 1]\nA\n\n[Page 2]\nB\n\n[Page 3]\nC\n\n[Page 4]\nD\n\n', 'make a reviewer of pages 2-3'));
  expect(/B/.test(only) && /C/.test(only) && !/A|D/.test(only.replace(/Page/g, '')), 'page range not applied: ' + only);
  await ctx.close();
});

test('a 49-page file becomes a complete reviewer with people, timeline and terms', async (b) => {
  const seen = { notes: 0, sections: 0, questions: 0, pictures: 0 };
  const { ctx, page } = await open(b, { server: false, state: { groqKey: 'gsk_test' }, fakeGroq: (body) => {
    const all = JSON.stringify(body.messages);
    if (/image_url/.test(all)) { seen.pictures++; return { text: '- **Pictures, tables & charts** — a map of Luzon (p. 2)' }; }
    if (/study notes from one part/.test(all)) { seen.notes++; return { text: ('- **People** — José Rizal — national hero (p. 3)\n- **Dates & times** — 30 December 1896 — Rizal is executed\n').repeat(30) }; }
    if (/Write ONLY this part/.test(all)) { seen.sections++; return { text: `**Rizal's life**\n- Born in Calamba\n@@PERSON: José Rizal — national hero\n@@DATE: 30 December 1896 — Rizal is executed in Bagumbayan\n@@DATE: 1861 — Rizal is born\n@@TERM: Propaganda Movement — campaign for reforms` }; }
    if (/practice questions/.test(all)) { seen.questions++; return { text: '1. Who wrote Noli Me Tangere?\n\n**Answers**\n1. José Rizal' }; }
    return { text: 'ok' };
  } });
  const pdf = await page.evaluate(async () => {
    const para = 'José Rizal was born in Calamba in 1861 and executed on 30 December 1896. ';
    const md = Array.from({ length: 49 }, (_, i) => `## Page topic ${i + 1}\n\n${para.repeat(25)}`).join('\n\n');
    const blob = await window.CassieExport.toPdf(md, 'History');
    const buf = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (const x of buf) s += String.fromCharCode(x); return btoa(s);
  });
  await page.setInputFiles('#file-input', { name: 'history.pdf', mimeType: 'application/pdf', buffer: Buffer.from(pdf, 'base64') });
  const a = await ask(page, 'Read this whole file and take note of all the important details');
  const t = await a.textContent();
  expect(seen.notes >= 5 && seen.sections >= 2, `expected notes on every part and several sections, got ${JSON.stringify(seen)}`);
  expect(/People to remember/.test(t) && /Timeline/.test(t) && /Key terms/.test(t) && /Practice questions/.test(t), 'missing master lists: ' + t.slice(0, 300));
  expect(!/@@/.test(t), 'raw @@ lines leaked');
  if (process.env.SHOT) await a.screenshot({ path: process.env.SHOT }); // to look at the result
  const tl = t.slice(t.indexOf('Timeline'));
  expect(tl.indexOf('1861') < tl.indexOf('1896'), 'timeline not in order');
  await ctx.close();
});

test('a reviewer of two files reads each file once and writes one reviewer: a real title, each person and date once (in tables), no section about the slides’ decorations or empty headings, a part cut off by the length limit is finished, and a check drops a wrong Watch out and a wrong answer and lists the file’s own mistakes', async (b) => {
  const seen = { notes: [], sections: 0, ends: 0, more: 0, checks: 0 };
  const S1 = '**The Birth of a Nation**\n- Independence was proclaimed in Kawit, Cavite.\n- Independence was proclaimed in Kawit, Cavite.\n**Watch out:** Don’t mix up the Mock Battle (1898) with the Battle of Manila (1899).\n**Watch out:** Felipe Calderón and Felipe Calderón y Roca are different people.\n**Persons**\n\n**Pictures, Tables & Charts**\n- Closing graphic: Thank you for listening! over a decorative ink-splash\n@@PERSON: Gen. Emilio Aguinaldo — led the revolution\n@@DATE: June 12 , 1898 — Independence proclaimed in Kawit\n@@TERM: Malolos Congress — the revolutionary legislature\nThe last example is **Graph';
  const S2 = '**The American Rule**\n- Independence was proclaimed in Kawit, Cavite.\n- The Treaty of Paris was signed on Dec 10 1898.\n@@PERSON: Emilio Aguinaldo — first president of the Malolos Republic\n@@DATE: June 12, 1898 — Philippine independence proclaimed at Kawit, Cavite\n@@PERSON: Maj. Gen. Wesley Merritt — first American military governor';
  const { ctx, page, errors } = await open(b, { server: false, state: { groqKey: 'gsk_test' }, fakeGroq: (body) => {
    const all = JSON.stringify(body.messages);
    if (/check study guides/.test(all)) { seen.checks++; return { text: 'DROP W2\nDROP A2\nNOTE: The file spells it Delfina Hermosa de Natividad; the usual spelling is Herbosa.' }; }
    if (/stopped in the middle/.test(all)) { seen.more++; return { text: 'b**, which has an Euler path.' }; }
    if (/study notes from one part/.test(all)) { seen.notes.push(all); return { text: ('- **People**: Emilio Aguinaldo, led the revolution (p. 2)\n- **Dates & events**: June 12, 1898, independence proclaimed at Kawit (p. 3)\n').repeat(40) }; }
    if (/Write ONLY this part/.test(all)) { seen.sections++; return { text: seen.sections === 1 ? S1 : S2 }; }
    if (/Write three things/.test(all)) { seen.ends++; return { text: 'TITLE: Readings in Philippine History: The Birth of a Nation\n**The big picture**\nHow the Philippines became a nation, then a US colony.\n\n**Practice questions**\n1. Where was independence proclaimed?\n2. Who was the first military governor?\n   a) Merritt b) MacArthur\n3. When was the Treaty of Paris signed?\n\n**Answers**\n1. Kawit, Cavite.\n2. Douglas MacArthur.\n3. December 10, 1898.' }; }
    return { text: 'ok' };
  } });
  try {
    const long = (w) => `${w} `.repeat(4000);
    await page.setInputFiles('#file-input', [{ name: 'a-history.txt', mimeType: 'text/plain', buffer: Buffer.from(long('Independence was proclaimed in Kawit on June 12, 1898.')) }, { name: 'b-history.txt', mimeType: 'text/plain', buffer: Buffer.from(long('The Treaty of Paris was signed on December 10, 1898.')) }]);
    const a = await ask(page, 'Make me a reviewer of these');
    const t = await a.innerText();
    // each file read once, one reviewer from both
    expect(seen.notes.length >= 2 && !seen.notes.some((n) => /=== File/.test(n)), 'each file’s parts are noted once, and the notes are never noted again: ' + seen.notes.length);
    expect(seen.ends === 1 && seen.checks === 1, 'one ending and one check for the whole reviewer, not one per file: ' + JSON.stringify(seen));
    // a real title, and where it is from
    const first = t.trim().split('\n')[0];
    expect(first === 'Readings in Philippine History: The Birth of a Nation' && /From a-history\.txt, b-history\.txt/.test(t), 'a title that names the subject, and the files it is from: ' + t.slice(0, 160));
    // each person and each date once, in tables
    const people = await a.locator('table').filter({ hasText: 'Why they matter' }).innerText();
    expect((people.match(/Aguinaldo/g) || []).length === 1 && /Wesley Merritt/.test(people), '"Gen. Emilio Aguinaldo" and "Emilio Aguinaldo" are one person: ' + people);
    const timeline = await a.locator('table').filter({ hasText: 'What happened' }).innerText();
    expect((timeline.match(/June 12, 1898/g) || []).length === 1, '"June 12 , 1898" and "June 12, 1898" are one date: ' + timeline);
    expect(/December 10, 1898/.test(t) && !/Dec 10 1898/.test(t), 'dates are written one way');
    // nothing twice, no decorations, no empty heading
    expect((t.match(/Independence was proclaimed in Kawit, Cavite/g) || []).length === 1, 'the same point once: ' + (t.match(/Independence was proclaimed in Kawit, Cavite/g) || []).length);
    expect(!/Thank you for listening|ink-splash|Pictures, Tables/i.test(t) && !/^\s*Persons\s*$/m.test(t), 'no section about the slides’ decorations, no heading with nothing under it');
    // the part cut off by the length limit is finished
    expect(seen.more === 1 && /Graph b, which has an Euler path\./.test(t), 'the cut-off part is finished: ' + seen.more + ' ' + t.slice(Math.max(0, t.indexOf('Graph') - 80), t.indexOf('Graph') + 80));
    // the check: the wrong Watch out and the wrong answer (with its question) go, the rest are numbered again
    expect(/Mock Battle/.test(t) && !/different people/.test(t), 'the wrong Watch out goes, the right one stays');
    const qa = await a.evaluate((el) => [...el.querySelectorAll('ol')].map((o) => [...o.children].map((li) => li.textContent.trim())));
    expect(!/first military governor/.test(t) && !/Douglas MacArthur/.test(t) && qa.some((l) => l.join('|') === 'Where was independence proclaimed?|When was the Treaty of Paris signed?') && qa.some((l) => l.join('|') === 'Kawit, Cavite.|December 10, 1898.'), 'the wrong answer goes with its question, and the rest are numbered 1, 2: ' + JSON.stringify(qa));
    expect(/Reviewer Readings in Philippine History/.test(t), 'the Word file is named after the reviewer’s title, not “your 2 files”');
    expect(/Notes on your file[\s\S]*Herbosa[\s\S]*follow your teacher’s version|Notes on your file[\s\S]*Herbosa[\s\S]*follow your teacher's version/.test(t) && t.indexOf('Notes on your file') < t.indexOf('Practice questions'), 'the file’s own mistakes, before the practice questions');
    expect(!/@@|TITLE:/.test(t), 'none of Cassie’s markers');
    expect(!errors.length, 'page errors: ' + errors.join('; '));
    // the merging on its own
    const m = await page.evaluate(() => {
      const lists = { PERSON: [], DATE: [], TERM: [] };
      takeMasterLines('@@PERSON: General Elwell S. Otis - US commander\n@@PERSON: Gen. Elwell Stephen Otis - second military governor of the Philippines\n@@PERSON: Douglas MacArthur - WWII general\n@@PERSON: Arthur MacArthur - third military governor\n@@DATE: Jan 21, 1899 - Malolos Constitution promulgated\n@@DATE: January 23 1899 - Malolos Republic inaugurated\n@@DATE: 1898 - Treaty of Paris\n@@TERM: Battle of Manila (1899) - first battle of the war\n@@TERM: Battle of Manila - the first and largest battle of the Philippine-American War', lists);
      return { people: lists.PERSON.map((x) => x.head), dates: lists.DATE.map((x) => x.head), terms: lists.TERM.length, md: masterListsMd(lists) };
    });
    expect(m.people.length === 3 && m.people.includes('Gen. Elwell Stephen Otis') && m.people.includes('Douglas MacArthur') && m.people.includes('Arthur MacArthur'), 'one Otis (the fuller name), two different MacArthurs: ' + m.people);
    expect(m.dates.join() === 'January 21, 1899,January 23, 1899,1898' && m.terms === 1, 'two different days stay apart, written one way; the same term once: ' + m.dates + ' ' + m.terms);
    expect(m.md.indexOf('1898') < m.md.indexOf('January 21, 1899'), 'the timeline is in order');
  } finally { await ctx.close(); }
});

test('a reviewer teaches, shaped for the subject: a programming module gets the big picture, topics as headings with their code, a quick review table and questions that make you use it; never "None", never history boxes, never Cassie’s own @@ markers or "Pages 1-22" headings', async (b) => {
  const seen = { notes: [], sections: [], end: [], systems: [] };
  const { ctx, page } = await open(b, { server: false, state: { groqKey: 'gsk_test' }, fakeGroq: (body) => {
    const all = JSON.stringify(body.messages);
    seen.systems.push((body.messages[0] || {}).content || '');
    if (/study notes from one part/.test(all)) { seen.notes.push(body.messages[0].content); return { text: ('- **Key terms**: **class**, a blueprint for objects (p. 8)\n- **Code & examples**: `class SampleClass: x = 30` prints 30 (p. 9)\n').repeat(30) }; }
    if (/Write ONLY this part/.test(all)) { seen.sections.push(body.messages[body.messages.length - 1].content); return { text: '**Classes and objects**\nA **class** is a blueprint; an **instance** is an object made from it.\n```python\nclass SampleClass:\n    x = 30\nobject1 = SampleClass()\nprint(object1.x)  # 30\n```\n**Watch out:** after `del object1`, using it raises a `NameError`.\n@@TERM: class - a blueprint for creating objects\n@@TERM: instance - an object made from a class\n@@PERSON: None\n@@DATE:\n(Note: the notes have no people or dates, so no @@PERSON or @@DATE lines.)' }; }
    if (/The big picture/.test(all) && /Practice questions/.test(all)) { seen.end.push(all); return { text: '**The big picture**\nObject oriented programming bundles data and behaviour into objects.\n\n**Practice questions**\n1. What does this code print? `print(SampleClass().x)`\n\n**Answers**\n1. 30, because x is a class attribute.' }; }
    return { text: 'ok' };
  } });
  const pdf = await page.evaluate(async () => {
    const para = 'A class is a blueprint for creating objects. class SampleClass: x = 30. object1 = SampleClass(). print(object1.x) prints 30. ';
    const md = Array.from({ length: 40 }, (_, i) => `## Module 7 page ${i + 1}\n\n${para.repeat(22)}`).join('\n\n');
    const blob = await window.CassieExport.toPdf(md, 'Module 7');
    const buf = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (const x of buf) s += String.fromCharCode(x); return btoa(s);
  });
  await page.setInputFiles('#file-input', { name: 'Module 7 Introduction to OOP.pdf', mimeType: 'application/pdf', buffer: Buffer.from(pdf, 'base64') });
  const a = await ask(page, 'Make me a reviewer of this');
  const t = await a.innerText();
  expect(seen.sections.length >= 2 && seen.end.length === 1, 'read in parts, then the big picture and questions: ' + JSON.stringify({ s: seen.sections.length, e: seen.end.length }));
  // what the student sees
  expect(!/@@/.test(t) && !/\bNone\b/.test(t) && !/no people or dates/i.test(t), 'none of Cassie’s markers or empty labels: ' + t.slice(0, 400));
  expect(!/^\s*Pages? \d/m.test(t) && !/People to remember|Timeline/.test(t), 'no "Pages 1-22" headings and no history boxes for a programming file');
  expect(t.indexOf('The big picture') > -1 && t.indexOf('The big picture') < t.indexOf('Classes and objects'), 'the big picture comes first');
  expect(await a.locator('pre code, pre').filter({ hasText: 'class SampleClass' }).count() > 0, 'the code example stays code');
  expect(await a.locator('table').filter({ hasText: 'blueprint' }).count() === 1 && /quick review/i.test(t), 'a quick review table of the key terms');
  expect(/What does this code print/.test(t) && /because/.test(t), 'practice that uses the idea, answers that say why');
  // what Cassie is told
  const sys = seen.systems.find((x) => /reviewer/.test(x)) || '';
  expect(/The big picture/.test(sys) && /Watch out/.test(sys) && /what does this code print/i.test(sys) && /never write "None"/i.test(sys) && /names used in examples/.test(sys), 'the reviewer guide: big picture, topics taught, watch out lines, questions that use the idea, no "None", no trivia');
  expect(/named after the topic/.test(seen.sections[0]) && /none for names used in examples/.test(seen.sections[0]), 'each part: topics as headings, markers only for real people and dates');
  expect(/never write "None"/i.test(seen.notes[0]) && /Code & examples/.test(seen.notes[0]) && /real people only/.test(seen.notes[0]), 'the notes fit the subject (code kept, real people only)');
  await ctx.close();
});

test('a scanned PDF (pictures only) is read page by page', async (b) => {
  let pictureCalls = 0;
  const { ctx, page } = await open(b, { server: false, state: { groqKey: 'gsk_test' }, fakeGroq: (body) => {
    const all = JSON.stringify(body.messages);
    if (/image_url/.test(all)) { pictureCalls++; return { text: '- **Key terms** — **Photosynthesis** — plants make food from light (p. 1)' }; }
    return { text: 'Reviewer: photosynthesis is how plants make food.' };
  } });
  const pdf = await page.evaluate(async () => {
    await new Promise((r) => { const sc = document.createElement('script'); sc.src = 'vendor/jspdf.umd.min.js'; sc.onload = r; document.head.appendChild(sc); });
    const doc = new window.jspdf.jsPDF({ unit: 'pt', format: 'a4' });
    for (let i = 0; i < 6; i++) {
      if (i) doc.addPage();
      const c = document.createElement('canvas'); c.width = 600; c.height = 800; const g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, 600, 800); g.fillStyle = '#000'; g.font = '28px serif'; g.fillText(`Scanned page ${i + 1}: photosynthesis`, 30, 100);
      doc.addImage(c.toDataURL('image/jpeg', 0.8), 'JPEG', 0, 0, 595, 842);
    }
    const buf = new Uint8Array(doc.output('arraybuffer')); let s = ''; for (const x of buf) s += String.fromCharCode(x); return btoa(s);
  });
  await page.setInputFiles('#file-input', { name: 'scan.pdf', mimeType: 'application/pdf', buffer: Buffer.from(pdf, 'base64') });
  const a = await ask(page, 'Make me a reviewer of this');
  expect(pictureCalls >= 2, 'expected the 6 scanned pages to be read in batches, got ' + pictureCalls);
  expect(/photosynthesis/i.test(await a.textContent()), 'no reviewer');
  await ctx.close();
});

test('a Gemini key alone: chat, graph, quiz, research, file, photo and Save as PDF', async (b) => {
  const calls = [];
  const { ctx, page, groqCalls } = await open(b, { server: false, state: { geminiKey: 'AIza_test' } });
  await ctx.route(/generativelanguage\.googleapis\.com/, (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    const all = JSON.stringify((body.contents || []).slice(-1)); // only the latest message, not Cassie's instructions
    calls.push(all);
    let text = 'Gemini answer: photosynthesis turns light into food.';
    if (/application\/pdf/.test(all)) text = '**Reviewer**\n- **People** — Rizal — hero (p. 1)';
    else if (/"mimeType":"image\//.test(all)) text = 'I see a red square in your photo.';
    else if (/graph y = x\^2/.test(all)) text = 'Here is the parabola. It crosses at -2 and 2.';
    else if (/Quiz me/.test(all)) text = 'Question 1: What is 2 + 2?';
    else if (/Review of Related Literature/.test(all)) text = 'RRL: sleep helps memory (Smith, 2020).';
    else if (/simpler|explain/i.test(all) && /Osmosis/.test(all)) text = 'Simply put: water moves across.';
    return route.fulfill({ json: { candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] } });
  });
  await ctx.route(/api\.openalex\.org/, (route) => route.fulfill({ json: { results: [{ title: 'Sleep and memory', publication_year: 2020, authorships: [{ author: { display_name: 'J. Smith' } }], cited_by_count: 3 }] } }));
  expect(await page.locator('#model-pill-model').textContent() === 'Gemini', 'model pill should say Gemini');
  // chat
  let a = await ask(page, 'What is photosynthesis?');
  expect(/Gemini answer/.test(await a.textContent()), 'chat failed: ' + await a.textContent());
  // graph
  a = await ask(page, 'graph y = x^2 - 4');
  expect(await a.locator('.cassie-board canvas').count() >= 1, 'no graph');
  // quiz
  await page.fill('#prompt-input', 'math'); await page.click('#quiz-btn');
  await page.waitForSelector('text=Question 1', { timeout: 10000 });
  await page.click('#quiz-btn');
  // research
  await page.fill('#prompt-input', 'sleep and memory'); await page.click('#research-btn');
  await page.waitForSelector('text=RRL: sleep helps memory', { timeout: 10000 });
  // file (PDF read whole by Gemini)
  const pdf = await page.evaluate(async () => {
    const blob = await window.CassieExport.toPdf('# History\n\nRizal was born in 1861.', 'History');
    const buf = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (const x of buf) s += String.fromCharCode(x); return btoa(s);
  });
  await page.setInputFiles('#file-input', { name: 'history.pdf', mimeType: 'application/pdf', buffer: Buffer.from(pdf, 'base64') });
  a = await ask(page, 'Make me a reviewer of this');
  expect(/Reviewer/.test(await a.textContent()), 'file failed: ' + await a.textContent());
  // save that answer as a PDF
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), a.locator('.bubble-tools button[data-format=pdf]').click()]);
  expect(fs.statSync(await dl.path()).size > 500, 'PDF download empty');
  // photo
  const red = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = c.height = 40; const g = c.getContext('2d'); g.fillStyle = 'red'; g.fillRect(0, 0, 40, 40); return c.toDataURL('image/png').split(',')[1]; });
  await page.setInputFiles('#file-input', { name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from(red, 'base64') });
  await page.waitForSelector('#attach-preview:not([hidden])');
  a = await ask(page, 'What is in this photo?');
  expect(/red square/.test(await a.textContent()), 'photo failed: ' + await a.textContent());
  expect(groqCalls.length === 0, 'should never call Groq without a Groq key');
  await ctx.close();
});

test('save an answer as Word and PDF', async (b) => {
  const { ctx, page } = await open(b, { server: false, state: { groqKey: 'gsk_test' }, fakeGroq: () => ({ text: '**Photosynthesis**\n\n- Plants use light, water and carbon dioxide.\n- They make glucose and oxygen.' }) });
  const a = await ask(page, 'Notes on photosynthesis');
  for (const f of ['docx', 'pdf']) {
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), a.locator(`.bubble-tools button[data-format=${f}]`).click()]);
    const file = await dl.path();
    const size = fs.statSync(file).size;
    expect(size > 500 && dl.suggestedFilename().endsWith('.' + f), `${f} download looks wrong (${dl.suggestedFilename()}, ${size} bytes)`);
  }
  await ctx.close();
});

test('board: paste a screenshot with Ctrl+V', async (b) => {
  const { ctx, page } = await open(b, { server: false, state: { groqKey: 'gsk_test' } });
  await page.click('#board-btn');
  await page.waitForSelector('.csk-bg', { timeout: 5000 });
  await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 600; c.height = 300;
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 600, 300); x.fillStyle = '#111'; x.font = '28px sans-serif'; x.fillText('Solve: 2x + 3 = 11', 40, 80);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    const dt = new DataTransfer(); dt.items.add(new File([blob], 'screenshot.png', { type: 'image/png' }));
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await page.waitForFunction(() => { const p = window.CassieSketch.session().pictures(); return p.length === 1 && Math.abs(p[0].w / p[0].h - 2) < 0.01; }, null, { timeout: 5000 });
  await ctx.close();
});

// a 600 x 300 picture pasted on the board (as a screenshot would be)
const pastePicture = (page, words = 'Solve: 2x + 3 = 11') => page.evaluate(async (words) => {
  const c = document.createElement('canvas'); c.width = 600; c.height = 300;
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 600, 300); x.fillStyle = '#111'; x.font = '28px sans-serif'; x.fillText(words, 40, 80);
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  const dt = new DataTransfer(); dt.items.add(new File([blob], 'screenshot.png', { type: 'image/png' }));
  document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
}, words);

test('board: an open canvas: room to draw around a picture, the Hand moves the view (not the ink), two fingers pinch-zoom, Fit shows everything, saving takes it all (1280x800)', async (b) => {
  const { ctx, page, errors } = await open(b, { device: 'Desktop Chrome', viewport: { width: 1280, height: 800 }, server: false, state: { groqKey: 'gsk_test' } });
  await page.click('#board-btn');
  await page.waitForSelector('.csk-live');
  const S = (f, a) => page.evaluate(([f, a]) => window.CassieSketch.session()[f](a), [f, a]);
  const on = (x, y) => S('screenOf', [x, y]);
  const drag = async (from, to) => { await page.mouse.move(from[0], from[1]); await page.mouse.down(); await page.mouse.move(to[0], to[1], { steps: 8 }); await page.mouse.up(); };
  // the view's buttons: 44px, named
  for (const a of ['zout', 'zin', 'fit']) { const r = await page.locator(`[data-act="${a}"]`).boundingBox(); expect(r && r.width >= 44 && r.height >= 44 && await page.locator(`[data-act="${a}"]`).getAttribute('aria-label'), a + ': 44px with a name: ' + JSON.stringify(r)); }
  await pastePicture(page);
  await page.waitForFunction(() => window.CassieSketch.session().pictures().length === 1, null, { timeout: 5000 });
  const pic = (await S('pictures'))[0];
  // zoom out, then the Hand moves the view to the left: nothing is drawn
  for (let i = 0; i < 3; i++) await page.click('[data-act="zout"]');
  const z0 = (await S('view')).zoom;
  expect(Math.abs(z0 - 1 / 1.25 ** 3) < 0.02, 'zoom out three times: ' + z0);
  await page.click('[data-tool="hand"]');
  const live = await page.locator('.csk-live').boundingBox(), mid = [live.x + live.width / 2, live.y + live.height / 2];
  const v0 = await S('view');
  await drag(mid, [mid[0] - 300, mid[1]]);
  const v1 = await S('view');
  expect(await S('strokeCount') === 0 && v1.x > v0.x + 100, 'the Hand moved the view, drew nothing: ' + JSON.stringify([v0, v1]));
  // from inside the picture to 400px past its right edge: the whole line is kept
  await page.click('[data-tool="pen"]');
  const my = pic.y + pic.h / 2, start = await on(pic.x + pic.w * 0.8, my), edge = await on(pic.x + pic.w, my);
  await drag(start, [edge[0] + 400, edge[1]]);
  const line = await S('lastStroke');
  const xs = line.points.map((p) => p[0]), right = Math.max(...xs), wpx = (await on(1, 0))[0] - (await on(0, 0))[0];
  expect(Math.min(...xs) < pic.x + pic.w * 0.85 && right > pic.x + pic.w + 300 / wpx, 'the stroke goes well past the picture: ' + JSON.stringify([Math.min(...xs), right, pic]));
  // the Hand again: the ink stays where it is in the board, only where it shows moves
  await page.click('[data-tool="hand"]');
  const seen0 = await on(line.points[0][0], line.points[0][1]);
  await drag(mid, [mid[0] - 150, mid[1] + 60]);
  const seen1 = await on(line.points[0][0], line.points[0][1]);
  expect(JSON.stringify(await S('lastStroke')) === JSON.stringify(line) && Math.abs(seen1[0] - seen0[0] + 150) < 3 && Math.abs(seen1[1] - seen0[1] - 60) < 3, 'the view moved with the hand, the ink did not: ' + JSON.stringify([seen0, seen1]));
  // two fingers spread apart: zoom in around them (and nothing is drawn)
  await page.click('[data-tool="pen"]');
  const za = (await S('view')).zoom;
  await page.evaluate(([cx, cy]) => {
    const c = document.querySelector('.csk-live');
    const ev = (type, id, x) => c.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', isPrimary: id === 11, clientX: x, clientY: cy, button: type === 'pointermove' ? -1 : 0, buttons: type === 'pointerup' ? 0 : 1, bubbles: true, cancelable: true }));
    ev('pointerdown', 11, cx - 40); ev('pointerdown', 12, cx + 40);
    for (let i = 1; i <= 6; i++) { ev('pointermove', 11, cx - 40 - i * 15); ev('pointermove', 12, cx + 40 + i * 15); }
    ev('pointerup', 11, cx - 130); ev('pointerup', 12, cx + 130);
  }, mid);
  const zb = (await S('view')).zoom;
  expect(zb > za * 2 && await S('strokeCount') === 1, 'a pinch zooms in, draws nothing: ' + JSON.stringify([za, zb]));
  // Fit: the picture and the line, all on screen
  await page.click('[data-act="fit"]');
  const box = await page.locator('.csk-live').boundingBox();
  const inside = async (x, y) => { const q = await on(x, y); return q[0] >= box.x - 1 && q[0] <= box.x + box.width + 1 && q[1] >= box.y - 1 && q[1] <= box.y + box.height + 1; };
  expect(await inside(pic.x, pic.y) && await inside(pic.x + pic.w, pic.y + pic.h) && await inside(right, my), 'Fit shows the picture and the whole line');
  // the saved picture takes in all of it (wider than the picture and the line)
  await page.click('[data-act="save"]');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.csk-pop [data-pop="png"]')]);
  const png = fs.readFileSync(await dl.path()), w = png.readUInt32BE(16);
  expect(png.slice(1, 4).toString() === 'PNG' && w > right - pic.x, 'the PNG is as wide as everything: ' + w + ' vs ' + (right - pic.x));
  const parts = await S('parts');
  expect(parts.w > right - pic.x && parts.image && parts.strokes[0].points.every((p) => p[0] >= 0 && p[0] <= parts.w), 'Cassie gets the same frame: ' + parts.w);
  expect(!errors.length, 'page errors: ' + errors.join('; '));
  await ctx.close();
});

test('board: pictures are things on the board: the Move tool picks one (corner handles resize it, its menu locks it as the background, sends it to the back or deletes it), a pen draws on a locked one, undo takes one away, an old board file keeps its picture, and a room shares them', async (b) => {
  const { ctx, page, errors } = await open(b, { device: 'Desktop Chrome', viewport: { width: 1280, height: 800 }, server: false, state: { groqKey: 'gsk_test' } });
  await page.click('#board-btn');
  await page.waitForSelector('.csk-live');
  const S = (f, a) => page.evaluate(([f, a]) => window.CassieSketch.session()[f](a), [f, a]);
  const on = (x, y) => S('screenOf', [x, y]);
  const P = () => S('pictures');
  const center = (p) => on(p.x + p.w / 2, p.y + p.h / 2);
  await pastePicture(page, 'Picture one');
  await page.waitForFunction(() => window.CassieSketch.session().pictures().length === 1, null, { timeout: 5000 });
  const [a0] = await P();
  const live = await page.locator('.csk-live').boundingBox();
  expect(a0.mode === 'free' && a0.w <= live.width * 0.6 / ((await on(1, 0))[0] - (await on(0, 0))[0]) + 1, 'a picture goes in the middle of the view, at most 60% of its width: ' + JSON.stringify(a0));
  // Move: tap it, its menu shows (44px buttons)
  await page.click('[data-tool="select"]');
  await page.mouse.click(...(await center(a0)));
  await page.waitForSelector('.csk-picmenu:not([hidden])');
  const btns = await page.$$eval('.csk-picmenu .csk-btn:not([hidden])', (bs) => bs.map((x) => { const r = x.getBoundingClientRect(); return [x.textContent.trim(), Math.round(r.height)]; }));
  expect(btns.map((x) => x[0]).join('|') === 'Lock as background|Send to back|Delete' && btns.every((x) => x[1] >= 44), 'the picture menu: ' + JSON.stringify(btns));
  // the bottom-right handle: bigger, the same shape
  const se = await on(a0.x + a0.w, a0.y + a0.h);
  await page.mouse.move(se[0], se[1]); await page.mouse.down(); await page.mouse.move(se[0] + 80, se[1] + 10, { steps: 6 }); await page.mouse.up();
  const [a1] = await P();
  expect(a1.w > a0.w + 40 && Math.abs(a1.w / a1.h - a0.w / a0.h) < 0.02 && Math.abs(a1.x - a0.x) < 1 && Math.abs(a1.y - a0.y) < 1, 'resized from its corner, shape kept: ' + JSON.stringify([a0, a1]));
  // a second picture lands on top; Send to back puts it under the first
  await pastePicture(page, 'Picture two');
  await page.waitForFunction(() => window.CassieSketch.session().pictures().length === 2, null, { timeout: 5000 });
  let ps = await P(); const second = ps.find((p) => p.id !== a0.id);
  expect(ps[ps.length - 1].id === second.id, 'the new picture is on top');
  await page.mouse.click(...(await center(second)));
  await page.click('.csk-picmenu [data-pic="back"]');
  ps = await P();
  expect(ps[0].id === second.id && ps[1].id === a0.id, 'Send to back: it is under the other picture now: ' + JSON.stringify(ps.map((p) => [p.id === a0.id ? 'one' : 'two', p.z])));
  // the first: Lock as background; the menu then says Unlock; a pen stroke starts on it and it stays put
  await page.mouse.click(...(await on(a1.x + a1.w * 0.6, a1.y + a1.h * 0.4)));
  await page.click('.csk-picmenu [data-pic="mode"]');
  expect((await P()).find((p) => p.id === a0.id).mode === 'background' && (await page.locator('.csk-picmenu [data-pic="mode"]').innerText()).trim() === 'Unlock', 'locked as the background, and Unlock is offered: ' + JSON.stringify(await P()));
  await page.click('[data-tool="pen"]');
  const from = await on(a1.x + a1.w * 0.85, a1.y + a1.h * 0.85);
  await page.mouse.move(from[0], from[1]); await page.mouse.down(); await page.mouse.move(from[0] + 120, from[1] + 40, { steps: 6 }); await page.mouse.up();
  const locked = (await P()).find((p) => p.id === a0.id);
  expect(await S('strokeCount') === 1 && locked.x === a1.x && locked.y === a1.y, 'the pen drew on the locked picture, which stayed put');
  // Delete: the other picture goes
  await page.click('[data-tool="select"]');
  const sp = (await P()).find((p) => p.id === second.id);
  await page.mouse.click(...(await on(sp.x + 6, sp.y + 6)));
  await page.click('.csk-picmenu [data-pic="del"]');
  expect((await P()).length === 1 && (await P())[0].id === a0.id, 'Delete took the picture away');
  // undo: a picture just added goes again
  await pastePicture(page, 'Picture three');
  await page.waitForFunction(() => window.CassieSketch.session().pictures().length === 2, null, { timeout: 5000 });
  await page.click('[data-act="undo"]');
  expect((await P()).length === 1 && await S('strokeCount') === 1, 'undo took the new picture away, the stroke stays');
  // an old board file (its picture was the page): the picture is back at 0,0 as the background, the strokes where they were
  const old = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 600; c.height = 300; const x = c.getContext('2d'); x.fillStyle = '#ffd'; x.fillRect(0, 0, 600, 300); return { cassie: 'board', v: 1, title: 'Old', w: 600, h: 300, grid: false, image: c.toDataURL('image/jpeg', 0.8), strokes: [{ tool: 'pen', color: '#1b1b1d', size: 4, points: [[100, 100], [300, 200], [500, 250]] }] }; });
  const file = path.join(require('os').tmpdir(), 'cassie-old-board.json'); fs.writeFileSync(file, JSON.stringify(old));
  page.once('dialog', (d) => d.accept());
  await page.click('[data-act="save"]');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('.csk-pop [data-pop="open"]')]);
  await chooser.setFiles(file);
  await page.waitForFunction(() => window.CassieSketch.session().strokeCount() === 1 && window.CassieSketch.session().pictures().length === 1, null, { timeout: 5000 });
  const op = (await P())[0], ol = await S('lastStroke');
  expect(op.x === 0 && op.y === 0 && op.w === 600 && op.h === 300 && op.mode === 'background' && JSON.stringify(ol.points) === '[[100,100],[300,200],[500,250]]', 'the old board: picture and strokes in place: ' + JSON.stringify([op, ol.points]));
  const parts = await S('parts');
  expect(parts.w === 600 && parts.h === 300 && /^data:image\/jpeg/.test(parts.image || ''), 'Cassie gets that picture as it was');
  expect(!errors.length, 'page errors: ' + errors.join('; '));
  await ctx.close();
  // a room: a picture one person adds shows for the other (made small enough for the room)
  const A = await open(b, { device: 'Desktop Chrome', state: { profile: { ...PROFILE, name: 'Ana Reyes' } } });
  const B = await open(b, { device: 'Desktop Chrome', state: { profile: { ...PROFILE, name: 'Ben Cruz' } } });
  try {
    await A.page.click('#board-btn');
    await A.page.click('.csk-btn:has-text("Study together")');
    await A.page.click('[data-room="new"]');
    await A.page.waitForSelector('.csk-room:not([hidden]) b', { timeout: 10000 });
    const code = await A.page.locator('.csk-room b').innerText();
    await B.page.goto(APP + '?room=' + code);
    await B.page.waitForSelector('.csk-room:not([hidden]) b', { timeout: 10000 });
    // a big, busy photo: too big for one room step until it's made smaller
    await A.page.evaluate(async () => {
      const c = document.createElement('canvas'); c.width = 2400; c.height = 1600; const x = c.getContext('2d');
      for (let i = 0; i < 4000; i++) { x.fillStyle = `hsl(${(i * 37) % 360} 70% ${30 + (i % 50)}%)`; x.fillRect((i * 97) % 2400, (i * 53) % 1600, 30 + (i % 40), 20 + (i % 30)); }
      const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
      const dt = new DataTransfer(); dt.items.add(new File([blob], 'photo.png', { type: 'image/png' }));
      document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    });
    await B.page.waitForFunction(() => window.CassieSketch.session().pictures().length === 1, null, { timeout: 15000 });
    const [ap] = await A.page.evaluate(() => window.CassieSketch.session().pictures()), [bp] = await B.page.evaluate(() => window.CassieSketch.session().pictures());
    expect(Math.abs(ap.x - bp.x) < 1 && Math.abs(ap.w - bp.w) < 1 && Math.abs(ap.w / ap.h - 1.5) < 0.02, 'Ben sees Ana’s picture where she put it: ' + JSON.stringify([ap, bp]));
    expect(A.errors.length === 0 && B.errors.length === 0, 'page errors: ' + A.errors.concat(B.errors).join('; '));
  } finally { await A.ctx.close(); await B.ctx.close(); }
});

test('board on a phone: a calm header (More holds Save and Close), the Ask bar tucks away while you draw, Undo and Redo float (a two-finger tap undoes), Shape snap, Paper choices, a mind map, and the Laser in reach', async (b) => {
  const S = (page, f, a) => page.evaluate(([f, a]) => window.CassieSketch.session()[f](a), [f, a]);
  const vis = (page, sel) => page.$$eval(sel, (els) => els.filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; }).map((e) => (e.getAttribute('aria-label') || e.textContent).trim()));
  // a phone (390x844)
  const { ctx, page, errors } = await open(b, { device: 'iPhone 13', server: false, state: { groqKey: 'gsk_test' } });
  await page.evaluate(() => openSketch());
  await page.waitForSelector('.csk-live');
  const head = await vis(page, '.csk-head > *');
  expect(head.length === 3 && head[0] === 'Your board' && /Send to Cassie/.test(head[1]) && head[2] === 'More', 'the phone header: the title, Send to Cassie and More only: ' + JSON.stringify(head));
  const mb = await page.locator('.csk-head [data-act="more"]').boundingBox();
  expect(mb.width >= 44 && mb.height >= 44 && await page.locator('.csk-head [data-act="more"]').getAttribute('aria-haspopup') === 'menu', 'More is 44px and opens a menu');
  await page.click('.csk-head [data-act="more"]');
  const items = await vis(page, '.csk-more [role="menuitem"]');
  expect(items.includes('Save or open') && items.includes('Close board'), 'More holds Save and Close: ' + JSON.stringify(items));
  await page.keyboard.press('Escape');
  expect(await page.locator('.csk-more').isHidden() && await page.locator('.csk-wrap').count() === 1, 'Escape closes the menu, not the board');
  await page.click('.csk-head [data-act="more"]'); await page.click('.csk-more [data-more="save"]');
  await page.waitForSelector('.csk-pop[data-kind="save"]');
  await page.keyboard.press('Escape');
  // the Laser is in reach (on screen, not under anything)
  const lz = await page.locator('[data-tool="laser"]').boundingBox();
  expect(lz && lz.y >= 0 && lz.y + lz.height <= 844 && lz.height >= 44 && await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y).closest('[data-tool="laser"]'), [lz.x + lz.width / 2, lz.y + lz.height / 2]), 'the Laser can be tapped on a phone: ' + JSON.stringify(lz));
  // Undo and Redo float (not in the toolbar), 44px, and follow the board
  expect(!(await page.locator('.csk-tools [data-act="undo"]').isVisible()) && await page.locator('.csk-zoom [data-act="undo"]').isVisible(), 'Undo floats on a phone');
  for (const a of ['undo', 'redo']) { const r = await page.locator(`.csk-zoom [data-act="${a}"]`).boundingBox(); expect(r.width >= 44 && r.height >= 44, a + ' is 44px'); }
  expect(await page.locator('.csk-zoom [data-act="undo"]').isDisabled(), 'nothing drawn: Undo is off');
  // the Ask bar tucks away while drawing, the ink on screen stays put, and it comes back
  const box0 = await page.locator('.csk-live').boundingBox(), askH = (await page.locator('.csk-ask').boundingBox()).height;
  const line = async (x0, y0, x1, y1, hold) => { await page.mouse.move(x0, y0); await page.mouse.down(); await page.mouse.move(x1, y1, { steps: 6 }); if (hold) await hold(); await page.mouse.up(); };
  await line(box0.x + 60, box0.y + 40, box0.x + 200, box0.y + 80);
  const first = await S(page, 'lastStroke'), seen0 = await S(page, 'screenOf', first.points[0]);
  let mid = null;
  await line(box0.x + 80, box0.y + 130, box0.x + 220, box0.y + 170, async () => { mid = { ask: (await page.locator('.csk-ask').boundingBox()).height, live: (await page.locator('.csk-live').boundingBox()).height, seen: await S(page, 'screenOf', first.points[0]) }; });
  expect(askH >= 44 && mid.ask < 2 && Math.abs(mid.live - box0.height - askH) < 3, 'drawing: the Ask bar tucks away and the board takes its height: ' + JSON.stringify([askH, mid, box0.height]));
  expect(Math.abs(mid.seen[0] - seen0[0]) < 1.5 && Math.abs(mid.seen[1] - seen0[1]) < 1.5, 'the ink stayed where it was on screen: ' + JSON.stringify([seen0, mid.seen]));
  await page.waitForTimeout(1800);
  expect((await page.locator('.csk-ask').boundingBox()).height >= 44 && Math.abs((await S(page, 'screenOf', first.points[0]))[1] - seen0[1]) < 1.5, 'the Ask bar is back 1.5 s later, the ink still in place');
  await line(box0.x + 90, box0.y + 210, box0.x + 230, box0.y + 240);
  await page.focus('.csk-ask input');
  expect((await page.locator('.csk-ask').boundingBox()).height >= 44, 'the Ask bar is back at once when its box gets the focus');
  // the floating Undo and Redo
  expect(await S(page, 'strokeCount') === 3, 'three strokes: ' + await S(page, 'strokeCount'));
  await page.click('.csk-zoom [data-act="undo"]');
  expect(await S(page, 'strokeCount') === 2 && !(await page.locator('.csk-zoom [data-act="redo"]').isDisabled()), 'Undo, and Redo is on');
  await page.click('.csk-zoom [data-act="redo"]');
  expect(await S(page, 'strokeCount') === 3, 'Redo');
  // two fingers: a quick tap undoes one stroke, a drag only moves the view
  const fingers = (moves) => page.evaluate(([cx, cy, moves]) => {
    const c = document.querySelector('.csk-live');
    const ev = (type, id, x, y) => c.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', isPrimary: id === 21, clientX: x, clientY: y, buttons: type === 'pointerup' ? 0 : 1, bubbles: true, cancelable: true }));
    ev('pointerdown', 21, cx - 40, cy); ev('pointerdown', 22, cx + 40, cy);
    for (let i = 1; i <= moves; i++) { ev('pointermove', 21, cx - 40, cy + i * 12); ev('pointermove', 22, cx + 40, cy + i * 12); }
    ev('pointerup', 21, cx - 40, cy + moves * 12); ev('pointerup', 22, cx + 40, cy + moves * 12);
  }, [box0.x + box0.width / 2, box0.y + box0.height / 2, moves]);
  await fingers(0);
  expect(await S(page, 'strokeCount') === 2, 'a two-finger tap undid one stroke');
  await fingers(6);
  expect(await S(page, 'strokeCount') === 2, 'a two-finger drag undid nothing');
  // a mind map from Quick shapes
  await page.click('[data-act="shapes"]'); await page.click('.csk-pop [data-k="mind"]');
  await page.mouse.click(box0.x + box0.width / 2, box0.y + box0.height / 2);
  const mm = await S(page, 'lastStroke');
  expect(await S(page, 'strokeCount') === 3 && mm.tool === 'group' && mm.items.filter((x) => x.tool === 'rect').length === 6, 'a mind map: a bubble and 6 branches');
  expect(!errors.length, 'page errors: ' + errors.join('; '));
  // More: Close closes the board
  await page.click('.csk-head [data-act="more"]'); await page.click('.csk-more [data-more="close"]');
  await page.waitForSelector('.csk-wrap', { state: 'detached', timeout: 3000 });
  await ctx.close();

  // a computer (1280x800): the header as it was, Shape snap, Paper
  const D = await open(b, { device: 'Desktop Chrome', viewport: { width: 1280, height: 800 }, server: false, state: { groqKey: 'gsk_test' } });
  const p = D.page;
  await p.evaluate(() => openSketch());
  await p.waitForSelector('.csk-live');
  const dh = await vis(p, '.csk-head > *');
  expect(!dh.includes('More') && dh.some((x) => /Close/.test(x)) && (await p.locator('.csk-head [data-act="save"]').isVisible()), 'a computer keeps its header: ' + JSON.stringify(dh));
  expect(await p.locator('.csk-tools [data-act="undo"]').isVisible() && await p.locator('.csk-zoom [data-act="undo"]').isVisible(), 'a computer: Undo in both places');
  const bx = await p.locator('.csk-live').boundingBox();
  const stroke = async (pts) => { await p.mouse.move(bx.x + pts[0][0], bx.y + pts[0][1]); await p.mouse.down(); for (const q of pts.slice(1)) await p.mouse.move(bx.x + q[0], bx.y + q[1]); await p.mouse.up(); return S(p, 'lastStroke'); };
  const wob = (i) => Math.sin(i * 1.7) * 3;
  const edge = (a, c, n, k0) => Array.from({ length: n }, (_, i) => [a[0] + (c[0] - a[0]) * i / n + wob(i + k0), a[1] + (c[1] - a[1]) * i / n + wob(i + k0 + 3)]);
  const rect = (x, y, w, h) => [...edge([x, y], [x + w, y], 12, 0), ...edge([x + w, y], [x + w, y + h], 8, 1), ...edge([x + w, y + h], [x, y + h], 12, 2), ...edge([x, y + h], [x, y], 8, 3), [x + 2, y + 1]];
  const tri = (x, y, w, h) => [...edge([x, y + h], [x + w / 2, y], 10, 0), ...edge([x + w / 2, y], [x + w, y + h], 10, 1), ...edge([x + w, y + h], [x, y + h], 10, 2), [x + 1, y + h - 1]];
  const circle = (cx, cy, r) => Array.from({ length: 41 }, (_, i) => [cx + (r + wob(i)) * Math.cos(i / 40 * Math.PI * 2), cy + (r + wob(i)) * Math.sin(i / 40 * Math.PI * 2)]);
  const straight = (x, y, len) => Array.from({ length: 16 }, (_, i) => [x + len * i / 15, y + wob(i) * 0.8]);
  const scribble = (x, y) => Array.from({ length: 30 }, (_, i) => [x + (i % 2 ? 60 : 0) + i * 3, y + (i % 3) * 25]);
  // snap off: as drawn
  const off = await stroke(rect(80, 80, 220, 140));
  expect(off.tool === 'pen', 'Shape snap off: the box stays as drawn');
  await p.click('.csk-tools [data-act="snap"]');
  expect(await p.locator('.csk-tools [data-act="snap"]').getAttribute('aria-pressed') === 'true' && await p.evaluate(() => localStorage.getItem('cassie.board.snap')) === 'true', 'Shape snap is on, and remembered');
  const flatOrUp = (it) => { const [a, c] = it.points; return Math.abs(a[0] - c[0]) < 0.5 || Math.abs(a[1] - c[1]) < 0.5; };
  const r = await stroke(rect(380, 80, 220, 140));
  expect(r.tool === 'group' && r.items.length === 4 && r.items.every((it) => it.tool === 'line' && flatOrUp(it)), 'a wobbly box comes out a clean rectangle: ' + JSON.stringify(r).slice(0, 300));
  const t = await stroke(tri(680, 80, 200, 160));
  expect(t.tool === 'group' && t.items.length === 3 && t.items.every((it) => it.tool === 'line'), 'a wobbly triangle comes out three straight sides: ' + JSON.stringify(t).slice(0, 300));
  const c = await stroke(circle(200, 400, 80));
  const cx = c.points.reduce((m, q) => m + q[0], 0) / c.points.length, cy = c.points.reduce((m, q) => m + q[1], 0) / c.points.length;
  const radii = c.points.map((q) => Math.hypot(q[0] - cx, q[1] - cy)), rr = radii.reduce((m, v) => m + v, 0) / radii.length;
  expect(c.tool === 'pen' && c.points.length >= 60 && radii.every((v) => Math.abs(v - rr) / rr < 0.06), 'a wobbly circle comes out round');
  const l = await stroke(straight(420, 420, 300));
  expect(l.tool === 'line' && l.points.length === 2 && Math.abs(l.points[0][1] - l.points[1][1]) < 0.5, 'a wobbly line comes out straight: ' + JSON.stringify(l.points));
  const sc = await stroke(scribble(760, 360));
  expect(sc.tool === 'pen' && sc.points.length >= 20, 'a scribble is never snapped');
  // Paper: each choice draws something different, and is kept in a board file
  const bgSum = () => p.evaluate(() => { const c = document.querySelector('.csk-bg'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let s = 0; for (let i = 0; i < d.length; i += 4 * 13) s = (s * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) % 1e9; return s; });
  const sums = {};
  for (const k of ['blank', 'graph', 'lined', 'plane', 'cornell']) { await p.click('.csk-tools [data-act="paper"]'); await p.click(`.csk-pop [data-pop="paper"][data-k="${k}"]`); expect(await S(p, 'paper') === k, 'paper: ' + k); sums[k] = await bgSum(); }
  expect(new Set(Object.values(sums)).size === 5, 'each paper looks different: ' + JSON.stringify(sums));
  await p.click('[data-act="save"]');
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('.csk-pop [data-pop="json"]')]);
  const saved = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
  expect(saved.paper === 'cornell', 'the board file keeps the paper: ' + saved.paper);
  // an older file with graph paper (grid: true) opens on Graph
  const file = path.join(require('os').tmpdir(), 'cassie-grid-board.json');
  fs.writeFileSync(file, JSON.stringify({ cassie: 'board', v: 1, title: 'Old', w: 1600, h: 1000, grid: true, image: null, strokes: [{ tool: 'pen', color: '#1b1b1d', size: 4, points: [[10, 10], [200, 200]] }] }));
  p.once('dialog', (d) => d.accept());
  await p.click('[data-act="save"]');
  const [chooser] = await Promise.all([p.waitForEvent('filechooser'), p.click('.csk-pop [data-pop="open"]')]);
  await chooser.setFiles(file);
  await p.waitForFunction(() => window.CassieSketch.session().strokeCount() === 1, null, { timeout: 5000 });
  expect(await S(p, 'paper') === 'graph', 'grid: true opens as Graph');
  expect(!D.errors.length, 'page errors: ' + D.errors.join('; '));
  await D.ctx.close();
});

test('onboarding: Step 2’s levels sit two across and Next shows without scrolling (360x740, 390x844), and Skip setup after the name lands on Home with the name kept', async (b) => {
  for (const viewport of [{ width: 360, height: 740 }, { width: 390, height: 844 }]) {
    const { ctx, page, errors } = await open(b, { device: 'iPhone 13', viewport, server: false, state: null });
    await page.waitForSelector('.fr-start', { timeout: 8000 }); await page.click('.fr-start');
    await page.waitForSelector('.fr-ob');
    const skip = await page.locator('.fr-skipall').boundingBox();
    expect(skip && skip.height >= 44 && /Skip setup/.test(await page.locator('.fr-skipall').innerText()), viewport.width + ': Skip setup under the name, 44px');
    await page.fill('.fr-ob input[name=name]', 'Mara'); await page.click('.fr-go');
    await page.waitForSelector('.fr-count >> text=2 of 4');
    const g = await page.evaluate(() => {
      const picks = [...document.querySelectorAll('.fr-ob [data-who]')], go = document.querySelector('.fr-go').getBoundingClientRect(), fr = document.querySelector('.fr');
      return { cols: new Set(picks.map((p) => Math.round(p.getBoundingClientRect().left))).size, clipped: picks.filter((p) => p.scrollWidth > p.clientWidth + 1 || p.scrollHeight > p.clientHeight + 1).map((p) => p.textContent),
        goBottom: go.bottom, h: innerHeight, scrolls: fr.scrollHeight > fr.clientHeight + 1, age: document.querySelector('.fr-age').getBoundingClientRect().bottom };
    });
    expect(g.cols === 2 && !g.clipped.length, viewport.width + ': two columns, no level cut off: ' + JSON.stringify(g));
    expect(g.goBottom <= g.h && g.age <= g.h && !g.scrolls, viewport.width + ': Next and the age field on screen without scrolling: ' + JSON.stringify(g));
    expect(!errors.length, 'page errors: ' + errors.join('; '));
    await ctx.close();
  }
  // Skip setup: the name is kept, the rest waits, and Home is where they land
  const { ctx, page, errors } = await open(b, { device: 'iPhone 13', server: false, state: null });
  await page.waitForSelector('.fr-start', { timeout: 8000 }); await page.click('.fr-start');
  await page.waitForSelector('.fr-ob');
  await page.fill('.fr-ob input[name=name]', 'Mara');
  await page.click('.fr-skipall');
  await page.waitForSelector('.fr', { state: 'detached', timeout: 5000 });
  await page.waitForTimeout(400);
  const land = await page.evaluate(() => ({ name: state.profile && state.profile.name, home: !!document.querySelector('.tabbar [data-tab="home"].on'), chat: !!document.querySelector('.tabbar [data-tab="chat"].on') }));
  expect(land.name === 'Mara' && land.home && !land.chat, 'Skip setup: the name kept, on Home: ' + JSON.stringify(land));
  expect(!errors.length, 'page errors: ' + errors.join('; '));
  await ctx.close();
});

test('Home on a phone: a student who picked goals sees 4 boxes (the rest in More tools) and the first one leads (a 2px accent edge and a glow); no goals: no box leads (the ask box does)', async (b) => {
  const look = async (state) => {
    const { ctx, page, errors } = await open(b, { device: 'iPhone 13', server: false, lite: 'off', state: { groqKey: 'gsk_test', tab: 'home', progress: { '2026-10-20': { asked: 2 } }, ...state } });
    await page.waitForSelector('#home .hub-box', { timeout: 8000 });
    const r = await page.evaluate(() => { const bx = [...document.querySelectorAll('#home .hub-box')], lead = document.querySelector('#home .hub-lead'), cs = lead && getComputedStyle(lead); return { n: bx.length, more: !!document.querySelector('#home .hub-more'), first: bx[0] && bx[0].dataset.hub, lead: lead && lead.dataset.hub, border: cs && cs.borderTopWidth, glow: cs && cs.boxShadow }; });
    expect(!errors.length, 'page errors: ' + errors.join('; '));
    await ctx.close();
    return r;
  };
  const g = await look({ helpWith: ['exam'] });
  expect(g.n === 4 && g.more && g.first === 'quiz' && g.lead === 'quiz' && g.border === '2px' && g.glow && g.glow !== 'none', 'goals: 4 boxes, More tools, the first leads: ' + JSON.stringify(g));
  const n = await look({ helpWith: [] });
  expect(n.n > 4 && !n.more && n.lead === 'ask', 'no goals: every box, none leading (the ask box leads instead): ' + JSON.stringify(n));
});

test('Home has exactly one lead: a phone with no goals leads with the ask box (Ask a question for a brand-new student), a computer’s dashboard with Ask Cassie; a 2px accent edge and a glow, AA on every theme', async (b) => {
  const lead = async (o, scheme = 'light') => {
    const { ctx, page, errors } = await open(b, { server: false, lite: 'off', ...o });
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(500);
    await page.evaluate(() => { if (!document.documentElement.classList.contains('native')) deskGo('home'); }); // (a computer: its dashboard)
    try { await page.waitForSelector('.hub-lead', { timeout: 8000 }); } catch (e) { throw new Error('no lead: ' + JSON.stringify(o.state) + ' ' + await page.evaluate(() => [document.querySelectorAll('.hub-lead').length, !!document.getElementById('home-ask'), document.body.className, (document.querySelector('.hub-lead') || {}).outerHTML || ''].join(' | ').slice(0, 400))); }
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => {
      const all = [...document.querySelectorAll('.hub-lead')].filter((e) => e.getClientRects().length), e = all[0], cs = e && getComputedStyle(e), box = e && e.getBoundingClientRect();
      // the edge against what's behind it (3:1)
      const rgb = (c) => (c.match(/[\d.]+/g) || []).slice(0, 3).map(Number), lum = (c) => { const v = rgb(c).map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
      let p = e && e.parentElement, bg = 'rgb(255,255,255)';
      for (; p; p = p.parentElement) { const c = getComputedStyle(p).backgroundColor; if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) { bg = c; break; } }
      const a = lum(cs.borderTopColor), c2 = lum(bg), ratio = (Math.max(a, c2) + 0.05) / (Math.min(a, c2) + 0.05);
      return { n: all.length, id: e && (e.id || e.dataset.hub || e.dataset.dk), cls: e && e.className, border: cs && cs.borderTopWidth, glow: cs && cs.boxShadow, h: box && Math.round(box.height), ratio: Math.round(ratio * 100) / 100 };
    });
    expect(!errors.length, 'page errors: ' + errors.join('; '));
    await ctx.close();
    return r;
  };
  const ok = (r) => r.n === 1 && r.border === '2px' && r.glow && r.glow !== 'none' && r.h >= 44 && r.ratio >= 3;
  const back = await lead({ device: 'iPhone 13', state: { groqKey: 'gsk_test', tab: 'home', helpWith: [], progress: { '2026-10-20': { asked: 2 } } } });
  const backDark = await lead({ device: 'iPhone 13', state: { groqKey: 'gsk_test', tab: 'home', helpWith: [], accent: 'mono', progress: { '2026-10-20': { asked: 2 } } } }, 'dark');
  expect(ok(backDark), 'a phone, Monochrome and dark: the edge still shows (3:1): ' + JSON.stringify(backDark));
  expect(ok(back) && back.id === 'home-ask' && /hub-ask/.test(back.cls), 'a phone, no goals: the ask box leads: ' + JSON.stringify(back));
  const fresh = await lead({ device: 'iPhone 13', state: { groqKey: 'gsk_test', tab: 'home', helpWith: [] } });
  expect(ok(fresh) && fresh.id === 'home-ask' && /hub-card/.test(fresh.cls), 'a brand-new student: Ask a question leads: ' + JSON.stringify(fresh));
  const goal = await lead({ device: 'iPhone 13', state: { groqKey: 'gsk_test', tab: 'home', helpWith: ['exam'], progress: { '2026-10-20': { asked: 2 } } } });
  expect(ok(goal) && goal.id === 'quiz', 'goals still win: the first goal box leads, alone: ' + JSON.stringify(goal));
  for (const accent of ['cassie', 'mono']) for (const scheme of ['light', 'dark']) {
    const pc = await lead({ device: 'Desktop Chrome', viewport: { width: 1280, height: 800 }, state: { groqKey: 'gsk_test', accent } }, scheme);
    expect(ok(pc) && pc.id === 'ask', `a computer (${accent}, ${scheme}): Ask Cassie leads: ` + JSON.stringify(pc));
  }
});

test('Lessons follow the student’s level: Nursery or Kindergarten comes first in onboarding (saved as Kindergarten), each level’s Lessons menu shows its own list (phone Home box, computer sidebar under Menu), changing the level changes it, and a lesson opens its tool', async (b) => {
  const WANT = {
    Kindergarten: ['Trace letters', 'Trace numbers', 'Count with me', 'Shapes and colours'],
    'Grade 3': ['Read with Cassie', 'Phonics and spelling', 'Times tables', 'Fractions', 'Science labs for kids'],
    'Grade 8': ['Algebra', 'Science labs', 'Essay helper', 'Quiz me'],
    'Grade 11': ['Physics labs', 'Calculus', 'Accounting basics', 'Essays', 'Research', 'Practical research'],
    '2nd year college': ['Read my PDF', 'Research with citations', 'Exam plan', 'LET reviewer'],
    'Board exam reviewee': ['Read my PDF', 'Research with citations', 'Exam plan', 'LET reviewer'],
  };
  // onboarding: the little ones first
  {
    const { ctx, page } = await open(b, { device: 'iPhone 13', viewport: { width: 360, height: 740 }, server: false, state: null });
    await page.waitForSelector('.fr-start', { timeout: 8000 }); await page.click('.fr-start');
    await page.fill('.fr-ob input[name=name]', 'Lia'); await page.click('.fr-go');
    await page.waitForSelector('.fr-count >> text=2 of 4');
    const first = await page.$eval('.fr-ob [data-who]', (x) => [x.dataset.who, x.textContent]);
    expect(first[0] === 'kinder' && first[1] === 'Nursery or Kindergarten', 'the first level is Nursery or Kindergarten: ' + first);
    await page.click('.fr-ob [data-who=kinder]'); await page.click('.fr-skip');
    await page.waitForSelector('.fr', { state: 'detached', timeout: 5000 });
    expect(await page.evaluate(() => state.profile.grade) === 'Kindergarten', 'saved as Kindergarten');
    await ctx.close();
  }
  // a computer: Lessons in the sidebar under Menu, after Study plan; each level its own list
  {
    const { ctx, page, errors } = await open(b, { device: 'Desktop Chrome', viewport: { width: 1280, height: 800 }, server: false, state: { groqKey: 'gsk_test' } });
    const nav = await page.$$eval('#side-nav [data-page]', (bs) => bs.map((x) => x.dataset.page));
    expect(nav.indexOf('lessons') === nav.indexOf('plan') + 1, 'Lessons after Study plan in the Menu: ' + nav);
    for (const [grade, want] of Object.entries(WANT)) {
      await page.evaluate((g) => { state.profile.grade = g; save(); }, grade);
      await page.click('#side-nav [data-page="lessons"]');
      await page.waitForSelector('.desk-lessons .lesson');
      const got = await page.$$eval('.desk-lessons .lesson b', (bs) => bs.map((x) => x.textContent));
      expect(JSON.stringify(got) === JSON.stringify(want), `${grade}: ` + JSON.stringify(got));
      if (grade === 'Grade 11') { const strands = await page.$$eval('.desk-lessons .lessons-strand', (h) => h.map((x) => x.textContent)); expect(strands.join() === 'STEM,ABM,HUMSS,Every strand', 'Senior High: by strand: ' + strands); }
    }
    expect(!errors.length, 'page errors: ' + errors.join('; '));
    await ctx.close();
  }
  // a phone: the Lessons box on Home opens its own screen; a lesson opens its tool
  {
    const { ctx, page, errors } = await open(b, { device: 'iPhone 13', server: false, lite: 'on', state: { groqKey: 'gsk_test', tab: 'home', profile: { ...PROFILE, grade: 'Grade 3' } } });
    await page.evaluate(() => { try { sessionStorage.setItem('cassie.moreTools', '1'); } catch (e) { /* */ } refreshHub(); });
    await page.waitForSelector('#home .hub-box[data-hub="lessons"]', { timeout: 8000 });
    await page.click('#home .hub-box[data-hub="lessons"]');
    await page.waitForSelector('.lessons-sheet .lesson');
    const got = await page.$$eval('.lessons-sheet .lesson b', (bs) => bs.map((x) => x.textContent));
    expect(JSON.stringify(got) === JSON.stringify(WANT['Grade 3']), 'phone, Grade 3: ' + JSON.stringify(got));
    const back = await page.locator('.lessons-back').boundingBox();
    expect(back.width >= 44 && back.height >= 44, 'Back is 44px');
    await page.click('.lessons-sheet .lesson[data-go="lab:diner"]');
    await page.waitForSelector('.lab-view:not([hidden])[data-lab="diner"]', { timeout: 20000 });
    expect(!(await page.locator('.lessons-sheet').count()), 'the lessons screen closed');
    expect(!errors.length, 'page errors: ' + errors.join('; '));
    await ctx.close();
  }
});

test('keep your work: after a first real study moment a signed-out student sees one card to sign in with Google (never over the ask box), once, and once more a week later; never when signed in', async (b) => {
  const { ctx, page, errors } = await open(b, { device: 'iPhone 13', server: true, state: { groqKey: 'gsk_test', tab: 'chat' } });
  await page.waitForSelector('#prompt-input');
  const card = () => page.locator('.save-nudge').count();
  await page.evaluate(() => { studyMoment('answer'); studyMoment('answer'); });
  expect(await card() === 0, 'not after 2 answers');
  await page.evaluate(() => studyMoment('answer'));
  expect(await card() === 1 && /Sign in with Google to keep your notes safe on your phone and the web\./.test(await page.locator('.save-nudge').innerText()), 'the 3rd answer: the card');
  const over = await page.evaluate(() => { const a = document.querySelector('.save-nudge').getBoundingClientRect(), p = document.getElementById('prompt-input').getBoundingClientRect(); return !(a.bottom <= p.top || a.top >= p.bottom || a.right <= p.left || a.left >= p.right); });
  expect(!over, 'it never covers the ask box');
  await page.fill('#prompt-input', 'still typing'); // (the ask box still takes a tap and words)
  await page.click('.save-nudge-x');
  expect(await card() === 0, 'dismissed');
  await page.evaluate(() => studyMoment('quiz'));
  expect(await card() === 0, 'once only (not again the same week)');
  await page.evaluate(() => { state.saveNudge.at -= 8 * 864e5; studyMoment('cards'); });
  expect(await card() === 1, 'once more, a week later');
  await page.click('.save-nudge-x');
  await page.evaluate(() => { state.saveNudge.at -= 8 * 864e5; studyMoment('cards'); });
  expect(await card() === 0, 'never a third time');
  await page.evaluate(() => { state.saveNudge = null; localStorage.setItem(AUTH_KEY, 'token-test'); studyMoment('quiz'); });
  expect(await card() === 0, 'never when signed in');
  expect(!errors.length, 'page errors: ' + errors.join('; '));
  await ctx.close();
});

test('tab bar on a phone: each of the 6 tabs at least 48px wide and 44px tall, none overlapping, all on screen (320, 360, 390 wide)', async (b) => {
  for (const width of [320, 360, 390]) {
    for (const tab of ['home', 'games']) { // (the open tab shows its name: the widest it gets)
      const { ctx, page } = await open(b, { device: 'iPhone 13', viewport: { width, height: 760 }, server: false, state: { groqKey: 'gsk_test', tab } });
      await page.waitForSelector('.tabbar .tab');
      await page.waitForTimeout(400);
      const r = await page.$$eval('.tabbar .tab', (ts) => ts.map((t) => { const q = t.getBoundingClientRect(); return [q.left, q.right, q.width, q.height]; }));
      const overlap = r.some((a, i) => i && a[0] < r[i - 1][1] - 0.5), off = r.some((a) => a[0] < 0 || a[1] > innerWidthOf(width));
      expect(r.length === 6 && r.every((a) => a[2] >= 48 && a[3] >= 44) && !overlap && !off, `${width} (${tab} open): ` + JSON.stringify(r.map((a) => [Math.round(a[0]), Math.round(a[2]), Math.round(a[3])])));
      await ctx.close();
    }
  }
  function innerWidthOf(w) { return w; }
});

test('Cassie’s moods: thinking while an answer comes, reading a photo, proud when a quiz or a flashcard round is finished', async (b) => {
  const slow = async () => { await new Promise((r) => setTimeout(r, 1500)); return { text: 'Here you go. Question 1: what is 2 + 2?' }; };
  const { ctx, page, errors } = await open(b, { device: 'Desktop Chrome', server: false, lite: 'off', fakeGroq: slow, state: { groqKey: 'gsk_test' } });
  await page.waitForSelector('#prompt-input');
  const mood = () => page.evaluate(() => (typeof bot2d !== 'undefined' && bot2d ? bot2d.state : ''));
  const sawWhile = async (want, act) => { const seen = new Set(); const t = setInterval(async () => { try { seen.add(await mood()); } catch (e) { /* page busy */ } }, 60); await act(); clearInterval(t); return seen.has(want) ? want : [...seen].join(','); };
  expect(await sawWhile('thinking', () => ask(page, 'what is photosynthesis')) === 'thinking', 'thinking while the answer comes');
  expect(await sawWhile('reading', () => sendPhoto(page, 'what is this')) === 'reading', 'reading a photo');
  await page.click('#quiz-btn');
  await page.waitForFunction(() => !document.getElementById('send-btn').disabled, null, { timeout: 10000 });
  await page.click('#quiz-btn');
  expect(await mood() === 'proud', 'a quiz finished: proud');
  await page.evaluate(() => { bot2d.setState('idle'); window.CassieCards.add([{ f: 'What is H2O?', b: 'Water' }], 'Chem'); window.CassieCards.open(); });
  await page.click('[data-study="Chem"]'); await page.click('.fc-card'); await page.click('[data-grade="good"]');
  await page.waitForSelector('.fc-done');
  expect(await mood() === 'proud', 'a flashcard round finished: proud');
  expect(!errors.length, 'page errors: ' + errors.join('; '));
  await ctx.close();
});

test('press feedback: pills, chips, Home boxes and tabs scale to 0.96 while pressed (none with Reduce Motion), and Android gives a 10 ms buzz (never with Reduce Motion, never on an iPhone)', async (b) => {
  const run = async (device, reduce) => {
    const ctx = await b.newContext({ ...devices[device], reducedMotion: reduce ? 'reduce' : 'no-preference', serviceWorkers: 'block' });
    await ctx.addInitScript(([seed]) => { window.CASSIE_SERVER = ''; if (!sessionStorage.getItem('seeded')) { localStorage.setItem('cassie.v2', seed); sessionStorage.setItem('seeded', '1'); } window.__buzz = []; if (navigator.vibrate) navigator.vibrate = (ms) => { window.__buzz.push(ms); return true; }; }, [JSON.stringify({ profile: PROFILE, seenVersion: APP_VERSION, lite: 'off', tab: 'home', groqKey: 'gsk_test', helpWith: ['exam'] })]);
    const page = await ctx.newPage(); await page.goto(APP);
    await page.waitForSelector('#home .hub-box', { timeout: 8000 });
    await page.evaluate(() => document.querySelector('#home .hub-box').scrollIntoView({ block: 'center' })); await page.waitForTimeout(300); // (in the middle: never under the tab bar)
    const box = await page.locator('#home .hub-box').first().boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.waitForTimeout(200);
    const r = await page.evaluate(() => ({ t: getComputedStyle(document.querySelector('#home .hub-box:active') || document.querySelector('#home .hub-box')).transform, buzz: window.__buzz }));
    await page.mouse.up();
    await ctx.close();
    return r;
  };
  const android = await run('Pixel 7', false);
  expect(/matrix\(0\.96/.test(android.t) && android.buzz.join() === '10', 'Android: scales to 0.96 and buzzes 10 ms: ' + JSON.stringify(android));
  const still = await run('Pixel 7', true);
  expect(!/matrix\(0\.96/.test(still.t) && !still.buzz.length, 'Reduce Motion: no scaling, no buzz: ' + JSON.stringify(still));
  const iphone = await run('iPhone 13', false);
  expect(/matrix\(0\.96/.test(iphone.t) && !iphone.buzz.length, 'iPhone: scales, no buzz: ' + JSON.stringify(iphone));
});

test('Liquid Glass tap: a tab icon, an icon button and a board tool press to 0.94 with a glass bloom from where they were touched, then spring back; with Reduce Motion only a tint', async (b) => {
  const press = async (page, sel) => {
    const box = await page.locator(sel).first().boundingBox();
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.4); await page.mouse.down(); await page.waitForTimeout(200);
    const r = await page.evaluate((s) => { const e = document.querySelector(s), a = getComputedStyle(e, '::after'); return { t: getComputedStyle(e).transform, glow: +a.opacity || 0, bg: a.backgroundImage, x: e.style.getPropertyValue('--x'), tint: getComputedStyle(e).boxShadow }; }, sel);
    await page.mouse.up(); await page.waitForTimeout(80);
    r.spring = await page.evaluate((s) => document.querySelector(s).classList.contains('lg-up'), sel);
    await page.waitForTimeout(300);
    return r;
  };
  const board = (page) => page.evaluate(() => openSketch()).then(() => page.waitForSelector('.csk-live'));
  for (const reduce of [false, true]) {
    const P = await open(b, { device: 'iPhone 13', server: false, lite: 'off', state: { groqKey: 'gsk_test', tab: 'home' } });
    if (reduce) { await P.page.emulateMedia({ reducedMotion: 'reduce' }); }
    await P.page.waitForSelector('.tabbar [data-tab="labs"]');
    const tab = await press(P.page, '.tabbar [data-tab="labs"]');
    await P.ctx.close();
    const D = await open(b, { device: 'Desktop Chrome', viewport: { width: 1280, height: 800 }, server: false, lite: 'off', state: { groqKey: 'gsk_test' } });
    if (reduce) { await D.page.emulateMedia({ reducedMotion: 'reduce' }); }
    await D.page.waitForSelector('#labs-btn');
    const icon = await press(D.page, '#labs-btn');
    await D.page.keyboard.press('Escape'); await D.page.evaluate(() => { try { deskGo('home'); } catch (e) { /* */ } });
    await board(D.page);
    const tool = await press(D.page, '.csk-tools [data-tool="hl"]');
    await D.ctx.close();
    for (const [name, r] of [['tab icon', tab], ['icon button', icon], ['board tool', tool]]) {
      if (!reduce) expect(/matrix\(0\.94, 0, 0, 0\.94/.test(r.t) && r.glow > 0 && /radial-gradient/.test(r.bg) && /px$/.test(r.x) && r.spring, `${name}: 0.94, a glass bloom from the touch, a spring back: ` + JSON.stringify(r));
      else expect(!/matrix\(0\.94/.test(r.t) && !/radial-gradient/.test(r.bg) && /inset/.test(r.tint), `${name} with Reduce Motion: no scale, no bloom, a tint: ` + JSON.stringify(r));
    }
  }
});

test('empty screens: Flashcards, Chats and the Study plan show a still, flat Cassie above their words', async (b) => {
  const { ctx, page, errors } = await open(b, { device: 'Desktop Chrome', viewport: { width: 1280, height: 800 }, server: false, state: { groqKey: 'gsk_test' } });
  const bot = (sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const svg = e.querySelector('.es-bot svg.cassie-bot'), r = e.querySelector('.es-bot') && e.querySelector('.es-bot').getBoundingClientRect(); return { svg: !!svg, hidden: e.querySelector('.es-bot') && e.querySelector('.es-bot').getAttribute('aria-hidden'), w: r && Math.round(r.width), first: e.firstElementChild && e.firstElementChild.className, title: (e.querySelector('.es-title') || {}).textContent }; }, sel);
  await page.evaluate(() => window.CassieCards.open());
  await page.waitForSelector('.fc .empty-state');
  const fc = await bot('.fc .empty-state');
  expect(fc && fc.svg && fc.hidden === 'true' && fc.w === 64 && fc.first === 'es-bot' && fc.title === 'No flashcards yet', 'Flashcards: ' + JSON.stringify(fc));
  await page.evaluate(() => window.CassieCards.close());
  await page.evaluate(() => deskGo('chats'));
  await page.waitForSelector('.desk-chats .empty-state, .desk .empty-state', { timeout: 5000 });
  const ch = await bot('.desk .empty-state');
  expect(ch && ch.svg && ch.title === 'No chats yet', 'Chats: ' + JSON.stringify(ch));
  await page.evaluate(() => deskGo('plan'));
  await page.waitForSelector('.desk-plan .empty-state', { timeout: 5000 });
  const pl = await bot('.desk-plan [data-col="now"] .empty-state');
  expect(pl && pl.svg && pl.w === 64, 'Study plan: ' + JSON.stringify(pl));
  const moving = await page.evaluate(async () => { const s = document.querySelector('.desk-plan .es-bot svg').outerHTML; await new Promise((r) => setTimeout(r, 900)); return s !== document.querySelector('.desk-plan .es-bot svg').outerHTML; });
  expect(!moving, 'she keeps still');
  expect(!errors.length, 'page errors: ' + errors.join('; '));
  await ctx.close();
});

// what a screen's buttons, pills and cards have that's cut off or spilling over their edge (ellipsis is on purpose)
const clipIssues = (page) => page.evaluate(() => {
  const out = [], seen = new Set();
  const shown = (e) => { const r = e.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; for (let x = e; x; x = x.parentElement) { const c = getComputedStyle(x); if (c.display === 'none' || c.visibility === 'hidden' || +c.opacity === 0) return false; } return true; };
  document.querySelectorAll('button, a.btn, .fr-pick, .hub-box, .hub-card, .hub-w, .hub-q, .dk-chip, .chip, [role="button"], .tab').forEach((e) => {
    if (seen.has(e) || !shown(e) || !e.innerText || !e.innerText.trim()) return;
    seen.add(e);
    const c = getComputedStyle(e);
    if (c.textOverflow === 'ellipsis') return;
    const kids = [e, ...e.querySelectorAll('b, small, span, em')].filter((k) => shown(k) && getComputedStyle(k).textOverflow !== 'ellipsis' && k.innerText && k.innerText.trim());
    const bad = kids.find((k) => k.scrollWidth > k.clientWidth + 1 && getComputedStyle(k).display !== 'inline');
    if (bad) out.push(`${e.tagName.toLowerCase()}.${String(e.className).split(' ')[0]} "${e.innerText.trim().slice(0, 30)}" ${bad.scrollWidth}>${bad.clientWidth}`);
  });
  return out;
});
test.slow('layout pass: Home, onboarding, Chat, Cards, Labs, Games, You and the board at 360x740, 390x844, 412x915 and 1280x800: no button, pill or card has its words cut off or spilling over its edge', async (b) => {
  const SIZES = [['Pixel 7', { width: 360, height: 740 }], ['iPhone 13', { width: 390, height: 844 }], ['Pixel 7', { width: 412, height: 915 }], ['Desktop Chrome', { width: 1280, height: 800 }]];
  const SCREENS = [
    ['home', async () => {}, { tab: 'home' }],
    ...[0, 1, 2, 3].map((k) => [`onboarding ${k + 1}`, async (page) => { await page.evaluate((at) => { localStorage.setItem('cassie.firstRun', JSON.stringify({ step: 'ob', at })); }, k); await page.reload(); await page.waitForSelector('.fr-ob', { timeout: 8000 }); }, null]),
    ['chat', async (page) => { await ask(page, 'what is photosynthesis'); }],
    ['cards', async (page) => { await page.evaluate(() => window.CassieCards.open()); await page.waitForSelector('.fc:not([hidden])', { timeout: 8000 }); }],
    ['labs', async (page) => { await page.evaluate(() => openLabs(undefined, { section: 'learn' })); await page.waitForSelector(LABS_READY, { timeout: 20000 }); }],
    ['games', async (page) => { await page.evaluate(() => openLabs(undefined, { section: 'games' })); await page.waitForSelector(LABS_READY, { timeout: 20000 }); }],
    ['you', async (page) => { await page.evaluate(() => openSettings('profile')); await page.waitForSelector('#settings-panel:not([hidden])'); }],
    ['board', async (page) => { await page.evaluate(() => openSketch()); await page.waitForSelector('.csk-live', { timeout: 15000 }); }],
  ];
  // (the check itself: a button whose words don't fit is caught)
  { const { ctx, page } = await open(b, { server: false });
    const caught = await page.evaluate(() => { const x = document.createElement('button'); x.className = 'probe'; x.style.cssText = 'position:fixed;top:10px;left:10px;width:60px;overflow:hidden;white-space:nowrap;z-index:9999'; x.textContent = 'A label far too long for this button'; document.body.appendChild(x); return true; }) && await clipIssues(page);
    expect(caught.some((x) => /probe/.test(x)), 'the clipping check catches a cut-off button: ' + JSON.stringify(caught));
    await ctx.close(); }
  const bad = [];
  for (const [device, viewport] of SIZES) {
    for (const [name, go, st = {}] of SCREENS.filter((x) => !process.env.LAYOUT_ONLY || x[0].startsWith(process.env.LAYOUT_ONLY))) {
      const { ctx, page } = await open(b, { device, viewport, server: false, lite: 'on', state: st === null ? null : { groqKey: 'gsk_test', ...st }, fakeGroq: () => ({ text: 'Photosynthesis is how plants make food.' }) });
      try { await page.waitForTimeout(300); await go(page); await page.waitForTimeout(400); const is = await clipIssues(page); if (is.length) bad.push(`${name} @ ${viewport.width}x${viewport.height}: ${is.join(' | ')}`); }
      catch (e) { bad.push(`${name} @ ${viewport.width}: could not open: ${e.message.split('\n')[0]}`); }
      await ctx.close();
    }
  }
  expect(!bad.length, bad.length + ' screens with words cut off: ' + bad.join(' || '));
});

test('an iPhone (reports 2 cores) is not forced into Lite mode', async (b) => {
  const ctx = await b.newContext({ ...devices['iPhone 13'], serviceWorkers: 'block' });
  await ctx.addInitScript((v) => {
    window.CASSIE_SERVER = '';
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 2 });
    localStorage.setItem('cassie.v2', JSON.stringify({ profile: { name: 'T', role: 'student', grade: 'Grade 9', age: 14 }, seenVersion: v }));
  }, APP_VERSION);
  const page = await ctx.newPage();
  await page.goto(APP);
  expect(await page.evaluate(() => window.CASSIE_LITE) === false, 'Lite mode turned on for an iPhone');
  await ctx.close();
});

test('Cassie dresses for the holidays (Philippine time) and says so; two taps in a row get two connected lines', async (b) => {
  const FLAG = 'M-28 -60 H38 V-38 H-28 Z', CANDLE = 'M0 -66 Q11 -51';
  const day = async (iso) => {
    const { ctx, page, errors } = await open(b, { server: false, setup: (c) => c.clock.setFixedTime(new Date(iso + 'T10:00:00+08:00')) });
    await page.waitForSelector('#mascot.has2d svg.cassie-bot', { state: 'attached', timeout: 8000 });
    await page.waitForFunction(() => { const m = document.getElementById('mascot-bubble'); return m && !m.hidden && m.textContent.trim(); }, null, { timeout: 8000 });
    const said = await page.locator('#mascot-bubble').textContent();
    const acc = await page.evaluate(() => [...document.querySelectorAll('#mascot svg.cassie-bot :is(.cb-acc-top, .cb-acc-face, .cb-acc-neck)')].map((g) => g.innerHTML).join(''));
    return { ctx, page, errors, said, acc };
  };
  const june = await day('2026-06-12');
  expect(june.acc.includes(FLAG), 'on 12 June she wears the little flag: ' + june.acc.slice(0, 80));
  expect(/Happy Independence Day/.test(june.said), 'on 12 June she says Happy Independence Day: ' + june.said);
  expect(!/[–—]/.test(june.said), 'no dashes in what she says');
  await june.ctx.close();
  const nov = await day('2026-11-01');
  expect(nov.acc.includes(CANDLE) && !nov.acc.includes(FLAG), 'on 1 November (Undas) she wears the candle');
  expect(!/Happy|🎉/.test(nov.said), 'Undas gets a quiet word, nothing festive: ' + nov.said);
  await nov.ctx.close();
  const plain = await day('2026-07-15');
  expect(plain.acc === '', 'a normal day: no holiday accessory: ' + plain.acc.slice(0, 80));
  expect(!/Happy|Today is|ngayon/.test(plain.said), 'a normal day: no holiday line: ' + plain.said);
  // two taps in a row: the second line follows on from the first (not a repeat)
  const { page } = plain;
  await page.evaluate(() => { document.getElementById('mascot-bubble').hidden = true; });
  const taps = [];
  for (let i = 0; i < 2; i++) {
    await page.click('#mascot-btn');
    await page.waitForFunction(() => !document.getElementById('mascot-bubble').hidden, null, { timeout: 3000 });
    taps.push(await page.locator('#mascot-bubble').textContent());
  }
  const pairs = await page.evaluate(() => TAP_PAIRS.en.map((p) => [p[0], p[1]]));
  const fill = (t) => t.replace('{name}', 'Test');
  expect(taps[0] !== taps[1] && pairs.some(([a, c]) => fill(a) === taps[0] && fill(c) === taps[1]), 'two taps: two different lines from the same little exchange: ' + JSON.stringify(taps));
  expect(plain.errors.length === 0, 'page errors: ' + plain.errors.join('; '));
  await plain.ctx.close();
});

test('Cassie chats like the student: their energy (playful or calm), their mood (stressed or excited), what they studied last, how long they write; her own little bubbles keep to one every 2 minutes', async (b) => {
  const { ctx, page, errors } = await open(b, { server: false, setup: (c) => c.clock.setFixedTime(new Date('2026-07-15T10:00:00+08:00')) });
  await page.waitForSelector('#mascot.has2d svg.cassie-bot', { state: 'attached', timeout: 8000 });
  await page.waitForFunction(() => { const m = document.getElementById('mascot-bubble'); return m && !m.hidden; }, null, { timeout: 8000 }); // (her hello)
  const EMO = /[\p{Extended_Pictographic}]/u;
  const says = (fn) => page.evaluate(fn);
  // a stressed message gets a gentle line (no emoji, no shouting); an excited one gets a cheer
  const stressed = await says(() => { lastChatAt = 0; mascotOnSend("I'm so stressed, I think I'm going to fail my exam"); return document.getElementById('mascot-bubble').textContent; });
  const gentle = await says(() => CASSIE_LINES.en.stressed.map((t) => t.replace('{name}', 'Test').replace('!', '.')));
  expect(gentle.includes(stressed) && !EMO.test(stressed), 'stressed: a gentle line: ' + stressed);
  const cheer = await says(() => { lastChatAt = 0; mascotOnSend('yay I passed the quiz!!'); return document.getElementById('mascot-bubble').textContent; });
  const cheers = await says(() => CASSIE_LINES.en.cheer.map((t) => t.replace('{name}', 'Test')));
  expect(cheers.some((c) => cheer.startsWith(c)), 'excited: a cheer: ' + cheer);
  // the 2-minute rule: right after that, typing gets no hint and a drag gets no bubble; 2 minutes later it does
  await says(() => { document.getElementById('mascot-bubble').hidden = true; });
  await page.fill('#prompt-input', 'a'); await page.waitForTimeout(300);
  expect(await says(() => document.getElementById('mascot-bubble').hidden), 'a typing hint inside the 2 minutes');
  await says(() => { lastChatAt = Date.now() - 2 * 60 * 1000 - 1; });
  await page.fill('#prompt-input', 'ab'); await page.waitForTimeout(300);
  expect(!(await says(() => document.getElementById('mascot-bubble').hidden)), 'after 2 minutes a typing hint may show');
  // playful and short: lots of emoji and slang get emoji-friendly, shorter lines; formal gets calm lines with no emoji
  const playful = await says(() => { localStorage.removeItem('cassie.chatStyle'); for (const t of ['haha omg 😂😂', 'grabe lol 🤣', 'ty bro!!']) noteStyle(t); const out = []; for (let i = 0; i < 12; i++) out.push(cassieLine(CASSIE_LINES.en.correct, 'correct')); return { tone: chatTone(), out, short: byLength(CASSIE_LINES.en.long) }; });
  const shortest = [...(await says(() => CASSIE_LINES.en.long))].sort((a, c) => a.length - c.length).slice(0, 3).sort();
  expect(playful.tone === 'playful' && playful.out.some((t) => EMO.test(t)) && JSON.stringify([...playful.short].sort()) === JSON.stringify(shortest), 'playful and short: ' + JSON.stringify(playful));
  const calm = await says(() => { localStorage.removeItem('cassie.chatStyle'); for (const t of ['Good morning. Could you please explain how photosynthesis works in plants, step by step, with an example?', 'Thank you. May I ask how the light reactions differ from the Calvin cycle in terms of their products?', 'Could you please give me three practice questions about this topic so I can check my understanding?']) noteStyle(t); const out = []; for (let i = 0; i < 12; i++) out.push(cassieLine(CASSIE_LINES.en.correct, 'correct')); return { tone: chatTone(), out }; });
  expect(calm.tone === 'calm' && calm.out.every((t) => !EMO.test(t) && !t.includes('!')), 'formal: calm lines, no emoji: ' + JSON.stringify(calm));
  const long = await says(() => byLength(CASSIE_LINES.en.long));
  const sorted = [...(await says(() => CASSIE_LINES.en.long))].sort((a, c) => a.length - c.length);
  expect(JSON.stringify([...long].sort()) === JSON.stringify(sorted.slice(-3).sort()), 'a long writer gets the fuller lines: ' + JSON.stringify(long));
  // she remembers what they studied last (before today), on the first open of the day
  const back = await says(() => {
    const d = window.CassieMemory.data; d.topics['photosynthesis light reactions'] = { seen: 3, correct: 0, wrong: 0, first: Date.now() - 3 * 864e5, last: Date.now() - 864e5, ease: 2.3, interval: 1, reps: 0, due: Date.now() };
    localStorage.removeItem('cassie.helloDay'); localStorage.removeItem('cassie.chatStyle'); lastChatAt = 0;
    const r = Math.random; Math.random = () => 0; try { helloChat(); } finally { Math.random = r; }
    return document.getElementById('mascot-bubble').textContent;
  });
  expect(back.includes('"photosynthesis light reactions"'), 'she remembers the last topic: ' + back);
  expect(!/[–—]/.test([stressed, cheer, back].join(' ')), 'no dashes');
  expect(!errors.length, 'page errors: ' + errors.join('; '));
  await ctx.close();
});

test('Appearance has no 3D Cassie any more; an old 3D choice becomes Cursor Cassie', async (b) => {
  const { ctx, page, errors } = await open(b, { server: false, lite: 'off', state: { groqKey: 'gsk_test', look: 'felt' } });
  await page.waitForTimeout(600);
  expect(await page.locator('#look-select').count() === 0 && !/3D felt/.test(await page.content()), 'the 3D option should be gone from Appearance');
  expect(await page.locator('#mascot.has2d').count() === 1, 'Cursor Cassie should show even for someone who had picked the 3D Cassie');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('cassie.v2')).look === undefined), 'the old choice is forgotten');
  expect(errors.length === 0, 'page errors: ' + errors.join('; '));
  await ctx.close();
});

// Every animation frame from the first paint: is a flat Cassie (or the old cursor drawing) visible,
// is a 3D Cassie visible, and was a Cassie's place ever empty (with Reduce Motion, Lite mode or no 3D)
const WATCH_CASSIE = () => {
  const m = window.__mon = { frames: 0, flatFrames: 0, d3First: -1, flatAfter3d: 0, oldDrawing: 0, emptyChat: 0, flatChatFirst: -1, chatSeen: -1 };
  const vis = (e) => { if (!e.isConnected) return false; const cs = getComputedStyle(e); if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const tick = () => {
    m.frames++;
    const flats = [...document.querySelectorAll('svg.cassie-bot')].filter(vis), d3 = [...document.querySelectorAll('canvas.cassie-bot-3d')].filter(vis);
    if (document.querySelector('.mascot-fallback')) m.oldDrawing++;
    if (flats.length) { m.flatFrames++; if (!m.flatWhere) { let e = flats[0], w = []; while (e && w.length < 4) { w.push((e.id ? '#' + e.id : '') + (typeof e.className === 'string' && e.className ? '.' + e.className.split(' ')[0] : '')); e = e.parentElement; } m.flatWhere = w.join(' < '); } }
    if (d3.length && m.d3First < 0) m.d3First = m.frames;
    if (flats.length && m.d3First >= 0) m.flatAfter3d++;
    const root = document.getElementById('cassie-2d-root');
    if (root && vis(root)) {
      if (m.chatSeen < 0) m.chatSeen = m.frames;
      const svg = root.querySelector('svg.cassie-bot'), c = root.querySelector('canvas.cassie-bot-3d');
      if (svg && vis(svg) && m.flatChatFirst < 0) m.flatChatFirst = m.frames;
      if (!(svg && vis(svg)) && !(c && vis(c))) { m.emptyChat++; if (!m.emptyWhy) m.emptyWhy = svg ? (() => { const cs = getComputedStyle(svg), r = svg.getBoundingClientRect(); return [cs.visibility, svg.style.visibility, matchMedia('(prefers-reduced-motion: reduce)').matches, getComputedStyle(document.getElementById('mascot')).visibility, document.getElementById('mascot').className, Math.round(r.width), document.readyState].join(','); })() : 'no svg yet ' + document.readyState; }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};
test('one Cassie from the first paint: with 3D, no flat Cassie or old drawing is ever seen before (or after) the 3D one, in the chat, the Island and the voice screen; with Reduce Motion, Lite mode or no 3D the flat one shows from the start and never swaps; the replaced voice files are gone', async (b) => {
  const slowThree = (ms) => async (ctx) => ctx.route(/explore\/three\.module\.min\.js/, async (route) => { await new Promise((r) => setTimeout(r, ms)); return route.continue(); });
  const mon = (page) => page.evaluate(() => ({ ...window.__mon }));
  for (const [size, device, viewport] of [['390x844', 'iPhone 13', { width: 390, height: 844 }], ['1280x800', 'Desktop Chrome', { width: 1280, height: 800 }]]) {
    // 1. with 3D (three.js slowed down by 2.5 s): her place stays empty, then only the 3D Cassie
    const { ctx, page, errors } = await open(b, { device, viewport, scale: 1, lite: 'off', server: false, state: { groqKey: 'gsk_test', tab: 'chat' }, setup: slowThree(2500), fakeGroq: async () => { await new Promise((r) => setTimeout(r, 600)); return { text: 'An answer about cells.' }; } });
    await ctx.addInitScript(WATCH_CASSIE);
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#cassie-2d-root canvas.cassie-bot-3d') && +getComputedStyle(document.querySelector('#cassie-2d-root canvas.cassie-bot-3d')).opacity > 0.9, null, { timeout: 30000 });
    let m = await mon(page);
    expect(m.d3First > 0 && m.flatFrames === 0 && m.oldDrawing === 0, `${size}: only the 3D Cassie, from the first frame: ` + JSON.stringify(m));
    // the Island bot and the voice screen bot: the same
    await page.fill('#prompt-input', 'What is a cell?');
    await page.press('#prompt-input', 'Enter');
    await page.waitForSelector('#island.live .cassie-bot', { state: 'attached', timeout: 5000 });
    await page.waitForFunction(() => document.querySelector('#island canvas.cassie-bot-3d'), null, { timeout: 20000 });
    await page.waitForSelector('text=An answer about cells.', { timeout: 10000 });
    await studioOn(page);
    await page.evaluate(() => openVoice('chat'));
    await page.waitForSelector('.vc:not([hidden])', { timeout: 8000 });
    await page.waitForFunction(() => document.querySelector('.vc-bot canvas.cassie-bot-3d'), null, { timeout: 20000 });
    await page.waitForTimeout(500);
    m = await mon(page);
    expect(m.flatFrames === 0 && m.flatAfter3d === 0 && m.oldDrawing === 0, `${size}: the Island and the voice screen show only the 3D Cassie: ` + JSON.stringify(m));
    expect(!errors.length, `${size}: page errors: ` + errors.join('; '));
    await ctx.close();
  }
  // 2. Reduce Motion, Lite mode, and three.js failing: the flat Cassie, never a 3D one
  for (const [why, o] of [['Reduce Motion', { lite: 'off', motion: 'reduce' }], ['Lite mode', { lite: 'on' }], ['three.js failing', { lite: 'off', fail: true }]]) {
    const { ctx, page, errors } = await open(b, { device: 'Desktop Chrome', viewport: { width: 1280, height: 800 }, scale: 1, lite: o.lite, server: false, state: { groqKey: 'gsk_test', tab: 'chat' },
      setup: o.fail ? (c) => c.route(/explore\/three\.module\.min\.js/, (r) => r.abort()) : null });
    if (o.motion) await page.emulateMedia({ reducedMotion: o.motion });
    await ctx.addInitScript(WATCH_CASSIE);
    await page.reload();
    await page.waitForFunction(() => { const s = document.querySelector('#cassie-2d-root svg.cassie-bot'); return s && getComputedStyle(s).visibility !== 'hidden'; }, null, { timeout: 15000 });
    await page.waitForTimeout(3000);
    let m = await mon(page);
    expect(m.d3First < 0 && m.flatAfter3d === 0 && m.oldDrawing === 0, `${why}: the flat Cassie and never a 3D one: ` + JSON.stringify(m));
    if (!o.fail) expect(m.emptyChat === 0, `${why}: the flat Cassie from the first frame her place shows: ` + JSON.stringify(m));
    if (o.fail) {
      // remembered: the next time she opens flat from the start, and three.js isn't even asked for
      expect(await page.evaluate(() => window.CassieBot.failed3d()), 'the failed 3D is remembered');
      const asked = [];
      page.on('request', (r) => { if (/three\.module/.test(r.url())) asked.push(r.url()); });
      await page.reload();
      await page.waitForTimeout(2500);
      m = await mon(page);
      expect(m.emptyChat === 0 && m.flatChatFirst === m.chatSeen && m.d3First < 0 && !asked.length, 'next time: flat from the first frame, no 3D asked for: ' + JSON.stringify(m) + ' ' + asked.join(' '));
    }
    expect(!errors.length, `${why}: page errors: ` + errors.join('; '));
    await ctx.close();
  }
  // 3. the replaced files are gone, nothing names them, and the site doesn't ship them
  for (const gone of ['voice', 'tests/fixtures/kokoro']) expect(!fs.existsSync(path.join(ROOT, gone)), gone + ' is deleted');
  const walk = (d) => fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).flatMap((e) => (['.git', 'node_modules', '_site', 'promo'].includes(e.name) ? [] : e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const named = walk('.').filter((f) => /\.(js|mjs|html|css|sh|json|md)$|_headers$/.test(f) && !/smoke\.cjs$/.test(f))
    .filter((f) => /voice\/(voice-worker|kokoro|ort-wasm|README|KOKORO)|fixtures\/kokoro|mascot-fallback|huggingface\.co\b(?!\$)/i.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
  expect(!named.length, 'still names a deleted file or the old voice host: ' + named.join(', '));
  expect(!/\bvoice\b/.test(fs.readFileSync(path.join(ROOT, 'scripts/build-site.sh'), 'utf8').replace(/voice\.js/g, '')), 'the build no longer copies voice/');
  if (fs.existsSync(path.join(ROOT, '_site'))) expect(!fs.existsSync(path.join(ROOT, '_site/voice')), 'the built site has no voice/ folder (run the build again)');
});

test('Cursor Cassie: the default Cassie, she reacts to the app', async (b) => {
  const { ctx, page, errors } = await open(b, { server: false, lite: 'off', state: { groqKey: 'gsk_test' }, fakeGroq: async () => { await new Promise((r) => setTimeout(r, 800)); return { text: 'An answer.' }; } });
  await page.waitForSelector('#mascot.has2d .cassie-bot', { state: 'attached', timeout: 5000 }); // (her place, empty until the 3D one is drawn)
  expect(await page.locator('#cassie-3d-root').count() === 0, 'the 3D bot should not load with Cursor Cassie');
  await page.fill('#prompt-input', 'What is a cell?');
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => bot2d.state) === 'listening', 'should listen while typing');
  await page.press('#prompt-input', 'Enter');
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => bot2d.state) === 'thinking', 'should think while waiting');
  await page.waitForSelector('text=An answer.', { timeout: 10000 });
  const proud = await page.waitForFunction(() => bot2d.state === 'proud', null, { timeout: 3000 }).then(() => true, () => false);
  expect(proud, 'should be proud when the answer arrives (was ' + await page.evaluate(() => bot2d.state) + ')');
  expect(errors.length === 0, 'page errors: ' + errors.join('; '));
  await ctx.close();
});

test('Cassie Island: the top bar shows what she is doing, then says Done', async (b) => {
  const { ctx, page, errors } = await open(b, { server: false, state: { groqKey: 'gsk_test' }, fakeGroq: async () => { await new Promise((r) => setTimeout(r, 900)); return { text: 'Island answer.' }; } });
  const island = page.locator('#island');
  expect(!(await island.evaluate((n) => n.classList.contains('live'))), 'island should be tucked away at first');
  await page.fill('#prompt-input', 'What is a cell?');
  await page.press('#prompt-input', 'Enter');
  await page.waitForSelector('#island.live .cassie-bot', { state: 'attached', timeout: 3000 });
  expect(/Thinking/.test(await island.innerText()), 'island should say Thinking: ' + await island.innerText());
  if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/island-thinking.png', clip: { x: 0, y: 0, width: 412, height: 130 } });
  await page.waitForSelector('text=Island answer.', { timeout: 10000 });
  await page.waitForTimeout(100);
  expect(await island.getAttribute('data-mood') === 'done' && /Done/.test(await island.innerText()), 'island should say Done');
  if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/island-done.png', clip: { x: 0, y: 0, width: 412, height: 130 } });
  await page.waitForFunction(() => !document.getElementById('island').classList.contains('live'), null, { timeout: 4000 });
  expect(errors.length === 0, 'page errors: ' + errors.join('; '));
  await ctx.close();
});

// Drag something over the page (like from the desktop): dragenter + dragover, then drop.
const dragIn = (page, payload, target = '#chat-log') => page.evaluate(([p, sel]) => {
  const dt = new DataTransfer();
  if (p.text) dt.setData('text/plain', p.text);
  if (p.b64) { const bin = atob(p.b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); dt.items.add(new File([u], p.name, { type: p.type })); }
  window.__dt = dt;
  const t = document.querySelector(sel);
  t.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }));
  t.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
}, [payload, target]);
const dropOn = (page, sel = '.isle-card') => page.evaluate((s) => {
  const t = document.querySelector(s);
  t.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: window.__dt }));
  return t.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: window.__dt }));
}, sel);
const isleStep = (page) => page.evaluate(() => document.querySelector('.isle-card').dataset.step || '');

test('Island drop: drop a PDF on Cassie → Summarize → the answer shows in the Island', async (b) => {
  const { ctx, page, errors, groqCalls } = await open(b, { server: false, state: { groqKey: 'gsk_test' }, fakeGroq: () => ({ text: 'Summary: water evaporates, condenses and falls as rain.' }) });
  const pdf = await page.evaluate(async () => {
    const blob = await window.CassieExport.toPdf('# Water cycle\n\nEvaporation, condensation and precipitation move water around the Earth.', 'Water cycle');
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = ''; for (const x of buf) s += String.fromCharCode(x);
    return btoa(s);
  });
  await dragIn(page, { b64: pdf, name: 'water.pdf', type: 'application/pdf' });
  expect(await isleStep(page) === 'drop', 'dragging a file over the app should open the drop zone: ' + await isleStep(page));
  expect(/Drop it here/.test(await page.locator('.isle-card').innerText()), 'the drop zone should say Drop it here');
  expect(await page.evaluate(() => document.getElementById('island').classList.contains('carded')), 'the pill should give way to the card');
  if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/isle-drop.png', clip: { x: 0, y: 0, width: 412, height: 260 } });
  const prevented = !(await dropOn(page));
  expect(prevented, 'the drop should be handled by Cassie, not the browser');
  await page.waitForFunction(() => document.querySelector('.isle-card').dataset.step === 'ready', null, { timeout: 15000 });
  const card = page.locator('.isle-card');
  expect(/water\.pdf is ready/.test(await card.innerText()) && /What should I do with it/.test(await card.innerText()), 'ready card: ' + await card.innerText());
  for (const label of ['Ask about it', 'Summarize', 'Make a reviewer', 'Quiz me']) expect(await card.getByRole('button', { name: label }).count() === 1, 'missing action ' + label);
  if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/isle-ready.png', clip: { x: 0, y: 0, width: 412, height: 300 } });
  await card.getByRole('button', { name: 'Summarize' }).click();
  await page.waitForFunction(() => document.querySelector('.isle-card').dataset.step === 'ans', null, { timeout: 15000 });
  expect(/water evaporates/.test(await page.locator('.isle-ans-body').innerText()), 'the answer should show in the Island');
  expect(/condensation/i.test(JSON.stringify(groqCalls)), 'the PDF text should reach the AI');
  expect(await page.locator('#chat-log .bubble-assistant', { hasText: 'water evaporates' }).count() === 1, 'the answer should be in the chat too');
  if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/isle-answer.png', clip: { x: 0, y: 0, width: 412, height: 420 } });
  await card.getByRole('button', { name: 'Open in chat' }).click();
  await page.waitForFunction(() => !document.querySelector('.isle-card').classList.contains('open'), null, { timeout: 3000 });
  expect(errors.length === 0, 'page errors: ' + errors.join('; '));
  await ctx.close();
});

test('Island drop: highlighted words and a photo dropped on Cassie, with Ask about it', async (b) => {
  const { ctx, page, errors, groqCalls } = await open(b, { server: false, state: { groqKey: 'gsk_test' }, fakeGroq: (body) => ({ text: JSON.stringify(body).includes('image_url') ? 'The picture is a red square.' : 'x = 4, because 2x = 8.' }) });
  // words dragged from another window
  await dragIn(page, { text: 'Solve 2x + 3 = 11' });
  await dropOn(page);
  await page.waitForFunction(() => document.querySelector('.isle-card').dataset.step === 'ready', null, { timeout: 5000 });
  const card = page.locator('.isle-card');
  expect(/Got your words/.test(await card.innerText()) && /2x \+ 3 = 11/.test(await page.locator('.isle-peek').innerText()), 'the words should show: ' + await card.innerText());
  await card.getByRole('button', { name: 'Answer it' }).click();
  await page.waitForFunction(() => document.querySelector('.isle-card').dataset.step === 'ans', null, { timeout: 15000 });
  expect(/x = 4/.test(await page.locator('.isle-ans-body').innerText()), 'answer about the words');
  expect(JSON.stringify(groqCalls[groqCalls.length - 1]).includes('2x + 3 = 11'), 'the dropped words should be in the question');
  // a photo, then Ask about it with my own question
  await dragIn(page, { b64: await redPng(page), name: 'shape.png', type: 'image/png' });
  expect(await isleStep(page) === 'drop', 'a new drag opens the drop zone again');
  await dropOn(page);
  await page.waitForFunction(() => document.querySelector('.isle-card').dataset.step === 'ready', null, { timeout: 8000 });
  expect(await page.locator('.isle-thumb').isVisible(), 'the photo should show in the card');
  await card.getByRole('button', { name: 'Ask about it' }).click();
  expect(await isleStep(page) === 'ask', 'Ask about it should open the question box');
  await page.fill('.isle-input', 'What colour is this shape?');
  await page.press('.isle-input', 'Enter');
  await page.waitForFunction(() => document.querySelector('.isle-card').dataset.step === 'ans', null, { timeout: 15000 });
  expect(/red square/.test(await page.locator('.isle-ans-body').innerText()), 'answer about the photo: ' + await page.locator('.isle-ans-body').innerText());
  const last = JSON.stringify(groqCalls[groqCalls.length - 1]);
  expect(last.includes('image_url') && last.includes('What colour is this shape?'), 'the photo and my question should both be sent');
  // a drag that leaves without dropping tidies itself away
  await card.locator('.isle-x').click();
  await dragIn(page, { text: 'never dropped' });
  expect(await isleStep(page) === 'drop', 'drop zone opens');
  await page.waitForFunction(() => !document.querySelector('.isle-card').classList.contains('open'), null, { timeout: 4000 });
  // a file nobody can read says so
  await dragIn(page, { b64: Buffer.from('just bytes').toString('base64'), name: 'thing.xyz', type: 'application/octet-stream' });
  await dropOn(page);
  await page.waitForFunction(() => document.querySelector('.isle-card').dataset.step === 'err', null, { timeout: 5000 });
  expect(/can’t open thing\.xyz/.test(await card.innerText()), 'unreadable file message: ' + await card.innerText());
  expect(errors.length === 0, 'page errors: ' + errors.join('; '));
  await ctx.close();
});

test('the web app has no pop-out (it lives in the Chrome extension)', async (b) => {
  const { ctx, page } = await open(b, { device: 'Desktop Chrome' });
  expect(await page.locator('#popout-btn').count() === 0, 'no pop-out button in the web app');
  const ext = require('fs').readFileSync(require('path').join(ROOT, 'extension/panel.js'), 'utf8');
  expect(/documentPictureInPicture/.test(ext) && /id="t-pop"/.test(require('fs').readFileSync(require('path').join(ROOT, 'extension/panel.html'), 'utf8')), 'the extension side panel has the pop-out');
  await ctx.close();
});

// a click in the 3D view never navigates: don't wait for a navigation on a page busy drawing 3D
// (where the 3D is drawn in software, that wait timed out)
const NO_NAV = { noWaitAfter: true };
test.slow('Explore 3D: turn a cell, tap a part, ask Cassie about it, then quiz on the plant cell', async (b) => {
  const { ctx, page, errors, groqCalls } = await open(b, { server: false, scale: 1, state: { groqKey: 'gsk_test' }, fakeGroq: () => ({ text: 'The Golgi apparatus packages proteins, like a post office.' }) });
  await open3d(page, 'cells3d');
  await page.waitForSelector('.x3d:not([hidden])', { timeout: 20000 });
  await page.click('.x3d-switch [data-cell="animal"]', NO_NAV);
  await page.waitForSelector('.x3d-chip[data-part="nucleus"]', { timeout: 20000 });
  const chips = await page.$$eval('.x3d-chip', (c) => c.map((x) => x.dataset.part));
  for (const id of ['membrane', 'nucleus', 'nucleolus', 'rer', 'ser', 'golgi', 'mito', 'ribosome', 'lysosome', 'centrioles']) expect(chips.includes(id), 'animal cell is missing ' + id + ': ' + chips);
  expect(!chips.includes('chloroplast') && !chips.includes('wall'), 'an animal cell has no chloroplasts or wall');
  // tapping the 3D picture picks the part under the finger
  await page.waitForTimeout(800);
  const at = await page.evaluate(() => { const el = document.querySelector('.x3d-label[data-part="nucleolus"]'); const m = /translate\(([\d.]+)px, ([\d.]+)px\)/.exec(el.style.transform); return { x: +m[1], y: +m[2] }; });
  await page.click('.x3d-tools [data-tool="reset"]', NO_NAV);
  // a small drag stops the slow spin (like a finger would), so the nucleus stays where we measure it
  const cb = await page.locator('.x3d-canvas').boundingBox();
  await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height * 0.8);
  await page.mouse.down(); await page.mouse.move(cb.x + cb.width / 2 + 12, cb.y + cb.height * 0.8, { steps: 3 }); await page.mouse.up();
  await page.waitForTimeout(1500);
  const at2 = await page.evaluate(() => { const el = document.querySelector('.x3d-label[data-part="nucleolus"]'); const m = /translate\(([\d.]+)px, ([\d.]+)px\)/.exec(el.style.transform); return { x: +m[1], y: +m[2] }; });
  await page.mouse.click(at2.x, at2.y);
  await page.waitForSelector('.x3d-sheet:not([hidden])', { timeout: 30000 });
  expect(/Nucleolus|Nucleus|Nuclear envelope/.test(await page.locator('.x3d-sheet h3').innerText()), 'tapping the nucleus area picks it: ' + await page.locator('.x3d-sheet h3').innerText() + JSON.stringify(at));
  // pick from the list, read about it, ask Cassie
  await page.click('.x3d-chip[data-part="golgi"]', NO_NAV);
  expect(/Golgi apparatus/.test(await page.locator('.x3d-sheet h3').innerText()) && /post office/.test(await page.locator('.x3d-sheet').innerText()), 'the Golgi card should show');
  if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/explore-golgi.png' });
  await page.click('.x3d-act[data-act="ask"]', NO_NAV);
  await seen(page, '.x3d .lab-helper:not([hidden]) .hp-a', 'post office');
  expect(await page.locator('.x3d').isVisible() && /Golgi apparatus/.test(await page.locator('.x3d-sheet h3').innerText()), 'the answer shows in the 3D view, which stays where it was');
  await page.click('.lab-helper .hp-x', NO_NAV);
  expect(/golgi apparatus of an animal cell/i.test(JSON.stringify(groqCalls.at(-1))), 'Cassie is asked about the Golgi of an animal cell');
  // plant cell → quiz (the 3D view is still open: switch cells right there)
  await page.click('.x3d-switch [data-cell="plant"]', NO_NAV);
  await page.waitForSelector('.x3d-chip[data-part="chloroplast"]', { timeout: 30000 });
  const plant = await page.$$eval('.x3d-chip', (c) => c.map((x) => x.dataset.part));
  for (const id of ['wall', 'vacuole', 'chloroplast', 'plasmodesmata', 'nucleus', 'mito']) expect(plant.includes(id), 'plant cell is missing ' + id);
  expect(!plant.includes('centrioles'), 'a plant cell shows no centrioles');
  await page.click('.x3d-chip[data-part="chloroplast"]', NO_NAV);
  expect(/photosynthesis/.test(await page.locator('.x3d-sheet').innerText()) && /Only in plant cells/.test(await page.locator('.x3d-sheet').innerText()), 'the chloroplast card');
  await page.click('.x3d-act[data-act="quiz"]', NO_NAV);
  await seen(page, '.x3d .lab-helper:not([hidden]) .hp-title', 'Quiz me');
  await seen(page, '.lab-helper .hp-quiz .hp-err, .lab-helper .hp-quiz .hp-q');
  expect(/multiple-choice quiz about \\"the parts of a plant cell/.test(JSON.stringify(groqCalls.at(-1))), 'the quiz is about the plant cell: ' + JSON.stringify(groqCalls.at(-1)).slice(0, 300));
  expect(await page.locator('#quiz-btn.active').count() === 0, 'the chat quiz did not start');
  // a link opens it straight away
  await page.goto(APP + '?explore=plant');
  await page.waitForSelector('.x3d:not([hidden]) .x3d-chip[data-part="wall"]', { timeout: 20000 });
  expect(errors.length === 0, 'page errors: ' + errors.join('; '));
  await ctx.close();
});

// A stand-in microphone and speaker: tests can "say" things and read what Cassie said aloud.
// Bella's studio voice, switched on in a page that is already open (a tiny WAV for each sentence): for
// tests that open the voice screen, which only opens when Bella can speak
const studioOn = (page) => page.evaluate(() => {
  if (window.__studioOn) return window.CassieVoice.studio.refresh();
  window.__studioOn = true;
  const realFetch = window.fetch.bind(window);
  const wav = () => { const n = 800, b = new DataView(new ArrayBuffer(44 + n * 2)), w = (o, t) => [...t].forEach((c, i) => b.setUint8(o + i, c.charCodeAt(0)));
    w(0, 'RIFF'); b.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt '); b.setUint32(16, 16, true); b.setUint16(20, 1, true); b.setUint16(22, 1, true); b.setUint32(24, 8000, true); b.setUint32(28, 16000, true); b.setUint16(32, 2, true); b.setUint16(34, 16, true); w(36, 'data'); b.setUint32(40, n * 2, true); return b.buffer; };
  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (url.pathname !== '/speak') return realFetch(input, init);
    if (!init.method || init.method === 'GET') return new Response('{"on":true,"left":9000,"back":"2026-11-01"}', { headers: { 'content-type': 'application/json' } });
    return new Response(wav(), { headers: { 'content-type': 'audio/mpeg', 'x-speak': 'new' } });
  };
  return window.CassieVoice.studio.setup({ server: 'https://studio.test', uid: 'test-uid-0002' });
});
const FAKE_VOICE = (opts) => {
  window.__spoken = []; window.__recs = []; window.__shown = [];
  // Bella's studio voice, faked in the page: GET /speak says what's left (window.__studioCfg.left), POST
  // /speak answers with a tiny WAV and is logged in window.__studio ({ text, ok }); from the
  // failFrom-th sentence on it fails. Every "Cassie types instead" line shown is counted in __notes.
  window.__studio = []; window.__notes = [];
  window.__studioCfg = Object.assign({ on: true, left: 9000, back: '2026-11-01', failFrom: null }, opts.studio || {});
  new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => { if (n.classList && n.classList.contains('cv-note')) window.__notes.push(n.textContent); })))
    .observe(document, { subtree: true, childList: true });
  if (!opts.realStudio) {
    const realFetch = window.fetch.bind(window);
    const wav = () => { const n = 800, b = new DataView(new ArrayBuffer(44 + n * 2)), w = (o, t) => [...t].forEach((c, i) => b.setUint8(o + i, c.charCodeAt(0)));
      w(0, 'RIFF'); b.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt '); b.setUint32(16, 16, true); b.setUint16(20, 1, true); b.setUint16(22, 1, true); b.setUint32(24, 8000, true); b.setUint32(28, 16000, true); b.setUint16(32, 2, true); b.setUint16(34, 16, true); w(36, 'data'); b.setUint32(40, n * 2, true); return b.buffer; };
    window.fetch = async (input, init = {}) => {
      const url = new URL(typeof input === 'string' ? input : input.url, location.href);
      if (url.pathname !== '/speak') return realFetch(input, init);
      const c = window.__studioCfg;
      if (!init.method || init.method === 'GET') return new Response(JSON.stringify(!c.on ? { on: false, left: 0 } : c.guest ? { on: true, left: 0, back: '', guest: true } : { on: true, left: c.left, back: c.back, ...(c.max ? { max: c.max, used: c.used || 0 } : {}) }), { headers: { 'content-type': 'application/json' } });
      const body = JSON.parse(init.body), ok = c.on && !(c.failFrom != null && window.__studio.length >= c.failFrom);
      window.__studio.push({ text: body.text, voice: body.voice, ok });
      if (!ok) { if (c.failHeaders) c.left = 0; return new Response('{"error":{"message":"the studio voice failed"}}', { status: c.failStatus || 502, headers: c.failHeaders || {} }); } // (failHeaders: used up, so nothing is left)
      c.left = Math.max(0, c.left - body.text.length);
      return new Response(wav(), { headers: { 'content-type': 'audio/mpeg', 'x-speak': 'new' } });
    };
    addEventListener('DOMContentLoaded', () => { if (window.CassieVoice) window.CassieVoice.studio.setup({ server: 'https://studio.test', uid: 'test-uid-0001' }); });
  }
  // what Cassie says on the voice screen (Bella speaks it, or it's shown while her voice downloads)
  new MutationObserver(() => { const el = document.querySelector('.vc-cassie'); const t = el && el.textContent; if (t && t !== window.__lastShown) { window.__lastShown = t; window.__shown.push(t); } })
    .observe(document, { subtree: true, childList: true, characterData: true });
  const synth = { speaking: false, cancelled: 0, getVoices: () => [{ name: 'Test Voice (Natural)', lang: 'en-US' }], addEventListener() {},
    cancel() { this.cancelled++; }, speak(u) { window.__spoken.push(u.text); window.__pitch = u.pitch; setTimeout(() => u.onend && u.onend(), 30); } };
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
  navigator.mediaDevices.getUserMedia = async () => new MediaStream();
  window.MediaRecorder = class { constructor() { this.state = 'inactive'; this.mimeType = 'audio/webm'; } static isTypeSupported() { return true; }
    start() { this.state = 'recording'; } stop() { if (this.state === 'inactive') return; this.state = 'inactive'; this.ondataavailable && this.ondataavailable({ data: new Blob(['fake sound'], { type: 'audio/webm' }) }); setTimeout(() => this.onstop && this.onstop(), 10); } };
  if (opts.noRecognizer) {
    delete window.SpeechRecognition; delete window.webkitSpeechRecognition;
    Object.defineProperty(window, 'webkitSpeechRecognition', { value: undefined, configurable: true });
    return;
  }
  window.SpeechRecognition = class extends EventTarget { constructor() { super(); window.__recs.push(this); this.live = false; } start() { this.live = true; } stop() { this.live = false; setTimeout(() => this.onend && this.onend(), 5); } abort() { this.live = false; } };
  window.__say = (text) => { const r = window.__recs.filter((x) => x.live).at(-1); const res = [{ transcript: text }]; res.isFinal = true; r.onresult({ resultIndex: 0, results: [res] }); };
};

// Cassie speaks only in Bella's studio voice. A session (a lesson, a Listen, a voice chat) uses her only
// when what's left of the month covers all of it; otherwise she types from the start and says so once.
// If Bella fails partway, the rest is typed with the same line. No other voice, no Keep going, ever.
test('every stylesheet is whole: its braces balance and no rule is cut off (a broken one silently drops the rules after it)', async () => {
  const sheets = ['style.css', 'labs/labs.css', 'landing/landing.css'].filter((f) => fs.existsSync(path.join(ROOT, f)));
  for (const f of sheets) {
    const css = fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""');
    let depth = 0, low = 0;
    for (const c of css) { if (c === '{') depth++; else if (c === '}') { depth--; low = Math.min(low, depth); } }
    expect(depth === 0 && low === 0, `${f}: braces don’t balance (end ${depth}, lowest ${low})`);
    const cut = css.split('\n').map((l, i) => [i + 1, l.trim()]).filter(([, l]) => /,\s*}$|,\s*$/.test(l) && /}\s*$/.test(l));
    expect(!cut.length, `${f}: a selector list runs into a closing brace: ` + JSON.stringify(cut.slice(0, 3)));
  }
});

test.slow('Bella only: a 7-step lesson and a long Listen in Bella’s voice when there is enough left; too little left types with one line; Bella failing midway types the rest; the device voice is never used; no Keep going anywhere; Settings says when she is back', async (b) => {
  const LONG = Array.from({ length: 12 }, (_, i) => `Sentence ${i + 1} says mitochondria turn food into energy the cell can use.`).join(' ');
  const steps = Array.from({ length: 7 }, (_, i) => ({ say: `Step ${i + 1} is here.`, point: 0 }));
  const cards = [{ id: 'c1', f: 'Powerhouse of the cell?', b: 'Mitochondria', deck: 'Biology', box: 0, due: 0, at: 0 }];
  const { ctx, page, errors } = await open(b, { server: false, device: 'Desktop Chrome', state: { groqKey: 'gsk_test', cards, hearing: 'fast' },
    fakeGroq: (body) => ({ text: /Reply with ONLY JSON/.test(JSON.stringify(body.messages)) ? JSON.stringify({ steps }) : LONG }) });
  await ctx.addInitScript(FAKE_VOICE, {});
  await page.reload();
  await page.waitForFunction(() => window.CassieVoice.studio.known() && window.CassieVoice.studio.on(), null, { timeout: 5000 });
  const LINE = await page.evaluate(() => CassieErrors.say('voice_typing'));
  expect(LINE === 'Cassie’s voice isn’t available right now, so she’ll type her answers instead.', 'the one line, in plain words: ' + LINE);
  const studio = () => page.evaluate(() => window.__studio.slice());
  const notes = () => page.evaluate(() => window.__notes.slice());
  const clearNote = () => page.evaluate(() => document.querySelectorAll('.cv-note').forEach((n) => n.remove()));
  const setLeft = (left, extra = {}) => page.evaluate(([l, x]) => { Object.assign(window.__studioCfg, { left: l, ...x }); return window.CassieVoice.studio.refresh(); }, [left, extra]);
  const settingsLine = async () => { await page.evaluate(() => openSettings()); const t = await page.locator('#hv-state').innerText(); await page.evaluate(() => closeSettings && closeSettings()).catch(() => {}); return t; };

  // Settings, Voice: Bella is ready
  expect(/^Jessica’s voice is ready\./.test(await settingsLine()), 'Settings says Jessica is ready: ' + await page.locator('#hv-state').innerText());
  await page.keyboard.press('Escape');

  // 1. a long Listen with enough left: every sentence in Bella's voice, no line
  await ask(page, 'What do mitochondria do?');
  await page.click('.bubble-assistant .listen-btn');
  await page.waitForFunction(() => !document.querySelector('.bubble-assistant .listen-btn.on'), null, { timeout: 20000 });
  let st = await studio();
  expect(st.length >= 3 && st.every((x) => x.ok && x.voice === 'woman') && /Sentence 1 /.test(st[0].text) && /Sentence 12 /.test(st.at(-1).text), 'the whole answer went to Bella: ' + JSON.stringify(st.map((x) => x.text.slice(0, 14))));
  expect((await notes()).length === 0, 'no line when she can speak');
  let played = await page.evaluate(() => window.CassieVoice.played());
  expect(played.length === st.length && played.every((x) => x.kind === 'studio' && x.voice === 'bella'), 'only Bella spoke: ' + JSON.stringify(played));

  // 2. too little left: nothing is spoken, the words stay, the one line shows once
  await setLeft(50);
  let n0 = (await studio()).length;
  await page.click('.bubble-assistant .listen-btn');
  await page.waitForTimeout(800);
  await page.click('.bubble-assistant .listen-btn').catch(() => {}); // (tapped twice: still one line)
  await page.waitForTimeout(600);
  expect((await studio()).length === n0, 'nothing went to the studio voice');
  // (too little left, with a known day: the line says when she's back, not just "not available")
  const RESTING = 'Cassie’s voice is resting until 1 November. Until then she types her answers.';
  expect(JSON.stringify(await notes()) === JSON.stringify([RESTING]), 'the line showed once, with when she’s back: ' + JSON.stringify(await notes()));
  expect(/Sentence 12 says/.test(await page.locator('.bubble-assistant').last().innerText()), 'the answer is on the screen');
  // Settings says when she is back
  const resting = await settingsLine();
  expect(resting === 'Cassie’s voice is resting until 1 November. Until then she types her answers.', 'Settings says when she is back: ' + resting);
  await page.keyboard.press('Escape');
  // voice chat: the same line, and the chat stays typed (the voice screen never opens)
  await clearNote();
  await page.click('#voice-btn');
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => !document.querySelector('.vc') || document.querySelector('.vc').hidden), 'the voice screen did not open');
  expect((await notes()).length === 2 && (await notes())[1] === RESTING, 'voice chat said the same line');
  expect(await page.evaluate(() => document.activeElement && document.activeElement.id === 'prompt-input'), 'the typed chat is ready to type in');
  expect((await studio()).length === n0, 'still nothing spoken');

  // 3. flashcards, enough left: the deck is read in Bella's voice
  await clearNote(); await setLeft(9000);
  await page.evaluate(() => window.CassieCards.open());
  await page.click('[data-listen="Biology"]');
  await page.waitForSelector('.fc-listening .fc-text >> text=Mitochondria', { timeout: 15000 });
  await page.click('[data-lstop]');
  st = await studio();
  expect(st.some((x) => /Powerhouse of the cell/.test(x.text)) && st.some((x) => /^Mitochondria/.test(x.text)), 'the cards went to Bella: ' + JSON.stringify(st.slice(-2)));
  await page.click('.fc-back').catch(() => {});
  await page.keyboard.press('Escape');

  // 4. a 7-step lesson with enough left: every step in Bella's voice
  await page.evaluate(() => openLabs('atom'));
  await page.waitForSelector('.lab-view:not([hidden])[data-lab="atom"] .lab-controls > *', { timeout: 15000 });
  n0 = (await studio()).length;
  const sevenOfSeven = () => page.waitForFunction(() => /7 of 7/.test((document.querySelector('.tut-step') || {}).textContent || ''), null, { timeout: 45000 });
  await page.click('.lab-teach');
  await sevenOfSeven();
  await page.waitForFunction((n) => window.__studio.length >= n + 7, n0, { timeout: 10000 });
  st = (await studio()).slice(n0);
  expect(st.length === 7 && st.every((x, i) => x.ok && x.text === `Step ${i + 1} is here.`), 'all 7 steps in Bella’s voice: ' + JSON.stringify(st));
  expect((await notes()).length === 2, 'no line in a lesson she can say');

  // 5. Bella fails at step 4: tried once more in her voice, then the rest is typed with the line; no other voice
  await page.click('.tut-x');
  n0 = (await studio()).length;
  await page.evaluate((n) => { window.__studioCfg.failFrom = n + 3; }, n0);
  await page.click('.lab-teach');
  await page.click('.tut-resume:not([hidden]) .tut-restart');
  await sevenOfSeven();
  await page.waitForTimeout(500);
  st = (await studio()).slice(n0);
  expect(st.length === 5 && st.slice(0, 3).every((x) => x.ok) && st.slice(3).every((x) => !x.ok && /Step 4/.test(x.text)), 'steps 1 to 3 said, step 4 tried twice, nothing after: ' + JSON.stringify(st));
  expect((await notes()).length === 3 && (await notes())[2] === LINE, 'the line once when she stopped: ' + JSON.stringify(await notes()));
  expect(/Step 7 is here/.test(await page.locator('.tut-say').innerText()), 'the rest of the lesson went on in text');
  await page.click('.tut-x');

  // 6. too little left for the lesson: typed from the start, the line once, Next still moves on
  await clearNote(); await setLeft(60, { failFrom: null });
  n0 = (await studio()).length;
  const notesBefore = (await notes()).length;
  await page.click('.lab-teach');
  await page.click('.tut-resume:not([hidden]) .tut-restart');
  await page.waitForFunction(() => /1 of 7/.test((document.querySelector('.tut-step') || {}).textContent || ''), null, { timeout: 15000 });
  await page.click('.tut-next');
  await page.waitForFunction(() => /[2-7] of 7/.test((document.querySelector('.tut-step') || {}).textContent || ''), null, { timeout: 5000 });
  await sevenOfSeven();
  expect((await studio()).length === n0, 'nothing went to the studio voice');
  expect((await notes()).length === notesBefore + 1, 'the line once for the whole lesson: ' + JSON.stringify((await notes()).slice(notesBefore)));
  await page.click('.tut-x');

  // 7. the device's voice was never used for anything Cassie said
  expect((await page.evaluate(() => window.__spoken)).length === 0, 'speechSynthesis was never called: ' + JSON.stringify(await page.evaluate(() => window.__spoken)));
  expect(await page.locator('.cv-pause').count() === 0, 'no pause box');
  // Settings when the studio voice isn't switched on at all
  await page.evaluate(() => { window.__studioCfg.on = false; return window.CassieVoice.studio.refresh(); });
  expect(await settingsLine() === await page.evaluate(() => CassieErrors.say('voice_not_set_up')), 'Settings says the voice isn’t switched on');
  expect(errors.length === 0, 'page errors: ' + errors.join('; '));
  await ctx.close();

  // nowhere in the app or the extension: "Keep going", or the device's voice for Cassie's words
  const files = [...fs.readdirSync(ROOT).filter((f) => /\.(js|html)$/.test(f)), ...['labs', 'explore', 'extension', 'landing'].flatMap((d) => fs.readdirSync(path.join(ROOT, d)).filter((f) => /\.(js|html)$/.test(f)).map((f) => d + '/' + f))];
  const keep = files.filter((f) => /keep going/i.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
  expect(!keep.length, '"Keep going" is still in: ' + keep.join(', '));
  // (but the little ones' labs, where Cassie says a letter or a number with the device's own free voice)
  const synth = files.filter((f) => f !== 'labs/kids.js' && /speechSynthesis|SpeechSynthesisUtterance/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
  expect(!synth.length, 'the device voice is still used in: ' + synth.join(', '));
  // the owner's voice guide: the numbers, what to raise in Cloudflare, no key, no dashes
  const guide = fs.readFileSync(path.join(ROOT, 'docs/voice-setup.md'), 'utf8');
  expect(/SPEAK_MONTHLY_CHARS/.test(guide) && /7-step/.test(guide) && /flashcard/i.test(guide) && /Checked on \d+ \w+ 20\d\d/.test(guide) && /elevenlabs\.io\/pricing/.test(guide), 'docs/voice-setup.md has the numbers, the date, the source and the variable');
  expect(!/[–—]/.test(guide) && !/sk_[a-z0-9]{20,}|xi-api-key:\s*\w{20,}/i.test(guide), 'no dashes and no key in docs/voice-setup.md');
});

// Walks the whole tour with Next: at each stop the cursor is on the real control (inside its ring), the
// card is whole on screen and not over the control, its words are 2 sentences at most with no dashes,
// and every button is 44px. Back goes back one. Returns the stops' ids and words.
async function walkTour(page, where) {
  await page.waitForSelector('.tour-card', { timeout: 8000 });
  const visited = [];
  for (let i = 0; i < 12; i++) {
    await page.waitForFunction((n) => (document.querySelector('.tour-count') || {}).textContent === `Stop ${n} of ${document.querySelector('.tour-count').textContent.split(' of ')[1]}`, i + 1, { timeout: 8000 });
    await page.waitForTimeout(1300); // (the cursor glides, and a tab finishes growing)
    const s = await page.evaluate(() => {
      const card = document.querySelector('.tour-card'), ring = document.querySelector('.tour-ring'), cur = document.getElementById('cassie-cursor');
      const c = card.getBoundingClientRect(), r = ring.hidden ? null : ring.getBoundingClientRect(), k = cur.getBoundingClientRect();
      const t = window.CassieTour.target, tr = t && t.getBoundingClientRect();
      const tip = [k.left + 1, k.top + 1], inRing = r && tr && tip[0] >= tr.left && tip[0] <= tr.right && tip[1] >= tr.top && tip[1] <= tr.bottom
        && Math.abs(r.left - (tr.left - 6)) <= 3 && Math.abs(r.top - (tr.top - 6)) <= 3 && Math.abs(r.width - (tr.width + 12)) <= 3 && Math.abs(r.height - (tr.height + 12)) <= 3;
      const over = r && !(c.right < r.left + 6 || c.left > r.right - 6 || c.bottom < r.top + 6 || c.top > r.bottom - 6);
      const small = [...card.querySelectorAll('button')].filter((b) => { const q = b.getBoundingClientRect(); return q.height < 44 || q.width < 44; }).map((b) => b.textContent);
      return { id: card.dataset.stop, count: card.querySelector('.tour-count').textContent, say: card.querySelector('.tour-say').textContent, inRing, over, cursorShown: getComputedStyle(cur).display !== 'none',
        fits: c.left >= 0 && c.top >= 0 && c.right <= innerWidth && c.bottom <= innerHeight, small, sideways: document.documentElement.scrollWidth > innerWidth + 1, text: card.innerText };
    });
    expect(s.inRing && s.cursorShown, `${where} ${s.count} (${s.id}): Cassie’s cursor is on the control and the ring is around it: ` + JSON.stringify(s));
    expect(s.fits && !s.over && !s.sideways, `${where} ${s.count} (${s.id}): the card is on screen and not over the control: ` + JSON.stringify(s));
    expect(!s.small.length, `${where} ${s.count}: buttons under 44px: ` + s.small.join(', '));
    expect(!/[–—]/.test(s.text), `${where} ${s.count}: no dashes: ` + s.text);
    expect(s.say.split(/[.!?](?:\s|$)/).filter((x) => x.trim()).length <= 2, `${where} ${s.id}: 2 sentences at most: ` + s.say);
    visited.push(s);
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/tour-${where}-${i + 1}-${s.id}.png` });
    if (i === 1) { // Back goes back one, then on again
      await page.click('.tour-card [data-t="back"]');
      await page.waitForFunction(() => /^Stop 1 of/.test(document.querySelector('.tour-count').textContent), null, { timeout: 5000 });
      await page.click('.tour-card [data-t="next"]');
      await page.waitForFunction(() => /^Stop 2 of/.test(document.querySelector('.tour-count').textContent), null, { timeout: 5000 });
    }
    const last = await page.evaluate(() => document.querySelector('.tour-card [data-t="next"]').textContent === 'Done');
    await page.click('.tour-card [data-t="next"]');
    if (last) break;
  }
  await page.waitForSelector('.tour-card', { state: 'detached', timeout: 5000 });
  return visited;
}
const tourGone = (page) => page.evaluate(() => !document.querySelector('.tour-card, .tour-ring, .tour-veil, .tour-offer') && !document.documentElement.classList.contains('touring') && getComputedStyle(document.getElementById('cassie-cursor')).display === 'none');
test.slow('the tour: never pops up after the first questions (they go straight to the ask box); offered once (as a guest and signed in), Not now says where it is and Settings, Help, Take the tour starts it; every stop points at the real control on a phone and a computer; Back, Next, Skip and Escape; voice off never speaks; about 90 seconds, 2 sentences a stop, no dashes, 44px, nothing off screen at 390x844, 360x740 and 1280x800', async (b) => {
  const PHONE = ['ask', 'quiz', 'talk', 'home', 'labs', 'games', 'cards', 'board', 'about', 'settings'];
  // 1. a guest on a phone: the first run, then "a quick tour?" once
  let { ctx, page, errors } = await open(b, { device: 'iPhone 13', viewport: { width: 390, height: 844 }, state: null });
  await ctx.addInitScript(FAKE_VOICE, {});
  await page.reload();
  await toSignIn(page, { name: 'Gia' });
  await page.click('.auth-skip');
  await page.waitForTimeout(1500);
  expect(!(await page.locator('.tour-offer').count()), 'no tour pops up after the first questions');
  await page.evaluate(() => window.CassieTour.offer());
  await page.waitForSelector('.tour-offer', { timeout: 5000 });
  const offerText = await page.locator('.tour-offer').innerText();
  expect(/Want a quick tour\? It takes about 90 seconds\./.test(offerText) && /Show me around/.test(offerText) && /Not now/.test(offerText), 'the offer: ' + offerText);
  for (const bt of await page.locator('.tour-offer button').all()) { const bb = await bt.boundingBox(); expect(bb.height >= 44, 'offer buttons are 44px'); }
  await page.click('.tour-offer [data-t="later"]');
  const later = await page.locator('.tour-offer').innerText();
  expect(/Settings, then Help, then Take the tour/.test(later) && !/[–—]/.test(later), 'Not now says where to find it: ' + later);
  await page.reload();
  await page.waitForTimeout(2000);
  expect(!(await page.locator('.tour-offer, .tour-card').count()), 'never offered again after Not now');
  // Settings, then Help, then Take the tour: the tour, with voice off (no speech at all)
  await page.evaluate(() => { openSettings('help'); });
  await page.waitForSelector('#tour-btn', { timeout: 5000 });
  expect((await page.locator('#tour-btn').boundingBox()).height >= 44, 'Take the tour is 44px');
  await page.click('#tour-btn');
  await page.waitForSelector('.tour-card');
  await page.click('.tour-card [data-t="voice"]');
  expect(/Voice off/.test(await page.locator('.tour-card [data-t="voice"]').innerText()), 'the voice switch says Voice off');
  await page.waitForTimeout(300);
  const said0 = await page.evaluate(() => window.__studio.length);
  let stops = await walkTour(page, '390x844');
  expect(JSON.stringify(stops.map((s) => s.id)) === JSON.stringify(PHONE), 'the phone’s stops, along the tab bar: ' + stops.map((s) => s.id).join(', '));
  let studio = await page.evaluate(() => window.__studio.length) - said0, spoken = await page.evaluate(() => window.__spoken.length);
  expect(studio === 0 && spoken === 0, `voice off: nothing was spoken (${studio} studio, ${spoken} device)`);
  expect(await tourGone(page), 'Done leaves nothing of the tour on screen');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('cassie.v2')).tourVoice === 'off' && state.tour === 'done'), 'the voice switch and the finished tour are remembered');
  // started from Settings, it ends back in Settings (Help)
  expect(await page.evaluate(() => !document.getElementById('settings-panel').hidden && document.querySelector('#settings-panel .settings-card').dataset.page === 'help'), 'back where it started: Settings, Help');
  // Skip and Escape: nothing left, the app where it was (the Chat tab, Home scrolled where it was)
  await page.evaluate(() => { closeSettings(); window.CassieNative.go('chat'); });
  await page.waitForTimeout(400);
  for (const how of ['skip', 'escape']) {
    await page.evaluate(() => window.CassieTour.start());
    await page.waitForSelector('.tour-card');
    for (let i = 0; i < 4; i++) { await page.click('.tour-card [data-t="next"]'); await page.waitForTimeout(500); } // (to the Labs tab)
    if (how === 'skip') await page.click('.tour-card [data-t="skip"]'); else await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    expect(await tourGone(page), `${how}: nothing of the tour is left on screen`);
    expect(await page.evaluate(() => document.documentElement.classList.contains('tab-chat') && !document.documentElement.classList.contains('labs-open') && document.getElementById('settings-panel').hidden), `${how}: the app is back on the Chat tab`);
  }
  expect(await page.evaluate(() => window.__studio.length) === said0 && (await page.evaluate(() => window.__spoken.length)) === 0, 'voice off is remembered: later tours never speak');
  expect(!errors.length, 'page errors: ' + errors.join('; '));
  await ctx.close();

  // 2. signed in, on a computer: offered once, the tour with Bella's voice, finished and synced to the account
  ({ ctx, page, errors } = await open(b, { device: 'Desktop Chrome', viewport: { width: 1280, height: 800 }, state: null }));
  await ctx.addInitScript(FAKE_VOICE, {});
  await page.reload();
  await toSignIn(page);
  await page.fill('.auth-form input[name=email]', `tour${Date.now()}@example.com`);
  await page.fill('.auth-form input[name=age]', '16');
  await page.fill('.auth-form input[name=password]', 'secret-pass-1');
  await page.click('.auth-go');
  await page.waitForSelector('.auth-page', { state: 'detached', timeout: 10000 });
  await page.evaluate(() => window.CassieTour.offer());
  await page.waitForSelector('.tour-offer', { timeout: 5000 });
  await page.click('.tour-offer [data-t="go"]');
  stops = await walkTour(page, '1280x800');
  const computerSays = stops.map((x) => x.say);
  expect(JSON.stringify(stops.map((s) => s.id)) === JSON.stringify(PHONE), 'the computer’s stops (the top bar, the sidebar and Home): ' + stops.map((s) => s.id).join(', '));
  studio = await page.evaluate(() => window.__studio.filter((x) => x.ok).length);
  expect(studio >= stops.length && (await page.evaluate(() => window.__spoken.length)) === 0, `voice on: Bella said the stops (${studio}), never the device voice`);
  expect(await tourGone(page), 'Done leaves nothing on screen');
  expect(await page.evaluate(() => accountData().tour === 'done'), 'the finished tour goes with the account');
  await page.reload();
  await page.waitForTimeout(2000);
  expect(!(await page.locator('.tour-offer, .tour-card').count()), 'never starts by itself again');
  // the card in light and dark: every word readable
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.evaluate(() => window.CassieTour.start());
    await page.waitForSelector('.tour-card'); await page.waitForTimeout(600);
    const { bad } = await require('./ui-checks.cjs').contrastIssues(page, '.tour-card');
    expect(!bad.length, `the tour card (${scheme}): ` + bad.join(' | '));
    await page.keyboard.press('Escape');
  }
  expect(!errors.length, 'page errors: ' + errors.join('; '));
  await ctx.close();

  // 3. a small phone, with Reduce Motion: every stop still fits, and the cursor just appears
  ({ ctx, page, errors } = await open(b, { device: 'Galaxy S9+', viewport: { width: 360, height: 740 }, server: false, state: { groqKey: 'gsk_test', tab: 'home', tour: 'done' } }));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => window.CassieTour.start());
  stops = await walkTour(page, '360x740');
  expect(stops.length === PHONE.length, '360x740: every stop: ' + stops.map((s) => s.id).join(', '));
  expect(!errors.length, 'page errors: ' + errors.join('; '));
  await ctx.close();

  // 4. about 90 seconds, read at 150 words a minute, on each device
  for (const [where, say] of [['phone', stops.map((s) => s.say)], ['computer', computerSays]]) {
    const words = say.join(' ').split(/\s+/).length, secs = words / 150 * 60;
    expect(secs >= 75 && secs <= 105, `${where}: the tour reads in about 90 seconds: ${words} words, ${Math.round(secs)} s`);
  }
});

// Clicks Next to the end of the tour.
async function finishTour(page) {
  await page.waitForSelector('.tour-card', { timeout: 8000 });
  for (let i = 0; i < 14 && await page.locator('.tour-card').count(); i++) { await page.click('.tour-card [data-t="next"]').catch(() => {}); await page.waitForTimeout(250); }
  await page.waitForSelector('.tour-card', { state: 'detached', timeout: 5000 });
}
test('after the tour, on a computer: a video of how the Chrome extension works, once (the video plays, Get the extension and Close, Escape); again from Settings, Help; never on a phone; 44px, no dashes, on screen', async (b) => {
  // the video is real, in two forms, and goes out with the site
  for (const f of ['extension-how.webm', 'extension-how.mp4', 'extension-how.jpg']) {
    expect(fs.existsSync(path.join(ROOT, 'landing', f)) && fs.statSync(path.join(ROOT, 'landing', f)).size > 20000, 'landing/' + f + ' is there');
    if (fs.existsSync(path.join(ROOT, '_site'))) expect(fs.existsSync(path.join(ROOT, '_site/landing', f)), '_site/landing/' + f + ' is published');
  }
  expect(/landing/.test(fs.readFileSync(path.join(ROOT, 'scripts/build-site.sh'), 'utf8')), 'the build copies landing/');
  // 1. a computer: Done, then the video
  let { ctx, page, errors } = await open(b, { device: 'Desktop Chrome', viewport: { width: 1280, height: 800 }, server: false, state: { groqKey: 'gsk_test', tour: 'done', tourVoice: 'off' } });
  await page.evaluate(() => window.CassieTour.start());
  await finishTour(page);
  await page.waitForSelector('.tour-video', { timeout: 3000 });
  await page.waitForFunction(() => { const v = document.querySelector('.tour-video video'); return v && v.readyState >= 1 && v.duration > 30; }, null, { timeout: 15000 });
  const v = await page.evaluate(() => {
    const box = document.querySelector('.tour-video'), r = box.getBoundingClientRect(), vid = box.querySelector('video');
    const small = [...box.querySelectorAll('a, button')].filter((x) => { const q = x.getBoundingClientRect(); return q.height < 44 || q.width < 44; }).map((x) => x.textContent);
    const get = box.querySelector('a.tour-main');
    return { dur: vid.duration, src: vid.currentSrc, w: vid.videoWidth, h: vid.videoHeight, text: box.innerText, small, fits: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
      get: get && get.textContent, href: get && get.getAttribute('href'), download: get && get.hasAttribute('download'), focus: document.activeElement && document.activeElement.textContent, seen: state.extVideoSeen,
      label: box.getAttribute('role') === 'dialog' && !!box.getAttribute('aria-labelledby') };
  });
  expect(v.dur > 30 && v.dur < 50 && v.w === 1280 && v.h === 720, 'the video loads: ' + JSON.stringify(v));
  expect(v.get === 'Add to Chrome' && v.href === 'https://chromewebstore.google.com/detail/hnafgijhojdheggkcjliffbgpdhikbpj' && !v.download, 'Add to Chrome opens the Chrome Web Store: ' + JSON.stringify(v));
  expect(v.fits && !v.small.length && !/[–—]/.test(v.text) && v.label && v.focus === 'Close' && v.seen === true, 'on screen, 44px, no dashes, a labelled dialog, Close has the focus, remembered: ' + JSON.stringify(v));
  if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/tour-video.png' });
  // in light and dark: every word readable
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme });
    const { bad } = await require('./ui-checks.cjs').contrastIssues(page, '.tour-video');
    expect(!bad.length, `the video box (${scheme}): ` + bad.join(' | '));
  }
  await page.keyboard.press('Escape');
  expect(!(await page.locator('.tour-video-wrap').count()), 'Escape closes it');
  // once: the next tour ends without it
  await page.evaluate(() => window.CassieTour.start());
  await finishTour(page);
  await page.waitForTimeout(900);
  expect(!(await page.locator('.tour-video').count()), 'shown once, not after every tour');
  // Settings, Help: "Watch how the Chrome extension works"
  await page.evaluate(() => openSettings('help'));
  await page.waitForSelector('#ext-video-btn', { timeout: 5000 });
  const row = await page.locator('#ext-video-btn').boundingBox();
  expect(row.height >= 44 && /Watch how the Chrome extension works/.test(await page.locator('#ext-video-btn').innerText()), 'the Help row is there, 44px');
  await page.click('#ext-video-btn');
  await page.waitForSelector('.tour-video');
  await page.click('.tour-video [data-t="close"]');
  expect(!(await page.locator('.tour-video-wrap').count()) && await page.evaluate(() => !document.getElementById('settings-panel').hidden), 'Close closes it, and Settings is still open');
  expect(!errors.length, 'page errors: ' + errors.join('; '));
  await ctx.close();
  // 2. a phone: the tour ends without it, and Help has no row for it
  for (const [device, viewport] of [['iPhone 13', { width: 390, height: 844 }], ['Galaxy S9+', { width: 360, height: 740 }]]) {
    ({ ctx, page, errors } = await open(b, { device, viewport, server: false, state: { groqKey: 'gsk_test', tour: 'done', tourVoice: 'off' } }));
    await page.evaluate(() => window.CassieTour.start());
    await finishTour(page);
    await page.waitForTimeout(900);
    expect(!(await page.locator('.tour-video').count()), `${viewport.width}x${viewport.height}: no extension video on a phone`);
    await page.evaluate(() => openSettings('help'));
    await page.waitForSelector('#tour-btn', { timeout: 5000 });
    expect(!(await page.locator('#ext-video-btn').isVisible()), `${viewport.width}x${viewport.height}: no Help row for it on a phone`);
    expect(!errors.length, 'page errors: ' + errors.join('; '));
    await ctx.close();
  }
});

// Speech, faked: the browser's speech recognition hears window.__ears.say a word at a time (or, with
// mode 'denied', the microphone isn't allowed). Every value a box shows while it fills is kept.
const FAKE_EARS = () => {
  window.__ears = { say: 'how do plants make their food', mode: 'ok', starts: 0, values: [] };
  class Ears extends EventTarget {
    constructor() { super(); this.continuous = false; this.interimResults = false; this.done = false; }
    fire(type, extra) { const e = new Event(type); Object.assign(e, extra || {}); this.dispatchEvent(e); if (typeof this['on' + type] === 'function') this['on' + type](e); }
    start() {
      window.__ears.starts++;
      if (window.__ears.mode === 'denied') { setTimeout(() => { this.fire('error', { error: 'not-allowed' }); this.end(); }, 30); return; }
      const words = window.__ears.say.split(' ');
      let i = this.interimResults ? 1 : words.length;
      const tick = () => {
        if (this.done) return;
        const res = [{ transcript: words.slice(0, i).join(' ') }]; res.isFinal = i === words.length;
        this.fire('result', { resultIndex: 0, results: [res] });
        if (i < words.length) { i++; this.t = setTimeout(tick, 120); } else this.t = setTimeout(() => this.end(), 250);
      };
      this.t = setTimeout(tick, 150);
    }
    end() { if (this.done) return; this.done = true; clearTimeout(this.t); this.fire('end'); }
    stop() { setTimeout(() => this.end(), 10); }
    abort() { this.end(); }
  }
  window.SpeechRecognition = Ears; window.webkitSpeechRecognition = Ears;
  document.addEventListener('input', (e) => { const t = e.composedPath()[0]; if (t && typeof t.value === 'string') window.__ears.values.push(t.value); }, true);
};
const NO_EARS = () => { delete window.SpeechRecognition; delete window.webkitSpeechRecognition; window.SpeechRecognition = undefined; window.webkitSpeechRecognition = undefined; window.MediaRecorder = undefined; };
const SAID = 'how do plants make their food';
const isGrey = (c) => { const m = String(c).match(/\d+(\.\d+)?/g); if (!m) return false; const [r, g, bl] = m.map(Number); return Math.abs(r - g) <= 16 && Math.abs(g - bl) <= 16; }; // (the surrounding ink: near black or near white)
// The mic beside the box (sel; root: a shadow host when the box is inside one): how it looks, then say
// SAID into it and wait for it to finish. inWorld(js): runs js where the fake speech lives (the
// extension's own page script world). Returns what happened.
async function micSay(page, sel, { root = null, inWorld = null } = {}) {
  const look = await page.evaluate(([s, r]) => {
    const box = (r ? document.querySelector(r).shadowRoot : document).querySelector(s); if (!box) return { missing: true };
    box.scrollIntoView({ block: 'center' });
    const m = box.nextElementSibling;
    if (!m || !m.classList.contains('cmic')) return { noMic: true };
    m.scrollIntoView({ block: 'nearest' }); // (in a panel that scrolls, the mic is just under its box)
    const q = m.getBoundingClientRect(), cs = getComputedStyle(m);
    return { w: q.width, h: q.height, label: m.getAttribute('aria-label'), shown: q.width > 0 && cs.display !== 'none' && cs.visibility !== 'hidden', onScreen: q.left >= 0 && q.right <= innerWidth + 1 && q.top >= 0 && q.bottom <= innerHeight + 1, color: cs.color, bg: cs.backgroundColor, border: cs.borderTopColor };
  }, [sel, root]);
  if (look.missing || look.noMic) return { look };
  if (inWorld) await inWorld(`window.__ears.say = ${JSON.stringify(SAID)}; window.__ears.values = [];`);
  else await page.evaluate((p) => { window.__ears.say = p; window.__ears.values = []; }, SAID);
  await page.evaluate(([s, r]) => (r ? document.querySelector(r).shadowRoot : document).querySelector(s).nextElementSibling.click(), [sel, root]);
  const during = await page.evaluate(([s, r]) => {
    const top = r ? document.querySelector(r).shadowRoot : document, box = top.querySelector(s), m = box.nextElementSibling;
    return { stop: /Stop/.test(m.textContent) && m.getAttribute('aria-label') === 'Stop listening', h: m.getBoundingClientRect().height, line: [...top.querySelectorAll('.cmic-line')].map((x) => x.textContent), placeholder: box.placeholder };
  }, [sel, root]);
  await page.waitForFunction(([s, r]) => { const box = (r ? document.querySelector(r).shadowRoot : document).querySelector(s); return !box || (box.nextElementSibling && box.nextElementSibling.getAttribute('aria-label') === 'Say it instead of typing'); }, [sel, root], { timeout: 10000 });
  await page.waitForTimeout(300);
  const after = await page.evaluate(([s, r]) => {
    const top = r ? document.querySelector(r).shadowRoot : document, box = top.querySelector(s);
    return { value: box ? box.value : null, line: [...top.querySelectorAll('.cmic-line')].map((x) => x.textContent), sideways: document.documentElement.scrollWidth > innerWidth + 1 };
  }, [sel, root]);
  const values = inWorld ? await inWorld('window.__ears.values') : await page.evaluate(() => window.__ears.values);
  return { look, during, after, values };
}
// what every mic must be: 44px, labelled, on screen, monochrome; Listening… and Stop while on; the words as they came
function micLooksRight(where, r) {
  expect(!r.look.missing, `${where}: the box is there`);
  expect(!r.look.noMic, `${where}: has a mic`);
  const L = r.look;
  expect(L.shown && L.w >= 44 && L.h >= 44 && L.label === 'Say it instead of typing', `${where}: a 44px mic labelled "Say it instead of typing": ` + JSON.stringify(L));
  expect(L.onScreen, `${where}: the mic is on screen: ` + JSON.stringify(L));
  expect(isGrey(L.color) && isGrey(L.border) && (/rgba\(\d+, \d+, \d+, 0\)|transparent/.test(L.bg) || isGrey(L.bg)), `${where}: monochrome: ` + JSON.stringify(L));
  expect(r.during.stop && r.during.h >= 44 && r.during.line.includes('Listening…') && r.during.placeholder === 'Listening…', `${where}: Listening… and a Stop button while it listens: ` + JSON.stringify(r.during));
  const partial = r.values.some((v) => / how do( plants)?$/.test(' ' + v.trim()) || /^how do( plants)?$/.test(v.trim()));
  expect(partial && r.values.some((v) => v.includes(SAID)), `${where}: the words appear as they come: ` + JSON.stringify(r.values));
  expect(!r.after.line.some((t) => /[–—]/.test(t)) && !r.after.sideways, `${where}: no dashes, nothing off screen: ` + JSON.stringify(r.after));
}

test.slow('a mic on every box where a student writes to Cassie (app, Labs, the board): heard words fill the box as they come; ask boxes send and writing boxes keep the words to edit; not allowed or no speech: one plain line, or no mic, and typing still works; the chat’s own mic still works; 44px, monochrome, no dashes, nothing off screen at 1280x800, 390x844 and 360x740', async (b) => {
  const fakeGroq = () => ({ text: 'Plants make food from light, water and carbon dioxide.' });
  const reset = async (page) => { await page.goto(APP); await page.waitForSelector('#prompt-input', { timeout: 10000 }); };
  // The boxes, every one: a missing mic fails here. ask: it sends what was said (seen in what reached Cassie)
  const BOXES = [
    { name: 'the Island ask box', sel: '.isle-card .isle-input', ask: true, open: async (page) => {
      await dragIn(page, { text: 'Leaves are green' }); await dropOn(page);
      await page.waitForFunction(() => document.querySelector('.isle-card').dataset.step === 'ready', null, { timeout: 5000 });
      await page.locator('.isle-card').getByRole('button', { name: 'Ask about it' }).click(); } },
    { name: 'Ask about what you see (Labs)', sel: '.lab-helper .hp-ask input', ask: true, open: async (page) => {
      await page.evaluate(() => openLabs('projectile'));
      await page.waitForSelector('.lab-view:not([hidden]) .lab-ask', { timeout: 20000 }); await page.click('.lab-ask');
      await page.waitForSelector('.lab-helper:not([hidden]) .hp-ask input', { timeout: 10000 }); } },
    { name: 'the exam plan’s Topics', sel: '.ex-sheet textarea[name=topics]', open: async (page) => { await page.evaluate(() => openExamSheet()); await page.waitForSelector('.ex-sheet .ex-form'); },
      kept: (page) => page.evaluate(() => !!document.querySelector('.ex-sheet .ex-form')) },
    { name: 'Tell Cassie to remember something', sel: '#mem-fact', open: async (page) => { await page.evaluate(() => openMemory()); await page.waitForSelector('#mem-fact'); },
      kept: (page) => page.evaluate(() => !window.CassieMemory.data.facts.some((f) => /plants/.test(f.text))) },
    { name: 'Report a problem', sel: '.profile-overlay textarea[name=text]', open: async (page) => { await page.evaluate(() => openReport()); await page.waitForSelector('.profile-overlay textarea[name=text]'); },
      kept: (page) => page.evaluate(() => !!document.querySelector('.profile-overlay textarea[name=text]')) },
    { name: 'the study room note', sel: '.sr-foot textarea.sr-in', open: async (page) => {
      await page.click('#board-btn'); await studyTogether(page); await page.click('[data-room="new"]');
      await page.waitForSelector('.csk-room:not([hidden]) b', { timeout: 10000 });
      await page.click('[data-room-act="study"]'); await page.click('.sr-tabs [data-tab="notes"]'); await page.waitForSelector('.sr-foot textarea.sr-in'); },
      kept: (page) => page.evaluate(() => !/plants make/.test((document.querySelector('.sr-body') || {}).textContent || '')) },
    ...[['cardmatrix', '.lab-panel .tl-area', 'notes to turn into cards'], ['cornell', '.lab-panel .tl-area', 'Cornell notes'], ['thesis', '.tl-tmap textarea[data-f="thesis"]', 'the thesis'],
      ['thesis', '.tl-tmap textarea[data-f="reason"]', 'a reason'], ['thesis', '.tl-tmap textarea[data-f="counter"]', 'the counter-argument'], ['thesis', '.tl-form textarea[data-k="quote"]', 'a quote']].map(([id, sel, what]) => ({
      name: `Labs study tools: ${what}`, sel, open: async (page) => {
        await page.evaluate((x) => openLabs(x), id);
        await page.waitForSelector(`.lab-view:not([hidden])[data-lab="${id}"] .lab-controls > *`, { timeout: 15000 });
        if (/quote/.test(sel)) { await page.click('[data-adde="0"]'); await page.waitForSelector(sel); } } })),
  ];
  let { ctx, page, errors, groqCalls } = await open(b, { device: 'Desktop Chrome', viewport: { width: 1280, height: 800 }, fakeGroq, state: { groqKey: 'gsk_test', tour: 'done', extVideoSeen: true } });
  await ctx.addInitScript(FAKE_EARS);
  for (const box of BOXES) {
    await reset(page);
    await box.open(page);
    const before = groqCalls.length;
    const r = await micSay(page, box.sel);
    micLooksRight(`1280x800 ${box.name}`, r);
    if (process.env.SHOTS && /Island|thesis|Topics/.test(box.name)) await page.screenshot({ path: `${process.env.SHOTS}/mic-${box.name.replace(/\W+/g, '-')}.png` });
    await page.waitForTimeout(box.ask ? 1200 : 300);
    const reached = groqCalls.slice(before).some((c) => JSON.stringify(c).includes(SAID));
    if (box.ask) expect(reached, `${box.name}: the mic sends the question`);
    else {
      expect(!reached && (r.after.value || '').includes(SAID) && (box.kept ? await box.kept(page) : true), `${box.name}: the words stay in the box to edit, and nothing is sent or saved: ` + JSON.stringify(r.after));
      // and typing still works, after the words
      await page.locator(box.sel).first().press('End'); await page.keyboard.type(' and why');
      expect((await page.locator(box.sel).first().inputValue()).endsWith(SAID + ' and why'), `${box.name}: typing goes on after the words`);
    }
  }
  // the board: its own mic (sketch.js gets hear from the app)
  await reset(page);
  await page.click('#board-btn');
  await page.waitForSelector('.csk-ask .csk-mic');
  const bm = await page.locator('.csk-ask .csk-mic').boundingBox();
  expect(bm.width >= 44 && bm.height >= 44 && await page.locator('.csk-ask .csk-mic').getAttribute('aria-label') === 'Say it instead of typing', 'the board’s mic is 44px and labelled');
  let before = groqCalls.length;
  await page.evaluate(() => { window.__ears.values = []; });
  await page.click('.csk-ask .csk-mic');
  expect(/Stop/.test(await page.locator('.csk-ask .csk-mic').innerText()) && await page.locator('.csk-ask input').getAttribute('placeholder') === 'Listening…', 'the board says Listening… with a Stop button');
  await page.waitForFunction(() => /how do plants/.test(document.querySelector('.csk-ask input').value), null, { timeout: 5000 });
  await page.waitForTimeout(2000);
  expect(groqCalls.slice(before).some((c) => JSON.stringify(c).includes(SAID)), 'the board’s mic asks Cassie');
  // the chat's own mic still works as before
  await reset(page);
  before = groqCalls.length;
  await page.click('#mic-btn');
  await page.waitForTimeout(1500);
  expect(groqCalls.slice(before).some((c) => JSON.stringify(c).includes(SAID)), 'the chat’s mic still sends what was said');
  // not allowed: one plain line, the box still takes typing
  await reset(page);
  await page.evaluate(() => { window.__ears.mode = 'denied'; openMemory(); });
  await page.waitForSelector('#mem-fact + .cmic');
  await page.click('#mem-fact + .cmic');
  await page.waitForSelector('.cmic-line >> text=Cassie can’t use the microphone here. Type it instead.', { timeout: 5000 });
  await page.fill('#mem-fact', 'My exam is on Friday');
  expect(await page.inputValue('#mem-fact') === 'My exam is on Friday', 'typing still works after the mic can’t');
  expect(!errors.length, 'page errors: ' + errors.join('; '));
  await ctx.close();

  // phones: each mic on screen, 44px, nothing off the side
  for (const [device, viewport] of [['iPhone 13', { width: 390, height: 844 }], ['Galaxy S9+', { width: 360, height: 740 }]]) {
    ({ ctx, page, errors, groqCalls } = await open(b, { device, viewport, fakeGroq, state: { groqKey: 'gsk_test', tour: 'done' } }));
    await ctx.addInitScript(FAKE_EARS);
    for (const box of BOXES.filter((x) => !/study room/.test(x.name))) {
      await reset(page);
      await box.open(page);
      const r = await micSay(page, box.sel);
      micLooksRight(`${viewport.width}x${viewport.height} ${box.name}`, r);
    }
    expect(!errors.length, 'page errors: ' + errors.join('; '));
    await ctx.close();
  }

  // a browser that can't listen at all: no mic anywhere, and the boxes work as always
  ({ ctx, page, errors } = await open(b, { device: 'Desktop Chrome', server: false, state: { groqKey: 'gsk_test', tour: 'done', extVideoSeen: true } }));
  await ctx.addInitScript(NO_EARS);
  await reset(page);
  await page.evaluate(() => openMemory());
  await page.waitForSelector('#mem-fact');
  expect(!(await page.locator('#mem-fact + .cmic').isVisible()), 'no mic where the browser can’t listen');
  await page.fill('#mem-fact', 'Typed');
  expect(await page.inputValue('#mem-fact') === 'Typed', 'typing works');
  await page.keyboard.press('Escape');
  await reset(page);
  await page.click('#board-btn');
  await page.waitForSelector('.csk-ask input');
  expect(!(await page.locator('.csk-ask .csk-mic').count()), 'the board has no mic either');
  expect(!errors.length, 'page errors: ' + errors.join('; '));
  await ctx.close();
  // one mic helper for the app and Labs, the same one in the extension; the board stays the same in both
  expect(fs.readFileSync(path.join(ROOT, 'mic.js'), 'utf8') === fs.readFileSync(path.join(ROOT, 'extension/mic.js'), 'utf8'), 'extension/mic.js is mic.js');
  expect(fs.readFileSync(path.join(ROOT, 'sketch.js'), 'utf8') === fs.readFileSync(path.join(ROOT, 'extension/sketch.js'), 'utf8'), 'extension/sketch.js is sketch.js');
  const mic = fs.readFileSync(path.join(ROOT, 'mic.js'), 'utf8');
  expect(!/localStorage|indexedDB|console\.|track\(|fetch\(/.test(mic), 'the mic keeps and logs nothing');
});

test('a mic on every box where a student writes to Cassie in the extension (the side panel’s Ask Cassie and Ask a follow-up, the board, the on-page Island, the popup): the words fill the box and the question is sent; not allowed: one plain line; 44px, monochrome, no new permission', async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension/manifest.json'), 'utf8'));
  expect(manifest.permissions.slice().sort().join() === 'activeTab,contextMenus,scripting,sidePanel,storage' && !manifest.optional_permissions, 'no new permission for the mic: ' + manifest.permissions.join());
  expect(manifest.content_scripts[0].js.includes('mic.js'), 'the mic is on every page');
  for (const f of ['panel.html', 'popup.html']) expect(/<script src="mic\.js"><\/script>/.test(fs.readFileSync(path.join(ROOT, 'extension', f), 'utf8')), `${f} loads the mic`);
  const ext = path.join(ROOT, 'extension');
  const profile = fs.mkdtempSync(path.join(require('os').tmpdir(), 'cassie-ext-'));
  const ctx = await chromium.launchPersistentContext(profile, {
    headless: true, viewport: { width: 1200, height: 800 }, ...(fs.existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : { channel: 'chromium' }),
    args: ['--headless=new', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  try {
    await ctx.route(/api\.groq\.com|workers\.dev|fonts\.(googleapis|gstatic)\.com|askcassie\.pages\.dev/, (route) => route.abort());
    let sw = null;
    for (let i = 0; i < 80 && !sw; i++) {
      for (const w of ctx.serviceWorkers()) if (/\/background\.js$/.test(w.url()) && await w.evaluate(() => typeof readPicture === 'function').catch(() => false)) { sw = w; break; }
      if (!sw) await new Promise((r) => setTimeout(r, 250));
    }
    expect(sw, 'the Cassie extension did not start');
    // the AI, faked: every question that reaches it is kept
    await sw.evaluate(() => {
      self.__asked = [];
      self.readPicture = async (keys, msg) => { self.__asked.push(String(msg.prompt || '')); return 'Plants make food from light.'; };
      self.answerAny = async (input, keys, onDelta) => { self.__asked.push(JSON.stringify(input)); const t = 'Plants make food from light.'; if (onDelta) onDelta(t); return t; };
      self.speakLeft = async () => ({ on: false, left: 0 });
    });
    const askedSaid = async () => (await sw.evaluate(() => self.__asked.slice())).some((x) => x.includes(SAID));
    const id = new URL(sw.url()).host;

    // 1. the side panel: Ask a follow-up, Ask Cassie, and the board
    const panel = await ctx.newPage();
    await panel.addInitScript(FAKE_EARS);
    await panel.goto(`chrome-extension://${id}/panel.html`);
    await panel.waitForSelector('#t-ask');
    await panel.evaluate(() => { window.ask = (c) => { window.__asked = JSON.stringify(c); }; showTextJob('Leaves are green', 'explain'); });
    let r = await micSay(panel, '.card .row input');
    micLooksRight('the panel’s Ask a follow-up', r);
    expect(/how do plants make their food/.test(await panel.evaluate(() => window.__asked)), 'Ask a follow-up: the mic sends it');
    await panel.evaluate(() => { window.teach = (o) => { window.__taught = o.q; }; askPage(); });
    r = await micSay(panel, '.ask-page form input');
    micLooksRight('the panel’s Ask Cassie', r);
    expect(await panel.evaluate(() => window.__taught) === SAID, 'Ask Cassie: the mic sends it');
    await panel.evaluate(() => { window.vision = async (img, p) => { window.__vision = p; return 'ok'; }; openBoard(null); });
    await panel.waitForSelector('.csk-ask .csk-mic');
    const bm = await panel.locator('.csk-ask .csk-mic').boundingBox();
    expect(bm.width >= 44 && bm.height >= 44, 'the panel board’s mic is 44px');
    await panel.click('.csk-ask .csk-mic');
    await panel.waitForFunction(() => /how do plants make their food/.test(window.__vision || ''), null, { timeout: 8000 });
    await panel.close();

    // 2. the popup's question box; then, not allowed: one plain line, and typing still works
    const popup = await ctx.newPage();
    await popup.addInitScript(FAKE_EARS);
    await popup.goto(`chrome-extension://${id}/popup.html`);
    await popup.waitForSelector('#page-q + .cmic');
    r = await micSay(popup, '#page-q');
    micLooksRight('the popup’s question box', r);
    expect(await popup.locator('#page-answer').isVisible(), 'the popup: the mic asks about the page');
    await popup.evaluate(() => { window.__ears.mode = 'denied'; document.getElementById('page-q').value = ''; });
    await popup.click('#page-q + .cmic');
    await popup.waitForSelector('.cmic-line >> text=Cassie can’t use the microphone here. Type it instead.', { timeout: 5000 });
    await popup.fill('#page-q', 'Typed instead');
    expect(await popup.inputValue('#page-q') === 'Typed instead', 'typing still works');
    await popup.close();

    // 3. on a page: the Island's ask box and the board (the extension's own page script: its speech is faked there)
    const page = await ctx.newPage();
    await page.goto(`http://localhost:${APP_PORT}/tests/fixtures/teach/page.html`);
    await page.waitForFunction(() => document.getElementById('cassie-ext-host-92f1'), null, { timeout: 10000 });
    const cdp = await ctx.newCDPSession(page);
    const worlds = [];
    cdp.on('Runtime.executionContextCreated', (e) => worlds.push(e.context));
    await cdp.send('Runtime.enable');
    await page.waitForTimeout(300);
    const { frameTree } = await cdp.send('Page.getFrameTree');
    const world = worlds.find((c) => c.auxData && c.auxData.frameId === frameTree.frame.id && c.auxData.type === 'isolated' && /Cassie/.test(c.name));
    expect(world, 'the extension’s page script: ' + worlds.map((c) => c.name).join(', '));
    const inWorld = async (js) => (await cdp.send('Runtime.evaluate', { contextId: world.id, expression: js, returnByValue: true })).result.value;
    await inWorld(`(${FAKE_EARS})()`);
    await page.evaluate(() => {
      const dt = new DataTransfer();
      dt.items.add(new File(['%PDF-1.4 notes'], 'notes.pdf', { type: 'application/pdf' }));
      window.__dt = dt;
      document.body.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }));
      document.body.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    });
    await page.waitForFunction(() => { const i = document.getElementById('cassie-ext-host-92f1').shadowRoot.querySelector('.cx-isle'); return i && !i.hidden; }, null, { timeout: 3000 });
    await page.evaluate(() => {
      const el = document.getElementById('cassie-ext-host-92f1').shadowRoot.querySelector('.cx-isle');
      el.dispatchEvent(new DragEvent('dragover', { bubbles: true, composed: true, cancelable: true, dataTransfer: window.__dt }));
      el.dispatchEvent(new DragEvent('drop', { bubbles: true, composed: true, cancelable: true, dataTransfer: window.__dt }));
    });
    await page.locator('.cx-isle-chip', { hasText: 'Ask about it' }).click();
    r = await micSay(page, '.cx-isle-ask input', { root: '#cassie-ext-host-92f1', inWorld });
    micLooksRight('the on-page Island', r);
    expect(/Opening in Cassie|Opened in Cassie|didn’t work/.test(await page.evaluate(() => document.getElementById('cassie-ext-host-92f1').shadowRoot.querySelector('.cx-isle').innerText)), 'the Island: the mic sends the question');
    // the board, opened from a snip of the page
    const png = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 40; c.height = 40; const g = c.getContext('2d'); g.fillStyle = '#c00'; g.fillRect(0, 0, 40, 40); return c.toDataURL('image/png').split(',')[1]; });
    await page.waitForFunction(() => document.getElementById('cassie-ext-host-92f1').shadowRoot.querySelector('.cx-isle').hidden, null, { timeout: 5000 }).catch(() => {});
    await page.evaluate((b64) => {
      const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      const dt = new DataTransfer(); dt.items.add(new File([u], 'shape.png', { type: 'image/png' })); window.__dt = dt;
      document.body.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }));
      document.body.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    }, png);
    await page.waitForFunction(() => { const i = document.getElementById('cassie-ext-host-92f1').shadowRoot.querySelector('.cx-isle'); return i && !i.hidden; }, null, { timeout: 3000 });
    await page.evaluate(() => {
      const el = document.getElementById('cassie-ext-host-92f1').shadowRoot.querySelector('.cx-isle');
      el.dispatchEvent(new DragEvent('dragover', { bubbles: true, composed: true, cancelable: true, dataTransfer: window.__dt }));
      el.dispatchEvent(new DragEvent('drop', { bubbles: true, composed: true, cancelable: true, dataTransfer: window.__dt }));
    });
    const mic = page.locator('.csk-ask .csk-mic');
    await mic.waitFor({ timeout: 10000 });
    const pb = await mic.boundingBox();
    expect(pb.width >= 44 && pb.height >= 44, 'the on-page board’s mic is 44px');
    await mic.click();
    for (let i = 0; i < 40 && !(await askedSaid()); i++) await page.waitForTimeout(250);
    expect(await askedSaid(), 'the on-page board: the mic asks Cassie');
  } finally { await ctx.close(); }
});

test('Apple design: the loading page is a launch screen (the app’s own background, no text, no logo, a spinner only when slow); the landing page uses one system typeface and Apple’s greys; the app keeps glass for the floating controls only; nothing under Apple’s smallest sizes', async (b) => {
  // 1. the way in: just the app's background, in light and dark, in the student's look
  for (const [scheme, bg, look] of [['light', 'rgb(242, 242, 245)', ''], ['dark', 'rgb(14, 14, 16)', ''], ['light', 'rgb(251, 246, 238)', 'cassie']]) {
    const ctx = await b.newContext({ colorScheme: scheme, viewport: { width: 390, height: 844 } });
    if (look) await ctx.addInitScript((a) => localStorage.setItem('cassie.v2', JSON.stringify({ accent: a })), look);
    // the app is slow to arrive: here it never comes (start.js without its hop into the app; that the hop
    // happens in under a second is checked in the first run test), so the launch screen stays
    const startJs = fs.readFileSync(path.join(ROOT, 'start.js'), 'utf8');
    expect(/setTimeout\(go, 400\);/.test(startJs), 'start.js goes into the app after 0.4 seconds');
    await ctx.route(/\/start\.js/, (r) => r.fulfill({ contentType: 'text/javascript', body: startJs.replace('setTimeout(go, 400);', '') }));
    const page = await ctx.newPage();
    await page.goto(APP.replace('app.html', 'start.html'));
    const first = await page.evaluate(() => ({ bg: getComputedStyle(document.body).backgroundColor, words: document.body.innerText.trim(), pics: [...document.querySelectorAll('img, svg, h1, p')].length, spin: getComputedStyle(document.querySelector('.spin')).opacity }));
    expect(first.bg === bg && !first.words && !first.pics && first.spin === '0', `${scheme} ${look || 'Monochrome'}: the app’s own background (${bg}), no words, no logo, no spinner yet: ` + JSON.stringify(first));
    await page.waitForTimeout(1100);
    expect(await page.evaluate(() => getComputedStyle(document.querySelector('.spin')).opacity) === '1' && await page.locator('[role=progressbar][aria-label="Loading Cassie"]').count() === 1, `${scheme}: a slow app gets a small spinner, labelled for screen readers`);
    await ctx.close();
  }
  // 2. the landing page: one typeface (the system's), Apple's greys, nothing under 11px that a person reads
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  // the deleted web fonts and doodle wallpaper: nothing still asks for them
  const shipped = ['index.html', 'app.html', 'bot.html', 'start.html', 'style.css', 'sw.js', 'scripts/build-site.sh', 'landing/home.css'].map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  expect(!/landing\/fonts|patterns\/|"Inter|'Inter|Instrument Serif/.test(shipped), 'no page or build step refers to the deleted fonts or wallpaper');
  expect(!/landing\/fonts\.css|Instrument Serif|Inter Tight/.test(html + fs.readFileSync(path.join(ROOT, 'landing/home.css'), 'utf8')), 'the landing page loads no web fonts');
  for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
    const ctx = await b.newContext({ viewport });
    await ctx.route(/workers\.dev|groq|fonts\.g/, (r) => r.abort());
    const page = await ctx.newPage();
    await page.goto(APP.replace('app.html', 'index.html'));
    await page.waitForTimeout(800);
    const L = await page.evaluate(() => {
      const fams = new Set(), small = [];
      for (const el of document.querySelectorAll('body *')) {
        if (el.closest('[aria-hidden="true"], svg, canvas')) continue;
        if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
        const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
        if (!r.width || cs.display === 'none' || cs.visibility === 'hidden') continue;
        fams.add(cs.fontFamily.split(',')[0].trim());
        if (parseFloat(cs.fontSize) < 11) small.push(cs.fontSize + ' ' + el.textContent.trim().slice(0, 20));
      }
      const h1 = getComputedStyle(document.querySelector('.hero h1'));
      return { fams: [...fams], small: small.slice(0, 8), page: getComputedStyle(document.body).backgroundColor, h1: [h1.fontWeight, h1.fontStyle], sideways: document.documentElement.scrollWidth > innerWidth + 1 };
    });
    expect(L.fams.every((f) => /apple-system|monospace|ui-monospace|Menlo|Courier/i.test(f)), `${viewport.width}: one system typeface: ` + L.fams.join(', '));
    expect(L.page === 'rgb(245, 245, 247)' && L.h1[0] === '600' && L.h1[1] === 'normal', `${viewport.width}: Apple’s light grey page and a semibold headline: ` + JSON.stringify(L));
    expect(!L.small.length && !L.sideways, `${viewport.width}: nothing a person reads under 11px, nothing off the side: ` + JSON.stringify(L.small));
    await ctx.close();
  }
  // 3. the app: glass only on the floating controls (tab bar, top bar, sidebar, the ask box); Home's cards are solid
  for (const [device, viewport] of [['iPhone 13', { width: 390, height: 844 }], ['Desktop Chrome', { width: 1280, height: 800 }]]) {
    const { ctx, page, errors } = await open(b, { device, viewport, lite: 'off', server: false, state: { groqKey: 'gsk_test', tour: 'done', extVideoSeen: true, tab: 'home' } }); // (Lite mode turns all glass solid)
    await page.evaluate(() => { if (sideWide.matches) deskGo('home'); }); // (a computer: the study dashboard)
    await page.waitForSelector('.hub-box, .dk-card', { timeout: 10000 });
    const A = await page.evaluate(() => {
      const blur = (el) => /blur/.test(getComputedStyle(el).backdropFilter || getComputedStyle(el).webkitBackdropFilter || '');
      const shown = (el) => el.getBoundingClientRect().width > 0 && getComputedStyle(el).display !== 'none';
      const content = [...document.querySelectorAll('.hub-box, .hub-card, .hub-hero:not(.hub-hero-phone), .dk-card, .dk-stat')].filter(shown);
      const controls = [...document.querySelectorAll('#tabbar, .composer, .topbar')].filter(shown);
      const menu = document.querySelector('.side-menu-label');
      return { glassyContent: content.filter(blur).map((e) => e.className), content: content.length, glassControls: controls.filter(blur).length, controls: controls.length, menu: menu && shown(menu) ? parseFloat(getComputedStyle(menu).fontSize) : null };
    });
    expect(A.content > 0 && !A.glassyContent.length, `${viewport.width}: Home’s cards are solid, not glass: ` + JSON.stringify(A));
    expect(A.controls > 0 && A.glassControls === A.controls, `${viewport.width}: the floating controls keep their glass: ` + JSON.stringify(A));
    expect(A.menu === null || A.menu >= 10, `${viewport.width}: the sidebar’s Menu label is at least 10px: ` + A.menu);
    expect(!errors.length, 'page errors: ' + errors.join('; '));
    await ctx.close();
  }
});

// the board moves by its title bar and resizes from its edges (it then floats there), remembered after a reload
async function boardMoves(page, openBoard, label) {
  const box = () => page.locator('.csk-panel').first().evaluate((e) => { const b = e.getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) }; });
  await openBoard();
  await page.locator('.csk-panel').first().waitFor({ timeout: 10000 });
  await page.waitForTimeout(400);
  const t = await page.locator('.csk-title').first().boundingBox();
  const a = await box();
  await page.mouse.move(t.x + 10, t.y + t.height / 2); await page.mouse.down(); await page.mouse.move(t.x - 90, t.y + t.height / 2 + 30, { steps: 6 }); await page.mouse.up();
  const b = await box(), vp = page.viewportSize();
  // (a board bigger than 90% of the screen comes down to it, and it stays on screen)
  const w = Math.min(a.w, Math.round(vp.width * 0.9)), h = Math.min(a.h, Math.round(vp.height * 0.9));
  const want = { x: Math.max(0, Math.min(a.x - 100, vp.width - w)), y: Math.max(0, Math.min(a.y + 30, vp.height - h)), w, h };
  expect(['x', 'y', 'w', 'h'].every((k) => Math.abs(b[k] - want[k]) <= 3), `${label}: the board moves by its title bar: ` + JSON.stringify([a, b, want]));
  await page.mouse.move(b.x + b.w - 3, b.y + b.h / 2); await page.mouse.down(); await page.mouse.move(b.x + b.w - 123, b.y + b.h / 2, { steps: 6 }); await page.mouse.up();
  const c = await box();
  expect(Math.abs(c.w - (b.w - 120)) <= 3 && c.x === b.x, `${label}: its right edge makes it narrower: ` + JSON.stringify([b, c]));
  await page.mouse.move(c.x + c.w - 6, c.y + c.h - 6); await page.mouse.down(); await page.mouse.move(c.x + 20, c.y + 20, { steps: 6 }); await page.mouse.up();
  const d = await box();
  expect(d.w === 260 && d.h === 180, `${label}: the corner shrinks it down to 260x180: ` + JSON.stringify(d));
  await page.mouse.move(d.x + d.w - 6, d.y + d.h - 6); await page.mouse.down(); await page.mouse.move(d.x + 500, d.y + 380, { steps: 6 }); await page.mouse.up();
  const kept = await box();
  await page.reload();
  await openBoard();
  await page.locator('.csk-panel').first().waitFor({ timeout: 10000 });
  await page.waitForTimeout(400);
  const again = await box();
  expect(['x', 'y', 'w', 'h'].every((k) => Math.abs(again[k] - kept[k]) <= 3), `${label}: after a reload the board opens at the same size and place: ` + JSON.stringify([kept, again]));
}

test('extension: side buttons hidden with Hide here come back with a double Ctrl tap or Show side buttons in the pop-up, and hiding says how (once per site)', async () => {
  const ext = path.join(ROOT, 'extension');
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(require('os').tmpdir(), 'cassie-ext-')), {
    headless: true, viewport: { width: 1280, height: 800 }, ...(fs.existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : { channel: 'chromium' }),
    args: ['--headless=new', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  try {
    await ctx.route(/example\.com/, (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><title>Course</title></head><body style="font:18px sans-serif;margin:60px"><p id="p">Mitosis is how one cell divides into two identical cells.</p></body></html>' }));
    await ctx.route(/api\.groq\.com|workers\.dev|fonts\.(googleapis|gstatic)\.com|askcassie\.pages\.dev/, (r) => r.abort());
    const page = ctx.pages()[0] || await ctx.newPage();
    const load = async (reload) => { if (reload) await page.reload(); else await page.goto('https://example.com/course'); await page.bringToFront(); await page.waitForFunction(() => { const h = document.getElementById('cassie-ext-host-92f1'); return h && h.shadowRoot.querySelector('.dock'); }, null, { timeout: 10000 }); await page.waitForTimeout(700); };
    const R = "document.getElementById('cassie-ext-host-92f1').shadowRoot";
    const st = () => page.evaluate((r) => { const s = eval(r), d = s.querySelector('.dock'), p = s.querySelector('.popover'), back = s.querySelector('.popover .dock-back'); return { dock: !d.hidden && d.dataset.off !== '1', note: (s.querySelector('.hidden-note') || {}).textContent || '', pop: !p.hidden, back: back ? { text: back.textContent, h: back.getBoundingClientRect().height } : null }; }, R);
    await load();
    expect((await st()).dock, 'the side buttons start shown');
    // Hide here: gone, and the note says how to bring them back
    await page.evaluate((r) => eval(r).querySelector('.dock-hide').click(), R);
    await page.waitForTimeout(400);
    let s = await st();
    expect(!s.dock && /Side buttons hidden on this site\. Double-tap Ctrl, or click the Cassie icon in the toolbar, to bring them back\./.test(s.note) && !/[–—]/.test(s.note), 'hidden, with the note: ' + JSON.stringify(s));
    await load(true);
    expect(!(await st()).dock, 'still hidden after a reload');
    // double Ctrl: back (and after a reload too)
    await page.keyboard.press('Control'); await page.keyboard.press('Control');
    await page.waitForTimeout(400);
    expect((await st()).dock, 'a double Ctrl tap brings the side buttons back');
    await load(true); // (a reload clears the pop-up it opened; highlights stay on)
    expect((await st()).dock, 'and they stay back after a reload');
    // hide again: no note the second time; then Show side buttons in the pop-up brings them back
    await page.evaluate((r) => eval(r).querySelector('.dock-hide').click(), R);
    await page.waitForTimeout(400);
    s = await st();
    expect(!s.dock && !s.note, 'hidden again, the note only came once on this site: ' + JSON.stringify(s));
    await page.evaluate(() => { const r = document.createRange(); r.selectNodeContents(document.getElementById('p')); const g = getSelection(); g.removeAllRanges(); g.addRange(r); document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); });
    await page.waitForTimeout(400);
    s = await st();
    expect(!s.dock && s.pop && s.back && s.back.text === 'Show side buttons' && s.back.h >= 44, 'the pop-up offers Show side buttons, 44px: ' + JSON.stringify(s));
    await page.evaluate((r) => eval(r).querySelector('.popover .dock-back').click(), R);
    await page.waitForTimeout(300);
    s = await st();
    expect(s.dock && !s.back, 'Show side buttons brings them back: ' + JSON.stringify(s));
  } finally { await ctx.close(); }
});

test('extension: the pop-up is for highlights (a code screenshot opens it too, and Explain reads the picture: What I read, indents kept), closing it keeps it closed on every tab until Ctrl is tapped twice, and it moves by its header and resizes from its edges, remembered after a reload', async () => {
  const ext = path.join(ROOT, 'extension');
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(require('os').tmpdir(), 'cassie-ext-')), {
    headless: true, viewport: { width: 1280, height: 800 }, ...(fs.existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : { channel: 'chromium' }),
    args: ['--headless=new', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  try {
    const code = '<svg xmlns="http://www.w3.org/2000/svg" width="420" height="120"><rect width="420" height="120" fill="#1e1e1e"/><text x="12" y="40" font-family="Comic Sans MS" font-size="22" fill="#9cdcfe">for i in range(3):</text><text x="44" y="80" font-family="Comic Sans MS" font-size="22" fill="#ce9178">print(i * 2)</text></svg>';
    const html = `<!doctype html><html><head><title>Week 3 quiz</title></head><body style="font:18px sans-serif;margin:40px">
      <p id="plain" style="margin-top:300px">Photosynthesis turns light, water and carbon dioxide into sugar and oxygen.</p>
      <p id="q">What does this print? <img id="shot" alt="" src="data:image/svg+xml,${encodeURIComponent(code)}" width="420" height="120"> Explain.</p></body></html>`;
    await ctx.route(/example\.com/, (r) => r.fulfill({ contentType: 'text/html', body: html }));
    await ctx.route(/api\.groq\.com|workers\.dev|fonts\.(googleapis|gstatic)\.com|askcassie\.pages\.dev/, (r) => r.abort());
    let sw = null;
    for (let i = 0; i < 80 && !sw; i++) {
      for (const w of ctx.serviceWorkers()) if (/\/background\.js$/.test(w.url()) && await w.evaluate(() => typeof readPicture === 'function').catch(() => false)) { sw = w; break; }
      if (!sw) await new Promise((r) => setTimeout(r, 250));
    }
    expect(sw, 'the Cassie extension did not start');
    const fake = () => sw.evaluate(() => {
      self.__prompts = []; self.__images = [];
      self.readPicture = async (keys, msg) => { self.__prompts.push(String(msg.prompt || '')); self.__images.push(String(msg.image || '').slice(0, 30)); return 'What I read:\n```python\nfor i in range(3):\n    print(i * 2)\n```\nIt counts 0, 1 and 2 and prints each one doubled: 0, 2, 4.'; };
    });
    await fake();
    await sw.evaluate(() => chrome.storage.local.set({ cassieHighlight: 'on', cassieHideNoted: false }));
    const page = ctx.pages()[0] || await ctx.newPage();
    const load = async (reload) => { if (reload) await page.reload(); else await page.goto('https://example.com/course/quiz'); await page.bringToFront(); await page.waitForFunction(() => document.getElementById('cassie-ext-host-92f1'), null, { timeout: 10000 }); await page.waitForTimeout(500); };
    await load();
    const R = "document.getElementById('cassie-ext-host-92f1').shadowRoot";
    const ui = () => page.evaluate((r) => { const s = eval(r), p = s.querySelector('.popover'), b = p.getBoundingClientRect(); return { open: !p.hidden, text: p.innerText, box: { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) }, note: (s.querySelector('.hidden-note') || {}).textContent || '' }; }, R);
    const highlight = async (sel) => { await page.evaluate((s) => { const r = document.createRange(); r.selectNode(document.querySelector(s)); const g = getSelection(); g.removeAllRanges(); g.addRange(r); document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); }, sel); await page.waitForTimeout(400); };
    const boardOpen = () => page.locator('.csk-panel').count();
    // a plain text highlight: the pop-up, and no picture
    await highlight('#plain');
    let u = await ui();
    expect(u.open && /What should I do with this/.test(u.text), 'a text highlight opens the pop-up: ' + JSON.stringify(u));
    // a code screenshot: the same pop-up, never the snip board; Explain reads a picture of it
    await highlight('#shot');
    u = await ui();
    expect(u.open && /What should I do with this/.test(u.text) && !(await boardOpen()), 'a picture highlight opens the pop-up, not the snip board: ' + JSON.stringify(u));
    expect((await sw.evaluate(() => self.__prompts.length)) === 0, 'nothing is sent until an option is picked');
    await page.evaluate((r) => eval(r).querySelector('.choice-btn[data-mode="explain"]').click(), R);
    await page.waitForFunction((r) => /prints each one doubled/.test(eval(r).querySelector('.popover').innerText), R, { timeout: 20000 });
    const sent = await sw.evaluate(() => ({ p: self.__prompts.slice(), img: self.__images.slice() }));
    expect(sent.p.length === 1 && /^data:image\//.test(sent.img[0]) && /copy out exactly every word and every line of code/.test(sent.p[0]) && /keeps its line breaks and indentation/.test(sent.p[0]) && /Never just ask for more context/.test(sent.p[0]), 'a picture went to Cassie with the copy-first prompt: ' + JSON.stringify([sent.img, sent.p[0] && sent.p[0].slice(0, 200)]));
    const pre = await page.evaluate((r) => (eval(r).querySelector('.popover .body pre') || {}).textContent || '', R);
    u = await ui();
    expect(/What I read/.test(u.text) && /for i in range\(3\):\n {4}print\(i \* 2\)/.test(pre) && !(await boardOpen()), 'the pop-up shows What I read with the code, indent kept: ' + JSON.stringify(pre));
    // move it by its header, then resize from the right edge and the bottom right corner (260x180 up to 90% of the screen)
    let b0 = u.box; // (corners are grabbed 6px in, inside the rounded corner)
    await page.mouse.move(b0.x + 40, b0.y + 12); await page.mouse.down(); await page.mouse.move(b0.x + 140, b0.y + 112, { steps: 5 }); await page.mouse.up();
    let b1 = (await ui()).box;
    expect(Math.abs(b1.x - (b0.x + 100)) <= 2 && Math.abs(b1.y - (b0.y + 100)) <= 2, 'it moves by its header: ' + JSON.stringify([b0, b1]));
    await page.mouse.move(b1.x + b1.w - 3, b1.y + b1.h / 2); await page.mouse.down(); await page.mouse.move(b1.x + b1.w + 150, b1.y + b1.h / 2, { steps: 5 }); await page.mouse.up();
    let b2 = (await ui()).box;
    expect(Math.abs(b2.w - (b1.w + 153)) <= 3 && b2.x === b1.x, 'the right edge makes it wider: ' + JSON.stringify([b1, b2]));
    await page.mouse.move(b2.x + b2.w - 6, b2.y + b2.h - 6); await page.mouse.down(); await page.mouse.move(b2.x + 40, b2.y + 40, { steps: 5 }); await page.mouse.up();
    let b3 = (await ui()).box;
    expect(b3.w === 260 && b3.h === 180, 'the corner shrinks it, down to 260x180: ' + JSON.stringify(b3));
    await page.mouse.move(b3.x + b3.w - 6, b3.y + b3.h - 6); await page.mouse.down(); await page.mouse.move(b3.x + 3000, b3.y + 3000, { steps: 5 }); await page.mouse.up();
    let b4 = (await ui()).box;
    expect(b4.w <= 1280 * 0.9 + 1 && b4.h <= 800 * 0.9 + 1 && b4.x + b4.w <= 1280 && b4.y + b4.h <= 800, 'it grows up to 90% of the screen and stays on screen: ' + JSON.stringify(b4));
    await page.mouse.move(b4.x + b4.w - 6, b4.y + b4.h - 6); await page.mouse.down(); await page.mouse.move(b4.x + b4.w - 300, b4.y + b4.h - 200, { steps: 5 }); await page.mouse.up();
    const kept = (await ui()).box;
    // closing keeps it closed: highlights open nothing, on a reload too, with a one-time note
    await page.evaluate((r) => eval(r).querySelector('.popover .header button').click(), R);
    u = await ui();
    expect(!u.open && /Double-tap Ctrl to bring Cassie back/.test(u.note), 'closed, with the note: ' + JSON.stringify(u));
    await highlight('#plain');
    expect(!(await ui()).open, 'closed: a highlight opens nothing');
    await load(true);
    await highlight('#plain');
    expect(!(await ui()).open, 'still closed after a reload');
    // Ctrl tapped twice: it opens (for the highlight there), and highlights open it again, after a reload too, where it was put
    await page.keyboard.press('Control'); await page.keyboard.press('Control');
    await page.waitForTimeout(300);
    u = await ui();
    expect(u.open && /What should I do with this/.test(u.text), 'double Ctrl brings it back: ' + JSON.stringify(u));
    expect(Math.abs(u.box.w - kept.w) <= 2 && Math.abs(u.box.h - kept.h) <= 2 && Math.abs(u.box.x - kept.x) <= 2 && Math.abs(u.box.y - kept.y) <= 2, 'at the size and place it was left (after a reload): ' + JSON.stringify([kept, u.box]));
    await page.evaluate(() => getSelection().removeAllRanges());
    await load(true);
    await highlight('#plain');
    expect((await ui()).open, 'highlights open it again, after a reload too');
    // the snip board moves and resizes the same way
    await boardMoves(page, async () => { await page.waitForFunction(() => document.getElementById('cassie-ext-host-92f1'), null, { timeout: 10000 }); await page.waitForTimeout(400); await page.evaluate(() => [...document.getElementById('cassie-ext-host-92f1').shadowRoot.querySelectorAll('button')].find((x) => /^Open Cassie’s board/.test(x.title)).click()); }, 'the extension');
  } finally { await ctx.close(); }
});

test('the app: the board moves by its title bar and resizes from its edges, and opens at that size and place next time', async (b) => {
  const { ctx, page, errors } = await open(b, { device: 'Desktop Chrome', viewport: { width: 1280, height: 800 }, server: false, state: { groqKey: 'gsk_test' } });
  try {
    await boardMoves(page, async () => { await page.waitForSelector('#board-btn', { timeout: 10000 }); await page.click('#board-btn'); }, 'the app');
    expect(!errors.length, 'page errors: ' + errors.join('; '));
  } finally { await ctx.close(); }
});

test('Cursor Cassie lessons: only the lesson is numbered (not Drive’s toolbar, thumbnails or the list under it), loops hug their part, nothing is drawn on blank space or the top bar, drawings follow the page or offer Look again; the card drags, resizes, minimizes, is remembered and moves off what she points at; follow-up questions typed or said (care first), saved in Your lessons; a cut-off reply keeps its whole steps and an unusable one is asked for once more', async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension/manifest.json'), 'utf8'));
  expect(manifest.permissions.slice().sort().join() === 'activeTab,contextMenus,scripting,sidePanel,storage', 'no new permission: ' + manifest.permissions.join());
  for (const f of ['errors.js', 'sketch.js', 'mic.js']) expect(fs.readFileSync(path.join(ROOT, 'extension', f), 'utf8') === fs.readFileSync(path.join(ROOT, f), 'utf8'), `extension/${f} is the app’s ${f}`);
  const ext = path.join(ROOT, 'extension');
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(require('os').tmpdir(), 'cassie-ext-')), {
    headless: true, viewport: { width: 1280, height: 800 }, ...(fs.existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : { channel: 'chromium' }),
    args: ['--headless=new', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  try {
    // the viewer page, at a Drive address and at an ordinary one
    const viewer = fs.readFileSync(path.join(ROOT, 'tests/fixtures/teach/viewer.html'), 'utf8');
    await ctx.route(/drive\.google\.com|example\.com/, (r) => r.fulfill({ contentType: 'text/html', body: viewer }));
    await ctx.route(/api\.groq\.com|workers\.dev|fonts\.(googleapis|gstatic)\.com|askcassie\.pages\.dev/, (r) => r.abort());
    let sw = null;
    for (let i = 0; i < 80 && !sw; i++) {
      for (const w of ctx.serviceWorkers()) if (/\/background\.js$/.test(w.url()) && await w.evaluate(() => typeof readPicture === 'function').catch(() => false)) { sw = w; break; }
      if (!sw) await new Promise((r) => setTimeout(r, 250));
    }
    expect(sw, 'the Cassie extension did not start');
    // the AI, faked: each call takes the next reply in line (self.__replies), and every prompt is kept
    await sw.evaluate(() => {
      self.__prompts = []; self.__replies = []; self.__fails = [];
      self.readPicture = async (keys, msg) => { self.__prompts.push(String(msg.prompt || '')); return self.__replies.length ? self.__replies.shift() : '{"answer":"(none)","steps":[]}'; };
      self.speakLeft = async () => ({ on: false, left: 0 });
      self.teachFail = async (code) => { self.__fails.push(code); };
      return chrome.storage.local.set({ teachVoice: 'off', teachAuto: 'off' });
    });
    const replies = (list) => sw.evaluate((l) => { self.__replies = l.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))); self.__prompts = []; }, list);
    const prompts = () => sw.evaluate(() => self.__prompts.slice());
    const page = ctx.pages()[0] || await ctx.newPage();
    const HOST = '#cassie-teach-host-92f1';
    const world = async () => {
      const cdp = await ctx.newCDPSession(page), worlds = [];
      cdp.on('Runtime.executionContextCreated', (e) => worlds.push(e.context));
      await cdp.send('Runtime.enable'); await page.waitForTimeout(300);
      const { frameTree } = await cdp.send('Page.getFrameTree');
      const w = worlds.find((c) => c.auxData && c.auxData.frameId === frameTree.frame.id && c.auxData.type === 'isolated' && /Cassie/.test(c.name));
      return async (js) => { const r = await cdp.send('Runtime.evaluate', { contextId: w.id, expression: js, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300)); return r.result.value; };
    };
    const open = async (url) => { await page.goto(url); await page.bringToFront(); await page.waitForFunction(() => document.getElementById('cassie-ext-host-92f1'), null, { timeout: 10000 }); await page.waitForTimeout(400); return world(); };
    const lessonNow = () => page.evaluate((h) => { const n = document.querySelector(h); if (!n) return null; const r = n.shadowRoot, c = r.querySelector('.ct-card').getBoundingClientRect(); return { step: n.dataset.step, drawn: n.dataset.drawn, lost: n.dataset.lost || '', count: r.querySelector('.ct-count').textContent, say: r.querySelector('.ct-say').textContent, card: { left: c.left, top: c.top, right: c.right, bottom: c.bottom, width: c.width, height: c.height }, cursor: r.querySelector('.ct-cursor').classList.contains('on'), text: r.querySelector('.ct-card').innerText }; }, HOST);
    // the dark ink on her drawing layer (grey earlier steps and the white edge are left out)
    const ink = () => page.evaluate((h) => {
      const c = document.querySelector(h).shadowRoot.querySelector('canvas'), k = c.width / c.clientWidth, d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
      for (let y = 0; y < c.height; y += 1) for (let x = 0; x < c.width; x += 1) { const i = (y * c.width + x) * 4; if (d[i + 3] > 200 && d[i] < 60) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } }
      return x1 < 0 ? null : [x0 / k, y0 / k, x1 / k, y1 / k].map(Math.round);
    }, HOST);
    const boxOf = (sel) => page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom].map(Math.round); }, sel);
    const head = (text) => page.evaluate((t) => { const h = [...document.querySelectorAll('h3, h2')].find((x) => x.textContent === t); h.id = h.id || 'h-' + t.replace(/\W+/g, ''); return '#' + h.id; }, text);
    const settle = () => page.waitForTimeout(1700);
    // the size of the picture she is shown, in the page's pixels (her spots are shares of it, like the AI's)
    const picture = (w) => w('chrome.runtime.sendMessage({ type: "CASSIE_SNIP" }).then((o) => new Promise((res) => { const i = new Image(); i.onload = () => res([i.naturalWidth / devicePixelRatio, i.naturalHeight / devicePixelRatio]); i.src = o.dataUrl; }))');
    const shadowClick = (sel) => page.evaluate(([h, s]) => document.querySelector(h).shadowRoot.querySelector(s).click(), [HOST, sel]);

    // 1. Google Drive's PDF viewer: taught from the picture; nothing drawn on its toolbar, thumbnails or blank space
    let inWorld = await open('https://drive.google.com/file/d/abc/view');
    expect(await inWorld('CassieTeach.scan().pictureOnly') === true, 'Drive’s PDF viewer is a picture-only page');
    let euler = await boxOf(await head('Euler circuit'));
    const [PW, PH] = await picture(inWorld);
    const share = (x, y) => ({ x: +(x / PW).toFixed(4), y: +(y / PH).toFixed(4) });
    const at = share((euler[0] + euler[2]) / 2, (euler[1] + euler[3]) / 2);
    await replies([{ steps: [{ say: 'Look at the Euler circuit card.', point: at, draw: [{ shape: 'circle', ...share(700, 30), r: 0.04 }, { shape: 'circle', ...share(60, 500), r: 0.03 }, { shape: 'circle', ...share(640, 390), r: 0.03 }, { shape: 'box', x: at.x - 0.09, y: at.y - 0.02, w: 0.18, h: 0.04 }] }] }]);
    expect(await inWorld('CassieTeach.run({}).then((r) => r.steps.length, (e) => "ERR " + e.message)') === 1, 'the Drive lesson starts');
    await settle();
    if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/teach-drive.png' });
    let L = await lessonNow(), I = await ink();
    expect(L.drawn === 'box', 'only the box on the card is drawn: not on the toolbar, the thumbnails or the blank gap: ' + JSON.stringify(L));
    expect(I && I[1] >= 72 && I[0] >= 150, 'no ink on Drive’s toolbar or thumbnails: ' + JSON.stringify(I));
    expect(!/[–—]/.test(L.text), 'no dashes on the card: ' + L.text);
    await inWorld('CassieTeach.stop(), 1');

    // 2. an ordinary page with the same layout: only the lesson's own parts are numbered
    inWorld = await open('https://example.com/notes');
    const items = await inWorld('CassieTeach.scan().items.map((x) => x.what)');
    const chrome = items.filter((w) => /Comment|Share|Open with|audio overview|Page 2 \/ 45|"Page [123]"|Final exam notes|Model answers|"Name"|"Owner"/.test(w));
    expect(!chrome.length && items.some((w) => /Euler circuit/.test(w)), 'only the lesson is numbered: ' + JSON.stringify(items));
    const n = items.findIndex((w) => /heading "Euler circuit"/.test(w)) + 1, np = items.findIndex((w) => /heading "Euler path"/.test(w)) + 1;
    euler = await boxOf(await head('Euler circuit'));
    const path_ = await boxOf(await head('Euler path'));
    const gap = await page.evaluate(([w, h]) => { const r = document.querySelector('.gap').getBoundingClientRect(); return [(r.left + r.right) / 2 / w, (r.top + r.bottom) / 2 / h]; }, [PW, PH]);
    await replies([{ steps: [
      { say: 'The Euler circuit card.', point: n, draw: [{ shape: 'circle', el: n }] },
      { say: 'Here is some blank space.', point: { x: gap[0], y: gap[1] }, draw: [{ shape: 'circle', x: gap[0], y: gap[1], r: 0.03 }] },
      { say: 'This points at nothing real.', point: 999, draw: [{ shape: 'circle', el: 999 }] },
      { say: 'And the Euler path heading.', point: np, draw: [{ shape: 'circle', x: (path_[0] + path_[2]) / 2 / PW, y: (path_[1] + path_[3]) / 2 / PH, r: 0.06 }, { shape: 'circle', el: np }] },
    ] }]);
    await inWorld('chrome.storage.local.remove("teachCard"), 1');
    expect(await inWorld('CassieTeach.run({ again: () => { window.__again = (window.__again || 0) + 1; } }).then((r) => r.steps.length, (e) => "ERR " + e.message)') === 4, 'the lesson starts with 4 steps');
    await settle();
    L = await lessonNow(); I = await ink();
    expect(L.drawn === 'circle' && I, 'step 1 circles the heading: ' + JSON.stringify(L));
    const pad = [euler[0] - I[0], euler[1] - I[1], I[2] - euler[2], I[3] - euler[3]];
    expect(pad.every((p) => p >= 0 && p <= 8), `the loop hugs the heading, at most 8px out: heading ${euler}, ink ${I}, padding ${pad}`);
    // the card moved off what she points at (it started bottom right, over this heading)
    expect(!(L.card.right > euler[0] && L.card.left < euler[2] && L.card.bottom > euler[1] && L.card.top < euler[3]), 'the card moved off the heading: ' + JSON.stringify(L.card));
    await shadowClick('.ct-next'); await settle();
    L = await lessonNow();
    expect(L.drawn === '' && !L.cursor && /blank space/.test(L.say) && !(await ink()), 'blank space: the words stay, no circle and no arrow: ' + JSON.stringify(L));
    await shadowClick('.ct-next'); await settle();
    L = await lessonNow();
    expect(L.drawn === '' && !L.cursor && /nothing real/.test(L.say), 'part 999: the words stay, nothing drawn: ' + JSON.stringify(L));
    await shadowClick('.ct-next'); await settle();
    L = await lessonNow();
    expect(L.drawn === 'circle,circle', 'step 4 draws both its circles: ' + JSON.stringify(L));
    // 3. the page scrolls 300px inside its own box: the drawings go with it
    const before = await ink();
    await page.evaluate(() => { document.getElementById('scroller').scrollTop += 300; });
    await page.waitForTimeout(500);
    const after = await ink(), moved = await boxOf(await head('Euler path'));
    expect(after && Math.abs(after[1] - (before[1] - 300)) <= 3 && after[1] <= moved[1] && after[3] >= moved[3], `the drawings follow the scroll: before ${before}, after ${after}, heading now ${moved}`);
    // the window changes size: she can't follow that, so the drawings fade and Look again shows
    await page.setViewportSize({ width: 1200, height: 760 }); await page.waitForTimeout(500);
    L = await lessonNow();
    expect(L.lost === '1' && /Look again/.test(L.text) && /no longer line up/.test(L.text), 'Look again after the page moved under her: ' + L.text);
    await shadowClick('.ct-again');
    expect(await inWorld('window.__again') === 1, 'Look again starts the lesson over');
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.evaluate(() => { document.getElementById('scroller').scrollTop = 0; }); // (the parts are numbered as at first again)

    // 4. the card: drag, resize, stays on screen, remembered; and Minimize
    await replies([{ steps: [{ say: 'First.', point: n, draw: [] }, { say: 'Second.', point: n, draw: [] }] }]);
    await inWorld('CassieTeach.run({}).then((r) => r.steps.length)');
    await settle();
    let c0 = (await lessonNow()).card;
    const hb = await page.evaluate((h) => { const r = document.querySelector(h).shadowRoot.querySelector('.ct-who').getBoundingClientRect(); return [r.left + 20, r.top + r.height / 2]; }, HOST);
    await page.mouse.move(hb[0], hb[1]); await page.mouse.down(); await page.mouse.move(hb[0] - 300, hb[1] + 200, { steps: 6 }); await page.mouse.up();
    let c1 = (await lessonNow()).card;
    expect(Math.abs(c1.left - (c0.left - 300)) <= 3 && Math.abs(c1.top - (c0.top + 200)) <= 3, `the card drags by its header: ${JSON.stringify(c0)} to ${JSON.stringify(c1)}`);
    const gb = await page.evaluate((h) => { const r = document.querySelector(h).shadowRoot.querySelector('.ct-size').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2, r.width, r.height]; }, HOST);
    expect(gb[2] >= 44 && gb[3] >= 44, 'the resize corner is 44px');
    const under = await page.evaluate((h) => { const r = document.querySelector(h).shadowRoot, g = r.querySelector('.ct-size').getBoundingClientRect(); return [...r.querySelectorAll('.ct-card button:not(.ct-size), .ct-card input')].filter((b) => { const q = b.getBoundingClientRect(); return q.width && !(q.right <= g.left || q.left >= g.right || q.bottom <= g.top || q.top >= g.bottom); }).map((b) => b.className || b.tagName); }, HOST);
    expect(!under.length, 'the resize corner sits on no other control: ' + under.join(', '));
    await page.mouse.move(gb[0], gb[1]); await page.mouse.down(); await page.mouse.move(gb[0] + 120, gb[1] + 60, { steps: 6 }); await page.mouse.up();
    const c2 = (await lessonNow()).card;
    expect(Math.abs(c2.width - (c1.width + 120)) <= 3 && Math.abs(c2.height - (c1.height + 60)) <= 3, `the card resizes from its corner: ${JSON.stringify(c1)} to ${JSON.stringify(c2)}`);
    await page.mouse.move(c2.left + 30, c2.top + 15); await page.mouse.down(); await page.mouse.move(-400, -400, { steps: 6 }); await page.mouse.up();
    const c3 = (await lessonNow()).card;
    expect(c3.left >= 0 && c3.top >= 0 && c3.right <= 1280 && c3.bottom <= 800, 'dragged off the edge, it stays fully on screen: ' + JSON.stringify(c3));
    // with the keyboard: the header takes the arrow keys
    await page.evaluate((h) => document.querySelector(h).shadowRoot.querySelector('.ct-head').focus(), HOST);
    await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowDown');
    const c4 = (await lessonNow()).card;
    expect(c4.left - c3.left >= 19 && c4.top - c3.top >= 19, 'the arrow keys move it: ' + JSON.stringify([c3, c4]));
    // it was moved by hand in this lesson, so the next step leaves it where the student put it
    await shadowClick('.ct-next'); await settle();
    expect(JSON.stringify((await lessonNow()).card) === JSON.stringify(c4), 'moved by hand: it stays put');
    // Minimize shrinks it to its header, and back
    await shadowClick('.ct-min-b');
    const small = (await lessonNow()).card;
    expect(small.height < 110 && !(await page.evaluate((h) => document.querySelector(h).shadowRoot.querySelector('.ct-body').offsetHeight, HOST)), 'Minimize shrinks it to its header: ' + JSON.stringify(small));
    await shadowClick('.ct-min-b');
    expect(Math.abs((await lessonNow()).card.height - c2.height) <= 3, 'and back to its size');
    await shadowClick('.ct-x');
    // remembered: the next lesson opens where it was left, at its size
    await replies([{ steps: [{ say: 'Again.', point: null, draw: [] }] }]);
    await inWorld('CassieTeach.run({}).then((r) => r.steps.length)');
    await settle();
    const c5 = (await lessonNow()).card;
    expect(Math.abs(c5.left - c4.left) <= 3 && Math.abs(c5.top - c4.top) <= 3 && Math.abs(c5.width - c2.width) <= 3, 'the next lesson remembers its place and size: ' + JSON.stringify([c4, c5]));

    // 5. questions about a step: typed, said, and care first; all saved with the lesson
    const sizes = await page.evaluate((h) => [...document.querySelector(h).shadowRoot.querySelectorAll('.ct-card button, .ct-card input')].filter((b) => b.offsetParent).map((b) => { const r = b.getBoundingClientRect(); return [b.className || b.getAttribute('aria-label') || b.tagName, Math.round(r.width), Math.round(r.height)]; }), HOST);
    expect(sizes.every(([, w, h]) => w >= 44 && h >= 44), 'every control on the card is 44px: ' + JSON.stringify(sizes));
    await replies([{ answer: 'Every vertex in the example has degree 2, which is even, so there is an Euler circuit.', point: n, draw: [{ shape: 'underline', el: n }] }]);
    await page.evaluate((h) => { const r = document.querySelector(h).shadowRoot; r.querySelector('.ct-ask input').value = 'Why is there an Euler circuit?'; r.querySelector('.ct-ask').requestSubmit(); }, HOST);
    await page.waitForFunction((h) => /degree 2/.test(document.querySelector(h).shadowRoot.querySelector('.ct-ans').textContent), HOST, { timeout: 8000 });
    await page.waitForTimeout(900);
    L = await lessonNow();
    let P = await prompts();
    expect(P.length === 1 && /The student asks: "Why is there an Euler circuit\?"/.test(P[0]) && /Again\./.test(P[0]) && /never add facts/.test(P[0]), 'the question goes with the step and the accuracy rules: ' + (P[0] || '').slice(0, 300));
    if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/teach-followup.png' });
    expect(L.drawn === 'underline' && /You asked: Why is there an Euler circuit\?/.test(L.text), 'the answer shows in the card, and she points and draws: ' + JSON.stringify(L));
    // said, with the mic (the extension's own page script hears the faked speech)
    await inWorld(`(${FAKE_EARS})(); 1`);
    await replies([{ answer: 'A circuit is a closed path that starts and ends at the same vertex.', point: 0, draw: [] }]);
    const said = await micSay(page, '.ct-ask input', { root: HOST, inWorld });
    micLooksRight('the lesson card', said);
    await page.waitForFunction((h) => /closed path/.test(document.querySelector(h).shadowRoot.querySelector('.ct-ans').textContent), HOST, { timeout: 8000 });
    P = await prompts();
    expect(P.length === 1 && P[0].includes(SAID), 'the mic sends what was said');
    // care first: no AI is asked
    await replies([]);
    await page.evaluate((h) => { const r = document.querySelector(h).shadowRoot; r.querySelector('.ct-ask input').value = 'I want to hurt myself'; r.querySelector('.ct-ask').requestSubmit(); }, HOST);
    await page.waitForTimeout(500);
    const careText = await page.evaluate((h) => document.querySelector(h).shadowRoot.querySelector('.ct-ans').textContent, HOST);
    expect(/1553|Hopeline|NCMH/i.test(careText) && (await prompts()).length === 0, 'care first, with no AI call: ' + careText.slice(0, 160));
    await shadowClick('.ct-x');
    await page.waitForTimeout(400);
    const saved = await sw.evaluate(() => chrome.storage.local.get('teachLessons').then((o) => o.teachLessons[0]));
    expect(saved.qa && saved.qa.length === 3 && /Euler circuit/.test(saved.qa[0].q) && saved.qa[1].q === SAID, 'the questions are saved with the lesson: ' + JSON.stringify(saved.qa));
    // and Your lessons in the side panel shows them
    const id = new URL(sw.url()).host;
    const panel = await ctx.newPage();
    await panel.goto(`chrome-extension://${id}/panel.html`);
    await panel.waitForSelector('.lessons .lesson', { timeout: 10000 });
    await panel.locator('.lessons .lesson').first().locator('summary').click();
    expect(/You asked: Why is there an Euler circuit\?/.test(await panel.locator('.lessons .lesson').first().innerText()), 'Your lessons shows the questions');
    await panel.close();

    // 6. replies that can't be used
    await page.bringToFront();
    const whole = JSON.stringify({ steps: [1, 2, 3, 4].map((i) => ({ say: `Step ${i} of the Euler lesson.`, point: n, draw: [] })) });
    await replies([whole.slice(0, whole.indexOf('Step 4') + 12)]);
    expect(await inWorld('CassieTeach.run({}).then((r) => r.steps.length, (e) => "ERR " + e.message)') === 3 && (await prompts()).length === 1, 'cut off: its 3 whole steps are taught, with 1 call');
    await inWorld('CassieTeach.stop(), 1');
    await replies(['Sorry, I cannot help with that page right now.', { steps: [{ say: 'Now it works.', point: n, draw: [] }] }]);
    expect(await inWorld('CassieTeach.run({}).then((r) => r.steps.length, (e) => "ERR " + e.message)') === 1, 'unusable, then good: the lesson shows');
    P = await prompts();
    expect(P.length === 2 && !/could not be read/.test(P[0]) && /your last reply could not be read/.test(P[1]) && /At most 5 steps/.test(P[1]), 'exactly 2 calls, the second stricter');
    await inWorld('CassieTeach.stop(), 1');
    await replies(['No idea.', 'Still no JSON here.']);
    const err = await inWorld('CassieTeach.run({}).then(() => "shown", (e) => e.code)');
    expect(err === 'teach_failed' && (await prompts()).length === 2, 'both unusable: teach_failed after exactly 2 calls: ' + err);
    await page.waitForTimeout(300);
    expect(JSON.stringify(await sw.evaluate(() => self.__fails)) === '["teach_not_json"]', 'only the reason code is reported: ' + JSON.stringify(await sw.evaluate(() => self.__fails)));
    // the lesson request: true to the page
    const ask = await inWorld('CassieTeach.prompt({ q: "", page: { title: "t", items: [] } })');
    expect(/Teach only what this page or picture shows/.test(ask) && /never add facts/.test(ask) && /say so in that step instead of guessing/.test(ask) && /never on the app's or browser's own toolbars/.test(ask), 'the lesson request asks for accuracy');
  } finally { await ctx.close(); }
});

test('Talk with Cassie: a voice conversation, and Teach Cassie (she asks questions, no formatting read aloud)', async (b) => {
  const { ctx, page, errors, groqCalls } = await open(b, { server: false, state: { groqKey: 'gsk_test', hearing: 'fast' }, fakeGroq: (body) => ({ text: /teaching YOU/.test(body.messages[0].content) ? 'Ooh, so plants make **food** from light? Why do they need water then?' : 'Sure! x = 4, because 2x equals 8.' }) });
  await ctx.addInitScript(FAKE_VOICE, {});
  await page.reload();
  const phase = () => page.evaluate(() => document.querySelector('.vc') && document.querySelector('.vc').dataset.phase);
  await page.click('#voice-btn');
  await page.waitForFunction(() => document.querySelector('.vc') && !document.querySelector('.vc').hidden && document.querySelector('.vc').dataset.phase === 'listening', null, { timeout: 5000 });
  expect((await page.evaluate(() => window.__shown))[0] === 'Hi! I’m listening. Ask me anything.', 'Cassie greets you out loud');
  await page.evaluate(() => window.__say('What is x if 2x equals 8?'));
  await page.waitForFunction(() => window.__shown.some((t) => /x equals 4/.test(t)) && document.querySelector('.vc').dataset.phase === 'listening', null, { timeout: 15000 });
  const sys = groqCalls.at(-1).messages[0].content;
  expect(/read aloud/.test(sys) && !/You have a drawing board/.test(sys), 'a spoken reply is asked for, with no drawing board');
  // Teach Cassie
  if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/voice-chat.png' });
  await page.click('.vc-modes [data-vmode="teach"]');
  await page.waitForFunction(() => window.__shown.some((t) => /your student today/.test(t)) && document.querySelector('.vc').dataset.phase === 'listening', null, { timeout: 5000 });
  await page.evaluate(() => window.__say('Photosynthesis is how plants make food from sunlight'));
  await page.waitForFunction(() => window.__shown.some((t) => /Why do they need water/.test(t)), null, { timeout: 15000 });
  const said = await page.evaluate(() => window.__shown.at(-1));
  expect(!/\*/.test(said), 'markdown is never read aloud: ' + said);
  expect(/teaching YOU/.test(groqCalls.at(-1).messages[0].content), 'Teach mode tells Cassie to be the curious classmate');
  expect(await page.locator('#chat-log .bubble-user', { hasText: 'Photosynthesis is how plants make food' }).count() === 1, 'what you said is saved in the chat');
  if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/voice-teach.png' });
  // the mic pauses and resumes
  await page.waitForFunction(() => document.querySelector('.vc').dataset.phase === 'listening', null, { timeout: 5000 });
  await page.click('.vc-mic');
  expect(await phase() === 'paused', 'the mic pauses listening');
  await page.click('.vc-mic');
  expect(await phase() === 'listening', 'and starts again');
  // a man's voice is remembered; the device's voice is never bent (a lowered pitch sounded scary)
  await page.click('.vc-gender [data-gender="man"]');
  await page.waitForFunction(() => window.__shown.at(-1) === 'Hi! This is my voice now.', null, { timeout: 5000 });
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('cassie.v2')).voiceGender) === 'man', 'the man’s voice is remembered');
  await page.click('.vc-gender [data-gender="woman"]');
  // Quiz me turns the quiz on, ending puts it back
  await page.click('.vc-modes [data-vmode="quiz"]');
  expect(await page.evaluate(() => document.getElementById('quiz-btn').classList.contains('active')), 'Quiz me out loud turns the quiz on');
  await page.click('.vc-x');
  expect(await page.locator('.vc').isHidden() && !(await page.evaluate(() => document.getElementById('quiz-btn').classList.contains('active'))), 'ending the call closes it and the quiz');
  expect(errors.length === 0, 'page errors: ' + errors.join('; '));
  await ctx.close();
});

test('Talk with Cassie without a built-in speech recognizer: Cassie’s server writes down what you said', async (b) => {
  await serverMode({ groq: 'ok', heard: 'What is osmosis?', heardCalls: 0, streamed: 0, reply: 'Osmosis is water moving through a membrane.' });
  const { ctx, page, errors } = await open(b, {});
  await ctx.addInitScript(FAKE_VOICE, { noRecognizer: true });
  await page.reload();
  await page.click('#voice-btn');
  await page.waitForFunction(() => document.querySelector('.vc').dataset.phase === 'listening', null, { timeout: 5000 });
  expect(/tap the mic to send/i.test(await page.locator('.vc-status').innerText()), 'it says to tap the mic when done: ' + await page.locator('.vc-status').innerText());
  await page.click('.vc-mic'); // done talking
  await page.waitForFunction(() => window.__shown.some((t) => /water moving through a membrane/.test(t)), null, { timeout: 15000 });
  expect(/What is osmosis/.test(await page.locator('.vc-you').innerText()), 'what you said shows on screen');
  expect((await serverMode({})).heardCalls === 1, 'the recording went to the server once');
  expect((await serverMode({})).streamed >= 1, 'the spoken answer streamed from the server (she can start talking before it is all written)');
  // the next thing you say goes with words from the conversation, so Whisper spells them right
  await page.waitForFunction(() => document.querySelector('.vc').dataset.phase === 'listening', null, { timeout: 5000 });
  await page.click('.vc-mic');
  for (let i = 0; i < 60 && (await serverMode({})).heardCalls < 2; i++) await page.waitForTimeout(250);
  await page.waitForFunction(() => document.querySelector('.vc').dataset.phase === 'listening', null, { timeout: 15000 });
  expect(/membrane/.test((await serverMode({})).heardPrompt || ''), 'the hint carries words from the conversation');
  await page.click('.vc-x');
  expect(errors.length === 0, 'page errors: ' + errors.join('; '));
  await serverMode({ reply: '', heard: '' });
  await ctx.close();
});

test('Talk with Cassie hears with Whisper by default (most accurate), even where the browser could listen', async (b) => {
  await serverMode({ groq: 'ok', heard: 'Explain mitochondria', heardCalls: 0, reply: 'Mitochondria make energy for the cell.' });
  const { ctx, page, errors } = await open(b, {});
  await ctx.addInitScript(FAKE_VOICE, {});
  await page.reload();
  await page.click('#voice-btn');
  await page.waitForFunction(() => document.querySelector('.vc').dataset.phase === 'listening', null, { timeout: 5000 });
  expect(!(await page.evaluate(() => window.__recs.some((r) => r.live))), 'the browser’s own recognizer is not used');
  await page.click('.vc-mic');
  await page.waitForFunction(() => window.__shown.some((t) => /make energy for the cell/.test(t)), null, { timeout: 15000 });
  expect((await serverMode({})).heardCalls === 1, 'Whisper on the server wrote it down');
  await page.click('.vc-x');
  // "Fastest" in Settings switches back to the browser listening
  expect(await page.locator('#hearing-select').count() === 1 && await page.locator('#voice-gender-select').count() === 1, 'Settings has the voice and hearing choices');
  expect(errors.length === 0, 'page errors: ' + errors.join('; '));
  await serverMode({ reply: '', heard: '' });
  await ctx.close();
});

test.slow('Explore cells are their own view: own card on the Labs shelf and in 3D, Animal or Plant inside it, opened straight away (never through the body)', async (b) => {
  const { ctx, page, errors } = await open(b, { device: process.env.DEVICE || 'Desktop Chrome' /* (the Labs shelf: a computer's; a phone has the Labs tab) */, scale: 1, server: false, state: { groqKey: 'gsk_test' }, setup: async (c) => {
    // anything of the body: its model files, or the 3D view turning into the body for a moment
    await c.addInitScript(() => {
      window.__body = [];
      new MutationObserver((ms) => { for (const m of ms) if (m.target.classList && m.target.classList.contains('x3d-body-mode')) window.__body.push('body mode'); })
        .observe(document, { subtree: true, attributes: true, attributeFilter: ['class'] });
    });
  } });
  const bodyFiles = [];
  page.on('request', (r) => { if (/\/explore\/body\//.test(r.url())) bodyFiles.push(r.url()); });
  // the Labs shelf and its 3D menu: the body and the cells are two cards
  await tapLabs(page);
  await page.waitForSelector(LABS_READY, { timeout: 20000 });
  expect(await page.locator('.labs-grid [data-lab="cells3d"]').count() === 1 && await page.locator('.labs-grid [data-lab="body3d"]').count() === 1, 'the shelf has a cells card and a body card');
  await page.click('.labs-chips [data-subject="3d"]');
  expect(await page.locator('.labs-grid [data-lab="cells3d"]').count() === 1 && await page.locator('.labs-grid [data-lab="body3d"]').count() === 1, 'the 3D menu has both too');
  expect(/Cells 3D/.test(await page.locator('.labs-grid [data-lab="cells3d"]').innerText()), 'the cells card is named for the cells');
  // the cells card opens the cells straight away
  await openCard(page, '.labs-grid [data-lab="cells3d"]');
  await page.waitForSelector('.x3d:not([hidden]) .x3d-chip[data-part="nucleus"]', { timeout: 30000 });
  const tabs = await page.$$eval('.x3d-switch [data-cell]', (t) => t.map((x) => x.dataset.cell + ':' + x.getAttribute('aria-selected')));
  expect(tabs.join() === 'animal:true,plant:false', 'inside the cells: Animal or Plant, nothing else: ' + tabs);
  expect(await page.locator('.x3d-switch').isVisible() && await page.locator('.x3d-find').isHidden(), 'the cell switch shows; the body’s search does not');
  await page.click('.x3d-switch [data-cell="plant"]');
  await page.waitForSelector('.x3d-chip[data-part="chloroplast"]', { timeout: 15000 });
  await page.click('.x3d-close');
  await page.waitForSelector(LABS_READY, { timeout: 10000 });
  // opened again, the cells come back on the one last looked at
  await openCard(page, '.labs-grid [data-lab="cells3d"]');
  await page.waitForSelector('.x3d:not([hidden]) .x3d-chip[data-part="chloroplast"]', { timeout: 30000 });
  expect(await page.locator('.x3d-switch [data-cell="plant"]').getAttribute('aria-selected') === 'true', 'the plant cell, as left');
  await page.click('.x3d-close');
  // a link opens the cells too
  await page.goto(APP + '?explore=cells');
  await page.waitForSelector('.x3d:not([hidden]) .x3d-chip[data-part="nucleus"]', { timeout: 30000 });
  expect(await page.locator('.x3d-switch').isVisible() && await page.locator('.x3d-switch [data-cell="body"]').count() === 0, 'the link opens the cells, with no body tab');
  const body = await page.evaluate(() => window.__body);
  expect(!body.length && !bodyFiles.length, 'the body never showed or loaded on the way to the cells: ' + JSON.stringify({ body, bodyFiles: bodyFiles.slice(0, 3) }));
  expect(errors.length === 0, 'page errors: ' + errors.join('; '));
  await ctx.close();
});

test('Explore 3D body on a laptop (1366 wide, a mouse): every body system chip shows and turns on and off with a click, and Look around and the letters sit above the chips', async (b) => {
  const { ctx, page, errors } = await open(b, { server: false, viewport: { width: 1366, height: 657 }, state: { groqKey: 'gsk_test' } });
  await open3d(page, 'body3d');
  await page.waitForSelector('.x3d:not([hidden]) .x3d-sys', { timeout: 20000 });
  await page.waitForFunction(() => document.querySelector('.x3d-loading').hidden, null, { timeout: 30000 });
  const chips = () => page.$$eval('.x3d-sys', (cs) => cs.map((c) => { const r = c.getBoundingClientRect(); const t = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { name: c.textContent.trim(), in: r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, hit: !!t && (t === c || c.contains(t)) }; }));
  // (the chip row eases in once the body has loaded: give it a moment to settle before checking)
  let bad = [];
  for (let i = 0; i < 10; i++) { bad = (await chips()).filter((c) => !c.in || !c.hit).map((c) => c.name); if (!bad.length) break; await page.waitForTimeout(200); }
  expect(!bad.length, 'chips off screen or covered on a laptop (a mouse cannot swipe the row): ' + bad.join());
  for (const sys of ['lymphatic', 'reproductive', 'circulatory']) {
    const was = await page.getAttribute(`.x3d-sys[data-sys="${sys}"]`, 'aria-pressed');
    await page.click(`.x3d-sys[data-sys="${sys}"]`);
    await page.waitForFunction(([s, w]) => document.querySelector(`.x3d-sys[data-sys="${s}"]`).getAttribute('aria-pressed') !== w, [sys, was], { timeout: 5000 });
  }
  if (await page.locator('.x3d-view').isHidden()) await page.click('[data-tool="view"]').catch(() => {});
  const gap = await page.evaluate(() => {
    const bar = document.querySelector('.x3d-parts').getBoundingClientRect().top;
    return ['.x3d-view', '.x3d-gizmo'].map((q) => { const e = document.querySelector(q); return e && !e.hidden ? [q, Math.round(bar - e.getBoundingClientRect().bottom)] : [q, 'hidden']; });
  });
  expect(gap.every(([, g]) => g === 'hidden' || g >= 0), 'Look around and the letters sit above the chips: ' + JSON.stringify(gap));
  expect(errors.length === 0, 'page errors: ' + errors.join('; '));
  if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/body-chips-1366.png' });
  await ctx.close();
});

test.slow('Explore 3D: every endocrine gland (pituitary, hypothalamus, pineal, thyroid, parathyroids, thymus, adrenals, pancreas, ovaries, testes) is found by its everyday name with Find a part, and a tap shows its card: what it is and what it does', async (b) => {
  const { ctx, page, errors } = await open(b, { server: false, scale: 1, state: { groqKey: 'gsk_test' } });
  try {
    await open3d(page, 'body3d');
    await page.waitForSelector('.x3d:not([hidden]) .x3d-sys', { timeout: 20000 });
    await page.waitForFunction(() => document.querySelector('.x3d-loading').hidden, null, { timeout: 30000 });
    if (await page.locator('.x3d-sys[data-sys="endocrine"]').getAttribute('aria-pressed') !== 'true') await page.click('.x3d-sys[data-sys="endocrine"]');
    const GLANDS = [['pituitary', /^Pituitary gland/], ['hypothalamus', /^Hypothalamus/], ['pineal', /^Pineal gland/], ['thyroid', /^Thyroid gland/], ['parathyroid', /parathyroid gland/i],
      ['thymus', /thymus/i], ['adrenal', /^Adrenal gland/], ['pancreas', /^Pancreas/], ['ovary', /^Ovary/], ['testis', /^Testis/]];
    const report = [];
    for (const [q, want] of GLANDS) {
      await page.fill('.x3d-search', '');
      await page.fill('.x3d-search', q);
      const found = await page.waitForFunction((w) => { const r = document.querySelector('.x3d-results'); return r && !r.hidden && [...r.querySelectorAll('button')].some((x) => new RegExp(w.src, w.flags).test(x.innerText)); }, { src: want.source, flags: want.flags }, { timeout: 8000 }).then(() => true, () => false);
      if (!found) { report.push(`${q}: not found (results: ${await page.evaluate(() => [...document.querySelectorAll('.x3d-results button')].map((x) => x.innerText.split('\n')[0]).join(' | '))})`); continue; }
      const first = await page.evaluate(() => (document.querySelector('.x3d-results button') || {}).innerText || '');
      if (!want.test(first.split('\n')[0])) report.push(`${q}: found, but not the first result (first: ${first.split('\n')[0]})`);
      await page.evaluate((w) => { const re = new RegExp(w.src, w.flags); [...document.querySelectorAll('.x3d-results button')].find((x) => re.test(x.innerText)).click(); }, { src: want.source, flags: want.flags });
      const card = await page.waitForFunction((w) => { const h = document.querySelector('.x3d-sheet h3'); return h && !document.querySelector('.x3d-sheet').hidden && new RegExp(w.src, w.flags).test(h.textContent); }, { src: want.source, flags: want.flags }, { timeout: 30000 }).then(() => true, () => false);
      if (!card) { report.push(`${q}: tapped, but no card (shows: ${await page.evaluate(() => document.querySelector('.x3d-sheet h3') && document.querySelector('.x3d-sheet h3').textContent)})`); continue; }
      const like = await page.locator('.x3d-like').innerText(), does = await page.locator('.x3d-does').innerText();
      if (!/What it is:/.test(like) || !/What it does:/.test(does) || does.replace(/What it does:/, '').trim().length < 20 || /[–—]/.test(like + does)) report.push(`${q}: the card is missing its words: ${like} / ${does}`);
    }
    expect(!report.length, 'the glands: ' + report.join(' || '));
    expect(!errors.length, 'page errors: ' + errors.join('; '));
  } finally { await ctx.close(); }
});

test.slow('Explore 3D: the human body — 10 systems, tap or find a part to learn what it is, a girl’s body, ask Cassie', async (b) => {
  const { ctx, page, errors, groqCalls } = await open(b, { server: false, scale: 1, state: { groqKey: 'gsk_test' }, fakeGroq: (body) => ({ text: /two short sentences/.test(JSON.stringify(body)) ? 'The **hepatic artery** brings oxygen-rich blood to the liver.' : 'The femur is the thigh bone, the longest bone in the body.' }) });
  await open3d(page, 'body3d');
  await page.waitForSelector('.x3d:not([hidden]) .x3d-sys', { timeout: 20000 });
  expect(await page.locator('.labs').isHidden(), 'Labs steps aside while the 3D body is open');
  expect(await page.locator('.x3d').evaluate((e) => e.classList.contains('x3d-body-mode')) && await page.locator('.x3d-switch').isHidden(), 'the 3D card opens the human body, with no cell switch (the cells are their own view)');
  await page.waitForFunction(() => document.querySelector('.x3d-loading').hidden, null, { timeout: 30000 });
  const on = await page.$$eval('.x3d-sys', (c) => c.filter((x) => x.getAttribute('aria-pressed') === 'true').map((x) => x.dataset.sys));
  const all = await page.$$eval('.x3d-sys[data-sys]', (c) => c.map((x) => x.textContent.trim()));
  expect(['Circulatory', 'Respiratory', 'Nervous', 'Digestive', 'Musculoskeletal', 'Endocrine', 'Integumentary', 'Urinary', 'Lymphatic', 'Reproductive'].every((n) => all.some((t) => t.startsWith(n))), 'the 10 body systems are there: ' + all);
  expect(on.join() === 'respiratory,digestive,musculoskeletal,endocrine,integumentary,urinary,reproductive', 'skin, bones and organs start on: ' + on);
  expect(await page.locator('.x3d-sys[data-muscles]').count() === 1, 'muscles are a switch of their own under Musculoskeletal');
  if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/body-systems.png' });
  // tap the middle of the chest → a real, named part (stop the slow turn first, like a finger would)
  await page.waitForTimeout(1500);
  const box = await page.locator('.x3d-canvas').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.42);
  await page.waitForFunction(() => !document.querySelector('.x3d-sheet').hidden && document.querySelector('.x3d-sheet h3').textContent, null, { timeout: 25000 })
    .catch(async (e) => { throw new Error('nothing picked: ' + JSON.stringify(await page.evaluate(() => ({ sheet: document.querySelector('.x3d-sheet').hidden, h3: document.querySelector('.x3d-sheet h3').textContent, loading: document.querySelector('.x3d-loading').textContent })))); });
  const tapped = await page.locator('.x3d-sheet h3').innerText();
  expect(tapped.length > 2 && /Musculoskeletal|Respiratory|Digestive|Endocrine|Urinary|Reproductive/.test(await page.locator('.x3d-path').innerText()), 'a tapped part is named with its system: ' + tapped + ' / ' + await page.locator('.x3d-path').innerText());
  expect(/What it is:/.test(await page.locator('.x3d-like').innerText()) && /What it does:/.test(await page.locator('.x3d-does').innerText()), 'a tapped part says what it is and what it does');
  // muscles: the switch works, and a first tap picks the whole muscle; a tap again inside it, the exact part
  await page.click('.x3d-sys[data-muscles]');
  await page.waitForFunction(() => document.querySelector('.x3d-sys[data-muscles]').getAttribute('aria-pressed') === 'true', null, { timeout: 5000 });
  await page.fill('.x3d-search', 'pectoralis major');
  await page.waitForSelector('.x3d-results:not([hidden]) button', { timeout: 20000 });
  await page.click('.x3d-results button >> nth=0');
  await page.waitForFunction(() => /^Pectoralis major/.test(document.querySelector('.x3d-sheet h3').textContent), null, { timeout: 60000 });
  expect(/chest/.test(await page.locator('.x3d-like').innerText()), 'the whole muscle is explained: ' + await page.locator('.x3d-like').innerText());
  await page.click('.x3d-sys[data-muscles]');
  // find the femur by name, with its Latin name
  await page.fill('.x3d-search', 'femur');
  await page.waitForSelector('.x3d-results:not([hidden]) button', { timeout: 20000 }).catch(async () => { throw new Error('no results: ' + JSON.stringify(await page.evaluate(() => ({ v: document.querySelector('.x3d-search').value, r: document.querySelector('.x3d-results').outerHTML.slice(0, 200), direct: exploreMod.open({}).body.search('femur').length, rr: document.querySelector('.x3d-results').getBoundingClientRect().toJSON(), fr: document.querySelector('.x3d-find').getBoundingClientRect().toJSON(), disp: getComputedStyle(document.querySelector('.x3d-results')).display, fh: document.querySelector('.x3d-find').hidden })))); });
  await page.click('.x3d-results button >> nth=0');
  await page.waitForFunction(() => /^Femur/.test(document.querySelector('.x3d-sheet h3').textContent), null, { timeout: 10000 });
  expect(/Os femoris/.test(await page.locator('.x3d-like').innerText()), 'the Latin name shows');
  expect(/thigh bone/.test(await page.locator('.x3d-like').innerText()) && /weight/.test(await page.locator('.x3d-does').innerText()), 'the femur is explained: ' + await page.locator('.x3d-sheet').innerText());
  if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/body-femur.png' });
  // a group: the whole heart turns the heart & blood vessels on
  await page.fill('.x3d-search', 'heart');
  await page.waitForSelector('.x3d-results:not([hidden]) button', { timeout: 20000 });
  expect(/^Heart/.test(await page.locator('.x3d-results button >> nth=0').innerText()), 'the whole heart is the first result');
  await page.click('.x3d-results button >> nth=0');
  await page.waitForFunction(() => document.querySelector('.x3d-sheet h3').textContent === 'Heart' && document.querySelector('.x3d-sys[data-sys="circulatory"]').getAttribute('aria-pressed') === 'true', null, { timeout: 20000 });
  // a part only known by its kind: Cassie says exactly what it is
  await page.fill('.x3d-search', 'hepatic artery proper');
  await page.waitForSelector('.x3d-results:not([hidden]) button', { timeout: 20000 });
  await page.click('.x3d-results button >> nth=0');
  await page.waitForSelector('.x3d-more:not([hidden]):not(.muted) >> text=brings oxygen-rich blood to the liver', { timeout: 15000 });
  expect(!/\*/.test(await page.locator('.x3d-more').innerText()), 'no formatting marks in Cassie’s explanation');
  // a girl's body: the female organs, and the male ones go away
  await page.click('.x3d-sex [data-sex="girl"]');
  await page.fill('.x3d-search', 'uterus');
  await page.waitForSelector('.x3d-results:not([hidden]) button', { timeout: 20000 });
  await page.click('.x3d-results button >> nth=0');
  await page.waitForFunction(() => /^Uterus/.test(document.querySelector('.x3d-sheet h3').textContent), null, { timeout: 15000 });
  expect(/womb/.test(await page.locator('.x3d-like').innerText()) && /Reproductive/.test(await page.locator('.x3d-path').innerText()), 'the uterus is explained, in the reproductive system');
  if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/body-girl.png' });
  await page.fill('.x3d-search', 'prostate');
  await page.waitForSelector('.x3d-results:not([hidden]) button', { timeout: 20000 });
  await page.click('.x3d-results button >> nth=0');
  await page.waitForFunction(() => /^Prostate/.test(document.querySelector('.x3d-sheet h3').textContent) && document.querySelector('.x3d-sex [data-sex="boy"]').getAttribute('aria-checked') === 'true', null, { timeout: 15000 });
  // hide it, then show it again
  await page.click('.x3d-act[data-act="hide"]');
  expect(await page.locator('.x3d-showall').isVisible(), 'hidden parts can be shown again');
  await page.click('.x3d-showall');
  // ask Cassie about the femur
  await page.fill('.x3d-search', 'femur');
  await page.waitForSelector('.x3d-results:not([hidden]) button', { timeout: 20000 });
  await page.click('.x3d-results button >> nth=0');
  await page.waitForFunction(() => /^Femur/.test(document.querySelector('.x3d-sheet h3').textContent), null, { timeout: 10000 });
  await page.click('.x3d-act[data-act="ask"]');
  await seen(page, '.x3d .lab-helper:not([hidden]) .hp-a', 'thigh bone');
  expect(/Explain the Femur.*Os femoris.*musculoskeletal system/i.test(JSON.stringify(groqCalls.at(-1))), 'Cassie is asked about the femur by its real name');
  expect(errors.length === 0, 'page errors: ' + errors.join('; '));
  await ctx.close();
});

test.slow('Body 3D: eyes on both bodies (tap one for its card), and the girl has long hair and her own shape', async (b) => {
  const { ctx, page, errors } = await open(b, { server: false, device: 'Desktop Chrome', state: { groqKey: 'gsk_test' } });
  const dir = process.env.SHOTS || '';
  await open3d(page, 'body3d');
  await page.waitForSelector('.x3d:not([hidden])', { timeout: 30000 });
  await seen(page, '.x3d', 'parts showing', 60000);
  await page.waitForTimeout(2500);
  // the canvas, as pixels: the middle of the screen, and a ring around it
  const pixels = async () => {
    const box = await page.locator('.x3d-canvas').boundingBox(), png = await page.screenshot({ clip: { x: box.x + box.width / 2 - 20, y: box.y + box.height / 2 - 20, width: 40, height: 40 } });
    return page.evaluate(async (b64) => {
      const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
      const lum = (x, y) => { const d = g.getImageData(x, y, 1, 1).data; return 0.2126 * d[0] + 0.7152 * d[1] + 0.0722 * d[2]; };
      const mid = Math.round(img.width / 2), around = [];
      for (let a = 0; a < 16; a++) around.push(lum(Math.round(mid + Math.cos(a / 16 * Math.PI * 2) * mid * 0.9), Math.round(mid + Math.sin(a / 16 * Math.PI * 2) * mid * 0.9)));
      return { mid: lum(mid, mid), brightest: Math.max(...around) };
    }, png.toString('base64'));
  };
  // fly to an eye from the front (search for the pupil, then close the card): the pupil sits dark in the white of the eye
  const toEye = async () => {
    if (await page.locator('.x3d-view').isHidden()) await page.click('.x3d-tools button:has-text("Look around")');
    await page.click('[data-look="front"]'); await page.waitForTimeout(2500);
    await page.fill('.x3d-search', 'pupil');
    await seen(page, '.x3d-results button', 'Pupil');
    await page.click('.x3d-results button >> nth=0');
    await seen(page, '.x3d-sheet h3', 'Pupil');
    await page.click('.x3d-sheet .x3d-sheet-x:not(.x3d-sheet-min)');
    await page.waitForTimeout(2500);
  };
  for (const sex of ['boy', 'girl']) {
    await page.click(`.x3d-sex [data-sex="${sex}"]`);
    await page.waitForTimeout(2500);
    if (dir) { await page.click('[data-look="front"]').catch(() => {}); await page.waitForTimeout(2000); await page.screenshot({ path: `${dir}/body-${sex}-front.png` }); }
    await toEye();
    if (dir) await page.screenshot({ path: `${dir}/body-${sex}-eye.png` });
    const px = await pixels();
    expect(px.mid < 60 && px.brightest > 150, `${sex}: a dark pupil in a light eye at the middle of the screen: ` + JSON.stringify(px));
    // a tap on the eye opens its card; a tap again picks the exact part
    const cb = await page.locator('.x3d-canvas').boundingBox();
    await page.mouse.click(cb.x + cb.width / 2, cb.y + cb.height / 2);
    await seen(page, '.x3d-sheet h3', 'Eye', 15000).catch(async () => { throw new Error(sex + ': the tap opened ' + await page.evaluate(() => { const h = document.querySelector('.x3d-sheet'); return h.hidden ? 'nothing' : h.querySelector('h3').textContent; })); });
    const card = await page.locator('.x3d-sheet').textContent();
    expect(/organ of sight/.test(card) && /2\.4 cm/.test(card), sex + ': the eye’s card says what it is');
    await page.waitForTimeout(2500); // (the camera settles on the eye, above the card)
    // a tap again where the eye is now (its name label sits on it) picks the exact part under the finger
    const at = await page.evaluate(() => { const l = [...document.querySelectorAll('.x3d-label.on')].find((x) => !x.hidden && !x.dataset.part); const m = l && /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(l.style.transform); const r = l.parentElement.getBoundingClientRect(); return m ? { x: r.left + +m[1], y: r.top + +m[2] } : null; });
    expect(at, 'the eye’s label shows where it is');
    if (await page.locator('.x3d-sheet-min[aria-expanded="true"]:visible').count()) { await page.click('.x3d-sheet-min'); await page.waitForTimeout(500); } // (the card moves out of the way)
    await page.mouse.click(at.x, at.y);
    await seen(page, '.x3d-sheet h3', 'Pupil', 15000).catch(async () => { throw new Error(sex + ': a tap again opened ' + await page.evaluate(() => { const h = document.querySelector('.x3d-sheet'); return h.hidden ? 'nothing' : h.querySelector('h3').textContent; })); });
    expect(/opening in the middle of the iris/.test(await page.locator('.x3d-sheet').textContent()), sex + ': a tap again picks the pupil');
    await page.click('.x3d-sheet .x3d-sheet-x:not(.x3d-sheet-min)');
  }
  // the girl's long hair: a part of her skin view, with its own card (not on the boy)
  await page.fill('.x3d-search', 'long hair');
  await seen(page, '.x3d-results button', 'Long hair');
  await page.click('.x3d-results button >> nth=0');
  await seen(page, '.x3d-sheet h3', 'Long hair');
  expect(/keratin/.test(await page.locator('.x3d-sheet').textContent()), 'the hair’s card');
  if (dir) { await page.click('.x3d-sheet .x3d-sheet-x:not(.x3d-sheet-min)'); await page.click('[data-look="back"]').catch(() => {}); await page.waitForTimeout(2500); await page.screenshot({ path: `${dir}/body-girl-back.png` }); }
  await page.click('.x3d-sex [data-sex="boy"]');
  await page.waitForTimeout(1500);
  await page.fill('.x3d-search', 'long hair');
  await page.waitForTimeout(1500);
  expect(await page.locator('.x3d-sheet:not([hidden]) h3:text-is("Long hair")').count() === 0, 'the boy has no long hair on show');
  expect(errors.length === 0, 'page errors: ' + errors.join('; '));
  await ctx.close();
});

test.slow('Explore 3D body like an atlas: Front/Back/Side views, spread every piece apart and back, structure count, which-way letters', async (b) => {
  const { ctx, page, errors } = await open(b, { scale: 1, server: false, state: { groqKey: 'gsk_test' }, device: process.env.DEVICE || 'Pixel 7' });
  await open3d(page, 'body3d');
  await page.waitForSelector('.x3d:not([hidden]) .x3d-sys', { timeout: 20000 });
  await page.waitForFunction(() => document.querySelector('.x3d-loading').hidden && +document.querySelector('.x3d-count b').textContent.replace(/\D/g, '') > 50, null, { timeout: 40000 });
  expect(await page.locator('.x3d-view').isVisible(), 'the view controls are open at the start');
  const count0 = +(await page.locator('.x3d-count b').innerText()).replace(/\D/g, '');
  // the body's left is +x: the liver (right side) is on -x, the heart leans to +x
  const sides = await page.evaluate(() => { const bd = exploreMod.open({}).body; const l = bd.boxOf('liver'), s = bd.boxOf('stomach'); return { liver: l && l.getCenter(new l.min.constructor()).x, stomach: s && s.getCenter(new s.min.constructor()).x }; });
  expect(sides.liver < 0 && sides.stomach > sides.liver, 'the R/L letters match the body: ' + JSON.stringify(sides));
  // Front view: camera straight in front
  await page.click('.x3d-seg [data-look="front"]');
  await page.waitForTimeout(900);
  expect(await page.locator('.x3d-seg [data-look="front"]').getAttribute('aria-pressed') === 'true', 'Front is marked');
  expect(await page.locator('.x3d-gizmo [data-face="A"]').evaluate((e) => +getComputedStyle(e).opacity > 0.9), 'facing the front, A is the nearest letter');
  if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/atlas-front.png' });
  // spread structures apart
  const slider = page.locator('.x3d-spread');
  await slider.fill('58'); await slider.dispatchEvent('change');
  await page.waitForTimeout(900);
  expect(await page.locator('.x3d-spread-pc').innerText() === '58%' && await page.locator('.x3d-reassemble').isEnabled(), 'the slider shows 58% and Reassemble works');
  if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/atlas-58.png' });
  await slider.fill('100'); await slider.dispatchEvent('change');
  await page.waitForTimeout(1200);
  const apart = await page.evaluate(() => { const bd = exploreMod.open({}).body; const s = bd.spreadBox(); return { w: s.max.x - s.min.x, h: s.max.y - s.min.y }; });
  expect(apart.w > 1, 'every piece lies apart in rows: ' + JSON.stringify(apart));
  const trays = await page.$$eval('.x3d-trays span:not([hidden])', (s) => s.map((x) => x.textContent));
  expect(trays.some((t) => /^Bones · \d+/.test(t)) && trays.some((t) => /^Digestive/.test(t)), 'the pieces are sorted into named trays: ' + trays);
  if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/atlas-100.png' });
  // a piece can still be tapped while apart (the femur is one of the biggest: top rows)
  await page.fill('.x3d-search', 'femur');
  await page.waitForSelector('.x3d-results:not([hidden]) button', { timeout: 20000 });
  await page.click('.x3d-results button >> nth=0');
  await page.waitForFunction(() => /^Femur/.test(document.querySelector('.x3d-sheet h3').textContent), null, { timeout: 10000 });
  expect(await page.locator('.x3d-label.on').isVisible(), 'the picked piece has a callout');
  // the details card shrinks to a bar
  await page.click('.x3d-sheet-min');
  expect(await page.locator('.x3d-sheet-sub').isVisible() && !(await page.locator('.x3d-does').isVisible()), 'the small bar says Selection details');
  if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/atlas-pick.png' });
  await page.click('.x3d-sheet-head');
  expect(await page.locator('.x3d-does').isVisible(), 'tapping the bar opens the details again');
  await page.click('.x3d-sheet > .x3d-sheet-x:not(.x3d-sheet-min)');
  // Reassemble: back together
  await page.click('.x3d-reassemble');
  await page.waitForFunction(() => document.querySelector('.x3d-spread-pc').textContent === '0%', null, { timeout: 5000 });
  await page.waitForFunction(() => exploreMod.open({}).body.spreadBox() === null, null, { timeout: 5000 }); // back together
  const count1 = +(await page.locator('.x3d-count b').innerText()).replace(/\D/g, '');
  expect(count1 === count0, `the count comes back: ${count0} → ${count1}`);
  // turning a system off lowers the count
  await page.click('.x3d-sys[data-sys="musculoskeletal"]');
  await page.waitForFunction((n) => +document.querySelector('.x3d-count b').textContent.replace(/\D/g, '') < n, count0, { timeout: 10000 });
  // a letter turns the body: R = from its right side, then P = from the back
  await page.click('.x3d-gizmo [data-face="R"]');
  await page.waitForTimeout(900);
  expect(await page.locator('.x3d-seg [data-look="side"]').getAttribute('aria-pressed') === 'true', 'R looks from the side');
  await page.click('.x3d-gizmo [data-face="P"]');
  await page.waitForTimeout(900);
  expect(await page.locator('.x3d-seg [data-look="back"]').getAttribute('aria-pressed') === 'true', 'P looks from the back');
  if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/atlas-back.png' });
  // the skin can be tapped: with only the skin on, a tap on the belly names a region of the skin
  for (const sys of ['respiratory', 'digestive', 'endocrine', 'urinary', 'reproductive']) await page.click(`.x3d-sys[data-sys="${sys}"]`);
  await page.click('.x3d-view-x');
  await page.click('.x3d-gizmo [data-face="A"]').catch(() => page.click('.x3d-tools [data-tool="reset"]'));
  await page.waitForTimeout(1000);
  const cb = await page.locator('.x3d-canvas').boundingBox();
  await page.mouse.click(cb.x + cb.width / 2, cb.y + cb.height * 0.5);
  await page.waitForFunction(() => !document.querySelector('.x3d-sheet').hidden, null, { timeout: 10000 });
  expect(/Integumentary/.test(await page.locator('.x3d-path').innerText()), 'a tap on the skin names a part of the skin: ' + await page.locator('.x3d-sheet h3').innerText());
  if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/atlas-skin.png' });
  expect(errors.length === 0, 'page errors: ' + errors.join('; '));
  await ctx.close();
});

test('score board: everyone’s points in every game and their total, today and this week', async (b) => {
  const { ctx, page, errors } = await open(b);
  const day = await page.evaluate(() => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10));
  const submit = (body) => page.evaluate(async ([srv, bb]) => (await fetch(srv + '/scores/submit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(bb) })).json(), [SERVER, body]);
  await submit({ uid: 'player-ana-0001', name: 'Ana', game: 'sudoku', value: 300, shown: '5:00', day });
  await submit({ uid: 'player-ben-0002', name: 'Ben', game: 'sudoku', value: 400, shown: '6:40', day });
  await submit({ uid: 'player-ben-0002', name: 'Ben', game: 'mirrors', value: 60, shown: '1:00', day });
  const d = await submit({ uid: 'player-ana-0001', name: 'Ana', game: 'mirrors', value: 90, shown: '1:30', day });
  const ana = d.table.find((r) => r.name === 'Ana'), ben = d.table.find((r) => r.name === 'Ben');
  expect(ana && ben && ana.games.sudoku === 100 && ana.games.mirrors === 80 && ana.total === 180, 'Ana: first in Sudoku, second in Mirrors = 180: ' + JSON.stringify(ana));
  expect(ben.games.sudoku === 80 && ben.games.mirrors === 100 && ben.total === 180, 'Ben has both games too: ' + JSON.stringify(ben));
  expect(d.week && d.week.table.some((r) => r.name === 'Ana' && r.total >= 180 && r.played >= 2), 'the week adds them up: ' + JSON.stringify(d.week));
  await tapLabs(page);
  await page.waitForSelector(LABS_READY, { timeout: 20000 });
  await page.evaluate(() => openLabs(undefined, { section: 'games' }));
  await page.waitForSelector('.board-table td', { timeout: 10000 });
  const head = await page.$$eval('.board-table th', (t) => t.map((x) => x.textContent));
  expect(head.includes('Sudoku') && head.includes('Mirrors') && head.includes('Total'), 'a column for every game and the total: ' + head);
  const rows = await page.$$eval('.board-table tbody tr', (r) => r.map((x) => x.innerText.replace(/\s+/g, ' ')));
  expect(rows.some((r) => /Ana/.test(r) && /180/.test(r)), 'Ana’s total shows: ' + rows);
  await page.click('[data-board-tab="week"]');
  expect(await page.locator('[data-board-tab="week"][aria-selected="true"]').count() === 1 && await page.locator('.board-table td').count() > 0, 'This week shows the totals too');
  expect(errors.length === 0, 'page errors: ' + errors.join('; '));
  await fetch(`${SERVER}/__reset-scores`); // other tests start from an empty board
  await ctx.close();
});

test.slow('Labs: the shelf, every lab opens and works, goals tick, and Ask Cassie sends what is on screen', async (b) => {
  const { ctx, page, errors, groqCalls } = await open(b, { scale: 1, server: false, state: { groqKey: 'gsk_test' }, device: process.env.DEVICE || 'Desktop Chrome' /* (the Labs shelf: a computer's; a phone has the Labs tab) */, fakeGroq: () => ({ text: 'At 45 degrees the ball goes farthest because the speed is split evenly between up and forward.' }) });
  const shot = (n) => process.env.SHOTS && page.screenshot({ path: process.env.SHOTS + '/' + n + '.png' });
  await tapLabs(page);
  await page.waitForSelector(LABS_READY, { timeout: 20000 });
  // two shelves: Learn (simulations, 3D, atlas) and Games & puzzles
  const learn = await page.$$eval('.labs-grid .labs-card', (c) => c.map((x) => x.dataset.lab));
  expect(!learn.includes('sudoku') && learn.includes('pendulum'), 'Learn has the simulations, not the puzzles: ' + learn);
  await page.evaluate(() => openLabs(undefined, { section: 'games' }));
  const games = await page.$$eval('.labs-grid .labs-card', (c) => c.map((x) => x.dataset.lab));
  expect(games.includes('sudoku') && !games.includes('pendulum'), 'Games has the puzzles: ' + games);
  expect(await page.locator('.labs-chips').isHidden(), 'the subject chips are for the Learn shelf');
  await page.evaluate(() => openLabs(undefined, { section: 'learn' }));
  const ids = [...learn, ...games];
  for (const id of ['function', 'fractions', 'chance', 'units', 'interest', 'square-proof', 'hanoi', 'projectile', 'pendulum', 'waves', 'refraction', 'balance', 'ph', 'atom', 'punnett', 'body3d',
    'solar', 'colour', 'vectors', 'magnets', 'optics', 'logic', 'ice-steam', 'metals', 'rocket', 'solids', 'recursion', 'build-cell', 'sudoku', 'nonogram', 'hashi', 'pipes', 'mirrors', 'equation', 'geography']) expect(ids.includes(id), 'the shelf has ' + id + ': ' + ids);
  expect(await page.locator('.labs-feature').count() === 1, 'today’s lab is featured');
  await shot('labs-shelf');
  // subject chips and search
  await page.click('.labs-chips [data-subject="chemistry"]');
  expect((await page.$$eval('.labs-grid .labs-card', (c) => c.map((x) => x.dataset.lab))).join() === 'balance,ph,atom,ice-steam,metals', 'Chemistry shows the chemistry labs: ' + (await page.$$eval('.labs-grid .labs-card', (c) => c.map((x) => x.dataset.lab))).join());
  await page.click('.labs-chips [data-subject="all"]');
  await page.fill('.labs-search', 'pendul');
  expect((await page.$$eval('.labs-grid .labs-card', (c) => c.map((x) => x.dataset.lab))).join() === 'pendulum', 'search finds the pendulum');
  await page.fill('.labs-search', '');
  // every lab opens, draws, says how its model works, and closes without an error
  for (const id of ids.filter((x) => !/3d$/.test(x))) {
    await page.evaluate((sec) => openLabs(undefined, { section: sec }), games.includes(id) ? 'games' : 'learn');
    await openCard(page, `.labs-grid [data-lab="${id}"]`);
    await page.waitForSelector(`.lab-view:not([hidden])[data-lab="${id}"] .lab-controls > *`, { timeout: 25000 }); // (3D scenes build slowly with the test's software graphics)
    expect(await page.locator('.lab-stage canvas, .lab-stage .lab-balance, .lab-stage .lab-units, .lab-stage .puz-sudoku, .lab-stage .puz-eq, .lab-stage .tl-sheet, .lab-stage .kid-field').count() >= 1, id + ' draws something');
    expect(await page.locator('.lab-about').isVisible(), id + ' says how its model works');
    // tap the middle of the picture (nothing should break)
    const sb0 = await page.locator('.lab-stage').boundingBox();
    await page.mouse.click(sb0.x + sb0.width / 2, sb0.y + sb0.height / 2);
    await page.waitForTimeout(250);
    expect(errors.length === 0, `${id}: page errors: ` + errors.join('; '));
    await page.click('.lab-back');
  }
  // “Try this” goals are buttons: a tap shows the hint
  await page.evaluate(() => openLabs(undefined, { section: 'learn' }));
  await openCard(page, '.labs-grid [data-lab="pendulum"]');
  await page.click('.lab-try >> nth=0');
  expect(await page.locator('.lab-hint >> nth=0').isVisible() && /1 m/.test(await page.locator('.lab-hint >> nth=0').innerText()), 'tapping a goal shows its hint');
  await page.click('.lab-nudge');
  await page.waitForFunction(() => document.querySelector('.lab-nudge-text') && !document.querySelector('.lab-nudge-text').classList.contains('muted') && document.querySelector('.lab-nudge-text').textContent.length > 10, null, { timeout: 15000 });
  expect(await page.locator('.labs').isVisible(), 'Cassie’s nudge appears inside the lab');
  await page.click('.lab-back');
  // the function lab: x^2 − 4, tap the middle → slope 0 → the first goal ticks
  await openCard(page, '[data-lab="function"]');
  await page.fill('.lab-input', 'x^2 - 4');
  const st = page.locator('.lab-stage');
  const sb = await st.boundingBox();
  await page.mouse.click(sb.x + sb.width / 2, sb.y + sb.height / 2);
  await page.waitForSelector('.lab-tries li.done', { timeout: 3000 });
  expect(/slope f′\(x\)\s*0/.test(await page.locator('.lab-stats').innerText()), 'the slope at x = 0 is 0: ' + await page.locator('.lab-stats').innerText());
  await page.fill('.lab-input', 'sin(');
  expect(await page.locator('.lab-err').isVisible(), 'a formula that can’t be read says why');
  await page.fill('.lab-input', 'sin(x)');
  await shot('lab-function');
  await page.click('.lab-back');
  // balancing water yourself: 2 H2 + O2 → 2 H2O
  await openCard(page, '[data-lab="balance"]');
  await page.click('.lab-coef [data-j="0"][data-d="1"]');
  expect(!(await page.locator('.lab-verdict.ok').count()), 'not balanced half way');
  await page.click('.lab-coef [data-j="2"][data-d="1"]');
  await page.waitForSelector('.lab-verdict.ok');
  expect(await page.locator('.lab-tries li').first().getAttribute('class') === 'done' || /done/.test(await page.locator('.lab-tries li').first().getAttribute('class')), 'balancing water ticks the goal');
  await page.click('.lab-chips >> text=Tricky one');
  await page.click('text=Show Cassie’s answer');
  expect(/2KMnO4 \+ 16HCl → 2KCl \+ 2MnCl2 \+ 8H2O \+ 5Cl2/.test(await page.locator('.lab-stats').innerText()), 'Cassie balances the tricky one: ' + await page.locator('.lab-stats').innerText());
  await shot('lab-balance');
  await page.click('.lab-back');
  // Punnett: Yy × Yy is 3 : 1 right away; two genes → 9 : 3 : 3 : 1
  await openCard(page, '[data-lab="punnett"]');
  expect(/3 : 1/.test(await page.locator('.lab-stats').innerText()), 'Yy × Yy gives 3 : 1');
  await page.click('.lab-seg button:has-text("Two genes")');
  expect(/9 : 3 : 3 : 1/.test(await page.locator('.lab-stats').innerText()), 'YyRr × YyRr gives 9 : 3 : 3 : 1');
  await page.click('text=Grow 100 offspring');
  expect(/100 grown/.test(await page.locator('.lab-stats').innerText()), 'a hundred offspring are grown');
  await shot('lab-punnett');
  await page.click('.lab-back');
  // pH: 10 mL acid then 10 mL base = neutral
  await openCard(page, '[data-lab="ph"]');
  await page.locator('.lab-group:has-text("Acid") button:has-text("+ 10 mL")').click();
  expect(/acidic/.test(await page.locator('.lab-stats').innerText()), 'acid makes it acidic');
  await page.locator('.lab-group:has-text("Base") button:has-text("+ 10 mL")').click();
  expect(/pH\s*7\.00/.test(await page.locator('.lab-stats').innerText()) && /done/.test(await page.locator('.lab-tries li').first().getAttribute('class')), 'equal acid and base is neutral: ' + await page.locator('.lab-stats').innerText());
  await shot('lab-ph');
  await page.click('.lab-back');
  // the atom: carbon-12 is built at the start
  await openCard(page, '[data-lab="atom"]');
  expect(/Carbon \(C\)/.test(await page.locator('.lab-stats').innerText()) && /carbon-12/.test(await page.locator('.lab-stats').innerText()), 'six of each is carbon-12');
  await page.click('.lab-chips >> text=Chloride Cl⁻');
  expect(/negative ion/.test(await page.locator('.lab-stats').innerText()), 'chloride is a negative ion');
  await shot('lab-atom');
  await page.click('.lab-back');
  // launch: drag on the picture to aim, then 45° from the ground and the big Launch button on the picture
  await openCard(page, '[data-lab="projectile"]');
  const pb = await page.locator('.lab-stage').boundingBox();
  await page.mouse.move(pb.x + pb.width * 0.4, pb.y + pb.height * 0.4); await page.mouse.down(); await page.mouse.move(pb.x + pb.width * 0.5, pb.y + pb.height * 0.3, { steps: 4 }); await page.mouse.up();
  expect(await page.locator('.lab-sl:has-text("Angle") output').innerText() !== '40°', 'dragging on the picture aims the launcher');
  await page.locator('.lab-sl:has-text("Angle") input').fill('45');
  await page.click('.lab-overlay .lab-btn:has-text("Launch")');
  await page.waitForFunction(() => [...document.querySelectorAll('.lab-note')].some((n) => /Landed|Hit/.test(n.textContent)), null, { timeout: 25000 });
  expect(/done/.test(await page.locator('.lab-tries li').first().getAttribute('class')), '45° from the ground ticks the farthest-angle goal');
  await shot('lab-projectile');
  await page.click('.lab-ask');
  await page.waitForSelector('.lab-helper:not([hidden]) .hp-a >> text=45 degrees', { timeout: 15000 });
  expect(await page.locator('.lab-view[data-lab="projectile"]').isVisible(), 'the answer shows inside the lab, which stays open');
  await page.click('.lab-helper .hp-x');
  await page.click('.lab-back');
  const asked = JSON.stringify(groqCalls.at(-1));
  expect(/Launch lab/.test(asked) && /45°/.test(asked) && /m\/s/.test(asked) && /flies/.test(asked), 'Cassie is told what is on the screen: ' + asked.slice(0, 400));
  // goals are remembered on the shelf
  await tapLabs(page);
  await page.waitForSelector(LABS_READY);
  expect(/[1-3]\/3 tried/i.test(await page.locator('.labs-grid [data-lab="projectile"]').innerText()), 'the shelf remembers tried goals: ' + await page.locator('.labs-grid [data-lab="projectile"]').innerText());
  // a link opens a lab straight away
  await page.goto(APP + '?lab=pendulum');
  await page.waitForSelector('.lab-view:not([hidden])[data-lab="pendulum"]', { timeout: 20000 });
  await page.waitForTimeout(600);
  await shot('lab-pendulum');
  expect(errors.length === 0, 'page errors: ' + errors.join('; '));
  await ctx.close();
});

test('Labs puzzles: today’s puzzle is the same for everyone, finishing it goes on the score board, practice ones don’t', async (b) => {
  const { ctx, page, errors } = await open(b, { state: { groqKey: 'gsk_test', profile: { name: 'Hazel' } }, device: process.env.DEVICE || 'Desktop Chrome' /* (the Labs shelf: a computer's; a phone has the Labs tab) */ });
  const shot = (n) => process.env.SHOTS && page.screenshot({ path: process.env.SHOTS + '/' + n + '.png' });
  await tapLabs(page);
  await page.waitForSelector(LABS_READY, { timeout: 20000 });
  await page.evaluate(() => openLabs(undefined, { section: 'games' }));
  await page.waitForSelector('.labs-board:not([hidden])', { timeout: 5000 });
  expect(/Be the first today|playing today/.test(await page.locator('.labs-board').innerText()), 'the score board shows on the shelf');
  // solve today's Laser mirrors puzzle by trying mirror turns (the real path exists)
  await openCard(page, '.labs-grid [data-lab="mirrors"]');
  await page.waitForSelector('.puz-head');
  await page.waitForFunction(() => document.querySelector('.lab-stage').dataset.geo);
  // try every combination of mirror turns in Gray-code order (one tap per step) until the laser hits
  const mirrors = (await page.locator('.lab-stage').getAttribute('data-mirrors')).split(',').map(Number);
  const geo = JSON.parse(await page.locator('.lab-stage').getAttribute('data-geo'));
  const box = await page.locator('.lab-stage canvas').boundingBox();
  await page.waitForTimeout(9000); // a believable solving time (the server refuses impossibly fast finishes)
  let done = false;
  for (let i = 1; i < 2 ** mirrors.length && !done; i++) {
    const bit = Math.log2(i & -i), m = mirrors[bit], r = Math.floor(m / 7), c = m % 7;
    await page.mouse.click(box.x + geo.ox + c * geo.cell + geo.cell / 2, box.y + geo.oy + r * geo.cell + geo.cell / 2);
    done = await page.locator('.puz-win:not([hidden])').count() > 0;
  }
  expect(done, 'the mirrors puzzle can be solved');
  await page.waitForFunction(() => /#\d+ today/.test(document.querySelector('.puz-win').textContent), null, { timeout: 10000 }).catch(async () => { throw new Error('win text: ' + await page.locator('.puz-win').innerText() + ' / board ' + await page.evaluate(() => localStorage.getItem('cassie.puzzles'))); });
  expect(/You’re #1 today with 100 points/.test(await page.locator('.puz-win').innerText()), 'the first finish is #1 on the score board: ' + await page.locator('.puz-win').innerText());
  await shot('puzzle-mirrors');
  await page.click('.lab-back');
  await page.waitForSelector('.labs-board .pod.p1 b');
  await page.waitForFunction(() => /Hazel/.test(document.querySelector('.labs-board').textContent), null, { timeout: 10000 });
  expect(/100 points/.test(await page.locator('.labs-board .pod.p1').innerText()), 'the podium shows today’s leader');
  expect(/Done today/i.test(await page.locator('.labs-grid [data-lab="mirrors"]').innerText()), 'the shelf marks the puzzle done today');
  await shot('labs-board');
  // the same puzzle for everyone today: another student gets the same Sudoku
  await openCard(page, '.labs-grid [data-lab="sudoku"]');
  await page.waitForSelector('.sdk-grid .sdk-c');
  const mine = await page.$$eval('.sdk-c', (c) => c.map((x) => x.textContent).join(','));
  const other = await ctx.browser().newContext({ serviceWorkers: 'block' });
  const p2 = await other.newPage();
  await p2.goto(page.url().split('?')[0] + '?lab=sudoku');
  await p2.waitForSelector('.sdk-grid .sdk-c', { timeout: 20000 });
  expect((await p2.$$eval('.sdk-c', (c) => c.map((x) => x.textContent).join(','))) === mine, 'everyone gets the same Sudoku today');
  await other.close();
  // enter a number: tap a square, tap a number
  const empty = await page.$$eval('.sdk-c', (c) => c.findIndex((x) => !x.classList.contains('given')));
  await page.click(`.sdk-c[data-i="${empty}"]`);
  await page.click('.sdk-pad [data-d="5"]');
  expect((await page.locator(`.sdk-c[data-i="${empty}"]`).innerText()).trim() === '5', 'tapping a square then a number fills it');
  await shot('puzzle-sudoku');
  await page.click('.lab-back');
  // equation: a false guess is refused with a reason
  await openCard(page, '.labs-grid [data-lab="equation"]');
  for (const k of '1+1=3000'.split('')) await page.click(`.eq-keys [data-k="${k}"]`);
  await page.click('.eq-keys [data-k="enter"]');
  expect(/isn’t true|just a number|8 symbols/.test(await page.locator('.eq-warn').innerText()), 'a wrong equation is refused: ' + await page.locator('.eq-warn').innerText());
  await shot('puzzle-equation');
  await page.click('.lab-back');
  // geography: the map loads and a round can be answered
  await openCard(page, '.labs-grid [data-lab="geography"]');
  await page.waitForSelector('.geo-opts button');
  await page.click('.geo-opts button >> nth=0');
  await page.waitForSelector('.geo-next');
  await page.waitForTimeout(500);
  await shot('puzzle-geography');
  expect(errors.length === 0, 'page errors: ' + errors.join('; '));
  await ctx.close();
});

test('Labs: goals tick only when you do them (and you can untick), colour names, flipping coins, any-size shapes, bigger puzzles, find a country', async (b) => {
  const { ctx, page, errors } = await open(b, { server: false, state: { groqKey: 'gsk_test' }, device: process.env.DEVICE || 'Desktop Chrome' /* (the Labs shelf: a computer's; a phone has the Labs tab) */ });
  const shot = (n) => process.env.SHOTS && page.screenshot({ path: process.env.SHOTS + '/' + n + '.png' });
  const stats = () => page.locator('.lab-stats').innerText();
  // Punnett starts at Yy × Yy (already 3 : 1) — that's not the student finding it, so nothing ticks
  await page.goto(APP + '?lab=punnett');
  await page.waitForSelector('.lab-view:not([hidden])[data-lab="punnett"] .lab-tries li', { timeout: 20000 });
  expect(await page.locator('.lab-tries li.done').count() === 0, 'no goal is ticked before the student does anything');
  // change a parent and change it back: now it's theirs
  await page.locator('.lab-group:has-text("Parent 1") .lab-seg button >> nth=0').click();
  await page.locator('.lab-group:has-text("Parent 1") .lab-seg button >> nth=1').click();
  expect(/done/.test(await page.locator('.lab-tries li').first().getAttribute('class')), 'finding 3 : 1 ticks the goal');
  // the box can be unticked (and ticked) by hand
  await page.click('.lab-tries [data-tick="0"]');
  expect(!/done/.test(await page.locator('.lab-tries li').first().getAttribute('class')), 'tapping a ticked box unticks it');
  // (YY × Yy on the way made every offspring yellow, so the third goal ticked itself too)
  expect(/done/.test(await page.locator('.lab-tries li').nth(2).getAttribute('class')), 'YY × Yy makes every offspring look the same');
  await page.click('.lab-tries [data-tick="0"]');
  expect(/done/.test(await page.locator('.lab-tries li').first().getAttribute('class')), 'tapping an empty box ticks it');
  // "Try this" folds up to save room (on phones it starts folded), and opens again
  await page.click('.lab-tries-toggle');
  expect(await page.locator('.lab-tries.folded').count() === 1 && await page.locator('.lab-tries li').count() === 0 && /of 3 done/.test(await page.locator('.lab-tries').innerText()), 'Try this folds up and still says how many are done');
  await page.click('.lab-tries-toggle');
  expect(await page.locator('.lab-tries li').count() === 3, 'and opens again');
  await shot('lab-goals');
  await page.click('.lab-back');
  // colour: a named colour, its name, and the hex
  await openCard(page, '.labs-grid [data-lab="colour"]');
  await page.click('.lab-colour-chips [aria-label="Mustard"]');
  expect(/Mustard/.test(await page.locator('.lab-swatch').innerText()) && /#FFDB58/.test(await page.locator('.lab-swatch').innerText()), 'the swatch says the colour’s name and hex: ' + await page.locator('.lab-swatch').innerText());
  await page.locator('.lab-sl:has-text("Blue") input').fill('255');
  expect(/Name/.test(await stats()) && /Looks/.test(await stats()), 'the name and a plain description are listed: ' + await stats());
  await shot('lab-colour-names');
  await page.click('.lab-back');
  // chance: the coin flips through the air, then the count goes up
  await openCard(page, '.labs-grid [data-lab="chance"]');
  await page.click('.lab-row-btns .lab-btn:has-text("× 1") >> nth=0');
  await page.waitForTimeout(250);
  await shot('lab-coin-flipping');
  await page.waitForFunction(() => /Trials\s*1(?![\d,])/.test(document.querySelector('.lab-stats').textContent), null, { timeout: 4000 });
  await page.click('.lab-seg button:has-text("Spinner")');
  const cb = await page.locator('.lab-stage canvas').boundingBox();
  await page.mouse.move(cb.x + cb.width / 2, cb.y + 60); await page.mouse.down(); await page.mouse.move(cb.x + cb.width / 2 + 80, cb.y + 40, { steps: 2 }); await page.mouse.up();
  await page.waitForTimeout(300);
  await shot('lab-spinner-spinning');
  await page.waitForFunction(() => /Trials\s*1(?![\d,])/.test(document.querySelector('.lab-stats').textContent), null, { timeout: 4000 });
  await page.click('.lab-back');
  // 3D shapes: 13 of them, any size typed in
  await openCard(page, '.labs-grid [data-lab="solids"]');
  expect(await page.locator('.lab-group:has(h4:text-is("Shape")) .lab-seg button').count() === 13, '13 shapes');
  await page.click('.lab-seg button:has-text("Torus")');
  await page.locator('.lab-sl:has-text("Ring radius") input[type=number]').fill('12.5');
  await page.locator('.lab-sl:has-text("Tube radius") input[type=number]').fill('3');
  expect(/2π² R r²\s*=\s*2,?221/.test(await stats()), 'torus volume 2π²·12.5·3² ≈ 2,221: ' + await stats());
  await shot('lab-torus');
  await page.click('.lab-back');
  // puzzles: more sizes, and a new puzzle any time
  await page.evaluate(() => openLabs(undefined, { section: 'games' }));
  await openCard(page, '.labs-grid [data-lab="sudoku"]');
  await page.click('.lab-seg button:has-text("12 × 12")');
  await page.waitForFunction(() => document.querySelectorAll('.sdk-c').length === 144, null, { timeout: 5000 }).catch(() => {}); // (the size shows first, the new board a frame later)
  expect(await page.locator('.sdk-c').count() === 144 && await page.locator('.sdk-pad [data-d="12"]').count() === 1, 'a 12 × 12 sudoku with 1–12');
  const first = await page.$$eval('.sdk-c', (c) => c.map((x) => x.textContent).join(','));
  await page.click('.puz-head .lab-btn:has-text("New puzzle")');
  expect(await page.$$eval('.sdk-c', (c) => c.map((x) => x.textContent).join(',')) !== first && /Practice/.test(await page.locator('.puz-day').innerText()), 'New puzzle makes a different one');
  await shot('puzzle-sudoku-12');
  await page.click('.lab-back');
  for (const [id, label] of [['nonogram', '20 × 20'], ['hashi', 'Huge'], ['pipes', '10 × 10'], ['mirrors', '11 × 11']]) {
    await openCard(page, `.labs-grid [data-lab="${id}"]`);
    await page.click(`.lab-seg button:has-text("${label}")`);
    await page.waitForTimeout(150);
    await shot('puzzle-' + id + '-big');
    expect(errors.length === 0, id + ': ' + errors.join('; '));
    await page.click('.lab-back');
  }
  // geography: find a country by tapping it on the map
  await openCard(page, '.labs-grid [data-lab="geography"]');
  await page.click('.lab-seg button:has-text("Find it on the map")');
  await page.waitForFunction(() => /Tap .+ on the map/.test(document.querySelector('.geo-q').textContent), null, { timeout: 10000 });
  const gb = await page.locator('.lab-stage canvas').boundingBox();
  await page.mouse.click(gb.x + gb.width * 0.5, gb.y + gb.height * 0.62);
  await page.mouse.click(gb.x + gb.width * 0.3, gb.y + gb.height * 0.55);
  await page.mouse.click(gb.x + gb.width * 0.7, gb.y + gb.height * 0.5);
  await page.waitForTimeout(300);
  await shot('puzzle-geo-find');
  await page.click('.lab-seg button:has-text("Explore the map")');
  await page.mouse.click(gb.x + gb.width * 0.28, gb.y + gb.height * 0.5);
  await page.waitForTimeout(300);
  await shot('puzzle-geo-explore');
  expect(errors.length === 0, 'page errors: ' + errors.join('; '));
  await ctx.close();
});

test('Study tools: vocabulary chain, timeline, essay structure, flashcards from notes, Cornell notes, thesis and citations', async (b) => {
  const fake = (body) => {
    const t = JSON.stringify(body.messages);
    if (/flashcards from these notes/.test(t)) return { text: JSON.stringify([{ f: 'What is osmosis?', b: 'Water moving across a membrane' }, { f: 'What is diffusion?', b: 'Particles spreading out' }, { f: 'What is ATP?', b: 'The energy molecule of cells' }]) };
    if (/Cornell notes/.test(t)) return { text: JSON.stringify({ title: 'Osmosis and diffusion', rows: [{ cue: 'What is osmosis?', notes: ['Water moves across a membrane', 'Toward more solute'] }, { cue: 'What is diffusion?', notes: ['High to low concentration'] }], summary: 'Cells move water and particles by osmosis and diffusion.' }) };
    if (/Analyse the structure/.test(t)) return { text: JSON.stringify({ roles: [{ n: 1, role: 'claim', why: 'States the position' }], feedback: 'Strong claim; add a source for the survey.' }) };
    if (/vocabulary items/.test(t)) return { text: JSON.stringify([{ term: 'Lava', def: 'Melted rock on the surface' }, { term: 'Magma', def: 'Melted rock underground' }, { term: 'Crater', def: 'The bowl at the top of a volcano' }, { term: 'Ash', def: 'Tiny bits of rock blown out' }]) };
    if (/Grade their timeline/.test(t)) return { text: 'You got 3 right — Magellan (1521) comes first.' };
    if (/Stress-test/.test(t)) return { text: 'Reason 2 has no evidence yet — add a study on sleep and grades.' };
    return { text: 'ok' };
  };
  const { ctx, page, errors } = await open(b, { server: false, device: 'Desktop Chrome', fakeGroq: fake, state: { groqKey: 'gsk_test' } });
  const lab = async (id) => { await page.evaluate((x) => openLabs(x), id); await page.waitForSelector(`.lab-view:not([hidden])[data-lab="${id}"] .lab-controls > *`, { timeout: 15000 }); };
  const btn = (t) => page.click(`.lab-panel .lab-btn:has-text("${t}")`);
  const msg = (t) => page.waitForSelector(`.lab-panel .tl-msg >> text=${t}`, { timeout: 8000 });
  // a Study tools shelf, and the new games on the Games shelf
  await page.evaluate(() => openLabs());
  await page.evaluate(() => openLabs(undefined, { section: 'tools' }));
  await page.waitForSelector('.labs:not([hidden]) .labs-grid .labs-card[data-lab="vocab"]', { timeout: 15000 }); // (the shelf draws a moment later)
  const tools = await page.$$eval('.labs-grid .labs-card', (c) => c.map((x) => x.dataset.lab));
  expect(['vocab', 'timeline', 'essay', 'cardmatrix', 'cornell', 'thesis'].every((t) => tools.includes(t)) && !tools.includes('museum') && !tools.includes('pendulum') && !tools.includes('sudoku'), 'the Study tools shelf (the Museum is in Learn > History now): ' + tools);
  await page.evaluate(() => openLabs(undefined, { section: 'games' }));
  const games = await page.$$eval('.labs-grid .labs-card', (c) => c.map((x) => x.dataset.lab));
  expect(['circuit', 'cracker', 'blitz', 'diner', 'economy', 'sudoku'].every((t) => games.includes(t)), 'the Games shelf: ' + games);
  if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/labs-games-shelf.png' });
  await page.click('.labs-x');

  // Vocabulary Flash-Chain: a wrong match breaks the chain; dragging the right term onto its meaning locks it in
  await lab('vocab');
  const term = page.locator('.tl-term').first(), i = await term.getAttribute('data-i');
  await term.click(); await page.locator(`.tl-def:not([data-i="${i}"])`).first().click();
  await page.waitForFunction(() => /Mistakes\s*1/.test(document.querySelector('.lab-stats').textContent));
  const tb = await term.boundingBox(), db = await page.locator(`.tl-def[data-i="${i}"]`).boundingBox();
  await page.mouse.move(tb.x + 20, tb.y + 10); await page.mouse.down(); await page.mouse.move(db.x + 80, db.y + 15, { steps: 8 }); await page.mouse.up();
  await page.waitForSelector(`.tl-def[data-i="${i}"].tl-done`, { timeout: 4000 });
  expect(/Chain 1/.test(await page.locator('.tl-chain').innerText()), 'the chain grows');
  await page.fill('.tl-make .tl-input', 'volcanoes'); await page.click('.tl-make .lab-btn');
  await page.waitForFunction(() => [...document.querySelectorAll('.tl-term')].some((t) => t.textContent === 'Magma'), null, { timeout: 8000 });

  // Timeline Builder: arrows move events; Check grades the order; Cassie grades it too; your own years sort themselves
  await lab('timeline');
  const first = await page.locator('.tl-ev .tl-evtext').first().innerText();
  await page.click('.tl-ev [data-down="0"]');
  expect((await page.locator('.tl-ev .tl-evtext').nth(1).innerText()) === first, 'the ▼ arrow moves an event down');
  await btn('Check my order');
  await page.waitForSelector('.tl-ev.tl-ok, .tl-ev.tl-bad');
  await btn('Cassie, grade my timeline');
  await msg('Magellan (1521) comes first');
  await page.click('.lab-panel .tl-paste summary');
  await page.fill('.lab-panel .tl-paste textarea', '1946 – Independence recognised\n1898 – Independence declared\n1521 – Magellan arrives');
  await page.click('.lab-panel .tl-paste .lab-btn');
  expect(await page.locator('.tl-ev').count() === 3, 'my own timeline');
  const want = ['Magellan arrives', 'Independence declared', 'Independence recognised'];
  for (let k = 0; k < 3; k++) {
    for (let guard = 0; guard < 4; guard++) {
      const now = await page.$$eval('.tl-ev .tl-evtext', (e) => e.map((x) => x.textContent));
      const at2 = now.findIndex((x) => x.includes(want[k]));
      if (at2 <= k) break;
      await page.click(`.tl-ev [data-up="${at2}"]`);
    }
  }
  await btn('Check my order');
  await msg('All 3 in the right order');

  // Essay Deconstructor: the sample's parts are coloured and its structure scores 100; Cassie explains each part
  await lab('essay');
  await page.waitForSelector('.tl-structure >> text=100/100');
  expect(await page.locator('.tl-sent.tl-r-counter').count() >= 1 && await page.locator('.tl-sent.tl-r-evidence').count() >= 1 && await page.locator('.tl-sent.tl-r-conclusion').count() === 1, 'claim, evidence, counter-argument and conclusion are coloured');
  if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/tool-essay.png' });
  const cls = await page.locator('.tl-sent').nth(1).getAttribute('class');
  await page.locator('.tl-sent').nth(1).click();
  expect(await page.locator('.tl-sent').nth(1).getAttribute('class') !== cls, 'tapping a sentence changes its job');
  await btn('Cassie, check the logic');
  await msg('add a source for the survey');
  expect(await page.locator('.tl-why li').count() >= 1, 'Cassie says why');

  // Smart Flashcard Matrix: notes → cards → study here → saved for spaced repetition
  await lab('cardmatrix');
  await page.fill('.lab-panel .tl-area', 'Osmosis is the movement of water across a membrane. Diffusion is particles spreading from high to low concentration. ATP is the energy molecule of cells.');
  await btn('Make the cards');
  await page.waitForFunction(() => document.querySelectorAll('.tl-card').length === 3, null, { timeout: 8000 });
  await page.locator('.tl-card').first().click();
  expect(await page.locator('.tl-card.tl-flip').count() === 1, 'a card flips');
  await btn('Study here');
  for (let k = 0; k < 3; k++) { await page.click('[data-flip]'); await page.click('[data-grade="good"]'); }
  await page.waitForSelector('.tl-empty >> text=Round done');
  await page.fill('.lab-panel .tl-input', 'Cell transport');
  await btn('Save to my Flashcards');
  await msg('Saved 3 cards');
  expect(await page.evaluate(() => window.CassieCards.count()) >= 3, 'the cards are in Flashcards');

  // Cornell Notes: raw notes → cues, notes and a summary; cover the notes to test yourself; cues become flashcards
  await lab('cornell');
  await page.fill('.lab-panel .tl-area', 'osmosis - water across membrane toward more solute\ndiffusion - high to low');
  await btn('Make Cornell notes');
  await page.waitForSelector('.tl-cue >> text=What is osmosis?', { timeout: 8000 });
  expect(/osmosis and diffusion/.test(await page.locator('.tl-cornell-page footer').innerText()), 'a summary');
  await btn('Cover the notes');
  expect(await page.locator('.tl-coverbar').count() === 2, 'the notes are covered');
  await page.locator('.tl-coverbar').first().click();
  expect(await page.locator('.tl-coverbar').count() === 1, 'tapping shows one answer');
  await btn('Cues → flashcards');
  await msg('Added 2 cards');

  // Citation & Thesis Mapper: references in four styles; evidence makes the argument stronger; Cassie stress-tests it
  await lab('thesis');
  expect(/Carskadon, M\. A\. \(2011\)\. Sleep in adolescents: The perfect storm\./.test(await page.locator('.tl-refs').innerText()), 'APA reference');
  await page.click('.lab-panel .lab-seg button:has-text("MLA")');
  expect(/Carskadon, Mary A\. “Sleep in adolescents: The perfect storm\.”/.test(await page.locator('.tl-refs').innerText()), 'MLA reference');
  await page.click('.lab-panel .lab-seg button:has-text("IEEE")');
  expect(/\[1\] M\. A\. Carskadon, “Sleep in adolescents/.test(await page.locator('.tl-refs').innerText()), 'IEEE reference');
  const before = await page.locator('.tl-structure h4').innerText();
  await page.click('[data-adde="1"]');
  await page.fill('.tl-form [data-k="quote"]', 'Students who slept 8 hours scored higher on tests.');
  await page.fill('.tl-form [data-k="authors"]', 'Santos, Maria; Cruz, Juan');
  await page.fill('.tl-form [data-k="year"]', '2022');
  await page.fill('.tl-form [data-k="title"]', 'Sleep and grades of Filipino teens');
  await page.fill('.tl-form [data-k="container"]', 'Philippine Journal of Education');
  await page.click('[data-savee]');
  expect(await page.locator('.tl-refs li').count() === 2 && (await page.locator('.tl-structure h4').innerText()) !== before, 'evidence added, strength changes');
  if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/tool-thesis.png' });
  await btn('Cassie, stress-test my argument');
  await msg('add a study on sleep and grades');
  expect(errors.length === 0, 'page errors: ' + errors.join('; '));
  await ctx.close();
});

test('Plus extras: a free student sees the diagram, and Real 3D, the Museum quiz and saving/printing say how to get them', async (b) => {
  const { ctx, page, errors } = await open(b, { server: false, device: 'Desktop Chrome', state: { groqKey: 'gsk_test', plan: null } });
  const lab = async (id) => { await page.evaluate((x) => openLabs(x), id); await page.waitForSelector(`.lab-view:not([hidden])[data-lab="${id}"] .lab-controls > *`, { timeout: 15000 }); };
  const sheet = async (what) => {
    await page.waitForSelector('.plus-sheet', { timeout: 5000 });
    if (process.env.SHOTS && what === 'Real 3D') await page.screenshot({ path: process.env.SHOTS + '/plus-sheet.png' });
    const t = await page.locator('.plus-sheet h3').innerText();
    if (what === 'Real 3D') expect(/2 free Real 3D views this week/.test(await page.locator('.plus-sheet').innerText()), 'says the free views are used up');
    expect(t.includes(what), 'says what it is: ' + t);
    await page.click('.plus-sheet .plus-ok');
    expect(await page.locator('.plus-sheet').count() === 0, 'Not now closes it');
  };
  await lab('atom');
  await page.waitForTimeout(800);
  expect(await page.locator('.lab-stage.lab-is-3d').count() === 0, 'a free student starts on the diagram');
  const note = () => page.locator('.lab-panel .lab-note').first().innerText();
  expect(/2 free views of this lab this week/.test(await note()), 'says 2 free views: ' + await note());
  // two free Real 3D views a week in each lab (switching back and forth while it's open is free)
  const real3d = () => page.click('.lab-panel .lab-seg button:has-text("Real 3D")');
  const flat = () => page.click('.lab-panel .lab-seg button:has-text("Diagram")');
  await real3d();
  await page.waitForSelector('.lab-stage.lab-is-3d', { timeout: 20000 });
  expect(/1 more free Real 3D view of this lab this week/.test(await note()), 'one left: ' + await note());
  await flat(); await real3d();
  await page.waitForSelector('.lab-stage.lab-is-3d', { timeout: 20000 });
  expect(await page.evaluate(() => freeLeft('3d:atom')) === 1, 'switching back in the same lab is free');
  await flat();
  await lab('pendulum');
  expect(/2 free views of this lab/.test(await note()), 'another lab has its own 2: ' + await note());
  await lab('atom');
  await real3d();
  await page.waitForSelector('.lab-stage.lab-is-3d', { timeout: 20000 });
  expect(/last free Real 3D view this week/.test(await note()), 'the last one: ' + await note());
  await flat();
  await lab('atom');
  await page.waitForTimeout(500);
  await real3d();
  await sheet('Real 3D');
  // next week they come back
  await page.evaluate(() => { state.freeUses.week = '2000-01-03'; });
  expect(await page.evaluate(() => freeLeft('3d:atom')) === 2, 'a new week, 2 again');
  expect(await page.locator('.lab-seg button[data-v="flat"][aria-pressed="true"]').count() === 1, 'still on the diagram');
  await lab('museum');
  await page.click('.lab-panel .lab-btn:has-text("Who painted it?")');
  await sheet('Who painted it?');
  expect(await page.locator('[data-guess]').count() === 0, 'the quiz did not start');
  await lab('cornell');
  await page.click('.lab-panel .lab-btn:has-text("Print")');
  await sheet('Printing');
  await page.click('.lab-panel .lab-btn:has-text("Download (.txt)")');
  await sheet('Saving');
  // once the account has Plus, the extras open
  await page.evaluate(() => { state.plan = { plan: 'plus', until: Date.now() + 864e5 }; });
  await lab('atom');
  await page.click('.lab-panel .lab-seg button:has-text("Real 3D")');
  await page.waitForSelector('.lab-stage.lab-is-3d', { timeout: 20000 });
  expect(await page.locator('.plus-sheet').count() === 0, 'no note for Plus');
  await page.evaluate(() => { state.plan = null; });
  // the board: a picture is free, a PDF and board files are Plus
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  await page.evaluate(() => openSketch());
  await page.waitForSelector('.csk-wrap');
  await page.click('[data-act="save"]');
  expect(/PDF · Plus/.test(await page.locator('.csk-pop').innerText()), 'the PDF says Plus');
  const [png] = await Promise.all([page.waitForEvent('download'), page.click('.csk-pop [data-pop="png"]')]);
  expect(/\.png$/.test(png.suggestedFilename()), 'the picture still saves');
  await page.click('[data-act="save"]');
  await page.click('.csk-pop [data-pop="pdf"]');
  await sheet('PDF');
  expect(errors.length === 0, 'page errors: ' + errors.join('; '));
  await ctx.close();
});

test.slow('All 3D on Free: the cells, the body, the solar system and the globe open twice a week each, then say how to get Plus', async (b) => {
  const { ctx, page, errors } = await open(b, { server: false, device: 'Desktop Chrome', state: { groqKey: 'gsk_test', plan: null } });
  const plusSays = async (what) => {
    await page.waitForSelector('.plus-sheet', { timeout: 8000 });
    const t = await page.locator('.plus-sheet').innerText();
    expect(t.includes(what) && /2 free views this week/.test(t), 'the Plus note: ' + t);
    await page.click('.plus-sheet .plus-ok');
  };
  // Explore 3D: the animal cell, twice
  for (let k = 1; k <= 2; k++) {
    await page.evaluate(() => openExplore('animal'));
    await page.waitForFunction((n) => { const t = document.querySelector('.x3d-toast'); return t && (n === 1 ? /1 more/ : /last/).test(t.textContent); }, k, { timeout: 30000 });
    if (process.env.SHOTS && k === 1) { await page.waitForTimeout(1500); await page.screenshot({ path: process.env.SHOTS + '/x3d-toast.png' }); }
    const t = await page.locator('.x3d-toast').textContent();
    expect(k === 1 ? /1 more free view/.test(t) : /last free view/.test(t), `visit ${k}: ${t}`);
    // switching to the plant cell uses the plant's own views
    if (k === 1) {
      await page.click('[data-cell="plant"]');
      await page.waitForFunction(() => document.querySelector('[data-cell="plant"]').getAttribute('aria-selected') === 'true', null, { timeout: 15000 });
      expect(await page.evaluate(() => freeLeft('3d:plant')) === 1, 'the plant cell has its own 2');
      await page.click('[data-cell="animal"]'); // already open this time: free
    }
    await page.click('.x3d-close');
  }
  expect(await page.evaluate(() => freeLeft('3d:animal')) === 0, 'the animal cell is used up');
  await page.evaluate(() => openExplore('animal'));
  await plusSays('animal cell');
  // the solar system: twice, then a note
  const lab = async (id) => { await page.evaluate((x) => openLabs(x), id); await page.waitForSelector(`.lab-view:not([hidden])[data-lab="${id}"]`, { timeout: 15000 }); };
  await lab('space3d');
  await page.waitForSelector('.lab-panel .lab-note >> text=/1 more free 3D view/', { timeout: 15000 });
  await lab('solar'); await lab('space3d');
  await page.waitForSelector('.lab-panel .lab-note >> text=/last free 3D view/', { timeout: 15000 });
  await lab('solar'); await lab('space3d');
  await plusSays('solar system');
  await page.waitForSelector('.lab-stage >> text=/used this week’s 2 free views/', { timeout: 15000 });
  await page.click('.lab-stage .lab-btn:has-text("About Plus")');
  await plusSays('solar system');
  // the globe: the flat map first; the globe twice a week
  await lab('atlas');
  expect(/2 free views this week/.test(await page.locator('.lab-panel').innerText()), 'the atlas says 2 free globe views');
  await page.click('.lab-panel .lab-seg button:has-text("Globe 3D")');
  await page.waitForSelector('.lab-panel >> text=/1 more free 3D view/', { timeout: 15000 });
  expect(await page.evaluate(() => freeLeft('3d:atlas')) === 1, 'one globe view used');
  expect(errors.length === 0, 'page errors: ' + errors.join('; '));
  await ctx.close();
});

test('Teach me: Cassie tutors inside a lab — steps out loud, pointing at the exact button and at parts of the picture; waits for the tap', async (b) => {
  const asked = [];
  const { ctx, page, errors } = await open(b, { server: false, device: 'Desktop Chrome', state: { groqKey: 'gsk_test', voiceGender: 'man' }, fakeGroq: (body) => {
    const u = body.messages.filter((m) => m.role === 'user').map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n');
    if (!/The things on the screen, numbered/.test(u)) return { text: 'ok' };
    asked.push(u);
    const num = (re) => { const line = u.split('\n').find((l) => /^\d+\. /.test(l) && re.test(l)); return line ? parseInt(line, 10) : 0; };
    if (/The student says: "what is an isotope/.test(u)) return { text: JSON.stringify({ steps: [{ say: 'An isotope has the same protons but a different number of neutrons.', point: num(/nucleus/) }] }) };
    return { text: 'Sure! ' + JSON.stringify({ steps: [
      { say: 'Tap Carbon-14 to build that atom.', point: num(/"Carbon-14" button/) },
      { say: 'This is the nucleus, where protons and neutrons live.', point: num(/the nucleus/) },
      { say: 'Now drag a proton from the tray yourself.', point: num(/proton in the tray/) },
    ] }) };
  } });
  await page.evaluate(() => openLabs('atom'));
  await page.waitForSelector('.lab-view:not([hidden])[data-lab="atom"] .lab-controls > *', { timeout: 15000 });
  await page.click('.lab-teach');
  await page.waitForFunction(() => /Tap Carbon-14/.test((document.querySelector('.tut-say') || {}).textContent || ''), null, { timeout: 15000 });
  expect(/How do I use this/.test(asked[0]) && /Build an atom/.test(asked[0]) && /protons/.test(asked[0]), 'Cassie sees the lab and what is on screen');
  const pointed = await page.evaluate(() => { const p = document.querySelector('.tut-pointed'); return p ? p.textContent.trim() : ''; });
  expect(pointed === 'Carbon-14', 'points at the Carbon-14 button: ' + pointed);
  if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/tutor.png' });
  expect(await page.locator('.tut-finger:not([hidden])').count() === 1, 'her cursor points at it');
  expect(/1 of 3/.test(await page.locator('.tut-step').innerText()), 'step 1 of 3');
  // she waits for the student to do it
  await page.waitForTimeout(2500);
  expect(/Tap Carbon-14/.test(await page.locator('.tut-say').innerText()), 'still waiting for the tap');
  await page.click('.tut-pointed');
  await page.waitForFunction(() => /nucleus/.test(document.querySelector('.tut-say').textContent), null, { timeout: 5000 });
  if (process.env.SHOTS) { await page.waitForTimeout(300); await page.screenshot({ path: process.env.SHOTS + '/tutor-spot.png' }); }
  expect(await page.locator('.tut-ring:not([hidden])').count() === 1 && await page.locator('.tut-pointed').count() === 0, 'a ring on a part of the picture');
  await page.click('.tut-next');
  await page.waitForFunction(() => /drag a proton/.test(document.querySelector('.tut-say').textContent), null, { timeout: 5000 });
  await page.click('.tut-next');
  await page.waitForFunction(() => /Nice work/.test(document.querySelector('.tut-say').textContent), null, { timeout: 5000 });
  // ask anything (typed here; 🎤 says it out loud)
  expect(await page.locator('.tut-mic').count() === 1, 'a microphone button');
  await page.fill('.tut-ask input', 'what is an isotope?');
  await page.press('.tut-ask input', 'Enter');
  await page.waitForFunction(() => /same protons/.test(document.querySelector('.tut-say').textContent), null, { timeout: 8000 });
  expect(/what is an isotope/.test(asked.at(-1)) && /carbon-14/i.test(asked.at(-1)), 'the follow-up sees the new screen: ' + asked.at(-1).slice(0, 400));
  await page.click('.tut-x');
  expect(await page.locator('.lab-tutor').count() === 0 && await page.locator('.tut-finger').count() === 0, 'stops cleanly');
  // every lab has it: study tools and games too
  await page.evaluate(() => openLabs('cornell'));
  await page.waitForSelector('.lab-view:not([hidden])[data-lab="cornell"] .lab-controls > *', { timeout: 15000 });
  expect(await page.locator('.lab-teach:visible').count() === 1, 'Teach me in a study tool');
  await page.evaluate(() => openLabs('circuit'));
  await page.waitForSelector('.lab-view:not([hidden])[data-lab="circuit"] .lab-controls > *', { timeout: 15000 });
  expect(await page.locator('.lab-teach:visible').count() === 1, 'and in a game');
  expect(errors.length === 0, 'page errors: ' + errors.join('; '));
  await ctx.close();
  if (process.env.SHOTS) { // how it looks on a phone
    const ph = await open(b, { server: false, state: { groqKey: 'gsk_test' }, fakeGroq: () => ({ text: JSON.stringify({ steps: [{ say: 'Tap the plus next to Protons to add one.', point: 0 }] }) }) });
    await ph.page.evaluate(() => openLabs('atom'));
    await ph.page.waitForSelector('.lab-view:not([hidden])[data-lab="atom"] .lab-controls > *', { timeout: 15000 });
    await ph.page.click('.lab-teach');
    await ph.page.waitForFunction(() => /plus next to Protons/.test(document.querySelector('.tut-say').textContent), null, { timeout: 15000 });
    await ph.page.screenshot({ path: process.env.SHOTS + '/tutor-phone.png' });
    await ph.ctx.close();
  }
});

test('for the little ones (Nursery and Kindergarten): Trace letters accepts a traced A and not a scribble, Count with me says one, two, three as three are tapped, Shapes and colours names one to tap, every target is at least 64px, and Cassie says it all aloud', async (b) => {
  const { ctx, page, errors } = await open(b, { device: 'Desktop Chrome', viewport: { width: 1280, height: 800 }, setup: async (c) => {
    await c.addInitScript(() => {
      window.__said = [];
      const synth = { speaking: false, getVoices: () => [], addEventListener() {}, cancel() {}, speak(u) { window.__said.push(u.text); } };
      Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
      window.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
    });
  } });
  const ids = await page.evaluate(async () => (await import('./labs/labs.js')).LABS.map((l) => l.id));
  expect(['trace-letters', 'trace-numbers', 'count', 'shapes'].every((id) => ids.includes(id)), 'the four kids labs are on the shelf: ' + ids.filter((x) => /trace|count|shape/.test(x)));
  const small = async () => page.$$eval('.lab-view:not([hidden]) .kid-btn, .lab-view:not([hidden]) .kid-thing', (bs) => bs.filter((x) => { const r = x.getBoundingClientRect(); return r.width < 64 || r.height < 64; }).map((x) => x.className + ' ' + (x.getAttribute('aria-label') || '')));
  // the glyph's path on screen, worked out the same way the lab lays it out
  const path = (glyph) => page.evaluate(async (g) => {
    const { GLYPHS, samples } = await import('./labs/kids.js');
    const c = document.querySelector('.lab-view:not([hidden]) .kid-trace'), r = c.getBoundingClientRect(), s = Math.min(r.width, r.height) * 0.72;
    const pts = samples(GLYPHS[g], { x: (r.width - s * 0.9) / 2, y: (r.height - s) / 2, s });
    return { pts: pts.map((p) => ({ x: r.left + p.x, y: r.top + p.y, s: p.s })), box: { x: r.left + (r.width - s * 0.9) / 2, y: r.top + (r.height - s) / 2, s } };
  }, glyph);

  // 1. Trace letters: A, followed with the finger, counts and Cassie cheers
  await page.evaluate(() => openLabs('trace-letters'));
  await page.waitForSelector('.lab-view:not([hidden])[data-lab="trace-letters"] .kid-trace');
  await page.waitForTimeout(300);
  expect(await page.$eval('.lab-stage', (s) => s.dataset.glyph) === 'A', 'starts on A');
  expect((await page.evaluate(() => window.__said)).includes('A'), 'Cassie says A: ' + await page.evaluate(() => window.__said));
  expect(await page.locator('.lab-view:not([hidden]) .lab-ask:visible, .lab-view:not([hidden]) .lab-quiz:visible').count() === 0, 'no Ask or Quiz to read for the little ones');
  const A = await path('A');
  let stroke = -1;
  for (const p of A.pts) { if (p.s !== stroke) { if (stroke >= 0) await page.mouse.up(); await page.mouse.move(p.x, p.y); await page.mouse.down(); stroke = p.s; } else await page.mouse.move(p.x, p.y, { steps: 2 }); }
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelector('.lab-stage').dataset.done === '1', null, { timeout: 3000 }).catch(() => {});
  expect(await page.$eval('.lab-stage', (s) => s.dataset.done) === '1', 'a traced A is accepted: ' + await page.$eval('.lab-stage', (s) => s.dataset.progress + '%'));
  expect((await page.evaluate(() => window.__said)).some((t) => /^A! .*great job/i.test(t)), 'Cassie says A and cheers: ' + await page.evaluate(() => window.__said));
  // 2. the next letter, scribbled over: not accepted
  await page.click('.kid-btn[aria-label="Next one"]');
  await page.waitForFunction(() => document.querySelector('.lab-stage').dataset.glyph === 'B');
  const B = await path('B'), { x, y, s } = B.box;
  await page.mouse.move(x + s * 0.5, y + s * 0.5); await page.mouse.down();
  for (let k = 0; k < 160; k++) { const a = k * 0.7; await page.mouse.move(x + s * (0.55 + 0.3 * Math.cos(a) * Math.sin(k * 0.13)), y + s * (0.5 + 0.35 * Math.sin(a * 1.3))); }
  for (let k = 0; k < 20; k++) await page.mouse.move(x + s * (k % 2 ? 0.95 : 0.1), y + s * (0.15 + k * 0.04));
  await page.mouse.up();
  const sb = await page.$eval('.lab-stage', (st) => ({ done: st.dataset.done, progress: +st.dataset.progress }));
  expect(sb.done !== '1' && sb.progress < 80, 'a scribble is not accepted: ' + JSON.stringify(sb));
  expect(!(await small()).length, 'every target in Trace letters is 64px: ' + await small());

  // 3. Count with me: tap three, Cassie says one, two, three
  await page.evaluate(() => openLabs('count'));
  await page.waitForSelector('.lab-view:not([hidden])[data-lab="count"] .kid-thing');
  await page.evaluate(() => { window.__said = []; });
  const things = page.locator('.lab-view:not([hidden]) .kid-thing');
  expect(await things.count() >= 3, 'at least three to count: ' + await things.count());
  for (let k = 0; k < 3; k++) await things.nth(k).click();
  await things.nth(0).click(); // (tapping one again doesn't count it twice)
  const said = await page.evaluate(() => window.__said);
  expect(JSON.stringify(said.slice(0, 3)) === '["one","two","three"]' && said.length === 3, 'counting to three says three numbers: ' + JSON.stringify(said));
  expect(await page.$eval('.lab-stage', (st) => st.dataset.counted) === '3', 'three counted');
  expect(!(await small()).length, 'every target in Count with me is 64px: ' + await small());

  // 4. Shapes and colours: Cassie names one; a wrong tap says what it is, the right one cheers
  await page.evaluate(() => { window.__said = []; openLabs('shapes'); });
  await page.waitForSelector('.lab-view:not([hidden])[data-lab="shapes"] .kid-shape');
  const want = await page.$eval('.lab-stage', (st) => st.dataset.want);
  expect((await page.evaluate(() => window.__said)).includes(`Tap the ${want}.`), 'Cassie says which to tap: ' + await page.evaluate(() => window.__said));
  const [colour, shape] = want.split(' ');
  await page.click(`.lab-view:not([hidden]) .kid-shape:not([data-shape="${shape}"][data-colour="${colour}"])`);
  expect(/Try again/.test((await page.evaluate(() => window.__said)).at(-1)), 'a wrong tap is gently told');
  await page.click(`.lab-view:not([hidden]) .kid-shape[data-shape="${shape}"][data-colour="${colour}"]`);
  expect(/^Yes!/.test((await page.evaluate(() => window.__said)).at(-1)), 'the right tap cheers');
  expect(!(await small()).length, 'every target in Shapes and colours is 64px: ' + await small());
  expect(await page.locator('.lab-view:not([hidden]) .kid-btn').count() >= 2, 'big buttons to hear it again and go on');

  // no typing, no dashes in their words
  const text = require('fs').readFileSync(require('path').join(ROOT, 'labs/kids.js'), 'utf8');
  expect(!/[–—]/.test(text), 'no dashes in kids.js');
  expect(await page.locator('.lab-view:not([hidden]) .lab-stage input, .lab-view:not([hidden]) .lab-panel input').count() === 0, 'nothing to type');
  expect(errors.length === 0, 'page errors: ' + errors.join('; '));
  await ctx.close();
  if (process.env.SHOTS) { // how they look on a phone
    const ph = await open(b, { server: false, device: 'iPhone 13', viewport: { width: 360, height: 740 } });
    for (const id of ['trace-letters', 'count', 'shapes']) {
      await ph.page.evaluate((x) => openLabs(x), id);
      await ph.page.waitForSelector(`.lab-view:not([hidden])[data-lab="${id}"] .kid-btn`);
      await ph.page.waitForTimeout(400);
      await ph.page.screenshot({ path: `${process.env.SHOTS}/kids-${id}.png` });
    }
    await ph.ctx.close();
  }
});

test('phone You sheets (iPhone, with the notch and home bar): You, Account, Study, Voice, Privacy and data, Plans and All settings start under the status bar, end above the tab bar, are not see-through, keep Back and Close on screen (44px) while scrolling; each tab’s own icon moves when tapped (still with Reduce Motion or Lite mode)', async (b) => {
  const { ctx, page, errors } = await open(b, { device: 'iPhone 13', viewport: { width: 390, height: 844 }, server: false, lite: 'off', state: { tab: 'home' } });
  await page.waitForSelector('html.native .tabbar .tab[data-tab="you"]');
  await page.evaluate(() => { document.documentElement.style.setProperty('--safe-top', '47px'); document.documentElement.style.setProperty('--safe-bottom', '34px'); });
  const check = (name) => page.evaluate((nm) => {
    const card = document.querySelector('#settings-panel .settings-card'), head = card.querySelector('.set-head'), bar = document.querySelector('.tabbar').getBoundingClientRect();
    const r = (e) => e.getBoundingClientRect(), cs = getComputedStyle(card), ps = getComputedStyle(document.getElementById('settings-panel'));
    const alpha = ((cs.backgroundColor.match(/rgba?\(([^)]+)\)/) || [])[1] || '').split(',').map(Number)[3];
    const shown = (e) => e.offsetParent !== null && getComputedStyle(e).visibility !== 'hidden';
    const btns = [card.querySelector('.set-back'), card.querySelector('.set-x')].filter(shown);
    card.scrollTop = card.scrollHeight; // (the last control, scrolled to)
    const ctrls = [...card.querySelectorAll('button, input, select, a, summary')].filter(shown);
    const last = ctrls.at(-1), lr = last && r(last), hr = r(head), cr = r(card);
    return { nm, headTop: Math.round(hr.top), cardTop: Math.round(cr.top), cardBottom: Math.round(cr.bottom), barTop: Math.round(bar.top), lastBottom: lr && Math.round(lr.bottom), last: last && (last.textContent || last.id || last.tagName).trim().slice(0, 30),
      bg: cs.backgroundColor, img: cs.backgroundImage, opaque: (alpha === undefined || Number.isNaN(alpha) || alpha === 1) && cs.backgroundImage === 'none' && !/rgba\(0, 0, 0, 0\)|transparent/.test(cs.backgroundColor) && !/rgba/.test(ps.backgroundColor), behind: ps.backgroundColor,
      headAfterScroll: Math.round(r(head).top), btns: btns.map((x) => { const q = r(x); return [Math.round(q.width), Math.round(q.height), Math.round(q.top)]; }) };
  }, name);
  const ok = (g) => g.headTop >= 47 && g.cardTop >= 47 && g.cardBottom <= g.barTop + 1 && g.lastBottom <= g.barTop + 1 && g.opaque && Math.abs(g.headAfterScroll - g.headTop) <= 1 && g.btns.length >= 1 && g.btns.every(([w, h, t]) => w >= 44 && h >= 44 && t >= 47);
  await page.click('.tab[data-tab="you"]');
  await page.waitForSelector('#settings-panel:not([hidden]) .set-profile');
  await page.waitForTimeout(400);
  const you = await check('You');
  if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/you-sheet.png' });
  expect(ok(you), 'the You sheet: ' + JSON.stringify(you));
  for (const [go, name] of [['account', 'Account'], ['study', 'Study'], ['voice', 'Voice'], ['privacy', 'Privacy and data'], ['plans', 'Plans'], ['all', 'All settings']]) {
    await page.evaluate(() => { document.querySelector('#settings-panel .settings-card').scrollTop = 0; });
    await page.click(`#settings-panel .set-link[data-open="${go}"]`);
    await page.waitForFunction((p) => document.querySelector('#settings-panel .settings-card').dataset.page === p, go);
    await page.waitForTimeout(250);
    const g = await check(name);
    expect(ok(g), `the ${name} sheet: ` + JSON.stringify(g));
    await page.click('#settings-panel .set-back');
    await page.waitForFunction(() => document.querySelector('#settings-panel .settings-card').dataset.page === 'profile');
  }
  // each tab's own icon moves when tapped
  const moving = (t) => page.evaluate((tab) => { const b = document.querySelector(`.tab[data-tab="${tab}"]`), s = b.querySelector('svg'); return { cls: b.classList.contains('tab-anim'), n: s.getAnimations({ subtree: true }).filter((a) => a.playState === 'running' && /^tab-/.test(a.animationName || '')).length }; }, t);
  for (const t of ['home', 'chat', 'labs', 'games', 'cards', 'you']) {
    await page.click(`.tab[data-tab="${t}"]`);
    const m = await moving(t);
    expect(m.cls && m.n >= 1, `the ${t} icon moves when tapped: ` + JSON.stringify(m));
  }
  // Reduce Motion: no movement, just the colour
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const t of ['home', 'games']) {
    await page.click(`.tab[data-tab="${t}"]`);
    const m = await moving(t);
    expect(m.n === 0, `with Reduce Motion the ${t} icon stays still: ` + JSON.stringify(m));
  }
  expect(errors.length === 0, 'page errors: ' + errors.join('; '));
  await ctx.close();
});

test('Learn (was Labs) follows the student’s level: For you opens on their own level first (Kindergarten: the 4 little ones’ labs; Grade 11: High school) with the other levels folded under Other levels, Today’s Lab on Home comes from their level, changing the level in the profile changes both at once, and no screen says “Labs” any more (390x844, 1280x800)', async (b) => {
  const levelsOf = (page) => page.evaluate(async () => { const m = await import('./labs/labs.js'); return { levels: m.LEVELS.map((l) => l[0]), of: Object.fromEntries(m.LABS.map((l) => [l.id, l.levels || []])) }; });
  const forYou = (page) => page.evaluate(() => [...document.querySelectorAll('.lp-foryou .lp-level')].map((s) => ({ k: s.dataset.level, mine: s.classList.contains('lp-mine'), folded: !!s.closest('details.lp-other'), ids: [...s.querySelectorAll('.lp-row')].map((r) => r.dataset.lab) })));
  const learnTab = async (page) => { await page.click('.tab[data-tab="labs"]'); await page.waitForSelector('.labs:not([hidden]) .lp-foryou .lp-level, .labs:not([hidden]) .lp-foryou .lp-for', { timeout: 15000 }); await page.waitForTimeout(400); };
  const SHOTS = process.env.SHOTS;

  // 1. Kindergarten: Nursery and Kindergarten first and open, with the 4 little ones' labs
  {
    const { ctx, page, errors } = await open(b, { device: 'iPhone 13', viewport: { width: 390, height: 844 }, server: false, state: { tab: 'home', profile: { ...PROFILE, grade: 'Kindergarten', age: 5 } } });
    await learnTab(page);
    const f = await forYou(page), L = await levelsOf(page);
    expect(f[0] && f[0].k === 'pre' && f[0].mine && !f[0].folded, 'Kindergarten opens on Nursery and Kindergarten: ' + JSON.stringify(f));
    expect(JSON.stringify(f[0].ids.slice().sort()) === JSON.stringify(['count', 'shapes', 'trace-letters', 'trace-numbers']), 'the 4 little ones’ labs: ' + f[0].ids);
    expect(JSON.stringify(f.slice(1).map((x) => x.k)) === JSON.stringify(['elem', 'hs', 'college', 'grad']) && f.slice(1).every((x) => x.folded && !x.mine && x.ids.length), 'the others in order under Other levels: ' + JSON.stringify(f.map((x) => [x.k, x.folded])));
    expect(await page.$eval('.lp-other', (d) => !d.open && /^Other levels$/.test(d.querySelector('summary').textContent.trim())), 'Other levels is folded');
    expect(f.every((x) => x.ids.every((id) => !L.of[id] || L.of[id].includes(x.k))), 'each section holds only its level’s labs');
    expect(Object.keys(L.of).every((id) => L.of[id].length), 'every lab has its levels: ' + Object.keys(L.of).filter((id) => !L.of[id].length));
    expect(['trace-letters', 'trace-numbers', 'count', 'shapes'].every((id) => JSON.stringify(L.of[id]) === '["pre"]'), 'the kids labs are Nursery and Kindergarten only');
    expect(L.of[await page.evaluate(() => todayLab())].includes('pre'), 'a Kindergarten student’s Today’s Lab is one of theirs');
    // Today's Lab on Home, by level: every pick is that level's and has its card info
    const bad = await page.evaluate((of) => Object.entries(TODAY_BY_LEVEL).flatMap(([k, ids]) => ids.filter((id) => !(of[id] || []).includes(k) || !LAB_INFO[id]).map((id) => k + ':' + id)), L.of);
    expect(!bad.length, 'Today’s Lab picks fit their level: ' + bad);
    if (SHOTS) await page.screenshot({ path: SHOTS + '/learn-kinder.png' });
    expect(errors.length === 0, 'page errors: ' + errors.join('; '));
    await ctx.close();
  }
  // 2. Grade 11: High school first; Today's Lab (Home and Learn) is a High school lab; then College in the profile: both follow at once
  {
    const { ctx, page, errors } = await open(b, { device: 'iPhone 13', viewport: { width: 390, height: 844 }, server: false, state: { tab: 'home', profile: { ...PROFILE, grade: 'Grade 11', age: 16 } } });
    const L = await levelsOf(page);
    await page.waitForSelector('#home .hub-tlab-pv');
    const home1 = await page.$eval('#home .hub-tlab-pv', (c) => c.dataset.pv);
    expect(L.of[home1].includes('hs'), 'Grade 11: Home’s Today’s Lab is a High school lab: ' + home1);
    await learnTab(page);
    let f = await forYou(page);
    expect(f[0].k === 'hs' && f[0].mine && f[0].ids.length >= 10 && !f[0].ids.some((id) => L.of[id] && JSON.stringify(L.of[id]) === '["pre"]'), 'Grade 11 opens on High school: ' + JSON.stringify(f[0]));
    expect(L.of[await page.$eval('.lp-play', (x) => x.dataset.lab)].includes('hs'), 'Learn’s Today’s Lab is a High school one too');
    if (SHOTS) await page.screenshot({ path: SHOTS + '/learn-grade11.png' });
    await page.evaluate(() => saveProfile({ ...state.profile, grade: '2nd year college' }, false, state.profile)); // (Edit profile's Save)
    await page.waitForFunction(() => (document.querySelector('.lp-foryou .lp-mine') || {}).dataset?.level === 'college', null, { timeout: 4000 }).catch(() => {});
    f = await forYou(page);
    expect(f[0] && f[0].k === 'college' && f[0].mine, 'after changing to College, For you opens on College at once: ' + JSON.stringify(f.map((x) => x.k)));
    await page.click('.tab[data-tab="home"]');
    await page.waitForSelector('#home .hub-tlab-pv');
    const home2 = await page.$eval('#home .hub-tlab-pv', (c) => c.dataset.pv);
    expect(L.of[home2].includes('college'), 'and Home’s Today’s Lab is a College one: ' + home2);
    expect(errors.length === 0, 'page errors: ' + errors.join('; '));
    await ctx.close();
  }
  // 3. no screen says "Labs" (lab names aside): the words on screen, and the names buttons are read out by
  const said = (page) => page.evaluate(() => {
    const out = [], seen = (e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden';
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n; (n = walk.nextNode());) if (/\bLabs\b/.test(n.nodeValue) && n.parentElement && seen(n.parentElement) && !n.parentElement.closest('script,style')) out.push(n.nodeValue.trim().slice(0, 60));
    document.querySelectorAll('[aria-label],[title],[placeholder]').forEach((e) => { const t = ['aria-label', 'title', 'placeholder'].map((a) => e.getAttribute(a) || '').join(' '); if (/\bLabs\b/.test(t) && (seen(e) || e.matches('[role=dialog]'))) out.push(t.slice(0, 60)); });
    return out;
  });
  for (const [size, device, viewport] of [['390x844', 'iPhone 13', { width: 390, height: 844 }], ['1280x800', 'Desktop Chrome', { width: 1280, height: 800 }]]) {
    const phone = size === '390x844';
    const { ctx, page, errors } = await open(b, { device, viewport, server: false, state: { tab: 'home' } });
    const found = [];
    const look = async (where) => { for (const t of await said(page)) found.push(`${where}: ${t}`); };
    if (phone) {
      await page.waitForSelector('#home .hub-boxes'); await look('Home');
      await learnTab(page); await look('Learn');
      await page.click('.labs:not([hidden]) [data-lp="science"]'); await page.waitForSelector('.lp-list:not([hidden]) .lp-row'); await look('Learn list');
      await page.click('.lp-back'); await page.click('.lp-other > summary'); await page.waitForTimeout(300); await look('Other levels');
      await page.click('.tab[data-tab="you"]'); await page.waitForSelector('#settings-panel:not([hidden])'); await look('You');
    } else {
      await page.evaluate(() => deskGo('home')); await page.waitForTimeout(500); await look('Home');
      await page.click('#labs-btn'); await page.waitForSelector(LABS_READY, { timeout: 15000 }); await look('Learn');
      await page.evaluate(() => openLabs('pendulum')); await page.waitForSelector('.lab-view:not([hidden]) .lab-back'); await look('a lab');
    }
    await page.goto(APP.replace('app.html', 'index.html')); await page.waitForTimeout(500); await look('the website');
    expect(!found.length, `${size}: “Labs” still shows: ` + found.join(' | '));
    expect(errors.length === 0, 'page errors: ' + errors.join('; '));
    await ctx.close();
  }
});

test.slow('Teach me and Ask Cassie in the 3D explorer: Cassie teaches the cell, pointing at its buttons and labels', async (b) => {
  const asked = [];
  const { ctx, page, errors } = await open(b, { server: false, device: 'Desktop Chrome', state: { groqKey: 'gsk_test' }, fakeGroq: (body) => {
    const u = body.messages.filter((m) => m.role === 'user').map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n');
    asked.push(u);
    if (!/The things on the screen, numbered/.test(u)) return { text: 'The nucleus holds the DNA.' };
    const num = (re) => { const line = u.split('\n').find((l) => /^\d+\. /.test(l) && re.test(l)); return line ? parseInt(line, 10) : 0; };
    return { text: JSON.stringify({ steps: [{ say: 'Tap Plant cell to compare it.', point: num(/"Plant cell" button/) }, { say: 'This label is the nucleus.', point: num(/label "Nucleus"/) }] }) };
  } });
  await page.evaluate(() => openExplore('animal'));
  await page.waitForSelector('.x3d:not([hidden]) [data-tool="teach"]:visible', { timeout: 30000 });
  await page.waitForFunction(() => document.querySelectorAll('.x3d-label').length > 3, null, { timeout: 30000 });
  await page.click('[data-tool="teach"]');
  await page.waitForFunction(() => /Tap Plant cell/.test((document.querySelector('.tut-say') || {}).textContent || ''), null, { timeout: 15000 });
  expect(/Animal cell 3D/.test(asked.at(-1)) && /looking at the animal cell/.test(asked.at(-1)), 'Cassie knows where the student is');
  expect((await page.evaluate(() => (document.querySelector('.tut-pointed') || {}).textContent || '')).trim() === 'Plant cell', 'points at the Plant cell tab');
  await page.click('.tut-pointed');
  await page.waitForFunction(() => /nucleus/.test(document.querySelector('.tut-say').textContent), null, { timeout: 15000 });
  await page.click('.tut-x');
  expect(await page.locator('.lab-tutor').count() === 0, 'stops');
  // Ask Cassie: about what's on the screen, right here
  await page.click('[data-tool="ask"]');
  await seen(page, '.x3d .lab-helper:not([hidden]) .hp-a', 'holds the DNA');
  expect(/What's on my screen right now: looking at the (animal|plant) cell/.test(asked.at(-1)), 'Cassie sees the 3D screen: ' + asked.at(-1).slice(0, 300));
  expect(await page.locator('.x3d').isVisible() && await page.locator('#chat-log .bubble-user').count() === 0, 'no trip to the chat');
  expect(errors.length === 0, 'page errors: ' + errors.join('; '));
  await ctx.close();
});

test('a pinch in Labs or the 3D body never zooms the whole page (in the chat it still can, for reading)', async (b) => {
  const { ctx, page } = await open(b, { server: false, state: { groqKey: 'gsk_test' } });
  const pinch = () => page.evaluate(() => { const e = new Event('gesturestart', { cancelable: true, bubbles: true }); document.body.dispatchEvent(e); return e.defaultPrevented; });
  expect(await pinch() === false, 'the chat can still be zoomed');
  await page.evaluate(() => openLabs('atom'));
  await page.waitForSelector('.lab-view:not([hidden])[data-lab="atom"]', { timeout: 15000 });
  expect(await pinch() === true, 'no page zoom in a lab');
  await page.evaluate(() => document.querySelector('.labs .labs-x').click());
  await page.evaluate(() => openExplore('animal'));
  await page.waitForSelector('.x3d:not([hidden])', { timeout: 30000 });
  expect(await pinch() === true, 'no page zoom in the 3D viewer');
  await ctx.close();
});

test('Solar System 3D: every orbit in the real order and AU proportion (one squash for all), the Moon’s path never within one Earth radius of Venus’s or Mars’s in a full year, the zoom reaches Neptune, and the distance facts are real', async (b) => {
  const { ctx, page, errors } = await open(b, { device: 'Desktop Chrome', state: { groqKey: 'gsk_test' } });
  const r = await page.evaluate(async () => {
    const m = await import('./labs/space3d.js'), s = await import('./labs/space.js');
    const out = {};
    for (const mode of ['squeezed', 'true']) {
      const f = m.ORBIT_SCALE[mode], P = s.PLANETS, E = P.find((p) => p[0] === 'Earth');
      const radii = P.map((p) => [p[0], f(p[1]), p[1]]);
      // where a planet is drawn on day d (the lab's own placing: its real ellipse, the radius squashed)
      const at = (p, d) => { const q = s.planetAt(p, d), k = f(q.r) / q.r; return [q.x * k, q.y * k]; };
      const path = (p) => { const n = 4000, T = s.periodDays(p); return Array.from({ length: n }, (_, k) => at(p, (k / n) * T)); };
      const moonR = m.moonOrbit(mode), earthR = m.planetSize(E);
      const paths = { Venus: path(P[1]), Mars: path(P[3]) };
      let closest = { Venus: Infinity, Mars: Infinity };
      for (let d = 0; d <= 365.25; d += 0.25) {
        const [ex, ey] = at(E, d), ang = ((d % 27.32) / 27.32) * Math.PI * 2, mx = ex + Math.cos(ang) * moonR, my = ey + Math.sin(ang) * moonR;
        for (const k of ['Venus', 'Mars']) for (const [x, y] of paths[k]) { const dd = Math.hypot(mx - x, my - y); if (dd < closest[k]) closest[k] = dd; }
      }
      // where Earth's own ball reaches out to: the Moon circles outside it
      out[mode] = { radii, moonR, earthR, moonSize: earthR * 0.27, closest, zoom: m.SOLAR_ZOOM[mode], neptuneFar: f(P[7][1] * (1 + P[7][2])),
        earthGapIn: f(E[1] * (1 - E[2])) - f(P[1][1] * (1 + P[1][2])), earthGapOut: f(P[3][1] * (1 - P[3][2])) - f(E[1] * (1 + E[2])) };
    }
    return out;
  });
  const sq = { squeezed: (x) => Math.sqrt(x), true: (x) => x };
  for (const [mode, o] of Object.entries(r)) {
    const names = o.radii.map((x) => x[0]);
    expect(names.join() === 'Mercury,Venus,Earth,Mars,Jupiter,Saturn,Uranus,Neptune', mode + ': all eight planets in order: ' + names);
    expect(o.radii.every((x, i) => i === 0 || x[1] > o.radii[i - 1][1]), mode + ': orbits grow outward in the real order: ' + JSON.stringify(o.radii));
    const [, rE, aE] = o.radii[2];
    for (const [n, rr, a] of o.radii) expect(Math.abs(rr / rE - sq[mode](a / aE)) < 1e-9, `${mode}: ${n}’s orbit is ${(rr / rE).toFixed(4)} × Earth’s, the real ${(a / aE).toFixed(4)} AU ratio squashed the same way should give ${sq[mode](a / aE).toFixed(4)}`);
    expect(o.moonR < 0.5 * Math.min(o.earthGapIn, o.earthGapOut), `${mode}: the Moon’s circle (${o.moonR.toFixed(2)}) is under half the gap to Venus and Mars (${o.earthGapIn.toFixed(2)}, ${o.earthGapOut.toFixed(2)})`);
    expect(o.moonR > o.earthR + o.moonSize, `${mode}: the Moon circles outside Earth’s ball: ${o.moonR.toFixed(2)} vs ${(o.earthR + o.moonSize).toFixed(2)}`);
    expect(o.closest.Venus >= o.earthR && o.closest.Mars >= o.earthR, `${mode}: in a full year the Moon stays more than one Earth radius (${o.earthR.toFixed(2)}) from Venus’s and Mars’s paths: ` + JSON.stringify(o.closest));
    expect(o.zoom > o.neptuneFar * 1.05, `${mode}: the zoom (${o.zoom}) reaches past Neptune (${o.neptuneFar.toFixed(1)})`);
  }
  // the facts the lab shows are the real distances
  const src = fs.readFileSync(path.join(ROOT, 'labs/space3d.js'), 'utf8');
  expect(/'Distance from Earth', 'about 384,400 km/.test(src) && /'Distance from the Sun now', `\$\{num\(now\.r, 3\)\} AU = \$\{big\(now\.r \* AU_KM\)\} km`/.test(src), 'the distance facts are the real ones (AU from the orbit, not the drawing)');
  // and the lab opens with them, on today's date, with no errors
  await page.evaluate(() => openLabs('space3d'));
  await page.waitForSelector('.lab-view:not([hidden])[data-lab="space3d"] .lab3d-label:not([hidden])', { timeout: 30000 });
  await page.waitForTimeout(1500);
  expect(errors.length === 0, 'page errors: ' + errors.join('; '));
  await ctx.close();
});

test('iPhone: the Solar System has no Teach me, Ask Cassie or Quiz me, Back always works, and a pinch on the 3D never zooms the page', async (b) => {
  const { ctx, page, errors } = await open(b, { server: false, device: 'iPhone 13', state: { groqKey: 'gsk_test' }, fakeGroq: (body) => {
    const u = body.messages.filter((m) => m.role === 'user').map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n');
    if (!/The things on the screen, numbered/.test(u)) return { text: 'Here is how it works.' };
    const lines = u.split('\n').filter((l) => /^\d+\. /.test(l)), n = (re) => parseInt(lines.find((l) => re.test(l)) || '0', 10);
    return { text: JSON.stringify({ steps: [{ say: 'This is the Sun.', point: n(/"Sun"/) }, { say: 'Tap To scale to see the true distances.', point: n(/To scale/) }] }) };
  } });
  const cdp = await ctx.newCDPSession(page);
  // a real two-finger pinch (fingers spreading apart), as a phone sends it
  const pinch = async (x, y) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x - 10, y, id: 1 }, { x: x + 10, y, id: 2 }] });
    for (let i = 1; i <= 12; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - 10 - i * 8, y, id: 1 }, { x: x + 10 + i * 8, y, id: 2 }] }); await page.waitForTimeout(16); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(500);
    return page.evaluate(() => visualViewport.scale);
  };
  // nothing covers a button, the page isn't zoomed or scrolled, and the tap reaches it
  const reachable = (sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return s + ' missing'; const r = e.getBoundingClientRect(), h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return e.contains(h) && visualViewport.scale === 1 && scrollY === 0 ? 'ok' : `${s} is covered by ${h && h.className} (zoom ${visualViewport.scale}, scrolled ${scrollY})`; }, sel);
  const openSpace = async () => { await page.evaluate(() => openLabs('space3d')); await page.waitForSelector('.lab-view:not([hidden])[data-lab="space3d"] .lab3d-label:not([hidden])', { timeout: 30000 }); };
  const today = '.lab-panel .lab-btn:has-text("Back to today")';
  const held = () => page.evaluate(() => /maximum-scale=1/.test(document.querySelector('meta[name=viewport]').content));
  await openSpace();
  expect(await held(), 'Labs holds the page at its normal size (no iPhone zoom into a box you type in)');
  // no Teach me, Ask Cassie or Quiz me here (they froze a real phone), and Back is always reachable
  for (const sel of ['.lab-teach', '.lab-ask', '.lab-quiz']) expect(!(await page.locator(`.lab-view:not([hidden]) ${sel}`).isVisible()), sel + ' is gone from the space lab');
  expect(await reachable('.lab-back') === 'ok', 'Back can be tapped');
  await page.locator(today).scrollIntoViewIfNeeded(); await page.locator(today).tap();
  expect(await reachable('.lab-back') === 'ok', 'Back can still be tapped after using the lab');
  // a pinch on the 3D zooms the planets, never the page; nor on the buttons or the panel
  // (where the planets' name tags sit: a zoom moves them; one tag alone may be hidden behind a nearer one)
  const sunAt = () => page.evaluate(() => [...document.querySelectorAll('.lab3d-label:not([hidden])')].map((x) => x.textContent + x.style.transform).join('|'));
  const before = await sunAt(), c = await page.locator('canvas.lab-3d').boundingBox();
  await page.waitForTimeout(800);
  expect(await pinch(c.x + c.width / 2, c.y + c.height / 2) === 1, 'a pinch on the 3D zoomed the whole page');
  await page.waitForTimeout(600);
  expect(await sunAt() !== before, 'a pinch on the 3D zooms the picture');
  for (const sel of ['.lab-head', '.lab-panel']) { const r = await page.locator(sel).boundingBox(); expect(await pinch(r.x + r.width / 2, r.y + 30) === 1, 'a pinch on ' + sel + ' zoomed the whole page'); }
  // if the page got zoomed anyway, Labs puts it back to normal
  await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2.5 });
  await page.waitForFunction(() => visualViewport.scale === 1, null, { timeout: 3000 }).catch(() => { throw new Error('a zoomed page stays zoomed in Labs'); });
  await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
  { const r = await reachable('.lab-back'); expect(r === 'ok', 'after pinching: ' + r); }
  await page.tap('.lab-back');
  await page.waitForSelector('.labs-shelf:not([hidden])', { timeout: 5000 });
  // the chat can still be zoomed for reading
  await page.tap('.labs-x');
  await page.waitForFunction(() => !document.documentElement.classList.contains('labs-open'));
  await page.waitForTimeout(500);
  expect(!(await held()), 'the chat lets go of the page size');
  expect(await pinch(195, 300) > 1.2, 'the chat can still be pinch-zoomed');
  expect(errors.length === 0, 'page errors: ' + errors.join('; '));
  await ctx.close();
});

test.slow('iPhone: every box you type in is at least 16px (smaller makes iPhones zoom the whole page), in the chat, Labs, every lab, the tutor and the 3D explorer', async (b) => {
  const { ctx, page, errors } = await open(b, { server: false, device: 'iPhone 13', scale: 1, state: { groqKey: 'gsk_test' } }); /* (1x pixels: font sizes don't change with them, and 3D at 3x is slow here) */
  expect(await page.evaluate(() => innerWidth) === 390, '390px wide');
  const small = new Set();
  const check = (where) => page.evaluate((w) => [...document.querySelectorAll('input, textarea, select')]
    .filter((e) => !/^(range|checkbox|radio|color|file|hidden|button|submit|reset|image)$/.test(e.type))
    .map((e) => [e, parseFloat(getComputedStyle(e).fontSize)]).filter(([, px]) => px < 16)
    .map(([e, px]) => `${w}: ${e.tagName.toLowerCase()}.${String(e.className).trim().replace(/\s+/g, '.') || e.name || e.type} ${px}px`), where).then((l) => l.forEach((x) => small.add(x)));
  await check('chat');
  await page.evaluate(() => openLabs(undefined, { section: 'learn' }));
  await page.waitForSelector('.labs-shelf:not([hidden]) .labs-card, .labs-shelf:not([hidden]) .lp-card', { timeout: 15000 });
  await page.click('.lp-find'); await check('Labs tab search'); await page.click('.lp-find'); // (a phone: the Labs tab's own search box)
  const ids = new Set();
  for (const sec of ['learn', 'tools', 'games']) {
    await page.evaluate((s) => openLabs(undefined, { section: s }), sec);
    await page.waitForTimeout(300);
    (await page.evaluate(() => [...document.querySelectorAll('.labs-grid [data-lab]')].map((c) => c.dataset.lab))).forEach((i) => ids.add(i));
  }
  await check('labs shelf');
  expect(ids.size > 30, 'found the labs: ' + ids.size);
  for (const id of ids) {
    const opened = await page.evaluate((x) => { openLabs(x); return true; }, id);
    if (!opened) continue;
    await page.waitForSelector(`.lab-view:not([hidden])[data-lab="${id}"] .lab-controls > *, .lab-view:not([hidden])[data-lab="${id}"] .lab-stage > *`, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(150);
    await check(id);
  }
  await page.click('.lab-teach'); // the tutor's own box
  await page.waitForSelector('.tut-ask input');
  await check('tutor');
  await page.click('.tut-x');
  await page.evaluate(() => document.querySelector('.labs .labs-x').click());
  await page.evaluate(() => openExplore('animal'));
  await page.waitForSelector('.x3d:not([hidden])', { timeout: 30000 });
  await check('3D explorer');
  expect(small.size === 0, 'boxes smaller than 16px: ' + [...small].join(' | '));
  expect(errors.length === 0, 'page errors: ' + errors.join('; '));
  await ctx.close();
});

// The "Cassie is teaching" card is resized with two fingers (pinch in smaller, out bigger), or Ctrl +
// scroll on a computer: 70% to 160%, always whole on the screen, its buttons still 44px, the page never
// zoomed, one finger still drags it, and the size is kept for next time.
test('Teach me card: pinch in and out to resize it (70% to 160%), the page never zooms, it stays on screen, buttons stay tappable, one finger still drags it, Ctrl + scroll on a computer, and the size is remembered', async (b) => {
  const { tapTargetIssues } = require('./ui-checks.cjs');
  const fakeGroq = () => ({ text: JSON.stringify({ steps: [{ say: 'Add a proton to change the element.', point: 0 }, { say: 'Now look at the mass number.', point: 0 }] }) });
  const { ctx, page, errors } = await open(b, { server: false, device: 'iPhone 13', state: { groqKey: 'gsk_test' }, fakeGroq });
  const cdp = await ctx.newCDPSession(page);
  const teach = async () => {
    await page.evaluate(() => openLabs('atom'));
    await page.waitForSelector('.lab-view:not([hidden])[data-lab="atom"] .lab-controls > *', { timeout: 20000 });
    await page.tap('.lab-teach');
    await page.waitForFunction(() => /Add a proton/.test((document.querySelector('.tut-say') || {}).textContent || ''), null, { timeout: 15000 });
    await page.waitForTimeout(300);
  };
  // the card's size: its words against today's 16px, and where it sits
  const card = () => page.evaluate(() => { const c = document.querySelector('.lab-tutor'), r = c.getBoundingClientRect(); return { k: parseFloat(getComputedStyle(c).fontSize) / 16, x: r.left, y: r.top, w: r.width, h: r.height, right: r.right, bottom: r.bottom, bar: document.querySelector('.lab-view:not([hidden]) .lab-head').getBoundingClientRect().bottom, zoom: visualViewport.scale }; });
  // two fingers on the card, from one spread to another (as a phone sends it)
  const pinch = async (from, to) => {
    const c = await card(), x = c.x + c.w / 2, y = c.y + Math.min(c.h / 2, 60);
    const pts = (d) => [{ x: x - d / 2, y, id: 1 }, { x: x + d / 2, y, id: 2 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(from) });
    for (let i = 1; i <= 10; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(from + ((to - from) * i) / 10) }); await page.waitForTimeout(16); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(400);
    return card();
  };
  const onScreen = (c, why) => {
    expect(c.zoom === 1, why + ': the page zoomed (' + c.zoom + ')');
    expect(c.x >= 0 && c.right <= 390 + 0.5 && c.y >= c.bar - 0.5 && c.bottom <= 844 + 0.5, why + ': the card is not whole on the screen below the top bar: ' + JSON.stringify(c));
  };
  // (the card's own buttons; the lab's under the card are another matter)
  const tappable = async (why) => { const bad = (await tapTargetIssues(page)).filter((x) => /^(\.\S+ > )?\S*tut-/.test(x)); expect(!bad.length, why + ': ' + bad.join(' | ')); };
  await teach();
  const c0 = await card();
  expect(Math.abs(c0.k - 1) < 0.02, 'it starts at today’s size: ' + c0.k);
  // pinch in: smaller, never below 70%
  const small = await pinch(220, 40);
  expect(small.k < c0.k - 0.05 && small.k >= 0.7 - 0.01 && small.w < c0.w, `pinching in makes it smaller (${c0.k.toFixed(2)} → ${small.k.toFixed(2)}, ${Math.round(c0.w)} → ${Math.round(small.w)}px)`);
  onScreen(small, 'small');
  await tappable('at its smallest every button is still tappable');
  // pinch out: bigger, never above 160%
  const big = await pinch(40, 300);
  expect(big.k > small.k + 0.3 && big.k <= 1.6 + 0.01, `pinching out makes it bigger (${small.k.toFixed(2)} → ${big.k.toFixed(2)})`);
  onScreen(big, 'big');
  await tappable('at its biggest every button is still tappable');
  // one finger on its top still drags it
  const head = await page.locator('.tut-head').boundingBox();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: head.x + 40, y: head.y + head.height / 2, id: 1 }] });
  for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: head.x + 40, y: head.y + head.height / 2 - i * 20, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(300);
  const dragged = await card();
  expect(dragged.y < big.y - 40 && Math.abs(dragged.k - big.k) < 0.01, `one finger drags it (top ${Math.round(big.y)} → ${Math.round(dragged.y)}) without resizing it`);
  onScreen(dragged, 'dragged');
  // kept for next time
  await page.reload();
  await teach();
  await page.waitForTimeout(300);
  const again = await card();
  expect(Math.abs(again.k - big.k) < 0.03, `the size is remembered (${big.k.toFixed(2)} → ${again.k.toFixed(2)})`);
  onScreen(again, 'after reloading');
  expect(errors.length === 0, 'page errors: ' + errors.join('; '));
  await ctx.close();
  // on a computer: Ctrl + scroll over the card does the same
  const pc = await open(b, { server: false, device: 'Desktop Chrome', state: { groqKey: 'gsk_test' }, fakeGroq });
  await pc.page.evaluate(() => { try { localStorage.removeItem('cassie.labs.tutorSize'); } catch (e) { /* none */ } });
  await pc.page.evaluate(() => openLabs('atom'));
  await pc.page.waitForSelector('.lab-view:not([hidden])[data-lab="atom"] .lab-controls > *', { timeout: 20000 });
  await pc.page.click('.lab-teach');
  await pc.page.waitForFunction(() => /Add a proton/.test((document.querySelector('.tut-say') || {}).textContent || ''), null, { timeout: 15000 });
  const size = () => pc.page.evaluate(() => { const c = document.querySelector('.lab-tutor'); return { k: parseFloat(getComputedStyle(c).fontSize) / 16, w: c.getBoundingClientRect().width, scroll: document.querySelector('.lab-view:not([hidden]) .lab-body') ? 0 : 0 }; });
  const p0 = await size(), cb = await pc.page.locator('.lab-tutor').boundingBox();
  await pc.page.mouse.move(cb.x + cb.width / 2, cb.y + 20);
  await pc.page.keyboard.down('Control');
  for (let i = 0; i < 4; i++) await pc.page.mouse.wheel(0, -120);
  await pc.page.keyboard.up('Control');
  await pc.page.waitForTimeout(300);
  const p1 = await size();
  expect(p1.k > p0.k + 0.2 && p1.w > p0.w && p1.k <= 1.6 + 0.01, `Ctrl + scroll makes it bigger on a computer (${p0.k.toFixed(2)} → ${p1.k.toFixed(2)}, ${Math.round(p0.w)} → ${Math.round(p1.w)}px)`);
  await pc.page.mouse.wheel(0, 120); // (a scroll without Ctrl doesn't resize it)
  await pc.page.waitForTimeout(200);
  expect(Math.abs((await size()).k - p1.k) < 0.01, 'a plain scroll does not resize it');
  expect(pc.errors.length === 0, 'page errors: ' + pc.errors.join('; '));
  await pc.ctx.close();
});

test('Ask Cassie and Quiz me stay inside the lab: a question and a 2-question quiz in Build an atom and the Body System (none in the space labs), and the chat never shows', async (b) => {
  const asked = [], bodies = [];
  const { ctx, page, errors } = await open(b, { server: false, device: 'Desktop Chrome', state: { groqKey: 'gsk_test' }, fakeGroq: (body) => {
    const u = body.messages.filter((m) => m.role === 'user').map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n');
    asked.push(u); bodies.push(body);
    if (/multiple-choice quiz about/.test(u)) return { text: JSON.stringify([
      { q: 'Which planet is the biggest?', o: ['Mars', 'Jupiter', 'Venus', 'Mercury'], a: 1, why: 'Jupiter is more than 300 times as massive as Earth.' },
      { q: 'Which planet is closest to the Sun?', o: ['Mercury', 'Earth', 'Neptune', 'Saturn'], a: 0, why: 'Mercury orbits closest to the Sun.' },
    ]) };
    if (/what about its moons/i.test(u)) return { text: 'Jupiter has **95 known moons**.' };
    return { text: 'You are looking at Jupiter, the biggest planet.' };
  } });
  // anything that sends the student to the chat is a failure
  await page.evaluate(() => {
    window.__wentToChat = [];
    new MutationObserver(() => { const l = document.querySelector('.labs'); if (l && l.hidden && document.documentElement.classList.contains('watch-labs')) window.__wentToChat.push('Labs closed'); }).observe(document.body, { attributes: true, subtree: true, attributeFilter: ['hidden'] });
  });
  const chatBubbles = () => page.locator('#chat-log .bubble').count();
  const before = await chatBubbles();
  // the 3D space labs have no Ask Cassie or Quiz me (they froze a real phone there)
  await page.evaluate(() => openLabs('space3d'));
  await page.waitForSelector('.lab-view:not([hidden])[data-lab="space3d"] .lab3d-label:not([hidden])', { timeout: 30000 });
  expect(!(await page.locator('.lab-view:not([hidden]) .lab-ask').isVisible()) && !(await page.locator('.lab-view:not([hidden]) .lab-quiz').isVisible()), 'no Ask Cassie or Quiz me in the Solar System');
  await page.click('.lab-back');
  await page.waitForSelector('.labs-shelf:not([hidden])');
  // Build an atom: make carbon-14, then ask
  await page.evaluate(() => openLabs('atom'));
  await page.waitForSelector('.lab-view:not([hidden])[data-lab="atom"] .lab-controls > *', { timeout: 30000 });
  await page.evaluate(() => document.documentElement.classList.add('watch-labs'));
  await page.click('.lab-view:not([hidden]) button:has-text("Carbon-14")');
  await page.click('.lab-ask');
  await page.waitForSelector('.lab-helper:not([hidden]) .hp-a >> text=biggest planet', { timeout: 15000 });
  expect(/the Build an atom lab in Cassie\. What's on my screen right now: .*carbon/is.test(asked.at(-1)), 'Cassie sees the screen: ' + asked.at(-1).slice(0, 300));
  expect(await page.locator('.lab-ask[aria-pressed="true"]').count() === 1, 'Ask Cassie shows as on');
  // a follow-up typed in the panel (she remembers the talk), and the answer can be read out loud
  await page.fill('.lab-helper .hp-ask input', 'what about its moons?');
  await page.press('.lab-helper .hp-ask input', 'Enter');
  await page.waitForSelector('.lab-helper .hp-a >> text=95 known moons', { timeout: 15000 });
  expect(bodies.at(-1).messages.some((m) => m.role === 'assistant' && /You are looking at Jupiter/.test(m.content)), 'the follow-up carries the talk so far');
  expect(await page.locator('.lab-helper .hp-a strong, .lab-helper .hp-a b').count() >= 1, 'her answer is formatted like the chat');
  expect(await page.locator('.lab-helper .hp-a .hp-listen').count() === 2, 'every answer has Listen');
  const stats = () => page.locator('.lab-view:not([hidden]) .lab-stats').innerText();
  const atomBefore = await stats();
  // Quiz me: two questions, one at a time, then the score
  await page.click('.lab-quiz');
  await page.waitForFunction(() => (document.querySelector('.lab-helper:not([hidden]) .hp-title') || {}).textContent === 'Quiz me');
  await page.waitForSelector('.lab-helper .hp-q >> text=Which planet is the biggest?', { timeout: 15000 });
  expect(/multiple-choice quiz about "atomic structure/.test(asked.at(-1)), 'the quiz is about the lab’s topic');
  expect(await page.locator('.lab-helper .hp-qn').innerText().then((t) => /Question 1 of 2/i.test(t)), 'question 1 of 2');
  await page.click('.lab-helper .hp-opt:has-text("Jupiter")');
  await page.waitForSelector('.lab-helper .hp-why >> text=Right!');
  await page.click('.lab-helper .hp-next');
  await page.waitForSelector('.lab-helper .hp-q >> text=closest to the Sun');
  await page.click('.lab-helper .hp-opt:has-text("Earth")');
  await page.waitForSelector('.lab-helper .hp-why >> text=Not quite. The answer is Mercury.');
  await page.click('.lab-helper .hp-next:has-text("See my score")');
  await page.waitForSelector('.lab-helper .hp-score >> text=1 of 2');
  const missed = await page.evaluate(() => (JSON.parse(localStorage.getItem('cassie.v2')).mistakes || []).map((m) => m.q));
  expect(missed.includes('Which planet is closest to the Sun?') && !missed.includes('Which planet is the biggest?'), 'the missed question is kept for Review my mistakes: ' + missed.join(' | '));
  // closing goes back to exactly where the student was
  await page.click('.lab-helper .hp-x');
  expect(await page.locator('.lab-helper:not([hidden])').count() === 0 && (await stats()) === atomBefore && /carbon/i.test(atomBefore), 'back to the lab as it was: ' + atomBefore.replace(/\s+/g, ' ').slice(0, 120));
  await page.click('.lab-back');
  await page.waitForSelector('.labs-shelf:not([hidden])');
  await page.evaluate(() => document.documentElement.classList.remove('watch-labs'));
  // the Body System: ask about what's on screen, then find the heart and take its quiz
  await openCard(page, '.labs-grid [data-lab="body3d"]');
  await page.waitForSelector('.x3d:not([hidden])', { timeout: 30000 });
  await page.waitForSelector('.labs', { state: 'hidden' });
  await page.click('[data-tool="ask"]');
  await seen(page, '.x3d .lab-helper:not([hidden]) .hp-a');
  expect(/the 3D human body in Cassie\. What's on my screen right now: looking at the human body/.test(asked.at(-1)), 'Cassie sees the body view: ' + asked.at(-1).slice(0, 300));
  await page.fill('.x3d-search', 'heart');
  await page.waitForSelector('.x3d-results:not([hidden]) button', { timeout: 20000 });
  await page.click('.x3d-results button >> nth=0');
  await page.waitForFunction(() => /Heart/.test(document.querySelector('.x3d-sheet h3').textContent), null, { timeout: 10000 });
  await page.click('.x3d-act[data-act="quiz"]');
  await seen(page, '.x3d .lab-helper .hp-q', 'Which planet is the biggest?');
  expect(/multiple-choice quiz about "the circulatory/i.test(asked.at(-1)), 'the quiz is about the heart’s system: ' + asked.at(-1).slice(0, 200));
  await page.click('.x3d .lab-helper .hp-opt:has-text("Jupiter")');
  await page.click('.x3d .lab-helper .hp-next');
  await page.click('.x3d .lab-helper .hp-opt:has-text("Mercury")');
  await page.click('.x3d .lab-helper .hp-next:has-text("See my score")');
  await seen(page, '.x3d .lab-helper .hp-score', '2 of 2');
  await page.click('.x3d .lab-helper .hp-x');
  expect(await page.locator('.x3d').isVisible() && /Heart/.test(await page.locator('.x3d-sheet h3').innerText()), 'the body view is as it was');
  // the chat never showed
  expect(await chatBubbles() === before, 'nothing was sent to the chat');
  expect((await page.evaluate(() => window.__wentToChat)).length === 0, 'Labs never closed for the chat');
  expect(await page.locator('#quiz-btn.active').count() === 0, 'the chat quiz never started');
  expect(errors.length === 0, 'page errors: ' + errors.join('; '));
  await ctx.close();
});

test('Teach me card: "where is the heart", made small, the heart still tappable, dragged, closed and carried on from the same step (no new question to Cassie)', async (b) => {
  const asked = [];
  const { ctx, page, errors } = await open(b, { server: false, device: 'iPhone 13', state: { groqKey: 'gsk_test' }, fakeGroq: (body) => {
    const u = body.messages.filter((m) => m.role === 'user').map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n');
    if (!/The things on the screen, numbered/.test(u)) return { text: 'ok' };
    asked.push(u);
    const num = (re) => { const line = u.split('\n').find((l) => /^\d+\. /.test(l) && re.test(l)); return line ? parseInt(line, 10) : 0; };
    if (/The student says: "where is the heart/.test(u)) return { text: JSON.stringify({ steps: [
      { say: 'The heart is part of the circulatory system. Tap Circulatory to show it.', point: num(/"Circulatory/) },
      { say: 'Now type heart in the Find a part box.', point: num(/Find a part/) },
      { say: 'It sits in the middle of your chest, tipped a little to the left.', point: 0 },
    ] }) };
    return { text: JSON.stringify({ steps: [{ say: 'Welcome! Pick Boy or Girl here.', point: num(/"Girl"/) }] }) };
  } });
  await page.evaluate(() => openExplore('body'));
  await page.waitForSelector('.x3d:not([hidden])', { timeout: 30000 });
  await seen(page, '.x3d', 'parts showing', 60000);
  await page.tap('[data-tool="teach"]');
  await seen(page, '.tut-say', 'Pick Boy or Girl');
  await page.fill('.tut-ask input', 'where is the heart?');
  await page.press('.tut-ask input', 'Enter');
  await seen(page, '.tut-say', 'Tap Circulatory');
  expect(asked.length === 2, 'two questions to Cassie so far: ' + asked.length);
  const target = page.locator('.tut-pointed');
  expect(/Circulatory/.test(await target.innerText()), 'she points at the Circulatory switch: ' + await target.innerText());
  // the card moves off what she points at
  await page.waitForFunction(() => { const a = document.querySelector('.lab-tutor').getBoundingClientRect(), t = document.querySelector('.tut-pointed').getBoundingClientRect(); return !(a.left < t.right && a.right > t.left && a.top < t.bottom && a.bottom > t.top); }, null, { timeout: 8000, polling: 250 })
    .catch(() => { throw new Error('the card is still on top of what she points at'); });
  // made small: a pill with the step, and she keeps pointing
  await page.tap('.tut-min');
  await seen(page, '.tut-pill', 'Step 1 of 3');
  if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/tutor-pill.png' });
  expect(await page.locator('.lab-tutor.tut-mini').count() === 1 && await page.locator('.tut-say').isHidden(), 'the card is a small pill');
  expect(await page.locator('.tut-finger:not([hidden])').count() === 1 && await page.locator('.tut-pointed').count() === 1, 'she still points at it');
  const reach = await page.evaluate(() => { const t = document.querySelector('.tut-pointed'), r = t.getBoundingClientRect(), h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return r.width > 0 && r.bottom > 0 && r.top < innerHeight && t.contains(h); });
  expect(reach, 'the heart’s switch is on screen and nothing covers it');
  await target.tap();
  await seen(page, '.tut-pill', 'Step 2 of 3'); // (tapping it is the step: she goes on, still small)
  expect(await page.locator('.x3d-sys[aria-pressed="true"]:has-text("Circulatory")').count() === 1, 'the tap reached the switch: the circulatory system is on');
  // the pill can be dragged, and stays on the screen
  let pb = await page.locator('.tut-pill').boundingBox();
  await page.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2); await page.mouse.down();
  await page.mouse.move(pb.x + 30, -400, { steps: 6 }); await page.mouse.up();
  pb = await page.locator('.lab-tutor').boundingBox();
  // as high as it goes: just under the top bar (over it, the top bar's buttons couldn't be tapped)
  const barBottom = await page.evaluate(() => document.querySelector('.x3d:not([hidden]) .x3d-top').getBoundingClientRect().bottom);
  expect(pb.y >= barBottom && pb.y < barBottom + 20, 'dragged to the top: kept on the screen, just under the top bar (' + Math.round(barBottom) + '): ' + JSON.stringify(pb));
  expect(await page.locator('.lab-tutor.tut-mini').count() === 1, 'a drag does not open it');
  // a tap opens it again where it is; its top drags it too
  await page.tap('.tut-pill');
  await seen(page, '.tut-say', 'type heart');
  expect(/2 of 3/.test(await page.locator('.tut-step').innerText()), 'step 2 of 3');
  const hb = await page.locator('.tut-head .tut-who').boundingBox();
  await page.mouse.move(hb.x + 10, hb.y + 10); await page.mouse.down();
  await page.mouse.move(hb.x + 10, hb.y + 260, { steps: 6 }); await page.mouse.up();
  const cb = await page.locator('.lab-tutor').boundingBox();
  expect(cb.y > hb.y + 150 && cb.y + cb.height <= 844 && cb.x >= 0 && cb.x + cb.width <= 390, 'dragged by its top, inside the screen: ' + JSON.stringify(cb));
  // closed, then Teach me again: carry on from step 2, without asking Cassie again
  await page.tap('.tut-x');
  expect(await page.locator('.lab-tutor').count() === 0, 'closed');
  await page.tap('[data-tool="teach"]');
  await seen(page, '.tut-continue', 'Continue from step 2');
  if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/tutor-resume.png' });
  expect(await page.locator('.tut-restart').isVisible(), 'or start over');
  expect(await page.locator('.tut-nav').isHidden(), 'no Back and Next before choosing');
  await page.tap('.tut-continue');
  await seen(page, '.tut-say', 'type heart');
  expect(/2 of 3/.test(await page.locator('.tut-step').innerText()), 'back at step 2 of 3');
  expect(/Find a part/.test(await page.evaluate(() => (document.querySelector('.tut-pointed') || {}).placeholder || '')), 'and pointing at the Find a part box again');
  expect(asked.length === 2, 'no new question to Cassie: ' + asked.length);
  // start over: step 1, still no new question
  await page.tap('.tut-x');
  await page.tap('[data-tool="teach"]');
  await page.tap('.tut-restart');
  await seen(page, '.tut-step', '1 of 3');
  expect(asked.length === 2, 'start over replays the lesson');
  expect(errors.length === 0, 'page errors: ' + errors.join('; '));
  await ctx.close();
});

test('Accuracy: the labs’ numbers match the textbook (launch range, gravity, light, pH, balancing, rocket, interest, eclipses) and the audited facts stay fixed', async (b) => {
  const { ctx, page, errors } = await open(b, { server: false, device: 'Desktop Chrome', state: { groqKey: 'gsk_test' } });
  const lab = async (id) => { await page.evaluate((x) => openLabs(x), id); await page.waitForSelector(`.lab-view:not([hidden])[data-lab="${id}"] .lab-controls > *`, { timeout: 20000 }); };
  const state = () => page.evaluate(() => labsMod.open({}).state);
  const slide = (label, v) => page.evaluate(([l, val]) => { const s = [...document.querySelectorAll('.lab-panel .lab-sl')].find((x) => x.textContent.includes(l)); const i = s.querySelector('input[type=range]'); i.value = val; i.dispatchEvent(new Event('input', { bubbles: true })); }, [label, v]);
  const numIn = (text, re) => { const m = re.exec(text); if (!m) throw new Error('not found ' + re + ' in ' + text); return parseFloat(m[1]); };
  const near = (got, want, tol, what) => expect(Math.abs(got - want) <= tol, `${what}: got ${got}, the textbook gives ${want.toFixed(3)}`);
  // the launch lab: gravity at Earth's surface is 9.81 m/s², and range = v² sin 2θ / g, height = (v sinθ)² / 2g, time = 2v sinθ / g
  await lab('projectile');
  for (const [ang, v] of [[45, 20], [30, 15], [60, 25]]) {
    await slide('Angle', ang); await slide('Speed', v);
    const st = await state(), g = numIn(st, /g = ([\d.]+) m\/s²/), t = (ang * Math.PI) / 180;
    expect(g === 9.81, 'gravity at Earth’s surface is 9.81 m/s²: ' + g);
    near(numIn(st, /flies ([\d.]+) m/), (v * v * Math.sin(2 * t)) / g, 0.06, `range at ${ang}° and ${v} m/s`);
    near(numIn(st, /rises to ([\d.]+) m/), (v * Math.sin(t)) ** 2 / (2 * g), 0.06, `height at ${ang}°`);
    near(numIn(st, /air for ([\d.]+) s/), (2 * v * Math.sin(t)) / g, 0.01, `time in the air at ${ang}°`);
  }
  // the pendulum: the small-swing period 2π√(L/g)
  await lab('pendulum'); await slide('Length', 1);
  near(numIn(await state(), /gives ([\d.]+) s/), 2 * Math.PI * Math.sqrt(1 / 9.81), 0.006, 'pendulum period for 1 m');
  // bending light: Snell's law, air to water at 30°
  await lab('refraction'); await slide('Angle from the normal', 30);
  near(numIn(await state(), /bends to ([\d.]+)°/), (Math.asin(Math.sin(Math.PI / 6) / 1.33) * 180) / Math.PI, 0.06, 'air to water at 30°');
  // pH: 10 mL of 0.1 M HCl in 50 mL of water, then neutralised with 10 mL of 0.1 M NaOH
  await lab('ph');
  const press = (label, nth) => page.evaluate(([l, n]) => [...document.querySelectorAll('.lab-panel button')].filter((x) => x.textContent.trim() === l)[n].click(), [label, nth]);
  await press('+ 10 mL', 0);
  near(numIn(await state(), /pH ([\d.]+)/), -Math.log10(0.001 / 0.06), 0.006, 'pH of the acid');
  await press('+ 10 mL', 1);
  near(numIn(await state(), /pH ([\d.]+)/), 7, 0.001, 'neutral');
  // the balancer, the rocket equation, compound interest and the next eclipses (the labs' own code)
  const calc = await page.evaluate(async () => {
    const chem = await import('./labs/chemistry.js'), sp = await import('./labs/space.js');
    const J2000 = Date.UTC(2000, 0, 1, 12), d = (Date.UTC(2026, 0, 1) - J2000) / 864e5, iso = (x) => new Date(J2000 + x * 864e5).toISOString().slice(0, 10);
    const s1 = sp.nextEclipse(d, 'solar'), s2 = sp.nextEclipse(s1 + 1, 'solar'), l1 = sp.nextEclipse(d, 'lunar');
    return { kmno4: chem.balance(chem.parseEquation('KMnO4 + HCl -> KCl + MnCl2 + H2O + Cl2')).join(','), photo: chem.balance(chem.parseEquation('CO2 + H2O -> C6H12O6 + O2')).join(','), solar: [iso(s1), iso(s2)], lunar: iso(l1), moons: Object.fromEntries(sp.PLANETS.map((p) => [p[0], p[8]])), year: sp.periodDays(sp.PLANETS[2]) };
  });
  expect(calc.kmno4 === '2,16,2,2,8,5' && calc.photo === '6,6,1,6', 'equations balance: ' + calc.kmno4 + ' / ' + calc.photo);
  expect(calc.solar[0] === '2026-02-17' && calc.solar[1] === '2026-08-12' && calc.lunar === '2026-03-03', 'the 2026 eclipses: ' + JSON.stringify(calc));
  near(calc.year, 365.256, 0.01, 'Earth’s year in days');
  expect(calc.moons.Jupiter === 101 && calc.moons.Saturn === 285 && calc.moons.Uranus === 29 && calc.moons.Neptune === 16, 'moon counts as of 2026: ' + JSON.stringify(calc.moons));
  await lab('rocket');
  const r = await state();
  near(numIn(r, /Δv ([\d.]+) km\/s/), (311 * 9.80665 * Math.log(12 / 2)) / 1000, 0.006, 'rocket Δv = Isp × g₀ × ln(full ÷ empty)');
  near(numIn(r, /thrust ÷ weight ([\d.]+)/), 100000 / (12000 * 9.81), 0.006, 'thrust ÷ weight');
  await lab('interest');
  near(numIn((await state()).replace(/,/g, ''), /compound at ₱([\d.]+)/), 10000 * 1.005 ** 240, 1, 'compound interest ₱10,000 at 6% monthly for 20 years');
  // the audited facts (docs/accuracy-audit.md) stay fixed
  const facts = await page.evaluate(async () => {
    const get = (u) => fetch(u).then((x) => x.text());
    const [space3d, body, museum, cells] = await Promise.all(['./labs/space3d.js', './explore/body-facts.js', './labs/museum.js', './explore/cells.js'].map(get));
    const ph = (await (await fetch('./labs/atlas/countries.json')).json()).find((c) => c.c3 === 'PHL');
    return { space3d, body, museum, cells, ph };
  });
  expect(!/Everything you can see in the night sky/.test(facts.space3d) && /about 50% within 10 billion years/.test(facts.space3d) && /Galileo saw it in 1612/.test(facts.space3d) && /observations in 2017/.test(facts.space3d), 'the space facts are the corrected ones');
  expect(/one of the most commonly broken bones/.test(facts.body) && /about 480 million in both/.test(facts.body) && /may hold a store of helpful gut bacteria/.test(facts.body), 'the body facts are the corrected ones');
  expect(/standing on scaffolding/.test(facts.museum) && !/lying on scaffolding/.test(facts.museum), 'Michelangelo painted standing');
  expect(/Lysosomes are mainly in animal cells/.test(facts.cells), 'lysosomes: mainly in animal cells');
  expect(facts.ph.pop[0] === 112729484 && facts.ph.pop[1] === 2024 && /PSA/.test(facts.ph.pop[2]) && facts.ph.area === 300000, 'the Philippines: PSA 2024 census and 300,000 km²');
  expect(errors.length === 0, 'page errors: ' + errors.join('; '));
  await ctx.close();
});

test('Games button: the top bar on a computer and a Games tab on phones open Labs straight on the games', async (b) => {
  let { ctx, page } = await open(b, { server: false, device: 'Desktop Chrome', state: { groqKey: 'gsk_test' } });
  await page.click('#games-btn');
  await page.waitForSelector('.labs.games-mode:not([hidden]) .labs-title >> text=Games', { timeout: 10000 });
  await page.evaluate(() => openLabs('atom'));
  await page.waitForSelector('.lab-view:not([hidden])[data-lab="atom"]', { timeout: 15000 });
  await page.evaluate(() => openLabs(undefined, { section: 'games' }));
  await page.waitForSelector('.labs.games-mode .labs-shelf:not([hidden])', { timeout: 10000 });
  await ctx.close();
  ({ ctx, page } = await open(b, { server: false, state: { groqKey: 'gsk_test' } }));
  await page.click('.tabbar [data-tab="games"]');
  await page.waitForSelector('.labs.games-mode:not([hidden]) .labs-title >> text=Games', { timeout: 10000 });
  await page.waitForSelector('.tabbar [data-tab="games"].on', { timeout: 5000 });
  await page.click('.tabbar [data-tab="labs"]');
  await page.waitForSelector('.labs:not(.games-mode):not([hidden]) .lp:not([hidden]) .lp-card', { timeout: 10000 }); // (a phone: the Labs tab)
  expect(await page.locator('.labs-tabs [data-section="games"]:visible').count() === 0, 'no Games shelf inside Labs');
  await page.waitForSelector('.tabbar [data-tab="labs"].on', { timeout: 5000 });
  await ctx.close();
});

test('Museum and games: famous paintings, a logic circuit, cracking a rule / regex / compound, a pinning blitz, the fraction diner, the city market', async (b) => {
  const { ctx, page, errors } = await open(b, { server: false, device: 'Desktop Chrome', state: { groqKey: 'gsk_test' } });
  await ctx.route(/wikipedia\.org/, (r) => r.abort());
  const lab = async (id) => { await page.evaluate((x) => openLabs(x), id); await page.waitForSelector(`.lab-view:not([hidden])[data-lab="${id}"] .lab-controls > *`, { timeout: 15000 }); };
  const btn = (t) => page.click(`.lab-panel .lab-btn:has-text("${t}")`);
  // Museum: Filipino and world galleries, a work's story, and "Who painted it?"
  await lab('museum');
  expect(await page.locator('.tl-work').count() === 35, '35 works');
  await page.click('.lab-panel .lab-seg button:has-text("Filipino artists")');
  expect(await page.locator('.tl-work').count() === 13, '13 by Filipino artists');
  await page.click('[data-open="spoliarium"]');
  const facts = await page.locator('.tl-facts').innerText();
  expect(/Juan Luna/.test(facts) && /1884/.test(facts) && /National Museum/.test(facts), 'Spoliarium’s facts: ' + facts);
  await page.click('[data-close]');
  await btn('Play “Who painted it?”');
  for (let k = 0; k < 8; k++) { await page.locator('[data-guess]').first().click(); await page.click('[data-next]'); }
  await page.waitForSelector('.tl-empty >> text=/of 8 right/');
  // Logic Circuit: switches change the gates; tapping turns a tile
  await lab('circuit');
  const sw = page.locator('.gm-sw').first(), was = await sw.getAttribute('aria-pressed');
  await sw.click();
  expect((await page.locator('.gm-sw').first().getAttribute('aria-pressed')) !== was, 'a switch flips');
  const cb = await page.locator('.lab-stage canvas').boundingBox();
  await page.mouse.click(cb.x + cb.width / 2, cb.y + cb.height / 2 + 30);
  await page.waitForFunction(() => /Turns\s*1/.test(document.querySelector('.lab-stats').textContent));
  await page.click('.lab-panel .lab-seg button:has-text("Hard")');
  expect(await page.locator('.gm-x output').count() === 1, 'Hard adds the number x');
  // Formula Cracker: a rule, a regex and a compound
  await lab('cracker');
  await page.fill('.gm-guess input', 'x'); await page.click('.gm-guess button');
  expect(await page.locator('.gm-guesses tr').count() === 2, 'a guess row');
  await page.click('.lab-panel .lab-seg button:has-text("Regex pattern")');
  await page.fill('.gm-guess input', '^a'); await page.click('.gm-guess button');
  expect(await page.locator('.gm-guesses td.gm-g, .gm-guesses td.gm-bad').count() >= 6, 'each string is marked right or wrong for the guess');
  await page.click('.lab-panel .lab-seg button:has-text("Chemical compound")');
  await page.fill('.gm-guess input', 'Xq2'); await page.click('.gm-guess button');
  await page.waitForSelector('.lab-panel .gm-msg >> text=isn’t an element');
  await page.fill('.gm-guess input', 'H2O'); await page.click('.gm-guess button');
  await page.waitForSelector('.gm-row .gm-tile');
  // Pinning Blitz on the cell: find the parts by tapping them
  await lab('blitz');
  await page.click('.lab-panel .lab-seg button:has-text("Animal cell")');
  await btn('Start (60 s)');
  const CENTRES = { Nucleolus: [495, 318], Nucleus: [420, 330], Mitochondrion: [255, 215], 'Golgi apparatus': [735, 400], 'Rough ER': [641, 330], 'Smooth ER': [297, 496], Lysosome: [395, 585], Centrioles: [608, 158], Vacuole: [175, 400], 'Cell membrane': [500, 32] };
  for (let k = 0; k < 4; k++) {
    const name = await page.locator('.gm-label').innerText();
    const box = await page.locator('.lab-stage canvas').boundingBox(), kk = Math.min((box.width - 20) / 1000, (box.height - 80) / 700), ox = (box.width - 1000 * kk) / 2, oy = 66 + (box.height - 76 - 700 * kk) / 2;
    const [ux, uy] = CENTRES[name];
    await page.mouse.click(box.x + ox + ux * kk, box.y + oy + uy * kk);
    await page.waitForFunction((n) => +((document.querySelector('.lab-stats').textContent.match(/Right\s*(\d+)/) || [])[1]) === n, k + 1, { timeout: 3000 });
    await page.waitForTimeout(350);
  }
  expect(/combo ×4/.test(await page.locator('.gm-bar').innerText()), 'a combo of 4');
  // Fraction Diner: serve the first order right
  await lab('diner');
  await btn('Start a shift');
  const q = await page.locator('.gm-order .gm-q').innerText();
  if (/of a pizza/.test(q)) {
    const [, n, d] = q.match(/(\d+)\/(\d+) of a pizza/).map(Number);
    for (let g = 0; g < 20 && +(await page.locator('.gm-ctl > b').first().innerText()) !== d; g++) await page.click(`[data-sl="${+(await page.locator('.gm-ctl > b').first().innerText()) < d ? 1 : -1}"]`);
    const box = await page.locator('.lab-stage canvas').boundingBox(), top = 150, cx = box.width / 2, cy = top + (box.height - top) / 2, R = Math.max(30, Math.min(box.width * 0.4, (box.height - top) * 0.42));
    for (let k = 0; k < n; k++) { const a = -Math.PI / 2 + ((k + 0.5) / d) * Math.PI * 2; await page.mouse.click(box.x + cx + Math.cos(a) * R * 0.6, box.y + cy + Math.sin(a) * R * 0.6); }
  } else if (/calamansi/.test(q)) {
    const [, total, a, bb] = q.match(/(\d+) mL of calamansi juice: (\d+) parts? syrup to (\d+) parts water/).map(Number), unit = total / (a + bb);
    await page.evaluate(([s1, w1]) => { const [rs, rw] = document.querySelectorAll('.gm-pour input[type=range]'); rs.value = s1; rs.dispatchEvent(new Event('input', { bubbles: true })); rw.value = w1; rw.dispatchEvent(new Event('input', { bubbles: true })); }, [a * unit, bb * unit]);
  } else {
    const [, from, to] = (await page.locator('.gm-recipe tr').first().innerText()).match(/For (\d+)\s+For (\d+)/).map(Number);
    const amounts = await page.$$eval('.gm-recipe tr td:nth-child(2)', (t) => t.map((x) => x.textContent));
    const inputs = page.locator('.gm-recipe input');
    for (let k = 0; k < amounts.length; k++) { const s2 = amounts[k].trim().split(' '); const v = s2.reduce((sum, p) => sum + (p.includes('/') ? +p.split('/')[0] / +p.split('/')[1] : +p), 0); await inputs.nth(k).fill(String(+(v * to / from).toFixed(6))); }
  }
  await page.click('[data-serve]');
  await page.waitForSelector('.lab-panel .gm-msg.good >> text=tip', { timeout: 3000 });
  // City Market: a month passes and the market explains itself
  await lab('economy');
  await btn('Run the month');
  expect(/Month 2 of 12/.test(await page.locator('.gm-market .gm-bar').innerText()), 'month 2');
  expect(/Balanced|Surplus|Shortage/.test(await page.locator('.lab-panel .gm-msg').innerText()), 'it explains what happened');
  if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/game-market.png' });
  expect(errors.length === 0, 'page errors: ' + errors.join('; '));
  await ctx.close();
});

test('Labs 3D: the atom’s particle tray stays still when the view turns, and zoom goes where you point', async (b) => {
  const { ctx, page, errors } = await open(b, { server: false, device: 'Desktop Chrome' });
  await page.goto(APP + '?lab=atom');
  await page.waitForSelector('.lab-view:not([hidden])[data-lab="atom"] canvas.lab-3d', { timeout: 30000 });
  await page.waitForTimeout(1500);
  const box = await page.locator('.lab-stage').boundingBox();
  // turn the view
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.8); await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.6, { steps: 10 }); await page.mouse.up();
  await page.waitForTimeout(800);
  // zoom in with the wheel over a spot off the middle: the point under the pointer stays under it
  const px = box.x + box.width * 0.3, py = box.y + box.height * 0.35;
  const under = await page.evaluate(([x, y]) => { const c = document.querySelector('.lab-stage canvas:not(.lab-3d)'); const p = c._at({ clientX: x, clientY: y }); return [p.x, p.y]; }, [px, py]);
  await page.mouse.move(px, py);
  for (let i = 0; i < 5; i++) { await page.mouse.wheel(0, -200); await page.waitForTimeout(60); }
  await page.waitForTimeout(1200);
  const now = await page.evaluate(([x, y]) => document.querySelector('.lab-stage canvas:not(.lab-3d)')._toScreen(x, y), under);
  expect(Math.hypot(now.x - px, now.y - py) < 30, 'zoom keeps the pointed-at spot under the pointer: ' + JSON.stringify([now, px, py]));
  // the tray is still in the bottom-left corner of the screen: drag a neutron from it into the nucleus
  const nuc = await page.evaluate(() => { const c = document.querySelector('.lab-stage canvas:not(.lab-3d)'), r = c.getBoundingClientRect(); return c._toScreen(r.width * 0.42, r.height / 2); });
  await page.mouse.move(box.x + 24, box.y + box.height - 76 + 28); await page.mouse.down();
  await page.mouse.move(nuc.x, nuc.y, { steps: 10 }); await page.mouse.up();
  await page.waitForFunction(() => /carbon-13/.test(document.querySelector('.lab-stats').textContent), null, { timeout: 3000 });
  expect(errors.length === 0, 'page errors: ' + errors.join('; '));
  await ctx.close();
});

test.slow('Labs 3D and atlas: fly to Jupiter and out to Andromeda, launch a 3D rocket, look up Japan and a place; pour, drag particles and disks', async (b) => {
  const { ctx, page, errors } = await open(b, { scale: 1, server: false, state: { groqKey: 'gsk_test' }, device: process.env.DEVICE || 'Pixel 7' });
  const shot = (n) => process.env.SHOTS && page.screenshot({ path: process.env.SHOTS + '/' + n + '.png' });
  // space: the planets, then the Local Group (the real maps and stars arrive, and every shader compiles)
  const tex = new Set(), shaderErr = [];
  page.on('response', (r) => { if (/\/labs\/tex\//.test(r.url()) && r.ok()) tex.add(r.url().split('/').pop()); });
  page.on('console', (m) => { if (/Shader Error|WebGLProgram/.test(m.text())) shaderErr.push(m.text().slice(0, 200)); });
  await page.goto(APP + '?lab=space3d');
  await page.waitForSelector('.lab3d-label:not([hidden])', { timeout: 30000 });
  await page.locator('.lab3d-label:not([hidden]):text-is("Jupiter")').click({ force: true });
  await page.waitForSelector('.space-card h3:text-is("Jupiter")');
  expect(/Distance from Earth now/.test(await page.locator('.space-card').innerText()) && /101 known \(as of 2026\)/.test(await page.locator('.space-card').innerText()), 'Jupiter’s card has live distances and its moons (the 2026 count)');
  await page.waitForTimeout(1200); await shot('space-jupiter');
  for (let i = 0; i < 40 && tex.size < 15; i++) await page.waitForTimeout(250);
  expect(['earth-day.webp', 'earth-night.webp', 'earth-clouds.webp', 'jupiter.webp', 'saturn-ring.png', 'stars.bin', 'mercury-bump.webp'].every((f) => tex.has(f)), 'the planets’ real maps and the star sky load: ' + [...tex].join(', '));
  expect(shaderErr.length === 0, 'the planet shaders compile: ' + shaderErr.join(' | '));
  await page.click('.lab-seg button:has-text("Local Group")');
  await page.locator('.lab3d-label:not([hidden]):has-text("Andromeda")').click({ force: true });
  await page.waitForSelector('.space-card h3:has-text("Andromeda")');
  expect(await page.locator('.lab-tries li.done').count() === 2, 'Jupiter and Andromeda goals ticked');
  await page.waitForTimeout(1200); await shot('space-andromeda');
  // the rocket in 3D: launch it
  await page.goto(APP + '?lab=rocket');
  await page.waitForSelector('canvas.lab-3d', { timeout: 30000 });
  await page.locator('.lab-sl:has-text("First-stage thrust") input').fill('400');
  await page.click('.lab-overlay .lab-btn:has-text("Launch")');
  await page.waitForFunction(() => /Height now/.test(document.querySelector('.lab-stats').textContent), null, { timeout: 8000 });
  await page.waitForTimeout(2500); await shot('rocket-3d-flying');
  expect(/done/.test(await page.locator('.lab-tries li').first().getAttribute('class')), 'lift-off ticks the first goal');
  // the atlas: Japan (with the newest population from the World Bank) and a place from Wikipedia
  await ctx.route(/en\.wikipedia\.org\/api\/rest_v1\/page\/summary\/History_of_Japan/, (r) => r.fulfill({ json: { type: 'standard', title: 'History of Japan', extract: 'People first lived in Japan about 38,000 years ago.', content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/History_of_Japan' } } } }));
  await ctx.route(/en\.wikipedia\.org\/w\/api\.php/, (r) => r.fulfill({ json: { query: { search: [{ title: 'Mount Apo' }] } } }));
  await ctx.route(/en\.wikipedia\.org\/api\/rest_v1\/page\/summary\/Mount_Apo$/, (r) => r.fulfill({ json: { type: 'standard', title: 'Mount Apo', description: 'Volcano in the Philippines', extract: 'Mount Apo is the highest mountain in the Philippines.', coordinates: { lat: 6.987, lon: 125.271 }, content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Mount_Apo' } } } }));
  await ctx.route(/api\.worldbank\.org/, (r) => r.fulfill({ json: [{ page: 1 }, [{ value: 123975371, date: '2024' }]] }));
  await page.goto(APP + '?lab=atlas');
  await page.waitForSelector('.atlas-search input');
  await page.fill('.atlas-search input', 'Japan');
  await page.click('.atlas-sugg [data-c3="JPN"]');
  await page.waitForSelector('.atlas-flag');
  await page.waitForFunction(() => /2024/.test(document.querySelector('.atlas-card').textContent) && /38,000 years/.test(document.querySelector('.atlas-card').textContent), null, { timeout: 5000 });
  expect(/Tokyo/.test(await page.locator('.atlas-card').innerText()) && /Japanese yen/.test(await page.locator('.atlas-card').innerText()), 'Japan’s capital and money');
  await shot('atlas-japan');
  await page.fill('.atlas-search input', 'Mount Apo');
  await page.press('.atlas-search input', 'Enter');
  await page.waitForSelector('.atlas-card h3:text-is("Mount Apo")', { timeout: 5000 });
  expect(/pinned on the map/.test(await page.locator('.atlas-card').innerText()) && await page.locator('.atlas-card button:has-text("About Philippines")').count() === 1, 'a place is pinned, with its country');
  // the globe (3D): tap a country on it
  await page.waitForSelector('.lab-stage.lab-is-3d canvas.lab-3d', { timeout: 20000 });
  await page.click('.lab-overlay .lab-btn:has-text("Whole world")');
  await page.waitForTimeout(1200);
  // a spot in Australia where the globe itself is under the finger (its middle can sit under the zoom buttons)
  const oz = await page.evaluate(() => { const c = document.querySelector('.lab-stage canvas.lab-3d'); return [[-25, 134], [-22, 122], [-30, 120], [-20, 140], [-28, 145]].map(([la, lo]) => c._toScreen(la, lo)).find((p) => document.elementFromPoint(p.x, p.y) === c); });
  expect(oz, 'some of Australia shows on the globe');
  await page.mouse.click(oz.x, oz.y);
  await page.waitForSelector('.atlas-card h3:text-is("Australia")', { timeout: 5000 });
  expect(/Australia/.test(await page.locator('.atlas-peek').innerText()), 'tapping the globe picks the country, shown right on the globe');
  await shot('atlas-globe');
  // the flat map: tapping a country there too
  await page.click('.lab-seg button:has-text("Flat map")');
  const ab = await page.locator('.lab-stage canvas.lab-canvas:not(.lab-3d)').boundingBox();
  await page.click('.lab-overlay .lab-btn:has-text("Whole world")');
  await page.mouse.click(ab.x + ab.width * 0.25, ab.y + ab.height * 0.4);
  await page.waitForTimeout(400); await shot('atlas-tap');
  // pH, in 3D on a lab bench: tap the acid bottle for a drop (pointers go through the 3D view onto the lab)
  const flatAt = (x, y) => page.evaluate(([px, py]) => document.querySelector('.lab-stage canvas.lab-canvas:not(.lab-3d)')._toScreen(px, py), [x, y]);
  await page.goto(APP + '?lab=ph');
  await page.waitForSelector('.lab-stage.lab-is-3d', { timeout: 20000 });
  await page.waitForTimeout(500);
  const pb = await page.locator('.lab-stage').boundingBox();
  const acid = await flatAt(52, 40);
  await page.mouse.click(acid.x, acid.y);
  await page.waitForFunction(() => /Acid added[\s\S]*0\.05 mL/.test(document.querySelector('.lab-stats').textContent), null, { timeout: 3000 });
  // drag the base bottle over the beaker and hold it there: it pours
  const base = await flatAt(30 + Math.min(170, pb.width * 0.32) - 22, 40), over = await flatAt(110, 90);
  await page.mouse.move(base.x, base.y); await page.mouse.down();
  await page.mouse.move(over.x, over.y, { steps: 4 }); await page.waitForTimeout(1500); await page.mouse.up();
  expect(!/Base added[\s\S]*\b0 mL/.test(await page.locator('.lab-stats').innerText()), 'pouring the base adds base: ' + await page.locator('.lab-stats').innerText());
  // the atom, as the flat diagram: drag a neutron from the tray into the nucleus (carbon-12 → carbon-13)
  await page.goto(APP + '?lab=atom&flat');
  await page.waitForSelector('.lab-stage canvas');
  const tb = await page.locator('.lab-stage canvas').boundingBox();
  await page.mouse.move(tb.x + 24, tb.y + tb.height - 48); await page.mouse.down();
  await page.mouse.move(tb.x + tb.width * 0.42, tb.y + tb.height / 2, { steps: 6 }); await page.mouse.up();
  expect(/carbon-13/.test(await page.locator('.lab-stats').innerText()), 'a dragged-in neutron makes carbon-13: ' + await page.locator('.lab-stats').innerText());
  // Hanoi, in 3D: drag the top wooden disk from A to C
  await page.goto(APP + '?lab=hanoi');
  await page.waitForSelector('.lab-stage.lab-is-3d', { timeout: 20000 });
  await page.waitForTimeout(500);
  const hb = await page.locator('.lab-stage').boundingBox();
  const from = await flatAt(hb.width / 6, hb.height - 60), to = await flatAt((hb.width * 5) / 6, hb.height - 80);
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 }); await page.mouse.up();
  expect(/Moves\s*1\b/.test(await page.locator('.lab-stats').innerText().then((t) => t.replace(/\n/g, ' '))), 'dragging a disk moves it: ' + await page.locator('.lab-stats').innerText());
  expect(errors.length === 0, 'page errors: ' + errors.join('; '));
  await ctx.close();
});

test('phone app: Home and the floating tab bar (Home, Chat, Labs, Games, Cards, You)', async (b) => {
  const { ctx, page, errors } = await open(b, { server: false, device: 'iPhone 13', state: { tab: 'home', groqKey: 'gsk_test' } });
  await page.goto(APP);
  await page.waitForSelector('#home:not([hidden])');
  expect(/Hello, Test/.test(await page.locator('#home .hub-hi').innerText()), 'Home greets you by name');
  expect(await page.locator('#home .hub-card').count() === 2 && await page.locator('#tabbar .tab').count() === 6, 'two big cards and six tabs');
  expect(await page.locator('.tab.on').getAttribute('data-tab') === 'home' && !(await page.locator('#prompt-input').isVisible()), 'Home is open and the chat is out of the way');
  await page.click('.tab[data-tab="labs"]');
  await page.waitForSelector(LABS_READY);
  expect(await page.locator('.tab.on').getAttribute('data-tab') === 'labs' && await page.locator('#tabbar').isVisible(), 'Labs open with the tab bar still there');
  await page.click('.tab[data-tab="cards"]');
  await page.waitForSelector('.fc:not([hidden])');
  expect(await page.locator('.labs').isHidden() && await page.locator('.tab.on').getAttribute('data-tab') === 'cards', 'Cards replace Labs');
  await page.click('.tab[data-tab="you"]');
  await page.waitForSelector('#settings-panel:not([hidden])');
  await page.click('.tab[data-tab="home"]');
  await page.waitForSelector('#settings-panel', { state: 'hidden' });
  await page.click('#home-ask');
  await page.waitForFunction(() => document.activeElement === document.getElementById('prompt-input'));
  expect(await page.locator('.tab.on').getAttribute('data-tab') === 'chat' && await page.locator('#home').isHidden(), 'Ask opens the chat, ready to type');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('cassie.v2')).tab) === 'chat', 'the last tab is remembered');
  expect(errors.length === 0, 'page errors: ' + errors.join('; '));
  await ctx.close();
});

test('the landing page is calm, like linear.app: one message and one button in the hero (no "AI" in it), 5 or fewer things in the menu, 7 or fewer sections, every link people need, one live demo and one moving background, a sentence that lights up as you read, for every student, a true privacy line; readable in light and dark at 390 and 1280; no dashes', async (b) => {
  const { contrastIssues } = require('./ui-checks.cjs');
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  expect(/'landing\/home\.css'/.test(sw) && /'landing\/try\.js'/.test(sw) && !/landing\/(story|desk|play)\./.test(sw), 'the offline copy has the new page’s files, not the old ones');
  for (const [w, h, maxH] of [[390, 844, 16500], [1280, 800, 11000]]) {
    for (const scheme of ['light', 'dark']) {
      const ctx = watchCsp(await b.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, serviceWorkers: 'block', ...(w < 500 ? { isMobile: true, hasTouch: true } : {}) }));
      const page = await ctx.newPage();
      const errors = []; page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(APP.replace('app.html', 'index.html'));
      const L = await page.evaluate(() => {
        const vis = (e) => !!e.offsetParent || getComputedStyle(e).position === 'fixed';
        const hero = document.querySelector('.hero'), tryBox = document.querySelector('#try');
        const heroControls = [...hero.querySelectorAll('a, button')].filter((e) => !tryBox.contains(e) && vis(e));
        return {
          primary: heroControls.filter((e) => e.classList.contains('btn')).map((e) => [e.textContent.trim(), e.getAttribute('href')]),
          textLinks: heroControls.filter((e) => !e.classList.contains('btn')).length,
          heroWords: hero.querySelector('h1').textContent + ' ' + hero.querySelector('.lead').textContent,
          menu: [...document.querySelectorAll('.nav a, .nav button')].filter((e) => !e.classList.contains('brand') && e.offsetParent).map((e) => e.textContent.trim()),
          sections: document.querySelectorAll('main > section').length,
          hrefs: [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')),
          height: document.documentElement.scrollHeight,
          canvases: document.querySelectorAll('canvas').length,
          loops: document.getAnimations().filter((a) => a.effect && a.effect.getComputedTiming().iterations === Infinity).map((a) => a.effect.target.className || a.effect.target.parentElement.className),
          cards: document.querySelectorAll('.how-card').length,
          sticky: getComputedStyle(document.querySelector('.how-card')).position,
          who: [...document.querySelectorAll('.who h3')].map((e) => e.textContent),
          trust: document.querySelector('#trust').textContent.replace(/\s+/g, ' '),
          sideways: document.documentElement.scrollWidth > innerWidth,
        };
      });
      const tag = `${w} ${scheme}`;
      expect(L.primary.length === 1 && L.primary[0][0] === 'Start free' && L.primary[0][1] === 'start.html' && L.textLinks <= 1, `${tag}: one button in the hero (and one text link): ` + JSON.stringify(L.primary));
      expect(!/\bAI\b|algorithm|machine learning|automation/i.test(L.heroWords), `${tag}: the hero says what Cassie does for you, not the technology: ` + L.heroWords);
      expect(L.menu.length <= 5 && (w > 760 || L.menu.join() === 'Open Cassie'), `${tag}: 5 or fewer things in the menu (just Open Cassie on a phone): ` + L.menu.join(', '));
      expect(L.sections <= 7, `${tag}: 7 or fewer sections: ` + L.sections);
      for (const need of ['start.html', 'rescue.html', 'let.html', 'privacy.html', 'terms.html', 'support.html', 'bot.html', '#pricing', '#faq']) expect(L.hrefs.includes(need), `${tag}: a link to ${need}`);
      expect(L.hrefs.some((x) => x === "https://chromewebstore.google.com/detail/hnafgijhojdheggkcjliffbgpdhikbpj"), `${tag}: the extension in the Chrome Web Store`);
      expect(L.height <= maxH, `${tag}: a short page (was 26,600px on a computer and 33,900px on a phone): ${L.height}px`);
      expect(L.canvases <= 1 && L.loops.every((c) => /subjects/.test(c)), `${tag}: one moving background, and only the subjects strip loops (the button's light turns 3 times, then rests): ` + JSON.stringify([L.canvases, L.loops]));
      expect(await page.evaluate(() => document.querySelector('.subjects').classList.contains('off') && getComputedStyle(document.querySelector('.subjects ul')).animationPlayState === 'paused'), `${tag}: the strip rests while off screen`);
      // the study tools: three figures that draw themselves in, one after another
      const F = await page.evaluate(async () => {
        const figs = [...document.querySelectorAll('.figs .fig')];
        const before = figs.map((f) => getComputedStyle(f.querySelector('.ln')).strokeDashoffset);
        for (const f of figs) { f.scrollIntoView({ behavior: 'instant', block: 'center' }); await new Promise((r) => setTimeout(r, 350)); } // (stacked on a phone: each one as you reach it)
        await new Promise((r) => setTimeout(r, 2600));
        return { n: figs.length, labels: figs.map((f) => f.querySelector('.fig-n').textContent), titles: figs.map((f) => f.querySelector('h3').textContent), before, after: figs.map((f) => getComputedStyle(f.querySelector('.ln')).strokeDashoffset), delays: figs.map((f) => getComputedStyle(f.querySelector('.ln')).transitionDelay) };
      });
      expect(F.n === 3 && F.labels.join() === 'FIG 0.1,FIG 0.2,FIG 0.3' && /Learn/.test(F.titles[0]) && /Flashcards/.test(F.titles[1]) && /board/i.test(F.titles[2]), `${tag}: the study tools, like Linear's figures: ` + JSON.stringify(F.titles));
      expect(F.before.every((x) => parseFloat(x) > 0) && F.after.every((x) => parseFloat(x) === 0) && new Set(F.delays).size === 3, `${tag}: each drawing draws itself in, one after another: ` + JSON.stringify(F));
      const moves = await page.evaluate(async () => {
        const out = [];
        for (const f of document.querySelectorAll('.fig')) { // (each one while it is on screen: off screen they rest)
          f.scrollIntoView({ behavior: 'instant', block: 'center' }); await new Promise((r) => setTimeout(r, 200));
          const mover = f.querySelector('.dot') || f.querySelector('g'), box = f.querySelector('svg').getBoundingClientRect();
          const at = () => { const r = mover.getBoundingClientRect(); return [Math.round(r.left - box.left), Math.round(r.top - box.top)].join(','); };
          const a = at(); await new Promise((r) => setTimeout(r, 1100));
          out.push({ a, b: at(), paused: f.querySelector('svg').animationsPaused() });
        }
        return out;
      });
      expect(moves.every((m) => m.a !== m.b && !m.paused), `${tag}: each drawing moves while on screen (planets orbit, the top card lifts, a point rides the curve): ` + JSON.stringify(moves));
      // the strip can be stopped (motion people can stop), and keyboard focus shows on every background
      await page.locator('.strip-pause').scrollIntoViewIfNeeded(); await page.click('.strip-pause');
      expect(await page.evaluate(() => getComputedStyle(document.querySelector('.subjects ul')).animationPlayState === 'paused' && document.querySelector('.strip-pause').getAttribute('aria-pressed') === 'true'), `${tag}: Pause stops the subjects strip`);
      const ring = await page.evaluate(() => { const lum = (c) => { const [r, g, b] = c.match(/[\d.]+/g).slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; }; const cr = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
        const out = []; for (const sel of ['.who .go', '.foot a', '.hero .text-link']) { const e = document.querySelector(sel); e.focus(); let bg = 'rgba(0, 0, 0, 0)', p = e; while (p && /rgba\(0, 0, 0, 0\)|transparent/.test(bg)) { bg = getComputedStyle(p).backgroundColor; p = p.parentElement; } out.push([sel, cr(getComputedStyle(e).outlineColor, bg)]); } return out; });
      expect(ring.every(([, r]) => r >= 3), `${tag}: the focus ring stands out (3:1 or more) wherever it is: ` + JSON.stringify(ring));
      expect(L.cards === 3 && (w > 760 ? L.sticky === 'sticky' : true), `${tag}: Highlight, Understand, Remember (stacking as you scroll on a computer)`);
      expect(L.who.length === 6 && /Nursery/.test(L.who[0]) && L.who.some((x) => /High school/.test(x)) && L.who.some((x) => /College/.test(x)) && L.who.some((x) => /Board/.test(x)), `${tag}: for every student: ` + L.who.join(' | '));
      expect(/Files, photos and voice are used only to answer you/.test(L.trust) && !/offline|never leaves|I built/i.test(L.trust), `${tag}: the privacy line says only what privacy.html says, and Cassie’s makers stay unnamed`);
      expect(!L.sideways, `${tag}: nothing off the side`);
      // the sentence is held on screen and comes into focus word by word as you scroll
      const at = async (q) => { await page.evaluate((q) => { const e = document.querySelector('#why'); scrollTo({ top: e.offsetTop + (e.offsetHeight - innerHeight) * q, behavior: 'instant' }); }, q); await page.waitForTimeout(300); return page.evaluate(() => { const say = document.querySelector('[data-say]'), r = say.getBoundingClientRect(); return { lit: say.querySelectorAll('span.lit').length, n: say.querySelectorAll('span').length, onScreen: r.top >= 0 && r.bottom <= innerHeight }; }); };
      const [early, mid, done] = [await at(0.05), await at(0.45), await at(1)];
      expect(mid.lit > early.lit && mid.lit < mid.n && done.lit === done.n && mid.onScreen && done.onScreen, `${tag}: the sentence stays on screen and comes into focus as you scroll: ` + JSON.stringify([early, mid, done]));
      // the hero's lesson page leans back at the top and lies flat once scrolled
      await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' })); await page.waitForTimeout(200);
      const lean = await page.evaluate(() => getComputedStyle(document.querySelector('.hero-try .try-win')).transform);
      await page.evaluate(() => scrollTo({ top: innerHeight, behavior: 'instant' })); await page.waitForTimeout(200);
      const flat = await page.evaluate(() => getComputedStyle(document.querySelector('.hero-try .try-win')).transform);
      expect(lean !== flat && /matrix3d/.test(lean) && (flat === 'none' || /^matrix\(1, 0, 0, 1/.test(flat) || /matrix3d\(1, 0, 0, 0, 0, 1, 0/.test(flat)), `${tag}: the lesson page leans back, then lies flat: ` + [lean, flat].join(' / '));
      // readable everywhere, once each part has arrived
      await page.evaluate(() => document.querySelectorAll('.rv').forEach((e) => e.classList.add('in')));
      const bad = [];
      for (let y = 0; y < L.height; y += h * 0.9) {
        await page.evaluate((y) => scrollTo({ top: y, behavior: 'instant' }), y); await page.waitForTimeout(250);
        bad.push(...(await contrastIssues(page, 'body')).bad);
      }
      expect(!bad.length, `${tag}: words under AA: ` + [...new Set(bad)].slice(0, 6).join(' | '));
      expect(!/[–—]/.test(await page.locator('body').innerText()), `${tag}: no dashes`);
      if (process.env.SHOTS) { await page.evaluate(() => scrollTo(0, 0)); await page.waitForTimeout(400); await page.screenshot({ path: `${process.env.SHOTS}/landing-${w}-${scheme}.png` }); }
      expect(!errors.length, `${tag}: page errors: ` + errors.join('; '));
      await ctx.close();
    }
  }
  // Reduce Motion: everything is there at once, the sentence fully lit
  const rm = await b.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
  const p2 = await rm.newPage(); await p2.goto(APP.replace('app.html', 'index.html'));
  const R = await p2.evaluate(() => ({ hidden: [...document.querySelectorAll('.rv')].filter((e) => getComputedStyle(e).opacity !== '1').length, dim: [...document.querySelectorAll('[data-say] span')].filter((e) => !e.classList.contains('lit')).length, loops: document.getAnimations().filter((a) => a.effect && a.effect.getComputedTiming().iterations === Infinity).length, lean: getComputedStyle(document.querySelector('.hero-try .try-win')).transform }));
  expect(!R.hidden && !R.dim && !R.loops && R.lean === 'none', 'Reduce Motion: nothing waits to fade in or light up, nothing loops or leans: ' + JSON.stringify(R));
  expect(await p2.evaluate(() => [...document.querySelectorAll('.fig svg')].every((s) => s.animationsPaused())), 'Reduce Motion: the drawings stay still');
  await rm.close();
});

test('landing: Cassie’s popup on the hero’s lesson page is never cut off: in a short window, opened near the bottom, its quiz shows whole (above the word when there is no room below, and on screen as it grows)', async (b) => {
  for (const scheme of ['dark', 'light']) {
    const ctx = await b.newContext({ viewport: { width: 1176, height: 519 }, colorScheme: scheme, serviceWorkers: 'block' });
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(APP.replace('app.html', 'index.html'));
    await page.waitForTimeout(600);
    // like the screenshot: the lesson page high on the screen, the word in its first lines
    await page.evaluate(() => { const e = document.querySelector('#try-page'); scrollTo({ top: e.getBoundingClientRect().top + scrollY - 40, behavior: 'instant' }); });
    await page.waitForTimeout(400);
    await page.click('#try-page b[data-term]:text-is("cellular respiration")');
    await page.waitForSelector('#try-pop:not([hidden])');
    await page.click('#try-pop [data-act="quiz"]');
    await page.waitForSelector('#try-pop [data-o="2"]', { timeout: 8000 });
    await page.waitForTimeout(1200);
    const g = await page.evaluate(() => {
      const pop = document.querySelector('#try-pop'), r = pop.getBoundingClientRect(), nav = document.querySelector('.nav').getBoundingClientRect();
      const seen = (x, y) => { const h = document.elementFromPoint(x, y); return !!h && pop.contains(h); };
      const last = pop.querySelector('[data-o="2"]').getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, navBottom: nav.bottom, h: innerHeight, lastSeen: seen(last.left + last.width / 2, last.top + last.height / 2), topSeen: seen(r.left + r.width / 2, r.top + 20) };
    });
    expect(g.top >= g.navBottom - 1 && g.bottom <= g.h + 1 && g.lastSeen && g.topSeen, `${scheme}: the whole popup shows, down to its last answer: ` + JSON.stringify(g));
    await page.click('#try-pop [data-o="2"]');
    expect(await page.locator('#try-pop .tp-fb').isVisible(), `${scheme}: the answer can be picked`);
    expect(!errors.length, 'page errors: ' + errors.join('; '));
    await ctx.close();
  }
});

test('landing: the hero’s lesson page: highlight a word and Cassie explains it, quizzes you, makes a card', async (b) => {
  const ctx = watchCsp(await b.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' }));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(APP.replace('app.html', 'index.html'));
  expect(await page.locator('.nav .brand svg rect[rx="11"]').count() === 2, 'the logo: Cursor Cassie with her two eyes');
  await page.locator('#try').scrollIntoViewIfNeeded();
  await page.click('#try-page b[data-term]:text-is("mitochondria")');
  await page.waitForSelector('#try-pop:not([hidden])');
  expect(/mitochondria/.test(await page.locator('#try-pop .tp-q').innerText()), 'the popup names the word');
  await page.click('#try-pop [data-act="explain"]');
  await page.waitForFunction(() => /power stations/.test(document.querySelector('#try-pop .tp-out').textContent), null, { timeout: 8000 });
  await page.click('#try-pop [data-act="quiz"]');
  await page.click('#try-pop [data-o="0"]');
  expect(/Yes!/.test(await page.locator('#try-pop .tp-fb').innerText()), 'the right answer is praised');
  await page.click('#try-pop [data-act="card"]');
  await page.click('#try-pop .tp-card');
  expect(await page.locator('#try-pop .tp-card.flip').count() === 1, 'the flashcard flips');
  // a word that isn't in the demo still gets a friendly answer
  await page.click('#try-pop .tp-x');
  await page.locator('#try-page p.tp-text').first().click({ position: { x: 4, y: 8 } });
  await page.waitForSelector('#try-pop:not([hidden])');
  await page.click('#try-pop [data-act="explain"]');
  await page.waitForFunction(() => /only know the words in bold|power stations|smallest living unit/.test(document.querySelector('#try-pop .tp-out').textContent), null, { timeout: 8000 });
  expect(errors.length === 0, 'page errors: ' + errors.join('; '));
  await ctx.close();
});

test('a reflection paper is written as the student, not as Cassie', async (b) => {
  const { ctx, page, groqCalls } = await open(b, { server: false, state: { groqKey: 'gsk_test' }, fakeGroq: () => ({ text: 'My reflection.' }) });
  await ask(page, 'Make me a reflection paper about our field trip to the museum');
  const sys = (groqCalls[groqCalls.length - 1].messages || []).find((m) => m.role === 'system').content;
  expect(/write it AS THE USER, in the first person/.test(sys), 'the system prompt should tell Cassie to write as the student');
  expect(/never give Cassie's own feelings, opinions or experiences/.test(sys), 'no Cassie opinions in their paper');
  expect(/never inside a paper, essay or anything they will hand in/.test(sys), 'their name must stay out of the paper');
  await ctx.close();
});

test('the living marble: it moves behind the chat (a small shader), and Lite mode keeps the plain background', async (b) => {
  let { ctx, page } = await open(b, { lite: 'on' });
  await page.waitForTimeout(1500);
  expect(await page.locator('#app-bg canvas').count() === 0, 'no moving background in Lite mode');
  await ctx.close();
  ({ ctx, page } = await open(b, { lite: 'off', device: 'Desktop Chrome' }));
  await page.waitForSelector('#app-bg canvas', { state: 'attached', timeout: 8000 });
  // picking a colour makes the marble flow to it (no errors)
  await page.evaluate(() => { state.accent = '#2f7d5b'; updateBackdrop(); });
  await page.waitForTimeout(900);
  expect(await page.evaluate(() => [...document.scripts].every((s) => !/cassie-3d|mascot3d/.test(s.src))), 'no 3D mascot bundle');
  await ctx.close();
});

test('Research finds real papers and writes an RRL; references copy as APA/MLA and download as BibTeX/RIS', async (b) => {
  const { ctx, page } = await open(b, { server: false, state: { groqKey: 'gsk_test' }, fakeGroq: () => ({ text: 'Studies agree that sleep improves memory (Smith, 2020).\n\n**References**\nSmith, J. (2020). Sleep and memory.' }) });
  await ctx.route(/api\.openalex\.org/, (route) => route.fulfill({ json: { results: [
    { title: 'Sleep and memory', publication_year: 2020, authorships: [{ author: { display_name: 'J. Smith' } }], primary_location: { source: { display_name: 'Journal of Sleep' } }, doi: 'https://doi.org/10.1/abc', type: 'article', biblio: { volume: '29', issue: '3', first_page: '101', last_page: '115' }, cited_by_count: 12, abstract_inverted_index: { Sleep: [0], helps: [1], memory: [2] } },
    { title: 'Naps in students', publication_year: 2019, authorships: [{ author: { display_name: 'A. Cruz' } }], cited_by_count: 3 },
  ] } }));
  await page.fill('#prompt-input', 'sleep and memory');
  await page.click('#research-btn');
  await page.waitForSelector('text=Found 2 real papers', { timeout: 10000 });
  await page.waitForSelector('text=Studies agree', { timeout: 10000 });
  // the citations come from the papers' own data, not from the AI
  const bar = page.locator('.cite-tools').first();
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  await bar.locator('button', { hasText: 'Copy APA' }).click();
  const apa = await page.evaluate(() => navigator.clipboard.readText());
  expect(/Smith, J\. \(2020\)\. Sleep and memory\. Journal of Sleep, 29\(3\), 101-115\. https:\/\/doi\.org\/10\.1\/abc/.test(apa) && /Cruz, A\. \(2019\)/.test(apa), 'APA references: ' + apa);
  const [bib] = await Promise.all([page.waitForEvent('download'), bar.locator('button', { hasText: 'BibTeX' }).click()]);
  const bibText = fs.readFileSync(await bib.path(), 'utf8');
  expect(/@article\{smith2020sleep,/.test(bibText) && /doi = \{10\.1\/abc\}/.test(bibText) && /pages = \{101--115\}/.test(bibText), 'BibTeX: ' + bibText);
  const [risDl] = await Promise.all([page.waitForEvent('download'), bar.locator('button', { hasText: 'RIS' }).click()]);
  const risText = fs.readFileSync(await risDl.path(), 'utf8');
  expect(/TY  - JOUR/.test(risText) && /AU  - Smith, J\./.test(risText) && /DO  - 10\.1\/abc/.test(risText), 'RIS: ' + risText);
  if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/cite-bar.png' });
  // still there after a reload
  await page.reload();
  await page.waitForSelector('.cite-tools >> text=Copy MLA', { timeout: 5000 });
  await ctx.close();
});

test('Web answers with sources (Gemini key)', async (b) => {
  const { ctx, page } = await open(b, { server: false, state: { groqKey: 'gsk_test', geminiKey: 'AIza_test' } });
  await ctx.route(/generativelanguage\.googleapis\.com/, (route) => route.fulfill({ json: { candidates: [{ content: { parts: [{ text: 'The tallest mountain is Mount Everest.' }] }, groundingMetadata: { groundingChunks: [{ web: { uri: 'https://example.org/everest', title: 'example.org' } }] } }] } }));
  await page.fill('#prompt-input', 'What is the tallest mountain?');
  await page.click('#web-btn');
  await page.waitForSelector('text=Mount Everest', { timeout: 10000 });
  await ctx.close();
});

test('attach a PDF and Cassie reads it', async (b) => {
  const { ctx, page, groqCalls } = await open(b, { server: false, state: { groqKey: 'gsk_test' }, fakeGroq: () => ({ text: 'Summary: the water cycle has evaporation and condensation.' }) });
  const pdf = await page.evaluate(async () => {
    const blob = await window.CassieExport.toPdf('# Water cycle\n\nEvaporation, condensation and precipitation move water around the Earth.', 'Water cycle');
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = ''; for (const x of buf) s += String.fromCharCode(x);
    return btoa(s);
  });
  await page.setInputFiles('#file-input', { name: 'water.pdf', mimeType: 'application/pdf', buffer: Buffer.from(pdf, 'base64') });
  await page.waitForSelector('#attach-preview:not([hidden])', { timeout: 10000 });
  await ask(page, 'Summarize this');
  expect(/condensation/i.test(JSON.stringify(groqCalls)), 'PDF text was not sent to the AI: ' + JSON.stringify(groqCalls.map((c) => c.messages.slice(1))).slice(0, 1500) + ' | ' + (await page.locator('#chat-log').textContent()).slice(-300));
  await ctx.close();
});

test('chat: many photos and files at once — every one is read (photo by photo, file by file), nothing is dropped', async (b) => {
  const fake = (body) => {
    const t = JSON.stringify(body.messages);
    const m = t.match(/This is photo (\d+) of (\d+)/);
    if (m) return { text: `**Text in the photo**\nPHOTO-${m[1]}-TEXT` };
    const marks = t.match(/PHOTO-\d+-TEXT|FILE-[AB]-TEXT/g) || [];
    return { text: marks.length ? 'All read: ' + [...new Set(marks)].join(', ') : 'ok' };
  };
  const { ctx, page, errors } = await open(b, { server: false, device: 'Desktop Chrome', fakeGroq: fake, state: { groqKey: 'gsk_test' } });
  const photo = (n) => ({ name: `page${n}.png`, mimeType: 'image/png', buffer: PNG });
  await page.setInputFiles('#file-input', [photo(1), photo(2), photo(3), { name: 'a.txt', mimeType: 'text/plain', buffer: Buffer.from('FILE-A-TEXT: osmosis is water moving across a membrane.') }, { name: 'b.txt', mimeType: 'text/plain', buffer: Buffer.from('FILE-B-TEXT: diffusion spreads particles out.') }]);
  await page.waitForFunction(() => document.querySelectorAll('.att.att-ready').length === 5, null, { timeout: 10000 });
  expect(/3 photos · 2 files/.test(await page.locator('#att-count').innerText()), 'all five are attached (the second photo doesn’t replace the first)');
  if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/attach-many.png' });
  // take one photo out
  await page.locator('.att-image .att-x').nth(1).click();
  expect(/2 photos · 2 files/.test(await page.locator('#att-count').innerText()), 'one photo removed');
  const a = await ask(page, 'Make a reviewer of all of these');
  const t = await a.textContent();
  expect(['PHOTO-1-TEXT', 'PHOTO-2-TEXT', 'FILE-A-TEXT', 'FILE-B-TEXT'].every((x) => t.includes(x)), 'every photo and file reached the answer: ' + t);
  expect(await page.locator('#chat-log .bubble-user').last().locator('img.chat-img').count() === 2, 'both photos show in the message');
  expect(await page.locator('#attach-preview').isHidden(), 'the attachments are cleared after sending');
  // at most 15 photos at a time
  await page.setInputFiles('#file-input', Array.from({ length: 16 }, (_, i) => photo(i + 1)));
  await page.waitForFunction(() => document.querySelectorAll('.att.att-ready').length === 15 && document.querySelectorAll('.att.att-error').length === 1, null, { timeout: 15000 });
  expect(/Up to 15 photos/.test(await page.locator('.att.att-error').innerText()), 'the 16th photo says why');
  expect(errors.length === 0, 'page errors: ' + errors.join('; '));
  await ctx.close();
});

test('phones: open a PDF in Read & highlight, select words → Explain', async (b) => {
  const { ctx, page } = await open(b, { server: false, state: { groqKey: 'gsk_test' }, fakeGroq: () => ({ text: 'Condensation is when water vapour cools into droplets.' }) });
  const pdf = await page.evaluate(async () => {
    const blob = await window.CassieExport.toPdf('# Water cycle\n\nEvaporation, condensation and precipitation move water around the Earth.', 'Water cycle');
    const buf = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (const x of buf) s += String.fromCharCode(x); return btoa(s);
  });
  await page.setInputFiles('#file-input', { name: 'water.pdf', mimeType: 'application/pdf', buffer: Buffer.from(pdf, 'base64') });
  await page.waitForSelector('.att-read', { timeout: 10000 });
  await page.click('.att-read');
  await page.waitForSelector('#reader:not([hidden]) .reader-page', { timeout: 5000 });
  expect(/Page 1/i.test(await page.locator('#reader .reader-label').first().textContent()), 'pages are labelled');
  const para = page.locator('#reader-body p', { hasText: 'condensation' }).first();
  await para.selectText(); await page.mouse.up();
  await page.waitForSelector('#highlight-popover:not([hidden]) [data-mode=explain]', { timeout: 5000 });
  await page.click('#highlight-popover [data-mode=explain]');
  await page.waitForSelector('#highlight-popover >> text=water vapour cools', { timeout: 10000 });
  await page.click('#reader-close');
  expect(await page.locator('#reader').isHidden(), 'the reader closes');
  await ctx.close();
});

test('no key: a photo is read through the server', async (b) => {
  await serverMode({ groq: 'ok', reply: 'I can see a red square in your photo.' });
  const { ctx, page } = await open(b);
  const red = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = c.height = 40; const g = c.getContext('2d'); g.fillStyle = 'red'; g.fillRect(0, 0, 40, 40); return c.toDataURL('image/png').split(',')[1]; });
  await page.setInputFiles('#file-input', { name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from(red, 'base64') });
  await page.waitForSelector('#attach-preview:not([hidden])', { timeout: 10000 });
  const a = await ask(page, 'What is in this photo?');
  expect(/red square/.test(await a.textContent()), 'photo answer missing: ' + await a.textContent());
  await serverMode({ reply: '' });
  await ctx.close();
});

test('own Gemini key: Cassie asks Google which models the key has, so retired names never stop her', async (b) => {
  const { ctx, page, errors } = await open(b, { server: false, state: { geminiKey: 'AIza_test' } });
  const used = [];
  let listed = 0;
  await ctx.route(/generativelanguage\.googleapis\.com/, (route) => {
    const u = route.request().url();
    if (route.request().method() === 'GET') { listed += 1; return route.fulfill({ json: { models: [
      { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }, { name: 'models/gemini-9.0-flash-image', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-9.0-flash', supportedGenerationMethods: ['generateContent'] }, { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] } ] } }); }
    const model = u.match(/models\/([^:]+)/)[1];
    used.push(model);
    if (/gemini-(2\.5|3\.6)-flash$/.test(model)) return route.fulfill({ status: 404, json: { error: { code: 404, message: `This model models/${model} is no longer available to new users.` } } });
    return route.fulfill({ json: { candidates: [{ content: { parts: [{ text: 'Osmosis is water moving through a membrane.' }] } }] } });
  });
  const a = await ask(page, 'What is osmosis?');
  expect(/water moving through a membrane/.test(await a.textContent()), 'answer: ' + await a.textContent());
  expect(listed === 1 && used[0] === 'gemini-9.0-flash', 'the newest listed Flash model should be asked first: ' + JSON.stringify(used));
  await ask(page, 'And diffusion?');
  expect(listed === 1, 'the list is remembered, not fetched every time');
  expect(errors.length === 0, 'page errors: ' + errors.join('; '));
  await ctx.close();
});

test('a busy Gemini never ends a photo answer: Groq reads it instead, and can graph it', async (b) => {
  const { ctx, page } = await open(b, { server: false, state: { groqKey: 'gsk_test', geminiKey: 'AIza_test' }, fakeGroq: (body) => ({ text: 'The graph matches C.\n\n```cassie-board\n{"type":"graph","title":"y = x^2(x+6)^3(x-4)","fn":"x^2*(x+6)^3*(x-4)","xrange":[-7,5]}\n```' }) });
  let geminiCalls = 0;
  await ctx.route(/generativelanguage\.googleapis\.com/, (route) => { geminiCalls += 1; return route.fulfill({ status: 503, json: { error: { code: 503, message: 'This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.', status: 'UNAVAILABLE' } } }); });
  const red = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = c.height = 40; const g = c.getContext('2d'); g.fillStyle = 'red'; g.fillRect(0, 0, 40, 40); return c.toDataURL('image/png').split(',')[1]; });
  await page.setInputFiles('#file-input', { name: 'graph.png', mimeType: 'image/png', buffer: Buffer.from(red, 'base64') });
  await page.waitForSelector('#attach-preview:not([hidden])', { timeout: 10000 });
  const a = await ask(page, 'which function is this? graph the answer');
  const txt = await a.textContent();
  expect(!/high demand/i.test(txt) && /matches C/.test(txt), 'expected the Groq answer, got: ' + txt.slice(0, 200));
  expect(geminiCalls >= 2, 'every Gemini model should be tried first (' + geminiCalls + ')');
  expect(await a.locator('.cassie-board').count() === 1, 'the answer should draw the graph on a board');
  await ctx.close();
});

test('Gemini pictures on the server: “a photo of the answer” redraws the student’s photo with the answer; a plan’s allowance, then the free picture maker', async (b) => {
  await fetch(SERVER + '/__reset');
  await serverMode({ gemini: 'ok', geminiPictures: 'ok', geminiPics: [] });
  try {
    const { ctx, page, errors } = await open(b, { device: 'Desktop Chrome', state: { groqKey: 'gsk_test' }, fakeGroq: () => ({ text: '**Answer: No, this map is not 2-colorable.** Three regions meet at one point: an odd circuit of 3.' }) });
    const made = [];
    await ctx.route(/pollinations\.ai/, (route) => { made.push(route.request().url()); return route.fulfill({ body: PNG, contentType: 'image/png' }); });
    await page.waitForFunction(() => serverPictures === true, null, { timeout: 8000 });
    // the student sends a photo of the problem, then asks for a photo of the answer
    const red = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = c.height = 60; const g = c.getContext('2d'); g.fillStyle = '#ccc'; g.fillRect(0, 0, 60, 60); return c.toDataURL('image/png').split(',')[1]; });
    await page.setInputFiles('#file-input', { name: 'slide.png', mimeType: 'image/png', buffer: Buffer.from(red, 'base64') });
    await page.waitForSelector('#attach-preview:not([hidden])', { timeout: 10000 });
    await ask(page, 'Is this map 2-colorable?');
    await ask(page, 'generate a photo of the answer');
    let last = await page.locator('#chat-log .bubble-assistant').last().innerText();
    expect(/answer as a picture/.test(last) && /check the labels/.test(last), 'a Gemini answer picture: ' + last);
    let m = await (await fetch(SERVER + '/__mode')).json();
    const pic = m.geminiPics.at(-1);
    expect(pic && pic.ref && /Answer:/.test(pic.prompt) && /not 2-colorable/.test(pic.prompt) && /No people/.test(pic.prompt) && /attached photo/.test(pic.prompt), 'drawn from the photo and the answer: ' + JSON.stringify(pic).slice(0, 300));
    expect(/gemini-9\.0-flash-image/.test(pic.model), 'the newest Flash image model: ' + pic.model);
    // an everyday picture goes to Gemini too (no photo), until the free week's 3 are used
    await ask(page, 'make me a picture of a volcano');
    await ask(page, 'make me a picture of a rice terrace');
    m = await (await fetch(SERVER + '/__mode')).json();
    expect(m.geminiPics.length === 3 && !m.geminiPics.at(-1).ref && made.length === 0, 'three Gemini pictures: ' + m.geminiPics.length + ' / free ' + made.length);
    last = await page.locator('#chat-log .bubble-assistant').last().innerText();
    expect(/last Gemini picture this week/.test(last), 'says it was the last one: ' + last);
    await ask(page, 'make me a picture of a carabao');
    m = await (await fetch(SERVER + '/__mode')).json();
    const freeNow = new Set(made).size;
    expect(m.geminiPics.length === 3 && freeNow === 1, 'the 4th goes to the free picture maker: ' + m.geminiPics.length + ' / ' + freeNow);
    // a key without billing: the free picture maker, quietly
    await fetch(SERVER + '/__reset');
    await serverMode({ geminiPictures: 'nobilling' });
    await ask(page, 'make me a picture of a mango tree');
    expect(new Set(made).size === 2, 'no billing → the free picture maker: ' + new Set(made).size);
    expect(errors.length === 0, 'page errors: ' + errors.join('; '));
    await ctx.close();
  } finally { await serverMode({ gemini: 'off', geminiPictures: 'ok' }); await fetch(SERVER + '/__reset'); }
});

test('one copy of the truth: the extension’s board is the app’s, and the server file you paste matches its source', async () => {
  for (const f of ['board.js', 'sketch.js', 'care.js']) expect(fs.readFileSync(path.join(ROOT, f), 'utf8') === fs.readFileSync(path.join(ROOT, 'extension', f), 'utf8'), `extension/${f} differs from ${f}: copy it over`);
  const html = fs.readFileSync(path.join(ROOT, 'server/dashboard.html'), 'utf8').replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
  const care = fs.readFileSync(path.join(ROOT, 'care.js'), 'utf8'); // (the server's care response is the app's own file)
  const built = fs.readFileSync(path.join(ROOT, 'server/worker.src.js'), 'utf8').replace('/*__CARE_JS__*/', () => care).replace('__DASHBOARD_HTML__', () => html);
  expect(built === fs.readFileSync(path.join(ROOT, 'server/worker.js'), 'utf8'), 'server/worker.js is out of date: run  cd server && python3 build.py');
});

test('Claude on the server: the main chat and photos use Claude, Groq covers when it fails', async (b) => {
  await serverMode({ claude: 'ok', claudeReply: 'Claude here: plants turn light into food.', claudeCalls: [] });
  try {
    const { ctx, page } = await open(b, { state: { groqKey: 'gsk_own' } }); // even with their own key, Claude answers
    await page.waitForFunction(() => serverClaude === true, null, { timeout: 5000 });
    const a = await ask(page, 'What is photosynthesis?');
    expect(/Claude here/.test(await a.textContent()), 'Claude should answer: ' + await a.textContent());
    let m = await (await fetch(SERVER + '/__mode')).json();
    const call = m.claudeCalls.at(-1);
    expect(call && call.model === 'test-haiku', 'a free student gets Haiku (when the owner allows any Claude for free): ' + (call && call.model));
    expect(call.effort === 'medium' && call.fallbacks === 'default' && call.beta === 'server-side-fallback-2026-07-01', 'effort + refusal fallback: ' + JSON.stringify(call).slice(0, 200));
    expect(/You are Cassie/.test(call.system) && call.messages[0].role === 'user', 'system prompt goes on its own, chat starts with the user');
    // a photo goes to Claude as an image block
    const red = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = c.height = 40; const g = c.getContext('2d'); g.fillStyle = 'red'; g.fillRect(0, 0, 40, 40); return c.toDataURL('image/png').split(',')[1]; });
    await page.setInputFiles('#file-input', { name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from(red, 'base64') });
    await page.waitForSelector('#attach-preview:not([hidden])', { timeout: 10000 });
    await ask(page, 'What is in this photo?');
    m = await (await fetch(SERVER + '/__mode')).json();
    const blocks = m.claudeCalls.at(-1).messages.at(-1).content;
    expect(blocks.some((x) => x.type === 'image' && x.source.type === 'base64' && /^image\//.test(x.source.media_type)), 'photo should be an image block');
    // paid plans: the owner gives an account Pro with the dashboard password → Sonnet answers
    const email = `pro${Date.now()}@example.com`;
    const token = await page.evaluate(async ([srv, em]) => (await (await fetch(srv + '/auth/signup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: em, password: 'secret-pass-1', age: 17 }) })).json()).token, [SERVER, email]);
    const grant = async (plan) => (await (await fetch(SERVER + '/admin/plan', { method: 'POST', headers: { authorization: 'Bearer test-admin-token-0123456789', 'content-type': 'application/json' }, body: JSON.stringify({ email, plan, days: 30 }) })).json());
    expect((await grant('pro')).plan === 'pro', 'the owner can give Pro');
    const chatAs = (tok) => page.evaluate(async ([srv, t]) => { const r = await fetch(srv + '/chat', { method: 'POST', headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}) }, body: JSON.stringify({ uid: installId(), brain: 'claude', q: 1, messages: [{ role: 'user', content: 'What is ATP?' }] }) }); return [r.headers.get('x-cassie-plan'), r.headers.get('x-cassie-source')]; }, [SERVER, tok]);
    let [plan, source] = await chatAs(token);
    m = await (await fetch(SERVER + '/__mode')).json();
    expect(plan === 'pro' && source === 'claude' && m.claudeCalls.at(-1).model === 'test-sonnet', 'Pro gets Sonnet: ' + plan + ' ' + source + ' ' + m.claudeCalls.at(-1).model);
    expect((await grant('plus')).plan === 'plus', 'the owner can give Plus');
    [plan] = await chatAs(token);
    m = await (await fetch(SERVER + '/__mode')).json();
    expect(plan === 'plus' && m.claudeCalls.at(-1).model === 'test-haiku', 'Plus gets Haiku');
    // the app learns the plan from the account (so it can open the Plus extras)
    const me = await page.evaluate(async ([srv, t]) => (await (await fetch(srv + '/auth/me', { headers: { authorization: 'Bearer ' + t } })).json()), [SERVER, token]);
    expect(me.plan && me.plan.plan === 'plus' && me.plan.until > Date.now(), 'the account says Plus: ' + JSON.stringify(me.plan));
    const appPlan = await page.evaluate(async (t) => { localStorage.setItem(AUTH_KEY, t); state.plan = null; await refreshPlan(true); const p = planName(); localStorage.removeItem(AUTH_KEY); state.plan = null; return p; }, token);
    expect(appPlan === 'plus', 'the app picks up a plan given on the dashboard: ' + appPlan);
    // the dashboard's Plans box gives it in a few taps
    const dash = await ctx.newPage();
    await dash.goto(SERVER + '/');
    await dash.fill('#tok', 'test-admin-token-0123456789'); await dash.click('#go');
    await dash.fill('#plan-email', email); await dash.selectOption('#plan-kind', 'pro'); await dash.selectOption('#plan-days', '365');
    await dash.click('#plan-give');
    await dash.waitForFunction(() => /has Pro until/.test(document.getElementById('plan-msg').textContent), null, { timeout: 8000 });
    expect((await grant('plus')).plan === 'plus', 'back to Plus for the rest');
    await dash.close();
    // with the real default (no Claude for free students), a free student is answered by Groq
    await serverMode({ freeClaude: 0 });
    const before = m.claudeCount;
    [plan, source] = await chatAs('');
    m = await (await fetch(SERVER + '/__mode')).json();
    expect(plan === 'free' && source === 'groq' && m.claudeCount === before, 'free students don’t use Claude: ' + plan + ' ' + source);
    await serverMode({ freeClaude: 3 });
    // Claude down → the answer still comes (Groq on the server)
    await serverMode({ claude: 'down', reply: 'Groq covered for Claude.' });
    const c = await ask(page, 'And respiration?');
    expect(/Groq covered/.test(await c.textContent()), 'Groq should cover: ' + await c.textContent());
    await ctx.close();
  } finally { await serverMode({ claude: 'off', reply: '', freeClaude: null }); }
});

test('board: Cassie draws on it when asked', async (b) => {
  const { ctx, page } = await open(b, { server: false, state: { groqKey: 'gsk_test' }, fakeGroq: () => ({ text: 'Here it is — a parabola crossing at ±2.\n\n```cassie-board\n{"type":"graph","title":"y = x^2 - 4","fn":"x^2 - 4","xrange":[-4,4],"points":[{"x":-2,"y":0,"label":"x=-2"},{"x":2,"y":0,"label":"x=2"}]}\n```' }) });
  await page.click('#board-btn');
  await page.waitForSelector('.csk-ask input');
  await page.fill('.csk-ask input', 'graph y = x^2 - 4');
  await page.press('.csk-ask input', 'Enter');
  await page.waitForFunction(() => window.CassieSketch.session() && window.CassieSketch.session().drawn() === 1, null, { timeout: 10000 });
  const note = await page.locator('.csk-note').textContent();
  expect(/parabola/.test(note) && !/cassie-board|"fn"/.test(note), 'the note shows words only: ' + note);
  // undo takes Cassie's whole drawing away in one step
  await page.click('.csk-zoom [data-act="undo"]');
  expect(await page.evaluate(() => window.CassieSketch.session().drawn()) === 0, 'undo should remove her drawing');
  await ctx.close();
});

test('highlight text in an answer → Explain; switched off, highlighting is just highlighting', async (b) => {
  const { ctx, page } = await open(b, { server: false, state: { groqKey: 'gsk_test' }, fakeGroq: (body, n) => ({ text: n === 1 ? 'Osmosis is the movement of water across a membrane.' : 'Simply put: water moves to where there is less water.' }) });
  const a = await ask(page, 'What is osmosis?');
  // right-click keeps the browser menu (Copy)
  await a.locator('p').first().selectText();
  const box = await a.locator('p').first().boundingBox();
  const kept = await page.evaluate(([x, y]) => { const el = document.elementFromPoint(x, y); const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y }); return el.dispatchEvent(ev); }, [box.x + 10, box.y + 5]);
  expect(kept, 'right-click on a highlight should keep the browser menu');
  // ON (the default): highlighting opens Explain / Answer / Code
  await page.mouse.up();
  await page.waitForSelector('#highlight-popover:not([hidden]) [data-mode=explain]', { timeout: 5000 });
  expect(await page.locator('#ask-chip').count() === 0, 'no separate Ask Cassie button any more');
  await page.click('#highlight-popover [data-mode=explain]');
  await page.waitForSelector('#highlight-popover >> text=Simply put', { timeout: 10000 });
  await page.click('#highlight-popover-close');
  // OFF, with the switch in the sidebar: highlighting is just highlighting
  await page.evaluate(() => (sideWide.matches ? setSideOpen(true) : openSidebar())); // (a phone: the menu)
  await page.waitForTimeout(400);
  if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/app-hl-switch.png' });
  await page.click('.side-hl');
  expect(await page.evaluate(() => state.highlightHelp === false), 'the sidebar switch turns highlight help off');
  await page.evaluate(() => closeSidebar());
  await page.waitForTimeout(400);
  await a.locator('p').first().selectText(); await page.mouse.up();
  await page.waitForTimeout(800);
  expect(await page.locator('#highlight-popover').isHidden(), 'with highlight help off, nothing shows');
  await ctx.close();
});

test.slow('study tools in the sidebar: Flashcards one tap away mid-chat (a rail of icons or the full sidebar on a computer, the menu on a phone), Search, the highlight switch, and Ideas to get started points there', async (b) => {
  const { tapResponseIssues } = require('./ui-checks.cjs');
  const reply = () => ({ text: 'Osmosis is water moving across a membrane.' });
  // ---- a computer ----
  const { ctx, page, errors } = await open(b, { device: 'Desktop Chrome', viewport: { width: 1280, height: 800 }, server: false, state: { groqKey: 'gsk_test' }, fakeGroq: reply });
  ctx.on('page', (p) => { if (p !== page) p.close().catch(() => {}); }); // (Help opens in a new tab: closed at once, so this page stays in front and keeps drawing)
  expect(await page.locator('.ideas-panel, .ideas-shade').count() === 0, 'the old Ideas panel is gone');
  await page.evaluate(() => deskGo('home'));
  expect(await page.locator('.home-ideas').isVisible(), 'Ideas to get started is on Home');
  await ask(page, 'What is osmosis?');
  const geo = () => page.evaluate(() => { const s = document.getElementById('sidebar').getBoundingClientRect(), a = document.getElementById('app').getBoundingClientRect(), c = document.getElementById('chat-log').getBoundingClientRect(); return { open: document.body.classList.contains('side-open'), side: Math.round(s.width), app: Math.round(a.left), chat: Math.round(c.left), wide: document.documentElement.scrollWidth > innerWidth + 1 }; });
  let g = await geo();
  expect(g.open && g.side >= 260 && g.app >= g.side && !g.wide, 'the full sidebar at first (like the reference), the chat beside it: ' + JSON.stringify(g));
  const inView = (sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return 'missing'; const r = e.getBoundingClientRect(); return r.height > 0 && r.top >= 0 && r.bottom <= innerHeight ? 'ok' : JSON.stringify(r); }, sel);
  expect(await page.locator('#side-menu-toggle').getAttribute('aria-expanded') === 'false', 'the tool list starts folded');
  for (const sel of ['#side-nav [data-page="home"]', '#side-nav [data-page="chats"]', '#side-apps #labs-btn', '#side-general #settings-btn']) expect(await inView(sel) === 'ok', 'in view without scrolling: ' + sel + ' ' + await inView(sel));
  // the chevron: a slim rail of icons
  await page.click('#side-toggle'); await page.waitForTimeout(400);
  g = await geo();
  expect(!g.open && g.side >= 60 && g.side <= 90 && g.app >= g.side && g.chat >= g.side && !g.wide, 'a slim rail beside the chat, nothing covered: ' + JSON.stringify(g));
  const fc = page.locator('.side-tool[data-tip="Flashcards"]');
  const fb = await fc.boundingBox();
  expect(await fc.isVisible() && fb && fb.x + fb.width <= g.side, 'the rail shows Flashcards: ' + JSON.stringify(fb));
  expect(!(await fc.locator('span').isVisible()), 'the rail is icons only');
  await fc.scrollIntoViewIfNeeded(); await fc.hover();
  await page.waitForSelector('#side-tip:not([hidden])', { timeout: 2000 });
  expect((await page.locator('#side-tip').innerText()) === 'Flashcards', 'the tooltip names it');
  await fc.click();
  await page.waitForSelector('.fc:not([hidden]) .fc-x', { timeout: 5000 });
  await page.waitForFunction(() => document.querySelector('.side-tool[data-tip="Flashcards"]').classList.contains('on'), null, { timeout: 2000 });
  if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/side-rail-cards.png' });
  await page.click('.fc-x');
  await page.waitForFunction(() => !document.querySelector('.side-tool[data-tip="Flashcards"]').classList.contains('on'), null, { timeout: 2000 });
  await page.click('#side-toggle'); await page.waitForTimeout(400);
  await page.click('#side-menu-toggle');
  const labels = await page.evaluate(() => HOME_EXAMPLES.map((x) => x.label));
  for (const l of labels) expect(await page.locator('.side-tool', { hasText: l }).locator('span').isVisible(), 'the full sidebar shows ' + l);
  if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/side-open.png' });
  await page.reload(); await page.waitForTimeout(800);
  expect((await geo()).open, 'still the full sidebar after a reload');
  // Search (the top bar): pages, tools and chats that match
  await page.fill('#top-q', 'flash');
  let hits = await page.locator('#top-results [role="option"]').allInnerTexts();
  expect(hits.length === 1 && /Flashcards/.test(hits[0]) && /Tool/.test(hits[0]), 'flash finds Flashcards: ' + JSON.stringify(hits));
  await page.fill('#top-q', 'osmo');
  hits = await page.locator('#top-results [role="option"]').allInnerTexts();
  expect(hits.length === 1 && /osmosis/i.test(hits[0]) && /Chat/.test(hits[0]), 'osmo finds the chat: ' + JSON.stringify(hits));
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => /osmosis/i.test(document.getElementById('chat-log').innerText), null, { timeout: 3000 });
  // nothing covered or scrolling sideways, either way, at three widths
  for (const open of [true, false]) {
    await page.evaluate((o) => setSideOpen(o), open);
    for (const width of [1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: width === 1024 ? 768 : width === 1440 ? 900 : 800 }); await page.waitForTimeout(350);
      g = await geo();
      expect(g.open === open && g.app >= g.side && g.chat >= g.side && !g.wide, `${width}, ${open ? 'full' : 'rail'}: ` + JSON.stringify(g));
    }
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  // the tap test on the sidebar, both ways
  const reopen = async () => { await page.goto(APP); await page.waitForTimeout(800); return page; };
  for (const open of [false, true]) {
    await page.evaluate((o) => { setSideOpen(o); setToolsOpen(true); }, open); await page.waitForTimeout(350);
    const bad = await tapResponseIssues(page, { reopen: async () => { const p = await reopen(); await p.evaluate((o) => { setSideOpen(o); setToolsOpen(true); }, open); await p.waitForTimeout(350); return p; }, touch: false, scope: '#sidebar, #side-toggle', skip: /delete|×/i, perKind: 3 });
    expect(!bad.length, `the sidebar (${open ? 'full' : 'rail'}) answers taps: ` + JSON.stringify(bad).slice(0, 600));
  }
  // Ideas to get started: the home screen of a new chat shows where the tools are
  await page.goto(APP); await page.waitForTimeout(600);
  await page.evaluate(() => { setSideOpen(false); deskGo('home'); });
  await page.click('.home-ideas');
  await page.waitForFunction(() => document.body.classList.contains('side-open') && document.querySelector('.side-tools.flash'), null, { timeout: 2000 });
  // folded or not is kept too
  await page.evaluate(() => setToolsOpen(false)); await page.reload(); await page.waitForTimeout(600);
  expect(await page.locator('#side-menu-toggle').getAttribute('aria-expanded') === 'false', 'folded after a reload');
  expect(errors.length === 0, 'page errors: ' + errors.join('; '));
  await ctx.close();

  // ---- a phone ----
  const ph = await open(b, { device: 'iPhone 13', touch: true, server: false, state: { groqKey: 'gsk_test' }, fakeGroq: reply });
  const pp = ph.page;
  await pp.evaluate(() => { const t = document.querySelector('.tabbar [data-tab="chat"]'); if (t && t.offsetParent) t.click(); });
  await ask(pp, 'What is osmosis?');
  expect(await pp.evaluate(() => document.getElementById('sidebar').getBoundingClientRect().right <= 0) && !(await pp.locator('#side-toggle').isVisible()), 'no rail on a phone');
  await pp.tap('#menu-btn');
  await pp.waitForFunction(() => document.getElementById('sidebar').classList.contains('open'), null, { timeout: 2000 }); await pp.waitForTimeout(300);
  const pin = (sel) => pp.evaluate((s) => { const e = document.querySelector(s); const r = e && e.getBoundingClientRect(); return !!r && r.height > 0 && r.top >= 0 && r.bottom <= innerHeight - 70; }, sel); // (above the tab bar)
  expect(await pin('#pomo-toggle') && await pin('#chat-list .chat-item'), 'phone, folded: the timer’s Start and the first chat are in view');
  await pp.tap('#side-menu-toggle'); await pp.waitForTimeout(200);
  const pfb = await pp.locator('.side-tool[data-tip="Flashcards"]').boundingBox();
  expect(pfb && pfb.height >= 44 && pfb.y + pfb.height <= 844, 'Flashcards is in the menu, 44px tall: ' + JSON.stringify(pfb));
  if (process.env.SHOTS) await pp.screenshot({ path: process.env.SHOTS + '/side-phone.png' });
  await pp.tap('.side-tool[data-tip="Flashcards"]');
  await pp.waitForSelector('.fc:not([hidden]) .fc-x', { timeout: 5000 });
  expect(!(await pp.evaluate(() => document.getElementById('sidebar').classList.contains('open'))), 'the menu closes');
  await pp.tap('.fc-x');
  // the tap test on the phone's menu
  const preopen = async () => { await pp.goto(APP); await pp.waitForTimeout(800); await pp.evaluate(() => { const t = document.querySelector('.tabbar [data-tab="chat"]'); if (t && t.offsetParent) t.click(); openSidebar(); setToolsOpen(true); }); await pp.waitForTimeout(400); return pp; };
  await preopen();
  // (Close menu is left out: the menu takes longer to slide away than the check waits; closing is checked above)
  const pbad = await tapResponseIssues(pp, { reopen: preopen, touch: true, scope: '#sidebar', skip: /delete|×|close menu/i, perKind: 3 });
  expect(!pbad.length, 'the phone menu answers taps: ' + JSON.stringify(pbad).slice(0, 600));
  expect(ph.errors.length === 0, 'page errors: ' + ph.errors.join('; '));
  await ph.ctx.close();
});


test('Talk mode and Hint answer', async (b) => {
  const { ctx, page, groqCalls } = await open(b, { server: false, state: { groqKey: 'gsk_test' } });
  await page.fill('#prompt-input', 'How do I solve 2x + 3 = 7?');
  await page.click('#hint-btn');
  await page.waitForSelector('text=Own-key answer', { timeout: 10000 });
  await page.click('#talk-btn');
  await page.waitForSelector('text=real talk mode');
  await ask(page, 'I feel stressed about exams');
  expect(groqCalls.length === 2, 'expected 2 AI calls, got ' + groqCalls.length);
  await ctx.close();
});

test('phones: a ?text= link (iPhone Shortcut) asks what to do, then answers about it', async (b) => {
  const { ctx, page, groqCalls } = await open(b, { server: false, state: { groqKey: 'gsk_test' }, fakeGroq: () => ({ text: 'Mitochondria make the cell’s energy.' }) });
  await page.goto(APP + '?text=' + encodeURIComponent('The mitochondria is the powerhouse of the cell.') + '&url=' + encodeURIComponent('https://www.biology.org/cells'));
  await page.waitForSelector('.share-card', { timeout: 5000 });
  expect(/powerhouse/.test(await page.locator('.share-quote').textContent()) && /biology\.org/.test(await page.locator('.share-from').textContent()), 'the card shows the words and where they came from');
  expect(!/text=/.test(page.url()), 'the link is cleaned from the address bar');
  await page.click('.share-card .chip:has-text("Explain")');
  await page.waitForSelector('text=Mitochondria make', { timeout: 10000 });
  const sent = JSON.stringify(groqCalls.at(-1).messages.at(-1));
  expect(/Explain this step by step/.test(sent) && /powerhouse/.test(sent), 'Explain should send the shared words');
  // a typed question about shared words includes them
  await page.goto(APP + '?text=' + encodeURIComponent('E = mc^2'));
  await page.waitForSelector('.share-card');
  await ask(page, 'what does c stand for?');
  expect(/what does c stand for\?[\s\S]*E = mc\^2/.test(JSON.stringify(groqCalls.at(-1).messages.at(-1))), 'the typed question should include the shared words');
  await ctx.close();
});

test('iPhone Shortcut: /ask answers in plain text (for a pop-up, no new tab)', async () => {
  await serverMode({ groq: 'ok', reply: '**Answer:** x = 3\n\n# Steps\n- Subtract 2\n- Divide by 2' });
  try {
    const r = await fetch(SERVER + '/ask?text=' + encodeURIComponent('Solve 2x + 2 = 8'));
    const t = await r.text();
    expect(r.ok && /text\/plain/.test(r.headers.get('content-type')), 'plain text back');
    expect(/Answer: x = 3/.test(t) && !/\*\*|^#/m.test(t) && /• Subtract 2/.test(t), 'markdown is turned into plain text: ' + t);
    const m = await (await fetch(SERVER + '/__mode')).json();
    expect(m.calls > 0, 'it asked the AI');
    const empty = await (await fetch(SERVER + '/ask')).text();
    expect(/Select some words/.test(empty), 'no text → a friendly hint');
  } finally { await serverMode({ reply: '' }); }
});

test('phones: maths copied from a PDF is cleaned and rebuilt before solving', async (b) => {
  const { ctx, page, groqCalls } = await open(b, { server: false, state: { groqKey: 'gsk_test' }, fakeGroq: () => ({ text: 'I read this as: x² + 5x + 6 = 0, so x = −2 or x = −3.' }) });
  await page.goto(APP + '?text=' + encodeURIComponent('Solve 𝑥2 + 5𝑥 + 6 = 0'));
  await page.waitForSelector('.share-card');
  expect(/Solve x2 \+ 5x \+ 6 = 0/.test(await page.locator('.share-quote').textContent()), 'PDF math letters become normal letters: ' + await page.locator('.share-quote').textContent());
  expect(await page.locator('.share-tip').isVisible(), 'a screenshot tip shows for equations');
  await page.click('.share-card .chip:has-text("Answer")');
  await page.waitForSelector('text=I read this as', { timeout: 10000 });
  expect(/x2.*usually means x²/.test(JSON.stringify(groqCalls.at(-1).messages.at(-1))), 'Cassie is told how to rebuild flattened maths');
  await ctx.close();
});

test('server: GET /speak says how many studio characters are left (a number) and when they come back, counting nothing', async () => {
  await fetch(SERVER + '/__reset');
  const ext = { origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop' };
  const token = (await (await fetch(SERVER + '/auth/signup', { method: 'POST', headers: { ...ext, 'content-type': 'application/json' }, body: JSON.stringify({ email: `voice${Date.now()}@example.com`, password: 'longenough1', age: 20 }) })).json()).token;
  const hdr = { ...ext, authorization: 'Bearer ' + token }; // (the studio voice is for accounts)
  const left = async (uid = 'voice-test-uid-1') => (await fetch(`${SERVER}/speak?uid=${uid}`, { headers: hdr })).json();
  try {
    await serverMode({ speakOn: false });
    let d = await left();
    expect(d.on === false && d.left === 0, 'off: nothing left: ' + JSON.stringify(d));
    await serverMode({ speakOn: true, speakMonth: 1000, elevenCalls: 0 });
    d = await left();
    const now = new Date(Date.now() + 8 * 3600e3), y = now.getUTCFullYear(), m = now.getUTCMonth() + 1;
    const next = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`;
    expect(JSON.stringify(Object.keys(d).sort()) === '["back","left","max","on","plan","used"]' && d.max === 7500 && d.on === true && d.left === 1000 && typeof d.left === 'number' && d.back === next, 'on: the month’s 1000 left, back on the 1st: ' + JSON.stringify(d));
    expect((await left()).left === 1000, 'asking again counts nothing');
    const said = await fetch(SERVER + '/speak', { method: 'POST', headers: { ...hdr, 'content-type': 'application/json' }, body: JSON.stringify({ text: 'Hello there, student.', voice: 'woman', uid: 'voice-test-uid-1' }) });
    expect(said.status === 200 && /audio\/mpeg/.test(said.headers.get('content-type')), 'a sentence is said: ' + said.status);
    d = await left('voice-test-uid-2');
    expect(d.left === 1000 - 'Hello there, student.'.length, 'what was said comes off the month: ' + JSON.stringify(d));
    // the extension (no sign-in): no studio voice, it types instead
    const g = await (await fetch(`${SERVER}/speak?uid=voice-test-uid-3`, { headers: ext })).json();
    const gp = await fetch(SERVER + '/speak', { method: 'POST', headers: { ...ext, 'content-type': 'application/json' }, body: JSON.stringify({ text: 'Hi', voice: 'woman', uid: 'voice-test-uid-3' }) });
    expect(g.guest === true && g.left === 0 && gp.status === 401, 'not signed in (the extension too): no studio voice: ' + JSON.stringify(g) + ' ' + gp.status);
    expect((await serverMode({})).elevenCalls === 1, 'one call to ElevenLabs');
  } finally { await serverMode({ speakOn: false, speakMonth: null }); }
});

test('server: the Chrome / Edge extension may use it, other sites may not', async () => {
  await fetch(SERVER + '/__reset');
  const body = JSON.stringify({ uid: 'ext-test-uid-123', messages: [{ role: 'user', content: 'hi' }] });
  const ok = await fetch(SERVER + '/chat', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop' }, body });
  expect(ok.status === 200, 'the extension should be allowed: ' + ok.status);
  const no = await fetch(SERVER + '/chat', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example.com' }, body });
  expect(no.status === 403, 'other sites stay blocked: ' + no.status);
});

test('5 students at once on one school network: everyone gets an answer, even past Groq’s per-minute limit', async () => {
  await fetch(SERVER + '/__reset');
  const pic = [{ type: 'text', text: 'Read the sum in this picture and work it out. Reply with only the number.' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,' + PNG.toString('base64') } }];
  const ask = (i, content) => fetch(SERVER + '/chat', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop' },
    body: JSON.stringify({ uid: `student-${i}-of-five`, messages: [{ role: 'user', content }] }) });
  try {
    for (const kind of ['text', 'picture']) {
      await serverMode({ groq: 'limit2', groqCount: 0, gemini: 'off', groqVision: 'ok', aiVision: 'ok' });
      const t0 = Date.now();
      const rs = await Promise.all([0, 1, 2, 3, 4].map((i) => ask(i, kind === 'text' ? 'What is 17 × 23? Reply with only the number.' : pic)));
      const out = await Promise.all(rs.map(async (r) => ({ status: r.status, source: r.headers.get('x-cassie-source'), text: (await r.json()).choices?.[0]?.message?.content || '' })));
      expect(out.every((o) => o.status === 200 && o.text), `${kind}: all 5 should get an answer: ` + JSON.stringify(out));
      expect(out.filter((o) => o.source === 'groq').length === 2 && out.filter((o) => o.source !== 'groq').length === 3, `${kind}: 2 from Groq, 3 from the backup: ` + JSON.stringify(out.map((o) => o.source)));
      expect(Date.now() - t0 < 10000, `${kind}: nobody waits on Groq’s limit (${Date.now() - t0} ms)`);
    }
  } finally { await serverMode({ groq: 'ok', groqCount: 0, gemini: 'off' }); }
});

// ---- what went wrong for real users: providers retiring or refusing their picture models ----
const redPng = (page) => page.evaluate(() => { const c = document.createElement('canvas'); c.width = c.height = 40; const g = c.getContext('2d'); g.fillStyle = 'red'; g.fillRect(0, 0, 40, 40); return c.toDataURL('image/png').split(',')[1]; });
// the board's Study together: in its header on a computer, in its More menu on a phone
async function studyTogether(page) {
  await page.waitForSelector('.csk-live', { timeout: 15000 });
  const head = page.locator('.csk-head .csk-btn:has-text("Study together")');
  if (await head.isVisible()) { await head.click(); return; }
  await page.click('.csk-head [data-act="more"]');
  await page.click('.csk-more [data-more="extra"]:has-text("Study together")');
}
async function sendPhoto(page, q) {
  await page.setInputFiles('#file-input', { name: 'eq.png', mimeType: 'image/png', buffer: Buffer.from(await redPng(page), 'base64') });
  await page.waitForSelector('#attach-preview:not([hidden])', { timeout: 10000 });
  return ask(page, q);
}

test('server pictures: a retired Groq picture model → the next one', async (b) => {
  await serverMode({ groqVision: 'second', reply: 'The second picture model read it.' });
  try {
    const { ctx, page } = await open(b);
    const a = await sendPhoto(page, 'What is in this picture?');
    expect(/second picture model/.test(await a.textContent()), 'got: ' + await a.textContent());
    const m = await (await fetch(SERVER + '/__mode')).json();
    expect(m.lastCalls.includes('meta-llama/llama-4-scout-17b-16e-instruct') && m.lastCalls.includes('qwen/qwen3-vl-32b'), 'both picture models should be tried: ' + m.lastCalls);
    await ctx.close();
  } finally { await serverMode({ groqVision: 'ok', reply: '' }); }
});

test('server pictures: no Groq picture model at all → the owner’s Gemini reads it', async (b) => {
  await serverMode({ groqVision: 'retired', gemini: 'ok', geminiReply: 'Gemini on the server read the equation.', geminiCalls: [] });
  try {
    const { ctx, page } = await open(b);
    const a = await sendPhoto(page, 'Solve this and graph it');
    expect(/Gemini on the server read/.test(await a.textContent()), 'got: ' + await a.textContent());
    await ctx.close();
  } finally { await serverMode({ groqVision: 'ok', gemini: 'off', geminiReply: '' }); }
});

test('server pictures: Groq has none and Gemini is over its free limit → Workers AI reads it', async (b) => {
  await serverMode({ groqVision: 'retired', gemini: 'down', aiVision: 'ok' });
  try {
    const { ctx, page } = await open(b);
    const a = await sendPhoto(page, 'What is in this picture?');
    expect(/Workers AI read the picture/.test(await a.textContent()), 'got: ' + await a.textContent());
    await ctx.close();
  } finally { await serverMode({ groqVision: 'ok', gemini: 'off' }); }
});

test('server pictures: when nothing can read it, the problem shows on the dashboard', async (b) => {
  await serverMode({ groqVision: 'retired', gemini: 'off', aiVision: 'down' });
  try {
    const { ctx, page } = await open(b);
    const a = await sendPhoto(page, 'What is this?');
    expect(/try again|busy|reach/i.test(await a.textContent()), 'a friendly error: ' + await a.textContent());
    const st = await serverStats();
    const prob = (st.problems || []).find((p) => p.k === 'chat: picture');
    expect(prob && prob.n >= 1, 'the dashboard should list the picture problem: ' + JSON.stringify(st.problems));
    await page.waitForTimeout(400);
    const st2 = await serverStats();
    expect((st2.reports || []).some((r) => r.kind === 'auto' && /chat/.test(r.feature)), 'the app reports its own error (no question text)');
    await ctx.close();
  } finally { await serverMode({ groqVision: 'ok', aiVision: 'ok' }); }
});

test('graph it: a bare equation is graphed even when no AI answers', async (b) => {
  await serverMode({ groq: 'down', ai: 'down' });
  try {
    const { ctx, page } = await open(b);
    const a = await ask(page, 'x^2(x+6)^3(x-4) graph it');
    expect(await a.locator('.cassie-board').count() === 1, 'the graph should still be drawn: ' + await a.textContent());
    expect(/couldn’t reach my brain/.test(await a.textContent()), 'and say why there is no explanation');
    await ctx.close();
  } finally { await serverMode({ groq: 'ok', ai: 'ok' }); }
});

test('graph it: a bare equation gets a board even if the AI forgets to draw one', async (b) => {
  const { ctx, page } = await open(b, { server: false, state: { groqKey: 'gsk_test' }, fakeGroq: () => ({ text: 'The zeros are at 0, −6 and 4.' }) });
  const a = await ask(page, '2x^3 - 8x graph it please');
  expect(await a.locator('.cassie-board').count() === 1, 'a board should be added');
  await ctx.close();
});

test('board: an equation typed on the board is sent as text (no picture to misread)', async (b) => {
  const { ctx, page, groqCalls } = await open(b, { server: false, state: { groqKey: 'gsk_test' }, fakeGroq: () => ({ text: 'Here it is.\n\n```cassie-board\n{"type":"graph","title":"y = x^2 - 1","fn":"x^2 - 1","xrange":[-3,3]}\n```' }) });
  await page.click('#board-btn');
  await page.waitForSelector('.csk-ask input');
  await page.click('[data-tool="text"]');
  const box = await page.locator('.csk-live').boundingBox();
  await page.mouse.click(box.x + 80, box.y + 80);
  await page.keyboard.type('y = x^2 - 1');
  await page.click('.csk-ask input'); // the text box commits when it loses focus
  await page.fill('.csk-ask input', 'graph it');
  await page.press('.csk-ask input', 'Enter');
  await page.waitForFunction(() => window.CassieSketch.session().drawn() === 1, null, { timeout: 10000 });
  const last = groqCalls.at(-1).messages.at(-1);
  expect(typeof last.content === 'string' && /y = x\^2 - 1/.test(last.content), 'the typed equation goes as text: ' + JSON.stringify(last).slice(0, 200));
  await ctx.close();
});

test('brain check: real questions with known answers, saved for the dashboard', async () => {
  await serverMode({ gemini: 'ok', groqVision: 'ok', reply: '', geminiReply: '' });
  try {
    const r = await (await fetch(SERVER + '/health', { headers: { authorization: 'Bearer test-admin-token-0123456789' } })).json();
    const by = Object.fromEntries(r.checks.map((c) => [c.name, c.ok]));
    expect(by['Groq: text maths'] && by['Groq: graph on the board'] && by['Groq: read a picture'] && by['Gemini: read a picture'] && by['Workers AI (backup): read a picture'], 'all checks should pass: ' + JSON.stringify(r.checks));
    expect(r.ok && r.canText && r.canPictures, 'overall ok');
    expect((await serverStats()).health.ts === r.ts, 'the dashboard gets the latest result');
    // Gemini: the server asks Google which models this key has, so a retired name (gemini-2.5-flash) never stalls it
    const m1 = await serverMode({});
    expect(m1.geminiListed >= 1 && m1.geminiCalls.includes('gemini-9.0-flash') && !m1.geminiCalls.some((x) => /image|embedding/.test(x)), 'Gemini should use the models Google lists: ' + JSON.stringify(m1.geminiCalls));
    // Groq renamed its picture model to a name Cassie doesn't know: she finds it by showing each model a picture
    await serverMode({ groqVision: 'renamed' });
    const renamed = await (await fetch(SERVER + '/health', { headers: { authorization: 'Bearer test-admin-token-0123456789' } })).json();
    const pic = renamed.checks.find((c) => c.name === 'Groq: read a picture');
    expect(pic.ok && /acme\/new-eyes-9b/.test(pic.detail), 'the renamed picture model should be found: ' + JSON.stringify(pic));
    expect(renamed.checks.every((c) => c.ms < 45000), 'every check has a time limit');
    await serverMode({ groqVision: 'retired', gemini: 'off', aiVision: 'down' });
    const bad = await (await fetch(SERVER + '/health', { headers: { authorization: 'Bearer test-admin-token-0123456789' } })).json();
    expect(!bad.ok && !bad.canPictures && bad.canText, 'a broken picture reader is caught: ' + JSON.stringify(bad.checks));
    expect(/Groq has: openai\/gpt-oss-120b/.test(bad.checks.find((c) => c.name === 'Groq: read a picture').detail), 'it lists the models Groq has');
    expect((await fetch(SERVER + '/health')).status === 401, 'needs the admin token');
    // Google refuses Gemini from where Cloudflare runs Cassie: a warning with the fix, not a broken brain
    await serverMode({ groqVision: 'ok', aiVision: 'ok', gemini: 'location' });
    const loc = await (await fetch(SERVER + '/health', { headers: { authorization: 'Bearer test-admin-token-0123456789' } })).json();
    const g = loc.checks.filter((c) => /^Gemini/.test(c.name));
    expect(loc.ok && g.length === 2 && g.every((c) => c.warn && /Placement → Smart/.test(c.detail)), 'a blocked location is a warning with the fix: ' + JSON.stringify(g));
    await serverMode({ gemini: 'ok' });
    const back = await (await fetch(SERVER + '/health', { headers: { authorization: 'Bearer test-admin-token-0123456789' } })).json();
    expect(back.checks.find((c) => c.name === 'Gemini: text maths').ok, 'Gemini is tried again on the next check');
  } finally { await serverMode({ gemini: 'off', groqVision: 'ok', aiVision: 'ok' }); }
});

test('iPhone: copy words, then Paste & ask', async (b) => {
  const { ctx, page, groqCalls } = await open(b, { server: false, state: { groqKey: 'gsk_test' }, fakeGroq: () => ({ text: 'Inertia means objects keep doing what they are doing.' }) });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(APP).origin });
  await page.evaluate(() => navigator.clipboard.writeText('Newton’s first law is the law of inertia.'));
  await page.click('#paste-btn');
  await page.waitForSelector('.share-card', { timeout: 5000 });
  expect(/law of inertia/.test(await page.locator('.share-quote').textContent()), 'the copied words show in the card');
  await page.click('.share-card .chip:has-text("Explain")');
  await page.waitForSelector('text=Inertia means', { timeout: 10000 });
  expect(/law of inertia/.test(JSON.stringify(groqCalls.at(-1).messages.at(-1))), 'the copied words are sent');
  await ctx.close();
});

test('Android: Share → Cassie (text and a screenshot) opens the app with it', async (b) => {
  const ctx = await b.newContext({ ...devices['Pixel 7'] }); // the service worker receives the share
  await ctx.addInitScript(() => { window.CASSIE_SERVER = ''; });
  await ctx.addInitScript((v) => { if (!localStorage.getItem('cassie.v2')) localStorage.setItem('cassie.v2', JSON.stringify({ profile: { name: 'T', role: 'student', grade: 'Grade 9', age: 14 }, seenVersion: v, lite: 'on', groqKey: 'gsk_test' })); }, APP_VERSION);
  const page = await ctx.newPage();
  await page.goto(APP);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 8000 });
  const share = (fields, file) => page.evaluate(([fields, file]) => {
    const f = document.createElement('form'); f.method = 'POST'; f.action = 'share-target'; f.enctype = 'multipart/form-data';
    for (const [k, v] of Object.entries(fields)) { const i = document.createElement('input'); i.name = k; i.value = v; f.appendChild(i); }
    if (file) {
      const bin = Uint8Array.from(atob(file.b64), (c) => c.charCodeAt(0));
      const dt = new DataTransfer(); dt.items.add(new File([bin], file.name, { type: file.type }));
      const i = document.createElement('input'); i.type = 'file'; i.name = 'file'; i.files = dt.files; f.appendChild(i);
    }
    document.body.appendChild(f); f.submit();
  }, [fields, file]);
  await share({ text: 'Photosynthesis turns light into chemical energy. https://www.example.com/bio', title: '', url: '' });
  await page.waitForSelector('.share-card', { timeout: 10000 });
  expect(/Photosynthesis/.test(await page.locator('.share-quote').textContent()) && !/https/.test(await page.locator('.share-quote').textContent()), 'shared words (without the link) should show');
  expect(/example\.com/.test(await page.locator('.share-from').textContent()), 'where it came from');
  await share({ text: '', title: '', url: '' }, { name: 'screenshot.png', type: 'image/png', b64: PNG.toString('base64') });
  await page.waitForSelector('#attach-preview:not([hidden])', { timeout: 10000 });
  await page.waitForSelector('.att-image img', { timeout: 10000 });
  expect(await page.locator('.att-image img').isVisible(), 'the shared screenshot is attached, ready to ask about');
  await ctx.close();
});

test('no em or en dashes in anything people read (every page, label and message, and Cassie’s own answers)', async (b) => {
  // 1. the source: every string a student can see, in the app, Labs, 3D views, landing page, extension and server
  const U = require('./ui-strings.cjs');
  const found = [];
  for (const f of U.UI_FILES()) for (const x of U.uiStrings(f)) if (/[—–]/.test(x.text)) found.push(`${f}:${x.line} ${JSON.stringify(x.text.trim().slice(0, 80))}`);
  expect(!found.length, `${found.length} em/en dashes in words people read:\n  ` + found.slice(0, 20).join('\n  '));
  // 2. the pages as they show: app.html and index.html, their text and the labels people hover or hear
  const shown = async (page) => page.evaluate(() => document.body.innerText + ' ' + [...document.querySelectorAll('[title],[placeholder],[aria-label],[alt]')]
    .map((e) => ['title', 'placeholder', 'aria-label', 'alt'].map((a) => e.getAttribute(a) || '').join(' ')).join(' ') + ' ' + document.title);
  const { ctx, page } = await open(b, { server: false, state: { groqKey: 'gsk_test' }, fakeGroq: () => ({ text: 'Photosynthesis — the way plants make food — happens in the leaves.\n— Plants need light\nWorld War I (1914–1918) changed maps. See the Michaelis–Menten curve—it bends.' }) });
  expect(!/[—–]/.test(await shown(page)), 'app.html shows a dash: ' + (await shown(page)).match(/.{0,40}[—–].{0,40}/));
  // 3. Cassie’s answers never show one either, even when the model writes them
  const a = await ask(page, 'what is photosynthesis');
  const said = await a.innerText();
  expect(!/[—–]/.test(said), 'Cassie’s answer shows a dash: ' + said);
  expect(/Photosynthesis, the way plants make food, happens/.test(said) && /1914-1918/.test(said) && /Michaelis-Menten/.test(said), 'the dashes became commas and hyphens: ' + said);
  const land = await ctx.newPage();
  await land.goto(APP.replace('app.html', 'index.html'));
  await land.waitForLoadState('domcontentloaded');
  expect(!/[—–]/.test(await shown(land)), 'index.html shows a dash: ' + (await shown(land)).match(/.{0,40}[—–].{0,40}/));
  await ctx.close();
});

test('Get started screen: Cassie is 3D and black and white like her icon (floats, blinks, follows the pointer, hops in) at 390x844 and 1280x800, and the still flat Cassie shows with Reduce Motion or Lite mode', async (b) => {
  const intro = async (o, motion) => {
    const { ctx, page, errors } = await open(b, { state: null, scale: 1, ...o });
    if (motion) await page.emulateMedia({ reducedMotion: motion });
    await page.evaluate((lite) => { localStorage.setItem('cassie.firstRun', JSON.stringify({ step: 'intro' })); if (lite) localStorage.setItem('cassie.v2', JSON.stringify({ lite })); }, o.lite);
    await page.goto(APP);
    await page.waitForSelector('.fr-intro .fr-start', { timeout: 10000 });
    return { ctx, page, errors };
  };
  for (const [size, device, viewport] of [['390x844', 'iPhone 13', { width: 390, height: 844 }], ['1280x800', 'Desktop Chrome', { width: 1280, height: 800 }]]) {
    const { ctx, page, errors } = await intro({ device, viewport, lite: 'off' });
    await page.waitForSelector('.fr-art .fr-bot[data-mascot="3d"] canvas.cassie-3d', { timeout: 20000 });
    // a WebGL picture that keeps drawing (she floats and blinks), with the flat Cassie gone
    const at = () => page.evaluate(() => +document.querySelector('canvas.cassie-3d').dataset.frames);
    const f0 = await at(); await page.waitForTimeout(1500); const f1 = await at();
    expect(f1 > f0, `${size}: the 3D Cassie keeps drawing: ${f0} then ${f1}`);
    // (drawn by the one 3D renderer every Cassie on the page shares)
    const g = await page.evaluate(async () => { const c = document.querySelector('canvas.cassie-3d'); const r = c.getBoundingClientRect(); return { gl: (await import('./cassie-bot3d.js')).contexts(), w: r.width, flat: !!document.querySelector('.fr-art .fr-bot svg') }; });
    expect(g.gl === 1 && g.w >= 160 && !g.flat, `${size}: a 3D picture in place of the flat Cassie, from the one shared renderer: ` + JSON.stringify(g));
    // something is drawn there (an empty picture is a few hundred bytes)
    const shot = await page.locator('canvas.cassie-3d').screenshot();
    expect(shot.length > 4000, `${size}: Cassie is drawn (${shot.length} bytes)`);
    // black and white like her icon, whatever the palette: plenty of white (no colour in it) and some
    // near-black (her eyes)
    const px = await page.evaluate(async (b64) => {
      const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      const g = c.getContext('2d'); g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let white = 0, black = 0;
      for (let i = 0; i < d.length; i += 4) {
        const [r, gr, bl] = [d[i], d[i + 1], d[i + 2]], hi = Math.max(r, gr, bl), lo = Math.min(r, gr, bl);
        if (lo > 225 && hi - lo < 12) white++;
        if (hi < 80) black++;
      }
      return { white: white / (d.length / 4), black: black / (d.length / 4) };
    }, shot.toString('base64'));
    expect(px.white > 0.08 && px.black > 0.0008, `${size}: Cassie is white with black eyes: ` + JSON.stringify(px));
    // she follows the pointer: the picture changes when it moves across the screen
    await page.mouse.move(5, 5); await page.waitForTimeout(900);
    const left = await page.locator('canvas.cassie-3d').screenshot();
    await page.mouse.move(viewport.width - 5, viewport.height - 5); await page.waitForTimeout(900);
    const right = await page.locator('canvas.cassie-3d').screenshot();
    expect(!left.equals(right), `${size}: Cassie turns toward the pointer`);
    // Get started still works with her there
    await page.click('.fr-start');
    await page.waitForFunction(() => !document.querySelector('.fr-intro'), null, { timeout: 8000 });
    await page.waitForTimeout(300);
    expect(!errors.length, `${size}: page errors: ` + errors.join('; '));
    expect(!(await page.locator('canvas.cassie-3d').count()), `${size}: the 3D Cassie is gone with the screen`);
    await ctx.close();
  }
  // Reduce Motion, and Lite mode: the flat Cassie, still, and no 3D (not even loaded)
  for (const [why, o, motion] of [['Reduce Motion', { lite: 'off' }, 'reduce'], ['Lite mode', { lite: 'on' }, null]]) {
    const { ctx, page, errors } = await intro(o, motion);
    const loaded = [];
    page.on('request', (r) => { if (/cassie-3d\.js|cassie-bot3d\.js|three\.module/.test(r.url())) loaded.push(r.url()); });
    await page.waitForTimeout(1500);
    const st = await page.evaluate(() => { const h = document.querySelector('.fr-art .fr-bot'); return { m: h.dataset.mascot, svg: !!h.querySelector('svg'), canvas: !!h.querySelector('canvas') }; });
    expect(st.m === '2d' && st.svg && !st.canvas && !loaded.length, `${why}: the flat Cassie only: ` + JSON.stringify(st) + ' ' + loaded.join(' '));
    // still: two pictures a moment apart are the same
    const a = await page.locator('.fr-art .fr-bot').screenshot(); await page.waitForTimeout(700);
    const c = await page.locator('.fr-art .fr-bot').screenshot();
    expect(a.equals(c), `${why}: the flat Cassie doesn't move`);
    expect(!errors.length, `${why}: page errors: ` + errors.join('; '));
    await ctx.close();
  }
});

// The 3D Cassie everywhere (cassie-bot3d.js): the flat Cassie's every state and accessory, drawn in 3D
test('3D Cassie: every state and every accessory draws a different 3D picture with no errors, every Cassie on the page shares one WebGL context, and her first frame never freezes the page over 300ms', async (b) => {
  const ctx = await b.newContext({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
  // (counts every WebGL context the page makes)
  await ctx.addInitScript(() => { window.__gl = 0; const gc = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (k, o) { const c = gc.call(this, k, o); if (c && /webgl/.test(k) && !this.__counted) { this.__counted = true; window.__gl++; } return c; }; });
  const url = APP.replace('app.html', '__cassie3d.html');
  await ctx.route(url, (r) => r.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><style>.h{width:160px;height:160px;display:inline-block}.cassie-bot{width:100%;height:100%;display:block}</style></head><body>
    <div class="h" id="a"></div><div class="h" id="b"></div><div class="h" id="c"></div>
    <script>window.__long = 0; new PerformanceObserver((l) => l.getEntries().forEach((e) => { window.__long = Math.max(window.__long, e.duration); })).observe({ type: 'longtask' });</script>
    <script src="cassie-bot.js"></script>
    <script>window.bots = ['a', 'b', 'c'].map((id, i) => CassieBot.create(document.getElementById(id), { pokeable: i === 0, glow: i === 1, state: ['idle', 'thinking', 'love'][i] }));</script></body></html>` }));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  await page.waitForFunction(() => document.querySelectorAll('canvas.cassie-bot-3d').length === 3 && [...document.querySelectorAll('canvas.cassie-bot-3d')].every((c) => +c.dataset.frames > 1), null, { timeout: 30000 });
  const t = await page.evaluate(async () => { const m = await import('./cassie-bot3d.js'); return { ...m.timings(), gl: window.__gl, contexts: m.contexts(), long: window.__long, flat: document.querySelectorAll('svg.cassie-bot').length, err: m.lastError() }; });
  expect(t.gl === 1 && t.contexts === 1, 'three Cassies, one WebGL context: ' + JSON.stringify(t));
  expect(t.flat === 0, 'the flat drawings are swapped out: ' + t.flat);
  const worst = Math.max(t.setup, t.step, t.slowest);
  expect(worst < 300, `her first frame never holds the page up 300ms or more (setup ${Math.round(t.setup)}, steps ${t.steps}, slowest frame ${Math.round(t.slowest)})`);
  expect(t.long < 300, `no long freeze while she starts (longest task ${Math.round(t.long)}ms)`);
  // (the part that runs the moment she comes into view, often right after a tap that jumps down the page:
  // her body's rounded 3D shape took about 57 ms there, now it's built in one of the quiet steps)
  expect(t.setup < 30, `what runs as she comes into view stays small: ${Math.round(t.setup)} ms (her 3D body is built in a quiet step)`);
  if (process.env.TIMES) console.log('    3D Cassie start: ' + JSON.stringify(t));
  // every state and every accessory: the same API as the flat Cassie, and a different picture each time
  // (she's held still, so only the state or the accessory changes the picture)
  // (makes the change, then waits for the picture drawn after it)
  const pic = (how, arg) => page.evaluate(async ([how, arg]) => { const c = document.querySelector('#a canvas.cassie-bot-3d'); const f = +c.dataset.frames; bots[0][how](arg); await new Promise((r) => { const k = () => (+c.dataset.frames > f ? r() : requestAnimationFrame(k)); k(); }); return c.toDataURL(); }, [how, arg]);
  await page.evaluate(() => bots[0].pause(true));
  const names = await page.evaluate(() => ({ states: CassieBot.STATES, acc: CassieBot.ACCESSORIES }));
  expect(names.states.length >= 25 && names.acc.length >= 14 && names.acc.includes('glasses'), 'every state and accessory: ' + JSON.stringify(names));
  const idle = await pic('setState', 'idle');
  const same = [];
  for (const s of names.states) {
    if (s === 'idle') continue;
    const p = await pic('setState', s);
    const st = await page.evaluate(() => document.querySelector('#a canvas.cassie-bot-3d').dataset.state);
    if (p === idle || st !== s) same.push(s);
  }
  expect(!same.length, 'these states drew the same picture as idle: ' + same.join(', '));
  // blush only where the mood calls for it: none when idle, thinking or sad; pink cheeks when greeting, in love or proud
  const pink = async (st) => { const url = await pic('setState', st); return page.evaluate(async (url) => { const img = new Image(); img.src = url; await img.decode(); const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0); const d = g.getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200 && d[i] > 200 && d[i] - d[i + 1] > 70 && d[i] - d[i + 2] > 40) n++; return n; }, url); };
  const cheeks = {};
  for (const st of ['idle', 'thinking', 'sad', 'greeting', 'love', 'proud']) cheeks[st] = await pink(st);
  expect(cheeks.idle < 15 && cheeks.thinking < 15 && cheeks.sad < 15, 'no blush on calm or sad moods: ' + JSON.stringify(cheeks));
  expect(cheeks.greeting > 40 && cheeks.love > 40 && cheeks.proud > 40, 'blush on happy moods: ' + JSON.stringify(cheeks));
  await pic('setState', 'idle');
  for (const a of names.acc) {
    const p = await pic('setAccessory', a);
    if (p === idle || await page.evaluate(() => document.querySelector('#a canvas.cassie-bot-3d').dataset.accessory) !== a) same.push(a);
  }
  expect(!same.length, 'these accessories drew nothing: ' + same.join(', '));
  await page.evaluate(() => bots[0].setAccessory(null));
  // setAccent and look keep working; poking her (a tap) says so
  await page.evaluate(() => { bots[0].setAccent('#2f7d5b'); bots[0].look(0.5, -0.3); bots[0].render(); bots[0].pause(false); });
  await page.click('#a canvas.cassie-bot-3d');
  expect(await page.evaluate(() => bots[0].state) === 'poke', 'a tap pokes her');
  // she rests while the tab is hidden
  const frames = () => page.evaluate(() => +document.querySelector('#b canvas.cassie-bot-3d').dataset.frames);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForTimeout(200); const h0 = await frames(); await page.waitForTimeout(600);
  expect(await frames() === h0, 'no drawing while the tab is hidden');
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForTimeout(600);
  expect(await frames() > h0, 'drawing again when the tab is back');
  // only Cassies on screen are drawn
  await page.evaluate(() => { document.getElementById('c').style.cssText = 'position:absolute;top:3000px'; });
  await page.waitForTimeout(300);
  const off = () => page.evaluate(() => +document.querySelector('#c canvas.cassie-bot-3d').dataset.frames);
  const o0 = await off(); await page.waitForTimeout(600);
  expect(await off() === o0, 'a Cassie off screen is not drawn');
  // destroy takes her away
  await page.evaluate(() => bots[2].destroy());
  expect(await page.locator('#c canvas, #c svg').count() === 0, 'destroy removes her');
  expect(!errors.length && !(await page.evaluate(async () => (await import('./cassie-bot3d.js')).lastError())), 'no errors: ' + errors.join('; '));
  if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/cassie-3d-api.png' });
  await ctx.close();
});

test('3D Cassie in the app: she replaces the flat Cassie on Home and in chat (same size and place), one WebGL context for all; Reduce Motion and Lite mode keep the flat Cassie, still, and never load the 3D one', async (b) => {
  for (const [size, device, viewport] of [['390x844', 'iPhone 13', { width: 390, height: 844 }], ['1280x800', 'Desktop Chrome', { width: 1280, height: 800 }]]) {
    const { ctx, page, errors } = await open(b, { device, viewport, scale: 1, lite: 'off', server: false, state: { groqKey: 'gsk_test', tab: 'home', plan: null } });
    const place = size === '390x844' ? '#home .hub-bot' : '#mascot';
    await page.waitForSelector(place + ' svg', { state: 'attached', timeout: 10000 }); await page.waitForTimeout(700); // (where her place is once the page has settled: kept, unseen, until the 3D one is drawn)
    const flat = await page.evaluate((sel) => { const e = document.querySelector(sel + ' svg'); const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round); }, place);
    await page.waitForSelector(place + ' canvas.cassie-bot-3d', { timeout: 30000 });
    await page.waitForTimeout(300);
    const r = await page.evaluate(async (sel) => { const c = document.querySelector(sel + ' canvas.cassie-bot-3d'), rr = c.getBoundingClientRect(); return { box: [rr.x, rr.y, rr.width, rr.height].map(Math.round), flatShown: getComputedStyle(document.querySelector(sel + ' svg')).display !== 'none', gl: (await import('./cassie-bot3d.js')).contexts(), webgl: [...document.querySelectorAll('canvas.cassie-bot-3d')].length }; }, place);
    expect(r.box.every((v, i) => Math.abs(v - flat[i]) <= 2) && !r.flatShown, `${size}: the 3D Cassie takes the flat one's place and size: ${JSON.stringify(flat)} then ${JSON.stringify(r)}`);
    expect(r.gl === 1, `${size}: one WebGL context for every Cassie`);
    expect(!errors.length, `${size}: page errors: ` + errors.join('; '));
    await ctx.close();
  }
  for (const [why, lite, motion] of [['Reduce Motion', 'off', 'reduce'], ['Lite mode', 'on', null]]) {
    const { ctx, page, errors } = await open(b, { device: 'iPhone 13', scale: 1, lite, server: false, state: { groqKey: 'gsk_test', tab: 'home', plan: null } });
    if (motion) await page.emulateMedia({ reducedMotion: motion });
    await page.reload(); // (with the setting on from the start)
    const loaded = [];
    page.on('request', (rq) => { if (/cassie-bot3d\.js|three\.module/.test(rq.url())) loaded.push(rq.url()); });
    await page.waitForSelector('#home .hub-bot svg.cassie-bot', { timeout: 10000 });
    await page.waitForTimeout(3500);
    expect(!(await page.locator('canvas.cassie-bot-3d').count()) && !loaded.length, `${why}: the flat Cassie only, and no 3D loaded: ` + loaded.join(' '));
    const a = await page.locator('#home .hub-bot').screenshot(); await page.waitForTimeout(1200);
    const c = await page.locator('#home .hub-bot').screenshot();
    expect(a.equals(c), `${why}: the flat Cassie keeps still`);
    expect(!errors.length, `${why}: page errors: ` + errors.join('; '));
    await ctx.close();
  }
});

test('museum: a gallery wall where the paintings stand in a ring that turns (after animos.app), each in an ornate gold frame on red damask; under Learn > History on a computer and a phone (not Study tools); arrows, keys, swipe and tap; it rests on hover, focus and Reduce Motion; readable; no dashes', async (b) => {
  const { contrastIssues } = require('./ui-checks.cjs');
  for (const [size, device, viewport] of [['390x844', 'iPhone 13', { width: 390, height: 844 }], ['1280x800', 'Desktop Chrome', { width: 1280, height: 800 }]]) {
    const { ctx, page, errors } = await open(b, { device, viewport, scale: 1, server: false, state: { groqKey: 'gsk_test' } });
    // where it lives: Learn, under History (and not in Study tools)
    const where = await page.evaluate(async () => { const m = await import('./labs/labs.js'); const lab = m.LABS.find((l) => l.id === 'museum'); return { subject: lab.subject }; });
    expect(where.subject === 'history', `${size}: the Museum's subject is history: ` + JSON.stringify(where));
    await page.evaluate(() => openLabs());
    await page.waitForSelector('.labs:not([hidden])');
    if (await page.locator('.lp:not([hidden])').count()) { // a phone: the History chip lists it; Study tools doesn't
      await page.click('.lp-chips [data-lp="history"]');
      expect(await page.locator('.lp-row[data-lab="museum"]').count() === 1, `${size}: History lists the Museum`);
      await page.click('.lp-chips [data-lp="tools"]');
      expect(await page.locator('.lp-row[data-lab="museum"]').count() === 0, `${size}: Study tools doesn't`);
    } else {
      await page.click('.labs-chips [data-subject="history"]');
      expect(await page.locator('.labs-grid [data-lab="museum"]').count() === 1, `${size}: Learn > History shows the Museum`);
    }
    await page.evaluate(() => openLabs('museum'));
    await page.waitForSelector('.tl-ring .tl-card3d.tl-front', { timeout: 15000 });
    const R = await page.evaluate(() => {
      const hall = document.querySelector('.tl-hall'), front = document.querySelector('.tl-front'), side = document.querySelector('.tl-card3d[data-k="1"]'), f = front.querySelector('.tl-frame');
      return { n: document.querySelectorAll('.tl-card3d').length, wall: /data:image\/svg\+xml/.test(getComputedStyle(hall).backgroundImage), ornaments: (getComputedStyle(f, '::before').backgroundImage.match(/data:image\/svg\+xml/g) || []).length, gold: /gradient/.test(getComputedStyle(f).backgroundImage), front: getComputedStyle(front).transform, side: getComputedStyle(side).transform, now: document.querySelector('.tl-now').textContent };
    });
    expect(R.n === 35 && R.wall && R.ornaments === 8 && R.gold, `${size}: 35 paintings in ornate gold frames (8 carved ornaments each) on the damask wall: ` + JSON.stringify(R));
    expect(/matrix3d/.test(R.side) && R.front !== R.side && /Spoliarium/.test(R.now), `${size}: the one in front faces you, the next is turned away in 3D, and its name shows below: ` + JSON.stringify([R.side.slice(0, 40), R.now]));
    // it turns on its own
    const front = () => page.evaluate(() => { const f = document.querySelector('.tl-front'); return f ? f.dataset.open : 'none in front'; });
    const f0 = await front(); await page.mouse.move(2, 2); await page.waitForTimeout(3300);
    expect(await front() !== f0, `${size}: it turns on its own`);
    // Next, Previous, the arrow keys
    let f1 = await front(); await page.click('.tl-next'); await page.waitForTimeout(150);
    const f2 = await front(); expect(f2 !== f1, `${size}: Next turns it`);
    await page.click('.tl-prev'); await page.waitForTimeout(150); expect(await front() === f1, `${size}: Previous turns it back`);
    await page.focus('.tl-ring'); await page.keyboard.press('ArrowRight'); expect(await front() === f2, `${size}: the right arrow key turns it`);
    // it rests while focused, and while the pointer is on it
    const held = await front(); await page.waitForTimeout(3300); expect(await front() === held, `${size}: it rests while it has keyboard focus`);
    await page.evaluate(() => document.activeElement.blur());
    if (!/390/.test(size)) { await page.hover('.tl-hall'); const h = await front(); await page.waitForTimeout(3300); expect(await front() === h, `${size}: it rests while the pointer is on it`); await page.mouse.move(2, 2); }
    // a swipe turns it
    const s0 = await front();
    await page.evaluate(() => { const r = document.querySelector('.tl-ring'), b = r.getBoundingClientRect(), y = b.top + b.height / 2, ev = (t, x) => r.dispatchEvent(new PointerEvent(t, { bubbles: true, clientX: x, clientY: y, pointerId: 1, isPrimary: true })); ev('pointerdown', b.left + b.width * 0.7); ev('pointermove', b.left + b.width * 0.5); ev('pointermove', b.left + b.width * 0.3); ev('pointerup', b.left + b.width * 0.3); });
    await page.waitForTimeout(150); expect(await front() !== s0, `${size}: a swipe turns it`);
    // a painting at the side comes to the front; the one in front opens its story
    await page.waitForTimeout(900);
    const sideId = await page.evaluate(() => { const n = document.querySelectorAll('.tl-card3d').length, at = +document.querySelector('.tl-front').dataset.k; return document.querySelector(`.tl-card3d[data-k="${(at + 1) % n}"]`).dataset.open; });
    const sb = await page.locator(`.tl-card3d[data-open="${sideId}"]`).boundingBox(); await page.mouse.click(sb.x + sb.width - 12, sb.y + sb.height / 2); // (the part of it that shows, beside the front one)
    await page.waitForTimeout(900);
    expect(await front() === sideId, `${size}: tapping a side painting turns it to the front`);
    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme }); await page.waitForTimeout(900);
      if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/museum-ring-${size}-${scheme}.png` });
      const { bad } = await contrastIssues(page, '.tl-museum');
      expect(!bad.length, `${size} ${scheme}: readable: ` + bad.join(' | '));
    }
    expect(!/[–—]/.test(await page.locator('.tl-museum').innerText()), `${size}: no dashes`);
    await page.click('.tl-front');
    await page.waitForSelector('.tl-one .tl-big');
    expect(await page.locator('.tl-one h3').innerText() !== '', `${size}: the one in front opens its story`);
    const stay = await page.evaluate(() => document.querySelector('.tl-one h3').textContent); await page.waitForTimeout(3000);
    expect(await page.evaluate(() => document.querySelector('.tl-one h3').textContent) === stay, `${size}: it stays still while a work is open`);
    await page.click('[data-close]');
    // all as a grid, then back
    await page.click('[data-view="grid"]'); expect(await page.locator('.tl-gallery .tl-work').count() === 35, `${size}: Show all as a grid`);
    await page.click('[data-view="ring"]'); expect(await page.locator('.tl-ring .tl-card3d').count() === 35, `${size}: back to the gallery wall`);
    if (process.env.SHOTS && /1280/.test(size)) { await page.emulateMedia({ colorScheme: 'dark' }); for (let i = 0; i < 3; i++) { await page.locator('.tl-hall').screenshot({ path: `${process.env.SHOTS}/museum-turn-${i}.png` }); await page.click('.tl-next'); await page.waitForTimeout(950); } }
    expect(!errors.length, `${size}: page errors: ` + errors.join('; '));
    await ctx.close();
  }
  // Reduce Motion: no turning on its own and no 3D; Next still works
  const rm = await b.newContext({ ...require('playwright').devices['Desktop Chrome'], viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  await rm.close();
  const { ctx, page } = await open(b, { device: 'Desktop Chrome', viewport: { width: 1280, height: 800 }, server: false, state: { groqKey: 'gsk_test' } });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  await page.evaluate(() => openLabs('museum'));
  await page.waitForSelector('.tl-ring .tl-front', { timeout: 15000 });
  const r0 = await page.evaluate(() => document.querySelector('.tl-front').dataset.open);
  await page.mouse.move(2, 2); await page.waitForTimeout(3300);
  const still = await page.evaluate(() => ({ front: document.querySelector('.tl-front').dataset.open, threeD: [...document.querySelectorAll('.tl-card3d')].some((c) => /matrix3d/.test(getComputedStyle(c).transform)) }));
  expect(still.front === r0 && !still.threeD, 'Reduce Motion: it doesn’t turn on its own, and nothing is in 3D: ' + JSON.stringify(still));
  await page.click('.tl-next'); expect(await page.evaluate(() => document.querySelector('.tl-front').dataset.open) !== r0, 'Reduce Motion: Next still works');
  await ctx.close();
});

test('museum: every painting’s picture really loads (all 35, from the app, no outside host), and every frame is the ornate carved gold one', async (b) => {
  for (const [size, device, viewport] of [['390x844', 'iPhone 13', { width: 390, height: 844 }], ['1280x800', 'Desktop Chrome', { width: 1280, height: 800 }]]) {
    const { ctx, page, errors } = await open(b, { device, viewport, scale: 1, server: false, state: { groqKey: 'gsk_test' } });
    const outside = [];
    page.on('request', (r) => { if (/wiki(pedia|media)\.org/.test(r.url())) outside.push(r.url()); });
    await page.evaluate(() => openLabs('museum'));
    await page.waitForSelector('.tl-ring .tl-front', { timeout: 15000 });
    await page.click('[data-view="grid"]'); // (all of them at once: the grid)
    await page.waitForSelector('.tl-gallery .tl-frame', { timeout: 15000 });
    // every work, in view one by one (the pictures load as they come into view)
    const n = await page.locator('.tl-work').count();
    expect(n === 35, `${size}: 35 works (${n})`);
    for (let i = 0; i < n; i++) await page.locator('.tl-work').nth(i).scrollIntoViewIfNeeded();
    await page.waitForFunction(() => [...document.querySelectorAll('.tl-gallery .tl-frame img')].length === 35 && [...document.querySelectorAll('.tl-gallery .tl-frame img')].every((im) => im.complete), null, { timeout: 30000 }).catch(() => {});
    const pics = await page.evaluate(() => [...document.querySelectorAll('.tl-gallery .tl-frame')].map((f) => { const im = f.querySelector('img'); return { id: f.dataset.pic, w: im ? im.naturalWidth : 0 }; }));
    const broken = pics.filter((p) => !(p.w > 0)).map((p) => p.id);
    expect(pics.length === 35 && !broken.length, `${size}: every picture loads; empty frames: ${broken.join(', ')}`);
    // the frame: carved gold moulding, a beaded band, corner ornaments (inline SVG) and a gilt lip round the picture
    const frames = await page.evaluate(() => [...document.querySelectorAll('.tl-frame')].map((f) => {
      const cs = getComputedStyle(f), before = getComputedStyle(f, '::before'), after = getComputedStyle(f, '::after'), lip = getComputedStyle(f.querySelector('.tl-canvas'));
      return { id: f.dataset.pic, gold: /gradient/.test(cs.backgroundImage) && (cs.boxShadow.match(/inset/g) || []).length >= 5, corners: (before.backgroundImage.match(/data:image\/svg\+xml/g) || []).length === 8, beads: /radial-gradient/.test(after.backgroundImage), lip: (lip.boxShadow.match(/rgb/g) || []).length >= 3 };
    }));
    const plain = frames.filter((f) => !(f.gold && f.corners && f.beads && f.lip));
    expect(frames.length === 35 && !plain.length, `${size}: every frame is the ornate one (carved corners and mid sides, beads, a gilt lip): ` + JSON.stringify(plain.slice(0, 3)));
    // a painting opened large: its big picture loads in the big frame
    await page.click('[data-open="monalisa"]');
    await page.waitForFunction(() => { const im = document.querySelector('.tl-big img'); return im && im.complete && im.naturalWidth > 0; }, null, { timeout: 15000 });
    expect(await page.evaluate(() => document.querySelector('.tl-big img').naturalWidth) >= 600, `${size}: the large picture is the large copy`);
    expect(await page.locator('.tl-one a[href*="commons.wikimedia.org"]').count() === 1, `${size}: the picture credits Wikimedia Commons`);
    expect(!outside.length, `${size}: no picture is fetched from Wikipedia: ` + outside.slice(0, 2).join(' '));
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/museum-${size}.png` });
    expect(!errors.length, `${size}: page errors: ` + errors.join('; '));
    await ctx.close();
  }
});

test('first run on a phone: with the keyboard open, the first-run screen still covers the whole screen and nothing behind it shows or scrolls (every step)', async (b) => {
  // iOS: the keyboard shrinks only the visible part of the page (visualViewport), not the page, and
  // scrolls the page up to the field. Here that is acted out on a 390x844 phone.
  const STEPS = [['name', { step: 'ob', at: 0 }, '.fr-ob input'], ['grade', { step: 'ob', at: 1, answers: { name: 'Hazel', gender: 'female' } }, '.fr-ob input, .fr-ob select, .fr-ob button'],
    ['age', { step: 'ob', at: 2, answers: { name: 'Hazel', gender: 'female', grade: 'Grade 10' } }, '.fr-ob input, .fr-ob button'], ['sign in', { step: 'auth' }, '.auth-page input[name=email]']];
  const { ctx, page, errors } = await open(b, { device: 'iPhone 13', viewport: { width: 390, height: 844 }, scale: 1, lite: 'off', state: null });
  for (const [name, fr, field] of STEPS) {
    await page.evaluate((x) => { localStorage.removeItem('cassie.v2'); localStorage.setItem('cassie.firstRun', JSON.stringify(x)); }, fr);
    await page.goto(APP);
    await page.waitForSelector(field, { timeout: 10000 });
    await page.waitForTimeout(400);
    await page.locator(field).first().focus();
    // the keyboard opens: 344px of the screen are under it, and the page scrolls up
    await page.evaluate(() => {
      const vv = window.visualViewport;
      Object.defineProperty(vv, 'height', { configurable: true, get: () => 500 });
      Object.defineProperty(vv, 'offsetTop', { configurable: true, get: () => 0 });
      vv.dispatchEvent(new Event('resize'));
      window.scrollTo(0, 99999); document.scrollingElement.scrollTop = 99999;
      const sh = document.querySelector('.fr, .auth-page:not([hidden])'); if (sh) sh.scrollTop = 99999;
    });
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => {
      const shell = document.querySelector('.fr') || document.querySelector('.auth-page:not([hidden])');
      const leaks = [];
      for (let i = 0; i < 5; i++) for (let j = 0; j < 10; j++) {
        const x = Math.round((i + 0.5) * innerWidth / 5), y = Math.round((j + 0.5) * innerHeight / 10);
        const e = document.elementFromPoint(x, y);
        if (!e || !shell || !shell.contains(e)) leaks.push(`${x},${y}:${e ? (e.id || e.className || e.tagName).toString().slice(0, 30) : 'nothing'}`);
      }
      const app = document.getElementById('app');
      return { leaks, inert: !!(app && app.inert), scrolled: Math.round(document.scrollingElement.scrollTop) };
    });
    expect(!r.leaks.length, `${name}: the app shows through at ${r.leaks.slice(0, 4).join(' | ')} (${r.leaks.length} of 50 points)`);
    expect(r.inert, `${name}: the app behind is inert while first run is open`);
    expect(r.scrolled === 0, `${name}: the page behind does not scroll (${r.scrolled}px)`);
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/fr-keyboard-${name.replace(/ /g, '-')}.png` });
  }
  expect(!errors.length, 'page errors: ' + errors.join('; '));
  await ctx.close();
});

test.slow('first run screens: every word at AA in light and dark, every control answers a tap, and nothing spills sideways, at 390x844, 768x1024 and 1280x800', async (b) => {
  const { contrastIssues, tapResponseIssues } = require('./ui-checks.cjs');
  const STEPS = [['intro', { step: 'intro' }, '.fr-intro'], ['sign in', { step: 'auth' }, '.auth-page'], ...[0, 1, 2, 3].map((k) => [`question ${k + 1}`, { step: 'ob', at: k, answers: { name: 'Hazel', gender: 'female', grade: 'Grade 10', age: '15', help: ['exams'], voice: 'woman' } }, '.fr-ob'])];
  for (const [size, device, viewport] of [['390x844', 'iPhone 13', { width: 390, height: 844 }], ['768x1024', 'iPad Mini', { width: 768, height: 1024 }], ['1280x800', 'Desktop Chrome', { width: 1280, height: 800 }]]) {
    const { ctx, page, errors } = await open(b, { scale: 1, device, viewport, lite: 'off', state: null });
    ctx.on('page', (p) => { if (p !== page) p.close().catch(() => {}); });
    const go = async (fr, sel) => { if (!page.url().startsWith(APP.replace(/app\.html.*$/, ''))) await page.goto(APP); await page.evaluate((x) => { localStorage.removeItem('cassie.v2'); localStorage.setItem('cassie.firstRun', JSON.stringify(x)); }, fr); await page.goto(APP); await page.waitForSelector(sel, { timeout: 10000 }); await page.waitForTimeout(600); return page; };
    for (const [name, fr, sel] of STEPS) {
      await go(fr, sel);
      // the main button is on screen, and nothing scrolls sideways
      const g = await page.evaluate((s) => { const b = document.querySelector(`${s} .fr-go, ${s} .auth-go`); const r = b && b.getBoundingClientRect(); return { wide: document.documentElement.scrollWidth > innerWidth, btn: r ? r.bottom <= innerHeight + 1 && r.height >= 44 : true }; }, sel);
      expect(!g.wide && (g.btn || name === 'sign in'), `${size} ${name}: ` + JSON.stringify(g));
      if (size === '768x1024') continue;
      for (const scheme of ['light', 'dark']) {
        await page.emulateMedia({ colorScheme: scheme }); await page.waitForTimeout(300);
        const { checked, bad } = await contrastIssues(page);
        expect(checked >= 2 && !bad.length, `${size} ${name} (${scheme}): under AA: ` + bad.join(' | '));
      }
      await page.emulateMedia({ colorScheme: 'light' });
      if (size === '1280x800' && !['intro', 'sign in', 'question 1'].includes(name)) continue; /* (the questions share one layout: the phone taps them all) */
      const issues = await tapResponseIssues(page, { reopen: () => go(fr, sel), touch: size === '390x844', scope: '.fr, .auth-page', skip: /fake-gsi|google|apple|terms|privacy/i, perKind: 1 }); // (Google and Apple leave the page: their own tests)
      expect(!issues.length, `${size} ${name}: taps: ` + JSON.stringify(issues).slice(0, 500));
    }
    expect(errors.length === 0, 'page errors: ' + errors.join('; '));
    await ctx.close();
  }
});

test.slow('Monochrome (Graphite) is everyone’s main colour unless Blush & Sage is picked, and Home’s boxes each open their feature (390x844, 1280x800)', async (b) => {
  const { contrastIssues } = require('./ui-checks.cjs');
  const tok = (page) => page.evaluate(() => { const st = getComputedStyle(document.documentElement); return Object.fromEntries(['--bg', '--surface', '--text', '--primary', '--on-primary'].map((k) => [k, st.getPropertyValue(k).trim().toLowerCase()])); });
  // a new student, a boy and a girl, and someone from before the change (accent ''): Monochrome
  for (const [who, extra] of [['a girl', { profile: { ...PROFILE, gender: 'female' } }], ['a boy', { profile: { ...PROFILE, gender: 'male' } }], ['from before', { accent: '' }]]) {
    const { ctx, page, errors } = await open(b, { device: 'iPhone 13', scale: 1, lite: 'on', server: false, state: { groqKey: 'gsk_test', tab: 'home', ...extra } });
    expect(await page.evaluate(() => document.documentElement.dataset.pal) === 'mono', `${who}: Monochrome`);
    await page.emulateMedia({ colorScheme: 'light' }); await page.waitForTimeout(200);
    const l = await tok(page);
    expect(l['--bg'] === '#f2f2f5' && l['--surface'] === '#ffffff' && l['--text'] === '#0e0e10' && l['--primary'] === '#0e0e10' && l['--on-primary'] === '#ffffff', `${who} light: Graphite: ` + JSON.stringify(l));
    await page.emulateMedia({ colorScheme: 'dark' }); await page.waitForTimeout(200);
    const d = await tok(page);
    expect(d['--bg'] === '#0e0e10' && d['--surface'] === '#232327' && d['--text'] === '#f2f2f5' && d['--primary'] === '#f2f2f5' && d['--on-primary'] === '#0e0e10', `${who} dark: Graphite: ` + JSON.stringify(d));
    expect(!errors.length, `${who}: page errors: ` + errors.join('; '));
    await ctx.close();
  }
  // picking Blush & Sage in Appearance still works, saved under the same key, and Monochrome comes back
  {
    const { ctx, page } = await open(b, { device: 'Desktop Chrome', viewport: { width: 1280, height: 800 }, lite: 'on', server: false, state: { groqKey: 'gsk_test', profile: { ...PROFILE, gender: 'female' } } });
    await page.evaluate(() => openSettings('all'));
    expect(await page.locator('.accent-sw.accent-mono.active').count() === 1, 'Monochrome is the picked swatch');
    await page.click('.accent-sw[data-accent="cassie"]');
    expect(await page.evaluate(() => [document.documentElement.dataset.pal, JSON.parse(localStorage.getItem('cassie.v2')).accent].join()) === 'blush,cassie', 'Blush & Sage, saved as accent');
    await page.reload(); await page.waitForTimeout(500);
    expect(await page.evaluate(() => document.documentElement.dataset.pal) === 'blush', 'Blush & Sage stays after a reload');
    await page.evaluate(() => openSettings('all'));
    await page.click('.accent-sw[data-accent="mono"]');
    expect(await page.evaluate(() => document.documentElement.dataset.pal) === 'mono', 'and back to Monochrome');
    await ctx.close();
  }
  // Home's boxes: under the header, 2 across on a phone and 4 on a computer; each opens its feature
  const BOXES = [
    ['lessons', 'lab', (p) => p.waitForSelector('.lessons-sheet .lessons-list, .desk-lessons .lessons-list', { timeout: 8000 })],
    ['lab', 'lab', (p) => p.waitForSelector(LABS_READY, { timeout: 15000 })],
    ['games', 'write', (p) => p.waitForSelector('.labs:not([hidden]) [data-lab="circuit"]', { timeout: 15000 })],
    ['today', 'lab', (p) => p.waitForFunction(() => document.querySelector(`.lab-view:not([hidden])[data-lab="${todayLab()}"]`), null, { timeout: 20000 })],
    ['cards', 'cards', (p) => p.waitForSelector('.fc:not([hidden])', { timeout: 8000 })],
    ['research', 'write', (p) => p.waitForFunction(() => /Type a topic/.test(document.getElementById('prompt-input').placeholder), null, { timeout: 4000 })],
    ['quiz', 'write', (p) => p.waitForFunction(() => document.getElementById('quiz-btn').classList.contains('active'), null, { timeout: 4000 })],
    ['timer', 'timer', (p) => p.waitForFunction(() => /pause/i.test(document.getElementById('pomo-toggle').textContent), null, { timeout: 4000 })],
    ['room', 'write', (p) => p.waitForSelector('.room-dlg', { timeout: 8000 })],
    ['board', 'write', (p) => p.waitForSelector('.csk-live', { timeout: 15000 })],
    ['talk', 'write', (p) => p.waitForFunction(() => { const v = document.querySelector('.vc'); return (v && !v.hidden) || /microphone|mic/i.test(document.getElementById('chat-log').innerText); }, null, { timeout: 6000 })],
  ];
  for (const [size, device, viewport] of [['390x844', 'iPhone 13', { width: 390, height: 844 }], ['1280x800', 'Desktop Chrome', { width: 1280, height: 800 }]]) {
    const phone = size === '390x844';
    const hub = phone ? '#home .hub' : '#chat-log .hub';
    const start = async (o = {}) => {
      const r = await open(b, { device, viewport, scale: 1, lite: 'off', server: !!o.server, state: { groqKey: 'gsk_test', tab: 'home' } });
      // (More tools already tapped this visit: every box shows; a brand-new student's 4 and More tools are tested on their own)
      await r.ctx.addInitScript(() => { try { sessionStorage.setItem('cassie.moreTools', '1'); } catch (e) { /* ignore */ } });
      await r.page.reload();
      r.page.on('dialog', (d) => d.dismiss().catch(() => {}));
      await r.page.waitForSelector(hub + ' .hub-boxes', { timeout: 10000 });
      return r;
    };
    let { ctx, page, errors } = await start();
    const g = await page.evaluate((h) => { const hero = document.querySelector(h + ' .hub-hero').getBoundingClientRect(), bx = [...document.querySelectorAll(h + ' .hub-box')].map((e) => e.getBoundingClientRect()); return { n: bx.length, under: Math.round(bx[0].top - hero.bottom), cols: new Set(bx.map((r) => Math.round(r.left))).size, min: Math.min(...bx.map((r) => r.height)) }; }, hub);
    expect(g.n === 11 && (phone || (g.under >= 0 && g.under < 40)) && g.cols === (phone ? 2 : 4) && g.min >= 44, `${size}: eleven boxes (Lessons first)${phone ? '' : ' right under the header'}, ${phone ? 2 : 4} across: ` + JSON.stringify(g));
    expect(await page.locator(hub + ' .hub-q', { hasText: /^(Quiz me|Flashcards|Research a topic)$/ }).count() === 0, `${size}: no Quick action repeats a box`);
    for (const scheme of ['light', 'dark']) { await page.emulateMedia({ colorScheme: scheme }); await page.waitForTimeout(800); const { bad } = await contrastIssues(page, hub + ' .hub-boxes'); expect(!bad.length, `${size} boxes (${scheme}): ` + bad.join(' | ')); }
    await page.emulateMedia({ colorScheme: 'light' });
    for (const [act, , opened] of BOXES) {
      if (act === 'room') { await ctx.close(); ({ ctx, page, errors } = await start({ server: true })); }
      else { await page.goto(APP); await page.waitForTimeout(400); await page.evaluate((ph) => { if (ph) CassieNative.go('home'); else createNewChat(); }, phone); await page.waitForSelector(hub + ' .hub-boxes', { timeout: 10000 }); }
      if (act === 'talk') await studioOn(page); // (the voice screen opens only when Bella can speak)
      await page.click(`${hub} .hub-box[data-hub="${act}"]`);
      const ok = await opened(page).then(() => true, () => false);
      expect(ok, `${size}: the ${act} box opens its feature`);
      if (act === 'timer') await page.evaluate(() => { const t = document.getElementById('pomo-toggle'); if (/pause/i.test(t.textContent)) t.click(); });
    }
    expect(!errors.length, `${size}: page errors: ` + errors.join('; '));
    await ctx.close();
  }
});

test('phone Home: the hello and the bell with no row of lab previews above Today’s Lab (390x844), a live Today’s Lab card, then Today, Continue, the boxes and Quick actions; still with Reduce Motion or Lite mode; a computer’s Home is the study dashboard', async (b) => {
  const seed = { groqKey: 'gsk_test', tab: 'home', chats: [{ id: 'h1', title: 'What is osmosis?', messages: [{ role: 'user', content: 'What is osmosis?' }, { role: 'assistant', content: 'Water moving.' }], updatedAt: Date.now() }], cards: [{ id: 'c1', f: 'Q', b: 'A', deck: 'Bio', box: 0, due: 0, at: 0 }] };
  {
    const { ctx, page, errors } = await open(b, { device: 'iPhone 13', scale: 1, lite: 'off', server: false, state: seed });
    await page.waitForSelector('#home .hub-tlab-pv[data-preview]', { timeout: 10000 });
    await page.waitForTimeout(800);
    const h = await page.evaluate(() => {
      const hub = document.querySelector('#home .hub'), kids = [...hub.children];
      const at = (sel) => kids.findIndex((k) => k.matches(sel)), atH = (re) => kids.findIndex((k) => k.matches('.hub-h') && re.test(k.textContent));
      // every lab preview on Home, and how many sit above Today's Lab (there should be none)
      const tl = document.querySelector('#home .hub-tlab').getBoundingClientRect().top;
      const above = [...document.querySelectorAll('#home canvas[data-pv]')].filter((c) => !c.closest('.hub-tlab') && c.getBoundingClientRect().bottom <= tl + 1);
      return { hello: document.querySelector('#home .hub-me').textContent, above: above.length, hero: Math.round(document.querySelector('#home .hub-hero').getBoundingClientRect().height),
        order: [at('.hub-hero'), at('.hub-tlab'), atH(/^Today$/), atH(/Continue/), at('.hub-boxes'), atH(/Quick actions/)],
        lab: document.querySelector('.hub-tlab b').textContent, want: (LAB_INFO[todayLab()] || [])[0], pv: document.querySelector('.hub-tlab-pv').dataset.preview, today: todayLab(),
        play: document.querySelector('.hub-tlab-go').getBoundingClientRect().width };
    });
    expect(/^(Morning|Afternoon|Evening), Test$/.test(h.hello), 'the hello: ' + h.hello);
    expect(h.above === 0 && h.hero < 120, 'no row of lab previews above Today’s Lab, and the header is just the hello and the bell: ' + JSON.stringify(h));
    expect(h.order.every((x, i) => x >= 0 && (i === 0 || x > h.order[i - 1])), 'the header, Today’s Lab, Today, Continue, the boxes, Quick actions: ' + JSON.stringify(h.order));
    expect(h.lab === h.want && h.pv === h.today && h.play >= 44, 'Today’s Lab is today’s lab with its live preview and a 44px play button: ' + JSON.stringify(h));
    // the previews keep drawing
    const fr = () => page.evaluate(() => +document.querySelector('.hub-tlab-pv').dataset.frames);
    const f0 = await fr(); await page.waitForTimeout(1500); // (some days’ labs draw slower here: software graphics)
    const f1 = await fr(); expect(f1 > f0 + 3, 'Today’s Lab preview is moving: ' + JSON.stringify([f0, f1]));
    for (const scheme of ['light', 'dark']) { await page.emulateMedia({ colorScheme: scheme }); await page.waitForTimeout(600); const { bad } = await require('./ui-checks.cjs').contrastIssues(page, '#home .hub-hero, #home .hub-tlab'); expect(!bad.length, `header and Today’s Lab (${scheme}): ` + bad.join(' | ')); }
    await page.emulateMedia({ colorScheme: 'light' });
    // play opens today's lab
    await page.click('.hub-tlab-go');
    await page.waitForFunction(() => document.querySelector(`.lab-view:not([hidden])[data-lab="${todayLab()}"]`), null, { timeout: 20000 });
    expect(!errors.length, 'page errors: ' + errors.join('; '));
    await ctx.close();
  }
  // Reduce Motion and Lite mode: still previews and a still strip
  for (const [why, lite, motion] of [['Reduce Motion', 'off', 'reduce'], ['Lite mode', 'on', null]]) {
    const { ctx, page } = await open(b, { device: 'iPhone 13', scale: 1, lite, server: false, state: seed });
    if (motion) { await page.emulateMedia({ reducedMotion: motion }); await page.reload(); }
    await page.waitForSelector('#home .hub-tlab-pv[data-preview]', { timeout: 10000 });
    await page.waitForTimeout(600);
    const st = await page.evaluate(() => ({ still: [...document.querySelectorAll('#home canvas[data-preview]')].every((c) => c.dataset.still === '1') }));
    const fr = () => page.evaluate(() => +document.querySelector('.hub-tlab-pv').dataset.frames || 0);
    const f0 = await fr(); await page.waitForTimeout(1000); const f1 = await fr();
    expect(st.still && f1 - f0 <= 2, `${why}: still previews (one frame each, not ~30 a second): ` + JSON.stringify({ ...st, f0, f1 }));
    await ctx.close();
  }
  // a computer: the study dashboard instead (no strip, no Today’s Lab card)
  {
    const { ctx, page } = await open(b, { device: 'Desktop Chrome', viewport: { width: 1280, height: 800 }, lite: 'off', server: false, state: { ...seed, chats: [], cards: [] } });
    await page.evaluate(() => deskGo('home'));
    await page.waitForSelector('#chat-log .desk-home');
    const d = await page.evaluate(() => ({ strip: !!document.querySelector('#chat-log .hub-tlab, #chat-log canvas[data-pv]'), hello: document.querySelector('.dk-title').textContent }));
    expect(!d.strip && d.hello === 'Hi, Test', 'a computer’s Home is the dashboard: ' + JSON.stringify(d));
    await ctx.close();
  }
});

test('phone Home previews: real-looking 3D scenes (like the labs) on Plus and Pro, the flat drawings on Free and in Lite mode', async (b) => {
  for (const [who, plan, lite, want] of [['Pro', { plan: 'pro', until: 0 }, 'off', '3d'], ['Plus', { plan: 'plus', until: 0 }, 'off', '3d'], ['Free', null, 'off', 'flat'], ['Pro in Lite mode', { plan: 'pro', until: 0 }, 'on', 'flat']]) {
    const { ctx, page, errors } = await open(b, { device: 'iPhone 13', scale: 1, lite, server: false, state: { groqKey: 'gsk_test', tab: 'home', plan } });
    const asked = [];
    page.on('request', (r) => { if (/previews3d\.js/.test(r.url())) asked.push(r.url()); });
    await page.goto(APP);
    await page.waitForSelector(`#home .hub-tlab-pv[data-look="${want}"]`, { timeout: 20000 });
    await page.waitForTimeout(500);
    const looks = await page.evaluate(() => [...document.querySelectorAll('#home canvas[data-preview]')].map((c) => c.dataset.look).filter(Boolean));
    expect(looks.length >= 1 && looks.every((l) => l === want), `${who}: every preview (Today’s Lab) is ${want}: ` + looks.join(','));
    expect(want === '3d' ? asked.length > 0 : asked.length === 0, `${who}: the 3D scenes are ${want === '3d' ? '' : 'not '}loaded`);
    if (want === '3d') { // and they move
      const fr = () => page.evaluate(() => +document.querySelector('.hub-tlab-pv').dataset.frames || 0);
      const f0 = await fr(); await page.waitForTimeout(1500); const f1 = await fr(); expect(f1 > f0, `${who}: the 3D preview moves: ${f0} then ${f1}`); // (3D is drawn in software here: slow, but moving)
      // exactly one 3D canvas for every preview (they share one renderer)
      expect(await page.evaluate(() => document.querySelectorAll('#home canvas.hub-scene-3d, #home canvas[data-engine="webgl"]').length) === 0, `${who}: no extra 3D canvases on the page`);
    }
    expect(!errors.length, `${who}: page errors: ` + errors.join('; '));
    await ctx.close();
  }
});

test('phone Home is drawn again only when it needs to be (coming into view, Home tapped, or what it shows changed), not on every change elsewhere: its previews keep running', async (b) => {
  const { ctx, page, errors } = await open(b, { device: 'iPhone 13', scale: 1, lite: 'off', server: false, state: { groqKey: 'gsk_test', tab: 'home', plan: null } });
  await page.waitForSelector('#home .hub-tlab-pv[data-preview]');
  await page.evaluate(() => { window.__card = document.querySelector('#home .hub-tlab'); });
  // unrelated changes: a class on the page, something shown and hidden elsewhere
  await page.evaluate(() => { const r = document.documentElement; r.classList.add('test-x'); const d = document.createElement('div'); document.body.appendChild(d); d.hidden = true; d.hidden = false; r.classList.remove('test-x'); });
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => window.__card === document.querySelector('#home .hub-tlab')), 'Home was redrawn by a change elsewhere');
  // what it shows changed, and Home tapped: drawn again, with the new chat
  await page.evaluate(() => { state.chats = [{ id: 'z1', title: 'Photosynthesis', messages: [{ role: 'user', content: 'x' }], updatedAt: Date.now() }]; save(); CassieNative.go('home'); });
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.__card !== document.querySelector('#home .hub-tlab') && /Photosynthesis/.test(document.querySelector('#home .hub').innerText)), 'Home tapped after a change: drawn again with it');
  expect(!errors.length, 'page errors: ' + errors.join('; '));
  await ctx.close();
});

test('phone Labs tab: title and search, filter chips, Recommended (Today’s Lab with a live preview), For you (Learn, Study tools) with a live preview on every row, 3 moving at once; still with Reduce Motion or Lite mode; a computer keeps its Labs shelf', async (b) => {
  const { contrastIssues, tapTargetIssues } = require('./ui-checks.cjs');
  const { ctx, page, errors } = await open(b, { device: 'iPhone 13', scale: 1, lite: 'off', server: false, state: { groqKey: 'gsk_test', tab: 'home', plan: null, profile: { ...PROFILE, grade: '', who: 'teach' } } }); // (no level: For you keeps its two doors; by level: the Learn test)
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  await page.click('.tab[data-tab="labs"]');
  await page.waitForSelector('.labs:not([hidden]) .lp:not([hidden]) .lp-big[data-preview]', { timeout: 15000 });
  const top = await page.evaluate(() => ({ title: document.querySelector('.lp-head h2').textContent, find: document.querySelector('.lp-find').getBoundingClientRect().width,
    chips: [...document.querySelectorAll('.lp-chips button')].map((c) => c.textContent), rec: document.querySelector('.lp-card .lp-info b').textContent, want: (LAB_INFO[todayLab()] || [])[0],
    pv: document.querySelector('.lp-big').dataset.preview, today: todayLab(), play: document.querySelector('.lp-play').getBoundingClientRect().width, peek: !!document.querySelector('.lp-card .lp-peek'),
    forYou: [...document.querySelectorAll('.lp-for b')].map((x) => x.textContent), forPv: [...document.querySelectorAll('.lp-for canvas[data-preview]')].length }));
  expect(top.title === 'Learn' && top.find >= 44, 'the title and a 44px search button: ' + JSON.stringify(top));
  expect(top.chips.join() === 'All,Science,Maths,History,3D,Study tools,Games', 'the filter chips: ' + top.chips.join());
  expect(top.rec === top.want && top.pv === top.today && top.play >= 44 && top.peek, 'Recommended: today’s lab, its live preview, a play button and Cassie peeking: ' + JSON.stringify(top));
  expect(top.forYou.join() === 'Simulations,Study tools' && top.forPv === 2, 'For you: Simulations and Study tools, each with a preview: ' + JSON.stringify(top));
  const fr = (sel) => page.evaluate((s) => +document.querySelector(s).dataset.frames || 0, sel);
  const f0 = await fr('.lp-big'); await page.waitForTimeout(900);
  expect(await fr('.lp-big') > f0 + 3, 'the Recommended preview is moving');
  for (const scheme of ['light', 'dark']) { await page.emulateMedia({ colorScheme: scheme }); await page.waitForTimeout(500); const { bad } = await contrastIssues(page, '.lp'); expect(!bad.length, `Labs tab (${scheme}): ` + bad.join(' | ')); }
  await page.emulateMedia({ colorScheme: 'light' });
  const small = await tapTargetIssues(page); expect(!small.length, 'Labs tab: tap targets: ' + small.join(' | '));
  // play: today's lab, and Back returns to the Labs tab
  await page.click('.lp-play');
  await page.waitForFunction(() => document.querySelector(`.lab-view:not([hidden])[data-lab="${todayLab()}"]`), null, { timeout: 20000 });
  await page.click('.lab-back');
  await page.waitForSelector('.lp:not([hidden]) .lp-home:not([hidden])');
  // Learn: every Learn lab and 3D view, each row with its own preview; at most 3 moving at once
  await page.click('.lp-for[data-lp-open="learn"]');
  await page.waitForSelector('.lp-list:not([hidden]) .lp-row canvas[data-preview]');
  await page.waitForTimeout(600);
  const learn = await page.evaluate(() => ({ title: document.querySelector('.lp-list h3').textContent, rows: [...document.querySelectorAll('.lp-row')].map((r) => r.dataset.lab), withPv: document.querySelectorAll('.lp-row canvas[data-pv]').length }));
  expect(learn.title === 'Simulations' && learn.rows.length >= 25 && learn.withPv === learn.rows.length && ['body3d', 'cells3d', 'pendulum', 'solar', 'fractions'].every((x) => learn.rows.includes(x)), 'Learn: every lab and 3D view, each with a preview: ' + JSON.stringify(learn));
  for (let i = 0; i < 4; i++) { const moving = await page.evaluate(() => document.querySelectorAll('.lp canvas[data-moving="1"]').length); expect(moving <= 3, 'at most 3 previews move at once: ' + moving); await page.waitForTimeout(250); }
  await page.click('.lp-row[data-lab="pendulum"]');
  await page.waitForSelector('.lab-view:not([hidden])[data-lab="pendulum"] .lab-controls > *', { timeout: 20000 });
  await page.click('.lab-back');
  await page.waitForSelector('.lp-list:not([hidden]) .lp-row[data-lab="pendulum"]');
  await page.click('.lp-back');
  await page.waitForSelector('.lp-home:not([hidden])');
  // Study tools: every tool with its preview, and a tool opens
  await page.click('.lp-for[data-lp-open="tools"]');
  await page.waitForSelector('.lp-list:not([hidden]) .lp-row[data-lab="cornell"] canvas[data-preview="cornell"]');
  const tools = await page.evaluate(() => [...document.querySelectorAll('.lp-row')].map((r) => r.dataset.lab + ':' + !!r.querySelector('canvas[data-pv]')));
  expect(tools.length >= 6 && tools.every((x) => x.endsWith(':true')), 'Study tools, each with a preview: ' + tools.join());
  await page.click('.lp-row[data-lab="cornell"]');
  await page.waitForSelector('.lab-view:not([hidden])[data-lab="cornell"]', { timeout: 20000 });
  await page.click('.lab-back');
  // the chips and search
  await page.click('.lp-chips [data-lp="maths"]');
  const maths = await page.$$eval('.lp-row', (r) => r.map((x) => x.dataset.lab));
  expect(maths.includes('fractions') && !maths.includes('pendulum'), 'Maths: the maths labs only: ' + maths.join());
  await page.click('.lp-chips [data-lp="3d"]');
  const three = await page.$$eval('.lp-row', (r) => r.map((x) => x.dataset.lab));
  expect(['body3d', 'cells3d', 'space3d'].every((x) => three.includes(x)) && !three.includes('fractions'), '3D: the 3D views: ' + three.join());
  await page.click('.lp-chips [data-lp="all"]');
  await page.click('.lp-find'); await page.fill('.lp-q', 'pendul');
  await page.waitForSelector('.lp-row[data-lab="pendulum"]');
  expect((await page.$$eval('.lp-row', (r) => r.map((x) => x.dataset.lab))).join() === 'pendulum', 'search finds the pendulum');
  expect(!errors.length, 'page errors: ' + errors.join('; '));
  await ctx.close();
  // Reduce Motion and Lite mode: still previews
  for (const [why, lite, motion] of [['Reduce Motion', 'off', 'reduce'], ['Lite mode', 'on', null]]) {
    const o = await open(b, { device: 'iPhone 13', scale: 1, lite, server: false, state: { groqKey: 'gsk_test', plan: null } });
    if (motion) await o.page.emulateMedia({ reducedMotion: motion });
    await o.page.evaluate(() => openLabs());
    await o.page.waitForSelector('.lp:not([hidden]) .lp-big[data-preview]', { timeout: 15000 });
    await o.page.waitForTimeout(500);
    const st = await o.page.evaluate(() => [...document.querySelectorAll('.lp canvas[data-preview]')].map((c) => c.dataset.still));
    expect(st.length >= 3 && st.every((x) => x === '1'), `${why}: still previews: ` + st.join());
    await o.ctx.close();
  }
  // a computer: the Labs shelf as it was (header, Learn and Study tools tabs, search, subject chips, the grid of cards)
  {
    const o = await open(b, { device: 'Desktop Chrome', viewport: { width: 1280, height: 800 }, server: false, state: { groqKey: 'gsk_test' } });
    await o.page.evaluate(() => openLabs());
    await o.page.waitForSelector('.labs:not([hidden]) .labs-grid .labs-card');
    const d = await o.page.evaluate(() => { const vis = (s) => { const e = document.querySelector(s); return !!e && !!e.getClientRects().length; }; return { lp: vis('.lp'), on: document.querySelector('.labs').classList.contains('lp-on'), head: vis('.labs-head'), tabs: [...document.querySelectorAll('.labs-tabs [data-section]')].filter((x) => x.getClientRects().length).map((x) => x.dataset.section), search: vis('.labs-search'), chips: document.querySelectorAll('.labs-chips button').length, cards: document.querySelectorAll('.labs-grid .labs-card').length, feature: vis('.labs-feature'), bg: getComputedStyle(document.querySelector('.labs')).backgroundImage.slice(0, 15) }; });
    expect(!d.lp && !d.on && d.head && d.tabs.join() === 'learn,tools' && d.search && d.chips === 9 && d.cards >= 25 && d.feature && /gradient/.test(d.bg), 'a computer keeps its Labs shelf: ' + JSON.stringify(d));
    await o.ctx.close();
  }
});

test('Home header: a glass bar with the hello and a bell; every Home button still does its job; Today as a row of chips; no 3D room (390x844; a computer’s Home is the dashboard, tested on its own)', async (b) => {
  const seed = { groqKey: 'gsk_test', tab: 'home', chats: [{ id: 'h1', title: 'What is osmosis?', messages: [{ role: 'user', content: 'What is osmosis?' }, { role: 'assistant', content: 'Water moving across a membrane.' }], updatedAt: Date.now() }], cards: [{ id: 'c1', f: 'What moves in osmosis?', b: 'Water', deck: 'Biology', box: 0, due: 0, at: 0 }] };
  for (const [size, device, viewport] of [['390x844', 'iPhone 13', { width: 390, height: 844 }]]) {
    const phone = size === '390x844';
    const { ctx, page, errors } = await open(b, { device, viewport, scale: 1, lite: 'off', server: false, state: { ...seed, chats: [], cards: [] } });
    const loaded = [];
    page.on('request', (r) => { if (/home-scene\.js/.test(r.url())) loaded.push(r.url()); });
    const toHome = async () => { if (phone) await page.evaluate(() => CassieNative.go('home')); else await page.evaluate(() => createNewChat()); await page.waitForTimeout(400); };
    const hub = phone ? '#home .hub' : '#chat-log .hub';
    // a new student: the hello and the name, and a 44px bell; no 3D room
    await toHome();
    await page.waitForSelector(hub + '.hub-empty .hub-hero');
    const hero = await page.evaluate((h) => { const e = document.querySelector(h + ' .hub-hero'); return { text: e.innerText, h: e.getBoundingClientRect().height, bell: document.querySelector(h + ' .hub-bell').getBoundingClientRect().width, canvas: !!e.querySelector('svg.hub-still, .hub-scene') }; }, hub);
    expect((phone ? /(Morning|Afternoon|Evening), Test/ : /Hi, welcome/).test(hero.text) && /Test/.test(hero.text), `${size}: the hello and the name: ` + hero.text);
    expect(hero.bell >= 44 && hero.h < (phone ? 300 : 140), `${size}: the header with a 44px bell: ` + JSON.stringify(hero));
    // a returning student: the header, Today as a sideways row of chips, Continue and Quick actions
    await page.evaluate((s) => { state.chats = s.chats; state.cards = s.cards; save(); }, seed);
    await toHome();
    await page.waitForSelector(hub + ':not(.hub-empty) .hub-hero');
    expect((phone ? /(Morning|Afternoon|Evening), Test/ : /Hi, welcome back/).test(await page.locator(hub + ' .hub-hero').innerText()), `${size}: welcome back`);
    const today = await page.evaluate((h) => { const t = document.querySelector(h + ' .hub-today'), s = getComputedStyle(t); return { n: t.querySelectorAll('.hub-w').length, dir: s.display + ' ' + s.flexDirection, x: s.overflowX, top: [...t.querySelectorAll('.hub-w')].map((w) => Math.round(w.getBoundingClientRect().top)) }; }, hub);
    expect(today.n === 3 && today.dir === 'flex row' && today.x === 'auto' && new Set(today.top).size === 1, `${size}: Today is one row of three chips that scrolls sideways: ` + JSON.stringify(today));
    // the bell: today's reminders, each going where it says
    await page.click(hub + ' .hub-bell');
    await page.waitForTimeout(300);
    const rem = await page.locator(hub + ' .hub-remind').innerText();
    expect(await page.locator(hub + ' .hub-bell').getAttribute('aria-expanded') === 'true' && /1 card to review/.test(rem) && /Focus timer/.test(rem) && /day streak/.test(rem) && /lab/i.test(rem), `${size}: the bell's reminders: ` + rem);
    await page.click(hub + ' .hub-bell');
    // every kind of Home button still does its job
    const jobs = [
      ['#home-ask', () => page.waitForFunction(() => document.activeElement === document.getElementById('prompt-input'), null, { timeout: 4000 }).then(() => true, () => false)],
      ['.hub-w[data-hub="cards"]', () => page.waitForSelector('.fc:not([hidden])', { timeout: 4000 }).then(() => true, () => false)],
      ['.hub-timer', () => page.evaluate(() => /pause/i.test(document.getElementById('pomo-toggle').textContent))],
      ['.hub-w[data-hub="streak"]', () => page.waitForSelector('#memory-panel:not([hidden])', { timeout: 4000 }).then(() => true, () => false)],
      ['.hub-chat[data-hub^="chat:"]', () => page.waitForFunction(() => /osmosis/i.test(document.getElementById('chat-log').innerText), null, { timeout: 4000 }).then(() => true, () => false)],
    ];
    for (const [sel, did] of jobs) {
      await page.keyboard.press('Escape').catch(() => {});
      await page.evaluate(() => { document.querySelectorAll('.labs:not([hidden]) .labs-x, .fc:not([hidden]) .fc-x').forEach((x) => x.click()); if (typeof closeMemory === 'function') closeMemory(); });
      await toHome();
      await page.click(`${hub} ${sel}`);
      expect(await did(), `${size}: ${sel} still does its job`);
      if (sel === '.hub-timer') await page.evaluate(() => { const t = document.getElementById('pomo-toggle'); if (/pause/i.test(t.textContent)) t.click(); });
    }
    expect(!loaded.length && !(await page.locator('.hub-scene-3d').count()), `${size}: no 3D room is loaded`);
    expect(!errors.length, `${size}: page errors: ` + errors.join('; '));
    await ctx.close();
  }
});
test.slow('Home, You, Settings and Plans: the new and the returning home, every setting under its old key, search, drill-in pages with Back, and plans with no payment; contrast and taps at 390x844 and 1280x800', async (b) => {
  const { contrastIssues, tapResponseIssues } = require('./ui-checks.cjs');
  const reply = () => ({ text: 'Osmosis is water moving across a membrane.' });
  for (const [size, device, viewport] of [['390x844', 'iPhone 13', { width: 390, height: 844 }], ['1280x800', 'Desktop Chrome', { width: 1280, height: 800 }]]) {
    const phone = size === '390x844';
    const { ctx, page, errors } = await open(b, { scale: 1, device, viewport, lite: 'off', server: false, state: { groqKey: 'gsk_test', tab: 'home' }, fakeGroq: reply });
    ctx.on('page', (p) => { if (p !== page) p.close().catch(() => {}); });
    const toHome = async () => { if (phone) { await page.evaluate(() => CassieNative.go('home')); } else { await page.evaluate(() => { createNewChat(); }); } await page.waitForTimeout(500); };
    const hub = phone ? '#home .hub' : '#chat-log .hub';
    if (phone) { // (a computer's Home is the study dashboard: checked below and in its own test)
      // a new student: Cassie, a hello with the name, two cards and Start studying
      await toHome();
      await page.waitForSelector(hub + '.hub-empty');
      const t = await page.locator(hub).innerText();
      expect(/Hello, Test!/.test(t) && /What are we studying today\?/.test(t) && /Ask a question/.test(t) && /Make flashcards/.test(t) && /Start studying/.test(t), `${size}: the new home: ` + t);
      expect(await page.locator(hub + ' .hub-bot .cassie-bot').count() === 1, `${size}: Cassie is on the new home`);
      for (const scheme of ['light', 'dark']) { await page.emulateMedia({ colorScheme: scheme }); await page.waitForTimeout(1000); /* (the moving background eases into its dark colours) */ const { bad } = await contrastIssues(page); expect(!bad.length, `${size} new home (${scheme}): ` + bad.join(' | ')); }
      await page.emulateMedia({ colorScheme: 'light' });
      // one chat and one due card later: Today, Continue and Quick actions
      await page.evaluate(() => { const t = document.querySelector('.tabbar [data-tab="chat"]'); if (t && t.offsetParent) t.click(); });
      await ask(page, 'What is osmosis?');
      await page.evaluate(() => { state.cards = [{ id: 'c1', f: 'What moves in osmosis?', b: 'Water', deck: 'Biology', box: 0, due: 0, at: 0 }]; save(); });
      await toHome();
      await page.waitForSelector(hub + ':not(.hub-empty) .hub-today');
      const r = await page.locator(hub).innerText();
      expect(await page.locator(hub + ' .hub-w').count() === 3 && /card due/.test(r) && /Today’s lab/.test(r) && /Focus/.test(r) && /day streak/.test(r), `${size}: the Today chips (and Today’s lab in the boxes): ` + r);
      expect(/Continue/.test(r) && await page.locator(hub + ' .hub-chat', { hasText: 'What is osmosis?' }).count() === 1, `${size}: the chat under Continue`);
      expect(/Quick actions/.test(r) && await page.locator(hub + ' .hub-q').count() >= 4, `${size}: Quick actions`);
      if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/hub-${size}.png` });
      for (const scheme of ['light', 'dark']) { await page.emulateMedia({ colorScheme: scheme }); await page.waitForTimeout(1000); /* (the moving background eases into its dark colours) */ const { bad } = await contrastIssues(page); expect(!bad.length, `${size} returning home (${scheme}): ` + bad.join(' | ')); }
      await page.emulateMedia({ colorScheme: 'light' });
    } else {
      await page.evaluate(() => deskGo('home'));
      await page.waitForSelector('#chat-log .desk-home');
      expect(/Hi, Test/.test(await page.locator('#chat-log .desk-home').innerText()), `${size}: the dashboard`);
      for (const scheme of ['light', 'dark']) { await page.emulateMedia({ colorScheme: scheme }); await page.waitForTimeout(1000); const { bad } = await contrastIssues(page, '#chat-log .desk-home'); expect(!bad.length, `${size} dashboard (${scheme}): ` + bad.join(' | ')); }
      await page.emulateMedia({ colorScheme: 'light' });
    }
    // You: who you are, three numbers, and rows that open their own screen
    await page.goto(APP); await page.waitForTimeout(600);
    await page.evaluate(() => openSettings('profile'));
    const you = await page.locator('#settings-panel').innerText();
    expect(/Test/.test(you) && /questions this week/.test(you) && /cards learned/.test(you) && /day streak/.test(you), `${size}: You shows the name and numbers`);
    for (const [row, title, inside] of [['account', 'Account', '#edit-profile-btn'], ['study', 'Study', '#level-select'], ['voice', 'Voice and sound', '#voice-gender-select'], ['privacy', 'Privacy and data', '#share-usage-toggle']]) {
      await page.click(`.set-link[data-open="${row}"]`);
      expect(await page.locator('#set-title').innerText() === title && await page.locator(inside).isVisible() && await page.locator('.set-back').isVisible(), `${size}: ${row} opens on its own, with Back`);
      expect(await page.locator('.set-sec:not([hidden])').count() === 1, `${size}: only the ${row} section`);
      await page.click('.set-back');
      expect(await page.locator('#set-title').innerText() === 'You', `${size}: Back returns to You`);
    }
    for (const scheme of ['light', 'dark']) { await page.emulateMedia({ colorScheme: scheme }); await page.waitForTimeout(1000); /* (the moving background eases into its dark colours) */ const { bad } = await contrastIssues(page, '#settings-panel'); expect(!bad.length, `${size} You (${scheme}): ` + bad.join(' | ')); }
    await page.emulateMedia({ colorScheme: 'light' });
    // Plans: Free and Plus side by side, Plus best for school, the early list, and nothing that takes a payment
    await page.click('.set-link[data-open="plans"]');
    const plans = await page.locator('.set-plans').innerText();
    expect(/Free/.test(plans) && /Plus/.test(plans) && /Pro/.test(plans) && /Best for school/.test(plans) && !/Most popular/.test(plans), `${size}: Free, Plus and Pro: ` + plans);
    const gos = await page.locator('.set-plans .plan-go').evaluateAll((a) => a.map((x) => x.innerText.trim()));
    expect(gos.join() === 'Get Plus early,Get Pro early', `${size}: the plans offer the early list: ` + JSON.stringify(gos));
    expect(await page.locator('.set-plans input, .set-plans select, .set-plans textarea, .set-plans form').count() === 0 && !/card number|cvv|expiry/i.test(plans), `${size}: nothing asks for card details`);
    for (const scheme of ['light', 'dark']) { await page.emulateMedia({ colorScheme: scheme }); await page.waitForTimeout(1000); /* (the moving background eases into its dark colours) */ const { bad } = await contrastIssues(page, '#settings-panel'); expect(!bad.length, `${size} Plans (${scheme}): ` + bad.join(' | ')); }
    await page.emulateMedia({ colorScheme: 'light' });
    // Settings: every old setting is there, and a change is kept under its old key
    await page.evaluate(() => setPage('all'));
    const IDS = ['groq-key-input', 'groq-model-select', 'gemini-key-input', 'edit-profile-btn', 'share-usage-toggle', 'level-select', 'citation-select', 'highlight-help-toggle', 'accent-swatches', 'lite-select', 'textsize-select', 'easyread-toggle', 'voice-out-toggle', 'voice-gender-select', 'hearing-select', 'clear-chat-btn', 'settings-phone']; // (Report a problem shows only with Cassie's server: its own test)
    await page.evaluate(() => { document.getElementById('settings-keys').open = true; });
    for (const id of IDS) expect(await page.locator('#' + id).isVisible(), `${size}: ${id} is in Settings`);
    await page.fill('#groq-key-input', 'gsk_changed');
    await page.selectOption('#level-select', 'college');
    await page.selectOption('#citation-select', 'MLA');
    await page.selectOption('#textsize-select', 'large');
    await page.selectOption('#voice-gender-select', 'man');
    await page.selectOption('#hearing-select', 'fast');
    await page.locator('#easyread-toggle').check();
    await page.locator('#voice-out-toggle').check();
    await page.locator('#highlight-help-toggle').uncheck();
    await page.click('.accent-sw[data-accent="mono"]');
    // (Lite mode reloads the app to take effect: last, then wait for it)
    await Promise.all([page.waitForEvent('load', { timeout: 10000 }).catch(() => {}), page.selectOption('#lite-select', 'on')]);
    await page.waitForTimeout(600);
    const st = await page.evaluate(() => JSON.parse(localStorage.getItem('cassie.v2')));
    expect(st.groqKey === 'gsk_changed' && st.level === 'college' && st.citationStyle === 'MLA' && st.textSize === 'large' && st.voiceGender === 'man' && st.hearing === 'fast' && st.lite === 'on' && st.easyRead === true && st.voiceOut === true && st.highlightHelp === false && st.accent === 'mono',
      `${size}: every change is kept under its old key: ` + JSON.stringify({ groqKey: st.groqKey, level: st.level, citationStyle: st.citationStyle, textSize: st.textSize, voiceGender: st.voiceGender, hearing: st.hearing, lite: st.lite, easyRead: st.easyRead, voiceOut: st.voiceOut, highlightHelp: st.highlightHelp, accent: st.accent }));
    await page.evaluate(() => setAccent(''));
    await page.evaluate(() => openSettings('all'));
    await Promise.all([page.waitForEvent('load', { timeout: 10000 }).catch(() => {}), page.selectOption('#lite-select', 'off')]); // (back to the moving background)
    await page.waitForTimeout(600);
    // Search: "voice" leaves only the voice rows
    await page.evaluate(() => openSettings('all'));
    await page.fill('#settings-search', 'voice');
    const vis = await page.evaluate(() => [...document.querySelectorAll('#settings-panel .set-row')].filter((r) => !r.hidden && r.closest('.set-sec') && !r.closest('.set-sec').hidden).map((r) => r.closest('.set-sec').dataset.sec));
    expect(vis.length >= 3 && vis.every((x) => x === 'voice'), `${size}: search voice leaves the voice rows only: ` + vis);
    await page.fill('#settings-search', 'zzz');
    expect(await page.locator('#settings-none').isVisible(), `${size}: no match says so`);
    await page.fill('#settings-search', '');
    for (const scheme of ['light', 'dark']) { await page.emulateMedia({ colorScheme: scheme }); await page.waitForTimeout(1000); /* (the moving background eases into its dark colours) */ const { bad } = await contrastIssues(page, '#settings-panel'); expect(!bad.length, `${size} Settings (${scheme}): ` + bad.join(' | ')); }
    await page.emulateMedia({ colorScheme: 'light' });
    // the tap tests: Home, You, Settings and Plans (in Lite mode, like every tap test: this machine
    // draws the moving background in software, which a phone or laptop doesn't)
    await page.evaluate(() => { state.lite = 'on'; save(); });
    await page.goto(APP); await page.waitForTimeout(600); await toHome();
    const homeTaps = await tapResponseIssues(page, { reopen: async () => { await page.goto(APP); await page.waitForTimeout(600); await toHome(); return page; }, touch: phone, scope: hub, perKind: 1 });
    expect(!homeTaps.length, `${size} home taps: ` + JSON.stringify(homeTaps).slice(0, 500));
    for (const pg of ['profile', 'all', 'plans']) {
      const reopen = async () => { await page.goto(APP); await page.waitForTimeout(600); await page.evaluate((x) => openSettings(x), pg); await page.waitForTimeout(300); return page; };
      await reopen();
      const taps = await tapResponseIssues(page, { reopen, touch: phone, scope: '#settings-panel', skip: /clear conversation|privacy policy|terms|report/i, perKind: 1, max: 20 });
      expect(!taps.length, `${size} ${pg} taps: ` + JSON.stringify(taps).slice(0, 500));
    }
    expect(errors.length === 0, 'page errors: ' + errors.join('; '));
    await ctx.close();
  }
});


test('Liquid Glass on a phone: every tap target is at least 44px, and every word passes WCAG AA on the marble, light and dark', async (b) => {
  const { tapTargetIssues, contrastIssues } = require('./ui-checks.cjs');
  const screens = {
    'sign-up': async (page) => { await page.evaluate(() => localStorage.setItem('cassie.firstRun', JSON.stringify({ step: 'auth' }))); await page.reload(); await page.waitForSelector('.auth-page', { timeout: 10000 }); },
    home: async (page) => { await page.evaluate(() => { const t = document.querySelector('.tabbar [data-tab="home"]'); if (t) t.click(); }); await page.waitForTimeout(600); },
    // (the answer as it rests: the "Done" island sits over the top of it for a moment, then goes)
    chat: async (page) => { await ask(page, 'what is photosynthesis'); await page.waitForFunction(() => !document.getElementById('island').classList.contains('live'), null, { timeout: 8000, polling: 100 }); await page.waitForTimeout(600); },
    settings: async (page) => { await page.evaluate(() => openSettings()); await page.waitForTimeout(700); },
    'Plus sheet': async (page) => { await page.evaluate(() => plusSheet('Real 3D views', 'You’ve used this week’s 2 free views.')); await page.waitForTimeout(400); },
  };
  for (const scheme of ['light', 'dark']) {
    for (const [name, go] of Object.entries(screens)) {
      const signup = name === 'sign-up';
      const { ctx, page } = await open(b, { device: 'iPhone 13', lite: 'off', server: signup, state: signup ? null : { groqKey: 'gsk_test', tab: name === 'home' ? 'home' : 'chat' }, fakeGroq: () => ({ text: 'Photosynthesis is how plants make food.\n\nQuick check: where does it happen?' }) });
      await page.emulateMedia({ colorScheme: scheme });
      await go(page);
      await page.waitForTimeout(500);
      if (scheme === 'light') { const small = await tapTargetIssues(page); expect(!small.length, `${name}: tap targets under 44px: ` + small.join(' | ')); }
      const { checked, bad } = await contrastIssues(page);
      expect(checked >= 2, `${name} (${scheme}): no words were measured`);
      expect(!bad.length, `${name} (${scheme}): words under AA contrast: ` + bad.join(' | '));
      await ctx.close();
    }
  }
});

test('Cassie’s colours: Blush & Sage, picked in Appearance (sage leads for a boy, blush for a girl or unsaid), every word, button, chip, bubble and tab at AA in light and dark at 390x844 and 1280x800, and every colour in style.css comes from a token', async (b) => {
  const { contrastIssues } = require('./ui-checks.cjs');
  // every colour outside the :root token blocks is a token (a hard-coded one is listed)
  const css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, (c) => ' '.repeat(c.length));
  const left = [], stack = [];
  let seg = 0;
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (c !== '{' && c !== '}') continue;
    const text = css.slice(seg, i);
    if (c === '{') { stack.push(text.split(/[;}]/).pop().trim()); }
    else {
      if (!stack.some((x) => x.startsWith(':root'))) for (const d of text.split(';')) { const v = d.split(':').slice(1).join(':'); for (const m of v.match(/#[0-9a-f]{3,8}\b|rgba?\(\s*\d[^)]*\)/gi) || []) left.push(`${stack[stack.length - 1]} { ${d.trim().slice(0, 80)} }`); }
      stack.pop();
    }
    seg = i + 1;
  }
  expect(!left.length, `hard-coded colours outside the tokens (${left.length}): ` + left.slice(0, 12).join(' | '));
  const hex = (rgb) => '#' + rgb.match(/\d+/g).slice(0, 3).map((n) => (+n).toString(16).padStart(2, '0')).join('');
  for (const [size, device, viewport] of [['390x844', 'iPhone 13', { width: 390, height: 844 }], ['1280x800', 'Desktop Chrome', { width: 1280, height: 800 }]]) {
    for (const gender of ['female', 'male', 'none']) {
      const { ctx, page, errors } = await open(b, { device, viewport, lite: 'off', server: false, state: { groqKey: 'gsk_test', accent: 'cassie', profile: { ...PROFILE, gender } }, fakeGroq: () => ({ text: 'Osmosis is water moving across a membrane.\n\nQuick check: which way does the water go?' }) });
      await page.evaluate(() => { const t = document.querySelector('.tabbar [data-tab="chat"]'); if (t && t.offsetParent) t.click(); });
      await ask(page, 'What is osmosis?');
      await page.waitForFunction(() => !document.getElementById('island').classList.contains('live'), null, { timeout: 8000, polling: 100 }).catch(() => {});
      const want = gender === 'male' ? 'sage' : 'blush';
      expect(await page.evaluate(() => document.documentElement.dataset.pal) === want, `${size} ${gender}: the ${want} palette`);
      for (const scheme of ['light', 'dark']) {
        await page.emulateMedia({ colorScheme: scheme }); await page.waitForTimeout(500);
        const primary = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--primary').trim());
        const blushLeads = scheme === 'light' ? '#b8395a' : '#f28fa5', sageLeads = scheme === 'light' ? '#2f6f5e' : '#7cc4ae';
        expect(primary === (want === 'sage' ? sageLeads : blushLeads), `${size} ${gender} ${scheme}: the main colour is ${primary}`);
        // the user's bubble, the send button and a chip are in the accent
        const user = await page.evaluate(() => getComputedStyle(document.querySelector('.bubble-user')).backgroundColor);
        expect(hex(user) === primary, `${size} ${gender} ${scheme}: your bubble is the main colour: ${user}`);
        if (size === '390x844') { await page.evaluate(() => openSidebar()); await page.waitForTimeout(400); } else { await page.evaluate(() => setSideOpen(true)); await page.waitForTimeout(400); }
        if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/colours-${size}-${gender}-${scheme}.png` });
        // (until the words' colours stop changing: a busy machine can still be fading them to the new scheme)
        const inks = () => page.evaluate(() => [...document.querySelectorAll('body, button, .bubble, .chip, .tab')].slice(0, 80).map((e) => getComputedStyle(e).color + getComputedStyle(e).backgroundColor).join('|'));
        for (let k = 0, was = await inks(); k < 12; k++) { await page.waitForTimeout(150); const now = await inks(); if (now === was) break; was = now; }
        const { checked, bad } = await contrastIssues(page);
        expect(checked >= 10, `${size} ${gender} ${scheme}: words measured: ${checked}`);
        expect(!bad.length, `${size} ${gender} ${scheme}: under AA: ` + bad.join(' | '));
        if (size === '390x844') await page.evaluate(() => closeSidebar()); else await page.evaluate(() => setSideOpen(false));
        await page.waitForTimeout(300);
      }
      expect(errors.length === 0, 'page errors: ' + errors.join('; '));
      await ctx.close();
      if (gender === 'none' && size === '1280x800') break;
    }
  }
});

test('Appearance: Monochrome is black and white, a picked colour reaches New chat, send, the timer, the open tab, your bubble and Labs, and Cassie brings back blush and sage', async (b) => {
  const { contrastIssues } = require('./ui-checks.cjs');
  const rgb = (c) => (c.match(/\d+(\.\d+)?/g) || []).slice(0, 3).map(Number);
  const hex = (c) => '#' + rgb(c).map((n) => Math.round(n).toString(16).padStart(2, '0')).join('');
  const L = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((t, v, i) => t + v * [0.2126, 0.7152, 0.0722][i], 0);
  const ratio = (a, c) => { const x = L(a), y = L(c); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const CONTROLS = { 'New chat': '#new-chat-btn', send: '#send-btn', 'timer Start': '#pomo-toggle', 'your bubble': '.bubble-user', 'open tab': '.tabbar .tab.on' };
  for (const [size, device, viewport] of [['390x844', 'iPhone 13', { width: 390, height: 844 }], ['1280x800', 'Desktop Chrome', { width: 1280, height: 800 }]]) {
    const { ctx, page, errors } = await open(b, { device, viewport, lite: 'off', server: false, state: { groqKey: 'gsk_test', profile: { ...PROFILE, gender: 'male' } }, fakeGroq: () => ({ text: 'Osmosis is water moving across a membrane.' }) });
    await page.evaluate(() => { const t = document.querySelector('.tabbar [data-tab="chat"]'); if (t && t.offsetParent) t.click(); });
    await ask(page, 'What is osmosis?');
    await page.waitForFunction(() => !document.getElementById('island').classList.contains('live'), null, { timeout: 8000, polling: 100 }).catch(() => {}); // (the "Done" pill goes)
    if (size === '1280x800') await page.evaluate(() => setSideOpen(true)); // (the timer is in the full sidebar)
    const colours = () => page.evaluate((ctl) => Object.fromEntries(Object.entries(ctl).map(([k, sel]) => { const e = document.querySelector(sel); if (!e || !e.getClientRects().length) return [k, null]; const st = getComputedStyle(e); return [k, { bg: st.backgroundColor, fg: st.color }]; })), CONTROLS);
    for (const pick of ['mono', '#2563eb', '#f59e0b', 'cassie']) {
      await page.evaluate((c) => setAccent(c), pick);
      for (const scheme of ['light', 'dark']) {
        await page.emulateMedia({ colorScheme: scheme }); await page.waitForTimeout(350);
        if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/appearance-${size}-${pick.replace('#', '') || 'cassie'}-${scheme}.png` });
        // (until the colours stop changing: a busy machine can still be fading a button to the new scheme)
        let got = await colours();
        for (let k = 0; k < 12; k++) { await page.waitForTimeout(150); const again = await colours(); if (JSON.stringify(again) === JSON.stringify(got)) break; got = again; }
        for (const [k, v] of Object.entries(got)) {
          if (!v) { expect((k === 'open tab' || k === 'timer Start' || k === 'New chat') && size === '1280x800', `${size} ${pick || 'Cassie'} ${scheme}: ${k} is missing`); continue; } // (a computer: no tabs, and the timer is Home's dark card)
          const bg = hex(v.bg), fg = hex(v.fg);
          if (pick === 'mono') {
            const [r, g, bl] = rgb(v.bg);
            expect(Math.max(r, g, bl) - Math.min(r, g, bl) <= 6, `${size} Monochrome ${scheme}: ${k} has a hue: ${v.bg}`);
          } else if (pick.startsWith('#')) expect(bg === pick, `${size} ${pick} ${scheme}: ${k} is ${bg}, not the picked colour`);
          else expect(bg === (scheme === 'light' ? '#2f6f5e' : '#7cc4ae'), `${size} Cassie ${scheme}: ${k} is ${bg}, not sage (a boy’s profile)`);
          expect(ratio(bg, fg) >= 4.5, `${size} ${pick || 'Cassie'} ${scheme}: ${k} words ${fg} on ${bg} = ${ratio(bg, fg).toFixed(2)}:1`);
        }
        if (pick === 'mono' || pick === '#f59e0b') {
          const { bad } = await contrastIssues(page);
          expect(!bad.length, `${size} ${pick} ${scheme}: under AA: ` + bad.join(' | '));
        }
      }
    }
    // Labs: a pressed chip takes the picked colour
    if (size === '1280x800') {
      await page.evaluate(() => setAccent('#2563eb'));
      await page.evaluate(() => openLabs());
      await page.waitForSelector('.labs-chips button[aria-pressed="true"]', { timeout: 15000 });
      const chip = await page.evaluate(() => { const st = getComputedStyle(document.querySelector('.labs-chips button[aria-pressed="true"]')); return { bg: st.backgroundColor, fg: st.color }; });
      expect(hex(chip.bg) === '#2563eb' && ratio(hex(chip.bg), hex(chip.fg)) >= 4.5, 'a pressed Labs chip is the picked colour: ' + JSON.stringify(chip));
    }
    expect(errors.length === 0, 'page errors: ' + errors.join('; '));
    await ctx.close();
  }
});

// the three screens every control is checked on: an iPhone, a small Android phone and a 1280x800
// touch screen (a tablet on its side, a touch laptop: a mouse gets the smaller desktop sizes)
const TAP_SIZES = [['iPhone 390x844', 'iPhone 13', { width: 390, height: 844 }], ['small Android 360x740', 'Pixel 7', { width: 360, height: 740 }], ['touch 1280x800', 'Desktop Chrome', { width: 1280, height: 800 }]];
// every screen and panel, each opened on its own: [name, how to get there, what to start with]
const TAP_SCREENS = [
  ['sign-up', async (page) => { await page.evaluate(() => localStorage.setItem('cassie.firstRun', JSON.stringify({ step: 'auth' }))); await page.reload(); await page.waitForSelector('.auth-page', { timeout: 10000 }); }, { state: null, server: true }],
  ['profile', async (page) => { await page.evaluate(() => openProfile(false)); await page.waitForSelector('.profile-card', { timeout: 8000 }); }],
  ['home', async (page) => { await page.waitForTimeout(600); }, { state: { tab: 'home' } }],
  ['chat', async (page) => { await ask(page, 'what is photosynthesis'); }],
  ['settings', async (page) => { await page.evaluate(() => openSettings()); await page.waitForSelector('#settings-panel:not([hidden])'); await page.waitForTimeout(500); }],
  // (You, every setting on one page with its two folding parts open, and Plans: each section on its
  // own page shows these same controls)
  ...['profile', 'all', 'plans'].map((pg) => [`settings: ${pg}`, async (page) => {
    await page.evaluate((x) => { openSettings(x); document.querySelectorAll('#settings-panel details').forEach((d) => { d.open = true; }); }, pg); await page.waitForSelector('#settings-panel:not([hidden])'); await page.waitForTimeout(400);
  }]),
  ['Plus sheet', async (page) => { await page.evaluate(() => plusSheet('Real 3D views', 'You’ve used this week’s 2 free views.')); await page.waitForSelector('.plus-sheet'); await page.waitForTimeout(400); }],
  ['Labs shelf', async (page) => { await page.evaluate(() => openLabs(undefined, { section: 'learn' })); await page.waitForSelector(LABS_READY, { timeout: 20000 }); }],
  ['Labs 3D', async (page) => { await page.evaluate(() => openLabs(undefined, { subject: '3d' })); await page.waitForSelector(LABS_READY, { timeout: 20000 }); }],
  ['Games', async (page) => { await page.evaluate(() => openLabs(undefined, { section: 'games' })); await page.waitForSelector(LABS_READY, { timeout: 20000 }); }],
  ['Study tools shelf', async (page) => { await page.evaluate(() => openLabs(undefined, { section: 'tools' })); await page.waitForSelector(LABS_READY, { timeout: 20000 }); }],
  ['Explore body', async (page) => { await page.evaluate(() => openExplore('body')); await page.waitForSelector('.x3d:not([hidden]) .x3d-sys', { timeout: 30000 }); await page.waitForFunction(() => document.querySelector('.x3d-loading').hidden, null, { timeout: 30000 }); await page.waitForTimeout(500); }],
  ['Explore animal cell', async (page) => { await page.evaluate(() => openExplore('animal')); await page.waitForSelector('.x3d:not([hidden]) .x3d-chip[data-part="nucleus"]', { timeout: 30000 }); await page.waitForTimeout(500); }],
  ['Explore plant cell', async (page) => { await page.evaluate(() => openExplore('plant')); await page.waitForSelector('.x3d:not([hidden]) .x3d-chip[data-part="chloroplast"]', { timeout: 30000 }); await page.waitForTimeout(500); }],
  ['Explore cell part card', async (page) => { await page.evaluate(() => openExplore('animal')); await page.waitForSelector('.x3d:not([hidden]) .x3d-chip[data-part="golgi"]', { timeout: 30000 }); await page.click('.x3d-chip[data-part="golgi"]'); await page.waitForSelector('.x3d-sheet:not([hidden])'); await page.waitForTimeout(400); }],
  ['board', async (page) => { await page.evaluate(() => { const t = document.querySelector('.tabbar [data-tab="chat"]'); if (t && t.offsetParent) t.click(); }); await page.click('#board-btn'); await page.waitForSelector('.csk-live', { timeout: 15000 }); await page.waitForTimeout(400); }],
  ['flashcards', async (page) => { await page.evaluate(() => window.CassieCards.open()); await page.waitForSelector('.fc:not([hidden])', { timeout: 8000 }); await page.waitForTimeout(400); }, { state: { cards: [{ id: 'c1', f: 'Powerhouse of the cell?', b: 'Mitochondria', deck: 'Biology', box: 0, due: 0, at: 0 }] } }],
  ['study room', async (page) => {
    await page.evaluate(() => { const t = document.querySelector('.tabbar [data-tab="chat"]'); if (t && t.offsetParent) t.click(); });
    await page.click('#board-btn'); await studyTogether(page); await page.click('[data-room="new"]');
    await page.waitForSelector('.csk-room:not([hidden]) b', { timeout: 10000 });
    await page.click('[data-room-act="study"]'); await page.waitForTimeout(600);
  }, { server: true }],
  ['Talk with Cassie', async (page) => { await studioOn(page); await page.evaluate(() => openVoice('chat')); await page.waitForSelector('.vc:not([hidden])', { timeout: 8000 }); await page.waitForFunction(() => voiceChat && voiceChat.phase !== 'speaking', null, { timeout: 15000 }).catch(() => {}); await page.waitForTimeout(800); }],
];
test.slow('every screen at 390x844, 360x740 and 1280x800: every button can be tapped (44px, on screen, not under the tab bar, not cut off)', async (b) => {
  const { tapTargetIssues } = require('./ui-checks.cjs');
  const only = process.env.TAP_ONLY ? new RegExp(process.env.TAP_ONLY, 'i') : null;
  const bad = [];
  // two lanes side by side (the iPhone then the 1280x800 screen; the small Android): about half the
  // time, without so much at once that the 3D screens can't load on this test machine
  const lanes = [[TAP_SIZES[0], TAP_SIZES[2]], [TAP_SIZES[1]]];
  const sweep = async ([size, device, viewport]) => {
    for (const [name, go, o = {}] of TAP_SCREENS) {
      if (only && !only.test(name)) continue;
      const { ctx, page } = await open(b, { device, viewport, touch: true, lite: 'on', server: o.server || false, state: o.state === null ? null : { groqKey: 'gsk_test', ...(o.state || {}) }, fakeGroq: () => ({ text: 'Photosynthesis is how plants make food.\n\nQuick check: where does it happen?' }) });
      try {
        const sub = await go(page);
        const issues = await tapTargetIssues(page);
        if (issues.length) bad.push(`${name}${sub ? ' (' + sub + ')' : ''} @ ${size}: ${issues.join(' | ')}`);
        if (issues.length && process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/tap-${name}-${viewport.width}.png`.replace(/ /g, '_') });
      } catch (e) { bad.push(`${name} @ ${size}: could not open: ${e.message.split('\n')[0]}`); }
      await ctx.close();
    }
    // every lab, one after another in the same window
    if (only && !only.test('labs')) return;
    const { ctx, page } = await open(b, { device, viewport, touch: true, lite: 'on', server: false, state: { groqKey: 'gsk_test' } });
    const ids = await page.evaluate(async () => (await import('./labs/labs.js')).LABS.map((l) => l.id));
    for (const id of ids) {
      try {
        await page.evaluate((x) => openLabs(x), id);
        await page.waitForSelector(`.lab-view:not([hidden])[data-lab="${id}"]`, { timeout: 15000 });
        await page.waitForTimeout(500);
        const issues = await tapTargetIssues(page);
        if (issues.length) bad.push(`lab ${id} @ ${size}: ${issues.join(' | ')}`);
        if (issues.length && process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/tap-lab-${id}-${viewport.width}.png` });
      } catch (e) { bad.push(`lab ${id} @ ${size}: could not open: ${e.message.split('\n')[0]}`); }
    }
    await ctx.close();
  };
  await Promise.all(lanes.map(async (lane) => { for (const sz of lane) await sweep(sz); }));
  if (process.env.TAP_REPORT) fs.writeFileSync(process.env.TAP_REPORT, bad.join('\n'));
  expect(!bad.length, `${bad.length} screens with buttons that can't be tapped properly: ` + bad.join(' || '));
});

// Every control on every screen and in every lab, tapped for real on a phone (390x844, a finger) and a
// computer (1280x800, a mouse): the tap reaches it and something visibly responds within 100 ms.
const RESPONSE_SIZES = [['phone 390x844', 'iPhone 13', { width: 390, height: 844 }, true], ['computer 1280x800', 'Desktop Chrome', { width: 1280, height: 800 }, false]];
test.slow('every control on every screen at 390x844 (touch) and 1280x800 (mouse), every lab with TAP_SWEEP=all: a tap reaches it and something visibly responds within 100 ms, with no freeze, no double click and no drag that taps', async (b) => {
  const { tapResponseIssues } = require('./ui-checks.cjs');
  const only = process.env.TAP_ONLY ? new RegExp(process.env.TAP_ONLY, 'i') : null;
  const bad = [];
  const skip = /delete (my )?account|sign out|log out|continue with google|sign in with apple/i; // (Google and Apple leave the page: they have their own tests)
  // one screen: opened fresh (the same saved data) whenever a tap changed it
  const run = async (label, device, viewport, touch, o, go, onlyKeys) => {
    // (1x pixels: this test machine draws 3D in software, 9 times slower at an iPhone's 3x)
    const { ctx, page } = await open(b, { device, viewport, touch, scale: 1, lite: 'on', server: o.server || false, state: o.state === null ? null : { groqKey: 'gsk_test', ...(o.state || {}) }, fakeGroq: () => ({ text: 'Photosynthesis is how plants make food.\n\nQuick check: where does it happen?' }) });
    ctx.on('page', (p) => { if (p !== page) p.close().catch(() => {}); }); // (a link that opens a new tab)
    page.on('dialog', (d) => d.dismiss().catch(() => {}));
    page.on('filechooser', () => {});
    // (a moment for the screen to finish starting up, so its own start-up work isn't blamed on a tap)
    const settle = async () => { await page.waitForLoadState('load').catch(() => {}); await page.waitForTimeout(500); };
    try {
      await go(page); await settle();
      const saved = await page.evaluate(() => JSON.stringify(Object.entries(localStorage)));
      const reopen = async () => {
        await page.evaluate((x) => { localStorage.clear(); JSON.parse(x).forEach(([k, v]) => localStorage.setItem(k, v)); }, saved).catch(() => {});
        await page.goto(APP); await go(page); await settle(); return page;
      };
      let last = '';
      const issues = await Promise.race([
        tapResponseIssues(page, { reopen, touch, skip, only: onlyKeys, perKind: all ? 0 : 2, seen: all ? null : seenAt[viewport.width], log: (m) => { last = m; if (process.env.TAP_VERBOSE) console.log(`  ${label}: ${m}`); } }),
        new Promise((r) => setTimeout(() => r([{ cause: 'stuck', what: `the screen stopped answering after: ${last}` }]), (onlyKeys === undefined ? 6 : 15) * 60000)), // (longer alone: 3D in software here)
      ]);
      await ctx.close();
      return issues;
    } catch (e) { await ctx.close(); return [{ cause: 'could not open', what: e.message.split('\n')[0] }]; }
  };
  // a screen whose taps were slow while other screens ran beside it is measured again on its own
  let solo = Promise.resolve(), soloing = 0;
  const job = (label, ...a) => async () => {
    let issues = await run(label, ...a);
    const keys = new Set(issues.filter((i) => i.key).map((i) => i.key));
    const again = issues.some((i) => i.cause === 'could not open' || i.cause === 'stuck'); // (the whole screen, alone)
    if (keys.size || again) {
      busy--; soloing++; // (waiting its turn: not counted as running)
      const prev = solo; let free; solo = new Promise((r) => { free = r; });
      try { await prev; while (busy > 0) await new Promise((r) => setTimeout(r, 200)); issues = await run(label, ...a, again ? null : keys); } finally { soloing--; busy++; free(); }
    }
    issues.forEach((i) => bad.push(`[${i.cause}] ${label}: ${i.what}`));
    if (process.env.TAP_REPORT) fs.appendFileSync(process.env.TAP_REPORT, `${label}: ${issues.length ? issues.map((i) => `[${i.cause}] ${i.what}`).join(' | ') : 'ok'}\n`);
  };
  const jobs = [], seenAt = { 390: new Set(), 1280: new Set() };
  let ids = [];
  if (!only || only.test('labs')) {
    const { ctx, page } = await open(b, { server: false, state: { groqKey: 'gsk_test' } });
    ids = await page.evaluate(async () => (await import('./labs/labs.js')).LABS.map((l) => l.id));
    await ctx.close();
  }
  // The whole sweep (TAP_SWEEP=all: every control, every lab, and the 3D views on a computer screen)
  // takes hours here, where 3D is drawn in software. The regular run: every screen at both sizes (the
  // 3D views on the phone), up to 2 controls of each kind on a screen (2 of a shelf's 30 lab cards),
  // and one lab of each kind: a simulation, a game, a puzzle and a study tool.
  const all = process.env.TAP_SWEEP === 'all' || !!only;
  const SAMPLE = /^(fractions|cracker|nonogram|vocab)$/;
  for (const [size, device, viewport, touch] of RESPONSE_SIZES) {
    for (const [name, go, o = {}] of TAP_SCREENS) if ((!only || only.test(name)) && (all || touch || !/^Explore/.test(name))) jobs.push(job(`${name} @ ${size}`, device, viewport, touch, o, go));
    for (const id of ids) {
      if (process.env.LAB_ONLY && !new RegExp(process.env.LAB_ONLY).test(id)) continue;
      if (!all && !process.env.LAB_ONLY && !SAMPLE.test(id)) continue;
      jobs.push(job(`lab ${id} @ ${size}`, device, viewport, touch, {}, async (page) => {
        await page.evaluate((x) => openLabs(x), id);
        await page.waitForSelector(`.lab-view:not([hidden])[data-lab="${id}"]`, { timeout: 15000 });
        await page.waitForTimeout(500);
      }));
    }
  }
  // a few screens at once (each in its own window)
  const lanes = +process.env.TAP_LANES || 4;
  let busy = 0;
  await Promise.all(Array.from({ length: lanes }, async () => { while (jobs.length) { while (soloing) await new Promise((r) => setTimeout(r, 200)); const j = jobs.shift(); if (!j) break; busy++; try { await j(); } finally { busy--; } } }));
  // freezes after the screen has answered are reported (a 3D picture drawn in software here makes them
  // on any machine like this one) but don't fail it: a tap must reach its control and show within 100 ms
  const freezes = bad.filter((x) => x.startsWith('[blocked]'));
  if (freezes.length) console.log(`  (${freezes.length} freezes after a visible response:)\n  ` + freezes.join('\n  '));
  const fails = bad.filter((x) => !x.startsWith('[blocked]'));
  expect(!fails.length, `${fails.length} controls that are slow or don't respond:\n` + fails.join('\n'));
});

// A real phone: in the Solar System, after Teach me (or any top-bar button) nothing could be tapped, not
// even Back. The 3D space labs now have no Teach me, Ask Cassie or Quiz me, as before Teach me existed.
test.slow('3D space labs: no Teach me, Ask Cassie or Quiz me; every control takes taps and Back goes to the shelf (390x844, 360x740, 1280x800)', async (b) => {
  const { tapResponseIssues } = require('./ui-checks.cjs');
  const bad = [];
  for (const [size, device, viewport, touch] of [['390x844', 'iPhone 13', { width: 390, height: 844 }, true], ['360x740', 'Pixel 7', { width: 360, height: 740 }, true], ['1280x800', 'Desktop Chrome', { width: 1280, height: 800 }, false]]) {
    // (the two labs side by side: about half the time)
    await Promise.all(['solar', 'space3d'].map(async (lab) => {
      // (a browser of its own for each lab and size, started again if this machine's software-drawn 3D
      // wears it out: dozens of reloads in a row, which a student never does, can crash it here)
      let own = null, page = null, errors = [];
      const boot = async () => {
        if (own) await own.close().catch(() => {});
        own = await chromium.launch(fs.existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : {});
        const o = await open(own, { device, viewport, touch, scale: 1, server: false, state: { groqKey: 'gsk_test' } });
        page = o.page; errors = o.errors; page.on('dialog', (d) => d.dismiss().catch(() => {}));
      };
      const go = async () => {
        if (page.url() !== APP) await page.goto(APP);
        await page.evaluate((x) => openLabs(x), lab);
        await page.waitForSelector(`.lab-view:not([hidden])[data-lab="${lab}"] .lab-controls > *`, { timeout: 30000 });
        await page.waitForTimeout(800);
      };
      const tap = async (sel) => { const r = await page.locator(sel).first().boundingBox(); if (touch) await page.touchscreen.tap(r.x + r.width / 2, r.y + r.height / 2); else await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2); };
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          await boot(); await go();
          for (const sel of ['.lab-teach', '.lab-ask', '.lab-quiz']) if (await page.locator(`.lab-view:not([hidden]) ${sel}`).isVisible()) bad.push(`${lab} @ ${size}: ${sel} is still there`);
          const issues = await tapResponseIssues(page, { touch, scope: '.lab-view:not([hidden]) .lab-head, .lab-view:not([hidden]) .lab-controls, .lab-view:not([hidden]) .lab-stage', perKind: 1, max: 10, skip: /delete|sign out/i,
            reopen: async () => { if (page.isClosed()) await boot(); await page.goto(APP); await go(); return page; } });
          issues.filter((i) => i.cause !== 'blocked').forEach((i) => bad.push(`${lab} @ ${size}: [${i.cause}] ${i.what}`));
          // Back, from wherever the check left the lab, goes to the shelf
          if (!(await page.locator(`.lab-view:not([hidden])[data-lab="${lab}"]`).count())) { await page.goto(APP); await go(); }
          await tap('.lab-view:not([hidden]) .lab-back');
          await page.waitForSelector('.labs:not([hidden]) .labs-shelf:not([hidden])', { timeout: 8000 }).catch(() => bad.push(`${lab} @ ${size}: Back didn’t go to the shelf`));
          if (errors.length) bad.push(`${lab} @ ${size}: page errors: ${errors.join('; ')}`);
          break;
        } catch (e) {
          // (this machine's browser gave out: once more in a new one; anything else is a real failure)
          if (attempt === 0 && /closed|crash|Target|new tab/i.test(e.message)) { console.log(`  (${lab} @ ${size}: this machine's browser gave out; again in a new one)`); continue; }
          bad.push(`${lab} @ ${size}: ${e.message.split('\n')[0]}`); break;
        }
      }
      await own.close().catch(() => {});
    }));
  }
  expect(!bad.length, bad.join('\n'));
});

test('Liquid Glass turns solid in Lite mode and with Reduce Transparency; Reduce Motion stops movement; buttons have 3 sizes and pressed, disabled and loading states', async (b) => {
  const glass = (page) => page.evaluate(() => { const st = getComputedStyle(document.querySelector('.composer')); return { blur: st.backdropFilter || st.webkitBackdropFilter, bg: st.backgroundImage + ' ' + st.backgroundColor }; });
  // glass by default (Lite mode off)
  let { ctx, page } = await open(b, { lite: 'off', server: false, state: { groqKey: 'gsk_test' } });
  let g = await glass(page);
  expect(/blur/.test(g.blur), 'the chat box is frosted glass: ' + g.blur);
  // Reduce Transparency: solid, no blur
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }] });
  g = await glass(page);
  expect(!/blur/.test(g.blur) && /none/.test(g.bg), 'Reduce Transparency makes the chat box solid: ' + JSON.stringify(g));
  await cdp.send('Emulation.setEmulatedMedia', { features: [] });
  // Reduce Motion: nothing slides or spins
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const motion = await page.evaluate(() => { const b = document.createElement('button'); b.className = 'btn is-loading'; b.textContent = 'Save'; document.body.appendChild(b); const t = getComputedStyle(document.querySelector('.chip')).transitionDuration; const a = getComputedStyle(b, '::after').animationName; const d = getComputedStyle(b, '::after').animationDuration; b.remove(); return { t, a, d }; });
  expect(/^0\.00001s|^1e-05s|^0s/.test(motion.t) && (motion.a === 'none' || /^0\.00001s|^1e-05s/.test(motion.d)), 'Reduce Motion stops the movement: ' + JSON.stringify(motion));
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  // buttons: sizes and states
  const btns = await page.evaluate(() => {
    const make = (cls, attrs = {}) => { const b = document.createElement('button'); b.className = cls; b.textContent = 'Save'; Object.assign(b, attrs); document.body.appendChild(b); return b; };
    const sm = make('btn btn-sm'), md = make('btn'), lg = make('btn btn-lg'), off = make('btn', { disabled: true }), busy = make('btn is-loading'), glassB = make('btn btn-glass');
    busy.setAttribute('aria-busy', 'true');
    const h = (e) => Math.round(e.getBoundingClientRect().height);
    const out = { sm: h(sm), md: h(md), lg: h(lg), offOpacity: getComputedStyle(off).opacity, offCursor: getComputedStyle(off).cursor, busyText: getComputedStyle(busy).color, busySpinner: getComputedStyle(busy, '::after').content, busyClicks: getComputedStyle(busy).pointerEvents, glassBlur: getComputedStyle(glassB).backdropFilter };
    [sm, md, lg, off, busy, glassB].forEach((e) => e.remove());
    return out;
  });
  expect(btns.sm === 44 && btns.md === 48 && btns.lg === 56, 'three button sizes (44, 48, 56): ' + JSON.stringify(btns));
  expect(+btns.offOpacity < .6 && btns.offCursor === 'not-allowed', 'a disabled button looks disabled: ' + JSON.stringify(btns));
  expect(/rgba\(0, 0, 0, 0\)|transparent/.test(btns.busyText) && btns.busySpinner === '""' && btns.busyClicks === 'none', 'a loading button shows a spinner and can’t be tapped twice: ' + JSON.stringify(btns));
  expect(/blur/.test(btns.glassBlur), 'a glass button is frosted: ' + JSON.stringify(btns));
  // pressed: it shrinks a little while held
  await page.evaluate(() => { const b = document.createElement('button'); b.className = 'btn'; b.id = 'press-me'; b.textContent = 'Press'; b.style.cssText = 'position:fixed;left:20px;top:200px;z-index:99999'; document.body.appendChild(b); });
  const box = await page.locator('#press-me').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.waitForTimeout(250);
  const pressed = await page.evaluate(() => getComputedStyle(document.querySelector('#press-me')).transform);
  await page.mouse.up();
  expect(/matrix\(0\.97/.test(pressed), 'a pressed button shrinks a little: ' + pressed);
  await ctx.close();
  // Lite mode (slow phones): solid surfaces too
  ({ ctx, page } = await open(b, { lite: 'on', server: false, state: { groqKey: 'gsk_test' } }));
  g = await glass(page);
  expect(!/blur/.test(g.blur) && /none/.test(g.bg), 'Lite mode makes the chat box solid: ' + JSON.stringify(g));
  await ctx.close();
});

test('forms check each field as you type: the reason shows under the field in plain words, from one map of messages', async (b) => {
  const src = fs.readFileSync(path.join(ROOT, 'errors.js'), 'utf8');
  expect(/window\.CassieErrors = \{ STRINGS, say, explain, form, empty \}/.test(src), 'one map of messages and one helper (errors.js)');
  // the app shows no raw error text: messages go through the helper
  const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const raw = app.split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => /(showErr|alert|textContent\s*=)\s*\(?\s*e\d?\.message|err\.textContent = e\.message/.test(l));
  expect(!raw.length, 'raw error text shown at app.js:' + raw.map(([n]) => n).join(', '));
  const taken = `taken${Date.now()}@example.com`;
  let { ctx, page } = await open(b, { state: null });
  await toSignIn(page);
  await page.evaluate(async ([srv, email]) => fetch(srv + '/auth/signup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'secret-pass-1', age: 15 }) }), [SERVER, taken]);
  const under = (name) => page.locator(`.auth-form [name=${name}]`).locator('xpath=ancestor::label[1]').locator('.field-err');
  const shown = async (name) => ((await under(name).isVisible()) ? (await under(name).textContent()) : '');
  // typing: after a short pause the reason shows under the field, and goes away once it's fixed
  await page.type('.auth-form [name=email]', 'hazel@', { delay: 20 });
  await page.waitForFunction(() => [...document.querySelectorAll('.auth-form .field-err')].some((p) => !p.hidden && /@ and a dot/.test(p.textContent)), null, { timeout: 4000, polling: 100 });
  expect((await page.locator('.auth-form [name=email]').getAttribute('aria-invalid')) === 'true', 'the email box is marked as needing a fix');
  await page.type('.auth-form [name=email]', 'example.com', { delay: 10 });
  expect(!(await shown('email')), 'the reason goes away as soon as the email is right');
  await page.fill('.auth-form [name=age]', '150'); await page.locator('.auth-form [name=age]').blur();
  expect(/Ages go from 2 to 100/.test(await shown('age')), 'a wrong age says why: ' + await shown('age'));
  await page.fill('.auth-form [name=age]', '15');
  await page.fill('.auth-form [name=password]', 'abc'); await page.locator('.auth-form [name=password]').blur();
  expect(/at least 8 letters or numbers.*Add 5 more/.test(await shown('password')), 'a short password says how many more: ' + await shown('password'));
  await page.fill('.auth-form [name=password]', 'secret-pass-1');
  expect(!(await shown('password')), 'fixed password: no reason left');
  // the server's answer lands under the right field, in the map's words
  await page.fill('.auth-form [name=email]', taken);
  await page.click('.auth-go');
  await page.waitForFunction(() => [...document.querySelectorAll('.auth-form .field-err')].some((p) => !p.hidden && p.textContent), null, { timeout: 8000, polling: 100 });
  expect(await shown('email') === 'That email is already signed up. Try signing in instead.', 'taken email: ' + await shown('email'));
  // a whole empty form: every reason at once, the first box focused
  await page.click('.auth-switch [data-to=signin]');
  await page.fill('.auth-form [name=email]', ''); await page.fill('.auth-form [name=password]', '');
  await page.click('.auth-go');
  expect(/Type your email/.test(await shown('email')) && /Type your password/.test(await shown('password')), 'empty sign-in says what to type');
  expect(await page.evaluate(() => document.activeElement && document.activeElement.name) === 'email', 'the first box to fix gets the focus');
  await ctx.close();
  // the profile questions, Report a problem and a pasted API key
  ({ ctx, page } = await open(b, { server: true, state: { groqKey: '' } }));
  await page.evaluate(() => openProfile(false));
  await page.fill('.profile-card [name=name]', ''); await page.click('.profile-card .pf-go');
  expect(await page.locator('.profile-card .field-err:not([hidden])').first().textContent() === await page.evaluate(() => CassieErrors.say('need_name')), 'the profile says what’s missing under the name');
  await page.fill('.profile-card [name=name]', 'Hazel');
  expect(await page.locator('.profile-card label:has([name=name]) .field-err').isHidden(), 'typing the name clears its reason');
  await page.evaluate(() => document.querySelector('.profile-overlay').remove());
  await page.evaluate(() => openReport());
  await page.type('.profile-card [name=text]', 'ab'); await page.locator('.profile-card [name=text]').blur();
  expect(/few words/.test(await page.locator('.profile-card .field-err:not([hidden])').textContent()), 'Report a problem asks for a few words');
  await page.evaluate(() => document.querySelector('.profile-overlay').remove());
  await tapSettings(page);
  await page.evaluate(() => { const d = document.querySelector('#groq-key-input').closest('details'); if (d) d.open = true; });
  await page.type('#groq-key-input', 'abc123');
  await page.waitForFunction(() => /start with “gsk_”/.test(document.querySelector('#groq-key-input').closest('label').querySelector('.field-err').textContent), null, { timeout: 4000, polling: 100 });
  // every message: plain words, no codes, no dashes, ends like a sentence
  const all = await page.evaluate(() => Object.entries(window.CassieErrors.STRINGS).map(([k, v]) => [k, v.replace(/\{\w+\}/g, 'Try again.')])); // each {gap} filled the way the app fills it
  const bad = all.filter(([, t]) => !/[.!?”]$/.test(t) || /[—–]|\b(error|undefined|null|status|error code)\b|\b[45]\d\d\b/i.test(t));
  expect(!bad.length, 'messages that aren’t plain: ' + bad.map(([k]) => k).join(', '));
  expect(await page.evaluate(() => CassieErrors.explain(new Error('Failed to fetch')) === CassieErrors.say('network') && CassieErrors.explain(Object.assign(new Error('x'), { status: 500 })) === CassieErrors.say('unknown')), 'raw failures become plain words');
  await ctx.close();
});

test('chat: when something fails Cassie says what happened, why and what to do, in plain words; empty lists offer one next step', async (b) => {
  // the service's own error text (codes, internals) never reaches the chat
  let { ctx, page } = await open(b, { server: false, state: { groqKey: 'gsk_test' }, fakeGroq: () => ({ status: 500, message: 'upstream_error: model_overloaded at node 7 (code 502)' }) });
  await page.fill('#prompt-input', 'what is osmosis'); await page.press('#prompt-input', 'Enter');
  await page.waitForSelector('#chat-log .bubble.error', { timeout: 30000 });
  const said = await page.locator('#chat-log .bubble.error').last().innerText();
  const plain = await page.evaluate((t) => Object.values(CassieErrors.STRINGS).some((v) => t.includes(v)), said);
  expect(plain && !/upstream|overloaded|node 7|502|500|error:/i.test(said), 'a failed answer is in plain words from the map: ' + said);
  expect(await page.locator('#chat-log .bubble.error .retry-btn').count() === 1, 'a failed answer offers Try again');
  // every way the chat words an error goes through the one helper
  const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  expect(/function errorText\(err, fallback = 'unknown'\) \{ return CassieErrors\.explain\(err, fallback\); \}/.test(app), 'chat errors go through CassieErrors.explain');
  expect(!/detail\.slice\(0, 140\)|\$\{CV\.error\(\)|data\.error\.message\) \|\||\(\$\{m\.slice\(0, 120\)\}\)/.test(app), 'no raw service text is shown (Groq, Gemini, the voice download, the picture makers)');
  // empty lists: the side menu with no chats, the memory panel, nothing to review
  await page.evaluate(() => { state.chats = []; renderChatList(); openSidebar(); });
  const es = page.locator('#chat-list .empty-state');
  expect(await es.locator('.es-title').textContent() === 'No chats yet' && await es.locator('.es-go').count() === 1, 'the side menu says why it is empty and offers one next step');
  await es.locator('.es-go').click();
  expect(await page.evaluate(() => document.activeElement === document.getElementById('prompt-input')), 'Ask your first question goes to the chat box');
  await page.evaluate(() => { window.CassieMemory.clearAll(); openMemory(); });
  const mem = page.locator('#memory-panel .empty-state');
  expect(await mem.count() === 1 && await mem.locator('.es-go').count() === 1, 'the memory panel says nothing is remembered yet and offers one next step');
  await page.evaluate(() => { document.getElementById('memory-panel').hidden = true; state.mistakes = []; reviewMistakes(); });
  const rv = page.locator('#chat-log .empty-state').last();
  expect(await rv.locator('.es-title').textContent() === 'No mistakes to review' && await rv.locator('.es-go').textContent() === 'Start a quiz', 'nothing to review says so and offers a quiz');
  await ctx.close();
});

test('Labs in Liquid Glass: 44px tap targets and AA words on a phone (the Labs tab), errors from the one map in white (no colour), an empty search offers to ask Cassie', async (b) => {
  const { tapTargetIssues, contrastIssues } = require('./ui-checks.cjs');
  // no lab shows a raw error, and every lab error comes from the map
  const raw = [];
  for (const f of fs.readdirSync(path.join(ROOT, 'labs')).filter((x) => x.endsWith('.js'))) {
    fs.readFileSync(path.join(ROOT, 'labs', f), 'utf8').split('\n').forEach((l, i) => { if (/(textContent|innerHTML)\s*=.*\b(e|err)\.message|\$\{res\.error\}|: ' \+ e\.message/.test(l)) raw.push(`${f}:${i + 1}`); });
  }
  expect(!raw.length, 'labs show raw error text at ' + raw.join(', '));
  const { ctx, page } = await open(b, { device: 'iPhone 13', lite: 'off', server: false, state: { groqKey: 'gsk_test' }, fakeGroq: () => ({ text: 'Osmosis is water moving across a membrane.' }) });
  await page.evaluate(() => openLabs(undefined, { section: 'learn' }));
  await page.waitForSelector('.lp:not([hidden]) .lp-card', { timeout: 20000 }); // (a phone: the Labs tab)
  let small = await tapTargetIssues(page);
  expect(!small.length, 'Labs tab: tap targets under 44px: ' + small.join(' | '));
  let c = await contrastIssues(page, '.lp');
  expect(c.checked > 5 && !c.bad.length, 'Labs tab: words under AA: ' + c.bad.join(' | '));
  // a search with no lab: why, and one next step that asks Cassie in the chat
  await page.click('.lp-find');
  await page.fill('.lp-q', 'zzxqy');
  await seen(page, '.lp .es-title', 'No lab by that name yet', 8000);
  await page.click('.lp .es-go');
  await seen(page, '#chat-log .bubble-user', 'Explain zzxqy', 15000);
  // a lab: its controls are 44px to touch, its words readable, its error text white
  await page.evaluate(() => openLabs('projectile'));
  await page.waitForSelector('.lab-view:not([hidden]) .lab-controls > *', { timeout: 20000 });
  await page.waitForTimeout(600);
  small = await tapTargetIssues(page);
  expect(!small.length, 'a lab: tap targets under 44px: ' + small.join(' | '));
  const errColour = await page.evaluate(() => { const p = document.createElement('p'); p.className = 'lab-err'; p.textContent = 'x'; document.querySelector('.lab-view').appendChild(p); const col = getComputedStyle(p).color; p.remove(); return col; });
  const [r, g, bl] = errColour.match(/\d+/g).map(Number);
  expect(Math.max(r, g, bl) - Math.min(r, g, bl) <= 4, 'lab error text is a neutral grey, no colour: ' + errColour);
  expect(await page.evaluate(() => typeof window.CassieErrors.say('lab_ai_failed', { next: 'Try again.' }) === 'string' && !/\{next\}/.test(window.CassieErrors.say('lab_ai_failed'))), 'a lab message never shows a {gap}');
  await ctx.close();
});

test('the other screens in Liquid Glass: Plus sheet, offline note, board, flashcards and the landing page (44px to touch, AA words, one next step when empty)', async (b) => {
  const { tapTargetIssues, contrastIssues } = require('./ui-checks.cjs');
  let { ctx, page } = await open(b, { device: 'iPhone 13', lite: 'off', server: false, state: { groqKey: 'gsk_test', plan: null, cards: [] } });
  // the Plus sheet: what was tapped, why, what Plus adds, and two clear buttons (no payments here)
  await page.evaluate(() => plusSheet('Real 3D views', 'You’ve used this week’s 2 free views. They come back on Monday.'));
  const sheet = page.locator('.plus-sheet');
  expect(/Real 3D views comes with Plus/.test(await sheet.locator('h3').innerText()) && await sheet.locator('.plus-list li').count() === 3, 'the Plus sheet says what it is and what Plus adds');
  expect(await sheet.locator('.plus-see').getAttribute('href') === 'index.html#pricing' && await sheet.locator('.plus-join').count() === 1, 'See the plans goes to the plans, and the early list is one tap (no payment here)');
  await sheet.locator('.plus-ok').click();
  expect(await page.locator('.plus-sheet').count() === 0, 'Not now closes it');
  // offline: a calm note says what still works, and goes away when the internet is back
  await ctx.setOffline(true);
  await seen(page, '#offline-note', 'still work', 5000);
  expect(/Questions to Cassie need the internet/.test(await page.locator('#offline-note').innerText()), 'the offline note says what needs the internet');
  await ctx.setOffline(false);
  await page.waitForFunction(() => document.getElementById('offline-note').hidden, null, { timeout: 5000, polling: 100 });
  // flashcards with none yet: why, and one next step
  await page.evaluate(() => { state.cards = []; save(); const t = document.querySelector('.tabbar [data-tab="cards"]'); if (t) t.click(); });
  await seen(page, '.empty-state .es-title', 'No flashcards yet', 8000);
  await page.click('.empty-state .es-go');
  expect(await page.evaluate(() => document.activeElement && document.activeElement.name === 'f'), 'Write a card opens the form at the front of the card');
  let small = await tapTargetIssues(page);
  expect(!small.length, 'flashcards: tap targets under 44px: ' + small.join(' | '));
  for (const scheme of ['light', 'dark']) { await page.emulateMedia({ colorScheme: scheme }); await page.waitForTimeout(900); const c = await contrastIssues(page); expect(!c.bad.length, `flashcards (${scheme}): words under AA: ` + c.bad.join(' | ')); }
  await page.emulateMedia({ colorScheme: 'light' });
  // the board: every tool is 44px to touch
  await page.evaluate(() => { const t = document.querySelector('.tabbar [data-tab="chat"]'); if (t) t.click(); });
  await page.click('#board-btn');
  await page.waitForSelector('.csk-live', { timeout: 15000 });
  small = await tapTargetIssues(page);
  expect(!small.length, 'board: tap targets under 44px: ' + small.join(' | '));
  await ctx.close();
  // the landing page
  ({ ctx, page } = await open(b, { device: 'iPhone 13', lite: 'off', server: false, state: null }));
  await page.goto(APP.replace('app.html', 'index.html'));
  await page.waitForTimeout(1500);
  small = await tapTargetIssues(page);
  expect(!small.length, 'landing: tap targets under 44px: ' + small.join(' | '));
  await ctx.close();
});

test('works offline after the first visit (app opens)', async (b) => {
  // no network fakes here: Playwright's fakes and service workers don't mix
  const ctx = await b.newContext({ ...devices['Pixel 7'] });
  await ctx.addInitScript(() => { window.CASSIE_SERVER = ''; });
  await ctx.addInitScript((v) => { if (!localStorage.getItem('cassie.v2')) localStorage.setItem('cassie.v2', JSON.stringify({ profile: { name: 'T', role: 'student', grade: 'Grade 9', age: 14 }, seenVersion: v, lite: 'on' })); }, APP_VERSION);
  const page = await ctx.newPage();
  await page.goto(APP);
  const ready = await page.evaluate(() => Promise.race([navigator.serviceWorker.ready.then(() => true), new Promise((r) => setTimeout(() => r(false), 8000))]));
  expect(ready, 'service worker never became ready');
  await page.reload();
  await page.waitForTimeout(800);
  await ctx.setOffline(true);
  await page.reload({ timeout: 10000 });
  await page.waitForSelector('#prompt-input:visible, #home:not([hidden])', { timeout: 5000 }); // the chat, or Home on a phone
  await ctx.close();
});

test('extension: highlights, snips and pastes show up as chats in the Cassie app', async () => {
  const ext = path.join(ROOT, 'extension');
  const profile = fs.mkdtempSync(path.join(require('os').tmpdir(), 'cassie-ext-'));
  const ctx = await chromium.launchPersistentContext(profile, {
    headless: true, ...(fs.existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : { channel: 'chromium' }),
    args: ['--headless=new', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  try {
    // Cassie's own worker (full Chromium has built-in extensions with a background.js too)
    const isCassie = async (w) => /\/background\.js$/.test(w.url()) && await w.evaluate(() => typeof logAnswer === 'function').catch(() => false);
    let sw = null;
    for (let i = 0; i < 80 && !sw; i++) {
      for (const w of ctx.serviceWorkers()) if (await isCassie(w)) { sw = w; break; }
      if (!sw) await new Promise((r) => setTimeout(r, 250));
    }
    expect(sw, 'the Cassie extension did not start');
    const saved = await sw.evaluate(async (png) => {
      logAnswer({ kind: 'highlight', q: 'Explain: photosynthesis' }, 'Plants make food from light.', null, { tab: { url: 'https://example.com/bio', title: 'Biology notes' } });
      logAnswer({ kind: 'snip', q: 'Explain my snip' }, '{"headline":"A parabola","steps":["It opens up","Vertex at 0"]}', 'data:image/png;base64,' + png, { tab: { url: 'https://example.com/bio', title: 'Biology notes' } });
      logAnswer({ kind: 'paste', q: 'Explain the picture I pasted' }, 'A cell diagram.', null, { tab: { url: 'https://other.org/x', title: 'Other page' } });
      await logChain;
      return (await chrome.storage.local.get('cassieHistory')).cassieHistory;
    }, PNG.toString('base64'));
    expect(saved.length === 3 && saved[1].a.startsWith('**A parabola**') && saved[1].image, 'history should hold 3 items with the snip as steps + a picture: ' + JSON.stringify(saved).slice(0, 300));
    // the real site address, served from this repo, so the extension's bridge runs on it
    await ctx.route(/askcassie\.pages\.dev/, async (route) => {
      const u = new URL(route.request().url());
      return route.fulfill({ response: await route.fetch({ url: `http://localhost:${APP_PORT}${u.pathname}` }) });
    });
    await ctx.route(/workers\.dev|fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
    await ctx.addInitScript((seed) => { window.CASSIE_SERVER = ''; if (!localStorage.getItem('cassie.v2')) localStorage.setItem('cassie.v2', seed); }, JSON.stringify({ profile: PROFILE, seenVersion: APP_VERSION, lite: 'on' }));
    const page = await ctx.newPage();
    await page.goto('https://askcassie.pages.dev/app.html');
    await page.waitForFunction(() => state.chats.filter((c) => c.extKey).length === 2, null, { timeout: 10000 });
    const chats = await page.evaluate(() => state.chats.filter((c) => c.extKey).map((c) => ({ title: c.title, n: c.messages.length, img: !!c.messages.find((m) => m.image) })));
    const bio = chats.find((c) => /Biology notes/.test(c.title));
    expect(bio && bio.n === 4 && bio.img, 'the Biology page chat should have the highlight and the snip with its picture: ' + JSON.stringify(chats));
    expect(chats.some((c) => /From Chrome · Other page/.test(c.title)), 'the pasted picture should be in its own page chat');
    // a reload doesn't add them twice
    await page.reload();
    await page.waitForTimeout(1500);
    expect(await page.evaluate(() => state.chats.filter((c) => c.extKey).reduce((n, c) => n + c.messages.length, 0)) === 6, 'items were imported twice');
  } finally { await ctx.close(); fs.rmSync(profile, { recursive: true, force: true }); }
});

test('extension: a refused Gemini model tries the next one, then Cassie’s server (no keys needed)', async () => {
  const ext = path.join(ROOT, 'extension');
  const profile = fs.mkdtempSync(path.join(require('os').tmpdir(), 'cassie-ext-'));
  const ctx = await chromium.launchPersistentContext(profile, {
    headless: true, ...(fs.existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : { channel: 'chromium' }),
    args: ['--headless=new', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  try {
    const isCassie = async (w) => /\/background\.js$/.test(w.url()) && await w.evaluate(() => typeof readPicture === 'function').catch(() => false);
    let sw = null;
    for (let i = 0; i < 80 && !sw; i++) { for (const w of ctx.serviceWorkers()) if (await isCassie(w)) { sw = w; break; } if (!sw) await new Promise((r) => setTimeout(r, 250)); }
    expect(sw, 'the Cassie extension did not start');
    const out = await sw.evaluate(async (png) => {
      const realFetch = fetch, seen = [];
      let refuseAll = false;
      globalThis.fetch = async (url, init) => {
        const u = String(url);
        if (u.includes('generativelanguage')) {
          seen.push(u.match(/models\/([^:]+)/)[1]);
          if (refuseAll || u.includes('gemini-3.6')) return Response.json({ error: { code: 403, message: 'Permission denied for this model.' } }, { status: 403 });
          return Response.json({ candidates: [{ content: { parts: [{ text: 'Gemini 2.5 read it.' }] } }] });
        }
        if (u.includes('workers.dev/chat')) { const b = JSON.parse(init.body); return Response.json({ choices: [{ message: { content: Array.isArray(b.messages.at(-1).content) ? 'Server read the picture.' : 'Server answered the text.' } }] }); }
        return realFetch(url, init);
      };
      const img = 'data:image/png;base64,' + png;
      const r = {};
      r.next = await readPicture({ geminiKey: 'AIza_x' }, { image: img, prompt: 'What is this?' });
      r.tried = seen.slice();
      refuseAll = true;
      r.server = await readPicture({ geminiKey: 'AIza_x' }, { image: img, prompt: 'What is this?' });
      r.noKeyPic = await readPicture({}, { image: img, prompt: 'What is this?' });
      r.noKeyText = await answerAny('What is osmosis?', {});
      globalThis.fetch = realFetch;
      return r;
    }, PNG.toString('base64'));
    expect(out.next === 'Gemini 2.5 read it.' && out.tried[0].startsWith('gemini-3.6') && out.tried[1] === 'gemini-2.5-flash', 'a refused model should move on to the next: ' + JSON.stringify(out));
    expect(out.server === 'Server read the picture.', 'all Gemini models refused → the server reads it: ' + out.server);
    expect(out.noKeyPic === 'Server read the picture.' && out.noKeyText === 'Server answered the text.', 'no keys at all → the server answers');
  } finally { await ctx.close(); fs.rmSync(profile, { recursive: true, force: true }); }
});

test('extension: a Gemini key alone answers (and streams), and covers for a busy Groq', async () => {
  const ext = path.join(ROOT, 'extension');
  const profile = fs.mkdtempSync(path.join(require('os').tmpdir(), 'cassie-ext-'));
  const ctx = await chromium.launchPersistentContext(profile, {
    // extensions need full Chromium (not the slim headless shell Playwright uses by default)
    headless: true, ...(fs.existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : { channel: 'chromium' }),
    args: ['--headless=new', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  try {
    const isCassie = (w) => /\/background\.js$/.test(w.url());
    let sw = ctx.serviceWorkers().find(isCassie);
    if (!sw) sw = await ctx.waitForEvent('serviceworker', { predicate: isCassie, timeout: 20000 });
    const out = await sw.evaluate(async () => {
      const realFetch = fetch;
      const sse = (texts) => new Response(texts.map((t) => `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: t }] } }] })}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
      let groqMode = 'ok';
      globalThis.fetch = async (url, init) => {
        const u = String(url);
        if (u.includes('generativelanguage')) return u.includes('stream') ? sse(['Gemini ', 'streams ', 'this.']) : Response.json({ candidates: [{ content: { parts: [{ text: 'Gemini answer.' }] } }] });
        if (u.includes('api.groq.com')) return groqMode === 'busy'
          ? Response.json({ error: { message: 'Rate limit reached. Please try again in 3h.' } }, { status: 429, headers: { 'retry-after': '12000' } })
          : Response.json({ choices: [{ message: { content: 'Groq answer.' } }] });
        return realFetch(url, init);
      };
      const r = {};
      r.plain = await answerText('What is osmosis?', { geminiKey: 'AIza_x' });
      const parts = [];
      r.streamed = await answerText('What is osmosis?', { geminiKey: 'AIza_x' }, (d) => parts.push(d));
      r.parts = parts.length;
      r.groq = await answerText('hi', { groqKey: 'gsk_x', geminiKey: 'AIza_x' });
      groqMode = 'busy';
      r.covered = await answerText('hi', { groqKey: 'gsk_x', geminiKey: 'AIza_x' });
      try { await answerText('hi', {}); } catch (e) { r.noKey = e.message; }
      globalThis.fetch = realFetch;
      return r;
    });
    expect(out.plain === 'Gemini answer.', 'Gemini-only answer: ' + out.plain);
    expect(out.streamed === 'Gemini streams this.' && out.parts === 3, 'Gemini streaming: ' + JSON.stringify(out));
    expect(out.groq === 'Groq answer.', 'Groq should answer first when it has a key');
    expect(out.covered === 'Gemini answer.' || /Gemini/.test(out.covered), 'Gemini should cover a busy Groq: ' + out.covered);
    expect(out.noKey === 'no-key', 'no keys should say no-key');
  } finally { await ctx.close(); fs.rmSync(profile, { recursive: true, force: true }); }
});

test('extension: highlight help ON or OFF (the switch next to Snip) — off, highlighting is just highlighting', async () => {
  const ext = path.join(ROOT, 'extension');
  const profile = fs.mkdtempSync(path.join(require('os').tmpdir(), 'cassie-ext-'));
  const ctx = await chromium.launchPersistentContext(profile, {
    headless: true, ...(fs.existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : { channel: 'chromium' }),
    args: ['--headless=new', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  try {
    await ctx.route(/workers\.dev|api\.groq\.com|fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
    await ctx.route(/example\.com/, (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><title>Biology notes</title></head><body><h1>Biology notes</h1><p id="p" style="margin:120px 60px">Cells divide by mitosis.</p><input id="i" value="x"></body></html>' }));
    const isCassie = async (w) => /\/background\.js$/.test(w.url()) && await w.evaluate(() => typeof logAnswer === 'function').catch(() => false);
    let sw = null;
    for (let i = 0; i < 80 && !sw; i++) {
      for (const w of ctx.serviceWorkers()) if (await isCassie(w)) { sw = w; break; }
      if (!sw) await new Promise((r) => setTimeout(r, 250));
    }
    expect(sw, 'the Cassie extension did not start');
    const page = await ctx.newPage();
    await page.goto('https://example.com/bio');
    await page.waitForFunction(() => document.getElementById('cassie-ext-host-92f1'), null, { timeout: 10000 });
    const ui = () => page.evaluate(() => { const r = document.getElementById('cassie-ext-host-92f1').shadowRoot; return { chip: !!r.querySelector('.ask-chip'), pop: !r.querySelector('.popover').hidden, popText: r.querySelector('.popover').innerText }; });
    const closePop = () => page.evaluate(() => { const r = document.getElementById('cassie-ext-host-92f1').shadowRoot; const x = r.querySelector('.popover .header button'); if (x && !r.querySelector('.popover').hidden) x.click(); });
    const select = async () => {
      await page.evaluate(() => window.getSelection().removeAllRanges());
      const b = await page.locator('#p').boundingBox();
      await page.mouse.move(b.x + 1, b.y + b.height / 2); await page.mouse.down();
      await page.mouse.move(b.x + b.width - 1, b.y + b.height / 2, { steps: 4 }); await page.mouse.up();
      await page.waitForTimeout(650);
    };

    // 1. ON (the default): a highlight opens the Explain / Answer / Code choice — no extra button
    await select();
    let s = await ui();
    expect(s.pop && /What should I do with this/.test(s.popText) && !s.chip, 'a highlight opens Cassie: ' + JSON.stringify(s));
    await closePop();
    // right-click keeps the browser's menu (with Copy)
    const kept = await page.evaluate(() => { const p = document.getElementById('p').getBoundingClientRect(); return document.getElementById('p').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: p.left + 5, clientY: p.top + 5 })); });
    expect(kept, 'right-click should keep the browser menu');

    // 2. the ON/OFF switch in the side buttons (with Snip): off = highlight and copy like normal
    const hl = () => page.evaluate(() => { const b = document.getElementById('cassie-ext-host-92f1').shadowRoot.querySelector('.dock-hl'); return b && b.getAttribute('aria-pressed'); });
    await page.waitForFunction(() => document.getElementById('cassie-ext-host-92f1').shadowRoot.querySelector('.dock-hl'), null, { timeout: 5000 });
    // closing the pop-up (×) turned highlight help OFF, the same switch; the switch turns it back ON
    await page.waitForFunction(() => document.getElementById('cassie-ext-host-92f1').shadowRoot.querySelector('.dock-hl').getAttribute('aria-pressed') === 'false', null, { timeout: 3000 });
    await page.evaluate(() => document.getElementById('cassie-ext-host-92f1').shadowRoot.querySelector('.dock-hl').click());
    await page.waitForFunction(() => document.getElementById('cassie-ext-host-92f1').shadowRoot.querySelector('.dock-hl').getAttribute('aria-pressed') === 'true', null, { timeout: 3000 });
    expect(await hl() === 'true', 'the switch is ON again');
    await page.evaluate(() => document.getElementById('cassie-ext-host-92f1').shadowRoot.querySelector('.dock-hl').click());
    await page.waitForFunction(() => document.getElementById('cassie-ext-host-92f1').shadowRoot.querySelector('.dock-hl').getAttribute('aria-pressed') === 'false', null, { timeout: 3000 });
    if (process.env.SHOTS) { await page.evaluate(() => document.getElementById('cassie-ext-host-92f1').shadowRoot.querySelector('.dock').classList.add('open')); await page.screenshot({ path: process.env.SHOTS + '/ext-hl-switch.png' }); await page.evaluate(() => document.getElementById('cassie-ext-host-92f1').shadowRoot.querySelector('.dock').classList.remove('open')); }
    await select();
    s = await ui();
    expect(!s.pop, 'with the switch OFF, highlighting shows nothing: ' + JSON.stringify(s));
    // double-tap Ctrl still asks Cassie on purpose
    await page.keyboard.press('Control'); await page.keyboard.press('Control');
    await page.waitForTimeout(100);
    s = await ui();
    expect(s.pop && /What should I do with this/.test(s.popText), 'double-tap Ctrl still opens Cassie for the highlight');
    await closePop();
    await page.evaluate(() => document.getElementById('cassie-ext-host-92f1').shadowRoot.querySelector('.dock-hl').click());
    await page.waitForFunction(() => document.getElementById('cassie-ext-host-92f1').shadowRoot.querySelector('.dock-hl').getAttribute('aria-pressed') === 'true', null, { timeout: 3000 });
    await select();
    expect((await ui()).pop, 'switched back ON, a highlight opens Cassie again');
    await closePop();

    // 3. the same On / Off in the extension's popup
    const id = new URL(sw.url()).host;
    const pop = await ctx.newPage();
    await pop.goto(`chrome-extension://${id}/popup.html`);
    expect(await pop.locator('#hl-mode').inputValue() === 'off', 'closing the pop-up turned highlight help off, and the toolbar popup says so');
    await pop.selectOption('#hl-mode', 'on');
    await page.bringToFront(); await page.waitForTimeout(200);
    expect(await hl() === 'true', 'the toolbar popup turns it back on, and the side switch follows');
    await pop.bringToFront();
    await pop.selectOption('#hl-mode', 'off');
    await page.bringToFront(); await page.waitForTimeout(200);
    expect(await hl() === 'false', 'the side switch follows the popup');
    await select();
    expect(!(await ui()).pop, '"Off" shows nothing');
    await pop.close();
  } finally { await ctx.close(); fs.rmSync(profile, { recursive: true, force: true }); }
});

// Highlight a situation and press Code: first Simple or Complete, then the code in its own box with
// Copy code (only the code) and Copy for Colab; Python that runs as it is (checked, fixed once by
// Cassie); and each student's own names (a theme from their install id, which is never sent).
test('extension Code: Simple or Complete first, a code box with Copy code and Copy for Colab, a quick check with one fix, and each student’s own names', async () => {
  const ext = path.join(ROOT, 'extension');
  const profile = fs.mkdtempSync(path.join(require('os').tmpdir(), 'cassie-ext-'));
  const ctx = await chromium.launchPersistentContext(profile, {
    headless: true, ...(fs.existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : { channel: 'chromium' }),
    args: ['--headless=new', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  try {
    await ctx.route(/workers\.dev|api\.groq\.com|fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
    await ctx.route(/example\.com/, (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><title>Programming class</title></head><body><h1>Lab 3</h1><p id="p" style="margin:140px 60px 0;font-size:18px">A store gives a ten percent discount when a customer buys more than five items. Compute the total price for a list of item prices.</p></body></html>' }));
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://example.com' });
    const isCassie = async (w) => /\/background\.js$/.test(w.url()) && await w.evaluate(() => typeof answerAny === 'function').catch(() => false);
    let sw = null;
    for (let i = 0; i < 80 && !sw; i++) {
      for (const w of ctx.serviceWorkers()) if (await isCassie(w)) { sw = w; break; }
      if (!sw) await new Promise((r) => setTimeout(r, 250));
    }
    expect(sw, 'the Cassie extension did not start');
    // a stand-in AI: good code, or broken code first (the check catches it, Cassie fixes it once), or always broken
    await sw.evaluate(() => {
      const GOOD = '```python\n# pip install requests\nclass SwiftOceanCart:\n    def __init__(self, prices):\n        self.prices = prices\n\n    def total(self):\n        cost = sum(self.prices)\n        if len(self.prices) > 5:\n            cost = cost * 0.9\n        return round(cost, 2)\n\n\nif __name__ == "__main__":\n    cart = SwiftOceanCart([10, 20, 5, 5, 5, 5])\n    print("Total:", cart.total())\n```\nPaste it into a new file in VS Code and run it. In Colab, paste it into a cell and press Run. It prints the total with the discount.';
      const BROKEN = '```python\ndef total(prices:\n    return sum(prices)\n```\nRun it.';
      globalThis.__asked = []; globalThis.__mode = 'good';
      globalThis.answerAny = async (input, keys, onDelta) => {
        const last = Array.isArray(input) ? input[input.length - 1].content : String(input);
        globalThis.__asked.push(last);
        const fix = /That code has a problem/.test(last);
        const out = __mode === 'always-broken' || (__mode === 'broken-first' && !fix) ? BROKEN : GOOD;
        if (onDelta) onDelta(out);
        return out;
      };
    });
    const asked = () => sw.evaluate(() => globalThis.__asked.slice());
    const page = await ctx.newPage();
    await page.goto('https://example.com/lab');
    await page.waitForFunction(() => document.getElementById('cassie-ext-host-92f1'), null, { timeout: 10000 });
    const root = 'document.getElementById("cassie-ext-host-92f1").shadowRoot';
    const q = (sel) => page.evaluate(([r, s]) => { const e = eval(r).querySelector(s); return e && !e.hidden && e.getClientRects().length ? e.textContent : null; }, [root, sel]);
    // a real click (copying needs a real one)
    const click = async (sel) => { const b = await page.evaluate(([r, s]) => { const e = eval(r).querySelector(s); const q2 = e.getBoundingClientRect(); return [q2.left + q2.width / 2, q2.top + q2.height / 2]; }, [root, sel]); await page.mouse.click(b[0], b[1]); };
    const select = async () => {
      await page.evaluate(() => window.getSelection().removeAllRanges());
      const b = await page.locator('#p').boundingBox();
      await page.mouse.move(b.x + 1, b.y + 4); await page.mouse.down();
      await page.mouse.move(b.x + b.width - 1, b.y + b.height - 4, { steps: 4 }); await page.mouse.up();
      await page.waitForFunction(([r]) => /What should I do with this/.test(eval(r).querySelector('.popover .body').textContent), [root], { timeout: 5000 });
    };
    // (an open answer stays until it's closed: close it first, as a student would)
    const closePop = () => page.evaluate(([r]) => { const x = eval(r).querySelector('.popover .header button'); if (x && !eval(r).querySelector('.popover').hidden) x.click(); }, [root]);
    const codeFor = async (level) => {
      await closePop();
      // (closing keeps Cassie away from highlights until Ctrl is tapped twice, as a student would)
      await page.keyboard.press('Control'); await page.keyboard.press('Control'); await page.waitForTimeout(150);
      await select();
      await click('.choice-btn[data-mode="code"]');
      await page.waitForFunction(([r]) => eval(r).querySelectorAll('.level-btn').length === 2, [root], { timeout: 5000 });
      const levels = await page.evaluate(([r]) => [...eval(r).querySelectorAll('.level-btn')].map((b) => b.textContent.trim() + (b.classList.contains('last') ? ' (last)' : '')), [root]);
      await click(`.level-btn[data-level="${level}"]`);
      await page.waitForFunction(([r]) => eval(r).querySelector('.code-box'), [root], { timeout: 10000 });
      return levels;
    };
    // 1. Code asks Simple or Complete first
    await sw.evaluate(() => chrome.storage.local.set({ cassieUid: 'student-one' }));
    let levels = await codeFor('simple');
    expect(levels.length === 2 && /Simple \(short and basic\)/.test(levels[0]) && /Complete \(longer, with classes and functions\)/.test(levels[1]), 'the two choices: ' + levels);
    let a = await asked();
    expect(/Simple: short and basic/.test(a.at(-1)) && /Language: Python/.test(a.at(-1)) && /main block/.test(a.at(-1)) && /No placeholders/.test(a.at(-1)), 'the simple, runnable code is asked for: ' + a.at(-1).slice(0, 300));
    expect(!/student-one/.test(a.at(-1)), 'the install id is never sent');
    const names1 = /theme "(\w+)"[\s\S]*word "(\w+)"/.exec(a.at(-1));
    expect(names1, 'a naming theme and word are given');
    // 2. the code box: Copy code puts only the code on the clipboard; Copy for Colab one cell with !pip
    expect(await q('.code-box .code-copy') === 'Copy code' && await q('.code-box .code-colab') === 'Copy for Colab', 'the code box has both copy buttons');
    await click('.code-box .code-copy');
    await page.waitForFunction(([r]) => eval(r).querySelector('.code-box .code-copy').textContent === 'Copied', [root], { timeout: 3000 });
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(/^# pip install requests\nclass SwiftOceanCart:/.test(copied) && /print\("Total:", cart\.total\(\)\)$/.test(copied) && !/```|Paste it|VS Code/.test(copied), 'only the code is copied: ' + JSON.stringify(copied.slice(0, 80)));
    await page.waitForFunction(([r]) => eval(r).querySelector('.code-box .code-copy').textContent === 'Copy code', [root], { timeout: 4000 });
    await click('.code-box .code-colab');
    await page.waitForFunction(([r]) => eval(r).querySelector('.code-box .code-colab').textContent === 'Copied', [root], { timeout: 3000 });
    const colab = await page.evaluate(() => navigator.clipboard.readText());
    expect(/^!pip install requests\nclass SwiftOceanCart:/.test(colab), 'Copy for Colab makes one cell (the pip line runs there): ' + JSON.stringify(colab.slice(0, 60)));
    const how = await page.evaluate(([r]) => [...eval(r).querySelectorAll('.popover .body > p')].map((p) => p.textContent).join(' '), [root]);
    expect((how.match(/[.!?](\s|$)/g) || []).length <= 3 && /VS Code/.test(how), 'at most 3 sentences on how to run it: ' + how);
    const visible = await page.evaluate(([r]) => eval(r).querySelector('.popover').innerText, [root]);
    expect(!/[–—]/.test(visible.replace(/print\([^)]*\)/g, '')), 'no dashes in what the student sees');
    // 3. the last choice is remembered (marked), and Complete asks for classes
    levels = await codeFor('complete');
    expect(/Simple.*\(last\)/.test(levels[0]) && !/\(last\)/.test(levels[1]), 'the last choice is marked: ' + levels);
    a = await asked();
    expect(/Complete: classes and functions/.test(a.at(-1)), 'Complete asks for classes and functions');
    expect(await sw.evaluate(() => chrome.storage.local.get('cassieCodeLevel').then((o) => o.cassieCodeLevel)) === 'complete', 'the choice is remembered');
    const again = /theme "(\w+)"[\s\S]*word "(\w+)"/.exec(a.at(-1));
    expect(again[1] === names1[1] && again[2] === names1[2], 'the same student keeps the same names');
    // 4. another student, the same situation: the same idea, other names
    await sw.evaluate(() => chrome.storage.local.set({ cassieUid: 'student-two' }));
    await codeFor('complete');
    a = await asked();
    const names2 = /theme "(\w+)"[\s\S]*word "(\w+)"/.exec(a.at(-1));
    expect(names2 && (names2[1] !== names1[1] || names2[2] !== names1[2]), `two students get different names: ${names1 && names1.slice(1)} and ${names2 && names2.slice(1)}`);
    // 5. broken code is caught by the quick check and Cassie fixes it once
    await sw.evaluate(() => { globalThis.__mode = 'broken-first'; });
    const n0 = (await asked()).length;
    await codeFor('simple');
    a = await asked();
    expect(a.length === n0 + 2 && /That code has a problem: the "\(" on line 1 is never closed/.test(a.at(-1)), 'the check found the problem and asked once for a fix: ' + a.slice(n0).map((x) => x.slice(0, 80)).join(' | '));
    expect(/class SwiftOceanCart/.test(await q('.code-box pre')) && !(await q('.code-note')), 'the fixed code shows, with no note');
    // still broken after the fix: shown with a plain note
    await sw.evaluate(() => { globalThis.__mode = 'always-broken'; });
    const n1 = (await asked()).length;
    await codeFor('simple');
    expect((await asked()).length === n1 + 2, 'only one fix is asked for');
    expect(/may need a small fix before it runs/.test(await q('.code-note') || ''), 'a plain note when it may still need a fix');
  } finally { await ctx.close(); }
});

test('extension: drop a PDF, words or a photo on Cassie’s Island on any page', async () => {
  const ext = path.join(ROOT, 'extension');
  const profile = fs.mkdtempSync(path.join(require('os').tmpdir(), 'cassie-ext-'));
  const ctx = await chromium.launchPersistentContext(profile, {
    headless: true, ...(fs.existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : { channel: 'chromium' }),
    args: ['--headless=new', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  try {
    const groqCalls = [];
    await ctx.route(/api\.groq\.com/, (route) => {
      if (route.request().url().endsWith('/models')) return route.fulfill({ json: { data: [{ id: 'openai/gpt-oss-120b' }] } });
      groqCalls.push(route.request().postData() || '');
      return route.fulfill({ json: { choices: [{ message: { role: 'assistant', content: 'Summary: water evaporates, condenses and falls as rain.' } }] } });
    });
    await ctx.route(/askcassie\.pages\.dev/, async (route) => {
      const u = new URL(route.request().url());
      return route.fulfill({ response: await route.fetch({ url: `http://localhost:${APP_PORT}${u.pathname}` }) });
    });
    await ctx.route(/workers\.dev|fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
    await ctx.route(/example\.com/, (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><title>Biology notes</title></head><body style="height:2000px"><h1>Biology notes</h1><p id="p">Cells divide by mitosis.</p></body></html>' }));
    await ctx.addInitScript((seed) => { if (!/askcassie/.test(location.host)) return; window.CASSIE_SERVER = ''; if (!localStorage.getItem('cassie.v2')) localStorage.setItem('cassie.v2', seed); }, JSON.stringify({ profile: PROFILE, seenVersion: APP_VERSION, lite: 'on', groqKey: 'gsk_test' }));

    // a real PDF, made by the Cassie app
    const maker = await ctx.newPage();
    await maker.goto('https://askcassie.pages.dev/app.html');
    const pdf = await maker.evaluate(async () => {
      const blob = await window.CassieExport.toPdf('# Water cycle\n\nEvaporation, condensation and precipitation move water around the Earth.', 'Water cycle');
      const buf = new Uint8Array(await blob.arrayBuffer());
      let s = ''; for (const x of buf) s += String.fromCharCode(x);
      return btoa(s);
    });
    await maker.close();

    const page = await ctx.newPage();
    await page.goto('https://example.com/bio');
    await page.waitForFunction(() => document.getElementById('cassie-ext-host-92f1'), null, { timeout: 10000 });
    const isle = page.locator('.cx-isle');
    // drag from the desktop: dragenter + dragover on the page → the Island drops in
    const dragIn = (p) => page.evaluate((x) => {
      const dt = new DataTransfer();
      if (x.text) dt.setData('text/plain', x.text);
      if (x.b64) { const bin = atob(x.b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); dt.items.add(new File([u], x.name, { type: x.type })); }
      window.__dt = dt;
      document.body.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }));
      document.body.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    }, p);
    const dropOnIsle = () => page.evaluate(() => {
      const el = document.getElementById('cassie-ext-host-92f1').shadowRoot.querySelector('.cx-isle');
      el.dispatchEvent(new DragEvent('dragover', { bubbles: true, composed: true, cancelable: true, dataTransfer: window.__dt }));
      return !el.dispatchEvent(new DragEvent('drop', { bubbles: true, composed: true, cancelable: true, dataTransfer: window.__dt }));
    });

    // 1. a PDF → "water.pdf is ready" → Summarize → the Cassie app reads it and answers
    await dragIn({ b64: pdf, name: 'water.pdf', type: 'application/pdf' });
    await page.waitForFunction(() => { const i = document.getElementById('cassie-ext-host-92f1').shadowRoot.querySelector('.cx-isle'); return i && !i.hidden && i.classList.contains('open'); }, null, { timeout: 3000 });
    expect(/Drop it here/.test(await isle.innerText()), 'the Island should say Drop it here: ' + await isle.innerText());
    if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/ext-isle-drop.png', clip: { x: 0, y: 0, width: 1280, height: 200 } });
    expect(await dropOnIsle(), 'Cassie should take the drop');
    await page.waitForFunction(() => /water\.pdf is ready/.test(document.getElementById('cassie-ext-host-92f1').shadowRoot.querySelector('.cx-isle').innerText), null, { timeout: 5000 });
    if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/ext-isle-ready.png', clip: { x: 0, y: 0, width: 1280, height: 240 } });
    const appOpened = ctx.waitForEvent('page', { timeout: 10000 });
    await page.locator('.cx-isle-chip', { hasText: 'Summarize' }).click();
    const app = await appOpened;
    // the tab the extension opens starts loading before the test can serve it: load it again (the file waits for this tab)
    if (!/askcassie/.test(app.url()) || !(await app.locator('#chat-log').count())) await app.goto('https://askcassie.pages.dev/app.html');
    try { await app.waitForSelector('#chat-log .bubble-assistant >> text=water evaporates', { timeout: 20000 }); } catch (e) { throw new Error('app url ' + app.url() + ' pages ' + ctx.pages().map((x) => x.url()).join(',') + ' app chat: ' + (await app.locator('#chat-log').innerText({ timeout: 2000 }).catch(() => '-')).slice(0, 600) + ' | url ' + app.url() + ' | calls ' + groqCalls.length + ' | attach ' + await app.locator('#attach-preview').innerText().catch(() => '?')); }
    expect(groqCalls.some((b) => /condensation/i.test(b) && /Summarize this file/.test(b)), 'the app should read the dropped PDF and summarize it');
    await page.bringToFront();
    await page.waitForFunction(() => document.getElementById('cassie-ext-host-92f1').shadowRoot.querySelector('.cx-isle').hidden, null, { timeout: 5000 });

    // 2. words dragged from another app → Explain / Answer, like a highlight
    await dragIn({ text: 'What is 7 x 8?' });
    expect(await dropOnIsle(), 'Cassie should take dropped words');
    await page.waitForFunction(() => /What should I do with this/.test(document.getElementById('cassie-ext-host-92f1').shadowRoot.querySelector('.popover').innerText), null, { timeout: 3000 });

    // 3. a photo → read on Cassie's board
    const red = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = c.height = 40; const g = c.getContext('2d'); g.fillStyle = 'red'; g.fillRect(0, 0, 40, 40); return c.toDataURL('image/png').split(',')[1]; });
    await dragIn({ b64: red, name: 'cell.png', type: 'image/png' });
    expect(await dropOnIsle(), 'Cassie should take a dropped photo');
    await page.waitForFunction(() => document.getElementById('cassie-ext-host-92f1').shadowRoot.querySelector('.csk-wrap'), null, { timeout: 5000 });

    // 4. dragging the page's own words does not bring the Island; a drop elsewhere is the page's
    await page.waitForFunction(() => document.getElementById('cassie-ext-host-92f1').shadowRoot.querySelector('.cx-isle').hidden, null, { timeout: 3000 });
    await page.evaluate(() => { const p = document.getElementById('p'); p.dispatchEvent(new DragEvent('dragstart', { bubbles: true })); const dt = new DataTransfer(); dt.setData('text/plain', 'Cells'); document.body.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt })); });
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => document.getElementById('cassie-ext-host-92f1').shadowRoot.querySelector('.cx-isle').hidden), 'a drag inside the page should not open the Island');
    await page.evaluate(() => document.getElementById('p').dispatchEvent(new DragEvent('dragend', { bubbles: true })));
    const pageGot = await page.evaluate(() => {
      let got = false;
      document.addEventListener('drop', (e) => { got = !e.defaultPrevented; }, { once: true });
      const dt = new DataTransfer(); dt.items.add(new File(['x'], 'upload.pdf', { type: 'application/pdf' }));
      document.body.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }));
      document.body.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
      return got;
    });
    expect(pageGot, 'a file dropped on the page (not on Cassie) should be left for the page');
    await page.waitForFunction(() => document.getElementById('cassie-ext-host-92f1').shadowRoot.querySelector('.cx-isle').hidden, null, { timeout: 3000 });
  } finally { await ctx.close(); fs.rmSync(profile, { recursive: true, force: true }); }
});




/* ---------- run ---------- */
(async () => {
  const { startFakeServer } = await import('./fake-server.mjs');
  const app = staticServer();
  const server = await startFakeServer(SERVER_PORT);
  // a fresh browser for every test: the 3D tests leave the graphics side busy, and that made later tests flaky
  const launch = async () => {
    const browser = await chromium.launch(fs.existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : {});
    const newContext = browser.newContext.bind(browser);
    browser.newContext = async (...a) => watchCsp(await newContext(...a));
    return browser;
  };
  const only = process.argv[2];
  // SUITE=fast (before every deploy): every test but the slowest; ALSO="a|b" adds slow ones by name
  // (the ones for what just changed). The full suite (no SUITE) runs every test: nightly, in CI.
  const fast = process.env.SUITE === 'fast', also = process.env.ALSO ? process.env.ALSO.split('|') : [];
  // the test browser itself giving out (this machine has no graphics chip and little memory) isn't the
  // app's fault: that test runs once more in a new browser, and fails only if it gives out again
  const browserGaveOut = (e) => /Target page, context or browser has been closed|browser has disconnected|Browser closed|Target crashed|Page crashed/i.test(String(e && e.message || e));
  let failed = 0, skipped = 0;
  for (const t of tests) {
    if (only && !t.name.includes(only)) continue;
    if (fast && t.slow && !only && !also.some((a) => t.name.includes(a))) { skipped++; continue; }
    const t0 = Date.now(); // (TIMES=1 prints how long each test takes)
    for (let attempt = 1; ; attempt++) {
      const browser = await launch();
      try {
        cspViolations.length = 0;
        await t.fn(browser);
        if (cspViolations.length) throw new Error('blocked by the security policy: ' + [...new Set(cspViolations)].join(' | '));
        console.log('PASS', t.name + (attempt > 1 ? ' (after the test browser gave out once)' : '') + (process.env.TIMES ? ` [${Math.round((Date.now() - t0) / 1000)}s]` : ''));
        break;
      }
      catch (e) {
        if (attempt === 1 && browserGaveOut(e)) { console.log('RETRY', t.name, '(the test browser gave out; once more in a new one)'); continue; }
        failed += 1; console.log('FAIL', t.name, '\n     ', (process.env.VERBOSE && e && e.stack ? e.stack : (e && e.message || e)).toString().split('\n').slice(0, process.env.VERBOSE ? 30 : 1).join('\n'));
        break;
      }
      finally { await browser.close().catch(() => {}); }
    }
  }
  if (skipped) console.log(`\n(the fast suite: ${skipped} slow tests skipped; the full suite runs them)`);
  await server.close(); app.close();
  console.log(failed ? `\n${failed} failed` : '\nAll passed');
  process.exit(failed ? 1 : 0);
})();

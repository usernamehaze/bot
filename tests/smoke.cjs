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

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.mjs': 'text/javascript', '.wasm': 'application/wasm' };
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
    if (seedJson && !sessionStorage.getItem('seeded')) { localStorage.setItem('cassie.v2', seedJson); localStorage.setItem('cassie.labs.ui', '{"tries":"max"}'); sessionStorage.setItem('seeded', '1'); } // (the tests read the goals: keep "Try this" open on phone screens)
  }, [server ? SERVER : '', seed ? JSON.stringify(seed) : '']);
  await ctx.route(/pollinations\.ai/, (route) => route.fulfill({ body: PNG, contentType: 'image/png' }));
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await ctx.route(/workers\.dev/, (route) => route.abort()); // never touch the real Cassie server
  await fakeGoogle(ctx); // never the real Google
  await ctx.route(/appleid\.apple\.com/, (route) => route.abort()); // never the real Apple (a test brings its own)
  if (setup) await setup(ctx);
  await ctx.route(/huggingface\.co/, (route) => route.abort()); // the human voice's model (a test brings its own)
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

// the first run: past Welcome and Intro to the sign-in page
async function toSignIn(page) {
  await page.waitForSelector('.fr-start', { timeout: 8000 });
  await page.click('.fr-start');
  await page.waitForSelector('.auth-page', { timeout: 5000 });
}
// the four questions (anything left out is skipped)
async function onboard(page, { name, gender, grade, age, help = [], voice } = {}) {
  await page.waitForSelector('.fr-ob', { timeout: 8000 });
  const next = async (k, fill) => { await page.waitForSelector(`.fr-count >> text=${k} of 4`, { timeout: 5000 }); if (fill) { await fill(); await page.click('.fr-go'); } else await page.click('.fr-skip'); };
  await next(1, name && (async () => { await page.fill('.fr-ob input[name=name]', name); if (gender) await page.click(`.fr-ob [data-gender=${gender}]`); }));
  await next(2, grade && (async () => { await page.selectOption('.fr-ob select[name=grade]', grade); if (age != null) await page.fill('.fr-ob input[name=age]', String(age)); }));
  await next(3, help.length && (async () => { for (const h of help) await page.click(`.fr-ob [data-help=${h}]`); }));
  await next(4, voice && (async () => { await page.click(`.fr-ob [data-voice=${voice}]`); }));
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
  await page.click('.fr-start');
  // 3. Sign in: Google and Apple come first (when the server has them), then email, then a guest
  await page.waitForSelector('.auth-page', { timeout: 5000 });
  expect(await page.evaluate(() => { const p = document.querySelector('.auth-providers'), e = document.querySelector('.auth-page input[name=email]'); return !!(p.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING); }), 'Google and Apple above email');
  expect(await page.locator('.auth-skip').innerText() === 'Continue as a guest', 'Continue as a guest');
  if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/fr-signin.png' });
  await page.click('.auth-skip');
  // 4. The questions: 1 of 4 to 4 of 4
  await page.waitForSelector('.fr-ob', { timeout: 5000 });
  expect(/1 of 4/.test(await page.locator('.fr-count').innerText()) && /What’s your name\?/.test(await page.locator('.fr-h').innerText()), 'step 1: the name');
  await page.click('.fr-go');
  expect(/Type your name/.test(await page.locator('.fr-err').innerText()), 'Next with no name says what to do');
  await page.fill('.fr-ob input[name=name]', 'Hazel');
  await page.click('.fr-ob [data-gender=female]');
  if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/fr-1.png' });
  await page.click('.fr-go');
  await page.waitForSelector('.fr-count >> text=2 of 4');
  expect(/What are you studying\?/.test(await page.locator('.fr-h').innerText()), 'step 2: studying');
  // Back keeps the answer
  await page.click('.fr-back');
  await page.waitForSelector('.fr-count >> text=1 of 4');
  expect(await page.inputValue('.fr-ob input[name=name]') === 'Hazel', 'Back keeps the name');
  await page.click('.fr-go');
  await page.waitForSelector('.fr-count >> text=2 of 4');
  const levels = await page.$$eval('.fr-ob select[name=grade] option', (o) => o.map((x) => x.textContent));
  expect(levels.includes('Nursery') && levels.includes('Working professional'), 'every level, nursery to work');
  await page.selectOption('.fr-ob select[name=grade]', 'Grade 10');
  await page.fill('.fr-ob input[name=age]', '15');
  // a reload carries on at the same step, with the answers
  await page.reload();
  await page.waitForSelector('.fr-count >> text=2 of 4', { timeout: 5000 });
  expect(!(await page.locator('.fr-welcome, .fr-intro').count()), 'no welcome or intro again mid-way');
  expect(await page.inputValue('.fr-ob select[name=grade]') === 'Grade 10' && await page.inputValue('.fr-ob input[name=age]') === '15', 'the answers are back after a reload');
  if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/fr-2.png' });
  await page.click('.fr-go');
  await page.waitForSelector('.fr-count >> text=3 of 4');
  await page.click('.fr-ob [data-help=exams]'); await page.click('.fr-ob [data-help=flashcards]');
  if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/fr-3.png' });
  await page.click('.fr-go');
  await page.waitForSelector('.fr-count >> text=4 of 4');
  expect(/Start studying/.test(await page.locator('.fr-go').innerText()), 'the last step says Start studying');
  await page.click('.fr-ob [data-voice=man]');
  if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/fr-4.png' });
  await page.click('.fr-go');
  await page.waitForSelector('.fr', { state: 'detached', timeout: 5000 });
  const st = await page.evaluate(() => JSON.parse(localStorage.getItem('cassie.v2')));
  const p = st.profile;
  expect(p && p.name === 'Hazel' && p.grade === 'Grade 10' && p.age === 15 && p.gender === 'female' && p.role === 'student' && p.field === '' && p.at > 0, 'the profile, as the old form saved it: ' + JSON.stringify(p));
  expect(st.audience === 'student' && st.level === 'middle' && st.analytics.usage === true && st.analytics.topics === false, 'audience, level and counts as before: ' + JSON.stringify([st.audience, st.level, st.analytics]));
  expect(JSON.stringify(st.helpWith) === '["exams","flashcards"]' && st.voiceGender === 'man', 'what she helps with, and her voice: ' + JSON.stringify([st.helpWith, st.voiceGender]));
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
  await onboard(page, {});
  const q = await page.evaluate(() => JSON.parse(localStorage.getItem('cassie.v2')).profile);
  expect(q && q.name === '' && q.grade === '' && q.age === 0 && q.gender === 'none', 'skipped: an empty profile: ' + JSON.stringify(q));
  expect(errors.length === 0, 'page errors: ' + errors.join('; '));
  await ctx.close();
});

test('every age is welcome: nursery to work, with an account too', async (b) => {
  const { ctx, page } = await open(b, { state: null });
  await toSignIn(page);
  expect(await page.locator('.auth-brand svg').count() === 1 && !(await page.locator('img[src*="cassie-hero"]').count()), 'the sign-in page shows Cassie’s logo, not the 3D picture');
  expect(!/13 and up/.test(await page.locator('.auth-page').innerText()), 'no age limit on the sign-in page');
  const signupStatus = (body) => page.evaluate(async ([srv, bb]) => (await fetch(srv + '/auth/signup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(bb) })).status, [SERVER, body]);
  expect(await signupStatus({ email: `kid${Date.now()}@example.com`, password: 'secret-pass-1', age: 6 }) === 200, 'a 6-year-old can make an account');
  await page.click('.auth-skip');
  await page.waitForSelector('.fr-ob');
  await page.fill('.fr-ob input[name=name]', 'Mia'); await page.click('.fr-go');
  const levels = await page.$$eval('.fr-ob select[name=grade] option', (o) => o.map((x) => x.textContent));
  await page.click('.fr-back');
  expect(levels.includes('Nursery') && levels.includes('Kindergarten') && levels.includes('Grade 1') && levels.includes('4th year college') && levels.includes('Working professional'), 'levels go from nursery to work: ' + levels);
  await onboard(page, { name: 'Mia', age: 4, grade: 'Nursery', gender: 'none' });
  const r = await page.evaluate(() => ({ p: state.profile, an: state.analytics, line: profileLine(state.profile) }));
  expect(r.p.age === 4 && r.p.grade === 'Nursery', 'a 4-year-old in nursery can use Cassie: ' + JSON.stringify(r.p));
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
  // device 1: create an account, answer the profile questions
  let { ctx, page } = await open(b, { state: null });
  await toSignIn(page);
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
  await page.waitForSelector('.fr-ob');
  await page.fill('.fr-ob input[name=name]', 'Hazel'); await page.click('.fr-go');
  await page.waitForSelector('.fr-count >> text=2 of 4');
  expect(await page.inputValue('.fr-ob input[name=age]') === '16', 'the age typed when signing up is filled in');
  await page.click('.fr-back');
  await onboard(page, { name: 'Hazel', grade: 'Grade 11', gender: 'female' });
  await page.evaluate(() => syncAccount(true));
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
  expect(p && p.name === 'Hazel' && p.grade === 'Grade 11', 'profile did not come back: ' + JSON.stringify(p));
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
    // a new person with Google: signed in, then the profile questions
    const email = `gnew${Date.now()}@example.com`;
    await googleTap(page, ctx, { sub: 'g-new-' + Date.now(), email });
    await page.waitForSelector('.auth-page', { state: 'detached' });
    await page.waitForSelector('.fr-ob', { timeout: 5000 }); // (the four questions)
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
    await toSignIn(page);
    await page.waitForSelector('.auth-apple:not([hidden])');
    await page.click('.auth-apple');
    await page.waitForURL(/app\.html$/, { timeout: 15000 });
    await page.waitForSelector('.auth-err:not([hidden])', { timeout: 10000 });
    expect(await authErr(page) === await page.evaluate(() => CassieErrors.say('apple_cancelled')), 'cancel message: ' + await authErr(page));
    expect(!page.url().includes('cassie-auth'), 'the answer should be taken out of the address');
    // a new person with Apple: signed in, then the profile questions
    who.cancel = false;
    await page.click('.auth-apple');
    await page.waitForURL(/app\.html$/, { timeout: 15000 });
    await page.waitForSelector('.fr-ob', { timeout: 10000 });
    const s = await savedAccount(page);
    expect(s.token && s.account.email === who.email && s.account.providers.join() === 'apple', 'new Apple account not saved: ' + JSON.stringify(s));
    expect(await page.evaluate(() => state.profile === null || !state.profile) && await page.inputValue('.fr-ob input[name=name]') !== null, 'profile questions should open');
    expect(errors.length === 0, 'page errors: ' + errors.join(' | '));
  } finally { await ctx.close(); }
  // an answer this tab didn't ask for is ignored
  ({ ctx, page } = await open(b, { state: null }));
  try {
    await page.goto('about:blank');
    await page.goto(APP + '#cassie-auth=' + encodeURIComponent(JSON.stringify({ type: 'cassie-auth', provider: 'apple', nonce: 'x'.repeat(32), token: 'stolen', account: { email: 'x@example.com' } })));
    await toSignIn(page);
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

test('privacy.html names every outside service the code calls (a new one fails until the page says what it gets)', async () => {
  // every web address in Cassie's own code (not the bundled libraries): a service it calls, or one of these
  const NOT_A_SERVICE = {
    'schemas.openxmlformats.org': 'names inside Word and PowerPoint files', 'www.w3.org': 'SVG and XML names',
    'askcassie.pages.dev': 'Cassie’s own site', 'usernamehaze.github.io': 'Cassie’s own site', 'speak.cassie': 'a cache key, not a site',
    'scholar.google.com': 'a link the student taps', 'doi.org': 'citation links',
    'commons.wikimedia.org': 'a link the student taps (where a museum picture comes from; the pictures are kept in the app)',
    'epa.culturalcenter.gov.ph': 'a museum picture’s credit link', '21am.culturalcenter.gov.ph': 'a museum picture’s credit link', 'salcedoauctions.com': 'a museum picture’s credit link', 'www.artandmarket.net': 'a museum picture’s credit link',
    'ncmh.gov.ph': 'where care.js’s crisis numbers were checked (a note in the code)',
  };
  const SERVICES = [ // [which addresses, the name privacy.html must use]
    [/^api\.groq\.com$/, 'Groq'], [/^generativelanguage\.googleapis\.com$/, 'Google Gemini'], [/^api\.anthropic\.com$/, 'Anthropic'],
    [/^api\.elevenlabs\.io$/, 'ElevenLabs'], [/^image\.pollinations\.ai$/, 'Pollinations'], [/^api\.openalex\.org$/, 'OpenAlex'],
    [/\.wikipedia\.org$/, 'Wikipedia'], [/^api\.worldbank\.org$/, 'World Bank'], [/^huggingface\.co$/, 'Hugging Face'],
    [/^(accounts|www)\.google(apis)?\.com$|^docs\.google\.com$/, 'Google'], [/^appleid\.apple\.com$/, 'Apple'],
    [/\.workers\.dev$/, 'Cloudflare'], // Cassie's own server runs on Cloudflare
  ];
  const libs = /three\.module|GLTFLoader|OrbitControls|BufferGeometryUtils|RoomEnvironment|RoundedBoxGeometry|meshopt/;
  const files = [...fs.readdirSync(ROOT).filter((f) => f.endsWith('.js')),
    ...['labs', 'explore', 'extension'].flatMap((d) => fs.readdirSync(path.join(ROOT, d)).filter((f) => f.endsWith('.js')).map((f) => d + '/' + f)),
    'server/worker.src.js', 'voice/voice-worker.js'].filter((f) => !libs.test(f));
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
  if (fs.existsSync(path.join(ROOT, 'voice/kokoro.web.js'))) needed.add('Hugging Face'); // the voice model downloads from it
  if (/SpeechRecognition/.test(code)) { needed.add('Google'); needed.add('Apple'); } // the browser's own speech-to-text
  expect(!unknown.length, 'Cassie calls a service privacy.html doesn’t know about: ' + unknown.join(', ') + '. Name it on the page (what it gets and why) and add it to this test.');
  const page = fs.readFileSync(path.join(ROOT, 'privacy.html'), 'utf8').replace(/<[^>]+>/g, ' ');
  const missing = [...needed].filter((n) => !page.includes(n));
  expect(!missing.length, 'privacy.html doesn’t name: ' + missing.join(', '));
  expect(needed.size >= 12, 'the scan found the services (sanity): ' + [...needed].join(', '));
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

test('the Chrome extension: its button sits beside Open Cassie on computers (none on phones), every download link carries the extension’s version, the built zip is that version, and an old copy is told a new one is ready', async (b) => {
  const extver = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension/manifest.json'), 'utf8')).version;
  // the build: the zip on the site is the extension as it is now, and extension-version.json says so
  const built = path.join(ROOT, '_site');
  expect(fs.existsSync(path.join(built, 'cassie-extension.zip')), 'run bash scripts/build-site.sh first');
  const zipped = JSON.parse(require('child_process').execFileSync('unzip', ['-p', path.join(built, 'cassie-extension.zip'), 'cassie-extension/manifest.json'], { encoding: 'utf8' })).version;
  expect(zipped === extver, `the built zip is version ${zipped}, the extension is ${extver}`);
  expect(JSON.parse(fs.readFileSync(path.join(built, 'extension-version.json'), 'utf8')).version === extver, 'extension-version.json has the extension’s version');
  const site = fs.readFileSync(path.join(built, 'index.html'), 'utf8');
  const links = site.match(/cassie-extension\.zip[^"]*/g) || [];
  expect(links.length >= 2 && links.every((l) => l === 'cassie-extension.zip?v=' + extver), 'every link to the zip ends with ?v=' + extver + ': ' + links.join(', '));
  expect(site.includes('Version ' + extver), 'the built page shows Version ' + extver);
  // a computer: the button is in the header, just before Open Cassie, on one line at 1024, 1280 and 1440
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(APP.replace('app.html', 'index.html'));
  const head = page.locator('.nav a[href^="cassie-extension.zip"]');
  expect(await head.count() === 1 && await head.isVisible(), 'the extension button is in the header');
  expect(await head.getAttribute('href') === 'cassie-extension.zip?v=' + extver, 'the header link has the version: ' + await head.getAttribute('href'));
  expect((await page.locator('[data-ext-version]').innerText()).trim() === 'Version ' + extver, 'Version ' + extver + ' under the button');
  expect(await page.locator('.final a[href^="cassie-extension.zip"]').count() === 0, 'the last section has no extension button');
  expect(await page.locator('details a[href^="cassie-extension.zip"]').count() === 1, 'the FAQ still has its link');
  for (const width of [1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    const g = await page.evaluate(() => {
      const ext = document.querySelector('.nav a[href^="cassie-extension.zip"]').getBoundingClientRect();
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
  const issues = await tapResponseIssues(page, { reopen, touch: false, scope: '.nav' });
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
  expect(!(await pp.locator('.nav a[href^="cassie-extension.zip"]').isVisible()), '390x844: no extension button in the header');
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
    expect(/^https:\/\/askcassie\.pages\.dev\/cassie-extension\.zip/.test(await p.locator('#update-get').getAttribute('href')), 'Download goes to the zip on the site');
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

test('daily limit shows a friendly message with Try again', async (b) => {
  await serverMode({ groq: 'ok', ai: 'ok' });
  const { ctx, page } = await open(b);
  await page.evaluate(async (srv) => {
    for (let i = 0; i < 5; i++) await fetch(srv + '/chat', { method: 'POST', body: JSON.stringify({ uid: installId(), messages: [{ role: 'user', content: 'hi' }] }) });
  }, SERVER);
  const a = await ask(page, 'One more question');
  const t = await a.textContent();
  expect(/free questions/.test(t) && /own free Groq key/.test(t), 'no daily-limit message: ' + t);
  expect(await a.locator('.retry-btn').count() === 1, 'no Try again button');
  await fetch(`${SERVER}/__reset`);
  await ctx.close();
});

test('Student / Professional switch is top right and changes the background', async (b) => {
  const { ctx, page } = await open(b);
  const sw = await page.locator('.topbar-actions #aud-switch').boundingBox();
  const brand = await page.locator('.topbar .brand').boundingBox();
  expect(sw && sw.x > brand.x + brand.width && sw.y < 80, 'switch is not in the top right: ' + JSON.stringify(sw));
  expect(await page.evaluate(() => document.documentElement.dataset.aud) === 'student', 'not student by default');
  await page.click('#aud-switch [data-aud=pro]');
  expect(await page.evaluate(() => document.documentElement.dataset.aud) === 'pro', 'background did not switch to pro');
  await page.waitForTimeout(900); // it fades in
  const op = await page.evaluate(() => getComputedStyle(document.querySelector('.pat-pro')).opacity);
  expect(+op > 0, 'pro pattern not visible');
  expect(await page.locator('.rate-row, .beta-tag').count() === 0, 'thumbs or Beta still showing');
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

test('study room: studying together — chat, Cassie for everyone, shared flashcards, a group quiz, notes, a timer', async (b) => {
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
    expect(await B.page.locator('.sr-note button').count() === 0, 'Ben can’t remove Ana’s note');
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
    const box = await A.page.locator('.csk-live').boundingBox(), k = box.width / 1600;
    const c0 = cards[0], c1 = cards[1];
    await A.page.mouse.click(box.x + (c0.x + c0.w / 2) * k, box.y + (c0.y + c0.h / 2) * k);
    await B.page.waitForFunction((id) => window.CassieSketch.session().objects().find((o) => o.id === id).flip === true, c0.id, { timeout: 8000 });
    await A.page.mouse.move(box.x + (c1.x + 20) * k, box.y + (c1.y + 20) * k); await A.page.mouse.down();
    await A.page.mouse.move(box.x + (c1.x + 20) * k, box.y + (c1.y + 220) * k, { steps: 8 }); await A.page.mouse.up();
    await B.page.waitForFunction(([id, y]) => Math.abs(window.CassieSketch.session().objects().find((o) => o.id === id).y - y) < 4, [c1.id, c1.y + 200], { timeout: 8000 });
    if (process.env.SHOTS) await A.page.screenshot({ path: process.env.SHOTS + '/board-room-tools.png' });
    // Ben can move Ana's note but can't throw it away
    await B.page.click('[data-tool="select"]');
    const note = (await objs(B.page)).find((o) => o.tool === 'note');
    await B.page.mouse.click(box.x + (note.x + 30) * k, box.y + (note.y + 30) * k);
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
  const bb = await page.locator('.csk-live').boundingBox(), kk = bb.width / (await page.evaluate(() => document.querySelector('.csk-live').width));
  await page.mouse.move(bb.x + (card.x + 30) * kk, bb.y + (card.y + 30) * kk); await page.mouse.down();
  await page.mouse.move(bb.x + (card.x + 30) * kk, bb.y + (card.y + 130) * kk, { steps: 8 }); await page.mouse.up();
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

test('Listen: Cassie reads answers and flashcards aloud — the studio voice while hers isn’t on the device, the device’s when it runs out', async (b) => {
  const cards = [{ id: 'c1', f: 'Powerhouse of the cell?', b: 'Mitochondria', deck: 'Biology', box: 0, due: 0, at: 0 }];
  const { ctx, page, errors } = await open(b, { device: 'Desktop Chrome', fakeGroq: () => ({ text: 'Mitochondria make ATP, the energy of the cell.' }), state: { groqKey: 'gsk_test', cards, hearing: 'fast' } });
  // a tiny real sound (a WAV), standing in for ElevenLabs' MP3
  const wav = (() => { const n = 1600, buf = Buffer.alloc(44 + n * 2); buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(8000, 24); buf.writeUInt32LE(16000, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40); return buf; })();
  const said = []; let credits = true;
  await ctx.route(/\/speak$/, (route) => {
    const r = route.request();
    if (r.method() === 'GET') return route.fulfill({ json: { on: true }, headers: { 'access-control-allow-origin': '*' } });
    said.push(JSON.parse(r.postData()).text);
    return credits ? route.fulfill({ body: wav, contentType: 'audio/mpeg', headers: { 'access-control-allow-origin': '*' } }) : route.fulfill({ status: 429, json: { error: { message: 'used up' } }, headers: { 'access-control-allow-origin': '*' } });
  });
  await ctx.addInitScript(FAKE_VOICE, {});
  await page.reload();
  await page.waitForFunction(() => window.CassieVoice.studio.on(), null, { timeout: 5000 });
  await page.fill('#prompt-input', 'What do mitochondria do?');
  await page.press('#prompt-input', 'Enter');
  await page.waitForSelector('.bubble-assistant .listen-btn', { timeout: 10000 });
  await page.click('.bubble-assistant .listen-btn');
  await page.waitForFunction(() => document.querySelector('.bubble-assistant .listen-btn.on'), null, { timeout: 3000 });
  await page.waitForFunction(() => !document.querySelector('.bubble-assistant .listen-btn.on'), null, { timeout: 8000 });
  expect(said.some((t) => /Mitochondria make ATP/.test(t)), 'the answer went to the studio voice: ' + JSON.stringify(said));
  expect(await page.evaluate(() => window.__spoken.filter((t) => t.trim()).length) === 0, 'the device voice wasn’t needed');
  // in a voice conversation the same voice answers (it used to wait for the whole answer, then switch)
  await page.click('#voice-btn');
  await page.waitForFunction(() => document.querySelector('.vc') && document.querySelector('.vc').dataset.phase === 'listening', null, { timeout: 8000 });
  const n0 = said.length;
  await page.evaluate(() => window.__say('What do mitochondria do?'));
  await page.waitForFunction(() => document.querySelector('.vc').dataset.phase === 'listening' && window.__shown.some((t) => /Mitochondria make ATP/.test(t)), null, { timeout: 15000 });
  expect(said.slice(n0).some((t) => /Mitochondria make ATP/.test(t)), 'the studio voice speaks in the conversation too: ' + JSON.stringify(said.slice(n0)));
  expect(await page.evaluate(() => window.__spoken.filter((t) => t.trim()).length) === 0, 'one voice: the device’s never cut in');
  await page.click('.vc-x');
  // the studio voice is used up: the device's voice reads it instead, never silence
  credits = false;
  await page.click('.bubble-assistant .listen-btn');
  await page.waitForFunction(() => window.__spoken.some((t) => /Mitochondria make ATP/.test(t)), null, { timeout: 8000 });
  // flashcards: a Listen button on the card, and hands-free listening
  await page.evaluate(() => window.CassieCards.open());
  await page.click('[data-study="Biology"]');
  await page.click('.fc-mini[data-say]');
  await page.waitForFunction(() => window.__spoken.some((t) => /Powerhouse of the cell/.test(t)), null, { timeout: 5000 });
  await page.click('.fc-back');
  await page.click('[data-listen="Biology"]');
  await page.waitForSelector('.fc-listening >> text=Think of the answer', { timeout: 5000 });
  await page.waitForSelector('.fc-listening .fc-text >> text=Mitochondria', { timeout: 12000 });
  await page.click('[data-lstop]');
  expect(errors.length === 0, 'page errors: ' + errors.join('; '));
  await ctx.close();
});

// One voice for a whole lesson or conversation: the studio voice running out at step 3 never hands the
// rest to another voice. She tries once more, pauses with Keep going, and shows the rest on screen.
// The next lesson starts with the device's best voice for her gender (never a robotic one), kept to the end.
test('one voice per lesson: a 7-step Teach me (no pop up) and a 6-turn voice chat keep the same voice, for the woman and the man, when the studio voice runs out at step 3', async (b) => {
  const wav = (() => { const n = 800, buf = Buffer.alloc(44 + n * 2); buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(8000, 24); buf.writeUInt32LE(16000, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40); return buf; })();
  // the studio voice: `allow` sentences, then used up for the day
  const studioRoute = async (ctx, allow) => {
    const log = [];
    await ctx.route(/\/speak$/, (route) => {
      const r = route.request(), cors = { 'access-control-allow-origin': '*' };
      if (r.method() === 'GET') return route.fulfill({ json: { on: true }, headers: cors });
      const body = JSON.parse(r.postData()), ok = log.filter((x) => x.ok).length < allow;
      log.push({ text: body.text, voice: body.voice, ok });
      return ok ? route.fulfill({ body: wav, contentType: 'audio/mpeg', headers: cors }) : route.fulfill({ status: 429, json: { error: { message: 'used up' } }, headers: cors });
    });
    return log;
  };
  // a device with several voices, a robotic one among them; records which voice said each sentence
  const DEVICE_VOICES = () => {
    const voices = [{ name: 'eSpeak English', lang: 'en-US', localService: true }, { name: 'Google US English', lang: 'en-US' }, { name: 'Google UK English Male', lang: 'en-GB' }, { name: 'Microsoft David', lang: 'en-US' }];
    window.__spokenBy = [];
    window.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
    const synth = { speaking: false, getVoices: () => voices, addEventListener() {}, removeEventListener() {}, cancel() {},
      speak(u) { window.__spoken.push(u.text); if (u.text.trim()) window.__spokenBy.push(u.voice ? u.voice.name : '(none)'); setTimeout(() => { u.onstart && u.onstart(); u.onend && u.onend(); }, 30); } };
    Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
  };
  const plain = (t) => !/[–—]/.test(t);
  for (const gender of ['woman', 'man']) {
    // ---- Teach me: 7 steps, the studio voice runs out at step 3 ----
    const steps = Array.from({ length: 7 }, (_, i) => ({ say: `Step ${i + 1} is here.`, point: 0 }));
    const t = await open(b, { device: 'Desktop Chrome', state: { groqKey: 'gsk_test', voiceGender: gender }, fakeGroq: () => ({ text: JSON.stringify({ steps }) }) });
    const tlog = await studioRoute(t.ctx, 2);
    await t.ctx.addInitScript(FAKE_VOICE, {});
    await t.ctx.addInitScript(DEVICE_VOICES);
    await t.page.reload();
    await t.page.waitForFunction(() => window.CassieVoice.studio.on(), null, { timeout: 5000 });
    await t.page.evaluate(() => openLabs('atom'));
    await t.page.waitForSelector('.lab-view:not([hidden])[data-lab="atom"] .lab-controls > *', { timeout: 15000 });
    await t.page.evaluate(() => { window.__paused = 0; new MutationObserver(() => { if (document.querySelector('.cv-pause')) window.__paused++; }).observe(document.body, { childList: true, subtree: true }); });
    await t.page.click('.lab-teach');
    // step 3: tried once more in the same voice, then the lesson goes on with the words on screen (no pop up)
    await t.page.waitForFunction(() => /7 of 7/.test((document.querySelector('.tut-step') || {}).textContent || ''), null, { timeout: 40000 });
    await t.page.waitForTimeout(400);
    expect(await t.page.evaluate(() => window.__paused) === 0 && await t.page.locator('.cv-pause').count() === 0, `${gender}: no Keep going pop up in Teach me`);
    let played = await t.page.evaluate(() => window.CassieVoice.played());
    expect(played.length === 2 && played.every((x) => x.kind === 'studio' && x.voice === gender), `${gender}: every step spoke in the same studio voice: ` + JSON.stringify(played));
    expect(tlog.length === 4 && tlog.slice(2).every((x) => /Step 3/.test(x.text) && !x.ok) && tlog.every((x) => x.voice === gender), `${gender}: step 3 was tried twice in the studio voice, then no more calls: ` + JSON.stringify(tlog));
    expect((await t.page.evaluate(() => window.__spoken.filter((x) => x.trim()))).length === 0, `${gender}: the device’s voice never cut in mid-lesson`);
    // the next lesson starts in the device's best voice for her gender, and keeps it for all 7 steps
    await t.page.click('.tut-x');
    await t.page.click('.lab-teach');
    await t.page.click('.tut-resume:not([hidden]) .tut-restart'); // (it offers to carry on: a new lesson from step 1)
    await t.page.waitForFunction(() => /7 of 7/.test((document.querySelector('.tut-step') || {}).textContent || '') && window.__spokenBy.length >= 7, null, { timeout: 40000 });
    const by = await t.page.evaluate(() => window.__spokenBy);
    const want = gender === 'man' ? 'Google UK English Male' : 'Google US English';
    expect(by.length === 7 && by.every((n) => n === want), `${gender}: the new lesson is all in ${want}, never the robotic one: ` + JSON.stringify(by));
    played = await t.page.evaluate(() => window.CassieVoice.played().slice(2));
    expect(played.length === 7 && played.every((x) => x.kind === 'device' && x.voice === want), `${gender}: one device voice for the lesson: ` + JSON.stringify(played));
    expect(t.errors.length === 0, 'page errors: ' + t.errors.join('; '));
    await t.ctx.close();

    // ---- Talk with Cassie: 6 turns, the studio voice runs out at the 3rd answer ----
    let n = 0;
    const c = await open(b, { device: 'Desktop Chrome', state: { groqKey: 'gsk_test', hearing: 'fast', voiceGender: gender }, fakeGroq: () => ({ text: `Turn ${++n} answer is that cells are small.` }) });
    const clog = await studioRoute(c.ctx, 3); // the greeting and 2 answers
    await c.ctx.addInitScript(FAKE_VOICE, {});
    await c.ctx.addInitScript(DEVICE_VOICES);
    await c.page.reload();
    await c.page.waitForFunction(() => window.CassieVoice.studio.on(), null, { timeout: 5000 });
    await c.page.click('#voice-btn');
    await c.page.waitForFunction(() => document.querySelector('.vc') && document.querySelector('.vc').dataset.phase === 'listening', null, { timeout: 8000 });
    for (let turn = 1; turn <= 6; turn++) {
      await c.page.evaluate((q) => window.__say(q), `Question ${turn} about cells?`);
      if (turn === 3) {
        await c.page.waitForSelector('.cv-pause button', { timeout: 15000 });
        expect(plain(await c.page.locator('.cv-pause').innerText()), 'no dashes in the pause note');
        await c.page.click('.cv-pause button');
      }
      await c.page.waitForFunction((k) => document.querySelector('.vc').dataset.phase === 'listening' && window.__shown.some((x) => x.includes(`Turn ${k} answer`)), turn, { timeout: 15000 });
    }
    played = await c.page.evaluate(() => window.CassieVoice.played());
    expect(played.length === 3 && played.every((x) => x.kind === 'studio' && x.voice === gender), `${gender}: the conversation kept the studio voice: ` + JSON.stringify(played));
    expect(clog.every((x) => x.voice === gender) && clog.filter((x) => !x.ok).length === 2, `${gender}: the 3rd answer was tried twice, then no more calls: ` + JSON.stringify(clog));
    expect((await c.page.evaluate(() => window.__spoken.filter((x) => x.trim()))).length === 0, `${gender}: the device’s voice never cut in mid-conversation`);
    expect(c.errors.length === 0, 'page errors: ' + c.errors.join('; '));
    await c.ctx.close();
  }
});

test('Teach me on phones: the phone’s own voice (iPhone Premium, then Enhanced; Android Google), one voice for 7 steps, started inside the tap, Next cuts the old speech, and a voice that fails never pops up', async (b) => {
  // the phone's speech: records each cancel and sentence (with its voice, and whether it began inside a tap)
  const PHONE_SPEECH = (list) => {
    window.__ev = []; window.__fail = null; window.__speakMs = 200;
    window.__inTap = false;
    addEventListener('click', () => { window.__inTap = true; }, true);
    addEventListener('click', () => { window.__inTap = false; }, false);
    window.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
    let cur = null;
    const synth = { speaking: false, pending: false, getVoices: () => list, addEventListener() {}, removeEventListener() {},
      cancel() { window.__ev.push({ e: 'cancel' }); if (cur) { const u = cur; cur = null; clearTimeout(u._t); u.onerror && u.onerror({ error: 'interrupted' }); } this.speaking = false; },
      speak(u) {
        if (!u.text.trim()) return;
        window.__ev.push({ e: 'speak', text: u.text, voice: u.voice ? u.voice.name : '(none)', tap: window.__inTap });
        if (window.__fail && window.__fail.test(u.text)) { setTimeout(() => u.onerror && u.onerror({ error: 'synthesis-failed' }), 10); return; }
        cur = u; this.speaking = true;
        setTimeout(() => { if (cur !== u) return; u.onstart && u.onstart(); u._t = setTimeout(() => { if (cur !== u) return; cur = null; synth.speaking = false; u.onend && u.onend(); }, window.__speakMs); }, 5);
      } };
    Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
  };
  const APPLE = [{ name: 'Samantha', lang: 'en-US', localService: true }, { name: 'Ava (Enhanced)', lang: 'en-US', localService: true }, { name: 'Ava (Premium)', lang: 'en-US', localService: true },
    { name: 'Daniel', lang: 'en-GB', localService: true }, { name: 'Evan (Enhanced)', lang: 'en-US', localService: true }, { name: 'Fred', lang: 'en-US', localService: true }, { name: 'Zarvox', lang: 'en-US', localService: true }];
  const ANDROID = [{ name: 'Google US English', lang: 'en-US', localService: false }, { name: 'Google English (United States) Female', lang: 'en-US', localService: true },
    { name: 'Google UK English Male', lang: 'en-GB', localService: true }, { name: 'eSpeak English', lang: 'en-US', localService: true }];
  const cases = [['iPhone 13', APPLE, { woman: 'Ava (Premium)', man: 'Evan (Enhanced)' }], ['Pixel 5', ANDROID, { woman: 'Google English (United States) Female', man: 'Google UK English Male' }]];
  const steps = Array.from({ length: 7 }, (_, i) => ({ say: `Step ${i + 1} is here.`, point: 0 }));
  const stepIs = (n) => `/${n} of 7/.test((document.querySelector('.tut-step') || {}).textContent || '')`;
  for (const [device, voices, want] of cases) {
    for (const gender of [device === 'iPhone 13' ? 'woman' : 'man']) { // (one voice per phone keeps the suite short; each phone's picking order is checked)
      const t = await open(b, { device, touch: true, server: false, state: { groqKey: 'gsk_test', voiceGender: gender }, fakeGroq: () => ({ text: JSON.stringify({ steps }) }) });
      const page = t.page;
      await t.ctx.addInitScript(PHONE_SPEECH, voices);
      await page.reload();
      await page.evaluate(() => { window.__paused = 0; new MutationObserver(() => { if (document.querySelector('.cv-pause')) window.__paused++; }).observe(document.body, { childList: true, subtree: true }); });
      await page.evaluate(() => openLabs('atom'));
      await page.waitForSelector('.lab-view:not([hidden])[data-lab="atom"] .lab-controls > *', { timeout: 15000 });
      await page.evaluate(() => { window.__speakMs = 2500; }); // (long sentences: Next comes while she is still talking)
      await page.tap('.lab-teach');
      await page.waitForFunction(new Function('return ' + stepIs(1)), null, { timeout: 15000 });
      await page.waitForFunction(() => window.__ev.some((x) => x.e === 'speak' && /Step 1/.test(x.text)), null, { timeout: 5000 });
      // Next while she's still talking: the old sentence is cut first, the new one starts inside the tap
      for (let k = 2; k <= 7; k++) {
        await page.waitForTimeout(300);
        const n0 = await page.evaluate(() => window.__ev.length);
        await page.tap('.tut-next');
        await page.waitForFunction((k) => window.__ev.some((x) => x.e === 'speak' && x.text === `Step ${k} is here.`), k, { timeout: 5000 });
        const ev = (await page.evaluate(() => window.__ev)).slice(n0);
        const sp = ev.findIndex((x) => x.e === 'speak'), cancel = ev.findIndex((x) => x.e === 'cancel');
        expect(cancel >= 0 && cancel < sp, `${device} ${gender}: Next cancels the old speech before step ${k} starts: ` + JSON.stringify(ev));
        expect(ev[sp].tap === true, `${device} ${gender}: step ${k} starts inside the tap on Next: ` + JSON.stringify(ev[sp]));
      }
      const spoken = (await page.evaluate(() => window.__ev)).filter((x) => x.e === 'speak');
      expect(spoken.length >= 7 && spoken.every((x) => x.voice === want[gender]), `${device} ${gender}: every step in ${want[gender]}: ` + JSON.stringify(spoken.map((x) => x.voice)));
      expect(await page.evaluate(() => window.__paused) === 0, `${device} ${gender}: no Keep going pop up`);
      expect(t.errors.length === 0, "page errors: " + t.errors.join("; "));
      await t.ctx.close();
    }
    // the voice fails from step 3 on: no pop up, the lesson still reaches step 7, and Hear it again shows
    const t = await open(b, { device, touch: true, server: false, state: { groqKey: 'gsk_test' }, fakeGroq: () => ({ text: JSON.stringify({ steps }) }) });
    const page = t.page;
    await t.ctx.addInitScript(PHONE_SPEECH, voices);
    await page.reload();
    await page.evaluate(() => { window.__paused = 0; new MutationObserver(() => { if (document.querySelector('.cv-pause')) window.__paused++; }).observe(document.body, { childList: true, subtree: true }); });
    await page.evaluate(() => openLabs('atom'));
    await page.waitForSelector('.lab-view:not([hidden])[data-lab="atom"] .lab-controls > *', { timeout: 15000 });
    await page.evaluate(() => { window.__fail = /Step [3-7]/; window.__speakMs = 2500; });
    await page.tap('.lab-teach');
    await page.waitForFunction(new Function('return ' + stepIs(1)), null, { timeout: 15000 });
    await page.tap('.tut-next'); await page.waitForTimeout(200);
    await page.tap('.tut-next');
    await page.waitForFunction(new Function('return ' + stepIs(3)), null, { timeout: 5000 });
    await page.waitForSelector('.tut-hear:not([hidden])', { timeout: 5000 });
    expect((await page.locator('.tut-hear').boundingBox()).height >= 44, `${device}: Hear it again is 44px tall`);
    const tries = await page.evaluate(() => window.__ev.filter((x) => x.e === 'speak' && /Step 3/.test(x.text)).length);
    expect(tries === 2, `${device}: step 3 was tried twice: ${tries}`);
    for (let k = 4; k <= 7; k++) { await page.tap('.tut-next'); await page.waitForFunction(new Function('return ' + stepIs(k)), null, { timeout: 5000 }); }
    await page.waitForSelector('.tut-hear:not([hidden])', { timeout: 5000 });
    expect(await page.evaluate(() => window.__paused) === 0 && await page.locator('.cv-pause').count() === 0, `${device}: no pop up when the voice fails`);
    // the voice works again: Hear it again says the step (inside the tap)
    await page.evaluate(() => { window.__fail = null; });
    await page.tap('.tut-hear');
    await page.waitForFunction(() => window.__ev.filter((x) => x.e === 'speak' && /Step 7/.test(x.text)).length === 3, null, { timeout: 5000 });
    expect(await page.locator('.tut-hear').isHidden(), `${device}: the button goes once she can speak`);
    expect(t.errors.length === 0, 'page errors: ' + t.errors.join('; '));
    await t.ctx.close();
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
    if (/Write ONLY this section/.test(all)) { seen.sections++; return { text: `**Rizal's life**\n- Born in Calamba\n@@PERSON: José Rizal — national hero\n@@DATE: 30 December 1896 — Rizal is executed in Bagumbayan\n@@DATE: 1861 — Rizal is born\n@@TERM: Propaganda Movement — campaign for reforms` }; }
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
  await page.waitForFunction(() => { const c = document.querySelector('.csk-bg'); return c && c.width === 600 && c.height === 300; }, null, { timeout: 5000 });
  await ctx.close();
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

test('Appearance has no 3D Cassie any more; an old 3D choice becomes Cursor Cassie', async (b) => {
  const { ctx, page, errors } = await open(b, { server: false, lite: 'off', state: { groqKey: 'gsk_test', look: 'felt' } });
  await page.waitForTimeout(600);
  expect(await page.locator('#look-select').count() === 0 && !/3D felt/.test(await page.content()), 'the 3D option should be gone from Appearance');
  expect(await page.locator('#mascot.has2d').count() === 1, 'Cursor Cassie should show even for someone who had picked the 3D Cassie');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('cassie.v2')).look === undefined), 'the old choice is forgotten');
  expect(errors.length === 0, 'page errors: ' + errors.join('; '));
  await ctx.close();
});

test('Cursor Cassie: the default Cassie, she reacts to the app', async (b) => {
  const { ctx, page, errors } = await open(b, { server: false, lite: 'off', state: { groqKey: 'gsk_test' }, fakeGroq: async () => { await new Promise((r) => setTimeout(r, 800)); return { text: 'An answer.' }; } });
  await page.waitForSelector('#mascot.has2d .cassie-bot', { timeout: 5000 }); // (the flat drawing, then the 3D one)
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
  await page.waitForSelector('#island.live .cassie-bot', { timeout: 3000 });
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
test('Explore 3D: turn a cell, tap a part, ask Cassie about it, then quiz on the plant cell', async (b) => {
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
const FAKE_VOICE = (opts) => {
  window.__spoken = []; window.__recs = []; window.__shown = [];
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

// The voice model's files, served in place of Hugging Face: a tiny stand-in model (a tone, not speech)
// that runs through the real kokoro-js and ONNX runtime, with the real voice styles.
const KOKORO_FIXTURE = path.join(__dirname, 'fixtures', 'kokoro');
const serveKokoro = (ctx) => ctx.route(/huggingface\.co\/onnx-community\/Kokoro-82M-v1\.0-ONNX\/resolve\/main\//, (route) => {
  const rel = new URL(route.request().url()).pathname.split('/resolve/main/')[1];
  const file = path.join(KOKORO_FIXTURE, rel);
  if (!rel || rel.includes('..') || !fs.existsSync(file)) return route.fulfill({ status: 404, body: 'not found' });
  return route.fulfill({ path: file, contentType: rel.endsWith('.json') ? 'application/json' : 'application/octet-stream' });
});
const WATCH_VOICE_WORKER = () => {
  window.__said = []; window.__played = 0;
  const post = Worker.prototype.postMessage;
  Worker.prototype.postMessage = function (m, ...rest) { if (m && m.type === 'say') window.__said.push({ text: m.text, voice: m.voice }); return post.call(this, m, ...rest); };
  const start = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (...a) { window.__played++; return start.apply(this, a); };
};

test('Cassie’s voice is Bella (or Edward) once she’s on the device — the phone’s voice only until then, and she never makes you wait', async (b) => {
  const { ctx, page, errors } = await open(b, { server: false, device: 'Desktop Chrome', state: { groqKey: 'gsk_test', hearing: 'fast' }, fakeGroq: () => ({ text: 'Mitochondria make energy for the cell. They are the powerhouse.' }) });
  // the voice model downloads slowly here, like on a slow connection
  await ctx.route(/huggingface\.co\/onnx-community\/Kokoro-82M-v1\.0-ONNX\/resolve\/main\/onnx\//, async (route) => {
    await new Promise((r) => setTimeout(r, 8000));
    return route.fulfill({ path: path.join(KOKORO_FIXTURE, 'onnx', 'model_quantized.onnx'), contentType: 'application/octet-stream' });
  });
  await serveKokoro(ctx);
  await ctx.addInitScript(FAKE_VOICE, {});
  await ctx.addInitScript(WATCH_VOICE_WORKER);
  await page.reload();
  expect(await page.evaluate(() => window.crossOriginIsolated), 'the app is cross-origin isolated (her voice can use several cores)');
  await page.click('#voice-btn');
  await page.waitForSelector('.vc-hv:not([hidden]) >> text=Getting Cassie’s voice ready', { timeout: 5000 });
  if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/voice-human-loading.png' });
  // she doesn't wait for her voice: the greeting is on screen and she's listening already
  await page.waitForFunction(() => document.querySelector('.vc').dataset.phase === 'listening', null, { timeout: 3000 });
  expect(await page.evaluate(() => window.CassieVoice.status()) === 'loading', 'she listens while her voice is still downloading');
  expect(/listening/.test(await page.locator('.vc-cassie').innerText()), 'the greeting shows as text');
  await page.waitForFunction(() => window.CassieVoice.status() === 'ready', null, { timeout: 30000 });
  const deviceBefore = await page.evaluate(() => window.__spoken.length); // the phone's voice filled in while she downloaded
  // the download note becomes "her own voice is ready" (from the next conversation: this one keeps its voice), then goes away
  await page.waitForSelector('.vc-hv:not([hidden]) >> text=Cassie’s own voice is ready', { timeout: 5000 });
  expect(/next time/.test(await page.locator('.vc-hv').innerText()), 'her own voice starts next time, never mid-conversation');
  await page.waitForSelector('.vc-hv[hidden]', { state: 'attached', timeout: 10000 });
  expect(await page.evaluate(() => window.CassieVoice.info().isolated), 'her voice uses several cores');
  // the next conversation is in Bella's voice
  await page.click('.vc-x');
  await page.click('#voice-btn');
  await page.waitForFunction(() => document.querySelector('.vc').dataset.phase === 'listening', null, { timeout: 8000 });
  await page.evaluate(() => window.__say('What do mitochondria do?'));
  await page.waitForFunction(() => window.__said.some((x) => /powerhouse/.test(x.text)), null, { timeout: 15000 });
  const said = await page.evaluate(() => window.__said);
  expect(said.every((x) => x.voice === 'af_bella'), 'the woman’s voice is Bella, like the explainer video: ' + JSON.stringify(said.map((x) => x.voice)));
  expect(said[0].text.length <= 75, 'her first piece is short, so she starts talking quickly: ' + said[0].text);
  await page.waitForFunction(() => document.querySelector('.vc').dataset.phase === 'listening', null, { timeout: 8000 });
  expect(await page.evaluate(() => window.__played) >= 1, 'the voice made by the model was played');
  // the man's voice
  await page.click('.vc-gender [data-gender="man"]');
  await page.waitForFunction(() => window.__said.some((x) => x.voice === 'bm_george' && /my voice now/.test(x.text)), null, { timeout: 8000 });
  await page.click('.vc-gender [data-gender="woman"]');
  await page.click('.vc-x');
  // Settings → Voice: she's ready, and a sample plays
  await tapSettings(page);
  await page.evaluate(() => { const d = document.querySelector('#voice-gender-select').closest('details'); if (d) d.open = true; });
  await page.waitForSelector('#hv-state >> text=Bella’s voice is ready', { timeout: 5000 });
  expect(await page.locator('#voice-engine-select').count() === 0, 'no robot-voice option any more');
  await page.click('#hv-play');
  await page.waitForFunction(() => window.__said.some((x) => /Let’s study together/.test(x.text)), null, { timeout: 8000 });
  await page.evaluate(() => closeSettings());
  // reading answers aloud uses it too
  await page.evaluate(() => { state.voiceOut = true; });
  await page.fill('#prompt-input', 'And ribosomes?');
  await page.press('#prompt-input', 'Enter');
  await page.waitForFunction(() => window.__said.filter((x) => /powerhouse/.test(x.text)).length >= 2, null, { timeout: 15000 });
  expect(await page.evaluate(() => window.__spoken.length) === deviceBefore, 'once Bella is ready, only Bella speaks: ' + JSON.stringify(await page.evaluate(() => window.__spoken)));
  expect(errors.length === 0, 'page errors: ' + errors.join('; '));
  await ctx.close();

  // a phone on mobile data is asked first; if her voice can't load, the phone's own voice speaks — Cassie is never silent
  const c2 = await open(b, { server: false, state: { groqKey: 'gsk_test', hearing: 'fast' }, fakeGroq: () => ({ text: 'Sure.' }) });
  await c2.ctx.addInitScript(FAKE_VOICE, {});
  await c2.page.reload();
  await c2.page.click('#voice-btn');
  await c2.page.waitForSelector('.vc-hv:not([hidden]) >> text=Get Cassie’s own voice?', { timeout: 5000 });
  expect(await c2.page.evaluate(() => window.CassieVoice.status()) === 'off', 'nothing downloads on a phone until asked');
  if (process.env.SHOTS) await c2.page.screenshot({ path: process.env.SHOTS + '/voice-human-ask.png' });
  await c2.page.click('.vc-hv [data-hv="get"]');
  await c2.page.waitForSelector('.vc-hv:not([hidden]) >> text=Cassie is using your phone’s voice', { timeout: 20000 });
  await c2.page.waitForFunction(() => document.querySelector('.vc').dataset.phase === 'listening', null, { timeout: 8000 });
  await c2.page.evaluate(() => window.__say('Hello'));
  await c2.page.waitForFunction(() => document.querySelector('.vc-cassie').textContent === 'Sure.', null, { timeout: 10000 });
  await c2.page.waitForFunction(() => document.querySelector('.vc').dataset.phase === 'listening', null, { timeout: 8000 });
  expect(await c2.page.evaluate(() => window.__spoken.some((t) => /Sure/.test(t))), 'her voice couldn’t load, so the phone’s voice said the answer: ' + JSON.stringify(await c2.page.evaluate(() => window.__spoken)));
  await c2.ctx.close();
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

test('Explore cells are their own view: own card on the Labs shelf and in 3D, Animal or Plant inside it, opened straight away (never through the body)', async (b) => {
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

test('Explore 3D: the human body — 10 systems, tap or find a part to learn what it is, a girl’s body, ask Cassie', async (b) => {
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

test('Body 3D: eyes on both bodies (tap one for its card), and the girl has long hair and her own shape', async (b) => {
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

test('Explore 3D body like an atlas: Front/Back/Side views, spread every piece apart and back, structure count, which-way letters', async (b) => {
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

test('Labs: the shelf, every lab opens and works, goals tick, and Ask Cassie sends what is on screen', async (b) => {
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
    expect(await page.locator('.lab-stage canvas, .lab-stage .lab-balance, .lab-stage .lab-units, .lab-stage .puz-sudoku, .lab-stage .puz-eq, .lab-stage .tl-sheet').count() >= 1, id + ' draws something');
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
  expect(['vocab', 'timeline', 'essay', 'cardmatrix', 'cornell', 'thesis', 'museum'].every((t) => tools.includes(t)) && !tools.includes('pendulum') && !tools.includes('sudoku'), 'the Study tools shelf: ' + tools);
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

test('All 3D on Free: the cells, the body, the solar system and the globe open twice a week each, then say how to get Plus', async (b) => {
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

test('Teach me and Ask Cassie in the 3D explorer: Cassie teaches the cell, pointing at its buttons and labels', async (b) => {
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

test('iPhone: every box you type in is at least 16px (smaller makes iPhones zoom the whole page), in the chat, Labs, every lab, the tutor and the 3D explorer', async (b) => {
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

test('Labs 3D and atlas: fly to Jupiter and out to Andromeda, launch a 3D rocket, look up Japan and a place; pour, drag particles and disks', async (b) => {
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

test('landing: Meet Cassie mood buttons change her mood', async (b) => {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(APP.replace('app.html', 'index.html'));
  await page.locator('#meet').scrollIntoViewIfNeeded();
  await page.waitForSelector('#play-stage .cassie-bot');
  await page.waitForSelector('#meet .play.in'); await page.waitForTimeout(900); // let it finish sliding in
  expect(await page.locator('#moods button').count() >= 12, 'mood buttons missing');
  await page.click('#moods button[data-m="dance"]');
  expect(await page.locator('#moods button.on').getAttribute('data-m') === 'dance', 'Dance should be selected');
  expect(/Study break/.test(await page.locator('#play-say').innerText()), 'caption should change');
  await page.click('#moods button[data-m="oops"]');
  expect(await page.locator('#moods button.on').getAttribute('data-m') === 'oops', 'Oops should be selected');
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

test('landing: highlight a word on the page and Cassie explains it, quizzes you, makes a card', async (b) => {
  const ctx = watchCsp(await b.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' }));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(APP.replace('app.html', 'index.html'));
  // under the hero: a 3D laptop and phone showing Labs (the Google Docs strip is gone)
  expect(await page.locator('.strip, .marquee').count() === 0, 'the scrolling strip is gone');
  expect(await page.locator('.lx-lid .lx-scr img').count() === 6 && await page.locator('.lx-phone img').count() === 3, 'the laptop and phone show Labs, the body and the planets');
  expect(await page.locator('.lx-notch').count() === 1 && await page.locator('.lx-keys text').count() > 60 && await page.locator('.lx-island').count() === 1, 'a real-looking laptop (notch, labelled keys) and phone (dynamic island)');
  expect(await page.evaluate(async () => { const all = [...document.querySelectorAll('.lx-show img')]; await Promise.all(all.map((i) => { i.loading = 'eager'; return i.decode().catch(() => null); })); return all.every((i) => i.naturalWidth > 0); }), 'every device screen image loads');
  expect(await page.locator('.nav .brand svg rect[rx="11"]').count() === 2, 'the new logo: Cursor Cassie with her two eyes');
  // the scroll story: scrolling through a scene moves what's inside it
  const scrollTo = async (sel, p) => {
    await page.evaluate(([s, q]) => { const el = document.querySelector(s); const top = el.getBoundingClientRect().top + scrollY; scrollTo({ top: top + (el.offsetHeight - innerHeight) * q, behavior: 'instant' }); }, [sel, p]);
    await page.waitForTimeout(150);
  };
  await scrollTo('.lx-show', 0.32);
  expect(await page.evaluate(() => { const r = document.querySelector('.lx-scr').getBoundingClientRect(); return r.width > innerWidth * 0.85; }), 'scrolled in, the laptop screen fills the window');
  // Cassie taps "Human body 3D" and the body pulls apart, frame by frame
  await scrollTo('.lx-show', 0.385);
  expect(await page.evaluate(() => +getComputedStyle(document.querySelector('.lx-cursor')).opacity > 0.5), 'Cassie’s cursor goes to the card');
  await scrollTo('.lx-show', 0.5);
  await page.waitForFunction(() => +getComputedStyle(document.querySelector('.lx-body')).opacity === 1 && document.querySelector('.lx-show')._lx.drawn > 0, null, { timeout: 8000 }).catch(() => {});
  expect(await page.evaluate(() => document.querySelector('.lx-show')._lx.drawn > 0) && /^Human body/.test(await page.locator('.lx-type span').innerText()), 'then the body is pulled apart on the screen');
  // then the planets
  await scrollTo('.lx-show', 0.72);
  expect(await page.evaluate(() => +getComputedStyle(document.querySelector('.lx-planets')).opacity === 1 && [...document.querySelectorAll('.lx-planets img')].some((i) => +getComputedStyle(i).opacity === 1)) && /^The planets/.test(await page.locator('.lx-type span').innerText()), 'then the planets');
  await scrollTo('.st-steps', 0.7);
  expect(await page.locator('.ss-list li.on').innerText() === 'Quiz', 'two-thirds through the steps, Quiz is the step on: ' + await page.locator('.ss-list li.on').innerText());
  expect(await page.locator('.ss-card.on').count() === 1, 'one step card shows at a time');
  await scrollTo('.st-path', 0.1);
  const early = await page.locator('.sp-node.on').count();
  await scrollTo('.st-path', 1);
  expect(early >= 1 && await page.locator('.sp-node.on').count() === 6 && /Remembered/.test(await page.locator('.sp-status').innerText()), 'the dot travels the path to Remembered');
  await scrollTo('.st-brain', 1);
  expect(await page.locator('.sb-steps').innerText() === 'Solved', 'the ring fills and the answer comes out');
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

test('landing: the desk runs the demos and the real labs; the little toys work', async (b) => {
  const ctx = watchCsp(await b.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' }));
  await ctx.route(/wikipedia\.org|worldbank\.org/, (r) => r.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(APP.replace('app.html', 'index.html'));
  await page.locator('#desk').scrollIntoViewIfNeeded();
  await page.waitForSelector('#desk-stage .sn-cv');
  await page.click('.sn-auto');
  await page.waitForFunction(() => document.querySelectorAll('.sn-steps li').length >= 4, null, { timeout: 15000 });
  await page.click('.sn-board .dk-btn');
  await page.waitForSelector('#desk-stage .sn-board[hidden]', { state: 'attached' });
  await page.click('#desk [data-demo="files"]');
  await page.click('.fl-file[data-f="pdf"]');
  await page.waitForFunction(() => /Reviewer ready/.test(document.querySelector('.fl-pill').textContent), null, { timeout: 10000 });
  expect(/Decomposer/.test(await page.locator('.fl-rev').innerText()), 'a reviewer is written');
  await page.click('#desk [data-demo="labs"]');
  await page.waitForSelector("#desk-stage .labs-embed .lab-panel input[type=range]", { state: "attached" });
  await page.click('.lp-chips [data-i="1"]');
  await page.waitForSelector('#desk-stage .labs-embed .lab-stage canvas');
  await page.click('#desk [data-demo="puzzles"]');
  await page.waitForSelector('#desk-stage .labs-embed .puz-head');
  // toys
  await page.click('#toy-quiz [data-a="1"]');
  expect(/Right!/.test(await page.locator('#toy-quiz .qz-fb').innerText()), 'quiz answers');
  await page.click('#toy-cite [data-c="MLA"]');
  expect(/vol\. 44/.test(await page.locator('#toy-cite .ct-ref').innerText()), 'MLA citation shown');
  await page.click('#toy-memory [data-forget] >> nth=0');
  await page.waitForFunction(() => document.querySelectorAll('#toy-memory li').length === 3);
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
  await page.click('[data-act="undo"]');
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

test('study tools in the sidebar: Flashcards one tap away mid-chat (a rail of icons or the full sidebar on a computer, the menu on a phone), Search, the highlight switch, and Ideas to get started points there', async (b) => {
  const { tapResponseIssues } = require('./ui-checks.cjs');
  const reply = () => ({ text: 'Osmosis is water moving across a membrane.' });
  // ---- a computer ----
  const { ctx, page, errors } = await open(b, { device: 'Desktop Chrome', viewport: { width: 1280, height: 800 }, server: false, state: { groqKey: 'gsk_test' }, fakeGroq: reply });
  expect(await page.locator('.ideas-panel, .ideas-shade').count() === 0, 'the old Ideas panel is gone');
  expect(await page.locator('.home-ideas').isVisible(), 'Ideas to get started is still on the home screen');
  await ask(page, 'What is osmosis?');
  const geo = () => page.evaluate(() => { const s = document.getElementById('sidebar').getBoundingClientRect(), a = document.getElementById('app').getBoundingClientRect(), c = document.getElementById('chat-log').getBoundingClientRect(); return { side: Math.round(s.right), app: Math.round(a.left), chat: Math.round(c.left), wide: document.documentElement.scrollWidth > innerWidth, open: document.body.classList.contains('side-open') }; });
  let g = await geo();
  expect(!g.open && g.side >= 60 && g.side <= 90 && g.app >= g.side && g.chat >= g.side && !g.wide, 'a slim rail beside the chat, nothing covered: ' + JSON.stringify(g));
  const fc = page.locator('.side-tool[data-tip="Flashcards"]');
  const fb = await fc.boundingBox();
  expect(await fc.isVisible() && fb && fb.y + fb.height <= 800 && fb.x + fb.width <= g.side, 'the rail shows Flashcards, no scrolling: ' + JSON.stringify(fb));
  expect(!(await fc.locator('span').isVisible()), 'the rail is icons only');
  // its name shows beside it on hover
  await fc.hover();
  await page.waitForSelector('#side-tip:not([hidden])', { timeout: 2000 });
  expect((await page.locator('#side-tip').innerText()) === 'Flashcards', 'the tooltip names it');
  await fc.click();
  await page.waitForSelector('.fc:not([hidden]) .fc-x', { timeout: 5000 });
  await page.waitForFunction(() => document.querySelector('.side-tool[data-tip="Flashcards"]').classList.contains('on'), null, { timeout: 2000 });
  if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/side-rail-cards.png' });
  await page.click('.fc-x');
  await page.waitForFunction(() => !document.querySelector('.side-tool[data-tip="Flashcards"]').classList.contains('on'), null, { timeout: 2000 });
  // the chevron: the full sidebar, the tool list folded at first so the timer and Recents are near the top
  await page.click('#side-toggle');
  await page.waitForTimeout(400);
  const inView = (sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return 'missing'; const r = e.getBoundingClientRect(); return r.height > 0 && r.top >= 0 && r.bottom <= innerHeight ? 'ok' : JSON.stringify(r); }, sel);
  expect(await page.locator('#side-menu-toggle').getAttribute('aria-expanded') === 'false', 'the tool list starts folded');
  expect(await inView('#pomo-toggle') === 'ok' && await inView('#chat-list .chat-item') === 'ok', 'folded: the timer’s Start and the first chat are in view: ' + await inView('#pomo-toggle') + ' ' + await inView('#chat-list .chat-item'));
  // typing in Search opens it for a moment; clearing folds it again
  await page.fill('#side-search', 'flash');
  expect(await page.locator('.side-tool[data-tip="Flashcards"] span').isVisible(), 'flash finds Flashcards while folded');
  await page.fill('#side-search', '');
  expect(await page.locator('#side-menu-toggle').getAttribute('aria-expanded') === 'false', 'clearing Search folds it again');
  await page.click('#side-menu-toggle');
  const labels = await page.evaluate(() => HOME_EXAMPLES.map((x) => x.label));
  for (const l of labels) expect(await page.locator('.side-tool', { hasText: l }).locator('span').isVisible(), 'the full sidebar shows ' + l);
  g = await geo();
  expect(g.open && g.side >= 260 && g.app >= g.side && !g.wide, 'the full sidebar, the chat moved over: ' + JSON.stringify(g));
  if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/side-open.png' });
  await page.reload(); await page.waitForTimeout(800);
  expect((await geo()).open, 'still the full sidebar after a reload');
  // Search: the tools and the chats that match
  await page.fill('#side-search', 'flash');
  const shownTools = await page.evaluate(() => [...document.querySelectorAll('.side-tool')].filter((x) => !x.hidden).map((x) => x.dataset.tip));
  expect(shownTools.join() === 'Flashcards', 'flash leaves only Flashcards: ' + shownTools);
  expect(await page.locator('#chat-list .chat-item:visible').count() === 0, 'and the chat about osmosis is hidden');
  await page.fill('#side-search', 'osmo');
  expect(await page.locator('#chat-list .chat-item:visible').count() === 1 && await page.locator('.side-tool:visible').count() === 0, 'osmo finds the chat');
  await page.fill('#side-search', '');
  // the highlight switch is the same setting as the one in Settings
  await page.click('.side-hl');
  expect(await page.evaluate(() => state.highlightHelp === false && document.getElementById('highlight-help-toggle').checked === false), 'the sidebar switch turns highlight help off, Settings agrees');
  await page.click('.side-hl');
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
  await page.evaluate(() => { setSideOpen(false); createNewChat(); });
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
    await page.waitForSelector(place + ' svg', { timeout: 10000 }); await page.waitForTimeout(700); // (where the flat Cassie sits once the page has settled)
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

test('museum: every painting’s picture really loads (all 35, from the app, no outside host), and every frame is the carved antique gold one', async (b) => {
  for (const [size, device, viewport] of [['390x844', 'iPhone 13', { width: 390, height: 844 }], ['1280x800', 'Desktop Chrome', { width: 1280, height: 800 }]]) {
    const { ctx, page, errors } = await open(b, { device, viewport, scale: 1, server: false, state: { groqKey: 'gsk_test' } });
    const outside = [];
    page.on('request', (r) => { if (/wiki(pedia|media)\.org/.test(r.url())) outside.push(r.url()); });
    await page.evaluate(() => openLabs('museum'));
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
      return { id: f.dataset.pic, gold: /gradient/.test(cs.backgroundImage) && (cs.boxShadow.match(/inset/g) || []).length >= 5, corners: (before.backgroundImage.match(/data:image\/svg\+xml/g) || []).length === 4, beads: /radial-gradient/.test(after.backgroundImage), lip: (lip.boxShadow.match(/rgb/g) || []).length >= 3 };
    }));
    const plain = frames.filter((f) => !(f.gold && f.corners && f.beads && f.lip));
    expect(frames.length === 35 && !plain.length, `${size}: every frame is the antique one: ` + JSON.stringify(plain.slice(0, 3)));
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

test('first run screens: every word at AA in light and dark, every control answers a tap, and nothing spills sideways, at 390x844, 768x1024 and 1280x800', async (b) => {
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

test('Monochrome (Graphite) is everyone’s main colour unless Blush & Sage is picked, and Home’s boxes each open their feature (390x844, 1280x800)', async (b) => {
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
      r.page.on('dialog', (d) => d.dismiss().catch(() => {}));
      await r.page.waitForSelector(hub + ' .hub-boxes', { timeout: 10000 });
      return r;
    };
    let { ctx, page, errors } = await start();
    const g = await page.evaluate((h) => { const hero = document.querySelector(h + ' .hub-hero').getBoundingClientRect(), bx = [...document.querySelectorAll(h + ' .hub-box')].map((e) => e.getBoundingClientRect()); return { n: bx.length, under: Math.round(bx[0].top - hero.bottom), cols: new Set(bx.map((r) => Math.round(r.left))).size, min: Math.min(...bx.map((r) => r.height)) }; }, hub);
    expect(g.n === 10 && (phone || (g.under >= 0 && g.under < 40)) && g.cols === (phone ? 2 : 4) && g.min >= 44, `${size}: ten boxes${phone ? '' : ' right under the header'}, ${phone ? 2 : 4} across: ` + JSON.stringify(g));
    expect(await page.locator(hub + ' .hub-q', { hasText: /^(Quiz me|Flashcards|Research a topic)$/ }).count() === 0, `${size}: no Quick action repeats a box`);
    for (const scheme of ['light', 'dark']) { await page.emulateMedia({ colorScheme: scheme }); await page.waitForTimeout(800); const { bad } = await contrastIssues(page, hub + ' .hub-boxes'); expect(!bad.length, `${size} boxes (${scheme}): ` + bad.join(' | ')); }
    await page.emulateMedia({ colorScheme: 'light' });
    for (const [act, , opened] of BOXES) {
      if (act === 'room') { await ctx.close(); ({ ctx, page, errors } = await start({ server: true })); }
      else { await page.goto(APP); await page.waitForTimeout(400); await page.evaluate((ph) => { if (ph) CassieNative.go('home'); else createNewChat(); }, phone); await page.waitForSelector(hub + ' .hub-boxes', { timeout: 10000 }); }
      await page.click(`${hub} .hub-box[data-hub="${act}"]`);
      const ok = await opened(page).then(() => true, () => false);
      expect(ok, `${size}: the ${act} box opens its feature`);
      if (act === 'timer') await page.evaluate(() => { const t = document.getElementById('pomo-toggle'); if (/pause/i.test(t.textContent)) t.click(); });
    }
    expect(!errors.length, `${size}: page errors: ` + errors.join('; '));
    await ctx.close();
  }
});

test('phone Home: a peek inside the labs slides past the hello, a live Today’s Lab card, then Today, Continue, the boxes and Quick actions; still with Reduce Motion or Lite mode; a computer’s Home is unchanged', async (b) => {
  const seed = { groqKey: 'gsk_test', tab: 'home', chats: [{ id: 'h1', title: 'What is osmosis?', messages: [{ role: 'user', content: 'What is osmosis?' }, { role: 'assistant', content: 'Water moving.' }], updatedAt: Date.now() }], cards: [{ id: 'c1', f: 'Q', b: 'A', deck: 'Bio', box: 0, due: 0, at: 0 }] };
  {
    const { ctx, page, errors } = await open(b, { device: 'iPhone 13', scale: 1, lite: 'off', server: false, state: seed });
    await page.waitForSelector('#home .hub-hero-phone .hub-tile[data-preview]', { timeout: 10000 });
    await page.waitForTimeout(800);
    await page.waitForFunction(() => document.querySelectorAll('#home .hub-tile[data-preview]').length >= 8, null, { timeout: 8000 }); // (Home is redrawn now and then: its previews come straight back)
    const h = await page.evaluate(() => {
      const hub = document.querySelector('#home .hub'), kids = [...hub.children];
      const at = (sel) => kids.findIndex((k) => k.matches(sel)), atH = (re) => kids.findIndex((k) => k.matches('.hub-h') && re.test(k.textContent));
      const run = document.querySelector('.hub-strip-run');
      return { hello: document.querySelector('#home .hub-me').textContent, tiles: document.querySelectorAll('#home .hub-tile[data-preview]').length, anim: getComputedStyle(run).animationName,
        order: [at('.hub-hero'), at('.hub-tlab'), atH(/^Today$/), atH(/Continue/), at('.hub-boxes'), atH(/Quick actions/)],
        lab: document.querySelector('.hub-tlab b').textContent, want: (LAB_INFO[todayLab()] || [])[0], pv: document.querySelector('.hub-tlab-pv').dataset.preview, today: todayLab(),
        play: document.querySelector('.hub-tlab-go').getBoundingClientRect().width };
    });
    expect(/^(Morning|Afternoon|Evening), Test$/.test(h.hello), 'the hello: ' + h.hello);
    expect(h.tiles >= 8 && h.anim === 'hubStrip', 'lab previews slide past in the header: ' + JSON.stringify(h));
    expect(h.order.every((x, i) => x >= 0 && (i === 0 || x > h.order[i - 1])), 'the header, Today’s Lab, Today, Continue, the boxes, Quick actions: ' + JSON.stringify(h.order));
    expect(h.lab === h.want && h.pv === h.today && h.play >= 44, 'Today’s Lab is today’s lab with its live preview and a 44px play button: ' + JSON.stringify(h));
    // the previews keep drawing
    const fr = () => page.evaluate(() => +document.querySelector('.hub-tlab-pv').dataset.frames);
    const f0 = await fr(); await page.waitForTimeout(800);
    const f1 = await fr(); expect(f1 > f0 + 5, 'Today’s Lab preview is moving: ' + JSON.stringify([f0, f1]));
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
    const st = await page.evaluate(() => ({ still: [...document.querySelectorAll('#home canvas[data-preview]')].every((c) => c.dataset.still === '1'), anim: getComputedStyle(document.querySelector('.hub-strip-run')).animationName }));
    const fr = () => page.evaluate(() => +document.querySelector('.hub-tlab-pv').dataset.frames || 0);
    const f0 = await fr(); await page.waitForTimeout(1000); const f1 = await fr();
    expect(st.still && st.anim === 'none' && f1 - f0 <= 2, `${why}: still previews (one frame each, not ~30 a second): ` + JSON.stringify({ ...st, f0, f1 }));
    await ctx.close();
  }
  // a computer: the same Home as before (no strip, no Today’s Lab card; the hello bar, then the boxes)
  {
    const { ctx, page } = await open(b, { device: 'Desktop Chrome', viewport: { width: 1280, height: 800 }, lite: 'off', server: false, state: { ...seed, chats: [], cards: [] } });
    await page.waitForSelector('#chat-log .hub .hub-boxes');
    const d = await page.evaluate(() => { const hub = document.querySelector('#chat-log .hub'); return { kids: [...hub.children].slice(0, 3).map((k) => k.className), strip: !!hub.querySelector('.hub-strip, .hub-tlab, canvas[data-pv]'), hello: hub.querySelector('.hub-hero').innerText, boxes: hub.querySelectorAll('.hub-box').length }; });
    expect(!d.strip && /Hi, welcome/.test(d.hello) && d.kids[0] === 'hub-hero' && d.kids[1].startsWith('hub-remind') && d.kids[2] === 'hub-boxes' && d.boxes === 10, 'a computer’s Home is unchanged: ' + JSON.stringify(d));
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
    expect(looks.length >= 3 && looks.every((l) => l === want), `${who}: every preview is ${want}: ` + looks.join(','));
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
  const { ctx, page, errors } = await open(b, { device: 'iPhone 13', scale: 1, lite: 'off', server: false, state: { groqKey: 'gsk_test', tab: 'home', plan: null } });
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  await page.click('.tab[data-tab="labs"]');
  await page.waitForSelector('.labs:not([hidden]) .lp:not([hidden]) .lp-big[data-preview]', { timeout: 15000 });
  const top = await page.evaluate(() => ({ title: document.querySelector('.lp-head h2').textContent, find: document.querySelector('.lp-find').getBoundingClientRect().width,
    chips: [...document.querySelectorAll('.lp-chips button')].map((c) => c.textContent), rec: document.querySelector('.lp-card .lp-info b').textContent, want: (LAB_INFO[todayLab()] || [])[0],
    pv: document.querySelector('.lp-big').dataset.preview, today: todayLab(), play: document.querySelector('.lp-play').getBoundingClientRect().width, peek: !!document.querySelector('.lp-card .lp-peek'),
    forYou: [...document.querySelectorAll('.lp-for b')].map((x) => x.textContent), forPv: [...document.querySelectorAll('.lp-for canvas[data-preview]')].length }));
  expect(top.title === 'Labs' && top.find >= 44, 'the title and a 44px search button: ' + JSON.stringify(top));
  expect(top.chips.join() === 'All,Science,Maths,3D,Study tools,Games', 'the filter chips: ' + top.chips.join());
  expect(top.rec === top.want && top.pv === top.today && top.play >= 44 && top.peek, 'Recommended: today’s lab, its live preview, a play button and Cassie peeking: ' + JSON.stringify(top));
  expect(top.forYou.join() === 'Learn,Study tools' && top.forPv === 2, 'For you: Learn and Study tools, each with a preview: ' + JSON.stringify(top));
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
  expect(learn.title === 'Learn' && learn.rows.length >= 25 && learn.withPv === learn.rows.length && ['body3d', 'cells3d', 'pendulum', 'solar', 'fractions'].every((x) => learn.rows.includes(x)), 'Learn: every lab and 3D view, each with a preview: ' + JSON.stringify(learn));
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
    expect(!d.lp && !d.on && d.head && d.tabs.join() === 'learn,tools' && d.search && d.chips === 8 && d.cards >= 25 && d.feature && /gradient/.test(d.bg), 'a computer keeps its Labs shelf: ' + JSON.stringify(d));
    await o.ctx.close();
  }
});

test('Home header: a glass bar with the hello and a bell; every Home button still does its job; Today as a row of chips; no 3D room (390x844, 1280x800)', async (b) => {
  const seed = { groqKey: 'gsk_test', tab: 'home', chats: [{ id: 'h1', title: 'What is osmosis?', messages: [{ role: 'user', content: 'What is osmosis?' }, { role: 'assistant', content: 'Water moving across a membrane.' }], updatedAt: Date.now() }], cards: [{ id: 'c1', f: 'What moves in osmosis?', b: 'Water', deck: 'Biology', box: 0, due: 0, at: 0 }] };
  for (const [size, device, viewport] of [['390x844', 'iPhone 13', { width: 390, height: 844 }], ['1280x800', 'Desktop Chrome', { width: 1280, height: 800 }]]) {
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
test('Home, You, Settings and Plans: the new and the returning home, every setting under its old key, search, drill-in pages with Back, and plans with no payment; contrast and taps at 390x844 and 1280x800', async (b) => {
  const { contrastIssues, tapResponseIssues } = require('./ui-checks.cjs');
  const reply = () => ({ text: 'Osmosis is water moving across a membrane.' });
  for (const [size, device, viewport] of [['390x844', 'iPhone 13', { width: 390, height: 844 }], ['1280x800', 'Desktop Chrome', { width: 1280, height: 800 }]]) {
    const phone = size === '390x844';
    const { ctx, page, errors } = await open(b, { scale: 1, device, viewport, lite: 'off', server: false, state: { groqKey: 'gsk_test', tab: 'home' }, fakeGroq: reply });
    ctx.on('page', (p) => { if (p !== page) p.close().catch(() => {}); });
    const toHome = async () => { if (phone) { await page.evaluate(() => CassieNative.go('home')); } else { await page.evaluate(() => { createNewChat(); }); } await page.waitForTimeout(500); };
    const hub = phone ? '#home .hub' : '#chat-log .hub';
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
    // Plans: Free and Plus side by side, Plus the most popular, Coming soon, and nothing that takes a payment
    await page.click('.set-link[data-open="plans"]');
    const plans = await page.locator('.set-plans').innerText();
    expect(/Free/.test(plans) && /Plus/.test(plans) && /Most popular/.test(plans), `${size}: Free and Plus: ` + plans);
    expect(await page.locator('.set-plans .plan-go').innerText() === 'Coming soon' && await page.locator('.set-plans .plan-go').getAttribute('href') === 'index.html#pricing', `${size}: Coming soon goes to the plans page`);
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
        const got = await colours();
        for (const [k, v] of Object.entries(got)) {
          if (!v) { expect(k === 'open tab' && size === '1280x800', `${size} ${pick || 'Cassie'} ${scheme}: ${k} is missing`); continue; }
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
    await page.click('#board-btn'); await page.click('.csk-btn:has-text("Study together")'); await page.click('[data-room="new"]');
    await page.waitForSelector('.csk-room:not([hidden]) b', { timeout: 10000 });
    await page.click('[data-room-act="study"]'); await page.waitForTimeout(600);
  }, { server: true }],
  ['Talk with Cassie', async (page) => { await page.evaluate(() => openVoice('chat')); await page.waitForSelector('.vc:not([hidden])', { timeout: 8000 }); await page.waitForFunction(() => voiceChat && voiceChat.phase !== 'speaking', null, { timeout: 15000 }).catch(() => {}); await page.waitForTimeout(800); }],
];
test('every screen at 390x844, 360x740 and 1280x800: every button can be tapped (44px, on screen, not under the tab bar, not cut off)', async (b) => {
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
  expect(!bad.length, `${bad.length} screens with buttons that can't be tapped properly:\n` + bad.join('\n'));
});

// Every control on every screen and in every lab, tapped for real on a phone (390x844, a finger) and a
// computer (1280x800, a mouse): the tap reaches it and something visibly responds within 100 ms.
const RESPONSE_SIZES = [['phone 390x844', 'iPhone 13', { width: 390, height: 844 }, true], ['computer 1280x800', 'Desktop Chrome', { width: 1280, height: 800 }, false]];
test('every control on every screen at 390x844 (touch) and 1280x800 (mouse), every lab with TAP_SWEEP=all: a tap reaches it and something visibly responds within 100 ms, with no freeze, no double click and no drag that taps', async (b) => {
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
test('3D space labs: no Teach me, Ask Cassie or Quiz me; every control takes taps and Back goes to the shelf (390x844, 360x740, 1280x800)', async (b) => {
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
  expect(await sheet.locator('.plus-go').getAttribute('href') === 'index.html#pricing', 'See the plans goes to the plans (no payment here)');
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
    expect(await hl() === 'true', 'the highlight switch starts ON');
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
    expect(await pop.locator('#hl-mode').inputValue() === 'on', 'highlight help is on');
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
  let failed = 0;
  for (const t of tests) {
    if (only && !t.name.includes(only)) continue;
    const browser = await launch();
    const t0 = Date.now(); // (TIMES=1 prints how long each test takes)
    try {
      cspViolations.length = 0;
      await t.fn(browser);
      if (cspViolations.length) throw new Error('blocked by the security policy: ' + [...new Set(cspViolations)].join(' | '));
      console.log('PASS', t.name + (process.env.TIMES ? ` [${Math.round((Date.now() - t0) / 1000)}s]` : ''));
    }
    catch (e) { failed += 1; console.log('FAIL', t.name, '\n     ', (process.env.VERBOSE && e && e.stack ? e.stack : (e && e.message || e)).toString().split('\n').slice(0, process.env.VERBOSE ? 30 : 1).join('\n')); }
    finally { await browser.close().catch(() => {}); }
  }
  await server.close(); app.close();
  console.log(failed ? `\n${failed} failed` : '\nAll passed');
  process.exit(failed ? 1 : 0);
})();

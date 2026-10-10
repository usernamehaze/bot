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
async function open(browser, { server = true, state = {}, fakeGroq, lite = 'on', device = 'Pixel 7' } = {}) {
  const ctx = await browser.newContext({ ...devices[device], acceptDownloads: true });
  const seed = state && { profile: PROFILE, seenVersion: APP_VERSION, analytics: { usage: true, topics: false }, lite, ...state };
  await ctx.addInitScript(([srv, seedJson]) => {
    window.CASSIE_SERVER = srv; // '' = no server (never the real one in tests)
    if (seedJson && !sessionStorage.getItem('seeded')) { localStorage.setItem('cassie.v2', seedJson); sessionStorage.setItem('seeded', '1'); }
  }, [server ? SERVER : '', seed ? JSON.stringify(seed) : '']);
  await ctx.route(/pollinations\.ai/, (route) => route.fulfill({ body: PNG, contentType: 'image/png' }));
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await ctx.route(/workers\.dev/, (route) => route.abort()); // never touch the real Cassie server
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
// the 3D models are opened from Labs (the 3D shelf)
async function open3d(page, id) {
  await page.click('#labs-btn');
  await page.waitForSelector('.labs:not([hidden]) .labs-card', { timeout: 20000 });
  await page.click('.labs-chips [data-subject="3d"]');
  await page.click(`.labs-grid [data-lab="${id}"]`);
}
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

test('sign-up shows on first open and saves the profile', async (b) => {
  const { ctx, page } = await open(b, { state: null });
  await page.waitForSelector('.auth-page', { timeout: 5000 }); // with a server: sign-in page first
  await page.click('.auth-skip');
  await page.waitForSelector('.profile-overlay', { timeout: 5000 });
  // just four questions: name (nickname), age, level, gender
  expect(await page.locator('.profile-card input, .profile-card select').count() === 3 && await page.locator('.profile-card [data-gender]').count() === 3, 'the profile should ask only name, age, level and gender');
  expect(!(await page.locator('.profile-card [data-role], .profile-card input[name=field]').count()), 'no student/professional or job questions');
  await page.fill('.profile-card input[name=name]', 'Hazel');
  await page.fill('.profile-card input[name=age]', '15');
  await page.selectOption('.profile-card select[name=grade]', 'Grade 10');
  await page.click('.profile-card .pf-go');
  expect(/gender/.test(await page.locator('.pf-err').textContent()), 'gender is asked for');
  await page.click('.profile-card [data-gender=female]');
  await page.click('.profile-card .pf-go');
  await page.waitForSelector('.profile-overlay', { state: 'detached' });
  const p = await page.evaluate(() => JSON.parse(localStorage.getItem('cassie.v2')).profile);
  expect(p && p.name === 'Hazel' && p.grade === 'Grade 10' && p.age === 15 && p.gender === 'female' && p.role === 'student', 'profile not saved: ' + JSON.stringify(p));
  await ctx.close();
});

test('every age is welcome: nursery to work, with an account too', async (b) => {
  const { ctx, page } = await open(b, { state: null });
  await page.waitForSelector('.auth-page');
  expect(await page.locator('.auth-hero svg.cassie-bot').count() === 1 && !(await page.locator('img[src*="cassie-hero"]').count()), 'the sign-in page shows Cursor Cassie, not the 3D picture');
  expect(!/13 and up/.test(await page.locator('.auth-page').innerText()), 'no age limit on the sign-in page');
  const signupStatus = (body) => page.evaluate(async ([srv, bb]) => (await fetch(srv + '/auth/signup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(bb) })).status, [SERVER, body]);
  expect(await signupStatus({ email: `kid${Date.now()}@example.com`, password: 'secret-pass-1', age: 6 }) === 200, 'a 6-year-old can make an account');
  await page.click('.auth-skip');
  await page.waitForSelector('.profile-overlay');
  const levels = await page.$$eval('.profile-card select[name=grade] option', (o) => o.map((x) => x.textContent));
  expect(levels.includes('Nursery') && levels.includes('Kindergarten') && levels.includes('Grade 1') && levels.includes('4th year college') && levels.includes('Working professional'), 'levels go from nursery to work: ' + levels);
  await page.fill('.profile-card input[name=name]', 'Mia');
  await page.fill('.profile-card input[name=age]', '4');
  await page.selectOption('.profile-card select[name=grade]', 'Nursery');
  await page.click('.profile-card [data-gender=none]');
  await page.click('.profile-card .pf-go');
  await page.waitForSelector('.profile-overlay', { state: 'detached' });
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
  await page.waitForSelector('.auth-page');
  expect(await page.locator('.auth-title').textContent() === 'Create your Cassie account', 'should open on sign up');
  await page.fill('.auth-form input[name=email]', email);
  const signupStatus = (body) => page.evaluate(async ([srv, b]) => (await fetch(srv + '/auth/signup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).status, [SERVER, body]);
  expect(await signupStatus({ email: 'x@mailinator.com', password: 'secret-pass-1', age: 20 }) === 400, 'throwaway email allowed');
  await page.fill('.auth-form input[name=age]', '16');
  await page.fill('.auth-form input[name=password]', 'short');
  await page.click('.auth-go');
  expect(/8 characters/.test(await page.locator('.auth-err').textContent()), 'short password not caught');
  await page.fill('.auth-form input[name=password]', 'secret-pass-1');
  await page.click('.auth-go');
  await page.waitForSelector('.profile-overlay', { timeout: 5000 });
  await page.fill('.profile-card input[name=name]', 'Hazel');
  await page.selectOption('.profile-card select[name=grade]', 'Grade 11');
  await page.fill('.profile-card input[name=age]', '16');
  await page.click('.profile-card [data-gender=female]');
  await page.click('.profile-card .pf-go');
  await page.evaluate(() => syncAccount(true));
  await page.waitForTimeout(800);
  await ctx.close();
  // device 2: sign in → the profile comes back, no questions asked
  ({ ctx, page } = await open(b, { state: null }));
  await page.waitForSelector('.auth-page');
  await page.click('.auth-switch [data-to=signin]');
  await page.fill('.auth-form input[name=email]', email);
  await page.fill('.auth-form input[name=password]', 'wrong-password');
  await page.click('.auth-go');
  await page.waitForSelector('.auth-err:not([hidden])');
  expect(/don’t match/.test(await page.locator('.auth-err').textContent()), 'wrong password not caught');
  await page.fill('.auth-form input[name=password]', 'secret-pass-1');
  await page.click('.auth-go');
  await page.waitForSelector('.auth-page', { state: 'detached' });
  const p = await page.evaluate(() => state.profile);
  expect(p && p.name === 'Hazel' && p.grade === 'Grade 11', 'profile did not come back: ' + JSON.stringify(p));
  expect(await page.locator('.profile-overlay').count() === 0, 'asked the profile questions again');
  await page.click('#settings-btn');
  expect(/Signed in as/.test(await page.locator('#account-row').textContent()), 'settings should say signed in');
  await ctx.close();
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
  await page.click('#settings-btn');
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
  expect(/futuristic city/.test(m.lastImagePrompt || ''), 'server did not get the prompt: ' + m.lastImagePrompt);
  await ctx.close();
});

test('flashcards: Cassie makes cards from an answer, spaced-repetition study, mistakes → cards, Anki export', async (b) => {
  const ANSWER = 'Photosynthesis is how plants make food. Chlorophyll in the chloroplasts captures sunlight. Water and carbon dioxide become glucose, and oxygen is released as a by-product of the light reactions.';
  const CARDS = JSON.stringify([{ front: 'Where does photosynthesis happen?', back: 'In the chloroplasts.' }, { front: 'What does chlorophyll do?', back: 'It captures sunlight.' }, { front: 'What gas is released?', back: 'Oxygen.' }]);
  const { ctx, page, errors, groqCalls } = await open(b, { server: false, state: { groqKey: 'gsk_test', mistakes: [{ q: 'What is the powerhouse of the cell?', a: 'mitochondria', at: 1, due: 1, misses: 1 }] },
    fakeGroq: (body) => ({ text: /Make flashcards/.test(JSON.stringify(body)) ? 'Here you go:\n' + CARDS : ANSWER }) });
  const a = await ask(page, 'Explain photosynthesis');
  await a.locator('.fc-make').click();
  await page.waitForFunction(() => /3 cards — Study/.test(document.querySelector('.fc-make').textContent), null, { timeout: 10000 });
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
    await A.page.click('.csk-btn:has-text("Draw together")');
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
    await A.page.waitForSelector('.room-err:not([hidden]) >> text=No room with that code', { timeout: 5000 });
    expect(A.errors.length === 0 && B.errors.length === 0, 'page errors: ' + A.errors.concat(B.errors).join('; '));
  } finally { await A.ctx.close(); await B.ctx.close(); }
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
  await page.waitForSelector('#mascot.has2d svg.cassie-bot', { timeout: 5000 });
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
  await page.waitForSelector('#island.live svg.cassie-bot', { timeout: 3000 });
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

test('Explore 3D: turn a cell, tap a part, ask Cassie about it, then quiz on the plant cell', async (b) => {
  const { ctx, page, errors, groqCalls } = await open(b, { server: false, state: { groqKey: 'gsk_test' }, fakeGroq: () => ({ text: 'The Golgi apparatus packages proteins, like a post office.' }) });
  await open3d(page, 'cells3d');
  await page.waitForSelector('.x3d:not([hidden])', { timeout: 20000 });
  await page.click('.x3d-switch [data-cell="animal"]');
  await page.waitForSelector('.x3d-chip[data-part="nucleus"]', { timeout: 20000 });
  const chips = await page.$$eval('.x3d-chip', (c) => c.map((x) => x.dataset.part));
  for (const id of ['membrane', 'nucleus', 'nucleolus', 'rer', 'ser', 'golgi', 'mito', 'ribosome', 'lysosome', 'centrioles']) expect(chips.includes(id), 'animal cell is missing ' + id + ': ' + chips);
  expect(!chips.includes('chloroplast') && !chips.includes('wall'), 'an animal cell has no chloroplasts or wall');
  // tapping the 3D picture picks the part under the finger
  await page.waitForTimeout(800);
  const at = await page.evaluate(() => { const el = document.querySelector('.x3d-label[data-part="nucleolus"]'); const m = /translate\(([\d.]+)px, ([\d.]+)px\)/.exec(el.style.transform); return { x: +m[1], y: +m[2] }; });
  await page.click('.x3d-tools [data-tool="reset"]');
  // a small drag stops the slow spin (like a finger would), so the nucleus stays where we measure it
  const cb = await page.locator('.x3d-canvas').boundingBox();
  await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height * 0.8);
  await page.mouse.down(); await page.mouse.move(cb.x + cb.width / 2 + 12, cb.y + cb.height * 0.8, { steps: 3 }); await page.mouse.up();
  await page.waitForTimeout(1500);
  const at2 = await page.evaluate(() => { const el = document.querySelector('.x3d-label[data-part="nucleolus"]'); const m = /translate\(([\d.]+)px, ([\d.]+)px\)/.exec(el.style.transform); return { x: +m[1], y: +m[2] }; });
  await page.mouse.click(at2.x, at2.y);
  await page.waitForSelector('.x3d-sheet:not([hidden])', { timeout: 10000 });
  expect(/Nucleolus|Nucleus|Nuclear envelope/.test(await page.locator('.x3d-sheet h3').innerText()), 'tapping the nucleus area picks it: ' + await page.locator('.x3d-sheet h3').innerText() + JSON.stringify(at));
  // pick from the list, read about it, ask Cassie
  await page.click('.x3d-chip[data-part="golgi"]');
  expect(/Golgi apparatus/.test(await page.locator('.x3d-sheet h3').innerText()) && /post office/.test(await page.locator('.x3d-sheet').innerText()), 'the Golgi card should show');
  if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/explore-golgi.png' });
  await page.click('.x3d-act[data-act="ask"]');
  await page.waitForSelector('#chat-log .bubble-assistant >> text=post office', { timeout: 15000 });
  expect(await page.locator('.x3d').isHidden(), 'the viewer closes so the answer shows');
  expect(/golgi apparatus of an animal cell/i.test(JSON.stringify(groqCalls.at(-1))), 'Cassie is asked about the Golgi of an animal cell');
  // plant cell → quiz
  await open3d(page, 'cells3d');
  await page.click('.x3d-switch [data-cell="plant"]');
  await page.waitForSelector('.x3d-chip[data-part="chloroplast"]', { timeout: 10000 });
  const plant = await page.$$eval('.x3d-chip', (c) => c.map((x) => x.dataset.part));
  for (const id of ['wall', 'vacuole', 'chloroplast', 'plasmodesmata', 'nucleus', 'mito']) expect(plant.includes(id), 'plant cell is missing ' + id);
  expect(!plant.includes('centrioles'), 'a plant cell shows no centrioles');
  await page.click('.x3d-chip[data-part="chloroplast"]');
  expect(/photosynthesis/.test(await page.locator('.x3d-sheet').innerText()) && /Only in plant cells/.test(await page.locator('.x3d-sheet').innerText()), 'the chloroplast card');
  await page.click('.x3d-act[data-act="quiz"]');
  await page.waitForFunction(() => document.getElementById('quiz-btn').classList.contains('active'), null, { timeout: 5000 });
  expect(/Quiz me on: the parts of a plant cell/.test(JSON.stringify(groqCalls.at(-1))), 'the quiz is about the plant cell');
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

test('Cassie’s voice is Bella (or Michael) — never a robot voice, and she never makes you wait for the download', async (b) => {
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
  expect(await page.locator('.vc-hv').isHidden(), 'the download note goes away when she is ready');
  expect(await page.evaluate(() => window.CassieVoice.info().isolated), 'her voice uses several cores');
  // now she answers in Bella's voice
  await page.waitForFunction(() => document.querySelector('.vc').dataset.phase === 'listening', null, { timeout: 5000 });
  await page.evaluate(() => window.__say('What do mitochondria do?'));
  await page.waitForFunction(() => window.__said.some((x) => /powerhouse/.test(x.text)), null, { timeout: 15000 });
  const said = await page.evaluate(() => window.__said);
  expect(said.every((x) => x.voice === 'af_bella'), 'the woman’s voice is Bella, like the explainer video: ' + JSON.stringify(said.map((x) => x.voice)));
  expect(said[0].text.length <= 75, 'her first piece is short, so she starts talking quickly: ' + said[0].text);
  await page.waitForFunction(() => document.querySelector('.vc').dataset.phase === 'listening', null, { timeout: 8000 });
  expect(await page.evaluate(() => window.__played) >= 1, 'the voice made by the model was played');
  // the man's voice
  await page.click('.vc-gender [data-gender="man"]');
  await page.waitForFunction(() => window.__said.some((x) => x.voice === 'am_michael' && /my voice now/.test(x.text)), null, { timeout: 8000 });
  await page.click('.vc-gender [data-gender="woman"]');
  await page.click('.vc-x');
  // Settings → Voice: she's ready, and a sample plays
  await page.click('#settings-btn');
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
  expect(await page.evaluate(() => window.__spoken.length) === 0, 'the robot voice was never used: ' + JSON.stringify(await page.evaluate(() => window.__spoken)));
  expect(errors.length === 0, 'page errors: ' + errors.join('; '));
  await ctx.close();

  // a phone on mobile data is asked first; if her voice can't load, her answers show as text — still no robot voice
  const c2 = await open(b, { server: false, state: { groqKey: 'gsk_test', hearing: 'fast' }, fakeGroq: () => ({ text: 'Sure.' }) });
  await c2.ctx.addInitScript(FAKE_VOICE, {});
  await c2.page.reload();
  await c2.page.click('#voice-btn');
  await c2.page.waitForSelector('.vc-hv:not([hidden]) >> text=Get Cassie’s voice?', { timeout: 5000 });
  expect(await c2.page.evaluate(() => window.CassieVoice.status()) === 'off', 'nothing downloads on a phone until asked');
  if (process.env.SHOTS) await c2.page.screenshot({ path: process.env.SHOTS + '/voice-human-ask.png' });
  await c2.page.click('.vc-hv [data-hv="get"]');
  await c2.page.waitForSelector('.vc-hv:not([hidden]) >> text=Couldn’t get Cassie’s voice', { timeout: 20000 });
  await c2.page.waitForFunction(() => document.querySelector('.vc').dataset.phase === 'listening', null, { timeout: 8000 });
  await c2.page.evaluate(() => window.__say('Hello'));
  await c2.page.waitForFunction(() => document.querySelector('.vc-cassie').textContent === 'Sure.', null, { timeout: 10000 });
  await c2.page.waitForFunction(() => document.querySelector('.vc').dataset.phase === 'listening', null, { timeout: 8000 });
  expect(await c2.page.evaluate(() => window.__spoken.length) === 0, 'no robot voice, even when her voice can’t load');
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

test('Explore 3D: the human body — 10 systems, tap or find a part to learn what it is, a girl’s body, ask Cassie', async (b) => {
  const { ctx, page, errors, groqCalls } = await open(b, { server: false, state: { groqKey: 'gsk_test' }, fakeGroq: (body) => ({ text: /two short sentences/.test(JSON.stringify(body)) ? 'The **hepatic artery** brings oxygen-rich blood to the liver.' : 'The femur is the thigh bone, the longest bone in the body.' }) });
  await open3d(page, 'body3d');
  await page.waitForSelector('.x3d:not([hidden]) .x3d-sys', { timeout: 20000 });
  expect(await page.locator('.labs').isHidden(), 'Labs steps aside while the 3D body is open');
  expect(await page.locator('.x3d-switch [data-cell="body"]').getAttribute('aria-selected') === 'true', 'the 3D card opens the human body');
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
  await page.waitForSelector('#chat-log .bubble-assistant >> text=thigh bone', { timeout: 15000 });
  expect(/Explain the Femur.*Os femoris.*musculoskeletal system/i.test(JSON.stringify(groqCalls.at(-1))), 'Cassie is asked about the femur by its real name');
  expect(errors.length === 0, 'page errors: ' + errors.join('; '));
  await ctx.close();
});

test('Explore 3D body like an atlas: Front/Back/Side views, spread every piece apart and back, structure count, which-way letters', async (b) => {
  const { ctx, page, errors } = await open(b, { server: false, state: { groqKey: 'gsk_test' }, device: process.env.DEVICE || 'Pixel 7' });
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
  await page.click('#labs-btn');
  await page.waitForSelector('.labs:not([hidden]) .labs-card', { timeout: 20000 });
  await page.click('.labs-tabs [data-section="games"]');
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
  const { ctx, page, errors, groqCalls } = await open(b, { server: false, state: { groqKey: 'gsk_test' }, device: process.env.DEVICE || 'Pixel 7', fakeGroq: () => ({ text: 'At 45 degrees the ball goes farthest because the speed is split evenly between up and forward.' }) });
  const shot = (n) => process.env.SHOTS && page.screenshot({ path: process.env.SHOTS + '/' + n + '.png' });
  await page.click('#labs-btn');
  await page.waitForSelector('.labs:not([hidden]) .labs-card', { timeout: 20000 });
  // two shelves: Learn (simulations, 3D, atlas) and Games & puzzles
  const learn = await page.$$eval('.labs-grid .labs-card', (c) => c.map((x) => x.dataset.lab));
  expect(!learn.includes('sudoku') && learn.includes('pendulum'), 'Learn has the simulations, not the puzzles: ' + learn);
  await page.click('.labs-tabs [data-section="games"]');
  const games = await page.$$eval('.labs-grid .labs-card', (c) => c.map((x) => x.dataset.lab));
  expect(games.includes('sudoku') && !games.includes('pendulum'), 'Games has the puzzles: ' + games);
  expect(await page.locator('.labs-chips').isHidden(), 'the subject chips are for the Learn shelf');
  await page.click('.labs-tabs [data-section="learn"]');
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
    await page.click(`.labs-tabs [data-section="${games.includes(id) ? 'games' : 'learn'}"]`);
    await page.click(`.labs-grid [data-lab="${id}"]`);
    await page.waitForSelector(`.lab-view:not([hidden])[data-lab="${id}"] .lab-controls > *`, { timeout: 8000 });
    expect(await page.locator('.lab-stage canvas, .lab-stage .lab-balance, .lab-stage .lab-units, .lab-stage .puz-sudoku, .lab-stage .puz-eq').count() >= 1, id + ' draws something');
    expect(await page.locator('.lab-about').isVisible(), id + ' says how its model works');
    // tap the middle of the picture (nothing should break)
    const sb0 = await page.locator('.lab-stage').boundingBox();
    await page.mouse.click(sb0.x + sb0.width / 2, sb0.y + sb0.height / 2);
    await page.waitForTimeout(250);
    expect(errors.length === 0, `${id}: page errors: ` + errors.join('; '));
    await page.click('.lab-back');
  }
  // “Try this” goals are buttons: a tap shows the hint
  await page.click('.labs-tabs [data-section="learn"]');
  await page.click('.labs-grid [data-lab="pendulum"]');
  await page.click('.lab-try >> nth=0');
  expect(await page.locator('.lab-hint >> nth=0').isVisible() && /1 m/.test(await page.locator('.lab-hint >> nth=0').innerText()), 'tapping a goal shows its hint');
  await page.click('.lab-nudge');
  await page.waitForFunction(() => document.querySelector('.lab-nudge-text') && !document.querySelector('.lab-nudge-text').classList.contains('muted') && document.querySelector('.lab-nudge-text').textContent.length > 10, null, { timeout: 15000 });
  expect(await page.locator('.labs').isVisible(), 'Cassie’s nudge appears inside the lab');
  await page.click('.lab-back');
  // the function lab: x^2 − 4, tap the middle → slope 0 → the first goal ticks
  await page.click('[data-lab="function"]');
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
  await page.click('[data-lab="balance"]');
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
  await page.click('[data-lab="punnett"]');
  expect(/3 : 1/.test(await page.locator('.lab-stats').innerText()), 'Yy × Yy gives 3 : 1');
  await page.click('.lab-seg button:has-text("Two genes")');
  expect(/9 : 3 : 3 : 1/.test(await page.locator('.lab-stats').innerText()), 'YyRr × YyRr gives 9 : 3 : 3 : 1');
  await page.click('text=Grow 100 offspring');
  expect(/100 grown/.test(await page.locator('.lab-stats').innerText()), 'a hundred offspring are grown');
  await shot('lab-punnett');
  await page.click('.lab-back');
  // pH: 10 mL acid then 10 mL base = neutral
  await page.click('[data-lab="ph"]');
  await page.locator('.lab-group:has-text("Acid") button:has-text("+ 10 mL")').click();
  expect(/acidic/.test(await page.locator('.lab-stats').innerText()), 'acid makes it acidic');
  await page.locator('.lab-group:has-text("Base") button:has-text("+ 10 mL")').click();
  expect(/pH\s*7\.00/.test(await page.locator('.lab-stats').innerText()) && /done/.test(await page.locator('.lab-tries li').first().getAttribute('class')), 'equal acid and base is neutral: ' + await page.locator('.lab-stats').innerText());
  await shot('lab-ph');
  await page.click('.lab-back');
  // the atom: carbon-12 is built at the start
  await page.click('[data-lab="atom"]');
  expect(/Carbon \(C\)/.test(await page.locator('.lab-stats').innerText()) && /carbon-12/.test(await page.locator('.lab-stats').innerText()), 'six of each is carbon-12');
  await page.click('.lab-chips >> text=Chloride Cl⁻');
  expect(/negative ion/.test(await page.locator('.lab-stats').innerText()), 'chloride is a negative ion');
  await shot('lab-atom');
  await page.click('.lab-back');
  // launch: drag on the picture to aim, then 45° from the ground and the big Launch button on the picture
  await page.click('[data-lab="projectile"]');
  const pb = await page.locator('.lab-stage').boundingBox();
  await page.mouse.move(pb.x + pb.width * 0.4, pb.y + pb.height * 0.4); await page.mouse.down(); await page.mouse.move(pb.x + pb.width * 0.5, pb.y + pb.height * 0.3, { steps: 4 }); await page.mouse.up();
  expect(await page.locator('.lab-sl:has-text("Angle") output').innerText() !== '40°', 'dragging on the picture aims the launcher');
  await page.locator('.lab-sl:has-text("Angle") input').fill('45');
  await page.click('.lab-overlay .lab-btn:has-text("Launch")');
  await page.waitForFunction(() => /Landed|Hit/.test(document.querySelector('.lab-note').textContent), null, { timeout: 8000 });
  expect(/done/.test(await page.locator('.lab-tries li').first().getAttribute('class')), '45° from the ground ticks the farthest-angle goal');
  await shot('lab-projectile');
  await page.click('.lab-ask');
  await page.waitForSelector('#chat-log .bubble-assistant >> text=45 degrees', { timeout: 15000 });
  expect(await page.locator('.labs').isHidden(), 'Labs closes so the answer shows');
  const asked = JSON.stringify(groqCalls.at(-1));
  expect(/Launch lab/.test(asked) && /45°/.test(asked) && /m\/s/.test(asked) && /flies/.test(asked), 'Cassie is told what is on the screen: ' + asked.slice(0, 400));
  // goals are remembered on the shelf
  await page.click('#labs-btn');
  await page.waitForSelector('.labs:not([hidden]) .labs-card');
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
  const { ctx, page, errors } = await open(b, { state: { groqKey: 'gsk_test', profile: { name: 'Hazel' } }, device: process.env.DEVICE || 'Pixel 7' });
  const shot = (n) => process.env.SHOTS && page.screenshot({ path: process.env.SHOTS + '/' + n + '.png' });
  await page.click('#labs-btn');
  await page.waitForSelector('.labs:not([hidden]) .labs-card', { timeout: 20000 });
  await page.click('.labs-tabs [data-section="games"]');
  await page.waitForSelector('.labs-board:not([hidden])', { timeout: 5000 });
  expect(/Be the first today|playing today/.test(await page.locator('.labs-board').innerText()), 'the score board shows on the shelf');
  // solve today's Laser mirrors puzzle by trying mirror turns (the real path exists)
  await page.click('.labs-grid [data-lab="mirrors"]');
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
  await page.click('.labs-grid [data-lab="sudoku"]');
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
  await page.click('.labs-grid [data-lab="equation"]');
  for (const k of '1+1=3000'.split('')) await page.click(`.eq-keys [data-k="${k}"]`);
  await page.click('.eq-keys [data-k="enter"]');
  expect(/isn’t true|just a number|8 symbols/.test(await page.locator('.eq-warn').innerText()), 'a wrong equation is refused: ' + await page.locator('.eq-warn').innerText());
  await shot('puzzle-equation');
  await page.click('.lab-back');
  // geography: the map loads and a round can be answered
  await page.click('.labs-grid [data-lab="geography"]');
  await page.waitForSelector('.geo-opts button');
  await page.click('.geo-opts button >> nth=0');
  await page.waitForSelector('.geo-next');
  await page.waitForTimeout(500);
  await shot('puzzle-geography');
  expect(errors.length === 0, 'page errors: ' + errors.join('; '));
  await ctx.close();
});

test('Labs: goals tick only when you do them (and you can untick), colour names, flipping coins, any-size shapes, bigger puzzles, find a country', async (b) => {
  const { ctx, page, errors } = await open(b, { server: false, state: { groqKey: 'gsk_test' }, device: process.env.DEVICE || 'Pixel 7' });
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
  await shot('lab-goals');
  await page.click('.lab-back');
  // colour: a named colour, its name, and the hex
  await page.click('.labs-grid [data-lab="colour"]');
  await page.click('.lab-colour-chips [aria-label="Mustard"]');
  expect(/Mustard/.test(await page.locator('.lab-swatch').innerText()) && /#FFDB58/.test(await page.locator('.lab-swatch').innerText()), 'the swatch says the colour’s name and hex: ' + await page.locator('.lab-swatch').innerText());
  await page.locator('.lab-sl:has-text("Blue") input').fill('255');
  expect(/Name/.test(await stats()) && /Looks/.test(await stats()), 'the name and a plain description are listed: ' + await stats());
  await shot('lab-colour-names');
  await page.click('.lab-back');
  // chance: the coin flips through the air, then the count goes up
  await page.click('.labs-grid [data-lab="chance"]');
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
  await page.click('.labs-grid [data-lab="solids"]');
  expect(await page.locator('.lab-group:has(h4:text-is("Shape")) .lab-seg button').count() === 13, '13 shapes');
  await page.click('.lab-seg button:has-text("Torus")');
  await page.locator('.lab-sl:has-text("Ring radius") input[type=number]').fill('12.5');
  await page.locator('.lab-sl:has-text("Tube radius") input[type=number]').fill('3');
  expect(/2π² R r²\s*=\s*2,?221/.test(await stats()), 'torus volume 2π²·12.5·3² ≈ 2,221: ' + await stats());
  await shot('lab-torus');
  await page.click('.lab-back');
  // puzzles: more sizes, and a new puzzle any time
  await page.click('.labs-tabs [data-section="games"]');
  await page.click('.labs-grid [data-lab="sudoku"]');
  await page.click('.lab-seg button:has-text("12 × 12")');
  expect(await page.locator('.sdk-c').count() === 144 && await page.locator('.sdk-pad [data-d="12"]').count() === 1, 'a 12 × 12 sudoku with 1–12');
  const first = await page.$$eval('.sdk-c', (c) => c.map((x) => x.textContent).join(','));
  await page.click('.puz-head .lab-btn:has-text("New puzzle")');
  expect(await page.$$eval('.sdk-c', (c) => c.map((x) => x.textContent).join(',')) !== first && /Practice/.test(await page.locator('.puz-day').innerText()), 'New puzzle makes a different one');
  await shot('puzzle-sudoku-12');
  await page.click('.lab-back');
  for (const [id, label] of [['nonogram', '20 × 20'], ['hashi', 'Huge'], ['pipes', '10 × 10'], ['mirrors', '11 × 11']]) {
    await page.click(`.labs-grid [data-lab="${id}"]`);
    await page.click(`.lab-seg button:has-text("${label}")`);
    await page.waitForTimeout(150);
    await shot('puzzle-' + id + '-big');
    expect(errors.length === 0, id + ': ' + errors.join('; '));
    await page.click('.lab-back');
  }
  // geography: find a country by tapping it on the map
  await page.click('.labs-grid [data-lab="geography"]');
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

test('Labs 3D and atlas: fly to Jupiter and out to Andromeda, launch a 3D rocket, look up Japan and a place; pour, drag particles and disks', async (b) => {
  const { ctx, page, errors } = await open(b, { server: false, state: { groqKey: 'gsk_test' }, device: process.env.DEVICE || 'Pixel 7' });
  const shot = (n) => process.env.SHOTS && page.screenshot({ path: process.env.SHOTS + '/' + n + '.png' });
  // space: the planets, then the Local Group
  await page.goto(APP + '?lab=space3d');
  await page.waitForSelector('.lab3d-label:not([hidden])', { timeout: 30000 });
  await page.locator('.lab3d-label:not([hidden]):text-is("Jupiter")').click({ force: true });
  await page.waitForSelector('.space-card h3:text-is("Jupiter")');
  expect(/Distance from Earth now/.test(await page.locator('.space-card').innerText()) && /95 known/.test(await page.locator('.space-card').innerText()), 'Jupiter’s card has live distances and its moons');
  await page.waitForTimeout(1200); await shot('space-jupiter');
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
  // tapping a country on the map
  const ab = await page.locator('.lab-stage canvas').boundingBox();
  await page.click('.lab-overlay .lab-btn:has-text("Whole world")');
  await page.mouse.click(ab.x + ab.width * 0.25, ab.y + ab.height * 0.4);
  await page.waitForTimeout(400); await shot('atlas-tap');
  // pH: tap the acid bottle for a drop
  await page.goto(APP + '?lab=ph');
  await page.waitForSelector('.lab-stage canvas');
  const pb = await page.locator('.lab-stage canvas').boundingBox();
  await page.mouse.click(pb.x + 52, pb.y + 40);
  await page.waitForFunction(() => /Acid added[\s\S]*0\.05 mL/.test(document.querySelector('.lab-stats').textContent), null, { timeout: 3000 });
  // drag the base bottle over the beaker and hold it there: it pours
  await page.mouse.move(pb.x + 30 + Math.min(170, pb.width * 0.32) - 22, pb.y + 40); await page.mouse.down();
  await page.mouse.move(pb.x + 110, pb.y + 90, { steps: 4 }); await page.waitForTimeout(900); await page.mouse.up();
  expect(!/Base added[\s\S]*\b0 mL/.test(await page.locator('.lab-stats').innerText()), 'pouring the base adds base: ' + await page.locator('.lab-stats').innerText());
  // the atom: drag a neutron from the tray into the nucleus (carbon-12 → carbon-13)
  await page.goto(APP + '?lab=atom');
  await page.waitForSelector('.lab-stage canvas');
  const tb = await page.locator('.lab-stage canvas').boundingBox();
  await page.mouse.move(tb.x + 24, tb.y + tb.height - 48); await page.mouse.down();
  await page.mouse.move(tb.x + tb.width * 0.42, tb.y + tb.height / 2, { steps: 6 }); await page.mouse.up();
  expect(/carbon-13/.test(await page.locator('.lab-stats').innerText()), 'a dragged-in neutron makes carbon-13: ' + await page.locator('.lab-stats').innerText());
  // Hanoi: drag the top disk from A to C
  await page.goto(APP + '?lab=hanoi');
  await page.waitForSelector('.lab-stage canvas');
  const hb = await page.locator('.lab-stage canvas').boundingBox();
  await page.mouse.move(hb.x + hb.width / 6, hb.y + hb.height - 60); await page.mouse.down();
  await page.mouse.move(hb.x + (hb.width * 5) / 6, hb.y + hb.height - 80, { steps: 6 }); await page.mouse.up();
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
  await page.waitForSelector('#play-stage svg.cassie-bot');
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

test('landing: highlight a word on the page and Cassie explains it, quizzes you, makes a card', async (b) => {
  const ctx = watchCsp(await b.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' }));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(APP.replace('app.html', 'index.html'));
  // under the hero: a 3D laptop and phone showing Labs (the Google Docs strip is gone)
  expect(await page.locator('.strip, .marquee').count() === 0, 'the scrolling strip is gone');
  expect(await page.locator('.lx-lid .lx-scr img').count() === 3 && await page.locator('.lx-phone img').count() === 2, 'the laptop and phone show Labs screens');
  expect(await page.evaluate(async () => { const all = [...document.querySelectorAll('.lx-show img')]; await Promise.all(all.map((i) => { i.loading = 'eager'; return i.decode().catch(() => null); })); return all.every((i) => i.naturalWidth > 0); }), 'every device screen image loads');
  expect(await page.locator('.nav .brand svg rect[rx="11"]').count() === 2, 'the new logo: Cursor Cassie with her two eyes');
  // the scroll story: scrolling through a scene moves what's inside it
  const scrollTo = async (sel, p) => {
    await page.evaluate(([s, q]) => { const el = document.querySelector(s); const top = el.getBoundingClientRect().top + scrollY; scrollTo({ top: top + (el.offsetHeight - innerHeight) * q, behavior: 'instant' }); }, [sel, p]);
    await page.waitForTimeout(150);
  };
  await scrollTo('.lx-show', 0.32);
  expect(await page.evaluate(() => { const r = document.querySelector('.lx-scr').getBoundingClientRect(); return r.width > innerWidth * 0.85; }), 'scrolled in, the laptop screen fills the window');
  await scrollTo('.lx-show', 0.66);
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('.lx-sim.s1')).opacity === '1') && /^Pendulum/.test(await page.locator('.lx-type span').innerText()), 'then the pendulum lab is on the screen');
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

test('Lite mode skips the 3D Cassie', async (b) => {
  const { ctx, page } = await open(b, { lite: 'on' });
  await page.waitForTimeout(1500);
  const loaded = await page.evaluate(() => [...document.scripts].some((s) => /cassie-3d/.test(s.src)));
  expect(!loaded, '3D bundle loaded in Lite mode');
  await ctx.close();
});

test("What's new shows once after an update", async (b) => {
  const { ctx, page } = await open(b, { state: { seenVersion: '1' } });
  await page.waitForSelector('text=What’s new in Cassie', { timeout: 5000 });
  await page.click('.profile-card .pf-go');
  await page.reload();
  await page.waitForTimeout(2000);
  expect(await page.locator('text=What’s new in Cassie').count() === 0, "What's new showed twice");
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
  expect(/Smith, J\. \(2020\)\. Sleep and memory\. Journal of Sleep, 29\(3\), 101–115\. https:\/\/doi\.org\/10\.1\/abc/.test(apa) && /Cruz, A\. \(2019\)/.test(apa), 'APA references: ' + apa);
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

test('phones: open a PDF in Read & highlight, select words → Explain', async (b) => {
  const { ctx, page } = await open(b, { server: false, state: { groqKey: 'gsk_test' }, fakeGroq: () => ({ text: 'Condensation is when water vapour cools into droplets.' }) });
  const pdf = await page.evaluate(async () => {
    const blob = await window.CassieExport.toPdf('# Water cycle\n\nEvaporation, condensation and precipitation move water around the Earth.', 'Water cycle');
    const buf = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (const x of buf) s += String.fromCharCode(x); return btoa(s);
  });
  await page.setInputFiles('#file-input', { name: 'water.pdf', mimeType: 'application/pdf', buffer: Buffer.from(pdf, 'base64') });
  await page.waitForSelector('#attach-read:not([hidden])', { timeout: 10000 });
  await page.click('#attach-read');
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

test('Claude on the server: the main chat and photos use Claude, Groq covers when it fails', async (b) => {
  await serverMode({ claude: 'ok', claudeReply: 'Claude here: plants turn light into food.', claudeCalls: [] });
  try {
    const { ctx, page } = await open(b, { state: { groqKey: 'gsk_own' } }); // even with their own key, Claude answers
    await page.waitForFunction(() => serverClaude === true, null, { timeout: 5000 });
    const a = await ask(page, 'What is photosynthesis?');
    expect(/Claude here/.test(await a.textContent()), 'Claude should answer: ' + await a.textContent());
    let m = await (await fetch(SERVER + '/__mode')).json();
    const call = m.claudeCalls.at(-1);
    expect(call && call.model === 'test-opus-newest', 'should pick the newest Opus: ' + (call && call.model));
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
    // Claude down → the answer still comes (Groq on the server)
    await serverMode({ claude: 'down', reply: 'Groq covered for Claude.' });
    const c = await ask(page, 'And respiration?');
    expect(/Groq covered/.test(await c.textContent()), 'Groq should cover: ' + await c.textContent());
    await ctx.close();
  } finally { await serverMode({ claude: 'off', reply: '' }); }
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
  // OFF, with the switch in the Ideas side panel: highlighting is just highlighting
  await page.evaluate(() => openIdeas());
  await page.waitForSelector('.ideas-panel.open .ideas-hl-toggle', { timeout: 3000 });
  if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/app-hl-switch.png' });
  await page.click('.ideas-hl');
  expect(await page.evaluate(() => state.highlightHelp === false), 'the side panel switch turns highlight help off');
  await page.evaluate(() => closeIdeas());
  await page.waitForTimeout(300);
  await a.locator('p').first().selectText(); await page.mouse.up();
  await page.waitForTimeout(800);
  expect(await page.locator('#highlight-popover').isHidden(), 'with highlight help off, nothing shows');
  await ctx.close();
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
  expect(await page.locator('#attach-thumb').isVisible(), 'the shared screenshot is attached, ready to ask about');
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
  await page.waitForSelector('#prompt-input', { timeout: 5000 });
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
    try { await app.waitForSelector('#chat-log .bubble-assistant >> text=water evaporates', { timeout: 20000 }); } catch (e) { throw new Error('app url ' + app.url() + ' pages ' + ctx.pages().map((x) => x.url()).join(',') + ' app chat: ' + (await app.locator('#chat-log').innerText({ timeout: 2000 }).catch(() => '-')).slice(0, 600) + ' | url ' + app.url() + ' | calls ' + groqCalls.length + ' | attach ' + await app.locator('#attach-name').innerText().catch(() => '?')); }
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
  const browser = await chromium.launch(fs.existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : {});
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (...a) => watchCsp(await newContext(...a));
  const only = process.argv[2];
  let failed = 0;
  for (const t of tests) {
    if (only && !t.name.includes(only)) continue;
    try {
      cspViolations.length = 0;
      await t.fn(browser);
      if (cspViolations.length) throw new Error('blocked by the security policy: ' + [...new Set(cspViolations)].join(' | '));
      console.log('PASS', t.name);
    }
    catch (e) { failed += 1; console.log('FAIL', t.name, '\n     ', (e && e.message || e).toString().split('\n').slice(0, process.env.VERBOSE ? 30 : 1).join('\n')); }
  }
  await browser.close(); await server.close(); app.close();
  console.log(failed ? `\n${failed} failed` : '\nAll passed');
  process.exit(failed ? 1 : 0);
})();

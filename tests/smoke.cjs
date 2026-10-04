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

// The libraries Cassie loads from cdnjs, served from node_modules instead.
const NM = path.join(__dirname, 'node_modules');
const CDN = {
  'jszip.min.js': path.join(NM, 'jszip/dist/jszip.min.js'),
  'jspdf.umd.min.js': path.join(NM, 'jspdf/dist/jspdf.umd.min.js'),
  'pdf.min.js': path.join(NM, 'pdfjs-dist/build/pdf.min.js'),
  'pdf.worker.min.js': path.join(NM, 'pdfjs-dist/build/pdf.worker.min.js'),
  'mammoth.browser.min.js': path.join(NM, 'mammoth/mammoth.browser.min.js'),
};

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
function staticServer() {
  return http.createServer((req, res) => {
    let p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
    if (!p.startsWith(ROOT) || !fs.existsSync(p)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' });
    fs.createReadStream(p).pipe(res);
  }).listen(APP_PORT);
}

/* ---------- helpers ---------- */
const APP_VERSION = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8').match(/APP_VERSION = '([^']+)'/)[1];
const PROFILE = { name: 'Test', role: 'student', grade: 'Grade 10', field: '', age: 16, at: 1 };
async function open(browser, { server = true, state = {}, fakeGroq, lite = 'on' } = {}) {
  const ctx = await browser.newContext({ ...devices['Pixel 7'], acceptDownloads: true });
  const seed = state && { profile: PROFILE, seenVersion: APP_VERSION, analytics: { usage: true, topics: false }, lite, ...state };
  await ctx.addInitScript(([srv, seedJson]) => {
    if (srv) window.CASSIE_SERVER = srv;
    if (seedJson && !sessionStorage.getItem('seeded')) { localStorage.setItem('cassie.v2', seedJson); sessionStorage.setItem('seeded', '1'); }
  }, [server ? SERVER : '', seed ? JSON.stringify(seed) : '']);
  await ctx.route(/cdnjs\.cloudflare\.com/, (route) => {
    const file = CDN[route.request().url().split('/').pop()];
    return file ? route.fulfill({ path: file, contentType: 'text/javascript' }) : route.abort();
  });
  await ctx.route(/pollinations\.ai/, (route) => route.fulfill({ body: PNG, contentType: 'image/png' }));
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  const groqCalls = [];
  await ctx.route(/api\.groq\.com/, async (route) => {
    const req = route.request();
    if (req.url().endsWith('/models')) return route.fulfill({ json: { data: [{ id: 'openai/gpt-oss-120b' }, { id: 'llama-3.3-70b-versatile' }, { id: 'meta-llama/llama-4-scout-17b-16e-instruct' }] } });
    const body = JSON.parse(req.postData() || '{}');
    groqCalls.push(body);
    const out = fakeGroq ? await fakeGroq(body, groqCalls.length) : { text: 'Own-key answer.' };
    if (out.status) return route.fulfill({ status: out.status, json: { error: { message: out.message || 'error' } }, headers: out.headers || {} });
    return route.fulfill({ json: { choices: [{ message: { role: 'assistant', content: out.text } }] } });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(APP);
  return { ctx, page, errors, groqCalls };
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
  return (await fetch(`${SERVER}/stats?days=7`, { headers: { authorization: 'Bearer test-token' } })).json();
}
function expect(cond, msg) { if (!cond) throw new Error(msg); }

/* ---------- the tests ---------- */
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('sign-up shows on first open and saves the profile', async (b) => {
  const { ctx, page } = await open(b, { state: null });
  await page.waitForSelector('.profile-overlay', { timeout: 5000 });
  await page.fill('.profile-card input[name=name]', 'Hazel');
  await page.click('.profile-card [data-role=student]');
  await page.selectOption('.profile-card select[name=grade]', 'Grade 10');
  await page.fill('.profile-card input[name=age]', '15');
  await page.click('.profile-card .pf-go');
  await page.waitForSelector('.profile-overlay', { state: 'detached' });
  const p = await page.evaluate(() => JSON.parse(localStorage.getItem('cassie.v2')).profile);
  expect(p && p.name === 'Hazel' && p.grade === 'Grade 10' && p.age === 15, 'profile not saved: ' + JSON.stringify(p));
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
    await new Promise((r) => { const sc = document.createElement('script'); sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'; sc.onload = r; document.head.appendChild(sc); });
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

test('Research finds real papers and writes an RRL', async (b) => {
  const { ctx, page } = await open(b, { server: false, state: { groqKey: 'gsk_test' }, fakeGroq: () => ({ text: 'Studies agree that sleep improves memory (Smith, 2020).\n\n**References**\nSmith, J. (2020). Sleep and memory.' }) });
  await ctx.route(/api\.openalex\.org/, (route) => route.fulfill({ json: { results: [
    { title: 'Sleep and memory', publication_year: 2020, authorships: [{ author: { display_name: 'J. Smith' } }], primary_location: { source: { display_name: 'Journal of Sleep' } }, doi: 'https://doi.org/10.1/abc', cited_by_count: 12, abstract_inverted_index: { Sleep: [0], helps: [1], memory: [2] } },
    { title: 'Naps in students', publication_year: 2019, authorships: [{ author: { display_name: 'A. Cruz' } }], cited_by_count: 3 },
  ] } }));
  await page.fill('#prompt-input', 'sleep and memory');
  await page.click('#research-btn');
  await page.waitForSelector('text=Found 2 real papers', { timeout: 10000 });
  await page.waitForSelector('text=Studies agree', { timeout: 10000 });
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

test('highlight text in an answer → Explain', async (b) => {
  const { ctx, page } = await open(b, { server: false, state: { groqKey: 'gsk_test' }, fakeGroq: (body, n) => ({ text: n === 1 ? 'Osmosis is the movement of water across a membrane.' : 'Simply put: water moves to where there is less water.' }) });
  const a = await ask(page, 'What is osmosis?');
  await a.locator('p').first().selectText();
  await page.mouse.up();
  await page.waitForSelector('#highlight-popover:not([hidden]) [data-mode=explain]', { timeout: 5000 });
  await page.click('#highlight-popover [data-mode=explain]');
  await page.waitForSelector('#highlight-popover >> text=Simply put', { timeout: 10000 });
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

test('works offline after the first visit (app opens)', async (b) => {
  // no network fakes here: Playwright's fakes and service workers don't mix
  const ctx = await b.newContext({ ...devices['Pixel 7'] });
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

/* ---------- run ---------- */
(async () => {
  const { startFakeServer } = await import('./fake-server.mjs');
  const app = staticServer();
  const server = await startFakeServer(SERVER_PORT);
  const browser = await chromium.launch(fs.existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : {});
  const only = process.argv[2];
  let failed = 0;
  for (const t of tests) {
    if (only && !t.name.includes(only)) continue;
    try { await t.fn(browser); console.log('PASS', t.name); }
    catch (e) { failed += 1; console.log('FAIL', t.name, '\n     ', (e && e.message || e).toString().split('\n')[0]); }
  }
  await browser.close(); await server.close(); app.close();
  console.log(failed ? `\n${failed} failed` : '\nAll passed');
  process.exit(failed ? 1 : 0);
})();

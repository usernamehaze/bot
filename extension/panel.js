/* Cassie side panel — lives beside ANY tab, including Chrome's PDF viewer (where page
 * scripts can't see the selection or draw on the page). From here: answers for text you
 * right-click ("Explain with Cassie"), Snip part of the tab, read the Whole file, or open the Board.
 */
'use strict';

const $ = (s) => document.querySelector(s);
const view = $('#view');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function activeTab() {
  const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
  return t;
}
function errorText(m) {
  m = String((m && m.message) || m || '');
  if (m === 'no-key') return 'Add your free Groq key first — click the Cassie icon in the toolbar.';
  if (m === 'no-vision') return 'Your Groq key has no picture-reading model right now. Add a free Google (Gemini) key in the Cassie toolbar popup.';
  return m || 'Something went wrong — please try again.';
}

function home(extra = '') {
  view.innerHTML = `<div class="help">
    ${extra ? `<div class="card">${extra}</div>` : ''}
    <p><b>Highlighted text</b> — right-click it and choose <b>Explain with Cassie</b> or <b>Answer with Cassie</b>. This works inside PDFs too.</p>
    <p><b>Snip</b> — take a picture of this tab, drag over the part you need, and Cassie explains it on her board.</p>
    <p><b>Whole file</b> — on a PDF, Google Slides or Google Doc tab, Cassie reads every page and makes a reviewer.</p>
    <p><b>Board</b> — draw, or paste any screenshot with <b>Ctrl+V</b> (Win+Shift+S makes one).</p>
  </div>`;
}

/* ---------- tiny markdown → HTML (with Cassie's graphs) ---------- */
function inline(s) {
  return esc(s).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>');
}
function renderMd(el, text) {
  el.innerHTML = '';
  String(text).split('```').forEach((seg, i) => {
    if (i % 2 === 1) {
      if (/^\s*cassie-board/.test(seg)) {
        let spec = null; try { spec = JSON.parse(seg.replace(/^\s*cassie-board\s*/, '')); } catch (e) { spec = null; }
        if (spec && window.CassieBoard) window.CassieBoard.renderInto(el, spec, { width: Math.max(240, Math.min(420, el.clientWidth - 24 || 300)) });
        else { const p = document.createElement('p'); p.className = 'muted'; p.textContent = 'Drawing the graph…'; el.appendChild(p); }
        return;
      }
      const pre = document.createElement('pre'); const c = document.createElement('code');
      c.textContent = seg.replace(/^[a-zA-Z0-9+#.\-]{0,15}\n/, '').replace(/\n$/, ''); pre.appendChild(c); el.appendChild(pre);
      return;
    }
    let list = null;
    seg.split('\n').forEach((line) => {
      const t = line.trim();
      const li = t.match(/^[-*•]\s+(.*)$/) || t.match(/^\d+[.)]\s+(.*)$/);
      if (li) {
        const tag = /^\d/.test(t) ? 'OL' : 'UL';
        if (!list || list.tagName !== tag) { list = document.createElement(tag); el.appendChild(list); }
        const item = document.createElement('li'); item.innerHTML = inline(li[1]); list.appendChild(item);
        return;
      }
      list = null;
      if (!t) return;
      const p = document.createElement('p'); p.innerHTML = inline(t.replace(/^#{1,6}\s+/, '')); if (/^#{1,6}\s/.test(t)) p.style.fontWeight = '700';
      el.appendChild(p);
    });
  });
}

/* ---------- text answers (from the right-click menu) ---------- */
const PROMPTS = {
  explain: (t) => `Work through this carefully step by step and double-check your result, then give the answer followed by a clear explanation of why/how:\n\n"${t}"`,
  answer: (t) => `Work out the correct answer to this carefully and double-check it before responding, then give ONLY the final answer — no explanation, no extra words. If it's multiple choice, give the correct option:\n\n"${t}"`,
  code: (t) => `Write clean, well-commented code that correctly solves or implements this. Pick a sensible language if none is stated, put the code in a fenced code block, make sure it actually works, and briefly explain how it works:\n\n"${t}"`,
};
let convo = [];
function ask(messages, outEl, onDone) {
  let port;
  try { port = chrome.runtime.connect({ name: 'cassie-stream' }); } catch (e) { outEl.textContent = 'Reload the extension and try again.'; return; }
  let acc = '';
  outEl.innerHTML = '<p class="muted">Thinking…</p>';
  port.onMessage.addListener((m) => {
    if (m.delta != null) { acc += m.delta; renderMd(outEl, acc); }
    else if (m.done) { const full = m.reply != null ? m.reply : acc; renderMd(outEl, full); onDone && onDone(full); try { port.disconnect(); } catch (e) { /* ignore */ } }
    else if (m.error) { outEl.innerHTML = `<p class="muted">${esc(errorText(m.error))}</p>`; try { port.disconnect(); } catch (e) { /* ignore */ } }
  });
  port.postMessage({ type: 'CASSIE_ASK', messages });
}
function showTextJob(text, mode = 'explain') {
  view.innerHTML = `<div class="card">
      <div class="quote"></div>
      <div class="chips"><button class="chip" data-m="explain">Explain</button><button class="chip" data-m="answer">Answer</button><button class="chip" data-m="code">Code</button></div>
      <div class="answer"></div>
      <div class="row"><input type="text" placeholder="Ask a follow-up…"><button class="btn">Ask</button></div>
    </div>`;
  view.querySelector('.quote').textContent = text;
  const out = view.querySelector('.answer');
  const run = (m) => {
    view.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c.dataset.m === m));
    convo = [{ role: 'user', content: PROMPTS[m](text) }];
    ask(convo, out, (full) => convo.push({ role: 'assistant', content: full }));
  };
  view.querySelectorAll('.chip').forEach((c) => c.addEventListener('click', () => run(c.dataset.m)));
  const input = view.querySelector('.row input');
  const follow = () => {
    const q = input.value.trim(); if (!q) return;
    input.value = '';
    convo.push({ role: 'user', content: q });
    ask(convo, out, (full) => convo.push({ role: 'assistant', content: full }));
  };
  view.querySelector('.row .btn').addEventListener('click', follow);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') follow(); });
  run(mode);
}

/* ---------- pictures → board + explanation ---------- */
const SNIP_PROMPT = (ctx) => `A student snipped part of what they're studying (a graph, diagram, picture, equation, question, or a page of notes).${ctx ? ` Context: ${ctx}.` : ''}\n\nLook at the picture carefully and teach it like a friendly step-by-step tutor: what it shows, how to read it, and the reasoning behind it. If it is a question, work it out step by step and give the answer. Reply with ONLY minified JSON — no prose, no code fence — exactly: {"headline":"one short sentence naming what this is","steps":["step 1","step 2","step 3"]}. Give 3 to 6 short steps, max ~20 words each. Read every label and number you can see; don't invent ones you can't.`;
function parseBoardJSON(text) {
  try { const m = String(text).match(/\{[\s\S]*\}/); if (m) return JSON.parse(m[0]); } catch (e) { /* fall through */ }
  const lines = String(text).split('\n').map((s) => s.replace(/^[-*\d.)\s]+/, '').trim()).filter(Boolean);
  return { headline: lines[0] || 'Here’s how to read this', steps: lines.slice(1, 6) };
}
async function vision(image, prompt, maxTokens = 800) {
  const r = await chrome.runtime.sendMessage({ type: 'CASSIE_VISION', image, prompt, maxTokens });
  if (!r || r.error) throw new Error((r && r.error) || 'Cassie didn’t answer — try again.');
  return r.reply;
}
async function explainOnBoard(sess, image, ctx = '') {
  if (!sess || !image) return;
  sess.showNote({ reply: 'Cassie is reading your picture…' });
  try {
    const d = parseBoardJSON(await vision(image, SNIP_PROMPT(ctx)));
    sess.setTitle(d.headline || 'Your snip');
    sess.showNote({ headline: d.headline, steps: d.steps || [] });
  } catch (e) { sess.showNote({ reply: errorText(e) }); }
}
function openBoard(image, { title = 'Your board', explain = false, ctx = '', note = null } = {}) {
  let sess = null;
  const p = window.CassieSketch.open({
    root: document.body, image: image || null, dark: image ? false : undefined, dock: 'full',
    title, note,
    onImage: (url) => { if (url) explainOnBoard(sess, url, ''); },
    extra: [{ label: 'New snip', title: 'Snip the tab again', onClick: () => { window.CassieSketch.close(); snip(); } }],
    askPlaceholder: 'Ask Cassie about this…',
    onAsk: async (png, q) => { try { return await vision(png, `This is a student's board (a snip of their lesson, possibly with their own writing on it). Their question: "${q}". Answer it clearly and kindly like a tutor, in under 150 words, plain text.`, 600); } catch (e) { return errorText(e); } },
    checkLabel: 'Check my work',
    onCheck: async (png) => { try { return await vision(png, 'This is a student\'s board with their own writing and sketches. Check their work like a kind but honest tutor: what is right, any mistake and why, and a hint for the next step. Under 120 words, plain text.', 500); } catch (e) { return errorText(e); } },
  });
  p.then((x) => { sess = x; if (explain && image) explainOnBoard(sess, image, ctx); });
  return p;
}

/* ---------- Snip: picture of the tab, then drag over the part you want ---------- */
async function snip() {
  const tab = await activeTab();
  view.innerHTML = '<p class="muted">Taking a picture of the tab…</p>';
  let out;
  try { out = await chrome.runtime.sendMessage({ type: 'CASSIE_SNIP', windowId: tab && tab.windowId }); } catch (e) { out = { error: e.message }; }
  if (!out || out.error || !out.dataUrl) {
    home(`<b>Couldn’t take a picture of this tab.</b><br>${esc((out && out.error) || '')}<br><br>Use Win+Shift+S (Cmd+Shift+4 on Mac), then open the <b>Board</b> and press Ctrl+V.`);
    return;
  }
  if (out.full && out.full.std < 4) {
    home('<b>Chrome gave Cassie a blank picture of this tab.</b> On some computers Chrome does this.<br><br>Press <b>Win+Shift+S</b> (Cmd+Shift+4 on Mac), snip what you need, then click <b>Board</b> and press <b>Ctrl+V</b> — Cassie reads it straight away.<br><br><span class="hint">If it keeps happening: Chrome Settings → System → turn off “Use graphics acceleration when available”, relaunch, and try again.</span>');
    return;
  }
  view.innerHTML = `<p class="hint">Drag over the part you want Cassie to read.</p>
    <div class="crop"><img alt="Screenshot of the tab"><div class="sel"></div></div>
    <div class="row"><button class="btn ghost" id="whole">Use the whole screen</button><button class="btn ghost" id="cancel">Cancel</button></div>`;
  const wrap = view.querySelector('.crop'), img = wrap.querySelector('img'), sel = wrap.querySelector('.sel');
  img.src = out.dataUrl;
  await new Promise((res) => { if (img.complete) res(); else img.onload = res; });
  const ctx = tab && tab.title ? `they are viewing "${tab.title}"` : '';
  const finish = (x0, y0, x1, y1) => {
    const k = img.naturalWidth / img.clientWidth;
    const sx = Math.round(Math.min(x0, x1) * k), sy = Math.round(Math.min(y0, y1) * k);
    const sw = Math.max(1, Math.round(Math.abs(x1 - x0) * k)), sh = Math.max(1, Math.round(Math.abs(y1 - y0) * k));
    const scale = Math.min(1, 1400 / Math.max(sw, sh));
    const c = document.createElement('canvas'); c.width = Math.round(sw * scale); c.height = Math.round(sh * scale);
    const x = c.getContext('2d', { willReadFrequently: true }); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
    x.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
    home();
    openBoard(c.toDataURL('image/jpeg', 0.9), { title: 'Your snip', explain: true, ctx });
  };
  let start = null;
  wrap.addEventListener('pointerdown', (e) => { const b = wrap.getBoundingClientRect(); start = { x: e.clientX - b.left, y: e.clientY - b.top }; wrap.setPointerCapture(e.pointerId); });
  wrap.addEventListener('pointermove', (e) => {
    if (!start) return;
    const b = wrap.getBoundingClientRect(), x = e.clientX - b.left, y = e.clientY - b.top;
    Object.assign(sel.style, { display: 'block', left: Math.min(start.x, x) + 'px', top: Math.min(start.y, y) + 'px', width: Math.abs(x - start.x) + 'px', height: Math.abs(y - start.y) + 'px' });
  });
  wrap.addEventListener('pointerup', (e) => {
    if (!start) return;
    const b = wrap.getBoundingClientRect(), x = e.clientX - b.left, y = e.clientY - b.top;
    const s0 = start; start = null;
    if (Math.abs(x - s0.x) < 8 || Math.abs(y - s0.y) < 8) { sel.style.display = 'none'; return; }
    finish(s0.x, s0.y, x, y);
  });
  view.querySelector('#whole').addEventListener('click', () => finish(0, 0, img.clientWidth, img.clientHeight));
  view.querySelector('#cancel').addEventListener('click', () => home());
}

/* ---------- Whole file ---------- */
async function wholeFile() {
  const tab = await activeTab();
  if (!tab) return;
  view.innerHTML = '<p class="muted">Checking what this tab is…</p>';
  const info = await chrome.runtime.sendMessage({ type: 'CASSIE_TAB_FILE', tabId: tab.id }).catch(() => null);
  const f = info && info.file;
  if (f && f.kind === 'image') {
    const r = await chrome.runtime.sendMessage({ type: 'CASSIE_FETCH_IMG', url: f.url }).catch(() => null);
    home();
    if (r && r.dataUrl) openBoard(r.dataUrl, { title: 'Your photo', explain: true, ctx: 'a photo: ' + f.name });
    else home('<b>Couldn’t open this photo.</b> Save it and paste it on the Board with Ctrl+V.');
    return;
  }
  if (!f) { home('<b>This tab isn’t a PDF, Google Slides, Google Doc or Office file.</b><br>For a normal web page, use <b>Snip</b> or highlight text and right-click → <b>Explain with Cassie</b>.'); return; }
  const label = { pdf: 'PDF', pptx: 'presentation', docx: 'document' }[f.kind] || 'file';
  view.innerHTML = `<p class="muted">Opening the whole ${label} in Cassie…</p>`;
  const r = await chrome.runtime.sendMessage({ type: 'CASSIE_PANEL_OPEN_FILE', tabId: tab.id }).catch((e) => ({ error: e.message }));
  if (r && r.ok) home(`<b>Opened in a new Cassie tab.</b> She’s reading the whole ${label} (${esc(r.name)}) and writing your reviewer there.`);
  else home(`<b>Couldn’t open it.</b> ${esc((r && r.error) || '')}`);
}

/* ---------- jobs sent from the right-click menu ---------- */
let lastJob = 0;
async function handleJob(job) {
  if (!job || job.at <= lastJob) return;
  lastJob = job.at;
  chrome.storage.session.remove('cassieJob');
  if (job.kind === 'text' && job.text) showTextJob(job.text, job.mode);
  else if (job.kind === 'image' && job.srcUrl) {
    view.innerHTML = '<p class="muted">Opening the picture…</p>';
    let url = job.srcUrl.startsWith('data:') ? job.srcUrl : null;
    if (!url) { const r = await chrome.runtime.sendMessage({ type: 'CASSIE_FETCH_IMG', url: job.srcUrl }).catch(() => null); url = r && r.dataUrl; }
    home();
    if (url) openBoard(url, { title: 'Your picture', explain: true });
    else home('<b>Couldn’t open that picture.</b> Right-click → Copy image, then open the Board and press Ctrl+V.');
  }
}
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'session' && changes.cassieJob && changes.cassieJob.newValue) handleJob(changes.cassieJob.newValue); });

$('#t-snip').addEventListener('click', snip);
$('#t-file').addEventListener('click', wholeFile);
$('#t-board').addEventListener('click', () => openBoard(null));
home();
chrome.storage.session.get('cassieJob').then((o) => handleJob(o.cassieJob)).catch(() => {});

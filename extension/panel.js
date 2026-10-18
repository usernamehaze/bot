/* Cassie side panel — lives beside ANY tab, including Chrome's PDF viewer (where page
 * scripts can't see the selection or draw on the page). From here: answers for text you
 * right-click ("Explain with Cassie"), Snip part of the tab, read the Whole file, or open the Board.
 */
'use strict';

const $ = (s) => document.querySelector(s);
const view = $('#view');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// the panel can also run in its own small floating window (?float=1): then "this tab" is the
// tab you were last looking at in a normal browser window
const FLOATING = new URLSearchParams(location.search).has('float');
async function activeTab() {
  if (FLOATING) {
    const w = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
    const [t] = await chrome.tabs.query({ active: true, windowId: w.id });
    return t;
  }
  const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
  return t;
}
function errorText(m) {
  m = String((m && m.message) || m || '');
  if (m === 'no-key') return 'Add a free Groq or Gemini key first. Click the Cassie icon in the toolbar.';
  if (m === 'no-vision') return 'Your Groq key has no picture-reading model right now. Add a free Google (Gemini) key in the Cassie toolbar popup.';
  return m || 'Something went wrong. Please try again.';
}

// "Invalid API Key" / no key → fix it right here in the panel, then try again.
const isKeyProblem = (m) => /^no-key$|key (saved in the Cassie extension )?was rejected|invalid api key|key isn.t allowed/i.test(String((m && m.message) || m || ''));
function keyForm(onFixed) {
  const f = document.createElement('div');
  f.className = 'keyfix';
  f.innerHTML = `<p class="hint">Paste your keys here. They’re saved only in this browser.</p>
    <input type="password" data-k="groqKey" placeholder="Groq key (gsk_…)" autocomplete="off">
    <input type="password" data-k="geminiKey" placeholder="Gemini key (AIza…), optional" autocomplete="off">
    <div class="row"><button class="btn" type="button">Save &amp; try again</button></div>
    <p class="hint st"></p>`;
  const [gi, ki] = f.querySelectorAll('input'), st = f.querySelector('.st'), btn = f.querySelector('button');
  chrome.storage.local.get(['groqKey', 'geminiKey'], (o) => { gi.value = o.groqKey || ''; ki.value = o.geminiKey || ''; });
  btn.addEventListener('click', async () => {
    btn.disabled = true; st.textContent = 'Checking your keys…';
    let r = null;
    try { r = await chrome.runtime.sendMessage({ type: 'CASSIE_CHECK_KEYS', save: { groqKey: gi.value, geminiKey: ki.value } }); } catch (e) { /* ignore */ }
    btn.disabled = false;
    if (r && (r.groq === 'ok' || r.gemini === 'ok')) { st.textContent = `Groq: ${r.groq} · Gemini: ${r.gemini}`; onFixed(); return; }
    st.textContent = !r ? 'Couldn’t check. Reload the extension and try again.'
      : `Groq key: ${r.groq === 'invalid' ? 'rejected' : r.groq}. Gemini key: ${r.gemini === 'invalid' ? 'rejected' : r.gemini}. Copy a fresh key from console.groq.com/keys or aistudio.google.com/apikey.`;
  });
  return f;
}

function home(extra = '') {
  view.innerHTML = `<div class="help">
    ${extra ? `<div class="card">${extra}</div>` : ''}
    <p><b>Highlighted text</b>: right-click it and choose <b>Explain with Cassie</b> or <b>Answer with Cassie</b>. This works inside PDFs too.</p>
    <p><b>Snip</b>: take a picture of this tab, drag over the part you need, then Cassie teaches it right there or on her board.</p>
    <p><b>Whole file</b>: on a PDF, Google Slides or Google Doc tab, Cassie reads every page and makes a reviewer.</p>
    <p><b>Board</b>: draw, or paste any screenshot with <b>Ctrl+V</b> (Win+Shift+S makes one).</p>
    <p><b>Teach me</b>: Cassie teaches what’s on this tab step by step, pointing and drawing on it. <b>Ask Cassie</b>: ask about this tab and she shows you where the answer is.</p>
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
  answer: (t) => `Work out the correct answer to this carefully and double-check it before responding, then give ONLY the final answer. No explanation, no extra words. If it's multiple choice, give the correct option:\n\n"${t}"`,
  code: (t) => `Write clean, well-commented code that correctly solves or implements this. Pick a sensible language if none is stated, put the code in a fenced code block, make sure it actually works, and briefly explain how it works:\n\n"${t}"`,
};
let convo = [];
function ask(messages, outEl, onDone, log) {
  let port;
  try { port = chrome.runtime.connect({ name: 'cassie-stream' }); } catch (e) { outEl.textContent = 'Reload the extension and try again.'; return; }
  let acc = '';
  outEl.innerHTML = '<p class="muted">Thinking…</p>';
  port.onMessage.addListener((m) => {
    if (m.delta != null) { acc += m.delta; renderMd(outEl, acc); }
    else if (m.done) { const full = m.reply != null ? m.reply : acc; renderMd(outEl, full); onDone && onDone(full); try { port.disconnect(); } catch (e) { /* ignore */ } }
    else if (m.error) {
      const keyIssue = isKeyProblem(m.error);
      outEl.innerHTML = `<p class="muted">${esc(keyIssue && m.error !== 'no-key'
        ? 'Groq rejected the key saved in the Cassie extension (“Invalid API Key”). The extension keeps its own copy of your keys, separate from the Cassie website, paste your key below.'
        : errorText(m.error))}</p>`;
      if (keyIssue) outEl.appendChild(keyForm(() => ask(messages, outEl, onDone, log)));
      try { port.disconnect(); } catch (e) { /* ignore */ }
    }
  });
  port.postMessage({ type: 'CASSIE_ASK', messages, log });
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
    ask(convo, out, (full) => convo.push({ role: 'assistant', content: full }), { kind: 'highlight', q: `${m === 'answer' ? 'Answer' : m === 'code' ? 'Code' : 'Explain'}: ${text}` });
  };
  view.querySelectorAll('.chip').forEach((c) => c.addEventListener('click', () => run(c.dataset.m)));
  const input = view.querySelector('.row input');
  const follow = () => {
    const q = input.value.trim(); if (!q) return;
    input.value = '';
    // a student at risk: care before anything else, no AI is asked (care.js; counted with no words, no id)
    const hit = window.CassieCare && window.CassieCare.check(q);
    if (hit) {
      const reply = window.CassieCare.reply(hit.lang);
      convo.push({ role: 'user', content: q }, { role: 'assistant', content: reply });
      renderMd(out, reply);
      try { chrome.runtime.sendMessage({ type: 'CASSIE_CARE' }); } catch (e) { /* best effort */ }
      return;
    }
    convo.push({ role: 'user', content: q });
    ask(convo, out, (full) => convo.push({ role: 'assistant', content: full }), { kind: 'highlight', q });
  };
  view.querySelector('.row .btn').addEventListener('click', follow);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') follow(); });
  run(mode);
}

/* ---------- pictures → board + explanation ---------- */
const SNIP_PROMPT = (ctx) => `A student snipped part of what they're studying (a graph, diagram, picture, equation, question, or a page of notes).${ctx ? ` Context: ${ctx}.` : ''}\n\nLook at the picture carefully and teach it like a friendly step-by-step tutor: what it shows, how to read it, and the reasoning behind it. If it is a question, work it out step by step and give the answer. Reply with ONLY minified JSON, no prose, no code fence, exactly: {"headline":"one short sentence naming what this is","steps":["step 1","step 2","step 3"]}. Give 3 to 6 short steps, max ~20 words each. Read every label and number you can see; don't invent ones you can't.`;
function parseBoardJSON(text) {
  const t = String(text || '').replace(/```(?:json)?/gi, '').trim();
  const clean = (d) => ({ headline: String(d.headline || '').trim(), steps: (Array.isArray(d.steps) ? d.steps : []).map((x) => String(x).trim()).filter(Boolean) });
  try { const m = t.match(/\{[\s\S]*\}/); if (m) { const d = JSON.parse(m[0]); if (d && (d.headline || d.steps)) return clean(d); } } catch (e) { /* cut off — pull the pieces out below */ }
  if (/"(headline|steps)"\s*:/.test(t)) {
    // the answer was cut off mid-JSON: keep every complete piece (and the last partial step)
    const unq = (s) => { try { return JSON.parse('"' + s + '"'); } catch (e) { return s.replace(/\\"/g, '"').replace(/\\n/g, ' '); } };
    const h = t.match(/"headline"\s*:\s*"((?:[^"\\]|\\.)*)/);
    const after = t.split(/"steps"\s*:\s*\[/)[1] || '';
    const steps = [...after.matchAll(/"((?:[^"\\]|\\.)*)(?:"|$)/g)].map((m) => unq(m[1]).trim()).filter((x) => x.length > 1);
    return { headline: h ? unq(h[1]).trim() : '', steps };
  }
  const lines = t.split('\n').map((s) => s.replace(/^[-*\d.)\s]+/, '').trim()).filter(Boolean);
  return { headline: lines[0] || 'Here’s how to read this', steps: lines.slice(1, 6) };
}
const DRAW_HINT = '\n\nIf they ask you to draw, graph, plot or sketch something, ALSO add one fenced code block tagged cassie-board holding minified JSON. It gets drawn right on their board. Graph: {"type":"graph","title":"y = x^2 - 4","fn":"x^2 - 4","xrange":[-4,4],"points":[{"x":-2,"y":0,"label":"x=-2"},{"x":2,"y":0,"label":"x=2"}]} (fn uses * for multiply and ^ for powers, e.g. x^2*(x+6)^3*(x-4)). Shape: {"type":"shape","shape":"rectangle","w":8,"h":5}. Steps: {"type":"steps","title":"...","steps":["..."]}.';
// Split Cassie's reply into words + something to draw on the board.
const withDrawing = (q, reply) => {
  const B = window.CassieBoard;
  if (!B || typeof reply !== 'string') return reply;
  const { clean, boards } = B.extract(reply);
  let draw = boards[0];
  if (!draw && /\b(graph|plot|sketch|draw)\b/i.test(q || '')) { const eq = B.findEquation(q) || B.findEquation(reply); if (eq) draw = B.graphSpec(eq); }
  return draw ? { reply: clean, draw } : clean;
};
async function vision(image, prompt, maxTokens = 800, board, log) {
  const r = await chrome.runtime.sendMessage({ type: 'CASSIE_VISION', image, prompt, maxTokens, board, log });
  if (!r || r.error) throw new Error((r && r.error) || 'Cassie didn’t answer. Try again.');
  return r.reply;
}
async function explainOnBoard(sess, image, ctx = '', kind = 'snip') {
  if (!sess || !image) return;
  sess.showNote({ reply: 'Cassie is reading your picture…' });
  try {
    const d = parseBoardJSON(await vision(image, SNIP_PROMPT(ctx), 800, undefined, { kind, q: kind === 'paste' ? 'Explain the picture I pasted' : 'Explain my snip' }));
    sess.setTitle('Your snip');
    sess.showNote({ headline: d.headline, steps: d.steps || [] });
  } catch (e) { sess.showNote({ reply: errorText(e) }); }
}
function openBoard(image, { title = 'Your board', explain = false, ctx = '', note = null } = {}) {
  let sess = null;
  const p = window.CassieSketch.open({
    root: document.body, image: image || null, dark: image ? false : undefined, dock: 'full',
    title, note,
    onImage: (url) => { if (url) explainOnBoard(sess, url, '', 'paste'); },
    extra: [{ label: 'New snip', title: 'Snip the tab again', onClick: () => { window.CassieSketch.close(); snip(); } }],
    askPlaceholder: 'Ask Cassie, or tell her what to draw (e.g. “graph the answer”)',
    onAsk: async (png, q, board) => { try { return withDrawing(q, await vision(png, `This is a student's board (a snip of their lesson, possibly with their own writing on it). Their request: "${q}". Do exactly that. Answer clearly and kindly like a tutor, in under 150 words, plain text.${DRAW_HINT}`, 1200, board, { kind: 'board', q })); } catch (e) { return errorText(e); } },
    checkLabel: 'Check my work',
    onCheck: async (png, board) => { try { return await vision(png, 'This is a student\'s board, maybe with their own writing and sketches. If they wrote or drew an answer, check it like a kind but honest tutor: what is right, any mistake and why, and a hint for the next step. If they haven\'t written anything yet, work out the question shown step by step and give the answer. Under 120 words, plain text.', 500, board, { kind: 'board', q: 'Check my work' }); } catch (e) { return errorText(e); } },
  });
  p.then((x) => { sess = x; if (explain && image) explainOnBoard(sess, image, ctx); });
  return p;
}

/* ---------- Snip: picture of the tab, then drag over the part you want ---------- */
async function snip() {
  const tab = await activeTab();
  view.innerHTML = '<p class="muted">Taking a picture of the tab…</p>';
  if (tab) await chrome.tabs.sendMessage(tab.id, { type: 'CASSIE_TEACH_STOP' }, { frameId: 0 }).catch(() => null); // (her old drawing stays out of the picture)
  let out;
  try { out = await chrome.runtime.sendMessage({ type: 'CASSIE_SNIP', windowId: tab && tab.windowId }); } catch (e) { out = { error: e.message }; }
  if (!out || out.error || !out.dataUrl) {
    home(`<b>Couldn’t take a picture of this tab.</b><br>${esc((out && out.error) || '')}<br><br>Use Win+Shift+S (Cmd+Shift+4 on Mac), then open the <b>Board</b> and press Ctrl+V.`);
    return;
  }
  if (out.full && out.full.std < 4) {
    home('<b>Chrome gave Cassie a blank picture of this tab.</b> On some computers Chrome does this.<br><br>Press <b>Win+Shift+S</b> (Cmd+Shift+4 on Mac), snip what you need, then click <b>Board</b> and press <b>Ctrl+V</b>: Cassie reads it straight away.<br><br><span class="hint">If it keeps happening: Chrome Settings → System → turn off “Use graphics acceleration when available”, relaunch, and try again.</span>');
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
    const crop = c.toDataURL('image/jpeg', 0.9);
    // the snipped part, as shares of the tab: Cassie teaches inside it on the page
    const region = { x: sx / img.naturalWidth, y: sy / img.naturalHeight, w: sw / img.naturalWidth, h: sh / img.naturalHeight };
    view.innerHTML = `<div class="card"><p class="hint">What should Cassie do with your snip?</p>
      <div class="row"><button class="btn tall" id="snip-teach">Teach me here</button><button class="btn ghost tall" id="snip-board">On the board</button></div></div>`;
    view.querySelector('#snip-teach').addEventListener('click', () => teach({ tab, snip: { image: crop, region } }));
    view.querySelector('#snip-board').addEventListener('click', () => { home(); openBoard(crop, { title: 'Your snip', explain: true, ctx }); });
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

/* ---------- Teach me and Ask Cassie: she teaches the tab you have open ---------- */
// Cassie reads the page (its words and a picture of it), then teaches it step by step on the page
// itself: her arrow points and she draws on a see-through layer (teach.js). Where the extension
// can't draw (the browser's own pages, its PDF viewer, extension stores), she teaches on a picture
// of the tab right here. The page's words and picture go to the AI only when the student taps, and
// are never kept: no log is asked for.
const TEACH_SHAPES = (numbered) => `Each step can draw up to 3 shapes ("draw"). x, y, w, h and r are shares of the picture from 0 to 1, and (0, 0) is its top left corner.
${numbered ? 'A shape can be about a numbered thing: {"shape":"circle","el":3}, {"shape":"box","el":3}, {"shape":"underline","el":3}, {"shape":"highlight","el":3}, {"shape":"arrow","to_el":3}.\n' : ''}{"shape":"circle","x":0.4,"y":0.3,"r":0.05}
{"shape":"box","x":0.1,"y":0.2,"w":0.3,"h":0.1}
{"shape":"underline","x":0.1,"y":0.25,"w":0.3}
{"shape":"highlight","x":0.1,"y":0.2,"w":0.3,"h":0.05}
{"shape":"arrow","from":[0.2,0.6],"to":[0.4,0.3]}
{"shape":"line","from":[0.1,0.5],"to":[0.6,0.5]}
{"shape":"curve","points":[[0.1,0.6],[0.3,0.4],[0.5,0.6]]}
{"shape":"polygon","points":[[0.2,0.2],[0.4,0.2],[0.3,0.4]]}
{"shape":"graph","fn":"x^2 - 4","xrange":[-4,4],"x":0.6,"y":0.1,"w":0.3,"h":0.3} (a small graph with its axes; fn uses * to multiply and ^ for powers)
{"shape":"text","x":0.5,"y":0.1,"text":"a short label"}
Draw only where it helps: circle or box the thing, an arrow to it, underline a key word, a graph for a function.`;
function teachPrompt({ q = '', page = null, snipped = false }) {
  const parts = page && !page.pictureOnly && !snipped && Array.isArray(page.items) ? page.items : [];
  const list = parts.map((p) => `${p.n}. ${p.what} at [${p.box.join(', ')}]`).join('\n');
  return `A student is studying ${snipped ? 'the part of their screen in this picture (they snipped it)' : 'what is on their screen right now (the picture)'}${page && page.title ? `, on a page called "${page.title}"` : ''}.
${page && page.text && !snipped ? `The words on the page (maybe cut short):\n"""\n${page.text}\n"""\n` : ''}${list ? `Things on the screen you can point at, numbered, each with its box [x, y, w, h] as shares of the picture:\n${list}\n` : ''}
${q ? `The student asks: "${q}"\nAnswer it, then show them on the screen, step by step, where the answer comes from.` : 'Teach it like a kind tutor sitting beside them: what it is, how to read it and the big ideas, in the order they should look at them. If there is a question on it, work it out with them step by step.'}
Reply with ONLY minified JSON, no other text:
{${q ? '"answer":"a short, clear answer in plain words, under 80 words",' : ''}"steps":[{"say":"one or two short, natural spoken sentences","point":${list ? '3' : '{"x":0.4,"y":0.3}'},"draw":[{"shape":"circle","x":0.4,"y":0.3,"r":0.05}]}]}
Give 2 to 6 steps. "point" is where her arrow goes: ${list ? 'the number of the thing on the list, or {"x":0.4,"y":0.3} for a spot on the picture, or 0 for nothing.' : 'a spot on the picture, {"x":0.4,"y":0.3}, or null for nothing.'}
${TEACH_SHAPES(!!list)}
Read only what you can see; never invent words or numbers. No markdown, no emojis, no symbols that sound odd read aloud.`;
}
// a page the extension can't draw on: why, in one plain sentence (CassieErrors)
function whyNotHere(tab) {
  const u = String((tab && tab.url) || '');
  if (/^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore|microsoftedge\.microsoft\.com\/addons)/i.test(u)) return 'teach_where_store';
  if (/\.pdf([?#]|$)/i.test(u)) return 'teach_where_pdf';
  if (!u || /^(chrome|edge|about|chrome-extension|extension|devtools|view-source|chrome-search):/i.test(u)) return 'teach_where_browser';
  return 'teach_where_page';
}
const teachReach = (tab, msg) => chrome.tabs.sendMessage(tab.id, msg, { frameId: 0 }).catch(() => null);
async function tabPicture(tab) {
  let out = null;
  try { out = await chrome.runtime.sendMessage({ type: 'CASSIE_SNIP', windowId: tab && tab.windowId }); } catch (e) { out = null; }
  return out && out.dataUrl && !(out.full && out.full.std < 4) ? out.dataUrl : null;
}
function teachAnswer(reply) {
  try {
    const t = String(reply || '').replace(/```(?:json)?/gi, ''), d = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
    return d && typeof d.answer === 'string' ? d.answer.trim().slice(0, 1500) : '';
  } catch (e) { return ''; }
}
// what went wrong, in plain words (CassieErrors): a missing key, no internet, too slow, or "try again"
function teachProblem(e) {
  const m = String((e && e.message) || e || '');
  if (m === 'no-key' || m === 'no-vision') return window.CassieErrors.say('teach_no_key');
  const w = window.CassieErrors.explain({ message: m }, 'teach_failed');
  return w === window.CassieErrors.say('unknown') ? window.CassieErrors.say('teach_failed') : w;
}
function teachError(box, words, retry) {
  box.innerHTML = '<div class="card teach-err" role="alert"><p></p><div class="row"><button class="btn tall" type="button">Try again</button></div></div>';
  box.querySelector('p').textContent = words;
  box.querySelector('button').addEventListener('click', retry);
}
let teachRun = 0;
// teach({ tab, q, snip: { image, region }, box, onAnswer }) runs one lesson (box: where her words go in the panel)
async function teach({ tab = null, q = '', snip: snipped = null, box = null, onAnswer = null } = {}) {
  tab = tab || (await activeTab());
  const run = ++teachRun, again = () => teach({ tab, q, snip: snipped, box, onAnswer });
  if (!box) { view.innerHTML = '<div class="teach-box"></div>'; box = view.querySelector('.teach-box'); }
  if (window.CassieTeach) window.CassieTeach.stop();
  if (!tab) { teachError(box, window.CassieErrors.say('teach_no_picture'), again); return; }
  box.innerHTML = `<p class="muted">${q ? 'Cassie is reading your tab to answer…' : 'Cassie is looking at your tab…'}</p>`;
  // 1. can she draw on this page? (it answers with what's on it, numbered)
  const page = snipped ? ((await teachReach(tab, { type: 'CASSIE_TEACH_PING' })) ? { pictureOnly: true, items: [] } : null) : await teachReach(tab, { type: 'CASSIE_TEACH_SCAN' });
  const onPage = !!(page && Array.isArray(page.items));
  // 2. what she sees: the snip, or a picture of the tab
  const image = snipped ? snipped.image : await tabPicture(tab);
  if (run !== teachRun) return;
  if (!image) { teachError(box, window.CassieErrors.say('teach_no_picture'), again); return; }
  // 3. her lesson as steps (CassieTeach.parse leaves out any bad step or shape)
  let reply;
  try { reply = await vision(image, teachPrompt({ q, page: onPage ? { ...page, title: page.title || tab.title || '' } : { title: tab.title || '' }, snipped: !!snipped }), 1400); } catch (e) {
    if (run === teachRun) teachError(box, teachProblem(e), again);
    return;
  }
  if (run !== teachRun) return;
  const steps = window.CassieTeach.parse(reply, onPage && !snipped && !page.pictureOnly ? page.items.length : 0);
  const answer = q ? teachAnswer(reply) || steps.map((s) => s.say).join(' ') : '';
  if (onAnswer && answer) onAnswer(answer);
  if (!steps.length) {
    if (answer) box.innerHTML = '';
    else teachError(box, window.CassieErrors.say('teach_failed'), again);
    return;
  }
  // 4. the lesson: on the page, or here on the picture when the page won't let her draw
  const lesson = { type: 'CASSIE_TEACH_SHOW', lesson: { steps }, region: snipped ? snipped.region : null };
  if (onPage) {
    const shown = await teachReach(tab, lesson);
    if (run !== teachRun) return;
    if (shown && shown.ok) {
      box.innerHTML = `<div class="card teach-on"><p>Cassie is teaching on the page${snipped ? ', inside your snip' : ''}. Tap Next on her card, or press Escape to stop.</p>
        <div class="row"><button class="btn ghost tall" type="button" data-stop>Stop</button><button class="btn ghost tall" type="button" data-again>Start again</button></div></div>`;
      box.querySelector('[data-stop]').addEventListener('click', () => { teachReach(tab, { type: 'CASSIE_TEACH_STOP' }); box.innerHTML = '<p class="muted">Cassie stopped teaching.</p>'; });
      box.querySelector('[data-again]').addEventListener('click', () => teachReach(tab, lesson));
      return;
    }
  }
  box.innerHTML = '<p class="teach-why"></p><div class="teach-mount"></div>';
  box.querySelector('.teach-why').textContent = window.CassieErrors.say(whyNotHere(tab));
  window.CassieTeach.show({ steps }, { mount: box.querySelector('.teach-mount'), image });
}
// Ask Cassie: the answer shows here, and she points at what she means
function askPage() {
  view.innerHTML = `<div class="card ask-page">
      <p class="hint">Ask Cassie about this tab. She answers here and points at what she means.</p>
      <form class="row"><input class="tall" type="text" placeholder="Ask about this page…" aria-label="Your question about this page"><button class="btn tall" type="submit">Ask</button></form>
      <div class="answer" aria-live="polite"></div>
    </div><div class="teach-box"></div>`;
  const form = view.querySelector('form'), input = form.querySelector('input'), out = view.querySelector('.answer'), box = view.querySelector('.teach-box');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) { input.focus(); return; }
    out.innerHTML = '';
    // a student at risk: care before anything else, no AI is asked (care.js)
    const hit = window.CassieCare && window.CassieCare.check(q);
    if (hit) {
      renderMd(out, window.CassieCare.reply(hit.lang));
      try { chrome.runtime.sendMessage({ type: 'CASSIE_CARE' }); } catch (err) { /* best effort */ }
      return;
    }
    teach({ q, box, onAnswer: (a) => renderMd(out, a) });
  });
  input.focus();
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

/* Pop out: Cassie floats in a small window that stays on top of every other app (Word, a PDF
   reader, the desktop). The panel itself moves into the window and comes back when it closes.
   Where Chrome doesn't allow that, a small Cassie window opens instead. */
const popBtn = $('#t-pop');
let pipWin = null;
async function popOut() {
  if (pipWin) { try { pipWin.focus(); } catch (e) { /* ignore */ } return; }
  if (FLOATING) return;
  const parts = [$('header'), $('.tools'), view];
  if ('documentPictureInPicture' in window) {
    try {
      const w = await window.documentPictureInPicture.requestWindow({ width: 380, height: 560 });
      w.document.title = 'Cassie';
      document.querySelectorAll('style').forEach((st) => w.document.head.appendChild(st.cloneNode(true)));
      w.document.body.append(...parts);
      const note = document.createElement('div');
      note.className = 'popped';
      note.innerHTML = '<p>Cassie is in her floating window. It stays on top of your other apps.</p><button type="button" class="btn">Bring her back here</button>';
      note.querySelector('button').addEventListener('click', () => w.close());
      document.body.appendChild(note);
      pipWin = w;
      popBtn.setAttribute('aria-pressed', 'true');
      w.addEventListener('pagehide', () => {
        note.remove();
        document.body.append(...parts);
        pipWin = null;
        popBtn.setAttribute('aria-pressed', 'false');
      });
      return;
    } catch (e) { /* not allowed here: a small window instead */ }
  }
  chrome.windows.create({ url: chrome.runtime.getURL('panel.html?float=1'), type: 'popup', width: 400, height: 620 });
}
popBtn.addEventListener('click', popOut);
if (FLOATING) popBtn.hidden = true;

$('#t-snip').addEventListener('click', snip);
$('#t-teach').addEventListener('click', () => teach());
$('#t-ask').addEventListener('click', askPage);
$('#t-file').addEventListener('click', wholeFile);
$('#t-board').addEventListener('click', () => openBoard(null));
home();
chrome.storage.session.get('cassieJob').then((o) => handleJob(o.cassieJob)).catch(() => {});

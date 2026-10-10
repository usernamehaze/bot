/* The landing page you can play with: every feature is a small working demo.
   - Try it: highlight (or tap) any word in the page and Cassie's popup explains it, quizzes you
     on it, or makes a flashcard (the answers here are written ahead — the app answers anything).
   - The desk: Snip a graph, drop a file for a reviewer, hear her voice, and the REAL Labs, 3D
     space, rocket, atlas and puzzles from the app, running right on this page.
   - Everything else: flip cards, a quiz, a timer, levels, citations, a shared board, memory…
   No network calls except the labs' own (the atlas asks Wikipedia when you look something up). */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, reduce ? Math.min(ms, 30) : ms));
const toast = (msg) => { const t = $('#toast'); if (!t) return; t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 3200); };
// type text into an element a few letters at a time
async function typeInto(el, text, cps = 70, token) {
  el.textContent = '';
  for (let i = 0; i < text.length; i += 3) {
    if (token && token.dead) return;
    el.textContent = text.slice(0, i + 3);
    await sleep(3000 / cps);
  }
  el.textContent = text;
}
const mini = (host, state = 'idle', opts = {}) => (window.CassieBot && host ? window.CassieBot.create(host, { state, ...opts }) : { setState() {}, pause() {}, setAccessory() {}, look() {} });

/* =============================== 1. Try it: highlight anything =============================== */
const TERMS = {
  mitochondria: {
    explain: 'Mitochondria are the cell’s power stations. They take glucose from your food and oxygen from your breath and turn them into ATP, the energy every part of the cell spends. Muscle cells have thousands of them.',
    quiz: ['What do mitochondria make?', ['ATP — the cell’s energy', 'Proteins', 'DNA'], 0],
    card: ['Mitochondria', 'The cell part that turns glucose + oxygen into ATP (energy). “The powerhouse of the cell.”'],
  },
  'cellular respiration': {
    explain: 'Cellular respiration is how cells “burn” food without fire: glucose + oxygen → carbon dioxide + water + energy (ATP). It happens in the mitochondria — and it’s why you breathe out CO₂.',
    quiz: ['Which gas does cellular respiration give off?', ['Oxygen', 'Carbon dioxide', 'Nitrogen'], 1],
    card: ['Cellular respiration', 'glucose + oxygen → carbon dioxide + water + ATP, in the mitochondria'],
  },
  atp: {
    explain: 'ATP (adenosine triphosphate) is the cell’s energy coin. Breaking off one of its three phosphate groups releases energy for moving muscles, sending nerve signals and building molecules.',
    quiz: ['ATP is best described as…', ['A sugar we eat', 'The cell’s energy carrier', 'A kind of cell'], 1],
    card: ['ATP', 'Adenosine triphosphate: the molecule that carries energy inside cells'],
  },
  glucose: {
    explain: 'Glucose (C₆H₁₂O₆) is a simple sugar — the main fuel your cells burn. Plants make it by photosynthesis; you get it from food like rice and bread.',
    quiz: ['Where do plants get their glucose?', ['From the soil', 'They make it by photosynthesis', 'From rain'], 1],
    card: ['Glucose', 'C₆H₁₂O₆ — a simple sugar, the cell’s main fuel'],
  },
  photosynthesis: {
    explain: 'Photosynthesis is how plants make food: carbon dioxide + water + sunlight → glucose + oxygen. It happens in the chloroplasts, and it’s where almost all the oxygen you breathe comes from.',
    quiz: ['What does photosynthesis give off?', ['Oxygen', 'Carbon dioxide', 'Glucose only'], 0],
    card: ['Photosynthesis', 'CO₂ + water + light → glucose + oxygen, in the chloroplasts'],
  },
  'carbon dioxide': {
    explain: 'Carbon dioxide (CO₂) is a gas made of one carbon and two oxygen atoms. You breathe it out; plants take it in for photosynthesis. It’s also a greenhouse gas that traps heat.',
    quiz: ['Plants take in carbon dioxide to…', ['Breathe it out again', 'Make glucose', 'Make chlorophyll'], 1],
    card: ['Carbon dioxide', 'CO₂ — breathed out by us, taken in by plants for photosynthesis'],
  },
  chlorophyll: {
    explain: 'Chlorophyll is the green pigment in leaves. It absorbs red and blue light to power photosynthesis and reflects green — which is the colour you see.',
    quiz: ['Why do leaves look green?', ['Chlorophyll reflects green light', 'They absorb green light', 'The sap is green'], 0],
    card: ['Chlorophyll', 'The green pigment that absorbs red & blue light for photosynthesis'],
  },
  cell: {
    explain: 'A cell is the smallest living unit — every living thing is made of one or more. Your body has about 37 trillion of them, each with its own power stations (mitochondria).',
    quiz: ['About how many cells are in a human body?', ['37 thousand', '37 million', '37 trillion'], 2],
    card: ['Cell', 'The smallest unit of life; humans have about 37 trillion'],
  },
};
const ALIAS = { mitochondrion: 'mitochondria', respiration: 'cellular respiration', 'co₂': 'carbon dioxide', co2: 'carbon dioxide', cells: 'cell', leaf: 'chlorophyll', green: 'chlorophyll' };
function termFor(text) {
  const t = text.toLowerCase().replace(/[^\p{L}\s₂0-9]/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  if (TERMS[t]) return t;
  if (ALIAS[t]) return ALIAS[t];
  return Object.keys(TERMS).find((k) => t.includes(k)) || Object.keys(ALIAS).find((k) => t.includes(k) && ALIAS[k]) && ALIAS[Object.keys(ALIAS).find((k) => t.includes(k))] || null;
}
function tryIt() {
  const page = $('#try-page'), pop = $('#try-pop');
  if (!page || !pop) return;
  const bot = mini($('#try-bot'), 'idle', { glow: true });
  let token = { dead: true }, chosen = '', shown = false;
  const out = $('.tp-out', pop), acts = $$('[data-act]', pop), head = $('.tp-q', pop);
  function place(rect) {
    const box = page.getBoundingClientRect(), w = Math.min(340, box.width - 20);
    pop.style.width = w + 'px';
    let x = rect.left - box.left + rect.width / 2 - w / 2, y = rect.bottom - box.top + 12;
    x = Math.max(10, Math.min(box.width - w - 10, x));
    pop.style.left = x + 'px'; pop.style.top = y + 'px';
  }
  function open(text, rect) {
    chosen = text.trim().replace(/\s+/g, ' ').slice(0, 80);
    if (!chosen) return;
    place(rect);
    pop.hidden = false; shown = true;
    head.innerHTML = `What should I do with <b>“${esc(chosen)}”</b>?`;
    out.replaceChildren(); out.hidden = true;
    acts.forEach((b) => b.classList.remove('on'));
    bot.setState('highlighting');
    $('#try-hint').classList.add('done');
  }
  async function act(kind) {
    token.dead = true; token = { dead: false };
    const my = token, key = termFor(chosen), T = key && TERMS[key];
    acts.forEach((b) => b.classList.toggle('on', b.dataset.act === kind));
    out.hidden = false; out.className = 'tp-out';
    bot.setState('thinking');
    out.innerHTML = '<span class="tp-dots"><i></i><i></i><i></i></span>';
    await sleep(650);
    if (my.dead) return;
    bot.setState('talking');
    if (!T) {
      out.innerHTML = `<p></p><a class="tp-open" href="start.html">Ask Cassie about “${esc(chosen)}” in the app →</a>`;
      await typeInto($('p', out), 'In this demo I only know the words in bold. In the app I explain anything you pick — any website, PDF or photo.', 90, my);
    } else if (kind === 'explain') {
      out.innerHTML = '<p></p>';
      await typeInto($('p', out), T.explain, 90, my);
    } else if (kind === 'quiz') {
      const [q, opts, right] = T.quiz;
      out.innerHTML = `<p class="tp-quiz">${esc(q)}</p><div class="tp-opts">${opts.map((o, i) => `<button type="button" data-o="${i}">${esc(o)}</button>`).join('')}</div><p class="tp-fb" hidden></p>`;
      $$('[data-o]', out).forEach((b) => b.addEventListener('click', () => {
        const ok = +b.dataset.o === right;
        $$('[data-o]', out).forEach((x) => { x.disabled = true; x.classList.toggle('right', +x.dataset.o === right); });
        if (!ok) b.classList.add('wrong');
        const fb = $('.tp-fb', out); fb.hidden = false; fb.textContent = ok ? 'Yes! That’s it.' : `Not quite — it’s “${opts[right]}”.`;
        bot.setState(ok ? 'proud' : 'encourage');
      }));
    } else {
      const [front, back] = T.card;
      out.innerHTML = `<button type="button" class="tp-card"><span class="f">${esc(front)}<small>tap to flip</small></span><span class="b">${esc(back)}</span></button><p class="tp-note">Saved to your deck — in the app it comes back right before you’d forget it.</p>`;
      $('.tp-card', out).addEventListener('click', (e) => e.currentTarget.classList.toggle('flip'));
    }
    if (!my.dead) setTimeout(() => { if (!my.dead) bot.setState('idle'); }, 1800);
  }
  acts.forEach((b) => b.addEventListener('click', () => act(b.dataset.act)));
  $('.tp-x', pop).addEventListener('click', () => { pop.hidden = true; shown = false; token.dead = true; bot.setState('idle'); });
  // a mouse selection
  page.addEventListener('mouseup', (e) => e.target.closest('#try-pop') || setTimeout(() => {
    const sel = getSelection();
    if (!sel || sel.isCollapsed || !page.contains(sel.anchorNode)) return;
    const text = String(sel); if (text.trim().length < 2) return;
    open(text, sel.getRangeAt(0).getBoundingClientRect());
  }, 10));
  // a tap on a word (phones): select that word, or the bold term it's part of
  page.addEventListener('click', (e) => {
    if (e.target.closest('#try-pop')) return;
    const sel = getSelection(); if (sel && !sel.isCollapsed && String(sel).trim().length > 1) return;
    const b = e.target.closest('b[data-term]');
    let range = null;
    if (b) { range = document.createRange(); range.selectNodeContents(b); }
    else {
      const pos = document.caretRangeFromPoint ? document.caretRangeFromPoint(e.clientX, e.clientY) : document.caretPositionFromPoint && (() => { const p = document.caretPositionFromPoint(e.clientX, e.clientY); if (!p) return null; const r = document.createRange(); r.setStart(p.offsetNode, p.offset); return r; })();
      if (!pos || pos.startContainer.nodeType !== 3 || !page.contains(pos.startContainer)) return;
      const node = pos.startContainer, s = node.textContent; let a = pos.startOffset, z = pos.startOffset;
      while (a > 0 && /[\p{L}\p{N}₂-]/u.test(s[a - 1])) a--;
      while (z < s.length && /[\p{L}\p{N}₂-]/u.test(s[z])) z++;
      if (z - a < 2) return;
      range = document.createRange(); range.setStart(node, a); range.setEnd(node, z);
    }
    sel.removeAllRanges(); sel.addRange(range);
    open(String(range), range.getBoundingClientRect());
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && shown) $('.tp-x', pop).click(); });
  // invite: a little cursor highlights "mitochondria" once, to show what to do
  if (!reduce && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver(([en]) => { if (en.isIntersecting) { io.disconnect(); setTimeout(() => $('#try-hint').classList.add('play'), 600); } }, { threshold: 0.6 });
    io.observe(page);
  }
}

/* =============================== 2. The desk (main features) =============================== */
const DEMOS = {};
let current = null, showDemo = () => {};
function desk() {
  const tabs = $$('#desk [data-demo]'), stage = $('#desk-stage');
  if (!tabs.length || !stage) return;
  async function show(id) {
    if (current && current.id === id) return;
    if (current && current.destroy) { try { current.destroy(); } catch (e) { /* ignore */ } }
    tabs.forEach((t) => t.setAttribute('aria-selected', String(t.dataset.demo === id)));
    stage.replaceChildren();
    stage.dataset.demo = id;
    current = { id };
    try { current = Object.assign(current, await DEMOS[id](stage)); } catch (e) { stage.innerHTML = '<p class="dk-err">This demo couldn’t start here — open Cassie to try it.</p>'; }
  }
  showDemo = show;
  tabs.forEach((t) => t.addEventListener('click', () => show(t.dataset.demo)));
  // keyboard: arrows move between tabs
  $('#desk .dk-tabs').addEventListener('keydown', (e) => {
    const i = tabs.findIndex((t) => t === document.activeElement); if (i < 0) return;
    const j = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? (i + 1) % tabs.length : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? (i + tabs.length - 1) % tabs.length : -1;
    if (j >= 0) { e.preventDefault(); tabs[j].focus(); tabs[j].click(); }
  });
  // start the first demo when the desk comes into view (so nothing heavy runs before)
  const io = new IntersectionObserver(([en]) => { if (en.isIntersecting) { io.disconnect(); show(tabs[0].dataset.demo); } }, { rootMargin: '200px' });
  io.observe(stage);
}

/* --- Snip a graph → Cassie's board --- */
DEMOS.snip = async (stage) => {
  stage.innerHTML = `<div class="sn">
    <div class="sn-page"><p class="sn-q"><b>Problem 4.</b> Find the roots and the vertex of the graph below.</p><canvas class="sn-cv" width="520" height="340" aria-label="A graph of y = x² − 2x − 3"></canvas><div class="sn-box" hidden></div>
      <p class="sn-tip">Drag a box around the graph to snip it — or <button type="button" class="sn-auto">snip it for me</button></p></div>
    <aside class="sn-board" hidden><div class="sn-bh"><span>Cassie’s board</span><i class="sn-bot"></i></div><canvas class="sn-bc" width="420" height="300"></canvas><ol class="sn-steps"></ol></aside></div>`;
  const cv = $('.sn-cv', stage), g = cv.getContext('2d');
  const W = 520, H = 340, X = (x) => 60 + (x + 3) * 60, Y = (y) => 40 + (6 - y) * 24;
  const f = (x) => x * x - 2 * x - 3;
  function axes(c, w, h, X, Y) {
    c.strokeStyle = '#cfcac0'; c.lineWidth = 1;
    for (let x = -3; x <= 5; x++) { c.beginPath(); c.moveTo(X(x), Y(6)); c.lineTo(X(x), Y(-5)); c.stroke(); }
    for (let y = -5; y <= 6; y++) { c.beginPath(); c.moveTo(X(-3), Y(y)); c.lineTo(X(5), Y(y)); c.stroke(); }
    c.strokeStyle = '#121117'; c.lineWidth = 2; c.beginPath(); c.moveTo(X(-3), Y(0)); c.lineTo(X(5), Y(0)); c.moveTo(X(0), Y(6)); c.lineTo(X(0), Y(-5)); c.stroke();
  }
  axes(g, W, H, X, Y);
  g.strokeStyle = '#121117'; g.lineWidth = 3; g.beginPath(); for (let x = -2.2; x <= 4.2; x += 0.05) { const px = X(x), py = Y(f(x)); x === -2.2 ? g.moveTo(px, py) : g.lineTo(px, py); } g.stroke();
  g.fillStyle = '#121117'; g.font = '600 15px Inter, sans-serif'; g.fillText('y = x² − 2x − 3', X(1.6), Y(5.4));
  const box = $('.sn-box', stage), page = $('.sn-page', stage);
  let start = null, done = false, dead = false;
  const rel = (e) => { const r = page.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  page.addEventListener('pointerdown', (e) => { if (done || e.target.closest('button')) return; start = rel(e); box.hidden = false; Object.assign(box.style, { left: start[0] + 'px', top: start[1] + 'px', width: '0px', height: '0px' }); page.setPointerCapture(e.pointerId); e.preventDefault(); });
  page.addEventListener('pointermove', (e) => { if (!start) return; const [x, y] = rel(e); Object.assign(box.style, { left: Math.min(x, start[0]) + 'px', top: Math.min(y, start[1]) + 'px', width: Math.abs(x - start[0]) + 'px', height: Math.abs(y - start[1]) + 'px' }); });
  page.addEventListener('pointerup', (e) => { if (!start) return; const [x, y] = rel(e); const big = Math.abs(x - start[0]) > 30 && Math.abs(y - start[1]) > 30; start = null; if (big) solve(); else box.hidden = true; });
  $('.sn-auto', stage).addEventListener('click', () => { const c = cv.getBoundingClientRect(), p = page.getBoundingClientRect(); box.hidden = false; Object.assign(box.style, { left: c.left - p.left + 'px', top: c.top - p.top + 'px', width: c.width + 'px', height: c.height + 'px' }); solve(); });
  async function solve() {
    if (done) return; done = true;
    box.classList.add('snapped');
    const board = $('.sn-board', stage); board.hidden = false;
    const bot = mini($('.sn-bot', stage), 'thinking');
    const bc = $('.sn-bc', stage), b = bc.getContext('2d'), BX = (x) => 30 + (x + 3) * 45, BY = (y) => 20 + (6 - y) * 23;
    axes(b, 420, 300, BX, BY);
    const steps = $('.sn-steps', stage);
    const say = async (t) => { const li = document.createElement('li'); steps.appendChild(li); await typeInto(li, t, 110); };
    await sleep(500); if (dead) return; bot.setState('drawing');
    b.strokeStyle = '#2f6fd6'; b.lineWidth = 3; b.beginPath();
    for (let k = 0; k <= 128; k++) { const x = -2.2 + k * 0.05, px = BX(x), py = BY(f(x)); k ? b.lineTo(px, py) : b.moveTo(px, py); if (k % 8 === 0 || k === 128) { b.stroke(); b.beginPath(); b.moveTo(px, py); await sleep(40); if (dead) return; } }
    await say('Set y = 0: x² − 2x − 3 = 0');
    await say('Factor: (x − 3)(x + 1) = 0 → x = 3 or x = −1');
    for (const r of [-1, 3]) { b.fillStyle = '#d93a3a'; b.beginPath(); b.arc(BX(r), BY(0), 6, 0, Math.PI * 2); b.fill(); }
    await say('Vertex at x = −b ÷ 2a = 2 ÷ 2 = 1, so y = 1 − 2 − 3 = −4');
    b.fillStyle = '#2e9e5b'; b.beginPath(); b.arc(BX(1), BY(-4), 6, 0, Math.PI * 2); b.fill();
    b.fillStyle = '#121117'; b.font = '600 13px Inter, sans-serif'; b.fillText('(−1, 0)', BX(-1) - 52, BY(0) - 8); b.fillText('(3, 0)', BX(3) + 8, BY(0) - 8); b.fillText('vertex (1, −4)', BX(1) + 10, BY(-4) + 4);
    await say('Now you try: where does it cross the y-axis?');
    bot.setState('done');
    const again = document.createElement('button'); again.type = 'button'; again.className = 'dk-btn'; again.textContent = 'Snip again';
    again.addEventListener('click', () => { dead = true; current = null; showDemo('snip'); });
    steps.after(again);
  }
  return { destroy() { dead = true; } };
};

/* --- Drop a file → reviewer --- */
DEMOS.files = async (stage) => {
  stage.innerHTML = `<div class="fl">
    <div class="fl-files"><p class="fl-tip">Drag a file onto Cassie — or tap one</p>
      <button type="button" class="fl-file" data-f="pptx" draggable="true"><span class="ico">PPT</span><span>Cell Biology.pptx<small>47 slides</small></span></button>
      <button type="button" class="fl-file" data-f="pdf" draggable="true"><span class="ico">PDF</span><span>Module 6 — Ecosystems.pdf<small>18 pages</small></span></button>
      <button type="button" class="fl-file" data-f="jpg" draggable="true"><span class="ico">JPG</span><span>my-notes.jpg<small>a photo of handwritten notes</small></span></button></div>
    <div class="fl-drop" tabindex="-1"><div class="fl-bot"></div><div class="fl-pill" hidden></div></div>
    <article class="fl-rev" hidden></article></div>`;
  const bot = mini($('.fl-bot', stage), 'upload', { glow: true });
  const FILES = {
    pptx: { n: 'Cell Biology.pptx', unit: 'slide', of: 47, title: 'Reviewer — Cell Biology', body: [['The cell', ['Smallest unit of life; all living things are made of cells (cell theory)', 'Prokaryotic (no nucleus: bacteria) vs eukaryotic (nucleus: plants, animals)']], ['Organelles', ['**Nucleus** — holds DNA; controls the cell (slide 9)', '**Mitochondria** — make ATP by cellular respiration (slide 14)', '**Chloroplasts** — photosynthesis, plants only (slide 17)', '**Ribosomes** — make proteins (slide 21)']], ['Practice', ['1. Which organelle makes ATP?', '2. Name two parts only plant cells have.']]] },
    pdf: { n: 'Module 6 — Ecosystems.pdf', unit: 'page', of: 18, title: 'Reviewer — Ecosystems', body: [['Key terms', ['**Producer** — makes its own food (plants, algae)', '**Consumer** — eats other organisms', '**Decomposer** — breaks down dead matter (fungi, bacteria)']], ['Energy flow', ['Sun → producers → herbivores → carnivores', 'Only about **10%** of energy passes to each next level (p. 7)']], ['Practice', ['1. Why are there fewer top predators than plants?', '2. Give one example of a decomposer.']]] },
    jpg: { n: 'my-notes.jpg', unit: 'line', of: 24, title: 'Your notes, typed up', body: [['Fractions', ['To add: make the bottoms the same → ½ + ⅓ = 3⁄6 + 2⁄6 = 5⁄6', 'To multiply: tops × tops, bottoms × bottoms']], ['Check', ['Your note says ¾ × ⅔ = 6⁄7 — it’s **6⁄12 = ½** (multiply the bottoms too)']]] },
  };
  const drop = $('.fl-drop', stage), pill = $('.fl-pill', stage), rev = $('.fl-rev', stage);
  let busy = false, dead = false;
  async function read(k) {
    if (busy) return; busy = true;
    const F = FILES[k]; rev.hidden = true; pill.hidden = false;
    $$('.fl-file', stage).forEach((b) => b.classList.toggle('on', b.dataset.f === k));
    bot.setState('reading');
    pill.textContent = `Opening ${F.n}…`; await sleep(700);
    for (let i = 1; i <= F.of; i += Math.ceil(F.of / 9)) { if (dead) return; pill.textContent = `Reading ${F.unit} ${i} of ${F.of}…`; await sleep(140); }
    pill.textContent = 'Writing your reviewer…'; bot.setState('writing'); await sleep(600);
    if (dead) return;
    pill.textContent = '✓ Reviewer ready'; bot.setState('done');
    rev.hidden = false;
    rev.innerHTML = `<h4>${esc(F.title)}</h4>${F.body.map(([h, lines]) => `<p class="fl-h">${esc(h)}</p><ul>${lines.map((l) => `<li>${esc(l).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')}</li>`).join('')}</ul>`).join('')}
      <div class="fl-save"><span>Save as</span><button type="button" data-s="Word">Word</button><button type="button" data-s="PDF">PDF</button><button type="button" data-s="an image">Image</button></div>`;
    $$('.fl-rev li, .fl-rev .fl-h', stage).forEach((el, i) => { el.style.animationDelay = i * 0.07 + 's'; });
    $$('[data-s]', rev).forEach((b) => b.addEventListener('click', () => toast(`In the app this saves a real ${b.dataset.s} file of your reviewer.`)));
    busy = false;
  }
  $$('.fl-file', stage).forEach((b) => {
    b.addEventListener('click', () => read(b.dataset.f));
    b.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', b.dataset.f); bot.setState('surprised'); });
  });
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); const k = e.dataTransfer.getData('text/plain'); if (FILES[k]) read(k); else toast('In the app you can drop any PDF, PowerPoint, Word file or photo.'); });
  return { destroy() { dead = true; } };
};

/* --- Talk with Cassie: her real voice (Bella) --- */
DEMOS.talk = async (stage) => {
  const TALKS = [
    { mode: 'Chat', you: 'Why is the sky blue?', src: 'landing/voice/talk-sky.m4a', say: 'Great question! Sunlight has every colour in it. Air scatters the short blue waves the most, so blue light reaches you from all over the sky.' },
    { mode: 'Teach Cassie', you: 'So — photosynthesis makes glucose from sunlight.', src: 'landing/voice/talk-teach.m4a', say: 'Ooh, okay! But what else does the plant need, besides sunlight? And where does the oxygen come from?' },
    { mode: 'Quiz me', you: 'Quiz me on fractions.', src: 'landing/voice/talk-quiz.m4a', say: 'Sure! Here’s your first one. What is one half plus one third? Take your time.' },
  ];
  stage.innerHTML = `<div class="tk"><div class="tk-modes" role="tablist">${TALKS.map((t, i) => `<button type="button" role="tab" data-t="${i}" aria-selected="${i === 0}">${t.mode}</button>`).join('')}</div>
    <div class="tk-bot"></div><div class="tk-wave" aria-hidden="true">${'<i></i>'.repeat(28)}</div>
    <p class="tk-you"></p><p class="tk-say" aria-live="polite"></p>
    <button type="button" class="tk-mic" aria-label="Play"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg><span>Hear Cassie answer</span></button>
    <p class="tk-note">Her real voice, made on your own device in the app — no robot voice. In the app you just talk.</p></div>`;
  const bot = mini($('.tk-bot', stage), 'listening', { glow: true });
  const audio = new Audio(); audio.preload = 'none';
  let k = 0, raf = 0, dead = false;
  const sayEl = $('.tk-say', stage), you = $('.tk-you', stage), mic = $('.tk-mic', stage), wave = $$('.tk-wave i', stage);
  function pick(i) { k = i; audio.pause(); cancelAnimationFrame(raf); bot.setState('listening'); stage.classList.remove('speaking'); $$('[data-t]', stage).forEach((b) => b.setAttribute('aria-selected', String(+b.dataset.t === i))); you.textContent = '“' + TALKS[i].you + '”'; sayEl.innerHTML = ''; mic.querySelector('span').textContent = 'Hear Cassie answer'; }
  function karaoke() {
    const t = TALKS[k], words = t.say.split(' '), p = audio.duration ? audio.currentTime / audio.duration : 0, n = Math.round(words.length * p);
    sayEl.innerHTML = words.map((w, i) => `<span class="${i < n ? 'on' : ''}">${esc(w)}</span>`).join(' ');
    wave.forEach((b, i) => { b.style.transform = `scaleY(${audio.paused ? 0.15 : 0.25 + Math.abs(Math.sin(performance.now() / 120 + i * 0.7)) * (0.55 + 0.3 * Math.sin(i))})`; });
    if (!audio.paused && !dead) raf = requestAnimationFrame(karaoke);
  }
  mic.addEventListener('click', () => {
    if (!audio.paused) { audio.pause(); return; }
    if (!audio.src.endsWith(TALKS[k].src)) audio.src = TALKS[k].src;
    bot.setState('thinking'); stage.classList.add('speaking');
    audio.play().then(() => { bot.setState('talking'); mic.querySelector('span').textContent = 'Pause'; karaoke(); }).catch(() => { sayEl.textContent = TALKS[k].say; bot.setState('talking'); });
  });
  audio.addEventListener('ended', () => { bot.setState('listening'); stage.classList.remove('speaking'); mic.querySelector('span').textContent = 'Hear it again'; sayEl.innerHTML = esc(TALKS[k].say); wave.forEach((b) => { b.style.transform = ''; }); });
  audio.addEventListener('pause', () => { if (!audio.ended) { mic.querySelector('span').textContent = 'Keep listening'; bot.setState('idle'); } });
  $$('[data-t]', stage).forEach((b) => b.addEventListener('click', () => pick(+b.dataset.t)));
  pick(0);
  return { destroy() { dead = true; audio.pause(); audio.src = ''; cancelAnimationFrame(raf); } };
};

/* --- The real Labs, running here --- */
let labsCss = false;
async function mountLab(stage, loadLab, { tall = false } = {}) {
  if (!labsCss) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'labs/labs.css?v=5'; document.head.appendChild(l); labsCss = true; }
  stage.innerHTML = `<div class="labs labs-embed${tall ? ' tall' : ''}"><div class="lab-body"><div class="lab-stage"></div><aside class="lab-panel"><div class="lab-controls"></div></aside></div></div>`;
  const lab = await loadLab();
  const api = { check() {}, finish: async () => null, doneToday: () => null };
  const m = lab.mount({ stage: $('.lab-stage', stage), panel: $('.lab-controls', stage), api }) || {};
  return m;
}
function labPicker(stage, items, note) {
  stage.innerHTML = `<div class="lp"><div class="lp-chips" role="tablist">${items.map((it, i) => `<button type="button" role="tab" data-i="${i}" aria-selected="${i === 0}">${it.name}</button>`).join('')}</div><div class="lp-host"></div><p class="lp-note">${note}</p></div>`;
  const host = $('.lp-host', stage);
  let m = null, seq = 0;
  async function go(i) {
    const my = ++seq;
    $$('[data-i]', stage).forEach((b) => b.setAttribute('aria-selected', String(+b.dataset.i === i)));
    if (m && m.destroy) { try { m.destroy(); } catch (e) { /* ignore */ } } m = null;
    host.innerHTML = '<p class="dk-wait">Loading…</p>';
    try { const mm = await mountLab(host, items[i].load, items[i]); if (my !== seq) { if (mm.destroy) mm.destroy(); return; } m = mm; } catch (e) { host.innerHTML = '<p class="dk-err">This one couldn’t start here — open it in Cassie’s Labs.</p>'; }
  }
  $$('[data-i]', stage).forEach((b) => b.addEventListener('click', () => go(+b.dataset.i)));
  go(0);
  return { destroy() { seq++; if (m && m.destroy) m.destroy(); } };
}
const pickLab = (mod, name, id) => async () => (await import(mod))[name].find((l) => l.id === id);
DEMOS.labs = async (stage) => labPicker(stage, [
  { name: 'Launch a ball', load: pickLab('../labs/physics.js', 'PHYSICS', 'projectile') },
  { name: 'Flip & roll', load: pickLab('../labs/math.js', 'MATH', 'chance') },
  { name: 'Mix colours', load: pickLab('../labs/physics2.js', 'PHYSICS2', 'colour') },
  { name: 'pH mixer', load: pickLab('../labs/chemistry.js', 'CHEMISTRY', 'ph') },
  { name: 'Build an atom', load: pickLab('../labs/chemistry.js', 'CHEMISTRY', 'atom') },
  { name: 'Pea genetics', load: pickLab('../labs/biology.js', 'BIOLOGY', 'punnett') },
], 'These are the real Labs from the app — 29 experiments, from pendulums to Punnett squares, plus 7 daily puzzles. Then tap <b>Ask Cassie</b> in the app and she explains <i>your</i> experiment.');
DEMOS.space = async (stage) => {
  stage.innerHTML = `<div class="sp"><div class="sp-cover"><div class="sp-planets" aria-hidden="true"><i></i><i></i><i></i><i></i></div><h3>Space and rockets, in 3D</h3><p>The planets where they really are today — then zoom out to the Milky Way, our neighbour galaxies and the whole universe. Or build a rocket and launch it.</p>
    <div class="sp-go"><button type="button" class="dk-btn main" data-go="space">Fly through space</button><button type="button" class="dk-btn" data-go="rocket">Launch a rocket</button></div><small>Loads a 3D view (about 1 MB)</small></div></div>`;
  let inner = null;
  $$('[data-go]', stage).forEach((b) => b.addEventListener('click', () => {
    inner = labPicker(stage, b.dataset.go === 'space'
      ? [{ name: 'Solar system & beyond', load: async () => (await import('../labs/space3d.js')).space3dLab, tall: true }, { name: 'Rocket', load: pickLab('../labs/physics2.js', 'PHYSICS2', 'rocket'), tall: true }]
      : [{ name: 'Rocket', load: pickLab('../labs/physics2.js', 'PHYSICS2', 'rocket'), tall: true }, { name: 'Solar system & beyond', load: async () => (await import('../labs/space3d.js')).space3dLab, tall: true }],
    'Drag to turn, pinch or scroll to zoom, tap a planet. In the app there’s also the human body and cells in 3D.');
  }));
  return { destroy() { if (inner) inner.destroy(); } };
};
DEMOS.atlas = async (stage) => labPicker(stage, [{ name: 'World atlas', load: async () => (await import('../labs/atlas.js')).atlasLab }],
  'Tap a country for its flag, capital, population and history — or search any place.');
DEMOS.puzzles = async (stage) => labPicker(stage, [
  { name: 'Sudoku', load: pickLab('../labs/puzzles.js', 'PUZZLES', 'sudoku') },
  { name: 'Bridges', load: pickLab('../labs/puzzles.js', 'PUZZLES', 'hashi') },
  { name: 'Laser mirrors', load: pickLab('../labs/puzzles.js', 'PUZZLES', 'mirrors') },
  { name: 'Guess the equation', load: pickLab('../labs/puzzles.js', 'PUZZLES', 'equation') },
  { name: 'Geography', load: pickLab('../labs/puzzles.js', 'PUZZLES', 'geography') },
], 'Today’s puzzles are the same for everyone, with a score board in the app. These are fresh practice ones.');

/* =============================== 3. Everything else: little toys =============================== */
function toys() {
  // flashcards that flip, with spaced repetition
  const fc = $('#toy-cards');
  if (fc) {
    const CARDS = [['What does the mitochondria make?', 'ATP — the cell’s energy'], ['½ + ⅓ = ?', '⅚ (3⁄6 + 2⁄6)'], ['Capital of Japan?', 'Tokyo'], ['H₂O is…', 'Water: two hydrogen atoms, one oxygen']];
    let i = 0;
    const card = $('.fc-card', fc), next = (gap) => { $('.fc-due', fc).textContent = gap; i = (i + 1) % CARDS.length; card.classList.remove('flip'); setTimeout(draw, 180); };
    const draw = () => { $('.f', card).textContent = CARDS[i][0]; $('.b', card).textContent = CARDS[i][1]; $('.fc-n', fc).textContent = `${i + 1} / ${CARDS.length}`; };
    card.addEventListener('click', () => card.classList.toggle('flip'));
    $('[data-k="again"]', fc).addEventListener('click', () => next('Again — back in 1 minute'));
    $('[data-k="good"]', fc).addEventListener('click', () => next('Good — back in 3 days'));
    draw();
  }
  // a quiz question
  const qz = $('#toy-quiz');
  if (qz) $$('[data-a]', qz).forEach((b) => b.addEventListener('click', () => {
    $$('[data-a]', qz).forEach((x) => { x.disabled = true; x.classList.toggle('right', x.dataset.a === '1'); });
    if (b.dataset.a !== '1') b.classList.add('wrong');
    $('.qz-fb', qz).textContent = b.dataset.a === '1' ? 'Right! Light, water and CO₂ in — glucose and oxygen out.' : 'Close! Oxygen is what comes out. Cassie would explain why, then ask another.';
  }));
  // focus timer
  const tm = $('#toy-timer');
  if (tm) {
    let left = 25 * 60, on = null, total = 25 * 60;
    const ring = $('.tm-ring', tm), lab = $('.tm-t', tm), btn = $('.tm-go', tm);
    const draw = () => { lab.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`; ring.style.setProperty('--p', String(1 - left / total)); };
    btn.addEventListener('click', () => {
      if (on) { clearInterval(on); on = null; btn.textContent = 'Start'; return; }
      btn.textContent = 'Pause';
      on = setInterval(() => { left = Math.max(0, left - 1); draw(); if (!left) { clearInterval(on); on = null; lab.textContent = 'Break!'; btn.textContent = 'Start'; left = total; } }, 1000);
    });
    $$('[data-min]', tm).forEach((b) => b.addEventListener('click', () => { total = left = +b.dataset.min * 60; $$('[data-min]', tm).forEach((x) => x.classList.toggle('on', x === b)); draw(); }));
    draw();
  }
  // your level
  const lv = $('#toy-level');
  if (lv) {
    const SAY = {
      5: 'Plants are like little kitchens. They use sunlight, water and air to cook their own food — a kind of sugar. And while they cook, they give us fresh oxygen to breathe!',
      10: 'Photosynthesis turns light energy into chemical energy. In the chloroplasts, chlorophyll captures light to combine carbon dioxide and water into glucose, releasing oxygen: 6CO₂ + 6H₂O → C₆H₁₂O₆ + 6O₂.',
      13: 'Photosynthesis couples the light-dependent reactions (photolysis of water at photosystem II, producing ATP and NADPH via the electron transport chain) to the Calvin cycle, where RuBisCO fixes CO₂ into G3P.',
    };
    $$('[data-lv]', lv).forEach((b) => b.addEventListener('click', () => { $$('[data-lv]', lv).forEach((x) => x.setAttribute('aria-pressed', String(x === b))); typeInto($('.lv-say', lv), SAY[b.dataset.lv], 140); }));
  }
  // citations
  const ct = $('#toy-cite');
  if (ct) {
    const C = {
      APA: 'Walker, M. P., & Stickgold, R. (2004). Sleep-dependent learning and memory consolidation. <i>Neuron, 44</i>(1), 121–133.',
      MLA: 'Walker, Matthew P., and Robert Stickgold. “Sleep-Dependent Learning and Memory Consolidation.” <i>Neuron</i>, vol. 44, no. 1, 2004, pp. 121–33.',
      IEEE: 'M. P. Walker and R. Stickgold, “Sleep-dependent learning and memory consolidation,” <i>Neuron</i>, vol. 44, no. 1, pp. 121–133, 2004.',
      Chicago: 'Walker, Matthew P., and Robert Stickgold. 2004. “Sleep-Dependent Learning and Memory Consolidation.” <i>Neuron</i> 44 (1): 121–33.',
    };
    $$('[data-c]', ct).forEach((b) => b.addEventListener('click', () => { $$('[data-c]', ct).forEach((x) => x.setAttribute('aria-pressed', String(x === b))); $('.ct-ref', ct).innerHTML = C[b.dataset.c]; }));
  }
  // draw together: your strokes, and a classmate's
  const dw = $('#toy-draw');
  if (dw) {
    const c = $('canvas', dw), g = c.getContext('2d');
    const fit = () => { const r = c.getBoundingClientRect(), d = Math.min(2, devicePixelRatio || 1); c.width = r.width * d; c.height = r.height * d; g.setTransform(d, 0, 0, d, 0, 0); g.lineCap = 'round'; g.lineJoin = 'round'; };
    fit(); new ResizeObserver(fit).observe(c);
    let last = null;
    c.addEventListener('pointerdown', (e) => { const r = c.getBoundingClientRect(); last = [e.clientX - r.left, e.clientY - r.top]; c.setPointerCapture(e.pointerId); e.preventDefault(); });
    c.addEventListener('pointermove', (e) => { if (!last) return; const r = c.getBoundingClientRect(), p = [e.clientX - r.left, e.clientY - r.top]; g.strokeStyle = '#121117'; g.lineWidth = 3; g.beginPath(); g.moveTo(...last); g.lineTo(...p); g.stroke(); last = p; });
    c.addEventListener('pointerup', () => { last = null; });
    // a classmate draws a heart now and then
    let t = 0;
    const friend = () => { const r = c.getBoundingClientRect(), cx = r.width * (0.25 + Math.random() * 0.5), cy = r.height * 0.5, s = 14; g.strokeStyle = '#d93a3a'; g.lineWidth = 3; g.beginPath(); for (let k = 0; k <= 40; k++) { const a = (k / 40) * Math.PI * 2, x = 16 * Math.sin(a) ** 3, y = 13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a); const px = cx + (x * s) / 16, py = cy - (y * s) / 16; k ? g.lineTo(px, py) : g.moveTo(px, py); } g.stroke(); $('.dw-who', dw).textContent = 'Mika drew a heart'; };
    new IntersectionObserver(([en]) => { clearInterval(t); if (en.isIntersecting) { friend(); t = setInterval(friend, 6000); } }).observe(dw);
    $('.dw-clear', dw).addEventListener('click', () => g.clearRect(0, 0, c.width, c.height));
  }
  // memory: remembered things you can forget
  const mm = $('#toy-memory');
  if (mm) mm.addEventListener('click', (e) => { const b = e.target.closest('[data-forget]'); if (!b) return; b.closest('li').classList.add('gone'); setTimeout(() => { b.closest('li').remove(); if (!$('li', mm)) $('ul', mm).innerHTML = '<li class="empty">All forgotten — it was only on this device anyway.</li>'; }, 300); });
  // Student / Professional: Cassie changes outfit
  const pr = $('#toy-pro');
  if (pr) {
    const bot = mini($('.pr-bot', pr), 'greeting');
    const SAY = { student: 'Let’s turn chapter 4 into a reviewer with 10 practice questions.', pro: 'Here’s a crisp summary of the Q3 report, and a draft email to your team.' };
    $$('[data-aud]', pr).forEach((b) => b.addEventListener('click', () => { $$('[data-aud]', pr).forEach((x) => x.setAttribute('aria-pressed', String(x === b))); bot.setAccessory(b.dataset.aud === 'pro' ? 'glasses' : 'gradcap'); bot.setState('wink'); $('.pr-say', pr).textContent = SAY[b.dataset.aud]; }));
    bot.setAccessory('gradcap');
  }
  // the Island: what Cassie is doing, at the top of the screen
  const il = $('#toy-island');
  if (il) {
    const STEPS = [['reading', 'Reading Module 6.pdf · page 4 of 18'], ['thinking', 'Thinking…'], ['writing', 'Writing your reviewer'], ['done', '✓ Reviewer ready — tap to open']];
    const bot = mini($('.il-bot', il), 'reading');
    let k = 0, t = 0;
    const step = () => { const [s, txt] = STEPS[k++ % STEPS.length]; bot.setState(s); $('.il-txt', il).textContent = txt; il.classList.toggle('done', s === 'done'); };
    new IntersectionObserver(([en]) => { clearInterval(t); if (en.isIntersecting) { step(); t = setInterval(step, 1800); } }).observe(il);
  }
}

/* =============================== 0. The hero's laptop and phone =============================== */
// Real Cassie screens take turns on both devices; the tabs under them jump to one.
function heroScreens() {
  const lap = $('.laptop [data-screens]'), phone = $('.phone [data-screens]'), tabs = $$('.dev-tabs [data-screen]');
  if (!lap || !tabs.length) return;
  let i = 0, timer = 0, visible = true;
  const show = (k) => {
    i = (k + tabs.length) % tabs.length;
    $$('img', lap).forEach((im, n) => im.classList.toggle('on', n === i));
    if (phone) { const pi = $$('img', phone); pi.forEach((im, n) => im.classList.toggle('on', n === i % pi.length)); }
    tabs.forEach((t, n) => t.setAttribute('aria-selected', String(n === i)));
  };
  const run = () => { clearInterval(timer); if (!reduce && visible) timer = setInterval(() => show(i + 1), 4200); };
  tabs.forEach((t) => t.addEventListener('click', () => { show(+t.dataset.screen); run(); }));
  new IntersectionObserver(([en]) => { visible = en.isIntersecting; run(); }).observe(lap);
}

/* =============================== start =============================== */
heroScreens();
tryIt();
desk();
toys();

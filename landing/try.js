/* The landing page's one live demo (landing/try.js): a lesson page you can highlight. Select any word, or
   tap a bold one, and Cassie's popup explains it, quizzes you on it, or makes a flashcard. The answers here
   are written ahead (the app answers anything). No network calls. */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, reduce ? Math.min(ms, 30) : ms));
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
    quiz: ['What do mitochondria make?', ['ATP: the cell’s energy', 'Proteins', 'DNA'], 0],
    card: ['Mitochondria', 'The cell part that turns glucose + oxygen into ATP (energy). “The powerhouse of the cell.”'],
  },
  'cellular respiration': {
    explain: 'Cellular respiration is how cells “burn” food without fire: glucose + oxygen → carbon dioxide + water + energy (ATP). It happens in the mitochondria, and it’s why you breathe out CO₂.',
    quiz: ['Which gas does cellular respiration give off?', ['Oxygen', 'Carbon dioxide', 'Nitrogen'], 1],
    card: ['Cellular respiration', 'glucose + oxygen → carbon dioxide + water + ATP, in the mitochondria'],
  },
  atp: {
    explain: 'ATP (adenosine triphosphate) is the cell’s energy coin. Breaking off one of its three phosphate groups releases energy for moving muscles, sending nerve signals and building molecules.',
    quiz: ['ATP is best described as…', ['A sugar we eat', 'The cell’s energy carrier', 'A kind of cell'], 1],
    card: ['ATP', 'Adenosine triphosphate: the molecule that carries energy inside cells'],
  },
  glucose: {
    explain: 'Glucose (C₆H₁₂O₆) is a simple sugar, the main fuel your cells burn. Plants make it by photosynthesis; you get it from food like rice and bread.',
    quiz: ['Where do plants get their glucose?', ['From the soil', 'They make it by photosynthesis', 'From rain'], 1],
    card: ['Glucose', 'C₆H₁₂O₆: a simple sugar, the cell’s main fuel'],
  },
  photosynthesis: {
    explain: 'Photosynthesis is how plants make food: carbon dioxide + water + sunlight → glucose + oxygen. It happens in the chloroplasts, and it’s where almost all the oxygen you breathe comes from.',
    quiz: ['What does photosynthesis give off?', ['Oxygen', 'Carbon dioxide', 'Glucose only'], 0],
    card: ['Photosynthesis', 'CO₂ + water + light → glucose + oxygen, in the chloroplasts'],
  },
  'carbon dioxide': {
    explain: 'Carbon dioxide (CO₂) is a gas made of one carbon and two oxygen atoms. You breathe it out; plants take it in for photosynthesis. It’s also a greenhouse gas that traps heat.',
    quiz: ['Plants take in carbon dioxide to…', ['Breathe it out again', 'Make glucose', 'Make chlorophyll'], 1],
    card: ['Carbon dioxide', 'CO₂: breathed out by us, taken in by plants for photosynthesis'],
  },
  chlorophyll: {
    explain: 'Chlorophyll is the green pigment in leaves. It absorbs red and blue light to power photosynthesis and reflects green, which is the colour you see.',
    quiz: ['Why do leaves look green?', ['Chlorophyll reflects green light', 'They absorb green light', 'The sap is green'], 0],
    card: ['Chlorophyll', 'The green pigment that absorbs red & blue light for photosynthesis'],
  },
  cell: {
    explain: 'A cell is the smallest living unit. Every living thing is made of one or more. Your body has about 37 trillion of them, each with its own power stations (mitochondria).',
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
      await typeInto($('p', out), 'In this demo I only know the words in bold. In the app I explain anything you pick, any website, PDF or photo.', 90, my);
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
        const fb = $('.tp-fb', out); fb.hidden = false; fb.textContent = ok ? 'Yes! That’s it.' : `Not quite. It’s “${opts[right]}”.`;
        bot.setState(ok ? 'proud' : 'encourage');
      }));
    } else {
      const [front, back] = T.card;
      out.innerHTML = `<button type="button" class="tp-card"><span class="f">${esc(front)}<small>tap to flip</small></span><span class="b">${esc(back)}</span></button><p class="tp-note">Saved to your deck. In the app it comes back right before you’d forget it.</p>`;
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

tryIt();

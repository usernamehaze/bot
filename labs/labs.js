/* Cassie's Labs — small simulations to play with, then ask Cassie why they work, and a few
   daily puzzles with a score board.
   Each lab is a canvas you touch plus a few controls. "Ask Cassie" sends her what is on the
   screen right now (the angle you launched at, the cross you made…), so her answer is about
   your experiment, not a textbook in general. "Try this" gives each lab a few small goals:
   tap one for a hint (Cassie can nudge you, without giving it away); they tick themselves
   when you reach them. "How this model works" says what the simulation leaves out, so
   nothing is passed off as more exact than it is.

     import('./labs/labs.js').then((m) => m.open({ lab: 'projectile', onAsk, onQuiz, openExplore, explain, scores }));
*/
import { el, esc, dayKey } from './kit.js';
import { MATH } from './math.js';
import { MATH2 } from './math2.js';
import { PHYSICS } from './physics.js';
import { PHYSICS2 } from './physics2.js';
import { SPACE } from './space.js';
import { CHEMISTRY } from './chemistry.js';
import { CHEMISTRY2 } from './chemistry2.js';
import { BIOLOGY } from './biology.js';
import { PUZZLES } from './puzzles.js';

export const SUBJECTS = [['all', 'All'], ['puzzles', 'Daily puzzles'], ['biology', 'Biology'], ['chemistry', 'Chemistry'], ['physics', 'Physics'], ['math', 'Math']];
const NAMES = { biology: 'Biology', chemistry: 'Chemistry', physics: 'Physics', math: 'Math', puzzles: 'Puzzle' };
// the 3D explorers live in their own viewer; the shelf opens them too
const EXPLORE = [
  { id: 'body3d', name: 'Human body 3D', subject: 'biology', blurb: 'Turn, zoom and pull apart the real body — 10 systems, tap any part.', explore: 'body',
    icon: '<path d="M24 6a4 4 0 1 1 0 8 4 4 0 0 1 0-8z"/><path d="M17 18h14l-2 12h-3l-1 12h-2l-1-12h-3z"/><path d="M17 18l-5 10M31 18l5 10"/>' },
  { id: 'cells3d', name: 'Animal & plant cells', subject: 'biology', blurb: 'Two cells cut open in 3D. Tap an organelle to see what it does.', explore: 'animal',
    icon: '<ellipse cx="24" cy="24" rx="17" ry="14"/><circle cx="22" cy="23" r="6"/><circle cx="22" cy="23" r="2"/><path d="M33 17c2 1 3 3 2 5M12 30c2 2 5 3 7 2"/>' },
];
export const LABS = [...BIOLOGY, ...CHEMISTRY, ...CHEMISTRY2, ...SPACE, ...PHYSICS, ...PHYSICS2, ...MATH, ...MATH2, ...PUZZLES];
const SIMS = LABS.filter((l) => l.subject !== 'puzzles');

let view = null;
export function open(opts = {}) {
  if (!view) view = createView();
  view.open(opts);
  return view;
}

const store = {
  get(k = 'cassie.labs') { try { return JSON.parse(localStorage.getItem(k) || '{}'); } catch (e) { return {}; } },
  set(v, k = 'cassie.labs') { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
};
const CURSOR = '<svg class="labs-cur" viewBox="100 80 305 350" aria-hidden="true"><path d="M108 90 L395 259 L275 281 L342 399 L287 422 L225 300 L108 382 Z" fill="#fff" stroke="#0b0a0f" stroke-width="22" stroke-linejoin="round" paint-order="stroke"/></svg>';
const iconSvg = (inner) => `<svg viewBox="0 0 48 48" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
// the same lab for every student today
function todays() { const k = dayKey(), n = [...k].reduce((s, ch) => s * 31 + ch.charCodeAt(0), 7) >>> 0; return SIMS[n % SIMS.length]; }

function createView() {
  // the labs' own look loads with them (the app stays light until Labs is opened)
  if (!document.querySelector('link[data-labs-css]')) {
    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = new URL('./labs.css?v=2', import.meta.url).href; css.dataset.labsCss = '1';
    document.head.appendChild(css);
  }
  const root = el('div', 'labs');
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Labs');
  root.tabIndex = -1;
  root.innerHTML = `
    <section class="labs-shelf">
      <header class="labs-head">
        <button type="button" class="labs-x" aria-label="Close">×</button>
        <div class="labs-title"><h2>${CURSOR}Labs</h2><p>Play with it, then ask Cassie why it works.</p></div>
      </header>
      <div class="labs-tools">
        <input type="search" class="labs-search" placeholder="Find a lab: pendulum, pH, sudoku…" aria-label="Find a lab" autocomplete="off">
        <div class="labs-chips" role="group" aria-label="Subject">${SUBJECTS.map(([id, n]) => `<button type="button" data-subject="${id}" aria-pressed="${id === 'all'}">${n}</button>`).join('')}</div>
      </div>
      <div class="labs-scroll">
        <div class="labs-board" hidden></div>
        <div class="labs-today"></div>
        <div class="labs-grid" role="list"></div>
        <p class="labs-empty" hidden>No lab by that name yet — ask Cassie about it instead.</p>
      </div>
    </section>
    <section class="lab-view" hidden>
      <header class="lab-head">
        <button type="button" class="lab-back" aria-label="Back to all labs">‹ <span>Labs</span></button>
        <div class="lab-name"><h2></h2><span class="lab-tag"></span></div>
        <div class="lab-acts">
          <button type="button" class="lab-btn lab-ask">${CURSOR}Ask Cassie</button>
          <button type="button" class="lab-btn lab-quiz">Quiz me</button>
        </div>
      </header>
      <div class="lab-body">
        <div class="lab-stage"></div>
        <aside class="lab-panel">
          <div class="lab-tries"></div>
          <div class="lab-controls"></div>
          <details class="lab-about"><summary>How this model works</summary><p></p></details>
        </aside>
      </div>
    </section>`;
  document.body.appendChild(root);
  const $ = (s) => root.querySelector(s);
  const shelf = $('.labs-shelf'), labView = $('.lab-view'), grid = $('.labs-grid'), search = $('.labs-search');
  let opts = {}, subject = 'all', current = null, mounted = null, openTry = -1;

  function progress(lab) {
    if (lab.subject === 'puzzles') { const d = store.get('cassie.puzzles')[dayKey()] || {}; return { puzzle: true, done: !!d[lab.id], shown: d[lab.id] && d[lab.id].shown }; }
    const done = store.get()[lab.id] || [];
    return { n: done.filter(Boolean).length, of: (lab.tries || []).length };
  }
  function card(lab) {
    const b = el('button', 'labs-card');
    b.type = 'button'; b.dataset.lab = lab.id;
    b.setAttribute('role', 'listitem');
    const p = lab.explore ? null : progress(lab);
    const badge = lab.explore ? '<span class="labs-3d">3D</span>'
      : p.puzzle ? `<span class="labs-prog${p.done ? ' all' : ''}">${p.done ? `Done today · ${esc(p.shown || '')}` : 'Today’s puzzle'}</span>`
        : p.of ? `<span class="labs-prog${p.n === p.of ? ' all' : ''}">${p.n}/${p.of} tried</span>` : '';
    b.innerHTML = `<span class="labs-icon">${iconSvg(lab.icon)}</span>
      <span class="labs-card-text"><b>${esc(lab.name)}</b><span>${esc(lab.blurb)}</span>
      <span class="labs-meta"><span class="labs-subj">${NAMES[lab.subject]}</span>${badge}</span></span>`;
    return b;
  }
  function renderShelf() {
    const q = search.value.trim().toLowerCase();
    const list = [...EXPLORE, ...LABS].filter((l) => (subject === 'all' || l.subject === subject) && (!q || (l.name + ' ' + l.blurb + ' ' + (l.words || '')).toLowerCase().includes(q)));
    grid.replaceChildren(...list.map(card));
    $('.labs-empty').hidden = list.length > 0;
    const t = todays(), tp = progress(t);
    const today = $('.labs-today');
    today.hidden = !!q || (subject !== 'all' && subject !== t.subject);
    today.innerHTML = `<button type="button" class="labs-feature" data-lab="${t.id}">
      <span class="labs-icon big">${iconSvg(t.icon)}</span>
      <span><small>Today’s lab</small><b>${esc(t.name)}</b><span>${esc(t.tries && t.tries[0] ? 'Try this: ' + t.tries[0] : t.blurb)}</span>${tp.of ? `<em>${tp.n}/${tp.of} tried</em>` : ''}</span></button>`;
    renderBoard(!q && (subject === 'all' || subject === 'puzzles'));
  }

  /* ---------- the daily puzzles' score board ---------- */
  let board = null, boardAt = 0;
  async function renderBoard(show) {
    const box = $('.labs-board');
    if (!show || !opts.scores) { box.hidden = true; return; }
    box.hidden = false;
    const draw = () => {
      const b = board || { top: [], players: 0 };
      const podium = [1, 0, 2].map((i) => b.top[i] ? `<div class="pod p${i + 1}${b.top[i].me ? ' me' : ''}"><span class="pod-av">${esc((b.top[i].name || '?').slice(0, 2))}</span><b>${esc(b.top[i].name)}</b><small>${b.top[i].points} points</small><i>${i + 1}</i></div>` : `<div class="pod p${i + 1} empty"><span class="pod-av">·</span><b>—</b><small>open</small><i>${i + 1}</i></div>`).join('');
      const done = PUZZLES.filter((p) => progress(p).done).length;
      box.innerHTML = `<div class="board-head"><div><h3>Score board</h3><p>Points for where you place in each of today’s ${PUZZLES.length} puzzles. ${b.offline ? 'The score board can’t be reached right now — your finishes are still kept on this device.' : b.players ? `${b.players} playing today.` : 'Be the first today!'}</p></div>
        <button type="button" class="lab-btn board-go" data-subject-go="puzzles">${done ? `${done}/${PUZZLES.length} done` : 'Play today’s puzzles'}</button></div>
        <div class="podium">${podium}</div>
        ${b.me ? `<p class="board-me">You: <b>#${b.me.rank}</b> with <b>${b.me.points}</b> points</p>` : board === null ? '<p class="board-me">Loading today’s board…</p>' : ''}`;
    };
    draw();
    if (Date.now() - boardAt < 30000 && board) return;
    boardAt = Date.now();
    try { board = await opts.scores('today', { day: dayKey() }); } catch (e) { board = board || { top: [], players: 0, offline: true }; }
    if (!root.hidden && !shelf.hidden) draw();
  }

  function openLab(id) {
    const lab = LABS.find((l) => l.id === id);
    const ex = EXPLORE.find((l) => l.id === id);
    if (ex) { close(); if (opts.openExplore) opts.openExplore(ex.explore); return; }
    if (!lab) return;
    closeLab();
    current = lab; openTry = -1;
    shelf.hidden = true; labView.hidden = false;
    labView.dataset.lab = lab.id;
    $('.lab-name h2').textContent = lab.name;
    $('.lab-tag').textContent = NAMES[lab.subject];
    const stage = $('.lab-stage'), controls = $('.lab-controls');
    stage.replaceChildren(); controls.replaceChildren();
    $('.lab-about').hidden = !lab.about;
    $('.lab-about').open = false;
    $('.lab-about p').textContent = lab.about || '';
    $('.lab-quiz').hidden = lab.subject === 'puzzles' && !lab.topic;
    renderTries();
    const api = {
      check(i) {
        const all = store.get(), done = all[lab.id] || [];
        if (done[i]) return;
        done[i] = true; all[lab.id] = done; store.set(all);
        renderTries(i);
        if (opts.onTry) opts.onTry(lab.id, i);
      },
      // a daily puzzle is finished: keep it, and put it on the score board (first finish counts)
      async finish(value, shown) {
        const day = dayKey(), all = store.get('cassie.puzzles');
        all[day] = all[day] || {};
        const first = !all[day][lab.id];
        if (first) { all[day][lab.id] = { value, shown }; store.set(all, 'cassie.puzzles'); }
        for (const k of Object.keys(all)) if (k < dayKey(Date.now() - 14 * 86400e3)) delete all[k];
        store.set(all, 'cassie.puzzles');
        if (!first || !opts.scores) return null;
        try { board = await opts.scores('submit', { day, game: lab.id, value, shown }); boardAt = Date.now(); return board; } catch (e) { return { error: e.message }; }
      },
      doneToday() { const d = store.get('cassie.puzzles')[dayKey()] || {}; return d[lab.id] || null; },
    };
    try { mounted = lab.mount({ stage, panel: controls, api }) || {}; }
    catch (e) { stage.textContent = 'This lab couldn’t start: ' + e.message; mounted = {}; }
    if (opts.onOpen) opts.onOpen(lab.id);
    setTimeout(() => $('.lab-back').focus(), 30);
  }
  // the goals: tap one for a hint; Cassie can nudge you without giving the answer away
  function renderTries(justDone) {
    const box = $('.lab-tries'), lab = current;
    if (!lab || !(lab.tries || []).length) { box.hidden = true; return; }
    const done = store.get()[lab.id] || [];
    box.hidden = false;
    box.innerHTML = `<h4>Try this <small>tap one for a hint</small></h4><ul>${lab.tries.map((t, i) => `<li class="${done[i] ? 'done' : ''}${i === justDone ? ' just' : ''}">
      <button type="button" class="lab-try" data-try="${i}" aria-expanded="${i === openTry}"><span class="lab-tick" aria-hidden="true"></span><span>${esc(t)}</span><span class="sr-only">${done[i] ? '(done)' : ''}</span><span class="lab-chev" aria-hidden="true">›</span></button>
      <div class="lab-hint" ${i === openTry ? '' : 'hidden'}><p>${esc((lab.hints || [])[i] || 'Play with the controls and watch what changes.')}</p>${opts.explain ? `<button type="button" class="lab-btn lab-nudge" data-nudge="${i}">${CURSOR}Still stuck? Cassie nudges you</button><p class="lab-nudge-text" hidden></p>` : ''}</div></li>`).join('')}</ul>`;
  }
  $('.lab-tries').addEventListener('click', (e) => {
    const t = e.target.closest('[data-try]');
    if (t) { const i = +t.dataset.try; openTry = openTry === i ? -1 : i; renderTries(); return; }
    const n = e.target.closest('[data-nudge]');
    if (n && current && opts.explain) {
      const i = +n.dataset.nudge, out = n.parentElement.querySelector('.lab-nudge-text'), lab = current;
      n.disabled = true; out.hidden = false; out.textContent = 'Cassie is thinking…'; out.classList.add('muted');
      opts.explain(`A student is working on this challenge in the ${lab.name} simulation (${lab.blurb}): "${lab.tries[i]}". What is on their screen now: ${described() || 'they have just started'}. Give one short, friendly hint in at most two sentences that points them in the right direction WITHOUT giving the answer or the exact numbers. Plain text, no formatting.`)
        .then((text) => { if (current !== lab) return; out.classList.remove('muted'); out.textContent = String(text || '').replace(/[*_#`>]/g, '').trim() || 'Try changing one thing at a time and watch what happens.'; })
        .catch(() => { if (current !== lab) return; out.classList.remove('muted'); out.textContent = 'Cassie couldn’t answer just now — try the hint above, or tap Ask Cassie.'; })
        .finally(() => { n.disabled = false; });
    }
  });
  function closeLab() {
    if (mounted && mounted.destroy) { try { mounted.destroy(); } catch (e) { /* ignore */ } }
    mounted = null; current = null;
  }
  function backToShelf() {
    closeLab();
    labView.hidden = true; shelf.hidden = false;
    renderShelf();
  }

  // what's on the screen, in words, for Cassie
  function described() {
    if (!current || !mounted || !mounted.state) return '';
    try { return mounted.state(); } catch (e) { return ''; }
  }
  $('.lab-ask').addEventListener('click', () => {
    if (!current) return;
    const now = described();
    const q = current.subject === 'puzzles'
      ? `I'm doing the daily ${current.name} puzzle in Cassie (${current.blurb})${now ? ` Right now: ${now}.` : ''} Give me a strategy tip for this kind of puzzle — don't solve it for me.`
      : `I'm playing with the ${current.name} lab in Cassie (${current.blurb})${now ? ` Right now: ${now}.` : ''} Explain what is happening and why, simply, using my numbers. Then ask me one quick question to check I understood.`;
    const name = current.name;
    close();
    if (opts.onAsk) opts.onAsk(q, { lab: name });
  });
  $('.lab-quiz').addEventListener('click', () => {
    if (!current) return;
    const topic = current.topic || current.name;
    close();
    if (opts.onQuiz) opts.onQuiz(topic);
  });
  $('.lab-back').addEventListener('click', backToShelf);
  $('.labs-x').addEventListener('click', () => close());
  root.addEventListener('click', (e) => {
    const c = e.target.closest('[data-lab]');
    if (c && shelf.contains(c)) openLab(c.dataset.lab);
    const s = e.target.closest('[data-subject], [data-subject-go]');
    if (s && shelf.contains(s)) {
      subject = s.dataset.subject || s.dataset.subjectGo;
      root.querySelectorAll('[data-subject]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.subject === subject)));
      renderShelf();
    }
  });
  search.addEventListener('input', renderShelf);
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (e.target === search && search.value) { search.value = ''; renderShelf(); return; }
    if (!labView.hidden) backToShelf(); else close();
  });

  function open(o) {
    opts = o || {};
    root.hidden = false;
    document.documentElement.classList.add('labs-open');
    if (opts.lab && LABS.some((l) => l.id === opts.lab)) openLab(opts.lab);
    else {
      if (opts.subject) { subject = opts.subject; root.querySelectorAll('[data-subject]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.subject === subject))); }
      if (labView.hidden) { renderShelf(); setTimeout(() => search.focus({ preventScroll: true }), 50); }
    }
  }
  function close() {
    closeLab();
    labView.hidden = true; shelf.hidden = false;
    root.hidden = true;
    document.documentElement.classList.remove('labs-open');
    if (opts.onClose) opts.onClose();
  }
  return { open, close, openLab, root, get lab() { return current && current.id; }, get state() { return described(); } };
}

/* Cassie's Labs — small simulations to play with, then ask Cassie why they work.
   Each lab is a canvas you touch plus a few controls. "Ask Cassie" sends her what is on the
   screen right now (the angle you launched at, the cross you made…), so her answer is about
   your experiment, not a textbook in general. "Try this" gives each lab a few small goals
   that tick themselves when you reach them.

     import('./labs/labs.js').then((m) => m.open({ lab: 'projectile', onAsk, onQuiz, openExplore }));
*/
import { el, esc } from './kit.js';
import { MATH } from './math.js';
import { PHYSICS } from './physics.js';
import { CHEMISTRY } from './chemistry.js';
import { BIOLOGY } from './biology.js';

export const SUBJECTS = [['all', 'All'], ['biology', 'Biology'], ['chemistry', 'Chemistry'], ['physics', 'Physics'], ['math', 'Math']];
const NAMES = { biology: 'Biology', chemistry: 'Chemistry', physics: 'Physics', math: 'Math' };
// the 3D explorers live in their own viewer; the shelf opens them too
const EXPLORE = [
  { id: 'body3d', name: 'Human body 3D', subject: 'biology', blurb: 'Turn, zoom and pull apart the real body — 10 systems, tap any part.', explore: 'body',
    icon: '<path d="M24 6a4 4 0 1 1 0 8 4 4 0 0 1 0-8z"/><path d="M17 18h14l-2 12h-3l-1 12h-2l-1-12h-3z"/><path d="M17 18l-5 10M31 18l5 10"/>' },
  { id: 'cells3d', name: 'Animal & plant cells', subject: 'biology', blurb: 'Two cells cut open in 3D. Tap an organelle to see what it does.', explore: 'animal',
    icon: '<ellipse cx="24" cy="24" rx="17" ry="14"/><circle cx="22" cy="23" r="6"/><circle cx="22" cy="23" r="2"/><path d="M33 17c2 1 3 3 2 5M12 30c2 2 5 3 7 2"/>' },
];
export const LABS = [...BIOLOGY, ...CHEMISTRY, ...PHYSICS, ...MATH];

let view = null;
export function open(opts = {}) {
  if (!view) view = createView();
  view.open(opts);
  return view;
}

const store = {
  get() { try { return JSON.parse(localStorage.getItem('cassie.labs') || '{}'); } catch (e) { return {}; } },
  set(v) { try { localStorage.setItem('cassie.labs', JSON.stringify(v)); } catch (e) { /* ignore */ } },
};
const CURSOR = '<svg class="labs-cur" viewBox="100 80 305 350" aria-hidden="true"><path d="M108 90 L395 259 L275 281 L342 399 L287 422 L225 300 L108 382 Z" fill="#fff" stroke="#0b0a0f" stroke-width="22" stroke-linejoin="round" paint-order="stroke"/></svg>';
const iconSvg = (inner) => `<svg viewBox="0 0 48 48" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
// the same lab every student sees today
function todays() { const d = new Date(), n = d.getFullYear() * 400 + d.getMonth() * 31 + d.getDate(); return LABS[n % LABS.length]; }

function createView() {
  // the labs' own look loads with them (the app stays light until Labs is opened)
  if (!document.querySelector('link[data-labs-css]')) {
    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = new URL('./labs.css?v=1', import.meta.url).href; css.dataset.labsCss = '1';
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
        <input type="search" class="labs-search" placeholder="Find a lab: pendulum, pH, fractions…" aria-label="Find a lab" autocomplete="off">
        <div class="labs-chips" role="group" aria-label="Subject">${SUBJECTS.map(([id, n]) => `<button type="button" data-subject="${id}" aria-pressed="${id === 'all'}">${n}</button>`).join('')}</div>
      </div>
      <div class="labs-scroll">
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
        </aside>
      </div>
    </section>`;
  document.body.appendChild(root);
  const $ = (s) => root.querySelector(s);
  const shelf = $('.labs-shelf'), labView = $('.lab-view'), grid = $('.labs-grid'), search = $('.labs-search');
  let opts = {}, subject = 'all', current = null, mounted = null;

  function progress(lab) {
    const done = store.get()[lab.id] || [];
    return { n: done.filter(Boolean).length, of: (lab.tries || []).length };
  }
  function card(lab) {
    const b = el('button', 'labs-card');
    b.type = 'button'; b.dataset.lab = lab.id;
    b.setAttribute('role', 'listitem');
    const p = lab.explore ? null : progress(lab);
    b.innerHTML = `<span class="labs-icon">${iconSvg(lab.icon)}</span>
      <span class="labs-card-text"><b>${esc(lab.name)}</b><span>${esc(lab.blurb)}</span>
      <span class="labs-meta"><span class="labs-subj">${NAMES[lab.subject]}</span>${lab.explore ? '<span class="labs-3d">3D</span>' : p.of ? `<span class="labs-prog${p.n === p.of ? ' all' : ''}">${p.n}/${p.of} tried</span>` : ''}</span></span>`;
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
  }

  function openLab(id) {
    const lab = LABS.find((l) => l.id === id);
    const ex = EXPLORE.find((l) => l.id === id);
    if (ex) { close(); if (opts.openExplore) opts.openExplore(ex.explore); return; }
    if (!lab) return;
    closeLab();
    current = lab;
    shelf.hidden = true; labView.hidden = false;
    labView.dataset.lab = lab.id;
    $('.lab-name h2').textContent = lab.name;
    $('.lab-tag').textContent = NAMES[lab.subject];
    const stage = $('.lab-stage'), controls = $('.lab-controls');
    stage.replaceChildren(); controls.replaceChildren();
    renderTries();
    const api = {
      check(i) {
        const all = store.get(), done = all[lab.id] || [];
        if (done[i]) return;
        done[i] = true; all[lab.id] = done; store.set(all);
        renderTries(i);
        if (opts.onTry) opts.onTry(lab.id, i);
      },
    };
    try { mounted = lab.mount({ stage, panel: controls, api }) || {}; }
    catch (e) { stage.textContent = 'This lab couldn’t start: ' + e.message; mounted = {}; }
    if (opts.onOpen) opts.onOpen(lab.id);
    setTimeout(() => $('.lab-back').focus(), 30);
  }
  function renderTries(justDone) {
    const box = $('.lab-tries'), lab = current;
    if (!lab || !(lab.tries || []).length) { box.hidden = true; return; }
    const done = store.get()[lab.id] || [];
    box.hidden = false;
    box.innerHTML = `<h4>Try this</h4><ul>${lab.tries.map((t, i) => `<li class="${done[i] ? 'done' : ''}${i === justDone ? ' just' : ''}"><span class="lab-tick" aria-hidden="true"></span><span>${esc(t)}</span><span class="sr-only">${done[i] ? '(done)' : ''}</span></li>`).join('')}</ul>`;
  }
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
    const q = `I'm playing with the ${current.name} lab in Cassie (${current.blurb})${now ? ` Right now: ${now}.` : ''} Explain what is happening and why, simply, using my numbers. Then ask me one quick question to check I understood.`;
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
    const s = e.target.closest('[data-subject]');
    if (s) { subject = s.dataset.subject; root.querySelectorAll('[data-subject]').forEach((b) => b.setAttribute('aria-pressed', String(b === s))); renderShelf(); }
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
    else if (labView.hidden) { renderShelf(); setTimeout(() => search.focus({ preventScroll: true }), 50); }
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

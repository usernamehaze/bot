/* Cassie's Labs — small simulations to play with, then ask Cassie why they work, and a few
   daily puzzles with a score board.
   Each lab is a canvas you touch plus a few controls. "Ask Cassie" sends her what is on the
   screen right now (the angle you launched at, the cross you made…), so her answer is about
   your experiment, not a textbook in general. "Try this" gives each lab a few small goals:
   tap one for a hint (Cassie can nudge you, without giving it away); they tick themselves
   when you reach them. "How this model works" says what the simulation leaves out, so
   nothing is passed off as more exact than it is.

     import('./labs/labs.js').then((m) => m.open({ lab: 'projectile', converse, makeQuiz, format, onAsk, onQuiz, openExplore, explain, scores }));
   With converse (and makeQuiz) Ask Cassie and Quiz me stay inside the lab (labs/helper.js);
   without them they hand the question to onAsk / onQuiz.
*/
import { el, esc, dayKey, setPremium, errorWords, errorWordsFor } from './kit.js';
import { tutor } from './tutor.js';
import { helper } from './helper.js';
import { MATH } from './math.js';
import { MATH2 } from './math2.js';
import { PHYSICS } from './physics.js';
import { PHYSICS2 } from './physics2.js';
import { SPACE } from './space.js';
import { CHEMISTRY } from './chemistry.js';
import { CHEMISTRY2 } from './chemistry2.js';
import { BIOLOGY } from './biology.js';
import { PUZZLES } from './puzzles.js';
import { space3dLab } from './space3d.js';
import { atlasLab } from './atlas.js';
import { TOOLS } from './tools.js';
import { MUSEUM } from './museum.js?v=185';
import { GAMES } from './games.js';

// two shelves: things to learn with (simulations, 3D models, the atlas) and games (the daily puzzles)
export const SUBJECTS = [['all', 'All'], ['3d', '3D'], ['biology', 'Biology'], ['chemistry', 'Chemistry'], ['physics', 'Physics'], ['space', 'Space'], ['math', 'Math'], ['geography', 'Geography'], ['history', 'History']];
// labs without Teach me, Ask Cassie and Quiz me (in the 3D space labs they froze a real phone)
const NO_HELPERS = new Set(['solar', 'space3d']);
const NAMES = { biology: 'Biology', chemistry: 'Chemistry', physics: 'Physics', space: 'Space', math: 'Math', geography: 'Geography', history: 'History', puzzles: 'Puzzle', tools: 'Study tool', games: 'Game' };
// the 3D explorers live in their own viewer; the shelf opens them too
const EXPLORE = [
  { id: 'body3d', name: 'Human body 3D', subject: 'biology', blurb: 'Turn, zoom and pull apart the real body, 10 systems, tap any part.', explore: 'body',
    icon: '<path d="M24 6a4 4 0 1 1 0 8 4 4 0 0 1 0-8z"/><path d="M17 18h14l-2 12h-3l-1 12h-2l-1-12h-3z"/><path d="M17 18l-5 10M31 18l5 10"/>' },
  { id: 'cells3d', name: 'Cells 3D: animal & plant', subject: 'biology', blurb: 'A cell cut open in 3D: pick Animal or Plant, tap an organelle to see what it does.', explore: 'cells',
    icon: '<ellipse cx="24" cy="24" rx="17" ry="14"/><circle cx="22" cy="23" r="6"/><circle cx="22" cy="23" r="2"/><path d="M33 17c2 1 3 3 2 5M12 30c2 2 5 3 7 2"/>' },
];
export const LABS = [...BIOLOGY, ...CHEMISTRY, ...CHEMISTRY2, space3dLab, ...SPACE, atlasLab, ...PHYSICS, ...PHYSICS2, ...MATH, ...MATH2, ...PUZZLES, ...GAMES, ...TOOLS, ...MUSEUM];
// three shelves: Learn (simulations), Games (daily puzzles + games), Study tools
const shelfOf = (l) => (l.subject === 'puzzles' || l.subject === 'games' ? 'games' : l.subject === 'tools' ? 'tools' : 'learn');
const SIMS = LABS.filter((l) => shelfOf(l) === 'learn');
const is3d = (l) => !!(l.explore || l.three);

// the phone's Labs tab: a sliding row of filters, Today's Lab, and For you (Learn, Study tools),
// each with a live mini preview (previews.js). Computers keep the shelf above.
const LP_CHIPS = [['all', 'All'], ['science', 'Science'], ['maths', 'Maths'], ['history', 'History'], ['3d', '3D'], ['tools', 'Study tools'], ['games', 'Games']];
const SCIENCE = new Set(['biology', 'chemistry', 'physics', 'space', 'geography']);
const phoneQ = matchMedia('(max-width: 760px)');
let pvMod = null;
const previews = () => pvMod || (pvMod = import('./previews.js').catch(() => null));
let view = null;
export function open(opts = {}) {
  if (!view) view = createView();
  view.open(opts);
  return view;
}

const store = {
  get(k = 'cassie.labs') { try { return JSON.parse(localStorage.getItem(k) || '{}'); } catch (e) { return {}; } },
  set(v, k = 'cassie.labs') { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } if (k === 'cassie.labs' && typeof window.syncAccount === 'function') window.syncAccount(); }, // (ticked tries go with an account)
};
const CURSOR = '<svg class="labs-cur" viewBox="100 80 305 350" aria-hidden="true"><path d="M108 90 L395 259 L275 281 L342 399 L287 422 L225 300 L108 382 Z" fill="#fff" stroke="#0b0a0f" stroke-width="22" stroke-linejoin="round" paint-order="stroke"/></svg>';
const iconSvg = (inner) => `<svg viewBox="0 0 48 48" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
// the same lab for every student today
function todays() { const k = dayKey(), n = [...k].reduce((s, ch) => s * 31 + ch.charCodeAt(0), 7) >>> 0; return SIMS[n % SIMS.length]; }

function createView() {
  // the labs' own look loads with them (the app stays light until Labs is opened)
  // (Labs waits for its look before it shows — otherwise a phone on mobile data flashes plain
  // white boxes for a moment, like an error page)
  let cssReady = Promise.resolve();
  if (!document.querySelector('link[data-labs-css]')) {
    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = new URL('./labs.css?v=12', import.meta.url).href; css.dataset.labsCss = '1';
    cssReady = new Promise((ok) => { css.onload = ok; css.onerror = ok; setTimeout(ok, 5000); });
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
      <div class="lp" hidden>
        <header class="lp-head"><h2>Labs</h2><button type="button" class="lp-find" aria-label="Search labs" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/></svg></button></header>
        <input type="search" class="lp-q" placeholder="Find a lab or a study tool" aria-label="Find a lab or a study tool" autocomplete="off" hidden>
        <div class="lp-chips" role="group" aria-label="Show">${LP_CHIPS.map(([id, n]) => `<button type="button" data-lp="${id}" aria-pressed="${id === 'all'}">${n}</button>`).join('')}</div>
        <div class="lp-home">
          <h3 class="lp-h">Recommended</h3>
          <div class="lp-rec"></div>
          <h3 class="lp-h">For you</h3>
          <button type="button" class="lp-for" data-lp-open="learn"><canvas class="lp-pv" data-pv="build-cell" aria-hidden="true"></canvas><span><b>Learn</b><small>Simulations, 3D models and the atlas</small></span><i aria-hidden="true">›</i></button>
          <button type="button" class="lp-for" data-lp-open="tools"><canvas class="lp-pv" data-pv="flashcards" aria-hidden="true"></canvas><span><b>Study tools</b><small>Flashcards, notes, timelines and essays</small></span><i aria-hidden="true">›</i></button>
        </div>
        <div class="lp-list" hidden>
          <header class="lp-list-head"><button type="button" class="lp-back" aria-label="Back">‹</button><h3></h3></header>
          <div class="lp-rows" role="list"></div>
        </div>
      </div>
      <div class="labs-tabs" role="tablist" aria-label="Labs shelves">
        <button type="button" role="tab" data-section="learn" aria-selected="true">Learn <small>simulations · 3D · atlas</small></button>
        <button type="button" role="tab" data-section="games" aria-selected="false" hidden>Games &amp; puzzles <small>daily puzzles · games</small></button>
        <button type="button" role="tab" data-section="tools" aria-selected="false">Study tools <small>notes · cards · essays · art</small></button>
      </div>
      <div class="labs-tools">
        <input type="search" class="labs-search" placeholder="Find a lab: pendulum, planets, sudoku, timeline, Cornell notes…" aria-label="Find a lab or a puzzle" autocomplete="off">
        <div class="labs-chips" role="group" aria-label="Subject">${SUBJECTS.map(([id, n]) => `<button type="button" data-subject="${id}" aria-pressed="${id === 'all'}">${n}</button>`).join('')}</div>
      </div>
      <div class="labs-scroll">
        <div class="labs-board" hidden></div>
        <div class="labs-today"></div>
        <div class="labs-grid" role="list"></div>
        <div class="labs-empty" hidden></div>
      </div>
    </section>
    <section class="lab-view" hidden>
      <header class="lab-head">
        <button type="button" class="lab-back" aria-label="Back to all labs">‹ <span>Labs</span></button>
        <div class="lab-name"><h2></h2><span class="lab-tag"></span></div>
        <div class="lab-acts">
          <button type="button" class="lab-btn lab-teach" title="Cassie teaches you, out loud, and points at what to do">${CURSOR}Teach me</button>
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
  let opts = {}, subject = 'all', section = 'learn', current = null, mounted = null, openTry = -1, touched = false;
  // a goal only ticks once the student has done something in the lab (some labs start in a state
  // that already meets a goal — that isn't the student finding it)
  for (const type of ['pointerdown', 'keydown', 'input', 'change', 'wheel']) {
    labView.addEventListener(type, (e) => { if (!e.target.closest('.lab-tries, .lab-head')) touched = true; }, true);
  }

  function progress(lab) {
    if (lab.subject === 'games') { const b = store.get('cassie.games')[lab.id]; return { game: true, best: b && b.shown }; }
    if (lab.subject === 'tools') return { tool: true };
    if (lab.subject === 'puzzles') { const d = store.get('cassie.puzzles')[dayKey()] || {}; return { puzzle: true, done: !!d[lab.id], shown: d[lab.id] && d[lab.id].shown }; }
    const done = store.get()[lab.id] || [];
    return { n: done.filter(Boolean).length, of: (lab.tries || []).length };
  }
  function card(lab) {
    const b = el('button', 'labs-card');
    b.type = 'button'; b.dataset.lab = lab.id;
    b.setAttribute('role', 'listitem');
    const p = lab.explore ? null : progress(lab);
    const tag3d = lab.three ? '<span class="labs-3d">3D</span>' : '';
    const badge = is3d(lab) && !p ? '<span class="labs-3d">3D</span>'
      : p.game ? (p.best ? `<span class="labs-prog all">Best · ${esc(p.best)}</span>` : '<span class="labs-prog">New game</span>')
      : p.tool ? ''
      : p.puzzle ? `<span class="labs-prog${p.done ? ' all' : ''}">${p.done ? `Done today · ${esc(p.shown || '')}` : 'Today’s puzzle'}</span>`
        : p.of ? `<span class="labs-prog${p.n === p.of ? ' all' : ''}">${p.n}/${p.of} tried</span>` : '';
    b.innerHTML = `<span class="labs-icon">${iconSvg(lab.icon)}</span>
      <span class="labs-card-text"><b>${esc(lab.name)}</b><span>${esc(lab.blurb)}</span>
      <span class="labs-meta"><span class="labs-subj">${NAMES[lab.subject]}</span>${tag3d}${badge}</span></span>`;
    return b;
  }
  // Labs is two shelves (Learn, Study tools); the games are their own place (the app's Games button)
  function setSection(sec) {
    section = sec === 'games' || sec === 'tools' ? sec : 'learn';
    const games = section === 'games';
    root.classList.toggle('games-mode', games);
    $('.labs-title h2').innerHTML = `${CURSOR}${games ? 'Games' : 'Labs'}`;
    $('.labs-title p').textContent = games ? 'Daily puzzles and games. Play, then ask Cassie how to think about them.' : 'Play with it, then ask Cassie why it works.';
    search.placeholder = games ? 'Find a game or puzzle: sudoku, circuit, map blitz…' : 'Find a lab: pendulum, planets, timeline, Cornell notes…';
    $('.lab-back span').textContent = games ? 'Games' : 'Labs';
    root.querySelectorAll('[data-section]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.section === section)));
    $('.labs-chips').hidden = section !== 'learn';
    shelf.dataset.shelf = section;
    root.dataset.section = section; // (the app's Games button shows as on while the games are open)
  }
  function renderShelf() {
    const q = search.value.trim().toLowerCase();
    // searching looks on Labs' two shelves (or, in Games, at the games)
    const list = [...EXPLORE, ...LABS].filter((l) => (q
      ? (section === 'games') === (shelfOf(l) === 'games') && (l.name + ' ' + l.blurb + ' ' + (l.words || '') + ' ' + (NAMES[l.subject] || '')).toLowerCase().includes(q)
      : section !== 'learn' ? shelfOf(l) === section : shelfOf(l) === 'learn' && (subject === 'all' || (subject === '3d' ? is3d(l) : l.subject === subject))));
    grid.replaceChildren(...list.map(card));
    const none = $('.labs-empty');
    none.hidden = list.length > 0;
    if (!none.hidden && window.CassieErrors) {
      const q0 = search.value.trim();
      none.replaceChildren(window.CassieErrors.empty({
        title: 'No lab by that name yet',
        text: `Cassie can still explain ${q0 ? `“${q0}”` : 'it'} to you, even without a lab.`,
        action: 'Ask Cassie about it',
        onAction: () => { close(); if (opts.onAsk) opts.onAsk(`Explain ${q0} to me.`, {}); },
      }));
    }
    const t = todays(), tp = progress(t);
    const today = $('.labs-today');
    today.hidden = !!q || section !== 'learn' || (subject !== 'all' && subject !== t.subject);
    today.innerHTML = `<button type="button" class="labs-feature" data-lab="${t.id}">
      <span class="labs-icon big">${iconSvg(t.icon)}</span>
      <span><small>Today’s lab</small><b>${esc(t.name)}</b><span>${esc(t.tries && t.tries[0] ? 'Try this: ' + t.tries[0] : t.blurb)}</span>${tp.of ? `<em>${tp.n}/${tp.of} tried</em>` : ''}</span></button>`;
    renderBoard(!q && section === 'games');
  }

  /* ---------- the phone's Labs tab ---------- */
  const lp = $('.lp'), lpHome = $('.lp-home'), lpList = $('.lp-list'), lpRows = $('.lp-rows');
  const subscriber = () => typeof isSubscriber === 'function' && isSubscriber(); // (Plus and Pro: 3D previews)
  const pv = (scope) => previews().then((m) => { if (!m) return; scope.querySelectorAll('canvas[data-pv]').forEach((cv) => { if (cv.isConnected && !cv.dataset.preview) m.preview(cv, cv.dataset.pv, { group: 'labs', three: subscriber() }); }); });
  function phoneOn() { return phoneQ.matches && section !== 'games'; }
  function lpRec() {
    const id = (typeof todayLab === 'function' && todayLab()) || todays().id, lab = LABS.find((l) => l.id === id) || todays();
    const info = (typeof LAB_INFO === 'object' && LAB_INFO[lab.id]) || [lab.name, NAMES[lab.subject] || 'Science', 10];
    $('.lp-rec').innerHTML = `<div class="lp-card">
      <canvas class="lp-pv lp-big" data-pv="${lab.id}" aria-hidden="true"></canvas>
      <span class="lp-tag">Today’s Lab</span>${CURSOR.replace('labs-cur', 'labs-cur lp-peek')}
      <div class="lp-info"><b>${esc(lab.name)}</b><small>${esc(info[1])} · about ${info[2]} min</small></div>
      <button type="button" class="lp-play" data-lab="${lab.id}" aria-label="Open today’s lab: ${esc(lab.name)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg></button></div>`;
  }
  // a list: the Learn labs and 3D views, the study tools, or one filter's labs
  function lpShow(kind, found) {
    const learn = [...EXPLORE, ...SIMS];
    const lists = { search: ['Search', found || []],
      learn: ['Learn', learn], tools: ['Study tools', LABS.filter((l) => shelfOf(l) === 'tools')], science: ['Science', learn.filter((l) => SCIENCE.has(l.subject))],
      maths: ['Maths', learn.filter((l) => l.subject === 'math')], history: ['History', learn.filter((l) => l.subject === 'history')], '3d': ['3D', learn.filter(is3d)], games: ['Games', LABS.filter((l) => shelfOf(l) === 'games')],
    };
    const [title, list] = lists[kind] || lists.learn;
    lpList.querySelector('h3').textContent = title;
    lpRows.replaceChildren(...list.map((l) => {
      const b = el('button', 'lp-row'); b.type = 'button'; b.dataset.lab = l.id; b.setAttribute('role', 'listitem');
      const pid = l.id === 'cells3d' ? 'cells3d' : l.id;
      b.innerHTML = `<span class="lp-thumb">${previewIds.has(pid) ? `<canvas class="lp-pv" data-pv="${pid}" aria-hidden="true"></canvas>` : iconSvg(l.icon)}</span>
        <span class="lp-row-text"><b>${esc(l.name)}</b><small>${esc(NAMES[l.subject] || '')}${is3d(l) ? ' · 3D' : ''}</small></span><i aria-hidden="true">›</i>`;
      return b;
    }));
    lpHome.hidden = true; lpList.hidden = false; lp.dataset.view = kind;
    lpList.scrollTop = 0; shelf.scrollTop = 0;
    pv(lpList);
  }
  function lpHomeView() { lpList.hidden = true; lpHome.hidden = false; lp.dataset.view = 'home'; lpChip('all'); lpRec(); pv(lpHome); }
  function lpChip(id) { lp.querySelectorAll('[data-lp]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lp === id))); }
  let previewIds = new Set();
  previews().then((m) => { if (m) previewIds = new Set(m.PREVIEW_IDS); });
  function lpSync() { // the phone's tab, or the computer's shelf
    const on = phoneOn();
    root.classList.toggle('lp-on', on);
    lp.hidden = !on;
    if (on && !lp.dataset.view) lpHomeView();
  }
  lp.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-lp]');
    if (chip) {
      const id = chip.dataset.lp;
      $('.lp-q').hidden = true; $('.lp-find').setAttribute('aria-pressed', 'false');
      if (id === 'all') lpHomeView(); else { lpChip(id); previews().then(() => lpShow(id)); }
      return;
    }
    const go = e.target.closest('[data-lp-open]');
    if (go) { lpChip(go.dataset.lpOpen === 'tools' ? 'tools' : 'all'); previews().then(() => lpShow(go.dataset.lpOpen)); return; }
    if (e.target.closest('.lp-back')) { lpHomeView(); return; }
    if (e.target.closest('.lp-find')) { // search, matching the way the shelf's search does
      const q = $('.lp-q'), on = q.hidden;
      q.hidden = !on; q.value = '';
      $('.lp-find').setAttribute('aria-pressed', String(on));
      if (on) setTimeout(() => q.focus(), 30); else lpHomeView();
    }
  });
  $('.lp-q').addEventListener('input', () => {
    const q = $('.lp-q').value.trim().toLowerCase();
    if (!q) { lpHomeView(); return; }
    const found = [...EXPLORE, ...LABS].filter((l) => shelfOf(l) !== 'games' && (l.name + ' ' + l.blurb + ' ' + (l.words || '') + ' ' + (NAMES[l.subject] || '')).toLowerCase().includes(q));
    lpChip('');
    previews().then(() => {
      lpShow('search', found);
      if (!found.length && window.CassieErrors) { // (as on the shelf: why, and one next step that asks Cassie)
        const q0 = $('.lp-q').value.trim();
        lpRows.replaceChildren(window.CassieErrors.empty({ title: 'No lab by that name yet', text: `Cassie can still explain “${q0}” to you, even without a lab.`, action: 'Ask Cassie about it',
          onAction: () => { close(); if (opts.onAsk) opts.onAsk(`Explain ${q0} to me.`, {}); } }));
      }
    });
  });
  phoneQ.addEventListener?.('change', () => { if (!root.hidden) lpSync(); });

  /* ---------- the daily puzzles' score board ---------- */
  let board = null, boardAt = 0, boardTab = 'today';
  // everyone's points in every game, and their total — today, or added up over the week
  const SHORT = { sudoku: 'Sudoku', nonogram: 'Nonogram', hashi: 'Bridges', pipes: 'Pipes', mirrors: 'Mirrors', equation: 'Equation', geography: 'Geography' };
  function scoreTable(b) {
    const week = boardTab === 'week';
    const rows = (week ? b.week && b.week.table : b.table) || [];
    const tabs = `<div class="board-tabs" role="tablist"><button type="button" role="tab" data-board-tab="today" aria-selected="${!week}">Today</button><button type="button" role="tab" data-board-tab="week" aria-selected="${week}">This week</button></div>`;
    if (!rows.length) return tabs + `<p class="board-empty">${week ? 'No scores this week yet.' : 'No scores yet today.'}</p>`;
    const games = PUZZLES.map((p) => p.id);
    const head = `<tr><th>#</th><th class="bt-name">Player</th>${games.map((g) => `<th title="${esc(SHORT[g] || g)}">${esc(SHORT[g] || g)}</th>`).join('')}<th class="bt-total">Total</th></tr>`;
    const body = rows.map((r) => `<tr class="${r.me ? 'me' : ''}"><td>${r.rank}</td><td class="bt-name">${esc(r.name || 'Student')}${r.me ? ' <small>(you)</small>' : ''}</td>${games.map((g) => `<td>${r.games && r.games[g] ? r.games[g] : '<span class="bt-dash">-</span>'}</td>`).join('')}<td class="bt-total">${r.total}</td></tr>`).join('');
    return `${tabs}<div class="board-table-wrap"><table class="board-table"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
  }
  async function renderBoard(show) {
    const box = $('.labs-board');
    if (!show || !opts.scores) { box.hidden = true; return; }
    box.hidden = false;
    const draw = () => {
      const b = board || { top: [], players: 0 };
      const podium = [1, 0, 2].map((i) => b.top[i] ? `<div class="pod p${i + 1}${b.top[i].me ? ' me' : ''}"><span class="pod-av">${esc((b.top[i].name || '?').slice(0, 2))}</span><b>${esc(b.top[i].name)}</b><small>${b.top[i].points} points</small><i>${i + 1}</i></div>` : `<div class="pod p${i + 1} empty"><span class="pod-av">·</span><b>-</b><small>open</small><i>${i + 1}</i></div>`).join('');
      const done = PUZZLES.filter((p) => progress(p).done).length;
      box.innerHTML = `<div class="board-head"><div><h3>Score board</h3><p>Points for where you place in each of today’s ${PUZZLES.length} puzzles. ${b.offline ? 'The score board can’t be reached right now. Your finishes are still kept on this device.' : b.players ? `${b.players} playing today.` : 'Be the first today!'}</p></div>
        <button type="button" class="lab-btn board-go" data-subject-go="puzzles">${done ? `${done}/${PUZZLES.length} done` : 'Play today’s puzzles'}</button></div>
        <div class="podium">${podium}</div>
        ${b.me ? `<p class="board-me">You: <b>#${b.me.rank}</b> with <b>${b.me.points}</b> points</p>` : board === null ? '<p class="board-me">Loading today’s board…</p>' : ''}
        ${scoreTable(b)}`;
      box.querySelectorAll('[data-board-tab]').forEach((t) => t.addEventListener('click', () => { boardTab = t.dataset.boardTab; draw(); }));
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
    if (ex) {
      // the 3D viewer opens over Labs; closing it comes back here (asking Cassie leaves Labs).
      // Labs stays on screen (the card says "Opening…") until the 3D view is there.
      if (!opts.openExplore) return;
      const cardEl = grid.querySelector(`[data-lab="${id}"]`);
      if (cardEl) cardEl.classList.add('opening');
      const shown = () => { root.hidden = true; if (cardEl) cardEl.classList.remove('opening'); };
      opts.openExplore(ex.explore, {
        opened: shown,
        back: () => { shown(); root.hidden = false; renderShelf(); setTimeout(() => { const c = grid.querySelector(`[data-lab="${id}"]`); if (c) c.focus({ preventScroll: false }); }, 30); },
        leave: () => close(),
      });
      return;
    }
    if (!lab) return;
    closeLab();
    current = lab; openTry = -1; touched = false;
    shelf.hidden = true; labView.hidden = false;
    labView.dataset.lab = lab.id;
    $('.lab-name h2').textContent = lab.name;
    $('.lab-tag').textContent = NAMES[lab.subject];
    const stage = $('.lab-stage'), controls = $('.lab-controls');
    stage.replaceChildren(); controls.replaceChildren();
    $('.lab-about').hidden = !lab.about;
    $('.lab-about').open = false;
    $('.lab-about p').textContent = lab.about || '';
    // the 3D space labs have none of Teach me, Ask Cassie and Quiz me: there they froze a real phone
    const plain = NO_HELPERS.has(lab.id);
    $('.lab-quiz').hidden = plain || ((lab.subject === 'puzzles' || lab.subject === 'games' || lab.subject === 'tools') && !lab.topic);
    $('.lab-teach').hidden = plain || !opts.explain; // every other lab, game and study tool
    $('.lab-ask').hidden = plain;
    labView.classList.toggle('lab-tool', !!lab.wide);
    renderTries();
    const api = {
      check(i) {
        if (!touched) return;
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
      // Cassie, from inside a lab (a hint, grading, cards from notes…)
      ask: (q) => (opts.explain ? opts.explain(q) : Promise.reject(Object.assign(new Error(errorWords('lab_ai_off', { next: 'Try again in a moment.' })), { friendly: true }))),
      canAsk: () => !!opts.explain,
      // the student's flashcard decks (spaced repetition)
      addCards: (list, deck) => (opts.addCards ? opts.addCards(list, deck) : 0),
      openCards: opts.openCards ? (deck) => { close(); opts.openCards(deck); } : null,
      decks: () => (opts.decks ? opts.decks() : []),
      readFile: opts.readFile || null,
      // a game's best result on this device (lower or higher is better, as the game says)
      best(value, shown, lowerWins = false) {
        const all = store.get('cassie.games'), b = all[lab.id];
        if (value == null) return b || null;
        if (b && (lowerWins ? b.value <= value : b.value >= value)) return b;
        all[lab.id] = { value, shown, at: Date.now() }; store.set(all, 'cassie.games');
        return { ...all[lab.id], isNew: true };
      },
      say: (t) => (opts.speak ? opts.speak(t) : null),
    };
    try { mounted = lab.mount({ stage, panel: controls, api }) || {}; }
    catch (e) { stage.textContent = errorWords('lab_start_failed'); mounted = {}; console.error(e); }
    if (opts.onOpen) opts.onOpen(lab.id);
    setTimeout(() => $('.lab-back').focus(), 30);
  }
  // the goals: tap one for a hint; Cassie can nudge you without giving the answer away
  function renderTries(justDone) {
    const box = $('.lab-tries'), lab = current;
    if (!lab || !(lab.tries || []).length) { box.hidden = true; return; }
    const done = store.get()[lab.id] || [];
    box.hidden = false;
    const n = lab.tries.filter((t, i) => done[i]).length;
    // on a phone the goals start folded up (they take a lot of room); the choice is remembered
    const pref = store.get('cassie.labs.ui').tries, folded = pref ? pref === 'min' : matchMedia('(max-width: 760px)').matches;
    box.classList.toggle('folded', folded);
    const toggle = `<button type="button" class="lab-tries-toggle" aria-expanded="${!folded}">${folded ? 'Show ▾' : 'Hide ▴'}</button>`;
    if (folded) { box.innerHTML = `<h4>Try this <small>${n} of ${lab.tries.length} done</small>${toggle}</h4>`; return; }
    box.innerHTML = `<h4>Try this ${toggle}<small>${n ? `${n} of ${lab.tries.length} done · ` : ''}they tick when you do them · tap a goal for a hint</small></h4><ul>${lab.tries.map((t, i) => `<li class="${done[i] ? 'done' : ''}${i === justDone ? ' just' : ''}">
      <div class="lab-try-row"><button type="button" class="lab-tick" data-tick="${i}" aria-pressed="${!!done[i]}" aria-label="${done[i] ? 'Done. Tap to untick' : 'Not done yet. Tap to tick it yourself'}" title="${done[i] ? 'Done. Tap to untick' : 'Tap to tick it yourself'}"></button>
      <button type="button" class="lab-try" data-try="${i}" aria-expanded="${i === openTry}"><span>${esc(t)}</span><span class="sr-only">${done[i] ? '(done)' : ''}</span><span class="lab-chev" aria-hidden="true">›</span></button></div>
      <div class="lab-hint" ${i === openTry ? '' : 'hidden'}><p>${esc((lab.hints || [])[i] || 'Play with the controls and watch what changes.')}</p>${opts.explain ? `<button type="button" class="lab-btn lab-nudge" data-nudge="${i}">${CURSOR}Still stuck? Cassie nudges you</button><p class="lab-nudge-text" hidden></p>` : ''}</div></li>`).join('')}</ul>`;
  }
  $('.lab-tries').addEventListener('click', (e) => {
    if (e.target.closest('.lab-tries-toggle')) {
      const ui = store.get('cassie.labs.ui'); ui.tries = $('.lab-tries').classList.contains('folded') ? 'max' : 'min'; store.set(ui, 'cassie.labs.ui');
      renderTries(); return;
    }
    const tick = e.target.closest('[data-tick]');
    if (tick && current) {
      const i = +tick.dataset.tick, all = store.get(), done = all[current.id] || [];
      done[i] = !done[i]; all[current.id] = done; store.set(all);
      renderTries(done[i] ? i : undefined);
      return;
    }
    const t = e.target.closest('[data-try]');
    if (t) { const i = +t.dataset.try; openTry = openTry === i ? -1 : i; renderTries(); return; }
    const n = e.target.closest('[data-nudge]');
    if (n && current && opts.explain) {
      const i = +n.dataset.nudge, out = n.parentElement.querySelector('.lab-nudge-text'), lab = current;
      n.disabled = true; out.hidden = false; out.textContent = 'Cassie is thinking…'; out.classList.add('muted');
      opts.explain(`A student is working on this challenge in the ${lab.name} simulation (${lab.blurb}): "${lab.tries[i]}". What is on their screen now: ${described() || 'they have just started'}. Give one short, friendly hint in at most two sentences that points them in the right direction WITHOUT giving the answer or the exact numbers. Plain text, no formatting.`)
        .then((text) => { if (current !== lab) return; out.classList.remove('muted'); out.textContent = String(text || '').replace(/[*_#`>]/g, '').trim() || 'Try changing one thing at a time and watch what happens.'; })
        .catch(() => { if (current !== lab) return; out.classList.remove('muted'); out.textContent = errorWords('lab_ai_failed', { next: 'Read the hint above, or tap Ask Cassie.' }); })
        .finally(() => { n.disabled = false; });
    }
  });
  // Teach me: Cassie as a tutor in this lab (labs/tutor.js)
  let teacher = null;
  const lessons = new Map(); // lab -> where the student stopped a lesson (Teach me offers to carry on)
  function stopTeaching() {
    if (teacher) {
      const l = teacher.lesson();
      if (current) { if (l) lessons.set(current.id, l); else lessons.delete(current.id); }
      teacher.stop(); teacher = null;
    }
    labView.classList.remove('tutoring'); $('.lab-teach').setAttribute('aria-pressed', 'false');
  }
  $('.lab-teach').addEventListener('click', () => {
    if (!current || !opts.explain || NO_HELPERS.has(current.id)) return;
    if (teacher && teacher.root.isConnected) { stopTeaching(); return; }
    closeHelp();
    teacher = tutor({ view: labView, lab: current, mounted: () => mounted, described, ask: opts.explain, speak: opts.speak, speaker: opts.speaker, hear: opts.hear, level: opts.level });
    teacher.root.querySelector('.tut-x').addEventListener('click', () => stopTeaching());
    labView.classList.add('tutoring'); $('.lab-teach').setAttribute('aria-pressed', 'true');
    if (opts.onTeach) opts.onTeach(current.id);
    if (lessons.has(current.id)) teacher.offer(lessons.get(current.id)); // carry on, or start over (no new question to Cassie)
    else teacher.teach('How do I use this? Teach me from the start.');
  });
  // Ask Cassie and Quiz me: a panel inside the lab (labs/helper.js); the lab keeps working behind it
  let help = null;
  function helpFor() {
    if (!help) {
      const lab = current;
      help = helper({ view: labView, name: `the ${lab.name} ${lab.subject === 'tools' ? 'study tool' : lab.subject === 'games' ? 'game' : lab.subject === 'puzzles' ? 'puzzle' : 'lab'}`, described,
        ask: opts.converse, format: opts.format, speak: opts.speak, quiz: opts.makeQuiz, onMark: opts.onMark, onClose: pressHelp });
    }
    return help;
  }
  function pressHelp() {
    const on = help && help.open, quiz = on && help.root.getAttribute('aria-label') === 'Quiz me';
    $('.lab-ask').setAttribute('aria-pressed', String(!!on && !quiz));
    $('.lab-quiz').setAttribute('aria-pressed', String(!!quiz));
  }
  function closeHelp() { if (help && help.open) help.close(); }
  function dropHelp() { if (help) { help.destroy(); help = null; } pressHelp(); }
  function closeLab() {
    dropHelp();
    stopTeaching();
    if (current) lessons.delete(current.id); // (a lesson is about this lab as it is on screen now)
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
    if (!current || NO_HELPERS.has(current.id)) return;
    const now = described();
    const q = current.subject === 'tools'
      ? `I'm using Cassie's ${current.name} study tool (${current.blurb})${now ? ` Right now: ${now}.` : ''} Look at my work, tell me what's good and what to fix, simply. Then ask me one quick question to check I understood.`
      : current.subject === 'games'
        ? `I'm playing the ${current.name} game in Cassie (${current.blurb})${now ? ` Right now: ${now}.` : ''} Explain the idea behind it simply and give me one tip. Don't just give me the answer.`
        : current.subject === 'puzzles'
      ? `I'm doing the daily ${current.name} puzzle in Cassie (${current.blurb})${now ? ` Right now: ${now}.` : ''} Give me a strategy tip for this kind of puzzle. Don't solve it for me.`
      : `I'm playing with the ${current.name} lab in Cassie (${current.blurb})${now ? ` Right now: ${now}.` : ''} Explain what is happening and why, simply, using my numbers. Then ask me one quick question to check I understood.`;
    if (opts.converse) {
      stopTeaching();
      const h = helpFor();
      if (h.open && $('.lab-ask').getAttribute('aria-pressed') === 'true') { h.close(); return; }
      h.ask(q, current.subject === 'tools' ? 'How is my work so far?' : current.subject === 'games' || current.subject === 'puzzles' ? 'Give me a tip for this.' : 'What is happening on my screen?');
      pressHelp();
      return;
    }
    const name = current.name;
    close();
    if (opts.onAsk) opts.onAsk(q, { lab: name });
  });
  $('.lab-quiz').addEventListener('click', () => {
    if (!current || NO_HELPERS.has(current.id)) return;
    const topic = current.topic || current.name;
    if (opts.converse && opts.makeQuiz) {
      stopTeaching();
      const h = helpFor();
      if (h.open && $('.lab-quiz').getAttribute('aria-pressed') === 'true') { h.close(); return; }
      h.quiz(topic);
      pressHelp();
      return;
    }
    close();
    if (opts.onQuiz) opts.onQuiz(topic);
  });
  $('.lab-back').addEventListener('click', backToShelf);
  $('.labs-x').addEventListener('click', () => close());
  root.addEventListener('click', (e) => {
    const c = e.target.closest('[data-lab]');
    // the card says "Opening…" at once; the lab is built once that has been drawn (a big lab takes a moment)
    if (c && shelf.contains(c) && !c.classList.contains('opening')) {
      c.classList.add('opening');
      const id = c.dataset.lab;
      requestAnimationFrame(() => setTimeout(() => { c.classList.remove('opening'); if (!root.hidden && !shelf.hidden) openLab(id); }));
    }
    const sec = e.target.closest('.labs-tabs [data-section]');
    if (sec && shelf.contains(sec)) { setSection(sec.dataset.section); search.value = ''; renderShelf(); return; }
    const s = e.target.closest('[data-subject], [data-subject-go]');
    if (s && shelf.contains(s)) {
      const v = s.dataset.subject || s.dataset.subjectGo;
      if (v === 'puzzles') { setSection('games'); renderShelf(); return; }
      setSection('learn');
      subject = v;
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
    setPremium(opts.premium);
    cssReady.then(() => show());
  }
  function show() {
    root.hidden = false;
    document.documentElement.classList.add('labs-open');
    if (opts.lab && LABS.some((l) => l.id === opts.lab)) openLab(opts.lab);
    else {
      // the Games button (or Labs) asks for a shelf: leave any lab that's open and show it
      if (opts.section && !labView.hidden) backToShelf();
      if (opts.subject === 'puzzles' || opts.section === 'games') setSection('games');
      else if (opts.section === 'learn' || opts.section === 'tools') setSection(opts.section);
      else if (opts.subject) { setSection('learn'); subject = opts.subject; root.querySelectorAll('[data-subject]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.subject === subject))); }
      if (labView.hidden) {
        renderShelf();
        lp.dataset.view = ''; $('.lp-q').hidden = true; $('.lp-find').setAttribute('aria-pressed', 'false'); lpSync(); // (a phone: the Labs tab, from its start)
        if (phoneOn() && opts.section === 'tools') lpShow('tools');
        else if (phoneOn() && opts.subject === '3d') lpShow('3d');
        if (!phoneOn()) setTimeout(() => search.focus({ preventScroll: true }), 50);
      }
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

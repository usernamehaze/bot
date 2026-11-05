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
import { PHYSICS3 } from './physics3.js';
import { LIFECHEM } from './lifechem.js';
import { EARTHMATH } from './earthmath.js';
import { SPACE } from './space.js';
import { CHEMISTRY } from './chemistry.js';
import { CHEMISTRY2 } from './chemistry2.js';
import { BIOLOGY } from './biology.js';
import { PUZZLES } from './puzzles.js';
import { space3dLab } from './space3d.js';
import { atlasLab } from './atlas.js';
import { TOOLS } from './tools.js';
import { MUSEUM } from './museum.js?v=253';
import { GAMES } from './games.js';
import { GAMES2 } from './games2.js';
import { KIDS } from './kids.js';
import { LEVEL_LESSONS } from './level-lessons.js?v=253';

// two shelves: things to learn with (simulations, 3D models, the atlas) and games (the daily puzzles)
export const SUBJECTS = [['all', 'All'], ['3d', '3D'], ['biology', 'Biology'], ['chemistry', 'Chemistry'], ['physics', 'Physics'], ['space', 'Space'], ['math', 'Math'], ['geography', 'Geography'], ['history', 'History']];
// labs without Teach me, Ask Cassie and Quiz me (in the 3D space labs they froze a real phone; the little ones' labs need no reading)
const NO_HELPERS = new Set(['solar', 'space3d', ...KIDS.map((l) => l.id)]);
// Levels, as the app's Lessons has them: the student's own first (app.js lessonLevel(), from the profile)
export const LEVELS = [['pre', 'Nursery and Kindergarten'], ['elem', 'Elementary'], ['jhs', 'Junior High'], ['shs', 'Senior High'], ['college', 'College'], ['board', 'Board and Licensure exams']];
// which of a lab's own levels (levels: [...] in its file, docs/learn-levels.md) each level shows
const LAB_LEVELS = { pre: ['pre'], elem: ['elem'], jhs: ['hs'], shs: ['hs'], college: ['college', 'grad'], board: [] };
const levelNow = () => {
  if (typeof state !== 'undefined' && state.profile && state.profile.grade === 'Board exam reviewee') return 'board'; // (v241)
  const l = (typeof lessonLevel === 'function' && lessonLevel()) || '';
  if (LAB_LEVELS[l]) return l;
  const g = (typeof labLevel === 'function' && labLevel()) || '';
  return { grad: 'college', hs: 'shs' }[g] || (LAB_LEVELS[g] ? g : '');
};
const NAMES = { biology: 'Biology', chemistry: 'Chemistry', physics: 'Physics', space: 'Space', math: 'Math', geography: 'Geography', history: 'History', puzzles: 'Puzzle', tools: 'Study tool', games: 'Game', kids: 'For little ones' };
// the 3D explorers live in their own viewer; the shelf opens them too
const EXPLORE = [
  { id: 'body3d', name: 'Human body 3D', subject: 'biology', levels: ['elem', 'hs'], blurb: 'Turn, zoom and pull apart the real body, 10 systems, tap any part.', explore: 'body',
    icon: '<path d="M24 6a4 4 0 1 1 0 8 4 4 0 0 1 0-8z"/><path d="M17 18h14l-2 12h-3l-1 12h-2l-1-12h-3z"/><path d="M17 18l-5 10M31 18l5 10"/>' },
  { id: 'cells3d', name: 'Cells 3D: animal & plant', subject: 'biology', levels: ['hs', 'college'], blurb: 'A cell cut open in 3D: pick Animal or Plant, tap an organelle to see what it does.', explore: 'cells',
    icon: '<ellipse cx="24" cy="24" rx="17" ry="14"/><circle cx="22" cy="23" r="6"/><circle cx="22" cy="23" r="2"/><path d="M33 17c2 1 3 3 2 5M12 30c2 2 5 3 7 2"/>' },
];
export const LABS = [...BIOLOGY, ...CHEMISTRY, ...CHEMISTRY2, ...LIFECHEM, ...EARTHMATH, space3dLab, ...SPACE, atlasLab, ...PHYSICS, ...PHYSICS2, ...PHYSICS3, ...MATH, ...MATH2, ...PUZZLES, ...GAMES, ...GAMES2, ...TOOLS, ...MUSEUM, ...KIDS];
// three shelves: Learn (simulations), Games (daily puzzles + games), Study tools
const shelfOf = (l) => (l.subject === 'puzzles' || l.subject === 'games' ? 'games' : l.subject === 'tools' ? 'tools' : 'learn');
const SIMS = LABS.filter((l) => shelfOf(l) === 'learn' && l.subject !== 'kids'); // (Today's Lab and For you: the little ones' labs open from Lessons)
const is3d = (l) => !!(l.explore || l.three);

// the phone's Labs tab: a sliding row of filters, Today's Lab, and For you (Learn, Study tools),
// each with a live mini preview (previews.js). Computers keep the shelf above.
const SCIENCE = new Set(['biology', 'chemistry', 'physics', 'space', 'geography']);
const phoneQ = matchMedia('(max-width: 760px)');
let pvMod = null;
const previews = () => pvMod || (pvMod = import('./previews.js').catch(() => null));
let view = null;
export function levelChanged() { if (view) view.levelChanged(); }
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
    css.rel = 'stylesheet'; css.href = new URL('./labs.css?v=22', import.meta.url).href; css.dataset.labsCss = '1';
    cssReady = new Promise((ok) => { css.onload = ok; css.onerror = ok; setTimeout(ok, 5000); });
    document.head.appendChild(css);
  }
  const root = el('div', 'labs');
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Learn');
  root.tabIndex = -1;
  root.innerHTML = `
    <section class="labs-shelf">
      <header class="labs-head">
        <button type="button" class="labs-x" aria-label="Close">×</button>
        <div class="labs-title"><h2>${CURSOR}Learn</h2><p>Play with it, then ask Cassie why it works.</p></div>
        <button type="button" class="theme-switch labs-theme" role="switch" aria-checked="false" aria-label="Dark mode"><span class="ts-track"><span class="ts-knob"></span></span></button>
      </header>
      <div class="lp" hidden>
        <header class="lp-head"><h2>Learn</h2><button type="button" class="lp-find" aria-label="Search labs" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/></svg></button></header>
        <input type="search" class="lp-q" placeholder="Find a lab or a study tool" aria-label="Find a lab or a study tool" autocomplete="off" hidden>
        <div class="lp-home">
          <h3 class="lp-h">Today’s Labs</h3>
          <div class="lp-rec"></div>
          <h3 class="lp-h">Levels</h3>
          <div class="lp-foryou"></div>
          <h3 class="lp-h">Simulations: Visual Labs</h3>
          <div class="lp-sims"></div>
          <h3 class="lp-h">Study Tools: Learn your way</h3>
          <div class="lp-toolsf"></div>
        </div>
        <div class="lp-list" hidden>
          <header class="lp-list-head"><button type="button" class="lp-back" aria-label="Back">‹</button><h3></h3></header>
          <div class="lp-rows" role="list"></div>
        </div>
      </div>
      <div class="labs-tools">
        <input type="search" class="labs-search" placeholder="Find a lab: pendulum, planets, sudoku, timeline, Cornell notes…" aria-label="Find a lab or a puzzle" autocomplete="off">
      </div>
      <div class="labs-scroll">
        <div class="labs-board" hidden></div>
        <div class="labs-today"></div>
        <div class="labs-foryou"></div>
        <div class="labs-sims"></div>
        <div class="labs-toolsf"></div>
        <div class="labs-grid" role="list"></div>
        <div class="labs-empty" hidden></div>
      </div>
    </section>
    <section class="lab-view" hidden>
      <header class="lab-head">
        <button type="button" class="lab-back" aria-label="Back to all labs">‹ <span>Learn</span></button>
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
  let deskPath = []; // (a computer: the folders open, one inside the next, like ['level:jhs', 'levelsims:jhs'])
  const deskTop = () => deskPath[deskPath.length - 1] || '';
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
    $('.labs-title h2').innerHTML = `${CURSOR}${games ? 'Games' : 'Learn'}`;
    $('.labs-title p').textContent = games ? 'Daily puzzles and games. Play, then ask Cassie how to think about them.' : 'Play with it, then ask Cassie why it works.';
    search.placeholder = games ? 'Find a game or puzzle: sudoku, circuit, map blitz…' : 'Find a lab: pendulum, planets, timeline, Cornell notes…';
    $('.lab-back span').textContent = games ? 'Games' : 'Learn';
    root.querySelectorAll('[data-section]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.section === section)));
    shelf.dataset.shelf = section;
    root.dataset.section = section; // (the app's Games button shows as on while the games are open)
  }
  function renderShelf() {
    const q = search.value.trim().toLowerCase();
    // a computer's Learn: Today's Labs, the Levels, Simulations: Visual Labs, then Study Tools;
    // a folder opened: its folders, lessons or labs, with a way back one step; searching (or the games): the cards
    const home = !q && section === 'learn', top = deskTop();
    const fy = $('.labs-foryou'), sims = $('.labs-sims'), tf = $('.labs-toolsf');
    fy.hidden = !home; sims.hidden = tf.hidden = !home || !!top; grid.hidden = home && !top;
    if (home && top) {
      const up = deskPath.length > 1 ? groupName(deskPath[deskPath.length - 2]) : 'Learn';
      fy.innerHTML = `<div class="lf-head"><button type="button" class="lab-btn lf-back-btn" aria-label="Back to ${esc(up)}">‹ Back</button><h3>${esc(groupName(top))}</h3></div>`;
      const inner = innerFolders(top) || (top.startsWith('lessons:') ? lessonsBox(top.slice(8)) : null);
      if (inner) { fy.appendChild(inner); grid.hidden = true; grid.replaceChildren(); previews().then(() => pv(fy)); } else grid.replaceChildren(...groupLabs(top).map(card));
      $('.labs-empty').hidden = true; $('.labs-today').hidden = true;
      renderBoard(false);
      return;
    }
    if (home) {
      fy.innerHTML = '<h3 class="lf-h">Levels</h3>'; fy.appendChild(folders(true));
      sims.innerHTML = '<h3 class="lf-h">Simulations: Visual Labs</h3>'; sims.appendChild(visualFolder());
      tf.innerHTML = '<h3 class="lf-h">Study Tools: Learn your way</h3>'; tf.appendChild(toolFolders());
      previews().then(() => { pv(fy); pv(sims); pv(tf); });
    }
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
    const t = LABS.find((l) => l.id === (typeof todayLab === 'function' && todayLab())) || todays(), tp = progress(t); // (the student's level, like the phone)
    const today = $('.labs-today');
    today.hidden = !!q || section !== 'learn' || (subject !== 'all' && subject !== t.subject);
    today.innerHTML = `<h3 class="lf-h">Today’s Labs</h3><button type="button" class="labs-feature" data-lab="${t.id}">
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
    // (v246: a slim card, full width, only the lab's name and the play button; the section title says it is today's)
    $('.lp-rec').innerHTML = `<div class="lp-card lp-slim" data-subject="${esc(info[1])}">
      <div class="lp-info"><b>${esc(lab.name)}</b></div>
      <button type="button" class="lp-play" data-lab="${lab.id}" aria-label="Open today’s lab: ${esc(lab.name)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg></button></div>`;
  }
  // a list: the Learn labs and 3D views, the study tools, or one filter's labs; a folder of folders
  // (a level, Visual Labs) or a level's lessons
  function lpShow(kind, found) {
    const inner = innerFolders(kind) || (kind.startsWith('lessons:') ? lessonsBox(kind.slice(8)) : null);
    if (inner) {
      lpList.querySelector('h3').textContent = groupName(kind);
      lpRows.removeAttribute('role'); lpRows.replaceChildren(inner);
      lpHome.hidden = true; lpList.hidden = false; lp.dataset.view = kind;
      lpList.scrollTop = 0; shelf.scrollTop = 0;
      pv(lpList);
      return;
    }
    lpRows.setAttribute('role', 'list');
    const learn = [...EXPLORE, ...SIMS];
    const lists = { search: ['Search', found || []], ...(/^(level|levelsims|subject|tools|visual):/.test(kind) ? { [kind]: [groupName(kind), groupLabs(kind)] } : {}),
      learn: ['Simulations', learn], tools: ['Study tools', LABS.filter((l) => shelfOf(l) === 'tools')], science: ['Science', learn.filter((l) => SCIENCE.has(l.subject))],
      maths: ['Maths', learn.filter((l) => l.subject === 'math')], history: ['History', learn.filter((l) => l.subject === 'history')], '3d': ['3D', learn.filter(is3d)], games: ['Games', LABS.filter((l) => shelfOf(l) === 'games')],
    };
    const [title, list] = lists[kind] || lists.learn;
    lpList.querySelector('h3').textContent = title;
    lpRows.replaceChildren(...list.map(lpRow));
    lpHome.hidden = true; lpList.hidden = false; lp.dataset.view = kind;
    lpList.scrollTop = 0; shelf.scrollTop = 0;
    pv(lpList);
  }
  function lpRow(l) {
    const b = el('button', 'lp-row'); b.type = 'button'; b.dataset.lab = l.id; b.setAttribute('role', 'listitem');
    const pid = l.id === 'cells3d' ? 'cells3d' : l.id;
    b.innerHTML = `<span class="lp-thumb">${previewIds.has(pid) ? `<canvas class="lp-pv" data-pv="${pid}" aria-hidden="true"></canvas>` : iconSvg(l.icon)}</span>
      <span class="lp-row-text"><b>${esc(l.name)}</b><small>${esc(NAMES[l.subject] || '')}${is3d(l) ? ' · 3D' : ''}</small></span><i aria-hidden="true">›</i>`;
    return b;
  }
  // Levels: a glass folder for each level, the student's own first (dark, bigger, "Your level"); tap one
  // and its papers fan out, then its two folders open: Lessons and Simulations. The same on a computer.
  const levelLabs = (k) => [...EXPLORE, ...LABS].filter((l) => shelfOf(l) !== 'games' && (l.levels || []).some((x) => (LAB_LEVELS[k] || [k]).includes(x)));
  const levelLessons = (k) => (LEVEL_LESSONS && LEVEL_LESSONS[k]) || [];
  const still = () => document.documentElement.classList.contains('lite') || matchMedia('(prefers-reduced-motion: reduce)').matches;
  // the folders below the Levels: Visual Labs by subject, Study Tools by what they are for
  const SUBJECT_FOLDERS = [['biology', 'Biology'], ['chemistry', 'Chemistry'], ['physics', 'Physics'], ['space', 'Earth and Space'], ['math', 'Math'], ['geography', 'Geography'], ['history', 'History']];
  const TOOL_FOLDERS = [['notes', 'Notes', ['cornell']], ['cards', 'Flashcards and words', ['cardmatrix', 'vocab']], ['writing', 'Writing and research', ['essay', 'thesis']], ['time', 'Timelines', ['timeline']]];
  const toolLabs = () => LABS.filter((l) => shelfOf(l) === 'tools');
  function groupLabs(key) {
    const [kind, k] = key.split(':');
    if (kind === 'level' || kind === 'levelsims') return levelLabs(k);
    if (kind === 'lessons') return [];
    if (kind === 'visual') return [...EXPLORE, ...SIMS];
    if (kind === 'subject') return [...EXPLORE, ...SIMS].filter((l) => (k === '3d' ? is3d(l) : l.subject === k));
    if (kind === 'tools') { const t = TOOL_FOLDERS.find((x) => x[0] === k); return t ? t[2].map((id) => LABS.find((l) => l.id === id)).filter(Boolean) : toolLabs(); }
    return [];
  }
  function groupName(key) {
    const [kind, k] = key.split(':');
    const lv = (LEVELS.find((x) => x[0] === k) || [])[1] || '';
    if (kind === 'lessons') return k === 'board' ? 'Board exam lessons' : `${lv} lessons`;
    if (kind === 'levelsims') return k === 'board' ? 'Board exam simulations' : `${lv} simulations`;
    if (kind === 'bexam') return bpName(k);
    if (kind === 'bnotes') return 'My notes and reviewers';
    if (kind === 'visual') return 'Visual Labs';
    const all = { level: LEVELS, subject: [...SUBJECT_FOLDERS, ['3d', '3D']], tools: [...TOOL_FOLDERS, ['all', 'Study tools']] }[kind] || [];
    return (all.find((x) => x[0] === k) || [])[1] || '';
  }
  // a row of glass folders: [{ key, name, own }], each with up to 3 of its labs as papers
  function folderGrid(groups, cls = '') {
    const grid = el('div', 'lf-grid' + (cls ? ' ' + cls : '')); grid.setAttribute('role', 'list');
    grid.innerHTML = groups.map(({ key, name, own, sub }) => {
      const labs = groupLabs(key), level = key.startsWith('level:') ? ` data-level="${key.slice(6)}"` : '';
      const papers = key === 'level:board' ? ['LET', 'CPALE', 'NCLEX-RN'].map((x) => `<i class="lf-paper"><i class="lf-ico">${iconSvg('<path d="M10 10h12a4 4 0 0 1 4 4v24a3 3 0 0 0-3-3H10z"/><path d="M38 10H26a4 4 0 0 0-4 4v24a3 3 0 0 1 3-3h13z"/>')}</i><i class="lf-cap">${x} · Board exam</i></i>`).join('') : labs.slice(0, 3).map((l) => {
        const pid = l.id === 'cells3d' ? 'cells3d' : l.id;
        return `<i class="lf-paper">${previewIds.has(pid) ? `<canvas class="lf-pv" data-pv="${pid}" aria-hidden="true"></canvas>` : `<i class="lf-ico">${iconSvg(l.icon)}</i>`}<i class="lf-cap">${esc(l.name)} · ${esc(NAMES[l.subject] || '')}</i></i>`;
      }).join('');
      const n = sub || `${labs.length} ${labs.length === 1 ? (key.startsWith('tools:') ? 'tool' : 'lab') : (key.startsWith('tools:') ? 'tools' : 'labs')}`;
      return `<button type="button" class="lf${own ? ' lf-mine' : ''}" data-group="${key}"${level} role="listitem" aria-label="${esc(name)}, ${esc(n)}${own ? ', your level' : ''}">
        <i class="lf-tab" aria-hidden="true"></i><i class="lf-back" aria-hidden="true"></i>
        <i class="lf-papers" aria-hidden="true">${papers}</i>
        <span class="lf-front">${own ? '<span class="lf-yours">Your level</span>' : ''}<span class="lf-txt"><b>${esc(name)}</b><small>${esc(n)}</small></span>
          <span class="lf-go" aria-hidden="true">${own ? '<svg viewBox="0 0 24 24"><path d="M5 12h13M13 6l6 6-6 6"/></svg>' : '<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>'}</span></span></button>`;
    }).join('');
    return grid;
  }
  // the level folders (the student's own first), with a line on how they work
  function folders(desk) {
    const mine = levelNow(), order = [...LEVELS.filter(([k]) => k === mine), ...LEVELS.filter(([k]) => k !== mine)];
    const box = el('div', 'lf-box');
    const hint = el('p', 'lf-hint'); hint.textContent = desk ? 'Hover to peek, click to open' : 'Tap a folder to open';
    box.append(folderGrid(order.map(([k, name]) => ({ key: 'level:' + k, name, own: k === mine, ...(k === 'board' ? { sub: 'Lessons and simulations' } : {}) })), 'lf-levels'), hint);
    return box;
  }
  const simFolders = () => folderGrid(SUBJECT_FOLDERS.map(([k, name]) => ({ key: 'subject:' + k, name })), 'lf-subjects');
  // Simulations: Visual Labs, one folder that opens into a folder per subject
  const visualFolder = () => folderGrid([{ key: 'visual:all', name: 'Visual Labs', sub: `${SUBJECT_FOLDERS.length} subjects, ${groupLabs('visual:all').length} labs` }], 'lf-visual');
  // a folder made of folders: a level (its Lessons and Simulations) or Visual Labs (its subjects)
  function innerFolders(key) {
    const [kind, k] = key.split(':');
    if (kind === 'visual') return simFolders();
    if (key === 'level:board') return folderGrid([{ key: 'lessons:board', name: 'Lessons', sub: 'A reviewer for every topic' }, { key: 'levelsims:board', name: 'Simulations', sub: 'A mock exam for each' }], 'lf-inlevel');
    if (key === 'lessons:board') return boardExams('bexam');
    if (key === 'levelsims:board') return boardExams('bsim');
    if (kind === 'bexam') return boardExamBox(k);
    if (kind === 'bnotes') return boardNotesBox(k);
    if (kind !== 'level') return null;
    const ls = levelLessons(k);
    return folderGrid([{ key: 'lessons:' + k, name: 'Lessons', sub: ls.length ? `${ls.length} ${ls.length === 1 ? 'lesson' : 'lessons'}` : 'Coming soon' }, { key: 'levelsims:' + k, name: 'Simulations' }], 'lf-inlevel');
  }
  // a level's lessons (labs/level-lessons.js), or a calm "coming soon"
  function lessonsBox(k) {
    const ls = levelLessons(k), box = el('div', 'lf-lessons');
    if (!ls.length) {
      box.classList.add('lf-soon');
      box.innerHTML = `<span class="lf-soon-ico" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v15H5.5A1.5 1.5 0 0 1 4 17.5z"/><path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H13v15h5.5a1.5 1.5 0 0 0 1.5-1.5z"/></svg></span><b>Lessons are coming soon</b><p>Lessons for ${esc((LEVELS.find((x) => x[0] === k) || [])[1] || 'this level')} will show up here. For now, its Simulations are ready to try.</p>`;
      return box;
    }
    box.setAttribute('role', 'list');
    ls.forEach((l, i) => {
      const b = el('button', 'lp-row lf-lesson'); b.type = 'button'; b.setAttribute('role', 'listitem');
      if (l.lab) b.dataset.lab = l.lab; else if (l.go) b.dataset.lessonGo = l.go; else b.dataset.lessonAsk = l.ask || `Teach me ${l.name}`;
      b.innerHTML = `<span class="lp-row-text"><b>${esc(l.name)}</b>${l.blurb ? `<small>${esc(l.blurb)}</small>` : ''}</span><i aria-hidden="true">›</i>`;
      b.dataset.i = i; box.appendChild(b);
    });
    return box;
  }
  /* v241: Board and Licensure exams, a level of its own: Lessons (a folder per exam: My notes and reviewers, then
     every topic, each opening its reviewer or quiz) and Simulations (a folder per exam, opening its mock exam).
     The topics, progress and screens are boardprep.js's; Learn draws its folders and opens those screens. */
  let bpCat = null;
  const bpName = (ex) => { const x = bpCat && bpCat.exams.find((e) => e.key === ex); return x ? x.name : ''; };
  const bpLoad = () => (typeof boardPrepReady === 'function' ? boardPrepReady().then((B) => B.catalog()).then((c) => (bpCat = c)) : Promise.reject(new Error('board')));
  // a box that fills once the exams are known
  const bpBox = (cls, fill) => {
    const box = el('div', 'lf-board ' + cls);
    const go = () => { box.replaceChildren(); fill(box); };
    if (bpCat) go(); else { box.innerHTML = '<p class="lf-hint">Getting the exams ready…</p>'; bpLoad().then(go).catch(() => { box.innerHTML = '<p class="lf-hint">The exams couldn’t load. Check your connection, then open this again.</p>'; }); }
    return box;
  };
  // every exam, as folders: kind bexam (its lessons) or bsim (its simulation)
  function boardExams(kind) {
    return bpBox('lf-bexams', (box) => {
      [['Philippine board exams', true], ['For studying or working abroad', false]].forEach(([title, ph]) => {
        const h = el('h4', 'lf-sub'); h.textContent = title; box.appendChild(h);
        box.appendChild(folderGrid(bpCat.exams.filter((x) => x.ph === ph).map((x) => {
          let sub = kind === 'bexam' ? 'Lessons' : 'Mock exam';
          if (kind === 'bexam') { const c = bpCat.count(x.key); sub = c ? `${c[0]} of ${c[1]} topics done` : 'Choose your level'; }
          else { const s = bpCat.sim(x.key); if (s && s.fin) sub = `Last score ${s.score}%`; else if (s && s.n) sub = `In progress: question ${s.i + 1} of ${s.n}`; }
          return { key: `${kind}:${x.key}`, name: x.name, sub };
        }), 'lf-exams'));
      });
    });
  }
  // an exam's lessons: My notes and reviewers first, then its parts and topics
  function boardExamBox(ex) {
    return bpBox('lf-bexam', (box) => {
      const n = bpCat.notes(ex).length;
      box.appendChild(folderGrid([{ key: 'bnotes:' + ex, name: 'My notes and reviewers', sub: n ? `${n} saved` : 'Add your own' }], 'lf-notesf'));
      if (bpCat.needsSetup(ex)) {
        const b = el('button', 'lp-row lf-lesson'); b.type = 'button'; b.dataset.bpSetup = ex;
        b.innerHTML = '<span class="lp-row-text"><b>Choose your level first</b><small>Then its topics show here</small></span><i aria-hidden="true">›</i>';
        box.appendChild(b); return;
      }
      const lv = bpCat.level(ex); if (lv) { const p = el('p', 'lf-hint'); p.textContent = `${lv}. `; const c = el('button', 'lab-btn lf-change'); c.type = 'button'; c.dataset.bpSetup = ex; c.textContent = 'Change level'; p.appendChild(c); box.appendChild(p); }
      bpCat.parts(ex).forEach((part) => {
        const h = el('h4', 'lf-sub'); h.textContent = part.name; box.appendChild(h);
        const list = el('div', 'lf-lessons'); list.setAttribute('role', 'list');
        part.topics.forEach((tp) => {
          const b = el('button', 'lp-row lf-lesson'); b.type = 'button'; b.setAttribute('role', 'listitem');
          b.dataset.bpTopic = tp.t; b.dataset.bpPart = part.name; b.dataset.bpEx = ex; if (tp.locked) b.dataset.bpPro = '1';
          const tag = tp.locked ? 'Pro' : tp.status;
          b.innerHTML = `<span class="lp-row-text"><b>${esc(tp.t)}</b><small>${tag ? esc(tag) : 'Read the lesson or quiz yourself'}</small></span><i aria-hidden="true">›</i>`;
          list.appendChild(b);
        });
        box.appendChild(list);
      });
    });
  }
  // the student's own notes and reviewers for one exam
  function boardNotesBox(ex) {
    return bpBox('lf-bnotes', (box) => {
      const add = el('button', 'lab-btn lf-addnote'); add.type = 'button'; add.dataset.bpAddnote = ex; add.textContent = 'Add notes or a reviewer'; box.appendChild(add);
      const ns = bpCat.notes(ex);
      if (!ns.length) { const p = el('p', 'lf-hint'); p.textContent = 'Paste your notes, or attach a PDF, a Word file or a photo. Cassie can quiz you on them on the spot. They stay on this device.'; box.appendChild(p); return; }
      const list = el('div', 'lf-lessons'); list.setAttribute('role', 'list');
      ns.forEach((n) => {
        const b = el('button', 'lp-row lf-lesson'); b.type = 'button'; b.setAttribute('role', 'listitem'); b.dataset.bpNote = n.id; b.dataset.bpEx = ex;
        b.innerHTML = `<span class="lp-row-text"><b>${esc(n.title)}</b><small>Read it, or let Cassie quiz you on it</small></span><i aria-hidden="true">›</i>`;
        list.appendChild(b);
      });
      box.appendChild(list);
    });
  }
  // Learn draws again when a Board exams screen closes (progress, a new note)
  const bpRedraw = () => { bpLoad().then(() => { if (!lpList.hidden && lp.dataset.view) lpShow(lp.dataset.view); renderShelf(); }).catch(() => {}); };
  const bpOpen = (start) => { if (typeof openBoardPrep === 'function') openBoardPrep({ ...start, onClose: bpRedraw }); };
  // a tap on a board row or an exam's simulation folder (true: handled)
  function bpClick(e) {
    const t = e.target.closest('[data-bp-topic]');
    if (t) { if (t.dataset.bpPro && typeof boardProAsk === 'function') boardProAsk(); else bpOpen({ view: 'topic', exam: t.dataset.bpEx, t: t.dataset.bpTopic, part: t.dataset.bpPart }); return true; }
    const n = e.target.closest('[data-bp-note]'); if (n) { bpOpen({ view: 'note', exam: n.dataset.bpEx, id: n.dataset.bpNote }); return true; }
    const a = e.target.closest('[data-bp-addnote]'); if (a) { bpOpen({ view: 'addnote', exam: a.dataset.bpAddnote }); return true; }
    const s = e.target.closest('[data-bp-setup]'); if (s) { bpOpen({ view: 'setup', exam: s.dataset.bpSetup }); return true; }
    const f = e.target.closest('.lf[data-group^="bsim:"]'); if (f) { bpOpen({ view: 'sims', exam: f.dataset.group.slice(5) }); return true; }
    return false;
  }
  let lpPath = []; // (the phone: the folders open, one inside the next)
  const toolFolders = () => folderGrid(TOOL_FOLDERS.map(([k, name]) => ({ key: 'tools:' + k, name })), 'lf-tools');
  function lpForYou() {
    const box = $('.lp-foryou');
    box.dataset.level = levelNow() || 'none';
    box.replaceChildren(folders(false));
    $('.lp-sims').replaceChildren(visualFolder());
    $('.lp-toolsf').replaceChildren(toolFolders());
  }
  // a folder's papers fan out, then its level opens (Reduce Motion or Lite mode: at once)
  // (Reduce Motion or Lite mode: the gentle version in labs.css, and a shorter wait)
  function openFolder(f, go) {
    if (f.classList.contains('lf-open')) return;
    f.classList.add('lf-open');
    setTimeout(() => { f.classList.remove('lf-open', 'lf-lean'); go(); }, still() ? 150 : 380);
  }
  // lean: the pointer over a folder (a mouse, a pen or a finger held down) or keyboard focus. Done here,
  // not with CSS :hover, so it works whatever the browser says about hover
  const lean = (f, on) => { if (f && !f.classList.contains('lf-open')) f.classList.toggle('lf-lean', on); };
  root.addEventListener('pointerover', (e) => { const f = e.target.closest('.lf'); if (f && !(e.relatedTarget && f.contains(e.relatedTarget))) lean(f, true); });
  root.addEventListener('pointerout', (e) => { const f = e.target.closest('.lf'); if (f && !(e.relatedTarget && f.contains(e.relatedTarget))) lean(f, false); });
  root.addEventListener('pointerdown', (e) => lean(e.target.closest('.lf'), true));
  root.addEventListener('pointercancel', () => root.querySelectorAll('.lf-lean').forEach((f) => lean(f, false)));
  root.addEventListener('focusin', (e) => lean(e.target.closest('.lf'), true));
  root.addEventListener('focusout', (e) => lean(e.target.closest('.lf'), false));
  function lpHomeView() { lpPath = []; lpList.hidden = true; lpHome.hidden = false; lp.dataset.view = 'home'; lpChip('all'); lpRec(); lpForYou(); pv(lpHome); previews().then(() => { if (lp.dataset.view === 'home') { lpForYou(); pv(lpHome); } }); } // (again once the previews are known)
  // the level changed (Edit profile): For you and Today's Lab follow at once
  function levelChanged() { if (lp.dataset.view === 'home') lpHomeView(); if (!root.hidden && !phoneOn()) { deskPath = []; renderShelf(); } }
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
      if (id === 'all') lpHomeView(); else { lpChip(id); lpPath = [id]; previews().then(() => lpShow(id)); }
      return;
    }
    if (bpClick(e)) return;
    const f = e.target.closest('.lf');
    if (f) { openFolder(f, () => previews().then(() => { lpPath.push(f.dataset.group); lpShow(f.dataset.group); })); return; }
    const go = e.target.closest('[data-lp-open]');
    if (go) { lpChip(go.dataset.lpOpen === 'tools' ? 'tools' : 'all'); lpPath = [go.dataset.lpOpen]; previews().then(() => lpShow(go.dataset.lpOpen)); return; }
    if (e.target.closest('.lp-back')) { lpPath.pop(); if (lpPath.length && lp.dataset.view !== 'search') previews().then(() => lpShow(lpPath[lpPath.length - 1])); else lpHomeView(); return; }
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
      lpPath = []; lpShow('search', found);
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
      const nDone = window.busyButton ? window.busyButton(n, 'Asking Cassie…') : (n.disabled = true, () => { n.disabled = false; }); out.hidden = false; out.textContent = 'Cassie is thinking…'; out.classList.add('muted');
      opts.explain(`A student is working on this challenge in the ${lab.name} simulation (${lab.blurb}): "${lab.tries[i]}". What is on their screen now: ${described() || 'they have just started'}. Give one short, friendly hint in at most two sentences that points them in the right direction WITHOUT giving the answer or the exact numbers. Plain text, no formatting.`)
        .then((text) => { if (current !== lab) return; out.classList.remove('muted'); out.textContent = String(text || '').replace(/[*_#`>]/g, '').trim() || 'Try changing one thing at a time and watch what happens.'; })
        .catch(() => { if (current !== lab) return; out.classList.remove('muted'); out.textContent = errorWords('lab_ai_failed', { next: 'Read the hint above, or tap Ask Cassie.' }); })
        .finally(() => { nDone(); });
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
  window.cassieThemeButtons?.(); // (the sun and moon button: app.js draws it and flips light and dark)
  root.addEventListener('click', (e) => {
    const c = e.target.closest('[data-lab]');
    // the card says "Opening…" at once; the lab is built once that has been drawn (a big lab takes a moment)
    if (c && shelf.contains(c) && !c.classList.contains('opening')) {
      c.classList.add('opening');
      const id = c.dataset.lab;
      requestAnimationFrame(() => setTimeout(() => { c.classList.remove('opening'); if (!root.hidden && !shelf.hidden) openLab(id); }));
    }
    // a lesson Cassie teaches (labs/level-lessons.js, an entry without a lab)
    const la = e.target.closest('[data-lesson-ask]');
    if (la && shelf.contains(la)) { const ask = la.dataset.lessonAsk; close(); if (opts.onAsk) opts.onAsk(ask, {}); return; }
    const lg = e.target.closest('[data-lesson-go]');
    if (lg && shelf.contains(lg)) { const go = lg.dataset.lessonGo; close(); if (typeof goLesson === 'function') goLesson(go); return; }
    if (!lp.contains(e.target) && bpClick(e)) return; // (the phone list has its own)
    // a computer's folders: open one (inside the one that is open), or back one step
    const f = e.target.closest('.labs-scroll .lf');
    if (f) { openFolder(f, () => { deskPath.push(f.dataset.group); renderShelf(); $('.labs-scroll').scrollTop = 0; }); return; }
    if (e.target.closest('.lf-back-btn')) { deskPath.pop(); renderShelf(); return; }
    const sec = e.target.closest('.labs-tabs [data-section]');
    if (sec && shelf.contains(sec)) { deskPath = []; setSection(sec.dataset.section); search.value = ''; renderShelf(); return; }
    const s = e.target.closest('[data-subject], [data-subject-go]');
    if (s && shelf.contains(s)) {
      const v = s.dataset.subject || s.dataset.subjectGo;
      if (v === 'puzzles') { setSection('games'); renderShelf(); return; }
      setSection('learn');
      subject = v; deskPath = [];
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
      if (!opts.section && !opts.subject) deskPath = []; // (Learn opened: from its start)
      if (opts.subject === 'puzzles' || opts.section === 'games') setSection('games');
      else if (opts.section === 'tools') { setSection('learn'); deskPath = ['tools:all']; }
      else if (opts.section === 'learn') { setSection('learn'); deskPath = []; }
      else if (opts.subject && opts.subject !== 'all') { setSection('learn'); deskPath = opts.subject === '3d' ? ['subject:3d'] : ['visual:all', 'subject:' + opts.subject]; }
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
  return { open, close, openLab, root, levelChanged, get lab() { return current && current.id; }, get state() { return described(); } };
}

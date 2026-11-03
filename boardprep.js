/* Board and licensure exams (v240): one screen with two folders.
   Lessons: every exam, then its parts and topics. A topic's box has Read the lesson (a short reviewer Cassie writes
   the first time it opens, kept on this device) and Quiz me (5 questions, one at a time, explained after each). The
   quiz can stop at any time and pick up where it was, with the lesson one tap away.
   Simulations: a timed mock exam in the exam's shape, written in batches as you go: a mini mock (20) for everyone,
   the full length on Pro once paid plans are on. Results by part, with the weakest topics linked to their lessons.
   Topic maps come from rescue.js (the LET and BOARD); the app's helpers (askCassie, state, save, plusSheet…) are global. */
(function () {
  'use strict';
  const LESSON_KEY = 'cassie.prep.lessons', LESSON_MAX = 150, QUIZ_N = 5, PASS = 3, MINI = 20, BATCH = 10;
  // a full mock: how many questions, and the minutes it gets (one sitting of the exam, or one paper where it has several)
  const FULL = { let: [150, 180], cpale: [70, 180], cse: [170, 190], cle: [100, 180], nle: [100, 120], cele: [100, 240], pmle: [100, 180],
    nclex: [85, 300], ielts: [40, 60], oet: [42, 60], toefl: [50, 30], sat: [54, 64], jlpt: [50, 60], eps: [50, 70] };
  const PH = ['let', 'cpale', 'cse', 'cle', 'nle', 'cele', 'pmle'];
  const ORDER = [...PH, 'nclex', 'ielts', 'oet', 'toefl', 'sat', 'jlpt', 'eps'];
  const esc = (s) => escapeHtml(String(s == null ? '' : s));
  const P = () => {
    const p = state.prep || (state.prep = {});
    ['exams', 'read', 'quiz', 'done', 'sims'].forEach((k) => { if (!p[k] || typeof p[k] !== 'object') p[k] = {}; });
    // the old one-exam course (v235 to v239): its exam, level and the lessons it opened carry over, once
    if (!p.moved && state.letCourse && state.letCourse.level) {
      const c = state.letCourse, ex = c.exam || 'let';
      p.exams[ex] = { level: c.level, major: c.major || '' };
      Object.keys(c.done || {}).forEach((t) => { p.read[ex + '|' + t] = c.done[t]; });
      p.last = ex;
    }
    p.moved = 1;
    return p;
  };
  const key = (ex, t) => ex + '|' + t;
  const isPro = () => planName() === 'pro';
  const locked = (i) => !!serverPay && !isPro() && i >= BOARD_TASTE;
  const fullLocked = () => !!serverPay && !isPro();
  // the lesson texts: on this device only (big, and Cassie can write one again)
  const lessons = () => { try { return JSON.parse(localStorage.getItem(LESSON_KEY) || '{}') || {}; } catch (e) { return {}; } };
  const keepLesson = (k, l) => {
    const all = lessons(); all[k] = { l, at: Date.now() };
    const ks = Object.keys(all).sort((a, b) => all[b].at - all[a].at); ks.slice(LESSON_MAX).forEach((x) => delete all[x]);
    try { localStorage.setItem(LESSON_KEY, JSON.stringify(all)); } catch (e) { /* full or blocked: it stays on screen */ }
  };
  const json = (text, open) => { const s = noDashes(String(text || '')), i = s.indexOf(open), j = s.lastIndexOf(open === '[' ? ']' : '}'); if (i < 0 || j <= i) return null; try { return JSON.parse(s.slice(i, j + 1)); } catch (e) { return null; } };

  // ---------- each exam: its name, its level and its parts (LET from the LET map, the rest from BOARD) ----------
  let R = null, info = {};
  function examInfo(ex) {
    if (ex === 'let') return { key: 'let', name: 'LET', full: 'Licensure Examination for Teachers (LET)', note: LET_WEIGHTS, levels: [['elementary', 'Elementary'], ['secondary', 'Secondary']], levelQ: 'Which LET are you taking?' };
    return info[ex];
  }
  const cfgOf = (ex) => P().exams[ex] || null;
  const levelLabel = (ex, c) => { const i = examInfo(ex); return c && i.levels ? ((i.levels.find((l) => l[0] === c.level) || [])[1] || '') : ''; };
  const needsSetup = (ex) => { const i = examInfo(ex), c = cfgOf(ex); return !!i.levels && (!c || !c.level || (ex === 'let' && c.level === 'secondary' && !c.major)); };
  function partsOf(ex) {
    const c = cfgOf(ex) || {};
    if (ex === 'let') { const p = R.letParts(c.level || 'elementary', c.major || ''); return ['profed', 'major', 'gened'].filter((k) => p[k].length).map((k) => ({ key: k, name: k === 'major' ? `Your major: ${c.major}` : LET_PART_NAMES[k], topics: p[k] })); }
    return R.boardParts(ex, c.level || ex);
  }
  const topicsOf = (ex) => partsOf(ex).flatMap((p) => p.topics.map((t) => ({ t, part: p.name })));
  const fullName = (ex) => { const i = examInfo(ex), c = cfgOf(ex), lv = levelLabel(ex, c); return `${i.full}${lv ? `, ${lv}` : ''}${ex === 'let' && c && c.major ? ` (${c.major} major)` : ''}`; };
  const says = (ex) => (ex === 'let' ? BOARD_PH_SAYS : boardSays(info[ex]));
  const where = (ex) => (PH.includes(ex) ? 'Use short examples from the Philippines (a classroom, an office, a clinic, a barangay) where they fit.' : 'Use situations like the ones the test itself uses.');
  function status(ex, t) {
    const p = P(), k = key(ex, t), q = p.quiz[k];
    if (p.done[k]) return ['Done', 'st-ok'];
    if (q && q.qs && q.qs.length && !q.fin) return [`Quiz ${Math.min(q.i + 1, q.qs.length)} of ${q.qs.length}`, 'st-info'];
    if (p.read[k]) return ['Read', 'st-plain'];
    return ['', ''];
  }
  const doneCount = (ex) => { const ts = topicsOf(ex); return [ts.filter((x) => P().done[key(ex, x.t)]).length, ts.length]; };

  // ---------- the screen ----------
  let w = null, body = null, head = null, back = null, nav = [], tick = 0;
  function open(start = {}) {
    close();
    w = document.createElement('div');
    w.className = 'letc bp'; w.setAttribute('role', 'dialog'); w.setAttribute('aria-modal', 'true'); w.setAttribute('aria-labelledby', 'bp-h');
    w.innerHTML = '<div class="letc-card bp-card"><div class="letc-head bp-head"><button type="button" class="letc-x bp-back" aria-label="Back" hidden>‹</button><h2 id="bp-h">Board and licensure exams</h2><button type="button" class="letc-x bp-x" aria-label="Close">×</button></div><div class="bp-body" aria-live="polite"><p class="letc-note">Getting your exams ready…</p></div></div>';
    document.body.appendChild(w);
    body = w.querySelector('.bp-body'); head = w.querySelector('#bp-h'); back = w.querySelector('.bp-back');
    w.querySelector('.bp-x').addEventListener('click', close);
    back.addEventListener('click', goBack);
    w.addEventListener('click', (e) => { if (e.target === w) close(); });
    document.addEventListener('keydown', onKey, true);
    nav = [];
    letRescue().then((r) => {
      R = r; info = {}; R.boardExams().forEach((x) => { info[x.key] = x; });
      P(); save();
      const ex = start.exam && examInfo(start.exam) ? start.exam : '';
      if (start.view === 'sims') go(ex ? { v: 'simexam', ex } : { v: 'exams', mode: 'sims' }, true);
      else if (start.view === 'lessons' || ex) go(ex ? { v: 'exam', ex } : { v: 'exams', mode: 'lessons' }, true);
      else go({ v: 'home' }, true);
    }).catch(() => { body.innerHTML = '<p class="letc-note">The exams couldn’t load. Check your connection, then open them again.</p>'; });
    track('feature', 'board-prep');
  }
  function close() {
    stopTimer();
    if (w) { w.remove(); w = null; }
    document.removeEventListener('keydown', onKey, true);
    if (typeof refreshHub === 'function') refreshHub();
  }
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  // go to a view (home is the root); Back returns to the one before
  function go(view, root) { if (root) nav = []; nav.push(view); render(); }
  function goBack() { stopTimer(); nav.pop(); if (!nav.length) nav.push({ v: 'home' }); render(); }
  function render() {
    if (!w) return;
    stopTimer();
    const v = nav[nav.length - 1];
    back.hidden = nav.length < 2;
    body.innerHTML = '';
    ({ home, exams, setup, exam, topic, read, quiz, simexam, sim, results, review }[v.v] || home)(v);
    const card = w.querySelector('.bp-card'); card.scrollTop = 0;
    const first = body.querySelector('button, a, input'); if (first && v.v !== 'sim') first.focus({ preventScroll: true });
  }
  const h = (html) => { const d = document.createElement('div'); d.innerHTML = html; while (d.firstChild) body.appendChild(d.firstChild); };
  const on = (sel, fn) => body.querySelectorAll(sel).forEach((b) => b.addEventListener('click', (e) => fn(b, e)));
  const wait = (text) => { body.innerHTML = `<div class="bp-wait"><span class="bp-dots" aria-hidden="true"><i></i><i></i><i></i></span><p>${esc(text)}</p></div>`; };
  const oops = (text, again) => { body.innerHTML = `<p class="letc-note bp-err">${esc(text)}</p><div class="letc-row"><button type="button" class="letc-go bp-again">Try again</button><button type="button" class="letc-line bp-out">Back</button></div>`; on('.bp-again', again); on('.bp-out', goBack); };
  const cannot = () => { if (canChat()) return false; body.innerHTML = '<p class="letc-note">Cassie needs her connection to write lessons and questions. Add a free key in Settings, or try again when you’re online.</p><div class="letc-row"><button type="button" class="letc-go bp-set">Open Settings</button></div>'; on('.bp-set', () => { close(); openSettings(); }); return true; };

  // the two folders
  function home() {
    head.textContent = 'Board and licensure exams';
    const p = P(), started = ORDER.filter((ex) => p.exams[ex] || Object.keys(p.read).some((k) => k.startsWith(ex + '|')));
    h(`<div class="bp-folders">
      <button type="button" class="bp-folder" data-go="lessons"><span class="bp-fi" aria-hidden="true">📖</span><b>Lessons</b><small>Pick your exam, read a short reviewer for each topic, then quiz yourself.</small></button>
      <button type="button" class="bp-folder" data-go="sims"><span class="bp-fi" aria-hidden="true">🧪</span><b>Simulations</b><small>A timed practice exam in your exam’s shape, scored by part.</small></button>
    </div>`);
    if (started.length) {
      h('<h3 class="bp-h3">Pick up where you left off</h3><div class="bp-list bp-recent"></div>');
      const list = body.querySelector('.bp-recent');
      started.slice(0, 3).forEach((ex) => { const [d, n] = needsSetup(ex) ? [0, 0] : doneCount(ex); list.appendChild(row(examInfo(ex).name, n ? `${d} of ${n} topics done` : 'Set up', '', () => go({ v: 'exam', ex }))); });
    }
    h(`<div class="letc-row"><button type="button" class="letc-line bp-rev">Check my own reviewer</button></div><p class="letc-note">Philippine board exams, and exams for studying or working abroad. Cassie isn’t affiliated with any exam’s owner, and every practice question is her own.</p>`);
    on('[data-go="lessons"]', () => go({ v: 'exams', mode: 'lessons' }));
    on('[data-go="sims"]', () => go({ v: 'exams', mode: 'sims' }));
    on('.bp-rev', () => reviewer(P().last || 'let'));
  }
  function row(title, sub, badge, fn, cls = '') {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'letc-lesson bp-row ' + cls;
    b.innerHTML = '<span><b></b><small></small></span>' + (badge ? '<em></em>' : '');
    b.querySelector('b').textContent = title; b.querySelector('small').textContent = sub;
    if (badge) { const e = b.querySelector('em'); e.textContent = badge[0]; e.className = 'st-badge ' + (badge[1] || ''); }
    b.addEventListener('click', fn);
    return b;
  }
  // every exam, in two groups
  function exams(v) {
    const sims = v.mode === 'sims';
    head.textContent = sims ? 'Simulations' : 'Lessons';
    h(`<p class="bp-lead">${sims ? 'Pick the exam to simulate.' : 'Pick your exam.'}</p><h3 class="bp-h3">Philippine board exams</h3><div class="bp-list bp-ph"></div><h3 class="bp-h3">For studying or working abroad</h3><div class="bp-list bp-ab"></div>`);
    ORDER.forEach((ex) => {
      const i = examInfo(ex), p = P();
      let sub = i.full;
      if (sims) { const s = p.sims[ex]; if (s && s.fin) sub = `Last score ${s.score}%`; else if (s && s.qs && s.qs.length) sub = `In progress: question ${s.i + 1} of ${s.n}`; }
      else if (!needsSetup(ex) && cfgOf(ex)) { const [d, n] = doneCount(ex); sub = `${d} of ${n} topics done`; }
      const b = row(i.name, sub, '', () => go(sims ? { v: 'simexam', ex } : { v: 'exam', ex }));
      b.dataset.exam = ex;
      body.querySelector(PH.includes(ex) ? '.bp-ph' : '.bp-ab').appendChild(b);
    });
  }
  // the exam's level (and the LET's major), asked once
  function setup(v) {
    const ex = v.ex, i = examInfo(ex), c = { ...(cfgOf(ex) || {}) };
    head.textContent = `${i.name} lessons`;
    const step = v.step || 'level';
    if (step === 'level') {
      h(`<p class="letc-q">${esc(i.levelQ || 'Which level are you taking?')}</p><div class="letc-picks">${i.levels.map(([k, l]) => `<button type="button" class="letc-pick bp-lvl" data-lvl="${esc(k)}">${esc(l)}</button>`).join('')}</div>`);
      on('.bp-lvl', (b) => {
        c.level = b.dataset.lvl; if (!(ex === 'let' && c.level === 'secondary')) c.major = '';
        P().exams[ex] = c; save();
        if (ex === 'let' && c.level === 'secondary') { nav[nav.length - 1] = { v: 'setup', ex, step: 'major', then: v.then }; render(); }
        else { nav.pop(); go(v.then || { v: 'exam', ex }); }
      });
    } else {
      h(`<p class="letc-q">What is your major?</p><div class="letc-picks">${LET_MAJOR_PICKS.map((m) => `<button type="button" class="letc-pick bp-maj">${esc(m)}</button>`).join('')}</div>`);
      on('.bp-maj', (b) => { c.major = b.textContent; P().exams[ex] = c; save(); nav.pop(); go(v.then || { v: 'exam', ex }); });
    }
  }
  // the exam's parts and topics
  function exam(v) {
    const ex = v.ex, i = examInfo(ex);
    if (needsSetup(ex)) { nav[nav.length - 1] = { v: 'setup', ex }; render(); return; }
    if (!cfgOf(ex)) { P().exams[ex] = { level: ex }; }
    P().last = ex; save();
    head.textContent = `${i.name} lessons`;
    const [d, n] = doneCount(ex);
    h(`<p class="letc-what bp-what"></p><div class="letc-prog" role="img" aria-label="${d} of ${n} topics done"><i style="width:${n ? Math.round((d / n) * 100) : 0}%"></i></div><p class="letc-count">${d} of ${n} topics done</p>
      <div class="letc-row">${i.levels ? '<button type="button" class="letc-line bp-change">Change level</button>' : ''}<button type="button" class="letc-line bp-sim">Simulate this exam</button><button type="button" class="letc-line bp-rev">Check my reviewer</button></div>
      <p class="letc-note bp-note"></p><p class="letc-note bp-says"></p><p class="letc-note bp-taste" hidden></p><div class="bp-parts"></div>`);
    body.querySelector('.bp-what').textContent = fullName(ex);
    body.querySelector('.bp-note').textContent = i.note || '';
    body.querySelector('.bp-says').textContent = says(ex);
    on('.bp-change', () => go({ v: 'setup', ex }));
    on('.bp-sim', () => go({ v: 'simexam', ex }));
    on('.bp-rev', () => reviewer(ex));
    const parts = body.querySelector('.bp-parts');
    let idx = 0;
    partsOf(ex).forEach((p) => {
      const h3 = document.createElement('h3'); h3.className = 'bp-h3'; h3.textContent = p.name; parts.appendChild(h3);
      const list = document.createElement('div'); list.className = 'bp-list'; parts.appendChild(list);
      p.topics.forEach((t) => {
        const lock = locked(idx++) && !P().done[key(ex, t)], st = status(ex, t);
        const b = row(t, p.name, lock ? ['Pro', 'st-info'] : st[0] ? st : null, () => (lock ? boardProAsk(close) : go({ v: 'topic', ex, t, part: p.name })), lock ? 'locked' : '');
        b.dataset.topic = t;
        list.appendChild(b);
      });
    });
    if (topicsOf(ex).some((x, k) => locked(k))) { const tt = body.querySelector('.bp-taste'); tt.hidden = false; tt.textContent = `The first ${BOARD_TASTE} topics are yours on every plan. Pro opens all ${n}.`; }
  }
  // a topic's box: read it, or quiz yourself
  function topic(v) {
    const { ex, t } = v, q = P().quiz[key(ex, t)], st = status(ex, t), going = q && q.qs && q.qs.length && !q.fin;
    head.textContent = examInfo(ex).name;
    h(`<div class="bp-box"><p class="bp-part"></p><h3 class="bp-title"></h3><p class="bp-state"></p>
      <div class="bp-acts"><button type="button" class="letc-go bp-read">Read the lesson</button><button type="button" class="letc-line bp-quiz">${going ? `Continue the quiz (question ${q.i + 1} of ${q.qs.length})` : 'Quiz me'}</button></div>
      <button type="button" class="bp-chat">Talk it through with Cassie in the chat</button></div>`);
    body.querySelector('.bp-part').textContent = v.part || '';
    body.querySelector('.bp-title').textContent = t;
    body.querySelector('.bp-state').textContent = st[0] === 'Done' ? 'Done: you passed its quiz. Read or quiz again any time.' : P().read[key(ex, t)] ? 'You’ve read this one. Quiz yourself when you’re ready.' : 'Start with the lesson, or go straight to the quiz.';
    on('.bp-read', () => go({ v: 'read', ex, t, part: v.part }));
    on('.bp-quiz', () => go({ v: 'quiz', ex, t, part: v.part }));
    on('.bp-chat', () => {
      close();
      if (onPhoneHome()) window.CassieNative.go('chat'); else if (document.body.classList.contains('desk-on')) deskGo('chat');
      if (!canChat()) { openSettings(); return; }
      handleSend(`Teach me "${t}" for the ${fullName(ex)}, step by step, then ask me if I have questions.`);
    });
  }
  // the lesson: written once, then kept
  async function read(v) {
    const { ex, t } = v, k = key(ex, t);
    head.textContent = examInfo(ex).name;
    const kept = lessons()[k];
    if (kept && kept.l) { showLesson(v, kept.l); return; }
    if (cannot()) return;
    wait('Cassie is writing your lesson…');
    const ask = `Write a short reviewer lesson on "${t}" for the ${fullName(ex)}. ${where(ex)} Plain words, like a good tutor. Reply with ONLY JSON, no other text, in this shape: {"goals": ["3 short things they'll be able to do"], "cards": [{"h": "a short heading", "p": "the idea in 2 to 4 short sentences"}], "example": {"q": "one exam-style question", "o": ["option A", "option B", "option C", "option D"], "a": 0, "why": "why the right one is right and the others are wrong, in 2 or 3 sentences"}, "traps": ["2 or 3 mistakes examinees often make on this"], "terms": [{"t": "key term", "d": "its meaning in one sentence"}], "summary": ["3 lines to remember"]}. Use 3 or 4 cards and 3 to 6 terms.`;
    let l = null;
    try { l = json(await askCassie([{ role: 'user', content: ask }]), '{'); } catch (e) { /* below */ }
    if (!w || nav[nav.length - 1].v !== 'read') return;
    if (!l || !Array.isArray(l.cards) || !l.cards.length) { oops('Cassie couldn’t write this lesson just now.', () => render()); return; }
    keepLesson(k, l); track('feature', 'board-lesson');
    showLesson(v, l);
  }
  function showLesson(v, l) {
    const { ex, t } = v, k = key(ex, t), arr = (x) => (Array.isArray(x) ? x : []);
    body.innerHTML = ''; // (the waiting dots go)
    P().read[k] = P().read[k] || Date.now(); save();
    const ex1 = l.example && l.example.q && Array.isArray(l.example.o) ? l.example : null;
    h(`<article class="bp-lesson"><p class="bp-part"></p><h3 class="bp-title"></h3>
      <section class="bp-goals"><h4>What you’ll learn</h4><ul></ul></section>
      <div class="bp-cards"></div>
      ${ex1 ? '<section class="bp-ex"><h4>Worked example</h4><p class="bp-exq"></p><ol class="bp-exo" type="A"></ol><p class="bp-exwhy"></p></section>' : ''}
      <section class="bp-traps"><h4>Exam traps</h4><ul></ul></section>
      <section class="bp-terms"><h4>Key terms</h4><dl></dl><button type="button" class="letc-line bp-cardsave">Save key terms as flashcards</button></section>
      <section class="bp-sum"><h4>Remember this</h4><ul></ul></section></article>
      <div class="letc-row bp-end"><button type="button" class="letc-go bp-quiz">Quiz me</button><button type="button" class="letc-line bp-out">Back to topics</button></div>`);
    body.querySelector('.bp-part').textContent = v.part || '';
    body.querySelector('.bp-title').textContent = t;
    const li = (sel, xs) => { const u = body.querySelector(sel); arr(xs).forEach((x) => { const e = document.createElement('li'); e.textContent = String(x); u.appendChild(e); }); if (!u.children.length) u.closest('section').remove(); };
    li('.bp-goals ul', l.goals); li('.bp-traps ul', l.traps); li('.bp-sum ul', l.summary);
    const cards = body.querySelector('.bp-cards');
    arr(l.cards).forEach((c) => { const s = document.createElement('section'); s.className = 'bp-lcard'; s.innerHTML = '<h4></h4><p></p>'; s.querySelector('h4').textContent = c.h || ''; s.querySelector('p').textContent = c.p || ''; cards.appendChild(s); });
    if (ex1) {
      body.querySelector('.bp-exq').textContent = ex1.q;
      const ol = body.querySelector('.bp-exo');
      ex1.o.forEach((o, i) => { const e = document.createElement('li'); e.textContent = o; if (i === +ex1.a) { e.className = 'right'; e.setAttribute('aria-label', o + ' (the answer)'); } ol.appendChild(e); });
      body.querySelector('.bp-exwhy').textContent = ex1.why || '';
    }
    const dl = body.querySelector('.bp-terms dl'), terms = arr(l.terms).filter((x) => x && x.t && x.d);
    terms.forEach((x) => { const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = x.t; dd.textContent = x.d; dl.append(dt, dd); });
    if (!terms.length) body.querySelector('.bp-terms').remove();
    on('.bp-cardsave', (b) => {
      const n = window.CassieCards ? window.CassieCards.add(terms.map((x) => ({ f: String(x.t), b: String(x.d) })), `${examInfo(ex).name}: ${t}`, 'board-prep') : 0;
      b.textContent = n ? `Saved ${terms.length} cards` : 'Saved'; b.disabled = true;
    });
    on('.bp-quiz', () => { nav[nav.length - 1] = { v: 'quiz', ex, t, part: v.part }; render(); });
    on('.bp-out', () => { while (nav.length > 1 && nav[nav.length - 1].v !== 'exam') nav.pop(); render(); });
  }
  // the quiz: 5 questions, one at a time; Stop keeps the place
  async function quiz(v) {
    const { ex, t } = v, k = key(ex, t), p = P();
    head.textContent = examInfo(ex).name;
    let q = p.quiz[k];
    if (!q || !q.qs || !q.qs.length || q.fin) {
      if (cannot()) return;
      wait('Cassie is writing your questions…');
      let qs = [];
      try { qs = parseQs(await askCassie([{ role: 'user', content: qPrompt(ex, [t], QUIZ_N) }])); } catch (e) { /* below */ }
      if (!w || nav[nav.length - 1].v !== 'quiz') return;
      if (!qs.length) { oops('Cassie couldn’t write the questions just now.', () => render()); return; }
      q = p.quiz[k] = { qs, i: 0, right: 0, picked: [], fin: false }; save();
      track('feature', 'board-quiz');
    }
    showQ(v, q);
  }
  function qPrompt(ex, topics, n) {
    return `Write ${n} exam-style multiple-choice questions for the ${fullName(ex)}, ${topics.length === 1 ? `all on "${topics[0]}"` : `one on each of these topics, in this order: ${topics.map((x, i) => `${i + 1}) ${x}`).join('; ')}`}. Make them like the real exam: often a short situation, 4 options, exactly one right answer, believable wrong options. ${where(ex)} These are your own questions, never copied from a real exam. Reply with ONLY a JSON array, no other text: [{"t": "the topic", "q": "question", "o": ["option A", "option B", "option C", "option D"], "a": 0, "why": "why the right one is right and the others are wrong, in 2 short sentences"}]`;
  }
  function parseQs(text) {
    const a = json(text, '[');
    return Array.isArray(a) ? a.filter((x) => x && x.q && Array.isArray(x.o) && x.o.length >= 2 && Number.isInteger(+x.a) && +x.a >= 0 && +x.a < x.o.length).map((x) => ({ t: String(x.t || ''), q: String(x.q), o: x.o.map(String).slice(0, 5), a: +x.a, why: String(x.why || '') })) : [];
  }
  function showQ(v, q) {
    const { ex, t } = v, k = key(ex, t);
    body.innerHTML = '';
    if (q.i >= q.qs.length) { finishQuiz(v, q); return; }
    const x = q.qs[q.i], picked = q.picked[q.i];
    h(`<div class="bp-qtop"><span class="bp-qn">Question ${q.i + 1} of ${q.qs.length}</span><span class="bp-qbtns"><button type="button" class="letc-line bp-toread">Read the lesson</button><button type="button" class="letc-line bp-stop">Stop</button></span></div>
      <div class="letc-prog" role="img" aria-label="Question ${q.i + 1} of ${q.qs.length}"><i style="width:${Math.round((q.i / q.qs.length) * 100)}%"></i></div>
      <p class="bp-q"></p><div class="bp-opts" role="group" aria-label="Choices"></div><div class="bp-fb" hidden><p class="bp-fbh"></p><p class="bp-why"></p><button type="button" class="letc-go bp-next"></button></div>`);
    body.querySelector('.bp-q').textContent = x.q;
    const opts = body.querySelector('.bp-opts');
    x.o.forEach((o, i) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'bp-opt'; b.dataset.i = i; b.textContent = `${'ABCDE'[i]}. ${o}`; opts.appendChild(b); });
    const answered = (pick) => {
      opts.querySelectorAll('.bp-opt').forEach((b) => { b.disabled = true; const i = +b.dataset.i; if (i === x.a) b.classList.add('right'); else if (i === pick) b.classList.add('wrong'); });
      const fb = body.querySelector('.bp-fb'); fb.hidden = false;
      body.querySelector('.bp-fbh').textContent = pick === x.a ? `Right: ${'ABCDE'[x.a]}.` : `Not quite. The answer is ${'ABCDE'[x.a]}.`;
      body.querySelector('.bp-fbh').className = 'bp-fbh ' + (pick === x.a ? 'ok' : 'no');
      body.querySelector('.bp-why').textContent = x.why;
      const nx = body.querySelector('.bp-next'); nx.textContent = q.i + 1 < q.qs.length ? 'Next question' : 'See my score'; nx.focus({ preventScroll: true });
    };
    if (picked != null) answered(picked);
    on('.bp-opt', (b) => {
      if (q.picked[q.i] != null) return;
      const pick = +b.dataset.i; q.picked[q.i] = pick;
      if (pick === x.a) q.right++;
      // a miss comes back later in Review my mistakes, like the chat's quizzes
      captureQuizMarks(pick === x.a ? `[[GOT: ${x.q} || ${x.o[x.a]}]]` : `[[MISSED: ${x.q} || ${x.o[x.a]}. ${x.why}]]`);
      save(); answered(pick);
    });
    on('.bp-next', () => { q.i++; save(); render(); });
    on('.bp-stop', () => { save(); while (nav.length > 1 && nav[nav.length - 1].v !== 'topic') nav.pop(); if (nav[nav.length - 1].v !== 'topic') nav.push({ v: 'topic', ex, t, part: v.part }); render(); });
    on('.bp-toread', () => { save(); nav[nav.length - 1] = { v: 'read', ex, t, part: v.part }; render(); });
    void k;
  }
  function finishQuiz(v, q) {
    const { ex, t } = v, k = key(ex, t), pass = q.right >= PASS;
    q.fin = true;
    if (pass) P().done[k] = P().done[k] || Date.now();
    save();
    const next = (() => { const ts = topicsOf(ex), i = ts.findIndex((x) => x.t === t); return ts.slice(i + 1).find((x, j) => !P().done[key(ex, x.t)] && !locked(i + 1 + j)) || null; })();
    h(`<div class="bp-score"><p class="bp-big">${q.right} of ${q.qs.length}</p><p class="bp-scoremsg"></p></div>
      <div class="letc-row"><button type="button" class="letc-go bp-again2">Quiz me again</button><button type="button" class="letc-line bp-toread">Read the lesson again</button>${next ? '<button type="button" class="letc-line bp-nexttopic">Next topic</button>' : ''}</div>`);
    body.querySelector('.bp-scoremsg').textContent = pass ? `Passed. “${t}” is done.` : `Almost. Read the lesson again, then try new questions. You need ${PASS} of ${q.qs.length}.`;
    if (pass && typeof botMood === 'function') botMood('celebrate', 3000);
    on('.bp-again2', () => { delete P().quiz[k]; save(); render(); });
    on('.bp-toread', () => { nav[nav.length - 1] = { v: 'read', ex, t, part: v.part }; render(); });
    on('.bp-nexttopic', () => { nav[nav.length - 1] = { v: 'topic', ex, t: next.t, part: next.part }; render(); });
  }

  // ---------- simulations ----------
  function simexam(v) {
    const ex = v.ex, i = examInfo(ex);
    if (needsSetup(ex)) { nav[nav.length - 1] = { v: 'setup', ex, then: { v: 'simexam', ex } }; render(); return; }
    if (!cfgOf(ex)) { P().exams[ex] = { level: ex }; save(); }
    head.textContent = `${i.name} simulation`;
    const s = P().sims[ex], [fn, fm] = FULL[ex], going = s && s.qs && s.qs.length && !s.fin;
    h(`<p class="letc-what bp-what"></p>
      ${going ? `<div class="bp-box"><p class="bp-state">In progress: question ${s.i + 1} of ${s.n}, ${mmss(s.left)} left.</p><div class="bp-acts"><button type="button" class="letc-go bp-cont">Continue</button><button type="button" class="letc-line bp-drop">Start over</button></div></div>` : ''}
      <div class="bp-folders bp-sizes">
        <button type="button" class="bp-folder" data-size="mini"><b>Mini mock</b><small>${MINI} questions · ${Math.round((fm / fn) * MINI)} minutes · every part</small></button>
        <button type="button" class="bp-folder${fullLocked() ? ' locked' : ''}" data-size="full"><b>Full mock${fullLocked() ? ' <em class="st-badge st-info">Pro</em>' : ''}</b><small>${fn} questions · ${fm} minutes</small></button>
      </div>
      ${s && s.fin ? `<p class="letc-note">Last time: ${s.score}% (${s.right} of ${s.n}). <button type="button" class="bp-link bp-last">See those results</button></p>` : ''}
      <p class="letc-note">The timer pauses when you close this, and Cassie writes the questions in batches as you go. You see the answers at the end.</p><p class="letc-note bp-says"></p>`);
    body.querySelector('.bp-what').textContent = fullName(ex);
    body.querySelector('.bp-says').textContent = says(ex);
    on('.bp-cont', () => go({ v: 'sim', ex }));
    on('.bp-drop', () => { delete P().sims[ex]; save(); render(); });
    on('.bp-last', () => go({ v: 'results', ex }));
    on('[data-size]', (b) => {
      const full = b.dataset.size === 'full';
      if (full && fullLocked()) { boardProAsk(close); return; }
      if (going && !confirm('Start a new simulation? The one in progress ends.')) return;
      const n = full ? fn : MINI;
      P().sims[ex] = { size: full ? 'full' : 'mini', n, qs: [], i: 0, picks: {}, flags: {}, left: Math.round((fm / fn) * n) * 60, fin: false, at: Date.now() };
      save(); track('feature', 'board-sim-' + (full ? 'full' : 'mini'));
      go({ v: 'sim', ex });
    });
  }
  const mmss = (sec) => { sec = Math.max(0, Math.round(sec)); const m = Math.floor(sec / 60), s = sec % 60; return `${m}:${String(s).padStart(2, '0')}`; };
  let loading = null;
  // the next batch of questions, spread over every part (topics chosen at random, the parts taking turns)
  function moreQs(ex, s) {
    if (loading || s.qs.length >= s.n) return loading;
    const parts = partsOf(ex), want = Math.min(BATCH, s.n - s.qs.length), pick = [];
    for (let i = 0; i < want; i++) { const p = parts[(s.qs.length + i) % parts.length]; pick.push({ t: p.topics[Math.floor(Math.random() * p.topics.length)], part: p.name }); }
    loading = askCassie([{ role: 'user', content: qPrompt(ex, pick.map((x) => x.t), want) }]).then((text) => {
      const qs = parseQs(text).slice(0, want).map((q, i) => ({ ...q, t: pick[i] ? pick[i].t : q.t, part: pick[i] ? pick[i].part : '' }));
      if (qs.length) { s.qs.push(...qs); save(); }
      return qs.length;
    }).catch(() => 0).finally(() => { loading = null; });
    return loading;
  }
  async function sim(v) {
    const ex = v.ex, s = P().sims[ex];
    if (!s) { goBack(); return; }
    head.textContent = `${examInfo(ex).name} simulation`;
    if (s.fin) { nav[nav.length - 1] = { v: 'results', ex }; render(); return; }
    if (s.i >= s.qs.length) {
      if (cannot()) return;
      wait(s.qs.length ? 'Cassie is writing the next questions…' : 'Cassie is writing your simulation…');
      const got = await moreQs(ex, s);
      if (!w || nav[nav.length - 1].v !== 'sim') return;
      if (!got && s.i >= s.qs.length) { oops('Cassie couldn’t write the questions just now.', () => render()); return; }
    }
    const x = s.qs[s.i];
    body.innerHTML = '';
    h(`<div class="bp-simtop"><span class="bp-timer" role="timer" aria-live="off">${mmss(s.left)}</span><span class="bp-qn">Question ${s.i + 1} of ${s.n}</span><button type="button" class="letc-line bp-flag" aria-pressed="${!!s.flags[s.i]}">${s.flags[s.i] ? 'Flagged' : 'Flag'}</button></div>
      <p class="bp-part bp-simpart"></p><p class="bp-q"></p><div class="bp-opts" role="radiogroup" aria-label="Choices"></div>
      <div class="letc-row bp-simnav"><button type="button" class="letc-line bp-prev"${s.i ? '' : ' disabled'}>Previous</button><button type="button" class="letc-go bp-nextq">${s.i + 1 < s.n ? 'Next' : 'Finish'}</button></div>
      <details class="bp-grid"><summary>All questions · ${Object.keys(s.picks).length} answered, ${Object.keys(s.flags).filter((k) => s.flags[k]).length} flagged</summary><div class="bp-nums"></div></details>
      <div class="letc-row"><button type="button" class="letc-line bp-finish">Finish and see my score</button><button type="button" class="letc-line bp-pause">Pause</button></div>`);
    body.querySelector('.bp-simpart').textContent = x.part || '';
    body.querySelector('.bp-q').textContent = x.q;
    const opts = body.querySelector('.bp-opts');
    x.o.forEach((o, i) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'bp-opt'; b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(s.picks[s.i] === i)); b.dataset.i = i; b.textContent = `${'ABCDE'[i]}. ${o}`; opts.appendChild(b); });
    const nums = body.querySelector('.bp-nums');
    for (let i = 0; i < Math.max(s.qs.length, s.i + 1); i++) { const b = document.createElement('button'); b.type = 'button'; b.className = 'bp-num' + (s.picks[i] != null ? ' ans' : '') + (s.flags[i] ? ' flag' : '') + (i === s.i ? ' here' : ''); b.textContent = i + 1; b.setAttribute('aria-label', `Question ${i + 1}${s.picks[i] != null ? ', answered' : ''}${s.flags[i] ? ', flagged' : ''}`); b.addEventListener('click', () => { s.i = i; save(); render(); }); nums.appendChild(b); }
    on('.bp-opt', (b) => { s.picks[s.i] = +b.dataset.i; save(); opts.querySelectorAll('.bp-opt').forEach((o) => o.setAttribute('aria-checked', String(o === b))); });
    on('.bp-flag', (b) => { s.flags[s.i] = !s.flags[s.i]; if (!s.flags[s.i]) delete s.flags[s.i]; save(); b.setAttribute('aria-pressed', String(!!s.flags[s.i])); b.textContent = s.flags[s.i] ? 'Flagged' : 'Flag'; });
    on('.bp-prev', () => { s.i = Math.max(0, s.i - 1); save(); render(); });
    on('.bp-nextq', () => { if (s.i + 1 >= s.n) { endSim(ex, s); return; } s.i++; save(); render(); });
    on('.bp-finish', () => { const left = s.n - Object.keys(s.picks).length; if (left && !confirm(`${left} ${left === 1 ? 'question is' : 'questions are'} not answered yet. Finish anyway?`)) return; endSim(ex, s); });
    on('.bp-pause', () => { save(); goBack(); });
    if (s.qs.length - s.i <= 3) moreQs(ex, s); // (the next batch, before it's needed)
    const timer = body.querySelector('.bp-timer');
    tick = setInterval(() => {
      s.left -= 1; timer.textContent = mmss(s.left);
      if (s.left % 15 === 0) save();
      if (s.left <= 0) { stopTimer(); endSim(ex, s); }
    }, 1000);
  }
  function stopTimer() { if (tick) { clearInterval(tick); tick = 0; } }
  function endSim(ex, s) {
    stopTimer();
    s.fin = true; // (questions not reached count as not answered, like the real exam)
    s.right = s.qs.slice(0, s.n).filter((q, i) => s.picks[i] === q.a).length;
    s.score = Math.round((s.right / s.n) * 100);
    save(); track('feature', 'board-sim-done');
    nav[nav.length - 1] = { v: 'results', ex }; render();
  }
  function results(v) {
    const ex = v.ex, s = P().sims[ex];
    if (!s || !s.fin) { goBack(); return; }
    head.textContent = `${examInfo(ex).name} results`;
    const by = {}, weak = {};
    s.qs.slice(0, s.n).forEach((q, i) => { const p = q.part || 'Other'; by[p] = by[p] || [0, 0]; by[p][1]++; if (s.picks[i] === q.a) by[p][0]++; else weak[q.t] = { t: q.t, part: q.part, n: ((weak[q.t] || {}).n || 0) + 1 }; });
    h(`<div class="bp-score"><p class="bp-big">${s.score}%</p><p class="bp-scoremsg">${s.right} of ${s.n} right${s.size === 'mini' ? ' in a mini mock' : ''}.</p></div>
      <h3 class="bp-h3">By part</h3><table class="bp-table"><thead><tr><th scope="col">Part</th><th scope="col">Right</th></tr></thead><tbody></tbody></table>
      <h3 class="bp-h3 bp-weakh">Read these next</h3><div class="bp-list bp-weak"></div>
      <div class="letc-row"><button type="button" class="letc-go bp-review">Review my answers</button><button type="button" class="letc-line bp-new">New simulation</button></div>`);
    const tb = body.querySelector('.bp-table tbody');
    Object.keys(by).forEach((p) => { const tr = document.createElement('tr'); tr.innerHTML = '<td></td><td></td>'; tr.children[0].textContent = p; tr.children[1].textContent = `${by[p][0]} of ${by[p][1]}`; tb.appendChild(tr); });
    const ws = Object.values(weak).sort((a, b) => b.n - a.n).slice(0, 3), wl = body.querySelector('.bp-weak');
    ws.forEach((x) => { const b = row(x.t, x.part || '', ['Lesson', 'st-info'], () => go({ v: 'topic', ex, t: x.t, part: x.part })); b.classList.add('bp-weakrow'); wl.appendChild(b); });
    if (!ws.length) { body.querySelector('.bp-weakh').remove(); wl.remove(); }
    on('.bp-review', () => go({ v: 'review', ex }));
    on('.bp-new', () => { nav[nav.length - 1] = { v: 'simexam', ex }; render(); });
  }
  function review(v) {
    const ex = v.ex, s = P().sims[ex];
    head.textContent = 'Your answers';
    const ol = document.createElement('ol'); ol.className = 'bp-rev-list';
    s.qs.slice(0, s.n).forEach((q, i) => {
      const li = document.createElement('li'), ok = s.picks[i] === q.a;
      li.className = ok ? 'ok' : 'no';
      li.innerHTML = '<p class="bp-q"></p><p class="bp-yours"></p><p class="bp-why"></p>';
      li.querySelector('.bp-q').textContent = q.q;
      li.querySelector('.bp-yours').textContent = `${ok ? 'Right' : 'Not quite'}: you chose ${s.picks[i] != null ? 'ABCDE'[s.picks[i]] : 'nothing'}; the answer is ${'ABCDE'[q.a]}. ${q.o[q.a]}`;
      li.querySelector('.bp-why').textContent = q.why;
      ol.appendChild(li);
    });
    body.appendChild(ol);
  }
  // the student's own reviewer, checked in the chat (one question at a time)
  function reviewer(ex) {
    const name = (examInfo(ex) || { name: 'board exam' }).name;
    close();
    if (onPhoneHome()) window.CassieNative.go('chat'); else if (document.body.classList.contains('desk-on')) deskGo('chat');
    promptInput.value = LET_REVIEWER.replace('my LET reviewer', `my ${name} reviewer`) + '\n';
    autoGrow(); promptInput.focus(); promptInput.setSelectionRange(promptInput.value.length, promptInput.value.length);
  }
  // [done, all] for Home and the Study plan: the exam studied last
  function progress() {
    const p = state.prep; if (!p || !p.last || !window.CassieRescue) return null;
    if (!R) { R = window.CassieRescue; info = {}; R.boardExams().forEach((x) => { info[x.key] = x; }); }
    if (needsSetup(p.last)) return null;
    return { exam: examInfo(p.last).name, n: doneCount(p.last) };
  }
  window.CassieBoardPrep = { open, close, progress };
})();

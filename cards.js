/* Flashcards with spaced repetition — Cassie's active-recall study mode.
 *
 * Cards come from any answer ("＋ Flashcards" under it: Cassie writes the cards), from the
 * quiz questions the student missed (Review my mistakes), or are typed in by hand. Studying
 * shows the front; the student says how well they knew it, and the card comes back later:
 *   Again → in a few minutes · Hard → a little later · Good → 1, 3, 7, 16, 35 days · Easy → further
 * (a Leitner box system). Everything stays on the device (and syncs with an account).
 * Decks export for Anki (a tab-separated file Anki imports as-is) and Quizlet (paste into
 * "Import"), or as CSV.
 *
 *   CassieCards.init({ state: () => state, save, ask: async (prompt) => text, track, onChange })
 *   CassieCards.open(deck?) · CassieCards.fromText(text, deck) · CassieCards.fromMistakes()
 *   CassieCards.dueCount()
 */
(function () {
  'use strict';
  const DAY = 864e5, MIN = 6e4;
  const GAPS = [0, 1, 3, 7, 16, 35, 70]; // days, by box
  const MAX_CARDS = 2000;
  let ctx = null, ui = null, session = null;

  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const clean = (t, n) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, n);
  function all() { const s = ctx.state(); if (!Array.isArray(s.cards)) s.cards = []; return s.cards; }
  const now = () => Date.now();
  function dueOf(deck) { const t = now(); return all().filter((c) => (!deck || c.deck === deck) && (c.due || 0) <= t); }
  function decks() {
    const m = new Map(), t = now();
    all().forEach((c) => {
      const d = m.get(c.deck) || { name: c.deck, total: 0, due: 0, learned: 0 };
      d.total++; if ((c.due || 0) <= t) d.due++; if ((c.box || 0) >= 4) d.learned++;
      m.set(c.deck, d);
    });
    return [...m.values()].sort((a, b) => b.due - a.due || a.name.localeCompare(b.name));
  }
  function changed() { ctx.save(); if (ctx.onChange) ctx.onChange(); if (ui && !ui.hidden && !session) renderHome(); }

  // add cards (skips ones already in that deck); returns how many were new
  function add(list, deck, from = 'hand') {
    deck = clean(deck, 60) || 'My cards';
    const have = new Set(all().filter((c) => c.deck === deck).map((c) => c.f.toLowerCase()));
    let n = 0;
    for (const x of list) {
      const f = clean(x.front || x.f, 300), b = clean(x.back || x.b, 600);
      if (!f || !b || have.has(f.toLowerCase())) continue;
      have.add(f.toLowerCase());
      all().push({ id: now().toString(36) + Math.random().toString(36).slice(2, 7), f, b, deck, box: 0, due: now(), at: now(), from });
      n++;
    }
    const cards = all();
    if (cards.length > MAX_CARDS) cards.splice(0, cards.length - MAX_CARDS); // the oldest go first
    if (n) changed();
    return n;
  }

  // Cassie writes the cards for any text (an answer, a reviewer, notes)
  function parseCards(reply) {
    const s = String(reply || ''), a = s.indexOf('['), b = s.lastIndexOf(']');
    if (a < 0 || b <= a) return [];
    try {
      const arr = JSON.parse(s.slice(a, b + 1));
      return Array.isArray(arr) ? arr.filter((x) => x && (x.front || x.f) && (x.back || x.b)) : [];
    } catch (e) { return []; }
  }
  async function fromText(text, deck) {
    const prompt = 'Make flashcards for studying from the text below — the important facts, terms, definitions, '
      + 'steps and formulas a student must remember. Return ONLY a JSON array, no other words: '
      + '[{"front": "a short question or term", "back": "the answer, at most 30 words"}]. '
      + 'Make 6 to 15 cards. Plain text only: no markdown, no LaTeX. Use only what the text says.\n\nTEXT:\n'
      + String(text || '').slice(0, 9000);
    const list = parseCards(await ctx.ask(prompt));
    if (!list.length) throw new Error('Cassie couldn’t make cards from that — try a longer answer.');
    const n = add(list, deck, 'cassie');
    if (ctx.track) ctx.track('feature', 'flashcards:make');
    return { made: list.length, added: n, deck: clean(deck, 60) || 'My cards' };
  }
  function fromMistakes() {
    const m = (ctx.state().mistakes || []).filter((x) => x && x.q);
    const n = add(m.map((x) => ({ front: x.q, back: x.a || 'Look it up in the quiz — ask Cassie to explain it.' })), 'My quiz mistakes', 'mistakes');
    if (ctx.track) ctx.track('feature', 'flashcards:mistakes');
    return n;
  }

  // how well they knew it → when it comes back
  function grade(card, how) {
    const box = card.box || 0;
    if (how === 'again') { card.box = 0; card.due = now() + 5 * MIN; card.lapses = (card.lapses || 0) + 1; }
    else if (how === 'hard') { card.due = now() + Math.max(10 * MIN, (GAPS[box] || 1) * DAY * 0.5); }
    else if (how === 'good') { card.box = Math.min(GAPS.length - 1, box + 1); card.due = now() + GAPS[card.box] * DAY; }
    else { card.box = Math.min(GAPS.length - 1, box + 2); card.due = now() + GAPS[card.box] * DAY * 1.3; }
    card.seen = now();
    ctx.save();
  }
  function nextLabel(card, how) {
    const box = card.box || 0;
    const d = how === 'again' ? 5 * MIN : how === 'hard' ? Math.max(10 * MIN, (GAPS[box] || 1) * DAY * 0.5)
      : how === 'good' ? GAPS[Math.min(GAPS.length - 1, box + 1)] * DAY : GAPS[Math.min(GAPS.length - 1, box + 2)] * DAY * 1.3;
    if (d < 60 * MIN) return Math.round(d / MIN) + ' min';
    if (d < DAY) return Math.round(d / (60 * MIN)) + ' h';
    return Math.round(d / DAY) + ' d';
  }

  /* ---------- export ---------- */
  function download(name, text, type) {
    const blob = new Blob([text], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  const fileBase = (deck) => (deck.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'cards').slice(0, 40);
  const tabSafe = (t) => String(t).replace(/[\t\r\n]+/g, ' ');
  function exportAnki(deck) {
    // Anki reads these header lines: tab-separated, the deck to put the cards in, and a tag
    const rows = all().filter((c) => c.deck === deck).map((c) => `${tabSafe(c.f)}\t${tabSafe(c.b)}`);
    download(`${fileBase(deck)}-anki.txt`, `#separator:tab\n#html:false\n#deck:${tabSafe(deck)}\n#tags:cassie\n${rows.join('\n')}\n`, 'text/plain');
    if (ctx.track) ctx.track('feature', 'flashcards:anki');
  }
  function quizletText(deck) { return all().filter((c) => c.deck === deck).map((c) => `${tabSafe(c.f)}\t${tabSafe(c.b)}`).join('\n'); }
  function exportCsv(deck) {
    const q = (t) => `"${String(t).replace(/"/g, '""')}"`;
    const rows = all().filter((c) => c.deck === deck).map((c) => `${q(c.f)},${q(c.b)}`);
    download(`${fileBase(deck)}.csv`, `﻿Front,Back\n${rows.join('\n')}\n`, 'text/csv');
  }

  /* ---------- the study screen ---------- */
  function build() {
    const el = document.createElement('div');
    el.className = 'fc';
    el.hidden = true;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Flashcards');
    el.innerHTML = '<div class="fc-panel"><div class="fc-head"><button type="button" class="fc-back" aria-label="Back to decks" hidden>‹</button><h2>Flashcards</h2><button type="button" class="fc-x" aria-label="Close">×</button></div><div class="fc-body"></div></div>';
    document.body.appendChild(el);
    el.querySelector('.fc-x').addEventListener('click', close);
    el.querySelector('.fc-back').addEventListener('click', () => { session = null; renderHome(); });
    el.addEventListener('click', (e) => { if (e.target === el) close(); });
    el.addEventListener('keydown', onKey);
    el.querySelector('.fc-body').addEventListener('click', onClick);
    return el;
  }
  const body = () => ui.querySelector('.fc-body');
  function renderHome(note) {
    ui.querySelector('.fc-back').hidden = true;
    const ds = decks(), mistakes = (ctx.state().mistakes || []).length;
    body().innerHTML = `
      ${note ? `<p class="fc-note">${esc(note)}</p>` : ''}
      ${ds.length ? `<ul class="fc-decks">${ds.map((d) => `
        <li><div class="fc-deck-name"><b>${esc(d.name)}</b><span>${d.total} card${d.total === 1 ? '' : 's'} · ${d.due ? `<em>${d.due} to review</em>` : 'all done for now'} · ${d.learned} learned</span></div>
          <div class="fc-deck-acts"><button type="button" class="fc-btn main" data-study="${esc(d.name)}"${d.due ? '' : ' data-all="1"'}>${d.due ? 'Study' : 'Practise'}</button>
          <details class="fc-more"><summary aria-label="More for ${esc(d.name)}">⋯</summary><div>
            <button type="button" data-anki="${esc(d.name)}">Export for Anki</button>
            <button type="button" data-quizlet="${esc(d.name)}">Copy for Quizlet</button>
            <button type="button" data-csv="${esc(d.name)}">Download CSV</button>
            <button type="button" data-del="${esc(d.name)}" class="danger">Delete deck</button>
          </div></details></div></li>`).join('')}</ul>`
        : '<p class="fc-empty">No flashcards yet. Tap <b>＋ Flashcards</b> under any of Cassie’s answers and she’ll make cards from it — or turn your quiz mistakes into cards below.</p>'}
      <div class="fc-tools">
        ${mistakes ? `<button type="button" class="fc-btn" data-mistakes="1">Turn my ${mistakes} quiz mistake${mistakes === 1 ? '' : 's'} into cards</button>` : ''}
        <details class="fc-new"><summary class="fc-btn">＋ Write a card</summary>
          <form class="fc-form"><input name="deck" placeholder="Deck (e.g. Biology)" maxlength="60" value="${esc((ds[0] && ds[0].name) || '')}">
          <input name="f" placeholder="Front — a question or term" maxlength="300" required><input name="b" placeholder="Back — the answer" maxlength="600" required>
          <button type="submit" class="fc-btn main">Add card</button></form></details>
      </div>
      <p class="fc-how">Cards you miss come back in minutes; ones you know come back after 1, 3, 7, 16 and 35 days — so you remember them for the exam, not just tonight.</p>`;
    const form = body().querySelector('.fc-form');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const n = add([{ front: fd.get('f'), back: fd.get('b') }], fd.get('deck') || 'My cards', 'hand');
      renderHome(n ? 'Card added.' : 'That card is already in the deck.');
    });
  }
  function onClick(e) {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.study != null) { startStudy(t.dataset.study, !!t.dataset.all); return; }
    if (t.dataset.anki) { exportAnki(t.dataset.anki); return; }
    if (t.dataset.csv) { exportCsv(t.dataset.csv); return; }
    if (t.dataset.quizlet) {
      const txt = quizletText(t.dataset.quizlet);
      const done = () => renderHome('Copied! In Quizlet: Create → Import → paste. (Between term and definition: Tab. Between cards: New line.)');
      try { navigator.clipboard.writeText(txt).then(done, done); } catch (err) { done(); }
      if (ctx.track) ctx.track('feature', 'flashcards:quizlet');
      return;
    }
    if (t.dataset.del) {
      if (!confirm(`Delete the deck “${t.dataset.del}” and all its cards?`)) return;
      const keep = all().filter((c) => c.deck !== t.dataset.del);
      ctx.state().cards = keep; changed(); return;
    }
    if (t.dataset.mistakes) { const n = fromMistakes(); renderHome(n ? `${n} card${n === 1 ? '' : 's'} added to “My quiz mistakes”.` : 'Those mistakes are already cards.'); return; }
    if (t.dataset.grade && session) { grade(session.card, t.dataset.grade); session.done++; nextCard(); return; }
    if (t.dataset.flip != null && session) { flip(); }
  }
  function onKey(e) {
    if (e.key === 'Escape') { close(); return; }
    if (!session) return;
    if ((e.key === ' ' || e.key === 'Enter') && !session.flipped) { e.preventDefault(); flip(); return; }
    const k = { 1: 'again', 2: 'hard', 3: 'good', 4: 'easy' }[e.key];
    if (k && session.flipped) { grade(session.card, k); session.done++; nextCard(); }
  }

  function startStudy(deck, practise) {
    // due cards first; "Practise" (nothing due) goes through the whole deck once
    let list = practise ? all().filter((c) => c.deck === deck) : dueOf(deck);
    list = list.slice().sort((a, b) => (a.due || 0) - (b.due || 0)).slice(0, 40);
    if (!list.length) { renderHome('Nothing to review in that deck right now.'); return; }
    session = { deck, list, i: 0, done: 0, flipped: false, card: null };
    ui.querySelector('.fc-back').hidden = false;
    if (ctx.track) ctx.track('feature', 'flashcards:study');
    nextCard(true);
  }
  function nextCard(first) {
    if (!first) session.i++;
    // a card marked Again comes back in this session, after a few others
    if (!first && session.card && session.card.due - now() < 15 * MIN && session.list.indexOf(session.card, session.i) < 0) {
      session.list.splice(Math.min(session.list.length, session.i + 3), 0, session.card);
    }
    if (session.i >= session.list.length) {
      const left = dueOf(session.deck).length;
      body().innerHTML = `<div class="fc-done"><div class="fc-big">🎉</div><h3>Done! ${session.done} card${session.done === 1 ? '' : 's'} reviewed.</h3>
        <p>${left ? `${left} more ${left === 1 ? 'is' : 'are'} due — keep going, or come back later.` : 'Nothing else is due in this deck. Cassie will bring the cards back right when you’re about to forget them.'}</p>
        <div class="fc-row"><button type="button" class="fc-btn" data-back-home="1">All decks</button>${left ? `<button type="button" class="fc-btn main" data-study="${esc(session.deck)}">Keep going</button>` : ''}</div></div>`;
      body().querySelector('[data-back-home]').addEventListener('click', () => { session = null; renderHome(); });
      session = { ...session, list: [], card: null };
      return;
    }
    session.card = session.list[session.i];
    session.flipped = false;
    const c = session.card, left = session.list.length - session.i;
    body().innerHTML = `<p class="fc-progress">${esc(session.deck)} · ${left} left</p>
      <button type="button" class="fc-card" data-flip="1" aria-label="Show the answer"><span class="fc-side">Question</span><span class="fc-text">${esc(c.f)}</span><span class="fc-tap">Tap to see the answer</span></button>
      <div class="fc-grades" hidden>
        ${[['again', 'Again'], ['hard', 'Hard'], ['good', 'Good'], ['easy', 'Easy']].map(([k, l], i) => `<button type="button" class="fc-grade ${k}" data-grade="${k}"><b>${l}</b><small>${nextLabel(c, k)}</small><kbd>${i + 1}</kbd></button>`).join('')}
      </div>`;
    body().querySelector('.fc-card').focus();
  }
  function flip() {
    if (!session || session.flipped || !session.card) return;
    session.flipped = true;
    const card = body().querySelector('.fc-card');
    card.classList.add('flipped');
    card.innerHTML = `<span class="fc-side">Question</span><span class="fc-q">${esc(session.card.f)}</span><span class="fc-side">Answer</span><span class="fc-text">${esc(session.card.b)}</span>`;
    body().querySelector('.fc-grades').hidden = false;
    const g = body().querySelector('[data-grade="good"]'); if (g) g.focus();
  }

  function open(deck) {
    if (!ui) ui = build();
    ui.hidden = false;
    document.documentElement.classList.add('fc-open');
    session = null;
    renderHome();
    if (deck && dueOf(deck).length) startStudy(deck);
    setTimeout(() => { try { ui.querySelector('.fc-x').focus(); } catch (e) { /* ignore */ } }, 30);
  }
  function close() {
    if (!ui) return;
    ui.hidden = true; session = null;
    document.documentElement.classList.remove('fc-open');
    if (ctx.onChange) ctx.onChange();
  }

  window.CassieCards = {
    init(c) { ctx = c; },
    open, close, add, fromText, fromMistakes,
    dueCount: () => (ctx ? dueOf().length : 0),
    count: () => (ctx ? all().length : 0),
    _grade: grade,
  };
})();

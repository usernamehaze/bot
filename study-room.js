/* Studying together in a room — beside the shared board, for classmates who are each at home.
   Group chat; "Ask Cassie for everyone" (one person asks, the whole room sees her answer);
   shared flashcards that everyone flips together and marks Got it / Not yet; a group quiz with
   a live score board; pinned notes; and a focus timer that runs for everyone at once.
   Everything travels as steps in the room (like the drawing), so someone who joins late sees
   what happened, and nothing is kept after the room ends (a day).
     window.CassieStudy.attach({ panel, me, name, send, ask, makeQuiz, decks, speak }) → { receive, members, toggle, destroy } */
(function () {
  'use strict';
  const KINDS = new Set(['msg', 'share', 'deck', 'card', 'grade', 'quiz', 'ans', 'note', 'unnote', 'timer']);
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const cut = (t, n) => String(t || '').replace(/\s+\n/g, '\n').trim().slice(0, n);
  const rid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const CSS = `
  .csk-panel { position: relative; }
  .sr { position: absolute; z-index: 30; top: 0; right: 0; bottom: 0; width: min(380px, 100%); display: flex; flex-direction: column; background: rgba(250,249,247,.94);
    -webkit-backdrop-filter: blur(24px) saturate(1.5); backdrop-filter: blur(24px) saturate(1.5); border-left: 1px solid rgba(18,17,23,.08); box-shadow: -12px 0 34px rgba(0,0,0,.14); color: #1b1b1d; font-size: 15px; }
  .sr[hidden] { display: none; }
  .csk-dark .sr { background: rgba(30,30,33,.94); color: #ededed; border-color: rgba(255,255,255,.08); }
  @media (max-width: 700px) { .sr { top: auto; height: min(72%, calc(100% - 240px)); width: 100%; border-left: 0; border-top: 1px solid rgba(18,17,23,.08); border-radius: 20px 20px 0 0; } }
  /* wide screens: the board makes room for the panel, so its own buttons (Send to Cassie, Close, the colours) stay reachable */
  @media (min-width: 701px) { .csk-panel:has(> .sr:not([hidden])) { padding-right: min(380px, 100%); } }
  .sr-head { display: flex; align-items: center; gap: 8px; padding: 12px 12px 8px 16px; }
  .sr-head h3 { margin: 0; font-size: 17px; flex: 1; }
  .sr-x, .sr-tm { min-height: 36px; border: 1px solid rgba(127,127,127,.3); background: transparent; color: inherit; border-radius: 999px; padding: 0 12px; font: 600 13px/1 inherit; cursor: pointer; }
  .sr-x { width: 36px; padding: 0; font-size: 18px; }
  .sr-tm.on { background: #1b1b1d; color: #fff; border-color: #1b1b1d; }
  .csk-dark .sr-tm.on { background: #fff; color: #111; }
  .sr-tabs { display: flex; gap: 4px; padding: 0 12px 8px; overflow-x: auto; }
  .sr-tabs button { flex: 1; min-height: 36px; border: 0; border-radius: 999px; background: rgba(127,127,127,.12); color: inherit; font: 600 13px/1 inherit; cursor: pointer; white-space: nowrap; padding: 0 10px; }
  .sr-tabs button[aria-selected="true"] { background: #1b1b1d; color: #fff; }
  .csk-dark .sr-tabs button[aria-selected="true"] { background: #fff; color: #111; }
  .sr-tabs b { font-weight: 700; margin-left: 4px; font-size: 11px; opacity: .8; }
  .sr-body { flex: 1; min-height: 0; overflow-y: auto; padding: 4px 14px 14px; }
  .sr-foot { padding: 10px 12px calc(10px + env(safe-area-inset-bottom, 0px)); border-top: 1px solid rgba(127,127,127,.18); display: flex; gap: 8px; }
  .sr-foot input, .sr-foot textarea { flex: 1; min-width: 0; min-height: 40px; border: 1px solid rgba(127,127,127,.3); border-radius: 12px; padding: 9px 12px; background: rgba(255,255,255,.7); color: inherit; font: inherit; resize: none; }
  .csk-dark .sr-foot input, .csk-dark .sr-foot textarea { background: rgba(0,0,0,.25); }
  .sr-btn { min-height: 40px; border: 0; border-radius: 12px; padding: 0 14px; background: #1b1b1d; color: #fff; font: 600 14px/1 inherit; cursor: pointer; white-space: nowrap; }
  .sr-btn.soft { background: rgba(127,127,127,.15); color: inherit; }
  .sr-btn:disabled { opacity: .5; cursor: default; }
  .csk-dark .sr-btn { background: #fff; color: #111; } .csk-dark .sr-btn.soft { background: rgba(255,255,255,.12); color: inherit; }
  .sr-msg { margin: 8px 0; line-height: 1.4; } .sr-msg b { font-weight: 700; margin-right: 6px; }
  .sr-msg.me { text-align: right; } .sr-msg.me span { background: #1b1b1d; color: #fff; }
  .sr-msg span { display: inline-block; max-width: 85%; padding: 8px 12px; border-radius: 16px; background: rgba(127,127,127,.13); text-align: left; white-space: pre-wrap; word-wrap: break-word; }
  .sr-share { margin: 10px 0; padding: 12px; border-radius: 16px; background: rgba(255,255,255,.75); border: 1px solid rgba(127,127,127,.2); }
  .csk-dark .sr-share { background: rgba(255,255,255,.06); }
  .sr-share small { display: block; opacity: .65; font-size: 12px; margin-bottom: 4px; }
  .sr-share p { margin: 6px 0 0; white-space: pre-wrap; line-height: 1.45; }
  .sr-mini { min-height: 30px; border: 1px solid rgba(127,127,127,.3); background: transparent; color: inherit; border-radius: 999px; padding: 0 10px; font: 600 12px/1 inherit; cursor: pointer; margin-top: 8px; }
  .sr-empty { opacity: .7; line-height: 1.45; margin: 14px 2px; }
  .sr-card { display: block; width: 100%; min-height: 150px; margin: 8px 0 10px; padding: 18px; border: 1px solid rgba(127,127,127,.25); border-radius: 18px; background: rgba(255,255,255,.85); color: inherit; font: inherit; text-align: center; cursor: pointer; }
  .csk-dark .sr-card { background: rgba(255,255,255,.07); }
  .sr-card small { display: block; opacity: .6; font-size: 12px; text-transform: uppercase; letter-spacing: .08em; margin-bottom: 8px; }
  .sr-card big { display: block; font-size: 19px; line-height: 1.35; }
  .sr-card .sr-ans { display: block; margin-top: 12px; padding-top: 12px; border-top: 1px dashed rgba(127,127,127,.4); font-size: 16px; }
  .sr-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; } .sr-row .sr-btn { flex: 1; }
  .sr-tally { margin: 8px 0; font-size: 13px; opacity: .8; }
  .sr-deck { display: flex; align-items: center; gap: 8px; padding: 10px 0; border-bottom: 1px solid rgba(127,127,127,.15); } .sr-deck span { flex: 1; } .sr-deck small { opacity: .6; }
  .sr-q { margin: 12px 0 16px; } .sr-q p { margin: 0 0 8px; font-weight: 600; line-height: 1.4; }
  .sr-q button.sr-opt { display: block; width: 100%; text-align: left; min-height: 42px; margin: 6px 0; padding: 8px 12px; border: 1px solid rgba(127,127,127,.3); border-radius: 12px; background: transparent; color: inherit; font: inherit; cursor: pointer; }
  .sr-q button.sr-opt.pick { border-color: currentColor; border-width: 2px; }
  .sr-q button.sr-opt.right { background: rgba(46,160,67,.16); border-color: rgba(46,160,67,.7); }
  .sr-q button.sr-opt.wrong { background: rgba(207,34,46,.12); border-color: rgba(207,34,46,.6); }
  .sr-q .sr-why { font-size: 13px; opacity: .8; margin-top: 4px; }
  .sr-board { padding: 10px 12px; border-radius: 14px; background: rgba(127,127,127,.1); margin: 6px 0 12px; font-size: 14px; }
  .sr-board div { display: flex; justify-content: space-between; padding: 2px 0; }
  .sr-note { position: relative; margin: 8px 0; padding: 12px 34px 12px 12px; border-radius: 14px; background: #fff6c9; color: #2a2414; line-height: 1.45; white-space: pre-wrap; }
  .sr-note small { display: block; opacity: .6; font-size: 12px; margin-top: 6px; }
  .sr-note button { position: absolute; top: 6px; right: 6px; width: 28px; height: 28px; border: 0; border-radius: 50%; background: rgba(0,0,0,.08); cursor: pointer; }
  .sr-warn { margin: 8px 14px 0; padding: 10px 12px; border-radius: 12px; background: rgba(207,34,46,.1); font-size: 13px; line-height: 1.4; }
  .sr-warn[hidden] { display: none; }
  
  /* touch screens: 44px to touch */
  @media (pointer: coarse) {
    .sr-x { width: 44px; } .sr-x, .sr-tm, .sr-tabs button, .sr-btn, .sr-mini, .sr-foot input, .sr-foot textarea { min-height: 44px; }
    .sr-tabs { padding-top: 2px; }
  }
  `;

  function attach(o) {
    if (!document.getElementById('sr-css')) { const st = document.createElement('style'); st.id = 'sr-css'; st.textContent = CSS; document.head.appendChild(st); }
    const S = { msgs: [], decks: new Map(), card: null, grades: new Map(), quizzes: [], answers: new Map(), notes: new Map(), timer: null, seen: new Set(), members: [], offset: 0 };
    let tab = 'chat', unread = 0, pending = new Map(), voice = null;
    const root = document.createElement('section');
    root.className = 'sr'; root.hidden = true; root.setAttribute('aria-label', 'Study together');
    root.innerHTML = `<div class="sr-head"><h3>Study together</h3><button type="button" class="sr-tm" data-act="timer" title="A focus timer for everyone in the room">⏱ Focus</button><button type="button" class="sr-x" data-act="close" aria-label="Close">×</button></div>
      <p class="sr-warn" hidden>Group study needs the newest Cassie server. Ask whoever runs Cassie to update it. Drawing together still works.</p>
      <div class="sr-tabs" role="tablist">${[['chat', 'Chat'], ['cards', 'Cards'], ['quiz', 'Quiz'], ['notes', 'Notes']].map(([k, l]) => `<button type="button" role="tab" data-tab="${k}" aria-selected="${k === tab}">${l}</button>`).join('')}</div>
      <div class="sr-body"></div><div class="sr-foot"></div>`;
    o.panel.appendChild(root);
    const $ = (s) => root.querySelector(s), body = $('.sr-body'), foot = $('.sr-foot');
    const nameOf = (uid, fallback) => (uid === o.me ? 'You' : (S.members.find((m) => m.uid === uid) || {}).name || fallback || 'Classmate');
    // what you do shows at once (not after the room's server sends it back); its echo is then skipped
    const send = (op) => { op.id = op.id || rid(); pending.set(op.id, Date.now()); o.send({ ...op, n: o.name }); receive([{ uid: o.me, ts: Date.now() + S.offset, op: { ...op, n: o.name } }], 0, true); };
    const watch = setInterval(() => { // our steps never came back: the server is too old for group study
      for (const [, at] of pending) if (Date.now() - at > 8000) { $('.sr-warn').hidden = false; break; }
    }, 3000);

    /* ---------- what arrives ---------- */
    function receive(list, serverNow, local) {
      if (serverNow) S.offset = serverNow - Date.now();
      let changed = false;
      for (const { uid, ts, op } of list) {
        if (!op || !KINDS.has(op.t)) continue;
        if (op.id) { if (!local) pending.delete(op.id); if (S.seen.has(op.id)) continue; S.seen.add(op.id); } // (still waiting for the server until it comes back)
        changed = true;
        const who = { uid, name: cut(op.n, 30) || 'Classmate', ts: ts || Date.now() };
        if (op.t === 'msg') { S.msgs.push({ ...who, text: cut(op.text, 500) }); if (uid !== o.me && (root.hidden || tab !== 'chat')) unread++; }
        else if (op.t === 'share') { S.msgs.push({ ...who, q: cut(op.q, 300), a: cut(op.a, 4000) }); if (uid !== o.me && (root.hidden || tab !== 'chat')) unread++; }
        else if (op.t === 'deck' && Array.isArray(op.cards)) { S.decks.set(op.id, { id: op.id, title: cut(op.title, 60), by: who.name, cards: op.cards.slice(0, 40).map((c) => ({ f: cut(c.f, 300), b: cut(c.b, 600) })).filter((c) => c.f && c.b) }); if (!S.card) S.card = { deck: op.id, i: 0, flip: false }; }
        else if (op.t === 'card' && S.decks.has(op.deck)) { const d = S.decks.get(op.deck); S.card = { deck: op.deck, i: Math.max(0, Math.min(d.cards.length - 1, op.i | 0)), flip: !!op.flip }; }
        else if (op.t === 'grade') { const k = `${op.deck}|${op.i | 0}`; const g = S.grades.get(k) || new Map(); g.set(uid, { ok: !!op.ok, name: who.name }); S.grades.set(k, g); }
        else if (op.t === 'quiz' && Array.isArray(op.qs)) { S.quizzes.push({ id: op.id, topic: cut(op.topic, 80), by: who.name, qs: op.qs.slice(0, 10).map((q) => ({ q: cut(q.q, 300), o: (q.o || []).slice(0, 5).map((x) => cut(x, 160)), a: q.a | 0, why: cut(q.why, 300) })) }); }
        else if (op.t === 'ans') { const k = `${op.quiz}|${op.i | 0}`; const a = S.answers.get(k) || new Map(); if (!a.has(uid)) a.set(uid, { pick: op.pick | 0, name: who.name }); S.answers.set(k, a); } // first answer counts
        else if (op.t === 'note') S.notes.set(op.id, { ...who, text: cut(op.text, 600) });
        else if (op.t === 'unnote') { const n = S.notes.get(op.of); if (n && n.uid === uid) S.notes.delete(op.of); } // only your own
        else if (op.t === 'timer') S.timer = op.mins ? { ends: who.ts + Math.min(90, Math.max(1, op.mins | 0)) * 60e3, mins: op.mins | 0, by: who.name } : null;
      }
      if (changed) render();
    }

    /* ---------- drawing the panel ---------- */
    function tabs() {
      root.querySelectorAll('.sr-tabs [data-tab]').forEach((b) => {
        b.setAttribute('aria-selected', String(b.dataset.tab === tab));
        const n = b.dataset.tab === 'chat' ? unread : 0;
        b.innerHTML = { chat: 'Chat', cards: 'Cards', quiz: 'Quiz', notes: 'Notes' }[b.dataset.tab] + (n ? `<b>${n}</b>` : '');
      });
      if (o.onUnread) o.onUnread(unread);
    }
    function render() {
      if (!root.hidden && tab === 'chat') unread = 0;
      tabs(); timerLabel();
      if (tab === 'chat') chat(); else if (tab === 'cards') cards(); else if (tab === 'quiz') quiz(); else notes();
    }
    function chat() {
      const atEnd = body.scrollHeight - body.scrollTop - body.clientHeight < 40;
      body.innerHTML = S.msgs.length ? S.msgs.map((m, i) => (m.a != null
        ? `<div class="sr-share"><small>${esc(nameOf(m.uid, m.name))} asked Cassie for everyone</small><b>${esc(m.q)}</b><p>${esc(m.a)}</p><button type="button" class="sr-mini" data-say="${i}">🔊 Listen</button></div>`
        : `<div class="sr-msg${m.uid === o.me ? ' me' : ''}">${m.uid === o.me ? '' : `<b>${esc(nameOf(m.uid, m.name))}</b>`}<span>${esc(m.text)}</span></div>`)).join('')
        : '<p class="sr-empty">Say hi to your study group! Ask Cassie something for everyone: her answer shows up for the whole room.</p>';
      if (atEnd || body.dataset.view !== 'chat') body.scrollTop = body.scrollHeight;
      body.dataset.view = 'chat';
      if (foot.dataset.view !== 'chat') {
        foot.dataset.view = 'chat';
        foot.innerHTML = '<input class="sr-in" maxlength="500" placeholder="Message the group…" enterkeyhint="send"><button type="button" class="sr-btn soft" data-act="ask" title="Cassie answers, and the whole room sees it">Ask Cassie</button><button type="button" class="sr-btn" data-act="send">Send</button>';
        foot.querySelector('.sr-in').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); act('send'); } });
      }
    }
    function cards() {
      body.dataset.view = 'cards'; foot.dataset.view = 'cards';
      const mine = (o.decks() || []).filter((d) => d.cards.length);
      const shared = [...S.decks.values()];
      const d = S.card && S.decks.get(S.card.deck);
      let html = '';
      if (d) {
        const c = d.cards[S.card.i], g = S.grades.get(`${d.id}|${S.card.i}`) || new Map();
        const myGrade = g.get(o.me);
        html += `<p class="sr-tally">${esc(d.title)} · card ${S.card.i + 1} of ${d.cards.length} · shared by ${esc(d.by)}</p>
          <button type="button" class="sr-card" data-act="flip"><small>${S.card.flip ? 'Answer' : 'Question: think, then tap'}</small><big>${esc(c.f)}</big>${S.card.flip ? `<span class="sr-ans">${esc(c.b)}</span>` : ''}</button>
          <div class="sr-row"><button type="button" class="sr-btn soft" data-act="prev" ${S.card.i ? '' : 'disabled'}>‹ Back</button><button type="button" class="sr-btn soft" data-act="say">🔊 Listen</button><button type="button" class="sr-btn" data-act="next" ${S.card.i < d.cards.length - 1 ? '' : 'disabled'}>Next ›</button></div>
          ${S.card.flip ? `<div class="sr-row" style="margin-top:8px"><button type="button" class="sr-btn soft" data-act="got" ${myGrade && myGrade.ok ? 'disabled' : ''}>✓ Got it</button><button type="button" class="sr-btn soft" data-act="miss" ${myGrade && !myGrade.ok ? 'disabled' : ''}>✗ Not yet</button></div>` : ''}
          ${g.size ? `<p class="sr-tally">${[...g.values()].map((x) => `${esc(x.name)} ${x.ok ? '✓' : '✗'}`).join(' · ')}</p>` : ''}`;
        if (shared.length > 1) html += `<p class="sr-tally">Other decks: ${shared.filter((x) => x.id !== d.id).map((x) => `<button type="button" class="sr-mini" data-deck="${esc(x.id)}">${esc(x.title)}</button>`).join(' ')}</p>`;
      } else html += '<p class="sr-empty">Share one of your flashcard decks and the whole room studies it together: everyone sees the same card, flips it at the same time, and marks if they got it.</p>';
      html += mine.length ? `<h4 style="margin:18px 0 4px">Share a deck</h4>${mine.map((m, i) => `<div class="sr-deck"><span>${esc(m.name)} <small>${m.cards.length} cards</small></span><button type="button" class="sr-mini" data-share-deck="${i}">Share</button></div>`).join('')}`
        : '<p class="sr-empty">You have no flashcards yet. Make some with ＋ Flashcards under any of Cassie’s answers.</p>';
      body.innerHTML = html; foot.innerHTML = ''; foot.hidden = true;
    }
    function quiz() {
      body.dataset.view = 'quiz';
      const q = S.quizzes[S.quizzes.length - 1];
      let html = '';
      if (q) {
        const score = new Map();
        q.qs.forEach((qq, i) => { const a = S.answers.get(`${q.id}|${i}`); if (a) for (const [uid, x] of a) { const s = score.get(uid) || { name: x.name, n: 0, done: 0 }; s.done++; if (x.pick === qq.a) s.n++; score.set(uid, s); } });
        html += `<p class="sr-tally">Quiz: <b>${esc(q.topic)}</b> · by ${esc(q.by)}</p>`;
        if (score.size) html += `<div class="sr-board">${[...score.entries()].sort((a, b) => b[1].n - a[1].n).map(([uid, s]) => `<div><span>${esc(nameOf(uid, s.name))}</span><b>${s.n} / ${q.qs.length}</b></div>`).join('')}</div>`;
        html += q.qs.map((qq, i) => {
          const a = S.answers.get(`${q.id}|${i}`), mine = a && a.get(o.me);
          return `<div class="sr-q"><p>${i + 1}. ${esc(qq.q)}</p>${qq.o.map((opt, k) => `<button type="button" class="sr-opt${mine ? (k === qq.a ? ' right' : mine.pick === k ? ' wrong' : '') : ''}${mine && mine.pick === k ? ' pick' : ''}" data-ans="${i}|${k}" ${mine ? 'disabled' : ''}>${'ABCDE'[k]}. ${esc(opt)}</button>`).join('')}${mine && qq.why ? `<p class="sr-why">${esc(qq.why)}</p>` : ''}</div>`;
        }).join('');
      } else html += '<p class="sr-empty">Make a quiz for the whole room: type a topic, Cassie writes 5 questions, and everyone answers on their own phone, with a live score board.</p>';
      body.innerHTML = html;
      foot.hidden = false;
      if (foot.dataset.view !== 'quiz') { foot.dataset.view = 'quiz'; foot.innerHTML = '<input class="sr-in" maxlength="80" placeholder="Quiz topic, e.g. cell organelles"><button type="button" class="sr-btn" data-act="quiz">Make a group quiz</button>'; }
    }
    function notes() {
      body.dataset.view = 'notes';
      const list = [...S.notes.entries()];
      body.innerHTML = list.length ? list.map(([id, n]) => `<div class="sr-note">${esc(n.text)}<small>${esc(nameOf(n.uid, n.name))}</small>${n.uid === o.me ? `<button type="button" data-unnote="${esc(id)}" aria-label="Remove this note">×</button>` : ''}</div>`).join('')
        : '<p class="sr-empty">Pin what the group finds while researching, a definition, a source, a formula, who does which part.</p>';
      foot.hidden = false;
      if (foot.dataset.view !== 'notes') { foot.dataset.view = 'notes'; foot.innerHTML = '<textarea class="sr-in" rows="2" maxlength="600" placeholder="A note for everyone…"></textarea><button type="button" class="sr-btn" data-act="note">Pin</button>'; if (window.CassieMic) window.CassieMic.attach(foot.querySelector('.sr-in')); }
    }
    // the focus timer, the same for everyone
    let tick = 0;
    function timerLabel() {
      const b = $('.sr-tm'); clearTimeout(tick);
      const left = S.timer ? S.timer.ends - (Date.now() + S.offset) : 0;
      if (left > 0) {
        const m = Math.floor(left / 60e3), s = Math.floor((left % 60e3) / 1000);
        b.textContent = `⏱ ${m}:${String(s).padStart(2, '0')}`; b.classList.add('on'); b.title = `Focus time for everyone (started by ${S.timer.by}). Tap to stop`;
        tick = setTimeout(timerLabel, 1000);
      } else {
        if (S.timer && left <= 0 && !S.timer.rang) { S.timer.rang = true; if (o.speak) o.speak('Time for a break! Great focus, everyone.'); }
        b.textContent = '⏱ Focus'; b.classList.remove('on'); b.title = 'Start a 25-minute focus timer for everyone';
      }
    }

    /* ---------- what you do ---------- */
    async function act(a, el) {
      const input = foot.querySelector('.sr-in');
      if (a === 'close') { root.hidden = true; return; }
      if (a === 'send') { const t = cut(input.value, 500); if (!t) { input.focus(); return; } input.value = ''; send({ t: 'msg', text: t }); return; }
      if (a === 'ask') {
        const q = cut(input.value, 300); if (!q) { input.placeholder = 'Type a question for Cassie first'; input.focus(); return; }
        input.value = ''; el.disabled = true; el.textContent = 'Cassie is thinking…';
        try { const ans = await o.ask(q); send({ t: 'share', q, a: cut(ans, 4000) }); }
        catch (e) { send({ t: 'msg', text: q }); }
        finally { el.disabled = false; el.textContent = 'Ask Cassie'; }
        return;
      }
      if (a === 'timer') { const running = S.timer && S.timer.ends > Date.now() + S.offset; send({ t: 'timer', mins: running ? 0 : 25 }); return; }
      if (a === 'flip' && S.card) { send({ t: 'card', deck: S.card.deck, i: S.card.i, flip: !S.card.flip }); return; }
      if ((a === 'next' || a === 'prev') && S.card) { send({ t: 'card', deck: S.card.deck, i: S.card.i + (a === 'next' ? 1 : -1), flip: false }); return; }
      if ((a === 'got' || a === 'miss') && S.card) { send({ t: 'grade', deck: S.card.deck, i: S.card.i, ok: a === 'got' }); return; }
      if (a === 'say' && S.card) { const c = S.decks.get(S.card.deck).cards[S.card.i]; say(S.card.flip ? `${c.f}. ${c.b}` : c.f); return; }
      if (a === 'quiz') {
        const topic = cut(input.value, 80); if (!topic) { input.focus(); return; }
        el.disabled = true; el.textContent = 'Cassie is writing it…';
        try { const qs = await o.makeQuiz(topic); if (qs && qs.length) { input.value = ''; send({ t: 'quiz', topic, qs }); } else el.textContent = 'Try another topic'; }
        catch (e) { el.textContent = 'Couldn’t make it. Try again'; }
        finally { setTimeout(() => { el.disabled = false; el.textContent = 'Make a group quiz'; }, 1200); }
        return;
      }
      if (a === 'note') { const t = cut(input.value, 600); if (!t) { input.focus(); return; } input.value = ''; send({ t: 'note', text: t }); }
    }
    function say(text) { if (voice) { voice.stop(); voice = null; } if (o.speak) voice = o.speak(text); }
    root.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.tab) { tab = b.dataset.tab; foot.hidden = false; render(); return; }
      if (b.dataset.act) { act(b.dataset.act, b); return; }
      if (b.dataset.say != null) { const m = S.msgs[+b.dataset.say]; if (m) say(`${m.q}. ${m.a}`); return; }
      if (b.dataset.shareDeck != null) { const d = o.decks()[+b.dataset.shareDeck]; if (d) send({ t: 'deck', title: d.name, cards: d.cards.slice(0, 40) }); return; }
      if (b.dataset.deck) { send({ t: 'card', deck: b.dataset.deck, i: 0, flip: false }); return; }
      if (b.dataset.ans) { const [i, k] = b.dataset.ans.split('|').map(Number); const q = S.quizzes[S.quizzes.length - 1]; if (q) send({ t: 'ans', quiz: q.id, i, pick: k }); return; }
      if (b.dataset.unnote) { send({ t: 'unnote', of: b.dataset.unnote }); }
    });
    render();
    return {
      receive,
      members(list) { S.members = list || []; },
      toggle(show) { root.hidden = show == null ? !root.hidden : !show; if (!root.hidden) { if (tab === 'chat') unread = 0; render(); } return !root.hidden; },
      unread: () => unread,
      share(q, a, extra) { send({ t: 'share', q: cut(q, 300), a: cut(a, 4000), ...(extra || {}) }); },
      destroy() { clearTimeout(tick); clearInterval(watch); if (voice) voice.stop(); root.remove(); },
    };
  }
  window.CassieStudy = { attach, kinds: KINDS };
})();

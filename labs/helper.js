/* Ask Cassie and Quiz me inside a lab or the 3D explorer: a small panel over the lab, which stays
   open and keeps working behind it. Cassie sees what is on the screen each time you ask, every
   answer can be read out loud, and a quiz runs here one question at a time with the score at the end.
   helper({ view, name, described, ask, format, speak, quiz, onMark })
     ask(msgs) → Promise<text> (the app's own path to Cassie); quiz(topic) → Promise<[{ q, o, a, why }]>
   → { ask(prompt, shown), quiz(topic), close(), destroy(), root, get open() } */
import { el, esc, errorWords, errorWordsFor } from './kit.js';

const HISTORY = 8; // the last few questions and answers go with each new question

export function helper({ view, name, described, ask, format, speak, quiz, onMark, onClose }) {
  const box = el('div', 'lab-helper');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', 'Ask Cassie');
  box.hidden = true;
  box.innerHTML = `
    <div class="hp-head"><b class="hp-title">Ask Cassie</b><button type="button" class="tut-icon hp-x" aria-label="Close and go back to the lab">✕</button></div>
    <div class="hp-log" aria-live="polite"></div>
    <form class="hp-ask"><input type="text" placeholder="Ask about what you see" aria-label="Ask Cassie a question" enterkeyhint="send" autocomplete="off"><button type="submit" class="tut-btn tut-go">Ask</button></form>`;
  view.appendChild(box);
  const $ = (s) => box.querySelector(s);
  const log = $('.hp-log'), input = $('.hp-ask input'), title = $('.hp-title');
  const history = [];
  let talking = null, alive = true, busy = 0, quizRun = 0;

  function show(mode) {
    title.textContent = mode === 'quiz' ? 'Quiz me' : 'Ask Cassie';
    box.setAttribute('aria-label', title.textContent);
    box.hidden = false;
  }
  function close() {
    stopTalking();
    box.hidden = true;
    if (onClose) onClose();
  }
  function stopTalking() {
    if (talking) { try { talking.stop(); } catch (e) { /* ignore */ } talking = null; }
    log.querySelectorAll('.hp-listen[aria-pressed="true"]').forEach((b) => { b.setAttribute('aria-pressed', 'false'); b.textContent = 'Listen'; });
  }
  // a "Listen" button reads one piece out loud (tap again to stop)
  function listenButton(text) {
    if (!speak) return null;
    const b = el('button', 'tut-btn hp-listen', 'Listen');
    b.type = 'button'; b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => {
      const on = b.getAttribute('aria-pressed') === 'true';
      stopTalking();
      if (on) return;
      b.setAttribute('aria-pressed', 'true'); b.textContent = 'Stop';
      try { talking = speak(text); } catch (e) { talking = null; }
      const done = talking && talking.done ? talking.done : Promise.resolve();
      Promise.resolve(done).catch(() => {}).then(() => { if (b.getAttribute('aria-pressed') === 'true') { b.setAttribute('aria-pressed', 'false'); b.textContent = 'Listen'; } });
    });
    return b;
  }
  function bubble(cls, text, rich) {
    const b = el('div', 'hp-msg ' + cls);
    if (rich && format) format(b, text); else b.textContent = text;
    log.appendChild(b);
    log.scrollTop = log.scrollHeight;
    return b;
  }
  const waiting = (text) => bubble('hp-wait', text);
  // a plain reason when Cassie can't answer (and what to do), never a raw error
  function why(e) {
    return errorWordsFor(e, 'no_answer');
  }

  // a student at risk: care before anything else (care.js), and Cassie keeps listening here
  function careHere(lang, aiWords) {
    const C = window.CassieCare;
    const b = el('div', 'hp-msg hp-a hp-care');
    b.appendChild(C.card(lang, aiWords));
    log.appendChild(b);
    log.scrollTop = log.scrollHeight;
    history.push({ role: 'assistant', content: C.reply(lang, aiWords) });
    if (C.count) C.count();
  }

  // one question to Cassie: she sees the screen as it is right now, and the talk so far
  async function askOne(prompt, shown) {
    show('ask');
    stopTalking();
    bubble('hp-me', shown || prompt);
    const now = (() => { try { return described ? described() : ''; } catch (e) { return ''; } })();
    const content = `(I'm using ${name} in Cassie. What's on my screen right now: ${now || 'I have just opened it'}.)\n\n${prompt}`;
    const wait = waiting('Cassie is thinking…');
    const my = ++busy;
    try {
      const text = String(await ask([...history.slice(-HISTORY), { role: 'user', content }]) || '').trim();
      if (!alive) return;
      wait.remove();
      const care = window.CassieCare && window.CassieCare.fromAI(text);
      if (care) { history.push({ role: 'user', content }); careHere(window.CassieCare.langOf(prompt), care.aiWords); return; }
      history.push({ role: 'user', content }, { role: 'assistant', content: text });
      const a = bubble('hp-a', text || 'Cassie had nothing to say to that. Try asking another way.', true);
      const l = text && listenButton(text);
      if (l) a.appendChild(l);
    } catch (e) {
      if (!alive) return;
      wait.remove();
      bubble('hp-err', why(e));
    } finally { if (my === busy) busy = 0; }
  }
  $('.hp-ask').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) { input.focus(); return; }
    input.value = '';
    const hit = window.CassieCare && window.CassieCare.check(q);
    if (hit) { show('ask'); stopTalking(); bubble('hp-me', q); history.push({ role: 'user', content: q }); careHere(hit.lang); return; } // no AI is asked
    askOne(q);
  });
  $('.hp-x').addEventListener('click', close);
  box.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });

  // Quiz me: questions one at a time, the right answer and why after each, the score at the end
  async function runQuiz(topic) {
    show('quiz');
    stopTalking();
    const run = ++quizRun;
    log.querySelectorAll('.hp-quiz').forEach((q) => q.classList.add('hp-old'));
    const card = el('div', 'hp-msg hp-quiz');
    log.appendChild(card);
    card.innerHTML = '<p class="hp-wait">Cassie is writing your questions…</p>';
    let list = [];
    try { list = await quiz(topic); } catch (e) { list = null; card.innerHTML = `<p class="hp-err">${esc(why(e))}</p>`; }
    if (!alive || run !== quizRun) return;
    if (list && !list.length) card.innerHTML = `<p class="hp-err">${esc(errorWords('quiz_failed'))}</p>`;
    if (!list || !list.length) { again(card, topic); return; }
    let i = 0, right = 0;
    const ask1 = () => {
      const q = list[i];
      card.innerHTML = `<p class="hp-qn">Question ${i + 1} of ${list.length}</p><p class="hp-q">${esc(q.q)}</p><div class="hp-opts" role="group" aria-label="Answers"></div><p class="hp-why" hidden></p>`;
      const l = listenButton(`${q.q} ${q.o.map((o, k) => `${'ABCD'[k] || k + 1}: ${o}.`).join(' ')}`);
      if (l) card.querySelector('.hp-qn').appendChild(l);
      const opts = card.querySelector('.hp-opts');
      q.o.forEach((o, k) => {
        const b = el('button', 'hp-opt'); b.type = 'button';
        b.innerHTML = `<span class="hp-letter">${'ABCD'[k] || k + 1}</span><span>${esc(o)}</span>`;
        b.addEventListener('click', () => pick(k));
        opts.appendChild(b);
      });
      log.scrollTop = log.scrollHeight;
    };
    const pick = (k) => {
      const q = list[i], ok = k === q.a, btns = [...card.querySelectorAll('.hp-opt')];
      btns.forEach((b, n) => { b.disabled = true; if (n === q.a) b.classList.add('right'); else if (n === k) b.classList.add('wrong'); });
      if (ok) right += 1;
      if (onMark) { try { onMark(q.q, q.o[q.a], ok); } catch (e) { /* ignore */ } }
      const w = card.querySelector('.hp-why');
      w.hidden = false;
      w.innerHTML = `<b>${ok ? 'Right!' : `Not quite. The answer is ${esc(q.o[q.a])}.`}</b>${q.why ? ' ' + esc(q.why) : ''}`;
      const last = i === list.length - 1;
      const next = el('button', 'tut-btn tut-next hp-next', last ? 'See my score' : 'Next question');
      next.type = 'button';
      next.addEventListener('click', () => { i += 1; if (last) done(); else ask1(); });
      card.appendChild(next);
      next.focus({ preventScroll: true });
      log.scrollTop = log.scrollHeight;
    };
    const done = () => {
      const all = list.length;
      const say = right === all ? 'Perfect score. Great work!' : right >= all / 2 ? 'Nice work. Look again at the ones you missed.' : 'Good try. Play with the lab a bit more, then try again.';
      card.innerHTML = `<p class="hp-score">You got <b>${right} of ${all}</b> right.</p><p class="hp-say">${say}</p>`;
      again(card, topic);
    };
    ask1();
  }
  function again(card, topic) {
    const b = el('button', 'tut-btn hp-again', 'New quiz');
    b.type = 'button';
    b.addEventListener('click', () => runQuiz(topic));
    card.appendChild(b);
    log.scrollTop = log.scrollHeight;
  }

  return {
    root: box,
    get open() { return !box.hidden; },
    ask: (prompt, shown) => askOne(prompt, shown),
    quiz: (topic) => runQuiz(topic),
    show: () => show(title.textContent === 'Quiz me' ? 'quiz' : 'ask'),
    close,
    destroy() { alive = false; stopTalking(); box.remove(); },
  };
}

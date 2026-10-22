/* The Exam Rescue Plan (rescue.html): a student types the subject, the exam day and the topics, and gets a day by
   day plan at once, with how to study each day and an exam day checklist. It is made here, in the browser (no AI,
   nothing sent anywhere), so it costs nothing however many students use it. "Save it in Cassie" hands the plan to
   the app (the same exam plan the app makes: learn, quiz, flashcards, mistakes and focus tasks, at most 3 a day).
   let.html is the same plan for the LET (the board exam for teachers): the topics come filled in for the level. */
(function () {
  'use strict';
  const PH_MS = 8 * 3600e3; // (days are Philippine days, like the app's exam plans)
  const phDay = (ms = Date.now()) => new Date(ms + PH_MS).toISOString().slice(0, 10);
  const dayAdd = (day, n) => { const d = new Date(day + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const dayGap = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);
  const dayName = (day) => new Date(day + 'T12:00:00Z').toLocaleDateString('en-PH', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  const clean = (s, n) => String(s || '').replace(/[–—]/g, ', ').replace(/\s+/g, ' ').trim().slice(0, n);
  const MAX_A_DAY = 3;

  function topicsOf(text) {
    const seen = new Set();
    return String(text || '').split(/[\n,;]+/).map((t) => clean(t, 40)).filter((t) => t && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase())).slice(0, 20);
  }

  // the plan: learn each topic, flashcards on it the next day, a quiz on it the day after (spaced, so it sticks),
  // mistakes after the quizzes, and a light last day. Days with too much pass the rest on; flashcards go first if
  // there are too few days for everything.
  function makePlan({ name, date, topics, minutes = 60 }, today = phDay()) {
    const list = topicsOf(topics);
    const last = dayGap(today, date) >= 1 ? dayAdd(date, -1) : date; // (the day before the exam; the exam day if it's today)
    const n = dayGap(today, last) + 1;
    const slots = Array.from({ length: n }, () => []);
    const put = (i, t) => slots[Math.max(0, Math.min(n - 1, i))].push(t);
    if (n <= 2) { // (no time: what counts most, first)
      list.forEach((topic, i) => put(Math.floor((i * n) / Math.max(1, list.length)), { kind: 'quiz', topic }));
      put(n - 1, { kind: 'mistakes', topic: '' });
    } else {
      const lastStudy = n - 2, learnSpan = Math.max(1, Math.ceil(n * 0.6) - 1);
      list.forEach((topic, i) => {
        const d = Math.floor((i * learnSpan) / list.length);
        put(d, { kind: 'learn', topic });
        put(Math.min(d + 1, lastStudy), { kind: 'cards', topic });
        put(Math.min(d + 2, lastStudy), { kind: 'quiz', topic });
      });
      // a long review (weeks or months): every topic is quizzed again later, so it isn't forgotten by exam day
      const again = learnSpan + 3, room = lastStudy - again + 1;
      if (list.length && room >= Math.ceil(list.length / 2)) list.forEach((topic, i) => put(again + Math.floor((i * room) / list.length), { kind: 'quiz', topic }));
      slots.forEach((s, i) => { if (i > 0 && i <= lastStudy && slots[i - 1].some((t) => t.kind === 'quiz') && !s.some((t) => t.kind === 'mistakes')) s.push({ kind: 'mistakes', topic: '' }); });
      put(n - 1, { kind: 'mistakes', topic: '' });
      put(n - 1, { kind: 'focus', topic: list.length ? 'a last look at every topic' : '' });
    }
    // too much for the days there are: flashcards make way first
    let total = slots.reduce((a, s) => a + s.length, 0);
    for (let i = n - 1; i >= 0 && total > n * MAX_A_DAY; i--) {
      for (let k = slots[i].length - 1; k >= 0 && total > n * MAX_A_DAY; k--) if (slots[i][k].kind === 'cards') { slots[i].splice(k, 1); total--; }
    }
    const days = [];
    let spill = [];
    for (let i = 0; i < n; i++) {
      const tasks = [...spill, ...slots[i]].filter((t, k, all) => all.findIndex((x) => x.kind === t.kind && x.topic === t.topic) === k); // (never the same task twice in a day)
      spill = tasks.slice(MAX_A_DAY);
      if (tasks.length) days.push({ date: dayAdd(today, i), tasks: tasks.slice(0, MAX_A_DAY) });
    }
    const dropped = spill.filter((t) => t.kind !== 'mistakes' && t.kind !== 'focus').map((t) => t.topic);
    return { v: 1, name: clean(name, 60), date, topics: list.join(', '), from: today, minutes, days, dropped };
  }

  const LABEL = {
    learn: (t) => `Learn ${t}`,
    cards: (t) => `Flashcards: ${t}`,
    quiz: (t) => `Quiz yourself: ${t}`,
    mistakes: () => 'Fix your mistakes',
    focus: (t) => `Focus session${t ? `: ${t}` : ''}`,
  };
  const HOW = {
    learn: 'Read it once. Then close your notes and explain it out loud, like you are teaching a friend. Where you get stuck is what to read again.',
    cards: 'Make 10 cards: a question on the front, the answer on the back. Say the answer before you flip. Missed ones go back in the pile.',
    quiz: 'Answer 10 questions without your notes. Mark every one you got wrong or guessed.',
    mistakes: 'Redo every question you got wrong, without looking, until you get it right twice.',
    focus: '25 minutes, phone in another room, one thing only. Then a 5 minute break.',
  };

  // the LET's areas (the PRC's table of specifications): General Education and Professional Education for every
  // examinee, and the major for Secondary. Short names (no commas: a comma splits topics), each one session's topic.
  const LET_GENED = ['English and Purposive Communication', 'Filipino', 'Mathematics', 'Science and Technology in Society', 'Philippine History and Rizal', 'Ethics and Understanding the Self'];
  const LET_PROFED = ['Child and Adolescent Development', 'Principles and Strategies of Teaching', 'Assessment of Learning', 'Curriculum Development', 'Technology for Teaching and Learning', 'The Teaching Profession and Ethics', 'Social Dimensions of Education', 'Special and Inclusive Education'];
  function letTopics(level, major) {
    const m = clean(major, 30);
    const majors = level === 'secondary' ? (m ? [`${m}: the content`, `${m}: teaching it`, `${m}: practice questions`] : []) : [];
    return [...majors, ...LET_PROFED, ...LET_GENED];
  }
  const letName = (level, major) => (level === 'secondary' ? `LET Secondary${clean(major, 30) ? `: ${clean(major, 30)}` : ''}` : 'LET Elementary');

  const $ = (s) => document.querySelector(s);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  function render(plan, isLet = false) {
    const out = $('#rs-plan');
    out.innerHTML = '';
    const head = el('div', 'rs-plan-head');
    head.append(el('p', 'rs-kicker', isLet ? 'Your LET Rescue Plan' : 'Your Exam Rescue Plan'), el('h2', null, plan.name));
    const left = dayGap(plan.from, plan.date);
    const count = plan.days.reduce((a, d) => a + d.tasks.length, 0);
    head.append(el('p', 'rs-meta', `Exam on ${dayName(plan.date)} · ${left === 0 ? 'today' : left === 1 ? 'tomorrow' : `${left} days to go`} · ${count} study sessions`));
    out.append(head);
    if (plan.dropped.length) out.append(el('p', 'rs-warn', `There are not enough days for everything, so these get only a quick look on the last day: ${plan.dropped.join(', ')}.`));
    const ol = el('ol', 'rs-days');
    plan.days.forEach((d, i) => {
      const li = el('li', 'rs-day');
      const per = Math.max(10, Math.round(plan.minutes / d.tasks.length / 5) * 5);
      li.append(el('h3', null, `${i === 0 && d.date === plan.from ? 'Today' : dayName(d.date)}`));
      const ul = el('ul', 'rs-tasks');
      d.tasks.forEach((t) => {
        const row = el('li', 'rs-task');
        const box = el('span', 'rs-box'); box.setAttribute('aria-hidden', 'true');
        const txt = el('div');
        txt.append(el('b', null, LABEL[t.kind](t.topic)), el('span', 'rs-min', ` · about ${per} min`), el('p', null, HOW[t.kind]));
        row.append(box, txt); ul.append(row);
      });
      li.append(ul); ol.append(li);
    });
    out.append(ol);
    const check = el('section', 'rs-check');
    check.append(el('h3', null, 'The night before and exam day'));
    const cl = el('ul');
    (isLet
      ? ['Stop studying new things the night before. Only your flashcards and your mistakes.', 'Sleep at least 7 hours. A tired brain forgets what it knows.', 'Pack the night before: your Notice of Admission, a valid ID, and everything PRC lists on it.', 'Find your room assignment and testing center, and know how to get there.', 'Eat breakfast, and get there early.', 'In each test, answer the easy items first, then come back to the hard ones. Leave no item blank.']
      : ['Stop studying new things the night before. Only your flashcards and your mistakes.', 'Sleep at least 7 hours. A tired brain forgets what it knows.', 'Pack the night before: ID, pens, calculator, water.', 'Eat breakfast, and get there 15 minutes early.', 'In the exam, answer the easy questions first, then come back to the hard ones.'])
      .forEach((t) => cl.append(el('li', null, t)));
    check.append(cl);
    out.append(check);
    out.hidden = false;
    $('#rs-after').hidden = false;
    out.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  }

  function init() {
    const f = $('#rs-form');
    if (!f) return;
    const today = phDay();
    f.date.min = today;
    f.date.max = dayAdd(today, 365);
    let plan = null;
    const say = (m, field) => { const e = $('#rs-err'); e.textContent = m; e.hidden = !m; if (field) field.focus(); };
    const isLet = !!f.level;
    if (isLet) { // (the LET page: the topics follow the level and the major, until the student edits them)
      let edited = false;
      const fill = () => {
        const sec = f.level.value === 'secondary';
        $('#rs-major').hidden = !sec;
        if (!edited) f.topics.value = letTopics(f.level.value, f.major.value).join('\n');
      };
      f.topics.addEventListener('input', () => { edited = true; });
      f.level.addEventListener('change', fill);
      f.major.addEventListener('input', fill);
      fill();
    }
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = isLet ? letName(f.level.value, f.major.value) : clean(f.subject.value, 60), date = f.date.value, topics = topicsOf(f.topics.value);
      if (!name) return say('What is the exam? For example: Biology midterm.', f.subject);
      if (isLet && f.level.value === 'secondary' && !clean(f.major.value, 30)) return say('What is your major? For example: English.', f.major);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return say('When is the exam? Pick the day.', f.date);
      if (date < today) return say('That day has passed. Pick the day of your next exam.', f.date);
      if (date > dayAdd(today, 365)) return say('Pick a day within the next year.', f.date);
      if (!topics.length) return say('Add at least one topic, one per line. For example: Cells.', f.topics);
      say('');
      plan = makePlan({ name, date, topics: topics.join('\n'), minutes: +f.minutes.value || 60 }, today);
      render(plan, isLet);
    });
    $('#rs-print').addEventListener('click', () => window.print());
    $('#rs-save').addEventListener('click', () => {
      if (!plan) return;
      try { localStorage.setItem('cassie.rescue', JSON.stringify({ ...plan, at: Date.now() })); } catch (e) { /* storage off: the app still opens */ }
      location.href = 'app.html?from=rescue';
    });
  }

  window.CassieRescue = { makePlan, topicsOf, letTopics, letName };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();

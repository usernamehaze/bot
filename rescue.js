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
    return String(text || '').split(/[\n,;]+/).map((t) => clean(t, 50)).filter((t) => t && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase())).slice(0, 40); // (the LET with a major has about 32)
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

  // the LET's areas (the PRC's Enhanced Table of Specifications, used since March 2023): General Education and
  // Professional Education for every examinee, and the major's own areas for Secondary. Short names (no commas: a
  // comma splits topics), each one session's topic; a major Cassie doesn't know gets the content, teaching it and practice.
  // Professional Education first: the anchor (60% of Elementary, 40% of Secondary)
  const LET_PROFED = ['Code of Ethics for Professional Teachers', 'The Constitution on education', 'Magna Carta for Teachers and Education Act 1982',
    'Philosophical and sociological foundations', 'Learning theories and motivation', 'Stages of development and learner diversity',
    'Principles and strategies of teaching', 'Lesson planning and curriculum design', 'Educational technology in the classroom',
    'Test construction and item analysis', 'Formative summative and portfolio assessment', 'Statistics in assessment',
    'Teaching reading', 'Field study and practice teaching'];
  const LET_GENED = ['English: study skills grammar and usage', 'English: reading comprehension and writing', 'English: speech and oral communication',
    'English: Philippine and world literature', 'Filipino: Komunikasyon at Pagbasa at Pagsulat', 'Filipino: Masining na Pagpapahayag',
    'Filipino: Wika at Panitikan', 'Math: operations algebra and geometry', 'Math: statistics probability and problem solving',
    'Science: biology and living systems', 'Science: earth science chemistry and physics', 'Philippine history Rizal and other heroes',
    'Government and the Constitution with human rights', 'Economics taxation and agrarian reform', 'Society and culture with family planning',
    'Philosophy psychology arts and ICT'];
  const LET_MAJORS = [ // [what the student types, matched loosely, then that major's sessions]
    [/english/, ['English: linguistics and the structure of English', 'English: Philippine and Afro-Asian literature', 'English: world literature and mythology',
      'English: literary criticism and stylistics', 'English: teaching speaking listening and reading', 'English: teaching literature',
      'English: assessment and research', 'English: campus journalism and creative writing', 'English: speech and stage arts']],
    [/filipino/, ['Filipino: Sining ng Pakikipagtalastasan', 'Filipino: Panitikang Pilipino', 'Filipino: Linggwistikang Filipino',
      'Filipino: Pagtuturo at Pagsasalin', 'Filipino: pagtataya at kagamitang pampagtuturo']],
    [/math/, ['Math: arithmetic number theory and business math', 'Math: algebra', 'Math: plane and solid geometry', 'Math: trigonometry',
      'Math: analytic geometry', 'Math: calculus', 'Math: probability and statistics', 'Math: modern geometry and abstract algebra',
      'Math: history of math and problem solving', 'Math: assessment in math']],
    [/bio/, ['Biology: cell biology', 'Biology: genetics and evolution', 'Biology: ecology', 'Biology: microbiology',
      'Biology: anatomy and physiology', 'Biology: inorganic and organic chemistry', 'Biology: biochemistry']],
    [/physical ed|\bp\.?e\b|mapeh|music|health/, ['MAPEH: foundations and methods', 'Music: Philippine and Asian music', 'Music: theory and conducting',
      'Arts education', 'PE: the bases of movement', 'PE: folk dance and other dance forms', 'PE: team individual and dual sports',
      'Health: personal community and environment', 'Health: safety and first aid', 'MAPEH: coaching and officiating']],
    [/physical|physics|chem/, ['Physical Science: the nature of science', 'Chemistry: atoms molecules and bonds', 'Chemistry: stoichiometry',
      'Chemistry: gases liquids solids and solutions', 'Chemistry: acids bases energy and rates', 'Chemistry: organic and nuclear',
      'Physics: mechanics and vectors', 'Physics: electricity magnetism and electronics', 'Physics: heat light and modern physics', 'Earth and space science']],
    [/social/, ['Social Studies: geography', 'Social Studies: sociology and anthropology', 'Social Studies: politics governance and law',
      'Social Studies: world history and civilization', 'Social Studies: Asian history and world affairs', 'Social Studies: economics',
      'Social Studies: teaching approaches and materials', 'Social Studies: assessment and research']],
    [/values/, ['Values Ed: philosophical and ethical foundations', 'Values Ed: theories of values development', 'Values Ed: personhood development',
      'Values Ed: family life and Filipino values', 'Values Ed: human rights citizenship and gender', 'Values Ed: peace and global education',
      'Values Ed: work ethics and community service', 'Values Ed: behavioral and transformative ed', 'Values Ed: research and assessment']],
    [/science/, ['Science: integrated science', 'Science: chemistry', 'Science: physics', 'Science: earth science', 'Science: biological sciences',
      'Science: teaching science']],
    [/\btle\b|technology and livelihood|livelihood/, ['TLE: drafting', 'TLE: business math and entrepreneurship', 'TLE: electricity and electronics',
      'TLE: plumbing carpentry and masonry', 'TLE: cosmetology', 'TLE: foods', 'TLE: teaching it']],
    [/agri|fish/, ['Agri-Fishery: breeds of farm animals and fish', 'Agri-Fishery: pests and diseases', 'Agri-Fishery: caring for farm and fishery products',
      'Agri-Fishery: marketing and entrepreneurship', 'Agri-Fishery: teaching it']],
  ];
  // the three parts on their own (the app's LET course asks which to focus on)
  function letParts(level, major) {
    const m = clean(major, 30), known = m && LET_MAJORS.find(([re]) => re.test(m.toLowerCase()));
    return { profed: [...LET_PROFED], gened: [...LET_GENED], major: level === 'secondary' ? (known ? [...known[1]] : m ? [`${m}: the content`, `${m}: teaching it`, `${m}: practice questions`] : []) : [] };
  }
  function letTopics(level, major) {
    const m = clean(major, 30), known = m && LET_MAJORS.find(([re]) => re.test(m.toLowerCase()));
    const majors = level === 'secondary' ? (known ? known[1] : m ? [`${m}: the content`, `${m}: teaching it`, `${m}: practice questions`] : []) : [];
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

  // Share my plan: a picture of the plan for a story or a group (1080 x 1350, the size feeds show whole), drawn
  // here on the device. The exam, the days to go, the first days, a dot for every day, and where to get one.
  const INK = { bg: '#111114', card: '#1d1d22', ink: '#f5f5f7', mute: '#a9a9b2', line: '#34343c', pop: '#ffd84d', popInk: '#111114' };
  const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
  const shortDay = (day) => new Date(day + 'T12:00:00Z').toLocaleDateString('en-PH', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  function fit(ctx, text, max) { // one line, with … when it is too long
    if (ctx.measureText(text).width <= max) return text;
    let t = text;
    while (t.length > 1 && ctx.measureText(t + '…').width > max) t = t.slice(0, -1);
    return t.trimEnd() + '…';
  }
  function wrap(ctx, text, max, lines) { // up to `lines` lines, the last one ending in … when it doesn't fit
    const words = text.split(' '), out = [];
    let line = '';
    for (const w of words) {
      const next = line ? line + ' ' + w : w;
      if (ctx.measureText(next).width <= max || !line) line = next; else { out.push(line); line = w; }
    }
    if (line) out.push(line);
    if (out.length > lines) { out.length = lines; out[lines - 1] = fit(ctx, out[lines - 1] + ' …', max); }
    return out;
  }
  function planPicture(plan, isLet) {
    const W = 1080, H = 1350, P = 84, c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.fillStyle = INK.bg; g.fillRect(0, 0, W, H);
    g.textBaseline = 'alphabetic';
    // the kicker and the exam
    g.fillStyle = INK.mute; g.font = `700 30px ${FONT}`;
    g.fillText(isLet ? 'MY LET REVIEW PLAN' : 'MY EXAM PLAN', P, 140);
    g.fillStyle = INK.ink; g.font = `800 76px ${FONT}`;
    const title = wrap(g, plan.name, W - P * 2, 2);
    title.forEach((t, i) => g.fillText(t, P, 236 + i * 86));
    let y = 236 + (title.length - 1) * 86 + 70;
    // the days to go, big
    const left = dayGap(plan.from, plan.date);
    const big = left === 0 ? 'Today' : left === 1 ? '1 day' : `${left} days`;
    g.font = `800 150px ${FONT}`; g.fillStyle = INK.pop;
    y += 130; g.fillText(big, P, y);
    const bw = g.measureText(big).width;
    g.font = `600 40px ${FONT}`; g.fillStyle = INK.ink;
    if (left > 0) g.fillText('to go', P + bw + 24, y);
    const sessions = plan.days.reduce((a, d) => a + d.tasks.length, 0);
    g.font = `500 34px ${FONT}`; g.fillStyle = INK.mute;
    y += 60; g.fillText(fit(g, `Exam on ${dayName(plan.date)} · ${sessions} study sessions`, W - P * 2), P, y);
    // a dot for every day (up to 70), the first ones filled: the road to exam day
    const total = Math.max(1, left), shown = Math.min(total, 70), per = 14, r = 13, gap = (W - P * 2 - r * 2) / (per - 1);
    y += 60;
    for (let i = 0; i < shown; i++) {
      const cx = P + r + (i % per) * gap, cy = y + r + Math.floor(i / per) * 40;
      g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2);
      if (i === shown - 1) { g.fillStyle = INK.pop; g.fill(); } else { g.strokeStyle = INK.line; g.lineWidth = 4; g.stroke(); }
    }
    y += Math.ceil(shown / per) * 40 + 30;
    // the first days, one line each
    const room = Math.max(1, Math.min(5, Math.floor((H - 250 - y) / 92)));
    g.fillStyle = INK.card;
    const boxH = room * 92 + 40;
    g.beginPath(); g.roundRect(P - 24, y, W - (P - 24) * 2, boxH, 28); g.fill();
    plan.days.slice(0, room).forEach((d, i) => {
      const ly = y + 24 + i * 92;
      g.font = `700 30px ${FONT}`; g.fillStyle = INK.mute;
      g.fillText(i === 0 && d.date === plan.from ? 'Today' : shortDay(d.date), P, ly + 36);
      g.font = `600 34px ${FONT}`; g.fillStyle = INK.ink;
      // whole tasks only, then how many more (never half a task)
      const names = d.tasks.map((t) => LABEL[t.kind](t.topic));
      let line = names[0], k = 1;
      for (; k < names.length; k++) {
        const rest = names.length - k - 1, next = line + ' · ' + names[k] + (rest ? ` · +${rest} more` : '');
        if (g.measureText(next).width > W - P * 2) break;
        line += ' · ' + names[k];
      }
      if (k < names.length) line = fit(g, line, W - P * 2 - g.measureText(` · +${names.length - k} more`).width) + ` · +${names.length - k} more`;
      g.fillText(fit(g, line, W - P * 2), P, ly + 78);
    });
    const more = plan.days.length - room;
    // where to get one: Cassie's mark, her name and the page
    const fy = H - 110;
    if (more > 0) { g.font = `600 30px ${FONT}`; g.fillStyle = INK.mute; g.fillText(`+ ${more} more ${more === 1 ? 'day' : 'days'} planned`, P, Math.min(y + boxH + 52, fy - 70)); }
    g.save(); g.translate(P, fy - 44); g.scale(56 / 420, 56 / 420); g.translate(-40, -40);
    g.fillStyle = INK.ink; g.strokeStyle = INK.ink; g.lineWidth = 56; g.lineJoin = 'round';
    const mark = new Path2D('M108 90 L395 259 L275 281 L342 399 L287 422 L225 300 L108 382 Z');
    g.stroke(mark); g.fill(mark);
    g.fillStyle = INK.bg; g.beginPath(); g.roundRect(168, 196, 22, 70, 11); g.roundRect(236, 214, 22, 70, 11); g.fill();
    g.restore();
    g.font = `800 38px ${FONT}`; g.fillStyle = INK.ink; g.fillText('Made free with Cassie', P + 80, fy - 4);
    g.font = `600 30px ${FONT}`; g.fillStyle = INK.pop; g.fillText(isLet ? 'askcassie.study/let' : 'askcassie.study/rescue', P + 80, fy + 40);
    return c;
  }
  async function sharePlan(plan, isLet, say) {
    const c = planPicture(plan, isLet);
    const blob = await new Promise((ok) => c.toBlob(ok, 'image/png'));
    if (!blob) { say('That picture could not be made here. Try Print or save as PDF instead.'); return; }
    const file = new File([blob], (isLet ? 'my-let-plan' : 'my-exam-plan') + '.png', { type: 'image/png' });
    const url = `https://askcassie.study/${isLet ? 'let' : 'rescue'}.html`;
    const text = `${isLet ? 'My LET review plan' : 'My exam plan'}, made free with Cassie. Get yours: ${url}`;
    // a phone: its own share sheet (Messenger, Facebook, Instagram…); a computer or a refusal: the picture is saved
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], text }); say('Shared. Good luck, you’ve got this!'); return; }
      catch (e) { if (e && e.name === 'AbortError') return; } // (closed the share sheet: nothing to say)
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = file.name;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    say('Saved to your downloads. Post it on your story or in your review group!');
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
    const shareMsg = (m) => { const e = $('#rs-share-msg'); e.textContent = m; };
    $('#rs-share').addEventListener('click', () => { if (!plan) return; shareMsg(''); sharePlan(plan, isLet, shareMsg).catch(() => shareMsg('That picture could not be made here. Try Print or save as PDF instead.')); });
    $('#rs-save').addEventListener('click', () => {
      if (!plan) return;
      try { localStorage.setItem('cassie.rescue', JSON.stringify({ ...plan, at: Date.now() })); } catch (e) { /* storage off: the app still opens */ }
      location.href = 'app.html?from=rescue';
    });
  }

  window.CassieRescue = { makePlan, topicsOf, letTopics, letParts, letName, planPicture };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();

/* Study tools for every subject: they work with any topic you bring (or Cassie makes one).
   Each one also works without Cassie — built-in sets, and simple rules where she'd help —
   and "Ask Cassie" in the top bar sends her what's on the screen.
     Vocabulary Flash-Chain · Timeline Builder · Argument & Essay Deconstructor ·
     Smart Flashcard Matrix · Cornell Notes · Citation & Thesis Mapper
   (The Museum of Famous Arts lives in museum.js.) */
import { el, esc, group, seg, button, row, stats, shuffle, fmtTime, plusOnly, errorWords, errorWordsFor } from './kit.js';

/* ---------- shared ---------- */
// the JSON inside one of Cassie's replies ([…] or {…})
export function jsonIn(reply, open = '[') {
  const s = String(reply || ''), close = open === '[' ? ']' : '}', a = s.indexOf(open), b = s.lastIndexOf(close);
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch (e) { return null; }
}
// "term – definition" lines (also tab, colon, " = ", " | ", or Q:/A: pairs)
export function pairsIn(text) {
  const out = [], lines = String(text || '').replace(/\r/g, '').split('\n').map((l) => l.trim()).filter((l) => l && !/^#/.test(l));
  for (let i = 0; i < lines.length && out.length < 60; i++) {
    const l = lines[i].replace(/^(?:[-*•]|\d+[.)])\s+/, '');
    const q = l.match(/^(?:Q|Front|Term)\s*[:.)]\s*(.+)$/i), a = lines[i + 1] && lines[i + 1].match(/^(?:A|Back|Definition)\s*[:.)]\s*(.+)$/i);
    if (q && a) { out.push([q[1], a[1]]); i++; continue; }
    const m = l.match(/^(.+?)(?:\t|\s+::\s+|\s+\|\s+|\s+[–—-]\s+|\s*[–—]\s*|\s+=\s+|:\s+)(.+)$/);
    if (m && m[1].trim() && m[2].trim()) out.push([m[1].trim().slice(0, 120), m[2].trim().slice(0, 400)]);
  }
  return out;
}
// a scrolling page inside the lab's stage (the tools are mostly words, not drawings)
function sheet(stage, cls = '') { const d = el('div', 'tl-sheet ' + cls); stage.appendChild(d); return d; }
const say = (box, text, kind = '') => { box.hidden = !text; box.className = 'tl-msg ' + kind; box.textContent = text || ''; };
const keyed = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
const keep = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } };
function download(name, text, type = 'text/plain') {
  const u = URL.createObjectURL(new Blob([text], { type })), a = el('a');
  a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 4000);
}
// Cassie is busy: a button says so while she works
async function busy(btn, text, fn) {
  const was = btn.textContent;
  btn.disabled = true; btn.textContent = text;
  try { return await fn(); } finally { btn.disabled = false; btn.textContent = was; }
}

/* Press a chip and drag it onto a target — or tap the chip, then tap the target (easier on
   a phone). Calls drop(chip, target) either way. */
function dragDrop(root, { chip, target, drop }) {
  let start = null, ghost = null, picked = null, over = null;
  const clear = () => { if (ghost) ghost.remove(); ghost = null; if (over) over.classList.remove('tl-over'); over = null; if (start) start.c.classList.remove('tl-dragging'); start = null; };
  const targetAt = (x, y) => { const t = document.elementFromPoint(x, y); return t && t.closest(target) && root.contains(t) ? t.closest(target) : null; };
  const pick = (c) => { if (picked) picked.classList.remove('tl-picked'); picked = c && c !== picked ? c : null; if (picked) picked.classList.add('tl-picked'); };
  const down = (e) => {
    const c = e.target.closest(chip);
    if (!c || !root.contains(c) || c.classList.contains('tl-locked') || e.button > 0) return;
    const b = e.target.closest('button'); if (b && b !== c) return; // its own little buttons (arrows) aren't a drag
    start = { c, x: e.clientX, y: e.clientY, moved: false };
  };
  const move = (e) => {
    if (!start) return;
    if (!start.moved) {
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < 7) return;
      start.moved = true;
      const r = start.c.getBoundingClientRect();
      ghost = start.c.cloneNode(true); ghost.classList.add('tl-ghost');
      Object.assign(ghost.style, { width: r.width + 'px', left: '0px', top: '0px' });
      document.body.appendChild(ghost);
      start.dx = e.clientX - r.left; start.dy = e.clientY - r.top;
      start.c.classList.add('tl-dragging'); pick(null);
    }
    e.preventDefault();
    ghost.style.transform = `translate(${e.clientX - start.dx}px, ${e.clientY - start.dy}px)`;
    const t = targetAt(e.clientX, e.clientY);
    if (t !== over) { if (over) over.classList.remove('tl-over'); over = t; if (over) over.classList.add('tl-over'); }
  };
  const up = (e) => {
    if (!start) return;
    const s = start;
    if (s.moved) { const t = targetAt(e.clientX, e.clientY); clear(); if (t) drop(s.c, t); return; }
    clear();
    // a tap: pick it up, then tap where it goes (which can be another chip, e.g. in a list)
    if (picked && picked !== s.c && s.c.matches(target)) { const c = picked; pick(null); drop(c, s.c); return; }
    pick(s.c);
  };
  const tap = (e) => {
    if (!picked) return;
    const t = e.target.closest(target);
    if (t && root.contains(t) && !t.closest(chip) && t !== picked) { const c = picked; pick(null); drop(c, t); }
  };
  root.addEventListener('pointerdown', down);
  window.addEventListener('pointermove', move, { passive: false });
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', clear);
  root.addEventListener('click', tap);
  return {
    clearPick: () => pick(null),
    destroy() { clear(); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', clear); },
  };
}
// A topic → Cassie writes the set; a box to paste your own; the built-in sets
function sourcePanel(panel, api, { title, sets, value, onSet, paste, pastePlaceholder, make, makeLabel = 'Make with Cassie', makePlaceholder = 'A topic, e.g. the water cycle' }) {
  const g = group(panel, title);
  const pick = el('select', 'tl-select');
  pick.setAttribute('aria-label', title);
  pick.innerHTML = Object.entries(sets).map(([k, s]) => `<option value="${esc(k)}">${esc(s.name)}</option>`).join('');
  pick.value = value;
  pick.addEventListener('change', () => onSet(pick.value));
  g.appendChild(pick);
  const err = el('p', 'tl-msg'); err.hidden = true;
  if (make) {
    const r = row(g, 'tl-make');
    const input = el('input', 'tl-input'); input.placeholder = makePlaceholder; input.setAttribute('aria-label', 'Topic'); input.maxLength = 120;
    r.appendChild(input);
    const b = button(r, makeLabel, async () => {
      const t = input.value.trim();
      if (!t) { input.focus(); return; }
      if (!api.canAsk()) { say(err, errorWords('lab_ai_off', { next: 'Paste your own below, or pick a ready-made set.' }), 'bad'); return; }
      say(err, '');
      try { await busy(b, 'Cassie is writing it…', () => make(t)); input.value = ''; }
      catch (e) { say(err, e.friendly ? e.message : errorWords('lab_ai_failed', { next: 'Try another topic, or try again in a moment.' }), 'bad'); }
    });
  }
  if (paste) {
    const d = el('details', 'tl-paste');
    d.innerHTML = `<summary>Paste your own</summary><textarea class="tl-area" rows="5" placeholder="${esc(pastePlaceholder)}"></textarea>`;
    g.appendChild(d);
    const r = row(d);
    button(r, 'Use these', () => { try { paste(d.querySelector('textarea').value); say(err, ''); d.open = false; } catch (e) { say(err, e.message, 'bad'); } });
  }
  g.appendChild(err);
  return { select: pick, error: (t) => say(err, t, 'bad'), addSet(k, s) { sets[k] = s; const o = el('option'); o.value = k; o.textContent = s.name; pick.appendChild(o); pick.value = k; } };
}

/* ================= 1. Vocabulary & Terminology Flash-Chain ================= */
const VOCAB = {
  literary: { name: 'Literary devices', pairs: [
    ['Metaphor', 'Says one thing IS another, without “like” or “as” (“Time is a thief”)'],
    ['Simile', 'Compares two things using “like” or “as” (“brave as a lion”)'],
    ['Personification', 'Gives human actions or feelings to something that isn’t human'],
    ['Hyperbole', 'Exaggerates on purpose for effect (“I’ve told you a million times”)'],
    ['Oxymoron', 'Two opposite words side by side (“deafening silence”)'],
    ['Alliteration', 'The same first sound repeated in nearby words (“Peter Piper picked”)'],
    ['Onomatopoeia', 'A word that sounds like what it means (“buzz”, “sizzle”)'],
    ['Irony', 'The opposite of what is said or expected'],
    ['Foreshadowing', 'Hints early in a story about what will happen later'],
    ['Allusion', 'A short reference to a well-known person, place, event or story'],
    ['Imagery', 'Description that appeals to the five senses'],
    ['Paradox', 'A statement that seems to contradict itself but holds a truth'],
  ] },
  tayutay: { name: 'Tayutay (Filipino figures of speech)', pairs: [
    ['Pagtutulad (Simile)', 'Naghahambing gamit ang “tulad ng”, “parang”, “kawangis ng”'],
    ['Pagwawangis (Metapora)', 'Tuwirang paghahambing, walang “tulad ng” o “parang”'],
    ['Pagbibigay-katauhan (Personipikasyon)', 'Binibigyan ng katangian ng tao ang bagay na walang buhay'],
    ['Pagmamalabis (Hayperbole)', 'Lubhang pinalalabis o pinakukulang ang isang bagay'],
    ['Pagtawag (Apostrope)', 'Pakikipag-usap sa bagay na walang buhay o sa taong wala'],
    ['Paghihimig (Onomatopeya)', 'Paggamit ng salitang kahawig ng tunog na inilalarawan'],
    ['Pag-uyam (Ironiya)', 'Pangungutya na tila pumupuri'],
    ['Pagtanggi (Litotes)', 'Gumagamit ng “hindi” upang magpahiwatig ng pagsang-ayon'],
  ] },
  medical: { name: 'Medical terms', pairs: [
    ['Tachycardia', 'A heart rate that is faster than normal'],
    ['Bradycardia', 'A heart rate that is slower than normal'],
    ['Hypertension', 'High blood pressure'],
    ['Hypoglycemia', 'Low blood sugar'],
    ['Anemia', 'Too few healthy red blood cells or too little hemoglobin'],
    ['Dyspnea', 'Difficulty breathing; shortness of breath'],
    ['Edema', 'Swelling caused by fluid trapped in the body’s tissues'],
    ['-itis', 'A word ending meaning inflammation (as in tonsillitis)'],
    ['-ectomy', 'A word ending meaning surgical removal (as in appendectomy)'],
    ['Hepat-', 'A word part meaning liver (as in hepatitis)'],
    ['Osteo-', 'A word part meaning bone (as in osteoporosis)'],
    ['Myocardial infarction', 'A heart attack: heart muscle damaged by a blocked blood supply'],
  ] },
  legal: { name: 'Legal terms', pairs: [
    ['Plaintiff', 'The person or group that brings a case to court'],
    ['Defendant', 'The person or group being sued or accused in court'],
    ['Affidavit', 'A written statement sworn to be true under oath'],
    ['Subpoena', 'A court order to appear in court or to hand over documents'],
    ['Verdict', 'The decision reached at the end of a trial'],
    ['Appeal', 'Asking a higher court to review a lower court’s decision'],
    ['Jurisdiction', 'The authority of a court to hear a case or rule over an area'],
    ['Precedent', 'An earlier court decision used as a guide for similar cases'],
    ['Habeas corpus', 'An order to bring a detained person to court to check the detention is lawful'],
    ['Tort', 'A wrongful act that causes harm and can lead to a civil lawsuit'],
    ['Due process', 'The right to fair procedures before the government takes life, liberty or property'],
    ['Bail', 'Money or property given so an accused person can be released before trial'],
  ] },
  tech: { name: 'Tech acronyms', pairs: [
    ['CPU', 'Central Processing Unit: the chip that carries out a program’s instructions'],
    ['RAM', 'Random Access Memory: fast, temporary working memory'],
    ['GPU', 'Graphics Processing Unit: a chip built for drawing images and parallel maths'],
    ['URL', 'Uniform Resource Locator: a web address'],
    ['HTML', 'HyperText Markup Language: the structure of a web page'],
    ['HTTP', 'HyperText Transfer Protocol: the rules browsers and servers use to talk'],
    ['DNS', 'Domain Name System: turns names like example.com into IP addresses'],
    ['API', 'Application Programming Interface: a way for programs to talk to each other'],
    ['SQL', 'Structured Query Language: used to ask questions of a database'],
    ['VPN', 'Virtual Private Network: an encrypted tunnel for your internet traffic'],
    ['IoT', 'Internet of Things: everyday devices connected to the internet'],
    ['OS', 'Operating System: the software that runs the computer (Windows, Android…)'],
  ] },
  biology: { name: 'Biology terms', pairs: [
    ['Osmosis', 'Water moving across a membrane toward the side with more dissolved stuff'],
    ['Diffusion', 'Particles spreading from where there are many to where there are few'],
    ['Photosynthesis', 'Plants using light, water and carbon dioxide to make glucose and oxygen'],
    ['Mitosis', 'Cell division that makes two identical cells'],
    ['Meiosis', 'Cell division that makes four sex cells with half the chromosomes'],
    ['Enzyme', 'A protein that speeds up a chemical reaction in the body'],
    ['Homeostasis', 'Keeping the inside of the body steady (temperature, sugar, water)'],
    ['ATP', 'The molecule cells use to carry energy'],
    ['Chromosome', 'A long coiled strand of DNA carrying many genes'],
    ['Gene', 'A section of DNA that codes for a trait'],
    ['Ecosystem', 'Living things and their surroundings, working together'],
    ['Cellular respiration', 'Cells breaking down glucose with oxygen to release energy'],
  ] },
};
const vocabLab = {
  id: 'vocab', name: 'Vocabulary Flash-Chain', subject: 'tools', wide: true,
  blurb: 'Match terms to their meanings by dragging, literary devices, Tayutay, medical, legal, tech or your own words. Keep the chain going!',
  words: 'vocabulary terms definitions matching drag drop literary devices medical legal acronyms tayutay glossary',
  icon: '<rect x="5" y="9" width="15" height="9" rx="2"/><rect x="28" y="9" width="15" height="9" rx="2"/><rect x="5" y="30" width="15" height="9" rx="2"/><rect x="28" y="30" width="15" height="9" rx="2"/><path d="M20 13.5h8M20 34.5c4 0 4-21 8-21"/>',
  about: 'Each round deals a few terms and their meanings. Drag a term (or tap it, then tap a meaning) onto the meaning it belongs to. Every right match in a row adds a link to your chain; a wrong one breaks it. Paste your own “term: meaning” lines, or give Cassie a topic and she writes a set.',
  mount({ stage, panel, api }) {
    const sets = Object.fromEntries(Object.entries(VOCAB).map(([k, v]) => [k, { ...v }]));
    let setKey = 'literary', round = [], matched = 0, mistakes = 0, chain = 0, bestChain = 0, t0 = 0, done = false, perRound = 6;
    const page = sheet(stage, 'tl-vocab');
    const dd = dragDrop(page, { chip: '.tl-term', target: '.tl-def', drop: (c, t) => match(c, t) });
    const src = sourcePanel(panel, api, {
      title: 'Word set', sets, value: setKey, onSet: (k) => { setKey = k; deal(); },
      paste: (text) => { const p = pairsIn(text); if (p.length < 3) throw new Error('Put at least 3 lines like “Osmosis: water moving across a membrane”.'); src.addSet('mine' + Date.now(), { name: 'My words (' + p.length + ')', pairs: p }); setKey = src.select.value; deal(); },
      pastePlaceholder: 'Term: meaning\nOsmosis: water moving across a membrane\n…',
      make: async (topic) => {
        const list = jsonIn(await api.ask(`Make 10 vocabulary items about "${topic}" for a student: key terms and short, clear definitions (at most 15 words each). Reply with ONLY a JSON array: [{"term": "…", "def": "…"}]`));
        const p = (list || []).filter((x) => x && x.term && x.def).map((x) => [String(x.term).slice(0, 80), String(x.def).slice(0, 200)]);
        if (p.length < 3) throw new Error(errorWords('lab_ai_failed', { next: 'Try another topic, or try again in a moment.' }));
        src.addSet('cassie' + Date.now(), { name: topic.slice(0, 40) + ' (by Cassie)', pairs: p }); setKey = src.select.value; deal();
      },
    });
    seg(group(panel, 'Words per round'), { options: [[4, '4'], [6, '6'], [8, '8']], value: perRound, onChange: (v) => { perRound = +v; deal(); } });
    const st = stats(panel);
    const r = row(panel);
    button(r, 'New round', () => deal(), 'main');
    button(r, 'Save as flashcards', () => { const s = sets[setKey]; const n = api.addCards(s.pairs.map(([f, b]) => ({ f, b })), s.name); note.textContent = n ? `Added ${n} cards to “${s.name}” in your Flashcards.` : 'Those cards are already in your Flashcards.'; note.hidden = false; });
    const note = el('p', 'lab-note'); note.hidden = true; panel.appendChild(note);
    function deal() {
      const s = sets[setKey];
      round = shuffle(s.pairs, Math.random).slice(0, Math.min(perRound, s.pairs.length)).map(([t, d], i) => ({ t, d, i }));
      matched = 0; mistakes = 0; chain = 0; t0 = performance.now(); done = false; dd.clearPick();
      const defs = shuffle(round, Math.random);
      page.innerHTML = `<div class="tl-chain" aria-live="polite"></div>
        <div class="tl-vgrid"><div class="tl-terms" role="list">${round.map((p) => `<button type="button" class="tl-term" data-i="${p.i}">${esc(p.t)}</button>`).join('')}</div>
        <div class="tl-defs">${defs.map((p) => `<div class="tl-def" data-i="${p.i}" role="button" tabindex="0"><span class="tl-slot"></span><p>${esc(p.d)}</p></div>`).join('')}</div></div>
        <p class="tl-hint">Drag a term onto its meaning, or tap a term, then tap the meaning.</p>`;
      show();
    }
    function show() {
      const ch = page.querySelector('.tl-chain');
      ch.innerHTML = `<span class="tl-links">${Array.from({ length: Math.min(chain, 12) }, () => '<i></i>').join('')}</span><b>Chain ${chain}</b>${bestChain ? `<small>best ${bestChain}</small>` : ''}`;
      st.set([['Matched', `${matched}/${round.length}`], ['Mistakes', String(mistakes)], ['Time', fmtTime((performance.now() - t0) / 1000)]]);
    }
    function match(c, t) {
      if (done || c.classList.contains('tl-locked') || t.classList.contains('tl-done')) return;
      if (c.dataset.i === t.dataset.i) {
        c.classList.add('tl-locked'); t.classList.add('tl-done');
        t.querySelector('.tl-slot').textContent = c.textContent;
        c.hidden = true;
        matched++; chain++; bestChain = Math.max(bestChain, chain);
        api.check(0);
        if (chain >= 5) api.check(1);
        if (matched === round.length) {
          done = true;
          const secs = (performance.now() - t0) / 1000;
          if (!mistakes) api.check(2);
          const b = api.best(bestChain, `chain of ${bestChain}`);
          page.querySelector('.tl-hint').textContent = `All matched in ${fmtTime(secs)} with ${mistakes} mistake${mistakes === 1 ? '' : 's'}.${b && b.isNew ? ' New best chain!' : ''} Tap “New round” for more.`;
          page.querySelector('.tl-hint').classList.add('tl-win');
        }
      } else {
        mistakes++; chain = 0;
        t.classList.remove('tl-shake'); void t.offsetWidth; t.classList.add('tl-shake');
      }
      show();
    }
    deal();
    const timer = setInterval(() => { if (!done) show(); }, 1000);
    return {
      state: () => `matching ${sets[setKey].name}: ${matched} of ${round.length} matched, ${mistakes} mistakes, chain ${chain}. Still to match: ${round.filter((p) => !page.querySelector(`.tl-def[data-i="${p.i}"].tl-done`)).map((p) => p.t).join(', ') || 'none'}`,
      destroy: () => { clearInterval(timer); dd.destroy(); },
    };
  },
  tries: ['Make your first match', 'Get a chain of 5 in a row', 'Finish a round with no mistakes'],
  hints: ['Drag a term onto the meaning that fits, or tap the term, then tap the meaning.', 'Start with the terms you are sure of, so the chain keeps growing.', 'Read every meaning first, then match the easiest ones.'],
};

/* ================= 2. Timeline / Chronology Builder ================= */
// each event: [when (to sort by), what shows as the date ('' for steps in a process), the event]
const TIMELINES = {
  ph: { name: 'Philippine history', items: [
    [1521, '1521', 'Magellan’s expedition reaches the Philippines; Lapulapu wins the Battle of Mactan'],
    [1565, '1565', 'Miguel López de Legazpi arrives in Cebu. Spanish colonisation begins'],
    [1571, '1571', 'Legazpi makes Manila the capital of the Spanish colony'],
    [1872, '1872', 'The priests Gomez, Burgos and Zamora (Gomburza) are executed'],
    [1892, '1892', 'Andrés Bonifacio founds the Katipunan'],
    [1896, '1896', 'José Rizal is executed in Bagumbayan (30 December)'],
    [1898, '1898', 'Philippine independence is declared in Kawit, Cavite (12 June)'],
    [1935, '1935', 'The Commonwealth begins, with Manuel L. Quezon as president'],
    [1946, '1946', 'The United States recognises Philippine independence (4 July)'],
    [1972, '1972', 'President Marcos declares martial law'],
    [1986, '1986', 'The EDSA People Power Revolution'],
  ] },
  rizal: { name: 'The life of José Rizal', items: [
    [1861, '1861', 'Born in Calamba, Laguna (19 June)'],
    [1882, '1882', 'Leaves for Spain to continue his studies'],
    [1887, '1887', 'Noli Me Tángere is published in Berlin'],
    [1891, '1891', 'El Filibusterismo is published in Ghent'],
    [1892, '1892', 'Founds La Liga Filipina, then is exiled to Dapitan'],
    [1896, '1896', 'Executed in Bagumbayan (now Luneta), Manila'],
  ] },
  ww2: { name: 'World War II', items: [
    [1939.67, 'Sep 1939', 'Germany invades Poland; the war in Europe begins'],
    [1941.93, 'Dec 1941', 'Japan attacks Pearl Harbor'],
    [1942.27, 'Apr 1942', 'Bataan falls; the Bataan Death March'],
    [1944.43, 'Jun 1944', 'D-Day: the Allies land in Normandy'],
    [1944.8, 'Oct 1944', 'MacArthur’s forces land on Leyte'],
    [1945.6, 'Aug 1945', 'Atomic bombs are dropped on Hiroshima and Nagasaki'],
    [1945.67, 'Sep 1945', 'Japan formally surrenders'],
  ] },
  space: { name: 'The space age', items: [
    [1957, '1957', 'Sputnik 1, the first artificial satellite, is launched'],
    [1961, '1961', 'Yuri Gagarin becomes the first person in space'],
    [1969, '1969', 'Apollo 11: the first people walk on the Moon'],
    [1971, '1971', 'Salyut 1, the first space station, is launched'],
    [1981, '1981', 'The first Space Shuttle flight (Columbia)'],
    [1990, '1990', 'The Hubble Space Telescope is launched'],
    [1998, '1998', 'The first piece of the International Space Station is launched'],
    [2021, '2021', 'The James Webb Space Telescope is launched'],
  ] },
  sdlc: { name: 'Software development life cycle', items: [
    [1, '', 'Planning: what problem, for whom, how much time and money'],
    [2, '', 'Requirements analysis: what the software must do'],
    [3, '', 'Design: the architecture, screens and data'],
    [4, '', 'Implementation: writing the code'],
    [5, '', 'Testing: finding and fixing bugs'],
    [6, '', 'Deployment: releasing it to users'],
    [7, '', 'Maintenance: updates and fixes after release'],
  ] },
  mitosis: { name: 'Mitosis, step by step', items: [
    [1, '', 'Interphase: the cell grows and copies its DNA'],
    [2, '', 'Prophase: chromosomes condense; the nuclear envelope breaks down'],
    [3, '', 'Metaphase: chromosomes line up in the middle'],
    [4, '', 'Anaphase: sister chromatids are pulled to opposite ends'],
    [5, '', 'Telophase: new nuclear envelopes form around each set'],
    [6, '', 'Cytokinesis: the cytoplasm splits into two cells'],
  ] },
  plot: { name: 'Plot structure', items: [
    [1, '', 'Exposition: meet the characters and the setting'],
    [2, '', 'Rising action: the conflict builds'],
    [3, '', 'Climax: the turning point, highest tension'],
    [4, '', 'Falling action: the results of the climax unfold'],
    [5, '', 'Resolution: the conflict ends; loose ends are tied'],
  ] },
  science: { name: 'The scientific method', items: [
    [1, '', 'Observe and ask a question'],
    [2, '', 'Do background research'],
    [3, '', 'Form a hypothesis'],
    [4, '', 'Test it with an experiment'],
    [5, '', 'Analyse the data'],
    [6, '', 'Draw a conclusion'],
    [7, '', 'Share the results'],
  ] },
};
const timelineLab = {
  id: 'timeline', name: 'Timeline Builder', subject: 'tools', wide: true,
  blurb: 'Drag events, dates or process steps into the right order, history, a story’s plot, the SDLC, mitosis, then check it or let Cassie grade it.',
  words: 'timeline chronology order sequence history dates events plot sdlc process steps mitosis rizal',
  icon: '<path d="M6 24h36"/><circle cx="12" cy="24" r="3"/><circle cx="24" cy="24" r="3"/><circle cx="36" cy="24" r="3"/><path d="M12 21v-9M24 27v9M36 21v-9"/><rect x="7" y="7" width="10" height="5" rx="1"/><rect x="19" y="36" width="10" height="5" rx="1"/><rect x="31" y="7" width="10" height="5" rx="1"/>',
  about: 'The events are dealt out in a random order. Drag one by its body (or tap it, then tap where it goes, or use the arrows) to put them in order, earliest first. “Check” marks each one right or wrong and tells you how many are in place. Ready-made sets have their dates; for your own steps, paste them in the right order and the tool shuffles them for you.',
  mount({ stage, panel, api }) {
    const sets = Object.fromEntries(Object.entries(TIMELINES).map(([k, v]) => [k, { ...v }]));
    let key = 'ph', order = [], checked = false, moves = 0;
    const page = sheet(stage, 'tl-time');
    const dd = dragDrop(page, { chip: '.tl-ev', target: '.tl-ev, .tl-end', drop: (c, t) => place(+c.dataset.k, t.classList.contains('tl-end') ? order.length : order.indexOf(+t.dataset.k)) });
    const src = sourcePanel(panel, api, {
      title: 'Timeline', sets, value: key, onSet: (k) => { key = k; deal(); },
      paste: (text) => {
        const lines = String(text).split('\n').map((l) => l.trim().replace(/^(?:[-*•]|\d+[.)])\s+/, '')).filter(Boolean).slice(0, 20);
        if (lines.length < 3) throw new Error('Put at least 3 events, one per line, in the right order.');
        // a year at the start ("1898 – …") is used to sort; otherwise the order you pasted is the answer
        const items = lines.map((l, i) => { const m = l.match(/^(-?\d{1,4})(?:\s*(BC|BCE|AD|CE))?\s*[–—:.-]\s*(.+)$/i); if (!m) return [i + 1, '', l.slice(0, 200)]; const y = +m[1] * (/B/i.test(m[2] || '') ? -1 : 1); return [y, m[1] + (m[2] ? ' ' + m[2] : ''), m[3].slice(0, 200)]; });
        if (items.some((x) => x[1]) && items.some((x) => !x[1])) throw new Error('Give every line a year, or none of them.');
        src.addSet('mine' + Date.now(), { name: 'My timeline (' + items.length + ')', items: items.map((x, i) => (x[1] ? x : [i + 1, '', x[2]])) }); key = src.select.value; deal();
      },
      pastePlaceholder: 'One per line, in the right order (or start each with a year):\n1898, Independence declared\n1946, Independence recognised\n…',
      make: async (topic) => {
        const list = jsonIn(await api.ask(`Make a timeline of 6 to 8 key events (or steps, if it's a process) for a student about "${topic}". In the correct order, earliest first. Use only events you are sure of. Reply with ONLY a JSON array: [{"when": "the year or date, or empty for steps", "sort": number to sort by (the year, or the step number), "event": "short description, at most 14 words"}]`));
        const items = (list || []).filter((x) => x && x.event).map((x, i) => [Number.isFinite(+x.sort) ? +x.sort : i + 1, String(x.when || '').slice(0, 20), String(x.event).slice(0, 200)]);
        if (items.length < 3) throw new Error(errorWords('lab_ai_failed', { next: 'Try another topic, or try again in a moment.' }));
        src.addSet('cassie' + Date.now(), { name: topic.slice(0, 40) + ' (by Cassie)', items }); key = src.select.value; deal();
      },
    });
    const st = stats(panel);
    const r = row(panel);
    button(r, 'Check my order', () => check(), 'main');
    button(r, 'Shuffle again', () => deal());
    const r2 = row(panel);
    const gradeBtn = button(r2, 'Cassie, grade my timeline', async () => {
      if (!api.canAsk()) { say(fb, errorWords('lab_ai_off', { next: 'Use “Check my order” instead.' }), 'bad'); return; }
      const s = sets[key], mine = order.map((k, i) => `${i + 1}. ${s.items[k][2]}`).join('\n'), right = sortedIdx().map((k, i) => `${i + 1}. ${s.items[k][1] ? s.items[k][1] + ' - ' : ''}${s.items[k][2]}`).join('\n');
      say(fb, 'Cassie is reading your timeline…', 'muted');
      try {
        const t = await busy(gradeBtn, 'Cassie is grading…', () => api.ask(`A student put these events about "${s.name}" in this order:\n${mine}\n\nThe correct order is:\n${right}\n\nGrade their timeline out of ${s.items.length} (one point for each event in its right place). Then, for each one out of place, explain in one short sentence why it comes where it does (a cause, a date, or what must happen first). Be kind and brief. Plain text, no markdown.`));
        say(fb, String(t || '').replace(/[*#`_]/g, '').trim(), '');
      } catch (e) { say(fb, errorWords('lab_ai_failed', { next: 'Use “Check my order” instead.' }), 'bad'); }
    });
    const fb = el('p', 'tl-msg'); fb.hidden = true; panel.appendChild(fb);
    const sortedIdx = () => sets[key].items.map((x, i) => i).sort((a, b) => sets[key].items[a][0] - sets[key].items[b][0]);
    function deal() {
      const n = sets[key].items.length;
      do order = shuffle([...Array(n).keys()], Math.random); while (n > 2 && order.every((k, i) => k === sortedIdx()[i]));
      checked = false; moves = 0; say(fb, ''); draw();
    }
    function place(k, to) {
      const from = order.indexOf(k);
      if (from < 0 || to < 0) return;
      order.splice(from, 1);
      order.splice(to > from ? to - 1 : to, 0, k);
      moves++; checked = false; api.check(0); draw();
    }
    function draw() {
      const s = sets[key], right = sortedIdx();
      page.innerHTML = `<p class="tl-hint">Earliest at the top. Drag an event to where it belongs, or tap it, then tap the event it should go before.</p>
        <ol class="tl-track">${order.map((k, i) => {
          const ok = checked ? right[i] === k : null;
          return `<li class="tl-ev${ok === true ? ' tl-ok' : ok === false ? ' tl-bad' : ''}" data-k="${k}" role="button" tabindex="0">
            <span class="tl-num">${i + 1}</span><span class="tl-evtext">${checked && s.items[k][1] ? `<b>${esc(s.items[k][1])}</b> ` : ''}${esc(s.items[k][2])}${ok === false ? `<small>belongs at #${right.indexOf(k) + 1}</small>` : ''}</span>
            <span class="tl-arrows"><button type="button" data-up="${i}" aria-label="Move up" ${i ? '' : 'disabled'}>▲</button><button type="button" data-down="${i}" aria-label="Move down" ${i < order.length - 1 ? '' : 'disabled'}>▼</button></span></li>`;
        }).join('')}<li class="tl-end">Drop here to put it last</li></ol>`;
      const inPlace = order.filter((k, i) => right[i] === k).length;
      st.set([['Events', String(order.length)], ['Moves', String(moves)], ['In place', checked ? `${inPlace}/${order.length}` : '-']]);
    }
    function check() {
      checked = true; draw();
      const right = sortedIdx(), inPlace = order.filter((k, i) => right[i] === k).length;
      api.check(1);
      if (inPlace === order.length) { api.check(2); say(fb, `All ${order.length} in the right order${moves ? ` in ${moves} moves` : ''}! ${sets[key].items.some((x) => x[1]) ? 'The dates are showing now.' : ''}`, 'good'); api.best(-moves, `${moves} moves`); }
      else say(fb, `${inPlace} of ${order.length} are in the right place. The red ones say where they belong, fix them and check again.`, '');
    }
    page.addEventListener('click', (e) => {
      const u = e.target.closest('[data-up]'), d = e.target.closest('[data-down]');
      if (u) { const i = +u.dataset.up; place(order[i], i - 1); e.stopPropagation(); }
      else if (d) { const i = +d.dataset.down; place(order[i], i + 2); e.stopPropagation(); }
    }, true);
    deal();
    return {
      state: () => { const s = sets[key]; return `ordering "${s.name}". My order now: ${order.map((k, i) => `${i + 1}. ${s.items[k][2]}`).join('; ')}${checked ? ` (checked: ${order.filter((k, i) => sortedIdx()[i] === k).length} of ${order.length} in place)` : ''}`; },
      destroy: () => dd.destroy(),
    };
  },
  tries: ['Move an event', 'Check your order', 'Get every event in the right place'],
  hints: ['Drag an event up or down, or use its ▲ ▼ arrows.', 'Tap “Check my order” to see which ones are in place.', 'Start with the one you are sure is first, then the one you are sure is last.'],
};

/* ================= 3. Argument & Essay Deconstructor ================= */
const ROLES = [
  ['claim', 'Claim', 'What the writer wants you to believe'],
  ['evidence', 'Evidence', 'Facts, numbers, examples, quotes or research'],
  ['reasoning', 'Reasoning', 'How the evidence supports the claim'],
  ['counter', 'Counter-argument', 'The other side, and the answer to it'],
  ['conclusion', 'Conclusion', 'What it all adds up to'],
];
const ROLE_OF = Object.fromEntries(ROLES.map((r) => [r[0], r]));
const SAMPLES = [
  ['School uniforms', 'Schools should keep requiring uniforms. A 2019 survey of 1,200 Filipino public-school teachers found that 68% saw fewer fights over clothes after uniforms were required. When every student dresses the same, nobody is judged for what their family can afford, so students can focus on learning. Some argue that uniforms limit self-expression. However, students can still express themselves through their ideas, clubs and art. Therefore, uniforms do more good than harm.'],
  ['Phones in class', 'Phones should be allowed in class for learning. According to a 2022 study by the University of the Philippines, students who used phones to look up words and examples during lessons scored 12% higher on quizzes. This shows that a phone can be a pocket library when teachers guide how it is used. Critics say phones distract students with games and social media. Yet clear rules, like phones face-down unless the teacher asks, solve most of that problem. In conclusion, banning phones throws away a powerful learning tool.'],
];
function sentencesOf(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return [];
  return t.split(/(?<=[.!?]["”’)]?)\s+(?=["“‘(]?[A-Z0-9])/).map((x) => x.trim()).filter(Boolean).slice(0, 60);
}
// without Cassie: guess each sentence's job from its words (a starting point, not the final word)
function guessRoles(sents) {
  return sents.map((s, i) => {
    const t = s.toLowerCase();
    if (/^(in conclusion|to conclude|therefore|thus|in summary|to sum up|overall|all in all|hence|clearly,)/.test(t) || (i === sents.length - 1 && sents.length > 2 && /\b(should|must|therefore|so)\b/.test(t))) return 'conclusion';
    if (/\b(some (people )?(argue|say|believe|claim)|critics|opponents|others (argue|say|believe)|on the other hand|although|admittedly|it is true that)\b/.test(t)) return 'counter';
    if (/^(however|yet|but|nevertheless|even so|still,)/.test(t) && i > 0) return 'counter';
    if (/\d|%|\b(according to|study|survey|research|data|statistic|report|found that|for example|for instance|such as|percent|experts?)\b|["“]/.test(t)) return 'evidence';
    if (i === 0 || (/\b(should|must|need to|ought to|is the best|is better|is wrong)\b/.test(t) && i < 2)) return 'claim';
    return 'reasoning';
  });
}
// how the parts fit: present, in a sensible order, and the counter-argument answered
function structureOf(roles) {
  const has = (r) => roles.includes(r), first = (r) => roles.indexOf(r), last = (r) => roles.lastIndexOf(r);
  const checks = [
    [has('claim'), 'There is a clear claim', 'Add one sentence that says what you want the reader to believe.'],
    [has('claim') && first('claim') <= 1, 'The claim comes early', 'Put your claim at or near the start so the reader knows your point.'],
    [has('evidence'), 'There is evidence', 'Back the claim with a fact, number, example or quote, and say where it comes from.'],
    [has('evidence') && has('reasoning'), 'The evidence is explained', 'After the evidence, add a sentence on HOW it proves your claim.'],
    [has('counter'), 'The other side is considered', 'Add a counter-argument (“Some argue…”). It makes you more convincing.'],
    [!has('counter') || roles.slice(first('counter') + 1).some((r) => r === 'counter' || r === 'reasoning' || r === 'evidence'), 'The counter-argument is answered', 'After the other side, answer it (“However, …”) so it doesn’t weaken you.'],
    [has('conclusion') && last('conclusion') >= roles.length - 2, 'It ends with a conclusion', 'Finish with what it all adds up to (“Therefore, …”).'],
  ];
  return { checks, score: Math.round((checks.filter((c) => c[0]).length / checks.length) * 100) };
}
const essayLab = {
  id: 'essay', name: 'Argument & Essay Deconstructor', subject: 'tools', wide: true,
  blurb: 'Paste a paragraph and see its Claim, Evidence, Reasoning, Counter-argument and Conclusion in colour. Then test how well the argument holds together.',
  words: 'essay argument paragraph claim evidence counterargument rebuttal conclusion structure writing persuasive cer',
  icon: '<path d="M10 8h28M10 16h20M10 24h28M10 32h16M10 40h24"/><path d="M8 6v12M8 22v12" stroke-width="3.5"/>',
  about: 'Every sentence of an argument has a job. This tool splits your paragraph into sentences and colours each one by its job. With Cassie, she reads the paragraph and explains each choice; without her, simple word clues make a first guess (like “according to” → evidence, “some argue” → counter-argument). You can tap any sentence to change its job. The structure check looks for the parts a strong argument needs, in a sensible order.',
  mount({ stage, panel, api }) {
    let sents = [], roles = [], why = [], mode = 'auto', mineRoles = null;
    const page = sheet(stage, 'tl-essay');
    const g = group(panel, 'Your paragraph');
    const area = el('textarea', 'tl-area'); area.rows = 7; area.placeholder = 'Paste a paragraph or a short essay here…'; area.setAttribute('aria-label', 'Paragraph to check');
    area.value = keyed('cassie.tools.essay') || SAMPLES[0][1];
    g.appendChild(area);
    const r = row(g);
    SAMPLES.forEach(([n, t]) => button(r, 'Sample: ' + n, () => { area.value = t; run(); }));
    seg(group(panel, 'Who tags the sentences?'), { options: [['auto', 'Highlight it for me'], ['me', 'I’ll tag them (practice)']], value: mode, onChange: (v) => { mode = v; run(); } });
    const r2 = row(panel);
    const go = button(r2, 'Deconstruct', () => run(), 'main');
    const cassieBtn = button(r2, 'Cassie, check the logic', () => cassie());
    const fb = el('p', 'tl-msg'); fb.hidden = true; panel.appendChild(fb);
    const st = stats(panel);
    function run() {
      keep('cassie.tools.essay', area.value.slice(0, 6000));
      sents = sentencesOf(area.value); why = [];
      roles = guessRoles(sents);
      mineRoles = mode === 'me' ? sents.map(() => null) : null;
      say(fb, sents.length ? (mode === 'me' ? 'Tap each sentence to choose its job, then tap “Cassie, check the logic” (or “Compare”) to see how you did.' : 'A first guess from word clues. Tap a sentence to change it, or ask Cassie to read it properly.') : '', '');
      draw();
      if (sents.length) api.check(0);
    }
    function draw() {
      const shown = mineRoles || roles;
      const { checks, score } = structureOf(shown.map((r2) => r2 || 'reasoning'));
      page.innerHTML = `<div class="tl-legend">${ROLES.map(([k, n, d]) => `<span class="tl-role tl-r-${k}" title="${esc(d)}">${n}</span>`).join('')}</div>
        ${sents.length ? `<p class="tl-para">${sents.map((s, i) => `<span class="tl-sent ${shown[i] ? 'tl-r-' + shown[i] : 'tl-r-none'}" data-i="${i}" role="button" tabindex="0" title="Tap to change its job">${esc(s)}<sup>${shown[i] ? esc(ROLE_OF[shown[i]][1]) : '?'}</sup></span>`).join(' ')}</p>` : '<p class="tl-hint">Paste a paragraph in the box and tap Deconstruct.</p>'}
        ${why.some(Boolean) ? `<ol class="tl-why">${sents.map((s, i) => why[i] ? `<li><b class="tl-r-${roles[i]}">${esc(ROLE_OF[roles[i]][1])}</b> ${esc(why[i])}</li>` : '').join('')}</ol>` : ''}
        ${sents.length && !mineRoles ? `<div class="tl-structure"><h4>Structure check · ${score}/100</h4><ul>${checks.map(([ok, good, fix]) => `<li class="${ok ? 'tl-ok' : 'tl-bad'}">${ok ? '✓ ' + esc(good) : '✗ ' + esc(fix)}</li>`).join('')}</ul></div>` : ''}`;
      const count = (k) => shown.filter((x) => x === k).length;
      st.set([['Sentences', String(sents.length)], ['Claims', String(count('claim'))], ['Evidence', String(count('evidence'))], ['Score', sents.length && !mineRoles ? score + '/100' : '-']]);
      if (sents.length && !mineRoles && score === 100) api.check(2);
    }
    page.addEventListener('click', (e) => {
      const s = e.target.closest('.tl-sent'); if (!s) return;
      const i = +s.dataset.i, arr = mineRoles || roles, k = ROLES.findIndex((x) => x[0] === arr[i]);
      arr[i] = ROLES[(k + 1) % ROLES.length][0];
      if (!mineRoles) why[i] = '';
      draw();
    });
    async function cassie() {
      if (!sents.length) run();
      if (!sents.length) return;
      if (!api.canAsk()) {
        if (mineRoles) { compare(roles, 'the word-clue guess'); return; }
        say(fb, errorWords('lab_ai_off', { next: 'The colours are a first guess from word clues.' }), 'bad'); return;
      }
      say(fb, 'Cassie is reading it…', 'muted');
      try {
        const out = await busy(cassieBtn, 'Cassie is reading…', () => api.ask(`Analyse the structure of this argument. Here are its sentences, numbered:\n${sents.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\nGive each sentence ONE job: "claim", "evidence", "reasoning", "counter" (a counter-argument or the rebuttal of it) or "conclusion". Then judge the logic: is the evidence relevant and enough, is the counter-argument answered, does the conclusion follow? Reply with ONLY JSON: {"roles": [{"n": 1, "role": "claim", "why": "at most 15 words"}], "feedback": "3 short sentences: what is strong, what is weak, one concrete fix"}`));
        const d = jsonIn(out, '{');
        if (!d || !Array.isArray(d.roles)) throw new Error('bad');
        const got = sents.map(() => null), gotWhy = sents.map(() => '');
        d.roles.forEach((x) => { const i = (x.n | 0) - 1; if (i >= 0 && i < sents.length && ROLE_OF[x.role]) { got[i] = x.role; gotWhy[i] = String(x.why || '').slice(0, 160); } });
        got.forEach((r3, i) => { roles[i] = r3 || roles[i]; why[i] = gotWhy[i]; });
        api.check(1);
        if (mineRoles) { compare(roles, 'Cassie'); return; }
        draw();
        say(fb, String(d.feedback || '').replace(/[*#`_]/g, '').slice(0, 800), '');
      } catch (e) { say(fb, errorWords('lab_ai_failed', { next: 'The colours are a first guess from word clues.' }), 'bad'); }
    }
    function compare(answer, who) {
      const same = mineRoles.filter((x, i) => x === answer[i]).length;
      mineRoles = null; draw();
      say(fb, `You agreed with ${who} on ${same} of ${sents.length} sentences. The colours now show ${who}’s tags${why.some(Boolean) ? ', with why under the paragraph' : ''}.`, same === sents.length ? 'good' : '');
    }
    run();
    return {
      state: () => `deconstructing this paragraph: ${sents.map((s, i) => `[${(mineRoles || roles)[i] || 'untagged'}] ${s}`).join(' ')}`,
      destroy() {},
    };
  },
  tries: ['Deconstruct a paragraph', 'Let Cassie check the logic', 'Get a paragraph to 100/100 on the structure check'],
  hints: ['Paste any paragraph (or tap a sample) and tap Deconstruct.', 'Tap “Cassie, check the logic”. She tags every sentence and says why.', 'Use the ✗ tips: add the missing part, then Deconstruct again.'],
};

/* ================= 5. Smart Flashcard Matrix ================= */
// without Cassie: "X is Y" sentences become "What is X?" cards, and a term list becomes cards
function cardsByRule(text, n) {
  const pairs = pairsIn(text).map(([f, b]) => ({ f, b }));
  if (pairs.length >= 3) return pairs.slice(0, n);
  const out = [];
  for (const s of sentencesOf(text)) {
    const m = s.match(/^(?:An?|The)?\s*([A-Z][\w\s()’'-]{1,48}?)\s+(is|are|was|were|means|refers to)\s+(.{8,240})$/);
    if (m) out.push({ f: `What ${/are|were/.test(m[2]) ? 'are' : 'is'} ${m[1].trim()}?`, b: m[3].replace(/\.$/, '') });
    if (out.length >= n) break;
  }
  return out;
}
const matrixLab = {
  id: 'cardmatrix', name: 'Smart Flashcard Matrix', subject: 'tools', wide: true,
  blurb: 'Turn notes, a pasted passage or a PDF into a flashcard deck in seconds, edit it in a grid, study it here, and keep it with spaced repetition.',
  words: 'flashcards cards deck spaced repetition notes pdf text generate study review memory anki quizlet',
  icon: '<rect x="5" y="7" width="16" height="12" rx="2"/><rect x="27" y="7" width="16" height="12" rx="2"/><rect x="5" y="29" width="16" height="12" rx="2"/><rect x="27" y="29" width="16" height="12" rx="2"/><path d="M33 33l3 3 5-6"/>',
  about: 'Give it text, type, paste, or open a PDF, Word or PowerPoint file, and Cassie picks out what is worth remembering and writes the cards. Without Cassie, sentences like “Osmosis is …” and term lists become cards. Check them in the grid (tap a card to flip it, ✎ to fix it, × to drop it), then study them here or save them to your Flashcards, where spaced repetition brings each card back just before you would forget it: soon after a miss, then 1, 3, 7, 16 and 35 days after you get it right.',
  mount({ stage, panel, api }) {
    let cards = keyed('cassie.tools.matrix') || [], deckName = 'Cards from my notes', study = null;
    const page = sheet(stage, 'tl-matrix');
    const g = group(panel, 'Your notes');
    const area = el('textarea', 'tl-area'); area.rows = 6; area.placeholder = 'Paste notes, a passage, or text you highlighted…'; area.setAttribute('aria-label', 'Notes to turn into cards');
    g.appendChild(area);
    if (api.readFile) {
      const f = el('label', 'lab-btn tl-file');
      f.innerHTML = 'Open a PDF, Word, PowerPoint or text file<input type="file" accept=".pdf,.docx,.pptx,.txt,.md" hidden>';
      g.appendChild(f);
      f.querySelector('input').addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0]; e.target.value = '';
        if (!file) return;
        say(fb, 'Reading ' + file.name + '…', 'muted');
        try { const t = await api.readFile(file); area.value = String(t || '').slice(0, 12000); deckName = file.name.replace(/\.\w+$/, '').slice(0, 50); say(fb, area.value ? `Read ${file.name}. Now tap “Make the cards”.` : 'That file has no text I can read (a scanned page?). Paste the text instead.', area.value ? '' : 'bad'); }
        catch (err) { say(fb, errorWords('file_unreadable'), 'bad'); }
      });
    }
    let howMany = 10, kind = 'qa';
    seg(group(panel, 'How many cards'), { options: [[6, '6'], [10, '10'], [15, '15'], [20, '20']], value: howMany, onChange: (v) => { howMany = +v; } });
    seg(group(panel, 'Card style'), { options: [['qa', 'Question → answer'], ['term', 'Term → meaning'], ['cloze', 'Fill the blank']], value: kind, onChange: (v) => { kind = v; } });
    const r = row(panel);
    const makeBtn = button(r, 'Make the cards', () => make(), 'main');
    const fb = el('p', 'tl-msg'); fb.hidden = true; panel.appendChild(fb);
    const g2 = group(panel, 'Keep them');
    const nameIn = el('input', 'tl-input'); nameIn.value = deckName; nameIn.setAttribute('aria-label', 'Deck name'); nameIn.maxLength = 60;
    g2.appendChild(nameIn);
    const r2 = row(g2);
    button(r2, 'Study here', () => startStudy());
    button(r2, 'Save to my Flashcards', () => {
      if (!cards.length) { say(fb, 'Make some cards first.', 'bad'); return; }
      const name = nameIn.value.trim() || deckName, n = api.addCards(cards, name);
      say(fb, n ? `Saved ${n} cards to “${name}”. They’ll come back for review with spaced repetition.` : `They’re already in “${name}”.`, 'good');
      api.check(2);
      if (api.openCards && n && !r2.querySelector('.tl-open')) button(r2, 'Open Flashcards', () => api.openCards(nameIn.value.trim() || deckName), 'tl-open');
    });
    const STYLE = { qa: 'a short question on the front and the answer (at most 25 words) on the back', term: 'a key term on the front and its meaning (at most 20 words) on the back', cloze: 'a sentence from the notes with one key word or number replaced by "____" on the front, and the missing word(s) on the back' };
    async function make() {
      const text = area.value.trim();
      if (text.length < 40) { say(fb, 'Paste a bit more text first (a paragraph or more).', 'bad'); return; }
      let list = null;
      if (api.canAsk()) {
        say(fb, 'Cassie is picking out what matters…', 'muted');
        try {
          list = jsonIn(await busy(makeBtn, 'Cassie is writing them…', () => api.ask(`Make ${howMany} flashcards from these notes, covering the most important facts, terms and ideas a student must remember (no trivia). Each card: ${STYLE[kind]}. Use only what the notes say. Plain text, no markdown. Reply with ONLY a JSON array: [{"f": "front", "b": "back"}]\n\nNOTES:\n${text.slice(0, 9000)}`)));
        } catch (e) { list = null; }
      }
      list = (list || []).filter((c) => c && c.f && c.b).map((c) => ({ f: String(c.f).slice(0, 300), b: String(c.b).slice(0, 600) }));
      if (!list.length) { list = cardsByRule(text, howMany); if (list.length) say(fb, 'Made these from the sentences’ wording (Cassie wasn’t available). Check them, then fix or drop any that read oddly.', ''); }
      else say(fb, `Cassie made ${list.length} cards. Tap one to flip it; ✎ fixes it, × drops it.`, 'good');
      if (!list.length) { say(fb, errorWords('cards_no_lines'), 'bad'); return; }
      cards = list; keep('cassie.tools.matrix', cards); study = null; draw(); api.check(0);
    }
    function draw() {
      if (study) { drawStudy(); return; }
      page.innerHTML = cards.length ? `<p class="tl-hint">${cards.length} cards · tap to flip</p><div class="tl-grid">${cards.map((c, i) => `<div class="tl-card" data-i="${i}" role="button" tabindex="0"><div class="tl-face"><small>${i + 1}</small><p>${esc(c.f)}</p></div><div class="tl-face tl-back"><small>answer</small><p>${esc(c.b)}</p></div>
        <span class="tl-cardacts"><button type="button" data-edit="${i}" aria-label="Edit card ${i + 1}">✎</button><button type="button" data-del="${i}" aria-label="Remove card ${i + 1}">×</button></span></div>`).join('')}</div>`
        : '<div class="tl-empty"><b>Your cards appear here.</b><p>Paste notes in the “Your notes” box (or open a file), then tap “Make the cards”.</p></div>';
    }
    // a quick study round: again → back into the pile; good → done for now
    function startStudy() {
      if (!cards.length) { say(fb, 'Make some cards first.', 'bad'); return; }
      study = { queue: shuffle(cards.map((c, i) => i), Math.random), flip: false, done: 0, again: 0 };
      draw(); api.check(1);
    }
    function drawStudy() {
      const s = study, i = s.queue[0];
      if (i == null) { page.innerHTML = `<div class="tl-empty"><b>Round done! 🎉</b><p>${s.done} cards, ${s.again} “again”. Save them to your Flashcards so spaced repetition brings them back at the right time.</p><p><button type="button" class="lab-btn" data-back>Back to the grid</button></p></div>`; return; }
      const c = cards[i];
      page.innerHTML = `<p class="tl-hint">${s.queue.length} left · ${s.done} done</p><div class="tl-study${s.flip ? ' tl-flipped' : ''}" role="button" tabindex="0" data-flip><small>${s.flip ? 'answer' : 'question'}</small><p>${esc(s.flip ? c.b : c.f)}</p>${s.flip ? '' : '<em>tap to see the answer</em>'}</div>
        ${s.flip ? '<div class="tl-grade"><button type="button" class="lab-btn" data-grade="again">Again</button><button type="button" class="lab-btn" data-grade="hard">Hard</button><button type="button" class="lab-btn main" data-grade="good">Good</button><button type="button" class="lab-btn" data-grade="easy">Easy</button></div>' : ''}
        <p><button type="button" class="lab-btn" data-back>Back to the grid</button></p>`;
    }
    page.addEventListener('click', (e) => {
      if (study) {
        if (e.target.closest('[data-back]')) { study = null; draw(); return; }
        if (e.target.closest('[data-flip]')) { study.flip = !study.flip; draw(); return; }
        const gr = e.target.closest('[data-grade]');
        if (gr) {
          const i = study.queue.shift(), how = gr.dataset.grade;
          if (how === 'again') { study.again++; study.queue.splice(Math.min(3, study.queue.length), 0, i); }
          else if (how === 'hard') study.queue.splice(Math.min(6, study.queue.length), 0, i);
          else study.done++;
          study.flip = false; draw();
        }
        return;
      }
      const del = e.target.closest('[data-del]');
      if (del) { cards.splice(+del.dataset.del, 1); keep('cassie.tools.matrix', cards); draw(); return; }
      const ed = e.target.closest('[data-edit]');
      if (ed) {
        const i = +ed.dataset.edit, c = cards[i], box = page.querySelector(`.tl-card[data-i="${i}"]`);
        box.classList.add('tl-editing');
        box.innerHTML = `<label>Front<textarea rows="2">${esc(c.f)}</textarea></label><label>Back<textarea rows="3">${esc(c.b)}</textarea></label><button type="button" class="lab-btn main" data-save="${i}">Save</button>`;
        box.querySelector('textarea').focus();
        return;
      }
      const sv = e.target.closest('[data-save]');
      if (sv) { const i = +sv.dataset.save, [f, b] = [...page.querySelectorAll(`.tl-card[data-i="${i}"] textarea`)].map((t) => t.value.trim()); if (f && b) { cards[i] = { f: f.slice(0, 300), b: b.slice(0, 600) }; keep('cassie.tools.matrix', cards); } draw(); return; }
      const card = e.target.closest('.tl-card');
      if (card && !card.classList.contains('tl-editing')) card.classList.toggle('tl-flip');
    });
    draw();
    return { state: () => (cards.length ? `${cards.length} cards made: ${cards.slice(0, 8).map((c) => `${c.f} → ${c.b}`).join(' | ')}` : 'no cards made yet'), destroy() {} };
  },
  tries: ['Make a deck from your notes', 'Study a round here', 'Save the deck to your Flashcards'],
  hints: ['Paste a paragraph (or open a PDF) and tap “Make the cards”.', 'Tap “Study here”, flip each card and say how well you knew it.', 'Tap “Save to my Flashcards”: spaced repetition then brings each card back on time.'],
};

/* ================= 6. Cornell Notes ================= */
function cornellByRule(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean);
  const rows = [];
  let cur = null;
  for (const l of lines) {
    const head = l.match(/^(?:#+\s*|\d+[.)]\s+)?(.{2,60}?):?$/);
    const isHead = (/^#/.test(l) || /:$/.test(l) || (l.length < 48 && !/[.!?]$/.test(l) && /^[A-Z0-9]/.test(l))) && head;
    if (isHead || !cur) { cur = { cue: isHead ? head[1].replace(/:$/, '') : '', notes: [] }; rows.push(cur); if (isHead) continue; }
    sentencesOf(l.replace(/^[-*•]\s*/, '')).forEach((s) => cur.notes.push(s));
  }
  rows.forEach((r) => {
    if (r.cue) { r.cue = /\?$/.test(r.cue) ? r.cue : `What about ${r.cue.replace(/^(the|a|an)\s+/i, '')}?`; return; }
    const m = (r.notes[0] || '').match(/^(?:An?|The)?\s*([A-Z][\w\s-]{1,40}?)\s+(is|are|means|was|were)\b/);
    r.cue = m ? `What ${m[2] === 'are' || m[2] === 'were' ? 'are' : 'is'} ${m[1]}?` : 'Key idea?';
  });
  const summary = rows.map((r) => r.notes[0]).filter(Boolean).slice(0, 3).join(' ');
  return { title: '', rows: rows.filter((r) => r.notes.length).slice(0, 12), summary };
}
const cornellLab = {
  id: 'cornell', name: 'Cornell Notes', subject: 'tools', wide: true,
  blurb: 'Paste messy lecture notes or slides and get a clean Cornell page: cue questions, notes, and a summary. Then cover the notes and test yourself.',
  words: 'cornell notes note-taking summary summarize cues lecture slides study method review',
  icon: '<rect x="7" y="5" width="34" height="38" rx="2"/><path d="M7 13h34M18 13v20M7 33h34M22 19h14M22 24h14M22 29h10M11 38h26"/>',
  about: 'The Cornell method splits a page into three parts: notes on the right (the facts, in short lines), cues on the left (questions or key words that the notes answer), and a summary at the bottom (the whole page in a few sentences, in your own words). To review, cover the notes and answer each cue out loud. Cassie turns raw notes into this layout; without her, headings become cues and the first lines make the summary. Everything on the page can be edited.',
  mount({ stage, panel, api }) {
    let doc = keyed('cassie.tools.cornell'), cover = false;
    const page = sheet(stage, 'tl-cornell');
    const g = group(panel, 'Raw notes or slides');
    const area = el('textarea', 'tl-area'); area.rows = 7; area.setAttribute('aria-label', 'Raw notes');
    area.placeholder = 'Paste lecture notes, slide text, or a chapter…';
    g.appendChild(area);
    if (api.readFile) {
      const f = el('label', 'lab-btn tl-file');
      f.innerHTML = 'Open a file (PDF, Word, PowerPoint)<input type="file" accept=".pdf,.docx,.pptx,.txt,.md" hidden>';
      g.appendChild(f);
      f.querySelector('input').addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0]; e.target.value = '';
        if (!file) return;
        say(fb, 'Reading ' + file.name + '…', 'muted');
        try { area.value = String(await api.readFile(file) || '').slice(0, 12000); say(fb, area.value ? 'Read it. Now tap “Make Cornell notes”.' : 'No text I can read in that file.', area.value ? '' : 'bad'); } catch (err) { say(fb, errorWords('file_unreadable'), 'bad'); }
      });
    }
    const r = row(panel);
    const go = button(r, 'Make Cornell notes', () => make(), 'main');
    const fb = el('p', 'tl-msg'); fb.hidden = true; panel.appendChild(fb);
    const g2 = group(panel, 'Review and keep');
    const r2 = row(g2);
    const coverBtn = button(r2, 'Cover the notes (test yourself)', () => { cover = !cover; coverBtn.textContent = cover ? 'Show the notes' : 'Cover the notes (test yourself)'; draw(); if (cover) api.check(1); });
    button(r2, 'Cues → flashcards', () => {
      if (!doc) return;
      const n = api.addCards(doc.rows.map((x) => ({ f: x.cue, b: x.notes.join(' ') })), (doc.title || 'Cornell notes').slice(0, 60));
      say(fb, n ? `Added ${n} cards (cue → notes) to your Flashcards.` : 'Those cards are already in your Flashcards.', 'good');
    });
    const r3 = row(g2);
    button(r3, 'Download (.txt)', plusOnly('Saving your Cornell notes', () => { if (doc) download(((doc.title || 'cornell-notes').replace(/[^\w-]+/g, '-').slice(0, 40) || 'cornell-notes') + '.txt', asText()); }));
    button(r3, 'Print', plusOnly('Printing your Cornell notes', () => printIt()));
    async function make() {
      const text = area.value.trim();
      if (text.length < 30) { say(fb, 'Paste some notes first.', 'bad'); return; }
      let d = null;
      if (api.canAsk()) {
        say(fb, 'Cassie is laying it out…', 'muted');
        try {
          d = jsonIn(await busy(go, 'Cassie is writing it…', () => api.ask(`Turn these raw study notes into Cornell notes. Group them into 4 to 8 sections. For each section write a CUE (a short question the notes answer, at most 10 words) and the NOTES (2 to 5 short bullet lines, the facts only, no full sentences needed). Then write a SUMMARY of the whole page in 2 to 3 plain sentences. Use only what the notes say. Reply with ONLY JSON: {"title": "short title", "rows": [{"cue": "…", "notes": ["…", "…"]}], "summary": "…"}\n\nNOTES:\n${text.slice(0, 9000)}`)), '{');
        } catch (e) { d = null; }
      }
      if (d && Array.isArray(d.rows) && d.rows.length) {
        d = { title: String(d.title || '').slice(0, 80), rows: d.rows.filter((x) => x && x.cue).slice(0, 12).map((x) => ({ cue: String(x.cue).slice(0, 160), notes: (Array.isArray(x.notes) ? x.notes : [x.notes]).filter(Boolean).map((n) => String(n).slice(0, 300)).slice(0, 8) })), summary: String(d.summary || '').slice(0, 900) };
        say(fb, 'Done! Tap any part of the page to edit it.', 'good');
      } else { d = cornellByRule(text); say(fb, 'Laid out from your headings and first lines (Cassie wasn’t available). Edit the cues and summary into your own words.', ''); }
      d.date = new Date().toLocaleDateString();
      doc = d; keep('cassie.tools.cornell', doc); cover = false; coverBtn.textContent = 'Cover the notes (test yourself)'; draw(); api.check(0);
    }
    function draw() {
      if (!doc) { page.innerHTML = '<div class="tl-empty"><b>Your Cornell page appears here.</b><p>Paste raw notes in the “Raw notes or slides” box and tap “Make Cornell notes”.</p></div>'; return; }
      page.innerHTML = `<article class="tl-cornell-page${cover ? ' tl-covered' : ''}">
        <header><h3 contenteditable="true" data-f="title">${esc(doc.title || 'My notes')}</h3><small>${esc(doc.date || '')}</small></header>
        <div class="tl-crows"><div class="tl-chead"><b>Cues</b><b>Notes</b></div>
        ${doc.rows.map((x, i) => `<div class="tl-crow"><div class="tl-cue" contenteditable="true" data-f="cue" data-i="${i}">${esc(x.cue)}</div><div class="tl-cnotes" data-i="${i}">${cover ? '<span class="tl-coverbar">Say the answer out loud, then tap to check</span>' : `<ul contenteditable="true" data-f="notes" data-i="${i}">${x.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>`}</div></div>`).join('')}</div>
        <footer><b>Summary</b><p contenteditable="true" data-f="summary">${esc(doc.summary || '')}</p></footer></article>`;
    }
    page.addEventListener('click', (e) => { const c = e.target.closest('.tl-coverbar'); if (c) { const row2 = c.closest('.tl-cnotes'); const i = +row2.dataset.i; row2.innerHTML = `<ul>${doc.rows[i].notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>`; } });
    page.addEventListener('input', (e) => {
      const t = e.target.closest('[data-f]'); if (!t || !doc) return;
      const f = t.dataset.f, i = +t.dataset.i;
      if (f === 'title') doc.title = t.textContent.trim();
      else if (f === 'summary') doc.summary = t.textContent.trim();
      else if (f === 'cue') doc.rows[i].cue = t.textContent.trim();
      else if (f === 'notes') doc.rows[i].notes = [...t.querySelectorAll('li')].map((li) => li.textContent.trim()).filter(Boolean);
      keep('cassie.tools.cornell', doc);
      if (f === 'summary') api.check(2);
    });
    const asText = () => `${doc.title || 'Notes'} (${doc.date || ''})\n\n${doc.rows.map((x) => `CUE: ${x.cue}\n${x.notes.map((n) => '  - ' + n).join('\n')}`).join('\n\n')}\n\nSUMMARY: ${doc.summary}\n`;
    function printIt() {
      if (!doc) return;
      const w = window.open('', '_blank');
      if (!w) { download('cornell-notes.txt', asText()); return; }
      w.document.write(`<!doctype html><meta charset="utf-8"><title>${esc(doc.title || 'Cornell notes')}</title><style>body{font:14px/1.45 system-ui,sans-serif;margin:28px;color:#111}h1{font-size:20px;margin:0 0 4px}table{width:100%;border-collapse:collapse;margin-top:12px}td{vertical-align:top;border-top:1px solid #999;padding:8px}td:first-child{width:30%;border-right:1px solid #999;font-weight:600}.s{border-top:2px solid #111;margin-top:14px;padding-top:8px}</style>
        <h1>${esc(doc.title || 'Notes')}</h1><small>${esc(doc.date || '')}</small><table>${doc.rows.map((x) => `<tr><td>${esc(x.cue)}</td><td><ul>${x.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></td></tr>`).join('')}</table><div class="s"><b>Summary</b><p>${esc(doc.summary || '')}</p></div>`);
      w.document.close(); w.focus(); setTimeout(() => { try { w.print(); } catch (e) { /* ignore */ } }, 200);
    }
    draw();
    return { state: () => (doc ? `Cornell notes "${doc.title}": ${doc.rows.map((x) => `${x.cue} - ${x.notes.join('; ')}`).join(' | ')}. Summary: ${doc.summary}` : 'no notes yet'), destroy() {} };
  },
  tries: ['Make a Cornell page from notes', 'Cover the notes and test yourself', 'Rewrite the summary in your own words'],
  hints: ['Paste notes (or open a file) and tap “Make Cornell notes”.', 'Tap “Cover the notes”, answer each cue out loud, then tap to check.', 'Tap the summary at the bottom and type it your own way.'],
};

/* ================= 7. Citation & Thesis Mapper ================= */
// authors as typed: "Santos, Maria; Cruz, Juan P." or "Maria Santos and Juan Cruz"
function authorsOf(text) {
  const raw = String(text || '').trim();
  if (!raw) return [];
  const parts = raw.includes(';') ? raw.split(';') : raw.split(/\s+and\s+|\s*&\s*|\n/);
  return parts.map((p) => p.trim()).filter(Boolean).map((p) => {
    if (p.includes(',')) { const [last, first] = p.split(',').map((x) => x.trim()); return { last, first: first || '' }; }
    const w = p.split(/\s+/); if (w.length === 1) return { last: w[0], first: '' };
    return { last: w.pop(), first: w.join(' ') };
  }).slice(0, 20);
}
const initials = (first) => first.split(/[\s-]+/).filter(Boolean).map((n) => n[0].toUpperCase() + '.').join(' ');
const it = (t) => `<i>${esc(t)}</i>`;
const end = (t) => (/[.?!]$/.test(t) ? t : t + '.');
function namesFor(style, A) {
  if (!A.length) return '';
  if (style === 'apa') {
    const one = (a) => `${a.last}${a.first ? ', ' + initials(a.first) : ''}`;
    if (A.length === 1) return one(A[0]);
    if (A.length <= 20) return A.slice(0, -1).map(one).join(', ') + ', & ' + one(A[A.length - 1]);
  }
  if (style === 'mla') {
    const first = `${A[0].last}${A[0].first ? ', ' + A[0].first : ''}`;
    return A.length === 1 ? first : A.length === 2 ? `${first}, and ${A[1].first} ${A[1].last}`.replace(/\s+/g, ' ') : `${first}, et al`;
  }
  if (style === 'chicago') {
    const first = `${A[0].last}${A[0].first ? ', ' + A[0].first : ''}`;
    if (A.length === 1) return first;
    const rest = A.slice(1).map((a) => `${a.first} ${a.last}`.trim());
    return A.length === 2 ? `${first}, and ${rest[0]}` : `${first}, ${rest.slice(0, -1).join(', ')}, and ${rest[rest.length - 1]}`;
  }
  // IEEE: J. Santos, M. Cruz, and A. Reyes
  const ie = A.map((a) => `${initials(a.first)} ${a.last}`.trim());
  return ie.length === 1 ? ie[0] : ie.length === 2 ? `${ie[0]} and ${ie[1]}` : `${ie.slice(0, -1).join(', ')}, and ${ie[ie.length - 1]}`;
}
// one source in the reference list (HTML, with titles in italics)
export function cite(style, s, n = 1) {
  const A = authorsOf(s.authors), who = namesFor(style, A), yr = String(s.year || '').trim() || 'n.d.', title = String(s.title || 'Untitled').trim();
  const box = String(s.container || '').trim(), pages = String(s.pages || '').trim(), url = String(s.url || '').trim(), vol = String(s.volume || '').trim(), iss = String(s.issue || '').trim();
  const t = s.type || 'book';
  if (style === 'apa') {
    const head = who ? `${esc(end(who))} (${esc(yr)}). ` : `${it(end(title))} (${esc(yr)}). `;
    const ttl = who ? (t === 'article' || t === 'web' ? esc(end(title)) + ' ' : it(end(title)) + ' ') : '';
    if (t === 'article') return `${head}${ttl}${box ? it(box) : ''}${vol ? ', ' + it(vol) : ''}${iss ? `(${esc(iss)})` : ''}${pages ? ', ' + esc(pages) : ''}.${url ? ' ' + esc(url) : ''}`;
    if (t === 'web') return `${head}${ttl}${box ? esc(end(box)) + ' ' : ''}${esc(url)}`.trim();
    return `${head}${ttl}${box ? esc(end(box)) : ''}${url ? ' ' + esc(url) : ''}`.trim();
  }
  if (style === 'mla') {
    const head = who ? esc(end(who)) + ' ' : '';
    if (t === 'article') return `${head}“${esc(end(title))}” ${box ? it(box) + ', ' : ''}${vol ? 'vol. ' + esc(vol) + ', ' : ''}${iss ? 'no. ' + esc(iss) + ', ' : ''}${esc(yr)}${pages ? ', pp. ' + esc(pages) : ''}.${url ? ' ' + esc(url.replace(/^https?:\/\//, '')) + '.' : ''}`;
    if (t === 'web') return `${head}“${esc(end(title))}” ${box ? it(box) + ', ' : ''}${esc(yr)}${url ? ', ' + esc(url.replace(/^https?:\/\//, '')) : ''}.`;
    return `${head}${it(end(title))} ${box ? esc(box) + ', ' : ''}${esc(yr)}.`;
  }
  if (style === 'chicago') { // author-date
    const head = who ? `${esc(end(who))} ${esc(yr)}. ` : '';
    if (t === 'article') return `${head}“${esc(end(title))}” ${box ? it(box) : ''}${vol ? ' ' + esc(vol) : ''}${iss ? ` (${esc(iss)})` : ''}${pages ? ': ' + esc(pages) : ''}.${url ? ' ' + esc(url) + '.' : ''}`;
    if (t === 'web') return `${head}“${esc(end(title))}” ${box ? esc(end(box)) + ' ' : ''}${url ? esc(url) + '.' : ''}`.trim();
    return `${head}${it(end(title))} ${box ? esc(end(box)) : ''}`.trim();
  }
  // IEEE
  const head = `[${n}] ${who ? esc(who) + ', ' : ''}`;
  if (t === 'article') return `${head}“${esc(title)},” ${box ? it(box) + ', ' : ''}${vol ? 'vol. ' + esc(vol) + ', ' : ''}${iss ? 'no. ' + esc(iss) + ', ' : ''}${pages ? 'pp. ' + esc(pages) + ', ' : ''}${esc(yr)}.`;
  if (t === 'web') return `${head}“${esc(title)},” ${box ? it(box) + '. ' : ''}[Online]. Available: ${esc(url)}`;
  return `${head}${it(title)}. ${box ? esc(box) + ', ' : ''}${esc(yr)}.`;
}
// the short reference inside your sentence: (Santos, 2021) · (Santos 45) · [1]
function inText(style, s, n) {
  const A = authorsOf(s.authors), yr = String(s.year || '').trim() || 'n.d.', name = A.length ? (A.length === 2 && style !== 'mla' ? `${A[0].last} ${style === 'apa' ? '&' : 'and'} ${A[1].last}` : A.length > 2 ? `${A[0].last} et al.` : A[0].last) : `“${String(s.title || '').split(' ').slice(0, 3).join(' ')}”`;
  if (style === 'ieee') return `[${n}]`;
  if (style === 'mla') return `(${name}${s.pages ? ' ' + String(s.pages).split(/[–-]/)[0] : ''})`;
  if (style === 'chicago') return `(${name} ${yr}${s.pages ? ', ' + s.pages : ''})`;
  return `(${name}, ${yr}${s.pages ? `, p. ${String(s.pages).split(/[–-]/)[0]}` : ''})`;
}
const BLANK_MAP = () => ({ thesis: '', counter: '', reasons: [{ text: '', ev: [] }, { text: '', ev: [] }] });
const SAMPLE_MAP = {
  thesis: 'Philippine high schools should start classes at 8:00 a.m. instead of 6:00 a.m. because teenagers sleep more and learn better with later start times.',
  counter: 'Some say later classes make traffic and family schedules harder. But staggered start times can spread out traffic, and students’ health should come first.',
  reasons: [
    { text: 'Teenagers’ body clocks make them fall asleep later.', ev: [{ quote: 'During puberty, the body’s release of melatonin shifts later, so teens naturally fall asleep around 11 p.m.', type: 'article', authors: 'Carskadon, Mary A.', year: '2011', title: 'Sleep in adolescents: The perfect storm', container: 'Pediatric Clinics of North America', volume: '58', issue: '3', pages: '637 to 647', url: '' }] },
    { text: 'More sleep means better grades and attention.', ev: [] },
  ],
};
const thesisLab = {
  id: 'thesis', name: 'Citation & Thesis Mapper', subject: 'tools', wide: true,
  blurb: 'Map your thesis, the reasons behind it and the evidence for each reason, with each source cited in APA, MLA, Chicago or IEEE, and test how strong the argument is before you write.',
  words: 'thesis statement citation apa mla chicago ieee bibliography references evidence argument map essay research paper sources',
  icon: '<rect x="15" y="4" width="18" height="9" rx="2"/><rect x="4" y="22" width="15" height="8" rx="2"/><rect x="29" y="22" width="15" height="8" rx="2"/><path d="M24 13v5M11.5 18h25M11.5 18v4M36.5 18v4M11.5 30v5M36.5 30v5"/><rect x="6" y="35" width="11" height="8" rx="1"/><rect x="31" y="35" width="11" height="8" rx="1"/>',
  about: 'A strong essay is a thesis held up by reasons, and every reason is held up by evidence from a real source. The map shows the gaps: a reason with no evidence is a weak leg. The strength check looks at simple, honest signs. Every reason has evidence, the sources are not all the same, they are recent, and the other side is answered. Citations follow APA 7th, MLA 9th, Chicago (author-date, 17th) and IEEE. Always check them against your teacher’s guide.',
  mount({ stage, panel, api }) {
    let map = keyed('cassie.tools.thesis') || JSON.parse(JSON.stringify(SAMPLE_MAP)), style = keyed('cassie.tools.citestyle') || 'apa', editing = null;
    const page = sheet(stage, 'tl-thesis');
    const save = () => keep('cassie.tools.thesis', map);
    seg(group(panel, 'Citation style'), { options: [['apa', 'APA'], ['mla', 'MLA'], ['chicago', 'Chicago'], ['ieee', 'IEEE']], value: style, onChange: (v) => { style = v; keep('cassie.tools.citestyle', v); draw(); } });
    const st = stats(panel);
    const r = row(panel);
    const testBtn = button(r, 'Cassie, stress-test my argument', () => test(), 'main');
    button(r, 'Copy reference list', plusOnly('Copying your reference list', () => copyRefs()));
    const r2 = row(panel);
    button(r2, 'Start a new map', () => { if (confirm('Start a new, empty map? This one will be cleared.')) { map = BLANK_MAP(); save(); draw(); } });
    button(r2, 'Load the example', () => { map = JSON.parse(JSON.stringify(SAMPLE_MAP)); save(); draw(); });
    const fb = el('p', 'tl-msg'); fb.hidden = true; panel.appendChild(fb);
    const sources = () => { const out = []; map.reasons.forEach((rs) => rs.ev.forEach((e) => out.push(e))); return out; };
    const numberOf = (e) => sources().indexOf(e) + 1;
    function strength() {
      const now = new Date().getFullYear(), ev = sources();
      const checks = [
        [map.thesis.split(/\s+/).filter(Boolean).length >= 12, 'The thesis is specific (12+ words, says what AND why)'],
        [/\bbecause|since|so that|due to|as\b/i.test(map.thesis), 'The thesis gives a reason (“because…”)'],
        [map.reasons.filter((x) => x.text.trim()).length >= 2, 'At least two reasons'],
        [map.reasons.filter((x) => x.text.trim()).every((x) => x.ev.length >= 1), 'Every reason has evidence'],
        [map.reasons.filter((x) => x.text.trim()).every((x) => x.ev.length >= 2), 'Every reason has two or more pieces of evidence'],
        [new Set(ev.map((e) => (authorsOf(e.authors)[0] || {}).last || e.title)).size >= Math.min(3, ev.length) && ev.length >= 2, 'Evidence comes from different sources'],
        [ev.length && ev.every((e) => !+e.year || now - +e.year <= 15), 'Sources are recent (last 15 years), or classics on purpose'],
        [ev.length && ev.every((e) => e.title && e.authors && e.year), 'Every source has an author, year and title'],
        [map.counter.trim().split(/\s+/).length >= 8, 'The other side is answered'],
      ];
      return { checks, score: Math.round((checks.filter((c) => c[0]).length / checks.length) * 100) };
    }
    function draw() {
      const { checks, score } = strength();
      page.innerHTML = `<div class="tl-tmap">
        <section class="tl-thesisbox"><label>Thesis statement<textarea data-f="thesis" rows="2" placeholder="What you will prove, and why, e.g. “X should Y because A and B.”">${esc(map.thesis)}</textarea></label></section>
        <div class="tl-reasons">${map.reasons.map((rs, i) => `<section class="tl-reason${rs.ev.length ? '' : ' tl-weak'}">
          <div class="tl-rhead"><b>Reason ${i + 1}</b>${map.reasons.length > 1 ? `<button type="button" class="tl-x" data-delr="${i}" aria-label="Remove reason ${i + 1}">×</button>` : ''}</div>
          <textarea data-f="reason" data-i="${i}" rows="2" placeholder="A reason your thesis is true">${esc(rs.text)}</textarea>
          ${rs.ev.map((e, j) => `<div class="tl-ev2"><p>“${esc(e.quote || '…')}” <b>${esc(inText(style, e, numberOf(e)))}</b></p><small>${cite(style, e, numberOf(e))}</small><span><button type="button" data-edit="${i}.${j}">Edit</button><button type="button" data-dele="${i}.${j}">Remove</button></span></div>`).join('')}
          ${rs.ev.length ? '' : '<p class="tl-gap">No evidence yet. This leg is weak.</p>'}
          <button type="button" class="lab-btn" data-adde="${i}">＋ Evidence</button></section>`).join('')}
          <button type="button" class="tl-addr" data-addr>＋ Reason</button></div>
        <section class="tl-counterbox"><label>Counter-argument and your answer<textarea data-f="counter" rows="2" placeholder="Some may say… However…">${esc(map.counter)}</textarea></label></section>
        <section class="tl-structure"><h4>Strength · ${score}/100</h4><ul>${checks.map(([ok, t]) => `<li class="${ok ? 'tl-ok' : 'tl-bad'}">${ok ? '✓' : '✗'} ${esc(t)}</li>`).join('')}</ul></section>
        ${sources().length ? `<section class="tl-refs"><h4>${style === 'mla' ? 'Works Cited' : style === 'ieee' ? 'References' : style === 'chicago' ? 'References' : 'References'}</h4><ol class="${style === 'ieee' ? 'tl-ieee' : ''}">${refList().map((h) => `<li>${h}</li>`).join('')}</ol></section>` : ''}
      </div>${editing ? evForm() : ''}`;
      st.set([['Reasons', String(map.reasons.length)], ['Sources', String(sources().length)], ['Strength', score + '/100']]);
      if (score >= 80) api.check(2);
    }
    // APA, MLA and Chicago sort by author; IEEE numbers in the order cited
    function refList() {
      const ev = sources(), list = ev.map((e) => ({ e, sortKey: ((authorsOf(e.authors)[0] || {}).last || e.title || '').toLowerCase() }));
      if (style !== 'ieee') list.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
      return list.map(({ e }) => cite(style, e, numberOf(e)));
    }
    function evForm() {
      const [i, j] = editing, e = j == null ? { type: 'article' } : map.reasons[i].ev[j];
      const f = (k, label, ph = '', wide = false) => `<label class="${wide ? 'tl-wide' : ''}">${label}<input data-k="${k}" value="${esc(e[k] || '')}" placeholder="${esc(ph)}"></label>`;
      return `<div class="tl-form" role="dialog" aria-label="Evidence"><h4>Evidence for reason ${i + 1}</h4>
        <label class="tl-wide">Quote or paraphrase<textarea data-k="quote" rows="3" placeholder="What the source says that supports your reason">${esc(e.quote || '')}</textarea></label>
        <label>Kind of source<select data-k="type">${[['article', 'Journal article'], ['book', 'Book'], ['web', 'Web page']].map(([v, n]) => `<option value="${v}"${(e.type || 'article') === v ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
        ${f('year', 'Year', '2021')}
        ${f('authors', 'Author(s)', 'Last, First; Last, First', true)}
        ${f('title', 'Title', 'Title of the article, book or page', true)}
        ${f('container', 'Journal / publisher / website', 'e.g. Philippine Journal of Science', true)}
        ${f('volume', 'Volume')}${f('issue', 'Issue')}${f('pages', 'Pages', '12 to 19')}
        ${f('url', 'Link (DOI or URL)', 'https://…', true)}
        <div class="tl-formbtns"><button type="button" class="lab-btn main" data-savee>Save</button><button type="button" class="lab-btn" data-cancel>Cancel</button></div></div>`;
    }
    page.addEventListener('input', (e) => {
      const t = e.target;
      if (t.dataset.f === 'thesis') map.thesis = t.value.slice(0, 600);
      else if (t.dataset.f === 'counter') map.counter = t.value.slice(0, 1200);
      else if (t.dataset.f === 'reason') map.reasons[+t.dataset.i].text = t.value.slice(0, 400);
      else return;
      save();
      const { checks, score } = strength();
      const box = page.querySelector('.tl-structure');
      if (box) box.innerHTML = `<h4>Strength · ${score}/100</h4><ul>${checks.map(([ok, tx]) => `<li class="${ok ? 'tl-ok' : 'tl-bad'}">${ok ? '✓' : '✗'} ${esc(tx)}</li>`).join('')}</ul>`;
      st.set([['Reasons', String(map.reasons.length)], ['Sources', String(sources().length)], ['Strength', score + '/100']]);
      if (map.thesis.trim()) api.check(0);
    });
    page.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.addr != null) { map.reasons.push({ text: '', ev: [] }); save(); draw(); return; }
      if (b.dataset.delr != null) { if (!map.reasons[+b.dataset.delr].ev.length || confirm('Remove this reason and its evidence?')) { map.reasons.splice(+b.dataset.delr, 1); save(); draw(); } return; }
      if (b.dataset.adde != null) { editing = [+b.dataset.adde, null]; draw(); page.querySelector('.tl-form textarea').focus(); return; }
      if (b.dataset.edit != null) { editing = b.dataset.edit.split('.').map(Number); draw(); return; }
      if (b.dataset.dele != null) { const [i, j] = b.dataset.dele.split('.').map(Number); map.reasons[i].ev.splice(j, 1); save(); draw(); return; }
      if (b.dataset.cancel != null) { editing = null; draw(); return; }
      if (b.dataset.savee != null) {
        const v = {}; page.querySelectorAll('.tl-form [data-k]').forEach((x) => { v[x.dataset.k] = x.value.trim().slice(0, 400); });
        if (!v.quote || !v.title) { alert('Add the quote (or paraphrase) and the source’s title.'); return; }
        const [i, j] = editing;
        if (j == null) map.reasons[i].ev.push(v); else map.reasons[i].ev[j] = v;
        editing = null; save(); draw(); api.check(1);
      }
    });
    async function copyRefs() {
      const html = refList(), text = html.map((h) => h.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"'));
      if (!html.length) { say(fb, 'Add some evidence with its source first.', 'bad'); return; }
      try {
        if (window.ClipboardItem) await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html.map((h) => `<p>${h}</p>`).join('')], { type: 'text/html' }), 'text/plain': new Blob([text.join('\n')], { type: 'text/plain' }) })]);
        else await navigator.clipboard.writeText(text.join('\n'));
        say(fb, `Copied ${html.length} reference${html.length === 1 ? '' : 's'} (${style.toUpperCase()}): titles stay in italics when you paste into Word or Google Docs.`, 'good');
      } catch (err) { download('references.txt', text.join('\n')); say(fb, 'Saved the reference list as a file.', ''); }
    }
    async function test() {
      if (!map.thesis.trim()) { say(fb, 'Write your thesis first.', 'bad'); return; }
      if (!api.canAsk()) { say(fb, errorWords('lab_ai_off', { next: 'Use the strength check on the map.' }), 'bad'); return; }
      const outline = `THESIS: ${map.thesis}\n${map.reasons.map((rs, i) => `REASON ${i + 1}: ${rs.text || '(empty)'}\n${rs.ev.map((e) => `  EVIDENCE: "${e.quote}": ${authorsOf(e.authors).map((a) => a.last).join(', ') || 'no author'} (${e.year || 'n.d.'}), ${e.title}`).join('\n') || '  (no evidence)'}`).join('\n')}\nCOUNTER-ARGUMENT AND ANSWER: ${map.counter || '(none)'}`;
      say(fb, 'Cassie is testing it…', 'muted');
      try {
        const t = await busy(testBtn, 'Cassie is testing it…', () => api.ask(`Stress-test this argument plan for an essay, like a fair debate judge. Say: 1) is the thesis clear and arguable, 2) which reason is weakest and why, 3) whether each piece of evidence actually supports its reason (or is off-topic, too old, or not credible), 4) the strongest objection a critic would raise. End with the 2 most important fixes. Under 170 words, plain text, no markdown.\n\n${outline}`));
        say(fb, String(t || '').replace(/[*#`_]/g, '').trim(), ''); api.check(1);
      } catch (e) { say(fb, errorWords('lab_ai_failed', { next: 'Use the strength check on the map.' }), 'bad'); }
    }
    draw();
    return { state: () => `thesis: "${map.thesis}". ${map.reasons.map((rs, i) => `Reason ${i + 1}: ${rs.text} (${rs.ev.length} evidence)`).join('. ')}. Counter: ${map.counter || 'none'}. Citation style ${style.toUpperCase()}.`, destroy() {} };
  },
  tries: ['Write a thesis with a “because”', 'Add evidence with its source', 'Get the strength check to 80 or more'],
  hints: ['Say what you will prove AND why: “X should Y because A and B.”', 'Tap ＋ Evidence under a reason and fill in the quote and its source.', 'Give every reason two pieces of evidence and answer the other side.'],
};

export const TOOLS = [vocabLab, timelineLab, essayLab, matrixLab, cornellLab, thesisLab];

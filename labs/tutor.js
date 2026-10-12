/* Teach me: Cassie as a tutor inside a lab or study tool.
   The student asks (typed or out loud) — "how do I use this?", "what's an isotope?", "what do I do
   next?" — and Cassie teaches in small steps: each step is said aloud and the exact button, slider,
   box or part it's about lights up, with her cursor pointing at it. When a step asks the student to
   tap something, she waits until they do; otherwise she goes on after she's said it.
   She sees what is on the screen: every control and part is numbered and described to her, with
   what the lab says is happening now. A lab can name parts of its picture with spots() →
   [{ name, x, y }] (page coordinates), so she can point inside the picture too. */
import { el } from './kit.js';

const CURSOR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3l14 7-6.2 1.8L10 18z"/></svg>';
const VOICE_KEY = 'cassie.labs.tutorVoice';

// Everything on screen Cassie can point at, numbered for her.
function collect(view, mounted) {
  const seen = new Set(), out = [];
  const visible = (n) => { const r = n.getBoundingClientRect(); return r.width > 2 && r.height > 2 && n.offsetParent !== null; };
  const text = (n) => String(n.getAttribute('aria-label') || n.placeholder || n.textContent || n.title || n.value || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  const add = (n, what) => { if (seen.has(n) || out.length >= 70) return; seen.add(n); out.push({ el: n, what }); };
  // the controls, by section
  view.querySelectorAll('.lab-panel .lab-group').forEach((g) => {
    if (!visible(g)) return;
    const title = ((g.querySelector(':scope > h4') || {}).textContent || '').trim();
    if (title) add(g, `the "${title}" section`);
    g.querySelectorAll('button, input, select, textarea').forEach((n) => {
      if (!visible(n) || n.closest('.lab-tutor')) return;
      const t = text(n), where = title ? ` (in "${title}")` : '';
      if (n.type === 'range') add(n.closest('.lab-sl') || n, `the "${t}" slider${where}`);
      else if (n.matches('input, textarea')) add(n, `the ${n.type === 'number' ? 'number' : 'text'} box "${t}"${where}`);
      else if (n.matches('select')) add(n, `the "${t}" menu${where}`);
      else if (n.closest('.lab-seg')) add(n, `the "${t}" choice${where}${n.getAttribute('aria-pressed') === 'true' ? ', chosen now' : ''}`);
      else add(n, `the "${t}" button${where}`);
    });
  });
  view.querySelectorAll('.lab-panel > .lab-controls > button, .lab-panel .lab-row button, .lab-panel .lab-stats').forEach((n) => {
    if (!visible(n) || n.closest('.lab-tutor')) return;
    add(n, n.matches('.lab-stats') ? `the numbers box: ${text(n)}` : `the "${text(n)}" button`);
  });
  // things in the picture area: buttons, boxes, cards (the study tools are made of these)
  view.querySelectorAll('.lab-stage button, .lab-stage input, .lab-stage select, .lab-stage textarea, .lab-stage [data-open], .lab-stage [draggable="true"], .lab-stage h3').forEach((n) => {
    if (!visible(n) || n.closest('.lab-tutor')) return;
    const t = text(n);
    if (!t) return;
    add(n, n.matches('h3') ? `the heading "${t}" in the picture area` : n.matches('input, textarea') ? `the box "${t}" in the picture area` : `"${t}" in the picture area`);
  });
  // named parts of the picture itself
  if (mounted && mounted.spots) {
    try { (mounted.spots() || []).slice(0, 20).forEach((s) => out.push({ spot: s, what: `${s.name} (a part of the picture)` })); } catch (e) { /* ignore */ }
  }
  const pic = view.querySelector('.lab-stage canvas');
  if (pic && visible(pic) && out.length < 70) out.push({ el: view.querySelector('.lab-stage'), what: 'the picture itself (the simulation you touch and drag on)' });
  return out;
}

export function tutor({ view, lab, mounted, described, ask, speak, hear, level }) {
  const box = el('div', 'lab-tutor');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', 'Cassie teaches you');
  let voiceOn = true; try { voiceOn = localStorage.getItem(VOICE_KEY) !== 'off'; } catch (e) { /* ignore */ }
  box.innerHTML = `
    <div class="tut-head"><span class="tut-who">${CURSOR}<b>Cassie is teaching</b></span>
      <button type="button" class="tut-icon tut-voice" aria-pressed="${voiceOn}" title="Cassie’s voice on or off">${voiceOn ? 'Voice on' : 'Voice off'}</button>
      <button type="button" class="tut-icon tut-x" aria-label="Stop teaching">✕</button></div>
    <p class="tut-say" aria-live="polite"></p>
    <div class="tut-nav" hidden><button type="button" class="tut-btn tut-prev" aria-label="Back a step">‹ Back</button><span class="tut-step"></span><button type="button" class="tut-btn tut-next">Next ›</button></div>
    <form class="tut-ask"><input type="text" placeholder="Ask anything: “how do I use this?”" aria-label="Ask Cassie how to do something here" enterkeyhint="send">
      ${hear ? '<button type="button" class="tut-btn tut-mic" aria-label="Say it out loud" title="Say it out loud">🎤</button>' : ''}<button type="submit" class="tut-btn tut-go">Ask</button></form>`;
  view.appendChild(box);
  const $ = (s) => box.querySelector(s);
  const sayEl = $('.tut-say'), input = $('.tut-ask input');
  const finger = el('div', 'tut-finger', CURSOR), ring = el('div', 'tut-ring');
  document.body.append(finger, ring);
  finger.hidden = ring.hidden = true;

  let steps = [], at = 0, targets = [], pointed = null, talking = null, waitOff = null, raf = 0, alive = true, asking = 0;

  function clearPoint() {
    if (pointed && pointed.el) pointed.el.classList.remove('tut-pointed');
    pointed = null; finger.hidden = ring.hidden = true;
    if (waitOff) { waitOff(); waitOff = null; }
    cancelAnimationFrame(raf);
  }
  // keep the cursor on the thing while the page scrolls or the lab moves
  function follow() {
    if (!pointed || !alive) return;
    let x, y, w = 0, h = 0;
    if (pointed.spot) { x = pointed.spot.x; y = pointed.spot.y; }
    else { const r = pointed.el.getBoundingClientRect(); x = r.left; y = r.top; w = r.width; h = r.height; }
    if (pointed.spot) { ring.hidden = false; ring.style.transform = `translate(${x - 22}px, ${y - 22}px)`; finger.style.transform = `translate(${x + 10}px, ${y + 10}px)`; }
    else finger.style.transform = `translate(${Math.min(innerWidth - 30, x + w - 6)}px, ${Math.min(innerHeight - 30, y + h - 6)}px)`;
    raf = requestAnimationFrame(follow);
  }
  function point(n) {
    clearPoint();
    const t = targets[n - 1];
    if (!t) return null;
    pointed = t;
    if (t.el) {
      t.el.classList.add('tut-pointed');
      const r = t.el.getBoundingClientRect();
      if (r.top < 60 || r.bottom > innerHeight - 40) t.el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    finger.hidden = false;
    follow();
    // if the card is covering what she's pointing at, the card moves out of the way
    setTimeout(() => {
      if (!alive || pointed !== t) return;
      box.classList.remove('tut-top');
      const b = box.getBoundingClientRect();
      const r = t.spot ? { left: t.spot.x - 24, right: t.spot.x + 24, top: t.spot.y - 24, bottom: t.spot.y + 24 } : t.el.getBoundingClientRect();
      if (r.left < b.right && r.right > b.left && r.top < b.bottom && r.bottom > b.top) box.classList.add('tut-top');
    }, 400);
    return t;
  }
  function voice(text) {
    if (talking) { try { talking.stop(); } catch (e) { /* ignore */ } talking = null; }
    if (!voiceOn || !speak) return new Promise((r) => setTimeout(r, Math.min(9000, 1200 + text.length * 45)));
    try { talking = speak(text); } catch (e) { talking = null; }
    return talking && talking.done ? talking.done : Promise.resolve();
  }
  function show(k) {
    if (!steps[k]) return;
    at = k;
    const s = steps[k];
    sayEl.textContent = s.say;
    $('.tut-nav').hidden = steps.length < 2;
    $('.tut-step').textContent = `${k + 1} of ${steps.length}`;
    $('.tut-prev').disabled = k === 0;
    $('.tut-next').textContent = k === steps.length - 1 ? 'Done ✓' : 'Next ›';
    const t = point(s.point);
    // a step that asks them to tap or change something waits for them to do it
    const doable = t && t.el && t.el.matches('button, input, select, textarea, .lab-sl, [data-open], [draggable="true"]');
    let didIt = false;
    if (doable && k < steps.length - 1) {
      const on = () => { didIt = true; setTimeout(() => { if (alive && at === k) show(k + 1); }, 700); };
      const evs = ['click', 'input', 'change'];
      evs.forEach((e) => t.el.addEventListener(e, on, { once: true }));
      waitOff = () => evs.forEach((e) => t.el.removeEventListener(e, on));
    }
    // she goes on once she's said it, and never faster than it takes to read
    const readTime = new Promise((r) => setTimeout(r, Math.min(8000, 1500 + s.say.length * 40)));
    Promise.all([voice(s.say), readTime]).then(() => {
      if (!alive || at !== k || didIt) return;
      if (!doable && k < steps.length - 1) setTimeout(() => { if (alive && at === k) show(k + 1); }, 900);
    });
  }

  function prompt(q) {
    const list = targets.map((t, i) => `${i + 1}. ${t.what}`).join('\n');
    const kind = lab.subject === 'tools' ? 'study tool' : 'simulation';
    return `You are Cassie, a warm, patient tutor sitting next to a ${level || 'high school'} student who is using the "${lab.name}" ${kind} in Cassie's Labs (${lab.blurb || ''}).
How it works: ${String(lab.about || '').slice(0, 900)}
${lab.tries && lab.tries.length ? `Goals the student can try: ${lab.tries.join(' / ')}\n` : ''}What is on the screen right now: ${described() || 'they have just opened it'}.
The things on the screen, numbered:
${list || '(nothing to point at)'}

The student says: "${q}"

Teach them like a real tutor beside them: small steps, in the order they should do them, using what they can see. For each step, point at the exact thing on the screen it's about. If they ask about an idea or a part, explain it with what is on the screen and their own numbers. Be encouraging and brief; never do the whole task for them.
Reply with ONLY JSON, no other text: {"steps":[{"say":"one or two short, natural spoken sentences","point":3}]}
Give 2 to 6 steps. "point" is the number of the thing to look at or tap, or 0 for none. Only use numbers from the list. No markdown, no emojis, no symbols that sound odd read aloud.`;
  }
  function parse(reply) {
    const t = String(reply || ''), i = t.indexOf('{'), j = t.lastIndexOf('}');
    try {
      const d = JSON.parse(t.slice(i, j + 1));
      const list = (d.steps || []).map((s) => ({ say: String(s.say || '').trim(), point: Math.max(0, Math.min(targets.length, parseInt(s.point, 10) || 0)) })).filter((s) => s.say);
      if (list.length) return list.slice(0, 8);
    } catch (e) { /* not JSON: say it as it is */ }
    const plain = t.replace(/[{}"\[\]]/g, '').replace(/\s+/g, ' ').trim();
    return plain ? [{ say: plain.slice(0, 600), point: 0 }] : [];
  }
  async function teach(q) {
    q = String(q || '').trim();
    if (!q) return;
    const me = ++asking;
    clearPoint();
    if (talking) { try { talking.stop(); } catch (e) { /* ignore */ } talking = null; }
    steps = []; $('.tut-nav').hidden = true;
    sayEl.textContent = 'Let me look at your screen…';
    box.classList.add('thinking');
    targets = collect(view, mounted());
    try {
      const reply = await ask(prompt(q));
      if (!alive || me !== asking) return;
      steps = parse(reply);
      if (!steps.length) throw new Error('empty');
      show(0);
    } catch (e) {
      if (!alive || me !== asking) return;
      sayEl.textContent = 'I couldn’t reach my brain just now. Check your internet and ask me again.';
    } finally { box.classList.remove('thinking'); }
  }

  $('.tut-next').addEventListener('click', () => { if (at < steps.length - 1) show(at + 1); else { clearPoint(); sayEl.textContent = 'Nice work! Ask me anything else about this, any time.'; $('.tut-nav').hidden = true; } });
  $('.tut-prev').addEventListener('click', () => { if (at > 0) show(at - 1); });
  $('.tut-ask').addEventListener('submit', (e) => { e.preventDefault(); const q = input.value; input.value = ''; teach(q); });
  $('.tut-voice').addEventListener('click', (e) => {
    voiceOn = !voiceOn;
    try { localStorage.setItem(VOICE_KEY, voiceOn ? 'on' : 'off'); } catch (err) { /* ignore */ }
    e.currentTarget.setAttribute('aria-pressed', String(voiceOn)); e.currentTarget.textContent = voiceOn ? 'Voice on' : 'Voice off';
    if (!voiceOn && talking) { try { talking.stop(); } catch (err) { /* ignore */ } talking = null; }
  });
  const mic = $('.tut-mic');
  let listening = null;
  if (mic) mic.addEventListener('click', async () => {
    if (listening) { listening.stop(); return; }
    if (talking) { try { talking.stop(); } catch (e) { /* ignore */ } talking = null; }
    mic.classList.add('on'); mic.textContent = '● Listening'; input.placeholder = 'Listening… tap again when you’re done';
    try {
      listening = hear();
      const said = await listening.done;
      if (said) { input.value = ''; teach(said); }
    } catch (e) { sayEl.textContent = (e && e.message) || 'I couldn’t hear that. Try again, or type it.'; }
    finally { listening = null; mic.classList.remove('on'); mic.textContent = '🎤'; input.placeholder = 'Ask anything: “how do I use this?”'; }
  });
  function stop() {
    alive = false; asking++;
    clearPoint();
    if (talking) { try { talking.stop(); } catch (e) { /* ignore */ } }
    if (listening) { try { listening.stop(); } catch (e) { /* ignore */ } }
    box.remove(); finger.remove(); ring.remove();
  }
  $('.tut-x').addEventListener('click', () => stop());
  return { teach, stop, get steps() { return steps; }, get at() { return at; }, root: box };
}

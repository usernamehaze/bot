/* For the little ones (Nursery and Kindergarten): trace letters and numbers, count with Cassie, and find
   shapes and colours. No reading or typing needed: Cassie says everything aloud (the device's own
   speech, read-aloud on from the start), every target is at least 64px, there are no timers and no
   scores to lose. Drawn on canvas and SVG, nothing to download. */
import { el, canvas, at } from './kit.js';

// Cassie's voice for the little ones: the device's speech, a little slower and brighter
function say(t) {
  try {
    const s = window.speechSynthesis;
    if (!s || !window.SpeechSynthesisUtterance) return;
    s.cancel();
    const u = new SpeechSynthesisUtterance(t);
    u.rate = 0.9; u.pitch = 1.1;
    s.speak(u);
  } catch (e) { /* no voice on this device: the pictures still work */ }
}
const still = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
const kidButton = (host, text, label, onClick) => {
  const b = el('button', 'kid-btn'); b.type = 'button'; b.textContent = text; b.setAttribute('aria-label', label);
  b.addEventListener('click', onClick); host.appendChild(b); return b;
};

/* ---------- the letters and numbers, as strokes in a 0..1 box (y down), in the order they're written ---------- */
const arc = (cx, cy, rx, ry, a0, a1, n = 18) => Array.from({ length: n + 1 }, (_, i) => { const a = (a0 + (a1 - a0) * i / n) * Math.PI / 180; return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)]; });
const GLYPHS = {
  A: [[[0.1, 1], [0.5, 0], [0.9, 1]], [[0.28, 0.6], [0.72, 0.6]]],
  B: [[[0.2, 0], [0.2, 1]], [[0.2, 0], [0.5, 0], ...arc(0.5, 0.25, 0.27, 0.25, -90, 90), [0.2, 0.5]], [[0.2, 0.5], [0.55, 0.5], ...arc(0.55, 0.75, 0.3, 0.25, -90, 90), [0.2, 1]]],
  C: [arc(0.55, 0.5, 0.4, 0.5, -40, -320)],
  D: [[[0.2, 0], [0.2, 1]], [[0.2, 0], [0.4, 0], ...arc(0.4, 0.5, 0.42, 0.5, -90, 90), [0.2, 1]]],
  E: [[[0.8, 0], [0.2, 0], [0.2, 1], [0.8, 1]], [[0.2, 0.5], [0.7, 0.5]]],
  F: [[[0.8, 0], [0.2, 0], [0.2, 1]], [[0.2, 0.5], [0.7, 0.5]]],
  G: [[...arc(0.55, 0.5, 0.4, 0.5, -40, -330), [0.95, 0.55]], [[0.6, 0.55], [0.95, 0.55]]],
  H: [[[0.2, 0], [0.2, 1]], [[0.8, 0], [0.8, 1]], [[0.2, 0.5], [0.8, 0.5]]],
  I: [[[0.5, 0], [0.5, 1]], [[0.3, 0], [0.7, 0]], [[0.3, 1], [0.7, 1]]],
  J: [[[0.7, 0], [0.7, 0.7], ...arc(0.45, 0.7, 0.25, 0.3, 0, 180)]],
  K: [[[0.2, 0], [0.2, 1]], [[0.8, 0], [0.2, 0.55]], [[0.38, 0.42], [0.8, 1]]],
  L: [[[0.2, 0], [0.2, 1], [0.8, 1]]],
  M: [[[0.12, 1], [0.12, 0], [0.5, 0.6], [0.88, 0], [0.88, 1]]],
  N: [[[0.2, 1], [0.2, 0], [0.8, 1], [0.8, 0]]],
  O: [arc(0.5, 0.5, 0.38, 0.5, -90, 270, 28)],
  P: [[[0.2, 1], [0.2, 0]], [[0.2, 0], [0.52, 0], ...arc(0.52, 0.27, 0.28, 0.27, -90, 90), [0.2, 0.54]]],
  Q: [arc(0.5, 0.5, 0.38, 0.5, -90, 270, 28), [[0.6, 0.75], [0.92, 1]]],
  R: [[[0.2, 1], [0.2, 0]], [[0.2, 0], [0.52, 0], ...arc(0.52, 0.27, 0.28, 0.27, -90, 90), [0.2, 0.54]], [[0.45, 0.54], [0.82, 1]]],
  S: [[...arc(0.5, 0.25, 0.3, 0.25, -25, -270), ...arc(0.5, 0.75, 0.3, 0.25, -90, 155)]],
  T: [[[0.1, 0], [0.9, 0]], [[0.5, 0], [0.5, 1]]],
  U: [[[0.2, 0], [0.2, 0.65], ...arc(0.5, 0.65, 0.3, 0.35, 180, 0), [0.8, 0]]],
  V: [[[0.1, 0], [0.5, 1], [0.9, 0]]],
  W: [[[0.05, 0], [0.28, 1], [0.5, 0.35], [0.72, 1], [0.95, 0]]],
  X: [[[0.15, 0], [0.85, 1]], [[0.85, 0], [0.15, 1]]],
  Y: [[[0.15, 0], [0.5, 0.5], [0.85, 0]], [[0.5, 0.5], [0.5, 1]]],
  Z: [[[0.15, 0], [0.85, 0], [0.15, 1], [0.85, 1]]],
  0: [arc(0.5, 0.5, 0.32, 0.5, -90, 270, 28)],
  1: [[[0.3, 0.2], [0.55, 0], [0.55, 1]]],
  2: [[...arc(0.5, 0.3, 0.3, 0.3, -170, 20), [0.2, 1], [0.82, 1]]],
  3: [[...arc(0.5, 0.27, 0.3, 0.27, -160, 90), ...arc(0.5, 0.73, 0.32, 0.27, -90, 160)]],
  4: [[[0.65, 1], [0.65, 0], [0.15, 0.7], [0.85, 0.7]]],
  5: [[[0.8, 0], [0.28, 0], [0.24, 0.45], ...arc(0.48, 0.68, 0.32, 0.32, -135, 150)]],
  6: [[...arc(0.62, 0.55, 0.4, 0.55, -70, -180), ...arc(0.5, 0.72, 0.3, 0.28, 180, 540, 28)]],
  7: [[[0.15, 0], [0.85, 0], [0.4, 1]]],
  8: [arc(0.5, 0.25, 0.25, 0.25, 90, 450, 24), arc(0.5, 0.73, 0.3, 0.27, -90, 270, 24)],
  9: [arc(0.5, 0.3, 0.3, 0.3, 0, 360, 24), [[0.8, 0.3], [0.75, 1]]],
  10: [[[0.12, 0.2], [0.28, 0], [0.28, 1]], arc(0.68, 0.5, 0.25, 0.5, -90, 270, 28)],
};
const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

// a glyph's strokes, sampled every few pixels along the path, in writing order
function samples(strokes, box) {
  const out = [], step = box.s * 0.02;
  strokes.forEach((pts, si) => {
    const P = pts.map(([x, y]) => [box.x + x * box.s, box.y + y * box.s]);
    out.push({ x: P[0][0], y: P[0][1], s: si });
    for (let i = 1; i < P.length; i++) {
      const [ax, ay] = P[i - 1], [bx, by] = P[i], len = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.round(len / step));
      for (let k = 1; k <= n; k++) out.push({ x: ax + (bx - ax) * k / n, y: ay + (by - ay) * k / n, s: si });
    }
  });
  return out;
}

/* ---------- Trace: a big dotted letter; follow it with a finger, in order; 80% of the path counts ---------- */
function traceLab(id, name, list, spoken) {
  return {
    id, name, subject: 'kids', levels: ['pre'],
    blurb: `Trace ${list === LETTERS ? 'the letters A to Z' : 'the numbers 0 to 10'} with your finger. Cassie says each one aloud and cheers when you finish.`,
    words: 'trace tracing letters numbers alphabet handwriting nursery kindergarten preschool little ones',
    icon: list === LETTERS ? '<path d="M10 40L24 8l14 32M15 29h18"/>' : '<path d="M14 14l8-6v32M28 14a6 6 0 1 1 9 5L28 40h12"/>',
    about: 'Cassie draws each letter or number as dots, in the order it is written. Follow the dots with your finger from the start: once you have traced most of it (80% of the path, in order), it counts. Scribbles do not count, so it really is practice.',
    mount({ stage, panel }) {
      let i = 0, cur = 0, done = false, pts = [], trail = [], box = null, total = 0;
      stage.classList.add('kid-stage');
      const cv = canvas(stage, draw);
      cv.c.classList.add('kid-trace'); cv.c.setAttribute('role', 'img');
      const bar = el('div', 'kid-row'); panel.appendChild(bar);
      kidButton(bar, '◀', 'Back one', () => go(i - 1));
      kidButton(bar, '🔊', 'Say it again', () => say(spoken(list[i])));
      kidButton(bar, '↺', 'Trace it again', () => go(i));
      kidButton(bar, '▶', 'Next one', () => go(i + 1));
      function layout() {
        const s = Math.min(cv.w, cv.h) * 0.72;
        box = { x: (cv.w - s * 0.9) / 2, y: (cv.h - s) / 2, s };
        pts = samples(GLYPHS[list[i]], box); total = pts.length;
      }
      function go(k) {
        i = (k + list.length) % list.length; cur = 0; done = false; trail = [];
        layout(); show(); say(spoken(list[i]));
        cv.redraw();
      }
      function show() { cv.c.setAttribute('aria-label', `Trace ${list[i]}`); stage.dataset.glyph = String(list[i]); stage.dataset.done = done ? '1' : ''; stage.dataset.progress = String(Math.round((cur / Math.max(1, total)) * 100)); }
      function draw(ctx, w, h) {
        if (!box || Math.abs(box.s - Math.min(w, h) * 0.72) > 1) { const keep = total ? cur / total : 0; layout(); cur = Math.round(keep * total); }
        const lw = Math.max(10, box.s * 0.07);
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        // the dotted guide
        ctx.save(); ctx.setLineDash([2, lw * 0.9]); ctx.lineWidth = lw * 0.55; ctx.strokeStyle = 'rgba(242,242,244,.55)';
        GLYPHS[list[i]].forEach((s) => { ctx.beginPath(); s.forEach(([x, y], k) => (k ? ctx.lineTo(box.x + x * box.s, box.y + y * box.s) : ctx.moveTo(box.x + x * box.s, box.y + y * box.s))); ctx.stroke(); });
        ctx.restore();
        // where to start
        const nx = pts[Math.min(cur, total - 1)];
        if (!done && nx) { ctx.fillStyle = '#7fe0a8'; ctx.beginPath(); ctx.arc(nx.x, nx.y, lw * 0.75, 0, Math.PI * 2); ctx.fill(); }
        // what's traced so far, bright
        ctx.strokeStyle = done ? '#ffcf5a' : '#7fb2ff'; ctx.lineWidth = lw;
        let last = -1;
        for (let k = 0; k < Math.min(cur, total); k++) { const p = pts[k]; if (p.s !== last) { if (last >= 0) ctx.stroke(); ctx.beginPath(); ctx.moveTo(p.x, p.y); last = p.s; } else ctx.lineTo(p.x, p.y); }
        if (last >= 0) ctx.stroke();
        // the finger's own line, faint
        ctx.strokeStyle = 'rgba(242,242,244,.25)'; ctx.lineWidth = lw * 0.35; ctx.beginPath();
        trail.forEach((p, k) => (k && !p.start ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.stroke();
        if (done) { ctx.fillStyle = '#ffcf5a'; ctx.font = `700 ${Math.round(box.s * 0.14)}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.fillText('★', w / 2, Math.max(box.s * 0.14, box.y - 6)); }
      }
      // the finger moves on along the path only near the next few dots: in order, not anywhere
      function follow(p) {
        if (done) return;
        const tol = box.s * 0.1, win = 10;
        let best = -1;
        for (let k = cur; k < Math.min(total, cur + win); k++) if (Math.hypot(p.x - pts[k].x, p.y - pts[k].y) <= tol) best = k;
        if (best >= 0) cur = best + 1;
        if (cur >= total * 0.8) {
          done = true; cur = total;
          say(`${spoken(list[i])}! You did it! Great job!`);
          if (!still()) stage.classList.add('kid-cheer'), setTimeout(() => stage.classList.remove('kid-cheer'), 700);
        }
        show();
      }
      cv.c.addEventListener('pointerdown', (e) => { e.preventDefault(); try { cv.c.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ } const p = at(cv.c, e); trail.push({ ...p, start: true }); follow(p); cv.redraw(); });
      cv.c.addEventListener('pointermove', (e) => { if (!e.buttons && e.pointerType === 'mouse') return; if (!cv.c.hasPointerCapture || !cv.c.hasPointerCapture(e.pointerId)) return; const p = at(cv.c, e); trail.push(p); if (trail.length > 600) trail.shift(); follow(p); cv.redraw(); });
      go(0);
      return { state: () => `tracing ${list[i]}: ${done ? 'finished' : Math.round((cur / total) * 100) + '% traced'}`, destroy: () => { try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (e) { /* */ } cv.destroy(); } };
    },
  };
}
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const NUMBERS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const traceLetters = traceLab('trace-letters', 'Trace letters', LETTERS, (c) => `${c}`);
const traceNumbers = traceLab('trace-numbers', 'Trace numbers', NUMBERS, (n) => NUMBER_WORDS[n]);

/* ---------- Count with me: tap each one and Cassie counts aloud ---------- */
const THINGS = [['apple', '#ff7a7a', '<circle cx="24" cy="27" r="14"/><path d="M24 13c0-4 2-6 5-7" fill="none" stroke="#3f7a4a" stroke-width="3" stroke-linecap="round"/>'],
  ['star', '#ffcf5a', '<path d="M24 6l5.5 11.5 12.5 1.5-9.3 8.6 2.5 12.4L24 33.8 12.8 40l2.5-12.4L6 19l12.5-1.5z"/>'],
  ['fish', '#7fb2ff', '<path d="M8 24c6-9 18-11 26-4l8-6v20l-8-6c-8 7-20 5-26-4z"/><circle cx="16" cy="22" r="2" fill="#1b1b1d"/>'],
  ['ball', '#c4a0ff', '<circle cx="24" cy="24" r="15"/><path d="M9 24h30M24 9c6 5 6 25 0 30M24 9c-6 5-6 25 0 30" fill="none" stroke="#1b1b1d" stroke-width="2" opacity=".35"/>']];
const countLab = {
  id: 'count', name: 'Count with me', subject: 'kids', levels: ['pre'],
  blurb: 'Tap each apple, star or fish and Cassie counts with you, up to 10.',
  words: 'count counting numbers one to ten nursery kindergarten preschool little ones',
  icon: '<circle cx="14" cy="24" r="6"/><circle cx="34" cy="24" r="6"/><path d="M14 38v4M34 38v4M24 8v6"/>',
  about: 'Cassie puts out 1 to 10 things. Tap each one and she says the next number. When every one is tapped she says how many there are, then tap More for a new set.',
  mount({ stage, panel }) {
    let n = 4, tapped = 0, round = 0;
    stage.classList.add('kid-stage');
    const field = el('div', 'kid-field'); stage.appendChild(field);
    const bar = el('div', 'kid-row'); panel.appendChild(bar);
    kidButton(bar, '🔊', 'Say it again', () => say(tapped >= n ? `${NUMBER_WORDS[n]}! You counted ${NUMBER_WORDS[n]}!` : `Let's count! Tap each one.`));
    kidButton(bar, 'More', 'More to count', () => deal());
    function deal() {
      if (round++) n = 1 + Math.floor(Math.random() * 10);
      tapped = 0; field.innerHTML = '';
      const [kind, color, art] = THINGS[round % THINGS.length];
      for (let k = 0; k < n; k++) {
        const b = el('button', 'kid-thing'); b.type = 'button'; b.setAttribute('aria-label', kind);
        b.innerHTML = `<svg viewBox="0 0 48 48" aria-hidden="true" fill="${color}">${art}</svg><span class="kid-num" aria-hidden="true"></span>`;
        b.addEventListener('click', () => {
          if (b.dataset.n) return; // (each one counts once)
          tapped++; b.dataset.n = String(tapped); b.querySelector('.kid-num').textContent = tapped; b.setAttribute('aria-label', `${kind} ${tapped}`);
          say(tapped >= n ? `${NUMBER_WORDS[tapped]}! You counted ${NUMBER_WORDS[n]}! Great job!` : NUMBER_WORDS[tapped]);
          stage.dataset.counted = String(tapped);
        });
        field.appendChild(b);
      }
      stage.dataset.n = String(n); stage.dataset.counted = '0';
      say(`Let's count! Tap each one.`);
    }
    deal();
    return { state: () => `counting: ${tapped} of ${n} tapped`, destroy: () => { try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (e) { /* */ } } };
  },
};

/* ---------- Shapes and colours: Cassie names one, tap it ---------- */
const SHAPES = { circle: '<circle cx="24" cy="24" r="17"/>', square: '<rect x="8" y="8" width="32" height="32" rx="3"/>', triangle: '<path d="M24 6l19 34H5z"/>',
  star: '<path d="M24 5l5.8 12 13.2 1.8-9.6 9.1 2.4 13.1L24 34.8 12.2 41l2.4-13.1L5 18.8l13.2-1.8z"/>', heart: '<path d="M24 41C10 31 5 24 5 16.5 5 10.7 9.4 7 14.5 7c4 0 7.4 2.3 9.5 6 2.1-3.7 5.5-6 9.5-6C38.6 7 43 10.7 43 16.5 43 24 38 31 24 41z"/>' };
const COLOURS = { red: '#e5484d', blue: '#2f6fd6', yellow: '#f2c200', green: '#2e9e5b', orange: '#e8862a', purple: '#8e4ec6' };
const shapesLab = {
  id: 'shapes', name: 'Shapes and colours', subject: 'kids', levels: ['pre'],
  blurb: 'Cassie names a shape and a colour, like the red circle. Tap the right one.',
  words: 'shapes colours colors circle square triangle star heart red blue yellow green nursery kindergarten preschool little ones',
  icon: '<circle cx="15" cy="16" r="8"/><rect x="26" y="8" width="15" height="15" rx="2"/><path d="M24 26l10 16H14z"/>',
  about: 'Four pictures, and Cassie says one of them aloud. Tap it! A wrong tap is fine: Cassie says what that one is, and you try again.',
  mount({ stage, panel }) {
    let want = null, timer = 0;
    stage.classList.add('kid-stage');
    const field = el('div', 'kid-field kid-shapes'); stage.appendChild(field);
    const bar = el('div', 'kid-row'); panel.appendChild(bar);
    kidButton(bar, '🔊', 'Say it again', () => want && say(`Tap the ${want.colour} ${want.shape}.`));
    kidButton(bar, 'Next', 'A new one', () => deal());
    const pick = (o) => o[Math.floor(Math.random() * o.length)];
    function deal() {
      clearTimeout(timer); field.innerHTML = '';
      const shapes = Object.keys(SHAPES), colours = Object.keys(COLOURS), used = new Set(), opts = [];
      while (opts.length < 4) { const o = { shape: pick(shapes), colour: pick(colours) }, k = o.shape + o.colour; if (!used.has(k) && !opts.some((x) => x.shape === o.shape && x.colour === o.colour)) { used.add(k); opts.push(o); } }
      want = pick(opts);
      opts.forEach((o) => {
        const b = el('button', 'kid-thing kid-shape'); b.type = 'button'; b.setAttribute('aria-label', `${o.colour} ${o.shape}`);
        b.dataset.shape = o.shape; b.dataset.colour = o.colour;
        b.innerHTML = `<svg viewBox="0 0 48 48" aria-hidden="true" fill="${COLOURS[o.colour]}" stroke="#1b1b1d" stroke-width="1.5">${SHAPES[o.shape]}</svg>`;
        b.addEventListener('click', () => {
          if (o === want) { b.classList.add('kid-yes'); say(`Yes! The ${o.colour} ${o.shape}! Great job!`); stage.dataset.right = String((+stage.dataset.right || 0) + 1); timer = setTimeout(deal, 1600); }
          else say(`That is the ${o.colour} ${o.shape}. Try again!`);
        });
        field.appendChild(b);
      });
      stage.dataset.want = `${want.colour} ${want.shape}`;
      say(`Tap the ${want.colour} ${want.shape}.`);
    }
    deal();
    return { state: () => `finding the ${want.colour} ${want.shape}`, destroy: () => { clearTimeout(timer); try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (e) { /* */ } } };
  },
};

export const KIDS = [traceLetters, traceNumbers, countLab, shapesLab];
export { GLYPHS, samples };

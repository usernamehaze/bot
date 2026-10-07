/* The toolkit every lab is built from: a canvas that stays sharp and the right size, sliders,
   switches and number tiles in Cassie's style, an animation clock that rests when nothing
   moves, and a small, safe reader for formulas students type (no eval). */

// colours for what's drawn inside a lab (the panels around it stay black and white)
export const INK = '#f2f2f4', DIM = 'rgba(242,242,244,.55)', FAINT = 'rgba(242,242,244,.14)', GRID = 'rgba(242,242,244,.07)';
export const C = { gold: '#ffcf5a', blue: '#7fb2ff', red: '#ff7a7a', green: '#7fe0a8', violet: '#c4a0ff', teal: '#6fe3e0' };
export const FONT = '600 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

export function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}
export const esc = (t) => String(t).replace(/[<&>"]/g, (c) => ({ '<': '&lt;', '&': '&amp;', '>': '&gt;', '"': '&quot;' }[c]));
// numbers people read: 3 significant figures, no "1e-7" noise
export function num(v, digits = 3) {
  if (!Number.isFinite(v)) return '—';
  if (Math.abs(v) < 1e-9) return '0';
  const a = Math.abs(v);
  if (a >= 1e6 || a < 1e-3) return v.toExponential(2).replace('e+', ' × 10^').replace('e-', ' × 10^-');
  return String(+v.toPrecision(digits));
}

/* ---------- the puzzle day, and dice that roll the same for everyone ---------- */
// a "puzzle day" starts at midnight Philippine time, the same moment for every student
export const dayKey = (ms = Date.now()) => new Date(ms + 8 * 3600e3).toISOString().slice(0, 10);
export function seedOf(text) { let h = 2166136261; for (const ch of String(text)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
export function rng(seed) { // mulberry32: the same seed gives the same numbers
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function shuffle(list, rand) { const a = list.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
// buttons that sit on top of the picture itself (bigger targets, right where you look)
export function overlay(stage, where = 'bl') {
  const o = el('div', 'lab-overlay ' + where);
  stage.appendChild(o);
  return o;
}
export function fmtTime(s) { s = Math.round(s); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }

/* ---------- a canvas that fills its box ---------- */
export function canvas(host, draw) {
  const c = el('canvas', 'lab-canvas');
  host.appendChild(c);
  const ctx = c.getContext('2d');
  const v = { c, ctx, w: 1, h: 1, raf: 0 };
  v.redraw = () => {
    if (v.raf) return;
    v.raf = requestAnimationFrame(() => {
      v.raf = 0;
      ctx.clearRect(0, 0, v.w, v.h);
      ctx.font = FONT;
      draw(ctx, v.w, v.h);
    });
  };
  const fit = () => {
    const r = host.getBoundingClientRect(), d = Math.min(2, window.devicePixelRatio || 1);
    v.w = Math.max(1, Math.round(r.width)); v.h = Math.max(1, Math.round(r.height));
    c.width = v.w * d; c.height = v.h * d;
    c.style.width = v.w + 'px'; c.style.height = v.h + 'px';
    ctx.setTransform(d, 0, 0, d, 0, 0);
    v.redraw();
  };
  const ro = new ResizeObserver(fit);
  ro.observe(host);
  fit();
  v.destroy = () => { ro.disconnect(); cancelAnimationFrame(v.raf); c.remove(); };
  return v;
}
// where a pointer is on a canvas, in CSS pixels
export function at(c, e) { const r = c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
// press, drag and let go — with the mouse, a pen or a finger
export function drag(c, { down, move, up }) {
  let on = false;
  c.addEventListener('pointerdown', (e) => {
    const p = at(c, e);
    if (down && down(p, e) === false) return;
    on = true;
    try { c.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    e.preventDefault();
  });
  c.addEventListener('pointermove', (e) => { if (on && move) move(at(c, e), e); });
  const end = (e) => { if (!on) return; on = false; if (up) up(at(c, e), e); };
  c.addEventListener('pointerup', end);
  c.addEventListener('pointercancel', end);
}

/* ---------- an animation clock (pauses itself when the lab closes) ---------- */
export function clock(step) {
  let raf = 0, last = 0;
  const tick = (t) => {
    const dt = Math.min(0.05, last ? (t - last) / 1000 : 0.016);
    last = t;
    if (step(dt) === false) { raf = 0; last = 0; return; }
    raf = requestAnimationFrame(tick);
  };
  return {
    start() { if (!raf) { last = 0; raf = requestAnimationFrame(tick); } },
    stop() { cancelAnimationFrame(raf); raf = 0; last = 0; },
    get running() { return !!raf; },
  };
}

/* ---------- controls ---------- */
export function group(panel, title) {
  const g = el('div', 'lab-group');
  if (title) g.appendChild(el('h4', '', esc(title)));
  panel.appendChild(g);
  return g;
}
export function slider(host, { label, min, max, step = 1, value, fmt = (v) => num(v), onInput }) {
  const w = el('label', 'lab-sl');
  w.innerHTML = `<span class="lab-sl-top"><b>${esc(label)}</b><output></output></span><input type="range" min="${min}" max="${max}" step="${step}">`;
  const input = w.querySelector('input'), out = w.querySelector('output');
  const show = () => {
    out.textContent = fmt(+input.value);
    input.style.setProperty('--fill', ((+input.value - min) / (max - min)) * 100 + '%');
  };
  input.value = value;
  show();
  input.addEventListener('input', () => { show(); onInput && onInput(+input.value); });
  host.appendChild(w);
  return { el: w, get value() { return +input.value; }, set(v) { input.value = v; show(); } };
}
export function seg(host, { label, options, value, onChange }) {
  const w = el('div', 'lab-seg-wrap');
  if (label) w.appendChild(el('span', 'lab-seg-label', esc(label)));
  const s = el('div', 'lab-seg');
  s.setAttribute('role', 'group');
  if (label) s.setAttribute('aria-label', label);
  let cur = value;
  options.forEach(([v, text]) => {
    const b = el('button', '', esc(text));
    b.type = 'button'; b.dataset.v = String(v);
    b.setAttribute('aria-pressed', String(v === value));
    b.addEventListener('click', () => { set(v); onChange && onChange(v); });
    s.appendChild(b);
  });
  function set(v) { cur = v; s.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === String(v)))); }
  w.appendChild(s);
  host.appendChild(w);
  return { el: w, get value() { return cur; }, set };
}
export function button(host, text, onClick, cls = '') {
  const b = el('button', 'lab-btn ' + cls, esc(text));
  b.type = 'button';
  b.addEventListener('click', onClick);
  host.appendChild(b);
  return b;
}
export function row(host, cls = '') { const r = el('div', 'lab-row ' + cls); host.appendChild(r); return r; }
// number tiles: what the lab measures right now
export function stats(host) {
  const w = el('dl', 'lab-stats');
  host.appendChild(w);
  return {
    el: w,
    set(list) {
      w.innerHTML = list.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');
    },
  };
}
// a + / − counter
export function stepper(host, { label, min, max, value, onChange }) {
  const w = el('div', 'lab-step');
  w.innerHTML = `<span>${esc(label)}</span><button type="button" aria-label="Less ${esc(label)}">−</button><output></output><button type="button" aria-label="More ${esc(label)}">+</button>`;
  const [minus, plus] = w.querySelectorAll('button'), out = w.querySelector('output');
  let v = value;
  const show = () => { out.textContent = String(v); minus.disabled = v <= min; plus.disabled = v >= max; };
  const set = (n) => { v = Math.max(min, Math.min(max, n)); show(); };
  minus.addEventListener('click', () => { set(v - 1); onChange && onChange(v); });
  plus.addEventListener('click', () => { set(v + 1); onChange && onChange(v); });
  show();
  host.appendChild(w);
  return { el: w, get value() { return v; }, set, setMax(m) { max = m; set(v); } };
}

/* ---------- drawing helpers ---------- */
export function line(ctx, pts, color, width = 2) {
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
  ctx.stroke();
}
export function dot(ctx, x, y, r, color) { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
export function text(ctx, t, x, y, color = DIM, align = 'left', base = 'alphabetic') {
  ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = base; ctx.fillText(t, x, y);
}
export function arrow(ctx, x1, y1, x2, y2, color, width = 2) {
  line(ctx, [[x1, y1], [x2, y2]], color, width);
  const a = Math.atan2(y2 - y1, x2 - x1), s = 6 + width * 2;
  ctx.fillStyle = color; ctx.beginPath();
  ctx.moveTo(x2, y2); ctx.lineTo(x2 - s * Math.cos(a - 0.45), y2 - s * Math.sin(a - 0.45)); ctx.lineTo(x2 - s * Math.cos(a + 0.45), y2 - s * Math.sin(a + 0.45));
  ctx.closePath(); ctx.fill();
}
// a "nice" step for axis marks: 1, 2 or 5 times a power of ten
export function niceStep(span, ticks = 8) {
  const raw = span / ticks, p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}

/* ---------- reading a formula a student typed ----------
   2x + 3, sin(x)^2, 3x^2 - 4x + 1, sqrt(x), e^(-x), |x|, 2pi x … → a function of x.
   Throws an Error with a friendly message when it can't read it. */
const FUNCS = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
  arcsin: Math.asin, arccos: Math.acos, arctan: Math.atan, sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
  sec: (v) => 1 / Math.cos(v), csc: (v) => 1 / Math.sin(v), cot: (v) => 1 / Math.tan(v),
  sqrt: Math.sqrt, abs: Math.abs, ln: Math.log, log: Math.log10, exp: Math.exp, floor: Math.floor, ceil: Math.ceil, round: Math.round,
};
export function formula(src) {
  const s = String(src).toLowerCase().replace(/\s+/g, '').replace(/π/g, 'pi').replace(/×|·/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/\*\*/g, '^').replace(/²/g, '^2').replace(/³/g, '^3').replace(/^(y|f\(x\))=/, '');
  if (!s) throw new Error('Type a formula, like 2x + 1 or sin(x).');
  if (s.length > 200) throw new Error('That formula is too long.');
  const toks = [];
  for (let i = 0; i < s.length;) {
    const ch = s[i];
    const m = /^(\d+\.?\d*|\.\d+)/.exec(s.slice(i));
    if (m) { toks.push({ t: 'n', v: parseFloat(m[1]) }); i += m[1].length; continue; }
    const w = /^[a-z]+/.exec(s.slice(i));
    if (w) {
      // split runs like "xsin" or "pix" into known words
      let word = w[0];
      while (word) {
        const name = Object.keys(FUNCS).concat(['pi', 'e', 'x']).sort((a, b) => b.length - a.length).find((k) => word.startsWith(k));
        if (!name) throw new Error(`I don't know “${word}”. Use x, numbers, + − × ÷ ^ and sin, cos, tan, sqrt, ln, log, abs, exp.`);
        toks.push(name === 'x' ? { t: 'x' } : name === 'pi' ? { t: 'n', v: Math.PI } : name === 'e' ? { t: 'n', v: Math.E } : { t: 'f', v: name });
        word = word.slice(name.length);
      }
      i += w[0].length;
      continue;
    }
    if ('+-*/^()|'.includes(ch)) { toks.push({ t: ch }); i++; continue; }
    throw new Error(`I can't read “${ch}” in the formula.`);
  }
  let k = 0;
  const peek = () => toks[k], take = (t) => (toks[k] && toks[k].t === t ? toks[k++] : null);
  const starts = (tk) => tk && (tk.t === 'n' || tk.t === 'x' || tk.t === 'f' || tk.t === '(' || (tk.t === '|' && !absOpen));
  let absOpen = 0;
  function expr() {
    let a = term();
    for (;;) {
      if (take('+')) { const l = a, r = term(); a = (x) => l(x) + r(x); }
      else if (take('-')) { const l = a, r = term(); a = (x) => l(x) - r(x); }
      else return a;
    }
  }
  function term() {
    let a = unary();
    for (;;) {
      if (take('*')) { const l = a, r = unary(); a = (x) => l(x) * r(x); }
      else if (take('/')) { const l = a, r = unary(); a = (x) => l(x) / r(x); }
      else if (starts(peek())) { const l = a, r = power(); a = (x) => l(x) * r(x); } // 2x, 3sin(x), (x+1)(x-1)
      else return a;
    }
  }
  function unary() {
    if (take('-')) { const a = unary(); return (x) => -a(x); }
    if (take('+')) return unary();
    return power();
  }
  function power() {
    const b = atom();
    if (take('^')) { const e = unary(); return (x) => Math.pow(b(x), e(x)); }
    return b;
  }
  function atom() {
    const tk = toks[k++];
    if (!tk) throw new Error('The formula ends too soon.');
    if (tk.t === 'n') { const v = tk.v; return () => v; }
    if (tk.t === 'x') return (x) => x;
    if (tk.t === '(') { const a = expr(); if (!take(')')) throw new Error('A bracket “(” is not closed.'); return a; }
    if (tk.t === '|') { absOpen++; const a = expr(); absOpen--; if (!take('|')) throw new Error('A “|” is not closed.'); return (x) => Math.abs(a(x)); }
    if (tk.t === 'f') {
      const fn = FUNCS[tk.v];
      // sin x and sin(x) both work; sin^2(x) means (sin x)^2
      if (take('^')) { const e = unary(); const a = atom(); return (x) => Math.pow(fn(a(x)), e(x)); }
      const a = peek() && peek().t === '(' ? atom() : power();
      return (x) => fn(a(x));
    }
    throw new Error(`Something is missing before “${tk.t}”.`);
  }
  const f = expr();
  if (k < toks.length) throw new Error(`I can't read the part from “${toks[k].t === 'n' ? toks[k].v : toks[k].t}”.`);
  return f;
}

// the area under a curve (Simpson's rule; skips points where the curve breaks)
export function integrate(f, a, b, n = 600) {
  if (a === b) return 0;
  const h = (b - a) / n;
  let s = 0;
  for (let i = 0; i <= n; i++) {
    const y = f(a + i * h);
    if (!Number.isFinite(y)) return NaN;
    s += y * (i === 0 || i === n ? 1 : i % 2 ? 4 : 2);
  }
  return (s * h) / 3;
}
export const gcd = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) [a, b] = [b, a % b]; return a || 1; };

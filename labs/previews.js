// Live mini previews of the labs: a small looping drawing for each (a pendulum swinging, a cell
// drifting, planets turning...), not the lab itself. Drawn on a canvas in the palette's colours.
// One shared loop draws only the previews on screen (at most MAX at once, about 30 a second) and
// rests while the page is hidden. Reduce Motion or Lite mode: each shows one still frame.
const TAU = Math.PI * 2;
const MAX = 8;

// the palette, read from the page (Monochrome greys, or Blush & Sage, light or dark)
function colours(el) {
  const st = getComputedStyle(el);
  const v = (k, f) => (st.getPropertyValue(k) || '').trim() || f;
  return { ink: v('--text', '#0e0e10'), mid: v('--muted', '#63636e'), line: v('--border', '#c9c9d2'), accent: v('--primary', '#0e0e10'), second: v('--secondary', '#3e3e45'), paper: v('--surface', '#ffffff'), page: v('--bg', '#f2f2f5') };
}

const P = {};
// (each draws a whole frame: g = the 2D context, w/h = size in px, t = seconds, c = colours)
P.pendulum = (g, w, h, t, c) => {
  const px = w / 2, py = h * 0.14, L = h * 0.62, a = Math.sin(t * 2.1) * 0.75;
  const bx = px + Math.sin(a) * L, by = py + Math.cos(a) * L;
  line(g, w * 0.3, py, w * 0.7, py, c.mid, 3);
  g.setLineDash([3, 4]); g.beginPath(); g.arc(px, py, L, Math.PI / 2 - 0.75, Math.PI / 2 + 0.75); stroke(g, c.line, 1.5); g.setLineDash([]);
  line(g, px, py, bx, by, c.ink, 2.5);
  dot(g, bx, by, h * 0.09, c.accent);
};
P.waves = (g, w, h, t, c) => {
  for (let k = 0; k < 2; k++) {
    g.beginPath();
    for (let x = 0; x <= w; x += 3) { const y = h / 2 + Math.sin(x / w * TAU * 1.5 - t * 3 + k * 1.2) * h * 0.22 * (k ? 0.55 : 1); x ? g.lineTo(x, y) : g.moveTo(x, y); }
    stroke(g, k ? c.mid : c.accent, k ? 2 : 3.5);
  }
};
P.solar = (g, w, h, t, c) => {
  const cx = w / 2, cy = h / 2;
  dot(g, cx, cy, h * 0.1, c.accent);
  [0.2, 0.3, 0.42].forEach((r, i) => { g.beginPath(); g.ellipse(cx, cy, w * r * 1.1, h * r, 0, 0, TAU); stroke(g, c.line, 1.2); const a = t * (1.4 - i * 0.4) + i * 2; dot(g, cx + Math.cos(a) * w * r * 1.1, cy + Math.sin(a) * h * r, h * (0.035 + i * 0.012), i === 1 ? c.second : c.ink); });
};
P['build-cell'] = (g, w, h, t, c) => {
  const cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.4;
  g.beginPath();
  for (let i = 0; i <= 48; i++) { const a = i / 48 * TAU, r = R * (1 + Math.sin(a * 5 + t * 1.5) * 0.04); i ? g.lineTo(cx + Math.cos(a) * r * 1.15, cy + Math.sin(a) * r) : g.moveTo(cx + Math.cos(a) * r * 1.15, cy + Math.sin(a) * r); }
  g.closePath(); fill(g, c.page); stroke(g, c.ink, 2.5);
  dot(g, cx - R * 0.1, cy, R * 0.32, c.accent); dot(g, cx - R * 0.1, cy, R * 0.12, c.paper);
  for (let i = 0; i < 6; i++) { const a = i * 1.1 + t * 0.4, d = R * (0.62 + (i % 2) * 0.14); g.beginPath(); g.ellipse(cx + Math.cos(a) * d * 1.1, cy + Math.sin(a) * d * 0.85, R * 0.13, R * 0.07, a, 0, TAU); fill(g, i % 2 ? c.second : c.mid); }
};
P.atom = (g, w, h, t, c) => {
  const cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.4;
  [[0, 1.3], [1.05, 1.0], [-1.05, 0.8]].forEach(([rot, sp], i) => { g.save(); g.translate(cx, cy); g.rotate(rot); g.beginPath(); g.ellipse(0, 0, R, R * 0.36, 0, 0, TAU); stroke(g, c.line, 1.4); const a = t * sp * 2 + i; dot(g, Math.cos(a) * R, Math.sin(a) * R * 0.36, R * 0.08, c.accent); g.restore(); });
  [[-1, -1], [1, 0], [0, 1], [-0.5, 0.6], [0.7, -0.8]].forEach(([x, y], i) => dot(g, cx + x * R * 0.1, cy + y * R * 0.1, R * 0.1, i % 2 ? c.ink : c.mid));
};
P.projectile = (g, w, h, t, c) => {
  const p = (t * 0.45) % 1, x0 = w * 0.1, y0 = h * 0.85, X = w * 0.8, H = h * 0.62;
  line(g, 0, y0, w, y0, c.line, 2);
  g.setLineDash([4, 5]); g.beginPath(); for (let k = 0; k <= 1.001; k += 0.05) { const x = x0 + X * k, y = y0 - H * 4 * k * (1 - k); k ? g.lineTo(x, y) : g.moveTo(x, y); } stroke(g, c.mid, 1.6); g.setLineDash([]);
  dot(g, x0 + X * p, y0 - H * 4 * p * (1 - p), h * 0.06, c.accent);
  line(g, x0, y0, x0 + w * 0.1, y0 - h * 0.14, c.ink, 4);
};
P.ph = (g, w, h, t, c) => {
  const bx = w * 0.28, bw = w * 0.44, top = h * 0.3, bot = h * 0.88, lvl = top + (bot - top) * (0.35 - Math.sin(t) * 0.05);
  g.beginPath(); g.rect(bx, lvl, bw, bot - lvl); fill(g, mixA(c.accent, 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(t * 0.8))));
  g.beginPath(); g.moveTo(bx, top); g.lineTo(bx, bot); g.lineTo(bx + bw, bot); g.lineTo(bx + bw, top); stroke(g, c.ink, 2.5);
  const d = (t * 0.9) % 1; dot(g, w / 2, h * 0.05 + d * (lvl - h * 0.05), h * 0.035, c.second);
  for (let i = 1; i < 4; i++) line(g, bx + bw, top + i * (bot - top) / 4, bx + bw - w * 0.06, top + i * (bot - top) / 4, c.mid, 1.5);
};
P.fractions = (g, w, h, t, c) => {
  const k = Math.floor((t * 1.2) % 9);
  [[w * 0.3, 3, 4], [w * 0.7, k, 8]].forEach(([x, n, d]) => { const r = Math.min(w * 0.17, h * 0.34); for (let i = 0; i < d; i++) { g.beginPath(); g.moveTo(x, h / 2); g.arc(x, h / 2, r, -Math.PI / 2 + i / d * TAU, -Math.PI / 2 + (i + 1) / d * TAU); g.closePath(); fill(g, i < n ? (d === 4 ? c.accent : c.second) : c.page); stroke(g, c.ink, 1.5); } });
};
P.punnett = (g, w, h, t, c) => {
  const s = Math.min(w, h) * 0.3, x0 = w / 2 - s, y0 = h / 2 - s + h * 0.04, n = Math.floor(t * 1.5) % 6;
  const L = ['PP', 'Pp', 'Pp', 'pp'];
  for (let i = 0; i < 4; i++) { const x = x0 + (i % 2) * s, y = y0 + Math.floor(i / 2) * s; g.beginPath(); g.rect(x, y, s, s); fill(g, i < n ? mixA(i === 3 ? c.second : c.accent, 0.28) : c.paper); stroke(g, c.ink, 1.6); if (i < n) text(g, L[i], x + s / 2, y + s / 2, s * 0.32, c.ink); }
  text(g, 'P', x0 + s / 2, y0 - s * 0.25, s * 0.26, c.mid); text(g, 'p', x0 + s * 1.5, y0 - s * 0.25, s * 0.26, c.mid);
};
P.function = (g, w, h, t, c) => {
  line(g, w * 0.08, h / 2, w * 0.92, h / 2, c.line, 1.5); line(g, w / 2, h * 0.08, w / 2, h * 0.92, c.line, 1.5);
  const f = (x) => x * x * x - x, sx = w * 0.27, sy = h * 0.3, X = (u) => w / 2 + u * sx, Y = (v) => h / 2 - v * sy;
  g.beginPath(); for (let u = -1.55; u <= 1.55; u += 0.05) { u > -1.55 ? g.lineTo(X(u), Y(f(u))) : g.moveTo(X(u), Y(f(u))); } stroke(g, c.ink, 2.5);
  const u = Math.sin(t * 0.8) * 1.3, m = 3 * u * u - 1;
  line(g, X(u - 0.5), Y(f(u) - m * 0.5), X(u + 0.5), Y(f(u) + m * 0.5), c.accent, 2.5); dot(g, X(u), Y(f(u)), h * 0.04, c.accent);
};
P.refraction = (g, w, h, t, c) => {
  g.beginPath(); g.rect(0, h / 2, w, h / 2); fill(g, mixA(c.second, 0.22)); line(g, 0, h / 2, w, h / 2, c.mid, 1.5);
  const a = 0.6 + Math.sin(t * 0.9) * 0.25, x = w / 2, b = Math.asin(Math.sin(a) / 1.33);
  line(g, x - Math.tan(a) * h / 2, 0, x, h / 2, c.accent, 3); line(g, x, h / 2, x + Math.tan(b) * h / 2, h, c.accent, 3);
  g.setLineDash([3, 4]); line(g, x, h * 0.15, x, h * 0.85, c.line, 1.2); g.setLineDash([]);
};
P.balance = (g, w, h, t, c) => {
  const a = Math.sin(t * 1.3) * 0.18, cx = w / 2, cy = h * 0.42, L = w * 0.36;
  g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx - w * 0.08, h * 0.88); g.lineTo(cx + w * 0.08, h * 0.88); g.closePath(); fill(g, c.mid);
  const lx = cx - Math.cos(a) * L, ly = cy - Math.sin(a) * L, rx = cx + Math.cos(a) * L, ry = cy + Math.sin(a) * L;
  line(g, lx, ly, rx, ry, c.ink, 3);
  [[lx, ly, 2, c.accent], [rx, ry, 3, c.second]].forEach(([x, y, n, col]) => { for (let i = 0; i < n; i++) dot(g, x - (n - 1) * h * 0.05 + i * h * 0.1, y - h * 0.08, h * 0.05, col); });
};
P.chance = (g, w, h, t, c) => {
  const n = 9, bw = w * 0.8 / n, grow = Math.min(1, (t % 6) / 4);
  for (let i = 0; i < n; i++) { const z = (i - 4) / 2, v = Math.exp(-z * z / 2) * grow * (0.85 + 0.15 * Math.sin(i * 7 + t * 2)); g.beginPath(); g.rect(w * 0.1 + i * bw + 1, h * 0.88 - v * h * 0.7, bw - 3, v * h * 0.7); fill(g, i === 4 ? c.accent : c.mid); }
  line(g, w * 0.08, h * 0.88, w * 0.92, h * 0.88, c.ink, 2);
};
P.magnets = (g, w, h, t, c) => {
  const cx = w / 2, cy = h / 2, mw = w * 0.34, mh = h * 0.16;
  for (let k = 1; k <= 3; k++) { g.beginPath(); g.ellipse(cx, cy, mw * 0.5 + k * w * 0.07, mh * 0.5 + k * h * 0.11, 0, 0, TAU); stroke(g, c.line, 1.3); }
  g.beginPath(); g.rect(cx - mw / 2, cy - mh / 2, mw / 2, mh); fill(g, c.accent); g.beginPath(); g.rect(cx, cy - mh / 2, mw / 2, mh); fill(g, c.mid);
  const a = t * 0.9, nx = cx + Math.cos(a) * w * 0.4, ny = cy + Math.sin(a) * h * 0.38, d = Math.atan2(ny - cy, nx - cx) + Math.PI / 2;
  dot(g, nx, ny, h * 0.07, c.paper); line(g, nx - Math.cos(d) * h * 0.06, ny - Math.sin(d) * h * 0.06, nx + Math.cos(d) * h * 0.06, ny + Math.sin(d) * h * 0.06, c.ink, 2.5);
};
P.optics = (g, w, h, t, c) => {
  const cx = w / 2, cy = h / 2;
  line(g, w * 0.05, cy, w * 0.95, cy, c.line, 1.3);
  g.beginPath(); g.ellipse(cx, cy, w * 0.035, h * 0.38, 0, 0, TAU); fill(g, mixA(c.second, 0.3)); stroke(g, c.ink, 1.6);
  const ox = w * (0.15 + 0.06 * Math.sin(t)), oh = h * 0.22;
  line(g, ox, cy, ox, cy - oh, c.accent, 3);
  const f = w * 0.18, u = cx - ox, v = (u * f) / (u - f), ix = cx + v, ih = oh * v / u;
  line(g, ox, cy - oh, cx, cy - oh, c.mid, 1.5); line(g, cx, cy - oh, ix, cy + ih, c.mid, 1.5); line(g, ox, cy - oh, ix, cy + ih, c.mid, 1.5);
  if (ix < w) line(g, ix, cy, ix, cy + ih, c.accent, 3);
};
P.units = (g, w, h, t, c) => {
  const y = h * 0.6;
  g.beginPath(); g.rect(w * 0.06, y, w * 0.88, h * 0.18); fill(g, c.paper); stroke(g, c.ink, 1.6);
  for (let i = 0; i <= 20; i++) line(g, w * 0.06 + i * w * 0.044, y, w * 0.06 + i * w * 0.044, y + (i % 5 ? h * 0.05 : h * 0.1), c.mid, 1.2);
  const p = 0.5 + 0.4 * Math.sin(t * 0.8), x = w * 0.06 + p * w * 0.88;
  g.beginPath(); g.moveTo(x, y - 2); g.lineTo(x - h * 0.06, y - h * 0.12); g.lineTo(x + h * 0.06, y - h * 0.12); g.closePath(); fill(g, c.accent);
  text(g, (p * 100).toFixed(0) + ' cm', w / 2, h * 0.25, h * 0.16, c.ink);
};
P['ice-steam'] = (g, w, h, t, c) => {
  const p = (t * 0.25) % 1, tx = w * 0.18;
  g.beginPath(); g.rect(tx - w * 0.03, h * 0.12, w * 0.06, h * 0.68); stroke(g, c.ink, 1.6); dot(g, tx, h * 0.84, h * 0.07, c.accent);
  g.beginPath(); g.rect(tx - w * 0.015, h * 0.8 - p * h * 0.62, w * 0.03, p * h * 0.62); fill(g, c.accent);
  const s = Math.max(0.15, 1 - p * 1.6), cx = w * 0.6;
  g.beginPath(); g.rect(cx - h * 0.18 * s, h * 0.78 - h * 0.36 * s, h * 0.36 * s, h * 0.36 * s); fill(g, mixA(c.second, 0.35)); stroke(g, c.ink, 1.4);
  g.beginPath(); g.ellipse(cx, h * 0.8, h * 0.3 * (1.1 - s), h * 0.05, 0, 0, TAU); fill(g, mixA(c.second, 0.3));
  if (p > 0.55) for (let i = 0; i < 3; i++) { const q = (t * 0.8 + i / 3) % 1; g.beginPath(); g.arc(cx + (i - 1) * h * 0.15 + Math.sin(q * 6) * 4, h * 0.6 - q * h * 0.45, h * 0.05, 0, TAU); stroke(g, c.mid, 1.5); }
};
P.vectors = (g, w, h, t, c) => {
  const ox = w * 0.25, oy = h * 0.75, a = 0.4 + Math.sin(t * 0.7) * 0.3, b = 1.4 + Math.cos(t * 0.6) * 0.3, L = h * 0.5;
  const ax = Math.cos(a) * L, ay = -Math.sin(a) * L, bx = Math.cos(b) * L * 0.8, by = -Math.sin(b) * L * 0.8;
  arrow(g, ox, oy, ox + ax, oy + ay, c.ink); arrow(g, ox + ax, oy + ay, ox + ax + bx, oy + ay + by, c.mid); arrow(g, ox, oy, ox + ax + bx, oy + ay + by, c.accent);
};
P.colour = (g, w, h, t, c) => {
  const cx = w / 2, cy = h / 2, r = Math.min(w, h) * 0.24;
  g.globalCompositeOperation = 'multiply';
  [c.accent, c.second, c.mid].forEach((col, i) => { const a = t * 0.6 + i * TAU / 3; dot(g, cx + Math.cos(a) * r * 0.55, cy + Math.sin(a) * r * 0.55, r, mixA(col, 0.55)); });
  g.globalCompositeOperation = 'source-over';
};
P.metals = (g, w, h, t, c) => {
  g.beginPath(); g.rect(0, h * 0.45, w, h * 0.55); fill(g, mixA(c.second, 0.2)); line(g, 0, h * 0.45, w, h * 0.45, c.mid, 1.5);
  const x = w / 2 + Math.sin(t * 3) * w * 0.15;
  g.beginPath(); g.rect(x - h * 0.08, h * 0.38, h * 0.16, h * 0.1); fill(g, c.ink);
  for (let i = 0; i < 7; i++) { const q = (t * 1.2 + i / 7) % 1; g.beginPath(); g.arc(x + (i - 3) * h * 0.04, h * 0.9 - q * h * 0.45, h * 0.025 * (1 + q), 0, TAU); stroke(g, c.mid, 1.3); }
};
P.interest = (g, w, h, t, c) => {
  const n = 8, bw = w * 0.8 / n / 2.4, p = Math.min(1, (t % 7) / 4);
  for (let i = 0; i < n; i++) { const s = (1 + i * 0.1) / 2.2, k = Math.pow(1.1, i) / 2.2, x = w * 0.1 + i * w * 0.8 / n;
    g.beginPath(); g.rect(x, h * 0.88 - s * p * h * 0.75, bw, s * p * h * 0.75); fill(g, c.mid);
    g.beginPath(); g.rect(x + bw + 2, h * 0.88 - k * p * h * 0.75, bw, k * p * h * 0.75); fill(g, c.accent); }
  line(g, w * 0.08, h * 0.88, w * 0.92, h * 0.88, c.ink, 2);
};

// small drawing helpers
function line(g, x1, y1, x2, y2, col, wd) { g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); stroke(g, col, wd); }
function stroke(g, col, wd) { g.strokeStyle = col; g.lineWidth = wd; g.lineCap = 'round'; g.lineJoin = 'round'; g.stroke(); }
function fill(g, col) { g.fillStyle = col; g.fill(); }
function dot(g, x, y, r, col) { g.beginPath(); g.arc(x, y, Math.max(0.5, r), 0, TAU); fill(g, col); }
function text(g, s, x, y, size, col) { g.fillStyle = col; g.font = `700 ${Math.round(size)}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(s, x, y); }
function arrow(g, x1, y1, x2, y2, col) { line(g, x1, y1, x2, y2, col, 3); const a = Math.atan2(y2 - y1, x2 - x1), k = 8; g.beginPath(); g.moveTo(x2, y2); g.lineTo(x2 - Math.cos(a - 0.45) * k, y2 - Math.sin(a - 0.45) * k); g.lineTo(x2 - Math.cos(a + 0.45) * k, y2 - Math.sin(a + 0.45) * k); g.closePath(); fill(g, col); }
// a colour at some see-through-ness (any CSS colour in)
const mixCtx = document.createElement('canvas').getContext('2d');
function mixA(col, a) { mixCtx.fillStyle = '#000'; mixCtx.fillStyle = col; const v = mixCtx.fillStyle; if (v[0] === '#') { const n = parseInt(v.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; } return v.replace(/rgba?\(([^)]+)\)/, (m, inner) => `rgba(${inner.split(',').slice(0, 3).join(',')},${a})`); }

export const PREVIEW_IDS = Object.keys(P);
export const hasPreview = (id) => !!P[id];

/* ---------- the shared loop ---------- */
const items = new Map(); // canvas -> { id, seen, still, c, frame }
const counts = new Map(); // frames drawn, per preview
let raf = 0, last = 0;
const quiet = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) || !!window.CASSIE_LITE;
const io = window.IntersectionObserver ? new IntersectionObserver((es) => { es.forEach((e) => { const it = items.get(e.target); if (it) it.seen = e.isIntersecting; }); kick(); }) : null;
function size(cv) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2), w = Math.max(1, Math.round(cv.clientWidth * dpr)), h = Math.max(1, Math.round(cv.clientHeight * dpr));
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  return dpr;
}
function draw(cv, it, t) {
  const dpr = size(cv), g = cv.getContext('2d');
  if (!it.c || it.frame++ % 60 === 0) it.c = colours(cv); // (the palette is read again now and then: light, dark, a new colour)
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, cv.width, cv.height);
  try { P[it.id](g, cv.clientWidth, cv.clientHeight, t, it.c); } catch (e) { /* a preview never breaks the page */ }
  const key = it.id + ' ' + cv.className; // (a redrawn Home carries on counting where the last one stopped)
  counts.set(key, (counts.get(key) || 0) + 1);
  cv.dataset.frames = String(counts.get(key));
}
function tick(now) {
  raf = 0;
  if (document.hidden) return;
  let n = 0;
  for (const [cv, it] of items) {
    if (!cv.isConnected) { items.delete(cv); if (io) io.unobserve(cv); continue; }
    if (it.still || !it.seen || n >= MAX) continue;
    n++;
    if (now - last >= 30) draw(cv, it, now / 1000);
  }
  if (now - last >= 30) last = now;
  if (n) raf = requestAnimationFrame(tick);
}
function kick() { if (!raf && !document.hidden) raf = requestAnimationFrame(tick); }
document.addEventListener('visibilitychange', kick);

// Show the preview for a lab on this canvas (still with Reduce Motion or Lite mode, or { still: true })
export function preview(cv, id, { still = false } = {}) {
  if (!P[id]) return false;
  const it = { id, seen: !io, still: still || quiet(), c: null, frame: 0 };
  items.set(cv, it);
  cv.dataset.preview = id;
  cv.dataset.still = it.still ? '1' : '0';
  requestAnimationFrame(() => draw(cv, it, 1.6)); // (a first frame at once, still or not)
  if (io) io.observe(cv);
  kick();
  return true;
}

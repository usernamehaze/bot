// Live mini previews of the labs: a small looping drawing for each (a pendulum swinging, a cell
// drifting, planets turning...), not the lab itself. Drawn on a canvas in the palette's colours.
// With { three: true } (Plus and Pro) each is a real-looking 3D scene instead (previews3d.js, the
// labs' own 3D look), and the flat drawing shows until that is ready or if 3D can't run.
// One shared loop draws only the previews on screen (at most MAX at once, about 30 a second) and
// rests while the page is hidden. Reduce Motion or Lite mode: each shows one still frame.
const TAU = Math.PI * 2;
const MAX = 8, MAX3 = 5; // (at most 8 moving at once, 5 of them in 3D)
const GROUP_MAX = { labs: 3 }; // (the Labs tab: 3 at once, the rest wait their turn)

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

P.space3d = (g, w, h, t, c) => {
  for (let i = 0; i < 18; i++) dot(g, (i * 53 % 97) / 97 * w, (i * 31 % 89) / 89 * h, 1 + (i % 3) * 0.5, c.line);
  const cx = w / 2, cy = h / 2, r = Math.min(w, h) * 0.26;
  dot(g, cx, cy, r, c.second);
  g.save(); g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.clip();
  for (let i = -2; i <= 2; i++) { const x = cx + ((i * r * 0.55 + t * 18) % (r * 2.75)) - r * 0.2; g.beginPath(); g.ellipse(x, cy, r * 0.12, r, 0, 0, TAU); fill(g, mixA(c.paper, 0.18)); }
  g.restore();
  g.beginPath(); g.ellipse(cx, cy, r * 1.7, r * 0.42, -0.25, 0, TAU); stroke(g, c.accent, 2.5);
};
P.atlas = (g, w, h, t, c) => {
  const cx = w / 2, cy = h / 2, r = Math.min(w, h) * 0.4;
  dot(g, cx, cy, r, mixA(c.second, 0.25)); g.beginPath(); g.arc(cx, cy, r, 0, TAU); stroke(g, c.ink, 2);
  for (let k = 0; k < 6; k++) { const a = (k / 6 * Math.PI + t * 0.4) % Math.PI, rx = Math.abs(Math.cos(a)) * r; g.beginPath(); g.ellipse(cx, cy, rx, r, 0, 0, TAU); stroke(g, c.line, 1.2); }
  [-0.5, 0, 0.5].forEach((f) => { g.beginPath(); g.ellipse(cx, cy + f * r, Math.sqrt(1 - f * f) * r, r * 0.12, 0, 0, TAU); stroke(g, c.line, 1.2); });
  const a = t * 0.4 + 1, x = cx + Math.sin(a) * r * 0.6; if (Math.cos(a) > 0) dot(g, x, cy - r * 0.2, h * 0.05, c.accent);
};
P.logic = (g, w, h, t, c) => {
  const on = [Math.floor(t * 1.1) % 2, Math.floor(t * 0.55) % 2], out = on[0] && on[1];
  const gx = w * 0.45, gy = h / 2, gs = h * 0.22;
  [h * 0.32, h * 0.68].forEach((y, i) => { line(g, w * 0.12, y, gx, y, on[i] ? c.accent : c.line, 3); dot(g, w * 0.12, y, h * 0.05, on[i] ? c.accent : c.mid); });
  g.beginPath(); g.moveTo(gx, gy - gs); g.lineTo(gx + gs * 0.8, gy - gs); g.arc(gx + gs * 0.8, gy, gs, -Math.PI / 2, Math.PI / 2); g.lineTo(gx, gy + gs); g.closePath(); fill(g, c.paper); stroke(g, c.ink, 2.5);
  line(g, gx + gs * 1.8, gy, w * 0.9, gy, out ? c.accent : c.line, 3); dot(g, w * 0.9, gy, h * 0.07, out ? c.accent : c.page); g.beginPath(); g.arc(w * 0.9, gy, h * 0.07, 0, TAU); stroke(g, c.ink, 2);
};
P.rocket = (g, w, h, t, c) => {
  for (let i = 0; i < 14; i++) { const y = ((i * 37 % 100) / 100 * h + t * 40) % h; dot(g, (i * 61 % 97) / 97 * w, y, 1.2, c.line); }
  const x = w / 2 + Math.sin(t * 1.5) * w * 0.04, y = h * 0.45 + Math.sin(t * 2) * h * 0.04, s = h * 0.32;
  g.beginPath(); g.moveTo(x, y - s); g.quadraticCurveTo(x + s * 0.35, y - s * 0.3, x + s * 0.25, y + s * 0.5); g.lineTo(x - s * 0.25, y + s * 0.5); g.quadraticCurveTo(x - s * 0.35, y - s * 0.3, x, y - s); fill(g, c.paper); stroke(g, c.ink, 2);
  dot(g, x, y - s * 0.25, s * 0.11, c.second);
  const f = 0.6 + 0.4 * Math.sin(t * 20); g.beginPath(); g.moveTo(x - s * 0.18, y + s * 0.5); g.lineTo(x, y + s * (0.5 + 0.55 * f)); g.lineTo(x + s * 0.18, y + s * 0.5); fill(g, c.accent);
};
P['square-proof'] = (g, w, h, t, c) => {
  const u = Math.min(w, h) * 0.2, ox = w * 0.38, oy = h * 0.62, a = 0.75 * u, b2 = 1.0 * u, k = 0.85 + 0.15 * Math.sin(t * 1.4);
  g.beginPath(); g.moveTo(ox, oy); g.lineTo(ox + b2, oy); g.lineTo(ox, oy - a); g.closePath(); fill(g, c.page); stroke(g, c.ink, 2);
  g.beginPath(); g.rect(ox, oy, b2, b2 * 0.55 * k); fill(g, mixA(c.accent, 0.45));
  g.beginPath(); g.rect(ox - a * 0.75 * k, oy - a, a * 0.75 * k, a); fill(g, mixA(c.second, 0.45));
  g.save(); g.translate(ox, oy - a); g.rotate(Math.atan2(a, b2)); const hyp = Math.hypot(a, b2); g.beginPath(); g.rect(0, -hyp * 0.6 * k, hyp, hyp * 0.6 * k); fill(g, mixA(c.mid, 0.4)); g.restore();
};
P.hanoi = (g, w, h, t, c) => {
  const base = h * 0.85, pegs = [w * 0.2, w * 0.5, w * 0.8];
  line(g, w * 0.06, base, w * 0.94, base, c.ink, 3); pegs.forEach((x) => line(g, x, base, x, h * 0.25, c.mid, 3));
  const p = (t * 0.5) % 1, step = Math.floor((t * 0.5) % 7);
  const moves = [[0, 2], [0, 1], [2, 1], [0, 2], [1, 0], [1, 2], [0, 2]], on = [[3, 2, 1], [], []];
  for (let i = 0; i < step; i++) { const [a, b] = moves[i]; on[b].push(on[a].pop()); }
  const [fa, fb] = moves[step], moving = on[fa][on[fa].length - 1];
  on.forEach((st, k) => st.forEach((d, i) => { if (k === fa && i === st.length - 1) return; g.beginPath(); g.rect(pegs[k] - d * w * 0.045, base - (i + 1) * h * 0.1, d * w * 0.09, h * 0.09); fill(g, d === 3 ? c.ink : d === 2 ? c.second : c.accent); }));
  if (moving) { const x = pegs[fa] + (pegs[fb] - pegs[fa]) * ease(p), y = base - h * 0.45 - Math.sin(p * Math.PI) * h * 0.15; g.beginPath(); g.rect(x - moving * w * 0.045, y, moving * w * 0.09, h * 0.09); fill(g, moving === 3 ? c.ink : moving === 2 ? c.second : c.accent); }
};
P.solids = (g, w, h, t, c) => {
  const cx = w / 2, cy = h / 2, s = Math.min(w, h) * 0.26, a = t * 0.8, b = 0.5;
  const pts = []; for (let i = 0; i < 8; i++) { let x = i & 1 ? 1 : -1, y = i & 2 ? 1 : -1, z = i & 4 ? 1 : -1; [x, z] = [x * Math.cos(a) - z * Math.sin(a), x * Math.sin(a) + z * Math.cos(a)]; [y, z] = [y * Math.cos(b) - z * Math.sin(b), y * Math.sin(b) + z * Math.cos(b)]; pts.push([cx + x * s, cy + y * s, z]); }
  [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]].forEach(([i, j]) => line(g, pts[i][0], pts[i][1], pts[j][0], pts[j][1], (pts[i][2] + pts[j][2]) > 0 ? c.line : c.ink, 2.2));
  pts.forEach((p) => dot(g, p[0], p[1], 3, c.accent));
};
P.recursion = (g, w, h, t, c) => {
  const depth = 1 + Math.floor((t * 1.2) % 7);
  const br = (x, y, len, ang, d) => { if (d > depth || len < 2) return; const x2 = x + Math.cos(ang) * len, y2 = y + Math.sin(ang) * len; line(g, x, y, x2, y2, d === depth ? c.accent : c.ink, Math.max(1, 4 - d * 0.5)); br(x2, y2, len * 0.7, ang - 0.45, d + 1); br(x2, y2, len * 0.7, ang + 0.45, d + 1); };
  br(w / 2, h * 0.95, h * 0.28, -Math.PI / 2, 1);
};
P.body3d = (g, w, h, t, c) => {
  const cx = w / 2, s = h / 100;
  dot(g, cx, 16 * s, 9 * s, c.line);
  g.beginPath(); g.moveTo(cx - 14 * s, 28 * s); g.lineTo(cx + 14 * s, 28 * s); g.lineTo(cx + 11 * s, 62 * s); g.lineTo(cx - 11 * s, 62 * s); g.closePath(); fill(g, c.line);
  line(g, cx - 6 * s, 62 * s, cx - 8 * s, 95 * s, c.line, 7 * s); line(g, cx + 6 * s, 62 * s, cx + 8 * s, 95 * s, c.line, 7 * s);
  line(g, cx - 14 * s, 30 * s, cx - 22 * s, 58 * s, c.line, 5 * s); line(g, cx + 14 * s, 30 * s, cx + 22 * s, 58 * s, c.line, 5 * s);
  const beat = 1 + 0.18 * Math.max(0, Math.sin(t * 7)) ** 8; dot(g, cx + 3 * s, 38 * s, 5 * s * beat, c.accent);
  g.beginPath(); g.ellipse(cx - 5 * s, 40 * s, 5 * s, 8 * s, 0, 0, TAU); fill(g, mixA(c.second, 0.5)); g.beginPath(); g.ellipse(cx + 8 * s, 41 * s, 5 * s, 8 * s, 0, 0, TAU); fill(g, mixA(c.second, 0.5));
};
P.cells3d = (g, w, h, t, c) => P['build-cell'](g, w, h, t, c);
// the study tools
// the little ones' labs (kids.js): a letter drawing itself, things counted, shapes taking turns
P['trace-letters'] = (g, w, h, t, c) => {
  const s = Math.min(w, h) * 0.7, x0 = (w - s * 0.8) / 2, y0 = (h - s) / 2, p = Math.min(1, (t * 0.4) % 1.3);
  const pts = [[0.1, 1], [0.5, 0], [0.9, 1]].map(([x, y]) => [x0 + x * s * 0.8, y0 + y * s]);
  g.setLineDash([2, 7]); g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.moveTo(x0 + s * 0.22, y0 + s * 0.6); g.lineTo(x0 + s * 0.58, y0 + s * 0.6); stroke(g, c.line, 3); g.setLineDash([]);
  const k = Math.min(1, p) * 2, a = pts[0], m = pts[1], e = pts[2];
  g.beginPath(); g.moveTo(a[0], a[1]);
  if (k <= 1) g.lineTo(a[0] + (m[0] - a[0]) * k, a[1] + (m[1] - a[1]) * k); else { g.lineTo(m[0], m[1]); g.lineTo(m[0] + (e[0] - m[0]) * (k - 1), m[1] + (e[1] - m[1]) * (k - 1)); }
  stroke(g, c.accent, 5);
};
P['trace-numbers'] = (g, w, h, t, c) => {
  const s = Math.min(w, h) * 0.7, cx = w / 2, top = (h - s) / 2, p = Math.min(1, (t * 0.4) % 1.3);
  g.setLineDash([2, 7]); line(g, cx - s * 0.15, top + s * 0.18, cx + s * 0.05, top, c.line, 3); line(g, cx + s * 0.05, top, cx + s * 0.05, top + s, c.line, 3); g.setLineDash([]);
  line(g, cx + s * 0.05, top, cx + s * 0.05, top + s * p, c.accent, 5);
};
P.count = (g, w, h, t, c) => {
  const n = 1 + Math.floor((t * 1.2) % 5), r = Math.min(w / 14, h / 6);
  for (let i = 0; i < 5; i++) dot(g, w / 2 + (i - 2) * r * 2.6, h / 2, r, i < n ? c.accent : c.line);
};
P.shapes = (g, w, h, t, c) => {
  const r = Math.min(w / 9, h / 4), on = Math.floor(t * 0.8) % 3, xs = [w * 0.22, w * 0.5, w * 0.78], y = h / 2;
  g.beginPath(); g.arc(xs[0], y, r, 0, TAU); fill(g, on === 0 ? c.accent : c.line);
  g.beginPath(); g.rect(xs[1] - r, y - r, r * 2, r * 2); fill(g, on === 1 ? c.accent : c.line);
  g.beginPath(); g.moveTo(xs[2], y - r); g.lineTo(xs[2] + r, y + r); g.lineTo(xs[2] - r, y + r); g.closePath(); fill(g, on === 2 ? c.accent : c.line);
};
P.vocab = (g, w, h, t, c) => {
  const words = ['photon', 'osmosis', 'axiom', 'genome', 'lexicon'], k = (t * 0.6) % words.length, i0 = Math.floor(k), f = k - i0;
  for (let j = -1; j <= 1; j++) { const i = (i0 + j + words.length) % words.length, x = w / 2 + (j - ease(f)) * w * 0.42, sc = 1 - Math.abs(j - ease(f)) * 0.22;
    g.save(); g.translate(x, h / 2); g.scale(sc, sc); g.beginPath(); g.rect(-w * 0.18, -h * 0.26, w * 0.36, h * 0.52); fill(g, c.paper); stroke(g, j === 0 ? c.accent : c.line, 2); text(g, words[i], 0, 0, h * 0.13, c.ink); g.restore(); }
};
P.timeline = (g, w, h, t, c) => {
  const p = (t * 0.25) % 1.2, y = h / 2, x0 = w * 0.08, x1 = x0 + Math.min(1, p) * w * 0.84;
  line(g, x0, y, x1, y, c.ink, 3);
  [0.1, 0.3, 0.52, 0.75, 0.95].forEach((q, i) => { if (q > p) return; const x = x0 + q * w * 0.84, up = i % 2 ? 1 : -1; line(g, x, y, x, y + up * h * 0.2, c.mid, 1.5); dot(g, x, y, h * 0.04, c.accent); g.beginPath(); g.rect(x - w * 0.07, y + up * h * 0.2 - (up < 0 ? h * 0.12 : 0), w * 0.14, h * 0.12); fill(g, c.page); stroke(g, c.line, 1.2); });
};
P.essay = (g, w, h, t, c) => {
  const n = 7, hl = Math.floor((t * 1.2) % n);
  for (let i = 0; i < n; i++) { const y = h * 0.14 + i * h * 0.11, len = w * (i === n - 1 ? 0.45 : 0.76 - (i % 3) * 0.06);
    if (i === hl) { g.beginPath(); g.rect(w * 0.1, y - h * 0.035, len, h * 0.07); fill(g, mixA(c.accent, 0.3)); }
    line(g, w * 0.12, y, w * 0.1 + len, y, i === hl ? c.ink : c.mid, 2.5); }
  if (hl % 2 === 0) { const y = h * 0.14 + hl * h * 0.11; text(g, hl ? 'reason' : 'claim', w * 0.93 - w * 0.06, y, h * 0.08, c.accent); }
};
P.cardmatrix = (g, w, h, t, c) => {
  const cols = 3, rows = 2, cw = w * 0.26, ch = h * 0.36, flip = (t * 0.9) % (cols * rows);
  for (let i = 0; i < cols * rows; i++) { const x = w * 0.09 + (i % cols) * w * 0.29, y = h * 0.1 + Math.floor(i / cols) * h * 0.43, f = Math.max(0, Math.min(1, flip - i)), sx = Math.abs(Math.cos(f * Math.PI)) || 0.02, back = f > 0.5;
    g.save(); g.translate(x + cw / 2, y + ch / 2); g.scale(sx, 1); g.beginPath(); g.rect(-cw / 2, -ch / 2, cw, ch); fill(g, back ? mixA(c.accent, 0.25) : c.paper); stroke(g, c.ink, 1.6); text(g, back ? 'A' : '?', 0, 0, ch * 0.4, c.ink); g.restore(); }
};
P.flashcards = P.cardmatrix;
P.cornell = (g, w, h, t, c) => {
  const x0 = w * 0.14, y0 = h * 0.08, pw = w * 0.72, ph = h * 0.84, p = (t * 0.35) % 1.3;
  g.beginPath(); g.rect(x0, y0, pw, ph); fill(g, c.paper); stroke(g, c.ink, 1.8);
  line(g, x0 + pw * 0.3, y0, x0 + pw * 0.3, y0 + ph * 0.74, c.line, 1.5); line(g, x0, y0 + ph * 0.74, x0 + pw, y0 + ph * 0.74, c.line, 1.5);
  for (let i = 0; i < 5; i++) { const q = Math.min(1, Math.max(0, p * 6 - i)); const y = y0 + ph * (0.12 + i * 0.12); if (q > 0) line(g, x0 + pw * 0.36, y, x0 + pw * (0.36 + 0.55 * q), y, c.mid, 2); if (i % 2 === 0 && q >= 1) line(g, x0 + pw * 0.05, y, x0 + pw * 0.24, y, c.accent, 2.5); }
  if (p > 0.9) for (let i = 0; i < 2; i++) line(g, x0 + pw * 0.06, y0 + ph * (0.83 + i * 0.08), x0 + pw * (0.06 + 0.8 * Math.min(1, (p - 0.9) * 3)), y0 + ph * (0.83 + i * 0.08), c.ink, 2);
};
P.thesis = (g, w, h, t, c) => {
  const cx = w / 2, cy = h / 2, n = 5, shown = 1 + Math.floor((t * 1.1) % (n + 1));
  for (let i = 0; i < n; i++) { if (i >= shown) break; const a = i / n * TAU - Math.PI / 2, x = cx + Math.cos(a) * w * 0.34, y = cy + Math.sin(a) * h * 0.34; line(g, cx, cy, x, y, c.line, 1.6); dot(g, x, y, h * 0.07, i % 2 ? c.second : c.mid); }
  dot(g, cx, cy, h * 0.12, c.accent);
};
P.museum = (g, w, h, t, c) => {
  const k = (t * 0.35) % 3;
  for (let j = -1; j <= 1; j++) { const x = w / 2 + (j - (k % 1)) * w * 0.5, i = (Math.floor(k) + j + 3) % 3;
    g.beginPath(); g.rect(x - w * 0.2, h * 0.16, w * 0.4, h * 0.6); fill(g, c.paper); g.lineWidth = 5; g.strokeStyle = c.ink; g.stroke();
    if (i === 0) { dot(g, x - w * 0.05, h * 0.38, h * 0.1, c.accent); g.beginPath(); g.moveTo(x - w * 0.18, h * 0.74); g.lineTo(x, h * 0.5); g.lineTo(x + w * 0.18, h * 0.74); fill(g, c.second); }
    else if (i === 1) { for (let r = 0; r < 4; r++) { g.beginPath(); g.arc(x, h * 0.46, h * (0.05 + r * 0.05), r, r + 4); stroke(g, r % 2 ? c.accent : c.mid, 3); } }
    else { g.beginPath(); g.ellipse(x, h * 0.46, w * 0.08, h * 0.17, 0, 0, TAU); fill(g, c.mid); dot(g, x, h * 0.38, h * 0.06, c.page); }
    line(g, x - w * 0.06, h * 0.86, x + w * 0.06, h * 0.86, c.mid, 2); }
};
const ease = (k) => k * k * (3 - 2 * k);

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

// the 3D scenes (Plus and Pro), loaded once, only when asked for
let P3 = null, p3 = null;
const load3d = () => p3 || (p3 = import('./previews3d.js').then((m) => (m.can3d() ? m.ready().then(() => (P3 = m)) : null)).catch(() => null));

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
  try { if (!(it.three && P3 && P3.draw3d(it.id, g, cv.clientWidth, cv.clientHeight, t))) P[it.id](g, cv.clientWidth, cv.clientHeight, t, it.c); } catch (e) { /* a preview never breaks the page */ }
  cv.dataset.look = it.three && P3 && P3.has3d(it.id) ? '3d' : 'flat';
  const key = it.id + ' ' + cv.className; // (a redrawn Home carries on counting where the last one stopped)
  counts.set(key, (counts.get(key) || 0) + 1);
  cv.dataset.frames = String(counts.get(key));
}
function tick(now) {
  raf = 0;
  if (document.hidden) return;
  let n = 0, n3 = 0;
  const ng = {};
  for (const [cv, it] of items) {
    if (!cv.isConnected) { items.delete(cv); if (io) io.unobserve(cv); continue; }
    cv.dataset.moving = '0';
    if (it.still || !it.seen || n >= MAX || (it.three && P3 && n3 >= MAX3)) continue;
    if (it.group && GROUP_MAX[it.group] && (ng[it.group] || 0) >= GROUP_MAX[it.group]) continue;
    n++; if (it.three && P3) n3++; if (it.group) ng[it.group] = (ng[it.group] || 0) + 1;
    cv.dataset.moving = '1';
    if (now - last >= 30) draw(cv, it, now / 1000);
  }
  if (now - last >= 30) last = now;
  if (n) raf = requestAnimationFrame(tick);
}
function kick() { if (!raf && !document.hidden) raf = requestAnimationFrame(tick); }
document.addEventListener('visibilitychange', kick);

// Show the preview for a lab on this canvas (still with Reduce Motion or Lite mode, or { still: true })
export function preview(cv, id, { still = false, three = false, group = '' } = {}) {
  if (!P[id]) return false;
  const it = { id, seen: !io, still: still || quiet(), c: null, frame: 0, three: three && !window.CASSIE_LITE, group };
  if (it.three) load3d().then((m) => { if (m && cv.isConnected) draw(cv, it, it.still ? 1.6 : performance.now() / 1000); });
  items.set(cv, it);
  cv.dataset.preview = id;
  cv.dataset.still = it.still ? '1' : '0';
  requestAnimationFrame(() => draw(cv, it, 1.6)); // (a first frame at once, still or not)
  if (io) io.observe(cv);
  kick();
  return true;
}

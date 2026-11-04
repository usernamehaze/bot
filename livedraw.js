/* Live drawing (v251): Cassie explains with real graphics, drawn part by part while she talks.
   A drawing is a small JSON "spec" the AI writes (see SPEC_GUIDE in app.js): a title, flat (2d) or a 3D model (3d),
   and parts in teaching order, each with its own shapes, a label and one or two sentences.
     2d: lines, curves, boxes, circles, arrows and words in a 400 x 260 picture, drawn stroke by stroke like a pen.
     3d: cylinders, cones, spheres, boxes, rings, discs and fan blades, built piece by piece; turn it with a finger,
         pinch to zoom, tap a part, open the case, pull it apart, and spinning parts spin.
   Everything the AI writes is checked: numbers are clamped, colours must be #hex, paths only use path letters and
   numbers, and words go in as text (never as markup). three.js loads only when a 3D drawing shows. */

const NS = 'http://www.w3.org/2000/svg';
const PALETTE = ['#7fb0ff', '#ffb067', '#8fe0b0', '#f7a8c8', '#c9a7ff', '#ffd29e', '#7ee0e0', '#e8e8ee'];
const still = () => document.documentElement.classList.contains('lite') || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
const num = (v, lo, hi, d = 0) => { const n = +v; return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const color0 = (c, i) => (typeof c === 'string' && /^#[0-9a-f]{3,8}$/i.test(c.trim()) ? c.trim() : PALETTE[i % PALETTE.length]);
// (a light page: a very pale colour is darkened so a white cloud or a pale part still shows, AA-ish against white)
const lum = (h) => { let x = h.slice(1); if (x.length < 6) x = x.slice(0, 3).split('').map((c) => c + c).join(''); const [r, g, b] = [0, 2, 4].map((k) => parseInt(x.slice(k, k + 2), 16) / 255); return .2126 * r + .7152 * g + .0722 * b; };
const lightPage = () => { try { const m = getComputedStyle(document.body).backgroundColor.match(/[\d.]+/g); return m && (.2126 * m[0] + .7152 * m[1] + .0722 * m[2]) / 255 > .6; } catch (e) { return false; } };
const shade = (h, k) => { let x = h.slice(1); if (x.length < 6) x = x.slice(0, 3).split('').map((c) => c + c).join(''); return '#' + [0, 2, 4].map((i) => Math.round(parseInt(x.slice(i, i + 2), 16) * k).toString(16).padStart(2, '0')).join(''); };
const color = (c, i) => { const h = color0(c, i); return lightPage() && lum(h) > .55 ? shade(h, .55 / lum(h) * .8) : h; };
const words = (t, max = 400) => String(t == null ? '' : t).replace(/[–—]/g, ',').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
const PATH_OK = /^[MmLlHhVvCcSsQqTtAaZz0-9.,\s+-]{1,1500}$/;
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- the spec: what the AI wrote, made safe ----------
const box4 = (b) => (Array.isArray(b) && b.length === 4 ? [num(b[0], 0, 400), num(b[1], 0, 260), num(b[2], 4, 400, 60), num(b[3], 4, 260, 40)] : null);
export function clean(raw) {
  let s = raw;
  if (typeof s === 'string') { const a = s.indexOf('{'), b = s.lastIndexOf('}'); if (a < 0 || b <= a) return null; try { s = JSON.parse(s.slice(a, b + 1)); } catch (e) { return null; } }
  if (!s || typeof s !== 'object' || !Array.isArray(s.parts)) return null;
  const mode = s.mode === '3d' ? '3d' : '2d';
  const parts = s.parts.slice(0, 10).map((p, i) => ({
    id: words(p && p.id, 40) || 'p' + i,
    label: words(p && p.label, 40),
    say: words(p && p.say, 360),
    color: color(p && p.color, i),
    box: mode === '2d' ? box4(p && p.box) : null,
    glow: !!(p && p.glow), spin: !!(p && p.spin), shell: !!(p && p.shell),
    shapes: (Array.isArray(p && p.shapes) ? p.shapes : []).slice(0, mode === '3d' ? 8 : 24).filter((x) => x && typeof x === 'object'),
  })).filter((p) => p.shapes.length);
  if (!parts.length) return null;
  return { title: words(s.title, 90) || 'How it works', mode, intro: words(s.intro, 300), summary: words(s.summary, 300), photo: words(s.photo, 300), simple: !!s.simple, axis: ['x', 'y', 'z'].includes(s.axis) ? s.axis : 'x', parts };
}

// ---------- is it a good drawing? (2d) the points every shape reaches, and what is wrong ----------
function shapePoints(sh) {
  const t = String(sh.t || sh.type || '').toLowerCase(), n = (k) => +sh[k];
  if (t === 'path' && typeof sh.d === 'string') { const v = (sh.d.match(/-?\d*\.?\d+/g) || []).map(Number); const out = []; for (let k = 0; k + 1 < v.length; k += 2) out.push([v[k], v[k + 1]]); return /[mlhvcsqta]/.test(sh.d.replace(/z/gi, '')) ? out.slice(0, 1) : out; }
  if (t === 'line' || t === 'arrow') return [[n('x1'), n('y1')], [n('x2'), n('y2')]];
  if (t === 'rect') { const w = +(sh.w2 ?? sh.width ?? sh.wd), h = n('h'); return [[n('x'), n('y')], [n('x') + w, n('y') + h]]; }
  if (t === 'circle') return [[n('cx') - n('r'), n('cy') - n('r')], [n('cx') + n('r'), n('cy') + n('r')]];
  if (t === 'ellipse') return [[n('cx') - n('rx'), n('cy') - n('ry')], [n('cx') + n('rx'), n('cy') + n('ry')]];
  if (t === 'poly' && Array.isArray(sh.pts)) return sh.pts.map((q) => [+(q && q[0]), +(q && q[1])]);
  if (t === 'text') return [[n('x'), n('y')]];
  return [];
}
export function check(spec) {
  const out = [];
  if (!spec || spec.mode !== '2d') return out;
  const boxes = [];
  for (const p of spec.parts) {
    const pts = p.shapes.flatMap(shapePoints).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
    const strokes = p.shapes.filter((x) => String(x.t || x.type).toLowerCase() !== 'text').length;
    if (!pts.length) { out.push(`"${p.label || p.id}" has no shape the picture can show, so its label points at nothing`); continue; }
    if (pts.some(([x, y]) => x < -6 || x > 406 || y < -6 || y > 266)) out.push(`"${p.label || p.id}" goes outside the 400 by 260 picture`);
    if (strokes < 2) out.push(`"${p.label || p.id}" is a single line or shape; draw its real outline and inner lines`);
    const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
    const bb = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    boxes.push(bb);
    if (p.box) { const [bx, by, bw, bh] = p.box, inside = pts.filter(([x, y]) => x >= bx - 12 && x <= bx + bw + 12 && y >= by - 12 && y <= by + bh + 12).length; if (inside < pts.length * .6) out.push(`"${p.label || p.id}" is drawn outside the box its layout gave it`); }
  }
  if (boxes.length >= 2) {
    const ux = Math.max(...boxes.map((b) => b[2])) - Math.min(...boxes.map((b) => b[0])), uy = Math.max(...boxes.map((b) => b[3])) - Math.min(...boxes.map((b) => b[1]));
    if (ux * uy < 400 * 260 * .18) out.push('everything is piled into one small corner; spread the drawing across the picture');
  }
  return out;
}

// ---------- the frame around a drawing: the picture, what she says, and what you can do ----------
export async function render(host, rawSpec, opts = {}) {
  const spec = clean(rawSpec);
  if (!spec) return false;
  const animate = !!opts.animate && !still();
  host.classList.add('ld');
  host.innerHTML = '';
  const head = el('div', 'ld-head'); const dot = el('span', 'ld-live'); dot.setAttribute('aria-hidden', 'true');
  const state = el('span', 'ld-state', animate ? 'Cassie is drawing' : spec.mode === '3d' ? 'Cassie built it in 3D' : 'Cassie drew it');
  head.append(dot, state, el('b', 'ld-title', spec.title));
  const stage = el('div', 'ld-stage'); stage.setAttribute('role', 'img'); stage.setAttribute('aria-label', `${spec.title}: ${spec.parts.map((p) => p.label).filter(Boolean).join(', ')}`);
  const hint = el('div', 'ld-hint');
  const say = el('p', 'ld-say'); say.setAttribute('aria-live', 'polite');
  const acts = el('div', 'ld-acts');
  host.append(head, stage, hint, say);
  if (spec.simple && opts.simpleNote) host.appendChild(el('p', 'ld-note', opts.simpleNote));
  host.appendChild(acts);
  const setSay = async (text, type) => {
    if (!type) { say.textContent = text; return; }
    say.textContent = '';
    for (let i = 0; i < text.length; i += 3) { say.textContent = text.slice(0, i + 3); await sleep(16); }
  };
  const view = spec.mode === '3d' ? await draw3d(stage, spec, { animate, setSay, hint }) : draw2d(stage, spec, { animate, setSay, hint });
  if (!view) { // no 3D on this phone: say what it would have shown
    stage.remove();
    say.textContent = `${spec.intro ? spec.intro + ' ' : ''}${spec.parts.map((p, i) => `${i + 1}. ${p.label}: ${p.say}`).join(' ')}`;
  }
  const btn = (label, fn, cls = '') => { const b = el('button', 'ld-btn ' + cls, label); b.type = 'button'; b.addEventListener('click', fn); acts.appendChild(b); return b; };
  const done = () => { dot.classList.add('off'); state.textContent = spec.mode === '3d' ? 'Cassie built it in 3D' : 'Cassie drew it'; setSay(spec.summary || spec.intro || ''); host.dispatchEvent(new CustomEvent('ld-done')); };
  if (view) {
    if (view.open) { const ob = btn('Open it up', () => { const on = view.open(); ob.textContent = on ? 'Close the case' : 'Open it up'; ob.setAttribute('aria-pressed', String(on)); }); ob.setAttribute('aria-pressed', 'false'); }
    if (view.explode) { const pb = btn('Pull apart', () => { const on = view.explode(); pb.textContent = on ? 'Put it back' : 'Pull apart'; pb.setAttribute('aria-pressed', String(on)); }); pb.setAttribute('aria-pressed', 'false'); }
    btn('Draw it again', async () => { await view.play(true); done(); });
  }
  if (opts.onQuiz) btn('Quiz me on it', () => opts.onQuiz(spec));
  if (opts.onRealistic && (!opts.canRealistic || opts.canRealistic())) btn('Show a real photo', () => opts.onRealistic(spec), 'ld-photo');
  if (view) {
    view.onPick = (p) => {
      if (!p) { setSay(spec.summary || spec.intro || ''); hint.textContent = view.hintText; askBtn.hidden = true; return; }
      setSay(p.say || p.label); hint.textContent = `${p.label}. Tap it again, or tap the empty space, to see it all`;
      askBtn.hidden = !opts.onAsk; askBtn.textContent = `Ask about the ${p.label}`; askBtn.onclick = () => opts.onAsk(p, spec);
    };
    const askBtn = btn('', () => {}, 'ld-askpart'); askBtn.hidden = true;
    if (spec.mode === '3d' && view.setOpen && view.open) { view.setOpen(true); const ob = acts.querySelector('.ld-btn'); if (ob) { ob.textContent = 'Close the case'; ob.setAttribute('aria-pressed', 'true'); } }
    if (animate) { await view.play(); done(); } else { await view.play(); done(); }
  }
  return true;
}

// ---------- flat drawings: one stroke at a time, like a pen; each part's name writes on after its last stroke ----------
const LABEL_FONT = 13, LABEL_PAD = 4;
function draw2d(stage, spec, { animate, setSay, hint }) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 400 260'); svg.setAttribute('class', 'ld-svg');
  stage.prepend(svg);
  const defs = document.createElementNS(NS, 'defs');
  defs.innerHTML = '<marker id="ld-head" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="currentColor"/></marker>';
  svg.appendChild(defs);
  const groups = spec.parts.map((p, i) => {
    const g = document.createElementNS(NS, 'g'); g.setAttribute('class', 'ld-part'); g.style.color = p.color; g.dataset.i = i;
    for (const s of p.shapes) { const n = shape2d(s, p); if (n) g.appendChild(n); }
    svg.appendChild(g);
    return g;
  });
  const labels = document.createElementNS(NS, 'g'); labels.setAttribute('class', 'ld-labels'); svg.appendChild(labels);
  // where each name goes: beside its part (right, left, above, below, then the corners, then further out), inside the
  // picture, never over another name, with a thin line to the nearest edge of the part
  const taken = [];
  const hits = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const textW = (t) => { try { const m = document.createElementNS(NS, 'text'); m.setAttribute('font-size', LABEL_FONT); m.setAttribute('class', 'ld-ltext'); m.textContent = t; svg.appendChild(m); const w = m.getComputedTextLength(); m.remove(); if (w > 0) return w; } catch (e) { /* */ } return t.length * 6.2; };
  const placeLabel = (i) => {
    const p = spec.parts[i]; if (!p.label) return null;
    let bb; try { bb = groups[i].getBBox(); } catch (e) { return null; }
    if (!bb || (!bb.width && !bb.height)) return null;
    const txt = `${i + 1} ${p.label}`, w = textW(txt) + LABEL_PAD * 2, h = LABEL_FONT + LABEL_PAD * 2;
    const cx = bb.x + bb.width / 2, cy = bb.y + bb.height / 2;
    let best = null;
    for (const gap of [8, 18, 32, 50, 72]) {
      const cands = [[bb.x + bb.width + gap, cy - h / 2], [bb.x - gap - w, cy - h / 2], [cx - w / 2, bb.y - gap - h], [cx - w / 2, bb.y + bb.height + gap],
        [bb.x + bb.width + gap, bb.y - gap - h], [bb.x - gap - w, bb.y - gap - h], [bb.x + bb.width + gap, bb.y + bb.height + gap], [bb.x - gap - w, bb.y + bb.height + gap]];
      for (const [x, y] of cands) {
        const r = { x, y, w, h };
        if (x < 2 || y < 2 || x + w > 398 || y + h > 258) continue;
        if (taken.some((q) => hits(r, q))) continue;
        best = r; break;
      }
      if (best) break;
    }
    if (!best) { // (no free spot: inside the part, still clear of the other names if it can)
      const r = { x: Math.min(398 - w, Math.max(2, cx - w / 2)), y: Math.min(258 - h, Math.max(2, cy - h / 2)), w, h };
      for (let k = 0; k < 20 && taken.some((q) => hits(r, q)); k++) r.y = Math.min(258 - h, r.y + h + 2) === r.y ? Math.max(2, r.y - (h + 2) * (k + 1)) : r.y + h + 2;
      best = r;
    }
    taken.push(best);
    // the leader: from the label's nearest side to the nearest point of the part's box
    const lx = Math.min(Math.max(cx, best.x), best.x + best.w), ly = Math.min(Math.max(cy, best.y), best.y + best.h);
    const px = Math.min(Math.max(lx, bb.x), bb.x + bb.width), py = Math.min(Math.max(ly, bb.y), bb.y + bb.height);
    const g = document.createElementNS(NS, 'g'); g.setAttribute('class', 'ld-label'); g.dataset.i = i;
    const lead = document.createElementNS(NS, 'line'); lead.setAttribute('x1', lx); lead.setAttribute('y1', ly); lead.setAttribute('x2', px); lead.setAttribute('y2', py); lead.setAttribute('class', 'ld-lead');
    const bg = document.createElementNS(NS, 'rect'); bg.setAttribute('x', best.x); bg.setAttribute('y', best.y); bg.setAttribute('width', best.w); bg.setAttribute('height', best.h); bg.setAttribute('rx', 4); bg.setAttribute('class', 'ld-lbg');
    const t = document.createElementNS(NS, 'text'); t.setAttribute('x', best.x + LABEL_PAD); t.setAttribute('y', best.y + LABEL_PAD + LABEL_FONT - 2); t.setAttribute('font-size', LABEL_FONT); t.setAttribute('class', 'ld-ltext'); t.dataset.full = txt;
    if (Math.hypot(px - lx, py - ly) < 3) lead.setAttribute('hidden', '');
    g.append(lead, bg, t); labels.appendChild(g);
    return { g, t, txt };
  };
  const hintText = 'Tap a part to hear about it';
  hint.textContent = hintText;
  let picked = -1;
  const pick = (i) => {
    picked = picked === i ? -1 : i;
    groups.forEach((g, k) => g.classList.toggle('dim', picked >= 0 && k !== picked));
    view.onPick && view.onPick(picked >= 0 ? spec.parts[picked] : null);
  };
  groups.forEach((g, i) => { g.addEventListener('click', (e) => { e.stopPropagation(); pick(i); }); });
  svg.addEventListener('click', () => { if (picked >= 0) pick(picked); });
  let labelEls = [];
  const clearLabels = () => { labels.replaceChildren(); taken.length = 0; labelEls = []; };
  const placeAll = () => { clearLabels(); labelEls = groups.map((_, i) => placeLabel(i)); labelEls.forEach((l) => { if (l) l.t.textContent = l.txt; }); return labelEls.some(Boolean) || !spec.parts.some((p) => p.label); };
  const view = {
    hintText,
    get strokes() { return groups.flatMap((g) => [...g.children]); },
    async play(again) {
      if (!animate && !again) { // (finished: the names go on once the drawing has a size; a hidden chat measures as nothing)
        if (!placeAll()) { let tries = 0; const retry = () => { if (placeAll() || ++tries > 120 || (!svg.isConnected && tries > 5)) return; setTimeout(retry, 250); }; setTimeout(retry, 250); }
        return;
      }
      clearLabels();
      // everything hidden, then drawn: every stroke on its own, in order (0.3 to 0.6 s each, by its length)
      const all = groups.flatMap((g) => [...g.children]);
      all.forEach((n) => { n.style.visibility = 'hidden'; });
      if (spec.intro) await setSay(spec.intro, true);
      for (let i = 0; i < groups.length; i++) {
        const talk = setSay(spec.parts[i].say || spec.parts[i].label, true);
        for (const n of groups[i].children) {
          n.style.visibility = '';
          if (n.tagName === 'text') { const full = n.textContent; n.textContent = ''; for (let k = 1; k <= full.length; k++) { n.textContent = full.slice(0, k); await sleep(22); } continue; }
          let L = 200; try { L = Math.max(8, Math.ceil(n.getTotalLength())); } catch (e) { /* */ }
          const dur = Math.round(Math.min(600, Math.max(300, L * 1.4)));
          n.style.strokeDasharray = L; n.style.strokeDashoffset = L; n.style.fillOpacity = '0'; n.dataset.drawing = '1';
          void n.getBoundingClientRect();
          n.style.transition = `stroke-dashoffset ${dur}ms ease-in-out, fill-opacity .35s ease ${dur}ms`;
          n.style.strokeDashoffset = '0'; n.style.fillOpacity = '';
          await sleep(dur);
          delete n.dataset.drawing; n.dataset.drawn = '1';
          n.style.strokeDasharray = n.classList.contains('ld-flow') ? '' : ''; n.style.strokeDashoffset = ''; n.style.transition = '';
        }
        // the part's name writes on after its last stroke
        const l = placeLabel(i); labelEls.push(l);
        if (l) { for (let k = 1; k <= l.txt.length; k++) { l.t.textContent = l.txt.slice(0, k); await sleep(28); } l.g.dataset.done = '1'; }
        await talk; await sleep(250);
      }
    },
  };
  return view;
}
function shape2d(s, p) {
  const t = String(s.t || s.type || '').toLowerCase();
  const n = (k, d = 0) => num(s[k], -50, 450, d);
  const mk = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
  const paint = (e) => {
    const fill = s.fill === true ? p.color : typeof s.fill === 'string' && /^#[0-9a-f]{3,8}$/i.test(s.fill) ? s.fill : null;
    e.setAttribute('fill', fill || 'none'); if (fill) e.setAttribute('fill-opacity', '.18');
    e.setAttribute('stroke', typeof s.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(s.color) ? color(s.color, 0) : 'currentColor');
    e.setAttribute('stroke-width', num(s.w, 1, 6, 2)); e.setAttribute('stroke-linecap', 'round'); e.setAttribute('stroke-linejoin', 'round');
    if (s.dash) e.setAttribute('stroke-dasharray', '6 6');
    return e;
  };
  if (t === 'path' && typeof s.d === 'string' && PATH_OK.test(s.d)) return paint(mk('path', { d: s.d }));
  if (t === 'line') return paint(mk('line', { x1: n('x1'), y1: n('y1'), x2: n('x2'), y2: n('y2') }));
  if (t === 'arrow') { const e = paint(mk('line', { x1: n('x1'), y1: n('y1'), x2: n('x2'), y2: n('y2') })); e.setAttribute('marker-end', 'url(#ld-head)'); return e; }
  if (t === 'rect') return paint(mk('rect', { x: n('x'), y: n('y'), width: num(s.w2 ?? s.width ?? s.wd, 1, 400, 40), height: num(s.h, 1, 260, 30), rx: num(s.r, 0, 60, 2) }));
  if (t === 'circle') return paint(mk('circle', { cx: n('cx', 200), cy: n('cy', 130), r: num(s.r, 1, 200, 20) }));
  if (t === 'ellipse') return paint(mk('ellipse', { cx: n('cx', 200), cy: n('cy', 130), rx: num(s.rx, 1, 200, 30), ry: num(s.ry, 1, 200, 20) }));
  if (t === 'poly' && Array.isArray(s.pts)) { const pts = s.pts.slice(0, 60).map((q) => `${num(q && q[0], -50, 450)},${num(q && q[1], -50, 450)}`).join(' '); return paint(mk('polyline', { points: pts })); }
  if (t === 'text') { const e = mk('text', { x: n('x'), y: n('y'), class: 'ld-word', 'font-size': num(s.size, 8, 22, 12) }); e.textContent = words(s.text ?? s.s, 60); return e; }
  return null;
}

// ---------- a picture of a finished drawing (for Cassie to check her own work) ----------
export async function snapshot(rawSpec) {
  const spec = clean(rawSpec); if (!spec) return null;
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:640px;pointer-events:none;';
  host.className = 'ld-shot'; host.setAttribute('aria-hidden', 'true');
  document.body.appendChild(host);
  try {
    await render(host, spec, { animate: false });
    await sleep(spec.mode === '3d' ? 900 : 120);
    const canvas = host.querySelector('canvas');
    if (canvas) { try { return canvas.toDataURL('image/png'); } catch (e) { return null; } }
    const svg = host.querySelector('svg'); if (!svg) return null;
    const c2 = svg.cloneNode(true);
    const bg = lightPage() ? '#ffffff' : '#141417', ink = lightPage() ? '#111111' : '#f2f2f5';
    c2.setAttribute('width', 800); c2.setAttribute('height', 520);
    c2.querySelectorAll('.ld-ltext, .ld-word').forEach((t) => { t.setAttribute('fill', ink); t.setAttribute('font-family', 'Arial, sans-serif'); });
    c2.querySelectorAll('.ld-lbg').forEach((r) => { r.setAttribute('fill', bg); r.setAttribute('stroke', '#888'); });
    c2.querySelectorAll('.ld-lead').forEach((l) => l.setAttribute('stroke', '#888'));
    c2.querySelectorAll('.ld-part').forEach((g) => { const col = g.style.color; g.querySelectorAll('[stroke="currentColor"]').forEach((x) => x.setAttribute('stroke', col)); g.querySelectorAll('[fill="currentColor"]').forEach((x) => x.setAttribute('fill', col)); });
    c2.insertBefore(Object.assign(document.createElementNS(NS, 'rect'), {}), c2.firstChild).setAttribute('fill', bg);
    const r0 = c2.firstChild; r0.setAttribute('x', 0); r0.setAttribute('y', 0); r0.setAttribute('width', 400); r0.setAttribute('height', 260);
    const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(c2));
    const img = new Image(); await new Promise((res) => { img.onload = res; img.onerror = res; img.src = url; });
    const cv = document.createElement('canvas'); cv.width = 800; cv.height = 520; cv.getContext('2d').drawImage(img, 0, 0, 800, 520);
    return cv.toDataURL('image/png');
  } catch (e) { return null; } finally { host.remove(); }
}

// ---------- 3D models: built piece by piece ----------
let three = null;
const loadThree = () => (three || (three = Promise.all([import('./explore/three.module.min.js'), import('./explore/OrbitControls.js')]).then(([T, oc]) => ({ T, OrbitControls: oc.OrbitControls }))));
const glOk = () => { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; } };
async function draw3d(stage, spec, { animate, setSay, hint }) {
  if (!glOk()) return null;
  let lib; try { lib = await loadThree(); } catch (e) { return null; }
  const { T, OrbitControls } = lib;
  const W = () => stage.clientWidth || 340, H = () => stage.clientHeight || 260;
  const renderer = new T.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); renderer.setSize(W(), H()); renderer.outputColorSpace = T.SRGBColorSpace;
  const canvas = renderer.domElement; canvas.className = 'ld-canvas'; canvas.style.touchAction = 'none'; stage.prepend(canvas);
  const tags = el('div', 'ld-tags'); stage.appendChild(tags);
  const scene = new T.Scene(), cam = new T.PerspectiveCamera(34, W() / H(), 0.05, 200);
  scene.add(new T.HemisphereLight(0xe4ecff, 0x1a1a22, 1.15));
  const sun = new T.DirectionalLight(0xffffff, 1.7); sun.position.set(4, 6, 5); scene.add(sun);
  const rim = new T.DirectionalLight(0x8fb4ff, .6); rim.position.set(-5, -2, -4); scene.add(rim);
  const controls = new OrbitControls(cam, canvas); controls.enableDamping = true; controls.enablePan = false; controls.minDistance = 2; controls.maxDistance = 40;
  const model = new T.Group(); scene.add(model);
  const AX = { x: new T.Vector3(1, 0, 0), y: new T.Vector3(0, 1, 0), z: new T.Vector3(0, 0, 1) };
  const v3 = (a, d = [0, 0, 0]) => (Array.isArray(a) ? new T.Vector3(num(a[0], -20, 20, d[0]), num(a[1], -20, 20, d[1]), num(a[2], -20, 20, d[2])) : new T.Vector3(...d));
  // a shape along an axis: three.js builds cylinders and cones along y, so turn them to x or z
  const along = (obj, axis) => { if (axis === 'x') obj.rotation.z = -Math.PI / 2; else if (axis === 'z') obj.rotation.x = Math.PI / 2; return obj; };
  const groups = spec.parts.map((p, i) => {
    const g = new T.Group(); g.userData = { i, part: p };
    const mat = new T.MeshStandardMaterial({ color: new T.Color(p.color), metalness: .5, roughness: .4, side: T.DoubleSide, transparent: true, opacity: 1, emissive: p.glow ? new T.Color(p.color) : new T.Color(0x000000), emissiveIntensity: p.glow ? .55 : 0 });
    for (const s of p.shapes) { const m = shape3d(T, s, mat, along, v3, AX); if (m) g.add(m); }
    model.add(g);
    return g;
  }).filter((g) => g.children.length);
  if (!groups.length) { renderer.dispose(); canvas.remove(); return null; }
  // fit the camera to the whole model
  const box = new T.Box3().setFromObject(model), size = box.getSize(new T.Vector3()), mid = box.getCenter(new T.Vector3());
  model.position.sub(mid); model.updateMatrixWorld(true);
  const R = Math.max(size.x, size.y, size.z, 1);
  const home = new T.Vector3(R * .55, R * .38, R * 1.02);
  cam.position.copy(home); controls.target.set(0, 0, 0); controls.update();
  // where each part sits (for its name tag, and for pulling it apart along the main axis)
  const ax = AX[spec.axis];
  groups.forEach((g) => { const b = new T.Box3().setFromObject(g); g.userData.center = b.getCenter(new T.Vector3()); g.userData.home = g.position.clone(); });
  const order = groups.filter((g) => !g.userData.part.shell).sort((a, b) => a.userData.center.dot(ax) - b.userData.center.dot(ax));
  const tagEls = groups.map((g, i) => { const p = g.userData.part; if (!p.label) return null; const t = el('button', 'ld-tag', `${spec.parts.indexOf(p) + 1} ${p.label}`); t.type = 'button'; t.hidden = true; t.addEventListener('click', (e) => { e.stopPropagation(); pick(g); }); tags.appendChild(t); return t; });
  let exploded = false, opened = false, picked = null, raf = 0, last = performance.now(), visible = true;
  const shells = groups.filter((g) => g.userData.part.shell);
  const fade = (g, o) => g.traverse((m) => { if (m.material) { m.material.opacity = o; m.material.depthWrite = o > .6; } });
  const hintText = 'Drag to turn it. Pinch to zoom. Tap a part';
  hint.textContent = hintText;
  const pick = (g) => {
    picked = picked === g ? null : g;
    groups.forEach((x) => fade(x, picked && x !== picked ? .16 : x.userData.part.shell && (opened || exploded) ? .14 : 1));
    view.onPick && view.onPick(picked ? picked.userData.part : null);
  };
  // a tap (not a drag) picks the part under the finger
  const ray = new T.Raycaster(), pt = new T.Vector2(); let down = null;
  canvas.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
  canvas.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return;
    const r = canvas.getBoundingClientRect(); pt.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(pt, cam);
    const hits = ray.intersectObjects(groups.filter((g) => g.visible && !(g.userData.part.shell && (opened || exploded))), true);
    let g = hits.length ? hits[0].object : null; while (g && !groups.includes(g)) g = g.parent;
    if (g) pick(g); else if (picked) pick(picked);
  });
  const tmp = new T.Vector3();
  const tick = (now) => {
    raf = requestAnimationFrame(tick);
    if (!visible) return;
    const dt = Math.min(.05, (now - last) / 1000); last = now;
    if (!still()) groups.forEach((g) => { if (g.userData.part.spin && g.visible) g.rotation[spec.axis] += dt * 3; });
    groups.forEach((g) => { const to = g.userData.to; if (to) { g.position.lerp(to, Math.min(1, dt * 6)); if (g.position.distanceTo(to) < .002) { g.position.copy(to); g.userData.to = null; } } });
    controls.update();
    renderer.render(scene, cam);
    const spots = [];
    groups.forEach((g, i) => {
      const t = tagEls[i]; if (!t) return;
      if (!g.visible || (g.userData.part.shell && (opened || exploded))) { t.hidden = true; return; }
      t.hidden = false; tmp.copy(g.userData.center).add(g.position).sub(g.userData.home); tmp.project(cam);
      const x = (tmp.x + 1) / 2 * W(), up = spots.length % 2 === 0, tw = t.offsetWidth || 80;
      let y = (1 - tmp.y) / 2 * H() + (up ? -34 : 34);
      for (let k = 0; k < 6 && spots.some((q) => Math.abs(q.x - x) < (q.w + tw) / 2 + 4 && Math.abs(q.y - y) < 30); k++) y += up ? -30 : 30;
      y = Math.min(H() - 16, Math.max(16, y)); spots.push({ x, y, w: tw });
      t.style.left = Math.min(W() - tw / 2 - 4, Math.max(tw / 2 + 4, x)) + 'px'; t.style.top = y + 'px';
    });
  };
  raf = requestAnimationFrame(tick);
  const io = 'IntersectionObserver' in window ? new IntersectionObserver((en) => { visible = en.some((x) => x.isIntersecting); }) : null; if (io) io.observe(stage);
  const ro = 'ResizeObserver' in window ? new ResizeObserver(() => { renderer.setSize(W(), H()); cam.aspect = W() / H(); cam.updateProjectionMatrix(); }) : null; if (ro) ro.observe(stage);
  const gone = new MutationObserver(() => { if (!stage.isConnected) { cancelAnimationFrame(raf); renderer.dispose(); io && io.disconnect(); ro && ro.disconnect(); gone.disconnect(); } });
  gone.observe(document.body, { childList: true, subtree: true });
  const view = {
    hintText,
    async play(again) {
      if (!animate && !again) return;
      groups.forEach((g) => { g.visible = false; g.scale.setScalar(.6); });
      if (spec.intro) await setSay(spec.intro, true);
      for (const g of groups) {
        const sh = g.userData.part.shell;
        g.visible = true;
        const t0 = performance.now();
        await new Promise((res) => { const step = () => { const k = Math.min(1, (performance.now() - t0) / 550); const e = 1 - Math.pow(1 - k, 3); g.scale.setScalar(.6 + .4 * e); fade(g, sh ? Math.min(e, .14) : e); if (k < 1) requestAnimationFrame(step); else res(); }; requestAnimationFrame(step); });
        await setSay(g.userData.part.say || g.userData.part.label, true);
        await sleep(450);
      }
    },
    get opened() { return opened; },
    setOpen(v) { opened = !!v; shells.forEach((g) => fade(g, opened ? .14 : 1)); },
    open: shells.length ? () => { opened = !opened; if (picked) pick(picked); shells.forEach((g) => fade(g, opened ? .14 : 1)); return opened; } : null,
    explode: order.length > 1 ? () => {
      exploded = !exploded; if (picked) pick(picked);
      const gap = R * .32, n = order.length;
      order.forEach((g, k) => { g.userData.to = exploded ? g.userData.home.clone().addScaledVector(ax, (k - (n - 1) / 2) * gap) : g.userData.home.clone(); });
      shells.forEach((g) => { g.visible = !exploded; });
      const far = home.clone().multiplyScalar(exploded ? 1.45 : 1); cam.position.copy(far); controls.update();
      return exploded;
    } : null,
  };
  return view;
}
function shape3d(T, s, mat, along, v3, AX) {
  const t = String(s.t || s.type || '').toLowerCase();
  const axis = ['x', 'y', 'z'].includes(s.axis) ? s.axis : 'x';
  const r = num(s.r, .02, 8, .5), len = num(s.len ?? s.h, .02, 20, 1);
  let m = null;
  const own = s.color && /^#[0-9a-f]{3,8}$/i.test(s.color) ? Object.assign(mat.clone(), { color: new T.Color(s.color) }) : mat;
  if (t === 'cylinder' || t === 'tube' || t === 'disc') {
    const r2 = num(s.r2, .02, 8, r), h = t === 'disc' ? num(s.thick ?? s.len, .01, 2, .08) : len;
    const open = !!s.open, arc = s.cut ? Math.PI * 1.4 : Math.PI * 2;
    m = along(new T.Mesh(new T.CylinderGeometry(r2, r, h, 48, 1, open, s.cut ? Math.PI * .2 : 0, arc), own), axis);
  } else if (t === 'cone') {
    const g = new T.Mesh(new T.ConeGeometry(r, len, 40), own);
    if (axis === 'x') g.rotation.z = (s.dir === -1 ? 1 : -1) * Math.PI / 2; else if (axis === 'z') g.rotation.x = (s.dir === -1 ? -1 : 1) * Math.PI / 2; else if (s.dir === -1) g.rotation.z = Math.PI;
    m = g;
  } else if (t === 'sphere') m = new T.Mesh(new T.SphereGeometry(r, 40, 28, 0, s.cut ? Math.PI * 1.5 : Math.PI * 2), own);
  else if (t === 'box') { const sz = Array.isArray(s.size) ? s.size : [1, 1, 1]; m = new T.Mesh(new T.BoxGeometry(num(sz[0], .02, 20, 1), num(sz[1], .02, 20, 1), num(sz[2], .02, 20, 1)), own); }
  else if (t === 'torus' || t === 'ring') { m = new T.Mesh(new T.TorusGeometry(r, num(s.tube, .01, 4, .12), 18, 56), own); if (axis === 'x') m.rotation.y = Math.PI / 2; else if (axis === 'y') m.rotation.x = Math.PI / 2; }
  else if (t === 'blades') {
    m = new T.Group(); const n = Math.round(num(s.n, 2, 40, 12)), bl = num(s.len, .05, 8, r), wd = num(s.width, .02, 2, .18);
    for (let i = 0; i < n; i++) { const b = new T.Mesh(new T.BoxGeometry(.04, bl, wd), own); b.position.y = bl / 2 + num(s.hub, 0, 4, .12); b.rotation.y = .5; const p = new T.Group(); p.add(b); p.rotation.x = i / n * Math.PI * 2; m.add(p); }
    if (axis === 'y') m.rotation.z = Math.PI / 2; else if (axis === 'z') m.rotation.y = Math.PI / 2;
  }
  if (!m) return null;
  m.position.copy(v3(s.pos));
  if (Array.isArray(s.rot)) m.rotation.set(m.rotation.x + num(s.rot[0], -7, 7), m.rotation.y + num(s.rot[1], -7, 7), m.rotation.z + num(s.rot[2], -7, 7));
  return m;
}

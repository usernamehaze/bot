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
let paperLight = null; // (a drawing on a card with its own paper, like the extension's: its light or dark, not the page's)
const lightPage = () => { if (paperLight != null) return paperLight; try { const m = getComputedStyle(document.body).backgroundColor.match(/[\d.]+/g); return m && (.2126 * m[0] + .7152 * m[1] + .0722 * m[2]) / 255 > .6; } catch (e) { return false; } };
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
    anchor: mode === '2d' && Array.isArray(p && p.anchor) && p.anchor.length === 2 && Number.isFinite(+p.anchor[0]) && Number.isFinite(+p.anchor[1]) ? [num(p.anchor[0], 0, 400), num(p.anchor[1], 0, 260)] : null,
    glow: !!(p && p.glow), spin: !!(p && p.spin), shell: !!(p && p.shell),
    finish: ['metal', 'plastic', 'rubber', 'wood'].includes(p && p.finish) ? p.finish : null, // (3d) what it is really made of
    // (3d) her plan for the part: what it sits inside, its real size against the whole, what it touches
    inside: mode === '3d' ? words(p && p.inside, 40) || null : null,
    size: mode === '3d' && Number.isFinite(+(p && p.size)) && +p.size > 0 ? Math.min(1, +p.size) : null,
    attached: mode === '3d' && Array.isArray(p && p.attached) ? p.attached.slice(0, 6).map((x) => words(x, 40)).filter(Boolean) : [],
    // (3d, for something that is put together) where the part starts before it slides into its place, as an offset; and the side to look from
    from: mode === '3d' && Array.isArray(p && p.from) && p.from.length === 3 && p.from.every((v) => Number.isFinite(+v)) ? p.from.map((v) => num(v, -12, 12)) : null,
    view: mode === '3d' && ['front', 'back', 'left', 'right', 'side', 'top'].includes(p && p.view) ? p.view : null,
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
// (round by nature: a plain circle is the real shape)
const ROUND_THINGS = /\b(?:sun|moon|star|planet|earth|ball|atom|nucleus|drop|droplet|bubble|molecule|wheel|coin|pupil|egg|cell\s+membrane|o2|co2|h2o|ion|electron|proton|neutron)\b/i;
// the box of a part's main shape: the shape its anchor sits in, else its first shape
function shapeOf(p) {
  const boxes = p.shapes.map((sh) => { const pts = shapePoints(sh).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y)); if (!pts.length) return null; const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; });
  if (p.anchor) { const hit = boxes.find((b) => b && p.anchor[0] >= b[0] - 6 && p.anchor[0] <= b[2] + 6 && p.anchor[1] >= b[1] - 6 && p.anchor[1] <= b[3] + 6); if (hit) return hit; }
  return boxes.find(Boolean) || null;
}
export function check(spec) {
  const out = [];
  if (spec && spec.mode === '3d') return check3d(spec);
  if (!spec || spec.mode !== '2d') return out;
  const boxes = [];
  for (const p of spec.parts) {
    const pts = p.shapes.flatMap(shapePoints).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
    const strokes = p.shapes.filter((x) => String(x.t || x.type).toLowerCase() !== 'text').length;
    if (!pts.length) { out.push(`"${p.label || p.id}" has no shape the picture can show, so its label points at nothing`); continue; }
    if (pts.some(([x, y]) => x < -6 || x > 406 || y < -6 || y > 266)) out.push(`"${p.label || p.id}" goes outside the 400 by 260 picture`);
    if (strokes < 2) out.push(`"${p.label || p.id}" is a single line or shape; draw its real outline and inner lines`);
    const kinds = p.shapes.map((x) => String(x.t || x.type).toLowerCase());
    if (strokes >= 2 && !kinds.some((k) => k === 'path' || k === 'poly' || k === 'line' || k === 'arrow') && !ROUND_THINGS.test(p.label || p.id)) out.push(`"${p.label || p.id}" is only plain circles or boxes; draw its real outline with a path (for a leaf: a pointed tip, a midrib and side veins)`);
    if (p.anchor) { const sh = shapeOf(p); if (sh) { const [x0, y0, x1, y1] = sh; if (p.anchor[0] < x0 - 6 || p.anchor[0] > x1 + 6 || p.anchor[1] < y0 - 6 || p.anchor[1] > y1 + 6) out.push(`the anchor of "${p.label || p.id}" is not on its own main shape`); } }
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

// ---------- is it a good model? (3d) her own plan against the shapes she placed, for any subject ----------
// Each shape's box (roughly, from its size and axis): a part's box is all its shapes; the model's is all parts.
const n3 = (v, d) => (Number.isFinite(+v) ? +v : d);
function box3(s) {
  const t = String(s.t || s.type || '').toLowerCase(), axis = ['x', 'y', 'z'].includes(s.axis) ? s.axis : 'x';
  const pos = Array.isArray(s.pos) ? [0, 1, 2].map((k) => n3(s.pos[k], 0)) : [0, 0, 0];
  const r = Math.abs(n3(s.r, .5)), len = Math.abs(n3(s.len ?? s.h, 1));
  let along = 0, across = 0, half = null;
  if (t === 'cylinder' || t === 'tube') { along = len / 2; across = Math.max(r, Math.abs(n3(s.r2, r))); }
  else if (t === 'disc') { along = Math.abs(n3(s.thick ?? s.len, .08)) / 2; across = r; }
  else if (t === 'cone') { along = len / 2; across = r; }
  else if (t === 'torus' || t === 'ring') { const tb = Math.abs(n3(s.tube, .12)); along = tb; across = r + tb; }
  else if (t === 'blades') { along = Math.abs(n3(s.width, .18)) / 2; across = Math.abs(n3(s.hub, .12)) + Math.abs(n3(s.len, r)); }
  else if (t === 'sphere') half = [r, r, r];
  else if (t === 'box') { const sz = Array.isArray(s.size) ? s.size : [1, 1, 1]; half = [0, 1, 2].map((k) => Math.abs(n3(sz[k], 1)) / 2); }
  else if (t === 'capsule') { along = len / 2 + r; across = r; }
  else if (t === 'pipe' || t === 'arrow') { // (a tube through points: the box around them)
    const pts = pts3(s.pts), w = Math.abs(n3(s.r, .06));
    if (pts.length < 2) return null;
    return [0, 1, 2].map((k) => pos[k] + Math.min(...pts.map((q) => q[k])) - w).concat([0, 1, 2].map((k) => pos[k] + Math.max(...pts.map((q) => q[k])) + w));
  } else if (t === 'lathe' || t === 'plate') { // (a turned profile [radius, along]; a flat plate with an outline across its axis)
    const pr = pts2(t === 'lathe' ? s.profile : s.outline);
    if (pr.length < (t === 'lathe' ? 2 : 3)) return null;
    const lo = [Math.min(...pr.map((q) => q[0])), Math.min(...pr.map((q) => q[1]))], hi = [Math.max(...pr.map((q) => q[0])), Math.max(...pr.map((q) => q[1]))];
    const k = { x: 0, y: 1, z: 2 }[axis], b = [0, 0, 0, 0, 0, 0];
    if (t === 'lathe') { [0, 1, 2].forEach((j) => { b[j] = j === k ? lo[1] : -hi[0]; b[j + 3] = j === k ? hi[1] : hi[0]; }); }
    else { const th = Math.abs(n3(s.thick, .1)) / 2, u = axis === 'x' ? 2 : 0, v = axis === 'y' ? 2 : 1; b[k] = -th; b[k + 3] = th; b[u] = lo[0]; b[u + 3] = hi[0]; b[v] = lo[1]; b[v + 3] = hi[1]; }
    return b.map((x, j) => x + pos[j % 3]);
  }
  else return null;
  if (!half) half = ['x', 'y', 'z'].map((a) => (a === axis ? along : across));
  return [pos[0] - half[0], pos[1] - half[1], pos[2] - half[2], pos[0] + half[0], pos[1] + half[1], pos[2] + half[2]];
}
// points the AI wrote, kept only when they are numbers: [[x,y,z],...] (up to 10) and [[a,b],...] (up to 24)
const pts3 = (list) => (Array.isArray(list) ? list : []).slice(0, 10).filter((q) => Array.isArray(q) && q.length === 3 && q.every((v) => Number.isFinite(+v))).map((q) => q.map((v) => num(v, -20, 20)));
const pts2 = (list) => (Array.isArray(list) ? list : []).slice(0, 24).filter((q) => Array.isArray(q) && q.length === 2 && q.every((v) => Number.isFinite(+v))).map((q) => q.map((v) => num(v, -20, 20)));
const join3 = (bs) => bs.reduce((a, b) => (a ? [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2]), Math.max(a[3], b[3]), Math.max(a[4], b[4]), Math.max(a[5], b[5])] : b.slice()), null);
const gap3 = (a, b) => Math.hypot(...[0, 1, 2].map((k) => Math.max(0, a[k] - b[k + 3], b[k] - a[k + 3])));
const long3 = (b) => Math.max(b[3] - b[0], b[4] - b[1], b[5] - b[2]);
export function check3d(spec) {
  const out = [];
  const parts = spec.parts.map((p) => ({ p, b: join3(p.shapes.map(box3).filter(Boolean)) }));
  parts.filter((x) => !x.b).forEach((x) => out.push(`"${x.p.label || x.p.id}" has no 3d shape the model can show`));
  const ok = parts.filter((x) => x.b);
  if (!ok.length) return out;
  const all = join3(ok.map((x) => x.b)), L = long3(all) || 1;
  const name = (x) => `"${x.p.label || x.p.id}"`, byId = (id) => ok.find((x) => x.p.id === id || x.p.label === id);
  if (L > 12 || L < 2) out.push(`the whole model is ${L.toFixed(1)} units long; make it about 6 units, centred on 0,0,0`);
  if (ok.some((x) => x.p.size == null)) out.push('plan every part first: give each part "size" (how big it really is, its longest side, against the whole object, 0 to 1) and "inside" (the id of the part it sits in, or null)');
  for (const x of ok) {
    const others = ok.filter((y) => y !== x);
    // nothing floats: every part touches or sits in another part
    if (others.length && Math.min(...others.map((y) => gap3(x.b, y.b))) > L * .08) out.push(`${name(x)} floats apart from the rest; in the real object it touches or sits inside the part it connects to, so move it there`);
    // inside what she said it is inside
    const home = x.p.inside && byId(x.p.inside);
    if (home && home !== x) { const pad = L * .04, b = x.b, h = home.b; if (b[0] < h[0] - pad || b[1] < h[1] - pad || b[2] < h[2] - pad || b[3] > h[3] + pad || b[4] > h[4] + pad || b[5] > h[5] + pad) out.push(`${name(x)} should sit inside ${name(home)} (your plan says so) but it sticks out of it; make it smaller or move it in`); }
    // as big as she planned
    if (x.p.size != null) { const real = long3(x.b) / L, want = x.p.size; if (real > want * 1.8 + .06 || real < want / 1.8 - .06) out.push(`${name(x)} is drawn at ${Math.round(real * 100)}% of the whole object's size, but your plan says ${Math.round(want * 100)}%; give it its real size`); }
    // touching what she said it is attached to
    for (const id of x.p.attached) { const y = byId(id); if (y && y !== x && gap3(x.b, y.b) > L * .05) out.push(`${name(x)} should touch ${name(y)} but there is a gap between them`); }
  }
  return [...new Set(out)].slice(0, 10);
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
  // (v253) a compact row: a small icon and a short word each, muted; the tap area stays 48px
  const ICON = { redo: '<path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4"/>', quiz: '<path d="M9 9a3 3 0 1 1 4 2.8c-.7.3-1 .8-1 1.5V14M12 17.5h.01"/><circle cx="12" cy="12" r="9"/>', photo: '<path d="M4 7.5h3l1.6-2.5h6.8L17 7.5h3a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8.5a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.5"/>', ask: '<path d="M4 5h16v11H9l-5 4z"/>', change: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>', open: '<path d="M4 12h16M12 4v16"/>', apart: '<path d="M4 12h5M15 12h5M7 9l-3 3 3 3M17 9l3 3-3 3"/>' };
  const btn = (label, fn, cls = '', icon = '') => { const b = el('button', 'ld-btn ' + cls); b.type = 'button'; if (icon && ICON[icon]) b.insertAdjacentHTML('afterbegin', `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON[icon]}</svg>`); b.appendChild(el('span', '', label)); b.addEventListener('click', fn); acts.appendChild(b); return b; };
  const setLabel = (b, t) => { b.querySelector('span').textContent = t; };
  const done = () => { dot.classList.add('off'); state.textContent = spec.mode === '3d' ? 'Cassie built it in 3D' : 'Cassie drew it'; setSay(spec.summary || spec.intro || ''); host.dispatchEvent(new CustomEvent('ld-done')); };
  if (view) {
    if (view.open) { const ob = btn('Open it up', () => { const on = view.open(); setLabel(ob, on ? 'Close the case' : 'Open it up'); ob.setAttribute('aria-pressed', String(on)); }, 'ld-open', 'open'); ob.setAttribute('aria-pressed', 'false'); }
    if (view.explode) { const pb = btn('Pull apart', () => { const on = view.explode(); setLabel(pb, on ? 'Put it back' : 'Pull apart'); pb.setAttribute('aria-pressed', String(on)); }, '', 'apart'); pb.setAttribute('aria-pressed', 'false'); }
    btn('Draw again', async () => { await view.play(true); done(); }, '', 'redo');
  }
  if (opts.onQuiz) btn('Quiz me', () => opts.onQuiz(spec), '', 'quiz');
  if (opts.onRealistic && (!opts.canRealistic || opts.canRealistic())) btn('Real photo', () => opts.onRealistic(spec), 'ld-photo', 'photo');
  if (opts.onChange) btn('Show another way', () => opts.onChange(spec), 'ld-change', 'change');
  if (view) {
    view.onPick = (p) => {
      if (!p) { setSay(spec.summary || spec.intro || ''); hint.textContent = view.hintText; askBtn.hidden = true; return; }
      setSay(p.say || p.label); hint.textContent = `${p.label}. Tap it again, or tap the empty space, to see it all`;
      askBtn.hidden = !opts.onAsk; setLabel(askBtn, `Ask about the ${p.label}`); askBtn.onclick = () => opts.onAsk(p, spec);
    };
    const askBtn = btn('', () => {}, 'ld-askpart', 'ask'); askBtn.hidden = true;
    if (spec.mode === '3d' && view.setOpen && view.open) { view.setOpen(true); const ob = acts.querySelector('.ld-open'); if (ob) { setLabel(ob, 'Close the case'); ob.setAttribute('aria-pressed', 'true'); } }
    if (animate) { await view.play(); done(); } else { await view.play(); done(); }
  }
  return true;
}

// ---------- flat drawings: one stroke at a time, like a pen; each part's name writes on after its last stroke ----------
const LABEL_FONT = 13, LABEL_PAD = 4;
let drawings = 0;
function draw2d(stage, spec, { animate, setSay, hint }) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 400 260'); svg.setAttribute('class', 'ld-svg');
  stage.prepend(svg);
  const defs = document.createElementNS(NS, 'defs');
  // (an arrow's head is the colour of its part: one head for each part, named for this drawing alone)
  const headId = `ld-head-${++drawings}-`;
  defs.innerHTML = spec.parts.map((p, i) => `<marker id="${headId}${i}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="${/^#[0-9a-f]{3,8}$/i.test(p.color) ? p.color : 'currentColor'}"/></marker>`).join('');
  svg.appendChild(defs);
  const groups = spec.parts.map((p, i) => {
    const g = document.createElementNS(NS, 'g'); g.setAttribute('class', 'ld-part'); g.style.color = p.color; g.dataset.i = i;
    for (const s of p.shapes) { const n = shape2d(s, p); if (!n) continue; if (n.getAttribute('marker-end')) n.setAttribute('marker-end', `url(#${headId}${i})`); g.appendChild(n); }
    svg.appendChild(g);
    return g;
  });
  const labels = document.createElementNS(NS, 'g'); labels.setAttribute('class', 'ld-labels'); svg.appendChild(labels);
  const legend = el('p', 'ld-legend'); legend.hidden = true; stage.after(legend);
  // (v253) each name points at its part's ANCHOR, a point on that part's main shape (the AI's, else the centre of
  // the part's first shape). Names go in clear space: never over a stroke, a filled shape or a word in the drawing
  // (every element smaller than a third of the picture is an obstacle; a big outline is avoided where it can be),
  // never over another name, inside the picture. Tried in rings around the anchor; then one size smaller; then a
  // small numbered marker on the anchor, with the name under the picture.
  const taken = [];
  const hits = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const textW = (t, fs) => { try { const m = document.createElementNS(NS, 'text'); m.setAttribute('font-size', fs); m.setAttribute('class', 'ld-ltext'); m.textContent = t; svg.appendChild(m); const w = m.getComputedTextLength(); m.remove(); if (w > 0) return w; } catch (e) { /* */ } return t.length * fs * .48; };
  const boxOf = (n) => { try { const b = n.getBBox(); return b && (b.width || b.height) ? { x: b.x - 2, y: b.y - 2, w: b.width + 4, h: b.height + 4 } : null; } catch (e) { return null; } };
  // (v253) the drawing is laid on a 2px grid once: each cell knows which strokes, filled shapes and words cover it
  // (a curved shape by its real outline, a line by its line), so trying a place for a name is only a lookup
  const G = 2, GW = 200, GH = 130;
  let obstacles = null;
  const obstaclesNow = () => {
    const list = [], cells = new Array(GW * GH);
    groups.flatMap((g) => [...g.children]).forEach((n) => {
      const b = boxOf(n); if (!b) return;
      const o = { id: list.length, word: n.tagName === 'text' };
      o.soft = !o.word && n.tagName !== 'line' && b.w * b.h >= 400 * 260 / 3; // (a big outline only costs; the rest block)
      list.push(o);
      const seg = n.tagName === 'line' ? ['x1', 'y1', 'x2', 'y2'].map((k) => +n.getAttribute(k)) : null;
      const filled = (n.getAttribute('fill') || 'none') !== 'none', geo = !o.word && !seg && typeof n.isPointInStroke === 'function';
      const on = (x, y) => {
        if (o.word) return true;
        if (seg) { const [x1, y1, x2, y2] = seg, dx = x2 - x1, dy = y2 - y1, L = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / L)); return Math.hypot(x - x1 - t * dx, y - y1 - t * dy) <= 2.5; }
        if (!geo) return true;
        try { const pt = new DOMPoint(x, y); return (filled && n.isPointInFill(pt)) || n.isPointInStroke(pt); } catch (e) { return true; }
      };
      const hit = [];
      for (let cy = Math.max(0, Math.floor(b.y / G)); cy <= Math.min(GH - 1, Math.floor((b.y + b.h) / G)); cy++) for (let cx = Math.max(0, Math.floor(b.x / G)); cx <= Math.min(GW - 1, Math.floor((b.x + b.w) / G)); cx++) if (on(cx * G + 1, cy * G + 1)) hit.push([cx, cy]);
      hit.forEach(([cx, cy]) => { for (let ey = cy - 1; ey <= cy + 1; ey++) for (let ex = cx - 1; ex <= cx + 1; ex++) { if (ex < 0 || ey < 0 || ex >= GW || ey >= GH) continue; const k = ey * GW + ex; const c = cells[k] || (cells[k] = []); if (c[c.length - 1] !== o.id && !c.includes(o.id)) c.push(o.id); } }); // (a cell of margin round every stroke)
    });
    return { list, cells };
  };
  const idsIn = (box) => { const out = new Set(); for (let cy = Math.max(0, Math.floor(box.y / G)); cy <= Math.min(GH - 1, Math.floor((box.y + box.h) / G)); cy++) for (let cx = Math.max(0, Math.floor(box.x / G)); cx <= Math.min(GW - 1, Math.floor((box.x + box.w) / G)); cx++) { const c = obstacles.cells[cy * GW + cx]; if (c) c.forEach((id) => out.add(id)); } return out; };
  const idsAlong = (sg) => { const out = new Set(), [x1, y1, x2, y2] = sg, n = Math.max(2, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / G)); for (let k = 0; k <= n; k++) { const cx = Math.floor((x1 + (x2 - x1) * k / n) / G), cy = Math.floor((y1 + (y2 - y1) * k / n) / G); const c = cx >= 0 && cy >= 0 && cx < GW && cy < GH && obstacles.cells[cy * GW + cx]; if (c) c.forEach((id) => out.add(id)); } return out; };
  const segHits = (sg, r) => { const [x1, y1, x2, y2] = sg, n = Math.max(2, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 3)); for (let k = 0; k <= n; k++) { const x = x1 + (x2 - x1) * k / n, y = y1 + (y2 - y1) * k / n; if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return true; } return false; };
  const anchorOf = (i) => {
    const p = spec.parts[i];
    if (p.anchor) return p.anchor;
    const first = groups[i].children[0], b = first && boxOf(first);
    return b ? [b.x + b.w / 2, b.y + b.h / 2] : null;
  };
  let markers = 0;
  const placeLabel = (i) => {
    const p = spec.parts[i]; if (!p.label) return null;
    const a = anchorOf(i); if (!a) return null;
    if (!obstacles) obstacles = obstaclesNow();
    const txt = `${i + 1} ${p.label}`;
    const own = idsIn({ x: a[0] - 4, y: a[1] - 4, w: 8, h: 8 }); // (the shape the anchor sits on: its leader may touch it)
    let best = null, fs = LABEL_FONT;
    for (const size of [LABEL_FONT, LABEL_FONT - 2]) {
      const w = textW(txt, size) + LABEL_PAD * 2, h = size + LABEL_PAD * 2;
      let top = null;
      for (let r = 10; r <= 150 && !top; r += 6) {
        for (let k = 0; k < 24; k++) {
          const ang = (k / 24) * Math.PI * 2, cx = a[0] + Math.cos(ang) * r, cy = a[1] + Math.sin(ang) * r;
          const box = { x: cx - w / 2, y: cy - h / 2, w, h };
          if (box.x < 2 || box.y < 2 || box.x + w > 398 || box.y + h > 258) continue;
          if (taken.some((q) => hits(box, q))) continue;
          const inBox = [...idsIn(box)];
          if (inBox.some((id) => !obstacles.list[id].soft)) continue; // (never over a stroke, a filled shape or a word)
          // the leader, from the name's nearest edge to the anchor: it never crosses a word or another name, and crossing a stroke costs
          const lx = Math.min(Math.max(a[0], box.x), box.x + w), ly = Math.min(Math.max(a[1], box.y), box.y + h);
          const along = [...idsAlong([lx, ly, a[0], a[1]])].filter((id) => !own.has(id));
          if (along.some((id) => obstacles.list[id].word) || taken.some((q) => segHits([lx, ly, a[0], a[1]], q))) continue;
          const gap = Math.hypot(a[0] - lx, a[1] - ly); // (how far the name sits from its part: as close as the clear space allows)
          const cost = gap + inBox.length * 40 + along.length * 80;
          if (!top || cost < top.cost) top = { box, cost };
        }
      }
      if (top) { best = top.box; fs = size; break; }
    }
    const g = document.createElementNS(NS, 'g'); g.setAttribute('class', 'ld-label'); g.dataset.i = i;
    const dot = document.createElementNS(NS, 'circle'); dot.setAttribute('cx', a[0]); dot.setAttribute('cy', a[1]); dot.setAttribute('r', 2.5); dot.setAttribute('class', 'ld-anchor');
    if (!best) { // (no clear space: a numbered marker on the part, the name under the picture)
      const m = document.createElementNS(NS, 'circle'); m.setAttribute('cx', a[0]); m.setAttribute('cy', a[1]); m.setAttribute('r', 8); m.setAttribute('class', 'ld-lbg ld-marker');
      const t = document.createElementNS(NS, 'text'); t.setAttribute('x', a[0]); t.setAttribute('y', a[1] + 4); t.setAttribute('text-anchor', 'middle'); t.setAttribute('font-size', 11); t.setAttribute('class', 'ld-ltext');
      g.dataset.marker = '1'; g.append(m, t); labels.appendChild(g);
      legend.hidden = false; legend.textContent = (legend.textContent ? legend.textContent + '   ' : '') + txt; markers++;
      return { g, t, txt: String(i + 1), box: { x: a[0] - 8, y: a[1] - 8, w: 16, h: 16 }, anchor: a };
    }
    taken.push(best);
    // the leader: from the name's nearest edge straight to the anchor, and it ends exactly there
    const lx = Math.min(Math.max(a[0], best.x), best.x + best.w), ly = Math.min(Math.max(a[1], best.y), best.y + best.h);
    const lead = document.createElementNS(NS, 'line'); lead.setAttribute('x1', lx); lead.setAttribute('y1', ly); lead.setAttribute('x2', a[0]); lead.setAttribute('y2', a[1]); lead.setAttribute('class', 'ld-lead');
    const bg = document.createElementNS(NS, 'rect'); bg.setAttribute('x', best.x); bg.setAttribute('y', best.y); bg.setAttribute('width', best.w); bg.setAttribute('height', best.h); bg.setAttribute('rx', 4); bg.setAttribute('class', 'ld-lbg');
    const t = document.createElementNS(NS, 'text'); t.setAttribute('x', best.x + LABEL_PAD); t.setAttribute('y', best.y + LABEL_PAD + fs - 2); t.setAttribute('font-size', fs); t.setAttribute('class', 'ld-ltext'); t.dataset.full = txt;
    g.append(lead, dot, bg, t); labels.appendChild(g);
    return { g, t, txt, box: best, anchor: a };
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
  const clearLabels = () => { labels.replaceChildren(); taken.length = 0; labelEls = []; obstacles = null; legend.textContent = ''; legend.hidden = true; markers = 0; };
  const placeAll = () => { clearLabels(); labelEls = groups.map((_, i) => placeLabel(i)); labelEls.forEach((l) => { if (l) l.t.textContent = l.txt; }); return labelEls.some(Boolean) || !spec.parts.some((p) => p.label); };
  const turns = groups.map(() => 0); // (each show or hide of a part ends the one before it)
  const dropLabel = (i) => { const l = labelEls[i]; if (!l) return; l.g.remove(); const k = taken.indexOf(l.box); if (k >= 0) taken.splice(k, 1); labelEls[i] = null; };
  const view = {
    hintText,
    get strokes() { return groups.flatMap((g) => [...g.children]); },
    // one part at a time, for a player with its own pace (the extension's card)
    has: (i) => !!groups[i],
    hide(i) { if (!groups[i]) return; turns[i]++; dropLabel(i); for (const n of groups[i].children) { n.style.visibility = 'hidden'; n.style.transition = ''; n.style.strokeDasharray = n.getAttribute('stroke-dasharray') ? '' : ''; n.style.strokeDashoffset = ''; n.style.fillOpacity = ''; if (n.dataset.full != null) n.textContent = n.dataset.full; } },
    async show(i, atOnce, ms = 2400) {
      if (!groups[i]) return;
      const my = ++turns[i], kids = [...groups[i].children];
      dropLabel(i);
      if (atOnce || still()) {
        kids.forEach((n) => { n.style.visibility = ''; n.style.transition = ''; n.style.strokeDasharray = ''; n.style.strokeDashoffset = ''; n.style.fillOpacity = ''; if (n.dataset.full != null) n.textContent = n.dataset.full; });
        const l = placeLabel(i); labelEls[i] = l; if (l) { l.t.textContent = l.txt; l.g.dataset.done = '1'; }
        return;
      }
      kids.forEach((n) => { n.style.visibility = 'hidden'; });
      const each = Math.min(600, Math.max(140, (ms * 0.8) / Math.max(1, kids.length)));
      for (const n of kids) {
        if (my !== turns[i]) return;
        n.style.visibility = '';
        if (n.tagName === 'text') { const full = n.dataset.full != null ? n.dataset.full : (n.dataset.full = n.textContent); n.textContent = ''; for (let k = 1; k <= full.length; k++) { if (my !== turns[i]) { n.textContent = full; return; } n.textContent = full.slice(0, k); await sleep(18); } continue; }
        let L = 200; try { L = Math.max(8, Math.ceil(n.getTotalLength())); } catch (e) { /* */ }
        const dashed = n.getAttribute('stroke-dasharray');
        if (!dashed) { n.style.strokeDasharray = L; n.style.strokeDashoffset = L; } else n.style.opacity = '0';
        n.style.fillOpacity = '0';
        void n.getBoundingClientRect();
        n.style.transition = `stroke-dashoffset ${each}ms ease-in-out, opacity ${each}ms ease, fill-opacity .3s ease ${each}ms`;
        if (!dashed) n.style.strokeDashoffset = '0'; else n.style.opacity = '';
        n.style.fillOpacity = '';
        await sleep(each);
        if (my !== turns[i]) return;
        n.style.strokeDasharray = ''; n.style.strokeDashoffset = ''; n.style.transition = '';
      }
      if (my !== turns[i]) return;
      const l = placeLabel(i); labelEls[i] = l;
      if (l) { for (let k = 1; k <= l.txt.length; k++) { if (my !== turns[i]) return; l.t.textContent = l.txt.slice(0, k); await sleep(22); } l.g.dataset.done = '1'; }
    },
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
    const bg = lightPage() ? '#ffffff' : '#141417', ink = lightPage() ? '#111111' : '#f2f2f5';
    const canvas = host.querySelector('canvas');
    if (canvas) { // (3d) the model as the student sees it, with each numbered name and its line drawn on top
      const st = host.querySelector('.ld-stage'), sw = st.clientWidth || 640, sh = st.clientHeight || 360, k = 800 / sw;
      const cv = document.createElement('canvas'); cv.width = 800; cv.height = Math.round(sh * k);
      const x = cv.getContext('2d'); x.fillStyle = bg; x.fillRect(0, 0, cv.width, cv.height); x.drawImage(canvas, 0, 0, cv.width, cv.height);
      x.font = '600 22px Arial, sans-serif'; x.textBaseline = 'middle'; x.textAlign = 'center';
      host.querySelectorAll('.ld-tag').forEach((t) => {
        if (t.hidden) return;
        const tx = parseFloat(t.style.left) * k, ty = parseFloat(t.style.top) * k, ax = +t.dataset.ax * k, ay = +t.dataset.ay * k, tw = x.measureText(t.textContent).width + 20;
        x.strokeStyle = '#888'; x.lineWidth = 2; x.beginPath(); x.moveTo(tx, ty); x.lineTo(ax, ay); x.stroke();
        x.fillStyle = ink; x.beginPath(); x.arc(ax, ay, 5, 0, Math.PI * 2); x.fill();
        x.fillStyle = bg; x.fillRect(tx - tw / 2, ty - 16, tw, 32); x.strokeRect(tx - tw / 2, ty - 16, tw, 32);
        x.fillStyle = ink; x.fillText(t.textContent, tx, ty + 1);
      });
      try { return cv.toDataURL('image/png'); } catch (e) { return null; }
    }
    const svg = host.querySelector('svg'); if (!svg) return null;
    const c2 = svg.cloneNode(true);
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
let threeFrom = () => Promise.all([import('./explore/three.module.min.js'), import('./explore/OrbitControls.js')]).then(([T, oc]) => ({ T, OrbitControls: oc.OrbitControls }));
const loadThree = () => (three || (three = threeFrom()));
// (the Chrome extension keeps its own copy of three.js: it says where) useThree(() => Promise<{ T, OrbitControls }>)
export function useThree(from) { threeFrom = from; three = null; }
// A 3D model on a stage of the caller's own, with no frame and no buttons, for a player that sets its own pace
// (the extension's card shows one part at a time with view.show). → { spec, view }, or null (no 3D here, or nothing to build)
// A flat drawing on a stage of the caller's own, with no frame and no buttons, for a player with its own pace:
// view.show(i, atOnce, ms) draws part i stroke by stroke within about ms and writes its name; view.hide(i) takes it
// away. opts.light: the paper is light (true) or dark (false), whatever the page is. → { spec, view }, or null
export function model2d(stage, rawSpec, opts = {}) {
  const was = paperLight;
  if (typeof opts.light === 'boolean') paperLight = opts.light;
  try {
    const spec = clean(rawSpec);
    if (!spec || spec.mode !== '2d') return null;
    const view = draw2d(stage, spec, { animate: false, setSay: async () => {}, hint: opts.hint || el('div') });
    return { spec, view };
  } finally { paperLight = was; }
}
export async function model3d(stage, rawSpec, opts = {}) {
  const spec = clean(rawSpec);
  if (!spec || spec.mode !== '3d') return null;
  const view = await draw3d(stage, spec, { animate: false, setSay: async () => {}, hint: opts.hint || el('div'), turn: opts.turn || false, zoom: opts.zoom !== false, matte: !!opts.matte, callout: !!opts.callout, real: !!opts.real });
  return view ? { spec, view } : null;
}
const glOk = () => { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; } };
async function draw3d(stage, spec, { animate, setSay, hint, turn = false, zoom = true, matte = false, callout = false, real = false }) {
  if (!glOk()) return null;
  let lib; try { lib = await loadThree(); } catch (e) { return null; }
  const { T, OrbitControls } = lib;
  const W = () => stage.clientWidth || 340, H = () => stage.clientHeight || 260;
  const renderer = new T.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); renderer.setSize(W(), H()); renderer.outputColorSpace = T.SRGBColorSpace;
  const canvas = renderer.domElement; canvas.className = 'ld-canvas'; canvas.style.touchAction = 'none'; stage.prepend(canvas);
  const tags = el('div', 'ld-tags'); stage.appendChild(tags);
  const lines = document.createElementNS(NS, 'svg'); lines.setAttribute('class', 'ld-tag-lines'); lines.setAttribute('aria-hidden', 'true'); stage.insertBefore(lines, tags); // (each name's thin line to its part)
  const offscreen = !!stage.closest('.ld-shot'); // (the copy she takes a picture of: always drawn)
  const scene = new T.Scene(), cam = new T.PerspectiveCamera(34, W() / H(), 0.05, 200);
  scene.add(new T.HemisphereLight(0xe4ecff, 0x1a1a22, 1.15));
  const sun = new T.DirectionalLight(0xffffff, 1.7); sun.position.set(4, 6, 5); scene.add(sun);
  const rim = new T.DirectionalLight(0x8fb4ff, .6); rim.position.set(-5, -2, -4); scene.add(rim);
  // (real: the model looks like the thing itself: its finishes catch a soft studio light, and it throws a soft shadow on the floor under it)
  if (real) {
    try {
      renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap; renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
      sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024); sun.shadow.radius = 6; sun.shadow.bias = -.0005;
      const room = new T.Scene(), glowBox = (c, x, y, z, w, h, d) => { const m = new T.Mesh(new T.BoxGeometry(w, h, d), new T.MeshBasicMaterial({ color: c })); m.position.set(x, y, z); room.add(m); };
      room.add(new T.Mesh(new T.BoxGeometry(40, 40, 40), new T.MeshBasicMaterial({ color: 0x8a8f99, side: T.BackSide })));
      glowBox(0xffffff, 0, 18, 0, 26, 1, 26); glowBox(0xfff2dd, 18, 4, 6, 1, 14, 14); glowBox(0xcfe0ff, -18, 2, -6, 1, 10, 16); glowBox(0x30333a, 0, -18, 0, 40, 1, 40);
      const pm = new T.PMREMGenerator(renderer); scene.environment = pm.fromScene(room, .04).texture; pm.dispose();
    } catch (e) { /* plain lights */ }
  }
  if (matte) scene.add(new T.AmbientLight(0xffffff, .7)); // (matte: plain, bright colours for a model that floats over any page, with no shine to go dark)
  const controls = new OrbitControls(cam, canvas); controls.enableDamping = true; controls.enablePan = false; controls.minDistance = 2; controls.maxDistance = 40;
  if (!zoom) controls.enableZoom = false; // (a model that floats over a page: the wheel still scrolls the page)
  // (turn: the model turns slowly by itself until the student takes hold of it)
  // turn: true goes all the way round; 'sway' rocks gently about the best side, so a long model is never seen end on
  let sway = turn === 'sway' && !still();
  if (turn === true && !still()) { controls.autoRotate = true; controls.autoRotateSpeed = 1.1; controls.addEventListener('start', () => { controls.autoRotate = false; }); }
  if (sway) controls.addEventListener('start', () => { sway = false; });
  const model = new T.Group(); scene.add(model);
  const AX = { x: new T.Vector3(1, 0, 0), y: new T.Vector3(0, 1, 0), z: new T.Vector3(0, 0, 1) };
  const v3 = (a, d = [0, 0, 0]) => (Array.isArray(a) ? new T.Vector3(num(a[0], -20, 20, d[0]), num(a[1], -20, 20, d[1]), num(a[2], -20, 20, d[2])) : new T.Vector3(...d));
  // a shape along an axis: three.js builds cylinders and cones along y, so turn them to x or z
  const along = (obj, axis) => { if (axis === 'x') obj.rotation.z = -Math.PI / 2; else if (axis === 'z') obj.rotation.x = Math.PI / 2; return obj; };
  const groups = spec.parts.map((p, i) => {
    const g = new T.Group(); g.userData = { i, part: p };
    const fin = real ? ({ metal: [.9, .32], plastic: [.02, .42], rubber: [0, .92], wood: [0, .75] })[p.finish] || [.25, .5] : null;
    const mat = new T.MeshStandardMaterial({ color: new T.Color(p.color), metalness: fin ? fin[0] : matte ? .05 : .5, roughness: fin ? fin[1] : matte ? .65 : .4, side: T.DoubleSide, transparent: true, opacity: 1, emissive: p.glow ? new T.Color(p.color) : new T.Color(0x000000), emissiveIntensity: p.glow ? .55 : 0 });
    for (const s of p.shapes) { const m = shape3d(T, s, mat, along, v3, AX); if (m) g.add(m); }
    if (real && !p.shell) g.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
    model.add(g);
    return g;
  }).filter((g) => g.children.length);
  if (!groups.length) { renderer.dispose(); canvas.remove(); return null; }
  // fit the camera to the whole model
  const box = new T.Box3().setFromObject(model), size = box.getSize(new T.Vector3()), mid = box.getCenter(new T.Vector3());
  model.position.sub(mid); model.updateMatrixWorld(true);
  const R = Math.max(size.x, size.y, size.z, 1);
  const VIEW = new T.Vector3(.55, .38, 1.02).normalize();
  // (v253) the camera stands back far enough that the whole model (or the pulled-apart one) is in the frame from any side
  // the nearest distance along a direction at which every corner of the box is inside the frame, with room for the names
  const fitBox = (bx, dir) => {
    const cs = []; for (const x of [bx.min.x, bx.max.x]) for (const y of [bx.min.y, bx.max.y]) for (const z of [bx.min.z, bx.max.z]) cs.push(new T.Vector3(x, y, z));
    const probe = cam.clone(), fits = (d) => { probe.position.copy(dir).multiplyScalar(d); probe.lookAt(0, 0, 0); probe.updateMatrixWorld(); probe.updateProjectionMatrix(); return cs.every((c) => { if (c.clone().applyMatrix4(probe.matrixWorldInverse).z > -probe.near * 4) return false; const q = c.clone().project(probe); return Math.abs(q.x) <= (callout ? .5 : .78) && Math.abs(q.y) <= (callout ? .8 : .72); }); };
    let lo = .5, hi = 400; for (let k = 0; k < 40; k++) { const mid = (lo + hi) / 2; if (fits(mid)) hi = mid; else lo = mid; }
    return hi;
  };
  const fullBox = new T.Box3().setFromObject(model); // (its full size, before the build-up animation shrinks the parts)
  if (real) { // (the floor only catches the shadow; and the sun's shadow reaches round the whole model)
    const floor = new T.Mesh(new T.PlaneGeometry(R * 6, R * 6), new T.ShadowMaterial({ opacity: .22 })); floor.rotation.x = -Math.PI / 2; floor.position.y = fullBox.min.y - R * .04; floor.receiveShadow = true; scene.add(floor);
    const sc = sun.shadow.camera; sc.left = sc.bottom = -R * 1.4; sc.right = sc.top = R * 1.4; sc.near = .1; sc.far = R * 8; sun.position.set(R * .7, R * 1.6, R * .9); sc.updateProjectionMatrix();
  }
  const fitDist = () => fitBox(fullBox, VIEW);
  let camTo = null;
  const home = VIEW.clone().multiplyScalar(fitDist());
  cam.position.copy(home); controls.target.set(0, 0, 0); controls.maxDistance = Math.max(40, home.length() * 3); controls.update();
  // where each part sits (for its name tag, and for pulling it apart along the main axis)
  const ax = AX[spec.axis];
  groups.forEach((g) => { const b = new T.Box3().setFromObject(g); g.userData.center = b.getCenter(new T.Vector3()); g.userData.home = g.position.clone(); });
  const order = groups.filter((g) => !g.userData.part.shell).sort((a, b) => a.userData.center.dot(ax) - b.userData.center.dot(ax));
  const tagEls = groups.map((g, i) => { const p = g.userData.part; if (!p.label) return null; const t = el('button', 'ld-tag', `${spec.parts.indexOf(p) + 1} ${p.label}`); t.type = 'button'; t.hidden = true; t.addEventListener('click', (e) => { e.stopPropagation(); pick(g); }); tags.appendChild(t); return t; });
  let exploded = false, opened = false, picked = null, raf = 0, last = performance.now(), visible = true, calloutAz = null, calloutApart = false;
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
    groups.forEach((g) => { const sl = g.userData.slide; if (sl) { const k = Math.min(1, Math.max(0, (now - sl.t0 - 400) / 1100)), e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; g.position.lerpVectors(sl.from, g.userData.home, e); if (k >= 1) g.userData.slide = null; } }); // (it waits a moment, then slides home)
    if (camTo) { cam.position.lerp(camTo, Math.min(1, dt * 5)); if (cam.position.distanceTo(camTo) < .01) camTo = null; }
    else if (sway) { const a = Math.sin(now / 2600) * .32, d = cam.position.length(), y = home.y / home.length(), r = Math.sqrt(1 - y * y), a0 = Math.atan2(home.x, home.z); cam.position.set(Math.sin(a0 + a) * r * d, y * d, Math.cos(a0 + a) * r * d); }
    controls.update();
    renderer.render(scene, cam);
    // each name: a spot near its part, clear of the other names, with a thin line to the part
    const spots = [], segs = [], w = W(), h = H();
    if (callout) {
      // (names stand in a column on each side of the model, never on it, each with a line to its part)
      const shown = [];
      groups.forEach((g, i) => {
        const t = tagEls[i]; if (!t) return;
        if (!g.visible || (g.userData.part.shell && (opened || exploded))) { t.hidden = true; return; }
        t.hidden = false; tmp.copy(g.userData.center).add(g.position).sub(g.userData.home); tmp.project(cam);
        shown.push({ t, px: (tmp.x + 1) / 2 * w, py: (1 - tmp.y) / 2 * h, tw: t.offsetWidth || 80, th: t.offsetHeight || 24 });
      });
      let x0 = Infinity, x1 = -Infinity;
      if (!exploded) for (const x of [fullBox.min.x, fullBox.max.x]) for (const y of [fullBox.min.y, fullBox.max.y]) for (const z of [fullBox.min.z, fullBox.max.z]) { tmp.set(x, y, z).project(cam); const sx = (tmp.x + 1) / 2 * w; x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); }
      else shown.forEach((s) => { x0 = Math.min(x0, s.px - 48); x1 = Math.max(x1, s.px + 48); });
      const az = Math.atan2(cam.position.x, cam.position.z);
      if (calloutAz == null || Math.abs(Math.atan2(Math.sin(az - calloutAz), Math.cos(az - calloutAz))) > 1 || calloutApart !== exploded) { calloutAz = az; calloutApart = exploded; tagEls.forEach((t) => { if (t) t._side = 0; }); }
      const fresh = shown.filter((s) => !s.t._side).sort((a, b) => a.px - b.px), had = { L: shown.filter((s) => s.t._side === -1).length, R: shown.filter((s) => s.t._side === 1).length };
      fresh.forEach((s) => { const left = s.px < (x0 + x1) / 2 ? had.L <= had.R + 1 : had.L + 1 < had.R; s.t._side = left ? -1 : 1; if (left) had.L++; else had.R++; });
      for (const side of [-1, 1]) {
        const col = shown.filter((s) => s.t._side === side).sort((a, b) => a.py - b.py);
        let y = -Infinity;
        col.forEach((s) => { s.y = Math.max(s.py, y + s.th + 8, s.th / 2 + 4); y = s.y; });
        let cap = h - 4;
        for (let k = col.length - 1; k >= 0; k--) { const s = col[k]; s.y = Math.min(s.y, cap - s.th / 2); cap = s.y - s.th / 2 - 8; }
        col.forEach((s) => {
          const x = side < 0 ? Math.max(s.tw / 2 + 4, x0 - 20 - s.tw / 2) : Math.min(w - s.tw / 2 - 4, x1 + 20 + s.tw / 2);
          s.t.style.left = x + 'px'; s.t.style.top = s.y + 'px'; s.t.dataset.ax = Math.round(s.px); s.t.dataset.ay = Math.round(s.py);
          const ex = side < 0 ? x + s.tw / 2 : x - s.tw / 2;
          segs.push(`<line x1="${ex.toFixed(1)}" y1="${s.y.toFixed(1)}" x2="${s.px.toFixed(1)}" y2="${s.py.toFixed(1)}"/><circle cx="${s.px.toFixed(1)}" cy="${s.py.toFixed(1)}" r="2.5"/>`);
        });
      }
    } else groups.forEach((g, i) => {
      const t = tagEls[i]; if (!t) return;
      if (!g.visible || (g.userData.part.shell && (opened || exploded))) { t.hidden = true; return; }
      t.hidden = false; tmp.copy(g.userData.center).add(g.position).sub(g.userData.home); tmp.project(cam);
      const px = (tmp.x + 1) / 2 * w, py = (1 - tmp.y) / 2 * h, tw = t.offsetWidth || 80, th = t.offsetHeight || 24;
      const free = (x, y) => x - tw / 2 >= 4 && x + tw / 2 <= w - 4 && y - th / 2 >= 4 && y + th / 2 <= h - 4 && !spots.some((q) => Math.abs(q.x - x) < (q.w + tw) / 2 + 6 && Math.abs(q.y - y) < (q.h + th) / 2 + 4);
      const tries = [];
      if (t._spot) tries.push(t._spot); // (stay where it was while that is still free, so the names do not jump about)
      for (const r of [36, 60, 88]) for (const [dx, dy] of [[0, -1], [0, 1], [.8, -.6], [-.8, -.6], [1, 0], [-1, 0], [.8, .6], [-.8, .6]]) tries.push([dx * (r + tw / 4), dy * r]);
      const at = tries.find(([dx, dy]) => free(px + dx, py + dy)) || [0, -36];
      t._spot = at;
      const x = Math.min(w - tw / 2 - 4, Math.max(tw / 2 + 4, px + at[0])), y = Math.min(h - th / 2 - 4, Math.max(th / 2 + 4, py + at[1]));
      spots.push({ x, y, w: tw, h: th });
      t.style.left = x + 'px'; t.style.top = y + 'px';
      t.dataset.ax = Math.round(px); t.dataset.ay = Math.round(py);
      const ex = Math.min(Math.max(px, x - tw / 2), x + tw / 2), ey = Math.min(Math.max(py, y - th / 2), y + th / 2);
      segs.push(`<line x1="${ex.toFixed(1)}" y1="${ey.toFixed(1)}" x2="${px.toFixed(1)}" y2="${py.toFixed(1)}"/><circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="2.5"/>`);
    });
    lines.setAttribute('viewBox', `0 0 ${w} ${h}`); lines.innerHTML = segs.join('');
  };
  raf = requestAnimationFrame(tick);
  const io = !offscreen && 'IntersectionObserver' in window ? new IntersectionObserver((en) => { visible = en.some((x) => x.isIntersecting); }) : null; if (io) io.observe(stage);
  const ro = 'ResizeObserver' in window ? new ResizeObserver(() => { renderer.setSize(W(), H()); cam.aspect = W() / H(); cam.updateProjectionMatrix(); if (!exploded) { home.copy(VIEW).multiplyScalar(fitDist()); camTo = cam.position.clone().normalize().multiplyScalar(home.length()); } }) : null; if (ro) ro.observe(stage);
  const gone = new MutationObserver(() => { if (!stage.isConnected) { cancelAnimationFrame(raf); renderer.dispose(); io && io.disconnect(); ro && ro.disconnect(); gone.disconnect(); } });
  gone.observe(document.body, { childList: true, subtree: true });
  const byPart = (i) => groups.find((g) => g.userData.i === i) || null;
  const SIDES = { front: [0, .14, 1], back: [0, .14, -1], left: [-1, .14, .001], right: [1, .14, .001], side: [1, .14, .001], top: [.001, 1, .04] };
  const view = {
    hintText,
    // one part at a time, for a player with its own pace: show(i) brings part i in (it pops in, slides into its
    // place from "from", and the camera goes to its "view"); show(i, true) puts it there at once; hide(i) takes it away
    has: (i) => !!byPart(i),
    show(i, atOnce) {
      const g = byPart(i); if (!g) return;
      const p = g.userData.part, dim = p.shell && (opened || exploded) ? .14 : 1;
      g.visible = true; g.userData.slide = null;
      if (p.view && SIDES[p.view] && !atOnce) camTo = new T.Vector3(...SIDES[p.view]).normalize().multiplyScalar(cam.position.length());
      if (atOnce || still()) { g.scale.setScalar(1); fade(g, dim); if (!exploded) g.position.copy(g.userData.home); return; }
      if (p.from && !exploded) { g.position.copy(g.userData.home).add(new T.Vector3(p.from[0], p.from[1], p.from[2])); g.userData.slide = { from: g.position.clone(), t0: performance.now() }; }
      const t0 = performance.now();
      const step = () => { if (!g.visible) return; const k = Math.min(1, (performance.now() - t0) / 550), e = 1 - Math.pow(1 - k, 3); g.scale.setScalar(.6 + .4 * e); fade(g, Math.min(e, dim)); if (k < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    },
    hide(i) { const g = byPart(i); if (g) { g.visible = false; g.userData.slide = null; } },
    // (a stage that is not under <body>, like the extension's: it says when it is done)
    stop() { cancelAnimationFrame(raf); renderer.dispose(); io && io.disconnect(); ro && ro.disconnect(); gone.disconnect(); },
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
      const gap = R * .22, n = order.length;
      order.forEach((g, k) => { g.userData.to = exploded ? g.userData.home.clone().addScaledVector(ax, (k - (n - 1) / 2) * gap) : g.userData.home.clone(); });
      shells.forEach((g) => { g.visible = !exploded; });
      // stand back to fit the pulled-apart model (from where the student is looking now)
      const spread = new T.Box3(); groups.forEach((g) => { if (!g.visible) return; const sc = g.scale.x; g.scale.setScalar(1); g.updateMatrixWorld(true); const b = new T.Box3().setFromObject(g); g.scale.setScalar(sc); g.updateMatrixWorld(true); if (g.userData.to) b.translate(g.userData.to.clone().sub(g.position)); spread.union(b); });
      const dir = cam.position.clone().normalize();
      camTo = dir.multiplyScalar(exploded && !spread.isEmpty() ? fitBox(spread, dir) : home.length());
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
  else if (t === 'capsule') m = along(new T.Mesh(new T.CapsuleGeometry(r, len, 8, 24), own), axis);
  else if (t === 'pipe' || t === 'arrow') { // a tube through the points; an arrow ends in a head, the way it points
    const pts = pts3(s.pts).map((q) => new T.Vector3(q[0], q[1], q[2])), w = num(s.r, .01, 2, .06);
    if (pts.length < 2) return null;
    const tube = new T.Mesh(new T.TubeGeometry(pts.length > 2 ? new T.CatmullRomCurve3(pts) : new T.LineCurve3(pts[0], pts[1]), Math.max(8, pts.length * 12), w, 10, false), own);
    if (t === 'pipe') m = tube;
    else {
      const tip = pts[pts.length - 1], dir = tip.clone().sub(pts[pts.length - 2]).normalize(), hl = w * 7;
      const head = new T.Mesh(new T.ConeGeometry(w * 2.8, hl, 18), own);
      head.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), dir); head.position.copy(tip).addScaledVector(dir, hl / 2);
      m = new T.Group(); m.add(tube, head);
    }
  } else if (t === 'lathe') { // a profile [radius, along] turned round the axis
    const pr = pts2(s.profile).map((q) => new T.Vector2(Math.abs(q[0]), q[1]));
    if (pr.length < 2) return null;
    m = along(new T.Mesh(new T.LatheGeometry(pr, 48), own), axis);
  } else if (t === 'plate') { // a flat plate: its outline across the axis ([x,z] for y, [x,y] for z, [z,y] for x), "thick" along it
    const pr = pts2(s.outline), th = num(s.thick, .01, 4, .1);
    if (pr.length < 3) return null;
    const g = new T.ExtrudeGeometry(new T.Shape(pr.map((q) => new T.Vector2(q[0], q[1]))), { depth: th, bevelEnabled: false });
    g.translate(0, 0, -th / 2);
    m = new T.Mesh(g, own);
    if (axis === 'y') m.rotation.x = Math.PI / 2; else if (axis === 'x') m.rotation.y = -Math.PI / 2;
  }
  if (!m) return null;
  m.position.copy(v3(s.pos));
  if (Array.isArray(s.rot)) m.rotation.set(m.rotation.x + num(s.rot[0], -7, 7), m.rotation.y + num(s.rot[1], -7, 7), m.rotation.z + num(s.rot[2], -7, 7));
  return m;
}

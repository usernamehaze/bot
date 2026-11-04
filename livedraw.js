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
    glow: !!(p && p.glow), spin: !!(p && p.spin), shell: !!(p && p.shell),
    shapes: (Array.isArray(p && p.shapes) ? p.shapes : []).slice(0, mode === '3d' ? 8 : 12).filter((x) => x && typeof x === 'object'),
  })).filter((p) => p.shapes.length);
  if (!parts.length) return null;
  return { title: words(s.title, 90) || 'How it works', mode, intro: words(s.intro, 300), summary: words(s.summary, 300), axis: ['x', 'y', 'z'].includes(s.axis) ? s.axis : 'x', parts };
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
  host.append(head, stage, hint, say, acts);
  const setSay = async (text, type) => {
    if (!type) { say.textContent = text; return; }
    say.textContent = '';
    for (let i = 0; i < text.length; i += 3) { say.textContent = text.slice(0, i + 3); await sleep(14); }
  };
  const view = spec.mode === '3d' ? await draw3d(stage, spec, { animate, setSay, hint }) : draw2d(stage, spec, { animate, setSay, hint });
  if (!view) { // no 3D on this phone: say what it would have shown
    stage.remove();
    say.textContent = `${spec.intro ? spec.intro + ' ' : ''}${spec.parts.map((p, i) => `${i + 1}. ${p.label}: ${p.say}`).join(' ')}`;
  }
  const btn = (label, fn, cls = '') => { const b = el('button', 'ld-btn ' + cls, label); b.type = 'button'; b.addEventListener('click', fn); acts.appendChild(b); return b; };
  const done = () => { dot.classList.add('off'); state.textContent = spec.mode === '3d' ? 'Cassie built it in 3D' : 'Cassie drew it'; setSay(spec.summary || spec.intro || ''); };
  if (view) {
    if (view.open) { const ob = btn('Open it up', () => { const on = view.open(); ob.textContent = on ? 'Close the case' : 'Open it up'; ob.setAttribute('aria-pressed', String(on)); }); ob.setAttribute('aria-pressed', 'false'); }
    if (view.explode) { const pb = btn('Pull apart', () => { const on = view.explode(); pb.textContent = on ? 'Put it back' : 'Pull apart'; pb.setAttribute('aria-pressed', String(on)); }); pb.setAttribute('aria-pressed', 'false'); }
    btn('Draw it again', async () => { await view.play(true); done(); });
  }
  if (opts.onQuiz) btn('Quiz me on it', () => opts.onQuiz(spec));
  if (opts.onRealistic && spec.mode === '3d') btn('Make it realistic', () => opts.onRealistic(spec));
  if (view) {
    view.onPick = (p) => {
      if (!p) { setSay(spec.summary || spec.intro || ''); hint.textContent = view.hintText; askBtn.hidden = true; return; }
      setSay(p.say || p.label); hint.textContent = `${p.label}. Tap it again, or tap the empty space, to see it all`;
      askBtn.hidden = !opts.onAsk; askBtn.textContent = `Ask about the ${p.label}`; askBtn.onclick = () => opts.onAsk(p, spec);
    };
    const askBtn = btn('', () => {}, 'ld-askpart'); askBtn.hidden = true;
    if (spec.mode === '3d' && view.setOpen && view.open) { view.setOpen(true); const ob = acts.querySelector('.ld-btn'); if (ob) { ob.textContent = 'Close the case'; ob.setAttribute('aria-pressed', 'true'); } }
    if (animate) { await view.play(); done(); } else { view.play(); done(); }
  }
  return true;
}

// ---------- flat drawings: stroke by stroke, like a pen ----------
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
  // each part's name, beside it with a thin line to it (above for the first, then below, then above…)
  const placed = [];
  const labelOf = (i) => {
    const p = spec.parts[i]; if (!p.label) return null;
    let bb; try { bb = groups[i].getBBox(); } catch (e) { return null; }
    if (!bb || !bb.width && !bb.height) return null;
    const cx = bb.x + bb.width / 2, up = i % 2 === 0;
    let y = up ? Math.max(14, bb.y - 14) : Math.min(252, bb.y + bb.height + 22);
    while (placed.some((q) => Math.abs(q.y - y) < 14 && Math.abs(q.x - cx) < 70)) y += up ? -14 : 14;
    y = Math.min(254, Math.max(12, y)); placed.push({ x: cx, y });
    const g = document.createElementNS(NS, 'g'); g.setAttribute('class', 'ld-label');
    const lead = document.createElementNS(NS, 'line'); lead.setAttribute('x1', cx); lead.setAttribute('y1', up ? y + 4 : y - 14); lead.setAttribute('x2', cx); lead.setAttribute('y2', up ? bb.y : bb.y + bb.height); lead.setAttribute('class', 'ld-lead');
    const t = document.createElementNS(NS, 'text'); t.setAttribute('x', Math.min(392, Math.max(8, cx))); t.setAttribute('y', y); t.setAttribute('text-anchor', cx < 40 ? 'start' : cx > 360 ? 'end' : 'middle'); t.textContent = `${i + 1} ${p.label}`;
    g.append(lead, t); labels.appendChild(g);
    return g;
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
  const view = {
    hintText,
    async play(again) {
      labelEls.forEach((x) => x && x.remove()); labelEls = []; placed.length = 0;
      if (!animate && !again) { // (finished: the labels go on once the drawing has a size; a hidden chat measures as nothing)
        const put = () => { labelEls.forEach((x) => x && x.remove()); placed.length = 0; labelEls = groups.map((_, i) => labelOf(i)); return labelEls.some(Boolean) || !spec.parts.some((p) => p.label); };
        if (!put()) { let tries = 0; const again2 = () => { if (put() || ++tries > 120 || !svg.isConnected && tries > 5) return; setTimeout(again2, 250); }; setTimeout(again2, 250); }
        return;
      }
      groups.forEach((g) => { g.style.opacity = '0'; });
      if (spec.intro) await setSay(spec.intro, true);
      for (let i = 0; i < groups.length; i++) {
        const g = groups[i]; g.style.opacity = '1';
        const strokes = [...g.querySelectorAll('path, line, rect, circle, ellipse, polyline')];
        strokes.forEach((n) => { let L = 300; try { L = Math.max(10, Math.ceil(n.getTotalLength())); } catch (e) { /* */ } n.style.strokeDasharray = L; n.style.strokeDashoffset = L; n.style.fillOpacity = '0'; });
        g.querySelectorAll('text').forEach((t) => { t.style.opacity = '0'; });
        void g.getBoundingClientRect();
        strokes.forEach((n) => { n.style.transition = 'stroke-dashoffset .7s ease, fill-opacity .5s ease .5s'; n.style.strokeDashoffset = '0'; n.style.fillOpacity = ''; });
        g.querySelectorAll('text').forEach((t) => { t.style.transition = 'opacity .4s ease .4s'; t.style.opacity = '1'; });
        const talk = setSay(spec.parts[i].say || spec.parts[i].label, true);
        await sleep(750);
        labelEls.push(labelOf(i));
        await talk; await sleep(500);
        strokes.forEach((n) => { n.style.strokeDasharray = ''; n.style.strokeDashoffset = ''; n.style.transition = ''; });
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
    e.setAttribute('stroke', typeof s.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(s.color) ? s.color : 'currentColor');
    e.setAttribute('stroke-width', num(s.w, 1, 6, 2.2)); e.setAttribute('stroke-linecap', 'round'); e.setAttribute('stroke-linejoin', 'round');
    if (s.dash) e.setAttribute('stroke-dasharray', '6 6');
    return e;
  };
  if (t === 'path' && typeof s.d === 'string' && PATH_OK.test(s.d)) return paint(mk('path', { d: s.d }));
  if (t === 'line') return paint(mk('line', { x1: n('x1'), y1: n('y1'), x2: n('x2'), y2: n('y2') }));
  if (t === 'arrow') { const e = paint(mk('line', { x1: n('x1'), y1: n('y1'), x2: n('x2'), y2: n('y2') })); e.setAttribute('marker-end', 'url(#ld-head)'); if (s.flow !== false) e.classList.add('ld-flow'); return e; }
  if (t === 'rect') return paint(mk('rect', { x: n('x'), y: n('y'), width: num(s.w2 ?? s.width ?? s.wd, 1, 400, 40), height: num(s.h, 1, 260, 30), rx: num(s.r, 0, 60, 6) }));
  if (t === 'circle') return paint(mk('circle', { cx: n('cx', 200), cy: n('cy', 130), r: num(s.r, 1, 200, 20) }));
  if (t === 'ellipse') return paint(mk('ellipse', { cx: n('cx', 200), cy: n('cy', 130), rx: num(s.rx, 1, 200, 30), ry: num(s.ry, 1, 200, 20) }));
  if (t === 'poly' && Array.isArray(s.pts)) { const pts = s.pts.slice(0, 40).map((q) => `${num(q && q[0], -50, 450)},${num(q && q[1], -50, 450)}`).join(' '); return paint(mk('polyline', { points: pts })); }
  if (t === 'text') { const e = mk('text', { x: n('x'), y: n('y'), class: 'ld-word', 'font-size': num(s.size, 8, 22, 12) }); e.textContent = words(s.text ?? s.s, 60); return e; }
  return null;
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

// The 3D Cassie everywhere: the Get started Cassie (the cursor icon puffed up into a soft toy,
// black and white) wearing every face, badge, effect and accessory of the flat Cassie
// (cassie-bot.js). The flat Cassie keeps time and works out her pose and her face each frame; this
// draws the same thing in 3D. One WebGL renderer draws every Cassie on the page into her own
// canvas, only while she's on screen, and rests while the page is hidden.
//   upgrade(api, host, svg, { pokeable, glow }) → { changed(), pause(on), destroy() } or null
import * as THREE from './explore/three.module.min.js';
import { RoomEnvironment } from './explore/RoomEnvironment.js';

const CB = window.CassieBot;
const D = CB.defs, K = CB.construction;
const U = 170; // flat (SVG) units in one 3D unit
const X = (x) => (x - 236) / U, Y = (y) => -(y - 246) / U; // the flat layout → 3D
const VIEW = { x: 40, y: -10, w: 400, h: 450 }; // the flat Cassie's viewBox: the same framing in 3D
const INK = 0x16131c;

/* ---------- the shared renderer ---------- */
let R = null;
// (the next quiet moment: the page's own work goes first, and never while someone is tapping or
// typing, so a slow step can't hold up an answer to a tap)
let lastInput = -1e9;
['pointerdown', 'keydown', 'touchstart', 'wheel'].forEach((k) => addEventListener(k, () => { lastInput = performance.now(); }, { capture: true, passive: true }));
const calm = () => performance.now() - lastInput > 1500;
const later = (f) => { const go = () => (calm() ? f() : setTimeout(() => later(f), 500)); if (window.requestIdleCallback) requestIdleCallback(go, { timeout: 1500 }); else setTimeout(go, 50); };
function setup() {
  const scene = new THREE.Scene();
  // a soft studio: light from the sky and the floor, a key light high on the left, a fill from the right
  scene.add(new THREE.HemisphereLight(0xffffff, 0xa8a8b0, 2.9));
  const key = new THREE.DirectionalLight(0xffffff, 1.9); key.position.set(-2.5, 3.5, 4); scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.6); fill.position.set(3, -1, 2); scene.add(fill);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 40);
  camera.position.set(0, 0, 10);
  // her body: the flat Cassie's own outline, extruded with a deep round bevel (a soft pillow)
  const shape = new THREE.Shape();
  K.POINTER.forEach((p, i, a) => {
    const n = a.length, [x, y, r] = p, [px, py] = a[(i - 1 + n) % n], [nx, ny] = a[(i + 1) % n];
    const l1 = Math.hypot(x - px, y - py), l2 = Math.hypot(nx - x, ny - y), t = Math.min(r, l1 / 2.05, l2 / 2.05);
    const ax = x + (px - x) / l1 * t, ay = y + (py - y) / l1 * t, bx = x + (nx - x) / l2 * t, by = y + (ny - y) / l2 * t;
    if (i) shape.lineTo(X(ax), Y(ay)); else shape.moveTo(X(ax), Y(ay));
    shape.quadraticCurveTo(X(x), Y(y), X(bx), Y(by));
  });
  const body = new THREE.ExtrudeGeometry(shape, { depth: 0.08, bevelEnabled: true, bevelThickness: 0.2, bevelSize: 0.07, bevelSegments: 10, curveSegments: 16 });
  body.translate(0, 0, -0.04);
  body.computeVertexNormals();
  const FRONT = 0.04 + 0.2; // her front face (z)
  // one kind of material for every part (one shader to build, so she's ready fast): a soft plastic
  // sheen, every part carrying a picture (plain parts a white one)
  const white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); white.needsUpdate = true; white.colorSpace = THREE.SRGBColorSpace;
  const M = (color, { roughness = 0.45, metalness = 0, ...o } = {}) => new THREE.MeshPhongMaterial({ color, map: white, shininess: 8 + (1 - roughness) * 70, specular: new THREE.Color(0.1 + metalness * 0.5, 0.1 + metalness * 0.5, 0.1 + metalness * 0.5), ...o });
  const BODY = () => M(0xf7f7f8, { roughness: 0.3 });
  const MAP = (map) => new THREE.MeshPhongMaterial({ map, transparent: true, shininess: 30, specular: 0x1a1a1a, depthWrite: false });
  R = { renderer: null, env: null, size: 512, scene, camera, body, FRONT, M, BODY, MAP, ready: false, waiting: [], ball: new THREE.SphereGeometry(1, 24, 16), cyl: new THREE.CylinderGeometry(1, 1, 1, 28), cone: new THREE.ConeGeometry(1, 1, 28), torus: new THREE.TorusGeometry(1, 0.18, 12, 40), box: new THREE.BoxGeometry(1, 1, 1), bots: new Set(), raf: 0, last: 0 };
  document.addEventListener('visibilitychange', wake);
  // The slow parts (making the 3D context, and building each kind of shader), one small step at a time, so the
  // page never freezes for long; the flat Cassie shows meanwhile.
  let renderer = null;
  const warm = (mat) => () => { // (draws one small thing with that kind of material, so its shader is built now)
    const m = new THREE.Mesh(R.box, mat); scene.add(m);
    renderer.setScissorTest(true); renderer.setViewport(0, 0, 1, 1); renderer.setScissor(0, 0, 1, 1); renderer.render(scene, camera);
    scene.remove(m);
  };
  const steps = [
    () => {
      renderer = R.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' }); // (each picture is copied out in the same moment it's drawn)
      renderer.setPixelRatio(1);
      renderer.setSize(512, 512, false);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.NeutralToneMapping;
    },
    warm(M(0xffffff)), warm(MAP(white)),
  ];
  const next = () => {
    const t0 = performance.now();
    try { steps.shift()(); } catch (e) { R.err = String(e && e.stack || e); R.failed = true; return; } // (no 3D here: the flat Cassies stay)
    R.stepMs = Math.max(R.stepMs || 0, performance.now() - t0); (R.steps = R.steps || []).push(Math.round(performance.now() - t0));
    if (steps.length) later(next);
    else { R.ready = true; R.waiting.splice(0).forEach((f) => f()); wake(); }
  };
  // (starts once a Cassie is on screen and the page has loaded and settled: the flat Cassie shows
  // until then; a page whose Cassies are all hidden never makes a 3D context)
  R.begin = () => {
    if (R.begun) return;
    R.begun = true;
    const start = () => setTimeout(() => later(next), 1200);
    if (document.readyState === 'complete') start(); else addEventListener('load', start, { once: true });
  };
  return R;
}
// The soft studio reflections, for the Get started Cassie (made when she first asks, a step at a time)
export function whenEnv() {
  if (R && R.envP) return R.envP;
  return (R.envP = whenReady().then(() => new Promise((res) => {
    const pmrem = new THREE.PMREMGenerator(R.renderer), cube = new THREE.WebGLCubeRenderTarget(32, { type: THREE.HalfFloatType });
    later(() => {
      new THREE.CubeCamera(0.1, 100, cube).update(R.renderer, new RoomEnvironment());
      later(() => { R.env = pmrem.fromCubemap(cube.texture).texture; cube.dispose(); res(R.env); });
    });
  })));
}
// resolves once the one renderer is ready to draw (straight away after the first time)
export const whenReady = () => new Promise((res) => { if (!R) setup(); R.begin(); if (R.ready) res(R); else R.waiting.push(() => res(R)); });

/* ---------- the flat Cassie's drawings, painted on a canvas (her face, her badge) ---------- */
const parser = new DOMParser();
const cache = new Map();
function nodes(snippet) {
  if (!cache.has(snippet)) cache.set(snippet, [...parser.parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${snippet || ''}</svg>`, 'image/svg+xml').documentElement.children]);
  return cache.get(snippet);
}
function transform(g, tf) {
  for (const [, fn, args] of tf.matchAll(/(translate|rotate|scale)\(([^)]*)\)/g)) {
    const v = args.split(/[\s,]+/).filter(Boolean).map(Number);
    if (fn === 'translate') g.translate(v[0], v[1] || 0);
    if (fn === 'rotate') { if (v.length === 3) { g.translate(v[1], v[2]); g.rotate(v[0] * Math.PI / 180); g.translate(-v[1], -v[2]); } else g.rotate(v[0] * Math.PI / 180); }
    if (fn === 'scale') g.scale(v[0], v.length > 1 ? v[1] : v[0]);
  }
}
function paint(g, list, style) {
  for (const n of list) {
    const a = (k) => n.getAttribute(k), s = { ...style };
    if (a('fill')) s.fill = a('fill'); if (a('stroke')) s.stroke = a('stroke'); if (a('stroke-width')) s.sw = +a('stroke-width');
    if (a('stroke-linecap')) s.cap = a('stroke-linecap'); if (a('opacity')) s.op = (s.op ?? 1) * +a('opacity');
    g.save();
    if (a('transform')) transform(g, a('transform'));
    g.globalAlpha = s.op ?? 1;
    const tag = n.tagName.toLowerCase(), f = (k) => +(a(k) || 0);
    let p = null;
    if (tag === 'g') paint(g, [...n.children], s);
    else if (tag === 'rect') { p = new Path2D(); p.roundRect(f('x'), f('y'), f('width'), f('height'), f('rx')); }
    else if (tag === 'circle') { p = new Path2D(); p.arc(f('cx'), f('cy'), f('r'), 0, Math.PI * 2); }
    else if (tag === 'ellipse') { p = new Path2D(); p.ellipse(f('cx'), f('cy'), f('rx'), f('ry') || f('rx'), 0, 0, Math.PI * 2); }
    else if (tag === 'path' && a('d')) p = new Path2D(a('d'));
    if (p) {
      if (s.fill && s.fill !== 'none') { g.fillStyle = s.fill; g.fill(p); }
      if (s.stroke && s.stroke !== 'none' && s.sw) { g.strokeStyle = s.stroke; g.lineWidth = s.sw; g.lineCap = s.cap || 'butt'; g.lineJoin = 'round'; g.stroke(p); }
    }
    g.restore();
  }
}
const INKS = '#16131c';
const EYES_OF = (kind) => (kind === 'wink' ? ['caret', 'happy'] : kind === 'squint' ? ['squintL', 'squintR'] : [kind, kind]);

/* ---------- accessories in 3D: the flat Cassie's own drawings, puffed up (fills) or rolled (lines) ---------- */
const NSV = 'http://www.w3.org/2000/svg';
let probe = null;
// the outline of a flat shape as points (any path, rect, circle or ellipse), through its transforms
function outline(n, m) {
  const a = (k) => +(n.getAttribute(k) || 0), tag = n.tagName.toLowerCase();
  let d = n.getAttribute('d') || '';
  if (tag === 'rect') { const x = a('x'), y = a('y'), w = a('width'), h = a('height'), r = Math.min(a('rx'), w / 2, h / 2); d = `M${x + r} ${y} H${x + w - r} Q${x + w} ${y} ${x + w} ${y + r} V${y + h - r} Q${x + w} ${y + h} ${x + w - r} ${y + h} H${x + r} Q${x} ${y + h} ${x} ${y + h - r} V${y + r} Q${x} ${y} ${x + r} ${y}Z`; }
  if (tag === 'circle' || tag === 'ellipse') { const cx = a('cx'), cy = a('cy'), rx = a('r') || a('rx'), ry = a('r') || a('ry') || rx; d = `M${cx - rx} ${cy} A${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z`; }
  if (!probe) { const sv = document.createElementNS(NSV, 'svg'); probe = document.createElementNS(NSV, 'path'); sv.appendChild(probe); }
  return d.split(/(?=M)/).filter((x) => x.trim()).map((sub) => {
    probe.setAttribute('d', sub);
    const L = probe.getTotalLength(), k = Math.max(8, Math.ceil(L / 2.5)), pts = [];
    for (let i = 0; i <= k; i++) { const q = probe.getPointAtLength(L * i / k), t = m.transformPoint(new DOMPoint(q.x, q.y)); pts.push([t.x, t.y]); }
    return { pts, closed: /z\s*$/i.test(sub.trim()) };
  });
}
function matrixOf(tf, m) {
  m = DOMMatrix.fromMatrix(m);
  for (const [, fn, args] of (tf || '').matchAll(/(translate|rotate|scale)\(([^)]*)\)/g)) {
    const v = args.split(/[\s,]+/).filter(Boolean).map(Number);
    if (fn === 'translate') m.translateSelf(v[0], v[1] || 0);
    if (fn === 'rotate') { if (v.length === 3) m.translateSelf(v[1], v[2]).rotateSelf(v[0]).translateSelf(-v[1], -v[2]); else m.rotateSelf(v[0]); }
    if (fn === 'scale') m.scaleSelf(v[0], v.length > 1 ? v[1] : v[0]);
  }
  return m;
}
const ACC_TF = { top: () => new DOMMatrix().translateSelf(K.HAT.x, K.HAT.y).rotateSelf(K.HAT.angle).scaleSelf(K.HAT.scale), face: () => new DOMMatrix().translateSelf(216, 236).scaleSelf(1.25), neck: () => new DOMMatrix().translateSelf(214, 330).rotateSelf(-6) };
const accCache = new Map();
function accessory(name) {
  const a = D.ACC[name];
  if (!a) return null;
  if (!accCache.has(name)) {
    const g = new THREE.Group(), mats = new Map();
    const mat = (hex) => { if (!mats.has(hex)) mats.set(hex, R.M(new THREE.Color(hex), hex === '#e8b84a' ? { roughness: 0.25, metalness: 0.6 } : { roughness: 0.5 })); return mats.get(hex); };
    let layer = 0;
    const onFace = a.layer !== 'top';
    const walk = (list, m, style) => list.forEach((n) => {
      const at = (k) => n.getAttribute(k), st = { ...style };
      if (at('fill')) st.fill = at('fill'); if (at('stroke')) st.stroke = at('stroke'); if (at('stroke-width')) st.sw = +at('stroke-width');
      const mm = matrixOf(at('transform'), m), tag = n.tagName.toLowerCase();
      if (tag === 'g') { walk([...n.children], mm, st); return; }
      const fill = st.fill && st.fill !== 'none' ? st.fill : null;
      const z0 = (onFace ? R.FRONT + 0.03 : 0) + layer * 0.035;
      layer++;
      if (fill) {
        // a filled shape: puffed up (the first, the hat itself, deep enough to sit round her head)
        const big = !onFace && layer === 1, bt = big ? 0.14 : 0.03;
        outline(n, mm).forEach(({ pts }) => {
          if (pts.length < 3) return;
          const sh = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(X(x), Y(y))));
          const geo = new THREE.ExtrudeGeometry(sh, { depth: big ? 0.06 : 0.02, bevelEnabled: true, bevelThickness: bt, bevelSize: Math.min(0.025, bt), bevelSegments: big ? 6 : 3, curveSegments: 4 });
          geo.translate(0, 0, z0 - (big ? 0.03 : 0.01) + (big ? 0.08 : (onFace ? 0 : 0.25)));
          g.add(new THREE.Mesh(geo, mat(fill)));
        });
      } else if (st.stroke && st.stroke !== 'none') {
        // a line: rolled into a tube as thick as the line
        const r = (st.sw || 3) * (onFace ? 1.25 : a.layer === 'top' ? K.HAT.scale : 1) / U / 2;
        outline(n, mm).forEach(({ pts, closed }) => {
          if (pts.length < 2) return;
          const curve = new THREE.CatmullRomCurve3(pts.map(([x, y]) => new THREE.Vector3(X(x), Y(y), z0 + (onFace ? 0.01 : 0.27))), closed, 'centripetal');
          g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, Math.min(200, pts.length * 2), r, 8, closed), mat(st.stroke)));
          if (!closed) [pts[0], pts[pts.length - 1]].forEach(([x, y]) => { const cap = new THREE.Mesh(R.ball, mat(st.stroke)); cap.scale.setScalar(r); cap.position.set(X(x), Y(y), z0 + (onFace ? 0.01 : 0.27)); g.add(cap); });
        });
      }
    });
    walk(nodes(a.svg), ACC_TF[a.layer](), {});
    accCache.set(name, g);
  }
  return accCache.get(name).clone();
}

/* ---------- effects in 3D (and the snip frame, drawn over her) ---------- */
function effect(kind, color, accent) {
  const g = new THREE.Group(), { M, ball, box, cyl, torus } = R;
  g.userData.kind = kind;
  const col = new THREE.Color(color || '#ffffff'), ink = M(INK), add = (m) => { g.add(m); return m; };
  const heart = () => { const s = new THREE.Shape(); s.moveTo(0, -0.09); s.bezierCurveTo(-0.2, 0.03, -0.12, 0.17, 0, 0.07); s.bezierCurveTo(0.12, 0.17, 0.2, 0.03, 0, -0.09); return new THREE.ExtrudeGeometry(s, { depth: 0.03, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.01, bevelSegments: 2 }); };
  if (kind === 'dust') for (let i = 0; i < 46; i++) { const a = i / 46 * Math.PI * 2, r = (190 + (i * 37 % 46)) / U, d = add(new THREE.Mesh(ball, M(col.clone().lerp(new THREE.Color(1, 1, 1), 0.3)))); d.position.set(Math.cos(a) * r, Math.sin(a) * r, -0.3); d.scale.setScalar(0.012 + (i % 3) * 0.006); }
  if (kind === 'lines') for (let i = 0; i < 3; i++) { const l = add(new THREE.Mesh(box, M(0x8a8f9c))); l.userData.i = i; l.position.set(X(352), Y(336 + i * 24), 0.1); }
  if (kind === 'scan') { const pg = new THREE.Group(); pg.position.set(X(373), Y(354), 0.05); pg.rotation.z = -0.14; g.add(pg); const edge = new THREE.Mesh(box, M(0x9a9488)); edge.scale.set(0.53, 0.67, 0.015); edge.position.z = -0.006; pg.add(edge); const paper = new THREE.Mesh(box, M(0xffffff)); paper.scale.set(0.5, 0.64, 0.02); pg.add(paper); for (let i = 0; i < 4; i++) { const l = new THREE.Mesh(box, M(0x9a9488)); l.scale.set(0.34, 0.025, 0.01); l.position.set(-0.03, 0.2 - i * 0.1, 0.015); pg.add(l); } const bar = new THREE.Mesh(box, M(color || 0x4fd1b5, { emissive: new THREE.Color(color || 0x4fd1b5), emissiveIntensity: 0.4 })); bar.scale.set(0.46, 0.03, 0.02); bar.position.z = 0.02; bar.userData.bar = true; pg.add(bar); }
  if (kind === 'search') { const lens = new THREE.Group(); lens.userData.lens = true; const ring = new THREE.Mesh(torus, ink); ring.scale.set(0.2, 0.2, 0.25); lens.add(ring); const glass = new THREE.Mesh(new THREE.CircleGeometry(0.19, 32), M(0xffffff, { transparent: true, opacity: 0.3 })); lens.add(glass); const h = new THREE.Mesh(cyl, ink); h.scale.set(0.035, 0.24, 0.035); h.position.set(0.2, -0.2, 0); h.rotation.z = Math.PI / 4; lens.add(h); lens.position.z = R.FRONT + 0.15; add(lens); }
  if (kind === 'scribble') { const n = nodes('<path d="M330 410 C350 380 372 430 392 400 S430 380 446 404"/>')[0], pts = outline(n, new DOMMatrix())[0].pts.map(([x, y]) => new THREE.Vector3(X(x), Y(y), 0.1)); const tube = add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 80, 3.5 / U, 8), M(accent))); tube.userData.scrib = true; }
  if (kind === 'sparkle') { const pts = outline(nodes('<path d="M0 -16 C2 -4 4 -2 16 0 C4 2 2 4 0 16 C-2 4 -4 2 -16 0 C-4 -2 -2 -4 0 -16Z"/>')[0], new DOMMatrix())[0].pts, geo = new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x / U, -y / U))), { depth: 0.01, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.01, bevelSegments: 2 }), sc = color || accent; [[96, 70, 1], [420, 150, 0.8], [436, 330, 0.7], [70, 300, 0.9], [300, 40, 0.6]].forEach(([x, y, s], i) => { const m = add(new THREE.Mesh(geo, M(sc, { emissive: new THREE.Color(sc), emissiveIntensity: 0.35 }))); m.position.set(X(x), Y(y), 0.3); m.userData = { i, s }; }); }
  if (kind === 'hearts' || kind === 'notes') for (let i = 0; i < (kind === 'notes' ? 3 : 4); i++) {
    let m;
    if (kind === 'hearts') m = new THREE.Mesh(heart(), M(col));
    else { m = new THREE.Group(); const head = new THREE.Mesh(ball, M(col)); head.scale.set(0.06, 0.045, 0.04); const stem = new THREE.Mesh(cyl, M(col)); stem.scale.set(0.012, 0.16, 0.012); stem.position.set(0.05, 0.08, 0); m.add(head, stem); }
    m.userData = { i, n: kind === 'notes' ? 3 : 4, float: true }; add(m);
  }
  if (kind === 'drop') { const doc = new THREE.Group(); doc.userData.doc = true; const p = new THREE.Mesh(box, M(0xffffff)); p.scale.set(0.26, 0.33, 0.03); doc.add(p); for (let i = 0; i < 3; i++) { const l = new THREE.Mesh(box, M(0x9a9488)); l.scale.set(0.16, 0.02, 0.01); l.position.set(0, 0.08 - i * 0.07, 0.02); doc.add(l); } add(doc); }
  return g;
}

/* ---------- one Cassie ---------- */
export function upgrade(api, host, svg, { pokeable = false, glow = false } = {}) {
  try { if (!R) { const t0 = performance.now(); setup(); R.setupMs = performance.now() - t0; } } catch (e) { return null; }
  if (R.failed) return null;
  const out = document.createElement('canvas');
  out.className = 'cassie-bot cassie-bot-3d';
  out.setAttribute('role', 'img'); out.setAttribute('aria-label', 'Cassie');
  out.style.display = 'block';
  if (pokeable) { out.style.cursor = 'pointer'; out.style.pointerEvents = 'auto'; out.addEventListener('click', () => api.poke()); }
  const og = out.getContext('2d');
  // her parts: the body (tinted by her mood), a face painted from the flat drawings, a badge, an accessory, an effect
  const group = new THREE.Group();
  const bodyMat = R.BODY();
  const bodyMesh = new THREE.Mesh(R.body, bodyMat);
  group.add(bodyMesh);
  const fc = document.createElement('canvas'); fc.width = fc.height = 512;
  const fg = fc.getContext('2d'), faceTex = new THREE.CanvasTexture(fc); faceTex.colorSpace = THREE.SRGBColorSpace;
  // the face card covers the flat Cassie's whole box (so a point on it is the same point as in the flat drawing)
  const face = new THREE.Mesh(new THREE.PlaneGeometry(VIEW.w / U, VIEW.w / U), R.MAP(faceTex));
  face.position.set(X(VIEW.x + VIEW.w / 2), Y(VIEW.y + VIEW.w / 2), R.FRONT + 0.004);
  group.add(face);
  const badge = new THREE.Group(); badge.position.set(X(372), Y(196), R.FRONT + 0.06);
  const disc = new THREE.Mesh(R.cyl, R.M(0xffffff)); disc.rotation.x = Math.PI / 2; disc.scale.set(24 / U, 0.05, 24 / U);
  const rim = new THREE.Mesh(R.torus, R.M(INK)); rim.scale.set(24 / U, 24 / U, 0.15);
  const bc = document.createElement('canvas'); bc.width = bc.height = 96;
  const bg = bc.getContext('2d'), badgeTex = new THREE.CanvasTexture(bc); badgeTex.colorSpace = THREE.SRGBColorSpace;
  const sym = new THREE.Mesh(new THREE.PlaneGeometry(40 / U, 40 / U), R.MAP(badgeTex));
  sym.position.z = 0.03;
  badge.add(disc, rim, sym); badge.visible = false;
  group.add(badge);
  let acc = null, accName = undefined, fx = null, fxKey = '', stName = '', shownFace = '';
  const clip = new Path2D(K.roundedPath(K.POINTER));
  const bot = { api, out, og, group, bodyMat, face, faceTex, badge, badgeTex, seen: true, paused: false, alive: true, dirty: true };

  function syncParts() {
    const d = api.def, accent = api.accent || '#d8343c';
    // her mood's tint, as on the flat Cassie
    bodyMat.color.set(0xf7f7f8); if (d.color) bodyMat.color.lerp(new THREE.Color(d.color), 0.28);
    bodyMat.opacity = 1;
    if (api.accessory !== accName) { if (acc) group.remove(acc); accName = api.accessory; acc = accName ? accessory(accName) : null; if (acc) group.add(acc); }
    const key = (d.effect || '') + '|' + (d.color || '') + '|' + accent;
    if (key !== fxKey) { if (fx) group.remove(fx); fxKey = key; fx = d.effect && d.effect !== 'highlight' && d.effect !== 'snip' ? effect(d.effect, d.color, accent) : null; if (fx) group.add(fx); }
    if ((d.badge || '') !== stName) { stName = d.badge || ''; badge.visible = !!stName; bg.clearRect(0, 0, 96, 96); if (stName) { bg.save(); bg.translate(48, 48); bg.scale(1.7, 1.7); paint(bg, nodes(D.BADGE[stName]), { fill: INKS, stroke: INKS, sw: 1 }); bg.restore(); } badgeTex.needsUpdate = true; }
  }
  // her face: eyes (where she looks, blinking), mouth (talking), blush and the highlighter, from the flat drawings
  function paintFace(p, d) {
    const accent = api.accent || '#d8343c';
    const key = [d.eyes, d.mouth, d.blush || 0.28, d.effect === 'highlight' ? Math.round(Math.min(1, p.ts / 0.7) * 20) : 0, p.ex.toFixed(2), p.ey.toFixed(2), p.blink.toFixed(2), d.mouth === 'talk' ? Math.round(p.t * 11) : 0, accent].join();
    if (key === shownFace) return;
    shownFace = key;
    const s = 512 / VIEW.w;
    fg.setTransform(1, 0, 0, 1, 0, 0); fg.clearRect(0, 0, 512, 512);
    fg.setTransform(s, 0, 0, s, -VIEW.x * s, -VIEW.y * s);
    fg.save(); fg.clip(clip);
    // blush
    fg.globalAlpha = d.blush || 0.28; fg.fillStyle = accent; fg.filter = 'blur(6px)';
    for (const [x, y] of [D.BLUSH.l, D.BLUSH.r]) { fg.beginPath(); fg.ellipse(x, y, 20, 11, 0, 0, Math.PI * 2); fg.fill(); }
    fg.filter = 'none'; fg.globalAlpha = 1;
    if (d.effect === 'highlight') { const k = Math.min(1, p.ts / 0.7); fg.globalAlpha = 0.38; fg.fillStyle = accent; fg.fillRect(-560 + k * 600, 246, 560, 44); fg.globalAlpha = 1; }
    fg.restore();
    const ex = p.ex * 13, ey = p.ey * 10, F = 1.32;
    const [l, r] = EYES_OF(d.eyes);
    [[D.EYE[l] || D.EYE.caret, K.EYES.l], [D.EYE[r] || D.EYE.caret, K.EYES.r]].forEach(([snip, [x, y]]) => { fg.save(); fg.translate(x + ex, y + ey); fg.scale(F, F * p.blink); paint(fg, nodes(snip), { fill: INKS, stroke: INKS, sw: 1, cap: 'round' }); fg.restore(); });
    if (D.MOUTH[d.mouth]) { fg.save(); fg.translate(216 + ex * 0.6, 282 + ey * 0.5); fg.scale(F, F * (d.mouth === 'talk' ? 0.5 + Math.abs(Math.sin(p.t * 11)) * 0.8 : 1)); paint(fg, nodes(D.MOUTH[d.mouth]), { fill: INKS, stroke: INKS, sw: 1, cap: 'round' }); fg.restore(); }
    faceTex.needsUpdate = true;
  }
  function animateFx(p, d) {
    if (!fx) return;
    const t = p.t, ts = p.ts;
    fx.children.forEach((m) => {
      const u = m.userData;
      if (fx.userData.kind === 'dust') fx.rotation.z = -(t * 9) * Math.PI / 180;
      if (fx.userData.kind === 'lines') { const q = ((t * 0.8) - u.i * 0.33) % 1, w = Math.max(0, Math.min(1, q * 1.6)) * (u.i === 2 ? 50 : 76) / U; m.scale.set(Math.max(0.001, w), 11 / U, 0.03); m.position.x = X(352) + w / 2; }
      if (u.bar) m.position.y = 0.26 - ((t * 0.7) % 4 | 0) * 0.13;
      if (u.lens) m.position.set(X(226 + Math.sin(t * 2.6) * 70), Y(236 + Math.cos(t * 5.2) * 10), R.FRONT + 0.15);
      if (u.scrib) { const n = m.geometry.index.count; m.geometry.setDrawRange(0, Math.floor(n * Math.min(1, ((t * 45) % 130) / 100) / 3) * 3); }
      if (u.s) { const k = Math.max(0, Math.sin(t * 4 + u.i * 1.3)); m.scale.setScalar(Math.max(0.001, k * u.s)); m.rotation.z = t; }
      if (u.float) { const q = ((t * 0.45) + u.i / u.n) % 1; m.position.set(X(330 + u.i * 30 + Math.sin(q * 6 + u.i) * 14), Y(250 - q * 200), 0.25); m.scale.setScalar(Math.max(0.001, 1 - q * 0.6)); m.rotation.y = q * 3; }
      if (u.doc) { const ph = ts % 2.2, k = Math.min(1, ph / 0.95), y = -30 + k * k * 190, sc = ph < 0.95 ? 1.4 : Math.max(0, 1.4 - (ph - 0.95) * 4); m.position.set(X(236), Y(y), R.FRONT + 0.1); m.scale.setScalar(Math.max(0.001, sc)); }
    });
  }
  // one frame of her into her canvas: glow and shadow behind (2D), her (3D), the snip frame over her (2D)
  bot.draw = () => {
    const { renderer, scene, camera } = R, p = api.pose, d = api.def;
    // her first 3D frame: her canvas takes the flat Cassie's place
    if (!bot.live) { host.insertBefore(out, svg); svg.style.display = 'none'; svg.setAttribute('class', 'cassie-bot-flat'); bot.live = true; }
    const dpr = Math.min(2, window.devicePixelRatio || 1), cw = Math.max(1, Math.round(out.clientWidth * dpr)), ch = Math.max(1, Math.round(out.clientHeight * dpr));
    if (out.width !== cw || out.height !== ch) { out.width = cw; out.height = ch; }
    syncParts(); paintFace(p, d); animateFx(p, d);
    // the flat Cassie's pose: bob, squash, tilt and sway (about her feet, as in the flat drawing)
    const piv = [X(240), Y(400)];
    group.position.set(p.dx / U, -p.bob / U, 0);
    group.scale.set(p.sx, p.sy, 1);
    group.rotation.set(-p.ey * 0.18, p.ex * 0.35 + Math.sin(p.t * 0.6) * 0.06, -p.rot * Math.PI / 180);
    group.position.x += piv[0] * (1 - p.sx); group.position.y += piv[1] * (1 - p.sy);
    // the camera frames the flat viewBox, centred in the canvas (as the flat SVG's "meet")
    const vw = VIEW.w / U, vh = VIEW.h / U, cx = X(VIEW.x + VIEW.w / 2), cy = Y(VIEW.y + VIEW.h / 2), k = Math.max(vw / cw, vh / ch);
    camera.left = cx - (cw * k) / 2; camera.right = cx + (cw * k) / 2; camera.top = cy + (ch * k) / 2; camera.bottom = cy - (ch * k) / 2; camera.updateProjectionMatrix();
    if (Math.max(cw, ch) > R.size && R.size < 1024) { R.size = 1024; renderer.setSize(1024, 1024, false); }
    const q = Math.min(1, R.size / Math.max(cw, ch)), rw = Math.max(1, Math.round(cw * q)), rh = Math.max(1, Math.round(ch * q));
    scene.add(group);
    renderer.setScissorTest(true); renderer.setViewport(0, R.size - rh, rw, rh); renderer.setScissor(0, R.size - rh, rw, rh);
    renderer.setClearColor(0x000000, 0); renderer.clear();
    renderer.render(scene, camera);
    scene.remove(group);
    og.setTransform(1, 0, 0, 1, 0, 0); og.clearRect(0, 0, cw, ch);
    const toPx = (x, y) => [(X(x) - camera.left) / (camera.right - camera.left) * cw, (camera.top - Y(y)) / (camera.top - camera.bottom) * ch], unit = cw / ((camera.right - camera.left) * U);
    if (glow) { const [gx, gy] = toPx(236, 246), r = Math.min(250 * unit, gx, gy, cw - gx, ch - gy), /* (fades out inside her box: no square edge) */ gr = og.createRadialGradient(gx, gy, 0, gx, gy, r), c = d.color || '#ffffff'; og.globalAlpha = d.color ? 0.75 + 0.25 * Math.sin(p.t * 2.4) : 0.25; gr.addColorStop(0, c + 'cc'); gr.addColorStop(0.5, c + '47'); gr.addColorStop(1, c + '00'); og.fillStyle = gr; og.fillRect(0, 0, cw, ch); og.globalAlpha = 1; }
    { const [sx, sy] = toPx(250, 418); og.globalAlpha = 0.16; og.fillStyle = INKS; og.filter = `blur(${Math.max(1, 6 * unit)}px)`; og.beginPath(); og.ellipse(sx, sy, 120 * unit * (1 + p.bob / 160), 13 * unit, 0, 0, Math.PI * 2); og.fill(); og.filter = 'none'; og.globalAlpha = 1; }
    og.globalAlpha = d.dim ? 1 - d.dim : 1;
    og.drawImage(renderer.domElement, 0, 0, rw, rh, 0, 0, cw, ch);
    og.globalAlpha = 1;
    if (d.effect === 'snip') { const [ax, ay] = toPx(70, 58), [bx, by] = toPx(420, 430); og.strokeStyle = 'rgba(255,255,255,.85)'; og.lineWidth = 8 * unit; og.strokeRect(ax, ay, bx - ax, by - ay); og.setLineDash([16 * unit, 11 * unit]); og.lineDashOffset = -(p.t * 40 * unit) % (27 * unit); og.strokeStyle = INKS; og.lineWidth = 5 * unit; og.strokeRect(ax, ay, bx - ax, by - ay); og.setLineDash([]); }
    out.dataset.state = api.state; out.dataset.accessory = api.accessory || '';
    out.dataset.frames = String((+out.dataset.frames || 0) + 1);
  };
  bot.changed = () => { shownFace = ''; bot.dirty = true; wake(); };
  bot.pause = (on) => { bot.paused = on; bot.dirty = true; wake(); };
  bot.destroy = () => { bot.alive = false; R.bots.delete(bot); io.disconnect(); out.remove(); };
  bot.host = host; bot.svg = svg;
  const io = new IntersectionObserver(([e]) => { bot.seen = e.isIntersecting; wake(); });
  io.observe(host);
  R.bots.add(bot);
  wake();
  return bot;
}

/* ---------- the shared loop: about 30 frames a second, only Cassies on screen ---------- */
function tick(now) {
  R.raf = 0;
  if (document.hidden) return;
  let any = false, firsts = 0;
  for (const b of R.bots) {
    if (!b.alive) continue;
    if (!(b.live ? b.out : b.svg).isConnected) { b.destroy(); continue; }
    if (!b.seen || !b.host.getClientRects().length) continue;
    if (b.paused && !b.dirty) continue; // (a paused Cassie is drawn once, still)
    any = true; // (keeps looking: she may be uncovered, or the tap answered, in a moment)
    if (now - (b.coverAt || 0) > 500) { b.coverAt = now; b.covered = covered(b.host); }
    if (b.covered) continue; // (under a sheet or a full-screen page: nothing to see, and no 3D made for her)
    if (!R.ready) { R.begin(); continue; }
    if (performance.now() - lastInput < 350) continue; // (a tap or a key is answered first)
    if (!b.live) { if (firsts++ || !calm()) continue; } // (a first frame costs the most: one Cassie's first frame at a time, never mid-tap)
    if (now - R.last >= 30) { b.dirty = false; const t0 = performance.now(); try { b.draw(); } catch (e) { R.err = String(e && e.stack || e); /* one Cassie never breaks the page */ } R.slowest = Math.max(R.slowest || 0, performance.now() - t0); }
  }
  if (now - R.last >= 30) R.last = now;
  if (any) R.raf = requestAnimationFrame(tick);
}
// covered by a big layer over the page (a sheet, a dialog, a full-screen page) that isn't hers
function covered(host) {
  const r = host.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
  if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return false;
  // (from what's on top there, up to what holds her: is any of it big?)
  for (let e = document.elementFromPoint(x, y); e && e !== document.body && e !== document.documentElement; e = e.parentElement) {
    if (e === host || host.contains(e) || e.contains(host)) return false;
    const t = e.getBoundingClientRect();
    if (t.width >= innerWidth * 0.5 && t.height >= innerHeight * 0.5 && /fixed|absolute/.test(getComputedStyle(e).position)) return true; // (a layer laid over the page)
  }
  return false;
}
function wake() { if (R && !R.raf && !document.hidden) R.raf = requestAnimationFrame(tick); }
// The one renderer, for another Cassie drawn her own way (the Get started Cassie, cassie-3d.js): draws
// scene into the top-left w×h of the buffer and copies it into the 2D canvas out (sized w×h already)
export function drawInto(out, scene, camera) {
  if (!R) setup();
  const { renderer } = R, cw = out.width, ch = out.height;
  if (Math.max(cw, ch) > R.size && R.size < 1024) { R.size = 1024; renderer.setSize(1024, 1024, false); }
  const q = Math.min(1, R.size / Math.max(cw, ch)), rw = Math.max(1, Math.round(cw * q)), rh = Math.max(1, Math.round(ch * q));
  renderer.setScissorTest(true); renderer.setViewport(0, R.size - rh, rw, rh); renderer.setScissor(0, R.size - rh, rw, rh);
  renderer.setClearColor(0x000000, 0); renderer.clear();
  renderer.render(scene, camera);
  const g = out.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cw, ch);
  g.drawImage(renderer.domElement, 0, 0, rw, rh, 0, 0, cw, ch);
}
export function shared() { if (!R) setup(); return R; }
// (for the tests: how many 3D contexts all the Cassies use)
export const contexts = () => (R && R.renderer ? 1 : 0);
export const lastError = () => (R && R.err) || null;
export const timings = () => (R ? { setup: R.setupMs || 0, step: R.stepMs || 0, slowest: R.slowest || 0, ready: R.ready, steps: R.steps } : null);

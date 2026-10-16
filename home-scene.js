// Home's header: a little low-poly study room in 3D. A student at a desk with a lamp, books and a
// window breathes, turns pages and blinks; each button on Home plays a short moment (a raised hand,
// a flipped card, a bubbling beaker, a clock, confetti, writing). Colours follow the palette.
// One scene for the whole visit: each new Home borrows the same picture (no rebuilding).
// app.js keeps the still drawing for Reduce Motion, Lite mode or no WebGL.
import * as THREE from './explore/three.module.min.js';

export function webglOK() {
  try { const c = document.createElement('canvas'); return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl'))); } catch (e) { return false; }
}

// a palette token as a three.js colour
const probeCtx = document.createElement('canvas').getContext('2d');
function token(name, fallback) {
  const probe = document.createElement('i');
  probe.style.cssText = `position:absolute;visibility:hidden;color:var(${name})`;
  document.body.appendChild(probe);
  const c = getComputedStyle(probe).color;
  probe.remove();
  probeCtx.fillStyle = fallback; probeCtx.fillStyle = c;
  return new THREE.Color(probeCtx.fillStyle);
}
const mix = (a, b, k) => a.clone().lerp(b, k);

let S = null; // the one scene: { renderer, scene, camera, parts, mats, ... }

function build() {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const canvas = renderer.domElement;
  canvas.className = 'hub-scene-3d';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.dataset.frames = '0';
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 2, 0.1, 60);

  const M = (o = {}) => new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, flatShading: true, ...o });
  const mats = {
    wall: M(), sky: M({ roughness: 1 }), frame: M(), desk: M(), deskFront: M(), shirt: M(), skin: M({ roughness: 0.7 }), hair: M(), eye: M({ roughness: 0.4 }),
    page: M({ roughness: 1 }), cover: M(), book1: M(), book2: M(), book3: M(), lamp: M({ roughness: 0.5 }), bulb: new THREE.MeshBasicMaterial(),
    sun: new THREE.MeshBasicMaterial(), cloud: M({ roughness: 1 }), card: M({ roughness: 0.6 }), glass: M({ transparent: true, opacity: 0.45, roughness: 0.2 }),
    liquid: M({ roughness: 0.3 }), pot: M(), leaf: M(), poster: M({ roughness: 1 }), clock: M(), hand: M(), pencil: M(), confetti: [M({ side: THREE.DoubleSide }), M({ side: THREE.DoubleSide }), M({ side: THREE.DoubleSide })],
  };
  const box = (w, h, d, m) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  const cyl = (rt, rb, h, m, seg = 10) => new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m);
  const ball = (r, m, seg = 10) => new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), m);
  const at = (o, x, y, z) => { o.position.set(x, y, z); return o; };

  // the room: a wall with a window (sky, a sun, two clouds)
  scene.add(at(box(30, 12, 0.1, mats.wall), 0, 2, -1.8));
  const win = new THREE.Group();
  win.add(at(box(1.7, 1.25, 0.04, mats.sky), 0, 0, 0));
  win.add(at(box(1.84, 0.08, 0.1, mats.frame), 0, 0.66, 0.03), at(box(1.84, 0.08, 0.1, mats.frame), 0, -0.66, 0.03));
  win.add(at(box(0.08, 1.4, 0.1, mats.frame), 0.88, 0, 0.03), at(box(0.08, 1.4, 0.1, mats.frame), -0.88, 0, 0.03));
  win.add(at(box(0.05, 1.25, 0.06, mats.frame), 0, 0, 0.03), at(box(1.7, 0.05, 0.06, mats.frame), 0, 0, 0.03));
  win.add(at(ball(0.16, mats.sun), 0.45, 0.3, 0.03));
  const cloud = (x, y, s) => { const g = new THREE.Group(); [[0, 0, 0.13], [0.14, 0.03, 0.1], [-0.13, 0.01, 0.09]].forEach(([a, b, r]) => g.add(at(ball(r, mats.cloud), a, b, 0))); g.position.set(x, y, 0.04); g.scale.setScalar(s); return g; };
  const clouds = [cloud(-0.42, 0.32, 1), cloud(0.3, -0.25, 0.8)];
  clouds.forEach((c) => win.add(c));
  win.position.set(1.15, 1.55, -1.7);
  scene.add(win);

  // the desk
  scene.add(at(box(3.4, 0.12, 1.3, mats.desk), 0, 0, 0));
  scene.add(at(box(3.3, 1.4, 0.08, mats.deskFront), 0, -0.76, 0.58));

  // the student, behind the desk
  const student = new THREE.Group();
  const torso = at(new THREE.Mesh(new THREE.CapsuleGeometry(0.36, 0.45, 3, 10), mats.shirt), 0, 0.42, 0);
  student.add(torso);
  const head = new THREE.Group(); head.position.set(0, 1.18, 0.02);
  head.add(ball(0.33, mats.skin));
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.355, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), mats.hair);
  hair.position.set(0, 0.04, -0.03); hair.rotation.x = -0.35;
  head.add(hair);
  const eyes = [-0.12, 0.12].map((x) => { const e = at(new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), mats.eye), x, 0.0, 0.3); e.scale.set(1, 1.3, 0.6); head.add(e); return e; });
  student.add(head);
  const arm = (side) => {
    const pivot = new THREE.Group(); pivot.position.set(side * 0.43, 0.72, 0.02);
    const a = at(new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.55, 3, 8), mats.shirt), 0, -0.36, 0);
    const hand = at(ball(0.1, mats.skin), 0, -0.72, 0);
    pivot.add(a, hand);
    student.add(pivot);
    return pivot;
  };
  const armL = arm(-1), armR = arm(1);
  student.position.set(0, 0, -0.75);
  scene.add(student);

  // an open book (and a page that turns now and then)
  const book = new THREE.Group(); book.position.set(0, 0.08, 0.05);
  const left = at(box(0.52, 0.03, 0.4, mats.page), -0.27, 0, 0); left.rotation.z = 0.08;
  const right = at(box(0.52, 0.03, 0.4, mats.page), 0.27, 0, 0); right.rotation.z = -0.08;
  book.add(at(box(1.1, 0.02, 0.44, mats.cover), 0, -0.025, 0), left, right);
  const turn = new THREE.Group(); turn.position.set(0, 0.025, 0);
  turn.add(at(box(0.5, 0.008, 0.38, mats.page), 0.26, 0, 0));
  book.add(turn);
  scene.add(book);

  // a lamp, and a stack of books
  const lamp = new THREE.Group(); lamp.position.set(-1.25, 0.06, -0.2);
  lamp.add(cyl(0.2, 0.22, 0.06, mats.lamp, 14));
  const pole = at(cyl(0.03, 0.03, 0.95, mats.lamp, 6), 0.08, 0.47, 0); pole.rotation.z = -0.18; lamp.add(pole);
  const shade = at(cyl(0.08, 0.24, 0.24, mats.lamp, 12), 0.28, 0.95, 0.05); shade.rotation.z = -0.9; lamp.add(shade);
  lamp.add(at(ball(0.07, mats.bulb), 0.36, 0.86, 0.05));
  scene.add(lamp);
  const stack = new THREE.Group(); stack.position.set(1.2, 0.06, -0.15);
  [[mats.book1, 0.6, 0.02], [mats.book2, 0.54, -0.06], [mats.book3, 0.58, 0.05]].forEach(([m, w, r], i) => { const bk = at(box(w, 0.12, 0.4, m), 0, 0.06 + i * 0.125, 0); bk.rotation.y = r; stack.add(bk); });
  scene.add(stack);

  // a plant and a poster on the left (seen on wider screens)
  const plant = new THREE.Group(); plant.position.set(-2.05, 0.06, -0.25);
  plant.add(at(cyl(0.2, 0.15, 0.32, mats.pot, 10), 0, 0.16, 0));
  [[0, 0.55, 0, 0.2], [-0.14, 0.45, 0.05, 0.16], [0.15, 0.47, -0.04, 0.17], [0.03, 0.72, 0.03, 0.14]].forEach(([x, y, z, r]) => plant.add(at(ball(r, mats.leaf), x, y, z)));
  scene.add(plant);
  const poster = new THREE.Group(); poster.position.set(-1.9, 1.55, -1.72);
  poster.add(box(0.9, 0.62, 0.03, mats.frame), at(box(0.8, 0.52, 0.04, mats.poster), 0, 0, 0.01));
  poster.add(at(new THREE.Mesh(new THREE.CircleGeometry(0.12, 18), mats.book2), -0.18, 0.04, 0.04), at(box(0.3, 0.05, 0.01, mats.book1), 0.15, 0.09, 0.04), at(box(0.24, 0.05, 0.01, mats.book3), 0.12, -0.03, 0.04));
  poster.rotation.z = 0.03;
  scene.add(poster);

  // the moments' props (hidden until a button plays them)
  const card = at(box(0.4, 0.27, 0.015, mats.card), 0.55, 0.62, 0.15);
  const beaker = new THREE.Group(); beaker.position.set(-0.68, 0.06, 0.38);
  beaker.add(at(cyl(0.13, 0.13, 0.34, mats.glass, 14), 0, 0.17, 0), at(cyl(0.115, 0.115, 0.18, mats.liquid, 14), 0, 0.1, 0));
  const bubbles = Array.from({ length: 6 }, (_, i) => { const b = at(ball(0.03, mats.glass), (i % 3 - 1) * 0.05, 0.1, (i % 2) * 0.04); beaker.add(b); return b; });
  const clock = new THREE.Group(); clock.position.set(1.2, 0.95, -0.6);
  const face = cyl(0.26, 0.26, 0.06, mats.clock, 20); face.rotation.x = Math.PI / 2; clock.add(face);
  const hourH = new THREE.Group(), minH = new THREE.Group();
  hourH.add(at(box(0.03, 0.13, 0.02, mats.hand), 0, 0.06, 0)); minH.add(at(box(0.02, 0.19, 0.02, mats.hand), 0, 0.09, 0));
  hourH.position.z = minH.position.z = 0.05; clock.add(hourH, minH);
  const notebook = new THREE.Group(); notebook.position.set(0.6, 0.07, 0.36); notebook.rotation.y = -0.3;
  notebook.add(box(0.46, 0.03, 0.34, mats.card));
  const pencil = at(cyl(0.018, 0.018, 0.34, mats.pencil, 6), 0.05, 0.08, 0); pencil.rotation.set(0.5, 0, 1.1); notebook.add(pencil);
  const confetti = Array.from({ length: 36 }, (_, i) => { const p = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.1), mats.confetti[i % 3]); p.userData.v = new THREE.Vector3((Math.random() - 0.5) * 2.4, 1.6 + Math.random() * 1.6, (Math.random() - 0.3) * 0.8); p.userData.s = (Math.random() - 0.5) * 12; scene.add(p); return p; });
  const props = { card, beaker, clock, notebook };
  Object.values(props).forEach((p) => { p.visible = false; scene.add(p); });
  confetti.forEach((p) => { p.visible = false; });

  // light: soft sky light, a sun from the window, and the lamp's warm glow
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8a8a, 1.5));
  const sunLight = new THREE.DirectionalLight(0xffffff, 1.4); sunLight.position.set(2.5, 4, 3); scene.add(sunLight);
  const lampLight = new THREE.PointLight(0xffd9a0, 2.2, 4, 1.6); lampLight.position.set(-0.85, 0.95, 0); scene.add(lampLight);

  S = { renderer, canvas, scene, camera, mats, student, torso, head, eyes, armL, armR, turn, clouds, props, bubbles, hourH, minH, pencil, confetti, lampLight,
    host: null, io: null, ro: null, onScreen: true, raf: 0, frames: 0, t0: performance.now(), nextBlink: 0, blinkAt: -1, nextTurn: 0, turnAt: -1, moment: null };
  S.nextBlink = S.t0 + 2000; S.nextTurn = S.t0 + 3500;
  paint();
  // the palette can change (light and dark, the colour picked in Appearance)
  const repaint = () => requestAnimationFrame(() => { paint(); wake(); });
  if (window.matchMedia) { const q = matchMedia('(prefers-color-scheme: dark)'); if (q.addEventListener) q.addEventListener('change', repaint); }
  new MutationObserver(repaint).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-pal', 'style', 'class'] });
  document.addEventListener('visibilitychange', () => wake());
}

// every colour from the palette (in Monochrome, greys; the skin a soft grey there too)
function paint() {
  const { mats } = S;
  const primary = token('--primary', '#c2405e'), secondary = token('--secondary', '#5e8d7b'), surface = token('--surface', '#ffffff'), bg = token('--bg', '#f6f1ec'), text = token('--text', '#2a2024');
  const mono = document.documentElement.dataset.pal === 'mono';
  const dark = (bg.r + bg.g + bg.b) / 3 < 0.35;
  const skin = mono ? new THREE.Color(0xc9c9cc) : new THREE.Color(0xe7b591);
  mats.wall.color.copy(mix(bg, primary, dark ? 0.16 : 0.12));
  mats.sky.color.copy(mix(secondary, surface, dark ? 0.15 : 0.55));
  mats.frame.color.copy(dark ? mix(surface, text, 0.3) : mix(surface, text, 0.06));
  const ink = mono ? new THREE.Color(0x1b1b1d) : new THREE.Color(0x2a201c);
  mats.desk.color.copy(dark ? mix(secondary, bg, 0.45) : mix(secondary, text, 0.42));
  mats.deskFront.color.copy(dark ? mix(secondary, bg, 0.6) : mix(secondary, text, 0.55));
  mats.pot.color.copy(mix(primary, surface, dark ? 0.1 : 0.35));
  mats.leaf.color.copy(mono ? mix(secondary, surface, 0.2) : mix(secondary, new THREE.Color(0x4caf50), 0.35));
  mats.poster.color.copy(mix(surface, secondary, 0.12));
  mats.shirt.color.copy(primary);
  mats.skin.color.copy(dark ? skin.clone().multiplyScalar(0.85) : skin);
  mats.hair.color.copy(ink);
  mats.eye.color.copy(ink);
  mats.page.color.copy(dark ? mix(text, surface, 0.12) : mix(surface, bg, 0.2));
  mats.cover.color.copy(mix(primary, text, 0.3));
  mats.book1.color.copy(primary); mats.book2.color.copy(secondary); mats.book3.color.copy(mix(primary, surface, 0.45));
  mats.lamp.color.copy(mix(surface, text, 0.25));
  mats.bulb.color.copy(mono ? new THREE.Color(0xffffff) : new THREE.Color(0xfff1c9));
  mats.sun.color.copy(mono ? mix(surface, text, 0.08) : mix(new THREE.Color(0xffe39a), surface, 0.2));
  mats.cloud.color.copy(dark ? mix(text, surface, 0.25) : surface);
  mats.card.color.copy(mix(surface, primary, 0.06));
  mats.glass.color.copy(mix(secondary, surface, 0.3));
  mats.liquid.color.copy(secondary);
  mats.clock.color.copy(dark ? mix(surface, text, 0.85) : surface); mats.hand.color.copy(ink);
  mats.pencil.color.copy(mono ? mix(surface, text, 0.5) : new THREE.Color(0xe8b14c));
  mats.confetti[0].color.copy(primary); mats.confetti[1].color.copy(secondary); mats.confetti[2].color.copy(mono ? text : new THREE.Color(0xf2c14e));
  S.lampLight.color.copy(mono ? new THREE.Color(0xffffff) : new THREE.Color(0xffd9a0));
  S.renderer.setClearColor(mats.wall.color);
}

function fit() {
  if (!S || !S.host) return;
  const w = Math.max(1, S.host.clientWidth), h = Math.max(1, S.host.clientHeight);
  S.renderer.setSize(w, h, false);
  const aspect = w / h;
  S.camera.aspect = aspect;
  // wider screens: the room sits to the right of the greeting, and a little further back
  const wide = Math.max(0, aspect - 1.8);
  S.camera.position.set(-0.15 - wide * 0.55, 1.95, 5.2 + wide * 0.25);
  S.camera.lookAt(-wide * 0.55 + 0.1, 0.98, -0.4);
  S.camera.fov = aspect < 1.4 ? 38 : 31;
  S.camera.updateProjectionMatrix();
}

const ease = (k) => k * k * (3 - 2 * k);
const bump = (p, a = 0.15, b = 0.8) => (p < a ? ease(p / a) : p > b ? 1 - ease((p - b) / (1 - b)) : 1); // up, hold, down

function frame(now) {
  S.raf = 0;
  if (!S.host || !S.host.isConnected || document.hidden || !S.onScreen) return; // (wakes when seen again)
  const t = (now - S.t0) / 1000;
  const { student, torso, head, eyes, armL, armR, turn, clouds, props, bubbles, hourH, minH, pencil, confetti } = S;
  // breathing, a slow sway, clouds drifting
  const br = Math.sin(t * 1.7);
  torso.scale.set(1 + br * 0.015, 1 + br * 0.025, 1 + br * 0.015);
  head.position.y = 1.18 + br * 0.012;
  head.rotation.set(0.12 + Math.sin(t * 0.6) * 0.03, Math.sin(t * 0.45) * 0.12, Math.sin(t * 0.5) * 0.03);
  clouds[0].position.x = -0.42 + Math.sin(t * 0.15) * 0.12; clouds[1].position.x = 0.3 + Math.sin(t * 0.12 + 2) * 0.1;
  // resting arms on the desk, reading
  armL.rotation.set(-1.15, 0, -0.25); armR.rotation.set(-1.15, 0, 0.25);
  // a blink every 3 to 6 seconds
  if (now >= S.nextBlink) { S.blinkAt = now; S.nextBlink = now + 3000 + Math.random() * 3000; }
  const bk = (now - S.blinkAt) / 180, lid = bk >= 0 && bk < 1 ? 1 - Math.sin(bk * Math.PI) * 0.9 : 1;
  // a page turns every few seconds
  if (now >= S.nextTurn) { S.turnAt = now; S.nextTurn = now + 4500 + Math.random() * 3000; }
  const tp = (now - S.turnAt) / 900;
  turn.rotation.z = tp >= 0 && tp < 1 ? Math.PI * ease(tp) : 0;
  turn.visible = !(tp >= 1 && tp < 1.05);
  // the moment a button played (about a second)
  Object.values(props).forEach((p) => { p.visible = false; });
  confetti.forEach((p) => { p.visible = false; });
  let focus = 0;
  const m = S.moment;
  if (m) {
    const p = (now - m.at) / 1100;
    if (p >= 1) { S.moment = null; if (S.host) S.host.dataset.pose = 'idle'; } else {
      const k = bump(p);
      if (m.kind === 'ask') { armR.rotation.set(-1.15 - k * 1.95, 0, 0.25 - k * 0.2); head.rotation.x -= k * 0.15; }
      if (m.kind === 'cards') { props.card.visible = true; props.card.scale.setScalar(Math.max(0.01, k)); props.card.rotation.set(-0.3, ease(Math.min(1, p / 0.8)) * Math.PI, 0); armR.rotation.set(-1.4 - k * 0.3, 0, 0.1); }
      if (m.kind === 'lab') { props.beaker.visible = true; props.beaker.scale.setScalar(Math.max(0.01, k * 1.5)); bubbles.forEach((b, i) => { const q = (p * 2.4 + i / 6) % 1; b.position.y = 0.1 + q * 0.32; b.scale.setScalar(1 - q * 0.5); }); }
      if (m.kind === 'timer') { props.clock.visible = true; props.clock.scale.setScalar(Math.max(0.01, k * 1.2)); minH.rotation.z = -p * Math.PI * 4; hourH.rotation.z = -p * Math.PI / 3; focus = k; }
      if (m.kind === 'streak') { confetti.forEach((c) => { c.visible = true; const v = c.userData.v; c.position.set(v.x * p, 1.4 + v.y * p - 2.6 * p * p, -0.6 + v.z * p); c.rotation.set(c.userData.s * p, c.userData.s * p * 0.7, 0); }); armL.rotation.set(-1.15 - k * 1.6, 0, -0.25 + k * 0.4); armR.rotation.set(-1.15 - k * 1.6, 0, 0.25 - k * 0.4); student.position.y = Math.sin(p * Math.PI) * 0.12; }
      if (m.kind === 'write') { props.notebook.visible = true; props.notebook.scale.setScalar(Math.max(0.01, k * 1.25)); pencil.position.x = 0.05 + Math.sin(p * 30) * 0.06 * k; armR.rotation.set(-1.25, Math.sin(p * 30) * 0.1 * k, 0.05); }
    }
  }
  if (!m || m.kind !== 'streak') student.position.y = 0;
  // focusing: leaning in, eyes narrowed
  student.position.z = -0.75 + focus * 0.12;
  head.rotation.x += focus * 0.18;
  eyes.forEach((e) => { e.scale.y = 1.3 * lid * (1 - focus * 0.45); });
  S.renderer.render(S.scene, S.camera);
  if (++S.frames % 10 === 0) S.canvas.dataset.frames = String(S.frames);
  S.raf = requestAnimationFrame(frame);
}
function wake() { if (S && !S.raf) S.raf = requestAnimationFrame(frame); }

// Show the scene in host (Home's header). The same picture moves to each new Home.
export function attach(host) {
  if (!S) build();
  if (S.host !== host) {
    if (S.io) S.io.disconnect();
    if (S.ro) S.ro.disconnect();
    S.host = host;
    host.appendChild(S.canvas);
    S.io = window.IntersectionObserver ? new IntersectionObserver(([e]) => { S.onScreen = e.isIntersecting; wake(); }) : null;
    if (S.io) S.io.observe(host);
    S.ro = window.ResizeObserver ? new ResizeObserver(() => { fit(); wake(); }) : null;
    if (S.ro) S.ro.observe(host);
  }
  host.dataset.pose = S.moment ? S.moment.kind : 'idle';
  fit();
  wake();
  return S.canvas;
}

// Play a moment: 'ask', 'cards', 'lab', 'timer', 'streak' or 'write' (about a second)
export function play(kind) {
  if (!S) return;
  S.moment = { kind, at: performance.now() };
  if (kind === 'streak') S.confetti.forEach((c) => { c.userData.v.set((Math.random() - 0.5) * 2.4, 1.6 + Math.random() * 1.6, (Math.random() - 0.3) * 0.8); });
  if (S.host) S.host.dataset.pose = kind;
  wake();
}

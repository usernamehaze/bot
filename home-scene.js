// Home's header: a little study room in 3D. A cartoon student (a boy, a girl, or neither, from the
// profile) at a desk with a lamp, books and a window breathes, turns pages and blinks; each button on
// Home plays a short moment with its own face (a raised hand, a flipped card, a bubbling beaker, a
// clock, confetti, writing). The room's colours follow the palette; skin, eyes and hair stay natural.
// One scene for the whole visit: each new Home borrows the same picture (no rebuilding).
// app.js keeps the still drawing for Reduce Motion, Lite mode or no WebGL.
import * as THREE from './explore/three.module.min.js';
import { mergeGeometries } from './explore/BufferGeometryUtils.js';

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

/* ---------- the student: a stylized cartoon kid ----------
   Soft rounded shapes with big-head proportions: big eyes (white, brown iris, pupil, a highlight)
   with lids that blink, brows and a mouth that change with each moment, clustered hair (short curls
   for a boy, long waves for a girl, a wavy bob otherwise), a hoodie or an open jacket, jeans with
   rolled cuffs and canvas sneakers. A simple rig: neck, shoulders, elbows, mitten hands with thumbs.
   One unit sphere and a few capsules are shared by every part (scaled), so the first draw is quick. */
const UNIT = { ball: null, cap: null, capS: null };
function unit() {
  if (!UNIT.ball) { UNIT.ball = new THREE.SphereGeometry(1, 20, 14); UNIT.cap = new THREE.CapsuleGeometry(0.1, 0.4, 4, 12); UNIT.capS = new THREE.CapsuleGeometry(0.02, 0.1, 3, 8); }
  return UNIT;
}
function makeStudent(gender, K) {
  const U = unit();
  const kind = gender === 'male' ? 'boy' : gender === 'female' ? 'girl' : 'kid';
  const g = new THREE.Group(); g.name = 'student-' + kind;
  const ball = (m, sx, sy = sx, sz = sx) => { const o = new THREE.Mesh(U.ball, m); o.scale.set(sx, sy, sz); return o; };
  const at = (o, x, y, z) => { o.position.set(x, y, z); return o; };
  const cloth = kind === 'girl' ? K.jacket : K.hoodie;

  // the body: a soft top (a hoodie, or an open jacket over a light top), hips and legs under the desk
  const torso = new THREE.Group(); torso.position.set(0, 0.2, 0);
  const chest = at(ball(cloth, 0.4, 0.5, 0.3), 0, 0.12, 0); chest.name = kind === 'girl' ? 'jacket' : 'hoodie';
  torso.add(chest);
  if (kind === 'girl') { // the light top showing down the middle, and the jacket's collar
    torso.add(at(ball(K.top, 0.17, 0.42, 0.12), 0, 0.12, 0.2));
    [-1, 1].forEach((sd) => { const c = at(ball(K.jacket, 0.13, 0.05, 0.08), sd * 0.13, 0.5, 0.17); c.rotation.z = sd * 0.5; torso.add(c); });
  } else { // the hood behind the neck, the pocket and two drawstrings
    const hood = at(ball(K.hoodie, 0.3, 0.17, 0.2), 0, 0.55, -0.13); hood.name = 'hood'; torso.add(hood);
    torso.add(at(ball(K.hoodie2, 0.24, 0.09, 0.05), 0, -0.13, 0.27));
    [-0.07, 0.07].forEach((x) => { const st = at(new THREE.Mesh(U.capS, K.string), x, 0.38, 0.26); st.scale.set(1, 1.4, 1); torso.add(st); torso.add(at(ball(K.string, 0.022), x, 0.27, 0.27)); });
  }
  g.add(torso);
  const hips = at(ball(K.jeans, 0.36, 0.2, 0.3), 0, -0.32, 0); g.add(hips);
  [-1, 1].forEach((sd) => { // thighs forward under the desk, shins down, rolled cuffs and sneakers
    const thigh = at(new THREE.Mesh(U.cap, K.jeans), sd * 0.17, -0.38, 0.3); thigh.rotation.x = Math.PI / 2; thigh.scale.set(1.25, 1, 1.25); g.add(thigh);
    const shin = at(new THREE.Mesh(U.cap, K.jeans), sd * 0.17, -0.75, 0.55); shin.scale.set(1.15, 1, 1.15); g.add(shin);
    g.add(at(ball(K.cuff, 0.13, 0.04, 0.13), sd * 0.17, -0.97, 0.55));
    const shoe = at(ball(K.shoe, 0.12, 0.08, 0.2), sd * 0.17, -1.07, 0.62); shoe.name = 'sneaker'; g.add(shoe);
    g.add(at(ball(K.sole, 0.125, 0.035, 0.21), sd * 0.17, -1.12, 0.62));
  });

  // the head: a big, slightly squashed ball on a short neck
  const neck = at(new THREE.Mesh(U.cap, K.skin), 0, 0.72, 0); neck.scale.set(0.9, 0.35, 0.9); g.add(neck);
  const head = new THREE.Group(); head.position.set(0, 1.12, 0.02); head.name = 'head';
  head.add(ball(K.skin, 0.37, 0.35, 0.34));
  [-1, 1].forEach((sd) => head.add(at(ball(K.skin, 0.06, 0.08, 0.04), sd * 0.36, -0.02, 0)));
  head.add(at(ball(K.skin, 0.035, 0.03, 0.03), 0, -0.06, 0.34)); // the nose
  // the eyes: white, a brown iris, a dark pupil and a highlight, with a lid that blinks
  const eyes = [-1, 1].map((sd) => {
    const e = new THREE.Group(); e.position.set(sd * 0.135, 0.02, 0.27); e.scale.set(1, 1, 0.6);
    e.add(ball(K.sclera, 0.085, 0.1, 0.085));
    e.add(at(ball(K.iris, 0.056, 0.064, 0.05), 0, -0.006, 0.05));
    e.add(at(ball(K.pupil, 0.03, 0.035, 0.03), 0, -0.006, 0.078));
    e.add(at(ball(K.sclera, 0.014), -0.018, 0.018, 0.1));
    const lid = new THREE.Mesh(new THREE.SphereGeometry(0.092, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), K.skin);
    lid.scale.set(1, 1.12, 1); e.add(lid); e.userData.lid = lid;
    head.add(e);
    return e;
  });
  const brows = [-1, 1].map((sd) => { const b = at(new THREE.Mesh(U.capS, K.hair), sd * 0.135, 0.17, 0.3); b.rotation.z = Math.PI / 2; b.scale.set(1.6, 1, 1.2); b.userData.sd = sd; head.add(b); return b; });
  // the mouths (one shows at a time): a smile, a small smile, an open smile, an "o", a laugh, a flat line
  const mouths = {};
  const smileGeo = new THREE.TorusGeometry(0.07, 0.013, 6, 16, Math.PI);
  mouths.smile = at(new THREE.Mesh(smileGeo, K.lip), 0, -0.13, 0.32); mouths.smile.rotation.set(-0.25, 0, Math.PI);
  mouths.small = at(new THREE.Mesh(smileGeo, K.lip), 0, -0.14, 0.32); mouths.small.rotation.set(-0.25, 0, Math.PI); mouths.small.scale.set(0.6, 0.6, 1);
  mouths.open = at(new THREE.Mesh(new THREE.CircleGeometry(0.075, 18, Math.PI, Math.PI), K.mouth), 0, -0.13, 0.322); mouths.open.rotation.x = -0.25;
  mouths.laugh = at(new THREE.Mesh(new THREE.CircleGeometry(0.095, 18, Math.PI, Math.PI), K.mouth), 0, -0.12, 0.323); mouths.laugh.rotation.x = -0.25;
  mouths.o = at(ball(K.mouth, 0.035, 0.045, 0.012), 0, -0.15, 0.322);
  mouths.flat = at(new THREE.Mesh(U.capS, K.lip), 0, -0.15, 0.322); mouths.flat.rotation.z = Math.PI / 2; mouths.flat.scale.set(0.7, 0.6, 0.6);
  Object.entries(mouths).forEach(([k, m]) => { m.name = 'mouth-' + k; head.add(m); });

  // the hair: rounded clumps merged into one mesh (short curls, long waves, or a wavy bob)
  const parts = [];
  const lump = (x, y, z, r) => { const q = new THREE.SphereGeometry(r, 10, 8); q.translate(x, y, z); parts.push(q); };
  for (let i = 0; i < 70; i++) { // a cap of clumps over the top and back of the head (the face stays clear)
    const yv = 1 - (i + 0.5) / 70 * 1.4, rr = Math.sqrt(Math.max(0, 1 - yv * yv)), th = i * 2.399963;
    const x = Math.cos(th) * rr, z = Math.sin(th) * rr, y = yv;
    if (y < -0.25 || (z > 0.35 && y < 0.55)) continue;
    lump(x * 0.35, y * 0.34 + 0.04, z * 0.33 - 0.01, kind === 'boy' ? 0.1 : 0.12);
  }
  if (kind === 'boy') { // curls: a fringe that falls onto the forehead
    [[-0.17, 0.25, 0.25], [-0.05, 0.29, 0.27], [0.08, 0.28, 0.27], [0.19, 0.23, 0.24], [0.27, 0.15, 0.17], [-0.26, 0.17, 0.18]].forEach(([x, y, z]) => lump(x, y, z, 0.085));
  } else { // a side parting and long waves past the shoulders (a bob stops at the jaw)
    [[-0.16, 0.27, 0.24, 0.1], [0.06, 0.3, 0.25, 0.09], [0.22, 0.22, 0.22, 0.09]].forEach(([x, y, z, r]) => lump(x, y, z, r));
    const long = kind === 'girl', rows = long ? 9 : 4;
    for (let k = 0; k < rows; k++) {
      const y = 0.0 - k * 0.1, w = Math.sin(k * 1.3) * 0.025;
      [-1, 1].forEach((sd) => { lump(sd * (0.33 + w), y, 0.06, 0.1); lump(sd * (0.27 + w), y, -0.14, 0.11); });
      lump(w, y - 0.02, -0.28, 0.13);
    }
  }
  const hair = new THREE.Mesh(mergeGeometries(parts), K.hair);
  parts.forEach((q) => q.dispose());
  hair.name = 'hair-' + (kind === 'boy' ? 'curly' : kind === 'girl' ? 'long' : 'bob');
  head.add(hair);
  g.add(head);

  // the arms: shoulder and elbow joints, sleeves, and mitten hands with a thumb
  const arm = (sd) => {
    const sh = new THREE.Group(); sh.position.set(sd * 0.4, 0.56, 0); sh.name = 'shoulder';
    const up = at(new THREE.Mesh(U.cap, cloth), 0, -0.21, 0); up.scale.set(1.15, 0.8, 1.15); sh.add(up);
    const el = new THREE.Group(); el.position.set(0, -0.42, 0); el.name = 'elbow'; sh.add(el);
    const fore = at(new THREE.Mesh(U.cap, cloth), 0, -0.18, 0); fore.scale.set(1.05, 0.72, 1.05); el.add(fore);
    const hand = new THREE.Group(); hand.position.set(0, -0.4, 0); el.add(hand);
    hand.add(ball(K.skin, 0.075, 0.09, 0.06));
    const th = at(new THREE.Mesh(U.capS, K.skin), sd * -0.06, 0.01, 0.03); th.rotation.z = sd * 0.7; th.scale.set(1.6, 0.9, 1.6); hand.add(th);
    g.add(sh);
    return { sh, el, hand };
  };
  const armL = arm(-1), armR = arm(1);
  g.position.set(0, 0, -0.75);
  return { group: g, kind, torso, head, eyes, brows, mouths, armL, armR, hair: hair.name, clothes: chest.name };
}



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

  // (one kind of material for everything on screen at first: one shader to build, so the first draw is quick)
  const M = (o = {}) => new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, ...o });
  const mats = {
    wall: M(), sky: M({ roughness: 1 }), frame: M(), desk: M(), deskFront: M(),
    page: M({ roughness: 1 }), cover: M(), book1: M(), book2: M(), book3: M(), lamp: M({ roughness: 0.5 }), bulb: M({ color: 0x000000 }),
    sun: M({ color: 0x000000 }), cloud: M({ roughness: 1 }), card: M({ roughness: 0.6 }), glass: M({ transparent: true, opacity: 0.45, roughness: 0.2 }),
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

  // the student, behind the desk (rebuilt when the profile changes: boy, girl or neither)
  const K = {
    skin: new THREE.MeshStandardMaterial({ roughness: 0.6 }), hair: new THREE.MeshStandardMaterial({ roughness: 0.75 }),
    sclera: new THREE.MeshStandardMaterial({ roughness: 0.3 }), iris: new THREE.MeshStandardMaterial({ roughness: 0.3 }), pupil: new THREE.MeshStandardMaterial({ roughness: 0.3 }),
    lip: new THREE.MeshStandardMaterial({ roughness: 0.6 }), mouth: new THREE.MeshStandardMaterial({ roughness: 0.7 }),
    hoodie: new THREE.MeshStandardMaterial({ roughness: 0.9 }), hoodie2: new THREE.MeshStandardMaterial({ roughness: 0.9 }), string: new THREE.MeshStandardMaterial({ roughness: 0.6 }),
    jacket: new THREE.MeshStandardMaterial({ roughness: 0.8 }), top: new THREE.MeshStandardMaterial({ roughness: 0.9 }),
    jeans: new THREE.MeshStandardMaterial({ roughness: 0.85 }), cuff: new THREE.MeshStandardMaterial({ roughness: 0.85 }), shoe: new THREE.MeshStandardMaterial({ roughness: 0.8 }), sole: new THREE.MeshStandardMaterial({ roughness: 0.6 }),
  };
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
  const card = at(box(0.4, 0.27, 0.015, mats.card), 0.36, 0.72, 0.08);
  const beaker = new THREE.Group(); beaker.position.set(-0.68, 0.06, 0.38);
  beaker.add(at(cyl(0.13, 0.13, 0.34, mats.glass, 14), 0, 0.17, 0), at(cyl(0.115, 0.115, 0.18, mats.liquid, 14), 0, 0.1, 0));
  const bubbles = Array.from({ length: 6 }, (_, i) => { const b = at(ball(0.03, mats.glass), (i % 3 - 1) * 0.05, 0.1, (i % 2) * 0.04); beaker.add(b); return b; });
  const clock = new THREE.Group(); clock.position.set(1.2, 0.95, -0.6);
  const face = cyl(0.26, 0.26, 0.06, mats.clock, 20); face.rotation.x = Math.PI / 2; clock.add(face);
  const hourH = new THREE.Group(), minH = new THREE.Group();
  hourH.add(at(box(0.03, 0.13, 0.02, mats.hand), 0, 0.06, 0)); minH.add(at(box(0.02, 0.19, 0.02, mats.hand), 0, 0.09, 0));
  hourH.position.z = minH.position.z = 0.05; clock.add(hourH, minH);
  const notebook = new THREE.Group(); notebook.position.set(0.42, 0.07, 0.02); notebook.rotation.y = -0.3;
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

  S = { renderer, canvas, scene, camera, mats, K, kid: null, gender: null, turn, clouds, props, bubbles, hourH, minH, pencil, confetti, lampLight,
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
  mats.wall.color.copy(mix(bg, primary, dark ? 0.16 : 0.12));
  mats.sky.color.copy(mix(secondary, surface, dark ? 0.15 : 0.55));
  mats.frame.color.copy(dark ? mix(surface, text, 0.3) : mix(surface, text, 0.06));
  const ink = mono ? new THREE.Color(0x1b1b1d) : new THREE.Color(0x2a201c);
  mats.desk.color.copy(dark ? mix(secondary, bg, 0.45) : mix(secondary, text, 0.42));
  mats.deskFront.color.copy(dark ? mix(secondary, bg, 0.6) : mix(secondary, text, 0.55));
  mats.pot.color.copy(mix(primary, surface, dark ? 0.1 : 0.35));
  mats.leaf.color.copy(mono ? mix(secondary, surface, 0.2) : mix(secondary, new THREE.Color(0x4caf50), 0.35));
  mats.poster.color.copy(mix(surface, secondary, 0.12));
  paintStudent(mono);
  mats.page.color.copy(dark ? mix(text, surface, 0.12) : mix(surface, bg, 0.2));
  mats.cover.color.copy(mix(primary, text, 0.3));
  mats.book1.color.copy(primary); mats.book2.color.copy(secondary); mats.book3.color.copy(mix(primary, surface, 0.45));
  mats.lamp.color.copy(mix(surface, text, 0.25));
  mats.bulb.emissive.copy(mono ? new THREE.Color(0xffffff) : new THREE.Color(0xfff1c9)); // (they glow: lit by nothing)
  mats.sun.emissive.copy(mono ? mix(surface, text, 0.08) : mix(new THREE.Color(0xffe39a), surface, 0.2));
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

// the student's colours: natural skin, eyes and hair always; clothes in colour, or in Graphite greys
// in Monochrome (a hoodie for a boy, an open mustard jacket for a girl, a grey hoodie otherwise)
function paintStudent(mono) {
  const { K } = S, kind = S.kid ? S.kid.kind : 'kid', c = (k, hex) => K[k].color.setHex(hex);
  c('skin', kind === 'girl' ? 0xf3c3a0 : kind === 'boy' ? 0xeaa97e : 0xefb68e);
  c('hair', kind === 'girl' ? 0x6b4128 : kind === 'boy' ? 0x3a2416 : 0x2f241e);
  c('sclera', 0xffffff); c('iris', 0x6b3c1c); c('pupil', 0x170d08); c('lip', 0xa04a42); c('mouth', 0x5a1c1c);
  if (mono) {
    c('hoodie', kind === 'boy' ? 0x3e3e45 : 0x63636e); c('hoodie2', kind === 'boy' ? 0x232327 : 0x3e3e45); c('string', 0xf2f2f5);
    c('jacket', 0x63636e); c('top', 0xc9c9d2); c('jeans', 0x232327); c('cuff', 0x3e3e45); c('shoe', 0x232327); c('sole', 0xf2f2f5);
  } else {
    c('hoodie', kind === 'boy' ? 0x2b4aa0 : 0x63636e); c('hoodie2', kind === 'boy' ? 0x223b80 : 0x4f4f58); c('string', 0xece6da);
    c('jacket', 0xdc9f3a); c('top', 0xeee6d6); c('jeans', 0x46679a); c('cuff', 0x6f8cb8); c('shoe', kind === 'girl' ? 0x2f8f8a : 0x26375f); c('sole', 0xf4f1ea);
  }
}
function setStudent(gender) {
  const g = gender === 'male' || gender === 'female' ? gender : 'none';
  if (S.kid && S.gender === g) return;
  if (S.kid) { S.scene.remove(S.kid.group); S.kid.group.traverse((o) => { if (o.geometry && !Object.values(UNIT).includes(o.geometry)) o.geometry.dispose(); }); }
  S.gender = g;
  S.kid = makeStudent(g, S.K);
  S.scene.add(S.kid.group);
  paintStudent(document.documentElement.dataset.pal === 'mono');
}

function fit() {
  if (!S || !S.host) return;
  const w = Math.max(1, S.host.clientWidth), h = Math.max(1, S.host.clientHeight);
  S.renderer.setSize(w, h, false);
  const aspect = w / h;
  S.camera.aspect = aspect;
  // wider screens: the room sits to the right of the greeting, and a little further back
  const wide = Math.max(0, aspect - 1.8);
  S.camera.position.set(-0.1 - wide * 0.5, 1.7, 4.1 + wide * 0.3);
  S.camera.lookAt(-wide * 0.5 + 0.05, 0.86, -0.5);
  S.camera.fov = aspect < 1.4 ? 38 : 31;
  S.camera.updateProjectionMatrix();
}

const ease = (k) => k * k * (3 - 2 * k);
const bump = (p, a = 0.15, b = 0.8) => (p < a ? ease(p / a) : p > b ? 1 - ease((p - b) / (1 - b)) : 1); // up, hold, down

// the face: which mouth shows, the brows (up, down, a frown, one raised) and how closed the lids are
function face(kid, { mouth = 'small', brow = 0, frown = 0, curious = 0, lid = 0 } = {}) {
  Object.entries(kid.mouths).forEach(([k, m]) => { m.visible = k === mouth; });
  kid.brows.forEach((b) => { const sd = b.userData.sd; b.position.y = 0.17 + brow + (curious && sd < 0 ? curious : 0); b.rotation.z = Math.PI / 2 + sd * frown; });
  kid.eyes.forEach((e) => { e.userData.lid.rotation.x = -1.2 + Math.min(1, Math.max(0, lid)) * 2.65; });
  kid.face = { mouth, brow: +(brow + curious).toFixed(3), frown: +frown.toFixed(2), lid: +lid.toFixed(2) };
}
// an arm's pose: the shoulder (forward or up, in or out) and the elbow's bend
const pose = (a, sx, sz, el, sy = 0) => { a.sh.rotation.set(sx, sy, sz); a.el.rotation.set(el, 0, 0); };

function frame(now) {
  S.raf = 0;
  if (!S.host || !S.host.isConnected || document.hidden || !S.onScreen) return; // (wakes when seen again)
  const t = (now - S.t0) / 1000;
  const { kid, turn, clouds, props, bubbles, hourH, minH, pencil, confetti } = S;
  const { group, torso, head, armL, armR } = kid;
  // breathing, a slow look around, clouds drifting
  const br = Math.sin(t * 1.7);
  torso.scale.set(1 + br * 0.012, 1 + br * 0.02, 1 + br * 0.012);
  head.position.y = 1.12 + br * 0.01;
  head.rotation.set(0.14 + Math.sin(t * 0.6) * 0.03, Math.sin(t * 0.45) * 0.14, Math.sin(t * 0.5) * 0.03);
  clouds[0].position.x = -0.42 + Math.sin(t * 0.15) * 0.12; clouds[1].position.x = 0.3 + Math.sin(t * 0.12 + 2) * 0.1;
  // reading: forearms on the desk, hands by the book
  pose(armL, -0.35, 0.15, -1.1); pose(armR, -0.35, -0.15, -1.1);
  group.position.set(0, 0, -0.75); group.rotation.set(0, 0, 0);
  // a blink every 3 to 6 seconds
  if (now >= S.nextBlink) { S.blinkAt = now; S.nextBlink = now + 3000 + Math.random() * 3000; }
  const bk = (now - S.blinkAt) / 180, blink = bk >= 0 && bk < 1 ? Math.sin(bk * Math.PI) : 0;
  // a page turns every few seconds
  if (now >= S.nextTurn) { S.turnAt = now; S.nextTurn = now + 4500 + Math.random() * 3000; }
  const tp = (now - S.turnAt) / 900;
  turn.rotation.z = tp >= 0 && tp < 1 ? Math.PI * ease(tp) : 0;
  turn.visible = !(tp >= 1 && tp < 1.05);
  // the moment a button played (about a second), with its own face
  Object.values(props).forEach((p) => { p.visible = false; });
  confetti.forEach((p) => { p.visible = false; });
  let f = { mouth: 'small', lid: blink };
  const m = S.moment;
  if (m) {
    const p = (now - m.at) / 1100;
    if (p >= 1) { S.moment = null; if (S.host) S.host.dataset.pose = 'idle'; } else {
      const k = bump(p);
      if (m.kind === 'ask') { // hand up, brows up, an open smile
        pose(armR, -0.35 - k * 2.6, -0.15 + k * 0.4, -1.1 + k * 1.05); head.rotation.x -= k * 0.2;
        f = { mouth: 'open', brow: 0.035 * k, lid: blink };
      }
      if (m.kind === 'cards') { // flips the card, curious
        props.card.visible = true; props.card.scale.setScalar(Math.max(0.01, k)); props.card.rotation.set(-0.3, ease(Math.min(1, p / 0.8)) * Math.PI, 0);
        pose(armR, -0.35 - k * 0.9, -0.15 + k * 0.05, -1.1 + k * 0.4); head.rotation.z += k * 0.12; head.rotation.y += k * 0.2;
        f = { mouth: 'small', curious: 0.04 * k, lid: blink };
      }
      if (m.kind === 'lab') { // leans to the beaker, an "o"
        props.beaker.visible = true; props.beaker.scale.setScalar(Math.max(0.01, k * 1.5)); bubbles.forEach((b, i) => { const q = (p * 2.4 + i / 6) % 1; b.position.y = 0.1 + q * 0.32; b.scale.setScalar(1 - q * 0.5); });
        group.rotation.y = -0.25 * k; group.position.z = -0.75 + 0.1 * k; head.rotation.y -= 0.25 * k; head.rotation.x += 0.12 * k;
        f = { mouth: 'o', brow: 0.025 * k, lid: blink };
      }
      if (m.kind === 'timer') { // focused: leaning in, narrowed eyes, a slight frown
        props.clock.visible = true; props.clock.scale.setScalar(Math.max(0.01, k * 1.2)); minH.rotation.z = -p * Math.PI * 4; hourH.rotation.z = -p * Math.PI / 3;
        group.position.z = -0.75 + 0.12 * k; head.rotation.x += 0.18 * k;
        f = { mouth: 'flat', brow: -0.02 * k, frown: 0.3 * k, lid: Math.max(blink, 0.45 * k) };
      }
      if (m.kind === 'streak') { // both arms up, a laugh with happy closed eyes
        confetti.forEach((c) => { c.visible = true; const v = c.userData.v; c.position.set(v.x * p, 1.4 + v.y * p - 2.6 * p * p, -0.6 + v.z * p); c.rotation.set(c.userData.s * p, c.userData.s * p * 0.7, 0); });
        pose(armL, -0.35 - k * 2.35, 0.15 - k * 0.6, -1.1 + k * 0.9); pose(armR, -0.35 - k * 2.35, -0.15 + k * 0.6, -1.1 + k * 0.9);
        group.position.y = Math.sin(p * Math.PI) * 0.1; head.rotation.x -= 0.15 * k;
        f = { mouth: 'laugh', brow: 0.03 * k, lid: 0.95 * k };
      }
      if (m.kind === 'write') { // looks down at the notebook, a small smile
        props.notebook.visible = true; props.notebook.scale.setScalar(Math.max(0.01, k * 1.25)); pencil.position.x = 0.05 + Math.sin(p * 30) * 0.06 * k;
        pose(armR, -0.45, -0.25, -1.05, Math.sin(p * 30) * 0.12 * k); head.rotation.x += 0.28 * k; head.rotation.y += 0.15 * k;
        f = { mouth: 'smile', lid: Math.max(blink, 0.25 * k) };
      }
    }
  }
  face(kid, f);
  S.renderer.render(S.scene, S.camera);
  if (++S.frames % 10 === 0) S.canvas.dataset.frames = String(S.frames);
  S.raf = requestAnimationFrame(frame);
}
function wake() { if (S && !S.raf) S.raf = requestAnimationFrame(frame); }

// Show the scene in host (Home's header). The same picture moves to each new Home.
export function attach(host, { gender } = {}) {
  if (!S) build();
  setStudent(gender);
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

// what the student is wearing and how the face looks right now (for the tests)
export function describe() {
  if (!S || !S.kid) return null;
  const { kind, hair, clothes } = S.kid;
  return { kind, hair, clothes, face: S.kid.face || null, pose: S.moment ? S.moment.kind : 'idle' };
}

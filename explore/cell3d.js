/* Explore 3D — an animal cell and a plant cell you can turn, zoom and tap.
   Every shape is drawn here in code (no model files to download), and the cells are cut
   open so you can see inside. Tap a part to learn what it does, then ask Cassie about it
   or start a quiz. Works with a mouse and with touch (drag to turn, pinch to zoom).

     import('./explore/cell3d.js').then((m) => m.open({ cell: 'animal', onAsk, onQuiz, onClose }));
*/
import * as THREE from './three.module.min.js';
import { OrbitControls } from './OrbitControls.js';
import { RoomEnvironment } from './RoomEnvironment.js';
import { RoundedBoxGeometry } from './RoundedBoxGeometry.js';
import { PARTS, CELLS } from './cells.js';
import { createBody, SYSTEMS } from './body3d.js';
import { factFor } from './body-facts.js';

let view = null; // kept after closing, so opening again is instant

export function supported() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; }
}

export function open(opts = {}) {
  if (!view) view = createView();
  view.open(opts);
  return view;
}

/* ---------- small helpers ---------- */
function rng(seed) { // repeatable random numbers, so the cells look the same every time
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const V = (x, y, z) => new THREE.Vector3(x, y, z);
// The cut: the quarter of each shell facing the viewer (x > 0 and z > 0) is removed.
const CUT = [new THREE.Plane(V(-1, 0, 0), 0), new THREE.Plane(V(0, 0, -1), 0)];
const inCut = (p, margin = 0) => p.x > -margin && p.z > -margin;

// A lumpy sphere: cells and organelles are never perfectly round.
function blobGeo(r, amp, seed, w = 64, h = 44) {
  const g = new THREE.SphereGeometry(r, w, h);
  const pos = g.attributes.position, v = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i); n.copy(v).normalize();
    const d = amp * (Math.sin(n.x * 3.1 + seed) * Math.cos(n.y * 2.3 + seed * 1.7) + 0.6 * Math.sin(n.z * 4.2 + seed * 0.5) + 0.3 * Math.sin((n.x + n.y) * 6 + seed));
    v.addScaledVector(n, d); pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

/* ---------- building a cell ---------- */
function makeBuilder(kind) {
  const group = new THREE.Group();
  const parts = new Map(); // part id -> { objects: [], materials: Set, anchor: Vector3 }
  const placed = []; // { p, r } so organelles don't overlap
  const rand = rng(kind === 'animal' ? 11 : 23);
  const part = (id) => { if (!parts.has(id)) parts.set(id, { objects: [], materials: new Set(), anchor: null }); return parts.get(id); };
  const mat = (id, o = {}) => {
    const color = new THREE.Color(o.color || PARTS[id].color);
    const opacity = o.opacity ?? 1;
    const m = new THREE.MeshPhysicalMaterial({
      color, roughness: o.rough ?? 0.42, metalness: 0, clearcoat: o.clearcoat ?? 0.7, clearcoatRoughness: 0.28,
      sheen: o.sheen ?? 0.25, sheenColor: new THREE.Color('#ffffff'), transparent: opacity < 1, opacity,
      side: o.side ?? THREE.FrontSide, depthWrite: opacity >= 0.9,
    });
    m.userData = { base: opacity, clip: !!o.clip, color: color.clone() };
    if (o.clip) { m.clippingPlanes = CUT; m.clipIntersection = true; }
    part(id).materials.add(m);
    return m;
  };
  const add = (id, obj, anchor) => {
    obj.traverse((o) => { o.userData.part = id; });
    group.add(obj);
    const p = part(id);
    p.objects.push(obj);
    // label at the copy nearest the viewer's side (but not inside the removed quarter)
    const a = anchor || obj.position;
    if (!p.anchor || (a.x + a.z + a.y * 0.3 > p.anchor.x + p.anchor.z + p.anchor.y * 0.3)) p.anchor = a.clone();
    return obj;
  };
  // a random spot where something of radius r fits
  const spot = (r, fits, tries = 400) => {
    for (let i = 0; i < tries; i++) {
      const p = fits.random();
      if (!fits.ok(p, r) || inCut(p, r)) continue;
      if (placed.some((q) => q.p.distanceTo(p) < q.r + r + 0.15)) continue;
      placed.push({ p, r });
      return p;
    }
    return null;
  };
  const randomTilt = (o) => { o.rotation.set(rand() * Math.PI, rand() * Math.PI, rand() * Math.PI); return o; };
  return { group, parts, part, rand, mat, add, spot, placed, randomTilt, kind };
}

// Organelles shared by both cells
function mitochondrion(b, p, scale = 1) {
  const g = new THREE.Group();
  const outer = new THREE.Mesh(new THREE.CapsuleGeometry(0.3 * scale, 0.75 * scale, 8, 18), b.mat('mito', { opacity: 0.62 }));
  const pts = [];
  for (let i = 0; i <= 9; i++) pts.push(V((i % 2 ? 0.17 : -0.17) * scale, (-0.5 + i / 9) * 0.95 * scale, 0));
  const cristae = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, 0.06 * scale, 8), b.mat('mito', { color: '#ffd29a', clearcoat: 0.3 }));
  g.add(outer, cristae);
  g.position.copy(p); b.randomTilt(g);
  return b.add('mito', g);
}
function golgi(b, p, size = 1) {
  const g = new THREE.Group();
  const m = b.mat('golgi');
  const widths = [0.62, 0.8, 0.9, 0.84, 0.68];
  widths.forEach((w, i) => {
    const geo = new THREE.CylinderGeometry(w * size, w * size, 0.07 * size, 32, 1);
    const pos = geo.attributes.position;
    for (let k = 0; k < pos.count; k++) { const x = pos.getX(k), z = pos.getZ(k); pos.setY(k, pos.getY(k) + 0.45 * (x * x + z * z * 0.3) / size); }
    geo.computeVertexNormals();
    const disc = new THREE.Mesh(geo, m);
    disc.position.y = (i - 2) * 0.16 * size;
    disc.scale.set(1, 1, 0.55);
    g.add(disc);
  });
  const vm = b.mat('vesicle');
  for (let i = 0; i < 6; i++) {
    const v = new THREE.Mesh(new THREE.SphereGeometry(0.09 * size, 12, 8), vm);
    const side = i % 2 ? 1 : -1;
    v.position.set(side * (0.95 + b.rand() * 0.25) * size, (b.rand() - 0.3) * 0.5 * size, (b.rand() - 0.5) * 0.4 * size);
    v.userData.part = 'vesicle';
    g.add(v);
  }
  g.position.copy(p); g.rotation.set(0.3, b.rand() * Math.PI, 0.25);
  b.add('golgi', g);
  g.children.forEach((c) => { if (c.material === vm) { c.userData.part = 'vesicle'; b.parts.get('vesicle').objects.push(c); } });
  return g;
}
function nucleus(b, c, r) {
  const env = new THREE.Mesh(blobGeo(r, 0.04, 3, 48, 32), b.mat('envelope', { opacity: 0.5, clip: true, side: THREE.DoubleSide }));
  env.position.copy(c);
  b.add('envelope', env, c.clone().add(V(-0.2, r * 0.95, 0.3)));
  const inner = new THREE.Mesh(new THREE.SphereGeometry(r * 0.94, 48, 32), b.mat('nucleus', { opacity: 0.9, clip: true, side: THREE.DoubleSide, rough: 0.6 }));
  inner.position.copy(c);
  b.add('nucleus', inner, c.clone().add(V(r * 0.2, -r * 0.6, r * 0.55)));
  const nl = new THREE.Mesh(blobGeo(r * 0.36, 0.05, 9, 32, 24), b.mat('nucleolus'));
  nl.position.copy(c).add(V(r * 0.25, 0.05, r * 0.25));
  b.add('nucleolus', nl);
  // nuclear pores
  const pore = new THREE.TorusGeometry(0.07, 0.025, 6, 12);
  const pm = b.mat('envelope', { color: '#5e3fc0' });
  const n = 70, im = new THREE.InstancedMesh(pore, pm, n), m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
  let k = 0;
  for (let i = 0; i < 400 && k < n; i++) {
    const d = V(b.rand() * 2 - 1, b.rand() * 2 - 1, b.rand() * 2 - 1).normalize();
    const p = c.clone().addScaledVector(d, r * 1.01);
    if (inCut(p, 0.05)) continue;
    q.setFromUnitVectors(V(0, 0, 1), d);
    im.setMatrixAt(k++, m4.compose(p, q, V(1, 1, 1)));
  }
  im.count = k;
  b.add('envelope', im, c.clone().add(V(-0.2, r * 0.95, 0.3)));
}
function roughER(b, c, r, sheets = 3, span = 2.3) {
  const m = b.mat('rer', { side: THREE.DoubleSide, opacity: 0.88 });
  const g = new THREE.Group();
  const ribo = [];
  for (let s = 0; s < sheets; s++) {
    const rr = r + 0.35 + s * 0.27;
    const phiStart = -span / 2 + s * 0.15, phiLen = span - s * 0.3, thStart = 0.55 + s * 0.08, thLen = 1.7 - s * 0.15;
    const geo = new THREE.SphereGeometry(rr, 48, 24, phiStart, phiLen, thStart, thLen);
    const pos = geo.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i); const n = v.clone().normalize(); v.addScaledVector(n, 0.07 * Math.sin(v.y * 7 + s) * Math.cos(v.x * 5)); pos.setXYZ(i, v.x, v.y, v.z); }
    geo.computeVertexNormals();
    g.add(new THREE.Mesh(geo, m));
    for (let i = 0; i < 70; i++) {
      const phi = phiStart + b.rand() * phiLen, th = thStart + b.rand() * thLen;
      ribo.push(V(-(rr + 0.05) * Math.cos(phi) * Math.sin(th), (rr + 0.05) * Math.cos(th), (rr + 0.05) * Math.sin(phi) * Math.sin(th)).add(c));
    }
  }
  g.position.copy(c);
  g.children.forEach((mesh) => mesh.position.set(0, 0, 0));
  b.add('rer', g, c.clone().add(V(-(r + 0.6), 0.4, 0.2)));
  ribosomes(b, ribo, 0.036);
}
function ribosomes(b, points, size = 0.05) {
  if (!points.length) return;
  const im = new THREE.InstancedMesh(new THREE.SphereGeometry(size, 6, 4), b.mat('ribosome', { clearcoat: 0.1 }), points.length);
  const m4 = new THREE.Matrix4();
  points.forEach((p, i) => im.setMatrixAt(i, m4.makeTranslation(p.x, p.y, p.z)));
  b.add('ribosome', im, points.reduce((best, p) => (!inCut(p) && p.x + p.z > best.x + best.z ? p : best), points[0]));
}
function smoothER(b, start, count, fits) {
  const m = b.mat('ser', { opacity: 0.95 });
  const g = new THREE.Group();
  for (let t = 0; t < count; t++) {
    const pts = [start.clone().add(V((b.rand() - 0.5) * 0.8, (b.rand() - 0.5) * 0.8, (b.rand() - 0.5) * 0.8))];
    let dir = V(b.rand() - 0.5, b.rand() - 0.5, b.rand() - 0.5).normalize();
    for (let i = 0; i < 6; i++) {
      dir.add(V(b.rand() - 0.5, b.rand() - 0.5, b.rand() - 0.5).multiplyScalar(0.9)).normalize();
      const next = pts[pts.length - 1].clone().addScaledVector(dir, 0.45);
      if (!fits.ok(next, 0.15) || inCut(next, 0.15)) { dir.negate(); continue; }
      pts.push(next);
    }
    if (pts.length < 3) continue;
    g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.075, 8), m));
  }
  return b.add('ser', g, start.clone());
}
function smallSacs(b, id, n, r, fits, extra) {
  for (let i = 0; i < n; i++) {
    const p = b.spot(r, fits);
    if (!p) continue;
    const g = new THREE.Group();
    g.add(new THREE.Mesh(blobGeo(r, r * 0.08, i + 1, 20, 14), b.mat(id, { opacity: 0.85 })));
    if (extra) g.add(extra(r));
    g.position.copy(p);
    b.add(id, g);
  }
}
function cytoskeleton(b, n, fits) {
  const m = new THREE.LineBasicMaterial({ color: PARTS.cytoskeleton.color, transparent: true, opacity: 0.45 });
  m.userData = { base: 0.45, color: new THREE.Color(PARTS.cytoskeleton.color), line: true };
  b.part('cytoskeleton').materials.add(m);
  const g = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const a = fits.random(), c = fits.random();
    if (!fits.ok(a, 0) || !fits.ok(c, 0) || inCut(a) || inCut(c)) continue;
    const mid = a.clone().lerp(c, 0.5).add(V(b.rand() - 0.5, b.rand() - 0.5, b.rand() - 0.5));
    const pts = new THREE.CatmullRomCurve3([a, mid, c]).getPoints(24);
    g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), m));
  }
  b.add('cytoskeleton', g, V(-2.2, -2.4, 1.6));
}

function buildAnimal() {
  const b = makeBuilder('animal');
  const R = 5;
  b.add('membrane', new THREE.Mesh(blobGeo(R, 0.22, 1.3), b.mat('membrane', { opacity: 0.3, clip: true, side: THREE.DoubleSide, rough: 0.22 })), V(-1.6, 4.1, 2.2));
  b.add('cytoplasm', new THREE.Mesh(blobGeo(R - 0.2, 0.2, 1.3), b.mat('cytoplasm', { opacity: 0.12, clip: true, side: THREE.BackSide, clearcoat: 0 })), V(2.6, -1.4, -0.3));
  const nc = V(-0.35, 0.25, -0.35), nr = 1.55;
  nucleus(b, nc, nr);
  b.placed.push({ p: nc, r: nr + 1.0 });
  const fits = {
    random: () => V(b.rand() * 8.6 - 4.3, b.rand() * 8.6 - 4.3, b.rand() * 8.6 - 4.3),
    ok: (p, r) => p.length() < 4.15 - r && p.distanceTo(nc) > nr + 0.95 + r,
  };
  roughER(b, nc, nr);
  const gp = V(-0.8, -2.3, 1.9); // beside the nucleus, facing the cut, where proteins leave the ER
  golgi(b, gp, 1); b.placed.push({ p: gp, r: 1.0 });
  smoothER(b, V(-2.6, 1.9, 1.3), 5, fits);
  b.placed.push({ p: V(-2.6, 1.9, 1.3), r: 1.0 });
  for (let i = 0; i < 7; i++) { const p = b.spot(0.6, fits); if (p) mitochondrion(b, p); }
  smallSacs(b, 'lysosome', 5, 0.3, fits, (r) => { const d = new THREE.Mesh(new THREE.IcosahedronGeometry(r * 0.45, 0), b.mat('lysosome', { color: '#8a6410' })); return d; });
  smallSacs(b, 'peroxisome', 4, 0.26, fits, (r) => new THREE.Mesh(new THREE.BoxGeometry(r * 0.7, r * 0.7, r * 0.7), b.mat('peroxisome', { color: '#5f7417' })));
  smallSacs(b, 'vesicle', 7, 0.14, fits);
  // centrioles: two bundles of 9 tubes, at right angles
  const cp = b.spot(0.45, fits);
  if (cp) {
    const g = new THREE.Group(), m = b.mat('centrioles');
    [0, 1].forEach((k) => {
      const bundle = new THREE.Group();
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        const t = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.5, 8), m);
        t.position.set(Math.cos(a) * 0.13, 0, Math.sin(a) * 0.13);
        bundle.add(t);
      }
      if (k) { bundle.rotation.x = Math.PI / 2; bundle.position.set(0.3, 0, 0); }
      g.add(bundle);
    });
    g.position.copy(cp); g.rotation.set(0.4, 0.7, 0.2);
    b.add('centrioles', g);
  }
  const free = [];
  for (let i = 0; i < 900 && free.length < 170; i++) { const p = fits.random(); if (fits.ok(p, 0.05) && !inCut(p, 0.05)) free.push(p); }
  ribosomes(b, free, 0.038);
  cytoskeleton(b, 34, fits);
  return { ...b, camera: V(8.6, 5.2, 10.6), radius: 6, fit: 5.4 };
}

function buildPlant() {
  const b = makeBuilder('plant');
  const W = 10, H = 7, D = 7;
  b.add('wall', new THREE.Mesh(new RoundedBoxGeometry(W, H, D, 5, 0.9), b.mat('wall', { opacity: 0.5, clip: true, side: THREE.DoubleSide, rough: 0.6, clearcoat: 0.2 })), V(-2.4, H / 2, 1.4));
  b.add('membrane', new THREE.Mesh(new RoundedBoxGeometry(W - 0.45, H - 0.45, D - 0.45, 5, 0.75), b.mat('membrane', { opacity: 0.35, clip: true, side: THREE.DoubleSide, rough: 0.22 })), V(-4.0, H / 2 - 0.25, 2.6));
  b.add('cytoplasm', new THREE.Mesh(new RoundedBoxGeometry(W - 0.75, H - 0.75, D - 0.75, 5, 0.65), b.mat('cytoplasm', { opacity: 0.1, clip: true, side: THREE.BackSide, clearcoat: 0 })), V(3.4, -2.6, -0.4));
  // the big central vacuole
  const vc = V(0.6, -0.25, 0.2), vs = V(3.0, 1.95, 1.95);
  const vac = new THREE.Mesh(blobGeo(1, 0.05, 5, 48, 32), b.mat('vacuole', { opacity: 0.38, clip: true, side: THREE.DoubleSide, rough: 0.15 }));
  vac.position.copy(vc); vac.scale.copy(vs);
  b.add('vacuole', vac, V(2.2, 1.5, -0.4));
  const nc = V(-3.0, 1.15, -1.3), nr = 1.05;
  nucleus(b, nc, nr);
  b.placed.push({ p: nc, r: nr + 0.6 });
  const fits = {
    random: () => V(b.rand() * (W - 1.6) - (W - 1.6) / 2, b.rand() * (H - 1.6) - (H - 1.6) / 2, b.rand() * (D - 1.6) - (D - 1.6) / 2),
    ok: (p, r) => Math.abs(p.x) < W / 2 - 0.75 - r && Math.abs(p.y) < H / 2 - 0.75 - r && Math.abs(p.z) < D / 2 - 0.75 - r
      && ((p.x - vc.x) / (vs.x + r + 0.2)) ** 2 + ((p.y - vc.y) / (vs.y + r + 0.2)) ** 2 + ((p.z - vc.z) / (vs.z + r + 0.2)) ** 2 > 1
      && p.distanceTo(nc) > nr + 0.6 + r,
  };
  roughER(b, nc, nr, 2, 1.9);
  const gp = b.spot(0.75, fits, 2000); if (gp) golgi(b, gp, 0.75);
  // chloroplasts: green lenses with stacks of thylakoids (grana) inside
  for (let i = 0; i < 11; i++) {
    const p = b.spot(0.62, fits);
    if (!p) continue;
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 18), b.mat('chloroplast', { opacity: 0.6 }));
    body.scale.set(0.62, 0.32, 0.36);
    g.add(body);
    const gm = b.mat('chloroplast', { color: '#1f6e2c', clearcoat: 0.3 });
    for (let s = 0; s < 4; s++) {
      for (let k = 0; k < 4; k++) {
        const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.03, 14), gm);
        disc.position.set(-0.36 + s * 0.24, -0.06 + k * 0.045, 0);
        g.add(disc);
      }
    }
    g.position.copy(p); b.randomTilt(g);
    b.add('chloroplast', g);
  }
  for (let i = 0; i < 4; i++) { const p = b.spot(0.5, fits); if (p) mitochondrion(b, p, 0.8); }
  smoothER(b, V(-3.4, -1.6, 1.2), 3, fits);
  smallSacs(b, 'peroxisome', 3, 0.22, fits, (r) => new THREE.Mesh(new THREE.BoxGeometry(r * 0.7, r * 0.7, r * 0.7), b.mat('peroxisome', { color: '#5f7417' })));
  const free = [];
  for (let i = 0; i < 900 && free.length < 110; i++) { const p = fits.random(); if (fits.ok(p, 0.05) && !inCut(p, 0.05)) free.push(p); }
  ribosomes(b, free, 0.038);
  // plasmodesmata: little channels through the wall
  const pm = b.mat('plasmodesmata');
  const pg = new THREE.Group();
  const holes = [[-W / 2, 1.2, -1.5, 'x'], [-W / 2, -1.4, 0.4, 'x'], [-W / 2, 0.2, -2.6, 'x'], [-2.5, H / 2, -1.8, 'y'], [-0.8, H / 2, -2.5, 'y'], [1.8, H / 2, -2.2, 'y'], [-3.8, -1.5, -D / 2, 'z'], [-1.2, 1.6, -D / 2, 'z']];
  holes.forEach(([x, y, z, axis]) => {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.75, 10), pm);
    c.position.set(x, y, z);
    if (axis === 'x') c.rotation.z = Math.PI / 2; else if (axis === 'z') c.rotation.x = Math.PI / 2;
    pg.add(c);
  });
  b.add('plasmodesmata', pg, V(-2.5, H / 2, -1.8));
  return { ...b, camera: V(10.5, 6.5, 12.5), radius: 7, fit: 6.6 };
}

/* ---------- the viewer ---------- */
function createView() {
  const root = document.createElement('div');
  root.className = 'x3d';
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Explore 3D');
  root.setAttribute('tabindex', '-1');
  root.innerHTML = `
    <canvas class="x3d-canvas" aria-label="3D cell — drag to turn, pinch or scroll to zoom, tap a part"></canvas>
    <div class="x3d-labels" aria-hidden="true"></div>
    <div class="x3d-top">
      <button type="button" class="x3d-btn x3d-close" aria-label="Close">×</button>
      <div class="x3d-switch" role="tablist" aria-label="What to explore">
        <button type="button" role="tab" data-cell="body">Human body</button>
        <button type="button" role="tab" data-cell="animal">Animal cell</button>
        <button type="button" role="tab" data-cell="plant">Plant cell</button>
      </div>
      <div class="x3d-tools">
        <button type="button" class="x3d-btn" data-tool="labels" aria-pressed="true" title="Show or hide the labels">Labels</button>
        <button type="button" class="x3d-btn" data-tool="cut" aria-pressed="true" title="Cut the cell open, or see it whole">Cut open</button>
        <button type="button" class="x3d-btn" data-tool="reset" title="Back to the start">Reset</button>
      </div>
    </div>
    <p class="x3d-hint"></p>
    <div class="x3d-find" hidden>
      <div class="x3d-sex" role="radiogroup" aria-label="Whose body"><button type="button" role="radio" data-sex="boy" aria-checked="true">Boy</button><button type="button" role="radio" data-sex="girl" aria-checked="false">Girl</button></div>
      <input type="search" class="x3d-search" placeholder="Find a part: heart, femur, biceps…" aria-label="Find a part of the body" autocomplete="off">
      <div class="x3d-results" role="listbox" hidden></div>
      <button type="button" class="x3d-btn x3d-showall" hidden>Show hidden parts</button>
    </div>
    <div class="x3d-loading">Building the cell…</div>
    <section class="x3d-sheet" hidden aria-live="polite">
      <button type="button" class="x3d-sheet-x" aria-label="Close">×</button>
      <div class="x3d-sheet-head"><span class="x3d-dot"></span><h3></h3></div>
      <p class="x3d-path" hidden></p>
      <p class="x3d-like"></p>
      <p class="x3d-does"></p>
      <p class="x3d-only"></p>
      <p class="x3d-more" hidden></p>
      <div class="x3d-acts">
        <button type="button" class="x3d-act x3d-act-main" data-act="ask">Ask Cassie about it</button>
        <button type="button" class="x3d-act" data-act="quiz">Quiz me on this cell</button>
        <button type="button" class="x3d-act" data-act="hide" hidden>Hide it</button>
      </div>
      <p class="x3d-credit" hidden>Body: Z-Anatomy, based on BodyParts3D © DBCLS · CC BY-SA 4.0 · <a href="explore/body/ATTRIBUTION.md" target="_blank" rel="noopener">sources</a></p>
    </section>
    <nav class="x3d-parts" aria-label="Parts of the cell"></nav>`;
  document.body.appendChild(root);
  const $ = (s) => root.querySelector(s);
  const canvas = $('.x3d-canvas'), labelsEl = $('.x3d-labels'), sheet = $('.x3d-sheet'), partsEl = $('.x3d-parts'), hint = $('.x3d-hint');

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.localClippingEnabled = true;
  renderer.toneMapping = THREE.NeutralToneMapping; // keeps the organelles' colours true
  renderer.toneMappingExposure = 1.0;
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.add(new THREE.HemisphereLight('#dfefff', '#1a1420', 0.9));
  const key = new THREE.DirectionalLight('#ffffff', 1.6); key.position.set(6, 9, 8); scene.add(key);
  const rim = new THREE.DirectionalLight('#9fc4ff', 0.8); rim.position.set(-8, 3, -6); scene.add(rim);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.enablePan = false; controls.minDistance = 3; controls.maxDistance = 30;
  controls.autoRotate = true; controls.autoRotateSpeed = 0.7;
  controls.addEventListener('start', () => { controls.autoRotate = false; flyTo = null; });

  const cells = {};
  let current = null, kind = 'animal', selected = null, opts = {}, raf = 0, cut = true, flyTo = null, inBody = false, bodyPart = null;
  const findEl = $('.x3d-find'), searchEl = $('.x3d-search'), resultsEl = $('.x3d-results'), showAllEl = $('.x3d-showall');
  const base = new URL('./', import.meta.url).href;
  let dirty = true; // draw again only when something changed (saves the battery)
  const invalidate = () => { dirty = true; };
  controls.addEventListener('change', invalidate);
  const body = createBody({
    scene, camera, controls, base, invalidate,
    setLoading: (text) => { const l = $('.x3d-loading'); l.hidden = !text; if (text) l.textContent = text; },
    showPart: (info) => showBodyPart(info),
    onSystems: () => renderParts(),
  });
  let showLabels = Math.min(window.innerWidth, window.innerHeight) >= 560; // phones: the parts list below names everything
  $('[data-tool="labels"]').setAttribute('aria-pressed', String(showLabels));
  const labelEls = new Map();

  function build(k) {
    if (!cells[k]) { cells[k] = k === 'animal' ? buildAnimal() : buildPlant(); scene.add(cells[k].group); }
    return cells[k];
  }
  function showCell(k) {
    kind = k;
    inBody = k === 'body';
    root.classList.toggle('x3d-body-mode', inBody);
    findEl.hidden = !inBody; hint.hidden = inBody;
    $('[data-tool="labels"]').hidden = inBody; $('[data-tool="cut"]').hidden = inBody;
    camera.near = inBody ? 0.01 : 0.1; camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, inBody ? 1.5 : 2)); // the body has a lot to draw
    invalidate();
    controls.minDistance = inBody ? 0.25 : 3; controls.maxDistance = inBody ? 6 : 30;
    if (inBody) {
      Object.values(cells).forEach((c) => { c.group.visible = false; });
      current = null; selected = null; sheet.hidden = true;
      root.querySelectorAll('[data-cell]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.cell === k)));
      labelsEl.replaceChildren(body.label); labelEls.clear();
      resetView(); renderParts();
      body.enter().then(() => renderParts()).catch(() => {});
      return;
    }
    body.leave(); bodyPart = null;
    $('.x3d-loading').hidden = false; $('.x3d-loading').textContent = 'Building the cell…';
    // let the "Building…" note paint before the work starts
    requestAnimationFrame(() => setTimeout(() => {
      Object.entries(cells).forEach(([name, c]) => { c.group.visible = name === k; });
      current = build(k);
      current.group.visible = true;
      root.querySelectorAll('[data-cell]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.cell === k)));
      hint.textContent = CELLS[k].note;
      select(null);
      setCut(cut);
      resetView();
      renderParts();
      renderLabels();
      $('.x3d-loading').hidden = true;
      invalidate();
    }, 30));
  }
  function resetView() {
    const v = inBody ? body : current;
    if (!v) return;
    // far enough back that the whole cell (or body) fits, wide screen or tall phone
    const half = THREE.MathUtils.degToRad(camera.fov / 2);
    const dist = v.fit / Math.tan(half) / Math.min(1, camera.aspect) ** 0.8 * 1.08;
    const target = inBody ? body.target : new THREE.Vector3();
    camera.position.copy(target).add(v.camera.clone().sub(target).setLength(dist));
    controls.target.copy(target);
    controls.autoRotate = !inBody; // the body stays still until you turn it
    invalidate();
    flyTo = null;
    controls.update();
  }
  function setCut(on) {
    cut = on;
    invalidate();
    $('[data-tool="cut"]').setAttribute('aria-pressed', String(on));
    Object.values(cells).forEach((c) => c.parts.forEach((p) => p.materials.forEach((m) => {
      if (!m.userData.clip) return;
      m.clippingPlanes = on ? CUT : []; m.needsUpdate = true;
    })));
  }
  function renderParts() {
    partsEl.innerHTML = '';
    if (inBody) { // the body: switch whole systems on and off
      partsEl.setAttribute('aria-label', 'Body systems');
      SYSTEMS.forEach((sys) => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'x3d-chip x3d-sys'; b.dataset.sys = sys.id;
        b.setAttribute('aria-pressed', String(body.isOn(sys.id)));
        b.innerHTML = `<span class="x3d-tick" aria-hidden="true"></span>${sys.name}`;
        partsEl.appendChild(b);
        if (sys.id === 'musculoskeletal' && body.isOn(sys.id)) { // bones show; the muscles cover everything, so they're a switch of their own
          const m = document.createElement('button');
          m.type = 'button'; m.className = 'x3d-chip x3d-sys x3d-sub'; m.dataset.muscles = '1';
          m.setAttribute('aria-pressed', String(body.muscles));
          m.innerHTML = '<span class="x3d-tick" aria-hidden="true"></span>+ Muscles';
          partsEl.appendChild(m);
        }
      });
      root.querySelectorAll('.x3d-sex [data-sex]').forEach((x) => x.setAttribute('aria-checked', String(x.dataset.sex === body.sex)));
      return;
    }
    partsEl.setAttribute('aria-label', 'Parts of the cell');
    CELLS[kind].parts.forEach((id) => {
      if (!current.parts.has(id)) return;
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'x3d-chip'; b.dataset.part = id;
      b.innerHTML = `<span class="x3d-dot" style="background:${PARTS[id].color}"></span>${PARTS[id].name}`;
      partsEl.appendChild(b);
    });
  }
  function renderLabels() {
    labelsEl.innerHTML = ''; labelEls.clear();
    CELLS[kind].parts.forEach((id) => {
      const p = current.parts.get(id);
      if (!p || !p.anchor) return;
      const el = document.createElement('span');
      el.className = 'x3d-label'; el.textContent = PARTS[id].name; el.dataset.part = id;
      labelsEl.appendChild(el); labelEls.set(id, el);
    });
  }
  function showBodyPart(info) {
    bodyPart = info;
    const acts = sheet.querySelector('.x3d-acts');
    if (!info) { sheet.hidden = true; return; }
    sheet.querySelector('h3').textContent = info.name;
    sheet.querySelector('.x3d-sheet-head .x3d-dot').style.background = info.color;
    const path = sheet.querySelector('.x3d-path');
    path.hidden = false;
    path.innerHTML = [`<span>${info.system}</span>`, ...info.path.map((g) => `<button type="button" class="x3d-up" data-si="${g.index}" title="Show the whole ${g.name.replace(/"/g, '')}">${g.name.replace(/[<&>]/g, '')}</button>`)].join(' › ');
    // what it is and what it does, right away; Cassie adds the specifics for parts only known by kind
    const fact = factFor(info);
    const esc = (t) => String(t).replace(/[<&>]/g, (c) => ({ '<': '&lt;', '&': '&amp;', '>': '&gt;' }[c]));
    sheet.querySelector('.x3d-like').innerHTML = (fact ? `<b>What it is:</b> ${esc(fact.what)}` : '') + (info.latin ? `<span class="x3d-latin">Latin: ${esc(info.latin)}</span>` : '');
    sheet.querySelector('.x3d-does').innerHTML = fact ? `<b>What it does:</b> ${esc(fact.does)}` : '';
    sheet.querySelector('.x3d-only').hidden = true;
    explainMore(info, !fact || fact.general);
    acts.querySelector('[data-act="quiz"]').textContent = `Quiz me on the ${info.system.toLowerCase()} system`;
    acts.querySelector('[data-act="hide"]').hidden = false;
    sheet.querySelector('.x3d-credit').hidden = false;
    sheet.hidden = false;
    if (info.focus) flyTo = info.focus;
    controls.autoRotate = false;
  }
  // a short, specific explanation from Cassie (kept, so the same part is instant next time)
  let moreFor = '';
  function explainMore(info, want) {
    const el = sheet.querySelector('.x3d-more');
    moreFor = info.id + info.index;
    el.hidden = true;
    if (!want || !opts.explain) return;
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem('cassie.bodyMore') || '{}'); } catch (e) { /* ignore */ }
    const key = info.id;
    const show = (text) => { el.hidden = false; el.classList.remove('muted'); el.innerHTML = '<b>Cassie:</b> '; el.appendChild(document.createTextNode(text)); };
    if (saved[key]) { show(saved[key]); return; }
    const mine = moreFor;
    el.hidden = false; el.classList.add('muted'); el.textContent = 'Cassie is looking it up…';
    const where = info.path.length ? `, in the ${info.path[info.path.length - 1].name.toLowerCase()}` : '';
    opts.explain(`In two short sentences for a high-school student, say exactly what the ${info.name}${info.latin ? ` (${info.latin})` : ''} of the human body is — it is part of the ${info.system.toLowerCase()} system${where} — and what it does. Plain sentences only: no lists, no headings, no formatting, no greeting.`)
      .then((text) => {
        text = String(text || '').replace(/[*_#`>]/g, '').replace(/\s+/g, ' ').trim();
        if (!text) throw new Error('empty');
        if (text.length > 420) text = text.slice(0, 417).replace(/\s+\S*$/, '') + '…';
        try { saved[key] = text; const keys = Object.keys(saved); if (keys.length > 300) delete saved[keys[0]]; localStorage.setItem('cassie.bodyMore', JSON.stringify(saved)); } catch (e) { /* ignore */ }
        if (moreFor === mine && bodyPart) show(text);
      })
      .catch(() => { if (moreFor === mine) el.hidden = true; });
  }
  function select(id) {
    selected = id;
    sheet.querySelector('.x3d-more').hidden = true;
    invalidate();
    sheet.querySelector('.x3d-path').hidden = true;
    sheet.querySelector('[data-act="hide"]').hidden = true;
    sheet.querySelector('.x3d-credit').hidden = true;
    sheet.querySelector('[data-act="quiz"]').textContent = 'Quiz me on this cell';
    if (current) current.parts.forEach((p, pid) => p.materials.forEach((m) => {
      const on = !id || pid === id;
      m.opacity = on ? Math.max(m.userData.base, id ? Math.min(1, m.userData.base + 0.25) : m.userData.base) : m.userData.base * 0.18;
      const t = m.opacity < 1;
      if (m.transparent !== t) { m.transparent = t; m.needsUpdate = true; }
      m.depthWrite = m.opacity >= 0.9;
      if (m.emissive) m.emissive.copy(id && pid === id ? m.userData.color.clone().multiplyScalar(0.35) : new THREE.Color(0));
    }));
    partsEl.querySelectorAll('.x3d-chip').forEach((c) => c.classList.toggle('on', c.dataset.part === id));
    labelEls.forEach((el, pid) => el.classList.toggle('on', pid === id));
    if (!id) { sheet.hidden = true; return; }
    const info = PARTS[id];
    sheet.querySelector('h3').textContent = info.name;
    sheet.querySelector('.x3d-sheet-head .x3d-dot').style.background = info.color;
    sheet.querySelector('.x3d-like').textContent = `Think of it as ${info.like}.`;
    sheet.querySelector('.x3d-does').textContent = info.does;
    const only = sheet.querySelector('.x3d-only');
    only.hidden = !info.only;
    only.textContent = info.only ? `Only in ${info.only} cells.` : '';
    sheet.hidden = false;
    const chip = partsEl.querySelector(`[data-part="${id}"]`);
    if (chip) chip.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    const a = current.parts.get(id).anchor;
    if (a && !['membrane', 'cytoplasm', 'wall'].includes(id)) flyTo = { target: a.clone(), dist: current.radius * 0.95 };
    controls.autoRotate = false;
    if (opts.onSelect) opts.onSelect(id);
  }

  // tap (not drag) → which part?
  const ray = new THREE.Raycaster();
  ray.params.Line.threshold = 0.06;
  let down = null;
  canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
  canvas.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 7 || (!current && !inBody)) return;
    const r = canvas.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
    if (inBody) { body.select(body.pick(ray)); return; }
    const hits = ray.intersectObjects(current.group.children, true);
    for (const h of hits) {
      let o = h.object, id = null;
      while (o && !id) { id = o.userData.part; o = o.parent; }
      if (!id) continue;
      const m = Array.isArray(h.object.material) ? h.object.material[0] : h.object.material;
      if (cut && m && m.userData.clip && inCut(h.point)) continue; // that bit was cut away
      if (m && m.opacity < 0.1) continue;
      select(id === selected && ['membrane', 'cytoplasm', 'wall'].includes(id) ? null : id);
      return;
    }
    select(null);
  });

  partsEl.addEventListener('click', (e) => {
    const s = e.target.closest('[data-sys]');
    if (s && s.dataset.muscles) { const on = !body.muscles; s.setAttribute('aria-pressed', String(on)); body.setMuscles(on).catch(() => {}); return; }
    if (s) { const on = !body.isOn(s.dataset.sys); s.setAttribute('aria-pressed', String(on)); body.setSystem(s.dataset.sys, on).catch(() => {}); if (s.dataset.sys === 'musculoskeletal') renderParts(); return; }
    const b = e.target.closest('[data-part]'); if (b) select(b.dataset.part === selected ? null : b.dataset.part);
  });
  // find a part of the body by name
  let findTimer = 0;
  searchEl.addEventListener('input', () => {
    clearTimeout(findTimer);
    findTimer = setTimeout(() => {
      const res = body.search(searchEl.value.trim());
      resultsEl.innerHTML = res.map((r) => `<button type="button" role="option" data-si="${r.index}"><b>${r.name.replace(/[<&>]/g, '')}</b><span>${r.system}</span></button>`).join('');
      resultsEl.hidden = !res.length;
    }, 120);
  });
  resultsEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-si]');
    if (!b) return;
    resultsEl.hidden = true; searchEl.value = ''; searchEl.blur();
    body.goTo(+b.dataset.si).then(() => renderParts()).catch(() => {});
  });
  showAllEl.addEventListener('click', () => { body.showAll(); showAllEl.hidden = true; });
  // a boy's or a girl's body (the reproductive organs and the chest)
  root.querySelector('.x3d-sex').addEventListener('click', (e) => {
    const b = e.target.closest('[data-sex]');
    if (!b || b.dataset.sex === body.sex) return;
    root.querySelectorAll('.x3d-sex [data-sex]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
    body.setSex(b.dataset.sex).catch(() => {});
    if (opts.onSelect) opts.onSelect('sex:' + b.dataset.sex);
  });
  root.querySelector('.x3d-switch').addEventListener('click', (e) => { const b = e.target.closest('[data-cell]'); if (b && b.dataset.cell !== kind) showCell(b.dataset.cell); });
  root.querySelector('.x3d-tools').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tool]');
    if (!b) return;
    if (b.dataset.tool === 'labels') { showLabels = !showLabels; b.setAttribute('aria-pressed', String(showLabels)); invalidate(); }
    if (b.dataset.tool === 'cut') setCut(!cut);
    if (b.dataset.tool === 'reset') { if (inBody) body.select(-1); else select(null); resetView(); }
  });
  sheet.querySelector('.x3d-sheet-x').addEventListener('click', () => (inBody ? body.select(-1) : select(null)));
  sheet.addEventListener('click', (e) => {
    const up = e.target.closest('.x3d-up');
    if (up) { body.select(+up.dataset.si); return; }
    const b = e.target.closest('[data-act]');
    if (b && inBody && bodyPart) {
      const p = bodyPart;
      if (b.dataset.act === 'ask' && opts.onAsk) opts.onAsk(`Explain the ${p.name}${p.latin ? ` (${p.latin})` : ''} — part of the ${p.system.toLowerCase()} system${p.path.length ? `, in the ${p.path[p.path.length - 1].name.toLowerCase()}` : ''} — simply: where it is in the body, what it does, and one fact that helps me remember it. Then ask me one quick question to check I understood.`, { part: p.name, cell: 'body' });
      if (b.dataset.act === 'quiz' && opts.onQuiz) opts.onQuiz(`the ${p.system.toLowerCase()} system of the human body (its main parts, where they are and what they do)`, { cell: 'body' });
      if (b.dataset.act === 'hide') { body.hide(p.index); showAllEl.hidden = false; }
      return;
    }
    if (!b || !selected) return;
    const name = PARTS[selected].name, cellName = kind === 'animal' ? 'an animal cell' : 'a plant cell';
    if (b.dataset.act === 'ask' && opts.onAsk) opts.onAsk(`Explain the ${name.toLowerCase()} of ${cellName} simply: what it does, how it works, and an everyday example. Then ask me one quick question to check I understood.`, { part: selected, cell: kind });
    if (b.dataset.act === 'quiz' && opts.onQuiz) opts.onQuiz(`the parts of ${cellName} and what each one does`, { cell: kind });
  });
  $('.x3d-close').addEventListener('click', () => close());
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (e.target === searchEl && searchEl.value) { searchEl.value = ''; resultsEl.hidden = true; return; }
    if (inBody && bodyPart) body.select(-1); else if (selected) select(null); else close();
  });

  function resize() {
    const w = root.clientWidth || window.innerWidth, h = root.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // phones in portrait: step back so the whole cell fits the width
    camera.fov = w < h ? 52 : 42;
    camera.updateProjectionMatrix();
    invalidate();
  }
  new ResizeObserver(resize).observe(root);

  const tmp = new THREE.Vector3(), toCam = new THREE.Vector3();
  function placeLabels() {
    if (inBody) { body.placeLabel(camera, canvas.clientWidth, canvas.clientHeight); return; }
    if (!current) return;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const camDist = camera.position.distanceTo(controls.target);
    labelEls.forEach((el, id) => {
      const a = current.parts.get(id).anchor;
      tmp.copy(a).project(camera);
      const behind = camera.position.distanceTo(a) > camDist + current.radius * 0.35 || tmp.z > 1;
      el.style.transform = `translate(${((tmp.x + 1) / 2) * w}px, ${((1 - tmp.y) / 2) * h}px)`;
      el.classList.toggle('far', behind && id !== selected);
      // with a part picked, only its label shows; otherwise all of them (if Labels is on)
      el.hidden = selected ? id !== selected : !showLabels;
    });
  }
  function frame() {
    raf = requestAnimationFrame(frame);
    if (flyTo) { // glide to the picked part in a fixed time, however slow the device draws
      if (!flyTo.t0) { flyTo.t0 = performance.now(); flyTo.from = controls.target.clone(); flyTo.fromDist = camera.position.distanceTo(controls.target); }
      const k = Math.min(1, (performance.now() - flyTo.t0) / 650), e = 1 - Math.pow(1 - k, 3);
      toCam.copy(camera.position).sub(controls.target).normalize();
      controls.target.copy(flyTo.from).lerp(flyTo.target, e);
      camera.position.copy(controls.target).addScaledVector(toCam, flyTo.fromDist + (flyTo.dist - flyTo.fromDist) * e);
      if (k >= 1) flyTo = null;
      dirty = true;
    }
    const moved = controls.update();
    if (!(moved || dirty || flyTo || controls.autoRotate)) return;
    dirty = false;
    renderer.render(scene, camera);
    placeLabels();
  }

  function open(o) {
    opts = o || {};
    root.hidden = false;
    document.documentElement.classList.add('x3d-open');
    resize();
    if (!raf) frame();
    const want = o.cell || (inBody || !current ? 'body' : kind);
    if ((!current && !inBody) || want !== kind) showCell(want);
    setTimeout(() => $('.x3d-close').focus(), 50);
  }
  function close() {
    root.hidden = true;
    document.documentElement.classList.remove('x3d-open');
    cancelAnimationFrame(raf); raf = 0;
    if (opts.onClose) opts.onClose();
  }
  return { open, close, select, body, get kind() { return kind; }, get selected() { return selected; }, root };
}

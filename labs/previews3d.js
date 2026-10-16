// Real-looking 3D previews of the labs, for Plus and Pro: each lab as a small studio scene in the
// labs' own 3D look (glass, water, metal, wood under soft studio light, with reflections), moving
// in a loop. One WebGL renderer draws every preview, one after another, into a shared buffer that
// is copied onto each preview's own canvas, so twenty previews never need twenty 3D contexts.
// previews.js decides when to use these (Plus or Pro, not Lite, WebGL there) and falls back to the
// flat drawings otherwise.
import { loadThree, webglOk } from './three-kit.js';

let R = null, readyP = null;
export const can3d = () => webglOk();

// the renderer, studio light and shared materials (once)
export function ready() {
  if (readyP) return readyP;
  readyP = Promise.all([loadThree(), import('../explore/RoomEnvironment.js')]).then(([{ THREE }, { RoomEnvironment }]) => {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: 'low-power' });
    renderer.setPixelRatio(1);
    renderer.setSize(720, 360, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
    // studio reflections from a small cube of a room (quick to make; on rounded glass and metal it looks the same)
    const pmrem = new THREE.PMREMGenerator(renderer), cube = new THREE.WebGLCubeRenderTarget(32, { type: THREE.HalfFloatType });
    new THREE.CubeCamera(0.1, 100, cube).update(renderer, new RoomEnvironment());
    const env = pmrem.fromCubemap(cube.texture).texture;
    cube.dispose();
    const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0, ...o });
    const phys = (color, o = {}) => new THREE.MeshPhysicalMaterial({ color, roughness: 0.15, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.1, ...o });
    const M = {
      glass: phys(0xdfeff5, { transparent: true, opacity: 0.32, roughness: 0.05, depthWrite: false }),
      water: phys(0x3d9bd8, { transparent: true, opacity: 0.6, roughness: 0.1 }),
      steel: std(0xc9ccd2, { metalness: 1, roughness: 0.28 }), brass: std(0xd2a24c, { metalness: 1, roughness: 0.3 }), copper: std(0xc4774a, { metalness: 1, roughness: 0.32 }),
      wood: std(0x9a6a40, { roughness: 0.65 }), woodDark: std(0x6b4527, { roughness: 0.7 }), paper: std(0xf3efe6, { roughness: 0.9 }), ink: std(0x24252b, { roughness: 0.6 }),
      red: phys(0xd8433b), blue: phys(0x2f6fd6), green: phys(0x3aa55d), yellow: phys(0xf2c23a), white: phys(0xf4f4f6), purple: phys(0x8a54c9), orange: phys(0xe8873a),
      glowSun: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffc04a, emissiveIntensity: 2.2 }), glowRed: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xff3b30, emissiveIntensity: 2.5 }),
      membrane: phys(0x9fd6c2, { transparent: true, opacity: 0.38, depthWrite: false }), cytoplasm: phys(0xe8f6ef, { transparent: true, opacity: 0.25, depthWrite: false }),
      shadow: new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.1, depthWrite: false }),
    };
    R = { THREE, renderer, env, M, scenes: new Map(), unit: { ball: new THREE.SphereGeometry(1, 32, 20), cyl: new THREE.CylinderGeometry(1, 1, 1, 32), box: new THREE.BoxGeometry(1, 1, 1) } };
    return R;
  });
  return readyP;
}

/* ---------- the scenes ---------- */
// a studio: lights, reflections, a soft shadow on the bench, and a camera looking at the middle
function studio(look = [0, 0.4, 0], from = [0, 1.3, 4.2], fov = 32, floor = true) {
  const { THREE, env, M } = R;
  const scene = new THREE.Scene();
  scene.environment = env;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x404048, 0.8));
  const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(-3, 5, 4); scene.add(key);
  if (floor) { const sh = new THREE.Mesh(new THREE.CircleGeometry(1.2, 32), M.shadow); sh.rotation.x = -Math.PI / 2; sh.scale.set(1.2, 0.6, 1); sh.position.y = -0.485; scene.add(sh); }
  const camera = new THREE.PerspectiveCamera(fov, 2, 0.05, 100);
  camera.position.set(...from); camera.lookAt(...look);
  return { scene, camera, look };
}
const mesh = (geo, mat, x = 0, y = 0, z = 0, sx = 1, sy = sx, sz = sx) => { const m = new R.THREE.Mesh(geo, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); return m; };
const ball = (mat, r, x, y, z) => mesh(R.unit.ball, mat, x, y, z, r);
const rod = (mat, r, h, x, y, z) => mesh(R.unit.cyl, mat, x, y, z, r, h, r);
const block = (mat, w, h, d, x, y, z) => mesh(R.unit.box, mat, x, y, z, w, h, d);
// a cylinder between two points
function between(mat, r, a, b) { const { THREE } = R; const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), m = rod(mat, r, A.distanceTo(B), 0, 0, 0); m.position.copy(A).add(B).multiplyScalar(0.5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize()); return m; }
const benchTop = (s) => { s.scene.add(block(R.M.wood, 3.6, 0.12, 1.6, 0, -0.55, 0)); };

const B = {};
B.pendulum = () => {
  const s = studio([0, 0.55, 0], [0.4, 0.95, 5.4]), { M } = R; benchTop(s);
  s.scene.add(block(M.woodDark, 1.2, 0.1, 0.6, 0, -0.44, 0), rod(M.steel, 0.035, 2.0, -0.5, 0.56, 0), rod(M.steel, 0.035, 2.0, 0.5, 0.56, 0), between(M.steel, 0.03, [-0.5, 1.55, 0], [0.5, 1.55, 0]));
  const arm = new R.THREE.Group(); arm.position.set(0, 1.55, 0); arm.add(between(M.ink, 0.008, [0, 0, 0], [0, -1.35, 0]), ball(M.brass, 0.16, 0, -1.42, 0)); s.scene.add(arm);
  s.tick = (t) => { arm.rotation.z = Math.sin(t * 2.1) * 0.6; };
  return s;
};
B.waves = () => {
  const s = studio([0, 0.2, 0], [0, 1.1, 4.4]), { M } = R; benchTop(s);
  const beads = Array.from({ length: 34 }, (_, i) => { const b = ball(i % 2 ? M.red : M.white, 0.06, -1.65 + i * 0.1, 0.3, 0); s.scene.add(b); return b; });
  s.scene.add(block(M.woodDark, 0.12, 0.9, 0.3, -1.75, 0.0, 0), block(M.woodDark, 0.12, 0.9, 0.3, 1.75, 0.0, 0));
  s.tick = (t) => beads.forEach((b, i) => { b.position.y = 0.3 + Math.sin(i * 0.38 - t * 3.2) * 0.32; });
  return s;
};
B.solar = () => {
  const s = studio([0, 0, 0], [0, 2.4, 4.6], 34, false), { M } = R;
  s.scene.add(ball(M.glowSun, 0.3, 0, 0, 0));
  const light = new R.THREE.PointLight(0xffd27a, 6, 8, 1.5); s.scene.add(light);
  const ps = [[0.65, 0.07, M.copper, 1.6], [1.0, 0.11, M.blue, 1.1], [1.45, 0.09, M.red, 0.8], [1.9, 0.2, M.orange, 0.45]].map(([r, sz, m, sp], i) => {
    const ring = new R.THREE.Mesh(new R.THREE.TorusGeometry(r, 0.004, 6, 96), M.steel); ring.rotation.x = Math.PI / 2; s.scene.add(ring);
    const p = ball(m, sz, r, 0, 0); s.scene.add(p); return { p, r, sp, a: i * 1.7 };
  });
  s.tick = (t) => ps.forEach((o) => { o.p.position.set(Math.cos(o.a + t * o.sp) * o.r, 0, Math.sin(o.a + t * o.sp) * o.r); });
  return s;
};
B['build-cell'] = () => {
  const s = studio([0, 0.1, 0], [0, 1.4, 3.8], 32, false), { M } = R;
  const cell = new R.THREE.Group(); cell.position.y = 0.1; s.scene.add(cell);
  cell.add(mesh(R.unit.ball, M.membrane, 0, 0, 0, 1.25, 0.8, 0.95), ball(M.purple, 0.36, -0.2, 0.05, 0), ball(M.ink, 0.12, -0.2, 0.1, 0.25));
  const bits = [[0.62, 0.15, 0.3, M.orange], [0.5, -0.32, -0.2, M.green], [-0.75, -0.2, 0.25, M.orange], [0.15, 0.45, -0.3, M.yellow], [0.75, -0.1, -0.35, M.red], [-0.6, 0.38, -0.2, M.green]]
    .map(([x, y, z, m], i) => { const o = mesh(R.unit.ball, m, x, y, z, 0.16, 0.08, 0.1); o.rotation.z = i; cell.add(o); return o; });
  s.tick = (t) => { cell.rotation.y = t * 0.35; bits.forEach((o, i) => { o.position.y += Math.sin(t * 1.3 + i) * 0.0015; }); };
  return s;
};
B.atom = () => {
  const s = studio([0, 0.15, 0], [0, 0.9, 4], 32, false), { M } = R;
  const nuc = new R.THREE.Group(); nuc.position.y = 0.15; s.scene.add(nuc);
  [[0, 0, 0], [0.13, 0.05, 0.05], [-0.1, 0.08, -0.06], [0.04, -0.12, 0.08], [-0.06, -0.06, -0.12], [0.08, 0.12, -0.1]].forEach(([x, y, z], i) => nuc.add(ball(i % 2 ? M.red : M.white, 0.11, x, y, z)));
  const orbits = [0, 1.05, -1.05].map((rz, i) => { const g = new R.THREE.Group(); g.rotation.set(Math.PI / 2.4, 0, rz); g.position.y = 0.15; const ring = new R.THREE.Mesh(new R.THREE.TorusGeometry(1.05, 0.006, 6, 120), M.steel); g.add(ring); const e = ball(M.blue, 0.07, 1.05, 0, 0); g.add(e); s.scene.add(g); return { e, sp: 1.6 + i * 0.4, a: i * 2 }; });
  s.tick = (t) => { nuc.rotation.y = t * 0.5; orbits.forEach((o) => { const a = o.a + t * o.sp; o.e.position.set(Math.cos(a) * 1.05, Math.sin(a) * 1.05, 0); }); };
  return s;
};
B.projectile = () => {
  const s = studio([0.2, 0.4, 0], [0.2, 1.2, 5]), { M } = R; benchTop(s);
  const cannon = new R.THREE.Group(); cannon.position.set(-1.5, -0.3, 0); cannon.add(rod(M.ink, 0.12, 0.5, 0, 0.15, 0), ball(M.ink, 0.14, 0, -0.08, 0)); cannon.rotation.z = -0.8; s.scene.add(cannon);
  const shot = ball(M.steel, 0.09, 0, 0, 0); s.scene.add(shot);
  const trail = Array.from({ length: 12 }, () => { const d = ball(M.white, 0.025, 0, -5, 0); s.scene.add(d); return d; });
  const at = (k) => [-1.35 + k * 3.0, -0.25 + 4 * k * (1 - k) * 1.5, 0];
  s.tick = (t) => { const p = (t * 0.42) % 1; shot.position.set(...at(p)); trail.forEach((d, i) => { const k = p - (i + 1) * 0.04; if (k > 0) d.position.set(...at(k)); else d.position.y = -5; }); };
  return s;
};
B.ph = () => {
  const s = studio([0, 0.25, 0], [0, 1.0, 3.6]), { M } = R; benchTop(s);
  const liquidMat = R.M.water.clone(); const liq = mesh(R.unit.cyl, liquidMat, 0, -0.1, 0, 0.5, 0.65, 0.5); s.scene.add(liq);
  s.scene.add(mesh(R.unit.cyl, M.glass, 0, 0.18, 0, 0.55, 1.25, 0.55));
  const drop = ball(M.yellow, 0.05, 0, 1.2, 0); s.scene.add(drop, rod(M.glass, 0.04, 0.6, 0, 1.55, 0));
  const a = new R.THREE.Color(0xd8433b), b = new R.THREE.Color(0x7a3fc6);
  s.tick = (t) => { const q = (t * 0.8) % 1; drop.position.y = 1.2 - q * 1.0; liquidMat.color.copy(a).lerp(b, 0.5 + 0.5 * Math.sin(t * 0.7)); };
  return s;
};
B.fractions = () => {
  const s = studio([0, 0, 0], [0, 2.2, 3.4]), { M } = R; benchTop(s);
  const pie = (cx, n, d, mat) => { const out = []; for (let i = 0; i < d; i++) { const g = new R.THREE.Mesh(new R.THREE.CylinderGeometry(0.6, 0.6, 0.14, 24, 1, false, i / d * Math.PI * 2, Math.PI * 2 / d - 0.03), i < n ? mat : M.white); g.position.set(cx, -0.4, 0); s.scene.add(g); out.push(g); } return out; };
  pie(-0.75, 3, 4, M.orange); const right = pie(0.75, 0, 8, M.blue);
  s.tick = (t) => { const n = Math.floor((t * 1.2) % 9); right.forEach((g, i) => { g.material = i < n ? M.blue : M.white; g.position.y = -0.4 + (i < n ? 0.04 : 0); }); };
  return s;
};
B.punnett = () => {
  const s = studio([0, 0, 0], [0, 2.4, 3.2]), { M } = R; benchTop(s);
  const tiles = [0, 1, 2, 3].map((i) => { const m = block(i === 3 ? M.white : M.green, 0.7, 0.08, 0.7, (i % 2 - 0.5) * 0.78, -0.45, (Math.floor(i / 2) - 0.5) * 0.78); s.scene.add(m); return m; });
  const peas = [0, 1, 2, 3].map((i) => { const p = ball(i === 3 ? M.yellow : M.green, 0.14, tiles[i].position.x, -0.25, tiles[i].position.z); s.scene.add(p); return p; });
  s.tick = (t) => { const n = Math.floor(t * 1.5) % 6; peas.forEach((p, i) => { p.visible = i < n; p.position.y = -0.27 + Math.abs(Math.sin(t * 3 + i)) * 0.05; }); };
  return s;
};
B.function = () => {
  const s = studio([0, 0.3, 0], [0, 0.7, 4.4]), { M } = R;
  s.scene.add(block(M.paper, 3.4, 2.0, 0.04, 0, 0.3, -0.1), block(M.ink, 3.2, 0.015, 0.02, 0, 0.3, -0.06), block(M.ink, 0.015, 1.8, 0.02, 0, 0.3, -0.06));
  const pts = []; for (let u = -1.5; u <= 1.5; u += 0.05) pts.push(new R.THREE.Vector3(u, 0.3 + (u * u * u - u) * 0.55, 0));
  s.scene.add(new R.THREE.Mesh(new R.THREE.TubeGeometry(new R.THREE.CatmullRomCurve3(pts), 120, 0.025, 8), M.blue));
  const bead = ball(M.red, 0.07, 0, 0, 0), tan = rod(M.orange, 0.012, 1.2, 0, 0, 0); s.scene.add(bead, tan);
  s.tick = (t) => { const u = Math.sin(t * 0.8) * 1.3, y = 0.3 + (u * u * u - u) * 0.55, m = (3 * u * u - 1) * 0.55; bead.position.set(u, y, 0.03); tan.position.set(u, y, 0.03); tan.rotation.z = -Math.PI / 2 + Math.atan(m); };
  return s;
};
B.refraction = () => {
  const s = studio([0, 0, 0], [0.3, 0.9, 4]), { M } = R; benchTop(s);
  s.scene.add(block(M.water, 2.6, 0.8, 1.0, 0, -0.08, 0), block(M.glass, 2.65, 0.85, 1.05, 0, -0.06, 0));
  const inB = rod(M.glowRed, 0.018, 1, 0, 0, 0), outB = rod(M.glowRed, 0.018, 1, 0, 0, 0); s.scene.add(inB, outB);
  const set = (m, a, b) => { const { THREE } = R; const A = new THREE.Vector3(...a), Bv = new THREE.Vector3(...b); m.position.copy(A).add(Bv).multiplyScalar(0.5); m.scale.set(0.018, A.distanceTo(Bv), 0.018); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), Bv.clone().sub(A).normalize()); };
  s.tick = (t) => { const a = 0.6 + Math.sin(t * 0.9) * 0.25, b = Math.asin(Math.sin(a) / 1.33), top = 0.32; set(inB, [-Math.tan(a) * 1.2, top + 1.2, 0], [0, top, 0]); set(outB, [0, top, 0], [Math.tan(b) * 0.8, top - 0.8, 0]); };
  return s;
};
B.balance = () => {
  const s = studio([0, 0.3, 0], [0, 1.0, 4.2]), { M } = R; benchTop(s);
  s.scene.add(mesh(new R.THREE.ConeGeometry(0.25, 0.9, 24), M.brass, 0, -0.05, 0));
  const beam = new R.THREE.Group(); beam.position.set(0, 0.42, 0); s.scene.add(beam);
  beam.add(block(M.steel, 2.4, 0.05, 0.08, 0, 0, 0));
  const pans = [-1, 1].map((sd) => { const p = new R.THREE.Group(); p.position.set(sd * 1.1, 0, 0); p.add(between(M.steel, 0.006, [0, 0, 0], [0, -0.45, 0]), mesh(R.unit.cyl, M.brass, 0, -0.47, 0, 0.32, 0.03, 0.32)); for (let i = 0; i < (sd < 0 ? 2 : 3); i++) p.add(ball(sd < 0 ? M.red : M.blue, 0.09, (i - 1) * 0.18 + (sd < 0 ? 0.09 : 0), -0.36, 0)); beam.add(p); return p; });
  s.tick = (t) => { const a = Math.sin(t * 1.3) * 0.15; beam.rotation.z = a; pans.forEach((p) => { p.rotation.z = -a; }); };
  return s;
};
B.chance = () => {
  const s = studio([0, 0.1, 0], [0, 1.6, 3.8]), { M } = R; benchTop(s);
  const dice = [-0.5, 0.5].map((x, i) => { const d = new R.THREE.Mesh(new R.THREE.BoxGeometry(0.42, 0.42, 0.42), M.white); d.position.set(x, 0, 0); s.scene.add(d); for (let k = 0; k < 3; k++) d.add(ball(M.ink, 0.04, (k - 1) * 0.11, (1 - k) * 0.11, 0.21)); return { d, sp: 3 + i }; });
  s.tick = (t) => dice.forEach((o, i) => { const p = (t * 0.6 + i * 0.3) % 1; o.d.position.y = -0.27 + Math.abs(Math.sin(p * Math.PI * 2)) * 0.6 * (1 - p); o.d.rotation.set(t * o.sp, t * (o.sp - 1), t); });
  return s;
};
B.magnets = () => {
  const s = studio([0, 0, 0], [0, 1.6, 3.6]), { M } = R; benchTop(s);
  s.scene.add(block(M.red, 0.8, 0.22, 0.3, -0.4, -0.38, 0), block(M.blue, 0.8, 0.22, 0.3, 0.4, -0.38, 0));
  const filings = Array.from({ length: 60 }, (_, i) => { const a = i / 60 * Math.PI * 2, r = 1.0 + (i % 3) * 0.18, f = rod(M.ink, 0.008, 0.12, Math.cos(a) * r, -0.47, Math.sin(a) * r * 0.6); f.rotation.set(Math.PI / 2, 0, a + Math.PI / 2); s.scene.add(f); return f; });
  const compass = new R.THREE.Group(); compass.add(mesh(R.unit.cyl, M.glass, 0, 0, 0, 0.2, 0.05, 0.2), mesh(new R.THREE.ConeGeometry(0.04, 0.3, 12), M.red, 0, 0.03, 0)); compass.children[1].rotation.x = Math.PI / 2; s.scene.add(compass);
  s.tick = (t) => { const a = t * 0.7; compass.position.set(Math.cos(a) * 1.2, -0.42, Math.sin(a) * 0.7); compass.rotation.y = -a - Math.PI / 2; filings.length; };
  return s;
};
B.optics = () => {
  const s = studio([0, 0.25, 0], [0, 0.6, 4.6]), { M } = R; benchTop(s);
  s.scene.add(block(M.steel, 3.4, 0.04, 0.12, 0, -0.45, 0));
  s.scene.add(mesh(R.unit.ball, M.glass, 0, 0.25, 0, 0.1, 0.62, 0.62));
  const obj = new R.THREE.Group(); obj.add(between(M.orange, 0.03, [0, -0.45, 0], [0, 0.5, 0]), mesh(new R.THREE.ConeGeometry(0.08, 0.16, 16), M.orange, 0, 0.55, 0)); s.scene.add(obj);
  const rays = [0, 1, 2].map(() => { const r = rod(M.glowRed, 0.008, 1, 0, 0, 0); s.scene.add(r); return r; });
  const set = (m, a, b) => { const { THREE } = R; const A = new THREE.Vector3(...a), Bv = new THREE.Vector3(...b); m.position.copy(A).add(Bv).multiplyScalar(0.5); m.scale.set(0.008, A.distanceTo(Bv), 0.008); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), Bv.clone().sub(A).normalize()); };
  s.tick = (t) => { const x = -1.3 - 0.2 * Math.sin(t), top = 0.6; obj.position.x = x; set(rays[0], [x, top, 0], [0, top, 0]); set(rays[1], [0, top, 0], [1.6, -0.2, 0]); set(rays[2], [x, top, 0], [1.6, -0.15 + (top - 0.25) * -0.3, 0]); };
  return s;
};
B.units = () => {
  const s = studio([0, -0.2, 0], [0, 1.2, 3.4]), { M } = R; benchTop(s);
  s.scene.add(block(M.yellow, 3.0, 0.05, 0.4, 0, -0.46, 0));
  for (let i = 0; i <= 30; i++) s.scene.add(block(M.ink, 0.01, 0.01, i % 5 ? 0.08 : 0.16, -1.45 + i * 0.1, -0.43, -0.12));
  const slider = block(M.steel, 0.12, 0.2, 0.5, 0, -0.35, 0); s.scene.add(slider);
  s.tick = (t) => { slider.position.x = Math.sin(t * 0.8) * 1.3; };
  return s;
};
B['ice-steam'] = () => {
  const s = studio([0, 0.1, 0], [0, 1.0, 3.8]), { M } = R; benchTop(s);
  const ice = mesh(new R.THREE.BoxGeometry(0.6, 0.6, 0.6), R.M.glass, 0, -0.18, 0); ice.material = M.glass.clone(); ice.material.color.set(0xcfe9ff); ice.material.opacity = 0.6; s.scene.add(ice);
  const puddle = mesh(R.unit.cyl, M.water, 0, -0.47, 0, 0.1, 0.02, 0.1); s.scene.add(puddle);
  const steam = Array.from({ length: 5 }, (_, i) => { const b = ball(M.white, 0.1, (i - 2) * 0.15, 0, 0); b.material = M.white.clone(); b.material.transparent = true; s.scene.add(b); return b; });
  s.tick = (t) => { const p = (t * 0.22) % 1, k = Math.max(0.08, 1 - p * 1.4); ice.scale.setScalar(k); ice.position.y = -0.48 + 0.3 * k; puddle.scale.set(0.15 + (1 - k) * 0.7, 0.02, 0.15 + (1 - k) * 0.5); steam.forEach((b, i) => { const q = (t * 0.6 + i / 5) % 1; b.visible = p > 0.55; b.position.y = -0.2 + q * 1.3; b.material.opacity = 0.5 * (1 - q); b.scale.setScalar(0.08 + q * 0.12); }); };
  return s;
};
B.vectors = () => {
  const s = studio([0, 0.2, 0], [0.6, 1.4, 3.8]), { M } = R; benchTop(s);
  const arrow = (mat) => { const g = new R.THREE.Group(); g.add(rod(mat, 0.035, 1, 0, 0.5, 0), mesh(new R.THREE.ConeGeometry(0.08, 0.2, 16), mat, 0, 1.05, 0)); s.scene.add(g); return g; };
  const A = arrow(M.blue), Bq = arrow(M.green), C = arrow(M.orange);
  const point = (g, from, v) => { const { THREE } = R; const V = new THREE.Vector3(...v), L = V.length(); g.position.set(...from); g.scale.set(1, L, 1); g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), V.normalize()); g.children[1].scale.set(1, 1 / L, 1); };
  s.tick = (t) => { const a = [Math.cos(0.5 + Math.sin(t * 0.7) * 0.3) * 1.2, Math.sin(0.5 + Math.sin(t * 0.7) * 0.3) * 1.2, 0], b = [Math.cos(1.6 + Math.cos(t * 0.6) * 0.3) * 0.9, Math.sin(1.6 + Math.cos(t * 0.6) * 0.3) * 0.9, 0.2]; const o = [-0.8, -0.45, 0]; point(A, o, a); point(Bq, [o[0] + a[0], o[1] + a[1], o[2]], b); point(C, o, [a[0] + b[0], a[1] + b[1], a[2] + b[2]]); };
  return s;
};
B.colour = () => {
  const s = studio([0, 0.1, 0], [0, 0.6, 3.6], 32, false), { M } = R;
  s.scene.add(block(M.ink, 3.4, 2.0, 0.04, 0, 0.2, -0.6)); // (light mixes on a dark wall)
  const spots = [0xff2d2d, 0x2dff5a, 0x3a5bff].map((c, i) => { const m = new R.THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.55, blending: R.THREE.AdditiveBlending, depthWrite: false }); const d = new R.THREE.Mesh(new R.THREE.CircleGeometry(0.55, 40), m); d.position.z = -0.55 + i * 0.001; s.scene.add(d); return d; });
  s.tick = (t) => spots.forEach((d, i) => { const a = t * 0.6 + i * Math.PI * 2 / 3; d.position.x = Math.cos(a) * 0.32; d.position.y = 0.2 + Math.sin(a) * 0.32; });
  return s;
};
B.metals = () => {
  const s = studio([0, 0.1, 0], [0, 1.0, 3.6]), { M } = R; benchTop(s);
  s.scene.add(mesh(R.unit.cyl, M.water, 0, -0.2, 0, 0.9, 0.55, 0.5), mesh(R.unit.cyl, M.glass, 0, -0.05, 0, 0.95, 0.9, 0.55));
  const metal = block(M.steel, 0.22, 0.12, 0.16, 0, 0.1, 0); s.scene.add(metal);
  const fizz = Array.from({ length: 10 }, (_, i) => { const b = ball(M.white, 0.025, 0, 0, 0); s.scene.add(b); return { b, i }; });
  s.tick = (t) => { metal.position.x = Math.sin(t * 3) * 0.4; metal.rotation.y = t * 2; fizz.forEach(({ b, i }) => { const q = (t * 1.3 + i / 10) % 1; b.position.set(metal.position.x + (i % 5 - 2) * 0.05, 0.1 + q * 0.4, (i % 3 - 1) * 0.05); b.scale.setScalar(0.02 + q * 0.02); }); };
  return s;
};
B.interest = () => {
  const s = studio([0, 0.2, 0], [0, 1.2, 4.4]), { M } = R; benchTop(s);
  const stacks = Array.from({ length: 6 }, (_, i) => { const g = new R.THREE.Group(); g.position.set(-1.4 + i * 0.56, -0.48, 0); s.scene.add(g); return g; });
  const coinGeo = new R.THREE.CylinderGeometry(0.17, 0.17, 0.05, 28);
  s.tick = (t) => { const p = Math.min(1, (t % 7) / 4); stacks.forEach((g, i) => { const n = Math.round(Math.pow(1.35, i) * 3 * p); while (g.children.length < n) { const c = new R.THREE.Mesh(coinGeo, M.brass); c.position.y = g.children.length * 0.055 + 0.03; g.add(c); } while (g.children.length > n) g.remove(g.children[g.children.length - 1]); }); };
  return s;
};

export const has3d = (id) => !!B[id];
// draw one preview: its scene at time t, into the shared buffer, copied onto the canvas's 2D picture
export function draw3d(id, g, w, h, t) {
  if (!R || !B[id]) return false;
  let s = R.scenes.get(id);
  if (!s) { s = B[id](); R.scenes.set(id, s); }
  const k = (g.getTransform && g.getTransform().a) || 1; // (the canvas's own sharpness: 2x on most phones)
  const { renderer } = R, cw = Math.min(720, Math.round(w * k)), ch = Math.min(360, Math.round(h * k));
  s.camera.aspect = cw / ch; s.camera.updateProjectionMatrix();
  s.tick(t);
  renderer.setScissorTest(true);
  renderer.setViewport(0, 360 - ch, cw, ch); renderer.setScissor(0, 360 - ch, cw, ch);
  renderer.setClearColor(0x000000, 0); renderer.clear();
  renderer.render(s.scene, s.camera);
  g.drawImage(renderer.domElement, 0, 0, cw, ch, 0, 0, w, h);
  return true;
}

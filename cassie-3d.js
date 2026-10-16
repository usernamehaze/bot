// Cassie in 3D: the cursor with two eyes, puffed up like a soft toy, black and white like her icon. She floats, turns a little, blinks,
// leans toward your pointer (or finger) and hops in when she first appears. Used on the Get started
// screen only; app.js falls back to the flat Cassie for Reduce Motion, Lite mode or no WebGL.
import * as THREE from './explore/three.module.min.js';
import { RoomEnvironment } from './explore/RoomEnvironment.js';

// The icon's outline (a 1024 box): tip, right point, notch, tail end (two corners), notch, bottom left
const OUTLINE = [[332, 296, 46], [728, 512, 40], [606, 574, 14], [664, 694, 34], [556, 752, 34], [478, 626, 14], [334, 706, 46]];
const EYES = [[434, 488], [518, 510]];
const toXY = ([x, y]) => [(x - 520) / 300, -(y - 524) / 300];

// a polygon with rounded corners (each corner its own radius)
function roundedShape(pts) {
  const s = new THREE.Shape();
  const n = pts.length;
  const at = (i) => pts[(i + n) % n];
  pts.forEach((p, i) => {
    const [x, y] = toXY(p), r = p[2] / 300;
    const [px, py] = toXY(at(i - 1)), [nx, ny] = toXY(at(i + 1));
    const d1 = Math.hypot(px - x, py - y), d2 = Math.hypot(nx - x, ny - y);
    const a = [x + (px - x) * Math.min(r / d1, 0.45), y + (py - y) * Math.min(r / d1, 0.45)];
    const b = [x + (nx - x) * Math.min(r / d2, 0.45), y + (ny - y) * Math.min(r / d2, 0.45)];
    if (i === 0) s.moveTo(a[0], a[1]); else s.lineTo(a[0], a[1]);
    s.quadraticCurveTo(x, y, b[0], b[1]);
  });
  s.closePath();
  return s;
}

// a soft round shadow on the ground (drawn once into a small picture)
function shadowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), grd = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grd.addColorStop(0, 'rgba(0,0,0,.34)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function webglOK() {
  try { const c = document.createElement('canvas'); return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl'))); } catch (e) { return false; }
}

// Draws Cassie into host (an element with a size). Returns { stop } (also stops on its own once the
// host leaves the page).
export function mount(host, { hop = true } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  const canvas = renderer.domElement;
  canvas.className = 'cassie-3d';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.dataset.frames = '0';
  host.appendChild(canvas);

  const scene = new THREE.Scene();
  // the soft studio reflections, from a small cube of the room (a full-size one takes over a second
  // on a slow phone; on a soft, rounded body the small one looks the same)
  const pmrem = new THREE.PMREMGenerator(renderer);
  const cubeRT = new THREE.WebGLCubeRenderTarget(32, { type: THREE.HalfFloatType });
  const room = new RoomEnvironment();
  new THREE.CubeCamera(0.1, 100, cubeRT).update(renderer, room);
  room.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  const envTex = pmrem.fromCubemap(cubeRT.texture).texture;
  cubeRT.dispose();
  scene.environment = envTex;
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  camera.position.set(0, 0.05, 5.4);
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(-2.5, 3.5, 4);
  scene.add(key, new THREE.AmbientLight(0xffffff, 0.35));

  // the body: the outline, extruded thin with a deep, round bevel, so it puffs up like a pillow
  const geo = new THREE.ExtrudeGeometry(roundedShape(OUTLINE), { depth: 0.12, bevelEnabled: true, bevelThickness: 0.22, bevelSize: 0.16, bevelSegments: 10, curveSegments: 18 });
  geo.translate(0, 0, -0.06);
  geo.computeVertexNormals();
  const bodyMat = new THREE.MeshPhysicalMaterial({ roughness: 0.42, clearcoat: 0.7, clearcoatRoughness: 0.3 });
  const eyeMat = new THREE.MeshPhysicalMaterial({ roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.08 });
  const body = new THREE.Mesh(geo, bodyMat);
  const cassie = new THREE.Group();
  cassie.add(body);
  // the eyes: two tall rounded pills, sunk a little into the face
  const eyes = EYES.map((p) => {
    const [x, y] = toXY(p);
    const e = new THREE.Mesh(new THREE.CapsuleGeometry(0.064, 0.17, 8, 20), eyeMat);
    e.position.set(x, y, 0.26);
    e.scale.z = 0.6;
    cassie.add(e);
    return e;
  });
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.5), new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false }));
  shadow.position.set(0.05, -1.12, -0.2);
  scene.add(cassie, shadow);

  // black and white, like her icon: a white body with near-black eyes, in every palette
  bodyMat.color.set(0xf7f7f8);
  eyeMat.color.set(0x121218);

  // size: the host's box
  const fit = () => {
    const w = Math.max(1, host.clientWidth), h = Math.max(1, host.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  };
  fit();
  const ro = window.ResizeObserver ? new ResizeObserver(fit) : null;
  if (ro) ro.observe(host);

  // where she looks: the pointer or finger, anywhere on the page
  const look = { x: 0, y: 0 }, aim = { x: 0, y: 0 };
  const onPoint = (ev) => {
    const r = host.getBoundingClientRect();
    aim.x = Math.max(-1, Math.min(1, (ev.clientX - (r.left + r.width / 2)) / (window.innerWidth / 2)));
    aim.y = Math.max(-1, Math.min(1, (ev.clientY - (r.top + r.height / 2)) / (window.innerHeight / 2)));
  };
  window.addEventListener('pointermove', onPoint, { passive: true });
  window.addEventListener('pointerdown', onPoint, { passive: true });

  // drawing only while she can be seen
  let onScreen = true, raf = 0, stopped = false, frames = 0;
  const io = window.IntersectionObserver ? new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; wake(); }) : null;
  if (io) io.observe(host);
  const onVis = () => wake();
  document.addEventListener('visibilitychange', onVis);

  const t0 = performance.now();
  let nextBlink = t0 + 1800 + Math.random() * 1500, blinkAt = 0;
  const frame = (now) => {
    raf = 0;
    if (stopped) return;
    if (!host.isConnected) { stop(); return; }
    if (document.hidden || !onScreen) return; // (wakes again when seen)
    const t = (now - t0) / 1000;
    // hop in: up from below with a squash on landing, then the gentle float
    let hopY = 0, sq = 1;
    if (hop && t < 0.9) {
      const k = t / 0.9;
      hopY = Math.sin(k * Math.PI) * 0.42 - (1 - k) * (1 - k) * 0.5;
      sq = k > 0.82 ? 1 - Math.sin((k - 0.82) / 0.18 * Math.PI) * 0.12 : 1 + Math.sin(k * Math.PI) * 0.06;
    }
    look.x += (aim.x - look.x) * 0.08; look.y += (aim.y - look.y) * 0.08;
    const float = Math.sin(t * 1.6) * 0.06;
    cassie.position.set(look.x * 0.08, float + hopY, 0);
    cassie.rotation.set(look.y * 0.28 + Math.sin(t * 0.9) * 0.03, look.x * 0.45 + Math.sin(t * 0.55) * 0.12, Math.sin(t * 0.8) * 0.04);
    cassie.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));
    // the eyes follow a little further than the body
    eyes.forEach((e, i) => { const [x, y] = toXY(EYES[i]); e.position.x = x + look.x * 0.035; e.position.y = y - look.y * 0.03; });
    // blink every 3 to 6 seconds (shut and open in a fifth of a second)
    if (now >= nextBlink) { blinkAt = now; nextBlink = now + 3000 + Math.random() * 3000; }
    const b = (now - blinkAt) / 200;
    const lid = b >= 0 && b < 1 ? 1 - Math.sin(b * Math.PI) * 0.9 : 1;
    eyes.forEach((e) => { e.scale.y = lid; });
    // the shadow shrinks as she rises
    const s = 1 - (float + hopY) * 0.5;
    shadow.scale.set(s, s, 1);
    shadow.material.opacity = Math.max(0.3, Math.min(1, s));
    renderer.render(scene, camera);
    if (++frames % 10 === 0) canvas.dataset.frames = String(frames);
    raf = requestAnimationFrame(frame);
  };
  const wake = () => { if (!raf && !stopped) raf = requestAnimationFrame(frame); };
  function stop() {
    if (stopped) return;
    stopped = true;
    if (raf) cancelAnimationFrame(raf);
    window.removeEventListener('pointermove', onPoint);
    window.removeEventListener('pointerdown', onPoint);
    document.removeEventListener('visibilitychange', onVis);
    if (io) io.disconnect();
    if (ro) ro.disconnect();
    scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } });
    envTex.dispose(); pmrem.dispose();
    renderer.dispose();
    canvas.remove();
  }
  // the shaders are built without holding up the page (taps keep answering), then she appears
  canvas.style.visibility = 'hidden';
  const show = () => { if (stopped) return; canvas.style.visibility = ''; wake(); };
  (renderer.compileAsync ? renderer.compileAsync(scene, camera) : Promise.resolve()).then(show, show);
  return { stop, canvas };
}

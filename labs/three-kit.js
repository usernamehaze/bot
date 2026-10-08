/* A 3D stage for a lab: three.js (loaded only when a 3D lab opens), a camera you turn with a
   finger or the mouse (pinch or scroll to zoom), tappable objects, labels that follow them,
   and smooth "fly to" moves. Used by the space explorer and the rocket workshop. */
let libs = null;
export function loadThree() {
  if (!libs) libs = Promise.all([import('../explore/three.module.min.js'), import('../explore/OrbitControls.js')]).then(([THREE, oc]) => ({ THREE, OrbitControls: oc.OrbitControls })).catch((e) => { libs = null; throw e; });
  return libs;
}
export function webglOk() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; }
}

// stage: the lab's picture box. Returns { THREE, scene, camera, controls, renderer, add, pickable, label, flyTo, onFrame, destroy }
export async function stage3d(stage, { background = 0x05060a, fov = 50, near = 0.01, far = 1e7 } = {}) {
  const { THREE, OrbitControls } = await loadThree();
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(background, 1);
  const canvas = renderer.domElement;
  canvas.className = 'lab-canvas lab-3d';
  canvas.style.touchAction = 'none';
  stage.appendChild(canvas);
  const labels = document.createElement('div');
  labels.className = 'lab3d-labels';
  stage.appendChild(labels);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(fov, 1, near, far);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.rotateSpeed = 0.7; controls.zoomSpeed = 1.1;
  controls.screenSpacePanning = true;
  const frames = new Set(), picks = [], tags = [];
  let w = 1, h = 1, raf = 0, alive = true, fly = null;
  const fit = () => {
    const r = stage.getBoundingClientRect();
    w = Math.max(1, Math.round(r.width)); h = Math.max(1, Math.round(r.height));
    renderer.setSize(w, h, false); canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    camera.aspect = w / h; camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(fit); ro.observe(stage); fit();
  const v = new THREE.Vector3();
  const clock = new THREE.Clock();
  function loop() {
    if (!alive) return;
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.05, clock.getDelta());
    if (fly) {
      fly.t = Math.min(1, fly.t + dt / fly.dur);
      const k = fly.t < 0.5 ? 4 * fly.t ** 3 : 1 - (-2 * fly.t + 2) ** 3 / 2;
      camera.position.lerpVectors(fly.p0, fly.p1, k); controls.target.lerpVectors(fly.t0, fly.t1, k);
      if (fly.t >= 1) { const done = fly.done; fly = null; if (done) done(); }
    }
    frames.forEach((f) => f(dt));
    controls.update();
    renderer.render(scene, camera);
    // labels follow their objects (hidden when behind the camera or too far away to matter)
    for (const t of tags) {
      if (!t.obj.visible || (t.show && !t.show())) { t.el.hidden = true; continue; }
      t.obj.getWorldPosition(v);
      if (t.offset) v.add(t.offset);
      v.project(camera);
      if (v.z > 1 || v.z < -1) { t.el.hidden = true; continue; }
      t.el.hidden = false;
      t.el.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px) translate(-50%, -130%)`;
    }
  }
  loop();
  // tapping: the nearest tappable object under the finger (a tap, not a drag)
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let down = null;
  canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  canvas.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 7 || performance.now() - down.t > 600) { down = null; return; }
    down = null;
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    ray.params.Points = { threshold: 0.5 };
    const live = picks.filter((p) => p.obj.visible && (!p.when || p.when()));
    const hits = ray.intersectObjects(live.map((p) => p.obj), true);
    let best = null;
    if (hits.length) { let o = hits[0].object; while (o && !live.find((p) => p.obj === o)) o = o.parent; best = live.find((p) => p.obj === o); }
    // small things are hard to hit: take the closest one on screen within 28 px
    if (!best) {
      let bd = 28;
      for (const p of live) { p.obj.getWorldPosition(v); v.project(camera); if (v.z > 1) continue; const d = Math.hypot(((v.x + 1) / 2) * r.width - (e.clientX - r.left), ((1 - v.y) / 2) * r.height - (e.clientY - r.top)); if (d < bd) { bd = d; best = p; } }
    }
    if (best) best.onTap();
  });
  return {
    THREE, scene, camera, controls, renderer, canvas,
    get size() { return { w, h }; },
    onFrame(f) { frames.add(f); return () => frames.delete(f); },
    // tap on an object (or anything inside it)
    pickable(obj, onTap, when) { picks.push({ obj, onTap, when }); },
    // a name tag that follows an object; tap it too
    label(obj, text, { className = '', onTap, offset, show } = {}) {
      const el = document.createElement(onTap ? 'button' : 'span');
      if (onTap) { el.type = 'button'; el.addEventListener('click', onTap); }
      el.className = 'lab3d-label ' + className; el.textContent = text; el.hidden = true;
      labels.appendChild(el);
      const t = { obj, el, offset, show };
      tags.push(t);
      return el;
    },
    clearLabels() { tags.length = 0; labels.replaceChildren(); picks.length = 0; },
    // fly the camera to look at a point from a distance (smoothly)
    flyTo(target, dist, { dur = 1.2, dir, done } = {}) {
      const t1 = target.clone(), d = (dir || camera.position.clone().sub(controls.target)).normalize();
      fly = { t: 0, dur: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0.01 : dur, p0: camera.position.clone(), t0: controls.target.clone(), p1: t1.clone().add(d.multiplyScalar(dist)), t1, done };
    },
    destroy() { alive = false; cancelAnimationFrame(raf); ro.disconnect(); controls.dispose(); renderer.dispose(); scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) [].concat(o.material).forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); }); }); canvas.remove(); labels.remove(); },
  };
}

// a texture painted on a canvas (planets, rocket decals) — no picture files needed
export function paintTexture(THREE, w, h, paint) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  paint(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
// repeatable noise for textures (value noise with a few octaves)
export function noise2(seed = 1) {
  const R = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453; return s - Math.floor(s); };
  const sm = (t) => t * t * (3 - 2 * t);
  const one = (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi; const a = R(xi, yi), b = R(xi + 1, yi), c = R(xi, yi + 1), d = R(xi + 1, yi + 1), u = sm(xf), v = sm(yf); return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v; };
  return (x, y, oct = 4) => { let s = 0, amp = 0.5, f = 1; for (let i = 0; i < oct; i++) { s += amp * one(x * f, y * f); amp /= 2; f *= 2; } return s; };
}

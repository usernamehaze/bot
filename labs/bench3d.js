/* The real-looking lab bench: a 3D stage that sits under a lab's flat drawing. The lab keeps its
   own physics, controls and layout (worked out in screen pixels, as before); the bench turns
   that layout into real things — glass, water, metal, wood — under studio lights with soft
   shadows and reflections. Pointer positions are mapped back onto the lab's flat layout through
   the 3D view, so every drag and tap the lab already understands keeps working when the view is
   turned. Drag an empty spot (or use two fingers) to look around; pinch or scroll to zoom;
   double-tap an empty spot to look straight on again.

     const B = await bench(stage, cv, { plane: 'wall' });   // cv: the lab's kit canvas (stays on top)
     B.P(px, py, z)  → where a point of the flat layout is in 3D (z: towards you, in pixels)
     B.u(px)         → a length in pixels, in 3D units
*/
import { stage3d, loadThree, webglOk, paintTexture, noise2 } from './three-kit.js';
import { el, seg, group, premium } from './kit.js';

let addonsP = null;
const addons = () => addonsP || (addonsP = Promise.all([import('../explore/RoomEnvironment.js'), import('../explore/RoundedBoxGeometry.js')])
  .then(([r, g]) => ({ RoomEnvironment: r.RoomEnvironment, RoundedBoxGeometry: g.RoundedBoxGeometry }))
  .catch((e) => { addonsP = null; throw e; }));
export const can3d = () => webglOk();

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const UNITS = 10; // the flat layout's height, in 3D units

export async function bench(stage, cv, { plane = 'wall', look = 'lab', pitch = 9, yaw = 0, fov = 34, fit = 1.04, minPitch, maxPitch } = {}) {
  const [S, A] = await Promise.all([stage3d(stage, { background: 0x0b0c10, fov, near: 0.05, far: 4000, lazy: true }), addons()]);
  const { THREE, scene, camera, renderer, controls } = S;
  controls.enabled = false; // this stage drives the camera itself
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new A.RoomEnvironment(), 0.04).texture;
  scene.environment = envTex;
  // the flat drawing stays on top: it takes the touches and shows the read-outs
  const gl = S.canvas, tags = stage.querySelector('.lab3d-labels');
  stage.insertBefore(gl, cv.c); if (tags) stage.insertBefore(tags, cv.c.nextSibling);
  const table = plane === 'table';

  /* ---------- the flat layout ↔ 3D ---------- */
  let w = 1, h = 1, k = 1;
  const size = () => { const r = stage.getBoundingClientRect(); w = Math.max(1, r.width); h = Math.max(1, r.height); k = h / UNITS; };
  size();
  const P = (px, py, z = 0) => (table ? new THREE.Vector3((px - w / 2) / k, z / k, (py - h / 2) / k) : new THREE.Vector3((px - w / 2) / k, (h / 2 - py) / k, z / k));
  const u = (px) => px / k;
  const toPx = (v) => (table ? { x: v.x * k + w / 2, y: v.z * k + h / 2 } : { x: v.x * k + w / 2, y: h / 2 - v.y * k });

  /* ---------- the camera: turn, and zoom towards what you point at (or pinch around) ---------- */
  const lim = { pitch: table ? [minPitch ?? 22, maxPitch ?? 88] : [minPitch ?? -6, maxPitch ?? 62], yaw: [-62, 62] };
  const home = { yaw, pitch, zoom: 1 };
  const cam = { ...home }, goal = { ...home };
  const aim = new THREE.Vector3(), aimGoal = new THREE.Vector3(); // what the camera looks at (moves when you zoom in on something)
  const d0 = () => ((UNITS / 2) / Math.tan(((fov / 2) * Math.PI) / 180)) * fit;
  function place(dt) {
    const a = reduced() ? 1 : 1 - Math.exp(-dt * 12);
    for (const key of ['yaw', 'pitch', 'zoom']) { if (Math.abs(goal[key] - cam[key]) > 1e-3) S.wake(200); cam[key] += (goal[key] - cam[key]) * a; }
    if (aim.distanceToSquared(aimGoal) > 1e-6) { S.wake(200); aim.lerp(aimGoal, a); }
    const y = (cam.yaw * Math.PI) / 180, p = (cam.pitch * Math.PI) / 180, d = d0() * cam.zoom;
    camera.position.set(Math.sin(y) * Math.cos(p) * d, Math.sin(p) * d, Math.cos(y) * Math.cos(p) * d).add(aim);
    controls.target.copy(aim);
  }
  S.onFrame(place);
  place(1);
  const clampGoal = () => {
    goal.yaw = Math.max(lim.yaw[0], Math.min(lim.yaw[1], goal.yaw));
    goal.pitch = Math.max(lim.pitch[0], Math.min(lim.pitch[1], goal.pitch));
    goal.zoom = Math.max(0.3, Math.min(1.7, goal.zoom));
    // the closer you are, the further the view may slide off the middle (back to the middle when zoomed out)
    const room2 = Math.max(0, 1 - goal.zoom), ex = (w / 2 / k) * room2 * 1.1, ey = (UNITS / 2) * room2 * 1.1;
    aimGoal.x = Math.max(-ex, Math.min(ex, aimGoal.x));
    if (table) { aimGoal.z = Math.max(-ey, Math.min(ey, aimGoal.z)); aimGoal.y = 0; } else { aimGoal.y = Math.max(-ey, Math.min(ey, aimGoal.y)); aimGoal.z = 0; }
  };
  const resetView = () => { Object.assign(goal, home); aimGoal.set(0, 0, 0); };

  // pointer → the flat layout, through the camera, onto the layout's plane
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), hit = new THREE.Vector3();
  const flat = table ? new THREE.Plane(new THREE.Vector3(0, 1, 0), 0) : new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  cv.c._at = (e) => {
    const r = cv.c.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    camera.updateMatrixWorld(); ray.setFromCamera(ndc, camera);
    const sx = e.clientX - r.left, sy = e.clientY - r.top; // (where it is on the screen, for read-outs drawn flat on top)
    return ray.ray.intersectPlane(flat, hit) ? { ...toPx(hit), sx, sy } : { x: -1e4, y: -1e4, sx, sy };
  };
  // where a point of the flat layout shows on the screen (the tests use it)
  cv.c._toScreen = (px, py, z = 0) => { camera.updateMatrixWorld(); const v = P(px, py, z).project(camera), r = cv.c.getBoundingClientRect(); return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height }; };
  // a drag that starts on nothing turns the view; a double tap on nothing looks straight on again
  let od = null, lastTap = 0;
  cv.c._orbit = {
    down(e) { od = { x: e.clientX, y: e.clientY, yaw: goal.yaw, pitch: goal.pitch, moved: false }; },
    move(e) {
      if (!od || cv.c._pinch) return;
      const dx = e.clientX - od.x, dy = e.clientY - od.y;
      if (Math.hypot(dx, dy) > 5) od.moved = true;
      goal.yaw = od.yaw - dx * 0.35; goal.pitch = od.pitch + dy * 0.3; clampGoal();
    },
    up() { if (od && !od.moved) { const t = performance.now(); if (t - lastTap < 350) resetView(); lastTap = t; } od = null; },
  };
  // zoom by a factor around a point on the screen: the thing under it stays under it
  const zp = new THREE.Vector3();
  function zoomAt(f, clientX, clientY) {
    const before = goal.zoom;
    goal.zoom *= f; clampGoal();
    const g = goal.zoom / before;
    if (clientX != null && Math.abs(g - 1) > 1e-4) {
      const r = cv.c.getBoundingClientRect();
      ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
      camera.updateMatrixWorld(); ray.setFromCamera(ndc, camera);
      if (ray.ray.intersectPlane(flat, zp)) aimGoal.sub(zp).multiplyScalar(g).add(zp);
    }
    clampGoal(); S.wake(400);
  }
  // two fingers: pinch to zoom, move together to turn
  const ptrs = new Map(); let pin = null;
  const twoOf = () => { const [a, b] = [...ptrs.values()]; return { d: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; };
  const pdown = (e) => { if (e.pointerType === 'mouse') return; ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (ptrs.size === 2) { cv.c._pinch = true; const t = twoOf(); pin = { ...t, zoom: goal.zoom, yaw: goal.yaw, pitch: goal.pitch }; } };
  const pmove = (e) => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 2 && pin) { const t = twoOf(); zoomAt((pin.zoom * (pin.d / Math.max(10, t.d))) / goal.zoom, t.x, t.y); goal.yaw = pin.yaw - (t.x - pin.x) * 0.35; goal.pitch = pin.pitch + (t.y - pin.y) * 0.3; clampGoal(); }
  };
  const pup = (e) => { ptrs.delete(e.pointerId); if (ptrs.size < 2) pin = null; if (!ptrs.size) cv.c._pinch = false; };
  stage.addEventListener('pointerdown', pdown, true);
  stage.addEventListener('pointermove', pmove, true);
  stage.addEventListener('pointerup', pup, true);
  stage.addEventListener('pointercancel', pup, true);
  const wheel = (e) => { e.preventDefault(); zoomAt(e.deltaY > 0 ? 1.1 : 1 / 1.1, e.clientX, e.clientY); };
  cv.c.addEventListener('wheel', wheel, { passive: false });

  /* ---------- light ---------- */
  scene.add(new THREE.HemisphereLight(0xe4ecff, 0x1b1a1f, 0.45));
  const key = new THREE.DirectionalLight(0xfff3e6, 2.3);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.radius = 5; key.shadow.bias = -0.0004; key.shadow.normalBias = 0.03;
  Object.assign(key.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 0.5, far: 80 });
  key.position.set(-7, 14, 10);
  scene.add(key, key.target);
  const rim = new THREE.DirectionalLight(0xcfe0ff, 0.7); rim.position.set(8, 6, -10); scene.add(rim);

  /* ---------- the room ---------- */
  const room = new THREE.Group(); scene.add(room);
  const sky = (top, bottom) => paintTexture(THREE, 4, 256, (g, cw, ch) => { const gr = g.createLinearGradient(0, 0, 0, ch); gr.addColorStop(0, top); gr.addColorStop(1, bottom); g.fillStyle = gr; g.fillRect(0, 0, cw, ch); });
  let floorY = 0, benchTop = null, ground = null;
  function setLook(kind, opts = {}) {
    room.clear();
    if (scene.background && scene.background.isTexture) scene.background.dispose();
    benchTop = ground = null;
    if (kind === 'field') {
      const SKY = { earth: ['#5d9fe0', '#d7e9f7', 0x9cc6ec], moon: ['#000000', '#0c0c10', 0x000000], mars: ['#c9936b', '#efd2b2', 0xd9b08c], jupiter: ['#6b5a49', '#d9b88f', 0xbfa07c] }[opts.world || 'earth'];
      scene.background = sky(SKY[0], SKY[1]);
      scene.fog = new THREE.Fog(SKY[2], 60, 260);
      const tex = groundTexture(opts.world || 'earth');
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(30, 30);
      ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshStandardMaterial({ map: tex, roughness: 1 }));
      ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; room.add(ground);
      key.intensity = opts.world === 'moon' ? 3 : 2.4; key.color.set(opts.world === 'mars' ? 0xffe2c8 : 0xfff3e6);
      renderer.toneMappingExposure = 1;
    } else if (kind === 'dark') {
      scene.background = sky('#101219', '#040508'); scene.fog = null;
    } else {
      // a black epoxy lab bench in a dim room
      scene.background = sky('#171a21', '#07080b'); scene.fog = new THREE.Fog(0x08090c, 40, 90);
      benchTop = new THREE.Mesh(new THREE.BoxGeometry(80, 1, 30), new THREE.MeshStandardMaterial({ color: 0x101114, roughness: 0.62, metalness: 0, envMapIntensity: 0.3 }));
      benchTop.receiveShadow = true; room.add(benchTop);
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(160, 80), new THREE.MeshStandardMaterial({ color: 0x17181c, roughness: 0.95, envMapIntensity: 0.4 }));
      wall.position.set(0, 20, -14); wall.receiveShadow = true; room.add(wall);
      if (table) { benchTop.position.y = -0.5; wall.visible = false; }
    }
    setFloor(floorY);
  }
  function groundTexture(world) {
    const n = noise2(world.length * 7);
    const base = { earth: [[62, 104, 48], [96, 140, 66]], moon: [[92, 92, 94], [150, 150, 152]], mars: [[150, 82, 50], [196, 122, 80]], jupiter: [[170, 140, 104], [214, 186, 146]] }[world];
    return paintTexture(THREE, 256, 256, (g, cw, ch) => {
      const img = g.createImageData(cw, ch);
      for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
        const v = n(x / 22, y / 22, 5), f = n(x / 3, y / 3, 2) * 0.35 + v * 0.65, q = (y * cw + x) * 4;
        for (let c = 0; c < 3; c++) img.data[q + c] = base[0][c] + (base[1][c] - base[0][c]) * f;
        img.data[q + 3] = 255;
      }
      g.putImageData(img, 0, 0);
    });
  }
  // the bench (or the ground) at a height of the flat layout
  function setFloor(py) {
    floorY = py;
    const y = table ? 0 : P(0, py).y;
    if (benchTop) benchTop.position.y = table ? -0.5 : y - 0.5;
    if (ground) ground.position.y = y;
    key.target.position.set(0, y, 0);
  }
  setLook(look);

  /* ---------- materials ---------- */
  // (glass doesn't hide what's behind it in the depth buffer, so water and things inside it still draw)
  const glass = (o = {}) => new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0, roughness: 0.03, transmission: 1, thickness: 0.12, ior: 1.5, specularIntensity: 1, envMapIntensity: 1.2, side: THREE.DoubleSide, depthWrite: false, ...o });
  // (a liquid sits inside glass, and glass only sees what's solid behind it — so liquids blend instead)
  const liquid = (color = 0xdfeeff, o = {}) => new THREE.MeshPhysicalMaterial({ color, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.3, depthWrite: false, ior: 1.333, specularIntensity: 1, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.2, ...o });
  const metal = (color = 0xc9c9cf, rough = 0.28) => new THREE.MeshStandardMaterial({ color, metalness: 1, roughness: rough, envMapIntensity: 1.1 });
  const plastic = (color, rough = 0.45) => new THREE.MeshPhysicalMaterial({ color, roughness: rough, clearcoat: 0.3, clearcoatRoughness: 0.4 });
  const wood = (tone = [150, 104, 64]) => {
    const n = noise2(5);
    const map = paintTexture(THREE, 256, 256, (g, cw, ch) => {
      const img = g.createImageData(cw, ch);
      for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
        const ring = Math.sin((x / cw) * 40 + n(x / 60, y / 8, 3) * 9) * 0.5 + 0.5, f = 0.75 + ring * 0.18 + n(x / 4, y / 40, 2) * 0.12, q = (y * cw + x) * 4;
        img.data[q] = tone[0] * f; img.data[q + 1] = tone[1] * f; img.data[q + 2] = tone[2] * f; img.data[q + 3] = 255;
      }
      g.putImageData(img, 0, 0);
    });
    return new THREE.MeshPhysicalMaterial({ map, roughness: 0.55, clearcoat: 0.35, clearcoatRoughness: 0.5 });
  };
  // a soft round glow (flames, sparks, a laser's spot)
  let glowTex = null;
  const glow = (color, size = 1, opacity = 1) => {
    if (!glowTex) glowTex = paintTexture(THREE, 64, 64, (g) => { const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); });
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }));
    s.scale.setScalar(size); return s;
  };
  // words painted on a flat card (labels on bottles, letters on magnets, a ruler)
  const card = (cw, ch, paint) => paintTexture(THREE, cw, ch, paint);
  const shadowy = (o) => { o.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } }); return o; };

  // a name tag that follows a point of the layout (on screen, always facing you)
  function tag(className = 'plain', align = 'center') {
    const o = new THREE.Object3D(); scene.add(o);
    const e = S.label(o, '', { className, align });
    e.hidden = true;
    let text = '';
    return {
      el: e,
      at(px, py, z = 0, t) { o.position.copy(P(px, py, z)); o.visible = true; if (t != null && t !== text) { text = t; e.textContent = t; } },
      atWorld(v, t) { o.position.copy(v); o.visible = true; if (t != null && t !== text) { text = t; e.textContent = t; } },
      hide() { o.visible = false; },
    };
  }

  const ro = new ResizeObserver(size); ro.observe(stage);
  return {
    THREE, A, scene, camera, renderer, S,
    P, u, get k() { return k; }, get w() { return w; }, get h() { return h; },
    room, key, setLook, setFloor, resetView,
    glass, liquid, metal, plastic, wood, glow, card, shadowy, tag,
    onFrame: S.onFrame, wake: S.wake,
    destroy() {
      ro.disconnect();
      stage.removeEventListener('pointerdown', pdown, true); stage.removeEventListener('pointermove', pmove, true);
      stage.removeEventListener('pointerup', pup, true); stage.removeEventListener('pointercancel', pup, true);
      cv.c.removeEventListener('wheel', wheel);
      delete cv.c._at; delete cv.c._orbit; delete cv.c._pinch; delete cv.c._toScreen;
      if (scene.background && scene.background.isTexture) scene.background.dispose();
      if (glowTex) glowTex.dispose();
      envTex.dispose(); pmrem.dispose();
      S.destroy();
    },
  };
}

/* A lab's "View" switch: Real 3D (the default where the device can) or the flat diagram.
   make(B) builds the lab's scene on the bench and returns { update?, destroy? }; the lab calls
   view.scene (null in the flat view) from its drawing. */
export function viewSwitch(panel, stage, cv, make, { plane, look, pitch, yaw, minPitch, maxPitch, note } = {}) {
  const v = { scene: null, bench: null, on: false };
  // (the small demos on the landing page start as diagrams, to keep that page light)
  // (and the 3D / diagram choice you made last time is kept)
  let saved = null; try { saved = localStorage.getItem('cassie.labs.view'); } catch (e) { /* ignore */ }
  let want = can3d() && premium.has() && saved !== 'flat' && !/[?&]flat\b/.test(location.search) && !stage.closest('.labs-embed'), alive = true, busy = null;
  async function start() {
    if (v.bench || busy) return busy;
    busy = (async () => {
      try {
        const B = await bench(stage, cv, { plane, look, pitch, yaw, minPitch, maxPitch });
        if (!alive || !want) { B.destroy(); return; }
        v.bench = B; v.scene = (await make(B)) || {}; v.on = true;
        // (the stage only draws for a moment after the lab changes something)
        if (v.scene.update) { const up = v.scene.update; v.scene.update = (st) => { B.wake(); up(st); }; }
        stage.classList.add('lab-is-3d');
      } catch (e) { want = false; s.set('flat'); note3d.textContent = 'The 3D view couldn’t start on this device — showing the diagram.'; }
      busy = null;
      cv.redraw();
    })();
    return busy;
  }
  function stop() {
    if (v.scene && v.scene.destroy) { try { v.scene.destroy(); } catch (e) { /* ignore */ } }
    if (v.bench) v.bench.destroy();
    v.scene = null; v.bench = null; v.on = false;
    stage.classList.remove('lab-is-3d');
    cv.redraw();
  }
  const g = group(panel, 'View');
  const s = seg(g, { options: [['3d', 'Real 3D'], ['flat', 'Diagram']], value: want ? '3d' : 'flat', onChange: (x) => {
    // free: a few Real 3D views a day (one per lab you open; switching back and forth in it is free)
    if (x === '3d' && !premium.has() && !tried) {
      if (!premium.take('3d')) { s.set('flat'); premium.ask('The Real 3D view', 'You’ve used today’s free Real 3D views. They come back tomorrow.'); return; }
      tried = true; const n = premium.left('3d');
      note3d.textContent = `${n === 0 ? 'That was your last free Real 3D view today' : n === 1 ? '1 more free Real 3D view today' : n + ' more free Real 3D views today'} · Plus has it always. Drag an empty spot to look around · pinch to zoom.`;
    }
    want = x === '3d'; try { localStorage.setItem('cassie.labs.view', x); } catch (e) { /* ignore */ } if (want) start(); else stop(); } });
  const note3d = el('p', 'lab-note', note || '3D: drag an empty spot (or use two fingers) to look around · pinch to zoom · double-tap to look straight on.');
  g.appendChild(note3d);
  let tried = false;
  if (!premium.has()) { const n = premium.left('3d'); note3d.textContent = n > 0 ? `Real 3D is a Plus extra. You have ${n} free ${n === 1 ? 'view' : 'views'} today: tap Real 3D.` : 'Real 3D is a Plus extra. The diagram shows everything the lab does.'; }
  panel.prepend(g);
  if (!can3d()) { s.el.hidden = true; note3d.hidden = true; g.hidden = true; }
  if (want) start();
  v.destroy = () => { alive = false; stop(); };
  return v;
}

/* ---------- parts more than one lab uses ---------- */
// a glass beaker (a lathe: thick glass, a rolled lip), 1 unit wide and 1 tall — scale it to size.
// marks: [[height 0–1, text]] printed in white enamel on the front, like a real beaker's scale
export function beakerMesh(B, { marks = [], label = '' } = {}) {
  const { THREE } = B, g = new THREE.Group();
  const t = 0.025, pts = [[0, 0], [0.47, 0], [0.5, 0.025], [0.5, 1], [0.515, 1.008], [0.508, 1.02], [0.5 - t, 1.0], [0.5 - t, t + 0.02], [0.47 - t, t], [0, t]].map(([x, y]) => new THREE.Vector2(x, y));
  const glassM = B.glass({ thickness: 0.08 });
  const body = new THREE.Mesh(new THREE.LatheGeometry(pts, 72), glassM);
  body.castShadow = true; g.add(body);
  if (marks.length || label) {
    const tex = B.card(512, 512, (c, cw, ch) => {
      c.clearRect(0, 0, cw, ch); c.strokeStyle = c.fillStyle = 'rgba(255,255,255,.92)'; c.lineWidth = 5; c.font = '600 34px -apple-system, Segoe UI, sans-serif';
      c.textAlign = 'right'; c.textBaseline = 'middle';
      for (const [y, txt] of marks) { const py = ch * (1 - y); c.beginPath(); c.moveTo(cw * 0.56, py); c.lineTo(cw * 0.86, py); c.stroke(); if (txt) c.fillText(txt, cw * 0.52, py); }
      c.textAlign = 'left'; c.textBaseline = 'alphabetic';
      for (let k = 0; k < marks.length - 1; k++) { const a = marks[k][0], b = marks[k + 1][0]; for (let s = 1; s < 5; s++) { const py = ch * (1 - (a + ((b - a) * s) / 5)); c.beginPath(); c.moveTo(cw * 0.56, py); c.lineTo(cw * 0.68, py); c.stroke(); } }
      if (label) { c.font = '700 40px -apple-system, Segoe UI, sans-serif'; c.fillText(label, cw * 0.18, ch * 0.12); }
    });
    const print = new THREE.Mesh(new THREE.CylinderGeometry(0.503, 0.503, 1, 24, 1, true, -0.55, 1.1), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.FrontSide }));
    print.position.y = 0.5; g.add(print);
  }
  return g;
}
// a cylinder from point a to point b (rods, rays, strings)
const UP = { x: 0, y: 1, z: 0 };
export function between(B, mesh, a, b, r) {
  const { THREE } = B, d = new THREE.Vector3().subVectors(b, a), len = d.length();
  mesh.position.copy(a).addScaledVector(d, 0.5);
  mesh.scale.set(r, Math.max(1e-4, len), r);
  if (len > 1e-6) mesh.quaternion.setFromUnitVectors(new THREE.Vector3(UP.x, UP.y, UP.z), d.divideScalar(len));
  return mesh;
}
export const unitRod = (B, mat, sides = 12) => new B.THREE.Mesh(new B.THREE.CylinderGeometry(1, 1, 1, sides), mat);
// a retort stand: a heavy base on the bench and an upright rod (x, z in units; from floor y0 up to y1)
export function standMesh(B) {
  const { THREE } = B, g = new THREE.Group();
  const base = new THREE.Mesh(new B.A.RoundedBoxGeometry(1.6, 0.14, 1.0, 2, 0.04), new THREE.MeshStandardMaterial({ color: 0x2a2c31, roughness: 0.55, metalness: 0.4 }));
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1, 16), B.metal(0xd6d7db, 0.25));
  g.add(base, rod); B.shadowy(g);
  g.userData.set = (x, z, y0, y1) => { base.position.set(x, y0 + 0.07, z); rod.position.set(x - 0.45, (y0 + y1) / 2, z); rod.scale.y = Math.max(0.1, y1 - y0); };
  return g;
}

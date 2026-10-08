/* The rocket workshop in 3D: the rocket you design is built from its stages (taller and wider
   with more fuel), on a launch pad with its tower. On launch the exhaust lights up, smoke
   billows, the sky darkens as the air thins, Earth's curve comes into view, and spent stages
   drop away. The flight itself comes from the lab's physics (it only draws it). 1 unit = 1 m. */
import { stage3d, paintTexture, noise2 } from './three-kit.js';

const LOOK = { // per engine type: body colour, plume colour, how see-through the flame is
  solid: { body: '#e9e7e1', band: '#444', plume: [1, 0.85, 0.55], glow: 1, smoke: 1 },
  kerosene: { body: '#f2f2f0', band: '#16171c', plume: [1, 0.62, 0.25], glow: 0.9, smoke: 0.7 },
  hydrogen: { body: '#d9772f', band: '#f2f2f0', plume: [0.6, 0.75, 1], glow: 0.45, smoke: 0.25 },
};
export async function rocketScene(stage) {
  const S = await stage3d(stage, { background: 0x7db4e6, near: 0.5, far: 4e7, logDepth: true });
  const { THREE, scene, camera, controls } = S;
  const sunDir = new THREE.Vector3(0.6, 0.8, 0.4).normalize();
  scene.add(new THREE.HemisphereLight(0xcfe6ff, 0x4a5a3a, 0.9));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.copy(sunDir); scene.add(sun);

  /* ---------- the world: ground, pad, tower, clouds, Earth (all move down as the rocket climbs) ---------- */
  const world = new THREE.Group(); scene.add(world);
  const n = noise2(7);
  const grass = paintTexture(THREE, 512, 512, (g, w, h) => { const img = g.createImageData(w, h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = n(x / 30, y / 30, 5); const k = (y * w + x) * 4; img.data[k] = 70 + v * 50; img.data[k + 1] = 105 + v * 50; img.data[k + 2] = 55 + v * 30; img.data[k + 3] = 255; } g.putImageData(img, 0, 0); });
  grass.wrapS = grass.wrapT = THREE.RepeatWrapping; grass.repeat.set(40, 40);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(20000, 64), new THREE.MeshStandardMaterial({ map: grass, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; world.add(ground);
  const sea = new THREE.Mesh(new THREE.CircleGeometry(60000, 64, 0, Math.PI), new THREE.MeshStandardMaterial({ color: 0x2f6d9e, roughness: 0.4 }));
  sea.rotation.x = -Math.PI / 2; sea.position.set(0, -0.5, -9000); world.add(sea);
  const concrete = new THREE.MeshStandardMaterial({ color: 0xb9b6ae, roughness: 0.95 });
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(32, 34, 3, 48), concrete); pad.position.y = 1.5; world.add(pad);
  const trench = new THREE.Mesh(new THREE.BoxGeometry(8, 3.2, 40), new THREE.MeshStandardMaterial({ color: 0x3a3a3c })); trench.position.set(0, 1.5, 22); world.add(trench);
  const steel = new THREE.MeshStandardMaterial({ color: 0x9a3b2c, roughness: 0.6, metalness: 0.3 });
  let tower = null;
  function buildTower(height) {
    if (tower) { world.remove(tower); tower.traverse((o) => o.geometry && o.geometry.dispose()); }
    tower = new THREE.Group();
    const H = height + 12, s = 3.2, x0 = -12;
    for (const [dx, dz] of [[0, 0], [s, 0], [0, s], [s, s]]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.35, H, 0.35), steel); leg.position.set(x0 + dx - s / 2, 3 + H / 2, dz - s / 2); tower.add(leg); }
    for (let y = 3; y < H + 3; y += 3.2) for (const [a, b] of [[[0, 0], [s, 0]], [[0, s], [s, s]], [[0, 0], [0, s]], [[s, 0], [s, s]]]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(a[0] === b[0] ? 0.2 : s, 0.2, a[1] === b[1] ? 0.2 : s), steel);
      bar.position.set(x0 + (a[0] + b[0]) / 2 - s / 2, y, (a[1] + b[1]) / 2 - s / 2); tower.add(bar);
      const diag = new THREE.Mesh(new THREE.BoxGeometry(0.15, Math.hypot(s, 3.2), 0.15), steel);
      diag.position.copy(bar.position).add(new THREE.Vector3(0, 1.6, 0)); diag.rotation[a[0] === b[0] ? 'x' : 'z'] = Math.atan2(s, 3.2); tower.add(diag);
    }
    const arm = new THREE.Mesh(new THREE.BoxGeometry(10, 1.2, 1.6), steel); arm.position.set(x0 + 4.5, height * 0.85 + 3, 0); tower.add(arm);
    tower.userData.arm = arm;
    world.add(tower);
  }
  // clouds: soft sprites between 2 and 9 km
  const cloudTex = paintTexture(THREE, 128, 128, (g) => { for (let k = 0; k < 14; k++) { const x = 30 + Math.random() * 68, y = 40 + Math.random() * 48, r = 18 + Math.random() * 22; const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); } });
  for (let k = 0; k < 70; k++) { const c = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloudTex, transparent: true, opacity: 0.85, depthWrite: false })); const a = Math.random() * Math.PI * 2, r = 400 + Math.random() * 9000; c.position.set(Math.cos(a) * r, 2000 + Math.random() * 7000, Math.sin(a) * r); c.scale.setScalar(900 + Math.random() * 1500); world.add(c); }
  // Earth, far below: a real-size sphere (its curve shows once you're high up)
  const R_E = 6371000;
  const earthTex = paintTexture(THREE, 1024, 512, (g, w, h) => { const m = noise2(11); const img = g.createImageData(w, h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const lat = Math.abs(y / h - 0.5) * 2, v = m((x / w) * 6, (y / h) * 6, 5), cl = m((x / w) * 14 + 9, (y / h) * 14, 4); let c = lat > 0.86 ? [236, 240, 245] : v > 0.53 ? [70 + v * 70, 120 + v * 40, 60] : [20, 60 + v * 60, 140 + v * 60]; if (cl > 0.6) c = [228, 232, 238]; const k = (y * w + x) * 4; img.data[k] = c[0]; img.data[k + 1] = c[1]; img.data[k + 2] = c[2]; img.data[k + 3] = 255; } g.putImageData(img, 0, 0); });
  const earth = new THREE.Mesh(new THREE.SphereGeometry(R_E, 128, 64), new THREE.MeshStandardMaterial({ map: earthTex, roughness: 0.9 }));
  earth.position.y = -R_E - 30; world.add(earth);
  const air = new THREE.Mesh(new THREE.SphereGeometry(R_E + 90000, 96, 48), new THREE.MeshBasicMaterial({ color: 0x6fa8ff, transparent: true, opacity: 0.18, side: THREE.BackSide, depthWrite: false }));
  air.position.copy(earth.position); world.add(air);
  // stars appear as the sky turns black
  const sp = new Float32Array(3000 * 3); for (let k = 0; k < 3000; k++) { const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).normalize().multiplyScalar(3e7); sp.set([v.x, v.y, v.z], k * 3); }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  const stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false, transparent: true, opacity: 0 }));
  scene.add(stars);

  /* ---------- the rocket ---------- */
  const rocket = new THREE.Group(); scene.add(rocket);
  const bell = new THREE.MeshStandardMaterial({ color: 0x5a5d66, roughness: 0.35, metalness: 0.85, side: THREE.DoubleSide });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1a1b20, roughness: 0.6, metalness: 0.2 });
  function bodyTex(look, label, segs) {
    return paintTexture(THREE, 512, 1024, (g, w, h) => {
      g.fillStyle = look.body; g.fillRect(0, 0, w, h);
      if (segs) { g.fillStyle = 'rgba(0,0,0,.18)'; for (let k = 1; k < 5; k++) g.fillRect(0, (h * k) / 5 - 4, w, 8); } // a solid motor's segments
      g.fillStyle = look.band; g.fillRect(0, 0, w, h * 0.06); g.fillRect(0, h * 0.94, w, h * 0.06);
      if (look.body === '#d9772f') { const m = noise2(5); g.globalAlpha = 0.25; for (let y = 0; y < h; y += 4) for (let x = 0; x < w; x += 4) { const v = m(x / 40, y / 40, 3); g.fillStyle = v > 0.5 ? '#a8551c' : '#f09a4d'; g.fillRect(x, y, 4, 4); } g.globalAlpha = 1; } // foam insulation
      if (label) { g.save(); g.translate(w * 0.25, h * 0.5); g.rotate(-Math.PI / 2); g.fillStyle = look.band; g.font = `900 ${Math.round(w * 0.18)}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(label, 0, 0); g.restore(); }
    });
  }
  function nozzle(r, len) { // an engine bell, opening downward
    const pts = []; for (let k = 0; k <= 12; k++) { const t = k / 12; pts.push(new THREE.Vector2(r * (0.35 + 0.65 * t ** 1.6), -t * len)); }
    return new THREE.Mesh(new THREE.LatheGeometry(pts, 32), bell);
  }
  let parts = [], dims = [], look = LOOK.kerosene, plume = null, plumeLen = 1;
  const plumeTex = paintTexture(THREE, 64, 256, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,.75)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); const sx = g.createLinearGradient(0, 0, w, 0); sx.addColorStop(0, 'rgba(0,0,0,1)'); sx.addColorStop(0.5, 'rgba(0,0,0,0)'); sx.addColorStop(1, 'rgba(0,0,0,1)'); g.globalCompositeOperation = 'destination-out'; g.fillStyle = sx; g.fillRect(0, 0, w, h); });
  // build the stack from stage `from` upward; returns its height
  function build(D, eng, from = 0) {
    parts.forEach((p) => rocket.remove(p)); parts = [];
    look = LOOK[eng] || LOOK.kerosene;
    const st = D.st.slice(from);
    dims = st.map((s, i) => { const f = s.f / 1000; return { h: 5 + 3.4 * Math.cbrt(f), d: Math.min(1.4 + 0.42 * Math.cbrt(D.st[0].f / 1000), 1.1 + 0.55 * Math.cbrt(f)) }; });
    const engines = from === 0 ? Math.max(1, Math.min(9, Math.round(D.st[0].T / 900e3))) : 1;
    let y = 0;
    st.forEach((s, i) => {
      const { h, d } = dims[i];
      const g = new THREE.Group(); g.position.y = y;
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(d / 2, d / 2, h, 48, 1, true), new THREE.MeshStandardMaterial({ map: bodyTex(look, i === 0 ? 'CASSIE' : '', eng === 'solid'), roughness: 0.55, metalness: 0.05 }));
      tank.position.y = h / 2; g.add(tank);
      const cap = new THREE.Mesh(new THREE.CircleGeometry(d / 2, 48), dark); cap.rotation.x = Math.PI / 2; g.add(cap);
      // engines under the stage (a ring of them under a big first stage)
      const ne = i === 0 ? engines : 1, er = ne === 1 ? d * 0.33 : d * 0.15, len = er * 2.6;
      for (let k = 0; k < ne; k++) { const a = (k / Math.max(1, ne - (ne > 1 ? 1 : 0))) * Math.PI * 2, rr = ne === 1 || k === ne - 1 ? 0 : d * 0.3; const b = nozzle(er, len); b.position.set(Math.cos(a) * rr, 0, Math.sin(a) * rr); g.add(b); }
      g.userData.nozzleLen = len; g.userData.engines = ne; g.userData.er = er;
      // an interstage ring on top (or fins on a one-stage or solid rocket)
      if (i < st.length - 1) { const ring = new THREE.Mesh(new THREE.CylinderGeometry(dims[i + 1].d / 2, d / 2, Math.max(1, d * 0.6), 48, 1, true), dark); ring.position.y = h + Math.max(1, d * 0.6) / 2; g.add(ring); }
      if (i === 0 && (st.length === 1 || eng === 'solid')) for (let k = 0; k < 4; k++) { const fin = new THREE.Mesh(new THREE.BoxGeometry(0.15, h * 0.18, d * 0.55), dark); const a = (k * Math.PI) / 2 + Math.PI / 4; fin.position.set(Math.cos(a) * (d / 2 + d * 0.22), h * 0.1, Math.sin(a) * (d / 2 + d * 0.22)); fin.rotation.y = -a; g.add(fin); }
      rocket.add(g); parts.push(g);
      y += h + (i < st.length - 1 ? Math.max(1, d * 0.6) : 0);
    });
    // the payload fairing: a smooth pointed nose
    const top = dims[dims.length - 1], fd = top.d, fh = fd * 2.4, pts = [];
    for (let k = 0; k <= 24; k++) { const t = k / 24; pts.push(new THREE.Vector2((fd / 2) * Math.sqrt(1 - t ** 1.8), t * fh)); }
    const nose = new THREE.Mesh(new THREE.LatheGeometry(pts, 48), new THREE.MeshStandardMaterial({ color: 0xf4f4f2, roughness: 0.5 }));
    nose.position.y = y; rocket.add(nose); parts.push(nose);
    // the flame
    const g0 = parts[0], pl = new THREE.Mesh(new THREE.ConeGeometry(dims[0].d * 0.42, 1, 32, 1, true), new THREE.MeshBasicMaterial({ map: plumeTex, color: new THREE.Color(...look.plume), transparent: true, opacity: look.glow, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    pl.rotation.x = Math.PI; pl.visible = false; g0.add(pl); plume = pl;
    plume.userData.base = -g0.userData.nozzleLen;
    const total = y + fh;
    rocket.userData.height = total;
    return total;
  }

  /* ---------- smoke, and stages falling away ---------- */
  const smokeTex = paintTexture(THREE, 64, 64, (g) => { const r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, 'rgba(255,255,255,.7)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 64); });
  const puffs = [], falling = [];
  let h = 0, v = 0, burning = false, lastH = 0, shake = 0;
  S.onFrame((dt) => {
    // the world sinks as the rocket climbs; the sky darkens with height
    world.position.y = -h;
    const k = Math.min(1, h / 60000), k2 = Math.min(1, h / 100000);
    const sky = new THREE.Color(0x7db4e6).lerp(new THREE.Color(0x0b1430), Math.min(1, h / 35000)).lerp(new THREE.Color(0x000000), k2);
    S.renderer.setClearColor(sky, 1);
    stars.material.opacity = Math.max(0, (h - 30000) / 50000);
    air.material.opacity = 0.18 * Math.min(1, h / 20000);
    // the flame grows wider and longer as the air thins
    if (plume) {
      plume.visible = burning;
      if (burning) { const len = parts[0].userData.nozzleLen * (6 + 10 * k) * (0.9 + Math.random() * 0.2); plume.scale.set(1 + 2.5 * k, len, 1 + 2.5 * k); plume.position.y = plume.userData.base - len / 2; }
    }
    // smoke below the clouds, left in the air behind the rocket
    if (burning && h < 15000 && Math.random() < 0.9 * look.smoke) {
      const p = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, color: 0xdedcd6, transparent: true, opacity: 0.6, depthWrite: false }));
      p.position.set((Math.random() - 0.5) * 2, h - parts[0].userData.nozzleLen * 3, (Math.random() - 0.5) * 2); p.scale.setScalar(dims[0].d * 3); p.userData.age = 0;
      world.add(p); puffs.push(p);
    }
    for (let i = puffs.length - 1; i >= 0; i--) { const p = puffs[i]; p.userData.age += dt; p.scale.multiplyScalar(1 + dt * 0.6); p.material.opacity = Math.max(0, 0.6 - p.userData.age / 10); if (p.userData.age > 10) { world.remove(p); p.material.dispose(); puffs.splice(i, 1); } }
    // dropped stages fall (in the world, so they shrink away below)
    for (let i = falling.length - 1; i >= 0; i--) { const f = falling[i]; f.userData.v -= 9.8 * dt * 6; f.position.y += f.userData.v * dt * 6; f.rotation.z += f.userData.spin * dt; if (f.position.y < -50) { world.remove(f); falling.splice(i, 1); } }
    // a little shake at lift-off
    shake = burning && h < 2000 ? 0.04 : 0;
    rocket.position.x = (Math.random() - 0.5) * shake; rocket.position.z = (Math.random() - 0.5) * shake;
    lastH = h;
  });
  // where the camera looks from at the start
  function frame(height) {
    controls.target.set(0, height * 0.45, 0);
    camera.position.set(height * 0.95, height * 0.55, height * 1.25);
    controls.minDistance = 3; controls.maxDistance = Math.max(400, height * 12);
  }
  return {
    // a new design on the pad
    show(D, eng) { falling.forEach((f) => world.remove(f)); falling.length = 0; h = 0; v = 0; burning = false; const H = build(D, eng); buildTower(H); frame(H); },
    // the flight from the lab's physics: height (m), speed (m/s), which stage is firing, is it burning
    fly(F) {
      if (F.stage !== rocket.userData.stage) {
        if (rocket.userData.stage != null && F.stage > rocket.userData.stage) {
          // the empty stage drops away and falls back
          const old = parts[0].clone(); old.position.y = h; old.userData.v = Math.max(0, v * 0.2); old.userData.spin = (Math.random() - 0.5) * 0.6;
          world.add(old); falling.push(old);
          build(F.D, F.eng, F.stage);
        }
        rocket.userData.stage = F.stage;
      }
      h = F.h; v = F.v; burning = F.burning;
      controls.maxDistance = Math.max(400, (rocket.userData.height || 50) * 12, h > 30000 ? h * 4 : 0);
    },
    zoomOut() { controls.maxDistance = Math.max(controls.maxDistance, h * 4 + 2000); S.flyTo(controls.target.clone(), Math.max(200, h * 2.5 + 400), { dur: 1.2 }); },
    destroy: () => S.destroy(),
  };
}

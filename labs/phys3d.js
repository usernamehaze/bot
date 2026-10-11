/* The physics labs (and the Tower of Hanoi) as real things: a brass pendulum on a stand with a
   protractor, a cannon on a field (or the Moon, Mars, Jupiter's cloud tops), a rope shaken by a
   wave driver, a laser shining into a tank of water or a glass block, bar magnets and a compass
   on a sheet of paper, lenses and mirrors on an optical bench, and wooden disks on pegs.
   Each scene only draws: the lab's own model decides what happens (see bench3d.js). */
import { between, unitRod, standMesh } from './bench3d.js';

/* ---------------- Pendulum ---------------- */
export function pendulum3d(B) {
  const { THREE, scene } = B;
  const steel = B.metal(0xd8d9dd, 0.22), brass = B.metal(0xcfa548, 0.22);
  const stand = standMesh(B);
  const arm = unitRod(B, steel, 16), boss = new THREE.Mesh(new B.A.RoundedBoxGeometry(1, 1, 1, 2, 0.15), B.metal(0x3b3d43, 0.4));
  const rod = unitRod(B, B.metal(0xbfc1c6, 0.3), 10), rod2 = unitRod(B, B.metal(0xbfc1c6, 0.3), 10);
  const bob = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), brass), bob1 = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 24), steel);
  const ghostM = new THREE.MeshPhysicalMaterial({ color: 0x7fb2ff, transparent: true, opacity: 0.4, roughness: 0.3, depthWrite: false });
  const gRod = unitRod(B, ghostM, 8), gRod2 = unitRod(B, ghostM, 8), gBob = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), ghostM), gBob1 = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), ghostM);
  [arm, boss, rod, rod2, bob, bob1].forEach((m) => { m.castShadow = true; });
  // a clear protractor behind the swing, marked every 10°
  const proTex = B.card(1024, 512, (c, cw, ch) => {
    c.clearRect(0, 0, cw, ch);
    const cx = cw / 2, r = cw / 2 - 6;
    c.fillStyle = 'rgba(230,240,255,.10)'; c.beginPath(); c.arc(cx, 0, r, 0, Math.PI); c.fill();
    c.strokeStyle = 'rgba(255,255,255,.8)'; c.fillStyle = 'rgba(255,255,255,.85)'; c.lineWidth = 3; c.font = '600 30px -apple-system, Segoe UI, sans-serif'; c.textAlign = 'center';
    for (let d = -90; d <= 90; d += 5) {
      const a = Math.PI / 2 - (d * Math.PI) / 180, l = d % 30 === 0 ? 48 : d % 10 === 0 ? 30 : 16;
      c.lineWidth = d % 10 === 0 ? 3 : 2;
      c.beginPath(); c.moveTo(cx + Math.cos(a) * r, Math.sin(a) * r); c.lineTo(cx + Math.cos(a) * (r - l), Math.sin(a) * (r - l)); c.stroke();
      if (d % 30 === 0) c.fillText(Math.abs(d) + '°', cx + Math.cos(a) * (r - 80), Math.sin(a) * (r - 80) + 10);
    }
    c.beginPath(); c.arc(cx, 0, r, 0, Math.PI); c.stroke();
  });
  const pro = new THREE.Mesh(new THREE.PlaneGeometry(2, 1), new THREE.MeshBasicMaterial({ map: proTex, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  const trailG = new THREE.BufferGeometry(), gTrailG = new THREE.BufferGeometry();
  trailG.setAttribute('position', new THREE.BufferAttribute(new Float32Array(520 * 3), 3)); gTrailG.setAttribute('position', new THREE.BufferAttribute(new Float32Array(520 * 3), 3));
  const trail = new THREE.Line(trailG, new THREE.LineBasicMaterial({ color: 0xffcf5a, transparent: true, opacity: 0.75 })), gTrail = new THREE.Line(gTrailG, new THREE.LineBasicMaterial({ color: 0x7fb2ff, transparent: true, opacity: 0.55 }));
  scene.add(stand, arm, boss, rod, rod2, bob, bob1, gRod, gRod2, gBob, gBob1, pro, trail, gTrail);
  const v = new THREE.Vector3();
  const setTrail = (line, pts) => { const a = line.geometry.attributes.position; const n = Math.min(pts.length, 520); for (let i = 0; i < n; i++) { v.copy(B.P(pts[pts.length - n + i][0], pts[pts.length - n + i][1], 0)); a.setXYZ(i, v.x, v.y, v.z); } a.needsUpdate = true; line.geometry.setDrawRange(0, n); };
  return {
    update(s) {
      const [px0, py0] = s.pivot, P0 = B.P(px0, py0, 0), floorPx = Math.min(s.h - 8, py0 + s.L * s.px * 1.04 + 30);
      B.setFloor(floorPx);
      const floorY = B.P(0, floorPx).y, back = -B.u(40), sx = P0.x - B.u(110);
      stand.userData.set(sx + 0.45, back, floorY, P0.y + 0.35);
      between(B, arm, new THREE.Vector3(sx, P0.y, back), new THREE.Vector3(P0.x + B.u(8), P0.y, 0), B.u(2.6));
      boss.position.set(sx, P0.y, back); boss.scale.set(B.u(14), B.u(18), B.u(14));
      const pr = Math.min(B.u(s.L * s.px), B.u(150));
      pro.position.set(P0.x, P0.y - pr / 2, -B.u(10)); pro.scale.set(pr, pr, 1);
      const single = s.mode === 'single';
      [rod2, bob1, gRod, gRod2, gBob, gBob1, trail, gTrail].forEach((m) => { m.visible = !single; });
      if (single) {
        const end = B.P(px0 + Math.sin(s.th) * s.L * s.px, py0 + Math.cos(s.th) * s.L * s.px, 0);
        const r = B.u(15);
        between(B, rod, P0, end.clone().sub(new THREE.Vector3(Math.sin(s.th), -Math.cos(s.th), 0).multiplyScalar(r * 0.9)), B.u(1.3));
        bob.position.copy(end); bob.scale.setScalar(r);
      } else {
        const l1 = (s.L / 2) * s.px;
        const draw = (st, r1, r2, b1m, b2m, rr) => {
          const p1 = B.P(px0 + Math.sin(st[0]) * l1, py0 + Math.cos(st[0]) * l1, 0), p2 = B.P(px0 + Math.sin(st[0]) * l1 + Math.sin(st[2]) * l1, py0 + Math.cos(st[0]) * l1 + Math.cos(st[2]) * l1, 0);
          between(B, r1, P0, p1, B.u(rr)); between(B, r2, p1, p2, B.u(rr));
          b1m.position.copy(p1); b1m.scale.setScalar(B.u(9)); b2m.position.copy(p2); b2m.scale.setScalar(B.u(11));
        };
        draw(s.ghost, gRod, gRod2, gBob1, gBob, 1.1);
        draw(s.dp, rod, rod2, bob1, bob, 1.3);
        setTrail(trail, s.trail); setTrail(gTrail, s.gtrail);
      }
    },
  };
}

/* ---------------- Launch lab ---------------- */
export function projectile3d(B) {
  const { THREE, scene } = B;
  let world = '';
  const bronze = B.metal(0x8a6a3e, 0.35), iron = B.metal(0x3a3b3f, 0.45), woodM = B.wood([120, 82, 48]);
  const cannon = new THREE.Group(), barrel = new THREE.Group();
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.46, 1, 32), bronze); tube.rotation.z = -Math.PI / 2; tube.position.x = 0.38;
  const muzzle = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.07, 12, 32), bronze); muzzle.rotation.y = Math.PI / 2; muzzle.position.x = 0.88;
  const breech = new THREE.Mesh(new THREE.SphereGeometry(0.46, 24, 16), bronze); breech.position.x = -0.12;
  barrel.add(tube, muzzle, breech);
  const carriage = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.34, 0.7), woodM); carriage.position.set(-0.25, -0.28, 0);
  const wheels = [-1, 1].map((sd) => { const wh = new THREE.Group(); const rim = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.07, 10, 36), woodM); wh.add(rim); for (let k = 0; k < 6; k++) { const sp = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.94, 0.05), woodM); sp.rotation.z = (k * Math.PI) / 6; wh.add(sp); } const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.16, 16), iron); hub.rotation.x = Math.PI / 2; wh.add(hub); wh.position.set(0, -0.12, sd * 0.47); return wh; });
  cannon.add(barrel, carriage, ...wheels); B.shadowy(cannon);
  const tower = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x8d8a84, roughness: 0.95 }));
  tower.castShadow = tower.receiveShadow = true;
  const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), iron); ball.castShadow = true;
  const dotG = new THREE.SphereGeometry(1, 10, 8);
  const path = new THREE.InstancedMesh(dotG, new THREE.MeshBasicMaterial({ color: 0xffcf5a }), 900);
  const old = new THREE.InstancedMesh(dotG, new THREE.MeshBasicMaterial({ color: 0xffcf5a, transparent: true, opacity: 0.32, depthWrite: false }), 2400);
  const arrowM = new THREE.MeshBasicMaterial({ color: 0xffcf5a, transparent: true, opacity: 0.85 });
  const shaft = unitRod(B, arrowM, 10), head = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 16), arrowM);
  // the target: a bullseye on the ground and a flag
  const bull = B.card(256, 256, (c) => { const rings = ['#e8e6df', '#d94a43', '#e8e6df', '#d94a43', '#e8e6df', '#d94a43']; rings.forEach((col, i) => { c.fillStyle = col; c.beginPath(); c.arc(128, 128, 126 - i * 21, 0, Math.PI * 2); c.fill(); }); });
  const target = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshStandardMaterial({ map: bull, roughness: 0.8 }));
  target.rotation.x = -Math.PI / 2; target.receiveShadow = true;
  const pole = unitRod(B, new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.5 }), 8);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.62), new THREE.MeshStandardMaterial({ color: 0xd94a43, side: THREE.DoubleSide, roughness: 0.8 }));
  const posts = Array.from({ length: 24 }, () => { const p = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xf2f2f0, roughness: 0.6 })); p.castShadow = true; scene.add(p); return p; });
  const postTags = posts.map(() => B.tag('plain'));
  scene.add(cannon, tower, ball, path, old, shaft, head, target, pole, flag);
  const aimTag = B.tag('plain big'), tTag = B.tag('plain red');
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
  let t = 0; B.onFrame((dt) => { t += dt; flag.rotation.y = Math.sin(t * 2.2) * 0.25; });
  return {
    update(s) {
      if (s.gk !== world) { world = s.gk; B.setLook('field', { world }); }
      const { X, Y, sp } = s, groundPx = Y(0);
      B.setFloor(groundPx);
      // the cannon (on a stone tower when launching from up high)
      const base = B.P(X(0), Y(s.h0), 0), size = Math.max(B.u(26), 0.3);
      cannon.position.copy(base).add(new THREE.Vector3(0, size * 0.62, 0)); cannon.scale.setScalar(size);
      barrel.rotation.z = (s.ang * Math.PI) / 180;
      tower.visible = s.h0 > 0;
      if (s.h0 > 0) { const top = base.y, bot = B.P(0, groundPx).y; tower.position.set(base.x - size * 0.2, (top + bot) / 2, 0); tower.scale.set(size * 2.2, Math.max(0.01, top - bot), size * 2); }
      // the launch arrow: which way, and how fast (longer = faster)
      const a = (s.ang * Math.PI) / 180, dir = new THREE.Vector3(Math.cos(a), Math.sin(a), 0);
      const muzzleP = cannon.position.clone().addScaledVector(dir, size * 1.1), L = B.u(16 + s.v * 2.2);
      shaft.visible = head.visible = !s.flight;
      between(B, shaft, muzzleP, muzzleP.clone().addScaledVector(dir, L), B.u(1.6));
      head.position.copy(muzzleP).addScaledVector(dir, L + B.u(6)); head.scale.set(B.u(5), B.u(12), B.u(5)); head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      aimTag.atWorld(muzzleP.clone().addScaledVector(dir, L + B.u(26)), `${s.ang}° · ${s.v} m/s`);
      // the ball in flight, its path, and earlier flights (faint)
      const br = Math.max(B.u(7), 0.09);
      ball.visible = !!s.flight;
      let n = 0;
      if (s.flight) {
        const pts = s.flight.pts, last = pts[pts.length - 1];
        ball.position.copy(B.P(X(last[0]), Y(last[1]) - 7, 0)); ball.scale.setScalar(br);
        for (let i = 0; i < pts.length && n < 900; i += 1) { sc.setScalar(br * 0.28); mtx.compose(B.P(X(pts[i][0]), Y(pts[i][1]) - 7, 0), q, sc); path.setMatrixAt(n++, mtx); }
      }
      path.count = n; path.instanceMatrix.needsUpdate = true;
      let m = 0;
      for (const tr of s.trails) for (let i = 0; i < tr.pts.length && m < 2400; i += 2) { sc.setScalar(br * 0.22); mtx.compose(B.P(X(tr.pts[i][0]), Y(tr.pts[i][1]) - 7, 0), q, sc); old.setMatrixAt(m++, mtx); }
      old.count = m; old.instanceMatrix.needsUpdate = true;
      // the target, and distance posts
      const tp = B.P(X(s.target), groundPx, 0);
      target.position.set(tp.x, tp.y + 0.004, 0); target.scale.setScalar(Math.max(B.u(2 * sp), 0.12));
      const ph = Math.max(B.u(46), 0.6);
      between(B, pole, new THREE.Vector3(tp.x, tp.y, -B.u(3 * sp) - 0.1), new THREE.Vector3(tp.x, tp.y + ph, -B.u(3 * sp) - 0.1), 0.02);
      flag.position.set(tp.x + 0.3 * ph * 0.62, tp.y + ph * 0.85, -B.u(3 * sp) - 0.1); flag.scale.setScalar(ph * 0.6);
      tTag.at(X(s.target), groundPx + 14, 0, 'target');
      const step = s.spanX > 150 ? 50 : s.spanX > 60 ? 20 : 10;
      posts.forEach((p, i) => {
        const x = i * step, px = X(x);
        if (px > s.w + 40 || i === 0) { p.visible = false; postTags[i].hide(); return; }
        p.visible = true; const g = B.P(px, groundPx, B.u(30)); p.position.set(g.x, g.y + 0.09, g.z); p.scale.set(0.06, 0.18, 0.06);
        postTags[i].atWorld(new THREE.Vector3(g.x, g.y - 0.08, g.z + 0.05), x + ' m');
      });
    },
  };
}

/* ---------------- Wave string ---------------- */
export function waves3d(B, N = 200) {
  const { THREE, scene } = B, SIDES = 10;
  const pos = new Float32Array(N * SIDES * 3), nor = new Float32Array(N * SIDES * 3), uv = new Float32Array(N * SIDES * 2), idx = [];
  for (let i = 0; i < N - 1; i++) for (let j = 0; j < SIDES; j++) { const a = i * SIDES + j, b = i * SIDES + ((j + 1) % SIDES), c = a + SIDES, d = b + SIDES; idx.push(a, c, b, b, c, d); }
  for (let i = 0; i < N; i++) for (let j = 0; j < SIDES; j++) { uv[(i * SIDES + j) * 2] = i / 4; uv[(i * SIDES + j) * 2 + 1] = j / SIDES; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(idx);
  const ropeTex = B.card(64, 64, (c) => { c.fillStyle = '#e2b24c'; c.fillRect(0, 0, 64, 64); c.strokeStyle = 'rgba(120,80,20,.55)'; c.lineWidth = 7; for (let k = -64; k < 128; k += 16) { c.beginPath(); c.moveTo(k, 0); c.lineTo(k + 64, 64); c.stroke(); } });
  ropeTex.wrapS = ropeTex.wrapT = THREE.RepeatWrapping;
  const rope = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: ropeTex, roughness: 0.8 }));
  rope.castShadow = true; rope.frustumCulled = false;
  const tape = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 14, 10), new THREE.MeshPhysicalMaterial({ color: 0xf2f2f0, roughness: 0.4, clearcoat: 0.5 }), 24);
  // the wave driver at the left, the clamp / ring on a rod / more string at the right
  const driver = new THREE.Mesh(new B.A.RoundedBoxGeometry(1, 1, 1, 2, 0.08), new THREE.MeshStandardMaterial({ color: 0x232429, roughness: 0.5, metalness: 0.3 }));
  const dial = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 24), B.metal(0xbfc1c6, 0.3)); dial.rotation.x = Math.PI / 2;
  const drive = unitRod(B, B.metal(0xd2d3d7, 0.2), 12);
  const clamp = new THREE.Mesh(new B.A.RoundedBoxGeometry(1, 1, 1, 2, 0.1), B.metal(0x9a9da3, 0.35));
  const post = unitRod(B, B.metal(0xd2d3d7, 0.2), 16), ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.28, 12, 32), B.metal(0xd2d3d7, 0.2));
  const more = unitRod(B, new THREE.MeshStandardMaterial({ map: ropeTex, roughness: 0.8 }), 10);
  const ruler = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), B.wood([196, 160, 104]));
  const rulerFace = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: B.card(2048, 64, (c, cw, ch) => { c.clearRect(0, 0, cw, ch); c.fillStyle = 'rgba(20,16,10,.85)'; for (let m = 0; m <= 100; m++) { const x = 8 + ((cw - 16) * m) / 100, l = m % 10 === 0 ? ch * 0.7 : m % 5 === 0 ? ch * 0.45 : ch * 0.28; c.fillRect(x - 1.5, 0, 3, l); } }), transparent: true, depthWrite: false }));
  [driver, clamp, post, ruler].forEach((m) => { m.castShadow = true; m.receiveShadow = true; });
  scene.add(rope, tape, driver, dial, drive, clamp, post, ring, more, ruler, rulerFace);
  const mTags = Array.from({ length: 6 }, () => B.tag('plain faint'));
  const goTag = B.tag('plain faint');
  const P = new Array(N), T = new THREE.Vector3(), Nn = new THREE.Vector3(), Z = new THREE.Vector3(0, 0, 1), mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
  return {
    update(s) {
      const { L, R, mid, sy } = s, r = Math.max(B.u(2.6), 0.035), X = (i) => L + ((R - L) * i) / (N - 1);
      const floorPx = Math.min(s.h - 6, mid + sy * 2.2 + 26);
      B.setFloor(floorPx);
      for (let i = 0; i < N; i++) P[i] = B.P(X(i), mid - s.y[i] * sy, 0);
      for (let i = 0; i < N; i++) {
        T.subVectors(P[Math.min(N - 1, i + 1)], P[Math.max(0, i - 1)]).normalize(); Nn.crossVectors(Z, T).normalize();
        for (let j = 0; j < SIDES; j++) {
          const a = (j / SIDES) * Math.PI * 2, cx = Math.cos(a), cz = Math.sin(a), k = (i * SIDES + j) * 3;
          const nx = Nn.x * cx + Z.x * cz, ny = Nn.y * cx + Z.y * cz, nz = Nn.z * cx + Z.z * cz;
          pos[k] = P[i].x + nx * r; pos[k + 1] = P[i].y + ny * r; pos[k + 2] = P[i].z + nz * r; nor[k] = nx; nor[k + 1] = ny; nor[k + 2] = nz;
        }
      }
      g.attributes.position.needsUpdate = true; g.attributes.normal.needsUpdate = true;
      let n = 0;
      for (let i = 10; i < N; i += 10) { sc.setScalar(r * 1.7); mtx.compose(P[i], q, sc); tape.setMatrixAt(n++, mtx); }
      tape.count = n; tape.instanceMatrix.needsUpdate = true;
      // the driver shakes the left end
      const floorY = B.P(0, floorPx).y, dTop = B.P(0, mid + sy * 1.7).y;
      driver.position.set(P[0].x, (dTop + floorY) / 2, 0); driver.scale.set(B.u(46), dTop - floorY, B.u(46));
      dial.position.set(P[0].x, (dTop + floorY) / 2, B.u(23) + 0.01); dial.scale.set(B.u(9), 0.03, B.u(9));
      between(B, drive, new THREE.Vector3(P[0].x, dTop, 0), P[0], r * 1.6);
      const far = P[N - 1];
      clamp.visible = s.end === 'fixed'; post.visible = ring.visible = s.end === 'loose'; more.visible = s.end === 'none';
      const top = B.P(R, mid - sy * 1.6).y, bot = floorY;
      if (s.end === 'fixed') { clamp.position.set(far.x + B.u(6), far.y, 0); clamp.scale.set(B.u(16), B.u(30), B.u(22)); between(B, post, new THREE.Vector3(far.x + B.u(6), bot, 0), new THREE.Vector3(far.x + B.u(6), far.y, 0), B.u(4)); post.visible = true; }
      if (s.end === 'loose') { between(B, post, new THREE.Vector3(B.P(R + 4, 0).x, bot, 0), new THREE.Vector3(B.P(R + 4, 0).x, top, 0), B.u(2.5)); ring.position.set(B.P(R + 4, 0).x, B.P(0, mid - s.y[N - 1] * sy).y, 0); ring.rotation.x = Math.PI / 2; ring.scale.setScalar(B.u(5)); }
      if (s.end === 'none') { between(B, more, far, far.clone().add(new THREE.Vector3(40, 0, 0)), r); goTag.at(R - 60, mid - sy * 1.9, 0, 'the string goes on (no reflection)'); } else goTag.hide();
      // a metre rule along the bench
      const ry = B.P(0, mid + sy * 2.05).y, rz = B.u(40);
      ruler.position.set((B.P(L, 0).x + B.P(R, 0).x) / 2, ry, rz); ruler.scale.set(B.P(R, 0).x - B.P(L, 0).x + 0.2, B.u(14), 0.05);
      rulerFace.position.set(ruler.position.x, ry + B.u(2), rz + 0.026); rulerFace.scale.set(ruler.scale.x - 0.03, B.u(10), 1);
      mTags.forEach((tg, i) => { const m = i * 2; tg.at(L + ((R - L) * m) / 10, mid + sy * 2.05 + 16, 40, m + ' m'); });
    },
  };
}

/* ---------------- Bending light ---------------- */
export function light3d(B) {
  const { THREE, scene } = B;
  const looks = {
    air: null,
    water: () => B.liquid(0x5f9ad8, { opacity: 0.32 }),
    glass: () => B.glass({ thickness: 2, attenuationColor: new THREE.Color(0xbfe8da), attenuationDistance: 6, roughness: 0.02 }),
    diamond: () => B.glass({ thickness: 2, ior: 2.42, dispersion: 3, attenuationColor: new THREE.Color(0xeee8ff), attenuationDistance: 12 }),
  };
  const top = new THREE.Mesh(new B.A.RoundedBoxGeometry(1, 1, 1, 2, 0.02)), bottom = new THREE.Mesh(new B.A.RoundedBoxGeometry(1, 1, 1, 2, 0.02));
  scene.add(top, bottom);
  let made = { top: '', bottom: '' };
  const laser = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1, 28), new THREE.MeshPhysicalMaterial({ color: 0x1a1b1f, roughness: 0.35, clearcoat: 0.6 }));
  const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 0.25, 28), B.metal(0xcfd0d4, 0.2)); tip.position.y = -0.62;
  const btn = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.2, 0.22), new THREE.MeshStandardMaterial({ color: 0xd94a43 })); btn.position.set(0.48, 0.15, 0);
  laser.add(body, tip, btn); B.shadowy(laser);
  const beam = () => { const core = unitRod(B, new THREE.MeshBasicMaterial({ color: 0xff5a52, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false }), 10); const halo = unitRod(B, new THREE.MeshBasicMaterial({ color: 0xff2a20, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false }), 12); scene.add(core, halo); return { core, halo }; };
  const inB = beam(), refl = beam(), outB = beam();
  const spot = B.glow(0xff6a60, 1, 0.9), spot2 = B.glow(0xff6a60, 1, 0.8);
  const dash = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45 }), 60);
  const arcM = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const arcIn = new THREE.Mesh(new THREE.BufferGeometry(), arcM), arcOut = new THREE.Mesh(new THREE.BufferGeometry(), arcM);
  const edge = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 }));
  scene.add(laser, spot, spot2, dash, arcIn, arcOut, edge);
  const tIn = B.tag('plain'), tOut = B.tag('plain'), tTir = B.tag('plain gold');
  let lastA = -1, lastB = -1;
  const setBeam = (bm, a, b, op) => { bm.core.visible = bm.halo.visible = op > 0.01; between(B, bm.core, a, b, B.u(1.4)); between(B, bm.halo, a, b, B.u(5)); bm.core.material.opacity = Math.min(1, op * 1.2); bm.halo.material.opacity = 0.22 * op; };
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
  return {
    update(s) {
      const { O, len, k } = s, w = s.w, h = s.h, depth = B.u(Math.min(w, h) * 0.9);
      B.setFloor(h + 4);
      for (const [mesh, which, y0, y1] of [[top, 'top', 0, O[1]], [bottom, 'bottom', O[1], h + 4]]) {
        const kind = s[which];
        if (made[which] !== kind) { made[which] = kind; if (mesh.material && mesh.material.dispose) mesh.material.dispose(); mesh.material = looks[kind] ? looks[kind]() : new THREE.MeshBasicMaterial({ visible: false }); }
        const a = B.P(-20, y0), b = B.P(w + 20, y1);
        mesh.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, -depth / 2 + B.u(20)); mesh.scale.set(b.x - a.x, Math.abs(a.y - b.y) - 0.002, depth);
      }
      const o = B.P(O[0], O[1], 0);
      edge.position.copy(o); edge.scale.set(B.u(w + 40), 0.004, 0.004);
      const from = B.P(O[0] - Math.sin(k.a) * len, O[1] - Math.cos(k.a) * len, 0);
      const dirIn = o.clone().sub(from).normalize();
      laser.position.copy(from).addScaledVector(dirIn, -B.u(22)); laser.scale.set(B.u(13), B.u(44), B.u(13)); laser.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dirIn);
      setBeam(inB, from, o, 1);
      setBeam(refl, o, B.P(O[0] + Math.sin(k.a) * len, O[1] - Math.cos(k.a) * len, 0), Math.max(0.08, k.R));
      if (k.tir) outB.core.visible = outB.halo.visible = false; else setBeam(outB, o, B.P(O[0] + Math.sin(k.b) * len, O[1] + Math.cos(k.b) * len, 0), Math.max(0.15, 1 - k.R));
      spot.position.copy(o); spot.scale.setScalar(B.u(30)); spot2.position.copy(from); spot2.scale.setScalar(B.u(16));
      // the normal (dashed), and the angles measured from it
      let n = 0; const dl = B.u(len * 2) / 40;
      for (let i = 0; i < 40; i += 2) { const y = o.y + B.u(len) - (i + 0.5) * dl; sc.set(B.u(0.8), dl, B.u(0.8)); mtx.compose(new THREE.Vector3(o.x, y, 0), q, sc); dash.setMatrixAt(n++, mtx); }
      dash.count = n; dash.instanceMatrix.needsUpdate = true;
      const R = B.u(46);
      if (Math.abs(k.a - lastA) > 1e-4) { lastA = k.a; arcIn.geometry.dispose(); arcIn.geometry = new THREE.TorusGeometry(1, 0.012, 6, 48, Math.max(0.001, k.a)); }
      arcIn.position.copy(o); arcIn.scale.setScalar(R); arcIn.rotation.set(0, 0, Math.PI / 2);
      arcOut.visible = !k.tir;
      if (!k.tir) { if (Math.abs(k.b - lastB) > 1e-4) { lastB = k.b; arcOut.geometry.dispose(); arcOut.geometry = new THREE.TorusGeometry(1, 0.012, 6, 48, Math.max(0.001, k.b)); } arcOut.position.copy(o); arcOut.scale.setScalar(R); arcOut.rotation.set(0, 0, -Math.PI / 2); }
      tIn.at(O[0] - 16 - Math.sin(k.a / 2) * 64, O[1] - Math.cos(k.a / 2) * 64, 0, `${s.angText}°`);
      if (!k.tir) { tOut.at(O[0] + 14 + Math.sin(k.b / 2) * 66, O[1] + Math.cos(k.b / 2) * 66, 0, `${s.outText}°`); tTir.hide(); }
      else { tOut.hide(); tTir.at(O[0], O[1] + 44, 0, 'Total internal reflection — no light gets through'); }
    },
  };
}

/* ---------------- Magnetic field ---------------- */
export function magnets3d(B) {
  const { THREE, scene } = B;
  // the field is drawn onto a sheet of paper on the bench (the lab's own drawing, in pencil colours)
  const paperC = document.createElement('canvas');
  let paperT = null;
  const paper = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ roughness: 0.9 }));
  paper.rotation.x = -Math.PI / 2; paper.receiveShadow = true; scene.add(paper);
  const red = new THREE.MeshPhysicalMaterial({ color: 0xc8322f, roughness: 0.35, clearcoat: 0.6, metalness: 0.2 }), blue = new THREE.MeshPhysicalMaterial({ color: 0x2f5bc8, roughness: 0.35, clearcoat: 0.6, metalness: 0.2 });
  const letter = (ch) => new THREE.MeshBasicMaterial({ map: B.card(128, 128, (c) => { c.clearRect(0, 0, 128, 128); c.fillStyle = '#fff'; c.font = '800 96px -apple-system, Segoe UI, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(ch, 64, 70); }), transparent: true, depthWrite: false });
  const nL = letter('N'), sL = letter('S');
  const mags = [];
  const magnet = () => {
    const g = new THREE.Group();
    const n = new THREE.Mesh(new B.A.RoundedBoxGeometry(0.5, 1, 1, 2, 0.06), red), s = new THREE.Mesh(new B.A.RoundedBoxGeometry(0.5, 1, 1, 2, 0.06), blue);
    n.position.x = 0.25; s.position.x = -0.25;
    const ln = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.8), nL), ls = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.8), sL);
    ln.rotation.x = ls.rotation.x = -Math.PI / 2; ln.position.set(0.36, 0.501, 0); ls.position.set(-0.36, 0.501, 0);
    g.add(n, s, ln, ls); n.castShadow = s.castShadow = true; scene.add(g); return g;
  };
  const wires = [];
  const copper = B.metal(0xd98a5a, 0.25);
  const wire = () => { const g = new THREE.Group(); const rod = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 24), copper); rod.castShadow = true; const cone = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 20), new THREE.MeshBasicMaterial({ color: 0xffcf5a })); g.add(rod, cone); g.userData = { rod, cone }; scene.add(g); return g; };
  // a compass: a brass case, a printed dial, a red-and-white needle, a glass top
  const compass = new THREE.Group();
  const caseM = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.04, 0.36, 48, 1, true), B.metal(0xc9a24a, 0.25));
  const floor = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshStandardMaterial({ roughness: 0.7, map: B.card(256, 256, (c) => { c.fillStyle = '#f4f1e8'; c.fillRect(0, 0, 256, 256); c.strokeStyle = '#2a2a2a'; c.fillStyle = '#2a2a2a'; c.lineWidth = 2; for (let d = 0; d < 360; d += 10) { const a = (d * Math.PI) / 180, l = d % 90 === 0 ? 20 : 10; c.beginPath(); c.moveTo(128 + Math.cos(a) * 122, 128 + Math.sin(a) * 122); c.lineTo(128 + Math.cos(a) * (122 - l), 128 + Math.sin(a) * (122 - l)); c.stroke(); } }) }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -0.12;
  const needle = new THREE.Group();
  const nRed = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.85, 4), new THREE.MeshStandardMaterial({ color: 0xd8322c, roughness: 0.4, metalness: 0.3 })), nWhite = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.85, 4), new THREE.MeshStandardMaterial({ color: 0xe8e6df, roughness: 0.4 }));
  nRed.rotation.z = -Math.PI / 2; nRed.position.x = 0.42; nWhite.rotation.z = Math.PI / 2; nWhite.position.x = -0.42; nRed.scale.z = nWhite.scale.z = 0.35;
  const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.1, 16), B.metal(0xc9a24a, 0.25));
  needle.add(nRed, nWhite, pin); needle.position.y = 0;
  const lid = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: 0.12, roughness: 0.02, clearcoat: 1, depthWrite: false }));
  lid.rotation.x = -Math.PI / 2; lid.position.y = 0.18;
  compass.add(caseM, floor, needle, lid); B.shadowy(caseM);
  scene.add(compass);
  const wTags = [];
  let ver = -1;
  return {
    update(s) {
      const k = B.k, w = B.w, h = B.h, d = Math.min(2, window.devicePixelRatio || 1);
      if (s.ver !== ver || paperC.width !== Math.round(w * d)) {
        ver = s.ver;
        const resized = paperC.width !== Math.round(w * d) || paperC.height !== Math.round(h * d);
        if (resized) { paperC.width = Math.round(w * d); paperC.height = Math.round(h * d); }
        const ctx = paperC.getContext('2d'); ctx.setTransform(d, 0, 0, d, 0, 0);
        ctx.fillStyle = '#f3f1ea'; ctx.fillRect(0, 0, w, h);
        s.drawField(ctx, w, h, 'paper');
        if (!paperT || resized) { if (paperT) paperT.dispose(); paperT = new THREE.CanvasTexture(paperC); paperT.colorSpace = THREE.SRGBColorSpace; paperT.anisotropy = 8; paper.material.map = paperT; paper.material.needsUpdate = true; }
        else paperT.needsUpdate = true;
      }
      paper.position.set(0, 0.002, 0); paper.scale.set(w / k, h / k, 1);
      while (mags.length < s.mags.length) mags.push(magnet());
      mags.forEach((g, i) => {
        const m = s.mags[i]; g.visible = !!m; if (!m) return;
        const p = B.P(m.x, m.y, s.MW * 0.3); g.position.copy(p); g.rotation.set(0, -m.a, 0); g.scale.set(B.u(s.ML), B.u(s.MW * 0.6), B.u(s.MW));
      });
      while (wires.length < s.wires.length) wires.push(wire());
      wires.forEach((g, i) => {
        const wi = s.wires[i]; g.visible = !!wi; if (!wi) { if (wTags[i]) wTags[i].hide(); return; }
        const H = B.u(120), p = B.P(wi.x, wi.y, 0);
        g.position.copy(p); g.userData.rod.scale.set(B.u(7), H, B.u(7)); g.userData.rod.position.y = H / 2;
        g.userData.cone.scale.set(B.u(9), B.u(18), B.u(9)); g.userData.cone.position.y = H * 0.72; g.userData.cone.rotation.x = wi.I > 0 ? 0 : Math.PI;
        (wTags[i] = wTags[i] || B.tag('plain on-light')).atWorld(new THREE.Vector3(p.x, H + 0.15, p.z), wi.I > 0 ? 'current up ⊙' : 'current down ⊗');
      });
      const [bx, by] = s.B(s.compass.x, s.compass.y), m = Math.hypot(bx, by) || 1;
      compass.position.copy(B.P(s.compass.x, s.compass.y, 6)); compass.scale.setScalar(B.u(22));
      needle.rotation.y = Math.atan2(-by / m, bx / m);
    },
  };
}

/* ---------------- Lenses and mirrors ---------------- */
export function optics3d(B) {
  const { THREE, scene } = B;
  const rail = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), B.metal(0xb9bcc2, 0.35));
  const railFace = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, map: B.card(2048, 64, (c, cw, ch) => { c.clearRect(0, 0, cw, ch); c.fillStyle = 'rgba(16,17,22,.85)'; for (let m = 0; m <= 200; m++) { const x = (cw * m) / 200, l = m % 10 === 0 ? ch * 0.8 : m % 5 === 0 ? ch * 0.55 : ch * 0.32; c.fillRect(x - 1.5, 0, 3, l); } }) }));
  rail.receiveShadow = rail.castShadow = true;
  const axis = unitRod(B, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25 }), 6);
  let lensKey = '', lens = null;
  const glassM = B.glass({ thickness: 0.6 }), mirrorM = new THREE.MeshStandardMaterial({ color: 0xf2f3f5, metalness: 1, roughness: 0.04, side: THREE.DoubleSide });
  function makeLens(kind, hh) {
    if (lens) { scene.remove(lens); lens.geometry.dispose(); }
    const pts = [], R = 1, steps = 24, mirror = kind === 'cmirror' || kind === 'vmirror';
    if (mirror) {
      const sag = (kind === 'cmirror' ? 1 : -1) * 0.12;
      for (let i = 0; i <= steps; i++) { const r = (R * i) / steps; pts.push(new THREE.Vector2(r, sag * (r / R) ** 2)); }
      for (let i = steps; i >= 0; i--) { const r = (R * i) / steps; pts.push(new THREE.Vector2(r, sag * (r / R) ** 2 + 0.035)); }
    } else {
      const convex = kind === 'convex', c = 0.16, e = convex ? 0.02 : 0.04;
      const y = (r) => (convex ? e + c * (1 - (r / R) ** 2) : e + c * (r / R) ** 2);
      for (let i = 0; i <= steps; i++) { const r = (R * i) / steps; pts.push(new THREE.Vector2(r, -y(r))); }
      for (let i = steps; i >= 0; i--) { const r = (R * i) / steps; pts.push(new THREE.Vector2(r, y(r))); }
    }
    lens = new THREE.Mesh(new THREE.LatheGeometry(pts, 64), mirror ? mirrorM : glassM);
    lens.castShadow = true; scene.add(lens);
  }
  const post = unitRod(B, new THREE.MeshStandardMaterial({ color: 0x24262b, roughness: 0.5, metalness: 0.4 }), 16);
  const arrow = (mat) => { const g = new THREE.Group(); const sh = unitRod(B, mat, 12), hd = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 20), mat); g.add(sh, hd); g.userData = { sh, hd }; B.shadowy(g); scene.add(g); return g; };
  const objM = new THREE.MeshStandardMaterial({ color: 0xffcf5a, emissive: 0x6a4a00, roughness: 0.35, metalness: 0.4 });
  const imgSolid = new THREE.MeshStandardMaterial({ color: 0x7fb2ff, emissive: 0x16345e, roughness: 0.35, transparent: true, opacity: 1 });
  const obj = arrow(objM), img = arrow(imgSolid), objPost = unitRod(B, post.material, 12);
  scene.add(rail, railFace, axis, post, objPost);
  const rays = [];
  const ray = () => { const m = unitRod(B, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }), 6); scene.add(m); return m; };
  const marks = Array.from({ length: 4 }, () => { const m = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), new THREE.MeshStandardMaterial({ color: 0xf2f2f4, roughness: 0.4 })); scene.add(m); return m; });
  const markTags = marks.map(() => B.tag('plain faint')), oTag = B.tag('plain gold'), iTag = B.tag('plain blue'), note = B.tag('plain blue');
  const setArrow = (g, x, y0, y1, r) => {
    const a = B.P(x, y0, 0), b = B.P(x, y1, 0), up = b.y > a.y ? 1 : -1, head = B.u(10);
    between(B, g.userData.sh, a, new THREE.Vector3(b.x, b.y - up * head, 0), r);
    g.userData.hd.position.set(b.x, b.y - (up * head) / 2, 0); g.userData.hd.scale.set(r * 2.6, head, r * 2.6); g.userData.hd.rotation.z = up > 0 ? 0 : Math.PI;
  };
  return {
    update(s) {
      const { X, Y, ax, ox, hh, w, h } = s, railPx = Math.min(h - 10, ax + hh + 18);
      B.setFloor(railPx + 10);
      const r0 = B.P(0, railPx), r1 = B.P(w, railPx);
      rail.position.set((r0.x + r1.x) / 2, r0.y, 0); rail.scale.set(r1.x - r0.x + 1, B.u(12), B.u(36));
      railFace.position.set(rail.position.x, r0.y, B.u(18) + 0.003); railFace.scale.set(rail.scale.x, B.u(11), 1);
      between(B, axis, B.P(0, ax), B.P(w, ax), B.u(0.7));
      const key = `${s.kind}|${hh}`;
      if (key !== lensKey) { lensKey = key; makeLens(s.kind, hh); }
      const o = B.P(ox, ax, 0), H = B.u(hh);
      lens.position.copy(o); lens.scale.set(H, B.u(hh * (s.mirror ? 0.9 : 0.75)), H); lens.rotation.set(0, 0, -Math.PI / 2);
      between(B, post, new THREE.Vector3(o.x, o.y - H, 0), new THREE.Vector3(o.x, r0.y, 0), B.u(4));
      // the object (gold) on its post, and the image (blue: solid if real, ghostly if virtual)
      setArrow(obj, X(-s.u), ax, Y(s.ho), B.u(2.4));
      between(B, objPost, B.P(X(-s.u), ax), B.P(X(-s.u), railPx), B.u(2.6));
      oTag.at(X(-s.u), ax + 18, 0, 'object');
      img.visible = s.showImage;
      if (s.showImage) { setArrow(img, X(s.ix), ax, Y(s.hi), B.u(2.4)); imgSolid.opacity = s.real ? 1 : 0.38; imgSolid.depthWrite = s.real; iTag.at(X(s.ix), Y(s.hi) + (s.hi > 0 ? -12 : 18), 0, s.real ? 'image (real)' : 'image (virtual)'); } else iTag.hide();
      if (s.note) note.at(w / 2, 24, 0, s.note); else note.hide();
      // the three rays
      while (rays.length < s.segs.length) rays.push(ray());
      rays.forEach((m, i) => {
        const sg = s.segs[i]; m.visible = !!sg; if (!sg) return;
        between(B, m, B.P(sg.a[0], sg.a[1], 0), B.P(sg.b[0], sg.b[1], 0), B.u(sg.dashed ? 0.8 : 1.2));
        m.material.color.set(sg.col); m.material.opacity = sg.dashed ? 0.4 : 0.95;
      });
      marks.forEach((m, i) => {
        const mk = s.marks[i]; m.visible = !!mk; if (!mk) { markTags[i].hide(); return; }
        m.position.copy(B.P(X(mk[0]), ax, 0)); m.scale.setScalar(B.u(3.5)); markTags[i].at(X(mk[0]), ax + 18, 0, mk[1]);
      });
    },
  };
}

/* ---------------- Tower of Hanoi ---------------- */
export function hanoi3d(B) {
  const { THREE, scene } = B;
  const baseM = B.wood([128, 86, 52]), pegM = B.wood([170, 128, 84]);
  const board = new THREE.Mesh(new B.A.RoundedBoxGeometry(1, 1, 1, 3, 0.04), baseM);
  board.castShadow = board.receiveShadow = true;
  const pegs = [0, 1, 2].map(() => { const p = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 24), pegM); p.castShadow = true; scene.add(p); return p; });
  const caps = [0, 1, 2].map(() => { const c = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), pegM); scene.add(c); return c; });
  scene.add(board);
  const disks = new Map(); // size → mesh
  const geoCache = new Map();
  const ringGeo = (ro, ri, t) => {
    const key = `${ro.toFixed(3)}|${ri.toFixed(3)}|${t.toFixed(3)}`;
    if (geoCache.has(key)) return geoCache.get(key);
    const b = Math.min(t * 0.35, (ro - ri) * 0.3), pts = [];
    pts.push(new THREE.Vector2(ri, -t / 2));
    for (let k = 0; k <= 6; k++) { const a = -Math.PI / 2 + (k / 6) * (Math.PI / 2); pts.push(new THREE.Vector2(ro - b + Math.cos(a) * b, -t / 2 + b + Math.sin(a) * b)); }
    for (let k = 0; k <= 6; k++) { const a = (k / 6) * (Math.PI / 2); pts.push(new THREE.Vector2(ro - b + Math.cos(a) * b, t / 2 - b + Math.sin(a) * b)); }
    pts.push(new THREE.Vector2(ri, t / 2)); pts.push(new THREE.Vector2(ri, -t / 2));
    const g = new THREE.LatheGeometry(pts, 64); geoCache.set(key, g); return g;
  };
  const tags = [0, 1, 2].map(() => B.tag('plain faint'));
  const now = new Map(); // where each disk is drawn now (smoothly following where it should be)
  let last = performance.now();
  return {
    update(s) {
      const t1 = performance.now(), a = Math.min(1, ((t1 - last) / 1000) * 14); last = t1;
      const { base, pw, maxW, dh, n, w } = s;
      B.setFloor(base + 14);
      const b0 = B.P(10, base + 7), b1 = B.P(w - 10, base + 7);
      board.position.set((b0.x + b1.x) / 2, b0.y, 0); board.scale.set(b1.x - b0.x, B.u(14), B.u(Math.min(pw * 0.9, maxW + 30)));
      const pegH = dh * (n + 1.6);
      pegs.forEach((p, i) => { const x = pw * i + pw / 2, c = B.P(x, base - pegH / 2); p.position.copy(c); p.scale.set(B.u(5), B.u(pegH), B.u(5)); caps[i].position.copy(B.P(x, base - pegH)); caps[i].scale.setScalar(B.u(5)); tags[i].at(x, base + 26, 0, 'ABC'[i]); });
      const seen = new Set();
      s.pegs.forEach((pg, i) => pg.forEach((d, j) => {
        seen.add(d);
        let m = disks.get(d);
        const dw = 24 + ((maxW - 24) * d) / 7, ro = B.u(dw / 2), ri = B.u(6.5), tt = B.u(dh - 3);
        if (!m) { m = new THREE.Mesh(ringGeo(ro, ri, tt), new THREE.MeshPhysicalMaterial({ color: new THREE.Color(`hsl(${Math.round(40 + (d / 7) * 200)}, 62%, 56%)`), roughness: 0.32, clearcoat: 0.9, clearcoatRoughness: 0.15 })); m.castShadow = m.receiveShadow = true; scene.add(m); disks.set(d, m); }
        else m.geometry = ringGeo(ro, ri, tt);
        m.visible = true;
        const lift = i === s.pick && j === pg.length - 1 ? dh * 1.4 : 0;
        const inHand = s.held && s.held.from === i && j === pg.length - 1 && s.held.moved;
        const want = inHand ? B.P(s.held.x, s.held.y, 0) : B.P(pw * i + pw / 2, base - (j + 0.5) * dh - lift + 1.5, 0);
        const cur = now.get(d);
        if (!cur || inHand) now.set(d, want.clone()); else cur.lerp(want, a);
        m.position.copy(now.get(d));
      }));
      for (const [d, m] of disks) if (!seen.has(d)) { m.visible = false; now.delete(d); }
    },
  };
}

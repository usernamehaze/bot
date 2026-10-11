/* The chemistry labs on a real lab bench: metals dropped into a glass beaker of water (or heated
   in a tube of steam over a Bunsen burner), a beaker of water you drip real reagent bottles into,
   an atom you can turn round, and water molecules in a sealed glass box on a hot plate.
   Each scene only draws: the lab's own model decides what happens (see bench3d.js). */
import { beakerMesh, between, unitRod, standMesh } from './bench3d.js';

const rgbOf = (css) => { const m = String(css).match(/[\d.]+/g) || [255, 255, 255, 1]; return { r: +m[0] / 255, g: +m[1] / 255, b: +m[2] / 255, a: m[3] == null ? 1 : +m[3] }; };
const METAL_LOOK = { K: [0xc9c9cc, 0.3], Na: [0xd2d2d6, 0.28], Li: [0xc4c6ca, 0.3], Ca: [0xd8d6cc, 0.55], Mg: [0xdcdde0, 0.32], Zn: [0xb6c0c8, 0.36], Fe: [0x8e9196, 0.5], Cu: [0xd98b5f, 0.28], Au: [0xffc55a, 0.2] };

/* ---------------- Metals in water ---------------- */
export function metals3d(B) {
  const { THREE, scene } = B;
  const beak = beakerMesh(B, { marks: [[0.2, '100'], [0.4, '200'], [0.6, '300'], [0.8, '400 mL']] });
  const waterM = B.liquid(0xbcd6f5, { opacity: 0.24 });
  const water = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1, 64), waterM);
  const meniscus = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.006, 6, 96), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false }));
  meniscus.rotation.x = Math.PI / 2;
  const metalM = B.metal(0xc9c9cc, 0.3);
  const chunk = new THREE.Mesh(new B.A.RoundedBoxGeometry(1, 1, 1, 2, 0.16), metalM);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.5, 32, 18), metalM);
  chunk.castShadow = ball.castShadow = true;
  const bubbleM = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.38, envMapIntensity: 2.2, clearcoat: 1 });
  const bubbles = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 12, 8), bubbleM, 260);
  bubbles.count = 0;
  const flame = new THREE.Group(), flames = [];
  for (let k = 0; k < 7; k++) { const s = B.glow(0xffffff, 1, 0.8); flames.push(s); flame.add(s); }
  const fire = new THREE.PointLight(0xc38cff, 0, 8, 1.6); flame.add(fire);
  const wet = new THREE.Group(); wet.add(beak, water, meniscus, chunk, ball, bubbles, flame);
  scene.add(wet);

  // the steam rig: a hard-glass tube held in a clamp over a Bunsen burner
  const dry = new THREE.Group(); scene.add(dry);
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 40, 1, true), B.glass({ thickness: 0.05 }));
  tube.rotation.z = Math.PI / 2;
  const stand = standMesh(B);
  const clampM = B.metal(0x9b9ea4, 0.35);
  const clamp = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), clampM);
  const burner = new THREE.Group();
  const bBase = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 0.12, 32), new THREE.MeshStandardMaterial({ color: 0x1d1f24, roughness: 0.5, metalness: 0.5 }));
  const bTube = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.12, 1, 24), B.metal(0xc7a26b, 0.3));
  const bFlameM = new THREE.MeshBasicMaterial({ color: 0x4f86ff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
  const bFlame = new THREE.Mesh(new THREE.ConeGeometry(0.13, 1, 20, 1, true), bFlameM);
  const bCore = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.55, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0x9fd0ff, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }));
  burner.add(bBase, bTube, bFlame, bCore); B.shadowy(bBase); B.shadowy(bTube);
  const stripM = new THREE.MeshStandardMaterial({ color: 0xbdbdc2, roughness: 0.4, metalness: 0.8 });
  const strip = new THREE.Mesh(new B.A.RoundedBoxGeometry(1, 1, 1, 2, 0.2), stripM);
  const hot = B.glow(0xffffff, 1, 0); const hotLight = new THREE.PointLight(0xffffff, 0, 14, 1.4);
  const wisps = []; for (let k = 0; k < 10; k++) { const s = B.glow(0xffffff, 1, 0.12); s.material.blending = THREE.NormalBlending; wisps.push(s); dry.add(s); }
  dry.add(tube, stand, clamp, burner, strip, hot, hotLight);
  const capWater = B.tag('plain faint'), capDrag = B.tag('plain', 'left'), capSteam = B.tag('plain'), capMetal = B.tag('plain');

  let t = 0;
  B.onFrame((dt) => { t += dt; });
  return {
    update(s) {
      const { geo, M, run } = s;
      const sym = M[1];
      wet.visible = !s.steam; dry.visible = s.steam;
      capWater.hide(); capDrag.hide(); capSteam.hide(); capMetal.hide();
      const look = METAL_LOOK[sym] || [0xc9c9cc, 0.3];
      metalM.color.set(look[0]); metalM.roughness = look[1]; metalM.metalness = sym === 'Ca' ? 0.6 : 1;
      if (!s.steam) {
        const { bx, by, bw, bh } = geo, R = B.u(bw);
        B.setFloor(by + bh);
        const bottom = B.P(bx + bw / 2, by + bh);
        beak.position.copy(bottom); beak.scale.set(R, B.u(bh + 10), R);
        const top = B.P(0, by + 20).y, base = bottom.y + B.u(bh + 10) * 0.045;
        water.position.set(bottom.x, (top + base) / 2, 0); water.scale.set(R * 0.94, Math.max(0.01, top - base), R * 0.94);
        // phenolphthalein turns pink where the alkali forms; calcium hydroxide clouds the water
        const pink = s.pink, cloudy = s.cloudy;
        waterM.color.setRGB(0.74 + pink * 0.26 + cloudy * 0.26, 0.84 - pink * 1.2 + cloudy * 0.16, 0.96 - pink * 0.3 + cloudy * 0.04);
        waterM.opacity = 0.24 + pink * 0.75 + cloudy * 0.9; waterM.roughness = 0.04 + cloudy * 0.7;
        meniscus.position.set(bottom.x, top, 0); meniscus.scale.set(R * 0.94, R * 0.94, R * 0.94);
        // the piece of metal: falling, floating (a melted ball for the most reactive), or sunk
        chunk.visible = ball.visible = false; flame.visible = false;
        const showChunk = (px, py, size, melted) => {
          const m = melted ? ball : chunk; m.visible = true;
          m.position.copy(B.P(px, py, 0)); const sz = B.u(size * 1.5); m.scale.set(sz, melted ? sz : sz * 0.7, sz);
          m.rotation.set(0.3, t * (melted ? 0 : 0.4), 0.15);
        };
        if (run) {
          const floats = M[2] < 1, size = Math.max(0, 14 * (1 - run.used)), melted = M[3] >= 0.7 && run.y >= 0;
          const x = bx + run.x * bw, y = run.y < 0 ? by + 20 + run.y * 60 : floats ? by + 20 - size * 0.15 : by + bh - size * 0.9 - 3;
          if (size > 0.5) {
            showChunk(x, y, size, melted);
            if (M[5] && M[3] >= 0.7 && run.y >= 0 && (sym === 'K' || Math.random() < 0.45)) {
              flame.visible = true;
              const c = new THREE.Color(M[5]);
              flames.forEach((f, i) => { f.material.color.copy(c); f.position.copy(B.P(x + (Math.random() - 0.5) * 10, y - 6 - Math.random() * 26 - i * 1.5, (Math.random() - 0.5) * 8)); f.scale.setScalar(B.u(10 + Math.random() * 14)); });
              fire.color.copy(c); fire.intensity = 6 + Math.random() * 6; fire.position.copy(B.P(x, y - 14, 4));
            }
          }
        }
        if (!run || s.held) {
          const [cx0, cy0] = s.held ? [s.held.x, s.held.y] : geo.chunk;
          showChunk(cx0, cy0, 14, false);
          if (!s.held) capDrag.at(cx0 + 24, cy0, 0, `← drag the ${M[0].toLowerCase()} in`);
        }
        // hydrogen bubbles
        const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
        let n = 0;
        for (const b of s.bubbles) {
          if (n >= 260) break;
          if (b.z == null) b.z = Math.random() * 2 - 1;
          const dx = (b.x - 0.5) * bw, zr = Math.sqrt(Math.max(0, (bw * 0.46) ** 2 - dx * dx));
          const p = B.P(bx + b.x * bw, by + 20 + b.y * (bh - 20), b.z * zr * 0.9);
          sc.setScalar(B.u(b.r * 1.1)); mtx.compose(p, q, sc); bubbles.setMatrixAt(n++, mtx);
        }
        bubbles.count = n; bubbles.instanceMatrix.needsUpdate = true;
      } else {
        const { tx, ty, tw, mx } = s.tube;
        B.setFloor(ty + 96);
        const r = B.u(22), a = B.P(tx, ty), b2 = B.P(tx + tw, ty);
        tube.position.set((a.x + b2.x) / 2, a.y, 0); tube.scale.set(r, b2.x - a.x, r);
        const floorY = B.P(0, ty + 96).y;
        stand.userData.set(a.x - 0.2, -1.1, floorY, a.y + 1.2);
        clamp.position.set(a.x + 0.35, a.y, -0.55); clamp.scale.set(0.22, 0.26, 1.2);
        const bp = B.P(mx, ty);
        burner.position.set(bp.x, floorY, 0);
        bBase.position.y = 0.06; bTube.scale.y = Math.max(0.2, (a.y - r - floorY) - 0.55); bTube.position.y = 0.12 + bTube.scale.y / 2;
        const fl = 0.75 + Math.sin(t * 31) * 0.04 + Math.random() * 0.03;
        bFlame.scale.set(1, fl, 1); bFlame.position.y = bTube.position.y + bTube.scale.y / 2 + fl / 2; bFlame.rotation.x = Math.PI;
        bCore.position.y = bTube.position.y + bTube.scale.y / 2 + 0.27; bCore.rotation.x = Math.PI;
        // the metal in the tube, and what it turns into
        const used = run ? run.used : 0, glowing = run ? (M[4] || 0) * (1 - used) : 0;
        strip.position.copy(B.P(mx, ty + 8)); strip.scale.set(B.u(36), B.u(10), B.u(18));
        const done = run && used > 0.5 && M[4] > 0;
        if (done && sym === 'Fe') { stripM.color.set(0x2b2b2b); stripM.metalness = 0.2; stripM.roughness = 0.8; }
        else if (done && sym === 'Zn') { stripM.color.set(glowing > 0.05 ? 0xf0e070 : 0xf2f2f2); stripM.metalness = 0; stripM.roughness = 0.9; }
        else if (done) { stripM.color.set(0xf4f4f2); stripM.metalness = 0; stripM.roughness = 1; }
        else { stripM.color.set(look[0]); stripM.metalness = 0.9; stripM.roughness = look[1]; }
        stripM.emissive = stripM.emissive || new THREE.Color(); stripM.emissive.set(glowing > 0.05 ? (sym === 'Mg' ? 0xffffff : 0xff6a20) : 0x000000); stripM.emissiveIntensity = glowing * (sym === 'Mg' ? 3 : 0.8);
        const mg = glowing > 0.05 && sym === 'Mg';
        hot.position.copy(B.P(mx, ty)); hot.material.opacity = mg ? 0.95 : glowing * 0.3; hot.scale.setScalar(mg ? 4.2 + Math.random() * 0.6 : 1.4);
        hotLight.position.copy(B.P(mx, ty, 10)); hotLight.intensity = mg ? 60 + Math.random() * 20 : glowing * 8; hotLight.color.set(mg ? 0xffffff : 0xff8a40);
        wisps.forEach((wsp, i) => { const f = ((t * 0.35 + i / wisps.length) % 1); wsp.position.copy(B.P(tx + 10 + f * (tw - 20), ty + Math.sin(f * 9 + i) * 7, Math.cos(i * 2.1) * 8)); wsp.scale.setScalar(B.u(16 + f * 12)); wsp.material.opacity = 0.18 * Math.sin(f * Math.PI); });
        capSteam.at(tx + 30, ty - 40, 0, 'steam →'); capMetal.at(mx, ty + 112, 0, 'heated metal');
      }
    },
  };
}

/* ---------------- pH mixer ---------------- */
function reagentBottle(B, name, sub, stripe) {
  const { THREE } = B, g = new THREE.Group();
  const prof = [[0, 0], [0.48, 0], [0.5, 0.04], [0.5, 0.92], [0.42, 1.06], [0.2, 1.14], [0.19, 1.3], [0.205, 1.32], [0.205, 1.36], [0.16, 1.36], [0.16, 1.3], [0.45, 0.92], [0.45, 0.06], [0, 0.06]].map(([x, y]) => new THREE.Vector2(x, y));
  const body = new THREE.Mesh(new THREE.LatheGeometry(prof.slice(0, 10).concat([new THREE.Vector2(0.16, 1.36), new THREE.Vector2(0.16, 1.2), new THREE.Vector2(0.4, 1.02), new THREE.Vector2(0.45, 0.9), new THREE.Vector2(0.45, 0.06), new THREE.Vector2(0, 0.06)]), 48), B.glass({ thickness: 0.1 }));
  const liq = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.44, 0.6, 40), B.liquid(0xe6f0ff, { opacity: 0.22 }));
  liq.position.y = 0.37;
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.2, 24, 16), new THREE.MeshPhysicalMaterial({ color: 0x18181b, roughness: 0.55, clearcoat: 0.4 }));
  bulb.scale.set(1, 1.5, 1); bulb.position.y = 1.62;
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.23, 0.16, 32), new THREE.MeshPhysicalMaterial({ color: 0x18181b, roughness: 0.4 }));
  collar.position.y = 1.38;
  const tex = B.card(512, 256, (c, cw, ch) => {
    c.fillStyle = '#f7f5ef'; c.fillRect(0, 0, cw, ch);
    c.fillStyle = stripe; c.fillRect(0, 0, cw, 46);
    c.fillStyle = '#16171c'; c.font = '800 74px -apple-system, Segoe UI, sans-serif'; c.textAlign = 'center'; c.fillText(name, cw / 2, 140);
    c.font = '600 34px -apple-system, Segoe UI, sans-serif'; c.fillText(sub, cw / 2, 196);
    c.fillStyle = '#16171c'; c.fillRect(0, ch - 20, cw, 6);
  });
  const label = new THREE.Mesh(new THREE.CylinderGeometry(0.505, 0.505, 0.5, 40, 1, true, -1.1, 2.2), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }));
  label.position.y = 0.42;
  g.add(body, liq, bulb, collar, label);
  B.shadowy(g); body.receiveShadow = false;
  const outer = new THREE.Group(); g.position.y = -0.75; outer.add(g); // turns about its middle, as you'd tip it
  return outer;
}
export function ph3d(B) {
  const { THREE, scene } = B;
  const beak = beakerMesh(B, { marks: [[0.192, '50'], [0.384, '100'], [0.576, '150'], [0.768, '200 mL']] });
  const solM = B.liquid(0xffffff, { opacity: 0.5 });
  const sol = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1, 64), solM);
  const bottles = { acid: reagentBottle(B, 'HCl', '0.1 M · acid', '#d9433a'), base: reagentBottle(B, 'NaOH', '0.1 M · base', '#3a63d9') };
  const drop = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), B.glass({ thickness: 0.3, ior: 1.33 }));
  const ripple = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 48), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
  ripple.rotation.x = -Math.PI / 2;
  scene.add(beak, sol, bottles.acid, bottles.base, drop, ripple);
  const read = B.tag('plain big'), capA = B.tag('plain faint'), capB = B.tag('plain faint');
  let rip = 1, lastFill = -1;
  B.onFrame((dt) => { rip = Math.min(1, rip + dt * 1.6); ripple.material.opacity = 0.5 * (1 - rip); ripple.scale.setScalar(0.2 + rip * 1.4); });
  return {
    update(s) {
      const { bx, by, bw, bh } = s.geo, R = B.u(bw);
      B.setFloor(by + bh);
      const bottom = B.P(bx + bw / 2, by + bh);
      beak.position.copy(bottom); beak.scale.set(R, B.u(bh + 10), R);
      const top = B.P(0, by + bh * (1 - s.fill)).y, base = bottom.y + B.u(bh + 10) * 0.045;
      sol.position.set(bottom.x, (top + base) / 2, 0); sol.scale.set(R * 0.94, Math.max(0.01, top - base), R * 0.94);
      const c = rgbOf(s.color), a = Math.min(1, c.a);
      solM.color.setRGB(c.r, c.g, c.b); solM.opacity = 0.16 + a * 0.62;
      if (lastFill >= 0 && s.fill > lastFill + 1e-6) { rip = 0; ripple.position.set(bottom.x, top + 0.005, 0); ripple.scale.setScalar(0.2); }
      lastFill = s.fill;
      for (const k of ['acid', 'base']) {
        const b = s.bottles[k], [x, y] = b.at || b.home, g = bottles[k], sz = B.u(31);
        g.scale.setScalar(sz); g.position.copy(B.P(x, y, 0)); g.rotation.set(0, 0, -b.tilt);
      }
      capA.at(s.bottles.acid.home[0], s.bottles.acid.home[1] + 40, 0, 'acid'); capB.at(s.bottles.base.home[0], s.bottles.base.home[1] + 40, 0, 'base');
      if (s.drop) { drop.visible = true; drop.position.copy(B.P(s.drop.x, s.drop.y, 0)); drop.scale.set(B.u(5), B.u(6.5), B.u(5)); } else drop.visible = false;
      read.at(bx + bw + 40, by + bh * 0.55, 0, `pH ${s.pH.toFixed(2)}`);
    },
  };
}

/* ---------------- Build an atom ---------------- */
export function atom3d(B) {
  const { THREE, scene } = B;
  const pM = new THREE.MeshPhysicalMaterial({ color: 0xe5574e, roughness: 0.32, clearcoat: 0.7, clearcoatRoughness: 0.2 });
  const nM = new THREE.MeshPhysicalMaterial({ color: 0xc3beb2, roughness: 0.38, clearcoat: 0.5, clearcoatRoughness: 0.3 });
  const eM = new THREE.MeshStandardMaterial({ color: 0x8fbaff, emissive: 0x4d86ff, emissiveIntensity: 1.6, roughness: 0.3 });
  const sph = new THREE.SphereGeometry(1, 28, 18);
  const protons = new THREE.InstancedMesh(sph, pM, 24), neutrons = new THREE.InstancedMesh(sph, nM, 34), electrons = new THREE.InstancedMesh(sph, eM, 30);
  protons.castShadow = neutrons.castShadow = true;
  const eGlow = []; for (let k = 0; k < 30; k++) { const s = B.glow(0x6fa0ff, 1, 0.55); eGlow.push(s); scene.add(s); }
  const ringM = new THREE.MeshBasicMaterial({ color: 0x9fb8e8, transparent: true, opacity: 0.22, depthWrite: false });
  const rings = [0, 1, 2, 3].map(() => { const r = new THREE.Mesh(new THREE.TorusGeometry(1, 0.006, 6, 160), ringM); scene.add(r); return r; });
  const TILT = [[1.25, 0.2], [1.05, -0.65], [1.4, 1.0], [0.95, 2.1]];
  const core = B.glow(0xffb48a, 1, 0.35);
  const fill = new THREE.PointLight(0xffd2b8, 6, 10, 1.5);
  const tray = { p: new THREE.Mesh(sph, pM), n: new THREE.Mesh(sph, nM), e: new THREE.Mesh(sph, eM) };
  const held = { p: new THREE.Mesh(sph, pM), n: new THREE.Mesh(sph, nM), e: new THREE.Mesh(sph, eM) };
  scene.add(protons, neutrons, electrons, core, fill, ...Object.values(tray), ...Object.values(held));
  const tags = { p: B.tag('plain', 'left'), n: B.tag('plain', 'left'), e: B.tag('plain', 'left') };
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), v = new THREE.Vector3();
  let t = 0; B.onFrame((dt) => { t += dt; });
  return {
    update(s) {
      const { cx, cy, R, Z, N, E, spin, pr } = s, c = B.P(cx, cy, 0), total = Z + N;
      // the nucleus: protons and neutrons packed into a ball, jiggling a little
      let ip = 0, iN = 0;
      for (let k = 0; k < total; k++) {
        const rr = pr * 1.12 * Math.cbrt(k), zz = 1 - 2 * ((k * 0.618034 + 0.5 / Math.max(1, total)) % 1), ang = k * 2.39996, rxy = Math.sqrt(Math.max(0, 1 - zz * zz));
        v.set(Math.cos(ang) * rxy * rr + Math.sin(t * 3 + k) * 0.4, Math.sin(ang) * rxy * rr + Math.cos(t * 2.6 + k * 1.7) * 0.4, zz * rr);
        const p = B.P(cx + v.x, cy + v.y, v.z);
        sc.setScalar(B.u(pr)); mtx.compose(p, q, sc);
        const isP = Math.floor(((k + 1) * Z) / Math.max(1, total)) > Math.floor((k * Z) / Math.max(1, total));
        if (isP) protons.setMatrixAt(ip++, mtx); else neutrons.setMatrixAt(iN++, mtx);
      }
      protons.count = ip; neutrons.count = iN; protons.instanceMatrix.needsUpdate = neutrons.instanceMatrix.needsUpdate = true;
      core.position.copy(c); core.scale.setScalar(B.u(pr * 6 + Math.cbrt(Math.max(1, total)) * pr * 2)); core.material.opacity = total ? 0.32 : 0;
      fill.position.copy(c).add(new THREE.Vector3(0, 0, B.u(R)));
      // the electron shells, each in its own plane, the electrons going round
      const shells = s.shells;
      let ie = 0;
      rings.forEach((ring, i) => {
        if (i >= shells.length) { ring.visible = false; return; }
        const r = B.u(R * (0.32 + 0.2 * i));
        ring.visible = true; ring.position.copy(c); ring.scale.setScalar(r); ring.rotation.set(TILT[i][0], TILT[i][1], 0);
        for (let k = 0; k < shells[i]; k++) {
          const a = spin * (1 - i * 0.18) + (k / shells[i]) * Math.PI * 2;
          v.set(Math.cos(a) * r, Math.sin(a) * r, 0).applyEuler(ring.rotation).add(c);
          sc.setScalar(B.u(5)); mtx.compose(v, q, sc); electrons.setMatrixAt(ie, mtx);
          eGlow[ie].visible = true; eGlow[ie].position.copy(v); eGlow[ie].scale.setScalar(B.u(26));
          ie++;
        }
      });
      for (let k = ie; k < eGlow.length; k++) eGlow[k].visible = false;
      electrons.count = ie; electrons.instanceMatrix.needsUpdate = true;
      // the tray, and what you're holding
      for (const tr of s.tray) {
        tray[tr.k].position.copy(B.P(tr.x, tr.y, 0)); tray[tr.k].scale.setScalar(B.u(10));
        tags[tr.k].at(tr.x + 16, tr.y, 0, { p: 'proton', n: 'neutron', e: 'electron' }[tr.k]);
      }
      for (const k of ['p', 'n', 'e']) held[k].visible = !!(s.held && s.held.k === k);
      if (s.held) { const m = held[s.held.k]; m.position.copy(B.P(s.held.x, s.held.y, 0)); m.scale.setScalar(B.u(s.held.k === 'e' ? 6 : pr + 1)); }
    },
  };
}

/* ---------------- Ice to steam: the molecules ---------------- */
export function ice3d(B, N = 42) {
  const { THREE, scene } = B;
  const box = new THREE.Mesh(new B.A.RoundedBoxGeometry(1, 1, 1, 3, 0.03), B.glass({ thickness: 0.06, roughness: 0.05 }));
  const oM = new THREE.MeshPhysicalMaterial({ color: 0xe0433a, roughness: 0.3, clearcoat: 0.6 });
  const hM = new THREE.MeshPhysicalMaterial({ color: 0xf4f4f6, roughness: 0.3, clearcoat: 0.6 });
  const sph = new THREE.SphereGeometry(1, 22, 14);
  const O = new THREE.InstancedMesh(sph, oM, N), H = new THREE.InstancedMesh(sph, hM, N * 2);
  O.castShadow = H.castShadow = true;
  // the hot plate under the box
  const plate = new THREE.Mesh(new B.A.RoundedBoxGeometry(1, 1, 1, 2, 0.05), new THREE.MeshStandardMaterial({ color: 0xd9d9dc, roughness: 0.45, metalness: 0.6 }));
  const coilM = new THREE.MeshStandardMaterial({ color: 0x2b2b30, roughness: 0.6, emissive: 0xff3a10, emissiveIntensity: 0 });
  const coil = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 48), coilM);
  const heatLight = new THREE.PointLight(0xff5a20, 0, 6, 1.6);
  const knob = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 24), new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.5 }));
  knob.rotation.x = Math.PI / 2;
  scene.add(box, O, H, plate, coil, heatLight, knob);
  B.shadowy(plate);
  const z = new Float32Array(N).map(() => Math.random() - 0.5), vz = new Float32Array(N).map(() => (Math.random() - 0.5) * 0.8);
  const rot = Array.from({ length: N }, () => new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6));
  const spinV = Array.from({ length: N }, () => new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5));
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3(), off = new THREE.Vector3();
  let last = performance.now();
  return {
    update(s) {
      const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000); last = now;
      const { bx, by, bw, bh } = s.box, depth = Math.min(bw, bh) * 0.7;
      B.setFloor(by + bh + 18);
      box.position.copy(B.P(bx + bw / 2, by + bh / 2, 0)); box.scale.set(B.u(bw), B.u(bh), B.u(depth));
      plate.position.copy(B.P(bx + bw / 2, by + bh + 9, 0)); plate.scale.set(B.u(bw * 0.9), B.u(16), B.u(depth * 1.05));
      coil.position.copy(B.P(bx + bw / 2, by + bh + 0.5, 0)); coil.scale.set(B.u(Math.min(bw, depth) * 0.32), B.u(1.2), B.u(Math.min(bw, depth) * 0.32));
      knob.position.copy(B.P(bx + bw * 0.88, by + bh + 9, depth * 0.53)); knob.scale.set(B.u(5), B.u(3), B.u(5));
      const heat = s.heating > 0 ? 1 : 0;
      coilM.emissive.set(s.heating < 0 ? 0x5ab4ff : 0xff3a10);
      coilM.emissiveIntensity += ((s.heating ? 1.6 : 0) - coilM.emissiveIntensity) * 0.08;
      heatLight.position.copy(B.P(bx + bw / 2, by + bh - 6, 0)); heatLight.intensity = coilM.emissiveIntensity * (heat ? 5 : 2); heatLight.color.set(s.heating < 0 ? 0x5ab4ff : 0xff5a20);
      const r = Math.max(4, Math.min(bw, bh) / 26), kT = Math.sqrt((s.T + 273) / 273), cols = 7;
      s.mol.forEach((m, i) => {
        // depth: a two-layer lattice for ice, a jostle for water, flying for steam
        if (m.solid) { z[i] += ((((i % cols) + Math.floor(i / cols)) % 2 ? -0.16 : 0.16) - z[i]) * 0.2; rot[i].set((i % 2) * 1.2, (i % 3) * 0.9, 0.3); }
        else if (m.gas) { z[i] += vz[i] * dt * kT; if (Math.abs(z[i]) > 0.42) { vz[i] = -vz[i]; z[i] = Math.sign(z[i]) * 0.42; } rot[i].x += spinV[i].x * dt * 6; rot[i].y += spinV[i].y * dt * 6; }
        else { z[i] = Math.max(-0.4, Math.min(0.4, z[i] + (Math.random() - 0.5) * 0.04 * kT)); rot[i].x += spinV[i].x * dt * 2; rot[i].z += spinV[i].z * dt * 2; }
        p.copy(B.P(bx + m.x * bw, by + m.y * bh, z[i] * depth));
        q.setFromEuler(rot[i]);
        sc.setScalar(B.u(r)); mtx.compose(p, q, sc); O.setMatrixAt(i, mtx);
        for (const sgn of [-1, 1]) {
          off.set(Math.sin(0.912 * sgn) * 0.95, -Math.cos(0.912) * 0.95, 0).multiplyScalar(B.u(r)).applyQuaternion(q);
          sc.setScalar(B.u(r * 0.62)); mtx.compose(off.add(p), q, sc); H.setMatrixAt(i * 2 + (sgn > 0 ? 1 : 0), mtx);
        }
      });
      O.instanceMatrix.needsUpdate = H.instanceMatrix.needsUpdate = true;
    },
  };
}

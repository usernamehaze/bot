/* The world atlas as a globe: the same Earth maps as the 3D solar system (labs/CREDITS.md)
   with every country's border drawn on it, a thin glow of air at the edge and the real stars
   behind. Drag to spin it, pinch or scroll to zoom, tap a country. The country you pick is
   lit up in gold, and places you search get a pin. The atlas (atlas.js) does the looking-up. */
import { stage3d } from './three-kit.js';
import { planetLook } from './planet-look.js';

const D2R = Math.PI / 180;
// three.js puts longitude −180° at the left edge of the map
export const toVec = (THREE, lat, lon, r = 1) => { const th = (90 - lat) * D2R, ph = (lon + 180) * D2R; return new THREE.Vector3(-Math.cos(ph) * Math.sin(th) * r, Math.cos(th) * r, Math.sin(ph) * Math.sin(th) * r); };
const toLatLon = (v) => { const n = v.clone().normalize(); let lon = Math.atan2(n.z, -n.x) / D2R - 180; if (lon < -180) lon += 360; return [90 - Math.acos(Math.max(-1, Math.min(1, n.y))) / D2R, lon]; };

export async function globe(stage, { world, onTap }) {
  const S = await stage3d(stage, { background: 0x020306, fov: 40, near: 0.01, far: 5000 });
  const { THREE, scene, camera, controls, renderer, canvas } = S;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
  const look = planetLook(THREE, S);
  S.onFrame((dt) => look.tick(dt));
  look.sky().then((pts) => { if (pts) scene.add(pts); }).catch(() => {});
  // light that follows the camera, so the side you look at is always in daylight
  scene.add(new THREE.HemisphereLight(0xdfe9ff, 0x0b0d14, 0.55));
  const sun = new THREE.DirectionalLight(0xffffff, 2.1); scene.add(sun);
  S.onFrame(() => { sun.position.copy(camera.position).add(new THREE.Vector3(2.6, 2.2, 0).applyQuaternion(camera.quaternion)); });

  const loader = new THREE.TextureLoader(), aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const earthM = new THREE.MeshStandardMaterial({ color: 0x3f6f9e, roughness: 0.85, metalness: 0 });
  const earth = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 64), earthM);
  scene.add(earth);
  loader.load(new URL('./tex/earth-day.webp', import.meta.url).href, (t) => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso; earthM.map = t; earthM.color.set(0xffffff); earthM.needsUpdate = true; });
  loader.load(new URL('./tex/earth-ocean.webp', import.meta.url).href, (t) => { // the sea shines, the land doesn't
    t.anisotropy = aniso;
    earthM.roughnessMap = t; earthM.roughness = 1; earthM.metalnessMap = null;
    earthM.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <roughnessmap_fragment>', 'float roughnessFactor = roughness;\n#ifdef USE_ROUGHNESSMAP\n  roughnessFactor *= mix(0.92, 0.58, texture2D(roughnessMap, vRoughnessMapUv).g);\n#endif'); };
    earthM.needsUpdate = true;
  });
  // the glow of the air at Earth's edge
  const air = new THREE.Mesh(new THREE.SphereGeometry(1.045, 64, 48), new THREE.ShaderMaterial({
    side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: 'varying vec3 vN; varying vec3 vW; void main() { vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: 'varying vec3 vN; varying vec3 vW; void main() { vec3 V = normalize(cameraPosition - vW); float f = pow(1.0 - abs(dot(normalize(vN), V)), 2.2); gl_FragColor = vec4(vec3(0.35, 0.6, 1.0) * f * 1.15, f); }',
  }));
  air.raycast = () => {}; scene.add(air);

  // borders, and the country you picked, painted onto a see-through layer just above the ground
  const big = Math.min(screen.width, screen.height) > 700 && renderer.capabilities.maxTextureSize >= 4096;
  const bc = document.createElement('canvas'); bc.width = big ? 4096 : 2048; bc.height = big ? 2048 : 1024;
  const lw = big ? 1 : 0.6;
  const bctx = bc.getContext('2d');
  const borderT = new THREE.CanvasTexture(bc); borderT.colorSpace = THREE.SRGBColorSpace; borderT.anisotropy = aniso;
  const over = new THREE.Mesh(new THREE.SphereGeometry(1.0015, 128, 64), new THREE.MeshBasicMaterial({ map: borderT, transparent: true, depthWrite: false }));
  over.raycast = () => {}; scene.add(over);
  const X = (lon) => ((lon + 180) / 360) * bc.width, Y = (lat) => ((90 - lat) / 180) * bc.height;
  function trace(rg, shift) {
    let prev = null;
    rg.forEach(([lo, la], i) => { if (prev != null) { while (lo - prev > 180) lo -= 360; while (prev - lo > 180) lo += 360; } prev = lo; const x = X(lo + shift), y = Y(la); if (i) bctx.lineTo(x, y); else bctx.moveTo(x, y); });
    bctx.closePath();
  }
  let picked = null;
  function paint() {
    bctx.clearRect(0, 0, bc.width, bc.height);
    bctx.lineJoin = 'round';
    for (const c of world) {
      const sel = picked && +c.id === +picked;
      bctx.beginPath();
      for (const shift of [-360, 0, 360]) c.polys.forEach((poly) => poly.forEach((rg) => trace(rg, shift)));
      if (sel) { bctx.fillStyle = 'rgba(255,207,90,.55)'; bctx.fill('evenodd'); }
      bctx.strokeStyle = sel ? 'rgba(255,224,140,1)' : 'rgba(255,255,255,.55)'; bctx.lineWidth = (sel ? 4 : 1.6) * lw; bctx.stroke();
    }
    borderT.needsUpdate = true;
  }
  paint();

  // the camera: spin with a finger, pinch to zoom (slower spinning when close)
  camera.position.set(0, 0.6, 3.1);
  controls.enablePan = false; controls.minDistance = 1.12; controls.maxDistance = 6; controls.rotateSpeed = 0.5;
  S.onFrame(() => { const d = camera.position.length(); controls.rotateSpeed = Math.max(0.06, Math.min(0.55, (d - 1) * 0.28)); controls.zoomSpeed = Math.max(0.35, Math.min(1.1, (d - 1) * 0.6)); });

  // a tap (not a drag) on Earth: which place is that?
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let down = null;
  canvas.addEventListener('pointerdown', (e) => { if (e.isPrimary) down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  canvas.addEventListener('pointerup', (e) => {
    if (!down || !e.isPrimary || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 12 || performance.now() - down.t > 700) { down = null; return; }
    down = null;
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObject(earth, false)[0];
    if (hit) { const [lat, lon] = toLatLon(hit.point); onTap(lat, lon); }
  });

  // where a place shows on the screen (the tests use it)
  canvas._toScreen = (lat, lon) => { camera.updateMatrixWorld(); const v = toVec(THREE, lat, lon).project(camera), r = canvas.getBoundingClientRect(); return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height }; };
  // a pin for a place
  const pin = new THREE.Group();
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.0025, 0.0025, 0.06, 8), new THREE.MeshStandardMaterial({ color: 0xf2f2f4, roughness: 0.4 }));
  stick.position.y = 0.03;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.011, 16, 12), new THREE.MeshStandardMaterial({ color: 0xff5a52, roughness: 0.35, emissive: 0x5a0a06 }));
  head.position.y = 0.064;
  pin.add(stick, head); pin.visible = false; scene.add(pin);
  // (labels on the far side of Earth hide)
  const facing = (o, k) => camera.position.clone().normalize().dot(o.position.clone().normalize()) > k;
  const pinTag = S.label(pin, '', { className: 'small', show: () => facing(pin, 0.2) });
  const nameObj = new THREE.Object3D(); scene.add(nameObj); nameObj.visible = false;
  const nameTag = S.label(nameObj, '', { show: () => facing(nameObj, 0.25) });

  function aim(lat, lon, dist = 2.2) { S.flyTo(new THREE.Vector3(0, 0, 0), dist, { dir: toVec(THREE, lat, lon), dur: 1.1 }); }
  return {
    select(c) { picked = c ? c.n3 : null; paint(); if (c && c.ll) { nameObj.position.copy(toVec(THREE, c.ll[0], c.ll[1], 1.01)); nameObj.visible = true; nameTag.textContent = c.n; } else nameObj.visible = false; },
    show(c) { if (c && c.ll) aim(c.ll[0], c.ll[1], c.area > 3e6 ? 2.6 : c.area > 5e5 ? 2.05 : c.area > 5e4 ? 1.7 : 1.45); },
    pin(p) {
      if (!p) { pin.visible = false; return; }
      pin.position.copy(toVec(THREE, p.at[0], p.at[1], 1)); pin.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), pin.position.clone().normalize());
      pin.visible = true; pinTag.textContent = p.name; aim(p.at[0], p.at[1], 1.6);
    },
    zoom(f) { const d = camera.position.length(); S.flyTo(new THREE.Vector3(0, 0, 0), Math.max(1.12, Math.min(6, d / f)), { dur: 0.4 }); },
    whole() { S.flyTo(new THREE.Vector3(0, 0, 0), 3.1, { dur: 0.9 }); },
    destroy() { borderT.dispose(); S.destroy(); },
  };
}

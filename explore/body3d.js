/* The human body in 3D — real anatomy, not a drawing.
   Models: Z-Anatomy (CC BY-SA 4.0), based on BodyParts3D © The Database Center for Life
   Science (made from scans of a real adult male), as prepared by the Svitylo 3D Anatomy
   Atlas data release 1.1.0. Names are the official English (and Latin) terms from
   Terminologia Anatomica. See explore/body/ATTRIBUTION.md and LICENSES.md.

   Each system (skeleton, organs, …) is a few compressed files that load only when it is
   switched on. Every vertex carries the number of the part it belongs to, so a tap names
   the exact bone, muscle or organ. */
import * as THREE from './three.module.min.js';
import { GLTFLoader } from './GLTFLoader.js';
import { MeshoptDecoder } from './meshopt_decoder.module.js';

export const SYSTEMS = [
  { id: 'regions', name: 'Skin', on: true },
  { id: 'skeletal', name: 'Skeleton', on: true },
  { id: 'visceral', name: 'Organs', on: true },
  { id: 'cardiovascular', name: 'Heart & blood vessels' },
  { id: 'nervous', name: 'Brain & nerves' },
  { id: 'muscular', name: 'Muscles' },
  { id: 'lymphoid', name: 'Lymph system' },
];
const SYS_COLOR = { regions: '#e2b095', skeletal: '#ebe3d1', visceral: '#c98270', cardiovascular: '#c8322f', nervous: '#f0cf5a', muscular: '#b5473e', lymphoid: '#97bf5a' };

// Colours students expect from an anatomy book, by what a part is.
function colourFor(sys, id) {
  const has = (re) => re.test(id);
  if (sys === 'skeletal') return has(/cartilag|disc/) ? '#a9c9cf' : has(/tooth|teeth|incisor|canine|premolar|molar/) ? '#f6f3ea' : SYS_COLOR.skeletal;
  if (sys === 'muscular') return has(/tendon|aponeuros|retinacul|sheath|bursa/) ? '#e8dcc8' : SYS_COLOR.muscular;
  if (sys === 'cardiovascular') {
    if (has(/pulmonary_trunk|pulmonary_arter|pulmonary_valve/)) return '#3c62b8';
    if (has(/pulmonary_vein/)) return '#c8322f';
    if (has(/vein|vena|venous|sinus|vv\b/)) return '#3c62b8';
    if (has(/heart|atri|ventric|valve|myocard|cusp|papillary|chordae|septum/)) return '#b02e2a';
    return '#c8322f';
  }
  if (sys === 'visceral') {
    const rules = [[/liver|hepat/, '#8a2b25'], [/gallbladder|bile|cystic_duct/, '#4f7d3a'], [/stomach|gastr/, '#d8897a'], [/colon|caecum|cecum|rectum|appendix|anal/, '#c7866c'],
      [/intestin|duoden|jejun|ile/, '#e4a68b'], [/lung|pulmo|pleura/, '#e8a2a7'], [/trache|bronch|laryn|epiglott|thyroid_cartilage|cricoid/, '#e6d8c4'],
      [/kidney|renal/, '#8b2f2f'], [/ureter|bladder|urethr/, '#e0bd86'], [/spleen/, '#6c293b'], [/pancrea/, '#e8c07c'], [/oesophag|esophag|pharyn/, '#d4907f'],
      [/thyroid|parathyroid|adrenal|suprarenal|thymus|pituitar/, '#b55848'], [/tongue/, '#cd7676'], [/diaphragm/, '#b5473e'], [/testis|prostat|penis|seminal|vas_def|epididym|scrot/, '#c8908f'],
      [/peritone|omentum|mesenter/, '#e9c9a8']];
    for (const [re, c] of rules) if (re.test(id)) return c;
    return SYS_COLOR.visceral;
  }
  if (sys === 'nervous') {
    if (has(/brain|cerebr|cerebell|pons|medulla|midbrain|thalam|hypothal|hippocamp|gyrus|lobe|cortex|corpus_callos|ventricle|nucleus/)) return '#e7c3bd';
    if (has(/spinal_cord|cauda|conus/)) return '#f1e2ae';
    if (has(/eye|retina|cornea|lens|iris|sclera|choroid/)) return '#f2f0ec';
    if (has(/ear|cochlea|vestibul|semicircular|tympanic|malleus|incus|stapes/)) return '#e8d6b6';
    return SYS_COLOR.nervous;
  }
  return SYS_COLOR[sys] || '#c8bfb6';
}

export function createBody(ctx) {
  // ctx: { scene, camera, controls, setLoading(text|null), showPart(info|null), invalidate(), base } — base = folder url of explore/
  const redraw = () => ctx.invalidate && ctx.invalidate();
  const group = new THREE.Group();
  group.visible = false;
  ctx.scene.add(group);
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  let index = null;
  const systems = new Map(); // id -> { on, loading: Promise, meshes: [] }
  const hidden = new Set(); // structure indexes the student hid
  let selected = -1, highlight = null;
  const label = document.createElement('span');
  label.className = 'x3d-label on';
  label.hidden = true;

  async function loadIndex() {
    if (!index) {
      index = await (await fetch(ctx.base + 'body/index.json')).json();
      index.lower = index.s.map((r) => r[1].toLowerCase());
      // the body-wide sheet of fascia hides every muscle under it, so it's left out
      index.chunks = index.chunks.filter((c) => !/fasciae/.test(c.file));
      const shown = new Set();
      index.chunks.forEach((c) => { for (let m = c.meshStart; m < c.meshStart + c.meshCount; m++) if (index.mesh[m] >= 0) shown.add(index.mesh[m]); });
      index.hasMesh = shown;
      // what each group (heart, brain, lungs…) is made of
      index.kids = index.s.map(() => []);
      index.s.forEach((r, i) => { if (r[3] >= 0) index.kids[r[3]].push(i); });
      index.size = index.s.map(() => 0);
      const count = (i) => { let n = index.hasMesh.has(i) ? 1 : 0; for (const k of index.kids[i]) n += count(k); index.size[i] = n; return n; };
      index.s.forEach((r, i) => { if (r[3] < 0) count(i); });
    }
    return index;
  }
  const sysOf = (si) => index.systems[index.s[si][4]];
  // a part, or every part of a group (the whole heart, the whole femur…)
  function partsOf(si) {
    const out = new Set(), stack = [si];
    while (stack.length) { const i = stack.pop(); if (index.hasMesh.has(i)) out.add(i); stack.push(...index.kids[i]); }
    return out;
  }
  const nameOf = (si) => { const r = index.s[si]; return r[1] + (r[5] === 'l' ? ' (left)' : r[5] === 'r' ? ' (right)' : ''); };
  function pathOf(si) { // the groups it belongs to, nearest last: [{ index, name }]
    const out = [];
    let p = index.s[si][3];
    while (p >= 0 && out.length < 3) { if (index.s[p][3] >= 0) out.unshift({ index: p, name: index.s[p][1] }); p = index.s[p][3]; }
    return out.slice(-2);
  }

  async function loadSystem(id) {
    await loadIndex();
    let sys = systems.get(id);
    if (!sys) { sys = { on: false, meshes: [], loading: null }; systems.set(id, sys); }
    if (!sys.loading) {
      const chunks = index.chunks.filter((c) => index.systems[c.sys] === id);
      const name = SYSTEMS.find((s) => s.id === id).name;
      ctx.setLoading(`Loading ${name.toLowerCase()}…`);
      sys.loading = Promise.all(chunks.map(async (c) => {
        const gltf = await loader.loadAsync(ctx.base + 'body/' + c.file);
        gltf.scene.traverse((o) => {
          if (!o.isMesh) return;
          const g = o.geometry, ids = g.attributes._id, n = ids.count;
          // colour every vertex by what its part is
          const col = new Float32Array(n * 3), tmp = new THREE.Color(), cache = new Map();
          for (let i = 0; i < n; i++) {
            const mi = ids.getX(i);
            let hex = cache.get(mi);
            if (!hex) { const si = index.mesh[mi]; hex = colourFor(id, si >= 0 ? index.s[si][0] : ''); cache.set(mi, hex); }
            tmp.set(hex).convertSRGBToLinear();
            col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
          }
          g.setAttribute('color', new THREE.BufferAttribute(col, 3));
          g.userData.fullIndex = g.index.array.slice();
          const skin = id === 'regions';
          o.material = new THREE.MeshPhysicalMaterial({
            vertexColors: true, roughness: skin ? 0.6 : id === 'skeletal' ? 0.55 : 0.42, clearcoat: skin ? 0 : 0.35, clearcoatRoughness: 0.4,
            transparent: skin, opacity: skin ? 0.16 : 1, depthWrite: !skin, side: skin ? THREE.FrontSide : THREE.DoubleSide,
          });
          o.userData.system = id;
          o.userData.pickable = !skin;
          o.renderOrder = skin ? 2 : 0;
          sys.meshes.push(o);
        });
        group.add(gltf.scene);
        gltf.scene.visible = sys.on;
        sys.scenes = (sys.scenes || []).concat(gltf.scene);
      })).then(() => { applyHidden(); ctx.setLoading(null); redraw(); }).catch((e) => { sys.loading = null; ctx.setLoading('Couldn’t load it — check your internet and tap again.'); throw e; });
    }
    return sys.loading;
  }

  async function setSystem(id, on) {
    let sys = systems.get(id);
    if (!sys) { sys = { on, meshes: [], loading: null }; systems.set(id, sys); }
    sys.on = on;
    (sys.scenes || []).forEach((s) => { s.visible = on; });
    redraw();
    if (on) { await loadSystem(id); (sys.scenes || []).forEach((s) => { s.visible = sys.on; }); redraw(); }
    if (!on && selected >= 0 && sysOf(selected) === id) select(-1);
  }
  const isOn = (id) => isOnDefault(id);

  // hide parts by rebuilding the triangle list without them
  function applyHidden() {
    redraw();
    systems.forEach((sys) => sys.meshes.forEach((o) => {
      const g = o.geometry, full = g.userData.fullIndex, ids = g.attributes._id;
      if (!hidden.size) { if (g.index.array.length !== full.length) { g.setIndex(new THREE.BufferAttribute(full.slice(), 1)); } return; }
      const keep = [];
      for (let t = 0; t < full.length; t += 3) {
        const si = index.mesh[ids.getX(full[t])];
        if (!hidden.has(si)) keep.push(full[t], full[t + 1], full[t + 2]);
      }
      g.setIndex(new THREE.BufferAttribute(new full.constructor(keep), 1));
    }));
  }

  // the picked part, drawn again on top in a bright outline colour
  function makeHighlight(si) {
    if (highlight) { group.remove(highlight); highlight.geometry.dispose(); highlight = null; }
    if (si < 0) return null;
    const want = partsOf(si);
    const pos = [], v = new THREE.Vector3();
    systems.forEach((sys) => sys.meshes.forEach((o) => {
      if (!o.visible || !o.parent.visible) return;
      const g = o.geometry, ids = g.attributes._id, p = g.attributes.position, ix = g.userData.fullIndex;
      o.updateWorldMatrix(true, false);
      for (let t = 0; t < ix.length; t += 3) {
        if (!want.has(index.mesh[ids.getX(ix[t])])) continue;
        for (let k = 0; k < 3; k++) { v.fromBufferAttribute(p, ix[t + k]).applyMatrix4(o.matrixWorld); pos.push(v.x, v.y, v.z); }
      }
    }));
    if (!pos.length) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    highlight = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: '#ffd84a', emissive: '#ffb800', emissiveIntensity: 0.55, roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide }));
    highlight.renderOrder = 5;
    group.add(highlight);
    return geo.boundingSphere;
  }

  // with a part picked, everything else turns see-through so the part shows, even behind the ribs
  function ghost(on) {
    systems.forEach((sys) => sys.meshes.forEach((o) => {
      const m = o.material;
      if (!m.userData.base) m.userData.base = { opacity: m.opacity, transparent: m.transparent, depthWrite: m.depthWrite };
      const b = m.userData.base;
      const t = on ? true : b.transparent;
      m.opacity = on ? Math.min(b.opacity, o.userData.system === 'regions' ? 0.06 : 0.16) : b.opacity;
      m.depthWrite = on ? false : b.depthWrite;
      if (m.transparent !== t) { m.transparent = t; m.needsUpdate = true; }
    }));
  }
  function select(si) {
    selected = si;
    redraw();
    const sphere = makeHighlight(si);
    ghost(si >= 0 && !!sphere);
    label.hidden = si < 0 || !sphere;
    if (si < 0) { ctx.showPart(null); return; }
    label.textContent = nameOf(si);
    label.userData = sphere ? sphere.center.clone() : null;
    const sysId = sysOf(si);
    ctx.showPart({
      index: si, name: nameOf(si), latin: index.s[si][2], path: pathOf(si),
      system: SYSTEMS.find((s) => s.id === sysId).name, systemId: sysId, color: colourFor(sysId, index.s[si][0]),
      focus: sphere ? { target: sphere.center.clone(), dist: Math.max(0.35, sphere.radius * 4.2) } : null,
    });
  }

  function isOnDefault(id) { return systems.has(id) ? systems.get(id).on : !!SYSTEMS.find((s) => s.id === id).on; }
  function pick(ray) {
    const meshes = [];
    systems.forEach((sys) => { if (sys.on) sys.meshes.forEach((o) => { if (o.userData.pickable) meshes.push(o); }); });
    if (highlight) meshes.unshift(highlight);
    const hits = ray.intersectObjects(meshes, false);
    for (const h of hits) {
      if (h.object === highlight) return selected; // tapping the picked part (or group) again keeps it
      const ids = h.object.geometry.attributes._id;
      const si = index.mesh[ids.getX(h.face.a)];
      if (si >= 0 && !hidden.has(si)) return selected >= 0 && partsOf(selected).has(si) && !index.hasMesh.has(selected) ? selected : si;
    }
    return -1;
  }

  function search(q) {
    if (!index || !q || q.length < 2) return [];
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const out = [], seen = new Set();
    for (let i = 0; i < index.s.length && out.length < 40; i++) {
      if (!index.size[i] || (!index.hasMesh.has(i) && index.size[i] > 400) || index.s[i][3] < 0) continue; // parts you can see, and organs made of parts
      const n = index.lower[i];
      if (!words.every((w) => n.includes(w))) continue;
      const key = n + index.s[i][4];
      if (seen.has(key)) continue; // left and right: one result
      seen.add(key);
      out.push({ index: i, name: index.s[i][1], system: SYSTEMS.find((s) => s.id === index.systems[index.s[i][4]]).name, starts: n.startsWith(words[0]), exact: n === words.join(' '), whole: !index.hasMesh.has(i) });
    }
    return out.sort((a, b) => (b.exact - a.exact) || (b.starts - a.starts) || (b.whole - a.whole) || a.name.length - b.name.length).slice(0, 8);
  }
  async function goTo(si) {
    const sysId = sysOf(si);
    if (!isOn(sysId)) { await setSystem(sysId, true); ctx.onSystems && ctx.onSystems(); }
    else await loadSystem(sysId);
    hidden.delete(si); applyHidden();
    select(si);
  }

  function hide(si) { partsOf(si).forEach((i) => hidden.add(i)); applyHidden(); select(-1); }
  function showAll() { hidden.clear(); applyHidden(); }

  async function enter() {
    group.visible = true;
    redraw();
    await loadIndex();
    await Promise.all(SYSTEMS.filter((s) => (systems.has(s.id) ? systems.get(s.id).on : s.on)).map((s) => setSystem(s.id, true)));
  }
  function leave() { group.visible = false; label.hidden = true; }
  function placeLabel(camera, w, h) {
    if (label.hidden || !label.userData) return;
    const p = label.userData.clone().project(camera);
    label.style.transform = `translate(${((p.x + 1) / 2) * w}px, ${((1 - p.y) / 2) * h}px)`;
  }
  return { group, label, enter, leave, setSystem, isOn, pick, select, search, goTo, hide, showAll, placeLabel, get hiddenCount() { return hidden.size; }, get selected() { return selected; }, camera: new THREE.Vector3(0.55, 1.35, 2.6), target: new THREE.Vector3(0, 0.95, 0.03), fit: 0.95 };
}

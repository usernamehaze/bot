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
import { mergeGeometries } from './BufferGeometryUtils.js';

// The data comes in layers (one per folder in body/); students see the 10 body systems
// they learn in school. A system is whole layers, or groups inside the organs layer.
const LAYERS = { regions: 'skin', skeletal: 'bones', muscular: 'muscles', visceral: 'organs', cardiovascular: 'heart and blood vessels', nervous: 'brain and nerves', lymphoid: 'lymph organs' };
export const SYSTEMS = [
  { id: 'circulatory', name: 'Circulatory (Cardiovascular)', parts: [['cardiovascular']] },
  { id: 'respiratory', name: 'Respiratory', on: true, parts: [['visceral', 'respiratory_system'], ['visceral', 'thoracic_cavity']] },
  { id: 'nervous', name: 'Nervous', parts: [['nervous']] },
  { id: 'digestive', name: 'Digestive', on: true, parts: [['visceral', 'digestive_system'], ['visceral', 'abdominopelvic_cavity']] },
  { id: 'musculoskeletal', name: 'Musculoskeletal', on: true, parts: [['skeletal'], ['muscular']] },
  { id: 'endocrine', name: 'Endocrine', on: true, parts: [['visceral', 'endocrine_glands']] },
  { id: 'integumentary', name: 'Integumentary (Skin)', on: true, parts: [['regions']] },
  { id: 'urinary', name: 'Urinary (Excretory)', on: true, parts: [['visceral', 'urinary_system']] },
  { id: 'lymphatic', name: 'Lymphatic & Immune', parts: [['lymphoid']] },
  { id: 'reproductive', name: 'Reproductive', on: true, parts: [['visceral', 'genital_systems']] },
];
// parts only a boy's body has (a girl's body shows the female organs instead)
const MALE_ONLY = /^(male_genital_system|urogenital_region_[lr]|urethra)$|penis|scrot|testicular|ductus_deferens|prostat|seminal/;
const SYS_COLOR = { female: '#d98c9a', regions: '#e2b095', skeletal: '#ebe3d1', visceral: '#c98270', cardiovascular: '#c8322f', nervous: '#f0cf5a', muscular: '#b5473e', lymphoid: '#97bf5a' };

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
      [/uter|cervix|ovar|vagin|fimbri/, '#d98c9a'],
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

// Parts a girl's body has that the scanned (male) body doesn't. They are modelled here, to
// textbook sizes, and placed from the real body's own landmarks (the bladder, the chest).
// Row: [id, English, Latin, parent id, layer, side, colour]
const FEMALE = [
  ['female_genital_system', 'Female genital system', 'Systema genitale femininum', 'genital_systems', 'visceral', ''],
  ['female_internal_genitalia', 'Female internal genitalia', 'Organa genitalia feminina interna', 'female_genital_system', 'visceral', ''],
  ['uterus', 'Uterus (womb)', 'Uterus', 'female_internal_genitalia', 'visceral', '', '#d98c9a'],
  ['cervix_of_uterus', 'Cervix', 'Cervix uteri', 'female_internal_genitalia', 'visceral', '', '#c97586'],
  ['uterine_tube_l', 'Uterine (fallopian) tube', 'Tuba uterina', 'female_internal_genitalia', 'visceral', 'l', '#e3a1ad'],
  ['uterine_tube_r', 'Uterine (fallopian) tube', 'Tuba uterina', 'female_internal_genitalia', 'visceral', 'r', '#e3a1ad'],
  ['ovary_l', 'Ovary', 'Ovarium', 'female_internal_genitalia', 'visceral', 'l', '#efc6b3'],
  ['ovary_r', 'Ovary', 'Ovarium', 'female_internal_genitalia', 'visceral', 'r', '#efc6b3'],
  ['vagina', 'Vagina', 'Vagina', 'female_internal_genitalia', 'visceral', '', '#cf8796'],
  ['female_urethra', 'Urethra', 'Urethra feminina', 'urinary_system', 'visceral', '', '#e0bd86'],
  ['breast_l', 'Breast', 'Mamma', 'mammary_region_l', 'regions', 'l', '#e2b095'],
  ['breast_r', 'Breast', 'Mamma', 'mammary_region_r', 'regions', 'r', '#e2b095'],
  ['mammary_gland_l', 'Mammary gland', 'Glandula mammaria', 'breast_l', 'regions', 'l', '#eab08a'],
  ['mammary_gland_r', 'Mammary gland', 'Glandula mammaria', 'breast_r', 'regions', 'r', '#eab08a'],
  ['lactiferous_ducts_l', 'Milk ducts (lactiferous ducts)', 'Ductus lactiferi', 'breast_l', 'regions', 'l', '#d9837b'],
  ['lactiferous_ducts_r', 'Milk ducts (lactiferous ducts)', 'Ductus lactiferi', 'breast_r', 'regions', 'r', '#d9837b'],
  ['nipple_l', 'Nipple', 'Papilla mammaria', 'breast_l', 'regions', 'l', '#a8665e'],
  ['nipple_r', 'Nipple', 'Papilla mammaria', 'breast_r', 'regions', 'r', '#a8665e'],
  ['areola_l', 'Areola', 'Areola mammae', 'breast_l', 'regions', 'l', '#b9776c'],
  ['areola_r', 'Areola', 'Areola mammae', 'breast_r', 'regions', 'r', '#b9776c'],
];

export function createBody(ctx) {
  // ctx: { scene, camera, controls, setLoading(text|null), showPart(info|null), invalidate(), base } — base = folder url of explore/
  const redraw = () => ctx.invalidate && ctx.invalidate();
  const group = new THREE.Group();
  group.visible = false;
  ctx.scene.add(group);
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  let index = null;
  const layers = new Map(); // layer -> { meshes: [], scenes: [], loading: Promise }
  const on = new Set(SYSTEMS.filter((s) => s.on).map((s) => s.id));
  let muscles = false; // Musculoskeletal shows the bones; the muscles (which cover everything) when asked
  let sex = 'boy';
  const hidden = new Set(); // structure indexes the student hid
  const rootParts = new Map(); // group id -> its parts (cached)
  let maleParts = new Set(), femaleParts = new Set(), femaleColor = new Map();
  const femaleBuilt = new Set(); // layers whose female parts are made
  let selected = -1, highlight = null;
  const label = document.createElement('span');
  label.className = 'x3d-label on';
  label.hidden = true;

  async function loadIndex() {
    if (!index) {
      const data = await (await fetch(ctx.base + 'body/index.json')).json();
      index = data;
      // the body-wide sheet of fascia hides every muscle under it, so it's left out
      index.chunks = index.chunks.filter((c) => !/fasciae/.test(c.file));
      index.byId = new Map();
      index.s.forEach((r, i) => { if (!index.byId.has(r[0])) index.byId.set(r[0], i); });
      // the girl's parts join the list of structures (and get mesh numbers of their own)
      FEMALE.forEach(([id, en, la, parent, layer, side, color]) => {
        const i = index.s.length;
        index.s.push([id, en, la, index.byId.get(parent), index.systems.indexOf(layer), side]);
        index.byId.set(id, i);
        if (color) { femaleColor.set(i, color); index.mesh.push(i); }
      });
      index.femaleMesh0 = index.mesh.length - femaleColor.size;
      index.lower = index.s.map((r) => r[1].toLowerCase());
      const shown = new Set();
      index.chunks.forEach((c) => { for (let m = c.meshStart; m < c.meshStart + c.meshCount; m++) if (index.mesh[m] >= 0) shown.add(index.mesh[m]); });
      femaleColor.forEach((c, i) => shown.add(i));
      index.hasMesh = shown;
      // what each group (heart, brain, lungs…) is made of
      index.kids = index.s.map(() => []);
      index.s.forEach((r, i) => { if (r[3] >= 0) index.kids[r[3]].push(i); });
      index.size = index.s.map(() => 0);
      const count = (i) => { let n = index.hasMesh.has(i) ? 1 : 0; for (const k of index.kids[i]) n += count(k); index.size[i] = n; return n; };
      index.s.forEach((r, i) => { if (r[3] < 0) count(i); });
      femaleParts = new Set(femaleColor.keys());
      index.s.forEach((r, i) => { if (MALE_ONLY.test(r[0])) partsOf(i).forEach((k) => maleParts.add(k)); });
    }
    return index;
  }
  const layerOf = (si) => index.systems[index.s[si][4]];
  // a part, or every part of a group (the whole heart, the whole femur…)
  function partsOf(si) {
    const out = new Set(), stack = [si];
    while (stack.length) { const i = stack.pop(); if (index.hasMesh.has(i)) out.add(i); stack.push(...index.kids[i]); }
    return out;
  }
  function inside(si, root) { for (let p = si; p >= 0; p = index.s[p][3]) if (p === root) return true; return false; }
  // the body systems a part belongs to (the heart: circulatory; the femur: musculoskeletal…)
  function systemsOf(si) {
    const layer = layerOf(si);
    return SYSTEMS.filter((sys) => sys.parts.some(([l, root]) => l === layer && (!root || inside(si, index.byId.get(root)))));
  }
  const nameOf = (si) => { const r = index.s[si]; return r[1] + (r[5] === 'l' ? ' (left)' : r[5] === 'r' ? ' (right)' : ''); };
  function pathOf(si) { // the groups it belongs to, nearest last: [{ index, name }]
    const out = [];
    let p = index.s[si][3];
    while (p >= 0 && out.length < 3) { if (index.s[p][3] >= 0) out.unshift({ index: p, name: index.s[p][1] }); p = index.s[p][3]; }
    return out.slice(-2);
  }
  const blocked = (si) => hidden.has(si) || (sex === 'girl' ? maleParts.has(si) : femaleParts.has(si));

  // which layers to draw, and which of their parts: layer -> null (all of it) | Set of parts
  function plan() {
    const out = new Map();
    for (const sys of SYSTEMS) {
      if (!on.has(sys.id)) continue;
      for (const [layer, root] of sys.parts) {
        if (layer === 'muscular' && !muscles) continue;
        if (!root) { out.set(layer, null); continue; }
        if (out.get(layer) === null) continue;
        if (!rootParts.has(root)) rootParts.set(root, partsOf(index.byId.get(root)));
        const set = out.get(layer) || new Set();
        rootParts.get(root).forEach((i) => set.add(i));
        out.set(layer, set);
      }
    }
    return out;
  }

  async function loadLayer(id) {
    await loadIndex();
    let L = layers.get(id);
    if (!L) { L = { meshes: [], scenes: [], loading: null }; layers.set(id, L); }
    if (!L.loading) {
      const chunks = index.chunks.filter((c) => index.systems[c.sys] === id);
      ctx.setLoading(`Loading the ${LAYERS[id]}…`);
      L.loading = Promise.all(chunks.map(async (c) => {
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
          L.meshes.push(o);
        });
        group.add(gltf.scene);
        gltf.scene.visible = false;
        L.scenes.push(gltf.scene);
      })).then(() => { if (sex === 'girl') buildFemale(); ctx.setLoading(null); }).catch((e) => { L.loading = null; ctx.setLoading('Couldn’t load it — check your internet and tap again.'); throw e; });
    }
    return L.loading;
  }

  // show the layers the switched-on systems need, each with only its parts
  async function refresh() {
    await loadIndex();
    const p = plan();
    applyFilter(p);
    const loads = [...p.keys()].map((id) => loadLayer(id));
    await Promise.all(loads);
    applyFilter(plan()); // the switches may have changed while it loaded
  }
  // draw only the wanted triangles (a part hidden, a system off, a boy's or girl's part)
  function applyFilter(p = plan()) {
    redraw();
    layers.forEach((L, id) => {
      const want = p.has(id), allowed = p.get(id);
      L.scenes.forEach((sc) => { sc.visible = want; });
      if (!want) return;
      L.meshes.forEach((o) => {
        const g = o.geometry, full = g.userData.fullIndex, ids = g.attributes._id;
        const keep = [];
        for (let t = 0; t < full.length; t += 3) {
          const si = index.mesh[ids.getX(full[t])];
          if (!blocked(si) && (allowed == null || allowed.has(si))) keep.push(full[t], full[t + 1], full[t + 2]);
        }
        if (keep.length === full.length) { if (g.index.array.length !== full.length) g.setIndex(new THREE.BufferAttribute(full.slice(), 1)); }
        else g.setIndex(new THREE.BufferAttribute(new full.constructor(keep), 1));
        o.visible = keep.length > 0;
      });
    });
    if (selected >= 0 && !isShown(selected)) select(-1);
  }
  function isShown(si) {
    const p = plan(), layer = layerOf(si);
    if (!p.has(layer) || [...partsOf(si)].every(blocked)) return false;
    const allowed = p.get(layer);
    return allowed == null || [...partsOf(si)].some((i) => allowed.has(i));
  }

  async function setSystem(id, yes) {
    if (yes) on.add(id); else on.delete(id);
    if (id === 'musculoskeletal' && !yes) muscles = false;
    await refresh();
  }
  async function setMuscles(yes) { muscles = yes; if (yes) on.add('musculoskeletal'); await refresh(); }
  async function setSex(s) {
    sex = s === 'girl' ? 'girl' : 'boy';
    if (sex === 'girl') buildFemale();
    applyFilter();
    await refresh();
  }
  const isOn = (id) => on.has(id);

  /* ---------- the girl's parts ---------- */
  // where a part of the scanned body is, in the body's own coordinates
  function boxOf(si) {
    const want = partsOf(si), box = new THREE.Box3(), v = new THREE.Vector3();
    group.updateWorldMatrix(true, true);
    const toLocal = group.matrixWorld.clone().invert();
    layers.forEach((L) => L.meshes.forEach((o) => {
      if (o.userData.female) return;
      const g = o.geometry, ids = g.attributes._id, pos = g.attributes.position;
      const m = o.matrixWorld.clone().premultiply(toLocal);
      for (let i = 0; i < ids.count; i++) if (want.has(index.mesh[ids.getX(i)])) box.expandByPoint(v.fromBufferAttribute(pos, i).applyMatrix4(m));
    }));
    return box.isEmpty() ? null : box;
  }
  // one coloured, tappable mesh for a part
  function partMesh(id, geo, layer, look = {}) {
    const si = index.byId.get(id);
    const meshNo = index.mesh.indexOf(si);
    if (!geo.index) mergeIndexed(geo);
    const n = geo.attributes.position.count;
    geo.setAttribute('_id', new THREE.BufferAttribute(new Float32Array(n).fill(meshNo), 1));
    const c = new THREE.Color(femaleColor.get(si)).convertSRGBToLinear(), col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    if (geo.attributes.uv) geo.deleteAttribute('uv');
    geo.computeVertexNormals();
    geo.userData.fullIndex = geo.index.array.slice();
    const skin = !!look.skin;
    const o = new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({
      vertexColors: true, roughness: skin ? 0.6 : 0.45, clearcoat: skin ? 0 : 0.35, clearcoatRoughness: 0.4,
      transparent: skin, opacity: skin ? 0.3 : 1, depthWrite: !skin, side: skin ? THREE.FrontSide : THREE.DoubleSide,
    }));
    o.userData = { system: layer, pickable: !skin, female: true };
    o.renderOrder = skin ? 2 : 0;
    return o;
  }
  const tube = (pts, r, seg = 40) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), seg, r, 10, false);
  function buildFemale() {
    if (!index) return;
    const front = 1; // the body faces +z
    // the womb, tubes, ovaries and vagina sit behind and above the bladder
    if (!femaleBuilt.has('visceral') && layers.get('visceral') && layers.get('visceral').meshes.length) {
      const bl = boxOf(index.byId.get('urinary_bladder'));
      if (bl) {
        femaleBuilt.add('visceral');
        const L = layers.get('visceral');
        const root = new THREE.Group();
        const c = bl.getCenter(new THREE.Vector3()), size = bl.getSize(new THREE.Vector3());
        const cervixAt = new THREE.Vector3(c.x, bl.min.y + size.y * 0.45, bl.min.z - 0.012 * front);
        const tilt = new THREE.Euler(1.05 * front, 0, 0); // tipped forward over the bladder (anteverted)
        // the uterus: an upside-down pear, 7.5 cm long, flattened front to back
        const pear = new THREE.LatheGeometry([[0.0, 0.0], [0.013, 0.002], [0.016, 0.012], [0.021, 0.03], [0.025, 0.046], [0.024, 0.058], [0.018, 0.068], [0.009, 0.074], [0.0, 0.0755]].map(([x, y]) => new THREE.Vector2(x, y)), 28);
        pear.scale(1, 1, 0.62);
        const ut = partMesh('uterus', pear, 'visceral');
        ut.position.copy(cervixAt); ut.rotation.copy(tilt);
        const cervix = partMesh('cervix_of_uterus', new THREE.CylinderGeometry(0.0125, 0.012, 0.026, 22, 1, false).translate(0, -0.012, 0).scale(1, 1, 0.8), 'visceral');
        cervix.position.copy(cervixAt); cervix.rotation.copy(tilt);
        root.add(ut, cervix);
        // the horns of the womb, where the tubes start
        ut.updateMatrix();
        for (const side of [-1, 1]) {
          const horn = new THREE.Vector3(0.022 * side, 0.06, 0).applyMatrix4(ut.matrix);
          const ovary = horn.clone().add(new THREE.Vector3(0.068 * side, -0.035, -0.022 * front));
          const pts = [horn, horn.clone().add(new THREE.Vector3(0.035 * side, 0.012, -0.004 * front)), horn.clone().add(new THREE.Vector3(0.07 * side, 0.004, -0.014 * front)),
            ovary.clone().add(new THREE.Vector3(0.016 * side, 0.02, -0.004 * front)), ovary.clone().add(new THREE.Vector3(0.004 * side, 0.012, 0.006 * front))];
          // the tube widens at its end into the fringed funnel that catches the egg
          const funnel = new THREE.LatheGeometry([[0.003, 0], [0.006, 0.006], [0.011, 0.012], [0.012, 0.014]].map(([x, y]) => new THREE.Vector2(x, y)), 14, 0, Math.PI * 2);
          const end = pts[pts.length - 1], before = pts[pts.length - 2];
          funnel.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.clone().sub(before).normalize())).translate(end.x, end.y, end.z);
          const tubeGeo = mergeGeometries([tube(pts, 0.0035).toNonIndexed(), funnel.toNonIndexed()]);
          root.add(partMesh(side < 0 ? 'uterine_tube_r' : 'uterine_tube_l', mergeIndexed(tubeGeo), 'visceral'));
          const ov = partMesh(side < 0 ? 'ovary_r' : 'ovary_l', new THREE.SphereGeometry(1, 24, 16).scale(0.017, 0.0105, 0.009), 'visceral');
          ov.position.copy(ovary); ov.rotation.set(0.3, 0.4 * side, 0.5 * side);
          root.add(ov);
        }
        // the vagina: from the cervix down and a little forward to the outside
        const vg = tube([cervixAt.clone().add(new THREE.Vector3(0, -0.01, -0.004 * front)), cervixAt.clone().add(new THREE.Vector3(0, -0.045, 0.006 * front)), cervixAt.clone().add(new THREE.Vector3(0, -0.085, 0.02 * front))], 0.011, 24);
        root.add(partMesh('vagina', vg, 'visceral'));
        // a girl's urethra: short (about 4 cm), from the bottom of the bladder, just in front of the vagina
        const neck = new THREE.Vector3(c.x, bl.min.y + 0.004, bl.min.z + size.z * 0.35);
        root.add(partMesh('female_urethra', tube([neck, neck.clone().add(new THREE.Vector3(0, -0.02, 0.004 * front)), neck.clone().add(new THREE.Vector3(0, -0.04, 0.012 * front))], 0.0035, 16), 'visceral'));
        addFemale(L, root);
      }
    }
    // the breasts, on the chest's mammary regions
    if (!femaleBuilt.has('regions') && layers.get('regions') && layers.get('regions').meshes.length) {
      const L = layers.get('regions');
      const root = new THREE.Group();
      let made = 0;
      for (const side of ['l', 'r']) {
        const box = boxOf(index.byId.get('mammary_region_' + side));
        if (!box) continue;
        made++;
        const at = box.getCenter(new THREE.Vector3());
        at.z = box.max.z - 0.012 * front; at.y -= 0.012;
        const R = 0.058, D = 0.048; // 11–12 cm across, 5 cm deep
        const breast = partMesh('breast_' + side, new THREE.SphereGeometry(1, 36, 24, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2 * front).scale(R, R * 0.95, D), 'regions', { skin: true });
        breast.position.copy(at);
        const tip = at.clone().add(new THREE.Vector3(0, 0, D * front));
        const nipple = partMesh('nipple_' + side, new THREE.CylinderGeometry(0.0045, 0.0055, 0.008, 16).rotateX(Math.PI / 2).translate(0, 0, 0.003 * front), 'regions');
        nipple.position.copy(tip);
        const areola = partMesh('areola_' + side, new THREE.CylinderGeometry(0.017, 0.017, 0.0015, 32).rotateX(Math.PI / 2), 'regions');
        areola.position.copy(tip).add(new THREE.Vector3(0, 0, -0.0012 * front));
        // 15–20 lobes of milk-making gland, spread like the petals of a daisy, each with a duct to the nipple
        const lobes = [], ducts = [];
        for (let k = 0; k < 16; k++) {
          const a = (k / 16) * Math.PI * 2, rr = 0.03 + (k % 2) * 0.008;
          const p = new THREE.Vector3(Math.cos(a) * rr, Math.sin(a) * rr * 0.95, -0.004 * front);
          lobes.push(new THREE.SphereGeometry(1, 12, 9).scale(0.011, 0.0085, 0.009).rotateZ(a).translate(p.x, p.y, p.z).toNonIndexed());
          ducts.push(tube([p, p.clone().multiplyScalar(0.5).setZ(D * 0.55 * front), new THREE.Vector3(0, 0, (D - 0.002) * front)], 0.0012, 10).toNonIndexed());
        }
        const gland = partMesh('mammary_gland_' + side, mergeIndexed(mergeGeometries(lobes)), 'regions');
        const duct = partMesh('lactiferous_ducts_' + side, mergeIndexed(mergeGeometries(ducts)), 'regions');
        gland.position.copy(at); duct.position.copy(at);
        root.add(breast, gland, duct, nipple, areola);
      }
      if (made) { femaleBuilt.add('regions'); addFemale(L, root); }
    }
  }
  function mergeIndexed(geo) { // index a non-indexed geometry (each triangle keeps its own corners)
    const n = geo.attributes.position.count, ix = new Uint32Array(n);
    for (let i = 0; i < n; i++) ix[i] = i;
    geo.setIndex(new THREE.BufferAttribute(ix, 1));
    return geo;
  }
  function addFemale(L, root) {
    root.traverse((o) => { if (o.isMesh) L.meshes.push(o); });
    group.add(root);
    L.scenes.push(root);
    root.visible = L.scenes[0] ? L.scenes[0].visible : false;
    applyFilter();
  }

  // the picked part, drawn again on top in a bright outline colour
  function makeHighlight(si) {
    if (highlight) { group.remove(highlight); highlight.geometry.dispose(); highlight = null; }
    if (si < 0) return null;
    const want = partsOf(si);
    const pos = [], v = new THREE.Vector3();
    group.updateWorldMatrix(true, true);
    const toLocal = group.matrixWorld.clone().invert();
    layers.forEach((L) => L.meshes.forEach((o) => {
      if (!o.visible || !o.parent.visible) return;
      const g = o.geometry, ids = g.attributes._id, p = g.attributes.position, ix = g.index.array;
      const m = o.matrixWorld.clone().premultiply(toLocal);
      for (let t = 0; t < ix.length; t += 3) {
        if (!want.has(index.mesh[ids.getX(ix[t])])) continue;
        for (let k = 0; k < 3; k++) { v.fromBufferAttribute(p, ix[t + k]).applyMatrix4(m); pos.push(v.x, v.y, v.z); }
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
  function ghost(yes) {
    layers.forEach((L) => L.meshes.forEach((o) => {
      const m = o.material;
      if (!m.userData.base) m.userData.base = { opacity: m.opacity, transparent: m.transparent, depthWrite: m.depthWrite };
      const b = m.userData.base;
      const t = yes ? true : b.transparent;
      m.opacity = yes ? Math.min(b.opacity, o.userData.system === 'regions' ? 0.06 : 0.16) : b.opacity;
      m.depthWrite = yes ? false : b.depthWrite;
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
    const layer = layerOf(si), sys = systemsOf(si)[0];
    ctx.showPart({
      index: si, id: index.s[si][0], name: nameOf(si), plain: index.s[si][1], latin: index.s[si][2], path: pathOf(si),
      system: sys ? sys.name.replace(/\s*\(.*\)$/, '') : LAYERS[layer], systemId: sys ? sys.id : layer, layer, whole: !index.hasMesh.has(si),
      color: femaleColor.get(si) || colourFor(layer, index.s[si][0]), sex,
      focus: sphere ? { target: sphere.center.clone(), dist: Math.max(0.35, sphere.radius * 4.2) } : null,
    });
  }

  function pick(ray) {
    const meshes = [];
    layers.forEach((L) => L.meshes.forEach((o) => { if (o.userData.pickable && o.visible && o.parent.visible) meshes.push(o); }));
    if (highlight) meshes.unshift(highlight);
    const hits = ray.intersectObjects(meshes, false);
    for (const h of hits) {
      if (h.object === highlight) return selected; // tapping the picked part (or group) again keeps it
      const ids = h.object.geometry.attributes._id;
      const si = index.mesh[ids.getX(h.face.a)];
      if (si >= 0 && !blocked(si)) return selected >= 0 && partsOf(selected).has(si) && !index.hasMesh.has(selected) ? selected : si;
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
      const sys = systemsOf(i)[0];
      out.push({ index: i, name: index.s[i][1], system: sys ? sys.name.replace(/\s*\(.*\)$/, '') : LAYERS[layerOf(i)], starts: n.startsWith(words[0]), exact: n === words.join(' '), whole: !index.hasMesh.has(i) });
    }
    return out.sort((a, b) => (b.exact - a.exact) || (b.starts - a.starts) || (b.whole - a.whole) || a.name.length - b.name.length).slice(0, 8);
  }
  async function goTo(si) {
    // a girl's part shows the girl's body, a boy's part the boy's
    const parts = [...partsOf(si)];
    if (parts.length && parts.every((i) => femaleParts.has(i)) && sex !== 'girl') { sex = 'girl'; buildFemale(); }
    if (parts.length && parts.every((i) => maleParts.has(i)) && sex !== 'boy') sex = 'boy';
    const sys = systemsOf(si);
    if (!sys.some((x) => on.has(x.id)) && sys[0]) on.add(sys[0].id);
    if (layerOf(si) === 'muscular') { muscles = true; on.add('musculoskeletal'); }
    parts.forEach((i) => hidden.delete(i)); hidden.delete(si);
    await refresh();
    if (sex === 'girl') buildFemale();
    ctx.onSystems && ctx.onSystems();
    select(si);
  }

  function hide(si) { partsOf(si).forEach((i) => hidden.add(i)); select(-1); applyFilter(); }
  function showAll() { hidden.clear(); applyFilter(); }

  async function enter() {
    group.visible = true;
    redraw();
    await refresh();
  }
  function leave() { group.visible = false; label.hidden = true; }
  function placeLabel(camera, w, h) {
    if (label.hidden || !label.userData) return;
    const p = label.userData.clone().project(camera);
    label.style.transform = `translate(${((p.x + 1) / 2) * w}px, ${((1 - p.y) / 2) * h}px)`;
  }
  return {
    group, label, enter, leave, setSystem, setMuscles, setSex, isOn, pick, select, search, goTo, hide, showAll, placeLabel,
    get muscles() { return muscles; }, get sex() { return sex; },
    boxOf: (id) => (index && index.byId.has(id) ? boxOf(index.byId.get(id)) : null),
    get hiddenCount() { return hidden.size; }, get selected() { return selected; },
    camera: new THREE.Vector3(0.55, 1.35, 2.6), target: new THREE.Vector3(0, 0.95, 0.03), fit: 0.95,
  };
}

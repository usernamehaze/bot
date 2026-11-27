/* (v343) Organs from the Labs' 3D body, for Cassie's drawings: a body system (the heart and vessels, the gut, the
   nerves, the kidneys) is cut out of the same scanned atlas the Labs' Human body 3D shows (explore/body/, its licence in
   body/README.md), one group per part of the drawing, with a faint outline of the body around them, so every organ is
   its real shape in its real place. Where something flows through them (blood, air, food, a nerve signal) its path is
   worked out from where those organs really are: a "via" waypoint is an organ, or one end of it ("aorta^" its top,
   "oesophagus_" its bottom, "femoral_artery_l<" its far left...). */
import * as THREE from './three.module.min.js';
import { GLTFLoader } from './GLTFLoader.js';
import { MeshoptDecoder } from './meshopt_decoder.module.js';
import { tissueMaterial } from './tissue.js';
import { smoothNormals } from './body3d.js';

let index = null, indexP = null;
const chunks = new Map(); // file -> Promise<gltf scene>
async function loadIndex(base) {
  if (index) return index;
  if (!indexP) indexP = fetch(base + 'body/index.json').then((r) => r.json()).then((d) => {
    d.byId = new Map(); d.s.forEach((r, i) => { if (!d.byId.has(r[0])) d.byId.set(r[0], i); });
    d.kids = d.s.map(() => []); d.s.forEach((r, i) => { if (r[3] >= 0) d.kids[r[3]].push(i); });
    d.hasMesh = new Set(d.mesh.filter((x) => x >= 0));
    d.chunks = d.chunks.filter((c) => !/fasciae/.test(c.file));
    index = d; return d;
  });
  return indexP;
}
const partsOf = (d, id) => { const out = new Set(), si = d.byId.get(id); if (si == null) return out; const st = [si]; while (st.length) { const i = st.pop(); if (d.hasMesh.has(i)) out.add(i); st.push(...d.kids[i]); } return out; };
function loadChunk(base, file) {
  if (!chunks.has(file)) { const l = new GLTFLoader(); l.setMeshoptDecoder(MeshoptDecoder); chunks.set(file, l.loadAsync(base + 'body/' + file).then((g) => g.scene)); }
  return chunks.get(file);
}
// the triangles of one set of structures, as one mesh (its own copy of the points it uses)
function cut(src, keep, d) {
  const g = src.geometry, ids = g.attributes._id, full = g.index.array, pos = g.attributes.position, map = new Map(), P = [], I = [];
  for (let t = 0; t < full.length; t += 3) {
    if (!keep.has(d.mesh[ids.getX(full[t])])) continue;
    for (let k = 0; k < 3; k++) { const v = full[t + k]; let j = map.get(v); if (j === undefined) { j = map.size; map.set(v, j); P.push(pos.getX(v), pos.getY(v), pos.getZ(v)); } I.push(j); }
  }
  if (!I.length) return null;
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3));
  out.setIndex(new THREE.BufferAttribute(P.length / 3 > 65535 ? new Uint32Array(I) : new Uint16Array(I), 1));
  src.updateWorldMatrix(true, false); out.applyMatrix4(src.matrixWorld);
  smoothNormals(out);
  return out;
}
const KIND = (layer) => ({ cardiovascular: 'cardiovascular', visceral: 'visceral', nervous: 'nervous', muscular: 'muscular', skeletal: 'skeletal', regions: 'regions', lymphoid: 'lymphoid' })[layer] || 'visceral';
// parts: [{ id, of: [structure ids], color, skin? }] → { groups: Map(id -> THREE.Group), at(waypoint) -> Vector3|null, box }
export async function organs(base, parts, { size = 5 } = {}) {
  const d = await loadIndex(base);
  const want = parts.map((p) => { const s = new Set(); (p.of || []).forEach((id) => partsOf(d, id).forEach((i) => s.add(i))); return { p, s }; });
  const all = new Set(); want.forEach((w) => w.s.forEach((i) => all.add(i)));
  const files = d.chunks.filter((c) => { for (let m = c.meshStart; m < c.meshStart + c.meshCount; m++) if (all.has(d.mesh[m])) return true; return false; });
  const scenes = await Promise.all(files.map((c) => loadChunk(base, c.file).then((sc) => ({ sc, layer: d.systems[c.sys] }))));
  const groups = new Map(), raw = new THREE.Group();
  for (const { p, s } of want) {
    const g = new THREE.Group(); g.name = p.id;
    for (const { sc, layer } of scenes) sc.traverse((o) => {
      if (!o.isMesh || !o.geometry.attributes._id) return;
      const geo = cut(o, s, d); if (!geo) return;
      const skin = !!p.skin || layer === 'regions', see = skin ? 0.1 : p.faint ? 0.38 : 1;
      const m = tissueMaterial(THREE, KIND(layer), { vertexColors: false, color: new THREE.Color(p.color || '#c98270'), side: THREE.DoubleSide, transparent: true, opacity: see, depthWrite: see === 1 });
      const mesh = new THREE.Mesh(geo, m); mesh.userData.tissue = KIND(layer); if (see < 1) { mesh.renderOrder = skin ? -1 : 1; mesh.userData.keepOpacity = see; }
      g.add(mesh);
    });
    if (g.children.length) { groups.set(p.id, g); raw.add(g); }
  }
  // the system's own size: centred on 0, about `size` across (the skin outline does not count)
  const box = new THREE.Box3(); groups.forEach((g, id) => { if (!(parts.find((p) => p.id === id) || {}).skin) box.expandByObject(g); });
  if (box.isEmpty()) return null;
  const mid = box.getCenter(new THREE.Vector3()), k = size / Math.max(...box.getSize(new THREE.Vector3()).toArray());
  const fit = (v) => v.clone().sub(mid).multiplyScalar(k);
  groups.forEach((g) => g.children.forEach((m) => { m.geometry.translate(-mid.x, -mid.y, -mid.z); m.geometry.scale(k, k, k); m.geometry.computeBoundingBox(); const c = m.geometry.boundingBox.getCenter(new THREE.Vector3()); m.geometry.translate(-c.x, -c.y, -c.z); m.position.copy(c); m.geometry.computeBoundingBox(); m.geometry.computeBoundingSphere(); })); // (each piece centred on itself, so it grows in its own place)
  // a waypoint: the middle of an organ's points, or one end of it (^ top, _ bottom, < left, > right, + front, - back)
  const pts = new Map();
  const pointsOf = (id) => {
    if (pts.has(id)) return pts.get(id);
    const s = partsOf(d, id), out = [];
    for (const { sc } of scenes) sc.traverse((o) => { if (!o.isMesh || !o.geometry.attributes._id) return; const ids = o.geometry.attributes._id, pos = o.geometry.attributes.position; o.updateWorldMatrix(true, false); const v = new THREE.Vector3(); for (let i = 0; i < ids.count; i += 3) if (s.has(d.mesh[ids.getX(i)])) out.push(fit(v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld))); });
    pts.set(id, out); return out;
  };
  const at = (w) => {
    const m = String(w).match(/^([a-z0-9_]+?)([\^_<>+-]?)$/); if (!m) return null;
    const P = pointsOf(m[1]); if (!P.length) return null;
    const avg = (L) => L.reduce((a, b) => a.add(b), new THREE.Vector3()).multiplyScalar(1 / L.length);
    if (!m[2]) return avg(P);
    const key = { '^': (v) => v.y, _: (v) => -v.y, '<': (v) => -v.x, '>': (v) => v.x, '+': (v) => v.z, '-': (v) => -v.z }[m[2]];
    const sorted = P.slice().sort((a, b) => key(b) - key(a));
    return avg(sorted.slice(0, Math.max(1, Math.ceil(sorted.length * 0.04))));
  };
  return { groups, at };
}

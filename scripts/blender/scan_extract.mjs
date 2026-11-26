// Pull named structures out of the Labs' scanned body (web/explore/body: Z-Anatomy / BodyParts3D, CC BY-SA 4.0)
// so Blender can turn them into one of Cassie's organ models.
//   node scan_extract.mjs <out.json> <structure|structure*>...
// A trailing * takes the structure and everything under it. Output: { name: { pos: [...], idx: [...] } } in metres
// (the body's own y-up coordinates). Needs @gltf-transform/core, @gltf-transform/extensions and meshoptimizer
// (NODE_PATH, not part of the app).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

const here = path.dirname(fileURLToPath(import.meta.url));
const BODY = path.join(here, '..', '..', 'web', 'explore', 'body');
const index = JSON.parse(fs.readFileSync(path.join(BODY, 'index.json'), 'utf8'));
const [out, ...asks] = process.argv.slice(2);
const byName = new Map(index.s.map((e, i) => [e[0], i]));
const kids = new Map();
index.s.forEach((e, i) => { if (!kids.has(e[3])) kids.set(e[3], []); kids.get(e[3]).push(i); });
const under = (i) => [i, ...(kids.get(i) || []).flatMap(under)];
const want = new Set();
for (const a of asks) {
  const n = a.replace(/\*$/, ''), i = byName.get(n);
  if (i == null) { console.error('no structure', n); process.exit(1); }
  (a.endsWith('*') ? under(i) : [i]).forEach((k) => want.add(k));
}
const files = new Set();
for (const c of index.chunks) for (let m = c.meshStart; m < c.meshStart + c.meshCount; m++) if (want.has(index.mesh[m])) files.add(c.file);

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const got = {};
for (const f of files) {
  const doc = await io.read(path.join(BODY, f));
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh(); if (!mesh) continue;
    const M = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const P = prim.getAttribute('POSITION'), I = prim.getAttribute('_ID'), X = prim.getIndices();
      if (!P || !I) continue;
      const map = new Map(); // (part, old vertex) -> new vertex
      const e = [], id = [];
      const vert = (part, v) => {
        const k = part.name + ':' + v; let n = map.get(k);
        if (n == null) {
          P.getElement(v, e);
          const x = e[0], y = e[1], z = e[2];
          part.pos.push(M[0] * x + M[4] * y + M[8] * z + M[12], M[1] * x + M[5] * y + M[9] * z + M[13], M[2] * x + M[6] * y + M[10] * z + M[14]);
          n = part.pos.length / 3 - 1; map.set(k, n);
        }
        return n;
      };
      const tri = X ? X.getCount() / 3 : P.getCount() / 3;
      for (let t = 0; t < tri; t++) {
        const a = X ? X.getScalar(3 * t) : 3 * t, b = X ? X.getScalar(3 * t + 1) : 3 * t + 1, c = X ? X.getScalar(3 * t + 2) : 3 * t + 2;
        I.getElement(a, id);
        const si = index.mesh[Math.round(id[0])];
        if (!want.has(si)) continue;
        const name = index.s[si][0];
        const part = got[name] || (got[name] = { name, pos: [], idx: [] });
        part.idx.push(vert(part, a), vert(part, b), vert(part, c));
      }
    }
  }
}
fs.writeFileSync(out, JSON.stringify(got));
for (const k of Object.keys(got)) console.log(k, got[k].pos.length / 3, 'verts', got[k].idx.length / 3, 'tris');

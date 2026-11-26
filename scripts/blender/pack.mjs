// Pack a Blender model small for the app, as the Labs' body is packed: positions and normals quantized, then
// meshopt-compressed (EXT_meshopt_compression; the app's GLTFLoader reads it with explore/meshopt_decoder.module.js).
//   node pack.mjs web/models/heart.glb [...more]   (NODE_PATH with @gltf-transform/core, extensions, functions, meshoptimizer)
import fs from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { meshopt, dedup, prune } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';

await MeshoptEncoder.ready; await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
for (const file of process.argv.slice(2)) {
  const before = fs.statSync(file).size;
  const doc = await io.read(file);
  await doc.transform(dedup(), prune({ keepLeaves: true, keepAttributes: true }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  await io.write(file, doc);
  console.log(file, Math.round(before / 1024) + 'K ->', Math.round(fs.statSync(file).size / 1024) + 'K');
}

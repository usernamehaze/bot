#!/usr/bin/env node
/* Writes offline-files.json: what "Save for offline" (Settings) downloads so Learn works with no internet.
   Learn's code and pictures (labs/), the 3D code (explore/, not the whole 3D body: 19 MB) and the 3D Cassie.
   (v346) And the drawings' 3D: the book's finished models (models/*.glb) and, from the Labs body, only the files its
   body systems (blood, digestion, nerves, kidneys) are cut from, so every 3D drawing works with no internet too.
   versioned: files the app loads with ?v=<the app's version> in the address; they are fetched that way too.
   Run it after adding or removing a file in labs/ or explore/ (a smoke test checks the list is current). */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'web'); // (the website's files)
const walk = (dir) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
  const rel = dir + '/' + e.name;
  if (e.isDirectory()) return rel === 'explore/body' ? [] : walk(rel); // (the 3D body models: too big to save)
  return /\.(js|css|json|svg|webp|png|jpg|glb|bin|wasm)$/i.test(e.name) ? [rel] : [];
});
(async () => {
const bk = await import(require('url').pathToFileURL(path.join(ROOT, 'drawbook.js')).href);
const models = fs.readdirSync(path.join(ROOT, 'models')).filter((f) => /\.glb$/.test(f)).map((f) => 'models/' + f);
// the body's files that hold the organs the book's body systems use (as explore/organs.js picks them)
const d = JSON.parse(fs.readFileSync(path.join(ROOT, 'explore/body/index.json'), 'utf8'));
const byId = new Map(); d.s.forEach((r, i) => { if (!byId.has(r[0])) byId.set(r[0], i); });
const kids = d.s.map(() => []); d.s.forEach((r, i) => { if (r[3] >= 0) kids[r[3]].push(i); });
const hasMesh = new Set(d.mesh.filter((x) => x >= 0)), all = new Set();
for (const id of bk.atlasOrgans()) { const si = byId.get(id); if (si == null) throw new Error('not in the Labs body: ' + id); const st = [si]; while (st.length) { const i = st.pop(); if (hasMesh.has(i)) all.add(i); st.push(...kids[i]); } }
const body = d.chunks.filter((c) => !/fasciae/.test(c.file)).filter((c) => { for (let m = c.meshStart; m < c.meshStart + c.meshCount; m++) if (all.has(d.mesh[m])) return true; return false; }).map((c) => 'explore/body/' + c.file);
const files = [...walk('labs'), ...walk('explore'), 'cassie-bot3d.js', ...models, 'explore/body/index.json', ...body].sort();
const versioned = ['labs/labs.js', 'labs/museum.js', 'labs/level-lessons.js', 'labs/previews.js', 'livedraw.js', 'drawbook.js', 'explore/cell3d.js', 'cassie-3d.js'];
const fixed = ['labs/labs.css?v=22'];
const bytes = files.reduce((n, f) => n + fs.statSync(path.join(ROOT, f)).size, 0);
fs.writeFileSync(path.join(ROOT, 'offline-files.json'), JSON.stringify({ files, versioned, fixed, bytes }, null, 0) + '\n');
console.log(`${files.length} files, ${(bytes / 1048576).toFixed(1)} MB`);
})();

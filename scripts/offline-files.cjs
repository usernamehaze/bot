#!/usr/bin/env node
/* Writes offline-files.json: what "Save for offline" (Settings) downloads so Learn works with no internet.
   Learn's code and pictures (labs/), the 3D code (explore/, not the 3D body models: 19 MB) and the 3D Cassie.
   versioned: files the app loads with ?v=<the app's version> in the address; they are fetched that way too.
   Run it after adding or removing a file in labs/ or explore/ (a smoke test checks the list is current). */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'web'); // (the website's files)
const walk = (dir) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
  const rel = dir + '/' + e.name;
  if (e.isDirectory()) return rel === 'explore/body' ? [] : walk(rel); // (the 3D body models: too big to save)
  return /\.(js|css|json|svg|webp|png|jpg|glb|bin|wasm)$/i.test(e.name) ? [rel] : [];
});
const files = [...walk('labs'), ...walk('explore'), 'cassie-bot3d.js'].sort();
const versioned = ['labs/labs.js', 'labs/museum.js', 'labs/level-lessons.js', 'labs/previews.js', 'livedraw.js', 'explore/cell3d.js', 'cassie-3d.js'];
const fixed = ['labs/labs.css?v=22'];
const bytes = files.reduce((n, f) => n + fs.statSync(path.join(ROOT, f)).size, 0);
fs.writeFileSync(path.join(ROOT, 'offline-files.json'), JSON.stringify({ files, versioned, fixed, bytes }, null, 0) + '\n');
console.log(`${files.length} files, ${(bytes / 1048576).toFixed(1)} MB`);

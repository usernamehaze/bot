// Lists the real words Cassie's typo reader must never "correct" (drawbook.js KEEP): words used in Cassie's own texts
// (her facts, lessons, labs and pages: real English) that sit one or two letters from a word she reads drawings by
// ("leaf" is near "loaf", "shoe" near "show"). Run after the book or a kit gains words: node scripts/typo-keep.mjs
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const web = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const b = await import(path.join(web, 'drawbook.js')), m = await import(path.join(web, 'livedraw.js'));
b.knowWords(m.kitNames());
const V = b.typoVocab(), count = new Map();
const walk = (d) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f), st = fs.statSync(p); if (st.isDirectory()) { if (!/^(vendor|models|icons|tex)$/.test(f)) walk(p); } else if (/\.(js|html|json|md)$/.test(f) && !/min\.js$|three|world-110m|countries|index\.json$/.test(f) && st.size < 3e6) for (const w of fs.readFileSync(p, 'utf8').toLowerCase().match(/\b[a-z]{4,12}\b/g) || []) count.set(w, (count.get(w) || 0) + 1); } };
walk(web);
const slips = (a, c, most) => { if (Math.abs(a.length - c.length) > most) return most + 1; let p2 = null, p = Array.from({ length: c.length + 1 }, (_, j) => j); for (let i = 1; i <= a.length; i++) { const r = [i]; for (let j = 1; j <= c.length; j++) { r[j] = Math.min(p[j] + 1, r[j - 1] + 1, p[j - 1] + (a[i - 1] === c[j - 1] ? 0 : 1)); if (p2 && i > 1 && j > 1 && a[i - 1] === c[j - 2] && a[i - 2] === c[j - 1]) r[j] = Math.min(r[j], p2[j - 2] + 1); } p2 = p; p = r; } return p[c.length]; };
const keep = [...count].filter(([w, n]) => n >= 2 && !V.has(w) && !V.has(w.replace(/(es|s)$/, '')) && [...V].some((k) => slips(w, k, w.length >= 7 ? 2 : 1) <= (w.length >= 7 ? 2 : 1))).map(([w]) => w).sort();
const file = path.join(web, 'drawbook.js'), src = fs.readFileSync(file, 'utf8');
const out = src.replace(/const KEEP = '[^']*';/, `const KEEP = '${keep.join(' ')}';`);
fs.writeFileSync(file, out); fs.copyFileSync(file, path.join(web, '..', 'extension', 'drawbook.js'));
console.log(keep.length + ' words kept');

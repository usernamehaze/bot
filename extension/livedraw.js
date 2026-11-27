/* Live drawing (v251): Cassie explains with real graphics, drawn part by part while she talks.
   A drawing is a small JSON "spec" the AI writes (see SPEC_GUIDE in app.js): a title, flat (2d) or a 3D model (3d),
   and parts in teaching order, each with its own shapes, a label and one or two sentences.
     2d: lines, curves, boxes, circles, arrows and words in a 400 x 260 picture, drawn stroke by stroke like a pen.
     3d: cylinders, cones, spheres, boxes, rings, discs and fan blades, built piece by piece; turn it with a finger,
         pinch to zoom, tap a part, open the case, pull it apart, and spinning parts spin.
   Everything the AI writes is checked: numbers are clamped, colours must be #hex, paths only use path letters and
   numbers, and words go in as text (never as markup). three.js loads only when a 3D drawing shows. */

const NS = 'http://www.w3.org/2000/svg';
const PALETTE = ['#7fb0ff', '#ffb067', '#8fe0b0', '#f7a8c8', '#c9a7ff', '#ffd29e', '#7ee0e0', '#e8e8ee'];
const still = () => document.documentElement.classList.contains('lite') || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
const num = (v, lo, hi, d = 0) => { const n = +v; return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const color0 = (c, i) => (typeof c === 'string' && /^#[0-9a-f]{3,8}$/i.test(c.trim()) ? c.trim() : PALETTE[i % PALETTE.length]);
// (a light page: a very pale colour is darkened so a white cloud or a pale part still shows, AA-ish against white)
const lum = (h) => { let x = h.slice(1); if (x.length < 6) x = x.slice(0, 3).split('').map((c) => c + c).join(''); const [r, g, b] = [0, 2, 4].map((k) => parseInt(x.slice(k, k + 2), 16) / 255); return .2126 * r + .7152 * g + .0722 * b; };
let paperLight = null; // (a drawing on a card with its own paper, like the extension's: its light or dark, not the page's)
const lightPage = () => { if (paperLight != null) return paperLight; try { const m = getComputedStyle(document.body).backgroundColor.match(/[\d.]+/g); return m && (.2126 * m[0] + .7152 * m[1] + .0722 * m[2]) / 255 > .6; } catch (e) { return false; } };
const shade = (h, k) => { let x = h.slice(1); if (x.length < 6) x = x.slice(0, 3).split('').map((c) => c + c).join(''); return '#' + [0, 2, 4].map((i) => Math.round(parseInt(x.slice(i, i + 2), 16) * k).toString(16).padStart(2, '0')).join(''); };
// (v305) and on dark paper a very dark colour is brightened (a black bike copied from a photo was nearly invisible)
const lighten = (h, k) => { let x = h.slice(1); if (x.length < 6) x = x.slice(0, 3).split('').map((c) => c + c).join(''); return '#' + [0, 2, 4].map((i) => { const v = parseInt(x.slice(i, i + 2), 16); return Math.round(v + (255 - v) * k).toString(16).padStart(2, '0'); }).join(''); };
const color = (c, i) => { const h = color0(c, i); if (lightPage()) return lum(h) > .55 ? shade(h, .55 / lum(h) * .8) : h; return lum(h) < .3 ? lighten(h, Math.min(.85, (.42 - lum(h)) / (1 - lum(h)) + .1)) : h; };
const words = (t, max = 400) => String(t == null ? '' : t).replace(/[–—]/g, ',').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
const PATH_OK = /^[MmLlHhVvCcSsQqTtAaZz0-9.,\s+-]{1,1500}$/;
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- the spec: what the AI wrote, made safe ----------
const KINDS2 = ['line', 'arrow', 'rect', 'circle', 'ellipse', 'poly', 'path', 'text', 'vehicle', 'tree', 'flower', 'leaf', 'cloud', 'sun', 'moon', 'rainbow', 'snowflake', 'bolt', 'drops', 'grass', 'rock', 'log', 'mushroom', 'animal', 'appliance', 'food']; // (v324: and the nature kit; v327: animals)
const KINDS3 = ['cylinder', 'tube', 'disc', 'cone', 'torus', 'ring', 'blades', 'sphere', 'box', 'capsule', 'pipe', 'arrow', 'lathe', 'plate', 'tree', 'flower', 'leaf', 'cloud', 'sun', 'moon', 'rainbow', 'rock', 'grass', 'log', 'mushroom', 'ground', 'drops', 'snowflake', 'bolt', 'vehicle', 'animal', 'appliance', 'food']; // (v325: and the nature kit in 3D; v326: vehicles; v327: animals)
const has = (x, k) => x[k] != null && x[k] !== '';
// (v320) what a 3D part is really made of, with photographically grounded values from the Blender skills pack
// (github.com/arjun988/blender-skills, realistic-style/references/pbr-values.md): metals are fully metallic, everything
// else not at all, and each surface its own real roughness; glass and water let light through; skin is soft and a
// little wet. [metalness, roughness, extra MeshPhysicalMaterial settings]
const FINISH = {
  metal: [1, .45], chrome: [1, .06], aluminum: [1, .35], gold: [1, .3], copper: [1, .35],
  plastic: [0, .45], paint: [0, .32, { clearcoat: .8, clearcoatRoughness: .12 }], rubber: [0, .85], wood: [0, .6],
  glass: [0, .03, { transmission: .96, ior: 1.45, thickness: .25 }], water: [0, .02, { transmission: .94, ior: 1.33, thickness: .4 }],
  skin: [0, .48, { clearcoat: .35, clearcoatRoughness: .4, sheen: .4, sheenRoughness: .6 }], fabric: [0, .92, { sheen: .8, sheenRoughness: .8 }],
  stone: [0, .9], ceramic: [0, .22, { clearcoat: .5, clearcoatRoughness: .1 }],
};
const FINISHES = Object.keys(FINISH);
// (v320) a part the AI did not say the material of: its name usually tells (a turbine is metal, a lens glass, a tyre rubber)
const GUESS = [
  ['glass', /\b(glass|window|windscreen|windshield|lens|screen|bulb|jar|bottle|cornea)\b/i],
  ['water', /\b(water|ocean|sea|lake|river|tank of water)\b/i],
  ['rubber', /\b(tyres?|tires?|rubber|belt|hose|gasket|seal|grip|sole)\b/i],
  ['chrome', /\b(chrome|mirror|exhaust pipe|faucet|tap)\b/i],
  ['copper', /\b(copper|wire|wiring|coil|winding)\b/i],
  ['skin', /\b(heart|lungs?|brain|kidneys?|liver|stomach|intestines?|muscles?|skin|tongue|eye|organ|tissue|cells?|nucleus|membrane|cytoplasm|mitochondri\w*|blood|vein|artery|aorta|ventricle|atri\w*|leaf|leaves|petal|stem|root|fruit|flesh)\b/i],
  ['metal', /\b(engine|motor|turbine|fan|compressor|rotor|shaft|axle|gears?|cog|chain|crank|piston|cylinder block|bolts?|nuts?|screws?|spring|frame|blade|nozzle|pump|valve|pipe|rail|steel|iron|metal|magnet)\b/i],
  ['wood', /\b(wood|wooden|table|plank|log|trunk|bark)\b/i],
  ['stone', /\b(rock|stone|crust|mantle|mountain|cliff|concrete|brick|wall)\b/i],
  ['fabric', /\b(cloth|fabric|sail|seat cushion|cushion|rope|net)\b/i],
];
const guessFinish = (name) => { const hit = GUESS.find(([, re]) => re.test(name)); return hit ? hit[0] : null; };
function kindOf(x, mode) {
  const known = mode === '3d' ? KINDS3 : KINDS2;
  const said = String(x.t || x.type || x.shape || x.kind || '').toLowerCase();
  if (known.includes(said)) return said;
  const flag = known.find((k) => x[k] === true || x[k] === 'true'); // ({"lathe": true})
  if (flag) return flag;
  if (mode === '3d') {
    if (Array.isArray(x.profile)) return 'lathe';
    if (Array.isArray(x.outline)) return 'plate';
    if (Array.isArray(x.pts)) return 'pipe';
    if (Array.isArray(x.size)) return 'box';
    if (has(x, 'hub') || ((has(x, 'n') || has(x, 'count')) && has(x, 'len'))) return 'blades';
    if (has(x, 'tube')) return 'torus';
    if (has(x, 'r') && (has(x, 'len') || has(x, 'h'))) return 'cylinder';
    if (has(x, 'r')) return 'sphere';
    return said;
  }
  if (typeof x.d === 'string') return 'path';
  if (Array.isArray(x.pts)) return 'poly';
  if (has(x, 'x1') && has(x, 'y2')) return 'line';
  if (has(x, 'rx') && has(x, 'ry')) return 'ellipse';
  if (has(x, 'cx') && has(x, 'r')) return 'circle';
  if (has(x, 'x') && has(x, 'y') && (has(x, 'w') || has(x, 'width'))) return 'rect';
  if (has(x, 'text')) return 'text';
  return said;
}
const box4 = (b) => (Array.isArray(b) && b.length === 4 ? [num(b[0], 0, 400), num(b[1], 0, 260), num(b[2], 4, 400, 60), num(b[3], 4, 260, 40)] : null);
// (v310) a reply that was cut off (a long drawing can run past the answer's length): every whole part is kept, with
// the title, mode and words that came before them, so she still draws what she finished instead of showing code
function closeOf(t, i) { // the index of the } that closes the { at i (strings and their escapes skipped), or -1
  let depth = 0, inStr = false;
  for (let k = i; k < t.length; k++) {
    const c = t[k];
    if (inStr) { if (c === '\\') k++; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true; else if (c === '{' || c === '[') depth++; else if (c === '}' || c === ']') { depth--; if (depth === 0) return k; }
  }
  return -1;
}
export function salvage(text) {
  const t = String(text || '').replace(/```(?:json|cassie-draw)?/gi, ''), i = t.indexOf('{');
  if (i < 0) return null;
  const j = closeOf(t, i);
  if (j > 0) { try { return JSON.parse(t.slice(i, j + 1)); } catch (e) { /* whole parts are picked out below */ } }
  const at = t.search(/"parts"\s*:\s*\[/);
  if (at < 0) return null;
  const parts = [];
  for (let k = t.indexOf('[', at) + 1; k < t.length;) {
    while (k < t.length && /[\s,]/.test(t[k])) k++;
    if (t[k] !== '{') break;
    const e = closeOf(t, k);
    if (e < 0) break;
    try { parts.push(JSON.parse(t.slice(k, e + 1))); } catch (err) { break; }
    k = e + 1;
  }
  if (!parts.length) return null;
  const word = (key) => { const m = t.slice(0, at).match(new RegExp('"' + key + '"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"')); try { return m ? JSON.parse('"' + m[1] + '"') : ''; } catch (e) { return ''; } };
  const next = (() => { const m = t.slice(0, at).match(/"next"\s*:\s*(\[[^\]]*\])/); try { return m ? JSON.parse(m[1]) : undefined; } catch (e) { return undefined; } })();
  return { title: word('title'), mode: word('mode') === '3d' ? '3d' : '2d', axis: word('axis'), layout: word('layout'), intro: word('intro'), summary: word('summary'), photo: word('photo'), ...(next ? { next } : {}), parts, cut: true };
}
export function clean(raw) {
  let s = raw;
  if (typeof s === 'string') { s = salvage(s); if (!s) return null; }
  if (!s || typeof s !== 'object' || !Array.isArray(s.parts)) return null;
  const mode = s.mode === '3d' ? '3d' : '2d';
  const parts = s.parts.slice(0, 12).map((p, i) => ({ // (v310: 12, so a full bicycle keeps its brakes)
    id: words(p && p.id, 40) || 'p' + i,
    label: words(p && p.label, 40),
    say: words(p && p.say, 360),
    color: color(p && p.color, i),
    box: mode === '2d' ? box4(p && p.box) : null,
    anchor: mode === '2d' && Array.isArray(p && p.anchor) && p.anchor.length === 2 && Number.isFinite(+p.anchor[0]) && Number.isFinite(+p.anchor[1]) ? [num(p.anchor[0], 0, 400), num(p.anchor[1], 0, 260)] : null,
    glow: !!(p && p.glow), spin: !!(p && p.spin), shell: !!(p && p.shell),
    beat: p && p.beat === 'breathe' ? 'breathe' : p && p.beat ? 'beat' : null, // (v314) a part that pumps (a heart) or breathes (lungs)
    finish: FINISHES.includes(p && p.finish) ? p.finish : mode === '3d' ? guessFinish(`${p && p.label || ''} ${p && p.id || ''}`) : null, // (3d) what it is really made of (v320: the Blender skills' real material values; unsaid, guessed from its name)
    // (3d) her plan for the part: what it sits inside, its real size against the whole, what it touches
    inside: mode === '3d' ? words(p && p.inside, 40) || null : null,
    size: mode === '3d' && Number.isFinite(+(p && p.size)) && +p.size > 0 ? Math.min(1, +p.size) : null,
    attached: mode === '3d' && Array.isArray(p && p.attached) ? p.attached.slice(0, 6).map((x) => words(x, 40)).filter(Boolean) : [],
    // (3d, for something that is put together) where the part starts before it slides into its place, as an offset; and the side to look from
    from: mode === '3d' && Array.isArray(p && p.from) && p.from.length === 3 && p.from.every((v) => Number.isFinite(+v)) ? p.from.map((v) => num(v, -12, 12)) : null,
    view: mode === '3d' && ['front', 'back', 'left', 'right', 'side', 'top'].includes(p && p.view) ? p.view : null,
    shapes: (Array.isArray(p && p.shapes) ? p.shapes : []).slice(0, mode === '3d' ? 8 : 24).filter((x) => x && typeof x === 'object').map((x) => ({ ...x, t: kindOf(x, mode) })),
  })).filter((p) => p.shapes.length);
  if (!parts.length) return null;
  const ref = s.ref && typeof s.ref === 'object' && /^https:\/\//.test(String(s.ref.url || '')) ? { text: words(s.ref.text, 160), url: String(s.ref.url).slice(0, 400) } : null;
  // (v306) an answer to a follow-up: the parts it added or changed are drawn; the rest is shown at once; focus is picked out
  const ids = new Set(parts.map((p) => p.id));
  const fresh = Array.isArray(s.fresh) ? s.fresh.map((x) => words(x, 40)).filter((x) => ids.has(x)) : null;
  const focus = ids.has(words(s.focus, 40)) ? words(s.focus, 40) : null;
  // (v307) the questions a student could ask next about it, for one tap each: the lesson goes on, on the same drawing
  const next = (Array.isArray(s.next) ? s.next : []).slice(0, 3).map((x) => words(x, 90).replace(/^[-*\d.\s]+/, '')).filter((x) => x.length > 8);
  // (v314) what moves along the drawing: blood, water, air, food, electricity; dots that travel its path, in order,
  // changing colour from "color" to "to" on the way (blood picking up oxygen); "part" is the step it belongs to
  const hex = (c) => (typeof c === 'string' && /^#[0-9a-f]{3,8}$/i.test(c.trim()) ? color(c, 0) : null);
  const flows = (Array.isArray(s.flows) ? s.flows : []).slice(0, 12).map((f) => {
    if (!f || typeof f !== 'object') return null;
    const of = (Array.isArray(f.part) ? f.part : [f.part]).slice(0, 4).map((x) => words(x, 40)).filter((x) => ids.has(x)), part = of[0] || null;
    const base = { part, of, color: hex(f.color) || (part ? parts.find((q) => q.id === part).color : color(null, 0)), to: hex(f.to), dots: Math.round(num(f.dots, 2, 14, 6)), speed: num(f.speed, 0.3, 3, 1) };
    if (mode === '2d') return typeof f.d === 'string' && f.d.length < 600 && PATH_OK.test(f.d) && /^\s*M/i.test(f.d) ? { ...base, d: f.d } : null;
    const pts = (Array.isArray(f.pts) ? f.pts : []).slice(0, 16).filter((q) => Array.isArray(q) && q.length === 3 && q.every((v) => Number.isFinite(+v))).map((q) => q.map((v) => num(v, -20, 20)));
    return pts.length >= 2 ? { ...base, pts } : null;
  }).filter(Boolean);
  const glb = mode === '3d' && typeof s.glb === 'string' && /^models\/[\w-]{1,40}\.glb$/.test(s.glb) ? s.glb : null; // (v320: a Blender model from the drawing book, only from Cassie's own folder)
  return { ...(glb ? { glb } : {}), ...(next.length ? { next } : {}), ...(flows.length ? { flows } : {}), title: words(s.title, 90) || 'How it works', mode, intro: words(s.intro, 300), summary: words(s.summary, 300), photo: words(s.photo, 300), simple: !!s.simple, axis: ['x', 'y', 'z'].includes(s.axis) ? s.axis : 'x', parts, ref, ...(fresh ? { fresh } : {}), ...(focus ? { focus } : {}) };
}

// ---------- is it a good drawing? (2d) the points every shape reaches, and what is wrong ----------
function shapePoints(sh) {
  const t = String(sh.t || sh.type || '').toLowerCase(), n = (k) => +sh[k];
  if (t === 'path' && typeof sh.d === 'string') { const v = (sh.d.match(/-?\d*\.?\d+/g) || []).map(Number); const out = []; for (let k = 0; k + 1 < v.length; k += 2) out.push([v[k], v[k + 1]]); return /[mlhvcsqta]/.test(sh.d.replace(/z/gi, '')) ? out.slice(0, 1) : out; }
  if (t === 'line' || t === 'arrow') return [[n('x1'), n('y1')], [n('x2'), n('y2')]];
  if (t === 'rect') { const w = +(sh.w2 ?? sh.width ?? sh.wd), h = n('h'); return [[n('x'), n('y')], [n('x') + w, n('y') + h]]; }
  if (t === 'circle') return [[n('cx') - n('r'), n('cy') - n('r')], [n('cx') + n('r'), n('cy') + n('r')]];
  if (t === 'ellipse') return [[n('cx') - n('rx'), n('cy') - n('ry')], [n('cx') + n('rx'), n('cy') + n('ry')]];
  if (t === 'poly' && Array.isArray(sh.pts)) return sh.pts.map((q) => [+(q && q[0]), +(q && q[1])]);
  if (t === 'text') return [[n('x'), n('y')]];
  if (KIT.includes(t)) return kitBox(sh); // (v324)
  return [];
}
// (v305) living things and creatures: one body whose parts touch; what is not part of the body is left out of that check
const CREATURE = /\b(animals?|dragons?|dinosaurs?|creatures?|monsters?|unicorns?|horses?|dogs?|cats?|lions?|tigers?|bears?|birds?|eagles?|owls?|chickens?|ducks?|fish|sharks?|whales?|dolphins?|frogs?|toads?|snakes?|lizards?|turtles?|crocodiles?|insects?|ants?|bees?|butterfl\w*|spiders?|cows?|goats?|pigs?|carabaos?|monkeys?|elephants?|giraffes?|deer|rabbits?|mice|mouse|bats?|people|person|human body|hayop|aso|pusa|ibon|isda)\b/i;
const NOT_BODY = /\b(fire|flames?|breath|smoke|ground|floor|grass|branch|rock|water|air|sky|cloud|spots?|stripes?|scales?|pattern|whiskers?|shadow|arrows?|path|nest|food|egg)\b/i;
const LIMB = /\b(legs?|arms?|limbs?|tails?|necks?|paws?|feet|foot|claws?|tentacles?)\b/i;
// (v305) points along a shape's outline, close enough together to measure the gap between two parts
function outlinePoints(sh) {
  const t = String(sh.t || '').toLowerCase(), n = (k) => +sh[k];
  if (t === 'circle' || t === 'ellipse') { const rx = t === 'circle' ? n('r') : n('rx'), ry = t === 'circle' ? n('r') : n('ry'); return Array.from({ length: 24 }, (_, k) => [n('cx') + rx * Math.cos(k * Math.PI / 12), n('cy') + ry * Math.sin(k * Math.PI / 12)]); }
  const pts = shapePoints(sh), out = [];
  for (let k = 0; k < pts.length; k++) { out.push(pts[k]); const q = pts[k + 1]; if (q) { const steps = Math.min(12, Math.ceil(Math.hypot(q[0] - pts[k][0], q[1] - pts[k][1]) / 10)); for (let j = 1; j < steps; j++) out.push([pts[k][0] + (q[0] - pts[k][0]) * j / steps, pts[k][1] + (q[1] - pts[k][1]) * j / steps]); } }
  if (t === 'rect' && out.length >= 2) { const [a, b] = [out[0], out[out.length - 1]]; return [[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]], [(a[0] + b[0]) / 2, a[1]], [(a[0] + b[0]) / 2, b[1]], [a[0], (a[1] + b[1]) / 2], [b[0], (a[1] + b[1]) / 2]]; }
  return out;
}
// (round by nature: a plain circle is the real shape)
const ROUND_THINGS = /\b(?:sun|moon|star|planet|earth|ball|atom|nucleus|drop|droplet|bubble|molecule|wheel|coin|pupil|egg|cell\s+membrane|o2|co2|h2o|ion|electron|proton|neutron)s?\b/i;
// the box of a part's main shape: the shape its anchor sits in, else its first shape
function shapeOf(p) {
  const boxes = p.shapes.map((sh) => { const pts = shapePoints(sh).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y)); if (!pts.length) return null; const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; });
  if (p.anchor) { const hit = boxes.find((b) => b && p.anchor[0] >= b[0] - 6 && p.anchor[0] <= b[2] + 6 && p.anchor[1] >= b[1] - 6 && p.anchor[1] <= b[3] + 6); if (hit) return hit; }
  return boxes.find(Boolean) || null;
}
// (v280) a heart drawn as the valentine symbol: an outline with a dip at the top in the middle, a lobe each side, and
// its lowest point in the middle. A real heart is a muscle shaped like a rounded cone, with its point down and to the left.
function valentine(sh) {
  if (String(sh.t || sh.type || '').toLowerCase() !== 'path') return false;
  const pts = shapePoints(sh).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  if (pts.length < 6) return false;
  const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys), w = x1 - x0, h = y1 - y0, cx = (x0 + x1) / 2;
  if (w < 40 || h < 40) return false;
  const low = pts.find((q) => q[1] === y1);
  if (Math.abs(low[0] - cx) > w * .12) return false;
  return pts.some(([x, y]) => Math.abs(x - cx) < w * .08 && y - y0 > h * .06 && y - y0 < h * .4 && pts.some((q) => q[0] < x - w * .15 && q[1] < y - h * .04) && pts.some((q) => q[0] > x + w * .15 && q[1] < y - h * .04));
}
// (v290) the parts a textbook figure of a common subject always shows. A drawing that leaves one out is sent back
// with the names it is missing. A part counts when its name is a label, is said, or is written on the picture.
const MUST = [
  { is: /\b(bicycles?|bikes?|cycling)\b/i, not: /\b(motor ?bike|motorcycle|e-?bike motor)\b/i, what: 'a bicycle', need: [['frame'], ['wheel', 'tyre', 'tire'], ['saddle', 'seat'], ['handlebar'], ['pedal'], ['crank'], ['chain\\b'], ['chainring', 'front gear', 'front sprocket', 'chain ring'], ['rear gear', 'rear sprocket', 'cog', 'cassette', 'freewheel'], ['fork'], ['brake']] },
  { is: /\b(heart|hearts|puso)\b/i, not: /\b(valentine|symbol|emoji|love|card|heartbeat on|heart rate)\b/i, what: 'the heart', need: [['right atrium'], ['left atrium'], ['right ventricle'], ['left ventricle'], ['aorta'], ['pulmonary'], ['vena cava'], ['valve'], ['septum']] },
  { is: /\bwater cycle\b|\bhydrologic(al)? cycle\b|\bsiklo ng tubig\b/i, what: 'the water cycle', need: [['sun'], ['evaporat'], ['condens', 'cloud'], ['precipitat', 'rain', 'snow'], ['runoff', 'run off', 'river', 'collection', 'collects'], ['ocean', 'sea', 'lake']] },
  { is: /\bphotosynthesis\b|\bpotosintesis\b/i, what: 'photosynthesis', need: [['sun', 'light'], ['carbon dioxide', 'co2'], ['water', 'h2o'], ['oxygen', 'o2'], ['glucose', 'sugar'], ['chloroplast', 'chlorophyll'], ['stomata', 'stoma'], ['root']] },
  { is: /\bplant cells?\b/i, what: 'a plant cell', need: [['cell wall'], ['membrane'], ['nucleus'], ['cytoplasm'], ['chloroplast'], ['vacuole'], ['mitochondri']] },
  { is: /\banimal cells?\b|\bhuman cells?\b/i, what: 'an animal cell', need: [['membrane'], ['nucleus'], ['cytoplasm'], ['mitochondri'], ['ribosome'], ['golgi'], ['endoplasmic', 'er\\b']] },
  { is: /\bvolcano(es)?\b|\bbulkan\b/i, what: 'a volcano', need: [['magma chamber', 'magma'], ['vent', 'conduit'], ['crater'], ['lava'], ['ash', 'gas'], ['layer', 'crust', 'rock']] },
  { is: /\b(parts of a tree|trees?|puno ng kahoy)\b/i, not: /\b(family|decision|binary|phylogenetic|christmas|syntax|search|tree (diagram|map|chart))\s*trees?\b|\btree (diagram|map|chart)s?\b/i, what: 'a tree', need: [['leaves', 'leaf', 'crown'], ['branch'], ['trunk'], ['root']] }, // (v324)
  { is: /\bflowers?\b|\bbulaklak\b/i, not: /\bflower ?pot\b/i, what: 'a flower', need: [['petal'], ['sepal'], ['stamen', 'anther', 'filament'], ['pistil', 'carpel', 'stigma'], ['ovary'], ['stem', 'receptacle']] },
  { is: /\b(lungs?|respiratory system|breathing)\b|\bbaga\b/i, what: 'the lungs', need: [['trachea', 'windpipe'], ['bronch'], ['lung'], ['alveol', 'air sac'], ['diaphragm']] },
  { is: /\b(human )?eyes?\b(?! ?(drop|glass|liner|shadow))|\bmata\b/i, not: /\b(eye of the storm|hurricane|needle)\b/i, what: 'the eye', need: [['cornea'], ['iris'], ['pupil'], ['lens'], ['retina'], ['optic nerve']] },
  { is: /\bdigestive (system|tract)\b|\bdigestion\b/i, what: 'the digestive system', need: [['mouth'], ['oesophagus', 'esophagus', 'food pipe'], ['stomach'], ['liver'], ['small intestine'], ['large intestine', 'colon']] },
  { is: /\b(electric(al)? )?circuits?\b/i, not: /\bcircuit training\b/i, what: 'a circuit', need: [['battery', 'cell', 'power'], ['wire'], ['switch'], ['bulb', 'lamp', 'resistor', 'load'], ['current']] },
  { is: /\batoms?\b|\batomic structure\b/i, not: /\batomic bomb\b/i, what: 'an atom', need: [['nucleus'], ['proton'], ['neutron'], ['electron'], ['shell', 'orbit', 'cloud']] },
  { is: /\bsolar system\b/i, what: 'the solar system', need: [['sun'], ['mercury'], ['venus'], ['earth'], ['mars'], ['jupiter'], ['saturn'], ['uranus'], ['neptune'], ['orbit']] },
  { is: /\b(layers of the earth|earth'?s layers|inside the earth|earth'?s interior|structure of the earth)\b/i, what: 'the Earth', need: [['crust'], ['mantle'], ['outer core'], ['inner core']] },
  { is: /\b(tooth|teeth|ngipin)\b/i, what: 'a tooth', need: [['enamel'], ['dentin'], ['pulp'], ['root'], ['gum']] },
];
// (v303) the parts a textbook figure of what was asked about shows, told to her before she draws, so her first
// drawing has them all (a drawing sent back for a missing part costs the student a second wait)
// (v311) a question about a PROCESS (steps that happen in order: how we feel emotions, how a refrigerator keeps food cold,
// digestion, a cycle) is drawn as a flow, each step a small picture joined to the next by an arrow, never as a map of
// parts or a 3D box (a thing, like a bicycle or the heart's parts, is still drawn as the thing)
const PROCESS = /\b(emotions?|feelings?|feel\s+(emotions?|feelings?|sad|happy|angry|afraid|scared|fear)|cycles?|process(es)?|steps?\s+(of|in|to)|stages?\s+(of|in)|life\s*cycle|phases?\s+of|refrigerat\w*|fridges?|air\s*con\w*|heat\s+pumps?|digest(ion|s|ed)?|circulat(ion|es)|respiration|breath(e|ing)\s+works?|photosynthesis|mitosis|meiosis|fermentation|evaporat\w*|condensation|erosion|weathering|fertili[sz]ation|pollination|germination|metamorphosis|food\s+(chain|web)|supply\s+chain|how\s+(a\s+)?bill\s+becomes|elections?|immune\s+response|nerve\s+signals?|reflex(es)?|how\s+(is|are)\s+\w+(\s+\w+)?\s+(made|formed|produced)|how\s+(do|does|did)\s+[\w\s]{1,30}\s+(form|happen|grow|spread|develop|change))\b/i;
export const isProcess = (asked = '') => PROCESS.test(String(asked || ''));
export const PROCESS_NOTE = 'This is a PROCESS, so draw it as a flow, never as a map of parts or a box: one part for each step, in the order it happens, left to right (or round a loop for a cycle), each a small real picture of what happens at that step (a nose smelling, a heart beating fast, a coil giving off heat), never a plain box, and each joined to the next step by an arrow. Its "say" tells what happens at that step and what it leads to. Colour the steps by what they are (hot red, cold blue, signals yellow).';
export function mustHave(asked = '') {
  const about = String(asked || '');
  const rule = MUST.find((r) => r.is.test(about) && !(r.not && r.not.test(about)));
  return rule ? { what: rule.what, parts: rule.need.map((alts) => alts[0].replace(/\\b/g, '')) } : null;
}
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function missingParts(spec, asked) {
  const about = `${spec.title} ${asked || ''}`;
  const rule = MUST.find((r) => r.is.test(about) && !(r.not && r.not.test(about)));
  if (!rule) return null;
  const said = spec.parts.map((p) => `${p.label} ${p.id} ${p.say} ${p.shapes.map((sh) => (sh && sh.text) || '').join(' ')}`).join(' ').toLowerCase();
  const said2 = `${said} ${spec.intro || ''} ${spec.summary || ''}`.toLowerCase();
  const gone = rule.need.filter((alts) => !alts.some((a) => new RegExp(`\\b${a.includes('\\b') ? a : esc(a)}`, 'i').test(said2)));
  return gone.length ? { what: rule.what, gone: gone.map((alts) => alts[0].replace(/\\b/g, '')) } : null;
}
// (v290) an arrow that says "falls" must point down, and one that says "rises" must point up
const FALLS = /\b(falls?|falling|rain|precipitat|sinks?|sinking|drops? down|downward|flows? down|gravity|weight)\b/i;
const RISES = /\b(rises?|rising|evaporat|transpir|goes up|upward|lifts?|lift|floats? up|buoyan)\b/i;
function wrongWay(p) {
  const arrows = p.shapes.filter((sh) => String(sh.t || sh.type || '').toLowerCase() === 'arrow').map((sh) => +sh.y2 - +sh.y1).filter((dy) => Number.isFinite(dy) && Math.abs(dy) > 6);
  if (!arrows.length) return '';
  const name = `${p.label} ${p.id}`, words_ = `${name} ${p.say}`;
  const down = FALLS.test(name) || (FALLS.test(words_) && !RISES.test(words_)), up = RISES.test(name) || (RISES.test(words_) && !FALLS.test(words_));
  if (down && !up && arrows.every((dy) => dy < 0)) return `"${p.label || p.id}" says it goes down, but its arrows point up; turn them round so their heads are lower than their tails (y2 bigger than y1)`;
  if (up && !down && arrows.every((dy) => dy > 0)) return `"${p.label || p.id}" says it goes up, but its arrows point down; turn them round so their heads are higher than their tails (y2 smaller than y1)`;
  return '';
}
// (v325) the box a part of a 3D model fills [x0, y0, z0, x1, y1, z1] (to check where things are)
// ---------- (v326) Cassie's vehicle guide: what each vehicle looks like from every side, how it works, and where its parts are ----------
// Told to her before she draws or builds one, so the parts are in their real places, the right way round, and her
// words and drawing explain the same thing. kind: the vehicle kit's kind to draw it with.
const VEHICLES = [
  { is: /\b(cars?|sedans?|automobiles?|kotse|sasakyan)\b/i, kind: 'sedan', what: 'a car', views: 'side: long and low, hood in front, cabin in the middle with front and back side windows, trunk at the back, two wheels a side under arches; front: two headlights either side of the grille, the windshield above, mirrors on the doors; back: two red tail lights, the plate in the middle; top: a long rounded box, glass in the middle, the hood longer than the trunk', works: 'The engine under the hood burns petrol in its cylinders; the pistons turn the crankshaft; the gearbox and the drive shaft carry the turning to the wheels. The steering wheel turns the front wheels; the brakes press pads on discs in each wheel; the fuel tank sits under the back seat; the battery starts it.', parts: ['engine (front, under the hood)', 'gearbox', 'drive shaft', 'wheels and tyres', 'brakes (inside each wheel)', 'steering wheel', 'fuel tank (under the back)', 'battery', 'exhaust (out the back)', 'headlights and tail lights'] },
  { is: /\b(electric cars?|evs?|teslas?|electric vehicles?)\b/i, kind: 'sedan', what: 'an electric car', views: 'like a car, but often with no grille in front', works: 'A big flat battery pack under the floor stores the energy; an electric motor at an axle turns the wheels directly; braking turns the motor into a generator that puts energy back into the battery (regenerative braking). It is charged from a plug in the side.', parts: ['battery pack (flat, under the whole floor)', 'electric motor (at the axle)', 'inverter', 'charging port (on the side)', 'wheels', 'brakes'] },
  { is: /\b(sports cars?|race cars?|racing cars?|supercars?)\b/i, kind: 'sports', what: 'a sports car', views: 'side: very low and long, a short sloping cabin set back, big wheels close to the corners; front: low and wide, sharp headlights, big air intakes; back: wide, a spoiler, twin exhausts', works: 'A powerful engine (often behind the seats) and a light body; the low, wide shape and the spoiler push it down onto the road (downforce) so it grips in fast corners.', parts: ['engine (often behind the seats)', 'air intakes', 'spoiler', 'wide tyres', 'brakes', 'low body'] },
  { is: /\b(suvs?|jeeps?)\b/i, kind: 'suv', what: 'an SUV', views: 'side: tall and boxy, a long flat roof, big wheels, high off the ground; front: upright grille and headlights; back: a tall upright tailgate', works: 'Like a car but taller, with more room; many drive all four wheels (4WD) so it climbs rough or slippery ground.', parts: ['engine', 'four wheel drive', 'high suspension', 'tall body', 'tailgate'] },
  { is: /\b(pickups?|pickup trucks?|pick-ups?)\b/i, kind: 'pickup', what: 'a pickup truck', views: 'side: a cab with two doors in front and an open flat bed at the back; front: tall grille; back: the tailgate of the bed', works: 'An engine and cab in front, an open cargo bed behind on a strong frame, to carry heavy loads.', parts: ['engine', 'cab', 'cargo bed', 'tailgate', 'strong frame', 'wheels'] },
  { is: /\b(vans?|minivans?)\b/i, kind: 'van', what: 'a van', views: 'side: one tall box from front to back, a short nose, a sliding side door; back: two tall doors', works: 'An engine under a short nose and a tall box body to carry people or goods.', parts: ['engine', 'cab', 'sliding door', 'cargo space', 'back doors', 'wheels'] },
  { is: /\b(taxis?|cabs?)\b/i, kind: 'taxi', what: 'a taxi', views: 'a car painted yellow with a lit sign on the roof and a checker stripe', works: 'A car for hire: a meter counts the distance and time to work out the fare.', parts: ['roof sign', 'meter', 'engine', 'wheels', 'doors'] },
  { is: /\b(police cars?|patrol cars?)\b/i, kind: 'police', what: 'a police car', views: 'a car with a light bar on the roof (red and blue), the word POLICE and stripes on the doors', works: 'A car with flashing lights and a siren so other drivers let it pass, and a radio to talk to the station.', parts: ['light bar', 'siren', 'radio', 'engine', 'wheels'] },
  { is: /\b(ambulances?)\b/i, kind: 'ambulance', what: 'an ambulance', views: 'side: a tall white van with a red stripe and a red cross; back: two doors that open to load a stretcher', works: 'A van with flashing lights and a siren, carrying a stretcher, oxygen and medicine so paramedics treat the patient on the way to hospital.', parts: ['flashing lights and siren', 'stretcher', 'oxygen', 'back doors', 'engine'] },
  { is: /\b(buses|bus|bus driver|jeepneys?)\b/i, kind: 'bus', what: 'a bus', views: 'side: a long tall box with a row of windows, a door near the front; front: a big flat windshield and the route sign above it; back: the engine cover', works: 'A long body on a strong frame carries many people; a big diesel or electric motor (often at the back) drives the back wheels.', parts: ['engine (at the back)', 'driver\'s seat', 'doors', 'windows', 'route sign', 'wheels'] },
  { is: /\b(school ?bus(es)?)\b/i, kind: 'schoolbus', what: 'a school bus', views: 'side: long and yellow with a short hood in front, a row of windows, a black stripe; front: the hood and a big windshield', works: 'Like a bus, yellow so it is seen; red lights and a stop arm tell cars to stop while children get on and off.', parts: ['engine (in the hood)', 'stop arm', 'seats', 'door', 'windows', 'wheels'] },
  { is: /\b(trucks?|lorr(y|ies)|delivery trucks?|trak)\b/i, kind: 'truck', what: 'a truck', views: 'side: a cab in front and a big box behind, extra wheels at the back for the weight; front: the tall cab with a big grille', works: 'A diesel engine under the cab drives the back wheels; the cargo box sits on a long frame; more axles share the heavy load.', parts: ['diesel engine (under the cab)', 'cab', 'cargo box', 'frame', 'back axles', 'wheels'] },
  { is: /\b(dump ?trucks?|tipper trucks?)\b/i, kind: 'dumptruck', what: 'a dump truck', views: 'side: a cab in front and an open steel bed behind that tips up', works: 'A hydraulic ram (a strong piston pushed by oil) lifts the front of the bed so the load slides out at the back.', parts: ['cab', 'tipping bed', 'hydraulic ram', 'engine', 'wheels'] },
  { is: /\b(fire ?trucks?|fire ?engines?)\b/i, kind: 'firetruck', what: 'a fire truck', views: 'side: long and red, a ladder on top, lockers along the side, the cab in front', works: 'A pump driven by the engine pushes water from its tank (or a hydrant) through the hoses; the ladder lifts up and out to reach high windows.', parts: ['ladder', 'water pump', 'water tank', 'hoses', 'lockers', 'cab', 'lights and siren'] },
  { is: /\b(tractors?|traktora)\b/i, kind: 'tractor', what: 'a tractor', views: 'side: huge back wheels, small front wheels, the cab over the back wheels, the engine in front', works: 'A strong slow engine; the big deep-treaded back wheels grip soft soil to pull ploughs and trailers.', parts: ['engine', 'cab', 'big back wheels', 'small front wheels', 'hitch (at the back)'] },
  { is: /\b(excavators?|diggers?|backhoes?)\b/i, kind: 'excavator', what: 'an excavator', views: 'side: tracks at the bottom, a turning cab on them, a long arm (boom and stick) and a bucket in front', works: 'Hydraulic rams move the boom, the stick and the bucket; the cab and arm turn all the way round on the tracks.', parts: ['tracks', 'cab', 'boom', 'stick', 'bucket', 'hydraulic rams'] },
  { is: /\b(bulldozers?|dozers?)\b/i, kind: 'bulldozer', what: 'a bulldozer', views: 'side: tracks, a body with the cab on top, a big flat blade in front', works: 'Tracks spread its weight so it does not sink; hydraulic rams raise and lower the blade to push earth.', parts: ['tracks', 'blade', 'hydraulic rams', 'cab', 'engine'] },
  { is: /\b(trains?|railways?|locomotives?|bullet trains?|tren|lrt|mrt)\b/i, kind: 'train', what: 'a train', views: 'side: long carriages with a row of windows, wheels in pairs on the rails; front: a pointed nose with a windshield and lights', works: 'Electric motors on the axles drive the steel wheels on steel rails; power comes from the overhead wire through the pantograph on the roof (or a diesel engine). Flanges on the wheels keep it on the rails.', parts: ['pantograph (on the roof)', 'electric motors (on the axles)', 'wheels', 'rails', 'carriages', 'driver\'s cab (at the nose)'] },
  { is: /\b(bicycles?|bikes?|bisikleta)\b/i, kind: 'bicycle', what: 'a bicycle', views: 'side: two big wheels, a diamond frame between them, the saddle over the back, the handlebars over the front; front or back: very thin', works: 'Your feet push the pedals round; the cranks turn the chainring; the chain pulls the rear gear, which turns the back wheel. Brakes squeeze the rims; the handlebars steer the front wheel.', parts: ['frame', 'wheels', 'pedals and cranks', 'chainring', 'chain', 'rear gear', 'saddle', 'handlebars', 'brakes'] },
  { is: /\b(motorcycles?|motorbikes?|motorsiklo)\b/i, kind: 'motorcycle', what: 'a motorcycle', views: 'side: two wheels, the engine low between them, the fuel tank above it, the seat behind, handlebars over the front fork', works: 'A small engine between the wheels drives the back wheel by a chain; the rider steers with the handlebars and leans into turns.', parts: ['engine', 'fuel tank', 'chain', 'front fork', 'handlebars', 'seat', 'exhaust'] },
  { is: /\b(scooters?|mopeds?)\b/i, kind: 'scooter', what: 'a scooter', views: 'side: small wheels, a flat floor for the feet, the seat at the back over the engine', works: 'A small engine or motor under the seat drives the back wheel through an automatic belt, so there are no gears to change.', parts: ['engine (under the seat)', 'floorboard', 'seat', 'handlebars', 'small wheels'] },
  { is: /\b(air ?planes?|aero ?planes?|aircraft|jets?|airliners?|eroplano)\b/i, kind: 'airplane', what: 'an airplane', views: 'side: a long tube (fuselage) with a pointed nose, the tail fin standing up at the back, the wing low across the middle with the engines under it; top: a cross, wings sweeping back; front: round fuselage, wings out to each side, engines under them', works: 'Jet engines under the wings push it forward; the curved wings make the air push up (lift) as it moves fast; flaps on the wings, the rudder on the tail fin and the elevators on the tail steer it. It lands on wheels.', parts: ['fuselage', 'wings', 'jet engines (under the wings)', 'tail fin and rudder', 'tailplane and elevators', 'cockpit (in the nose)', 'landing gear'] },
  { is: /\b(helicopters?|choppers?|helikopter)\b/i, kind: 'helicopter', what: 'a helicopter', views: 'side: a round cabin with a big glass front, a long thin tail boom, the main rotor on top, a small rotor on the tail, skids underneath', works: 'The engine spins the long main rotor blades on top; tilting them lifts it straight up and moves it any way. The small tail rotor stops the body spinning the other way.', parts: ['main rotor', 'tail rotor', 'cabin', 'tail boom', 'engine', 'skids'] },
  { is: /\b(drones?)\b/i, kind: 'drone', what: 'a drone', views: 'top: a small body with four arms, a spinning propeller at the end of each', works: 'Four motors spin four propellers; a computer changes each one\'s speed many times a second to hover, climb, tilt and turn. A camera hangs underneath.', parts: ['propellers', 'motors', 'battery', 'flight computer', 'camera'] },
  { is: /\b(rockets?|space ?ships?|raket)\b/i, kind: 'rocket', what: 'a rocket', views: 'standing up: a tall thin tube, a pointed nose cone on top, fins at the bottom, fire from the nozzle', works: 'It burns fuel with oxygen it carries; the hot gas rushes out of the nozzle downward and pushes the rocket up (every action has an equal and opposite reaction). It drops its empty stages to get lighter.', parts: ['nose cone', 'payload', 'fuel tank', 'oxygen tank', 'engine and nozzle', 'fins'] },
  { is: /\b(hot ?air balloons?|balloons?)\b/i, kind: 'balloon', what: 'a hot air balloon', views: 'a huge teardrop envelope on top, a basket hanging under it on ropes, a burner between them', works: 'The burner heats the air inside the envelope; hot air is lighter than the cold air around it, so the balloon rises. Letting it cool brings it down.', parts: ['envelope', 'burner', 'basket', 'ropes'] },
  { is: /\b(boats?|speed ?boats?|yachts?|bangka)\b/i, kind: 'boat', what: 'a boat', views: 'side: a pointed hull in the water, a cabin with a windshield on top; top: pointed at the front, flat at the back', works: 'The hull pushes water aside and the water pushes it up (it floats); an engine at the back turns a propeller under the water that pushes it forward; the rudder steers.', parts: ['hull', 'cabin', 'engine', 'propeller (under the back)', 'rudder'] },
  { is: /\b(ships?|cruise ships?|ferr(y|ies)|barko)\b/i, kind: 'ship', what: 'a ship', views: 'side: a long hull, decks stacked on top with rows of windows, a funnel; front: a sharp bow', works: 'A huge steel hull floats because it pushes aside more water than it weighs; big engines turn propellers at the stern.', parts: ['hull', 'bow', 'stern', 'decks', 'funnel', 'bridge', 'propellers', 'anchor'] },
  { is: /\b(sail ?boats?|sailing (boats?|ships?))\b/i, kind: 'sailboat', what: 'a sailboat', views: 'side: a hull, a tall mast in the middle, a big triangular sail behind it and a smaller one in front', works: 'The wind fills the sails and pushes it along; the keel under the hull stops it sliding sideways; the rudder steers.', parts: ['hull', 'mast', 'mainsail', 'jib', 'keel', 'rudder'] },
  { is: /\b(submarines?)\b/i, kind: 'submarine', what: 'a submarine', views: 'side: a long smooth tube, a tower (the sail) on top, a propeller at the back', works: 'To dive it lets water into its ballast tanks so it is heavier than the water; to rise it blows the water out with air. A propeller at the back pushes it; a periscope looks above the water.', parts: ['hull', 'ballast tanks', 'sail (tower)', 'periscope', 'propeller', 'rudder'] },
];
export function vehicleGuide(asked = '') {
  const q = String(asked || ''), hits = VEHICLES.filter((v) => v.is.test(q)).sort((a, b) => q.match(b.is)[0].length - q.match(a.is)[0].length).slice(0, 2); // (the most exact first: an electric car before a car)
  if (!hits.length) return '';
  return hits.map((v) => `About ${v.what} (draw it with the vehicle kit, kind "${v.kind}"): how it looks: ${v.views}. How it works: ${v.works} Its main parts, each in its real place: ${v.parts.join(', ')}.`).join('\n');
}
export function partBox3(spec, id) { const p = spec && spec.parts.find((q) => q.id === id); const bs = p ? p.shapes.map(box3).filter(Boolean) : []; return bs.length ? join3(bs) : null; }
export function check(spec, asked = '') {
  const out = [];
  if (spec && spec.mode === '3d') return check3d(spec);
  if (!spec || spec.mode !== '2d') return out;
  // (v311) a process: each step joined to the next by an arrow
  if (isProcess(asked) && spec.parts.length >= 3) {
    const arrows = spec.parts.reduce((n, p) => n + p.shapes.filter((x) => String(x.t || '').toLowerCase() === 'arrow').length, 0);
    if (arrows < spec.parts.length - 1) out.push(`this is a process: join each step to the next with an arrow, in the order it happens (${arrows} arrows for ${spec.parts.length} steps now)`);
  }
  const lack = missingParts(spec, asked);
  if (lack) out.push(`a textbook figure of ${lack.what} shows ${lack.gone.length > 1 ? 'these parts' : 'this part'}, and your drawing leaves ${lack.gone.length > 1 ? 'them' : 'it'} out: ${lack.gone.join(', ')}. Draw ${lack.gone.length > 1 ? 'each one' : 'it'} in its real place and shape, and name it (a part of its own, or in the "say" of the part it belongs to)`);
  for (const p of spec.parts) { const w = wrongWay(p); if (w) out.push(w); }
  const boxes = [];
  for (const p of spec.parts) {
    const pts = p.shapes.flatMap(shapePoints).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
    const strokes = p.shapes.filter((x) => String(x.t || x.type).toLowerCase() !== 'text').length;
    if (!pts.length) { out.push(`"${p.label || p.id}" has no shape the picture can show, so its label points at nothing`); continue; }
    if (pts.some(([x, y]) => x < -6 || x > 406 || y < -6 || y > 266)) out.push(`"${p.label || p.id}" goes outside the 400 by 260 picture`);
    const kinds = p.shapes.map((x) => String(x.t || x.type).toLowerCase()), kitted = kinds.some((k) => KIT.includes(k)); // (v324: a kit tree or flower is a whole drawing)
    if (strokes < 2 && !kitted) out.push(`"${p.label || p.id}" is a single line or shape; draw its real outline and inner lines`);
    if (strokes >= 2 && !kitted && !kinds.some((k) => k === 'path' || k === 'poly' || k === 'line' || k === 'arrow') && !ROUND_THINGS.test(p.label || p.id)) out.push(`"${p.label || p.id}" is only plain circles or boxes; draw its real outline with a path (for a leaf: a pointed tip, a midrib and side veins)`);
    if (/\b(heart|hearts|puso)\b/i.test(`${spec.title} ${p.label || p.id}`) && !/\b(valentine|symbol|emoji|love|card)\b/i.test(spec.title) && p.shapes.some(valentine)) out.push(`"${p.label || p.id}" is drawn as a valentine heart symbol, not a real heart. Draw the real organ: a rounded cone shape with its point (the apex) down and to the left, wider at the top; the aorta arching over the top, the pulmonary trunk in front of it, the vena cava coming in on the right; inside, the two small atria at the top and the two larger ventricles below, the left ventricle with the thickest wall`);
    if (p.anchor) { const sh = shapeOf(p); if (sh) { const [x0, y0, x1, y1] = sh; if (p.anchor[0] < x0 - 6 || p.anchor[0] > x1 + 6 || p.anchor[1] < y0 - 6 || p.anchor[1] > y1 + 6) out.push(`the anchor of "${p.label || p.id}" is not on its own main shape`); } }
    const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
    const bb = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    boxes.push(bb);
    if (p.box) { const [bx, by, bw, bh] = p.box, inside = pts.filter(([x, y]) => x >= bx - 12 && x <= bx + bw + 12 && y >= by - 12 && y <= by + bh + 12).length; if (inside < pts.length * .6) out.push(`"${p.label || p.id}" is drawn outside the box its layout gave it`); }
  }
  if (boxes.length >= 2) {
    const ux = Math.max(...boxes.map((b) => b[2])) - Math.min(...boxes.map((b) => b[0])), uy = Math.max(...boxes.map((b) => b[3])) - Math.min(...boxes.map((b) => b[1]));
    if (ux * uy < 400 * 260 * .18) out.push('everything is piled into one small corner; spread the drawing across the picture');
  }
  // (v305) every part has its own name ("Front leg" and "Back leg", never "Leg" twice)
  const names = spec.parts.map((p) => String(p.label || '').trim().toLowerCase()).filter(Boolean);
  const twice = [...new Set(names.filter((n, i) => names.indexOf(n) !== i))];
  if (twice.length) out.push(`these names are used for more than one part: ${twice.join(', ')}; give each part its own name, like "Front leg" and "Back leg"`);
  // (v305) a creature is one body: its parts touch (a head never floats away from its neck), and its legs, arms and tail have thickness
  if (CREATURE.test(`${spec.title} ${asked}`) && !/\bcells?\b|\bcellular\b/i.test(`${spec.title} ${asked}`)) { // (v311: an animal cell is not a creature)
    const own = spec.parts.map((p) => { const pts = p.shapes.flatMap(outlinePoints).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y)); return pts.length ? pts : null; });
    const near = (a, b) => a && b && a.some(([x, y]) => b.some(([u, v]) => Math.abs(x - u) <= 6 && Math.abs(y - v) <= 6 && (x - u) ** 2 + (y - v) ** 2 <= 36));
    spec.parts.forEach((p, i) => {
      const label = p.label || p.id;
      if (NOT_BODY.test(label) || !own[i]) return;
      const body = spec.parts.map((q, j) => (j !== i && !NOT_BODY.test(q.label || q.id) ? own[j] : null)).filter(Boolean);
      if (body.length && !body.some((b) => near(own[i], b))) out.push(`"${label}" floats apart from the body; join it on where it really grows from (a head joins the neck, a wing joins the shoulder)`);
      if (LIMB.test(label) && p.shapes.length > 1 && p.shapes.every((sh) => { const t = String(sh.t || '').toLowerCase(); return t === 'line' || t === 'arrow' || (t === 'path' && !/z/i.test(String(sh.d || ''))); })) out.push(`"${label}" is drawn as thin lines; draw each one as a shape with thickness (an outline that closes), with a joint and a foot or tip`);
    });
  }
  return out;
}

// ---------- is it a good model? (3d) her own plan against the shapes she placed, for any subject ----------
// Each shape's box (roughly, from its size and axis): a part's box is all its shapes; the model's is all parts.
const n3 = (v, d) => (Number.isFinite(+v) ? +v : d);
function box3(s) {
  const t = String(s.t || s.type || '').toLowerCase(), axis = ['x', 'y', 'z'].includes(s.axis) ? s.axis : 'x';
  const pos = Array.isArray(s.pos) ? [0, 1, 2].map((k) => n3(s.pos[k], 0)) : [0, 0, 0];
  const r = Math.abs(n3(s.r, .5)), len = Math.abs(n3(s.len ?? s.h, 1));
  if (KIT3.includes(t)) return kit3Box(s, pos); // (v325)
  let along = 0, across = 0, half = null;
  if (t === 'cylinder' || t === 'tube') { along = len / 2; across = Math.max(r, Math.abs(n3(s.r2, r))); }
  else if (t === 'disc') { along = Math.abs(n3(s.thick ?? s.len, .08)) / 2; across = r; }
  else if (t === 'cone') { along = len / 2; across = r; }
  else if (t === 'torus' || t === 'ring') { const tb = Math.abs(n3(s.tube, .12)); along = tb; across = r + tb; }
  else if (t === 'blades') { along = Math.abs(n3(s.width, .18)) / 2; across = Math.abs(n3(s.hub, .12)) + Math.abs(n3(s.len, r)); }
  else if (t === 'sphere') half = [r, r, r];
  else if (t === 'box') { const sz = Array.isArray(s.size) ? s.size : [1, 1, 1]; half = [0, 1, 2].map((k) => Math.abs(n3(sz[k], 1)) / 2); }
  else if (t === 'capsule') { along = len / 2 + r; across = r; }
  else if (t === 'pipe' || t === 'arrow') { // (a tube through points: the box around them)
    const pts = pts3(s.pts), w = Math.abs(n3(s.r, .06));
    if (pts.length < 2) return null;
    return [0, 1, 2].map((k) => pos[k] + Math.min(...pts.map((q) => q[k])) - w).concat([0, 1, 2].map((k) => pos[k] + Math.max(...pts.map((q) => q[k])) + w));
  } else if (t === 'lathe' || t === 'plate') { // (a turned profile [radius, along]; a flat plate with an outline across its axis)
    const pr = pts2(t === 'lathe' ? s.profile : s.outline);
    if (pr.length < (t === 'lathe' ? 2 : 3)) return null;
    const lo = [Math.min(...pr.map((q) => q[0])), Math.min(...pr.map((q) => q[1]))], hi = [Math.max(...pr.map((q) => q[0])), Math.max(...pr.map((q) => q[1]))];
    const k = { x: 0, y: 1, z: 2 }[axis], b = [0, 0, 0, 0, 0, 0];
    if (t === 'lathe') { [0, 1, 2].forEach((j) => { b[j] = j === k ? lo[1] : -hi[0]; b[j + 3] = j === k ? hi[1] : hi[0]; }); }
    else { const th = Math.abs(n3(s.thick, .1)) / 2, u = axis === 'x' ? 2 : 0, v = axis === 'y' ? 2 : 1; b[k] = -th; b[k + 3] = th; b[u] = lo[0]; b[u + 3] = hi[0]; b[v] = lo[1]; b[v + 3] = hi[1]; }
    return b.map((x, j) => x + pos[j % 3]);
  }
  else return null;
  if (!half) half = ['x', 'y', 'z'].map((a) => (a === axis ? along : across));
  return [pos[0] - half[0], pos[1] - half[1], pos[2] - half[2], pos[0] + half[0], pos[1] + half[1], pos[2] + half[2]];
}
// points the AI wrote, kept only when they are numbers: [[x,y,z],...] (up to 10) and [[a,b],...] (up to 24)
const pts3 = (list) => (Array.isArray(list) ? list : []).slice(0, 10).filter((q) => Array.isArray(q) && q.length === 3 && q.every((v) => Number.isFinite(+v))).map((q) => q.map((v) => num(v, -20, 20)));
const pts2 = (list) => (Array.isArray(list) ? list : []).slice(0, 24).filter((q) => Array.isArray(q) && q.length === 2 && q.every((v) => Number.isFinite(+v))).map((q) => q.map((v) => num(v, -20, 20)));
const join3 = (bs) => bs.reduce((a, b) => (a ? [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2]), Math.max(a[3], b[3]), Math.max(a[4], b[4]), Math.max(a[5], b[5])] : b.slice()), null);
const gap3 = (a, b) => Math.hypot(...[0, 1, 2].map((k) => Math.max(0, a[k] - b[k + 3], b[k] - a[k + 3])));
const long3 = (b) => Math.max(b[3] - b[0], b[4] - b[1], b[5] - b[2]);
export function check3d(spec) {
  const out = [];
  const parts = spec.parts.map((p) => ({ p, b: join3(p.shapes.map(box3).filter(Boolean)) }));
  parts.filter((x) => !x.b).forEach((x) => out.push(`"${x.p.label || x.p.id}" has no 3d shape the model can show`));
  const ok = parts.filter((x) => x.b);
  if (!ok.length) return out;
  const all = join3(ok.map((x) => x.b)), L = long3(all) || 1;
  const name = (x) => `"${x.p.label || x.p.id}"`, byId = (id) => ok.find((x) => x.p.id === id || x.p.label === id);
  if (L > 12 || L < 2) out.push(`the whole model is ${L.toFixed(1)} units long; make it about 6 units, centred on 0,0,0`);
  if (ok.some((x) => x.p.size == null)) out.push('plan every part first: give each part "size" (how big it really is, its longest side, against the whole object, 0 to 1) and "inside" (the id of the part it sits in, or null)');
  for (const x of ok) {
    const others = ok.filter((y) => y !== x);
    // nothing floats: every part touches or sits in another part
    const sky = x.p.shapes.every((sh) => /^(cloud|sun|moon|rainbow|snowflake|bolt|drops)$/.test(String(sh.t || '').toLowerCase())); // (v325: the sky's things float, as they really do)
    if (!sky && others.length && Math.min(...others.map((y) => gap3(x.b, y.b))) > L * .08) out.push(`${name(x)} floats apart from the rest; in the real object it touches or sits inside the part it connects to, so move it there`);
    // inside what she said it is inside
    const home = x.p.inside && byId(x.p.inside);
    if (home && home !== x) { const pad = L * .04, b = x.b, h = home.b; if (b[0] < h[0] - pad || b[1] < h[1] - pad || b[2] < h[2] - pad || b[3] > h[3] + pad || b[4] > h[4] + pad || b[5] > h[5] + pad) out.push(`${name(x)} should sit inside ${name(home)} (your plan says so) but it sticks out of it; make it smaller or move it in`); }
    // as big as she planned
    if (x.p.size != null) { const real = long3(x.b) / L, want = x.p.size; if (real > want * 1.8 + .06 || real < want / 1.8 - .06) out.push(`${name(x)} is drawn at ${Math.round(real * 100)}% of the whole object's size, but your plan says ${Math.round(want * 100)}%; give it its real size`); }
    // touching what she said it is attached to
    for (const id of x.p.attached) { const y = byId(id); if (y && y !== x && gap3(x.b, y.b) > L * .05) out.push(`${name(x)} should touch ${name(y)} but there is a gap between them`); }
    // (v283) facing the right way: a wheel turns on an axle across the vehicle, never lying flat or facing along it;
    // the blades of a compressor, turbine or propeller face along the airflow (the model's main axis)
    const label = String(x.p.label || x.p.id || ''), round = x.p.shapes.filter((s) => /^(torus|ring|disc|cylinder)$/.test(String(s.t || s.type || '').toLowerCase()) && ['x', 'y', 'z'].includes(s.axis));
    const main = ['x', 'y', 'z'].includes(spec.axis) ? spec.axis : 'x';
    if (/\b(wheels?|tyres?|tires?|gulong)\b/i.test(label) && !/\b(fly|steering|pin|water|ferris|color|colour)\s*wheel/i.test(label) && main !== 'y' && round.length) {
      const across = main === 'x' ? 'z' : 'x', wrong = round.find((s) => s.axis !== across);
      if (wrong) out.push(`${name(x)} ${wrong.axis === 'y' ? 'lies flat' : 'faces along the vehicle'}: a wheel stands upright and turns on an axle across the vehicle, so give its round shapes "axis":"${across}"`);
    }
    if (/\b(compressor|turbine|propeller|propellor)\b/i.test(label)) {
      const blades = x.p.shapes.find((s) => String(s.t || s.type || '').toLowerCase() === 'blades' && ['x', 'y', 'z'].includes(s.axis) && s.axis !== main);
      if (blades) out.push(`${name(x)}'s blades face the wrong way: they turn around the main shaft, so give them "axis":"${main}"`);
    }
  }
  // (v305) a spoke, a blade or a rod stays inside the wheel or ring it belongs to (no spokes sticking out past the tyre):
  // only thin pieces (blades, rods, or cylinders much narrower than the ring), and only sideways past the rim (along the
  // axle is fine: a jet's casing is a wide cylinder that runs on past the ring at its mouth)
  const AXES = { x: 0, y: 1, z: 2 };
  // (v309) only a part that IS a wheel, a fan or a rotor: a crank arm really does stick out past the chainring
  const SPOKED = /\b(wheels?|tyres?|tires?|rims?|spokes?|fans?|rotors?|propellers?|impellers?|turbines?|compressors?|pulleys?|flywheels?)\b/i;
  for (const x of ok) {
    if (!SPOKED.test(`${x.p.label || ''} ${x.p.id || ''}`)) continue;
    const rims = x.p.shapes.filter((sh) => /^(torus|ring|disc)$/.test(String(sh.t || '').toLowerCase()) && AXES[sh.axis] != null);
    if (!rims.length) continue;
    const rim = rims.reduce((a, sh) => (Math.abs(+sh.r || 0) > Math.abs(+a.r || 0) ? sh : a)), rb = box3(rim);
    if (!rb) continue;
    const R = Math.abs(+rim.r || 0), across = [0, 1, 2].filter((k) => k !== AXES[rim.axis]), pad = R * .15;
    const thin = x.p.shapes.filter((sh) => { const t = String(sh.t || '').toLowerCase(); return t === 'blades' || t === 'pipe' || ((t === 'cylinder' || t === 'tube') && Math.abs(+sh.r || 0) < R * .25); });
    const sticks = thin.map(box3).filter(Boolean).some((b) => across.some((k) => b[k] < rb[k] - pad || b[k + 3] > rb[k + 3] + pad));
    if (sticks) out.push(`${name(x)} has thin pieces (spokes, blades or rods) that stick out past its rim; keep them inside it, shorter than its radius`);
  }
  // (v305) separate round things (planets, balls, atoms) never sit inside each other
  const balls = ok.flatMap((x) => x.p.shapes.filter((sh) => String(sh.t || '').toLowerCase() === 'sphere').map(box3).filter(Boolean).map((b) => ({ x, c: [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2], r: (b[3] - b[0]) / 2 })));
  for (let i = 0; i < balls.length; i++) for (let j = i + 1; j < balls.length; j++) {
    const a = balls[i], b = balls[j];
    if (a.x === b.x || a.x.p.inside === b.x.p.id || b.x.p.inside === a.x.p.id) continue;
    const d = Math.hypot(a.c[0] - b.c[0], a.c[1] - b.c[1], a.c[2] - b.c[2]);
    if (d < (a.r + b.r) * .9) out.push(`${name(a.x)} and ${name(b.x)} overlap; give each its own place (planets each on their own orbit, at their own distance)`);
  }
  return [...new Set(out)].slice(0, 10);
}

// ---------- (v305) a reference picture to draw from ----------
// For a real structure, machine or place, Cassie finds a free picture of it first and draws from that, so its outline,
// proportions and parts are the real ones. A diagram from Wikimedia Commons for how things are built or work (a volcano,
// the heart, the layers of the Earth); a photo from Openverse for objects and machines (a bicycle, a fan). Living things
// and imaginary creatures get none: a photo at an angle or a painting made those drawings worse, not better.
// Only free licences (public domain, CC0, CC BY, CC BY-SA), and the card credits the picture. → { mimeType, base64, ref } or null
const DIAGRAM = /\b(diagram|cycle|layers?|cross.?section|inside|structure|system|process|how .{0,40}\b(work|erupt|form|grow|flow)s?|parts? of|anatomy|heart|lungs?|brain|kidneys?|eye|ear|tooth|skeleton|volcano|earthquake|cell|atom|molecule|circuit|engine|motor|pump|generator|turbine|photosynthesis|digestive|respiratory|circulatory|nervous|solar system|planet|earth|moon|tides?|seasons?|eclipse|rainbow|lever|pulley|gear)\b/i;
const NO_REF = /\b(plants?|trees?|flowers?|leaf|leaves|roots?|seeds?|mushrooms?|fungi|bacteri\w*|virus\w*|people|person|face|my |your |our |this|that|these|those|graph|chart|equation|map of)\b/i;
const FREE = /^(cc0|pdm|by|by-sa|public domain|cc by( |-)?(sa)?[\s\d.]*|cc-by(-sa)?[\s\d.]*)$/i;
function subjectOf(q) {
  return String(q || '').toLowerCase().replace(/\(.*?\)/g, ' ')
    .replace(/\b(please|pls|can you|could you|cassie|draw|sketch|show|me|us|a|an|the|of|in 3d|3d|picture|image|diagram|how|does|do|it|explain|label(l)?ed|with labels|what|is|are|looks? like)\b/g, ' ')
    .replace(/[^a-z0-9 -]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
}
async function getJson(url, ms) { const r = await fetch(url, { signal: AbortSignal.timeout(ms), credentials: 'omit' }); if (!r.ok) throw new Error(String(r.status)); return r.json(); }
async function asData(url, ms) {
  const r = await fetch(url, { signal: AbortSignal.timeout(ms), credentials: 'omit' });
  if (!r.ok) throw new Error(String(r.status));
  const b = await r.blob();
  if (!/^image\/(png|jpeg|webp|gif)$/.test(b.type) || b.size > 2.5e6 || b.size < 2000) throw new Error('not a picture');
  const base64 = await new Promise((ok, no) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result).split(',')[1] || ''); fr.onerror = no; fr.readAsDataURL(b); });
  return { mimeType: b.type, base64 };
}
async function fromCommons(subject, ms) {
  const api = 'https://commons.wikimedia.org/w/api.php?origin=*&format=json&action=query';
  const hits = (await getJson(`${api}&list=search&srnamespace=6&srlimit=8&srsearch=${encodeURIComponent(subject + ' diagram')}`, ms)).query?.search || [];
  // an English or wordless diagram (not one labelled in another language), a picture file
  const pick = hits.map((h) => h.title).find((t) => /\.(svg|png|jpe?g)$/i.test(t) && !/[-_](?!en\b)[a-z]{2,3}(-[a-z]{2,4})?\.(svg|png|jpe?g)$/i.test(t) && !/\b(map|flag|logo|stamp|coin|painting|poster)\b/i.test(t));
  if (!pick) return null;
  const page = Object.values((await getJson(`${api}&prop=imageinfo&iiprop=url&iiurlwidth=500&titles=${encodeURIComponent(pick)}`, ms)).query?.pages || {})[0];
  const ii = page && page.imageinfo && page.imageinfo[0];
  if (!ii || !ii.thumburl) return null;
  return { ...(await asData(ii.thumburl, ms)), ref: { text: `${pick.replace(/^File:/, '')}, Wikimedia Commons`, url: ii.descriptionurl } };
}
async function fromOpenverse(subject, ms) {
  const d = await getJson(`https://api.openverse.org/v1/images/?q=${encodeURIComponent(subject)}&license=cc0,pdm,by,by-sa&mature=false&page_size=8`, ms);
  for (const r of d.results || []) {
    if (!FREE.test(String(r.license || '')) || !r.thumbnail) continue;
    try {
      const lic = String(r.license).toLowerCase() === 'pdm' ? 'public domain' : `CC ${String(r.license).toUpperCase()} ${r.license_version || ''}`.trim();
      return { ...(await asData(r.thumbnail, ms)), ref: { text: `${words(r.title, 60) || 'a photo'}${r.creator ? ' by ' + words(r.creator, 40) : ''}, ${lic}, Openverse`, url: r.foreign_landing_url || r.url } };
    } catch (e) { /* the next one */ }
  }
  return null;
}
// (v318) off: the pictures it found were too often the wrong thing (a map, a painting, another machine), and a
// wrong picture made the drawing worse than none. Cassie draws from what she knows; a student's own photo still works.
export const REFERENCES_ON = false;
export async function findReference(question, ms = 5000) {
  if (!REFERENCES_ON) return null;
  const q = String(question || '');
  // (v306) on low data a reference picture (about 80 KB) is skipped: Lite mode, Data Saver, or a 2G or 3G connection
  const net = (typeof navigator !== 'undefined' && navigator.connection) || {};
  if (document.documentElement.classList.contains('lite') || net.saveData || /^(slow-2g|2g|3g)$/.test(String(net.effectiveType || ''))) return null;
  if (CREATURE.test(q) || NO_REF.test(q)) return null;
  const subject = subjectOf(q);
  if (subject.length < 3) return null;
  // Commons first (diagrams, photos and public-domain drawings, and quick); Openverse only while there is time left.
  // A student never waits more than about 6 seconds for a reference: then Cassie draws without one.
  const end = Date.now() + ms * 1.2;
  for (const find of [fromCommons, fromOpenverse]) {
    const left = end - Date.now();
    if (left < 1500) break;
    try { const got = await find(subject, Math.min(ms, left)); if (got) return got; } catch (e) { /* offline, busy, or nothing: the next source */ }
  }
  return null;
}

// ---------- (v306) a follow-up question about a drawing: she answers on the SAME drawing ----------
// What is there stays where it is; she draws only the new parts the answer needs (or corrects one), and the part
// the answer is about is picked out. A question about something else brings a whole new drawing ("new": true).
export function followPrompt(rawSpec) {
  const spec = clean(rawSpec);
  if (!spec) return '';
  const now = JSON.stringify({ title: spec.title, mode: spec.mode, ...(spec.mode === '3d' ? { axis: spec.axis } : {}), parts: spec.parts.map(({ id, label, say, color, box, anchor, inside, size, attached, shell, spin, glow, finish, shapes }) => (spec.mode === '3d' ? { id, label, say, color, inside, size, attached, shell, spin, glow, finish, shapes } : { id, label, say, color, box, anchor, shapes })) });
  const room = Math.max(0, 12 - spec.parts.length);
  const shapes = spec.mode === '3d'
    ? 'New 3D parts use the same units and centre as the parts above (about 6 units long in all). Shapes: cylinder {r,r2,len,axis,pos}, disc {r,thick,axis,pos}, cone {r,len,axis,pos,dir}, sphere {r,pos}, box {size:[w,h,d],pos}, torus {r,tube,axis,pos}, blades {n,len,width,hub,axis,pos}, capsule {r,len,axis,pos}, pipe {pts,r}, arrow {pts,r}, lathe {profile,axis,pos}, plate {outline,thick,axis,pos}. Each new part touches or sits inside the part it belongs to.'
    : 'New parts are drawn on the same picture (400 wide, 260 tall, x 10 to 390, y 20 to 250) at the same scale: in their real place on the drawing, touching what they connect to, in clear space where they can. Every part has "box", "anchor" (a point ON its main shape) and 2 to 24 strokes. 2d shapes: line, arrow (x1,y1,x2,y2), path (d, capital letters only), poly (pts), rect (x,y,w2,h), circle (cx,cy,r), ellipse (cx,cy,rx,ry), text (x,y,text, values only); "fill":true, "dash":true.';
  return `You are Cassie, a careful tutor for students who explains by DRAWING. The student is looking at your ${spec.mode === '3d' ? '3D model' : 'drawing'} and asks a follow-up question about it.
The ${spec.mode === '3d' ? 'model' : 'drawing'} now: ${now}
Answer it ON this ${spec.mode === '3d' ? 'model' : 'drawing'}. Reply with ONLY one JSON object:
{"answer": the direct answer in 1 to 3 short sentences, "focus": the id of the part your answer is about (an old one or a new one), "next": [2 short questions the student could ask next to go deeper, each about a part of this ${spec.mode === '3d' ? 'model' : 'drawing'} (how it works, what it does, what happens next)], "parts": [only the NEW parts the answer needs, 0 to ${Math.min(3, room)}, each in the same form as the parts above, with a new id], "changed": [an old part that must change to answer it (a new state, or a mistake), as the whole part with its own id; usually empty]}
Everything else stays exactly where it is: do not send old parts again. ${shapes}
Students learn from this: every fact, label, direction and count MUST be correct, and a new part looks like the real thing (its real outline and colour), never a symbol.
If they ask about a different thing from this ${spec.mode === '3d' ? 'model' : 'drawing'}, reply instead with a whole new drawing in the same full form as the one above (title, mode, intro, summary, every part), with "new": true.
Use the student's language (English, Filipino or Taglish). No dashes in the words. No emojis.`;
}
// (v311) what a follow-up added must sit where it belongs: on or next to the part it is about (a wing's bones inside the
// wing, not a long line across the picture), and no new part as big as the whole drawing
export function followIssues(merged) {
  const sp = merged && merged.spec, out = [];
  if (!sp || sp.mode !== '2d' || !Array.isArray(sp.fresh) || !sp.fresh.length) return out;
  const boxOf = (p) => { const pts = p.shapes.flatMap(shapePoints).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y)); if (!pts.length) return null; const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; };
  const old = sp.parts.filter((p) => !sp.fresh.includes(p.id)), focus = sp.parts.find((p) => p.id === sp.focus && !sp.fresh.includes(p.id));
  const near = (a, b, pad) => a && b && a[0] <= b[2] + pad && b[0] <= a[2] + pad && a[1] <= b[3] + pad && b[1] <= a[3] + pad;
  for (const p of sp.parts.filter((x) => sp.fresh.includes(x.id))) {
    const b = boxOf(p); if (!b) continue;
    const host = focus || old.find((o) => near(boxOf(o), b, 0));
    const hb = host && boxOf(host), pts = p.shapes.filter((x) => String(x.t || '').toLowerCase() !== 'arrow').flatMap(outlinePoints).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
    const inside = hb && pts.length ? pts.filter(([x, y]) => x >= hb[0] - 30 && x <= hb[2] + 30 && y >= hb[1] - 30 && y <= hb[3] + 30).length / pts.length : 1;
    if (host && !near(hb, b, 24)) out.push(`"${p.label}" is drawn away from "${host.label}", the part it belongs to: draw it on or right beside it`);
    else if (host && inside < 0.6) out.push(`"${p.label}" runs far outside "${host.label}", the part it belongs to: keep it on that part, its real size`);
    else if (!host && !old.some((o) => near(boxOf(o), b, 24))) out.push(`"${p.label}" is drawn away from the drawing: draw it on or right beside the part it belongs to`);
    if ((b[2] - b[0]) * (b[3] - b[1]) > 400 * 260 * 0.45) out.push(`"${p.label}" is almost as big as the whole picture: draw it the size it really is, on its part`);
  }
  return out;
}
// her reply to a follow-up, put together with the drawing that is there → { spec, isNew, answer } or null
export function mergeFollow(rawOld, reply) {
  const old = clean(rawOld);
  let d = reply;
  if (typeof d === 'string') { const a = d.indexOf('{'), b = d.lastIndexOf('}'); if (a < 0 || b <= a) return null; try { d = JSON.parse(d.slice(a, b + 1)); } catch (e) { return null; } }
  if (!old || !d || typeof d !== 'object') return null;
  if (d.new === true) { const s = clean(d); return s ? { spec: s, isNew: true, answer: s.intro } : null; }
  const answer = words(d.answer, 400);
  const one = (x) => { const s = clean({ mode: old.mode, parts: [x] }); return s ? s.parts[0] : null; };
  const parts = old.parts.map((p) => ({ ...p })), fresh = [];
  for (const x of Array.isArray(d.changed) ? d.changed.slice(0, 3) : []) {
    const p = x && one(x), k = p ? parts.findIndex((q) => q.id === p.id) : -1;
    if (k >= 0) { parts[k] = { ...p, color: old.parts[k].color }; fresh.push(p.id); }
  }
  const taken = new Set(parts.map((p) => p.id));
  for (const x of Array.isArray(d.parts) ? d.parts : []) {
    if (parts.length >= 12) break;
    const p = x && one(x); if (!p) continue;
    if (taken.has(p.id)) { // (an old part sent again: a change, or a new part with a name already used)
      const k = parts.findIndex((q) => q.id === p.id);
      if (k >= 0 && JSON.stringify(parts[k].shapes) === JSON.stringify(p.shapes)) continue;
      let n = 2; while (taken.has(`${p.id}${n}`)) n++; p.id = `${p.id}${n}`;
    }
    if (parts.some((q) => q.color === p.color)) { const free = PALETTE.map((c, i) => color(c, i)).find((c) => !parts.some((q) => q.color === c)); if (free) p.color = free; } // (its own colour, to tell it apart)
    taken.add(p.id); parts.push(p); fresh.push(p.id);
  }
  if (!answer && !fresh.length) return null;
  const focus = parts.some((p) => p.id === d.focus) ? String(d.focus) : fresh[0] || null;
  return { spec: { ...old, parts, intro: answer, summary: answer || old.summary, fresh, focus, next: Array.isArray(d.next) ? d.next : [] }, isNew: false, answer };
}

// ---------- the frame around a drawing: the picture, what she says, and what you can do ----------
export async function render(host, rawSpec, opts = {}) {
  const spec = clean(rawSpec);
  if (!spec) return false;
  const animate = !!opts.animate && !still();
  host.classList.add('ld');
  host.innerHTML = '';
  const head = el('div', 'ld-head'); const dot = el('span', 'ld-live'); dot.setAttribute('aria-hidden', 'true');
  const state = el('span', 'ld-state', animate ? (spec.fresh ? 'Cassie is adding to it' : 'Cassie is drawing') : spec.mode === '3d' ? 'Cassie built it in 3D' : 'Cassie drew it');
  head.append(dot, state, el('b', 'ld-title', spec.title));
  const stage = el('div', 'ld-stage'); stage.setAttribute('role', 'img'); stage.setAttribute('aria-label', `${spec.title}: ${spec.parts.map((p) => p.label).filter(Boolean).join(', ')}`);
  const hint = el('div', 'ld-hint');
  const say = el('p', 'ld-say'); say.setAttribute('aria-live', 'polite');
  const acts = el('div', 'ld-acts');
  host.append(head, stage, hint, say);
  if (spec.simple && opts.simpleNote) host.appendChild(el('p', 'ld-note', opts.simpleNote));
  if (spec.ref) { // (v305) drawn from a reference picture: where it came from (its licence asks for the credit)
    const r = el('p', 'ld-ref', 'Drawn from a reference: '), a = el('a', null, spec.ref.text);
    a.href = spec.ref.url; a.target = '_blank'; a.rel = 'noopener';
    r.appendChild(a); host.appendChild(r);
  }
  // (v334) step by step, to read at your own pace: each part's words are added to this list as it is drawn, and stay
  // (a drawing from history, or Draw again, has them all); it folds away with a tap
  host.appendChild(acts);
  if (animate) acts.hidden = true; // (v338) while she draws, no Pull apart, Hide labels or Draw again: nothing says it is finished before it is
  const stepsBox = el('details', 'ld-steps-box'); stepsBox.open = true;
  const stepsHead = el('summary', 'ld-steps-head', 'Step by step'), stepsList = el('ol', 'ld-steps');
  stepsBox.append(stepsHead, stepsList); stepsBox.hidden = true;
  host.insertBefore(stepsBox, acts);
  const addStep = (label, text) => {
    if (!text && !label) return;
    const li = el('li', 'ld-stepi'); if (label) li.appendChild(el('b', null, label)); if (text && text !== label) li.appendChild(document.createTextNode((label ? ': ' : '') + text));
    stepsList.appendChild(li); stepsBox.hidden = false;
  };
  const allSteps = () => { stepsList.replaceChildren(); spec.parts.forEach((p) => addStep(p.label, p.say)); };
  const setSay = async (text, type, label) => {
    if (!type) { say.textContent = text; return; }
    if (label !== undefined) addStep(label, text);
    say.textContent = '';
    // (v310) typed by the clock, not by the frame: about a second a sentence even on a slow or busy phone
    const t0 = performance.now(), total = Math.min(1100, text.length * 14);
    for (let n = 0; n < text.length;) { n = Math.max(n + 1, Math.ceil(text.length * Math.min(1, (performance.now() - t0) / total))); say.textContent = text.slice(0, n); if (n < text.length) await sleep(16); }
    // (v334) then time to read it before the next part: about a fifth of a second a word, 1.2 to 4 seconds
    if (label !== undefined) await sleep(Math.min(4000, Math.max(1200, text.split(/\s+/).length * 200)) * (window.CASSIE_READ_SPEED ?? 1));
  };
  const view = spec.mode === '3d' ? await draw3d(stage, spec, { animate, setSay, hint, real: true, callout: true }) : draw2d(stage, spec, { animate, setSay, hint });
  // (v319) Machine view: the same 3D model drawn the Anatomy way (isoview.js), with no WebGL; on a phone with no 3D it is the view
  let mv = null; const mvHost = spec.mode === '3d' ? el('div', 'ld-mv') : null;
  const machineOn = async () => {
    if (mv) return mv;
    let m = null; try { m = await import('./isoview.js?v=338'); } catch (e) { return null; }
    mv = m.machine(mvHost, spec, { dark: !lightPage() });
    if (mv) {
      const row = el('div', 'ld-mv-acts');
      const turn = el('button', 'ld-btn', 'Turn it'); turn.type = 'button'; turn.addEventListener('click', () => mv.turn(45));
      const ap = el('button', 'ld-btn', 'Pull apart'); ap.type = 'button'; ap.setAttribute('aria-pressed', 'false'); ap.addEventListener('click', () => { const on = mv.apart(); ap.textContent = on ? 'Put it back' : 'Pull apart'; ap.setAttribute('aria-pressed', String(on)); });
      row.append(turn, ap); mv.el.appendChild(row);
    }
    return mv;
  };
  if (mvHost) { mvHost.hidden = true; stage.after(mvHost); }
  if (!view) { // no 3D on this phone: the machine view instead (or, if even that cannot draw, what it would have shown)
    stage.remove();
    if (mvHost && await machineOn()) mvHost.hidden = false;
    else say.textContent = `${spec.intro ? spec.intro + ' ' : ''}${spec.parts.map((p, i) => `${i + 1}. ${p.label}: ${p.say}`).join(' ')}`;
  }
  // (v253) a compact row: a small icon and a short word each, muted; the tap area stays 48px
  const ICON = { cube: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/>', flat: '<path d="M4 20l4-1 11-11-3-3L5 16z"/>', pause: '<path d="M8 5v14M16 5v14"/>', play: '<path d="M7 5l12 7-12 7z"/>', next: '<path d="M5 12h12M13 7l5 5-5 5"/>', redo: '<path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4"/>', quiz: '<path d="M9 9a3 3 0 1 1 4 2.8c-.7.3-1 .8-1 1.5V14M12 17.5h.01"/><circle cx="12" cy="12" r="9"/>', photo: '<path d="M4 7.5h3l1.6-2.5h6.8L17 7.5h3a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8.5a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.5"/>', ask: '<path d="M4 5h16v11H9l-5 4z"/>', change: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>', open: '<path d="M4 12h16M12 4v16"/>', apart: '<path d="M4 12h5M15 12h5M7 9l-3 3 3 3M17 9l3 3-3 3"/>' };
  const btn = (label, fn, cls = '', icon = '') => { const b = el('button', 'ld-btn ' + cls); b.type = 'button'; if (icon && ICON[icon]) b.insertAdjacentHTML('afterbegin', `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON[icon]}</svg>`); b.appendChild(el('span', '', label)); b.addEventListener('click', fn); acts.appendChild(b); return b; };
  const setLabel = (b, t) => { b.querySelector('span').textContent = t; };
  const done = () => { acts.hidden = false; dot.classList.add('off'); state.textContent = spec.mode === '3d' ? 'Cassie built it in 3D' : 'Cassie drew it'; setSay(spec.summary || spec.intro || ''); host.dispatchEvent(new CustomEvent('ld-done')); };
  if (view) {
    if (view.open) { const ob = btn('Open it up', () => { const on = view.open(); setLabel(ob, on ? 'Close the case' : 'Open it up'); ob.setAttribute('aria-pressed', String(on)); }, 'ld-open', 'open'); ob.setAttribute('aria-pressed', 'false'); }
    if (view.explode) { const pb = btn('Pull apart', () => { const on = view.explode(); setLabel(pb, on ? 'Put it back' : 'Pull apart'); pb.setAttribute('aria-pressed', String(on)); }, '', 'apart'); pb.setAttribute('aria-pressed', 'false'); }
    // (v335) the names can be hidden, to see the drawing itself, and shown again
    const lb = btn('Hide labels', () => { const off = host.classList.toggle('ld-nolabels'); setLabel(lb, off ? 'Show labels' : 'Hide labels'); lb.setAttribute('aria-pressed', String(off)); }, 'ld-labels-btn', 'open'); lb.setAttribute('aria-pressed', 'false');
    btn('Draw again', async () => { stepsList.replaceChildren(); await view.play(true); done(); if (view.move) view.move(); }, '', 'redo');
    if (mvHost) { // (v319) the 3D model, or the same model as an Anatomy machine drawing
      const mb = btn('Machine view', async () => { const on = mvHost.hidden; if (on && !(await machineOn())) return; mvHost.hidden = !on; stage.hidden = on; setLabel(mb, on ? '3D view' : 'Machine view'); mb.setAttribute('aria-pressed', String(on)); }, 'ld-mv-btn', 'cube');
      mb.setAttribute('aria-pressed', 'false');
    }
  }
  if (opts.onQuiz) btn('Quiz me', () => opts.onQuiz(spec), '', 'quiz');
  if (opts.onRealistic && (!opts.canRealistic || opts.canRealistic())) btn('Real photo', () => opts.onRealistic(spec), 'ld-photo', 'photo');
  if (opts.onChange) btn('Show another way', () => opts.onChange(spec), 'ld-change', 'change');
  // (v314) a machine or a thing, both ways: the flat drawing and the 3D model
  if (opts.onOther && (!opts.canOther || opts.canOther(spec))) btn(spec.mode === '3d' ? 'See it flat' : 'See it in 3D', () => opts.onOther(spec), 'ld-other', spec.mode === '3d' ? 'flat' : 'cube');
  // (v307) what to ask next: one tap asks it, and she answers on this same drawing
  let nextRow = null;
  if (spec.next && spec.next.length && opts.onNext) {
    nextRow = el('div', 'ld-next'); nextRow.setAttribute('role', 'group'); nextRow.setAttribute('aria-label', 'Ask next');
    nextRow.appendChild(el('span', 'ld-next-t', 'Ask next'));
    spec.next.forEach((q) => { const b = el('button', 'ld-next-q', q); b.type = 'button'; b.addEventListener('click', () => { nextRow.remove(); opts.onNext(q, spec); }); nextRow.appendChild(b); });
    host.appendChild(nextRow);
  }
  if (view) {
    view.onPick = (p) => {
      allBtn.hidden = !p; // (v311: one part picked out, the rest faded: a clear way back)
      if (!p) { setSay(spec.summary || spec.intro || ''); hint.textContent = view.hintText; askBtn.hidden = true; return; }
      setSay(p.say || p.label); hint.textContent = `Showing: ${p.label}`;
      askBtn.hidden = !opts.onAsk; setLabel(askBtn, `Ask about the ${p.label}`); askBtn.onclick = () => opts.onAsk(p, spec);
    };
    const askBtn = btn('', () => {}, 'ld-askpart', 'ask'); askBtn.hidden = true;
    const allBtn = btn('Show all', () => { if (view.unpick) view.unpick(); allBtn.hidden = true; }, 'ld-showall', 'open'); allBtn.hidden = true;
    if (spec.mode === '3d' && view.setOpen && view.open) { view.setOpen(true); const ob = acts.querySelector('.ld-open'); if (ob) { setLabel(ob, 'Close the case'); ob.setAttribute('aria-pressed', 'true'); } }
    if (!animate) allSteps(); else if (spec.fresh) spec.parts.filter((p) => !spec.fresh.includes(p.id)).forEach((p) => addStep(p.label, p.say)); // (v334: shown at once: all its steps; a follow-up: the ones already there)
    await view.play(); done();
    // (v314) once it is drawn, it moves: Pause and Play, and Next step for a drawing with something flowing through it
    if (view.motion) {
      const on = view.move();
      const mb = btn(on ? 'Pause' : 'Play', () => { if (view.moving) view.pause(); else view.move(true); setLabel(mb, view.moving ? 'Pause' : 'Play'); const sv = mb.querySelector('svg'); if (sv) sv.innerHTML = ICON[view.moving ? 'pause' : 'play']; }, 'ld-motion', on ? 'pause' : 'play');
      acts.prepend(mb); // (its words say what a tap does: Pause or Play)
      if (spec.flows && view.stepNext) { const nb = btn('Next step', () => { view.stepNext(); allBtn.hidden = false; }, 'ld-step', 'next'); acts.insertBefore(nb, mb.nextSibling); }
    }
    // (v306) a follow-up's answer: the part it is about is picked out (the others dim), and her answer stays in view
    const fi = spec.focus ? spec.parts.findIndex((p) => p.id === spec.focus) : -1;
    if (fi >= 0 && view.focus) { view.focus(fi); const allBtn = acts.querySelector('.ld-showall'); if (allBtn) allBtn.hidden = false; hint.textContent = `Showing: ${spec.parts[fi].label}`; }
  }
  return true;
}

// ---------- flat drawings: one stroke at a time, like a pen; each part's name writes on after its last stroke ----------
const LABEL_FONT = 13, LABEL_PAD = 4;
let drawings = 0;
function draw2d(stage, spec, { animate, setSay, hint }) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 400 260'); svg.setAttribute('class', 'ld-svg');
  stage.prepend(svg);
  const defs = document.createElementNS(NS, 'defs');
  // (an arrow's head is the colour of its part: one head for each part, named for this drawing alone)
  const headId = `ld-head-${++drawings}-`;
  defs.innerHTML = spec.parts.map((p, i) => `<marker id="${headId}${i}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="${/^#[0-9a-f]{3,8}$/i.test(p.color) ? p.color : 'currentColor'}"/></marker>`).join('');
  svg.appendChild(defs);
  const groups = spec.parts.map((p, i) => {
    const g = document.createElementNS(NS, 'g'); g.setAttribute('class', 'ld-part'); g.style.color = p.color; g.dataset.i = i;
    for (const s of p.shapes) { const n = shape2d(s, p); if (!n) continue; if (n.getAttribute('marker-end')) n.setAttribute('marker-end', `url(#${headId}${i})`); g.appendChild(n); }
    svg.appendChild(g);
    return g;
  });
  // (v314) the tracks things move along, under the names; shown once the drawing is drawn
  const flowG = document.createElementNS(NS, 'g'); flowG.setAttribute('class', 'ld-flows'); flowG.style.display = 'none'; svg.appendChild(flowG);
  const flowEls = (spec.flows || []).map((f, k) => {
    defs.insertAdjacentHTML('beforeend', `<marker id="${headId}f${k}" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="${f.to || f.color}"/></marker>`);
    const track = document.createElementNS(NS, 'path');
    track.setAttribute('d', f.d); track.setAttribute('fill', 'none'); track.setAttribute('stroke', f.color); track.setAttribute('stroke-opacity', '.4'); track.setAttribute('stroke-width', '1.5'); track.setAttribute('stroke-dasharray', '2 5'); track.setAttribute('stroke-linecap', 'round'); track.setAttribute('marker-end', `url(#${headId}f${k})`); track.setAttribute('class', 'ld-track');
    flowG.appendChild(track);
    const dots = Array.from({ length: f.dots }, () => { const c = document.createElementNS(NS, 'ellipse'); c.setAttribute('rx', 4.4); c.setAttribute('ry', 3.4); c.setAttribute('stroke', lightPage() ? '#ffffff' : '#0e0e12'); c.setAttribute('stroke-width', '1.4'); c.setAttribute('class', 'ld-dot'); flowG.appendChild(c); return { c, at: 0 }; });
    return { f, track, dots, L: 0 };
  });
  const labels = document.createElementNS(NS, 'g'); labels.setAttribute('class', 'ld-labels'); svg.appendChild(labels);
  const legend = el('p', 'ld-legend'); legend.hidden = true; stage.after(legend);
  // (v253) each name points at its part's ANCHOR, a point on that part's main shape (the AI's, else the centre of
  // the part's first shape). Names go in clear space: never over a stroke, a filled shape or a word in the drawing
  // (every element smaller than a third of the picture is an obstacle; a big outline is avoided where it can be),
  // never over another name, inside the picture. Tried in rings around the anchor; then one size smaller; then a
  // small numbered marker on the anchor, with the name under the picture.
  const taken = [];
  const hits = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const textW = (t, fs) => { try { const m = document.createElementNS(NS, 'text'); m.setAttribute('font-size', fs); m.setAttribute('class', 'ld-ltext'); m.textContent = t; svg.appendChild(m); const w = m.getComputedTextLength(); m.remove(); if (w > 0) return w; } catch (e) { /* */ } return t.length * fs * .48; };
  const boxOf = (n) => { try { const b = n.getBBox(); return b && (b.width || b.height) ? { x: b.x - 2, y: b.y - 2, w: b.width + 4, h: b.height + 4 } : null; } catch (e) { return null; } };
  // (v253) the drawing is laid on a 2px grid once: each cell knows which strokes, filled shapes and words cover it
  // (a curved shape by its real outline, a line by its line), so trying a place for a name is only a lookup
  const G = 2, GW = 200, GH = 130;
  let obstacles = null;
  const obstaclesNow = () => {
    const list = [], cells = new Array(GW * GH);
    groups.flatMap((g) => [...g.children]).forEach((n) => {
      const b = boxOf(n); if (!b) return;
      const o = { id: list.length, word: n.tagName === 'text' };
      o.soft = !o.word && n.tagName !== 'line' && b.w * b.h >= 400 * 260 / 3; // (a big outline only costs; the rest block)
      list.push(o);
      const seg = n.tagName === 'line' ? ['x1', 'y1', 'x2', 'y2'].map((k) => +n.getAttribute(k)) : null;
      const filled = (n.getAttribute('fill') || 'none') !== 'none', geo = !o.word && !seg && typeof n.isPointInStroke === 'function';
      const on = (x, y) => {
        if (o.word) return true;
        if (seg) { const [x1, y1, x2, y2] = seg, dx = x2 - x1, dy = y2 - y1, L = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / L)); return Math.hypot(x - x1 - t * dx, y - y1 - t * dy) <= 2.5; }
        if (!geo) return true;
        try { const pt = new DOMPoint(x, y); return (filled && n.isPointInFill(pt)) || n.isPointInStroke(pt); } catch (e) { return true; }
      };
      const hit = [];
      for (let cy = Math.max(0, Math.floor(b.y / G)); cy <= Math.min(GH - 1, Math.floor((b.y + b.h) / G)); cy++) for (let cx = Math.max(0, Math.floor(b.x / G)); cx <= Math.min(GW - 1, Math.floor((b.x + b.w) / G)); cx++) if (on(cx * G + 1, cy * G + 1)) hit.push([cx, cy]);
      hit.forEach(([cx, cy]) => { for (let ey = cy - 1; ey <= cy + 1; ey++) for (let ex = cx - 1; ex <= cx + 1; ex++) { if (ex < 0 || ey < 0 || ex >= GW || ey >= GH) continue; const k = ey * GW + ex; const c = cells[k] || (cells[k] = []); if (c[c.length - 1] !== o.id && !c.includes(o.id)) c.push(o.id); } }); // (a cell of margin round every stroke)
    });
    return { list, cells };
  };
  const idsIn = (box) => { const out = new Set(); for (let cy = Math.max(0, Math.floor(box.y / G)); cy <= Math.min(GH - 1, Math.floor((box.y + box.h) / G)); cy++) for (let cx = Math.max(0, Math.floor(box.x / G)); cx <= Math.min(GW - 1, Math.floor((box.x + box.w) / G)); cx++) { const c = obstacles.cells[cy * GW + cx]; if (c) c.forEach((id) => out.add(id)); } return out; };
  const idsAlong = (sg) => { const out = new Set(), [x1, y1, x2, y2] = sg, n = Math.max(2, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / G)); for (let k = 0; k <= n; k++) { const cx = Math.floor((x1 + (x2 - x1) * k / n) / G), cy = Math.floor((y1 + (y2 - y1) * k / n) / G); const c = cx >= 0 && cy >= 0 && cx < GW && cy < GH && obstacles.cells[cy * GW + cx]; if (c) c.forEach((id) => out.add(id)); } return out; };
  const segHits = (sg, r) => { const [x1, y1, x2, y2] = sg, n = Math.max(2, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 3)); for (let k = 0; k <= n; k++) { const x = x1 + (x2 - x1) * k / n, y = y1 + (y2 - y1) * k / n; if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return true; } return false; };
  const anchorOf = (i) => {
    const p = spec.parts[i];
    if (p.anchor) return p.anchor;
    const first = groups[i].children[0], b = first && boxOf(first);
    return b ? [b.x + b.w / 2, b.y + b.h / 2] : null;
  };
  let markers = 0;
  const placeLabel = (i) => {
    const p = spec.parts[i]; if (!p.label) return null;
    const a = anchorOf(i); if (!a) return null;
    if (!obstacles) obstacles = obstaclesNow();
    const txt = `${i + 1} ${p.label}`;
    const own = new Set([...idsIn({ x: a[0] - 4, y: a[1] - 4, w: 8, h: 8 })].filter((id) => !obstacles.list[id].word)); // (the shape the anchor sits on: its leader may touch it; never a word, even its own: v311)
    let best = null, fs = LABEL_FONT;
    for (const size of [LABEL_FONT, LABEL_FONT - 2]) {
      const w = textW(txt, size) + LABEL_PAD * 2, h = size + LABEL_PAD * 2;
      let top = null;
      for (let r = 10; r <= 150 && !top; r += 6) {
        for (let k = 0; k < 24; k++) {
          const ang = (k / 24) * Math.PI * 2, cx = a[0] + Math.cos(ang) * r, cy = a[1] + Math.sin(ang) * r;
          const box = { x: cx - w / 2, y: cy - h / 2, w, h };
          if (box.x < 2 || box.y < 2 || box.x + w > 398 || box.y + h > 258) continue;
          if (taken.some((q) => hits(box, q))) continue;
          const inBox = [...idsIn(box)];
          if (inBox.some((id) => !obstacles.list[id].soft)) continue; // (never over a stroke, a filled shape or a word)
          // the leader, from the name's nearest edge to the anchor: it never crosses a word or another name, and crossing a stroke costs
          const lx = Math.min(Math.max(a[0], box.x), box.x + w), ly = Math.min(Math.max(a[1], box.y), box.y + h);
          const along = [...idsAlong([lx, ly, a[0], a[1]])].filter((id) => !own.has(id));
          if (along.some((id) => obstacles.list[id].word) || taken.some((q) => segHits([lx, ly, a[0], a[1]], q))) continue;
          const gap = Math.hypot(a[0] - lx, a[1] - ly); // (how far the name sits from its part: as close as the clear space allows)
          const cost = gap + inBox.length * 40 + along.length * 80;
          if (!top || cost < top.cost) top = { box, cost, gap };
        }
      }
      if (top && top.gap <= 72) { best = top.box; fs = size; break; } // (v311: far from its part, a long line is worse than a number on it)
    }
    const g = document.createElementNS(NS, 'g'); g.setAttribute('class', 'ld-label'); g.dataset.i = i;
    const dot = document.createElementNS(NS, 'circle'); dot.setAttribute('cx', a[0]); dot.setAttribute('cy', a[1]); dot.setAttribute('r', 2.5); dot.setAttribute('class', 'ld-anchor');
    if (!best) { // (no clear space: a numbered marker on the part, the name under the picture)
      const m = document.createElementNS(NS, 'circle'); m.setAttribute('cx', a[0]); m.setAttribute('cy', a[1]); m.setAttribute('r', 8); m.setAttribute('class', 'ld-lbg ld-marker');
      const t = document.createElementNS(NS, 'text'); t.setAttribute('x', a[0]); t.setAttribute('y', a[1] + 4); t.setAttribute('text-anchor', 'middle'); t.setAttribute('font-size', 11); t.setAttribute('class', 'ld-ltext');
      g.dataset.marker = '1'; g.append(m, t); labels.appendChild(g);
      legend.hidden = false; legend.textContent = (legend.textContent ? legend.textContent + '   ' : '') + txt; markers++;
      return { g, t, txt: String(i + 1), box: { x: a[0] - 8, y: a[1] - 8, w: 16, h: 16 }, anchor: a };
    }
    taken.push(best);
    // the leader: from the name's nearest edge straight to the anchor, and it ends exactly there
    const lx = Math.min(Math.max(a[0], best.x), best.x + best.w), ly = Math.min(Math.max(a[1], best.y), best.y + best.h);
    const lead = document.createElementNS(NS, 'line'); lead.setAttribute('x1', lx); lead.setAttribute('y1', ly); lead.setAttribute('x2', a[0]); lead.setAttribute('y2', a[1]); lead.setAttribute('class', 'ld-lead');
    const bg = document.createElementNS(NS, 'rect'); bg.setAttribute('x', best.x); bg.setAttribute('y', best.y); bg.setAttribute('width', best.w); bg.setAttribute('height', best.h); bg.setAttribute('rx', 4); bg.setAttribute('class', 'ld-lbg');
    const t = document.createElementNS(NS, 'text'); t.setAttribute('x', best.x + LABEL_PAD); t.setAttribute('y', best.y + LABEL_PAD + fs - 2); t.setAttribute('font-size', fs); t.setAttribute('class', 'ld-ltext'); t.dataset.full = txt;
    g.append(lead, dot, bg, t); labels.appendChild(g);
    return { g, t, txt, box: best, anchor: a };
  };
  const hintText = 'Tap a part to hear about it';
  hint.textContent = hintText;
  let picked = -1;
  const pick = (i) => {
    picked = picked === i ? -1 : i;
    groups.forEach((g, k) => g.classList.toggle('dim', picked >= 0 && k !== picked));
    if (!moving && flowG.style.display !== 'none') lay();
    view.onPick && view.onPick(picked >= 0 ? spec.parts[picked] : null);
  };
  groups.forEach((g, i) => { g.addEventListener('click', (e) => { e.stopPropagation(); pick(i); }); });
  svg.addEventListener('click', () => { if (picked >= 0) pick(picked); });
  let labelEls = [];
  const clearLabels = () => { labels.replaceChildren(); taken.length = 0; labelEls = []; obstacles = null; legend.textContent = ''; legend.hidden = true; markers = 0; };
  const placeAll = () => { clearLabels(); labelEls = groups.map((_, i) => placeLabel(i)); labelEls.forEach((l) => { if (l) l.t.textContent = l.txt; }); return labelEls.some(Boolean) || !spec.parts.some((p) => p.label); };
  const turns = groups.map(() => 0); // (each show or hide of a part ends the one before it)
  const dropLabel = (i) => { const l = labelEls[i]; if (!l) return; l.g.remove(); const k = taken.indexOf(l.box); if (k >= 0) taken.splice(k, 1); labelEls[i] = null; };
  // (v314) what moves: a part that beats or breathes, a part that turns (each round piece about its own middle), and the
  // dots on every track. It runs while the drawing is on screen, stops for good once it is gone, and waits for a tap
  // to Play when the phone asks for less motion (Reduce Motion, Lite mode).
  const rgb = (h) => { let x = h.slice(1); if (x.length < 6) x = x.slice(0, 3).split('').map((c) => c + c).join(''); return [0, 2, 4].map((k) => parseInt(x.slice(k, k + 2), 16)); };
  const mixHex = (a, b, k) => { const A = rgb(a), B = rgb(b); return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * k)).join(',')})`; };
  const middle = (n) => { try { const b = n.getBBox(); return [b.x + b.width / 2, b.y + b.height / 2, Math.max(b.width, b.height) / 2]; } catch (e) { return null; } };
  const beaters = [], turners = [];
  const motionSetup = () => {
    if (beaters.length || turners.length) return;
    groups.forEach((g, i) => {
      const p = spec.parts[i];
      if (p.beat) { const c = middle(g); if (c) beaters.push({ g, kind: p.beat, c }); }
      if (p.spin) { // each piece turns about the round piece it sits in (a spoke in its wheel), or the part's middle
        const kids = [...g.children], rounds = kids.filter((n) => /^(circle|ellipse)$/.test(n.tagName)).map(middle).filter((c) => c && c[2] > 6);
        const all = middle(g);
        kids.forEach((n) => { const c = middle(n); if (!c) return; const host = rounds.filter((r) => Math.hypot(c[0] - r[0], c[1] - r[1]) <= r[2] + 2).sort((a, b) => a[2] - b[2])[0] || (rounds.length ? null : all); if (host) turners.push({ n, c: host }); });
      }
    });
  };
  let moving = false, raf2 = 0, lastT = 0, angle = 0, onScreen = true;
  const io2 = 'IntersectionObserver' in window ? new IntersectionObserver((en) => { onScreen = en.some((x) => x.isIntersecting); if (onScreen && moving && !raf2) raf2 = requestAnimationFrame(frame); }) : null;
  const put = (x, d) => {
    let q; try { q = x.track.getPointAtLength(d.at); } catch (e) { return; }
    d.c.setAttribute('cx', q.x.toFixed(1)); d.c.setAttribute('cy', q.y.toFixed(1));
    d.c.setAttribute('fill', x.f.to ? mixHex(x.f.color, x.f.to, d.at / x.L) : x.f.color);
    d.c.setAttribute('opacity', picked >= 0 && x.f.of.length && !x.f.of.includes(spec.parts[picked].id) ? '.15' : '1');
  };
  const lay = () => flowEls.forEach((x) => { if (!x.L) { try { x.L = x.track.getTotalLength(); } catch (e) { x.L = 0; } x.dots.forEach((d, k) => { d.at = (k / x.dots.length) * x.L; }); } if (x.L > 4) x.dots.forEach((d) => put(x, d)); });
  function frame(now) {
    raf2 = 0;
    if (!svg.isConnected) { moving = false; if (io2) io2.disconnect(); return; } // (the drawing is gone: the motion stops for good)
    const dt = lastT ? Math.min(50, now - lastT) : 16; lastT = now;
    const beat = (now % 860) / 860, squeeze = beat < 0.18 ? Math.sin((beat / 0.18) * Math.PI) : 0, breath = (Math.sin((now / 1700) * Math.PI) + 1) / 2;
    beaters.forEach((b) => { const k = b.kind === 'breathe' ? 1 + breath * 0.04 : 1 - squeeze * 0.05; b.g.setAttribute('transform', `translate(${b.c[0]} ${b.c[1]}) scale(${k.toFixed(4)}) translate(${-b.c[0]} ${-b.c[1]})`); });
    angle = (angle + dt * 0.12) % 360;
    turners.forEach((t) => t.n.setAttribute('transform', `rotate(${angle.toFixed(1)} ${t.c[0]} ${t.c[1]})`));
    const push = beaters.some((b) => b.kind === 'beat') ? 1 + squeeze * 1.6 : 1; // (blood surges with each beat)
    flowEls.forEach((x) => { if (x.L > 4) x.dots.forEach((d) => { d.at = (d.at + dt * 0.05 * x.f.speed * push) % x.L; put(x, d); }); });
    if (moving && onScreen) raf2 = requestAnimationFrame(frame);
  }
  // (v337) a drawing about to be drawn shows nothing first: no kit drawing appears whole and is then redrawn
  if (animate) groups.forEach((g) => [...g.children].forEach((n) => { n.style.visibility = 'hidden'; }));
  const view = {
    hintText,
    // (v314) moving parts: move() starts them once the drawing is there (move(true) even with Reduce Motion); pause() stops them
    motion: flowEls.length > 0 || spec.parts.some((p) => p.beat || p.spin) || !!svg.querySelector('.ld-anim'), // (v327: and animals)
    get moving() { return moving; },
    move(force) {
      if (!view.motion) return false;
      flowG.style.display = ''; motionSetup(); lay();
      if (still() && !force) return false;
      moving = true; lastT = 0; if (io2) io2.observe(svg);
      svg.classList.add('ld-go'); svg.classList.toggle('ld-force', !!force && still()); // (v327) the animals walk, fly and swim
      if (!raf2) raf2 = requestAnimationFrame(frame);
      return true;
    },
    pause() { moving = false; if (raf2) cancelAnimationFrame(raf2); raf2 = 0; svg.classList.remove('ld-go'); },
    // (v314) one step at a time: the next part is picked out, with what it does and what moves through it
    stepNext() { const i = (picked + 1) % groups.length; picked = -1; pick(i); if (!moving) lay(); return i; },
    // (v306) the part a follow-up is about: the others dim, without changing what she says (a tap shows them all again)
    focus(i) { if (!groups[i]) return; picked = i; groups.forEach((g, k) => g.classList.toggle('dim', k !== i)); },
    unpick() { if (picked >= 0) pick(picked); },
    get strokes() { return groups.flatMap((g) => [...g.children]); },
    // one part at a time, for a player with its own pace (the extension's card)
    has: (i) => !!groups[i],
    hide(i) { if (!groups[i]) return; turns[i]++; dropLabel(i); for (const n of groups[i].children) { n.style.visibility = 'hidden'; n.style.transition = ''; n.style.strokeDasharray = n.getAttribute('stroke-dasharray') ? '' : ''; n.style.strokeDashoffset = ''; n.style.fillOpacity = ''; if (n.dataset.full != null) n.textContent = n.dataset.full; } },
    async show(i, atOnce, ms = 2400) {
      if (!groups[i]) return;
      const my = ++turns[i], kids = [...groups[i].children];
      dropLabel(i);
      if (atOnce || still()) {
        kids.forEach((n) => { n.style.visibility = ''; n.style.transition = ''; n.style.strokeDasharray = ''; n.style.strokeDashoffset = ''; n.style.fillOpacity = ''; if (n.dataset.full != null) n.textContent = n.dataset.full; });
        const l = placeLabel(i); labelEls[i] = l; if (l) { l.t.textContent = l.txt; l.g.dataset.done = '1'; }
        return;
      }
      kids.forEach((n) => { n.style.visibility = 'hidden'; });
      const each = Math.min(600, Math.max(140, (ms * 0.8) / Math.max(1, kids.length)));
      for (const n of kids) {
        if (my !== turns[i]) return;
        n.style.visibility = '';
        if (n.tagName === 'text') { const full = n.dataset.full != null ? n.dataset.full : (n.dataset.full = n.textContent); n.textContent = ''; for (let k = 1; k <= full.length; k++) { if (my !== turns[i]) { n.textContent = full; return; } n.textContent = full.slice(0, k); await sleep(18); } continue; }
        if (n.tagName === 'g') { n.style.opacity = '0'; void n.getBoundingClientRect(); n.style.transition = `opacity ${each}ms ease`; n.style.opacity = ''; await sleep(each); n.style.transition = ''; continue; } // (v324: a kit shape comes in whole)
        let L = 200; try { L = Math.max(8, Math.ceil(n.getTotalLength())); } catch (e) { /* */ }
        const dashed = n.getAttribute('stroke-dasharray');
        if (!dashed) { n.style.strokeDasharray = L; n.style.strokeDashoffset = L; } else n.style.opacity = '0';
        n.style.fillOpacity = '0';
        void n.getBoundingClientRect();
        n.style.transition = `stroke-dashoffset ${each}ms ease-in-out, opacity ${each}ms ease, fill-opacity .3s ease ${each}ms`;
        if (!dashed) n.style.strokeDashoffset = '0'; else n.style.opacity = '';
        n.style.fillOpacity = '';
        await sleep(each);
        if (my !== turns[i]) return;
        n.style.strokeDasharray = ''; n.style.strokeDashoffset = ''; n.style.transition = '';
      }
      if (my !== turns[i]) return;
      const l = placeLabel(i); labelEls[i] = l;
      if (l) { for (let k = 1; k <= l.txt.length; k++) { if (my !== turns[i]) return; l.t.textContent = l.txt.slice(0, k); await sleep(22); } l.g.dataset.done = '1'; }
    },
    async play(again) {
      if (!animate && !again) { // (finished: the names go on once the drawing has a size; a hidden chat measures as nothing)
        if (!placeAll()) { let tries = 0; const retry = () => { if (placeAll() || ++tries > 120 || (!svg.isConnected && tries > 5)) return; setTimeout(retry, 250); }; setTimeout(retry, 250); }
        return;
      }
      clearLabels();
      view.pause(); flowG.style.display = 'none'; beaters.forEach((b) => b.g.removeAttribute('transform')); turners.forEach((t) => t.n.removeAttribute('transform'));
      // everything hidden, then drawn: every stroke on its own, in order (0.3 to 0.6 s each, by its length)
      const all = groups.flatMap((g) => [...g.children]);
      all.forEach((n) => { n.style.visibility = 'hidden'; });
      // (v306) a follow-up: what was there already is there at once; only the parts it adds are drawn
      const old = (i) => !again && spec.fresh && !spec.fresh.includes(spec.parts[i].id);
      for (let i = 0; i < groups.length; i++) if (old(i)) { [...groups[i].children].forEach((n) => { n.style.visibility = ''; n.dataset.drawn = '1'; }); labelEls[i] = placeLabel(i); if (labelEls[i]) { labelEls[i].t.textContent = labelEls[i].txt; labelEls[i].g.dataset.done = '1'; } }
      if (spec.intro) await setSay(spec.intro, true);
      for (let i = 0; i < groups.length; i++) {
        if (old(i)) continue;
        const talk = setSay(spec.parts[i].say || spec.parts[i].label, true, spec.parts[i].label);
        for (const n of groups[i].children) {
          n.style.visibility = '';
          if (n.tagName === 'text') { const full = n.textContent; n.textContent = ''; for (let k = 1; k <= full.length; k++) { n.textContent = full.slice(0, k); await sleep(22); } continue; }
          if (n.tagName === 'g') { // (v324) a kit shape: all its outlines drawn at once, then its colours fill in
            const kids = [...n.children], dur = 700;
            kids.forEach((c) => { let L = 120; try { L = Math.max(8, Math.ceil(c.getTotalLength())); } catch (e) { /* */ } c.style.strokeDasharray = L; c.style.strokeDashoffset = L; c.style.fillOpacity = '0'; });
            void n.getBoundingClientRect();
            kids.forEach((c, k) => { const late = Math.round(k / kids.length * 260); c.style.transition = `stroke-dashoffset ${dur}ms ease-in-out ${late}ms, fill-opacity .45s ease ${Math.round(dur * 0.55) + late}ms`; c.style.strokeDashoffset = '0'; c.style.fillOpacity = ''; });
            n.dataset.drawing = '1'; await sleep(dur + 420);
            kids.forEach((c) => { c.style.strokeDasharray = ''; c.style.strokeDashoffset = ''; c.style.transition = ''; });
            delete n.dataset.drawing; n.dataset.drawn = '1';
            continue;
          }
          let L = 200; try { L = Math.max(8, Math.ceil(n.getTotalLength())); } catch (e) { /* */ }
          const dur = Math.round(Math.min(600, Math.max(300, L * 1.4)));
          n.style.strokeDasharray = L; n.style.strokeDashoffset = L; n.style.fillOpacity = '0'; n.dataset.drawing = '1';
          void n.getBoundingClientRect();
          n.style.transition = `stroke-dashoffset ${dur}ms ease-in-out, fill-opacity .35s ease ${dur}ms`;
          n.style.strokeDashoffset = '0'; n.style.fillOpacity = '';
          await sleep(dur);
          delete n.dataset.drawing; n.dataset.drawn = '1';
          n.style.strokeDasharray = n.classList.contains('ld-flow') ? '' : ''; n.style.strokeDashoffset = ''; n.style.transition = '';
        }
        // the part's name writes on after its last stroke
        const l = placeLabel(i); labelEls[i] = l;
        if (l) { for (let k = 1; k <= l.txt.length; k++) { l.t.textContent = l.txt.slice(0, k); await sleep(28); } l.g.dataset.done = '1'; }
        await talk; await sleep(250);
      }
    },
  };
  return view;
}
// ---------- (v324) the nature kit: trees, flowers, leaves, weather and the ground, drawn finished and alive ----------
// One shape each ({"t":"tree","kind":"oak","x":200,"y":230,"h":160}), drawn the way the owner's guide pictures are: soft,
// rounded, glossy like clay, every form outlined a shade darker, shaded underneath and lit from the top left. x and y are
// where it stands on the ground (a cloud, the sun, the moon, a snowflake: its middle); h (or w, r) its size.
const KIT = ['tree', 'flower', 'leaf', 'cloud', 'sun', 'moon', 'rainbow', 'snowflake', 'bolt', 'drops', 'grass', 'rock', 'log', 'mushroom', 'vehicle', 'animal', 'appliance', 'food']; // (v326: and vehicles; v327: animals; v328: appliances; v329: food)
const KIT_KINDS = {
  tree: ['round', 'oak', 'pine', 'bush', 'palm', 'blossom', 'fruit', 'autumn'],
  flower: ['sunflower', 'daisy', 'tulip', 'rose', 'lily', 'lavender', 'blossom', 'hydrangea'],
  leaf: ['oval', 'maple', 'oak', 'ginkgo', 'fern', 'heart'],
  cloud: ['white', 'rain', 'storm', 'snow', 'grey'],
  rock: ['stone', 'mossy'], log: ['log', 'stump'], grass: ['grass', 'flowers'],
  get vehicle() { return VEH_KINDS; },
  get appliance() { return APPL_KINDS; },
  get food() { return FOOD_KINDS; },
  get animal() { return ANIMAL_KINDS; },
};
// the box a kit shape fills (for the checks and the labels): [[x0, y0], [x1, y1]]
function kitBox(sh) {
  const t = String(sh.t || '').toLowerCase(), x = +sh.x, y = +sh.y, h = +sh.h || +sh.w || +sh.r * 2 || 60, w = +sh.w || h, r = +sh.r || h / 2;
  const rot = +sh.rot || 0;
  if (rot) { // (turned about where it stands: the four corners of its box, turned)
    const b = kitBox({ ...sh, rot: 0 }), a = rot * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    const mx = (b[0][0] + b[1][0]) / 2, my = (b[0][1] + b[1][1]) / 2, pts = [[mx, b[0][1]], [b[1][0], my], [mx, b[1][1]], [b[0][0], my]].map(([px, py]) => [x + (px - x) * c - (py - y) * s, y + (px - x) * s + (py - y) * c]);
    return [[Math.min(...pts.map((q) => q[0])), Math.min(...pts.map((q) => q[1]))], [Math.max(...pts.map((q) => q[0])), Math.max(...pts.map((q) => q[1]))]];
  }
  if (t === 'vehicle') return vehBox(sh); // (v326)
  if (t === 'animal') return animalBox(sh); // (v327)
  if (t === 'appliance') return applBox(sh); // (v328)
  if (t === 'food') return foodBox(sh); // (v329)
  if (t === 'tree') return [[x - h * (sh.kind === 'pine' ? 0.32 : 0.46), y - h], [x + h * (sh.kind === 'pine' ? 0.32 : 0.46), y]];
  if (t === 'flower' || t === 'mushroom') return [[x - h * 0.36, y - h], [x + h * 0.36, y]];
  if (t === 'leaf') return [[x - h * 0.42, y - h], [x + h * 0.42, y]];
  if (t === 'cloud') return [[x - w / 2, y - w * 0.3], [x + w / 2, y + (/rain|snow|storm/.test(sh.kind) ? w * 0.55 : w * 0.16)]];
  if (t === 'sun' || t === 'snowflake' || t === 'moon') return [[x - r * 1.4, y - r * 1.4], [x + r * 1.4, y + r * 1.4]];
  if (t === 'rainbow') return [[x - r, y - r], [x + r, y + r * 0.12]];
  if (t === 'bolt') return [[x - h * 0.3, y - h / 2], [x + h * 0.3, y + h / 2]];
  if (t === 'drops') return [[x - w / 2, y - w * 0.15], [x + w / 2, y + w * 0.45]];
  if (t === 'grass' || t === 'log') return [[x - w / 2, y - w * (t === 'log' ? 0.42 : 0.36)], [x + w / 2, y]];
  if (t === 'rock') return [[x - w / 2, y - w * 0.62], [x + w / 2, y]];
  return [[x, y]];
}
function kitMix(hex, to, k) { // a colour moved toward another (to darken or lighten it)
  const p = (h) => { h = h.replace('#', ''); if (h.length === 3) h = h.split('').map((c) => c + c).join(''); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };
  const a = p(hex), b = p(to);
  return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * k).toString(16).padStart(2, '0')).join('');
}
const kitDark = (c, k = 0.34) => kitMix(c, '#1b1410', k), kitLight = (c, k = 0.45) => kitMix(c, '#ffffff', k);
const kc = (x, y, r) => `M${(x - r).toFixed(1)},${y.toFixed(1)}a${r.toFixed(1)},${r.toFixed(1)} 0 1,0 ${(2 * r).toFixed(1)},0a${r.toFixed(1)},${r.toFixed(1)} 0 1,0 ${(-2 * r).toFixed(1)},0Z`;
const ke = (x, y, rx, ry, rot = 0) => { // an ellipse as a path, turned by rot degrees
  const a = rot * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), P = (u, v) => `${(x + u * c - v * s).toFixed(1)},${(y + u * s + v * c).toFixed(1)}`;
  return `M${P(-rx, 0)}A${rx.toFixed(1)},${ry.toFixed(1)} ${rot} 1,0 ${P(rx, 0)}A${rx.toFixed(1)},${ry.toFixed(1)} ${rot} 1,0 ${P(-rx, 0)}Z`;
};
const kpts = (pts) => 'M' + pts.map((q) => q[0].toFixed(1) + ',' + q[1].toFixed(1)).join('L') + 'Z';
// a smooth closed curve through points (Catmull-Rom as cubic Béziers): leaves, petals, rocks
function ksmooth(pts) {
  const n = pts.length, P = (i) => pts[(i + n) % n];
  let d = `M${P(0)[0].toFixed(1)},${P(0)[1].toFixed(1)}`;
  for (let i = 0; i < n; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    d += `C${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(1)},${(p1[1] + (p2[1] - p0[1]) / 6).toFixed(1)} ${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(1)},${(p2[1] - (p3[1] - p1[1]) / 6).toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d + 'Z';
}
// a seeded random, so a shape is drawn the same way every time
function krand(seed) { let s = Math.abs(Math.floor(seed)) % 2147483647 || 7; return () => (s = (s * 48271) % 2147483647) / 2147483647; }

// a list of layers: [d, fill, {stroke, w, op, line}]; built by the makers below
function kitLayers(t, kind, x, y, S, base, sh = {}) {
  const L = [], R = krand(x * 7 + y * 13 + S * 3);
  const put = (d, fill, o = {}) => L.push([d, fill, o]);
  // puffs: round lumps merged into one soft shape (a tree's crown, a bush, a cloud, a hydrangea): the outline under
  // them all, the fill over it, then each lump shaded below and lit above
  const puffs = (list, col, { shade = 0.28, lite = 0.5, line = null } = {}) => {
    const edge = line || kitDark(col, 0.42);
    list.forEach(([cx, cy, r]) => put(kc(cx, cy, r), col, { stroke: edge, w: Math.max(1.4, S * 0.012) }));
    list.forEach(([cx, cy, r]) => put(kc(cx, cy, r - 0.2), col, { stroke: 'none' }));
    const ys = list.map((q) => q[1]), mid = (Math.min(...ys) + Math.max(...ys)) / 2;
    list.forEach(([cx, cy, r]) => { if (cy >= mid - r * 0.4) put(kc(cx + r * 0.14, cy + r * 0.24, r * 0.7), kitDark(col, shade), { stroke: 'none', op: 0.38 }); });
    list.forEach(([cx, cy, r]) => { if (cy >= mid - r * 0.4) put(kc(cx - r * 0.12, cy - r * 0.12, r * 0.64), col, { stroke: 'none', op: 0.92 }); });
    list.forEach(([cx, cy, r]) => { if (cy <= mid) put(ke(cx - r * 0.3, cy - r * 0.4, r * 0.26, r * 0.15, -30), kitLight(col, lite), { stroke: 'none', op: 0.7 }); });
  };
  const trunk = (bx, by, h, wd, col) => { // a tapered trunk, its roots flaring into the ground
    const top = by - h, w0 = wd, w1 = wd * 0.55;
    put(`M${bx - w0 * 1.25},${by}C${bx - w0 * 0.6},${by - 3} ${bx - w0 * 0.5},${by - h * 0.18} ${bx - w1 / 2},${top}L${bx + w1 / 2},${top}C${bx + w0 * 0.5},${by - h * 0.18} ${bx + w0 * 0.6},${by - 3} ${bx + w0 * 1.25},${by}Z`, col, { stroke: kitDark(col, 0.4) });
    put(`M${bx + w1 * 0.05},${top + 2}C${bx + w0 * 0.3},${by - h * 0.3} ${bx + w0 * 0.35},${by - h * 0.1} ${bx + w0 * 0.9},${by - 1}`, 'none', { stroke: kitDark(col, 0.5), w: 1.2, line: true });
    put(`M${bx - w1 * 0.25},${top + h * 0.2}C${bx - w1 * 0.3},${by - h * 0.4} ${bx - w0 * 0.2},${by - h * 0.15} ${bx - w0 * 0.3},${by - 2}`, 'none', { stroke: kitLight(col, 0.35), w: 1.3, line: true, op: 0.7 });
  };
  const branch = (x0, y0, x1, y1, wd, col) => put(`M${x0 - wd / 2},${y0}Q${(x0 + x1) / 2},${(y0 + y1) / 2 + wd} ${x1},${y1}Q${(x0 + x1) / 2 + wd * 0.6},${(y0 + y1) / 2} ${x0 + wd / 2},${y0}Z`, col, { stroke: kitDark(col, 0.4), w: 1.1 });
  const leafShape = (cx, cy, len, ang, col, wide = 0.42) => { // one simple leaf with its midrib, from its stalk end
    const a = ang * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), P = (u, v) => [cx + u * c - v * s, cy + u * s + v * c];
    const pts = [P(0, 0), P(len * 0.3, -len * wide * 0.5), P(len * 0.7, -len * wide * 0.42), P(len, 0), P(len * 0.7, len * wide * 0.42), P(len * 0.3, len * wide * 0.5)];
    put(ksmooth(pts), col, { stroke: kitDark(col, 0.42) });
    put(ksmooth([P(len * 0.12, -len * wide * 0.12), P(len * 0.45, -len * wide * 0.36), P(len * 0.75, -len * wide * 0.2), P(len * 0.5, -len * wide * 0.06)]), kitLight(col, 0.4), { stroke: 'none', op: 0.6 });
    const m0 = P(len * 0.05, 0), m1 = P(len * 0.92, 0);
    put(`M${m0[0].toFixed(1)},${m0[1].toFixed(1)}L${m1[0].toFixed(1)},${m1[1].toFixed(1)}`, 'none', { stroke: kitDark(col, 0.3), w: 1, line: true, op: 0.8 });
  };
  const stem = (bx, by, top, col = '#6b9a48') => { // a flower's curving stem with a leaf each side
    put(`M${bx - 1.8},${by}C${bx - 3},${by - S * 0.3} ${bx + 3},${top + S * 0.25} ${bx - 1.2},${top}L${bx + 1.6},${top}C${bx + 5},${top + S * 0.25} ${bx - 0.4},${by - S * 0.3} ${bx + 1.8},${by}Z`, col, { stroke: kitDark(col, 0.4), w: 1.1 });
    leafShape(bx, by - S * 0.22, S * 0.3, 200, '#7fae58', 0.5); leafShape(bx, by - S * 0.3, S * 0.3, -20, '#7fae58', 0.5);
  };
  const ring = (cx, cy, n, dist, mk) => { for (let k = 0; k < n; k++) mk(cx + dist * Math.cos(k * 2 * Math.PI / n - Math.PI / 2), cy + dist * Math.sin(k * 2 * Math.PI / n - Math.PI / 2), k * 360 / n - 90); };
  const ground = (bx, by, w) => { put(ke(bx, by, w / 2, w * 0.09), '#86c25a', { stroke: kitDark('#86c25a', 0.35) }); put(ke(bx - w * 0.08, by - w * 0.02, w * 0.3, w * 0.04), kitLight('#86c25a', 0.35), { stroke: 'none', op: 0.7 }); };

  if (t === 'vehicle') vehLayers(kind, ['front', 'back', 'top'].includes(sh.view) ? sh.view : 'side', x, y, S, sh.facing === 'left' ? -1 : 1, base, put, puffs, R); // (v326)
  else if (t === 'tree') {
    const h = S, crownCol = base || { blossom: '#f3a3c2', autumn: '#e8963a', pine: '#2f7d4a' }[kind] || '#4f9e3c';
    if (kind === 'pine') {
      ground(x, y, h * 0.62); trunk(x, y, h * 0.3, h * 0.07, '#8a5a34');
      const tiers = 5;
      for (let k = 0; k < tiers; k++) { // stacked tiers, widest at the bottom, a soft wavy hem
        const ty = y - h * 0.22 - k * h * 0.15, tw = h * (0.32 - k * 0.05), th = h * 0.26, tip = ty - th;
        const hem = []; for (let j = 0; j <= 6; j++) hem.push([x + tw - j * tw / 3, ty + (j % 2 ? -3 : 2)]);
        put(`M${x},${tip}Q${x + tw * 0.35},${tip + th * 0.45} ${x + tw},${ty}` + hem.map((q) => `L${q[0].toFixed(1)},${q[1].toFixed(1)}`).join('') + `Q${x - tw * 0.35},${tip + th * 0.45} ${x},${tip}Z`, crownCol, { stroke: kitDark(crownCol, 0.45) });
        put(`M${x - 1},${tip + 3}Q${x - tw * 0.3},${tip + th * 0.5} ${x - tw * 0.8},${ty - 2}L${x - tw * 0.3},${ty - th * 0.2}Z`, kitLight(crownCol, 0.3), { stroke: 'none', op: 0.65 });
      }
    } else if (kind === 'palm') {
      ground(x, y, h * 0.5);
      const top = [x + h * 0.12, y - h * 0.8];
      put(`M${x - h * 0.05},${y}Q${x + h * 0.02},${y - h * 0.45} ${top[0] - h * 0.02},${top[1]}L${top[0] + h * 0.03},${top[1]}Q${x + h * 0.08},${y - h * 0.45} ${x + h * 0.05},${y}Z`, '#a7744a', { stroke: kitDark('#a7744a', 0.4) });
      for (let k = 1; k < 7; k++) { const yy = y - k * h * 0.11, xx = x + (k * h * 0.11 / (h * 0.8)) * h * 0.12; put(`M${xx - h * 0.035},${yy}Q${xx},${yy + 3} ${xx + h * 0.035},${yy}`, 'none', { stroke: '#7a5232', w: 1.2, line: true }); }
      [-160, -130, -95, -60, -25, 5].forEach((ang) => leafShape(top[0], top[1], h * 0.42, ang, '#3f9a4a', 0.32));
      [[top[0] - 4, top[1] + 6], [top[0] + 5, top[1] + 7], [top[0], top[1] + 11]].forEach(([cx, cy]) => put(kc(cx, cy, h * 0.035), '#8a5a2e', { stroke: '#5c3a1c' }));
    } else if (kind === 'bush') {
      ground(x, y, h * 1.1);
      const list = [];
      for (let k = 0; k < 5; k++) list.push([x + (k - 2) * h * 0.2, y - h * (0.2 + R() * 0.03), h * (0.17 + R() * 0.03)]);
      for (let k = 0; k < 3; k++) list.push([x + (k - 1) * h * 0.22, y - h * (0.42 + R() * 0.04), h * (0.18 + R() * 0.03)]);
      list.push([x, y - h * 0.58, h * 0.17]);
      puffs(list, crownCol);
    } else { // round, oak, blossom, fruit, autumn: a trunk that branches into a crown of soft lumps
      ground(x, y, h * 0.7);
      trunk(x, y, h * 0.55, h * 0.075, '#8a5a34');
      branch(x, y - h * 0.42, x - h * 0.2, y - h * 0.66, h * 0.035, '#8a5a34'); branch(x, y - h * 0.46, x + h * 0.2, y - h * 0.7, h * 0.035, '#8a5a34');
      const cy = y - h * 0.68, W = h * (kind === 'oak' ? 0.44 : 0.38), H = h * 0.3, list = [];
      const n = kind === 'oak' ? 13 : 11;
      for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2, rr = h * (0.13 + R() * 0.05); list.push([x + Math.cos(a) * W * 0.72, cy + Math.sin(a) * H * 0.72 - (Math.sin(a) < 0 ? h * 0.02 : 0), rr]); }
      list.push([x, cy - H * 0.2, h * 0.2], [x - W * 0.3, cy + H * 0.1, h * 0.16], [x + W * 0.3, cy + H * 0.05, h * 0.16]);
      puffs(list, crownCol);
      if (kind === 'fruit') for (let k = 0; k < 7; k++) { const fx = x + (R() - 0.5) * W * 1.4, fy = cy + (R() - 0.4) * H * 1.2; put(kc(fx, fy, h * 0.03), '#e8553c', { stroke: kitDark('#e8553c', 0.4) }); put(kc(fx - h * 0.009, fy - h * 0.01, h * 0.01), '#ffd9cf', { stroke: 'none', op: 0.8 }); }
      if (kind === 'blossom') for (let k = 0; k < 14; k++) put(kc(x + (R() - 0.5) * W * 1.6, cy + (R() - 0.5) * H * 1.5, h * 0.014), '#fff4f8', { stroke: 'none', op: 0.9 });
    }
  } else if (t === 'flower') {
    const h = S, top = y - h * 0.72, hr = h * 0.2;
    if (kind === 'lavender') {
      [[-0.12, 0.95], [0, 1.05], [0.12, 0.9]].forEach(([dx, k]) => {
        const sx = x + dx * h, st = y - h * k;
        put(`M${x + dx * h * 0.3},${y}Q${sx},${y - h * 0.3} ${sx},${st + h * 0.4}`, 'none', { stroke: '#6b9a48', w: 2.2, line: true });
        for (let j = 0; j < 7; j++) { const by = st + h * 0.4 - j * h * 0.075; put(ke(sx - h * 0.028, by, h * 0.032, h * 0.042, -20), '#9b7fd6', { stroke: '#6f56ae' }); put(ke(sx + h * 0.028, by - h * 0.03, h * 0.032, h * 0.042, 20), '#a98ee0', { stroke: '#6f56ae' }); }
      });
      leafShape(x, y - h * 0.08, h * 0.32, 205, '#7fae58', 0.32); leafShape(x, y - h * 0.08, h * 0.32, -25, '#7fae58', 0.32);
    } else if (kind === 'blossom') {
      stem(x, y, top);
      [[0, 0, 1], [-0.17, 0.12, 0.8], [0.15, -0.1, 0.75]].forEach(([dx, dy, k]) => {
        const cx = x + dx * h, cy = top + dy * h, rr = hr * 0.62 * k;
        ring(cx, cy, 5, rr * 0.75, (px, py, ang) => put(ke(px, py, rr * 0.62, rr * 0.55, ang), '#f7a6c3', { stroke: '#d9739a' }));
        put(kc(cx, cy, rr * 0.3), '#ffe39a', { stroke: '#e0b14a' });
      });
    } else if (kind === 'hydrangea') {
      stem(x, y, top + hr * 0.6);
      const list = []; for (let k = 0; k < 14; k++) { const a = k * 2.4, d = hr * Math.sqrt(k / 14) * 1.05; list.push([x + Math.cos(a) * d, top + Math.sin(a) * d * 0.85, hr * 0.32]); }
      puffs(list, base || '#b8a2ea', { shade: 0.25, lite: 0.6 });
      for (let k = 0; k < 8; k++) put(kc(x + (R() - 0.5) * hr * 1.6, top + (R() - 0.5) * hr * 1.3, h * 0.01), '#f6e9b8', { stroke: 'none' });
    } else {
      stem(x, y, top + hr * 0.4);
      if (kind === 'tulip') {
        const c = base || '#f08bb0', w = hr * 0.95, tp = top - hr * 0.95;
        put(ksmooth([[x - w, top - hr * 0.1], [x - w * 0.92, top + hr * 0.55], [x, top + hr * 0.82], [x + w * 0.92, top + hr * 0.55], [x + w, top - hr * 0.1], [x + w * 0.62, tp + hr * 0.25], [x + w * 0.3, top - hr * 0.25], [x, tp + hr * 0.05], [x - w * 0.3, top - hr * 0.25], [x - w * 0.62, tp + hr * 0.25]]), c, { stroke: kitDark(c, 0.38) });
        put(ksmooth([[x - w * 0.5, top + hr * 0.62], [x - w * 0.42, top - hr * 0.2], [x, tp], [x + w * 0.42, top - hr * 0.2], [x + w * 0.5, top + hr * 0.62], [x, top + hr * 0.8]]), kitDark(c, 0.06), { stroke: kitDark(c, 0.38) });
        put(ke(x - w * 0.55, top, hr * 0.14, hr * 0.38, 10), kitLight(c, 0.55), { stroke: 'none', op: 0.7 });
      } else if (kind === 'rose') {
        const c = base || '#ee7d9f';
        ring(x, top, 6, hr * 0.62, (px, py, ang) => put(ke(px, py, hr * 0.52, hr * 0.42, ang), kitDark(c, 0.06), { stroke: kitDark(c, 0.38) }));
        put(kc(x, top, hr * 0.62), c, { stroke: kitDark(c, 0.38) });
        put(`M${x},${top}m-${hr * 0.08},0a${hr * 0.1},${hr * 0.1} 0 1,1 ${hr * 0.18},0a${hr * 0.22},${hr * 0.22} 0 1,1 -${hr * 0.4},0a${hr * 0.34},${hr * 0.34} 0 1,1 ${hr * 0.66},0`, 'none', { stroke: kitDark(c, 0.36), w: 1.4, line: true });
        put(ke(x - hr * 0.3, top - hr * 0.3, hr * 0.16, hr * 0.09, -30), kitLight(c, 0.6), { stroke: 'none', op: 0.8 });
      } else if (kind === 'lily') {
        const c = base || '#fbe3ea';
        ring(x, top, 6, hr * 0.55, (px, py, ang) => { const a = ang * Math.PI / 180, tx = x + Math.cos(a) * hr * 1.25, ty = top + Math.sin(a) * hr * 1.25; put(ksmooth([[x, top], [px + Math.cos(a + 1.3) * hr * 0.3, py + Math.sin(a + 1.3) * hr * 0.3], [tx, ty], [px + Math.cos(a - 1.3) * hr * 0.3, py + Math.sin(a - 1.3) * hr * 0.3]]), c, { stroke: '#d98aa6' }); put(`M${x},${top}L${((x + tx) / 2).toFixed(1)},${((top + ty) / 2).toFixed(1)}`, 'none', { stroke: '#e79ab5', w: 2.2, line: true, op: 0.7 }); });
        for (let k = 0; k < 5; k++) { const a = -Math.PI / 2 + (k - 2) * 0.35; put(`M${x},${top}L${(x + Math.cos(a) * hr * 0.75).toFixed(1)},${(top + Math.sin(a) * hr * 0.75).toFixed(1)}`, 'none', { stroke: '#cfa74a', w: 1.2, line: true }); put(kc(x + Math.cos(a) * hr * 0.78, top + Math.sin(a) * hr * 0.78, h * 0.012), '#e0a63c', { stroke: 'none' }); }
      } else { // sunflower, daisy
        const sun = kind === 'sunflower', c = base || (sun ? '#f6c945' : '#fbf1de'), n = sun ? 12 : 14;
        ring(x, top, n, hr * 0.72, (px, py, ang) => { put(ke(px, py, hr * 0.42, hr * 0.2, ang), c, { stroke: kitDark(c, sun ? 0.32 : 0.22) }); put(ke(px - Math.cos(ang * Math.PI / 180) * hr * 0.06, py - hr * 0.04, hr * 0.2, hr * 0.07, ang), kitLight(c, 0.6), { stroke: 'none', op: 0.6 }); });
        const mid = sun ? '#6b4226' : '#f3c33e';
        put(kc(x, top, hr * (sun ? 0.46 : 0.34)), mid, { stroke: kitDark(mid, 0.4) });
        if (sun) for (let k = -2; k <= 2; k++) { put(`M${x + k * hr * 0.17},${top - hr * 0.42}L${x + k * hr * 0.17},${top + hr * 0.42}`, 'none', { stroke: kitDark(mid, 0.35), w: 0.9, line: true, op: 0.7 }); put(`M${x - hr * 0.42},${top + k * hr * 0.17}L${x + hr * 0.42},${top + k * hr * 0.17}`, 'none', { stroke: kitDark(mid, 0.35), w: 0.9, line: true, op: 0.7 }); }
        put(ke(x - hr * 0.14, top - hr * 0.16, hr * 0.14, hr * 0.08, -30), kitLight(mid, 0.55), { stroke: 'none', op: 0.75 });
      }
    }
  } else if (t === 'leaf') {
    const h = S, c = base || { maple: '#e8622f', ginkgo: '#e9b53a', oak: '#b9873a' }[kind] || '#4f9e46', tip = [x, y - h];
    put(`M${x},${y}L${x},${y - h * 0.18}`, 'none', { stroke: kitDark(c, 0.35), w: 2.4, line: true });
    if (kind === 'maple') {
      const pts = []; const lobes = [[-90, 1], [-40, 0.82], [-150, 0.82], [5, 0.6], [-185, 0.6]];
      for (let k = 0; k <= 20; k++) { const a = (-200 + k * 11) * Math.PI / 180, lobe = lobes.reduce((m, [la, lr]) => Math.max(m, lr * Math.exp(-((a * 180 / Math.PI - la) ** 2) / 220)), 0.3); pts.push([x + Math.cos(a) * h * 0.5 * (0.45 + lobe * 0.6), y - h * 0.42 + Math.sin(a) * h * 0.5 * (0.45 + lobe * 0.6)]); }
      put(kpts([[x, y - h * 0.18], ...pts]), c, { stroke: kitDark(c, 0.4) });
      [[-90, 1], [-40, 0.8], [-140, 0.8]].forEach(([a, k]) => { const r = a * Math.PI / 180; put(`M${x},${y - h * 0.2}L${(x + Math.cos(r) * h * 0.5 * k).toFixed(1)},${(y - h * 0.42 + Math.sin(r) * h * 0.5 * k).toFixed(1)}`, 'none', { stroke: kitDark(c, 0.3), w: 1, line: true }); });
    } else if (kind === 'ginkgo') {
      put(`M${x},${y - h * 0.18}C${x - h * 0.15},${y - h * 0.4} ${x - h * 0.52},${y - h * 0.62} ${x - h * 0.45},${y - h * 0.9}Q${x - h * 0.1},${y - h * 1.02} ${x},${y - h * 0.88}Q${x + h * 0.1},${y - h * 1.02} ${x + h * 0.45},${y - h * 0.9}C${x + h * 0.52},${y - h * 0.62} ${x + h * 0.15},${y - h * 0.4} ${x},${y - h * 0.18}Z`, c, { stroke: kitDark(c, 0.38) });
      for (let k = -3; k <= 3; k++) put(`M${x},${y - h * 0.2}L${(x + k * h * 0.12).toFixed(1)},${(y - h * 0.88).toFixed(1)}`, 'none', { stroke: kitDark(c, 0.22), w: 0.8, line: true, op: 0.7 });
    } else if (kind === 'fern') {
      put(`M${x},${y - h * 0.1}Q${x + h * 0.06},${y - h * 0.6} ${tip[0]},${tip[1]}`, 'none', { stroke: kitDark(c, 0.3), w: 1.6, line: true });
      for (let k = 1; k < 9; k++) { const yy = y - h * 0.1 - k * h * 0.1, len = h * 0.32 * (1 - k / 11); leafShape(x + 1, yy, len, -160 - k * 2, c, 0.35); leafShape(x + 1, yy, len, -20 + k * 2, c, 0.35); }
    } else if (kind === 'oak') {
      const pts = []; for (let k = 0; k <= 24; k++) { const v = k / 24, side = k <= 12 ? -1 : 1, t2 = k <= 12 ? v * 2 : (1 - v) * 2, w = Math.sin(t2 * Math.PI) * h * 0.26 * (0.75 + 0.25 * Math.cos(t2 * Math.PI * 8)); pts.push([x + side * w, y - h * 0.18 - t2 * h * 0.82 * (k <= 12 ? 1 : 1)]); }
      put(ksmooth(pts), c, { stroke: kitDark(c, 0.4) });
      put(`M${x},${y - h * 0.18}L${x},${y - h * 0.95}`, 'none', { stroke: kitDark(c, 0.3), w: 1, line: true });
    } else { // oval, heart: a broad leaf with a midrib and veins
      const wd = kind === 'heart' ? 0.5 : 0.3;
      const pts = [[x, y - h * 0.18], [x - h * wd, y - h * 0.4], [x - h * wd * 0.8, y - h * 0.72], [tip[0], tip[1]], [x + h * wd * 0.8, y - h * 0.72], [x + h * wd, y - h * 0.4]];
      put(ksmooth(pts), c, { stroke: kitDark(c, 0.4) });
      put(ksmooth([[x - h * 0.05, y - h * 0.3], [x - h * wd * 0.7, y - h * 0.48], [x - h * wd * 0.45, y - h * 0.75], [x - h * 0.04, y - h * 0.85]]), kitLight(c, 0.35), { stroke: 'none', op: 0.5 });
      put(`M${x},${y - h * 0.18}L${x},${y - h * 0.94}`, 'none', { stroke: kitDark(c, 0.3), w: 1.2, line: true });
      for (let k = 1; k <= 4; k++) { const yy = y - h * (0.2 + k * 0.15), sp = h * wd * (0.75 - Math.abs(k - 2) * 0.12); put(`M${x},${yy + h * 0.05}Q${x - sp * 0.5},${yy} ${x - sp},${yy - h * 0.06}M${x},${yy + h * 0.05}Q${x + sp * 0.5},${yy} ${x + sp},${yy - h * 0.06}`, 'none', { stroke: kitDark(c, 0.22), w: 0.9, line: true, op: 0.8 }); }
    }
  } else if (t === 'cloud') {
    const w = S, col = base || { storm: '#8b97b3', grey: '#c3ccd9' }[kind] || '#f3f6fb';
    if (kind === 'rain' || kind === 'snow' || kind === 'storm') {
      if (kind === 'snow') [-0.28, 0, 0.28, -0.14, 0.14].forEach((dx, k) => L.push(...kitLayers('snowflake', '', x + dx * w, y + w * (k < 3 ? 0.3 : 0.45), w * 0.07, '#9cc7f0')));
      else for (let k = 0; k < 5; k++) { const dx = (k - 2) * w * 0.15, dy = w * (k % 2 ? 0.42 : 0.3); put(`M${x + dx},${y + dy - w * 0.08}Q${x + dx + w * 0.045},${y + dy} ${x + dx},${y + dy + w * 0.03}Q${x + dx - w * 0.045},${y + dy} ${x + dx},${y + dy - w * 0.08}Z`, '#4aa3e8', { stroke: '#2b78bd' }); put(ke(x + dx - w * 0.012, y + dy - w * 0.005, w * 0.008, w * 0.014), '#d9efff', { stroke: 'none', op: 0.9 }); }
      if (kind === 'storm') L.push(...kitLayers('bolt', '', x + w * 0.05, y + w * 0.32, w * 0.45, ''));
    }
    const list = [[x - w * 0.3, y + w * 0.02, w * 0.17], [x - w * 0.1, y - w * 0.1, w * 0.23], [x + w * 0.14, y - w * 0.06, w * 0.21], [x + w * 0.33, y + w * 0.04, w * 0.14], [x, y + w * 0.06, w * 0.2]];
    puffs(list, col, { shade: kind === 'storm' ? 0.3 : 0.16, lite: 0.8, line: kitDark(col, 0.22) });
  } else if (t === 'sun') {
    const r = S, c = base || '#ffc93a';
    for (let k = 0; k < 12; k++) { const a = k * Math.PI / 6, a1 = a - 0.13, a2 = a + 0.13; put(kpts([[x + Math.cos(a1) * r * 1.12, y + Math.sin(a1) * r * 1.12], [x + Math.cos(a) * r * 1.55, y + Math.sin(a) * r * 1.55], [x + Math.cos(a2) * r * 1.12, y + Math.sin(a2) * r * 1.12]]), '#ffb21f', { stroke: '#e08a12' }); }
    put(kc(x, y, r), c, { stroke: kitDark(c, 0.3) });
    put(kc(x + r * 0.12, y + r * 0.16, r * 0.8), kitDark(c, 0.12), { stroke: 'none', op: 0.5 });
    put(ke(x - r * 0.35, y - r * 0.4, r * 0.32, r * 0.18, -35), kitLight(c, 0.7), { stroke: 'none', op: 0.85 });
  } else if (t === 'moon') {
    const r = S, c = base || '#ffd45c';
    put(`M${x + r * 0.25},${y - r}A${r},${r} 0 0,0 ${x + r * 0.25},${y + r}A${r * 1.3},${r * 1.3} 0 0,1 ${x + r * 0.25},${y - r}Z`, c, { stroke: kitDark(c, 0.3) });
    put(ke(x - r * 0.55, y - r * 0.25, r * 0.12, r * 0.3, 15), kitLight(c, 0.6), { stroke: 'none', op: 0.75 });
  } else if (t === 'rainbow') {
    const r = S, cols = ['#ef4b4b', '#f5933a', '#f7d046', '#5cc36a', '#4a9de0', '#8a6ad8'], band = r * 0.09;
    cols.forEach((c, k) => { const rr = r - k * band - band / 2; put(`M${x - rr},${y}A${rr},${rr} 0 0,1 ${x + rr},${y}`, 'none', { stroke: c, w: band * 0.98, line: true }); });
    [[x - r + band * 3, y + 2], [x + r - band * 3, y + 2]].forEach(([cx, cy]) => L.push(...kitLayers('cloud', 'white', cx, cy, r * 0.55, '')));
  } else if (t === 'snowflake') {
    const r = S, c = base || '#8ec3f2';
    for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3, ex = x + Math.cos(a) * r, ey = y + Math.sin(a) * r; put(`M${x},${y}L${ex.toFixed(1)},${ey.toFixed(1)}`, 'none', { stroke: c, w: Math.max(1.6, r * 0.16), line: true }); [0.55, 0.8].forEach((f) => { const bx = x + Math.cos(a) * r * f, by = y + Math.sin(a) * r * f; [0.7, -0.7].forEach((d) => put(`M${bx.toFixed(1)},${by.toFixed(1)}L${(bx + Math.cos(a + d) * r * 0.28).toFixed(1)},${(by + Math.sin(a + d) * r * 0.28).toFixed(1)}`, 'none', { stroke: c, w: Math.max(1.2, r * 0.11), line: true })); }); }
    put(kc(x, y, r * 0.16), kitLight(c, 0.3), { stroke: kitDark(c, 0.2) });
  } else if (t === 'bolt') {
    const h = S, c = base || '#ffcc33';
    put(kpts([[x + h * 0.1, y - h / 2], [x - h * 0.22, y + h * 0.06], [x - h * 0.02, y + h * 0.06], [x - h * 0.12, y + h / 2], [x + h * 0.24, y - h * 0.08], [x + h * 0.03, y - h * 0.08], [x + h * 0.16, y - h / 2]]), c, { stroke: kitDark(c, 0.35) });
  } else if (t === 'drops') {
    const w = S;
    for (let k = 0; k < 5; k++) { const dx = (k - 2) * w * 0.2, dy = w * (k % 2 ? 0.25 : 0.05); put(`M${x + dx},${y + dy - w * 0.1}Q${x + dx + w * 0.06},${y + dy} ${x + dx},${y + dy + w * 0.04}Q${x + dx - w * 0.06},${y + dy} ${x + dx},${y + dy - w * 0.1}Z`, '#4aa3e8', { stroke: '#2b78bd' }); }
  } else if (t === 'grass') {
    const w = S;
    for (let k = 0; k < 13; k++) { const bx = x + (k / 12 - 0.5) * w * 0.8, hh = w * (0.22 + R() * 0.14), lean = (R() - 0.5) * w * 0.12, col = k % 3 ? '#5aa83e' : '#7fc24f'; put(`M${bx - w * 0.025},${y}Q${bx + lean * 0.3},${y - hh * 0.6} ${bx + lean},${y - hh}Q${bx + lean * 0.3 + w * 0.02},${y - hh * 0.55} ${bx + w * 0.025},${y}Z`, col, { stroke: kitDark(col, 0.35), w: 1 }); }
    if (kind === 'flowers') [[-0.25, 0.3, '#f26b8a'], [0.05, 0.36, '#ffd45c'], [0.28, 0.28, '#fbf1de']].forEach(([dx, dy, c]) => { ring(x + dx * w, y - dy * w, 5, w * 0.03, (px, py, ang) => put(ke(px, py, w * 0.03, w * 0.022, ang), c, { stroke: kitDark(c, 0.3), w: 0.8 })); put(kc(x + dx * w, y - dy * w, w * 0.016), '#f3b23e', { stroke: 'none' }); });
  } else if (t === 'rock') {
    const w = S, c = base || '#9c9a8c', pts = [];
    for (let k = 0; k < 8; k++) { const a = Math.PI + k * Math.PI / 7, rr = 0.85 + R() * 0.2; pts.push([x + Math.cos(a) * w * 0.5 * rr, y + Math.min(0, Math.sin(a)) * w * 0.6 * rr]); }
    put(ksmooth(pts), c, { stroke: kitDark(c, 0.45) });
    put(ksmooth([[x - w * 0.05, y - w * 0.55], [x + w * 0.3, y - w * 0.4], [x + w * 0.42, y - w * 0.05], [x + w * 0.1, y - w * 0.15]]), kitDark(c, 0.18), { stroke: 'none', op: 0.6 });
    put(ksmooth([[x - w * 0.35, y - w * 0.3], [x - w * 0.15, y - w * 0.5], [x + w * 0.02, y - w * 0.45], [x - w * 0.2, y - w * 0.3]]), kitLight(c, 0.4), { stroke: 'none', op: 0.65 });
    put(`M${x - w * 0.05},${y - w * 0.55}L${x + w * 0.05},${y - w * 0.3}L${x - w * 0.02},${y - w * 0.12}`, 'none', { stroke: kitDark(c, 0.4), w: 1, line: true, op: 0.7 });
    if (kind === 'mossy') { put(`M${x - w * 0.42},${y - w * 0.3}Q${x - w * 0.2},${y - w * 0.7} ${x + w * 0.15},${y - w * 0.58}Q${x + w * 0.4},${y - w * 0.5} ${x + w * 0.42},${y - w * 0.3}Q${x + w * 0.2},${y - w * 0.38} ${x},${y - w * 0.34}Q${x - w * 0.22},${y - w * 0.24} ${x - w * 0.42},${y - w * 0.3}Z`, '#8cc04a', { stroke: kitDark('#8cc04a', 0.35) }); put(ke(x - w * 0.1, y - w * 0.52, w * 0.12, w * 0.04, -10), kitLight('#8cc04a', 0.5), { stroke: 'none', op: 0.7 }); }
  } else if (t === 'log') {
    const w = S, bark = '#8a5a34', wood = '#e2b77a';
    if (kind === 'stump') {
      const h = w * 0.42, top = y - h, rx = w * 0.32, ry = w * 0.1;
      put(`M${x - rx},${top}L${x - rx * 1.05},${y - h * 0.25}Q${x - rx * 1.5},${y} ${x - rx * 1.6},${y}L${x + rx * 1.6},${y}Q${x + rx * 1.5},${y} ${x + rx * 1.05},${y - h * 0.25}L${x + rx},${top}Z`, bark, { stroke: kitDark(bark, 0.4) });
      [-0.5, 0, 0.5].forEach((f) => put(`M${x + f * rx},${top + ry}L${x + f * rx * 1.1},${y - 2}`, 'none', { stroke: kitDark(bark, 0.35), w: 1, line: true }));
      put(ke(x, top, rx, ry), wood, { stroke: kitDark(wood, 0.4) });
      [0.7, 0.45, 0.2].forEach((k) => put(ke(x, top, rx * k, ry * k), 'none', { stroke: kitDark(wood, 0.25), w: 0.9, line: true }));
    } else {
      const h = w * 0.34, ry = h / 2, rx = ry * 0.45, x0 = x - w / 2 + rx, x1 = x + w / 2 - rx, cy = y - ry;
      put(`M${x0},${cy - ry}L${x1},${cy - ry}A${rx},${ry} 0 0,1 ${x1},${cy + ry}L${x0},${cy + ry}Z`, bark, { stroke: kitDark(bark, 0.4) });
      put(`M${x0 + w * 0.12},${cy - ry * 0.4}L${x1 - w * 0.2},${cy - ry * 0.4}M${x0 + w * 0.25},${cy + ry * 0.3}L${x1 - w * 0.05},${cy + ry * 0.3}`, 'none', { stroke: kitDark(bark, 0.35), w: 1, line: true });
      put(ke(x0, cy, rx, ry), wood, { stroke: kitDark(wood, 0.4) });
      [0.65, 0.35].forEach((k) => put(ke(x0, cy, rx * k, ry * k), 'none', { stroke: kitDark(wood, 0.25), w: 0.9, line: true }));
    }
  } else if (t === 'mushroom') {
    const h = S, cap = base || '#e0714f';
    put(`M${x - h * 0.1},${y}Q${x - h * 0.13},${y - h * 0.3} ${x - h * 0.08},${y - h * 0.55}L${x + h * 0.08},${y - h * 0.55}Q${x + h * 0.13},${y - h * 0.3} ${x + h * 0.1},${y}Z`, '#f4e9d6', { stroke: '#c9b79a' });
    put(`M${x - h * 0.42},${y - h * 0.52}Q${x - h * 0.4},${y - h} ${x},${y - h}Q${x + h * 0.4},${y - h} ${x + h * 0.42},${y - h * 0.52}Q${x},${y - h * 0.44} ${x - h * 0.42},${y - h * 0.52}Z`, cap, { stroke: kitDark(cap, 0.38) });
    [[-0.2, 0.75, 0.06], [0.08, 0.86, 0.05], [0.22, 0.66, 0.045], [-0.02, 0.62, 0.035]].forEach(([dx, dy, r]) => put(kc(x + dx * h, y - dy * h, r * h), '#fff6ec', { stroke: 'none', op: 0.95 }));
  }
  return L;
}
function kitShape(s, mk) {
  const t = String(s.t || '').toLowerCase(), list = KIT_KINDS[t], kind = list ? (list.includes(String(s.kind || '').toLowerCase()) ? String(s.kind).toLowerCase() : list[0]) : '';
  const N = (v, lo, hi, d) => { v = +v; return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; };
  const x = N(s.x ?? s.cx, -40, 440, 200), y = N(s.y ?? s.cy, -40, 300, 200);
  const S = ['cloud', 'grass', 'rock', 'log', 'drops', 'vehicle'].includes(t) ? N(s.w ?? s.size ?? s.h, 10, 400, 90)
    : ['sun', 'moon', 'snowflake', 'rainbow'].includes(t) ? N(s.r ?? (s.size ? s.size / 2 : null), 4, 160, t === 'rainbow' ? 80 : 24) : N(s.h ?? s.size, 10, 260, 100);
  const base = typeof s.fill === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(s.fill) ? s.fill : null; // (its own colour, if one is given)
  const g = mk('g', { class: 'ld-kit' });
  const rot = N(s.rot, -180, 180, 0); if (rot) g.setAttribute('transform', `rotate(${rot} ${x} ${y})`); // (a leaf turned to lie the way it grows)
  for (const [d, fill, o] of kitLayers(t, kind, x, y, S, base, s)) {
    const e = mk('path', { d, fill: fill || 'none', stroke: o.stroke || 'none', 'stroke-width': o.w || 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
    if (fill && fill !== 'none') e.setAttribute('fill-opacity', o.op != null ? o.op : 1);
    if (o.line && o.op != null) e.setAttribute('stroke-opacity', o.op);
    g.appendChild(e);
  }
  return g;
}

// ---------- (v326) the vehicle kit: cars, buses, trucks, trains, bikes, planes, boats and more, drawn whole ----------
// {"t":"vehicle","kind":"sedan","x":200,"y":200,"w":220,"view":"side","facing":"right"}: x is its middle, y the ground
// under its wheels (a plane's or boat's: its bottom; the sea is y), w its length. Cars, vans, buses and trucks can be
// drawn from the "side", "front", "back" or "top". In the owner's guide pictures' style: soft, rounded, glossy, outlined
// a shade darker, lit from the top left. VEH_SHAPES below is the one shared description of each road vehicle's body
// (its side profile, wheels and windows, in parts of its length), used flat and in 3D, so both always agree.
const VEH_KINDS = ['sedan', 'sports', 'hatchback', 'suv', 'pickup', 'van', 'taxi', 'police', 'classic', 'ambulance', 'bus', 'schoolbus', 'truck', 'dumptruck', 'firetruck', 'tractor', 'excavator', 'bulldozer', 'train', 'bicycle', 'motorcycle', 'scooter', 'airplane', 'helicopter', 'boat', 'ship', 'sailboat', 'rowboat', 'submarine', 'rocket', 'balloon', 'drone'];
// u: along its length, -0.5 the back to 0.5 the front; v: height above the ground; both in parts of its length
const VEH_SHAPES = {
  sedan: { top: [[-0.5, 0.1], [-0.5, 0.21], [-0.44, 0.25], [-0.3, 0.27], [-0.17, 0.41], [0.07, 0.42], [0.22, 0.28], [0.42, 0.245], [0.5, 0.2], [0.5, 0.1]], wheels: [[-0.3, 0.1], [0.3, 0.1]], glass: [[[-0.27, 0.29], [-0.16, 0.395], [-0.05, 0.4], [-0.05, 0.29]], [[-0.02, 0.29], [-0.02, 0.4], [0.07, 0.405], [0.19, 0.29]]], belt: 0.28, wide: 0.42, col: '#c63a2f' },
  sports: { top: [[-0.5, 0.1], [-0.5, 0.2], [-0.42, 0.23], [-0.25, 0.25], [-0.1, 0.34], [0.06, 0.345], [0.2, 0.25], [0.42, 0.19], [0.5, 0.15], [0.5, 0.09]], wheels: [[-0.32, 0.1], [0.32, 0.095]], glass: [[[-0.2, 0.258], [-0.09, 0.33], [0.04, 0.335], [0.16, 0.258]]], belt: 0.25, wide: 0.45, col: '#f06a1c' },
  hatchback: { top: [[-0.5, 0.1], [-0.5, 0.3], [-0.44, 0.4], [-0.3, 0.45], [0.05, 0.45], [0.22, 0.3], [0.42, 0.26], [0.5, 0.2], [0.5, 0.1]], wheels: [[-0.32, 0.11], [0.3, 0.11]], glass: [[[-0.42, 0.31], [-0.37, 0.41], [-0.27, 0.43], [-0.08, 0.43], [-0.08, 0.31]], [[-0.05, 0.31], [-0.05, 0.43], [0.04, 0.43], [0.18, 0.31]]], belt: 0.3, wide: 0.45, col: '#3a7bd5' },
  suv: { top: [[-0.5, 0.12], [-0.5, 0.42], [-0.47, 0.5], [0.1, 0.51], [0.22, 0.36], [0.44, 0.33], [0.5, 0.27], [0.5, 0.12]], wheels: [[-0.3, 0.13], [0.3, 0.13]], glass: [[[-0.45, 0.37], [-0.44, 0.47], [-0.18, 0.475], [-0.18, 0.37]], [[-0.15, 0.37], [-0.15, 0.475], [0.08, 0.475], [0.18, 0.37]]], belt: 0.36, wide: 0.44, col: '#2f4558' },
  pickup: { top: [[-0.5, 0.12], [-0.5, 0.3], [-0.08, 0.3], [-0.08, 0.48], [0.1, 0.48], [0.22, 0.34], [0.44, 0.31], [0.5, 0.25], [0.5, 0.12]], wheels: [[-0.31, 0.12], [0.3, 0.12]], glass: [[[-0.05, 0.345], [-0.05, 0.45], [0.09, 0.45], [0.19, 0.345]]], belt: 0.33, wide: 0.42, col: '#55703f' },
  van: { top: [[-0.5, 0.11], [-0.5, 0.56], [-0.46, 0.6], [0.22, 0.6], [0.36, 0.42], [0.47, 0.34], [0.5, 0.27], [0.5, 0.11]], wheels: [[-0.32, 0.11], [0.32, 0.11]], glass: [[[0.04, 0.43], [0.04, 0.56], [0.21, 0.56], [0.32, 0.43]]], belt: 0.42, wide: 0.4, col: '#eef0f2' },
  classic: { top: [[-0.5, 0.12], [-0.5, 0.26], [-0.44, 0.29], [-0.3, 0.27], [-0.2, 0.4], [0.06, 0.41], [0.17, 0.28], [0.44, 0.26], [0.5, 0.2], [0.5, 0.12]], wheels: [[-0.3, 0.1], [0.3, 0.1]], glass: [[[-0.27, 0.29], [-0.18, 0.39], [-0.05, 0.395], [-0.05, 0.29]], [[-0.02, 0.29], [-0.02, 0.395], [0.06, 0.4], [0.15, 0.29]]], belt: 0.28, wide: 0.38, col: '#c8382f' },
  bus: { top: [[-0.5, 0.08], [-0.5, 0.35], [-0.48, 0.37], [0.47, 0.37], [0.5, 0.33], [0.5, 0.08]], wheels: [[-0.31, 0.065], [0.32, 0.065]], glass: [], belt: 0.2, wide: 0.21, col: '#f2b51a' },
  schoolbus: { top: [[-0.5, 0.08], [-0.5, 0.35], [-0.48, 0.37], [0.32, 0.37], [0.34, 0.3], [0.36, 0.22], [0.48, 0.2], [0.5, 0.17], [0.5, 0.08]], wheels: [[-0.3, 0.065], [0.38, 0.065]], glass: [], belt: 0.2, wide: 0.21, col: '#f7c11e' },
  truck: { top: [[0.18, 0.1], [0.18, 0.45], [0.34, 0.45], [0.42, 0.31], [0.5, 0.27], [0.5, 0.1]], wheels: [[-0.36, 0.08], [-0.2, 0.08], [0.34, 0.08]], glass: [[[0.25, 0.3], [0.25, 0.42], [0.33, 0.42], [0.4, 0.3]]], belt: 0.3, wide: 0.3, col: '#2f6fd1' },
  dumptruck: { top: [[0.18, 0.1], [0.18, 0.47], [0.34, 0.47], [0.42, 0.33], [0.5, 0.29], [0.5, 0.1]], wheels: [[-0.32, 0.1], [-0.12, 0.1], [0.34, 0.1]], glass: [[[0.25, 0.32], [0.25, 0.44], [0.33, 0.44], [0.4, 0.32]]], belt: 0.32, wide: 0.34, col: '#f2a21c' },
  firetruck: { top: [[-0.5, 0.09], [-0.5, 0.36], [0.2, 0.36], [0.2, 0.4], [0.42, 0.4], [0.48, 0.3], [0.5, 0.24], [0.5, 0.09]], wheels: [[-0.35, 0.075], [-0.22, 0.075], [0.33, 0.075]], glass: [[[0.23, 0.26], [0.23, 0.37], [0.34, 0.37], [0.34, 0.26]], [[0.37, 0.26], [0.37, 0.37], [0.42, 0.37], [0.46, 0.26]]], belt: 0.26, wide: 0.26, col: '#d6302a' },
  train: { top: [[-0.5, 0.05], [-0.5, 0.25], [-0.49, 0.27], [0.28, 0.27], [0.4, 0.24], [0.48, 0.16], [0.5, 0.09], [0.48, 0.05]], wheels: [[-0.4, 0.025], [-0.32, 0.025], [0.26, 0.025], [0.34, 0.025]], glass: [[[0.37, 0.17], [0.42, 0.235], [0.47, 0.18], [0.45, 0.16]]], belt: 0.16, wide: 0.12, col: '#e3e6ea' },
};
const VEH_OF = { taxi: 'sedan', police: 'sedan', ambulance: 'van' };
// the box it fills (for the checks and the labels)
function vehBox(sh) {
  const x = +sh.x, y = +sh.y, w = +sh.w || 200, k = String(sh.kind || 'sedan'), view = sh.view;
  const P = VEH_SHAPES[VEH_OF[k] || k];
  if (P && (view === 'front' || view === 'back')) { const W = w, H = Math.max(...P.top.map((q) => q[1])) / P.wide * W; return [[x - W / 2, y - H], [x + W / 2, y]]; }
  if (P && view === 'top') return [[x - w / 2, y - w * P.wide / 2], [x + w / 2, y + w * P.wide / 2]];
  const tall = P ? Math.max(...P.top.map((q) => q[1])) + (k === 'police' || k === 'taxi' || k === 'ambulance' ? 0.05 : 0) + (k === 'firetruck' ? 0.07 : 0)
    : ({ bicycle: 0.6, motorcycle: 0.55, scooter: 0.6, airplane: 0.42, helicopter: 0.42, boat: 0.32, ship: 0.42, sailboat: 1.0, rowboat: 0.2, submarine: 0.3, tractor: 0.6, excavator: 0.75, bulldozer: 0.5, balloon: 1.4, drone: 0.3, rocket: 1 })[k] || 0.5;
  if (k === 'rocket') return [[x - w * 0.16, y - w], [x + w * 0.16, y]];
  if (k === 'balloon') return [[x - w * 0.5, y - w * 1.4], [x + w * 0.5, y]];
  return [[x - w / 2, y - w * tall], [x + w / 2, y]];
}
// the layers of one vehicle, in the nature kit's put() style
function vehLayers(kind, view, x, y, w, dir, base, put, puffs, R) {
  const P = VEH_SHAPES[VEH_OF[kind] || kind];
  const X = (u) => x + dir * u * w, Y = (v) => y - v * w;
  const col = base || { taxi: '#f6c21c', police: '#f4f6f8', ambulance: '#f7f8fa' }[kind] || (P ? P.col : '#c63a2f');
  const dark = (c, k = 0.4) => kitDark(c, k), lite = (c, k = 0.45) => kitLight(c, k);
  const glassC = '#2a3644', tyre = '#23262c', rim = '#c9ced6';
  const poly = (pts) => ksmooth(pts.map(([u, v]) => [X(u), Y(v)]));
  const sharp = (pts) => kpts(pts.map(([u, v]) => [X(u), Y(v)]));
  const rr = (u0, v0, u1, v1, rad = 0.008) => { const xa = Math.min(X(u0), X(u1)), xb = Math.max(X(u0), X(u1)), ya = Math.min(Y(v0), Y(v1)), yb = Math.max(Y(v0), Y(v1)), r = Math.min(rad * w, (xb - xa) / 2, (yb - ya) / 2);
    return `M${(xa + r).toFixed(1)},${ya.toFixed(1)}L${(xb - r).toFixed(1)},${ya.toFixed(1)}Q${xb.toFixed(1)},${ya.toFixed(1)} ${xb.toFixed(1)},${(ya + r).toFixed(1)}L${xb.toFixed(1)},${(yb - r).toFixed(1)}Q${xb.toFixed(1)},${yb.toFixed(1)} ${(xb - r).toFixed(1)},${yb.toFixed(1)}L${(xa + r).toFixed(1)},${yb.toFixed(1)}Q${xa.toFixed(1)},${yb.toFixed(1)} ${xa.toFixed(1)},${(yb - r).toFixed(1)}L${xa.toFixed(1)},${(ya + r).toFixed(1)}Q${xa.toFixed(1)},${ya.toFixed(1)} ${(xa + r).toFixed(1)},${ya.toFixed(1)}Z`; };
  const line = (pts, c, wd = 1.2, op) => put('M' + pts.map(([u, v]) => `${X(u).toFixed(1)},${Y(v).toFixed(1)}`).join('L'), 'none', { stroke: c, w: wd, line: true, ...(op != null ? { op } : {}) });
  const wheel = (u, r, white = false) => {
    put(kc(X(u), Y(r), r * w), tyre, { stroke: '#111317' });
    if (white) put(kc(X(u), Y(r), r * w * 0.72), '#f2efe6', { stroke: 'none' });
    put(kc(X(u), Y(r), r * w * 0.56), rim, { stroke: dark(rim, 0.3) });
    for (let k = 0; k < 5; k++) { const a = k * Math.PI * 2 / 5 + 0.3; put(`M${X(u).toFixed(1)},${Y(r).toFixed(1)}L${(X(u) + Math.cos(a) * r * w * 0.5).toFixed(1)},${(Y(r) + Math.sin(a) * r * w * 0.5).toFixed(1)}`, 'none', { stroke: dark(rim, 0.35), w: Math.max(1, r * w * 0.12), line: true }); }
    put(kc(X(u), Y(r), r * w * 0.16), dark(rim, 0.2), { stroke: 'none' });
    put(ke(X(u) - r * w * 0.25, Y(r) - r * w * 0.3, r * w * 0.16, r * w * 0.08, -30), '#ffffff', { stroke: 'none', op: 0.35 });
  };
  const ground = () => put(ke(x, y + 1, w * 0.52, Math.max(2, w * 0.03)), '#000000', { stroke: 'none', op: 0.14 });

  if (P && (view === 'front' || view === 'back')) { // ---- from the front or the back: w is its width
    const W = w, s = W / P.wide, roof = Math.max(...P.top.map((q) => q[1])) * s, belt = P.belt * s, clear = P.wheels[0][1] * s * 0.55, cx = x;
    const B = (fx, v) => [cx + fx * W / 2, y - v]; // (fx: -1 left side to 1 right side)
    ground();
    [-0.78, 0.78].forEach((fx) => put(`M${B(fx - 0.14, 0)}L${B(fx + 0.14, 0)}L${B(fx + 0.14, clear * 2.2)}L${B(fx - 0.14, clear * 2.2)}Z`, tyre, { stroke: '#111317' }));
    const body = [B(-1, clear), B(-1, belt * 0.92), B(-0.92, belt), B(0.92, belt), B(1, belt * 0.92), B(1, clear)];
    put(ksmooth(body), col, { stroke: dark(col) });
    const cab = [B(-0.82, belt), B(-0.66, roof * 0.97), B(-0.6, roof), B(0.6, roof), B(0.66, roof * 0.97), B(0.82, belt)];
    put(ksmooth(cab), col, { stroke: dark(col) });
    put(ksmooth([B(-0.74, belt + (roof - belt) * 0.08), B(-0.62, roof * 0.93), B(0.62, roof * 0.93), B(0.74, belt + (roof - belt) * 0.08)]), view === 'back' ? '#33404f' : glassC, { stroke: dark(glassC, 0.3) });
    put(ksmooth([B(-0.6, roof * 0.9), B(-0.45, roof * 0.9), B(-0.62, belt + (roof - belt) * 0.2)]), '#ffffff', { stroke: 'none', op: 0.22 });
    [-1, 1].forEach((sd) => put(ke(cx + sd * W * 0.56, y - belt * 0.98, W * 0.06, W * 0.035), col, { stroke: dark(col) }));
    if (view === 'front') {
      [-1, 1].forEach((sd) => { put(ke(cx + sd * W * 0.36, y - belt * 0.72, W * 0.11, W * 0.045, sd * 6), '#fff6d8', { stroke: dark('#d8d0b0', 0.3) }); put(ke(cx + sd * W * 0.34, y - belt * 0.74, W * 0.04, W * 0.018), '#ffffff', { stroke: 'none' }); });
      put(ksmooth([B(-0.32, belt * 0.42), B(-0.3, belt * 0.62), B(0.3, belt * 0.62), B(0.32, belt * 0.42)]), '#2b2f36', { stroke: '#15171b' });
      [0.48, 0.55].forEach((f) => put(`M${B(-0.28, belt * f)}L${B(0.28, belt * f)}`, 'none', { stroke: '#4a515b', w: 1, line: true }));
    } else {
      [-1, 1].forEach((sd) => put(ksmooth([B(sd * 0.95, belt * 0.62), B(sd * 0.95, belt * 0.85), B(sd * 0.6, belt * 0.85), B(sd * 0.6, belt * 0.68)]), '#d7262b', { stroke: '#8f1416' }));
      put(`M${B(-0.18, belt * 0.32)}L${B(0.18, belt * 0.32)}L${B(0.18, belt * 0.5)}L${B(-0.18, belt * 0.5)}Z`, '#f4f1e6', { stroke: '#8e8a7c' });
    }
    { const a = B(-0.97, clear), b = B(0.97, clear + belt * 0.16), r = belt * 0.06; put(`M${a[0] + r},${b[1]}L${b[0] - r},${b[1]}Q${b[0]},${b[1]} ${b[0]},${b[1] + r}L${b[0]},${a[1] - r}Q${b[0]},${a[1]} ${b[0] - r},${a[1]}L${a[0] + r},${a[1]}Q${a[0]},${a[1]} ${a[0]},${a[1] - r}L${a[0]},${b[1] + r}Q${a[0]},${b[1]} ${a[0] + r},${b[1]}Z`, dark(col, 0.25), { stroke: dark(col) }); }
    if (kind === 'taxi') put(`M${B(-0.18, roof)}L${B(0.18, roof)}L${B(0.15, roof + W * 0.07)}L${B(-0.15, roof + W * 0.07)}Z`, '#ffe27a', { stroke: '#b8961c' });
    if (kind === 'police' || kind === 'ambulance') { put(`M${B(-0.4, roof)}L${B(0, roof)}L${B(0, roof + W * 0.05)}L${B(-0.4, roof + W * 0.05)}Z`, '#d8262b', { stroke: '#8f1416' }); put(`M${B(0, roof)}L${B(0.4, roof)}L${B(0.4, roof + W * 0.05)}L${B(0, roof + W * 0.05)}Z`, '#2463d6', { stroke: '#163f8a' }); }
    return;
  }
  if (P && view === 'top') { // ---- from above: the roof, the glass, the hood and the boot
    const L = w, Wd = w * P.wide, x0 = x - L / 2, y0 = y - Wd / 2, T = (u, f) => [x + dir * u * L, y + f * Wd / 2];
    put(ksmooth([T(-0.5, -0.8), T(-0.48, -0.97), T(-0.3, -1), T(0.35, -1), T(0.48, -0.95), T(0.5, -0.7), T(0.5, 0.7), T(0.48, 0.95), T(0.35, 1), T(-0.3, 1), T(-0.48, 0.97), T(-0.5, 0.8)]), col, { stroke: dark(col) });
    P.wheels.forEach(([u, r]) => [-1, 1].forEach((f) => put(ksmooth([T(u - r * 0.9, f * 1.02), T(u + r * 0.9, f * 1.02), T(u + r * 0.9, f * 0.86), T(u - r * 0.9, f * 0.86)]), tyre, { stroke: '#111317' })));
    put(ksmooth([T(-0.5, -0.8), T(-0.48, -0.97), T(-0.3, -1), T(0.35, -1), T(0.48, -0.95), T(0.5, -0.7), T(0.5, 0.7), T(0.48, 0.95), T(0.35, 1), T(-0.3, 1), T(-0.48, 0.97), T(-0.5, 0.8)]), col, { stroke: dark(col) });
    const gx = P.glass.length ? P.glass : [[[-0.3, 0], [0.2, 0]]], g0 = Math.min(...gx.flat().map((q) => q[0])), g1 = Math.max(...gx.flat().map((q) => q[0]));
    put(ksmooth([T(g0, -0.78), T(g1, -0.78), T(g1 + 0.04, -0.6), T(g1 + 0.04, 0.6), T(g1, 0.78), T(g0, 0.78), T(g0 - 0.03, 0.6), T(g0 - 0.03, -0.6)]), glassC, { stroke: dark(glassC, 0.3) });
    put(ksmooth([T(g0 + 0.06, -0.7), T(g1 - 0.08, -0.7), T(g1 - 0.08, 0.7), T(g0 + 0.06, 0.7)]), col, { stroke: dark(col, 0.3) });
    put(ksmooth([T(g0 + 0.1, -0.55), T(g1 - 0.15, -0.6), T(g1 - 0.2, -0.3), T(g0 + 0.15, -0.3)]), lite(col, 0.6), { stroke: 'none', op: 0.45 });
    [-1, 1].forEach((f) => put(ke(...T(g1 - 0.01, f * 1.06), L * 0.02, L * 0.012), col, { stroke: dark(col) }));
    [-1, 1].forEach((f) => { put(ke(...T(0.48, f * 0.72), L * 0.015, L * 0.04), '#fff6d8', { stroke: '#b8ae88' }); put(ke(...T(-0.49, f * 0.75), L * 0.012, L * 0.035), '#d7262b', { stroke: '#8f1416' }); });
    return;
  }
  if (P) { // ---- from the side: the body with its wheel arches, glass, doors, lights and wheels
    ground();
    const arches = P.wheels.map(([u, r]) => [u, r * 1.22]).sort((a, b) => b[0] - a[0]);
    const pts = [...P.top];
    const bottom = []; // (from the front, back along the bottom, up and over each wheel)
    const front = P.top[P.top.length - 1], back = P.top[0], clear = Math.min(front[1], back[1]);
    arches.forEach(([u, ar]) => { for (let k = 0; k <= 10; k++) { const a = k / 10 * Math.PI; bottom.push([u + Math.cos(a) * ar, Math.max(clear, P.wheels[0][1] + Math.sin(a) * ar * 0.92)]); } });
    if (kind === 'truck' || kind === 'dumptruck') { // the load behind the cab
      if (kind === 'truck') { put(sharp([[-0.5, 0.11], [-0.5, 0.52], [0.16, 0.52], [0.16, 0.11]]), base ? lite(base, 0.75) : '#eceef0', { stroke: '#9aa0a8' }); line([[-0.5, 0.48], [0.16, 0.48]], '#c3c8cf', 1); put(ksmooth([[-0.46, 0.49], [0.1, 0.49], [0.1, 0.45], [-0.46, 0.45]].map(([u, v]) => [X(u), Y(v)])), '#ffffff', { stroke: 'none', op: 0.5 }); }
      else { put(sharp([[-0.52, 0.2], [-0.48, 0.5], [0.15, 0.5], [0.15, 0.2]]), dark(col, 0.08), { stroke: dark(col) }); [-0.3, -0.1].forEach((u) => line([[u, 0.22], [u, 0.48]], dark(col, 0.3), 1.2)); put(sharp([[-0.5, 0.48], [0.13, 0.48], [0.13, 0.52], [-0.46, 0.52]]), '#8a6a44', { stroke: '#5a4428' }); }
      put(sharp([[-0.5, 0.1], [0.2, 0.1], [0.2, 0.14], [-0.5, 0.14]]), '#3a3f47', { stroke: '#1d2026' });
    }
    if (kind === 'firetruck') { // its ladder on top
      line([[-0.46, 0.415], [0.3, 0.415]], '#c7ccd3', 2.4); line([[-0.46, 0.445], [0.3, 0.445]], '#c7ccd3', 2.4);
      for (let k = 0; k <= 15; k++) line([[-0.46 + k * 0.05, 0.415], [-0.46 + k * 0.05, 0.445]], '#c7ccd3', 1.2);
    }
    put(ksmooth([...pts.map(([u, v]) => [X(u), Y(v)]), ...bottom.map(([u, v]) => [X(u), Y(v)])]), col, { stroke: dark(col) });
    // a darker lower body and a lit shoulder, so it reads round
    put(rr(back[0] + 0.1, P.belt - 0.035, front[0] - 0.16, P.belt - 0.018, 0.008), lite(col, 0.65), { stroke: 'none', op: 0.6 });
    // glass
    P.glass.forEach((g) => { put(poly(g), glassC, { stroke: dark(glassC, 0.3) }); const g0 = g[0], g1 = g[g.length - 1]; put(poly([[g0[0] + 0.02, g0[1] + 0.01], [g0[0] + 0.05, (g0[1] + g[1][1]) / 2 + 0.03], [g0[0] + 0.09, (g0[1] + g[1][1]) / 2 + 0.03], [g0[0] + 0.05, g0[1] + 0.01]]), '#ffffff', { stroke: 'none', op: 0.25 }); });
    if (kind === 'bus' || kind === 'schoolbus' || kind === 'train') { // a row of windows and a door
      const v0 = kind === 'train' ? 0.15 : 0.21, v1 = kind === 'train' ? 0.235 : 0.32, end = kind === 'schoolbus' ? 0.26 : kind === 'train' ? 0.3 : 0.36;
      const n = kind === 'train' ? 9 : 7, from = -0.46, step = (end - from) / n;
      for (let k = 0; k < n; k++) { const u0 = from + k * step + 0.008, u1 = u0 + step - 0.016; if (kind !== 'train' && k === n - 1) continue; put(rr(u0, v0, u1, v1, 0.008), glassC, { stroke: dark(glassC, 0.3), w: 1 }); }
      const d0 = kind === 'train' ? -0.02 : end - step + 0.01, d1 = d0 + (kind === 'train' ? 0.05 : step - 0.02);
      put(rr(d0, 0.06, d1, v1, 0.006), kind === 'train' ? dark(col, 0.12) : glassC, { stroke: dark(col, 0.45) }); line([[(d0 + d1) / 2, 0.07], [(d0 + d1) / 2, v1 - 0.01]], dark(col, 0.45), 1);
      if (kind !== 'train') put(rr(kind === 'schoolbus' ? 0.27 : 0.44, kind === 'schoolbus' ? 0.22 : 0.18, kind === 'schoolbus' ? 0.32 : 0.49, kind === 'schoolbus' ? 0.33 : 0.34, 0.006), glassC, { stroke: dark(glassC, 0.3) });
      if (kind === 'train') { line([[-0.5, 0.135], [0.46, 0.135]], '#d6302a', 2.4); line([[-0.55, 0.0], [0.55, 0.0]], '#6b6f76', 2); line([[0.0, 0.27], [0.06, 0.32], [0.12, 0.27]], '#555b64', 1.6); }
      if (kind === 'schoolbus') line([[-0.5, 0.175], [0.32, 0.175]], '#2b2b2b', 2.2);
    }
    // doors and handles, for cars and vans
    if (['sedan', 'taxi', 'police', 'hatchback', 'suv', 'classic', 'pickup', 'sports'].includes(VEH_OF[kind] || kind) || kind === 'sports') {
      const ds = (P.glass[0] || [[0, 0]])[0][0], de = P.glass.length > 1 ? P.glass[1][P.glass[1].length - 1][0] : ((P.glass[0] || [[0, 0]]).slice(-1)[0][0]);
      const mid = P.glass.length > 1 ? (P.glass[0][3][0] + P.glass[1][0][0]) / 2 : (ds + de) / 2;
      line([[mid, P.belt + 0.1], [mid, clear + 0.04]], dark(col, 0.45), 1.1, 0.8);
      line([[ds - 0.01, P.belt], [ds - 0.01, clear + 0.04]], dark(col, 0.45), 1.1, 0.6);
      [mid - 0.05, de - 0.06].forEach((u) => put(rr(u - 0.025, P.belt - 0.04, u + 0.025, P.belt - 0.027, 0.004), dark(col, 0.3), { stroke: 'none' }));
      put(poly([[P.glass[P.glass.length - 1].slice(-1)[0][0] - 0.02, P.belt + 0.005], [P.glass[P.glass.length - 1].slice(-1)[0][0] + 0.025, P.belt + 0.03], [P.glass[P.glass.length - 1].slice(-1)[0][0] + 0.03, P.belt + 0.005]]), dark(col, 0.2), { stroke: dark(col) });
    }
    if (kind === 'van' || kind === 'ambulance') { line([[0.0, 0.42], [0.0, 0.13]], dark(col, 0.4), 1.1); line([[-0.2, 0.55], [-0.2, 0.13]], dark(col, 0.4), 1.1); }
    // lights
    put(poly([[front[0] - 0.035, P.belt - 0.045], [front[0] - 0.003, P.belt - 0.06], [front[0] - 0.003, P.belt - 0.09], [front[0] - 0.04, P.belt - 0.075]].map(([u, v]) => [u, Math.max(clear + 0.03, v)])), '#fff6d8', { stroke: '#b8ae88' });
    put(poly([[back[0] + 0.003, P.belt - 0.05], [back[0] + 0.03, P.belt - 0.05], [back[0] + 0.03, P.belt - 0.085], [back[0] + 0.003, P.belt - 0.085]].map(([u, v]) => [u, Math.max(clear + 0.03, v)])), '#d7262b', { stroke: '#8f1416' });
    // the kind's own marks
    if (kind === 'taxi') { put(poly([[-0.06, 0.42], [0.06, 0.42], [0.05, 0.47], [-0.05, 0.47]]), '#ffe27a', { stroke: '#b8961c' }); for (let k = 0; k < 10; k++) put(rr(-0.36 + k * 0.07, 0.2, -0.33 + k * 0.07, 0.22, 0.002), '#222222', { stroke: 'none' }); }
    if (kind === 'police') { put(rr(-0.26, 0.13, 0.2, 0.265, 0.01), '#1f3f8f', { stroke: 'none', op: 0.92 }); put(rr(-0.08, 0.42, 0, 0.46, 0.006), '#d8262b', { stroke: '#8f1416' }); put(rr(0, 0.42, 0.08, 0.46, 0.006), '#2463d6', { stroke: '#163f8a' }); }
    if (kind === 'ambulance') { line([[-0.5, 0.3], [0.45, 0.3]], '#d6302a', 3); put(rr(-0.3, 0.36, -0.25, 0.45, 0.002), '#d6302a', { stroke: 'none' }); put(rr(-0.32, 0.385, -0.23, 0.425, 0.002), '#d6302a', { stroke: 'none' }); put(rr(-0.12, 0.6, 0.06, 0.63, 0.006), '#d8262b', { stroke: '#8f1416' }); }
    if (kind === 'classic') { line([[back[0], 0.13], [back[0] + 0.06, 0.13]], '#d8dbe0', 3); line([[front[0] - 0.06, 0.13], [front[0], 0.13]], '#d8dbe0', 3); line([[-0.42, 0.22], [0.4, 0.2]], '#e9e3d6', 1.6); }
    if (kind === 'firetruck') { for (let k = 0; k < 4; k++) { put(rr(-0.46 + k * 0.16, 0.14, -0.33 + k * 0.16, 0.32, 0.006), dark(col, 0.1), { stroke: dark(col, 0.4) }); line([[-0.4 + k * 0.16, 0.22], [-0.39 + k * 0.16, 0.22]], '#d8dbe0', 2); } line([[-0.5, 0.12], [0.5, 0.12]], '#f0f0f0', 2); }
    P.wheels.forEach(([u, r]) => wheel(u, r, kind === 'classic'));
    if (kind === 'truck' || kind === 'dumptruck' || kind === 'firetruck') line([[0.47, 0.09], [0.5, 0.09]], '#cfd3d8', 3);
    return;
  }
  // ---- the rest, from the side
  const V = (u, v) => `${X(u).toFixed(1)},${Y(v).toFixed(1)}`;
  if (kind === 'bicycle' || kind === 'motorcycle' || kind === 'scooter') {
    ground();
    const r = kind === 'scooter' ? 0.12 : kind === 'motorcycle' ? 0.17 : 0.19, ub = kind === 'scooter' ? -0.33 : -0.31, uf = kind === 'scooter' ? 0.33 : 0.31, frame = base || (kind === 'bicycle' ? '#2d6fd6' : kind === 'scooter' ? '#e8742a' : '#d32f2f');
    wheel(ub, r); wheel(uf, r);
    if (kind === 'bicycle') {
      const crank = [0.0, r * 0.95], seat = [-0.08, r + 0.25], head = [0.22, r + 0.22];
      [[[ub, r], crank], [[ub, r], seat], [seat, crank], [crank, head], [seat, [head[0] - 0.02, head[1] - 0.01]], [head, [uf, r]]].forEach(([a, b]) => line([a, b], frame, Math.max(2, w * 0.022)));
      line([[head[0], head[1]], [head[0] - 0.02, head[1] + 0.08], [head[0] + 0.05, head[1] + 0.09]], '#2b2f36', Math.max(2, w * 0.018));
      put(ke(X(seat[0] - 0.01), Y(seat[1] + 0.03), w * 0.06, w * 0.016), '#2b2f36', { stroke: '#111' });
      line([[seat[0], seat[1]], [seat[0] - 0.01, seat[1] + 0.03]], '#555', 2);
      put(kc(X(crank[0]), Y(crank[1]), w * 0.04), '#9aa1aa', { stroke: '#555' }); line([[crank[0], crank[1]], [crank[0] + 0.05, crank[1] - 0.08]], '#3a3f47', 2.2); line([[crank[0], crank[1] + 0.035], [ub, r + 0.012]], '#3a3f47', 1.2); line([[crank[0], crank[1] - 0.035], [ub, r - 0.012]], '#3a3f47', 1.2);
    } else {
      const body = kind === 'motorcycle'
        ? [[ub + 0.05, r + 0.1], [-0.12, r + 0.22], [0.02, r + 0.27], [0.18, r + 0.25], [0.26, r + 0.16], [0.12, r + 0.05], [-0.02, r + 0.02], [-0.18, r + 0.05]]
        : [[ub + 0.02, r + 0.08], [ub + 0.04, r + 0.22], [-0.08, r + 0.25], [-0.04, r + 0.08], [0.18, r + 0.08], [0.2, r + 0.38], [0.24, r + 0.38], [uf + 0.02, r + 0.06], [0.1, r - 0.02], [-0.2, r - 0.02]];
      put(ksmooth(body.map(([u, v]) => [X(u), Y(v)])), frame, { stroke: dark(frame) });
      put(ksmooth([[-0.04, r + 0.24], [0.1, r + 0.255], [0.12, r + 0.24], [0.0, r + 0.225]].map(([u, v]) => [X(u), Y(v)])), lite(frame, 0.6), { stroke: 'none', op: 0.6 });
      put(ksmooth((kind === 'motorcycle' ? [[-0.24, r + 0.2], [-0.05, r + 0.24], [-0.05, r + 0.27], [-0.25, r + 0.23]] : [[-0.27, r + 0.25], [-0.05, r + 0.26], [-0.05, r + 0.29], [-0.27, r + 0.28]]).map(([u, v]) => [X(u), Y(v)])), '#2b2f36', { stroke: '#111' });
      line([[uf, r], [kind === 'motorcycle' ? 0.22 : 0.22, kind === 'motorcycle' ? r + 0.3 : r + 0.44]], '#9aa1aa', Math.max(2, w * 0.02));
      line([[0.2, kind === 'motorcycle' ? r + 0.32 : r + 0.46], [0.13, kind === 'motorcycle' ? r + 0.34 : r + 0.47]], '#2b2f36', Math.max(2, w * 0.016));
      put(ke(X(0.26), Y(kind === 'motorcycle' ? r + 0.22 : r + 0.4), w * 0.02, w * 0.025), '#fff6d8', { stroke: '#b8ae88' });
      if (kind === 'motorcycle') { line([[-0.02, r + 0.02], [-0.3, r + 0.04], [-0.42, r + 0.08]], '#b8bec6', Math.max(2.4, w * 0.024)); put(kc(X(-0.02), Y(r + 0.06), w * 0.06), '#5a5f68', { stroke: '#2b2f36' }); }
    }
  } else if (kind === 'airplane') {
    const c = base || '#f4f6f8';
    put(sharp([[-0.42, 0.24], [-0.5, 0.42], [-0.44, 0.42], [-0.32, 0.26]]), '#2463d6', { stroke: '#163f8a' });
    put(ksmooth([[-0.5, 0.23], [-0.3, 0.3], [0.3, 0.31], [0.44, 0.3], [0.5, 0.25], [0.46, 0.2], [0.3, 0.18], [-0.3, 0.18], [-0.48, 0.21]].map(([u, v]) => [X(u), Y(v)])), c, { stroke: dark(c, 0.3) });
    put(ksmooth([[-0.45, 0.205], [0.3, 0.185], [0.46, 0.205], [0.3, 0.2], [-0.4, 0.215]].map(([u, v]) => [X(u), Y(v)])), '#2463d6', { stroke: 'none', op: 0.9 });
    put(ksmooth([[0.42, 0.275], [0.47, 0.268], [0.47, 0.258], [0.42, 0.262]].map(([u, v]) => [X(u), Y(v)])), glassC, { stroke: 'none' });
    for (let k = 0; k < 16; k++) put(kc(X(-0.3 + k * 0.042), Y(0.268), w * 0.006), glassC, { stroke: 'none' });
    put(ksmooth([[-0.05, 0.21], [0.12, 0.21], [0.0, 0.12], [-0.12, 0.12]].map(([u, v]) => [X(u), Y(v)])), lite('#c9ced6', 0.2), { stroke: '#8a919b' });
    put(ksmooth([[-0.02, 0.15], [0.12, 0.15], [0.12, 0.1], [-0.02, 0.1]].map(([u, v]) => [X(u), Y(v)])), '#c9ced6', { stroke: '#7d848e' }); put(ke(X(0.12), Y(0.125), w * 0.008, w * 0.024), '#3a3f47', { stroke: 'none' });
    put(sharp([[-0.44, 0.27], [-0.32, 0.27], [-0.44, 0.3]]), '#c9ced6', { stroke: '#8a919b' });
    line([[0.32, 0.18], [0.32, 0.03]], '#555', 1.6); put(kc(X(0.32), Y(0.025), w * 0.022), tyre, { stroke: '#111' });
    line([[-0.02, 0.18], [-0.02, 0.03]], '#555', 1.6); put(kc(X(-0.02), Y(0.025), w * 0.022), tyre, { stroke: '#111' });
    put(ksmooth([[-0.3, 0.3], [0.3, 0.305], [0.3, 0.295], [-0.3, 0.292]].map(([u, v]) => [X(u), Y(v)])), '#ffffff', { stroke: 'none', op: 0.6 });
  } else if (kind === 'helicopter') {
    const c = base || '#2f7d4a';
    ground();
    line([[-0.2, 0.02], [0.25, 0.02]], '#3a3f47', 2.2); [-0.12, 0.15].forEach((u) => line([[u, 0.02], [u - 0.02, 0.1]], '#3a3f47', 1.6));
    put(sharp([[-0.5, 0.22], [-0.1, 0.17], [-0.1, 0.21], [-0.5, 0.25]]), c, { stroke: dark(c) });
    put(sharp([[-0.5, 0.25], [-0.46, 0.36], [-0.42, 0.36], [-0.44, 0.24]]), c, { stroke: dark(c) });
    put(kc(X(-0.46), Y(0.3), w * 0.06), '#9aa1aa', { stroke: '#555', op: 0.35 });
    put(ksmooth([[-0.15, 0.13], [-0.12, 0.27], [0.05, 0.31], [0.22, 0.27], [0.3, 0.17], [0.24, 0.1], [0.0, 0.09]].map(([u, v]) => [X(u), Y(v)])), c, { stroke: dark(c) });
    put(ksmooth([[0.08, 0.27], [0.21, 0.255], [0.28, 0.17], [0.2, 0.15], [0.1, 0.2]].map(([u, v]) => [X(u), Y(v)])), '#bfe3f2', { stroke: '#5c8ca0' });
    put(ksmooth([[-0.06, 0.25], [0.04, 0.25], [0.04, 0.16], [-0.06, 0.16]].map(([u, v]) => [X(u), Y(v)])), glassC, { stroke: 'none' });
    line([[0.03, 0.31], [0.03, 0.35]], '#3a3f47', 2.4); line([[-0.42, 0.36], [0.48, 0.36]], '#3a3f47', Math.max(2, w * 0.012));
  } else if (kind === 'boat' || kind === 'ship' || kind === 'sailboat' || kind === 'rowboat' || kind === 'submarine') {
    const water = () => put(`M${V(-0.6, 0)}Q${V(-0.45, 0.02)} ${V(-0.3, 0)}T${V(0, 0)}T${V(0.3, 0)}T${V(0.6, 0)}L${V(0.6, -0.08)}L${V(-0.6, -0.08)}Z`, '#5aa9e6', { stroke: '#2b78bd', op: 0.85 });
    if (kind === 'submarine') {
      const c = base || '#3c4f63';
      put(ksmooth([[-0.46, 0.08], [-0.3, 0.16], [0.3, 0.165], [0.46, 0.12], [0.5, 0.08], [0.46, 0.04], [0.3, 0.0], [-0.3, 0.0], [-0.46, 0.05]].map(([u, v]) => [X(u), Y(v)])), c, { stroke: dark(c) });
      put(sharp([[0.02, 0.16], [0.06, 0.27], [0.2, 0.27], [0.22, 0.16]]), c, { stroke: dark(c) }); line([[0.12, 0.27], [0.12, 0.34], [0.15, 0.34]], '#3a3f47', 1.6);
      for (let k = 0; k < 6; k++) put(kc(X(-0.25 + k * 0.08), Y(0.09), w * 0.012), '#f2d36b', { stroke: 'none' });
      put(ke(X(-0.5), Y(0.08), w * 0.012, w * 0.05), '#b8a46a', { stroke: '#6a5a2a' });
      put(ksmooth([[-0.3, 0.14], [0.3, 0.15], [0.28, 0.13], [-0.3, 0.12]].map(([u, v]) => [X(u), Y(v)])), lite(c, 0.5), { stroke: 'none', op: 0.5 });
    } else if (kind === 'sailboat') {
      const c = base || '#f4f6f8'; water();
      put(ksmooth([[-0.4, 0.1], [0.45, 0.12], [0.3, -0.03], [-0.3, -0.03]].map(([u, v]) => [X(u), Y(v)])), c, { stroke: dark(c, 0.3) }); line([[-0.38, 0.06], [0.38, 0.08]], '#2463d6', 2);
      line([[0.0, 0.1], [0.0, 0.95]], '#7a5a3a', 2.4);
      put(sharp([[0.02, 0.92], [0.02, 0.15], [0.38, 0.15]]), '#fbf7ee', { stroke: '#a8a294' }); put(sharp([[-0.02, 0.8], [-0.02, 0.18], [-0.3, 0.18]]), '#f2ede2', { stroke: '#a8a294' });
      put(sharp([[0.0, 0.95], [0.1, 0.92], [0.0, 0.89]]), '#d8262b', { stroke: 'none' });
    } else if (kind === 'rowboat') {
      const c = base || '#c99a5a'; water();
      put(ksmooth([[-0.48, 0.17], [0.48, 0.17], [0.34, -0.02], [-0.36, -0.02]].map(([u, v]) => [X(u), Y(v)])), c, { stroke: dark(c) });
      [0.11, 0.05].forEach((v) => line([[-0.44, v], [0.44, v]], dark(c, 0.3), 1.1)); line([[-0.1, 0.32], [0.2, -0.04]], '#a87a44', 2.4); put(ke(X(0.22), Y(-0.06), w * 0.04, w * 0.015, 30), '#a87a44', { stroke: '#6a4a24' });
    } else {
      const c = base || (kind === 'ship' ? '#f4f6f8' : '#f4f6f8'); water();
      const hull = kind === 'ship' ? [[-0.5, 0.16], [0.5, 0.2], [0.42, 0.0], [-0.46, 0.0]] : [[-0.48, 0.14], [0.5, 0.15], [0.3, -0.02], [-0.44, 0.0]];
      put(sharp(hull), c, { stroke: dark(c, 0.3) });
      put(sharp(kind === 'ship' ? [[-0.48, 0.06], [0.46, 0.08], [0.43, 0.02], [-0.47, 0.02]] : [[-0.46, 0.06], [0.42, 0.07], [0.33, 0.02], [-0.44, 0.02]]), kind === 'ship' ? '#1d3f73' : '#e8742a', { stroke: 'none' });
      if (kind === 'ship') {
        for (let d = 0; d < 3; d++) { const v0 = 0.17 + d * 0.065, u0 = -0.42 + d * 0.06, u1 = 0.3 - d * 0.06; put(sharp([[u0, v0], [u1, v0 + 0.005], [u1, v0 + 0.06], [u0, v0 + 0.06]]), '#fbfcfd', { stroke: '#9aa3ad' }); for (let k = 0; k < 14 - d * 2; k++) put(sharp([[u0 + 0.02 + k * 0.05, v0 + 0.02], [u0 + 0.045 + k * 0.05, v0 + 0.02], [u0 + 0.045 + k * 0.05, v0 + 0.04], [u0 + 0.02 + k * 0.05, v0 + 0.04]]), glassC, { stroke: 'none' }); }
        put(sharp([[-0.2, 0.36], [-0.12, 0.36], [-0.11, 0.44], [-0.21, 0.44]]), '#d6302a', { stroke: '#8f1416' }); for (let k = 0; k < 8; k++) put(ke(X(-0.4 + k * 0.1), Y(0.1), w * 0.006, w * 0.006), glassC, { stroke: 'none' });
      } else {
        put(ksmooth([[-0.25, 0.15], [-0.2, 0.25], [0.05, 0.26], [0.2, 0.15]].map(([u, v]) => [X(u), Y(v)])), '#fbfcfd', { stroke: '#9aa3ad' }); put(ksmooth([[-0.15, 0.17], [-0.12, 0.23], [0.04, 0.235], [0.14, 0.17]].map(([u, v]) => [X(u), Y(v)])), glassC, { stroke: 'none' });
      }
    }
  } else if (kind === 'tractor' || kind === 'excavator' || kind === 'bulldozer') {
    const c = base || (kind === 'tractor' ? '#3f8f3a' : '#f2b51a'); ground();
    if (kind === 'tractor') {
      put(ksmooth([[-0.25, 0.2], [-0.25, 0.32], [0.35, 0.3], [0.42, 0.22], [0.4, 0.14], [-0.2, 0.14]].map(([u, v]) => [X(u), Y(v)])), c, { stroke: dark(c) });
      line([[-0.3, 0.32], [-0.28, 0.6], [0.0, 0.6], [0.02, 0.3]], '#2b2f36', 2.4); put(sharp([[-0.27, 0.35], [-0.26, 0.56], [-0.02, 0.56], [-0.01, 0.35]]), '#bfe3f2', { stroke: 'none', op: 0.5 }); line([[0.22, 0.3], [0.22, 0.42]], '#3a3f47', 3);
      wheel(-0.26, 0.24); wheel(0.32, 0.13);
    } else {
      put(ksmooth([[-0.4, 0.0], [-0.44, 0.06], [-0.4, 0.13], [0.3, 0.13], [0.34, 0.06], [0.3, 0.0]].map(([u, v]) => [X(u), Y(v)])), '#3a3f47', { stroke: '#1d2026' });
      for (let k = 0; k < 6; k++) put(kc(X(-0.35 + k * 0.13), Y(0.065), w * 0.04), '#6b7079', { stroke: '#2b2f36' });
      put(sharp([[-0.38, 0.14], [-0.38, 0.3], [0.28, 0.3], [0.28, 0.14]]), c, { stroke: dark(c) });
      put(sharp([[-0.12, 0.3], [-0.12, 0.55], [0.12, 0.55], [0.18, 0.3]]), c, { stroke: dark(c) }); put(sharp([[-0.08, 0.33], [-0.08, 0.51], [0.1, 0.51], [0.14, 0.33]]), glassC, { stroke: 'none' });
      if (kind === 'excavator') {
        put(`M${V(0.18, 0.32)}L${V(0.42, 0.72)}L${V(0.47, 0.7)}L${V(0.26, 0.3)}Z`, c, { stroke: dark(c) });
        put(`M${V(0.42, 0.72)}L${V(0.58, 0.32)}L${V(0.54, 0.3)}L${V(0.4, 0.66)}Z`, c, { stroke: dark(c) });
        put(`M${V(0.52, 0.32)}Q${V(0.5, 0.18)} ${V(0.62, 0.14)}L${V(0.64, 0.3)}Z`, '#5a5f68', { stroke: '#2b2f36' });
      } else { put(sharp([[0.32, 0.0], [0.4, 0.0], [0.44, 0.3], [0.36, 0.32]]), '#5a5f68', { stroke: '#2b2f36' }); line([[0.28, 0.2], [0.37, 0.18]], '#3a3f47', 2.4); }
    }
  } else if (kind === 'rocket') { // standing up: w is its height
    const c = base || '#f4f6f8', H = w, Xr = (f) => x + f * H, Yr = (f) => y - f * H;
    put(`M${Xr(-0.06)},${Yr(0.15)}Q${Xr(0)},${Yr(-0.1)} ${Xr(0.06)},${Yr(0.15)}Z`, '#ffb21f', { stroke: '#e0601a', op: 0.95 });
    put(ksmooth([[Xr(-0.07), Yr(0.12)], [Xr(-0.08), Yr(0.6)], [Xr(-0.05), Yr(0.85)], [Xr(0), Yr(1)], [Xr(0.05), Yr(0.85)], [Xr(0.08), Yr(0.6)], [Xr(0.07), Yr(0.12)]]), c, { stroke: dark(c, 0.3) });
    put(ksmooth([[Xr(-0.05), Yr(0.85)], [Xr(0), Yr(1)], [Xr(0.05), Yr(0.85)], [Xr(0), Yr(0.82)]]), '#d6302a', { stroke: '#8f1416' });
    [-1, 1].forEach((sd) => put(kpts([[Xr(sd * 0.07), Yr(0.32)], [Xr(sd * 0.16), Yr(0.1)], [Xr(sd * 0.16), Yr(0.02)], [Xr(sd * 0.07), Yr(0.14)]]), '#d6302a', { stroke: '#8f1416' }));
    put(kc(Xr(0), Yr(0.62), H * 0.035), '#6fc3ea', { stroke: '#2b78bd' }); put(kpts([[Xr(-0.045), Yr(0.13)], [Xr(0.045), Yr(0.13)], [Xr(0.04), Yr(0.08)], [Xr(-0.04), Yr(0.08)]]), '#5a5f68', { stroke: '#2b2f36' });
  } else if (kind === 'balloon') { // w is its width
    const c = base || '#e8574f', H = w, Xb = (f) => x + f * H, Yb = (f) => y - f * H;
    put(kpts([[Xb(-0.08), Yb(0.12)], [Xb(0.08), Yb(0.12)], [Xb(0.07), Yb(0)], [Xb(-0.07), Yb(0)]]), '#a87a44', { stroke: '#6a4a24' });
    [-0.07, 0.07].forEach((f) => put(`M${Xb(f)},${Yb(0.12)}L${Xb(f * 1.8)},${Yb(0.4)}`, 'none', { stroke: '#6a4a24', w: 1, line: true }));
    put(ksmooth([[Xb(-0.15), Yb(0.42)], [Xb(-0.48), Yb(0.85)], [Xb(-0.42), Yb(1.25)], [Xb(0), Yb(1.4)], [Xb(0.42), Yb(1.25)], [Xb(0.48), Yb(0.85)], [Xb(0.15), Yb(0.42)]]), c, { stroke: dark(c) });
    [-0.28, 0, 0.28].forEach((f) => put(`M${Xb(f * 0.4)},${Yb(0.43)}Q${Xb(f * 1.5)},${Yb(0.95)} ${Xb(f * 0.6)},${Yb(1.38)}`, 'none', { stroke: dark(c, 0.3), w: 1.4, line: true }));
    put(ksmooth([[Xb(-0.4), Yb(0.82)], [Xb(0.4), Yb(0.82)], [Xb(0.35), Yb(0.7)], [Xb(-0.35), Yb(0.7)]]), '#f6c21c', { stroke: 'none', op: 0.9 });
    put(ke(Xb(-0.2), Yb(1.15), H * 0.1, H * 0.05, -30), '#ffffff', { stroke: 'none', op: 0.35 });
  } else if (kind === 'drone') {
    const c = base || '#e8742a';
    put(ksmooth([[-0.18, 0.12], [-0.15, 0.2], [0.15, 0.2], [0.18, 0.12], [0.12, 0.08], [-0.12, 0.08]].map(([u, v]) => [X(u), Y(v)])), c, { stroke: dark(c) });
    [-1, 1].forEach((sd) => { line([[sd * 0.12, 0.17], [sd * 0.4, 0.22]], '#3a3f47', 3); line([[sd * 0.4, 0.22], [sd * 0.4, 0.26]], '#3a3f47', 2); put(ke(X(sd * 0.4), Y(0.265), w * 0.14, w * 0.015), '#9aa1aa', { stroke: '#555', op: 0.7 }); line([[sd * 0.1, 0.08], [sd * 0.14, 0.0]], '#3a3f47', 1.6); });
    put(kc(X(0.12), Y(0.11), w * 0.025), glassC, { stroke: '#111' });
  }
}

// ---------- (v327) the animal kit: mammals, dinosaurs, birds, sea animals, reptiles, amphibians and insects, alive ----------
// {"t":"animal","kind":"lion","x":200,"y":220,"w":180,"facing":"right"}: x its middle, y the ground under its feet (a
// flying bird's or a fish's middle), w its length nose to tail. Drawn from the side in the owner's guide style (soft,
// shaded, real colours and real coat patterns), and moving: legs walk, wings flap, tails sway, fins swim. "still": true
// keeps one still. ANIMALS is one description of each, used flat, in 3D and in Cassie's animal guide.
// The numbers are in parts of its length: leg (ground to belly), bh (body depth), tilt (front higher), neck [length,
// angle], hr (head size), sn (snout), drop (snout down), legT (leg thickness).
const ANIMALS = {
  lion: { b: 'quad', tuck: .22, col: '#c8954f', col2: '#ead2a2', dk: '#5a3a22', leg: .3, bh: .27, tilt: .01, neck: [.1, 35], hr: .11, sn: .07, ear: 'round', tail: 'tuft', foot: 'paw', legT: .085, mane: '#7a4a24' },
  tiger: { b: 'quad', tuck: .22, col: '#e0782a', col2: '#f6ead6', dk: '#1d1a18', leg: .28, bh: .26, neck: [.08, 25], hr: .11, sn: .06, ear: 'round', tail: 'long', foot: 'paw', legT: .08, pat: 'stripes' },
  leopard: { b: 'quad', tuck: .22, col: '#d9a957', col2: '#f2e2c0', dk: '#2b2219', leg: .27, bh: .23, neck: [.1, 30], hr: .1, sn: .05, ear: 'round', tail: 'long', foot: 'paw', legT: .07, pat: 'rosettes' },
  jaguar: { b: 'quad', tuck: .22, col: '#d49a48', col2: '#f2e2c0', dk: '#2b2219', leg: .25, bh: .27, neck: [.08, 25], hr: .11, sn: .05, ear: 'round', tail: 'long', foot: 'paw', legT: .085, pat: 'rosettes' },
  cheetah: { b: 'quad', tuck: .22, col: '#dcb36e', col2: '#f4e6c8', dk: '#2b2219', leg: .36, bh: .2, tilt: .02, neck: [.12, 35], hr: .09, sn: .045, ear: 'round', tail: 'long', foot: 'paw', legT: .055, pat: 'spots', tear: true },
  smilodon: { b: 'quad', tuck: .22, col: '#c48a4a', col2: '#ecd2a8', dk: '#5a3a22', leg: .29, bh: .29, tilt: .03, neck: [.08, 25], hr: .115, sn: .05, ear: 'round', tail: 'stub', foot: 'paw', legT: .095, sabre: true },
  elephant: { b: 'quad', col: '#8d8b86', col2: '#a8a6a0', dk: '#5e5c58', leg: .42, bh: .45, tilt: .02, neck: [0, 0], hr: .17, sn: .02, ear: 'big', tail: 'thin', foot: 'pad', legT: .14, trunk: true, tusks: 'straight' },
  mammoth: { b: 'quad', col: '#5e3b26', col2: '#7a5038', dk: '#3a2418', leg: .38, bh: .46, tilt: .06, neck: [0, 0], hr: .17, sn: .02, ear: 'small', tail: 'thin', foot: 'pad', legT: .14, trunk: true, tusks: 'curl', hair: true, hump: .06 },
  rhino: { b: 'quad', col: '#8e8c86', col2: '#a8a6a0', dk: '#5e5c58', leg: .22, bh: .36, neck: [.05, 10], hr: .13, sn: .12, drop: .05, ear: 'pointed', tail: 'thin', foot: 'pad', legT: .12, horn: 'rhino' },
  hippo: { b: 'quad', col: '#7d5a5e', col2: '#c8949a', dk: '#4a3236', leg: .14, bh: .36, neck: [.04, 10], hr: .15, sn: .14, drop: .02, ear: 'small', tail: 'stub', foot: 'pad', legT: .13 },
  giraffe: { b: 'quad', tuck: .22, col: '#f2dcab', col2: '#f6e8c8', dk: '#a35f28', leg: .62, bh: .26, tilt: .06, neck: [.62, 72], hr: .07, sn: .07, drop: .03, ear: 'pointed', tail: 'tuft', foot: 'hoof', legT: .05, pat: 'patches', ossicones: true, mane: 'short' },
  zebra: { b: 'quad', tuck: .22, col: '#f4f2ee', col2: '#f4f2ee', dk: '#1e1e1e', leg: .38, bh: .26, neck: [.2, 48], hr: .09, sn: .11, drop: .04, ear: 'pointed', tail: 'tuft', foot: 'hoof', legT: .06, pat: 'stripes', mane: 'stiff' },
  horse: { b: 'quad', tuck: .22, col: '#8a5530', col2: '#a8714a', dk: '#2e1e14', leg: .42, bh: .27, neck: [.22, 50], hr: .09, sn: .13, drop: .04, ear: 'pointed', tail: 'horse', foot: 'hoof', legT: .06, mane: 'flow' },
  buffalo: { b: 'quad', col: '#3d3a38', col2: '#55514e', dk: '#1e1c1b', leg: .3, bh: .34, tilt: .03, neck: [.04, 15], hr: .1, sn: .07, drop: .06, ear: 'pointed', tail: 'tuft', foot: 'hoof', legT: .085, horn: 'buffalo', hump: .03 },
  wildebeest: { b: 'quad', col: '#6b6257', col2: '#867c70', dk: '#2a2622', leg: .36, bh: .3, tilt: .05, neck: [.1, 30], hr: .09, sn: .1, drop: .06, ear: 'pointed', tail: 'horse', foot: 'hoof', legT: .06, horn: 'buffalo', mane: 'stiff', beard: true },
  cow: { b: 'quad', col: '#f4f1ea', col2: '#f4f1ea', dk: '#2a2522', leg: .3, bh: .34, neck: [.06, 15], hr: .1, sn: .09, drop: .05, ear: 'pointed', tail: 'tuft', foot: 'hoof', legT: .075, pat: 'cow', horn: 'cow', udder: true },
  pig: { b: 'quad', col: '#f2b8b0', col2: '#f6ccc6', dk: '#c27a72', leg: .16, bh: .3, neck: [.03, 5], hr: .1, sn: .07, ear: 'flop', tail: 'curl', foot: 'hoof', legT: .07, snout: true },
  warthog: { b: 'quad', col: '#7a6a5e', col2: '#8c7c70', dk: '#3a3028', leg: .22, bh: .27, neck: [.04, 10], hr: .11, sn: .1, drop: .02, ear: 'pointed', tail: 'thin', foot: 'hoof', legT: .06, tusks: 'warthog', mane: 'stiff', snout: true },
  goat: { b: 'quad', tuck: .22, col: '#e8e2d6', col2: '#f2eee6', dk: '#6a6258', leg: .3, bh: .24, neck: [.1, 40], hr: .08, sn: .08, drop: .04, ear: 'pointed', tail: 'stub', foot: 'hoof', legT: .05, horn: 'goat', beard: true },
  sheep: { b: 'quad', col: '#2b2b2b', col2: '#3a3a3a', dk: '#1a1a1a', leg: .26, bh: .32, neck: [.06, 30], hr: .08, sn: .07, drop: .04, ear: 'flop', tail: 'stub', foot: 'hoof', legT: .045, wool: '#f3efe6' },
  deer: { b: 'quad', tuck: .22, col: '#a6703f', col2: '#f0e2cc', dk: '#4a2e1a', leg: .4, bh: .24, neck: [.18, 55], hr: .08, sn: .08, drop: .03, ear: 'pointed', tail: 'stub', foot: 'hoof', legT: .045, horn: 'antlers' },
  camel: { b: 'quad', col: '#c99d63', col2: '#dcb884', dk: '#7a5a34', leg: .5, bh: .26, neck: [.3, 32], hr: .08, sn: .08, drop: .02, ear: 'small', tail: 'tuft', foot: 'pad', legT: .055, hump: .12 },
  hyena: { b: 'quad', tuck: .22, col: '#b8915e', col2: '#d4b88a', dk: '#4a3220', leg: .32, bh: .27, tilt: .07, neck: [.1, 30], hr: .11, sn: .08, ear: 'round', tail: 'bushy', foot: 'paw', legT: .07, pat: 'spots', mane: 'stiff' },
  wolf: { b: 'quad', tuck: .22, col: '#8c8a86', col2: '#e8e4dc', dk: '#3a3836', leg: .32, bh: .24, neck: [.12, 35], hr: .095, sn: .1, drop: .03, ear: 'pointed', tail: 'bushy', foot: 'paw', legT: .06 },
  fox: { b: 'quad', tuck: .22, col: '#d8722e', col2: '#f6f0e8', dk: '#2e2420', leg: .24, bh: .2, neck: [.1, 35], hr: .09, sn: .09, ear: 'pointed', tail: 'bushy', foot: 'paw', legT: .045, tip: '#f6f0e8' },
  dog: { b: 'quad', tuck: .22, col: '#d9a85c', col2: '#ecc88e', dk: '#3a2a1a', leg: .3, bh: .25, neck: [.12, 40], hr: .1, sn: .08, drop: .03, ear: 'flop', tail: 'feather', foot: 'paw', legT: .06 },
  corgi: { b: 'quad', col: '#d98a3e', col2: '#f6f0e8', dk: '#2e2420', leg: .14, bh: .24, neck: [.1, 40], hr: .09, sn: .07, ear: 'pointed', tail: 'stub', foot: 'paw', legT: .06 },
  cat: { b: 'quad', tuck: .22, col: '#e8dccb', col2: '#f2eadc', dk: '#4a3428', leg: .26, bh: .2, neck: [.08, 40], hr: .095, sn: .035, ear: 'pointed', tail: 'long', foot: 'paw', legT: .045, points: true },
  bear: { b: 'quad', col: '#5b3a24', col2: '#6e4a30', dk: '#2a1a10', leg: .3, bh: .38, tilt: .02, neck: [.06, 20], hr: .11, sn: .08, drop: .02, ear: 'round', tail: 'stub', foot: 'paw', legT: .11, hump: .03 },
  polarbear: { b: 'quad', col: '#f2efe6', col2: '#f6f4ee', dk: '#2a2a2a', leg: .3, bh: .36, neck: [.12, 25], hr: .1, sn: .09, drop: .02, ear: 'round', tail: 'stub', foot: 'paw', legT: .11 },
  panda: { b: 'quad', col: '#f4f2ee', col2: '#f4f2ee', dk: '#1e1e1e', leg: .24, bh: .36, neck: [.04, 20], hr: .12, sn: .05, ear: 'round', tail: 'stub', foot: 'paw', legT: .1, panda: true },
  rabbit: { b: 'quad', col: '#b9a690', col2: '#f4f0ea', dk: '#5a4a3a', leg: .1, bh: .32, neck: [.03, 40], hr: .12, sn: .04, ear: 'long', tail: 'puff', foot: 'paw', legT: .06 },
  mouse: { b: 'quad', col: '#9c9ca2', col2: '#d8d8dc', dk: '#4a4a50', leg: .06, bh: .24, neck: [0, 0], hr: .1, sn: .07, ear: 'mouse', tail: 'rat', foot: 'paw', legT: .03 },
  hamster: { b: 'quad', col: '#e0a050', col2: '#f6efe4', dk: '#5a3a1a', leg: .05, bh: .42, neck: [0, 0], hr: .15, sn: .03, ear: 'round', tail: 'none', foot: 'paw', legT: .05 },
  guineapig: { b: 'quad', col: '#a86a3a', col2: '#f6efe4', dk: '#3a2418', leg: .05, bh: .38, neck: [0, 0], hr: .15, sn: .04, ear: 'round', tail: 'none', foot: 'paw', legT: .05, pat: 'saddle' },
  hedgehog: { b: 'quad', col: '#c4b29a', col2: '#e8dccb', dk: '#2a2018', leg: .05, bh: .34, neck: [0, 0], hr: .1, sn: .08, ear: 'round', tail: 'none', foot: 'paw', legT: .04, spikes: '#5e4a38' },
  ferret: { b: 'quad', col: '#e8dcc6', col2: '#f2eadc', dk: '#3a2e26', leg: .1, bh: .16, neck: [.1, 25], hr: .07, sn: .06, ear: 'round', tail: 'long', foot: 'paw', legT: .04, mask: true },
  // dinosaurs
  trex: { b: 'quad', biped: true, col: '#6f7a4e', col2: '#b9b78a', dk: '#3a4228', leg: .42, bh: .26, tilt: .04, neck: [.06, 35], hr: .16, sn: .1, ear: 'none', tail: 'dino', foot: 'claw', legT: .1, teeth: true },
  raptor: { b: 'quad', biped: true, col: '#8a7a5a', col2: '#c8b88e', dk: '#3a3226', leg: .34, bh: .17, tilt: .04, neck: [.1, 35], hr: .1, sn: .1, ear: 'none', tail: 'dino', foot: 'claw', legT: .06, pat: 'stripes', teeth: true },
  triceratops: { b: 'quad', col: '#7d7462', col2: '#a89c84', dk: '#4a4234', leg: .24, bh: .36, neck: [.02, 10], hr: .16, sn: .12, drop: .04, ear: 'none', tail: 'dino', foot: 'pad', legT: .1, frill: true, horn: 'tri' },
  stegosaurus: { b: 'quad', col: '#7d8a5a', col2: '#a8b07e', dk: '#4a5232', leg: .26, bh: .34, tilt: -.05, neck: [.06, 10], hr: .06, sn: .06, drop: .02, ear: 'none', tail: 'dino', foot: 'pad', legT: .09, plates: '#b0583a' },
  brachiosaurus: { b: 'quad', col: '#8a8a86', col2: '#a8a8a2', dk: '#5a5a56', leg: .48, bh: .3, tilt: .06, neck: [.72, 68], hr: .06, sn: .05, ear: 'none', tail: 'dino', foot: 'pad', legT: .1 },
  // upright
  meerkat: { b: 'upright', col: '#c8a878', col2: '#e8d8b8', dk: '#3a2a1a', hr: .17, tail: 'thin', mask: true },
  monkey: { b: 'upright', col: '#7a5432', col2: '#d8b892', dk: '#2a1a10', hr: .17, tail: 'monkey', sit: true },
  sloth: { b: 'upright', col: '#8c7a62', col2: '#c8b8a0', dk: '#3a2e22', hr: .17, tail: 'none', sit: true, mask: true },
  gorilla: { b: 'upright', col: '#2e2c2c', col2: '#4a4644', dk: '#121212', hr: .17, tail: 'none', sit: true },
  kangaroo: { b: 'upright', col: '#b07a4a', col2: '#dcc0a0', dk: '#3a2418', hr: .14, tail: 'kanga', hop: true },
  // birds
  eagle: { b: 'bird', col: '#4a3426', head: '#f6f4ee', belly: '#4a3426', wing: '#3a281c', beak: 'hook', bc: '#f2c230', tail: 'fan', tc: '#f6f4ee', leg: .1, lc: '#f2c230' },
  falcon: { b: 'bird', col: '#6e7480', head: '#3a3e46', belly: '#ece6da', wing: '#5a606c', beak: 'hook', bc: '#f2c230', tail: 'fan', leg: .1, lc: '#f2c230', bars: true },
  hawk: { b: 'bird', col: '#8a5a3a', head: '#6e4428', belly: '#f2e8d8', wing: '#6e4428', beak: 'hook', bc: '#3a3a3a', tail: 'fan', tc: '#c4502a', leg: .1, lc: '#f2c230' },
  owl: { b: 'bird', upright: true, col: '#a07850', head: '#a07850', belly: '#d8c098', wing: '#86603c', beak: 'owl', bc: '#3a3a3a', tail: 'short', leg: .05, lc: '#d8c098', tufts: true, disc: '#e0cca8' },
  macaw: { b: 'bird', col: '#d8262b', head: '#d8262b', belly: '#d8262b', wing: '#2a6fd6', band: '#f2c21c', beak: 'parrot', bc: '#f2efe6', tail: 'long', tc: '#d8262b', leg: .07, lc: '#5a5a5a', face: '#f6f2ea' },
  bluemacaw: { b: 'bird', col: '#2a6fd6', head: '#2a6fd6', belly: '#f2c21c', wing: '#2a6fd6', beak: 'parrot', bc: '#2a2a2a', tail: 'long', tc: '#2a6fd6', leg: .07, lc: '#5a5a5a', face: '#f6f2ea' },
  parrot: { b: 'bird', col: '#3aa84a', head: '#3aa84a', belly: '#7ac74a', wing: '#2a8a3a', beak: 'parrot', bc: '#f2efe6', tail: 'long', tc: '#2a6fd6', leg: .07, lc: '#7a7a7a' },
  budgie: { b: 'bird', col: '#7ac74a', head: '#f2e23a', belly: '#7ac74a', wing: '#4a8a3a', beak: 'parrot', bc: '#e8d8a8', tail: 'long', tc: '#2a6fd6', leg: .06, lc: '#8a8aa0', bars: true },
  toucan: { b: 'bird', col: '#1d1b1b', head: '#1d1b1b', belly: '#1d1b1b', throat: '#f6f2ea', wing: '#1d1b1b', beak: 'toucan', bc: '#f28a1a', tail: 'short', leg: .07, lc: '#3a6ad6' },
  hummingbird: { b: 'bird', col: '#3a9a5a', head: '#3a9a5a', belly: '#e8eee6', throat: '#c8264a', wing: '#5a6a5e', beak: 'needle', bc: '#2a2a2a', tail: 'short', leg: .04, lc: '#2a2a2a', fast: true },
  penguin: { b: 'bird', upright: true, col: '#1e2228', head: '#1e2228', belly: '#f6f4ee', wing: '#1e2228', beak: 'cone', bc: '#2a2a2a', tail: 'short', leg: .04, lc: '#f28a2a', neck: '#f2b21c', flightless: true },
  flamingo: { b: 'bird', col: '#f2869a', head: '#f2869a', belly: '#f498a8', wing: '#e8607a', beak: 'flamingo', bc: '#2a2a2a', tail: 'short', leg: .5, lc: '#e8607a', sneck: true },
  chicken: { b: 'bird', col: '#f2ece2', head: '#f2ece2', belly: '#f2ece2', wing: '#e6dccc', beak: 'cone', bc: '#f2c230', tail: 'hen', tc: '#e6dccc', leg: .12, lc: '#f2c230', comb: true, flightless: true },
  duck: { b: 'bird', col: '#8a7a68', head: '#2e7a3a', belly: '#a8988a', wing: '#6a5a48', beak: 'duck', bc: '#f2c230', tail: 'short', leg: .05, lc: '#f28a2a', ring: true, swim: true },
  dodo: { b: 'bird', col: '#8a8a8a', head: '#9a9a9a', belly: '#a8a8a8', wing: '#7a7a7a', beak: 'dodo', bc: '#c8b88a', tail: 'puff', leg: .1, lc: '#e8c84a', flightless: true, fat: true },
  crow: { b: 'bird', col: '#1e1e22', head: '#1e1e22', belly: '#1e1e22', wing: '#2a2a32', beak: 'cone', bc: '#1e1e22', tail: 'fan', leg: .08, lc: '#1e1e22' },
  bat: { b: 'bat', col: '#4a3a36', wing: '#3a2c2a' },
  pteranodon: { b: 'bat', col: '#b07a5a', wing: '#9a6248', crest: true },
  // water
  fish: { b: 'fish', col: '#4a8fd6', col2: '#d8e8f6', fin: '#3a76b8' },
  goldfish: { b: 'fish', col: '#f28a2a', col2: '#f6c88a', fin: '#f2a24a', fancy: true },
  clownfish: { b: 'fish', col: '#f27a1a', col2: '#f6a24a', fin: '#f27a1a', bands: true },
  shark: { b: 'fish', col: '#7d8a99', col2: '#f2f4f6', fin: '#6a7686', shark: true },
  whale: { b: 'fish', col: '#3e566e', col2: '#c8d4de', fin: '#34495e', whale: true },
  dolphin: { b: 'fish', col: '#7d93a8', col2: '#e8eef4', fin: '#6a7f94', dolphin: true },
  dunkleosteus: { b: 'fish', col: '#6e6e72', col2: '#a8a8ac', fin: '#5a5a5e', armor: true },
  octopus: { b: 'octopus', col: '#d2563a', col2: '#f0a080' },
  jellyfish: { b: 'jelly', col: '#c8a8e8', col2: '#f0e0fa' },
  seaturtle: { b: 'turtle', col: '#6a8a4a', shell: '#7a6a3a', sea: true },
  crab: { b: 'crab', col: '#d8452a' },
  // reptiles and amphibians
  turtle: { b: 'turtle', col: '#7a8a4a', shell: '#5a4a2a' },
  crocodile: { b: 'croc', col: '#5a6a3a', col2: '#c8c08a', leg: .07, sn: .22 },
  lizard: { b: 'croc', col: '#6a9a3a', col2: '#c8d88a', leg: .06, sn: .08, small: true },
  gecko: { b: 'croc', col: '#d8a03a', col2: '#f2d88a', leg: .07, sn: .07, small: true, dots: true },
  snake: { b: 'snake', col: '#4a7a3a', col2: '#c8c88a', dk: '#1e2a18' },
  frog: { b: 'frog', col: '#5aa83a', col2: '#d8e88a', dk: '#2a4a1a' },
  dartfrog: { b: 'frog', col: '#2a6fd6', col2: '#4a8af0', dk: '#111111', spots: true },
  // insects and spiders
  butterfly: { b: 'butterfly', col: '#f28a1a', dk: '#1e1a16' },
  morpho: { b: 'butterfly', col: '#2a8ae8', dk: '#141a2a' },
  bee: { b: 'bee', col: '#f2b51c', dk: '#1e1a16' },
  ladybug: { b: 'beetle', col: '#d8262b', dk: '#141414', spots: true },
  beetle: { b: 'beetle', col: '#3a2a1e', dk: '#141414', horn: true },
  ant: { b: 'ant', col: '#3a1e14' },
  spider: { b: 'spider', col: '#2a2420' },
};
const ANIMAL_KINDS = Object.keys(ANIMALS);
const AN_NAMES = { trex: 'T. rex', bluemacaw: 'blue macaw', polarbear: 'polar bear', guineapig: 'guinea pig', seaturtle: 'sea turtle', dartfrog: 'poison dart frog' };
// (v327) What Cassie knows about each animal the kit can draw: its class, home, food, how it moves and one fact to tell.
const ANIMAL_FACTS = [
  ["lion", /\b(lions?|leon)\b/i, "mammal", "African savanna grassland", "meat (zebra, wildebeest, buffalo)", "walks on four legs, sprints in short bursts to pounce", "The only cats that live in groups (prides); the male has a mane"],
  ["tiger", /\b(tigers?)\b/i, "mammal", "Asian forests and grasslands", "meat (deer, wild pigs)", "stalks quietly on four legs, a strong swimmer", "The biggest cat; no two tigers have the same stripes"],
  ["leopard", /\b(leopards?)\b/i, "mammal", "African and Asian forests and savanna", "meat", "climbs trees and drags its food up a branch", "Its spots are rosettes, rings with a darker centre"],
  ["jaguar", /\b(jaguars?)\b/i, "mammal", "South and Central American rainforest", "meat (caimans, capybaras, fish)", "walks, climbs and swims well", "It has the strongest bite of any big cat for its size"],
  ["cheetah", /\b(cheetahs?)\b/i, "mammal", "African savanna", "meat (gazelles)", "the fastest land runner, about 100 km per hour in short sprints", "Black tear lines under its eyes cut the sun glare"],
  ["smilodon", /\b(smilodons?|saber.?tooth(ed)? (cats?|tigers?))\b/i, "mammal (extinct)", "Ice Age Americas, grasslands and woods", "meat (bison, horses)", "walked on four strong legs and ambushed prey", "Its long canine teeth were up to 28 cm; it lived until about 10,000 years ago"],
  ["elephant", /\b(elephants?|elepante)\b/i, "mammal", "African savanna and Asian forests", "plants (grass, leaves, bark, fruit)", "walks on four pillar legs on soft padded feet", "Its trunk is a nose and an upper lip joined, with about 40,000 muscles"],
  ["mammoth", /\b((woolly )?mammoths?)\b/i, "mammal (extinct)", "Ice Age tundra", "grass and shrubs", "walked on four legs like an elephant", "It had thick fur and a fat hump to keep warm; it lived until about 4,000 years ago"],
  ["rhino", /\b(rhinos?|rhinoceros(es)?)\b/i, "mammal", "African and Asian grassland and bush", "grass and leaves", "walks on four short legs, can charge fast", "Its horn is made of keratin, the same stuff as your nails"],
  ["hippo", /\b(hippos?|hippopotam(us|i|uses))\b/i, "mammal", "African rivers and lakes", "grass (grazes at night)", "walks along the river bottom, cannot really swim", "It spends the day in water to keep its skin cool and wet"],
  ["giraffe", /\b(giraffes?)\b/i, "mammal", "African savanna", "leaves from tall acacia trees", "walks moving both legs on one side together", "The tallest animal; its neck has only seven bones, like ours"],
  ["zebra", /\b(zebras?)\b/i, "mammal", "African savanna", "grass", "walks, trots and gallops on hooves", "Each zebra's stripes are different; they may keep biting flies away"],
  ["horse", /\b(horses?|kabayo)\b/i, "mammal", "grasslands (now farms everywhere)", "grass and hay", "walks, trots, canters and gallops on one-toed hooves", "A horse can sleep standing up"],
  ["buffalo", /\b(buffalo(es)?|bison|kalabaw|carabao)\b/i, "mammal", "grasslands and wetlands", "grass", "walks on hooves in big herds", "Buffalo wallow in mud to keep cool and keep insects off"],
  ["wildebeest", /\b(wildebeests?|gnus?)\b/i, "mammal", "African savanna", "grass", "walks and runs in huge herds", "Over a million wildebeest migrate across the Serengeti every year"],
  ["cow", /\b(cows?|cattle|bulls?|calf|calves|baka)\b/i, "mammal", "farms", "grass and hay", "walks on split hooves", "It has one stomach with four parts and chews its food twice (cud)"],
  ["pig", /\b(pigs?|piglets?|hogs?|baboy)\b/i, "mammal", "farms and forests", "almost anything (omnivore)", "walks on four short legs with split hooves", "Pigs roll in mud to cool down because they hardly sweat"],
  ["warthog", /\b(warthogs?)\b/i, "mammal", "African savanna", "grass, roots and bulbs", "trots with its tail straight up", "It kneels on its front legs to graze"],
  ["goat", /\b(goats?|kambing)\b/i, "mammal", "mountains and farms", "grass, leaves and shrubs", "climbs steep rocks on split hooves", "A goat's pupils are rectangles so it sees almost all round"],
  ["sheep", /\b(sheep|lambs?|tupa)\b/i, "mammal", "farms and hills", "grass", "walks on split hooves in flocks", "Its woolly coat keeps growing and is cut once a year"],
  ["deer", /\b(deer|reindeer|moose|elk|stags?|usa)\b/i, "mammal", "forests and grasslands", "leaves, grass and twigs", "walks and leaps on long thin legs", "A male deer grows new antlers every year"],
  ["camel", /\b(camels?)\b/i, "mammal", "deserts", "dry plants and thorns", "walks moving both legs on one side together", "Its hump stores fat, not water, and it can go weeks without drinking"],
  ["hyena", /\b(hyenas?)\b/i, "mammal", "African savanna", "meat (hunts and scavenges)", "lopes with long front legs and short back legs", "Its laugh like call tells others where it is"],
  ["wolf", /\b(wolves|wolf)\b/i, "mammal", "forests, tundra and mountains", "meat (deer, moose)", "trots for hours, hunts as a pack", "Wolves howl to keep their pack together"],
  ["fox", /\b(fox(es)?)\b/i, "mammal", "forests, fields and towns", "small animals, fruit and insects", "trots and pounces on mice under snow", "It uses its bushy tail as a blanket"],
  ["dog", /\b(dogs?|pupp(y|ies)|aso)\b/i, "mammal", "homes (tamed from wolves)", "meat and dog food", "walks, runs and swims", "A dog's nose smells about 10,000 times better than ours"],
  ["corgi", /\b(corgis?)\b/i, "mammal", "homes (a herding dog)", "dog food", "walks on short legs", "Corgis were bred to herd cows by nipping at their heels"],
  ["cat", /\b(cats?|kittens?|pusa)\b/i, "mammal", "homes", "meat (cat food, mice)", "walks silently on its toes, jumps high", "A cat can turn in the air to land on its feet"],
  ["bear", /\b(bears?|grizzl(y|ies)|brown bears?)\b/i, "mammal", "forests and mountains", "omnivore (berries, fish, roots)", "walks flat footed, can stand on two legs", "Many bears sleep through winter (hibernate)"],
  ["polarbear", /\b(polar bears?)\b/i, "mammal", "Arctic sea ice", "meat (seals)", "walks on ice and swims far", "Its fur looks white but its skin is black to soak up heat"],
  ["panda", /\b((giant )?pandas?)\b/i, "mammal", "Chinese mountain bamboo forests", "bamboo (12 hours of eating a day)", "walks slowly, climbs trees", "It has an extra thumb like wrist bone to grip bamboo"],
  ["rabbit", /\b(rabbits?|bunn(y|ies)|kuneho|hares?)\b/i, "mammal", "meadows, fields and homes", "grass and vegetables", "hops on long back legs", "Its teeth never stop growing"],
  ["mouse", /\b(mice|mouse|daga|rats?)\b/i, "mammal", "fields and homes", "seeds and grain", "scurries on four legs, climbs", "Mice talk in squeaks too high for us to hear"],
  ["hamster", /\b(hamsters?)\b/i, "mammal", "deserts (wild) and homes", "seeds and grain", "scurries and runs on a wheel", "It carries food in stretchy cheek pouches"],
  ["guineapig", /\b(guinea ?pigs?|cav(y|ies))\b/i, "mammal", "homes (from South American grasslands)", "hay, grass and vegetables", "scurries, jumps when happy (popcorning)", "It must eat vitamin C every day like us"],
  ["hedgehog", /\b(hedgehogs?)\b/i, "mammal", "gardens and woods", "insects and worms", "scurries, rolls into a ball when scared", "It has about 5,000 spines made of keratin"],
  ["ferret", /\b(ferrets?)\b/i, "mammal", "homes (tamed from polecats)", "meat", "bounds with a long bendy body", "Ferrets sleep about 15 hours a day"],
  ["trex", /\b(t[.\- ]? ?rex|tyrannosaur(us)?( rex)?)\b/i, "reptile (dinosaur, extinct)", "Late Cretaceous North American forests and plains, 66 million years ago", "meat", "walked on two strong back legs, balanced by its tail", "Its bite was the strongest of any land animal ever"],
  ["raptor", /\b(raptors?|velociraptors?)\b/i, "reptile (dinosaur, extinct)", "Cretaceous Asian deserts", "meat (small animals)", "ran on two legs, slashing with a big toe claw", "It was turkey sized and had feathers"],
  ["triceratops", /\b(triceratops(es)?)\b/i, "reptile (dinosaur, extinct)", "Cretaceous North American plains", "plants (cut with its beak)", "walked on four sturdy legs", "Its three horns and frill may have protected it and shown off to others"],
  ["stegosaurus", /\b(stegosaur(us|uses)?)\b/i, "reptile (dinosaur, extinct)", "Jurassic plains, 150 million years ago", "low plants", "walked on four legs, the back legs longer", "The spikes on its tail (the thagomizer) were for defence"],
  ["brachiosaurus", /\b(brachiosaur(us|uses)?|sauropods?|long.?neck(ed)? dinosaurs?)\b/i, "reptile (dinosaur, extinct)", "Jurassic forests", "leaves from tall trees", "walked on four pillar legs, front ones longer", "It was as tall as a four storey building"],
  ["meerkat", /\b(meerkats?)\b/i, "mammal", "Kalahari desert", "insects, scorpions and lizards", "scurries, stands on its back legs to watch", "One meerkat stands guard while the others dig for food"],
  ["monkey", /\b(monkeys?|chimp(anzee)?s?|unggoy|matsing)\b/i, "mammal (primate)", "tropical forests", "fruit, leaves and insects", "climbs and swings with hands, feet and tail", "Monkeys groom each other to stay friends"],
  ["sloth", /\b(sloths?)\b/i, "mammal", "Central and South American rainforest", "leaves", "hangs upside down and moves very slowly", "Algae grows in its fur and helps it hide"],
  ["gorilla", /\b(gorillas?|apes?)\b/i, "mammal (primate)", "African rainforest", "leaves, stems and fruit", "knuckle walks on four limbs", "The largest primate; it shares about 98 percent of our DNA"],
  ["kangaroo", /\b(kangaroos?|wallab(y|ies))\b/i, "mammal (marsupial)", "Australian grassland and bush", "grass", "hops on big back legs, using its tail for balance", "Its baby (joey) grows in a pouch"],
  ["eagle", /\b(eagles?|agila)\b/i, "bird", "mountains, forests and coasts", "meat (fish, rabbits)", "soars on wide wings, dives to grab with its talons", "An eagle sees about four times sharper than we do"],
  ["falcon", /\b(falcons?)\b/i, "bird", "cliffs, open land and cities", "birds caught in the air", "flies fast; the peregrine dives over 300 km per hour", "The peregrine falcon is the fastest animal on Earth"],
  ["hawk", /\b(hawks?|lawin)\b/i, "bird", "open fields and woods", "small animals", "circles high, then swoops down", "A hawk's eyes face forward to judge distance when it strikes"],
  ["owl", /\b(owls?|kuwago)\b/i, "bird", "forests, barns and deserts", "mice, insects and small animals", "flies silently on soft edged feathers", "It can turn its head about three quarters of the way round"],
  ["macaw", /\b(macaws?|scarlet macaws?)\b/i, "bird (parrot)", "South American rainforest", "nuts, seeds and fruit", "flies in pairs and climbs with beak and feet", "Macaws eat clay from river banks to help digest seeds"],
  ["bluemacaw", /\b(blue (and (yellow|gold) )?macaws?|hyacinth macaws?)\b/i, "bird (parrot)", "South American rainforest and palm swamps", "palm nuts", "flies and climbs", "Its beak can crack nuts too hard for a hammer"],
  ["parrot", /\b(parrots?|loros?)\b/i, "bird", "tropical forests", "seeds, nuts and fruit", "flies and climbs, two toes forward and two back", "Many parrots can copy words"],
  ["budgie", /\b(budgies?|budgerigars?|parakeets?)\b/i, "bird", "Australian grassland and homes", "seeds", "flies fast in flocks", "Wild budgies are always green and yellow"],
  ["toucan", /\b(toucans?)\b/i, "bird", "South American rainforest", "fruit", "hops between branches, short flights", "Its huge beak is light (hollow) and helps it lose heat"],
  ["hummingbird", /\b(humming ?birds?)\b/i, "bird", "the Americas, gardens and forests", "flower nectar and tiny insects", "hovers by beating its wings up to 80 times a second", "The only bird that can fly backwards"],
  ["penguin", /\b(penguins?)\b/i, "bird", "Antarctic ice and southern coasts", "fish and krill", "waddles on land, flies under water with flipper wings", "It cannot fly in the air; its wings are flippers"],
  ["flamingo", /\b(flamingos?|flamingoes)\b/i, "bird", "salty lakes and lagoons", "shrimp and algae (which make it pink)", "wades on long legs, flies in flocks", "It often stands on one leg to stay warm"],
  ["chicken", /\b(chickens?|hens?|roosters?|chicks?|manok)\b/i, "bird", "farms", "seeds, grain and insects", "walks and scratches, flutters short distances", "Chickens come from the red junglefowl of Asian forests"],
  ["duck", /\b(ducks?|ducklings?|pato)\b/i, "bird", "ponds, lakes and rivers", "water plants, seeds and insects", "swims with webbed feet, flies, waddles", "Its feathers are waterproofed with oil"],
  ["dodo", /\b(dodos?)\b/i, "bird (extinct)", "the island of Mauritius", "fruit and seeds", "walked; it could not fly", "It died out about 1681, soon after people arrived"],
  ["crow", /\b(crows?|ravens?|uwak)\b/i, "bird", "almost everywhere", "almost anything", "walks, hops and flies", "Crows use sticks as tools and remember faces"],
  ["bat", /\b(bats?|paniki)\b/i, "mammal", "caves and forests", "insects or fruit", "the only mammal that truly flies, on skin wings over long fingers", "Many bats find food in the dark by echolocation (echoes of their squeaks)"],
  ["pteranodon", /\b(pteranodons?|pterosaurs?|pterodactyls?)\b/i, "reptile (flying, extinct, not a dinosaur)", "Cretaceous seas and coasts", "fish", "glided and soared on skin wings", "Its wings were about 7 metres across"],
  ["fish", /\b(fish(es)?|isda)\b/i, "fish", "rivers, lakes and seas", "plants, insects or other fish", "swims by waving its tail; fins steer", "Fish breathe with gills that take oxygen out of water"],
  ["goldfish", /\b(goldfish)\b/i, "fish", "ponds and tanks", "flakes, plants and insects", "swims by waving its tail", "Goldfish can see more colours than we can"],
  ["clownfish", /\b(clown ?fish)\b/i, "fish", "coral reefs", "algae and tiny animals", "swims in and out of a sea anemone", "A slime coat stops the anemone stinging it"],
  ["shark", /\b(sharks?|pating)\b/i, "fish", "oceans", "fish, seals and squid", "swims by sweeping its tail side to side", "Its skeleton is cartilage, not bone, and it regrows lost teeth"],
  ["whale", /\b(whales?|balyena)\b/i, "mammal", "oceans", "krill and fish", "swims by beating its tail up and down", "It breathes air through a blowhole on top of its head"],
  ["dolphin", /\b(dolphins?|lumba.?lumba)\b/i, "mammal", "oceans and some rivers", "fish and squid", "swims by beating its tail up and down, leaps", "Dolphins call each other by signature whistles, like names"],
  ["dunkleosteus", /\b(dunkleosteus|armou?red fish)\b/i, "fish (extinct)", "Devonian seas, 360 million years ago", "other fish", "swam with a long body", "Its head was covered in bony armour plates that made sharp jaws"],
  ["octopus", /\b(octop(us|uses|i)|pugita)\b/i, "invertebrate (mollusc)", "oceans, rocks and reefs", "crabs and shellfish", "crawls on eight arms or jets water to shoot backwards", "It has three hearts and changes colour in a blink"],
  ["jellyfish", /\b(jelly ?fish(es)?|dikya)\b/i, "invertebrate", "oceans", "tiny animals caught with stinging tentacles", "pulses its bell to swim, drifts with currents", "It has no brain, heart or bones"],
  ["seaturtle", /\b(sea turtles?|pawikan)\b/i, "reptile", "warm oceans and beaches", "sea grass and jellyfish", "swims with flipper legs", "It comes back to the beach where it hatched to lay eggs"],
  ["crab", /\b(crabs?|alimango|alimasag)\b/i, "invertebrate (crustacean)", "seashores and the sea floor", "almost anything", "walks sideways on eight legs", "It sheds its hard shell to grow"],
  ["turtle", /\b(turtles?|tortoises?|pagong)\b/i, "reptile", "ponds and land", "plants and small animals", "walks slowly, some swim", "Its shell is part of its skeleton and grows with it"],
  ["crocodile", /\b(crocodiles?|alligators?|buwaya)\b/i, "reptile", "rivers and swamps", "meat (fish, animals at the water's edge)", "swims with its tail, walks or crawls on short legs", "It has been around since the time of the dinosaurs"],
  ["lizard", /\b(lizards?|iguanas?|butiki|bayawak)\b/i, "reptile", "deserts, forests and rocks", "insects and plants", "runs on four legs with a side to side wiggle", "Many lizards can drop their tail to escape and grow it back"],
  ["gecko", /\b(geckos?|tuko)\b/i, "reptile", "warm places, walls of houses", "insects", "climbs walls with sticky toe pads", "Millions of tiny hairs on its toes let it walk upside down"],
  ["snake", /\b(snakes?|ahas|python|cobra)\b/i, "reptile", "almost everywhere but very cold places", "meat (mice, eggs, frogs)", "slides by curving its body in S waves", "It smells with its tongue and swallows food whole"],
  ["frog", /\b(frogs?|toads?|palaka)\b/i, "amphibian", "ponds, rivers and wet forests", "insects", "hops and swims with long webbed back legs", "It starts life as a tadpole in water and breathes through its skin too"],
  ["dartfrog", /\b((poison )?dart frogs?|poison frogs?)\b/i, "amphibian", "Central and South American rainforest", "ants and tiny insects", "hops", "Its bright colours warn that its skin is poisonous"],
  ["butterfly", /\b(butterfl(y|ies)|monarchs?|paru.?paro)\b/i, "invertebrate (insect)", "gardens, meadows and forests", "flower nectar", "flies by flapping two pairs of wings", "It changes from caterpillar to chrysalis to butterfly (metamorphosis)"],
  ["morpho", /\b((blue )?morphos?)\b/i, "invertebrate (insect)", "South and Central American rainforest", "rotting fruit", "flies flashing its blue wings", "Its blue comes from tiny scales that bend light, not paint"],
  ["bee", /\b(bees?|bumble ?bees?|bubuyog)\b/i, "invertebrate (insect)", "gardens, meadows, hives", "nectar and pollen", "flies, beating its wings about 200 times a second", "Bees carry pollen from flower to flower so plants can make seeds"],
  ["ladybug", /\b(lady ?bugs?|lady ?birds?)\b/i, "invertebrate (insect, a beetle)", "gardens", "aphids", "crawls, flies with wings under its spotted case", "One ladybug eats thousands of aphids"],
  ["beetle", /\b(beetles?|salagubang)\b/i, "invertebrate (insect)", "almost everywhere", "plants, wood or dead things", "crawls on six legs, flies with wings under hard covers", "There are more kinds of beetle than any other animal"],
  ["ant", /\b(ants?|langgam)\b/i, "invertebrate (insect)", "almost everywhere on land", "seeds, sugar and other insects", "walks fast on six legs", "An ant can carry many times its own weight"],
  ["spider", /\b(spiders?|gagamba|tarantulas?)\b/i, "invertebrate (arachnid, not an insect)", "homes, gardens and forests", "insects caught in webs", "walks on eight legs, spins silk", "Spider silk is stronger than steel of the same thickness"],
];
const HABITATS = { 'sky': 'eagle, falcon, hawk, hummingbird, bat, crow', 'forest and rainforest': 'tiger, jaguar, gorilla, monkey, sloth, macaw, toucan, owl, dartfrog, morpho, snake', 'savanna and grassland': 'lion, cheetah, elephant, giraffe, zebra, rhino, wildebeest, hyena, warthog', 'desert': 'camel, meerkat, lizard, snake, hawk', 'ocean': 'whale, dolphin, shark, octopus, jellyfish, seaturtle, clownfish, crab', 'rivers and wetlands': 'hippo, crocodile, frog, duck, flamingo, buffalo', 'polar': 'polarbear, penguin', 'farm and home': 'cow, pig, sheep, goat, horse, chicken, duck, dog, cat, rabbit, hamster' };
const AN_CLASS = 'Animals with a backbone (vertebrates): mammals (hair, feed babies milk: lion, whale, bat), birds (feathers, beaks, lay eggs: eagle, penguin), reptiles (dry scales, lay eggs on land: snake, crocodile, turtle), amphibians (moist skin, start life in water: frog), fish (gills and fins: shark, clownfish). Animals without a backbone (invertebrates): insects (six legs: bee, butterfly, ant), arachnids (eight legs: spider), crustaceans (crab), molluscs (octopus), jellyfish.';
export function animalGuide(asked = '') {
  const q = String(asked || ''), out = [];
  const hits = ANIMAL_FACTS.filter((a) => a[1].test(q)).sort((a, b) => q.match(b[1])[0].length - q.match(a[1])[0].length).slice(0, 3);
  hits.forEach(([kind, , cls, home, food, moves, fact]) => out.push(`About the ${AN_NAMES[kind] || kind} (draw it with the animal kit, kind "${kind}", and it moves on its own): class: ${cls}. Home: ${home}. Food: ${food}. How it moves: ${moves}. ${fact}.`));
  if (/\b(habitats?|ecosystems?|biomes?|where (do|does) .* live|tirahan)\b/i.test(q)) out.push('Animal habitats, each with the animal kit kinds that live there: ' + Object.entries(HABITATS).map(([h, k]) => `${h}: ${k}`).join('; ') + '. Draw each habitat as its own band or layer (sky on top, then forest, desert, savanna, and the ocean at the bottom), each with its own ground and the right animals on it.');
  if (/\b(classif\w*|vertebrates?|invertebrates?|mammals?|reptiles?|amphibians?|kinds of animals|types of animals|animal groups?)\b/i.test(q)) out.push(AN_CLASS);
  return out.join('\n');
}
// its box (for the checks and the labels), from where it stands
function animalTall(A) {
  if (A.b === 'quad') return A.leg + A.bh + Math.max(A.tilt || 0, 0) + Math.max(0, Math.sin((A.neck[1]) * Math.PI / 180) * A.neck[0]) + A.hr * 1.4 + (A.horn === 'antlers' ? .12 : 0) + (A.hump || 0);
  return ({ upright: .9, bird: A.upright ? .9 : (A.leg || .1) + .55, bat: .4, fish: A.whale ? .4 : .42, octopus: .7, jelly: .9, turtle: .32, crab: .35, croc: .2, snake: .22, frog: .55, butterfly: .7, bee: .45, beetle: .4, ant: .3, spider: .35 })[A.b] || .5;
}
function animalBox(sh) {
  const x = +sh.x, y = +sh.y, w = +sh.w || 160, A = ANIMALS[String(sh.kind)] || ANIMALS.lion, tall = animalTall(A) * w;
  if (A.b === 'fish' || A.b === 'jelly' || A.b === 'octopus' || (A.b === 'bird' && sh.pose === 'fly') || A.b === 'bat') return [[x - w / 2, y - tall / 2], [x + w / 2, y + tall / 2]];
  return [[x - w / 2, y - tall], [x + w / 2, y]];
}
let animalN = 0;
function animalShape(s, mk) {
  const kind = ANIMALS[String(s.kind || '').toLowerCase()] ? String(s.kind).toLowerCase() : 'lion', A = ANIMALS[kind];
  const N = (v, lo, hi, d) => { v = +v; return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; };
  const x = N(s.x ?? s.cx, -40, 440, 200), y = N(s.y ?? s.cy, -40, 300, 200), w = N(s.w ?? s.size ?? s.h, 8, 400, 140);
  const id = `ldan${++animalN}`, moving = !s.still;
  const root = mk('g', { class: 'ld-kit ld-animal' });
  const top = mk('g', s.facing === 'left' ? { transform: `translate(${2 * x},0) scale(-1,1)` } : {}); root.appendChild(top);
  const P = (u, v) => [x + u * w, y - v * w], fx = (n) => n.toFixed(1);
  const path = (parent, d, fill, o = {}) => { const e = mk('path', { d, fill: fill || 'none', stroke: o.stroke || 'none', 'stroke-width': o.w || Math.max(1.1, w * .009), 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }); if (o.op != null) e.setAttribute(fill && fill !== 'none' ? 'fill-opacity' : 'stroke-opacity', o.op); parent.appendChild(e); return e; };
  const blob = (pts) => ksmooth(pts.map(([u, v]) => P(u, v)));
  const circ = (u, v, r) => kc(...P(u, v), r * w), oval = (u, v, rx, ry, rot = 0) => ke(...P(u, v), rx * w, ry * w, rot);
  const line = (pts) => 'M' + pts.map(([u, v]) => P(u, v).map(fx).join(',')).join('L');
  const curve = (pts) => { const q = pts.map(([u, v]) => P(u, v)); let d = `M${fx(q[0][0])},${fx(q[0][1])}`; for (let i = 1; i < q.length - 1; i++) { const mx = (q[i][0] + q[i + 1][0]) / 2, my = (q[i][1] + q[i + 1][1]) / 2; d += `Q${fx(q[i][0])},${fx(q[i][1])} ${i === q.length - 2 ? fx(q[i + 1][0]) : fx(mx)},${i === q.length - 2 ? fx(q[i + 1][1]) : fx(my)}`; } return d; };
  // a limb: an outline round points with widths, smooth
  const limb = (pts, wd) => { const L = [], R = []; pts.forEach((p, i) => { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)]; let tx = b[0] - a[0], ty = b[1] - a[1]; const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l; const h = wd[i] / 2; L.push([p[0] - ty * h, p[1] + tx * h]); R.push([p[0] + ty * h, p[1] - tx * h]); }); return blob([...L, ...R.reverse()]); };
  const edge = (c, k = .42) => kitDark(c, k), lite = (c, k = .45) => kitLight(c, k);
  // a moving part: its own group, turning about a point
  const mover = (parent, cls, u, v, delay = 0, extra = '') => { const [ox, oy] = P(u, v); const g = mk('g', moving ? { class: `ld-anim ${cls}`, style: `transform-origin:${fx(ox)}px ${fx(oy)}px;animation-delay:${delay}s;${extra}` } : {}); parent.appendChild(g); return g; };
  // a pattern clipped to an outline
  const clipTo = (d) => { const cid = `${id}c${top.querySelectorAll('clipPath').length}`; const cp = mk('clipPath', { id: cid }); const pe = mk('path', { d }); cp.appendChild(pe); top.appendChild(cp); const g = mk('g', { 'clip-path': `url(#${cid})` }); return g; };
  const R = krand(kind.length * 977 + Math.round(x) * 7 + Math.round(y) * 13);
  const pattern = (g, A, u0, v0, u1, v1) => {
    const dk = A.dk || '#222';
    if (A.pat === 'stripes') for (let u = u0; u < u1; u += .038 + R() * .016) { // (from the back down, each one tapering to a point, leaning, some forked, none the same)
      const wd = .01 + R() * .012, len = (v1 - v0) * (.55 + R() * .45), lean = (R() - .4) * .04, end = v1 + .02 - len;
      path(g, blob([[u - wd * .5, v1 + .03], [u + wd * .5, v1 + .03], [u + wd * .4 + lean * .5, (v1 + end) / 2], [u + lean + .003, end], [u - wd * .3 + lean * .5, (v1 + end) / 2]]), dk, { op: .92 });
      if (R() < .35) path(g, blob([[u + lean * .5, (v1 + end) / 2], [u + lean * .5 + .025, end + .01], [u + lean * .5 + .006, (v1 + end) / 2 - .01]]), dk, { op: .92 });
    }
    const area = Math.max(.002, (u1 - u0) * (v1 - v0)) / .08;
    if (A.pat === 'spots') for (let k = 0; k < 90 * area; k++) path(g, circ(u0 + R() * (u1 - u0), v0 + R() * (v1 - v0), .006 + R() * .005), dk, { op: .85 });
    if (A.pat === 'rosettes') for (let k = 0; k < 45 * area; k++) { const cu = u0 + R() * (u1 - u0), cv = v0 + R() * (v1 - v0), r = .014 + R() * .008; for (let j = 0; j < 5; j++) { const a = j / 5 * Math.PI * 2 + R(); path(g, circ(cu + Math.cos(a) * r, cv + Math.sin(a) * r, .0045 + R() * .002), dk, { op: .88 }); } path(g, circ(cu, cv, r * .6), edge(A.col, .18), { op: .6 }); }
    if (A.pat === 'patches') for (let u = u0; u < u1; u += .05) for (let v = v0; v < v1; v += .05) { const cu = u + R() * .012, cv = v + R() * .012; path(g, blob([[cu - .02, cv], [cu - .012, cv + .02], [cu + .015, cv + .019], [cu + .021, cv - .002], [cu + .01, cv - .02], [cu - .015, cv - .018]]), dk, { op: .92 }); }
    if (A.pat === 'cow') for (let k = 0; k < 6; k++) { const cu = u0 + R() * (u1 - u0), cv = v0 + R() * (v1 - v0), r = .05 + R() * .04; path(g, blob(Array.from({ length: 7 }, (_, j) => { const a = j / 7 * Math.PI * 2; return [cu + Math.cos(a) * r * (.7 + R() * .5), cv + Math.sin(a) * r * (.7 + R() * .5)]; })), dk, { op: .95 }); }
    if (A.pat === 'saddle') path(g, blob([[u0 + .1, v1], [u0 + .25, v1 + .02], [u0 + .3, v0 + .1], [u0 + .15, v0 + .05]]), A.col2, {});
  };
  const eye = (parent, u, v, r = .012, col = '#1a1412') => { path(parent, circ(u, v, r), col, {}); path(parent, circ(u + r * .3, v + r * .35, r * .35), '#ffffff', { op: .85 }); };
  const shadow = () => path(top, ke(x, y + 1, w * .42, Math.max(2, w * .03)), '#000000', { op: .13 });

  if (A.b === 'quad') {
    const { leg, bh } = A, t = A.tilt || 0, legT = A.legT || .07, hump = A.hump || 0, col = A.col, dk = A.dk || edge(col);
    const back = leg + bh, bot = leg;
    // the body outline
    const torso = A.biped
      ? [[-.36, back - .04], [-.28, back + .01], [-.05, back + t], [.16, back + t + .01], [.26, bot + bh * .55 + t], [.2, bot + .02], [.0, bot - .02], [-.2, bot + .02], [-.32, bot + bh * .45]]
      : [[-.3, back - t * .8 - .015], [-.35, bot + bh * .55], [-.27, bot + bh * (A.tuck ? .3 : .05)], [-.12, bot + bh * (A.tuck || 0) * .9], [.06, bot - .01], [.2, bot + .005], [.32, bot + bh * .5 + t * .5], [.24, back + t + hump * (A.trunk ? 1 : .4)], [.0, back + (A.hump && !A.trunk ? hump : 0)], [-.18, back - t * .4]];
    const neckBase = A.biped ? [.2, back + t - bh * .15] : [.25, back + t - bh * .25], na = A.neck[1] * Math.PI / 180, nl = A.neck[0];
    const h0 = [neckBase[0] + Math.cos(na) * nl + A.hr * .5, neckBase[1] + Math.sin(na) * nl + (A.trunk ? bh * .1 : 0)];
    shadow();
    // the tail (behind the body)
    const tailG = mover(top, 'ld-a-tail', torso[0][0] - .02, torso[0][1] - .03, -R());
    const ts = [torso[0][0] - .02, torso[0][1] - .03];
    if (A.tail === 'dino') path(tailG, limb([[ts[0] + .06, ts[1] - .01], [ts[0] - .15, ts[1] - .06], [ts[0] - .36, ts[1] - .14], [ts[0] - .5, ts[1] - .17]], [bh * .7, bh * .4, bh * .15, .01]), col, { stroke: edge(col) });
    else if (A.tail === 'tuft' || A.tail === 'thin' || A.tail === 'long' || A.tail === 'rat') { const len = A.tail === 'long' ? .36 : A.tail === 'rat' ? .45 : .24, droop = A.tail === 'long' ? .05 : .2; path(tailG, curve([ts, [ts[0] - len * .35, ts[1] - droop * .6], [ts[0] - len * .7, ts[1] - droop], [ts[0] - len, ts[1] - droop * (A.tail === 'long' ? -1 : 1.1)]]), 'none', { stroke: A.tail === 'rat' ? '#e8b8b8' : A.tip || col, w: Math.max(1.5, w * (A.tail === 'long' ? .022 : .012)) }); if (A.tail === 'tuft') path(tailG, oval(ts[0] - len, ts[1] - droop * 1.1 - .02, .018, .03, 20), dk, {}); if (A.tail === 'long' && A.pat === 'stripes') for (let k = 1; k < 5; k++) path(tailG, circ(ts[0] - len * k / 5, ts[1] - droop * (k / 5) + .0, .011), dk, { op: .9 }); }
    else if (A.tail === 'bushy' || A.tail === 'feather' || A.tail === 'horse') { const end = A.tail === 'horse' ? [ts[0] - .1, ts[1] - .3] : [ts[0] - .26, ts[1] - .1]; path(tailG, limb([ts, [(ts[0] + end[0]) / 2 - .03, (ts[1] + end[1]) / 2], end], [.03, A.tail === 'bushy' ? .085 : .06, .02]), A.tail === 'horse' ? dk : col, { stroke: edge(col) }); if (A.tip) path(tailG, oval(end[0] + .02, end[1] + .01, .035, .025, 20), A.tip, {}); }
    else if (A.tail === 'curl') path(tailG, `M${P(ts[0], ts[1]).map(fx)}q${-w * .03},${-w * .03} ${-w * .02},${w * .02}q${w * .02},${w * .02} ${w * .03},${-w * .005}`, 'none', { stroke: edge(col, .2), w: Math.max(1.5, w * .01) });
    else if (A.tail === 'puff') path(tailG, circ(ts[0] - .01, ts[1] - .03, .04), A.col2, { stroke: edge(A.col2, .25) });
    else if (A.tail === 'stub') path(tailG, oval(ts[0] - .02, ts[1] - .03, .03, .018, -30), col, { stroke: edge(col) });
    // a leg: from its top in the body down to the ground, hind legs bending back at the hock
    const legAt = (u, far, hind, delay) => {
      const g = mover(top, 'ld-a-leg', u, bot + bh * .45, delay);
      const c0 = A.panda ? A.dk : col, c = far ? edge(c0, .16) : c0, L = leg + bh * .45, tw = legT * (A.biped && !hind ? .4 : 1);
      if (A.biped && !hind) { path(g, limb([[u, bot + bh * .6], [u + .04, bot + bh * .4], [u + .06, bot + bh * .38]], [.03, .02, .012]), c, { stroke: edge(col) }); return; }
      const pts = hind ? [[u, bot + bh * .45], [u + .035, L * .5], [u - .02, L * .25], [u + .005, .015]] : [[u, bot + bh * .45], [u - .005, L * .55], [u + .005, L * .22], [u + .01, .015]];
      path(g, limb(pts, [tw * (hind ? 1.6 : 1.3), tw * .95, tw * .7, tw * .66]), c, { stroke: edge(col) });
      if (A.pat === 'stripes' && A.dk === '#1e1e1e') for (let k = 1; k < 6; k++) path(g, line([[u - tw * .4, L * k / 7], [u + tw * .45, L * k / 7 + .006]]), 'none', { stroke: A.dk, w: Math.max(1.4, w * .008) });
      const fu = pts[3][0];
      if (A.foot === 'hoof') path(g, blob([[fu - tw * .38, .025], [fu + tw * .42, .025], [fu + tw * .45, 0], [fu - tw * .4, 0]]), '#2a2422', {});
      else if (A.foot === 'pad') path(g, oval(fu, .012, tw * .44, .014), edge(col, .1), { stroke: edge(col) });
      else if (A.foot === 'claw') { path(g, oval(fu + .02, .012, tw * .6, .014), c, { stroke: edge(col) }); for (let k = 0; k < 3; k++) path(g, line([[fu + .03 + k * .012, .01], [fu + .045 + k * .012, 0]]), 'none', { stroke: '#e8e0cc', w: Math.max(1, w * .006) }); }
      else path(g, oval(fu + .01, .012, tw * .5, .015), A.kind === 'fox' ? dk : c, { stroke: edge(col) });
      if (kind === 'fox') path(g, limb([[u, L * .35], [fu + .005, .02]], [tw * .7, tw * .66]), dk, {});
    };
    const fore = A.biped ? .16 : .2, hind = A.biped ? -.08 : -.22;
    legAt(fore + .03, true, false, -.45); legAt(hind + .03, true, true, 0);
    legAt(fore, false, false, 0); legAt(hind, false, true, -.45);
    // the body, its shading and its coat
    const bodyD = blob(torso);
    // the neck and a hump behind the body, so they grow out of it with no seam
    const neckD = nl > 0.01 ? limb([[neckBase[0] - .02, neckBase[1] - bh * .1], [neckBase[0] + Math.cos(na) * nl * .5, neckBase[1] + Math.sin(na) * nl * .5], [h0[0] - A.hr * .45, h0[1] - A.hr * .1]], [bh * .62, Math.max(A.hr * 1.1, bh * .4), A.hr * 1.15]) : null;
    if (neckD) path(top, neckD, col, { stroke: edge(col) });
    if (A.hump && !A.trunk) path(top, oval(0, back + hump * .4, .11, hump * .75), col, { stroke: edge(col) });
    path(top, bodyD, col, { stroke: edge(col) });
    if (neckD) { const nk = clipTo(neckD); top.appendChild(nk); path(nk, neckD, col, {}); }
    if (A.mane === 'flow' || A.mane === 'stiff' || A.mane === 'short') { const m = [[neckBase[0] - .02, neckBase[1] + bh * .25], [h0[0] - A.hr * .5, h0[1] + A.hr * .6]]; path(top, limb([m[0], [(m[0][0] + m[1][0]) / 2 - .01, (m[0][1] + m[1][1]) / 2 + .02], m[1]], [A.mane === 'flow' ? .05 : .025, A.mane === 'flow' ? .05 : .03, .02]), A.mane === 'short' ? A.dk : dk, {}); }
    const coat = clipTo([bodyD, neckD].filter(Boolean).join(' '));
    top.appendChild(coat);
    path(coat, oval(0, bot + bh * .05, .38, bh * .28), A.col2, { op: .75 });
    pattern(coat, A, -.4, bot, .34, back + .12 + (nl > .3 ? nl : 0) * .9);
    if (A.pat === 'patches' && nl > .3) for (let k = 0; k < 9; k++) { const f = k / 9, cu = neckBase[0] + Math.cos(na) * nl * f, cv = neckBase[1] + Math.sin(na) * nl * f; path(coat, blob([[cu - .02, cv], [cu, cv + .02], [cu + .02, cv], [cu, cv - .02]]), A.dk, { op: .92 }); }
    path(coat, oval(-.02, back + t * .5, .3, bh * .16), lite(col, .4), { op: .28 });
    path(coat, oval(0, bot - bh * .05, .36, bh * .16), edge(col, .25), { op: .22 });
    if (A.udder) path(top, oval(-.1, bot - .01, .04, .025), '#f2b8b0', { stroke: edge('#f2b8b0') });
    if (A.panda) path(coat, blob([[.04, back + .1], [.2, back + .1], [.22, bot - .05], [.08, bot - .05]]), A.dk, {}); // (a panda's black shoulder band)
    if (A.hair) for (let k = 0; k < 26; k++) { const u = -.32 + k * .025, v = bot + bh * (.2 + R() * .3); path(top, line([[u, v + .06], [u + .01, v - .06]]), 'none', { stroke: edge(col, .3), w: Math.max(1.2, w * .008), op: .7 }); }
    if (A.wool) { const lumps = []; for (let k = 0; k < 18; k++) lumps.push([-.32 + (k % 6) * .12 + (Math.floor(k / 6) % 2) * .06, bot + .04 + Math.floor(k / 6) * bh * .33, .07]); lumps.forEach(([u, v, r]) => path(top, circ(u, v, r), A.wool, { stroke: edge(A.wool, .2) })); lumps.forEach(([u, v, r]) => path(top, circ(u - r * .2, v + r * .25, r * .45), '#ffffff', { op: .45 })); }
    if (A.spikes) for (let k = 0; k < 60; k++) { const a = Math.PI * (.05 + .9 * (k % 20) / 20), r = bh * (.5 + Math.floor(k / 20) * .12), cu = -.05 + Math.cos(a) * .3, cv = bot + bh * .45 + Math.sin(a) * r * .95; path(top, line([[cu, cv], [cu + Math.cos(a) * .05 - .015, cv + Math.sin(a) * .05]]), 'none', { stroke: A.spikes, w: Math.max(1.2, w * .009) }); }
    if (A.plates) for (let k = 0; k < 7; k++) { const u = -.24 + k * .07, h = .08 + Math.sin(k / 6 * Math.PI) * .07; path(top, blob([[u - .03, back + .01], [u, back + h + .02], [u + .03, back + .01]]), A.plates, { stroke: edge(A.plates) }); }
    // where the legs join: the shoulder and the haunch, drawn on the body
    if (!A.wool) { path(top, curve([[fore + .06, back - bh * .15], [fore - .04, bot + bh * .45], [fore + .01, bot + .02]]), 'none', { stroke: edge(col, .3), w: Math.max(1, w * .006), op: .55 }); if (!A.biped) path(top, curve([[hind - .1, back - bh * .1], [hind + .08, bot + bh * .5], [hind + .02, bot + .02]]), 'none', { stroke: edge(col, .3), w: Math.max(1, w * .006), op: .55 }); }
    // the head
    const headG = mover(top, 'ld-a-head', h0[0] - A.hr * .5, h0[1] - A.hr * .2, -R() * 2);
    const hr = A.hr, sn = A.sn, dr = A.drop || 0;
    if (A.mane && A.mane.startsWith('#')) { const mp = []; for (let k = 0; k < 14; k++) { const a = k / 14 * Math.PI * 2, r = hr * (1.55 + (k % 2) * .22); mp.push([h0[0] - hr * .35 + Math.cos(a) * r, h0[1] - hr * .1 + Math.sin(a) * r * 1.05]); } path(headG, blob(mp), A.mane, { stroke: edge(A.mane) }); }
    if (A.ear === 'big') path(headG, blob([[h0[0] - hr * .3, h0[1] + hr * .7], [h0[0] - hr * 1.3, h0[1] + hr * .6], [h0[0] - hr * 1.4, h0[1] - hr * .5], [h0[0] - hr * .9, h0[1] - hr * 1.3], [h0[0] - hr * .4, h0[1] - hr * .4]]), edge(col, .08), { stroke: edge(col) });
    if (A.frill) path(headG, blob(Array.from({ length: 11 }, (_, k) => { const a = Math.PI * (.35 + k / 10 * 1.1), r = hr * (1.5 + (k % 2) * .12); return [h0[0] - hr * .4 + Math.cos(a) * r, h0[1] + Math.sin(a) * r]; }).concat([[h0[0] - hr * .2, h0[1] - hr * .3]])), A.col2, { stroke: edge(A.col2) });
    const head = [[h0[0] - hr * .9, h0[1] + hr * .25], [h0[0] - hr * .2, h0[1] + hr * .92], [h0[0] + hr * .5, h0[1] + hr * .6], [h0[0] + hr * .6 + sn, h0[1] + hr * .12 - dr], [h0[0] + hr * .72 + sn, h0[1] - hr * .2 - dr], [h0[0] + hr * .5 + sn * .6, h0[1] - hr * .58 - dr * .7], [h0[0], h0[1] - hr * .72], [h0[0] - hr * .65, h0[1] - hr * .45]];
    const headD = blob(head);
    path(headG, headD, col, { stroke: edge(col) });
    const face = clipTo(headD); headG.appendChild(face);
    path(face, blob([[h0[0] - hr, h0[1] - hr], [h0[0] + hr + sn, h0[1] - hr], [h0[0] + hr + sn, h0[1] - hr * .3 - dr], [h0[0] - hr, h0[1] - hr * .2]]), A.col2, { op: .7 });
    if (A.pat && ['stripes', 'spots', 'rosettes'].includes(A.pat)) pattern(face, A, h0[0] - hr, h0[1] - hr, h0[0] + hr * .3, h0[1] + hr);
    if (A.points || A.mask) path(face, oval(h0[0] + hr * .3 + sn * .5, h0[1] - hr * .05, hr * .55, hr * .5), A.dk, { op: .85 });
    path(face, blob([[h0[0] - hr, h0[1] + hr * .5], [h0[0] + hr + sn, h0[1] + hr * .3], [h0[0] + hr + sn, h0[1] + hr], [h0[0] - hr, h0[1] + hr]]), lite(col, .5), { op: .3 });
    if (A.ear === 'pointed' || A.ear === 'round' || A.ear === 'small' || A.ear === 'mouse') { const big = A.ear === 'mouse' ? 1.6 : A.ear === 'small' ? .6 : kind === 'corgi' || kind === 'fox' ? 1.3 : 1; const eb = [h0[0] - hr * .25, h0[1] + hr * .78]; if (A.ear === 'pointed') path(headG, blob([[eb[0] - hr * .3 * big, eb[1] - hr * .05], [eb[0] - hr * .15 * big, eb[1] + hr * .55 * big], [eb[0] + hr * .25 * big, eb[1]]]), col, { stroke: edge(col) }); else { path(headG, circ(eb[0], eb[1] + hr * .1, hr * .28 * big), col, { stroke: edge(col) }); path(headG, circ(eb[0], eb[1] + hr * .1, hr * .15 * big), A.ear === 'mouse' ? '#f2b8b8' : A.panda ? A.dk : edge(col, .2), { op: A.panda ? 1 : .8 }); } if (A.panda) path(headG, circ(eb[0], eb[1] + hr * .1, hr * .28 * big), A.dk, {}); }
    if (A.ear === 'flop') path(headG, blob([[h0[0] - hr * .3, h0[1] + hr * .6], [h0[0] - hr * .65, h0[1] + hr * .3], [h0[0] - hr * .6, h0[1] - hr * .5], [h0[0] - hr * .35, h0[1] - hr * .3]]), edge(col, .12), { stroke: edge(col) });
    if (A.ear === 'long') [0, .12].forEach((o, k) => path(headG, blob([[h0[0] - hr * .4 - o * hr, h0[1] + hr * .7], [h0[0] - hr * .75 - o * hr, h0[1] + hr * 2.1], [h0[0] - hr * .45 - o * hr, h0[1] + hr * 2.25], [h0[0] - hr * .1 - o * hr, h0[1] + hr * .8]]), k ? edge(col, .15) : col, { stroke: edge(col) }));
    if (A.panda) path(face, oval(h0[0] + hr * .25, h0[1] + hr * .22, hr * .26, hr * .19, -25), A.dk, {});
    eye(headG, h0[0] + hr * .25 + (A.trunk ? 0 : sn * .15), h0[1] + hr * .28, Math.max(.007, hr * .12), A.panda ? '#5a4a3a' : '#1a1412');
    if (A.tear) path(headG, line([[h0[0] + hr * .3, h0[1] + hr * .2], [h0[0] + hr * .5, h0[1] - hr * .3], [h0[0] + hr * .6 + sn * .5, h0[1] - hr * .45]]), 'none', { stroke: '#2b2219', w: Math.max(1.2, w * .006) });
    path(headG, circ(h0[0] + hr * .62 + sn, h0[1] - hr * .1 - dr, hr * .08), edge(col, .5), {});
    path(headG, curve([[h0[0] + hr * .66 + sn, h0[1] - hr * .3 - dr], [h0[0] + hr * .3 + sn * .6, h0[1] - hr * .42 - dr * .7], [h0[0] + hr * .1, h0[1] - hr * .35]]), 'none', { stroke: edge(col, .5), w: Math.max(1, w * .006) });
    if (A.snout) path(headG, oval(h0[0] + hr * .74 + sn, h0[1] - hr * .2 - dr, hr * .1, hr * .2), lite(col, .2), { stroke: edge(col) });
    if (A.horn === 'rhino') { path(headG, blob([[h0[0] + hr * .3 + sn, h0[1] + hr * .1 - dr], [h0[0] + hr * .6 + sn, h0[1] + hr * 1.1], [h0[0] + hr * .7 + sn, h0[1] + hr * .05 - dr]]), '#cfc6b4', { stroke: '#8a826e' }); path(headG, blob([[h0[0] + hr * .05 + sn * .6, h0[1] + hr * .45], [h0[0] + hr * .2 + sn * .6, h0[1] + hr * .95], [h0[0] + hr * .32 + sn * .6, h0[1] + hr * .45]]), '#cfc6b4', { stroke: '#8a826e' }); }
    if (A.horn === 'buffalo') path(headG, `M${P(h0[0] - hr * .1, h0[1] + hr * .8).map(fx)}C${P(h0[0] - hr * 1.2, h0[1] + hr * 1.1).map(fx)} ${P(h0[0] - hr * 1.1, h0[1] - hr * .3).map(fx)} ${P(h0[0] - hr * .4, h0[1] - hr * .1).map(fx)}`, 'none', { stroke: '#2a2826', w: Math.max(2, w * .025) });
    if (A.horn === 'cow' || A.horn === 'goat') path(headG, curve([[h0[0] - hr * .1, h0[1] + hr * .8], [h0[0] - hr * .45, h0[1] + hr * 1.3], [h0[0] - hr * (A.horn === 'goat' ? 1 : .3), h0[1] + hr * (A.horn === 'goat' ? 1.1 : 1.5)]]), 'none', { stroke: A.horn === 'goat' ? '#8a7a62' : '#e8dcc0', w: Math.max(2, w * .016) });
    if (A.horn === 'antlers') { const b0 = [h0[0] - hr * .15, h0[1] + hr * .85]; path(headG, curve([b0, [b0[0] - .04, b0[1] + .08], [b0[0] - .08, b0[1] + .16]]), 'none', { stroke: '#7a5a3a', w: Math.max(1.6, w * .012) }); [[.04, .05], [.06, .1], [.01, .14]].forEach(([du, dv]) => path(headG, line([[b0[0] - du * .9, b0[1] + dv * .9], [b0[0] - du * .9 + .035, b0[1] + dv * .9 + .045]]), 'none', { stroke: '#7a5a3a', w: Math.max(1.4, w * .009) })); }
    if (A.horn === 'tri') { [[-.05, .7, .5], [.2, .85, .5]].forEach(([du, l, a]) => path(headG, blob([[h0[0] + du * hr * 2 - hr * .1, h0[1] + hr * .55], [h0[0] + du * hr * 2 + hr * l, h0[1] + hr * 1.25], [h0[0] + du * hr * 2 + hr * .15, h0[1] + hr * .5]]), '#e8dcc0', { stroke: '#8a7e64' })); path(headG, blob([[h0[0] + hr * .5 + sn, h0[1] + hr * .2 - dr], [h0[0] + hr * .75 + sn, h0[1] + hr * .55], [h0[0] + hr * .72 + sn, h0[1] + hr * .1 - dr]]), '#e8dcc0', { stroke: '#8a7e64' }); }
    if (A.ossicones) [0, .2].forEach((o) => { path(headG, line([[h0[0] - hr * (.1 + o), h0[1] + hr * .8], [h0[0] - hr * (.2 + o), h0[1] + hr * 1.35]]), 'none', { stroke: col, w: Math.max(1.6, w * .012) }); path(headG, circ(h0[0] - hr * (.2 + o), h0[1] + hr * 1.38, hr * .1), A.dk, {}); });
    if (A.beard) path(headG, blob([[h0[0] + hr * .1, h0[1] - hr * .6], [h0[0] + hr * .25, h0[1] - hr * 1.2], [h0[0] + hr * .45, h0[1] - hr * .6]]), A.dk, { op: .9 });
    if (A.sabre) path(headG, blob([[h0[0] + hr * .45 + sn * .5, h0[1] - hr * .45], [h0[0] + hr * .5 + sn * .5, h0[1] - hr * 1.15], [h0[0] + hr * .62 + sn * .5, h0[1] - hr * .5]]), '#f4efe2', { stroke: '#a89e86' });
    if (A.teeth) for (let k = 0; k < 6; k++) path(headG, blob([[h0[0] + hr * .1 + k * (hr * .5 + sn) / 6, h0[1] - hr * .38 - dr * .5], [h0[0] + hr * .14 + k * (hr * .5 + sn) / 6, h0[1] - hr * .5 - dr * .5], [h0[0] + hr * .18 + k * (hr * .5 + sn) / 6, h0[1] - hr * .38 - dr * .5]]), '#f4efe2', {});
    if (A.trunk) { const tg = mover(headG, 'ld-a-tail', h0[0] + hr * .6, h0[1] - hr * .2, -R(), 'animation-duration:2.8s'); path(tg, limb([[h0[0] + hr * .55, h0[1] - hr * .1], [h0[0] + hr * 1.05, h0[1] - hr * .9], [h0[0] + hr * 1.0, h0[1] - hr * 1.9], [h0[0] + hr * 1.25, h0[1] - hr * 2.4]], [hr * .6, hr * .45, hr * .3, hr * .22]), col, { stroke: edge(col) }); for (let k = 1; k < 9; k++) { const f = k / 9; path(tg, line([[h0[0] + hr * (.75 + f * .3), h0[1] - hr * (.3 + f * 1.9)], [h0[0] + hr * (.95 + f * .35), h0[1] - hr * (.32 + f * 1.9)]]), 'none', { stroke: edge(col, .3), w: Math.max(.8, w * .004), op: .7 }); } }
    if (A.tusks === 'straight' || A.tusks === 'curl') path(headG, A.tusks === 'curl' ? `M${P(h0[0] + hr * .5, h0[1] - hr * .5).map(fx)}C${P(h0[0] + hr * 1.6, h0[1] - hr * 1.6).map(fx)} ${P(h0[0] + hr * 2.4, h0[1] - hr * .4).map(fx)} ${P(h0[0] + hr * 1.6, h0[1] + hr * .2).map(fx)}` : curve([[h0[0] + hr * .5, h0[1] - hr * .5], [h0[0] + hr * 1.1, h0[1] - hr * 1.05], [h0[0] + hr * 1.55, h0[1] - hr * .85]]), 'none', { stroke: '#f4efe2', w: Math.max(2.4, w * .022) });
    if (A.tusks === 'warthog') path(headG, curve([[h0[0] + hr * .5 + sn * .7, h0[1] - hr * .3], [h0[0] + hr * .6 + sn * .8, h0[1] + hr * .2], [h0[0] + hr * .4 + sn * .7, h0[1] + hr * .5]]), 'none', { stroke: '#f4efe2', w: Math.max(1.8, w * .012) });
    if (A.biped) { const ag = mover(top, 'ld-a-tail', .2, back - bh * .35, -.3); path(ag, limb([[.2, back - bh * .35], [.25, back - bh * .55], [.29, back - bh * .5]], [.03, .02, .012]), col, { stroke: edge(col) }); }
  } else if (A.b === 'upright') { // standing or sitting up: a meerkat, a monkey, a sloth, a gorilla, a kangaroo
    const col = A.col, hr = A.hr, sit = !!A.sit, k = A.hop;
    shadow();
    const tailG = mover(top, 'ld-a-tail', -.05, .1, -R());
    if (A.tail === 'thin') path(tailG, curve([[-.08, .1], [-.2, .03], [-.28, .02]]), 'none', { stroke: edge(col, .1), w: Math.max(2, w * .03) });
    if (A.tail === 'monkey') path(tailG, `M${P(-.1, .12).map(fx)}C${P(-.4, .05).map(fx)} ${P(-.45, .45).map(fx)} ${P(-.3, .45).map(fx)}`, 'none', { stroke: col, w: Math.max(2, w * .03) });
    if (A.tail === 'kanga') path(tailG, limb([[-.08, .25], [-.25, .08], [-.4, .01]], [.12, .07, .03]), col, { stroke: edge(col) });
    const body = k ? [[-.12, .3], [-.06, .62], [.06, .7], [.13, .55], [.12, .25], [0, .12]] : sit ? [[-.2, .05], [-.22, .3], [-.12, .52], [.06, .56], [.16, .4], [.18, .12], [0, .02]] : [[-.1, .1], [-.11, .45], [-.05, .64], [.06, .66], [.11, .45], [.1, .1], [0, .05]];
    const bodyD = blob(body);
    if (k) { const lg = mover(top, 'ld-a-tail', -.02, .2, 0); path(lg, limb([[-.02, .3], [-.12, .14], [.05, .02], [.22, .01]], [.14, .1, .05, .04]), col, { stroke: edge(col) }); }
    else { const lg1 = mover(top, 'ld-a-leg', -.04, .2, -.4); path(lg1, limb([[-.04, .22], [sit ? .1 : -.05, sit ? .1 : .1], [sit ? .16 : -.04, .015]], [.09, .07, .06]), edge(col, .15), { stroke: edge(col) }); }
    path(top, bodyD, col, { stroke: edge(col) });
    const cg = clipTo(bodyD); top.appendChild(cg); path(cg, oval(.06, (body[3][1] + body[0][1]) / 2, .08, .3), A.col2, { op: .85 }); path(cg, oval(-.08, .5, .1, .25), lite(col, .4), { op: .3 });
    if (!k) { const lg2 = mover(top, 'ld-a-leg', .02, .2, 0); path(lg2, limb([[.02, .22], [sit ? .14 : .03, sit ? .1 : .1], [sit ? .22 : .05, .015]], [.09, .07, .06]), col, { stroke: edge(col) }); }
    const ag = mover(top, 'ld-a-head', .05, k ? .55 : .52, -.2);
    path(ag, limb([[.03, k ? .58 : .55], [.12, k ? .45 : .4], [.15, k ? .4 : sit ? .3 : .35]], [.06, .045, .035]), col, { stroke: edge(col) });
    const h0 = [k ? .1 : .02, (k ? .7 : sit ? .62 : .72) + hr * .6];
    const hg = mover(top, 'ld-a-head', h0[0], h0[1] - hr * .5, -R() * 2);
    const headD = blob([[h0[0] - hr * .8, h0[1]], [h0[0] - hr * .3, h0[1] + hr * .85], [h0[0] + hr * .5, h0[1] + hr * .7], [h0[0] + hr * (k ? 1.4 : .95), h0[1] - hr * .15], [h0[0] + hr * .4, h0[1] - hr * .75], [h0[0] - hr * .5, h0[1] - hr * .6]]);
    if (k) path(hg, blob([[h0[0] - hr * .4, h0[1] + hr * .6], [h0[0] - hr * .55, h0[1] + hr * 1.7], [h0[0] - hr * .15, h0[1] + hr * .7]]), col, { stroke: edge(col) });
    path(hg, headD, col, { stroke: edge(col) });
    const fg = clipTo(headD); hg.appendChild(fg); path(fg, oval(h0[0] + hr * .35, h0[1] - hr * .1, hr * .55, hr * .55), A.col2, { op: .9 }); if (A.mask) path(fg, oval(h0[0] + hr * .35, h0[1] + hr * .15, hr * .3, hr * .18), A.dk, { op: .8 });
    if (!k && kind !== 'sloth') path(hg, circ(h0[0] - hr * .45, h0[1] + hr * .25, hr * .22), col, { stroke: edge(col) });
    eye(hg, h0[0] + hr * .4, h0[1] + hr * .15, hr * .1, kind === 'sloth' ? '#2a1a10' : '#1a1412');
    path(hg, circ(h0[0] + hr * .85, h0[1] - hr * .15, hr * .08), A.dk, {});
  } else if (A.b === 'bird') { // perched (or standing) on its feet, or flying ("pose":"fly")
    const fly = s.pose === 'fly' && !A.flightless, up = !!A.upright, fat = A.fat ? 1.25 : 1, legL = fly ? 0 : A.leg;
    const by = fly ? 0 : legL + (up ? .3 : .18), col = A.col;
    if (!fly) shadow();
    const bodyPts = up ? [[-.12, by - .28], [-.15, by + .05], [-.08, by + .28], [.06, by + .3], [.13, by + .05], [.1, by - .28], [0, by - .32]]
      : [[-.32, by + .03], [-.15, by + .12 * fat], [.12, by + .13 * fat], [.24, by + .06], [.2, by - .08 * fat], [0, by - .13 * fat], [-.2, by - .07]];
    const head = up ? [.02, by + .36] : A.sneck ? [.18, by + .55] : [.27, by + .13];
    const hr = up ? (kind === 'owl' ? .13 : .09) : (kind === 'hummingbird' ? .055 : .075) * (A.fat ? 1.3 : 1);
    // tail
    const tg = mover(top, 'ld-a-tail', up ? -.05 : -.3, up ? by - .25 : by + .02, -R(), 'animation-duration:2.2s');
    if (A.tail === 'long') path(tg, blob([[-.28, by + .05], [-.62, by - .14], [-.64, by - .18], [-.26, by - .02]]), A.tc || col, { stroke: edge(A.tc || col) });
    else if (A.tail === 'fan') path(tg, blob([[-.28, by + .05], [-.5, by - .02], [-.52, by - .1], [-.26, by - .04]]), A.tc || col, { stroke: edge(A.tc || col) });
    else if (A.tail === 'hen') path(tg, blob([[-.28, by + .02], [-.4, by + .2], [-.46, by + .18], [-.34, by - .02]]), A.tc || col, { stroke: edge(A.tc || col) });
    else if (!up) path(tg, blob([[-.28, by + .03], [-.42, by - .02], [-.4, by - .06], [-.25, by - .04]]), A.tc || col, { stroke: edge(A.tc || col) });
    // legs
    if (!fly) [-.02, .05].forEach((u, k) => { const g = mover(top, A.swim ? 'ld-a-head' : 'ld-a-leg', u, by - .08, -k * .45, 'animation-duration:1.4s'); path(g, line([[u, by - (up ? .28 : .1)], [u + (A.sneck ? .0 : .01), legL * .5], [u, 0]]), 'none', { stroke: A.lc || '#8a7a5a', w: Math.max(1.4, w * (A.sneck ? .012 : .015)) }); path(g, line([[u - .04, 0], [u + .05, 0]]), 'none', { stroke: A.lc || '#8a7a5a', w: Math.max(1.4, w * .012) }); });
    // far wing (flying)
    if (fly) { const fw = mover(top, A.fast ? 'ld-a-wingf' : 'ld-a-wing', .02, by + .08, -.1); path(fw, blob([[-.08, by + .08], [-.1, by + .5], [.08, by + .55], [.12, by + .1]]), edge(A.wing, .18), { stroke: edge(A.wing) }); }
    const bodyD = blob(bodyPts);
    path(top, bodyD, col, { stroke: edge(col) });
    const cg = clipTo(bodyD); top.appendChild(cg); path(cg, up ? oval(.02, by - .05, .1, .22) : oval(.05, by - .08, .22, .08), A.belly, { op: .95 });
    if (A.bars) for (let k = 0; k < 12; k++) path(cg, line([[-.05 + k * .025, by - .1], [-.04 + k * .025, by - .02]]), 'none', { stroke: edge(A.belly, .35), w: Math.max(1, w * .005) });
    if (A.band) path(cg, oval(.0, by + .08, .1, .04), A.band, {});
    path(cg, oval(-.04, by + .1, .15, .04), lite(col, .5), { op: .35 });
    // near wing: folded on the body, or raised and flapping
    if (fly) { const nw = mover(top, A.fast ? 'ld-a-wingf' : 'ld-a-wing', .02, by + .06, 0); const wp = [[-.06, by + .07], [-.2, by + .42], [-.05, by + .62], [.1, by + .48], [.12, by + .08]]; path(nw, blob(wp), A.wing, { stroke: edge(A.wing) }); for (let k = 0; k < 5; k++) path(nw, line([[-.04 + k * .03, by + .12], [-.15 + k * .055, by + .5 + (k % 2) * .04]]), 'none', { stroke: edge(A.wing, .3), w: Math.max(.9, w * .005), op: .8 }); if (A.band) path(nw, line([[-.1, by + .3], [.08, by + .3]]), 'none', { stroke: A.band, w: Math.max(2, w * .03) }); }
    else { const wg = mover(top, 'ld-a-head', .1, by + .05, -R(), 'animation-duration:3s'); const wp = up ? [[-.12, by + .2], [-.16, by - .2], [-.08, by - .28], [-.04, by + .15]] : [[.14, by + .07], [-.05, by + .1], [-.3, by - .02], [-.15, by - .06], [.1, by - .03]]; path(wg, blob(wp), A.wing, { stroke: edge(A.wing) }); if (A.band) path(wg, oval(.0, by + .03, .1, .025), A.band, {}); for (let k = 0; k < (up ? 0 : 4); k++) path(wg, line([[-.02 - k * .06, by + .06], [-.08 - k * .06, by - .02]]), 'none', { stroke: edge(A.wing, .3), w: Math.max(.9, w * .005), op: .7 }); }
    // neck and head
    const hg = mover(top, 'ld-a-head', head[0] - hr * .5, head[1] - hr * .5, -R() * 2, 'animation-duration:1.8s');
    if (A.sneck) path(hg, curve([[.18, by + .08], [.08, by + .25], [.22, by + .4], [head[0], head[1] - hr * .4]]), 'none', { stroke: col, w: Math.max(3, w * .04) });
    if (A.neck) path(hg, oval(head[0] - hr * .1, head[1] - hr * .9, hr * .8, hr * .3), A.neck, { op: .9 });
    path(hg, circ(head[0], head[1], hr), A.head, { stroke: edge(A.head) });
    if (A.disc) path(hg, circ(head[0] + hr * .25, head[1], hr * .7), A.disc, { op: .9 });
    if (A.face) path(hg, oval(head[0] + hr * .35, head[1], hr * .45, hr * .35), A.face, {});
    if (A.throat) path(hg, oval(head[0] + hr * .1, head[1] - hr * .55, hr * .6, hr * .4), A.throat, {});
    if (A.ring) path(hg, oval(head[0] - hr * .1, head[1] - hr * .95, hr * .7, hr * .12), '#ffffff', {});
    if (A.tufts) [-.3, .2].forEach((o) => path(hg, blob([[head[0] + hr * o - hr * .15, head[1] + hr * .8], [head[0] + hr * o - hr * .1, head[1] + hr * 1.35], [head[0] + hr * o + hr * .12, head[1] + hr * .85]]), col, { stroke: edge(col) }));
    if (A.comb) { path(hg, blob([[head[0] - hr * .4, head[1] + hr * .85], [head[0] - hr * .2, head[1] + hr * 1.4], [head[0], head[1] + hr * 1.15], [head[0] + hr * .2, head[1] + hr * 1.4], [head[0] + hr * .45, head[1] + hr * .85]]), '#d8262b', { stroke: '#8f1416' }); path(hg, oval(head[0] + hr * .6, head[1] - hr * .7, hr * .15, hr * .3), '#d8262b', {}); }
    const bx = head[0] + hr * .85, bv = head[1] - hr * .05, bc = A.bc;
    const beak = { hook: [[bx - .01, bv + hr * .35], [bx + hr * .9, bv + hr * .1], [bx + hr * .85, bv - hr * .45], [bx + hr * .55, bv - hr * .15], [bx - .01, bv - hr * .25]], parrot: [[bx - .01, bv + hr * .4], [bx + hr * .7, bv + hr * .1], [bx + hr * .55, bv - hr * .7], [bx + hr * .2, bv - hr * .35], [bx - .01, bv - hr * .35]], cone: [[bx - .01, bv + hr * .25], [bx + hr * .7, bv - hr * .05], [bx - .01, bv - hr * .3]], needle: [[bx - .01, bv + hr * .12], [bx + hr * 3.2, bv - hr * .2], [bx - .01, bv - hr * .12]], owl: [[bx - hr * .25, bv + hr * .1], [bx + hr * .1, bv - hr * .3], [bx - hr * .3, bv - hr * .35]], duck: [[bx - .01, bv + hr * .2], [bx + hr * 1.1, bv - hr * .05], [bx + hr * 1.15, bv - hr * .25], [bx - .01, bv - hr * .3]], flamingo: [[bx - .01, bv + hr * .25], [bx + hr * 1.0, bv + hr * .05], [bx + hr * 1.1, bv - hr * .7], [bx + hr * .6, bv - hr * .3], [bx - .01, bv - hr * .25]], toucan: [[bx - .01, bv + hr * .55], [bx + hr * 2.6, bv + hr * .1], [bx + hr * 2.8, bv - hr * .3], [bx + hr * 1.2, bv - hr * .4], [bx - .01, bv - hr * .4]], dodo: [[bx - .01, bv + hr * .45], [bx + hr * 1.3, bv + hr * .2], [bx + hr * 1.35, bv - hr * .5], [bx + hr * .9, bv - hr * .25], [bx - .01, bv - hr * .4]] }[A.beak] || [[bx - .01, bv + hr * .25], [bx + hr * .7, bv], [bx - .01, bv - hr * .3]];
    path(hg, blob(beak), bc, { stroke: edge(bc, .35) });
    if (A.beak === 'toucan') path(hg, oval(bx + hr * 2.3, bv - hr * .05, hr * .35, hr * .25), '#1d1b1b', {});
    if (A.beak === 'flamingo') path(hg, oval(bx + hr * .95, bv - hr * .35, hr * .2, hr * .3), '#1e1e1e', {});
    eye(hg, head[0] + hr * (kind === 'owl' ? .45 : .35), head[1] + hr * .2, hr * (kind === 'owl' ? .28 : .18), kind === 'owl' ? '#f2b21c' : '#1a1412');
    if (kind === 'owl') path(hg, circ(head[0] + hr * .45, head[1] + hr * .2, hr * .14), '#1a1412', {});
  } else if (A.b === 'bat') {
    const col = A.col, by = 0;
    const wing = (side) => { const g = mover(top, 'ld-a-wing', 0, by + .04, side > 0 ? 0 : -.1); const pts = [[0, by + .06], [.12 * side, by + .3], [.3 * side, by + .32], [.48 * side, by + .2], [.38 * side, by + .1], [.3 * side, by + .14], [.22 * side, by + .02], [.12 * side, by + .06], [.06 * side, by - .04]]; path(g, blob(pts), side > 0 ? A.wing : edge(A.wing, .15), { stroke: edge(A.wing) }); [[.3, .32], [.48, .2], [.38, .1]].forEach(([u, v]) => path(g, line([[.02 * side, by + .05], [u * side, by + v]]), 'none', { stroke: edge(A.wing, .35), w: Math.max(1, w * .006) })); };
    wing(-1); path(top, oval(0, by, .07, .1), col, { stroke: edge(col) }); wing(1);
    const hg = mover(top, 'ld-a-head', 0, by + .08, 0);
    path(hg, circ(.02, by + .12, .05), col, { stroke: edge(col) });
    if (A.crest) { path(hg, blob([[0, by + .14], [-.2, by + .2], [.02, by + .17]]), col, { stroke: edge(col) }); path(hg, blob([[.05, by + .14], [.25, by + .08], [.05, by + .1]]), '#d8a83a', { stroke: '#8a6a2a' }); }
    else [-.03, .05].forEach((o) => path(hg, blob([[o - .02, by + .15], [o - .03, by + .22], [o + .02, by + .16]]), col, { stroke: edge(col) }));
    eye(hg, .04, by + .13, .008);
  } else if (A.b === 'fish') { // swimming, its middle at x, y
    const col = A.col, L = A.whale ? 1 : 1, h = A.whale ? .22 : A.shark ? .17 : A.dolphin ? .16 : A.fancy ? .26 : .22;
    const tg = mover(top, 'ld-a-fin', -.34, 0, -R());
    const tail = A.whale || A.dolphin ? [[-.34, 0], [-.48, .08], [-.52, .07], [-.45, 0], [-.52, -.07], [-.48, -.08]] : A.shark ? [[-.32, 0], [-.46, .2], [-.5, .19], [-.42, 0], [-.46, -.1], [-.42, -.11]] : [[-.32, 0], [-.48, h * .85], [-.5, h * .7], [-.43, 0], [-.5, -h * .7], [-.48, -h * .85]];
    path(tg, blob(tail), A.fin, { stroke: edge(A.fin) });
    if (A.fancy) path(tg, blob([[-.33, 0], [-.6, .2], [-.66, 0], [-.6, -.2]]), A.fin, { op: .6 });
    const bodyPts = A.whale ? [[-.36, 0], [-.2, .08], [.15, h * .55], [.42, h * .4], [.5, 0], [.42, -h * .5], [.1, -h * .6], [-.25, -.05]]
      : A.dolphin ? [[-.36, 0], [-.15, h * .45], [.2, h * .55], [.36, h * .3], [.52, .0], [.38, -h * .2], [.1, -h * .45], [-.2, -h * .3]]
      : A.shark ? [[-.34, 0], [-.1, h * .5], [.2, h * .5], [.46, h * .12], [.48, -h * .05], [.3, -h * .32], [-.05, -h * .45], [-.25, -h * .15]]
      : [[-.32, 0], [-.15, h * .6], [.12, h * .75], [.36, h * .35], [.42, 0], [.34, -h * .35], [.1, -h * .7], [-.16, -h * .5]];
    const bodyD = blob(bodyPts);
    // fins
    const dors = A.shark ? [[-.02, h * .45], [.06, h * 1.35], [.16, h * .5]] : A.dolphin ? [[0, h * .5], [-.02, h * 1.1], [.1, h * .55]] : A.whale ? [[-.2, .07], [-.18, .12], [-.12, .08]] : [[-.15, h * .55], [0, h * 1.05], [.15, h * .7]];
    path(top, blob(dors), A.fin, { stroke: edge(A.fin) });
    const bg = mover(top, 'ld-a-body', 0, 0, -R());
    path(bg, bodyD, col, { stroke: edge(col) });
    const cg = clipTo(bodyD); bg.appendChild(cg);
    path(cg, oval(.05, -h * .55, .45, h * .45), A.col2, { op: .9 });
    if (A.bands) [.25, .02, -.22].forEach((u) => { path(cg, blob([[u - .03, h], [u + .03, h], [u + .045, -h], [u - .015, -h]]), '#f8f6f2', { stroke: '#1e1e1e' }); });
    if (A.armor) path(cg, blob([[.12, h * .9], [.5, h * .2], [.5, -h * .7], [.1, -h * .8], [.05, 0]]), kitDark(col, .15), { stroke: kitDark(col, .4) });
    if (!A.whale && !A.dolphin && !A.shark && !A.armor) for (let k = 0; k < 24; k++) { const u = -.2 + (k % 8) * .055, v = -h * .3 + Math.floor(k / 8) * h * .3; path(cg, `M${P(u, v + .015).map(fx)}q${w * .012},${w * .012} 0,${w * .03}`, 'none', { stroke: edge(col, .25), w: Math.max(.8, w * .004), op: .6 }); }
    if (A.whale) for (let k = 0; k < 7; k++) path(cg, line([[.0 + k * .05, -h * .3], [.08 + k * .05, -h * .58]]), 'none', { stroke: edge(A.col2, .25), w: Math.max(1, w * .006) });
    path(cg, oval(-.02, h * .45, .3, h * .18), lite(col, .5), { op: .35 });
    const pec = A.whale ? [[.2, -h * .4], [.05, -h * 1.1], [.12, -h * .45]] : [[.18, -h * .1], [.05, -h * .6], [.1, -h * .1]];
    path(bg, blob(pec), A.fin, { stroke: edge(A.fin) });
    if (A.shark) for (let k = 0; k < 4; k++) path(bg, line([[.26 + k * .025, h * .2], [.24 + k * .025, -h * .15]]), 'none', { stroke: edge(col, .35), w: Math.max(1, w * .006) });
    else if (!A.whale && !A.dolphin) path(bg, curve([[.26, h * .5], [.22, 0], [.26, -h * .5]]), 'none', { stroke: edge(col, .35), w: Math.max(1, w * .007) });
    eye(bg, A.whale ? .36 : A.dolphin ? .38 : A.shark ? .36 : .32, A.whale ? -h * .1 : h * .15, A.whale ? .01 : .02);
    if (A.whale) path(bg, curve([[.5, -h * .05], [.3, -h * .25], [.1, -h * .2]]), 'none', { stroke: edge(col, .45), w: Math.max(1, w * .007) });
    if (A.armor) for (let k = 0; k < 4; k++) path(bg, blob([[.36 + k * .03, -h * .2], [.38 + k * .03, -h * .38], [.4 + k * .03, -h * .2]]), '#f4efe2', {});
  } else if (A.b === 'octopus') {
    const col = A.col;
    for (let k = 0; k < 8; k++) { const a = -Math.PI * (.08 + k / 7 * .84), g = mover(top, 'ld-a-arm', Math.cos(a) * .08, .3 + Math.sin(a) * .05, -k * .3); const s1 = [Math.cos(a) * .08, .3], e = [Math.cos(a) * .38, .03 + (k % 2) * .05]; path(g, limb([s1, [(s1[0] + e[0]) / 2 + Math.sin(k) * .05, .16], e, [e[0] + (k < 4 ? -.05 : .05), e[1] + .06]], [.07, .05, .025, .01]), k % 2 ? edge(col, .12) : col, { stroke: edge(col) }); for (let j = 1; j < 5; j++) path(g, circ(s1[0] + (e[0] - s1[0]) * j / 5, .3 + (e[1] - .3) * j / 5 - .015, .008), A.col2, {}); }
    const mg = mover(top, 'ld-a-pulse', 0, .32, 0); const mant = blob([[-.13, .32], [-.15, .52], [-.05, .7], [.08, .7], [.17, .52], [.14, .32], [0, .27]]); path(mg, mant, col, { stroke: edge(col) }); path(mg, oval(-.04, .56, .05, .09), lite(col, .5), { op: .4 }); eye(mg, .06, .38, .02);
  } else if (A.b === 'jelly') {
    const col = A.col, g = mover(top, 'ld-a-pulse', 0, .55, 0);
    for (let k = 0; k < 7; k++) { const u = -.13 + k * .045, tg = mover(g, 'ld-a-arm', u, .5, -k * .25); path(tg, curve([[u, .5], [u + .04, .35], [u - .03, .2], [u + .02, .02]]), 'none', { stroke: k % 2 ? A.col2 : col, w: Math.max(1.4, w * .012), op: .85 }); }
    path(g, blob([[-.2, .5], [-.17, .66], [-.06, .74], [.06, .74], [.17, .66], [.2, .5], [.1, .47], [0, .5], [-.1, .47]]), col, { stroke: edge(col, .25), op: .85 });
    path(g, oval(-.05, .64, .08, .04, -15), '#ffffff', { op: .5 });
  } else if (A.b === 'turtle') {
    const col = A.col, sea = !!A.sea; if (!sea) shadow();
    const by = sea ? .14 : .02;
    [[.18, .42], [-.18, -.42]].forEach(([u, d], k) => { const g = mover(top, sea ? 'ld-a-wing' : 'ld-a-leg', u, by + .08, -k * .4); path(g, sea ? blob([[u, by + .08], [u + .12 * (u > 0 ? 1 : -.5), by - .06], [u + .03, by + .02]]) : limb([[u, by + .08], [u + .01, by]], [.07, .065]), col, { stroke: edge(col) }); });
    const shell = blob([[-.3, by + .06], [-.25, by + .2], [-.05, by + .29], [.15, by + .26], [.28, by + .12], [.3, by + .06]]);
    path(top, shell, A.shell, { stroke: edge(A.shell) });
    const sg = clipTo(shell); top.appendChild(sg);
    for (let k = 0; k < 5; k++) path(sg, blob([[-.24 + k * .11, by + .07], [-.22 + k * .11, by + .17], [-.17 + k * .11, by + .21], [-.12 + k * .11, by + .17], [-.13 + k * .11, by + .07]]), kitDark(A.shell, .12), { stroke: kitDark(A.shell, .4) });
    path(sg, oval(-.05, by + .24, .2, .04), lite(A.shell, .5), { op: .35 });
    path(top, oval(0, by + .055, .3, .02), lite(col, .2), { stroke: edge(col) });
    const hg = mover(top, 'ld-a-head', .28, by + .1, 0); path(hg, limb([[.26, by + .1], [.36, by + .13], [.42, by + .13]], [.07, .065, .07]), col, { stroke: edge(col) }); eye(hg, .42, by + .15, .01);
  } else if (A.b === 'crab') {
    const col = A.col; shadow();
    for (let k = 0; k < 4; k++) [-1, 1].forEach((sd) => { const g = mover(top, 'ld-a-leg', sd * .12, .12, -k * .2); path(g, line([[sd * .12, .12], [sd * (.24 + k * .04), .16], [sd * (.3 + k * .04), 0]]), 'none', { stroke: edge(col, .1), w: Math.max(1.6, w * .016) }); });
    path(top, oval(0, .15, .2, .1), col, { stroke: edge(col) }); path(top, oval(-.04, .2, .1, .03), lite(col, .5), { op: .4 });
    [-1, 1].forEach((sd) => { const g = mover(top, 'ld-a-arm', sd * .15, .2, sd * .2); path(g, line([[sd * .15, .2], [sd * .26, .3]]), 'none', { stroke: col, w: Math.max(2, w * .025) }); path(g, blob([[sd * .24, .3], [sd * .3, .38], [sd * .36, .33], [sd * .3, .28]]), col, { stroke: edge(col) }); });
    [-.05, .05].forEach((u) => { path(top, line([[u, .24], [u, .3]]), 'none', { stroke: col, w: Math.max(1.4, w * .01) }); eye(top, u, .31, .012); });
  } else if (A.b === 'croc') { // a crocodile or a lizard, low on its legs
    const col = A.col; shadow(); const lg = A.leg, sm = !!A.small, h = sm ? .07 : .08;
    const tg = mover(top, 'ld-a-tail', -.18, lg + h * .5, -R());
    path(tg, limb([[-.15, lg + h * .5], [-.35, lg + h * .2], [-.5, lg + .01], [-.6, .03]], [h * 1.6, h, h * .4, .01]), col, { stroke: edge(col) });
    [[.14, true], [-.12, true]].forEach(([u], k) => { const g = mover(top, 'ld-a-leg', u + .02, lg + h * .4, -k * .45 - .2); path(g, limb([[u + .02, lg + h * .4], [u + .07, lg * .5], [u + .05, .01]], [h * .7, h * .5, h * .45]), edge(col, .15), { stroke: edge(col) }); });
    const body = blob([[-.18, lg + h * .2], [-.1, lg + h * 1.2], [.15, lg + h * 1.2], [.26, lg + h * .9], [.3 + A.sn, lg + h * .55], [.3 + A.sn, lg + h * .3], [.2, lg], [-.1, lg - .005]]);
    path(top, body, col, { stroke: edge(col) });
    const cg = clipTo(body); top.appendChild(cg); path(cg, oval(.05, lg, .3, h * .5), A.col2, { op: .85 });
    if (!sm) for (let k = 0; k < 10; k++) path(cg, blob([[-.16 + k * .04, lg + h * 1.15], [-.145 + k * .04, lg + h * 1.4], [-.13 + k * .04, lg + h * 1.15]]), edge(col, .2), {});
    if (A.dots) for (let k = 0; k < 20; k++) path(cg, circ(-.15 + R() * .4, lg + h * (.5 + R() * .6), .008), lite(col, .5), {});
    [[.14], [-.12]].forEach(([u], k) => { const g = mover(top, 'ld-a-leg', u, lg + h * .4, -k * .45); path(g, limb([[u, lg + h * .4], [u + .05, lg * .5], [u + .04, .01]], [h * .7, h * .5, h * .45]), col, { stroke: edge(col) }); });
    eye(top, .2, lg + h * 1.05, .013);
    if (!sm) for (let k = 0; k < 7; k++) path(top, blob([[.22 + k * A.sn / 7, lg + h * .42], [.23 + k * A.sn / 7, lg + h * .3], [.24 + k * A.sn / 7, lg + h * .42]]), '#f4efe2', {});
  } else if (A.b === 'snake') {
    const col = A.col; shadow();
    const pts = [], wd = []; for (let k = 0; k <= 20; k++) { const f = k / 20; pts.push([-.48 + f * .86, .05 + Math.sin(f * Math.PI * 2.2) * .07]); wd.push(.02 + Math.sin(Math.min(1, f * 1.4) * Math.PI / 2) * .055 - (f > .93 ? .02 : 0)); }
    const g = mover(top, 'ld-a-snake', -.05, .05, 0);
    const bodyD = limb(pts, wd);
    path(g, bodyD, col, { stroke: edge(col) });
    const cg = clipTo(bodyD); g.appendChild(cg); for (let k = 0; k < 14; k++) { const p = pts[1 + k], q = [p[0], p[1] + .02]; path(cg, circ(q[0], q[1], .022), A.dk, { op: .85 }); }
    path(cg, limb(pts.map(([u, v]) => [u, v - .025]), wd.map((d) => d * .4)), A.col2, { op: .7 });
    const h = pts[20]; path(g, oval(h[0] + .03, h[1] + .005, .05, .032), col, { stroke: edge(col) }); eye(g, h[0] + .045, h[1] + .02, .009);
    path(g, line([[h[0] + .08, h[1]], [h[0] + .12, h[1] - .005], [h[0] + .13, h[1] + .01]]), 'none', { stroke: '#d8262b', w: Math.max(1, w * .006) });
  } else if (A.b === 'frog') {
    const col = A.col; shadow();
    const lg = mover(top, 'ld-a-pulse', -.1, .12, -.3, 'animation-duration:2.4s');
    path(lg, blob([[-.2, .12], [-.3, .02], [-.05, .0], [.02, .06], [-.08, .2]]), edge(col, .12), { stroke: edge(col) });
    const body = blob([[-.25, .14], [-.15, .38], [.08, .45], [.25, .35], [.3, .2], [.2, .1], [-.05, .08]]);
    path(top, body, col, { stroke: edge(col) });
    const cg = clipTo(body); top.appendChild(cg); path(cg, oval(.1, .12, .22, .08), A.col2, { op: .8 }); if (A.spots) for (let k = 0; k < 14; k++) path(cg, circ(-.18 + R() * .42, .15 + R() * .28, .02 + R() * .02), A.dk, {}); path(cg, oval(-.02, .38, .15, .04), '#ffffff', { op: .3 });
    path(top, limb([[.14, .18], [.18, .06], [.24, .01]], [.07, .05, .04]), col, { stroke: edge(col) });
    path(top, blob([[-.18, .15], [-.12, .03], [.05, .0], [-.02, .1]]), col, { stroke: edge(col) });
    [.16, .25].forEach((u, k) => { path(top, circ(u, .42 - k * .02, .045), col, { stroke: edge(col) }); eye(top, u + .01, .425 - k * .02, .025); });
    const th = mover(top, 'ld-a-pulse', .2, .22, 0, 'animation-duration:1.1s'); path(th, oval(.24, .21, .06, .045), A.col2, { op: .9 });
  } else if (A.b === 'butterfly') { // seen from above, wings spread, flapping
    const col = A.col;
    [-1, 1].forEach((sd) => { const g = mover(top, 'ld-a-flap', 0, .4, 0); const fw = blob([[0, .44], [.12 * sd, .7], [.38 * sd, .78], [.42 * sd, .6], [.2 * sd, .42]]), hw = blob([[0, .38], [.18 * sd, .38], [.32 * sd, .25], [.2 * sd, .12], [.06 * sd, .18]]);
      [fw, hw].forEach((d) => { path(g, d, col, { stroke: A.dk, w: Math.max(1.6, w * .016) }); const c = clipTo(d); g.appendChild(c); for (let k = 0; k < 6; k++) path(c, line([[0, .4], [(.1 + k * .07) * sd, k < 3 ? .8 : .1 + k * .02]]), 'none', { stroke: A.dk, w: Math.max(1, w * .007) }); for (let k = 0; k < 10; k++) path(c, circ((.2 + R() * .22) * sd, .14 + R() * .64, .012), '#f6f2ea', { op: (k % 3) ? 0 : .9 }); path(c, d, 'none', { stroke: A.dk, w: Math.max(3, w * .05) }); });
      for (let k = 0; k < 8; k++) path(g, circ((.36 - k * .02) * sd, .72 - k * .03, .008), '#f6f2ea', {}); });
    path(top, oval(0, .42, .025, .2), A.dk, {});
    [-1, 1].forEach((sd) => path(top, curve([[0, .62], [.04 * sd, .74], [.07 * sd, .8]]), 'none', { stroke: A.dk, w: Math.max(1, w * .007) }));
  } else if (A.b === 'bee') {
    const col = A.col;
    [-1, 1].forEach((sd) => { const g = mover(top, 'ld-a-wingf', 0, .3, 0); path(g, oval(-.02 + sd * .02, .42, .12, .07, -30 + sd * 25), '#dceffa', { stroke: '#9ab8c8', op: .7 }); });
    const body = blob([[-.25, .22], [-.15, .33], [.08, .32], [.15, .25], [.08, .16], [-.15, .15]]); path(top, body, col, { stroke: edge(col) });
    const cg = clipTo(body); top.appendChild(cg); [-.18, -.08, .02].forEach((u) => path(cg, blob([[u, .1], [u + .04, .1], [u + .04, .4], [u, .4]]), A.dk, {})); path(cg, oval(-.05, .3, .12, .02), '#ffffff', { op: .4 });
    path(top, circ(.2, .26, .07), A.dk, {}); eye(top, .23, .28, .015, '#2a2a2a');
    path(top, line([[-.28, .24], [-.32, .23]]), 'none', { stroke: A.dk, w: Math.max(1.4, w * .01) });
    [-.08, 0, .08].forEach((u, k) => { const g = mover(top, 'ld-a-leg', u, .16, -k * .3); path(g, line([[u, .16], [u - .02, .06], [u + .02, 0]]), 'none', { stroke: A.dk, w: Math.max(1, w * .008) }); });
    path(top, curve([[.24, .32], [.28, .42], [.33, .46]]), 'none', { stroke: A.dk, w: Math.max(1, w * .007) });
  } else if (A.b === 'beetle' || A.b === 'ant' || A.b === 'spider') {
    const col = A.col; shadow();
    const legs = A.b === 'spider' ? 4 : 3;
    for (let k = 0; k < legs; k++) [0, 1].forEach((far) => { const u = -.08 + k * (A.b === 'spider' ? .06 : .1), g = mover(top, 'ld-a-leg', u, .14, -(k + far) * .3); path(g, line([[u, .14], [u + (k - 1) * .08 + (far ? .02 : 0), A.b === 'spider' ? .3 : .2], [u + (k - 1) * .14 + (far ? .03 : 0), 0]]), 'none', { stroke: A.b === 'beetle' ? (far ? edge(A.dk, .1) : A.dk) : far ? edge(col, .2) : col, w: Math.max(1.4, w * .012) }); });
    if (A.b === 'ant') { [[-.2, .15, .1, .08], [0, .16, .06, .045], [.14, .18, .06, .055]].forEach(([u, v, rx, ry]) => path(top, oval(u, v, rx, ry), col, { stroke: edge(col) })); eye(top, .17, .2, .012); path(top, curve([[.17, .22], [.24, .3], [.3, .28]]), 'none', { stroke: col, w: Math.max(1.2, w * .008) }); }
    else if (A.b === 'spider') { path(top, oval(-.12, .2, .16, .12), col, { stroke: edge(col) }); path(top, oval(.08, .17, .09, .07), col, { stroke: edge(col) }); path(top, oval(-.15, .26, .07, .03), lite(col, .5), { op: .3 }); [.12, .15].forEach((u) => eye(top, u, .2, .01)); }
    else { const sh = blob([[-.25, .1], [-.22, .28], [-.02, .32], [.12, .26], [.14, .12], [0, .08]]); path(top, sh, col, { stroke: edge(col) }); const cg = clipTo(sh); top.appendChild(cg); if (A.spots) for (let k = 0; k < 6; k++) path(cg, circ(-.18 + k * .055, .17 + (k % 2) * .07, .028), A.dk, {}); path(cg, line([[-.24, .2], [.12, .2]]), 'none', { stroke: A.dk, w: Math.max(1, w * .008) }); path(cg, oval(-.08, .28, .12, .025), '#ffffff', { op: .4 }); path(top, oval(.19, .15, .07, .06), A.dk, { stroke: edge(A.dk) }); eye(top, .22, .17, .01, '#f6f2ea'); if (A.horn) { path(top, limb([[.22, .17], [.36, .2], [.46, .27]], [.04, .025, .01]), A.dk, {}); path(top, limb([[.1, .3], [.28, .36], [.44, .31]], [.05, .03, .012]), A.dk, {}); } else [-1, 1].forEach((k) => path(top, line([[.22, .19], [.27, .25 + k * .01], [.3, .26 + k * .02]]), 'none', { stroke: A.dk, w: Math.max(1, w * .007) })); }
  }
  return root;
}

function shape2d(s, p) {
  const t = String(s.t || s.type || '').toLowerCase();
  const n = (k, d = 0) => num(s[k], -50, 450, d);
  const mk = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
  const paint = (e) => {
    const fill = s.fill === true ? p.color : typeof s.fill === 'string' && /^#[0-9a-f]{3,8}$/i.test(s.fill) ? s.fill : null;
    e.setAttribute('fill', fill || 'none'); if (fill) e.setAttribute('fill-opacity', s.solid ? '.92' : '.18'); // (v315: solid, for a creature drawn like an illustration)
    e.setAttribute('stroke', typeof s.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(s.color) ? color(s.color, 0) : 'currentColor');
    e.setAttribute('stroke-width', num(s.w, 1, 6, 2)); e.setAttribute('stroke-linecap', 'round'); e.setAttribute('stroke-linejoin', 'round');
    if (s.dash) e.setAttribute('stroke-dasharray', '6 6');
    return e;
  };
  if (t === 'path' && typeof s.d === 'string' && PATH_OK.test(s.d)) return paint(mk('path', { d: s.d }));
  if (t === 'line') return paint(mk('line', { x1: n('x1'), y1: n('y1'), x2: n('x2'), y2: n('y2') }));
  if (t === 'arrow') { const e = paint(mk('line', { x1: n('x1'), y1: n('y1'), x2: n('x2'), y2: n('y2') })); e.setAttribute('marker-end', 'url(#ld-head)'); return e; }
  if (t === 'rect') return paint(mk('rect', { x: n('x'), y: n('y'), width: num(s.w2 ?? s.width ?? s.wd, 1, 400, 40), height: num(s.h, 1, 260, 30), rx: num(s.r, 0, 60, 2) }));
  if (t === 'circle') return paint(mk('circle', { cx: n('cx', 200), cy: n('cy', 130), r: num(s.r, 1, 200, 20) }));
  if (t === 'ellipse') return paint(mk('ellipse', { cx: n('cx', 200), cy: n('cy', 130), rx: num(s.rx, 1, 200, 30), ry: num(s.ry, 1, 200, 20) }));
  if (t === 'poly' && Array.isArray(s.pts)) { const pts = s.pts.slice(0, 60).map((q) => `${num(q && q[0], -50, 450)},${num(q && q[1], -50, 450)}`).join(' '); return paint(mk('polyline', { points: pts })); }
  if (t === 'text') { const e = mk('text', { x: n('x'), y: n('y'), class: 'ld-word', 'font-size': num(s.size, 8, 22, 12) }); e.textContent = words(s.text ?? s.s, 60); return e; }
  if (t === 'animal') return animalShape(s, mk); // (v327) an animal, whole and moving
  if (t === 'appliance') return applianceShape(s, mk); // (v328) a home appliance, its working parts moving
  if (t === 'food') return foodShape(s, mk); // (v329) a fruit, a vegetable or a dish, whole or cut open
  if (KIT.includes(t)) return kitShape(s, mk); // (v324) a tree, a flower, a cloud...: drawn whole, in the guide's style
  return null;
}

// ---------- (v328) the appliance kit: home appliances, drawn whole from the front, the side or open, their working parts moving ----------
// {"t":"appliance","kind":"washer","x":200,"y":230,"h":160,"view":"front|side|open"}: x its middle, y the floor under it, h its height
// (or w its width). Each one's real size (metres: width W, height H, depth D) keeps them in proportion with each other.
const APPL = {
  fridge: { W: 0.9, H: 1.78, D: 0.75, col: '#c6cacf' }, washer: { W: 0.6, H: 0.85, D: 0.6, col: '#c6cacf' }, microwave: { W: 0.5, H: 0.3, D: 0.38, col: '#c6cacf' },
  blender: { W: 0.18, H: 0.43, D: 0.18, col: '#bdc1c6' }, toaster: { W: 0.3, H: 0.2, D: 0.18, col: '#cfd3d8' }, coffeemaker: { W: 0.22, H: 0.36, D: 0.26, col: '#c6cacf' },
  vacuum: { W: 0.3, H: 1.1, D: 0.32, col: '#bdc1c6' }, aircon: { W: 0.45, H: 0.75, D: 0.38, col: '#d8dbdf' }, fan: { W: 0.46, H: 1.25, D: 0.4, col: '#eef1f4' },
  ricecooker: { W: 0.3, H: 0.27, D: 0.3, col: '#f3f3f1' },
};
const APPL_KINDS = Object.keys(APPL);
const APPL_OPEN = { fridge: [-0.73, 0.73], washer: [-0.52, 0.3], microwave: [-0.48, 0.25] }; // (opened: its door swung out, in metres from its middle)
function applSize(sh) {
  const A = APPL[String(sh.kind || '').toLowerCase()] || APPL.fridge, view = sh.view === 'side' ? 'side' : sh.view === 'open' ? 'open' : 'front';
  const wide = view === 'side' ? A.D : A.W, h = +sh.h > 0 ? +sh.h : +sh.w > 0 ? +sh.w * A.H / wide : 160;
  return { A, view, k: Math.max(8, Math.min(260, h)) / A.H };
}
function applBox(sh) {
  const { A, view, k } = applSize(sh), x = +sh.x, y = +sh.y, kind = String(sh.kind || '').toLowerCase();
  let [u0, u1] = view === 'side' ? [-A.D / 2, A.D / 2] : [-A.W / 2, A.W / 2];
  if (view === 'open' && APPL_OPEN[kind]) [u0, u1] = APPL_OPEN[kind];
  if (kind === 'vacuum' && view === 'side') [u0, u1] = [-0.2, 0.2];
  const top = A.H + (kind === 'ricecooker' ? 0.08 : kind === 'coffeemaker' && view === 'open' ? 0.12 : 0);
  return [[x + u0 * k, y - top * k], [x + u1 * k, y]];
}
let applN = 0;
function applianceShape(s, mk) {
  const kind = APPL[String(s.kind || '').toLowerCase()] ? String(s.kind).toLowerCase() : 'fridge', A = APPL[kind];
  const N = (v, lo, hi, d) => { v = +v; return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; };
  const x = N(s.x ?? s.cx, -40, 440, 200), y = N(s.y ?? s.cy, -40, 300, 220), { view, k } = applSize(s), moving = !s.still, id = `ldap${++applN}`;
  const root = mk('g', { class: 'ld-kit ld-appliance' });
  const top = mk('g', s.facing === 'left' ? { transform: `translate(${2 * x},0) scale(-1,1)` } : {}); root.appendChild(top);
  const fx = (n) => n.toFixed(1), P = (u, v) => [x + u * k, y - v * k];
  const sw = Math.max(0.8, k * 0.006);
  const path = (parent, d, fill, o = {}) => { const e = mk('path', { d, fill: fill || 'none', stroke: o.stroke || 'none', 'stroke-width': o.w || sw, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }); if (o.op != null) e.setAttribute(fill && fill !== 'none' ? 'fill-opacity' : 'stroke-opacity', o.op); if (o.style) e.setAttribute('style', o.style); parent.appendChild(e); return e; };
  const rr = (u0, v0, u1, v1, r = 0.01) => { const [xa, yb] = P(Math.min(u0, u1), Math.min(v0, v1)), [xb, ya] = P(Math.max(u0, u1), Math.max(v0, v1)), q = Math.min(r * k, (xb - xa) / 2, (yb - ya) / 2);
    return `M${fx(xa + q)},${fx(ya)}L${fx(xb - q)},${fx(ya)}Q${fx(xb)},${fx(ya)} ${fx(xb)},${fx(ya + q)}L${fx(xb)},${fx(yb - q)}Q${fx(xb)},${fx(yb)} ${fx(xb - q)},${fx(yb)}L${fx(xa + q)},${fx(yb)}Q${fx(xa)},${fx(yb)} ${fx(xa)},${fx(yb - q)}L${fx(xa)},${fx(ya + q)}Q${fx(xa)},${fx(ya)} ${fx(xa + q)},${fx(ya)}Z`; };
  const circ = (u, v, r) => kc(...P(u, v), r * k), oval = (u, v, rx, ry, rot = 0) => ke(...P(u, v), rx * k, ry * k, rot);
  const poly = (pts) => 'M' + pts.map(([u, v]) => P(u, v).map(fx).join(',')).join('L') + 'Z';
  const soft = (pts) => ksmooth(pts.map(([u, v]) => P(u, v)));
  const line = (pts) => 'M' + pts.map(([u, v]) => P(u, v).map(fx).join(',')).join('L');
  const edge = (c, q = 0.42) => kitDark(c, q), lite = (c, q = 0.45) => kitLight(c, q);
  const col = typeof s.fill === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(s.fill) ? s.fill : A.col;
  const dark = '#2b2f36', glassC = '#2a3440', black = '#33363b';
  // a moving part: its own group, turning (or moving) about a point
  const mover = (parent, cls, u, v, extra = '') => { const [ox, oy] = P(u, v); const g = mk('g', moving ? { class: `ld-anim ${cls}`, style: `transform-origin:${fx(ox)}px ${fx(oy)}px;${extra}` } : {}); parent.appendChild(g); return g; };
  // a brushed steel panel: its outline, a soft light band on the left, a shadow down the right, a bright top edge
  const panel = (g, u0, v0, u1, v1, r = 0.012, c = col) => {
    path(g, rr(u0, v0, u1, v1, r), c, { stroke: edge(c, 0.38) });
    const wd = u1 - u0, ht = v1 - v0;
    path(g, rr(u0 + wd * 0.06, v0 + ht * 0.02, u0 + wd * 0.3, v1 - ht * 0.02, r * 0.6), lite(c, 0.5), { op: 0.45 });
    path(g, rr(u1 - wd * 0.12, v0 + ht * 0.01, u1 - wd * 0.015, v1 - ht * 0.01, r * 0.5), edge(c, 0.18), { op: 0.45 });
    path(g, line([[u0 + r, v1 - ht * 0.012], [u1 - r, v1 - ht * 0.012]]), 'none', { stroke: lite(c, 0.7), w: sw * 1.2, op: 0.8 });
  };
  const bar = (g, u0, v0, u1, v1, c = '#d9dde2') => { path(g, rr(u0, v0, u1, v1, Math.min(Math.abs(u1 - u0), Math.abs(v1 - v0)) / 2), c, { stroke: edge(c, 0.45) }); path(g, rr(u0 + (u1 - u0) * 0.15, v0 + (v1 - v0) * 0.1, u0 + (u1 - u0) * 0.45, v1 - (v1 - v0) * 0.1, 0.004), lite(c, 0.7), { op: 0.7 }); };
  const feet = (g, us, h = 0.025, wd = 0.03) => us.forEach((u) => path(g, rr(u - wd / 2, 0, u + wd / 2, h + 0.004, 0.006), '#4a4e55', { stroke: '#2b2e33' }));
  const shadow = (u0, u1) => path(top, oval((u0 + u1) / 2, 0, (u1 - u0) * 0.56, Math.max(0.012, (u1 - u0) * 0.04)), '#000000', { op: 0.16 });
  const dots = (g, u0, v0, u1, v1, n, m, r, c, op = 0.5) => { let d = ''; for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) d += circ(u0 + (u1 - u0) * (i + 0.5) / n, v0 + (v1 - v0) * (j + 0.5) / m, r); path(g, d, c, { op }); };
  const drop = (g, u, v, fall, delay, c = '#6b4226') => { const e = path(mover(g, 'ld-a-drip', u, v, `--drop:${fx(fall * k)}px;animation-delay:${delay}s`), soft([[u, v + 0.006], [u + 0.004, v - 0.002], [u, v - 0.007], [u - 0.004, v - 0.002]]), c); return e; };
  const steam = (g, u, v, rise, delay) => path(mover(g, 'ld-a-steam', u, v, `--rise:${fx(-rise * k)}px;animation-delay:${delay}s`), circ(u, v, rise * 0.18), '#ffffff', { op: 0.8, stroke: '#d5dbe2' });
  const air = (g, pts, c = '#7cc4f0', delay = 0) => path(g, soft(pts).replace(/Z$/, ''), 'none', { stroke: c, w: sw * 2, op: 0.85, style: moving ? `stroke-dasharray:6 7;animation:ldFlow 1.1s linear infinite;animation-delay:${delay}s` : '' });
  const g = mk('g', {}); top.appendChild(g);

  if (kind === 'fridge') {
    shadow(-0.48, 0.48);
    if (view === 'side') {
      feet(g, [-0.3, 0.3]); panel(g, -0.375, 0.03, 0.375, 1.78, 0.02);
      path(g, rr(0.33, 0.04, 0.375, 1.77, 0.01), edge(col, 0.12), { stroke: edge(col, 0.4) }); path(g, line([[0.33, 0.61], [0.375, 0.61]]), 'none', { stroke: edge(col, 0.5), w: sw });
      path(g, soft([[0.375, 0.78], [0.41, 0.82], [0.425, 1.15], [0.41, 1.5], [0.375, 1.54], [0.395, 1.5], [0.405, 1.15], [0.395, 0.82]]), '#d9dde2', { stroke: edge('#d9dde2', 0.45) });
      bar(g, 0.375, 0.47, 0.41, 0.52);
      dots(g, -0.36, 0.06, -0.3, 0.2, 2, 6, 0.006, dark, 0.6); // (the vents for the compressor at the back)
    } else if (view === 'open') {
      feet(g, [-0.38, 0.38]);
      panel(g, -0.45, 0.03, 0.45, 0.62, 0.015); bar(g, -0.3, 0.47, 0.3, 0.52);
      path(g, rr(-0.45, 0.62, 0.45, 1.78, 0.015), '#e9edf1', { stroke: edge(col, 0.4) });
      path(g, rr(-0.42, 0.64, 0.42, 1.75, 0.01), '#f6f8fa', { stroke: '#cfd6dd' });
      path(g, poly([[-0.42, 1.75], [-0.33, 1.68], [0.33, 1.68], [0.42, 1.75]]), '#e3e8ee'); path(g, poly([[-0.42, 0.64], [-0.33, 0.7], [-0.33, 1.68], [-0.42, 1.75]]), '#e7ecf1'); path(g, poly([[0.42, 0.64], [0.33, 0.7], [0.33, 1.68], [0.42, 1.75]]), '#dde3e9');
      [0.98, 1.22, 1.46].forEach((v) => { path(g, poly([[-0.4, v], [0.4, v], [0.33, v + 0.025], [-0.33, v + 0.025]]), '#cfe6f3', { stroke: '#a9c6d8', op: 0.85 }); });
      [-0.2, 0.2].forEach((u) => { path(g, rr(u - 0.19, 0.67, u + 0.19, 0.9, 0.012), '#eaf3f8', { stroke: '#b9cbd8' }); path(g, rr(u - 0.08, 0.83, u + 0.08, 0.87, 0.01), '#d4e1ea'); });
      path(g, mover(g, 'ld-a-glow', 0, 1.7), oval(0, 1.705, 0.09, 0.018), '#fff6c8', { stroke: '#f0dc8a' });
      [-1, 1].forEach((sd) => { // the doors, swung wide, their bins on the inside
        const a = sd * 0.45, b = sd * 0.73;
        path(g, poly([[a, 0.62], [b, 0.6], [b, 1.8], [a, 1.78]]), '#dfe4ea', { stroke: edge(col, 0.4) });
        path(g, poly([[b, 0.6], [b + sd * 0.025, 0.605], [b + sd * 0.025, 1.795], [b, 1.8]]), col, { stroke: edge(col, 0.4) });
        [0.8, 1.1, 1.4].forEach((v) => path(g, poly([[a + sd * 0.02, v], [b - sd * 0.02, v - 0.01], [b - sd * 0.02, v + 0.09], [a + sd * 0.02, v + 0.08]]), '#e8f2f8', { stroke: '#a9c3d4', op: 0.9 }));
      });
    } else {
      feet(g, [-0.38, 0.38]);
      panel(g, -0.45, 0.03, 0.45, 0.61, 0.015); panel(g, -0.45, 0.62, -0.003, 1.78, 0.015); panel(g, 0.003, 0.62, 0.45, 1.78, 0.015);
      bar(g, -0.3, 0.47, 0.3, 0.52); bar(g, -0.055, 0.78, -0.025, 1.55); bar(g, 0.025, 0.78, 0.055, 1.55);
      path(g, rr(-0.37, 1.02, -0.13, 1.42, 0.02), '#3d434b', { stroke: '#22262b' }); path(g, rr(-0.34, 1.05, -0.16, 1.3, 0.015), '#262a30');
      path(g, rr(-0.35, 1.33, -0.15, 1.39, 0.008), '#18202b'); dots(g, -0.34, 1.34, -0.16, 1.38, 5, 1, 0.006, '#64d0f5', 0.9);
      path(g, rr(-0.29, 1.12, -0.21, 1.25, 0.01), '#4b525b'); path(g, rr(0.3, 1.7, 0.4, 1.73, 0.005), lite(col, 0.6));
    }
  } else if (kind === 'washer') {
    shadow(-0.32, 0.32);
    if (view === 'side') {
      feet(g, [-0.25, 0.25]); panel(g, -0.3, 0.025, 0.3, 0.85, 0.015);
      [[-0.22, -0.04], [0.02, 0.2]].forEach(([u0, u1]) => { path(g, rr(u0, 0.09, u1, 0.7, 0.03), edge(col, 0.1), { stroke: edge(col, 0.3) }); path(g, rr(u0 + 0.02, 0.12, u0 + 0.05, 0.67, 0.012), lite(col, 0.5), { op: 0.6 }); });
      path(g, soft([[0.3, 0.2], [0.33, 0.25], [0.335, 0.4], [0.33, 0.55], [0.3, 0.6]]), '#d9dde2', { stroke: edge('#d9dde2', 0.45) });
      [0.79, 0.74].forEach((v) => path(g, rr(-0.33, v - 0.012, -0.3, v + 0.012, 0.006), '#9aa1a9', { stroke: '#6b7178' })); // (the water hose and drain nozzles at the back)
    } else {
      feet(g, [-0.25, 0.25]); panel(g, -0.3, 0.025, 0.3, 0.85, 0.015);
      path(g, line([[-0.3, 0.72], [0.3, 0.72]]), 'none', { stroke: edge(col, 0.35), w: sw });
      path(g, rr(-0.27, 0.745, -0.1, 0.81, 0.008), lite(col, 0.25), { stroke: edge(col, 0.4) }); path(g, rr(-0.22, 0.765, -0.15, 0.78, 0.005), edge(col, 0.35));
      path(g, circ(-0.035, 0.778, 0.032), '#dfe3e8', { stroke: edge(col, 0.5) }); path(g, line([[-0.035, 0.778], [-0.035, 0.802]]), 'none', { stroke: '#6b7178', w: sw * 1.3 });
      path(g, rr(0.04, 0.752, 0.25, 0.805, 0.008), '#1a1e24'); path(g, rr(0.06, 0.765, 0.16, 0.795, 0.004), '#ff9a3c', { op: 0.85 }); dots(g, 0.18, 0.76, 0.24, 0.8, 2, 2, 0.007, '#8fd0ff', 0.9);
      path(g, rr(0.17, 0.05, 0.27, 0.13, 0.008), lite(col, 0.15), { stroke: edge(col, 0.35) });
      const cu = view === 'open' ? 0 : 0, cv = 0.4;
      path(g, circ(cu, cv, 0.215), '#e2e6ea', { stroke: edge(col, 0.5) }); path(g, circ(cu, cv, 0.18), '#3b4048', { stroke: '#22262b' });
      const drum = mover(g, 'ld-a-spin', cu, cv);
      path(drum, circ(cu, cv, 0.16), '#9aa1aa', { stroke: '#6d737b' });
      let holes = ''; for (let r = 0.05; r < 0.155; r += 0.022) for (let a = 0; a < 6.28; a += 0.16 / (r * 12)) holes += circ(cu + Math.cos(a) * r, cv + Math.sin(a) * r, 0.0035); path(drum, holes, '#5d636b', { op: 0.6 });
      [0, 2.094, 4.189].forEach((a) => path(drum, poly([[cu + Math.cos(a - 0.12) * 0.155, cv + Math.sin(a - 0.12) * 0.155], [cu + Math.cos(a) * 0.035, cv + Math.sin(a) * 0.035], [cu + Math.cos(a + 0.12) * 0.155, cv + Math.sin(a + 0.12) * 0.155]]), '#c3c8ce', { stroke: '#7d838b' }));
      path(drum, circ(cu, cv, 0.03), '#c3c8ce', { stroke: '#7d838b' });
      path(drum, soft([[cu - 0.09, cv - 0.07], [cu - 0.02, cv - 0.12], [cu + 0.06, cv - 0.1], [cu + 0.02, cv - 0.06]]), '#5b8fd6', { op: 0.9, stroke: '#3c6fb8' }); // (the clothes, tumbling)
      path(drum, soft([[cu + 0.04, cv + 0.05], [cu + 0.11, cv + 0.02], [cu + 0.12, cv + 0.08], [cu + 0.07, cv + 0.1]]), '#e85d75', { op: 0.9, stroke: '#c03c55' });
      if (view === 'open') { // the round door, swung open on its hinge at the left
        path(g, oval(-0.42, cv, 0.085, 0.215), '#e2e6ea', { stroke: edge(col, 0.5) }); path(g, oval(-0.42, cv, 0.06, 0.16), '#7f99ad', { op: 0.55, stroke: '#5b6f80' });
        path(g, rr(-0.34, cv - 0.04, -0.21, cv + 0.04, 0.01), '#cfd4da', { stroke: edge(col, 0.4) });
      } else {
        path(g, circ(cu, cv, 0.165), '#7f99ad', { op: 0.32 }); path(g, soft([[cu - 0.12, cv + 0.06], [cu - 0.06, cv + 0.13], [cu, cv + 0.145], [cu - 0.07, cv + 0.11]]), '#ffffff', { op: 0.45 });
        path(g, rr(0.19, cv - 0.04, 0.23, cv + 0.04, 0.01), '#cfd4da', { stroke: edge(col, 0.4) });
      }
    }
  } else if (kind === 'microwave') {
    shadow(-0.26, 0.26);
    if (view === 'side') {
      feet(g, [-0.15, 0.15], 0.012, 0.025); panel(g, -0.19, 0.012, 0.19, 0.3, 0.012);
      for (let i = 0; i < 6; i++) path(g, rr(-0.16 + i * 0.022, 0.05, -0.152 + i * 0.022, 0.12, 0.003), dark, { op: 0.7 });
      path(g, rr(0.17, 0.015, 0.19, 0.297, 0.004), edge(col, 0.15));
    } else {
      feet(g, [-0.2, 0.2], 0.012, 0.03); panel(g, -0.25, 0.012, 0.25, 0.3, 0.012);
      path(g, rr(0.12, 0.03, 0.235, 0.285, 0.008), edge(col, 0.06), { stroke: edge(col, 0.35) });
      path(g, rr(0.14, 0.235, 0.215, 0.27, 0.006), '#11161c'); path(g, rr(0.15, 0.243, 0.205, 0.262, 0.003), '#7cf08c', { op: 0.85 });
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) path(g, rr(0.145 + i * 0.024, 0.15 + j * 0.024, 0.162 + i * 0.024, 0.163 + j * 0.024, 0.004), '#dfe3e8', { stroke: edge(col, 0.4) });
      path(g, circ(0.178, 0.085, 0.032), '#d9dde2', { stroke: edge(col, 0.5) }); path(g, line([[0.178, 0.085], [0.178, 0.11]]), 'none', { stroke: '#6b7178', w: sw * 1.3 });
      const cav = (g2) => { // inside: warm light, the glass turntable and a bowl on it
        path(g2, rr(-0.215, 0.035, 0.09, 0.275, 0.006), '#e8c993'); path(g2, poly([[-0.215, 0.035], [-0.18, 0.07], [0.055, 0.07], [0.09, 0.035]]), '#d9b47a');
        path(g2, poly([[-0.215, 0.275], [-0.18, 0.24], [0.055, 0.24], [0.09, 0.275]]), '#f3dcb0');
        path(g2, oval(-0.063, 0.075, 0.11, 0.022), '#f2f6f8', { op: 0.7, stroke: '#c9d3da' });
        const plate = mover(g2, 'ld-a-turn', -0.063, 0.075); path(plate, rr(-0.11, 0.08, -0.02, 0.13, 0.03), '#e85d4a', { stroke: '#b8412f' }); path(plate, oval(-0.065, 0.13, 0.045, 0.01), '#f6a64a');
        path(mover(g2, 'ld-a-glow', -0.06, 0.15), rr(-0.215, 0.035, 0.09, 0.275, 0.006), '#ffd884', { op: 0.35 });
      };
      if (view === 'open') {
        path(g, rr(-0.235, 0.02, 0.105, 0.29, 0.006), '#4d535b'); cav(g);
        path(g, poly([[-0.25, 0.012], [-0.48, -0.005], [-0.48, 0.317], [-0.25, 0.3]]), col, { stroke: edge(col, 0.4) });
        path(g, poly([[-0.29, 0.04], [-0.44, 0.03], [-0.44, 0.29], [-0.29, 0.28]]), glassC, { op: 0.85 }); path(g, rr(-0.475, 0.08, -0.46, 0.24, 0.006), '#d9dde2');
      } else {
        path(g, rr(-0.235, 0.025, 0.105, 0.287, 0.01), '#4a5058', { stroke: edge(col, 0.5) }); cav(g);
        path(g, rr(-0.225, 0.03, 0.095, 0.28, 0.008), glassC, { op: 0.7 }); dots(g, -0.215, 0.04, 0.085, 0.27, 26, 20, 0.0022, '#0d1116', 0.3);
        bar(g, 0.098, 0.06, 0.112, 0.255);
        path(g, soft([[-0.2, 0.25], [-0.12, 0.27], [-0.05, 0.27], [-0.15, 0.255]]), '#ffffff', { op: 0.25 });
      }
    }
  } else if (kind === 'blender') {
    shadow(-0.1, 0.1);
    path(g, soft([[-0.088, 0.005], [0.088, 0.005], [0.074, 0.08], [0.066, 0.132], [-0.066, 0.132], [-0.074, 0.08]]), col, { stroke: edge(col, 0.4) });
    path(g, soft([[-0.07, 0.012], [-0.04, 0.012], [-0.04, 0.12], [-0.06, 0.12]]), lite(col, 0.5), { op: 0.5 }); path(g, rr(-0.09, 0, 0.09, 0.012, 0.004), '#2b2e33');
    if (view !== 'side') { path(g, circ(0, 0.075, 0.026), '#d4d8dd', { stroke: edge(col, 0.5) }); path(g, line([[0, 0.075], [0, 0.095]]), 'none', { stroke: '#6b7178', w: sw * 1.3 }); [-0.04, -0.02, 0, 0.02, 0.04].forEach((u) => path(g, circ(u, 0.03, 0.007), '#e3e7eb', { stroke: edge(col, 0.5) })); }
    else path(g, circ(0.072, 0.075, 0.012), '#d4d8dd', { stroke: edge(col, 0.5) });
    path(g, rr(-0.058, 0.13, 0.058, 0.158, 0.006), '#d4d8dd', { stroke: edge(col, 0.45) });
    const jar = [[-0.05, 0.158], [0.05, 0.158], [0.076, 0.39], [-0.076, 0.39]];
    path(g, poly(jar), '#f0c35a', { op: 0.55 }); // (a smoothie, blending)
    path(g, poly([[-0.064, 0.3], [0.064, 0.3], [0.076, 0.39], [-0.076, 0.39]]), '#ffffff', { op: 0.6 });
    path(g, soft([[0.07, 0.36], [0.115, 0.355], [0.115, 0.22], [0.062, 0.2], [0.064, 0.225], [0.098, 0.235], [0.098, 0.34], [0.072, 0.345]]), '#e7eef3', { op: 0.75, stroke: '#9fb2c0' });
    const bl = mover(g, 'ld-a-flapf', 0, 0.175); path(bl, line([[-0.04, 0.19], [0.04, 0.16]]), 'none', { stroke: '#8d949c', w: sw * 2.2 }); path(bl, line([[-0.04, 0.16], [0.04, 0.19]]), 'none', { stroke: '#aab0b7', w: sw * 2.2 });
    path(g, circ(0, 0.172, 0.008), '#6b7178');
    path(g, poly(jar), '#dde9f1', { op: 0.28, stroke: '#94a7b6' });
    [[-0.035, 0.17, -0.05, 0.38], [0.035, 0.17, 0.05, 0.38]].forEach(([a, b, c2, d]) => path(g, line([[a, b], [c2, d]]), 'none', { stroke: '#ffffff', w: sw * 1.6, op: 0.6 }));
    path(g, rr(-0.082, 0.388, 0.082, 0.413, 0.008), '#2a2c30'); path(g, rr(-0.026, 0.41, 0.026, 0.43, 0.005), '#cfd8de', { stroke: '#8d99a3' });
  } else if (kind === 'toaster') {
    shadow(-0.16, 0.16);
    if (view === 'side') {
      path(g, rr(-0.095, 0, 0.095, 0.025, 0.006), '#3a3d42'); path(g, rr(-0.09, 0.02, 0.09, 0.195, 0.04), col, { stroke: edge(col, 0.4) });
      path(g, rr(-0.06, 0.03, -0.035, 0.18, 0.005), lite(col, 0.5), { op: 0.5 }); path(g, rr(-0.004, 0.06, 0.004, 0.17, 0.003), '#22252a');
      path(g, rr(-0.025, 0.105, 0.025, 0.125, 0.006), '#2b2e33'); path(g, circ(-0.045, 0.05, 0.013), '#dfe3e8', { stroke: edge(col, 0.5) });
      [-0.02, 0, 0.02].forEach((u) => path(g, circ(u + 0.04, 0.045, 0.006), '#e8ecef', { stroke: edge(col, 0.5) }));
    } else if (view === 'open') { // from above: the two slots, their wires glowing red hot
      path(g, rr(-0.15, 0.0, 0.15, 0.18, 0.035), col, { stroke: edge(col, 0.4) });
      [0.055, 0.125].forEach((v) => { path(g, rr(-0.12, v - 0.022, 0.12, v + 0.022, 0.012), '#2a2c30'); const hot = mover(g, 'ld-a-glow', 0, v); path(hot, line(Array.from({ length: 21 }, (_, i) => [-0.11 + i * 0.011, v + (i % 2 ? 0.012 : -0.012)])), 'none', { stroke: '#ff6a2a', w: sw * 1.4 }); path(g, rr(-0.1, v - 0.01, 0.1, v + 0.01, 0.006), '#d9a35c', { op: 0.9 }); });
    } else {
      path(g, rr(-0.155, 0, 0.155, 0.028, 0.008), '#3a3d42');
      [-0.07, 0.07].forEach((u) => { path(g, soft([[u - 0.055, 0.17], [u - 0.058, 0.215], [u, 0.232], [u + 0.058, 0.215], [u + 0.055, 0.17]]), '#e3b471', { stroke: '#a8743a' }); path(g, soft([[u - 0.045, 0.2], [u, 0.215], [u + 0.045, 0.2], [u, 0.205]]), '#c98a45', { op: 0.6 }); });
      path(g, rr(-0.15, 0.025, 0.15, 0.2, 0.05), col, { stroke: edge(col, 0.4) });
      path(g, rr(-0.13, 0.04, -0.07, 0.185, 0.02), lite(col, 0.6), { op: 0.5 }); path(g, rr(0.11, 0.035, 0.14, 0.185, 0.02), edge(col, 0.18), { op: 0.5 });
      path(g, rr(0.15, 0.1, 0.19, 0.125, 0.006), '#2b2e33'); path(g, circ(0.162, 0.055, 0.012), '#dfe3e8', { stroke: edge(col, 0.5) });
    }
  } else if (kind === 'coffeemaker') {
    shadow(-0.12, 0.12);
    path(g, rr(-0.11, 0, 0.11, 0.03, 0.008), col, { stroke: edge(col, 0.4) }); path(g, rr(-0.095, 0.028, 0.06, 0.036, 0.003), '#1d1f23');
    if (view === 'side') {
      panel(g, -0.13, 0.03, -0.02, 0.36, 0.01); path(g, rr(-0.13, 0.215, 0.12, 0.34, 0.012), col, { stroke: edge(col, 0.4) }); path(g, rr(-0.135, 0.335, 0.125, 0.36, 0.008), '#2a2c30');
      path(g, rr(-0.09, 0.1, -0.07, 0.3, 0.008), '#a9d6f2', { stroke: '#6e8a9c', op: 0.9 }); path(g, rr(-0.09, 0.1, -0.07, 0.2, 0.008), '#4a9fe0', { op: 0.7 });
      path(g, soft([[-0.015, 0.045], [0.1, 0.045], [0.105, 0.095], [-0.02, 0.095]]), '#5b3521', { op: 0.92 }); path(g, soft([[-0.02, 0.04], [0.1, 0.04], [0.115, 0.1], [0.095, 0.17], [0.0, 0.18], [-0.025, 0.1]]), '#e3edf3', { op: 0.32, stroke: '#8fa3b2' }); path(g, rr(-0.01, 0.175, 0.1, 0.19, 0.006), '#2a2c30');
    } else {
      panel(g, -0.11, 0.21, 0.11, 0.335, 0.012); path(g, rr(-0.112, 0.333, 0.112, 0.36, 0.008), '#2a2c30');
      path(g, rr(-0.11, 0.03, -0.085, 0.215, 0.004), '#2a2c30'); path(g, rr(0.085, 0.03, 0.11, 0.215, 0.004), '#2a2c30'); path(g, rr(-0.085, 0.19, 0.085, 0.215, 0.004), '#2a2c30');
      path(g, circ(-0.07, 0.3, 0.008), '#5b6068');
      if (view === 'open') { path(g, rr(-0.105, 0.36, 0.105, 0.37, 0.004), '#2a2c30'); path(g, poly([[-0.06, 0.335], [0.06, 0.335], [0.03, 0.28], [-0.03, 0.28]]), '#c9a36a', { stroke: '#8a6a3c' }); path(g, oval(0, 0.33, 0.055, 0.008), '#5a3a22'); }
      const jug = [[-0.075, 0.04], [0.05, 0.04], [0.072, 0.09], [0.06, 0.15], [0.04, 0.18], [-0.065, 0.18], [-0.085, 0.15], [-0.095, 0.09]];
      path(g, soft([[-0.09, 0.045], [0.065, 0.045], [0.07, 0.095], [-0.093, 0.095]]), '#5b3521', { op: 0.92 });
      path(g, soft(jug), '#e3edf3', { op: 0.32, stroke: '#8fa3b2' });
      path(g, soft([[0.055, 0.16], [0.095, 0.155], [0.1, 0.07], [0.06, 0.06], [0.062, 0.08], [0.083, 0.085], [0.08, 0.14], [0.058, 0.14]]), '#2a2c30');
      path(g, rr(-0.07, 0.175, 0.045, 0.192, 0.006), '#2a2c30'); path(g, soft([[-0.08, 0.06], [-0.07, 0.15], [-0.06, 0.15], [-0.07, 0.06]]), '#ffffff', { op: 0.5 });
      [0, 0.35, 0.7].forEach((dl) => drop(g, -0.01, 0.185, 0.085, dl, '#5b3521'));
    }
  } else if (kind === 'vacuum') {
    shadow(-0.16, 0.16);
    if (view === 'side') {
      path(g, rr(-0.16, 0.01, 0.17, 0.07, 0.02), '#3a3d42', { stroke: '#1d1f23' }); path(g, rr(-0.12, 0.05, 0.14, 0.085, 0.015), col, { stroke: edge(col, 0.4) });
      path(g, circ(-0.13, 0.05, 0.05), '#2a2c30', { stroke: '#121315' }); path(g, circ(-0.13, 0.05, 0.02), '#8d949c');
      const roll = mover(g, 'ld-a-spinf', 0.13, 0.03); path(roll, circ(0.13, 0.03, 0.022), '#5b6068', { stroke: '#2a2c30' }); path(roll, line([[0.11, 0.03], [0.15, 0.03]]), 'none', { stroke: '#e0b23c', w: sw * 1.6 }); path(roll, line([[0.13, 0.01], [0.13, 0.05]]), 'none', { stroke: '#e0b23c', w: sw * 1.6 });
      path(g, poly([[-0.09, 0.08], [-0.02, 0.08], [0.01, 0.5], [-0.07, 0.5]]), col, { stroke: edge(col, 0.4) });
      path(g, poly([[-0.075, 0.14], [-0.02, 0.14], [0.0, 0.42], [-0.06, 0.42]]), '#dfe9f0', { op: 0.6, stroke: '#94a7b6' });
      path(g, line([[-0.03, 0.5], [0.0, 0.98]]), 'none', { stroke: col, w: k * 0.022 }); path(g, soft([[-0.01, 0.98], [0.06, 1.1], [0.02, 1.1], [-0.02, 1.0]]), '#2a2c30');
      path(g, soft([[0.0, 0.12], [0.05, 0.2], [0.06, 0.5], [0.03, 0.62], [-0.01, 0.62]]).replace(/Z$/, ''), 'none', { stroke: '#2a2c30', w: k * 0.016 });
    } else {
      path(g, rr(-0.15, 0.005, 0.15, 0.07, 0.015), '#3a3d42', { stroke: '#1d1f23' }); path(g, rr(-0.13, 0.04, 0.13, 0.085, 0.015), col, { stroke: edge(col, 0.4) }); path(g, rr(-0.1, 0.055, 0.1, 0.07, 0.006), '#2a2c30', { op: 0.7 });
      path(g, rr(-0.08, 0.085, 0.08, 0.14, 0.02), col, { stroke: edge(col, 0.4) });
      path(g, rr(-0.068, 0.14, 0.068, 0.42, 0.02), '#dfe9f0', { op: 0.5, stroke: '#94a7b6' });
      path(g, soft([[-0.06, 0.15], [0.06, 0.15], [0.06, 0.21], [-0.06, 0.21]]), '#8b8579', { op: 0.75 });
      const swirl = mover(g, 'ld-a-spinf', 0, 0.3); for (let i = 0; i < 7; i++) { const a = i * 0.9, r = 0.015 + i * 0.006; path(swirl, circ(Math.cos(a) * r, 0.3 + Math.sin(a) * r * 1.6, 0.005), '#8b8579', { op: 0.7 }); }
      path(g, poly([[-0.03, 0.4], [0.03, 0.4], [0.012, 0.2], [-0.012, 0.2]]), '#c9d3da', { op: 0.6, stroke: '#94a7b6' });
      path(g, rr(-0.075, 0.42, 0.075, 0.5, 0.025), col, { stroke: edge(col, 0.4) });
      path(g, rr(-0.012, 0.5, 0.012, 0.98, 0.01), col, { stroke: edge(col, 0.45) });
      path(g, soft([[-0.012, 0.97], [-0.05, 1.04], [-0.02, 1.1], [0.02, 1.1], [0.04, 1.04], [0.012, 0.97]]), col, { stroke: edge(col, 0.45) }); path(g, soft([[-0.02, 1.0], [-0.03, 1.05], [-0.01, 1.08], [0.02, 1.07], [0.02, 1.02]]), '#2a2c30');
      path(g, soft([[0.07, 0.11], [0.11, 0.18], [0.115, 0.48], [0.09, 0.6], [0.03, 0.62], [0.013, 0.6]]).replace(/Z$/, ''), 'none', { stroke: '#2a2c30', w: k * 0.018 });
    }
  } else if (kind === 'aircon') {
    shadow(-0.24, 0.24);
    const wheels = (us) => us.forEach((u) => { path(g, circ(u, 0.022, 0.022), '#2a2c30', { stroke: '#121315' }); });
    if (view === 'side') {
      wheels([-0.13, 0.13]); path(g, rr(-0.19, 0.035, 0.19, 0.75, 0.06), col, { stroke: edge(col, 0.4) });
      path(g, rr(-0.04, 0.6, 0.06, 0.65, 0.02), edge(col, 0.25), { stroke: edge(col, 0.4) });
      path(g, rr(-0.26, 0.38, -0.19, 0.46, 0.01), '#e6e8ea', { stroke: '#a7adb3' }); for (let i = 0; i < 4; i++) path(g, line([[-0.255 + i * 0.016, 0.385], [-0.255 + i * 0.016, 0.455]]), 'none', { stroke: '#b9bec4', w: sw });
      air(g, [[-0.27, 0.42], [-0.32, 0.47], [-0.36, 0.44], [-0.4, 0.49]], '#f08a5d');
    } else {
      wheels([-0.16, 0.16]); path(g, rr(-0.225, 0.035, 0.225, 0.75, 0.06), col, { stroke: edge(col, 0.4) });
      path(g, rr(-0.2, 0.05, -0.12, 0.7, 0.03), lite(col, 0.55), { op: 0.5 });
      path(g, rr(-0.16, 0.5, 0.16, 0.69, 0.02), '#4a5058', { stroke: edge(col, 0.5) });
      for (let i = 0; i < 4; i++) { const v = 0.525 + i * 0.043, lv = mover(g, 'ld-a-tail', 0, v, `animation-delay:${i * 0.1}s`); path(lv, rr(-0.15, v - 0.012, 0.15, v + 0.012, 0.006), '#e8ebee', { stroke: '#a7adb3' }); }
      path(g, rr(-0.04, 0.42, 0.04, 0.435, 0.004), edge(col, 0.3));
      [[0.12, 0], [0, 0.4], [-0.12, 0.8]].forEach(([du, dl]) => air(g, [[du, 0.7], [du * 1.4, 0.78], [du * 1.2 - 0.03, 0.84], [du * 1.6, 0.9]], '#7cc4f0', dl));
    }
  } else if (kind === 'fan') {
    shadow(-0.22, 0.22);
    path(g, oval(0, 0.025, 0.2, 0.03), col, { stroke: edge(col, 0.4) }); path(g, soft([[-0.16, 0.03], [0.16, 0.03], [0.06, 0.08], [-0.06, 0.08]]), col, { stroke: edge(col, 0.4) });
    path(g, rr(-0.015, 0.07, 0.015, 0.8, 0.008), col, { stroke: edge(col, 0.45) }); path(g, rr(-0.022, 0.55, 0.022, 0.6, 0.006), '#9aa1a9');
    if (view === 'side') {
      path(g, rr(-0.12, 0.88, -0.02, 1.02, 0.04), col, { stroke: edge(col, 0.4) }); path(g, rr(-0.02, 0.8, 0.0, 0.9, 0.006), col);
      path(g, oval(0.04, 0.95, 0.05, 0.22), '#ffffff', { op: 0.25, stroke: '#9aa1a9' }); path(g, oval(0.03, 0.95, 0.012, 0.03), '#5b9bd5');
      const bl = mover(g, 'ld-a-flapf', 0.03, 0.95); path(bl, oval(0.03, 0.95, 0.02, 0.2), '#7fb7e6', { op: 0.6 });
    } else {
      path(g, rr(-0.025, 0.8, 0.025, 0.88, 0.01), col);
      path(g, circ(0, 0.95, 0.225), '#ffffff', { op: 0.25, stroke: '#a3aab2', w: sw * 1.6 });
      const blades = mover(g, 'ld-a-spinf', 0, 0.95);
      for (let i = 0; i < 3; i++) { const a = i * 2.094, c = Math.cos(a), sn = Math.sin(a), R = (u, v) => [u * c - v * sn, 0.95 + u * sn + v * c]; path(blades, soft([R(0.02, 0.01), R(0.12, 0.06), R(0.19, 0.03), R(0.18, -0.04), R(0.08, -0.03)]), '#7fb7e6', { op: 0.85, stroke: '#4e8ec7' }); }
      let wires = ''; for (let i = 0; i < 24; i++) { const a = i * 0.2618; wires += line([[Math.cos(a) * 0.05, 0.95 + Math.sin(a) * 0.05], [Math.cos(a) * 0.222, 0.95 + Math.sin(a) * 0.222]]); } path(g, wires, 'none', { stroke: '#b9bfc6', w: sw * 0.7, op: 0.8 });
      [0.12, 0.18].forEach((r) => path(g, circ(0, 0.95, r), 'none', { stroke: '#b9bfc6', w: sw * 0.7, op: 0.8 }));
      path(g, circ(0, 0.95, 0.04), col, { stroke: edge(col, 0.4) }); path(g, circ(-0.01, 0.96, 0.015), '#ffffff', { op: 0.6 });
    }
  } else if (kind === 'ricecooker') {
    shadow(-0.16, 0.16);
    if (view === 'open') {
      path(g, poly([[-0.13, 0.2], [0.13, 0.2], [0.12, 0.33], [-0.12, 0.33]]), col, { stroke: edge(col, 0.4) }); // (the lid, flipped up behind)
      path(g, rr(-0.15, 0.01, 0.15, 0.2, 0.05), col, { stroke: edge(col, 0.35) }); path(g, oval(0, 0.2, 0.13, 0.025), '#b9bfc6', { stroke: '#8a9098' });
      path(g, oval(0, 0.205, 0.11, 0.018), '#fbfaf3', { stroke: '#d8d2bd' }); dots(g, -0.09, 0.198, 0.09, 0.212, 14, 2, 0.006, '#ffffff', 0.9);
      [0, 0.8, 1.6].forEach((dl, i) => steam(g, -0.04 + i * 0.04, 0.23, 0.12, dl));
    } else {
      path(g, rr(-0.15, 0.01, 0.15, 0.2, 0.05), col, { stroke: edge(col, 0.35) }); path(g, rr(-0.13, 0.03, -0.07, 0.18, 0.03), '#ffffff', { op: 0.6 });
      path(g, soft([[-0.145, 0.195], [0.145, 0.195], [0.11, 0.25], [0, 0.27], [-0.11, 0.25]]), lite(col, 0.3), { stroke: edge(col, 0.35) });
      path(g, rr(-0.012, 0.262, 0.012, 0.28, 0.005), '#9aa1a9'); path(g, rr(-0.06, 0.271, 0.06, 0.288, 0.008), '#5b6068');
      path(g, rr(-0.05, 0.07, 0.05, 0.14, 0.012), '#e6e5df', { stroke: '#b5b3ab' }); path(g, rr(-0.012, 0.09, 0.012, 0.125, 0.004), '#5b6068');
      path(mover(g, 'ld-a-glow', -0.03, 0.155), circ(-0.03, 0.155, 0.008), '#ff5a3c'); path(g, circ(0.03, 0.155, 0.008), '#f6b23c', { op: 0.6 });
      if (view === 'side') { [-1, 1].forEach((sd) => path(g, rr(sd * 0.15, 0.14, sd * 0.175, 0.17, 0.006), '#5b6068')); }
      [0, 0.9, 1.8].forEach((dl) => steam(g, 0, 0.29, 0.13, dl));
    }
  }
  return root;
}

// (v328) what Cassie knows about each appliance: how it looks from each side, how it works, and its parts in their real places
const APPLIANCES = [
  { is: /\b(refrigerators?|fridges?|ref|freezers?|ref ?ri ?ge ?ra ?tor)\b/i, not: /\b(reference|referee)\b/i, kind: 'fridge', what: 'a refrigerator', views: 'front: a tall box, two doors on top that meet in the middle with long handles, a freezer drawer below, an ice and water dispenser on the left door; side: a tall plain panel, the handles sticking out at the front; open: shelves, door bins, crisper drawers at the bottom and a light at the top; back: the black condenser coils and the compressor at the bottom', works: 'It moves heat out of the box. A liquid called refrigerant boils in the evaporator coils inside, taking in heat so the inside gets cold; the compressor at the bottom back squeezes the gas so it gets hot; the condenser coils at the back give that heat to the room; the expansion valve lets the pressure drop so it is cold again, round and round. Thick foam walls keep the cold in and a rubber seal closes the doors.', parts: ['evaporator (inside, at the back)', 'compressor (at the bottom back)', 'condenser coils (on the back)', 'expansion valve', 'thermostat', 'shelves and drawers', 'door seal', 'light'] },
  { is: /\b(washing machines?|washers?|labahan|washing mashine|laundry machines?)\b/i, not: /\b(dish ?washers?|pressure washers?)\b/i, kind: 'washer', what: 'a washing machine', views: 'front: a box with a round glass door low in the middle, the steel drum and its paddles seen through it, a control panel across the top (detergent drawer on the left, a dial, a display), a small filter door at the bottom right; side: a plain panel with pressed ridges; back: the water inlet and drain hose', works: 'A valve lets water in and it mixes with soap from the detergent drawer. A motor turns the drum through a belt, so the paddles lift the clothes and drop them through the soapy water. A pump drains the dirty water, it rinses, then the drum spins very fast and the water flies out through its holes.', parts: ['drum (with holes and paddles)', 'motor', 'belt and pulley', 'water inlet valve', 'drain pump', 'detergent drawer', 'door seal', 'control panel'] },
  { is: /\b(microwaves?|microwave ovens?)\b/i, not: /\b(microwave (radiation|background|frequenc\w+|spectrum))\b/i, kind: 'microwave', what: 'a microwave oven', views: 'front: a wide box, a door with a see-through window on the left, the control panel on the right (display, buttons, a dial); open: a box-shaped cavity, a glass turntable on the floor, a light in the corner; side and top: vent slots', works: 'A magnetron (behind the control panel) makes microwaves, invisible waves that a metal channel (the waveguide) sends into the metal cavity. They make the water in the food jiggle very fast, which heats it from inside. The turntable turns the food so it heats evenly; the metal mesh in the window keeps the waves in while letting you see.', parts: ['magnetron (behind the control panel)', 'waveguide', 'cavity', 'turntable', 'door with metal mesh window', 'control panel', 'vent slots'] },
  { is: /\b(blenders?|smoothie makers?)\b/i, kind: 'blender', what: 'a blender', views: 'front: a jar (pitcher) with a lid and a handle on the side, standing on a heavy base with a dial and buttons; inside the jar at the bottom: four sharp blades', works: 'A strong electric motor in the base spins a shaft that pokes up through the jar\'s bottom; the blades on it spin thousands of times a minute, cutting the food and making a whirlpool that pulls it down into the blades again and again.', parts: ['jar (pitcher)', 'lid', 'blades', 'motor (in the base)', 'drive coupling', 'speed dial and buttons'] },
  { is: /\b(toasters?)\b/i, kind: 'toaster', what: 'a toaster', views: 'front: a rounded steel box on a black base, two slots on top with bread in them; side: the lever that pushes the bread down, a browning dial and buttons (cancel, reheat, defrost); from above: two long slots lined with thin wires', works: 'Pushing the lever down lowers the bread and switches on the current. Thin nichrome wires lining each slot get red hot and toast both sides. A timer set by the dial lets go of a catch and a spring pops the toast up. Crumbs fall into a tray that slides out of the bottom.', parts: ['slots', 'heating wires (nichrome)', 'lever', 'spring', 'browning dial (timer)', 'crumb tray'] },
  { is: /\b(coffee ?makers?|coffee machines?|drip coffee|coffee brewers?)\b/i, kind: 'coffeemaker', what: 'a drip coffee maker', views: 'front: a glass carafe on a warming plate at the bottom, the filter basket and showerhead above it under a lid; side: a window showing the water level in the tank at the back', works: 'Water from the tank runs into an aluminium tube under the warming plate, where a heater boils it; bubbles push the hot water up a tube to the showerhead, which sprinkles it over the ground coffee in the filter; coffee drips down into the carafe, and the warming plate keeps it hot.', parts: ['water tank', 'heating element', 'hot water tube', 'showerhead', 'filter basket', 'carafe', 'warming plate'] },
  { is: /\b(vacuum cleaners?|vacuums?|hoovers?)\b/i, not: /\bvacuum (tubes?|chambers?|of space|energy|pumps?)\b/i, kind: 'vacuum', what: 'an upright vacuum cleaner', views: 'front: a tall stick with a looped handle on top, a clear dust bin in the middle, a wide floor head at the bottom; side: big back wheels, the hose on the back; underneath: a spinning brush roll', works: 'A motor spins a fan that pushes air out the back, which leaves low pressure inside, so the air outside rushes in through the floor head carrying dust. The brush roll spins to loosen dirt from the carpet. In the bin the air whirls round (a cyclone), throwing the dust out to the sides, and a filter cleans the air before it leaves.', parts: ['motor and fan', 'brush roll', 'floor head', 'dust bin (cyclone)', 'filter', 'hose', 'handle'] },
  { is: /\b(air ?con(ditioner|ditioning)?s?|aircons?|portable a\/?c|a\/?c units?)\b/i, kind: 'aircon', what: 'a portable air conditioner', views: 'front: a tall rounded box on little wheels, louvers at the top front blowing cool air; back: two grilles and a wide hose that carries hot air out of a window; top: the control panel', works: 'It works like a fridge for a room: refrigerant in the cold evaporator coils takes heat from the room air the fan blows over them, the compressor squeezes the gas so it is hot, and the hot condenser coils give that heat to air that the exhaust hose blows outside. Water from the air drips into a tank.', parts: ['evaporator coils', 'compressor', 'condenser coils', 'fans', 'louvers', 'exhaust hose', 'water tank', 'air filter'] },
  { is: /\b(electric fans?|stand fans?|electric ?fan|bentilador|fans?)\b/i, not: /\b(fans? of|fan ?(base|club|page|art|fiction)|ceiling fans?)\b/i, kind: 'fan', what: 'an electric stand fan', views: 'front: a round wire guard with three blades inside, on a tall pole over a round base; side: the motor behind the blades', works: 'An electric motor spins the blades; each blade is tilted, so it pushes air forward like a propeller. A gear at the back slowly turns the head from side to side. It does not cool the air; moving air helps sweat evaporate from your skin, which cools you.', parts: ['blades', 'motor', 'guard', 'oscillation gear', 'speed buttons', 'pole and base'] },
  { is: /\b(rice cookers?|rice ?cooker|kaldero)\b/i, kind: 'ricecooker', what: 'a rice cooker', views: 'front: a round white pot with a domed lid, a switch and two lights (cook and warm) on the front, a little steam vent on the lid; open: the inner pot of rice', works: 'A heating plate under the inner pot boils the water. While there is water the pot stays at 100 degrees; once the rice has soaked it all up, the pot gets hotter, a magnet in the thermostat lets go, and the switch flips from cook to keep warm.', parts: ['inner pot', 'heating plate', 'thermostat (magnet)', 'lid', 'steam vent', 'switch and lights'] },
];
export function applianceGuide(asked = '') {
  const q = String(asked || ''), hits = APPLIANCES.filter((a) => a.is.test(q) && !(a.not && a.not.test(q))).sort((a, b) => q.match(b.is)[0].length - q.match(a.is)[0].length).slice(0, 2);
  return hits.map((a) => `About ${a.what} (draw it with the appliance kit, kind "${a.kind}"; its moving parts move on their own): how it looks: ${a.views}. How it works: ${a.works} Its main parts, each in its real place: ${a.parts.join(', ')}.`).join('\n');
}
// ---------- (v329) the food kit: fruits, vegetables and dishes, drawn whole and lifelike, or cut open to show inside ----------
// {"t":"food","kind":"apple","x":200,"y":200,"w":90,"view":"whole|cut|both"}: x its middle, y the table under it, w its width.
// "cut" shows it sliced through the middle (an apple's core and seeds, an orange's segments, a kiwi's seeds, a peach's pit);
// "both" puts the whole one beside a cut half. b: how it is drawn; asp: its height for its width; the rest are its real colours.
const FOOD = {
  // fruits
  apple: { b: 'round', sh: 'apple', asp: 0.92, col: '#d42f2a', col2: '#f2a43a', stem: 1, leaf: 1, cut: 'core', flesh: '#f7eed2', grp: 'fruit' },
  pear: { b: 'round', sh: 'pear', asp: 1.3, col: '#b5c84a', col2: '#e8b84a', stem: 1, leaf: 1, cut: 'core', flesh: '#f6f0d8', grp: 'fruit' },
  orange: { b: 'round', sh: 'round', asp: 0.96, col: '#f39a1e', tex: 'dimple', leaf: 1, stem: 1, cut: 'segments', flesh: '#f8a531', grp: 'fruit' },
  lemon: { b: 'round', sh: 'lemon', asp: 0.72, col: '#f6d62e', tex: 'dimple', leaf: 1, cut: 'segments', flesh: '#f8e67a', grp: 'fruit' },
  lime: { b: 'round', sh: 'round', asp: 0.9, col: '#76b13c', tex: 'dimple', cut: 'segments', flesh: '#c6e384', grp: 'fruit' },
  peach: { b: 'round', sh: 'round', asp: 0.95, col: '#f6a95e', col2: '#e0504a', crease: 1, stem: 1, leaf: 1, cut: 'pit', flesh: '#f8b866', pit: '#93512e', grp: 'fruit' },
  mango: { b: 'round', sh: 'mango', asp: 0.66, col: '#f2b134', col2: '#d9452b', col3: '#79a83a', stem: 1, leaf: 1, cut: 'pit', flesh: '#fbb52e', pit: '#e8d7a3', grp: 'fruit' },
  avocado: { b: 'round', sh: 'pear', asp: 1.25, col: '#3d5a28', tex: 'bumps', cut: 'pit', flesh: '#dbe68f', rim: '#9fc24d', pit: '#7a4a2a', grp: 'fruit' },
  kiwi: { b: 'round', sh: 'round', asp: 0.78, col: '#8f6c40', tex: 'fuzz', cut: 'kiwi', flesh: '#8cc63f', grp: 'fruit' },
  pomegranate: { b: 'round', sh: 'round', asp: 0.92, col: '#a3202f', crown: 1, cut: 'arils', flesh: '#f2d8bd', grp: 'fruit' },
  coconut: { b: 'round', sh: 'round', asp: 0.92, col: '#6e4a2b', tex: 'fiber', cut: 'hollow', flesh: '#fbfaf3', grp: 'fruit' },
  papaya: { b: 'round', sh: 'mango', asp: 0.58, col: '#eaa23a', col3: '#6f9a3a', cut: 'seeds', flesh: '#f6873a', grp: 'fruit' },
  watermelon: { b: 'round', sh: 'round', asp: 0.78, col: '#3d8a36', tex: 'stripes', cut: 'melon', flesh: '#f04b4b', grp: 'fruit' },
  melon: { b: 'round', sh: 'round', asp: 0.9, col: '#d8b779', tex: 'net', cut: 'seeds', flesh: '#f7a24b', seed: '#f3e3b8', grp: 'fruit' },
  dragonfruit: { b: 'round', sh: 'oval', asp: 0.8, col: '#e0357a', tex: 'scales', cut: 'dots', flesh: '#fbf7f3', grp: 'fruit' },
  persimmon: { b: 'round', sh: 'squat', asp: 0.78, col: '#f27a1e', crown: 2, cut: 'star', flesh: '#f9963a', grp: 'fruit' },
  strawberry: { b: 'round', sh: 'heart', asp: 1.1, col: '#e0262d', tex: 'seeds', crown: 3, cut: 'berry', flesh: '#f6a0a0', grp: 'fruit' },
  tomato: { b: 'round', sh: 'squat', asp: 0.82, col: '#e3332a', crown: 3, cut: 'tomato', flesh: '#f0473a', grp: 'vegetable' },
  onion: { b: 'round', sh: 'onion', asp: 0.98, col: '#a94069', cut: 'rings', flesh: '#f3dbe6', grp: 'vegetable' },
  potato: { b: 'round', sh: 'lumpy', asp: 0.66, col: '#d6b36c', tex: 'eyes', cut: 'plain', flesh: '#f4e4a2', grp: 'vegetable' },
  pumpkin: { b: 'pumpkin', asp: 0.72, col: '#f08a24', cut: 'pumpkin', flesh: '#f8a03c', grp: 'vegetable' },
  grapes: { b: 'grapes', asp: 1.3, col: '#7b3f8c', grp: 'fruit' },
  greengrapes: { b: 'grapes', asp: 1.3, col: '#b8d062', grp: 'fruit' },
  cherry: { b: 'cherries', asp: 1.1, col: '#b3121e', grp: 'fruit' },
  blueberry: { b: 'berries', asp: 0.7, col: '#3d4f9a', grp: 'fruit' },
  raspberry: { b: 'drupe', asp: 1.0, col: '#d12d4c', grp: 'fruit' },
  blackberry: { b: 'drupe', asp: 1.1, col: '#2b1f3a', grp: 'fruit' },
  banana: { b: 'banana', asp: 0.5, col: '#f4d03f', grp: 'fruit' },
  pineapple: { b: 'pineapple', asp: 1.9, col: '#d9a33a', grp: 'fruit' },
  // vegetables
  carrot: { b: 'carrot', asp: 1.7, col: '#f07f1e', grp: 'vegetable' },
  cucumber: { b: 'long', asp: 0.28, col: '#3f7d34', tex: 'bumps', cut: 'cucumber', flesh: '#d9ecb0', grp: 'vegetable' },
  zucchini: { b: 'long', asp: 0.24, col: '#355f28', tex: 'speckle', cut: 'cucumber', flesh: '#eef3cf', grp: 'vegetable' },
  eggplant: { b: 'long', asp: 0.42, col: '#4a2759', bulb: 1, cut: 'plain', flesh: '#efe6c8', grp: 'vegetable' },
  sweetpotato: { b: 'long', asp: 0.36, col: '#9b4a52', taper: 1, cut: 'plain', flesh: '#f39a3a', grp: 'vegetable' },
  chili: { b: 'long', asp: 0.22, col: '#d4202a', taper: 2, grp: 'vegetable' },
  corn: { b: 'corn', asp: 0.36, col: '#f2c230', grp: 'vegetable' },
  bellpepper: { b: 'pepper', asp: 1.0, col: '#d9262c', grp: 'vegetable' },
  yellowpepper: { b: 'pepper', asp: 1.0, col: '#f4c21e', grp: 'vegetable' },
  greenpepper: { b: 'pepper', asp: 1.0, col: '#3f8f2e', grp: 'vegetable' },
  cabbage: { b: 'cabbage', asp: 0.9, col: '#8cc152', grp: 'vegetable' },
  redcabbage: { b: 'cabbage', asp: 0.9, col: '#6b3a7a', grp: 'vegetable' },
  lettuce: { b: 'lettuce', asp: 0.9, col: '#8bd15a', grp: 'vegetable' },
  spinach: { b: 'greens', asp: 1.2, col: '#2f6e2c', grp: 'vegetable' },
  broccoli: { b: 'broccoli', asp: 1.05, col: '#2f7a34', grp: 'vegetable' },
  cauliflower: { b: 'broccoli', asp: 0.95, col: '#f3ecd8', grp: 'vegetable' },
  mushroom: { b: 'mushroom', asp: 0.9, col: '#a9774a', grp: 'vegetable' },
  peas: { b: 'peas', asp: 0.4, col: '#6fb43c', grp: 'vegetable' },
  garlic: { b: 'garlic', asp: 1.05, col: '#f1ebe4', grp: 'vegetable' },
  beet: { b: 'root', asp: 1.7, col: '#7a1f3d', grp: 'vegetable' },
  radish: { b: 'root', asp: 1.9, col: '#d8314f', grp: 'vegetable' },
  celery: { b: 'celery', asp: 1.9, col: '#a9cf6a', grp: 'vegetable' },
  // dishes and foods
  bread: { b: 'loaf', asp: 0.55, col: '#d9933e', grp: 'grain' },
  toast: { b: 'toast', asp: 1.0, col: '#d89a4a', grp: 'grain' },
  croissant: { b: 'croissant', asp: 0.55, col: '#d68a35', grp: 'grain' },
  pancakes: { b: 'pancakes', asp: 0.75, col: '#e0a04c', grp: 'grain' },
  waffle: { b: 'waffle', asp: 0.4, col: '#e1a24a', grp: 'grain' },
  rice: { b: 'bowl', fill: 'rice', asp: 0.62, col: '#fbfaf5', hot: 1, grp: 'grain' },
  noodles: { b: 'bowl', fill: 'noodles', asp: 0.62, col: '#f0c55a', hot: 1, grp: 'grain' },
  soup: { b: 'bowl', fill: 'soup', asp: 0.55, col: '#c9672e', hot: 1, grp: 'meal' },
  salad: { b: 'bowl', fill: 'salad', asp: 0.62, col: '#7cc04a', grp: 'vegetable' },
  sandwich: { b: 'sandwich', asp: 0.75, col: '#f1d6a0', grp: 'meal' },
  burger: { b: 'burger', asp: 0.82, col: '#d4883a', grp: 'meal' },
  pizza: { b: 'pizza', asp: 0.85, col: '#f2c14e', grp: 'meal' },
  taco: { b: 'taco', asp: 0.6, col: '#e8b24a', grp: 'meal' },
  fries: { b: 'fries', asp: 1.25, col: '#f6c64a', grp: 'meal' },
  egg: { b: 'egg', asp: 0.55, col: '#fbf8ef', grp: 'protein' },
  bacon: { b: 'bacon', asp: 0.4, col: '#b8453a', grp: 'protein' },
  sausage: { b: 'sausage', asp: 0.42, col: '#8a4526', grp: 'protein' },
  chicken: { b: 'roast', asp: 0.66, col: '#c97a32', grp: 'protein' },
  drumstick: { b: 'drumstick', asp: 0.55, col: '#c27030', grp: 'protein' },
  fish: { b: 'salmon', asp: 0.62, col: '#f2865a', grp: 'protein' },
  steak: { b: 'steak', asp: 0.45, col: '#8a3a2a', grp: 'protein' },
  cheese: { b: 'cheese', asp: 0.6, col: '#f6c84a', grp: 'dairy' },
  milk: { b: 'glass', fill: '#fbfbf8', asp: 1.5, grp: 'dairy' },
  juice: { b: 'glass', fill: '#f7a21e', asp: 1.65, straw: 1, grp: 'fruit' },
  tea: { b: 'cup', fill: '#a8541e', asp: 0.7, hot: 1, grp: 'drink' },
  water: { b: 'glass', fill: '#cfe8f7', asp: 1.5, grp: 'drink' },
};
const FOOD_KINDS = Object.keys(FOOD);
const FOOD_NAMES = { greengrapes: 'green grapes', bellpepper: 'red bell pepper', yellowpepper: 'yellow bell pepper', greenpepper: 'green bell pepper', redcabbage: 'red cabbage', sweetpotato: 'sweet potato', dragonfruit: 'dragon fruit' };
const FOOD_CUT = (A) => !!A.cut;
function foodBox(sh) {
  const A = FOOD[String(sh.kind || '').toLowerCase()] || FOOD.apple, x = +sh.x, y = +sh.y, w = Math.max(6, Math.min(400, +sh.w || +sh.size || 90));
  const both = sh.view === 'both' && FOOD_CUT(A), cut = sh.view === 'cut' && FOOD_CUT(A);
  const cutH = (q) => (A.b === 'long' ? 0.32 : Math.min(0.96, A.asp * 0.96)) * q;
  const h = both ? Math.max(w * 0.48 * A.asp, cutH(w * 0.48)) : cut ? cutH(w) : w * A.asp;
  return [[x - w / 2, y - h], [x + w / 2, y]];
}
let foodN = 0;
function foodShape(s, mk) {
  const kind = FOOD[String(s.kind || '').toLowerCase()] ? String(s.kind).toLowerCase() : 'apple', A = FOOD[kind];
  const N = (v, lo, hi, d) => { v = +v; return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; };
  const X = N(s.x ?? s.cx, -40, 440, 200), Y = N(s.y ?? s.cy, -40, 300, 200), W = N(s.w ?? s.size, 6, 400, 90), moving = !s.still;
  const view = FOOD_CUT(A) && (s.view === 'cut' || s.view === 'both') ? s.view : 'whole';
  const root = mk('g', { class: 'ld-kit ld-food' });
  const top = mk('g', s.facing === 'left' ? { transform: `translate(${2 * X},0) scale(-1,1)` } : {}); root.appendChild(top);
  const defs = mk('defs', {}); top.appendChild(defs);
  const fx = (n) => n.toFixed(1);
  const draw = (x, y, w, cut) => { // one item: its middle x, the table y, its width w
    const id = `ldfd${++foodN}`, R = krand(x * 7 + y * 13 + w * 3 + kind.length * 31);
    const P = (u, v) => [x + u * w, y - v * w];
    const sw = Math.max(0.7, w * 0.012);
    const path = (parent, d, fill, o = {}) => { const e = mk('path', { d, fill: fill || 'none', stroke: o.stroke || 'none', 'stroke-width': o.w || sw, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }); if (o.op != null) e.setAttribute(fill && fill !== 'none' && !String(fill).startsWith('url') ? 'fill-opacity' : (fill && fill !== 'none' ? 'opacity' : 'stroke-opacity'), o.op); parent.appendChild(e); return e; };
    const circ = (u, v, r) => kc(...P(u, v), r * w), oval = (u, v, rx, ry, rot = 0) => ke(...P(u, v), rx * w, ry * w, rot);
    const soft = (pts) => ksmooth(pts.map(([u, v]) => P(u, v)));
    const line = (pts) => 'M' + pts.map(([u, v]) => P(u, v).map(fx).join(',')).join('L');
    const curve = (pts) => { const q = pts.map(([u, v]) => P(u, v)); let d = `M${fx(q[0][0])},${fx(q[0][1])}`; for (let i = 1; i < q.length - 1; i++) { const mx = (q[i][0] + q[i + 1][0]) / 2, my = (q[i][1] + q[i + 1][1]) / 2; d += `Q${fx(q[i][0])},${fx(q[i][1])} ${fx(i === q.length - 2 ? q[i + 1][0] : mx)},${fx(i === q.length - 2 ? q[i + 1][1] : my)}`; } return d; };
    const edge = (c, k = 0.42) => kitDark(c, k), lite = (c, k = 0.45) => kitLight(c, k);
    // a soft round shading: lit at the top left, darker round the far edge
    const grad = (c, { cx = 0.36, cy = 0.3, r = 0.75, l = 0.32, d = 0.32 } = {}) => {
      const gid = `${id}g${defs.childNodes.length}`, g = mk('radialGradient', { id: gid, cx, cy, r, fx: cx, fy: cy });
      [[0, lite(c, l)], [0.55, c], [1, edge(c, d)]].forEach(([o, sc]) => g.appendChild(mk('stop', { offset: o, 'stop-color': sc }))); defs.appendChild(g); return `url(#${gid})`;
    };
    const lin = (stops, x1 = 0, y1 = 0, x2 = 0, y2 = 1) => { const gid = `${id}l${defs.childNodes.length}`, g = mk('linearGradient', { id: gid, x1, y1, x2, y2 }); stops.forEach(([o, sc]) => g.appendChild(mk('stop', { offset: o, 'stop-color': sc }))); defs.appendChild(g); return `url(#${gid})`; };
    const clipTo = (parent, d) => { const cid = `${id}c${defs.childNodes.length}`, cp = mk('clipPath', { id: cid }); cp.appendChild(mk('path', { d })); defs.appendChild(cp); const g = mk('g', { 'clip-path': `url(#${cid})` }); parent.appendChild(g); return g; };
    const shine = (parent, u, v, rx, ry, rot = -30, op = 0.55) => path(parent, oval(u, v, rx, ry, rot), '#ffffff', { op });
    const shadow = (u0, u1) => path(g0, oval((u0 + u1) / 2, 0.005, (u1 - u0) * 0.5, Math.max(0.02, (u1 - u0) * 0.07)), '#000000', { op: 0.14 });
    const steam = (parent, u, v, rise, delay) => { const [ox, oy] = P(u, v); const gg = mk('g', moving ? { class: 'ld-anim ld-a-steam', style: `transform-origin:${fx(ox)}px ${fx(oy)}px;--rise:${fx(-rise * w)}px;animation-delay:${delay}s` } : {}); parent.appendChild(gg); path(gg, curve([[u, v], [u - 0.03, v + rise * 0.3], [u + 0.03, v + rise * 0.6], [u, v + rise]]), 'none', { stroke: '#ffffff', w: sw * 2.4, op: 0.75 }); };
    const leafAt = (parent, u, v, len, ang, c = '#5c9e35', wd = 1) => { const a = ang * Math.PI / 180, cs = Math.cos(a), sn = Math.sin(a), Q = (p, q) => [u + p * cs - q * sn * wd, v + p * sn + q * cs * wd]; path(parent, soft([Q(0, 0), Q(len * 0.3, len * 0.22), Q(len * 0.75, len * 0.18), Q(len, 0), Q(len * 0.7, -len * 0.18), Q(len * 0.3, -len * 0.2)]), grad(c, { cx: 0.4, cy: 0.35 }), { stroke: edge(c, 0.45) }); path(parent, line([Q(len * 0.05, 0), Q(len * 0.9, 0)]), 'none', { stroke: edge(c, 0.3), w: sw * 0.8 }); };
    const g0 = mk('g', {}); top.appendChild(g0);
    const g = g0;
    const cy = A.asp / 2;
    // the outline of a round fruit or vegetable, from its shape
    const outline = (sh, rx, ry, ccx = 0, ccy = cy) => {
      const pts = [];
      for (let i = 0; i < 64; i++) {
        const t = i / 64 * Math.PI * 2, st = Math.sin(t), ct = Math.cos(t); let px = ct * rx, py = st * ry;
        if (sh === 'apple') { px *= 1 + 0.07 * st; py -= 0.09 * ry * Math.exp(-(((t - Math.PI / 2) / 0.32) ** 2)); py += 0.05 * ry * Math.exp(-(((t - Math.PI * 1.5) / 0.4) ** 2)); }
        if (sh === 'pear') { const k = (st + 1) / 2; px *= 1 - 0.5 * Math.max(0, st) ** 1.2 + 0.04 * (1 - k); if (st > 0) py *= 1.02; }
        if (sh === 'lemon') { px += Math.sign(ct) * 0.1 * rx * Math.exp(-((st / 0.22) ** 2)); }
        if (sh === 'heart') { px *= 1 - 0.62 * Math.max(0, -st) ** 1.4; py *= st < 0 ? 1.08 : 0.92; }
        if (sh === 'mango') { px *= 1 + 0.08 * ct; py *= 1 - 0.12 * Math.max(0, ct) * Math.max(0, -st); py += 0.06 * ry * ct * (st > 0 ? 1 : 0); }
        if (sh === 'onion') { if (st > 0) { const q = st ** 3; px *= 1 - 0.75 * q; py *= 1 + 0.32 * q; } }
        if (sh === 'lumpy') { const n = 1 + 0.05 * Math.sin(t * 3 + 1) + 0.03 * Math.sin(t * 5 + 2); px *= n; py *= n; }
        pts.push([ccx + px, ccy + py]);
      }
      return soft(pts);
    };
    const surface = (body, rx, ry, ccx = 0, ccy = cy) => { // its texture, clipped to its outline
      const cl = clipTo(g, body), dk = edge(A.col, 0.35), lt = lite(A.col, 0.4);
      if (A.tex === 'dimple') { let d = ''; for (let i = 0; i < 70; i++) d += circ(ccx + (R() - 0.5) * rx * 2, ccy + (R() - 0.5) * ry * 2, 0.006); path(cl, d, dk, { op: 0.35 }); }
      if (A.tex === 'fuzz') { let d = ''; for (let i = 0; i < 160; i++) { const u = ccx + (R() - 0.5) * rx * 2, v = ccy + (R() - 0.5) * ry * 2; d += line([[u, v], [u + 0.012, v + 0.008]]); } path(cl, d, 'none', { stroke: lt, w: sw * 0.6, op: 0.6 }); }
      if (A.tex === 'bumps') { let d = ''; for (let i = 0; i < 90; i++) d += circ(ccx + (R() - 0.5) * rx * 2, ccy + (R() - 0.5) * ry * 2, 0.009); path(cl, d, lt, { op: 0.3 }); }
      if (A.tex === 'speckle') { let d = ''; for (let i = 0; i < 120; i++) d += circ(ccx + (R() - 0.5) * rx * 2, ccy + (R() - 0.5) * ry * 2, 0.005); path(cl, d, lite(A.col, 0.6), { op: 0.5 }); }
      if (A.tex === 'eyes') { let d = ''; for (let i = 0; i < 7; i++) d += oval(ccx + (R() - 0.5) * rx * 1.5, ccy + (R() - 0.5) * ry * 1.3, 0.018, 0.008, R() * 180); path(cl, d, edge(A.col, 0.4), { op: 0.6 }); }
      if (A.tex === 'fiber') { let d = ''; for (let i = 0; i < 60; i++) { const u = ccx + (R() - 0.5) * rx * 2, v = ccy + (R() - 0.5) * ry * 2; d += line([[u, v], [u + (R() - 0.5) * 0.08, v + 0.05]]); } path(cl, d, 'none', { stroke: edge(A.col, 0.3), w: sw * 0.8, op: 0.7 }); }
      if (A.tex === 'stripes') { for (let i = -6; i <= 6; i++) { const u0 = ccx + i * rx / 5; path(cl, curve([[u0, ccy - ry], [u0 + 0.03, ccy - ry * 0.5], [u0 - 0.02, ccy], [u0 + 0.025, ccy + ry * 0.5], [u0, ccy + ry]]), 'none', { stroke: edge(A.col, 0.55), w: w * 0.045, op: 0.85 }); } }
      if (A.tex === 'net') { let d = ''; for (let i = 0; i < 26; i++) { const u = ccx + (R() - 0.5) * rx * 2.2, v = ccy + (R() - 0.5) * ry * 2.2; d += curve([[u - 0.12, v], [u, v + (R() - 0.5) * 0.06], [u + 0.12, v + (R() - 0.5) * 0.04]]); } path(cl, d, 'none', { stroke: '#efe1bd', w: sw, op: 0.9 }); }
      if (A.tex === 'scales') { for (let i = 0; i < 9; i++) { const u = ccx + (R() - 0.5) * rx * 1.6, v = ccy + (R() - 0.5) * ry * 1.6; path(cl, soft([[u - 0.04, v - 0.03], [u + 0.06, v + 0.05], [u + 0.02, v - 0.02]]), '#9cc43a', { stroke: '#6f9a2a' }); } }
      if (A.tex === 'seeds') { for (let i = 0; i < 40; i++) { const u = ccx + (R() - 0.5) * rx * 1.9, v = ccy + (R() - 0.5) * ry * 1.9; path(cl, oval(u, v, 0.009, 0.014), '#f4d24a', { op: 0.95 }); path(cl, oval(u, v + 0.012, 0.012, 0.006), edge(A.col, 0.4), { op: 0.35 }); } }
      return cl;
    };
    const crown = (u, v, n, c = '#4f8a30', sz = 0.12) => { for (let i = 0; i < 5; i++) { const a = -90 + (i - 2) * (n === 2 ? 40 : 34); leafAt(g, u, v, sz * (n === 3 ? 1 : 0.8), -a + 180 - 180, c); } };
    const sepals = (u, v, sz, c = '#3f8a2e') => { for (let i = 0; i < 6; i++) { const a = i * 60 + 15; leafAt(g, u, v, sz, a, c); } path(g, circ(u, v, sz * 0.18), edge(c, 0.2)); };

    // ---------- round fruits and vegetables
    if (A.b === 'round' && !cut) {
      const rx = 0.48, ry = A.asp * 0.48; shadow(-0.42, 0.42);
      const body = outline(A.sh, rx, ry);
      path(g, body, grad(A.col, { cx: 0.38, cy: 0.32, r: 0.8 }), { stroke: edge(A.col, 0.5) });
      if (A.col2) { const cl = clipTo(g, body); path(cl, oval(0.22, cy + 0.05, 0.36, ry * 0.95, 20), A.col2, { op: 0.3 }); path(cl, oval(0.3, cy + 0.08, 0.2, ry * 0.6, 20), A.col2, { op: 0.25 }); path(cl, oval(-0.25, cy + ry * 0.4, 0.2, 0.12), lite(A.col2, 0.5), { op: 0.25 }); }
      if (A.col3) { const cl = clipTo(g, body); path(cl, oval(-0.42, cy - 0.02, 0.32, ry * 1.1), A.col3, { op: 0.28 }); path(cl, oval(-0.48, cy, 0.18, ry * 0.9), A.col3, { op: 0.3 }); }
      surface(body, rx, ry);
      if (A.crease) path(g, curve([[0.02, cy + ry * 0.95], [-0.05, cy + ry * 0.3], [-0.06, cy - ry * 0.3], [0.0, cy - ry * 0.9]]), 'none', { stroke: edge(A.col, 0.3), w: sw * 1.2, op: 0.6 });
      if (A.sh === 'onion') for (let i = -2; i <= 2; i++) path(g, curve([[i * 0.03, cy + ry * 1.25], [i * 0.12, cy + ry * 0.4], [i * 0.15, cy - ry * 0.4], [i * 0.04, cy - ry * 0.98]]), 'none', { stroke: lite(A.col, 0.4), w: sw * 0.8, op: 0.7 });
      shine(g, -0.2, cy + ry * 0.45, 0.1, 0.06);
      const topV = cy + ry * (A.sh === 'apple' ? 0.88 : A.sh === 'onion' ? 1.28 : A.sh === 'pear' ? 1.0 : 1.0);
      if (A.sh === 'onion') path(g, line([[0, topV - 0.02], [0.01, topV + 0.06]]), 'none', { stroke: '#c9a07a', w: sw * 2.4 });
      if (A.stem) path(g, curve([[0, topV - 0.03], [0.01, topV + 0.06], [0.05, topV + 0.1]]), 'none', { stroke: '#6b4a2a', w: w * 0.03 });
      if (A.leaf) leafAt(g, 0.03, topV + 0.06, 0.24, 20);
      if (A.crown === 1) { path(g, soft([[-0.08, topV - 0.02], [-0.1, topV + 0.06], [-0.04, topV + 0.04], [0, topV + 0.08], [0.04, topV + 0.04], [0.1, topV + 0.06], [0.08, topV - 0.02]]), grad(A.col), { stroke: edge(A.col, 0.5) }); }
      if (A.crown === 2) sepals(0, topV - 0.01, 0.13, '#5a6e2a');
      if (A.crown === 3) sepals(0, topV - 0.01, A.sh === 'heart' ? 0.16 : 0.12);
    } else if ((A.b === 'round' || A.b === 'pumpkin') && cut) {
      // sliced through the middle: the skin round the edge, the flesh, and what is inside
      const rx = 0.48, ry = Math.min(0.48, A.asp * 0.48), ccy = ry; shadow(-0.44, 0.44);
      const sh = ['apple', 'pear', 'heart', 'mango', 'lemon', 'onion'].includes(A.sh) ? A.sh : 'round';
      const body = outline(sh, rx, ry, 0, ccy);
      const fl = A.flesh;
      path(g, body, A.cut === 'hollow' ? '#6e4a2b' : A.cut === 'melon' ? '#3d8a36' : A.col, { stroke: edge(A.col, 0.5) });
      const inner = outline(sh, rx - (A.cut === 'hollow' ? 0.05 : A.cut === 'melon' ? 0.035 : 0.016), ry - (A.cut === 'hollow' ? 0.05 : A.cut === 'melon' ? 0.035 : 0.016), 0, ccy);
      if (A.cut === 'segments') { path(g, inner, '#fbf3df'); const cl = clipTo(g, inner); for (let i = 0; i < 10; i++) { const a0 = i * 36 * Math.PI / 180 + 0.06, a1 = (i + 1) * 36 * Math.PI / 180 - 0.06, rr = rx - 0.04; path(cl, soft([[Math.cos(a0) * 0.04, ccy + Math.sin(a0) * 0.04], [Math.cos(a0) * rr, ccy + Math.sin(a0) * rr * ry / rx], [Math.cos((a0 + a1) / 2) * (rr + 0.01), ccy + Math.sin((a0 + a1) / 2) * (rr + 0.01) * ry / rx], [Math.cos(a1) * rr, ccy + Math.sin(a1) * rr * ry / rx], [Math.cos(a1) * 0.04, ccy + Math.sin(a1) * 0.04]]), grad(fl, { cx: 0.5, cy: 0.5, l: 0.2, d: 0.15 }), { stroke: lite(fl, 0.4), w: sw * 0.7 }); } path(g, circ(0, ccy, 0.035), '#fbf3df'); }
      else if (A.cut === 'melon') { path(g, inner, '#f3f6e2'); const in2 = outline(sh, rx - 0.06, ry - 0.06, 0, ccy); path(g, in2, grad(fl, { cx: 0.5, cy: 0.5, l: 0.15, d: 0.12 })); for (let i = 0; i < 18; i++) { const a = i / 18 * Math.PI * 2, r = 0.22 + (i % 2) * 0.08; path(g, oval(Math.cos(a) * r, ccy + Math.sin(a) * r * ry / rx, 0.012, 0.022, a * 57.3 + 90), '#1d1a18'); } }
      else {
        path(g, inner, grad(fl, { cx: 0.5, cy: 0.48, l: 0.18, d: A.cut === 'hollow' ? 0.05 : 0.14 }));
        if (A.rim) path(g, outline(sh, rx - 0.03, ry - 0.03, 0, ccy), 'none', { stroke: A.rim, w: w * 0.03, op: 0.8 });
        if (A.cut === 'core') { path(g, soft([[0, ccy + ry * 0.45], [0.07, ccy + 0.08], [0.09, ccy - 0.04], [0.03, ccy - ry * 0.5], [-0.03, ccy - ry * 0.5], [-0.09, ccy - 0.04], [-0.07, ccy + 0.08]]), lite(fl, 0.3), { stroke: kitDark(fl, 0.15) }); [-0.032, 0.032].forEach((u) => path(g, oval(u, ccy, 0.022, 0.038, u > 0 ? 15 : -15), '#4a2a18')); path(g, line([[0, ccy + ry * 0.45], [0, ccy + ry * 0.98]]), 'none', { stroke: kitDark(fl, 0.2), w: sw }); }
        if (A.cut === 'pit') { const big = kind === 'avocado' ? 0.19 : kind === 'mango' ? 0.3 : 0.17; path(g, oval(0, ccy - (kind === 'avocado' ? 0.07 : 0), big * (kind === 'mango' ? 1.2 : 1), big * (kind === 'mango' ? 0.55 : 1.1)), grad(A.pit, { l: 0.3, d: 0.3 }), { stroke: edge(A.pit, 0.4) }); if (kind === 'peach') for (let i = 0; i < 6; i++) path(g, curve([[-0.1, ccy - 0.12 + i * 0.045], [0, ccy - 0.1 + i * 0.045], [0.1, ccy - 0.12 + i * 0.045]]), 'none', { stroke: edge(A.pit, 0.4), w: sw * 0.8 }); if (kind === 'peach') path(g, circ(0, ccy, 0.2), 'none', { stroke: '#e05a3a', w: w * 0.03, op: 0.4 }); }
        if (A.cut === 'kiwi') { path(g, oval(0, ccy, 0.11, 0.08), '#f4f6d8'); for (let i = 0; i < 36; i++) { const a = i / 36 * Math.PI * 2; path(g, line([[Math.cos(a) * 0.12, ccy + Math.sin(a) * 0.09], [Math.cos(a) * 0.38, ccy + Math.sin(a) * 0.38 * ry / rx]]), 'none', { stroke: '#c9e58a', w: sw * 0.6, op: 0.7 }); path(g, oval(Math.cos(a) * 0.15, ccy + Math.sin(a) * 0.115, 0.008, 0.014, a * 57.3 + 90), '#1d1a14'); } }
        if (A.cut === 'arils') { for (let i = 0; i < 70; i++) { const a = R() * Math.PI * 2, r = Math.sqrt(R()) * 0.38; const u = Math.cos(a) * r, v = ccy + Math.sin(a) * r * ry / rx; path(g, circ(u, v, 0.03), grad('#c8102e', { l: 0.45, d: 0.25 })); } }
        if (A.cut === 'hollow') { path(g, outline(sh, rx - 0.12, ry - 0.12, 0, ccy), '#f4efe3', { stroke: '#e1d9c6' }); }
        if (A.cut === 'seeds') { path(g, oval(0, ccy, 0.2, 0.16 * ry / rx * 1.2), kind === 'papaya' ? '#e0632a' : '#f1c27a'); for (let i = 0; i < 40; i++) { const a = R() * Math.PI * 2, r = Math.sqrt(R()) * 0.15; path(g, oval(Math.cos(a) * r * 1.2, ccy + Math.sin(a) * r * ry / rx, 0.018, 0.014), kind === 'papaya' ? '#1c1714' : A.seed); } }
        if (A.cut === 'dots') { let d = ''; for (let i = 0; i < 140; i++) { const a = R() * Math.PI * 2, r = Math.sqrt(R()) * 0.42; d += circ(Math.cos(a) * r, ccy + Math.sin(a) * r * ry / rx, 0.006); } path(g, d, '#1a1614'); }
        if (A.cut === 'star') { for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; path(g, soft([[0, ccy], [Math.cos(a - 0.12) * 0.12, ccy + Math.sin(a - 0.12) * 0.1], [Math.cos(a) * 0.2, ccy + Math.sin(a) * 0.17], [Math.cos(a + 0.12) * 0.12, ccy + Math.sin(a + 0.12) * 0.1]]), lite(fl, 0.4), { op: 0.8 }); } }
        if (A.cut === 'berry') { path(g, outline('heart', 0.22, ry * 0.55, 0, ccy + 0.02), '#fbe3e0', { op: 0.9 }); for (let i = 0; i < 14; i++) { const a = i / 14 * Math.PI * 2; path(g, line([[Math.cos(a) * 0.1, ccy + Math.sin(a) * 0.08], [Math.cos(a) * 0.38, ccy + Math.sin(a) * 0.36]]), 'none', { stroke: '#fbe3e0', w: sw * 0.7, op: 0.6 }); } sepals(0, ccy + ry * 0.95, 0.14); }
        if (A.cut === 'tomato') { [0, 1, 2, 3].forEach((i) => { const a = i * Math.PI / 2 + 0.78; path(g, oval(Math.cos(a) * 0.2, ccy + Math.sin(a) * 0.18, 0.13, 0.1, a * 57.3), '#f6a08a'); for (let j = 0; j < 5; j++) path(g, oval(Math.cos(a) * 0.2 + (R() - 0.5) * 0.1, ccy + Math.sin(a) * 0.18 + (R() - 0.5) * 0.08, 0.012, 0.018), '#f8e07a'); }); path(g, circ(0, ccy, 0.08), lite(fl, 0.3)); }
        if (A.cut === 'rings') { for (let i = 1; i < 7; i++) path(g, outline('onion', rx - i * 0.065, (ry - i * 0.065), 0, ccy - i * 0.01), 'none', { stroke: '#c56d93', w: sw * 0.9, op: 0.8 }); }
        if (A.cut === 'plain') { let d = ''; for (let i = 0; i < 20; i++) d += circ((R() - 0.5) * 0.7, ccy + (R() - 0.5) * 0.6 * ry / rx, 0.006); path(g, d, kitDark(fl, 0.1), { op: 0.5 }); }
        if (A.cut === 'pumpkin') { path(g, oval(0, ccy, 0.22, 0.16), '#f7c46a'); for (let i = 0; i < 16; i++) path(g, oval((R() - 0.5) * 0.3, ccy + (R() - 0.5) * 0.2, 0.025, 0.014, R() * 180), '#f7ecd0', { stroke: '#d9c49a', w: sw * 0.5 }); }
      }
      shine(g, -0.22, ccy + ry * 0.5, 0.09, 0.035, -25, 0.35);
    } else if (A.b === 'long') {
      if (cut) { // slices
        shadow(-0.45, 0.45);
        [-0.28, 0, 0.28].forEach((u, i) => { const v = 0.15 + (i === 1 ? 0.04 : 0); path(g, oval(u, v, 0.15, 0.12), A.col, { stroke: edge(A.col, 0.4) }); path(g, oval(u, v + 0.005, 0.135, 0.105), grad(A.flesh, { cx: 0.5, cy: 0.5, l: 0.15, d: 0.1 })); if (A.cut === 'cucumber') { path(g, oval(u, v + 0.005, 0.07, 0.055), lite(A.flesh, 0.25)); for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; path(g, oval(u + Math.cos(a) * 0.045, v + 0.005 + Math.sin(a) * 0.035, 0.008, 0.013, a * 57.3), '#f6f9e8', { stroke: '#b9cf8a', w: sw * 0.5 }); } } else { let d = ''; for (let k = 0; k < 10; k++) d += circ(u + (R() - 0.5) * 0.18, v + (R() - 0.5) * 0.14, 0.006); path(g, d, kitDark(A.flesh, 0.25), { op: 0.6 }); } });
      } else {
        const L = 0.46, H0 = A.asp / 2, bend = kind === 'chili' ? 0.1 : kind === 'cucumber' || kind === 'zucchini' ? 0.025 : 0.05; shadow(-0.42, 0.42);
        const rad = (t) => { const e = Math.sin(Math.PI * t); if (A.bulb) return H0 * (0.35 + 0.65 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 0.8 + 0.15)), 0.8)) * (t < 0.12 ? 0.6 + t * 3.3 : 1); if (A.taper === 2) return H0 * (t < 0.15 ? 0.85 : (1 - t) * 1.05) ; if (A.taper) return H0 * Math.pow(e, 0.7); return H0 * Math.pow(e, 0.18); };
        const ctr = (t) => [-L + 2 * L * t, H0 + bend * Math.sin(Math.PI * t) * 2 - bend];
        const upper = [], lower = []; for (let i = 0; i <= 40; i++) { const t = i / 40, [u, v] = ctr(t), r = Math.max(0.004, rad(t)); upper.push([u, v + r]); lower.push([u, v - r]); }
        const body = soft([...upper, ...lower.reverse()]);
        path(g, body, lin([[0, lite(A.col, 0.35)], [0.45, A.col], [1, edge(A.col, 0.35)]]), { stroke: edge(A.col, 0.5) });
        surface(body, L, H0, 0, H0);
        path(g, curve(upper.slice(6, 34).map(([u, v]) => [u, v - H0 * 0.35])), 'none', { stroke: '#ffffff', w: w * A.asp * 0.08, op: 0.35 });
        if (kind === 'eggplant' || kind === 'chili' || kind === 'zucchini' || kind === 'cucumber') { const [u, v] = ctr(0); const c = '#4f7a2a'; path(g, soft([[u - 0.02, v + rad(0.04) * 1.1], [u + 0.08, v + rad(0.1) * 0.9], [u + 0.06, v], [u + 0.09, v - rad(0.1) * 0.9], [u - 0.02, v - rad(0.04)]]), grad(c), { stroke: edge(c, 0.4) }); path(g, curve([[u, v], [u - 0.06, v + 0.02], [u - 0.09, v + 0.06]]), 'none', { stroke: c, w: w * 0.025 }); }
        if (kind === 'sweetpotato') { const [u, v] = ctr(1); path(g, line([[u, v], [u + 0.05, v - 0.01]]), 'none', { stroke: edge(A.col, 0.3), w: sw }); }
      }
    } else if (A.b === 'banana') {
      shadow(-0.44, 0.4); const c = A.col;
      const outer = [[-0.46, 0.38], [-0.3, 0.18], [-0.05, 0.08], [0.2, 0.1], [0.4, 0.22], [0.47, 0.34]], inner = [[0.44, 0.38], [0.3, 0.3], [0.1, 0.24], [-0.12, 0.25], [-0.3, 0.33], [-0.42, 0.45]];
      path(g, soft([...outer, ...inner]), lin([[0, lite(c, 0.35)], [0.6, c], [1, kitDark(c, 0.2)]]), { stroke: edge(c, 0.45) });
      path(g, curve([[-0.42, 0.4], [-0.1, 0.17], [0.2, 0.17], [0.43, 0.3]]), 'none', { stroke: kitDark(c, 0.15), w: sw, op: 0.7 });
      path(g, soft([[0.42, 0.33], [0.5, 0.36], [0.5, 0.42], [0.44, 0.4]]), '#3a2a1a'); path(g, soft([[-0.45, 0.4], [-0.52, 0.48], [-0.5, 0.52], [-0.43, 0.47]]), '#7a8a3a', { stroke: '#4a5a2a' });
      let d = ''; for (let i = 0; i < 6; i++) d += circ(-0.2 + R() * 0.45, 0.17 + R() * 0.06, 0.008); path(g, d, '#6b4a2a', { op: 0.5 });
    } else if (A.b === 'grapes' || A.b === 'cherries' || A.b === 'berries' || A.b === 'drupe') {
      const c = A.col; shadow(-0.4, 0.4);
      const ball = (u, v, r, cc = c) => { path(g, circ(u, v, r), grad(cc, { cx: 0.35, cy: 0.3, l: 0.4, d: 0.35 }), { stroke: edge(cc, 0.5), w: sw * 0.8 }); shine(g, u - r * 0.35, v + r * 0.4, r * 0.25, r * 0.15, -30, 0.6); };
      if (A.b === 'grapes') { const rr = 0.085, rows = [[0, 5], [1, 5], [2, 4], [3, 4], [4, 3], [5, 2], [6, 1]]; path(g, curve([[0, 1.18], [0.02, 1.08], [0.0, 1.0]]), 'none', { stroke: '#6b4a2a', w: w * 0.025 }); leafAt(g, 0.02, 1.08, 0.3, 25, '#5c9e35'); rows.forEach(([ri, n]) => { for (let i = 0; i < n; i++) ball((i - (n - 1) / 2) * rr * 1.75 + (ri % 2 ? 0.02 : -0.02), 1.0 - ri * rr * 1.45 - rr, rr); }); }
      if (A.b === 'cherries') { [[-0.17, 0.2], [0.16, 0.17]].forEach(([u, v]) => { path(g, curve([[u, v + 0.15], [u * 0.5, 0.65], [0.02, 1.0]]), 'none', { stroke: '#5a7a2a', w: w * 0.02 }); }); leafAt(g, 0.02, 0.98, 0.3, -20, '#4f8a30'); ball(-0.17, 0.2, 0.18); ball(0.16, 0.17, 0.17); }
      if (A.b === 'berries') { [[-0.22, 0.18, 0.17], [0.2, 0.17, 0.16], [0, 0.36, 0.17]].forEach(([u, v, r]) => { ball(u, v, r); const st = [u + r * 0.2, v + r * 0.4]; for (let k = 0; k < 5; k++) { const a = k * 1.256; path(g, line([[st[0], st[1]], [st[0] + Math.cos(a) * r * 0.2, st[1] + Math.sin(a) * r * 0.15]]), 'none', { stroke: '#1f2a52', w: sw }); } }); leafAt(g, 0.2, 0.5, 0.24, 30, '#4f8a30'); }
      if (A.b === 'drupe') { const rr = 0.055; for (let ri = 0; ri < 8; ri++) { const v = 0.08 + ri * 0.1, half = 0.33 * Math.sin(Math.PI * (0.12 + ri / 8.5)), n = Math.max(1, Math.round(half * 2 / (rr * 1.7))); for (let i = 0; i < n; i++) ball(-half + (i + 0.5) * (half * 2 / n), v + rr, rr); } if (kind === 'raspberry') sepals(0, A.asp - 0.02, 0.11); else path(g, curve([[0, A.asp - 0.02], [0.02, A.asp + 0.06]]), 'none', { stroke: '#5a7a2a', w: w * 0.025 }); }
    } else if (A.b === 'pineapple') {
      shadow(-0.38, 0.38); const c = A.col, by = 0.55, ry = 0.5;
      const body = soft([[-0.36, by], [-0.33, by + ry * 0.6], [-0.2, by + ry * 0.95], [0.2, by + ry * 0.95], [0.33, by + ry * 0.6], [0.36, by], [0.33, by - ry * 0.6], [0.2, by - ry * 0.95], [-0.2, by - ry * 0.95], [-0.33, by - ry * 0.6]]);
      path(g, body, grad(c, { cx: 0.38, cy: 0.38 }), { stroke: edge(c, 0.5) });
      const cl = clipTo(g, body); for (let i = -8; i <= 8; i++) { path(cl, line([[i * 0.09 - 0.5, by - 0.6], [i * 0.09 + 0.5, by + 0.6]]), 'none', { stroke: edge(c, 0.4), w: sw * 1.1 }); path(cl, line([[i * 0.09 + 0.5, by - 0.6], [i * 0.09 - 0.5, by + 0.6]]), 'none', { stroke: edge(c, 0.4), w: sw * 1.1 }); }
      let d = ''; for (let i = -8; i <= 8; i++) for (let j = -8; j <= 8; j++) d += circ(i * 0.09, by + j * 0.09 + (i % 2) * 0.045, 0.01); path(cl, d, '#6b4a1a', { op: 0.7 });
      for (let i = 0; i < 9; i++) { const a = 90 + (i - 4) * 16, len = 0.5 - Math.abs(i - 4) * 0.06; leafAt(g, (i - 4) * 0.015, by + ry * 0.92, len, a, i % 2 ? '#4f8a30' : '#3f7a2a', 0.3); }
    } else if (A.b === 'carrot') {
      shadow(-0.2, 0.25); const c = A.col;
      for (let i = 0; i < 7; i++) { const a = (i - 3) * 0.17; path(g, curve([[0, 0.95], [Math.sin(a) * 0.25, 1.25], [Math.sin(a) * 0.4, 1.6]]), 'none', { stroke: i % 2 ? '#4f9a35' : '#3f7a2a', w: w * 0.04 }); for (let k = 1; k < 4; k++) { const v = 1.05 + k * 0.15, u = Math.sin(a) * (0.25 + k * 0.05); leafAt(g, u, v, 0.1, 90 + a * 57 + 40, '#5aa83a'); leafAt(g, u, v, 0.1, 90 + a * 57 - 40, '#5aa83a'); } }
      path(g, soft([[-0.16, 0.98], [0.16, 0.98], [0.13, 0.7], [0.06, 0.3], [0.02, 0.04], [-0.01, 0.04], [-0.07, 0.35], [-0.13, 0.7]]), lin([[0, lite(c, 0.3)], [0.5, c], [1, edge(c, 0.3)]], 0, 0, 1, 0), { stroke: edge(c, 0.45) });
      for (let i = 0; i < 9; i++) { const v = 0.25 + i * 0.08, hw = 0.04 + i * 0.012; path(g, curve([[-hw, v], [0, v - 0.01], [hw * 0.6, v + 0.005]]), 'none', { stroke: edge(c, 0.3), w: sw * 0.8, op: 0.7 }); }
    } else if (A.b === 'corn') {
      shadow(-0.46, 0.46); const c = A.col, cyv = A.asp / 2;
      [[1, '#8fb84a'], [-1, '#7aa83a']].forEach(([sd, hc]) => path(g, soft([[-0.46, cyv], [-0.2, cyv + sd * 0.13], [0.2, cyv + sd * 0.14], [0.46, cyv + sd * 0.05], [0.1, cyv + sd * 0.05], [-0.3, cyv]]), grad(hc), { stroke: edge(hc, 0.4) }));
      const cob = soft([[-0.34, cyv], [-0.25, cyv + 0.11], [0.2, cyv + 0.12], [0.42, cyv + 0.04], [0.42, cyv - 0.04], [0.2, cyv - 0.12], [-0.25, cyv - 0.11]]);
      path(g, cob, grad(c, { cx: 0.4, cy: 0.35 }), { stroke: edge(c, 0.45) }); const cl = clipTo(g, cob);
      for (let i = 0; i < 22; i++) for (let j = -4; j <= 4; j++) { const u = -0.32 + i * 0.035, v = cyv + j * 0.028 + (i % 2) * 0.014; path(cl, oval(u, v, 0.016, 0.012), grad(c, { l: 0.5, d: 0.2 }), { stroke: edge(c, 0.3), w: sw * 0.5 }); }
      path(g, soft([[-0.46, cyv], [-0.32, cyv - 0.13], [0.1, cyv - 0.16], [0.3, cyv - 0.1], [0.0, cyv - 0.08], [-0.3, cyv - 0.02]]), grad('#9cc45a'), { stroke: '#6f9a3a' });
    } else if (A.b === 'pepper') {
      shadow(-0.4, 0.4); const c = A.col;
      const body = soft([[-0.36, 0.72], [-0.42, 0.5], [-0.36, 0.2], [-0.2, 0.04], [-0.05, 0.08], [0, 0.03], [0.06, 0.08], [0.2, 0.04], [0.36, 0.2], [0.42, 0.5], [0.36, 0.72], [0.2, 0.82], [0, 0.78], [-0.2, 0.82]]);
      path(g, body, grad(c, { cx: 0.38, cy: 0.3 }), { stroke: edge(c, 0.5) });
      [-0.14, 0.14].forEach((u) => path(g, curve([[u, 0.78], [u * 1.3, 0.45], [u * 0.8, 0.1]]), 'none', { stroke: edge(c, 0.3), w: sw * 1.4, op: 0.5 }));
      shine(g, -0.22, 0.6, 0.06, 0.16, -10, 0.5); shine(g, 0.2, 0.62, 0.04, 0.1, -10, 0.35);
      path(g, soft([[-0.1, 0.8], [0.1, 0.8], [0.05, 0.86], [-0.05, 0.86]]), '#3f7a2a', { stroke: '#2a5a1a' }); path(g, curve([[0, 0.85], [0.02, 0.95], [0.08, 1.0]]), 'none', { stroke: '#4f8a30', w: w * 0.045 });
    } else if (A.b === 'pumpkin') {
      shadow(-0.46, 0.46); const c = A.col, cyv = A.asp * 0.48;
      [[-0.3, 0.17], [0.3, 0.17], [-0.17, 0.2], [0.17, 0.2], [0, 0.22]].forEach(([u, rw], i) => { path(g, oval(u, cyv, rw, cyv * 0.98), grad(c, { cx: 0.4, cy: 0.35, d: 0.3 }), { stroke: edge(c, 0.45) }); });
      path(g, curve([[0, cyv * 1.9], [0.02, cyv * 2.15], [0.08, cyv * 2.25]]), 'none', { stroke: '#6b5a2a', w: w * 0.06 }); leafAt(g, 0.06, cyv * 2.1, 0.25, 15, '#5c9e35');
    } else if (A.b === 'cabbage' || A.b === 'lettuce') {
      shadow(-0.45, 0.45); const c = A.col, cyv = A.asp * 0.48, lettuce = A.b === 'lettuce';
      for (let i = 0; i < 7; i++) { const a = i / 7 * Math.PI * 2 + 0.3, u = Math.cos(a) * 0.22, v = cyv + Math.sin(a) * 0.16; const pts = []; for (let k = 0; k < 20; k++) { const t = k / 20 * Math.PI * 2, r = 0.24 * (1 + (lettuce ? 0.08 * Math.sin(t * 9) : 0.02 * Math.sin(t * 3))); pts.push([u + Math.cos(t) * r, v + Math.sin(t) * r * 0.9]); } path(g, soft(pts), grad(kitDark(c, 0.08), { cx: 0.5, cy: 0.4 }), { stroke: edge(c, 0.45) }); path(g, curve([[u, v - 0.18], [u + Math.cos(a) * 0.05, v], [u + Math.cos(a) * 0.12, v + 0.12]]), 'none', { stroke: lite(c, 0.5), w: sw * 1.4, op: 0.8 }); }
      path(g, circ(0, cyv + 0.02, 0.27), grad(lite(c, 0.15), { cx: 0.42, cy: 0.35 }), { stroke: edge(c, 0.4) });
      for (let i = 0; i < 5; i++) { const a = -0.8 + i * 0.4; path(g, curve([[0, cyv - 0.15], [Math.sin(a) * 0.12, cyv], [Math.sin(a) * 0.22, cyv + 0.2]]), 'none', { stroke: lite(c, 0.55), w: sw * 1.2, op: 0.8 }); }
      shine(g, -0.1, cyv + 0.18, 0.08, 0.04);
    } else if (A.b === 'greens') {
      shadow(-0.3, 0.3); const c = A.col;
      for (let i = 0; i < 6; i++) { const a = 90 + (i - 2.5) * 16; path(g, line([[0, 0.05], [Math.cos(a * Math.PI / 180) * 0.4, 0.05 + Math.sin(a * Math.PI / 180) * 0.4]]), 'none', { stroke: '#7aa84a', w: w * 0.025 }); leafAt(g, Math.cos(a * Math.PI / 180) * 0.35, 0.05 + Math.sin(a * Math.PI / 180) * 0.35, 0.55 - Math.abs(i - 2.5) * 0.05, a, c); }
      path(g, soft([[-0.05, 0.12], [0.05, 0.12], [0.05, 0.18], [-0.05, 0.18]]), '#c9a46a', { stroke: '#8a6a3a' });
    } else if (A.b === 'broccoli') {
      shadow(-0.4, 0.4); const c = A.col, white = kind === 'cauliflower';
      if (white) { for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; leafAt(g, Math.cos(a) * 0.1, 0.35, 0.42, a * 57.3, '#5f9a3a'); } }
      else path(g, soft([[-0.09, 0.05], [0.09, 0.05], [0.07, 0.4], [0.2, 0.55], [-0.2, 0.55], [-0.07, 0.4]]), grad('#9cc45a', { cx: 0.4, cy: 0.4 }), { stroke: '#6f9a3a' });
      const puffs = white ? [[-0.25, 0.5, 0.18], [0.25, 0.5, 0.18], [0, 0.55, 0.22], [-0.13, 0.7, 0.17], [0.14, 0.7, 0.17]] : [[-0.27, 0.62, 0.17], [0.27, 0.62, 0.17], [0, 0.68, 0.2], [-0.15, 0.85, 0.17], [0.15, 0.85, 0.17]];
      puffs.forEach(([u, v, r]) => { path(g, circ(u, v, r), grad(c, { cx: 0.38, cy: 0.32, l: 0.25, d: 0.35 }), { stroke: edge(c, 0.4) }); let d = ''; for (let k = 0; k < 16; k++) { const a = R() * Math.PI * 2, rr = Math.sqrt(R()) * r * 0.85; d += circ(u + Math.cos(a) * rr, v + Math.sin(a) * rr, r * 0.16); } path(g, d, lite(c, 0.25), { op: 0.45 }); });
    } else if (A.b === 'mushroom') {
      shadow(-0.42, 0.42); const c = A.col;
      path(g, soft([[-0.1, 0.03], [0.1, 0.03], [0.12, 0.3], [0.13, 0.45], [-0.13, 0.45], [-0.12, 0.3]]), grad('#f2ead8', { cx: 0.4, cy: 0.5 }), { stroke: '#c9b89a' });
      path(g, soft([[-0.46, 0.45], [-0.4, 0.68], [-0.2, 0.86], [0.2, 0.86], [0.4, 0.68], [0.46, 0.45], [0.2, 0.4], [-0.2, 0.4]]), grad(c, { cx: 0.38, cy: 0.25 }), { stroke: edge(c, 0.45) });
      path(g, curve([[-0.42, 0.46], [0, 0.4], [0.42, 0.46]]), 'none', { stroke: '#e9dcc2', w: w * 0.03 }); shine(g, -0.15, 0.74, 0.12, 0.05, -10, 0.4);
    } else if (A.b === 'peas') {
      shadow(-0.46, 0.46); const c = A.col;
      path(g, soft([[-0.47, 0.22], [-0.3, 0.06], [0, 0.03], [0.3, 0.06], [0.47, 0.2], [0.3, 0.16], [0, 0.14], [-0.3, 0.16]]), grad(kitDark(c, 0.1)), { stroke: edge(c, 0.45) });
      for (let i = 0; i < 6; i++) { const u = -0.3 + i * 0.12; path(g, circ(u, 0.19 - Math.abs(u) * 0.1, 0.07), grad(c, { l: 0.4 }), { stroke: edge(c, 0.4), w: sw * 0.7 }); }
      path(g, soft([[-0.47, 0.24], [-0.3, 0.3], [0, 0.32], [0.3, 0.3], [0.47, 0.22], [0.3, 0.26], [0, 0.26], [-0.3, 0.26]]), grad(lite(c, 0.1)), { stroke: edge(c, 0.45) });
      path(g, curve([[0.46, 0.21], [0.52, 0.27], [0.5, 0.33]]), 'none', { stroke: '#5a8a2a', w: w * 0.02 });
    } else if (A.b === 'garlic') {
      shadow(-0.4, 0.4); const c = A.col;
      [-0.22, 0.22, -0.11, 0.11, 0].forEach((u) => path(g, soft([[u, 0.04], [u + 0.16, 0.2], [u + 0.14, 0.55], [u * 0.3, 0.92], [u - 0.14, 0.55], [u - 0.16, 0.2]]), grad(u === 0 ? c : kitDark(c, 0.04), { cx: 0.4, cy: 0.4 }), { stroke: '#b9ad9e' }));
      for (let i = -2; i <= 2; i++) path(g, curve([[i * 0.08, 0.06], [i * 0.14, 0.4], [i * 0.03, 0.88]]), 'none', { stroke: '#c9a0b8', w: sw * 0.8, op: 0.7 });
      path(g, line([[0, 0.9], [0.02, 1.02]]), 'none', { stroke: '#c9b89a', w: w * 0.03 });
    } else if (A.b === 'root') {
      shadow(-0.3, 0.3); const c = A.col, beet = kind === 'beet';
      for (let i = 0; i < 5; i++) { const a = 90 + (i - 2) * 22; const a2 = a * Math.PI / 180; path(g, line([[0, 0.55], [Math.cos(a2) * 0.35, 0.55 + Math.sin(a2) * 0.5]]), 'none', { stroke: beet ? '#a8304f' : '#8fbf5a', w: w * 0.025 }); leafAt(g, Math.cos(a2) * 0.3, 0.55 + Math.sin(a2) * 0.42, 0.45, a, beet ? '#4f8a3a' : '#5fa83a'); }
      path(g, line([[0, 0.12], [0.02, 0.0]]), 'none', { stroke: edge(c, 0.2), w: sw * 1.4 });
      path(g, soft([[0, 0.08], [0.25, 0.25], [0.3, 0.4], [0.2, 0.56], [-0.2, 0.56], [-0.3, 0.4], [-0.25, 0.25]]), grad(c, { cx: 0.38, cy: 0.3 }), { stroke: edge(c, 0.5) }); shine(g, -0.13, 0.42, 0.07, 0.04);
      if (!beet) path(g, soft([[-0.2, 0.2], [0, 0.1], [0.2, 0.2], [0.18, 0.12], [0, 0.07], [-0.18, 0.12]]), '#fbeef0', { op: 0.8 });
    } else if (A.b === 'celery') {
      shadow(-0.25, 0.25); const c = A.col;
      for (let i = -3; i <= 3; i++) { const u = i * 0.06; path(g, soft([[u - 0.04, 0.02], [u + 0.04, 0.02], [u + 0.035 + i * 0.01, 1.2], [u - 0.035 + i * 0.01, 1.2]]), lin([[0, lite(c, 0.3)], [0.5, c], [1, edge(c, 0.25)]], 0, 0, 1, 0), { stroke: edge(c, 0.4) }); path(g, line([[u, 0.05], [u + i * 0.008, 1.15]]), 'none', { stroke: lite(c, 0.5), w: sw * 0.7 }); }
      for (let i = 0; i < 8; i++) leafAt(g, (i - 3.5) * 0.06, 1.2, 0.3, 90 + (i - 3.5) * 20, '#5aa83a');
    } else if (A.b === 'loaf') {
      shadow(-0.48, 0.48); const c = A.col;
      path(g, soft([[-0.48, 0.03], [-0.47, 0.25], [-0.35, 0.45], [0, 0.53], [0.35, 0.45], [0.47, 0.25], [0.48, 0.03]]), grad(c, { cx: 0.4, cy: 0.25, l: 0.25 }), { stroke: edge(c, 0.45) });
      [-0.28, -0.08, 0.12, 0.32].forEach((u) => path(g, soft([[u - 0.06, 0.38], [u + 0.08, 0.5], [u + 0.09, 0.47], [u - 0.04, 0.35]]), '#f3d39a', { stroke: kitDark('#f3d39a', 0.2) }));
      shine(g, -0.2, 0.4, 0.15, 0.04, -8, 0.3);
    } else if (A.b === 'toast') {
      shadow(-0.45, 0.45); const c = A.col;
      const sl = soft([[-0.42, 0.03], [0.42, 0.03], [0.43, 0.68], [0.46, 0.82], [0.32, 0.96], [0, 0.94], [-0.32, 0.96], [-0.46, 0.82], [-0.43, 0.68]]);
      path(g, sl, kitDark(c, 0.25), { stroke: edge(c, 0.5) }); path(g, soft([[-0.36, 0.08], [0.36, 0.08], [0.37, 0.66], [0.39, 0.78], [0.28, 0.89], [0, 0.87], [-0.28, 0.89], [-0.39, 0.78], [-0.37, 0.66]]), grad(c, { cx: 0.5, cy: 0.5, l: 0.3, d: 0.1 }));
      let d = ''; for (let i = 0; i < 40; i++) d += circ((R() - 0.5) * 0.7, 0.1 + R() * 0.75, 0.008); path(g, d, kitDark(c, 0.2), { op: 0.4 });
      path(g, soft([[-0.12, 0.42], [0.12, 0.44], [0.13, 0.58], [-0.11, 0.6]]), grad('#f8e08a', { l: 0.4 }), { stroke: '#d9b84a' });
    } else if (A.b === 'croissant') {
      shadow(-0.46, 0.46); const c = A.col;
      [[-0.36, 0.17, 0.12, 0.1, -40], [0.36, 0.17, 0.12, 0.1, 40], [-0.22, 0.26, 0.15, 0.15, -20], [0.22, 0.26, 0.15, 0.15, 20], [0, 0.32, 0.2, 0.2, 0]].forEach(([u, v, rx, ry, rot]) => { path(g, oval(u, v, rx, ry, rot), grad(c, { cx: 0.4, cy: 0.3, l: 0.3, d: 0.35 }), { stroke: edge(c, 0.45) }); path(g, curve([[u - rx * 0.6, v + ry * 0.4], [u, v + ry * 0.8], [u + rx * 0.6, v + ry * 0.4]]), 'none', { stroke: kitDark(c, 0.25), w: sw, op: 0.7 }); });
      shine(g, -0.05, 0.45, 0.1, 0.04, -10, 0.35);
    } else if (A.b === 'pancakes' || A.b === 'egg' || A.b === 'steak' || A.b === 'bacon' || A.b === 'sausage' || A.b === 'roast' || A.b === 'drumstick' || A.b === 'salmon' || A.b === 'waffle') {
      const plate = A.b === 'pancakes' || A.b === 'egg' || A.b === 'steak' || A.b === 'roast';
      shadow(-0.48, 0.48);
      if (plate) { path(g, oval(0, 0.07, 0.48, 0.07), '#e9edf0', { stroke: '#b9c1c8' }); path(g, oval(0, 0.08, 0.36, 0.045), '#f8fafb'); }
      const c = A.col;
      if (A.b === 'pancakes') { for (let i = 0; i < 5; i++) { const v = 0.1 + i * 0.1; path(g, soft([[-0.34, v], [-0.33, v + 0.06], [0, v + 0.1], [0.33, v + 0.06], [0.34, v], [0, v - 0.04]]), grad(c, { cx: 0.5, cy: 0.3, l: 0.25, d: 0.3 }), { stroke: edge(c, 0.4) }); } path(g, soft([[-0.3, 0.58], [0, 0.66], [0.3, 0.58], [0.31, 0.5], [0.2, 0.42], [0.18, 0.54], [0, 0.6], [-0.22, 0.54], [-0.25, 0.4], [-0.31, 0.5]]), '#b9651a', { op: 0.8 }); path(g, soft([[-0.08, 0.62], [0.08, 0.63], [0.07, 0.72], [-0.07, 0.71]]), '#f8e08a', { stroke: '#d9b84a' }); }
      if (A.b === 'egg') { path(g, soft([[-0.4, 0.12], [-0.38, 0.28], [-0.15, 0.38], [0.15, 0.36], [0.4, 0.3], [0.42, 0.14], [0.1, 0.08], [-0.2, 0.08]]), grad(c, { l: 0.1, d: 0.1 }), { stroke: '#d9d2c2' }); path(g, oval(0.0, 0.24, 0.13, 0.1), grad('#f6a21e', { cx: 0.38, cy: 0.3, l: 0.45, d: 0.25 }), { stroke: '#d97a12' }); shine(g, -0.04, 0.27, 0.04, 0.025, -20, 0.7); }
      if (A.b === 'steak') { path(g, soft([[-0.38, 0.1], [-0.4, 0.25], [-0.2, 0.37], [0.2, 0.36], [0.38, 0.24], [0.36, 0.1], [0, 0.06]]), grad(c, { l: 0.2, d: 0.35 }), { stroke: edge(c, 0.45) }); for (let i = 0; i < 4; i++) path(g, line([[-0.3 + i * 0.16, 0.12], [-0.2 + i * 0.16, 0.33]]), 'none', { stroke: '#3a1a12', w: w * 0.02, op: 0.7 }); path(g, curve([[-0.38, 0.24], [-0.2, 0.36], [0.1, 0.36]]), 'none', { stroke: '#f3e3c8', w: w * 0.02 }); }
      if (A.b === 'bacon') { [0.08, 0.2].forEach((v0, j) => { const wav = (k) => [[-0.46, v0], [-0.3, v0 + 0.06], [-0.15, v0], [0, v0 + 0.06], [0.15, v0], [0.3, v0 + 0.06], [0.46, v0]].map(([u, v]) => [u, v + k]); path(g, soft([...wav(0.1), ...wav(0).reverse()]), lin([[0, '#c8503f'], [0.35, '#f3d6c4'], [0.5, '#b8453a'], [0.75, '#f0c9b4'], [1, '#9a3a2e']]), { stroke: '#7a2a1e' }); }); }
      if (A.b === 'sausage') { [[0.12, -6], [0.3, 4]].forEach(([v, rot]) => { path(g, oval(0, v, 0.44, 0.09, rot), grad(c, { cx: 0.4, cy: 0.25, l: 0.25, d: 0.35 }), { stroke: edge(c, 0.45) }); shine(g, -0.1, v + 0.04, 0.22, 0.02, rot, 0.4); }); }
      if (A.b === 'roast') { [-1, 1].forEach((sd) => { path(g, oval(sd * 0.3, 0.2, 0.14, 0.09, sd * -20), grad(c, { l: 0.25, d: 0.35 }), { stroke: edge(c, 0.45) }); path(g, circ(sd * 0.44, 0.27, 0.035), '#f3ead8', { stroke: '#c9b89a' }); }); path(g, soft([[-0.34, 0.15], [-0.36, 0.38], [-0.15, 0.6], [0.15, 0.62], [0.36, 0.4], [0.34, 0.15], [0, 0.1]]), grad(c, { cx: 0.42, cy: 0.25, l: 0.3, d: 0.38 }), { stroke: edge(c, 0.45) }); shine(g, -0.08, 0.5, 0.14, 0.05, -15, 0.45); let d = ''; for (let i = 0; i < 30; i++) d += circ((R() - 0.5) * 0.55, 0.18 + R() * 0.38, 0.006); path(g, d, '#7a3a12', { op: 0.5 }); }
      if (A.b === 'drumstick') { path(g, soft([[0.12, 0.26], [0.34, 0.3], [0.44, 0.36], [0.47, 0.3], [0.44, 0.24], [0.34, 0.24]]), '#f3ead8', { stroke: '#c9b89a' }); path(g, circ(0.45, 0.36, 0.04), '#f3ead8', { stroke: '#c9b89a' }); path(g, circ(0.46, 0.25, 0.04), '#f3ead8', { stroke: '#c9b89a' }); path(g, soft([[-0.45, 0.2], [-0.4, 0.42], [-0.2, 0.5], [0.05, 0.42], [0.2, 0.3], [0.18, 0.22], [0.0, 0.12], [-0.3, 0.06]]), grad(c, { cx: 0.38, cy: 0.25, l: 0.3, d: 0.38 }), { stroke: edge(c, 0.45) }); shine(g, -0.22, 0.38, 0.12, 0.04, -15, 0.45); }
      if (A.b === 'salmon') { const out = soft([[-0.4, 0.06], [-0.46, 0.3], [-0.3, 0.55], [0, 0.6], [0.3, 0.55], [0.46, 0.3], [0.4, 0.06], [0.15, 0.04], [0.08, 0.25], [-0.08, 0.25], [-0.15, 0.04]]); path(g, out, '#b9c1c8', { stroke: '#7d8791' }); const inn = soft([[-0.36, 0.09], [-0.41, 0.3], [-0.27, 0.51], [0, 0.55], [0.27, 0.51], [0.41, 0.3], [0.36, 0.09], [0.17, 0.08], [0.1, 0.28], [-0.1, 0.28], [-0.17, 0.08]]); path(g, inn, grad(c, { cx: 0.5, cy: 0.4, l: 0.2, d: 0.15 })); const cl = clipTo(g, inn); for (let i = 0; i < 7; i++) path(cl, curve([[-0.5, 0.1 + i * 0.07], [0, 0.3 + i * 0.05], [0.5, 0.1 + i * 0.07]]), 'none', { stroke: '#fbe3d6', w: sw * 1.4, op: 0.8 }); }
      if (A.b === 'waffle') { const wd = soft([[-0.46, 0.18], [-0.3, 0.33], [0, 0.38], [0.3, 0.33], [0.46, 0.18], [0.3, 0.04], [0, 0.0], [-0.3, 0.04]]); path(g, wd, grad(c, { l: 0.25, d: 0.3 }), { stroke: edge(c, 0.45) }); const cl = clipTo(g, wd); for (let i = -6; i <= 6; i++) { path(cl, line([[i * 0.08 - 0.15, 0], [i * 0.08 + 0.15, 0.4]]), 'none', { stroke: kitDark(c, 0.3), w: w * 0.012 }); path(cl, line([[i * 0.08 + 0.15, 0], [i * 0.08 - 0.15, 0.4]]), 'none', { stroke: kitDark(c, 0.3), w: w * 0.012 }); } [[-0.15, 0.25, '#e0262d'], [0.1, 0.27, '#3d4f9a'], [0.22, 0.18, '#3d4f9a'], [-0.02, 0.17, '#e0262d']].forEach(([u, v, cc]) => { path(g, circ(u, v, 0.045), grad(cc, { l: 0.4 }), { stroke: edge(cc, 0.4) }); }); }
    } else if (A.b === 'bowl') {
      shadow(-0.46, 0.46); const bc = A.fill === 'rice' ? '#3f6fb8' : A.fill === 'salad' ? '#f3f1ec' : '#e8eef2';
      const rim = 0.42, fill = A.col;
      path(g, soft([[-0.46, 0.42], [-0.4, 0.2], [-0.2, 0.05], [0.2, 0.05], [0.4, 0.2], [0.46, 0.42]]), grad(bc, { cx: 0.4, cy: 0.3 }), { stroke: edge(bc, 0.4) });
      path(g, oval(0, rim, 0.46, 0.08), kitDark(bc, 0.1), { stroke: edge(bc, 0.4) });
      if (A.fill === 'rice') { path(g, soft([[-0.42, 0.43], [-0.3, 0.55], [0, 0.6], [0.3, 0.55], [0.42, 0.43], [0, 0.37]]), grad(fill, { l: 0.05, d: 0.08 }), { stroke: '#d9d4c4' }); let d = ''; for (let i = 0; i < 70; i++) d += oval((R() - 0.5) * 0.74, 0.42 + R() * 0.14, 0.012, 0.006, R() * 180); path(g, d, '#e6e1d2', { op: 0.9 }); }
      else { path(g, oval(0, rim, 0.42, 0.065), grad(fill, { cx: 0.5, cy: 0.4, l: 0.2, d: 0.15 })); }
      if (A.fill === 'noodles') { for (let i = 0; i < 9; i++) path(g, curve([[-0.36 + i * 0.07, rim - 0.04], [-0.32 + i * 0.07, rim + 0.03], [-0.36 + i * 0.08, rim + 0.06]]), 'none', { stroke: '#f8dc8a', w: w * 0.015 }); path(g, oval(0.15, rim + 0.03, 0.07, 0.04), '#fbf8ef', { stroke: '#d9d2c2' }); path(g, circ(0.15, rim + 0.03, 0.03), '#f6a21e'); [[-0.2, rim + 0.03], [-0.12, rim + 0.05], [0.0, rim + 0.02]].forEach(([u, v]) => path(g, circ(u, v, 0.016), '#5aa83a')); }
      if (A.fill === 'soup') { [[-0.2, rim], [0.1, rim + 0.02], [0.25, rim - 0.01], [-0.05, rim - 0.02]].forEach(([u, v], i) => path(g, soft([[u - 0.04, v - 0.02], [u + 0.04, v - 0.02], [u + 0.04, v + 0.03], [u - 0.04, v + 0.03]]), i % 2 ? '#7a3a22' : '#f3c46a', { stroke: '#5a2a1a', w: sw * 0.6 })); path(g, circ(0.0, rim + 0.03, 0.02), '#5aa83a'); }
      if (A.fill === 'salad') { [[-0.25, rim + 0.04, '#5aa83a'], [0.2, rim + 0.05, '#7cc04a'], [-0.05, rim + 0.07, '#3f8a2e'], [0.32, rim + 0.02, '#8bd15a']].forEach(([u, v, cc]) => leafAt(g, u, v, 0.2, 40 + u * 200, cc)); path(g, circ(0.05, rim + 0.04, 0.05), grad('#e3332a'), { stroke: '#a81d18' }); path(g, oval(-0.15, rim + 0.02, 0.05, 0.03), '#d9ecb0', { stroke: '#3f7d34' }); }
      if (A.hot) [0, 0.9, 1.8].forEach((dl, i) => steam(g, -0.12 + i * 0.12, A.fill === 'rice' ? 0.62 : 0.5, 0.25, dl));
    } else if (A.b === 'sandwich') {
      shadow(-0.46, 0.46);
      const tri = (v0, c, h) => path(g, soft([[-0.44, v0], [0.44, v0], [0.42, v0 + h], [-0.42, v0 + h]]), c, { stroke: edge(c, 0.35) });
      tri(0.03, '#e6c48a', 0.12); path(g, soft([[-0.46, 0.15], [-0.3, 0.2], [-0.1, 0.15], [0.1, 0.2], [0.3, 0.15], [0.46, 0.2], [0.44, 0.24], [-0.44, 0.24]]), '#6fbf3a', { stroke: '#3f8a2a' }); tri(0.22, '#f6c84a', 0.05); tri(0.27, '#e3332a', 0.05); tri(0.32, '#e8a09a', 0.06);
      path(g, soft([[-0.44, 0.38], [0.44, 0.38], [0.44, 0.58], [0.4, 0.64], [-0.4, 0.64], [-0.44, 0.58]]), grad('#e6c48a', { cx: 0.4, cy: 0.3 }), { stroke: '#a8743a' }); path(g, soft([[-0.39, 0.42], [0.39, 0.42], [0.39, 0.56], [0.36, 0.6], [-0.36, 0.6], [-0.39, 0.56]]), '#f6e4bd', { op: 0.8 }); // (a flat slice of bread on top, its crust round the edge: not a domed bun, which reads as a burger)
    } else if (A.b === 'burger') {
      shadow(-0.46, 0.46); const bun = '#d98c3a';
      path(g, soft([[-0.42, 0.03], [0.42, 0.03], [0.44, 0.13], [-0.44, 0.13]]), grad(bun, { l: 0.2 }), { stroke: edge(bun, 0.4) });
      path(g, soft([[-0.46, 0.15], [0.46, 0.15], [0.46, 0.28], [-0.46, 0.28]]), grad('#6b3a1e', { l: 0.2, d: 0.3 }), { stroke: '#3a1a0e' });
      path(g, soft([[-0.48, 0.27], [0.48, 0.27], [0.4, 0.33], [0.3, 0.23], [0.2, 0.33], [-0.2, 0.33], [-0.3, 0.23], [-0.4, 0.33]]), '#f6c21e', { stroke: '#d99a12' });
      path(g, soft([[-0.48, 0.34], [-0.36, 0.3], [-0.24, 0.36], [-0.12, 0.3], [0, 0.36], [0.12, 0.3], [0.24, 0.36], [0.36, 0.3], [0.48, 0.34], [0.46, 0.4], [-0.46, 0.4]]), '#6fbf3a', { stroke: '#3f8a2a' });
      path(g, soft([[-0.45, 0.4], [-0.42, 0.6], [-0.2, 0.8], [0.2, 0.8], [0.42, 0.6], [0.45, 0.4]]), grad(bun, { cx: 0.4, cy: 0.25, l: 0.3, d: 0.3 }), { stroke: edge(bun, 0.45) });
      for (let i = 0; i < 12; i++) path(g, oval(-0.3 + R() * 0.6, 0.55 + R() * 0.2, 0.018, 0.009, R() * 60 - 30), '#fbf3d8', { stroke: '#d9c49a', w: sw * 0.4 });
      shine(g, -0.15, 0.68, 0.14, 0.04, -10, 0.35);
    } else if (A.b === 'pizza') {
      shadow(-0.46, 0.46); const c = A.col;
      path(g, soft([[-0.46, 0.8], [0.46, 0.8], [0.4, 0.86], [-0.4, 0.86]]), grad('#c9873a', { l: 0.3 }), { stroke: '#8a5a2a' });
      path(g, poly3([[-0.45, 0.8], [0.45, 0.8], [0, 0.02]]), grad(c, { cx: 0.5, cy: 0.3, l: 0.25, d: 0.15 }), { stroke: '#c9973a' });
      [[0, 0.6], [-0.2, 0.66], [0.2, 0.66], [0.05, 0.35], [-0.08, 0.48], [0.12, 0.48]].forEach(([u, v]) => { path(g, circ(u, v, 0.06), grad('#b9231e', { l: 0.3 }), { stroke: '#7a1410' }); });
      path(g, soft([[-0.1, 0.25], [-0.05, 0.2], [0, 0.28]]), '#3f8a2e');
    } else if (A.b === 'taco') { // a folded shell from the side, the filling along its top
      shadow(-0.46, 0.46); const c = A.col;
      path(g, soft([[-0.44, 0.44], [-0.36, 0.52], [-0.2, 0.47], [-0.05, 0.54], [0.1, 0.47], [0.25, 0.53], [0.4, 0.46], [0.42, 0.38], [-0.42, 0.38]]), grad('#6fbf3a'), { stroke: '#3f8a2a' });
      [[-0.28, 0.46], [-0.05, 0.47], [0.2, 0.46]].forEach(([u, v]) => path(g, circ(u, v, 0.045), grad('#e3332a', { l: 0.4 }), { stroke: '#a81d18' }));
      path(g, soft([[-0.4, 0.4], [-0.1, 0.43], [0.2, 0.41], [0.4, 0.4], [0.38, 0.36], [-0.38, 0.36]]), '#7a3a1e', { stroke: '#4a200e' });
      for (let i = 0; i < 7; i++) path(g, curve([[-0.3 + i * 0.09, 0.44], [-0.27 + i * 0.09, 0.5], [-0.32 + i * 0.09, 0.52]]), 'none', { stroke: '#f6c21e', w: sw * 1.4 });
      path(g, soft([[-0.46, 0.4], [-0.43, 0.22], [-0.3, 0.08], [0, 0.03], [0.3, 0.08], [0.43, 0.22], [0.46, 0.4], [0.38, 0.37], [0.34, 0.22], [0.2, 0.12], [0, 0.1], [-0.2, 0.12], [-0.34, 0.22], [-0.38, 0.37]]), grad(c, { cx: 0.45, cy: 0.6, l: 0.3, d: 0.3 }), { stroke: edge(c, 0.4) });
      path(g, soft([[-0.38, 0.37], [-0.34, 0.22], [-0.2, 0.12], [0, 0.1], [0.2, 0.12], [0.34, 0.22], [0.38, 0.37], [0, 0.32]]), kitDark(c, 0.08), { stroke: edge(c, 0.35), op: 0.9 });
      let d = ''; for (let i = 0; i < 14; i++) d += circ(-0.36 + R() * 0.72, 0.07 + R() * 0.25, 0.01); path(g, d, kitDark(c, 0.25), { op: 0.45 });
    } else if (A.b === 'fries') {
      shadow(-0.36, 0.36);
      for (let i = 0; i < 11; i++) { const u = -0.24 + i * 0.048, h = 0.95 + R() * 0.3, a = (R() - 0.5) * 0.15; path(g, soft([[u - 0.025, 0.5], [u + 0.025, 0.5], [u + 0.025 + a, h], [u - 0.025 + a, h]]), lin([[0, '#f8d76a'], [1, '#e8a830']], 0, 0, 1, 0), { stroke: '#c98a1a', w: sw * 0.7 }); }
      path(g, soft([[-0.34, 0.75], [0.34, 0.75], [0.26, 0.03], [-0.26, 0.03]]), grad('#d9262c', { cx: 0.4, cy: 0.3 }), { stroke: '#8a1418' }); path(g, curve([[-0.31, 0.72], [0, 0.6], [0.31, 0.72]]), 'none', { stroke: '#fbf3d8', w: sw * 1.4 });
      path(g, circ(0, 0.38, 0.09), '#f6c21e', { op: 0.9 });
    } else if (A.b === 'cheese') {
      shadow(-0.46, 0.46); const c = A.col;
      path(g, poly3([[-0.46, 0.05], [0.3, 0.05], [0.3, 0.3], [-0.46, 0.3]]), grad(kitDark(c, 0.08), { l: 0.2 }), { stroke: edge(c, 0.4) }); path(g, poly3([[-0.46, 0.3], [0.3, 0.3], [0.46, 0.55]]), grad(lite(c, 0.1)), { stroke: edge(c, 0.4) }); path(g, poly3([[0.3, 0.05], [0.46, 0.3], [0.46, 0.55], [0.3, 0.3]]), kitDark(c, 0.18), { stroke: edge(c, 0.4) });
      [[-0.3, 0.16, 0.05], [-0.05, 0.2, 0.04], [0.15, 0.12, 0.035], [0.05, 0.38, 0.04]].forEach(([u, v, r]) => path(g, circ(u, v, r), kitDark(c, 0.2), { stroke: edge(c, 0.3), w: sw * 0.6 }));
    } else if (A.b === 'glass') {
      shadow(-0.3, 0.3); const f = A.fill;
      path(g, soft([[-0.3, 1.45], [0.3, 1.45], [0.24, 0.03], [-0.24, 0.03]]), '#e9f1f6', { stroke: '#a9b9c6', op: 0.45 });
      path(g, soft([[-0.28, 1.2], [0.28, 1.2], [0.23, 0.07], [-0.23, 0.07]]), lin([[0, lite(f, 0.2)], [1, kitDark(f, 0.08)]]), { stroke: kitDark(f, 0.15) }); path(g, oval(0, 1.2, 0.28, 0.04), lite(f, 0.3));
      path(g, soft([[-0.22, 1.35], [-0.15, 1.35], [-0.12, 0.1], [-0.18, 0.1]]), '#ffffff', { op: 0.35 });
      if (A.straw) { path(g, line([[0.05, 1.0], [0.18, 1.62]]), 'none', { stroke: '#e3332a', w: w * 0.05 }); path(g, oval(0.3, 1.38, 0.12, 0.08), '#f8e67a', { stroke: '#d9b81a' }); }
    } else if (A.b === 'cup') {
      shadow(-0.48, 0.48); path(g, oval(0, 0.05, 0.47, 0.06), '#eef2f5', { stroke: '#b9c1c8' });
      path(g, curve([[0.3, 0.52], [0.46, 0.5], [0.44, 0.3], [0.25, 0.24]]), 'none', { stroke: '#e3e8ec', w: w * 0.05 });
      path(g, soft([[-0.33, 0.6], [0.33, 0.6], [0.28, 0.2], [0.18, 0.08], [-0.18, 0.08], [-0.28, 0.2]]), grad('#f8fafb', { cx: 0.4, cy: 0.3, d: 0.15 }), { stroke: '#b9c1c8' });
      path(g, oval(0, 0.6, 0.33, 0.06), '#e3e8ec', { stroke: '#b9c1c8' }); path(g, oval(0, 0.595, 0.3, 0.048), grad(A.fill, { cx: 0.5, cy: 0.4, l: 0.3 }));
      if (A.hot) [0, 0.9, 1.8].forEach((dl, i) => steam(g, -0.1 + i * 0.1, 0.65, 0.3, dl));
    }
    void lin;
  };
  function poly3(pts) { return 'M' + pts.map(([u, v]) => [curX + u * curW, curY - v * curW].map(fx).join(',')).join('L') + 'Z'; }
  let curX = X, curY = Y, curW = W;
  if (view === 'both') { curX = X - W / 4; curW = W * 0.48; draw(curX, Y, curW, false); curX = X + W / 4; draw(curX, Y, curW, true); }
  else { draw(X, Y, W, view === 'cut'); }
  return root;
}

// (v329) what Cassie knows about each food the kit can draw: its group (and go, grow or glow), what it gives the body, where it comes from, one fact
const FOOD_FACTS = [
  ["apple", /\b(apples?|mansanas)\b/i, "fruit, glow food", "fibre and vitamin C", "grows on apple trees in cool places", "The core holds the seeds; an apple floats because a quarter of it is air"],
  ["pear", /\b(pears?|peras)\b/i, "fruit, glow food", "fibre and vitamin C", "grows on pear trees", "Pears ripen from the inside out, so they are picked hard"],
  ["orange", /\b(oranges?|dalandan|kahel)\b/i, "fruit, glow food", "vitamin C", "grows on citrus trees in warm places", "Inside are about 10 segments, each a bundle of juice sacs"],
  ["lemon", /\b(lemons?)\b/i, "fruit, glow food", "vitamin C and citric acid (sour)", "grows on citrus trees", "Lemon juice is acidic enough to keep a cut apple from turning brown"],
  ["lime", /\b(limes?|dayap|calamansi|kalamansi)\b/i, "fruit, glow food", "vitamin C", "grows on citrus trees", "Sailors ate limes so they would not get scurvy"],
  ["peach", /\b(peach(es)?)\b/i, "fruit, glow food", "vitamins A and C", "grows on peach trees", "Its fuzzy skin and single hard pit make it a stone fruit"],
  ["mango", /\b(mangoes|mangos?|mangga)\b/i, "fruit, glow food", "vitamins A and C", "grows on tall mango trees in the tropics", "The Philippine carabao mango is one of the sweetest in the world"],
  ["avocado", /\b(avocados?|abukado)\b/i, "fruit, glow food", "healthy fats, fibre and potassium", "grows on avocado trees", "It is a big berry with one seed, and it ripens only after it is picked"],
  ["kiwi", /\b(kiwis?|kiwifruit)\b/i, "fruit, glow food", "vitamin C (more than an orange)", "grows on vines", "The tiny black seeds are in a ring around a pale core"],
  ["pomegranate", /\b(pomegranates?)\b/i, "fruit, glow food", "vitamin C and fibre", "grows on small trees in dry places", "One fruit can hold over 600 juicy seeds called arils"],
  ["coconut", /\b(coconuts?|niyog|buko)\b/i, "fruit, glow food", "healthy fats, water and fibre", "grows on coconut palms by the sea", "A young coconut is full of clear coconut water; the white meat grows as it ripens"],
  ["papaya", /\b(papayas?|papaya)\b/i, "fruit, glow food", "vitamins A and C", "grows on papaya trees in the tropics", "The black seeds in the middle are edible and peppery"],
  ["watermelon", /\b(watermelons?|pakwan)\b/i, "fruit, glow food", "water (about 92 percent) and vitamin C", "grows on vines along the ground", "It is a kind of berry with a hard rind"],
  ["melon", /\b(melons?|cantaloupes?|melon)\b/i, "fruit, glow food", "vitamins A and C", "grows on vines along the ground", "The net pattern on its skin is where it healed tiny cracks as it grew"],
  ["dragonfruit", /\b(dragon ?fruits?|pitaya)\b/i, "fruit, glow food", "fibre and vitamin C", "grows on a climbing cactus", "Its flowers open only at night"],
  ["persimmon", /\b(persimmons?)\b/i, "fruit, glow food", "vitamins A and C", "grows on persimmon trees", "Cut across, its flesh shows a star pattern"],
  ["strawberry", /\b(strawberr(y|ies))\b/i, "fruit, glow food", "vitamin C", "grows on low plants", "The yellow dots on the outside are its seeds, about 200 on each berry"],
  ["grapes", /\b(grapes?|ubas)\b/i, "fruit, glow food", "vitamins C and K", "grows in bunches on vines", "Raisins are dried grapes"],
  ["greengrapes", /\b(green grapes?)\b/i, "fruit, glow food", "vitamins C and K", "grows in bunches on vines", "Green and purple grapes are different kinds of the same plant"],
  ["cherry", /\b(cherr(y|ies)|seresa)\b/i, "fruit, glow food", "vitamin C", "grows on cherry trees", "Each cherry has one hard stone inside"],
  ["blueberry", /\b(blueberr(y|ies))\b/i, "fruit, glow food", "vitamin C and antioxidants", "grows on bushes", "The dusty white coat on its skin is a natural wax called bloom"],
  ["raspberry", /\b(raspberr(y|ies))\b/i, "fruit, glow food", "fibre and vitamin C", "grows on thorny canes", "Each berry is a cluster of about 100 tiny fruits, each with a seed"],
  ["blackberry", /\b(blackberr(y|ies))\b/i, "fruit, glow food", "fibre and vitamin C", "grows on thorny brambles", "Unlike a raspberry, its core comes off with the berry"],
  ["banana", /\b(bananas?|saging)\b/i, "fruit, go and glow food", "potassium and energy", "grows in bunches on banana plants in the tropics", "A banana plant is a giant herb, not a tree"],
  ["pineapple", /\b(pineapples?|pinya)\b/i, "fruit, glow food", "vitamin C and bromelain", "grows from the middle of a spiky plant", "It takes about two years to grow one pineapple"],
  ["tomato", /\b(tomato(es)?|kamatis)\b/i, "vegetable (really a fruit), glow food", "vitamin C and lycopene", "grows on vines", "It is a fruit because it holds seeds, but we cook it like a vegetable"],
  ["onion", /\b(onions?|sibuyas)\b/i, "vegetable, glow food", "vitamin C", "the bulb grows underground", "Cutting it lets out a gas that makes your eyes water"],
  ["potato", /\b(potato(es)?|patatas)\b/i, "vegetable, go food", "starch (energy) and potassium", "the tuber grows underground", "The eyes on a potato can sprout into new plants"],
  ["pumpkin", /\b(pumpkins?|kalabasa|squash)\b/i, "vegetable, glow food", "vitamin A", "grows on vines along the ground", "Its seeds can be roasted and eaten"],
  ["carrot", /\b(carrots?|karot)\b/i, "vegetable, glow food", "vitamin A (good for the eyes)", "the root grows underground", "Carrots were purple and yellow before orange ones were grown"],
  ["cucumber", /\b(cucumbers?|pipino)\b/i, "vegetable, glow food", "water (about 96 percent)", "grows on vines", "Pickles are cucumbers kept in salty or sour water"],
  ["zucchini", /\b(zucchinis?|courgettes?)\b/i, "vegetable, glow food", "vitamin C and water", "grows on bushy plants", "Its big yellow flowers can be eaten too"],
  ["eggplant", /\b(eggplants?|talong|aubergines?)\b/i, "vegetable, glow food", "fibre", "grows on bushes", "It is related to the tomato and the potato"],
  ["sweetpotato", /\b(sweet ?potato(es)?|kamote)\b/i, "vegetable, go food", "vitamin A and energy", "the root grows underground", "Its leaves (talbos ng kamote) are eaten as a green vegetable"],
  ["chili", /\b(chil(i|li|e)s?( peppers?)?|sili)\b/i, "vegetable, glow food", "vitamin C", "grows on small bushes", "The heat comes from capsaicin, mostly in the seeds and the white ribs"],
  ["corn", /\b(corn|maize|mais)\b/i, "vegetable and grain, go food", "energy (starch) and fibre", "grows as cobs on tall grass plants", "Each kernel is a seed, and each silk thread leads to one kernel"],
  ["bellpepper", /\b((red )?bell peppers?|capsicums?)\b/i, "vegetable, glow food", "vitamin C", "grows on bushes", "A red bell pepper is a green one left to ripen"],
  ["yellowpepper", /\b(yellow (bell )?peppers?)\b/i, "vegetable, glow food", "vitamin C", "grows on bushes", "Yellow peppers have more vitamin C than oranges"],
  ["greenpepper", /\b(green (bell )?peppers?)\b/i, "vegetable, glow food", "vitamin C", "grows on bushes", "Green peppers are picked before they ripen"],
  ["cabbage", /\b(cabbages?|repolyo)\b/i, "vegetable, glow food", "vitamins C and K", "grows as a tight head of leaves", "A head of cabbage is a bud of tightly wrapped leaves"],
  ["redcabbage", /\b(red cabbages?|purple cabbages?)\b/i, "vegetable, glow food", "vitamins C and K", "grows as a tight head of leaves", "Its juice changes colour in acids and bases, so it can test them"],
  ["lettuce", /\b(lettuces?|litsugas)\b/i, "vegetable, glow food", "vitamin K and water", "grows as a loose head of leaves", "Lettuce is about 95 percent water"],
  ["spinach", /\b(spinach|kangkong|alugbati)\b/i, "vegetable, glow food", "iron and vitamins A and K", "grows as leaves from the ground", "Cooking spinach shrinks it to a tenth of its size"],
  ["broccoli", /\b(broccoli|brokoli)\b/i, "vegetable, glow food", "vitamins C and K and fibre", "grows as a head of flower buds", "The bumpy head is made of many tiny unopened flowers"],
  ["cauliflower", /\b(cauliflowers?)\b/i, "vegetable, glow food", "vitamin C", "grows as a white head of flower buds", "Leaves wrap round it and keep it white"],
  ["mushroom", /\b(mushrooms?|kabute)\b/i, "vegetable (really a fungus), glow food", "vitamin D and B vitamins", "grows from the ground or wood in damp places", "A mushroom is not a plant; it is a fungus"],
  ["peas", /\b(peas?|pea pods?|gisantes)\b/i, "vegetable, grow food", "protein and fibre", "grows in pods on climbing vines", "Each pod holds about 6 to 9 peas"],
  ["garlic", /\b(garlic|bawang)\b/i, "vegetable, glow food", "flavour and vitamin B6", "the bulb grows underground", "One bulb is made of about 10 to 20 cloves"],
  ["beet", /\b(beets?|beetroots?)\b/i, "vegetable, glow food", "folate and iron", "the root grows underground", "Its red juice is used as a natural food colouring"],
  ["radish", /\b(radish(es)?|labanos)\b/i, "vegetable, glow food", "vitamin C", "the root grows underground", "Radishes can be ready to eat 3 weeks after planting"],
  ["celery", /\b(celery|kintsay)\b/i, "vegetable, glow food", "water and fibre", "grows as long stalks from the ground", "Each stalk has strings that carry water up the plant"],
  ["bread", /\b(breads?|loaf|loaves|tinapay|pandesal)\b/i, "grain, go food", "carbohydrates (energy)", "baked from wheat flour, water and yeast", "Yeast makes gas bubbles that make the dough rise"],
  ["toast", /\b(toast)\b/i, "grain, go food", "carbohydrates (energy)", "bread heated until the outside browns", "The browning is the Maillard reaction, which makes new flavours"],
  ["croissant", /\b(croissants?)\b/i, "grain, go food", "carbohydrates and fat", "baked from many thin layers of dough and butter", "It has dozens of layers, so it flakes"],
  ["pancakes", /\b(pancakes?|hotcakes?)\b/i, "grain, go food", "carbohydrates (energy)", "cooked from flour, eggs and milk", "The bubbles on top show it is time to flip it"],
  ["waffle", /\b(waffles?)\b/i, "grain, go food", "carbohydrates (energy)", "cooked from batter in a waffle iron", "The square pockets hold the syrup"],
  ["rice", /\b(rice|kanin|bigas)\b/i, "grain, go food", "carbohydrates (energy)", "grows as grains on rice plants in flooded paddies", "Rice feeds more than half the people in the world"],
  ["noodles", /\b(noodles?|pancit|ramen|mami)\b/i, "grain, go food", "carbohydrates (energy)", "made from wheat or rice flour", "Noodles were made in China over 4,000 years ago"],
  ["soup", /\b(soups?|sabaw|sinigang|tinola|stew)\b/i, "mixed meal", "water, vegetables and protein", "cooked in a pot of hot water or broth", "A warm soup helps you drink water when you are sick"],
  ["salad", /\b(salads?)\b/i, "vegetable, glow food", "vitamins and fibre", "raw vegetables mixed together", "Many colours in a salad mean many different vitamins"],
  ["sandwich", /\b(sandwich(es)?)\b/i, "mixed meal", "carbohydrates, protein and vegetables", "bread with fillings between", "It is named after the Earl of Sandwich"],
  ["burger", /\b((ham)?burgers?|cheeseburgers?)\b/i, "mixed meal", "protein and carbohydrates", "a meat patty in a bun", "Fast food is fine sometimes, but it has a lot of fat and salt"],
  ["pizza", /\b(pizzas?)\b/i, "mixed meal", "carbohydrates, protein and fat", "baked flat bread with sauce and cheese", "Pizza began in Naples, Italy"],
  ["taco", /\b(tacos?)\b/i, "mixed meal", "carbohydrates, protein and vegetables", "a folded corn or flour tortilla with fillings", "Tacos come from Mexico"],
  ["fries", /\b((french )?fries|chips)\b/i, "grain-like go food (from potatoes)", "carbohydrates and fat", "potatoes cut and fried in oil", "Frying gives energy but a lot of fat, so eat them only now and then"],
  ["egg", /\b(eggs?|itlog)\b/i, "protein, grow food", "protein and vitamin D", "laid by hens", "The yolk feeds a growing chick; the white protects it"],
  ["bacon", /\b(bacon)\b/i, "protein, grow food", "protein and fat", "salted and smoked pork", "Bacon is very salty, so it is a treat food"],
  ["sausage", /\b(sausages?|hotdogs?|longganisa)\b/i, "protein, grow food", "protein and fat", "ground meat in a skin", "Longganisa is the Filipino sausage, sweet or garlicky"],
  ["chicken", /\b((roast(ed)? )?chickens?|manok|lechon manok)\b/i, "protein, grow food", "protein", "meat from chickens", "Chicken has less fat than red meat"],
  ["drumstick", /\b(drumsticks?|chicken legs?|fried chicken)\b/i, "protein, grow food", "protein", "the lower leg of a chicken", "The bone in the middle is the chicken's shin bone"],
  ["fish", /\b(fish|salmon|isda|bangus|tilapia)\b/i, "protein, grow food", "protein and omega 3 fats", "caught in the sea or raised in ponds", "Omega 3 fats in fish help the brain and heart"],
  ["steak", /\b(steaks?|beef|baka)\b/i, "protein, grow food", "protein and iron", "meat from cattle", "Iron in red meat helps blood carry oxygen"],
  ["cheese", /\b(cheese|keso)\b/i, "dairy, grow food", "calcium and protein", "made from milk thickened and pressed", "The holes in some cheeses are bubbles of gas from bacteria"],
  ["milk", /\b(milk|gatas)\b/i, "dairy, grow food", "calcium and protein", "from cows, goats or carabaos", "Calcium in milk builds strong bones and teeth"],
  ["juice", /\b(juices?|orange juice|katas)\b/i, "fruit drink, glow food", "vitamin C and sugar", "squeezed from fruit", "A whole fruit is better than juice because it keeps the fibre"],
  ["tea", /\b(tea|tsaa)\b/i, "drink", "water and antioxidants", "brewed from the dried leaves of the tea plant", "After water, tea is the most drunk drink in the world"],
  ["water", /\b(water|tubig|glass(es)? of water|drinking water)\b/i, "drink", "water: your body is about 60 percent water", "from taps, wells and springs, kept clean", "Drink about 6 to 8 glasses a day, more when it is hot or you play hard"],
];
const FOOD_GROUPS = 'Go foods give energy (rice, bread, noodles, potatoes, corn, sweet potatoes, bananas); grow foods build the body (eggs, fish, meat, chicken, milk, cheese, beans and peas); glow foods keep you healthy and fight sickness (fruits and vegetables). A healthy plate is half fruits and vegetables, a quarter go foods (rice) and a quarter grow foods, with a glass of water or milk.';
export function foodGuide(asked = '') {
  const q = String(asked || ''), out = [];
  const hits = FOOD_FACTS.filter((a) => a[1].test(q)).sort((a, b) => q.match(b[1])[0].length - q.match(a[1])[0].length).slice(0, 3);
  hits.forEach(([kind, , grp, nut, src, fact]) => out.push(`About ${FOOD_NAMES[kind] || kind} (draw it with the food kit, kind "${kind}"${FOOD[kind] && FOOD[kind].cut ? ', and view "cut" or "both" shows it cut open' : ''}): group: ${grp}. It gives: ${nut}. Where it comes from: ${src}. ${fact}.`));
  if (/\b(food groups?|go,? grow,? (and )?glow|go foods?|grow foods?|glow foods?|healthy (plate|food|diet|eating)|balanced (diet|meal)|pinggang pinoy|nutrients?|nutrition|food pyramid)\b/i.test(q)) out.push(FOOD_GROUPS);
  return out.join('\n');
}
// ---------- (v330) one thing asked for by name ("draw a lion", "show me how a toaster works", "a sandwich in 3D"),
// built straight from the kits: no AI, so it is right every time and shows at once, even when her drawing brain is
// busy. The book (drawbook.js fromKit) decides when a question asks for just that thing and nothing more. ----------
const KIT_ALIAS = [
  { is: /\b(bird|ibon)\b/i, type: 'animal', kind: 'parrot' }, // (a bird, any bird: a parrot, standing side on; birds: the birds scene)
  { is: /\b(vehicle)\b/i, type: 'vehicle', kind: 'sedan' }, // (a vehicle: a car; vehicles: the vehicles scene)
];
const kitCap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
export const kitNames = () => [ANIMAL_FACTS, FOOD_FACTS].flatMap((t) => t.map((a) => a[1].source)).concat(APPLIANCES.map((a) => a.is.source), VEHICLES.map((v) => v.is.source), KIT_ALIAS.map((a) => a.is.source), KIT_SCENES.map((a) => a.is.source), KIT_NATURE.map((a) => a.is.source)).join(' ').replace(/\\[a-z]/gi, ' ').toLowerCase().match(/[a-z]{3,}/g) || []; // (v332: for the typo reader)
export function kitFind(asked = '') {
  const q = String(asked || ''), all = [], add = (type, kind, re, info) => { const m = q.match(re); if (m) all.push({ type, kind, re, len: m[0].length, info }); };
  ANIMAL_FACTS.forEach((a) => add('animal', a[0], a[1], a));
  APPLIANCES.forEach((a) => { if (!(a.not && a.not.test(q))) add('appliance', a.kind, a.is, a); });
  FOOD_FACTS.forEach((a) => add('food', a[0], a[1], a));
  VEHICLES.forEach((v) => { if (!(v.not && v.not.test(q))) add('vehicle', v.kind, v.is, v); });
  KIT_ALIAS.forEach((a) => add(a.type, a.kind, a.is, a.type === 'animal' ? ANIMAL_FACTS.find((f) => f[0] === a.kind) : VEHICLES.find((v) => v.kind === a.kind)));
  KIT_SCENES.forEach((sc) => add('scene', sc.key, sc.is, sc)); // (v335) a group, in its home
  KIT_NATURE.forEach((N) => add('nature', N.t + (N.kind ? ':' + N.kind : ''), N.is, N)); // (v335) the sky's own, a rock
  return all.filter((h) => h.info).sort((a, b) => b.len - a.len); // (the most exact first: a polar bear before a bear)
}
const APPL_H2 = { fridge: 200, vacuum: 200, fan: 200, aircon: 180, washer: 170, microwave: 90 };
// the drawing (or the 3D model) of one thing the kit knows, from kitFind
export function kitSpec(hit, want3d = false, opts = {}) {
  if (!hit || !hit.info) return null;
  if (hit.type === 'scene') return sceneSpec(hit.info, !!want3d);
  if (hit.type === 'nature') return natureSpec(hit.info, !!want3d);
  const { type, kind, info } = hit, d3 = !!want3d;
  const base = (title, intro, summary, photo, next, part) => ({ title, mode: d3 ? '3d' : '2d', ...(d3 ? { axis: 'y' } : { layout: `one ${title.toLowerCase()} in the middle, standing on the ground` }), intro, summary, photo, next, parts: [{ ...part, color: '#888888', ...(d3 ? { size: 1, inside: null } : {}) }] });
  if (type === 'animal') {
    const [, , cls, home, food, moves, fact] = info, name = AN_NAMES[kind] || kind, A = ANIMALS[kind] || ANIMALS.lion;
    const w2 = Math.round(Math.min(260, 170 / animalTall(A))), mid = A.b === 'fish' || A.b === 'jelly' || A.b === 'octopus' || A.b === 'bat';
    return base(kitCap(name), `${fact}.`, `Class: ${cls}. Home: ${home}. Food: ${food}. How it moves: ${moves}.`, `a real ${name} in its natural home`, [`Where does the ${name} live?`, `What does the ${name} eat?`],
      { id: kind, label: kitCap(name), say: `The ${name} is a ${cls}. It lives in ${home} and eats ${food}. ${fact}.`, shapes: [d3 ? { t: 'animal', kind, pos: [0, mid ? 1 : 0, 0], w: 4.5 } : { t: 'animal', kind, x: 200, y: mid ? 140 : 236, w: w2 }] });
  }
  if (type === 'appliance') {
    const A = info, name = A.what.replace(/^an? /, ''), open = !!APPL_OPEN[kind] && !opts.only; // (v336: "only the refrigerator": shut, whole, as you would see it)
    return base(opts.only ? kitCap(name) : `How ${A.what} works`, `${kitCap(A.what)}: ${A.views.split(';')[0].replace(/^front: /, '')}.`, A.works, `a real ${name} in a home`, [`What are the main parts of ${A.what}?`, `How does ${A.what} use electricity?`],
      { id: kind, label: kitCap(name), say: `Its main parts: ${A.parts.join(', ')}.`, shapes: [d3 ? { t: 'appliance', kind, pos: [0, 0, 0], h: +(APPL[kind] ? 4.5 * APPL[kind].H / Math.max(APPL[kind].W, APPL[kind].H, APPL[kind].D) : 4.5).toFixed(2), ...(open ? { pose: 'open' } : {}) } : { t: 'appliance', kind, x: 200, y: 236, h: APPL_H2[kind] || 140, view: open ? 'open' : 'front' }] });
  }
  if (type === 'food') {
    const [, , grp, nut, src, fact] = info, name = FOOD_NAMES[kind] || kind, A = FOOD[kind] || FOOD.apple, view = A.cut && !opts.only ? 'both' : 'whole'; // (v336: "only an apple": the whole apple)
    const w2 = Math.round(Math.min(220, 150 / Math.max(0.3, A.asp || 1)));
    return base(kitCap(name), `${fact}.`, `Group: ${grp}. It gives ${nut}. ${kitCap(src)}.`, `a real ${name} on a table`, [`Why is ${name} good for you?`, `Where does ${name} come from?`],
      { id: kind, label: kitCap(name), say: `${kitCap(grp)}. It gives ${nut}.${A.cut && view !== 'whole' ? ' Beside it, one cut open to show inside.' : ''}` /* (v337: its name is on the step already, not twice) */, shapes: [d3 ? { t: 'food', kind, pos: [0, 0, 0], w: A.cut ? 2.4 : 4, ...(A.cut ? { view } : {}) } : { t: 'food', kind, x: 200, y: 200, w: w2, ...(A.cut && view !== 'whole' ? { view } : {}) }] });
  }
  if (type === 'vehicle') {
    const V = info, name = V.what.replace(/^an? /, '');
    return base(opts.only ? kitCap(name) : `How ${V.what} works`, `${kitCap(V.what)}: ${V.views.split(';')[0].replace(/^side: /, '')}.`, V.works, `a real ${name} on a road`, [`What are the main parts of ${V.what}?`, `How does ${V.what} stop?`],
      { id: kind, label: kitCap(name), say: `Its main parts: ${V.parts.join(', ')}.`, shapes: [d3 ? { t: 'vehicle', kind, pos: [0, 0, 0], w: 4 } : { t: 'vehicle', kind, x: 200, y: 220, w: 300, view: 'side' }] });
  }
  return null;
}
// ---------- (v335) groups and nature, built from the kits: "dinosaurs", "land animals", "sea animals", "farm animals",
// "birds", "insects", "pets", "food", "vehicles", "a forest", and the sky's own (a cloud, the sun, the moon, snow, a
// storm, rain, lightning, a rock). Every animal, food or vehicle in a scene is its own part with its name and its facts.
// In 3D a scene stands on a raised island of its own ground (a diorama), with hills, a pond, trees, grass, clouds and
// the sun, so a habitat is never one flat plane. ----------
const KIT_SCENES = [
  { key: 'dinosaurs', is: /\b(dinosaurs?|dinos|prehistoric (animals?|creatures?|reptiles?)|jurassic|cretaceous)\b/i, title: 'Dinosaurs', biome: 'prehistoric', kinds: ['brachiosaurus', 'trex', 'triceratops', 'stegosaurus', 'raptor', 'pteranodon'], intro: 'Dinosaurs ruled the land for about 165 million years, until an asteroid hit the Earth 66 million years ago.', summary: 'Some ate plants (Brachiosaurus, Triceratops, Stegosaurus), some ate meat (T. rex, raptors); the Pteranodon was a flying reptile that lived beside them.' },
  { key: 'land', is: /\b((land|wild|safari|savanna|grassland|african) animals?|animals? (on|of|that live on) (the )?land|animals)\b/i, title: 'Land animals', biome: 'savanna', kinds: ['elephant', 'giraffe', 'rhino', 'lion', 'zebra', 'kangaroo'], intro: 'Land animals walk, run or hop on the ground and breathe air with lungs.', summary: 'Each one is made for its home: long legs to run, a long neck to reach leaves, a trunk to grab, strong back legs to hop.' },
  { key: 'sea', is: /\b((sea|ocean|marine|underwater|water|aquatic) (animals?|creatures?|life)|animals? (in|of|under) the (sea|ocean))\b/i, title: 'Sea animals', biome: 'sea', kinds: ['whale', 'shark', 'dolphin', 'seaturtle', 'octopus', 'jellyfish', 'clownfish', 'crab'], intro: 'Sea animals live in salt water: fish breathe with gills, while whales and dolphins come up to breathe air.', summary: 'The ocean covers most of the Earth and is home to the biggest animal that ever lived, the blue whale.' },
  { key: 'farm', is: /\b((farm|domestic|barnyard) animals?|animals? (on|in|at) (a|the) farm|livestock)\b/i, title: 'Farm animals', biome: 'farm', kinds: ['horse', 'cow', 'pig', 'sheep', 'goat', 'chicken', 'duck'], intro: 'Farm animals are kept by people for food, wool, milk, eggs and work.', summary: 'Cows give milk, chickens lay eggs, sheep give wool, and horses once pulled the ploughs.' },
  { key: 'jungle', is: /\b((jungle|rainforest|rain forest|tropical) animals?|animals? (in|of) the (jungle|rainforest))\b/i, title: 'Rainforest animals', biome: 'jungle', kinds: ['gorilla', 'tiger', 'jaguar', 'sloth', 'monkey', 'toucan', 'macaw'], intro: 'Rainforests are hot and wet all year, and hold more kinds of animals than anywhere else on land.', summary: 'Animals live at every level: big cats on the floor, monkeys and sloths in the branches, colourful birds in the treetops.' },
  { key: 'desert', is: /\b(desert animals?|animals? (in|of) the desert)\b/i, title: 'Desert animals', biome: 'desert', kinds: ['camel', 'snake', 'lizard', 'meerkat', 'hawk'], intro: 'Desert animals live where there is very little rain, with hot days and cold nights.', summary: 'They save water, hide from the sun in burrows and shade, and many come out only at night.' },
  { key: 'polar', is: /\b((polar|arctic|antarctic|cold|snow|ice) animals?|animals? (in|of) the (arctic|antarctic|poles?|snow))\b/i, title: 'Polar animals', biome: 'polar', kinds: ['polarbear', 'wolf', 'fox', 'penguin'], intro: 'Polar animals live in the coldest places on Earth, on ice and snow.', summary: 'Thick fur, fat (blubber) and small ears keep the heat in; white coats hide them in the snow.' },
  { key: 'birds', is: /\b(birds|kinds of birds?|types of birds?|mga ibon)\b/i, title: 'Birds', biome: 'sky', kinds: ['eagle', 'owl', 'parrot', 'toucan', 'flamingo', 'penguin', 'hummingbird'], intro: 'Birds have feathers, a beak and wings, and they lay eggs; most of them can fly.', summary: 'Light hollow bones and strong chest muscles let them fly; penguins swim with their wings instead.' },
  { key: 'insects', is: /\b(insects|bugs|kinds of insects?|types of insects?|mga insekto)\b/i, title: 'Insects and bugs', biome: 'garden', kinds: ['butterfly', 'bee', 'ladybug', 'beetle', 'ant', 'spider'], intro: 'An insect has six legs and three body parts: head, thorax and abdomen.', summary: 'The spider is not an insect: it has eight legs and two body parts, so it is an arachnid.' },
  { key: 'pets', is: /\b(pets|pet animals?|house ?pets?|animals? at home)\b/i, title: 'Pets', biome: 'home', kinds: ['dog', 'cat', 'rabbit', 'guineapig', 'hamster', 'budgie', 'goldfish'], intro: 'Pets are animals people keep at home and look after.', summary: 'A pet needs food, clean water, a safe home, exercise and a visit to the vet.' },
  { key: 'forest', is: /\b(forests?|woods|woodland|forest animals?)\b/i, title: 'A forest', biome: 'forest', kinds: ['bear', 'deer', 'fox', 'owl', 'rabbit'], intro: 'A forest is a big area covered with trees, home to many animals.', summary: 'Trees make oxygen and shelter animals; fallen leaves rot and feed the soil.' },
  { key: 'foods', type: 'food', is: /\b(foods?|meals?|dishes|kinds of foods?|types of foods?|pagkain)\b/i, title: 'Foods', biome: 'table', kinds: ['rice', 'noodles', 'soup', 'pizza', 'burger', 'salad', 'sandwich', 'egg'], intro: 'Food gives your body energy to move, materials to grow and vitamins to stay healthy.', summary: 'A healthy plate has go foods (rice, bread), grow foods (egg, fish, meat) and glow foods (fruits and vegetables).' },
  { key: 'vehicles', type: 'vehicle', is: /\b(vehicles|kinds of vehicles?|types of (vehicles?|transport(ation)?)|transport(ation)?|means of transport(ation)?|mga sasakyan)\b/i, title: 'Vehicles', biome: 'road', kinds: ['bus', 'firetruck', 'sedan', 'truck', 'motorcycle', 'bicycle'], intro: 'Vehicles carry people and things from place to place.', summary: 'Cars, buses and trucks run on engines or batteries; a bicycle runs on your legs.' },
];
const KIT_NATURE = [
  { is: /\b(clouds?|ulap)\b/i, title: 'A cloud', t: 'cloud', say: 'A cloud is millions of tiny water drops or ice crystals floating in the air.' },
  { is: /\b(the sun|sun|araw)\b/i, title: 'The Sun', t: 'sun', say: 'The Sun is a star: a huge ball of hot gas that gives the Earth its light and heat.' },
  { is: /\b(the moon|moon|buwan)\b/i, title: 'The Moon', t: 'moon', say: 'The Moon goes round the Earth once about every 27 days and shines with light from the Sun.' },
  { is: /\b(snow(flakes?)?|niyebe)\b/i, title: 'A snowflake', t: 'snowflake', say: 'A snowflake is ice crystals that grow six arms as they fall through cold clouds.' },
  { is: /\b(storms?|thunderstorms?|bagyo)\b/i, title: 'A storm', t: 'cloud', kind: 'storm', say: 'A storm cloud is tall and dark, full of rain, with lightning and thunder.' },
  { is: /\b(rain|rainy|ulan)\b/i, title: 'Rain', t: 'cloud', kind: 'rain', say: 'Rain falls when the tiny drops in a cloud join into drops too heavy to float.' },
  { is: /\b(lightning|kidlat)\b/i, title: 'Lightning', t: 'bolt', say: 'Lightning is a giant spark of electricity between a cloud and the ground.' },
  { is: /\b(rocks?|stones?|bato)\b/i, title: 'A rock', t: 'rock', say: 'Rocks are made of minerals, formed from cooled lava, pressed layers or heat and pressure.' },
];
// how long each animal is (in the scene's units): big ones big, small ones still big enough to see
const KIT_LEN = { elephant: 1.8, giraffe: 1.35, rhino: 1.4, lion: 1.15, zebra: 1.15, kangaroo: 0.85, trex: 2.1, triceratops: 1.6, stegosaurus: 1.7, brachiosaurus: 2.5, raptor: 0.9, pteranodon: 1.3, whale: 2.4, dolphin: 1.1, shark: 1.5, octopus: 0.7, seaturtle: 0.75, clownfish: 0.35, jellyfish: 0.55, crab: 0.45, cow: 1.2, pig: 0.8, horse: 1.3, sheep: 0.8, goat: 0.75, chicken: 0.4, duck: 0.4, tiger: 1.2, gorilla: 0.9, monkey: 0.6, sloth: 0.6, toucan: 0.45, macaw: 0.55, jaguar: 1.05, camel: 1.4, meerkat: 0.35, lizard: 0.5, snake: 0.9, hawk: 0.7, polarbear: 1.3, penguin: 0.5, wolf: 0.95, fox: 0.65, eagle: 0.95, owl: 0.55, parrot: 0.5, flamingo: 0.75, hummingbird: 0.3, butterfly: 0.7, bee: 0.5, ladybug: 0.45, beetle: 0.55, ant: 0.45, spider: 0.55, dog: 0.75, cat: 0.55, rabbit: 0.45, hamster: 0.3, goldfish: 0.35, budgie: 0.35, guineapig: 0.35, deer: 1.05, bear: 1.25 };
const FLIES = new Set(['pteranodon', 'eagle', 'hawk', 'parrot', 'toucan', 'macaw', 'hummingbird', 'owl', 'butterfly', 'bee', 'budgie']);
const SWIMS = new Set(['whale', 'shark', 'dolphin', 'seaturtle', 'jellyfish', 'clownfish', 'goldfish']);
// each biome: its ground, and what grows or stands on it (3D: x, z on an island of radius 3.2; 2D: across the picture)
const BIOME = {
  prehistoric: { ground: '#6f9a3e', name: 'Prehistoric forest', say: 'Warm, wet forests of ferns, palms and conifers.', deco3: [['tree', 'palm', -2.4, -1.4, 1.6], ['tree', 'pine', 2.3, -1.6, 1.8], ['tree', 'palm', 2.6, 0.9, 1.3], ['rock', 'mossy', -2.5, 1.2, 0.6], ['pond', '', 1.2, 1.9, 0.8]], deco2: [['tree', 'palm', 30, 100], ['tree', 'pine', 375, 110], ['rock', 'mossy', 345, 40]] },
  savanna: { ground: '#c2ad5a', name: 'Savanna', say: 'A wide, warm grassland with few trees and a long dry season.', deco3: [['tree', 'bush', -2.5, -1.3, 1.2], ['tree', 'round', 2.4, -1.5, 1.6], ['grass', '', -1.4, 1.9, 0.7], ['grass', '', 1.9, 1.6, 0.6], ['rock', '', 2.6, 0.8, 0.5], ['pond', '', -0.2, 2.2, 0.9]], deco2: [['tree', 'bush', 28, 70], ['tree', 'round', 378, 95], ['grass', '', 200, 60]] },
  farm: { ground: '#78b04a', name: 'Farm', say: 'Fields and a barnyard, with water and food for the animals.', deco3: [['tree', 'round', -2.5, -1.4, 1.5], ['tree', 'round', 2.6, -1.2, 1.3], ['grass', '', 1.8, 1.9, 0.6], ['pond', '', -1.6, 1.9, 0.8], ['log', '', 2.3, 0.6, 0.6]], deco2: [['tree', 'round', 28, 95], ['grass', '', 330, 55]] },
  jungle: { ground: '#3f7f2e', name: 'Rainforest', say: 'Tall trees, thick leaves and rain nearly every day.', deco3: [['tree', 'round', -2.4, -1.5, 2.1], ['tree', 'palm', 2.4, -1.3, 1.9], ['tree', 'round', -2.6, 0.9, 1.6], ['tree', 'palm', 2.5, 1.1, 1.5], ['grass', '', 0.4, 2.2, 0.7], ['mushroom', '', -1.3, 2.1, 0.3]], deco2: [['tree', 'round', 26, 120], ['tree', 'palm', 378, 120]] },
  desert: { ground: '#e3cf9a', name: 'Desert', say: 'Dry sand and rock, hot by day and cold at night.', deco3: [['rock', '', -2.4, -1.4, 0.9], ['rock', '', 2.5, -1.2, 0.7], ['rock', '', 2.2, 1.6, 0.45], ['tree', 'bare', -2.5, 1.2, 1.1]], deco2: [['rock', '', 30, 40], ['rock', '', 370, 35]], sand: true },
  polar: { ground: '#eef3f8', name: 'Snow and ice', say: 'Ice and snow nearly all year, and freezing sea around it.', deco3: [['rock', '', -2.3, -1.5, 0.9], ['rock', '', 2.4, -1.3, 0.7], ['pond', 'ice', 1.4, 1.8, 1.0], ['tree', 'pine', -2.5, 1.1, 1.3]], deco2: [['tree', 'pine', 30, 100], ['rock', '', 370, 40]], snow: true },
  sky: { ground: '#78b04a', name: 'Sky and trees', say: 'Birds nest in trees and fly through the open sky.', deco3: [['tree', 'round', -2.2, -1.2, 1.9], ['tree', 'pine', 2.3, -1.4, 1.7], ['pond', '', 1.4, 1.8, 0.9], ['grass', '', -1.6, 1.9, 0.6]], deco2: [['tree', 'round', 34, 110], ['tree', 'pine', 372, 105]] },
  garden: { ground: '#6fae44', name: 'Garden', say: 'Flowers, leaves and soil: food and shelter for small animals.', deco3: [['flower', '', -2.2, -1.2, 0.9], ['flower', '', 2.3, -1.3, 0.8], ['flower', '', -2.4, 1.1, 0.7], ['grass', '', 2.2, 1.4, 0.6], ['mushroom', '', 0.6, 2.2, 0.35], ['leaf', '', -0.8, 2.3, 0.5]], deco2: [['flower', '', 28, 80], ['flower', '', 376, 80]] },
  home: { ground: '#d9c29a', name: 'Home', say: 'A safe, warm place with food, water and someone to look after them.', deco3: [['tree', 'bush', -2.4, -1.4, 0.9], ['tree', 'bush', 2.5, -1.3, 0.8], ['grass', '', 2.2, 1.5, 0.5]], deco2: [['tree', 'bush', 30, 60]] },
  forest: { ground: '#4f8f36', name: 'Forest floor', say: 'Leaves, moss and soil under tall trees.', deco3: [['tree', 'pine', -2.3, -1.5, 2.2], ['tree', 'round', 2.4, -1.4, 2.0], ['tree', 'pine', -2.6, 0.9, 1.7], ['tree', 'round', 2.6, 1.0, 1.6], ['log', '', -0.6, 2.2, 0.8], ['mushroom', '', 1.2, 2.2, 0.35]], deco2: [['tree', 'pine', 26, 120], ['tree', 'round', 380, 115]] },
  table: { table: true, name: 'Table', say: 'Set out on the table, so you can see each one.' },
  road: { ground: '#78b04a', road: true, name: 'Road', say: 'A road with two lanes, and grass along both sides.', deco3: [['tree', 'round', -2.6, -1.8, 1.4], ['tree', 'round', 2.6, -1.8, 1.3], ['tree', 'bush', -2.4, 1.9, 0.8]], deco2: [['tree', 'round', 30, 70]] },
  sea: { sea: true, name: 'Ocean', say: 'Salt water over a sandy floor, with light near the top and dark down deep.' },
};
const ANIMAL_INFO = (k) => ANIMAL_FACTS.find((a) => a[0] === k);
const FOOD_INFO = (k) => FOOD_FACTS.find((a) => a[0] === k);
function sceneMember(type, kind) {
  const nm = type === 'animal' ? AN_NAMES[kind] || kind : type === 'food' ? FOOD_NAMES[kind] || kind : (VEHICLES.find((v) => v.kind === kind) || {}).what || kind;
  const name = kitCap(String(nm).replace(/^an? /, ''));
  let say = name;
  if (type === 'animal') { const a = ANIMAL_INFO(kind); if (a) say = `${a[2]}; lives in ${a[3]}; eats ${a[4]}. ${a[6]}.`; }
  else if (type === 'food') { const a = FOOD_INFO(kind); if (a) say = `${a[2]}: it gives ${a[3]}. ${a[5]}.`; }
  else { const v = VEHICLES.find((x) => x.kind === kind); if (v) say = String(v.works).split('. ')[0] + '.'; }
  return { name, say };
}
function sceneSpec(sc, d3) {
  const type = sc.type || 'animal', B = BIOME[sc.biome], parts = [];
  const head = { title: sc.title, mode: d3 ? '3d' : '2d', intro: sc.intro, summary: sc.summary, photo: `real ${sc.title.toLowerCase()} in their natural home`, next: [`Which of these is the biggest?`, `Where do ${sc.title.toLowerCase()} live?`] };
  const n = sc.kinds.length;
  if (d3) {
    const shapes = [];
    if (B.table) shapes.push({ t: 'cylinder', r: 3.3, len: 0.16, axis: 'y', pos: [0, -0.08, 0], color: '#c99a6a', finish: 'wood' }, { t: 'cylinder', r: 0.35, len: 1.6, axis: 'y', pos: [0, -0.96, 0], color: '#9a7148', finish: 'wood' });
    else {
      // a raised island of its own earth, its ground on top: a diorama, never a flat plane
      shapes.push({ t: 'cylinder', r: 3.3, len: 0.7, axis: 'y', pos: [0, -0.36, 0], color: B.sea ? '#d9c08a' : B.snow ? '#b8c4d0' : B.sand ? '#c9a86a' : '#6b4a2f' });
      shapes.push({ t: 'ground', kind: B.sea || B.sand ? 'sand' : B.snow ? 'snow' : '', pos: [0, 0, 0], w: 3.3, ...(B.sea || B.sand || B.snow ? {} : { color: B.ground }) });
      if (B.road) shapes.push({ t: 'box', size: [6.4, 0.05, 1.7], pos: [0, 0.03, 0.2], color: '#4a4a52' }, { t: 'box', size: [0.6, 0.06, 0.08], pos: [-2, 0.04, 0.2], color: '#f3f0e6' }, { t: 'box', size: [0.6, 0.06, 0.08], pos: [0, 0.04, 0.2], color: '#f3f0e6' }, { t: 'box', size: [0.6, 0.06, 0.08], pos: [2, 0.04, 0.2], color: '#f3f0e6' });
    }
    parts.push({ id: 'ground', label: B.name, say: B.say, color: '#888888', size: 1, inside: null, shapes });
    const deco = [];
    (B.deco3 || []).forEach(([t, kind, x, z, s]) => {
      if (t === 'pond') deco.push({ t: 'cylinder', r: s, len: 0.05, axis: 'y', pos: [x, 0.03, z], color: kind === 'ice' ? '#cfe6f5' : '#4fa3dd', finish: kind === 'ice' ? 'glass' : 'water' });
      else if (t === 'tree') deco.push({ t: 'tree', kind, pos: [x, 0, z], h: s });
      else if (t === 'flower') deco.push({ t: 'flower', pos: [x, 0, z], h: s });
      else deco.push({ t, ...(kind ? { kind } : {}), pos: [x, 0, z], w: s });
    });
    if (!B.table) deco.push({ t: 'cloud', pos: [-1.5, 2.7, -1.6], w: 0.9 }, { t: 'sun', pos: [2.1, 2.9, -1.7], r: 0.28 }); // (low over the island, so the camera frames the animals, not the sky)
    if (deco.length) parts.push({ id: 'around', label: B.sea ? 'Light from above' : B.table ? 'Plates' : 'Plants and sky', say: B.sea ? 'Sunlight only reaches the top of the sea: deep down it is dark and cold.' : 'What grows and stands around them: their food, shade and shelter.', color: '#888888', size: 0.6, inside: null, shapes: deco.slice(0, 8) });
    if (B.sea) parts.push({ id: 'water', label: 'Water', say: 'Salt water: fish take in the oxygen dissolved in it through their gills.', color: '#4fa3dd', size: 1, inside: null, shapes: [{ t: 'cylinder', r: 3.2, len: 2.6, axis: 'y', pos: [0, 1.3, 0], color: '#4fa3dd', finish: 'water' }] });
    // the members: two rows, big ones at the back, each its own part; flyers in the air, swimmers in the water
    const order = sc.kinds.map((k, i) => ({ k, i, L: 1.3 * (type === 'animal' ? KIT_LEN[k] || 0.9 : type === 'food' ? 0.95 : ({ bus: 2.3, firetruck: 2.2, truck: 2.0, sedan: 1.5, motorcycle: 0.9, bicycle: 0.75 })[k] || 1.4) })); // (a little larger than life against the island, so each one reads)
    const back = order.filter((o, j) => j % 2 === 0), front = order.filter((o, j) => j % 2 === 1);
    const lay = (row, z) => row.forEach((o, j) => {
      const x = row.length === 1 ? 0 : -2.2 + (4.4 * j) / (row.length - 1), fly = type === 'animal' && (FLIES.has(o.k) && (sc.biome === 'sky' || o.k === 'pteranodon' || sc.biome === 'jungle' && o.k !== 'sloth' || sc.biome === 'desert')), swim = type === 'animal' && B.sea && SWIMS.has(o.k);
      const y = fly ? 1.7 + (j % 2) * 0.45 : swim ? 0.5 + ((j + (z > 0 ? 1 : 0)) % 3) * 0.6 : B.table ? 0.02 : 0;
      const m = sceneMember(type, o.k), shape = type === 'vehicle' ? { t: 'vehicle', kind: o.k, pos: [x, 0.05, z], w: o.L } : type === 'food' ? { t: 'food', kind: o.k, pos: [x, y, z], w: o.L } : { t: 'animal', kind: o.k, pos: [x, y, z], w: o.L, ...(fly ? { pose: 'fly' } : {}), ...(j % 2 ? { facing: '-x' } : {}) };
      parts.push({ id: o.k, label: m.name, say: m.say, color: '#888888', size: +Math.min(1, o.L / 6.6).toFixed(2), inside: null, shapes: [shape] }); // (its real length against the whole island)
    });
    if (type === 'vehicle') { lay(back, -0.25); lay(front, 0.65); } else { lay(back, -0.7); lay(front, 0.9); }
    return { ...head, axis: 'y', parts };
  }
  // flat: the ground across the bottom (the sea: water from top to bottom), the members in a row or two
  const shapes2 = B.sea ? [{ t: 'rect', x: 0, y: 0, w2: 400, h: 260, color: '#4fa3dd' }, { t: 'rect', x: 0, y: 236, w2: 400, h: 24, color: '#e3cf9a' }]
    : B.table ? [{ t: 'rect', x: 10, y: 214, w2: 380, h: 18, color: '#c99a6a' }, { t: 'rect', x: 40, y: 232, w2: 14, h: 28, color: '#9a7148' }, { t: 'rect', x: 346, y: 232, w2: 14, h: 28, color: '#9a7148' }]
    : [{ t: 'rect', x: 0, y: 222, w2: 400, h: 38, color: B.sand ? '#e3cf9a' : B.snow ? '#eef3f8' : B.ground }, ...(B.road ? [{ t: 'rect', x: 0, y: 228, w2: 400, h: 20, color: '#4a4a52' }, { t: 'line', x1: 10, y1: 238, x2: 390, y2: 238, color: '#f3f0e6' }] : [])];
  parts.push({ id: 'ground', label: B.name, say: B.say, color: B.sea ? '#4fa3dd' : '#888888', shapes: shapes2 });
  const deco2 = (B.deco2 || []).map(([t, kind, x0, s0]) => [t, kind, Math.min(352, Math.max(48, x0)), Math.min(96, s0)]).map(([t, kind, x, s]) => (t === 'tree' ? { t, kind, x, y: 224, h: s } : t === 'flower' ? { t, x, y: 224, h: s } : { t, ...(kind ? { kind } : {}), x, y: 224, w: s }));
  if (!B.sea && !B.table) deco2.push({ t: 'sun', x: 352, y: 34, r: 16 }, { t: 'cloud', x: 70, y: 36, w: 70 });
  if (deco2.length) parts.push({ id: 'around', label: B.table ? 'Plates' : 'Plants and sky', say: 'What grows and stands around them: their food, shade and shelter.', color: '#888888', shapes: deco2 });
  const two = n > 4, row1 = sc.kinds.filter((k, i) => !two || i % 2 === 0), row2 = two ? sc.kinds.filter((k, i) => i % 2 === 1) : [];
  const place = (row, base, small) => row.forEach((k, j) => {
    const x = Math.round(64 + ((272) * (j + 0.5)) / row.length), L = type === 'animal' ? KIT_LEN[k] || 0.9 : 1;
    const fly = type === 'animal' && (FLIES.has(k) && (sc.biome === 'sky' || k === 'pteranodon')), swim = type === 'animal' && B.sea && SWIMS.has(k);
    const w = Math.round(Math.min(272 / row.length - 6, (type === 'food' ? 62 : type === 'vehicle' ? 70 + L * 10 : 34 + L * 40) * (small ? 0.85 : 1)));
    const m = sceneMember(type, k), y = fly ? base - 120 : swim ? base - 70 - (j % 2) * 40 : base;
    const shape = type === 'vehicle' ? { t: 'vehicle', kind: k, x, y, w, view: 'side' } : type === 'food' ? { t: 'food', kind: k, x, y, w } : { t: 'animal', kind: k, x, y, w, ...(fly ? { pose: 'fly' } : {}) };
    parts.push({ id: k, label: m.name, say: m.say, color: '#888888', shapes: [shape] });
  });
  place(row1, B.table ? 212 : 226, false); place(row2, B.table ? 150 : 176, true);
  return { ...head, layout: `${sc.title.toLowerCase()} in their home, side by side, each named`, parts };
}
function natureSpec(N, d3) {
  const sh = d3 ? { t: N.t, ...(N.kind ? { kind: N.kind } : {}), pos: [0, N.t === 'rock' ? 0 : 1, 0], ...(N.t === 'sun' || N.t === 'moon' || N.t === 'snowflake' ? { r: N.t === 'snowflake' ? 2.6 : 1.4 } : { w: 3 }) } : { t: N.t, ...(N.kind ? { kind: N.kind } : {}), x: 200, y: N.t === 'rock' ? 220 : 120, ...(N.t === 'sun' || N.t === 'moon' || N.t === 'snowflake' ? { r: 70 } : N.t === 'bolt' ? { h: 180 } : { w: 220 }) };
  return { title: N.title, mode: d3 ? '3d' : '2d', ...(d3 ? { axis: 'y' } : { layout: `${N.title.toLowerCase()} in the middle` }), intro: N.say, summary: N.say, photo: `a real ${N.title.toLowerCase()}`, next: [`How does ${N.title.toLowerCase()} form?`], parts: [{ id: N.t, label: N.title.replace(/^(A|The) /, ''), say: N.say, color: '#888888', ...(d3 ? { size: 1, inside: null } : {}), shapes: [sh] }] };
}
// (v331) the kit before any AI's own shapes: a part of an AI's drawing that is one thing the kit knows (its name is
// "Lion", "Toaster", "Camel", "Sandwich", "Car") is drawn with the kit, in that part's place and at its size, instead
// of the blocks and balls the AI built it from. Its name, words and the rest of the drawing stay as the AI made them.
const KIT_FILL = /\b(the|an?|whole|body|model|adult|baby|young|male|female|big|small|little|one|its|real|cute|wild)\b/gi;
function kitOfLabel(label) {
  const l = String(label || '');
  for (const h of kitFind(l)) if (KIT_T.includes(h.type) && !/[a-z]{3,}/i.test(l.replace(new RegExp(h.re.source, 'gi'), ' ').replace(KIT_FILL, ' '))) return h; // (one thing: not a scene or the sky)
  return null;
}
const KIT_T = ['animal', 'appliance', 'food', 'vehicle'];
export function kitSwap(spec) {
  if (!spec || !Array.isArray(spec.parts)) return spec;
  for (const p of spec.parts) {
    if (!p || !Array.isArray(p.shapes) || p.shapes.some((x) => KIT_T.includes(String(x.t || '').toLowerCase()))) continue;
    const h = kitOfLabel(p.label);
    if (!h) continue;
    const { type, kind } = h;
    if (spec.mode === '3d') {
      const b = p.shapes.map(box3).filter(Boolean);
      if (!b.length) continue;
      const [x0, y0, z0, x1, y1, z1] = join3(b), cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, big = Math.max(x1 - x0, y1 - y0, z1 - z0, 0.4);
      const A = type === 'appliance' && APPL[kind], F = type === 'food' && FOOD[kind];
      p.shapes = [type === 'appliance' ? { t: 'appliance', kind, pos: [cx, y0, cz], h: +(A ? big * A.H / Math.max(A.W, A.H, A.D) : big).toFixed(3) }
        : { t: type, kind, pos: [cx, y0, cz], w: +big.toFixed(3), ...(F && F.cut ? { view: 'both' } : {}) }];
    } else {
      const pts = p.shapes.filter((x) => String(x.t || '').toLowerCase() !== 'text').flatMap(shapePoints).filter((q) => Number.isFinite(q[0]) && Number.isFinite(q[1]));
      if (pts.length < 2) continue;
      const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      const bw = Math.max(24, x1 - x0), bh = Math.max(20, y1 - y0), cx = (x0 + x1) / 2;
      if (type === 'animal') {
        const A = ANIMALS[kind] || ANIMALS.lion, mid = A.b === 'fish' || A.b === 'jelly' || A.b === 'octopus' || A.b === 'bat', w = Math.round(Math.min(bw, bh / animalTall(A)));
        p.shapes = [{ t: 'animal', kind, x: Math.round(cx), y: Math.round(mid ? (y0 + y1) / 2 : y1), w: Math.max(30, w) }];
      } else if (type === 'appliance') {
        const A = APPL[kind] || APPL.fridge;
        p.shapes = [{ t: 'appliance', kind, x: Math.round(cx), y: Math.round(y1), h: Math.max(30, Math.round(Math.min(bh, bw * A.H / A.W))), view: 'front' }];
      } else if (type === 'food') {
        const A = FOOD[kind] || FOOD.apple;
        p.shapes = [{ t: 'food', kind, x: Math.round(cx), y: Math.round(y1), w: Math.max(24, Math.round(Math.min(bw, bh / Math.max(0.3, A.asp || 1)))) }];
      } else {
        p.shapes = [{ t: 'vehicle', kind, x: Math.round(cx), y: Math.round(y1), w: Math.max(40, Math.round(Math.min(bw, bh / 0.45))), view: 'side' }];
      }
      p.box = null; p.anchor = null; // (its label finds the kit drawing)
    }
    p.kit = true;
  }
  return spec;
}
// ---------- a picture of a finished drawing (for Cassie to check her own work) ----------
export async function snapshot(rawSpec) {
  const spec = clean(rawSpec); if (!spec) return null;
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:640px;pointer-events:none;';
  host.className = 'ld-shot'; host.setAttribute('aria-hidden', 'true');
  document.body.appendChild(host);
  try {
    await render(host, spec, { animate: false });
    await sleep(spec.mode === '3d' ? 900 : 120);
    const bg = lightPage() ? '#ffffff' : '#141417', ink = lightPage() ? '#111111' : '#f2f2f5';
    const canvas = host.querySelector('canvas');
    if (canvas) { // (3d) the model as the student sees it, with each numbered name and its line drawn on top
      const st = host.querySelector('.ld-stage'), sw = st.clientWidth || 640, sh = st.clientHeight || 360, k = 800 / sw;
      const cv = document.createElement('canvas'); cv.width = 800; cv.height = Math.round(sh * k);
      const x = cv.getContext('2d'); x.fillStyle = bg; x.fillRect(0, 0, cv.width, cv.height); x.drawImage(canvas, 0, 0, cv.width, cv.height);
      x.font = '600 22px Arial, sans-serif'; x.textBaseline = 'middle'; x.textAlign = 'center';
      host.querySelectorAll('.ld-tag').forEach((t) => {
        if (t.hidden) return;
        const tx = parseFloat(t.style.left) * k, ty = parseFloat(t.style.top) * k, ax = +t.dataset.ax * k, ay = +t.dataset.ay * k, tw = x.measureText(t.textContent).width + 20;
        x.strokeStyle = '#888'; x.lineWidth = 2; x.beginPath(); x.moveTo(tx, ty); x.lineTo(ax, ay); x.stroke();
        x.fillStyle = ink; x.beginPath(); x.arc(ax, ay, 5, 0, Math.PI * 2); x.fill();
        x.fillStyle = bg; x.fillRect(tx - tw / 2, ty - 16, tw, 32); x.strokeRect(tx - tw / 2, ty - 16, tw, 32);
        x.fillStyle = ink; x.fillText(t.textContent, tx, ty + 1);
      });
      try { return cv.toDataURL('image/png'); } catch (e) { return null; }
    }
    const svg = host.querySelector('svg'); if (!svg) return null;
    const c2 = svg.cloneNode(true);
    c2.setAttribute('width', 800); c2.setAttribute('height', 520);
    c2.querySelectorAll('.ld-ltext, .ld-word').forEach((t) => { t.setAttribute('fill', ink); t.setAttribute('font-family', 'Arial, sans-serif'); });
    c2.querySelectorAll('.ld-lbg').forEach((r) => { r.setAttribute('fill', bg); r.setAttribute('stroke', '#888'); });
    c2.querySelectorAll('.ld-lead').forEach((l) => l.setAttribute('stroke', '#888'));
    c2.querySelectorAll('.ld-part').forEach((g) => { const col = g.style.color; g.querySelectorAll('[stroke="currentColor"]').forEach((x) => x.setAttribute('stroke', col)); g.querySelectorAll('[fill="currentColor"]').forEach((x) => x.setAttribute('fill', col)); });
    c2.insertBefore(Object.assign(document.createElementNS(NS, 'rect'), {}), c2.firstChild).setAttribute('fill', bg);
    const r0 = c2.firstChild; r0.setAttribute('x', 0); r0.setAttribute('y', 0); r0.setAttribute('width', 400); r0.setAttribute('height', 260);
    const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(c2));
    const img = new Image(); await new Promise((res) => { img.onload = res; img.onerror = res; img.src = url; });
    const cv = document.createElement('canvas'); cv.width = 800; cv.height = 520; cv.getContext('2d').drawImage(img, 0, 0, 800, 520);
    return cv.toDataURL('image/png');
  } catch (e) { return null; } finally { host.remove(); }
}

// ---------- 3D models: built piece by piece ----------
let three = null;
let threeFrom = () => Promise.all([import('./explore/three.module.min.js'), import('./explore/OrbitControls.js'), import('./explore/RoundedBoxGeometry.js').catch(() => null), import('./explore/GLTFLoader.js').catch(() => null),
  import('./explore/meshopt_decoder.module.js').catch(() => null), import('./explore/tissue.js').catch(() => null)])
  .then(([T, oc, rb, gl, mo, ti]) => ({ T: Object.assign(Object.create(null), T, rb ? { RoundedBox: rb.RoundedBoxGeometry } : {}, gl ? { GLTFLoader: gl.GLTFLoader } : {}, mo ? { MeshoptDecoder: mo.MeshoptDecoder } : {}, ti ? { tissueMaterial: ti.tissueMaterial } : {}), OrbitControls: oc.OrbitControls }));
const loadThree = () => (three || (three = threeFrom()));
// (the Chrome extension keeps its own copy of three.js: it says where) useThree(() => Promise<{ T, OrbitControls }>)
export function useThree(from) { threeFrom = from; three = null; }
// A 3D model on a stage of the caller's own, with no frame and no buttons, for a player that sets its own pace
// (the extension's card shows one part at a time with view.show). → { spec, view }, or null (no 3D here, or nothing to build)
// A flat drawing on a stage of the caller's own, with no frame and no buttons, for a player with its own pace:
// view.show(i, atOnce, ms) draws part i stroke by stroke within about ms and writes its name; view.hide(i) takes it
// away. opts.light: the paper is light (true) or dark (false), whatever the page is. → { spec, view }, or null
export function model2d(stage, rawSpec, opts = {}) {
  const was = paperLight;
  if (typeof opts.light === 'boolean') paperLight = opts.light;
  try {
    const spec = clean(rawSpec);
    if (!spec || spec.mode !== '2d') return null;
    const view = draw2d(stage, spec, { animate: false, setSay: async () => {}, hint: opts.hint || el('div') });
    return { spec, view };
  } finally { paperLight = was; }
}
export async function model3d(stage, rawSpec, opts = {}) {
  const spec = clean(rawSpec);
  if (!spec || spec.mode !== '3d') return null;
  const view = await draw3d(stage, spec, { animate: false, setSay: async () => {}, hint: opts.hint || el('div'), turn: opts.turn || false, zoom: opts.zoom !== false, matte: !!opts.matte, callout: !!opts.callout, real: !!opts.real });
  return view ? { spec, view } : null;
}
const glOk = () => { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; } };
async function draw3d(stage, spec, { animate, setSay, hint, turn = false, zoom = true, matte = false, callout = false, real = false }) {
  if (!glOk()) return null;
  let lib; try { lib = await loadThree(); } catch (e) { return null; }
  const { T, OrbitControls } = lib;
  const W = () => stage.clientWidth || 340, H = () => stage.clientHeight || 260;
  const renderer = new T.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); renderer.setSize(W(), H()); renderer.outputColorSpace = T.SRGBColorSpace;
  const canvas = renderer.domElement; canvas.className = 'ld-canvas'; canvas.style.touchAction = 'none'; stage.prepend(canvas);
  const tags = el('div', 'ld-tags'); stage.appendChild(tags);
  const lines = document.createElementNS(NS, 'svg'); lines.setAttribute('class', 'ld-tag-lines'); lines.setAttribute('aria-hidden', 'true'); stage.insertBefore(lines, tags); // (each name's thin line to its part)
  const offscreen = !!stage.closest('.ld-shot'); // (the copy she takes a picture of: always drawn)
  const scene = new T.Scene(), cam = new T.PerspectiveCamera(34, W() / H(), 0.05, 200);
  scene.add(new T.HemisphereLight(0xe4ecff, 0x3a3a48, 1.2)); // (v311: a lighter ground light, so black tyres and grey bodies show)
  const sun = new T.DirectionalLight(0xffffff, 1.7); sun.position.set(4, 6, 5); scene.add(sun);
  const rim = new T.DirectionalLight(0xbfd4ff, .95); rim.position.set(-5, 2, -4); scene.add(rim); // (v311: a stronger back light outlines dark parts on dark paper)
  // (real: the model looks like the thing itself: its finishes catch a soft studio light, and it throws a soft shadow on the floor under it)
  if (real) {
    try {
      renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap; renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
      scene.children.forEach((l) => { if (l.isHemisphereLight) l.intensity = .7; }); // (v320: the studio room lights it from every side; the flat fill only lifts the darks)
      sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024); sun.shadow.radius = 6; sun.shadow.bias = -.0005;
      const room = new T.Scene(), glowBox = (c, x, y, z, w, h, d) => { const m = new T.Mesh(new T.BoxGeometry(w, h, d), new T.MeshBasicMaterial({ color: c })); m.position.set(x, y, z); room.add(m); };
      room.add(new T.Mesh(new T.BoxGeometry(40, 40, 40), new T.MeshBasicMaterial({ color: 0x8a8f99, side: T.BackSide })));
      glowBox(0xffffff, 0, 18, 0, 26, 1, 26); glowBox(0xfff2dd, 18, 4, 6, 1, 14, 14); glowBox(0xcfe0ff, -18, 2, -6, 1, 10, 16); glowBox(0x30333a, 0, -18, 0, 40, 1, 40);
      const pm = new T.PMREMGenerator(renderer); scene.environment = pm.fromScene(room, .04).texture; pm.dispose();
    } catch (e) { /* plain lights */ }
  }
  if (matte) scene.add(new T.AmbientLight(0xffffff, .7)); // (matte: plain, bright colours for a model that floats over any page, with no shine to go dark)
  const controls = new OrbitControls(cam, canvas); controls.enableDamping = true; controls.enablePan = false; controls.minDistance = 2; controls.maxDistance = 40;
  controls.zoomToCursor = true; // (v335) a pinch or the wheel zooms in on the part under your fingers, as in the Labs' anatomy
  // (v337) a pinch on the model zooms the model, never the whole page or app: Safari on a phone zooms the page with two
  // fingers unless the touch is held back, and a computer's trackpad pinch arrives as a wheel with Ctrl
  const pinchOnly = (e) => { if (e.touches && e.touches.length > 1 && e.cancelable) e.preventDefault(); };
  stage.addEventListener('touchstart', pinchOnly, { passive: false }); stage.addEventListener('touchmove', pinchOnly, { passive: false });
  ['gesturestart', 'gesturechange', 'gestureend'].forEach((t) => stage.addEventListener(t, (e) => e.preventDefault(), { passive: false }));
  stage.addEventListener('wheel', (e) => { if (e.ctrlKey && e.cancelable) e.preventDefault(); }, { passive: false });
  // (v336) and, as there, two fingers (or a right drag) move it, so you can go to the part you zoomed into; your own touch
  // always wins over a glide of hers, and the view stays where you left it
  controls.enablePan = true; controls.screenSpacePanning = true;
  let userMoved = false;
  controls.addEventListener('start', () => { userMoved = true; camTo = null; aimTo = null; });
  if (!zoom) stage.addEventListener('wheel', (e) => { if (!e.ctrlKey) e.stopPropagation(); }, { capture: true }); // (a model that floats over a page: the wheel still scrolls the page; v337: a pinch, on a phone or a trackpad, zooms the model, as in the Labs' anatomy)
  // (turn: the model turns slowly by itself until the student takes hold of it)
  // turn: true goes all the way round; 'sway' rocks gently about the best side, so a long model is never seen end on
  let sway = turn === 'sway' && !still();
  if (turn === true && !still()) { controls.autoRotate = true; controls.autoRotateSpeed = 1.1; controls.addEventListener('start', () => { controls.autoRotate = false; }); }
  if (sway) controls.addEventListener('start', () => { sway = false; });
  const model = new T.Group(); scene.add(model);
  const AX = { x: new T.Vector3(1, 0, 0), y: new T.Vector3(0, 1, 0), z: new T.Vector3(0, 0, 1) };
  const v3 = (a, d = [0, 0, 0]) => (Array.isArray(a) ? new T.Vector3(num(a[0], -20, 20, d[0]), num(a[1], -20, 20, d[1]), num(a[2], -20, 20, d[2])) : new T.Vector3(...d));
  // a shape along an axis: three.js builds cylinders and cones along y, so turn them to x or z
  const along = (obj, axis) => { if (axis === 'x') obj.rotation.z = -Math.PI / 2; else if (axis === 'z') obj.rotation.x = Math.PI / 2; return obj; };
  // (v320) a model made in Blender for the drawing book (models/<name>.glb): each part's object carries the part's id as
  // its name, so it is named, picked, faded, pulled apart and spun like a built one; with no Blender model (or no loader,
  // as in the extension), the part is built from its shapes as always
  let glb = null;
  if (spec.glb && T.GLTFLoader) {
    try {
      const loader = new T.GLTFLoader(); if (T.MeshoptDecoder) loader.setMeshoptDecoder(T.MeshoptDecoder); // (v321: the models are packed small, as the Labs' body is)
      glb = await new Promise((ok, no) => loader.load(new URL(spec.glb, import.meta.url).href, ok, undefined, no));
    } catch (e) { glb = null; }
  }
  const glbPart = (id) => (glb ? glb.scene.getObjectByName(id) : null);
  stage.dataset.model = glb ? 'blender' : 'built'; // (which one this is: for the tests, and for anyone looking)
  const groups = spec.parts.map((p, i) => {
    const g = new T.Group(); g.userData = { i, part: p };
    const mat = finishMat(T, p.color, real ? p.finish : null, { real, matte, glow: p.glow });
    const made = []; // ([shape, its mesh], for the pieces that spin)
    const fromBlender = glbPart(p.id);
    if (fromBlender) {
      const copy = fromBlender.clone(true); copy.position.set(0, 0, 0); copy.rotation.set(0, 0, 0); copy.scale.set(1, 1, 1); // (its parts keep their places in the model)
      copy.traverse((m) => {
        if (!m.isMesh) return;
        const was = m.material, kind = m.userData && m.userData.tissue;
        // (v321) living tissue looks as it does in the Labs' 3D body: a wet shine, fine detail in the surface, no two patches
        // the same shade (explore/tissue.js); see-through parts (the cornea, the lens, the lungs) keep their own glass
        if (kind && T.tissueMaterial && !(was.transmission > 0) && was.opacity >= 1) {
          m.material = T.tissueMaterial(T, kind, { vertexColors: false, color: was.color.clone(), side: T.DoubleSide, transparent: true, scale: +m.userData.tissueScale || 1 });
        } else m.material = was.clone();
        m.material.transparent = true; m.material.side = T.DoubleSide;
        if (p.glow) { m.material.emissive = new T.Color(p.color); m.material.emissiveIntensity = .5; }
      });
      [...copy.children].forEach((ch) => { g.add(ch); const ax = ch.userData && ch.userData.spin; if (['x', 'y', 'z'].includes(ax)) made.push([{ t: 'disc', axis: ax }, ch]); });
    }
    for (const s of fromBlender ? [] : p.shapes) { const own = real && FINISH[s.finish] && s.finish !== p.finish ? finishMat(T, s.color && /^#[0-9a-f]{3,8}$/i.test(s.color) ? s.color : p.color, s.finish, { real, matte, glow: p.glow }) : mat; const m = shape3d(T, s, own, along, v3, AX); if (m) { g.add(m); made.push([s, m]); } }
    if (real && !p.shell) g.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
    // (v280) a part that spins: each of its round pieces (a wheel, disc, gear, fan, shaft) turns in place about its own
    // axle, through its own middle; it never swings round the whole model, and a chain or frame in the part stays still
    if (p.spin) {
      const spinners = [];
      made.forEach(([sh, m]) => {
        const kind = String(sh.t || sh.type || '').toLowerCase();
        if (!/^(torus|ring|disc|cylinder|blades|cone|lathe)$/.test(kind)) return;
        const axle = ['x', 'y', 'z'].includes(sh.axis) ? sh.axis : spec.axis, pivot = new T.Group();
        pivot.position.copy(m.position); m.position.set(0, 0, 0);
        g.add(pivot); pivot.add(m); pivot.userData.axle = axle; spinners.push(pivot);
      });
      g.userData.spinners = spinners;
    }
    if (p.beat && g.children.length) { // (v314)
      const c = new T.Box3().setFromObject(g).getCenter(new T.Vector3()), piv = new T.Group(); piv.position.copy(c);
      [...g.children].forEach((ch) => { ch.position.sub(c); piv.add(ch); }); g.add(piv); g.userData.beat = { piv, kind: p.beat };
    }
    model.add(g);
    return g;
  }).filter((g) => g.children.length);
  if (!groups.length) { renderer.dispose(); canvas.remove(); return null; }
  if (animate) groups.forEach((g) => { g.visible = false; }); // (v337: a model about to be built shows nothing first: no kit model appears whole and is then rebuilt)
  // fit the camera to the whole model
  const box = new T.Box3().setFromObject(model), size = box.getSize(new T.Vector3()), mid = box.getCenter(new T.Vector3());
  model.position.sub(mid); model.updateMatrixWorld(true);
  const R = Math.max(size.x, size.y, size.z, 1);
  controls.minDistance = Math.max(.03, R * .03); // (v336: right up close to a small part, as in the Labs' anatomy)
  // (v337) close up, nothing is sliced off by the camera, and no piece blinks out as it turns: the near plane follows the
  // model's size, and every piece is always drawn (a kit piece moved after it was made, a banana's halves, kept a stale
  // idea of where it is, so it vanished at some angles and came back at others)
  cam.near = Math.max(.002, R * .0015); cam.far = Math.max(200, R * 80); cam.updateProjectionMatrix();
  model.traverse((o) => { if (o.isMesh || o.isLine || o.isPoints) o.frustumCulled = false; });
  // (v310) a flat model (the solar system, an atom's shells) is seen from higher up, so it fills the frame instead of a thin line
  const VIEW = (size.y < Math.max(size.x, size.z) * .3 ? new T.Vector3(.35, .95, .75) : new T.Vector3(.55, .38, 1.02)).normalize();
  const narrowFit = callout && W() < 520 && spec.parts.filter((p) => p.label).length > 6; // (v310: numbers, not name columns)
  // (v253) the camera stands back far enough that the whole model (or the pulled-apart one) is in the frame from any side
  // the nearest distance along a direction at which every corner of the box is inside the frame, with room for the names
  const fitBox = (bx, dir) => {
    const cs = []; for (const x of [bx.min.x, bx.max.x]) for (const y of [bx.min.y, bx.max.y]) for (const z of [bx.min.z, bx.max.z]) cs.push(new T.Vector3(x, y, z));
    const probe = cam.clone(), fits = (d) => { probe.position.copy(dir).multiplyScalar(d); probe.lookAt(0, 0, 0); probe.updateMatrixWorld(); probe.updateProjectionMatrix(); return cs.every((c) => { if (c.clone().applyMatrix4(probe.matrixWorldInverse).z > -probe.near * 4) return false; const q = c.clone().project(probe); return Math.abs(q.x) <= (callout && !narrowFit ? .5 : .78) && Math.abs(q.y) <= (callout && !narrowFit ? .8 : .72); }); };
    let lo = .5, hi = 400; for (let k = 0; k < 40; k++) { const mid = (lo + hi) / 2; if (fits(mid)) hi = mid; else lo = mid; }
    return hi;
  };
  const fullBox = new T.Box3().setFromObject(model); // (its full size, before the build-up animation shrinks the parts)
  if (real) { // (the floor only catches the shadow; and the sun's shadow reaches round the whole model)
    const floor = new T.Mesh(new T.PlaneGeometry(R * 6, R * 6), new T.ShadowMaterial({ opacity: .22 })); floor.rotation.x = -Math.PI / 2; floor.position.y = fullBox.min.y - R * .04; floor.receiveShadow = true; scene.add(floor);
    const sc = sun.shadow.camera; sc.left = sc.bottom = -R * 1.4; sc.right = sc.top = R * 1.4; sc.near = .1; sc.far = R * 8; sun.position.set(R * .7, R * 1.6, R * .9); sc.updateProjectionMatrix();
  }
  const fitDist = () => fitBox(fullBox, VIEW);
  let camTo = null;
  const home = VIEW.clone().multiplyScalar(fitDist());
  cam.position.copy(home); controls.target.set(0, 0, 0); controls.maxDistance = Math.max(40, home.length() * 3); controls.update();
  // where each part sits (for its name tag, and for pulling it apart along the main axis)
  const ax = AX[spec.axis];
  groups.forEach((g) => {
    const b = new T.Box3().setFromObject(g), mid = b.getCenter(new T.Vector3());
    // (v280) a name points AT the part: the middle of its piece nearest its middle (a frame of tubes has an empty middle)
    let at = mid, best = Infinity;
    g.traverse((m) => { if (!m.isMesh) return; const c = new T.Box3().setFromObject(m).getCenter(new T.Vector3()), d = c.distanceTo(mid); if (d < best) { best = d; at = c; } });
    g.userData.center = at; g.userData.home = g.position.clone();
  });
  // (v314) what moves through it (water, air, blood, electricity): dots along a smooth path, changing colour on the way
  const flowGroup = new T.Group(); flowGroup.visible = false; model.add(flowGroup); let flowWas = false;
  const flow3 = (spec.flows || []).map((f) => {
    const curve = new T.CatmullRomCurve3(f.pts.map((q) => new T.Vector3(q[0], q[1], q[2])));
    const L = curve.getLength(); if (!(L > 0.01)) return null;
    // (v332) in a Blender model (a real heart, the lungs) the blood and air run inside solid walls: they are drawn through them, like an X-ray
    const xray = !!spec.glb, tube = new T.Mesh(new T.TubeGeometry(curve, 64, R * (xray ? 0.009 : 0.006), 6, false), new T.MeshBasicMaterial({ color: new T.Color(f.color), transparent: true, opacity: xray ? 0.45 : 0.3, depthWrite: false, depthTest: !xray }));
    tube.renderOrder = xray ? 10 : 0; flowGroup.add(tube);
    const c0 = new T.Color(f.color), c1 = new T.Color(f.to || f.color), geo = new T.SphereGeometry(R * (xray ? 0.024 : 0.016), 12, 8);
    const dots = Array.from({ length: f.dots }, (_, k) => { const m = new T.Mesh(geo, new T.MeshBasicMaterial({ color: c0.clone(), transparent: true, opacity: 1, depthTest: !xray })); m.renderOrder = xray ? 11 : 0; flowGroup.add(m); return { m, u: k / f.dots }; });
    return { f, curve, L, c0, c1, dots };
  }).filter(Boolean);
  let moving3 = false, paused3 = false;
  const lay3 = () => flow3.forEach((x) => x.dots.forEach((d) => { d.m.position.copy(x.curve.getPointAt(Math.min(1, Math.max(0, d.u || 0)))); d.m.material.color.lerpColors(x.c0, x.c1, d.u); d.m.material.opacity = picked && x.f.of.length && !x.f.of.includes(picked.userData.part.id) ? 0.15 : 1; }));
  const order = groups.filter((g) => !g.userData.part.shell).sort((a, b) => a.userData.center.dot(ax) - b.userData.center.dot(ax));
  // (v332) one kit model (a food, an appliance, a vehicle) pulls apart too: its own pieces spread out from its middle
  // (a sandwich's layers, a toaster's case off its slots), worked out the first time it is pulled apart
  const soloKit = order.length === 1 && order[0].userData.part.shapes.some((s) => ['food', 'appliance', 'vehicle'].includes(String(s.t || '').toLowerCase()));
  let soloPieces = null;
  const soloSplit = () => {
    if (soloPieces) return soloPieces;
    let n = order[0]; while (n.children.length === 1) n = n.children[0];
    const sc = order[0].scale.x; order[0].scale.setScalar(1); order[0].updateMatrixWorld(true);
    const inv = n.matrixWorld.clone().invert(), c = new T.Box3().setFromObject(n).getCenter(new T.Vector3()).applyMatrix4(inv);
    const whole = new T.Box3().setFromObject(n).applyMatrix4(inv).getSize(new T.Vector3()).length();
    soloPieces = n.children.filter((ch) => ch.isMesh || ch.children.length).map((ch) => { const pc = new T.Box3().setFromObject(ch).getCenter(new T.Vector3()).applyMatrix4(inv), off = pc.sub(c); ch.userData.apartHome = ch.position.clone(); ch.userData.apartBy = off.clone().multiplyScalar(.9).add(off.lengthSq() > 1e-8 ? off.normalize().multiplyScalar(whole * .14) : new T.Vector3()); return ch; }); // (each piece out from the middle: further for one far out, and a gap even for a thin layer close in)
    order[0].scale.setScalar(sc); order[0].updateMatrixWorld(true);
    return soloPieces;
  };
  const tagEls = groups.map((g, i) => { const p = g.userData.part; if (!p.label) return null; const t = el('button', 'ld-tag', `${spec.parts.indexOf(p) + 1} ${p.label}`); t.type = 'button'; t.hidden = true; t.addEventListener('click', (e) => { e.stopPropagation(); pickAndGo(g); }); tags.appendChild(t); return t; });
  let wasCompact = null;
  const legend3 = el('p', 'ld-legend', spec.parts.filter((p) => p.label).map((p) => `${spec.parts.indexOf(p) + 1}\u00a0${p.label.replace(/ /g, '\u00a0')}`).join('   ')); legend3.hidden = true; stage.after(legend3);
  let exploded = false, opened = false, picked = null, raf = 0, last = performance.now(), visible = true, calloutAz = null, calloutApart = false;
  const shells = groups.filter((g) => g.userData.part.shell);
  const fade = (g, o) => g.traverse((m) => { if (m.material) { const k = m.userData.keepOpacity || 1; m.material.opacity = o * k; m.material.depthWrite = o > .6 && k >= 1; } });
  const hintText = 'Drag to turn it. Pinch to zoom. Tap a part';
  hint.textContent = hintText;
  let focused = false, aimTo = null; // (moved in on a part by a follow-up: showing it all again stands back)
  const pick = (g) => {
    picked = picked === g ? null : g;
    if (!picked && focused) { focused = false; aimTo = new T.Vector3(); camTo = cam.position.clone().sub(controls.target).normalize().multiplyScalar(home.length()); if (still()) { controls.target.set(0, 0, 0); cam.position.copy(camTo); aimTo = camTo = null; } }
    groups.forEach((x) => fade(x, picked && x !== picked ? .16 : x.userData.part.shell && (opened || exploded) ? .14 : 1));
    if (flowGroup.visible) lay3();
    view.onPick && view.onPick(picked ? picked.userData.part : null);
  };
  // (v335) picked from its name or by a tap: with many parts the camera also goes in close to it (tapped again: it stands back)
  const pickAndGo = (g) => { pick(g); if (picked === g && groups.length >= 4 && view && view.focus) view.focus(g.userData.i); };
  // (v336) a double tap or double click flies in close to that very spot, as in the Labs' anatomy
  const flyIn = (x, y) => {
    const r = canvas.getBoundingClientRect(); pt.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1); ray.setFromCamera(pt, cam);
    const hit = ray.intersectObjects(groups.filter((g) => g.visible), true).find((h) => h.object.visible && !(h.object.material && h.object.material.opacity < .1));
    if (!hit) return false;
    const dist = cam.position.distanceTo(controls.target), dir = cam.position.clone().sub(controls.target).normalize();
    userMoved = true; aimTo = hit.point.clone(); camTo = hit.point.clone().add(dir.multiplyScalar(Math.max(controls.minDistance * 1.6, dist * .42)));
    if (still()) { controls.target.copy(aimTo); cam.position.copy(camTo); aimTo = camTo = null; }
    return true;
  };
  let lastTap = { t: 0, x: 0, y: 0 };
  canvas.addEventListener('dblclick', (e) => { e.preventDefault(); flyIn(e.clientX, e.clientY); });
  // a tap (not a drag) picks the part under the finger
  const ray = new T.Raycaster(), pt = new T.Vector2(); let down = null;
  canvas.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
  canvas.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return;
    if (e.pointerType === 'touch') { const now = performance.now(); if (now - lastTap.t < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) { lastTap.t = 0; flyIn(e.clientX, e.clientY); return; } lastTap = { t: now, x: e.clientX, y: e.clientY }; }
    const r = canvas.getBoundingClientRect(); pt.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(pt, cam);
    const hits = ray.intersectObjects(groups.filter((g) => g.visible && !(g.userData.part.shell && (opened || exploded))), true);
    let g = hits.length ? hits[0].object : null; while (g && !groups.includes(g)) g = g.parent;
    if (g) pickAndGo(g); else if (picked) pick(picked);
  });
  const tmp = new T.Vector3();
  let animators = []; // (v327: filled once the model is built)
  const tick = (now) => {
    raf = requestAnimationFrame(tick);
    if (!visible) return;
    const dt = Math.min(.05, (now - last) / 1000); last = now;
    if ((!still() && !paused3) || moving3) groups.forEach((g) => { if (g.visible && g.userData.spinners) g.userData.spinners.forEach((sp) => { sp.rotation[sp.userData.axle] += dt * 3; }); });
    if ((!still() && !paused3) || moving3) animators.forEach((o) => o.userData.animate(now / 1000));
    if (moving3) { // (v314) a beating part, and the dots on their way
      const beat = (now % 860) / 860, sq = beat < 0.18 ? Math.sin((beat / 0.18) * Math.PI) : 0, br = (Math.sin((now / 1700) * Math.PI) + 1) / 2;
      groups.forEach((g) => { const b = g.userData.beat; if (b) b.piv.scale.setScalar(b.kind === 'breathe' ? 1 + br * 0.04 : 1 - sq * 0.05); });
      const push = groups.some((g) => g.userData.beat && g.userData.beat.kind === 'beat') ? 1 + sq * 1.6 : 1;
      flow3.forEach((x) => x.dots.forEach((d) => { d.u = (d.u + (Math.max(0, dt) * x.f.speed * push * R * 0.28) / x.L) % 1; })); // (the first frame's clock can run a hair behind)
      lay3();
    }
    groups.forEach((g) => { const to = g.userData.to; if (to) { g.position.lerp(to, Math.min(1, dt * 6)); if (g.position.distanceTo(to) < .002) { g.position.copy(to); g.userData.to = null; } } });
    if (soloPieces) soloPieces.forEach((ch) => { const to = ch.userData.apartTo; if (to) { ch.position.lerp(to, Math.min(1, dt * 6)); if (ch.position.distanceTo(to) < .002) { ch.position.copy(to); ch.userData.apartTo = null; } } }); // (v332)
    groups.forEach((g) => { const sl = g.userData.slide; if (sl) { const k = Math.min(1, Math.max(0, (now - sl.t0 - 400) / 1100)), e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; g.position.lerpVectors(sl.from, g.userData.home, e); if (k >= 1) g.userData.slide = null; } }); // (it waits a moment, then slides home)
    if (aimTo) { controls.target.lerp(aimTo, Math.min(1, dt * 5)); if (controls.target.distanceTo(aimTo) < .005) { controls.target.copy(aimTo); aimTo = null; } }
    if (camTo) { cam.position.lerp(camTo, Math.min(1, dt * 5)); if (cam.position.distanceTo(camTo) < .01) camTo = null; }
    else if (sway) { const a = Math.sin(now / 2600) * .32, d = cam.position.length(), y = home.y / home.length(), r = Math.sqrt(1 - y * y), a0 = Math.atan2(home.x, home.z); cam.position.set(Math.sin(a0 + a) * r * d, y * d, Math.cos(a0 + a) * r * d); }
    controls.update();
    renderer.render(scene, cam);
    // each name: a spot near its part, clear of the other names, with a thin line to the part
    const spots = [], segs = [], w = W(), h = H();
    // (v310) a narrow screen (a phone, the side panel) and many parts: a small number on each part, the names listed
    // under the model, so names never cover it (a tap on a part still shows its name and what it does)
    const compact = callout && w < 520 && tagEls.filter(Boolean).length > 6;
    if (compact !== wasCompact) {
      wasCompact = compact;
      tagEls.forEach((t, i) => { if (!t) return; const p = groups[i].userData.part, n = spec.parts.indexOf(p) + 1; t.textContent = compact ? String(n) : `${n} ${p.label}`; t.classList.toggle('ld-num', compact); if (compact) t.setAttribute('aria-label', `${n} ${p.label}`); else t.removeAttribute('aria-label'); t._spot = null; });
      legend3.hidden = !compact;
    }
    if (callout && !compact) {
      // (names stand in a column on each side of the model, never on it, each with a line to its part)
      const shown = [];
      groups.forEach((g, i) => {
        const t = tagEls[i]; if (!t) return;
        if (!g.visible || (g.userData.part.shell && (opened || exploded))) { t.hidden = true; return; }
        if (focused && picked && g !== picked && !(spec.fresh && spec.fresh.includes(g.userData.part.id))) { t.hidden = true; return; } // (moved in on a part: its name, and what the answer added)
        t.hidden = false; tmp.copy(g.userData.center).add(g.position).sub(g.userData.home); tmp.project(cam);
        shown.push({ t, px: (tmp.x + 1) / 2 * w, py: (1 - tmp.y) / 2 * h, tw: t.offsetWidth || 80, th: t.offsetHeight || 24 });
      });
      let x0 = Infinity, x1 = -Infinity;
      if (!exploded) for (const x of [fullBox.min.x, fullBox.max.x]) for (const y of [fullBox.min.y, fullBox.max.y]) for (const z of [fullBox.min.z, fullBox.max.z]) { tmp.set(x, y, z).project(cam); const sx = (tmp.x + 1) / 2 * w; x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); }
      else shown.forEach((s) => { x0 = Math.min(x0, s.px - 48); x1 = Math.max(x1, s.px + 48); });
      const az = Math.atan2(cam.position.x, cam.position.z);
      if (calloutAz == null || Math.abs(Math.atan2(Math.sin(az - calloutAz), Math.cos(az - calloutAz))) > 1 || calloutApart !== exploded) { calloutAz = az; calloutApart = exploded; tagEls.forEach((t) => { if (t) t._side = 0; }); }
      const fresh = shown.filter((s) => !s.t._side).sort((a, b) => a.px - b.px), had = { L: shown.filter((s) => s.t._side === -1).length, R: shown.filter((s) => s.t._side === 1).length };
      fresh.forEach((s) => { const left = s.px < (x0 + x1) / 2 ? had.L <= had.R + 1 : had.L + 1 < had.R; s.t._side = left ? -1 : 1; if (left) had.L++; else had.R++; });
      for (const side of [-1, 1]) {
        const col = shown.filter((s) => s.t._side === side).sort((a, b) => a.py - b.py);
        let y = -Infinity;
        col.forEach((s) => { s.y = Math.max(s.py, y + s.th + 8, s.th / 2 + 4); y = s.y; });
        let cap = h - 4;
        for (let k = col.length - 1; k >= 0; k--) { const s = col[k]; s.y = Math.min(s.y, cap - s.th / 2); cap = s.y - s.th / 2 - 8; }
        col.forEach((s) => {
          const x = side < 0 ? Math.max(s.tw / 2 + 4, x0 - 20 - s.tw / 2) : Math.min(w - s.tw / 2 - 4, x1 + 20 + s.tw / 2);
          s.t.style.left = x + 'px'; s.t.style.top = s.y + 'px'; s.t.dataset.ax = Math.round(s.px); s.t.dataset.ay = Math.round(s.py);
          const ex = side < 0 ? x + s.tw / 2 : x - s.tw / 2;
          segs.push(`<line x1="${ex.toFixed(1)}" y1="${s.y.toFixed(1)}" x2="${s.px.toFixed(1)}" y2="${s.py.toFixed(1)}"/><circle cx="${s.px.toFixed(1)}" cy="${s.py.toFixed(1)}" r="2.5"/>`);
        });
      }
    } else groups.forEach((g, i) => {
      const t = tagEls[i]; if (!t) return;
      if (!g.visible || (g.userData.part.shell && (opened || exploded))) { t.hidden = true; return; }
      t.hidden = false; tmp.copy(g.userData.center).add(g.position).sub(g.userData.home); tmp.project(cam);
      const px = (tmp.x + 1) / 2 * w, py = (1 - tmp.y) / 2 * h, tw = t.offsetWidth || 80, th = t.offsetHeight || 24;
      const free = (x, y) => x - tw / 2 >= 4 && x + tw / 2 <= w - 4 && y - th / 2 >= 4 && y + th / 2 <= h - 4 && !spots.some((q) => Math.abs(q.x - x) < (q.w + tw) / 2 + 6 && Math.abs(q.y - y) < (q.h + th) / 2 + 4);
      const tries = [];
      if (t._spot) tries.push(t._spot); // (stay where it was while that is still free, so the names do not jump about)
      for (const r of [36, 60, 88]) for (const [dx, dy] of [[0, -1], [0, 1], [.8, -.6], [-.8, -.6], [1, 0], [-1, 0], [.8, .6], [-.8, .6]]) tries.push([dx * (r + tw / 4), dy * r]);
      const at = tries.find(([dx, dy]) => free(px + dx, py + dy)) || [0, -36];
      t._spot = at;
      const x = Math.min(w - tw / 2 - 4, Math.max(tw / 2 + 4, px + at[0])), y = Math.min(h - th / 2 - 4, Math.max(th / 2 + 4, py + at[1]));
      spots.push({ x, y, w: tw, h: th });
      t.style.left = x + 'px'; t.style.top = y + 'px';
      t.dataset.ax = Math.round(px); t.dataset.ay = Math.round(py);
      const ex = Math.min(Math.max(px, x - tw / 2), x + tw / 2), ey = Math.min(Math.max(py, y - th / 2), y + th / 2);
      segs.push(`<line x1="${ex.toFixed(1)}" y1="${ey.toFixed(1)}" x2="${px.toFixed(1)}" y2="${py.toFixed(1)}"/><circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="2.5"/>`);
    });
    lines.setAttribute('viewBox', `0 0 ${w} ${h}`); lines.innerHTML = segs.join('');
  };
  raf = requestAnimationFrame(tick);
  const io = !offscreen && 'IntersectionObserver' in window ? new IntersectionObserver((en) => { visible = en.some((x) => x.isIntersecting); }) : null; if (io) io.observe(stage);
  let lastWH = '';
  const ro = 'ResizeObserver' in window ? new ResizeObserver(() => { const wh = W() + 'x' + H(); if (wh === lastWH) return; lastWH = wh; renderer.setSize(W(), H()); cam.aspect = W() / H(); cam.updateProjectionMatrix(); if (!exploded && !userMoved) { home.copy(VIEW).multiplyScalar(fitDist()); camTo = cam.position.clone().normalize().multiplyScalar(home.length()); } }) : null; if (ro) ro.observe(stage); // (v336: a real change of size only; once you have zoomed or turned it, your view is kept)
  const gone = new MutationObserver(() => { if (!stage.isConnected) { cancelAnimationFrame(raf); renderer.dispose(); io && io.disconnect(); ro && ro.disconnect(); gone.disconnect(); } });
  gone.observe(document.body, { childList: true, subtree: true });
  const byPart = (i) => groups.find((g) => g.userData.i === i) || null;
  const SIDES = { front: [0, .14, 1], back: [0, .14, -1], left: [-1, .14, .001], right: [1, .14, .001], side: [1, .14, .001], top: [.001, 1, .04] };
  animators = []; groups.forEach((g) => g.traverse((o) => { if (typeof o.userData.animate === 'function') animators.push(o); })); // (v327: animals that walk, fly and swim)
  const motion3 = flow3.length > 0 || groups.some((g) => g.userData.beat || g.userData.spinners) || animators.length > 0;
  const view = {
    hintText,
    // (v314) moving parts: move() once it is built (move(true) even with Reduce Motion); pause() stops them
    motion: motion3,
    get moving() { return moving3; },
    move(force) { if (!motion3) return false; flowGroup.visible = flow3.length > 0 && !exploded; flowWas = flow3.length > 0; lay3(); if (still() && !force) return false; moving3 = true; paused3 = false; return true; },
    pause() { moving3 = false; paused3 = true; },
    stepNext() { const list = groups.filter((g) => !g.userData.part.shell); if (!list.length) return -1; const k = list.indexOf(picked), g = list[(k + 1) % list.length]; picked = null; pick(g); if (!moving3) lay3(); return g.userData.i; },
    // one part at a time, for a player with its own pace: show(i) brings part i in (it pops in, slides into its
    // place from "from", and the camera goes to its "view"); show(i, true) puts it there at once; hide(i) takes it away
    has: (i) => !!byPart(i),
    show(i, atOnce) {
      const g = byPart(i); if (!g) return;
      const p = g.userData.part, dim = p.shell && (opened || exploded) ? .14 : 1;
      g.visible = true; g.userData.slide = null;
      if (p.view && SIDES[p.view] && !atOnce) camTo = new T.Vector3(...SIDES[p.view]).normalize().multiplyScalar(cam.position.length());
      if (atOnce || still()) { g.scale.setScalar(1); fade(g, dim); if (!exploded) g.position.copy(g.userData.home); return; }
      if (p.from && !exploded) { g.position.copy(g.userData.home).add(new T.Vector3(p.from[0], p.from[1], p.from[2])); g.userData.slide = { from: g.position.clone(), t0: performance.now() }; }
      const t0 = performance.now();
      const step = () => { if (!g.visible) return; const k = Math.min(1, (performance.now() - t0) / 550), e = 1 - Math.pow(1 - k, 3); g.scale.setScalar(.6 + .4 * e); fade(g, Math.min(e, dim)); if (k < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    },
    hide(i) { const g = byPart(i); if (g) { g.visible = false; g.userData.slide = null; } },
    // (a stage that is not under <body>, like the extension's: it says when it is done)
    stop() { cancelAnimationFrame(raf); renderer.dispose(); io && io.disconnect(); ro && ro.disconnect(); gone.disconnect(); },
    async play(again) {
      if (!animate && !again) return;
      // (v306) a follow-up: what was there already is there at once; only the parts it adds are built
      const old = (g) => !again && spec.fresh && !spec.fresh.includes(g.userData.part.id);
      groups.forEach((g) => { g.visible = old(g); g.scale.setScalar(old(g) ? 1 : .6); });
      moving3 = false; flowGroup.visible = false;
      if (spec.intro) await setSay(spec.intro, true);
      for (const g of groups) {
        if (old(g)) continue;
        const sh = g.userData.part.shell;
        g.visible = true;
        const t0 = performance.now();
        await new Promise((res) => { const step = () => { const k = Math.min(1, (performance.now() - t0) / 550); const e = 1 - Math.pow(1 - k, 3); g.scale.setScalar(.6 + .4 * e); fade(g, sh ? Math.min(e, .14) : e); if (k < 1) requestAnimationFrame(step); else res(); }; requestAnimationFrame(step); });
        await setSay(g.userData.part.say || g.userData.part.label, true, g.userData.part.label);
        await sleep(450);
      }
    },
    unpick() { if (picked) pick(picked); },
    // (v307) the part a follow-up is about: the camera moves in on it (from the side you are looking from), the other
    // parts fade, and a case it sits in is seen through. A tap on the empty space, or on it again, shows it all.
    focus(i) {
      const g = groups.find((x) => x.userData.i === i); if (!g) return;
      sway = false; picked = g; focused = true;
      if (shells.length && !g.userData.part.shell) opened = true; // (a part in a case: seen through the case)
      groups.forEach((x) => fade(x, x === g ? 1 : x.userData.part.shell && opened ? .08 : .16));
      // the camera turns to look AT the part and comes close enough that it fills the middle of the view
      const pb = new T.Box3().setFromObject(g), c = pb.getCenter(new T.Vector3()), big = pb.getSize(new T.Vector3()).length();
      const dir = cam.position.clone().sub(controls.target).normalize();
      const d = Math.min(home.length(), Math.max(R * .3, big / (Math.tan(cam.fov * Math.PI / 360) * Math.min(1, W() / H())) * (callout ? 1.1 : .8))); // (a narrow phone: fitted to the width)
      aimTo = c.clone(); camTo = c.clone().add(dir.multiplyScalar(d));
      if (still()) { controls.target.copy(aimTo); cam.position.copy(camTo); aimTo = camTo = null; }
    },
    get opened() { return opened; },
    setOpen(v) { opened = !!v; shells.forEach((g) => fade(g, opened ? .14 : 1)); },
    open: shells.length ? () => { opened = !opened; if (picked) pick(picked); shells.forEach((g) => fade(g, opened ? .14 : 1)); return opened; } : null,
    explode: order.length > 1 || soloKit ? () => {
      exploded = !exploded; if (picked) pick(picked);
      if (flow3.length) { if (exploded) { flowWas = flowGroup.visible; flowGroup.visible = false; } else flowGroup.visible = flowWas; } // (v335: pulled apart, the parts alone: what flows through them would only float in the gaps)
      if (order.length === 1) soloSplit().forEach((ch) => { ch.userData.apartTo = exploded ? ch.userData.apartHome.clone().add(ch.userData.apartBy) : ch.userData.apartHome.clone(); });
      const gap = R * .22, n = order.length;
      order.forEach((g, k) => { g.userData.to = exploded ? g.userData.home.clone().addScaledVector(ax, (k - (n - 1) / 2) * gap) : g.userData.home.clone(); });
      shells.forEach((g) => { g.visible = !exploded; });
      // stand back to fit the pulled-apart model (from where the student is looking now)
      const spread = new T.Box3(); groups.forEach((g) => { if (!g.visible) return; const sc = g.scale.x; g.scale.setScalar(1); g.updateMatrixWorld(true); const b = new T.Box3().setFromObject(g); g.scale.setScalar(sc); g.updateMatrixWorld(true); if (g.userData.to) b.translate(g.userData.to.clone().sub(g.position)); spread.union(b); });
      const dir = cam.position.clone().normalize();
      camTo = dir.multiplyScalar((exploded && !spread.isEmpty() ? fitBox(spread, dir) : home.length()) * (exploded && order.length === 1 ? 1.7 : 1)); // (v332: one model's pieces spread past its own box: stand further back)
      return exploded;
    } : null,
  };
  return view;
}
// (v320) a part's material: its real finish (FINISH), its colour kept off pure black and pure white for anything that is
// not metal (no real surface is either: the Blender skills' first albedo rule), glass and water see-through
function finishMat(T, colour, finish, { real, matte, glow }) {
  const f = real ? FINISH[finish] : null, c = new T.Color(colour || '#9aa3ad');
  if (real && (!f || f[0] < .5)) { const hsl = {}; c.getHSL(hsl); c.setHSL(hsl.h, hsl.s, Math.min(.9, Math.max(.035, hsl.l))); }
  const base = { color: c, metalness: f ? f[0] : real ? 0 : matte ? .05 : .5, roughness: f ? f[1] : real ? .5 : matte ? .65 : .4, side: T.DoubleSide, transparent: true, opacity: 1, emissive: glow ? c.clone() : new T.Color(0x000000), emissiveIntensity: glow ? .55 : 0 };
  if (f && f[2] && T.MeshPhysicalMaterial) { const m = new T.MeshPhysicalMaterial({ ...base, ...f[2] }); if (f[2].transmission) { m.opacity = 1; m.depthWrite = false; } return m; }
  return new T.MeshStandardMaterial(base);
}
// ---------- (v325) the nature kit in 3D: real-looking trees, flowers, leaves, clouds, the sun, rocks, grass and the ground ----------
// Each one is a whole model, built where it stands: "pos" is the point on the ground under it (the ground is y = 0, so a
// tree, a flower or a rock stands at y 0; clouds, the sun and the moon float high above; roots grow below it). Surfaces
// are bent by noise so nothing is a perfect ball: lumpy leafy crowns, rough bark, jagged pine tiers, faceted rocks;
// every clump a slightly different green, and matte natural materials that catch the light like the real thing.
const KIT3 = ['tree', 'flower', 'leaf', 'cloud', 'sun', 'moon', 'rainbow', 'rock', 'grass', 'log', 'mushroom', 'ground', 'drops', 'snowflake', 'bolt', 'vehicle', 'animal', 'appliance', 'food']; // (v326: and vehicles; v327: animals; v328: appliances; v329: food)
const KIT3_KINDS = {
  tree: ['round', 'oak', 'pine', 'bush', 'palm', 'blossom', 'fruit', 'autumn', 'bare'],
  flower: ['sunflower', 'daisy', 'tulip', 'rose', 'lily', 'lavender', 'blossom', 'hydrangea'],
  leaf: ['oval', 'maple', 'heart'], cloud: ['white', 'grey', 'rain', 'storm', 'snow'],
  rock: ['stone', 'mossy'], log: ['log', 'stump'], grass: ['grass', 'flowers'], ground: ['grass', 'soil', 'sand', 'snow'],
  get vehicle() { return VEH_KINDS; },
  get animal() { return ANIMAL_KINDS; },
  get appliance() { return APPL_KINDS; },
  get food() { return FOOD_KINDS; },
};
// the box a kit model fills, from where it stands (for the model's checks and the camera)
function kit3Box(s, pos) {
  const t = String(s.t || '').toLowerCase(), h = Math.abs(n3(s.h ?? s.size, t === 'tree' ? 3 : 1)), w = Math.abs(n3(s.w ?? s.r ?? s.size, 1)), r = Math.abs(n3(s.r ?? s.size, 0.6));
  const [x, y, z] = pos, sq = (a, lo, hi) => [x - a, y + lo, z - a, x + a, y + hi, z + a];
  if (t === 'food') { // (v329) on the table, its width along x
    const A = FOOD[String(s.kind)] || FOOD.apple, L = Math.min(8, Math.max(0.05, Math.abs(n3(s.w ?? s.size, 1)))), both = s.view === 'both' && !!A.cut, cut = s.view === 'cut' && !!A.cut;
    const tall = both ? L * 0.48 * A.asp : cut ? L * (A.b === 'long' ? 0.1 : 0.48) : L * A.asp, deep = L * (A.b === 'long' || A.b === 'banana' || A.b === 'corn' ? 0.3 : 0.5);
    return [x - L / 2, y, z - deep, x + L / 2, y + tall, z + deep];
  }
  if (t === 'appliance') { // (v328) standing on the floor, its front toward +z (turned, its depth along x)
    const A = APPL[String(s.kind)] || APPL.fridge, H = Math.min(12, Math.max(0.1, Math.abs(n3(s.h ?? (s.w != null ? Math.abs(n3(s.w, 1)) * A.H / A.W : null) ?? s.size, A.H * 1.2)))), q = H / A.H;
    const turned = ['x', '-x', 'left', 'right'].includes(s.facing), hw = (turned ? A.D : A.W) * q / 2, hd = (turned ? A.W : A.D) * q / 2;
    return [x - hw, y, z - hd, x + hw, y + H + (s.kind === 'ricecooker' ? 0.09 * q : 0), z + hd];
  }
  if (t === 'animal') { // (v327) from where it stands (a flying bird, a fish or a jellyfish: its middle)
    const L = Math.abs(n3(s.w ?? s.size ?? s.len, 3)), A = ANIMALS[String(s.kind)] || ANIMALS.lion, tall = animalTall(A) * L, mid = A.b === 'fish' || A.b === 'bat' || (A.b === 'bird' && s.pose === 'fly');
    return mid ? [x - L / 2, y - tall / 2, z - L * .3, x + L / 2, y + tall / 2, z + L * .3] : [x - L / 2, y, z - L * .25, x + L / 2, y + tall, z + L * .25];
  }
  if (t === 'vehicle') { // (v326) its length along x (along z when it faces z), its height from its shape
    const L = Math.abs(n3(s.w ?? s.size ?? s.len, 4)), k = String(s.kind || 'sedan'), P = VEH_SHAPES[VEH_OF[k] || k], along = s.facing === 'z' || s.facing === '-z';
    const tall = P ? Math.max(...P.top.map((q) => q[1])) + 0.05 : ({ rocket: 1, balloon: 1.4, sailboat: 0.95, excavator: 0.75, tractor: 0.65, helicopter: 0.42, airplane: 0.42, bicycle: 0.65, motorcycle: 0.6, scooter: 0.65 })[k] || 0.45;
    const half = k === 'rocket' ? 0.16 * L : k === 'balloon' ? 0.48 * L : L / 2, wide = k === 'airplane' || k === 'helicopter' ? 0.47 * L : P ? P.wide * L / 2 + 0.02 * L : 0.2 * L;
    return along ? [x - wide, y, z - half, x + wide, y + tall * L, z + half] : [x - half, y, z - wide, x + half, y + tall * L, z + wide];
  }
  if (t === 'tree' && s.only) return ({ roots: sq(h * 0.45, -h * 0.32, 0), trunk: sq(h * 0.12, 0, h * 0.56), branches: sq(h * 0.34, h * 0.3, h * 0.85), crown: sq(h * 0.42, h * 0.45, h) })[s.only] || sq(h * 0.42, 0, h); // (one part of a tree: where that part is)
  if (t === 'tree') return sq(h * (s.kind === 'pine' ? 0.3 : 0.42), 0, h);
  if (t === 'flower' || t === 'mushroom') return sq(h * 0.3, 0, h);
  if (t === 'grass') return sq(w * 0.5, 0, w * 0.5);
  if (t === 'leaf') return sq(h * 0.35, 0, h);
  if (t === 'cloud') return [x - w * 0.55, y - w * 0.2, z - w * 0.3, x + w * 0.55, y + w * 0.3, z + w * 0.3];
  if (t === 'sun' || t === 'moon' || t === 'snowflake') return sq(r * 1.3, -r * 1.3, r * 1.3);
  if (t === 'rainbow') return [x - r, y, z - 0.2, x + r, y + r, z + 0.2];
  if (t === 'rock') return sq(w * 0.5, 0, w * 0.6);
  if (t === 'log') return s.kind === 'stump' ? sq(w * 0.5, 0, w * 0.45) : [x - w * 0.5, y, z - w * 0.2, x + w * 0.5, y + w * 0.4, z + w * 0.2];
  if (t === 'ground') return [x - w, y - (s.kind === 'soil' ? w * 0.5 : 0.08), z - w, x + w, y, z + w];
  if (t === 'drops') return [x - w * 0.5, y - w * 0.6, z - w * 0.3, x + w * 0.5, y, z + w * 0.3];
  if (t === 'bolt') return sq(h * 0.25, -h / 2, h / 2);
  return sq(0.5, 0, 1);
}
function kit3d(T, s, mat) {
  const t = String(s.t || '').toLowerCase(), list = KIT3_KINDS[t], kind = list ? (list.includes(String(s.kind || '').toLowerCase()) ? String(s.kind).toLowerCase() : list[0]) : '';
  const pos = Array.isArray(s.pos) ? s.pos : [0, 0, 0];
  let seed = Math.abs(Math.round((+pos[0] || 0) * 97 + (+pos[2] || 0) * 61 + (+pos[1] || 0) * 13)) % 2147483646 + 1;
  const R = () => (seed = (seed * 48271) % 2147483647) / 2147483647, J = (a) => (R() - 0.5) * 2 * a;
  const own = typeof s.fill === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(s.fill) ? s.fill : null;
  const G = new T.Group();
  // a natural material: the part's own material, given a real colour, matte, no glass or metal
  const mats = new Map();
  const M = (hex, rough = 0.82, extra = {}) => {
    const k = hex + rough + JSON.stringify(extra); if (mats.has(k)) return mats.get(k);
    const m = mat.clone(); m.color = new T.Color(hex); m.metalness = 0; m.roughness = rough;
    for (const q of ['transmission', 'clearcoat', 'sheen']) if (q in m) m[q] = 0;
    if (m.emissive) { m.emissive = new T.Color(extra.glow || '#000000'); m.emissiveIntensity = extra.glow ? (extra.gi || 0.9) : 0; }
    if (extra.clear) { m.clearcoat = 0.6; m.clearcoatRoughness = 0.25; }
    mats.set(k, m); return m;
  };
  const shade = (hex, k) => { const c = new T.Color(hex); const hsl = {}; c.getHSL(hsl); c.setHSL(hsl.h + J(0.015), Math.min(1, hsl.s * (1 + J(0.12))), Math.max(0, Math.min(1, hsl.l * (1 + k)))); return '#' + c.getHexString(); };
  const noise = (x, y, z) => Math.sin(x * 2.1 + y * 1.3) * Math.sin(y * 2.7 + z * 1.9) * Math.sin(z * 2.3 + x * 1.7) + 0.5 * Math.sin(x * 5.3 + z * 4.1) * Math.sin(y * 4.7 + x * 3.9);
  // a lump: an icosphere pushed in and out by noise (a clump of leaves, a cloud puff, a rock)
  const lump = (r, detail, amp, scale = [1, 1, 1], freq = 1.6) => {
    const seg = [8, 12, 18, 26, 34][Math.min(4, detail)], g = new T.SphereGeometry(r, seg, Math.round(seg * 0.7)), p = g.attributes.position, v = new T.Vector3(), o = R() * 10; // (smooth: shared points, soft shading)
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); const n = v.clone().normalize(); const d = 1 + amp * noise(n.x * freq + o, n.y * freq + o * 0.7, n.z * freq + o * 1.3); v.copy(n).multiplyScalar(r * d); v.x *= scale[0]; v.y *= scale[1]; v.z *= scale[2]; p.setXYZ(i, v.x, v.y, v.z); }
    g.computeVertexNormals(); return g;
  };
  const add = (geo, m, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => { const e = new T.Mesh(geo, m); e.position.set(x, y, z); e.rotation.set(rx, ry, rz); G.add(e); return e; };
  const tube = (pts, r, m, r2 = null) => { // a tube through points, its radius narrowing from r to r2 (a branch, a stem, a root)
    const curve = new T.CatmullRomCurve3(pts.map((q) => new T.Vector3(...q))), g = new T.TubeGeometry(curve, Math.max(12, pts.length * 10), r, 10, false);
    if (r2 != null) { const p = g.attributes.position, segs = g.parameters.tubularSegments, rad = g.parameters.radialSegments + 1, c = new T.Vector3(), v = new T.Vector3();
      for (let i = 0; i <= segs; i++) { const u = i / segs, k = (r + (r2 - r) * u) / r; curve.getPointAt(u, c); for (let j = 0; j < rad; j++) { const idx = i * rad + j; v.fromBufferAttribute(p, idx).sub(c).multiplyScalar(k).add(c); p.setXYZ(idx, v.x, v.y, v.z); } } g.computeVertexNormals(); }
    return add(g, m);
  };
  const lathe = (prof, m, segs = 28, rough = 0) => { // a turned shape; rough: bark-like bumps round it
    const g = new T.LatheGeometry(prof.map(([r, y]) => new T.Vector2(Math.max(0.001, r), y)), segs);
    if (rough) { const p = g.attributes.position, v = new T.Vector3(); for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); const a = Math.atan2(v.z, v.x), k = 1 + rough * (Math.sin(a * 9 + v.y * 3) * 0.6 + Math.sin(a * 23 + v.y * 11) * 0.4); p.setXYZ(i, v.x * k, v.y, v.z * k); } g.computeVertexNormals(); }
    return add(g, m);
  };
  const leafGeo = (len, wide, fold = 0.25) => { // a leaf blade: pointed, folded a little along its midrib, curling down at the tip
    const sh = new T.Shape(); sh.moveTo(0, 0); sh.quadraticCurveTo(wide, len * 0.35, 0, len); sh.quadraticCurveTo(-wide, len * 0.35, 0, 0);
    const g = new T.ShapeGeometry(sh, 10), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i); p.setZ(i, Math.abs(x) * fold - (y / len) ** 2 * len * 0.18); }
    g.computeVertexNormals(); g.rotateX(-Math.PI / 2); return g; // (lies along +z, face up)
  };
  const H = Math.abs(n3(s.h ?? s.size, t === 'tree' ? 3 : t === 'flower' ? 1 : 1)), W = Math.abs(n3(s.w ?? s.r ?? s.size, t === 'ground' ? 3 : 1)), Rr = Math.abs(n3(s.r ?? s.size, 0.6));

  if (t === 'tree') {
    const bark = M(kind === 'bare' ? '#6e5a4a' : '#6b4a30', 0.92), h = Math.min(12, Math.max(0.4, H));
    const leafCol = own || { blossom: '#f2a7c3', autumn: '#d9822b', pine: '#2f6b3f', fruit: '#4a8f35', bare: '#6b4a30' }[kind] || '#4f8f36';
    if (kind === 'pine') {
      lathe([[h * 0.07, 0], [h * 0.05, h * 0.05], [h * 0.035, h * 0.3], [h * 0.02, h * 0.95], [0, h]], bark, 18, 0.05);
      for (let k = 0; k < 6; k++) { // stacked tiers, each a ragged cone, smaller to the top
        const y0 = h * (0.2 + k * 0.13), rad = h * (0.3 - k * 0.042), th = h * 0.3, g = new T.ConeGeometry(rad, th, 30, 5, true), p = g.attributes.position, v = new T.Vector3();
        for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); const a = Math.atan2(v.z, v.x), edge = (th / 2 - v.y) / th, j = 1 + edge * (0.18 * Math.sin(a * 7 + k) + 0.1 * Math.sin(a * 17)); p.setXYZ(i, v.x * j, v.y - edge * edge * th * 0.12, v.z * j); }
        g.computeVertexNormals();
        add(g, M(shade(leafCol, (k % 2 ? 0.06 : -0.05)), 0.9), J(0.02), y0 + th / 2, J(0.02), 0, R() * 6, 0);
      }
    } else if (kind === 'palm') {
      const top = [h * 0.18, h * 0.9, 0];
      tube([[0, 0, 0], [h * 0.02, h * 0.35, 0], [h * 0.1, h * 0.68, 0], top], h * 0.045, bark, h * 0.03);
      for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2 + R() * 0.3, e = add(leafGeo(h * 0.42, h * 0.07, 0.5), M(shade('#3e8a3c', J(0.08)), 0.75), top[0], top[1], top[2]); e.rotation.set(0.35 + R() * 0.25, a, 0, 'YXZ'); }
      for (let k = 0; k < 3; k++) add(new T.SphereGeometry(h * 0.035, 16, 12), M('#7a5a2e', 0.6), top[0] + J(h * 0.04), top[1] - h * 0.04, J(h * 0.04));
    } else {
      // the trunk, flaring into its roots at the ground, then branches that fork up into the crown
      const tall = kind === 'bush' ? 0.12 : kind === 'bare' ? 0.65 : 0.5, only = String(s.only || ''), want = (k) => !only || only === k;
      if (only === 'roots' || s.roots) for (let k = 0; k < 7; k++) { const a = k / 7 * Math.PI * 2 + R() * 0.4, d = h * (0.22 + R() * 0.12); tube([[0, -h * 0.01, 0], [Math.cos(a) * d * 0.4, -h * (0.08 + R() * 0.04), Math.sin(a) * d * 0.4], [Math.cos(a) * d, -h * (0.14 + R() * 0.1), Math.sin(a) * d], [Math.cos(a + 0.3) * d * 1.3, -h * (0.22 + R() * 0.08), Math.sin(a + 0.3) * d * 1.3]], h * 0.022, bark, h * 0.004); } // (v325: the roots, spreading under the ground)
      if (only === 'roots') return G;
      if (want('trunk')) lathe([[h * 0.095, 0], [h * 0.065, h * 0.03], [h * 0.05, h * 0.12], [h * 0.042, h * tall * 0.7], [h * 0.035, h * tall], [h * 0.02, h * (tall + 0.06)]], bark, 20, 0.06);
      for (let k = 0; k < (want('trunk') ? 4 : 0); k++) { const a = k / 4 * Math.PI * 2 + 0.4; tube([[0, h * 0.02, 0], [Math.cos(a) * h * 0.08, h * 0.005, Math.sin(a) * h * 0.08], [Math.cos(a) * h * 0.15, -h * 0.01, Math.sin(a) * h * 0.15]], h * 0.025, bark, h * 0.006); } // (root flares at the foot)
      const ends = [];
      const nb = kind === 'bare' ? 6 : 5;
      for (let k = 0; k < nb; k++) {
        const a = k / nb * Math.PI * 2 + R() * 0.5, y0 = h * (tall * 0.75 + R() * 0.12), reach = h * (kind === 'bush' ? 0.22 : 0.3), up = h * (kind === 'bush' ? 0.15 : 0.32);
        const end = [Math.cos(a) * reach, y0 + up, Math.sin(a) * reach];
        if (want('branches')) tube([[0, y0, 0], [Math.cos(a) * reach * 0.45, y0 + up * 0.55, Math.sin(a) * reach * 0.45], end], h * 0.022, bark, h * 0.008);
        ends.push(end);
        if (kind === 'bare') tube([end, [end[0] * 1.25 + J(h * 0.05), end[1] + h * 0.12, end[2] * 1.25 + J(h * 0.05)]], h * 0.008, bark, h * 0.003);
      }
      if (kind !== 'bare' && want('crown')) {
        const cy = h * (kind === 'bush' ? 0.32 : tall + 0.24), cr = h * (kind === 'bush' ? 0.36 : kind === 'oak' ? 0.36 : 0.3);
        const clumps = [[0, cy + cr * 0.35, 0, cr * 0.62], ...ends.map((e) => [e[0], e[1] + cr * 0.1, e[2], cr * (0.48 + R() * 0.12)])];
        for (let k = 0; k < 5; k++) { const a = R() * Math.PI * 2; clumps.push([Math.cos(a) * cr * 0.55, cy + J(cr * 0.3), Math.sin(a) * cr * 0.55, cr * (0.42 + R() * 0.12)]); }
        clumps.forEach(([x, y, z, r], k) => add(lump(r, 3, 0.22, [1, kind === 'bush' ? 0.8 : 0.88, 1], 2.4), M(shade(leafCol, (y - cy) / cr * 0.12 + J(0.06)), 0.86), x, y, z, 0, R() * 6, 0));
        if (kind === 'fruit' || kind === 'blossom') for (let k = 0; k < (kind === 'fruit' ? 16 : 40); k++) {
          const c = clumps[k % clumps.length], a = R() * Math.PI * 2, b = (R() - 0.3) * Math.PI * 0.8, rr = c[3] * 0.95;
          add(new T.SphereGeometry(kind === 'fruit' ? h * 0.028 : h * 0.012, 12, 10), kind === 'fruit' ? M('#d8402e', 0.4, { clear: true }) : M('#fff0f6', 0.7), c[0] + Math.cos(a) * Math.cos(b) * rr, c[1] + Math.sin(b) * rr, c[2] + Math.sin(a) * Math.cos(b) * rr);
        }
      }
    }
  } else if (t === 'flower') {
    const h = Math.min(4, Math.max(0.1, H)), top = h * 0.82, green = M('#4f8a3a', 0.7);
    if (kind === 'lavender') {
      for (let k = 0; k < 3; k++) { const dx = (k - 1) * h * 0.08, tip = [dx * 1.6, h, J(h * 0.05)]; tube([[dx * 0.3, 0, 0], [dx, h * 0.5, 0], tip], h * 0.008, green);
        for (let j = 0; j < 12; j++) add(lump(h * 0.022, 1, 0.1), M(shade('#8e72cf', J(0.1)), 0.7), tip[0] + J(h * 0.012), tip[1] - j * h * 0.025, tip[2] + J(h * 0.012)); }
    } else {
      tube([[0, 0, 0], [J(h * 0.04), h * 0.45, J(h * 0.04)], [0, top, 0]], h * 0.014, green, h * 0.01);
      [0.6, 2.6].forEach((a, k) => { const e = add(leafGeo(h * 0.3, h * 0.07), M(shade('#5c9a44', J(0.06)), 0.7), 0, h * (0.2 + k * 0.12), 0); e.rotation.set(-0.5, a, 0, 'YXZ'); });
      const head = new T.Group(); head.position.set(0, top, 0); head.rotation.x = -0.35; G.add(head);
      const put = (geo, m, x, y, z, rx = 0, ry = 0, rz = 0) => { const e = new T.Mesh(geo, m); e.position.set(x, y, z); e.rotation.set(rx, ry, rz, 'YXZ'); head.add(e); return e; };
      const hr = h * 0.16;
      if (kind === 'sunflower' || kind === 'daisy' || kind === 'blossom') {
        const n = kind === 'sunflower' ? 18 : kind === 'daisy' ? 20 : 5, pc = own || (kind === 'sunflower' ? '#f2c12e' : kind === 'daisy' ? '#f8f3ea' : '#f5a3c0');
        for (let k = 0; k < n; k++) { const a = k / n * Math.PI * 2, e = put(new T.SphereGeometry(1, 14, 8), M(shade(pc, J(0.05)), 0.6), Math.cos(a) * hr * 0.75, 0, Math.sin(a) * hr * 0.75); e.scale.set(hr * 0.5, hr * 0.05, hr * (kind === 'blossom' ? 0.42 : 0.16)); e.rotation.set(0.15, -a, 0, 'YXZ'); }
        put(lump(hr * (kind === 'sunflower' ? 0.5 : 0.3), 2, 0.08, [1, 0.35, 1], 6), M(kind === 'sunflower' ? '#5a3a1e' : '#f0b92c', 0.9), 0, hr * 0.03, 0);
      } else if (kind === 'tulip') {
        for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2, e = put(new T.SphereGeometry(1, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.6), M(shade(own || '#e8578a', J(0.05)), 0.5, { clear: true }), Math.cos(a) * hr * 0.18, hr * 0.15, Math.sin(a) * hr * 0.18); e.scale.set(hr * 0.42, hr * 1.1, hr * 0.32); e.rotation.set(Math.PI, -a, 0.12, 'YXZ'); e.position.y = hr * 1.1; }
      } else if (kind === 'rose') {
        for (let ring = 0; ring < 4; ring++) for (let k = 0; k < 5 + ring; k++) { const a = k / (5 + ring) * Math.PI * 2 + ring, rr = hr * (0.15 + ring * 0.2), e = put(new T.SphereGeometry(1, 14, 10, 0, Math.PI, 0, Math.PI), M(shade(own || '#d8355a', ring * 0.05), 0.55), Math.cos(a) * rr, hr * (0.45 - ring * 0.1), Math.sin(a) * rr); e.scale.set(hr * (0.3 + ring * 0.06), hr * (0.45 - ring * 0.05), hr * 0.12); e.rotation.set(-0.2 - ring * 0.25, -a + Math.PI / 2, 0, 'YXZ'); }
      } else if (kind === 'lily') {
        for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2, e = put(leafGeo(hr * 1.3, hr * 0.38, 0.4), M(shade(own || '#f6dde6', J(0.04)), 0.6), 0, 0, 0); e.rotation.set(-0.9, a, 0, 'YXZ'); }
        for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2 + 0.5, tip = [Math.cos(a) * hr * 0.4, hr * 0.7, Math.sin(a) * hr * 0.4]; const st = new T.Mesh(new T.TubeGeometry(new T.LineCurve3(new T.Vector3(0, 0, 0), new T.Vector3(...tip)), 4, hr * 0.02, 6), M('#e0c06a', 0.6)); head.add(st); put(new T.CapsuleGeometry(hr * 0.04, hr * 0.1, 4, 8), M('#c8552a', 0.7), ...tip, 0, a, Math.PI / 2); }
      } else if (kind === 'hydrangea') {
        for (let k = 0; k < 46; k++) { const a = k * 2.4, b = Math.acos(1 - (k + 0.5) / 46 * 1.4), rr = hr * 1.1; put(lump(hr * 0.16, 1, 0.15), M(shade(own || '#a993e6', J(0.12)), 0.6), Math.sin(b) * Math.cos(a) * rr, Math.cos(b) * rr * 0.8, Math.sin(b) * Math.sin(a) * rr); }
      }
    }
  } else if (t === 'leaf') {
    const h = Math.min(4, Math.max(0.1, H)), c = own || (kind === 'maple' ? '#d9542a' : '#4f9a3a');
    if (kind === 'maple') {
      const sh = new T.Shape(); for (let k = 0; k <= 60; k++) { const a = k / 60 * Math.PI * 2, lobes = 0.55 + 0.45 * Math.max(0, Math.cos(a * 5)) ** 0.5, r = h * 0.48 * lobes * (a > Math.PI * 1.25 && a < Math.PI * 1.75 ? 0.4 : 1); const x = Math.cos(a + Math.PI / 2) * r, y = Math.sin(a + Math.PI / 2) * r + h * 0.5; if (k) sh.lineTo(x, y); else sh.moveTo(x, y); }
      const g = new T.ShapeGeometry(sh, 2); g.rotateX(-Math.PI / 2 + 0.4); add(g, M(c, 0.7));
    } else { const e = add(leafGeo(h, h * (kind === 'heart' ? 0.5 : 0.32), 0.35), M(c, 0.6, { clear: true })); e.rotation.x = 1.1; }
    tube([[0, 0, 0], [0, h * 0.12, h * 0.05]], h * 0.012, M(kitDark3(c), 0.7));
  } else if (t === 'cloud') {
    const w = Math.min(14, Math.max(0.3, W)), col = own || (kind === 'storm' ? '#7d8799' : kind === 'grey' ? '#c2c8d2' : '#f6f8fb');
    const m = M(col, 1, { glow: kind === 'storm' ? null : '#ffffff', gi: 0.12 });
    [[-0.32, 0, 0, 0.26], [-0.08, 0.1, 0.04, 0.34], [0.2, 0.06, -0.03, 0.3], [0.4, -0.02, 0.02, 0.2], [0.02, -0.04, 0.12, 0.27], [-0.18, -0.05, -0.12, 0.24]].forEach(([x, y, z, r]) => add(lump(w * r, 3, 0.12, [1, 0.82, 0.85], 2), m, x * w, y * w, z * w));
    if (kind === 'rain' || kind === 'storm') for (let k = 0; k < 9; k++) { const d = add(new T.SphereGeometry(w * 0.025, 12, 10), M('#4a9fe0', 0.15, { clear: true }), J(w * 0.4), -w * (0.25 + R() * 0.45), J(w * 0.2)); d.scale.y = 1.6; }
    if (kind === 'snow') for (let k = 0; k < 9; k++) { const f = new T.Group(); for (let j = 0; j < 3; j++) { const b = new T.Mesh(new T.BoxGeometry(w * 0.06, w * 0.008, w * 0.008), M('#ffffff', 0.4, { glow: '#ffffff', gi: 0.3 })); b.rotation.z = j * Math.PI / 3; f.add(b); } f.position.set(J(w * 0.4), -w * (0.25 + R() * 0.45), J(w * 0.2)); f.rotation.y = R() * 3; G.add(f); }
    if (kind === 'storm') { const sh = new T.Shape(), b = w * 0.35; [[0.08, 0], [-0.1, -0.45], [0.02, -0.45], [-0.06, -0.9], [0.14, -0.35], [0.03, -0.35], [0.12, 0]].forEach(([x, y], k) => (k ? sh.lineTo(x * b, y * b) : sh.moveTo(x * b, y * b))); add(new T.ExtrudeGeometry(sh, { depth: w * 0.02, bevelEnabled: false }), M('#ffd23a', 0.4, { glow: '#ffc21a', gi: 0.9 }), 0, -w * 0.12, w * 0.1); }
  } else if (t === 'sun') {
    const r = Math.min(6, Math.max(0.1, Rr));
    add(new T.SphereGeometry(r, 40, 28), M(own || '#ffcf3d', 0.5, { glow: '#ffb21a', gi: 1.1 }), 0, 0, 0);
    [1.25, 1.55].forEach((k, i) => { const m = new T.MeshBasicMaterial({ color: new T.Color('#ffd25e'), transparent: true, opacity: i ? 0.1 : 0.2, depthWrite: false }); add(new T.SphereGeometry(r * k, 32, 20), m); });
  } else if (t === 'moon') {
    const r = Math.min(6, Math.max(0.1, Rr)), g = lump(r, 4, 0.03, [1, 1, 1], 5);
    add(g, M(own || '#e9e2c8', 0.95, { glow: '#fff3c4', gi: 0.25 }));
  } else if (t === 'rainbow') {
    const r = Math.min(10, Math.max(0.3, Rr)), band = r * 0.07;
    ['#e8453c', '#f28c2e', '#f5d03c', '#5cbf5a', '#3f8fdb', '#5b5fc7', '#8a5cc8'].forEach((c, k) => add(new T.TorusGeometry(r - k * band, band * 0.5, 10, 64, Math.PI), M(c, 0.5, { glow: c, gi: 0.35 })));
  } else if (t === 'rock') {
    const w = Math.min(8, Math.max(0.1, W)), col = own || '#8f8c84', g = new T.IcosahedronGeometry(w * 0.5, 1); { const p = g.attributes.position, v = new T.Vector3(); for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); const n = v.clone().normalize(), d = 1 + 0.28 * noise(n.x * 1.4 + 3, n.y * 1.4, n.z * 1.4); v.copy(n).multiplyScalar(w * 0.5 * d); p.setXYZ(i, v.x, v.y * 0.72, v.z * 0.85); } g.computeVertexNormals(); } // (stone keeps its facets)
    g.translate(0, w * 0.25, 0); const e = add(g, M(col, 0.95)); e.rotation.y = R() * 6;
    const pp = g.attributes.position; for (let i = 0; i < pp.count; i++) if (pp.getY(i) < 0) pp.setY(i, 0); g.computeVertexNormals(); // (it sits flat on the ground)
    if (kind === 'mossy') { const m = lump(w * 0.42, 2, 0.2, [1.05, 0.35, 0.9], 3); add(m, M('#6f9e3a', 1), 0, w * 0.5, 0); }
  } else if (t === 'grass') {
    const w = Math.min(6, Math.max(0.1, W));
    for (let k = 0; k < 34; k++) { const a = R() * Math.PI * 2, d = Math.sqrt(R()) * w * 0.45, hh = w * (0.25 + R() * 0.25), e = add(new T.ConeGeometry(w * 0.018, hh, 4), M(shade('#5a9a3a', J(0.15)), 0.8), Math.cos(a) * d, hh / 2, Math.sin(a) * d); e.rotation.set(J(0.35), R() * 3, J(0.35)); }
    if (kind === 'flowers') for (let k = 0; k < 5; k++) { const c = ['#f26b8a', '#ffd45c', '#ffffff', '#b18ce6', '#ff8a3c'][k], x = J(w * 0.35), z = J(w * 0.35), y = w * (0.3 + R() * 0.15); add(new T.SphereGeometry(w * 0.035, 10, 8), M(c, 0.6), x, y, z); }
  } else if (t === 'log') {
    const w = Math.min(8, Math.max(0.1, W)), bark = M('#6b4a30', 0.95), wood = M('#d7ad74', 0.85);
    if (kind === 'stump') {
      lathe([[w * 0.42, 0], [w * 0.3, w * 0.06], [w * 0.27, w * 0.2], [w * 0.26, w * 0.4], [0, w * 0.4]], bark, 24, 0.07);
      const top = add(new T.CircleGeometry(w * 0.255, 32), wood, 0, w * 0.401, 0, -Math.PI / 2);
      [0.7, 0.45, 0.2].forEach((k) => add(new T.RingGeometry(w * 0.255 * k - w * 0.005, w * 0.255 * k, 32), M('#a77d4c', 0.9), 0, w * 0.403, 0, -Math.PI / 2));
      top.receiveShadow = true;
    } else {
      const r = w * 0.17, e = lathe([[0, -w / 2], [r, -w / 2], [r * 1.02, 0], [r, w / 2], [0, w / 2]], bark, 24, 0.06); e.rotation.z = Math.PI / 2; e.position.y = r;
      [-1, 1].forEach((sd) => { add(new T.CircleGeometry(r * 0.96, 28), wood, sd * (w / 2 + 0.002), r, 0, 0, sd * Math.PI / 2); [0.65, 0.35].forEach((k) => add(new T.RingGeometry(r * k - w * 0.004, r * k, 28), M('#a77d4c', 0.9), sd * (w / 2 + 0.004), r, 0, 0, sd * Math.PI / 2)); });
    }
  } else if (t === 'mushroom') {
    const h = Math.min(3, Math.max(0.05, H));
    lathe([[h * 0.1, 0], [h * 0.08, h * 0.3], [h * 0.07, h * 0.55], [0, h * 0.56]], M('#efe3cf', 0.8), 20);
    lathe([[h * 0.42, h * 0.5], [h * 0.4, h * 0.62], [h * 0.3, h * 0.82], [h * 0.15, h * 0.95], [0, h], [0, h * 0.5]], M(own || '#c9442f', 0.5, { clear: true }), 32);
    for (let k = 0; k < 9; k++) { const a = R() * Math.PI * 2, b = 0.35 + R() * 0.8, e = add(new T.SphereGeometry(h * 0.045, 10, 8), M('#fbf6ec', 0.7), Math.cos(a) * Math.sin(b) * h * 0.38, h * 0.52 + Math.cos(b) * h * 0.46, Math.sin(a) * Math.sin(b) * h * 0.38); e.scale.y = 0.4; }
  } else if (t === 'ground') { // a round patch of ground; "soil": a slice of it, the soil below shown see-through so roots show
    const w = Math.min(16, Math.max(0.3, W)), top = { soil: '#5f9a3e', sand: '#e3cf9a', snow: '#f3f6fa' }[kind] || '#5f9a3e';
    const g = new T.CircleGeometry(w, 48), p = g.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), d = Math.hypot(x, y) / w; p.setZ(i, (1 - d) * w * 0.02 * noise(x * 1.3, y * 1.3, 0.5)); } g.computeVertexNormals();
    const e = add(g, M(top, 0.95), 0, 0, 0, -Math.PI / 2); e.receiveShadow = true;
    if (kind === 'soil') { const d = w * 0.5, sm = M('#7a5436', 1); sm.transparent = true; sm.opacity = 0.38; sm.depthWrite = false; const c = add(new T.CylinderGeometry(w, w * 0.98, d, 48, 1, true), sm, 0, -d / 2, 0); c.userData.keepOpacity = 0.38; const b = add(new T.CircleGeometry(w * 0.98, 48), sm, 0, -d, 0, Math.PI / 2); b.userData.keepOpacity = 0.38; }
  } else if (t === 'drops') {
    const w = Math.min(6, Math.max(0.1, W));
    for (let k = 0; k < 8; k++) { const d = add(new T.SphereGeometry(w * 0.04, 12, 10), M('#4a9fe0', 0.15, { clear: true }), J(w * 0.45), -R() * w * 0.6, J(w * 0.25)); d.scale.y = 1.6; }
  } else if (t === 'snowflake') {
    const r = Math.min(4, Math.max(0.05, Rr)), m = M('#dcefff', 0.3, { glow: '#bfe2ff', gi: 0.4 });
    for (let j = 0; j < 3; j++) { const b = add(new T.BoxGeometry(r * 2, r * 0.08, r * 0.08), m); b.rotation.z = j * Math.PI / 3; }
  } else if (t === 'bolt') {
    const h = Math.min(6, Math.max(0.1, H)), sh = new T.Shape();
    [[0.08, 0.5], [-0.12, 0.02], [0.02, 0.02], [-0.08, -0.5], [0.16, 0.06], [0.03, 0.06], [0.14, 0.5]].forEach(([x, y], k) => (k ? sh.lineTo(x * h, y * h) : sh.moveTo(x * h, y * h)));
    add(new T.ExtrudeGeometry(sh, { depth: h * 0.05, bevelEnabled: true, bevelSize: h * 0.01, bevelThickness: h * 0.01, bevelSegments: 2 }), M('#ffd23a', 0.4, { glow: '#ffc21a', gi: 1 }));
  } else if (t === 'vehicle') { // (v326) a vehicle in 3D, its front toward +x, standing on the ground (y 0), w its length
    const L = Math.min(14, Math.max(0.2, Math.abs(n3(s.w ?? s.size ?? s.len, 4)))), P = VEH_SHAPES[VEH_OF[kind] || kind];
    const col = own || { taxi: '#f6c21c', police: '#f4f6f8', ambulance: '#f7f8fa' }[kind] || (P ? P.col : { bicycle: '#2d6fd6', motorcycle: '#d32f2f', scooter: '#e8742a', airplane: '#f4f6f8', helicopter: '#2f7d4a', boat: '#f4f6f8', ship: '#f4f6f8', sailboat: '#f4f6f8', rowboat: '#c99a5a', submarine: '#3c4f63', rocket: '#f4f6f8', balloon: '#e8574f', drone: '#e8742a', tractor: '#3f8f3a', excavator: '#f2b51a', bulldozer: '#f2b51a' }[kind] || '#c63a2f');
    const paint = M(col, 0.32, { clear: true }), glass = M('#1d2733', 0.08, { clear: true }), tyre = M('#1f2125', 0.85), rimM = M('#c9ced6', 0.3), chrome = M('#dfe3e8', 0.18), black = M('#2b2f36', 0.6), red = M('#d7262b', 0.3, { glow: '#b01418', gi: 0.5 }), lamp = M('#fff6d8', 0.2, { glow: '#fff2c0', gi: 0.6 });
    const box = (sx, sy, sz, m, x, y, z, ry = 0, rz = 0) => { const RB = T.RoundedBox, r = Math.min(sx, sy, sz) * 0.2; const e = add(RB && r > 0.004 ? new RB(sx, sy, sz, 2, r) : new T.BoxGeometry(sx, sy, sz), m, x, y, z, 0, ry, rz); return e; };
    const wheel = (x, r, z, wd, m = rimM) => { const t1 = add(new T.CylinderGeometry(r, r, wd, 28), tyre, x, r, z, Math.PI / 2); const t2 = add(new T.CylinderGeometry(r * 0.6, r * 0.6, wd * 1.04, 20), m, x, r, z, Math.PI / 2); const t3 = add(new T.CylinderGeometry(r * 0.18, r * 0.18, wd * 1.1, 12), M('#8a919b', 0.4), x, r, z, Math.PI / 2); t1.userData.spin = 'z'; return [t1, t2, t3]; };
    const extrudeSide = (pts, depth, m, bevel = 0) => { const sh = new T.Shape(); pts.forEach(([u, v], k) => (k ? sh.lineTo(u * L, v * L) : sh.moveTo(u * L, v * L))); const g = new T.ExtrudeGeometry(sh, { depth, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 3, curveSegments: 8 }); g.translate(0, 0, -depth / 2); return add(g, m); };
    if (P) {
      const W = P.wide * L, bev = Math.min(W * 0.12, L * 0.03), arches = P.wheels.map(([u, r]) => [u, r * 1.22]).sort((a, b) => b[0] - a[0]);
      const front = P.top[P.top.length - 1], back = P.top[0], clear = Math.min(front[1], back[1]);
      const bottom = []; arches.forEach(([u, ar]) => { for (let k = 0; k <= 12; k++) { const a = k / 12 * Math.PI; bottom.push([u + Math.cos(a) * ar, Math.max(clear, P.wheels[0][1] + Math.sin(a) * ar * 0.92)]); } });
      // the body: its side profile, wheel arches cut in, pushed out to its width with soft rounded edges
      const prof = [...P.top, ...bottom], nTop = P.top.length;
      if (kind === 'truck' || kind === 'dumptruck') { // the load behind the cab, the chassis under it
        if (kind === 'truck') box(0.66 * L, 0.4 * L, W * 0.98, M(own ? kitLight3(col) : '#eceef0', 0.5), -0.17 * L, 0.315 * L, 0);
        else { const bed = extrudeSide([[-0.52, 0.2], [-0.48, 0.5], [0.15, 0.5], [0.15, 0.2]], W * 1.02, M(kitDark3b(col, 0.92), 0.5), bev * 0.5); add(new T.BoxGeometry(0.6 * L, 0.02 * L, W * 0.9), M('#8a6a44', 0.9), -0.17 * L, 0.5 * L, 0); }
        box(0.72 * L, 0.04 * L, W * 0.7, black, -0.14 * L, 0.12 * L, 0);
      }
      { // (its top a smooth curve through the profile, as the flat drawing is; the bottom with its wheel arches)
        const sh = new T.Shape(); sh.moveTo(prof[0][0] * L, prof[0][1] * L); sh.splineThru(P.top.slice(1).map(([u, v]) => new T.Vector2(u * L, v * L)));
        bottom.forEach(([u, v]) => sh.lineTo(u * L, v * L)); sh.lineTo(prof[0][0] * L, prof[0][1] * L);
        const g = new T.ExtrudeGeometry(sh, { depth: W - bev * 2, bevelEnabled: true, bevelSize: bev, bevelThickness: bev, bevelSegments: 4, curveSegments: 24 }); g.translate(0, 0, -(W - bev * 2) / 2); add(g, paint);
      }
      // glass: the side windows on both sides, the windshield and the back window along their slopes
      P.glass.forEach((g) => { const e = extrudeSide(g, W + 0.004 * L, glass); e.scale.set(1, 1, 1); });
      const tops = P.top, maxV = Math.max(...tops.map((q) => q[1]));
      const slope = (a, b) => { const dx = (b[0] - a[0]) * L, dy = (b[1] - a[1]) * L, len = Math.hypot(dx, dy), e = add(new T.BoxGeometry(len * 0.92, 0.006 * L, W * 0.78), glass, (a[0] + b[0]) / 2 * L, (a[1] + b[1]) / 2 * L, 0); e.rotation.z = Math.atan2(dy, dx); const n = new T.Vector3(-dy, dx, 0).normalize().multiplyScalar(bev + 0.006 * L); if (n.y < 0) n.negate(); e.position.add(n); };
      if (!['bus', 'schoolbus', 'truck', 'dumptruck', 'firetruck', 'train'].includes(kind)) {
        let fi = tops.findIndex((q, k) => k > 0 && q[1] >= maxV - 0.02 && (!tops[k + 1] || tops[k + 1][1] < maxV - 0.02)); if (fi >= 0 && tops[fi + 1] && tops[fi + 1][1] > P.belt - 0.03) slope(tops[fi], tops[fi + 1]);
        let ri = tops.findIndex((q) => q[1] >= maxV - 0.02); if (ri > 0 && tops[ri - 1][1] > P.belt - 0.05 && !['van', 'suv', 'pickup'].includes(VEH_OF[kind] || kind)) slope(tops[ri - 1], tops[ri]);
      }
      if (['bus', 'schoolbus', 'train'].includes(kind)) { // a row of windows on both sides, a windshield in front
        const v0 = kind === 'train' ? 0.15 : 0.21, v1 = kind === 'train' ? 0.235 : 0.32, end = kind === 'schoolbus' ? 0.26 : kind === 'train' ? 0.3 : 0.36, n = kind === 'train' ? 9 : 7, step = (end + 0.46) / n;
        for (let k = 0; k < n; k++) { const u0 = -0.46 + k * step + 0.008; add(new T.BoxGeometry((step - 0.016) * L, (v1 - v0) * L, W + 0.006 * L), glass, (u0 + (step - 0.016) / 2) * L, (v0 + v1) / 2 * L, 0); }
        if (kind !== 'train') box(0.012 * L, 0.15 * L, W * 0.86, glass, (kind === 'schoolbus' ? 0.335 : 0.5) * L, 0.27 * L, 0);
        if (kind === 'train') { add(new T.BoxGeometry(L * 0.96, 0.012 * L, W + 0.006 * L), M('#d6302a', 0.4), -0.02 * L, 0.135 * L, 0); [-0.65, 0.65].forEach((z) => add(new T.BoxGeometry(L * 1.2, 0.012 * L, 0.012 * L), M('#9aa0a8', 0.3), 0, 0.006 * L, z * W)); }
        if (kind === 'schoolbus') add(new T.BoxGeometry(L * 0.8, 0.012 * L, W + 0.006 * L), black, -0.09 * L, 0.175 * L, 0);
      }
      if (kind === 'firetruck') { for (let k = 0; k < 2; k++) add(new T.BoxGeometry(0.78 * L, 0.012 * L, 0.012 * L), M('#c7ccd3', 0.3), -0.08 * L, (0.415 + k * 0.03) * L, (k ? 1 : -1) * W * 0.25); for (let k = 0; k <= 15; k++) add(new T.BoxGeometry(0.008 * L, 0.03 * L, W * 0.5), M('#c7ccd3', 0.3), (-0.46 + k * 0.05) * L, 0.43 * L, 0); }
      // wheels, both sides
      const tw = Math.min(W * 0.22, P.wheels[0][1] * L * 0.8);
      P.wheels.forEach(([u, r]) => [-1, 1].forEach((sd) => wheel(u * L, r * L, sd * (W / 2 - tw * 0.35), tw)));
      // lights, grille, mirrors
      const fy = Math.max(clear + 0.04, P.belt - 0.07) * L;
      [-1, 1].forEach((sd) => { box(0.03 * L, 0.03 * L, W * 0.2, lamp, (front[0] - 0.008) * L, fy, sd * W * 0.32); box(0.02 * L, 0.035 * L, W * 0.2, red, (back[0] + 0.006) * L, fy, sd * W * 0.32); });
      box(0.02 * L, 0.04 * L, W * 0.36, black, (front[0] - 0.004) * L, Math.max(clear + 0.03, fy / L - 0.04) * L, 0);
      if (!['bus', 'schoolbus', 'train', 'firetruck'].includes(kind)) [-1, 1].forEach((sd) => box(0.03 * L, 0.025 * L, 0.05 * L, paint, (P.glass.length ? P.glass[P.glass.length - 1].slice(-1)[0][0] - 0.02 : 0.2) * L, (P.belt + 0.015) * L, sd * (W / 2 + 0.02 * L)));
      if (kind === 'taxi') box(0.12 * L, 0.04 * L, W * 0.3, M('#ffe27a', 0.4, { glow: '#ffd23a', gi: 0.3 }), 0, (maxV + 0.02) * L, 0);
      if (kind === 'police' || kind === 'ambulance') { box(0.07 * L, 0.035 * L, W * 0.3, M('#d8262b', 0.3, { glow: '#d8262b', gi: 0.8 }), 0, (maxV + 0.02) * L, -W * 0.16); box(0.07 * L, 0.035 * L, W * 0.3, M('#2463d6', 0.3, { glow: '#2463d6', gi: 0.8 }), 0, (maxV + 0.02) * L, W * 0.16); }
      if (kind === 'police') [-1, 1].forEach((sd) => add(new T.BoxGeometry(0.44 * L, 0.13 * L, 0.004 * L), M('#1f3f8f', 0.35), -0.03 * L, 0.195 * L, sd * (W / 2 + 0.001 * L)));
      if (kind === 'ambulance') [-1, 1].forEach((sd) => add(new T.BoxGeometry(0.95 * L, 0.025 * L, 0.004 * L), M('#d6302a', 0.4), -0.02 * L, 0.3 * L, sd * (W / 2 + 0.001 * L)));
      if (kind === 'taxi') [-1, 1].forEach((sd) => { for (let k = 0; k < 10; k++) add(new T.BoxGeometry(0.03 * L, 0.02 * L, 0.004 * L), black, (-0.345 + k * 0.07) * L, 0.21 * L, sd * (W / 2 + 0.001 * L)); });
      if (kind === 'classic') [back[0] + 0.02, front[0] - 0.02].forEach((u) => box(0.04 * L, 0.04 * L, W * 1.02, chrome, u * L, 0.13 * L, 0));
    } else if (kind === 'bicycle' || kind === 'motorcycle' || kind === 'scooter') {
      const r = (kind === 'scooter' ? 0.12 : kind === 'motorcycle' ? 0.17 : 0.19) * L, ub = (kind === 'scooter' ? -0.33 : -0.31) * L, uf = -ub, tw = kind === 'bicycle' ? 0.025 * L : 0.06 * L;
      [ub, uf].forEach((u) => { const e = add(new T.TorusGeometry(r * 0.9, kind === 'bicycle' ? r * 0.08 : r * 0.18, 12, 40), tyre, u, r, 0); add(new T.CylinderGeometry(r * (kind === 'bicycle' ? 0.08 : 0.55), r * (kind === 'bicycle' ? 0.08 : 0.55), tw, 20), rimM, u, r, 0, Math.PI / 2); if (kind === 'bicycle') for (let k = 0; k < 12; k++) { const sp = add(new T.CylinderGeometry(L * 0.002, L * 0.002, r * 1.7, 4), rimM, u, r, 0); sp.rotation.z = k * Math.PI / 12; } });
      const fm = M(col, 0.35, { clear: true }), tb = L * (kind === 'bicycle' ? 0.012 : 0.02);
      if (kind === 'bicycle') { const crank = [0, r * 0.95], seat = [-0.08 * L, r + 0.25 * L], head = [0.22 * L, r + 0.22 * L]; [[[ub, r], crank], [[ub, r], seat], [seat, crank], [crank, head], [seat, head], [head, [uf, r]]].forEach(([a, b]) => tube([[a[0], a[1], 0], [b[0], b[1], 0]], tb, fm)); tube([[head[0], head[1], 0], [head[0] - 0.02 * L, head[1] + 0.08 * L, 0]], tb, black); tube([[head[0] - 0.02 * L, head[1] + 0.08 * L, -0.1 * L], [head[0] - 0.02 * L, head[1] + 0.08 * L, 0.1 * L]], tb, black); box(0.12 * L, 0.025 * L, 0.05 * L, black, seat[0] - 0.01 * L, seat[1] + 0.03 * L, 0); add(new T.CylinderGeometry(0.04 * L, 0.04 * L, 0.01 * L, 24), rimM, 0, crank[1], 0.03 * L, Math.PI / 2); }
      else {
        const body = kind === 'motorcycle' ? [[ub / L + 0.05, 0.1], [-0.12, 0.22], [0.02, 0.27], [0.18, 0.25], [0.26, 0.16], [0.12, 0.05], [-0.02, 0.02], [-0.18, 0.05]] : [[ub / L + 0.02, 0.08], [ub / L + 0.04, 0.22], [-0.08, 0.25], [-0.04, 0.08], [0.18, 0.08], [0.2, 0.38], [0.24, 0.38], [uf / L + 0.02, 0.06], [0.1, -0.02], [-0.2, -0.02]];
        const g = extrudeSide(body.map(([u, v]) => [u, v + r / L]), 0.16 * L, fm, 0.03 * L); g.position.z = 0;
        box(0.22 * L, 0.03 * L, 0.12 * L, black, (kind === 'motorcycle' ? -0.15 : -0.16) * L, r + (kind === 'motorcycle' ? 0.24 : 0.27) * L, 0);
        tube([[uf, r, 0], [0.22 * L, r + (kind === 'motorcycle' ? 0.3 : 0.44) * L, 0]], tb * 1.2, chrome); tube([[0.2 * L, r + (kind === 'motorcycle' ? 0.32 : 0.46) * L, -0.16 * L], [0.2 * L, r + (kind === 'motorcycle' ? 0.32 : 0.46) * L, 0.16 * L]], tb, black);
        box(0.03 * L, 0.05 * L, 0.06 * L, lamp, 0.27 * L, r + (kind === 'motorcycle' ? 0.22 : 0.4) * L, 0);
        if (kind === 'motorcycle') tube([[-0.02 * L, r + 0.02 * L, 0.08 * L], [-0.3 * L, r + 0.04 * L, 0.1 * L], [-0.42 * L, r + 0.08 * L, 0.1 * L]], tb * 1.4, chrome);
      }
    } else if (kind === 'airplane') {
      const R0 = 0.06 * L, wm = paint, blue = M('#2463d6', 0.35, { clear: true });
      const f = lathe([[0, -0.5 * L], [R0 * 0.35, -0.47 * L], [R0 * 0.8, -0.36 * L], [R0, -0.2 * L], [R0, 0.32 * L], [R0 * 0.85, 0.42 * L], [R0 * 0.5, 0.48 * L], [0, 0.5 * L]], wm, 32); f.rotation.z = -Math.PI / 2; f.position.y = 0.25 * L; // (it stands on its wheels at y 0)
      const wing = new T.Shape(); [[0.08, 0], [-0.08, 0], [-0.2, 0.46], [-0.14, 0.47]].forEach(([u, zz], k) => (k ? wing.lineTo(u * L, zz * L) : wing.moveTo(u * L, zz * L)));
      [-1, 1].forEach((sd) => { const g = new T.ExtrudeGeometry(wing, { depth: 0.012 * L, bevelEnabled: false }); const e = add(g, wm, 0.02 * L, 0.21 * L, 0); e.rotation.x = Math.PI / 2; e.scale.set(1, sd, 1); add(new T.CylinderGeometry(0.03 * L, 0.028 * L, 0.12 * L, 20), M('#c9ced6', 0.3), 0.04 * L, 0.18 * L, sd * 0.16 * L, 0, 0, Math.PI / 2); });
      const fin = new T.Shape(); [[-0.5, 0], [-0.36, 0], [-0.46, 0.17], [-0.5, 0.17]].forEach(([u, v], k) => (k ? fin.lineTo(u * L, v * L) : fin.moveTo(u * L, v * L))); add(new T.ExtrudeGeometry(fin, { depth: 0.01 * L, bevelEnabled: false }), blue, 0, 0.29 * L, -0.005 * L);
      const tail = new T.Shape(); [[0.04, 0], [-0.04, 0], [-0.08, 0.17], [-0.05, 0.17]].forEach(([u, zz], k) => (k ? tail.lineTo(u * L, zz * L) : tail.moveTo(u * L, zz * L))); [-1, 1].forEach((sd) => { const e = add(new T.ExtrudeGeometry(tail, { depth: 0.008 * L, bevelEnabled: false }), wm, -0.44 * L, 0.27 * L, 0); e.rotation.x = Math.PI / 2; e.scale.set(1, sd, 1); });
      for (let k = 0; k < 16; k++) [-1, 1].forEach((sd) => add(new T.SphereGeometry(0.008 * L, 8, 6), glass, (-0.3 + k * 0.042) * L, 0.27 * L, sd * R0 * 0.98));
      box(0.05 * L, 0.02 * L, R0 * 1.2, glass, 0.44 * L, 0.282 * L, 0, 0, -0.5);
      [[0.32, 0], [-0.02, 0.06], [-0.02, -0.06]].forEach(([u, zz]) => { tube([[u * L, 0.2 * L, zz * L], [u * L, 0.04 * L, zz * L]], 0.006 * L, M('#8a919b', 0.4)); add(new T.CylinderGeometry(0.025 * L, 0.025 * L, 0.02 * L, 16), tyre, u * L, 0.025 * L, zz * L, Math.PI / 2); });
    } else if (kind === 'helicopter') {
      const body = add(new T.SphereGeometry(0.16 * L, 32, 24), paint, 0.05 * L, 0.2 * L, 0); body.scale.set(1.3, 0.85, 0.8);
      const bubble = add(new T.SphereGeometry(0.12 * L, 28, 20, 0, Math.PI), M('#bfe3f2', 0.05, { clear: true }), 0.12 * L, 0.21 * L, 0, 0, Math.PI / 2, 0); bubble.scale.set(1, 0.9, 0.9);
      tube([[-0.1 * L, 0.22 * L, 0], [-0.48 * L, 0.24 * L, 0]], 0.03 * L, paint, 0.015 * L);
      const fin = add(new T.BoxGeometry(0.05 * L, 0.12 * L, 0.01 * L), paint, -0.47 * L, 0.3 * L, 0);
      const tr = add(new T.BoxGeometry(0.004 * L, 0.11 * L, 0.012 * L), black, -0.47 * L, 0.3 * L, 0.012 * L); tr.userData.spin = 'z';
      tube([[0.03 * L, 0.34 * L, 0], [0.03 * L, 0.38 * L, 0]], 0.012 * L, black);
      const rot = new T.Group(); rot.position.set(0.03 * L, 0.385 * L, 0); for (let k = 0; k < 4; k++) { const b = new T.Mesh(new T.BoxGeometry(0.9 * L, 0.006 * L, 0.035 * L), black); b.rotation.y = k * Math.PI / 4 * 2; rot.add(b); } rot.userData.spin = 'y'; G.add(rot);
      [-1, 1].forEach((sd) => { tube([[-0.2 * L, 0.02 * L, sd * 0.1 * L], [0.25 * L, 0.02 * L, sd * 0.1 * L], [0.3 * L, 0.05 * L, sd * 0.1 * L]], 0.008 * L, black); [-0.1, 0.15].forEach((u) => tube([[u * L, 0.02 * L, sd * 0.1 * L], [u * L, 0.1 * L, sd * 0.06 * L]], 0.006 * L, black)); });
    } else if (['boat', 'ship', 'sailboat', 'rowboat', 'submarine'].includes(kind)) {
      if (kind === 'submarine') { const c = lathe([[0, -0.5 * L], [0.06 * L, -0.45 * L], [0.085 * L, -0.3 * L], [0.085 * L, 0.3 * L], [0.07 * L, 0.42 * L], [0.03 * L, 0.49 * L], [0, 0.5 * L]], paint, 32); c.rotation.z = -Math.PI / 2; c.position.y = 0.09 * L; box(0.18 * L, 0.11 * L, 0.05 * L, paint, 0.12 * L, 0.21 * L, 0); tube([[0.12 * L, 0.26 * L, 0], [0.12 * L, 0.34 * L, 0], [0.15 * L, 0.34 * L, 0]], 0.006 * L, black); const pr = new T.Group(); pr.position.set(-0.51 * L, 0.09 * L, 0); for (let k = 0; k < 5; k++) { const b = new T.Mesh(new T.BoxGeometry(0.01 * L, 0.06 * L, 0.02 * L), M('#b8a46a', 0.3)); b.rotation.x = k * Math.PI * 2 / 5; pr.add(b); } pr.userData.spin = 'x'; G.add(pr); }
      else {
        const hullC = kind === 'rowboat' ? M('#c99a5a', 0.7) : paint, sea = kind !== 'rowboat';
        const hw = (kind === 'ship' ? 0.11 : kind === 'rowboat' ? 0.2 : 0.16) * L, dep = (kind === 'ship' ? 0.18 : 0.14) * L;
        // a hull: cross sections from the stern to a pointed bow, a deep V below the deck
        const N = 24, M2 = 8, pos = [], idx = [];
        for (let i = 0; i <= N; i++) { const u = i / N, x = (u - 0.5) * L, wd = hw * (u < 0.7 ? 1 - 0.15 * (1 - u / 0.7) ** 2 : Math.sqrt(Math.max(0, 1 - ((u - 0.7) / 0.3) ** 2))), keel = -dep * (0.4 + 0.6 * Math.sin(Math.min(1, u * 1.2) * Math.PI / 2));
          for (let j = 0; j <= M2; j++) { const a = j / M2, zz = (a * 2 - 1) * wd, yy = (1 - Math.abs(a * 2 - 1) ** 1.6) * keel; pos.push(x, yy + dep * 0.6, zz); } }
        for (let i = 0; i < N; i++) for (let j = 0; j < M2; j++) { const a = i * (M2 + 1) + j, b = a + M2 + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
        const hg = new T.BufferGeometry(); hg.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); hg.setIndex(idx); hg.computeVertexNormals(); add(hg, hullC);
        add(new T.BoxGeometry(L * 0.66, 0.01 * L, hw * 1.8), M(kind === 'rowboat' ? '#b8884a' : '#e9e4d8', 0.7), -0.12 * L, dep * 0.6, 0);
        if (kind === 'ship') { for (let d = 0; d < 3; d++) { const e = box((0.72 - d * 0.12) * L, 0.065 * L, hw * (1.7 - d * 0.2), M('#fbfcfd', 0.4), (-0.06 - d * 0.02) * L, dep * 0.6 + (0.04 + d * 0.065) * L, 0); for (let k = 0; k < 12 - d * 2; k++) [-1, 1].forEach((sd) => add(new T.BoxGeometry(0.025 * L, 0.02 * L, 0.004 * L), glass, (-0.38 + d * 0.03 + k * 0.06) * L, dep * 0.6 + (0.04 + d * 0.065) * L, sd * hw * (0.85 - d * 0.1))); } box(0.07 * L, 0.1 * L, 0.06 * L, M('#d6302a', 0.4), -0.16 * L, dep * 0.6 + 0.27 * L, 0); add(new T.BoxGeometry(L * 0.98, 0.04 * L, hw * 2.02), M('#1d3f73', 0.4), 0, dep * 0.3, 0).scale.set(1, 1, 0.98); }
        else if (kind === 'boat') { const c = add(new T.SphereGeometry(0.14 * L, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2), M('#fbfcfd', 0.35, { clear: true }), -0.02 * L, dep * 0.6, 0); c.scale.set(1.3, 0.6, 0.8); box(0.12 * L, 0.06 * L, hw * 1.1, glass, 0.05 * L, dep * 0.6 + 0.07 * L, 0, 0, -0.5); add(new T.BoxGeometry(L * 0.9, 0.025 * L, hw * 2.04), M('#e8742a', 0.4), -0.02 * L, dep * 0.45, 0).scale.set(1, 1, 0.95); }
        else if (kind === 'sailboat') { tube([[0, dep * 0.6, 0], [0, 0.95 * L, 0]], 0.008 * L, M('#7a5a3a', 0.6)); const sail = new T.Shape(); sail.moveTo(0.01 * L, 0.18 * L); sail.lineTo(0.38 * L, 0.18 * L); sail.lineTo(0.01 * L, 0.92 * L); add(new T.ShapeGeometry(sail), M('#fbf7ee', 0.7)); const jib = new T.Shape(); jib.moveTo(-0.01 * L, 0.2 * L); jib.lineTo(-0.3 * L, 0.2 * L); jib.lineTo(-0.01 * L, 0.8 * L); add(new T.ShapeGeometry(jib), M('#f2ede2', 0.7)); }
        else { tube([[-0.1 * L, 0.32 * L, 0.18 * L], [0.2 * L, -0.04 * L, 0.3 * L]], 0.01 * L, M('#a87a44', 0.6)); }
        if (sea && s.water !== false) { const w = add(new T.CircleGeometry(L * 0.58, 48), M('#5aa9e6', 0.15, { clear: true }), 0, dep * 0.25, 0, -Math.PI / 2); w.material = w.material.clone(); w.material.transparent = true; w.material.opacity = 0.55; w.userData.keepOpacity = 0.55; }
      }
    } else if (kind === 'rocket') { // standing up: w is its height
      const H = L; lathe([[0.07 * H, 0.12 * H], [0.08 * H, 0.6 * H], [0.05 * H, 0.85 * H], [0.02 * H, 0.96 * H], [0, H]], paint, 32);
      lathe([[0.05 * H, 0.85 * H], [0.02 * H, 0.96 * H], [0, H], [0, 0.85 * H]], M('#d6302a', 0.35, { clear: true }), 32);
      for (let k = 0; k < 4; k++) { const fin = new T.Shape(); fin.moveTo(0.07 * H, 0.32 * H); fin.lineTo(0.16 * H, 0.1 * H); fin.lineTo(0.16 * H, 0.02 * H); fin.lineTo(0.07 * H, 0.14 * H); const e = add(new T.ExtrudeGeometry(fin, { depth: 0.012 * H, bevelEnabled: false }), M('#d6302a', 0.35, { clear: true })); e.rotation.y = k * Math.PI / 2; }
      add(new T.CylinderGeometry(0.035 * H, 0.035 * H, 0.012 * H, 24), M('#6fc3ea', 0.1, { clear: true }), 0, 0.62 * H, 0.076 * H, Math.PI / 2);
      lathe([[0.03 * H, 0.12 * H], [0.05 * H, 0.06 * H], [0, 0.06 * H]], black, 20); lathe([[0.04 * H, 0.06 * H], [0.01 * H, -0.08 * H], [0, -0.08 * H]], M('#ffb21f', 0.5, { glow: '#ff8a1a', gi: 1 }), 20);
    } else if (kind === 'balloon') { // w is its width
      const H = L; add(new T.BoxGeometry(0.16 * H, 0.12 * H, 0.16 * H), M('#a87a44', 0.8), 0, 0.06 * H, 0);
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([a, b]) => tube([[a * 0.07 * H, 0.12 * H, b * 0.07 * H], [a * 0.14 * H, 0.42 * H, b * 0.14 * H]], 0.003 * H, M('#6a4a24', 0.8)));
      lathe([[0.12 * H, 0.42 * H], [0.2 * H, 0.5 * H], [0.36 * H, 0.66 * H], [0.47 * H, 0.86 * H], [0.5 * H, 1.04 * H], [0.45 * H, 1.22 * H], [0.32 * H, 1.35 * H], [0.16 * H, 1.41 * H], [0, 1.43 * H]], paint, 24);
      lathe([[0.462 * H, 0.82 * H], [0.482 * H, 0.86 * H], [0.495 * H, 0.92 * H], [0.475 * H, 0.9 * H]], M('#f6c21c', 0.5), 24); for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2, c = new T.CatmullRomCurve3([[0.2, 0.5], [0.4, 0.7], [0.505, 1.0], [0.44, 1.24], [0.2, 1.4]].map(([r, y]) => new T.Vector3(Math.cos(a) * r * H, y * H, Math.sin(a) * r * H))); add(new T.TubeGeometry(c, 30, 0.006 * H, 6), M(kitDark3b(col, 0.7), 0.5)); }
    } else if (kind === 'drone') {
      box(0.36 * L, 0.1 * L, 0.26 * L, paint, 0, 0.15 * L, 0);
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([a, b]) => { tube([[a * 0.1 * L, 0.17 * L, b * 0.08 * L], [a * 0.38 * L, 0.22 * L, b * 0.3 * L]], 0.015 * L, black); const pr = new T.Group(); pr.position.set(a * 0.38 * L, 0.25 * L, b * 0.3 * L); const bl = new T.Mesh(new T.BoxGeometry(0.3 * L, 0.006 * L, 0.03 * L), M('#9aa1aa', 0.4)); pr.add(bl); pr.userData.spin = 'y'; G.add(pr); });
      add(new T.SphereGeometry(0.035 * L, 16, 12), glass, 0.17 * L, 0.1 * L, 0);
    } else if (kind === 'tractor' || kind === 'excavator' || kind === 'bulldozer') {
      if (kind === 'tractor') { box(0.6 * L, 0.16 * L, 0.26 * L, paint, 0.06 * L, 0.26 * L, 0); box(0.3 * L, 0.3 * L, 0.3 * L, M('#bfe3f2', 0.1, { clear: true }), -0.15 * L, 0.48 * L, 0); box(0.32 * L, 0.02 * L, 0.32 * L, black, -0.15 * L, 0.63 * L, 0); [-1, 1].forEach((sd) => { wheel(-0.26 * L, 0.24 * L, sd * 0.2 * L, 0.12 * L); wheel(0.32 * L, 0.13 * L, sd * 0.17 * L, 0.08 * L); }); tube([[0.22 * L, 0.33 * L, 0], [0.22 * L, 0.46 * L, 0]], 0.012 * L, black); }
      else {
        [-1, 1].forEach((sd) => { box(0.74 * L, 0.13 * L, 0.12 * L, M('#3a3f47', 0.8), -0.05 * L, 0.065 * L, sd * 0.2 * L); for (let k = 0; k < 6; k++) add(new T.CylinderGeometry(0.04 * L, 0.04 * L, 0.125 * L, 16), M('#6b7079', 0.5), (-0.35 + k * 0.12) * L, 0.065 * L, sd * 0.2 * L, Math.PI / 2); });
        box(0.66 * L, 0.16 * L, 0.46 * L, paint, -0.05 * L, 0.22 * L, 0); box(0.26 * L, 0.24 * L, 0.24 * L, paint, 0.0, 0.42 * L, 0.08 * L); box(0.2 * L, 0.18 * L, 0.245 * L, glass, 0.03 * L, 0.43 * L, 0.08 * L);
        if (kind === 'excavator') { tube([[0.2 * L, 0.32 * L, -0.08 * L], [0.42 * L, 0.72 * L, -0.08 * L]], 0.035 * L, paint); tube([[0.42 * L, 0.72 * L, -0.08 * L], [0.58 * L, 0.32 * L, -0.08 * L]], 0.028 * L, paint); const bk = add(new T.CylinderGeometry(0.08 * L, 0.08 * L, 0.14 * L, 20, 1, false, 0, Math.PI), M('#5a5f68', 0.5), 0.6 * L, 0.26 * L, -0.08 * L, Math.PI / 2); }
        else { box(0.05 * L, 0.3 * L, 0.6 * L, M('#5a5f68', 0.5), 0.4 * L, 0.15 * L, 0); tube([[0.25 * L, 0.2 * L, 0], [0.38 * L, 0.18 * L, 0]], 0.02 * L, black); }
      }
    }
    // facing: its front toward +x, or the way asked
    G.rotation.y = ({ '-x': Math.PI, z: -Math.PI / 2, '-z': Math.PI / 2 })[s.facing] || 0;
  } else if (t === 'animal') { // (v327) an animal in 3D, its front toward +x, standing on the ground (y 0), w its length; it moves
    const A = ANIMALS[kind] || ANIMALS.lion, L = Math.min(14, Math.max(.1, Math.abs(n3(s.w ?? s.size ?? s.len, 3))));
    const C = (h) => new T.Color(h), col = C(A.col), col2 = C(A.col2 || A.col), dk = C(A.dk || kitDark3(A.col));
    const hash = (a, b, c) => { const v = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453; return v - Math.floor(v); };
    // its coat at a point (in parts of its length): the base colour, a lighter belly, and its real pattern
    const coat = (x, y, z, belly) => {
      const c = col.clone(); if (belly != null && y < belly) c.lerp(col2, Math.min(1, (belly - y) * 18));
      const cell = (sz, f) => { const ix = Math.floor(x / sz), iy = Math.floor(y / sz), iz = Math.floor(z / sz); let d1 = 9, d2 = 9; for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let e = -1; e <= 1; e++) { const cx = (ix + a + hash(ix + a, iy + b, iz + e)) * sz, cy = (iy + b + hash(iy + b, iz + e, ix + a)) * sz, cz = (iz + e + hash(iz + e, ix + a, iy + b)) * sz, d = Math.hypot(x - cx, y - cy, z - cz); if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d; } return f(d1, d2); };
      if (A.pat === 'stripes') { const v = Math.sin(x * 48 + Math.sin(y * 14) * 1.1 + y * 6 + Math.sin(x * 9) * .9); if (v > .35) c.copy(dk); }
      if (A.pat === 'spots' && cell(.032, (d1) => d1 < .011)) c.copy(dk);
      if (A.pat === 'rosettes') cell(.045, (d1) => { if (d1 < .017 && d1 > .009) c.copy(dk); else if (d1 <= .009) c.lerp(dk, .25); return 0; });
      if (A.pat === 'patches') cell(.06, (d1, d2) => { if (d2 - d1 > .01) c.copy(dk); return 0; });
      if (A.pat === 'cow' && cell(.16, (d1) => d1 < .06)) c.copy(dk);
      if (A.pat === 'saddle' && x > -.12 && x < .05) c.copy(col2);
      return c;
    };
    const VM = (rough = .7) => { const m = M('#ffffff', rough); const v = m.clone(); v.vertexColors = true; return v; };
    const skinMat = VM(A.b === 'fish' || A.b === 'frog' ? .35 : .72), smooth = (A.b === 'fish' || A.b === 'frog' || A.b === 'jelly');
    const paint = (g, ox, oy, oz, belly, plain) => { const p = g.attributes.position, cs = new Float32Array(p.count * 3); for (let i = 0; i < p.count; i++) { const c = plain ? C(plain) : coat((p.getX(i) + ox) / L, (p.getY(i) + oy) / L, (p.getZ(i) + oz) / L, belly); if (!plain && !smooth) c.multiplyScalar(.94 + hash(p.getX(i), p.getY(i), p.getZ(i)) * .1); cs[i * 3] = c.r; cs[i * 3 + 1] = c.g; cs[i * 3 + 2] = c.b; } g.setAttribute('color', new T.BufferAttribute(cs, 3)); return g; };
    const ell = (rx, ry, rz, seg = 32, amp = .03) => { const g = new T.SphereGeometry(1, seg, Math.round(seg * .7)), p = g.attributes.position, v = new T.Vector3(), o = R() * 9; for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); const d = 1 + amp * noise(v.x * 2 + o, v.y * 2, v.z * 2 + o); p.setXYZ(i, v.x * rx * d, v.y * ry * d, v.z * rz * d); } g.computeVertexNormals(); return g; };
    const part = (geo, x, y, z, belly, plain, parent = G, mat = skinMat) => { paint(geo, x, y, z, belly, plain); const e = new T.Mesh(geo, mat); e.position.set(x, y, z); parent.add(e); return e; };
    const plainM = (h, r = .6, ex) => M(h, r, ex);
    const pivot = (x, y, z, parent = G) => { const g = new T.Group(); g.position.set(x, y, z); parent.add(g); return g; };
    // a limb in a pivot: a tapered tube through points (relative to the pivot), painted with the coat
    const limb3 = (pv, pts, r0, r1, belly, plain) => { const segs = A.pat && !plain ? 64 : 16, rad = A.pat && !plain ? 21 : 11, curve = new T.CatmullRomCurve3(pts.map((q) => new T.Vector3(...q))), g = new T.TubeGeometry(curve, segs, r0, rad - 1, false), p = g.attributes.position, c = new T.Vector3(), v = new T.Vector3();
      for (let i = 0; i <= segs; i++) { const u = i / segs, k = (r0 + (r1 - r0) * u) / r0; curve.getPointAt(u, c); for (let j = 0; j < rad; j++) { const idx = i * rad + j; v.fromBufferAttribute(p, idx).sub(c).multiplyScalar(k).add(c); p.setXYZ(idx, v.x, v.y, v.z); } } g.computeVertexNormals();
      paint(g, pv.position.x, pv.position.y, pv.position.z, belly, plain); const e = new T.Mesh(g, skinMat); pv.add(e);
      [pts[0], pts[pts.length - 1]].forEach((q, k) => { const cap = new T.Mesh(paint(new T.SphereGeometry(k ? r1 : r0, 12, 8), pv.position.x + q[0], pv.position.y + q[1], pv.position.z + q[2], belly, plain), skinMat); cap.position.set(...q); pv.add(cap); });
      return e; };
    const eyes = (x, y, z, r, parent = G) => [-1, 1].forEach((sd) => { const e = new T.Mesh(new T.SphereGeometry(r, 12, 10), M('#14100e', .15, { clear: true })); e.position.set(x, y, sd * z); parent.add(e); const hl = new T.Mesh(new T.SphereGeometry(r * .3, 8, 6), M('#ffffff', .2)); hl.position.set(x + r * .5, y + r * .4, sd * (z + r * .6)); parent.add(hl); });
    const legs = [], wings = [], tails = [], heads = [], fins = [], arms = []; let bob = null, pulse = null, speed = 1;
    if (A.b === 'quad') {
      const leg = A.leg * L, bh = A.bh * L, t = (A.tilt || 0) * L, rz = bh * (A.trunk ? .42 : .38), back = leg + bh, cy = leg + bh / 2, belly = (cy - bh * .25) / L;
      const fine = A.pat ? 96 : 40, body = part(ell(.34 * L, bh / 2, rz, fine, .025), 0, cy + t * .3, 0, belly); body.rotation.z = Math.atan2(t, .3 * L);
      const na = A.neck[1] * Math.PI / 180, nl = A.neck[0] * L, hr = A.hr * L, nb = A.biped ? [.2 * L, back + t - bh * .15, 0] : [.25 * L, back + t - bh * .28, 0];
      const h0 = [nb[0] + Math.cos(na) * nl + hr * .5, nb[1] + Math.sin(na) * nl + (A.trunk ? bh * .05 : 0), 0];
      if (A.hump) part(ell(.12 * L, A.hump * L * 1.2, rz * .8), A.trunk ? .18 * L : 0, back + A.hump * L * .2, 0, null);
      if (nl > .01 * L) { const nk = pivot(0, 0, 0); limb3(nk, [[nb[0] - .03 * L, nb[1] - bh * .1, 0], [nb[0] + Math.cos(na) * nl * .5, nb[1] + Math.sin(na) * nl * .5, 0], [h0[0] - hr * .4, h0[1] - hr * .1, 0]], Math.max(bh * .3, hr * .7), hr * .62, belly); }
      // the head (in a pivot that nods), with its face and features
      const hp = pivot(h0[0] - hr * .6, h0[1] - hr * .3, 0); heads.push(hp); const hx = hr * .6, hy = hr * .3;
      part(ell(hr * .95, hr * .78, hr * .72, A.pat ? 64 : 28), hx, hy, 0, null, null, hp);
      const sn = A.sn * L, dr = (A.drop || 0) * L;
      part(ell(hr * .3 + sn * .55, hr * .42, hr * .45, 24), hx + hr * .55 + sn * .45, hy - hr * .22 - dr, 0, null, null, hp);
      eyes(hx + hr * .45, hy + hr * .25, hr * .55, hr * .11, hp);
      const nose = new T.Mesh(new T.SphereGeometry(hr * .1, 10, 8), M('#2a201c', .3)); nose.position.set(hx + hr * .62 + sn, hy - hr * .12 - dr, 0); if (!A.trunk) hp.add(nose);
      const earC = A.ear === 'mouse' ? '#f2b8b8' : null;
      if (['pointed', 'round', 'small', 'mouse', 'flop', 'long'].includes(A.ear)) [-1, 1].forEach((sd) => { const big = A.ear === 'mouse' ? 1.6 : A.ear === 'small' ? .6 : A.ear === 'long' ? 1 : 1; let g;
        if (A.ear === 'pointed') { g = new T.ConeGeometry(hr * .26 * big, hr * .6 * big, 10); }
        else if (A.ear === 'long') { g = ell(hr * .15, hr * 1.1, hr * .06, 14); }
        else if (A.ear === 'flop') { g = ell(hr * .3, hr * .45, hr * .08, 14); }
        else g = ell(hr * .26 * big, hr * .26 * big, hr * .08, 14);
        const e = part(g, hx - hr * .25, hy + hr * (A.ear === 'flop' ? .2 : A.ear === 'long' ? 1.6 : .8), sd * hr * .45, null, earC || (A.panda ? A.dk : null), hp); e.rotation.x = sd * (A.ear === 'flop' ? .9 : .35); if (A.ear === 'flop') e.position.y = hy + hr * .1; });
      if (A.ear === 'big') [-1, 1].forEach((sd) => { const e = part(ell(hr * .7, hr * .95, hr * .06, 20), hx - hr * .4, hy + hr * .1, sd * hr * .75, null, kitDark3b(A.col, .92), hp); e.rotation.y = sd * .5; });
      if (A.mane && String(A.mane).startsWith('#')) part(ell(hr * 1.45, hr * 1.55, hr * 1.25, 24, .12), hx - hr * .55, hy - hr * .1, 0, null, A.mane, hp);
      if (A.mane === 'stiff' || A.mane === 'flow' || A.mane === 'short') { const mp = pivot(0, 0, 0); limb3(mp, [[nb[0] - .02 * L, nb[1] + bh * .25, 0], [h0[0] - hr * .5, h0[1] + hr * .6, 0]], .02 * L, .015 * L, null, A.mane === 'short' ? A.dk : kitDark3b(A.col, .45)); }
      if (A.horn === 'rhino') { [[hx + hr * .6 + sn, hy + hr * .25 - dr, hr * .22, hr * .9], [hx + hr * .35 + sn * .5, hy + hr * .6, hr * .14, hr * .45]].forEach(([x, y, r, h]) => { const c = new T.Mesh(new T.ConeGeometry(r, h, 14), M('#cfc6b4', .5)); c.position.set(x, y + h * .4, 0); c.rotation.z = -.25; hp.add(c); }); }
      if (A.horn === 'buffalo' || A.horn === 'cow' || A.horn === 'goat') [-1, 1].forEach((sd) => { const hc = A.horn === 'buffalo' ? '#2a2826' : A.horn === 'goat' ? '#8a7a62' : '#e8dcc0'; const pts = A.horn === 'buffalo' ? [[hx - hr * .1, hy + hr * .6, sd * hr * .3], [hx - hr * .2, hy + hr * .55, sd * hr * 1.1], [hx - hr * .5, hy - hr * .1, sd * hr * 1.2], [hx - hr * .1, hy - hr * .05, sd * hr * 1.05]] : A.horn === 'goat' ? [[hx - hr * .1, hy + hr * .7, sd * hr * .25], [hx - hr * .5, hy + hr * 1.3, sd * hr * .35], [hx - hr * 1, hy + hr * 1.1, sd * hr * .4]] : [[hx - hr * .1, hy + hr * .6, sd * hr * .4], [hx - hr * .1, hy + hr * .9, sd * hr * .8], [hx + hr * .1, hy + hr * 1.2, sd * hr * .85]]; const c = new T.CatmullRomCurve3(pts.map((q) => new T.Vector3(...q))); hp.add(new T.Mesh(new T.TubeGeometry(c, 16, hr * (A.horn === 'buffalo' ? .13 : .07), 8), M(hc, .5))); });
      if (A.horn === 'antlers') [-1, 1].forEach((sd) => { const b0 = new T.Vector3(hx - hr * .2, hy + hr * .75, sd * hr * .3), m = M('#7a5a3a', .7); hp.add(new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3([b0, b0.clone().add(new T.Vector3(-hr * .4, hr * .8, sd * hr * .5)), b0.clone().add(new T.Vector3(-hr * .9, hr * 1.7, sd * hr * .7))]), 12, hr * .06, 6), m)); [[-.5, 1, .55], [-.75, 1.4, .65]].forEach(([dx, dy, dz]) => { const p0 = b0.clone().add(new T.Vector3(dx * hr, dy * hr, sd * dz * hr)); hp.add(new T.Mesh(new T.TubeGeometry(new T.LineCurve3(p0, p0.clone().add(new T.Vector3(hr * .45, hr * .5, 0))), 4, hr * .045, 6), m)); }); });
      if (A.horn === 'tri') [[hx + hr * .1, hy + hr * .75, hr * .35, hr * .1, 1.2], [hx + hr * .6 + sn, hy + hr * .1 - dr, 0, hr * .1, .6]].forEach(([x, y, z, r, hh]) => [-1, 1].forEach((sd) => { if (!z && sd < 0) return; const c = new T.Mesh(new T.ConeGeometry(r, hr * hh, 12), M('#e8dcc0', .5)); c.position.set(x + hr * .2, y + hr * hh * .4, sd * z); c.rotation.z = -.6; hp.add(c); }));
      if (A.frill) { const f = part(new T.CircleGeometry(hr * 1.5, 24), hx - hr * .6, hy + hr * .5, 0, null, A.col2, hp); f.rotation.y = Math.PI / 2; f.rotation.x = .3; f.material = f.material.clone(); f.material.side = T.DoubleSide; }
      if (A.ossicones) [-1, 1].forEach((sd) => { const o = new T.Mesh(new T.CylinderGeometry(hr * .06, hr * .07, hr * .55, 8), plainM(A.col, .6)); o.position.set(hx - hr * .2, hy + hr * 1.05, sd * hr * .2); hp.add(o); const k = new T.Mesh(new T.SphereGeometry(hr * .1, 8, 6), plainM(A.dk, .6)); k.position.set(hx - hr * .2, hy + hr * 1.35, sd * hr * .2); hp.add(k); });
      if (A.trunk) { const tp = pivot(hx + hr * .7, hy - hr * .1, 0, hp); tails.push(tp); limb3(tp, [[0, 0, 0], [hr * .45, -hr * .8, 0], [hr * .4, -hr * 1.8, 0], [hr * .65, -hr * 2.4, 0]], hr * .3, hr * .12, null); }
      if (A.tusks === 'straight' || A.tusks === 'curl') [-1, 1].forEach((sd) => { const pts = A.tusks === 'curl' ? [[hx + hr * .5, hy - hr * .45, sd * hr * .35], [hx + hr * 1.4, hy - hr * 1.3, sd * hr * .7], [hx + hr * 2.1, hy - hr * .5, sd * hr * .5], [hx + hr * 1.5, hy + hr * .2, sd * hr * .2]] : [[hx + hr * .5, hy - hr * .45, sd * hr * .32], [hx + hr * 1.1, hy - hr * 1, sd * hr * .38], [hx + hr * 1.55, hy - hr * .8, sd * hr * .3]]; hp.add(new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(pts.map((q) => new T.Vector3(...q))), 16, hr * .09, 8), M('#f4efe2', .35))); });
      if (A.sabre) [-1, 1].forEach((sd) => { const c = new T.Mesh(new T.ConeGeometry(hr * .07, hr * .8, 8), M('#f4efe2', .4)); c.position.set(hx + hr * .5 + sn * .5, hy - hr * .75, sd * hr * .2); c.rotation.z = Math.PI; hp.add(c); });
      if (A.teeth) for (let k = 0; k < 6; k++) [-1, 1].forEach((sd) => { const c = new T.Mesh(new T.ConeGeometry(hr * .04, hr * .14, 6), M('#f4efe2', .4)); c.position.set(hx + hr * .2 + k * (hr * .5 + sn) / 6, hy - hr * .5 - dr * .5, sd * hr * .36); c.rotation.z = Math.PI; hp.add(c); });
      if (A.panda) [-1, 1].forEach((sd) => { const e = part(ell(hr * .2, hr * .16, hr * .05, 12), hx + hr * .35, hy + hr * .22, sd * hr * .58, null, A.dk, hp); e.rotation.x = sd * .3; });
      if (A.wool) for (let k = 0; k < 40; k++) { const a = R() * Math.PI * 2, b = (R() - .3) * Math.PI * .8; part(new T.SphereGeometry(bh * .18, 10, 8), Math.cos(b) * Math.cos(a) * .3 * L, cy + Math.sin(b) * bh * .45, Math.cos(b) * Math.sin(a) * rz * .95, null, A.wool); }
      if (A.spikes) for (let k = 0; k < 70; k++) { const a = R() * Math.PI, b = R() * Math.PI, dir = new T.Vector3(Math.cos(a) * .9, Math.sin(a) * Math.sin(b) + .1, Math.sin(a) * Math.cos(b)).normalize(); if (dir.x > .6) continue; const c = new T.Mesh(new T.ConeGeometry(bh * .04, bh * .3, 5), plainM(A.spikes, .7)); c.position.set(dir.x * .3 * L, cy + dir.y * bh * .5, dir.z * rz); c.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), dir); G.add(c); }
      if (A.plates) for (let k = 0; k < 7; k++) { const u = (-.24 + k * .07) * L, h = (.08 + Math.sin(k / 6 * Math.PI) * .08) * L, sh = new T.Shape(); sh.moveTo(-.035 * L, 0); sh.lineTo(0, h); sh.lineTo(.035 * L, 0); const e = new T.Mesh(new T.ExtrudeGeometry(sh, { depth: .012 * L, bevelEnabled: false }), plainM(A.plates, .6)); e.position.set(u, back - .01 * L + Math.sin(k / 6 * Math.PI) * .02 * L, (k % 2 ? .015 : -.015) * L - .006 * L); G.add(e); }
      if (A.udder) part(new T.SphereGeometry(.035 * L, 12, 10), -.1 * L, leg + .01 * L, 0, null, '#f2b8b0');
      // the tail
      const tp = pivot(-.33 * L, back - bh * .2 - t * .5, 0); tails.push(tp);
      if (A.tail === 'dino') limb3(tp, [[.06 * L, 0, 0], [-.18 * L, -.06 * L, 0], [-.38 * L, -.15 * L, 0], [-.55 * L, -.2 * L, 0]], bh * .38, .01 * L, null);
      else if (A.tail === 'bushy' || A.tail === 'feather') { limb3(tp, [[0, 0, 0], [-.12 * L, -.05 * L, 0], [-.25 * L, -.1 * L, 0]], .03 * L, .04 * L, null); if (A.tip) part(new T.SphereGeometry(.035 * L, 10, 8), -.26 * L, -.1 * L, 0, null, A.tip, tp); }
      else if (A.tail === 'horse') limb3(tp, [[0, 0, 0], [-.08 * L, -.12 * L, 0], [-.1 * L, -.3 * L, 0]], .03 * L, .02 * L, null, kitDark3b(A.col, .4));
      else if (A.tail === 'puff') part(new T.SphereGeometry(.05 * L, 12, 10), -.02 * L, -.02 * L, 0, null, A.col2, tp);
      else if (A.tail === 'stub' || A.tail === 'curl') part(new T.SphereGeometry(.03 * L, 10, 8), -.02 * L, -.01 * L, 0, null, null, tp);
      else if (A.tail !== 'none') { const len = A.tail === 'long' ? .38 : A.tail === 'rat' ? .45 : .26, droop = A.tail === 'long' ? .05 : .22; limb3(tp, [[0, 0, 0], [-len * .4 * L, -droop * .6 * L, 0], [-len * L, -droop * L * (A.tail === 'long' ? -.5 : 1.1), 0]], (A.tail === 'long' ? .02 : .012) * L, .008 * L, null, A.tail === 'rat' ? '#e8b8b8' : null); if (A.tail === 'tuft') part(new T.SphereGeometry(.03 * L, 10, 8), -len * L, -droop * 1.15 * L, 0, null, A.dk, tp); }
      // the legs, in diagonal pairs (as animals walk)
      const legAt = (u, z, hind, phase) => { const top = leg + bh * .45, pv = pivot(u * L, top, z); legs.push([pv, phase]); const lt = A.legT * L;
        if (A.biped && !hind) { limb3(pv, [[0, 0, 0], [.04 * L, -.08 * L, 0], [.07 * L, -.09 * L, 0]], lt * .25, lt * .12, null); return; }
        const pts = hind ? [[0, 0, 0], [.035 * L, -top * .5, 0], [-.02 * L, -top * .76, 0], [.005 * L, -top + lt * .3, 0]] : [[0, 0, 0], [-.005 * L, -top * .45, 0], [.005 * L, -top * .78, 0], [.01 * L, -top + lt * .3, 0]];
        limb3(pv, pts, lt * (hind ? .8 : .65), lt * .32, null, A.panda ? A.dk : null);
        const foot = A.foot === 'hoof' ? new T.Mesh(new T.CylinderGeometry(lt * .3, lt * .36, lt * .35, 12), M('#2a2422', .5)) : new T.Mesh(paint(ell(lt * .45, lt * .25, lt * .38, 12, 0), pv.position.x, 0, z, null, A.panda ? A.dk : A.foot === 'pad' ? kitDark3b(A.col, .85) : null), skinMat);
        foot.position.set(pts[3][0] + lt * .1, -top + lt * .18, 0); pv.add(foot); };
      const fz = rz * .55, fu = A.biped ? .16 : .2, hu = A.biped ? -.08 : -.22;
      legAt(fu, -fz, false, 0); legAt(fu, fz, false, Math.PI); legAt(hu, fz, true, 0); legAt(hu, -fz, true, Math.PI);
      speed = 4.2 * Math.min(1.6, Math.max(.6, .35 / Math.max(.1, A.leg + .1)));
    } else if (A.b === 'upright') {
      const sit = !!A.sit, hr = A.hr * L, cyb = (sit ? .3 : .38) * L;
      part(ell(.15 * L, (sit ? .27 : .3) * L, .13 * L, 30), 0, cyb, 0, null);
      const hp = pivot(0, cyb + (sit ? .3 : .34) * L, 0); heads.push(hp);
      part(ell(hr * .95, hr * .9, hr * .85, 24), 0, hr * .5, 0, null, null, hp); part(ell(hr * .5, hr * .45, hr * .55, 16), hr * .55, hr * .35, 0, null, A.col2, hp); eyes(hr * .6, hr * .65, hr * .4, hr * .11, hp);
      if (A.mask) [-1, 1].forEach((sd) => part(ell(hr * .25, hr * .18, hr * .05, 10), hr * .55, hr * .65, sd * hr * .5, null, A.dk, hp));
      if (kind !== 'sloth') [-1, 1].forEach((sd) => part(ell(hr * .25, hr * .25, hr * .07, 10), -hr * .1, hr * .9, sd * hr * .7, null, null, hp));
      [-1, 1].forEach((sd, k) => { const ap = pivot(.02 * L, cyb + .2 * L, sd * .13 * L); arms.push([ap, k * Math.PI]); limb3(ap, [[0, 0, 0], [.08 * L, -.12 * L, 0], [.12 * L, -.2 * L, 0]], .045 * L, .03 * L, null); });
      [-1, 1].forEach((sd, k) => { const lp = pivot(0, cyb - .15 * L, sd * .08 * L); legs.push([lp, k * Math.PI]); limb3(lp, sit ? [[0, 0, 0], [.14 * L, -.08 * L, 0], [.2 * L, -.12 * L, 0]] : [[0, 0, 0], [.02 * L, -.12 * L, 0], [.04 * L, -(cyb - .17 * L), 0]], .055 * L, .04 * L, null); });
      if (A.tail === 'monkey' || A.tail === 'thin' || A.tail === 'kanga') { const tp = pivot(-.12 * L, cyb - .15 * L, 0); tails.push(tp); limb3(tp, A.tail === 'monkey' ? [[0, 0, 0], [-.25 * L, -.1 * L, 0], [-.35 * L, .2 * L, 0], [-.25 * L, .3 * L, 0]] : [[0, 0, 0], [-.15 * L, -.12 * L, 0], [-.3 * L, -.15 * L, 0]], (A.tail === 'kanga' ? .06 : .02) * L, .012 * L, null); }
      speed = A.hop ? 5 : 1.5;
    } else if (A.b === 'bird') {
      const fly = s.pose === 'fly' && !A.flightless, up = !!A.upright, legL = (fly ? 0 : A.leg) * L, by = fly ? 0 : legL + (up ? .3 : .18) * L, fat = A.fat ? 1.25 : 1;
      const body = part(ell((up ? .14 : .26) * L * fat, (up ? .3 : .12) * L * fat, (up ? .13 : .11) * L * fat, 32), 0, by, 0, (by - (up ? .1 : .05) * L) / L);
      paint(body.geometry, 0, by, 0, null); const bc = body.geometry.attributes.color, bp = body.geometry.attributes.position; const bel = C(A.belly), ccol = C(A.col); for (let i = 0; i < bp.count; i++) { const yy = bp.getY(i), xx = bp.getX(i), f = up ? (xx > 0 ? 1 : 0) : (yy < -.02 * L ? 1 : 0); const c = f ? bel : ccol; bc.setXYZ(i, c.r, c.g, c.b); } bc.needsUpdate = true;
      if (!up) body.rotation.z = .25;
      const head = up ? [.02 * L, by + .36 * L, 0] : A.sneck ? [.18 * L, by + .55 * L, 0] : [.27 * L, by + .13 * L, 0], hr = (up ? (kind === 'owl' ? .13 : .09) : kind === 'hummingbird' ? .055 : .075) * L * (A.fat ? 1.3 : 1);
      if (A.sneck) { const nk = pivot(0, 0, 0); limb3(nk, [[.18 * L, by + .08 * L, 0], [.06 * L, by + .25 * L, 0], [.22 * L, by + .4 * L, 0], [head[0], head[1] - hr * .4, 0]], .035 * L, .03 * L, null, A.col); }
      const hp = pivot(head[0], head[1], 0); heads.push(hp);
      part(ell(hr, hr * .95, hr * .9, 20), 0, 0, 0, null, A.head, hp);
      if (A.face) [-1, 1].forEach((sd) => part(ell(hr * .45, hr * .35, hr * .05, 10), hr * .35, 0, sd * hr * .75, null, A.face, hp));
      if (A.disc) part(ell(hr * .3, hr * .85, hr * .9, 16), hr * .55, 0, 0, null, A.disc, hp);
      if (A.throat) part(ell(hr * .6, hr * .45, hr * .7, 14), hr * .2, -hr * .55, 0, null, A.throat, hp);
      if (A.neck) part(ell(hr * .5, hr * .3, hr * .95, 12), -hr * .1, -hr * .9, 0, null, A.neck, hp);
      if (A.tufts) [-1, 1].forEach((sd) => { const c = new T.Mesh(new T.ConeGeometry(hr * .18, hr * .55, 8), plainM(A.col, .7)); c.position.set(0, hr * 1.05, sd * hr * .5); hp.add(c); });
      if (A.comb) { const c = part(ell(hr * .5, hr * .35, hr * .1, 12), 0, hr * .95, 0, null, '#d8262b', hp); part(ell(hr * .15, hr * .3, hr * .1, 8), hr * .55, -hr * .7, 0, null, '#d8262b', hp); }
      const bl = { needle: 3.2, toucan: 2.7, duck: 1.15, flamingo: 1.1, dodo: 1.35, hook: .9, parrot: .7, cone: .7, owl: .35 }[A.beak] || .7, bw = { toucan: .55, dodo: .5, parrot: .45, hook: .38, duck: .35, flamingo: .3 }[A.beak] || .25;
      const beak = new T.Mesh(new T.ConeGeometry(hr * bw, hr * bl, 14), M(A.bc, .4, { clear: true })); beak.rotation.z = -Math.PI / 2 - (A.beak === 'hook' || A.beak === 'parrot' || A.beak === 'flamingo' ? .35 : 0); beak.position.set(hr * .8 + hr * bl * .45, -hr * .1, 0); beak.scale.set(1, 1, A.beak === 'duck' ? .6 : 1); hp.add(beak);
      eyes(hr * .45, hr * .25, hr * .62, hr * (kind === 'owl' ? .2 : .13), hp);
      // tail and legs
      const tp = pivot(up ? -.04 * L : -.24 * L, up ? by - .25 * L : by + .02 * L, 0); tails.push(tp);
      const tl = A.tail === 'long' ? .4 : A.tail === 'fan' ? .24 : A.tail === 'hen' ? .2 : .14;
      const tf = part(ell(tl * .5 * L, .02 * L, (A.tail === 'fan' ? .08 : .05) * L, 16, 0), -tl * .45 * L, A.tail === 'hen' ? .08 * L : -.04 * L, 0, null, A.tc || A.col, tp); tf.rotation.z = A.tail === 'hen' ? -.9 : up ? .9 : .35;
      if (!fly) [-1, 1].forEach((sd, k) => { const lp = pivot(.02 * L, by - (up ? .26 : .08) * L, sd * .04 * L); legs.push([lp, k * Math.PI]); limb3(lp, [[0, 0, 0], [0, -(by - (up ? .26 : .08) * L) * .5, 0], [0, -(by - (up ? .26 : .08) * L) + .01 * L, 0]], .012 * L, .01 * L, null, A.lc); const ft = new T.Mesh(new T.BoxGeometry(.08 * L, .008 * L, .05 * L), M(A.lc, .6)); ft.position.set(.02 * L, -(by - (up ? .26 : .08) * L) + .005 * L, 0); lp.add(ft); });
      // wings: folded on the body, or spread and flapping
      [-1, 1].forEach((sd) => { const wp = pivot(.04 * L, by + (fly ? .04 : .03) * L, sd * (up ? .12 : .1) * L); wings.push([wp, sd]);
        const sh = new T.Shape(); if (fly) { sh.moveTo(0, 0); sh.quadraticCurveTo(.16 * L, .06 * L, .12 * L, .5 * L); sh.quadraticCurveTo(-.02 * L, .58 * L, -.16 * L, .45 * L); sh.quadraticCurveTo(-.14 * L, .2 * L, -.1 * L, 0); }
        else if (up) { sh.moveTo(0, .15 * L); sh.quadraticCurveTo(-.08 * L, 0, -.02 * L, -.28 * L); sh.quadraticCurveTo(.04 * L, -.05 * L, 0, .15 * L); }
        else { sh.moveTo(.12 * L, .05 * L); sh.quadraticCurveTo(-.05 * L, .1 * L, -.3 * L, -.02 * L); sh.quadraticCurveTo(-.05 * L, -.08 * L, .12 * L, .05 * L); }
        const g = new T.ExtrudeGeometry(sh, { depth: .012 * L, bevelEnabled: true, bevelSize: .006 * L, bevelThickness: .006 * L, bevelSegments: 2 });
        if (fly) g.rotateX(sd * Math.PI / 2); else g.translate(0, 0, sd > 0 ? 0 : -.012 * L);
        const wm = M(A.wing, .65); const e = new T.Mesh(g, wm); wp.add(e);
        if (A.band && fly) { const b = new T.Mesh(new T.BoxGeometry(.2 * L, .015 * L, .03 * L), M(A.band, .6)); b.position.set(-.02 * L, .01 * L, sd * .25 * L); b.rotation.x = Math.PI / 2; wp.add(b); }
      });
      speed = A.fast ? 40 : fly ? 7 : 2;
    } else if (A.b === 'bat') {
      const m = M(A.wing, .7, {}); part(ell(.07 * L, .1 * L, .06 * L, 16), 0, 0, 0, null, A.col);
      const hp = pivot(0, .12 * L, 0); heads.push(hp); part(new T.SphereGeometry(.05 * L, 14, 10), 0, 0, 0, null, A.col, hp); eyes(.035 * L, .01 * L, .03 * L, .008 * L, hp);
      if (A.crest) { const c = new T.Mesh(new T.ConeGeometry(.02 * L, .22 * L, 8), plainM(A.col, .6)); c.rotation.z = Math.PI / 2 - .3; c.position.set(-.1 * L, .03 * L, 0); hp.add(c); const bk = new T.Mesh(new T.ConeGeometry(.02 * L, .2 * L, 8), M('#d8a83a', .5)); bk.rotation.z = -Math.PI / 2; bk.position.set(.13 * L, -.01 * L, 0); hp.add(bk); }
      else [-1, 1].forEach((sd) => { const c = new T.Mesh(new T.ConeGeometry(.018 * L, .05 * L, 6), plainM(A.col, .6)); c.position.set(0, .05 * L, sd * .025 * L); hp.add(c); });
      [-1, 1].forEach((sd) => { const wp = pivot(0, .04 * L, sd * .04 * L); wings.push([wp, sd]); const sh = new T.Shape(); [[0, .02], [.1, .28], [.3, .3], [.48, .18], [.38, .1], [.3, .13], [.22, .02], [.12, .06], [.05, -.04]].forEach(([a, b], k) => (k ? sh.lineTo(a * L, b * L) : sh.moveTo(a * L, b * L))); const g = new T.ShapeGeometry(sh); g.rotateX(-Math.PI / 2); g.rotateY(sd > 0 ? -Math.PI / 2 : Math.PI / 2); const e = new T.Mesh(g, m); e.material = m.clone(); e.material.side = T.DoubleSide; wp.add(e); });
      speed = 9;
    } else if (A.b === 'fish') {
      const h = (A.whale ? .22 : A.shark ? .17 : A.dolphin ? .16 : A.fancy ? .26 : .22) * L, flat = A.whale || A.dolphin || A.shark ? .75 : .45;
      const bodyG = ell(.42 * L, h * .7, h * .7 * flat, 40, .01), bp = bodyG.attributes.position; for (let i = 0; i < bp.count; i++) { const x = bp.getX(i), f = Math.max(0, -x / (.42 * L)); bp.setY(i, bp.getY(i) * (1 - f * .55)); bp.setZ(i, bp.getZ(i) * (1 - f * .5)); } bodyG.computeVertexNormals();
      const body = part(bodyG, .04 * L, 0, 0, -h * .15 / L); bob = body;
      if (A.bands) { const cc = body.geometry.attributes.color; for (let i = 0; i < bp.count; i++) { const x = bp.getX(i) / L + .04; if ([.25, .02, -.22].some((u) => Math.abs(x - u) < .03)) cc.setXYZ(i, .97, .96, .94); } cc.needsUpdate = true; }
      const finM = M(A.fin, .5, {}); finM.side = T.DoubleSide;
      const tp = pivot(-.36 * L, 0, 0); tails.push(tp); const ts = new T.Shape();
      if (A.whale || A.dolphin) { ts.moveTo(0, 0); ts.lineTo(-.14 * L, .12 * L); ts.lineTo(-.1 * L, 0); ts.lineTo(-.14 * L, -.12 * L); ts.lineTo(0, 0); const g = new T.ShapeGeometry(ts); g.rotateX(Math.PI / 2); tp.add(new T.Mesh(g, finM)); }
      else { ts.moveTo(.02 * L, 0); ts.lineTo(-.14 * L, h * (A.shark ? 1.1 : .85)); ts.lineTo(-.1 * L, 0); ts.lineTo(-.14 * L, -h * (A.shark ? .5 : .85)); ts.lineTo(.02 * L, 0); tp.add(new T.Mesh(new T.ShapeGeometry(ts), finM)); }
      const ds = new T.Shape(); if (A.shark || A.dolphin) { ds.moveTo(-.04 * L, 0); ds.lineTo(.02 * L, h * .9); ds.lineTo(.08 * L, 0); } else { ds.moveTo(-.16 * L, 0); ds.quadraticCurveTo(0, h * .7, .12 * L, 0); } const df = new T.Mesh(new T.ShapeGeometry(ds), finM); df.position.set(A.whale ? -.15 * L : 0, h * .6, 0); G.add(df);
      [-1, 1].forEach((sd) => { const pf = new T.Mesh(new T.ShapeGeometry((() => { const s2 = new T.Shape(); s2.moveTo(0, 0); s2.lineTo(-.1 * L, -.12 * L * (A.whale ? 1.8 : 1)); s2.lineTo(-.03 * L, -.02 * L); return s2; })()), finM); pf.position.set(.16 * L, -h * .25, sd * h * .5 * flat); pf.rotation.x = sd * .6; G.add(pf); fins.push([pf, sd]); });
      eyes(.33 * L, h * .12, h * .55 * flat, h * .09);
      speed = A.whale ? 1.6 : 4;
    } else if (A.b === 'octopus') {
      const mant = part(ell(.15 * L, .22 * L, .15 * L, 30, .04), 0, .5 * L, 0, null); pulse = mant; eyes(.12 * L, .38 * L, .09 * L, .025 * L);
      for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2, ap = pivot(Math.cos(a) * .07 * L, .32 * L, Math.sin(a) * .07 * L); arms.push([ap, k * .8]); limb3(ap, [[0, 0, 0], [Math.cos(a) * .15 * L, -.18 * L, Math.sin(a) * .15 * L], [Math.cos(a) * .32 * L, -.28 * L, Math.sin(a) * .32 * L], [Math.cos(a + .6) * .4 * L, -.22 * L, Math.sin(a + .6) * .4 * L]], .04 * L, .006 * L, null); }
      speed = 1.6;
    } else if (A.b === 'jelly') {
      const jm = M(A.col, .2, { glow: A.col, gi: .3 }); jm.transparent = true; jm.opacity = .7; jm.side = T.DoubleSide;
      const bell = new T.Mesh(new T.SphereGeometry(.2 * L, 32, 20, 0, Math.PI * 2, 0, Math.PI / 2), jm); bell.position.y = .5 * L; bell.scale.y = .8; bell.userData.keepOpacity = .7; G.add(bell); pulse = bell;
      for (let k = 0; k < 10; k++) { const a = k / 10 * Math.PI * 2, ap = pivot(Math.cos(a) * .14 * L, .5 * L, Math.sin(a) * .14 * L); arms.push([ap, k * .5]); const c = new T.CatmullRomCurve3([[0, 0, 0], [.03, -.15, 0], [-.02, -.3, .02], [.02, -.46, 0]].map(([x, y, z]) => new T.Vector3(x * L, y * L, z * L))); const tm = new T.Mesh(new T.TubeGeometry(c, 20, .006 * L, 5), jm); tm.userData.keepOpacity = .7; ap.add(tm); }
      speed = 1.5;
    } else if (A.b === 'turtle') {
      const by = (A.sea ? .12 : .04) * L, shell = new T.Mesh(paint(ell(.3 * L, .2 * L, .24 * L, 32, .03), 0, by, 0, null, A.shell), skinMat); shell.position.y = by; shell.scale.y = .8; G.add(shell);
      const plates = shell.geometry.attributes.color, sp = shell.geometry.attributes.position; for (let i = 0; i < sp.count; i++) { const x = sp.getX(i), z = sp.getZ(i), d = Math.abs(Math.sin(x / L * 16) * Math.sin(z / L * 14)); if (d < .12 && sp.getY(i) > 0) plates.setXYZ(i, plates.getX(i) * .7, plates.getY(i) * .7, plates.getZ(i) * .7); } plates.needsUpdate = true;
      const cut = new T.Mesh(new T.CylinderGeometry(.31 * L, .31 * L, .02 * L, 32), plainM(kitLight3(A.col), .7)); cut.position.y = by; cut.scale.z = .8; G.add(cut);
      const hp = pivot(.28 * L, by + .02 * L, 0); heads.push(hp); limb3(hp, [[0, 0, 0], [.08 * L, .03 * L, 0], [.13 * L, .03 * L, 0]], .05 * L, .045 * L, null, A.col); eyes(.14 * L, .05 * L, .035 * L, .01 * L, hp);
      [[.15, 1], [.15, -1], [-.17, 1], [-.17, -1]].forEach(([u, sd], k) => { const lp = pivot(u * L, by, sd * .18 * L); legs.push([lp, k % 2 ? Math.PI : 0]); if (A.sea) { const f = part(ell(.13 * L, .015 * L, .05 * L, 14), u * .4 * L, -.02 * L, sd * .08 * L, null, A.col, lp); f.rotation.y = -sd * .5; } else limb3(lp, [[0, 0, 0], [0, -by + .02 * L, sd * .02 * L]], .05 * L, .045 * L, null, A.col); });
      speed = A.sea ? 2.5 : 2;
    } else if (A.b === 'crab') {
      part(ell(.2 * L, .08 * L, .14 * L, 24), 0, .14 * L, 0, null, A.col);
      for (let k = 0; k < 4; k++) [-1, 1].forEach((sd) => { const lp = pivot((-.1 + k * .06) * L, .12 * L, sd * .12 * L); legs.push([lp, (k + (sd > 0 ? 1 : 0)) * 1.3]); limb3(lp, [[0, 0, 0], [-.02 * L, .04 * L, sd * .12 * L], [-.03 * L, -.12 * L, sd * .2 * L]], .018 * L, .008 * L, null, A.col); });
      [-1, 1].forEach((sd) => { const ap = pivot(.15 * L, .17 * L, sd * .1 * L); arms.push([ap, sd]); limb3(ap, [[0, 0, 0], [.1 * L, .06 * L, sd * .05 * L]], .025 * L, .025 * L, null, A.col); part(ell(.07 * L, .05 * L, .04 * L, 14), .14 * L, .08 * L, sd * .05 * L, null, A.col, ap); });
      [-1, 1].forEach((sd) => { const st = new T.Mesh(new T.CylinderGeometry(.006 * L, .006 * L, .06 * L, 6), plainM(A.col)); st.position.set(.16 * L, .25 * L, sd * .04 * L); G.add(st); }); eyes(.16 * L, .28 * L, .04 * L, .012 * L);
      speed = 4;
    } else if (A.b === 'croc') {
      const lg = A.leg * L, h = (A.small ? .07 : .08) * L;
      part(ell(.2 * L, h * .7, h * 1.1, 30), 0, lg + h * .6, 0, (lg + h * .4) / L);
      const hp = pivot(.18 * L, lg + h * .6, 0); heads.push(hp); part(ell(.08 * L + A.sn * L * .5, h * .4, h * .7, 22), .06 * L + A.sn * L * .45, 0, 0, null, null, hp); eyes(.08 * L, h * .4, h * .45, h * .1, hp);
      const tp = pivot(-.18 * L, lg + h * .55, 0); tails.push(tp); limb3(tp, [[0, 0, 0], [-.18 * L, -h * .2, 0], [-.35 * L, -h * .45, 0], [-.45 * L, -h * .5, 0]], h * .65, .008 * L, null);
      [[.12, 1], [.12, -1], [-.12, 1], [-.12, -1]].forEach(([u, sd], k) => { const lp = pivot(u * L, lg + h * .3, sd * h * .7); legs.push([lp, (k === 0 || k === 3) ? 0 : Math.PI]); limb3(lp, [[0, 0, 0], [.02 * L, -lg * .5, sd * h * .5], [.04 * L, -lg - h * .25, sd * h * .6]], h * .3, h * .22, null); });
      speed = 3;
    } else if (A.b === 'snake') {
      const pts = []; for (let k = 0; k <= 30; k++) { const f = k / 30; pts.push(new T.Vector3((-.48 + f * .9) * L, .05 * L, Math.sin(f * Math.PI * 2.3) * .09 * L)); }
      const curve = new T.CatmullRomCurve3(pts), g = new T.TubeGeometry(curve, 120, .05 * L, 12, false), p = g.attributes.position, c = new T.Vector3(), v = new T.Vector3();
      for (let i = 0; i <= 120; i++) { const u = i / 120, k = Math.min(1, u * 4) * (u > .93 ? 1.1 : 1) * (1 - Math.max(0, (.08 - u)) * 6); curve.getPointAt(u, c); for (let j = 0; j < 13; j++) { const idx = i * 13 + j; v.fromBufferAttribute(p, idx).sub(c).multiplyScalar(Math.max(.15, k)).add(c); v.y = Math.max(0, v.y); p.setXYZ(idx, v.x, v.y, v.z); } }
      g.computeVertexNormals(); const cs = new Float32Array(p.count * 3); for (let i = 0; i <= 120; i++) for (let j = 0; j < 13; j++) { const idx = i * 13 + j, blot = Math.sin(i * .55) > .6 && p.getY(idx) > .05 * L, bel = p.getY(idx) < .025 * L, cc = bel ? col2 : blot ? dk : col; cs[idx * 3] = cc.r; cs[idx * 3 + 1] = cc.g; cs[idx * 3 + 2] = cc.b; }
      g.setAttribute('color', new T.BufferAttribute(cs, 3)); const sk = new T.Mesh(g, skinMat); const sw = pivot(0, 0, 0); sw.add(sk); arms.push([sw, 0]);
      const end = pts[pts.length - 1]; const hd = part(ell(.07 * L, .035 * L, .05 * L, 18), end.x + .03 * L, .045 * L, end.z, null, A.col, sw); eyes(end.x + .06 * L, .065 * L, .035 * L, .008 * L, sw);
      speed = 1.4;
    } else if (A.b === 'frog') {
      const body = part(ell(.22 * L, .16 * L, .17 * L, 30, .02), 0, .2 * L, 0, .14); body.rotation.z = .35; pulse = body;
      if (A.spots) { const cc = body.geometry.attributes.color, bp = body.geometry.attributes.position; for (let i = 0; i < bp.count; i++) if (hash(Math.floor(bp.getX(i) / (.05 * L)), Math.floor(bp.getY(i) / (.05 * L)), Math.floor(bp.getZ(i) / (.05 * L))) > .7) cc.setXYZ(i, .07, .07, .07); cc.needsUpdate = true; }
      [-1, 1].forEach((sd) => { part(new T.SphereGeometry(.05 * L, 14, 10), .15 * L, .36 * L, sd * .08 * L, null, A.col); eyes(.18 * L, .37 * L, .08 * L, .03 * L); const bl = pivot(-.12 * L, .14 * L, sd * .14 * L); legs.push([bl, 0]); limb3(bl, [[0, 0, 0], [.08 * L, -.06 * L, sd * .05 * L], [-.06 * L, -.12 * L, sd * .06 * L], [.06 * L, -.13 * L, sd * .07 * L]], .05 * L, .03 * L, null, kitDark3b(A.col, .9)); const fl = pivot(.14 * L, .14 * L, sd * .1 * L); limb3(fl, [[0, 0, 0], [.03 * L, -.08 * L, sd * .03 * L], [.06 * L, -.13 * L, sd * .04 * L]], .03 * L, .022 * L, null, A.col); });
      speed = 1.2;
    } else if (A.b === 'butterfly' || A.b === 'bee') {
      const bee = A.b === 'bee';
      const body = part(ell((bee ? .2 : .03) * L, (bee ? .09 : .03) * L, (bee ? .09 : .03) * L, 20, 0), 0, .4 * L, 0, null, bee ? null : A.dk);
      if (bee) { const cc = body.geometry.attributes.color, bp = body.geometry.attributes.position; for (let i = 0; i < bp.count; i++) if (Math.sin(bp.getX(i) / L * 50) > .3) cc.setXYZ(i, .1, .09, .08); cc.needsUpdate = true; const hd = part(new T.SphereGeometry(.07 * L, 14, 10), .22 * L, .42 * L, 0, null, A.dk); eyes(.26 * L, .44 * L, .04 * L, .015 * L); }
      else { const b2 = part(ell(.2 * L, .03 * L, .03 * L, 16, 0), 0, .4 * L, 0, null, A.dk); b2.rotation.y = Math.PI / 2; }
      [-1, 1].forEach((sd) => { const wp = pivot(0, .42 * L, 0); wings.push([wp, sd]);
        const mk2 = (pts, c, d) => { const sh = new T.Shape(); pts.forEach(([a, b], k) => (k ? sh.lineTo(a * L, b * L) : sh.moveTo(a * L, b * L))); const g = new T.ShapeGeometry(sh); g.rotateX(-Math.PI / 2); if (sd < 0) g.scale(1, 1, -1); const m = M(c, bee ? .1 : .55, bee ? {} : {}); m.side = T.DoubleSide; if (bee) { m.transparent = true; m.opacity = .45; } const e = new T.Mesh(g, m); e.position.y = d; if (bee) e.userData.keepOpacity = .45; wp.add(e); };
        if (bee) mk2([[0, 0], [-.05, .05], [-.2, .22], [-.08, .26], [.03, .1]], '#dceffa', 0);
        else { const fw = [[.02, 0], [.14, .06], [.3, .3], [.27, .42], [.08, .4], [-.02, .14]], hw = [[0, 0], [-.04, .06], [-.2, .2], [-.24, .3], [-.12, .33], [-.02, .18]]; [[fw, A.dk, -.002 * L], [hw, A.dk, -.002 * L]].forEach(([p0, c, d]) => mk2(p0.map(([a, b]) => [a * 1.06, b * 1.06]), c, d)); mk2(fw.map(([a, b]) => [a * .9, b * .9]), A.col, 0); mk2(hw.map(([a, b]) => [a * .88, b * .88]), A.col, 0); }
      });
      speed = bee ? 40 : 6;
    } else if (A.b === 'beetle' || A.b === 'ant' || A.b === 'spider') {
      const sp = A.b === 'spider', ant = A.b === 'ant';
      if (ant) [[-.2, .1, .08], [0, .06, .045], [.14, .07, .055]].forEach(([u, r, h]) => part(ell(r * L, h * L, h * L * .9, 16), u * L, .16 * L, 0, null, A.col));
      else { part(ell((sp ? .15 : .18) * L, (sp ? .12 : .1) * L, (sp ? .13 : .14) * L, 24, 0), -.06 * L, .18 * L, 0, null, A.col); part(ell(.08 * L, .07 * L, .08 * L, 16), .14 * L, .15 * L, 0, null, sp ? A.col : A.dk); }
      if (A.spots) for (let k = 0; k < 6; k++) part(new T.SphereGeometry(.025 * L, 10, 8), (-.14 + (k % 3) * .07) * L, .27 * L, (k < 3 ? -1 : 1) * .05 * L, null, A.dk);
      if (A.horn) [[.2, .2, .45, .3], [.1, .27, .42, .36]].forEach(([x0, y0, x1, y1]) => G.add(new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3([new T.Vector3(x0 * L, y0 * L, 0), new T.Vector3((x0 + x1) / 2 * L, (y0 + y1) / 2 * L + .03 * L, 0), new T.Vector3(x1 * L, y1 * L, 0)]), 12, .015 * L, 6), plainM(A.dk, .3))));
      const n = sp ? 4 : 3; for (let k = 0; k < n; k++) [-1, 1].forEach((sd) => { const lp = pivot((-.08 + k * (sp ? .06 : .09)) * L, .15 * L, sd * .08 * L); legs.push([lp, (k + (sd > 0 ? 1 : 0)) % 2 ? Math.PI : 0]); limb3(lp, [[0, 0, 0], [(k - 1) * .06 * L, (sp ? .14 : .06) * L, sd * .14 * L], [(k - 1) * .12 * L, -.15 * L, sd * .24 * L]], .012 * L, .006 * L, null, A.b === 'beetle' ? A.dk : A.col); });
      speed = 6;
    }
    // it moves: legs walk in diagonal pairs, wings flap, tails and trunks sway, heads look about, fins and arms swim
    const swing = A.b === 'quad' ? .35 : A.b === 'croc' ? .5 : .3;
    G.userData.animate = (time) => {
      const w = time * speed;
      legs.forEach(([p, ph]) => { p.rotation.z = Math.sin(w + ph) * swing; });
      wings.forEach(([p, sd]) => { const f = Math.sin(w); if (A.b === 'butterfly' || A.b === 'bee') p.rotation.x = sd * (.35 + f * .6); else if (A.b === 'bat' || s.pose === 'fly') p.rotation.x = sd * f * .7; else p.rotation.x = sd * Math.max(0, Math.sin(time * .7)) * .08; });
      tails.forEach((p) => { p.rotation.y = Math.sin(time * (A.b === 'fish' ? speed : 2.2)) * (A.b === 'fish' ? .45 : .25); p.rotation.z = Math.sin(time * 1.3) * .08; });
      heads.forEach((p) => { p.rotation.y = Math.sin(time * .6) * .18; p.rotation.z = Math.sin(time * .9) * .06; });
      fins.forEach(([p, sd]) => { p.rotation.x = sd * (.6 + Math.sin(w) * .3); });
      arms.forEach(([p, ph]) => { p.rotation.z = Math.sin(time * speed + ph) * (A.b === 'snake' ? .03 : .25); p.rotation.y = A.b === 'snake' ? Math.sin(time * speed) * .12 : 0; });
      if (bob) bob.rotation.y = Math.sin(w) * .05;
      if (pulse) { const k = 1 + Math.max(0, Math.sin(time * speed * 2)) * .06; pulse.scale.set(k, A.b === 'jelly' ? .8 / k : k, k); }
    };
    if (s.still) delete G.userData.animate;
    G.rotation.y = ({ '-x': Math.PI, z: -Math.PI / 2, '-z': Math.PI / 2, left: Math.PI })[s.facing] || 0;
  } else if (t === 'appliance') { // (v328) a home appliance in 3D, its front toward +z, standing on the floor (y 0), h its height; its working parts move
    const A = APPL[kind] || APPL.fridge, H = Math.min(12, Math.max(0.1, Math.abs(n3(s.h ?? (s.w != null ? Math.abs(n3(s.w, 1)) * A.H / A.W : null) ?? s.size, A.H * 1.2)))), k = H / A.H;
    const W = A.W * k, D = A.D * k, open = s.pose === 'open';
    const col = own || A.col;
    const MX = (hex, rough, metal, extra = {}) => { const m = M(hex, rough, { ...extra, mx: metal }); m.metalness = metal; return m; };
    const steel = MX(col, 0.32, A.col === col && col !== '#f3f3f1' && col !== '#eef1f4' ? 0.55 : 0.05, { clear: true }), black = M('#2a2c30', 0.45, { clear: true }), plastic = M('#e9ecef', 0.5), chrome = MX('#e3e7eb', 0.18, 0.85);
    const glassM = (hex = '#dfeaf2', op = 0.28) => { const m = M(hex, 0.05, { clear: true, gl: op }).clone(); m.transparent = true; m.opacity = op; m.depthWrite = false; return m; };
    const lit = (hex, gi = 0.9) => M(hex, 0.4, { glow: hex, gi });
    const RB = T.RoundedBox;
    const box = (sx, sy, sz, m, x, y, z, parent = G, r = 0.18) => { const rad = Math.min(sx, sy, sz) * r; const e = new T.Mesh(RB && rad > 0.002 ? new RB(sx, sy, sz, 2, rad) : new T.BoxGeometry(sx, sy, sz), m); e.position.set(x, y, z); parent.add(e); return e; };
    const cyl = (r0, r1, h, m, x, y, z, axis = 'y', parent = G, seg = 32, openEnd = false) => { const e = new T.Mesh(new T.CylinderGeometry(r0, r1, h, seg, 1, openEnd), m); e.position.set(x, y, z); if (axis === 'x') e.rotation.z = Math.PI / 2; if (axis === 'z') e.rotation.x = Math.PI / 2; parent.add(e); return e; };
    const sph = (r, m, x, y, z, parent = G) => { const e = new T.Mesh(new T.SphereGeometry(r, 18, 14), m); e.position.set(x, y, z); parent.add(e); return e; };
    const lathe3 = (pts, m, x, y, z, parent = G, seg = 40) => { const e = new T.Mesh(new T.LatheGeometry(pts.map(([a, b]) => new T.Vector2(a * k, b * k)), seg), m); e.position.set(x, y, z); parent.add(e); return e; };
    const tube3 = (pts, r, m, parent = G) => { const e = new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(pts.map(([a, b, c]) => new T.Vector3(a * k, b * k, c * k))), 48, r * k, 12), m); parent.add(e); return e; };
    const piv = (x, y, z, parent = G) => { const p = new T.Group(); p.position.set(x, y, z); parent.add(p); return p; };
    const feet = (pts, h = 0.025, r = 0.016) => pts.forEach(([a, c]) => cyl(r * k, r * 1.2 * k, h * k, black, a * k, h * k / 2, c * k));
    const hollow = (u0, v0, u1, v1, dz, th, outer, inner, parent = G) => { // a cabinet open at the front: back, sides, top and bottom, lined inside
      const w = (u1 - u0) * k, h = (v1 - v0) * k, d = dz * k, t2 = th * k, cx = (u0 + u1) / 2 * k, cy = (v0 + v1) / 2 * k, bz = D / 2 - d;
      box(w, h, t2, outer, cx, cy, bz + t2 / 2, parent, 0.05); box(t2, h, d, outer, u0 * k + t2 / 2, cy, bz + d / 2, parent, 0.05); box(t2, h, d, outer, u1 * k - t2 / 2, cy, bz + d / 2, parent, 0.05);
      box(w, t2, d, outer, cx, v1 * k - t2 / 2, bz + d / 2, parent, 0.05); box(w, t2, d, outer, cx, v0 * k + t2 / 2, bz + d / 2, parent, 0.05);
      if (inner) { const li = new T.Mesh(new T.BoxGeometry(w - t2 * 2.2, h - t2 * 2.2, d - t2), inner); li.material.side = T.BackSide; li.position.set(cx, cy, bz + t2 + (d - t2) / 2 + 0.001); parent.add(li); }
    };
    const anim = []; // what moves: called with the time in seconds
    const plate = (w, h, th, hole, m, x, y, z, parent = G) => { // a flat panel with an opening cut through it (a round door hole, a window)
      const sh = new T.Shape(), r0 = Math.min(w, h) * 0.04; sh.moveTo(-w / 2 + r0, -h / 2); sh.lineTo(w / 2 - r0, -h / 2); sh.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r0); sh.lineTo(w / 2, h / 2 - r0); sh.quadraticCurveTo(w / 2, h / 2, w / 2 - r0, h / 2); sh.lineTo(-w / 2 + r0, h / 2); sh.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r0); sh.lineTo(-w / 2, -h / 2 + r0); sh.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r0, -h / 2);
      const hp = new T.Path(); if (hole[0] === 'c') hp.absarc(hole[1], hole[2], hole[3], 0, Math.PI * 2, true); else { const [, x0, y0, x1, y1] = hole; hp.moveTo(x0, y0); hp.lineTo(x0, y1); hp.lineTo(x1, y1); hp.lineTo(x1, y0); hp.lineTo(x0, y0); } sh.holes.push(hp);
      const g = new T.ExtrudeGeometry(sh, { depth: th, bevelEnabled: true, bevelSize: th * 0.3, bevelThickness: th * 0.3, bevelSegments: 2, curveSegments: 48 }); g.translate(0, 0, -th / 2);
      const e = new T.Mesh(g, m); e.position.set(x, y, z); parent.add(e); return e; };
    const fz = D / 2; // the front face

    if (kind === 'fridge') {
      feet([[-0.38, 0.3], [0.38, 0.3], [-0.38, -0.3], [0.38, -0.3]]);
      const liner = M('#f4f6f8', 0.6);
      hollow(-0.45, 0.62, 0.45, 1.78, 0.72, 0.035, steel, liner); box(W, 0.59 * k, D - 0.02 * k, steel, 0, 0.325 * k, -0.01 * k, G, 0.04);
      [0.98, 1.22, 1.46].forEach((v) => { const sh = box(0.8 * k, 0.012 * k, 0.6 * k, glassM('#cfe6f3', 0.5), 0, v * k, -0.02 * k, G, 0.1); sh.userData.keepOpacity = 0.5; });
      [-0.2, 0.2].forEach((u) => { const c = box(0.37 * k, 0.2 * k, 0.55 * k, glassM('#eaf3f8', 0.55), u * k, 0.76 * k, -0.04 * k, G, 0.08); c.userData.keepOpacity = 0.55; });
      const light = box(0.16 * k, 0.025 * k, 0.06 * k, lit('#fff6c8', 1.2), 0, 1.74 * k, -0.1 * k);
      box(W - 0.01 * k, 0.58 * k, 0.04 * k, steel, 0, 0.325 * k, fz + 0.01 * k, G, 0.08); cyl(0.012 * k, 0.012 * k, 0.6 * k, chrome, 0, 0.5 * k, fz + 0.065 * k, 'x');
      [-1, 1].forEach((sd) => { // each French door turns on its hinge at the outside edge; opened, it swings wide
        const p = piv(sd * W / 2, 0, fz + 0.012 * k), w2 = W / 2 - 0.006 * k;
        box(w2, 1.15 * k, 0.045 * k, steel, -sd * w2 / 2, 1.2 * k, 0.022 * k, p, 0.06);
        const hx = -sd * (w2 - 0.045 * k); cyl(0.012 * k, 0.012 * k, 0.76 * k, chrome, hx, 1.17 * k, 0.085 * k, 'y', p); [0.8, 1.54].forEach((v) => cyl(0.008 * k, 0.008 * k, 0.04 * k, chrome, hx, v * k, 0.063 * k, 'z', p));
        [0.85, 1.15, 1.45].forEach((v) => { const b = box(w2 * 0.8, 0.08 * k, 0.07 * k, glassM('#e8f2f8', 0.6), -sd * w2 / 2, v * k, -0.04 * k, p, 0.1); b.userData.keepOpacity = 0.6; });
        if (sd < 0) { box(0.24 * k, 0.4 * k, 0.02 * k, M('#33383f', 0.4), -sd * 0.205 * k, 1.22 * k, 0.05 * k, p, 0.1); box(0.16 * k, 0.05 * k, 0.01 * k, lit('#64d0f5', 0.6), -sd * 0.205 * k, 1.37 * k, 0.062 * k, p); }
        if (open) p.rotation.y = sd * 1.9;
      });
      if (open) anim.push((tm) => { light.material.emissiveIntensity = 1 + Math.sin(tm * 2) * 0.15; });
    } else if (kind === 'washer') {
      feet([[-0.25, 0.25], [0.25, 0.25], [-0.25, -0.25], [0.25, -0.25]]);
      hollow(-0.3, 0.025, 0.3, 0.85, 0.58, 0.02, steel, M('#3b4048', 0.6)); const body = plate(W, 0.825 * k, 0.02 * k, ['c', 0, -0.0375 * k, 0.18 * k], steel, 0, 0.4375 * k, fz - 0.01 * k);
      box(0.18 * k, 0.065 * k, 0.02 * k, MX('#d6dadf', 0.3, 0.4), -0.185 * k, 0.778 * k, fz + 0.006 * k, G, 0.15); cyl(0.032 * k, 0.032 * k, 0.025 * k, chrome, -0.035 * k, 0.778 * k, fz + 0.012 * k, 'z');
      box(0.21 * k, 0.055 * k, 0.012 * k, M('#14181e', 0.3), 0.145 * k, 0.778 * k, fz + 0.004 * k, G, 0.1); box(0.1 * k, 0.026 * k, 0.004 * k, lit('#ff9a3c', 0.8), 0.11 * k, 0.778 * k, fz + 0.011 * k);
      box(0.1 * k, 0.08 * k, 0.012 * k, steel, 0.22 * k, 0.09 * k, fz + 0.004 * k, G, 0.1);
      const dr = piv(0, 0.4 * k, fz - 0.33 * k); // the drum: a steel tub with holes and three paddles, turning on its axle
      const tub = new T.Mesh(new T.CylinderGeometry(0.17 * k, 0.17 * k, 0.3 * k, 40, 1, true), MX('#a3aab2', 0.3, 0.7)); tub.material = tub.material.clone(); tub.material.side = T.DoubleSide; tub.rotation.x = Math.PI / 2; tub.position.z = 0.15 * k; dr.add(tub);
      cyl(0.17 * k, 0.17 * k, 0.01 * k, MX('#8d949c', 0.35, 0.6), 0, 0, 0, 'z', dr);
      for (let i = 0; i < 3; i++) { const pd = box(0.05 * k, 0.03 * k, 0.28 * k, MX('#c3c8ce', 0.3, 0.6), 0, 0, 0.15 * k, dr, 0.3); const a = i * 2.094; pd.position.x = Math.cos(a) * 0.15 * k; pd.position.y = Math.sin(a) * 0.15 * k; pd.rotation.z = a + Math.PI / 2; }
      [['#5b8fd6', -0.07, -0.08], ['#e85d75', 0.06, -0.09], ['#f4c542', 0.0, -0.11]].forEach(([c, a, b]) => { const cl = sph(0.055 * k, M(c, 0.9), a * k, b * k, 0.14 * k, dr); cl.scale.set(1.3, 0.7, 1); });
      const dp = piv(-0.215 * k, 0.4 * k, fz + 0.015 * k); // the round door, hinged at the left
      const ring = new T.Mesh(new T.TorusGeometry(0.19 * k, 0.025 * k, 16, 48), chrome); ring.position.x = 0.215 * k; dp.add(ring);
      const gl = cyl(0.17 * k, 0.15 * k, 0.03 * k, glassM('#8fb0c8', 0.35), 0.215 * k, 0, -0.01 * k, 'z', dp); gl.userData.keepOpacity = 0.35;
      box(0.025 * k, 0.07 * k, 0.025 * k, chrome, 0.41 * k, 0, 0.01 * k, dp);
      if (open) dp.rotation.y = -1.6;
      anim.push((tm) => { dr.rotation.z = tm * 2.6; });
      void body;
    } else if (kind === 'microwave') {
      feet([[-0.2, 0.15], [0.2, 0.15], [-0.2, -0.15], [0.2, -0.15]], 0.012, 0.014);
      const warm = M('#e9cf9f', 0.6, { glow: '#ffcf80', gi: 0.35 });
      hollow(-0.25, 0.012, 0.11, 0.3, 0.38, 0.018, steel, warm); box(0.14 * k, 0.288 * k, D, steel, 0.18 * k, 0.156 * k, 0, G, 0.05);
      box(0.075 * k, 0.035 * k, 0.006 * k, M('#11161c', 0.3), 0.18 * k, 0.255 * k, fz + 0.002 * k); box(0.055 * k, 0.018 * k, 0.003 * k, lit('#7cf08c', 0.7), 0.18 * k, 0.255 * k, fz + 0.006 * k);
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) box(0.018 * k, 0.014 * k, 0.008 * k, plastic, (0.155 + i * 0.025) * k, (0.155 + j * 0.024) * k, fz + 0.003 * k, G, 0.3);
      cyl(0.03 * k, 0.03 * k, 0.025 * k, chrome, 0.18 * k, 0.08 * k, fz + 0.012 * k, 'z');
      const tt = piv(-0.07 * k, 0.04 * k, 0); // the glass turntable, a bowl of soup on it, turning
      const pl = cyl(0.13 * k, 0.13 * k, 0.006 * k, glassM('#f2f6f8', 0.6), 0, 0, 0, 'y', tt); pl.userData.keepOpacity = 0.6;
      lathe3([[0, 0], [0.04, 0], [0.055, 0.02], [0.062, 0.05], [0.058, 0.05], [0.05, 0.022], [0, 0.006]], M('#e85d4a', 0.4, { clear: true }), 0.03 * k, 0.003 * k, 0, tt);
      cyl(0.056 * k, 0.056 * k, 0.004 * k, M('#f6a64a', 0.6), 0.03 * k, 0.045 * k, 0, 'y', tt);
      const lamp = sph(0.012 * k, lit('#fff2c0', 1.4), 0.09 * k, 0.27 * k, 0.05 * k);
      const dp = piv(-0.25 * k, 0.156 * k, fz + 0.01 * k); // the door, hinged at the left, its window see-through
      const dw = 0.36 * k; plate(dw, 0.288 * k, 0.02 * k, ['r', -0.15 * k, -0.11 * k, 0.13 * k, 0.11 * k], steel, dw / 2, 0, 0, dp);
      const win = box(0.27 * k, 0.22 * k, 0.024 * k, glassM('#2a3440', 0.55), dw / 2 - 0.02 * k, 0, 0.002 * k, dp, 0.05); win.userData.keepOpacity = 0.55;
      cyl(0.008 * k, 0.008 * k, 0.2 * k, chrome, dw - 0.015 * k, 0, 0.025 * k, 'y', dp);
      if (open) dp.rotation.y = -1.7;
      anim.push((tm) => { tt.rotation.y = tm * 0.9; lamp.material.emissiveIntensity = 1.2 + Math.sin(tm * 9) * 0.15; });
    } else if (kind === 'blender') {
      box(0.175 * k, 0.012 * k, 0.175 * k, black, 0, 0.006 * k, 0, G, 0.2);
      const base = new T.Mesh(new T.CylinderGeometry(0.068 * k, 0.088 * k, 0.12 * k, 4, 1), steel); base.rotation.y = Math.PI / 4; base.position.y = 0.072 * k; G.add(base);
      cyl(0.024 * k, 0.024 * k, 0.02 * k, chrome, 0, 0.075 * k, 0.07 * k, 'z'); [-0.04, -0.02, 0, 0.02, 0.04].forEach((u) => sph(0.006 * k, plastic, u * k, 0.03 * k, 0.083 * k));
      cyl(0.058 * k, 0.062 * k, 0.026 * k, chrome, 0, 0.145 * k, 0);
      const juice = lathe3([[0, 0.162], [0.047, 0.162], [0.066, 0.3], [0, 0.3]], M('#f0b84a', 0.5, { clear: true }), 0, 0, 0);
      const jar = lathe3([[0.05, 0.158], [0.077, 0.39], [0.074, 0.39], [0.047, 0.162]], glassM('#e3eef5', 0.3), 0, 0, 0); jar.userData.keepOpacity = 0.3; jar.material.side = T.DoubleSide;
      const hnd = tube3([[0.07, 0.36, 0], [0.115, 0.35, 0], [0.118, 0.22, 0], [0.065, 0.2, 0]], 0.009, glassM('#e3eef5', 0.55)); hnd.userData.keepOpacity = 0.55;
      cyl(0.082 * k, 0.08 * k, 0.025 * k, black, 0, 0.402 * k, 0); cyl(0.025 * k, 0.025 * k, 0.02 * k, glassM('#cfd8de', 0.7), 0, 0.42 * k, 0);
      const bl = piv(0, 0.172 * k, 0); [0, Math.PI / 2].forEach((a, i) => { const b = box(0.075 * k, 0.003 * k, 0.012 * k, chrome, 0, i * 0.006 * k, 0, bl, 0.1); b.rotation.y = a; b.rotation.z = i ? 0.3 : -0.3; });
      anim.push((tm) => { bl.rotation.y = tm * 40; juice.rotation.y = tm * 4; });
    } else if (kind === 'toaster') {
      box(W + 0.01 * k, 0.03 * k, D + 0.01 * k, black, 0, 0.015 * k, 0, G, 0.25);
      box(W, 0.17 * k, D, steel, 0, 0.115 * k, 0, G, 0.28);
      const hot = M('#ff6a2a', 0.5, { glow: '#ff5a1a', gi: 1 });
      [-0.035, 0.035].forEach((zz) => { box(0.24 * k, 0.004 * k, 0.03 * k, M('#1d1f23', 0.6), 0, 0.2 * k, zz * k, G, 0.2); box(0.22 * k, 0.003 * k, 0.034 * k, hot, 0, 0.198 * k, zz * k); box(0.2 * k, 0.07 * k, 0.018 * k, M('#e3b471', 0.85), 0, 0.2 * k, zz * k, G, 0.25); });
      box(0.035 * k, 0.022 * k, 0.03 * k, black, W / 2 + 0.014 * k, 0.13 * k, 0, G, 0.25); cyl(0.013 * k, 0.013 * k, 0.012 * k, chrome, W / 2 + 0.004 * k, 0.06 * k, 0.03 * k, 'x');
      anim.push((tm) => { hot.emissiveIntensity = 0.7 + Math.sin(tm * 2.2) * 0.3; });
    } else if (kind === 'coffeemaker') {
      box(W, 0.03 * k, D, steel, 0, 0.015 * k, 0, G, 0.2); cyl(0.07 * k, 0.07 * k, 0.006 * k, black, -0.01 * k, 0.032 * k, 0.04 * k);
      box(W, 0.2 * k, 0.07 * k, black, 0, 0.13 * k, -D / 2 + 0.035 * k, G, 0.1);
      box(W, 0.125 * k, D, steel, 0, 0.275 * k, 0, G, 0.12); box(W + 0.004 * k, 0.025 * k, D + 0.004 * k, black, 0, 0.348 * k, 0, G, 0.3);
      box(0.004 * k, 0.15 * k, 0.025 * k, glassM('#a9d6f2', 0.7), W / 2 + 0.001 * k, 0.24 * k, -0.06 * k);
      const carafe = piv(-0.01 * k, 0.036 * k, 0.04 * k);
      const cof = lathe3([[0, 0], [0.065, 0], [0.078, 0.04], [0.074, 0.06], [0, 0.06]], M('#4a2a18', 0.3, { clear: true }), 0, 0.004 * k, 0, carafe);
      const jug = lathe3([[0.065, 0], [0.082, 0.05], [0.075, 0.11], [0.055, 0.145], [0.053, 0.145], [0.073, 0.11], [0.08, 0.05], [0.063, 0.003]], glassM('#e3edf3', 0.3), 0, 0, 0, carafe); jug.userData.keepOpacity = 0.3; jug.material.side = T.DoubleSide;
      tube3([[0.07, 0.125 + 0.036, 0.04], [0.115, 0.12 + 0.036, 0.04], [0.118, 0.04 + 0.036, 0.04], [0.08, 0.03 + 0.036, 0.04]], 0.009, black).position.x = -0.01 * k;
      cyl(0.058 * k, 0.058 * k, 0.012 * k, black, 0, 0.15 * k, 0, 'y', carafe);
      const drips = [0, 1, 2].map(() => sph(0.005 * k, M('#5b3521', 0.2, { clear: true }), -0.01 * k, 0.2 * k, 0.04 * k));
      anim.push((tm) => { drips.forEach((d, i) => { const f = (tm * 1.3 + i / 3) % 1; d.position.y = (0.205 - f * 0.11) * k; }); cof.scale.y = 0.9 + ((tm * 0.05) % 0.2); });
    } else if (kind === 'vacuum') {
      box(0.3 * k, 0.05 * k, 0.24 * k, M('#33363b', 0.6), 0, 0.035 * k, 0.04 * k, G, 0.25); box(0.26 * k, 0.03 * k, 0.16 * k, steel, 0, 0.07 * k, 0.03 * k, G, 0.3);
      [-1, 1].forEach((sd) => cyl(0.045 * k, 0.045 * k, 0.03 * k, black, sd * 0.16 * k, 0.045 * k, -0.08 * k, 'x'));
      const roll = cyl(0.02 * k, 0.02 * k, 0.26 * k, M('#e0b23c', 0.8), 0, 0.022 * k, 0.12 * k, 'x');
      const up = piv(0, 0.07 * k, -0.06 * k); up.rotation.x = -0.12;
      cyl(0.08 * k, 0.085 * k, 0.06 * k, steel, 0, 0.04 * k, 0, 'y', up);
      const bin = cyl(0.07 * k, 0.07 * k, 0.28 * k, glassM('#dfe9f0', 0.35), 0, 0.21 * k, 0, 'y', up); bin.userData.keepOpacity = 0.35;
      cyl(0.065 * k, 0.065 * k, 0.06 * k, M('#8b8579', 0.95), 0, 0.105 * k, 0, 'y', up);
      const cone = cyl(0.03 * k, 0.012 * k, 0.18 * k, glassM('#c9d3da', 0.6), 0, 0.24 * k, 0, 'y', up); cone.userData.keepOpacity = 0.6;
      const swirl = piv(0, 0.2 * k, 0, up); for (let i = 0; i < 10; i++) { const a = i * 0.63, r = (0.025 + (i % 3) * 0.012) * k; sph(0.006 * k, M('#8b8579', 0.9), Math.cos(a) * r, (i % 4) * 0.02 * k, Math.sin(a) * r, swirl); }
      cyl(0.075 * k, 0.075 * k, 0.07 * k, steel, 0, 0.385 * k, 0, 'y', up);
      cyl(0.013 * k, 0.013 * k, 0.52 * k, steel, 0, 0.68 * k, 0, 'y', up);
      const grip = new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3([[0, 0.87], [-0.05, 0.93], [-0.03, 0.99], [0.03, 0.99], [0.05, 0.93], [0.012, 0.87]].map(([a, b]) => new T.Vector3(a * k, b * k, 0))), 40, 0.014 * k, 10), black); up.add(grip);
      const hose = new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3([[0.06, 0.04, 0.02], [0.11, 0.12, -0.02], [0.115, 0.42, -0.04], [0.08, 0.56, -0.03], [0.015, 0.58, 0]].map(([a, b, c]) => new T.Vector3(a * k, b * k, c * k))), 48, 0.014 * k, 10), black); up.add(hose);
      anim.push((tm) => { roll.rotation.x = tm * 30; swirl.rotation.y = tm * 9; });
    } else if (kind === 'aircon') {
      [[-0.17, 0.13], [0.17, 0.13], [-0.17, -0.13], [0.17, -0.13]].forEach(([a, c]) => sph(0.022 * k, black, a * k, 0.022 * k, c * k));
      box(W, 0.715 * k, D, steel, 0, 0.395 * k, 0, G, 0.12);
      box(0.32 * k, 0.19 * k, 0.03 * k, M('#454b53', 0.5), 0, 0.6 * k, fz - 0.005 * k, G, 0.1);
      const louvers = [0, 1, 2, 3].map((i) => { const p = piv(0, (0.53 + i * 0.043) * k, fz + 0.012 * k); box(0.3 * k, 0.026 * k, 0.006 * k, plastic, 0, 0, 0, p, 0.2); return p; });
      box(0.1 * k, 0.012 * k, 0.004 * k, M('#9aa1a9', 0.4), 0, 0.43 * k, fz + 0.002 * k);
      const hz = -D / 2; for (let i = 0; i < 9; i++) { const rg = new T.Mesh(new T.TorusGeometry(0.06 * k, 0.008 * k, 8, 24), plastic); rg.position.set(0, 0.42 * k, hz - i * 0.022 * k); G.add(rg); }
      cyl(0.06 * k, 0.06 * k, 0.2 * k, plastic, 0, 0.42 * k, hz - 0.09 * k, 'z');
      const cool = glassM('#9fd6f7', 0.5), puffs = [0, 1, 2, 3, 4, 5].map((i) => sph(0.025 * k, cool, ((i % 3) - 1) * 0.1 * k, 0.6 * k, fz));
      anim.push((tm) => { louvers.forEach((p, i) => { p.rotation.x = Math.sin(tm * 1.2 + i * 0.2) * 0.35 - 0.2; }); puffs.forEach((p, i) => { const f = (tm * 0.5 + i / 6) % 1; p.position.z = fz + f * 0.35 * k; p.position.y = (0.6 + f * 0.12) * k; p.scale.setScalar(0.6 + f * 1.4); p.material.opacity = 0.5 * (1 - f); }); });
      puffs.forEach((p) => { p.material = cool.clone(); p.userData.keepOpacity = 0.5; });
    } else if (kind === 'fan') {
      cyl(0.19 * k, 0.21 * k, 0.03 * k, steel, 0, 0.015 * k, 0); cyl(0.06 * k, 0.16 * k, 0.05 * k, steel, 0, 0.05 * k, 0);
      cyl(0.015 * k, 0.015 * k, 0.75 * k, chrome, 0, 0.45 * k, 0);
      const head = piv(0, 0.9 * k, 0); // the head turns from side to side; the blades spin
      const mot = sph(0.07 * k, steel, 0, 0.05 * k, -0.07 * k, head); mot.scale.set(1, 1, 1.3); cyl(0.02 * k, 0.02 * k, 0.06 * k, chrome, 0, 0.05 * k, -0.01 * k, 'z', head);
      const gz = 0.03 * k, gy = 0.05 * k, wire = MX('#c9ced4', 0.3, 0.6);
      [0.225, 0.16, 0.09].forEach((r) => { const t3 = new T.Mesh(new T.TorusGeometry(r * k, (r > 0.2 ? 0.006 : 0.003) * k, 8, 64), wire); t3.position.set(0, gy, gz + 0.02 * k); head.add(t3); const t4 = t3.clone(); t4.position.z = gz - 0.03 * k; head.add(t4); });
      for (let i = 0; i < 20; i++) { const a = i * Math.PI / 10; const sp = new T.Mesh(new T.CylinderGeometry(0.002 * k, 0.002 * k, 0.17 * k, 4), wire); sp.position.set(Math.cos(a) * 0.14 * k, gy + Math.sin(a) * 0.14 * k, gz + 0.02 * k); sp.rotation.z = a - Math.PI / 2; head.add(sp); }
      const blades = piv(0, gy, gz - 0.005 * k, head);
      for (let i = 0; i < 3; i++) { const b = sph(0.1 * k, M('#7fb7e6', 0.3, { clear: true }), 0, 0, 0, blades); b.scale.set(0.85, 0.45, 0.06); b.position.set(Math.cos(i * 2.094) * 0.11 * k, Math.sin(i * 2.094) * 0.11 * k, 0); b.rotation.set(0.35, 0, i * 2.094); }
      cyl(0.035 * k, 0.03 * k, 0.03 * k, steel, 0, 0, 0.012 * k, 'z', blades);
      anim.push((tm) => { blades.rotation.z = -tm * 22; head.rotation.y = Math.sin(tm * 0.4) * 0.6; });
    } else if (kind === 'ricecooker') {
      feet([[-0.1, 0.1], [0.1, 0.1], [-0.1, -0.1], [0.1, -0.1]], 0.012, 0.012);
      lathe3([[0, 0.01], [0.13, 0.01], [0.15, 0.04], [0.152, 0.15], [0.14, 0.2], [0, 0.2]], M(col, 0.35, { clear: true }), 0, 0, 0, G, 48);
      cyl(0.135 * k, 0.135 * k, 0.012 * k, MX('#b9bfc6', 0.3, 0.6), 0, 0.2 * k, 0);
      box(0.1 * k, 0.07 * k, 0.03 * k, M('#e6e5df', 0.5), 0, 0.105 * k, 0.142 * k, G, 0.3); box(0.024 * k, 0.035 * k, 0.02 * k, M('#5b6068', 0.4), 0, 0.105 * k, 0.16 * k, G, 0.3);
      const red = sph(0.008 * k, lit('#ff5a3c', 1), -0.03 * k, 0.155 * k, 0.142 * k); sph(0.008 * k, lit('#f6b23c', 0.3), 0.03 * k, 0.155 * k, 0.142 * k);
      [-1, 1].forEach((sd) => box(0.03 * k, 0.03 * k, 0.05 * k, M('#5b6068', 0.4), sd * 0.16 * k, 0.16 * k, 0, G, 0.3));
      cyl(0.12 * k, 0.12 * k, 0.01 * k, M('#fbfaf3', 0.9), 0, 0.195 * k, 0); // (the cooked rice, seen when it is open)
      const lid = piv(0, 0.205 * k, -0.14 * k);
      lathe3([[0, 0.065], [0.06, 0.06], [0.12, 0.03], [0.145, 0.0], [0, 0.0]], M(kitLight3(col), 0.3, { clear: true }), 0, 0, 0.14 * k, lid, 48);
      box(0.12 * k, 0.018 * k, 0.03 * k, M('#5b6068', 0.4), 0, 0.075 * k, 0.14 * k, lid, 0.4); cyl(0.012 * k, 0.012 * k, 0.015 * k, M('#9aa1a9', 0.4), 0.05 * k, 0.065 * k, 0.12 * k, 'y', lid);
      if (open) lid.rotation.x = -1.7;
      const st = glassM('#ffffff', 0.6), puffs = [0, 1, 2, 3].map((i) => { const p = sph(0.025 * k, st.clone(), 0, 0.28 * k, 0); p.userData.keepOpacity = 0.6; return p; });
      const vx = open ? 0 : 0.05 * k, vz = open ? 0 : -0.02 * k, vy = open ? 0.22 : 0.29;
      anim.push((tm) => { red.material.emissiveIntensity = 0.6 + Math.sin(tm * 3) * 0.4; puffs.forEach((p, i) => { const f = (tm * 0.35 + i / 4) % 1; p.position.set(vx + Math.sin(f * 6 + i) * 0.02 * k, (vy + f * 0.2) * k, vz); p.scale.setScalar(0.5 + f * 1.5); p.material.opacity = 0.6 * (1 - f); }); });
    }
    if (anim.length && !s.still) G.userData.animate = (time) => anim.forEach((f) => f(time));
    G.rotation.y = ({ x: Math.PI / 2, '-x': -Math.PI / 2, '-z': Math.PI, left: -Math.PI / 2, right: Math.PI / 2 })[s.facing] || 0;
  } else if (t === 'food') { // (v329) a fruit, a vegetable or a dish in 3D, standing on the table (y 0), w its width; "cut" or "both" shows it sliced open
    const A = FOOD[kind] || FOOD.apple, L = Math.min(8, Math.max(0.05, Math.abs(n3(s.w ?? s.size, 1))));
    const both = s.view === 'both' && !!A.cut, cutOnly = s.view === 'cut' && !!A.cut;
    const gloss = (hex, rough = 0.38) => M(hex, rough, { clear: true });
    const mesh = (geo, m, x = 0, y = 0, z = 0, parent = G) => { const e = new T.Mesh(geo, m); e.position.set(x, y, z); parent.add(e); return e; };
    const glassy = (hex, op) => { const m = M(hex, 0.05, { clear: true, gl: op }).clone(); m.transparent = true; m.opacity = op; m.depthWrite = false; return m; };
    const anim = [];
    // the profile of a round fruit (its right half, bottom to top), the same shapes as the flat drawings
    const prof = (sh, rx, ry) => { const out = []; for (let i = 0; i <= 40; i++) { const tt = -Math.PI / 2 + Math.PI * i / 40, st = Math.sin(tt), ct = Math.cos(tt); let px = ct * rx, py = st * ry;
      if (sh === 'apple') { px *= 1 + 0.07 * st; py -= 0.09 * ry * Math.exp(-(((tt - Math.PI / 2) / 0.32) ** 2)); py += 0.05 * ry * Math.exp(-(((tt + Math.PI / 2) / 0.4) ** 2)); if (i === 40) px = 0.02 * rx; }
      if (sh === 'pear') px *= 1 - 0.5 * Math.max(0, st) ** 1.2;
      if (sh === 'heart') { px *= 1 - 0.62 * Math.max(0, -st) ** 1.4; py *= st < 0 ? 1.08 : 0.92; }
      if (sh === 'onion') { if (st > 0) { const q = st ** 3; px *= 1 - 0.75 * q; py *= 1 + 0.32 * q; } }
      out.push([Math.max(0.0005, px), ry + py]); } return out; };
    const lathe2 = (pts, m, parent, phiLen = Math.PI * 2, seg = 48) => { const g = new T.LatheGeometry(pts.map(([r, y]) => new T.Vector2(r, y)), seg, 0, phiLen); g.computeVertexNormals(); const e = new T.Mesh(g, m); parent.add(e); return e; };
    const ribs = (e, n, k) => { const p = e.geometry.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i), a = Math.atan2(z, x), f = 1 + k * Math.cos(a * n); p.setX(i, x * f); p.setZ(i, z * f); } e.geometry.computeVertexNormals(); };
    const bumpy = (e, amp, freq = 9) => { const p = e.geometry.attributes.position, v = new T.Vector3(); for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); const n = 1 + amp * noise(v.x * freq / L, v.y * freq / L, v.z * freq / L); p.setXYZ(i, v.x * n, v.y, v.z * n); } e.geometry.computeVertexNormals(); };
    const paintV = (e, fn) => { const p = e.geometry.attributes.position, cs = new Float32Array(p.count * 3), c = new T.Color(); for (let i = 0; i < p.count; i++) { fn(p.getX(i) / L, p.getY(i) / L, p.getZ(i) / L, c); cs[i * 3] = c.r; cs[i * 3 + 1] = c.g; cs[i * 3 + 2] = c.b; } e.geometry.setAttribute('color', new T.BufferAttribute(cs, 3)); const m = e.material.clone(); m.vertexColors = true; m.color = new T.Color('#ffffff'); e.material = m; };
    const leaf3 = (parent, x, y, z, len, ang, tilt, hex = '#4f8a30', wide = 0.4) => { const e = new T.Mesh(leafGeo(len, len * wide), M(hex, 0.6, { clear: true })); e.material = e.material.clone(); e.material.side = T.DoubleSide; e.position.set(x, y, z); e.rotation.set(tilt, ang, 0, 'YXZ'); parent.add(e); return e; }; // (the blade grows along -z: a positive tilt lifts its tip)
    const stem3 = (parent, x, y, z, len, r, hex = '#6b4a2a', bend = 0.3) => { const c = new T.CatmullRomCurve3([new T.Vector3(x, y, z), new T.Vector3(x + len * bend * 0.3, y + len * 0.6, z), new T.Vector3(x + len * bend, y + len, z)]); return mesh(new T.TubeGeometry(c, 12, r, 8), M(hex, 0.7), 0, 0, 0, parent); };
    const sepals3 = (parent, x, y, z, len, hex = '#3f8a2e') => { for (let i = 0; i < 6; i++) leaf3(parent, x, y, z, len, i * Math.PI / 3, -0.3, hex, 0.35); };
    const steamPuffs = (x, y, z, rise) => { const st = glassy('#ffffff', 0.55); const puffs = [0, 1, 2, 3].map(() => { const p = mesh(new T.SphereGeometry(0.06 * L, 12, 10), st.clone(), x, y, z); p.userData.keepOpacity = 0.55; return p; }); anim.push((tm) => puffs.forEach((p, i) => { const f = (tm * 0.35 + i / 4) % 1; p.position.set(x + Math.sin(f * 6 + i) * 0.04 * L, y + f * rise, z); p.scale.setScalar(0.5 + f * 1.6); p.material.opacity = 0.55 * (1 - f); })); };
    // the cut face: a flat picture of what is inside, painted the way it really looks
    const cutTex = () => {
      if (typeof document === 'undefined') return null; const S = 256, cv = document.createElement('canvas'); cv.width = cv.height = S; const x = cv.getContext('2d'), c = S / 2, rnd = krand(kind.length * 97);
      const dot = (u, v, r, col) => { x.fillStyle = col; x.beginPath(); x.arc(u, v, r, 0, Math.PI * 2); x.fill(); };
      const ell = (u, v, rx, ry, rot, col) => { x.fillStyle = col; x.beginPath(); x.ellipse(u, v, rx, ry, rot, 0, Math.PI * 2); x.fill(); };
      const fl = A.flesh || '#f4e4a2';
      if (A.b !== 'long') { x.translate(c, c); x.rotate(Math.PI / 2); x.translate(-c, -c); } // (the fruit's height runs along the face's length)
      x.fillStyle = A.cut === 'hollow' ? '#6e4a2b' : A.cut === 'melon' ? '#3d8a36' : A.col; x.fillRect(0, 0, S, S);
      const inner = A.cut === 'hollow' ? 0.88 : A.cut === 'melon' ? 0.9 : 0.96;
      ell(c, c, c * inner, c * inner, 0, A.cut === 'segments' || A.cut === 'melon' ? '#f6f3e2' : fl);
      if (A.cut === 'melon') ell(c, c, c * 0.84, c * 0.84, 0, fl);
      const rg = x.createRadialGradient(c * 0.8, c * 0.8, 0, c, c, c); rg.addColorStop(0, 'rgba(255,255,255,0.25)'); rg.addColorStop(1, 'rgba(0,0,0,0.06)');
      if (A.cut === 'segments') { for (let i = 0; i < 10; i++) { const a0 = i * 0.628 + 0.05, a1 = (i + 1) * 0.628 - 0.05; x.fillStyle = fl; x.beginPath(); x.moveTo(c + Math.cos(a0) * c * 0.08, c + Math.sin(a0) * c * 0.08); x.arc(c, c, c * 0.86, a0, a1); x.closePath(); x.fill(); } dot(c, c, c * 0.07, '#f6f3e2'); }
      if (A.cut === 'core') { x.fillStyle = kitLight(fl, 0.25); x.strokeStyle = kitDark(fl, 0.3); x.lineWidth = 4; x.beginPath(); x.ellipse(c, c, c * 0.24, c * 0.44, 0, 0, Math.PI * 2); x.fill(); x.stroke(); x.beginPath(); x.moveTo(c, c - c * 0.44); x.lineTo(c, c - c * 0.92); x.moveTo(c, c + c * 0.44); x.lineTo(c, c + c * 0.92); x.stroke(); ell(c - c * 0.08, c, c * 0.07, c * 0.13, -0.2, '#4a2a18'); ell(c + c * 0.08, c, c * 0.07, c * 0.13, 0.2, '#4a2a18'); }
      if (A.cut === 'pit') { const big = kind === 'mango' ? 0.6 : kind === 'avocado' ? 0.42 : 0.36; if (A.rim) { x.strokeStyle = A.rim; x.lineWidth = c * 0.08; x.beginPath(); x.arc(c, c, c * 0.88, 0, Math.PI * 2); x.stroke(); } ell(c, c, c * big * (kind === 'mango' ? 0.55 : 0.85), c * big, 0, A.pit); }
      if (A.cut === 'kiwi') { for (let i = 0; i < 60; i++) { const a = i / 60 * Math.PI * 2; x.strokeStyle = 'rgba(220,240,170,0.6)'; x.lineWidth = 2; x.beginPath(); x.moveTo(c + Math.cos(a) * c * 0.25, c + Math.sin(a) * c * 0.25); x.lineTo(c + Math.cos(a) * c * 0.85, c + Math.sin(a) * c * 0.85); x.stroke(); ell(c + Math.cos(a) * c * 0.32, c + Math.sin(a) * c * 0.32, 3, 6, a, '#1d1a14'); } ell(c, c, c * 0.24, c * 0.18, 0, '#f4f6d8'); }
      if (A.cut === 'arils') for (let i = 0; i < 160; i++) { const a = rnd() * 6.283, r = Math.sqrt(rnd()) * c * 0.8; dot(c + Math.cos(a) * r, c + Math.sin(a) * r, c * 0.06, i % 3 ? '#c8102e' : '#e2364c'); }
      if (A.cut === 'hollow') ell(c, c, c * 0.62, c * 0.62, 0, '#f4efe3');
      if (A.cut === 'seeds') { ell(c, c, c * 0.42, c * 0.3, 0, kind === 'papaya' ? '#e0632a' : '#f1c27a'); for (let i = 0; i < 60; i++) { const a = rnd() * 6.283, r = Math.sqrt(rnd()) * c * 0.3; dot(c + Math.cos(a) * r * 1.3, c + Math.sin(a) * r, c * 0.035, kind === 'papaya' ? '#1c1714' : '#f3e3b8'); } }
      if (A.cut === 'melon') for (let i = 0; i < 22; i++) { const a = i / 22 * 6.283, r = c * (0.4 + (i % 2) * 0.16); ell(c + Math.cos(a) * r, c + Math.sin(a) * r, 4, 8, a + 1.57, '#1d1a18'); }
      if (A.cut === 'dots') for (let i = 0; i < 300; i++) { const a = rnd() * 6.283, r = Math.sqrt(rnd()) * c * 0.88; dot(c + Math.cos(a) * r, c + Math.sin(a) * r, 1.6, '#1a1614'); }
      if (A.cut === 'star') for (let i = 0; i < 8; i++) { const a = i / 8 * 6.283; ell(c + Math.cos(a) * c * 0.2, c + Math.sin(a) * c * 0.2, c * 0.2, c * 0.05, a, kitLight(fl, 0.4)); }
      if (A.cut === 'berry') { ell(c, c, c * 0.42, c * 0.55, 0, '#fbe3e0'); }
      if (A.cut === 'tomato') { for (let i = 0; i < 4; i++) { const a = i * 1.571 + 0.78; ell(c + Math.cos(a) * c * 0.4, c + Math.sin(a) * c * 0.4, c * 0.26, c * 0.2, a, '#f6a08a'); for (let j = 0; j < 6; j++) dot(c + Math.cos(a) * c * 0.4 + (rnd() - 0.5) * c * 0.2, c + Math.sin(a) * c * 0.4 + (rnd() - 0.5) * c * 0.2, 3, '#f8e07a'); } dot(c, c, c * 0.16, kitLight(fl, 0.3)); }
      if (A.cut === 'rings') { x.strokeStyle = '#c56d93'; x.lineWidth = 3; for (let i = 1; i < 8; i++) { x.beginPath(); x.ellipse(c, c, c * (0.95 - i * 0.12), c * (0.95 - i * 0.12), 0, 0, Math.PI * 2); x.stroke(); } }
      if (A.cut === 'pumpkin') { ell(c, c, c * 0.45, c * 0.32, 0, '#f7c46a'); for (let i = 0; i < 20; i++) ell(c + (rnd() - 0.5) * c * 0.6, c + (rnd() - 0.5) * c * 0.4, c * 0.05, c * 0.03, rnd() * 3, '#f7ecd0'); }
      if (A.cut === 'cucumber') { ell(c, c, c * 0.5, c * 0.5, 0, kitLight(fl, 0.25)); for (let k = 0; k < 6; k++) { const a = k / 6 * 6.283; ell(c + Math.cos(a) * c * 0.3, c + Math.sin(a) * c * 0.3, c * 0.06, c * 0.1, a, '#f6f9e8'); } }
      if (A.cut === 'plain') for (let i = 0; i < 30; i++) dot(c + (rnd() - 0.5) * c * 1.4, c + (rnd() - 0.5) * c * 1.4, 2, kitDark(fl, 0.15));
      x.fillStyle = rg; x.fillRect(0, 0, S, S); x.fillStyle = 'rgba(120,80,40,0.08)'; x.fillRect(0, 0, S, S); // (a touch darker: the studio light is bright)
      const tx = new T.CanvasTexture(cv); if (T.SRGBColorSpace) tx.colorSpace = T.SRGBColorSpace; return tx;
    };
    const faceMat = () => { const tx = cutTex(), m = M(A.flesh || '#f4e4a2', 0.85, { face: kind }).clone(); if (tx) { m.map = tx; m.color = new T.Color('#ffffff'); } return m; };
    const uvBox = (g) => { g.computeBoundingBox(); const b = g.boundingBox, p = g.attributes.position, uv = new Float32Array(p.count * 2); for (let i = 0; i < p.count; i++) { uv[i * 2] = (p.getX(i) - b.min.x) / (b.max.x - b.min.x || 1); uv[i * 2 + 1] = (p.getY(i) - b.min.y) / (b.max.y - b.min.y || 1); } g.setAttribute('uv', new T.BufferAttribute(uv, 2)); return g; };

    const build = (P, w, cut) => { // one item in group P, its width w (in units)
      const k = w, cy = A.asp / 2;
      if (A.b === 'round' || A.b === 'pumpkin') {
        const lying = ['lemon', 'mango', 'oval', 'lumpy'].includes(A.sh), rx = 0.48 * k, ry = A.asp * 0.48 * k;
        const skin = gloss(A.col, A.tex === 'fuzz' || A.tex === 'fiber' || A.tex === 'net' ? 0.85 : A.tex === 'eyes' ? 0.8 : 0.3);
        if (!cut) {
          let body;
          if (lying) { body = mesh(new T.SphereGeometry(0.48 * k, 48, 32), skin, 0, ry, 0, P); body.scale.set(1, A.asp, A.sh === 'lumpy' ? 0.7 : A.asp * 0.95); if (A.sh === 'lumpy') bumpy(body, 0.06, 6); if (A.sh === 'lemon') [-1, 1].forEach((sd) => { const nb = mesh(new T.SphereGeometry(0.06 * k, 12, 10), skin, sd * 0.49 * k, ry, 0, P); nb.scale.set(1.3, 0.8, 0.8); }); }
          else { body = lathe2(prof(A.b === 'pumpkin' ? 'round' : A.sh, rx, ry), skin, P); if (A.b === 'pumpkin' || A.sh === 'squat' && kind === 'tomato') ribs(body, A.b === 'pumpkin' ? 10 : 5, A.b === 'pumpkin' ? 0.07 : 0.025); }
          if (A.col2 || A.col3 || A.tex === 'stripes' || A.tex === 'seeds' || A.tex === 'net' || A.tex === 'scales' || A.tex === 'eyes' || A.tex === 'dimple') { const base = new T.Color(A.col), c2 = new T.Color(A.col2 || A.col), c3 = new T.Color(A.col3 || A.col), dk = new T.Color(kitDark3(A.col)), y1 = new T.Color('#f4d24a'), net = new T.Color('#efe1bd'), gr = new T.Color('#9cc43a');
            paintV(body, (x, y, z, c) => { c.copy(base); const a = Math.atan2(z, x);
              if (A.col2) c.lerp(c2, Math.max(0, Math.min(1, (x * 1.6 + 0.2 + noise(x * 6, y * 6, z * 6) * 0.25))) * 0.6);
              if (A.col3) c.lerp(c3, Math.max(0, Math.min(1, -x * 2.4 - 0.2)) * 0.7);
              if (A.tex === 'stripes' && Math.sin(a * 14 + Math.sin(y * 18) * 0.9) > 0.1) c.copy(dk);
              if (A.tex === 'dimple' && noise(x * 60, y * 60, z * 60) > 0.75) c.multiplyScalar(0.9);
              if (A.tex === 'seeds' && Math.sin(a * 34) * Math.sin(y * 140) > 0.94) c.copy(y1);
              if (A.tex === 'net' && Math.abs(noise(x * 22, y * 22, z * 22)) < 0.08) c.copy(net);
              if (A.tex === 'scales' && noise(x * 9, y * 9, z * 9) > 0.7) c.copy(gr);
              if (A.tex === 'eyes' && noise(x * 14, y * 14, z * 14) > 0.85) c.multiplyScalar(0.7); });
          }
          const topY = lying ? 2 * ry : prof(A.sh, rx, ry)[40][1];
          if (A.stem) stem3(P, 0, topY - 0.03 * k, 0, 0.1 * k, 0.014 * k);
          if (A.leaf) leaf3(P, 0.01 * k, topY + 0.03 * k, 0, 0.24 * k, 0.6, 0.5, '#5c9e35');
          if (A.crown === 1) { const cr = mesh(new T.CylinderGeometry(0.06 * k, 0.04 * k, 0.08 * k, 6, 1, true), skin, 0, topY + 0.03 * k, 0, P); cr.material = skin; }
          if (A.crown === 2 || A.crown === 3) sepals3(P, 0, topY - 0.01 * k, 0, (A.sh === 'heart' ? 0.16 : 0.12) * k, A.crown === 2 ? '#5a6e2a' : '#3f8a2e');
          if (A.b === 'pumpkin') { stem3(P, 0, topY - 0.02 * k, 0, 0.12 * k, 0.04 * k, '#6b5a2a'); }
          if (A.sh === 'onion') stem3(P, 0, topY - 0.02 * k, 0, 0.06 * k, 0.01 * k, '#c9a07a', 0);
        } else { // a half, lying with its cut face up, what is inside painted on it
          const pr = lying ? Array.from({ length: 41 }, (_, i) => { const tt = -Math.PI / 2 + Math.PI * i / 40; return [Math.max(0.0005, Math.cos(tt) * rx), ry + Math.sin(tt) * Math.min(ry, rx * A.asp)]; }) : prof(A.b === 'pumpkin' ? 'round' : A.sh, rx, ry);
          const half = lathe2(pr, M(A.cut === 'hollow' ? '#6e4a2b' : A.col, 0.4, { clear: true }), new T.Group(), Math.PI); const hg = half.geometry; hg.rotateZ(-Math.PI / 2); hg.translate(-ry, rx, 0);
          const shp = new T.Shape(); pr.forEach(([r, y], i) => (i ? shp.lineTo(y - ry, r) : shp.moveTo(y - ry, r))); for (let i = pr.length - 1; i >= 0; i--) shp.lineTo(pr[i][1] - ry, -pr[i][0]);
          const fg = uvBox(new T.ShapeGeometry(shp, 24)); fg.rotateX(-Math.PI / 2); const face = mesh(fg, faceMat(), 0, rx + 0.001 * k, 0, P); void face;
          const hm = new T.Mesh(hg, half.material); hm.material = hm.material.clone(); hm.material.side = T.DoubleSide; P.add(hm);
        }
      } else if (A.b === 'long') {
        const len = 0.92 * k, H0 = A.asp / 2 * k, bend = kind === 'chili' ? 0.1 * k : kind === 'sweetpotato' ? 0.03 * k : 0.04 * k;
        const rad = (tt) => { const e = Math.sin(Math.PI * tt); if (A.bulb) return H0 * (0.35 + 0.65 * Math.pow(Math.sin(Math.PI * Math.min(1, tt * 0.8 + 0.15)), 0.8)); if (A.taper === 2) return H0 * Math.max(0.05, tt < 0.15 ? 0.85 : (1 - tt) * 1.05); if (A.taper) return H0 * Math.max(0.05, Math.pow(e, 0.7)); return H0 * Math.max(0.1, Math.pow(e, 0.18)); };
        if (!cut) {
          const pts = []; for (let i = 0; i <= 40; i++) pts.push([Math.max(0.0005, rad(i / 40)), i / 40 * len]);
          const e = lathe2(pts, gloss(A.col, kind === 'sweetpotato' ? 0.75 : 0.3), P, Math.PI * 2, 32), g = e.geometry; g.rotateZ(-Math.PI / 2); g.translate(-len / 2, 0, 0);
          const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), tt = (x + len / 2) / len; p.setY(i, p.getY(i) + H0 + bend * (Math.sin(Math.PI * tt) * 2 - 1) * (kind === 'chili' ? -1 : 1)); } g.computeVertexNormals();
          if (A.tex === 'bumps' || A.tex === 'speckle') { const base = new T.Color(A.col), lt = new T.Color(kitLight3(A.col)); paintV(e, (x, y, z, c) => { c.copy(base); if (noise(x * 50, y * 50, z * 50) > 0.6) c.lerp(lt, 0.5); }); }
          if (['eggplant', 'chili', 'cucumber', 'zucchini'].includes(kind)) { const cap = mesh(new T.ConeGeometry(rad(0.06) * 1.15, 0.08 * k, 8), M('#4f7a2a', 0.6), -len / 2 + 0.03 * k, H0 + (kind === 'chili' ? bend : -bend), 0, P); cap.rotation.z = Math.PI / 2; stem3(P, -len / 2, H0 + (kind === 'chili' ? bend : -bend), 0, 0.08 * k, 0.015 * k, '#4f7a2a', -1); }
        } else {
          [-0.28, 0, 0.28].forEach((u, i) => { const r = 0.14 * k, th = 0.05 * k; const sl = mesh(new T.CylinderGeometry(r, r, th, 40), M(A.col, 0.4, { clear: true }), u * k, th / 2 + (i === 1 ? 0.02 * k : 0), 0, P); const f = mesh(new T.CircleGeometry(r * 0.93, 40), faceMat(), u * k, th + 0.001 * k + (i === 1 ? 0.02 * k : 0), 0, P); f.rotation.x = -Math.PI / 2; void sl; });
        }
      } else if (A.b === 'banana') {
        const c = new T.CatmullRomCurve3([[-0.46, 0.36], [-0.25, 0.16], [0, 0.11], [0.25, 0.15], [0.46, 0.33]].map(([u, v]) => new T.Vector3(u * k, v * k, 0)));
        const tb = new T.TubeGeometry(c, 60, 0.075 * k, 6, false), p = tb.attributes.position; for (let i = 0; i <= 60; i++) { const f = Math.sin(Math.PI * Math.min(1, Math.max(0, (i / 60 - 0.02) / 0.96))) ** 0.35, ctr = c.getPointAt(i / 60); for (let j = 0; j <= 6; j++) { const idx = i * 7 + j, v = new T.Vector3().fromBufferAttribute(p, idx).sub(ctr).multiplyScalar(Math.max(0.12, f)).add(ctr); p.setXYZ(idx, v.x, v.y, v.z); } } tb.computeVertexNormals();
        mesh(tb, gloss(A.col, 0.45), 0, 0, 0, P); mesh(new T.SphereGeometry(0.02 * k, 8, 6), M('#3a2a1a', 0.7), 0.46 * k, 0.33 * k, 0, P); stem3(P, -0.46 * k, 0.36 * k, 0, 0.06 * k, 0.018 * k, '#7a8a3a', -0.5);
      } else if (A.b === 'grapes' || A.b === 'cherries' || A.b === 'berries' || A.b === 'drupe') {
        const m = gloss(A.col, A.b === 'berries' ? 0.55 : 0.28);
        if (A.b === 'grapes') { const rr = 0.085 * k; let n = 0; for (let ri = 0; ri < 7; ri++) { const cnt = [5, 5, 4, 4, 3, 2, 1][ri]; for (let i = 0; i < cnt; i++) for (let j = 0; j < (cnt > 2 ? 2 : 1); j++) { const R2 = krand(++n * 13); mesh(new T.SphereGeometry(rr, 16, 12), m, ((i - (cnt - 1) / 2) * 1.75 + (R2() - 0.5) * 0.4) * rr, (1.0 * k - ri * rr * 1.45 - rr), (j - 0.5) * rr * 1.5 + (R2() - 0.5) * rr * 0.4, P); } } stem3(P, 0, 1.0 * k, 0, 0.16 * k, 0.015 * k); leaf3(P, 0.02 * k, 1.08 * k, 0, 0.3 * k, 0.4, 0.3, '#5c9e35', 0.6); }
        if (A.b === 'cherries') { [[-0.17, 0.18], [0.16, 0.17]].forEach(([u, r]) => { mesh(new T.SphereGeometry(r * k, 24, 18), m, u * k, r * k, 0, P); const cc = new T.CatmullRomCurve3([new T.Vector3(u * k, r * 2 * k, 0), new T.Vector3(u * 0.5 * k, 0.65 * k, 0), new T.Vector3(0.02 * k, 1.0 * k, 0)]); mesh(new T.TubeGeometry(cc, 16, 0.012 * k, 6), M('#5a7a2a', 0.7), 0, 0, 0, P); }); leaf3(P, 0.02 * k, 0.98 * k, 0, 0.3 * k, -0.6, 0.2); }
        if (A.b === 'berries') [[-0.2, 0.17, 0.1], [0.2, 0.16, -0.05], [0, 0.17, -0.2], [0.02, 0.16, 0.18]].forEach(([u, r, z]) => { mesh(new T.SphereGeometry(r * k, 20, 16), m, u * k, r * k, z * k, P); mesh(new T.TorusGeometry(r * 0.25 * k, r * 0.06 * k, 6, 10), M('#1f2a52', 0.6), u * k, r * 1.95 * k, z * k, P).rotation.x = Math.PI / 2; });
        if (A.b === 'drupe') { const rr = 0.055 * k; let n = 0; for (let ri = 0; ri < 9; ri++) { const v = 0.05 + ri * 0.1, ring = 0.33 * Math.sin(Math.PI * (0.12 + ri / 9.5)); const cnt = Math.max(1, Math.round(ring * 6.283 * k / (rr * 1.8))); for (let i = 0; i < cnt; i++) { const a = i / cnt * 6.283 + ri * 0.4; mesh(new T.SphereGeometry(rr, 10, 8), m, Math.cos(a) * ring * k, (v + 0.05) * k, Math.sin(a) * ring * k, P); n++; } } if (kind === 'raspberry') sepals3(P, 0, A.asp * k - 0.02 * k, 0, 0.1 * k); }
      } else if (A.b === 'pineapple') {
        const body = lathe2(prof('round', 0.36 * k, 0.5 * k).map(([r, y]) => [r, y + 0.05 * k]), M(A.col, 0.75), P);
        paintV(body, (x, y, z, c) => { const a = Math.atan2(z, x); c.set(A.col); const f = Math.sin(a * 12 + y * 50) * Math.sin(a * 12 - y * 50); if (f > 0.6) c.set('#6b4a1a'); else if (f < -0.5) c.set(kitDark3(A.col)); });
        for (let i = 0; i < 16; i++) leaf3(P, 0, 1.0 * k, 0, (0.32 + (i % 3) * 0.1) * k, i * 0.785 + (i % 2) * 0.39, 1.3 - (i % 3) * 0.25, i % 2 ? '#4f8a30' : '#3f7a2a', 0.22);
      } else if (A.b === 'carrot') {
        const pts = []; for (let i = 0; i <= 30; i++) { const tt = i / 30; pts.push([Math.max(0.001, 0.15 * k * Math.pow(tt, 0.7)), 0.04 * k + tt * 0.94 * k]); } pts.push([0.001, 0.99 * k]);
        const e = lathe2(pts, M(A.col, 0.6, { clear: true }), P); paintV(e, (x, y, z, c) => { c.set(A.col); if (Math.sin(y * 90) > 0.85) c.set(kitDark3(A.col)); });
        for (let i = 0; i < 8; i++) { const a = i * 0.8; const cc = new T.CatmullRomCurve3([new T.Vector3(0, 0.97 * k, 0), new T.Vector3(Math.cos(a) * 0.1 * k, 1.3 * k, Math.sin(a) * 0.1 * k), new T.Vector3(Math.cos(a) * 0.25 * k, 1.6 * k, Math.sin(a) * 0.25 * k)]); mesh(new T.TubeGeometry(cc, 10, 0.012 * k, 5), M('#4f9a35', 0.6), 0, 0, 0, P); for (let j = 1; j < 4; j++) { const q = cc.getPointAt(0.3 + j * 0.2); leaf3(P, q.x, q.y, q.z, 0.1 * k, a + 0.5, 0.6, '#5aa83a', 0.5); leaf3(P, q.x, q.y, q.z, 0.1 * k, a - 0.5, 0.6, '#5aa83a', 0.5); } }
      } else if (A.b === 'corn') {
        const cobPts = []; for (let i = 0; i <= 24; i++) { const tt = i / 24; cobPts.push([Math.max(0.001, 0.12 * k * Math.pow(Math.sin(Math.PI * (0.08 + tt * 0.84)), 0.4)), tt * 0.78 * k]); }
        const cob = lathe2(cobPts, M(A.col, 0.4, { clear: true }), new T.Group()); const cg = cob.geometry; cg.rotateZ(-Math.PI / 2); cg.translate(-0.34 * k, 0.18 * k, 0); const ce = mesh(cg, cob.material, 0, 0, 0, P);
        paintV(ce, (x, y, z, c) => { c.set(A.col); const a = Math.atan2(z, y - 0.18); if (Math.sin(x * 160) > 0.7 || Math.sin(a * 14) > 0.75) c.set(kitDark3(A.col)); });
        [[1, '#8fb84a'], [-1, '#7aa83a'], [0.4, '#9cc45a']].forEach(([sd, hc]) => { const hk = new T.Mesh(leafGeo(0.95 * k, 0.16 * k, 0.6), M(hc, 0.6, { clear: true })); hk.material = hk.material.clone(); hk.material.side = T.DoubleSide; hk.position.set(-0.46 * k, 0.16 * k, 0); hk.rotation.set(0, Math.PI / 2, sd * 0.25); P.add(hk); });
      } else if (A.b === 'pepper') {
        const e = lathe2(prof('round', 0.42 * k, 0.4 * k).map(([r, y], i) => [r * (1 + 0.12 * Math.max(0, (y / k - 0.4))), y]), gloss(A.col, 0.22), P); ribs(e, 4, 0.09);
        mesh(new T.CylinderGeometry(0.08 * k, 0.1 * k, 0.04 * k, 12), M('#3f7a2a', 0.5), 0, 0.8 * k, 0, P); stem3(P, 0, 0.82 * k, 0, 0.16 * k, 0.025 * k, '#4f8a30', 0.4);
      } else if (A.b === 'cabbage' || A.b === 'lettuce' || A.b === 'broccoli') {
        const white = kind === 'cauliflower', c = A.col;
        if (A.b === 'broccoli') { if (!white) mesh(new T.CylinderGeometry(0.07 * k, 0.09 * k, 0.5 * k, 12), M('#9cc45a', 0.6), 0, 0.25 * k, 0, P); else for (let i = 0; i < 7; i++) leaf3(P, 0, 0.18 * k, 0, 0.42 * k, i * 0.9, 0.55, '#5f9a3a', 0.4);
          const fm = M(c, 0.9); [[0, white ? 0.42 : 0.68, 0, 0.22], [-0.2, white ? 0.36 : 0.6, 0.06, 0.17], [0.2, white ? 0.36 : 0.6, -0.06, 0.17], [0.05, white ? 0.38 : 0.62, 0.2, 0.16], [-0.05, white ? 0.38 : 0.62, -0.2, 0.16], [0, white ? 0.55 : 0.82, 0, 0.17]].forEach(([x, y, z, r]) => { const e = mesh(lump(r * k, 3, 0.18, [1, 0.85, 1], 4), fm, x * k, y * k, z * k, P); void e; }); }
        else { const lm = M(c, 0.55, { clear: true }); const core = mesh(lump(0.3 * k, 4, 0.04, [1, 0.92, 1], 2), lm, 0, 0.36 * k, 0, P); paintV(core, (x, y, z, cc) => { cc.set(c); if (Math.abs(Math.sin(Math.atan2(z, x) * 5 + y * 8)) < 0.08) cc.set(kitLight3(c)); }); for (let i = 0; i < 7; i++) { const lf = leaf3(P, Math.cos(i * 0.9) * 0.05 * k, 0.05 * k, Math.sin(i * 0.9) * 0.05 * k, (A.b === 'lettuce' ? 0.48 : 0.42) * k, i * 0.9, 0.7, kitDark3b(c, 0.92), 0.9); if (A.b === 'lettuce') bumpy(lf, 0.05, 30); } }
      } else if (A.b === 'greens') {
        for (let i = 0; i < 7; i++) leaf3(P, 0, 0.1 * k, 0, 0.7 * k, i * 0.9, 1.05 + (i % 3) * 0.12, A.col, 0.42);
        mesh(new T.CylinderGeometry(0.05 * k, 0.05 * k, 0.06 * k, 10), M('#c9a46a', 0.8), 0, 0.12 * k, 0, P);
      } else if (A.b === 'mushroom') {
        lathe2([[0.1, 0], [0.11, 0.2], [0.13, 0.44], [0.001, 0.44]].map(([r, y]) => [r * k, y * k]), M('#f2ead8', 0.7), P);
        lathe2([[0.44, 0.44], [0.46, 0.5], [0.4, 0.66], [0.2, 0.82], [0.001, 0.86]].map(([r, y]) => [r * k, y * k]), gloss(A.col, 0.55), P); const gill = mesh(new T.CircleGeometry(0.44 * k, 40), M('#e9dcc2', 0.8), 0, 0.44 * k, 0, P); gill.rotation.x = Math.PI / 2;
      } else if (A.b === 'peas') {
        const pod = mesh(new T.SphereGeometry(0.47 * k, 32, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), M(kitDark3b(A.col, 0.85), 0.5, { clear: true }), 0, 0.17 * k, 0, P); pod.scale.set(1, 0.32, 0.25); pod.material = pod.material.clone(); pod.material.side = T.DoubleSide;
        for (let i = 0; i < 6; i++) mesh(new T.SphereGeometry(0.065 * k, 16, 12), gloss(A.col, 0.4), (-0.3 + i * 0.12) * k, 0.16 * k, 0, P);
      } else if (A.b === 'garlic') {
        const gm = M(A.col, 0.6, { clear: true }); for (let i = 0; i < 7; i++) { const a = i * 0.9, cl = lathe2(prof('onion', 0.16 * k, 0.24 * k), gm, P); cl.position.set(Math.cos(a) * 0.13 * k, 0, Math.sin(a) * 0.13 * k); cl.rotation.z = -Math.cos(a) * 0.25; cl.rotation.x = Math.sin(a) * 0.25; } lathe2(prof('onion', 0.2 * k, 0.32 * k), gm, P); stem3(P, 0, 0.8 * k, 0, 0.16 * k, 0.02 * k, '#c9b89a', 0);
      } else if (A.b === 'root') {
        const beet = kind === 'beet', e = lathe2(prof('onion', 0.3 * k, 0.26 * k).map(([r, y]) => [r, 0.56 * k - y + 0.0]).reverse(), gloss(A.col, 0.45), P); void e;
        mesh(new T.ConeGeometry(0.015 * k, 0.12 * k, 6), M(kitDark3(A.col), 0.6), 0, 0.03 * k, 0, P).rotation.x = Math.PI;
        for (let i = 0; i < 6; i++) { const a = i * 1.05; const cc = new T.CatmullRomCurve3([new T.Vector3(0, 0.55 * k, 0), new T.Vector3(Math.cos(a) * 0.1 * k, 0.8 * k, Math.sin(a) * 0.1 * k), new T.Vector3(Math.cos(a) * 0.2 * k, 1.0 * k, Math.sin(a) * 0.2 * k)]); mesh(new T.TubeGeometry(cc, 10, 0.015 * k, 5), M(beet ? '#a8304f' : '#8fbf5a', 0.6), 0, 0, 0, P); leaf3(P, Math.cos(a) * 0.2 * k, 1.0 * k, Math.sin(a) * 0.2 * k, 0.45 * k, a, 1.0, beet ? '#4f8a3a' : '#5fa83a', 0.5); }
      } else if (A.b === 'celery') {
        for (let i = 0; i < 7; i++) { const a = i * 0.9, r = (i ? 0.07 : 0) * k; const st = mesh(new T.CylinderGeometry(0.035 * k, 0.045 * k, 1.2 * k, 10, 1, false, 0, Math.PI * 1.4), M(A.col, 0.45, { clear: true }), Math.cos(a) * r, 0.6 * k, Math.sin(a) * r, P); st.rotation.y = -a; st.material = st.material.clone(); st.material.side = T.DoubleSide; for (let j = 0; j < 3; j++) leaf3(P, Math.cos(a) * r, 1.2 * k, Math.sin(a) * r, 0.22 * k, a + j * 2, 0.4, '#5aa83a', 0.6); }
      } else if (A.b === 'loaf') { const e = mesh(lump(0.48 * k, 3, 0.03, [1, 0.55, 0.55], 1.5), M(A.col, 0.6, { clear: true }), 0, 0.2 * k, 0, P); e.scale.y = 1; [-0.25, -0.05, 0.15, 0.32].forEach((u) => { const c = mesh(new T.CapsuleGeometry(0.02 * k, 0.12 * k, 4, 8), M('#f3d39a', 0.8), u * k, 0.44 * k, 0, P); c.rotation.set(Math.PI / 2, 0, 0.5); });
      } else if (A.b === 'toast') {
        const sh = new T.Shape(); [[-0.42, 0.03], [0.42, 0.03], [0.43, 0.68], [0.46, 0.82], [0.32, 0.96], [0, 0.94], [-0.32, 0.96], [-0.46, 0.82], [-0.43, 0.68]].forEach(([u, v], i) => (i ? sh.lineTo(u * k, v * k) : sh.moveTo(u * k, v * k)));
        const tg = new T.ExtrudeGeometry(sh, { depth: 0.12 * k, bevelEnabled: true, bevelSize: 0.02 * k, bevelThickness: 0.02 * k, bevelSegments: 2, curveSegments: 8 }); tg.rotateX(-Math.PI / 2); mesh(tg, M(A.col, 0.75), 0, 0, 0.5 * k, P); mesh(new T.BoxGeometry(0.22 * k, 0.04 * k, 0.18 * k), M('#f8e08a', 0.3, { clear: true }), 0, 0.16 * k, 0, P);
      } else if (A.b === 'croissant') { const tg = new T.TorusGeometry(0.3 * k, 0.12 * k, 16, 32, Math.PI * 1.2); const p = tg.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), a = Math.atan2(y, x), f = 0.5 + 0.5 * Math.sin((a + 0.0) * 1.5); p.setZ(i, p.getZ(i) * (0.4 + f)); } tg.computeVertexNormals(); const e = mesh(tg, M(A.col, 0.45, { clear: true }), 0, 0.12 * k, 0, P); e.rotation.set(-Math.PI / 2, 0, -Math.PI * 0.1);
      } else if (A.b === 'bowl') {
        const bc = A.fill === 'rice' ? '#3f6fb8' : A.fill === 'salad' ? '#f3f1ec' : '#e8eef2';
        const bowl = lathe2([[0.2, 0], [0.22, 0.02], [0.4, 0.2], [0.46, 0.42], [0.44, 0.42], [0.38, 0.22], [0.2, 0.05], [0.001, 0.05]].map(([r, y]) => [r * k, y * k]), M(bc, 0.25, { clear: true }), P); bowl.material = bowl.material.clone(); bowl.material.side = T.DoubleSide;
        if (A.fill === 'rice') { const r = mesh(lump(0.42 * k, 4, 0.05, [1, 0.45, 1], 12), M('#fbfaf5', 0.8), 0, 0.4 * k, 0, P); void r; }
        else { const sf = mesh(new T.CylinderGeometry(0.42 * k, 0.4 * k, 0.02 * k, 40), gloss(A.col, 0.2), 0, 0.37 * k, 0, P); void sf;
          if (A.fill === 'noodles') { for (let i = 0; i < 10; i++) { const cc = new T.CatmullRomCurve3(Array.from({ length: 6 }, (_, j) => new T.Vector3((-0.3 + j * 0.12) * k, (0.39 + Math.sin(j + i) * 0.01) * k, (-0.3 + i * 0.065 + Math.sin(j * 2 + i) * 0.03) * k))); mesh(new T.TubeGeometry(cc, 20, 0.012 * k, 5), M('#f8dc8a', 0.5), 0, 0, 0, P); } const egg = mesh(new T.SphereGeometry(0.07 * k, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), M('#fbf8ef', 0.4), 0.15 * k, 0.39 * k, 0.1 * k, P); egg.scale.set(1, 0.6, 0.75); mesh(new T.SphereGeometry(0.035 * k, 12, 8), gloss('#f6a21e', 0.3), 0.15 * k, 0.41 * k, 0.1 * k, P); }
          if (A.fill === 'soup') [[-0.2, 0.05, '#7a3a22'], [0.1, -0.1, '#f3c46a'], [0.2, 0.12, '#7a3a22'], [-0.05, 0.2, '#f3c46a'], [0, -0.22, '#5aa83a']].forEach(([x, z, c]) => mesh(new T.BoxGeometry(0.07 * k, 0.05 * k, 0.07 * k), M(c, 0.6), x * k, 0.39 * k, z * k, P).rotation.set(0.3, x * 4, 0.2));
          if (A.fill === 'salad') { for (let i = 0; i < 8; i++) leaf3(P, Math.cos(i) * 0.15 * k, 0.4 * k, Math.sin(i) * 0.15 * k, 0.24 * k, i * 0.8, 0.5, ['#5aa83a', '#7cc04a', '#3f8a2e', '#8bd15a'][i % 4], 0.7); [[0.05, 0.05], [-0.15, -0.1], [0.2, -0.12]].forEach(([x, z]) => mesh(new T.SphereGeometry(0.05 * k, 14, 10), gloss('#e3332a', 0.3), x * k, 0.45 * k, z * k, P)); }
        }
        if (A.hot) steamPuffs(0, 0.5 * k, 0, 0.5 * k);
      } else if (A.b === 'sandwich' || A.b === 'burger') {
        const disc = (r, h, y, c, rough = 0.6) => mesh(new T.CylinderGeometry(r * k, r * k, h * k, 40), M(c, rough, { clear: true }), 0, y * k, 0, P);
        if (A.b === 'burger') { disc(0.42, 0.1, 0.06, '#d98c3a'); disc(0.45, 0.12, 0.17, '#6b3a1e', 0.8); const ch = mesh(new T.BoxGeometry(0.75 * k, 0.02 * k, 0.75 * k), M('#f6c21e', 0.4, { clear: true }), 0, 0.245 * k, 0, P); ch.rotation.y = 0.4; const lt = disc(0.47, 0.03, 0.27, '#6fbf3a'); bumpy(lt, 0.06, 20); const top = lathe2([[0.44, 0], [0.44, 0.06], [0.38, 0.22], [0.2, 0.33], [0.001, 0.35]].map(([r, y]) => [r * k, y * k]), M('#d98c3a', 0.4, { clear: true }), P); top.position.y = 0.29 * k; for (let i = 0; i < 14; i++) { const a = i * 2.4, r = 0.1 + (i % 4) * 0.06; const sd = mesh(new T.SphereGeometry(0.014 * k, 6, 4), M('#fbf3d8', 0.6), Math.cos(a) * r * k, (0.29 + 0.35 - r * 0.6) * k, Math.sin(a) * r * k, P); sd.scale.set(1.6, 0.6, 1); } }
        else { const tri = (h, y, c) => { const sh = new T.Shape(); sh.moveTo(-0.44 * k, -0.3 * k); sh.lineTo(0.44 * k, -0.3 * k); sh.lineTo(0, 0.42 * k); sh.lineTo(-0.44 * k, -0.3 * k); const gg = new T.ExtrudeGeometry(sh, { depth: h * k, bevelEnabled: true, bevelSize: 0.015 * k, bevelThickness: 0.01 * k, bevelSegments: 2 }); gg.rotateX(-Math.PI / 2); return mesh(gg, M(c, 0.6, { clear: true }), 0, y * k, 0, P); }; tri(0.1, 0.02, '#e6c48a'); tri(0.03, 0.13, '#6fbf3a'); tri(0.03, 0.17, '#f6c84a'); tri(0.04, 0.21, '#e3332a'); tri(0.05, 0.26, '#e8a09a'); tri(0.1, 0.33, '#e6c48a'); }
      } else if (A.b === 'pizza') { const sh = new T.Shape(); sh.moveTo(0, -0.45 * k); sh.lineTo(0.42 * k, 0.4 * k); sh.quadraticCurveTo(0, 0.5 * k, -0.42 * k, 0.4 * k); sh.lineTo(0, -0.45 * k); const gg = new T.ExtrudeGeometry(sh, { depth: 0.04 * k, bevelEnabled: true, bevelSize: 0.01 * k, bevelThickness: 0.01 * k, bevelSegments: 2 }); gg.rotateX(-Math.PI / 2); mesh(gg, M(A.col, 0.5, { clear: true }), 0, 0, 0, P); const cr = mesh(new T.CylinderGeometry(0.04 * k, 0.04 * k, 0.86 * k, 12), M('#c9873a', 0.7), 0, 0.05 * k, -0.42 * k, P); cr.rotation.z = Math.PI / 2; [[0, -0.2], [-0.15, -0.3], [0.15, -0.3], [0.03, 0.05], [-0.08, -0.08]].forEach(([x, z]) => mesh(new T.CylinderGeometry(0.055 * k, 0.055 * k, 0.012 * k, 20), M('#b9231e', 0.45, { clear: true }), x * k, 0.065 * k, z * k, P));
      } else if (A.b === 'taco') { const sh = mesh(new T.CylinderGeometry(0.4 * k, 0.4 * k, 0.32 * k, 32, 1, true, Math.PI / 2, Math.PI), M(A.col, 0.6), 0, 0.4 * k, 0, P); sh.rotation.x = Math.PI / 2; sh.material = sh.material.clone(); sh.material.side = T.DoubleSide; const fill = mesh(lump(0.3 * k, 3, 0.2, [1.2, 0.3, 0.45], 5), M('#6fbf3a', 0.7), 0, 0.42 * k, 0, P); void fill; [[-0.2], [0], [0.2]].forEach(([x]) => mesh(new T.SphereGeometry(0.05 * k, 12, 8), gloss('#e3332a'), x * k, 0.47 * k, 0.02 * k, P));
      } else if (A.b === 'fries') { const box = mesh(new T.CylinderGeometry(0.34 * k, 0.26 * k, 0.72 * k, 4, 1), gloss('#d9262c', 0.4), 0, 0.39 * k, 0, P); box.rotation.y = Math.PI / 4; box.scale.z = 0.6; for (let i = 0; i < 16; i++) { const R2 = krand(i * 17); const f = mesh(new T.BoxGeometry(0.05 * k, (0.5 + R2() * 0.3) * k, 0.05 * k), M('#f6c64a', 0.6), (-0.2 + (i % 8) * 0.06) * k, (0.75 + R2() * 0.1) * k, (i < 8 ? -0.05 : 0.05) * k, P); f.rotation.z = (R2() - 0.5) * 0.3; }
      } else if (['pancakes', 'egg', 'steak', 'bacon', 'sausage', 'roast', 'drumstick', 'salmon', 'waffle', 'cheese'].includes(A.b)) {
        if (['pancakes', 'egg', 'steak', 'roast'].includes(A.b)) { lathe2([[0.001, 0], [0.4, 0], [0.48, 0.05], [0.47, 0.06], [0.38, 0.02], [0.001, 0.02]].map(([r, y]) => [r * k, y * k]), M('#f3f5f7', 0.25, { clear: true }), P); }
        const flat = (pts, h, y, c, rough = 0.6) => { const sh = new T.Shape(); pts.forEach(([u, v], i) => (i ? sh.lineTo(u * k, v * k) : sh.moveTo(u * k, v * k))); const gg = new T.ExtrudeGeometry(sh, { depth: h * k, bevelEnabled: true, bevelSize: Math.min(0.03, h * 0.4) * k, bevelThickness: Math.min(0.03, h * 0.4) * k, bevelSegments: 3, curveSegments: 12 }); gg.rotateX(-Math.PI / 2); return mesh(gg, M(c, rough, { clear: true }), 0, y * k, 0, P); };
        if (A.b === 'pancakes') { for (let i = 0; i < 5; i++) mesh(new T.CylinderGeometry(0.34 * k, 0.34 * k, 0.08 * k, 40), M(A.col, 0.55, { clear: true }), 0, (0.07 + i * 0.09) * k, 0, P); mesh(new T.BoxGeometry(0.12 * k, 0.05 * k, 0.12 * k), M('#f8e08a', 0.3, { clear: true }), 0, 0.52 * k, 0, P); const sy = mesh(new T.CylinderGeometry(0.3 * k, 0.3 * k, 0.012 * k, 40), glassy('#b9651a', 0.75), 0, 0.5 * k, 0, P); sy.userData.keepOpacity = 0.75; }
        if (A.b === 'egg') { flat([[-0.36, 0], [-0.3, 0.2], [0, 0.3], [0.3, 0.22], [0.38, 0], [0.25, -0.22], [-0.1, -0.28], [-0.32, -0.18]], 0.015, 0.02, A.col, 0.35); const yk = mesh(new T.SphereGeometry(0.12 * k, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2), gloss('#f6a21e', 0.2), 0, 0.05 * k, 0, P); yk.scale.y = 0.55; }
        if (A.b === 'steak') { flat([[-0.38, -0.1], [-0.3, 0.18], [0, 0.26], [0.32, 0.18], [0.38, -0.05], [0.2, -0.24], [-0.2, -0.24]], 0.06, 0.02, A.col, 0.55); }
        if (A.b === 'bacon') [-0.12, 0.12].forEach((z) => { const gg = new T.BoxGeometry(0.92 * k, 0.015 * k, 0.16 * k, 40, 1, 1), p = gg.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) + Math.sin(p.getX(i) / k * 18) * 0.03 * k); gg.computeVertexNormals(); const e = mesh(gg, M('#b8453a', 0.5, { clear: true }), 0, 0.05 * k, z * k, P); paintV(e, (x, y, zz, c) => { c.set(Math.sin((zz - z) * 60) > 0.3 ? '#f3d6c4' : '#b8453a'); }); });
        if (A.b === 'sausage') [-0.1, 0.12].forEach((z, i) => { const e = mesh(new T.CapsuleGeometry(0.08 * k, 0.72 * k, 8, 16), gloss(A.col, 0.3), 0, 0.08 * k, z * k, P); e.rotation.set(0, i * 0.15, Math.PI / 2); });
        if (A.b === 'roast') { const b = mesh(lump(0.34 * k, 3, 0.05, [1, 0.75, 0.85], 2), gloss(A.col, 0.4), 0, 0.3 * k, 0, P); void b; [-1, 1].forEach((sd) => { const lg = mesh(lump(0.13 * k, 2, 0.05, [1.3, 0.8, 0.8], 2), gloss(A.col, 0.4), sd * 0.3 * k, 0.2 * k, 0.15 * k, P); lg.rotation.y = sd * 0.5; mesh(new T.SphereGeometry(0.035 * k, 10, 8), M('#f3ead8', 0.6), sd * 0.45 * k, 0.24 * k, 0.2 * k, P); }); }
        if (A.b === 'drumstick') { const mt = mesh(new T.SphereGeometry(0.22 * k, 24, 16), gloss(A.col, 0.4), -0.15 * k, 0.2 * k, 0, P); mt.scale.set(1.4, 0.95, 0.95); const bn = mesh(new T.CylinderGeometry(0.035 * k, 0.04 * k, 0.32 * k, 10), M('#f3ead8', 0.6), 0.25 * k, 0.24 * k, 0, P); bn.rotation.z = Math.PI / 2 + 0.2; [0.05, -0.05].forEach((z) => mesh(new T.SphereGeometry(0.045 * k, 10, 8), M('#f3ead8', 0.6), 0.42 * k, 0.28 * k, z * k, P)); }
        if (A.b === 'salmon') { const e = flat([[-0.4, -0.25], [-0.46, 0.05], [-0.3, 0.3], [0, 0.35], [0.3, 0.3], [0.46, 0.05], [0.4, -0.25], [0.15, -0.28], [0.08, -0.02], [-0.08, -0.02], [-0.15, -0.28]], 0.12, 0, A.col, 0.45); paintV(e, (x, y, z, c) => { c.set(A.col); if (Math.sin((z + Math.abs(x) * 0.6) * 40) > 0.8) c.set('#fbe3d6'); if (y > 0.13) c.set(A.col); }); }
        if (A.b === 'waffle') { const e = mesh(new T.CylinderGeometry(0.45 * k, 0.45 * k, 0.1 * k, 48), M(A.col, 0.55, { clear: true }), 0, 0.05 * k, 0, P); paintV(e, (x, y, z, c) => { c.set(A.col); if (y > 0.04 && (Math.abs(Math.sin(x * 26)) < 0.25 || Math.abs(Math.sin(z * 26)) < 0.25)) c.set(kitDark3(A.col)); }); [[-0.15, 0.1, '#e0262d'], [0.12, -0.08, '#3d4f9a'], [0.2, 0.15, '#3d4f9a'], [0, -0.2, '#e0262d']].forEach(([x, z, c]) => mesh(new T.SphereGeometry(0.05 * k, 12, 10), gloss(c, 0.3), x * k, 0.13 * k, z * k, P)); }
        if (A.b === 'cheese') { const sh = new T.Shape(); sh.moveTo(-0.46 * k, -0.25 * k); sh.lineTo(0.46 * k, -0.25 * k); sh.lineTo(0.46 * k, 0.25 * k); sh.lineTo(-0.46 * k, -0.25 * k); const gg = new T.ExtrudeGeometry(sh, { depth: 0.32 * k, bevelEnabled: true, bevelSize: 0.01 * k, bevelThickness: 0.01 * k, bevelSegments: 2 }); gg.rotateX(-Math.PI / 2); mesh(gg, M(A.col, 0.5, { clear: true }), 0, 0, 0, P); [[0.3, 0.1], [0.1, 0.2], [0.35, 0.22]].forEach(([x, y]) => { const h = mesh(new T.SphereGeometry(0.05 * k, 12, 10), M(kitDark3(A.col), 0.6), x * k, y * k, 0.25 * k, P); h.scale.z = 0.3; }); }
      } else if (A.b === 'glass' || A.b === 'cup') {
        if (A.b === 'glass') { const gl = lathe2([[0.24, 0], [0.3, 1.45], [0.28, 1.45], [0.22, 0.04], [0.001, 0.04]].map(([r, y]) => [r * k, y * k]), glassy('#e3eef5', 0.28), P); gl.userData.keepOpacity = 0.28; gl.material.side = T.DoubleSide; const lq = lathe2([[0.001, 0.05], [0.22, 0.05], [0.28, 1.2], [0.001, 1.2]].map(([r, y]) => [r * k, y * k]), gloss(A.fill, 0.2), P); void lq; if (A.straw) { const sw2 = mesh(new T.CylinderGeometry(0.02 * k, 0.02 * k, 1.2 * k, 10), gloss('#e3332a', 0.3), 0.1 * k, 1.1 * k, 0, P); sw2.rotation.z = -0.2; } }
        else { lathe2([[0.001, 0], [0.4, 0], [0.47, 0.05], [0.46, 0.06], [0.36, 0.02], [0.001, 0.02]].map(([r, y]) => [r * k, y * k]), M('#f3f5f7', 0.2, { clear: true }), P); const cp = lathe2([[0.16, 0.03], [0.28, 0.18], [0.33, 0.6], [0.31, 0.6], [0.26, 0.2], [0.001, 0.07]].map(([r, y]) => [r * k, y * k]), M('#f8fafb', 0.2, { clear: true }), P); cp.material = cp.material.clone(); cp.material.side = T.DoubleSide; mesh(new T.CylinderGeometry(0.305 * k, 0.29 * k, 0.01 * k, 40), gloss(A.fill, 0.15), 0, 0.55 * k, 0, P); const hd = mesh(new T.TorusGeometry(0.11 * k, 0.025 * k, 10, 24, Math.PI * 1.2), M('#f3f5f7', 0.2, { clear: true }), 0.33 * k, 0.38 * k, 0, P); hd.rotation.z = -Math.PI * 0.6; if (A.hot) steamPuffs(0, 0.65 * k, 0, 0.5 * k); }
      }
    };
    if (both) { const a = new T.Group(), b = new T.Group(); a.position.x = -L * 0.26; b.position.x = L * 0.26; G.add(a, b); build(a, L * 0.48, false); build(b, L * 0.48, true); }
    else build(G, L, cutOnly);
    if (anim.length && !s.still) G.userData.animate = (time) => anim.forEach((f) => f(time));
    G.rotation.y = ({ x: Math.PI / 2, '-x': -Math.PI / 2, '-z': Math.PI, left: Math.PI, right: 0 })[s.facing] || 0;
  }
  return G;
}
function kitLight3(hex) { let h = hex.replace('#', ''); if (h.length === 3) h = h.split('').map((c) => c + c).join(''); return '#' + h.match(/../g).map((x) => Math.round(parseInt(x, 16) + (255 - parseInt(x, 16)) * 0.75).toString(16).padStart(2, '0')).join(''); }
function kitDark3b(hex, k = 0.85) { let h = hex.replace('#', ''); if (h.length === 3) h = h.split('').map((c) => c + c).join(''); return '#' + h.match(/../g).map((x) => Math.round(parseInt(x, 16) * k).toString(16).padStart(2, '0')).join(''); }
function kitDark3(hex) { let h = hex.replace('#', ''); if (h.length === 3) h = h.split('').map((c) => c + c).join(''); return '#' + h.match(/../g).map((x) => Math.round(parseInt(x, 16) * 0.65).toString(16).padStart(2, '0')).join(''); }

function shape3d(T, s, mat, along, v3, AX) {
  const t = String(s.t || s.type || '').toLowerCase();
  const axis = ['x', 'y', 'z'].includes(s.axis) ? s.axis : 'x';
  const r = num(s.r, .02, 8, .5), len = num(s.len ?? s.h, .02, 20, 1);
  let m = null;
  const own = s.color && /^#[0-9a-f]{3,8}$/i.test(s.color) ? Object.assign(mat.clone(), { color: new T.Color(s.color) }) : mat;
  if (KIT3.includes(t)) m = kit3d(T, s, own); // (v325) a tree, a flower, a cloud...: a whole real-looking model
  else if (t === 'cylinder' || t === 'tube' || t === 'disc') {
    const r2 = num(s.r2, .02, 8, r), h = t === 'disc' ? num(s.thick ?? s.len, .01, 2, .08) : len;
    const open = !!s.open, arc = s.cut ? Math.PI * 1.4 : Math.PI * 2;
    m = along(new T.Mesh(new T.CylinderGeometry(r2, r, h, 48, 1, open, s.cut ? Math.PI * .2 : 0, arc), own), axis);
  } else if (t === 'cone') {
    const g = new T.Mesh(new T.ConeGeometry(r, len, 40), own);
    if (axis === 'x') g.rotation.z = (s.dir === -1 ? 1 : -1) * Math.PI / 2; else if (axis === 'z') g.rotation.x = (s.dir === -1 ? -1 : 1) * Math.PI / 2; else if (s.dir === -1) g.rotation.z = Math.PI;
    m = g;
  } else if (t === 'sphere') m = new T.Mesh(new T.SphereGeometry(r, 40, 28, 0, s.cut ? Math.PI * 1.5 : Math.PI * 2), own);
  else if (t === 'box') {
    const sz = Array.isArray(s.size) ? s.size : [1, 1, 1], bx = num(sz[0], .02, 20, 1), by = num(sz[1], .02, 20, 1), bz = num(sz[2], .02, 20, 1);
    // (v320) real edges are rounded a little and catch the light (Blender skills, hard-surface: "no razor edges")
    const RB = T.RoundedBox, bev = Math.min(bx, by, bz) * .12;
    m = new T.Mesh(RB && bev > .01 && !s.sharp ? new RB(bx, by, bz, 3, bev) : new T.BoxGeometry(bx, by, bz), own);
  }
  else if (t === 'torus' || t === 'ring') { m = new T.Mesh(new T.TorusGeometry(r, num(s.tube, .01, 4, .12), 18, 56), own); if (axis === 'x') m.rotation.y = Math.PI / 2; else if (axis === 'y') m.rotation.x = Math.PI / 2; }
  else if (t === 'blades') {
    m = new T.Group(); const n = Math.round(num(s.n, 2, 40, 12)), bl = num(s.len, .05, 8, r), wd = num(s.width, .02, 2, .18);
    for (let i = 0; i < n; i++) { const b = new T.Mesh(new T.BoxGeometry(.04, bl, wd), own); b.position.y = bl / 2 + num(s.hub, 0, 4, .12); b.rotation.y = .5; const p = new T.Group(); p.add(b); p.rotation.x = i / n * Math.PI * 2; m.add(p); }
    if (axis === 'y') m.rotation.z = Math.PI / 2; else if (axis === 'z') m.rotation.y = Math.PI / 2;
  }
  else if (t === 'capsule') m = along(new T.Mesh(new T.CapsuleGeometry(r, len, 8, 24), own), axis);
  else if (t === 'pipe' || t === 'arrow') { // a tube through the points; an arrow ends in a head, the way it points
    const pts = pts3(s.pts).map((q) => new T.Vector3(q[0], q[1], q[2])), w = num(s.r, .01, 2, .06);
    if (pts.length < 2) return null;
    const tube = new T.Mesh(new T.TubeGeometry(pts.length > 2 ? new T.CatmullRomCurve3(pts) : new T.LineCurve3(pts[0], pts[1]), Math.max(8, pts.length * 12), w, 10, false), own);
    if (t === 'pipe') m = tube;
    else {
      const tip = pts[pts.length - 1], dir = tip.clone().sub(pts[pts.length - 2]).normalize(), hl = w * 7;
      const head = new T.Mesh(new T.ConeGeometry(w * 2.8, hl, 18), own);
      head.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), dir); head.position.copy(tip).addScaledVector(dir, hl / 2);
      m = new T.Group(); m.add(tube, head);
    }
  } else if (t === 'lathe') { // a profile [radius, along] turned round the axis
    const pr = pts2(s.profile).map((q) => new T.Vector2(Math.abs(q[0]), q[1]));
    if (pr.length < 2) return null;
    m = along(new T.Mesh(new T.LatheGeometry(pr, 48), own), axis);
  } else if (t === 'plate') { // a flat plate: its outline across the axis ([x,z] for y, [x,y] for z, [z,y] for x), "thick" along it
    const pr = pts2(s.outline), th = num(s.thick, .01, 4, .1);
    if (pr.length < 3) return null;
    const g = new T.ExtrudeGeometry(new T.Shape(pr.map((q) => new T.Vector2(q[0], q[1]))), { depth: th, bevelEnabled: false });
    g.translate(0, 0, -th / 2);
    m = new T.Mesh(g, own);
    if (axis === 'y') m.rotation.x = Math.PI / 2; else if (axis === 'x') m.rotation.y = -Math.PI / 2;
  }
  if (!m) return null;
  m.position.copy(v3(s.pos));
  if (Array.isArray(s.rot)) m.rotation.set(m.rotation.x + num(s.rot[0], -7, 7), m.rotation.y + num(s.rot[1], -7, 7), m.rotation.z + num(s.rot[2], -7, 7));
  return m;
}

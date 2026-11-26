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
const KINDS2 = ['line', 'arrow', 'rect', 'circle', 'ellipse', 'poly', 'path', 'text', 'vehicle', 'tree', 'flower', 'leaf', 'cloud', 'sun', 'moon', 'rainbow', 'snowflake', 'bolt', 'drops', 'grass', 'rock', 'log', 'mushroom']; // (v324: and the nature kit)
const KINDS3 = ['cylinder', 'tube', 'disc', 'cone', 'torus', 'ring', 'blades', 'sphere', 'box', 'capsule', 'pipe', 'arrow', 'lathe', 'plate', 'tree', 'flower', 'leaf', 'cloud', 'sun', 'moon', 'rainbow', 'rock', 'grass', 'log', 'mushroom', 'ground', 'drops', 'snowflake', 'bolt', 'vehicle']; // (v325: and the nature kit in 3D; v326: vehicles)
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
  host.appendChild(acts);
  const setSay = async (text, type) => {
    if (!type) { say.textContent = text; return; }
    say.textContent = '';
    // (v310) typed by the clock, not by the frame: about a second a sentence even on a slow or busy phone
    const t0 = performance.now(), total = Math.min(1100, text.length * 14);
    for (let n = 0; n < text.length;) { n = Math.max(n + 1, Math.ceil(text.length * Math.min(1, (performance.now() - t0) / total))); say.textContent = text.slice(0, n); if (n < text.length) await sleep(16); }
  };
  const view = spec.mode === '3d' ? await draw3d(stage, spec, { animate, setSay, hint, real: true, callout: true }) : draw2d(stage, spec, { animate, setSay, hint });
  // (v319) Machine view: the same 3D model drawn the Anatomy way (isoview.js), with no WebGL; on a phone with no 3D it is the view
  let mv = null; const mvHost = spec.mode === '3d' ? el('div', 'ld-mv') : null;
  const machineOn = async () => {
    if (mv) return mv;
    let m = null; try { m = await import('./isoview.js?v=326'); } catch (e) { return null; }
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
  const done = () => { dot.classList.add('off'); state.textContent = spec.mode === '3d' ? 'Cassie built it in 3D' : 'Cassie drew it'; setSay(spec.summary || spec.intro || ''); host.dispatchEvent(new CustomEvent('ld-done')); };
  if (view) {
    if (view.open) { const ob = btn('Open it up', () => { const on = view.open(); setLabel(ob, on ? 'Close the case' : 'Open it up'); ob.setAttribute('aria-pressed', String(on)); }, 'ld-open', 'open'); ob.setAttribute('aria-pressed', 'false'); }
    if (view.explode) { const pb = btn('Pull apart', () => { const on = view.explode(); setLabel(pb, on ? 'Put it back' : 'Pull apart'); pb.setAttribute('aria-pressed', String(on)); }, '', 'apart'); pb.setAttribute('aria-pressed', 'false'); }
    btn('Draw again', async () => { await view.play(true); done(); if (view.move) view.move(); }, '', 'redo');
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
  const view = {
    hintText,
    // (v314) moving parts: move() starts them once the drawing is there (move(true) even with Reduce Motion); pause() stops them
    motion: flowEls.length > 0 || spec.parts.some((p) => p.beat || p.spin),
    get moving() { return moving; },
    move(force) {
      if (!view.motion) return false;
      flowG.style.display = ''; motionSetup(); lay();
      if (still() && !force) return false;
      moving = true; lastT = 0; if (io2) io2.observe(svg);
      if (!raf2) raf2 = requestAnimationFrame(frame);
      return true;
    },
    pause() { moving = false; if (raf2) cancelAnimationFrame(raf2); raf2 = 0; },
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
        const talk = setSay(spec.parts[i].say || spec.parts[i].label, true);
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
const KIT = ['tree', 'flower', 'leaf', 'cloud', 'sun', 'moon', 'rainbow', 'snowflake', 'bolt', 'drops', 'grass', 'rock', 'log', 'mushroom', 'vehicle']; // (v326: and vehicles)
const KIT_KINDS = {
  tree: ['round', 'oak', 'pine', 'bush', 'palm', 'blossom', 'fruit', 'autumn'],
  flower: ['sunflower', 'daisy', 'tulip', 'rose', 'lily', 'lavender', 'blossom', 'hydrangea'],
  leaf: ['oval', 'maple', 'oak', 'ginkgo', 'fern', 'heart'],
  cloud: ['white', 'rain', 'storm', 'snow', 'grey'],
  rock: ['stone', 'mossy'], log: ['log', 'stump'], grass: ['grass', 'flowers'],
  get vehicle() { return VEH_KINDS; },
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
  if (KIT.includes(t)) return kitShape(s, mk); // (v324) a tree, a flower, a cloud...: drawn whole, in the guide's style
  return null;
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
  if (!zoom) controls.enableZoom = false; // (a model that floats over a page: the wheel still scrolls the page)
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
  // fit the camera to the whole model
  const box = new T.Box3().setFromObject(model), size = box.getSize(new T.Vector3()), mid = box.getCenter(new T.Vector3());
  model.position.sub(mid); model.updateMatrixWorld(true);
  const R = Math.max(size.x, size.y, size.z, 1);
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
  const flowGroup = new T.Group(); flowGroup.visible = false; model.add(flowGroup);
  const flow3 = (spec.flows || []).map((f) => {
    const curve = new T.CatmullRomCurve3(f.pts.map((q) => new T.Vector3(q[0], q[1], q[2])));
    const L = curve.getLength(); if (!(L > 0.01)) return null;
    flowGroup.add(new T.Mesh(new T.TubeGeometry(curve, 64, R * 0.006, 6, false), new T.MeshBasicMaterial({ color: new T.Color(f.color), transparent: true, opacity: 0.3, depthWrite: false })));
    const c0 = new T.Color(f.color), c1 = new T.Color(f.to || f.color), geo = new T.SphereGeometry(R * 0.016, 12, 8);
    const dots = Array.from({ length: f.dots }, (_, k) => { const m = new T.Mesh(geo, new T.MeshBasicMaterial({ color: c0.clone(), transparent: true, opacity: 1 })); flowGroup.add(m); return { m, u: k / f.dots }; });
    return { f, curve, L, c0, c1, dots };
  }).filter(Boolean);
  let moving3 = false, paused3 = false;
  const lay3 = () => flow3.forEach((x) => x.dots.forEach((d) => { d.m.position.copy(x.curve.getPointAt(Math.min(1, Math.max(0, d.u || 0)))); d.m.material.color.lerpColors(x.c0, x.c1, d.u); d.m.material.opacity = picked && x.f.of.length && !x.f.of.includes(picked.userData.part.id) ? 0.15 : 1; }));
  const order = groups.filter((g) => !g.userData.part.shell).sort((a, b) => a.userData.center.dot(ax) - b.userData.center.dot(ax));
  const tagEls = groups.map((g, i) => { const p = g.userData.part; if (!p.label) return null; const t = el('button', 'ld-tag', `${spec.parts.indexOf(p) + 1} ${p.label}`); t.type = 'button'; t.hidden = true; t.addEventListener('click', (e) => { e.stopPropagation(); pick(g); }); tags.appendChild(t); return t; });
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
  // a tap (not a drag) picks the part under the finger
  const ray = new T.Raycaster(), pt = new T.Vector2(); let down = null;
  canvas.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
  canvas.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return;
    const r = canvas.getBoundingClientRect(); pt.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(pt, cam);
    const hits = ray.intersectObjects(groups.filter((g) => g.visible && !(g.userData.part.shell && (opened || exploded))), true);
    let g = hits.length ? hits[0].object : null; while (g && !groups.includes(g)) g = g.parent;
    if (g) pick(g); else if (picked) pick(picked);
  });
  const tmp = new T.Vector3();
  const tick = (now) => {
    raf = requestAnimationFrame(tick);
    if (!visible) return;
    const dt = Math.min(.05, (now - last) / 1000); last = now;
    if ((!still() && !paused3) || moving3) groups.forEach((g) => { if (g.visible && g.userData.spinners) g.userData.spinners.forEach((sp) => { sp.rotation[sp.userData.axle] += dt * 3; }); });
    if (moving3) { // (v314) a beating part, and the dots on their way
      const beat = (now % 860) / 860, sq = beat < 0.18 ? Math.sin((beat / 0.18) * Math.PI) : 0, br = (Math.sin((now / 1700) * Math.PI) + 1) / 2;
      groups.forEach((g) => { const b = g.userData.beat; if (b) b.piv.scale.setScalar(b.kind === 'breathe' ? 1 + br * 0.04 : 1 - sq * 0.05); });
      const push = groups.some((g) => g.userData.beat && g.userData.beat.kind === 'beat') ? 1 + sq * 1.6 : 1;
      flow3.forEach((x) => x.dots.forEach((d) => { d.u = (d.u + (Math.max(0, dt) * x.f.speed * push * R * 0.28) / x.L) % 1; })); // (the first frame's clock can run a hair behind)
      lay3();
    }
    groups.forEach((g) => { const to = g.userData.to; if (to) { g.position.lerp(to, Math.min(1, dt * 6)); if (g.position.distanceTo(to) < .002) { g.position.copy(to); g.userData.to = null; } } });
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
  const ro = 'ResizeObserver' in window ? new ResizeObserver(() => { renderer.setSize(W(), H()); cam.aspect = W() / H(); cam.updateProjectionMatrix(); if (!exploded) { home.copy(VIEW).multiplyScalar(fitDist()); camTo = cam.position.clone().normalize().multiplyScalar(home.length()); } }) : null; if (ro) ro.observe(stage);
  const gone = new MutationObserver(() => { if (!stage.isConnected) { cancelAnimationFrame(raf); renderer.dispose(); io && io.disconnect(); ro && ro.disconnect(); gone.disconnect(); } });
  gone.observe(document.body, { childList: true, subtree: true });
  const byPart = (i) => groups.find((g) => g.userData.i === i) || null;
  const SIDES = { front: [0, .14, 1], back: [0, .14, -1], left: [-1, .14, .001], right: [1, .14, .001], side: [1, .14, .001], top: [.001, 1, .04] };
  const motion3 = flow3.length > 0 || groups.some((g) => g.userData.beat || g.userData.spinners);
  const view = {
    hintText,
    // (v314) moving parts: move() once it is built (move(true) even with Reduce Motion); pause() stops them
    motion: motion3,
    get moving() { return moving3; },
    move(force) { if (!motion3) return false; flowGroup.visible = flow3.length > 0; lay3(); if (still() && !force) return false; moving3 = true; paused3 = false; return true; },
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
        await setSay(g.userData.part.say || g.userData.part.label, true);
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
    explode: order.length > 1 ? () => {
      exploded = !exploded; if (picked) pick(picked);
      const gap = R * .22, n = order.length;
      order.forEach((g, k) => { g.userData.to = exploded ? g.userData.home.clone().addScaledVector(ax, (k - (n - 1) / 2) * gap) : g.userData.home.clone(); });
      shells.forEach((g) => { g.visible = !exploded; });
      // stand back to fit the pulled-apart model (from where the student is looking now)
      const spread = new T.Box3(); groups.forEach((g) => { if (!g.visible) return; const sc = g.scale.x; g.scale.setScalar(1); g.updateMatrixWorld(true); const b = new T.Box3().setFromObject(g); g.scale.setScalar(sc); g.updateMatrixWorld(true); if (g.userData.to) b.translate(g.userData.to.clone().sub(g.position)); spread.union(b); });
      const dir = cam.position.clone().normalize();
      camTo = dir.multiplyScalar(exploded && !spread.isEmpty() ? fitBox(spread, dir) : home.length());
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
const KIT3 = ['tree', 'flower', 'leaf', 'cloud', 'sun', 'moon', 'rainbow', 'rock', 'grass', 'log', 'mushroom', 'ground', 'drops', 'snowflake', 'bolt', 'vehicle']; // (v326: and vehicles)
const KIT3_KINDS = {
  tree: ['round', 'oak', 'pine', 'bush', 'palm', 'blossom', 'fruit', 'autumn', 'bare'],
  flower: ['sunflower', 'daisy', 'tulip', 'rose', 'lily', 'lavender', 'blossom', 'hydrangea'],
  leaf: ['oval', 'maple', 'heart'], cloud: ['white', 'grey', 'rain', 'storm', 'snow'],
  rock: ['stone', 'mossy'], log: ['log', 'stump'], grass: ['grass', 'flowers'], ground: ['grass', 'soil', 'sand', 'snow'],
  get vehicle() { return VEH_KINDS; },
};
// the box a kit model fills, from where it stands (for the model's checks and the camera)
function kit3Box(s, pos) {
  const t = String(s.t || '').toLowerCase(), h = Math.abs(n3(s.h ?? s.size, t === 'tree' ? 3 : 1)), w = Math.abs(n3(s.w ?? s.r ?? s.size, 1)), r = Math.abs(n3(s.r ?? s.size, 0.6));
  const [x, y, z] = pos, sq = (a, lo, hi) => [x - a, y + lo, z - a, x + a, y + hi, z + a];
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

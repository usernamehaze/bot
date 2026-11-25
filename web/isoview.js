// (v319) Machine view: Cassie's 3D model drawn the Anatomy way (github.com/wheresryan22/anatomy, MIT; its kit is in
// vendor/anatomy, unchanged): solid parts in paper colour with four-tone shading, painted back to front, a soft shadow
// under it, and the part you tap lit. It is the same model as the 3D view (the same spec), so it needs no WebGL: it
// shows on every phone, prints sharp, and turns and comes apart by rebuilding the drawing.
import * as K from './vendor/anatomy/iso-kit.mjs';
import * as G from './vendor/anatomy/lathe.mjs';
import { tubePieces, tubeSvg } from './vendor/anatomy/tube.mjs';

const S = 40; // world units per model unit (the kit's world is about 1 px a unit)
const W = 400, H = 300;
const num = (v, lo, hi, d) => { const n = +v; return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
// the 3D view's world (y up) to the kit's (x, y on the floor, z up), keeping it right-handed
const at = (p) => { const q = Array.isArray(p) ? p : [0, 0, 0]; return [num(q[0], -40, 40, 0) * S, -num(q[2], -40, 40, 0) * S, num(q[1], -40, 40, 0) * S]; };
const DIR = { x: [1, 0, 0], y: [0, 0, 1], z: [0, -1, 0] };
const axisOf = (s) => (['x', 'y', 'z'].includes(s.axis) ? s.axis : 'x');
const pts3 = (list) => (Array.isArray(list) ? list : []).slice(0, 10).filter((q) => Array.isArray(q) && q.length === 3 && q.every((v) => Number.isFinite(+v)));
const pts2 = (list) => (Array.isArray(list) ? list : []).slice(0, 24).filter((q) => Array.isArray(q) && q.length === 2 && q.every((v) => Number.isFinite(+v))).map((q) => [+q[0], +q[1]]);
const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];

// each shape as a list of pieces { mid: world point to depth-sort, svg(P, opts), ext: world points for the camera }
function piecesOf(s, off) {
  const t = String(s.t || s.type || '').toLowerCase(), ax = axisOf(s), a = DIR[ax];
  const c = add(at(s.pos), off), r = num(s.r, .02, 8, .5) * S, len = num(s.len ?? s.h, .02, 20, 1) * S;
  const round = (profile, from, extra = {}) => { const F = G.frameAlong(from, a); const ext = profile.flatMap(([q, rad]) => [add(add(from, a, q), F.u, rad), add(add(from, a, q), F.u, -rad), add(add(from, a, q), F.v, rad), add(add(from, a, q), F.v, -rad)]); return [{ mid: add(from, a, (profile[0][0] + profile[profile.length - 1][0]) / 2), ext, svg: (P, o) => K.solidSvg(G.solidOf(profile, F, P, extra), o) }]; };
  if (t === 'cylinder' || t === 'tube' || t === 'disc') {
    const h = t === 'disc' ? num(s.thick ?? s.len, .01, 2, .08) * S : len, r2 = num(s.r2, .02, 8, r / S) * S;
    return round([[0, r], [h, r2]], add(c, a, -h / 2));
  }
  if (t === 'cone') { // (the tip points along the axis; "dir": -1 the other way)
    const d = s.dir === -1 ? a.map((v) => -v) : a, from = add(c, d, -len / 2), F = G.frameAlong(from, d);
    return [{ mid: c, ext: [from, add(from, d, len), add(from, F.u, r), add(from, F.u, -r), add(from, F.v, r), add(from, F.v, -r)], svg: (P, o) => K.solidSvg(G.solidOf([[0, r], [len, .001]], F, P), o) }];
  }
  if (t === 'sphere') return [{ mid: c, ext: [add(c, [r, r, r]), add(c, [-r, -r, -r])], svg: (P, o) => K.solidSvg(G.sphereOf(c, r, P), o) }];
  if (t === 'capsule') {
    const prof = [];
    for (let j = 1; j <= 8; j++) { const th = j / 8 * Math.PI / 2; prof.push([r - r * Math.cos(th), r * Math.sin(th), 1]); }
    for (let j = 7; j >= 1; j--) { const th = j / 8 * Math.PI / 2; prof.push([r + len + r * Math.cos(th), r * Math.sin(th), 1]); }
    return round(prof, add(c, a, -(len / 2 + r)));
  }
  if (t === 'lathe') {
    const pr = pts2(s.profile).map(([rad, al]) => [al * S, Math.max(.4, Math.abs(rad) * S)]).sort((p, q) => p[0] - q[0]);
    if (pr.length < 2 || pr[pr.length - 1][0] - pr[0][0] < .5) return [];
    return round(pr.map((p, i) => (i > 0 && i < pr.length - 1 ? [p[0], p[1], 1] : p)), c);
  }
  if (t === 'box') {
    const sz = Array.isArray(s.size) ? s.size : [1, 1, 1], w = num(sz[0], .02, 20, 1) * S, hh = num(sz[1], .02, 20, 1) * S, d = num(sz[2], .02, 20, 1) * S;
    const plan = { x: c[0] - w / 2, y: c[1] - d / 2, w, d, r: Math.min(w, d) * .06 };
    return [{ mid: c, ext: K.boxCorners(plan, c[2] - hh / 2, c[2] + hh / 2), svg: (P, o) => K.solidSvg(K.slabOf(plan, c[2] - hh / 2, hh, P, 3, Math.min(1.2, Math.min(w, d, hh) * .04)), o) }];
  }
  if (t === 'plate') {
    const pr = pts2(s.outline).map(([p, q]) => [p * S, q * S]), th = num(s.thick, .01, 4, .1) * S;
    if (pr.length < 3) return [];
    // the plate's own axes (as the 3D view lays it): z: outline in x, y; y: outline in x, z; x: outline in z, y
    const [u, v, n] = ax === 'z' ? [DIR.x, DIR.y, DIR.z] : ax === 'y' ? [DIR.x, DIR.z, DIR.y.map((k) => -k)] : [DIR.z, DIR.y, DIR.x.map((k) => -k)];
    const F = G.frameOf(c, n, u, v), hull = G.hullOf(pr);
    const ext = hull.flatMap(([p, q]) => [add(add(add(c, u, p), v, q), n, th / 2), add(add(add(c, u, p), v, q), n, -th / 2)]);
    return [{ mid: c, ext, svg: (P, o) => K.solidSvg(G.prismOf(F, hull, -th / 2, th / 2, P), o) }];
  }
  if (t === 'torus' || t === 'ring') {
    const F = G.frameAlong(c, a), tb = num(s.tube, .01, 4, .12) * S;
    const ring = G.arcPoints(F, 0, r, 0, Math.PI * 2, 48);
    return [{ mid: c, ext: ring.flatMap((q) => [add(q, a, tb), add(q, a, -tb)]), tube: [ring, tb, true] }];
  }
  if (t === 'blades') {
    const n = Math.round(num(s.n ?? s.count, 2, 40, 12)), bl = num(s.len, .05, 8, r / S) * S, wd = num(s.width, .02, 2, .18) * S, hub = num(s.hub, 0, 4, .12) * S;
    const F0 = G.frameAlong(c, a), out = [];
    for (let i = 0; i < n; i++) {
      const ph = i / n * Math.PI * 2, rad = add(F0.u.map((k) => k * Math.cos(ph)), F0.v.map((k) => k * Math.sin(ph))), side = G.cross3(rad, a);
      const F = G.frameOf(c, rad, a, side), poly = [[-wd / 2, -.8], [wd / 2, -.8], [wd / 2, .8], [-wd / 2, .8]];
      out.push({ mid: add(c, rad, hub + bl / 2), ext: [add(c, rad, hub + bl), add(c, rad, hub)], svg: (P, o) => K.solidSvg(G.prismOf(F, poly, hub, hub + bl, P), o) });
    }
    return out;
  }
  if (t === 'pipe' || t === 'arrow') {
    const w = num(s.r, .01, 2, .06) * S, route = pts3(s.pts).map((q) => add(add(at(q), at(s.pos)), off)); // (a pipe's points are from its own "pos")
    if (route.length < 2) return [];
    const out = [{ mid: route[0], ext: route, tube: [route, w, false] }];
    if (t === 'arrow') { const tip = route[route.length - 1], dir = G.unit3(G.sub3(tip, route[route.length - 2])), hl = w * 7; out.push({ mid: tip, ext: [add(tip, dir, hl)], svg: (P, o) => K.solidSvg(G.solidOf([[0, w * 2.8], [hl, .001]], G.frameAlong(tip, dir), P), o) }); }
    return out;
  }
  return [];
}

// the whole drawing at this turn, with these parts pulled apart, this part lit
function build(spec, { turn = 0, apart = false, lit = -1, dark = true } = {}) {
  const parts = spec.parts || [], n = parts.length, mainAx = DIR[['x', 'y', 'z'].includes(spec.axis) ? spec.axis : 'x'];
  const shells = new Set(parts.map((p, i) => (p.shell ? i : -1)).filter((i) => i >= 0));
  const all = [];
  parts.forEach((p, i) => {
    if (apart && shells.has(i)) return; // (pulled apart: the case is set aside, as in the 3D view)
    const k = apart ? (i - (n - 1) / 2) * 70 : 0, off = mainAx.map((v) => v * k);
    for (const s of p.shapes || []) for (const pc of piecesOf(s, off)) all.push({ ...pc, i });
  });
  const ext = all.flatMap((x) => x.ext || [x.mid]);
  if (!ext.length) return null;
  const P = K.fitProjection(ext, W, H, { pad: 26, azimuth: 45 + turn });
  // the pipes and rings are split into chunks now the camera is known, so each chunk sorts on its own
  const items = [];
  for (const x of all) {
    if (x.tube) { for (const pc of tubePieces(x.tube[0], x.tube[1], P, { closed: x.tube[2], maxLength: x.tube[2] ? 40 : 16 })) items.push({ i: x.i, mid: pc.mid, ext: pc.points, draw: (o) => tubeSvg(pc, { tone: o.tone }) }); continue; }
    items.push({ i: x.i, mid: x.mid, ext: x.ext, draw: (o) => x.svg(P, o) });
  }
  // back to front, bottom to top: each piece by its farthest point (a big base under a small part is painted first),
  // then by its nearest (the kit's own order for figures this simple; the full audit belongs to hand-built figures)
  const far = (it) => Math.min(...(it.ext && it.ext.length ? it.ext : [it.mid]).map((q) => K.depthOf(q, P)));
  const near = (it) => Math.max(...(it.ext && it.ext.length ? it.ext : [it.mid]).map((q) => K.depthOf(q, P)));
  items.forEach((it) => { it.k0 = far(it); it.k1 = near(it); });
  items.sort((p, q) => p.k0 - q.k0 || p.k1 - q.k1);
  const lo = Math.min(...ext.map((q) => q[2])), xs = ext.map((q) => q[0]), ys = ext.map((q) => q[1]);
  const halo = K.haloOf({ x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), d: Math.max(...ys) - Math.min(...ys), r: 30 }, lo, 1, P);
  const body = `<path class="iso-halo" d="${halo}"/>` + items.map((it) => {
    const shell = shells.has(it.i), on = it.i === lit;
    return `<g class="iv-part${shell ? ' iv-shell' : ''}" data-part="${it.i}">${it.draw({ tone: on ? 'hi' : shell ? 'lo' : 'hi', lit: on, crease: 'faint' })}</g>`;
  }).join('');
  return K.figureSvg({ width: W, height: H, label: `${spec.title}: ${parts.map((p) => p.label).filter(Boolean).join(', ')}`, body, className: 'iv-svg' });
}

const CSS = `.iv{border-radius:14px;overflow:hidden;background:var(--anatomy-card);padding:10px 10px 6px}
.iv .iv-shell{opacity:.38}.iv .iv-part{cursor:pointer}.iv .iv-part:focus{outline:none}
.iv-cap{display:flex;justify-content:space-between;gap:8px;font:12px/1.4 var(--anatomy-mono);color:var(--anatomy-muted);padding:2px 4px 6px}
.iv-cap b{color:var(--anatomy-strong);font-weight:600}
.iv-read{font:13px/1.45 system-ui,sans-serif;color:var(--anatomy-text);min-height:2.9em;padding:6px 4px 2px;margin:0}`;

// put Machine view in `host`: { turn(by), apart(), pick(i), el }
export function machine(host, spec, { dark = true } = {}) {
  if (!spec || !Array.isArray(spec.parts) || !spec.parts.length) return null;
  const box = document.createElement('div');
  box.className = 'iso iv'; if (!dark) box.dataset.theme = 'light';
  box.innerHTML = `<style>${K.ISO_CSS}${CSS}</style><div class="iv-cap"><span>Fig. machine view</span><b></b></div><div class="iv-fig"></div><p class="iv-read" aria-live="polite"></p>`;
  box.querySelector('.iv-cap b').textContent = spec.title || '';
  const fig = box.querySelector('.iv-fig'), read = box.querySelector('.iv-read');
  const st = { turn: 0, apart: false, lit: -1 };
  const say = () => { const p = spec.parts[st.lit]; read.textContent = p ? `${st.lit + 1}. ${p.label}: ${p.say || ''}` : (spec.summary || spec.intro || 'Tap a part to see what it does.'); };
  const draw = () => { const svg = build(spec, { ...st, dark }); if (svg) fig.innerHTML = svg; say(); };
  fig.addEventListener('click', (e) => { const g = e.target.closest('[data-part]'); st.lit = g && +g.dataset.part !== st.lit ? +g.dataset.part : -1; draw(); });
  host.appendChild(box);
  draw();
  return {
    el: box,
    turn(by) { st.turn = (st.turn + by) % 360; draw(); },
    apart() { st.apart = !st.apart; draw(); return st.apart; },
    pick(i) { st.lit = i; draw(); },
    get state() { return { ...st }; },
  };
}
export { build as machineSvg };

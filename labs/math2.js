/* More math labs: vectors (in the plane and in space), 3D solids with their volume and
   surface area, and sequences built by recursion (with the Python that makes them). */
import { INK, DIM, FAINT, GRID, C, el, esc, num, canvas, drag, clock, group, slider, seg, button, row, stats, stepper, line, dot, text, arrow, overlay } from './kit.js';

/* ---------------- Vectors ---------------- */
const vectorLab = {
  id: 'vectors', name: 'Vectors', subject: 'math', topic: 'vectors: adding and subtracting, magnitude, dot product, cross product and the angle between vectors',
  blurb: 'Drag two vectors and watch their sum, difference, dot product, angle and cross product — in 2D or 3D.',
  words: 'vector addition subtraction dot product cross product magnitude angle components physics',
  icon: '<path d="M8 40L22 14M8 40l30-8M22 14l16 18" /><path d="M22 14l-5 2M22 14l1 5M38 32l-4-4M38 32l-5 1"/>',
  tries: ['Make a and b perpendicular (a · b = 0)', 'Make a + b point straight up', 'In 3D, make a × b point straight along the z-axis'],
  hints: ['Perpendicular means a right angle between them. Try a = (3, 0) and b = (0, 2) — then try a tilted pair.', 'Straight up means the x part of a + b is 0: the x parts of a and b must cancel.', 'In 3D, keep both vectors flat in the x–y plane (z = 0). Their cross product is then perpendicular to that plane.'],
  about: 'Vectors are drawn to scale on a grid. Their heads snap to whole numbers so the arithmetic is easy to check.\na + b adds the parts: (a₁ + b₁, a₂ + b₂). The dot product a · b = a₁b₁ + a₂b₂ (+ a₃b₃ in 3D) = |a||b| cos θ, so it is 0 exactly when the vectors are perpendicular.\nThe cross product a × b (3D) is perpendicular to both, with length |a||b| sin θ — the area of the parallelogram they make. Its direction follows the right-hand rule. In 2D only its z part (a₁b₂ − a₂b₁) is shown.',
  mount({ stage, panel, api }) {
    let dim = 2, a = [4, 2, 0], b = [1, 4, 0], show = { sum: true, diff: false, proj: false };
    let yaw = -0.6, pitch = 0.45, S = 30, O = [0, 0], held = null;
    const dotp = () => a[0] * b[0] + a[1] * b[1] + (dim === 3 ? a[2] * b[2] : 0);
    const mag = (v) => Math.hypot(v[0], v[1], dim === 3 ? v[2] : 0);
    const cross = () => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const angle = () => { const m = mag(a) * mag(b); return m ? (Math.acos(Math.max(-1, Math.min(1, dotp() / m))) * 180) / Math.PI : 0; };
    // 3D → screen (a simple turntable view)
    const P3 = (v) => { const [x, y, z] = v, cx = x * Math.cos(yaw) - y * Math.sin(yaw), cy = x * Math.sin(yaw) + y * Math.cos(yaw); return [O[0] + cx * S, O[1] - (z * Math.cos(pitch) - cy * Math.sin(pitch)) * S]; };
    const P = (v) => (dim === 2 ? [O[0] + v[0] * S, O[1] - v[1] * S] : P3(v));
    const cv = canvas(stage, (ctx, w, h) => {
      O = [w / 2, h / 2 + (dim === 3 ? 30 : 0)]; S = Math.min(w, h) / (dim === 2 ? 18 : 16);
      if (dim === 2) {
        for (let x = -12; x <= 12; x++) line(ctx, [P([x, -12]), P([x, 12])], x ? GRID : FAINT, 1);
        for (let y = -12; y <= 12; y++) line(ctx, [P([-12, y]), P([12, y])], y ? GRID : FAINT, 1);
        for (let k = -8; k <= 8; k += 2) if (k) { text(ctx, String(k), ...P([k, -0.6]), DIM, 'center'); text(ctx, String(k), ...P([-0.6, k]).map((q, i) => q + (i ? 4 : 0)), DIM, 'right'); }
      } else {
        [[[-8, 0, 0], [8, 0, 0], 'x'], [[0, -8, 0], [0, 8, 0], 'y'], [[0, 0, -2], [0, 0, 8], 'z']].forEach(([p1, p2, n]) => { line(ctx, [P(p1), P(p2)], FAINT, 1); text(ctx, n, ...P(p2), DIM, 'center'); });
        for (let k = -6; k <= 6; k += 2) { line(ctx, [P([k, -6, 0]), P([k, 6, 0])], GRID, 1); line(ctx, [P([-6, k, 0]), P([6, k, 0])], GRID, 1); }
      }
      const o = P([0, 0, 0]), s = [a[0] + b[0], a[1] + b[1], a[2] + b[2]], d = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
      if (show.sum) { ctx.setLineDash([5, 5]); line(ctx, [P(a), P(s)], FAINT, 1.3); line(ctx, [P(b), P(s)], FAINT, 1.3); ctx.setLineDash([]); arrow(ctx, ...o, ...P(s), C.green, 2.5); text(ctx, 'a + b', ...P(s).map((q, i) => q + (i ? -8 : 8)), C.green); }
      if (show.diff) { arrow(ctx, ...P(b), ...P(a), C.violet, 2); text(ctx, 'a − b', (P(a)[0] + P(b)[0]) / 2 + 8, (P(a)[1] + P(b)[1]) / 2, C.violet); }
      if (show.proj && mag(b)) { const k = dotp() / (mag(b) ** 2), pr = b.map((x) => x * k); ctx.setLineDash([3, 4]); line(ctx, [P(a), P(pr)], DIM, 1); ctx.setLineDash([]); arrow(ctx, ...o, ...P(pr), C.teal, 3); text(ctx, 'projection of a on b', ...P(pr).map((q, i) => q + (i ? 16 : 6)), C.teal); }
      if (dim === 3) { const c = cross(), sc = Math.min(1, 7 / Math.max(1, mag(c))); arrow(ctx, ...o, ...P(c.map((x) => x * sc)), C.red, 2.5); text(ctx, sc < 1 ? 'a × b (shortened)' : 'a × b', ...P(c.map((x) => x * sc)).map((q, i) => q + (i ? -8 : 8)), C.red); }
      arrow(ctx, ...o, ...P(a), C.gold, 3); arrow(ctx, ...o, ...P(b), C.blue, 3);
      dot(ctx, ...P(a), 7, C.gold); dot(ctx, ...P(b), 7, C.blue);
      text(ctx, `a (${a.slice(0, dim).join(', ')})`, ...P(a).map((q, i) => q + (i ? -12 : 10)), C.gold);
      text(ctx, `b (${b.slice(0, dim).join(', ')})`, ...P(b).map((q, i) => q + (i ? -12 : 10)), C.blue);
      // the angle between them (2D)
      if (dim === 2 && mag(a) && mag(b)) {
        const t1 = Math.atan2(-a[1], a[0]), t2 = Math.atan2(-b[1], b[0]);
        let d = t2 - t1; while (d > Math.PI) d -= 2 * Math.PI; while (d <= -Math.PI) d += 2 * Math.PI; // the short way round
        ctx.strokeStyle = INK; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(...o, 26, t1, t1 + d, d < 0); ctx.stroke();
        text(ctx, `${num(angle())}°`, o[0] + Math.cos(t1 + d / 2) * 42, o[1] + Math.sin(t1 + d / 2) * 42 + 4, INK, 'center');
      }
    });
    // drag the heads (2D); in 3D drag the empty space to turn the view
    let last = null;
    drag(cv.c, {
      down(p) {
        last = p; held = null;
        if (dim === 2) { const da = Math.hypot(p.x - P(a)[0], p.y - P(a)[1]), db = Math.hypot(p.x - P(b)[0], p.y - P(b)[1]); held = da < db ? (da < 40 ? a : null) : (db < 40 ? b : null); if (!held) held = da < db ? a : b; move(p); }
      },
      move,
    });
    function move(p) {
      if (dim === 2 && held) { held[0] = Math.max(-8, Math.min(8, Math.round((p.x - O[0]) / S))); held[1] = Math.max(-8, Math.min(8, Math.round((O[1] - p.y) / S))); sync(); }
      else if (dim === 3 && last) { yaw += (p.x - last.x) * 0.01; pitch = Math.max(-0.2, Math.min(1.4, pitch + (p.y - last.y) * 0.01)); last = p; cv.redraw(); }
    }
    seg(group(panel, 'Space'), { options: [[2, '2D (flat)'], [3, '3D']], value: dim, onChange: (v) => { dim = +v; if (dim === 2) { a[2] = 0; b[2] = 0; } build(); sync(); } });
    const box = el('div'); panel.appendChild(box);
    let sl = [];
    function build() {
      box.replaceChildren(); sl = [];
      const ga = group(box, 'a'), gb = group(box, 'b');
      ['x', 'y', 'z'].slice(0, dim).forEach((n, i) => {
        sl.push(['a', i, slider(ga, { label: `a ${n}`, min: -8, max: 8, value: a[i], onInput: (v) => { a[i] = v; sync(true); } })]);
        sl.push(['b', i, slider(gb, { label: `b ${n}`, min: -8, max: 8, value: b[i], onInput: (v) => { b[i] = v; sync(true); } })]);
      });
      const tg = row(group(box, 'Show'), 'lab-toggles');
      [['sum', 'a + b', C.green], ['diff', 'a − b', C.violet], ['proj', 'Projection of a on b', C.teal]].forEach(([k, label, col]) => {
        const bt = button(tg, '', () => { show[k] = !show[k]; bt.setAttribute('aria-pressed', String(show[k])); cv.redraw(); }, 'toggle');
        bt.innerHTML = `<span class="lab-key" style="background:${col}"></span>${esc(label)}`; bt.setAttribute('aria-pressed', String(show[k]));
      });
      box.appendChild(el('p', 'lab-note', dim === 2 ? 'Drag the dot at the tip of a or b.' : 'Use the sliders to set the vectors; drag the picture to turn it.'));
    }
    function sync(fromSliders) {
      if (!fromSliders) sl.forEach(([n, i, s]) => s.set((n === 'a' ? a : b)[i]));
      const d = dotp(), c = cross(), f = (v) => `(${v.slice(0, dim).join(', ')})`;
      st.set([['|a|', num(mag(a))], ['|b|', num(mag(b))], ['a + b', f([a[0] + b[0], a[1] + b[1], a[2] + b[2]])], ['a − b', f([a[0] - b[0], a[1] - b[1], a[2] - b[2]])], ['a · b', `${d}${d === 0 && mag(a) && mag(b) ? ' — perpendicular!' : ''}`], ['Angle between', `${num(angle())}°`], [dim === 3 ? 'a × b' : 'a × b (z part)', dim === 3 ? `(${c.join(', ')}), length ${num(Math.hypot(...c))}` : `${c[2]} = area of the parallelogram`]]);
      if (d === 0 && mag(a) && mag(b)) api.check(0);
      const s = [a[0] + b[0], a[1] + b[1]]; if (dim === 2 && s[0] === 0 && s[1] > 0) api.check(1);
      if (dim === 3 && c[0] === 0 && c[1] === 0 && c[2] !== 0) api.check(2);
      cv.redraw();
    }
    const st = stats(panel);
    build(); sync();
    return { state: () => `${dim}D vectors a = (${a.slice(0, dim).join(', ')}) and b = (${b.slice(0, dim).join(', ')}): a · b = ${dotp()}, angle ${num(angle())}°, a × b = ${dim === 3 ? `(${cross().join(', ')})` : cross()[2]}`, destroy: () => cv.destroy() };
  },
};

/* ---------------- 3D solids ---------------- */
// each shape: its measurements, its formulas, and its surface as triangles
const SOLIDS = {
  cube: { name: 'Cube', dims: [['Side a', 4]], V: ([a]) => a ** 3, A: ([a]) => 6 * a * a, fV: 'a³', fA: '6a²' },
  cuboid: { name: 'Cuboid', dims: [['Length l', 6], ['Width w', 3], ['Height h', 4]], V: ([l, w, h]) => l * w * h, A: ([l, w, h]) => 2 * (l * w + l * h + w * h), fV: 'l × w × h', fA: '2(lw + lh + wh)' },
  sphere: { name: 'Sphere', dims: [['Radius r', 3]], V: ([r]) => (4 / 3) * Math.PI * r ** 3, A: ([r]) => 4 * Math.PI * r * r, fV: '4⁄3 π r³', fA: '4 π r²' },
  cylinder: { name: 'Cylinder', dims: [['Radius r', 2], ['Height h', 6]], V: ([r, h]) => Math.PI * r * r * h, A: ([r, h]) => 2 * Math.PI * r * (r + h), fV: 'π r² h', fA: '2πr² + 2πrh' },
  cone: { name: 'Cone', dims: [['Radius r', 3], ['Height h', 6]], V: ([r, h]) => (Math.PI * r * r * h) / 3, A: ([r, h]) => Math.PI * r * (r + Math.hypot(r, h)), fV: '1⁄3 π r² h', fA: 'πr² + πr·√(r² + h²)' },
  pyramid: { name: 'Square pyramid', dims: [['Base side a', 5], ['Height h', 6]], V: ([a, h]) => (a * a * h) / 3, A: ([a, h]) => a * a + 2 * a * Math.hypot(a / 2, h), fV: '1⁄3 a² h', fA: 'a² + 2a·√((a/2)² + h²)' },
  prism: { name: 'Triangular prism', dims: [['Triangle side a', 4], ['Length l', 7]], V: ([a, l]) => ((Math.sqrt(3) / 4) * a * a) * l, A: ([a, l]) => 2 * (Math.sqrt(3) / 4) * a * a + 3 * a * l, fV: '(√3⁄4 a²) × l', fA: '2 × √3⁄4 a² + 3al' },
  hexprism: { name: 'Hexagonal prism', dims: [['Side a', 2.5], ['Length l', 6]], V: ([a, l]) => ((3 * Math.sqrt(3)) / 2) * a * a * l, A: ([a, l]) => 3 * Math.sqrt(3) * a * a + 6 * a * l, fV: '(3√3⁄2 a²) × l', fA: '3√3 a² + 6al' },
  hemisphere: { name: 'Hemisphere', dims: [['Radius r', 3]], V: ([r]) => (2 / 3) * Math.PI * r ** 3, A: ([r]) => 3 * Math.PI * r * r, fV: '2⁄3 π r³', fA: '2πr² (dome) + πr² (base) = 3πr²' },
  frustum: { name: 'Frustum (cut cone)', dims: [['Bottom radius R', 4], ['Top radius r', 2], ['Height h', 5]], V: ([R, r, h]) => (Math.PI * h * (R * R + R * r + r * r)) / 3, A: ([R, r, h]) => Math.PI * (R + r) * Math.hypot(R - r, h) + Math.PI * (R * R + r * r), fV: '1⁄3 π h (R² + Rr + r²)', fA: 'π(R + r)·√((R − r)² + h²) + πR² + πr²' },
  tetrahedron: { name: 'Tetrahedron', dims: [['Edge a', 5]], V: ([a]) => a ** 3 / (6 * Math.SQRT2), A: ([a]) => Math.sqrt(3) * a * a, fV: 'a³ ⁄ (6√2)', fA: '√3 a²' },
  octahedron: { name: 'Octahedron', dims: [['Edge a', 4]], V: ([a]) => (Math.SQRT2 / 3) * a ** 3, A: ([a]) => 2 * Math.sqrt(3) * a * a, fV: '√2⁄3 a³', fA: '2√3 a²' },
  torus: { name: 'Torus (ring)', dims: [['Ring radius R', 4], ['Tube radius r', 1.5]], V: ([R, r]) => 2 * Math.PI * Math.PI * R * r * r, A: ([R, r]) => 4 * Math.PI * Math.PI * R * r, fV: '2π² R r²', fA: '4π² R r' },
};
function meshOf(kind, d) {
  const T = [], quad = (p, q, r, s) => { T.push([p, q, r], [p, r, s]); }, N = 28;
  const ring = (rad, z) => Array.from({ length: N }, (_, i) => [rad * Math.cos((i / N) * Math.PI * 2), rad * Math.sin((i / N) * Math.PI * 2), z]);
  if (kind === 'cube' || kind === 'cuboid') {
    const [l, w, h] = kind === 'cube' ? [d[0], d[0], d[0]] : d, x = l / 2, y = w / 2, z = h / 2;
    const v = [[-x, -y, -z], [x, -y, -z], [x, y, -z], [-x, y, -z], [-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z]];
    [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]].forEach(([p, q, r, s]) => quad(v[p], v[q], v[r], v[s]));
  } else if (kind === 'sphere') {
    const r = d[0], M = 16;
    for (let i = 0; i < M; i++) for (let j = 0; j < N; j++) {
      const P = (ii, jj) => { const t = (ii / M) * Math.PI, p = (jj / N) * Math.PI * 2; return [r * Math.sin(t) * Math.cos(p), r * Math.sin(t) * Math.sin(p), r * Math.cos(t)]; };
      quad(P(i, j), P(i, j + 1), P(i + 1, j + 1), P(i + 1, j));
    }
  } else if (kind === 'cylinder' || kind === 'cone') {
    const [r, h] = d, bot = ring(r, -h / 2), top = kind === 'cylinder' ? ring(r, h / 2) : null, apex = [0, 0, h / 2];
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      if (top) quad(bot[i], bot[j], top[j], top[i]); else T.push([bot[i], bot[j], apex]);
      T.push([[0, 0, -h / 2], bot[j], bot[i]]);
      if (top) T.push([[0, 0, h / 2], top[i], top[j]]);
    }
  } else if (kind === 'pyramid') {
    const [a, h] = d, s = a / 2, v = [[-s, -s, -h / 3], [s, -s, -h / 3], [s, s, -h / 3], [-s, s, -h / 3]], apex = [0, 0, (2 * h) / 3];
    quad(v[0], v[3], v[2], v[1]); for (let i = 0; i < 4; i++) T.push([v[i], v[(i + 1) % 4], apex]);
  } else if (kind === 'prism' || kind === 'hexprism') {
    const [a, l] = d, k0 = kind === 'prism' ? 3 : 6, R = kind === 'prism' ? a / Math.sqrt(3) : a, poly = (z) => Array.from({ length: k0 }, (_, k) => [R * Math.cos(-Math.PI / 2 + (k * 2 * Math.PI) / k0), R * Math.sin(-Math.PI / 2 + (k * 2 * Math.PI) / k0), z]);
    const A = poly(-l / 2), B = poly(l / 2);
    for (let k = 1; k < k0 - 1; k++) T.push([A[0], A[k + 1], A[k]], [B[0], B[k], B[k + 1]]);
    for (let k = 0; k < k0; k++) quad(A[k], A[(k + 1) % k0], B[(k + 1) % k0], B[k]);
  } else if (kind === 'hemisphere') {
    const r = d[0], M = 8, z0 = -r * 3 / 8; // (centred on its centre of mass)
    for (let i = 0; i < M; i++) for (let j = 0; j < N; j++) {
      const P = (ii, jj) => { const t = (ii / M) * Math.PI / 2, p = (jj / N) * Math.PI * 2; return [r * Math.sin(t) * Math.cos(p), r * Math.sin(t) * Math.sin(p), z0 + r * Math.cos(t)]; };
      quad(P(i, j), P(i, j + 1), P(i + 1, j + 1), P(i + 1, j));
    }
    const base = ring(r, z0); for (let i = 0; i < N; i++) T.push([[0, 0, z0], base[(i + 1) % N], base[i]]);
  } else if (kind === 'frustum') {
    const [R, r, h] = d, bot = ring(R, -h / 2), top = ring(r, h / 2);
    for (let i = 0; i < N; i++) { const j = (i + 1) % N; quad(bot[i], bot[j], top[j], top[i]); T.push([[0, 0, -h / 2], bot[j], bot[i]], [[0, 0, h / 2], top[i], top[j]]); }
  } else if (kind === 'tetrahedron') {
    const k = d[0] / (2 * Math.SQRT2), v = [[k, k, k], [k, -k, -k], [-k, k, -k], [-k, -k, k]];
    [[0, 1, 2], [0, 3, 1], [0, 2, 3], [1, 3, 2]].forEach(([p, q, r]) => T.push([v[p], v[q], v[r]]));
  } else if (kind === 'octahedron') {
    const k = d[0] / Math.SQRT2, v = [[k, 0, 0], [-k, 0, 0], [0, k, 0], [0, -k, 0], [0, 0, k], [0, 0, -k]];
    for (const z of [4, 5]) for (const [p, q] of [[0, 2], [2, 1], [1, 3], [3, 0]]) T.push([v[p], v[q], v[z]]);
  } else if (kind === 'torus') {
    const [R, r] = d, M = 16;
    const P = (i, j) => { const u = (i / N) * Math.PI * 2, w = (j / M) * Math.PI * 2; return [(R + r * Math.cos(w)) * Math.cos(u), (R + r * Math.cos(w)) * Math.sin(u), r * Math.sin(w)]; };
    for (let i = 0; i < N; i++) for (let j = 0; j < M; j++) quad(P(i, j), P(i + 1, j), P(i + 1, j + 1), P(i, j + 1));
  }
  return T;
}
const solidsLab = {
  id: 'solids', name: '3D shapes', subject: 'math', topic: 'volume and surface area of 3D solids: cubes, cuboids, spheres, cylinders, cones, pyramids and prisms',
  blurb: 'Turn 13 solids — cubes, spheres, cones, prisms, a torus… Make them any size and watch volume and surface area change.',
  words: 'volume surface area 3d solids geometry cube sphere cylinder cone pyramid prism cuboid',
  icon: '<path d="M24 6l16 9v18l-16 9-16-9V15z"/><path d="M8 15l16 9 16-9M24 24v18"/>',
  tries: ['Make a cube with a volume of exactly 64 cm³', 'Double a cube’s side — what happens to its volume?', 'Compare shapes with the same volume: which has the least surface?'],
  hints: ['A cube’s volume is a × a × a. Which whole number cubed is 64?', 'Note the volume, double the side, and divide the new volume by the old one.', 'Choose “Same volume” and compare the surface areas of the cube, cylinder and sphere.'],
  about: 'Formulas are the exact ones, worked out with π to many decimal places; answers are rounded to 3 significant figures. Lengths are in the unit you pick (mm, cm, m or inches), areas in that unit squared and volumes in that unit cubed. Slide from 0.1 to 100 or type any size up to 10,000.\nThe 3D pictures are drawn to scale. Curved shapes are drawn with flat facets (like a disco ball), but the numbers use the true curved formulas.\nIn “Same volume” the cylinder is as tall as it is wide (h = 2r) and every shape holds exactly the same volume; the sphere always needs the least surface — that is why bubbles and raindrops are round.',
  mount({ stage, panel, api }) {
    let kind = 'cube', dims = Object.fromEntries(Object.entries(SOLIDS).map(([k, s]) => [k, s.dims.map((x) => x[1])])), same = false, Vsame = 100, unit = 'cm';
    let yaw = 0.6, pitch = 0.5, auto = true, cubeVols = [];
    function sameDims() {
      const V = Vsame;
      return { cube: [Math.cbrt(V)], sphere: [Math.cbrt((3 * V) / (4 * Math.PI))], cylinder: [Math.cbrt(V / (2 * Math.PI)), 2 * Math.cbrt(V / (2 * Math.PI))] };
    }
    function drawSolid(ctx, k, d, cx, cy, scale, label) {
      const T = meshOf(k, d), light = [0.4, -0.5, 0.75], L = Math.hypot(...light);
      const rot = ([x, y, z]) => { const X = x * Math.cos(yaw) - y * Math.sin(yaw), Y = x * Math.sin(yaw) + y * Math.cos(yaw); return [X, Y * Math.cos(pitch) - z * Math.sin(pitch), Y * Math.sin(pitch) + z * Math.cos(pitch)]; };
      const faces = T.map((t) => { const r = t.map(rot), u = r[1].map((v, i) => v - r[0][i]), v = r[2].map((q, i) => q - r[0][i]); const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]; return { r, n, z: (r[0][1] + r[1][1] + r[2][1]) / 3 }; });
      faces.sort((p, q) => q.z - p.z);
      for (const f of faces) {
        const nl = Math.hypot(...f.n) || 1, sh = Math.max(0.18, Math.abs((f.n[0] * light[0] + f.n[1] * light[1] + f.n[2] * light[2]) / (nl * L)));
        const c = Math.round(80 + 150 * sh);
        ctx.fillStyle = `rgb(${c},${Math.round(c * 0.86)},${Math.round(c * 0.55)})`;
        ctx.beginPath(); f.r.forEach(([x, , z], i) => (i ? ctx.lineTo(cx + x * scale, cy - z * scale) : ctx.moveTo(cx + x * scale, cy - z * scale))); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 0.8; ctx.stroke(); // (hides the seams between the triangles)
      }
      if (label) text(ctx, label, cx, cy + scale * 4.6, INK, 'center');
    }
    const cv = canvas(stage, (ctx, w, h) => {
      if (!same) {
        // to scale: a bigger shape fills more of the picture (the grey bar is a ruler)
        const d = dims[kind], ext = Math.max(...meshOf(kind, d).flat().map((v) => Math.hypot(...v))), size = ext * 2.4 + 2, sc = Math.min(w, h) / (size * 1.25);
        drawSolid(ctx, kind, d, w / 2, h / 2, sc);
        const nice = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500].find((x) => x * sc > 50) || 1000;
        line(ctx, [[16, h - 18], [16 + nice * sc, h - 18]], DIM, 3); text(ctx, `${nice} ${unit}`, 16 + (nice * sc) / 2, h - 26, DIM, 'center');
      } else {
        const sd = sameDims(), sc = Math.min(w / 3, h) / (Math.cbrt(Vsame) * 3.2);
        [['cube', w / 6], ['cylinder', w / 2], ['sphere', (5 * w) / 6]].forEach(([k, x]) => {
          drawSolid(ctx, k, sd[k], x, h * 0.45, sc);
          text(ctx, `${SOLIDS[k].name}: surface ${num(SOLIDS[k].A(sd[k]))} cm²`, x, h * 0.45 + sc * Math.cbrt(Vsame) * 1.6, INK, 'center');
        });
        text(ctx, `Every shape holds ${Vsame} cm³`, w / 2, 26, DIM, 'center');
      }
    });
    const tick = clock((dt) => { if (auto) { yaw += dt * 0.4; cv.redraw(); } return true; });
    let last = null;
    drag(cv.c, { down(p) { last = p; auto = false; }, move(p) { yaw += (p.x - last.x) * 0.01; pitch = Math.max(-1.2, Math.min(1.4, pitch + (p.y - last.y) * 0.01)); last = p; cv.redraw(); } });
    const ov = overlay(stage, 'br');
    const spinB = button(ov, 'Pause spin', () => { auto = !auto; spinB.textContent = auto ? 'Pause spin' : 'Spin'; });
    seg(group(panel, 'Compare'), { options: [[false, 'One shape'], [true, 'Same volume']], value: same, onChange: (v) => { same = v === true || v === 'true'; build(); report(); if (same) api.check(2); } });
    const box = el('div'); panel.appendChild(box);
    function build() {
      box.replaceChildren();
      if (same) { slider(group(box, 'Volume'), { label: 'Volume', min: 10, max: 500, step: 10, value: Vsame, fmt: (x) => x + ' cm³', onInput: (x) => { Vsame = x; report(); } }); return; }
      seg(group(box, 'Shape'), { options: Object.entries(SOLIDS).map(([k, s]) => [k, s.name]), value: kind, onChange: (v) => { kind = v; build(); report(); } });
      const g = group(box, 'Size');
      // any size: slide from 0.1 to 100, or type an exact one (up to 10,000)
      SOLIDS[kind].dims.forEach(([n], i) => slider(g, { label: n, min: 0.1, max: 100, step: 0.1, value: dims[kind][i], typed: { min: 0.001, max: 10000, unit }, onInput: (x) => { dims[kind][i] = x; report(); } }));
      seg(group(box, 'Units'), { options: [['mm', 'mm'], ['cm', 'cm'], ['m', 'm'], ['in', 'inches']], value: unit, onChange: (v) => { unit = v; build(); report(); } });
      if (kind === 'torus') box.appendChild(el('p', 'lab-note', 'A torus needs the tube radius r smaller than the ring radius R (otherwise the ring has no hole).'));
      if (kind === 'frustum') box.appendChild(el('p', 'lab-note', 'Make the top radius 0 and the frustum becomes a cone; make it equal to the bottom and it becomes a cylinder.'));
    }
    const st = stats(panel);
    function report() {
      if (same) { const sd = sameDims(); st.set(['cube', 'cylinder', 'sphere'].map((k) => [SOLIDS[k].name, `surface ${num(SOLIDS[k].A(sd[k]))} cm²`])); cv.redraw(); return; }
      const S = SOLIDS[kind], d = dims[kind], V = S.V(d), A = S.A(d);
      if (kind === 'torus' && d[1] >= d[0]) { st.set([['Torus', 'Make the tube radius r smaller than the ring radius R.']]); cv.redraw(); return; }
      st.set([['Volume', `${S.fV} = ${num(V, 4)} ${unit}³`], ['Surface area', `${S.fA} = ${num(A, 4)} ${unit}²`], ...(kind === 'cube' ? [['Doubling the side', '× 2 side → × 4 surface, × 8 volume']] : [])]);
      if (kind === 'cube' && unit === 'cm') {
        if (Math.abs(V - 64) < 1e-9) api.check(0);
        cubeVols.push([d[0], V]); if (cubeVols.length > 40) cubeVols.shift();
        if (cubeVols.some(([s0]) => Math.abs(d[0] - 2 * s0) < 1e-9)) api.check(1);
      }
      cv.redraw();
    }
    build(); report(); tick.start();
    return { state: () => (same ? `comparing a cube, a cylinder and a sphere that all hold ${Vsame} cm³` : `a ${SOLIDS[kind].name.toLowerCase()} with ${SOLIDS[kind].dims.map(([n], i) => `${n.toLowerCase()} = ${dims[kind][i]} ${unit}`).join(', ')}: volume ${num(SOLIDS[kind].V(dims[kind]), 4)} ${unit}³, surface area ${num(SOLIDS[kind].A(dims[kind]), 4)} ${unit}²`), destroy: () => { tick.stop(); cv.destroy(); } };
  },
};

/* ---------------- Recursion ---------------- */
const SEQS = {
  arith: { name: 'Arithmetic', rule: (p) => `aₙ = aₙ₋₁ + ${p.d}`, start: (p) => [p.a], next: (t, p) => t[t.length - 1] + p.d, link: (p) => `+${p.d}`,
    py: (p) => `def term(n):\n    if n == 1:\n        return ${p.a}          # the first term\n    return term(n - 1) + ${p.d}   # the one before, plus ${p.d}` },
  geom: { name: 'Geometric', rule: (p) => `aₙ = aₙ₋₁ × ${p.r}`, start: (p) => [p.a], next: (t, p) => t[t.length - 1] * p.r, link: (p) => `×${p.r}`,
    py: (p) => `def term(n):\n    if n == 1:\n        return ${p.a}\n    return term(n - 1) * ${p.r}` },
  fib: { name: 'Fibonacci', rule: () => 'Fₙ = Fₙ₋₁ + Fₙ₋₂ (add the two before)', start: () => [1, 1], next: (t) => t[t.length - 1] + t[t.length - 2], link: (p, i, t) => (i === 0 ? 'start' : `+${t[i - 1]}`),
    py: () => 'def fib(n):\n    if n <= 2:\n        return 1               # F₁ = F₂ = 1\n    return fib(n - 1) + fib(n - 2)' },
  fact: { name: 'Factorial', rule: () => 'n! = n × (n − 1)!', start: () => [1], next: (t) => t[t.length - 1] * (t.length + 1), link: (p, i) => `×${i + 2}`,
    py: () => 'def factorial(n):\n    if n == 1:\n        return 1\n    return n * factorial(n - 1)' },
  tri: { name: 'Triangular numbers', rule: () => 'Tₙ = Tₙ₋₁ + n', start: () => [1], next: (t) => t[t.length - 1] + t.length + 1, link: (p, i) => `+${i + 2}`,
    py: () => 'def triangle(n):\n    if n == 1:\n        return 1\n    return triangle(n - 1) + n' },
  collatz: { name: 'Collatz (3n + 1)', rule: () => 'even: n ÷ 2, odd: 3n + 1', start: (p) => [p.c], next: (t) => { const x = t[t.length - 1]; return x === 1 ? null : x % 2 ? 3 * x + 1 : x / 2; }, link: (p, i, t) => (t[i] % 2 ? '×3 +1' : '÷2'),
    py: (p) => `def steps(n):\n    if n == 1:\n        return 0               # reached 1: stop\n    if n % 2 == 0:\n        return 1 + steps(n // 2)\n    return 1 + steps(3 * n + 1)\n\nprint(steps(${p.c}))` },
};
const recursionLab = {
  id: 'recursion', name: 'Recursion', subject: 'math', topic: 'sequences and recursion: arithmetic and geometric sequences, Fibonacci, factorials and recursive functions in Python',
  blurb: 'See each term of a sequence built from the one before — in math and in Python.',
  words: 'recursion sequence arithmetic geometric fibonacci factorial collatz python programming recursive function',
  icon: '<rect x="4" y="18" width="10" height="12" rx="2"/><rect x="19" y="18" width="10" height="12" rx="2"/><rect x="34" y="18" width="10" height="12" rx="2"/><path d="M14 24h5M29 24h5"/><path d="M9 14c0-6 15-6 15 0" />',
  tries: ['Find the 10th Fibonacci number', 'Make a geometric sequence that halves every time', 'Find a Collatz start that takes more than 100 steps to reach 1'],
  hints: ['Choose Fibonacci and tap “Next term” until you have 10 terms.', 'Geometric: each term is the one before times r. What r halves a number?', 'Choose Collatz and try different starting numbers between 20 and 30.'],
  about: 'A recursive rule defines each term from the term (or terms) before it, plus a starting value — the “base case” that stops the recursion. The Python functions shown are real, working code (Python 3) that compute the same numbers.\nThe Collatz rule is an unsolved puzzle: every starting number anyone has tried eventually reaches 1, but no one has proved that it always does.\nNumbers are exact whole numbers (or exact decimals for a ratio of ½).',
  mount({ stage, panel, api }) {
    let kind = 'fib', p = { a: 2, d: 3, r: 2, c: 27 }, terms = [], shownN = 6;
    function compute() {
      const S = SEQS[kind]; terms = S.start(p).slice();
      while (terms.length < 200) { const nx = S.next(terms, p); if (nx == null || !Number.isFinite(nx) || Math.abs(nx) > 1e15) break; terms.push(nx); if (kind !== 'collatz' && terms.length >= 40) break; }
    }
    const cv = canvas(stage, (ctx, w, h) => {
      const S = SEQS[kind], n = Math.min(shownN, terms.length), bw = Math.max(58, Math.min(110, (w - 40) / Math.min(n, 7) - 18)), perRow = Math.max(1, Math.floor((w - 30) / (bw + 26)));
      text(ctx, S.rule(p), 20, 28, INK);
      for (let i = 0; i < n; i++) {
        const r0 = Math.floor(i / perRow), c0 = i % perRow, x = 20 + c0 * (bw + 26), y = 50 + r0 * 86;
        if (y > h - 60) { text(ctx, `… ${terms.length - i} more`, x, y + 20, DIM); break; }
        ctx.fillStyle = i === n - 1 ? 'rgba(255,207,90,.2)' : 'rgba(255,255,255,.06)'; ctx.strokeStyle = i === n - 1 ? C.gold : FAINT;
        ctx.beginPath(); ctx.roundRect(x, y, bw, 46, 8); ctx.fill(); ctx.stroke();
        text(ctx, num(terms[i], 12), x + bw / 2, y + 28, INK, 'center');
        text(ctx, kind === 'collatz' ? `step ${i}` : `term ${i + 1}`, x + bw / 2, y + 62, DIM, 'center');
        if (i > 0 && c0 > 0) { arrow(ctx, x - 24, y + 23, x - 4, y + 23, DIM, 1.5); text(ctx, S.link(p, i - 1, terms), x - 14, y + 12, C.gold, 'center'); }
      }
    });
    const code = el('pre', 'lab-code');
    function report() {
      const S = SEQS[kind], n = Math.min(shownN, terms.length);
      code.textContent = S.py(p);
      st.set([[kind === 'collatz' ? 'Steps to reach 1' : `Term ${n}`, kind === 'collatz' ? `${terms.length - 1}${terms[terms.length - 1] === 1 ? '' : ' (still going…)'}` : num(terms[n - 1], 15)], ['Rule', S.rule(p)], ...(kind === 'collatz' ? [['Highest it climbs', num(Math.max(...terms), 12)]] : [])]);
      if (kind === 'fib' && n >= 10) api.check(0);
      if (kind === 'geom' && p.r === 0.5) api.check(1);
      if (kind === 'collatz' && terms[terms.length - 1] === 1 && terms.length - 1 > 100) api.check(2);
      cv.redraw();
    }
    const ov = overlay(stage, 'br');
    button(ov, 'Next term', () => { shownN = Math.min(terms.length, shownN + 1); report(); }, 'main big');
    button(ov, 'All', () => { shownN = terms.length; report(); });
    seg(group(panel, 'Sequence'), { options: Object.entries(SEQS).map(([k, s]) => [k, s.name]), value: kind, onChange: (v) => { kind = v; shownN = kind === 'collatz' ? 200 : 6; build(); compute(); report(); } });
    const box = el('div'); panel.appendChild(box);
    function build() {
      box.replaceChildren();
      const g = group(box, 'Start');
      const re = () => { compute(); shownN = Math.min(Math.max(shownN, 6), terms.length); report(); };
      if (kind === 'arith' || kind === 'geom') slider(g, { label: 'First term', min: 1, max: 100, value: p.a, onInput: (v) => { p.a = v; re(); } });
      if (kind === 'arith') slider(g, { label: 'Add each time (d)', min: -10, max: 10, value: p.d, onInput: (v) => { p.d = v; re(); } });
      if (kind === 'geom') seg(g, { label: 'Multiply each time (r)', options: [[0.5, '½'], [2, '2'], [3, '3'], [-2, '−2'], [10, '10']], value: p.r, onChange: (v) => { p.r = +v; re(); } });
      if (kind === 'collatz') { slider(g, { label: 'Start at', min: 2, max: 100, value: p.c, onInput: (v) => { p.c = v; shownN = 200; re(); } }); }
    }
    panel.appendChild(el('h4', 'lab-code-h', 'The same thing in Python'));
    panel.appendChild(code);
    const st = stats(panel);
    build(); compute(); report();
    return { state: () => `the ${SEQS[kind].name} sequence (${SEQS[kind].rule(p)}): ${terms.slice(0, Math.min(shownN, 12)).join(', ')}${terms.length > 12 ? ', …' : ''}`, destroy: () => cv.destroy() };
  },
};

export const MATH2 = [vectorLab, solidsLab, recursionLab];

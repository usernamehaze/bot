/* Physics labs (v227): pushing a cart against friction, a seesaw and its torques, a magnet through a coil
   (electromagnetic induction), and two pucks colliding in 1D and 2D. */
import { INK, DIM, FAINT, C, el, num, canvas, drag, clock, group, slider, seg, button, row, stats, line, dot, text, arrow } from './kit.js';

const G = 9.81;
const calm = () => document.documentElement.classList.contains('lite') || !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

/* ---------------- Push and pull (friction) ---------------- */
export const SURFACES = { ice: ['Ice', 0.02], wood: ['Wood', 0.3], carpet: ['Carpet', 0.6] };
// what a push does to a cart at rest: friction holds it up to mu·m·g; past that it speeds up at (F - mu·m·g) / m
export function pushResult(F, m, mu) {
  const hold = mu * m * G, moves = F > hold, net = moves ? F - hold : 0;
  return { hold, moves, net, a: net / m, friction: moves ? hold : F };
}
const frictionLab = {
  id: 'friction', name: 'Push and pull', subject: 'physics', levels: ['elem', 'hs'], topic: 'forces and friction: pushes, friction, net force and F = ma',
  blurb: 'Push a cart on ice, wood or carpet. Find the push that just gets it moving, and how fast it speeds up.',
  words: 'force friction push pull net force newton second law f=ma acceleration mass surface rough smooth',
  icon: '<rect x="10" y="20" width="22" height="12" rx="2"/><circle cx="15" cy="35" r="3"/><circle cx="27" cy="35" r="3"/><path d="M4 40h40"/><path d="M34 26h10M40 22l4 4-4 4"/>',
  tries: ['Find the smallest push that gets the cart moving on wood', 'Push so the cart moves on ice but would stay still on carpet', 'Give the cart an acceleration of exactly 1 m/s²'],
  hints: ['Choose Wood. Friction can hold back up to μ × mass × 9.81 newtons. Push a little more than that.', 'Choose Ice and a small push, enough to beat ice friction but less than carpet’s.', 'Net force = mass × acceleration. For 1 m/s² the push must beat friction by exactly the mass in newtons.'],
  about: 'Friction holds the cart still up to a limit: μ × m × g (μ is the surface’s friction coefficient: ice 0.02, wood 0.3, carpet 0.6; g = 9.81 m/s²). A smaller push is cancelled exactly, so nothing moves.\nOnce the push is bigger, the net force is the push minus friction, and the cart speeds up at a = net force ÷ mass (Newton’s second law).\nThis model uses one μ for starting and sliding friction (real surfaces need a little more force to start than to keep going), and leaves out air resistance and the wheels’ own friction.',
  mount({ stage, panel, api }) {
    let m = 5, surf = 'wood', F = 20, run = null;
    const mu = () => SURFACES[surf][1];
    const cv = canvas(stage, (ctx, w, h) => {
      const R = pushResult(F, m, mu()), gy = h * 0.42, tx = 40;
      ctx.fillStyle = surf === 'ice' ? 'rgba(160,210,255,.25)' : surf === 'wood' ? 'rgba(190,140,80,.35)' : 'rgba(170,80,90,.35)';
      ctx.fillRect(0, gy, w, 18); line(ctx, [[0, gy], [w, gy]], DIM, 1.5);
      const x = tx + 40 + Math.min(w - 200, (run ? run.x : 0) * 40), bw = 60 + m * 4;
      ctx.fillStyle = 'rgba(255,255,255,.14)'; ctx.strokeStyle = INK; ctx.lineWidth = 2; ctx.beginPath(); ctx.roundRect(x, gy - 46, bw, 36, 6); ctx.fill(); ctx.stroke();
      dot(ctx, x + 14, gy - 6, 6, INK); dot(ctx, x + bw - 14, gy - 6, 6, INK);
      text(ctx, `${m} kg`, x + bw / 2, gy - 24, INK, 'center');
      if (F > 0) { arrow(ctx, x - 10 - F * 1.2, gy - 28, x - 4, gy - 28, C.gold, 3); text(ctx, `push ${F} N`, x - 14 - F * 1.2, gy - 36, C.gold); }
      if (R.friction > 0) { arrow(ctx, x + bw / 2, gy + 26, x + bw / 2 - R.friction * 1.2, gy + 26, C.red, 3); text(ctx, `friction ${num(R.friction)} N`, x + bw / 2 - R.friction * 1.2, gy + 44, C.red); }
      // the speed so far
      const gx = 50, gyy = h * 0.62, gw = w - 80, gh = h * 0.3;
      line(ctx, [[gx, gyy], [gx, gyy + gh], [gx + gw, gyy + gh]], FAINT, 1);
      text(ctx, 'speed (m/s)', gx + 4, gyy + 10, DIM); text(ctx, 'time (s)', gx + gw - 50, gyy + gh + 16, DIM);
      if (run && run.pts.length > 1) { const top = Math.max(2, ...run.pts.map((p) => p[1])); line(ctx, run.pts.map(([t, v]) => [gx + (t / 5) * gw, gyy + gh - (v / top) * gh]), C.green, 2.5); text(ctx, num(top), gx - 6, gyy + 4, DIM, 'right'); }
      text(ctx, R.moves ? `It moves: a = ${num(R.a)} m/s²` : 'It stays still: friction matches the push', 16, 22, R.moves ? C.green : DIM);
    });
    const tick = clock((dt) => { if (!run) return false; const R = pushResult(F, m, mu()); run.t = Math.min(5, run.t + dt); run.v = R.a * run.t; run.x = 0.5 * R.a * run.t * run.t; run.pts.push([run.t, run.v]); cv.redraw(); if (run.t >= 5) return false; return true; });
    function push() { tick.stop(); run = { t: 0, v: 0, x: 0, pts: [[0, 0]] }; if (calm()) { const R = pushResult(F, m, mu()); for (let i = 1; i <= 50; i++) { const t = i / 10; run.pts.push([t, R.a * t]); } run.t = 5; run.v = R.a * 5; run.x = 0.5 * R.a * 25; cv.redraw(); } else tick.start(); report(); }
    const g = group(panel, 'The cart');
    slider(g, { label: 'Mass', min: 1, max: 10, value: m, fmt: (v) => `${v} kg`, onInput: (v) => { m = v; run = null; report(); } });
    seg(group(panel, 'Surface'), { options: Object.entries(SURFACES).map(([k, [n, u]]) => [k, `${n} (μ ${u})`]), value: surf, onChange: (v) => { surf = v; run = null; report(); } });
    slider(group(panel, 'Your push'), { label: 'Push', min: 0, max: 100, value: F, fmt: (v) => `${v} N`, onInput: (v) => { F = v; run = null; report(); } });
    button(row(panel, 'lab-row-btns'), 'Push for 5 seconds', push, 'main');
    const st = stats(panel);
    function report() {
      const R = pushResult(F, m, mu());
      st.set([['Moves?', R.moves ? 'Yes' : 'No'], ['Friction can hold up to', `${num(R.hold)} N`], ['Net force', `${num(R.net)} N`], ['Acceleration', `${num(R.a)} m/s²`], ['After 5 s', `${num(R.a * 5)} m/s`]]);
      if (surf === 'wood' && R.moves && F - R.hold <= 2) api.check(0);
      if (surf === 'ice' && R.moves && F <= SURFACES.carpet[1] * m * G) api.check(1);
      if (R.moves && Math.abs(R.a - 1) <= 0.05) api.check(2);
      cv.redraw();
    }
    report();
    return { state: () => { const R = pushResult(F, m, mu()); return `a ${m} kg cart on ${SURFACES[surf][0].toLowerCase()} (μ ${mu()}), pushed with ${F} N: friction can hold up to ${num(R.hold)} N, so it ${R.moves ? `moves with a net force of ${num(R.net)} N and an acceleration of ${num(R.a)} m/s²` : 'stays still'}`; }, destroy: () => { tick.stop(); cv.destroy(); } };
  },
};

/* ---------------- Seesaw and levers ---------------- */
// torque about the pivot: each weight pushes down with m·g at its distance from the pivot (+ right, - left)
export function seesawTorque(weights, pivot) {
  let left = 0, right = 0;
  weights.forEach(({ m, x }) => { const t = m * G * (x - pivot); if (t < 0) left += -t; else right += t; });
  const M = weights.reduce((s, w) => s + w.m, 0);
  return { left, right, net: right - left, com: M ? weights.reduce((s, w) => s + w.m * w.x, 0) / M : pivot };
}
const seesawLab = {
  id: 'seesaw', name: 'Seesaw and levers', subject: 'physics', levels: ['elem', 'hs'], topic: 'levers, torque (moment), balance and centre of mass',
  blurb: 'Put weights on a seesaw and move the pivot. It balances when the turning effects on both sides are equal.',
  words: 'seesaw lever torque moment balance pivot fulcrum centre of mass center of mass weight distance',
  icon: '<path d="M6 30l36-8"/><path d="M24 26l-6 14h12z"/><rect x="8" y="22" width="6" height="6"/><rect x="34" y="16" width="8" height="8"/>',
  tries: ['Balance two different weights', 'Balance it with three weights or more', 'Balance a 1 kg and a 3 kg weight by moving the pivot'],
  hints: ['A heavier weight balances a lighter one when it sits closer to the pivot. 2 kg at 1.5 m balances 3 kg at 1 m.', 'Add a third weight, then move one until the turning effects match.', 'Put 1 kg on one end and 3 kg on the other, then slide the pivot towards the 3 kg.'],
  about: 'Each weight turns the plank with a torque (moment) = weight × distance from the pivot, where the weight is mass × 9.81 N. It balances when the torques on the left and right are equal.\nThe balance point of all the weights together is their centre of mass: the seesaw balances when the pivot is right under it.\nThe plank itself is treated as weightless, so it only shows the weights’ own balance, and the tilt is limited so you can see which way it would fall.',
  mount({ stage, panel, api }) {
    const W = [{ m: 2, x: -1.5 }]; let pivot = 0, pos = 1, mass = 3;
    const cv = canvas(stage, (ctx, w, h) => {
      const T = seesawTorque(W, pivot), cx = w / 2, py = h * 0.62, s = Math.min(110, (w - 80) / 4.4), ang = Math.max(-0.26, Math.min(0.26, T.net / 120));
      ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.beginPath(); ctx.moveTo(cx + pivot * s, py); ctx.lineTo(cx + pivot * s - 24, py + 40); ctx.lineTo(cx + pivot * s + 24, py + 40); ctx.closePath(); ctx.fill(); ctx.strokeStyle = INK; ctx.stroke();
      ctx.save(); ctx.translate(cx + pivot * s, py); ctx.rotate(ang);
      ctx.fillStyle = 'rgba(232,215,168,.55)'; ctx.fillRect(-2.2 * s - pivot * s, -8, 4.4 * s, 8);
      for (let x = -2; x <= 2.001; x += 0.5) text(ctx, `${x > 0 ? '+' : ''}${x}`, (x - pivot) * s, 22, DIM, 'center');
      const stack = {};
      W.forEach(({ m: mm, x }) => { const k = x.toFixed(2), y0 = stack[k] || 0, bh = 10 + mm * 5; ctx.fillStyle = 'rgba(255,207,90,.8)'; ctx.fillRect((x - pivot) * s - 16, -8 - y0 - bh, 32, bh); text(ctx, `${mm} kg`, (x - pivot) * s, -8 - y0 - bh / 2 + 4, '#111', 'center'); stack[k] = y0 + bh + 2; });
      ctx.restore();
      dot(ctx, cx + T.com * s, py + 56, 6, C.teal); text(ctx, 'centre of mass', cx + T.com * s, py + 76, C.teal, 'center');
      text(ctx, Math.abs(T.net) < 0.01 ? 'Balanced' : T.net > 0 ? 'Tips to the right' : 'Tips to the left', 16, 22, Math.abs(T.net) < 0.01 ? C.green : INK);
    });
    const ga = group(panel, 'Add a weight');
    seg(ga, { options: [[1, '1 kg'], [2, '2 kg'], [3, '3 kg'], [5, '5 kg']], value: mass, onChange: (v) => { mass = v; } });
    slider(ga, { label: 'Position (m from the middle)', min: -2, max: 2, step: 0.25, value: pos, fmt: (v) => `${v > 0 ? '+' : ''}${v} m`, onInput: (v) => { pos = v; } });
    const r1 = row(ga, 'lab-row-btns');
    button(r1, 'Put it here', () => { W.push({ m: mass, x: pos }); report(); }, 'main');
    button(r1, 'Take all off', () => { W.length = 0; report(); });
    slider(group(panel, 'Pivot'), { label: 'Pivot position', min: -1, max: 1, step: 0.25, value: pivot, fmt: (v) => `${v > 0 ? '+' : ''}${v} m`, onInput: (v) => { pivot = v; report(); } });
    const list = el('p', 'lab-note'); panel.appendChild(list);
    const st = stats(panel);
    function report() {
      const T = seesawTorque(W, pivot), bal = W.length >= 2 && Math.abs(T.net) < 0.01;
      list.textContent = W.length ? `On the plank: ${W.map((x) => `${x.m} kg at ${x.x > 0 ? '+' : ''}${x.x} m`).join(', ')}` : 'Nothing on the plank yet.';
      st.set([['Left turning effect', `${num(T.left)} N·m`], ['Right turning effect', `${num(T.right)} N·m`], ['Balanced?', bal ? 'Yes' : 'No'], ['Centre of mass', `${num(T.com)} m`]]);
      if (bal && new Set(W.map((x) => x.m)).size >= 2) api.check(0);
      if (bal && W.length >= 3) api.check(1);
      if (bal && pivot !== 0 && W.length === 2 && W.some((x) => x.m === 1) && W.some((x) => x.m === 3)) api.check(2);
      cv.redraw();
    }
    report();
    return { state: () => { const T = seesawTorque(W, pivot); return `a seesaw with the pivot at ${pivot} m and ${W.map((x) => `${x.m} kg at ${x.x} m`).join(', ') || 'nothing on it'}: left ${num(T.left)} N·m, right ${num(T.right)} N·m, ${Math.abs(T.net) < 0.01 ? 'balanced' : 'not balanced'}`; }, destroy: () => cv.destroy() };
  },
};

/* ---------------- Electromagnetic induction ---------------- */
// the flux through the coil from a bar magnet at x (in coil radii) along its axis: like a dipole's, B ∝ 1/(1 + x²)^(3/2)
export const FLUX0 = 0.002; // Wb per turn at the centre (illustrative)
export const flux = (x) => FLUX0 / Math.pow(1 + x * x, 1.5);
const dFlux = (x) => (-3 * FLUX0 * x) / Math.pow(1 + x * x, 2.5); // dΦ/dx
// Faraday: emf = -N dΦ/dt = -N (dΦ/dx)(dx/dt). The coil radius is 0.05 m, so x (in radii) moves at v / 0.05 per second
export const emfAt = (N, x, v) => -N * dFlux(x) * (v / 0.05);
const inductionLab = {
  id: 'induction', name: 'Electromagnetic induction', subject: 'physics', levels: ['hs', 'college'], topic: 'electromagnetic induction: Faraday’s law, Lenz’s law, coils, magnets and induced voltage',
  blurb: 'Push a magnet through a coil and watch the voltage it makes. Faster or more turns gives more.',
  words: 'electromagnetic induction faraday lenz coil magnet voltage emf flux generator galvanometer oscilloscope',
  icon: '<rect x="4" y="20" width="14" height="8" rx="1"/><path d="M22 14c3 0 3 20 0 20M27 14c3 0 3 20 0 20M32 14c3 0 3 20 0 20M37 14c3 0 3 20 0 20"/><path d="M22 14h15M22 34h15"/>',
  tries: ['Make the needle swing one way, then the other', 'Double the turns and compare the biggest voltage', 'Hold the magnet still inside the coil. What is the voltage?'],
  hints: ['Push the magnet in, then pull it out, or press “Push it through”.', 'Push it through once, then double the turns and push it through again at the same speed.', 'Drag the magnet into the middle of the coil and stop. A magnet that isn’t moving makes no voltage.'],
  about: 'A changing magnetic flux through a coil makes a voltage (Faraday’s law): emf = −N × (change in flux ÷ time), so more turns (N) or a faster magnet make more.\nThe minus sign is Lenz’s law: the induced current pushes back against the change, so the voltage has one sign as the magnet goes in and the other as it comes out. A magnet that isn’t moving makes none.\nThe flux uses a simple bar magnet shape along the coil’s axis (it falls off like a dipole’s), with an illustrative strength; real coils also have resistance, which this leaves out.',
  mount({ stage, panel, api }) {
    let N = 50, speed = 1, x = -4, vNow = 0, hist = [], pass = null, held = false, lastX = x, lastT = 0, peaks = { in: 0, out: 0 };
    const passes = new Map();
    const cv = canvas(stage, (ctx, w, h) => {
      const cx = w / 2, cy = h * 0.32, R = Math.min(60, w / 10), s = R; // (one coil radius = R px)
      for (let i = 0; i < 8; i++) { const xx = cx - R * 0.8 + (i * R * 1.6) / 7; ctx.strokeStyle = C.gold; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(xx, cy, 8, R, 0, 0, Math.PI * 2); ctx.stroke(); }
      const mx = cx + x * s; ctx.fillStyle = '#d95b5b'; ctx.fillRect(mx - 30, cy - 12, 30, 24); ctx.fillStyle = '#5b7fd9'; ctx.fillRect(mx, cy - 12, 30, 24);
      text(ctx, 'N', mx + 15, cy + 5, '#fff', 'center'); text(ctx, 'S', mx - 15, cy + 5, '#fff', 'center');
      // the galvanometer
      const gx = w - 80, gy = cy + R + 50, ang = Math.max(-1.2, Math.min(1.2, vNow / 0.6));
      ctx.strokeStyle = DIM; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(gx, gy, 40, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
      line(ctx, [[gx, gy], [gx + Math.sin(ang) * 36, gy - Math.cos(ang) * 36]], INK, 3); text(ctx, '0', gx, gy - 46, DIM, 'center');
      // the oscilloscope
      const ox = 30, oy = h * 0.66, ow = w - 160, oh = h * 0.28;
      ctx.strokeStyle = FAINT; ctx.strokeRect(ox, oy, ow, oh); line(ctx, [[ox, oy + oh / 2], [ox + ow, oy + oh / 2]], FAINT, 1);
      const top = Math.max(0.5, ...hist.map((p) => Math.abs(p))); if (hist.length > 1) line(ctx, hist.map((v, i) => [ox + (i / 400) * ow, oy + oh / 2 - (v / top) * (oh / 2 - 4)]), C.green, 2);
      text(ctx, `voltage, ±${num(top)} V`, ox + 6, oy + 14, DIM);
      text(ctx, 'Drag the magnet, or push it through', 16, 22, DIM);
    });
    const sample = (v) => { hist.push(v); if (hist.length > 400) hist.shift(); };
    const record = (v, xx, moving) => { vNow = v; if (moving) { if (xx < 0) peaks.in = Math.abs(v) > Math.abs(peaks.in) ? v : peaks.in; else peaks.out = Math.abs(v) > Math.abs(peaks.out) ? v : peaks.out; } };
    // push it through: from x = -4 to +4 coil radii at the chosen speed
    const tick = clock((dt) => { if (!pass) return false; const dx = (speed / 0.05) * dt; x += dx; const v = emfAt(N, x, speed); record(v, x, true); sample(v); cv.redraw(); if (x >= 4) { endPass(); return false; } report(); return true; });
    function endPass() { pass = null; vNow = 0; sample(0); passes.set(N, Math.abs(peaks.out)); if ([...passes.keys()].some((n) => passes.has(n * 2))) api.check(1); if (peaks.in < 0 && peaks.out > 0) api.check(0); report(); }
    function through() {
      tick.stop(); x = -4; peaks = { in: 0, out: 0 }; hist = []; pass = {};
      if (calm()) { const steps = 400; for (let i = 0; i <= steps; i++) { x = -4 + (8 * i) / steps; const v = emfAt(N, x, speed); record(v, x, true); sample(v); } x = 4; endPass(); cv.redraw(); } else tick.start();
    }
    drag(cv.c, {
      down(p) { held = true; lastT = performance.now(); lastX = x; },
      move(p) { if (!held) return; const r = cv.c.getBoundingClientRect(), R = Math.min(60, r.width / 10), nx = Math.max(-4, Math.min(4, (p.x - r.width / 2) / R)), now = performance.now(), dt = Math.max(0.008, (now - lastT) / 1000), v = ((nx - lastX) * 0.05) / dt; x = nx; const e = emfAt(N, x, v); record(e, x, Math.abs(v) > 1e-4); sample(e); lastX = nx; lastT = now; report(); cv.redraw(); },
      up() { held = false; vNow = 0; sample(0); if (Math.abs(x) < 0.5) api.check(2); if (peaks.in < 0 && peaks.out > 0) api.check(0); report(); cv.redraw(); },
    });
    const g = group(panel, 'The coil and the push');
    slider(g, { label: 'Turns of wire', min: 10, max: 200, step: 10, value: N, onInput: (v) => { N = v; report(); } });
    slider(g, { label: 'Magnet speed', min: 0.5, max: 3, step: 0.5, value: speed, fmt: (v) => `${v} m/s`, onInput: (v) => { speed = v; } });
    const r1 = row(panel, 'lab-row-btns');
    button(r1, 'Push it through', through, 'main');
    button(r1, 'Stop the magnet', () => { tick.stop(); pass = null; vNow = 0; sample(0); if (Math.abs(x) < 0.5) api.check(2); report(); cv.redraw(); });
    button(r1, 'Put it in the middle', () => { tick.stop(); pass = null; x = 0; vNow = 0; sample(0); report(); cv.redraw(); });
    const st = stats(panel);
    function report() {
      st.set([['Voltage now', `${vNow.toFixed(3)} V`], ['Biggest going in', `${peaks.in.toFixed(3)} V`], ['Biggest coming out', `${peaks.out.toFixed(3)} V`], ['Turns', String(N)], ['Magnet at', `${num(x * 5)} cm from the middle`]]);
    }
    report();
    return { state: () => `a bar magnet ${num(x * 5)} cm from the middle of a ${N}-turn coil; the voltage now is ${vNow.toFixed(3)} V; the biggest voltage going in was ${peaks.in.toFixed(3)} V and coming out ${peaks.out.toFixed(3)} V`, destroy: () => { tick.stop(); cv.destroy(); } };
  },
};

/* ---------------- Collisions ---------------- */
// two pucks meet along a line (the normal n): the impulse along n with restitution e; along the edge, nothing changes
export function collide(m1, v1, m2, v2, e, ang = 0) {
  const n = [Math.cos(ang), Math.sin(ang)], dot2 = (a, b) => a[0] * b[0] + a[1] * b[1];
  const u1 = dot2(v1, n), u2 = dot2(v2, n), M = m1 + m2;
  const w1 = (m1 * u1 + m2 * u2 + m2 * e * (u2 - u1)) / M, w2 = (m1 * u1 + m2 * u2 + m1 * e * (u1 - u2)) / M;
  return [[v1[0] + (w1 - u1) * n[0], v1[1] + (w1 - u1) * n[1]], [v2[0] + (w2 - u2) * n[0], v2[1] + (w2 - u2) * n[1]]];
}
const momentum = (m1, a, m2, b) => [m1 * a[0] + m2 * b[0], m1 * a[1] + m2 * b[1]];
const kinetic = (m1, a, m2, b) => 0.5 * m1 * (a[0] ** 2 + a[1] ** 2) + 0.5 * m2 * (b[0] ** 2 + b[1] ** 2);
const collisionsLab = {
  id: 'collisions', name: 'Collisions', subject: 'physics', levels: ['hs', 'college'], topic: 'momentum and collisions: elastic and inelastic, conservation of momentum and kinetic energy, 1D and 2D',
  blurb: 'Crash two pucks on a frictionless table. Momentum is always kept; kinetic energy only when it bounces perfectly.',
  words: 'collision momentum elastic inelastic kinetic energy conservation impulse restitution puck vector',
  icon: '<circle cx="14" cy="24" r="8"/><circle cx="34" cy="24" r="8"/><path d="M2 24h4M42 24h4M20 14l-4-4M28 14l4-4"/>',
  tries: ['Make the pucks swap speeds in an elastic head-on crash', 'Make them stick together', 'Show that kinetic energy is lost but momentum is not'],
  hints: ['Make the masses equal, choose Elastic and 1D, send one puck at the other one standing still, then press Crash.', 'Choose Stick together, then press Crash.', 'Choose any elasticity below 1 and press Crash. Compare the totals before and after.'],
  about: 'The table has no friction, so the only forces are the ones in the crash. The total momentum (mass × velocity, an arrow) is the same before and after every collision.\nKinetic energy (½ × mass × speed²) is kept only in a perfectly elastic collision (e = 1). With e below 1 some becomes heat and sound; with e = 0 the pucks stick together and lose the most.\nIn 2D the pucks meet along a line set by the hit angle (0° is head-on); only the parts of their velocities along that line change. The pucks are treated as smooth, not spinning.',
  mount({ stage, panel, api }) {
    let dim = '1d', m1 = 1, m2 = 1, v1 = [2, 0], v2 = [0, 0], kind = 'elastic', e = 1, ang = 0, after = null, anim = null;
    const eNow = () => (kind === 'elastic' ? 1 : kind === 'stick' ? 0 : e);
    const cv = canvas(stage, (ctx, w, h) => {
      const cy = h * 0.4, s = Math.min(50, w / 14), A = after || [v1, v2], t = anim ? anim.t : 0;
      ctx.strokeStyle = FAINT; ctx.strokeRect(10, 10, w - 20, h * 0.72);
      // (before: the pucks glide together to meet in the middle; after: each moves off with its new velocity)
      const meet = Math.min(1, t), p1 = t <= 1 ? [-2 + 1.5 * meet, 0] : [-0.5 + A[0][0] * (t - 1) * 0.8, A[0][1] * (t - 1) * 0.8], p2 = t <= 1 ? [1 - 0.5 * meet, 0] : [0.5 + A[1][0] * (t - 1) * 0.8, A[1][1] * (t - 1) * 0.8];
      const draw = (p, m, v, col, lab) => { const x = w / 2 + p[0] * s, y = cy - p[1] * s, r = 12 + m * 4; dot(ctx, x, y, r, col); text(ctx, lab, x, y + 4, '#111', 'center'); if (Math.hypot(v[0], v[1]) > 0.01) arrow(ctx, x, y, x + v[0] * s * 0.6, y - v[1] * s * 0.6, INK, 2.5); };
      draw(p1, m1, anim && t >= 1 ? A[0] : v1, C.gold, `${m1}`); draw(p2, m2, anim && t >= 1 ? A[1] : v2, C.blue, `${m2}`);
      if (dim === '2d') { const ax = w / 2 + 0.5 * s; ctx.setLineDash([4, 4]); line(ctx, [[ax - Math.cos(ang) * 60, cy + Math.sin(ang) * 60], [ax + Math.cos(ang) * 60, cy - Math.sin(ang) * 60]], DIM, 1.5); ctx.setLineDash([]); text(ctx, 'line of the hit', ax + 64, cy - 6, DIM); }
      text(ctx, after ? 'After the crash' : 'Before the crash: press Crash', 16, h * 0.72 + 30, INK);
    });
    const tick = clock((dt) => { if (!anim) return false; anim.t += dt * 0.8; cv.redraw(); if (anim.t >= 2.4) { anim = null; return false; } return true; });
    function crash() {
      after = collide(m1, v1, m2, v2, eNow(), dim === '2d' ? ang : 0);
      if (!calm()) { anim = { t: 0 }; tick.start(); }
      report(true);
    }
    const reset = () => { after = null; anim = null; report(); };
    const box = el('div'); panel.appendChild(box);
    function build() {
      box.replaceChildren();
      seg(group(box, 'Table'), { options: [['1d', '1D (a line)'], ['2d', '2D (a table)']], value: dim, onChange: (v) => { dim = v; if (v === '1d') { v1 = [v1[0], 0]; v2 = [v2[0], 0]; } build(); reset(); } });
      const gm = group(box, 'Masses');
      slider(gm, { label: 'Gold puck', min: 0.5, max: 5, step: 0.5, value: m1, fmt: (v) => `${v} kg`, onInput: (v) => { m1 = v; reset(); } });
      slider(gm, { label: 'Blue puck', min: 0.5, max: 5, step: 0.5, value: m2, fmt: (v) => `${v} kg`, onInput: (v) => { m2 = v; reset(); } });
      const gv = group(box, 'Velocities (m/s, + is right or up)');
      slider(gv, { label: 'Gold, across', min: -5, max: 5, step: 0.5, value: v1[0], onInput: (v) => { v1 = [v, v1[1]]; reset(); } });
      slider(gv, { label: 'Blue, across', min: -5, max: 5, step: 0.5, value: v2[0], onInput: (v) => { v2 = [v, v2[1]]; reset(); } });
      if (dim === '2d') {
        slider(gv, { label: 'Gold, up', min: -5, max: 5, step: 0.5, value: v1[1], onInput: (v) => { v1 = [v1[0], v]; reset(); } });
        slider(gv, { label: 'Blue, up', min: -5, max: 5, step: 0.5, value: v2[1], onInput: (v) => { v2 = [v2[0], v]; reset(); } });
        slider(gv, { label: 'Hit angle', min: -60, max: 60, step: 5, value: Math.round((ang * 180) / Math.PI), fmt: (v) => `${v}°`, onInput: (v) => { ang = (v * Math.PI) / 180; reset(); } });
      }
      const gk = group(box, 'The crash');
      seg(gk, { options: [['elastic', 'Elastic'], ['stick', 'Stick together'], ['some', 'Elasticity']], value: kind, onChange: (v) => { kind = v; eS.el.hidden = v !== 'some'; reset(); } });
      const eS = slider(gk, { label: 'Elasticity e', min: 0, max: 1, step: 0.05, value: e, fmt: (v) => v.toFixed(2), onInput: (v) => { e = v; reset(); } }); eS.el.hidden = kind !== 'some';
    }
    build();
    const r1 = row(panel, 'lab-row-btns'); button(r1, 'Crash', crash, 'main'); button(r1, 'Back to before', reset);
    const st = stats(panel);
    const vec = (v) => (dim === '1d' ? num(v[0]) : `(${num(v[0])}, ${num(v[1])})`);
    function report(crashed) {
      const p0 = momentum(m1, v1, m2, v2), k0 = kinetic(m1, v1, m2, v2), A = after;
      const list = [['Momentum before', `${vec(p0)} kg·m/s`], ['Kinetic energy before', `${num(k0)} J`]];
      if (A) { const p1 = momentum(m1, A[0], m2, A[1]), k1 = kinetic(m1, A[0], m2, A[1]); list.push(['Momentum after', `${vec(p1)} kg·m/s`], ['Kinetic energy after', `${num(k1)} J`], ['Gold after', `${vec(A[0])} m/s`], ['Blue after', `${vec(A[1])} m/s`]);
        if (crashed) {
          const ee = eNow();
          if (dim === '1d' && ee === 1 && m1 === m2 && Math.abs(A[0][0] - v2[0]) < 1e-9 && Math.abs(A[1][0] - v1[0]) < 1e-9 && v1[0] !== v2[0]) api.check(0);
          if (ee === 0 && Math.hypot(A[0][0] - A[1][0], A[0][1] - A[1][1]) < 1e-9 && k0 > 0) api.check(1);
          if (ee < 1 && k1 < k0 - 1e-9) api.check(2);
        } }
      st.set(list); cv.redraw();
    }
    report();
    return { state: () => `${dim === '1d' ? 'a 1D' : 'a 2D'} crash: gold puck ${m1} kg at ${vec(v1)} m/s, blue puck ${m2} kg at ${vec(v2)} m/s, elasticity ${eNow()}${after ? `; after: gold ${vec(after[0])} m/s, blue ${vec(after[1])} m/s` : ''}`, destroy: () => { tick.stop(); cv.destroy(); } };
  },
};

export const PHYSICS3 = [frictionLab, seesawLab, inductionLab, collisionsLab];

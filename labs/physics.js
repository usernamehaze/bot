/* Physics labs: launching a ball, a pendulum (and a chaotic double one), waves on a string,
   and light bending as it crosses into water or glass. */
import { INK, DIM, FAINT, GRID, C, el, num, canvas, drag, clock, group, slider, seg, button, row, stats, line, dot, text, arrow } from './kit.js';

const GRAVITY = { earth: ['Earth', 9.81], moon: ['Moon', 1.62], mars: ['Mars', 3.71], jupiter: ['Jupiter', 24.79] };

/* ---------------- Projectile ---------------- */
const projectileLab = {
  id: 'projectile', name: 'Launch lab', subject: 'physics', topic: 'projectile motion: angle, speed, gravity, range and height',
  blurb: 'Pick an angle and a speed, launch, and see how gravity bends the path into an arc.',
  words: 'projectile motion trajectory gravity launch cannon ball parabola kinematics',
  icon: '<path d="M6 40h36"/><path d="M8 38c8-28 24-28 32 0" stroke-dasharray="3 4"/><circle cx="24" cy="17" r="3"/><path d="M8 38l6-8"/>',
  tries: ['Find the angle that goes farthest (launching from the ground)', 'Hit the target', 'Launch on the Moon after Earth — how much farther?'],
  mount({ stage, panel, api }) {
    let ang = 40, v = 22, h0 = 0, gk = 'earth', target = 30 + Math.round(Math.random() * 40);
    let flight = null; const trails = [];
    const planets = new Set();
    const g = () => GRAVITY[gk][1];
    function plan() {
      const a = (ang * Math.PI) / 180, vx = v * Math.cos(a), vy = v * Math.sin(a), G = g();
      const T = (vy + Math.sqrt(vy * vy + 2 * G * h0)) / G;
      return { vx, vy, T, range: vx * T, top: h0 + (vy > 0 ? (vy * vy) / (2 * G) : 0), hit: Math.hypot(vx, vy - G * T) };
    }
    let view = { sx: 60, sy: 30 };
    const cv = canvas(stage, (ctx, w, h) => {
      const P = plan();
      // keep the target, the flights and this launch's path in view
      const spanX = Math.max(target + 8, P.range * 1.05, ...trails.map((t) => t.range * 1.05), 20);
      const spanY = Math.max(P.top * 1.15, h0 + 4, ...trails.map((t) => t.top * 1.15), 8);
      const s = Math.min((w - 70) / spanX, (h - 70) / spanY);
      const X = (x) => 40 + x * s, Y = (y) => h - 36 - y * s;
      view = { s, X, Y };
      // ground, height marks
      ctx.fillStyle = 'rgba(255,255,255,.03)'; ctx.fillRect(0, Y(0), w, h - Y(0));
      line(ctx, [[0, Y(0)], [w, Y(0)]], DIM, 1.5);
      const step = spanX > 150 ? 50 : spanX > 60 ? 20 : 10;
      for (let x = 0; X(x) < w; x += step) { line(ctx, [[X(x), Y(0)], [X(x), Y(0) + 6]], DIM, 1); text(ctx, x + ' m', X(x), Y(0) + 20, DIM, 'center'); }
      // the target
      ctx.fillStyle = 'rgba(255,122,122,.25)'; ctx.fillRect(X(target - 2), Y(0) - 6, 4 * s, 6);
      dot(ctx, X(target), Y(0) - 3, 4, C.red);
      text(ctx, 'target', X(target), Y(0) - 12, C.red, 'center');
      // a tower to launch from
      if (h0 > 0) { ctx.fillStyle = 'rgba(255,255,255,.08)'; ctx.fillRect(X(0) - 12, Y(h0), 12, h0 * s); }
      // earlier flights, faint
      trails.forEach((t, i) => line(ctx, t.pts.map(([x, y]) => [X(x), Y(y)]), `rgba(255,207,90,${0.12 + (0.25 * (i + 1)) / trails.length})`, 1.5));
      // the launcher: an arrow as long as the speed
      const a = (ang * Math.PI) / 180, L = 18 + v * 1.2;
      arrow(ctx, X(0), Y(h0), X(0) + Math.cos(a) * L, Y(h0) - Math.sin(a) * L, INK, 2.5);
      text(ctx, `${ang}°`, X(0) + 10, Y(h0) - 8, INK);
      if (flight) {
        line(ctx, flight.pts.map(([x, y]) => [X(x), Y(y)]), C.gold, 2.5);
        const [bx, by] = flight.pts[flight.pts.length - 1];
        dot(ctx, X(bx), Y(by), 7, C.gold);
      }
      text(ctx, GRAVITY[gk][0] + ` · g = ${g()} m/s²`, w - 10, 20, DIM, 'right');
    });
    const tick = clock((dt) => {
      if (!flight) return false;
      const P = flight.P, speed = Math.max(1, P.T / 2.4); // long flights play faster
      flight.t = Math.min(P.T, flight.t + dt * speed);
      const t = flight.t;
      flight.pts.push([P.vx * t, Math.max(0, h0 + P.vy * t - (g() * t * t) / 2)]);
      cv.redraw();
      if (t >= P.T) { land(); return false; }
      return true;
    });
    function launch() {
      const P = plan();
      flight = { P, t: 0, pts: [[0, h0]] };
      tick.start();
    }
    function land() {
      const P = flight.P;
      trails.push({ pts: flight.pts, range: P.range, top: P.top });
      if (trails.length > 5) trails.shift();
      if (h0 === 0 && ang === 45) api.check(0);
      if (Math.abs(P.range - target) <= 2) { api.check(1); msg.textContent = `Hit! It landed ${num(P.range)} m away.`; }
      else msg.textContent = `Landed ${num(P.range)} m away — ${P.range < target ? 'short' : 'long'} by ${num(Math.abs(P.range - target))} m.`;
      planets.add(gk);
      if (gk === 'moon' && planets.has('earth')) api.check(2);
      flight = null;
      report();
    }
    const gg = group(panel, 'Launch');
    slider(gg, { label: 'Angle', min: 0, max: 90, value: ang, fmt: (x) => x + '°', onInput: (x) => { ang = x; report(); } });
    slider(gg, { label: 'Speed', min: 5, max: 50, value: v, fmt: (x) => x + ' m/s', onInput: (x) => { v = x; report(); } });
    slider(gg, { label: 'Launch height', min: 0, max: 30, value: h0, fmt: (x) => x + ' m', onInput: (x) => { h0 = x; report(); } });
    seg(group(panel, 'Where'), { options: Object.entries(GRAVITY).map(([k, [n]]) => [k, n]), value: gk, onChange: (k) => { gk = k; report(); } });
    const r1 = row(panel, 'lab-row-btns');
    button(r1, 'Launch', launch, 'main');
    button(r1, 'New target', () => { target = 15 + Math.round(Math.random() * 90); msg.textContent = ''; cv.redraw(); });
    button(r1, 'Clear paths', () => { trails.length = 0; cv.redraw(); });
    const msg = el('p', 'lab-note'); panel.appendChild(msg);
    const st = stats(panel);
    function report() {
      const P = plan();
      st.set([['Range', `${num(P.range)} m`], ['Highest point', `${num(P.top)} m`], ['Time in the air', `${num(P.T)} s`], ['Target', `${target} m`]]);
      cv.redraw();
    }
    report();
    return {
      state: () => { const P = plan(); return `launching at ${ang}° and ${v} m/s from ${h0} m high on ${GRAVITY[gk][0]} (g = ${g()} m/s²): it flies ${num(P.range)} m, rises to ${num(P.top)} m and is in the air for ${num(P.T)} s; the target is at ${target} m`; },
      destroy: () => { tick.stop(); cv.destroy(); },
    };
  },
};

/* ---------------- Pendulum ---------------- */
const pendulumLab = {
  id: 'pendulum', name: 'Pendulum', subject: 'physics', topic: 'pendulums: period, length, gravity, energy, and chaos in a double pendulum',
  blurb: 'Swing it and watch energy trade between height and speed. Try a double one for chaos.',
  words: 'pendulum period oscillation energy kinetic potential chaos double harmonic',
  icon: '<path d="M24 6v0M14 6h20"/><path d="M24 6l-8 26"/><circle cx="16" cy="34" r="5"/><path d="M8 36c4 6 12 6 16 4" stroke-dasharray="2 3"/>',
  tries: ['Make the period exactly 2 seconds (a “seconds pendulum”)', 'Swing it on the Moon — slower or faster?', 'Double: watch two almost identical pendulums drift apart'],
  mount({ stage, panel, api }) {
    let mode = 'single', L = 1.2, gk = 'earth', damp = 0.02, start = 35;
    let th = (start * Math.PI) / 180, om = 0, t = 0, crossings = [], period = 0, dragging = false;
    let dp = null, ghost = null, trail = [], gtrail = [], doubleTime = 0;
    const g = () => GRAVITY[gk][1];
    const resetDouble = () => {
      dp = [Math.PI * 0.75, 0, Math.PI * 0.9, 0]; ghost = [Math.PI * 0.75 + 0.001, 0, Math.PI * 0.9, 0]; trail = []; gtrail = []; doubleTime = 0;
    };
    function resetSingle() { th = (start * Math.PI) / 180; om = 0; t = 0; crossings = []; period = 0; }
    resetDouble();
    const deriv1 = (s) => [s[1], -(g() / L) * Math.sin(s[0]) - damp * s[1]];
    function deriv2(s) {
      const [a1, w1, a2, w2] = s, l1 = L / 2, l2 = L / 2, G = g(), d = a1 - a2, den = 3 - Math.cos(2 * d);
      return [w1, (-G * 3 * Math.sin(a1) - G * Math.sin(a1 - 2 * a2) - 2 * Math.sin(d) * (w2 * w2 * l2 + w1 * w1 * l1 * Math.cos(d))) / (l1 * den) - damp * 0.2 * w1,
        w2, (2 * Math.sin(d) * (w1 * w1 * l1 * 2 + G * 2 * Math.cos(a1) + w2 * w2 * l2 * Math.cos(d))) / (l2 * den) - damp * 0.2 * w2];
    }
    function rk4(s, f, h) {
      const k1 = f(s), k2 = f(s.map((v, i) => v + (h / 2) * k1[i])), k3 = f(s.map((v, i) => v + (h / 2) * k2[i])), k4 = f(s.map((v, i) => v + h * k3[i]));
      return s.map((v, i) => v + (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
    }
    let px = 0, pivot = [0, 0];
    const cv = canvas(stage, (ctx, w, h) => {
      // short strings look short, long ones still fit; the energy bars keep to the right edge
      const room = Math.max(L, 1.2), barsW = w < 520 ? 96 : 130;
      px = Math.min((h - 80) / (room * 1.05), (w - barsW - 30) / (2 * room * 1.02));
      pivot = [(w - barsW) / 2, 40];
      line(ctx, [[pivot[0] - 60, pivot[1]], [pivot[0] + 60, pivot[1]]], DIM, 3);
      if (mode === 'single') {
        const bx = pivot[0] + Math.sin(th) * L * px, by = pivot[1] + Math.cos(th) * L * px;
        ctx.setLineDash([2, 5]); ctx.strokeStyle = FAINT; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(pivot[0], pivot[1], L * px, Math.PI / 2 - 1.5, Math.PI / 2 + 1.5); ctx.stroke(); ctx.setLineDash([]);
        line(ctx, [pivot, [bx, by]], INK, 2);
        dot(ctx, bx, by, 15, C.gold);
        // energy bars (per kg)
        const PE = g() * L * (1 - Math.cos(th)), KE = 0.5 * (L * om) ** 2, E = PE + KE, max = Math.max(E, g() * L * (1 - Math.cos((start * Math.PI) / 180)), 0.01);
        const narrow = w < 520, bw = narrow ? 20 : 30, gap = narrow ? 11 : 12, bx0 = w - (bw * 3 + gap * 2) - 14, bh = Math.min(240, h - 120), top0 = 56;
        [[narrow ? 'PE' : 'height', PE, C.gold], [narrow ? 'KE' : 'speed', KE, C.blue], [narrow ? 'sum' : 'total', E, INK]].forEach(([n, v2, col], i) => {
          const x = bx0 + i * (bw + gap), hh = (v2 / max) * bh;
          ctx.fillStyle = 'rgba(255,255,255,.05)'; ctx.fillRect(x, top0, bw, bh);
          ctx.fillStyle = col; ctx.fillRect(x, top0 + bh - hh, bw, hh);
          text(ctx, n, x + bw / 2, top0 + bh + 16, DIM, 'center');
        });
        text(ctx, 'energy', bx0 + (bw * 3 + gap * 2) / 2, top0 - 8, INK, 'center');
      } else {
        const draw = (s, tr, col, alpha) => {
          const l1 = (L / 2) * px, x1 = pivot[0] + Math.sin(s[0]) * l1, y1 = pivot[1] + Math.cos(s[0]) * l1, x2 = x1 + Math.sin(s[2]) * l1, y2 = y1 + Math.cos(s[2]) * l1;
          if (tr.length > 1) { ctx.globalAlpha = alpha * 0.7; line(ctx, tr, col, 1.5); ctx.globalAlpha = 1; }
          ctx.globalAlpha = alpha; line(ctx, [pivot, [x1, y1], [x2, y2]], INK, 2); dot(ctx, x1, y1, 9, INK); dot(ctx, x2, y2, 11, col); ctx.globalAlpha = 1;
          return [x2, y2];
        };
        draw(ghost, gtrail, C.blue, 0.55);
        draw(dp, trail, C.gold, 1);
        text(ctx, 'two pendulums, started 0.001 rad apart', w / 2, h - 14, DIM, 'center');
      }
      text(ctx, `${GRAVITY[gk][0]} · L = ${num(L)} m`, 12, 20, DIM);
    });
    const tick = clock((dt) => {
      if (dragging) { cv.redraw(); return true; }
      const n = 8, hh = dt / n;
      for (let i = 0; i < n; i++) {
        if (mode === 'single') {
          const before = th;
          [th, om] = rk4([th, om], deriv1, hh);
          t += hh;
          if (before < 0 && th >= 0) { crossings.push(t); if (crossings.length > 1) period = crossings[crossings.length - 1] - crossings[crossings.length - 2]; if (crossings.length > 4) crossings.shift(); }
        } else {
          dp = rk4(dp, deriv2, hh); ghost = rk4(ghost, deriv2, hh); doubleTime += hh;
        }
      }
      if (mode === 'double') {
        const l1 = (L / 2) * px, tip = (s) => [pivot[0] + Math.sin(s[0]) * l1 + Math.sin(s[2]) * l1, pivot[1] + Math.cos(s[0]) * l1 + Math.cos(s[2]) * l1];
        trail.push(tip(dp)); gtrail.push(tip(ghost));
        if (trail.length > 500) { trail.shift(); gtrail.shift(); }
        if (doubleTime > 10) api.check(2);
      }
      if (period && Math.abs(period - 2) < 0.05 && mode === 'single') api.check(0);
      if (period && gk === 'moon') api.check(1);
      report(false);
      return true;
    });
    // drag the bob to where you want to let it go
    drag(cv.c, {
      down(p) { if (mode !== 'single') return false; dragging = true; set(p); },
      move: set,
      up() { dragging = false; om = 0; crossings = []; period = 0; },
    });
    function set(p) { th = Math.atan2(p.x - pivot[0], p.y - pivot[1]); om = 0; cv.redraw(); }
    seg(group(panel, 'Pendulum'), { options: [['single', 'Single'], ['double', 'Double (chaos)']], value: mode, onChange: (v) => { mode = v; resetSingle(); resetDouble(); report(); } });
    const gg = group(panel, 'Set it up');
    slider(gg, { label: 'Length', min: 0.2, max: 3, step: 0.01, value: L, fmt: (x) => num(x) + ' m', onInput: (x) => { L = x; crossings = []; period = 0; trail = []; gtrail = []; report(); } });
    slider(gg, { label: 'Let go from', min: 5, max: 170, value: start, fmt: (x) => x + '°', onInput: (x) => { start = x; resetSingle(); report(); } });
    slider(gg, { label: 'Air friction', min: 0, max: 0.5, step: 0.01, value: damp, onInput: (x) => { damp = x; } });
    seg(group(panel, 'Where'), { options: Object.entries(GRAVITY).map(([k, [n]]) => [k, n]), value: gk, onChange: (k) => { gk = k; crossings = []; period = 0; report(); } });
    const r1 = row(panel, 'lab-row-btns');
    const playB = button(r1, 'Pause', () => { if (tick.running) { tick.stop(); playB.textContent = 'Play'; } else { tick.start(); playB.textContent = 'Pause'; } }, 'main');
    button(r1, 'Let go again', () => { resetSingle(); resetDouble(); report(); });
    panel.appendChild(el('p', 'lab-note', 'Drag the ball to pull it back, then let go.'));
    const st = stats(panel);
    let shown = 0;
    function report(force = true) {
      const now = performance.now();
      if (!force && now - shown < 200) { cv.redraw(); return; }
      shown = now;
      const ideal = 2 * Math.PI * Math.sqrt(L / g());
      st.set(mode === 'single'
        ? [['Period (measured)', period ? `${num(period)} s` : 'swinging…'], ['Small-swing formula 2π√(L/g)', `${num(ideal)} s`], ['Angle now', `${num((th * 180) / Math.PI)}°`]]
        : [['Running', `${num(doubleTime)} s`], ['Gap between the two', `${num(Math.abs(dp[2] - ghost[2]))} rad`]]);
      cv.redraw();
    }
    report(); tick.start();
    return {
      state: () => (mode === 'single'
        ? `a single pendulum ${num(L)} m long on ${GRAVITY[gk][0]} (g = ${g()} m/s²), let go from ${start}°, air friction ${damp}; measured period ${period ? num(period) + ' s' : 'not measured yet'}, the small-swing formula 2π√(L/g) gives ${num(2 * Math.PI * Math.sqrt(L / g()))} s`
        : `a double pendulum (two arms of ${num(L / 2)} m) next to a copy started 0.001 rad differently; after ${num(doubleTime)} s their lower arms are ${num(Math.abs(dp[2] - ghost[2]))} rad apart`),
      destroy: () => { tick.stop(); cv.destroy(); },
    };
  },
};

/* ---------------- Waves on a string ---------------- */
const wavesLab = {
  id: 'waves', name: 'Wave string', subject: 'physics', topic: 'waves: wavelength, frequency, speed, reflection and standing waves',
  blurb: 'Wiggle one end of a string. Watch waves travel, bounce back and stand still.',
  words: 'wave wavelength frequency amplitude reflection standing wave string',
  icon: '<path d="M4 24c4-10 8-10 12 0s8 10 12 0 8-10 12 0 4 6 4 6"/><path d="M4 14v20M44 18v12"/>',
  tries: ['Send a pulse at a fixed end — does it come back upside down?', 'Send a pulse at a loose end — what changes?', 'Make a standing wave (fixed end + steady wiggle)'],
  mount({ stage, panel, api }) {
    const N = 200, LEN = 10, STEP = 1 / 600;
    let y = new Float32Array(N), prev = new Float32Array(N), next = new Float32Array(N);
    let mode = 'wiggle', end = 'fixed', freq = 1.5, amp = 0.5, damp = 0.004, cc = 0.9, time = 0, pulseAt = -1, pulled = -1, steadyFor = 0;
    const speed = () => (cc * (LEN / (N - 1))) / STEP; // m/s
    const cv = canvas(stage, (ctx, w, h) => {
      const L = 40, R = w - 30, mid = h / 2, sy = Math.min(70, h / 5), X = (i) => L + ((R - L) * i) / (N - 1);
      for (let m = 0; m <= LEN; m++) { const x = L + ((R - L) * m) / LEN; line(ctx, [[x, mid + sy * 2.2], [x, mid + sy * 2.2 + 6]], DIM, 1); if (m % 2 === 0) text(ctx, m + ' m', x, mid + sy * 2.2 + 20, DIM, 'center'); }
      line(ctx, [[L, mid], [R, mid]], GRID, 1);
      // the end: a clamp, a ring on a rod, or a fade (the wave leaves)
      if (end === 'fixed') { ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fillRect(R, mid - sy * 1.6, 10, sy * 3.2); }
      else if (end === 'loose') { line(ctx, [[R + 4, mid - sy * 1.6], [R + 4, mid + sy * 1.6]], DIM, 3); }
      ctx.strokeStyle = C.gold; ctx.lineWidth = 2.5; ctx.beginPath();
      for (let i = 0; i < N; i++) { const px = X(i), py = mid - y[i] * sy; if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); }
      ctx.stroke();
      for (let i = 0; i < N; i += 10) dot(ctx, X(i), mid - y[i] * sy, i === 0 ? 8 : 3, i === 0 ? INK : C.gold);
      if (end === 'loose') dot(ctx, R + 4, mid - y[N - 1] * sy, 6, INK);
      if (end === 'none') text(ctx, 'the string goes on (no reflection)', R, mid - sy * 1.9, DIM, 'right');
    });
    const tick = clock((dt) => {
      const steps = Math.round(dt / STEP);
      for (let s = 0; s < steps; s++) {
        time += STEP;
        for (let i = 1; i < N - 1; i++) next[i] = (2 * y[i] - prev[i] + cc * cc * (y[i + 1] - 2 * y[i] + y[i - 1])) * (1 - damp) ;
        // the hand at the left end
        if (mode === 'wiggle') next[0] = amp * Math.sin(2 * Math.PI * freq * time);
        else { const tp = time - pulseAt; next[0] = pulseAt >= 0 && tp < 0.5 ? amp * 1.4 * Math.exp(-(((tp - 0.25) / 0.08) ** 2)) : 0; }
        if (pulled >= 0) next[pulled] = y[pulled];
        if (end === 'fixed') next[N - 1] = 0;
        else if (end === 'loose') next[N - 1] = next[N - 2];
        else next[N - 1] = y[N - 2] + ((cc - 1) / (cc + 1)) * (next[N - 2] - y[N - 1]);
        [prev, y, next] = [y, next, prev];
      }
      // a pulse that went there and back
      if (mode === 'pulse' && pulseAt >= 0 && time - pulseAt > (2 * LEN) / speed() + 0.3) {
        if (end === 'fixed') api.check(0);
        if (end === 'loose') api.check(1);
      }
      if (mode === 'wiggle' && end === 'fixed') {
        const n = Math.round((2 * LEN * freq) / speed());
        steadyFor = n >= 1 && Math.abs(freq - (n * speed()) / (2 * LEN)) / freq < 0.04 ? steadyFor + dt : 0;
        if (steadyFor > 6) api.check(2);
      }
      cv.redraw();
      return true;
    });
    // pluck: drag a point of the string
    drag(cv.c, {
      down(p) { const i = Math.round(((p.x - 40) / (cv.w - 70)) * (N - 1)); if (i < 2 || i > N - 3) return false; pulled = i; pull(p); },
      move: pull,
      up() { pulled = -1; },
    });
    function pull(p) {
      const sy = Math.min(70, cv.h / 5), v = Math.max(-1.6, Math.min(1.6, (cv.h / 2 - p.y) / sy));
      for (let k = -8; k <= 8; k++) { const i = pulled + k; if (i > 0 && i < N - 1) { const wgt = Math.exp(-(k * k) / 18); y[i] = prev[i] = y[i] * (1 - wgt) + v * wgt; } }
    }
    const still = () => { y.fill(0); prev.fill(0); next.fill(0); time = 0; pulseAt = -1; steadyFor = 0; };
    const handS = seg(group(panel, 'Your hand'), { options: [['wiggle', 'Keep wiggling'], ['pulse', 'One pulse']], value: mode, onChange: (v) => { mode = v; still(); report(); } });
    seg(group(panel, 'The far end'), { options: [['fixed', 'Fixed'], ['loose', 'Loose'], ['none', 'Goes on']], value: end, onChange: (v) => { end = v; still(); report(); } });
    const gg = group(panel, 'Wave');
    slider(gg, { label: 'Frequency', min: 0.2, max: 5, step: 0.05, value: freq, fmt: (x) => num(x) + ' Hz', onInput: (x) => { freq = x; report(); } });
    slider(gg, { label: 'Amplitude', min: 0.1, max: 1, step: 0.05, value: amp, onInput: (x) => { amp = x; } });
    slider(gg, { label: 'Tension (wave speed)', min: 0.3, max: 1, step: 0.05, value: cc, fmt: () => num(speed()) + ' m/s', onInput: (x) => { cc = x; report(); } });
    slider(gg, { label: 'Damping', min: 0, max: 0.02, step: 0.001, value: damp, onInput: (x) => { damp = x; } });
    const r1 = row(panel, 'lab-row-btns');
    button(r1, 'Send a pulse', () => { if (mode !== 'pulse') { mode = 'pulse'; handS.set('pulse'); still(); } pulseAt = time; report(); }, 'main');
    button(r1, 'Calm the string', () => { still(); });
    panel.appendChild(el('p', 'lab-note', 'Drag the string anywhere to pluck it.'));
    const st = stats(panel);
    function report() {
      const v = speed(), lam = v / freq, n1 = v / (2 * LEN);
      st.set([['Wave speed v', `${num(v)} m/s`], ['Wavelength λ = v ÷ f', mode === 'wiggle' ? `${num(lam)} m` : '—'], ['Standing-wave frequencies', `${num(n1)}, ${num(2 * n1)}, ${num(3 * n1)} Hz…`]]);
    }
    report(); tick.start();
    return {
      state: () => `a 10 m string, wave speed ${num(speed())} m/s; my hand is ${mode === 'wiggle' ? `wiggling at ${num(freq)} Hz (wavelength ${num(speed() / freq)} m)` : 'sending single pulses'}; the far end is ${end === 'fixed' ? 'fixed' : end === 'loose' ? 'loose (free to slide)' : 'open — the wave just leaves'}`,
      destroy: () => { tick.stop(); cv.destroy(); },
    };
  },
};

/* ---------------- Bending light ---------------- */
const MEDIA = { air: ['Air', 1.0], water: ['Water', 1.33], glass: ['Glass', 1.5], diamond: ['Diamond', 2.42] };
const lightLab = {
  id: 'refraction', name: 'Bending light', subject: 'physics', topic: 'refraction, Snell’s law and total internal reflection',
  blurb: 'Aim a laser into water, glass or diamond and watch it bend — or bounce right back.',
  words: 'light refraction snell law reflection total internal critical angle optics laser index',
  icon: '<path d="M4 26h40"/><path d="M8 6l16 20 8 18"/><path d="M24 26l16-20" stroke-dasharray="3 3"/>',
  tries: ['Shine straight down — does it bend?', 'Make total internal reflection happen', 'Find the critical angle from water into air'],
  mount({ stage, panel, api }) {
    let top = 'air', bottom = 'water', ang = 40;
    const n1 = () => MEDIA[top][1], n2 = () => MEDIA[bottom][1];
    const calc = () => {
      const a = (ang * Math.PI) / 180, s = (n1() * Math.sin(a)) / n2();
      const tir = s > 1, b = tir ? null : Math.asin(s);
      // how much bounces back (Fresnel, light that isn't polarised)
      let R = 1;
      if (!tir) { const c1 = Math.cos(a), c2 = Math.cos(b), rs = ((n1() * c1 - n2() * c2) / (n1() * c1 + n2() * c2)) ** 2, rp = ((n1() * c2 - n2() * c1) / (n1() * c2 + n2() * c1)) ** 2; R = (rs + rp) / 2; }
      const crit = n1() > n2() ? (Math.asin(n2() / n1()) * 180) / Math.PI : null;
      return { a, b, tir, R, crit };
    };
    let O = [0, 0], len = 100;
    const cv = canvas(stage, (ctx, w, h) => {
      O = [w / 2, h / 2]; len = Math.min(w, h) * 0.45;
      const tint = { air: 'rgba(255,255,255,0)', water: 'rgba(127,178,255,.13)', glass: 'rgba(160,230,220,.12)', diamond: 'rgba(220,210,255,.16)' };
      ctx.fillStyle = tint[top]; ctx.fillRect(0, 0, w, O[1]);
      ctx.fillStyle = tint[bottom]; ctx.fillRect(0, O[1], w, h - O[1]);
      line(ctx, [[0, O[1]], [w, O[1]]], DIM, 1.5);
      text(ctx, `${MEDIA[top][0]} (n = ${n1()})`, 12, 22, INK);
      text(ctx, `${MEDIA[bottom][0]} (n = ${n2()})`, 12, h - 14, INK);
      ctx.setLineDash([5, 5]); line(ctx, [[O[0], O[1] - len], [O[0], O[1] + len]], FAINT, 1); ctx.setLineDash([]);
      const k = calc(), red = (al) => `rgba(255,90,90,${al})`;
      const from = [O[0] - Math.sin(k.a) * len, O[1] - Math.cos(k.a) * len];
      // the laser
      ctx.save(); ctx.translate(from[0], from[1]); ctx.rotate(Math.PI / 2 - k.a); ctx.fillStyle = '#d8d8de'; ctx.fillRect(-34, -8, 34, 16); ctx.fillStyle = '#16171c'; ctx.fillRect(-6, -4, 6, 8); ctx.restore();
      line(ctx, [from, O], red(1), 3);
      line(ctx, [O, [O[0] + Math.sin(k.a) * len, O[1] - Math.cos(k.a) * len]], red(Math.max(0.08, k.R)), 3);
      if (!k.tir) line(ctx, [O, [O[0] + Math.sin(k.b) * len, O[1] + Math.cos(k.b) * len]], red(Math.max(0.15, 1 - k.R)), 3);
      dot(ctx, O[0], O[1], 4, INK);
      // the angles, measured from the dashed line (the normal)
      ctx.strokeStyle = INK; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(O[0], O[1], 46, -Math.PI / 2 - k.a, -Math.PI / 2); ctx.stroke();
      text(ctx, `${num(ang)}°`, O[0] - 16 - Math.sin(k.a / 2) * 60, O[1] - Math.cos(k.a / 2) * 60, INK, 'center');
      if (!k.tir) { ctx.beginPath(); ctx.arc(O[0], O[1], 46, Math.PI / 2 - k.b, Math.PI / 2); ctx.stroke(); text(ctx, `${num((k.b * 180) / Math.PI)}°`, O[0] + 14 + Math.sin(k.b / 2) * 62, O[1] + Math.cos(k.b / 2) * 62, INK, 'center'); }
      else text(ctx, 'Total internal reflection — no light gets through', O[0], O[1] + 40, C.gold, 'center');
    });
    function report() {
      const k = calc();
      st.set([['Angle in', `${num(ang)}°`], ['Angle out', k.tir ? 'none — it all reflects' : `${num((k.b * 180) / Math.PI)}°`], ['Reflected', `${num(k.R * 100)}%`], ['Critical angle', k.crit ? `${num(k.crit)}°` : 'none (light goes into a denser material)'], ['Light speed', `${num(299792 / n1())} → ${num(299792 / n2())} km/s`]]);
      if (ang <= 0.5) api.check(0);
      if (k.tir) api.check(1);
      if (top === 'water' && bottom === 'air' && Math.abs(ang - 48.75) < 0.6) api.check(2);
      cv.redraw();
    }
    // drag the laser round
    drag(cv.c, { down: aim, move: aim });
    function aim(p) {
      if (p.y > O[1] - 4) return;
      ang = Math.round(Math.min(89, Math.abs((Math.atan2(O[0] - p.x, O[1] - p.y) * 180) / Math.PI)) * 4) / 4;
      aS.set(ang); report();
    }
    const aS = slider(group(panel, 'Laser'), { label: 'Angle from the normal', min: 0, max: 89, step: 0.25, value: ang, fmt: (x) => num(x) + '°', onInput: (x) => { ang = x; report(); } });
    const opts = Object.entries(MEDIA).map(([k, [n]]) => [k, n]);
    seg(group(panel, 'Top (where the laser is)'), { options: opts, value: top, onChange: (v) => { top = v; report(); } });
    seg(group(panel, 'Bottom'), { options: opts, value: bottom, onChange: (v) => { bottom = v; report(); } });
    panel.appendChild(el('p', 'lab-note', 'Drag the laser to aim it. Snell’s law: n₁ sin θ₁ = n₂ sin θ₂.'));
    const st = stats(panel);
    report();
    return {
      state: () => { const k = calc(); return `a laser in ${MEDIA[top][0].toLowerCase()} (n = ${n1()}) hits ${MEDIA[bottom][0].toLowerCase()} (n = ${n2()}) at ${num(ang)}° from the normal; ${k.tir ? 'it is totally internally reflected' : `it bends to ${num((k.b * 180) / Math.PI)}° and ${num(k.R * 100)}% reflects`}${k.crit ? `; the critical angle is ${num(k.crit)}°` : ''}`; },
      destroy: () => cv.destroy(),
    };
  },
};

export const PHYSICS = [projectileLab, pendulumLab, wavesLab, lightLab];

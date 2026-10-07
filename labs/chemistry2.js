/* More chemistry: heating ice into steam (the heating curve), and dropping metals into water
   (the reactivity series). */
import { INK, DIM, FAINT, GRID, C, el, esc, num, canvas, clock, group, slider, seg, button, row, stats, line, dot, text, overlay } from './kit.js';

/* ---------------- Ice to steam ---------------- */
// per kilogram, at normal air pressure (1 atm)
const ICE_C = 2090, WATER_C = 4180, STEAM_C = 2010, MELT = 334000, BOIL = 2257000, START = -20, END = 150;
function stateOf(m, Q) {
  const seg1 = m * ICE_C * (0 - START), seg2 = seg1 + m * MELT, seg3 = seg2 + m * WATER_C * 100, seg4 = seg3 + m * BOIL, seg5 = seg4 + m * STEAM_C * (END - 100);
  if (Q <= seg1) return { T: START + Q / (m * ICE_C), phase: 'ice', f: 0, segs: [seg1, seg2, seg3, seg4, seg5] };
  if (Q <= seg2) return { T: 0, phase: 'melting', f: (Q - seg1) / (m * MELT), segs: [seg1, seg2, seg3, seg4, seg5] };
  if (Q <= seg3) return { T: (Q - seg2) / (m * WATER_C), phase: 'water', f: 1, segs: [seg1, seg2, seg3, seg4, seg5] };
  if (Q <= seg4) return { T: 100, phase: 'boiling', f: (Q - seg3) / (m * BOIL), segs: [seg1, seg2, seg3, seg4, seg5] };
  return { T: 100 + Math.min(Q - seg4, seg5 - seg4) / (m * STEAM_C), phase: 'steam', f: 1, segs: [seg1, seg2, seg3, seg4, seg5] };
}
const iceLab = {
  id: 'ice-steam', name: 'Ice to steam', subject: 'chemistry', topic: 'changes of state: heating curves, melting and boiling points, specific heat and latent heat',
  blurb: 'Heat ice until it melts and boils — the thermometer stops while it changes state. Watch the molecules too.',
  words: 'heating curve melting boiling evaporation latent heat specific heat states of matter solid liquid gas particles',
  icon: '<path d="M18 6v24a7 7 0 1 0 6 0V6a3 3 0 0 0-6 0z"/><circle cx="21" cy="36" r="3"/><path d="M32 14c3 3 3 6 0 9M38 12c4 4 4 10 0 14"/>',
  tries: ['Melt all the ice — what does the thermometer do while it melts?', 'Boil all the water away into steam', 'Cool the steam all the way back into ice'],
  hints: ['Press Heat and watch the temperature when it reaches 0 °C. Speed up time if it’s slow.', 'Keep heating. Boiling takes much longer than melting — compare the flat parts of the graph.', 'Once it’s all steam, press Cool and wait for it to freeze completely.'],
  about: 'Uses real values for water at normal air pressure: ice warms by 1 °C for every 2.09 kJ per kg, liquid water needs 4.18 kJ per kg (that is its specific heat capacity), steam 2.01 kJ.\nMelting needs 334 kJ per kg and boiling 2,257 kJ per kg (latent heats) — the temperature stays at 0 °C or 100 °C while that energy breaks the bonds between molecules.\nAssumes all the heater’s energy goes into the water (none is lost to the air or the container), and that the steam stays in a closed container. Water boils at 100 °C only at sea-level pressure; up a mountain it boils at a lower temperature.\nThe molecule picture is a cartoon: real molecules are far smaller and more numerous.',
  mount({ stage, panel, api }) {
    let m = 1, P = 1000, speed = 50, heating = 0, Q = 0, wasSteam = false;
    const N = 42, mol = Array.from({ length: N }, (_, i) => ({ i, x: Math.random(), y: Math.random(), vx: 0, vy: 0 }));
    const maxQ = () => stateOf(m, 0).segs[4];
    const cv = canvas(stage, (ctx, w, h) => {
      const S = stateOf(m, Q), wide = w > 640;
      // the heating curve
      const gx = 56, gy = 30, gw = wide ? w * 0.55 : w - 80, gh = wide ? h - 80 : h * 0.42;
      const X = (q) => gx + (q / maxQ()) * gw, Y = (t) => gy + gh - ((t - START) / (END - START)) * gh;
      ctx.strokeStyle = GRID; ctx.strokeRect(gx, gy, gw, gh);
      [START, 0, 50, 100, 150].forEach((t) => { line(ctx, [[gx, Y(t)], [gx + gw, Y(t)]], GRID, 1); text(ctx, `${t} °C`, gx - 6, Y(t) + 4, DIM, 'right'); });
      const pts = []; for (let k = 0; k <= 300; k++) { const q = (maxQ() * k) / 300; pts.push([X(q), Y(stateOf(m, q).T)]); }
      line(ctx, pts, FAINT, 2);
      const done = []; for (let k = 0; k <= 300; k++) { const q = (Q * k) / 300; done.push([X(q), Y(stateOf(m, q).T)]); }
      line(ctx, done, C.gold, 3);
      dot(ctx, X(Q), Y(S.T), 6, C.gold);
      const [s1, s2, s3, s4] = S.segs;
      text(ctx, 'melting', (X(s1) + X(s2)) / 2, Y(0) - 8, DIM, 'center');
      text(ctx, 'boiling', (X(s3) + X(s4)) / 2, Y(100) - 8, DIM, 'center');
      text(ctx, 'energy added →', gx + gw, gy + gh + 18, DIM, 'right');
      // the molecules
      const bx = wide ? gx + gw + 30 : gx, by = wide ? gy : gy + gh + 30, bw = wide ? w - bx - 20 : gw, bh = wide ? gh : h - by - 16;
      ctx.strokeStyle = DIM; ctx.lineWidth = 1.5; ctx.strokeRect(bx, by, bw, bh);
      const col = S.phase === 'ice' || (S.phase === 'melting') ? '#bfe3ff' : S.phase === 'steam' || S.phase === 'boiling' ? '#e8f2ff' : '#7fb2ff';
      mol.forEach((p) => dot(ctx, bx + p.x * bw, by + p.y * bh, Math.max(3, Math.min(bw, bh) / 34), p.gas ? '#e8f2ff' : p.solid ? '#bfe3ff' : '#7fb2ff'));
      text(ctx, S.phase === 'melting' ? 'ice and water' : S.phase === 'boiling' ? 'water and steam' : S.phase, bx + bw / 2, by - 8, col, 'center');
      text(ctx, `${num(S.T)} °C`, gx + 6, gy + 18, INK);
    });
    // where each molecule goes: a neat lattice (solid), a jostling crowd (liquid) or flying everywhere (gas)
    function moveMolecules(dt) {
      const S = stateOf(m, Q), kT = Math.sqrt((S.T + 273) / 273), cols = 7;
      const nSolid = S.phase === 'ice' ? N : S.phase === 'melting' ? Math.round(N * (1 - S.f)) : 0;
      const nGas = S.phase === 'steam' ? N : S.phase === 'boiling' ? Math.round(N * S.f) : 0;
      mol.forEach((p, k) => {
        p.solid = k < nSolid; p.gas = k >= N - nGas;
        if (p.solid) {
          const hx = 0.2 + ((k % cols) / (cols - 1)) * 0.6, hy = 0.42 + Math.floor(k / cols) * 0.09, j = 0.004 * kT;
          p.x += (hx - p.x) * 0.2 + (Math.random() - 0.5) * j; p.y += (hy - p.y) * 0.2 + (Math.random() - 0.5) * j; p.vx = p.vy = 0;
        } else if (p.gas) {
          if (!p.vx && !p.vy) { const a = Math.random() * Math.PI * 2; p.vx = Math.cos(a); p.vy = Math.sin(a); }
          const sp = 0.6 * kT; const n = Math.hypot(p.vx, p.vy) || 1; p.vx = (p.vx / n) * sp; p.vy = (p.vy / n) * sp;
          p.x += p.vx * dt; p.y += p.vy * dt;
          if (p.x < 0.03 || p.x > 0.97) p.vx *= -1; if (p.y < 0.03 || p.y > 0.97) p.vy *= -1;
          p.x = Math.max(0.03, Math.min(0.97, p.x)); p.y = Math.max(0.03, Math.min(0.97, p.y));
        } else {
          // liquid: wander about in the bottom of the box, close together
          p.vx = p.vx * 0.9 + (Math.random() - 0.5) * 0.25 * kT; p.vy = p.vy * 0.9 + (Math.random() - 0.5) * 0.25 * kT + 0.02;
          p.x += p.vx * dt; p.y += p.vy * dt;
          p.x = Math.max(0.04, Math.min(0.96, p.x)); p.y = Math.max(0.5, Math.min(0.96, p.y));
        }
      });
    }
    const tick = clock((dt) => {
      if (heating) {
        Q = Math.max(0, Math.min(maxQ(), Q + heating * P * dt * speed));
        const S = stateOf(m, Q);
        if (S.phase === 'water' || S.T > 0) { if (Q >= S.segs[1]) api.check(0); }
        if (Q >= S.segs[3]) { api.check(1); wasSteam = true; }
        if (wasSteam && Q <= S.segs[0] && heating < 0) api.check(2);
        if ((heating > 0 && Q >= maxQ()) || (heating < 0 && Q <= 0)) { heating = 0; heatB.textContent = 'Heat'; coolB.textContent = 'Cool'; }
      }
      moveMolecules(dt);
      report(true);
      return true;
    });
    const ov = overlay(stage, 'br');
    const heatB = button(ov, 'Heat', () => { heating = heating > 0 ? 0 : 1; heatB.textContent = heating > 0 ? 'Stop' : 'Heat'; coolB.textContent = 'Cool'; }, 'main big');
    const coolB = button(ov, 'Cool', () => { heating = heating < 0 ? 0 : -1; coolB.textContent = heating < 0 ? 'Stop' : 'Cool'; heatB.textContent = 'Heat'; }, 'big');
    const g = group(panel, 'Set up');
    slider(g, { label: 'Mass of water', min: 0.1, max: 2, step: 0.1, value: m, fmt: (x) => num(x) + ' kg', onInput: (x) => { const f = Q / maxQ(); m = x; Q = f * maxQ(); report(); } });
    slider(g, { label: 'Heater power', min: 200, max: 3000, step: 100, value: P, fmt: (x) => x + ' W', onInput: (x) => { P = x; report(); } });
    seg(group(panel, 'Speed up time'), { options: [[1, 'Real time'], [10, '× 10'], [50, '× 50'], [200, '× 200']], value: speed, onChange: (v) => { speed = v; } });
    button(row(panel, 'lab-row-btns'), 'Start again with ice at −20 °C', () => { Q = 0; heating = 0; wasSteam = false; heatB.textContent = 'Heat'; coolB.textContent = 'Cool'; report(); });
    const st = stats(panel);
    let shown = 0;
    function report(soft) {
      const now = performance.now(); if (soft && now - shown < 200) { cv.redraw(); return; } shown = now;
      const S = stateOf(m, Q);
      const state = S.phase === 'melting' ? `melting — ${Math.round(S.f * 100)}% is water` : S.phase === 'boiling' ? `boiling — ${Math.round(S.f * 100)}% is steam` : S.phase;
      st.set([['Temperature', `${num(S.T)} °C`], ['State', state], ['Energy added', `${num(Q / 1000)} kJ`], ['Time with this heater', `${num(Q / P / 60)} minutes`], ['To melt it all', `${num((m * MELT) / 1000)} kJ`], ['To boil it all', `${num((m * BOIL) / 1000)} kJ`]]);
      cv.redraw();
    }
    report(); tick.start();
    return { state: () => { const S = stateOf(m, Q); return `${m} kg of water starting as ice at −20 °C, heated by a ${P} W heater: now ${num(S.T)} °C and ${S.phase}${S.phase === 'melting' || S.phase === 'boiling' ? ` (${Math.round(S.f * 100)}% changed)` : ''}, after ${num(Q / 1000)} kJ of energy`; }, destroy: () => { tick.stop(); cv.destroy(); } };
  },
};

/* ---------------- Metals in water ---------------- */
// [name, symbol, density g/cm³, reaction in cold water (0–1), with steam (0–1 or null if it already reacts with cold water), flame colour, notes, cold-water equation, steam equation]
const METALS = [
  ['Potassium', 'K', 0.86, 1, null, '#c38cff', 'Floats, melts into a shiny ball and whizzes about. The hydrogen catches fire with a lilac flame, often with a crackle. The water turns alkaline.', '2K + 2H₂O → 2KOH + H₂'],
  ['Sodium', 'Na', 0.97, 0.75, null, '#ffb347', 'Floats, melts into a ball and fizzes as it skates around. It may burst into a yellow-orange flame. The water turns alkaline.', '2Na + 2H₂O → 2NaOH + H₂'],
  ['Lithium', 'Li', 0.53, 0.42, null, null, 'Floats and fizzes steadily, but does not melt or catch fire. The water turns alkaline.', '2Li + 2H₂O → 2LiOH + H₂'],
  ['Calcium', 'Ca', 1.55, 0.32, null, null, 'Sinks and fizzes steadily. The water goes cloudy because calcium hydroxide only partly dissolves.', 'Ca + 2H₂O → Ca(OH)₂ + H₂'],
  ['Magnesium', 'Mg', 1.74, 0.03, 0.85, '#ffffff', 'In cold water: only a few tiny bubbles, over hours or days. Heated in steam it burns with a dazzling white light, leaving white magnesium oxide.', 'Mg + 2H₂O → Mg(OH)₂ + H₂ (very slow)', 'Mg + H₂O → MgO + H₂'],
  ['Zinc', 'Zn', 7.14, 0, 0.3, null, 'No reaction with cold water. Heated in steam it reacts to make zinc oxide (yellow while hot, white when cool).', 'no reaction', 'Zn + H₂O → ZnO + H₂'],
  ['Iron', 'Fe', 7.87, 0, 0.2, null, 'No quick reaction with cold water (with oxygen it slowly rusts over days). Red-hot iron reacts with steam to make black iron oxide.', 'no quick reaction (rusts slowly with water and air)', '3Fe + 4H₂O → Fe₃O₄ + 4H₂'],
  ['Copper', 'Cu', 8.96, 0, 0, null, 'No reaction with water or steam — that is why copper is used for water pipes.', 'no reaction', 'no reaction'],
  ['Gold', 'Au', 19.3, 0, 0, null, 'No reaction at all — gold stays shiny for thousands of years.', 'no reaction', 'no reaction'],
];
const metalsLab = {
  id: 'metals', name: 'Metals in water', subject: 'chemistry', topic: 'the reactivity series: reactions of metals with water and steam',
  blurb: 'Drop potassium, sodium, magnesium or gold into water (or steam) and compare how they react.',
  words: 'reactivity series metals water steam hydrogen alkali potassium sodium lithium calcium magnesium zinc iron copper gold',
  icon: '<path d="M10 16h28l-3 26H13z"/><path d="M12 26h24"/><rect x="21" y="8" width="7" height="7" rx="1"/><circle cx="18" cy="33" r="1.5"/><circle cx="26" cy="30" r="1.5"/><circle cx="30" cy="36" r="1.5"/>',
  tries: ['Find a metal that floats and fizzes', 'Find the metal whose flame is lilac', 'Make magnesium react quickly'],
  hints: ['Try the metals at the top of the reactivity series. Which are lighter than water?', 'It’s the most reactive metal in the list.', 'Magnesium barely reacts with cold water. Switch to “Steam”.'],
  about: 'Observations follow what happens in a school demonstration with small pieces. Metals higher in the reactivity series react faster: K > Na > Li > Ca > Mg > Zn > Fe > Cu > Au. (Lithium is sometimes listed above sodium by electrode potential, but with water it reacts more gently, as shown here.)\nThe pink colour is phenolphthalein indicator turning pink where the metal hydroxide (an alkali) forms. Every reaction with water or steam that happens here gives off hydrogen gas.\nSafety: potassium, sodium and lithium are only handled by teachers, in tiny pieces, behind a safety screen.',
  mount({ stage, panel, api }) {
    let pick = 0, steam = false, run = null;
    const bubbles = [];
    const cv = canvas(stage, (ctx, w, h) => {
      const M = METALS[pick], bw = Math.min(260, w * 0.5), bx = w * 0.3 - bw / 2 + 20, by = h * 0.2, bh = h * 0.6;
      if (!steam) {
        const pink = run ? Math.min(0.55, run.progress * (M[3] > 0.1 ? 0.7 : 0.25)) : 0;
        const cloudy = M[1] === 'Ca' && run ? Math.min(0.5, run.progress * 0.6) : 0;
        ctx.fillStyle = `rgba(${100 + 155 * (pink + cloudy)}, ${150 + 60 * cloudy}, ${255 - 40 * pink}, ${0.25 + pink * 0.6 + cloudy * 0.4})`;
        ctx.fillRect(bx, by + 20, bw, bh - 20);
        ctx.strokeStyle = INK; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(bx, by - 10); ctx.lineTo(bx, by + bh); ctx.lineTo(bx + bw, by + bh); ctx.lineTo(bx + bw, by - 10); ctx.stroke();
        bubbles.forEach((b) => { ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(bx + b.x * bw, by + 20 + b.y * (bh - 20), b.r, 0, Math.PI * 2); ctx.stroke(); });
        if (run) {
          const floats = M[2] < 1, size = Math.max(0, 14 * (1 - run.used)), melted = M[3] >= 0.7;
          const x = bx + run.x * bw, y = run.y < 0 ? by + 20 + run.y * 60 : floats ? by + 20 - size * 0.4 : by + bh - size - 3;
          if (size > 0.5) {
            ctx.fillStyle = '#cfcfd4';
            if (melted && run.y >= 0) { ctx.beginPath(); ctx.arc(x, y, size * 0.8, 0, Math.PI * 2); ctx.fill(); } else ctx.fillRect(x - size / 2, y - size / 2, size, size);
            // the flame (burning hydrogen)
            if (M[5] && M[3] >= 0.7 && run.y >= 0 && (M[1] === 'K' || Math.random() < 0.35)) {
              for (let k = 0; k < 6; k++) { ctx.fillStyle = M[5] + 'aa'; ctx.beginPath(); ctx.arc(x + (Math.random() - 0.5) * 10, y - 8 - Math.random() * 22, 3 + Math.random() * 5, 0, Math.PI * 2); ctx.fill(); }
            }
          }
        }
        text(ctx, 'water + phenolphthalein', bx + bw / 2, by + bh + 22, DIM, 'center');
      } else {
        // a heated tube: steam passes over the metal
        const ty = h * 0.42, tx = w * 0.08, tw = Math.min(w * 0.55, 420);
        ctx.strokeStyle = INK; ctx.lineWidth = 3; ctx.strokeRect(tx, ty - 22, tw, 44);
        for (let k = 0; k < 8; k++) { const a = (performance.now() / 300 + k) % 8; dot(ctx, tx + 10 + a * (tw / 8), ty + Math.sin(a * 2 + k) * 8, 3, 'rgba(255,255,255,.4)'); }
        const glow = run ? M[4] * (1 - run.used) : 0, mx = tx + tw * 0.6;
        if (glow > 0.05 && M[1] === 'Mg') { const g = ctx.createRadialGradient(mx, ty, 0, mx, ty, 60); g.addColorStop(0, 'rgba(255,255,255,.95)'); g.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(mx, ty, 60, 0, Math.PI * 2); ctx.fill(); }
        ctx.fillStyle = run && run.used > 0.5 && M[4] > 0 ? (M[1] === 'Fe' ? '#2b2b2b' : M[1] === 'Zn' ? (glow > 0.05 ? '#f0e070' : '#f2f2f2') : '#f2f2f2') : '#bdbdc2';
        ctx.fillRect(mx - 18, ty - 6, 36, 12);
        // the burner
        ctx.fillStyle = 'rgba(80,140,255,.7)'; ctx.beginPath(); ctx.moveTo(mx - 14, ty + 60); ctx.quadraticCurveTo(mx, ty + 20, mx + 14, ty + 60); ctx.fill();
        text(ctx, 'steam →', tx + 4, ty - 30, DIM);
        text(ctx, 'heated metal', mx, ty + 80, DIM, 'center');
      }
      // the reactivity series
      const sx = w - 150, sy = 30;
      text(ctx, 'most reactive', sx, sy, DIM);
      METALS.forEach((mm, i) => { const y = sy + 22 + i * 22; if (i === pick) { ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.fillRect(sx - 6, y - 15, 140, 20); } text(ctx, `${mm[1].padEnd(3)} ${mm[0]}`, sx, y, i === pick ? INK : DIM); });
      text(ctx, 'least reactive', sx, sy + 22 + METALS.length * 22 + 4, DIM);
    });
    const tick = clock((dt) => {
      const M = METALS[pick];
      if (run) {
        if (run.y < 0) run.y = Math.min(0, run.y + dt * 2.5);
        else {
          const rate = steam ? (M[4] || 0) : M[3];
          run.used = Math.min(1, run.used + dt * rate * 0.06);
          run.progress = Math.min(1, run.progress + dt * rate * 0.08);
          if (!steam && M[2] < 1 && M[3] >= 0.4) { run.vx = (run.vx || 0) * 0.95 + (Math.random() - 0.5) * M[3] * 0.08; run.x = Math.max(0.08, Math.min(0.92, run.x + run.vx * dt * 6)); }
          if (!steam && Math.random() < rate * 2) bubbles.push({ x: run.x + (Math.random() - 0.5) * 0.05, y: M[2] < 1 ? 0.02 : 0.95, r: 1.5 + Math.random() * 2.5 });
        }
      }
      for (let i = bubbles.length - 1; i >= 0; i--) { bubbles[i].y -= dt * 0.5; if (bubbles[i].y < 0) bubbles.splice(i, 1); }
      cv.redraw();
      return true;
    });
    function drop() {
      const M = METALS[pick];
      if (steam && M[4] == null) { msg.textContent = `${M[0]} already reacts with cold water — it would be far too dangerous in steam. Try it in cold water.`; return; }
      run = { y: steam ? 0 : -1, x: 0.5, used: 0, progress: 0 };
      bubbles.length = 0;
      msg.textContent = '';
      if (!steam && M[2] < 1 && M[3] > 0.1) api.check(0);
      if (!steam && M[1] === 'K') api.check(1);
      if (steam && M[1] === 'Mg') api.check(2);
      report();
    }
    const ov = overlay(stage, 'bl');
    button(ov, steam ? 'Heat it in steam' : 'Drop it in', drop, 'main big');
    const g = group(panel, 'Metal');
    seg(g, { options: METALS.map((mm, i) => [i, `${mm[0]} (${mm[1]})`]), value: pick, onChange: (v) => { pick = +v; run = null; bubbles.length = 0; report(); } });
    seg(group(panel, 'With'), { options: [[false, 'Cold water'], [true, 'Steam']], value: steam, onChange: (v) => { steam = v === true || v === 'true'; run = null; ov.querySelector('button').textContent = steam ? 'Heat it in steam' : 'Drop it in'; report(); } });
    const msg = el('p', 'lab-note'); panel.appendChild(msg);
    const st = stats(panel);
    function report() {
      const M = METALS[pick];
      st.set([['What you see', run || steam ? (steam ? (M[4] == null ? '—' : M[4] ? (M[1] === 'Mg' ? 'A dazzling white flame; white powder (magnesium oxide) is left.' : M[1] === 'Zn' ? 'It glows and turns into zinc oxide: yellow while hot, white when cool.' : 'Slowly turns into black iron oxide.') : 'Nothing happens.') : M[6]) : 'Tap “Drop it in”.'], ['Equation', steam ? (M[8] || '—') : M[7]], ['Floats?', M[2] < 1 ? `yes (density ${M[2]} g/cm³, less than water)` : `no — sinks (density ${M[2]} g/cm³)`]]);
      cv.redraw();
    }
    report(); tick.start();
    return { state: () => { const M = METALS[pick]; return `${M[0]} ${steam ? 'heated in steam' : 'dropped into cold water'}${run ? '' : ' (not yet dropped)'}: ${steam ? (M[8] || 'too dangerous to try') : M[7]}`; }, destroy: () => { tick.stop(); cv.destroy(); } };
  },
};

export const CHEMISTRY2 = [iceLab, metalsLab];

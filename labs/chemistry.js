/* Chemistry labs: balance an equation yourself (Cassie checks every atom), mix acid and
   base and watch the pH, and build an atom from protons, neutrons and electrons. */
import { INK, DIM, FAINT, GRID, C, el, esc, num, canvas, clock, group, slider, seg, button, row, stats, stepper, line, dot, text, gcd } from './kit.js';

/* ---------------- Balancing equations ---------------- */
// "Ca(OH)2" → { Ca: 1, O: 2, H: 2 }; also [ ], hydrates (CuSO4·5H2O) and leading numbers
export function atoms(formula) {
  const s = formula.replace(/\s+/g, '').replace(/\^?\d*[+-]$/, '');
  const parts = s.split(/[·.*]/);
  const total = {};
  for (const part of parts) {
    const m = /^(\d+)(.*)$/.exec(part);
    const mult = m ? +m[1] : 1, body = m ? m[2] : part;
    let i = 0;
    const group2 = () => {
      const out = {};
      while (i < body.length) {
        const ch = body[i];
        if (ch === '(' || ch === '[') {
          i++;
          const inner = group2();
          if (body[i] !== ')' && body[i] !== ']') throw new Error(`A bracket isn’t closed in ${formula}.`);
          i++;
          const n = /^\d+/.exec(body.slice(i)); const k = n ? +n[0] : 1; if (n) i += n[0].length;
          for (const e in inner) out[e] = (out[e] || 0) + inner[e] * k;
        } else if (ch === ')' || ch === ']') return out;
        else {
          const e = /^[A-Z][a-z]?/.exec(body.slice(i));
          if (!e) throw new Error(`I can’t read “${body.slice(i, i + 3)}” in ${formula}. Elements start with a capital: Na, Cl, O.`);
          i += e[0].length;
          const n = /^\d+/.exec(body.slice(i)); const k = n ? +n[0] : 1; if (n) i += n[0].length;
          out[e[0]] = (out[e[0]] || 0) + k;
        }
      }
      return out;
    };
    const got = group2();
    if (i < body.length) throw new Error(`There’s an extra bracket in ${formula}.`);
    for (const e in got) total[e] = (total[e] || 0) + got[e] * mult;
  }
  if (!Object.keys(total).length) throw new Error('A formula is empty.');
  return total;
}
export function parseEquation(src) {
  const sides = src.split(/->|→|⟶|=>|=/);
  if (sides.length !== 2) throw new Error('Write it with an arrow: H2 + O2 -> H2O');
  // (numbers already in front are dropped: you set those yourself)
  const split = (side) => side.split('+').map((t) => t.trim().replace(/^\d+\s*(?=[A-Z(\[])/, '')).filter(Boolean);
  const left = split(sides[0]), right = split(sides[1]);
  if (!left.length || !right.length) throw new Error('Both sides need something.');
  return { left, right, all: [...left, ...right].map(atoms) };
}
// the smallest whole numbers that balance it (null if there's no single answer)
export function balance(eq) {
  const species = eq.all, nL = eq.left.length, elems = [...new Set(species.flatMap((s) => Object.keys(s)))];
  const F = (n, d = 1) => { if (d < 0) { n = -n; d = -d; } const g = gcd(n, d); return [n / g, d / g]; };
  const sub = (a, b) => F(a[0] * b[1] - b[0] * a[1], a[1] * b[1]), mul = (a, b) => F(a[0] * b[0], a[1] * b[1]), div = (a, b) => F(a[0] * b[1], a[1] * b[0]);
  const M = elems.map((e) => species.map((s, j) => F((s[e] || 0) * (j < nL ? 1 : -1))));
  const cols = species.length, pivots = [];
  let r = 0;
  for (let c = 0; c < cols && r < M.length; c++) {
    let p = r; while (p < M.length && M[p][c][0] === 0) p++;
    if (p === M.length) continue;
    [M[r], M[p]] = [M[p], M[r]];
    const pv = M[r][c];
    M[r] = M[r].map((v) => div(v, pv));
    for (let i = 0; i < M.length; i++) if (i !== r && M[i][c][0] !== 0) { const f = M[i][c]; M[i] = M[i].map((v, j) => sub(v, mul(f, M[r][j]))); }
    pivots.push(c); r++;
  }
  const free = [...Array(cols).keys()].filter((c) => !pivots.includes(c));
  if (free.length !== 1) return null;
  const x = Array(cols).fill(null);
  x[free[0]] = [1, 1];
  pivots.forEach((c, i) => { x[c] = F(-M[i][free[0]][0], M[i][free[0]][1]); });
  const L = x.reduce((l, v) => (l * v[1]) / gcd(l, v[1]), 1);
  let ints = x.map((v) => (v[0] * L) / v[1]);
  if (ints.every((v) => v <= 0)) ints = ints.map((v) => -v);
  if (ints.some((v) => v <= 0)) return null;
  const g = ints.reduce((a, b) => gcd(a, b));
  return ints.map((v) => v / g);
}
const sub2 = (f) => esc(f).replace(/(\d+)/g, (m, d, off, all) => (off > 0 && /[A-Za-z)\]]/.test(all[off - 1]) ? `<sub>${d}</sub>` : m));
const EXAMPLES = [
  ['Water', 'H2 + O2 -> H2O'], ['Burning methane', 'CH4 + O2 -> CO2 + H2O'], ['Rust', 'Fe + O2 -> Fe2O3'],
  ['Photosynthesis', 'CO2 + H2O -> C6H12O6 + O2'], ['Respiration', 'C6H12O6 + O2 -> CO2 + H2O'], ['Neutralising', 'NaOH + H2SO4 -> Na2SO4 + H2O'],
  ['Metal + acid', 'Al + HCl -> AlCl3 + H2'], ['Tricky one', 'KMnO4 + HCl -> KCl + MnCl2 + H2O + Cl2'],
];
const balanceLab = {
  id: 'balance', name: 'Equation balancer', subject: 'chemistry', topic: 'balancing chemical equations and conservation of mass',
  blurb: 'Set the numbers in front yourself — Cassie counts every atom on both sides.',
  words: 'balance chemical equation coefficients reaction atoms conservation stoichiometry',
  icon: '<path d="M24 8v32M10 40h28"/><path d="M8 14h32"/><path d="M8 14l-4 12h8zM40 14l-4 12h8z"/><circle cx="24" cy="8" r="2"/>',
  tries: ['Balance water (H₂ + O₂ → H₂O) yourself', 'Balance burning methane yourself', 'Balance photosynthesis yourself'],
  mount({ stage, panel, api }) {
    let src = EXAMPLES[0][1], eq = null, coef = [], answer = null, peeked = false, err = '';
    const box = el('div', 'lab-balance');
    stage.appendChild(box);
    function load(text) {
      src = text; peeked = false;
      try { eq = parseEquation(text); err = ''; answer = balance(eq); coef = eq.all.map(() => 1); }
      catch (e) { eq = null; err = e.message; }
      render();
    }
    const count = (side) => {
      const out = {};
      eq.all.forEach((s, j) => { if ((j < eq.left.length) !== (side === 'L')) return; for (const e in s) out[e] = (out[e] || 0) + s[e] * coef[j]; });
      return out;
    };
    function render() {
      if (!eq) { box.innerHTML = `<p class="lab-err">${esc(err)}</p>`; st.set([]); return; }
      const L = count('L'), R = count('R'), elems = [...new Set([...Object.keys(L), ...Object.keys(R)])];
      const ok = elems.every((e) => (L[e] || 0) === (R[e] || 0));
      const term = (f, j) => `<span class="lab-term"><span class="lab-coef"><button type="button" data-j="${j}" data-d="1" aria-label="More ${esc(f)}">▲</button><b>${coef[j]}</b><button type="button" data-j="${j}" data-d="-1" aria-label="Fewer ${esc(f)}" ${coef[j] <= 1 ? 'disabled' : ''}>▼</button></span><span class="lab-formula">${sub2(f)}</span></span>`;
      const side = (list, off) => list.map((f, i) => term(f, i + off)).join('<span class="lab-plus">+</span>');
      box.innerHTML = `<div class="lab-eq">${side(eq.left, 0)}<span class="lab-arrow">→</span>${side(eq.right, eq.left.length)}</div>
        <p class="lab-verdict ${ok ? 'ok' : ''}">${ok ? (answer && coef.join() !== answer.join() && coef.every((c, j) => c % answer[j] === 0) ? 'Balanced — but you can make the numbers smaller.' : 'Balanced! Every atom on the left is on the right.') : 'Not balanced yet — tap ▲ ▼ to change the numbers.'}</p>
        <table class="lab-atoms"><tr><th>Atom</th><th>Left</th><th>Right</th><th></th></tr>${elems.map((e) => `<tr class="${(L[e] || 0) === (R[e] || 0) ? 'ok' : 'off'}"><td>${e}</td><td>${L[e] || 0}</td><td>${R[e] || 0}</td><td>${(L[e] || 0) === (R[e] || 0) ? '✓' : '✗'}</td></tr>`).join('')}</table>`;
      st.set([['Cassie’s answer', peeked ? (answer ? eq.left.map((f, j) => `${answer[j] > 1 ? answer[j] : ''}${f}`).join(' + ') + ' → ' + eq.right.map((f, j) => `${answer[j + eq.left.length] > 1 ? answer[j + eq.left.length] : ''}${f}`).join(' + ') : 'This one can’t be balanced in just one way.') : 'hidden — try it first']]);
      if (ok && !peeked) {
        const n = src.replace(/\s+/g, '');
        if (n === 'H2+O2->H2O') api.check(0);
        if (n === 'CH4+O2->CO2+H2O') api.check(1);
        if (n === 'CO2+H2O->C6H12O6+O2') api.check(2);
      }
    }
    box.addEventListener('click', (e) => {
      const b = e.target.closest('[data-j]');
      if (!b) return;
      const j = +b.dataset.j; coef[j] = Math.max(1, Math.min(30, coef[j] + +b.dataset.d));
      render();
    });
    const g = group(panel, 'Equation');
    const input = el('input', 'lab-input'); input.value = src; input.spellcheck = false; input.setAttribute('aria-label', 'Chemical equation');
    g.appendChild(input);
    input.addEventListener('change', () => load(input.value));
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') load(input.value); });
    const ex = row(g, 'lab-chips');
    EXAMPLES.forEach(([n, t]) => button(ex, n, () => { input.value = t; load(t); }, 'chip'));
    const r1 = row(panel, 'lab-row-btns');
    button(r1, 'Show Cassie’s answer', () => { peeked = true; render(); });
    button(r1, 'Start again', () => { if (eq) { coef = eq.all.map(() => 1); peeked = false; render(); } });
    panel.appendChild(el('p', 'lab-note', 'Only change the big numbers in front. Changing the small ones would make a different chemical.'));
    const st = stats(panel);
    load(src);
    return {
      state: () => (eq ? `balancing ${src}; my numbers in front are ${eq.left.concat(eq.right).map((f, j) => `${coef[j]} ${f}`).join(', ')} — ${(() => { const L = count('L'), R = count('R'); const bad = [...new Set([...Object.keys(L), ...Object.keys(R)])].filter((e2) => (L[e2] || 0) !== (R[e2] || 0)); return bad.length ? `not balanced yet (${bad.map((e2) => `${e2}: ${L[e2] || 0} left, ${R[e2] || 0} right`).join('; ')})` : 'balanced'; })()}` : `I typed “${src}” but it can't be read: ${err}`),
      destroy: () => box.remove(),
    };
  },
};

/* ---------------- pH ---------------- */
const SCALE = [[0.5, 'Battery acid'], [2, 'Lemon juice'], [2.5, 'Vinegar'], [3.2, 'Cola'], [5, 'Black coffee'], [6.5, 'Milk'], [7, 'Pure water'], [7.4, 'Blood'], [8.3, 'Baking soda'], [10, 'Soap'], [11.5, 'Ammonia'], [13, 'Bleach']];
function universal(pH) {
  const stops = [[0, [220, 30, 40]], [3, [240, 110, 40]], [5, [245, 200, 50]], [7, [80, 170, 70]], [9, [40, 120, 200]], [11, [70, 60, 170]], [14, [110, 40, 130]]];
  for (let i = 1; i < stops.length; i++) if (pH <= stops[i][0]) { const [a, ca] = stops[i - 1], [b, cb] = stops[i], t = (pH - a) / (b - a); return `rgb(${ca.map((v, k) => Math.round(v + (cb[k] - v) * t)).join(',')})`; }
  return 'rgb(110,40,130)';
}
const INDICATORS = {
  universal: ['Universal', universal],
  phenol: ['Phenolphthalein', (pH) => (pH < 8.2 ? 'rgba(240,240,250,.35)' : `rgba(230,60,160,${Math.min(0.9, 0.25 + (pH - 8.2) * 0.35)})`)],
  litmus: ['Litmus', (pH) => (pH < 4.5 ? 'rgb(200,50,60)' : pH > 8.3 ? 'rgb(60,90,200)' : 'rgb(130,70,150)')],
};
const phLab = {
  id: 'ph', name: 'pH mixer', subject: 'chemistry', topic: 'acids, bases, neutralisation and the pH scale',
  blurb: 'Drip acid or base into water, watch the colour change and the pH move.',
  words: 'ph acid base alkali neutral neutralisation indicator titration litmus',
  icon: '<path d="M14 8h20M16 8v8l-8 22a3 3 0 0 0 3 4h26a3 3 0 0 0 3-4L32 16V8"/><path d="M12 30h24"/><circle cx="21" cy="35" r="1.5"/><circle cx="28" cy="33" r="1.5"/>',
  tries: ['Make it exactly neutral — pH 7.0 (±0.1) — using both acid and base', 'Turn phenolphthalein pink', 'Make it as acidic as lemon juice (pH 2)'],
  mount({ stage, panel, api }) {
    const V0 = 50, M = 0.1;
    let Va = 0, Vb = 0, ind = 'universal', hist = [[0, 7]], drop = null;
    const pH = () => {
      const V = V0 + Va + Vb, d = (M * (Va - Vb)) / V; // strong acid − strong base, mol/L
      const h = d / 2 + Math.sqrt((d / 2) ** 2 + 1e-14);
      return -Math.log10(h);
    };
    const cv = canvas(stage, (ctx, w, h) => {
      const p = pH(), bw = Math.min(170, w * 0.32), bx = 30, by = 60, bh = Math.min(240, h - 120);
      const fill = Math.min(1, (V0 + Va + Vb) / 250);
      // the beaker
      ctx.fillStyle = INDICATORS[ind][1](p);
      ctx.fillRect(bx + 4, by + bh * (1 - fill), bw - 8, bh * fill - 4);
      ctx.strokeStyle = INK; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(bx, by - 10); ctx.lineTo(bx, by + bh); ctx.lineTo(bx + bw, by + bh); ctx.lineTo(bx + bw, by - 10); ctx.stroke();
      for (let k = 1; k <= 4; k++) { const y = by + bh - (bh * k) / 5; line(ctx, [[bx + bw - 16, y], [bx + bw - 4, y]], DIM, 1); text(ctx, k * 50 + ' mL', bx + bw + 6, y + 4, DIM); }
      if (drop) { dot(ctx, bx + bw / 2, by - 30 + drop.t * (bh * (1 - fill) + 20), 6, drop.color); }
      text(ctx, `pH ${p.toFixed(2)}`, bx + bw / 2, by + bh + 34, INK, 'center');
      // the scale, with everyday things
      const sx = bx + bw + 80, sw = 18, sh = h - 60, Y = (v) => 30 + (sh * v) / 14;
      for (let v = 0; v < 14; v += 0.25) { ctx.fillStyle = universal(v); ctx.fillRect(sx, Y(v), sw, sh / 56 + 1); }
      for (let v = 0; v <= 14; v += 2) text(ctx, String(v), sx - 6, Y(v) + 4, DIM, 'right');
      if (w > sx + 150) SCALE.forEach(([v, n]) => { line(ctx, [[sx + sw, Y(v)], [sx + sw + 8, Y(v)]], DIM, 1); text(ctx, n, sx + sw + 12, Y(v) + 4, DIM); });
      ctx.fillStyle = INK; ctx.beginPath(); ctx.moveTo(sx - 2, Y(p)); ctx.lineTo(sx - 14, Y(p) - 7); ctx.lineTo(sx - 14, Y(p) + 7); ctx.fill();
      text(ctx, 'acid', sx + sw / 2, 22, DIM, 'center'); text(ctx, 'base', sx + sw / 2, h - 12, DIM, 'center');
      // the path so far: pH against acid/base added
      if (hist.length > 1 && w > 640) {
        const gx = w - 220, gy = 40, gw = 200, gh = 140, xs = hist.map((q) => q[0]), lo = Math.min(-10, ...xs), hi = Math.max(10, ...xs);
        ctx.strokeStyle = GRID; ctx.strokeRect(gx, gy, gw, gh);
        line(ctx, hist.map(([x, v]) => [gx + ((x - lo) / (hi - lo)) * gw, gy + (v / 14) * gh]), C.gold, 2);
        text(ctx, '← acid   added   base →', gx + gw / 2, gy + gh + 16, DIM, 'center');
      }
    });
    const fall = clock((dt) => { if (!drop) return false; drop.t += dt * 3; if (drop.t >= 1) { drop = null; cv.redraw(); return false; } cv.redraw(); return true; });
    function add(acid, mL) {
      if (acid) Va += mL; else Vb += mL;
      Va = Math.round(Va * 100) / 100; Vb = Math.round(Vb * 100) / 100;
      hist.push([Vb - Va, pH()]); if (hist.length > 300) hist.shift();
      drop = { t: 0, color: acid ? 'rgba(255,140,120,.9)' : 'rgba(140,170,255,.9)' }; fall.start();
      report();
    }
    function report() {
      const p = pH();
      st.set([['pH', p.toFixed(2)], ['It is', p < 6.9 ? 'acidic' : p > 7.1 ? 'basic (alkaline)' : 'neutral'], ['Acid added (0.1 M HCl)', `${num(Va)} mL`], ['Base added (0.1 M NaOH)', `${num(Vb)} mL`], ['H⁺ concentration', `${num(Math.pow(10, -p))} mol/L`]]);
      if (Va > 0 && Vb > 0 && Math.abs(p - 7) <= 0.1) api.check(0);
      if (ind === 'phenol' && p > 8.6) api.check(1);
      if (Math.abs(p - 2) <= 0.1) api.check(2);
      cv.redraw();
    }
    const ga = group(panel, 'Acid (hydrochloric, 0.1 M)'), ra = row(ga, 'lab-row-btns');
    button(ra, '+ 1 drop', () => add(true, 0.05)); button(ra, '+ 1 mL', () => add(true, 1)); button(ra, '+ 10 mL', () => add(true, 10));
    const gb = group(panel, 'Base (sodium hydroxide, 0.1 M)'), rb = row(gb, 'lab-row-btns');
    button(rb, '+ 1 drop', () => add(false, 0.05)); button(rb, '+ 1 mL', () => add(false, 1)); button(rb, '+ 10 mL', () => add(false, 10));
    seg(group(panel, 'Indicator'), { options: Object.entries(INDICATORS).map(([k, [n]]) => [k, n]), value: ind, onChange: (v) => { ind = v; report(); } });
    button(row(panel, 'lab-row-btns'), 'Fresh water', () => { Va = Vb = 0; hist = [[0, 7]]; report(); });
    panel.appendChild(el('p', 'lab-note', 'The beaker starts with 50 mL of pure water. A drop is 0.05 mL.'));
    const st = stats(panel);
    report();
    return { state: () => `50 mL of water with ${num(Va)} mL of 0.1 M hydrochloric acid and ${num(Vb)} mL of 0.1 M sodium hydroxide added; pH ${pH().toFixed(2)}, using ${INDICATORS[ind][0]} indicator`, destroy: () => { fall.stop(); cv.destroy(); } };
  },
};

/* ---------------- Build an atom ---------------- */
// [symbol, name, neutrons in the most common isotope, neutrons of every stable isotope]
const ELEMENTS = [null, ['H', 'Hydrogen', 0, [0, 1]], ['He', 'Helium', 2, [1, 2]], ['Li', 'Lithium', 4, [3, 4]], ['Be', 'Beryllium', 5, [5]], ['B', 'Boron', 6, [5, 6]],
  ['C', 'Carbon', 6, [6, 7]], ['N', 'Nitrogen', 7, [7, 8]], ['O', 'Oxygen', 8, [8, 9, 10]], ['F', 'Fluorine', 10, [10]], ['Ne', 'Neon', 10, [10, 11, 12]],
  ['Na', 'Sodium', 12, [12]], ['Mg', 'Magnesium', 12, [12, 13, 14]], ['Al', 'Aluminium', 14, [14]], ['Si', 'Silicon', 14, [14, 15, 16]], ['P', 'Phosphorus', 16, [16]],
  ['S', 'Sulfur', 16, [16, 17, 18, 20]], ['Cl', 'Chlorine', 18, [18, 20]], ['Ar', 'Argon', 22, [18, 20, 22]], ['K', 'Potassium', 20, [20, 22]], ['Ca', 'Calcium', 20, [20, 22, 23, 24, 26, 28]]];
const shellsOf = (e) => { const cap = [2, 8, 8, 8], out = []; for (const c of cap) { if (e <= 0) break; out.push(Math.min(c, e)); e -= c; } return out; };
const atomLab = {
  id: 'atom', name: 'Build an atom', subject: 'chemistry', topic: 'atomic structure: protons, neutrons, electrons, isotopes and ions',
  blurb: 'Add protons, neutrons and electrons. See which element, isotope or ion you made.',
  words: 'atom proton neutron electron isotope ion element periodic table nucleus shell',
  icon: '<circle cx="24" cy="24" r="4"/><ellipse cx="24" cy="24" rx="19" ry="8"/><ellipse cx="24" cy="24" rx="19" ry="8" transform="rotate(60 24 24)"/><ellipse cx="24" cy="24" rx="19" ry="8" transform="rotate(-60 24 24)"/>',
  tries: ['Build carbon-12', 'Make a negative ion (more electrons than protons)', 'Build oxygen-18, a heavy but stable oxygen'],
  mount({ stage, panel, api }) {
    let Z = 6, N = 6, E = 6, spin = 0;
    const cv = canvas(stage, (ctx, w, h) => {
      const cx = w * 0.42, cy = h / 2, R = Math.min(w * 0.4, h * 0.45);
      // the shells, with their electrons going round
      const sh = shellsOf(E);
      sh.forEach((n, i) => {
        const r = R * (0.32 + 0.2 * i);
        ctx.strokeStyle = FAINT; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
        for (let k = 0; k < n; k++) { const a = spin * (1 - i * 0.18) + (k / n) * Math.PI * 2; dot(ctx, cx + Math.cos(a) * r, cy + Math.sin(a) * r, 5, C.blue); }
      });
      // the nucleus: protons and neutrons packed together
      const total = Z + N, pr = Math.max(3.5, Math.min(9, (R * 0.22) / Math.sqrt(Math.max(1, total))));
      const pts = [];
      for (let k = 0; k < total; k++) { const a = k * 2.39996, r = pr * 1.05 * Math.sqrt(k); pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
      // spread protons among the neutrons
      pts.forEach(([x, y], k) => dot(ctx, x, y, pr, Math.floor(((k + 1) * Z) / Math.max(1, total)) > Math.floor((k * Z) / Math.max(1, total)) ? C.red : '#b8b4aa'));
      // the element's tile
      const el2 = ELEMENTS[Z], tx = w - 130, ty = 24;
      ctx.strokeStyle = INK; ctx.lineWidth = 2; ctx.strokeRect(tx, ty, 108, 120);
      if (el2) {
        text(ctx, String(Z), tx + 8, ty + 18, DIM); text(ctx, String(Z + N), tx + 100, ty + 18, DIM, 'right');
        ctx.font = '700 44px -apple-system, Segoe UI, sans-serif'; text(ctx, el2[0], tx + 54, ty + 72, INK, 'center');
        ctx.font = '600 12px -apple-system, Segoe UI, sans-serif'; text(ctx, el2[1], tx + 54, ty + 98, INK, 'center');
        const q = Z - E; if (q) text(ctx, (Math.abs(q) > 1 ? Math.abs(q) : '') + (q > 0 ? '+' : '−'), tx + 102, ty + 40, C.gold, 'right');
      } else text(ctx, 'no protons', tx + 54, ty + 64, DIM, 'center');
      text(ctx, '● proton', 16, h - 46, C.red); text(ctx, '● neutron', 16, h - 28, '#b8b4aa'); text(ctx, '● electron', 16, h - 10, C.blue);
    });
    const tick = clock((dt) => { spin += dt * 0.7; cv.redraw(); return true; });
    const st = stats(panel);
    function report() {
      const e = ELEMENTS[Z], q = Z - E;
      const stable = e ? e[3].includes(N) : false;
      st.set(e ? [['Element', `${e[1]} (${e[0]})`], ['Mass number', `${Z + N} → ${e[1].toLowerCase()}-${Z + N}`], ['Charge', q === 0 ? '0 (a neutral atom)' : `${q > 0 ? '+' : '−'}${Math.abs(q)} — a ${q > 0 ? 'positive ion (cation)' : 'negative ion (anion)'}`], ['Nucleus', stable ? 'stable' : 'unstable — it would be radioactive'], ['Electron shells', shellsOf(E).join(', ') || 'none'], ['Most common isotope', `${e[1].toLowerCase()}-${Z + e[2]}`]]
        : [['Element', 'none — the number of protons decides the element']]);
      if (Z === 6 && N === 6 && E === 6) api.check(0);
      if (Z > 0 && E > Z) api.check(1);
      if (Z === 8 && N === 10) api.check(2);
      cv.redraw();
    }
    const g = group(panel, 'Particles');
    const sp = stepper(g, { label: 'Protons', min: 0, max: 20, value: Z, onChange: (v) => { Z = v; report(); } });
    const sn = stepper(g, { label: 'Neutrons', min: 0, max: 30, value: N, onChange: (v) => { N = v; report(); } });
    const se = stepper(g, { label: 'Electrons', min: 0, max: 28, value: E, onChange: (v) => { E = v; report(); } });
    const r1 = row(group(panel, 'Quick builds'), 'lab-chips');
    [['Hydrogen', 1, 0, 1], ['Helium-4', 2, 2, 2], ['Carbon-14', 6, 8, 6], ['Sodium ion Na⁺', 11, 12, 10], ['Chloride Cl⁻', 17, 18, 18], ['Calcium', 20, 20, 20]].forEach(([n, z, nn, e]) => button(r1, n, () => { Z = z; N = nn; E = e; sp.set(z); sn.set(nn); se.set(e); report(); }, 'chip'));
    panel.insertBefore(st.el, null);
    report(); tick.start();
    return {
      state: () => { const e = ELEMENTS[Z]; return `${Z} protons, ${N} neutrons and ${E} electrons${e ? `: that's ${e[1].toLowerCase()}-${Z + N}${Z !== E ? `, an ion with charge ${Z - E > 0 ? '+' : ''}${Z - E}` : ''}, and its nucleus is ${e[3].includes(N) ? 'stable' : 'unstable'}` : ''}`; },
      destroy: () => { tick.stop(); cv.destroy(); },
    };
  },
};

export const CHEMISTRY = [balanceLab, phLab, atomLab];

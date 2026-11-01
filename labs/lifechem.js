/* Biology and chemistry labs (v228): a virtual garden (what a plant needs to grow), enzyme reaction rates
   (temperature, pH, substrate and denaturing), Le Chatelier's principle (N2O4 and NO2) and an acid-base titration. */
import { INK, DIM, FAINT, C, el, num, canvas, group, slider, seg, button, row, stats, line, dot, text, arrow } from './kit.js';

/* ---------------- Virtual garden ---------------- */
export const SUN = { full: ['Full sun', 1, 0.25], some: ['Some sun', 0.5, 0.18], dark: ['Dark cupboard', 0, 0.1] }; // [name, light for growth, water lost a day]
export const WATERING = { day: ['Every day', 1], three: ['Every 3 days', 3], never: ['Never', 0], lots: ['Too much', -1] };
export const STAGES = [[0, 'Seed'], [1, 'Sprout'], [3, 'Leaves'], [6, 'Bud'], [9, 'Flower']];
export const stageOf = (g) => STAGES.filter(([at]) => g >= at).pop()[1];
export const soilOf = (m) => (m < 0.15 ? 'Too dry' : m > 1.15 ? 'Soggy' : 'Just right');
export function newPlant() { return { day: 0, soil: 0.6, growth: 0, dryDays: 0, darkOnly: true }; }
// soil water adds what you pour (anything past full drains away slowly) and loses some each day to the sun and the leaves.
// The plant grows only with damp soil: light makes its food; a seed's own store gets it to a sprout even in the dark.
export function water(p, amount = 0.3) { let m = p.soil + amount; if (m > 1) m = Math.min(1.6, 1 + (m - 1) * 0.4); return { ...p, soil: m }; }
export function gardenDay(p, sun, plan) {
  const [, light, dry] = SUN[sun], k = WATERING[plan][1];
  let q = p;
  if (k === -1) q = water(q, 1.2); else if (k > 0 && p.day % k === 0) q = water(q);
  const soil = Math.max(0, q.soil - dry), state = soilOf(soil), wet = state === 'Too dry' ? 0 : state === 'Soggy' ? 0.3 : 1;
  let g = wet * light;
  if (p.growth < 1.5) g = Math.max(g, 0.5 * wet); // (the seed's stored food)
  return { day: p.day + 1, soil, growth: p.growth + g, dryDays: state === 'Too dry' ? p.dryDays + 1 : 0, darkOnly: p.darkOnly && sun === 'dark', lastGrow: g };
}
const gardenLab = {
  id: 'garden', name: 'Virtual garden', subject: 'biology', levels: ['elem'], topic: 'what plants need to grow: water, sunlight, roots, stems, leaves and flowers',
  blurb: 'Plant a seed, give it water and sunlight, and watch the roots, leaves and flower grow day by day.',
  words: 'plant seed garden grow growth water sunlight light roots stem leaves flower germinate sprout wilt needs of plants',
  icon: '<path d="M24 40V22"/><path d="M24 30c-8 0-10-6-10-8 6 0 10 2 10 8zM24 26c6 0 9-5 9-7-5 0-9 2-9 7z"/><circle cx="24" cy="16" r="4"/><path d="M12 40h24l-3 6H15z"/>',
  tries: ['Grow the plant until it flowers', 'Get a seed to sprout in the dark cupboard', 'Let the plant go thirsty, then save it with water'],
  hints: ['Full sun and water every day. Press “Next 5 days” twice.', 'Plant a new seed, choose Dark cupboard and water it. A seed has its own food, so it can sprout without light.', 'Choose Never and press Next day until the soil is too dry, then press “Water it now”.'],
  about: 'A plant needs water, light, air and warmth. Its roots take in water, and its leaves use light to make food (photosynthesis).\nA seed carries a little food of its own, so it can sprout in the dark, but then it stops growing and turns pale. Too little water and it wilts; too much and the roots sit in soggy soil and grow badly.\nThe days are sped up and the amounts are made up to show the idea, not measured from a real plant.',
  mount({ stage, panel, api }) {
    let p = newPlant(), sun = 'full', plan = 'day', sawWilt = false;
    const cv = canvas(stage, (ctx, w, h) => {
      const st = stageOf(p.growth), pale = p.darkOnly && p.growth >= 1, wilt = p.dryDays > 0 && p.growth >= 1;
      const gy = h * 0.6, cx = w / 2, potW = Math.min(220, w * 0.5);
      // sun or cupboard
      if (sun === 'dark') { ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(0, 0, w, h); text(ctx, 'In the dark cupboard', 16, 46, DIM); }
      else { const r = sun === 'full' ? 26 : 18; dot(ctx, w - 60, 60, r, C.gold); if (sun === 'some') { ctx.fillStyle = 'rgba(200,205,215,.85)'; ctx.beginPath(); ctx.ellipse(w - 46, 72, 30, 14, 0, 0, Math.PI * 2); ctx.fill(); } }
      // the pot and its soil (darker when wetter)
      const wet = Math.min(1, p.soil / 1.2);
      ctx.fillStyle = `rgb(${Math.round(150 - 80 * wet)},${Math.round(110 - 60 * wet)},${Math.round(70 - 40 * wet)})`; ctx.fillRect(cx - potW / 2, gy, potW, h * 0.28);
      ctx.strokeStyle = 'rgba(214,120,80,.9)'; ctx.lineWidth = 4; ctx.strokeRect(cx - potW / 2, gy, potW, h * 0.28);
      // roots grow down first
      const rootL = Math.min(h * 0.24, p.growth * h * 0.04);
      if (p.growth > 0.2) { ctx.strokeStyle = 'rgba(245,235,210,.9)'; ctx.lineWidth = 2; for (const [dx, k] of [[0, 1], [-18, 0.7], [18, 0.6], [-30, 0.4], [30, 0.4]]) { ctx.beginPath(); ctx.moveTo(cx, gy + 4); ctx.quadraticCurveTo(cx + dx * 0.4, gy + rootL * k * 0.5, cx + dx, gy + rootL * k); ctx.stroke(); } }
      dot(ctx, cx, gy + 6, 7, '#c9a46a');
      // stem, leaves and flower
      if (p.growth >= 1) {
        const top = Math.min(h * 0.5, (p.growth - 0.8) * h * 0.05 * (pale ? 1.5 : 1)), lean = wilt ? 0.5 : 0, green = pale ? '#d8e6a0' : wilt ? '#9cae5a' : '#5fcf72';
        const tx = cx + Math.sin(lean) * top, ty = gy - Math.cos(lean) * top;
        ctx.strokeStyle = green; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(cx, gy); ctx.quadraticCurveTo(cx, gy - top * 0.6, tx, ty); ctx.stroke();
        const leaves = Math.min(6, Math.floor(p.growth / 1.2));
        for (let i = 0; i < leaves; i++) { const f = (i + 1) / (leaves + 1), lx = cx + (tx - cx) * f, ly = gy + (ty - gy) * f, s = i % 2 ? 1 : -1; ctx.fillStyle = green; ctx.beginPath(); ctx.ellipse(lx + s * 14, ly + (wilt ? 8 : 0), 14, 6, s * (wilt ? 0.9 : -0.4), 0, Math.PI * 2); ctx.fill(); }
        if (st === 'Bud') dot(ctx, tx, ty - 6, 8, '#ff9fb7');
        if (st === 'Flower') { for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; dot(ctx, tx + Math.cos(a) * 14, ty - 10 + Math.sin(a) * 14, 10, '#ff8fb0'); } dot(ctx, tx, ty - 10, 8, C.gold); }
      }
      text(ctx, `Day ${p.day}: ${stageOf(p.growth)}${pale ? ', pale (no light)' : ''}${wilt ? ', wilting' : ''}`, 16, 22, wilt ? C.red : INK);
    });
    seg(group(panel, 'Light'), { options: Object.entries(SUN).map(([k, [n]]) => [k, n]), value: sun, onChange: (v) => { sun = v; report(); } });
    seg(group(panel, 'Watering'), { options: Object.entries(WATERING).map(([k, [n]]) => [k, n]), value: plan, onChange: (v) => { plan = v; report(); } });
    const r1 = row(panel, 'lab-row-btns');
    const step = (n) => { for (let i = 0; i < n; i++) { p = gardenDay(p, sun, plan); if (p.dryDays > 0 && p.growth >= 1) sawWilt = true; } report(true); };
    button(r1, 'Next day', () => step(1), 'main');
    button(r1, 'Next 5 days', () => step(5));
    const r2 = row(panel, 'lab-row-btns');
    button(r2, 'Water it now', () => { p = { ...water(p), dryDays: soilOf(water(p).soil) === 'Too dry' ? p.dryDays : 0 }; report(true); });
    button(r2, 'Plant a new seed', () => { p = newPlant(); sawWilt = false; report(); });
    const st = stats(panel);
    function report(acted) {
      st.set([['Day', String(p.day)], ['Soil', soilOf(p.soil)], ['Light', SUN[sun][0]], ['Height', `${num(Math.max(0, (p.growth - 0.8) * 3))} cm`], ['Stage', stageOf(p.growth)]]);
      if (acted) {
        if (stageOf(p.growth) === 'Flower') api.check(0);
        if (p.darkOnly && p.growth >= 1) api.check(1);
        if (sawWilt && p.dryDays === 0 && soilOf(p.soil) === 'Just right') api.check(2);
      }
      cv.redraw();
    }
    report();
    return { state: () => `a plant on day ${p.day} in ${SUN[sun][0].toLowerCase()}, watered ${WATERING[plan][0].toLowerCase()}: the soil is ${soilOf(p.soil).toLowerCase()} and it is at the ${stageOf(p.growth).toLowerCase()} stage${p.dryDays ? ', wilting' : ''}`, destroy: () => cv.destroy() };
  },
};

/* ---------------- Enzyme reaction rates ---------------- */
export const ENZYMES = { amylase: ['Amylase (saliva)', 37, 6.8, 'starch'], pepsin: ['Pepsin (stomach)', 37, 2, 'protein'] }; // [name, best °C, best pH, what it breaks down]
export const KM = 5, KCAT = 10; // mM, and µmol/min for each unit of enzyme at its best
// warmth speeds it up (about 2× every 10 °C) until the enzyme starts losing its shape above its best temperature
export const tempFactor = (T, best = 37) => (T <= best ? Math.pow(2, (T - best) / 10) : Math.exp(-(((T - best) / 8) ** 2)));
export const phFactor = (pH, best) => Math.exp(-(((pH - best) / 1.5) ** 2));
// Michaelis-Menten: rate = Vmax × [S] / (Km + [S]), with Vmax = kcat × [E] × the temperature and pH factors
export function enzymeRate({ E, S, T, pH, kind = 'amylase', cooked = false }) {
  const [, bT, bP] = ENZYMES[kind];
  const vmax = cooked ? 0 : KCAT * E * tempFactor(T, bT) * phFactor(pH, bP);
  return { vmax, rate: (vmax * S) / (KM + S), share: cooked ? 0 : tempFactor(T, bT) * phFactor(pH, bP) };
}
export const COOK_AT = 60; // °C: at or above this the enzyme's shape is lost for good
const enzymeLab = {
  id: 'enzyme', name: 'Enzyme reaction rates', subject: 'biology', levels: ['hs', 'college'], topic: 'enzymes: active site, temperature, pH, substrate concentration, denaturing and Michaelis-Menten kinetics',
  blurb: 'Change the temperature, pH and amounts and watch how fast an enzyme works. Cook it and see what happens.',
  words: 'enzyme enzymes active site substrate catalyst rate temperature ph optimum denature denatured amylase pepsin michaelis menten km vmax kinetics',
  icon: '<path d="M8 24c0-9 7-16 16-16s16 7 16 16-7 16-16 16c-4 0-6-3-6-6v-4h-6c-2 0-4-2-4-6z"/><circle cx="14" cy="30" r="3"/>',
  tries: ['Find the temperature where amylase works fastest', 'Cook the enzyme, then cool it down. Does it work again?', 'Find the pH where pepsin works fastest', 'Add substrate until more makes almost no difference'],
  hints: ['Keep the pH at 6.8 and slide the temperature. Watch the middle graph: the top of the hill is the best temperature.', `Slide the temperature to ${COOK_AT} °C or more, then back down to 37 °C.`, 'Choose Pepsin, then slide the pH. Your stomach is very acidic.', 'Slide the substrate up until the rate is within 10% of the top speed (Vmax).'],
  about: 'An enzyme speeds up a reaction by holding the substrate in its active site. Warmth makes the molecules meet more often, so the rate rises (about twice as fast for every 10 °C) up to the enzyme’s best temperature.\nAbove that the enzyme starts to lose its shape (denatures), so the active site no longer fits and the rate falls fast. Heat it enough and the change is permanent: cooling it down doesn’t bring it back. Each enzyme also has a best pH: amylase in saliva near 6.8, pepsin in the stomach near 2.\nWith more substrate the rate rises and then levels off at a top speed (Vmax), when every active site is busy. This follows the Michaelis-Menten equation, rate = Vmax × [S] ÷ (Km + [S]); here Km is 5 mM. The numbers are illustrative.',
  mount({ stage, panel, api }) {
    let kind = 'amylase', E = 2, S = 10, T = 25, pH = 6.8, cooked = false;
    const R = () => enzymeRate({ E, S, T, pH, kind, cooked });
    const cv = canvas(stage, (ctx, w, h) => {
      const wide = w >= 640, n = 3, pw = wide ? (w - 40) / n - 16 : w - 60, ph = wide ? h * 0.5 : (h - 70) / n - 34;
      const box = (i) => (wide ? [30 + i * (pw + 16 + 8), h * 0.25] : [40, 44 + i * (ph + 34)]);
      const [, bT, bP] = ENZYMES[kind], top = KCAT * E;
      const plot = (i, title, xs, f, xLab, cur, fmtX) => {
        const [x0, y0] = box(i), [a, b] = xs;
        line(ctx, [[x0, y0], [x0, y0 + ph], [x0 + pw, y0 + ph]], FAINT, 1);
        text(ctx, title, x0, y0 - 8, INK); text(ctx, xLab, x0 + pw, y0 + ph + 16, DIM, 'right');
        text(ctx, fmtX(a), x0, y0 + ph + 16, DIM);
        const pts = []; for (let k = 0; k <= 80; k++) { const x = a + ((b - a) * k) / 80; pts.push([x0 + (k / 80) * pw, y0 + ph - (f(x) / top) * ph]); }
        line(ctx, pts, cooked ? DIM : C.green, 2.5);
        const cx = x0 + ((cur - a) / (b - a)) * pw, cy = y0 + ph - (f(cur) / top) * ph; dot(ctx, cx, cy, 6, C.gold);
      };
      plot(0, 'Rate and substrate', [0, 100], (s) => enzymeRate({ E, S: s, T, pH, kind, cooked }).rate, 'substrate (mM)', S, (v) => `${v}`);
      plot(1, 'Rate and temperature', [0, 80], (t) => enzymeRate({ E, S, T: t, pH, kind, cooked }).rate, 'temperature (°C)', T, (v) => `${v}`);
      plot(2, 'Rate and pH', [0, 14], (q) => enzymeRate({ E, S, T, pH: q, kind, cooked }).rate, 'pH', pH, (v) => `${v}`);
      text(ctx, cooked ? 'Denatured: its shape is lost for good' : `${ENZYMES[kind][0]}: best near ${bT} °C and pH ${bP}`, 16, wide ? 22 : h - 10, cooked ? C.red : DIM);
    });
    seg(group(panel, 'Enzyme'), { options: Object.entries(ENZYMES).map(([k, [n]]) => [k, n]), value: kind, onChange: (v) => { kind = v; cooked = false; report(); } });
    const gc = group(panel, 'Conditions');
    slider(gc, { label: 'Temperature', min: 0, max: 80, value: T, fmt: (v) => `${v} °C`, onInput: (v) => { T = v; if (T >= COOK_AT) cooked = true; report(true); } });
    slider(gc, { label: 'pH', min: 0, max: 14, step: 0.1, value: pH, fmt: (v) => v.toFixed(1), onInput: (v) => { pH = v; report(true); } });
    const ga = group(panel, 'Amounts');
    slider(ga, { label: 'Substrate', min: 0, max: 100, value: S, fmt: (v) => `${v} mM`, onInput: (v) => { S = v; report(true); } });
    slider(ga, { label: 'Enzyme', min: 1, max: 5, value: E, fmt: (v) => `${v} units`, onInput: (v) => { E = v; report(true); } });
    button(row(panel, 'lab-row-btns'), 'Fresh enzyme', () => { cooked = false; report(); });
    const st = stats(panel);
    function report(acted) {
      const r = R();
      st.set([['Rate', `${num(r.rate)} µmol/min`], ['Top speed (Vmax)', `${num(r.vmax)} µmol/min`], ['Working at', `${Math.round(r.share * 100)}% of its best`], ['Enzyme shape', cooked ? 'Denatured' : T > ENZYMES[kind][1] + 6 ? 'Starting to change' : 'Fine']]);
      if (acted) {
        if (kind === 'amylase' && !cooked && T === 37 && Math.abs(pH - 6.8) < 0.05) api.check(0);
        if (cooked && T <= 40) api.check(1);
        if (kind === 'pepsin' && !cooked && Math.abs(pH - 2) < 0.05) api.check(2);
        if (r.vmax > 0 && r.rate >= 0.9 * r.vmax) api.check(3);
      }
      cv.redraw();
    }
    report();
    return { state: () => { const r = R(); return `${ENZYMES[kind][0]} at ${T} °C and pH ${pH.toFixed(1)}, ${E} units with ${S} mM substrate: rate ${num(r.rate)} µmol/min of a top speed of ${num(r.vmax)}${cooked ? ', and it has been denatured by heat' : ''}`; }, destroy: () => cv.destroy() };
  },
};

/* ---------------- Le Chatelier's principle ---------------- */
// N2O4 (colourless) ⇌ 2 NO2 (brown), ΔH = +57.2 kJ/mol; Kc = [NO2]² / [N2O4] = 4.6 × 10⁻³ mol/L at 25 °C
export const DH = 57200, R_GAS = 8.314, K298 = 4.6e-3;
export const kAt = (Tc) => K298 * Math.exp((-DH / R_GAS) * (1 / (Tc + 273.15) - 1 / 298.15));
// from a mol of NO2 and b mol of N2O4 in V litres, the shift x (mol of N2O4 that splits; negative if NO2 joins up)
// solves (a + 2x)² = K·V·(b - x)
export function settle(a, b, V, K) {
  const kv = K * V, B = 4 * a + kv, Cc = a * a - kv * b;
  const x = (-B + Math.sqrt(B * B - 16 * Cc)) / 8;
  return { x, no2: a + 2 * x, n2o4: b - x };
}
const equilibriumLab = {
  id: 'equilibrium', name: 'Le Chatelier and equilibrium', subject: 'chemistry', levels: ['hs', 'college'], topic: 'chemical equilibrium and Le Chatelier’s principle: concentration, temperature and pressure changes, Kc and Q',
  blurb: 'Brown NO₂ and colourless N₂O₄ in a sealed flask. Heat it, squeeze it or add more, and watch the equilibrium push back.',
  words: 'le chatelier equilibrium reversible reaction kc q reaction quotient shift nitrogen dioxide dinitrogen tetroxide no2 n2o4 temperature pressure concentration endothermic exothermic',
  icon: '<path d="M18 6h12M20 6v12L10 38c-1 3 1 4 3 4h22c2 0 4-1 3-4L28 18V6"/><path d="M14 30h20"/><path d="M16 24l4-3M28 24l4-3"/>',
  tries: ['Heat the flask and make it browner', 'Squeeze it into half the space. Which way does it shift?', 'Add NO₂ and watch it shift back'],
  hints: ['The forward reaction takes in heat. Slide the temperature up.', 'Halve the volume. More pressure favours the side with fewer gas molecules: 1 N₂O₄ against 2 NO₂.', 'Press “Add NO₂”. The equilibrium uses up some of what you added.'],
  about: 'In a sealed flask N₂O₄ (colourless) splits into 2 NO₂ (brown) and 2 NO₂ join back up, both at once. At equilibrium the two rates match, and Kc = [NO₂]² ÷ [N₂O₄] stays fixed at a given temperature (4.6 × 10⁻³ mol/L at 25 °C).\nLe Chatelier’s principle: change the conditions and the equilibrium shifts to undo part of the change. Add NO₂ and some of it joins up again. Squeeze the flask and it shifts to the side with fewer gas molecules (N₂O₄). The forward reaction takes in heat (ΔH = +57.2 kJ/mol), so heating makes Kc bigger and the flask browner.\nThe reaction quotient Q uses the same formula at any moment: if Q < Kc it shifts right, if Q > Kc it shifts left. Kc at other temperatures comes from the van ’t Hoff equation, taking ΔH as constant.',
  mount({ stage, panel, api }) {
    let Tc = 25, V = 1, a = 0, b = 0.1, last = 'Start', shift = 0, hist = [];
    ({ no2: a, n2o4: b } = settle(a, b, V, kAt(Tc)));
    const pushHist = (from, to) => { // a jump, then the shift towards the new equilibrium (illustrative time scale)
      for (let k = 0; k <= 20; k++) { const f = 1 - Math.exp(-k / 4); hist.push([(from.no2 + (to.no2 - from.no2) * f) / V, (from.n2o4 + (to.n2o4 - from.n2o4) * f) / V]); }
      if (hist.length > 160) hist = hist.slice(-160);
    };
    hist.push([a / V, b / V]);
    function stress(name, na, nb) {
      const s = settle(na, nb, V, kAt(Tc)); shift = s.x; last = name;
      hist.push([na / V, nb / V]); pushHist({ no2: na, n2o4: nb }, s); a = s.no2; b = s.n2o4; return s;
    }
    const cv = canvas(stage, (ctx, w, h) => {
      const fx = w * 0.2, fy = h * 0.32, fr = Math.min(70, w * 0.12) * Math.cbrt(V);
      const brown = Math.min(0.95, (a / V) * 6);
      ctx.fillStyle = `rgba(170,80,30,${brown})`; ctx.beginPath(); ctx.arc(fx, fy, fr, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = INK; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(fx, fy, fr, 0, Math.PI * 2); ctx.stroke();
      text(ctx, `${V} L at ${Tc} °C`, fx, fy + fr + 20, DIM, 'center');
      // the concentrations over time
      const gx = w * 0.42, gy = 30, gw = w * 0.54, gh = h * 0.5, top = Math.max(0.05, ...hist.map(([p, q]) => Math.max(p, q))) * 1.1;
      line(ctx, [[gx, gy], [gx, gy + gh], [gx + gw, gy + gh]], FAINT, 1);
      text(ctx, 'mol/L', gx + 4, gy + 10, DIM); text(ctx, 'time', gx + gw, gy + gh + 16, DIM, 'right');
      const P = (i, v) => [gx + (i / Math.max(1, hist.length - 1)) * gw, gy + gh - (v / top) * gh];
      line(ctx, hist.map(([p], i) => P(i, p)), '#ff9a5c', 2.5); line(ctx, hist.map(([, q], i) => P(i, q)), C.blue, 2.5);
      text(ctx, 'NO₂', gx + gw - 30, P(hist.length - 1, hist[hist.length - 1][0])[1] - 8, '#ff9a5c'); text(ctx, 'N₂O₄', gx + gw - 36, P(hist.length - 1, hist[hist.length - 1][1])[1] - 8, C.blue);
      const say = Math.abs(shift) < 1e-6 ? 'At equilibrium' : shift > 0 ? `${last}: it shifted right, making more brown NO₂` : `${last}: it shifted left, making more N₂O₄`;
      text(ctx, 'N₂O₄ ⇌ 2 NO₂   (forward takes in heat)', 16, h * 0.72, INK); text(ctx, say, 16, h * 0.72 + 22, shift > 0 ? '#ff9a5c' : shift < 0 ? C.blue : DIM);
    });
    const gt = group(panel, 'Conditions');
    const sT = slider(gt, { label: 'Temperature', min: 0, max: 100, step: 5, value: Tc, fmt: (v) => `${v} °C`, onInput: (v) => { const up = v > Tc; Tc = v; const s = stress(up ? 'Heated' : 'Cooled', a, b); report(up && s.x > 0 ? 0 : null); } });
    const sV = slider(gt, { label: 'Volume', min: 0.5, max: 4, step: 0.5, value: V, fmt: (v) => `${v} L`, onInput: (v) => { const smaller = v < V; V = v; const s = stress(smaller ? 'Squeezed' : 'Expanded', a, b); report(smaller && s.x < 0 ? 1 : null); } });
    const r1 = row(panel, 'lab-row-btns');
    button(r1, 'Add NO₂', () => { const s = stress('Added NO₂', a + 0.05, b); report(s.x < 0 ? 2 : null); });
    button(r1, 'Add N₂O₄', () => { stress('Added N₂O₄', a, b + 0.05); report(); });
    button(r1, 'Start again', () => { Tc = 25; V = 1; last = 'Start'; shift = 0; ({ no2: a, n2o4: b } = settle(0, 0.1, V, kAt(Tc))); hist = [[a / V, b / V]]; sT.set(25); sV.set(1); report(); });
    const st = stats(panel);
    function report(goal) {
      const K = kAt(Tc), Q = (a / V) ** 2 / (b / V);
      st.set([['[NO₂]', `${num(a / V)} mol/L`], ['[N₂O₄]', `${num(b / V)} mol/L`], ['Kc at this temperature', num(K)], ['Q now', num(Q)], ['Last shift', Math.abs(shift) < 1e-6 ? 'None' : shift > 0 ? 'To the right' : 'To the left']]);
      if (goal != null) api.check(goal);
      cv.redraw();
    }
    report();
    return { state: () => `N₂O₄ ⇌ 2 NO₂ in ${V} L at ${Tc} °C: [NO₂] ${num(a / V)} mol/L, [N₂O₄] ${num(b / V)} mol/L, Kc ${num(kAt(Tc))}; last change: ${last}${shift ? `, which shifted it ${shift > 0 ? 'right' : 'left'}` : ''}`, destroy: () => cv.destroy() };
  },
};

/* ---------------- Titration ---------------- */
export const KW = 1e-14, KA_ETHANOIC = 1.8e-5;
export const ACIDS = { strong: ['Strong (HCl)', Infinity], weak: ['Weak (ethanoic acid)', KA_ETHANOIC] };
export const INDICATORS = { phth: ['Phenolphthalein', 8.2, 10, 'colourless', 'pink', 'pale pink'], mo: ['Methyl orange', 3.1, 4.4, 'red', 'yellow', 'orange'], btb: ['Bromothymol blue', 6, 7.6, 'yellow', 'blue', 'green'] };
// 25.00 mL of 0.100 M acid, 0.100 M NaOH from the burette. The pH solves the charge balance
// [H+] + [Na+] = [A-] + [OH-], with [A-] = Ca·Ka / (Ka + [H+]) (all of it for a strong acid), by halving on log[H+].
export function titrationPH(Vb, kind = 'strong', Va = 25, Ca = 0.1, Cb = 0.1) {
  const Ka = ACIDS[kind][1], V = Va + Vb, ct = (Ca * Va) / V, na = (Cb * Vb) / V;
  const f = (h) => h + na - (Ka === Infinity ? ct : (ct * Ka) / (Ka + h)) - KW / h;
  let lo = -14, hi = 1;
  for (let i = 0; i < 100; i++) { const mid = (lo + hi) / 2; if (f(10 ** mid) > 0) hi = mid; else lo = mid; }
  return -(lo + hi) / 2;
}
export const indicatorShows = (ind, pH) => { const [, lo, hi, a, b, mid] = INDICATORS[ind]; return pH < lo ? a : pH >= hi ? b : mid; }; // (in its range it shows the colour in between)
const INK_OF = { colourless: 'rgba(255,255,255,.18)', pink: '#ff6fb5', 'pale pink': '#ffb3d6', red: '#ff5a5a', orange: '#ff9f40', yellow: '#ffd84d', green: '#5fcf72', blue: '#4d8dff' };
const titrationLab = {
  id: 'titration', name: 'Titration', subject: 'chemistry', levels: ['hs', 'college'], topic: 'acid-base titration: burettes, indicators, end point, equivalence point, titration curves and pKa',
  blurb: 'Drip sodium hydroxide into an acid, watch the pH curve rise, and stop at the end point.',
  words: 'titration burette pipette indicator phenolphthalein methyl orange end point equivalence point neutralisation neutralization acid base naoh hcl ethanoic acetic pka buffer titration curve',
  icon: '<path d="M22 4h4v18l2 4h-8l2-4z"/><path d="M24 26v4"/><path d="M14 32h20l-4 12H18z"/>',
  tries: ['Stop at the end point: the first lasting pink', 'With the weak acid, find the pH halfway to the end point', 'With the weak acid, find the pH at the equivalence point. Why isn’t it 7?'],
  hints: ['Add 5 mL at a time to 20 mL, then slow down: 1 mL, then 0.1 mL and drops. Stop as soon as it turns pink.', 'The end point is at 25.00 mL, so halfway is 12.50 mL. There the pH equals the acid’s pKa.', 'Add exactly 25.00 mL. The ethanoate ion left over is a weak base.'],
  about: 'A pipette puts 25.00 mL of 0.100 M acid in the flask, and the burette adds 0.100 M sodium hydroxide. The equivalence point is when the moles of base equal the moles of acid: here at 25.00 mL.\nAn indicator changes colour over a pH range: phenolphthalein 8.2 to 10 (colourless to pink), methyl orange 3.1 to 4.4 (red to yellow), bromothymol blue 6.0 to 7.6 (yellow to blue). The end point is where it changes; a good indicator changes on the steep part of the curve.\nFor a weak acid (ethanoic acid, Ka = 1.8 × 10⁻⁵) the curve starts higher, has a flat buffer region, and halfway to equivalence pH = pKa (4.74; the exact charge balance gives 4.75). At equivalence the pH is above 7 (about 8.7), because the ethanoate ion is a weak base. The pH is worked out exactly from the charge balance, at 25 °C.',
  mount({ stage, panel, api }) {
    let kind = 'strong', ind = 'phth', Vb = 0, pts = [[0, titrationPH(0, 'strong')]];
    const pH = () => titrationPH(Vb, kind);
    const cv = canvas(stage, (ctx, w, h) => {
      const bx = w * 0.12, fy = h * 0.62;
      // burette, with the level going down
      ctx.strokeStyle = INK; ctx.lineWidth = 2; ctx.strokeRect(bx - 8, 20, 16, fy - 90);
      const lvl = 20 + ((fy - 90) * Vb) / 50; ctx.fillStyle = 'rgba(180,200,255,.35)'; ctx.fillRect(bx - 7, lvl, 14, fy - 90 - (lvl - 20));
      text(ctx, `${Vb.toFixed(2)} mL`, bx + 14, lvl + 4, INK);
      // the flask, in the indicator's colour
      const col = indicatorShows(ind, pH());
      ctx.fillStyle = INK_OF[col];
      ctx.beginPath(); ctx.moveTo(bx - 12, fy - 60); ctx.lineTo(bx - 40, fy); ctx.lineTo(bx + 40, fy); ctx.lineTo(bx + 12, fy - 60); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = INK; ctx.stroke();
      // the curve
      const gx = w * 0.3, gy = 30, gw = w * 0.64, gh = h * 0.62;
      line(ctx, [[gx, gy], [gx, gy + gh], [gx + gw, gy + gh]], FAINT, 1);
      for (const v of [0, 7, 14]) text(ctx, String(v), gx - 6, gy + gh - (v / 14) * gh + 4, DIM, 'right');
      for (const v of [0, 25, 50]) text(ctx, String(v), gx + (v / 50) * gw, gy + gh + 16, DIM, 'center');
      text(ctx, 'pH', gx + 4, gy + 10, DIM); text(ctx, 'NaOH added (mL)', gx + gw, gy + gh + 32, DIM, 'right');
      const [, lo, hi] = INDICATORS[ind]; ctx.fillStyle = 'rgba(255,255,255,.07)'; ctx.fillRect(gx, gy + gh - (hi / 14) * gh, gw, ((hi - lo) / 14) * gh);
      const P = ([v, p]) => [gx + (v / 50) * gw, gy + gh - (p / 14) * gh];
      line(ctx, pts.map(P), C.green, 2); pts.forEach((q) => { const [x, y] = P(q); dot(ctx, x, y, 3, C.green); });
      text(ctx, `pH ${pH().toFixed(2)}: the indicator is ${col}`, 16, h - 14, INK);
    });
    seg(group(panel, 'Acid in the flask (25.00 mL, 0.100 M)'), { options: Object.entries(ACIDS).map(([k, [n]]) => [k, n]), value: kind, onChange: (v) => { kind = v; again(); } });
    seg(group(panel, 'Indicator'), { options: Object.entries(INDICATORS).map(([k, [n]]) => [k, n]), value: ind, onChange: (v) => { ind = v; report(); } });
    const gb = group(panel, 'Burette (0.100 M NaOH)');
    const add = (mL) => { Vb = Math.min(50, Math.round((Vb + mL) * 100) / 100); pts.push([Vb, pH()]); report(true); };
    const r1 = row(gb, 'lab-row-btns');
    button(r1, 'Add 5 mL', () => add(5)); button(r1, 'Add 1 mL', () => add(1)); button(r1, 'Add 0.1 mL', () => add(0.1)); button(r1, 'Add a drop', () => add(0.05), 'main');
    function again() { Vb = 0; pts = [[0, titrationPH(0, kind)]]; report(); }
    button(row(panel, 'lab-row-btns'), 'Start again', again);
    const st = stats(panel);
    function report(acted) {
      const p = pH();
      st.set([['NaOH added', `${Vb.toFixed(2)} mL`], ['pH', p.toFixed(2)], ['Indicator', indicatorShows(ind, p)], ['Equivalence point', '25.00 mL']]);
      if (acted) {
        if (ind === 'phth' && p > 8.2 && Vb <= 25.1 + 1e-9) api.check(0);
        if (kind === 'weak' && Math.abs(Vb - 12.5) < 0.01) api.check(1);
        if (kind === 'weak' && Math.abs(Vb - 25) < 0.01) api.check(2);
      }
      cv.redraw();
    }
    report();
    return { state: () => `${ACIDS[kind][0].toLowerCase()} titrated with NaOH: ${Vb.toFixed(2)} mL added, pH ${pH().toFixed(2)}, ${INDICATORS[ind][0].toLowerCase()} shows ${indicatorShows(ind, pH())}`, destroy: () => cv.destroy() };
  },
};

export const LIFECHEM = [gardenLab, enzymeLab, equilibriumLab, titrationLab];

/* Games that teach: logic and code, patterns, maps and bodies, fractions, and economics.
   They aren't daily puzzles (no score board) — each keeps your best on this device.
     Logic Circuit · Formula Cracker · Pinning Blitz · Fraction Diner · City Market */
import { INK, DIM, FAINT, C, el, esc, canvas, at, overlay, group, seg, button, row, stats, stepper, slider, line, dot, text, arrow, shuffle, rng, seedOf, dayKey, fmtTime, formula, errorWords, errorWordsFor, inputError } from './kit.js';
import { loadWorld, naturalEarth, COUNTRIES, FULL_NAMES } from './puzzles.js';

const tag = (box, t, cls = '') => { box.className = 'gm-msg ' + cls; box.textContent = t; box.hidden = !t; };

/* ================= 1. Logic Circuit (pipes + logic gates + code) =================
   Turn the wire tiles so the current runs from the battery to the bulb. On the way are gates:
   a gate only lets the current through when its condition is TRUE, so you must also set the
   switches (A, B, C) and the number x. Light the bulb with every gate powered. */
const DIRS = [[-1, 0, 1, 4], [0, 1, 2, 8], [1, 0, 4, 1], [0, -1, 8, 2]]; // N E S W: [dr, dc, my side, their side]
const rot = (m) => ((m << 1) | (m >> 3)) & 15;
// [words, code, test(v)] — the same condition written two ways
const CONDS = {
  bool: [
    ['A', 'A', (v) => v.A], ['NOT A', '!A', (v) => !v.A], ['B', 'B', (v) => v.B], ['NOT B', '!B', (v) => !v.B],
    ['A AND B', 'A && B', (v) => v.A && v.B], ['A OR B', 'A || B', (v) => v.A || v.B], ['A XOR B', 'A != B', (v) => v.A !== v.B],
    ['NOT (A AND B)', '!(A && B)', (v) => !(v.A && v.B)], ['NOT (A OR B)', '!(A || B)', (v) => !(v.A || v.B)],
  ],
  bool3: [
    ['A AND NOT C', 'A && !C', (v) => v.A && !v.C], ['(A OR B) AND C', '(A || B) && C', (v) => (v.A || v.B) && v.C], ['B XOR C', 'B != C', (v) => v.B !== v.C],
    ['NOT C', '!C', (v) => !v.C], ['C', 'C', (v) => v.C], ['A NAND C', '!(A && C)', (v) => !(v.A && v.C)], ['B NOR C', '!(B || C)', (v) => !(v.B || v.C)],
  ],
  num: [
    ['x > 4', 'x > 4', (v) => v.x > 4], ['x < 3', 'x < 3', (v) => v.x < 3], ['x is even', 'x % 2 == 0', (v) => v.x % 2 === 0], ['x is odd', 'x % 2 == 1', (v) => v.x % 2 === 1],
    ['x is a multiple of 3', 'x % 3 == 0', (v) => v.x % 3 === 0], ['x + 2 = 7', 'x + 2 == 7', (v) => v.x + 2 === 7], ['2x > 10', '2 * x > 10', (v) => 2 * v.x > 10],
    ['3 ≤ x ≤ 6', 'x >= 3 && x <= 6', (v) => v.x >= 3 && v.x <= 6], ['x > 2 AND A', 'x > 2 && A', (v) => v.x > 2 && v.A], ['x < 5 OR B', 'x < 5 || B', (v) => v.x < 5 || v.B],
  ],
};
const LEVELS = { easy: { n: 5, gates: 2, vars: ['A', 'B'], pools: ['bool'] }, medium: { n: 6, gates: 3, vars: ['A', 'B', 'C'], pools: ['bool', 'bool3'] }, hard: { n: 7, gates: 4, vars: ['A', 'B', 'C', 'x'], pools: ['bool', 'bool3', 'num'] } };
const circuitLab = {
  id: 'circuit', name: 'Logic Circuit', subject: 'games', levels: ['hs', 'college'],
  blurb: 'Turn the wires so current flows from the battery to the bulb, but each gate only opens when its logic (AND, OR, NOT, XOR, if x > 4…) is TRUE. Set the switches to power them all.',
  words: 'logic gates boolean and or not xor circuit wires pipes coding programming if else conditions electricity puzzle',
  icon: '<rect x="4" y="18" width="7" height="12" rx="1"/><path d="M11 24h8M29 24h7"/><path d="M19 16h5a8 8 0 0 1 0 16h-5z"/><circle cx="40" cy="24" r="4"/><path d="M40 16v4M46 24h-2"/>',
  about: 'Tap a tile to turn it. Current starts at the battery (left) and must reach the bulb (right). The labelled tiles are gates: current passes a gate only while its condition is TRUE for your switches (A, B, C) and number x, a green gate is open, a red one is closed. Light the bulb with every gate on the circuit powered. “Code” shows the same conditions the way programmers write them (&& means AND, || means OR, ! means NOT). Every puzzle is built from a real working circuit, so there is always a solution.',
  mount({ stage, panel, api }) {
    let level = 'easy', notation = 'words', n = 5, tiles = [], gates = new Map(), vars = {}, start = 0, goal = 0, moves = 0, t0 = 0, done = false, geo = null, sim = { lit: new Set(), blocked: new Set(), bulb: false, powered: 0 };
    const hud = overlay(stage, 'tl'), msgBox = el('p', 'gm-msg'); msgBox.hidden = true;
    const usesOnly = (c, vs) => (c[1].match(/\b[ABCx]\b/g) || []).every((v) => vs.includes(v));
    function make(again = 0) {
      const L = LEVELS[level], rand = Math.random;
      n = L.n;
      // a path from the left edge to the right edge (a random walk that never crosses itself)
      let path = null;
      for (let tries = 0; tries < 400 && !path; tries++) {
        const r0 = Math.floor(rand() * n), seen = new Set([r0 * n]), p = [r0 * n];
        let budget = 3000;
        const walk = () => {
          if (--budget < 0) return false;
          const i = p[p.length - 1], r = (i / n) | 0, c = i % n;
          if (c === n - 1 && p.length >= n + 2) return true;
          for (const [dr, dc] of shuffle(DIRS, rand)) {
            const rr = r + dr, cc = c + dc, j = rr * n + cc;
            if (rr < 0 || cc < 0 || rr >= n || cc >= n || seen.has(j) || (dc < 0 && rand() < 0.6)) continue;
            seen.add(j); p.push(j);
            if (p.length < n * n * 0.55 && walk()) return true;
            p.pop(); seen.delete(j);
          }
          return false;
        };
        if (walk()) path = p;
      }
      if (!path) { if (again < 30) make(again + 1); return; }
      tiles = Array(n * n).fill(0);
      for (let k = 0; k < path.length; k++) {
        const i = path[k];
        if (k === 0) tiles[i] |= 8; // the battery is on the left
        if (k === path.length - 1) tiles[i] |= 2; // the bulb is on the right
        if (k + 1 < path.length) { const j = path[k + 1], d = DIRS.find(([dr, dc]) => ((i / n) | 0) + dr === ((j / n) | 0) && (i % n) + dc === j % n); tiles[i] |= d[2]; tiles[j] |= d[3]; }
      }
      start = path[0]; goal = path[path.length - 1];
      // the other tiles: random bits of wire (so the board looks like a real puzzle)
      for (let i = 0; i < n * n; i++) if (!tiles[i]) { const k = rand(); tiles[i] = k < 0.4 ? 5 : k < 0.75 ? 3 : k < 0.92 ? 7 : 0; }
      // gates on straight pieces of the path, each true for some setting of the switches
      const target = {}; L.vars.forEach((v) => { target[v] = v === 'x' ? Math.floor(rand() * 10) : rand() < 0.5; });
      // each level's newest idea comes first (C on Medium, the number x on Hard), then a mix
      const newest = L.vars.includes('x') ? 'num' : L.vars.includes('C') ? 'bool3' : 'bool';
      const ok = (c) => c[2](target) && usesOnly(c, L.vars);
      const pool = [...shuffle(CONDS[newest].filter(ok), rand).slice(0, 1), ...shuffle(L.pools.flatMap((p) => CONDS[p]).filter(ok), rand)].filter((c, k, a) => a.indexOf(c) === k);
      const straight = path.filter((i, k) => k > 0 && k < path.length - 1 && (tiles[i] === 5 || tiles[i] === 10));
      if (straight.length < Math.min(2, L.gates) && again < 30) { make(again + 1); return; }
      gates = new Map();
      shuffle(straight, rand).slice(0, L.gates).forEach((i, k) => gates.set(i, pool[k % pool.length]));
      // start with the switches set so at least one gate is closed
      vars = {};
      for (let tries = 0; tries < 50; tries++) {
        L.vars.forEach((v) => { vars[v] = v === 'x' ? Math.floor(rand() * 10) : rand() < 0.5; });
        if ([...gates.values()].some((g) => !g[2](vars))) break;
      }
      // scramble the tiles
      for (let i = 0; i < n * n; i++) { const t = Math.floor(rand() * 4); for (let q = 0; q < t; q++) tiles[i] = rot(tiles[i]); }
      moves = 0; t0 = performance.now(); done = false; tag(msgBox, '');
      run(); drawHud(); cv.redraw();
    }
    // follow the current from the battery
    function run() {
      const lit = new Set(), blocked = new Set();
      if (tiles[start] & 8) {
        const stack = [start]; lit.add(start);
        while (stack.length) {
          const i = stack.pop();
          if (gates.has(i) && !gates.get(i)[2](vars)) { blocked.add(i); continue; } // a closed gate stops it here
          const r = (i / n) | 0, c = i % n;
          for (const [dr, dc, me, them] of DIRS) {
            if (!(tiles[i] & me)) continue;
            const rr = r + dr, cc = c + dc, j = rr * n + cc;
            if (rr < 0 || cc < 0 || rr >= n || cc >= n || !(tiles[j] & them) || lit.has(j)) continue;
            lit.add(j); stack.push(j);
          }
        }
      }
      const open = [...gates.keys()].filter((i) => lit.has(i) && !blocked.has(i)).length;
      sim = { lit, blocked, bulb: lit.has(goal) && !blocked.has(goal) && !!(tiles[goal] & 2), powered: open };
      if (sim.bulb && open === gates.size && !done) {
        done = true;
        const secs = (performance.now() - t0) / 1000;
        api.check(0); if (level !== 'easy') api.check(1); if (level === 'hard') api.check(2);
        const b = api.best(-Math.round(secs), `${level} in ${fmtTime(secs)}`);
        tag(msgBox, `Lit! The bulb glows with all ${gates.size} gates powered: ${moves} turns in ${fmtTime(secs)}.${b && b.isNew ? ' New best!' : ''}`, 'good');
      }
      st.set([['Gates powered', `${open}/${gates.size}`], ['Turns', String(moves)], ['Bulb', sim.bulb ? 'ON' : 'off']]);
    }
    const label = (g) => (notation === 'code' ? g[1] : g[0]);
    function drawHud() {
      const L = LEVELS[level];
      hud.innerHTML = L.vars.map((v) => (v === 'x'
        ? `<span class="gm-x"><b>x =</b><button type="button" class="lab-btn" data-x="-1" aria-label="x minus one">−</button><output>${vars.x}</output><button type="button" class="lab-btn" data-x="1" aria-label="x plus one">+</button></span>`
        : `<button type="button" class="lab-btn toggle gm-sw" data-v="${v}" aria-pressed="${!!vars[v]}">${v} = ${notation === 'code' ? (vars[v] ? 'true' : 'false') : (vars[v] ? '1 (on)' : '0 (off)')}</button>`)).join('');
    }
    hud.addEventListener('click', (e) => {
      const b = e.target.closest('[data-v]'), x = e.target.closest('[data-x]');
      if (b) vars[b.dataset.v] = !vars[b.dataset.v];
      else if (x) vars.x = Math.max(0, Math.min(9, vars.x + +x.dataset.x));
      else return;
      if (done) return;
      run(); drawHud(); cv.redraw();
    });
    const cv = canvas(stage, (ctx, w, h) => {
      const top = 54, side = 44, cell = Math.floor(Math.min((w - side * 2) / n, (h - top - 16) / n)), ox = (w - cell * n) / 2, oy = top + (h - top - cell * n) / 2;
      geo = { cell, ox, oy };
      const glow = '#ffd257', dead = '#6c6c76', on = (i) => sim.lit.has(i);
      for (let i = 0; i < n * n; i++) {
        const r = (i / n) | 0, c = i % n, x = ox + c * cell, y = oy + r * cell, cx = x + cell / 2, cy = y + cell / 2;
        ctx.fillStyle = 'rgba(255,255,255,.04)'; ctx.fillRect(x + 1, y + 1, cell - 2, cell - 2);
        const col = on(i) ? glow : dead;
        ctx.save(); if (on(i)) { ctx.shadowColor = glow; ctx.shadowBlur = 10; }
        ctx.strokeStyle = col; ctx.lineWidth = Math.max(3, cell * 0.12); ctx.lineCap = 'round';
        DIRS.forEach(([dr, dc, me]) => { if (tiles[i] & me) { ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + (dc * cell) / 2, cy + (dr * cell) / 2); ctx.stroke(); } });
        ctx.restore();
        if (gates.has(i)) {
          const g = gates.get(i), open = g[2](vars), bw = cell * 0.86, bh = cell * 0.5;
          ctx.fillStyle = open ? 'rgba(46,160,90,.92)' : 'rgba(200,60,60,.92)';
          ctx.beginPath(); ctx.roundRect ? ctx.roundRect(cx - bw / 2, cy - bh / 2, bw, bh, 8) : ctx.rect(cx - bw / 2, cy - bh / 2, bw, bh); ctx.fill();
          let fs = Math.max(9, Math.min(15, cell * 0.2)); ctx.font = `700 ${fs}px ui-monospace, Menlo, monospace`;
          const t = label(g); while (ctx.measureText(t).width > bw - 6 && fs > 8) { fs--; ctx.font = `700 ${fs}px ui-monospace, Menlo, monospace`; }
          text(ctx, t, cx, cy + 1, '#fff', 'center', 'middle');
        } else if (tiles[i]) dot(ctx, cx, cy, Math.max(2.5, cell * 0.07), col);
      }
      // the battery and the bulb
      const by = oy + ((start / n) | 0) * cell + cell / 2, gy = oy + ((goal / n) | 0) * cell + cell / 2;
      ctx.fillStyle = '#c9c9d1'; ctx.fillRect(ox - 34, by - 13, 22, 26); ctx.fillStyle = '#888'; ctx.fillRect(ox - 12, by - 5, 6, 10);
      text(ctx, '+', ox - 23, by + 1, '#111', 'center', 'middle');
      ctx.strokeStyle = on(start) ? glow : dead; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(ox - 6, by); ctx.lineTo(ox, by); ctx.stroke();
      ctx.save(); if (sim.bulb) { ctx.shadowColor = glow; ctx.shadowBlur = 30; }
      dot(ctx, ox + n * cell + 22, gy, 13, sim.bulb ? glow : '#3a3a42'); ctx.restore();
      ctx.strokeStyle = '#aaa'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(ox + n * cell + 22, gy, 13, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = sim.bulb ? glow : dead; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(ox + n * cell, gy); ctx.lineTo(ox + n * cell + 9, gy); ctx.stroke();
    });
    cv.c.addEventListener('click', (e) => {
      if (!geo || done) return;
      const p = at(cv.c, e), c = Math.floor((p.x - geo.ox) / geo.cell), r = Math.floor((p.y - geo.oy) / geo.cell);
      if (r < 0 || c < 0 || r >= n || c >= n) return;
      tiles[r * n + c] = rot(tiles[r * n + c]); moves++;
      run(); cv.redraw();
    });
    panel.appendChild(el('p', 'lab-note', 'Tap a tile to turn it. Set the switches at the top so every gate on your circuit turns green.'));
    seg(group(panel, 'Level'), { options: [['easy', 'Easy · A, B'], ['medium', 'Medium · A, B, C'], ['hard', 'Hard · + number x']], value: level, onChange: (v) => { level = v; make(); } });
    seg(group(panel, 'Write the gates as'), { options: [['words', 'Words (AND, OR, NOT)'], ['code', 'Code (&&, ||, !)']], value: notation, onChange: (v) => { notation = v; drawHud(); cv.redraw(); } });
    const st = stats(panel);
    panel.appendChild(msgBox);
    button(row(panel), 'New circuit', () => make(), 'main');
    make();
    return {
      state: () => `a ${level} logic circuit; switches ${Object.entries(vars).map(([k, v]) => `${k}=${typeof v === 'boolean' ? (v ? 'true' : 'false') : v}`).join(', ')}; gates: ${[...gates.values()].map((g) => `${g[0]} is ${g[2](vars) ? 'TRUE (open)' : 'FALSE (closed)'}`).join('; ')}; bulb ${sim.bulb ? 'on' : 'off'}`,
      destroy: () => cv.destroy(),
    };
  },
  tries: ['Light the bulb on Easy', 'Solve a Medium circuit', 'Solve a Hard circuit with the number x'],
  hints: ['First set A and B so every gate is green, then turn the tiles to join the wire.', 'For XOR, exactly one of the two must be true. For NAND, they must NOT both be true.', 'Try each value of x with + and − and watch which gates turn green.'],
};

/* ================= 2. Formula Cracker (a rule, a pattern, a compound) =================
   Deduce what's hidden in six guesses, from what it does to numbers, strings or a mass. */
const RULES = [
  (r) => { const a = 2 + Math.floor(r() * 4), b = Math.floor(r() * 19) - 9; return [`${a}x ${b < 0 ? '−' : '+'} ${Math.abs(b)}`, (x) => a * x + b]; },
  (r) => { const a = -1 - Math.floor(r() * 3), b = Math.floor(r() * 10); return [`${b} − ${a === -1 ? '' : -a}x`, (x) => a * x + b]; },
  (r) => { const b = Math.floor(r() * 11) - 5; return [`x² ${b < 0 ? '−' : '+'} ${Math.abs(b)}`, (x) => x * x + b]; },
  (r) => { const a = 2 + Math.floor(r() * 2); return [`${a}x²`, (x) => a * x * x]; },
  (r) => { const a = 1 + Math.floor(r() * 4); return [`x² + ${a}x`, (x) => x * x + a * x]; },
  (r) => { const a = 1 + Math.floor(r() * 3); return [`(x + ${a})²`, (x) => (x + a) ** 2]; },
  () => ['x³', (x) => x ** 3], () => ['2^x', (x) => 2 ** x],
  (r) => { const a = 10 + Math.floor(r() * 11); return [`${a} − x`, (x) => a - x]; },
  (r) => { const a = 2 + Math.floor(r() * 3), b = 1 + Math.floor(r() * 4); return [`${a}(x − ${b})`, (x) => a * (x - b)]; },
];
const PATTERNS = [
  ['^\\d{3}$', '', ['123', '007', '12', '1234', 'abc', '999', '4a5', '000', '9 9'], 'Exactly three…'],
  ['^[A-Z][a-z]+$', '', ['Manila', 'cebu', 'DAVAO', 'Iloilo', 'Baguio2', 'Q', 'Bohol', 'taal', 'Vigan'], 'Think about capital letters.'],
  ['^09\\d{9}$', '', ['09171234567', '0917123456', '08171234567', '09998887777', '+639171234567', '0917-123-4567', '09051112222'], 'Philippine mobile numbers.'],
  ['cat|dog', '', ['category', 'hotdog', 'cow', 'catalog', 'doge', 'bird', 'scatter', 'dig'], 'Two animals hide inside.'],
  ['^a.*z$', '', ['abuzz', 'az', 'zebra', 'ahz', 'baz', 'a-z', 'azure', 'amaz'], 'Look at the first and the last letter.'],
  ['^(ha)+$', '', ['ha', 'haha', 'hahaha', 'hah', 'aha', 'hh', 'HAHA', 'hahahaha'], 'Something repeats.'],
  ['^[aeiou]', 'i', ['apple', 'Orange', 'banana', 'umbrella', 'sky', 'Egg', 'grape', 'ice'], 'It’s about how the word starts.'],
  ['\\d+%$', '', ['50%', '100%', '%50', '7 %', '99%', 'fifty%', '3.5%', '0%'], 'Percentages…'],
  ['^#[0-9a-f]{6}$', 'i', ['#ff00aa', '#FFF', '#12345g', '#A1B2C3', 'ff00aa', '#000000', '#abc1234'], 'Web colours.'],
  ['^\\w+@\\w+\\.com$', '', ['ana@mail.com', 'ben@site.org', '@mail.com', 'cara@x.com', 'dan.mail.com', 'e_f@gmail.com', 'g@h.co'], 'Simple e-mail addresses.'],
  ['^\\d+(\\.\\d+)?$', '', ['3', '3.14', '.5', '10.', '42', '7.0', 'a1', '1.2.3'], 'Numbers, with or without a decimal part.'],
  ['^(\\w)\\w*\\1$', '', ['level', 'noon', 'apple', 'abca', 'xyz', 'radar', 'bob', 'ok'], 'Compare the first letter with the last.'],
];
const MASS = { H: 1.008, He: 4.003, Li: 6.94, Be: 9.012, B: 10.81, C: 12.011, N: 14.007, O: 15.999, F: 18.998, Ne: 20.18, Na: 22.99, Mg: 24.305, Al: 26.982, Si: 28.085, P: 30.974, S: 32.06, Cl: 35.45, Ar: 39.948, K: 39.098, Ca: 40.078, Cr: 51.996, Mn: 54.938, Fe: 55.845, Co: 58.933, Ni: 58.693, Cu: 63.546, Zn: 65.38, Br: 79.904, Ag: 107.868, Sn: 118.71, I: 126.904, Ba: 137.327, Au: 196.967, Hg: 200.59, Pb: 207.2 };
const COMPOUNDS = [['H2O', 'water'], ['CO2', 'carbon dioxide'], ['NaCl', 'sodium chloride (table salt)'], ['NH3', 'ammonia'], ['CH4', 'methane'], ['HCl', 'hydrochloric acid'], ['NaOH', 'sodium hydroxide (lye)'], ['H2SO4', 'sulfuric acid'], ['CaCO3', 'calcium carbonate (limestone, chalk)'], ['C6H12O6', 'glucose'], ['KCl', 'potassium chloride'], ['MgO', 'magnesium oxide'], ['NaHCO3', 'sodium bicarbonate (baking soda)'], ['H2O2', 'hydrogen peroxide'], ['O3', 'ozone'], ['Fe2O3', 'iron(III) oxide (rust)'], ['C2H6O', 'ethanol'], ['CO', 'carbon monoxide'], ['HNO3', 'nitric acid'], ['Ca(OH)2', 'calcium hydroxide (slaked lime)'], ['CuSO4', 'copper(II) sulfate'], ['AgNO3', 'silver nitrate'], ['C12H22O11', 'sucrose (table sugar)'], ['KMnO4', 'potassium permanganate'], ['SO2', 'sulfur dioxide'], ['NO2', 'nitrogen dioxide'], ['Al2O3', 'aluminium oxide'], ['CaO', 'calcium oxide (quicklime)']];
// "Ca(OH)2" → { Ca: 1, O: 2, H: 2 }; throws on something that isn't a formula
export function atomsOf(f) {
  const s = String(f).replace(/\s+/g, '').replace(/[₀-₉]/g, (d) => '₀₁₂₃₄₅₆₇₈₉'.indexOf(d));
  if (!s || s.length > 30) throw inputError('Type a formula like H2O or Ca(OH)2.');
  let i = 0;
  const group = () => {
    const out = {};
    while (i < s.length && s[i] !== ')') {
      let part;
      if (s[i] === '(') { i++; part = group(); if (s[i] !== ')') throw inputError('A bracket isn’t closed.'); i++; }
      else { const m = /^[A-Z][a-z]?/.exec(s.slice(i)); if (!m || !MASS[m[0]]) throw inputError(`“${(m && m[0]) || s[i]}” isn’t an element I know. Elements start with a capital letter (Na, Cl, O…).`); i += m[0].length; part = { [m[0]]: 1 }; }
      const d = /^\d+/.exec(s.slice(i)); const k = d ? +d[0] : 1; if (d) i += d[0].length;
      for (const [e, c] of Object.entries(part)) out[e] = (out[e] || 0) + c * k;
    }
    return out;
  };
  const a = group();
  if (i < s.length) throw inputError('There’s a “)” without a “(”.');
  return a;
}
const massOf = (atoms) => Object.entries(atoms).reduce((s2, [e, c]) => s2 + MASS[e] * c, 0);
const crackerLab = {
  id: 'cracker', name: 'Formula Cracker', subject: 'games', levels: ['hs', 'college', 'grad'],
  blurb: 'A Wordle for maths, code and chemistry: crack the hidden function rule, regular expression or chemical compound in six guesses, using what it does as clues.',
  words: 'wordle guess formula equation function rule regex regular expression pattern chemical compound molar mass algebra puzzle',
  icon: '<rect x="4" y="10" width="8" height="8" rx="1"/><rect x="14" y="10" width="8" height="8" rx="1"/><rect x="24" y="10" width="8" height="8" rx="1"/><rect x="34" y="10" width="8" height="8" rx="1"/><rect x="4" y="22" width="8" height="8" rx="1"/><rect x="14" y="22" width="8" height="8" rx="1"/><path d="M27 34l5 5 9-12"/>',
  about: 'Rule: a hidden f(x). You see a few of its outputs and can test 3 more x values; each guess is checked at x = −3…5, green where your formula gives the same number, ↑ or ↓ where the hidden one is higher or lower. Pattern: a hidden regular expression; you see which strings it matches; each guess shows which strings YOUR pattern matches, green where you agree. Compound: a hidden chemical formula; you know its molar mass; each element you guess turns green (in it, right number), gold (in it, wrong number, with ↑ or ↓) or grey (not in it). Today’s puzzles are the same for everyone; “New one” makes more.',
  mount({ stage, panel, api }) {
    let mode = 'rule', practice = false, hidden = null, guesses = [], probes = [], over = false, fixedXs = [0, 1, 2];
    const MAX = 6, TESTX = [-3, -2, -1, 0, 1, 2, 3, 4, 5];
    const page = el('div', 'tl-sheet gm-crack'); stage.appendChild(page);
    seg(group(panel, 'Crack a…'), { options: [['rule', 'Function rule'], ['regex', 'Regex pattern'], ['compound', 'Chemical compound']], value: mode, onChange: (v) => { mode = v; practice = false; make(); } });
    const r = row(panel);
    button(r, 'New one', () => { practice = true; make(); }, 'main');
    const backBtn = button(r, 'Today’s puzzle', () => { practice = false; make(); });
    const st = stats(panel);
    const msg = el('p', 'gm-msg'); msg.hidden = true; panel.appendChild(msg);
    function make() {
      const rand = rng(practice ? (Math.random() * 2 ** 32) >>> 0 : seedOf(dayKey() + 'cracker' + mode));
      guesses = []; probes = []; over = false; tag(msg, '');
      if (mode === 'rule') { const [shown, f] = RULES[Math.floor(rand() * RULES.length)](rand); hidden = { shown, f }; }
      else if (mode === 'regex') { const p = PATTERNS[Math.floor(rand() * PATTERNS.length)]; hidden = { src: p[0], flags: p[1], re: new RegExp(p[0], p[1]), strings: p[2], hint: p[3] }; }
      else { const c = COMPOUNDS[Math.floor(rand() * COMPOUNDS.length)]; hidden = { f: c[0], name: c[1], atoms: atomsOf(c[0]), mass: massOf(atomsOf(c[0])) }; }
      backBtn.hidden = !practice;
      draw();
    }
    const fmt = (v) => (Number.isFinite(v) ? String(+v.toFixed(3)) : '-');
    function draw() {
      let body = '';
      const left = MAX - guesses.length;
      if (mode === 'rule') {
        const xs = [...fixedXs, ...probes];
        body = `<p class="gm-lead">Find the hidden rule <b>f(x) = ?</b></p>
          <table class="gm-table"><tr><th>x</th>${xs.map((x) => `<td>${x}</td>`).join('')}</tr><tr><th>f(x)</th>${xs.map((x) => `<td>${fmt(hidden.f(x))}</td>`).join('')}</tr></table>
          ${probes.length < 3 && !over ? `<form class="gm-probe"><label>Test an x: <input type="number" step="1" min="-10" max="10" required aria-label="x to test"></label><button class="lab-btn" type="submit">Show f(x) (${3 - probes.length} left)</button></form>` : ''}
          <table class="gm-table gm-guesses"><tr><th>Your guess</th>${TESTX.map((x) => `<th>x=${x}</th>`).join('')}</tr>
          ${guesses.map((g) => `<tr><th>${esc(g.text)}</th>${TESTX.map((x, i) => { const y = g.ys[i], t = hidden.f(x); const same = Math.abs(y - t) < 1e-9; return `<td class="${same ? 'gm-g' : 'gm-n'}">${fmt(y)}${same ? '' : t > y ? ' ↑' : ' ↓'}</td>`; }).join('')}</tr>`).join('')}</table>`;
      } else if (mode === 'regex') {
        body = `<p class="gm-lead">Find the hidden regular expression. Matches: ✓ · doesn’t match: ✗</p>
          <table class="gm-table gm-guesses"><tr><th>String</th><th>Hidden</th>${guesses.map((g, k) => `<th title="${esc(g.text)}">#${k + 1}</th>`).join('')}</tr>
          ${hidden.strings.map((s2) => { const want = hidden.re.test(s2); return `<tr><th><code>${esc(s2)}</code></th><td>${want ? '✓' : '✗'}</td>${guesses.map((g) => { const got = g.re.test(s2); return `<td class="${got === want ? 'gm-g' : 'gm-bad'}">${got ? '✓' : '✗'}</td>`; }).join('')}</tr>`; }).join('')}</table>
          ${guesses.length ? `<p class="gm-small">${guesses.map((g, k) => `#${k + 1}: <code>/${esc(g.text)}/</code>`).join(' · ')}</p>` : ''}
          ${guesses.length >= 3 && !over ? `<p class="gm-small">Hint: ${esc(hidden.hint)}</p>` : ''}`;
      } else {
        const n = Object.keys(hidden.atoms).length, atoms = Object.values(hidden.atoms).reduce((a, b) => a + b, 0);
        body = `<p class="gm-lead">The hidden compound: <b>${hidden.mass.toFixed(2)} g/mol</b> · ${n} element${n === 1 ? '' : 's'} · ${atoms} atoms</p>
          <div class="gm-rows">${guesses.map((g) => `<div class="gm-row"><code>${esc(g.text)}</code>${Object.entries(g.atoms).map(([e, c]) => { const t = hidden.atoms[e]; const cls = t == null ? 'gm-n' : t === c ? 'gm-g' : 'gm-y'; return `<span class="gm-tile ${cls}">${e}${c > 1 ? `<sub>${c}</sub>` : ''}${t != null && t !== c ? (t > c ? ' ↑' : ' ↓') : ''}</span>`; }).join('')}<small>${g.mass.toFixed(2)} g/mol ${Math.abs(g.mass - hidden.mass) < 0.01 ? '=' : g.mass < hidden.mass ? '↑ heavier' : '↓ lighter'}</small></div>`).join('')}</div>`;
      }
      page.innerHTML = `${body}${over ? '' : `<form class="gm-guess"><input type="text" autocomplete="off" spellcheck="false" aria-label="Your guess" placeholder="${mode === 'rule' ? 'e.g. 2x + 3, x^2 - 1' : mode === 'regex' ? 'e.g. ^\\d+$' : 'e.g. H2O, Ca(OH)2'}"><button class="lab-btn main" type="submit">Guess (${left} left)</button></form>`}`;
      st.set([['Guesses', `${guesses.length}/${MAX}`], ['Puzzle', practice ? 'practice' : `today · ${dayKey()}`]]);
      if (!over) setTimeout(() => { const i = page.querySelector('.gm-guess input'); if (i && document.activeElement === document.body) i.focus({ preventScroll: true }); }, 0);
    }
    function guess(textIn) {
      const t = textIn.trim();
      if (!t || over) return;
      let g;
      try {
        if (mode === 'rule') { const f = formula(t); g = { text: t, ys: TESTX.map((x) => f(x)) }; if (g.ys.some((y) => !Number.isFinite(y))) throw inputError('That formula breaks at some x, so it can’t be drawn. Try another.'); }
        else if (mode === 'regex') { const m = t.match(/^\/(.*)\/([gimsuy]*)$/); const src = m ? m[1] : t; if (src.length > 60) throw inputError('That pattern is too long. Keep it under 60 characters.'); g = { text: src, re: new RegExp(src, (m ? m[2] : '').replace(/[gy]/g, '')) }; }
        else { const atoms = atomsOf(t); g = { text: t, atoms, mass: massOf(atoms) }; }
      } catch (e) { tag(msg, errorWordsFor(e, 'pattern_unreadable'), 'bad'); return; }
      tag(msg, '');
      guesses.push(g); api.check(0);
      const won = mode === 'rule' ? TESTX.every((x, i) => Math.abs(g.ys[i] - hidden.f(x)) < 1e-9)
        : mode === 'regex' ? hidden.strings.every((s2) => g.re.test(s2) === hidden.re.test(s2))
          : Object.keys(hidden.atoms).length === Object.keys(g.atoms).length && Object.entries(hidden.atoms).every(([e, c]) => g.atoms[e] === c);
      if (won) {
        over = true;
        const b = api.best(-guesses.length, `cracked in ${guesses.length}`);
        tag(msg, `Cracked in ${guesses.length}! ${mode === 'rule' ? `f(x) = ${hidden.shown}` : mode === 'regex' ? `The pattern was /${hidden.src}/${hidden.flags}` : `${hidden.f} is ${hidden.name}.`}${b && b.isNew ? ' New best!' : ''}`, 'good');
        api.check(mode === 'rule' ? 1 : 2);
      } else if (guesses.length >= MAX) { over = true; tag(msg, `Out of guesses. It was ${mode === 'rule' ? 'f(x) = ' + hidden.shown : mode === 'regex' ? '/' + hidden.src + '/' + hidden.flags : hidden.f + ' (' + hidden.name + ')'}. Tap “New one” to try another.`, ''); }
      draw();
    }
    page.addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target;
      if (!f.querySelector('input').value.trim()) { f.querySelector('input').focus(); return; } // nothing typed yet: the box is where to type
      if (f.classList.contains('gm-probe')) { const x = Math.round(+f.querySelector('input').value); if (Number.isFinite(x) && x >= -10 && x <= 10 && ![...fixedXs, ...probes].includes(x)) { probes.push(x); draw(); } return; }
      guess(f.querySelector('input').value);
    });
    make();
    return { state: () => `cracking a ${mode}: ${guesses.length} guesses so far (${guesses.map((g) => g.text).join(', ') || 'none'})${mode === 'compound' ? `; hidden molar mass ${hidden.mass.toFixed(2)} g/mol` : ''}`, destroy() {} };
  },
  tries: ['Make a guess', 'Crack a function rule', 'Crack a regex or a compound'],
  hints: ['Type any guess: even a wrong one shows you clues.', 'Look at how f(x) changes when x goes up by 1: the same jump each time means a straight line (ax + b).', 'Regex: start simple (like ^\\d+$), then fix the red rows. Compound: match the molar mass.'],
};

/* ================= 3. Pinning Blitz (countries, cell parts, organs — against the clock) ================= */
// diagrams drawn in their own units; each part is a shape you can tap
const ell = (cx, cy, rx, ry, rotA = 0) => { const p = new Path2D(); p.ellipse(cx, cy, rx, ry, rotA, 0, Math.PI * 2); return p; };
const circ = (cx, cy, r) => ell(cx, cy, r, r);
function band(cx, cy, rx, ry, w) { const p = new Path2D(); p.ellipse(cx, cy, rx + w, ry + w, 0, 0, Math.PI * 2); p.ellipse(cx, cy, rx - w, ry - w, 0, 0, Math.PI * 2); return p; }
function rbox(x, y, w, h, r) { const p = new Path2D(); if (p.roundRect) p.roundRect(x, y, w, h, r); else p.rect(x, y, w, h); return p; }
const DIAGRAMS = {
  cell: { name: 'Animal cell', w: 1000, h: 700, bg: (ctx) => { ctx.fillStyle = 'rgba(127,178,255,.10)'; ctx.fill(ell(500, 350, 460, 320)); },
    parts: [
      ['Nucleolus', () => circ(495, 318, 36), '#c4a0ff'],
      ['Nucleus', () => circ(480, 330, 118), '#7d64c8'],
      ['Mitochondrion', () => { const p = new Path2D(); [[255, 215, 0.4], [770, 230, -0.3], [650, 565, 0.2]].forEach(([x, y, a]) => p.addPath(ell(x, y, 58, 28, a))); return p; }, '#ff9d6b'],
      ['Golgi apparatus', () => { const p = new Path2D(); for (let k = 0; k < 4; k++) p.addPath(ell(735, 400 + k * 22, 70 - k * 8, 9, -0.15)); return p; }, '#ffcf5a'],
      ['Rough ER', () => { const p = new Path2D(); p.arc(480, 330, 182, -1.1, 1.1); p.arc(480, 330, 140, 1.1, -1.1, true); p.closePath(); return p; }, '#6fe3e0'],
      ['Smooth ER', () => { const p = new Path2D(); for (let k = 0; k < 3; k++) p.addPath(ell(285 + k * 12, 470 + k * 26, 75, 11, 0.25)); return p; }, '#7fe0a8'],
      ['Lysosome', () => { const p = new Path2D(); p.addPath(circ(395, 585, 22)); p.addPath(circ(860, 340, 20)); return p; }, '#ff7a7a'],
      ['Centrioles', () => { const p = new Path2D(); p.addPath(rbox(585, 150, 46, 16, 6)); p.addPath(rbox(600, 135, 16, 46, 6)); return p; }, '#e6e6ee'],
      ['Vacuole', () => circ(175, 400, 34), '#9fd0ff'],
      ['Cell membrane', () => band(500, 350, 460, 320, 12), '#7fb2ff'],
    ] },
  plant: { name: 'Plant cell', w: 1000, h: 700, bg: (ctx) => { ctx.fillStyle = 'rgba(127,224,168,.10)'; ctx.fill(rbox(70, 70, 860, 560, 40)); },
    parts: [
      ['Nucleolus', () => circ(225, 255, 26), '#c4a0ff'],
      ['Nucleus', () => circ(220, 262, 82), '#7d64c8'],
      ['Chloroplast', () => { const p = new Path2D(); [[160, 470, 0.3], [300, 560, -0.2], [650, 120, 0], [880, 300, 1.4], [480, 600, 0.1], [820, 560, -0.4]].forEach(([x, y, a]) => p.addPath(ell(x, y, 46, 24, a))); return p; }, '#46b85f'],
      ['Mitochondrion', () => { const p = new Path2D(); [[380, 140, 0.3], [130, 360, 1.3]].forEach(([x, y, a]) => p.addPath(ell(x, y, 40, 19, a))); return p; }, '#ff9d6b'],
      ['Central vacuole', () => rbox(380, 190, 450, 330, 120), '#9fd0ff'],
      ['Golgi apparatus', () => { const p = new Path2D(); for (let k = 0; k < 4; k++) p.addPath(ell(235, 410 + k * 18, 52 - k * 6, 7, 0.1)); return p; }, '#ffcf5a'],
      ['Cell membrane', () => { const p = new Path2D(); p.addPath(rbox(84, 84, 832, 532, 34)); p.addPath(rbox(98, 98, 804, 504, 28)); return p; }, '#7fb2ff'],
      ['Cell wall', () => { const p = new Path2D(); p.addPath(rbox(56, 56, 888, 588, 44)); p.addPath(rbox(80, 80, 840, 540, 36)); return p; }, '#a8d08d'],
    ] },
  body: { name: 'Human organs', w: 600, h: 840, bg: (ctx) => {
      ctx.fillStyle = 'rgba(242,242,244,.07)'; ctx.strokeStyle = 'rgba(242,242,244,.35)'; ctx.lineWidth = 3;
      const p = new Path2D('M300 20c-48 0-78 36-78 84 0 34 14 60 38 74l-6 26c-60 8-112 34-128 80l-22 220c-2 22 26 26 30 4l26-196 6 2-6 280 40 230h48l12-200h20l12 200h48l40-230-6-280 6-2 26 196c4 22 32 18 30-4l-22-220c-16-46-68-72-128-80l-6-26c24-14 38-40 38-74 0-48-30-84-78-84z');
      ctx.fill(p); ctx.stroke(p);
    },
    parts: [
      ['Brain', () => ell(300, 92, 64, 50), '#ff9ec7'],
      ['Thyroid', () => ell(300, 215, 26, 10), '#ffcf5a'],
      ['Heart', () => ell(322, 360, 34, 40, 0.3), '#ff5a5a'],
      ['Lungs', () => { const p = new Path2D(); p.addPath(ell(240, 345, 52, 88)); p.addPath(ell(362, 345, 46, 84)); return p; }, '#ffb0b0'],
      ['Gallbladder', () => ell(270, 500, 14, 18), '#7fe0a8'],
      ['Liver', () => ell(255, 462, 84, 40, -0.1), '#a0522d'],
      ['Spleen', () => ell(398, 452, 20, 32, 0.3), '#c46b8a'],
      ['Pancreas', () => ell(330, 530, 58, 12, -0.15), '#ffd58a'],
      ['Stomach', () => ell(350, 478, 44, 36, 0.4), '#f0a8c0'],
      ['Kidneys', () => { const p = new Path2D(); p.addPath(ell(250, 560, 20, 34)); p.addPath(ell(352, 560, 20, 34)); return p; }, '#b05050'],
      ['Bladder', () => ell(300, 760, 32, 24), '#ffe08a'],
      ['Small intestine', () => ell(300, 660, 72, 52), '#f4b6a0'],
      ['Large intestine', () => { const p = new Path2D(); p.addPath(rbox(204, 588, 26, 130, 12)); p.addPath(rbox(204, 584, 194, 26, 12)); p.addPath(rbox(372, 588, 26, 130, 12)); p.addPath(rbox(300, 700, 98, 24, 12)); return p; }, '#d98c6a'],
    ] },
};
const blitzLab = {
  id: 'blitz', name: 'Pinning Blitz', subject: 'games', levels: ['hs', 'college'],
  blurb: 'Rapid fire: countries on the world map, parts of a cell or organs of the body flash up, pin each one before the clock runs out.',
  words: 'geography map countries anatomy organs cell organelles memory speed quiz pin drag label timer blitz',
  icon: '<circle cx="24" cy="24" r="17"/><path d="M24 7v4M24 37v4M7 24h4M37 24h4"/><path d="M24 15c-4 0-7 3-7 7 0 5 7 12 7 12s7-7 7-12c0-4-3-7-7-7z"/><circle cx="24" cy="22" r="2"/>',
  about: 'Find it: a name appears. Tap where it is (or drag the name onto the spot). Name it: a place lights up. Pick its name. You have 60 seconds. A right answer is worth 100 points plus a speed bonus, and every right answer in a row raises your combo (×2, ×3…). A wrong tap costs 20 points and resets the combo. The organs are drawn as seen from the front, so the body’s right side (the liver) is on your left. The diagrams are simplified for learning.',
  mount({ stage, panel, api }) {
    let map = 'world', style = 'find', world = null, proj = null, items = [], ask = null, opts = [], score = 0, combo = 0, right = 0, wrong = 0, endAt = 0, running = false, askedAt = 0, flash = null, timer = 0, last = null;
    const hud = el('div', 'gm-blitz'); stage.appendChild(hud);
    const msg = el('p', 'gm-msg'); msg.hidden = true;
    const hit = document.createElement('canvas').getContext('2d');
    seg(group(panel, 'Map'), { options: [['world', 'World countries'], ['cell', 'Animal cell'], ['plant', 'Plant cell'], ['body', 'Human organs']], value: map, onChange: (v) => { map = v; stop(); prepare(); } });
    seg(group(panel, 'Style'), { options: [['find', 'Find it (tap / drag the name)'], ['name', 'Name it (pick the name)']], value: style, onChange: (v) => { style = v; stop(); prepare(); } });
    const st = stats(panel);
    panel.appendChild(msg);
    const goBtn = button(row(panel), 'Start (60 s)', () => start(), 'main');
    async function prepare() {
      ask = null; flash = null; last = null;
      if (map === 'world') {
        hud.innerHTML = '<p class="gm-q">Loading the map…</p>';
        world = world || await loadWorld().catch(() => null);
        if (!world) { hud.innerHTML = `<p class="gm-q">${esc(errorWords('lab_map_failed'))}</p>`; return; }
        const names = new Set(COUNTRIES.map((c) => c[0]));
        items = world.filter((c) => names.has(c.name)).map((c) => ({ name: (COUNTRIES.find((x) => x[0] === c.name) || [])[1] ? COUNTRIES.find((x) => x[0] === c.name)[1].replace(/^the /, '') : FULL_NAMES[c.name] || c.name, c, cont: (COUNTRIES.find((x) => x[0] === c.name) || [])[5] }));
      } else items = DIAGRAMS[map].parts.map(([name, mk, col]) => ({ name, path: mk(), col, rule: /membrane|wall/i.test(name) ? 'evenodd' : 'nonzero' }));
      hud.innerHTML = `<p class="gm-q">${map === 'world' ? 'Countries of the world' : DIAGRAMS[map].name} · tap Start</p>`;
      draw(); cv.redraw();
    }
    // map units → screen
    function layout(w, h) {
      if (map === 'world') {
        const k = Math.min((w - 20) / 5.6, (h - 90) / 2.9);
        return { k, ox: w / 2, oy: 60 + (h - 70) / 2, toS: (lon, lat) => { const [x, y] = naturalEarth(lon, lat); return [w / 2 + x * k, 60 + (h - 70) / 2 - y * k]; } };
      }
      const D = DIAGRAMS[map], k = Math.min((w - 20) / D.w, (h - 80) / D.h);
      return { k, ox: (w - D.w * k) / 2, oy: 66 + (h - 76 - D.h * k) / 2 };
    }
    function countryPath(c, L) {
      const p = new Path2D();
      // rings that cross the date line are unwrapped so they don't streak across the map
      for (const poly of c.polys) for (const ring of poly) { let prev = null; ring.forEach(([lo, la], i) => { if (prev != null) { while (lo - prev > 180) lo -= 360; while (prev - lo > 180) lo += 360; } prev = lo; const [x, y] = L.toS(Math.max(-180, Math.min(180, lo)), la); if (i) p.lineTo(x, y); else p.moveTo(x, y); }); p.closePath(); }
      return p;
    }
    const cv = canvas(stage, (ctx, w, h) => {
      const L = layout(w, h); proj = L;
      if (map === 'world') {
        if (!world) return;
        for (const c of world) {
          const p = countryPath(c, L), isFlash = flash && flash.c === c, isLast = last && last.c === c;
          ctx.fillStyle = isFlash ? C.gold : isLast ? (last.ok ? 'rgba(127,224,168,.8)' : 'rgba(255,122,122,.7)') : 'rgba(242,242,244,.13)';
          ctx.fill(p, 'evenodd'); ctx.strokeStyle = 'rgba(242,242,244,.35)'; ctx.lineWidth = 0.6; ctx.stroke(p);
        }
        return;
      }
      const D = DIAGRAMS[map];
      ctx.save(); ctx.translate(L.ox, L.oy); ctx.scale(L.k, L.k);
      D.bg(ctx);
      for (const it of [...items].reverse()) {
        const isFlash = flash && flash === it, isLast = last && last.it === it;
        ctx.fillStyle = isFlash ? C.gold : it.col; ctx.globalAlpha = isFlash ? 1 : 0.78;
        ctx.fill(it.path, it.rule);
        if (isLast) { ctx.globalAlpha = 1; ctx.strokeStyle = last.ok ? C.green : C.red; ctx.lineWidth = 5 / L.k * 1.2; ctx.stroke(it.path); }
      }
      ctx.restore();
    });
    // what is under a point on the screen
    function partAt(x, y) {
      const L = proj; if (!L) return null;
      if (map === 'world') {
        for (const c of world) { const p = countryPath(c, L); if (hit.isPointInPath(p, x, y, 'evenodd')) return items.find((i) => i.c === c) || { name: FULL_NAMES[c.name] || c.name, c }; }
        return null;
      }
      const ux = (x - L.ox) / L.k, uy = (y - L.oy) / L.k;
      return items.find((it) => hit.isPointInPath(it.path, ux, uy, it.rule)) || null;
    }
    // near misses on the world map count when the tap is within a few pixels of a small country
    function nearCountry(x, y, target) {
      const L = proj; let best = 1e9;
      for (const poly of target.c.polys) for (const ring of poly) for (let i = 1; i < ring.length; i++) { const [ax, ay] = L.toS(...ring[i - 1]), [bx, by] = L.toS(...ring[i]); const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1))); best = Math.min(best, Math.hypot(x - ax - t * dx, y - ay - t * dy)); }
      return best < 10;
    }
    function next() {
      const pool = items.filter((i) => i !== ask);
      ask = pool[Math.floor(Math.random() * pool.length)];
      askedAt = performance.now(); last = null;
      if (style === 'name') {
        flash = ask;
        const same = items.filter((i) => i !== ask && (map !== 'world' || i.cont === ask.cont));
        opts = shuffle([ask, ...shuffle(same.length >= 3 ? same : items.filter((i) => i !== ask), Math.random).slice(0, 3)], Math.random);
      } else flash = null;
      draw(); cv.redraw();
    }
    function draw() {
      const left = running ? Math.max(0, Math.ceil((endAt - performance.now()) / 1000)) : 0;
      if (!running) return;
      hud.innerHTML = `<div class="gm-bar"><span class="gm-time${left <= 10 ? ' gm-hurry' : ''}">${left}s</span><b>${score}</b><span>combo ×${Math.max(1, combo)}</span></div>
        ${style === 'find' ? `<p class="gm-q">Find: <span class="gm-label" role="button" tabindex="0">${esc(ask.name)}</span></p>` : `<p class="gm-q">What is lit up?</p><div class="gm-opts">${opts.map((o, i) => `<button type="button" class="lab-btn" data-o="${i}">${esc(o.name)}</button>`).join('')}</div>`}`;
      st.set([['Score', String(score)], ['Right', String(right)], ['Wrong', String(wrong)]]);
    }
    function answer(ok, it) {
      if (!running) return;
      if (ok) {
        combo++; right++;
        const fast = Math.max(0, 50 - Math.floor((performance.now() - askedAt) / 60));
        score += (100 + fast) * Math.min(5, combo);
        last = { ok: true, it: map === 'world' ? null : ask, c: map === 'world' ? ask.c : null };
        api.check(0); if (combo >= 5) api.check(1);
        setTimeout(() => running && next(), 250);
      } else {
        combo = 0; wrong++; score = Math.max(0, score - 20);
        last = { ok: false, it: map === 'world' ? null : it, c: map === 'world' && it ? it.c : null };
        tag(msg, it ? `That’s ${it.name}.` : 'Not quite. Try again.', 'bad');
        setTimeout(() => tag(msg, ''), 1200);
      }
      draw(); cv.redraw();
    }
    function start() {
      if (!items.length) return;
      score = 0; combo = 0; right = 0; wrong = 0; running = true; endAt = performance.now() + 60000;
      goBtn.textContent = 'Restart'; tag(msg, '');
      next();
      clearInterval(timer);
      timer = setInterval(() => {
        if (performance.now() >= endAt) { stop(true); return; }
        const t = hud.querySelector('.gm-time'); if (t) { const s = Math.ceil((endAt - performance.now()) / 1000); t.textContent = s + 's'; t.classList.toggle('gm-hurry', s <= 10); }
      }, 250);
    }
    function stop(finished) {
      clearInterval(timer);
      if (!running) return;
      running = false; flash = null; goBtn.textContent = 'Play again (60 s)';
      if (finished) {
        const b = api.best(score, `${score} points (${map})`);
        hud.innerHTML = `<p class="gm-q">Time! <b>${score} points</b> · ${right} right, ${wrong} wrong${b && b.isNew ? ' · new best!' : ''}</p>`;
        if (score >= 1500) api.check(2);
      }
      cv.redraw();
    }
    cv.c.addEventListener('click', (e) => {
      if (!running || style !== 'find' || !ask) return;
      const p = at(cv.c, e), it = partAt(p.x, p.y);
      const ok = it && it.name === ask.name || (map === 'world' && !it && nearCountry(p.x, p.y, ask)) || (map === 'world' && it && it.c === ask.c);
      answer(!!ok, ok ? ask : it);
    });
    hud.addEventListener('click', (e) => { const o = e.target.closest('[data-o]'); if (o && running) { const it = opts[+o.dataset.o]; answer(it === ask, it); } });
    // drag the name onto the spot
    let dragEl = null;
    hud.addEventListener('pointerdown', (e) => {
      const lab = e.target.closest('.gm-label'); if (!lab || !running) return;
      e.preventDefault();
      dragEl = lab.cloneNode(true); dragEl.classList.add('gm-dragging'); document.body.appendChild(dragEl);
      const move = (ev) => { dragEl.style.transform = `translate(${ev.clientX - 20}px, ${ev.clientY - 18}px)`; };
      move(e);
      const up = (ev) => {
        window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
        if (dragEl) dragEl.remove(); dragEl = null;
        const r = cv.c.getBoundingClientRect();
        if (ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom) return;
        const x = ev.clientX - r.left, y = ev.clientY - r.top, it = partAt(x, y);
        const ok = (it && it.name === ask.name) || (map === 'world' && ((it && it.c === ask.c) || (!it && nearCountry(x, y, ask))));
        answer(!!ok, ok ? ask : it);
      };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    });
    prepare();
    return { state: () => `Pinning Blitz on ${map === 'world' ? 'the world map' : DIAGRAMS[map].name} (${style === 'find' ? 'find it' : 'name it'}): score ${score}, ${right} right, ${wrong} wrong${ask ? `; now looking for ${ask.name}` : ''}`, destroy: () => { clearInterval(timer); if (dragEl) dragEl.remove(); cv.destroy(); } };
  },
  tries: ['Pin one right', 'Get a combo of 5', 'Score 1500 points in one round'],
  hints: ['Tap Start, then tap where the name is, or drag the name onto it.', 'Start with the ones you know; speed matters less than not breaking the combo.', 'Learn the map first: Name it mode is a good warm-up.'],
};

/* ================= 4. Fraction Diner (fractions and ratios) ================= */
const gcd2 = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) [a, b] = [b, a % b]; return a || 1; };
const frac = (n, d) => { const g = gcd2(n, d); return `${n / g}/${d / g}`; };
// "1 1/2", "3/4", "1.5", "2" → a number (or NaN)
export function readAmount(t) {
  const s = String(t || '').trim().replace(/[½¼¾⅓⅔]/g, (c) => ({ '½': ' 1/2', '¼': ' 1/4', '¾': ' 3/4', '⅓': ' 1/3', '⅔': ' 2/3' }[c])).trim();
  let m = s.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/); if (m && +m[3]) return +m[1] + +m[2] / +m[3];
  m = s.match(/^(\d+)\s*\/\s*(\d+)$/); if (m && +m[2]) return +m[1] / +m[2];
  m = s.match(/^\d+(\.\d+)?$|^\.\d+$/); if (m) return +s;
  return NaN;
}
const showAmt = (v) => { const w = Math.floor(v + 1e-9), r = v - w; if (r < 1e-9) return String(w); for (const d of [2, 3, 4, 8]) { const n = Math.round(r * d); if (Math.abs(n / d - r) < 1e-9) { const f = frac(n, d); return w ? `${w} ${f}` : f; } } return String(+v.toFixed(2)); };
const CUSTOMERS = ['Lola Nena', 'Kuya Ben', 'Ate Joy', 'Mang Tonyo', 'Bea', 'Coach Ramon', 'Tita Lorna', 'Jun-jun', 'Ms. Reyes', 'Paolo'];
const RECIPES = [
  ['Chicken adobo', 4, [['chicken (kg)', 1], ['soy sauce (cups)', 1 / 2], ['vinegar (cups)', 1 / 3], ['garlic (heads)', 1], ['bay leaves', 4]]],
  ['Pancit', 4, [['noodles (packs)', 1 / 2], ['cabbage (heads)', 1 / 4], ['carrots', 2], ['soy sauce (tbsp)', 3]]],
  ['Leche flan', 6, [['egg yolks', 12], ['condensed milk (cans)', 1], ['evaporated milk (cans)', 1], ['sugar (cups)', 3 / 4]]],
  ['Champorado', 4, [['malagkit rice (cups)', 1], ['cocoa tablets', 4], ['sugar (cups)', 1 / 2], ['water (cups)', 6]]],
  ['Turon', 8, [['bananas (saba)', 4], ['jackfruit strips (cups)', 1 / 2], ['spring roll wrappers', 8], ['brown sugar (cups)', 1 / 2]]],
];
const dinerLab = {
  id: 'diner', name: 'Fraction Diner', subject: 'games', levels: ['elem'],
  blurb: 'Run a carinderia: slice pizzas into the right fractions, mix drinks in the right ratio and scale recipes for the crowd, before your customers lose patience.',
  words: 'fractions ratios proportion pizza slices equivalent fractions mixing ratio recipe scaling math game restaurant carinderia',
  icon: '<circle cx="18" cy="26" r="13"/><path d="M18 26V13M18 26l11 6"/><path d="M34 12h9l-2 28h-5z"/><path d="M34.5 22h8"/>',
  about: 'Pizza orders ask for a fraction of a pizza: cut it into slices (+ and −), tap slices to pick them, and serve. Any equal fraction counts: 2/4 is the same as 1/2. Drink orders give a total and a ratio (like 1 part syrup to 3 parts water): pour each part with the sliders. Recipe orders give a recipe for some people: type how much you need for the new number (1 1/2, 3/4 and 1.5 all work). Faster service earns bigger tips; a wrong order costs a heart. A shift is 8 orders.',
  mount({ stage, panel, api }) {
    let order = null, served = 0, hearts = 3, coins = 0, slices = 4, picked = new Set(), syrup = 0, water = 0, level = 1, tLeft = 0, tMax = 0, tick = 0, over = false;
    const card = el('div', 'gm-order'); stage.appendChild(card);
    const msg = el('p', 'gm-msg'); msg.hidden = true;
    const st = stats(panel);
    panel.appendChild(msg);
    const startBtn = button(row(panel), 'Start a shift', () => startShift(), 'main');
    function startShift() { served = 0; hearts = 3; coins = 0; level = 1; over = false; startBtn.textContent = 'Start over'; nextOrder(); }
    function nextOrder() {
      if (hearts <= 0 || served >= 8) { endShift(); return; }
      const who = CUSTOMERS[Math.floor(Math.random() * CUSTOMERS.length)], kind = ['pizza', 'drink', 'recipe'][served % 3 === 2 ? 2 : Math.floor(Math.random() * 2)];
      if (kind === 'pizza') {
        const d = [2, 3, 4, 6, 8, 12][Math.floor(Math.random() * (level > 2 ? 6 : 4))], n = 1 + Math.floor(Math.random() * (d - 1));
        order = { kind, who, n, d, text: `${who}: “I’d like ${frac(n, d)} of a pizza, please.”` };
        slices = 4; picked = new Set();
      } else if (kind === 'drink') {
        const a = 1 + Math.floor(Math.random() * 2), b = a + 1 + Math.floor(Math.random() * 3), unit = 25 * (1 + Math.floor(Math.random() * 3)), total = (a + b) * unit * (a + b > 6 ? 1 : 2);
        order = { kind, who, a, b, total, text: `${who}: “${total} mL of calamansi juice: ${a} part${a > 1 ? 's' : ''} syrup to ${b} parts water.”` };
        syrup = 0; water = 0;
      } else {
        const R = RECIPES[Math.floor(Math.random() * RECIPES.length)], to = [R[1] / 2, R[1] * 3 / 2, R[1] * 2, R[1] * 3 / 4].filter((x) => Number.isInteger(x) && x !== R[1])[Math.floor(Math.random() * 3)] || R[1] * 2;
        order = { kind, who, R, to, text: `${who}: “${R[0]} for ${to} people, please!” (the recipe serves ${R[1]})` };
      }
      tMax = tLeft = order.kind === 'recipe' ? 75 : 45 - Math.min(20, level * 3);
      clearInterval(tick); tick = setInterval(() => { tLeft = Math.max(0, tLeft - 0.25); const b = card.querySelector('.gm-patience i'); if (b) b.style.width = (tLeft / tMax) * 100 + '%'; if (tLeft <= 0) miss('They got tired of waiting and left.'); }, 250);
      draw(); cv.redraw();
    }
    function draw() {
      st.set([['Served', `${served}/8`], ['Hearts', '❤'.repeat(hearts) || '-'], ['Tips', '₱' + coins]]);
      if (!order) { card.innerHTML = '<p class="gm-q">Welcome to the Fraction Diner! Tap “Start a shift”.</p>'; return; }
      if (over) return;
      const o = order;
      card.innerHTML = `<p class="gm-q">${esc(o.text)}</p><div class="gm-patience"><i style="width:${(tLeft / tMax) * 100}%"></i></div>
        ${o.kind === 'pizza' ? `<div class="gm-ctl"><span>Slices:</span><button type="button" class="lab-btn" data-sl="-1" aria-label="Fewer slices">−</button><b>${slices}</b><button type="button" class="lab-btn" data-sl="1" aria-label="More slices">+</button><span>Picked: <b>${picked.size}/${slices}</b></span><button type="button" class="lab-btn main" data-serve>Serve</button></div>`
          : o.kind === 'drink' ? `<div class="gm-ctl gm-pour"><label>Syrup <input type="range" min="0" max="${o.total}" step="25" value="${syrup}" data-p="syrup"> <b>${syrup} mL</b></label><label>Water <input type="range" min="0" max="${o.total}" step="25" value="${water}" data-p="water"> <b>${water} mL</b></label><span>Total: <b>${syrup + water} mL</b></span><button type="button" class="lab-btn main" data-serve>Serve</button></div>`
            : `<table class="gm-table gm-recipe"><tr><th>Ingredient</th><th>For ${o.R[1]}</th><th>For ${o.to}</th></tr>${o.R[2].map(([name, q], i) => `<tr><td>${esc(name)}</td><td>${showAmt(q)}</td><td><input data-i="${i}" inputmode="decimal" aria-label="${esc(name)} for ${o.to}" placeholder="?"></td></tr>`).join('')}</table><button type="button" class="lab-btn main" data-serve>Serve</button>`}`;
    }
    const cv = canvas(stage, (ctx, w, h) => {
      if (!order || over || order.kind === 'recipe') return;
      const top = 150, cx = w / 2, cy = top + (h - top) / 2, R = Math.max(30, Math.min(w * 0.4, (h - top) * 0.42));
      if (order.kind === 'pizza') {
        for (let k = 0; k < slices; k++) {
          const a0 = -Math.PI / 2 + (k / slices) * Math.PI * 2, a1 = a0 + Math.PI * 2 / slices, on = picked.has(k), mid = (a0 + a1) / 2, off = on ? R * 0.06 : 0;
          const x = cx + Math.cos(mid) * off, y = cy + Math.sin(mid) * off;
          ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y, R, a0, a1); ctx.closePath();
          ctx.fillStyle = on ? '#f2b84b' : '#d9a24a'; ctx.fill(); ctx.strokeStyle = '#7a4a1e'; ctx.lineWidth = 3; ctx.stroke();
          ctx.beginPath(); ctx.arc(x, y, R * 0.86, a0 + 0.02, a1 - 0.02); ctx.strokeStyle = on ? '#e8553b' : '#c94a34'; ctx.lineWidth = R * 0.12; ctx.stroke();
          for (let q = 0; q < 2; q++) { const aa = a0 + (a1 - a0) * (0.3 + q * 0.4), rr = R * (0.45 + q * 0.15); dot(ctx, x + Math.cos(aa) * rr, y + Math.sin(aa) * rr, R * 0.06, on ? '#b0302a' : '#8f2a24'); }
          if (on) { ctx.save(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y, R, a0, a1); ctx.closePath(); ctx.stroke(); ctx.restore(); }
        }
        text(ctx, 'Tap slices to pick them', cx, cy + R + 22, DIM, 'center');
      } else {
        // the glass, with tick marks every 100 mL
        const o = order, gw = Math.min(150, w * 0.3), gh = Math.min(h - top - 30, 300), gx = cx - gw / 2, gy = top + 10, full = o.total;
        const hs = (syrup / full) * gh, hw = (water / full) * gh, over2 = syrup + water > full;
        ctx.fillStyle = 'rgba(242,190,60,.95)'; ctx.fillRect(gx, gy + gh - Math.min(gh, hs), gw, Math.min(gh, hs));
        ctx.fillStyle = 'rgba(160,210,255,.55)'; ctx.fillRect(gx, gy + gh - Math.min(gh, hs + hw), gw, Math.max(0, Math.min(gh, hs + hw) - Math.min(gh, hs)));
        ctx.strokeStyle = over2 ? C.red : INK; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(gx, gy + gh); ctx.lineTo(gx + gw, gy + gh); ctx.lineTo(gx + gw, gy); ctx.stroke();
        for (let m = 100; m < full; m += 100) { const y = gy + gh - (m / full) * gh; line(ctx, [[gx, y], [gx + 12, y]], DIM, 1.5); text(ctx, m + ' mL', gx - 6, y + 4, DIM, 'right'); }
        text(ctx, `${full} mL`, gx + gw + 8, gy + 4, DIM, 'left');
        if (over2) text(ctx, 'It overflows!', cx, gy - 8, C.red, 'center');
      }
    });
    cv.c.addEventListener('click', (e) => {
      if (!order || over || order.kind !== 'pizza') return;
      const p = at(cv.c, e), r = cv.c.getBoundingClientRect(), w = r.width, h = r.height, top = 150, cx = w / 2, cy = top + (h - top) / 2, R = Math.max(30, Math.min(w * 0.4, (h - top) * 0.42));
      const dx = p.x - cx, dy = p.y - cy;
      if (Math.hypot(dx, dy) > R * 1.08) return;
      let a = Math.atan2(dy, dx) + Math.PI / 2; if (a < 0) a += Math.PI * 2;
      const k = Math.floor((a / (Math.PI * 2)) * slices) % slices;
      if (picked.has(k)) picked.delete(k); else picked.add(k);
      draw(); cv.redraw();
    });
    card.addEventListener('click', (e) => {
      const sl = e.target.closest('[data-sl]');
      if (sl) { slices = Math.max(1, Math.min(16, slices + +sl.dataset.sl)); picked = new Set([...picked].filter((k) => k < slices)); draw(); cv.redraw(); return; }
      if (e.target.closest('[data-serve]')) serve();
    });
    card.addEventListener('input', (e) => {
      const p = e.target.dataset.p; if (!p) return;
      if (p === 'syrup') syrup = +e.target.value; else water = +e.target.value;
      e.target.parentElement.querySelector('b').textContent = e.target.value + ' mL';
      const tot = card.querySelector('.gm-pour > span b'); if (tot) tot.textContent = (syrup + water) + ' mL';
      cv.redraw();
    });
    function serve() {
      const o = order; if (!o || over) return;
      let ok = false, why = '';
      if (o.kind === 'pizza') { ok = picked.size * o.d === o.n * slices && slices > 0; why = ok ? `${picked.size}/${slices}${picked.size / slices === o.n / o.d && slices !== o.d ? ` = ${frac(o.n, o.d)}` : ''}: exactly right!` : `That’s ${picked.size}/${slices} of a pizza, not ${frac(o.n, o.d)}. Cut it into ${o.d} (or ${o.d * 2}) slices and count.`; if (ok && slices !== o.d) api.check(1); }
      else if (o.kind === 'drink') { const unit = o.total / (o.a + o.b); ok = syrup === o.a * unit && water === o.b * unit; why = ok ? `${syrup} : ${water} = ${o.a} : ${o.b}, and ${o.total} mL in all. Perfect!` : `Each “part” is ${o.total} ÷ ${o.a + o.b} = ${unit} mL: so ${o.a * unit} mL syrup and ${o.b * unit} mL water.`; }
      else {
        const k = o.to / o.R[1], vals = [...card.querySelectorAll('.gm-recipe input')].map((i) => readAmount(i.value));
        ok = vals.every((v, i) => Math.abs(v - o.R[2][i][1] * k) < 1e-6);
        why = ok ? `Everything × ${showAmt(k)}: the recipe is scaled just right.` : `Multiply each amount by ${o.to} ÷ ${o.R[1]} = ${showAmt(k)}. ${o.R[2].map(([n, q]) => `${n}: ${showAmt(q * k)}`).join(', ')}.`;
        if (ok) api.check(2);
      }
      if (ok) { const tip = 20 + Math.round((tLeft / tMax) * 30); coins += tip; served++; level = 1 + Math.floor(served / 3); api.check(0); tag(msg, `${why} +₱${tip} tip.`, 'good'); clearInterval(tick); setTimeout(() => !over && nextOrder(), 1400); draw(); }
      else miss(why);
    }
    function miss(why) {
      clearInterval(tick);
      hearts--; served++; tag(msg, why, 'bad');
      draw();
      setTimeout(() => !over && nextOrder(), 2200);
    }
    function endShift() {
      over = true; clearInterval(tick);
      const b = api.best(coins, `₱${coins} in tips`);
      card.innerHTML = `<p class="gm-q">Shift over! You earned <b>₱${coins}</b> in tips${hearts ? ` with ${hearts} heart${hearts === 1 ? '' : 's'} left` : ''}.${b && b.isNew ? ' New best!' : ''}</p>`;
      order = null; cv.redraw(); st.set([['Served', '8/8'], ['Hearts', '❤'.repeat(Math.max(0, hearts)) || '-'], ['Tips', '₱' + coins]]);
    }
    draw();
    return { state: () => (order ? `serving an order: ${order.text}${order.kind === 'pizza' ? `: I cut ${slices} slices and picked ${picked.size}` : order.kind === 'drink' ? `: I poured ${syrup} mL syrup and ${water} mL water` : ''}` : `Fraction Diner: ₱${coins} in tips`), destroy: () => { clearInterval(tick); cv.destroy(); } };
  },
  tries: ['Serve an order right', 'Serve a fraction using an equal fraction (like 2/4 for 1/2)', 'Scale a recipe correctly'],
  hints: ['Read the order, then cut, pour or type, and tap Serve.', 'Cut the pizza into twice as many slices and pick twice as many.', 'New amount = old amount × (new people ÷ old people).'],
};

/* ================= 5. City Market (supply, demand, taxes, a budget) ================= */
// a simple straight-line market for rice, in thousands of kilos a day
const EVENTS = [
  ['Calm month', 'Nothing unusual happens.', 0, 0],
  ['Typhoon!', 'A typhoon floods farms: farmers can supply 30% less.', 0, -0.3],
  ['Good harvest', 'Great weather: farmers can supply 25% more.', 0, 0.25],
  ['Fiesta season', 'Fiestas everywhere: people want 20% more rice.', 0.2, 0],
  ['Fuel prices up', 'Trucking costs more: supply falls 10%.', 0, -0.1],
  ['New factory jobs', 'More people earn more: demand rises 10%.', 0.1, 0],
  ['Calm month', 'Nothing unusual happens.', 0, 0],
];
const demandAt = (p, dShock) => Math.max(0, 200 * (1 + dShock) - 2 * p); // buyers want less as the price rises
const supplyAt = (p, sShock) => Math.max(0, 2 * p * (1 + sShock)); // farmers sell more as the price rises
const marketLab = {
  id: 'economy', name: 'City Market', subject: 'games', levels: ['hs', 'college', 'grad'],
  blurb: 'Run your city’s rice market for a year: set the price, the sales tax and public spending. Avoid shortages and surpluses, keep people happy and the budget healthy through typhoons and fiestas.',
  words: 'economics supply demand equilibrium price ceiling tax budget shortage surplus market simulation government city money',
  icon: '<path d="M6 42V6M6 42h36"/><path d="M10 10c10 6 18 18 28 28" stroke-dasharray="3 3"/><path d="M10 38c10-6 18-18 28-28"/><circle cx="24" cy="24" r="3"/>',
  about: 'Demand: buyers want 200 − 2 × (price they pay) thousand kg a day. Supply: farmers offer 2 × (price they get) thousand kg. Where the lines cross is the market (equilibrium) price, ₱50 in a calm month with no tax. If you set the price lower, buyers want more than farmers sell: a shortage (long lines, anger). Higher, and rice piles up unsold: a surplus (farmers lose money). A sales tax adds to what buyers pay, so they buy less, but it pays for public services, which make people happier. Events shift the lines. The numbers are made simple to show the idea, not to forecast real prices.',
  mount({ stage, panel, api }) {
    let month = 0, happy = 70, budget = 20, price = 50, tax = 5, spend = 4, ev = EVENTS[0], hist = [], over = false, outcome = null;
    const head = el('div', 'gm-market'); stage.appendChild(head);
    const msg = el('p', 'gm-msg'); msg.hidden = true;
    const g = group(panel, 'This month’s decisions');
    const sP = slider(g, { label: 'Price of rice (₱ per kg)', min: 20, max: 90, step: 1, value: price, fmt: (v) => '₱' + v, onInput: (v) => { price = v; preview(); } });
    const sT = slider(g, { label: 'Sales tax', min: 0, max: 30, step: 1, value: tax, fmt: (v) => v + '%', onInput: (v) => { tax = v; preview(); } });
    const sS = slider(g, { label: 'Spending on public services (₱ millions)', min: 0, max: 15, step: 1, value: spend, fmt: (v) => '₱' + v + 'M', onInput: (v) => { spend = v; preview(); } });
    const st = stats(panel);
    panel.appendChild(msg);
    const r = row(panel);
    const goBtn = button(r, 'Run the month ›', () => runMonth(), 'main');
    button(r, 'New year', () => reset());
    // what would happen this month with these choices
    function outcomeFor() {
      const pb = price * (1 + tax / 100), qd = demandAt(pb, ev[2]), qs = supplyAt(price, ev[3]), q = Math.min(qd, qs);
      const shortage = qd > qs ? (qd - qs) / Math.max(1, qd) : 0, surplus = qs > qd ? (qs - qd) / Math.max(1, qs) : 0;
      const revenue = ((tax / 100) * price * q) / 100; // ₱ millions a month (simplified)
      const dHappy = spend * 0.9 - 2.5 - shortage * 40 - surplus * 25 - Math.max(0, pb - 55) * 0.5;
      // the price where supply meets demand for the price farmers get, with this tax
      const eq = (200 * (1 + ev[2])) / (2 * (1 + tax / 100) + 2 * (1 + ev[3]));
      return { pb, qd, qs, q, shortage, surplus, revenue, dHappy, eq, dBudget: revenue - spend - 3 };
    }
    function preview() { outcome = outcomeFor(); draw(); cv.redraw(); }
    function runMonth() {
      if (over) return;
      const o = outcomeFor();
      happy = Math.max(0, Math.min(100, happy + o.dHappy)); budget += o.dBudget;
      hist.push({ m: month + 1, ev: ev[0], price, tax, spend, ...o, happy, budget });
      month++;
      api.check(0);
      if (o.shortage < 0.03 && o.surplus < 0.03) api.check(1);
      const lesson = o.shortage > 0.05 ? `Shortage: buyers wanted ${Math.round(o.qd)}k kg but farmers sold only ${Math.round(o.qs)}k: the price was below the market price (about ₱${Math.round(o.eq)}).`
        : o.surplus > 0.05 ? `Surplus: farmers brought ${Math.round(o.qs)}k kg but buyers took only ${Math.round(o.qd)}k: the price was above the market price (about ₱${Math.round(o.eq)}).`
          : `Balanced: supply and demand met at about ${Math.round(o.q)}k kg a day.`;
      if (happy < 20 || budget < -20) { over = true; tag(msg, `${lesson} ${happy < 20 ? 'The people protest: happiness fell too low.' : 'The city ran out of money.'} Game over after ${month} months.`, 'bad'); goBtn.disabled = true; }
      else if (month >= 12) {
        over = true; goBtn.disabled = true;
        const score = Math.round(happy * 10 + budget * 5);
        const b = api.best(score, `${score} points (a full year)`);
        if (happy >= 60 && budget >= 0) api.check(2);
        tag(msg, `${lesson} A whole year! Happiness ${Math.round(happy)}, budget ₱${budget.toFixed(1)}M: score ${score}.${b && b.isNew ? ' New best!' : ''}`, 'good');
      } else {
        ev = EVENTS[Math.floor(Math.random() * EVENTS.length)];
        tag(msg, `${lesson} Next month: ${ev[0]} ${ev[1]}`, o.shortage > 0.05 || o.surplus > 0.05 ? '' : 'good');
      }
      preview();
    }
    function reset() { month = 0; happy = 70; budget = 20; price = 50; tax = 5; spend = 4; ev = EVENTS[0]; hist = []; over = false; goBtn.disabled = false; sP.set(price); sT.set(tax); sS.set(spend); tag(msg, ''); preview(); }
    function draw() {
      const o = outcome;
      head.innerHTML = `<div class="gm-bar"><span>Month ${Math.min(12, month + 1)} of 12</span><span>${esc(ev[0])}</span><span>😊 ${Math.round(happy)}</span><span>₱${budget.toFixed(1)}M</span></div>
        <p class="gm-small">${esc(ev[1])} This month: buyers pay ₱${o.pb.toFixed(1)}/kg · ${o.shortage > 0.03 ? `<b class="gm-badtext">shortage ${Math.round(o.shortage * 100)}%</b>` : o.surplus > 0.03 ? `<b class="gm-badtext">surplus ${Math.round(o.surplus * 100)}%</b>` : '<b class="gm-goodtext">balanced</b>'} · tax brings ₱${o.revenue.toFixed(1)}M</p>`;
      st.set([['Happiness', String(Math.round(happy))], ['Budget', '₱' + budget.toFixed(1) + 'M'], ['Market price', '≈ ₱' + Math.round(o.eq)], ['Sold', Math.round(o.q) + 'k kg/day']]);
    }
    const cv = canvas(stage, (ctx, w, h) => {
      const o = outcome; if (!o) return;
      const L = 56, T = 96, R = 20, B = 44, W = w - L - R, H = h - T - B, X = (q) => L + (q / 220) * W, Y = (p) => T + H - (p / 100) * H;
      line(ctx, [[L, T], [L, T + H], [L + W, T + H]], DIM, 1.5);
      text(ctx, 'Price (₱/kg)', L - 6, T - 8, DIM, 'left');
      text(ctx, 'Rice (thousand kg a day)', L + W, T + H + 30, DIM, 'right');
      for (let p = 0; p <= 100; p += 20) { text(ctx, String(p), L - 8, Y(p) + 4, DIM, 'right'); line(ctx, [[L, Y(p)], [L + W, Y(p)]], 'rgba(242,242,244,.06)', 1); }
      for (let q = 0; q <= 200; q += 50) text(ctx, String(q), X(q), T + H + 16, DIM, 'center');
      // demand (what buyers want at each price they pay) and supply (what farmers offer)
      const dPts = [], dTax = [], sPts = [];
      for (let p = 0; p <= 100; p += 2) { dPts.push([X(demandAt(p, ev[2])), Y(p)]); dTax.push([X(demandAt(p * (1 + tax / 100), ev[2])), Y(p)]); sPts.push([X(supplyAt(p, ev[3])), Y(p)]); }
      line(ctx, dPts.filter((p) => p[0] >= L), C.blue, 2.5); line(ctx, sPts.filter((p) => p[0] <= L + W), C.green, 2.5);
      if (tax) { ctx.setLineDash([5, 5]); line(ctx, dTax.filter((p) => p[0] >= L), 'rgba(127,178,255,.6)', 2); ctx.setLineDash([]); }
      text(ctx, 'Demand', X(demandAt(88, ev[2])) + 6, Y(88), C.blue); text(ctx, 'Supply', Math.min(X(supplyAt(90, ev[3])), L + W - 50) , Y(90) - 6, C.green);
      // the market price, and your price
      const eq = o.eq, qe = supplyAt(eq, ev[3]);
      ctx.setLineDash([3, 4]); line(ctx, [[L, Y(eq)], [X(qe), Y(eq)], [X(qe), T + H]], 'rgba(255,207,90,.6)', 1.2); ctx.setLineDash([]);
      dot(ctx, X(qe), Y(eq), 5, C.gold); text(ctx, `market ≈ ₱${Math.round(eq)}`, L + 6, Y(eq) + (price >= eq ? 16 : -6), C.gold);
      line(ctx, [[L, Y(price)], [L + W, Y(price)]], INK, 2);
      text(ctx, `your price ₱${price}`, L + W - 4, Y(price) - 6, INK, 'right');
      // the gap: shortage (red) or surplus (blue)
      const xd = X(o.qd), xs = X(o.qs);
      if (Math.abs(xd - xs) > 2) { ctx.fillStyle = o.qd > o.qs ? 'rgba(255,122,122,.35)' : 'rgba(127,178,255,.3)'; ctx.fillRect(Math.min(xd, xs), Y(price) - 7, Math.abs(xd - xs), 14); text(ctx, o.qd > o.qs ? 'shortage' : 'surplus', Math.max(xd, xs) + 8, Y(price) + (price >= eq ? -10 : 18), o.qd > o.qs ? C.red : C.blue, 'left'); }
    });
    preview();
    return { state: () => `month ${month + 1} of 12 (${ev[0]}); price ₱${price}/kg, tax ${tax}%, spending ₱${spend}M; market price about ₱${Math.round(outcome.eq)}; ${outcome.shortage > 0.03 ? 'shortage' : outcome.surplus > 0.03 ? 'surplus' : 'balanced'}; happiness ${Math.round(happy)}, budget ₱${budget.toFixed(1)}M`, destroy: () => cv.destroy() };
  },
  tries: ['Run your first month', 'Have a month with no shortage or surplus', 'Finish the year with happiness 60+ and a budget of ₱0 or more'],
  hints: ['Set the three sliders, then tap “Run the month”.', 'Move your price to where the lines cross, the gold “market” point.', 'A small tax pays for services; too much makes buyers pay more and buy less.'],
};

export const GAMES = [circuitLab, crackerLab, blitzLab, dinerLab, marketLab];

/* Math labs: a function grapher with slopes and areas, fractions you can see, chance,
   a unit converter, simple vs compound interest, a picture proof of (a + b)², and the
   Tower of Hanoi. */
import { INK, DIM, FAINT, GRID, C, el, esc, num, canvas, drag, clock, group, slider, seg, button, row, stats, stepper, line, dot, text, niceStep, formula, integrate, gcd } from './kit.js';

/* ---------------- Function lab ---------------- */
const fnLab = {
  id: 'function', name: 'Function lab', subject: 'math', topic: 'functions, derivatives (slopes) and integrals (areas)',
  blurb: 'Type any function. Slide along it to see the slope, the bend and the area under it.',
  words: 'graph graphing derivative tangent slope integral area calculus curve',
  icon: '<path d="M6 40h36M10 44V6"/><path d="M12 36c6-2 8-22 14-22s8 14 14 12"/><path d="M20 30l16-10" stroke-dasharray="3 3"/><circle cx="28" cy="25" r="2.5"/>',
  tries: ['Find a flat spot: slide until the slope is 0', 'Make the area from a to b exactly 0 (try sin(x) from −π to π)', 'Find an inflection point — where f″ (the bend) is 0'],
  hints: ['Drag along the curve and watch the slope number. Flat spots are at the tops of hills and bottoms of valleys.', 'Turn on “Area ∫”. Area below the x-axis counts as negative, so equal parts above and below cancel out.', 'Turn on “Bend f″”. An inflection point is where the curve changes from bending up (like a cup) to bending down (like a cap). Try x^3 − 3x.'],
  about: 'The slope is worked out as (f(x+h) − f(x−h)) ÷ 2h with a tiny h, and the bend (second derivative, concavity) in the same way — for smooth functions this matches the exact derivative to many decimal places.\nAreas use Simpson’s rule with 600 slices. Area below the x-axis counts as negative — that is what a definite integral means.\nWhere a function jumps or is undefined (like 1/x at 0, or sqrt(x) for x < 0) the graph leaves a gap and no area is given.\nlog means log base 10; ln is the natural log.',
  mount({ stage, panel, api }) {
    let src = 'sin(x) + x/3', f = formula(src), err = '';
    const view = { cx: 0, cy: 0, s: 50 };
    let px = 1, a = -Math.PI, b = Math.PI;
    const show = { f: true, d1: true, d2: false, area: false };
    const H = (x) => 1e-4 * Math.max(1, Math.abs(x));
    const d1 = (x) => (f(x + H(x)) - f(x - H(x))) / (2 * H(x));
    const d2 = (x) => { const h = 10 * H(x); return (f(x + h) - 2 * f(x) + f(x - h)) / (h * h); };
    const area = () => integrate(f, a, b);
    let W = 1, Hh = 1;
    const X = (x) => W / 2 + (x - view.cx) * view.s, Y = (y) => Hh / 2 - (y - view.cy) * view.s;
    const wx = (sx) => view.cx + (sx - W / 2) / view.s;

    function curve(ctx, g, color, dash) {
      ctx.setLineDash(dash || []);
      ctx.strokeStyle = color; ctx.lineWidth = 2.2; ctx.beginPath();
      let pen = false, lastY = 0;
      for (let sx = 0; sx <= W; sx += 1.5) {
        const y = g(wx(sx)), sy = Y(y);
        if (!Number.isFinite(y) || Math.abs(sy) > 1e5 || (pen && Math.abs(sy - lastY) > Hh * 1.5)) { pen = false; continue; }
        if (pen) ctx.lineTo(sx, sy); else ctx.moveTo(sx, sy);
        pen = true; lastY = sy;
      }
      ctx.stroke(); ctx.setLineDash([]);
    }
    const cv = canvas(stage, (ctx, w, h) => {
      W = w; Hh = h;
      // grid and axes
      const step = niceStep(w / view.s, w < 500 ? 6 : 10);
      ctx.lineWidth = 1;
      for (let gx = Math.ceil(wx(0) / step) * step; X(gx) < w; gx += step) {
        ctx.strokeStyle = Math.abs(gx) < step / 2 ? FAINT : GRID; ctx.beginPath(); ctx.moveTo(X(gx), 0); ctx.lineTo(X(gx), h); ctx.stroke();
        if (Math.abs(gx) > step / 2) text(ctx, num(gx), X(gx) + 3, Math.min(h - 4, Math.max(12, Y(0) + 14)), DIM);
      }
      const y0 = view.cy - h / 2 / view.s;
      for (let gy = Math.ceil(y0 / step) * step; Y(gy) > 0; gy += step) {
        ctx.strokeStyle = Math.abs(gy) < step / 2 ? FAINT : GRID; ctx.beginPath(); ctx.moveTo(0, Y(gy)); ctx.lineTo(w, Y(gy)); ctx.stroke();
        if (Math.abs(gy) > step / 2) text(ctx, num(gy), Math.min(w - 30, Math.max(4, X(0) + 4)), Y(gy) - 3, DIM);
      }
      if (err) { text(ctx, err, w / 2, h / 2, C.red, 'center'); return; }
      // the area under the curve between a and b
      if (show.area) {
        ctx.fillStyle = 'rgba(127,178,255,.22)';
        ctx.beginPath(); ctx.moveTo(X(a), Y(0));
        for (let i = 0; i <= 200; i++) { const x = a + ((b - a) * i) / 200, y = f(x); if (Number.isFinite(y)) ctx.lineTo(X(x), Y(Math.max(-1e4, Math.min(1e4, y)))); }
        ctx.lineTo(X(b), Y(0)); ctx.closePath(); ctx.fill();
        for (const [v, name] of [[a, 'a'], [b, 'b']]) { line(ctx, [[X(v), 0], [X(v), h]], 'rgba(127,178,255,.6)', 1); dot(ctx, X(v), Y(0), 6, C.blue); text(ctx, name, X(v), Y(0) + 20, C.blue, 'center'); }
      }
      if (show.d2) curve(ctx, d2, C.red, [6, 5]);
      if (show.d1) curve(ctx, d1, C.blue, [2, 4]);
      if (show.f) curve(ctx, f, C.gold);
      // the point and its tangent (the slope, drawn)
      const y = f(px), m = d1(px);
      if (Number.isFinite(y)) {
        if (Number.isFinite(m)) {
          const span = (w / 3.2) / view.s / Math.sqrt(1 + m * m);
          line(ctx, [[X(px - span), Y(y - m * span)], [X(px + span), Y(y + m * span)]], INK, 1.5);
        }
        line(ctx, [[X(px), Y(0)], [X(px), Y(y)]], FAINT, 1);
        dot(ctx, X(px), Y(y), 9, 'rgba(255,207,90,.25)');
        dot(ctx, X(px), Y(y), 5.5, INK);
        text(ctx, `slope ${num(m)}`, X(px) + 12, Y(y) - 12, INK);
      }
    });
    const report = () => {
      if (err) { st.set([['f(x)', 'can’t read it']]); cv.redraw(); return; }
      const y = f(px), m = d1(px), k = d2(px), A = area();
      st.set([['x', num(px)], ['f(x)', num(y)], ['slope f′(x)', num(m)], ['bend f″(x)', num(k)], ...(show.area ? [['area a→b', num(A)]] : [])]);
      if (Number.isFinite(m) && Math.abs(m) < 0.02) api.check(0);
      if (show.area && b - a > 0.5 && Math.abs(A) < 0.005) api.check(1);
      if (show.d2 && Math.abs(k) < 0.02 && (Math.abs(d2(px + 0.5)) > 0.05 || Math.abs(d2(px - 0.5)) > 0.05)) api.check(2);
      cv.redraw();
    };
    // drag: move the point (or a / b when the area is on)
    let grabbing = 'p';
    drag(cv.c, {
      down(p) {
        grabbing = 'p';
        if (show.area) for (const [v, k] of [[a, 'a'], [b, 'b']]) if (Math.hypot(p.x - X(v), p.y - Y(0)) < 22) grabbing = k;
        move(p);
      },
      move,
    });
    function move(p) {
      const x = Math.round(wx(p.x) * 100) / 100;
      if (grabbing === 'a') { a = Math.min(x, b); aS.set(a); }
      else if (grabbing === 'b') { b = Math.max(x, a); bS.set(b); }
      else px = x;
      report();
    }
    cv.c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const k = Math.exp(-e.deltaY * 0.0015), p = { x: e.offsetX, y: e.offsetY };
      const wx0 = wx(p.x), wy0 = view.cy + (Hh / 2 - p.y) / view.s;
      view.s = Math.max(4, Math.min(2000, view.s * k));
      view.cx = wx0 - (p.x - W / 2) / view.s; view.cy = wy0 - (Hh / 2 - p.y) / view.s;
      cv.redraw();
    }, { passive: false });

    // the formula
    const g1 = group(panel, 'f(x) =');
    const input = el('input', 'lab-input');
    input.type = 'text'; input.value = src; input.spellcheck = false; input.autocomplete = 'off';
    input.setAttribute('aria-label', 'f of x equals');
    const errEl = el('p', 'lab-err'); errEl.hidden = true;
    g1.append(input, errEl);
    const ex = row(g1, 'lab-chips');
    ['x^2 - 4', 'x^3 - 3x', 'sin(x)', 'e^(-x^2)', '1/x', 'sqrt(x)'].forEach((t) => button(ex, t, () => { input.value = t; read(); }, 'chip'));
    function read() {
      src = input.value;
      try { f = formula(src); err = ''; errEl.hidden = true; }
      catch (e) { err = e.message; errEl.textContent = e.message; errEl.hidden = false; }
      report();
    }
    input.addEventListener('input', read);
    const g2 = group(panel, 'Show');
    const tg = row(g2, 'lab-toggles');
    [['f', 'f(x)', C.gold], ['d1', 'Slope f′', C.blue], ['d2', 'Bend f″ (concavity)', C.red], ['area', 'Area ∫', C.blue]].forEach(([k, label, color]) => {
      const b2 = button(tg, '', () => { show[k] = !show[k]; b2.setAttribute('aria-pressed', String(show[k])); areaBox.hidden = !show.area; report(); }, 'toggle');
      b2.innerHTML = `<span class="lab-key" style="background:${color}"></span>${esc(label)}`;
      b2.setAttribute('aria-pressed', String(show[k]));
    });
    const areaBox = el('div'); areaBox.hidden = true; g2.appendChild(areaBox);
    const aS = slider(areaBox, { label: 'a (from)', min: -10, max: 10, step: 0.05, value: a, onInput: (v) => { a = Math.min(v, b); report(); } });
    const bS = slider(areaBox, { label: 'b (to)', min: -10, max: 10, step: 0.05, value: b, onInput: (v) => { b = Math.max(v, a); report(); } });
    const zr = row(group(panel, 'Zoom'), 'lab-row-btns');
    button(zr, '−', () => { view.s /= 1.5; cv.redraw(); });
    button(zr, '+', () => { view.s *= 1.5; cv.redraw(); });
    button(zr, 'Centre on the point', () => { view.cx = px; view.cy = Number.isFinite(f(px)) ? f(px) : 0; cv.redraw(); });
    const st = stats(panel);
    report();
    return {
      state: () => `f(x) = ${src}; the point is at x = ${num(px)}, where f(x) = ${num(f(px))}, the slope f′(x) = ${num(d1(px))} and the bend f″(x) = ${num(d2(px))}${show.area ? `; the area under the curve from a = ${num(a)} to b = ${num(b)} is ${num(area())}` : ''}`,
      destroy: () => cv.destroy(),
    };
  },
};

/* ---------------- Fractions ---------------- */
const fracLab = {
  id: 'fractions', name: 'Fraction pies', subject: 'math', topic: 'fractions: equivalent fractions, comparing, adding and subtracting',
  blurb: 'Two fractions as pies, bars and a number line. Compare them, add them, take one away.',
  words: 'fraction numerator denominator equivalent pie',
  icon: '<circle cx="18" cy="24" r="12"/><path d="M18 24V12M18 24l10 6"/><path d="M34 14h8M34 24h8M34 34h8"/><path d="M38 10v8M38 30v8" />',
  tries: ['Find two different fractions that are equal (like 1/2 and 2/4)', 'Add two fractions to make exactly 1 whole', 'Make a fraction bigger than 1 (an improper fraction)'],
  hints: ['Make B’s top and bottom both twice A’s (or three times). The pies will cover exactly the same amount.', 'Choose “Add A + B”. Try 1/2 + 1/2 first, then something like 1/3 + 2/3.', 'Make the top number bigger than the bottom number. Tip: tap the slices of a pie to fill them.'],
  about: 'A fraction is the top number divided by the bottom number.\nTo compare, add or subtract, both fractions are rewritten over the lowest common denominator (the least common multiple of the two bottoms).\nAnswers are simplified by dividing the top and bottom by their greatest common factor, and shown as a mixed number when they are bigger than 1.\nTap a slice of a pie to fill the pie up to that slice.',
  mount({ stage, panel, api }) {
    let p = [3, 4], q = [2, 6], op = 'compare';
    const pieAt = []; // where the pies are drawn, to tap them
    const lcm = (x, y) => (x * y) / gcd(x, y);
    const result = () => {
      if (op === 'compare') return null;
      const L = lcm(p[1], q[1]), n = p[0] * (L / p[1]) + (op === 'add' ? 1 : -1) * q[0] * (L / q[1]);
      return [n, L];
    };
    const simp = ([n, d]) => { const g = gcd(n, d); return [n / g, d / g]; };
    const fr = ([n, d]) => `${n}/${d}`;
    const mixed = ([n, d]) => { const s = simp([n, d]); if (Math.abs(s[0]) < s[1] || s[1] === 1) return s[1] === 1 ? String(s[0]) : fr(s); const w = Math.trunc(s[0] / s[1]); return `${w} ${Math.abs(s[0] % s[1])}/${s[1]}`; };
    function pies(ctx, [n, d], x, y, r, color, label, which) {
      const whole = Math.max(1, Math.ceil(n / d)) + (n > 0 && n < 3 * d && n % d === 0 ? 1 : 0); // an empty pie to tap into next
      for (let k = 0; k < Math.min(3, whole); k++) {
        const cx = x + k * (r * 2 + 10), filled = Math.max(0, Math.min(d, n - k * d));
        pieAt.push({ which, k, cx, cy: y, r, d });
        for (let i = 0; i < d; i++) {
          ctx.beginPath(); ctx.moveTo(cx, y);
          ctx.arc(cx, y, r, -Math.PI / 2 + (i / d) * Math.PI * 2, -Math.PI / 2 + ((i + 1) / d) * Math.PI * 2);
          ctx.closePath();
          ctx.fillStyle = i < filled ? color : 'rgba(255,255,255,.04)'; ctx.fill();
          ctx.strokeStyle = 'rgba(16,17,22,.9)'; ctx.lineWidth = 2; ctx.stroke();
        }
        ctx.strokeStyle = FAINT; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx, y, r, 0, Math.PI * 2); ctx.stroke();
      }
      text(ctx, label, x - r, y - r - 10, INK);
    }
    function bar(ctx, [n, d], x, y, w, h, color) {
      const whole = Math.max(1, Math.ceil(n / d));
      for (let k = 0; k < whole; k++) for (let i = 0; i < d; i++) {
        const filled = k * d + i < n;
        ctx.fillStyle = filled ? color : 'rgba(255,255,255,.04)';
        ctx.fillRect(x + (k * d + i) * (w / d) + 1, y, w / d - 2, h);
      }
    }
    const cv = canvas(stage, (ctx, w, h) => {
      const r = Math.min(52, w / 14, h / 9);
      pieAt.length = 0;
      pies(ctx, p, 24 + r, 30 + r, r, C.gold, `A = ${fr(p)}`, 0);
      pies(ctx, q, w / 2 + 12 + r, 30 + r, r, C.blue, `B = ${fr(q)}`, 1);
      // bars on the same scale, one whole = unit wide
      const top = 60 + r * 2, unit = Math.min((w - 48) / 3, 260), bh = Math.max(16, h * 0.05);
      text(ctx, 'A', 12, top + bh * 0.75, DIM); bar(ctx, p, 28, top, unit, bh, C.gold);
      text(ctx, 'B', 12, top + bh * 2.2, DIM); bar(ctx, q, 28, top + bh * 1.5, unit, bh, C.blue);
      const res = result();
      if (res && res[0] >= 0) { text(ctx, op === 'add' ? 'A+B' : 'A−B', 2, top + bh * 3.7, DIM); bar(ctx, simp(res), 28, top + bh * 3, unit, bh, C.green); }
      // the number line, 0 to 3
      const ly = Math.min(h - 40, top + bh * 5 + 20);
      line(ctx, [[28, ly], [28 + unit * 3, ly]], DIM, 1.5);
      for (let k = 0; k <= 3; k++) { line(ctx, [[28 + unit * k, ly - 8], [28 + unit * k, ly + 8]], INK, 1.5); text(ctx, String(k), 28 + unit * k, ly + 24, INK, 'center'); }
      const mark = (v, color, lab, up) => { if (v < 0 || v > 3) return; const x = 28 + unit * v; dot(ctx, x, ly, 6, color); text(ctx, lab, x, up ? ly - 14 : ly + 40, color, 'center'); };
      mark(p[0] / p[1], C.gold, 'A', true);
      mark(q[0] / q[1], C.blue, 'B', false);
      if (res) mark(res[0] / res[1], C.green, op === 'add' ? 'A+B' : 'A−B', true);
    });
    function report() {
      const res = result(), A = p[0] / p[1], B = q[0] / q[1];
      const L = lcm(p[1], q[1]);
      const list = [['A', `${fr(p)} = ${fr(simp(p))} = ${num(A)}`], ['B', `${fr(q)} = ${fr(simp(q))} = ${num(B)}`]];
      if (op === 'compare') list.push(['Compare', `${fr(p)} ${Math.abs(A - B) < 1e-12 ? '=' : A > B ? '>' : '<'} ${fr(q)}`], ['Same bottom', `${p[0] * (L / p[1])}/${L} and ${q[0] * (L / q[1])}/${L}`]);
      else list.push(['Same bottom', `${p[0] * (L / p[1])}/${L} ${op === 'add' ? '+' : '−'} ${q[0] * (L / q[1])}/${L}`], [op === 'add' ? 'A + B' : 'A − B', `${fr(res)} = ${mixed(res)} = ${num(res[0] / res[1])}`]);
      st.set(list);
      if (p[0] > 0 && p[0] * q[1] === p[1] * q[0] && (p[0] !== q[0] || p[1] !== q[1])) api.check(0);
      if (op === 'add' && res[0] === res[1]) api.check(1);
      if (p[0] > p[1] || q[0] > q[1]) api.check(2);
      cv.redraw();
    }
    seg(group(panel, 'Do'), { options: [['compare', 'Compare'], ['add', 'Add A + B'], ['subtract', 'A − B']], value: op, onChange: (v) => { op = v; report(); } });
    const mk = (title, fracArr) => {
      const g = group(panel, title);
      const top = stepper(g, { label: 'Top (numerator)', min: 0, max: fracArr[1] * 3, value: fracArr[0], onChange: (v) => { fracArr[0] = v; report(); } });
      stepper(g, { label: 'Bottom (denominator)', min: 1, max: 12, value: fracArr[1], onChange: (v) => {
        fracArr[1] = v;
        top.setMax(v * 3); // up to three wholes
        fracArr[0] = top.value;
        report();
      } });
      return top;
    };
    const tops = [mk('Fraction A', p), mk('Fraction B', q)];
    // tap a slice: the pie fills up to it (tap the last filled slice again to empty it)
    cv.c.addEventListener('click', (e) => {
      const r0 = cv.c.getBoundingClientRect(), x = e.clientX - r0.left, y = e.clientY - r0.top;
      const hit = pieAt.find((pp) => Math.hypot(x - pp.cx, y - pp.cy) <= pp.r);
      if (!hit) return;
      const frac = hit.which ? q : p;
      let ang = Math.atan2(y - hit.cy, x - hit.cx) + Math.PI / 2; if (ang < 0) ang += Math.PI * 2;
      const slice = Math.min(hit.d - 1, Math.floor((ang / (Math.PI * 2)) * hit.d)), n = hit.k * hit.d + slice + 1;
      frac[0] = Math.min(frac[1] * 3, frac[0] === n ? n - 1 : n);
      tops[hit.which].set(frac[0]);
      report();
    });
    const st = stats(panel);
    report();
    return {
      state: () => { const res = result(); return `fraction A is ${fr(p)} and fraction B is ${fr(q)}; I'm ${op === 'compare' ? 'comparing them' : op === 'add' ? `adding them, which gives ${fr(res)} = ${mixed(res)}` : `taking B away from A, which gives ${fr(res)} = ${mixed(res)}`}`; },
      destroy: () => cv.destroy(),
    };
  },
};

/* ---------------- Chance ---------------- */
const MODES = {
  coin: { name: 'Coin', out: ['Heads', 'Tails'], p: [1 / 2, 1 / 2], roll: () => (Math.random() < 0.5 ? 0 : 1) },
  die: { name: 'Die', out: ['1', '2', '3', '4', '5', '6'], p: Array(6).fill(1 / 6), roll: () => Math.floor(Math.random() * 6) },
  two: { name: 'Two dice', out: ['2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'], p: [1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1].map((k) => k / 36), roll: () => Math.floor(Math.random() * 6) + Math.floor(Math.random() * 6) },
  spin: { name: 'Spinner', out: ['Gold', 'Blue', 'Red'], p: [1 / 2, 1 / 3, 1 / 6], roll: () => { const r = Math.random(); return r < 1 / 2 ? 0 : r < 5 / 6 ? 1 : 2; } },
};
const chanceLab = {
  id: 'chance', name: 'Chance machine', subject: 'math', topic: 'probability: theory versus experiment, and the law of large numbers',
  blurb: 'Flip, roll and spin thousands of times and watch real results creep toward the theory.',
  words: 'probability coin dice spinner random statistics experiment',
  icon: '<rect x="6" y="14" width="20" height="20" rx="4"/><circle cx="12" cy="20" r="1.6"/><circle cx="20" cy="28" r="1.6"/><circle cx="16" cy="24" r="1.6"/><circle cx="35" cy="24" r="9"/><path d="M35 15v18M31 19l4-4 4 4"/>',
  tries: ['Flip 5 heads in a row', 'Roll two dice 1,000 times — which total comes up most?', 'After 500 flips, get heads within 2% of half'],
  hints: ['Use the Coin and flip one at a time (tap the coin or “× 1”). Any run of 5 heads has a 1 in 32 chance, so keep going.', 'Pick “Two dice” and tap “× 1,000”. Count how many ways each total can be made: 7 can be made 6 ways (1+6, 2+5, 3+4, 4+3, 5+2, 6+1).', 'Choose Coin and flip at least 500 times. If you are not within 2% yet, flip more — big numbers of flips tend to land closer to half.'],
  about: 'Every flip, roll and spin uses the browser’s random-number generator, so each outcome has exactly the theoretical probability shown. (Real coins and dice are very slightly imperfect; these are ideal ones.)\nThe dashed lines are the theoretical probabilities; the bars are what actually happened. The law of large numbers says the bars tend to get closer to the lines as the number of trials grows — but any single run can still wander.',
  mount({ stage, panel, api }) {
    let mode = 'coin', counts = [], n = 0, last = null, streak = 0, spin = 0;
    let shown = { counts: [], n: 0 }; // what the bars show (they catch up when the coin lands)
    const reset = () => { counts = MODES[mode].out.map(() => 0); n = 0; last = null; streak = 0; shown = { counts: counts.slice(), n: 0 }; };
    reset();
    const COLORS = { spin: [C.gold, C.blue, C.red] };
    function pips(ctx, x, y, s, v) {
      ctx.fillStyle = '#f6f3ea'; ctx.beginPath(); ctx.roundRect(x, y, s, s, s * 0.18); ctx.fill();
      const P = { 1: [[1, 1]], 2: [[0, 0], [2, 2]], 3: [[0, 0], [1, 1], [2, 2]], 4: [[0, 0], [2, 0], [0, 2], [2, 2]], 5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]], 6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]] }[v];
      P.forEach(([i, j]) => dot(ctx, x + s * (0.25 + i * 0.25), y + s * (0.25 + j * 0.25), s * 0.08, '#16171c'));
    }
    // the coin flips through the air, the dice tumble and the spinner spins before the result shows
    let anim = null; // { t0, dur, from (spinner angle) }
    const ease = (x) => 1 - (1 - x) ** 3;
    const ticker = clock(() => { cv.redraw(); if (anim && performance.now() - anim.t0 > anim.dur) { anim = null; report(); return false; } });
    function coinFace(ctx, cx, cy, r, ry, heads) {
      ctx.save(); ctx.translate(cx, cy); ctx.scale(1, Math.max(0.06, ry));
      dot(ctx, 0, 0, r, heads ? C.gold : '#c9c4b8');
      ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, r * 0.82, 0, Math.PI * 2); ctx.stroke();
      if (ry > 0.35) text(ctx, heads ? 'H' : 'T', 0, 1, '#16171c', 'center', 'middle');
      ctx.restore();
    }
    const cv = canvas(stage, (ctx, w, h) => {
      const M = MODES[mode], top = Math.min(170, h * 0.36), sc = shown.counts, sn = shown.n;
      // the thing itself
      const cx = w / 2, cy = top / 2 + 10, s = Math.min(80, top * 0.55);
      const a = anim ? Math.min(1, (performance.now() - anim.t0) / anim.dur) : 1, flying = a < 1;
      if (mode === 'coin') {
        // up, turning over and over, and down again; it lands on its result
        const turns = anim ? anim.turns : 0, th = ease(a) * turns * Math.PI, lift = flying ? Math.sin(Math.PI * a) * top * 0.32 : 0;
        const ry = Math.cos(th), heads = flying ? ry >= 0 === (last === 0) : last !== 1;
        ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(cx, cy + s * 0.62, s * 0.42 * (1 - lift / top), s * 0.08, 0, 0, Math.PI * 2); ctx.fill();
        coinFace(ctx, cx, cy - lift, s / 2, flying ? Math.abs(ry) : 1, heads);
        if (last == null && !flying) text(ctx, '?', cx, cy + 1, '#16171c', 'center', 'middle');
      } else if (mode === 'die' || mode === 'two') {
        // tumbling: it spins, bounces and shows random faces, then settles on the result
        const faces = mode === 'two' ? (last || [1, 1]) : [last == null ? 1 : last + 1];
        faces.forEach((f, k) => {
          const x0 = mode === 'two' ? (k ? cx + s * 0.6 : cx - s * 0.6) : cx, spinA = flying ? (1 - ease(a)) * (k ? -5 : 6) * Math.PI : 0, hop = flying ? Math.abs(Math.sin(a * Math.PI * 3)) * (1 - a) * top * 0.3 : 0;
          const face = flying && a < 0.85 ? 1 + Math.floor((Math.sin(performance.now() / 47 + k * 3) + 1) * 2.99) : f;
          ctx.save(); ctx.translate(x0, cy - hop); ctx.rotate(spinA); pips(ctx, -s / 2, -s / 2, s, face); ctx.restore();
        });
      } else {
        let ang = -Math.PI / 2;
        M.p.forEach((pp, i) => { ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, s * 0.62, ang, ang + pp * Math.PI * 2); ctx.closePath(); ctx.fillStyle = COLORS.spin[i]; ctx.fill(); ang += pp * Math.PI * 2; });
        const now = flying ? anim.from + (spin + anim.extra - anim.from) * ease(a) : spin, pa = now - Math.PI / 2;
        line(ctx, [[cx, cy], [cx + Math.cos(pa) * s * 0.7, cy + Math.sin(pa) * s * 0.7]], INK, 4); dot(ctx, cx, cy, 6, INK);
      }
      if (flying) { text(ctx, mode === 'coin' ? 'Flipping…' : mode === 'spin' ? 'Spinning…' : 'Rolling…', cx, top + 4, DIM, 'center'); }
      else
      text(ctx, sn ? `${sn.toLocaleString()} ${mode === 'coin' ? 'flips' : mode === 'spin' ? 'spins' : 'rolls'}` : `Tap or flick the ${mode === 'coin' ? 'coin' : mode === 'spin' ? 'spinner' : 'dice'} to start`, cx, top + 4, DIM, 'center');
      // the results, as bars, with the theory as a line
      const left = 36, bottom = h - 34, chartH = bottom - top - 30, k = M.out.length, bw = (w - left - 12) / k;
      const maxP = Math.max(...M.p, ...sc.map((c) => (sn ? c / sn : 0))) * 1.15;
      for (let t = 0; t <= 4; t++) { const v = (maxP * t) / 4, y = bottom - (v / maxP) * chartH; line(ctx, [[left, y], [w - 8, y]], GRID, 1); text(ctx, Math.round(v * 100) + '%', left - 4, y + 4, DIM, 'right'); }
      M.out.forEach((o, i) => {
        const x = left + i * bw, f = sn ? (sc[i] || 0) / sn : 0, bh2 = (f / maxP) * chartH;
        ctx.fillStyle = mode === 'spin' ? COLORS.spin[i] : C.gold;
        ctx.globalAlpha = 0.85; ctx.beginPath(); ctx.roundRect(x + bw * 0.15, bottom - bh2, bw * 0.7, bh2, [4, 4, 0, 0]); ctx.fill(); ctx.globalAlpha = 1;
        const ty = bottom - (M.p[i] / maxP) * chartH;
        ctx.setLineDash([4, 3]); line(ctx, [[x + bw * 0.08, ty], [x + bw * 0.92, ty]], INK, 1.5); ctx.setLineDash([]);
        text(ctx, o, x + bw / 2, bottom + 16, INK, 'center');
      });
      text(ctx, '- - theory', w - 8, top + 22, INK, 'right');
    });
    function once() {
      const M = MODES[mode];
      let r;
      if (mode === 'two') { const a = Math.floor(Math.random() * 6) + 1, b = Math.floor(Math.random() * 6) + 1; last = [a, b]; r = a + b - 2; }
      else { r = M.roll(); last = r; }
      counts[r]++; n++;
      if (mode === 'coin') streak = r === 0 ? streak + 1 : 0;
      if (mode === 'spin') { const before = M.p.slice(0, r).reduce((s2, v) => s2 + v, 0); spin = (before + M.p[r] * (0.2 + Math.random() * 0.6)) * Math.PI * 2; }
    }
    function run(k, power = 1) {
      if (anim) anim = null; // a new go cuts the last one short
      const from = spin;
      for (let i = 0; i < k; i++) once();
      // one at a time: the whole show; many at once: a quick one for the last
      const dur = (k === 1 ? 1100 : 500) * Math.min(1.6, Math.max(0.7, power)) * (matchMedia('(prefers-reduced-motion: reduce)').matches ? 0.2 : 1);
      anim = { t0: performance.now(), dur, from: from % (Math.PI * 2), extra: Math.PI * 2 * Math.round(3 + 3 * power), turns: 2 * Math.round(3 + 3 * power) };
      ticker.start();
      if (mode === 'coin' && streak >= 5) api.check(0);
      if (mode === 'two' && n >= 1000) api.check(1);
      if (mode === 'coin' && n >= 500 && Math.abs(counts[0] / n - 0.5) < 0.02) api.check(2);
    }
    function report() {
      const M = MODES[mode];
      shown = { counts: counts.slice(), n };
      const list = [['Trials', n.toLocaleString()]];
      if (mode === 'coin') list.push(['Heads in a row', String(streak)]);
      M.out.forEach((o, i) => { if (M.out.length <= 6 || counts[i] === Math.max(...counts)) list.push([o, `${n ? num((counts[i] / n) * 100) : 0}% (theory ${num(M.p[i] * 100)}%)`]); });
      st.set(list);
      cv.redraw();
    }
    seg(group(panel, 'Machine'), { options: Object.entries(MODES).map(([k, m]) => [k, m.name]), value: mode, onChange: (v) => { anim = null; ticker.stop(); mode = v; reset(); report(); } });
    const r1 = row(group(panel, 'Go'), 'lab-row-btns');
    button(r1, '× 1', () => run(1), 'main');
    button(r1, '× 10', () => run(10));
    button(r1, '× 100', () => run(100));
    button(r1, '× 1,000', () => run(1000));
    button(r1, 'Start over', () => { anim = null; ticker.stop(); reset(); report(); });
    // tap the coin, die or spinner itself — or flick it: a faster flick spins it longer
    let press = null;
    drag(cv.c, {
      down(p) { if (p.y > Math.min(170, cv.h * 0.36) + 10) return false; press = { ...p, t: performance.now() }; },
      up(p) { if (!press) return; const dist = Math.hypot(p.x - press.x, p.y - press.y), ms = Math.max(30, performance.now() - press.t); press = null; run(1, dist < 8 ? 1 : Math.min(1.6, 0.8 + (dist / ms) * 0.6)); },
    });
    cv.c.style.cursor = 'pointer';
    const st = stats(panel);
    report();
    return {
      state: () => { const M = MODES[mode]; return `${M.name} — ${n} trials so far: ${M.out.map((o, i) => `${o} ${n ? num((counts[i] / n) * 100) : 0}% (theory ${num(M.p[i] * 100)}%)`).join(', ')}`; },
      destroy: () => { ticker.stop(); cv.destroy(); },
    };
  },
};

/* ---------------- Units ---------------- */
const UNITS = {
  Length: { base: 'm', u: { mm: 0.001, cm: 0.01, m: 1, km: 1000, in: 0.0254, ft: 0.3048, yd: 0.9144, mi: 1609.344 } },
  Mass: { base: 'kg', u: { mg: 1e-6, g: 0.001, kg: 1, 't (tonne)': 1000, oz: 0.028349523125, lb: 0.45359237 } },
  Time: { base: 's', u: { ms: 0.001, s: 1, min: 60, h: 3600, day: 86400, week: 604800, year: 31557600 } },
  Temperature: { base: '°C', u: { '°C': 'C', '°F': 'F', K: 'K' } },
  Speed: { base: 'm/s', u: { 'm/s': 1, 'km/h': 1 / 3.6, mph: 0.44704, knot: 1852 / 3600, 'ft/s': 0.3048 } },
  Area: { base: 'm²', u: { 'cm²': 1e-4, 'm²': 1, hectare: 1e4, 'km²': 1e6, 'ft²': 0.09290304, acre: 4046.8564224 } },
  Volume: { base: 'L', u: { mL: 0.001, L: 1, 'm³': 1000, tsp: 0.00492892159, tbsp: 0.0147867648, 'cup (US)': 0.2365882365, 'gallon (US)': 3.785411784 } },
  Data: { base: 'B', u: { bit: 1 / 8, B: 1, kB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12, KiB: 1024, MiB: 1048576, GiB: 1073741824 } },
};
const toC = (v, u) => (u === '°C' ? v : u === '°F' ? ((v - 32) * 5) / 9 : v - 273.15);
const fromC = (c, u) => (u === '°C' ? c : u === '°F' ? (c * 9) / 5 + 32 : c + 273.15);
const unitsLab = {
  id: 'units', name: 'Unit converter', subject: 'math', topic: 'unit conversion and the metric system',
  blurb: 'Length, mass, time, temperature, speed, area, volume and data — with the working shown.',
  words: 'convert conversion metric imperial km miles celsius fahrenheit',
  icon: '<rect x="4" y="16" width="16" height="16" rx="4"/><rect x="28" y="16" width="16" height="16" rx="4"/><path d="M21 24h6M24 21l3 3-3 3"/><path d="M9 24h6M33 24h6"/>',
  tries: ['Find body temperature, 37 °C, in °F', 'How many seconds are in one day?', 'Find how many km/h is 100 mph'],
  hints: ['Kind: Temperature. Amount 37, from °C to °F. The formula is × 9 ÷ 5 + 32.', 'Kind: Time. Amount 1, from day to s. That is 24 × 60 × 60.', 'Kind: Speed. Amount 100, from mph to km/h. One mile is 1.609344 km.'],
  about: 'Factors are the exact international definitions: 1 inch = 2.54 cm, 1 foot = 0.3048 m, 1 mile = 1609.344 m, 1 pound = 0.45359237 kg, 1 nautical mile = 1852 m.\nTemperatures need a formula, not just a factor, because the scales start at different zeros: °F = °C × 9/5 + 32, and K = °C + 273.15.\nA year here is 365.25 days (the average including leap years).\nkB = 1000 bytes, but KiB = 1024 bytes — computers often mix these up. Cups and gallons are US measures (UK ones are bigger).',
  mount({ stage, panel, api }) {
    let cat = 'Length', from = 'km', to = 'mi', value = 1;
    const card = el('div', 'lab-units');
    stage.appendChild(card);
    const conv = (v, a, b) => {
      const U = UNITS[cat].u;
      if (cat === 'Temperature') return fromC(toC(v, a), b);
      return (v * U[a]) / U[b];
    };
    function how() {
      const U = UNITS[cat].u, base = UNITS[cat].base;
      if (cat === 'Temperature') {
        const c = toC(value, from);
        const s1 = from === '°F' ? `(${num(value)} − 32) × 5 ÷ 9 = ${num(c)} °C` : from === 'K' ? `${num(value)} − 273.15 = ${num(c)} °C` : `${num(value)} °C`;
        const s2 = to === '°F' ? `${num(c)} × 9 ÷ 5 + 32 = ${num(fromC(c, to))} °F` : to === 'K' ? `${num(c)} + 273.15 = ${num(fromC(c, to))} K` : `${num(c)} °C`;
        return [s1, s2];
      }
      const inBase = value * U[from];
      return [`${num(value)} ${from} × ${num(U[from], 6)} = ${num(inBase, 6)} ${base}`, `${num(inBase, 6)} ${base} ÷ ${num(U[to], 6)} = ${num(inBase / U[to], 6)} ${to}`];
    }
    function render() {
      const out = conv(value, from, to);
      const U = UNITS[cat].u;
      card.innerHTML = `<p class="lab-units-big"><span>${esc(num(value, 6))} ${esc(from)}</span><span class="eq">=</span><b>${esc(num(out, 6))} ${esc(to)}</b></p>
        <h4>How</h4><ol class="lab-units-how">${how().map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
        <h4>${esc(num(value, 6))} ${esc(from)} in every unit</h4>
        <table class="lab-units-all">${Object.keys(U).map((k) => `<tr${k === to ? ' class="on"' : ''}><td>${esc(num(conv(value, from, k), 6))}</td><td>${esc(k)}</td></tr>`).join('')}</table>`;
      if (cat === 'Temperature' && from === '°C' && to === '°F' && value === 37) api.check(0);
      if (cat === 'Time' && from === 'day' && to === 's' && value === 1) api.check(1);
      if (cat === 'Speed' && from === 'mph' && to === 'km/h' && value === 100) api.check(2);
    }
    const g = group(panel, 'What to convert');
    const catSel = el('select', 'lab-select');
    catSel.setAttribute('aria-label', 'Kind of unit');
    catSel.innerHTML = Object.keys(UNITS).map((k) => `<option>${k}</option>`).join('');
    const inp = el('input', 'lab-input'); inp.type = 'number'; inp.value = String(value); inp.step = 'any'; inp.setAttribute('aria-label', 'Amount');
    const fromSel = el('select', 'lab-select'), toSel = el('select', 'lab-select');
    fromSel.setAttribute('aria-label', 'From'); toSel.setAttribute('aria-label', 'To');
    const fill = () => {
      const keys = Object.keys(UNITS[cat].u);
      fromSel.innerHTML = toSel.innerHTML = keys.map((k) => `<option>${esc(k)}</option>`).join('');
      if (!keys.includes(from)) from = keys[0];
      if (!keys.includes(to)) to = keys[Math.min(2, keys.length - 1)];
      fromSel.value = from; toSel.value = to;
    };
    const lab2 = (t, e) => { const l = el('label', 'lab-field'); l.appendChild(el('span', '', esc(t))); l.appendChild(e); g.appendChild(l); };
    lab2('Kind', catSel); lab2('Amount', inp); lab2('From', fromSel);
    const sw = row(g, 'lab-row-btns');
    button(sw, '⇅ Swap', () => { [from, to] = [to, from]; fromSel.value = from; toSel.value = to; render(); });
    lab2('To', toSel);
    catSel.addEventListener('change', () => { cat = catSel.value; fill(); render(); });
    inp.addEventListener('input', () => { const v = parseFloat(inp.value); value = Number.isFinite(v) ? v : 0; render(); });
    fromSel.addEventListener('change', () => { from = fromSel.value; render(); });
    toSel.addEventListener('change', () => { to = toSel.value; render(); });
    fill(); render();
    return { state: () => `converting ${num(value, 6)} ${from} to ${to} (${cat.toLowerCase()}): it is ${num(conv(value, from, to), 6)} ${to}`, destroy: () => card.remove() };
  },
};

/* ---------------- Interest ---------------- */
const interestLab = {
  id: 'interest', name: 'Money grows', subject: 'math', topic: 'simple interest versus compound interest',
  blurb: 'Same deposit, same rate: simple vs compound interest, year by year.',
  words: 'interest compound simple savings bank money exponential growth',
  icon: '<path d="M6 42h36"/><rect x="9" y="30" width="6" height="12"/><rect x="21" y="22" width="6" height="20"/><rect x="33" y="10" width="6" height="32"/><path d="M8 26l12-8 8 4 12-14"/>',
  tries: ['Find a rate that doubles your money in about 10 years', 'Make compound interest earn at least ₱10,000 more than simple', 'Compare yearly and daily compounding'],
  hints: ['The rule of 72: 72 ÷ rate ≈ years to double. What rate gives 10?', 'Raise the years and the rate — compounding pulls ahead more the longer it runs.', 'Switch “Compound” between Yearly and Daily and watch the compound amount.'],
  about: 'Simple interest pays the rate only on the money you put in. Compound interest also pays interest on the interest already earned, so it grows faster and faster.\nMonthly compounding adds rate ÷ 12 each month; daily adds rate ÷ 365 each day; yearly adds the full rate once a year. Money you add every month goes in at the end of the month.\nReal savings may be rounded, charged fees, or taxed (in the Philippines, bank interest has a 20% final tax), which this leaves out. Tap the chart to read any year.',
  mount({ stage, panel, api }) {
    let P = 10000, rate = 6, years = 20, add = 0, comp = 12;
    const seen = new Set();
    function grow() {
      const simple = [P], compound = [P], putIn = [P];
      let sPrin = P, sInt = 0, c = P, inn = P;
      const monthly = comp === 1 ? null : comp === 12 ? 1 + rate / 100 / 12 : Math.pow(1 + rate / 100 / 365, 365 / 12);
      for (let m = 1; m <= years * 12; m++) {
        sInt += (sPrin * rate) / 100 / 12;
        if (monthly) c *= monthly; else if (m % 12 === 0) c *= 1 + rate / 100;
        sPrin += add; c += add; inn += add;
        if (m % 12 === 0) { simple.push(sPrin + sInt); compound.push(c); putIn.push(inn); }
      }
      return { simple, compound, putIn };
    }
    const money = (v) => '₱' + Math.round(v).toLocaleString();
    const cv = canvas(stage, (ctx, w, h) => {
      const g = grow(), max = Math.max(...g.compound) * 1.08;
      const L = 64, B = h - 30, T = 20, R = w - 14;
      const X = (y) => L + ((R - L) * y) / years, Y = (v) => B - ((B - T) * v) / max;
      const step = niceStep(max, 5);
      for (let v = 0; v <= max; v += step) { line(ctx, [[L, Y(v)], [R, Y(v)]], GRID, 1); text(ctx, v >= 1e6 ? num(v / 1e6) + 'M' : v >= 1e3 ? num(v / 1e3) + 'k' : String(v), L - 6, Y(v) + 4, DIM, 'right'); }
      const ys = niceStep(years, 8);
      for (let y = 0; y <= years; y += ys) text(ctx, String(y), X(y), B + 18, DIM, 'center');
      text(ctx, 'years', R, B + 18, DIM, 'right');
      // the gap between the two: what compounding earns you
      ctx.fillStyle = 'rgba(255,207,90,.14)'; ctx.beginPath();
      g.compound.forEach((v, i) => (i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v))));
      for (let i = years; i >= 0; i--) ctx.lineTo(X(i), Y(g.simple[i]));
      ctx.closePath(); ctx.fill();
      ctx.setLineDash([3, 4]); line(ctx, g.putIn.map((v, i) => [X(i), Y(v)]), DIM, 1.5); ctx.setLineDash([]);
      line(ctx, g.simple.map((v, i) => [X(i), Y(v)]), C.blue, 2.5);
      line(ctx, g.compound.map((v, i) => [X(i), Y(v)]), C.gold, 2.5);
      text(ctx, 'compound', X(years) - 4, Y(g.compound[years]) - 8, C.gold, 'right');
      text(ctx, 'simple', X(years) - 4, Y(g.simple[years]) + 16, C.blue, 'right');
      text(ctx, 'what you put in', L + 6, Y(g.putIn[Math.min(years, 3)]) - 6, DIM);
      chart = { L, R, years };
      // the year you tapped
      if (pick != null && pick <= years) {
        const x = X(pick);
        line(ctx, [[x, T], [x, B]], INK, 1);
        dot(ctx, x, Y(g.compound[pick]), 5, C.gold); dot(ctx, x, Y(g.simple[pick]), 5, C.blue);
        const lines = [`Year ${pick}`, `compound ${money(g.compound[pick])}`, `simple ${money(g.simple[pick])}`], bw = 170, bx = Math.min(x + 10, R - bw);
        ctx.fillStyle = 'rgba(16,17,22,.92)'; ctx.fillRect(bx, T + 4, bw, 58);
        lines.forEach((t, i) => text(ctx, t, bx + 10, T + 22 + i * 17, i ? (i === 1 ? C.gold : C.blue) : INK));
      }
    });
    let chart = null, pick = null;
    const choose = (p) => { if (!chart) return; pick = Math.round(Math.max(0, Math.min(1, (p.x - chart.L) / (chart.R - chart.L))) * chart.years); cv.redraw(); };
    drag(cv.c, { down: choose, move: choose });
    function report() {
      const g = grow(), s = g.simple[years], c = g.compound[years];
      const dbl = Math.log(2) / (comp === 1 ? Math.log(1 + rate / 100) : comp === 12 ? 12 * Math.log(1 + rate / 1200) : 365 * Math.log(1 + rate / 36500));
      st.set([['Simple', money(s)], ['Compound', money(c)], ['Compound earns more by', money(c - s)], ['You put in', money(g.putIn[years])], ['The deposit alone doubles in', `${num(dbl)} years (rule of 72: ${num(72 / rate)})`]]);
      if (Math.abs(dbl - 10) < 0.5) api.check(0);
      if (c - s >= 10000) api.check(1);
      seen.add(comp); if (seen.has(1) && seen.has(365)) api.check(2);
      cv.redraw();
    }
    const g = group(panel, 'Your savings');
    slider(g, { label: 'Deposit', min: 1000, max: 100000, step: 1000, value: P, fmt: money, onInput: (v) => { P = v; report(); } });
    slider(g, { label: 'Interest rate (per year)', min: 0.5, max: 20, step: 0.5, value: rate, fmt: (v) => v + '%', onInput: (v) => { rate = v; report(); } });
    slider(g, { label: 'Years', min: 1, max: 40, step: 1, value: years, onInput: (v) => { years = v; report(); } });
    slider(g, { label: 'Add every month', min: 0, max: 5000, step: 100, value: add, fmt: money, onInput: (v) => { add = v; report(); } });
    seg(group(panel, 'Compound'), { options: [[1, 'Yearly'], [12, 'Monthly'], [365, 'Daily']], value: comp, onChange: (v) => { comp = v; report(); } });
    const st = stats(panel);
    report();
    return {
      state: () => { const gg = grow(); return `deposit ₱${P.toLocaleString()} at ${rate}% a year for ${years} years${add ? `, adding ₱${add.toLocaleString()} a month` : ''}, compounded ${comp === 1 ? 'yearly' : comp === 12 ? 'monthly' : 'daily'}: simple interest ends at ${money(gg.simple[years])}, compound at ${money(gg.compound[years])}`; },
      destroy: () => cv.destroy(),
    };
  },
};

/* ---------------- (a + b)² as a picture ---------------- */
const squareLab = {
  id: 'square-proof', name: 'Picture proofs', subject: 'math', topic: 'algebra identities: (a + b)², a² − b² = (a + b)(a − b)',
  blurb: 'See why (a + b)² = a² + 2ab + b² — pull the square apart and let the areas prove it.',
  words: 'algebra identity square expand factor difference of squares proof',
  icon: '<rect x="6" y="6" width="22" height="22"/><rect x="31" y="6" width="11" height="22"/><rect x="6" y="31" width="22" height="11"/><rect x="31" y="31" width="11" height="11"/>',
  tries: ['Pull (a + b)² all the way apart', 'Make 2ab exactly equal to a² + b²', 'Turn a² − b² into a rectangle'],
  hints: ['Drag the “Together → apart” slider all the way — or drag across the picture from left to right.', 'Try making a and b the same number. (When they differ, 2ab is always smaller than a² + b².)', 'Switch the picture to a² − b², then pull it apart all the way.'],
  about: 'The pictures are drawn to scale: each square’s and rectangle’s area is exactly the number written on it.\n(a + b)² = a² + 2ab + b² is true for every a and b, not just these whole numbers — the picture shows why: the big square is made of exactly those four pieces.\na² − b² = (a + b)(a − b): cutting b² from the corner of a² leaves an L-shape that rearranges into an (a + b) by (a − b) rectangle. This picture needs b smaller than a, so b is kept at most a − 1.\nDrag across the picture to pull it apart.',
  mount({ stage, panel, api }) {
    let mode = 'sum', a = 6, b = 3, t = 0;
    const ease = (x) => x * x * (3 - 2 * x);
    const cv = canvas(stage, (ctx, w, h) => {
      const k = ease(t);
      if (mode === 'sum') {
        const total = a + b, gap = 0.9 * k, s = Math.min((w - 60) / (total + gap * 2), (h - 70) / (total + gap * 2));
        const ox = (w - (total + gap) * s) / 2, oy = (h - (total + gap) * s) / 2 + 6;
        const piece = (x, y, pw, ph, color, label) => {
          ctx.fillStyle = color; ctx.globalAlpha = 0.85; ctx.fillRect(ox + x * s, oy + y * s, pw * s, ph * s); ctx.globalAlpha = 1;
          ctx.strokeStyle = '#101116'; ctx.lineWidth = 2; ctx.strokeRect(ox + x * s, oy + y * s, pw * s, ph * s);
          text(ctx, label, ox + (x + pw / 2) * s, oy + (y + ph / 2) * s, '#101116', 'center', 'middle');
        };
        piece(0, 0, a, a, C.blue, `a² = ${a * a}`);
        piece(a + gap, 0, b, a, C.gold, `ab = ${a * b}`);
        piece(0, a + gap, a, b, C.gold, `ab = ${a * b}`);
        piece(a + gap, a + gap, b, b, C.red, `b² = ${b * b}`);
        text(ctx, `a = ${a}`, ox + (a * s) / 2, oy - 8, INK, 'center');
        text(ctx, `b = ${b}`, ox + (a + gap + b / 2) * s, oy - 8, INK, 'center');
        text(ctx, `a + b = ${a + b}`, ox - 8, oy + ((a + b + gap) * s) / 2, DIM, 'right', 'middle');
      } else {
        // a² with a b² corner cut off; the top strip swings round to make a rectangle
        const bb = Math.min(b, a - 1), s = Math.min((w - 60) / (a + bb + 0.5), (h - 80) / (a + 0.5));
        const ox = (w - (a + bb * k) * s) / 2, base = (h + a * s) / 2;
        const R = (x, y, pw, ph) => [ox + x * s, base - (y + ph) * s, pw * s, ph * s];
        ctx.setLineDash([5, 4]); ctx.strokeStyle = 'rgba(255,122,122,' + (0.8 * (1 - k)) + ')'; ctx.lineWidth = 1.5; ctx.strokeRect(...R(a - bb, a - bb, bb, bb)); ctx.setLineDash([]);
        if (k < 0.5) text(ctx, `− b² = ${bb * bb}`, ox + (a - bb / 2) * s, base - (a - bb / 2) * s, C.red, 'center', 'middle');
        ctx.fillStyle = C.blue; ctx.globalAlpha = 0.85; ctx.fillRect(...R(0, 0, a, a - bb)); ctx.globalAlpha = 1;
        text(ctx, `a × (a − b) = ${a * (a - bb)}`, ox + (a / 2) * s, base - ((a - bb) / 2) * s, '#101116', 'center', 'middle');
        // the moving strip: (a − b) wide, b tall → turned to b wide, (a − b) tall at the right
        const from = { x: (a - bb) / 2, y: a - bb + bb / 2 }, to = { x: a + bb / 2, y: (a - bb) / 2 };
        const cx = from.x + (to.x - from.x) * k, cy = from.y + (to.y - from.y) * k;
        ctx.save(); ctx.translate(ox + cx * s, base - cy * s); ctx.rotate((-Math.PI / 2) * k);
        ctx.fillStyle = C.gold; ctx.globalAlpha = 0.85; ctx.fillRect((-(a - bb) / 2) * s, (-bb / 2) * s, (a - bb) * s, bb * s); ctx.globalAlpha = 1;
        ctx.rotate((Math.PI / 2) * k); text(ctx, `b × (a − b) = ${bb * (a - bb)}`, 0, 0, '#101116', 'center', 'middle'); ctx.restore();
        text(ctx, k > 0.95 ? `(a + b) × (a − b) = ${(a + bb) * (a - bb)}` : `a² − b² = ${a * a - bb * bb}`, w / 2, base + 26, INK, 'center');
      }
    });
    function report() {
      const bb = mode === 'sum' ? b : Math.min(b, a - 1);
      st.set(mode === 'sum'
        ? [['(a + b)²', `${(a + b) ** 2}`], ['a² + 2ab + b²', `${a * a} + ${2 * a * b} + ${b * b} = ${a * a + 2 * a * b + b * b}`], ['Just a² + b² (a common mistake)', `${a * a + b * b} — missing 2ab`]]
        : [['a² − b²', `${a * a} − ${bb * bb} = ${a * a - bb * bb}`], ['(a + b)(a − b)', `${a + bb} × ${a - bb} = ${(a + bb) * (a - bb)}`]]);
      if (mode === 'sum' && t >= 0.99) api.check(0);
      if (mode === 'sum' && a === b) api.check(1);
      if (mode === 'diff' && t >= 0.99) api.check(2);
      cv.redraw();
    }
    seg(group(panel, 'Picture'), { options: [['sum', '(a + b)²'], ['diff', 'a² − b²']], value: mode, onChange: (v) => { mode = v; report(); } });
    const g = group(panel, 'Sizes');
    slider(g, { label: 'a', min: 1, max: 10, value: a, onInput: (v) => { a = v; report(); } });
    slider(g, { label: 'b', min: 1, max: 9, value: b, onInput: (v) => { b = v; report(); } });
    const tS = slider(group(panel, 'Pull it apart'), { label: 'Together → apart', min: 0, max: 1, step: 0.01, value: 0, fmt: (v) => Math.round(v * 100) + '%', onInput: (v) => { t = v; report(); } });
    // drag across the picture to pull it apart (left = together, right = apart)
    drag(cv.c, { down: pull, move: pull });
    function pull(p) { t = Math.round(Math.max(0, Math.min(1, (p.x - cv.w * 0.15) / (cv.w * 0.7))) * 100) / 100; tS.set(t); report(); }
    const st = stats(panel);
    report();
    return {
      state: () => (mode === 'sum' ? `the (a + b)² picture with a = ${a} and b = ${b}: the big square is ${(a + b) ** 2}, made of a² = ${a * a}, two ab rectangles of ${a * b} and b² = ${b * b}` : `the a² − b² picture with a = ${a} and b = ${Math.min(b, a - 1)}, rearranged ${Math.round(t * 100)}% into a (a + b) × (a − b) rectangle`),
      destroy: () => cv.destroy(),
    };
  },
};

/* ---------------- Tower of Hanoi ---------------- */
const hanoiLab = {
  id: 'hanoi', name: 'Tower of Hanoi', subject: 'math', topic: 'the Tower of Hanoi, recursion and powers of 2',
  blurb: 'Move the whole tower to the last peg — one disk at a time, never a big one on a small one.',
  words: 'puzzle recursion hanoi tower disks game',
  icon: '<path d="M4 42h40M12 42V14M24 42V14M36 42V14"/><rect x="5" y="34" width="14" height="5" rx="2"/><rect x="7" y="28" width="10" height="5" rx="2"/><rect x="31" y="34" width="10" height="5" rx="2"/>',
  tries: ['Solve 3 disks in 7 moves', 'Solve 4 disks (the fewest is 15 moves)', 'Watch Cassie solve 6 disks — count the moves'],
  hints: ['Move the smallest disk every other move, always round the pegs in the same direction (with 3 disks: A → C → B → A…).', 'To move 4 disks: move the top 3 to the middle peg, move the biggest to the end, then move the 3 on top of it.', 'Choose 6 disks and tap “Watch Cassie solve it”.'],
  about: 'The fewest moves for n disks is 2ⁿ − 1. The reason is recursion: to move n disks, you must first move the n − 1 on top out of the way, then move the biggest, then move the n − 1 back on top — so each extra disk doubles the moves, plus one.\nCassie’s solution uses exactly that recursion, so it always takes the fewest moves.',
  mount({ stage, panel, api }) {
    let n = 3, pegs, pick = -1, moves = 0, msg = '', demo = null, won = false, byCassie = false;
    const reset = () => { pegs = [Array.from({ length: n }, (_, i) => n - i), [], []]; pick = -1; moves = 0; msg = ''; won = false; byCassie = false; stopDemo(); };
    const hue = (d) => `hsl(${40 + (d / 7) * 200}, 70%, 64%)`;
    const cv = canvas(stage, (ctx, w, h) => {
      const base = h - 40, pw = w / 3, maxW = Math.min(pw - 16, 200), dh = Math.min(26, (h - 120) / 8);
      line(ctx, [[10, base], [w - 10, base]], DIM, 3);
      pegs.forEach((pg, i) => {
        const x = pw * i + pw / 2;
        line(ctx, [[x, base], [x, base - dh * (n + 1.6)]], i === pick ? INK : FAINT, 5);
        pg.forEach((d, j) => {
          if (held && held.from === i && j === pg.length - 1) return; // (it's in your hand)
          const lift = i === pick && j === pg.length - 1 ? dh * 1.4 : 0, dw = 24 + ((maxW - 24) * d) / 7;
          ctx.fillStyle = hue(d); ctx.beginPath(); ctx.roundRect(x - dw / 2, base - (j + 1) * dh - lift, dw, dh - 3, 6); ctx.fill();
        });
        text(ctx, ['A', 'B', 'C'][i], x, base + 22, DIM, 'center');
      });
      // the disk you're dragging
      if (held) { const d = pegs[held.from][pegs[held.from].length - 1], dw = 24 + ((maxW - 24) * d) / 7; ctx.fillStyle = hue(d); ctx.beginPath(); ctx.roundRect(held.x - dw / 2, held.y - dh / 2, dw, dh - 3, 6); ctx.fill(); }
      if (msg) text(ctx, msg, w / 2, 28, won ? C.green : C.red, 'center');
    });
    let held = null; // a disk being dragged: { from, x, y }
    function tryMove(i, j) {
      const from = pegs[i], to = pegs[j];
      if (!from.length || i === j) return false;
      if (to.length && to[to.length - 1] < from[from.length - 1]) { msg = 'A bigger disk can’t sit on a smaller one.'; return false; }
      to.push(from.pop()); moves++; msg = '';
      if (pegs[2].length === n) {
        won = true;
        msg = moves === 2 ** n - 1 ? `Solved in ${moves} moves — the fewest possible!` : `Solved in ${moves} moves (the fewest is ${2 ** n - 1}).`;
        if (!byCassie && n === 3 && moves === 7) api.check(0);
        if (!byCassie && n === 4) api.check(1);
        if (byCassie && n === 6) api.check(2);
      }
      return true;
    }
    // tap a peg, then another — or drag the top disk onto a peg
    const pegAt = (x) => Math.max(0, Math.min(2, Math.floor((x / cv.w) * 3)));
    let downAt = null;
    drag(cv.c, {
      down(p) { if (demo) { stopDemo(); return false; } if (won) return false; downAt = p; const i = pegAt(p.x); if (pick < 0 && pegs[i].length) held = { from: i, x: p.x, y: p.y, moved: false }; },
      move(p) { if (held && Math.hypot(p.x - downAt.x, p.y - downAt.y) > 8) { held.moved = true; held.x = p.x; held.y = p.y; cv.redraw(); } },
      up(p) {
        const i = pegAt(p.x), h = held; held = null;
        if (h && h.moved) { tryMove(h.from, i); pick = -1; report(); return; }
        if (pick < 0) { if (pegs[i].length) pick = i; } else { tryMove(pick, i); pick = -1; }
        report();
      },
    });
    function solveList(k, a, b, c, out) { if (!k) return out; solveList(k - 1, a, c, b, out); out.push([a, c]); solveList(k - 1, b, a, c, out); return out; }
    function stopDemo() { if (demo) { clearInterval(demo); demo = null; } }
    function watch() {
      reset(); byCassie = true;
      const list = solveList(n, 0, 1, 2, []);
      let k = 0;
      demo = setInterval(() => { if (k >= list.length) { stopDemo(); report(); return; } tryMove(...list[k++]); report(); }, n >= 6 ? 90 : 300);
      report();
    }
    const g = group(panel, 'Disks');
    stepper(g, { label: 'How many', min: 3, max: 7, value: n, onChange: (v) => { n = v; reset(); report(); } });
    const r1 = row(g, 'lab-row-btns');
    button(r1, 'Start over', () => { reset(); report(); });
    button(r1, 'Watch Cassie solve it', watch, 'main');
    group(panel).appendChild(el('p', 'lab-note', 'Drag a disk onto another peg — or tap a peg, then tap where its top disk goes.'));
    const st = stats(panel);
    function report() { st.set([['Moves', String(moves)], ['Fewest possible', `${2 ** n - 1} (2^${n} − 1)`]]); cv.redraw(); }
    reset(); report();
    return { state: () => `${n} disks, ${moves} moves so far${won ? ' — solved' : ''}; the fewest possible is ${2 ** n - 1}`, destroy: () => { stopDemo(); cv.destroy(); } };
  },
};

export const MATH = [fnLab, fracLab, chanceLab, unitsLab, interestLab, squareLab, hanoiLab];

/* Cassie's board — she draws the thing she's explaining.
 *
 * When an answer would land better as a picture (a graph, a shape with its
 * area/perimeter, a step-by-step working), Cassie includes a fenced
 * ```cassie-board``` block holding a small JSON spec. app.js pulls that block
 * out of her reply and hands the spec here; we render an interactive board
 * inside the chat bubble, right where she's talking.
 *
 * Everything is drawn in plain <canvas>/<svg> — no libraries, no network — so
 * it works offline and identically on phone, tablet and desktop.
 *
 * The extension keeps an identical copy at extension/board.js — keep the two
 * files the same.
 */
(function () {
  'use strict';

  // ---------- a small, SAFE math evaluator (no eval / no Function) ----------
  // Supports: numbers, x, + - * / ^, unary minus, parentheses, and the
  // functions sin cos tan sqrt abs exp ln log, plus constants pi and e.
  const FUNCS = {
    sin: Math.sin, cos: Math.cos, tan: Math.tan, sqrt: Math.sqrt,
    abs: Math.abs, exp: Math.exp, ln: Math.log, log: (v) => Math.log10(v),
  };
  const CONSTS = { pi: Math.PI, e: Math.E };

  function tokenize(src) {
    // insert explicit * for "5x", "2(", ")(" and "x(" so authors can be loose
    let s = String(src).toLowerCase().replace(/\s+/g, '');
    s = s.replace(/(\d)(x|\()/g, '$1*$2').replace(/(x|\))(\()/g, '$1*$2').replace(/\)(\d|x)/g, ')*$1');
    const out = [];
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (/[0-9.]/.test(c)) {
        let j = i + 1;
        while (j < s.length && /[0-9.]/.test(s[j])) j++;
        out.push({ t: 'num', v: parseFloat(s.slice(i, j)) });
        i = j;
      } else if (/[a-z]/.test(c)) {
        let j = i + 1;
        while (j < s.length && /[a-z0-9]/.test(s[j])) j++;
        const name = s.slice(i, j);
        if (name === 'x') out.push({ t: 'x' });
        else if (CONSTS[name] !== undefined) out.push({ t: 'num', v: CONSTS[name] });
        else if (FUNCS[name]) out.push({ t: 'func', v: name });
        else throw new Error('unknown ' + name);
        i = j;
      } else if ('+-*/^()'.includes(c)) {
        out.push({ t: 'op', v: c });
        i++;
      } else { throw new Error('bad char ' + c); }
    }
    return out;
  }

  const PREC = { '+': 1, '-': 1, '*': 2, '/': 2, '^': 4 };
  function toRPN(tokens) {
    const out = [], ops = [];
    let prev = null;
    for (const tk of tokens) {
      if (tk.t === 'num' || tk.t === 'x') { out.push(tk); }
      else if (tk.t === 'func') { ops.push(tk); }
      else if (tk.t === 'op') {
        if (tk.v === '(') { ops.push(tk); }
        else if (tk.v === ')') {
          while (ops.length && ops[ops.length - 1].v !== '(') out.push(ops.pop());
          ops.pop(); // '('
          if (ops.length && ops[ops.length - 1].t === 'func') out.push(ops.pop());
        } else {
          // unary minus: a '-' at the start or after another operator/'('
          const unary = tk.v === '-' && (!prev || (prev.t === 'op' && prev.v !== ')'));
          if (unary) { out.push({ t: 'num', v: 0 }); }
          const p = PREC[tk.v];
          while (ops.length && ops[ops.length - 1].t === 'op' && ops[ops.length - 1].v !== '('
                 && PREC[ops[ops.length - 1].v] >= p && tk.v !== '^') out.push(ops.pop());
          ops.push(tk);
        }
      }
      prev = tk;
    }
    while (ops.length) out.push(ops.pop());
    return out;
  }

  // compile "x^2 - 5*x + 6" -> function(x) once, evaluate many times
  function compile(expr) {
    const rpn = toRPN(tokenize(expr));
    return function (x) {
      const st = [];
      for (const tk of rpn) {
        if (tk.t === 'num') st.push(tk.v);
        else if (tk.t === 'x') st.push(x);
        else if (tk.t === 'func') st.push(FUNCS[tk.v](st.pop()));
        else {
          const b = st.pop(), a = st.pop();
          st.push(tk.v === '+' ? a + b : tk.v === '-' ? a - b : tk.v === '*' ? a * b
                : tk.v === '/' ? a / b : Math.pow(a, b));
        }
      }
      return st.pop();
    };
  }

  // ---------- helpers ----------
  const NS = 'http://www.w3.org/2000/svg';
  // Optional colour overrides (the extension has no page CSS variables to read).
  let THEME = null;
  let SIZE = 0; // logical drawing width when the host asks for one (extension popup)
  function css(name, fallback) {
    if (THEME && THEME[name]) return THEME[name];
    try { const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); return v || fallback; }
    catch (e) { return fallback; }
  }
  function el(tag, cls) { const e = document.createElement(tag); if (cls) e.className = cls; return e; }
  function svgEl(tag, attrs) { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; }
  function fmt(n) { const r = Math.round(n * 100) / 100; return Object.is(r, -0) ? 0 : r; }
  // light inline math: x^2 -> x², *  -> ·  (keep it readable, not a full engine)
  function pretty(s) {
    return String(s)
      .replace(/\^2/g, '²').replace(/\^3/g, '³')
      .replace(/\^(\d+)/g, (m, d) => d.split('').map((c) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[+c]).join(''))
      .replace(/\*/g, '·').replace(/\bpi\b/gi, 'π').replace(/sqrt/gi, '√');
  }

  // ---------- renderer: step-by-step working ----------
  function renderSteps(board, spec) {
    if (spec.title) { const h = el('p', 'cb-title'); h.textContent = pretty(spec.title); board.appendChild(h); }
    const ol = el('ol', 'cb-steps');
    const items = (spec.steps || []).map((s) => {
      const li = el('li'); li.innerHTML = ''; li.textContent = pretty(s); ol.appendChild(li); return li;
    });
    board.appendChild(ol);
    // reveal one at a time, keeping the newest "active" (Cassie pointing)
    let k = 0;
    function step() {
      items.forEach((li, idx) => {
        li.classList.toggle('show', idx <= k);
        li.classList.toggle('active', idx === k);
        li.classList.toggle('done', idx < k);
      });
      k++;
      if (k < items.length) setTimeout(step, 850);
      else setTimeout(() => items.forEach((li) => li.classList.remove('active')), 900);
    }
    if (items.length) step();
  }

  // ---------- renderer: function graph ----------
  function renderGraph(board, spec) {
    if (spec.title) { const h = el('p', 'cb-title'); h.textContent = pretty(spec.title); board.appendChild(h); }
    const wrap = el('div', 'cb-canvas-wrap');
    // Draw at the size it will be shown (crisp text in a small popup too).
    const LW = SIZE || 640, LH = Math.round(LW * (SIZE ? 0.68 : 380 / 640));
    const dpr = SIZE ? Math.min(3, Math.max(1, window.devicePixelRatio || 1) * 1.5) : 1;
    const canvas = el('canvas'); canvas.width = Math.round(LW * dpr); canvas.height = Math.round(LH * dpr);
    wrap.appendChild(canvas); board.appendChild(wrap);

    let f;
    try { f = compile(spec.fn); } catch (e) { const p = el('p', 'cb-note'); p.textContent = 'y = ' + pretty(spec.fn || ''); board.appendChild(p); return; }
    const [xmin, xmax] = spec.xrange && spec.xrange.length === 2 ? spec.xrange : [-6, 6];

    // sample; auto-fit y unless given
    const pts = [];
    for (let t = xmin; t <= xmax; t += (xmax - xmin) / 400) pts.push([t, f(t)]);
    let ymin, ymax;
    if (spec.yrange && spec.yrange.length === 2) { [ymin, ymax] = spec.yrange; }
    else {
      const ys = pts.map((p) => p[1]).filter((y) => isFinite(y)).sort((a, b) => a - b);
      const lo = ys[Math.floor(ys.length * 0.02)], hi = ys[Math.floor(ys.length * 0.98)];
      ymin = Math.min(lo, 0); ymax = Math.max(hi, 0);
      if (ymax - ymin < 1) { ymax += 1; ymin -= 1; }
      const padY = (ymax - ymin) * 0.12; ymin -= padY; ymax += padY;
    }

    const x = canvas.getContext('2d');
    x.scale(dpr, dpr);
    const W = LW, H = LH, pad = SIZE ? 26 : 34;
    const PX = (v) => pad + (v - xmin) / (xmax - xmin) * (W - 2 * pad);
    const PY = (v) => H - pad - (v - ymin) / (ymax - ymin) * (H - 2 * pad);
    const pink = css('--cb-accent', '#2a2a2d'); // monochrome board ink
    const surface = css('--surface', '#ffffff');
    const grid = css('--border', '#e5e2dc');
    const muted = css('--muted', '#6d6d72');
    const text = css('--text', '#1b1b1d');

    x.fillStyle = surface; x.fillRect(0, 0, W, H);
    x.strokeStyle = grid; x.lineWidth = 1;
    const xStep = niceStep(xmax - xmin), yStep = niceStep(ymax - ymin);
    for (let g = Math.ceil(xmin / xStep) * xStep; g <= xmax; g += xStep) { x.beginPath(); x.moveTo(PX(g), PY(ymin)); x.lineTo(PX(g), PY(ymax)); x.stroke(); }
    for (let g = Math.ceil(ymin / yStep) * yStep; g <= ymax; g += yStep) { x.beginPath(); x.moveTo(PX(xmin), PY(g)); x.lineTo(PX(xmax), PY(g)); x.stroke(); }

    // area-under-curve fill (calculus)
    if (spec.fill && spec.fill.length === 2) {
      const [a, bb] = spec.fill;
      x.fillStyle = 'rgba(128,128,128,.22)'; // neutral area fill (works on light & dark)
      x.beginPath(); x.moveTo(PX(a), PY(0));
      for (let t = a; t <= bb; t += (bb - a) / 120) x.lineTo(PX(t), PY(f(t)));
      x.lineTo(PX(bb), PY(0)); x.closePath(); x.fill();
    }

    // axes
    x.strokeStyle = muted; x.lineWidth = 1.4;
    if (ymin <= 0 && ymax >= 0) { x.beginPath(); x.moveTo(PX(xmin), PY(0)); x.lineTo(PX(xmax), PY(0)); x.stroke(); }
    if (xmin <= 0 && xmax >= 0) { x.beginPath(); x.moveTo(PX(0), PY(ymin)); x.lineTo(PX(0), PY(ymax)); x.stroke(); }
    x.fillStyle = muted; x.font = '11px sans-serif';
    for (let g = Math.ceil(xmin / xStep) * xStep; g <= xmax; g += xStep) { if (Math.abs(g) > 1e-9) x.fillText(fmt(g), PX(g) - 4, PY(0) + 14); }
    const yAxisX = xmin <= 0 && xmax >= 0 ? PX(0) : PX(xmin);
    for (let g = Math.ceil(ymin / yStep) * yStep; g <= ymax; g += yStep) { if (Math.abs(g) > 1e-9) x.fillText(fmt(g), yAxisX + 5, PY(g) + 4); }

    // the curve
    x.strokeStyle = pink; x.lineWidth = 3; x.beginPath();
    let started = false;
    for (const [t, y] of pts) {
      if (!isFinite(y) || PY(y) < -50 || PY(y) > H + 50) { started = false; continue; }
      const px = PX(t), py = PY(y);
      if (!started) { x.moveTo(px, py); started = true; } else x.lineTo(px, py);
    }
    x.stroke();

    // marked points
    (spec.points || []).forEach((pt) => {
      const px = PX(pt.x), py = PY(pt.y);
      x.fillStyle = pink; x.beginPath(); x.arc(px, py, 6, 0, 7); x.fill();
      if (pt.label) {
        // a halo in the paper colour keeps the label readable where the line crosses it
        x.font = 'bold 12px sans-serif'; x.lineJoin = 'round';
        x.strokeStyle = surface; x.lineWidth = 4; x.strokeText(pretty(pt.label), px + 8, py - 8);
        x.fillStyle = text; x.fillText(pretty(pt.label), px + 8, py - 8);
      }
    });
    if (spec.vertex) {
      const px = PX(spec.vertex.x), py = PY(spec.vertex.y);
      x.fillStyle = muted; x.save(); x.translate(px, py); x.rotate(Math.PI / 4); x.fillRect(-5, -5, 10, 10); x.restore();
    }

    if (spec.caption) { const c = el('p', 'cb-note'); c.textContent = pretty(spec.caption); board.appendChild(c); }
  }
  function niceStep(range) {
    const raw = range / 8, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / mag;
    return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
  }

  // ---------- renderer: geometry shape with area & perimeter ----------
  function renderShape(board, spec) {
    const kind = (spec.shape || '').toLowerCase();
    const wrap = el('div', 'cb-geo');
    const svg = svgEl('svg', { viewBox: '0 0 260 180', class: 'cb-geo-svg' });
    const pink = css('--cb-accent', '#2a2a2d');
    let area = null, perim = null, areaFormula = '', perimFormula = '';
    function label(x, y, t) { const e = svgEl('text', { x, y, fill: css('--text', '#ecebf5'), 'font-size': 13, 'font-weight': 700, 'text-anchor': 'middle', 'font-family': 'sans-serif' }); e.textContent = t; svg.appendChild(e); }

    if (kind === 'rectangle' || kind === 'square') {
      const w = spec.w != null ? spec.w : spec.side, h = spec.h != null ? spec.h : spec.side;
      svg.appendChild(svgEl('rect', { x: 45, y: 40, width: 170, height: 100, fill: 'rgba(128,128,128,.14)', stroke: pink, 'stroke-width': 3, rx: 4 }));
      label(130, 32, String(w)); label(228, 95, String(h));
      area = w * h; perim = 2 * (w + h); areaFormula = `${w} × ${h}`; perimFormula = `2(${w} + ${h})`;
    } else if (kind === 'triangle') {
      const b = spec.base, ht = spec.height;
      svg.appendChild(svgEl('polygon', { points: '50,140 210,140 90,45', fill: 'rgba(128,128,128,.14)', stroke: pink, 'stroke-width': 3 }));
      svg.appendChild(svgEl('line', { x1: 90, y1: 45, x2: 90, y2: 140, stroke: pink, 'stroke-dasharray': '4 4', 'stroke-width': 1.5 }));
      label(130, 158, 'base ' + b); label(112, 95, 'h ' + ht);
      area = 0.5 * b * ht; areaFormula = `½ × ${b} × ${ht}`;
      if (spec.sides && spec.sides.length === 3) { perim = spec.sides.reduce((a, c) => a + c, 0); perimFormula = spec.sides.join(' + '); }
    } else if (kind === 'circle') {
      const r = spec.r;
      svg.appendChild(svgEl('circle', { cx: 130, cy: 90, r: 60, fill: 'rgba(128,128,128,.14)', stroke: pink, 'stroke-width': 3 }));
      svg.appendChild(svgEl('line', { x1: 130, y1: 90, x2: 190, y2: 90, stroke: pink, 'stroke-width': 2 }));
      label(160, 82, 'r = ' + r);
      area = Math.PI * r * r; perim = 2 * Math.PI * r; areaFormula = `π × ${r}²`; perimFormula = `2 × π × ${r}`;
    } else { const p = el('p', 'cb-note'); p.textContent = 'Shape'; board.appendChild(p); return; }

    wrap.appendChild(svg);
    const out = el('div', 'cb-geo-out');
    if (spec.title) { const t = el('div', 'cb-geo-name'); t.textContent = pretty(spec.title); out.appendChild(t); }
    if (area != null) { const a = el('div'); a.innerHTML = `Area = ${areaFormula} = <b>${fmt(area)}</b>`; out.appendChild(a); }
    if (perim != null) { const pr = el('div'); pr.innerHTML = `Perimeter = ${perimFormula} = <b>${fmt(perim)}</b>`; out.appendChild(pr); }
    wrap.appendChild(out);
    board.appendChild(wrap);
  }

  // ---------- public: render a spec into a container ----------
  function renderInto(container, spec, opts) {
    THEME = (opts && opts.colors) || null;
    SIZE = (opts && opts.width) || 0;
    const board = el('div', 'cassie-board');
    const head = el('div', 'cb-head');
    head.innerHTML = '<span class="cb-pin">✎</span> Cassie\'s board';
    board.appendChild(head);
    // "Draw on this" — open it on the student's sketch board (app provides onDraw)
    const t = (spec.type || '').toLowerCase();
    if (t === 'graph' || t === 'shape') {
      const draw = el('button', 'cb-draw');
      draw.type = 'button';
      draw.textContent = 'Draw on this';
      draw.addEventListener('click', () => { if (typeof window.CassieBoard.onDraw === 'function') window.CassieBoard.onDraw(board, spec); });
      head.appendChild(draw);
    }
    const body = el('div', 'cb-body');
    board.appendChild(body);
    try {
      const type = (spec.type || '').toLowerCase();
      if (type === 'graph') renderGraph(body, spec);
      else if (type === 'shape') renderShape(body, spec);
      else if (type === 'steps') renderSteps(body, spec);
      else { const p = el('p', 'cb-note'); p.textContent = 'Board'; body.appendChild(p); }
    } catch (e) {
      const p = el('p', 'cb-note'); p.textContent = 'Couldn’t draw this one.'; body.appendChild(p);
    }
    container.appendChild(board);
    THEME = null; SIZE = 0;
    return board;
  }

  // pull ```cassie-board {json}``` blocks out of a reply.
  // returns { clean: textWithoutBoards, boards: [specObj, ...] }
  function extract(text) {
    const boards = [];
    const clean = String(text).replace(/```cassie-board\s*([\s\S]*?)```/g, (m, body) => {
      try { boards.push(JSON.parse(body.trim())); } catch (e) { /* ignore malformed */ }
      return '';
    }).replace(/\n{3,}/g, '\n\n').trim();
    return { clean, boards };
  }

  window.CassieBoard = { renderInto, extract, compile };
})();

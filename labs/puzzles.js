/* Daily puzzles: everyone gets the same puzzle each day (it changes at midnight Philippine
   time). The first finish of the day goes on the score board; "Practice" makes a fresh one
   that doesn't count. Every puzzle is made so it has a fair solution:
   Sudoku has exactly one answer, the Nonogram can be solved by logic alone, Pipes and
   Bridges are built backwards from a real solution, and the Mirrors' laser path exists. */
import { INK, DIM, FAINT, GRID, C, el, esc, num, canvas, drag, at, clock, group, seg, button, row, stats, line, dot, text, dayKey, seedOf, rng, shuffle, fmtTime, overlay } from './kit.js';

/* ---------- shared: the timer, today's puzzle or a practice one ----------
   Today's puzzle (at its standard size) is the one on the score board. "New puzzle" makes a
   fresh one any time, at any size — those are for practice. */
function shell(panel, api, id, onNew, standard = () => true) {
  const box = el('div', 'puz-head');
  panel.appendChild(box);
  let t0 = performance.now(), stopped = false, practice = false, extra = 0;
  const done = api.doneToday();
  const s = {
    get seconds() { return Math.max(0, ((stopped ? s.end : performance.now()) - t0) / 1000 + extra); },
    end: 0,
    get practice() { return practice; },
    seed(k = '') { return seedOf(practice ? 'practice' + Math.random() : dayKey() + id + k); },
    stop() { if (!stopped) { stopped = true; s.end = performance.now(); } },
    restart() { t0 = performance.now(); stopped = false; extra = 0; },
    penalty(sec) { extra += sec; },
    get counts() { return !practice && standard(); },
    render() {
      box.innerHTML = `<p class="puz-day">${practice ? 'Practice puzzle — not on the score board' : standard() ? `Today’s puzzle · ${esc(dayKey())}` : `Today’s puzzle at this size — only the standard size goes on the score board`}</p>
        <p class="puz-time">${fmtTime(s.seconds)}</p>${!practice && done ? `<p class="puz-done">You finished today’s in ${esc(done.shown)} — it’s on the score board. Try a new one too!</p>` : ''}`;
      const btns = el('div', 'puz-btns');
      const nb = el('button', 'lab-btn main', practice ? 'Another new puzzle' : 'New puzzle');
      nb.type = 'button';
      nb.addEventListener('click', () => { practice = true; s.restart(); onNew(); s.render(); });
      btns.appendChild(nb);
      if (practice) {
        const tb = el('button', 'lab-btn', 'Back to today’s puzzle');
        tb.type = 'button';
        tb.addEventListener('click', () => { practice = false; s.restart(); onNew(); s.render(); });
        btns.appendChild(tb);
      }
      box.appendChild(btns);
    },
    // a finished puzzle: today's counts once; practice ones just say well done
    async win(value, shown) {
      s.stop();
      if (practice) return 'Solved! (practice — not on the score board)';
      if (!standard()) return 'Solved! (only the standard size goes on the score board — try it too!)';
      const already = api.doneToday();
      const res = await api.finish(value, shown);
      if (already) return `Solved again! Your first finish today (${already.shown}) is the one on the score board.`;
      if (res && res.error) return `Solved in ${shown}! (The score board didn’t take it: ${res.error})`;
      return res && res.me ? `Solved in ${shown}! You’re #${res.me.rank} today with ${res.me.points} points.` : `Solved in ${shown}!`;
    },
  };
  const tick = setInterval(() => { const p = box.querySelector('.puz-time'); if (p) p.textContent = fmtTime(s.seconds); }, 500);
  s.destroy = () => clearInterval(tick);
  s.render();
  return s;
}
const winNote = (panel) => { const p = el('p', 'puz-win'); p.hidden = true; panel.appendChild(p); return p; };

/* ---------------- Sudoku ---------------- */
// box shape (rows × columns) for each size
const SDK_BOX = { 4: [2, 2], 6: [2, 3], 8: [2, 4], 9: [3, 3], 12: [3, 4] };
const SDK_CLUES = { 4: 6, 6: 13, 8: 24, 9: 30, 12: 62 };
function sudokuMake(n, rand) {
  const [br, bc] = SDK_BOX[n] || [3, 3], N = n * n, full = (1 << n) - 1;
  const box = (r, c) => Math.floor(r / br) * br + Math.floor(c / bc);
  function solve(g, limit) { // counts solutions (up to limit); fills g with the first one when asked
    const rows = Array(n).fill(0), cols = Array(n).fill(0), boxes = Array(n).fill(0);
    for (let i = 0; i < N; i++) if (g[i]) { const b = 1 << (g[i] - 1), r = (i / n) | 0, c = i % n; rows[r] |= b; cols[c] |= b; boxes[box(r, c)] |= b; }
    let count = 0;
    (function rec() {
      let best = -1, bestMask = 0, bestN = 99;
      for (let i = 0; i < N; i++) if (!g[i]) {
        const r = (i / n) | 0, c = i % n, m = full & ~(rows[r] | cols[c] | boxes[box(r, c)]);
        let k = 0; for (let x = m; x; x &= x - 1) k++;
        if (k < bestN) { best = i; bestMask = m; bestN = k; if (k <= 1) break; }
      }
      if (best < 0) { count++; return count >= limit; }
      const r = (best / n) | 0, c = best % n, digits = [];
      for (let d = 0; d < n; d++) if (bestMask & (1 << d)) digits.push(d + 1);
      for (const d of digits) {
        const b = 1 << (d - 1);
        g[best] = d; rows[r] |= b; cols[c] |= b; boxes[box(r, c)] |= b;
        if (rec()) return true;
        g[best] = 0; rows[r] &= ~b; cols[c] &= ~b; boxes[box(r, c)] &= ~b;
      }
      return false;
    })();
    return count;
  }
  // a random complete grid: a valid pattern, then shuffled in every way that keeps it valid
  // (swap digits, rows inside a band, whole bands, columns inside a stack, whole stacks)
  const digits = shuffle([...Array(n)].map((_, k) => k + 1), rand);
  const order = (groups, size) => shuffle([...Array(groups).keys()], rand).flatMap((g) => shuffle([...Array(size).keys()], rand).map((k) => g * size + k));
  const rows = order(n / br, br), cols = order(n / bc, bc);
  const sol = Array(N).fill(0);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) { const R = rows[r], Cc = cols[c]; sol[r * n + c] = digits[(bc * (R % br) + Math.floor(R / br) + Cc) % n]; }
  // take numbers away while the answer stays unique
  const puzzle = sol.slice(), target = SDK_CLUES[n] || 30;
  let clues = N;
  for (const i of shuffle([...Array(N).keys()], rand)) {
    if (clues <= target) break;
    const keep = puzzle[i]; puzzle[i] = 0;
    if (solve(puzzle.slice(), 2) !== 1) puzzle[i] = keep; else clues--;
  }
  return { n, br, bc, sol, puzzle };
}
const sudokuLab = {
  id: 'sudoku', name: 'Sudoku', subject: 'puzzles', blurb: 'Fill the grid so every row, column and box has each number once. A fresh 9×9 every day — or 4×4 up to 12×12, as many as you like.',
  words: 'sudoku logic numbers grid daily puzzle',
  icon: '<rect x="6" y="6" width="36" height="36" rx="3"/><path d="M18 6v36M30 6v36M6 18h36M6 30h36"/><path d="M11 12h2M23 24h2M35 36h2" stroke-width="3"/>',
  about: 'Every daily Sudoku is checked by a solver to have exactly one solution, so it can always be finished by logic, without guessing.\nNumbers that clash with another in the same row, column or box turn red (that tells you about a clash, not whether a number matches the answer).\nSizes: 4×4 (2×2 boxes), 6×6 (2×3), 8×8 (2×4), 9×9 (3×3) and 12×12 (3×4) — each made fresh and checked to have exactly one answer. The score board uses today’s 9×9: your first finish counts.',
  mount({ stage, panel, api }) {
    let size = 9, P = null, grid = [], notes = [], sel = -1, noting = false;
    const S = shell(panel, api, 'sudoku', () => make(), () => size === 9);
    const wrap = el('div', 'puz-sudoku'); stage.appendChild(wrap);
    const board = el('div', 'sdk-grid'), pad = el('div', 'sdk-pad');
    wrap.append(board, pad);
    const msg = winNote(panel);
    function make() {
      P = sudokuMake(size, rng(S.seed(size)));
      grid = P.puzzle.slice(); notes = grid.map(() => new Set()); sel = -1; msg.hidden = true;
      if (!S.practice) S.restart();
      render();
    }
    function clash(i) {
      const n = P.n, v = grid[i]; if (!v) return false;
      const r = (i / n) | 0, c = i % n, r0 = Math.floor(r / P.br) * P.br, c0 = Math.floor(c / P.bc) * P.bc;
      for (let k = 0; k < n; k++) { if (k !== c && grid[r * n + k] === v) return true; if (k !== r && grid[k * n + c] === v) return true; }
      for (let a = 0; a < P.br; a++) for (let b = 0; b < P.bc; b++) { const j = (r0 + a) * n + c0 + b; if (j !== i && grid[j] === v) return true; }
      return false;
    }
    function render() {
      const n = P.n;
      board.style.setProperty('--n', n);
      board.innerHTML = grid.map((v, i) => {
        const r = (i / n) | 0, c = i % n, given = P.puzzle[i] !== 0;
        const same = sel >= 0 && (Math.floor(sel / n) === r || sel % n === c || (Math.floor(Math.floor(sel / n) / P.br) === Math.floor(r / P.br) && Math.floor((sel % n) / P.bc) === Math.floor(c / P.bc)));
        const cls = ['sdk-c', given ? 'given' : '', i === sel ? 'sel' : same ? 'near' : '', v && sel >= 0 && grid[sel] === v ? 'twin' : '', clash(i) && !given ? 'bad' : '', (c + 1) % P.bc === 0 && c < n - 1 ? 'br' : '', (r + 1) % P.br === 0 && r < n - 1 ? 'bb' : ''].join(' ');
        const inner = v ? v : notes[i].size ? `<span class="sdk-notes" style="--n:${P.bc}">${[...Array(n)].map((_, k) => `<i>${notes[i].has(k + 1) ? k + 1 : ''}</i>`).join('')}</span>` : '';
        return `<button type="button" class="${cls}" data-i="${i}" aria-label="Row ${r + 1}, column ${c + 1}${v ? `: ${v}` : ', empty'}">${inner}</button>`;
      }).join('');
      pad.innerHTML = [...Array(n)].map((_, k) => `<button type="button" data-d="${k + 1}">${k + 1}</button>`).join('') + `<button type="button" data-d="0" aria-label="Erase">⌫</button><button type="button" data-note aria-pressed="${noting}">✎ Notes</button>`;
      const done = grid.every((v, i) => v === P.sol[i]);
      if (done && msg.hidden) { msg.hidden = false; msg.textContent = 'Solved!'; S.win(Math.round(S.seconds), fmtTime(S.seconds)).then((t) => { msg.textContent = t; S.render(); }); }
    }
    function put(d) {
      if (sel < 0 || P.puzzle[sel]) return;
      if (noting && d) { notes[sel].has(d) ? notes[sel].delete(d) : notes[sel].add(d); grid[sel] = 0; }
      else { grid[sel] = d; notes[sel].clear(); }
      render();
    }
    board.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) { sel = +b.dataset.i; render(); } });
    pad.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; if (b.hasAttribute('data-note')) { noting = !noting; render(); } else put(+b.dataset.d); });
    const keys = (e) => {
      if (!P || !document.body.contains(wrap)) return;
      if (/^[0-9]$/.test(e.key) && P.n > 9 && pending === 1 && +e.key <= P.n - 10) { put(10 + +e.key); pending = 0; e.preventDefault(); } // 12×12: 1 then 2 makes 12
      else if (/^[1-9]$/.test(e.key) && +e.key <= P.n) { put(+e.key); pending = P.n > 9 && e.key === '1' ? 1 : 0; e.preventDefault(); }
      else if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') { put(0); pending = 0; e.preventDefault(); }
      else if (sel >= 0 && /^Arrow/.test(e.key)) { const n = P.n, r = (sel / n) | 0, c = sel % n; sel = ({ ArrowUp: ((r + n - 1) % n) * n + c, ArrowDown: ((r + 1) % n) * n + c, ArrowLeft: r * n + ((c + n - 1) % n), ArrowRight: r * n + ((c + 1) % n) })[e.key]; render(); e.preventDefault(); }
    };
    document.addEventListener('keydown', keys);
    let pending = 0;
    seg(group(panel, 'Size'), { options: [[4, '4 × 4'], [6, '6 × 6'], [8, '8 × 8'], [9, '9 × 9 (today’s)'], [12, '12 × 12']], value: size, onChange: (v) => { size = +v; make(); S.render(); } });
    make();
    return { state: () => `a ${P.n}×${P.n} Sudoku with ${grid.filter(Boolean).length} of ${P.n * P.n} squares filled`, destroy: () => { S.destroy(); document.removeEventListener('keydown', keys); } };
  },
};

/* ---------------- Nonogram ---------------- */
const cluesOf = (line2) => { const out = []; let run = 0; for (const v of line2) { if (v === 1) run++; else if (run) { out.push(run); run = 0; } } if (run) out.push(run); return out.length ? out : [0]; };
// what logic alone can say about one line: every placement of its blocks that fits what's known
function lineSolve(clue, known) {
  const n = known.length, blocks = clue[0] === 0 ? [] : clue, can1 = Array(n).fill(false), can0 = Array(n).fill(false);
  let any = false;
  const cur = Array(n).fill(0);
  (function place(b, from) {
    if (b === blocks.length) {
      for (let i = from; i < n; i++) if (known[i] === 1) return;
      any = true;
      for (let i = 0; i < n; i++) { if (cur[i] || false) can1[i] = true; else can0[i] = true; }
      return;
    }
    const len = blocks[b];
    for (let s = from; s + len <= n; s++) {
      let ok = true;
      for (let i = from; i < s; i++) if (known[i] === 1) { ok = false; break; }
      if (!ok) break;
      for (let i = s; i < s + len; i++) if (known[i] === 0) { ok = false; break; }
      if (!ok) continue;
      if (s + len < n && known[s + len] === 1) continue;
      for (let i = s; i < s + len; i++) cur[i] = 1;
      place(b + 1, s + len + 1);
      for (let i = s; i < s + len; i++) cur[i] = 0;
    }
  })(0, 0);
  if (!any) return null;
  return known.map((v, i) => (v !== -1 ? v : can1[i] && !can0[i] ? 1 : can0[i] && !can1[i] ? 0 : -1));
}
function logicSolvable(sol, n) {
  const rows = [...Array(n)].map((_, r) => cluesOf(sol.slice(r * n, r * n + n))), cols = [...Array(n)].map((_, c) => cluesOf([...Array(n)].map((__, r) => sol[r * n + c])));
  const g = Array(n * n).fill(-1);
  for (let pass = 0; pass < 60; pass++) {
    let changed = false;
    for (let r = 0; r < n; r++) { const out = lineSolve(rows[r], g.slice(r * n, r * n + n)); if (!out) return false; out.forEach((v, c) => { if (g[r * n + c] !== v) { g[r * n + c] = v; changed = true; } }); }
    for (let c = 0; c < n; c++) { const out = lineSolve(cols[c], [...Array(n)].map((_, r) => g[r * n + c])); if (!out) return false; out.forEach((v, r) => { if (g[r * n + c] !== v) { g[r * n + c] = v; changed = true; } }); }
    if (!changed) break;
  }
  return g.every((v) => v !== -1);
}
const nonogramLab = {
  id: 'nonogram', name: 'Nonogram', subject: 'puzzles', blurb: 'Fill squares to match the number clues on each row and column. 5×5 up to 25×25, a new one any time.',
  words: 'nonogram picross griddler picture logic daily puzzle',
  icon: '<rect x="14" y="14" width="28" height="28" rx="2"/><path d="M14 21h28M14 28h28M14 35h28M21 14v28M28 14v28M35 14v28"/><path d="M6 17h4M6 24h4M17 6v4M24 6v4" />',
  about: 'Each clue lists the runs of filled squares in that row or column, in order: “3 1” means a run of 3, a gap, then a run of 1.\nEvery daily nonogram is checked to be solvable by logic alone — you never need to guess. Any filling that matches all the clues counts as solved.\nMark squares you know are empty with ✕ to help yourself.',
  mount({ stage, panel, api }) {
    let size = 10, sol = [], g = [], rowsC = [], colsC = [], mode = 1, done = false;
    const S = shell(panel, api, 'nonogram', () => make(), () => size === 10);
    const msg = winNote(panel);
    function make() {
      const rand = rng(S.seed(size));
      for (let t = 0; t < 200; t++) { sol = [...Array(size * size)].map(() => (rand() < 0.58 ? 1 : 0)); if (logicSolvable(sol, size)) break; }
      rowsC = [...Array(size)].map((_, r) => cluesOf(sol.slice(r * size, r * size + size)));
      colsC = [...Array(size)].map((_, c) => cluesOf([...Array(size)].map((__, r) => sol[r * size + c])));
      g = Array(size * size).fill(0); done = false; msg.hidden = true;
      if (!S.practice) S.restart();
      cv.redraw();
    }
    let geo = null;
    const cv = canvas(stage, (ctx, w, h) => {
      if (!rowsC.length) return;
      const maxR = Math.max(...rowsC.map((c) => c.length)), maxC = Math.max(...colsC.map((c) => c.length));
      const cell = Math.floor(Math.min((w - 20) / (size + maxR * 0.9), (h - 20) / (size + maxC * 0.9))), ox = Math.round((w - cell * (size + maxR * 0.9)) / 2 + cell * maxR * 0.9), oy = Math.round((h - cell * (size + maxC * 0.9)) / 2 + cell * maxC * 0.9);
      geo = { cell, ox, oy };
      ctx.font = `600 ${Math.max(10, Math.round(cell * 0.42))}px -apple-system, Segoe UI, sans-serif`;
      for (let r = 0; r < size; r++) { const ok = cluesOf(g.slice(r * size, r * size + size).map((v) => (v === 1 ? 1 : 0))).join() === rowsC[r].join(); rowsC[r].slice().reverse().forEach((v, k) => text(ctx, String(v), ox - 8 - k * cell * 0.9, oy + r * cell + cell * 0.62, ok ? DIM : INK, 'right')); }
      for (let c = 0; c < size; c++) { const ok = cluesOf([...Array(size)].map((_, r) => (g[r * size + c] === 1 ? 1 : 0))).join() === colsC[c].join(); colsC[c].slice().reverse().forEach((v, k) => text(ctx, String(v), ox + c * cell + cell / 2, oy - 8 - k * cell * 0.85, ok ? DIM : INK, 'center')); }
      for (let i = 0; i < size * size; i++) {
        const r = (i / size) | 0, c = i % size, x = ox + c * cell, y = oy + r * cell;
        ctx.fillStyle = g[i] === 1 ? (done ? C.gold : '#e8e6df') : 'rgba(255,255,255,.04)'; ctx.fillRect(x + 1, y + 1, cell - 2, cell - 2);
        if (g[i] === 2) { line(ctx, [[x + cell * 0.3, y + cell * 0.3], [x + cell * 0.7, y + cell * 0.7]], DIM, 1.5); line(ctx, [[x + cell * 0.7, y + cell * 0.3], [x + cell * 0.3, y + cell * 0.7]], DIM, 1.5); }
      }
      for (let k = 0; k <= size; k++) { const strong = k % 5 === 0; line(ctx, [[ox + k * cell, oy], [ox + k * cell, oy + size * cell]], strong ? DIM : FAINT, strong ? 1.5 : 1); line(ctx, [[ox, oy + k * cell], [ox + size * cell, oy + k * cell]], strong ? DIM : FAINT, strong ? 1.5 : 1); }
    });
    // tap or drag to paint: the first square decides fill or clear for the whole drag
    let paint = null;
    const cellAt = (p) => { if (!geo) return -1; const c = Math.floor((p.x - geo.ox) / geo.cell), r = Math.floor((p.y - geo.oy) / geo.cell); return r >= 0 && c >= 0 && r < size && c < size ? r * size + c : -1; };
    drag(cv.c, {
      down(p) { const i = cellAt(p); if (i < 0 || done) return false; paint = g[i] === mode ? 0 : mode; g[i] = paint; check(); },
      move(p) { const i = cellAt(p); if (i >= 0 && paint != null && !done) { g[i] = paint; check(); } },
      up() { paint = null; },
    });
    function check() {
      const solved = rowsC.every((cl, r) => cluesOf(g.slice(r * size, r * size + size).map((v) => (v === 1 ? 1 : 0))).join() === cl.join()) && colsC.every((cl, c) => cluesOf([...Array(size)].map((_, r) => (g[r * size + c] === 1 ? 1 : 0))).join() === cl.join());
      if (solved && !done) {
        done = true; msg.hidden = false; msg.textContent = 'Solved!';
        S.win(Math.round(S.seconds), fmtTime(S.seconds)).then((t) => { msg.textContent = t; S.render(); });
      }
      cv.redraw();
    }
    seg(group(panel, 'Tap to'), { options: [[1, '■ Fill'], [2, '✕ Mark empty']], value: mode, onChange: (v) => { mode = +v; } });
    seg(group(panel, 'Size'), { options: [[5, '5 × 5'], [8, '8 × 8'], [10, '10 × 10 (today’s)'], [12, '12 × 12'], [15, '15 × 15'], [20, '20 × 20'], [25, '25 × 25']], value: size, onChange: (v) => { size = +v; make(); S.render(); } });
    button(row(panel, 'lab-row-btns'), 'Clear my squares', () => { g = g.map(() => 0); done = false; msg.hidden = true; cv.redraw(); });
    make();
    return { state: () => `a ${size}×${size} nonogram with ${g.filter((v) => v === 1).length} squares filled so far`, destroy: () => { S.destroy(); cv.destroy(); } };
  },
};

/* ---------------- Bridges (Hashi) ---------------- */
function hashiMake(n, rand, want) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const isl = [], bridges = [], at2 = new Map(), key = (r, c) => r * n + c;
    const occupied = new Set(); // cells a bridge runs through
    const add = (r, c) => { isl.push({ r, c, need: 0 }); at2.set(key(r, c), isl.length - 1); };
    add(Math.floor(rand() * n), Math.floor(rand() * n));
    for (let tries = 0; tries < 400 && isl.length < want; tries++) {
      const a = isl[Math.floor(rand() * isl.length)], [dr, dc] = [[0, 1], [0, -1], [1, 0], [-1, 0]][Math.floor(rand() * 4)], dist = 2 + Math.floor(rand() * 3);
      const r = a.r + dr * dist, c = a.c + dc * dist;
      if (r < 0 || c < 0 || r >= n || c >= n || at2.has(key(r, c)) || occupied.has(key(r, c))) continue;
      // no island right next to another, and the way between must be clear
      if ([[0, 1], [0, -1], [1, 0], [-1, 0]].some(([x, y]) => at2.has(key(r + x, c + y)) && !(r + x === a.r && c + y === a.c))) continue;
      let clear = true; const path = [];
      for (let k = 1; k < dist; k++) { const rr = a.r + dr * k, cc = a.c + dc * k; if (at2.has(key(rr, cc)) || occupied.has(key(rr, cc))) { clear = false; break; } path.push(key(rr, cc)); }
      if (!clear) continue;
      add(r, c);
      const w = rand() < 0.35 ? 2 : 1, b = isl.length - 1;
      bridges.push([at2.get(key(a.r, a.c)), b, w]); path.forEach((k) => occupied.add(k));
      isl[at2.get(key(a.r, a.c))].need += w; isl[b].need += w;
    }
    if (isl.length >= want - 2) return { n, isl, bridges };
  }
  return null;
}
const hashiLab = {
  id: 'hashi', name: 'Bridges', subject: 'puzzles', blurb: 'Join every island into one network: each island’s number says how many bridges touch it. Five sizes, endless puzzles.',
  words: 'hashi hashiwokakero bridges islands logic daily puzzle network',
  icon: '<circle cx="12" cy="12" r="6"/><circle cx="36" cy="12" r="6"/><circle cx="12" cy="36" r="6"/><path d="M18 11h12M18 14h12M12 18v12"/>',
  about: 'Rules: bridges run straight across or down, never cross each other or an island, and at most two bridges join the same pair of islands. Each island needs exactly as many bridges as its number, and all islands must end up connected.\nEach daily puzzle is built from a real network, so a solution always exists; any arrangement that follows every rule counts.\nTap one island and then another in line with it to add a bridge; tapping again makes it double, a third time removes it.',
  mount({ stage, panel, api }) {
    const SIZES = { 5: 6, 7: 12, 9: 18, 11: 26, 13: 34 }; // grid → islands
    let P = null, mine = new Map(), sel = -1, done = false, geo = null, warn = '', n = 7, dragTo = null;
    const S = shell(panel, api, 'hashi', () => make(), () => n === 7);
    const msg = winNote(panel);
    const pk = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);
    function make() { P = null; for (let t = 0; !P && t < 30; t++) P = hashiMake(n, rng(S.seed(n === 7 ? '' : n) + t), SIZES[n]); mine = new Map(); sel = -1; done = false; msg.hidden = true; warn = ''; if (!S.practice) S.restart(); cv.redraw(); }
    const count = (i) => [...mine.entries()].reduce((s, [k, w]) => s + (k.split('-').map(Number).includes(i) ? w : 0), 0);
    function crosses(a, b) {
      const A = P.isl[a], B = P.isl[b];
      for (const [k, w] of mine) {
        if (!w) continue;
        const [x, y] = k.split('-').map(Number), X = P.isl[x], Y = P.isl[y];
        if ((A.r === B.r) === (X.r === Y.r)) continue; // parallel
        const [h1, h2, v1, v2] = A.r === B.r ? [A, B, X, Y] : [X, Y, A, B];
        const hr = h1.r, vc = v1.c;
        if (vc > Math.min(h1.c, h2.c) && vc < Math.max(h1.c, h2.c) && hr > Math.min(v1.r, v2.r) && hr < Math.max(v1.r, v2.r)) return true;
      }
      return false;
    }
    function inLine(a, b) {
      const A = P.isl[a], B = P.isl[b];
      if (A.r !== B.r && A.c !== B.c) return false;
      return !P.isl.some((I, i) => i !== a && i !== b && (A.r === B.r ? I.r === A.r && I.c > Math.min(A.c, B.c) && I.c < Math.max(A.c, B.c) : I.c === A.c && I.r > Math.min(A.r, B.r) && I.r < Math.max(A.r, B.r)));
    }
    const cv = canvas(stage, (ctx, w, h) => {
      if (!P) return;
      const cell = Math.min((w - 30) / P.n, (h - 30) / P.n), ox = (w - cell * P.n) / 2 + cell / 2, oy = (h - cell * P.n) / 2 + cell / 2, R = cell * 0.36;
      geo = { cell, ox, oy, R };
      const XY = (I) => [ox + I.c * cell, oy + I.r * cell];
      for (const [k, wgt] of mine) {
        if (!wgt) continue;
        const [a, b] = k.split('-').map(Number), [x1, y1] = XY(P.isl[a]), [x2, y2] = XY(P.isl[b]), hz = y1 === y2;
        const offs = wgt === 2 ? [-4, 4] : [0];
        offs.forEach((o) => line(ctx, [[x1 + (hz ? 0 : o), y1 + (hz ? o : 0)], [x2 + (hz ? 0 : o), y2 + (hz ? o : 0)]], done ? C.gold : INK, 2.5));
      }
      P.isl.forEach((I, i) => {
        const [x, y] = XY(I), have = count(i);
        dot(ctx, x, y, R, have === I.need ? 'rgba(255,255,255,.18)' : '#16171c');
        ctx.strokeStyle = i === sel ? C.gold : have > I.need ? C.red : INK; ctx.lineWidth = i === sel ? 3 : 2; ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.stroke();
        ctx.font = `700 ${Math.round(R * 0.95)}px -apple-system, Segoe UI, sans-serif`;
        text(ctx, String(I.need), x, y + 1, have === I.need ? DIM : INK, 'center', 'middle');
      });
      // dragging a bridge out of an island
      if (dragTo && sel >= 0) { const [x, y] = XY(P.isl[sel]); ctx.setLineDash([6, 5]); line(ctx, [[x, y], [dragTo.x, dragTo.y]], C.gold, 2.5); ctx.setLineDash([]); }
      ctx.font = '600 12px -apple-system, Segoe UI, sans-serif';
      if (warn) text(ctx, warn, w / 2, 16, C.red, 'center');
    });
    const islandAt = (p) => (geo ? P.isl.findIndex((I) => Math.hypot(p.x - (geo.ox + I.c * geo.cell), p.y - (geo.oy + I.r * geo.cell)) < geo.R * 1.25) : -1);
    function link(a, b) {
      if (!inLine(a, b)) { warn = 'Bridges go straight across or down, with no island in the way.'; sel = b; cv.redraw(); return; }
      const k = pk(a, b), nw = ((mine.get(k) || 0) + 1) % 3;
      if (nw && !mine.get(k) && crosses(a, b)) { warn = 'Bridges can’t cross each other.'; cv.redraw(); return; }
      mine.set(k, nw); sel = -1;
      check();
    }
    // tap one island then another — or drag from one island to the other
    let downAt = -1, before = -1, moved = false;
    drag(cv.c, {
      down(p) { if (!geo || done) return false; downAt = islandAt(p); before = sel; moved = false; },
      move(p) { if (downAt < 0) return; const I = P.isl[downAt]; if (moved || Math.hypot(p.x - (geo.ox + I.c * geo.cell), p.y - (geo.oy + I.r * geo.cell)) > geo.R) { moved = true; sel = downAt; dragTo = p; cv.redraw(); } },
      up(p) {
        const i = islandAt(p), from = downAt; dragTo = null; downAt = -1; warn = '';
        if (moved) { if (i >= 0 && i !== from) link(from, i); else { sel = -1; cv.redraw(); } return; }
        if (i < 0 || before === i) { sel = -1; cv.redraw(); return; }
        if (before < 0) { sel = i; cv.redraw(); return; }
        link(before, i);
      },
    });
    function check() {
      const ok = P.isl.every((I, i) => count(i) === I.need);
      if (ok) {
        // all one network?
        const seen = new Set([0]), stack = [0];
        while (stack.length) { const a = stack.pop(); for (const [k, wgt] of mine) { if (!wgt) continue; const [x, y] = k.split('-').map(Number); const o = x === a ? y : y === a ? x : -1; if (o >= 0 && !seen.has(o)) { seen.add(o); stack.push(o); } } }
        if (seen.size === P.isl.length) { done = true; msg.hidden = false; msg.textContent = 'Solved!'; S.win(Math.round(S.seconds), fmtTime(S.seconds)).then((t) => { msg.textContent = t; S.render(); }); }
        else warn = 'Every number fits — but the islands must all join into one network.';
      }
      cv.redraw();
    }
    panel.appendChild(el('p', 'lab-note', 'Drag from one island to another to build a bridge (or tap one, then the other). Do it again for a double bridge; a third time removes it.'));
    seg(group(panel, 'Size'), { options: [[5, 'Small'], [7, 'Medium (today’s)'], [9, 'Large'], [11, 'Huge'], [13, 'Giant']], value: n, onChange: (v) => { n = +v; make(); S.render(); } });
    button(row(panel, 'lab-row-btns'), 'Remove all my bridges', () => { mine = new Map(); done = false; msg.hidden = true; cv.redraw(); });
    make();
    return { state: () => `a Bridges puzzle with ${P.isl.length} islands; ${P.isl.filter((I, i) => count(i) === I.need).length} of them have the right number of bridges`, destroy: () => { S.destroy(); cv.destroy(); } };
  },
};

/* ---------------- Pipes ---------------- */
const DIRS = [[-1, 0, 1, 4], [0, 1, 2, 8], [1, 0, 4, 1], [0, -1, 8, 2]]; // [dr, dc, my side, their side] N E S W
const rot = (m) => ((m << 1) | (m >> 3)) & 15; // turn a quarter clockwise
const pipesLab = {
  id: 'pipes', name: 'Pipes', subject: 'puzzles', blurb: 'Turn the pipes so water from the middle reaches every tile — with no leaks. 4×4 up to 12×12.',
  words: 'pipes plumber water network rotate tiles daily puzzle',
  icon: '<rect x="6" y="6" width="36" height="36" rx="3"/><path d="M6 24h14v-12M42 24H28v12M24 6v6M24 36v6"/><circle cx="24" cy="24" r="4"/>',
  about: 'Every pipe tile can turn. The puzzle is solved when water from the tap in the middle reaches every tile and no pipe end is left open (no leaks).\nThe daily puzzle is made by laying a real network of pipes and then turning the tiles at random, so it can always be solved.',
  mount({ stage, panel, api }) {
    let n = 6, tiles = [], src = 0, moves = 0, done = false, geo = null;
    const S = shell(panel, api, 'pipes', () => make(), () => n === 6);
    const msg = winNote(panel);
    function make() {
      const rand = rng(S.seed(n === 6 ? '' : n));
      tiles = Array(n * n).fill(0); src = Math.floor(n / 2) * n + Math.floor(n / 2);
      // a random tree of pipes reaching every tile (random depth-first walk)
      const seen = new Set([src]), stack = [src];
      while (stack.length) {
        const i = stack[stack.length - 1], r = (i / n) | 0, c = i % n;
        const opts = shuffle(DIRS, rand).filter(([dr, dc]) => { const rr = r + dr, cc = c + dc; return rr >= 0 && cc >= 0 && rr < n && cc < n && !seen.has(rr * n + cc); });
        if (!opts.length) { stack.pop(); continue; }
        const [dr, dc, me, them] = opts[0], j = (r + dr) * n + c + dc;
        tiles[i] |= me; tiles[j] |= them; seen.add(j); stack.push(j);
      }
      for (let k = 0; k < n * n; k++) { const t = Math.floor(rand() * 4); for (let q = 0; q < t; q++) tiles[k] = rot(tiles[k]); }
      if (solved().all) tiles[0] = rot(tiles[0]);
      moves = 0; done = false; msg.hidden = true; if (!S.practice) S.restart(); cv.redraw();
    }
    function solved() {
      const wet = new Set([src]), stack = [src];
      let leaks = 0;
      while (stack.length) {
        const i = stack.pop(), r = (i / n) | 0, c = i % n;
        for (const [dr, dc, me, them] of DIRS) {
          if (!(tiles[i] & me)) continue;
          const rr = r + dr, cc = c + dc, j = rr * n + cc;
          if (rr < 0 || cc < 0 || rr >= n || cc >= n || !(tiles[j] & them)) { leaks++; continue; }
          if (!wet.has(j)) { wet.add(j); stack.push(j); }
        }
      }
      return { wet, all: wet.size === n * n && leaks === 0 };
    }
    const cv = canvas(stage, (ctx, w, h) => {
      const cell = Math.floor(Math.min((w - 20) / n, (h - 20) / n)), ox = (w - cell * n) / 2, oy = (h - cell * n) / 2, { wet } = solved();
      geo = { cell, ox, oy };
      for (let i = 0; i < n * n; i++) {
        const r = (i / n) | 0, c = i % n, x = ox + c * cell, y = oy + r * cell, cx = x + cell / 2, cy = y + cell / 2, col = wet.has(i) ? (done ? C.gold : '#5fb4ff') : '#8a8a92';
        ctx.fillStyle = 'rgba(255,255,255,.04)'; ctx.fillRect(x + 1, y + 1, cell - 2, cell - 2);
        ctx.strokeStyle = col; ctx.lineWidth = cell * 0.2; ctx.lineCap = 'round';
        DIRS.forEach(([dr, dc, me]) => { if (tiles[i] & me) { ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + (dc * cell) / 2, cy + (dr * cell) / 2); ctx.stroke(); } });
        dot(ctx, cx, cy, cell * 0.11, col);
        if (i === src) { dot(ctx, cx, cy, cell * 0.22, '#5fb4ff'); dot(ctx, cx, cy, cell * 0.1, '#fff'); }
      }
    });
    cv.c.addEventListener('click', (e) => {
      if (!geo || done) return;
      const p = at(cv.c, e), c = Math.floor((p.x - geo.ox) / geo.cell), r = Math.floor((p.y - geo.oy) / geo.cell);
      if (r < 0 || c < 0 || r >= n || c >= n) return;
      tiles[r * n + c] = rot(tiles[r * n + c]); moves++;
      if (solved().all) { done = true; msg.hidden = false; msg.textContent = 'Solved!'; S.win(Math.round(S.seconds), fmtTime(S.seconds)).then((t) => { msg.textContent = t; S.render(); }); }
      cv.redraw(); st.set([['Turns', String(moves)]]);
    });
    panel.appendChild(el('p', 'lab-note', 'Tap a tile to turn it a quarter clockwise.'));
    seg(group(panel, 'Size'), { options: [[4, '4 × 4'], [5, '5 × 5'], [6, '6 × 6 (today’s)'], [8, '8 × 8'], [10, '10 × 10'], [12, '12 × 12']], value: n, onChange: (v) => { n = +v; make(); st.set([['Turns', '0']]); S.render(); } });
    const st = stats(panel);
    make(); st.set([['Turns', '0']]);
    return { state: () => `a ${n}×${n} pipes puzzle; ${solved().wet.size} of ${n * n} tiles have water after ${moves} turns`, destroy: () => { S.destroy(); cv.destroy(); } };
  },
};

/* ---------------- Mirrors (laser) ---------------- */
const STEP = { E: [0, 1], W: [0, -1], N: [-1, 0], S: [1, 0] };
const BOUNCE = { '/': { E: 'N', N: 'E', W: 'S', S: 'W' }, '\\': { E: 'S', S: 'E', W: 'N', N: 'W' } };
const mirrorsLab = {
  id: 'mirrors', name: 'Laser mirrors', subject: 'puzzles', blurb: 'Tap the mirrors to turn them so the laser bounces its way to the glowing target. Four board sizes, a new layout every time.',
  words: 'laser mirrors reflection optics light puzzle daily',
  icon: '<rect x="6" y="6" width="36" height="36" rx="3"/><path d="M6 30h12l0-14h18" stroke-dasharray="1 0"/><path d="M14 34l8-8M32 12l8 8"/><circle cx="36" cy="16" r="3"/>',
  about: 'Each mirror is a flat mirror at 45°, so the laser turns through exactly 90° when it hits one (angle in = angle out). Grey blocks stop the beam.\nThe daily puzzle is made by drawing a real laser path first and then turning the mirrors at random, so it can always be solved. Some mirrors are decoys that aren’t needed.',
  mount({ stage, panel, api }) {
    let n = 7;
    let grid = [], start = 0, target = null, taps = 0, done = false, geo = null;
    const S = shell(panel, api, 'mirrors', () => make(), () => n === 7);
    const msg = winNote(panel);
    function trace() {
      let r = start, c = 0, d = 'E';
      const pts = [[r, -0.5]], seen = new Set();
      for (let k = 0; k < 200; k++) {
        if (r < 0 || c < 0 || r >= n || c >= n) { pts.push([r, c]); return { pts, hit: false }; }
        const key = `${r},${c},${d}`; if (seen.has(key)) return { pts, hit: false }; seen.add(key);
        const cellv = grid[r * n + c];
        if (target && r === target[0] && c === target[1]) { pts.push([r, c]); return { pts, hit: true }; }
        if (cellv === '#') { pts.push([r - STEP[d][0] * 0.5, c - STEP[d][1] * 0.5]); return { pts, hit: false }; }
        if (cellv === '/' || cellv === '\\') { pts.push([r, c]); d = BOUNCE[cellv][d]; }
        r += STEP[d][0]; c += STEP[d][1];
      }
      return { pts, hit: false };
    }
    function make() {
      const rand = rng(S.seed(n === 7 ? '' : n));
      for (let attempt = 0; attempt < 400; attempt++) {
        grid = Array(n * n).fill(''); start = 1 + Math.floor(rand() * (n - 2));
        let r = start, c = 0, d = 'E'; const used = new Set([r * n + c]); let turns = 0, ok = true;
        // bigger boards: a longer path with more turns
        const wantTurns = Math.max(2, n - 4) + Math.floor(rand() * 3);
        while (turns < wantTurns) {
          const len = 1 + Math.floor(rand() * 3);
          let k = 0;
          for (; k < len; k++) { const rr = r + STEP[d][0], cc = c + STEP[d][1]; if (rr < 0 || cc < 0 || rr >= n || cc >= n || used.has(rr * n + cc)) break; r = rr; c = cc; used.add(r * n + c); }
          if (!k && turns === 0) { ok = false; break; }
          const turnTo = (d === 'E' || d === 'W' ? ['N', 'S'] : ['E', 'W'])[Math.floor(rand() * 2)];
          const m = BOUNCE['/'][d] === turnTo ? '/' : '\\';
          if (grid[r * n + c] || (r === start && c === 0)) { ok = false; break; }
          grid[r * n + c] = m; d = turnTo; turns++;
        }
        if (!ok) continue;
        // walk on from the last mirror to the target
        const len = 1 + Math.floor(rand() * 2); let k = 0;
        for (; k < len; k++) { const rr = r + STEP[d][0], cc = c + STEP[d][1]; if (rr < 0 || cc < 0 || rr >= n || cc >= n || used.has(rr * n + cc)) break; r = rr; c = cc; used.add(r * n + c); }
        if (!k) continue;
        target = [r, c];
        if (!trace().hit) continue;
        // decoy mirrors and blocks off the path, then turn the mirrors at random
        const free = shuffle([...Array(n * n).keys()].filter((i) => !used.has(i) && !grid[i] && i % n !== 0), rand);
        const decoys = Math.round(n * n / 16);
        free.slice(0, decoys).forEach((i) => { grid[i] = rand() < 0.5 ? '/' : '\\'; });
        free.slice(decoys, decoys * 2).forEach((i) => { grid[i] = '#'; });
        grid = grid.map((v) => (v === '/' || v === '\\' ? (rand() < 0.5 ? '/' : '\\') : v));
        if (trace().hit) { const i = grid.findIndex((v) => v === '/' || v === '\\'); grid[i] = grid[i] === '/' ? '\\' : '/'; }
        if (trace().hit) continue;
        break;
      }
      taps = 0; done = false; msg.hidden = true; if (!S.practice) S.restart(); cv.redraw();
      stage.dataset.mirrors = grid.map((v, i) => (v === '/' || v === '\\' ? i : -1)).filter((i) => i >= 0).join(','); // (where the mirrors are, for the tests)
    }
    const cv = canvas(stage, (ctx, w, h) => {
      const cell = Math.floor(Math.min((w - 60) / (n + 1), (h - 20) / n)), ox = (w - cell * n) / 2 + cell * 0.3, oy = (h - cell * n) / 2;
      stage.dataset.geo = JSON.stringify({ cell, ox, oy });
      geo = { cell, ox, oy };
      const P = ([r, c]) => [ox + c * cell + cell / 2, oy + r * cell + cell / 2];
      for (let i = 0; i < n * n; i++) {
        const r = (i / n) | 0, c = i % n, x = ox + c * cell, y = oy + r * cell, v = grid[i];
        ctx.fillStyle = 'rgba(255,255,255,.035)'; ctx.fillRect(x + 1, y + 1, cell - 2, cell - 2);
        if (v === '#') { ctx.fillStyle = '#4a4b52'; ctx.fillRect(x + 4, y + 4, cell - 8, cell - 8); }
        if (v === '/' || v === '\\') { ctx.strokeStyle = '#cfe6ff'; ctx.lineWidth = 4; ctx.beginPath(); if (v === '/') { ctx.moveTo(x + 6, y + cell - 6); ctx.lineTo(x + cell - 6, y + 6); } else { ctx.moveTo(x + 6, y + 6); ctx.lineTo(x + cell - 6, y + cell - 6); } ctx.stroke(); }
      }
      // the laser and the target
      const [lx, ly] = P([start, -0.5]); ctx.fillStyle = '#d8d8de'; ctx.fillRect(lx - cell * 0.45, ly - cell * 0.2, cell * 0.45, cell * 0.4);
      if (target) { const [tx, ty] = P(target); const g = ctx.createRadialGradient(tx, ty, 0, tx, ty, cell * 0.6); g.addColorStop(0, done ? 'rgba(255,207,90,1)' : 'rgba(255,207,90,.8)'); g.addColorStop(1, 'rgba(255,207,90,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(tx, ty, cell * 0.6, 0, Math.PI * 2); ctx.fill(); dot(ctx, tx, ty, cell * 0.18, C.gold); }
      const tr = trace();
      line(ctx, tr.pts.map(P), 'rgba(255,80,80,.95)', 3);
    });
    cv.c.addEventListener('click', (e) => {
      if (!geo || done) return;
      const p = at(cv.c, e), c = Math.floor((p.x - geo.ox) / geo.cell), r = Math.floor((p.y - geo.oy) / geo.cell);
      if (r < 0 || c < 0 || r >= n || c >= n) return;
      const v = grid[r * n + c];
      if (v !== '/' && v !== '\\') return;
      grid[r * n + c] = v === '/' ? '\\' : '/'; taps++;
      if (trace().hit) { done = true; msg.hidden = false; msg.textContent = 'Solved!'; S.win(Math.round(S.seconds), fmtTime(S.seconds)).then((t) => { msg.textContent = t; S.render(); }); }
      st.set([['Taps', String(taps)]]); cv.redraw();
    });
    panel.appendChild(el('p', 'lab-note', 'Tap a mirror to turn it between / and \\.'));
    seg(group(panel, 'Size'), { options: [[5, '5 × 5'], [7, '7 × 7 (today’s)'], [9, '9 × 9'], [11, '11 × 11']], value: n, onChange: (v) => { n = +v; make(); st.set([['Taps', '0']]); S.render(); } });
    const st = stats(panel);
    make(); st.set([['Taps', '0']]);
    return { state: () => `a laser-mirror puzzle; the beam ${trace().hit ? 'reaches' : 'does not yet reach'} the target after ${taps} taps`, destroy: () => { S.destroy(); cv.destroy(); } };
  },
};

/* ---------------- Guess the equation ---------------- */
const LEN = 8;
function evalSide(s) { // numbers and + − × ÷ with the usual order; null if not allowed
  if (!/^\d+([+\-*/]\d+)*$/.test(s)) return null;
  const toks = s.match(/\d+|[+\-*/]/g);
  if (toks.some((t) => /^\d/.test(t) && t.length > 1 && t[0] === '0')) return null; // no leading zeros
  const vals = [+toks[0]], ops = [];
  for (let i = 1; i < toks.length; i += 2) {
    const op = toks[i], v = +toks[i + 1];
    if (op === '*') vals.push(vals.pop() * v);
    else if (op === '/') { if (v === 0) return null; vals.push(vals.pop() / v); }
    else { ops.push(op); vals.push(v); }
  }
  let r = vals[0];
  ops.forEach((op, i) => { r = op === '+' ? r + vals[i + 1] : r - vals[i + 1]; });
  return r;
}
function validEq(s) {
  if (s.length !== LEN || (s.match(/=/g) || []).length !== 1) return 'It needs 8 symbols with exactly one “=”.';
  const [l, r] = s.split('=');
  if (!/^\d+$/.test(r) || (r.length > 1 && r[0] === '0')) return 'The right side must be just a number.';
  const v = evalSide(l);
  if (v == null) return 'The left side isn’t a sum Cassie can read.';
  if (!Number.isInteger(v) || v !== +r) return `That isn’t true: the left side makes ${Number.isInteger(v) ? v : num(v)}.`;
  return '';
}
function makeEquation(rand) {
  for (let t = 0; t < 5000; t++) {
    const op = '+-*/'[Math.floor(rand() * 4)];
    let a = 1 + Math.floor(rand() * 98), b = 1 + Math.floor(rand() * 98), c;
    if (op === '+') c = a + b; else if (op === '-') { if (a < b) [a, b] = [b, a]; c = a - b; } else if (op === '*') c = a * b; else { c = a; a = b * c; }
    const s = `${a}${op}${b}=${c}`;
    if (s.length === LEN && !validEq(s)) return s;
  }
  return '12+46=58';
}
const SHOW = (ch) => ({ '*': '×', '/': '÷', '-': '−' }[ch] || ch);
const equationLab = {
  id: 'equation', name: 'Guess the equation', subject: 'puzzles', blurb: 'Find the hidden 8-symbol equation in six guesses. Every guess must be a true equation.',
  words: 'equation guess nerdle wordle math arithmetic daily puzzle',
  icon: '<rect x="4" y="16" width="8" height="12" rx="2"/><rect x="14" y="16" width="8" height="12" rx="2"/><rect x="24" y="16" width="8" height="12" rx="2"/><rect x="34" y="16" width="10" height="12" rx="2"/><path d="M26 22h4M36 21h6M36 24h6"/>',
  about: 'The hidden equation has 8 symbols — digits and + − × ÷ = — like 12+46=58. Every guess must be a true equation, worked out with the usual order (× and ÷ before + and −). Numbers can’t start with 0.\nAfter each guess: a white square means the right symbol in the right place, an outlined square means the symbol is in the equation but somewhere else, and a dark square means it isn’t in the equation (or not that many times).\nYour score uses how many guesses you needed, then your time.',
  mount({ stage, panel, api }) {
    let answer = '', guesses = [], cur = '', over = false, warn = '';
    const S = shell(panel, api, 'equation', () => make());
    const msg = winNote(panel);
    const wrap = el('div', 'puz-eq'); stage.appendChild(wrap);
    function make() { answer = makeEquation(rng(S.seed())); guesses = []; cur = ''; over = false; warn = ''; msg.hidden = true; if (!S.practice) S.restart(); render(); }
    function marks(g) {
      const res = Array(LEN).fill('no'), left = {};
      for (let i = 0; i < LEN; i++) { if (g[i] === answer[i]) res[i] = 'yes'; else left[answer[i]] = (left[answer[i]] || 0) + 1; }
      for (let i = 0; i < LEN; i++) if (res[i] !== 'yes' && left[g[i]]) { res[i] = 'near'; left[g[i]]--; }
      return res;
    }
    function render() {
      const best = {}; guesses.forEach((g) => marks(g).forEach((m, i) => { const k = g[i], rank = { yes: 3, near: 2, no: 1 }; if (!best[k] || rank[m] > rank[best[k]]) best[k] = m; }));
      const rows = [...Array(6)].map((_, r) => {
        const g = guesses[r] || (r === guesses.length ? cur.padEnd(LEN) : ''.padEnd(LEN)), m = guesses[r] ? marks(guesses[r]) : null;
        return `<div class="eq-row">${[...Array(LEN)].map((__, i) => `<span class="eq-c ${m ? m[i] : g[i] && g[i] !== ' ' ? 'typed' : ''}">${esc(SHOW(g[i] || ' ').trim())}</span>`).join('')}</div>`;
      }).join('');
      const keys = ['1234567890', '+-*/=', 'E⌫'];
      wrap.innerHTML = `<div class="eq-board" aria-live="polite">${rows}</div>${warn ? `<p class="eq-warn">${esc(warn)}</p>` : ''}
        <div class="eq-keys">${keys.map((rowK) => `<div>${[...rowK].map((k) => k === 'E' ? '<button type="button" data-k="enter" class="wide">Enter</button>' : k === '⌫' ? '<button type="button" data-k="back" class="wide" aria-label="Delete">⌫</button>' : `<button type="button" data-k="${esc(k)}" class="${best[k] || ''}">${esc(SHOW(k))}</button>`).join('')}</div>`).join('')}</div>`;
    }
    function press(k) {
      if (over) return;
      warn = '';
      if (k === 'back') cur = cur.slice(0, -1);
      else if (k === 'enter') {
        const why = validEq(cur);
        if (why) warn = why;
        else {
          guesses.push(cur); cur = '';
          if (guesses[guesses.length - 1] === answer) {
            over = true; const g = guesses.length, sec = Math.round(S.seconds);
            msg.hidden = false; msg.textContent = 'Solved!';
            S.win(g * 600 + Math.min(599, sec), `${g}/6 · ${fmtTime(sec)}`).then((t) => { msg.textContent = t; S.render(); });
          } else if (guesses.length === 6) { over = true; S.stop(); msg.hidden = false; msg.textContent = `The equation was ${[...answer].map(SHOW).join('')}. A new one comes tomorrow — or try a practice one.`; }
        }
      } else if (cur.length < LEN) cur += k;
      render();
    }
    wrap.addEventListener('click', (e) => { const b = e.target.closest('[data-k]'); if (b) press(b.dataset.k); });
    const keys = (e) => {
      if (!document.body.contains(wrap)) return;
      const k = e.key === 'Enter' ? 'enter' : e.key === 'Backspace' ? 'back' : e.key === 'x' || e.key === 'X' ? '*' : e.key === '÷' ? '/' : e.key;
      if (/^[0-9+\-*/=]$/.test(k) || k === 'enter' || k === 'back') { press(k); e.preventDefault(); }
    };
    document.addEventListener('keydown', keys);
    make();
    return { state: () => `the equation puzzle: ${guesses.length} guesses so far (${guesses.join(', ') || 'none yet'})`, destroy: () => { S.destroy(); document.removeEventListener('keydown', keys); } };
  },
};

/* ---------------- Geography ---------------- */
// [name in the map data, how to say it, capital, latitude, longitude, region]
const COUNTRIES = [
  ['Philippines', 'the Philippines', 'Manila', 14.60, 120.98, 'Asia'], ['Japan', 'Japan', 'Tokyo', 35.68, 139.69, 'Asia'], ['China', 'China', 'Beijing', 39.90, 116.40, 'Asia'],
  ['India', 'India', 'New Delhi', 28.61, 77.21, 'Asia'], ['Indonesia', 'Indonesia', 'Jakarta', -6.21, 106.85, 'Asia'], ['Vietnam', 'Vietnam', 'Hanoi', 21.03, 105.85, 'Asia'],
  ['Thailand', 'Thailand', 'Bangkok', 13.76, 100.50, 'Asia'], ['Malaysia', 'Malaysia', 'Kuala Lumpur', 3.14, 101.69, 'Asia'], ['South Korea', 'South Korea', 'Seoul', 37.57, 126.98, 'Asia'],
  ['Pakistan', 'Pakistan', 'Islamabad', 33.69, 73.06, 'Asia'], ['Bangladesh', 'Bangladesh', 'Dhaka', 23.81, 90.41, 'Asia'], ['Saudi Arabia', 'Saudi Arabia', 'Riyadh', 24.71, 46.68, 'Asia'],
  ['Iran', 'Iran', 'Tehran', 35.69, 51.39, 'Asia'], ['Turkey', 'Turkey (Türkiye)', 'Ankara', 39.93, 32.86, 'Asia'], ['Mongolia', 'Mongolia', 'Ulaanbaatar', 47.89, 106.91, 'Asia'],
  ['Kazakhstan', 'Kazakhstan', 'Astana', 51.17, 71.45, 'Asia'], ['Afghanistan', 'Afghanistan', 'Kabul', 34.53, 69.17, 'Asia'], ['Iraq', 'Iraq', 'Baghdad', 33.31, 44.36, 'Asia'],
  ['Nepal', 'Nepal', 'Kathmandu', 27.72, 85.32, 'Asia'], ['Cambodia', 'Cambodia', 'Phnom Penh', 11.56, 104.92, 'Asia'], ['Laos', 'Laos', 'Vientiane', 17.98, 102.63, 'Asia'],
  ['Myanmar', 'Myanmar', 'Naypyidaw', 19.76, 96.08, 'Asia'],
  ['Australia', 'Australia', 'Canberra', -35.28, 149.13, 'Oceania'], ['New Zealand', 'New Zealand', 'Wellington', -41.29, 174.78, 'Oceania'], ['Papua New Guinea', 'Papua New Guinea', 'Port Moresby', -9.44, 147.18, 'Oceania'],
  ['Egypt', 'Egypt', 'Cairo', 30.04, 31.24, 'Africa'], ['Nigeria', 'Nigeria', 'Abuja', 9.08, 7.40, 'Africa'], ['Kenya', 'Kenya', 'Nairobi', -1.29, 36.82, 'Africa'],
  ['Ethiopia', 'Ethiopia', 'Addis Ababa', 9.03, 38.74, 'Africa'], ['Morocco', 'Morocco', 'Rabat', 34.02, -6.84, 'Africa'], ['Algeria', 'Algeria', 'Algiers', 36.75, 3.06, 'Africa'],
  ['Ghana', 'Ghana', 'Accra', 5.60, -0.19, 'Africa'], ['Madagascar', 'Madagascar', 'Antananarivo', -18.88, 47.51, 'Africa'], ['Tanzania', 'Tanzania', 'Dodoma', -6.16, 35.75, 'Africa'],
  ['France', 'France', 'Paris', 48.86, 2.35, 'Europe'], ['Germany', 'Germany', 'Berlin', 52.52, 13.40, 'Europe'], ['United Kingdom', 'the United Kingdom', 'London', 51.51, -0.13, 'Europe'],
  ['Spain', 'Spain', 'Madrid', 40.42, -3.70, 'Europe'], ['Italy', 'Italy', 'Rome', 41.90, 12.50, 'Europe'], ['Portugal', 'Portugal', 'Lisbon', 38.72, -9.14, 'Europe'],
  ['Netherlands', 'the Netherlands', 'Amsterdam', 52.37, 4.90, 'Europe'], ['Poland', 'Poland', 'Warsaw', 52.23, 21.01, 'Europe'], ['Sweden', 'Sweden', 'Stockholm', 59.33, 18.07, 'Europe'],
  ['Norway', 'Norway', 'Oslo', 59.91, 10.75, 'Europe'], ['Finland', 'Finland', 'Helsinki', 60.17, 24.94, 'Europe'], ['Greece', 'Greece', 'Athens', 37.98, 23.73, 'Europe'],
  ['Ukraine', 'Ukraine', 'Kyiv', 50.45, 30.52, 'Europe'], ['Russia', 'Russia', 'Moscow', 55.76, 37.62, 'Europe'], ['Austria', 'Austria', 'Vienna', 48.21, 16.37, 'Europe'],
  ['Ireland', 'Ireland', 'Dublin', 53.35, -6.26, 'Europe'], ['Iceland', 'Iceland', 'Reykjavík', 64.15, -21.94, 'Europe'],
  ['Canada', 'Canada', 'Ottawa', 45.42, -75.70, 'Americas'], ['United States of America', 'the United States', 'Washington, D.C.', 38.91, -77.04, 'Americas'], ['Mexico', 'Mexico', 'Mexico City', 19.43, -99.13, 'Americas'],
  ['Brazil', 'Brazil', 'Brasília', -15.79, -47.88, 'Americas'], ['Argentina', 'Argentina', 'Buenos Aires', -34.60, -58.38, 'Americas'], ['Chile', 'Chile', 'Santiago', -33.45, -70.67, 'Americas'],
  ['Peru', 'Peru', 'Lima', -12.05, -77.04, 'Americas'], ['Colombia', 'Colombia', 'Bogotá', 4.71, -74.07, 'Americas'], ['Venezuela', 'Venezuela', 'Caracas', 10.48, -66.90, 'Americas'],
  ['Cuba', 'Cuba', 'Havana', 23.11, -82.37, 'Americas'],
];
// Natural Earth projection (Šavrič et al.) — the world looks the way students know it from atlases
function naturalEarth(lon, lat) {
  const l = (lon * Math.PI) / 180, p = (lat * Math.PI) / 180, p2 = p * p, p4 = p2 * p2;
  return [l * (0.8707 - 0.131979 * p2 + p4 * (-0.013791 + p4 * (0.003971 * p2 - 0.001529 * p4))), p * (1.007226 + p2 * (0.015085 + p4 * (-0.044475 + 0.028874 * p2 - 0.005916 * p4)))];
}
const haversine = (a, b) => { const R = 6371, t = Math.PI / 180, dLat = (b[0] - a[0]) * t, dLon = (b[1] - a[1]) * t, h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * t) * Math.cos(b[0] * t) * Math.sin(dLon / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
// the map data's short labels, written out in full
const FULL_NAMES = { 'W. Sahara': 'Western Sahara', 'Dem. Rep. Congo': 'Democratic Republic of the Congo', 'Dominican Rep.': 'Dominican Republic', 'Falkland Is.': 'Falkland Islands', 'Fr. S. Antarctic Lands': 'French Southern and Antarctic Lands', 'Central African Rep.': 'Central African Republic', 'Eq. Guinea': 'Equatorial Guinea', eSwatini: 'Eswatini', Turkey: 'Türkiye (Turkey)', 'Solomon Is.': 'Solomon Islands', Czechia: 'Czechia (Czech Republic)', 'N. Cyprus': 'Northern Cyprus', 'Bosnia and Herz.': 'Bosnia and Herzegovina', Macedonia: 'North Macedonia', 'S. Sudan': 'South Sudan', 'United States of America': 'United States', 'Côte d\'Ivoire': 'Côte d’Ivoire (Ivory Coast)' };
// territories whose status is disputed or that aren't countries are never asked in "Find it"
const NOT_ASKED = new Set(['W. Sahara', 'N. Cyprus', 'Somaliland', 'Kosovo', 'Fr. S. Antarctic Lands', 'Falkland Is.', 'Taiwan', 'Palestine', 'Greenland', 'Puerto Rico', 'New Caledonia']);
let worldPromise = null;
function loadWorld() { // TopoJSON → rings of [lon, lat] for each country
  if (!worldPromise) worldPromise = fetch(new URL('./world-110m.json', import.meta.url)).then((r) => r.json()).then((topo) => {
    const [sx, sy] = topo.transform.scale, [tx, ty] = topo.transform.translate;
    const arcs = topo.arcs.map((arc) => { let x = 0, y = 0; return arc.map(([dx, dy]) => { x += dx; y += dy; return [x * sx + tx, y * sy + ty]; }); });
    const ring = (ids) => { const out = []; ids.forEach((i) => { const a = i >= 0 ? arcs[i] : arcs[~i].slice().reverse(); out.push(...(out.length ? a.slice(1) : a)); }); return out; };
    return topo.objects.countries.geometries.filter((g) => g.properties.name !== 'Antarctica').map((g) => {
      const polys = g.type === 'Polygon' ? [g.arcs.map(ring)] : g.type === 'MultiPolygon' ? g.arcs.map((p) => p.map(ring)) : [];
      // a rough size (square degrees × cos latitude) — enough to tell big countries from tiny islands
      const area = polys.reduce((sum, poly) => { const rg = poly[0]; let a = 0; for (let i = 0, j = rg.length - 1; i < rg.length; j = i++) a += (rg[j][0] - rg[i][0]) * (rg[j][1] + rg[i][1]); return sum + Math.abs(a / 2) * Math.cos((rg[0][1] * Math.PI) / 180); }, 0);
      return { name: g.properties.name, polys, area, id: g.id };
    });
  });
  return worldPromise;
}
const geographyLab = {
  id: 'geography', name: 'Geography', subject: 'puzzles', blurb: 'Name the highlighted country, pick its capital, then pin it on the map. Or find countries on the map, or tap around to explore.',
  words: 'geography countries capitals map world atlas daily quiz',
  icon: '<circle cx="24" cy="24" r="18"/><path d="M6 24h36M24 6c-7 6-7 30 0 36M24 6c7 6 7 30 0 36"/><path d="M33 14l2 6-4 2" />',
  about: 'Map: Natural Earth (public domain) in the Natural Earth projection; borders are shown as drawn in that data and are not a statement about any disputed territory. Small countries and islands are simplified at this scale.\nEach round: name the country (100 points), pick its capital (100 points), then pin the capital — 100 points minus 1 for every 10 km you are off. The capital listed is the official capital (for example Tanzania’s is Dodoma, Myanmar’s Naypyidaw, Kazakhstan’s Astana).\nEveryone gets the same 8 countries each day.',
  mount({ stage, panel, api }) {
    let world = null, rounds = [], k = 0, step = 0, points = 0, options = [], answered = null, pin = null, view = null, over = false, rand = null;
    // modes: today's quiz (as before) · find a country on the map · explore (tap any country)
    let mode = 'quiz', find = null, found = null, tapped = null, findScore = [0, 0];
    let vk = 1, vx = 0, vy = 0; // zoom and pan
    const S = shell(panel, api, 'geography', () => make(), () => mode === 'quiz');
    const msg = winNote(panel);
    const qbox = el('div', 'geo-q'); stage.appendChild(qbox);
    function make() {
      rand = rng(S.seed());
      rounds = shuffle(COUNTRIES, rand).slice(0, 8);
      k = 0; step = 0; points = 0; over = false; msg.hidden = true; if (!S.practice) S.restart();
      if (mode === 'quiz') newStep(); else { vk = 1; vx = 0; vy = 0; nextFind(); }
    }
    // "Find it": any country of the map (the bigger ones first, so it's fair at world size)
    function nextFind() {
      found = null; tapped = null;
      if (mode === 'find' && world) { const pool = world.filter((c) => c.area > 0.6 && !NOT_ASKED.has(c.name)); find = pool[Math.floor(Math.random() * pool.length)]; }
      render();
    }
    function countryAt(lon, lat) {
      const inside = (rg, x, y) => { let inn = false, prev = null; const pts = rg.map(([lo, la]) => { if (prev != null) { while (lo - prev > 180) lo -= 360; while (prev - lo > 180) lo += 360; } prev = lo; return [lo, la]; }); for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, yi] = pts[i], [xj, yj] = pts[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inn = !inn; } return inn; };
      for (const c of world) for (const poly of c.polys) for (const lo of [lon, lon - 360, lon + 360]) if (inside(poly[0], lo, lat) && !poly.slice(1).some((h) => inside(h, lo, lat))) return c;
      return null;
    }
    function newStep() {
      answered = null; pin = null; tapped = null; tapAt = null;
      const C0 = rounds[k];
      if (step === 0) options = shuffle([C0, ...shuffle(COUNTRIES.filter((c) => c !== C0 && c[5] === C0[5]), rand).slice(0, 3)], rand).map((c) => c[1]);
      if (step === 1) options = shuffle([C0, ...shuffle(COUNTRIES.filter((c) => c !== C0 && c[5] === C0[5]), rand).slice(0, 3)], rand).map((c) => c[2]);
      view = step === 2 ? 'zoom' : 'world';
      render();
    }
    const nice = (name) => { const c = COUNTRIES.find((x) => x[0] === name); return c ? c[1].replace(/^the /, '') : FULL_NAMES[name] || name; };
    function render() {
      const C0 = rounds[k];
      if (mode === 'explore') {
        const c = tapped && COUNTRIES.find((x) => x[0] === tapped.name);
        qbox.innerHTML = `<p class="geo-n">Explore · drag to move, pinch or scroll to zoom</p><p class="geo-text">${tapped ? `That’s <b>${esc(nice(tapped.name))}</b>${c ? ` — capital: ${esc(c[2])}` : ''}.` : 'Tap any country to see its name.'}</p>`;
        cv.redraw(); return;
      }
      if (mode === 'find') {
        qbox.innerHTML = `<p class="geo-n">Find it · ${findScore[0]} of ${findScore[1]} found first time · drag to move, pinch or scroll to zoom</p><p class="geo-text">${find ? (found === true ? `Yes — that’s <b>${esc(nice(find.name))}</b>!` : found === false ? `That’s ${esc(nice(tapped.name))}. <b>${esc(nice(find.name))}</b> is the one shining.` : `Tap <b>${esc(nice(find.name))}</b> on the map.`) : 'Loading the map…'}</p>${found != null ? '<button type="button" class="lab-btn main geo-next">Next country</button>' : ''}`;
        cv.redraw(); return;
      }
      if (over) { qbox.innerHTML = ''; cv.redraw(); return; }
      const q = step === 0 ? 'Which country is highlighted?' : step === 1 ? `What is the capital of ${esc(C0[1])}?` : `Tap the map where ${esc(C0[2])} is.`;
      qbox.innerHTML = `<p class="geo-n">Round ${k + 1} of ${rounds.length} · ${points} points</p><p class="geo-text">${q}</p>`
        + (step < 2 ? `<div class="geo-opts">${options.map((o) => `<button type="button" data-o="${esc(o)}" class="${answered ? (o === (step ? C0[2] : C0[1]) ? 'right' : o === answered ? 'wrong' : '') : ''}" ${answered ? 'disabled' : ''}>${esc(o)}</button>`).join('')}</div>` : '')
        + (answered || pin ? '<button type="button" class="lab-btn main geo-next">Next</button>' : '');
      cv.redraw();
    }
    qbox.addEventListener('click', (e) => {
      const o = e.target.closest('[data-o]');
      if (o && !answered) { answered = o.dataset.o; const C0 = rounds[k]; if (answered === (step ? C0[2] : C0[1])) points += 100; render(); return; }
      if (e.target.closest('.geo-next') && mode === 'find') { nextFind(); return; }
      if (e.target.closest('.geo-next')) {
        step++;
        if (step > 2) { step = 0; k++; }
        if (k >= rounds.length) {
          over = true; msg.hidden = false; msg.textContent = `Finished with ${points} of ${rounds.length * 300} points!`;
          S.win(Math.max(1, rounds.length * 300 + 1 - points), `${points} points`).then((t) => { msg.textContent = `${points} of ${rounds.length * 300} points. ${t}`; S.render(); });
          render(); return;
        }
        newStep();
      }
    });
    let proj = null;
    const cv = canvas(stage, (ctx, w, h) => {
      if (!world) { text(ctx, 'Loading the map…', w / 2, h / 2, DIM, 'center'); return; }
      const top = (qbox.offsetHeight || 92) + 6, C0 = rounds[k] || COUNTRIES[0];
      if (mode !== 'quiz') view = 'world';
      // fit the whole world, or zoom round today's country when pinning its capital
      let bounds = [[-180, -58], [180, 84]];
      if (view === 'zoom' && !over) { const f = world.find((c) => c.name === C0[0]); const pts = f.polys.flat(2); let [x0, y0, x1, y1] = [180, 90, -180, -90]; pts.forEach(([x, y]) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }); if (x1 - x0 > 200) { x0 = -180; x1 = 180; } const mx = Math.max(6, (x1 - x0) * 0.8), my = Math.max(5, (y1 - y0) * 0.8); bounds = [[x0 - mx, y0 - my], [x1 + mx, y1 + my]]; }
      const corners = [[bounds[0][0], bounds[0][1]], [bounds[1][0], bounds[1][1]], [bounds[0][0], bounds[1][1]], [bounds[1][0], bounds[0][1]], [(bounds[0][0] + bounds[1][0]) / 2, bounds[1][1]], [(bounds[0][0] + bounds[1][0]) / 2, bounds[0][1]]].map(([a, b]) => naturalEarth(a, b));
      const xs = corners.map((p) => p[0]), ys = corners.map((p) => p[1]), sx = (w - 20) / (Math.max(...xs) - Math.min(...xs)), sy = (h - top - 10) / (Math.max(...ys) - Math.min(...ys)), s = Math.min(sx, sy);
      const cx = w / 2 - ((Math.max(...xs) + Math.min(...xs)) / 2) * s, cy = top + (h - top) / 2 + ((Math.max(...ys) + Math.min(...ys)) / 2) * s;
      const midY = top + (h - top) / 2, z = mode === 'quiz' ? { k: 1, x: 0, y: 0 } : { k: vk, x: vx, y: vy };
      const P0 = (lon, lat) => { const [x, y] = naturalEarth(lon, lat); return [cx + x * s, cy - y * s]; };
      const P = (lon, lat) => { const [x, y] = P0(lon, lat); return [(x - w / 2) * z.k + w / 2 + z.x, (y - midY) * z.k + midY + z.y]; };
      proj = { P, w, midY, inv: (x, y) => { // screen → lon/lat (search, since the projection has no simple inverse)
        x = (x - w / 2 - z.x) / z.k + w / 2; y = (y - midY - z.y) / z.k + midY;
        let best = null, bd = Infinity; for (let lo = -180; lo <= 180; lo += 1) for (let la = -60; la <= 85; la += 1) { const [px, py] = P0(lo, la), d = (px - x) ** 2 + (py - y) ** 2; if (d < bd) { bd = d; best = [lo, la]; } }
        let [lo, la] = best; for (let st2 = 0.5; st2 > 0.01; st2 /= 2) for (let it = 0; it < 4; it++) for (const [a, b] of [[st2, 0], [-st2, 0], [0, st2], [0, -st2]]) { const [px, py] = P0(lo + a, la + b), d = (px - x) ** 2 + (py - y) ** 2; if (d < bd) { bd = d; lo += a; la += b; } }
        return [la, lo]; } };
      ctx.fillStyle = 'rgba(80,120,170,.12)'; ctx.fillRect(0, top - 6, w, h - top + 6);
      // keep the map inside the world's edge (pieces that cross the date line are unwrapped past it)
      ctx.save(); ctx.beginPath();
      if (view === 'zoom' && !over) ctx.rect(0, top - 6, w, h - top + 6);
      else { for (let la = -60; la <= 85; la += 5) ctx.lineTo(...P(-180, la)); for (let la = 85; la >= -60; la -= 5) ctx.lineTo(...P(180, la)); ctx.closePath(); } // the world's curved outline
      ctx.clip();
      const glow = mode === 'find' ? (found != null ? find : null) : null;
      for (const c of world) {
        const isIt = mode === 'quiz' ? !over && c.name === C0[0] : c === glow;
        const wrong = mode === 'find' && found === false && c === tapped, picked = mode === 'explore' ? c === tapped : mode === 'quiz' && tapped === c;
        ctx.beginPath();
        c.polys.forEach((poly) => poly.forEach((rg) => {
          let prev = null;
          rg.forEach(([lo, la], i) => { if (prev != null) { while (lo - prev > 180) lo -= 360; while (prev - lo > 180) lo += 360; } prev = lo; const [x, y] = P(lo, la); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
          ctx.closePath();
        }));
        ctx.fillStyle = isIt ? C.gold : wrong ? C.red : picked ? C.blue : 'rgba(232,228,218,.22)'; ctx.fill('evenodd');
        ctx.strokeStyle = 'rgba(16,17,22,.8)'; ctx.lineWidth = 0.6; ctx.stroke();
      }
      ctx.restore();
      if (mode === 'quiz' && tapped && step < 2 && answered) { const [lx, ly] = tapAt || [w / 2, h - 12]; text(ctx, nice(tapped.name), lx, ly - 10, INK, 'center'); }
      if (pin && mode === 'quiz') {
        const [px, py] = P(pin[1], pin[0]), [tx, ty] = P(C0[4], C0[3]);
        line(ctx, [[px, py], [tx, ty]], INK, 1.5); dot(ctx, px, py, 6, C.red); dot(ctx, tx, ty, 6, C.green);
        text(ctx, `${C0[2]} · you were ${Math.round(pin.d)} km away (+${pin.pts})`, w / 2, h - 12, INK, 'center');
      }
    });
    // a tap: pin the capital (quiz), pick a country (find), or name it (explore). Dragging moves the
    // map and pinching or the mouse wheel zooms (in Find it and Explore).
    let tapAt = null, last = null, moved = false;
    const pts = new Map();
    function tap(p) {
      if (!proj || !world) return;
      const ll = proj.inv(p.x, p.y), c = countryAt(ll[1], ll[0]);
      if (mode === 'quiz') {
        if (over) return;
        if (step === 2 && !pin) { const C0 = rounds[k], d = haversine(ll, [C0[3], C0[4]]), pt = Math.max(0, Math.round(100 - d / 10)); pin = [ll[0], ll[1]]; pin.d = d; pin.pts = pt; points += pt; render(); return; }
        if (answered && c) { tapped = c; tapAt = [p.x, p.y]; cv.redraw(); } // after answering, tap other countries to learn them
        return;
      }
      if (!c) return;
      if (mode === 'explore') { tapped = c; render(); return; }
      if (mode === 'find' && find && found == null) { tapped = c; found = c === find; findScore[1]++; if (found) findScore[0]++; render(); }
    }
    drag(cv.c, {
      down(p, e) { pts.set(e.pointerId, p); last = p; moved = false; },
      move(p, e) {
        const before = pts.get(e.pointerId); pts.set(e.pointerId, p);
        if (mode === 'quiz') { if (Math.hypot(p.x - last.x, p.y - last.y) > 8) moved = true; return; }
        if (pts.size === 2) { const [a, b] = [...pts.values()], prev = [...pts.entries()].map(([id, q]) => (id === e.pointerId ? before : q)); const d0 = Math.hypot(prev[0].x - prev[1].x, prev[0].y - prev[1].y), d1 = Math.hypot(a.x - b.x, a.y - b.y); if (d0 > 0) zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d1 / d0); moved = true; return; }
        if (Math.hypot(p.x - last.x, p.y - last.y) > 6 || moved) { moved = true; vx += p.x - before.x; vy += p.y - before.y; cv.redraw(); }
      },
      up(p, e) { pts.delete(e.pointerId); if (!moved && !pts.size) tap(p); },
    });
    cv.c.addEventListener('pointercancel', (e) => pts.delete(e.pointerId));
    function zoomAt(x, y, f) {
      if (!proj) return;
      const k2 = Math.min(12, Math.max(1, vk * f)); f = k2 / vk;
      vx = (vx + proj.w / 2 - x) * f - proj.w / 2 + x; vy = (vy + proj.midY - y) * f - proj.midY + y; vk = k2;
      if (vk === 1) { vx = 0; vy = 0; }
      cv.redraw();
    }
    cv.c.addEventListener('wheel', (e) => { if (mode === 'quiz') return; e.preventDefault(); const p = at(cv.c, e); zoomAt(p.x, p.y, e.deltaY < 0 ? 1.2 : 1 / 1.2); }, { passive: false });
    const zoomBox = overlay(stage, 'br');
    button(zoomBox, '+', () => zoomAt(cv.w / 2, (proj ? proj.midY : cv.h / 2), 1.5)).setAttribute('aria-label', 'Zoom in');
    button(zoomBox, '−', () => zoomAt(cv.w / 2, (proj ? proj.midY : cv.h / 2), 1 / 1.5)).setAttribute('aria-label', 'Zoom out');
    button(zoomBox, 'Whole world', () => { vk = 1; vx = 0; vy = 0; cv.redraw(); });
    zoomBox.hidden = true;
    seg(group(panel, 'Mode'), { options: [['quiz', 'Today’s quiz'], ['find', 'Find it on the map'], ['explore', 'Explore the map']], value: mode, onChange: (v) => {
      mode = v; tapped = null; tapAt = null; zoomBox.hidden = mode === 'quiz'; vk = 1; vx = 0; vy = 0;
      if (mode === 'quiz') { make(); S.render(); } else { findScore = [0, 0]; nextFind(); }
    } });
    loadWorld().then((wd) => { world = wd; if (mode === 'find' && !find) nextFind(); cv.redraw(); }).catch(() => { qbox.innerHTML = '<p class="lab-err">The map couldn’t load — check your internet and open this puzzle again.</p>'; });
    make();
    return { state: () => (mode === 'find' ? `finding countries on the map: ${findScore[0]} of ${findScore[1]} found first time${find ? `; now looking for ${nice(find.name)}` : ''}` : mode === 'explore' ? `exploring the world map${tapped ? `; tapped ${nice(tapped.name)}` : ''}` : over ? `finished the geography quiz with ${points} points` : `geography round ${k + 1} of ${rounds.length}, ${points} points so far`), destroy: () => { S.destroy(); cv.destroy(); } };
  },
};

export const PUZZLES = [sudokuLab, nonogramLab, hashiLab, pipesLab, mirrorsLab, equationLab, geographyLab];
export { sudokuMake, logicSolvable, cluesOf, hashiMake, validEq, makeEquation, COUNTRIES }; // (for the tests)

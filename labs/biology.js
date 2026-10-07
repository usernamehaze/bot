/* Biology labs: Punnett squares for one gene or two, with peas you can see, and a field of
   offspring grown at random to compare with the square's prediction. */
import { INK, DIM, FAINT, C, el, esc, num, canvas, drag, group, seg, button, row, stats, dot, text, gcd, overlay } from './kit.js';

// Mendel's peas: the capital letter wins (dominant)
const GENES = {
  colour: { letter: 'Y', name: 'Seed colour', dom: 'yellow', rec: 'green', domC: '#f2cf4a', recC: '#86c25a' },
  shape: { letter: 'R', name: 'Seed shape', dom: 'round', rec: 'wrinkled' },
  flower: { letter: 'P', name: 'Flower colour', dom: 'purple', rec: 'white', domC: '#a77be0', recC: '#f1eee6' },
};
const GTYPES = (L) => [[L + L, `${L}${L}`], [L + L.toLowerCase(), `${L}${L.toLowerCase()}`], [L.toLowerCase() + L.toLowerCase(), `${L.toLowerCase()}${L.toLowerCase()}`]];
const sortPair = (a, b) => (a < b ? a + b : b + a); // "Yy", never "yY"
function gametes(geno) { // ["YyRr"] → ["YR", "Yr", "yR", "yr"]
  let out = [''];
  for (let i = 0; i < geno.length; i += 2) { const pair = [geno[i], geno[i + 1]]; out = out.flatMap((g) => pair.map((a) => g + a)); }
  return out;
}
function child(g1, g2) { let s = ''; for (let i = 0; i < g1.length; i++) s += sortPair(g1[i], g2[i]); return s; }

const punnettLab = {
  id: 'punnett', name: 'Punnett squares', subject: 'biology', topic: 'genetics: dominant and recessive alleles, genotypes, phenotypes and Punnett squares',
  blurb: 'Cross two pea plants, see every possible offspring, then grow a hundred for real.',
  words: 'genetics punnett square dominant recessive allele genotype phenotype mendel inheritance heredity',
  icon: '<rect x="8" y="8" width="32" height="32" rx="3"/><path d="M24 8v32M8 24h32"/><circle cx="16" cy="16" r="3"/><circle cx="32" cy="16" r="3"/><circle cx="16" cy="32" r="3"/><circle cx="32" cy="32" r="2" />',
  tries: ['Find a cross that gives 3 : 1', 'Find the cross that gives 9 : 3 : 3 : 1', 'Make every offspring look the same'],
  hints: ['One gene: make both parents heterozygous (one capital and one small letter each).', 'Two genes: make both parents heterozygous for both genes.', 'Cross a parent with two capital letters with any other parent — every child gets at least one dominant allele.'],
  about: 'Follows Mendel’s laws. Each parent passes on one of its two alleles at random (segregation), and for two genes the alleles are inherited independently (true for genes on different chromosomes, like Mendel’s seed colour and seed shape in peas).\nCapital letters are dominant: Yy looks yellow. The square shows the probabilities; “Grow 100 offspring” picks each child at random, so real counts wobble around the prediction.\nMany human traits (like eye colour) depend on several genes, so they are not used here. Tap any box of the square to see which egg and pollen made it.',
  mount({ stage, panel, api }) {
    let two = false, gene = 'colour', p1 = 'Yy', p2 = 'Yy', p1b = 'Rr', p2b = 'Rr', field = null;
    const genes = () => (two ? ['colour', 'shape'] : [gene]);
    const g1 = () => (two ? p1 + p1b : p1), g2 = () => (two ? p2 + p2b : p2);
    const looks = (geno) => genes().map((k, i) => (geno[2 * i] === geno[2 * i].toUpperCase() ? GENES[k].dom : GENES[k].rec));
    function cross() {
      const a = gametes(g1()), b = gametes(g2()), cells = a.map((x) => b.map((y) => child(x, y)));
      const geno = {}, pheno = {};
      cells.flat().forEach((c) => { geno[c] = (geno[c] || 0) + 1; const p = looks(c).join(', '); pheno[p] = (pheno[p] || 0) + 1; });
      return { a, b, cells, geno, pheno, total: a.length * b.length };
    }
    const ratio = (obj) => { const v = Object.values(obj).sort((x, y) => y - x), g = v.reduce((x, y) => gcd(x, y)); return v.map((x) => x / g).join(' : '); };
    function pea(ctx, x, y, r, geno) {
      const [first, second] = looks(geno), k = genes();
      const col = k[0] === 'colour' ? (first === 'yellow' ? GENES.colour.domC : GENES.colour.recC) : k[0] === 'flower' ? (first === 'purple' ? GENES.flower.domC : GENES.flower.recC) : '#e8d7a8';
      const wrinkled = (k[0] === 'shape' && first === 'wrinkled') || (k[1] === 'shape' && second === 'wrinkled');
      ctx.fillStyle = col; ctx.beginPath();
      for (let i = 0; i <= 40; i++) { const a = (i / 40) * Math.PI * 2, rr = r * (wrinkled ? 0.86 + 0.14 * Math.sin(a * 7) : 1); ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.beginPath(); ctx.arc(x - r * 0.35, y - r * 0.35, r * 0.25, 0, Math.PI * 2); ctx.fill();
    }
    const cv = canvas(stage, (ctx, w, h) => {
      const X = cross(), n = X.a.length, m = X.b.length;
      const fieldH = field ? 110 : 0, size = Math.min((w - 90) / (m + 1), (h - 40 - fieldH) / (n + 1), 120), ox = (w - size * (m + 1)) / 2, oy = 20;
      // parents' egg/pollen cells along the edges
      text(ctx, `${g2()}`, ox + size * (m + 1) / 2 + size / 2, oy - 4, DIM, 'center');
      X.b.forEach((g, j) => text(ctx, g, ox + size * (j + 1.5), oy + size * 0.6, INK, 'center', 'middle'));
      X.a.forEach((g, i) => text(ctx, g, ox + size * 0.5, oy + size * (i + 1.5), INK, 'center', 'middle'));
      geo = { ox, oy, size, n, m };
      X.cells.forEach((rowC, i) => rowC.forEach((c, j) => {
        const x = ox + size * (j + 1), y = oy + size * (i + 1);
        if (picked && picked[0] === i && picked[1] === j) { ctx.fillStyle = 'rgba(255,255,255,.1)'; ctx.fillRect(x, y, size, size); }
        ctx.strokeStyle = picked && picked[0] === i && picked[1] === j ? INK : FAINT; ctx.lineWidth = 1; ctx.strokeRect(x, y, size, size);
        pea(ctx, x + size / 2, y + size * 0.42, size * 0.22, c);
        text(ctx, c, x + size / 2, y + size * 0.85, INK, 'center', 'middle');
      }));
      if (field) {
        const fy = h - fieldH + 10, per = Math.floor((w - 40) / 12);
        field.list.forEach((c, k) => pea(ctx, 26 + (k % per) * 12, fy + Math.floor(k / per) * 12, 4.5, c));
      }
    });
    // tap a box: which egg and which pollen made this child
    let geo = null, picked = null;
    const why = el('p', 'lab-note'); why.hidden = true;
    cv.c.addEventListener('click', (e) => {
      if (!geo) return;
      const r0 = cv.c.getBoundingClientRect(), j = Math.floor((e.clientX - r0.left - geo.ox) / geo.size) - 1, i = Math.floor((e.clientY - r0.top - geo.oy) / geo.size) - 1;
      if (i < 0 || j < 0 || i >= geo.n || j >= geo.m) { picked = null; why.hidden = true; cv.redraw(); return; }
      const X = cross(), c = X.cells[i][j];
      picked = [i, j];
      why.hidden = false;
      why.textContent = `This box: ${X.a[i]} from parent 1 + ${X.b[j]} from parent 2 → ${c}, which looks ${looks(c).join(' and ')}. Each box has a 1 in ${X.total} chance.`;
      cv.redraw();
    });
    cv.c.style.cursor = 'pointer';
    function grow() {
      const X = cross(), all = X.cells.flat(), list = [];
      for (let k = 0; k < 100; k++) list.push(all[Math.floor(Math.random() * all.length)]);
      const seen = {}; list.forEach((c) => { const p = looks(c).join(', '); seen[p] = (seen[p] || 0) + 1; });
      field = { list, seen };
      report();
    }
    function report() {
      picked = null; why.hidden = true;
      const X = cross();
      const list = [['Genotypes', Object.entries(X.geno).map(([k, v]) => `${k} ${v}/${X.total}`).join(' · ')], ['Looks', Object.entries(X.pheno).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${num((v / X.total) * 100)}%`).join(' · ')], ['Ratio', ratio(X.pheno)]];
      if (field) list.push(['100 grown', Object.entries(field.seen).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ')]);
      st.set(list);
      const r = ratio(X.pheno);
      if (!two && r === '3 : 1') api.check(0);
      if (two && r === '9 : 3 : 3 : 1') api.check(1);
      if (Object.keys(X.pheno).length === 1) api.check(2);
      cv.redraw();
    }
    const box = el('div');
    seg(group(panel, 'Genes'), { options: [[false, 'One gene'], [true, 'Two genes']], value: two, onChange: (v) => { two = v; field = null; build(); report(); } });
    panel.appendChild(box);
    function build() {
      box.replaceChildren();
      if (!two) {
        seg(group(box, 'Trait'), { options: Object.entries(GENES).map(([k, g]) => [k, g.name]), value: gene, onChange: (v) => {
          // keep the same crosses, with the new trait's letter
          const L = GENES[v].letter, swap = (g) => [...g].map((ch) => (ch === ch.toUpperCase() ? L : L.toLowerCase())).join('');
          gene = v; p1 = swap(p1); p2 = swap(p2);
          field = null; build(); report();
        } });
      }
      const L = GENES[two ? 'colour' : gene].letter;
      const mk = (title, val, set, LL = L) => seg(group(box, title), { options: GTYPES(LL), value: val, onChange: (v) => { set(v); field = null; report(); } });
      mk(two ? `Parent 1 — ${GENES.colour.name.toLowerCase()}` : 'Parent 1', p1, (v) => { p1 = v; });
      if (two) mk(`Parent 1 — ${GENES.shape.name.toLowerCase()}`, p1b, (v) => { p1b = v; }, 'R');
      mk(two ? `Parent 2 — ${GENES.colour.name.toLowerCase()}` : 'Parent 2', p2, (v) => { p2 = v; });
      if (two) mk(`Parent 2 — ${GENES.shape.name.toLowerCase()}`, p2b, (v) => { p2b = v; }, 'R');
      const g = GENES[two ? 'colour' : gene];
      box.appendChild(el('p', 'lab-note', two ? 'Y = yellow beats y = green. R = round beats r = wrinkled.' : `${g.letter} = ${g.dom} beats ${g.letter.toLowerCase()} = ${g.rec}.`));
    }
    build();
    button(row(panel, 'lab-row-btns'), 'Grow 100 offspring', grow, 'main');
    panel.appendChild(why);
    const st = stats(panel);
    report();
    return {
      state: () => { const X = cross(); return `crossing ${g1()} × ${g2()} (${genes().map((k) => `${GENES[k].letter} = ${GENES[k].dom}, ${GENES[k].letter.toLowerCase()} = ${GENES[k].rec}`).join('; ')}): the Punnett square gives ${Object.entries(X.pheno).map(([k, v]) => `${v}/${X.total} ${k}`).join(', ')} — ratio ${ratio(X.pheno)}${field ? `; growing 100 gave ${Object.entries(field.seen).map(([k, v]) => `${v} ${k}`).join(', ')}` : ''}`; },
      destroy: () => cv.destroy(),
    };
  },
};

/* ---------------- Build a cell ---------------- */
// where each organelle belongs: in both kinds of cell, only plants, or (typically) only animals
const PARTS = {
  nucleus: ['Nucleus', 'both', 'Holds the DNA — the instructions for the cell — and controls what the cell does.'],
  mito: ['Mitochondrion', 'both', 'Releases energy from glucose by respiration. Plant cells have them too!'],
  ribo: ['Ribosomes', 'both', 'Tiny factories that build proteins.'],
  er: ['Rough ER', 'both', 'A folded network covered in ribosomes; it carries proteins through the cell.'],
  golgi: ['Golgi apparatus', 'both', 'Packs proteins into little bags and sends them where they are needed.'],
  chloro: ['Chloroplast', 'plant', 'Makes food (glucose) by photosynthesis, using energy from light.'],
  vacuole: ['Large vacuole', 'plant', 'A big sac of cell sap that keeps the plant cell firm.'],
  wall: ['Cell wall', 'plant', 'A strong cellulose layer outside the membrane that supports the plant cell.'],
  lyso: ['Lysosome', 'animal', 'Breaks down waste and worn-out parts. Plant cells mostly use their vacuole for this.'],
  centri: ['Centrioles', 'animal', 'Help pull the chromosomes apart when an animal cell divides. Most plant cells don’t have them.'],
};
const NEED = { animal: ['nucleus', 'mito', 'ribo', 'er', 'golgi'], plant: ['nucleus', 'mito', 'ribo', 'er', 'golgi', 'chloro', 'vacuole', 'wall'] };
function drawPart(ctx, k, x, y, s) {
  ctx.save(); ctx.translate(x, y);
  if (k === 'nucleus') { dot(ctx, 0, 0, s * 1.3, '#8a63d2'); dot(ctx, s * 0.3, -s * 0.2, s * 0.45, '#5e3fa8'); }
  else if (k === 'mito') { ctx.fillStyle = '#f08a4b'; ctx.beginPath(); ctx.ellipse(0, 0, s * 0.95, s * 0.45, 0.4, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = '#ffd29a'; ctx.lineWidth = 1.5; ctx.beginPath(); for (let i = -3; i <= 3; i++) ctx.lineTo(i * s * 0.2 * Math.cos(0.4), i * s * 0.2 * Math.sin(0.4) + (i % 2 ? s * 0.18 : -s * 0.18)); ctx.stroke(); }
  else if (k === 'ribo') { for (let i = 0; i < 7; i++) dot(ctx, Math.cos(i * 2.4) * s * 0.5, Math.sin(i * 2.4) * s * 0.5, s * 0.12, '#3a3a40'); }
  else if (k === 'er') { ctx.strokeStyle = '#5fa8e8'; ctx.lineWidth = s * 0.16; for (let j = 0; j < 3; j++) { ctx.beginPath(); for (let i = 0; i <= 12; i++) ctx.lineTo(-s + (i / 12) * 2 * s, j * s * 0.35 - s * 0.35 + Math.sin(i) * s * 0.12); ctx.stroke(); } for (let i = 0; i < 8; i++) dot(ctx, -s + i * s * 0.28, -s * 0.5, s * 0.07, '#3a3a40'); }
  else if (k === 'golgi') { ctx.strokeStyle = '#e8c55a'; ctx.lineWidth = s * 0.18; for (let j = 0; j < 4; j++) { ctx.beginPath(); ctx.arc(0, s * 1.4, s * (1.1 + j * 0.25), -Math.PI * 0.75, -Math.PI * 0.25); ctx.stroke(); } }
  else if (k === 'chloro') { ctx.fillStyle = '#46a659'; ctx.beginPath(); ctx.ellipse(0, 0, s * 1.05, s * 0.55, -0.3, 0, Math.PI * 2); ctx.fill(); for (let i = -2; i <= 2; i++) { ctx.fillStyle = '#2d7a3c'; ctx.fillRect(i * s * 0.35 - s * 0.1, -s * 0.2, s * 0.2, s * 0.4); } }
  else if (k === 'vacuole') { ctx.fillStyle = 'rgba(150,200,255,.45)'; ctx.strokeStyle = '#7fb2ff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.roundRect(-s * 2.4, -s * 1.5, s * 4.8, s * 3, s); ctx.fill(); ctx.stroke(); }
  else if (k === 'lyso') { dot(ctx, 0, 0, s * 0.5, '#d65a6c'); dot(ctx, -s * 0.15, -s * 0.15, s * 0.15, '#ffb3bd'); }
  else if (k === 'centri') { ctx.fillStyle = '#9aa0aa'; ctx.fillRect(-s * 0.7, -s * 0.2, s * 0.8, s * 0.35); ctx.save(); ctx.rotate(Math.PI / 2); ctx.fillRect(-s * 0.4, -s * 0.5, s * 0.8, s * 0.35); ctx.restore(); }
  ctx.restore();
}
const cellLab = {
  id: 'build-cell', name: 'Build a cell', subject: 'biology', topic: 'animal and plant cells: organelles and what they do',
  blurb: 'Put the right organelles into an animal cell or a plant cell, then let Cassie check your cell.',
  words: 'cell organelles nucleus mitochondria chloroplast vacuole cell wall ribosome animal plant biology build',
  icon: '<rect x="6" y="8" width="36" height="32" rx="6"/><circle cx="20" cy="22" r="6"/><ellipse cx="32" cy="30" rx="5" ry="3"/><path d="M30 14h6"/>',
  tries: ['Build a correct animal cell', 'Build a correct plant cell', 'Tap the organelle that makes food in a plant cell'],
  hints: ['An animal cell needs a nucleus, mitochondria, ribosomes, rough ER and a Golgi apparatus — and none of the plant-only parts.', 'A plant cell has everything an animal cell has, plus chloroplasts, a large vacuole and a cell wall.', 'Food (glucose) is made by photosynthesis. Add it to a plant cell, then tap it.'],
  about: 'These are simplified diagrams of typical cells, the way most textbooks draw them; real cells are 3D and packed far more tightly.\nTypical animal cells: nucleus, cytoplasm, cell membrane, mitochondria, ribosomes, rough ER, Golgi apparatus, lysosomes and centrioles. Typical plant cells have the same (lysosomes and centrioles are rare or absent) plus a cellulose cell wall, a large permanent vacuole and chloroplasts.\nThere are exceptions: plant root cells have no chloroplasts (no light underground), and red blood cells have no nucleus.\nThe membrane and cytoplasm are already drawn. Drag a part to move it; drag it outside the cell to take it out.',
  mount({ stage, panel, api }) {
    let kind = 'animal', items = [], cell = null, held = null, moved = false, start = null, nextId = 1;
    const add = (k) => {
      if (k === 'wall') { if (!items.some((i) => i.k === 'wall')) items.push({ id: nextId++, k: 'wall', x: 0, y: 0 }); report(); return; }
      if (!cell) return;
      for (let t = 0; t < 40; t++) {
        const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 0.72, x = cell.cx + Math.cos(a) * cell.rx * r, y = cell.cy + Math.sin(a) * cell.ry * r;
        if (k === 'vacuole' || !items.some((i) => Math.hypot(i.x - x, i.y - y) < cell.s * 2)) { items.push({ id: nextId++, k, x, y }); break; }
      }
      report();
    };
    const cv = canvas(stage, (ctx, w, h) => {
      // (on a phone the parts' buttons sit along the top, so the cell moves down)
      const narrow = w < 760, rx = Math.min(w * (narrow ? 0.42 : 0.36), 300), ry = Math.min(h * (narrow ? 0.3 : 0.36), 230), cx = w * (narrow ? 0.5 : 0.45), cy = h * (narrow ? 0.63 : 0.47), s = Math.max(10, Math.min(rx, ry) / 9);
      cell = { cx, cy, rx, ry, s };
      if (items.some((i) => i.k === 'wall')) { ctx.strokeStyle = '#7a9a4a'; ctx.lineWidth = s * 0.7; ctx.beginPath(); ctx.roundRect(cx - rx - s * 0.8, cy - ry - s * 0.8, 2 * rx + s * 1.6, 2 * ry + s * 1.6, kind === 'plant' ? s : ry); ctx.stroke(); }
      ctx.fillStyle = 'rgba(255,240,220,.08)'; ctx.strokeStyle = '#e8dcc8'; ctx.lineWidth = 2.5; ctx.beginPath();
      if (kind === 'plant') ctx.roundRect(cx - rx, cy - ry, 2 * rx, 2 * ry, s * 0.6); else ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      text(ctx, 'cell membrane', cx + rx * 0.62, cy - ry - 6, DIM);
      items.filter((i) => i.k === 'vacuole').forEach((i) => drawPart(ctx, i.k, i.x, i.y, s));
      items.filter((i) => i.k !== 'vacuole' && i.k !== 'wall').forEach((i) => drawPart(ctx, i.k, i.x, i.y, s));
      if (picked) { const i = items.find((q) => q.id === picked); if (i && i.k !== 'wall') { ctx.strokeStyle = INK; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(i.x, i.y, s * 1.8, 0, Math.PI * 2); ctx.stroke(); } }
      if (!items.length) text(ctx, 'Tap a “+” button to add that part', cx, cy, DIM, 'center');
    });
    let picked = null;
    const hitAt = (p) => items.filter((i) => i.k !== 'wall').slice().reverse().find((i) => Math.hypot(p.x - i.x, p.y - i.y) < (i.k === 'vacuole' ? cell.s * 2.2 : cell.s * 1.4));
    drag(cv.c, {
      down(p) { held = hitAt(p) || null; moved = false; start = p; },
      move(p) { if (!held) return; if (Math.hypot(p.x - start.x, p.y - start.y) > 5) moved = true; if (moved) { held.x = p.x; held.y = p.y; cv.redraw(); } },
      up(p) {
        if (held) {
          const outside = ((held.x - cell.cx) / cell.rx) ** 2 + ((held.y - cell.cy) / cell.ry) ** 2 > 1.15;
          if (moved && outside) { items = items.filter((i) => i !== held); info.textContent = `${PARTS[held.k][0]} taken out.`; }
          else if (!moved) { picked = held.id; info.textContent = `${PARTS[held.k][0]}: ${PARTS[held.k][2]}`; if (held.k === 'chloro' && kind === 'plant') api.check(2); }
          held = null; report();
          return;
        }
        // a tap on the wall
        if (cell && items.some((i) => i.k === 'wall')) { const d = ((p.x - cell.cx) / cell.rx) ** 2 + ((p.y - cell.cy) / cell.ry) ** 2; if (d > 1 && d < 1.4) info.textContent = `Cell wall: ${PARTS.wall[2]}`; }
      },
    });
    const pal = overlay(stage, 'tl');
    pal.classList.add('lab-palette');
    Object.entries(PARTS).forEach(([k, [n]]) => button(pal, '+ ' + n, () => add(k)));
    seg(group(panel, 'Cell'), { options: [['animal', 'Animal cell'], ['plant', 'Plant cell']], value: kind, onChange: (v) => { kind = v; verdict.innerHTML = ''; report(); } });
    const r1 = row(panel, 'lab-row-btns');
    button(r1, 'Check my cell', check, 'main');
    button(r1, 'Empty the cell', () => { items = []; picked = null; verdict.innerHTML = ''; report(); });
    const info = el('p', 'lab-note', 'Tap a part inside the cell to read what it does.');
    const verdict = el('div', 'lab-verdict-box');
    panel.append(info, verdict);
    function check() {
      const have = new Set(items.map((i) => i.k)), missing = NEED[kind].filter((k) => !have.has(k));
      const wrong = [...have].filter((k) => (kind === 'animal' ? PARTS[k][1] === 'plant' : PARTS[k][1] === 'animal'));
      const extra = kind === 'animal' ? ['lyso', 'centri'].filter((k) => !have.has(k)) : [];
      const ok = !missing.length && !wrong.length;
      verdict.innerHTML = `<p class="${ok ? 'ok' : ''}"><b>${ok ? `A correct ${kind} cell!` : 'Not quite yet.'}</b></p>`
        + (missing.length ? `<p>Missing: ${missing.map((k) => esc(PARTS[k][0])).join(', ')}.</p>` : '')
        + wrong.map((k) => `<p>✗ ${esc(PARTS[k][0])} — ${kind === 'animal' ? 'only plant cells have this' : 'plant cells don’t usually have this'}: ${esc(PARTS[k][2])}</p>`).join('')
        + (ok && extra.length ? `<p>To be complete, animal cells also usually have ${extra.map((k) => esc(PARTS[k][0].toLowerCase())).join(' and ')}.</p>` : '');
      if (ok) api.check(kind === 'animal' ? 0 : 1);
    }
    const st = stats(panel);
    function report() {
      const counts = {}; items.forEach((i) => { counts[i.k] = (counts[i.k] || 0) + 1; });
      st.set([['In your cell', Object.entries(counts).map(([k, n]) => `${PARTS[k][0]}${n > 1 ? ` × ${n}` : ''}`).join(', ') || 'only the membrane and cytoplasm']]);
      cv.redraw();
    }
    report();
    return { state: () => `building a ${kind} cell containing ${items.map((i) => PARTS[i.k][0]).join(', ') || 'nothing yet'}`, destroy: () => cv.destroy() };
  },
};

export const BIOLOGY = [punnettLab, cellLab];

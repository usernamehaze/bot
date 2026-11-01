/* Biology labs: Punnett squares for one gene or two, with peas you can see, and a field of
   offspring grown at random to compare with the square's prediction. */
import { INK, DIM, FAINT, C, el, esc, num, canvas, drag, group, seg, slider, button, row, stats, dot, text, gcd, overlay, clock, rng } from './kit.js';

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
// Pedigree (v226): a three-generation family. The couple I-1 and I-2 have a son (II-1) and a daughter (II-2); the son and
// his wife (II-3, who married in) have three children. Autosomal only: every genotype set is tried (3^8 of them).
export const PEDIGREE = [
  { id: 'I-1', sex: 'm', gen: 0, x: 0.35 }, { id: 'I-2', sex: 'f', gen: 0, x: 0.55 },
  { id: 'II-1', sex: 'm', gen: 1, x: 0.3, mom: 'I-2', dad: 'I-1' }, { id: 'II-2', sex: 'f', gen: 1, x: 0.6, mom: 'I-2', dad: 'I-1' }, { id: 'II-3', sex: 'f', gen: 1, x: 0.12 },
  { id: 'III-1', sex: 'm', gen: 2, x: 0.08, mom: 'II-3', dad: 'II-1' }, { id: 'III-2', sex: 'f', gen: 2, x: 0.24, mom: 'II-3', dad: 'II-1' }, { id: 'III-3', sex: 'm', gen: 2, x: 0.4, mom: 'II-3', dad: 'II-1' },
];
const GT = ['AA', 'Aa', 'aa'];
const shows = (g, mode) => (mode === 'dominant' ? g !== 'aa' : g === 'aa'); // (does this genotype show the trait?)
const canMake = (m, d, c) => [...m].some((x) => [...d].some((y) => sortPair(x, y) === c));
// every way the family's genotypes can fit what is shaded: null if none can
export function pedigreeFits(affected, mode) {
  const n = PEDIGREE.length, idx = Object.fromEntries(PEDIGREE.map((p, i) => [p.id, i])), seen = PEDIGREE.map(() => new Set());
  let any = false;
  const pick = new Array(n);
  (function go(i) {
    if (i === n) { any = true; pick.forEach((g, k) => seen[k].add(g)); return; }
    const p = PEDIGREE[i];
    for (const g of GT) {
      if (shows(g, mode) !== !!affected[p.id]) continue;
      if (p.mom && !canMake(pick[idx[p.mom]], pick[idx[p.dad]], g)) continue;
      pick[i] = g; go(i + 1);
    }
  })(0);
  return any ? Object.fromEntries(PEDIGREE.map((p, i) => [p.id, [...seen[i]].sort((a, b) => GT.indexOf(a) - GT.indexOf(b))])) : null;
}

const punnettLab = {
  id: 'punnett', name: 'Punnett squares', subject: 'biology', levels: ['hs', 'grad'], topic: 'genetics: dominant and recessive alleles, genotypes, phenotypes and Punnett squares',
  blurb: 'Cross two pea plants, see every possible offspring, then grow a hundred for real.',
  words: 'genetics punnett square dominant recessive allele genotype phenotype mendel inheritance heredity',
  icon: '<rect x="8" y="8" width="32" height="32" rx="3"/><path d="M24 8v32M8 24h32"/><circle cx="16" cy="16" r="3"/><circle cx="32" cy="16" r="3"/><circle cx="16" cy="32" r="3"/><circle cx="32" cy="32" r="2" />',
  tries: ['Find a cross that gives 3 : 1', 'Find the cross that gives 9 : 3 : 3 : 1', 'Make every offspring look the same', 'Pedigree: shade a family that only a recessive trait can explain', 'Pedigree: shade a family that only a dominant trait can explain'],
  hints: ['One gene: make both parents heterozygous (one capital and one small letter each).', 'Two genes: make both parents heterozygous for both genes.', 'Cross a parent with two capital letters with any other parent. Every child gets at least one dominant allele.', 'Choose Pedigree. Leave both parents in the second generation unshaded and shade one of their children.', 'Choose Pedigree. Shade both parents in the second generation and leave one of their children unshaded.'],
  about: 'Follows Mendel’s laws. Each parent passes on one of its two alleles at random (segregation), and for two genes the alleles are inherited independently (true for genes on different chromosomes, like Mendel’s seed colour and seed shape in peas).\nCapital letters are dominant: Yy looks yellow. The square shows the probabilities; “Grow 100 offspring” picks each child at random, so real counts wobble around the prediction.\nMany human traits (like eye colour) depend on several genes, so they are not used here. Tap any box of the square to see which egg and pollen made it.\nPedigree: squares are males, circles are females, shaded means affected. Cassie tries every set of genotypes (AA, Aa, aa) for the family and keeps the ones where each child got one allele from each parent and everyone shaded shows the trait. Autosomal traits only: it does not model X-linked traits, new mutations or traits that skip people (incomplete penetrance).',
  mount({ stage, panel: whole, api }) {
    // (v226: two modes: the Punnett square, and a family pedigree)
    const panel = el('div', 'lab-sq-panel'), pedPanel = el('div', 'lab-ped-panel');
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
      mk(two ? `Parent 1: ${GENES.colour.name.toLowerCase()}` : 'Parent 1', p1, (v) => { p1 = v; });
      if (two) mk(`Parent 1: ${GENES.shape.name.toLowerCase()}`, p1b, (v) => { p1b = v; }, 'R');
      mk(two ? `Parent 2: ${GENES.colour.name.toLowerCase()}` : 'Parent 2', p2, (v) => { p2 = v; });
      if (two) mk(`Parent 2: ${GENES.shape.name.toLowerCase()}`, p2b, (v) => { p2b = v; }, 'R');
      const g = GENES[two ? 'colour' : gene];
      box.appendChild(el('p', 'lab-note', two ? 'Y = yellow beats y = green. R = round beats r = wrinkled.' : `${g.letter} = ${g.dom} beats ${g.letter.toLowerCase()} = ${g.rec}.`));
    }
    build();
    button(row(panel, 'lab-row-btns'), 'Grow 100 offspring', grow, 'main');
    panel.appendChild(why);
    const st = stats(panel);
    report();
    // ---- the pedigree ----
    let showMode = 'square', pedMode = 'recessive';
    const affected = {}, pedAt = [];
    const pv = canvas(stage, (ctx, w, h) => {
      pedAt.length = 0;
      const fit = pedigreeFits(affected, pedMode), rows = [0.18, 0.5, 0.82].map((f) => h * f), s = Math.min(26, w / 22), X = (f) => 40 + f * (w - 80) / 0.7;
      const pos = Object.fromEntries(PEDIGREE.map((p) => [p.id, [X(p.x), rows[p.gen]]]));
      ctx.strokeStyle = DIM; ctx.lineWidth = 2;
      const couple = (a, b, kids) => { const [ax, ay] = pos[a], [bx] = pos[b], my = ay; ctx.beginPath(); ctx.moveTo(Math.min(ax, bx) + s, my); ctx.lineTo(Math.max(ax, bx) - s, my); ctx.stroke(); const cx = (ax + bx) / 2, ky = rows[PEDIGREE.find((p) => p.id === kids[0]).gen] - s - 14; ctx.beginPath(); ctx.moveTo(cx, my); ctx.lineTo(cx, ky); ctx.stroke(); const xs = kids.map((k) => pos[k][0]); ctx.beginPath(); ctx.moveTo(Math.min(...xs, cx), ky); ctx.lineTo(Math.max(...xs, cx), ky); ctx.stroke(); xs.forEach((x) => { ctx.beginPath(); ctx.moveTo(x, ky); ctx.lineTo(x, ky + 14); ctx.stroke(); }); };
      couple('I-1', 'I-2', ['II-1', 'II-2']); couple('II-1', 'II-3', ['III-1', 'III-2', 'III-3']);
      PEDIGREE.forEach((p) => {
        const [x, y] = pos[p.id];
        ctx.fillStyle = affected[p.id] ? INK : 'rgba(255,255,255,.05)'; ctx.strokeStyle = INK; ctx.lineWidth = 2.5; ctx.beginPath();
        if (p.sex === 'm') ctx.rect(x - s, y - s, 2 * s, 2 * s); else ctx.arc(x, y, s, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
        text(ctx, p.id, x, y + s + 16, DIM, 'center');
        if (fit) text(ctx, fit[p.id].join(' or '), x, y + s + 32, C.gold, 'center');
        pedAt.push({ id: p.id, x, y, s });
      });
      text(ctx, fit ? `Possible for a ${pedMode} trait` : `Not possible for a ${pedMode} trait`, 16, 22, fit ? C.green : C.red);
    });
    pv.c.hidden = true; pv.c.style.cursor = 'pointer';
    pv.c.addEventListener('click', (e) => {
      const r0 = pv.c.getBoundingClientRect(), x = e.clientX - r0.left, y = e.clientY - r0.top, p = pedAt.find((q) => Math.abs(q.x - x) <= q.s + 6 && Math.abs(q.y - y) <= q.s + 6);
      if (!p) return; affected[p.id] = !affected[p.id]; pedReport();
    });
    seg(group(pedPanel, 'The trait is'), { options: [['recessive', 'Recessive'], ['dominant', 'Dominant']], value: pedMode, onChange: (v) => { pedMode = v; pedReport(); } });
    const gWho = group(pedPanel, 'Who has the trait (tap to shade)'), rWho = row(gWho, 'lab-row-btns lab-ped-people'), whoBtns = {};
    PEDIGREE.forEach((p) => { const b = button(rWho, p.id, () => { affected[p.id] = !affected[p.id]; pedReport(); }); b.dataset.person = p.id; b.setAttribute('aria-label', `${p.id}, ${p.sex === 'm' ? 'male' : 'female'}`); whoBtns[p.id] = b; });
    pedPanel.appendChild(el('p', 'lab-note', 'Squares are males, circles are females, shaded means the person has the trait. II-3 married into the family.'));
    const pedSay = el('p', 'lab-note lab-ped-say'); pedSay.setAttribute('aria-live', 'polite'); pedPanel.appendChild(pedSay);
    const pst = stats(pedPanel);
    function pedReport() {
      const fit = pedigreeFits(affected, pedMode), other = pedigreeFits(affected, pedMode === 'dominant' ? 'recessive' : 'dominant');
      PEDIGREE.forEach((p) => whoBtns[p.id].setAttribute('aria-pressed', String(!!affected[p.id])));
      pedSay.textContent = fit ? `This family fits a ${pedMode} trait.${other ? '' : ` It could not be ${pedMode === 'dominant' ? 'recessive' : 'dominant'}.`}` : `No set of genotypes fits a ${pedMode} trait here. ${pedMode === 'dominant' ? 'With a dominant trait, an affected child needs at least one affected parent.' : 'With a recessive trait, two affected parents can only have affected children.'}`;
      pst.set([['Possible?', fit ? 'Yes' : 'No'], ['Shaded', PEDIGREE.filter((p) => affected[p.id]).map((p) => p.id).join(', ') || 'nobody'], ...(fit ? PEDIGREE.map((p) => [p.id, fit[p.id].join(' or ')]) : [])]);
      const any = PEDIGREE.some((p) => affected[p.id]), rec = pedigreeFits(affected, 'recessive'), dom = pedigreeFits(affected, 'dominant');
      if (any && rec && !dom) api.check(3);
      if (any && dom && !rec) api.check(4);
      pv.redraw();
    }
    seg(group(whole, 'Show'), { options: [['square', 'Punnett square'], ['pedigree', 'Pedigree']], value: showMode, onChange: (v) => { showMode = v; const ped = v === 'pedigree'; panel.hidden = ped; pedPanel.hidden = !ped; cv.c.hidden = ped; pv.c.hidden = !ped; if (ped) pedReport(); else cv.redraw(); } });
    whole.append(panel, pedPanel); pedPanel.hidden = true;
    return {
      state: () => { if (showMode === 'pedigree') { const fit = pedigreeFits(affected, pedMode); return `a family pedigree, ${pedMode} trait, shaded: ${PEDIGREE.filter((p) => affected[p.id]).map((p) => p.id).join(', ') || 'nobody'}; it is ${fit ? 'possible' : 'not possible'}${fit ? `; genotypes: ${PEDIGREE.map((p) => `${p.id} ${fit[p.id].join('/')}`).join(', ')}` : ''}`; } const X = cross(); return `crossing ${g1()} × ${g2()} (${genes().map((k) => `${GENES[k].letter} = ${GENES[k].dom}, ${GENES[k].letter.toLowerCase()} = ${GENES[k].rec}`).join('; ')}): the Punnett square gives ${Object.entries(X.pheno).map(([k, v]) => `${v}/${X.total} ${k}`).join(', ')}: ratio ${ratio(X.pheno)}${field ? `; growing 100 gave ${Object.entries(field.seen).map(([k, v]) => `${v} ${k}`).join(', ')}` : ''}`; },
      destroy: () => { cv.destroy(); pv.destroy(); },
    };
  },
};

/* ---------------- Build a cell ---------------- */
// where each organelle belongs: in both kinds of cell, only plants, or (typically) only animals
const PARTS = {
  nucleus: ['Nucleus', 'both', 'Holds the DNA, the instructions for the cell, and controls what the cell does.'],
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
  id: 'build-cell', name: 'Build a cell', subject: 'biology', levels: ['hs', 'grad'], topic: 'animal and plant cells: organelles and what they do',
  blurb: 'Put the right organelles into an animal cell or a plant cell, then let Cassie check your cell.',
  words: 'cell organelles nucleus mitochondria chloroplast vacuole cell wall ribosome animal plant biology build',
  icon: '<rect x="6" y="8" width="36" height="32" rx="6"/><circle cx="20" cy="22" r="6"/><ellipse cx="32" cy="30" rx="5" ry="3"/><path d="M30 14h6"/>',
  tries: ['Build a correct animal cell', 'Build a correct plant cell', 'Tap the organelle that makes food in a plant cell'],
  hints: ['An animal cell needs a nucleus, mitochondria, ribosomes, rough ER and a Golgi apparatus, and none of the plant-only parts.', 'A plant cell has everything an animal cell has, plus chloroplasts, a large vacuole and a cell wall.', 'Food (glucose) is made by photosynthesis. Add it to a plant cell, then tap it.'],
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
        + wrong.map((k) => `<p>✗ ${esc(PARTS[k][0])} - ${kind === 'animal' ? 'only plant cells have this' : 'plant cells don’t usually have this'}: ${esc(PARTS[k][2])}</p>`).join('')
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

/* ---------------- v221: four more Biology labs ---------------- */
// (Reduce Motion or Lite mode: a run of seasons or generations happens at once, with no stepping animation)
const calm = () => document.documentElement.classList.contains('lite') || !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
// a plain chart frame: axes, a title on the x axis, ticks at both ends
function frame(ctx, x, y, w, h, xLabel, yLabel) {
  ctx.strokeStyle = FAINT; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + h); ctx.lineTo(x + w, y + h); ctx.stroke();
  text(ctx, xLabel, x + w / 2, y + h + 18, DIM, 'center');
  ctx.save(); ctx.translate(x - 30, y + h / 2); ctx.rotate(-Math.PI / 2); text(ctx, yLabel, 0, 0, DIM, 'center'); ctx.restore();
}

/* ---------------- Photosynthesis and respiration ---------------- */
// gross photosynthesis (oxygen made) rises with light and CO2 and levels off (each one a saturating curve),
// and is fastest near 25 °C (enzymes); respiration runs all the time and speeds up with warmth until its enzymes break down
const PS = { pmax: 24, kL: 15, kC: 0.03, r0: 2.2 };
const psTemp = (T) => (T <= 0 || T >= 48 ? 0 : Math.exp(-(((T - 25) / (T < 25 ? 13 : 8)) ** 2)));
const rsTemp = (T) => (T <= 40 ? 2 ** ((T - 20) / 10) : 4 * Math.max(0, (55 - T) / 15));
const psGross = (L, C, T) => PS.pmax * (L / (L + PS.kL)) * (C / (C + PS.kC)) * psTemp(T);
const psResp = (T) => PS.r0 * rsTemp(T);
const photoLab = {
  id: 'photo-resp', name: 'Photosynthesis and respiration', subject: 'biology', levels: ['hs', 'college'], topic: 'photosynthesis and cellular respiration: limiting factors (light, carbon dioxide, temperature), oxygen and ATP',
  blurb: 'Change the light, the carbon dioxide and the warmth, and watch a leaf’s oxygen and ATP go up and down.',
  words: 'photosynthesis respiration cellular respiration chloroplast mitochondria oxygen carbon dioxide co2 atp glucose light limiting factor enzyme temperature leaf plant energy',
  icon: '<path d="M10 38c0-16 10-28 28-30 0 18-12 28-28 30z"/><path d="M10 38l16-16"/><circle cx="36" cy="36" r="2"/><circle cx="40" cy="30" r="1.5"/>',
  tries: ['Find the light where more light barely helps', 'Give it more carbon dioxide so the level-off rises', 'Make the leaf use more oxygen than it makes'],
  hints: ['Slide the light up. Watch the oxygen curve: past a point it flattens, because something else (carbon dioxide or warmth) is now the limit.', 'Put the light high, then raise carbon dioxide above 0.1%. The whole curve, and its flat top, goes up.', 'Respiration never stops. Turn the light down low (or make it far too hot) so photosynthesis makes less oxygen than respiration uses.'],
  about: 'A leaf does two things at once. Photosynthesis (in the chloroplasts) uses light, carbon dioxide and water to make glucose and gives off oxygen. Respiration (in the mitochondria) uses glucose and oxygen to make ATP, day and night.\nPhotosynthesis is limited by whichever factor is in shortest supply (light, carbon dioxide or temperature), so each curve rises and then levels off. Its enzymes work best near 25 °C and stop as they break down above about 45 °C. Respiration speeds up with warmth (roughly doubling every 10 °C) until about 40 °C.\nThe rates are illustrative numbers in made-up units, chosen to show the shape of each trend, not measured from a real leaf. ATP uses textbook ratios: about 3 ATP used in the Calvin cycle for each oxygen made, and about 5 ATP made in respiration for each oxygen used (about 30 per glucose).',
  mount({ stage, panel, api }) {
    let L = 50, co2 = 0.04, T = 25;
    const now = () => { const g = psGross(L, co2, T), r = psResp(T); return { g, r, net: g - r }; };
    const cv = canvas(stage, (ctx, w, h) => {
      const x = 56, y = 30, W = w - x - 24, H = h - y - 56, top = Math.max(10, psGross(100, 0.15, 25) * 1.08), bot = -10;
      const Y = (v) => y + H * (1 - (v - bot) / (top - bot)), X = (l) => x + (l / 100) * W;
      frame(ctx, x, y, W, H, 'Light (percent of full sun)', 'Oxygen per minute');
      ctx.strokeStyle = FAINT; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(x, Y(0)); ctx.lineTo(x + W, Y(0)); ctx.stroke(); ctx.setLineDash([]);
      text(ctx, '0', x - 6, Y(0) + 4, DIM, 'right');
      const curve = (f, col, wd, dash) => { ctx.strokeStyle = col; ctx.lineWidth = wd; ctx.setLineDash(dash || []); ctx.beginPath(); for (let l = 0; l <= 100; l += 2) { const v = f(l); l ? ctx.lineTo(X(l), Y(v)) : ctx.moveTo(X(l), Y(v)); } ctx.stroke(); ctx.setLineDash([]); };
      curve((l) => psGross(l, co2, T), C.green, 2.5);
      curve(() => psResp(T), C.red, 2, [6, 5]);
      curve((l) => psGross(l, co2, T) - psResp(T), INK, 2);
      const n = now();
      dot(ctx, X(L), Y(n.net), 6, INK); dot(ctx, X(L), Y(n.g), 5, C.green);
      text(ctx, 'oxygen made (photosynthesis)', x + W - 4, Y(psGross(100, co2, T)) - 8, C.green, 'right');
      text(ctx, 'given off (made minus used)', x + W - 4, Y(psGross(100, co2, T) - psResp(T)) + 34, INK, 'right');
      text(ctx, 'oxygen used (respiration)', x + W - 4, Y(psResp(T)) + 16, C.red, 'right');
    });
    const g = group(panel, 'What the leaf gets');
    slider(g, { label: 'Light', min: 0, max: 100, value: L, fmt: (v) => `${num(v)}%`, onInput: (v) => { L = v; report(); } });
    slider(g, { label: 'Carbon dioxide', min: 0.01, max: 0.15, step: 0.01, value: co2, fmt: (v) => `${v.toFixed(2)}%`, onInput: (v) => { co2 = v; report(); } });
    slider(g, { label: 'Temperature', min: 0, max: 50, value: T, fmt: (v) => `${num(v)} °C`, onInput: (v) => { T = v; report(); } });
    panel.appendChild(el('p', 'lab-note', 'Air has about 0.04% carbon dioxide. Greenhouses often add more.'));
    const st = stats(panel);
    function report() {
      const n = now();
      st.set([['Oxygen made', num(n.g)], ['Oxygen used', num(n.r)], ['Oxygen given off', num(n.net)], ['ATP for the Calvin cycle', num(n.g * 3)], ['ATP from respiration', num(n.r * 5)], ['Glucose made', num(n.g / 6)]]);
      if (L >= 60 && n.g > 1) api.check(0);
      if (co2 >= 0.1 && L >= 60 && T >= 15 && T <= 35) api.check(1);
      if (n.net < 0) api.check(2);
      cv.redraw();
    }
    report();
    return {
      state: () => { const n = now(); return `light ${num(L)}% of full sun, carbon dioxide ${co2.toFixed(2)}%, ${num(T)} °C: photosynthesis makes ${num(n.g)} units of oxygen a minute, respiration uses ${num(n.r)}, so the leaf gives off ${num(n.net)} (illustrative units)`; },
      destroy: () => cv.destroy(),
    };
  },
};

/* ---------------- DNA to protein ---------------- */
// the standard genetic code (first base U, C, A, G; then the second; then the third)
const CODE = 'FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG', NT = 'UCAG';
const AA3 = { F: 'Phe', L: 'Leu', S: 'Ser', Y: 'Tyr', C: 'Cys', W: 'Trp', P: 'Pro', H: 'His', Q: 'Gln', R: 'Arg', I: 'Ile', M: 'Met', T: 'Thr', N: 'Asn', K: 'Lys', V: 'Val', A: 'Ala', D: 'Asp', E: 'Glu', G: 'Gly' };
export const codonOf = (c) => CODE[NT.indexOf(c[0]) * 16 + NT.indexOf(c[1]) * 4 + NT.indexOf(c[2])]; // ('*' = stop)
const RNA_OF = { A: 'U', T: 'A', C: 'G', G: 'C' }; // template DNA base → the RNA base that pairs with it
const DNA_OF = { U: 'A', A: 'T', G: 'C', C: 'G' }; // RNA base → the template base it was copied from
const GENES_DNA = [ // (written as the mRNA they make; the template strand is worked out from it)
  ['Gene 1', 'AUGGCUAAAUGGUAA'],
  ['Gene 2', 'AUGUUUGGCCAUGAAUGA'],
  ['Gene 3', 'AUGAAAUAGGGGCCC'],
];
const dnaLab = {
  id: 'dna-protein', name: 'DNA to protein', subject: 'biology', levels: ['hs', 'college'], topic: 'protein synthesis: transcription of DNA into mRNA, base pairing, codons, the genetic code and translation into amino acids',
  blurb: 'Copy a gene into mRNA one base at a time, then read its codons into a protein.',
  words: 'dna rna mrna transcription translation codon anticodon amino acid protein synthesis base pairing adenine uracil thymine guanine cytosine ribosome genetic code start stop',
  icon: '<path d="M14 6c0 12 20 12 20 24s-20 12-20 12"/><path d="M34 6c0 12-20 12-20 24s20 12 20 12"/><path d="M17 12h14M15 24h18M17 36h14"/>',
  tries: ['Copy the whole gene into mRNA', 'Translate it all the way to the stop codon', 'Find the gene that stops early'],
  hints: ['Tap the RNA base that pairs with each template base: A pairs with U, T with A, C with G and G with C.', 'Tap “Read the next codon” until the ribosome reaches UAA, UAG or UGA.', 'Try Gene 3. Look for a stop codon before the end of the mRNA.'],
  about: 'Transcription: RNA polymerase reads the template strand of DNA and builds mRNA that pairs with it. RNA has uracil (U) instead of thymine (T), so A pairs with U, T with A, C with G and G with C. The mRNA is built from its 5′ end to its 3′ end, opposite to the template.\nTranslation: a ribosome reads the mRNA three bases (one codon) at a time from the start codon AUG (methionine), adding one amino acid per codon from the standard genetic code, until it reaches a stop codon (UAA, UAG or UGA).\nReal genes are hundreds of codons long, and in plants and animals the mRNA is processed (introns cut out) before it leaves the nucleus. These short genes leave that out.',
  mount({ stage, panel, api }) {
    let gi = 0, built = '', read = 0, mistakes = 0, stopped = false;
    const mrna = () => GENES_DNA[gi][1], template = () => [...mrna()].map((b) => DNA_OF[b]).join('');
    const protein = () => { const out = []; for (let i = 0; i < read; i++) { const a = codonOf(built.slice(i * 3, i * 3 + 3)); if (a === '*') break; out.push(AA3[a]); } return out; };
    const cv = canvas(stage, (ctx, w, h) => {
      const t = template(), n = t.length, cw = Math.min(40, (w - 64) / n), x0 = (w - cw * n) / 2, yT = h * 0.24, yM = h * 0.44, yP = h * 0.72;
      text(ctx, 'DNA template strand', x0, yT - 26, DIM); text(ctx, '3′', x0 - 16, yT + 5, DIM, 'center'); text(ctx, '5′', x0 + cw * n + 14, yT + 5, DIM, 'center');
      text(ctx, 'mRNA', x0, yM - 26, DIM); text(ctx, '5′', x0 - 16, yM + 5, DIM, 'center'); text(ctx, '3′', x0 + cw * n + 14, yM + 5, DIM, 'center');
      const col = { A: C.green, T: C.red, U: C.red, G: C.gold, C: C.blue };
      [...t].forEach((b, i) => {
        const x = x0 + cw * i + cw / 2;
        ctx.fillStyle = 'rgba(255,255,255,.06)'; ctx.fillRect(x - cw / 2 + 2, yT - 14, cw - 4, 28);
        text(ctx, b, x, yT + 5, col[b], 'center');
        if (i < built.length) { ctx.strokeStyle = FAINT; ctx.beginPath(); ctx.moveTo(x, yT + 16); ctx.lineTo(x, yM - 16); ctx.stroke(); text(ctx, built[i], x, yM + 5, col[built[i]], 'center'); }
        else if (i === built.length) { ctx.strokeStyle = INK; ctx.lineWidth = 2; ctx.strokeRect(x - cw / 2 + 2, yM - 14, cw - 4, 28); ctx.lineWidth = 1; }
      });
      // codons: brackets under the mRNA; the ones read so far, and the ribosome on the next
      for (let k = 0; k * 3 < n; k++) {
        const x = x0 + cw * k * 3 + 3, wd = cw * 3 - 6;
        ctx.strokeStyle = k < read ? C.violet : FAINT; ctx.beginPath(); ctx.moveTo(x, yM + 18); ctx.lineTo(x, yM + 24); ctx.lineTo(x + wd, yM + 24); ctx.lineTo(x + wd, yM + 18); ctx.stroke();
        if (built.length === n && k === read && !stopped) { ctx.fillStyle = 'rgba(196,160,255,.18)'; ctx.beginPath(); ctx.roundRect(x - 2, yM - 20, wd + 4, 52, 10); ctx.fill(); text(ctx, 'ribosome', x + wd / 2, yM + 44, C.violet, 'center'); }
      }
      text(ctx, 'Protein', x0, yP - 30, DIM);
      const p = protein();
      p.forEach((a, i) => { const x = x0 + 26 + i * 58; if (i) { ctx.strokeStyle = DIM; ctx.beginPath(); ctx.moveTo(x - 36, yP); ctx.lineTo(x - 22, yP); ctx.stroke(); } ctx.fillStyle = 'rgba(196,160,255,.2)'; ctx.beginPath(); ctx.arc(x, yP, 22, 0, Math.PI * 2); ctx.fill(); text(ctx, a, x, yP + 4, INK, 'center'); });
      if (stopped) text(ctx, 'Stop codon: the protein is finished', x0 + 26 + p.length * 58, yP + 4, C.gold);
      else if (built.length < n) text(ctx, 'Copy the gene first', x0, yP + 4, DIM);
    });
    const genes = seg(group(panel, 'Gene'), { options: GENES_DNA.map((g, i) => [i, g[0]]), value: gi, onChange: (v) => { gi = v; restart(); } });
    const gb = group(panel, 'Add the next mRNA base');
    const r1 = row(gb, 'lab-row-btns');
    ['A', 'U', 'G', 'C'].forEach((b) => { const btn = button(r1, b, () => add(b)); btn.dataset.base = b; btn.setAttribute('aria-label', `Add ${b}`); });
    const note = el('p', 'lab-note'); note.setAttribute('aria-live', 'polite'); gb.appendChild(note);
    const r2 = row(panel, 'lab-row-btns');
    const nextBtn = button(r2, 'Read the next codon', () => readNext(), 'main');
    const allBtn = button(r2, 'Read to the stop', () => { while (!stopped && readNext()); });
    button(r2, 'Start again', () => restart());
    const st = stats(panel);
    function add(b) {
      if (built.length >= mrna().length) return;
      const tb = template()[built.length], want = RNA_OF[tb];
      if (b !== want) { mistakes++; note.textContent = `Not quite: the template has ${tb} here, and ${tb} pairs with ${want} in RNA.`; report(); return; }
      built += b; note.textContent = built.length === mrna().length ? 'The mRNA is copied. Now a ribosome can read it.' : '';
      report();
    }
    function readNext() {
      if (built.length < mrna().length || stopped || read * 3 >= built.length) return false;
      const a = codonOf(built.slice(read * 3, read * 3 + 3));
      read++;
      if (a === '*') stopped = true;
      report();
      return !stopped && read * 3 < built.length;
    }
    function restart() { built = ''; read = 0; mistakes = 0; stopped = false; note.textContent = ''; genes.set(gi); report(); }
    function report() {
      const done = built.length === mrna().length, codons = built.match(/.{1,3}/g) || [];
      nextBtn.disabled = allBtn.disabled = !done || stopped || read * 3 >= built.length;
      nextBtn.hidden = allBtn.hidden = stopped; // (the protein is finished: only Start again is left)
      st.set([['mRNA', codons.join(' ') || '(none yet)'], ['Protein', protein().join('-') || '(none yet)'], ['Codons read', `${read} of ${codons.length}`], ['Mistakes', String(mistakes)]]);
      if (done) api.check(0);
      if (stopped) api.check(1);
      if (stopped && gi === 2) api.check(2);
      cv.redraw();
    }
    report();
    return {
      state: () => `${GENES_DNA[gi][0]}: the template strand (3′ to 5′) is ${template()}; the student has built the mRNA ${built || '(nothing yet)'}${built.length === mrna().length ? '' : ` (${mrna().length - built.length} bases to go)`}; the ribosome has read ${read} codons, giving ${protein().join('-') || 'no amino acids yet'}${stopped ? ' and reached a stop codon' : ''}`,
      destroy: () => cv.destroy(),
    };
  },
};

/* ---------------- Food web and populations ---------------- */
// a grassland: grass; rabbits and deer eat it; foxes eat rabbits; wolves (the keystone species) eat deer.
// Lotka-Volterra style: each animal grows with its food and shrinks with its predators; grass grows back
// towards what the land can hold. Ten small steps make one season.
const FW = { rP: 0.4, K: 100, aR: 0.002, aD: 0.012, bR: 0.025, mR: 1.2, cF: 0.075, bD: 0.008, mD: 0.2, cW: 0.14, eF: 0.02, mF: 0.4, eW: 0.03, mW: 0.3 };
const FW_START = { P: 55, R: 22, D: 11, F: 4, W: 2 };
const FW_SP = [['P', 'Grass', '#7fe0a8', 1, '% of the ground'], ['R', 'Rabbits', '#e8d7a8', 10, ''], ['D', 'Deer', '#ffcf5a', 10, ''], ['F', 'Foxes', '#ff9a6a', 10, ''], ['W', 'Wolves', '#c4a0ff', 5, '']];
export function fwSeason(s, on) {
  let { P, R, D, F, W } = s;
  for (let i = 0; i < 10; i++) {
    const dt = 0.1;
    if (!on.R) R = 0; if (!on.D) D = 0; if (!on.F) F = 0; if (!on.W) W = 0;
    const dP = FW.rP * P * (1 - P / FW.K) - FW.aR * R * P - FW.aD * D * P;
    const dR = FW.bR * R * P - FW.mR * R - FW.cF * F * R;
    const dD = FW.bD * D * P - FW.mD * D - FW.cW * W * D;
    const dF = FW.eF * F * R - FW.mF * F;
    const dW = FW.eW * W * D - FW.mW * W;
    P = Math.max(0, P + dP * dt); R = Math.max(0, R + dR * dt); D = Math.max(0, D + dD * dt); F = Math.max(0, F + dF * dt); W = Math.max(0, W + dW * dt);
  }
  const gone = (v, k) => (v * (FW_SP.find((x) => x[0] === k)[3]) < 0.5 ? 0 : v); // (fewer than one animal left: gone)
  return { P, R: gone(R, 'R'), D: gone(D, 'D'), F: gone(F, 'F'), W: gone(W, 'W') };
}
const foodWebLab = {
  id: 'food-web', name: 'Food web and populations', subject: 'biology', levels: ['elem', 'hs'], topic: 'food chains and food webs, predators and prey, population changes and keystone species in an ecosystem',
  blurb: 'Take a predator out of a grassland and watch every population change, season by season.',
  words: 'food web food chain ecosystem predator prey population keystone species producer consumer herbivore carnivore wolves rabbits ecology lotka volterra',
  icon: '<circle cx="24" cy="8" r="4"/><circle cx="10" cy="24" r="4"/><circle cx="38" cy="24" r="4"/><path d="M6 42c4-6 8-6 12 0s8 6 12 0 8-6 12 0"/><path d="M12 28l10 10M36 28l-10 10M13 21l8-10M35 21l-8-10"/>',
  tries: ['Take out the foxes and watch the rabbits', 'Take out the wolves and see what happens to the grass', 'Keep every species alive for 30 seasons'],
  hints: ['Tap “Foxes” to take them out, then run 10 seasons or more. Rabbits boom, eat the grass down, then crash.', 'Wolves are the keystone species: they keep the deer in check. Take them out, run 10 seasons and watch the grass.', 'Start again with every species in, then run 30 seasons.'],
  about: 'Arrows show where the energy goes: from the food to the animal that eats it. Grass is the producer; rabbits and deer are herbivores; foxes and wolves are predators. Wolves are the keystone species here: without them, deer overgraze, the grass falls and even the rabbits suffer.\nThe numbers follow a simple Lotka-Volterra style model: each animal grows with how much food it meets and shrinks with how many predators meet it, and grass grows back towards what the land can hold. The rates are illustrative, chosen to show real patterns (a prey boom and crash without its predator, a trophic cascade without the keystone), not to forecast any real place.\nReal ecosystems have far more species, weather, disease and migration, and animals that switch food.',
  mount({ stage, panel, api }) {
    const on = { R: 1, D: 1, F: 1, W: 1 };
    let s = { ...FW_START }, hist = [{ ...s }], season = 0, since = 0, running = null;
    const cv = canvas(stage, (ctx, w, h) => {
      const narrow = w < 640, webH = narrow ? h * 0.42 : h * 0.4, x0 = 46, y0 = webH + 26, W = w - x0 - 20, H = h - y0 - 40;
      // the food web
      const pos = { P: [0.5, 0.86], R: [0.25, 0.55], D: [0.75, 0.55], F: [0.25, 0.18], W: [0.75, 0.18] }, P2 = (k) => [w * pos[k][0], webH * pos[k][1] + 8];
      const eat = [['P', 'R'], ['P', 'D'], ['R', 'F'], ['D', 'W']];
      eat.forEach(([a, b]) => { const [x1, y1] = P2(a), [x2, y2] = P2(b), dead = (k) => k !== 'P' && (!on[k] || !s[k]); ctx.strokeStyle = dead(a) || dead(b) ? FAINT : DIM; ctx.lineWidth = 2; const ang = Math.atan2(y2 - y1, x2 - x1), ex = x2 - Math.cos(ang) * 30, ey = y2 - Math.sin(ang) * 18; ctx.beginPath(); ctx.moveTo(x1, y1 - 14); ctx.lineTo(ex, ey); ctx.stroke(); ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(ex - Math.cos(ang - 0.5) * 9, ey - Math.sin(ang - 0.5) * 9); ctx.lineTo(ex - Math.cos(ang + 0.5) * 9, ey - Math.sin(ang + 0.5) * 9); ctx.closePath(); ctx.fillStyle = ctx.strokeStyle; ctx.fill(); });
      FW_SP.forEach(([k, name, col, mult]) => { const [x, y] = P2(k), gone = k !== 'P' && (!on[k] || !s[k]); ctx.fillStyle = gone ? 'rgba(255,255,255,.05)' : 'rgba(255,255,255,.1)'; ctx.strokeStyle = gone ? FAINT : col; ctx.lineWidth = 2; ctx.beginPath(); ctx.roundRect(x - 52, y - 15, 104, 30, 15); ctx.fill(); ctx.stroke(); text(ctx, `${name} ${k === 'P' ? Math.round(s.P) + '%' : Math.round(s[k] * mult)}`, x, y + 4, gone ? DIM : INK, 'center'); if (gone) { ctx.strokeStyle = C.red; ctx.beginPath(); ctx.moveTo(x - 40, y - 10); ctx.lineTo(x + 40, y + 10); ctx.stroke(); } });
      text(ctx, 'keystone', P2('W')[0], P2('W')[1] - 22, C.violet, 'center');
      // the populations, season by season (each as a share of its own start, so all fit on one chart)
      frame(ctx, x0, y0, W, H, 'Seasons', 'Compared with the start');
      const show = hist.slice(-60), top = Math.max(2, ...show.flatMap((q) => FW_SP.map(([k]) => q[k] / FW_START[k]))) * 1.05;
      const Y = (v) => y0 + H * (1 - v / top), X = (i) => x0 + (show.length < 2 ? 0 : (i / (Math.max(30, show.length) - 1)) * W);
      ctx.strokeStyle = FAINT; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(x0, Y(1)); ctx.lineTo(x0 + W, Y(1)); ctx.stroke(); ctx.setLineDash([]); text(ctx, 'start', x0 + 4, Y(1) - 4, DIM);
      FW_SP.forEach(([k, name, col]) => { ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath(); show.forEach((q, i) => { const v = q[k] / FW_START[k]; i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v)); }); ctx.stroke(); });
      FW_SP.forEach(([k, name, col], i) => { const lx = x0 + 8 + i * Math.min(110, W / 5); ctx.fillStyle = col; ctx.fillRect(lx, y0 + 6, 12, 3); text(ctx, name, lx + 16, y0 + 11, DIM); });
    });
    const g = group(panel, 'Take a species out (tap again to bring it back)');
    const r0 = row(g, 'lab-row-btns'), btns = {};
    FW_SP.slice(1).forEach(([k, name]) => { const b = button(r0, name, () => toggle(k)); b.dataset.sp = k; b.setAttribute('aria-pressed', 'true'); btns[k] = b; });
    const r1 = row(panel, 'lab-row-btns');
    button(r1, 'Run 1 season', () => run(1), 'main');
    button(r1, 'Run 10 seasons', () => run(10));
    button(r1, 'Start again', () => { stop(); Object.keys(on).forEach((k) => { on[k] = 1; btns[k].setAttribute('aria-pressed', 'true'); btns[k].textContent = FW_SP.find((x) => x[0] === k)[1]; }); s = { ...FW_START }; hist = [{ ...s }]; season = 0; since = 0; report(); });
    const st = stats(panel);
    function toggle(k) {
      on[k] = on[k] ? 0 : 1;
      if (on[k] && s[k] < 0.05) s[k] = FW_START[k] * 0.5; // (brought back: a few are let in again)
      if (!on[k]) s[k] = 0;
      btns[k].setAttribute('aria-pressed', String(!!on[k])); btns[k].textContent = on[k] ? FW_SP.find((x) => x[0] === k)[1] : `${FW_SP.find((x) => x[0] === k)[1]}: out`;
      since = 0; report();
    }
    function one() { s = fwSeason(s, on); season++; since++; hist.push({ ...s }); }
    function stop() { if (running) { running.stop(); running = null; } }
    function run(n) {
      stop();
      if (calm() || n === 1) { for (let i = 0; i < n; i++) one(); report(); return; }
      let left = n, acc = 0;
      running = clock((dt) => { acc += dt; if (acc < 0.12) return true; acc = 0; one(); report(); return --left > 0; });
      running.start();
    }
    function report() {
      st.set([['Season', String(season)], ...FW_SP.map(([k, name, , mult, unit]) => [name, k === 'P' ? `${Math.round(s.P)}${unit}` : (s[k] ? String(Math.round(s[k] * mult)) : 'gone')])]);
      if (!on.F && since >= 10) api.check(0);
      if (!on.W && since >= 10 && s.P < 40) api.check(1);
      if (on.R && on.D && on.F && on.W && since >= 30 && FW_SP.every(([k]) => s[k] > 0)) api.check(2);
      cv.redraw();
    }
    report();
    return {
      state: () => `season ${season}; ${FW_SP.slice(1).filter(([k]) => !on[k]).map(([, n]) => n).join(' and ') || 'no species'} taken out; grass covers ${Math.round(s.P)}% of the ground, ${FW_SP.slice(1).map(([k, n, , m]) => `${n.toLowerCase()} ${Math.round(s[k] * m)}`).join(', ')}`,
      destroy: () => { stop(); cv.destroy(); },
    };
  },
};

/* ---------------- Natural selection ---------------- */
// peppered moths: each moth has a darkness (0 pale to 1 black); birds eat half, picking the ones that stand
// out most against the bark; the survivors' young are like their parents, give or take a little.
// ground finches: beak depth in mm; in a drought only big hard seeds are left, so deeper beaks survive.
const gauss = (r) => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
const SEL_N = 120;
export function selGeneration(pop, kind, env, r) {
  let alive;
  if (kind === 'moth') {
    const bark = env === 'dark' ? 0.85 : 0.15;
    alive = pop.map((d) => [d, (0.05 + Math.abs(d - bark)) * r()]).sort((a, b) => a[1] - b[1]).slice(0, SEL_N / 2).map((x) => x[0]);
  } else {
    const keep = env === 'drought' ? 0.3 : 0.5, fit = env === 'drought' ? (b) => 1 / (1 + Math.exp(-(b - 9.6) * 2.5)) : (b) => Math.exp(-(((b - 9.4) / 1.2) ** 2));
    alive = pop.map((b) => [b, fit(b) * r()]).sort((a, b) => b[1] - a[1]).slice(0, Math.round(SEL_N * keep)).map((x) => x[0]);
  }
  const young = Array.from({ length: SEL_N }, () => { const p = alive[Math.floor(r() * alive.length)]; return kind === 'moth' ? Math.min(1, Math.max(0, p + gauss(r) * 0.06)) : Math.min(13, Math.max(6, p + gauss(r) * 0.25)); });
  return { young, eaten: SEL_N - alive.length };
}
export function selStart(kind, r) { return Array.from({ length: SEL_N }, () => (kind === 'moth' ? Math.min(1, Math.max(0, 0.2 + gauss(r) * 0.1)) : 9.4 + gauss(r) * 0.6)); }
const selectionLab = {
  id: 'selection', name: 'Natural selection', subject: 'biology', levels: ['hs', 'college'], topic: 'natural selection and evolution: variation, inheritance, survival of the fittest, peppered moths and Darwin’s finches',
  blurb: 'Change the bark or bring a drought, and watch moths and finches change over the generations.',
  words: 'natural selection evolution adaptation peppered moth industrial melanism darwin finches beak drought variation inheritance survival fittest generation galapagos',
  icon: '<path d="M24 14c-6-8-18-6-18 4 0 8 10 10 18 4 8 6 18 4 18-4 0-10-12-12-18-4z"/><path d="M24 14v24"/><path d="M20 8l4 6 4-6"/>',
  tries: ['Make the dark moths win', 'Clean the air and bring the light moths back', 'Make a drought and watch the finches’ beaks grow'],
  hints: ['Set the bark to dark (sooty air), then run generations. Pale moths stand out and get eaten.', 'After the dark moths win, set the bark back to light and keep running generations.', 'Pick the ground finches, choose Drought, and run a few generations. Watch the average beak depth.'],
  about: 'Natural selection needs three things: variation (moths differ in colour, finches in beak depth), inheritance (young look like their parents) and a struggle to survive (birds eat moths they can see; in a drought only big, hard seeds are left). The ones that fit their surroundings best leave more young, so the average changes over the generations.\nIn England in the 1800s, soot darkened tree bark and dark peppered moths became common; after clean air laws the pale form came back. On the Galápagos, after the 1977 drought, medium ground finches with deeper beaks survived and the next generation’s beaks were deeper.\nThis model is simplified. Real moth colour is mostly decided by one gene (carbonaria), here it is a smooth scale; young here copy one parent with a little random change; the survival rates are illustrative.',
  mount({ stage, panel, api }) {
    let kind = 'moth', env = 'light', r = rng(221), pop = selStart(kind, r), gen = 0, eaten = 0, start = mean(pop), hist = [start], darkWon = false, running = null;
    const spots = (() => { const q = rng(7); return Array.from({ length: SEL_N }, () => [q(), q(), q() * Math.PI]); })();
    function mean(a) { return a.reduce((x, y) => x + y, 0) / a.length; }
    const darkShare = () => pop.filter((d) => d > 0.5).length / pop.length;
    const cv = canvas(stage, (ctx, w, h) => {
      const topH = h * 0.5, x0 = 52, y0 = topH + 30, W = w - x0 - 24, H = h - y0 - 44;
      if (kind === 'moth') {
        const bark = env === 'dark' ? '#2b2724' : '#c9c6b6';
        ctx.fillStyle = bark; ctx.fillRect(16, 16, w - 32, topH - 24);
        ctx.strokeStyle = env === 'dark' ? 'rgba(0,0,0,.35)' : 'rgba(80,80,70,.25)'; ctx.lineWidth = 2; for (let i = 0; i < 9; i++) { const x = 30 + (i / 9) * (w - 60); ctx.beginPath(); ctx.moveTo(x, 18); ctx.bezierCurveTo(x + 10, topH * 0.3, x - 10, topH * 0.6, x + 4, topH - 10); ctx.stroke(); }
        pop.slice(0, 60).forEach((d, i) => { const [a, b, rot] = spots[i], x = 30 + a * (w - 60), y = 30 + b * (topH - 52), v = Math.round(225 - d * 200); ctx.save(); ctx.translate(x, y); ctx.rotate(rot * 0.2); ctx.fillStyle = `rgb(${v},${v},${v - 6})`; ctx.beginPath(); ctx.ellipse(-6, 0, 7, 4.5, -0.4, 0, Math.PI * 2); ctx.ellipse(6, 0, 7, 4.5, 0.4, 0, Math.PI * 2); ctx.fill(); ctx.restore(); });
      } else {
        text(ctx, env === 'drought' ? 'Drought: only big, hard seeds are left' : 'A normal year: small and big seeds', w / 2, 34, INK, 'center');
        for (let i = 0; i < 40; i++) { const [a, b] = spots[i], big = env === 'drought' || i % 3 === 0; ctx.fillStyle = big ? '#b88a4a' : '#e8d7a8'; ctx.beginPath(); ctx.ellipse(30 + a * (w - 60), 52 + b * (topH - 70), big ? 7 : 3.5, big ? 5 : 2.5, a * 3, 0, Math.PI * 2); ctx.fill(); }
      }
      // the trait now: a histogram, with the start's average dashed
      const lo = kind === 'moth' ? 0 : 7, hi = kind === 'moth' ? 1 : 12, bins = 12, cnt = new Array(bins).fill(0);
      pop.forEach((v) => { cnt[Math.min(bins - 1, Math.max(0, Math.floor(((v - lo) / (hi - lo)) * bins)))]++; });
      frame(ctx, x0, y0, W, H, kind === 'moth' ? 'Wing colour (pale to dark)' : 'Beak depth (mm)', 'How many');
      const top = Math.max(...cnt, 10), bw = W / bins;
      cnt.forEach((c, i) => { const v = kind === 'moth' ? Math.round(225 - ((i + 0.5) / bins) * 200) : 0; ctx.fillStyle = kind === 'moth' ? `rgb(${v},${v},${v - 6})` : C.gold; ctx.fillRect(x0 + i * bw + 2, y0 + H - (c / top) * H, bw - 4, (c / top) * H); });
      const MX = (v) => x0 + ((v - lo) / (hi - lo)) * W;
      ctx.strokeStyle = DIM; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(MX(start), y0); ctx.lineTo(MX(start), y0 + H); ctx.stroke(); ctx.setLineDash([]);
      ctx.strokeStyle = C.teal; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(MX(mean(pop)), y0); ctx.lineTo(MX(mean(pop)), y0 + H); ctx.stroke(); ctx.lineWidth = 1;
      const lab = (t, v, yy, col) => { const right = MX(v) > x0 + W - 90; text(ctx, t, MX(v) + (right ? -4 : 4), yy, col, right ? 'right' : 'left'); };
      lab('average now', mean(pop), y0 + 12, C.teal); lab('at the start', start, y0 + 26, DIM);
      if (kind === 'finch') { text(ctx, '7', x0, y0 + H + 14, DIM, 'center'); text(ctx, '12', x0 + W, y0 + H + 14, DIM, 'center'); }
    });
    const kindS = seg(group(panel, 'Animal'), { options: [['moth', 'Peppered moths'], ['finch', 'Ground finches']], value: kind, onChange: (v) => { kind = v; env = v === 'moth' ? 'light' : 'normal'; restart(); } });
    const envBox = el('div'); panel.appendChild(envBox);
    let envS = null;
    function buildEnv() {
      envBox.replaceChildren();
      envS = kind === 'moth'
        ? seg(group(envBox, 'Tree bark'), { options: [['light', 'Light (clean air)'], ['dark', 'Dark (sooty air)']], value: env, onChange: (v) => { env = v; report(); } })
        : seg(group(envBox, 'Weather'), { options: [['normal', 'Normal year'], ['drought', 'Drought']], value: env, onChange: (v) => { env = v; report(); } });
    }
    const r1 = row(panel, 'lab-row-btns');
    button(r1, 'Next generation', () => run(1), 'main');
    button(r1, 'Run 10 generations', () => run(10));
    button(r1, 'Start again', () => restart());
    const st = stats(panel);
    function restart() { stop(); r = rng(221); pop = selStart(kind, r); gen = 0; eaten = 0; start = mean(pop); hist = [start]; kindS.set(kind); buildEnv(); report(); }
    function one() { const o = selGeneration(pop, kind, env, r); pop = o.young; eaten = o.eaten; gen++; hist.push(mean(pop)); }
    function stop() { if (running) { running.stop(); running = null; } }
    function run(n) {
      stop();
      if (calm() || n === 1) { for (let i = 0; i < n; i++) one(); report(); return; }
      let left = n, acc = 0;
      running = clock((dt) => { acc += dt; if (acc < 0.15) return true; acc = 0; one(); report(); return --left > 0; });
      running.start();
    }
    function report() {
      const m = mean(pop);
      st.set(kind === 'moth'
        ? [['Generation', String(gen)], ['Dark moths', `${Math.round(darkShare() * 100)}%`], ['Average colour', `${Math.round(m * 100)} of 100`], ['Eaten last time', String(gen ? eaten : 0)]]
        : [['Generation', String(gen)], ['Average beak depth', `${m.toFixed(2)} mm`], ['At the start', `${start.toFixed(2)} mm`], [gen ? 'Died last time' : 'Died', String(gen ? eaten : 0)]]);
      if (kind === 'moth' && env === 'dark' && darkShare() > 0.5) { darkWon = true; api.check(0); }
      if (kind === 'moth' && env === 'light' && darkWon && darkShare() < 0.3) api.check(1);
      if (kind === 'finch' && env === 'drought' && m >= start + 0.4) api.check(2);
      cv.redraw();
    }
    buildEnv(); report();
    return {
      state: () => (kind === 'moth' ? `peppered moths on ${env} bark, generation ${gen}: ${Math.round(darkShare() * 100)}% are dark (average colour ${Math.round(mean(pop) * 100)} of 100, it started at ${Math.round(start * 100)})` : `medium ground finches in a ${env === 'drought' ? 'drought' : 'normal year'}, generation ${gen}: average beak depth ${mean(pop).toFixed(2)} mm (it started at ${start.toFixed(2)} mm)`),
      destroy: () => { stop(); cv.destroy(); },
    };
  },
};

export const BIOLOGY = [punnettLab, cellLab, photoLab, dnaLab, foodWebLab, selectionLab];

/* Biology labs: Punnett squares for one gene or two, with peas you can see, and a field of
   offspring grown at random to compare with the square's prediction. */
import { INK, DIM, FAINT, C, el, esc, num, canvas, group, seg, button, row, stats, dot, text, gcd } from './kit.js';

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
      X.cells.forEach((rowC, i) => rowC.forEach((c, j) => {
        const x = ox + size * (j + 1), y = oy + size * (i + 1);
        ctx.strokeStyle = FAINT; ctx.lineWidth = 1; ctx.strokeRect(x, y, size, size);
        pea(ctx, x + size / 2, y + size * 0.42, size * 0.22, c);
        text(ctx, c, x + size / 2, y + size * 0.85, INK, 'center', 'middle');
      }));
      if (field) {
        const fy = h - fieldH + 10, per = Math.floor((w - 40) / 12);
        field.list.forEach((c, k) => pea(ctx, 26 + (k % per) * 12, fy + Math.floor(k / per) * 12, 4.5, c));
      }
    });
    function grow() {
      const X = cross(), all = X.cells.flat(), list = [];
      for (let k = 0; k < 100; k++) list.push(all[Math.floor(Math.random() * all.length)]);
      const seen = {}; list.forEach((c) => { const p = looks(c).join(', '); seen[p] = (seen[p] || 0) + 1; });
      field = { list, seen };
      report();
    }
    function report() {
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
    const st = stats(panel);
    report();
    return {
      state: () => { const X = cross(); return `crossing ${g1()} × ${g2()} (${genes().map((k) => `${GENES[k].letter} = ${GENES[k].dom}, ${GENES[k].letter.toLowerCase()} = ${GENES[k].rec}`).join('; ')}): the Punnett square gives ${Object.entries(X.pheno).map(([k, v]) => `${v}/${X.total} ${k}`).join(', ')} — ratio ${ratio(X.pheno)}${field ? `; growing 100 gave ${Object.entries(field.seen).map(([k, v]) => `${v} ${k}`).join(', ')}` : ''}`; },
      destroy: () => cv.destroy(),
    };
  },
};

export const BIOLOGY = [punnettLab];

/* scenes 6-10, the cursor, ripples */
const SC = (k) => S[k][0];
let GR6;
(() => {
  const [a, b] = S.s6; winIn('#w6', a, b); capIn('#s6', a, b);
  GR6 = graphSVG(512, 330, 'g6'); $('#graph6').innerHTML = GR6.svg;
  track('#u6', [[a + 0.8, { opacity: 0, translate: '0 26px' }], [a + 1.25, { opacity: 1, translate: '0 0' }]]);
  track('#a6', [[a + 1.3, { opacity: 0, translate: '0 26px' }], [a + 1.75, { opacity: 1, translate: '0 0' }]]);
  track('#bcard6', [[a + 1.85, { opacity: 0, translate: '0 20px', maxHeight: '0px', marginTop: '0px' }], [a + 2.4, { opacity: 1, translate: '0 0', maxHeight: '480px', marginTop: '16px' }]]);
  const L = GR6.L;
  track('#g6line', [[a + 2.4, { strokeDashoffset: L }], [a + 3.5, { strokeDashoffset: 0 }]], 'cubic-bezier(.5,0,.3,1)');
  track('#g6pt0', [[a + 3.1, { opacity: 0 }], [a + 3.35, { opacity: 1 }]], 'linear');
  track('#g6pt1', [[a + 3.5, { opacity: 0 }], [a + 3.75, { opacity: 1 }]], 'linear');
  // red pen circle around (2,5)
  const cx = GR6.xs(2), cy = GR6.ys(5), r = 30;
  $('#g6pt1').parentNode.insertAdjacentHTML('beforeend', `<circle id="g6ring" class="pen" cx="${cx}" cy="${cy}" r="${r}" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1" transform="rotate(-90 ${cx} ${cy})"/>`);
  track('#g6ring', [[a + 4.6, { strokeDashoffset: 1 }], [a + 5.3, { strokeDashoffset: 0 }]], 'linear');
  track('#dr6', [[a + 3.95, { background: '#fff' }], [a + 4.0, { background: '#e9e6df' }], [a + 4.4, { background: '#fff' }]], 'linear');
})();

(() => {
  const [a, b] = S.s7; capIn('#s7', a, b);
  track('#c7a', [[a + 0.3, { opacity: 0, translate: '0 50px' }], [a + 0.95, { opacity: 1, translate: '0 0' }], [b - 0.5, { opacity: 1, translate: '0 0' }, 'ease-in'], [b, { opacity: 0, translate: '0 -30px' }]]);
  track('#c7b', [[a + 0.5, { opacity: 0, translate: '0 50px' }], [a + 1.15, { opacity: 1, translate: '0 0' }], [b - 0.5, { opacity: 1, translate: '0 0' }, 'ease-in'], [b, { opacity: 0, translate: '0 -30px' }]]);
  counter('#n1', 12, a + 1.2, 1.4); counter('#n2', 18, a + 1.3, 1.4); counter('#n3', 14, a + 1.4, 1.4); counter('#n4', 9, a + 1.5, 1.4);
  const H = $('#set7').scrollHeight || 260;
  track('#set7', [[a + 1.4, { height: '0px', opacity: 0 }], [a + 2.0, { height: H + 'px', opacity: 1 }]]);
  track('#pr1', [[a + 2.75, { background: '#262531', color: '#f4efe4' }], [a + 2.8, { background: '#262531', color: '#f4efe4' }], [a + 2.95, { background: '#262531', color: '#f4efe4' }]], 'linear');
  track('#pr3', [[a + 2.75, { background: '#262531', color: '#f4efe4' }], [a + 2.9, { background: '#f4efe4', color: '#15141b' }]], 'linear');
  track('#pr1', [[a + 2.75, { backgroundColor: '#f4efe4', color: '#15141b' }], [a + 2.9, { backgroundColor: '#262531', color: '#f4efe4' }]], 'linear');
  track('#t7a', [[a + 2.85, { opacity: 1, translate: '0 0' }], [a + 3.1, { opacity: 0, translate: '0 -24px' }]]);
  track('#t7b', [[a + 2.85, { opacity: 0, translate: '0 24px' }], [a + 3.1, { opacity: 1, translate: '0 0' }]]);
  track('#sa', [[a + 2.85, { opacity: 1 }], [a + 3.0, { opacity: 0 }]], 'linear');
  track('#sb', [[a + 2.85, { opacity: 0 }], [a + 3.0, { opacity: 1 }]], 'linear');
  track('#start7', [[a + 3.85, { scale: 1 }], [a + 3.9, { scale: .94 }], [a + 4.05, { scale: 1 }]], 'ease-out');
  track('#rail7', [[a + 4.0, { width: '0%' }], [a + 5.0, { width: '9%' }]], 'linear');
})();

(() => {
  const [a, b] = S.s8; capIn('#s8', a, b);
  track('#tu', [[a + 0.4, { opacity: 0, translate: '0 30px' }], [a + 0.9, { opacity: 1, translate: '0 0' }], [b - 0.4, { opacity: 1, translate: '0 0' }], [b, { opacity: 0, translate: '0 0' }]]);
  track('#tdots', [[a + 1.05, { opacity: 0 }], [a + 1.2, { opacity: 1 }], [a + 1.75, { opacity: 1 }], [a + 1.9, { opacity: 0 }]], 'linear');
  [...$('#tdots').children].forEach((d, i) => track(d, [[a + 1.2 + i * 0.1, { translate: '0 0' }], [a + 1.35 + i * 0.1, { translate: '0 -10px' }], [a + 1.5 + i * 0.1, { translate: '0 0' }], [a + 1.65 + i * 0.1, { translate: '0 -10px' }], [a + 1.8 + i * 0.1, { translate: '0 0' }]], 'ease-in-out'));
  track('#ta', [[a + 1.8, { opacity: 0, translate: '0 20px' }], [a + 2.05, { opacity: 1, translate: '0 0' }], [b - 0.4, { opacity: 1, translate: '0 0' }], [b, { opacity: 0, translate: '0 0' }]]);
  words('#ta', 'Okay — real talk. You’re <b>behind</b>, not <b>failing</b>. Pick one topic, 25 minutes, phone away. I’m right here.', a + 2.05, 11);
  track('#bot8', [[a + 0.9, { opacity: 0, translate: '80px 140px', rotate: '5deg' }], [a + 1.7, { opacity: 1, translate: '0 0', rotate: '0deg' }], [b - 0.4, { opacity: 1, translate: '0 0', rotate: '0deg' }], [b, { opacity: 0, translate: '0 0', rotate: '0deg' }]], 'cubic-bezier(.3,1.5,.5,1)');
})();

(() => {
  const [a, b] = S.s9;
  rise('#g1', a + 0.15, 50, .8, b - 0.3); rise('#g2', a + 0.8, 50, .8, b - 0.3); rise('#g3', a + 1.45, 50, .8, b - 0.3);
  rise('#g4', a + 2.1, 24, .7, b - 0.3); rise('#g5', a + 2.5, 24, .7, b - 0.3); rise('#g6', a + 2.8, 14, .7, b - 0.3);
  [...document.querySelectorAll('#g5 .pill')].forEach((p, i) => track(p, [[a + 2.5 + i * .12, { opacity: 0, translate: '0 20px' }], [a + 2.9 + i * .12, { opacity: 1, translate: '0 0' }]]));
  track('#g5', [[0, { opacity: 1 }]], 'linear'); // children carry the fade; keep container visible
  // container visibility handled by the scene; make sure container isn't hiding pills
  $('#g5').style.opacity = 1;
  track('#g5', [[b - 0.45, { opacity: 1 }], [b - 0.05, { opacity: 0 }]], 'linear');
})();

/* ======================= cursor + titles with the highlight motif ======================= */
const ctr = (sel, t, fx = .5, fy = .5) => { seek(t); const r = $(sel).getBoundingClientRect(); return { x: r.left + r.width * fx, y: r.top + r.height * fy, r }; };
const C = []; // cursor waypoints {t,x,y,press,ease}
const mv = (t, p, press = false, ease = SOFT, dx = 0, dy = 0) => C.push({ t, x: p.x + dx, y: p.y + dy, press, ease });
const RIPS = [];
function ripple(t, p, cls = '') { RIPS.push({ t, x: p.x, y: p.y, cls }); }
const press = (t) => window.CLICKS.push({ t, kind: 'down' }), release = (t) => window.CLICKS.push({ t, kind: 'up' });

function wordHighlight(wordSel, tArrive, tDown, tEnd, tClick, popSel) {
  const w = ctr(wordSel, tClick + 0.5);
  const mid = w.r.top + w.r.height * 0.55;
  const start = { x: w.r.left + 6, y: mid }, end = { x: w.r.right - 6, y: mid };
  mv(tArrive, start, false, 'cubic-bezier(.25,.8,.3,1)');
  mv(tDown, start, true, 'linear'); press(tDown);
  mv(tEnd, end, true, SOFT);
  mv(tEnd + 0.06, end, false);
  release(tEnd + 0.06);
  mv(tClick - 0.12, end, false);
  mv(tClick, end, true, 'ease-out'); press(tClick);
  mv(tClick + 0.16, end, false); release(tClick + 0.16);
  ripple(tClick, end);
  const sel = $(wordSel + ' .sel');
  track(sel, [[tDown, { clipPath: 'inset(0 100% 0 0)', scale: 1 }], [tEnd, { clipPath: 'inset(0 0% 0 0)', scale: 1 }, 'linear'], [tClick - 0.02, { clipPath: 'inset(0 0% 0 0)', scale: 1 }], [tClick + 0.1, { clipPath: 'inset(0 0% 0 0)', scale: 1.035 }], [tClick + 0.4, { clipPath: 'inset(0 0% 0 0)', scale: 1 }]], 'linear');
  return end;
}

// ---- S1 → S2: cursor enters, highlights "Cassie", clicks
mv(3.7, { x: 1700, y: 1000 });
wordHighlight('#word2', 5.85, 6.0, 7.4, 8.1);
mv(9.6, { x: 1060, y: 820 });

// ---- S3: drag the sentence, click Explain
(() => {
  const a = SC('s3'), sent = ctr('#sent', a + 4.5);
  const y = sent.r.top + sent.r.height / 2;
  const s0 = { x: sent.r.left - 2, y }, s1 = { x: sent.r.right + 2, y };
  mv(a + 1.8, s0, false, 'cubic-bezier(.25,.8,.3,1)');
  mv(a + 1.9, s0, true, 'linear'); press(a + 1.9);
  mv(a + 3.3, s1, true, 'linear');
  mv(a + 3.38, s1, false); release(a + 3.38);
  const be = ctr('#b-exp', a + 5.5);
  mv(a + 4.85, { x: be.x - 40, y: be.y - 6 }, false, SOFT);
  mv(a + 4.88, { x: be.x - 40, y: be.y - 6 }, true, 'ease-out'); press(a + 4.88);
  mv(a + 5.05, { x: be.x - 40, y: be.y - 6 }, false); release(a + 5.05);
  ripple(a + 4.88, { x: be.x - 40, y: be.y - 6 });
  mv(a + 6.2, { x: 1500, y: 720 });
})();

// ---- S4: snip drag, pen, Check my work
(() => {
  const a = SC('s4'), fig = ctr('#fig4', a + 5), bd = ctr('#board4 svg', a + 7);
  const p0 = { x: fig.r.left - 12, y: fig.r.top - 12 }, p1 = { x: fig.r.right + 12, y: fig.r.bottom + 12 };
  mv(a + 1.4, p0, false, 'cubic-bezier(.25,.8,.3,1)');
  mv(a + 1.5, p0, true, 'linear'); press(a + 1.5);
  mv(a + 2.7, p1, true, 'linear');
  mv(a + 2.8, p1, false); release(a + 2.8);
  // pen on the board: start/end of the stroke
  const G = window.S4.board.GP;
  const q0 = { x: bd.r.left + G.xs(-1.7) + 4, y: bd.r.top + G.ys(-2.4) - 10 }, q1 = { x: bd.r.left + G.xs(3.8) + 4, y: bd.r.top + G.ys(8.6) - 10 };
  mv(a + 4.8, { x: q0.x, y: q0.y }, false, SOFT);
  mv(a + 5.0, q0, true, 'linear'); press(a + 5.0);
  mv(a + 6.2, q1, true, 'linear');
  mv(a + 6.3, q1, false); release(a + 6.3);
  const ck = ctr('#chk4', a + 7.5);
  mv(a + 7.15, { x: ck.x - 10, y: ck.y }, false, SOFT);
  mv(a + 7.28, { x: ck.x - 10, y: ck.y }, true, 'ease-out'); press(a + 7.28);
  mv(a + 7.45, { x: ck.x - 10, y: ck.y }, false); release(a + 7.45);
  ripple(a + 7.28, { x: ck.x - 10, y: ck.y }, 'dk');
  mv(a + 8.3, { x: 1500, y: 600 });
})();

// ---- S5: drag the PDF in, type, send, save as PDF
(() => {
  const a = SC('s5');
  const tile = ctr('#tile5', a + 1.0), chip = (seek(a + 3.0), $('#chip5').getBoundingClientRect());
  const tc = { x: tile.x, y: tile.y }, cc = { x: chip.left + chip.width / 2, y: chip.top + chip.height / 2 };
  mv(a + 0.9, { x: tc.x - 8, y: tc.y - 20 }, false, 'cubic-bezier(.25,.8,.3,1)');
  mv(a + 1.0, { x: tc.x - 8, y: tc.y - 20 }, true, SOFT); press(a + 1.0);
  mv(a + 1.95, { x: cc.x - 8, y: cc.y - 20 }, true, SOFT);
  mv(a + 2.05, { x: cc.x - 8, y: cc.y - 20 }, false); release(a + 2.05);
  const dx = cc.x - tc.x, dy = cc.y - tc.y;
  track('#tile5', [[a + 0.5, { opacity: 0, scale: .9, translate: '0 0' }], [a + 0.95, { opacity: 1, scale: 1, translate: '0 0' }], [a + 1.0, { opacity: 1, scale: 1, translate: '0 0' }, SOFT], [a + 1.95, { opacity: 1, scale: .62, translate: `${dx}px ${dy}px` }], [a + 2.12, { opacity: 0, scale: .5, translate: `${dx}px ${dy}px` }]]);
  const sd = ctr('#send5', a + 3.0);
  mv(a + 3.3, { x: sd.x - 6, y: sd.y - 4 }, false, SOFT);
  mv(a + 3.46, { x: sd.x - 6, y: sd.y - 4 }, true, 'ease-out'); press(a + 3.46);
  mv(a + 3.66, { x: sd.x - 6, y: sd.y - 4 }, false); release(a + 3.66);
  ripple(a + 3.46, { x: sd.x - 6, y: sd.y - 4 });
  mv(a + 4.6, { x: 1400, y: 520 });
  const pdf = ctr('#fpdf', a + 7.4);
  mv(a + 7.3, { x: pdf.x - 4, y: pdf.y }, false, SOFT);
  mv(a + 7.52, { x: pdf.x - 4, y: pdf.y }, true, 'ease-out'); press(a + 7.52);
  mv(a + 7.72, { x: pdf.x - 4, y: pdf.y }, false); release(a + 7.72);
  ripple(a + 7.52, { x: pdf.x - 4, y: pdf.y }, 'dk');
  mv(a + 8.6, { x: 1500, y: 640 });
})();

// ---- S6: Draw on this, then circle the point
(() => {
  const a = SC('s6'), dr = ctr('#dr6', a + 3.0);
  mv(a + 3.7, { x: dr.x, y: dr.y }, false, SOFT);
  mv(a + 3.96, { x: dr.x, y: dr.y }, true, 'ease-out'); press(a + 3.96);
  mv(a + 4.14, { x: dr.x, y: dr.y }, false); release(a + 4.14);
  ripple(a + 3.96, { x: dr.x, y: dr.y }, 'dk');
  const g = ctr('#graph6 svg', a + 5);
  const cx = g.r.left + GR6.xs(2), cy = g.r.top + GR6.ys(5), r = 30;
  const at = (deg) => ({ x: cx + r * Math.cos((deg - 90) * Math.PI / 180), y: cy + r * Math.sin((deg - 90) * Math.PI / 180) });
  mv(a + 4.5, at(0), false, SOFT);
  mv(a + 4.6, at(0), true, 'linear'); press(a + 4.6);
  for (let i = 1; i <= 8; i++) mv(a + 4.6 + 0.7 * (i / 8), at(45 * i), true, 'linear');
  mv(a + 5.35, at(360), false); release(a + 5.35);
  mv(a + 5.8, { x: 1500, y: 600 });
})();

// ---- S7: gear, presets, Start
(() => {
  const a = SC('s7'), gear = ctr('#gear7', a + 3), p3 = ctr('#pr3', a + 3.2), st = ctr('#start7', a + 3.2);
  mv(a + 1.15, { x: gear.x, y: gear.y }, false, SOFT);
  mv(a + 1.3, { x: gear.x, y: gear.y }, true, 'ease-out'); press(a + 1.3);
  mv(a + 1.46, { x: gear.x, y: gear.y }, false); release(a + 1.46);
  ripple(a + 1.3, { x: gear.x, y: gear.y });
  mv(a + 2.65, { x: p3.x, y: p3.y }, false, SOFT);
  mv(a + 2.78, { x: p3.x, y: p3.y }, true, 'ease-out'); press(a + 2.78);
  mv(a + 2.95, { x: p3.x, y: p3.y }, false); release(a + 2.95);
  ripple(a + 2.78, { x: p3.x, y: p3.y });
  mv(a + 3.7, { x: st.x, y: st.y }, false, SOFT);
  mv(a + 3.84, { x: st.x, y: st.y }, true, 'ease-out'); press(a + 3.84);
  mv(a + 4.0, { x: st.x, y: st.y }, false); release(a + 4.0);
  ripple(a + 3.84, { x: st.x, y: st.y }, 'dk');
  mv(a + 4.6, { x: 1450, y: 900 });
})();

// ---- S10: the closing highlight + click
(() => {
  const a = SC('s10');
  mv(a + 0.05, { x: 1700, y: 1000 });
  wordHighlight('#word10', a + 0.75, a + 0.88, a + 1.75, a + 2.1);
  track('#botEnd', [[a + 2.1, { opacity: 0, translate: '0 80px', scale: .8 }], [a + 2.8, { opacity: 1, translate: '0 0', scale: 1 }]], 'cubic-bezier(.3,1.5,.5,1)');
  rise('#url10', a + 2.45, 30, .8); rise('#sub10', a + 2.9, 24, .8);
  mv(a + 3.3, { x: 1500, y: 900 });
})();

/* build the single cursor track from the waypoints */
(() => {
  C.sort((p, q) => p.t - q.t);
  const pts = []; let prev = null;
  C.forEach((p) => {
    const e = prev ? prev.ease : SOFT; // easing of the segment leading INTO this point is the previous waypoint's declared ease
    pts.push([p.t, { translate: `${p.x}px ${p.y}px`, scale: p.press ? .84 : 1 }, p.ease]);
    prev = p;
  });
  const cur = $('#cur');
  track(cur, pts);
  // visibility: on from 3.7 to 59.5, off while no waypoints are active (S8/S9)
  track(cur, [[3.65, { opacity: 0 }], [3.95, { opacity: 1 }], [SC('s7') + 4.9, { opacity: 1 }], [SC('s7') + 5.2, { opacity: 0 }], [SC('s10') + 0.1, { opacity: 0 }], [SC('s10') + 0.3, { opacity: 1 }], [SC('s10') + 3.4, { opacity: 1 }], [SC('s10') + 3.8, { opacity: 0 }]], 'linear');
  // click ripples
  RIPS.forEach((r, i) => {
    const el = document.createElement('div'); el.className = 'rip ' + r.cls; el.style.left = r.x + 'px'; el.style.top = r.y + 'px'; el.id = 'rip' + i;
    $('#stage').appendChild(el);
    track(el, [[r.t, { opacity: 0, scale: .25 }], [r.t + 0.04, { opacity: .95, scale: .35 }], [r.t + 0.6, { opacity: 0, scale: 1.7 }]], 'cubic-bezier(.2,.7,.3,1)');
  });
})();

seek(0);
window.READY = true;

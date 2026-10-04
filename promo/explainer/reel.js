/* Cassie — 60-second explainer reel in the "screen card + chapter bar" style.
   1080×1920 · 100 BPM (bar = 2.4 s) · window.seek(t) renders the frame at t seconds. */
(function () {
  'use strict';
  const BAR = 2.4;
  const $ = (s, r = document) => r.querySelector(s);
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const span = (t, a, b) => clamp((t - a) / (b - a));
  const ease = (k) => { k = clamp(k); return k * k * (3 - 2 * k); };
  const out3 = (k) => 1 - Math.pow(1 - clamp(k), 3);
  const back = (k) => { k = clamp(k); const c = 1.70158; return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2); };
  const lerp = (a, b, k) => a + (b - a) * k;
  const content = $('#content'), topL = $('#top');
  const make = (html, parent) => { const d = document.createElement('div'); d.innerHTML = html.trim(); const n = d.firstChild; parent.appendChild(n); return n; };
  const CUR = (w = 34, fill = '#fff') => `<svg viewBox="100 80 305 350" width="${w}" height="${w * 1.15}" style="position:absolute;filter:drop-shadow(0 4px 6px rgba(0,0,0,.35))"><path d="M108 90 L395 259 L275 281 L342 399 L287 422 L225 300 L108 382 Z" fill="${fill}" stroke="#0b0a0f" stroke-width="22" stroke-linejoin="round" paint-order="stroke"/></svg>`;
  // world coords for the 3D stage inside the 1000×600 card
  const W = (px, py) => [(px - 500) / 124.5, 0.35 - (py - 300) / 124.5];

  /* ---------------- chapters ---------------- */
  const CH = [[0, 7.2], [7.2, 16.8], [16.8, 50.4], [50.4, 60]];

  /* ---------------- colours per scene (felt palette) ---------------- */
  const PAL = {
    intro: ['#f2a7b5', '#b9a6ff', '#ffd1c2'], problem: ['#a98bff', '#f08ab0', '#6b5cff'],
    red: ['#e8545c', '#f2a7b5', '#ffc7a8'], maroon: ['#8a3a46', '#c9a04a', '#f2a7b5'], navy: ['#3b5bdb', '#7fb3ff', '#b9a6ff'],
    pink: ['#ee9a8c', '#f7b9c8', '#ffd6c9'], grey: ['#8e96a6', '#c9cfdb', '#f2a7b5'], green: ['#4fbf8a', '#a6e3c4', '#b9a6ff'],
  };

  /* ---------------- scene helpers ---------------- */
  function kin(root, words, acc = []) {
    const box = make(`<div class="kin"></div>`, root);
    words.forEach((w, i) => make(`<span class="w ${acc.includes(i) ? 'acc' : ''}">${w}</span>`, box));
    return box;
  }
  function kinUpdate(box, lt, start = 0.1, gap = 0.22) {
    [...box.children].forEach((w, i) => {
      const k = span(lt, start + i * gap, start + i * gap + 0.38);
      w.style.opacity = k; w.style.filter = `blur(${(1 - k) * 14}px)`; w.style.transform = `translateY(${(1 - out3(k)) * 26}px)`;
    });
  }
  const ICONS = {
    book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z" fill="#f6d1d6"/><path d="M4 5v16M8 7h8" stroke="#16131c" stroke-width="1.6" fill="none"/>',
    pencil: '<path d="M4 20l1-4L16 5l3 3L8 19z" fill="#ffd166" stroke="#16131c" stroke-width="1.4"/>',
    flask: '<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3" fill="#c9e7ff" stroke="#16131c" stroke-width="1.4"/>',
    bulb: '<circle cx="12" cy="10" r="6" fill="#ffe27a" stroke="#16131c" stroke-width="1.4"/><path d="M9 17h6M10 20h4" stroke="#16131c" stroke-width="1.6"/>',
    clock: '<circle cx="12" cy="12" r="9" fill="#fff" stroke="#16131c" stroke-width="1.6"/><path d="M12 7v5l3 2" stroke="#d8343c" stroke-width="1.8" fill="none" stroke-linecap="round"/>',
    calc: '<rect x="5" y="3" width="14" height="18" rx="2" fill="#e9e4ff" stroke="#16131c" stroke-width="1.4"/><path d="M8 7h8M8 12h2M12 12h2M8 16h2M12 16h2" stroke="#16131c" stroke-width="1.6"/>',
    lock: '<rect x="5" y="10" width="14" height="11" rx="2" fill="#16131c"/><path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="#16131c" stroke-width="2" fill="none"/>',
  };
  const icon = (name, parent, size = 44) => make(`<svg class="ico" viewBox="0 0 24 24" width="${size}" height="${size}" style="width:${size}px;height:${size}px">${ICONS[name]}</svg>`, parent);
  function popIn(n, lt, at, dur = 0.35, extra = '') {
    const k = back(span(lt, at, at + dur));
    n.style.opacity = span(lt, at, at + 0.1); n.style.transform = `${extra} scale(${k})`;
  }
  function tag(n, label) { return make(`<div class="ftag"><b>${n}</b>${label}</div>`, topL); }

  /* ---------------- scenes ---------------- */
  const scenes = [];
  const scene = (t0, t1, pal, build) => { const root = make(`<div class="scene"></div>`, content); const s = { t0, t1, pal, root, ...build(root) }; scenes.push(s); return s; };

  // INTRO -------------------------------------------------------------------
  scene(0, 2.4, 'intro', (r) => {
    const k = kin(r, ['Every', 'night,', 'there’s'], [0]);
    const ic = ['book', 'pencil', 'flask'].map((n) => icon(n, r, 46));
    return { update(lt) { kinUpdate(k, lt); ic.forEach((n, i) => { n.style.left = 700 + i * 52 + 'px'; n.style.top = 218 + (i % 2) * 16 + 'px'; popIn(n, lt, 0.9 + i * 0.12); }); } };
  });
  scene(2.4, 4.8, 'intro', (r) => {
    const k = kin(r, ['something', 'new', 'to', 'learn.'], [1]);
    const ic = ['bulb', 'calc'].map((n) => icon(n, r, 46));
    return { update(lt) { kinUpdate(k, lt, 0.05, 0.2); ic.forEach((n, i) => { n.style.left = (i ? 820 : 150) + 'px'; n.style.top = (i ? 330 : 200) + 'px'; popIn(n, lt, 1.0 + i * 0.15); }); } };
  });
  scene(4.8, 7.2, 'intro', (r) => {
    const k = kin(r, ['47', 'slides.', 'One', 'exam.', '2', 'AM.'], [4, 5]);
    const c = icon('clock', r, 64);
    return { update(lt) { kinUpdate(k, lt, 0.05, 0.24); c.style.left = '468px'; c.style.top = '150px'; popIn(c, lt, 1.4, 0.4, `rotate(${Math.sin(lt * 18) * 8 * span(lt, 1.6, 2.2)}deg)`); } };
  });

  // PROBLEM -----------------------------------------------------------------
  function collageCards(r) {
    const C = [
      ['<div class="lbl">PDF · 412 pages</div><div style="height:8px;background:#eee;border-radius:4px;margin-top:10px"></div><div style="height:8px;background:#eee;border-radius:4px;margin-top:8px;width:70%"></div>', 150, 110, '#fff'],
      ['<div class="lbl" style="color:#fff">SLIDES</div><div style="height:46px;background:rgba(255,255,255,.25);border-radius:6px;margin-top:8px"></div>', 150, 100, '#5b4bd8'],
      ['<div style="font:700 15px Inter">“Explain the Krebs cycle??”</div>', 170, 70, '#fff3b0'],
      ['<svg viewBox="0 0 100 50" width="130" height="60"><path d="M5 45 L30 30 L50 35 L75 12 L95 8" stroke="#d8343c" stroke-width="4" fill="none"/></svg>', 150, 90, '#fff'],
      ['<div style="font:900 34px Inter;color:#16131c">23:59</div><div class="lbl">due tonight</div>', 140, 90, '#ffd6dc'],
      ['<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:5px">' + '<i style="height:18px;background:#ddd;border-radius:4px"></i>'.repeat(9) + '</div>', 120, 100, '#e9e4ff'],
      ['<div style="width:100%;height:56px;border-radius:8px;background:linear-gradient(135deg,#222,#555);display:grid;place-items:center;color:#fff;font:900 22px Inter">▶</div><div class="lbl" style="margin-top:6px">lecture 7 · 1:42:10</div>', 160, 100, '#fff'],
      ['<div style="font:800 15px Inter">Flashcard</div><div style="font:600 14px Inter;color:#6f6a76;margin-top:6px">mitochondria = ?</div>', 140, 80, '#fff'],
      ['<div style="font:800 26px Inter">∫ x² dx</div>', 120, 70, '#d9f2e6'],
      ['<div style="font:700 14px Inter">37 tabs open</div><div style="display:flex;gap:3px;margin-top:8px">' + '<i style="flex:1;height:10px;background:#c8c3d0;border-radius:3px"></i>'.repeat(6) + '</div>', 150, 64, '#fff'],
    ];
    return C.map(([html, w, h, bg]) => make(`<div class="card2" style="width:${w}px;height:${h}px;padding:12px;background:${bg}">${html}</div>`, r));
  }
  scene(7.2, 9.6, 'problem', (r) => {
    const cards = collageCards(r);
    const k = kin(r, ['You', 'just', 'want', 'it', 'to', 'make', 'sense?'], [5, 6]); k.style.fontSize = '50px';
    return { update(lt) {
      kinUpdate(k, lt, 0.1, 0.12);
      cards.forEach((c, i) => {
        const a = i / cards.length * Math.PI * 2 + lt * 0.25, rx = 400, ry = 230;
        const kk = out3(span(lt, 0.1 + i * 0.05, 0.8 + i * 0.05));
        const x = 500 + Math.cos(a) * rx * lerp(1.6, 1, kk) - c.offsetWidth / 2, y = 300 + Math.sin(a) * ry * lerp(1.6, 1, kk) - c.offsetHeight / 2;
        c.style.left = x + 'px'; c.style.top = y + 'px'; c.style.opacity = kk; c.style.transform = `rotate(${Math.sin(i * 1.7) * 10}deg)`; c.style.filter = `blur(${(1 - kk) * 8}px)`;
      });
    } };
  });
  scene(9.6, 12, 'problem', (r) => {
    const cards = collageCards(r);
    const k = kin(r, ['but', 'it’s', 'buried', 'in', 'tabs,', 'PDFs', '&', 'slides.'], [2]); k.style.fontSize = '44px'; k.style.padding = '0 260px';
    return { update(lt) {
      kinUpdate(k, lt, 0.05, 0.1);
      cards.forEach((c, i) => {
        const a = i / cards.length * Math.PI * 2 + 0.6 + lt * 0.9, rr = lerp(1.05, 0.92, ease(span(lt, 0, 2.4)));
        c.style.left = 500 + Math.cos(a) * 360 * rr - c.offsetWidth / 2 + 'px'; c.style.top = 300 + Math.sin(a) * 210 * rr - c.offsetHeight / 2 + 'px';
        c.style.opacity = 1; c.style.filter = 'none'; c.style.transform = `rotate(${Math.sin(i * 1.7 + lt * 2) * 14}deg) scale(${lerp(1, 0.9, span(lt, 1.6, 2.4))})`;
      });
    } };
  });
  scene(12, 14.4, 'problem', (r) => {
    const L = 'Simple'.split('');
    const xs = [130, 300, 380, 560, 700, 780];
    const letters = L.map((c) => make(`<div class="letter">${c}</div>`, r));
    const whole = make(`<div class="letter" style="left:0;right:0;text-align:center;top:205px;color:#d8343c">Simple.</div>`, r);
    const guides = [];
    [140, 235, 330, 410].forEach((y) => guides.push(make(`<div class="guide" style="left:0;right:0;height:1.5px;top:${y}px"></div>`, r)));
    xs.forEach((x) => guides.push(make(`<div class="guide" style="top:0;bottom:0;width:1.5px;left:${x}px"></div>`, r)));
    const dots = [];
    xs.forEach((x) => [235, 410].forEach((y) => dots.push(make(`<div class="dot" style="left:${x - 4}px;top:${y - 4}px"></div>`, r))));
    return { update(lt) {
      const close = ease(span(lt, 1.3, 2.0));
      letters.forEach((n, i) => {
        const tight = [300, 420, 470, 610, 720, 770][i];
        n.style.left = lerp(xs[i], tight, close) + 'px'; n.style.top = '205px';
        const k = span(lt, 0.05 + i * 0.08, 0.35 + i * 0.08); n.style.opacity = k * (1 - span(lt, 1.75, 1.95)); n.style.filter = `blur(${(1 - k) * 12 + span(lt, 1.75, 1.95) * 10}px)`;
      });
      whole.style.opacity = span(lt, 1.8, 2.0); whole.style.filter = `blur(${(1 - span(lt, 1.8, 2.0)) * 10}px)`;
      guides.forEach((g, i) => { g.style.opacity = span(lt, 0.0 + i * 0.03, 0.3 + i * 0.03) * (1 - close); });
      dots.forEach((d, i) => { d.style.opacity = span(lt, 0.3 + i * 0.02, 0.5 + i * 0.02) * (1 - close); });
    } };
  });
  scene(14.4, 16.8, 'red', (r) => {
    const ring = make(`<svg width="90" height="90" viewBox="0 0 90 90" style="position:absolute;left:300px;top:255px"><circle cx="45" cy="45" r="32" fill="none" stroke="#d8343c" stroke-width="12" stroke-linecap="round" stroke-dasharray="150 60"/></svg>`, r);
    const word = make(`<div style="position:absolute;left:400px;top:252px;font:850 84px Inter;letter-spacing:-.05em;color:#16131c"><span style="position:relative;display:inline-block;padding:0 6px"><i class="sel" style="position:absolute;inset:6px 0 4px;background:#ffe066;border-radius:10px;transform-origin:left;z-index:-1"></i>Cassie</span></div>`, r);
    const cur = make(`<div style="position:absolute">${CUR(40)}</div>`, r);
    return { update(lt) {
      ring.style.transform = `rotate(${lt * 520}deg) scale(${1 - 0.25 * span(lt, 0.8, 1.0)})`;
      ring.style.opacity = 1 - span(lt, 0.9, 1.1);
      word.style.opacity = span(lt, 0.75, 1.0); word.style.filter = `blur(${(1 - span(lt, 0.75, 1.0)) * 10}px)`;
      const sw = ease(span(lt, 1.1, 1.7));
      $('.sel', word).style.transform = `scaleX(${sw})`;
      cur.style.opacity = span(lt, 0.9, 1.05) * (1 - span(lt, 2.2, 2.4));
      cur.style.left = lerp(400, 690, sw) + 'px'; cur.style.top = 330 + 'px';
      const click = span(lt, 1.8, 1.95); cur.style.transform = `scale(${1 - 0.15 * Math.sin(click * Math.PI)})`;
    }, cast(lt) { return lt > 1.9 ? [{ id: 'logo', outfit: 'classic', mood: 'happy', x: W(860, 300)[0], y: W(860, 330)[1], s: 0.62 * back(span(lt, 1.9, 2.3)), shadow: false }] : []; } };
  });

  // FEATURES ----------------------------------------------------------------
  const ART = '<div style="padding:22px 26px;font:15px/1.6 Inter;color:#2a282e"><div style="font:800 11px Inter;letter-spacing:.14em;color:#999">BIONOTES</div><div style="font:800 26px Inter;color:#121116;margin:4px 0 10px">Cellular Respiration</div>Cells release the energy stored in glucose in stages. After glycolysis, the process moves into the mitochondria. <span class="mk" style="position:relative">The Krebs cycle turns acetyl-CoA into CO₂, NADH and FADH₂.<i style="position:absolute;inset:-1px -2px;background:#bcd8ff;border-radius:4px;z-index:-1;transform-origin:left"></i></span> Without oxygen, the whole process stalls.</div>';
  scene(16.8, 21.6, 'red', (r) => {
    r.style.background = 'linear-gradient(180deg,#efe7dc,#e4d9c9)';
    const t = tag('01', 'Highlight anything');
    const zoom = make(`<div style="position:absolute;inset:0;transform-origin:420px 250px"></div>`, r);
    const mon = make(`<div class="monitor" style="left:240px;top:60px;width:520px;height:440px"><div class="scr" style="left:0;top:0;width:520px;height:320px;padding:10px"><div style="background:#fff;width:100%;height:100%;border-radius:4px;overflow:hidden;position:relative">${ART}</div></div><div class="stand" style="left:225px;top:320px;width:70px;height:90px"></div><div class="stand" style="left:170px;top:405px;width:180px;height:12px;border-radius:6px"></div></div>`, zoom);
    const pop = make(`<div class="pop" style="left:300px;top:250px;width:330px"><div class="ph"><span>CASSIE</span><span>×</span></div><div class="chips"><span class="on">Explain</span><span>Answer</span><span>Code</span></div><span class="ty"></span></div>`, zoom);
    const cur = make(`<div style="position:absolute">${CUR(26)}</div>`, zoom);
    const TXT = 'It’s the cell’s <b>recycling loop</b> — it breaks acetyl-CoA down to CO₂ and charges up <b>NADH & FADH₂</b> for making ATP.';
    return { tags: [t], update(lt) {
      const z = ease(span(lt, 0.3, 1.3));
      zoom.style.transform = `scale(${lerp(1, 1.32, z)}) translate(${lerp(0, -20, z)}px, ${lerp(0, 30, z)}px)`;
      const drag = ease(span(lt, 1.4, 2.3));
      $('.mk i', mon).style.transform = `scaleX(${drag})`;
      cur.style.left = lerp(270, 470, drag) + 'px'; cur.style.top = lerp(218, 240, drag) + 'px';
      cur.style.opacity = span(lt, 1.2, 1.35) * (1 - span(lt, 2.6, 2.8));
      pop.style.opacity = span(lt, 2.4, 2.6); pop.style.transform = `translateY(${(1 - back(span(lt, 2.4, 2.8))) * 20}px) scale(.62)`; pop.style.transformOrigin = 'left top';
      const plain = TXT.replace(/<[^>]+>/g, ''), n = Math.floor(span(lt, 2.7, 4.4) * plain.length);
      let shown = 0, out = ''; for (const part of TXT.split(/(<[^>]+>)/)) { if (part.startsWith('<')) out += part; else { out += part.slice(0, Math.max(0, n - shown)); shown += part.length; } }
      $('.ty', pop).innerHTML = out;
    } };
  });
  scene(21.6, 26.4, 'red', (r) => {
    r.style.background = '#f7f5f1';
    const t = tag('02', 'Snip & sketch');
    const page = make(`<div style="position:absolute;left:40px;top:70px;width:560px;height:480px;background:#fff;border-radius:14px;box-shadow:0 10px 30px rgba(0,0,0,.08);padding:20px"><div style="font:800 22px Inter">Linear functions</div><div style="font:15px Inter;color:#666;margin:6px 0 10px">Plot the line through (0, 1) and (2, 5).</div><svg viewBox="0 0 300 200" width="420" height="280" style="margin-left:40px"><path d="M30 10V190M10 170H290" stroke="#bbb" stroke-width="2"/><path d="M40 182 L270 22" stroke="#16131c" stroke-width="3"/><circle cx="80" cy="154" r="5" fill="#16131c"/><circle cx="160" cy="98" r="5" fill="#16131c"/></svg></div>`, r);
    const snip = make(`<div style="position:absolute;border:3px dashed #d8343c;border-radius:6px;background:rgba(216,52,60,.06)"></div>`, r);
    const board = make(`<div style="position:absolute;top:60px;width:380px;height:500px;background:#fff;border-radius:18px;box-shadow:0 20px 50px rgba(0,0,0,.18);padding:16px;overflow:hidden"><div style="display:flex;justify-content:space-between;align-items:center"><b style="font:800 18px Inter">Your snip</b><span class="chk" style="font:700 14px Inter;background:#16131c;color:#fff;padding:7px 12px;border-radius:999px">✓ Check my work</span></div><div style="font:14px/1.5 Inter;margin:10px 0"><b>Graph of y = 2x + 1</b><ol style="margin:4px 0 0;padding-left:18px"><li class="st">Start at (0, 1).</li><li class="st">Slope 2: up 2, right 1.</li><li class="st">Plot (2, 5) and join.</li></ol></div><svg viewBox="0 0 300 200" width="348" height="232"><rect width="300" height="200" fill="#fafafa"/><path d="M30 10V190M10 170H290" stroke="#ccc" stroke-width="2"/><path d="M40 182 L270 22" stroke="#999" stroke-width="2"/><path class="ink" d="M42 180 L268 24" stroke="#d8343c" stroke-width="5" fill="none" stroke-linecap="round" stroke-dasharray="290" stroke-dashoffset="290"/></svg><div class="ok" style="position:absolute;left:16px;right:16px;bottom:16px;background:#e8f8ef;color:#167a45;font:700 15px Inter;padding:10px 12px;border-radius:12px">Nice — your line is right. Slope = 2 ✓</div></div>`, r);
    const cur = make(`<div style="position:absolute">${CUR(26)}</div>`, r);
    return { tags: [t], update(lt) {
      const d = ease(span(lt, 0.3, 1.1));
      Object.assign(snip.style, { left: '85px', top: '150px', width: lerp(10, 440, d) + 'px', height: lerp(10, 300, d) + 'px', opacity: span(lt, 0.25, 0.35) * (1 - span(lt, 1.5, 1.7)) });
      cur.style.left = 85 + lerp(10, 440, d) + 'px'; cur.style.top = 150 + lerp(10, 300, d) + 'px'; cur.style.opacity = span(lt, 0.2, 0.3) * (1 - span(lt, 1.3, 1.5));
      const sl = out3(span(lt, 1.3, 1.9)); board.style.left = lerp(1000, 590, sl) + 'px';
      page.style.transform = `scale(${lerp(1, 0.94, sl)})`; page.style.transformOrigin = 'left center';
      board.querySelectorAll('.st').forEach((s, i) => { s.style.opacity = span(lt, 2.0 + i * 0.3, 2.2 + i * 0.3); });
      $('.ink', board).setAttribute('stroke-dashoffset', String(290 * (1 - ease(span(lt, 3.0, 3.7)))));
      const press = span(lt, 3.9, 4.05); $('.chk', board).style.transform = `scale(${1 - 0.1 * Math.sin(press * Math.PI)})`;
      $('.ok', board).style.opacity = span(lt, 4.05, 4.25); $('.ok', board).style.transform = `translateY(${(1 - out3(span(lt, 4.05, 4.4))) * 20}px)`;
    } };
  });
  scene(26.4, 31.2, 'maroon', (r) => {
    r.style.background = 'linear-gradient(135deg,#f6efe8,#efe3ea)';
    const t = tag('03', 'PDFs, slides & docs → reviewers');
    const ph = make(`<div class="phone" style="left:300px;top:40px;width:270px;height:540px"><div class="in"><div style="height:46px;display:grid;place-items:center;font:800 15px Inter;border-bottom:1px solid #e5e0d8">Cassie</div>
      <div class="bub u m1" style="top:62px;font-size:14px">Make a reviewer<div style="margin-top:6px;background:rgba(255,255,255,.15);border-radius:8px;padding:6px 8px;font:600 12px Inter">📄 Anatomy.pdf · 412 pages</div></div>
      <div class="bub a m2" style="top:150px;font-size:13px;max-width:82%"><b>Reviewer — Anatomy</b><br><b>Key terms</b><br>• <b>Tissue</b> — cells working together<br>• <b>Organ</b> — tissues with one job<br>• <b>System</b> — organs as a team<br><b>Practice</b><br>1. What links organs into systems?</div>
      <div class="m3" style="position:absolute;left:14px;right:14px;top:385px;background:#fff;border-radius:14px;box-shadow:0 8px 20px rgba(0,0,0,.1);padding:10px;display:flex;align-items:center;gap:10px"><div style="width:34px;height:42px;border-radius:7px;background:#2b579a;color:#fff;font:900 14px Inter;display:grid;place-items:center">W</div><div style="font:700 12px Inter;flex:1">Reviewer – Anatomy.docx<div style="font:500 11px Inter;color:#888">Word file · ready</div></div><div style="background:#16131c;color:#fff;font:800 11px Inter;padding:7px 10px;border-radius:999px">Download</div></div>
      <div class="dots" style="position:absolute;left:24px;top:150px;font:900 22px Inter;color:#999">• • •</div></div></div>`, r);
    const kinds = ['PDF', 'PowerPoint', 'Word', 'Photos', 'Google Slides'].map((k, i) => make(`<div style="position:absolute;font:800 22px Inter;background:#fff;padding:10px 16px;border-radius:999px;box-shadow:0 10px 24px rgba(0,0,0,.1)">${k}</div>`, r));
    return { tags: [t], update(lt) {
      const rot = lerp(-24, -6, out3(span(lt, 0, 1.2)));
      ph.style.transform = `perspective(1200px) rotateY(${rot}deg) rotateX(4deg) translateY(${(1 - out3(span(lt, 0, 0.8))) * 120}px)`;
      $('.m1', ph).style.opacity = span(lt, 0.5, 0.7);
      $('.dots', ph).style.opacity = span(lt, 0.9, 1.0) * (1 - span(lt, 1.9, 2.0));
      $('.m2', ph).style.opacity = span(lt, 2.0, 2.3); $('.m2', ph).style.clipPath = `inset(0 0 ${(1 - span(lt, 2.0, 3.2)) * 100}% 0)`;
      $('.m3', ph).style.opacity = span(lt, 3.4, 3.6); $('.m3', ph).style.transform = `scale(${back(span(lt, 3.4, 3.8))})`;
      kinds.forEach((k, i) => { k.style.left = (i % 2 ? 640 : 40) + (i > 3 ? 600 : 0) * 0 + 'px'; k.style.top = 90 + i * 92 + 'px'; if (i % 2 === 0) k.style.left = '40px'; else k.style.left = '640px'; popIn(k, lt, 0.4 + i * 0.18); });
    } };
  });
  scene(31.2, 33.6, 'red', (r) => {
    r.style.background = '#fbfaf7';
    const t = tag('04', 'Real graphs, not ASCII');
    const b = make(`<div style="position:absolute;left:170px;top:60px;width:660px;height:500px;background:#fff;border-radius:18px;box-shadow:0 20px 50px rgba(0,0,0,.12);padding:16px 20px"><div style="font:800 13px Inter;letter-spacing:.12em;color:#999">CASSIE’S BOARD</div><div style="font:800 26px Inter;margin:4px 0 6px">y = x² − 5x + 6</div>
      <svg viewBox="0 0 400 260" width="620" height="400"><g stroke="#eee">${Array.from({ length: 9 }, (_, i) => `<path d="M${40 + i * 40} 10V250"/>`).join('')}${Array.from({ length: 7 }, (_, i) => `<path d="M10 ${10 + i * 40}H390"/>`).join('')}</g><path d="M80 10V250M10 210H390" stroke="#999" stroke-width="2"/>
      <path class="par" d="${(() => { let d = ''; for (let i = 0; i <= 60; i++) { const x = -0.5 + i * 6.5 / 60, y = x * x - 5 * x + 6; d += (i ? 'L' : 'M') + (80 + x * 40).toFixed(1) + ' ' + (210 - y * 20).toFixed(1); } return d; })()}" fill="none" stroke="#d8343c" stroke-width="4" stroke-dasharray="900" stroke-dashoffset="900"/>
      <g class="pts"><circle cx="160" cy="210" r="7" fill="#16131c"/><circle cx="200" cy="210" r="7" fill="#16131c"/><circle cx="180" cy="215" r="6" fill="#3b7fe0"/><text x="140" y="240" font-size="15" font-weight="700">x=2</text><text x="196" y="240" font-size="15" font-weight="700">x=3</text></g></svg></div>`, r);
    return { tags: [t], update(lt) {
      b.style.transform = `translateY(${(1 - out3(span(lt, 0, 0.5))) * 60}px)`; b.style.opacity = span(lt, 0, 0.25);
      $('.par', b).setAttribute('stroke-dashoffset', String(900 * (1 - ease(span(lt, 0.4, 1.5)))));
      $('.pts', b).style.opacity = span(lt, 1.5, 1.7);
    } };
  });
  scene(33.6, 36, 'navy', (r) => {
    r.style.background = 'linear-gradient(135deg,#eef2ff,#f6f2ff)';
    const t = tag('05', 'Quiz me');
    const q = make(`<div style="position:absolute;left:40px;top:80px;width:560px"><div class="lbl">QUESTION 3 OF 10</div><div style="font:800 30px Inter;margin:8px 0 18px;letter-spacing:-.02em">What does the Krebs cycle make?</div>${['Glucose', 'Oxygen', 'NADH & FADH₂', 'Chlorophyll'].map((o, i) => `<div class="op" style="display:flex;align-items:center;gap:12px;background:#fff;border-radius:14px;padding:13px 16px;margin-bottom:10px;font:650 20px Inter;box-shadow:0 6px 16px rgba(0,0,0,.06)"><b style="width:30px;height:30px;border-radius:50%;background:#eee;display:grid;place-items:center;font-size:15px">${'ABCD'[i]}</b>${o}</div>`).join('')}<div class="ok" style="font:800 22px Inter;color:#167a45">Correct! 🎉 They carry energy to the next stage.</div></div>`, r);
    return { tags: [t], update(lt) {
      q.style.opacity = span(lt, 0, 0.2);
      q.querySelectorAll('.op').forEach((o, i) => { const sel = i === 2 && lt > 1.0; o.style.background = sel ? '#e8f8ef' : '#fff'; o.style.boxShadow = sel ? '0 0 0 3px #3fbf7f' : '0 6px 16px rgba(0,0,0,.06)'; o.style.opacity = span(lt, 0.15 + i * 0.1, 0.35 + i * 0.1); });
      $('.ok', q).style.opacity = span(lt, 1.15, 1.3);
    }, cast(lt) { const [x, y] = W(810, 360); return [{ id: 'quiz', outfit: 'coder', mood: lt < 1.1 ? 'thinking' : 'celebratory', x, y, s: 1.0 }]; } };
  });
  scene(36, 38.4, 'maroon', (r) => {
    r.style.background = 'linear-gradient(135deg,#f7efe9,#f1e6e9)';
    const t = tag('06', 'Research with real sources');
    const P = [['Mitochondrial ATP production in human cells', 'Smith, J., Lee, K., et al.', '2021', 'Cell Metabolism'], ['The citric acid cycle revisited', 'Garcia, M. & Chen, L.', '2019', 'Nature Reviews'], ['Energy pathways in exercise physiology', 'Okafor, A.', '2023', 'J. Physiology']];
    const cards = P.map(([ti, au, y, v]) => make(`<div class="card2" style="left:380px;width:580px;padding:14px 18px"><div style="font:800 19px Inter">${ti}</div><div style="font:500 15px Inter;color:#6f6a76;margin-top:4px">${au} (${y}) · <i>${v}</i></div><div style="display:flex;gap:8px;margin-top:8px"><span style="font:800 12px Inter;background:#16131c;color:#fff;padding:4px 9px;border-radius:999px">APA</span><span style="font:700 12px Inter;background:#f1edf7;padding:4px 9px;border-radius:999px">cited 1.2k</span></div></div>`, r));
    return { tags: [t], update(lt) { cards.forEach((c, i) => { c.style.top = 90 + i * 150 + 'px'; c.style.opacity = span(lt, 0.3 + i * 0.25, 0.5 + i * 0.25); c.style.transform = `translateX(${(1 - out3(span(lt, 0.3 + i * 0.25, 0.8 + i * 0.25))) * 60}px)`; }); },
      cast(lt) { const [x, y] = W(190, 360); return [{ id: 'grad', outfit: 'graduate', mood: 'thinking', x, y, s: 0.95 }]; } };
  });
  scene(38.4, 40.8, 'pink', (r) => {
    r.style.background = 'linear-gradient(135deg,#fff1ee,#fde6ea)';
    const t = tag('07', 'Talk & memory');
    const u = make(`<div class="bub u" style="top:110px;right:60px;font-size:20px">I’m so behind on bio 😩</div>`, r);
    const a = make(`<div class="bub a" style="top:190px;left:380px;max-width:540px;font-size:19px">Okay — breathe. We’ll do 25 minutes on the Krebs cycle, then a break. You’ve got this.</div>`, r);
    const m = ['🧠 remembers: Krebs cycle (weak spot)', '🔥 5-day streak', '📚 Biology · Chemistry'].map((txt) => make(`<div style="position:absolute;left:380px;font:700 17px Inter;background:#fff;padding:8px 14px;border-radius:999px;box-shadow:0 8px 20px rgba(0,0,0,.08)">${txt}</div>`, r));
    return { tags: [t], update(lt) {
      u.style.opacity = span(lt, 0.1, 0.3); a.style.opacity = span(lt, 0.6, 0.8); a.style.transform = `translateY(${(1 - out3(span(lt, 0.6, 1.0))) * 16}px)`;
      m.forEach((n, i) => { n.style.top = 330 + i * 56 + 'px'; popIn(n, lt, 1.1 + i * 0.2); });
    }, cast(lt) { const [x, y] = W(190, 360); return [{ id: 'heart', outfit: 'heart', mood: lt < 0.7 ? 'curious' : 'encouraging', x, y, s: 0.95 }]; } };
  });
  scene(40.8, 43.2, 'grey', (r) => {
    r.style.background = 'linear-gradient(135deg,#f2f1f6,#e9e7f0)';
    const t = tag('08', 'Focus timer');
    const ring = make(`<div style="position:absolute;left:400px;top:90px;width:300px;height:300px"><svg viewBox="0 0 200 200" width="300" height="300"><circle cx="100" cy="100" r="86" fill="none" stroke="#e1dde8" stroke-width="14"/><circle class="arc" cx="100" cy="100" r="86" fill="none" stroke="#16131c" stroke-width="14" stroke-linecap="round" transform="rotate(-90 100 100)" stroke-dasharray="540.35"/></svg><div class="tm" style="position:absolute;inset:0;display:grid;place-items:center;font:900 64px Inter;letter-spacing:-.04em"></div></div>`, r);
    const presets = ['25 · 5', '50 · 10', 'your own'].map((p) => make(`<div style="position:absolute;top:430px;font:800 20px Inter;background:#fff;padding:10px 18px;border-radius:999px;box-shadow:0 8px 20px rgba(0,0,0,.08)">${p}</div>`, r));
    return { tags: [t], update(lt) {
      const prog = span(lt, 0.2, 1.7), secs = Math.round(lerp(1500, 0, prog));
      $('.tm', ring).textContent = prog >= 1 ? 'Break!' : `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
      $('.arc', ring).setAttribute('stroke-dashoffset', String(540.35 * prog)); $('.arc', ring).setAttribute('stroke', prog >= 1 ? '#ee9a8c' : '#16131c');
      presets.forEach((p, i) => { p.style.left = 360 + i * 140 + 'px'; popIn(p, lt, 0.3 + i * 0.12); });
    }, cast(lt) { const [x, y] = W(200, 380); return [{ id: 'cl', outfit: 'classic', mood: lt < 1.7 ? 'typing' : 'sleep', x, y, s: 0.9 }]; } };
  });
  scene(43.2, 45.6, 'grey', (r) => {
    r.style.background = 'linear-gradient(135deg,#f4f2ee,#e7e5ec)';
    const t = tag('09', 'Student or Professional');
    const sw = make(`<div style="position:absolute;left:520px;top:150px;display:inline-grid;grid-template-columns:1fr 1fr;padding:6px;border-radius:999px;background:#fff;box-shadow:0 10px 26px rgba(0,0,0,.1)"><i class="th" style="position:absolute;top:6px;bottom:6px;left:6px;width:calc(50% - 6px);border-radius:999px;background:#16131c"></i><span class="a" style="position:relative;font:800 24px Inter;padding:14px 24px">Student</span><span class="b" style="position:relative;font:800 24px Inter;padding:14px 24px">Professional</span></div>`, r);
    const cap = make(`<div style="position:absolute;left:520px;top:260px;width:420px;font:650 24px/1.35 Inter;color:#4a4650"></div>`, r);
    return { tags: [t], update(lt) {
      const pro = ease(span(lt, 1.0, 1.3));
      $('.th', sw).style.transform = `translateX(${pro * 100}%)`;
      $('.a', sw).style.color = pro < 0.5 ? '#fff' : '#6f6a76'; $('.b', sw).style.color = pro >= 0.5 ? '#fff' : '#6f6a76';
      cap.innerHTML = pro < 0.5 ? 'Study help — explanations, reviewers, quizzes.' : 'Work help — emails, reports, decks. <b>Suit on.</b>';
      sw.style.opacity = span(lt, 0, 0.2);
    }, cast(lt) { const [x, y] = W(250, 340); const pro = lt > 1.15; return [{ id: pro ? 'pro' : 'stu', outfit: pro ? 'professor' : 'classic', mood: pro ? 'celebratory' : 'happy', x, y, s: 1.05 * (pro ? back(span(lt, 1.15, 1.5)) : 1 - span(lt, 1.0, 1.15)) }]; } };
  });
  scene(45.6, 48, 'red', (r) => {
    const bg = make(`<div style="position:absolute;inset:0"></div>`, r);
    const t = tag('10', 'Your colour, everywhere');
    const SW = ['#d8343c', '#3b7fe0', '#2fae74', '#9b5de5'];
    const row = make(`<div style="position:absolute;left:520px;top:200px;display:flex;gap:16px">${SW.map((c) => `<i style="width:66px;height:66px;border-radius:50%;background:${c};box-shadow:0 8px 20px rgba(0,0,0,.15)"></i>`).join('')}</div>`, r);
    const cap = make(`<div style="position:absolute;left:520px;top:300px;width:420px;font:650 24px/1.35 Inter;color:#2a2730">Pick a colour — the background and Cassie follow it.</div>`, r);
    const cur = make(`<div style="position:absolute">${CUR(28)}</div>`, r);
    const pick = (lt) => (lt < 0.6 ? 0 : lt < 1.3 ? 1 : lt < 1.9 ? 2 : 3);
    return { tags: [t], pick, SW, update(lt) {
      const i = pick(lt), c = SW[i];
      bg.style.background = `radial-gradient(60% 80% at 25% 60%, ${c}55, transparent 70%), radial-gradient(50% 60% at 80% 20%, ${c}33, transparent 70%), #faf8f5`;
      [...row.children].forEach((n, j) => { n.style.outline = j === i ? '4px solid #16131c' : 'none'; n.style.outlineOffset = '4px'; });
      cur.style.left = 520 + i * 82 + 40 + 'px'; cur.style.top = '236px';
    }, cast(lt) { const [x, y] = W(250, 350); return [{ id: 'col', outfit: 'classic', mood: 'happy', accent: SW[pick(lt)], x, y, s: 1.05 }]; } };
  });
  scene(48, 50.4, 'green', (r) => {
    r.style.background = 'linear-gradient(135deg,#eef7f1,#f3f0f8)';
    const t = tag('11', 'Anywhere · private · free');
    const mon = make(`<div class="monitor" style="left:60px;top:90px;width:420px;height:360px"><div class="scr" style="left:0;top:0;width:420px;height:260px;padding:8px"><div style="background:#f3f3f3;width:100%;height:100%;border-radius:4px;display:flex"><div style="flex:1;padding:10px"><div style="height:12px;background:#ddd;border-radius:4px;width:60%"></div>${'<div style="height:7px;background:#e8e8e8;border-radius:4px;margin-top:8px"></div>'.repeat(10)}</div><div style="width:130px;background:#fff;border-left:1px solid #ddd;padding:8px"><div style="font:800 11px Inter">Cassie</div><div style="display:flex;gap:4px;margin-top:6px"><i style="flex:1;height:26px;border:1px solid #ddd;border-radius:6px"></i><i style="flex:1;height:26px;border:1px solid #ddd;border-radius:6px"></i><i style="flex:1;height:26px;border:1px solid #ddd;border-radius:6px"></i></div><div style="height:60px;background:#f6f4f0;border-radius:6px;margin-top:8px"></div></div></div></div><div class="stand" style="left:180px;top:260px;width:60px;height:70px"></div><div class="stand" style="left:130px;top:326px;width:160px;height:10px;border-radius:5px"></div></div>`, r);
    const ph = make(`<div class="phone" style="left:520px;top:110px;width:170px;height:340px;border-radius:32px;padding:8px"><div class="in" style="border-radius:26px;background:linear-gradient(160deg,#fde7e3,#e9e4ff)"><div style="font:800 12px Inter;text-align:center;padding-top:14px">Cassie</div></div></div>`, r);
    const chips = ['Chrome', 'PDF viewer', 'Phone app', '🔒 notes stay on your device', 'no account', 'free'].map((c) => make(`<div style="position:absolute;font:800 18px Inter;background:${c.startsWith('🔒') ? '#16131c' : '#fff'};color:${c.startsWith('🔒') ? '#fff' : '#16131c'};padding:9px 15px;border-radius:999px;box-shadow:0 8px 20px rgba(0,0,0,.08)">${c}</div>`, r));
    return { tags: [t], update(lt) {
      mon.style.opacity = span(lt, 0, 0.2); ph.style.transform = `perspective(900px) rotateY(${lerp(-30, -10, out3(span(lt, 0, 0.8)))}deg)`;
      const pos = [[730, 120], [730, 180], [730, 240], [520, 470], [60, 470], [200, 470]];
      chips.forEach((c, i) => { c.style.left = pos[i][0] + 'px'; c.style.top = pos[i][1] + 'px'; popIn(c, lt, 0.3 + i * 0.15); });
    } };
  });

  // TRY IT --------------------------------------------------------------------
  scene(50.4, 52.8, 'red', (r) => {
    const a = make(`<div style="position:absolute;left:330px;top:200px;font:550 64px Inter;letter-spacing:-.035em">Whatever you’re</div>`, r);
    const b = make(`<div style="position:absolute;left:160px;top:300px;font:550 64px Inter;letter-spacing:-.035em"><span style="color:#d8343c">studying,</span></div>`, r);
    return { update(lt) { [[a, 0.1], [b, 0.6]].forEach(([n, at]) => { const k = span(lt, at, at + 0.4); n.style.opacity = k; n.style.filter = `blur(${(1 - k) * 14}px)`; n.style.transform = `translateX(${(1 - out3(k)) * 40}px)`; }); } };
  });
  scene(52.8, 55.2, 'pink', (r) => {
    const k = kin(r, ['Cassie', 'explains', 'it.'], [0]); k.style.alignItems = 'flex-start'; k.style.paddingTop = '90px';
    return { update(lt) { kinUpdate(k, lt, 0.05, 0.2); },
      cast(lt) { return ['classic', 'professor', 'graduate', 'coder', 'heart'].map((o, i) => { const [x, y] = W(160 + i * 170, 420); return { id: 'line' + i, outfit: o, mood: i % 2 ? 'happy' : 'encouraging', x, y, s: 0.62 * back(span(lt, 0.5 + i * 0.1, 0.9 + i * 0.1)) }; }); } };
  });
  scene(55.2, 60, 'red', (r) => {
    const a = make(`<div style="position:absolute;left:90px;top:250px;font:600 68px Inter;letter-spacing:-.04em">Your new</div>`, r);
    const b = make(`<div style="position:absolute;left:560px;top:250px;font:600 68px Inter;letter-spacing:-.04em">study buddy</div>`, r);
    const url = make(`<div style="position:absolute;left:0;right:0;top:420px;text-align:center"><span style="display:inline-block;background:#16131c;color:#fff;font:800 30px Inter;padding:16px 28px;border-radius:999px">askcassie.pages.dev · free</span></div>`, r);
    return { update(lt) {
      [[a, 0.05], [b, 0.35]].forEach(([n, at]) => { const k = span(lt, at, at + 0.4); n.style.opacity = k; n.style.filter = `blur(${(1 - k) * 14}px)`; });
      url.style.opacity = span(lt, 2.2, 2.5); url.style.transform = `scale(${0.9 + 0.1 * back(span(lt, 2.2, 2.6))})`;
    }, cast(lt) { const [x, y] = W(470, 290); return [{ id: 'buddy', outfit: 'classic', mood: lt > 2.2 ? 'celebratory' : 'happy', x, y, s: 0.62 * back(span(lt, 0.2, 0.6)), shadow: false }]; } };
  });

  /* ---------------- frame chrome: glow, wave, chapters, ruler ---------------- */
  const glow = $('#glow');
  const blobs = [0, 1, 2, 3, 4].map(() => make('<i></i>', glow));
  const wave = $('#wave'), wg = wave.getContext('2d');
  wave.style.width = '1000px'; wave.style.height = '300px'; wave.style.filter = 'blur(10px)';
  const chs = [...document.querySelectorAll('#chapters div')];
  const ruler = $('#ruler');
  const ticks = Array.from({ length: 60 }, (_, i) => make(`<i class="${i % 5 === 0 ? 'big' : ''}"></i>`, ruler));
  const hexRGB = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  let palNow = null;
  function chrome(t, s) {
    const target = PAL[s ? s.pal : 'red'].map(hexRGB);
    if (!palNow) palNow = target.map((c) => c.slice());
    palNow = palNow.map((c, i) => c.map((v, j) => v + (target[i][j] - v) * 0.12));
    const rgba = (i, a) => `rgba(${palNow[i].map(Math.round).join(',')},${a})`;
    // glow under the card
    blobs.forEach((b, i) => {
      const x = 230 + i * 220 + Math.sin(t * 0.6 + i) * 70, y = 170 + Math.cos(t * 0.5 + i * 1.7) * 50 + (i % 2) * 90;
      Object.assign(b.style, { left: x - 300 + 'px', top: y - 210 + 'px', width: '600px', height: '420px', background: rgba(i % 3, 1) });
    });
    // soft wave at the bottom of the card
    wg.clearRect(0, 0, 500, 150);
    for (let i = 0; i < 70; i++) {
      const x = i * 7.3, h = 30 + 45 * (0.5 + 0.5 * Math.sin(i * 0.45 + t * 2.2)) * (0.6 + 0.4 * Math.sin(i * 0.13 - t));
      const gr = wg.createLinearGradient(0, 150 - h, 0, 150);
      gr.addColorStop(0, rgba(i % 2 ? 1 : 0, 0)); gr.addColorStop(1, rgba(i % 2 ? 1 : 0, 0.55));
      wg.fillStyle = gr; wg.fillRect(x, 150 - h, 9, h);
    }
    wave.style.opacity = s && s.root.style.background ? 0.35 : 0.9;
    // chapters
    chs.forEach((c, i) => {
      const [a, b] = CH[i], on = t >= a && t < b;
      c.classList.toggle('on', on);
      const st = $('.streak', c);
      st.style.opacity = on ? 1 : 0; st.style.left = `calc(${span(t, a, b) * 100}% - 5px)`;
    });
    ticks.forEach((tk, i) => { tk.style.left = ((i * 24 - t * 60) % 1440 + 1440) % 1440 - 200 + 'px'; });
  }

  /* ---------------- seek ---------------- */
  CassieStage.mount($('#stage'));
  const flash = $('#flash');
  window.seek = function (t) {
    const s = scenes.find((x) => t >= x.t0 && t < x.t1) || scenes[scenes.length - 1];
    scenes.forEach((x) => {
      const on = x === s;
      x.root.style.display = on ? 'block' : 'none';
      (x.tags || []).forEach((g) => { g.style.display = on ? '' : 'none'; });
    });
    const lt = t - s.t0;
    // blur-in transition into each scene
    const k = span(lt, 0, 0.32);
    s.root.style.filter = k < 1 ? `blur(${(1 - k) * 16}px)` : 'none';
    s.root.style.transform = `scale(${lerp(1.04, 1, out3(k))})`;
    s.update(lt);
    (s.tags || []).forEach((g) => { g.style.opacity = span(lt, 0.1, 0.3); });
    flash.style.opacity = (1 - span(lt, 0, 0.12)) * 0.5 * (t > 0.1 ? 1 : 0);
    chrome(t, s);
    CassieStage.set(s.cast ? s.cast(lt) : []);
    CassieStage.frame(t);
  };
  (function wait() { if (CassieStage.isReady()) { window.seek(0); window.READY = true; } else setTimeout(wait, 50); })();
})();

/* Cassie — 60-second Instagram reel (1080×1920, 100 BPM, cuts on the bar).
   window.seek(t) draws the frame at t seconds: background, captions, UI mock-ups and
   the 3D felt Cassies (rendered frame-exact by build/cassie-stage.js). */
(function () {
  'use strict';
  const BEAT = 0.6, BAR = 2.4, DUR = 60;
  const $ = (s) => document.querySelector(s);
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const span = (t, a, b) => clamp((t - a) / (b - a));
  const ease = (k) => { k = clamp(k); return k * k * (3 - 2 * k); };
  const back = (k) => { k = clamp(k); const c = 1.70158; return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2); };
  const lerp = (a, b, k) => a + (b - a) * k;

  /* ---------------- scenes ---------------- */
  const S = {
    hook: [0, 4.8], panic: [4.8, 9.6], highlight: [9.6, 16.8], outfits: [16.8, 31.2],
    pdf: [31.2, 40.8], rest: [40.8, 48], free: [48, 55.2], cta: [55.2, 60],
  };
  const inS = (t, k) => t >= S[k][0] && t < S[k][1];

  /* ---------------- background: soft moving felt-coloured blobs ---------------- */
  const PAL = {
    hook: ['#f3ede4', '#f2b8b0', '#e64b55', '#f7efe6'],
    panic: ['#1c1b22', '#3b2a4a', '#5a3355', '#24222c'],
    highlight: ['#efe9df', '#cfd9ee', '#f2c9c4', '#f7f2ea'],
    classic: ['#f6d9d3', '#e8545c', '#f3b3aa', '#fbeee8'],
    professor: ['#2a2b31', '#5e6573', '#9aa1ae', '#1d1d22'],
    graduate: ['#4b1d24', '#8a3a46', '#c9a04a', '#3a161c'],
    coder: ['#0f1530', '#24346a', '#3b7fe0', '#0b1024'],
    heart: ['#f6d4cc', '#ee9a8c', '#f7b9c8', '#fbece7'],
    lineup: ['#f3ede4', '#d9d3e6', '#f2c9c4', '#f7f2ea'],
    pdf: ['#efe9df', '#d6c5b0', '#c9a04a', '#f7f2ea'],
    rest: ['#2b2340', '#5b4b8a', '#ee9a8c', '#1f1a30'],
    free: ['#e9f1ec', '#b9dcc6', '#f2c9c4', '#f6f2ea'],
    cta: ['#1b1a20', '#e64b55', '#8e8a92', '#121116'],
  };
  const OUTFIT_BARS = ['classic', 'professor', 'graduate', 'coder', 'heart', 'lineup'];
  function paletteAt(t) {
    if (inS(t, 'outfits')) return PAL[OUTFIT_BARS[Math.min(5, Math.floor((t - S.outfits[0]) / BAR))]];
    for (const k of Object.keys(S)) if (inS(t, k)) return PAL[k];
    return PAL.cta;
  }
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  let curPal = null;
  const bg = $('#bg'), g = bg.getContext('2d');
  bg.style.width = '1080px'; bg.style.height = '1920px';
  function drawBg(t) {
    const target = paletteAt(t).map(hex);
    if (!curPal) curPal = target.map((c) => c.slice());
    curPal = curPal.map((c, i) => c.map((v, j) => v + (target[i][j] - v) * 0.22)); // glide between scenes
    const col = (i, a = 1) => `rgba(${curPal[i].map(Math.round).join(',')},${a})`;
    const lin = g.createLinearGradient(0, 0, 540, 960);
    lin.addColorStop(0, col(0)); lin.addColorStop(1, col(3));
    g.fillStyle = lin; g.fillRect(0, 0, 540, 960);
    const blobs = [[1, 0.25, 0.3, 420], [2, 0.75, 0.62, 380], [1, 0.4, 0.9, 340], [2, 0.15, 0.7, 260]];
    blobs.forEach(([ci, bx, by, r], i) => {
      const x = 540 * bx + Math.sin(t * 0.5 + i * 2) * 70, y = 960 * by + Math.cos(t * 0.4 + i * 1.3) * 90;
      const rg = g.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, col(ci, 0.75)); rg.addColorStop(1, col(ci, 0));
      g.fillStyle = rg; g.fillRect(0, 0, 540, 960);
    });
  }

  /* ---------------- overlay elements ---------------- */
  const front = $('#front'), backL = $('#back');
  const el = (html, parent = front) => { const d = document.createElement('div'); d.innerHTML = html.trim(); const n = d.firstChild; parent.appendChild(n); return n; };
  const CURSOR = '<svg viewBox="100 80 305 350" width="64" height="74"><path d="M108 90 L395 259 L275 281 L342 399 L287 422 L225 300 L108 382 Z" fill="#fff" stroke="#0b0a0f" stroke-width="22" stroke-linejoin="round" paint-order="stroke"/></svg>';

  const capHook = el(`<div class="cap"><div class="pill small">POV:</div><div class="pill">your study buddy is</div><div class="pill">literally a <span class="hl"><span class="sel"></span>fluffball</span></div></div>`);
  const hookCursor = el(`<div class="cursor">${CURSOR}</div>`);
  const capPanic = el(`<div class="cap" style="top:1500px"><div class="pill dark">47 slides. exam tomorrow.</div><div class="pill small">brain: buffering… 😵‍💫</div></div>`);
  const clock = el(`<div class="clock">2:00 AM</div>`, backL);
  const slides = Array.from({ length: 7 }, () => el(`<div class="card slide"><div class="t"></div><div class="l"></div><div class="l"></div><div class="l" style="width:70%"></div></div>`, backL));
  const capHl = el(`<div class="cap"><div class="pill">just highlight it.</div><div class="pill dark">she explains it.</div></div>`);
  const phone = el(`<div class="phone"><div class="bar">biology-notes.edu · cellular respiration</div><div class="doc"><h4>Cellular Respiration</h4>Cells release the energy stored in glucose in stages. <mark><span class="sw"></span>The Krebs cycle turns acetyl-CoA into CO₂, NADH and FADH₂.</mark> Without oxygen, the whole process stalls.</div>
    <div class="pop"><div class="ph">CASSIE</div><span class="ty"></span></div></div>`);
  const phoneCursor = el(`<div class="cursor">${CURSOR}</div>`);
  const POP_TEXT = 'It’s the cell’s <b>recycling loop</b>: it breaks acetyl-CoA down into CO₂ and loads up <b>NADH & FADH₂</b> — the “batteries” the next stage cashes in for ATP.';
  const capOut = el(`<div class="cap"><div class="pill">she dresses for the job</div></div>`);
  const label = el(`<div class="label" style="top:420px"><h2></h2><p></p></div>`);
  const chips = el(`<div class="chips"><div class="seg"><span data-k="student">Student</span><span data-k="pro">Professional</span></div><div class="chip" data-k="research">Research</div><div class="chip" data-k="quiz">Quiz me</div><div class="chip" data-k="talk">Talk</div></div>`);
  const capPdf = el(`<div class="cap"><div class="pill">drop a 412-page PDF</div><div class="pill dark">get a reviewer in seconds</div></div>`);
  const pdf = el(`<div class="card pdf"><span class="tag">PDF</span><div class="nm">Anatomy &amp; Physiology.pdf</div><div class="ln"></div><div class="ln"></div><div class="ln" style="width:70%"></div><div class="ln"></div><div class="ln" style="width:55%"></div></div>`);
  const file = el(`<div class="card file"><div class="ico">W</div><div><b>Reviewer – Anatomy.docx</b><small>Word file · ready</small></div><div class="dl">Download</div></div>`);
  const capRest = el(`<div class="cap"><div class="pill">she makes you rest too</div><div class="pill small">25 min focus · 5 min break 🫶</div></div>`);
  const ring = el(`<div class="ring"><svg viewBox="0 0 200 200" width="400" height="400"><circle cx="100" cy="100" r="86" fill="none" stroke="rgba(255,255,255,.18)" stroke-width="14"/><circle class="arc" cx="100" cy="100" r="86" fill="none" stroke="#fff" stroke-width="14" stroke-linecap="round" transform="rotate(-90 100 100)" stroke-dasharray="540.35" stroke-dashoffset="0"/></svg><div class="t">25:00</div><div class="m">focus</div></div>`);
  const capFree = el(`<div class="cap"></div>`);
  const FREE = ['free to start', 'no account needed', 'your notes stay on your phone'];
  FREE.forEach((txt, i) => el(`<div class="pill ${i === 1 ? 'dark' : ''}">${txt}</div>`, capFree));
  const cta = el(`<div class="cta"><div class="logo"><i>${CURSOR.replace('width="64" height="74"', 'width="70" height="80"').replace('fill="#fff"', 'fill="#121116"').replace('stroke="#0b0a0f"', 'stroke="#121116"')}</i>Cassie</div><p>Highlight anything.<br>Cassie explains it.</p><div class="url">link in bio · askcassie.pages.dev</div></div>`);
  const flash = $('#flash');

  function show(n, o, extra = '') { n.style.opacity = o; n.style.display = o <= 0.001 ? 'none' : ''; if (extra) n.style.transform = extra; }
  function pills(container, t, t0, t1, gap = BEAT) {
    // each pill pops in on its beat, everything fades out at t1
    [...container.children].forEach((p, i) => {
      const k = back(span(t, t0 + i * gap, t0 + i * gap + 0.32));
      const out = 1 - ease(span(t, t1 - 0.25, t1));
      p.style.opacity = Math.min(span(t, t0 + i * gap, t0 + i * gap + 0.12), out);
      p.style.transform = `translateY(${(1 - k) * 40}px) scale(${0.85 + 0.15 * k})`;
    });
    container.style.display = t >= t0 - 0.05 && t <= t1 + 0.05 ? '' : 'none';
  }

  /* ---------------- 3D cast per frame ---------------- */
  function cast(t) {
    const A = [];
    if (inS(t, 'hook')) {
      const k = span(t, 0.2, 2.2);
      A.push({ id: 'red', outfit: 'classic', mood: k < 1 ? 'walk' : (t < 3.2 ? 'happy' : 'encouraging'), facing: 1, x: lerp(-2.2, 0, ease(k) * 0.4 + k * 0.6), y: -0.55, s: 1.25 });
    } else if (inS(t, 'panic')) {
      A.push({ id: 'red', outfit: 'classic', mood: t < 7.8 ? 'dizzy' : 'sleep', x: 0, y: -0.15, s: 1.15 });
    } else if (inS(t, 'highlight')) {
      const t0 = S.highlight[0];
      A.push({ id: 'red', outfit: 'classic', mood: t < t0 + 3.2 ? 'thinking' : 'happy', x: 0.86, y: 1.02, s: 0.42, shadow: false });
    } else if (inS(t, 'outfits')) {
      const i = Math.min(5, Math.floor((t - S.outfits[0]) / BAR)), lt = t - S.outfits[0] - i * BAR;
      const pop = back(span(lt, 0, 0.42));
      if (i < 5) {
        const o = OUTFIT_BARS[i];
        const mood = { classic: 'happy', professor: lt < 1.2 ? 'walk' : 'celebratory', graduate: 'thinking', coder: 'thinking', heart: 'encouraging' }[o];
        A.push({ id: 'o' + i, outfit: o, mood, facing: 1, x: 0, y: -0.22, s: 1.15 * pop });
      } else {
        const row = [['classic', -0.76, 0.5], ['professor', 0, 0.5], ['graduate', 0.76, 0.5], ['coder', -0.42, -0.72], ['heart', 0.42, -0.72]];
        row.forEach(([o, x, y], j) => A.push({ id: 'l' + j, outfit: o, mood: j % 2 ? 'happy' : 'encouraging', x, y, s: 0.47 * back(span(lt, j * 0.08, j * 0.08 + 0.4)) }));
      }
    } else if (inS(t, 'pdf')) {
      const lt = t - S.pdf[0];
      A.push({ id: 'grad', outfit: 'graduate', mood: lt < 1.6 ? 'curious' : lt < 4.4 ? 'thinking' : 'celebratory', x: 0, y: -0.05, s: 1.15 });
    } else if (inS(t, 'rest')) {
      A.push({ id: 'heart', outfit: 'heart', mood: 'sleep', x: 0, y: -0.45, s: 1.2 });
    } else if (inS(t, 'free')) {
      const lt = t - S.free[0];
      // a little parade: leader in front, the others a step behind
      const lead = lerp(-1.5, 3.3, lt / 7.2);
      [['classic', 0], ['coder', 0.88], ['professor', 1.76]].forEach(([o, off], j) => {
        A.push({ id: 'w' + j, outfit: o, mood: 'walk', facing: 1, x: lead - off, y: -0.75, s: 0.72 });
      });
    } else {
      A.push({ id: 'end', outfit: 'classic', mood: t > S.cta[0] + 0.6 ? 'celebratory' : 'happy', x: 0, y: -0.35, s: 1.3 * back(span(t, S.cta[0], S.cta[0] + 0.45)) });
    }
    return A;
  }

  /* ---------------- overlays per frame ---------------- */
  function overlays(t) {
    // hook
    pills(capHook, t, 0.15, S.hook[1], 0.5);
    const hs = span(t, 2.0, 2.9);
    capHook.querySelector('.sel').style.transform = `scaleX(${ease(hs)})`;
    const hlRect = { x: 700, y: 520 };
    show(hookCursor, t > 1.7 && t < S.hook[1] - 0.2 ? 1 : 0, `translate(${lerp(hlRect.x - 150, hlRect.x + 170, ease(hs))}px, ${hlRect.y + 20}px)`);

    // panic
    show(clock, inS(t, 'panic') ? Math.min(1, span(t, 4.8, 5.1)) : 0, `scale(${0.9 + 0.1 * back(span(t, 4.8, 5.2))})`);
    slides.forEach((s, i) => {
      const on = inS(t, 'panic');
      const a = i * 0.9, r = 330 + (i % 3) * 60;
      const x = 540 + Math.cos(a + t * 0.9) * r - 130, y = 1060 + Math.sin(a + t * 1.2) * (r * 0.55) - 80;
      s.style.left = x + 'px'; s.style.top = y + 'px';
      show(s, on ? Math.min(1, span(t, 4.8 + i * 0.12, 5.1 + i * 0.12)) : 0, `rotate(${Math.sin(t * 2 + i) * 18}deg)`);
    });
    pills(capPanic, t, 5.4, S.panic[1], 0.9);

    // highlight demo
    const h0 = S.highlight[0];
    const ph = inS(t, 'highlight');
    show(phone, ph ? 1 : 0, `translateY(${(1 - back(span(t, h0, h0 + 0.5))) * 400}px)`);
    pills(capHl, t, h0 + 0.2, S.highlight[1], 1.2);
    const drag = span(t, h0 + 0.9, h0 + 2.3);
    phone.querySelector('.sw').style.transform = `scaleX(${ease(drag)})`;
    show(phoneCursor, ph && t < h0 + 3.0 ? 1 : 0, `translate(${lerp(210, 820, ease(drag))}px, ${lerp(1170, 1290, ease(drag))}px)`);
    const pop = phone.querySelector('.pop');
    pop.style.opacity = span(t, h0 + 2.6, h0 + 2.9);
    pop.style.transform = `translateY(${(1 - back(span(t, h0 + 2.6, h0 + 3.0))) * 40}px)`;
    const n = Math.floor(span(t, h0 + 2.8, h0 + 5.6) * POP_TEXT.replace(/<[^>]+>/g, '').length);
    let shown = 0, out = '';
    for (const part of POP_TEXT.split(/(<[^>]+>)/)) { if (part.startsWith('<')) out += part; else { const take = part.slice(0, Math.max(0, n - shown)); out += take; shown += part.length; } }
    pop.querySelector('.ty').innerHTML = out;

    // outfits
    const o0 = S.outfits[0];
    const inO = inS(t, 'outfits');
    pills(capOut, t, o0 + 0.1, o0 + BAR * 0.9, 0);
    const i = Math.min(5, Math.floor((t - o0) / BAR)), lt = t - o0 - i * BAR;
    const LABELS = [['Student', 'your classic fluffball'], ['Professional', 'emails · reports · decks'], ['Research', 'real papers · real citations'], ['Quiz me', 'practice till it sticks'], ['Talk', 'real talk, no judgement'], ['pick your buddy', 'one tap away']];
    if (inO) {
      label.querySelector('h2').textContent = LABELS[i][0];
      label.querySelector('p').textContent = LABELS[i][1];
      label.style.top = i === 0 ? '440px' : '270px';
      const dark = ['professor', 'graduate', 'coder'].includes(OUTFIT_BARS[i]);
      label.querySelector('h2').style.color = dark ? '#fff' : '#121116';
      label.querySelector('p').style.color = dark ? 'rgba(255,255,255,.9)' : 'rgba(18,17,22,.75)';
      label.querySelector('h2').style.textShadow = dark ? '0 8px 30px rgba(0,0,0,.35)' : 'none';
      show(label, i === 0 && t < o0 + BAR * 0.9 ? span(lt, 1.4, 1.6) : Math.min(span(lt, 0.05, 0.2), 1), `scale(${0.9 + 0.1 * back(span(lt, 0.05, 0.4))})`);
    } else show(label, 0);
    const active = ['student', 'pro', 'research', 'quiz', 'talk', ''][i] || '';
    chips.querySelectorAll('[data-k]').forEach((c) => c.classList.toggle('on', inO && c.dataset.k === active));
    show(chips, inO ? span(t, o0, o0 + 0.3) : 0, `translateY(${inO && i === 5 ? 60 : 0}px)`);
    // flash + "poof" on each outfit change
    let fl = 0;
    for (let b = 1; b <= 5; b++) { const e = o0 + b * BAR; if (t >= e) fl = Math.max(fl, 1 - span(t, e, e + 0.18)); }
    if (!inO) fl = 0;
    for (const edge of [S.panic[0], S.highlight[0], S.pdf[0], S.rest[0], S.free[0], S.cta[0]]) fl = Math.max(fl, (1 - span(t, edge, edge + 0.16)) * (t >= edge ? 0.85 : 0));
    flash.style.opacity = fl * 0.75;

    // pdf → reviewer
    const p0 = S.pdf[0], inP = inS(t, 'pdf');
    pills(capPdf, t, p0 + 0.2, S.pdf[1], 1.8);
    const fly = ease(span(t, p0 + 0.6, p0 + 1.8));
    pdf.style.left = lerp(700, 400, fly) + 'px'; pdf.style.top = lerp(560, 1080, fly) + 'px';
    show(pdf, inP && t < p0 + 2.0 ? 1 - span(t, p0 + 1.6, p0 + 2.0) : 0, `scale(${lerp(1, 0.25, fly)}) rotate(${lerp(-12, 20, fly)}deg)`);
    show(file, inP ? span(t, p0 + 4.4, p0 + 4.7) : 0, `translateY(${(1 - back(span(t, p0 + 4.4, p0 + 4.9))) * 160}px)`);
    file.style.top = '1480px';

    // rest
    const r0 = S.rest[0], inR = inS(t, 'rest');
    pills(capRest, t, r0 + 0.2, S.rest[1], 1.2);
    show(ring, inR ? span(t, r0, r0 + 0.4) : 0);
    ring.style.top = '520px';
    const prog = span(t, r0 + 0.5, r0 + 5.5);
    const secs = Math.round(lerp(25 * 60, 0, prog));
    ring.querySelector('.t').textContent = prog >= 1 ? '5:00' : `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    ring.querySelector('.m').textContent = prog >= 1 ? 'break time' : 'focus';
    ring.querySelector('.arc').setAttribute('stroke-dashoffset', String(540.35 * (prog >= 1 ? 0 : prog)));
    ring.querySelector('.arc').setAttribute('stroke', prog >= 1 ? '#ee9a8c' : '#fff');

    // free & private
    pills(capFree, t, S.free[0] + 0.2, S.free[1], BAR * 0.9);

    // cta
    const c0 = S.cta[0];
    show(cta, t >= c0 ? span(t, c0 + 0.1, c0 + 0.4) : 0, `translateY(${(1 - back(span(t, c0 + 0.1, c0 + 0.6))) * 40}px)`);
    cta.querySelector('.url').style.transform = `scale(${0.9 + 0.1 * back(span(t, c0 + 0.8, c0 + 1.2))}) translateY(0)`;
    cta.querySelector('.url').style.opacity = span(t, c0 + 0.8, c0 + 1.0);
    cta.style.top = '260px';
    cta.querySelector('.url').style.marginTop = '1020px';
  }

  /* ---------------- frame ---------------- */
  CassieStage.mount($('#stage'));
  window.seek = function (t) {
    drawBg(t);
    overlays(t);
    CassieStage.set(cast(t));
    CassieStage.frame(t);
  };
  window.DUR = DUR;
  (function wait() { if (CassieStage.isReady()) { window.seek(0); window.READY = true; } else setTimeout(wait, 50); })();
})();

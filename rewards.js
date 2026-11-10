/* Cassie's rewards: the streak flame and the school medals.
 *
 * The flame grows and changes colour as the streak climbs (Ember, Gold, Rose, Violet, Mint, then Sky,
 * the hottest). A normal goal day gets a small toast; a new flame gets the full moment: the flame
 * pops up alone and grows, then the panel fades in behind it. Drag the flame to spin it.
 *
 * Awards are school medals on a neck ribbon: the award name in big white letters on a coloured band,
 * a laurel, a raised emblem, and the back engraved with the student's name and the date. Earning one
 * drops it in on its ribbon to swing, with confetti; drag it to flip it. "My awards" is the shelf.
 *
 * Everything is drawn in SVG (no pictures to download). Reduce Motion and Lite mode keep it still.
 * app.js uses window.CassieRewards; memory.js decides when a goal is met or an award is earned.
 */
(function () {
  'use strict';
  const reduced = () => document.documentElement.classList.contains('lite')
    || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let uidc = 0;
  const uid = (p) => p + 'rw' + (uidc++);
  let getName = () => '';
  const tight = (svg) => svg.replace(/>\s+</g, '><').replace(/\s{2,}/g, ' '); // (no blank text inside a drawing)

  /* ---------------- the streak flame ---------------- */
  const TIERS = [
    { at: 1, name: 'Ember', scale: 0.62, body: ['#fff2b0', '#ffb13d', '#f05a24', '#c22d1a'], inner: ['#fffbe6', '#ffd37a'], glow: '#ff8a3d', ground: '#f0592a', pill: '#ffab6b' },
    { at: 7, name: 'Gold', scale: 0.76, body: ['#fff6cf', '#ffcf4a', '#e59a1a', '#b3740f'], inner: ['#fffdf0', '#ffe59e'], glow: '#ffcf4a', ground: '#e59a1a', pill: '#ffd76a' },
    { at: 14, name: 'Rose', scale: 0.9, body: ['#ffd9e4', '#f573a0', '#c83f67', '#8f2846'], inner: ['#fff4f8', '#ffb3cc'], glow: '#ff5c8a', ground: '#b8395a', pill: '#f7a3b8' },
    { at: 30, name: 'Violet', scale: 1.04, body: ['#f1dcff', '#b170f3', '#7d36dc', '#55249e'], inner: ['#fbf3ff', '#d9b3ff'], glow: '#a865f0', ground: '#7d36dc', pill: '#c9a3f7' },
    { at: 60, name: 'Mint', scale: 1.18, body: ['#d6fff2', '#4fd4b0', '#2a9e7e', '#1c6e58'], inner: ['#f0fffa', '#b3f0dd'], glow: '#4fd4b0', ground: '#2a9e7e', pill: '#7fe3c6' },
    { at: 100, name: 'Sky', scale: 1.34, body: ['#d6f1ff', '#52b0f5', '#2566d8', '#1842a0'], inner: ['#f0fbff', '#a9ddff'], glow: '#4aa8f0', ground: '#2566d8', pill: '#8cc8fa', legend: true },
  ];
  const tierFor = (n) => TIERS.filter((t) => n >= t.at).pop() || TIERS[0];
  const nextTier = (n) => TIERS.find((t) => t.at > n) || null;
  // bigger every day, not only at a new flame: the tier's size and up to 85% of the way to the next one
  function sizeFor(n) {
    const t = tierFor(n), nx = nextTier(n);
    if (!nx) return t.scale + Math.min(0.2, (n - t.at) * 0.002);
    return t.scale + (nx.scale - t.scale) * 0.85 * ((Math.max(n, t.at) - t.at) / (nx.at - t.at));
  }
  // the fire moves: the outer flame and the core change shape on different clocks, the glow breathes
  const BODY = [
    'M60 162 C24 146 18 104 40 74 C52 58 48 40 60 14 C66 40 86 50 86 86 C96 78 98 68 100 58 C110 96 102 148 60 162 Z',
    'M60 162 C22 145 20 102 41 72 C54 56 46 36 55 10 C66 38 88 50 85 85 C97 76 101 62 105 50 C111 96 103 148 60 162 Z',
    'M60 162 C25 147 17 106 39 76 C50 60 52 42 66 17 C69 42 85 53 87 88 C95 80 97 71 96 63 C108 98 101 148 60 162 Z',
    'M60 162 C23 146 19 103 40 73 C53 57 47 38 58 12 C67 39 87 50 86 86 C97 77 100 64 102 55 C110 97 102 148 60 162 Z'];
  const INNER = [
    'M60 156 C40 146 36 116 50 94 C58 82 56 68 64 52 C68 72 80 80 78 106 C86 100 86 92 87 86 C92 112 86 146 60 156 Z',
    'M60 156 C39 145 37 114 51 92 C59 80 55 64 59 46 C68 70 82 80 79 104 C87 98 88 88 91 81 C93 112 86 146 60 156 Z',
    'M60 156 C41 147 35 118 49 96 C57 84 59 70 68 56 C69 74 79 82 77 108 C85 102 85 95 85 90 C91 114 85 146 60 156 Z'];
  function morph(list, dur, off) {
    const n = list.length, kt = Array.from({ length: n + 1 }, (_, i) => (i / n).toFixed(3)).join(';');
    return `<animate attributeName="d" values="${list.concat(list[0]).join(';')}" keyTimes="${kt}" calcMode="spline" keySplines="${Array(n).fill('.45 0 .55 1').join(';')}" dur="${dur}s" begin="-${off}s" repeatCount="indefinite"/>`;
  }
  function flameSVG(t, spec = true) {
    const u = uid('f'), still = reduced(), o = (Math.random() * 3).toFixed(2), o2 = (Math.random() * 2).toFixed(2);
    const anim = (s) => (still ? '' : s);
    return tight(`<svg viewBox="0 0 120 170" aria-hidden="true" focusable="false"><defs>
      <radialGradient id="b${u}" cx="50%" cy="78%" r="70%"><stop offset="0%" stop-color="${t.body[0]}"/><stop offset="38%" stop-color="${t.body[1]}"/><stop offset="72%" stop-color="${t.body[2]}"/><stop offset="100%" stop-color="${t.body[3]}"/></radialGradient>
      <radialGradient id="i${u}" cx="50%" cy="82%" r="55%"><stop offset="0%" stop-color="${t.inner[0]}"/><stop offset="55%" stop-color="${t.inner[1]}" stop-opacity=".9"/><stop offset="100%" stop-color="${t.inner[1]}" stop-opacity="0"/></radialGradient></defs>
      <ellipse cx="60" cy="150" rx="40" ry="10" fill="${t.ground}" opacity=".32">${anim(`<animate attributeName="rx" values="40;44;38;40" dur="1.3s" begin="-${o2}s" repeatCount="indefinite"/>`)}</ellipse>
      <ellipse cx="60" cy="96" rx="52" ry="62" fill="${t.glow}" opacity=".2">${anim(`<animate attributeName="opacity" values=".16;.27;.19;.24;.16" dur="1.7s" begin="-${o}s" repeatCount="indefinite"/>`)}</ellipse>
      <path d="${BODY[0]}" fill="url(#b${u})">${anim(morph(BODY, 1.9, o))}</path>
      <path d="${INNER[0]}" fill="url(#i${u})">${anim(morph(INNER, 1.2, o2))}</path>
      ${spec ? `<ellipse cx="50" cy="118" rx="9" ry="16" fill="#fff" opacity=".38" transform="rotate(-18 50 118)"/>` : ''}
    </svg>`);
  }
  // a flame for a streak of n days, w pixels wide (Home's streak chip, the toast)
  function flameFor(n, w) {
    const t = tierFor(Math.max(1, n));
    return `<span class="rw-flame${n > 0 ? '' : ' rw-out'}" style="width:${w}px;height:${Math.round((w * 170) / 120)}px">${flameSVG(t)}</span>`;
  }

  /* ---------------- one moment at a time ---------------- */
  // (a moment never covers an answer Cassie is still writing: it waits until she's done)
  const queue = [];
  let showing = false, isBusy = () => false;
  function enqueue(fn) { queue.push(fn); if (!showing) next(); }
  function next() {
    if (!queue.length) { showing = false; return; }
    showing = true;
    let busy = false;
    try { busy = isBusy(); } catch (e) { /* not busy */ }
    if (busy) { setTimeout(next, 400); return; }
    queue.shift()();
  }

  // a full-screen moment: the hero first (flame or medal), then the panel and the words fade in
  function moment({ label, eyebrow, title, line, hero, setup, hint }) {
    const back = document.activeElement;
    const w = document.createElement('div');
    w.className = 'rw-pop'; w.setAttribute('role', 'dialog'); w.setAttribute('aria-modal', 'true'); w.setAttribute('aria-label', label);
    w.innerHTML = `<div class="rw-scrim"></div><div class="rw-rays"></div>
      <div class="rw-txt rw-top"><p class="rw-eyebrow"></p><p class="rw-title"></p></div>
      <div class="rw-stage">${hero}</div>
      <div class="rw-txt rw-bottom"><p class="rw-line"></p><p class="rw-hint"></p><button type="button" class="rw-ok">Keep going</button></div>`;
    w.querySelector('.rw-eyebrow').textContent = eyebrow;
    w.querySelector('.rw-title').textContent = title;
    w.querySelector('.rw-line').textContent = line;
    w.querySelector('.rw-hint').textContent = hint;
    document.body.appendChild(w);
    let timers = [], closed = false;
    const later = (f, ms) => timers.push(setTimeout(f, ms));
    const showPanel = () => { w.classList.add('rw-bg'); w.querySelector('.rw-ok').focus({ preventScroll: true }); };
    const close = () => {
      if (closed) return; closed = true;
      timers.forEach(clearTimeout); document.removeEventListener('keydown', onKey, true);
      w.classList.add('rw-out');
      setTimeout(() => { w.remove(); try { back && back.focus && back.focus({ preventScroll: true }); } catch (e) { /* gone */ } next(); }, reduced() ? 0 : 260);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
      if (e.key === 'Tab') { e.preventDefault(); w.querySelector('.rw-ok').focus(); } // (one button: focus stays in the moment)
    };
    document.addEventListener('keydown', onKey, true);
    w.querySelector('.rw-ok').addEventListener('click', close);
    setup(w, { later, showPanel, isClosed: () => closed });
    return w;
  }

  // drag to turn something round its vertical axis; it coasts, then settles (on a face, for a medal)
  function spinner(el, target, { settle = 0, start = 0 } = {}) {
    let rot = start, vel = 0, drag = false, lastX = 0, auto = null, live = true, touched = false;
    el.addEventListener('pointerdown', (e) => { drag = true; touched = true; auto = null; lastX = e.clientX; vel = 0; try { el.setPointerCapture(e.pointerId); } catch (x) { /* fine */ } });
    el.addEventListener('pointermove', (e) => { if (!drag) return; const dx = e.clientX - lastX; lastX = e.clientX; rot += dx * 1.0; vel = dx * 1.0; });
    const up = () => { drag = false; };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    let idle = 0;
    const frame = () => {
      if (!live || !el.isConnected) return;
      if (!drag) {
        if (auto != null) { rot += (auto - rot) * 0.06; if (Math.abs(auto - rot) < 0.5) { rot = 0; auto = null; } }
        else {
          rot += vel; vel *= 0.94;
          if (Math.abs(vel) < 0.4) {
            if (settle) rot += (Math.round(rot / settle) * settle - rot) * 0.07;
            else if (!reduced()) { idle += 0.012; rot += Math.sin(idle) * 0.25; }
          }
        }
      }
      target(rot);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    // (once the student has turned it, the welcome turn and push never take it back)
    return { turn(deg) { if (!reduced() && !touched) { rot = 0; auto = deg; } }, push(v) { if (!reduced() && !touched) vel = v; }, stop() { live = false; } };
  }

  /* the toast: a normal goal day */
  let toastTimer = 0;
  function streakToast(day, { first = false } = {}) {
    document.querySelector('.rw-toast')?.remove();
    const nx = nextTier(day), t = document.createElement('div');
    t.className = 'rw-toast'; t.setAttribute('role', 'status');
    t.innerHTML = `${flameFor(day, 26)}<span><b></b><small></small></span>`;
    t.querySelector('b').textContent = first ? 'Goal done. Your streak started' : `Goal done. Day ${day}, streak kept`;
    t.querySelector('small').textContent = nx ? `${nx.at - day} ${nx.at - day === 1 ? 'day' : 'days'} to the ${nx.name} flame` : 'The hottest flame there is. Keep it burning.';
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add('rw-on'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.classList.remove('rw-on'); setTimeout(() => t.remove(), 400); }, 3000);
  }

  /* the full moment: a new flame (or the very first one) */
  function flameMoment(day, { first = false, comeback = false } = {}) {
    enqueue(() => {
      const t = tierFor(day), nx = nextTier(day), name = getName();
      const planes = [0, 60, 120].map((a, i) => `<div class="rw-plane" data-a="${a}"><div class="rw-flick" style="animation-delay:${i * -0.7}s">${flameSVG(t, i === 0)}</div></div>`).join('');
      moment({
        label: `${t.name} flame, day ${day}`,
        eyebrow: first ? 'Your streak has started' : comeback ? 'A freeze saved your streak' : 'New flame unlocked',
        title: `Day ${day}`,
        line: first ? `Hit your goal tomorrow and it grows. The ${nx.name} flame comes at day ${nx.at}.`
          : t.legend ? `Blue fire, the hottest there is. ${day} days${name ? ', ' + name : ''}.`
            : `The ${t.name} flame. Your flame grows as your streak does.${nx ? ` ${nx.name} at day ${nx.at}.` : ''}`,
        hint: 'Drag the flame to spin it',
        hero: `<div class="rw-flamestage"><div class="rw-grow"><div class="rw-spin">${planes}</div></div></div>`,
        setup(w, { later, showPanel, isClosed }) {
          const grow = w.querySelector('.rw-grow'), spin = w.querySelector('.rw-spin'), stage = w.querySelector('.rw-flamestage');
          w.style.setProperty('--rw-pill', t.pill);
          const sp = spinner(stage, (rot) => {
            spin.style.transform = `rotateY(${rot}deg)`;
            spin.querySelectorAll('.rw-plane').forEach((p) => { const a = +p.dataset.a, face = Math.abs(Math.cos(((rot + a) * Math.PI) / 180)); p.style.transform = `rotateY(${a}deg)`; p.style.opacity = (0.12 + 0.88 * Math.pow(face, 2.2)).toFixed(3); });
          });
          const end = sizeFor(day) * 1.12;
          if (reduced()) { grow.style.transform = `scale(${end})`; showPanel(); return; }
          // the flame alone first, swelling bigger and bigger, then the panel
          const from = end * 0.32;
          grow.animate([
            { transform: 'scale(0)' }, { transform: `scale(${from})`, offset: 0.22 }, { transform: `scale(${from * 1.08})`, offset: 0.34 },
            { transform: `scale(${(from + end) / 2})`, offset: 0.5 }, { transform: `scale(${((from + end) / 2) * 1.06})`, offset: 0.6 },
            { transform: `scale(${end * 1.18})`, offset: 0.82 }, { transform: `scale(${end})` },
          ], { duration: 1700, easing: 'cubic-bezier(.3,1.2,.4,1)', fill: 'forwards' });
          later(() => burst(stage, [t.glow, t.body[0], t.inner[1]]), 1300);
          later(() => { showPanel(); sp.push(10); }, 1650);
          // embers drift up off the flame while it's open (more for a bigger flame)
          const emb = setInterval(() => {
            if (isClosed() || !w.isConnected) { clearInterval(emb); return; }
            const e = document.createElement('span'); e.className = 'rw-ember';
            const s = 2 + Math.random() * 4, x = (Math.random() - 0.5) * 70 * sizeFor(day), rise = 140 + Math.random() * 120, drift = (Math.random() - 0.5) * 60;
            e.style.cssText = `width:${s}px;height:${s}px;background:${Math.random() < 0.5 ? t.inner[1] : t.glow};box-shadow:0 0 ${s * 2}px ${t.glow}`;
            stage.appendChild(e);
            e.animate([{ transform: `translate(${x}px,0)`, opacity: 0 }, { opacity: 1, offset: 0.15 }, { transform: `translate(${x + drift}px,-${rise}px)`, opacity: 0 }], { duration: 1500 + Math.random() * 1200, easing: 'cubic-bezier(.3,.6,.4,1)' }).onfinish = () => e.remove();
          }, Math.max(55, Math.round(150 - sizeFor(day) * 50)));
        },
      });
    });
  }
  function burst(host, cols) {
    if (reduced()) return;
    for (let i = 0; i < 24; i++) {
      const d = document.createElement('span'); d.className = 'rw-spark';
      const a = Math.random() * Math.PI * 2, r = 80 + Math.random() * 90;
      d.style.background = cols[i % cols.length]; d.style.boxShadow = `0 0 8px ${cols[0]}`;
      host.appendChild(d);
      d.animate([{ transform: 'translate(-50%,-50%) scale(1)', opacity: 1 }, { transform: `translate(calc(-50% + ${Math.cos(a) * r}px), calc(-50% + ${Math.sin(a) * r - 50}px)) scale(.2)`, opacity: 0 }], { duration: 900 + Math.random() * 500, easing: 'cubic-bezier(.2,.8,.3,1)' }).onfinish = () => d.remove();
    }
  }

  // app.js calls this when the daily goal is met: the toast, or the full moment for a new flame
  function streakMoment(res) {
    if (!res || !res.goalJustMet) return;
    const day = res.streak, prev = day - 1;
    if (day === 1) streakToast(1, { first: true }); // (day 1 is the Ember flame: a toast, the first full moment is day 7)
    else if (tierFor(day) !== tierFor(prev)) flameMoment(day);
    else if (res.comeback) flameMoment(day, { comeback: true });
    else streakToast(day);
  }

  /* ---------------- school medals ---------------- */
  const METAL = {
    gold: { g: ['#fff4c4', '#ffd650', '#d8981c', '#8a5c0a'], deep: '#6b4708', field: ['#ffe58a', '#d9a024'], edge: '#a8730e' },
    silver: { g: ['#ffffff', '#e2e7ef', '#a9b2c2', '#5c6475'], deep: '#3f4655', field: ['#f3f6fa', '#aeb7c6'], edge: '#7c8596' },
    bronze: { g: ['#ffe2c6', '#e3a469', '#ad6a33', '#673a16'], deep: '#4f2c10', field: ['#f3c191', '#b4733a'], edge: '#8a5226' },
  };
  const ICON = {
    star: '<path d="M12 3l2.6 5.5 6 .8-4.4 4.2 1.1 6-5.3-3-5.3 3 1.1-6L3.4 9.3l6-.8z"/>',
    cal: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4M9 15l2 2 4-4"/>',
    check: '<circle cx="12" cy="12" r="8.5"/><path d="M8 12.5l2.8 2.8L16.5 9.5"/>',
    up: '<path d="M4 18l6-6 4 4 6-8"/><path d="M15 8h5v5"/>',
    book: '<path d="M4 5a2 2 0 0 1 2-2h12v16H6a2 2 0 0 0-2 2z"/><path d="M18 19v2H6"/>',
    sun: '<circle cx="12" cy="14" r="4"/><path d="M12 5v2M5.6 7.6l1.4 1.4M18.4 7.6 17 9M3 14h2M19 14h2M3 19h18"/>',
    crown: '<path d="M4 17l-1-9 5 4 4-7 4 7 5-4-1 9z"/><path d="M4 20h16"/>',
  };
  const AWARDS = [
    { id: 'hon', name: 'With Honors', how: 'Score 85% or higher on a mock exam', metal: 'bronze', enamel: ['#d4567a', '#8f1d3a'], icon: 'star', ribbon: ['#8f1d3a', '#f2c230', '#8f1d3a'] },
    { id: 'hhon', name: 'With High Honors', how: 'Score 90% or higher on a mock exam', metal: 'silver', enamel: ['#d4567a', '#8f1d3a'], icon: 'star', ribbon: ['#8f1d3a', '#f2c230', '#8f1d3a'] },
    { id: 'xhon', name: 'With Highest Honors', how: 'Score 95% or higher on a mock exam', metal: 'gold', enamel: ['#d4567a', '#8f1d3a'], icon: 'star', ribbon: ['#8f1d3a', '#f2c230', '#8f1d3a'] },
    { id: 'att', name: 'Perfect Attendance', how: 'Hit your daily goal 30 days in a row', metal: 'gold', enamel: ['#4fc28a', '#1f7a4a'], icon: 'cal', ribbon: ['#1f7a3a', '#ffffff', '#1f7a3a'] },
    { id: 'quiz', name: 'Best in Quiz', how: 'Get 90% right across 50 quiz questions', metal: 'silver', enamel: ['#5aa2f5', '#1d4fb0'], icon: 'check', ribbon: ['#1d3f9e', '#f2c230', '#1d3f9e'] },
    { id: 'imp', name: 'Most Improved', how: 'Turn a weak topic into a strong one', metal: 'bronze', enamel: ['#b07cf0', '#5a26a8'], icon: 'up', ribbon: ['#5a26a8', '#ffffff', '#5a26a8'] },
    { id: 'book', name: 'Bookworm', how: 'Finish 20 lessons', metal: 'silver', enamel: ['#ffae5a', '#c4600f'], icon: 'book', ribbon: ['#c4600f', '#ffffff', '#c4600f'] },
    { id: 'early', name: 'Early Bird', how: 'Study before 7am on 5 days', metal: 'bronze', enamel: ['#ffd86a', '#c98f0a'], icon: 'sun', ribbon: ['#2a66d8', '#ffd650', '#2a66d8'] },
    { id: 'dean', name: "Dean's Lister", how: 'Finish top 3 in a weekly league (coming soon)', metal: 'gold', enamel: ['#4fd4b0', '#14705a'], icon: 'crown', ribbon: ['#14705a', '#f2c230', '#14705a'] },
  ];
  const awardById = (id) => AWARDS.find((a) => a.id === id);

  const CX = 100, CY = 112, RIM = 86, BAND_OUT = 78, BAND_IN = 57, FIELD = 55;
  const P = (r, deg) => [CX + r * Math.cos((deg * Math.PI) / 180), CY + r * Math.sin((deg * Math.PI) / 180)];
  const f = (p) => p.map((v) => v.toFixed(1)).join(' ');
  function star5(cx, cy, r) { let s = ''; for (let i = 0; i < 10; i++) { const rr = i % 2 ? r * 0.45 : r, a = ((-90 + i * 36) * Math.PI) / 180; s += `${(cx + rr * Math.cos(a)).toFixed(1)},${(cy + rr * Math.sin(a)).toFixed(1)} `; } return s; }
  function laurel(M, u) {
    let s = '';
    [[150, 250], [30, -70]].forEach(([a0, a1]) => {
      const step = (a1 - a0) / 8, st = [];
      for (let i = 0; i <= 8; i++) st.push(P(38, a0 + step * i));
      s += `<path d="M${st.map(f).join(' L')}" fill="none" stroke="${M.deep}" stroke-opacity=".6" stroke-width="1.4" stroke-linecap="round"/>`;
      for (let i = 0; i < 8; i++) {
        const a = a0 + step * (i + 0.5);
        [[33, -30], [43, 30]].forEach(([rr, tilt]) => {
          const [x, y] = P(rr, a), rot = (a + 90 + tilt * (a1 > a0 ? 1 : -1)).toFixed(1), X = x.toFixed(1), Y = y.toFixed(1), Ys = (y + 1).toFixed(1);
          s += `<ellipse cx="${X}" cy="${Ys}" rx="5.4" ry="2.5" transform="rotate(${rot} ${X} ${Ys})" fill="${M.deep}" opacity=".45"/>`;
          s += `<ellipse cx="${X}" cy="${Y}" rx="5.4" ry="2.5" transform="rotate(${rot} ${X} ${Y})" fill="url(#lf${u})" stroke="${M.deep}" stroke-opacity=".55" stroke-width=".7"/>`;
        });
      }
    });
    return s;
  }
  function defs(M, u, a) {
    const e = a.enamel;
    return `<defs>
      <linearGradient id="m${u}" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${M.g[0]}"/><stop offset="30%" stop-color="${M.g[1]}"/><stop offset="70%" stop-color="${M.g[2]}"/><stop offset="100%" stop-color="${M.g[3]}"/></linearGradient>
      <linearGradient id="rv${u}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${M.g[0]}"/><stop offset="45%" stop-color="${M.g[1]}"/><stop offset="100%" stop-color="${M.g[3]}"/></linearGradient>
      <radialGradient id="fd${u}" cx="38%" cy="30%" r="80%"><stop offset="0%" stop-color="${M.g[0]}"/><stop offset="45%" stop-color="${M.field[0]}"/><stop offset="100%" stop-color="${M.field[1]}"/></radialGradient>
      <linearGradient id="bd${u}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${e[0]}"/><stop offset="100%" stop-color="${e[1]}"/></linearGradient>
      <radialGradient id="em${u}" cx="38%" cy="32%" r="72%"><stop offset="0%" stop-color="${e[0]}"/><stop offset="100%" stop-color="${e[1]}"/></radialGradient>
      <linearGradient id="lf${u}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${M.g[0]}"/><stop offset="100%" stop-color="${M.g[2]}"/></linearGradient>
      <linearGradient id="sh${u}" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#fff" stop-opacity="0"/><stop offset="50%" stop-color="#fff" stop-opacity=".7"/><stop offset="100%" stop-color="#fff" stop-opacity="0"/></linearGradient>
      <clipPath id="c${u}"><circle cx="${CX}" cy="${CY}" r="${RIM}"/></clipPath>
      <path id="arc${u}" d="M${f(P(63, 160))} A63 63 0 1 1 ${f(P(63, 20))}"/>
    </defs>`;
  }
  function rim(M, u) {
    let ticks = '';
    for (let i = 0; i < 96; i++) { const a = i * 3.75, [x1, y1] = P(RIM - 1, a), [x2, y2] = P(RIM - 6, a); ticks += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`; }
    return `
      <path d="M89 28 Q89 6 100 6 Q111 6 111 28" fill="none" stroke="${M.deep}" stroke-width="9" stroke-linecap="round"/>
      <path d="M89 28 Q89 6 100 6 Q111 6 111 28" fill="none" stroke="url(#rv${u})" stroke-width="6" stroke-linecap="round"/>
      <path d="M92 18 Q93 9 100 9" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="1.6" stroke-linecap="round"/>
      <circle cx="${CX}" cy="${CY}" r="${RIM}" fill="url(#rv${u})" stroke="${M.deep}" stroke-width="1.6"/>
      <g stroke="${M.deep}" stroke-opacity=".3" stroke-width="1">${ticks}</g>
      <circle cx="${CX}" cy="${CY}" r="${RIM - 6}" fill="url(#m${u})"/>
      <path d="M${f(P(RIM - 6.5, 195))} A${RIM - 6.5} ${RIM - 6.5} 0 0 1 ${f(P(RIM - 6.5, 300))}" fill="none" stroke="#fff" stroke-opacity=".75" stroke-width="2.2" stroke-linecap="round"/>
      <path d="M${f(P(RIM - 6.5, 15))} A${RIM - 6.5} ${RIM - 6.5} 0 0 1 ${f(P(RIM - 6.5, 120))}" fill="none" stroke="${M.deep}" stroke-opacity=".55" stroke-width="2.2" stroke-linecap="round"/>`;
  }
  function shine(u, big) {
    const sweep = reduced() ? '' : `<animateTransform attributeName="transform" type="translate" additive="sum" values="-40 0;300 0;300 0" keyTimes="0;.35;1" dur="${big ? 3.2 : 5.5}s" begin="-${(Math.random() * 4).toFixed(2)}s" repeatCount="indefinite"/>`;
    return `<g clip-path="url(#c${u})"><rect x="-60" y="-20" width="40" height="260" fill="url(#sh${u})" transform="rotate(22 100 112)" opacity="${reduced() ? 0 : big ? 0.8 : 0.5}">${sweep}</rect></g>
      <ellipse cx="62" cy="58" rx="18" ry="8" fill="#fff" opacity=".35" transform="rotate(-38 62 58)"/>`;
  }
  const FONT = `font-family="'Segoe UI','Helvetica Neue',Roboto,Arial,sans-serif"`;
  function medalFront(a, big) {
    const M = METAL[a.metal], u = uid('m'), rimText = a.name.toUpperCase();
    const fs = Math.min(15, 222 / (rimText.length * 0.74)).toFixed(1);
    const words = `<textPath href="#arc${u}" startOffset="50%" text-anchor="middle">${esc(rimText)}</textPath>`;
    const tf = `${FONT} font-weight="800" font-size="${fs}" letter-spacing=".9"`;
    return tight(`<svg viewBox="0 0 200 210" aria-hidden="true" focusable="false">${defs(M, u, a)}${rim(M, u)}
      <circle cx="${CX}" cy="${CY}" r="${BAND_OUT}" fill="url(#bd${u})"/>
      <path d="M${f(P(BAND_OUT - 1, 200))} A${BAND_OUT - 1} ${BAND_OUT - 1} 0 0 1 ${f(P(BAND_OUT - 1, 340))}" fill="none" stroke="#000" stroke-opacity=".35" stroke-width="3"/>
      <circle cx="${CX}" cy="${CY}" r="${BAND_OUT}" fill="none" stroke="${M.deep}" stroke-width="1.4"/>
      <text ${tf} fill="#000" fill-opacity=".45" transform="translate(0 1.3)">${words}</text>
      <text ${tf} fill="#ffffff">${words}</text>
      ${[66, 90, 114].map((d) => { const [x, y] = P(67, d); return `<polygon points="${star5(x, y + 0.9, 5.2)}" fill="#000" opacity=".35"/><polygon points="${star5(x, y, 5.2)}" fill="url(#m${u})" stroke="${M.deep}" stroke-width=".6"/>`; }).join('')}
      <circle cx="${CX}" cy="${CY}" r="${BAND_IN}" fill="url(#m${u})" stroke="${M.deep}" stroke-width="1.2"/>
      <circle cx="${CX}" cy="${CY}" r="${FIELD}" fill="url(#fd${u})" stroke="${M.deep}" stroke-opacity=".6" stroke-width="1"/>
      <path d="M${f(P(FIELD - 1, 200))} A${FIELD - 1} ${FIELD - 1} 0 0 1 ${f(P(FIELD - 1, 340))}" fill="none" stroke="${M.deep}" stroke-opacity=".35" stroke-width="2"/>
      ${laurel(M, u)}
      <circle cx="${CX}" cy="${CY + 3.5}" r="25" fill="#000" opacity=".3"/>
      <circle cx="${CX}" cy="${CY}" r="25" fill="url(#m${u})" stroke="${M.deep}" stroke-width="1.2"/>
      <circle cx="${CX}" cy="${CY}" r="20.5" fill="url(#em${u})" stroke="${M.deep}" stroke-opacity=".6" stroke-width="1"/>
      <path d="M${f(P(24, 200))} A24 24 0 0 1 ${f(P(24, 300))}" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="1.6" stroke-linecap="round"/>
      <ellipse cx="${CX - 7}" cy="${CY - 8}" rx="9" ry="5" fill="#fff" opacity=".3" transform="rotate(-30 ${CX - 7} ${CY - 8})"/>
      <g transform="translate(${CX} ${CY + 1}) scale(1.15) translate(-12 -12)" fill="none" stroke="#000" stroke-opacity=".35" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${ICON[a.icon]}</g>
      <g transform="translate(${CX} ${CY}) scale(1.15) translate(-12 -12)" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${ICON[a.icon]}</g>
      ${shine(u, big)}
    </svg>`);
  }
  function dayLabel(day) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day || '');
    const d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date();
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  function medalBack(a, day) {
    const M = METAL[a.metal], u = uid('m');
    const lines = []; let cur = '';
    a.name.toUpperCase().split(' ').forEach((w) => { if ((cur + ' ' + w).trim().length > 13 && cur) { lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); });
    lines.push(cur);
    const who = (getName() || 'You').slice(0, 14), whoSize = who.length > 9 ? 22 : 28;
    const top = lines.length > 1 ? 84 : 90;
    const t = (y, size, weight, txt, sp = 0, op = 1) => `<text x="100" y="${(y + 1.1).toFixed(1)}" font-size="${size}" font-weight="${weight}" letter-spacing="${sp}" fill="#fff" fill-opacity=".55">${esc(txt)}</text><text x="100" y="${y}" font-size="${size}" font-weight="${weight}" letter-spacing="${sp}" fill="${M.deep}" fill-opacity="${op}">${esc(txt)}</text>`;
    return tight(`<svg viewBox="0 0 200 210" aria-hidden="true" focusable="false">${defs(M, u, a)}${rim(M, u)}
      <circle cx="${CX}" cy="${CY}" r="${BAND_OUT}" fill="url(#fd${u})" stroke="${M.deep}" stroke-width="1.4"/>
      <path d="M${f(P(BAND_OUT - 1, 200))} A${BAND_OUT - 1} ${BAND_OUT - 1} 0 0 1 ${f(P(BAND_OUT - 1, 340))}" fill="none" stroke="${M.deep}" stroke-opacity=".35" stroke-width="2.4"/>
      <circle cx="${CX}" cy="${CY}" r="70" fill="none" stroke="${M.deep}" stroke-opacity=".4" stroke-width="1"/>
      <g ${FONT} text-anchor="middle">
        ${t(top, 11, 800, 'AWARDED TO', 1.8, 0.85)}
        ${t(top + 28, whoSize, 800, who)}
        ${lines.map((l, i) => t(top + 50 + i * 15, 13, 800, l, 0.4)).join('')}
        ${t(top + 50 + lines.length * 15 + 5, 11, 700, dayLabel(day), 0, 0.85)}
      </g>${shine(u, false)}
    </svg>`);
  }
  // the neck ribbon: two satin straps in a V, striped, with the fold and a metal ring
  function ribbonSVG(a, short) {
    const H = short ? 70 : 190, bot = H - 14, M = METAL[a.metal], u = uid('r');
    const L = { t: short ? [62, 92] : [22, 70], b: [86, 104] }, R = { t: short ? [108, 138] : [130, 178], b: [96, 114] };
    const poly = (s) => `${s.t[0]},0 ${s.t[1]},0 ${s.b[1]},${bot} ${s.b[0]},${bot}`;
    const strap = (s) => a.ribbon.map((col, k, all) => {
      const n = all.length, t0 = s.t[0] + ((s.t[1] - s.t[0]) * k) / n, t1 = s.t[0] + ((s.t[1] - s.t[0]) * (k + 1)) / n, b0 = s.b[0] + ((s.b[1] - s.b[0]) * k) / n, b1 = s.b[0] + ((s.b[1] - s.b[0]) * (k + 1)) / n;
      return `<polygon points="${t0},0 ${t1},0 ${b1},${bot} ${b0},${bot}" fill="${col}"/>`;
    }).join('');
    return tight(`<svg class="rw-rib" viewBox="0 0 200 ${H}" style="height:${H}px" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="sa${u}" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#000" stop-opacity=".3"/><stop offset="38%" stop-color="#fff" stop-opacity=".22"/><stop offset="55%" stop-color="#fff" stop-opacity=".05"/><stop offset="100%" stop-color="#000" stop-opacity=".32"/></linearGradient>
        <linearGradient id="fo${u}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#000" stop-opacity="0"/><stop offset="80%" stop-color="#000" stop-opacity=".15"/><stop offset="100%" stop-color="#000" stop-opacity=".45"/></linearGradient>
        <linearGradient id="rg${u}" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${M.g[0]}"/><stop offset="50%" stop-color="${M.g[1]}"/><stop offset="100%" stop-color="${M.g[3]}"/></linearGradient>
      </defs>
      <g>${strap(R)}<polygon points="${poly(R)}" fill="url(#sa${u})"/><polygon points="${poly(R)}" fill="url(#fo${u})"/><polygon points="${poly(R)}" fill="#000" opacity=".12"/></g>
      <polygon points="${poly(L)}" fill="#000" opacity=".28" transform="translate(4 2)"/>
      <g>${strap(L)}<polygon points="${poly(L)}" fill="url(#sa${u})"/><polygon points="${poly(L)}" fill="url(#fo${u})"/></g>
      <circle cx="100" cy="${bot + 4}" r="8.5" fill="none" stroke="${M.deep}" stroke-width="5.5"/>
      <circle cx="100" cy="${bot + 4}" r="8.5" fill="none" stroke="url(#rg${u})" stroke-width="3.5"/>
      <path d="M93 ${bot} A8.5 8.5 0 0 1 103 ${bot - 4}" fill="none" stroke="#fff" stroke-opacity=".75" stroke-width="1.2" stroke-linecap="round"/>
    </svg>`);
  }
  function hangHTML(a, { short = false, big = false, day = '' } = {}) {
    const M = METAL[a.metal];
    const edges = Array.from({ length: 11 }, (_, i) => `<div class="rw-edge" style="transform:translateZ(${i - 5}px);background:${i % 2 ? M.edge : M.g[3]}"></div>`).join('');
    return `<div class="rw-hang"><div class="rw-sway" style="animation-delay:-${(Math.random() * 3).toFixed(1)}s">${ribbonSVG(a, short)}
      <div class="rw-medal"><div class="rw-flip">${edges}<div class="rw-face rw-front">${medalFront(a, big)}</div><div class="rw-face rw-back">${medalBack(a, day)}</div></div></div></div></div>`;
  }

  // a medal moment: it drops in on its ribbon and swings, confetti, then the panel; drag to flip it
  function awardMoment(id, { isNew = true } = {}) {
    const a = awardById(id);
    if (!a) return;
    enqueue(() => {
      const day = ((window.CassieMemory && window.CassieMemory.awards().got) || {})[id] || '';
      moment({
        label: `Award: ${a.name}`,
        eyebrow: isNew ? 'Award earned' : `Earned ${dayLabel(day)}`,
        title: a.name,
        line: a.how.replace(/ \(coming soon\)$/, '') + '.',
        hint: 'Drag the medal to flip it',
        hero: `<div class="rw-medalstage">${hangHTML(a, { big: true, day })}</div>`,
        setup(w, { later, showPanel }) {
          w.classList.add('rw-award');
          const hang = w.querySelector('.rw-hang'), flip = w.querySelector('.rw-flip');
          const sp = spinner(w.querySelector('.rw-medal'), (rot) => { flip.style.transform = `rotateY(${rot}deg)`; }, { settle: 180 });
          if (reduced()) { showPanel(); return; }
          hang.animate([
            { transform: 'translateY(-120%) rotate(0deg)' },
            { transform: 'translateY(0) rotate(15deg)', offset: 0.26, easing: 'ease-in-out' },
            { transform: 'translateY(0) rotate(-11deg)', offset: 0.42, easing: 'ease-in-out' },
            { transform: 'translateY(0) rotate(7deg)', offset: 0.57, easing: 'ease-in-out' },
            { transform: 'translateY(0) rotate(-4deg)', offset: 0.71, easing: 'ease-in-out' },
            { transform: 'translateY(0) rotate(2deg)', offset: 0.85, easing: 'ease-in-out' },
            { transform: 'translateY(0) rotate(0deg)' },
          ], { duration: 2600, easing: 'cubic-bezier(.3,.6,.4,1)', fill: 'forwards' });
          if (isNew) later(() => confetti(w, a), 650);
          later(() => { showPanel(); if (isNew) sp.turn(360); }, isNew ? 1300 : 500);
        },
      });
    });
  }
  function confetti(host, a) {
    if (reduced()) return;
    const cols = [...a.ribbon, METAL[a.metal].g[1], '#ffffff', '#f28fa5'], W = host.clientWidth;
    for (let i = 0; i < 70; i++) {
      const c = document.createElement('span'); c.className = 'rw-conf';
      const w = 5 + Math.random() * 6, h = 8 + Math.random() * 8;
      c.style.cssText = `left:${Math.random() * W}px;width:${w}px;height:${h}px;background:${cols[i % cols.length]};border-radius:${Math.random() < 0.3 ? '50%' : '2px'}`;
      host.appendChild(c);
      c.animate([{ transform: 'translate(0,0) rotate(0deg)', opacity: 1 }, { transform: `translate(${(Math.random() - 0.5) * 120}px,${host.clientHeight + 40}px) rotate(${(Math.random() - 0.5) * 900}deg)`, opacity: 0.9 }], { duration: 2200 + Math.random() * 1600, delay: Math.random() * 500, easing: 'cubic-bezier(.25,.6,.4,1)', fill: 'forwards' }).onfinish = () => c.remove();
    }
  }
  function awardsEarned(ids) { (ids || []).forEach((id) => awardMoment(id, { isNew: true })); }

  /* ---------------- My awards: the shelf ---------------- */
  function progressLine(id, pr) {
    const p = pr[id];
    if (!p) return '';
    if (id === 'hon' || id === 'hhon' || id === 'xhon') return p[0] ? `Best mock so far: ${p[0]}%` : 'No mock exam yet';
    if (id === 'quiz') return p[0] < p[1] ? `${p[0]} of ${p[1]} questions answered` : `${p[2]} of the last ${p[1]} right`;
    if (id === 'att') return `${p[0]} of 30 days`;
    if (id === 'book') return `${p[0]} of 20 lessons`;
    if (id === 'early') return `${p[0]} of 5 days`;
    return '';
  }
  function openShelf() {
    document.querySelector('.rw-shelf')?.remove();
    const st = window.CassieMemory && window.CassieMemory.awards ? window.CassieMemory.awards() : { got: {}, progress: {} };
    const n = AWARDS.filter((a) => st.got[a.id]).length;
    const back = document.activeElement;
    const w = document.createElement('div');
    w.className = 'rw-shelf'; w.setAttribute('role', 'dialog'); w.setAttribute('aria-modal', 'true'); w.setAttribute('aria-labelledby', 'rw-shelf-h');
    w.innerHTML = `<div class="rw-shelf-card"><div class="rw-shelf-top"><div><h2 id="rw-shelf-h">My awards</h2><p class="rw-shelf-n">${n} of ${AWARDS.length} earned</p></div>
      <button type="button" class="rw-close" aria-label="Close My awards"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>
      <div class="rw-grid">${AWARDS.map((a) => {
        const got = st.got[a.id], inner = `<span class="rw-mini">${hangHTML(a, { short: true, day: got || '' })}</span><b>${esc(a.name)}</b><small>${got ? 'Earned ' + esc(dayLabel(got)) : esc(a.how)}</small>${got ? '' : `<em>${esc(progressLine(a.id, st.progress))}</em>`}`;
        return got ? `<button type="button" class="rw-cell" data-award="${a.id}" aria-label="${esc(a.name)}, earned. Open the medal">${inner}</button>` : `<div class="rw-cell rw-lock">${inner}</div>`;
      }).join('')}</div></div>`;
    const close = () => { w.remove(); document.removeEventListener('keydown', onKey, true); try { back && back.focus && back.focus({ preventScroll: true }); } catch (e) { /* gone */ } };
    const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('.rw-pop')) { e.stopPropagation(); close(); } };
    document.addEventListener('keydown', onKey, true);
    w.addEventListener('click', (e) => {
      if (e.target === w || e.target.closest('.rw-close')) { close(); return; }
      const c = e.target.closest('[data-award]');
      if (c) awardMoment(c.dataset.award, { isNew: false });
    });
    document.body.appendChild(w);
    w.querySelector('.rw-close').focus({ preventScroll: true });
    return w;
  }
  const earnedCount = () => { const got = window.CassieMemory && window.CassieMemory.awards ? window.CassieMemory.awards().got : {}; return AWARDS.filter((a) => got[a.id]).length; };

  window.CassieRewards = {
    TIERS, AWARDS, tierFor, nextTier, sizeFor, flameFor, flameSVG,
    streakMoment, streakToast, flameMoment, awardMoment, awardsEarned, openShelf, earnedCount,
    medalFront, medalBack, hangHTML,
    config(o) { if (o && typeof o.name === 'function') getName = o.name; if (o && typeof o.busy === 'function') isBusy = o.busy; },
  };
})();

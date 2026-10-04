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


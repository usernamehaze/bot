/* Cursor Cassie — Cassie's 2D mascot, drawn and animated in code (SVG, no images).
 *
 * The idea: Cassie is a computer cursor that came alive. Her body is the Cassie
 * pointer (the same arrow as the logo), softened and given a little volume. Her
 * eyes are text carets that blink on the 530 ms rhythm of a real text cursor, and
 * her moods borrow cursor states: an hourglass when she's busy, a ⊘ when
 * something goes wrong, an I-beam while you type. When she highlights, a
 * highlighter stripe sweeps across her; when she snips, marching ants frame her.
 *
 *   const bot = CassieBot.create(el, { accent: '#d8343c' });
 *   bot.setState('thinking');           // see CassieBot.STATES
 *   bot.setAccessory('gradcap');        // see CassieBot.ACCESSORIES, or null
 *   bot.look(0.4, -0.2);                // where her eyes point, -1…1
 *   bot.destroy();
 */
(function () {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const INK = '#16131c', PAPER = '#fbfaf7';
  const CARET_BLINK = 530; // ms — the classic text-cursor blink

  /* ---------------- construction: the pointer, softened ----------------
     The Cassie pointer is a 7-point polygon. Every corner gets its own radius:
     big and soft on the outside (tip, wing, heel), small fillets in the two
     notches where the tail meets the body. The tail is built separately so it
     can wag around its pivot. */
  const POINTER = [ // [x, y, radius]
    [112, 92, 44],   // 0 tip
    [384, 258, 40],  // 1 wing
    [286, 284, 16],  // 2 notch (concave)
    [334, 372, 26],  // 3 tail, outer
    [287, 394, 26],  // 4 tail, inner
    [236, 306, 16],  // 5 notch (concave)
    [114, 376, 48],  // 6 heel
  ];
  const TAIL = [3, 4], TAIL_PIVOT = [262, 296];
  const EYES = { l: [178, 232], r: [254, 232] }; // on the widest part of the arrowhead
  const BLUSH = { l: [160, 284], r: [270, 284] };
  const HAT = { x: 150, y: 116, angle: -28, scale: 1.25 }; // on the pointer's tip — the top of her head
  const TOP_SLOPE = Math.atan2(258 - 92, 384 - 112) * 180 / Math.PI;

  function roundedPath(pts) {
    const n = pts.length;
    let d = '';
    for (let i = 0; i < n; i++) {
      const [x, y, r] = pts[i];
      const [px, py] = pts[(i - 1 + n) % n], [nx, ny] = pts[(i + 1) % n];
      const l1 = Math.hypot(x - px, y - py), l2 = Math.hypot(nx - x, ny - y);
      const t = Math.min(r, l1 / 2.05, l2 / 2.05);
      const ax = x + (px - x) / l1 * t, ay = y + (py - y) / l1 * t;
      const bx = x + (nx - x) / l2 * t, by = y + (ny - y) / l2 * t;
      const k = 0.55; // cubic handles: close to a circular arc
      d += (i ? ' L' : 'M') + `${ax.toFixed(1)} ${ay.toFixed(1)} C${(ax + (x - ax) * k).toFixed(1)} ${(ay + (y - ay) * k).toFixed(1)} ${(bx + (x - bx) * k).toFixed(1)} ${(by + (y - by) * k).toFixed(1)} ${bx.toFixed(1)} ${by.toFixed(1)}`;
    }
    return d + ' Z';
  }
  function bodyPath(tailAngle) {
    const a = tailAngle * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    return roundedPath(POINTER.map((p, i) => {
      if (!TAIL.includes(i)) return p;
      const dx = p[0] - TAIL_PIVOT[0], dy = p[1] - TAIL_PIVOT[1];
      return [TAIL_PIVOT[0] + dx * c - dy * s, TAIL_PIVOT[1] + dx * s + dy * c, p[2]];
    }));
  }

  /* ---------------- eyes, mouths, badges ---------------- */
  const EYE = {
    caret: '<rect x="-6" y="-21" width="12" height="42" rx="6"/>',
    ibeam: '<rect x="-4.5" y="-21" width="9" height="42" rx="4.5"/><rect x="-13" y="-25" width="26" height="8" rx="4"/><rect x="-13" y="17" width="26" height="8" rx="4"/>',
    short: '<rect x="-6" y="-9" width="12" height="18" rx="6"/>',
    happy: '<path d="M-15 6 Q0 -17 15 6" fill="none" stroke-width="9" stroke-linecap="round"/>',
    closed: '<path d="M-14 2 Q0 11 14 2" fill="none" stroke-width="8" stroke-linecap="round"/>',
    dot: '<circle r="9"/>',
    wide: '<circle r="14"/><circle cx="-4.5" cy="-5" r="4.2" fill="#fff"/>',
    x: '<path d="M-11 -11 L11 11 M11 -11 L-11 11" fill="none" stroke-width="8" stroke-linecap="round"/>',
    heart: '<path d="M0 13 C-22 -1 -14 -20 0 -9 C14 -20 22 -1 0 13Z"/>',
    star: '<path d="M0 -16 L4.7 -5.2 L16 -4.9 L7 2.4 L10.2 14 L0 7.4 L-10.2 14 L-7 2.4 L-16 -4.9 L-4.7 -5.2Z"/>',
    spiral: '<path d="M0 0 m-2 0 a2 2 0 1 1 4 0 a5 5 0 1 1 -10 0 a8.5 8.5 0 1 1 17 0 a12 12 0 1 1 -24 0" fill="none" stroke-width="4.5" stroke-linecap="round"/>',
    squintL: '<path d="M-12 -10 L9 0 L-12 10" fill="none" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>',
    squintR: '<path d="M12 -10 L-9 0 L12 10" fill="none" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>',
    sad: '<path d="M-13 -3 Q0 12 13 -3" fill="none" stroke-width="8" stroke-linecap="round" transform="rotate(180)"/>',
  };
  const MOUTH = {
    none: '',
    smile: '<path d="M-11 0 Q0 10 11 0" fill="none" stroke-width="6" stroke-linecap="round"/>',
    grin: '<path d="M-14 -2 Q0 17 14 -2 Z" stroke-width="4" stroke-linejoin="round"/>',
    o: '<ellipse rx="7" ry="8.5"/>',
    flat: '<path d="M-9 1 L9 1" fill="none" stroke-width="6" stroke-linecap="round"/>',
    wobble: '<path d="M-13 2 Q-6.5 -5 0 2 Q6.5 9 13 2" fill="none" stroke-width="5.5" stroke-linecap="round"/>',
    talk: '<ellipse rx="8" ry="6"/>',
  };
  const BADGE = { // small round badge on her wing — cursor-world symbols
    check: '<path d="M-8 0 L-2.5 6 L9 -6" fill="none" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>',
    ban: '<circle r="9.5" fill="none" stroke-width="4.5"/><path d="M-6.5 -6.5 L6.5 6.5" stroke-width="4.5" stroke-linecap="round"/>',
    hourglass: '<path d="M-8 -11 H8 M-8 11 H8 M-6 -11 C-6 -3 6 3 6 11 M6 -11 C6 -3 -6 3 -6 11" fill="none" stroke-width="3.6" stroke-linecap="round"/><path d="M-3.5 7 H3.5 L0 3Z"/>',
    dots: '<circle class="cb-d1" cx="-8" r="3.4"/><circle class="cb-d2" r="3.4"/><circle class="cb-d3" cx="8" r="3.4"/>',
    question: '<path d="M-5.5 -5.5 C-5.5 -13 6.5 -13 6.5 -5.5 C6.5 -0.5 0 0 0 4.5" fill="none" stroke-width="4.2" stroke-linecap="round"/><circle cy="10.5" r="2.7"/>',
    heart: '<path d="M0 9 C-14 0 -9 -13 0 -6 C9 -13 14 0 0 9Z"/>',
    star: '<path d="M0 -11 L3.2 -3.6 L11 -3.4 L4.8 1.6 L7 9.6 L0 5.1 L-7 9.6 L-4.8 1.6 L-11 -3.4 L-3.2 -3.6Z"/>',
    z: '<path d="M-6 -6 H6 L-6 6 H6" fill="none" stroke-width="3.8" stroke-linecap="round" stroke-linejoin="round"/>',
    ibeam: '<path d="M0 -10 V10 M-5 -11 H5 M-5 11 H5" fill="none" stroke-width="3.6" stroke-linecap="round"/>',
    lens: '<circle cx="-2" cy="-2" r="6.5" fill="none" stroke-width="3.8"/><path d="M3 3 L9 9" stroke-width="4.2" stroke-linecap="round"/>',
    pencil: '<path d="M-8 8 L-6 2 L5 -9 L9 -5 L-2 6 Z" stroke-width="2.6" stroke-linejoin="round"/>',
  };

  /* ---------------- accessories (sit on the slanted top edge, tip → wing) ---------------- */
  const ACC = {
    gradcap: { layer: 'top', svg: `<path d="M-62 -6 L0 -30 L62 -6 L0 18 Z" fill="${INK}"/><path d="M-30 6 V26 Q0 40 30 26 V6 L0 18 Z" fill="${INK}"/><path d="M48 -2 V30" stroke="#e8b84a" stroke-width="4" stroke-linecap="round"/><circle cx="48" cy="33" r="5" fill="#e8b84a"/>` },
    glasses: { layer: 'face', svg: `<g fill="none" stroke="${INK}" stroke-width="5.5"><rect x="-58" y="-19" width="44" height="38" rx="14"/><rect x="14" y="-19" width="44" height="38" rx="14"/><path d="M-14 -4 Q0 -12 14 -4"/></g>` },
    sunglasses: { layer: 'face', svg: `<g fill="${INK}"><path d="M-62 -16 H-10 Q-8 18 -36 18 Q-62 16 -62 -16Z"/><path d="M62 -16 H10 Q8 18 36 18 Q62 16 62 -16Z"/><rect x="-12" y="-16" width="24" height="6" rx="3"/></g><path d="M-52 -10 L-40 -10" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".55"/>` },
    headphones: { layer: 'top', svg: `<path d="M-74 34 Q-74 -46 0 -46 Q74 -46 74 34" fill="none" stroke="${INK}" stroke-width="10" stroke-linecap="round"/><rect x="-90" y="16" width="26" height="44" rx="12" fill="${INK}"/><rect x="64" y="16" width="26" height="44" rx="12" fill="${INK}"/>` },
    beanie: { layer: 'top', svg: `<path d="M-60 14 Q-62 -44 0 -46 Q62 -44 60 14 Z" fill="#3b3f4a"/><rect x="-66" y="4" width="132" height="22" rx="11" fill="#2b2e36"/><circle cy="-50" r="12" fill="#3b3f4a"/>` },
    salakot: { layer: 'top', svg: `<path d="M-84 16 Q0 -66 84 16 Q0 4 -84 16Z" fill="#c9a364" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/><path d="M-50 6 Q0 -40 50 6 M-22 -18 Q0 -30 22 -18" fill="none" stroke="#8a6a35" stroke-width="3"/><circle cy="-36" r="6" fill="#8a6a35"/>` },
    party: { layer: 'top', svg: `<path d="M-30 18 L0 -64 L30 18 Z" fill="#7c5cff"/><path d="M-22 -4 L18 -12 M-14 -26 L10 -32" stroke="#ffd166" stroke-width="5"/><circle cy="-66" r="8" fill="#ffd166"/>` },
    santa: { layer: 'top', svg: `<path d="M-58 14 Q-40 -60 26 -54 Q60 -50 70 -10 L52 -4 Q46 -30 22 -30 Q-10 -30 0 14 Z" fill="#d8343c"/><rect x="-66" y="4" width="132" height="22" rx="11" fill="#fff" stroke="#e6e1d8" stroke-width="2"/><circle cx="62" cy="-4" r="11" fill="#fff"/>` },
    witch: { layer: 'top', svg: `<path d="M-86 16 Q0 0 86 16 Q0 32 -86 16Z" fill="#3a2a5c"/><path d="M-40 14 L18 -72 L22 -60 L40 14 Z" fill="#4b3577"/><rect x="-40" y="2" width="80" height="12" fill="#e8b84a"/>` },
    crown: { layer: 'top', svg: `<path d="M-46 16 L-50 -24 L-24 -2 L0 -36 L24 -2 L50 -24 L46 16 Z" fill="#e8b84a" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/><circle cy="-38" r="5" fill="#d8343c"/>` },
    bow: { layer: 'top', svg: `<path d="M0 0 L-38 -24 Q-48 0 -38 22 Z M0 0 L38 -24 Q48 0 38 22 Z" fill="#f2a7b5" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/><circle r="10" fill="#e88aa0" stroke="${INK}" stroke-width="4"/>` },
    sampaguita: { layer: 'top', svg: `<g stroke="${INK}" stroke-width="3"><g fill="#fff">${[0, 72, 144, 216, 288].map((a) => `<ellipse rx="9" ry="16" transform="rotate(${a}) translate(0 -14)"/>`).join('')}</g><circle r="7" fill="#f6e3a1"/></g><path d="M18 18 Q34 28 48 18" stroke="#3f7a4a" stroke-width="5" fill="none" stroke-linecap="round"/>` },
    pencil: { layer: 'top', svg: `<g transform="rotate(-38)"><rect x="-56" y="-9" width="88" height="18" rx="3" fill="#f4c542" stroke="${INK}" stroke-width="4"/><path d="M32 -9 L54 0 L32 9 Z" fill="#f1dcb5" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/><path d="M47 -3 L54 0 L47 3Z" fill="${INK}"/><rect x="-64" y="-9" width="12" height="18" rx="3" fill="#f2a7b5" stroke="${INK}" stroke-width="4"/></g>` },
    scarf: { layer: 'neck', svg: `<path d="M-70 -8 Q0 22 70 -8 L74 10 Q0 40 -74 10 Z" fill="#d8343c" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/><path d="M30 14 L40 58 L60 54 L52 8" fill="#c22a32" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>` },
  };

  /* ---------------- states: what each looks like and how it moves ---------------- */
  // color: her tint and glow for that mood (the UI stays monochrome; Cassie may be colourful)
  const STATES = {
    idle:        { eyes: 'caret',  mouth: 'none',   motion: 'breathe' },
    greeting:    { eyes: 'happy',  mouth: 'smile',  motion: 'wave', blush: 0.7, color: '#ffb48a', effect: 'dust' },
    listening:   { eyes: 'ibeam',  mouth: 'none',   motion: 'lean', badge: 'ibeam', color: '#7aa7ff' },
    thinking:    { eyes: 'caret',  mouth: 'none',   motion: 'ponder', badge: 'dots', look: [0.55, -0.6], color: '#a58bff' },
    writing:     { eyes: 'caret',  mouth: 'none',   motion: 'type', effect: 'lines', color: '#7aa7ff' },
    reading:     { eyes: 'caret',  mouth: 'none',   motion: 'breathe', effect: 'scan', badge: 'dots', color: '#4fd1b5' },
    searching:   { eyes: 'caret',  mouth: 'none',   motion: 'ponder', effect: 'search', badge: 'lens', color: '#56c8f5' },
    highlighting:{ eyes: 'happy',  mouth: 'smile',  motion: 'breathe', effect: 'highlight', blush: 0.6, color: '#ffd166' },
    snipping:    { eyes: 'short',  mouth: 'flat',   motion: 'still', effect: 'snip', color: '#b7bcc8' },
    drawing:     { eyes: 'caret',  mouth: 'smile',  motion: 'type', effect: 'scribble', badge: 'pencil', look: [0.6, 0.55], color: '#ff9f6b' },
    upload:      { eyes: 'wide',   mouth: 'o',      motion: 'gulp', effect: 'drop', color: '#3fd6c4' },
    done:        { eyes: 'happy',  mouth: 'smile',  motion: 'click', badge: 'check', blush: 0.6, color: '#4cd497', effect: 'sparkle' },
    proud:       { eyes: 'star',   mouth: 'grin',   motion: 'hop', badge: 'star', effect: 'sparkle', blush: 0.8, color: '#ffcf5a' },
    encourage:   { eyes: 'happy',  mouth: 'smile',  motion: 'nod', badge: 'heart', blush: 0.5, color: '#ff9fb6' },
    oops:        { eyes: 'x',      mouth: 'wobble', motion: 'shake', badge: 'ban', color: '#ff5a5f' },
    busy:        { eyes: 'short',  mouth: 'flat',   motion: 'breathe', badge: 'hourglass', color: '#f5a524' },
    sleeping:    { eyes: 'closed', mouth: 'none',   motion: 'sleep', badge: 'z', dim: 0.12, color: '#7d8bbd' },
    love:        { eyes: 'heart',  mouth: 'smile',  motion: 'float', badge: 'heart', blush: 1, color: '#ff7aa8', effect: 'hearts' },
    surprised:   { eyes: 'wide',   mouth: 'o',      motion: 'jump', color: '#ffd166' },
    wink:        { eyes: 'wink',   mouth: 'smile',  motion: 'tilt', blush: 0.5, color: '#ffb48a' },
    dizzy:       { eyes: 'spiral', mouth: 'wobble', motion: 'wobble', color: '#ff8ad8' },
    sad:         { eyes: 'sad',    mouth: 'flat',   motion: 'droop', color: '#8fa3c8' },
    talking:     { eyes: 'caret',  mouth: 'talk',   motion: 'breathe', color: '#7aa7ff' },
    poke:        { eyes: 'squint', mouth: 'wobble', motion: 'poke', color: '#ffa24d' },
    dance:       { eyes: 'happy',  mouth: 'grin',   motion: 'dance', blush: 0.7, color: '#c58bff', effect: 'notes' },
  };

  const hex = (h) => { h = h.replace('#', ''); if (h.length === 3) h = h.split('').map((c) => c + c).join(''); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };
  const mix = (a, b, k) => { const x = hex(a), y = hex(b); return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * k).toString(16).padStart(2, '0')).join(''); };
  let uid = 0;
  const reduced = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const el = (tag, attrs = {}, html) => { const n = document.createElementNS(NS, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); if (html != null) n.innerHTML = html; return n; };

  function create(host, opts = {}) {
    const id = 'cb' + (++uid);
    const svg = el('svg', { viewBox: '40 -10 400 450', class: 'cassie-bot', role: 'img', 'aria-label': 'Cassie' });
    svg.style.overflow = 'visible';
    svg.innerHTML = `
      <defs>
        <radialGradient id="${id}-shade" cx="34%" cy="30%" r="78%">
          <stop class="cb-s0" offset="0" stop-color="#ffffff"/><stop class="cb-s1" offset=".6" stop-color="${PAPER}"/><stop class="cb-s2" offset="1" stop-color="#e9e5dd"/>
        </radialGradient>
        <radialGradient id="${id}-glow"><stop class="cb-g0" offset="0" stop-color="#ffffff" stop-opacity=".8"/><stop class="cb-g1" offset=".5" stop-color="#ffffff" stop-opacity=".28"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>
        <clipPath id="${id}-clip"><path class="cb-clip"/></clipPath>
        <filter id="${id}-soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="9"/></filter>
        <filter id="${id}-shadow" x="-30%" y="-80%" width="160%" height="260%"><feGaussianBlur stdDeviation="8"/></filter>
      </defs>
      ${opts.glow ? `<circle class="cb-glow" cx="236" cy="246" r="250" fill="url(#${id}-glow)" opacity="0"/>` : ''}
      <ellipse class="cb-ground" cx="250" cy="418" rx="120" ry="13" fill="${INK}" opacity=".16" filter="url(#${id}-shadow)"/>
      <g class="cb-fx-back"></g>
      <g class="cb-all">
        <g class="cb-body">
          <path class="cb-fill" fill="url(#${id}-shade)"/>
          <g clip-path="url(#${id}-clip)">
            <path class="cb-inner" fill="none" stroke="#9a9488" stroke-width="26" opacity=".13" filter="url(#${id}-soft)"/>
            <ellipse cx="190" cy="150" rx="70" ry="34" fill="#fff" opacity=".85" filter="url(#${id}-soft)" transform="rotate(30 190 150)"/>
            <rect class="cb-hl" x="-60" y="246" width="560" height="44" rx="10" opacity="0"/>
            <g class="cb-blush">
              <ellipse cx="${BLUSH.l[0]}" cy="${BLUSH.l[1]}" rx="20" ry="11" filter="url(#${id}-soft)"/>
              <ellipse cx="${BLUSH.r[0]}" cy="${BLUSH.r[1]}" rx="20" ry="11" filter="url(#${id}-soft)"/>
            </g>
          </g>
          <path class="cb-line" fill="none" stroke="${INK}" stroke-width="9" stroke-linejoin="round"/>
          <g class="cb-acc-neck"></g>
          <g class="cb-face" fill="${INK}" stroke="${INK}">
            <g class="cb-eye cb-eye-l"><g class="cb-eye-in"></g></g>
            <g class="cb-eye cb-eye-r"><g class="cb-eye-in"></g></g>
            <g class="cb-mouth" transform="translate(216 276)"></g>
          </g>
          <g class="cb-acc-face" transform="translate(216 236) scale(1.25)"></g>
          <g class="cb-acc-top" transform="translate(${HAT.x} ${HAT.y}) rotate(${HAT.angle}) scale(${HAT.scale})"></g>
          <g class="cb-badge" transform="translate(372 196)" opacity="0">
            <circle r="24" fill="#fff" stroke="${INK}" stroke-width="5"/>
            <g class="cb-badge-in" fill="${INK}" stroke="${INK}"></g>
          </g>
        </g>
      </g>
      <g class="cb-fx-front"></g>`;
    host.appendChild(svg);
    const q = (s) => svg.querySelector(s);
    const parts = {
      all: q('.cb-all'), body: q('.cb-body'), fill: q('.cb-fill'), line: q('.cb-line'), inner: q('.cb-inner'), clip: q('.cb-clip'),
      eyeL: q('.cb-eye-l'), eyeR: q('.cb-eye-r'), eyeLin: q('.cb-eye-l .cb-eye-in'), eyeRin: q('.cb-eye-r .cb-eye-in'),
      mouth: q('.cb-mouth'), blush: q('.cb-blush'), hl: q('.cb-hl'), badge: q('.cb-badge'), badgeIn: q('.cb-badge-in'),
      glow: q('.cb-glow'), stops: [q('.cb-s0'), q('.cb-s1'), q('.cb-s2')], glowStops: [q('.cb-g0'), q('.cb-g1')],
      accTop: q('.cb-acc-top'), accFace: q('.cb-acc-face'), accNeck: q('.cb-acc-neck'), fxBack: q('.cb-fx-back'), fxFront: q('.cb-fx-front'), ground: q('.cb-ground'),
    };
    parts.accNeck.setAttribute('transform', 'translate(214 330) rotate(-6)');

    let accent = opts.accent || '#d8343c';
    let stateName = '', st = STATES.idle, stateAt = 0, accessory = null;
    let lookX = 0, lookY = 0, wantX = 0, wantY = 0, pointerLook = null;
    let blinkUntil = 0, nextBlink = performance.now() + 2200, glanceUntil = 0, glance = [0, 0];
    let raf = 0, last = 0, t0 = performance.now(), alive = true, paused = false, pokeTimer = 0;
    const shown = { eyes: '', mouth: '', badge: '', fx: '' };

    function paintAccent() {
      parts.blush.setAttribute('fill', accent);
      parts.hl.setAttribute('fill', accent);
    }
    function setEyes(kind) {
      if (shown.eyes === kind) return;
      shown.eyes = kind;
      const [l, r] = kind === 'wink' ? ['caret', 'happy'] : kind === 'squint' ? ['squintL', 'squintR'] : [kind, kind];
      parts.eyeLin.innerHTML = EYE[l] || EYE.caret;
      parts.eyeRin.innerHTML = EYE[r] || EYE.caret;
    }
    function setMouth(kind) { if (shown.mouth !== kind) { shown.mouth = kind; parts.mouth.innerHTML = MOUTH[kind] || ''; } }
    function setBadge(kind) {
      if (shown.badge === kind) return;
      shown.badge = kind;
      parts.badgeIn.innerHTML = kind ? BADGE[kind] || '' : '';
      parts.badge.setAttribute('opacity', kind ? '1' : '0');
    }
    function setFx(kind) {
      if (shown.fx === kind) return;
      shown.fx = kind;
      parts.fxBack.innerHTML = ''; parts.fxFront.innerHTML = '';
      parts.hl.setAttribute('opacity', '0');
      if (kind === 'snip') parts.fxFront.innerHTML = `<rect class="cb-ants" x="70" y="58" width="350" height="372" rx="6" fill="none" stroke="${INK}" stroke-width="5" stroke-dasharray="16 11"/>`;
      if (kind === 'lines') parts.fxBack.innerHTML = [0, 1, 2].map((i) => `<rect class="cb-ln" data-i="${i}" x="352" y="${330 + i * 24}" width="0" height="11" rx="5.5" fill="${INK}" opacity=".7"/>`).join('');
      if (kind === 'scan') parts.fxBack.innerHTML = `<g transform="translate(330 300) rotate(8)"><rect x="0" y="0" width="86" height="108" rx="10" fill="#fff" stroke="${INK}" stroke-width="5"/>${[0, 1, 2, 3, 4].map((i) => `<rect x="14" y="${18 + i * 17}" width="${i === 4 ? 34 : 58}" height="7" rx="3.5" fill="${INK}" opacity=".55"/>`).join('')}<rect class="cb-scanline" x="8" y="14" width="70" height="14" rx="4" fill="${accent}" opacity=".45"/></g>`;
      if (kind === 'search') parts.fxFront.innerHTML = `<g class="cb-lens"><circle r="34" fill="#ffffff55" stroke="${INK}" stroke-width="7"/><path d="M24 24 L50 50" stroke="${INK}" stroke-width="11" stroke-linecap="round"/></g>`;
      if (kind === 'scribble') parts.fxBack.innerHTML = `<path class="cb-scrib" d="M330 410 C350 380 372 430 392 400 S430 380 446 404" fill="none" stroke="${accent}" stroke-width="7" stroke-linecap="round" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100"/>`;
      if (kind === 'sparkle') parts.fxFront.innerHTML = [[96, 70, 1], [420, 150, 0.8], [436, 330, 0.7], [70, 300, 0.9], [300, 40, 0.6]].map(([x, y, s], i) => `<path class="cb-sp" data-i="${i}" transform="translate(${x} ${y}) scale(${s})" d="M0 -16 C2 -4 4 -2 16 0 C4 2 2 4 0 16 C-2 4 -4 2 -16 0 C-4 -2 -2 -4 0 -16Z" fill="${st.color || accent}"/>`).join('');
      if (kind === 'highlight') parts.hl.setAttribute('opacity', '.38');
      if (kind === 'dust') {
        let dots = '';
        for (let i = 0; i < 90; i++) { const a = (i / 90) * Math.PI * 2 + Math.random() * 0.2, r = 190 + Math.random() * 46; dots += `<circle class="cb-dust" cx="${(236 + Math.cos(a) * r).toFixed(1)}" cy="${(246 + Math.sin(a) * r * 0.86).toFixed(1)}" r="${(1.2 + Math.random() * 2.4).toFixed(1)}" fill="${st.color || INK}" data-p="${Math.random().toFixed(2)}"/>`; }
        parts.fxBack.innerHTML = `<g class="cb-dustring">${dots}</g>`;
      }
      if (kind === 'hearts') parts.fxFront.innerHTML = [0, 1, 2, 3].map((i) => `<path class="cb-float" data-i="${i}" d="M0 9 C-14 0 -9 -13 0 -6 C9 -13 14 0 0 9Z" fill="${st.color}" stroke="${INK}" stroke-width="3"/>`).join('');
      if (kind === 'notes') parts.fxFront.innerHTML = [0, 1, 2].map((i) => `<g class="cb-float" data-i="${i}"><path d="M4 -16 V8 M4 -16 L16 -20 V2" fill="none" stroke="${st.color || INK}" stroke-width="5" stroke-linecap="round"/><ellipse cx="-1" cy="9" rx="7" ry="5.5" fill="${st.color || INK}"/><ellipse cx="11" cy="3" rx="7" ry="5.5" fill="${st.color || INK}"/></g>`).join('');
      if (kind === 'drop') parts.fxFront.innerHTML = `<g class="cb-doc"><path d="M-22 -28 H10 L22 -16 V28 H-22 Z" fill="#fff" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/><path d="M10 -28 V-16 H22" fill="none" stroke="${INK}" stroke-width="4"/><rect x="-14" y="-6" width="28" height="10" rx="3" fill="#d8343c"/><rect x="-14" y="9" width="20" height="5" rx="2.5" fill="${INK}" opacity=".5"/></g>`;
    }
    function setAccessoryNow(name) {
      accessory = ACC[name] ? name : null;
      parts.accTop.innerHTML = ''; parts.accFace.innerHTML = ''; parts.accNeck.innerHTML = '';
      if (!accessory) return;
      const a = ACC[accessory];
      (a.layer === 'face' ? parts.accFace : a.layer === 'neck' ? parts.accNeck : parts.accTop).innerHTML = a.svg;
    }

    function setState(name) {
      if (!STATES[name]) name = 'idle';
      if (name === stateName && name !== 'done' && name !== 'surprised' && name !== 'proud') return;
      stateName = name; st = STATES[name]; stateAt = performance.now();
      const c = st.color;
      const base = ['#ffffff', PAPER, '#e9e5dd'];
      parts.stops.forEach((n, i) => n.setAttribute('stop-color', c ? mix(base[i], c, [0.22, 0.4, 0.58][i]) : base[i]));
      if (parts.glow) { parts.glowStops.forEach((n) => n.setAttribute('stop-color', c || '#ffffff')); }
      setEyes(st.eyes); setMouth(st.mouth); setBadge(st.badge || ''); setFx(st.effect || '');
    }

    function frame(now) {
      if (!alive) return;
      raf = requestAnimationFrame(frame);
      if (paused || document.hidden || now - last < 32) return; // ~30 fps is plenty, and nothing while hidden or paused
      last = now;
      const t = (now - t0) / 1000, ts = (now - stateAt) / 1000;
      const calm = reduced();
      let bob = 0, sx = 1, sy = 1, rot = 0, dx = 0, tail = 0;
      const m = calm ? 'still' : st.motion;
      if (m === 'breathe' || m === 'type' || m === 'lean' || m === 'ponder' || m === 'float') { const b = Math.sin(t * 2.2); sy = 1 + b * 0.018; sx = 1 - b * 0.012; tail = Math.sin(t * 1.6) * 4; }
      if (m === 'type') { bob = -Math.abs(Math.sin(t * 9)) * 4; tail = Math.sin(t * 9) * 5; }
      if (m === 'lean') { rot = -4; dx = -6; }
      if (m === 'ponder') { rot = Math.sin(t * 1.2) * 4; }
      if (m === 'float') { bob = Math.sin(t * 2.4) * 8; }
      if (m === 'wave') { rot = Math.sin(t * 7) * 7; tail = Math.sin(t * 12) * 16; bob = -Math.abs(Math.sin(t * 7)) * 6; }
      if (m === 'click') { const k = Math.max(0, 1 - ts * 2.2); sy = 1 - 0.14 * k * Math.abs(Math.cos(ts * 14)); sx = 1 + 0.08 * k * Math.abs(Math.cos(ts * 14)); tail = Math.sin(t * 3) * 6; }
      if (m === 'hop') { const h = Math.abs(Math.sin(t * 5.2)); bob = -h * 26; sy = 1 + (h > 0.92 ? -0.05 : 0.04 * h); tail = Math.sin(t * 10) * 12; }
      if (m === 'nod') { rot = Math.sin(t * 3.4) * 5; bob = Math.abs(Math.sin(t * 3.4)) * -5; }
      if (m === 'shake') { const k = Math.max(0.15, 1 - ts * 1.4); dx = Math.sin(t * 38) * 9 * k; }
      if (m === 'sleep') { const b = Math.sin(t * 1.1); sy = 1 + b * 0.03; sx = 1 - b * 0.02; rot = 6; tail = 3; }
      if (m === 'jump') { const k = Math.max(0, 1 - ts * 1.6); bob = -Math.abs(Math.sin(ts * 9)) * 30 * k; sy = 1 + 0.06 * k; }
      if (m === 'tilt') { rot = -8 + Math.sin(t * 2) * 2; }
      if (m === 'wobble') { rot = Math.sin(t * 4.2) * 11; dx = Math.sin(t * 2.1) * 6; }
      if (m === 'droop') { sy = 0.97; rot = 5; bob = 4; }
      if (m === 'dance') { rot = Math.sin(t * 6.4) * 10; dx = Math.sin(t * 3.2) * 14; bob = -Math.abs(Math.sin(t * 6.4)) * 12; tail = Math.sin(t * 12.8) * 18; }
      if (m === 'poke') { const k = Math.max(0, 1 - ts * 1.8); sx = 1 + 0.18 * k * Math.cos(ts * 22); sy = 1 - 0.16 * k * Math.cos(ts * 22); dx = 6 * k; }
      if (m === 'gulp') { const ph = (ts % 2.2); const hit = ph > 0.95 && ph < 1.5 ? Math.sin((ph - 0.95) / 0.55 * Math.PI) : 0; sy = 1 - 0.12 * hit; sx = 1 + 0.08 * hit; tail = Math.sin(t * 2) * 4; }

      // eyes: where to look (state, pointer, little glances), blinking like a caret
      let lx = 0, ly = 0;
      if (st.look) [lx, ly] = st.look;
      else if (pointerLook) [lx, ly] = pointerLook;
      if (stateName === 'idle' && now > glanceUntil + 3500 && Math.random() < 0.012) { glance = [Math.random() * 1.6 - 0.8, Math.random() * 0.9 - 0.45]; glanceUntil = now + 900; }
      if (now < glanceUntil && !st.look) [lx, ly] = glance;
      if (st.effect === 'scan') { const p = (t * 0.7) % 1; lx = -0.7 + p * 1.4; ly = -0.3 + Math.floor((t * 0.7) % 4) * 0.2; }
      if (st.effect === 'search') { lx = Math.sin(t * 2.6) * 0.8; ly = -0.15; }
      if (m === 'type' && st.effect === 'lines') { lx = -0.6 + ((t * 1.5) % 1) * 1.2; ly = 0.25; }
      wantX = lx; wantY = ly;
      lookX += (wantX - lookX) * 0.22; lookY += (wantY - lookY) * 0.22;
      let blink = 1;
      if (now > nextBlink && (st.eyes === 'caret' || st.eyes === 'ibeam' || st.eyes === 'short' || st.eyes === 'wide')) {
        blinkUntil = now + (Math.random() < 0.3 ? 2 * CARET_BLINK : 150); // sometimes the double caret blink
        nextBlink = now + 2600 + Math.random() * 3600;
      }
      if (now < blinkUntil) {
        if (blinkUntil - now > 200) blink = Math.floor((blinkUntil - now) / CARET_BLINK * 2) % 2 ? 0.08 : 1; // caret on / off
        else blink = 0.1;
      }
      const ex = lookX * 13, ey = lookY * 10;
      const F = 1.32; // face features drawn big so she reads at 60–80 px
      parts.eyeL.setAttribute('transform', `translate(${EYES.l[0] + ex} ${EYES.l[1] + ey}) scale(${F} ${F * blink})`);
      parts.eyeR.setAttribute('transform', `translate(${EYES.r[0] + ex} ${EYES.r[1] + ey}) scale(${F} ${F * blink})`);
      parts.mouth.setAttribute('transform', `translate(${216 + ex * 0.6} ${282 + ey * 0.5}) scale(${F} ${F * (st.mouth === 'talk' ? 0.5 + Math.abs(Math.sin(t * 11)) * 0.8 : 1)})`);
      parts.blush.setAttribute('opacity', String(st.blush || 0.28));

      const d = bodyPath(tail);
      parts.fill.setAttribute('d', d); parts.line.setAttribute('d', d); parts.inner.setAttribute('d', d); parts.clip.setAttribute('d', d);
      parts.all.setAttribute('transform', `translate(${dx} ${bob}) rotate(${rot} 240 400) translate(240 400) scale(${sx} ${sy}) translate(-240 -400)`);
      parts.all.style.opacity = st.dim ? String(1 - st.dim) : '1';
      parts.ground.setAttribute('rx', String(120 * (1 + bob / 160)));

      // effects
      if (st.effect === 'highlight') { const p = Math.min(1, ts / 0.7); parts.hl.setAttribute('x', String(-560 + p * 600)); }
      if (st.effect === 'snip') { const a = svg.querySelector('.cb-ants'); if (a) a.setAttribute('stroke-dashoffset', String(-(t * 40) % 27)); }
      if (st.effect === 'lines') svg.querySelectorAll('.cb-ln').forEach((r) => { const i = +r.dataset.i; const p = ((t * 0.8) - i * 0.33) % 1; r.setAttribute('width', String(Math.max(0, Math.min(1, p * 1.6)) * (i === 2 ? 52 : 80))); });
      if (st.effect === 'scan') { const s = svg.querySelector('.cb-scanline'); if (s) s.setAttribute('y', String(14 + ((t * 0.7) % 4 | 0) * 17)); }
      if (st.effect === 'search') { const l = svg.querySelector('.cb-lens'); if (l) l.setAttribute('transform', `translate(${226 + Math.sin(t * 2.6) * 70} ${236 + Math.cos(t * 5.2) * 10})`); }
      if (st.effect === 'scribble') { const s = svg.querySelector('.cb-scrib'); if (s) s.setAttribute('stroke-dashoffset', String(100 - ((t * 45) % 130))); }
      if (st.effect === 'sparkle') svg.querySelectorAll('.cb-sp').forEach((s) => { const i = +s.dataset.i; const k = Math.max(0, Math.sin(t * 4 + i * 1.3)); s.style.opacity = String(k); });
      if (st.effect === 'dust') { const g = svg.querySelector('.cb-dustring'); if (g) g.setAttribute('transform', `rotate(${(t * 9) % 360} 236 246)`); svg.querySelectorAll('.cb-dust').forEach((c) => c.setAttribute('opacity', String(0.25 + 0.75 * Math.abs(Math.sin(t * 2 + c.dataset.p * 9))))); }
      if (st.effect === 'hearts' || st.effect === 'notes') svg.querySelectorAll('.cb-float').forEach((n) => { const i = +n.dataset.i; const p = ((t * 0.45) + i / (st.effect === 'notes' ? 3 : 4)) % 1; n.setAttribute('transform', `translate(${(st.effect === 'notes' ? 380 : 330) + Math.sin(p * 6 + i) * 24 - i * 18} ${200 - p * 190}) scale(${(st.effect === 'notes' ? 1.4 : 1.2) * (1 - p * 0.3)})`); n.style.opacity = String(Math.min(1, (1 - p) * 2.2)); });
      if (st.effect === 'drop') { const d = svg.querySelector('.cb-doc'); if (d) { const ph = (ts % 2.2); const p = Math.min(1, ph / 0.95); const y = -30 + p * p * 190; const sc = ph < 0.95 ? 1.4 : Math.max(0, 1.4 - (ph - 0.95) * 4); d.setAttribute('transform', `translate(232 ${y}) rotate(${(1 - p) * -14}) scale(${sc})`); d.style.opacity = ph < 1.3 ? '1' : '0'; } }
      if (parts.glow) { const c = st.color; parts.glow.setAttribute('opacity', c ? String(0.75 + 0.25 * Math.sin(t * 2.4)) : '0.25'); }
      if (st.badge === 'dots') svg.querySelectorAll('.cb-d1,.cb-d2,.cb-d3').forEach((c, i) => c.setAttribute('cy', String(-Math.max(0, Math.sin(t * 6 - i * 0.9)) * 4)));
      if (st.badge === 'hourglass') parts.badgeIn.setAttribute('transform', `rotate(${(Math.floor(t / 1.6) % 2) * 180 + Math.min(1, (t % 1.6) / 0.35) * 180 * ((t % 1.6) > 1.25 ? 1 : 0)})`);
      else parts.badgeIn.removeAttribute('transform');
      if (st.badge === 'z') parts.badge.setAttribute('transform', `translate(${372 + Math.sin(t) * 6} ${196 - (t * 10 % 18)})`);
      else parts.badge.setAttribute('transform', 'translate(372 196)');
      parts.badge.setAttribute('opacity', st.badge ? '1' : '0');
    }

    if (opts.pokeable) { svg.style.cursor = 'pointer'; svg.style.pointerEvents = 'auto'; svg.addEventListener('click', () => api.poke()); }
    setState(opts.state || 'idle');
    paintAccent();
    setAccessoryNow(opts.accessory || null);
    frame(performance.now() + 100);

    const api = {
      el: svg,
      setState,
      get state() { return stateName; },
      setAccessory(name) { setAccessoryNow(name); },
      get accessory() { return accessory; },
      setAccent(hex) { if (/^#[0-9a-f]{3,8}$/i.test(hex || '')) { accent = hex; paintAccent(); shown.fx = ''; setFx(st.effect || ''); } },
      pause(on = true) { paused = !!on; },
      poke() { const back = stateName === 'poke' ? 'idle' : stateName; setState('poke'); clearTimeout(pokeTimer); pokeTimer = setTimeout(() => setState(back), 950); },
      look(x, y) { pointerLook = x == null ? null : [Math.max(-1, Math.min(1, x)), Math.max(-1, Math.min(1, y))]; },
      destroy() { alive = false; cancelAnimationFrame(raf); svg.remove(); },
    };
    return api;
  }

  // Seasonal outfits for the Philippines: the long "ber months" Christmas season,
  // Halloween, and graduation season.
  function seasonal(d = new Date()) {
    const m = d.getMonth() + 1, day = d.getDate();
    if (m === 10 && day >= 25 || m === 11 && day <= 2) return 'witch';
    if (m === 12 || (m === 11 && day >= 15)) return 'santa';
    if (m === 1 && day <= 2) return 'party';
    if (m === 2 && day === 14) return 'bow';
    if (m === 6 && day === 12) return 'salakot'; // Independence Day
    return null;
  }

  window.CassieBot = {
    create, seasonal,
    STATES: Object.keys(STATES), COLORS: Object.fromEntries(Object.entries(STATES).map(([k, v]) => [k, v.color || null])), ACCESSORIES: Object.keys(ACC),
    construction: { POINTER, TAIL_PIVOT, EYES, HAT, TOP_SLOPE, CARET_BLINK, roundedPath, bodyPath },
  };
})();

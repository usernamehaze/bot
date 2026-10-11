/* The scroll story on the landing page: each scene stays on screen while you scroll through it,
   and how far you've scrolled (0 → 1) moves what's inside — the card grows, the steps go by,
   a dot travels the path, the ring fills. No libraries; with reduced motion every scene just
   shows how it ends. */
(function () {
  'use strict';
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  var lerp = function (a, b, t) { return a + (b - a) * t; };
  var ease = function (t) { t = clamp(t, 0, 1); return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; };
  var span = function (p, a, b) { return clamp((p - a) / (b - a), 0, 1); }; // 0…1 between a and b
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var SCENES = {
    // 0. the camera flies down to the laptop until its screen fills yours, Labs scroll by, then it flies out the other side
    show: function (el, p) {
      var st = el._lx || (el._lx = setupLx(el));
      var vw = innerWidth, vh = innerHeight, small = vw <= 860;
      var zin = ease(span(p, 0.04, 0.24)), zout = ease(span(p, 0.84, 0.97)), z = zin * (1 - zout);
      var from = p < 0.5 ? { rx: 52, rz: -24 } : { rx: 54, rz: 18 }; // it leaves from the other side
      var S0 = (small ? vw * 0.6 : Math.min(vw * 0.42, 680)) / 1000, S1 = Math.min(vw / 1000, vh / 640) * (small ? 1 : 0.94);
      var S = lerp(S0, S1, z), out = 1 - z;
      // far away, the whole desk (laptop and phone) sits a little lower and left so it's centred
      var tx = (small ? -280 : -150) * S0 * out * (p < 0.5 ? 1 : 0.6), ty = (small ? 30 : 10) * out;
      st.rig.style.transform = 'translate3d(' + tx.toFixed(1) + 'px,' + ty.toFixed(1) + 'px,-309px) scale(' + S.toFixed(4) + ') rotateX(' + lerp(from.rx, 75, z).toFixed(2) + 'deg) rotateZ(' + lerp(from.rz, 0, z).toFixed(2) + 'deg)';
      st.cap.style.opacity = p < 0.5 ? 1 - span(p, 0.02, 0.1) : span(p, 0.92, 0.99);
      // On the screen: the Labs shelf → a tap on "Human body 3D" → the body pulls apart, system by
      // system → back to Labs → a tap on "Solar system" → the planets, one after another.
      var W = st.view.clientWidth, H = st.view.clientHeight, k = W / 1600;
      var shelf = (1 - span(p, 0.40, 0.42)) + span(p, 0.58, 0.60) * (1 - span(p, 0.645, 0.665));
      var down = -90 * k * ease(span(p, 0.27, 0.33)); // the shelf scrolls a little
      st.shelf.style.opacity = shelf.toFixed(3);
      st.shelf.style.transform = 'translateY(' + down.toFixed(1) + 'px)';
      st.body.style.opacity = (span(p, 0.40, 0.42) * (1 - span(p, 0.58, 0.60))).toFixed(3);
      if (p > 0.38 && p < 0.62) drawBody(st, Math.round((st.frames.length - 1) * ease(span(p, 0.43, 0.565))), W, H);
      st.planets.style.opacity = span(p, 0.645, 0.665).toFixed(3);
      var n = st.worlds.length, t = span(p, 0.665, 0.83) * n, cur = Math.min(n - 1, Math.floor(t)), f = t - cur;
      st.worlds.forEach(function (im, i) {
        var o = i === cur ? 1 : i === cur + 1 ? span(f, 0.78, 1) : 0, local = i === cur ? f : i === cur + 1 ? 0 : 0;
        if (i === cur && i < n - 1) o = 1; // (the next one fades in over it)
        im.style.opacity = o.toFixed(3);
        im.style.transform = 'scale(' + (1.03 + 0.06 * local).toFixed(4) + ')';
      });
      // Cassie's cursor goes to the card and taps it
      var cardY = function (y) { return y * k + down; };
      var tap = function (a, b, c, X, Y) { // moves a→b, taps at b…c
        var m = ease(span(p, a, b));
        return { on: p > a - 0.01 && p < c + 0.01, x: lerp(W * 0.62, X, m), y: lerp(H * 0.78, Y, m), t: span(p, b, c) };
      };
      var A = tap(0.33, 0.375, 0.395, 0.105 * W, cardY(395)), B = tap(0.6, 0.625, 0.645, 0.895 * W, cardY(568));
      var c = A.on ? A : B.on ? B : null;
      st.cursor.style.opacity = c ? String(Math.min(1, span(p, A.on ? 0.32 : 0.59, A.on ? 0.335 : 0.605)) * (1 - span(c.t, 0.7, 1))) : '0';
      if (c) {
        var press = c.t > 0 && c.t < 0.5 ? 0.85 : 1;
        st.cursor.style.transform = 'translate(' + c.x.toFixed(1) + 'px,' + c.y.toFixed(1) + 'px) scale(' + press + ')';
        st.tap.style.opacity = c.t > 0 ? (1 - c.t).toFixed(3) : '0';
        st.tap.style.transform = 'translate(' + c.x.toFixed(1) + 'px,' + c.y.toFixed(1) + 'px) scale(' + (0.3 + c.t * 1.2).toFixed(3) + ')';
      } else st.tap.style.opacity = '0';
      // what types itself on the screen
      var line = p < 0.42 ? [0.29, TYPE[0]] : p < 0.62 ? [0.43, TYPE[1]] : [0.665, TYPE[2]];
      st.txt.textContent = line[1].slice(0, Math.round(line[1].length * span(p, line[0], line[0] + 0.05)));
      st.type.style.opacity = span(p, 0.25, 0.29) * (1 - span(p, 0.82, 0.85));
      var ph = p < 0.42 ? 0 : p < 0.645 ? 1 : 2;
      st.phone.forEach(function (im, i) { im.classList.toggle('on', i === ph); });
    },
    // 2. a dark card grows from the middle of the page until it fills the screen
    grow: function (el, p) {
      var card = $('.sg-card', el), g = ease(span(p, 0.12, 0.72));
      var w0 = Math.min(560, innerWidth * 0.76), h0 = Math.min(320, innerHeight * 0.4);
      card.style.width = lerp(w0, innerWidth, g) + 'px';
      card.style.height = lerp(h0, innerHeight, g) + 'px';
      card.style.borderRadius = lerp(18, 0, g) + 'px';
      var fade = 1 - span(p, 0.1, 0.4);
      $('.sg-top', el).style.opacity = fade; $('.sg-bot', el).style.opacity = fade;
      $('.sg-top', el).style.transform = 'translateY(' + (-40 * (1 - fade)) + 'px)';
      $('.sg-bot', el).style.transform = 'translateY(' + (40 * (1 - fade)) + 'px)';
      // once it's big, a line of a lesson appears and Cassie's cursor highlights two words
      var t = span(p, 0.6, 0.75), hl = ease(span(p, 0.75, 0.95));
      card.style.setProperty('--sg-text', t);
      card.style.setProperty('--sg-hl', hl);
      var m = $('.sg-text mark', el);
      if (m && t > 0) { // the cursor sweeps along the highlighted words
        var r = m.getBoundingClientRect(), c = card.getBoundingClientRect();
        card.style.setProperty('--sg-cx', (r.left - c.left + r.width * hl) + 'px');
        card.style.setProperty('--sg-cy', (r.top - c.top + r.height * 0.7) + 'px');
      }
      el.style.setProperty('--p', span(p, 0.6, 1));
    },
    // 3. "Highlight" fills the screen, then becomes the first of four steps, each with its card
    steps: function (el, p) {
      var a = span(p, 0.04, 0.16);
      el.style.setProperty('--big-s', String(lerp(1, 0.55, ease(a))));
      el.style.setProperty('--big-o', String(1 - a));
      el.style.setProperty('--list-o', String(span(p, 0.12, 0.2)));
      var k = clamp(Math.floor((p - 0.16) / 0.205), 0, 3);
      $$('.ss-list li', el).forEach(function (li, i) { li.classList.toggle('on', i === k); li.classList.toggle('done', i < k || (i === 3 && p > 0.97)); });
      $$('.ss-card', el).forEach(function (c, i) { c.classList.toggle('on', i === k); c.classList.toggle('past', i < k); });
      el.style.setProperty('--p', span(p, 0.12, 1));
    },
    // 4. the subjects fly in from all around and settle in a row
    subjects: function (el, p) {
      var t = ease(span(p, 0.05, 0.7));
      el.style.setProperty('--sj-o', String(span(p, 0.1, 0.45)));
      $$('.sj-chips span', el).forEach(function (s, i) {
        var ang = i * 2.39996, d = (1 - t) * Math.min(innerWidth, 900) * (0.45 + (i % 3) * 0.12); // a golden-angle spiral
        s.style.transform = 'translate(' + (Math.cos(ang) * d).toFixed(1) + 'px,' + (Math.sin(ang) * d * 0.7).toFixed(1) + 'px) rotate(' + ((1 - t) * (i % 2 ? 18 : -18)).toFixed(1) + 'deg)';
        s.style.opacity = String(0.15 + t * 0.85);
      });
      el.style.setProperty('--p', p);
    },
    // 5. a word travels from your page, through Cassie, to your memory
    path: function (el, p) {
      var st = el._path || (el._path = setupPath(el));
      var t = ease(span(p, 0.05, 0.92)), L = st.len;
      var pt = st.main.getPointAtLength(L * t);
      st.main.style.strokeDashoffset = String(L * (1 - t));
      st.dot.setAttribute('cx', pt.x); st.dot.setAttribute('cy', pt.y);
      var svgBox = st.svg.getBoundingClientRect(), pin = el.firstElementChild.getBoundingClientRect(), vb = st.svg.viewBox.baseVal;
      var sc = Math.min(svgBox.width / vb.width, svgBox.height / vb.height);
      var ox = svgBox.left - pin.left + (svgBox.width - vb.width * sc) / 2, oy = svgBox.top - pin.top + (svgBox.height - vb.height * sc) / 2;
      var half = st.pill.offsetWidth / 2 + 12; // keep the pill on screen
      st.pill.style.left = clamp(ox + pt.x * sc, half, pin.width - half) + 'px'; st.pill.style.top = (oy + pt.y * sc) + 'px';
      var last = 0;
      st.nodes.forEach(function (n, i) { var on = t >= n.t - 0.001; n.el.classList.toggle('on', on); if (on) last = i; });
      st.status.textContent = NODES[last][2];
      st.pill.textContent = NODES[last][3];
    },
    // 6. your question goes in, the ring fills while Cassie thinks, the answer comes out
    brain: function (el, p) {
      var r = ease(span(p, 0.08, 0.7));
      el.style.setProperty('--in', String(span(p, 0, 0.2)));
      el.style.setProperty('--ring', String(r));
      el.style.setProperty('--glow', String(r));
      el.style.setProperty('--out', String(span(p, 0.72, 0.9)));
      var STEPS = ['Read it', 'Factor', '(x − 3)(x + 1)', 'Check'];
      $('.sb-steps', el).textContent = r < 1 ? STEPS[Math.min(STEPS.length - 1, Math.floor(r * STEPS.length))] : 'Solved';
      $('.sb-note', el).textContent = r < 1 ? 'thinking…' : 'step by step';
    },
  };

  // what types itself on the laptop's screen while each part is showing
  var TYPE = ['29 labs. Tap one to play.', 'Human body 3D: pull every system apart.', 'The planets, from real NASA maps.'];
  // the laptop scene's pieces; the body's frames load only when the scene comes near
  function setupLx(el) {
    var st = { rig: $('.lx-rig', el), view: $('.lx-view', el), shelf: $('.lx-shelf', el), body: $('.lx-body', el), planets: $('.lx-planets', el), worlds: $$('.lx-planets img', el),
      cursor: $('.lx-cursor', el), tap: $('.lx-tap', el), type: $('.lx-type', el), txt: $('.lx-type span', el), cap: $('.lx-cap', el), phone: $$('.lx-pview img', el), frames: [], drawn: -1 };
    var n = +st.body.dataset.frames || 18, dpr = Math.min(2, window.devicePixelRatio || 1);
    var big = st.view.clientWidth * dpr > 1000 || innerWidth > 860;
    for (var i = 0; i < n; i++) {
      var im = new Image(); im.decoding = 'async';
      im.onload = function () { st.drawn = -1; ask(); };
      im.src = 'landing/hero/lx-body-' + String(i).padStart(2, '0') + (big ? '' : '-s') + '.webp';
      st.frames.push(im);
    }
    return st;
  }
  // draw one frame of the body pulling apart (covering the screen, like the app does)
  function drawBody(st, i, W, H) {
    var cv = st.body, dpr = Math.min(2, window.devicePixelRatio || 1), cw = Math.round(W * dpr), ch = Math.round(H * dpr);
    if (cv.width !== cw || cv.height !== ch) { cv.width = cw; cv.height = ch; st.drawn = -1; }
    // the nearest frame that has arrived
    var j = i; while (j > 0 && !(st.frames[j].complete && st.frames[j].naturalWidth)) j--;
    var im = st.frames[j];
    if (!im || !im.complete || !im.naturalWidth || st.drawn === j) return;
    var s = Math.max(cw / im.naturalWidth, ch / im.naturalHeight), w = im.naturalWidth * s, h = im.naturalHeight * s;
    var g = cv.getContext('2d'); g.fillStyle = '#0d0d10'; g.fillRect(0, 0, cw, ch);
    g.drawImage(im, (cw - w) / 2, (ch - h) / 2, w, h);
    st.drawn = j;
  }

  // the path's stops: [where along the path 0…1, name, the status at the top, what travels]
  var NODES = [
    [0, 'Your page', 'Reading', 'cellular respiration'],
    [0.2, 'Highlight', 'Highlighted', 'cellular respiration'],
    [0.42, 'Cassie', 'Explained', 'glucose + O₂ → ATP'],
    [0.62, 'Quiz', 'Practised · 9/10', '✓ ATP'],
    [0.8, 'Review', 'Reviewed in 3 days', 'flashcard'],
    [1, 'Remembered', 'Remembered', 'yours for good'],
  ];
  function setupPath(el) {
    var svg = $('.sp-svg', el), main = $('.sp-main', el), len = main.getTotalLength();
    main.style.strokeDasharray = len + ' ' + len;
    var g = $('.sp-nodes', el), NS = 'http://www.w3.org/2000/svg', nodes = [];
    var k = innerWidth <= 860 ? 2.3 : 1; // on a phone the drawing is smaller, so its marks are bigger
    $('.sp-dot', el).setAttribute('r', 7 * k);
    NODES.forEach(function (n, i) {
      var pt = main.getPointAtLength(len * n[0]);
      var grp = document.createElementNS(NS, 'g'); grp.setAttribute('class', 'sp-node');
      var c = document.createElementNS(NS, 'circle'); c.setAttribute('cx', pt.x); c.setAttribute('cy', pt.y); c.setAttribute('r', 6 * k);
      var up = i % 2 === 0 && !(k > 1 && i === 0); // on a phone the first label goes under, clear of the second
      var tx = document.createElementNS(NS, 'text'); tx.setAttribute('x', pt.x); tx.setAttribute('y', pt.y + (up ? -22 : 34) * k); tx.setAttribute('text-anchor', i === 0 ? 'start' : i === NODES.length - 1 ? 'end' : 'middle'); tx.textContent = n[1];
      grp.appendChild(c); grp.appendChild(tx); g.appendChild(grp);
      nodes.push({ el: grp, t: n[0] });
    });
    return { svg: svg, main: main, len: len, dot: $('.sp-dot', el), pill: $('.sp-pill', el), status: $('.sp-status span', el), nodes: nodes };
  }

  var scenes = $$('[data-scene]').map(function (el) { return { el: el, fn: SCENES[el.dataset.scene] }; }).filter(function (s) { return s.fn; });
  function progress(el) {
    var r = el.getBoundingClientRect(), room = r.height - innerHeight;
    return room > 0 ? clamp(-r.top / room, 0, 1) : (r.top < innerHeight / 2 ? 1 : 0);
  }
  var queued = false;
  function frame() {
    queued = false;
    scenes.forEach(function (s) {
      var r = s.el.getBoundingClientRect();
      if (r.bottom < -innerHeight || r.top > innerHeight * 2) return; // far away: skip
      s.fn(s.el, reduce ? 1 : progress(s.el));
    });
  }
  function ask() { if (!queued) { queued = true; requestAnimationFrame(frame); } }
  addEventListener('scroll', ask, { passive: true });
  addEventListener('resize', function () { scenes.forEach(function (s) { if (s.el._path) s.el._path = null; }); $$('.sp-nodes').forEach(function (g) { g.textContent = ''; }); ask(); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(ask);
  ask();

  // the study shelf's ring fills when it comes into view
  var shelf = $('.st-shelf');
  if (shelf && 'IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (es) { if (es[0].isIntersecting) { shelf.classList.add('in'); io.disconnect(); } }, { threshold: 0.4 });
    io.observe(shelf);
  } else if (shelf) shelf.classList.add('in');
})();

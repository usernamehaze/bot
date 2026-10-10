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
      var st = el._lx || (el._lx = { rig: $('.lx-rig', el), feed: $('.lx-feed img', el), scr: $('.lx-scr', el), sims: $$('.lx-sim', el), type: $('.lx-type', el), txt: $('.lx-type span', el), cap: $('.lx-cap', el), phone: $$('.lx-phone img', el) });
      var vw = innerWidth, vh = innerHeight, small = vw <= 860;
      var zin = ease(span(p, 0.05, 0.3)), zout = ease(span(p, 0.8, 0.97)), z = zin * (1 - zout);
      var from = p < 0.5 ? { rx: 52, rz: -24 } : { rx: 54, rz: 18 }; // it leaves from the other side
      var S0 = (small ? vw * 0.6 : Math.min(vw * 0.42, 680)) / 1000, S1 = Math.min(vw / 1000, vh / 640) * (small ? 1 : 0.94);
      var S = lerp(S0, S1, z), out = 1 - z;
      // far away, the whole desk (laptop and phone) sits a little lower and left so it's centred
      var tx = (small ? -280 : -150) * S0 * out * (p < 0.5 ? 1 : 0.6), ty = (small ? 30 : 10) * out;
      st.rig.style.transform = 'translate3d(' + tx.toFixed(1) + 'px,' + ty.toFixed(1) + 'px,-309px) scale(' + S.toFixed(4) + ') rotateX(' + lerp(from.rx, 75, z).toFixed(2) + 'deg) rotateZ(' + lerp(from.rz, 0, z).toFixed(2) + 'deg)';
      // on screen: the Labs shelf scrolls, then a pendulum, then the planets
      var room = st.feed.offsetHeight - st.scr.offsetHeight;
      st.feed.style.transform = 'translateY(' + (-room * ease(span(p, 0.3, 0.56))).toFixed(1) + 'px)';
      var a = span(p, 0.56, 0.6), b = span(p, 0.68, 0.72);
      st.sims[0].style.opacity = a * (1 - b); st.sims[1].style.opacity = b;
      var line = p < 0.58 ? [0.3, TYPE[0]] : p < 0.7 ? [0.6, TYPE[1]] : [0.72, TYPE[2]];
      st.txt.textContent = line[1].slice(0, Math.round(line[1].length * span(p, line[0], line[0] + 0.06)));
      st.type.style.opacity = span(p, 0.27, 0.31) * (1 - span(p, 0.78, 0.81));
      st.cap.style.opacity = p < 0.5 ? 1 - span(p, 0.02, 0.1) : span(p, 0.9, 0.98);
      st.phone.forEach(function (im, i) { im.classList.toggle('on', i === (p > 0.6 ? 1 : 0)); });
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

  // what types itself on the laptop's screen while each Lab is showing
  var TYPE = ['29 labs — from cells to the solar system.', 'Pendulum: let go and watch the energy swap.', 'The planets, where they really are today.'];

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

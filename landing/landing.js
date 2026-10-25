/* Cassie landing page: small, dependency-free behaviour.
 * - starts the slow marble behind the hero (gradient.js) after first paint where WebGL works
 * - reveal-on-scroll, and the sentence that lights up word by word as you read it
 * - pricing: ₱ / $ and monthly / semester / yearly, and the Pasado Pass early list
 * - the tour video
 * (the demo to highlight is landing/try.js)
 */
(function () {
  'use strict';

  // the early list goes to Cassie's server (config.js)
  const SERVER = String(window.CASSIE_SERVER || '').trim().replace(/\/+$/, '');

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  $('#yr').textContent = new Date().getFullYear();

  /* ---------- nav turns light once you scroll past the hero ---------- */
  const nav = $('#nav'), hero = $('.hero');
  const onScroll = () => nav.classList.toggle('light', hero.getBoundingClientRect().bottom < 80);
  addEventListener('scroll', onScroll, { passive: true }); onScroll();

  /* ---------- the living marble background ---------- */
  function webglOK() {
    try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; }
  }
  const saveData = navigator.connection && navigator.connection.saveData;
  if (!saveData && webglOK()) {
    const start = () => {
      try {
        const bg = $('#hero-bg');
        window.CassieGradient.mount(bg, { still: reduce, pixelDensity: Math.min(1.25, window.devicePixelRatio || 1) }); // (gradient.js)
        setTimeout(() => bg.classList.add('live'), 300);
      } catch (e) { /* the CSS marble stays */ }
    };
    if (document.readyState === 'complete') setTimeout(start, 200); else addEventListener('load', () => setTimeout(start, 200));
  }

  /* ---------- reveal on scroll ---------- */
  if ('IntersectionObserver' in window && !reduce) {
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px' });
    $$('.rv').forEach((el, i) => { const row = el.closest('.grid6, .plans, .pair, .figs'); el.style.transitionDelay = (el.closest('.hero') ? i * 0.08 : row ? [...row.children].indexOf(el) * 0.08 : 0) + 's'; io.observe(el); }); // (cards in a row arrive one after another)
    // fail-safe: after a jump (a nav link, a fast fling) show everything at or above the screen
    let settle = 0;
    const catchUp = () => { clearTimeout(settle); settle = setTimeout(() => $$('.rv:not(.in)').forEach((el) => { if (el.getBoundingClientRect().top < innerHeight) { el.classList.add('in'); io.unobserve(el); } }), 180); };
    addEventListener('scroll', catchUp, { passive: true }); addEventListener('hashchange', catchUp); catchUp();
  } else $$('.rv').forEach((el) => el.classList.add('in'));

  /* ---------- motion that follows the scroll (after animos.app) ----------
     - the lesson page in the hero leans back, and lies flat as you scroll down to it
     - the sentence is held on screen while it comes into focus, word by word
     - each How it works card shrinks a little as the next one slides over it
     All of it is worked out once a frame, only while you scroll; with Reduce Motion nothing moves. */
  const say = $('[data-say]'), why = $('#why'), tryWin = $('.hero-try'), cards = $$('.how-card');
  const spans = [];
  if (say) {
    say.innerHTML = say.textContent.trim().split(/\s+/).map((w) => `<span>${w.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))} </span>`).join('');
    spans.push(...$$('span', say));
  }
  const clamp = (v) => Math.min(1, Math.max(0, v));
  let lit = -1, ticking = false;
  const frame = () => {
    ticking = false;
    const vh = innerHeight;
    if (tryWin) tryWin.style.setProperty('--flat', reduce ? 1 : clamp(scrollY / (vh * 0.55)).toFixed(3));
    if (why && spans.length) {
      const r = why.getBoundingClientRect();
      const p = reduce ? 1 : clamp((-r.top + vh * 0.15) / Math.max(1, r.height - vh * 1.1));
      const n = Math.round(p * spans.length);
      if (n !== lit) { lit = n; spans.forEach((sp, k) => sp.classList.toggle('lit', k < n)); }
    }
    cards.forEach((c, k) => {
      const next = cards[k + 1];
      const sink = !next || reduce ? 0 : clamp((c.getBoundingClientRect().bottom - next.getBoundingClientRect().top) / c.offsetHeight);
      c.style.setProperty('--sink', sink.toFixed(3));
    });
  };
  addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(frame); } }, { passive: true });
  addEventListener('resize', frame); frame();

  /* ---------- the subjects strip: a button stops it (and starts it again) ---------- */
  const strip = $('.strip'), pause = $('.strip-pause');
  if (strip && pause) pause.addEventListener('click', () => {
    const on = strip.classList.toggle('paused');
    pause.setAttribute('aria-pressed', String(on));
    pause.setAttribute('aria-label', on ? 'Play the moving subjects' : 'Pause the moving subjects');
  });

  /* ---------- the study tools' drawings move (planets orbit, a card lifts, a point rides the curve):
     only while on screen, and never with Reduce Motion ---------- */
  const figSvgs = $$('.fig svg');
  figSvgs.forEach((sv) => { if (reduce && sv.pauseAnimations) { sv.pauseAnimations(); sv.setCurrentTime(0); } });
  if (!reduce && 'IntersectionObserver' in window) {
    const fio = new IntersectionObserver((es) => es.forEach((e) => { if (e.target.pauseAnimations) e.target[e.isIntersecting ? 'unpauseAnimations' : 'pauseAnimations'](); }));
    figSvgs.forEach((sv) => fio.observe(sv));
  }

  /* ---------- the loops (the button's light, the subjects strip) rest while off screen ---------- */
  if ('IntersectionObserver' in window) {
    const lio = new IntersectionObserver((es) => es.forEach((e) => e.target.classList.toggle('off', !e.isIntersecting)));
    $$('.btn.beam, .subjects').forEach((el) => lio.observe(el));
  }

  /* ---------- pricing ---------- */
  const PRICES = {
    // sem = a Semester pass: one payment for 5 months (about 20% off)
    php: { sym: '₱', free: 0, plus: { month: 149, sem: 599, year: 1490 }, pro: { month: 499, sem: 1999, year: 4990 } },
    usd: { sym: 'US$', free: 0, plus: { month: 7.99, sem: 31.99, year: 79.9 }, pro: { month: 14.99, sem: 59.99, year: 149.9 } },
  };
  const tz = (Intl.DateTimeFormat().resolvedOptions().timeZone || '');
  const lang = (navigator.language || '').toLowerCase();
  let cur = tz === 'Asia/Manila' || /-ph$|^fil|^tl/.test(lang) ? 'php' : 'usd';
  let bill = 'month'; // (₱149 a month first; the semester Pasado Pass is one tap away)
  // with payments on (Cassie's server says so), the buttons buy, and a US$ price says the pesos it is charged as
  let payOn = false, payPrices = null;
  const fmt = (c, n) => {
    const p = PRICES[c];
    if (c === 'php') return p.sym + Math.round(n).toLocaleString('en-PH');
    return p.sym + (Number.isInteger(n) ? n : n.toFixed(2));
  };
  // about how much a day: 5 months is about 152 days
  const perDay = (c, n) => (c === 'php' ? PRICES[c].sym + Math.max(1, Math.round(n / 152)) : PRICES[c].sym + (n / 152).toFixed(2));
  const UNDER = {
    sem: 'One payment for 5 months. Never renews. 7 days to change your mind.',
    month: 'One payment for 30 days. Never renews: buy again when you need it. 7 days to change your mind.',
    year: 'One payment for 12 months. Never renews. 7 days to change your mind.',
  };
  function renderPrices() {
    const p = PRICES[cur];
    $('[data-price="free"]').textContent = fmt(cur, 0);
    ['plus', 'pro'].forEach((k) => {
      const v = p[k][bill];
      $(`[data-price="${k}"]`).textContent = fmt(cur, v);
      const per = $(`[data-price="${k}"]`).nextElementSibling; per.textContent = { month: '/ month', sem: '/ semester', year: '/ year' }[bill];
      $(`[data-bill-note="${k}"]`).textContent = bill === 'month' ? `about ${cur === 'php' ? PRICES[cur].sym + Math.max(1, Math.round(v / 30)) : PRICES[cur].sym + (v / 30).toFixed(2)} a day · no subscription`
        : bill === 'sem' ? `about ${perDay(cur, v)} a day` : `that’s ${fmt(cur, v / 12)} a month · one payment`;
      const under = $(`[data-under="${k}"]`); if (under) under.textContent = UNDER[bill];
    });
    const pass = $('[data-pass]'); if (pass) pass.hidden = bill !== 'sem'; // (the Semester pass is the Pasado Pass)
    const anchor = $('[data-anchor]');
    const days = { month: 30, sem: 152, year: 365 }[bill], v = p.plus[bill];
    const daily = cur === 'php' ? PRICES[cur].sym + Math.max(1, Math.round(v / days)) : PRICES[cur].sym + (v / days).toFixed(2);
    if (anchor) anchor.textContent = `${fmt(cur, v)} ${{ month: 'a month', sem: 'for the whole semester', year: 'a year' }[bill]}: about ${daily} a day${cur === 'php' ? ', less than one hour with a tutor' : ''}.`;
    const early = payOn ? '' : ' early';
    const go = $('[data-plan="plus"]'); if (go) go.textContent = (bill === 'sem' ? 'Get the Pasado Pass' : 'Get Plus') + early; // (the Pasado Pass is the semester one)
    const goPro = $('[data-plan="pro"]'); if (goPro) goPro.textContent = 'Get Pro' + early;
    ['plus', 'pro'].forEach((k) => {
      const note = $(`[data-php-note="${k}"]`), pp = payPrices && payPrices.usd && payPrices.usd[k] && payPrices.usd[k][bill];
      if (!note) return;
      note.hidden = !(cur === 'usd' && pp);
      if (pp) note.textContent = `Charged as ₱${pp.php.toLocaleString('en-PH')} (PHP). Your bank converts it.`;
    });
    $$('[data-cur]').forEach((b) => b.classList.toggle('on', b.dataset.cur === cur));
    $$('[data-bill]').forEach((b) => b.classList.toggle('on', b.dataset.bill === bill));
  }
  if (SERVER) fetch(SERVER + '/config').then((r) => (r.ok ? r.json() : null)).then((c) => {
    if (!c || !c.pay) return;
    payOn = true; payPrices = c.prices || null;
    const fine = $('#pricing .fine'); if (fine) fine.textContent = 'Every plan is one payment for the time you pick, and nothing renews by itself. Pay with GCash, Maya or a card on PayMongo’s secure page; US$ prices are charged in pesos. Daily limits start again at midnight, Philippine time, and weekly ones on Monday.';
    renderPrices();
  }).catch(() => { /* the early list still works */ });
  $$('[data-cur]').forEach((b) => b.addEventListener('click', () => { cur = b.dataset.cur; renderPrices(); }));
  $$('[data-bill]').forEach((b) => b.addEventListener('click', () => { bill = b.dataset.bill; renderPrices(); }));
  renderPrices();

  const toast = (msg) => { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 3200); };
  // Get the Pasado Pass early: the button opens an email field; the server keeps the email, the plan and "site"
  $$('[data-plan]').forEach((a) => {
    const plan = a.dataset.plan, form = $(`[data-early="${plan}"]`);
    if (!form) return;
    const input = $('input', form), msg = $('.early-msg', form), go = $('button', form);
    a.addEventListener('click', (e) => {
      e.preventDefault();
      if (payOn) { location.href = `app.html?buy=${plan}-${bill}-${cur}`; return; }
      if (!SERVER) { toast('Paid plans are almost here. Everything on Free works today.'); return; }
      a.hidden = true; form.hidden = false; input.focus();
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = input.value.trim();
      if (!email) { msg.textContent = 'Type your email first.'; input.focus(); return; }
      go.disabled = true; msg.textContent = '';
      try {
        const res = await fetch(SERVER + '/early', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, plan, src: 'site' }) });
        const r = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(r.error || 'That didn’t work. Try again.');
        const done = document.createElement('p');
        done.className = 'early-done'; done.setAttribute('role', 'status');
        done.textContent = `You’re on the early list. Cassie will email ${r.email} the day it opens.`;
        form.replaceWith(done);
      } catch (err) {
        go.disabled = false;
        msg.textContent = err && err.message && !/fetch/i.test(err.message) ? err.message : 'No connection. Check your internet, then try again.';
        input.focus();
      }
    });
  });

  /* ---------- tour video ---------- */
  const modal = $('#modal'), mv = $('video', modal);
  $('#watch').addEventListener('click', () => { modal.classList.add('open'); mv.currentTime = 0; mv.play().catch(() => {}); });
  const close = () => { modal.classList.remove('open'); mv.pause(); };
  $('button', modal).addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
})();

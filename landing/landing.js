/* Cassie landing page — small, dependency-free behaviour.
 * - loads mascot3d/cassie-3d.js (the marble ShaderGradient) after first paint where
 *   WebGL works; a CSS marble shows otherwise. Cassie herself is Cursor Cassie (play.js).
 * - pricing: ₱ / $ and monthly / yearly
 * - reveal-on-scroll, feature videos that play only while visible, the tour video
 */
(function () {
  'use strict';

  // Paste a waitlist form link (Tally, Google Forms…) here when you have one.
  const WAITLIST_URL = '';

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
      const s = document.createElement('script');
      s.src = 'mascot3d/cassie-3d.js'; s.async = true;
      s.onload = () => {
        try {
          const bg = $('#hero-bg');
          window.CassieGradient.mount(bg, { still: reduce, pixelDensity: Math.min(1.25, window.devicePixelRatio || 1) });
          setTimeout(() => bg.classList.add('live'), 300);
        } catch (e) { /* the CSS marble stays */ }
      };
      document.body.appendChild(s);
    };
    if (document.readyState === 'complete') setTimeout(start, 200); else addEventListener('load', () => setTimeout(start, 200));
  }

  /* ---------- reveal on scroll ---------- */
  if ('IntersectionObserver' in window && !reduce) {
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px' });
    $$('.rv').forEach((el, i) => { el.style.transitionDelay = (el.closest('.hero') ? i * 0.08 : 0) + 's'; io.observe(el); });
    // fail-safe: after a jump (a nav link, a fast fling) show everything at or above the screen
    let settle = 0;
    const catchUp = () => { clearTimeout(settle); settle = setTimeout(() => $$('.rv:not(.in)').forEach((el) => { if (el.getBoundingClientRect().top < innerHeight) { el.classList.add('in'); io.unobserve(el); } }), 180); };
    addEventListener('scroll', catchUp, { passive: true }); addEventListener('hashchange', catchUp); catchUp();
  } else $$('.rv').forEach((el) => el.classList.add('in'));

  /* ---------- feature videos: load + play only while on screen ---------- */
  const vids = $$('video[data-src]');
  if ('IntersectionObserver' in window) {
    const vio = new IntersectionObserver((es) => es.forEach((e) => {
      const v = e.target;
      if (e.isIntersecting) {
        if (!v.src) v.src = v.dataset.src;
        if (!reduce) v.play().catch(() => {});
      } else v.pause();
    }), { threshold: 0.35 });
    vids.forEach((v) => vio.observe(v));
  } else vids.forEach((v) => { v.src = v.dataset.src; });

  /* ---------- pricing ---------- */
  const PRICES = {
    // sem = a Semester pass: one payment for 5 months (about 20% off)
    php: { sym: '₱', free: 0, plus: { month: 149, sem: 599, year: 1490 }, pro: { month: 499, sem: 1999, year: 4990 } },
    usd: { sym: '$', free: 0, plus: { month: 7.99, sem: 31.99, year: 79.9 }, pro: { month: 14.99, sem: 59.99, year: 149.9 } },
  };
  const tz = (Intl.DateTimeFormat().resolvedOptions().timeZone || '');
  const lang = (navigator.language || '').toLowerCase();
  let cur = tz === 'Asia/Manila' || /-ph$|^fil|^tl/.test(lang) ? 'php' : 'usd';
  let bill = 'month';
  const fmt = (c, n) => {
    const p = PRICES[c];
    if (c === 'php') return p.sym + Math.round(n).toLocaleString('en-PH');
    return p.sym + (Number.isInteger(n) ? n : n.toFixed(2));
  };
  function renderPrices() {
    const p = PRICES[cur];
    $('[data-price="free"]').textContent = fmt(cur, 0);
    ['plus', 'pro'].forEach((k) => {
      const v = p[k][bill];
      $(`[data-price="${k}"]`).textContent = fmt(cur, v);
      const per = $(`[data-price="${k}"]`).nextElementSibling; per.textContent = { month: '/ month', sem: '/ semester', year: '/ year' }[bill];
      $(`[data-bill-note="${k}"]`).textContent = bill === 'month' ? 'billed monthly · cancel anytime'
        : bill === 'sem' ? `5 months · that’s ${fmt(cur, v / 5)} a month · one payment` : `that’s ${fmt(cur, v / 12)} a month · billed yearly`;
    });
    $$('[data-cur]').forEach((b) => b.classList.toggle('on', b.dataset.cur === cur));
    $$('[data-bill]').forEach((b) => b.classList.toggle('on', b.dataset.bill === bill));
  }
  $$('[data-cur]').forEach((b) => b.addEventListener('click', () => { cur = b.dataset.cur; renderPrices(); }));
  $$('[data-bill]').forEach((b) => b.addEventListener('click', () => { bill = b.dataset.bill; renderPrices(); }));
  renderPrices();

  const toast = (msg) => { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 3200); };
  $$('[data-plan]').forEach((a) => {
    if (WAITLIST_URL) { a.href = WAITLIST_URL + (WAITLIST_URL.includes('?') ? '&' : '?') + 'plan=' + a.dataset.plan; a.target = '_blank'; a.rel = 'noopener'; return; }
    a.textContent = 'Coming soon';
    a.addEventListener('click', (e) => { e.preventDefault(); toast('Paid plans are almost here — everything on Free works today.'); });
  });

  /* ---------- tour video ---------- */
  const modal = $('#modal'), mv = $('video', modal);
  $('#watch').addEventListener('click', () => { modal.classList.add('open'); mv.currentTime = 0; mv.play().catch(() => {}); });
  const close = () => { modal.classList.remove('open'); mv.pause(); };
  $('button', modal).addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
})();

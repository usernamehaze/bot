// The tour's title cards. Everything moves on performance.now(), so the recorder's fake clock
// drives it frame by frame; window.__start() is called when filming begins.
(() => {
  const k = new URLSearchParams(location.search).get('k') || 'hook';
  const card = document.createElement('div');
  card.className = 'card ' + k;
  const lock = '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
  card.innerHTML = {
    hook: '<div class="big a" data-t="0.25">47 slides.</div><div class="big a" data-t="1.3">1 exam.</div><div class="big a" data-t="2.25">2<span class="colon">:</span>00 AM.</div><div class="bot a" data-t="3.0" data-bot="sleeping" style="right:110px;bottom:70px;width:200px;height:200px"></div>',
    meet: '<div class="bot a" data-t="0.05" data-bot="greeting" data-pop></div><h1 class="a" data-t="0.35">Meet <span class="s">Cassie.</span></h1><p class="a" data-t="1.25">The study buddy that shows you how.</p>',
    private: '<div class="row"><div class="big a" data-t="0.2">Free.</div><div class="big a" data-t="0.75">Private.</div><div class="big a s" data-t="1.3">Yours.</div></div><p class="a" data-t="1.8">' + lock + 'Your notes stay on your device.</p>',
    cta: '<div class="bot a" data-t="0.05" data-bot="proud" data-pop></div><div><h1 class="a" data-t="0.3">Whatever you’re studying,</h1><h1 class="a s" data-t="1.0">Cassie explains it.</h1><div class="pill a" data-t="3.2">Try it free <span>askcassie.pages.dev</span></div><small class="a" data-t="3.8">Phone · Web · Chrome</small></div>',
  }[k];
  document.body.appendChild(card);
  const bots = [...card.querySelectorAll('[data-bot]')].map((el) => window.CassieBot.create(el, { state: el.dataset.bot, glow: true }));
  const items = [...card.querySelectorAll('.a')];
  const ease = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
  const back = (x) => { x = Math.min(1, Math.max(0, x)); const c = 1.7; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };
  let t0 = null;
  window.__start = () => { t0 = performance.now(); };
  function frame() {
    const t = t0 == null ? 0 : (performance.now() - t0) / 1000;
    for (const el of items) {
      const d = (t - +el.dataset.t) / 0.55;
      el.style.opacity = String(ease(d * 1.4));
      el.style.transform = el.hasAttribute('data-pop') ? `scale(${0.6 + 0.4 * back(d)})` : `translateY(${(1 - ease(d)) * 40}px)`;
    }
    const colon = card.querySelector('.colon');
    if (colon) colon.style.opacity = t > 2.8 && Math.floor(t * 2) % 2 ? '0.2' : '1';
    if (k === 'cta' && t > 3.4 && bots[0] && !frame.waved) { frame.waved = true; bots[0].setState('wink'); }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();

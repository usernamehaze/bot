/* (v307) The first try, right after Cassie for Chrome is installed. The extension opens Wikipedia's page on
   volcanoes (a real page, where everything works) and this small card walks the student through three steps,
   each ticked off when they do it: highlight a sentence, press Ctrl twice and ask her to draw it, then tap a
   question under "Ask next". It shows only on that first visit and is gone for good once closed or finished. */
(() => {
  if (window.top !== window || !/(^|\.)wikipedia\.org$/.test(location.hostname)) return;
  if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
  const ID = 'cassie-welcome-92f1', LIVE = 'cassie-live-host-92f1';
  const STEPS = [
    ['pick', 'Highlight any sentence on this page', 'Cassie explains it right there.'],
    ['draw', 'Press Ctrl twice, then ask: draw how a volcano erupts', 'She draws it beside the page, part by part.'],
    ['next', 'Tap a question under "Ask next"', 'She answers on the same drawing.'],
  ];
  chrome.storage.local.get('firstRun', (o) => {
    const fr = o && o.firstRun;
    if (!fr || fr.done || Date.now() - (fr.at || 0) > 7 * 864e5) return; // (a week at most, then never again)
    start();
  });
  function start() {
    if (document.getElementById(ID)) return;
    const host = document.createElement('div'); host.id = ID;
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>
      :host { all: initial; }
      .w { position: fixed; left: 16px; bottom: 16px; z-index: 2147483638; width: min(320px, calc(100vw - 32px)); box-sizing: border-box; padding: 16px; border-radius: 16px;
        background: #141416; color: #f4f4f6; border: 1px solid #3a3a42; box-shadow: 0 12px 32px rgba(0,0,0,.35); font: 14px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
      .top { display: flex; align-items: center; gap: 8px; margin: 0 0 8px; }
      h2 { flex: 1; margin: 0; font-size: 16px; font-weight: 700; }
      .x { all: unset; box-sizing: border-box; width: 44px; height: 44px; margin: -12px -12px -12px 0; display: grid; place-items: center; border-radius: 12px; cursor: pointer; color: #c8c8d0; }
      .x:hover { background: #26262c; color: #fff; }
      .x:focus-visible, .done:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
      ol { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
      li { display: grid; grid-template-columns: 24px 1fr; gap: 8px; align-items: start; }
      .dot { width: 24px; height: 24px; border-radius: 50%; border: 2px solid #6a6a74; box-sizing: border-box; display: grid; place-items: center; font-size: 12px; font-weight: 700; color: #c8c8d0; }
      li.on .dot { border-color: #ffffff; color: #ffffff; }
      li.ok .dot { background: #8fe0b0; border-color: #8fe0b0; color: #141416; }
      b { display: block; font-weight: 600; }
      li:not(.on):not(.ok) b { color: #c8c8d0; }
      span.s { color: #a8a8b2; font-size: 13px; }
      .end { margin: 8px 0 0; color: #8fe0b0; font-weight: 600; }
      .done { all: unset; box-sizing: border-box; margin-top: 8px; min-height: 44px; padding: 0 16px; border-radius: 12px; background: #ffffff; color: #141416; font-weight: 700; display: inline-flex; align-items: center; cursor: pointer; }
      @media (prefers-reduced-motion: no-preference) { .w { animation: in .25s ease-out; } @keyframes in { from { opacity: 0; transform: translateY(8px); } } }
    </style>
    <div class="w" role="dialog" aria-labelledby="cw-t">
      <div class="top"><h2 id="cw-t">Try Cassie in 10 seconds</h2><button class="x" type="button" aria-label="Close">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
      <ol></ol>
      <p class="end" hidden>You are ready. Cassie works like this on any page.</p>
      <button class="done" type="button" hidden>Done</button>
    </div>`;
    const ol = root.querySelector('ol');
    const rows = STEPS.map(([k, t, s], i) => { const li = document.createElement('li'); li.dataset.k = k; li.innerHTML = `<span class="dot" aria-hidden="true">${i + 1}</span><div><b></b><span class="s"></span></div>`; li.querySelector('b').textContent = t; li.querySelector('.s').textContent = s; ol.appendChild(li); return li; });
    document.documentElement.appendChild(host);
    const done = new Set();
    const paint = () => {
      const first = STEPS.findIndex(([k]) => !done.has(k));
      rows.forEach((li, i) => { li.className = done.has(STEPS[i][0]) ? 'ok' : i === first ? 'on' : ''; li.querySelector('.dot').textContent = done.has(STEPS[i][0]) ? '✓' : String(i + 1); });
      if (first < 0) { root.querySelector('.end').hidden = false; root.querySelector('.done').hidden = false; finish(false); }
    };
    const tick = (k) => { if (done.has(k)) return; done.add(k); paint(); };
    const finish = (close) => { clearInterval(watch); chrome.storage.local.set({ firstRun: { done: true, at: Date.now() } }); if (close) host.remove(); };
    root.querySelector('.x').addEventListener('click', () => finish(true));
    root.querySelector('.done').addEventListener('click', () => finish(true));
    document.addEventListener('selectionchange', () => { const t = String(window.getSelection() || '').trim(); if (t.length > 12) tick('pick'); });
    // her drawing card on the page, and a follow-up asked on it (typed, said, or from "Ask next")
    const watch = setInterval(() => {
      const live = document.getElementById(LIVE);
      if (live) { tick('draw'); if (+(live.dataset.answered || 0) >= 1) tick('next'); }
    }, 500);
    paint();
  }
})();

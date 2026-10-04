/* Cassie's sketch board — a place for the STUDENT to draw.
 *
 * Open it blank (graph paper or plain), on top of a graph Cassie drew, on a
 * photo, or (in the extension) on a snip of the page. Pen, highlighter,
 * straight line, text, eraser, undo/redo, save as PNG, and "Check my work"
 * which hands the sketch back to Cassie.
 *
 * Self-contained (no libraries, no network) so the same file runs in the web
 * app and in the Chrome extension. The extension keeps a copy at
 * extension/sketch.js — keep the two files identical.
 *
 *   CassieSketch.open({
 *     root,        // where to mount: document.body (default) or a shadow root
 *     image,       // optional background: data URL / URL / canvas
 *     title,       // header text
 *     note,        // optional { headline, steps[] } shown above the board
 *     dock,        // 'full' (default) or 'side' (docked right, page stays visible)
 *     onCheck,     // optional async (pngDataUrl) => string|void   ("Check my work")
 *     checkLabel,  // label for that button
 *   })
 */
(function () {
  'use strict';
  if (window.CassieSketch) return;

  const CSS = `
  .csk-wrap { position: fixed; inset: 0; z-index: 2147483600; display: flex; align-items: center; justify-content: center;
    background: rgba(12,12,14,.46); font: 14px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #1b1b1d; }
  .csk-wrap.side { inset: 0 0 0 auto; width: min(560px, 100vw); background: none; pointer-events: none; }
  .csk-panel { pointer-events: auto; background: #f6f5f2; width: min(1180px, 100vw); height: min(860px, 100vh); display: flex; flex-direction: column;
    border-radius: 16px; overflow: hidden; box-shadow: 0 20px 60px rgba(0,0,0,.35); }
  .csk-wrap.side .csk-panel { width: 100%; height: 100%; border-radius: 16px 0 0 16px; box-shadow: -10px 0 40px rgba(0,0,0,.28); }
  @media (max-width: 700px) { .csk-panel { width: 100vw; height: 100%; border-radius: 0; } .csk-wrap.side .csk-panel { border-radius: 0; } }
  .csk-dark .csk-panel { background: #1d1d20; color: #ececec; }
  .csk-head { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid rgba(127,127,127,.25); }
  .csk-title { font-weight: 700; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .csk-btn { appearance: none; border: 1px solid rgba(127,127,127,.35); background: transparent; color: inherit; border-radius: 10px;
    height: 34px; min-width: 34px; padding: 0 9px; display: inline-flex; align-items: center; justify-content: center; gap: 5px;
    cursor: pointer; font: 600 12.5px/1 inherit; font-family: inherit; }
  .csk-btn:hover { background: rgba(127,127,127,.12); }
  .csk-btn.on { background: #1b1b1d; color: #fff; border-color: #1b1b1d; }
  .csk-dark .csk-btn.on { background: #ececec; color: #1b1b1d; border-color: #ececec; }
  .csk-btn.primary { background: #1b1b1d; color: #fff; border-color: #1b1b1d; }
  .csk-dark .csk-btn.primary { background: #ececec; color: #1b1b1d; }
  .csk-btn svg { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  .csk-btn:disabled { opacity: .45; cursor: default; }
  .csk-tools { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 8px 12px; border-bottom: 1px solid rgba(127,127,127,.2); }
  .csk-sep { width: 1px; height: 22px; background: rgba(127,127,127,.3); margin: 0 2px; }
  .csk-sw { width: 22px; height: 22px; border-radius: 50%; border: 2px solid rgba(127,127,127,.35); cursor: pointer; padding: 0; }
  .csk-sw.on { outline: 2px solid currentColor; outline-offset: 2px; }
  .csk-size { width: 30px; height: 30px; border-radius: 8px; border: 1px solid rgba(127,127,127,.3); background: none; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; color: inherit; }
  .csk-size i { display: block; border-radius: 50%; background: currentColor; }
  .csk-size.on { background: rgba(127,127,127,.18); }
  .csk-note { padding: 8px 14px; border-bottom: 1px solid rgba(127,127,127,.2); max-height: 26%; overflow: auto; font-size: 13px; }
  .csk-note b { display: block; margin-bottom: 4px; }
  .csk-note ol { margin: 0; padding-left: 20px; }
  .csk-note .csk-reply { white-space: pre-wrap; }
  .csk-note[hidden] { display: none; }
  .csk-stage { position: relative; flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; padding: 10px; touch-action: none; }
  .csk-board { position: relative; box-shadow: 0 1px 6px rgba(0,0,0,.18); background: #fff; }
  .csk-board canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
  .csk-board canvas.csk-live { cursor: crosshair; touch-action: none; }
  .csk-text { position: absolute; z-index: 3; min-width: 60px; border: 1px dashed rgba(127,127,127,.7); background: rgba(255,255,255,.85);
    padding: 2px 4px; font-family: system-ui, sans-serif; outline: none; }
  .csk-ask { display: flex; gap: 6px; padding: 7px 12px; border-bottom: 1px solid rgba(127,127,127,.2); }
  .csk-ask input { flex: 1; min-width: 0; height: 34px; box-sizing: border-box; border: 1px solid rgba(127,127,127,.4); border-radius: 10px; background: transparent; color: inherit; padding: 0 11px; font: 13px system-ui, sans-serif; }
  .csk-hint { font-size: 11.5px; opacity: .65; padding: 0 12px 8px; }
  .csk-hidden { display: none !important; }
  /* Phones: keep the header below the status bar / notch (clock, signal, battery)
     and the board above the home indicator, so × and every tool can be tapped. */
  @media (max-width: 700px), (max-height: 500px) {
    .csk-head { padding-top: max(10px, calc(env(safe-area-inset-top, 0px) + 6px)); padding-left: max(12px, env(safe-area-inset-left, 0px)); padding-right: max(12px, env(safe-area-inset-right, 0px)); }
    .csk-stage { padding-bottom: max(10px, env(safe-area-inset-bottom, 0px)); }
    .csk-tools { gap: 5px; padding: 6px 10px; }
    .csk-btn { height: 36px; min-width: 36px; }
    .csk-title { font-size: 15px; }
  }
  `;

  const ICON = {
    pen: '<path d="M4 20l4-1 11-11-3-3L5 16z"/><path d="M14 6l3 3"/>',
    hl: '<path d="M9 15l-4 5h6l2-3"/><path d="M8 14l7-9 4 3-7 9z"/>',
    line: '<path d="M5 19L19 5"/><circle cx="5" cy="19" r="1.6"/><circle cx="19" cy="5" r="1.6"/>',
    text: '<path d="M5 6V4h14v2"/><path d="M12 4v16"/><path d="M9 20h6"/>',
    eraser: '<path d="M7 20h11"/><path d="M4 15l9-10 7 7-8 8H8z"/><path d="M9 10l6 6"/>',
    undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
    redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>',
    trash: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/>',
    grid: '<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M4 10h16M4 15h16M10 4v16M15 4v16"/>',
    image: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-8 8"/>',
    save: '<path d="M12 4v11"/><path d="M7 10l5 5 5-5"/><path d="M5 20h14"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    side: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M14 4v16"/>',
    full: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
  };
  const svg = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[k]}</svg>`;
  const INKS = ['#1b1b1d', '#ffffff', '#d93a3a', '#2f6fd6', '#2e9e5b', '#f2c200'];
  const SIZES = [3, 6, 12];

  let current = null;

  function loadImage(src) {
    return new Promise((resolve) => {
      if (!src) return resolve(null);
      if (src instanceof HTMLCanvasElement) return resolve(src);
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  async function open(opts = {}) {
    if (current) current.close();
    const root = opts.root || document.body;
    const dark = opts.dark != null ? opts.dark : (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches && !opts.image);
    if (!root.querySelector || !root.querySelector('style[data-csk]')) {
      const st = document.createElement('style'); st.setAttribute('data-csk', '1'); st.textContent = CSS;
      root.appendChild(st);
    }
    const wrap = document.createElement('div');
    wrap.className = 'csk-wrap' + (opts.dock === 'side' ? ' side' : '') + (dark ? ' csk-dark' : '');
    wrap.innerHTML = `
      <div class="csk-panel" role="dialog" aria-label="Sketch board">
        <div class="csk-head">
          <span class="csk-title"></span>
          ${(opts.extra || []).map((b, i) => `<button class="csk-btn" data-extra="${i}" title="${b.title || ''}">${b.label}</button>`).join('')}
          ${opts.onCheck ? `<button class="csk-btn primary" data-act="check" title="Send your sketch to Cassie">${svg('check')}<span>${opts.checkLabel || 'Check my work'}</span></button>` : ''}
          <button class="csk-btn" data-act="save" title="Save as picture">${svg('save')}</button>
          ${opts.allowDock ? `<button class="csk-btn" data-act="dock" title="Dock to the side / full screen">${svg(opts.dock === 'side' ? 'full' : 'side')}</button>` : ''}
          <button class="csk-btn" data-act="close" title="Close board" aria-label="Close">${svg('close')}</button>
        </div>
        <div class="csk-note" hidden></div>
        <div class="csk-tools">
          <button class="csk-btn on" data-tool="pen" title="Pen">${svg('pen')}</button>
          <button class="csk-btn" data-tool="hl" title="Highlighter">${svg('hl')}</button>
          <button class="csk-btn" data-tool="line" title="Straight line">${svg('line')}</button>
          <button class="csk-btn" data-tool="text" title="Type text">${svg('text')}</button>
          <button class="csk-btn" data-tool="eraser" title="Eraser">${svg('eraser')}</button>
          <span class="csk-sep"></span>
          <span class="csk-inks"></span>
          <span class="csk-sep"></span>
          <span class="csk-sizes"></span>
          <span class="csk-sep"></span>
          <button class="csk-btn" data-act="undo" title="Undo">${svg('undo')}</button>
          <button class="csk-btn" data-act="redo" title="Redo">${svg('redo')}</button>
          <button class="csk-btn" data-act="clear" title="Clear your drawing">${svg('trash')}</button>
          <button class="csk-btn" data-act="grid" title="Graph paper">${svg('grid')}</button>
          <button class="csk-btn" data-act="pic" title="Draw on a picture — or paste one with Ctrl+V">${svg('image')}</button>
          <input type="file" accept="image/*" class="csk-hidden">
        </div>
        ${opts.onAsk ? `<form class="csk-ask"><input type="text" placeholder="${opts.askPlaceholder || 'Ask Cassie about this…'}" aria-label="Ask Cassie"><button class="csk-btn primary" type="submit">Ask</button></form>` : ''}
        <div class="csk-stage"><div class="csk-board">
          <canvas class="csk-bg"></canvas><canvas class="csk-ink"></canvas><canvas class="csk-live"></canvas>
        </div></div>
      </div>`;
    root.appendChild(wrap);
    const $ = (s) => wrap.querySelector(s);
    $('.csk-title').textContent = opts.title || 'Board';
    const stage = $('.csk-stage'), boardEl = $('.csk-board');
    const bg = $('.csk-bg'), ink = $('.csk-ink'), live = $('.csk-live');
    const note = $('.csk-note');

    // ---- state ----
    let W = 1600, H = 1000;
    let bgImage = await loadImage(opts.image);
    let grid = !bgImage && opts.grid !== false;
    const paper = dark ? '#1d1d20' : '#ffffff';
    let tool = 'pen', color = dark ? '#ffffff' : '#1b1b1d', size = SIZES[0];
    const strokes = [], redo = [];
    let drawing = null;

    function setSize() {
      if (bgImage) {
        const iw = bgImage.naturalWidth || bgImage.width, ih = bgImage.naturalHeight || bgImage.height;
        const s = Math.min(1, 1800 / Math.max(iw, ih));
        W = Math.max(200, Math.round(iw * s)); H = Math.max(150, Math.round(ih * s));
      } else {
        // a blank page takes the shape of the space it's in (tall on a phone)
        const r = stage.getBoundingClientRect();
        W = 1600; H = Math.round(Math.min(2800, Math.max(700, 1600 * ((r.height - 20) / Math.max(1, r.width - 20)))));
      }
      [bg, ink, live].forEach((c) => { c.width = W; c.height = H; });
      fit();
    }
    function fit() {
      const r = stage.getBoundingClientRect();
      const aw = Math.max(50, r.width - 20), ah = Math.max(50, r.height - 20);
      const s = Math.min(aw / W, ah / H);
      boardEl.style.width = Math.round(W * s) + 'px';
      boardEl.style.height = Math.round(H * s) + 'px';
    }
    function drawBg() {
      const x = bg.getContext('2d');
      x.fillStyle = paper; x.fillRect(0, 0, W, H);
      if (bgImage) x.drawImage(bgImage, 0, 0, W, H);
      if (grid) {
        const step = Math.round(Math.min(W, H) / 20);
        x.strokeStyle = dark ? 'rgba(255,255,255,.09)' : 'rgba(0,0,0,.08)'; x.lineWidth = 1;
        for (let gx = 0; gx <= W; gx += step) { x.beginPath(); x.moveTo(gx + .5, 0); x.lineTo(gx + .5, H); x.stroke(); }
        for (let gy = 0; gy <= H; gy += step) { x.beginPath(); x.moveTo(0, gy + .5); x.lineTo(W, gy + .5); x.stroke(); }
      }
      $('[data-act="grid"]').classList.toggle('on', grid);
    }
    function paint(ctx, s) {
      ctx.save();
      if (s.tool === 'text') {
        ctx.fillStyle = s.color; ctx.font = `600 ${s.size}px system-ui, sans-serif`; ctx.textBaseline = 'top';
        s.text.split('\n').forEach((ln, i) => ctx.fillText(ln, s.x, s.y + i * s.size * 1.25));
        ctx.restore(); return;
      }
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.globalCompositeOperation = s.tool === 'eraser' ? 'destination-out' : 'source-over';
      ctx.strokeStyle = s.tool === 'eraser' ? '#000' : s.color;
      ctx.globalAlpha = s.tool === 'hl' ? 0.35 : 1;
      ctx.lineWidth = s.tool === 'hl' ? s.size * 4 : s.tool === 'eraser' ? s.size * 4 : s.size;
      const p = s.points;
      ctx.beginPath();
      ctx.moveTo(p[0][0], p[0][1]);
      if (p.length === 1) ctx.lineTo(p[0][0] + .01, p[0][1]);
      else if (s.tool === 'line') ctx.lineTo(p[p.length - 1][0], p[p.length - 1][1]);
      else {
        for (let i = 1; i < p.length - 1; i++) {
          const mx = (p[i][0] + p[i + 1][0]) / 2, my = (p[i][1] + p[i + 1][1]) / 2;
          ctx.quadraticCurveTo(p[i][0], p[i][1], mx, my);
        }
        ctx.lineTo(p[p.length - 1][0], p[p.length - 1][1]);
      }
      ctx.stroke();
      ctx.restore();
    }
    function redraw() {
      const x = ink.getContext('2d');
      x.clearRect(0, 0, W, H);
      strokes.forEach((s) => paint(x, s));
      $('[data-act="undo"]').disabled = !strokes.length;
      $('[data-act="redo"]').disabled = !redo.length;
    }
    function toBoard(e) {
      const r = live.getBoundingClientRect();
      return [(e.clientX - r.left) * (W / r.width), (e.clientY - r.top) * (H / r.height)];
    }
    // scale tool sizes with the board so a "thin pen" looks thin on screen
    const scaleK = () => W / Math.max(1, live.getBoundingClientRect().width);

    live.addEventListener('pointerdown', (e) => {
      if (e.button > 0) return;
      e.preventDefault();
      if (tool === 'text') return; // placed on click (below) so the new box keeps focus
      const pt = toBoard(e);
      live.setPointerCapture(e.pointerId);
      drawing = { tool, color, size: size * scaleK(), points: [pt] };
      redo.length = 0;
      if (tool === 'eraser') { strokes.push(drawing); redraw(); }
    });
    live.addEventListener('pointermove', (e) => {
      if (!drawing) return;
      const pts = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      pts.forEach((pe) => drawing.points.push(toBoard(pe)));
      if (drawing.tool === 'eraser') { redraw(); return; }
      const x = live.getContext('2d');
      x.clearRect(0, 0, W, H);
      paint(x, drawing);
    });
    const end = () => {
      if (!drawing) return;
      if (drawing.tool !== 'eraser') strokes.push(drawing);
      drawing = null;
      live.getContext('2d').clearRect(0, 0, W, H);
      redraw();
    };
    live.addEventListener('pointerup', end);
    live.addEventListener('click', (e) => { if (tool === 'text') placeText(e, toBoard(e)); });
    live.addEventListener('pointercancel', end);

    function placeText(e, pt) {
      const r = live.getBoundingClientRect(), br = boardEl.getBoundingClientRect();
      const px = size * 6; // on-screen font size
      const ta = document.createElement('div');
      ta.className = 'csk-text'; ta.contentEditable = 'true';
      ta.style.left = (e.clientX - br.left) + 'px'; ta.style.top = (e.clientY - br.top) + 'px';
      ta.style.color = color === '#ffffff' && !dark ? '#1b1b1d' : color;
      ta.style.fontSize = px + 'px';
      boardEl.appendChild(ta);
      ta.focus();
      const commit = () => {
        const text = ta.innerText.replace(/\n+$/, '');
        ta.remove();
        if (!text.trim()) return;
        strokes.push({ tool: 'text', color, size: px * (W / r.width), x: pt[0], y: pt[1], text });
        redo.length = 0; redraw();
      };
      ta.addEventListener('blur', commit, { once: true });
      ta.addEventListener('keydown', (k) => {
        k.stopPropagation();
        if (k.key === 'Enter' && !k.shiftKey) { k.preventDefault(); ta.blur(); }
        if (k.key === 'Escape') { ta.innerText = ''; ta.blur(); }
      });
    }

    // ---- toolbar ----
    const inksEl = $('.csk-inks');
    INKS.forEach((c) => {
      const b = document.createElement('button');
      b.className = 'csk-sw'; b.title = 'Ink colour'; b.style.background = c; b.dataset.ink = c;
      inksEl.appendChild(b);
    });
    inksEl.style.display = 'inline-flex'; inksEl.style.gap = '6px';
    const sizesEl = $('.csk-sizes');
    SIZES.forEach((s, i) => {
      const b = document.createElement('button');
      b.className = 'csk-size' + (i === 0 ? ' on' : ''); b.title = ['Thin', 'Medium', 'Thick'][i]; b.dataset.size = s;
      b.innerHTML = `<i style="width:${4 + i * 4}px;height:${4 + i * 4}px"></i>`;
      sizesEl.appendChild(b);
    });
    sizesEl.style.display = 'inline-flex'; sizesEl.style.gap = '4px';
    const syncInk = () => inksEl.querySelectorAll('.csk-sw').forEach((b) => b.classList.toggle('on', b.dataset.ink === color));
    syncInk();

    wrap.addEventListener('click', async (e) => {
      const t = e.target.closest('button');
      if (!t || !wrap.contains(t)) return;
      if (t.dataset.extra != null) { const b = (opts.extra || [])[+t.dataset.extra]; if (b && b.onClick) b.onClick(); return; }
      if (t.dataset.tool) {
        tool = t.dataset.tool;
        wrap.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('on', b === t));
        live.style.cursor = tool === 'text' ? 'text' : 'crosshair';
        if (tool === 'hl' && (color === '#1b1b1d' || color === '#ffffff')) { color = '#f2c200'; syncInk(); }
        return;
      }
      if (t.dataset.ink) { color = t.dataset.ink; syncInk(); if (tool === 'eraser') $('[data-tool="pen"]').click(); return; }
      if (t.dataset.size) { size = +t.dataset.size; sizesEl.querySelectorAll('.csk-size').forEach((b) => b.classList.toggle('on', b === t)); return; }
      const act = t.dataset.act;
      if (act === 'close') close();
      else if (act === 'undo') { if (strokes.length) { redo.push(strokes.pop()); redraw(); } }
      else if (act === 'redo') { if (redo.length) { strokes.push(redo.pop()); redraw(); } }
      else if (act === 'clear') { if (strokes.length && confirm('Clear everything you drew?')) { strokes.length = 0; redo.length = 0; redraw(); } }
      else if (act === 'grid') { grid = !grid; drawBg(); }
      else if (act === 'pic') $('input[type=file]').click();
      else if (act === 'save') {
        const a = document.createElement('a');
        a.href = snapshot(); a.download = 'cassie-board.png';
        (document.body || document.documentElement).appendChild(a); a.click(); a.remove();
      } else if (act === 'dock') {
        const side = !wrap.classList.contains('side');
        wrap.classList.toggle('side', side);
        t.innerHTML = svg(side ? 'full' : 'side');
        setTimeout(fit, 30);
      } else if (act === 'check' && opts.onCheck) {
        const label = t.querySelector('span'); const was = label.textContent;
        t.disabled = true; label.textContent = 'Cassie is looking…';
        try {
          const reply = await opts.onCheck(snapshot(), parts());
          if (reply) showNote({ reply });
        } catch (err) {
          showNote({ reply: (err && err.message) || 'Couldn’t reach Cassie — try again.' });
        } finally { t.disabled = false; label.textContent = was; }
      }
    });
    // Put a picture on the board: from the picture button, a paste (Ctrl+V — e.g. after
    // Win+Shift+S / Cmd+Shift+4), or a drag-and-drop.
    async function useImageSource(url, { ask = true } = {}) {
      const img = await loadImage(url);
      if (!img) return false;
      if (ask && strokes.length && !confirm('Start over on this picture? Your current drawing will be cleared.')) return false;
      bgImage = img; grid = false; strokes.length = 0; redo.length = 0;
      setSize(); drawBg(); redraw();
      if (opts.onImage) { try { opts.onImage(typeof url === 'string' ? url : null, img); } catch (e) { /* ignore */ } }
      return true;
    }
    const fileToUrl = (f) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => res(null); r.readAsDataURL(f); });
    $('input[type=file]').addEventListener('change', async (e) => {
      const f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (f) useImageSource(await fileToUrl(f));
    });
    function onPaste(e) {
      if (e.target && (e.target.isContentEditable || /^(INPUT|TEXTAREA)$/.test(e.target.tagName || ''))) return;
      const items = (e.clipboardData && e.clipboardData.items) || [];
      for (const it of items) {
        if (it.kind === 'file' && /^image\//.test(it.type)) {
          const f = it.getAsFile();
          if (f) { e.preventDefault(); fileToUrl(f).then((u) => u && useImageSource(u, { ask: false })); return; }
        }
      }
    }
    document.addEventListener('paste', onPaste, true);
    wrap.addEventListener('dragover', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
    wrap.addEventListener('drop', (e) => {
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f && /^image\//.test(f.type)) { e.preventDefault(); fileToUrl(f).then((u) => u && useImageSource(u)); }
    });

    function showNote(n) {
      if (!n) { note.hidden = true; return; }
      note.hidden = false;
      note.innerHTML = '';
      if (n.headline) { const b = document.createElement('b'); b.textContent = n.headline; note.appendChild(b); }
      if (n.steps && n.steps.length) {
        const ol = document.createElement('ol');
        n.steps.forEach((s) => { const li = document.createElement('li'); li.textContent = s; ol.appendChild(li); });
        note.appendChild(ol);
      }
      if (n.reply) { const p = document.createElement('div'); p.className = 'csk-reply'; p.textContent = n.reply; note.appendChild(p); }
    }
    const askForm = $('.csk-ask');
    if (askForm) {
      askForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const input = askForm.querySelector('input'), btn = askForm.querySelector('button');
        const q = input.value.trim();
        if (!q || btn.disabled) return;
        btn.disabled = true; btn.textContent = '…';
        showNote({ reply: 'Cassie is thinking…' });
        try { const reply = await opts.onAsk(snapshot(), q, parts()); showNote({ reply: reply || '(no reply)' }); input.value = ''; }
        catch (err) { showNote({ reply: (err && err.message) || 'Couldn’t reach Cassie — try again.' }); }
        finally { btn.disabled = false; btn.textContent = 'Ask'; }
      });
      askForm.addEventListener('keydown', (e) => e.stopPropagation());
    }
    function setTitle(t) { $('.csk-title').textContent = t || 'Board'; }
    // The board as plain data (original picture + strokes). Reading pixels back from
    // a page canvas comes out blank on some machines' graphics drivers, so callers
    // that can (the extension) rebuild the picture from this instead.
    function parts() {
      const src = bgImage && bgImage.src && /^data:image\//.test(bgImage.src) ? bgImage.src : null;
      return { image: src, strokes: strokes.map((s) => ({ ...s, points: s.points ? s.points.map((p) => [p[0], p[1]]) : undefined })), w: W, h: H, paper };
    }
    function snapshot() {
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const x = c.getContext('2d');
      x.drawImage(bg, 0, 0); x.drawImage(ink, 0, 0);
      return c.toDataURL('image/png');
    }
    function onKey(e) {
      if (e.target && e.target.isContentEditable) return;
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); $(e.shiftKey ? '[data-act="redo"]' : '[data-act="undo"]').click(); }
    }
    function close() {
      window.removeEventListener('resize', fit);
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('paste', onPaste, true);
      wrap.remove();
      if (current && current.wrap === wrap) current = null;
      if (opts.onClose) opts.onClose();
    }
    // click on the dim backdrop (full mode) closes only if nothing was drawn
    wrap.addEventListener('pointerdown', (e) => { if (e.target === wrap && !strokes.length) close(); });

    window.addEventListener('resize', fit);
    document.addEventListener('keydown', onKey, true);
    setSize(); drawBg(); redraw();
    // On a dark picture (e.g. a dark-mode graph), start with white ink so it shows.
    if (bgImage) {
      try {
        const t = document.createElement('canvas'); t.width = 24; t.height = 24;
        const tx = t.getContext('2d'); tx.drawImage(bg, 0, 0, 24, 24);
        const d = tx.getImageData(0, 0, 24, 24).data;
        let lum = 0; for (let i = 0; i < d.length; i += 4) lum += (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
        color = lum / (d.length / 4) < 0.45 ? '#ffffff' : '#1b1b1d';
        syncInk();
      } catch (e) { /* cross-origin picture — keep the default */ }
    }
    if (opts.note) showNote(opts.note);
    requestAnimationFrame(fit);
    current = { wrap, close, snapshot, showNote, setTitle, setImage: (u) => useImageSource(u, { ask: false }) };
    return current;
  }

  window.CassieSketch = { open, isOpen: () => !!current, close: () => current && current.close() };
})();

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
 *     onAsk,       // optional async (png, question, parts) => string | { reply, draw }
 *                  //   draw = a board spec ({type:'graph', fn, xrange…} / shape / steps):
 *                  //   Cassie draws it ON the board, as one stroke the student can undo or erase
 *   })
 *   The returned session also has draw(spec) — Cassie draws on the board directly.
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
  .csk-room { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; padding: 8px 14px; border-bottom: 1px solid rgba(127,127,127,.2); font-size: 13px; }
  .csk-room[hidden] { display: none; }
  .csk-room b { font-size: 15px; letter-spacing: .12em; }
  .csk-room .csk-btn { padding: 5px 10px; }
  .csk-room .csk-who { display: flex; flex-wrap: wrap; gap: 4px; margin-left: auto; }
  .csk-room .csk-who span { padding: 3px 9px; border-radius: 99px; background: rgba(127,127,127,.14); font-size: 12px; }
  .csk-note { padding: 8px 14px; border-bottom: 1px solid rgba(127,127,127,.2); max-height: 26%; overflow: auto; font-size: 13px; }
  .csk-note b { display: block; margin-bottom: 4px; }
  .csk-note ol { margin: 0; padding-left: 20px; }
  .csk-note .csk-reply p { margin: 0 0 6px; }
  .csk-note .csk-reply ul, .csk-note .csk-reply ol { margin: 0 0 6px; padding-left: 20px; }
  .csk-note .csk-reply li { margin: 2px 0; }
  .csk-note strong { font-weight: 700; }
  .csk-note code { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: .92em; }
  .csk-note[hidden] { display: none; }
  .csk-panel > :not(.csk-stage) { flex-shrink: 0; } /* (the bars above keep their size; only the drawing area gives way when the board is short) */
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
  .csk-panel { position: relative; }
  .csk-board canvas.csk-fx { pointer-events: none; }
  .csk-board canvas.csk-live.grab { cursor: grab; }
  .csk-board canvas.csk-live.place { cursor: copy; }
  .csk-pop { position: absolute; z-index: 6; left: 12px; right: 12px; margin: 0 auto; max-width: 380px; max-height: 70%; overflow: auto; box-sizing: border-box;
    background: #fbfaf8; color: #1b1b1d; border: 1px solid rgba(127,127,127,.3); border-radius: 14px; padding: 12px; box-shadow: 0 12px 40px rgba(0,0,0,.25); }
  .csk-dark .csk-pop { background: #26262a; color: #ececec; }
  .csk-pop h4 { margin: 0 0 8px; font-size: 14px; }
  .csk-pop p { margin: 6px 0; font-size: 12.5px; opacity: .75; }
  .csk-pop textarea, .csk-pop input { width: 100%; box-sizing: border-box; border: 1px solid rgba(127,127,127,.4); border-radius: 10px; background: transparent; color: inherit; padding: 8px 10px; font: 13px system-ui, sans-serif; }
  .csk-pop textarea { min-height: 96px; resize: vertical; }
  .csk-pop .csk-row { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; align-items: center; }
  .csk-pop .csk-row input { flex: 1; min-width: 120px; height: 34px; }
  .csk-pop .csk-list { display: grid; gap: 6px; margin-top: 8px; }
  .csk-pop .csk-list .csk-btn { justify-content: flex-start; height: auto; min-height: 36px; padding: 7px 10px; text-align: left; }
  .csk-pop .csk-or { text-align: center; font-size: 12px; opacity: .55; margin: 10px 0 2px; }
  .csk-nc { width: 30px; height: 30px; border-radius: 8px; border: 1px solid rgba(0,0,0,.18); cursor: pointer; padding: 0; }
  .csk-nc.on { outline: 2px solid currentColor; outline-offset: 2px; }
  .csk-cur { position: absolute; z-index: 4; left: 0; top: 0; pointer-events: none; transition: left .09s linear, top .09s linear; }
  .csk-cur svg { width: 18px; height: 18px; display: block; filter: drop-shadow(0 1px 1px rgba(0,0,0,.35)); }
  .csk-cur span { position: absolute; left: 14px; top: 15px; white-space: nowrap; color: #fff; font: 600 11.5px/1 system-ui, sans-serif; padding: 4px 7px; border-radius: 99px; box-shadow: 0 1px 3px rgba(0,0,0,.25); }
  .csk-cur[hidden] { display: none; }
  .csk-notebox { position: absolute; z-index: 5; box-sizing: border-box; padding: 10px; outline: 2px solid rgba(27,27,29,.6); border-radius: 4px; color: #2a2414;
    font: 600 16px/1.25 system-ui, sans-serif; overflow: auto; white-space: pre-wrap; }
  .csk-toast { position: absolute; z-index: 6; left: 50%; bottom: 18px; transform: translateX(-50%); background: rgba(27,27,29,.9); color: #fff; padding: 8px 14px; border-radius: 99px;
    font-size: 13px; pointer-events: none; transition: opacity .3s; white-space: nowrap; max-width: 90%; overflow: hidden; text-overflow: ellipsis; }
  /* Touch screens: every tool is 44px to touch; colour and size dots sit inside 44px buttons. */
  @media (pointer: coarse) {
    .csk-tools, .csk-head, .csk-ask { gap: 4px !important; }
    .csk-btn { height: 44px !important; min-width: 44px !important; }
    .csk-sw { width: 44px; height: 44px; padding: 11px; border: 0; background-clip: content-box; box-shadow: inset 0 0 0 9px #f6f5f2, inset 0 0 0 11px rgba(127,127,127,.35); }
    .csk-dark .csk-sw { box-shadow: inset 0 0 0 9px #1d1d20, inset 0 0 0 11px rgba(127,127,127,.35); }
    .csk-sw.on { outline: none; box-shadow: inset 0 0 0 7px #f6f5f2, inset 0 0 0 9px currentColor; padding: 9px; }
    .csk-dark .csk-sw.on { box-shadow: inset 0 0 0 7px #1d1d20, inset 0 0 0 9px currentColor; }
    .csk-size { width: 44px; height: 44px; }
    .csk-ask input { min-height: 44px; }
    .csk-ask .csk-btn { height: 44px; }
  }
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
    select: '<path d="M6 3l12 9-5.5 1L10 19z"/>',
    pen: '<path d="M4 20l4-1 11-11-3-3L5 16z"/><path d="M14 6l3 3"/>',
    laser: '<circle cx="7" cy="17" r="3"/><path d="M9.5 14.5L19 5"/><path d="M14 3.5l.8 2.2M20.5 10l-2.2-.8M18.5 3.5l-1 1.6"/>',
    note: '<path d="M5 4h14v10l-5 6H5z"/><path d="M19 14h-5v6"/>',
    cards: '<rect x="3" y="8" width="14" height="11" rx="1.5"/><path d="M7 8V5h14v11h-4"/>',
    shapes: '<circle cx="7.5" cy="7.5" r="4"/><path d="M13.5 20l4-7 4 7z"/><rect x="3" y="14" width="6.5" height="6.5"/>',
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
  // sticky-note paper, and a colour for each person's pointer in a room
  const NOTE_COLORS = [['#fff1a6', 'Yellow'], ['#ffc9de', 'Pink'], ['#c8f0c4', 'Green'], ['#c4e0ff', 'Blue'], ['#ffd6a5', 'Orange'], ['#ddd2ff', 'Purple']];
  const PEOPLE = ['#e5484d', '#2f6fd6', '#2e9e5b', '#d9822b', '#8e4ec6', '#0e9fa8', '#d6409f', '#6b7a00'];
  const ACTS = { drawing: 'drawing', erasing: 'erasing', typing: 'typing', pointing: 'pointing', moving: 'moving' };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // Whatever arrives from a classmate or a board file is checked before it's drawn: only known
  // kinds of stroke, only numbers where numbers go, text cut to size.
  const TOOLS = new Set(['pen', 'hl', 'line', 'eraser', 'text', 'rect', 'group', 'note', 'card']);
  const num = (v, d = 0) => (typeof v === 'number' && isFinite(v) ? v : d);
  const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
  function cleanStroke(s, depth = 0) {
    if (!s || typeof s !== 'object' || !TOOLS.has(s.tool)) return null;
    const c = { tool: s.tool };
    if (typeof s.id === 'string') c.id = s.id.slice(0, 40);
    if (typeof s.u === 'string') c.u = s.u.slice(0, 64);
    if (s.by) c.by = str(s.by, 20);
    if (typeof s.color === 'string') c.color = s.color.slice(0, 60);
    if (s.size != null) c.size = clamp(num(s.size, 3), 0.5, 400);
    const box = () => { c.x = num(s.x); c.y = num(s.y); c.w = clamp(num(s.w, 220), 20, 4000); c.h = clamp(num(s.h, 190), 20, 4000); };
    if (s.tool === 'group') {
      if (depth > 1 || !Array.isArray(s.items)) return null;
      c.items = s.items.slice(0, 3000).map((it) => cleanStroke(it, depth + 1)).filter(Boolean);
    } else if (s.tool === 'text') {
      c.x = num(s.x); c.y = num(s.y); c.text = str(s.text, 2000); c.size = c.size || 24; c.color = c.color || '#1b1b1d';
    } else if (s.tool === 'rect') {
      box(); c.r = clamp(num(s.r), 0, 400); if (typeof s.fill === 'string') c.fill = s.fill.slice(0, 60);
    } else if (s.tool === 'note') {
      box(); c.text = str(s.text, 600); c.n = str(s.n, 30); c.color = c.color || NOTE_COLORS[0][0];
    } else if (s.tool === 'card') {
      box(); c.f = str(s.f, 300); c.b = str(s.b, 600); c.flip = s.flip === true; c.i = clamp(num(s.i) | 0, 0, 999); c.of = clamp(num(s.of) | 0, 0, 999);
    } else {
      if (!Array.isArray(s.points)) return null;
      c.points = s.points.slice(0, 20000).filter((p) => Array.isArray(p) && isFinite(p[0]) && isFinite(p[1])).map((p) => [+p[0], +p[1]]);
      if (!c.points.length) return null;
      c.size = c.size || 3; c.color = c.color || '#1b1b1d';
    }
    return c;
  }

  // words that fill a box: the biggest size (big → small) at which every line fits
  function wrapLines(ctx, text, maxW) {
    const out = [];
    String(text).split('\n').forEach((par) => {
      let line = '';
      par.split(/\s+/).filter(Boolean).forEach((w) => {
        const t = line ? line + ' ' + w : w;
        if (line && ctx.measureText(t).width > maxW) { out.push(line); line = w; } else line = t;
      });
      out.push(line);
    });
    return out;
  }
  function fitText(ctx, text, maxW, maxH, big, small, weight) {
    for (let fs = big; fs >= small; fs -= 2) {
      ctx.font = `${weight} ${fs}px system-ui, -apple-system, "Segoe UI", sans-serif`;
      const lines = wrapLines(ctx, text, maxW);
      if (lines.length * fs * 1.22 <= maxH && lines.every((l) => ctx.measureText(l).width <= maxW)) return { fs, lines };
    }
    ctx.font = `${weight} ${small}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    let lines = wrapLines(ctx, text, maxW);
    const max = Math.max(1, Math.floor(maxH / (small * 1.22)));
    if (lines.length > max) { lines = lines.slice(0, max); lines[max - 1] = lines[max - 1].replace(/\s*\S*$/, '') + '…'; }
    return { fs: small, lines };
  }
  const measure = document.createElement('canvas').getContext('2d');

  // How a sticky note or flashcard looks, as plain pieces (a card, then lines of words) —
  // drawn on the board, and handed to anyone who rebuilds the board from data.
  function objPieces(s, face) {
    const out = [], note = s.tool === 'note', w = s.w, h = s.h, u = Math.min(w / 220, h / 150);
    out.push({ tool: 'rect', x: 0, y: 0, w, h, r: note ? 4 : 12, fill: note ? s.color || NOTE_COLORS[0][0] : '#ffffff', color: note ? 'rgba(0,0,0,.10)' : 'rgba(0,0,0,.16)', size: 1.5 });
    const ink = '#22201a', mute = 'rgba(34,32,26,.55)';
    if (note) {
      const pad = 12 * u, tagH = s.n ? 22 * u : 0;
      const { fs, lines } = fitText(measure, s.text || '', w - pad * 2, h - pad * 2 - tagH, Math.round(30 * u), Math.max(9, Math.round(12 * u)), 600);
      lines.forEach((ln, i) => out.push({ tool: 'text', x: pad, y: pad + i * fs * 1.22, size: fs, color: ink, text: ln, weight: 600 }));
      if (s.n) out.push({ tool: 'text', x: pad, y: h - pad - 14 * u, size: Math.round(14 * u), color: mute, text: '- ' + s.n, weight: 600 });
    } else {
      const back = face, pad = 14 * u, top = 26 * u;
      out.push({ tool: 'text', x: pad, y: pad * 0.8, size: Math.round(13 * u), color: mute, text: back ? 'ANSWER' : 'QUESTION', weight: 700 });
      if (s.of > 1) { measure.font = `600 ${Math.round(13 * u)}px system-ui, sans-serif`; const t = `${s.i}/${s.of}`; out.push({ tool: 'text', x: w - pad - measure.measureText(t).width, y: pad * 0.8, size: Math.round(13 * u), color: mute, text: t, weight: 600 }); }
      const body = back ? s.b : s.f, wt = back ? 500 : 700;
      const { fs, lines } = fitText(measure, body || '', w - pad * 2, h - top - pad * 1.6, Math.round(30 * u), Math.max(9, Math.round(11 * u)), wt);
      const y0 = top + (h - top - pad * 0.6 - lines.length * fs * 1.22) / 2;
      measure.font = `${wt} ${fs}px system-ui, -apple-system, "Segoe UI", sans-serif`;
      lines.forEach((ln, i) => out.push({ tool: 'text', x: (w - measure.measureText(ln).width) / 2, y: y0 + i * fs * 1.22, size: fs, color: ink, text: ln, weight: wt }));
    }
    return out;
  }

  // A one-page PDF around a JPEG of the board (no library needed)
  function pdfFromJpeg(dataUrl, w, h) {
    const bin = atob(dataUrl.split(',')[1] || ''), img = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) img[i] = bin.charCodeAt(i);
    const k = 842 / Math.max(w, h), pw = (w * k).toFixed(2), ph = (h * k).toFixed(2);
    const enc = new TextEncoder(), parts = [], at = [];
    let len = 0;
    const put = (x) => { const b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); len += b.length; };
    const obj = (n, body) => { at[n] = len; put(`${n} 0 obj\n`); body(); put('\nendobj\n'); };
    put('%PDF-1.4\n');
    obj(1, () => put('<< /Type /Catalog /Pages 2 0 R >>'));
    obj(2, () => put('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'));
    obj(3, () => put(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`));
    obj(4, () => { put(`<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.length} >>\nstream\n`); put(img); put('\nendstream'); });
    const draw = `q ${pw} 0 0 ${ph} 0 0 cm /Im0 Do Q`;
    obj(5, () => put(`<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`));
    const xref = len;
    put(`xref\n0 6\n0000000000 65535 f \n${[1, 2, 3, 4, 5].map((n) => String(at[n]).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    return new Blob(parts, { type: 'application/pdf' });
  }

  // A pasted deck: one card per line, front and back split by a tab, dash, colon, "=" or "|"
  // (also "Q: … / A: …" on two lines, and Quizlet/Anki exports).
  function parseDeck(text) {
    const out = [], lines = String(text || '').replace(/\r/g, '').split('\n').map((l) => l.trim()).filter((l) => l && !/^#/.test(l));
    for (let i = 0; i < lines.length && out.length < 40; i++) {
      const l = lines[i].replace(/^(?:[-*•]|\d+[.)])\s+/, '');
      const q = l.match(/^(?:Q|Front)\s*[:.)]\s*(.+)$/i), a = lines[i + 1] && lines[i + 1].match(/^(?:A|Back)\s*[:.)]\s*(.+)$/i);
      if (q && a) { out.push({ f: q[1], b: a[1] }); i++; continue; }
      const m = l.match(/^(.+?)(?:\t|\s+::\s+|\s+\|\s+|\s+[–—-]\s+|\s*[–—]\s*|\s+=\s+|:\s+)(.+)$/);
      if (m && m[1].trim() && m[2].trim()) out.push({ f: m[1].trim(), b: m[2].trim() });
    }
    return out;
  }

  // Quick shapes to draw on: built around (0, 0), then placed where the student taps
  const TEMPLATES = [['grid', 'Coordinate grid', [660, 660]], ['venn2', 'Venn diagram: 2 sets', [700, 480]], ['venn3', 'Venn diagram: 3 sets', [640, 620]], ['flow', 'Flowchart boxes', [560, 640]], ['gates', 'Logic gates', [740, 470]]];
  function template(kind, ink, soft) {
    const it = [];
    const pen = (pts, c = ink, size = 4) => it.push({ tool: 'pen', color: c, size, points: pts });
    const txt = (t, x, y, size = 24, c = ink, center = false) => { measure.font = `600 ${size}px system-ui, sans-serif`; it.push({ tool: 'text', x: center ? x - measure.measureText(t).width / 2 : x, y, size, color: c, text: String(t) }); };
    const box = (x, y, w, h, r = 6) => it.push({ tool: 'rect', x, y, w, h, r, fill: 'rgba(0,0,0,0)', color: ink, size: 4 });
    const circle = (cx, cy, r, c = ink) => { const p = []; for (let a = 0; a <= 96; a++) p.push([cx + r * Math.cos(a / 96 * Math.PI * 2), cy + r * Math.sin(a / 96 * Math.PI * 2)]); pen(p, c); };
    const quad = (a, c, b, n = 18) => { const p = []; for (let i = 0; i <= n; i++) { const t = i / n, s = 1 - t; p.push([s * s * a[0] + 2 * s * t * c[0] + t * t * b[0], s * s * a[1] + 2 * s * t * c[1] + t * t * b[1]]); } return p; };
    const arrow = (pts) => { pen(pts); const b = pts[pts.length - 1], a = pts[pts.length - 2], ang = Math.atan2(b[1] - a[1], b[0] - a[0]), L = 16; pen([[b[0] - L * Math.cos(ang - 0.45), b[1] - L * Math.sin(ang - 0.45)], b, [b[0] - L * Math.cos(ang + 0.45), b[1] - L * Math.sin(ang + 0.45)]]); };
    if (kind === 'grid') {
      const st = 30, n = 10, R = st * n;
      for (let i = -n; i <= n; i++) { if (!i) continue; pen([[i * st, -R], [i * st, R]], soft, 1.5); pen([[-R, i * st], [R, i * st]], soft, 1.5); }
      arrow([[-R - 10, 0], [R + 22, 0]]); arrow([[R + 10, 0], [-R - 22, 0]]);
      arrow([[0, R + 10], [0, -R - 22]]); arrow([[0, -R - 10], [0, R + 22]]);
      for (let i = -n; i <= n; i += 2) { if (!i) continue; txt(i, i * st, 8, 16, ink, true); txt(i, 8, -i * st - 9, 16); }
      txt('x', R + 18, 8, 24); txt('y', 10, -R - 34, 24); txt('O', -22, 6, 16);
    } else if (kind === 'venn2') {
      box(-340, -230, 680, 460, 16); txt('U', -322, -218, 22);
      circle(-95, 15, 170); circle(95, 15, 170);
      txt('A', -215, -200, 30); txt('B', 195, -200, 30);
    } else if (kind === 'venn3') {
      box(-310, -300, 620, 600, 16); txt('U', -292, -288, 22);
      circle(-85, -55, 150); circle(85, -55, 150); circle(0, 90, 150);
      txt('A', -230, -230, 30); txt('B', 210, -230, 30); txt('C', -10, 250, 30);
    } else if (kind === 'flow') {
      const y0 = -300;
      box(-110, y0, 220, 70, 35); txt('Start', 0, y0 + 21, 26, ink, true);
      arrow([[0, y0 + 70], [0, y0 + 128]]);
      box(-140, y0 + 130, 280, 90); txt('Do a step', 0, y0 + 160, 26, ink, true);
      arrow([[0, y0 + 220], [0, y0 + 278]]);
      pen([[0, y0 + 280], [150, y0 + 370], [0, y0 + 460], [-150, y0 + 370], [0, y0 + 280]]); txt('Is it true?', 0, y0 + 356, 24, ink, true);
      arrow([[0, y0 + 460], [0, y0 + 528]]); txt('Yes', 12, y0 + 474, 20);
      arrow([[150, y0 + 370], [230, y0 + 370], [230, y0 + 175], [142, y0 + 175]]); txt('No', 166, y0 + 334, 20);
      box(-110, y0 + 530, 220, 70, 35); txt('End', 0, y0 + 551, 26, ink, true);
    } else if (kind === 'gates') {
      const cell = (gx, gy, name) => {
        const or = /OR/.test(name), bubble = /^N/.test(name) || name === 'NOT';
        let tip;
        if (name === 'NOT') { pen([[gx, gy - 36], [gx + 80, gy], [gx, gy + 36], [gx, gy - 36]]); tip = gx + 80; pen([[gx - 40, gy], [gx, gy]]); }
        else if (or) {
          pen(quad([gx, gy - 40], [gx + 22, gy], [gx, gy + 40]));
          pen(quad([gx, gy - 40], [gx + 70, gy - 40], [gx + 110, gy])); pen(quad([gx, gy + 40], [gx + 70, gy + 40], [gx + 110, gy]));
          if (name === 'XOR') pen(quad([gx - 12, gy - 40], [gx + 10, gy], [gx - 12, gy + 40]));
          tip = gx + 110; const back = name === 'XOR' ? gx - 4 : gx + 8;
          pen([[gx - 40, gy - 20], [back, gy - 20]]); pen([[gx - 40, gy + 20], [back, gy + 20]]);
        } else {
          const arc = []; for (let a = -90; a <= 90; a += 6) arc.push([gx + 55 + 40 * Math.cos(a * Math.PI / 180), gy + 40 * Math.sin(a * Math.PI / 180)]);
          pen([[gx, gy + 40], [gx, gy - 40], [gx + 55, gy - 40], ...arc, [gx, gy + 40]]); tip = gx + 95;
          pen([[gx - 40, gy - 20], [gx, gy - 20]]); pen([[gx - 40, gy + 20], [gx, gy + 20]]);
        }
        if (bubble) { circle(tip + 8, gy, 8); tip += 16; }
        pen([[tip, gy], [gx + 160, gy]]);
        txt(name, gx + 55, gy + 52, 20, ink, true);
      };
      [['AND', -305, -110], ['OR', -55, -110], ['NOT', 195, -110], ['NAND', -305, 110], ['NOR', -55, 110], ['XOR', 195, 110]].forEach(([n, x, y]) => cell(x, y, n));
    }
    return it;
  }

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
          <button class="csk-btn" data-act="save" title="Save or open: picture, PDF or a board file">${svg('save')}</button>
          ${opts.allowDock ? `<button class="csk-btn" data-act="dock" title="Dock to the side / full screen">${svg(opts.dock === 'side' ? 'full' : 'side')}</button>` : ''}
          <button class="csk-btn" data-act="close" title="Close board" aria-label="Close">${svg('close')}</button>
        </div>
        <div class="csk-room" hidden aria-live="polite"></div>
        <div class="csk-note" hidden></div>
        <div class="csk-tools">
          <button class="csk-btn" data-tool="select" title="Move. Drag sticky notes and cards, tap a card to flip it">${svg('select')}</button>
          <button class="csk-btn on" data-tool="pen" title="Pen">${svg('pen')}</button>
          <button class="csk-btn" data-tool="hl" title="Highlighter">${svg('hl')}</button>
          <button class="csk-btn" data-tool="line" title="Straight line">${svg('line')}</button>
          <button class="csk-btn" data-tool="text" title="Type text">${svg('text')}</button>
          <button class="csk-btn" data-tool="eraser" title="Eraser">${svg('eraser')}</button>
          <button class="csk-btn" data-tool="laser" title="Laser pointer: point at something; it fades in 2 seconds">${svg('laser')}</button>
          <span class="csk-sep"></span>
          <button class="csk-btn" data-tool="note" title="Sticky notes">${svg('note')}</button>
          <button class="csk-btn" data-act="cards" title="Flashcards on the board">${svg('cards')}</button>
          <button class="csk-btn" data-act="shapes" title="Quick shapes: graph grid, Venn, flowchart, logic gates">${svg('shapes')}</button>
          <span class="csk-sep"></span>
          <span class="csk-inks"></span>
          <span class="csk-sep"></span>
          <span class="csk-sizes"></span>
          <span class="csk-sep"></span>
          <button class="csk-btn" data-act="undo" title="Undo">${svg('undo')}</button>
          <button class="csk-btn" data-act="redo" title="Redo">${svg('redo')}</button>
          <button class="csk-btn" data-act="clear" title="Clear your drawing">${svg('trash')}</button>
          <button class="csk-btn" data-act="grid" title="Graph paper">${svg('grid')}</button>
          ${opts.room ? '' : `<button class="csk-btn" data-act="pic" title="Draw on a picture, or paste one with Ctrl+V">${svg('image')}</button>`}
          <input type="file" accept="image/*" class="csk-hidden csk-picfile">
          <input type="file" accept=".json,application/json" class="csk-hidden csk-boardfile">
        </div>
        ${opts.onAsk ? `<form class="csk-ask"><input type="text" placeholder="${opts.askPlaceholder || 'Ask Cassie about this…'}" aria-label="Ask Cassie"><button class="csk-btn primary" type="submit">Ask</button></form>` : ''}
        <div class="csk-stage"><div class="csk-board">
          <canvas class="csk-bg"></canvas><canvas class="csk-ink"></canvas><canvas class="csk-obj"></canvas><canvas class="csk-live"></canvas><canvas class="csk-fx"></canvas>
        </div></div>
      </div>`;
    root.appendChild(wrap);
    const $ = (s) => wrap.querySelector(s);
    $('.csk-title').textContent = opts.title || 'Board';
    const stage = $('.csk-stage'), boardEl = $('.csk-board');
    const bg = $('.csk-bg'), obj = $('.csk-obj'), ink = $('.csk-ink'), live = $('.csk-live'), fx = $('.csk-fx');
    const note = $('.csk-note');

    // ---- state ----
    let W = 1600, H = 1000;
    let bgImage = await loadImage(opts.image);
    let grid = !bgImage && opts.grid !== false;
    const paper = dark ? '#1d1d20' : '#ffffff';
    let tool = 'pen', color = dark ? '#ffffff' : '#1b1b1d', size = SIZES[0];
    const strokes = [], redo = [];
    let drawing = null;
    // sticky notes and flashcards sit on their own layer above the ink; with the Move tool, or any pen,
    // pressing on one picks it up (it never gets drawn on by accident)
    let sel = null, drag = null, skipClick = false, laserDown = false, pendingTpl = null, fixedSize = null, editing = false;
    let noteColor = NOTE_COLORS[0][0], zTop = 0, vSeq = 0, objRaf = 0, myColor = PEOPLE[0];
    const glide = new Map(), flipAnim = new Map(), ver = new Map();
    const isObj = (st) => !!st && (st.tool === 'note' || st.tool === 'card');
    // A live study room (opts.room = { me, send(op) }): every stroke has an id and an owner and is
    // sent to classmates when it's finished; theirs arrive through session.remote(). Undo and
    // clear only touch your own strokes, so nobody can wipe a classmate's work.
    const room = opts.room || null;
    const rid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
    const pack = (st) => { const c = { ...st }; delete c.mine; delete c.z; Object.keys(c).forEach((k) => { if (k[0] === '_') delete c[k]; }); if (c.points) c.points = c.points.map((q) => [Math.round(q[0]), Math.round(q[1])]); if (c.items) c.items = c.items.map(pack); return c; };
    const myName = (room && room.name) || opts.name || '';
    const editable = (st) => !room || !!st.mine;
    function share(st) { if (!room) return; st.id = st.id || rid(); st.mine = true; st.u = room.me; room.send({ t: 'add', s: pack(st) }); }

    function setSize() {
      if (room) { // everyone in a room draws on the same page
        W = 1600; H = 1000;
      } else if (fixedSize && !bgImage) { // a board file that was saved at its own size
        W = fixedSize.w; H = fixedSize.h;
      } else if (bgImage) {
        const iw = bgImage.naturalWidth || bgImage.width, ih = bgImage.naturalHeight || bgImage.height;
        const s = Math.min(1, 1800 / Math.max(iw, ih));
        W = Math.max(200, Math.round(iw * s)); H = Math.max(150, Math.round(ih * s));
      } else {
        // a blank page takes the shape of the space it's in (tall on a phone)
        const r = stage.getBoundingClientRect();
        W = 1600; H = Math.round(Math.min(2800, Math.max(700, 1600 * ((r.height - 20) / Math.max(1, r.width - 20)))));
      }
      [bg, obj, ink, live, fx].forEach((c) => { c.width = W; c.height = H; });
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
      if (s.tool === 'group') { (s.items || []).forEach((it) => paint(ctx, it)); return; }
      ctx.save();
      if (s.tool === 'rect') {
        ctx.fillStyle = s.fill || 'rgba(255,255,255,.94)'; ctx.strokeStyle = s.color || 'rgba(0,0,0,.15)'; ctx.lineWidth = s.size || 2;
        ctx.beginPath(); ctx.roundRect ? ctx.roundRect(s.x, s.y, s.w, s.h, s.r || 0) : ctx.rect(s.x, s.y, s.w, s.h); ctx.fill(); ctx.stroke();
        ctx.restore(); return;
      }
      if (s.tool === 'text') {
        ctx.fillStyle = s.color; ctx.font = `${s.weight || 600} ${s.size}px system-ui, sans-serif`; ctx.textBaseline = 'top';
        s.text.split('\n').forEach((ln, i) => ctx.fillText(ln, s.x, s.y + i * s.size * 1.25));
        ctx.restore(); return;
      }
      if (isObj(s)) { ctx.translate(s.x, s.y); objPieces(s, !!s.flip).forEach((it) => paint(ctx, it)); ctx.restore(); return; }
      const p = s.points;
      if (!p || !p.length) { ctx.restore(); return; }
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.globalCompositeOperation = s.tool === 'eraser' ? 'destination-out' : 'source-over';
      ctx.strokeStyle = s.tool === 'eraser' ? '#000' : s.color;
      ctx.globalAlpha = s.tool === 'hl' ? 0.35 : 1;
      ctx.lineWidth = s.tool === 'hl' ? s.size * 4 : s.tool === 'eraser' ? s.size * 4 : s.size;
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
      strokes.forEach((s) => { if (!isObj(s)) paint(x, s); });
      redrawObjs();
      $('[data-act="undo"]').disabled = !strokes.length;
      $('[data-act="redo"]').disabled = !redo.length;
    }
    // ---- sticky notes and flashcards (their own layer, newest on top) ----
    const handleR = () => Math.max(15, 13 * scaleK());
    function paintObj(ctx, s, now) {
      let { x, y } = s;
      const g = glide.get(s.id);
      if (g) { const t = Math.min(1, (now - g.t0) / 260), e = 1 - (1 - t) ** 3; x = g.x + (s.x - g.x) * e; y = g.y + (s.y - g.y) * e; if (t >= 1) glide.delete(s.id); }
      let sx = 1, face = !!s.flip;
      const f = flipAnim.get(s.id);
      if (f) { const t = Math.min(1, (now - f) / 340); sx = Math.abs(Math.cos(t * Math.PI)); if (t < 0.5) face = !face; if (t >= 1) flipAnim.delete(s.id); }
      ctx.save();
      ctx.translate(x + s.w / 2, y + s.h / 2); ctx.scale(Math.max(0.02, sx), 1); ctx.translate(-s.w / 2, -s.h / 2);
      const parts = objPieces(s, face);
      ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.24)'; ctx.shadowBlur = 16; ctx.shadowOffsetY = 5; paint(ctx, parts[0]); ctx.restore();
      if (s.tool === 'card') { // ruled like an index card
        ctx.strokeStyle = 'rgba(0,0,0,.07)'; ctx.lineWidth = 1.2;
        for (let ly = s.h * 0.42; ly < s.h - 10; ly += Math.max(16, s.h / 7)) { ctx.beginPath(); ctx.moveTo(12, ly); ctx.lineTo(s.w - 12, ly); ctx.stroke(); }
      }
      if (!s._editing) { ctx.save(); ctx.beginPath(); ctx.rect(0, 0, s.w, s.h); ctx.clip(); parts.slice(1).forEach((it) => paint(ctx, it)); ctx.restore(); }
      if (sel === s && sx === 1) {
        ctx.setLineDash([9, 6]); ctx.strokeStyle = dark ? '#ececec' : '#1b1b1d'; ctx.lineWidth = 2.5;
        ctx.strokeRect(-5, -5, s.w + 10, s.h + 10); ctx.setLineDash([]);
        if (editable(s)) { // the × that throws it away
          const r = handleR();
          ctx.fillStyle = '#1b1b1d'; ctx.beginPath(); ctx.arc(s.w, 0, r, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(s.w - r * 0.4, -r * 0.4); ctx.lineTo(s.w + r * 0.4, r * 0.4); ctx.moveTo(s.w + r * 0.4, -r * 0.4); ctx.lineTo(s.w - r * 0.4, r * 0.4); ctx.stroke();
        }
      }
      ctx.restore();
    }
    function redrawObjs() {
      const x = obj.getContext('2d'), now = performance.now();
      x.clearRect(0, 0, W, H);
      strokes.filter(isObj).sort((a, b) => (a.z || 0) - (b.z || 0)).forEach((s) => paintObj(x, s, now));
      if ((glide.size || flipAnim.size) && !objRaf) objRaf = requestAnimationFrame(() => { objRaf = 0; redrawObjs(); });
    }
    const objAt = (pt) => strokes.filter(isObj).sort((a, b) => (b.z || 0) - (a.z || 0)).find((s) => pt[0] >= s.x && pt[0] <= s.x + s.w && pt[1] >= s.y && pt[1] <= s.y + s.h) || null;
    const onHandle = (pt) => sel && editable(sel) && strokes.includes(sel) && Math.hypot(pt[0] - (sel.x + sel.w), pt[1] - sel.y) <= handleR() * 1.3;
    // a move or a flip: everyone gets the whole note/card again (the newest version wins)
    function sendUpdate(s) {
      s.z = ++zTop;
      if (!room) return;
      const v = ++vSeq; ver.set(s.id, v);
      room.send({ t: 'add', up: 1, v, s: pack(s) });
    }
    function removeObj(s) {
      if (!editable(s)) return;
      const i = strokes.indexOf(s);
      if (i < 0) return;
      strokes.splice(i, 1);
      if (sel === s) sel = null;
      if (room && s.id) room.send({ t: 'del', ids: [s.id] });
      redraw();
    }
    function flipCard(c) { c.flip = !c.flip; flipAnim.set(c.id, performance.now()); sendUpdate(c); redrawObjs(); }
    function moveObj(s, nx, ny) { glide.set(s.id, { x: s.x, y: s.y, t0: performance.now() }); s.x = nx; s.y = ny; sendUpdate(s); }
    function newNote(pt) {
      const big = Math.max(1, Math.min(2.2, scaleK() / 2)); // a readable size on a small screen too
      const w = Math.round(220 * big), h = Math.round(190 * big);
      const st = { tool: 'note', id: rid(), x: clamp(pt[0] - w / 2, 0, W - w), y: clamp(pt[1] - h / 2, 0, H - h), w, h, color: noteColor, text: '', n: myName, z: ++zTop, _fresh: true };
      strokes.push(st); sel = st; redraw();
      editNote(st);
    }
    function editNote(st) {
      const br = boardEl.getBoundingClientRect(), k = br.width / W;
      const box = document.createElement('div');
      box.className = 'csk-notebox'; box.contentEditable = 'true'; box.setAttribute('aria-label', 'Sticky note');
      Object.assign(box.style, { left: st.x * k + 'px', top: st.y * k + 'px', width: st.w * k + 'px', height: st.h * k + 'px', background: st.color, fontSize: Math.max(12, 22 * k) + 'px' });
      box.innerText = st.text || '';
      boardEl.appendChild(box);
      st._editing = true; editing = true; redrawObjs();
      track([st.x + st.w / 2, st.y + st.h / 2]);
      box.focus();
      try { const r = document.createRange(); r.selectNodeContents(box); r.collapse(false); const s2 = getSelection(); s2.removeAllRanges(); s2.addRange(r); } catch (e) { /* caret at the start is fine */ }
      let cancelled = false;
      const commit = () => {
        const text = cancelled ? '' : box.innerText.replace(/\s+$/, '').slice(0, 600);
        box.remove(); delete st._editing; editing = false;
        if (st._fresh) {
          delete st._fresh;
          if (!text.trim()) { const i = strokes.indexOf(st); if (i >= 0) strokes.splice(i, 1); if (sel === st) sel = null; redraw(); return; }
          st.text = text; redo.length = 0; redraw(); share(st); return;
        }
        if (cancelled || text === st.text) { redrawObjs(); return; }
        if (!text.trim()) { removeObj(st); return; }
        st.text = text; sendUpdate(st); redrawObjs();
      };
      box.addEventListener('blur', commit, { once: true });
      box.addEventListener('keydown', (k2) => {
        k2.stopPropagation();
        if (k2.key === 'Enter' && !k2.shiftKey) { k2.preventDefault(); box.blur(); }
        if (k2.key === 'Escape') { if (!st._fresh) cancelled = true; else box.innerText = ''; box.blur(); }
      });
    }
    // flashcards dropped on the board as a neat grid of index cards
    function dropCards(list) {
      const cards = (list || []).filter((c) => c && String(c.f || '').trim() && String(c.b || '').trim()).slice(0, 24);
      if (!cards.length) return 0;
      // fewer columns on a tall (phone) board; cards at least ~160 px wide on screen
      const n = cards.length, cols = Math.min(n, Math.max(1, Math.ceil(Math.sqrt(n * 1.7 * Math.min(1, (W / H) / 1.6))))), rows = Math.ceil(n / cols), gap = 18;
      let cw = Math.min(Math.max(320, 165 * scaleK()), (W * 0.92 - gap * (cols - 1)) / cols), ch = cw * 0.62;
      if (rows * ch + gap * (rows - 1) > H * 0.88) { ch = (H * 0.88 - gap * (rows - 1)) / rows; cw = ch / 0.62; }
      const x0 = (W - (cols * cw + (cols - 1) * gap)) / 2, y0 = (H - (rows * ch + (rows - 1) * gap)) / 2;
      cards.forEach((c, i) => {
        const st = { tool: 'card', id: rid(), x: x0 + (i % cols) * (cw + gap), y: y0 + Math.floor(i / cols) * (ch + gap), w: cw, h: ch, f: String(c.f).trim().slice(0, 300), b: String(c.b).trim().slice(0, 600), flip: false, i: i + 1, of: n, z: ++zTop };
        strokes.push(st); share(st);
      });
      redo.length = 0; redraw();
      setTool('select');
      toast('Tap a card to flip it · drag one to move it');
      return n;
    }
    // sticky notes sorted into one column per colour (the "cluster grid")
    function tidyNotes() {
      const notes = strokes.filter((s) => s.tool === 'note').sort((a, b) => (a.z || 0) - (b.z || 0));
      if (!notes.length) { toast('No sticky notes yet. Tap the board to add one'); return; }
      const order = NOTE_COLORS.map((c) => c[0]), groups = new Map();
      notes.forEach((s) => { const key = order.includes(s.color) ? s.color : 'other'; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(s); });
      const keys = [...groups.keys()].sort((a, b) => (order.indexOf(a) + 99) % 99 - (order.indexOf(b) + 99) % 99);
      const gap = 14, colGap = 44, nh = Math.max(...notes.map((s) => s.h)), nw = Math.max(...notes.map((s) => s.w));
      const perCol = Math.max(1, Math.floor((H - 40 + gap) / (nh + gap)));
      const spots = [];
      let x = 0;
      keys.forEach((key) => {
        const list = groups.get(key), cols = Math.ceil(list.length / perCol);
        list.forEach((s, i) => spots.push([s, x + Math.floor(i / perCol) * (nw + gap), 20 + (i % perCol) * (nh + gap)]));
        x += cols * (nw + gap) - gap + colGap;
      });
      const span = x - colGap, k = span > W - 40 ? (W - 40 - nw) / Math.max(1, span - nw) : 1, left = span > W - 40 ? 20 : (W - span) / 2;
      spots.forEach(([s, sx, sy]) => moveObj(s, left + sx * k, sy));
      redrawObjs();
    }
    // quick shapes go where you tap next
    function placeTemplate(kind, pt) {
      const T = TEMPLATES.find((t) => t[0] === kind);
      if (!T) return;
      const k = clamp(Math.min(W / 1600, H / 1000), 0.4, 1.2);
      const cx = clamp(pt[0], (T[2][0] / 2) * k + 8, W - (T[2][0] / 2) * k - 8), cy = clamp(pt[1], (T[2][1] / 2) * k + 8, H - (T[2][1] / 2) * k - 8);
      const tc = (color === '#ffffff' && !dark) || (color === '#1b1b1d' && dark) ? (dark ? '#ececec' : '#1b1b1d') : color;
      const soft = dark ? 'rgba(255,255,255,.16)' : 'rgba(0,0,0,.13)';
      const at = (it) => {
        const c = { ...it };
        if (c.points) c.points = c.points.map((p) => [cx + p[0] * k, cy + p[1] * k]);
        if (c.x != null) { c.x = cx + c.x * k; c.y = cy + c.y * k; }
        if (c.w != null) { c.w *= k; c.h *= k; c.r = (c.r || 0) * k; }
        c.size = (c.size || 3) * k;
        return c;
      };
      const g = { tool: 'group', by: 'shape', items: template(kind, tc, soft).map(at) };
      strokes.push(g); redo.length = 0; redraw(); share(g);
      setTool('pen');
      const tt = stage.querySelector('.csk-toast'); if (tt) tt.style.opacity = '0';
    }

    // ---- the laser pointer: a bright trail that fades away in 2 seconds (never saved) ----
    const trails = new Map();
    let fxRaf = 0;
    function laserAdd(key, c, x, y, start) {
      let t = trails.get(key);
      if (!t) trails.set(key, (t = { color: c, pts: [] }));
      t.color = c; t.pts.push([x, y, performance.now(), start ? 1 : 0]);
      if (!fxRaf) fxRaf = requestAnimationFrame(fxLoop);
    }
    function fxLoop() {
      fxRaf = 0;
      const x = fx.getContext('2d'), now = performance.now(), k = Math.max(W / 1600, 0.5);
      x.clearRect(0, 0, W, H);
      for (const [key, t] of trails) {
        t.pts = t.pts.filter((p) => now - p[2] < 2000);
        if (!t.pts.length) { trails.delete(key); continue; }
        x.save(); x.lineCap = 'round'; x.lineJoin = 'round'; x.shadowColor = t.color; x.shadowBlur = 14 * k; x.strokeStyle = t.color;
        for (let i = 1; i < t.pts.length; i++) {
          const a = t.pts[i - 1], b = t.pts[i];
          if (b[3]) continue; // a new sweep starts here
          const life = 1 - (now - b[2]) / 2000;
          x.globalAlpha = Math.max(0, life); x.lineWidth = 8 * k * (0.45 + 0.55 * life);
          x.beginPath(); x.moveTo(a[0], a[1]); x.lineTo(b[0], b[1]); x.stroke();
        }
        const last = t.pts[t.pts.length - 1], life = Math.max(0, 1 - (now - last[2]) / 2000);
        x.globalAlpha = life; x.fillStyle = t.color; x.beginPath(); x.arc(last[0], last[1], 11 * k, 0, Math.PI * 2); x.fill();
        x.shadowBlur = 0; x.fillStyle = '#fff'; x.beginPath(); x.arc(last[0], last[1], 4.5 * k, 0, Math.PI * 2); x.fill();
        x.restore();
      }
      if (trails.size) fxRaf = requestAnimationFrame(fxLoop);
    }

    // ---- where you are, for your classmates' screens (sent with each check for news) ----
    const pres = { seq: 0, buf: [], t0: 0, last: 0, a: '', gone: false, dirty: false };
    const activity = () => (drag && drag.moved ? 'moving' : laserDown ? 'pointing' : editing ? 'typing' : drawing ? (drawing.tool === 'eraser' ? 'erasing' : 'drawing') : '');
    function track(pt, laser = 0) {
      if (!room) return;
      const now = performance.now(), a = activity();
      if (a) pres.a = a;
      if (!laser && now - pres.last < 70 && !pres.gone) return;
      pres.last = now;
      if (!pres.buf.length) pres.t0 = now;
      pres.buf.push([Math.round(pt[0]), Math.round(pt[1]), Math.round(now - pres.t0), laser]);
      if (pres.buf.length > 100) pres.buf = pres.buf.filter((q, i) => i % 2 === 0 || q[3] === 2);
      pres.gone = false; pres.dirty = true;
    }
    function presence() {
      if (!pres.dirty) return null;
      const p = { s: ++pres.seq, a: pres.a || activity(), t: pres.buf };
      if (pres.gone) p.g = 1;
      pres.buf = []; pres.dirty = false; pres.a = activity();
      return p;
    }
    // classmates' pointers: each person's moves are replayed smoothly, in their own colour
    const curs = new Map();
    let curRaf = 0;
    function colorOf(uid, ids) { const i = ids.indexOf(uid); if (i >= 0) return PEOPLE[i % PEOPLE.length]; let h = 0; for (const ch of String(uid)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return PEOPLE[h % PEOPLE.length]; }
    function others(list, members) {
      if (!room) return;
      const ids = (members || []).map((m) => m.uid).filter(Boolean).sort();
      myColor = colorOf(room.me, ids);
      const now = performance.now(), seen = new Set();
      for (const h of Array.isArray(list) ? list : []) {
        if (!h || !h.uid || h.uid === room.me || !h.p || typeof h.p !== 'object') continue;
        seen.add(h.uid);
        let c = curs.get(h.uid);
        if (!c) {
          const el = document.createElement('div'); el.className = 'csk-cur'; el.hidden = true;
          el.innerHTML = '<svg viewBox="0 0 18 18" aria-hidden="true"><path d="M2 1.5l13 7.4-5.9 1.3-3 5.6z" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg><span></span>';
          boardEl.appendChild(el);
          c = { uid: h.uid, el, q: [], seq: null, end: 0 }; curs.set(h.uid, c);
        }
        c.name = ((members || []).find((m) => m.uid === h.uid) || {}).name || 'Classmate';
        c.color = colorOf(h.uid, ids); c.seenAt = now;
        if (h.p.s === c.seq) continue;
        c.seq = h.p.s;
        c.a = ACTS[h.p.a] || '';
        const pts = (Array.isArray(h.p.t) ? h.p.t : []).slice(-120).filter((q) => Array.isArray(q) && isFinite(q[0]) && isFinite(q[1]));
        let base = Math.max(now + 20, c.end);
        if (base - now > 1500) { base = now + 20; c.q.length = 0; } // never fall far behind
        pts.forEach((q) => c.q.push({ at: base + clamp(+q[2] || 0, 0, 5000), x: clamp(+q[0], 0, W), y: clamp(+q[1], 0, H), l: q[3] | 0 }));
        c.end = c.q.length ? c.q[c.q.length - 1].at : base;
        if (h.p.g) c.q.push({ at: c.end + 1, gone: true });
        label(c);
      }
      for (const c of curs.values()) if (!seen.has(c.uid)) { c.el.hidden = true; c.q.length = 0; }
      if (!curRaf) curRaf = requestAnimationFrame(curLoop);
    }
    function label(c) {
      const sp = c.el.querySelector('span');
      sp.textContent = c.name + (c.a ? ' · ' + c.a : '');
      sp.style.background = c.color; c.el.querySelector('path').setAttribute('fill', c.color);
    }
    function curLoop() {
      curRaf = 0;
      const now = performance.now();
      let busy = false;
      for (const c of curs.values()) {
        while (c.q.length && c.q[0].at <= now) {
          const q = c.q.shift();
          if (q.gone) { c.el.hidden = true; continue; }
          c.el.hidden = false;
          c.el.style.left = (q.x / W * 100) + '%'; c.el.style.top = (q.y / H * 100) + '%';
          if (q.l) laserAdd(c.uid, c.color, q.x, q.y, q.l === 2);
        }
        if (c.q.length) busy = true;
      }
      if (busy) curRaf = requestAnimationFrame(curLoop);
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
      closePop();
      skipClick = false;
      const pt = toBoard(e);
      // on a note or card, pens, text and notes pick it up (move it, tap to flip/edit) instead of drawing on it
      const grabs = tool === 'select' || ['pen', 'hl', 'line', 'text', 'note'].includes(tool);
      const hit = grabs ? (onHandle(pt) ? 'x' : objAt(pt)) : null;
      if (tool === 'select' || hit) {
        e.preventDefault();
        live.setPointerCapture(e.pointerId);
        skipClick = !!hit;
        if (hit === 'x') { removeObj(sel); return; }
        sel = hit;
        if (hit) { drag = { s: hit, dx: pt[0] - hit.x, dy: pt[1] - hit.y, at: pt, moved: false }; hit.z = ++zTop; glide.delete(hit.id); }
        redrawObjs();
        return;
      }
      if (sel) { sel = null; redrawObjs(); }
      if (tool === 'text' || tool === 'note' || tool === 'place') return; // placed on click (below) so a new box keeps focus
      live.setPointerCapture(e.pointerId);
      if (tool === 'laser') { laserDown = true; laserAdd('me', myColor, pt[0], pt[1], true); track(pt, 2); return; }
      drawing = { tool, color, size: size * scaleK(), points: [pt] };
      redo.length = 0;
      if (tool === 'eraser') { strokes.push(drawing); redraw(); }
      track(pt);
    });
    live.addEventListener('pointermove', (e) => {
      const pt = toBoard(e);
      if (drag) {
        const s = drag.s;
        if (!drag.moved && Math.hypot(pt[0] - drag.at[0], pt[1] - drag.at[1]) < 6 * scaleK()) return;
        drag.moved = true;
        s.x = clamp(pt[0] - drag.dx, -s.w * 0.6, W - s.w * 0.4); s.y = clamp(pt[1] - drag.dy, -s.h * 0.6, H - s.h * 0.4);
        redrawObjs(); track(pt);
        return;
      }
      if (laserDown) {
        (e.getCoalescedEvents ? e.getCoalescedEvents() : [e]).forEach((pe) => { const q = toBoard(pe); laserAdd('me', myColor, q[0], q[1], false); });
        track(pt, 1);
        return;
      }
      if (!drawing && ['select', 'pen', 'hl', 'line', 'text', 'note'].includes(tool)) live.style.cursor = objAt(pt) ? 'grab' : toolCursor(tool);
      track(pt);
      if (!drawing) return;
      const pts = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      pts.forEach((pe) => drawing.points.push(toBoard(pe)));
      if (drawing.tool === 'eraser') { redraw(); return; }
      const x = live.getContext('2d');
      x.clearRect(0, 0, W, H);
      paint(x, drawing);
    });
    const end = () => {
      if (drag) {
        const d = drag;
        drag = null;
        if (d.moved) {
          const s = d.s;
          if (s.tool === 'note' && grid) { const st = Math.round(Math.min(W, H) / 40); s.x = Math.round(s.x / st) * st; s.y = Math.round(s.y / st) * st; }
          sendUpdate(s);
        } else if (d.s.tool === 'card') flipCard(d.s);
        else if (d.s.tool === 'note' && editable(d.s)) editNote(d.s);
        redrawObjs();
        return;
      }
      if (laserDown) { laserDown = false; return; }
      if (!drawing) return;
      const d = drawing;
      if (d.tool !== 'eraser') strokes.push(d);
      drawing = null;
      live.getContext('2d').clearRect(0, 0, W, H);
      redraw();
      share(d);
    };
    live.addEventListener('pointerup', end);
    live.addEventListener('click', (e) => {
      if (skipClick) { skipClick = false; return; } // that press was on a note or card
      const pt = toBoard(e);
      if (tool === 'text') placeText(e, pt);
      else if (tool === 'note') {
        const hit = objAt(pt);
        if (!hit) newNote(pt);
        else if (hit.tool === 'note' && editable(hit)) { sel = hit; editNote(hit); }
        else if (hit.tool === 'card') flipCard(hit);
      } else if (tool === 'place' && pendingTpl) placeTemplate(pendingTpl, pt);
    });
    live.addEventListener('pointercancel', end);
    live.addEventListener('pointerleave', () => { if (room && !drawing && !drag && !laserDown && !editing) { pres.gone = true; pres.dirty = true; } });

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
      editing = true; track(pt);
      const commit = () => {
        editing = false;
        const text = ta.innerText.replace(/\n+$/, '');
        ta.remove();
        if (!text.trim()) return;
        const st = { tool: 'text', color, size: px * (W / r.width), x: pt[0], y: pt[1], text };
        strokes.push(st);
        redo.length = 0; redraw();
        share(st);
      };
      ta.addEventListener('blur', commit, { once: true });
      ta.addEventListener('keydown', (k) => {
        k.stopPropagation();
        if (k.key === 'Enter' && !k.shiftKey) { k.preventDefault(); ta.blur(); }
        if (k.key === 'Escape') { ta.innerText = ''; ta.blur(); }
      });
    }

    // ---- small panels under the toolbar: notes, flashcards, shapes, save ----
    let pop = null;
    function closePop() { if (pop) { pop.remove(); pop = null; } }
    function openPop(kind, html) {
      closePop();
      pop = document.createElement('div');
      pop.className = 'csk-pop'; pop.dataset.kind = kind; pop.innerHTML = html;
      const tools = $('.csk-tools');
      pop.style.top = (tools.offsetTop + tools.offsetHeight + 6) + 'px';
      $('.csk-panel').appendChild(pop);
      pop.addEventListener('keydown', (k) => { k.stopPropagation(); if (k.key === 'Escape') closePop(); });
      return pop;
    }
    function notePop() {
      openPop('note', `<h4>Sticky notes</h4><p>Pick a colour, then tap the board to add a note${myName ? ' (it shows your name)' : ''}. Tap a note to change it; drag notes with the Move tool.</p>
        <div class="csk-row">${NOTE_COLORS.map(([c, n]) => `<button class="csk-nc${c === noteColor ? ' on' : ''}" data-pop="nc" data-c="${c}" title="${n}" aria-label="${n} note" style="background:${c}"></button>`).join('')}</div>
        <div class="csk-row"><button class="csk-btn" data-pop="tidy">Sort notes into colour groups</button></div>`);
    }
    function cardsPop() {
      let decks = [];
      try { decks = (opts.decks ? opts.decks() : []).filter((d) => d && d.cards && d.cards.length).slice(0, 12); } catch (e) { decks = []; }
      openPop('cards', `<h4>Flashcards on the board</h4><p>Paste a deck: one card per line, front and back split by a dash, tab or colon. Everyone can flip and move them.</p>
        <textarea class="csk-deck" aria-label="Cards to drop" placeholder="Mitochondria, makes the cell’s energy (ATP)&#10;Osmosis, water moving across a membrane"></textarea>
        <div class="csk-row"><button class="csk-btn primary" data-pop="drop">Drop these cards</button></div>
        ${opts.makeCards ? '<div class="csk-or">or let Cassie write them</div><div class="csk-row"><input class="csk-topic" aria-label="Topic" placeholder="A topic, e.g. the water cycle"><button class="csk-btn" data-pop="make">Make with Cassie</button></div>' : ''}
        ${decks.length ? `<div class="csk-or">or one of your decks</div><div class="csk-list">${decks.map((d, i) => `<button class="csk-btn" data-pop="deck" data-i="${i}">${esc(d.name)} · ${d.cards.length} cards</button>`).join('')}</div>` : ''}
        <p class="csk-poperr" hidden></p>`);
      pop._decks = decks;
      setTimeout(() => pop && pop.querySelector('textarea').focus(), 30);
    }
    function shapesPop() {
      openPop('shapes', `<h4>Quick shapes</h4><p>Pick one, then tap where it should go. Draw on top of it.</p>
        <div class="csk-list">${TEMPLATES.map(([k, n]) => `<button class="csk-btn" data-pop="tpl" data-k="${k}">${n}</button>`).join('')}</div>`);
    }
    // PDF and board files are Plus extras where the app says so (opts.premium); a picture is always free
    const plusLocked = () => !!(opts.premium && !opts.premium.has());
    function savePop() {
      const plus = plusLocked() ? ' · Plus' : '';
      openPop('save', `<h4>Save the board</h4><div class="csk-list">
        <button class="csk-btn" data-pop="png">Picture (PNG)</button>
        <button class="csk-btn" data-pop="pdf">PDF${plus}</button>
        <button class="csk-btn" data-pop="json">Board file (.json). Open it again later${plus}</button>
        <button class="csk-btn" data-pop="open">Open a board file…${plus}</button></div>`);
    }
    function popErr(msg) { const el = pop && pop.querySelector('.csk-poperr'); if (el) { el.hidden = false; el.textContent = msg; } }
    async function popAct(b) {
      const a = b.dataset.pop;
      if (a === 'nc') { noteColor = b.dataset.c; closePop(); toast('Tap the board to add a note'); return; }
      if (a === 'tidy') { closePop(); tidyNotes(); return; }
      if (a === 'drop') {
        const list = parseDeck(pop.querySelector('textarea').value);
        if (!list.length) { popErr('Put one card per line, like “Osmosis: water moving across a membrane”.'); return; }
        closePop(); dropCards(list); return;
      }
      if (a === 'deck') { const d = (pop._decks || [])[+b.dataset.i]; closePop(); if (d) dropCards(d.cards); return; }
      if (a === 'make') {
        const input = pop.querySelector('.csk-topic'), topic = input.value.trim();
        if (!topic) { input.focus(); return; }
        b.disabled = true; b.textContent = 'Cassie is writing them…';
        try {
          const list = await opts.makeCards(topic);
          if (!list || !list.length) throw new Error('Cassie couldn’t make cards for that. Try another topic.');
          closePop(); dropCards(list);
        } catch (err) { if (pop) { b.disabled = false; b.textContent = 'Make with Cassie'; popErr((err && err.message) || 'Couldn’t reach Cassie. Try again.'); } }
        return;
      }
      if (a === 'tpl') { closePop(); setTool('place'); pendingTpl = b.dataset.k; toast('Tap the board where it should go'); return; }
      closePop();
      if ((a === 'pdf' || a === 'json' || a === 'open') && plusLocked()) { opts.premium.ask(a === 'pdf' ? 'Saving the board as a PDF' : 'Board files'); return; }
      if (a === 'png') download(snapshot(), fileName('png'));
      else if (a === 'pdf') { const u = URL.createObjectURL(pdfFromJpeg(composite().toDataURL('image/jpeg', 0.92), W, H)); download(u, fileName('pdf')); setTimeout(() => URL.revokeObjectURL(u), 5000); }
      else if (a === 'json') { const u = URL.createObjectURL(new Blob([JSON.stringify(boardData())], { type: 'application/json' })); download(u, fileName('json')); setTimeout(() => URL.revokeObjectURL(u), 5000); }
      else if (a === 'open') $('.csk-boardfile').click();
    }
    let toastT = 0;
    function toast(msg) {
      let el = stage.querySelector('.csk-toast');
      if (!el) { el = document.createElement('div'); el.className = 'csk-toast'; el.setAttribute('role', 'status'); stage.appendChild(el); }
      el.textContent = msg; el.style.opacity = '1';
      clearTimeout(toastT); toastT = setTimeout(() => { el.style.opacity = '0'; }, 2600);
    }
    function download(href, name) {
      const a = document.createElement('a');
      a.href = href; a.download = name;
      (document.body || document.documentElement).appendChild(a); a.click(); a.remove();
    }
    const fileName = (ext) => `cassie-board-${new Date().toISOString().slice(0, 10)}.${ext}`;
    // the whole board as a file: open it again later (or in a room, add it for everyone)
    function boardData() {
      let image = null;
      if (bgImage) { try { const c = document.createElement('canvas'); c.width = W; c.height = H; c.getContext('2d').drawImage(bgImage, 0, 0, W, H); image = c.toDataURL('image/jpeg', 0.88); } catch (e) { image = null; } }
      return { cassie: 'board', v: 1, title: $('.csk-title').textContent, w: W, h: H, grid, image, strokes: strokes.map(pack) };
    }
    async function openBoardFile(f) {
      let d;
      try { d = JSON.parse(await f.text()); } catch (e) { d = null; }
      if (!d || d.cassie !== 'board' || !Array.isArray(d.strokes)) { toast('That isn’t a Cassie board file'); return; }
      const list = d.strokes.map((x) => cleanStroke(x)).filter(Boolean).slice(0, 3000);
      if (room) {
        if (!list.length || !confirm(`Add the ${list.length} drawings, notes and cards from this file to the room? Everyone here will see them.`)) return;
        list.forEach((st) => { st.id = rid(); delete st.u; st.z = ++zTop; strokes.push(st); share(st); });
        redo.length = 0; redraw(); toast('Added to the board for everyone');
        return;
      }
      if (strokes.length && !confirm('Open this board file? What’s on your board now will be replaced.')) return;
      const img = typeof d.image === 'string' && /^data:image\//.test(d.image) ? await loadImage(d.image) : null;
      bgImage = img; grid = img ? false : d.grid !== false;
      fixedSize = img ? null : { w: clamp(num(d.w, 1600) | 0, 200, 4000), h: clamp(num(d.h, 1000) | 0, 150, 4000) };
      strokes.length = 0; redo.length = 0; sel = null;
      list.forEach((st) => { st.z = ++zTop; strokes.push(st); });
      setSize(); drawBg(); redraw();
      toast('Board opened');
    }
    $('.csk-boardfile').addEventListener('change', (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) openBoardFile(f); });
    const toolCursor = (name) => ({ text: 'text', select: 'default', note: 'copy', place: 'copy' }[name] || 'crosshair');
    function setTool(name) {
      tool = name;
      wrap.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === name));
      $('[data-act="shapes"]').classList.toggle('on', name === 'place');
      live.style.cursor = toolCursor(name);
      if (name !== 'select' && sel) { sel = null; redrawObjs(); }
      if (name !== 'place') pendingTpl = null;
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
      if (t.dataset.pop) { popAct(t); return; }
      if (t.dataset.tool) {
        // tap a tool that's already on to switch it off: back to Move, so a drag never draws by accident
        if (t.dataset.tool === tool && tool !== 'select') { setTool('select'); closePop(); toast('Drawing is off. Drag notes and cards freely, or tap a tool to draw again'); return; }
        setTool(t.dataset.tool);
        if (tool === 'hl' && (color === '#1b1b1d' || color === '#ffffff')) { color = '#f2c200'; syncInk(); }
        if (tool === 'note') { if (pop && pop.dataset.kind === 'note') closePop(); else notePop(); } else closePop();
        return;
      }
      if (t.dataset.ink) { color = t.dataset.ink; syncInk(); if (['eraser', 'select', 'laser', 'place', 'note'].includes(tool)) setTool('pen'); return; }
      if (t.dataset.size) { size = +t.dataset.size; sizesEl.querySelectorAll('.csk-size').forEach((b) => b.classList.toggle('on', b === t)); return; }
      const act = t.dataset.act;
      const again = pop && pop.dataset.kind === act;
      if (act !== 'check' && act !== 'dock') closePop();
      if ((act === 'cards' || act === 'shapes' || act === 'save') && again) return;
      if (act === 'cards') cardsPop();
      else if (act === 'shapes') shapesPop();
      else if (act === 'close') close();
      else if (act === 'undo') {
        if (room) { // your own last stroke
          for (let i = strokes.length - 1; i >= 0; i--) if (strokes[i].mine) { const [st] = strokes.splice(i, 1); redo.push(st); room.send({ t: 'del', ids: [st.id] }); redraw(); break; }
        } else if (strokes.length) { redo.push(strokes.pop()); redraw(); }
      }
      else if (act === 'redo') { if (redo.length) { const st = redo.pop(); strokes.push(st); if (room) room.send({ t: 'add', s: pack(st) }); redraw(); } }
      else if (act === 'clear') {
        if (room) {
          const mine = strokes.filter((x) => x.mine);
          if (mine.length && confirm('Clear what you drew? Your classmates’ drawings stay.')) {
            for (let i = strokes.length - 1; i >= 0; i--) if (strokes[i].mine) strokes.splice(i, 1);
            redo.length = 0; redraw(); room.send({ t: 'del', ids: mine.map((x) => x.id) });
          }
        } else if (strokes.length && confirm('Clear everything you drew?')) { strokes.length = 0; redo.length = 0; redraw(); }
      }
      else if (act === 'grid') { grid = !grid; drawBg(); }
      else if (act === 'pic') $('.csk-picfile').click();
      else if (act === 'save') savePop();
      else if (act === 'dock') {
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
          showNote({ reply: (err && err.message) || 'Couldn’t reach Cassie. Try again.' });
        } finally { t.disabled = false; label.textContent = was; }
      }
    });
    // Put a picture on the board: from the picture button, a paste (Ctrl+V — e.g. after
    // Win+Shift+S / Cmd+Shift+4), or a drag-and-drop.
    async function useImageSource(url, { ask = true } = {}) {
      const img = await loadImage(url);
      if (!img) return false;
      if (ask && strokes.length && !confirm('Start over on this picture? Your current drawing will be cleared.')) return false;
      bgImage = img; grid = false; strokes.length = 0; redo.length = 0; sel = null;
      setSize(); drawBg(); redraw();
      if (opts.onImage) { try { opts.onImage(typeof url === 'string' ? url : null, img); } catch (e) { /* ignore */ } }
      return true;
    }
    const fileToUrl = (f) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => res(null); r.readAsDataURL(f); });
    $('.csk-picfile').addEventListener('change', async (e) => {
      const f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (f) useImageSource(await fileToUrl(f));
    });
    function onPaste(e) {
      if (room) return; // a room shares drawings only
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

    // Cassie's replies come with light markdown — show **bold** as real bold and
    // "- " lines as a list, never the raw asterisks.
    const escHtml = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    function mdInline(t) {
      return escHtml(t)
        .replace(/\*\*\*([^*\n]+)\*\*\*/g, '<strong>$1</strong>')
        .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
        .replace(/__([^_\n]+)__/g, '<strong>$1</strong>')
        .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
        .replace(/`([^`\n]+)`/g, '<code>$1</code>')
        .replace(/\*{2,}/g, ''); // stray, unpaired markers
    }
    function mdBlock(text) {
      const out = document.createElement('div');
      out.className = 'csk-reply';
      let list = null;
      String(text).replace(/\r/g, '').split('\n').forEach((line) => {
        const t = line.trim();
        const li = t.match(/^(?:[-*•]|\d+[.)])\s+(.*)$/);
        if (li) {
          const tag = /^\d/.test(t) ? 'OL' : 'UL';
          if (!list || list.tagName !== tag) { list = document.createElement(tag); out.appendChild(list); }
          const item = document.createElement('li'); item.innerHTML = mdInline(li[1]); list.appendChild(item);
          return;
        }
        list = null;
        if (!t) return;
        const p = document.createElement('p');
        const h = t.match(/^#{1,6}\s+(.*)$/);
        p.innerHTML = h ? `<strong>${mdInline(h[1].replace(/\*\*/g, ''))}</strong>` : mdInline(t);
        out.appendChild(p);
      });
      return out;
    }
    function showNote(n) {
      if (!n) { note.hidden = true; return; }
      note.hidden = false;
      note.innerHTML = '';
      if (n.headline) { const b = document.createElement('b'); b.innerHTML = mdInline(String(n.headline).replace(/\*\*/g, '')); note.appendChild(b); }
      if (n.steps && n.steps.length) {
        const ol = document.createElement('ol');
        n.steps.forEach((s) => { const li = document.createElement('li'); li.innerHTML = mdInline(s); ol.appendChild(li); });
        note.appendChild(ol);
      }
      if (n.reply) note.appendChild(mdBlock(n.reply));
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
        try {
          const out = await opts.onAsk(snapshot(), q, parts());
          const reply = out && typeof out === 'object' ? out.reply : out;
          if (out && typeof out === 'object' && out.draw) draw(out.draw);
          showNote({ reply: reply || (out && out.draw ? 'Drawn on your board ✏️' : '(no reply)') }); input.value = '';
        }
        catch (err) { showNote({ reply: (err && err.message) || 'Couldn’t reach Cassie. Try again.' }); }
        finally { btn.disabled = false; btn.textContent = 'Ask'; }
      });
      askForm.addEventListener('keydown', (e) => e.stopPropagation());
    }
    // ---- Cassie draws on the board: a graph, a shape or worked steps, in her own blue ----
    const CASSIE_INK = '#2563eb';
    function draw(spec) {
      if (!spec || typeof spec !== 'object') return false;
      const B = window.CassieBoard;
      const items = [];
      const k = W / 1600, fs = Math.round(30 * k);
      // with a picture underneath, she draws on a card beside it; on a blank page, across it
      const box = bgImage ? { x: W * 0.5, y: H * 0.05, w: W * 0.47, h: H * 0.9 } : { x: W * 0.06, y: H * 0.06, w: W * 0.88, h: H * 0.88 };
      if (bgImage) items.push({ tool: 'rect', x: box.x, y: box.y, w: box.w, h: box.h, r: 18 * k, fill: dark ? 'rgba(29,29,32,.96)' : 'rgba(255,255,255,.96)', color: 'rgba(37,99,235,.35)', size: 3 * k });
      const ink = dark ? '#e5e7eb' : '#374151', soft = dark ? '#9ca3af' : '#6b7280';
      const text = (t, x, y, size = fs, color = ink) => items.push({ tool: 'text', color, size, x, y, text: String(t) });
      const pen = (pts, color = CASSIE_INK, size = 5 * k) => { if (pts.length) items.push({ tool: 'pen', color, size, points: pts }); };
      const pretty = (t) => String(t).replace(/\*/g, '·').replace(/\^2/g, '²').replace(/\^3/g, '³');
      let top = box.y + 20 * k;
      if (spec.title) { text(pretty(spec.title), box.x + 24 * k, top, Math.round(fs * 1.15), CASSIE_INK); top += fs * 1.9; }
      if (spec.type === 'graph' || spec.fn) {
        if (!B || !B.compile) return false;
        let f; try { f = B.compile(spec.fn); } catch (e) { return false; }
        const [x0, x1] = spec.xrange && spec.xrange.length === 2 ? spec.xrange : (B.autoRange ? B.autoRange(spec.fn) : [-6, 6]);
        const N = 600, xs = [], ys = [];
        for (let i = 0; i <= N; i++) { const x = x0 + (x1 - x0) * i / N; xs.push(x); ys.push(f(x)); }
        let y0, y1;
        if (spec.yrange && spec.yrange.length === 2) [y0, y1] = spec.yrange;
        else {
          const ok = ys.filter((y) => isFinite(y)).sort((a, b) => a - b);
          y0 = ok[Math.floor(ok.length * 0.02)] || -5; y1 = ok[Math.floor(ok.length * 0.98)] || 5;
          (spec.points || []).forEach((p) => { y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); });
          y0 = Math.min(y0, 0); y1 = Math.max(y1, 0);
          const pad = (y1 - y0) * 0.12 || 1; y0 -= pad; y1 += pad;
        }
        const pl = { x: box.x + 60 * k, y: top + 10 * k, w: box.w - 100 * k, h: box.y + box.h - top - 70 * k };
        const X = (x) => pl.x + (x - x0) / (x1 - x0) * pl.w, Y = (y) => pl.y + (1 - (y - y0) / (y1 - y0)) * pl.h;
        // axes, ticks and numbers
        const ax = y0 <= 0 && y1 >= 0 ? Y(0) : pl.y + pl.h, ay = x0 <= 0 && x1 >= 0 ? X(0) : pl.x;
        pen([[pl.x, ax], [pl.x + pl.w, ax]], soft, 3 * k); pen([[ay, pl.y], [ay, pl.y + pl.h]], soft, 3 * k);
        const nice = (span) => { const raw = span / 8, p = Math.pow(10, Math.floor(Math.log10(raw))); return [1, 2, 5, 10].map((m) => m * p).find((v) => v >= raw) || raw; };
        const sx = nice(x1 - x0), sy = nice(y1 - y0), small = Math.round(fs * 0.7);
        for (let x = Math.ceil(x0 / sx) * sx; x <= x1 + 1e-9; x += sx) { if (Math.abs(x) < 1e-9) continue; pen([[X(x), ax - 8 * k], [X(x), ax + 8 * k]], soft, 2 * k); text(+x.toFixed(4), X(x) - small * 0.4, ax + 12 * k, small, soft); }
        for (let y = Math.ceil(y0 / sy) * sy; y <= y1 + 1e-9; y += sy) { if (Math.abs(y) < 1e-9) continue; pen([[ay - 8 * k, Y(y)], [ay + 8 * k, Y(y)]], soft, 2 * k); text(+y.toFixed(4), ay + 12 * k, Y(y) - small * 0.5, small, soft); }
        // the curve, in pieces wherever it leaves the picture or breaks
        let seg = [];
        for (let i = 0; i <= N; i++) {
          const y = ys[i];
          if (!isFinite(y) || y < y0 - (y1 - y0) * 0.05 || y > y1 + (y1 - y0) * 0.05) { if (seg.length > 1) pen(seg); seg = []; continue; }
          seg.push([X(xs[i]), Y(y)]);
        }
        if (seg.length > 1) pen(seg);
        // marked points (zeros, vertex…)
        const marks = [...(spec.points || []), ...(spec.vertex ? [{ ...spec.vertex, label: spec.vertex.label || 'vertex' }] : [])];
        marks.forEach((p) => { if (!isFinite(p.x) || !isFinite(p.y)) return; pen([[X(p.x), Y(p.y)]], '#dc2626', 18 * k); if (p.label) text(p.label, X(p.x) + 14 * k, Y(p.y) - fs * 1.1, Math.round(fs * 0.75), '#dc2626'); });
        if (spec.caption) text(spec.caption, box.x + 24 * k, box.y + box.h - fs * 1.4, Math.round(fs * 0.8), soft);
      } else if (spec.type === 'shape') {
        const cx = box.x + box.w / 2, cy = top + (box.y + box.h - top) / 2, R = Math.min(box.w, box.y + box.h - top) * 0.32;
        const sh = String(spec.shape || '').toLowerCase();
        if (sh === 'circle') {
          const pts = []; for (let a = 0; a <= 72; a++) pts.push([cx + R * Math.cos(a / 72 * Math.PI * 2), cy + R * Math.sin(a / 72 * Math.PI * 2)]);
          pen(pts); pen([[cx, cy], [cx + R, cy]], soft, 3 * k); text(`r = ${spec.r ?? ''}`, cx + R * 0.25, cy - fs * 1.2);
        } else if (sh === 'triangle') {
          pen([[cx - R, cy + R * 0.7], [cx + R, cy + R * 0.7], [cx, cy - R * 0.8], [cx - R, cy + R * 0.7]]);
          if (spec.base != null) text(`base = ${spec.base}`, cx - fs * 2, cy + R * 0.7 + 12 * k);
          if (spec.height != null) { pen([[cx, cy - R * 0.8], [cx, cy + R * 0.7]], soft, 3 * k); text(`h = ${spec.height}`, cx + 10 * k, cy); }
        } else {
          const w = sh === 'square' ? spec.side || 1 : spec.w || 2, h = sh === 'square' ? spec.side || 1 : spec.h || 1;
          const s2 = R * 1.6 / Math.max(w, h), hw = w * s2 / 2, hh = h * s2 / 2;
          pen([[cx - hw, cy - hh], [cx + hw, cy - hh], [cx + hw, cy + hh], [cx - hw, cy + hh], [cx - hw, cy - hh]]);
          text(w, cx - fs * 0.3, cy + hh + 12 * k); text(h, cx + hw + 14 * k, cy - fs * 0.5);
        }
      } else if (Array.isArray(spec.steps)) {
        let y = top;
        spec.steps.slice(0, 12).forEach((st, i) => { text(`${i + 1}.  ${pretty(st)}`, box.x + 30 * k, y, fs, i === spec.steps.length - 1 ? CASSIE_INK : ink); y += fs * 1.7; });
      } else return false;
      const g = { tool: 'group', by: 'cassie', items };
      strokes.push(g);
      redo.length = 0;
      redraw();
      share(g); // classmates in a room see what Cassie drew too
      return true;
    }
    // classmates' drawing steps (a list of { op, uid }), in the order the server got them
    function remote(list) {
      let changed = false;
      for (const { op, uid } of list) {
        if (!op) continue;
        // who drew a stroke is who the server got it from (not what the stroke claims), and
        // a classmate can only erase their own strokes
        if (op.t === 'add' && op.s && op.s.id) {
          const have = strokes.find((x) => x.id === op.s.id);
          if (have) { // already here (it's yours) — or a note/card that someone moved, flipped or changed
            if (!op.up || !isObj(have) || (drag && drag.s === have)) continue;
            if (room && uid === room.me && op.v !== ver.get(have.id)) continue; // an older echo of your own move
            const n = cleanStroke(op.s);
            if (!n || n.tool !== have.tool) continue;
            if (n.x !== have.x || n.y !== have.y) { glide.set(have.id, { x: have.x, y: have.y, t0: performance.now() }); have.x = n.x; have.y = n.y; }
            if (have.tool === 'card' && n.flip !== have.flip) { have.flip = n.flip; flipAnim.set(have.id, performance.now()); }
            if (have.tool === 'note' && uid && uid === have.u && !have._editing) { have.text = n.text; have.color = n.color; } // only the writer changes the words
            have.z = ++zTop; changed = true;
            continue;
          }
          if (op.up) continue; // a move of something that's gone
          const st = cleanStroke(op.s);
          if (!st) continue;
          const u = uid || st.u;
          strokes.push({ ...st, u, z: ++zTop, mine: !!(room && u === room.me) }); changed = true;
        } else if (op.t === 'del' && Array.isArray(op.ids) && uid) {
          const ids = new Set(op.ids);
          for (let i = strokes.length - 1; i >= 0; i--) if (ids.has(strokes[i].id) && strokes[i].u === uid) { strokes.splice(i, 1); changed = true; }
        }
      }
      if (changed) redraw();
    }
    function setRoom(html) { const el = $('.csk-room'); el.hidden = !html; el.innerHTML = html || ''; return el; }
    function setTitle(t) { $('.csk-title').textContent = t || 'Board'; }
    // The board as plain data (original picture + strokes). Reading pixels back from
    // a page canvas comes out blank on some machines' graphics drivers, so callers
    // that can (the extension) rebuild the picture from this instead.
    function parts() {
      const src = bgImage && bgImage.src && /^data:image\//.test(bgImage.src) ? bgImage.src : null;
      // notes and cards go as a card shape plus lines of words, so anything that draws strokes can draw them
      const asGroup = (s) => ({ tool: 'group', obj: s.tool, text: s.text, n: s.n, f: s.f, b: s.b, flip: !!s.flip, items: objPieces(s, !!s.flip).map((it) => ({ ...it, x: it.x + s.x, y: it.y + s.y })) });
      return { image: src, strokes: strokes.map((s) => (isObj(s) ? asGroup(s) : { ...s, points: s.points ? s.points.map((p) => [p[0], p[1]]) : undefined })), w: W, h: H, paper };
    }
    function composite() {
      const was = sel; sel = null; redrawObjs(); // no selection box in the picture
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const x = c.getContext('2d');
      x.drawImage(bg, 0, 0); x.drawImage(ink, 0, 0); x.drawImage(obj, 0, 0);
      sel = was; if (was) redrawObjs();
      return c;
    }
    function snapshot() { return composite().toDataURL('image/png'); }
    function onKey(e) {
      if (e.target && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName || ''))) return;
      if (e.key === 'Escape') { e.stopPropagation(); if (pop) closePop(); else if (tool === 'place') setTool('pen'); else close(); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && sel && editable(sel) && strokes.includes(sel)) { e.preventDefault(); removeObj(sel); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); $(e.shiftKey ? '[data-act="redo"]' : '[data-act="undo"]').click(); }
    }
    function close() {
      closePop(); cancelAnimationFrame(fxRaf); cancelAnimationFrame(curRaf); cancelAnimationFrame(objRaf);
      window.removeEventListener('resize', fit);
      if (refit) refit.disconnect();
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('paste', onPaste, true);
      wrap.remove();
      if (current && current.wrap === wrap) current = null;
      if (opts.onClose) opts.onClose();
    }
    // click on the dim backdrop (full mode) closes only if nothing was drawn
    wrap.addEventListener('pointerdown', (e) => { if (e.target === wrap && !strokes.length) close(); });

    window.addEventListener('resize', fit);
    // (and when its own area changes: the study panel opening, the toolbar wrapping to two rows)
    const refit = window.ResizeObserver ? new ResizeObserver(() => fit()) : null;
    if (refit) refit.observe(stage);
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
    current = { wrap, close, snapshot, showNote, setTitle, draw, remote, setRoom, parts, presence, others, dropCards, toast,
      objects: () => strokes.filter(isObj).map(pack), strokeCount: () => strokes.length, drawn: () => strokes.filter((x) => x.by === 'cassie').length, setImage: (u) => useImageSource(u, { ask: false }) };
    return current;
  }

  window.CassieSketch = { open, isOpen: () => !!current, close: () => current && current.close(), session: () => current };
})();

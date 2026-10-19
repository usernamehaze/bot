/* Teach me and Ask Cassie on any web page.
 * Cassie teaches what the student has open, step by step: each step is shown in a small card (and
 * said aloud when Voice is on), her Cursor Cassie arrow glides to what she's talking about, and she
 * can draw on a see-through layer over the page: circles, boxes, underlines, highlights, arrows,
 * lines, curves, polygons, small graphs and labels. She only ever points and draws: nothing on the
 * page is clicked, typed or sent.
 *
 * One file, two homes:
 *  - on a web page (a content script): CASSIE_TEACH_SCAN numbers what's on screen for her,
 *    CASSIE_TEACH_SHOW runs a lesson over the page (or inside a snipped area), CASSIE_TEACH_STOP ends it.
 *  - in the side panel: CassieTeach.show({ mount, image }) runs the same lesson on a picture of the
 *    tab, for pages the extension can't draw on (the browser's own pages, its PDF viewer).
 * Drawing uses the board's own painter (CassieSketch.paint, sketch.js), and graphs its formula
 * reader (CassieBoard.compile, board.js).
 *
 *   CassieTeach.parse(reply, count) → steps [{ say, point, draw }] from Cassie's JSON (bad steps and
 *     shapes are left out). point: { el } (a numbered part), { x, y } (shares of the picture, 0 to 1),
 *     { selector } or null.
 */
(function () {
  'use strict';
  if (window.CassieTeach) return;

  const HOST_ID = 'cassie-teach-host-92f1';
  const INK = '#141416', HALO = '#ffffff', PAST = '#b4b4ba'; // (earlier steps fade to light grey, like a whiteboard)
  const ARROW = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3l14 7-6.2 1.8L10 18z"/></svg>';
  const SHAPES = ['circle', 'box', 'underline', 'highlight', 'arrow', 'line', 'curve', 'polygon', 'graph', 'text'];

  /* ---------- reading Cassie's answer: only what makes sense is kept ---------- */
  const share = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= -0.05 && v <= 1.05 ? Math.max(0, Math.min(1, v)) : null);
  const pair = (p) => (Array.isArray(p) && p.length === 2 && share(p[0]) != null && share(p[1]) != null ? [share(p[0]), share(p[1])] : null);
  function cleanPoint(p, count) {
    if (typeof p === 'number' || (typeof p === 'string' && /^\d+$/.test(p))) { const n = +p; return n >= 1 && n <= count ? { el: n } : null; }
    if (!p || typeof p !== 'object') return null;
    if (p.el != null) { const n = +p.el; return n >= 1 && n <= count ? { el: n } : null; }
    if (share(p.x) != null && share(p.y) != null) return { x: share(p.x), y: share(p.y) };
    if (typeof p.selector === 'string' && p.selector.length < 200) return { selector: p.selector };
    return null;
  }
  function cleanShape(d, count) {
    if (!d || typeof d !== 'object' || !SHAPES.includes(d.shape)) return null;
    const el = d.el != null && +d.el >= 1 && +d.el <= count ? +d.el : null;
    const at = { x: share(d.x), y: share(d.y) };
    const box = at.x != null && at.y != null && share(d.w) != null && share(d.h) != null ? { x: at.x, y: at.y, w: share(d.w), h: share(d.h) } : null;
    const pts = Array.isArray(d.points) ? d.points.slice(0, 40).map(pair).filter(Boolean) : [];
    switch (d.shape) {
      case 'circle':
        if (el) return { shape: 'circle', el };
        if (at.x != null && at.y != null) return { shape: 'circle', x: at.x, y: at.y, r: Math.max(0.01, Math.min(0.5, share(d.r) || 0.05)) };
        return null;
      case 'box': case 'highlight':
        if (el) return { shape: d.shape, el };
        return box && box.w > 0 && box.h > 0 ? { shape: d.shape, ...box } : null;
      case 'underline':
        if (el) return { shape: 'underline', el };
        return at.x != null && at.y != null && share(d.w) ? { shape: 'underline', x: at.x, y: at.y, w: share(d.w) } : null;
      case 'arrow': case 'line': {
        const to = pair(d.to), from = pair(d.from);
        const toEl = d.to_el != null && +d.to_el >= 1 && +d.to_el <= count ? +d.to_el : null;
        if (d.shape === 'arrow' && toEl) return { shape: 'arrow', toEl, from };
        return from && to ? { shape: d.shape, from, to } : null;
      }
      case 'curve': return pts.length >= 2 ? { shape: 'curve', points: pts } : null;
      case 'polygon': return pts.length >= 3 ? { shape: 'polygon', points: pts } : null;
      case 'graph': {
        const fn = typeof d.fn === 'string' ? d.fn.trim().slice(0, 80) : '';
        if (!fn || !box || box.w < 0.05 || box.h < 0.05) return null;
        try { const f = window.CassieBoard.compile(fn); if (!Number.isFinite(f(0.5)) && !Number.isFinite(f(1.5))) return null; } catch (e) { return null; }
        const xr = Array.isArray(d.xrange) && d.xrange.length === 2 && d.xrange.every(Number.isFinite) && d.xrange[0] < d.xrange[1] ? d.xrange : [-5, 5];
        return { shape: 'graph', fn, xrange: xr, ...box };
      }
      case 'text': {
        const t = typeof d.text === 'string' ? d.text.replace(/\s+/g, ' ').trim().slice(0, 60) : '';
        return t && at.x != null && at.y != null ? { shape: 'text', x: at.x, y: at.y, text: t } : null;
      }
    }
    return null;
  }
  // the end of the {…} or […] that starts at i (strings skipped), or -1 when it is cut off
  function closeOf(t, i) {
    let depth = 0, inStr = false, esc = false;
    for (let j = i; j < t.length; j++) {
      const c = t[j];
      if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === '{' || c === '[') depth++;
      else if ((c === '}' || c === ']') && --depth === 0) return j;
    }
    return -1;
  }
  // Cassie's JSON, read kindly: with words around it, or cut off at the length limit (the steps
  // that arrived whole are kept)
  function jsonOf(reply) {
    const t = String(reply || '').replace(/```(?:json)?/gi, '');
    const i = t.indexOf('{');
    if (i < 0) return null;
    const j = closeOf(t, i);
    if (j > 0) { try { return JSON.parse(t.slice(i, j + 1)); } catch (e) { /* salvage below */ } }
    const s = t.search(/"steps"\s*:\s*\[/);
    if (s < 0) return null;
    const steps = [];
    for (let k = t.indexOf('[', s) + 1; k < t.length;) {
      while (k < t.length && /[\s,]/.test(t[k])) k++;
      if (t[k] !== '{') break;
      const e = closeOf(t, k);
      if (e < 0) break; // (the step that was cut off)
      try { steps.push(JSON.parse(t.slice(k, e + 1))); } catch (err) { break; }
      k = e + 1;
    }
    const a = t.match(/"answer"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    let answerText = '';
    if (a) { try { answerText = JSON.parse('"' + a[1] + '"'); } catch (e) { answerText = ''; } }
    return steps.length || answerText ? { steps, answer: answerText } : null;
  }
  function parse(reply, count = 0) {
    const d = jsonOf(reply);
    return (Array.isArray(d && d.steps) ? d.steps : []).slice(0, 8).map((s) => {
      const say = s && typeof s.say === 'string' ? s.say.replace(/\s+/g, ' ').trim().slice(0, 400) : '';
      if (!say) return null; // (a step with nothing to say is skipped)
      const draw = (Array.isArray(s.draw) ? s.draw : []).map((x) => cleanShape(x, count)).filter(Boolean).slice(0, 4);
      return { say, point: cleanPoint(s.point, count), draw };
    }).filter(Boolean);
  }

  /* ---------- what's on the page, numbered for her (a web page only) ---------- */
  let parts = [];
  const CANVAS_APPS = /(^|\.)(docs|sheets|slides|drive)\.google\.com$|(^|\.)(office|officeapps\.live|sharepoint|onedrive\.live|live)\.com$|(^|\.)(figma|canva)\.com$/;
  // a PDF the browser shows in its own viewer: taught from the picture
  const pdfViewer = () => document.contentType === 'application/pdf' || !!document.querySelector('embed[type="application/pdf"]');
  // Not the lesson: the app's own controls (toolbars, menus, page thumbnails, side lists), and anything
  // hidden under another layer (Drive's file list under its PDF viewer)
  const CHROME_ROLES = 'nav,[role=toolbar],[role=menubar],[role=menu],[role=navigation],[role=banner],[role=tablist],[role=complementary],[role=search]';
  function notLesson(n, r, iw, ih) {
    if (n.closest(CHROME_ROLES)) return true;
    // a strip along an edge of the window that stays put (a toolbar, a rail of thumbnails)
    for (let a = n; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
      if (!/^(fixed|sticky|absolute)$/.test(getComputedStyle(a).position)) continue;
      const b = a.getBoundingClientRect();
      const across = b.width > iw * 0.5 && b.height < ih * 0.2 && (b.top <= 4 || b.bottom >= ih - 4);
      const rail = b.height > ih * 0.5 && b.width < iw * 0.25 && (b.left <= 4 || b.right >= iw - 4);
      if (across || rail) return true;
    }
    // covered by something else where it sits
    const cx = Math.min(iw - 2, Math.max(1, r.left + r.width / 2)), cy = Math.min(ih - 2, Math.max(1, r.top + Math.min(r.height / 2, 12)));
    const hit = document.elementFromPoint(cx, cy);
    if (hit && !(n === hit || n.contains(hit) || hit.contains(n)) && !hit.closest('#' + HOST_ID + ',#cassie-ext-host-92f1')) return true;
    return false;
  }
  function scan() {
    const iw = innerWidth, ih = innerHeight, out = [], seen = new Set();
    const words = (n) => String(n.getAttribute('aria-label') || n.getAttribute('alt') || n.placeholder || n.innerText || n.textContent || n.title || n.value || '').replace(/\s+/g, ' ').trim();
    const kind = (n) => {
      const tag = n.tagName.toLowerCase(), role = n.getAttribute('role');
      if (/^h[1-6]$/.test(tag) || role === 'heading') return 'heading';
      if (tag === 'th') return 'table heading';
      if (tag === 'td') return 'table cell';
      if (tag === 'li') return 'list item';
      if (tag === 'a') return 'link';
      if (tag === 'button' || role === 'button' || tag === 'summary') return 'button';
      if (tag === 'img') return 'picture';
      if (tag === 'input' || tag === 'textarea') return 'box';
      if (tag === 'select') return 'menu';
      if (tag === 'pre' || tag === 'code') return 'code';
      if (tag === 'table') return 'table';
      if (tag === 'canvas' || tag === 'svg' || tag === 'figure' || tag === 'video') return 'picture';
      return 'text';
    };
    document.querySelectorAll('h1,h2,h3,h4,h5,h6,[role=heading],p,li,th,td,caption,dt,dd,blockquote,pre,code,figure,img[alt],canvas,svg,video,a[href],button,[role=button],summary,input:not([type=hidden]),select,textarea,label,table').forEach((n) => {
      if (out.length >= 80 || seen.has(n) || n.closest('#' + HOST_ID) || n.closest('#cassie-ext-host-92f1')) return;
      const r = n.getBoundingClientRect();
      if (r.width < 6 || r.height < 6 || r.bottom < 0 || r.right < 0 || r.top > ih || r.left > iw) return;
      const st = getComputedStyle(n);
      if (st.visibility === 'hidden' || +st.opacity === 0) return;
      const k = kind(n), w = words(n);
      const big = k === 'picture' || k === 'table';
      if (!w && !(big && r.width > 60 && r.height > 40)) return;
      if (k === 'text' && n.querySelector('p,li,td,h1,h2,h3')) return; // (its own parts are listed)
      if (notLesson(n, r, iw, ih)) return;
      seen.add(n);
      out.push({ el: n, what: `${k}${w ? ` "${w.slice(0, 70)}${w.length > 70 ? '…' : ''}"` : ''}`, box: [r.left / iw, r.top / ih, r.width / iw, r.height / ih].map((v) => Math.round(v * 1000) / 1000) });
    });
    parts = out;
    const text = ((document.body && document.body.innerText) || '').replace(/\n{3,}/g, '\n\n').trim();
    const wordy = out.filter((p) => /^(heading|text|list item|table cell|table heading)/.test(p.what)).length;
    return {
      title: document.title.slice(0, 120), host: location.hostname,
      text: text.slice(0, 4000),
      items: out.map((p, i) => ({ n: i + 1, what: p.what, box: p.box })),
      // a page drawn on a canvas (Docs, Sheets, Slides, Office): she points by place on the picture
      pictureOnly: CANVAS_APPS.test(location.hostname) || pdfViewer() || wordy < 3 || text.length < 200,
    };
  }

  /* ---------- the lesson: card, arrow and drawing layer ---------- */
  let current = null;
  const store = {
    get: (k) => new Promise((res) => { try { chrome.storage.local.get(k, (o) => res(o || {})); } catch (e) { res({}); } }),
    set: (o) => { try { chrome.storage.local.set(o); } catch (e) { /* not kept */ } },
  };
  const CSS = `
    :host { all: initial; }
    .ct-layer { position: fixed; inset: 0; pointer-events: none; z-index: 2147483640; }
    .ct-in-panel .ct-layer { position: absolute; }
    canvas.ct-ink { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
    .ct-cursor { position: absolute; left: 0; top: 0; width: 34px; height: 34px; pointer-events: none; transition: transform .65s cubic-bezier(.3, .8, .3, 1), opacity .25s; opacity: 0; z-index: 2; filter: drop-shadow(0 3px 6px rgba(0,0,0,.35)); }
    .ct-cursor.on { opacity: 1; }
    .ct-cursor svg { width: 34px; height: 34px; fill: #fff; stroke: ${INK}; stroke-width: 1.6; stroke-linejoin: round; }
    @media (prefers-reduced-motion: reduce) { .ct-cursor { transition: opacity .2s; } }
    .ct-card { position: fixed; right: 16px; bottom: 16px; width: min(380px, calc(100vw - 32px)); max-height: 90vh; box-sizing: border-box; pointer-events: auto; z-index: 2147483641;
      display: flex; flex-direction: column; background: #18181b; color: #f4f4f5; border: 1px solid rgba(255,255,255,.14); border-radius: 18px; padding: 12px 14px 14px; box-shadow: 0 18px 50px rgba(0,0,0,.35);
      font: 15px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
    .ct-card.ct-placed { right: auto; bottom: auto; }
    .ct-in-panel .ct-card { position: static; width: auto; max-height: none; margin-top: 10px; box-shadow: none; }
    .ct-head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-bottom: 6px; cursor: grab; touch-action: none; border-radius: 10px; }
    .ct-head:active { cursor: grabbing; }
    .ct-head:focus-visible { outline: 2px solid #fff; outline-offset: 3px; }
    .ct-in-panel .ct-head { cursor: default; }
    .ct-who { flex: 1 1 140px; display: inline-flex; align-items: center; gap: 6px; font-weight: 700; font-size: 13px; }
    .ct-tools { display: inline-flex; gap: 6px; margin-left: auto; }
    .ct-body { flex: 1 1 auto; min-height: 0; overflow: auto; }
    .ct-card.ct-min .ct-body, .ct-card.ct-min .ct-size { display: none; }
    .ct-min-b svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2.4; stroke-linecap: round; }
    .ct-ans { margin: 0 0 10px; padding: 10px 12px; border-radius: 12px; background: rgba(255,255,255,.07); }
    .ct-ans[hidden] { display: none; }
    .ct-ans b { display: block; font-size: 12.5px; color: rgba(244,244,245,.78); margin-bottom: 4px; }
    .ct-ask { display: flex; gap: 6px; align-items: center; margin: 0 0 10px; }
    .ct-ask input { flex: 1; min-width: 0; min-height: 44px; box-sizing: border-box; border-radius: 12px; border: 1px solid rgba(255,255,255,.22); background: rgba(255,255,255,.06); color: #f4f4f5; padding: 0 12px; font: 15px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    .ct-ask input::placeholder { color: rgba(244,244,245,.6); }
    .ct-ask input:focus { outline: 2px solid #fff; outline-offset: 1px; }
    .ct-again[hidden] { display: none !important; }
    .ct-sized .ct-nav { padding-right: 34px; } /* (the resize corner has its own room: Next is never under it) */
    .ct-card .ct-size { position: absolute; right: 0; bottom: 0; min-width: 44px; min-height: 44px; padding: 0; border: 0; background: transparent; cursor: nwse-resize; border-radius: 0 0 18px 0; }
    .ct-size::after { content: ""; position: absolute; right: 7px; bottom: 7px; width: 12px; height: 12px; border-right: 2px solid rgba(244,244,245,.55); border-bottom: 2px solid rgba(244,244,245,.55); border-radius: 0 0 4px 0; }
    .ct-lost canvas.ct-ink { opacity: .2; }
    .ct-lost .ct-cursor { opacity: 0 !important; }
    .ct-who svg { width: 16px; height: 16px; fill: #fff; }
    .ct-card button { all: unset; box-sizing: border-box; min-height: 44px; min-width: 44px; padding: 0 12px; border-radius: 12px; display: inline-flex; align-items: center; justify-content: center;
      font: 600 13px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #f4f4f5; background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.16); cursor: pointer; }
    .ct-card button:hover { background: rgba(255,255,255,.14); }
    .ct-card button:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
    .ct-card button[aria-pressed="false"] { opacity: .6; }
    .ct-card button:disabled { opacity: .35; cursor: default; }
    .ct-card .ct-next { background: #f4f4f5; color: #111; border-color: #f4f4f5; }
    .ct-say { margin: 4px 0 10px; min-height: 2.9em; }
    .ct-note, .ct-moved { margin: 0 0 10px; font-size: 12.5px; line-height: 1.4; color: rgba(244,244,245,.78); }
    .ct-moved { color: #f4f4f5; } .ct-moved[hidden] { display: none; }
    .ct-vnote { margin: 0 0 10px; font-size: 12.5px; line-height: 1.4; color: #f4f4f5; }
    .ct-vnote[hidden] { display: none; }
    .ct-nav { display: flex; align-items: center; gap: 8px; }
    .ct-count { flex: 1; text-align: center; font-size: 13px; color: rgba(244,244,245,.75); }
    .ct-shot { position: relative; border-radius: 10px; overflow: hidden; border: 1px solid rgba(127,127,127,.35); }
    .ct-shot img { display: block; width: 100%; height: auto; }
  `;

  function show(lesson, opts = {}) {
    stop();
    const steps = (lesson && lesson.steps) || [];
    if (!steps.length) return null;
    const inPanel = !!opts.mount;
    const host = document.createElement('div');
    host.id = HOST_ID;
    if (!inPanel) Object.assign(host.style, { position: 'fixed', inset: '0', zIndex: '2147483640', pointerEvents: 'none' });
    const root = host.attachShadow({ mode: 'open' });
    const wrap = document.createElement('div');
    if (inPanel) wrap.className = 'ct-in-panel';
    wrap.innerHTML = `<style>${CSS}</style>
      ${inPanel ? '<div class="ct-shot"><img alt="A picture of the tab"><div class="ct-layer"><canvas class="ct-ink"></canvas><div class="ct-cursor">' + ARROW + '</div></div></div>' : '<div class="ct-layer"><canvas class="ct-ink"></canvas><div class="ct-cursor">' + ARROW + '</div></div>'}
      <div class="ct-card${inPanel ? '' : ' ct-sized'}" role="dialog" aria-label="Cassie is teaching">
        <div class="ct-head"${inPanel ? '' : ' tabindex="0" title="Drag to move. With the keyboard, use the arrow keys." aria-label="Cassie’s card. Drag it, or use the arrow keys to move it."'}><span class="ct-who">${ARROW}Cassie is teaching</span>
          <span class="ct-tools"><button type="button" class="ct-voice" aria-pressed="true" title="Cassie’s voice on or off">Voice on</button>
          <button type="button" class="ct-auto" aria-pressed="true" title="Go on to the next step by itself">Auto</button>
          ${inPanel ? '' : '<button type="button" class="ct-min-b" aria-expanded="true" aria-label="Minimize" title="Minimize"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 15l6 -6 6 6"/></svg></button>'}
          <button type="button" class="ct-x" aria-label="Stop teaching">✕</button></span></div>
        <div class="ct-body">
          <p class="ct-say" aria-live="polite"></p>
          <div class="ct-ans" hidden aria-live="polite"><b></b><p></p></div>
          <form class="ct-ask" autocomplete="off"><input type="text" placeholder="Ask about this step" aria-label="Ask about this step" maxlength="300" enterkeyhint="send"><button type="submit" class="ct-send">Send</button></form>
          <p class="ct-vnote" role="status" hidden></p>
          <p class="ct-note">When you’re done, close this. Everything Cassie taught is saved in the Cassie side panel.</p>
          <p class="ct-moved" hidden>The page moved, so Cassie’s drawings no longer line up.</p>
          <div class="ct-nav"><button type="button" class="ct-back">Back</button><span class="ct-count"></span><button type="button" class="ct-again" hidden>Look again</button><button type="button" class="ct-next">Next</button></div>
        </div>
        ${inPanel ? '' : '<button type="button" class="ct-size" aria-label="Resize Cassie’s card" title="Drag to resize. With the keyboard, use the arrow keys."></button>'}
      </div>`;
    root.appendChild(wrap);
    (inPanel ? opts.mount : document.documentElement).appendChild(host);
    const $ = (s) => root.querySelector(s);
    const layer = $('.ct-layer'), canvas = $('canvas'), cursor = $('.ct-cursor'), card = $('.ct-card'), sayEl = $('.ct-say');
    if (inPanel) $('img').src = opts.image;
    host.dataset.spoken = '0'; host.dataset.drawn = ''; host.dataset.step = '0';
    const numbered = !inPanel && opts.numbered !== false && parts.length > 0 && !opts.region;

    // the area her numbers are about: the whole screen, the snipped part of it, or the picture in the panel
    // The page scrolls under her drawings: the window, or the box the lesson sits in (a PDF viewer's
    // pages scroll inside their own box). Both are followed.
    const sx0 = scrollX, sy0 = scrollY;
    const box0 = inPanel ? null : (() => {
      const g = opts.region, cx = g ? (g.x + g.w / 2) * innerWidth : innerWidth / 2, cy = g ? (g.y + g.h / 2) * innerHeight : innerHeight / 2;
      for (let n = document.elementFromPoint(cx, cy); n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
        const cs = getComputedStyle(n);
        if (/(auto|scroll|overlay)/.test(cs.overflowY + cs.overflowX) && (n.scrollHeight > n.clientHeight + 1 || n.scrollWidth > n.clientWidth + 1)) return { el: n, x: n.scrollLeft, y: n.scrollTop };
      }
      return null;
    })();
    // Her spots are shares of the picture she was shown, so they are laid over the part of the window that
    // picture covers (its own size: a picture of the tab isn't always the window's exact size)
    let shotCss = null;
    const frame = () => {
      if (inPanel) { const r = layer.getBoundingClientRect(); return { left: 0, top: 0, width: r.width, height: r.height }; }
      const g = opts.region;
      const dx = scrollX - sx0 + (box0 ? box0.el.scrollLeft - box0.x : 0), dy = scrollY - sy0 + (box0 ? box0.el.scrollTop - box0.y : 0);
      return g ? { left: g.x * innerWidth - dx, top: g.y * innerHeight - dy, width: g.w * innerWidth, height: g.h * innerHeight }
        : { left: -dx, top: -dy, width: shotCss ? shotCss.w : innerWidth, height: shotCss ? shotCss.h : innerHeight };
    };
    const at = (x, y) => { const f = frame(); return [f.left + x * f.width, f.top + y * f.height]; };
    const partRect = (n) => {
      const p = !inPanel && parts[n - 1];
      if (!p || !p.el.isConnected) return null;
      const r = p.el.getBoundingClientRect();
      return r.width || r.height ? r : null;
    };
    const targetOf = (pt) => {
      if (!pt) return null;
      if (pt.el) { const r = partRect(pt.el); return r ? { rect: r } : null; }
      if (pt.selector && !inPanel) { try { const n = document.querySelector(pt.selector); const r = n && n.getBoundingClientRect(); return r && (r.width || r.height) ? { rect: r } : null; } catch (e) { return null; } }
      if (pt.x != null) { const [x, y] = at(pt.x, pt.y); return { x, y }; }
      return null;
    };

    /* the shapes she draws, as the board's own strokes (worked out again each frame: the page may scroll) */
    const line = (a, b) => [a, b];
    const ring = (cx, cy, rx, ry, n = 44) => Array.from({ length: n + 1 }, (_, i) => [cx + rx * Math.cos((i / n) * Math.PI * 2 - Math.PI / 2), cy + ry * Math.sin((i / n) * Math.PI * 2 - Math.PI / 2)]);
    // around a part: a rounded loop that hugs its box, its ink at most 8px out (an ellipse cut its corners or spread wide)
    const hug = (r, pad = 6, n = 64) => {
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2, a = r.width / 2 + pad, b = r.height / 2 + pad, e = 2 / 5;
      return Array.from({ length: n + 1 }, (_, i) => { const t = (i / n) * Math.PI * 2 - Math.PI / 2, c = Math.cos(t), s = Math.sin(t); return [cx + a * Math.sign(c) * Math.abs(c) ** e, cy + b * Math.sign(s) * Math.abs(s) ** e]; });
    };
    const boxPts = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]];
    function strokesOf(d) {
      const sizeK = Math.max(1, Math.min(innerWidth, innerHeight) / 700);
      const pen = (points, size = 3.2, tool = 'pen') => ({ tool, color: INK, size: size * sizeK, points });
      const r = d.el ? partRect(d.el) : null;
      if (d.el && !r) return [];
      switch (d.shape) {
        case 'circle': {
          if (r) return [pen(hug(r))];
          const f = frame(), [cx, cy] = at(d.x, d.y), rr = d.r * f.width;
          return [pen(ring(cx, cy, rr, rr))];
        }
        case 'box': {
          if (r) return [pen(boxPts(r.left - 6, r.top - 5, r.width + 12, r.height + 10))];
          const [x, y] = at(d.x, d.y), f = frame();
          return [pen(boxPts(x, y, d.w * f.width, d.h * f.height))];
        }
        case 'underline': {
          if (r) return [pen(line([r.left, r.bottom + 4], [r.right, r.bottom + 4]), 3.2, 'line')];
          const [x, y] = at(d.x, d.y), f = frame();
          return [pen(line([x, y], [x + d.w * f.width, y]), 3.2, 'line')];
        }
        case 'highlight': {
          const [x, y, w, h] = r ? [r.left, r.top, r.width, r.height] : (() => { const [a, b] = at(d.x, d.y), f = frame(); return [a, b, d.w * f.width, d.h * f.height]; })();
          return [{ tool: 'hl', color: INK, size: Math.max(2, h / 4), points: [[x, y + h / 2], [x + w, y + h / 2]] }];
        }
        case 'arrow': case 'line': {
          let a, b;
          if (d.toEl) {
            const t = partRect(d.toEl);
            if (!t) return [];
            b = [t.left - 6, t.top + t.height / 2];
            // (from up and to the left of it, but always from inside the window)
            a = d.from ? at(d.from[0], d.from[1]) : [Math.max(8, b[0] - 90 * sizeK), Math.max(8, b[1] - 60 * sizeK)];
            if (!d.from && a[0] > b[0] - 24) a = [Math.min(innerWidth - 8, b[0] + 90 * sizeK), a[1]]; // (a part at the window's left edge: from the right)
          } else { a = at(d.from[0], d.from[1]); b = at(d.to[0], d.to[1]); }
          const out = [pen(line(a, b), 3.2, 'line')];
          if (d.shape === 'arrow') {
            const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), L = 16 * sizeK;
            out.push(pen(line(b, [b[0] - L * Math.cos(ang - 0.5), b[1] - L * Math.sin(ang - 0.5)]), 3.2, 'line'), pen(line(b, [b[0] - L * Math.cos(ang + 0.5), b[1] - L * Math.sin(ang + 0.5)]), 3.2, 'line'));
          }
          return out;
        }
        case 'curve': return [pen(d.points.map((p) => at(p[0], p[1])))];
        case 'polygon': { const p = d.points.map((q) => at(q[0], q[1])); return [pen([...p, p[0]].flatMap((q, i, a) => (i ? [[(a[i - 1][0] + q[0]) / 2, (a[i - 1][1] + q[1]) / 2], q, q] : [q])))]; }
        case 'graph': {
          const [x, y] = at(d.x, d.y), f = frame(), w = d.w * f.width, h = d.h * f.height;
          let fn; try { fn = window.CassieBoard.compile(d.fn); } catch (e) { return []; }
          const [a, b] = d.xrange, n = 80, xs = Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n);
          const ys = xs.map((v) => { const u = fn(v); return Number.isFinite(u) ? u : null; });
          const ok = ys.filter((v) => v != null);
          if (ok.length < 2) return [];
          let lo = Math.min(...ok, 0), hi = Math.max(...ok, 0);
          if (hi - lo < 1e-6) { lo -= 1; hi += 1; }
          const px = (v) => x + ((v - a) / (b - a)) * w, py = (v) => y + h - ((v - lo) / (hi - lo)) * h;
          const out = [];
          if (a <= 0 && b >= 0) out.push(pen(line([px(0), y], [px(0), y + h]), 1.6, 'line'));
          out.push(pen(line([x, py(0)], [x + w, py(0)]), 1.6, 'line'));
          let run = [];
          xs.forEach((v, i) => { if (ys[i] == null) { if (run.length > 1) out.push(pen(run)); run = []; } else run.push([px(v), py(ys[i])]); });
          if (run.length > 1) out.push(pen(run));
          return out;
        }
        case 'text': {
          const [x, y] = at(d.x, d.y);
          return [{ tool: 'text', color: INK, size: 18 * sizeK, weight: 700, text: d.text, x, y }];
        }
      }
      return [];
    }

    /* drawing: everything this step drew so far, each shape revealed over half a second */
    let drawn = [], past = [], raf = 0, ptr = null;
    const ctx = canvas.getContext('2d');
    const paintOne = (s, k) => {
      const part = s.points && k < 1 ? { ...s, points: s.points.slice(0, Math.max(1, Math.ceil(s.points.length * k))) } : s;
      if (s.tool === 'text' && k < 1) return;
      if (s.tool !== 'hl') window.CassieSketch.paint(ctx, { ...part, color: HALO, size: part.size + 4 }); // (a white edge: it shows on dark pages too)
      window.CassieSketch.paint(ctx, part);
    };
    function render() {
      raf = 0;
      const dpr = devicePixelRatio || 1, W = Math.round(canvas.clientWidth * dpr), H = Math.round(canvas.clientHeight * dpr);
      if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, W, H); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const base = inPanel ? { left: 0, top: 0 } : { left: 0, top: 0 };
      ctx.translate(-base.left, -base.top);
      const now = performance.now();
      let moving = false;
      // the thing she points at gets a soft ring
      const t = ptr && targetOf(ptr);
      if (t && t.rect) {
        const r = t.rect;
        paintOne({ tool: 'pen', color: INK, size: 2, points: boxPts(r.left - 4, r.top - 3, r.width + 8, r.height + 6) }, 1);
      }
      past.forEach((spec) => strokesOf(spec).forEach((s) => paintOne({ ...s, color: PAST }, 1)));
      drawn.forEach((d) => {
        const k = Math.min(1, (now - d.t0) / 550);
        if (k < 1) moving = true;
        strokesOf(d.spec).forEach((s) => paintOne(s, k));
      });
      placeCursor(t);
      if (moving) raf = requestAnimationFrame(render);
    }
    const later = () => { if (!raf) raf = requestAnimationFrame(render); };
    function placeCursor(t) {
      if (!t) { cursor.classList.remove('on'); return; }
      let x, y;
      if (t.rect) { x = t.rect.left + Math.min(28, t.rect.width / 2); y = t.rect.top + t.rect.height / 2; } else { x = t.x; y = t.y; }
      cursor.style.transform = `translate(${Math.round(x - 5)}px, ${Math.round(y - 3)}px)`; // (the tip of the arrow on the spot)
      cursor.dataset.x = String(Math.round(x)); cursor.dataset.y = String(Math.round(y));
      cursor.classList.add('on');
    }

    /* ---------- the card: the student moves it (drag its header, or the arrow keys), resizes it from its
       corner and can shrink it to its header. Its place and size are kept for the next lesson. Before
       each step it moves off what she points at and draws, unless the student moved it in this lesson. */
    const M = 8; // (it always stays this far inside the window)
    let movedByHand = false;
    const cardRect = () => card.getBoundingClientRect();
    const overlaps = (a, b, m = 0) => !(a.right + m <= b.left || a.left - m >= b.right || a.bottom + m <= b.top || a.top - m >= b.bottom);
    function placeCard(x, y, w, h) {
      if (inPanel) return;
      const maxW = innerWidth * 0.9, maxH = innerHeight * 0.9;
      if (w != null) card.style.width = Math.round(Math.min(maxW, Math.max(Math.min(300, maxW), w))) + 'px';
      if (h != null) card.style.height = Math.round(Math.min(maxH, Math.max(Math.min(180, maxH), h))) + 'px';
      const c = cardRect();
      card.classList.add('ct-placed');
      card.style.left = Math.round(Math.max(M, Math.min(innerWidth - c.width - M, x))) + 'px';
      card.style.top = Math.round(Math.max(M, Math.min(innerHeight - c.height - M, y))) + 'px';
    }
    const keepCard = () => { const c = cardRect(); store.set({ teachCard: { x: Math.round(c.left), y: Math.round(c.top), w: Math.round(c.width), h: card.style.height && !card.classList.contains('ct-min') ? Math.round(c.height) : null } }); };
    // off the things she is about to point at and draw on, to the first free spot
    function clearOf(rects) {
      if (inPanel || movedByHand || !rects.length || !rects.some((r) => overlaps(r, cardRect(), 6))) return;
      const c = cardRect(), w = c.width, h = c.height, iw = innerWidth, ih = innerHeight, E = 16;
      for (const [x, y] of [[iw - w - E, ih - h - E], [iw - w - E, E], [E, ih - h - E], [E, E], [iw - w - E, (ih - h) / 2], [E, (ih - h) / 2]]) {
        const spot = { left: x, top: y, right: x + w, bottom: y + h };
        if (!rects.some((r) => overlaps(r, spot, 6))) { placeCard(x, y); return; }
      }
    }

    /* ---------- accurate drawings ----------
       A shape about a numbered part hugs that part. A shape placed on the picture is drawn only where the
       picture has something (never on blank space), never under the card, never on the browser app's
       top bar (the top 72px of the window) and never off the window. A step keeps its words either way. */
    const looked = (() => {
      const src = inPanel ? opts.image : opts.shot;
      if (!src) return Promise.resolve(null);
      return new Promise((res) => {
        const img = new Image();
        img.onload = () => {
          try {
            if (!inPanel && !opts.region) { const k = devicePixelRatio || 1; shotCss = { w: img.naturalWidth / k, h: img.naturalHeight / k }; host.dataset.frame = Math.round(shotCss.w) + 'x' + Math.round(shotCss.h); }
            const W = Math.min(480, img.naturalWidth), H = Math.max(1, Math.round((W * img.naturalHeight) / img.naturalWidth));
            const c = document.createElement('canvas'); c.width = W; c.height = H;
            const g = c.getContext('2d'); g.drawImage(img, 0, 0, W, H);
            const px = g.getImageData(0, 0, W, H).data;
            // is this part of the picture (x, y, w, h as shares) blank: almost no change in its pixels?
            res((x, y, w, h) => {
              const x0 = Math.max(0, Math.floor(x * W)), y0 = Math.max(0, Math.floor(y * H)), x1 = Math.min(W, Math.ceil((x + w) * W)), y1 = Math.min(H, Math.ceil((y + h) * H));
              if (x1 - x0 < 1 || y1 - y0 < 1) return true;
              let n = 0, sum = 0, sq = 0, lo = 255, hi = 0;
              for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
                const i = (yy * W + xx) * 4, v = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
                n++; sum += v; sq += v * v; if (v < lo) lo = v; if (v > hi) hi = v;
              }
              return Math.sqrt(Math.max(0, sq / n - (sum / n) ** 2)) < 6 && hi - lo < 40;
            });
          } catch (e) { res(null); } // (a picture that can't be read: nothing is left out)
        };
        img.onerror = () => res(null);
        img.src = src;
      });
    })();
    const aspect = () => { const f = frame(); return f.width / Math.max(1, f.height); };
    // where on the picture a shape placed by position sits (null: not checked: it's about a part, or it brings its own ink)
    function areaOf(d) {
      if (d.el || d.toEl) return null;
      const a = aspect();
      switch (d.shape) {
        case 'circle': return [d.x - d.r * 0.8, d.y - d.r * a * 0.8, d.r * 1.6, d.r * a * 1.6];
        case 'box': case 'highlight': return [d.x, d.y, d.w, d.h];
        case 'underline': return [d.x, d.y - 0.035, d.w, 0.035];
        case 'arrow': case 'line': return [d.to[0] - 0.02, d.to[1] - 0.02 * a, 0.04, 0.04 * a];
        case 'curve': case 'polygon': {
          const xs = d.points.map((q) => q[0]), ys = d.points.map((q) => q[1]);
          return [Math.min(...xs), Math.min(...ys), Math.max(0.02, Math.max(...xs) - Math.min(...xs)), Math.max(0.02, Math.max(...ys) - Math.min(...ys))];
        }
        default: return null;
      }
    }
    // before the lesson: shapes and pointers on blank space are left out
    async function vet(list) {
      const blank = await looked;
      if (!blank) return;
      list.forEach((s) => {
        s.draw = s.draw.filter((d) => { const ar = areaOf(d); return !ar || !blank(...ar); });
        if (s.point && s.point.x != null) { const a = aspect(); if (blank(s.point.x - 0.02, s.point.y - 0.02 * a, 0.04, 0.04 * a)) s.point = null; }
      });
    }
    function screenBox(spec) {
      const pts = strokesOf(spec).flatMap((st) => st.points || [[st.x, st.y]]);
      if (!pts.length) return null;
      const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
      return { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
    }
    const placed = (d) => !d.el && !d.toEl;
    function fits(spec, cardR) {
      if (inPanel) return true;
      const b = screenBox(spec);
      if (!b) return false;
      const cx = (b.left + b.right) / 2, cy = (b.top + b.bottom) / 2;
      if (cx < 0 || cy < 0 || cx > innerWidth || cy > innerHeight) return false;
      if (!opts.region && placed(spec) && b.top < 72) return false;
      return !overlaps(b, cardR);
    }
    function pointFits(pt) {
      if (inPanel || !pt) return !!pt;
      const t = targetOf(pt);
      if (!t) return false;
      if (t.rect) return true;
      return t.x >= 0 && t.y >= 0 && t.x <= innerWidth && t.y <= innerHeight && (opts.region || t.y >= 72);
    }
    // show a step's (or an answer's) pointer and shapes: the card moves off them first
    function mark(s) {
      ptr = pointFits(s.point) ? s.point : null;
      const t = ptr && targetOf(ptr);
      const near = (s.draw || []).map(screenBox).filter(Boolean);
      if (t) near.push(t.rect || { left: t.x - 12, top: t.y - 12, right: t.x + 40, bottom: t.y + 40 });
      clearOf(near);
      const cardR = cardRect();
      s.shown = (s.draw || []).filter((d) => fits(d, cardR));
      const t0 = performance.now();
      drawn = s.shown.map((spec, i) => ({ spec, t0: t0 + 350 + i * 600 }));
      host.dataset.drawn = s.shown.map((d) => d.shape).join(',');
      render(); later();
      s.shown.forEach((d, i) => setTimeout(later, 360 + i * 600)); // (each shape starts after the arrow arrives)
    }

    /* ---------- when the page moves in a way she can't follow (a canvas app, a box she isn't watching, the
       window resized), her drawings fade and the card offers to look again ---------- */
    let lost = false;
    const centerEl = inPanel ? null : (() => { const g = opts.region; return document.elementFromPoint(g ? (g.x + g.w / 2) * innerWidth : innerWidth / 2, g ? (g.y + g.h / 2) * innerHeight : innerHeight / 2); })();
    const hasPlaced = () => steps.some((x) => (x.draw || []).some(placed) || (x.point && x.point.x != null));
    function loseTrack() {
      if (lost || inPanel || !alive || !hasPlaced()) return;
      lost = true;
      layer.classList.add('ct-lost');
      $('.ct-moved').hidden = false;
      if (opts.again) $('.ct-again').hidden = false;
      host.dataset.lost = '1';
    }
    const onScroll = (e) => {
      later();
      const n = e.target;
      if (!n || n.nodeType !== 1 || n === document.documentElement || n === document.body || (box0 && n === box0.el)) return;
      if (centerEl && n.contains(centerEl)) loseTrack();
    };
    const iw0 = innerWidth, ih0 = innerHeight;
    const onResize = () => {
      later();
      if (!inPanel && card.classList.contains('ct-placed')) { const c = cardRect(); placeCard(c.left, c.top); }
      if (Math.abs(innerWidth - iw0) > 2 || Math.abs(innerHeight - ih0) > 2) loseTrack();
    };
    // a canvas app moves its pages without scrolling anything: a wheel that moved nothing she follows
    const onWheel = () => {
      if (!CANVAS_APPS.test(location.hostname)) return;
      const was = [scrollX, scrollY, box0 && box0.el.scrollTop, box0 && box0.el.scrollLeft].join();
      setTimeout(() => { if ([scrollX, scrollY, box0 && box0.el.scrollTop, box0 && box0.el.scrollLeft].join() === was) loseTrack(); }, 250);
    };

    /* voice: Bella's studio voice (from Cassie's server, through the background) and no other. When
       the lesson starts she speaks only if what's left of the month's voice covers every step; otherwise,
       or if Bella stops partway, the steps are typed and the card says so once. Nothing waits for a tap. */
    let voiceOn = true, autoOn = true, at0 = 0, timer = 0, alive = true, studio = false, src = null, clipFor = null;
    const vnote = $('.ct-vnote');
    const typing = () => {
      studio = false;
      if (!vnote.hidden) return;
      vnote.textContent = window.CassieErrors ? window.CassieErrors.say('voice_typing') : 'Cassie’s voice isn’t available right now, so she’ll type her answers instead.';
      vnote.hidden = false;
    };
    let actx = null;
    const audio = () => { const AC = window.AudioContext || window.webkitAudioContext; if (!actx && AC) { try { actx = new AC(); } catch (e) { actx = null; } } return actx; };
    const hush = () => { clearTimeout(timer); timer = 0; clipFor = null; if (src) { try { src.stop(); } catch (e) { /* ignore */ } src = null; } };
    async function clip(text) {
      const r = await chrome.runtime.sendMessage({ type: 'CASSIE_SPEAK', text }).catch(() => null);
      if (!r || !r.audio) throw Object.assign(new Error('no voice'), { usedUp: !!(r && r.usedUp) });
      const bin = atob(r.audio), bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const ac = audio();
      if (!ac) throw new Error('no audio');
      if (ac.state === 'suspended') { try { await ac.resume(); } catch (e) { /* stays suspended */ } }
      if (ac.state !== 'running') throw new Error('audio blocked');
      return await new Promise((res, rej) => ac.decodeAudioData(bytes.buffer, res, rej));
    }
    // the whole lesson decides, once: Bella says every step, or every step is typed (said once on the card)
    let asked = false;
    async function decideVoice(from) {
      asked = true;
      const need = steps.slice(from).reduce((n, x) => n + x.say.length, 0);
      const left = await chrome.runtime.sendMessage({ type: 'CASSIE_SPEAK_LEFT' }).catch(() => null);
      if (!alive) return;
      studio = !!(left && left.on && left.left >= need && audio());
      if (!studio) typing();
    }
    const readPace = (text) => Math.min(9000, 1400 + text.length * 45);
    function speakThen(text, then) {
      hush();
      if (!voiceOn || !studio) { timer = setTimeout(then, readPace(text)); return; }
      const mine = clipFor = {};
      (async () => {
        let buf = null;
        for (let tries = 0; tries < 2 && !buf; tries++) {
          try { buf = await clip(text); } catch (e) { if (e.usedUp) break; }
          if (clipFor !== mine || !alive) return;
        }
        if (!buf) { typing(); timer = setTimeout(then, readPace(text)); return; } // (Bella stopped: the rest is typed)
        if (!voiceOn) { timer = setTimeout(then, readPace(text)); return; }
        const node = actx.createBufferSource(); node.buffer = buf; node.connect(actx.destination);
        let done = false;
        const end = () => { if (done) return; done = true; if (src === node) src = null; if (clipFor === mine) timer = setTimeout(then, 700); };
        node.onended = end; src = node;
        host.dataset.spoken = String(+host.dataset.spoken + 1);
        try { node.start(); } catch (e) { end(); }
        timer = setTimeout(end, buf.duration * 1000 + 1500); // (a speaker that never says "done")
      })();
    }

    function go(k) {
      if (!alive || !steps[k]) return;
      at0 = k;
      host.dataset.step = String(k);
      const s = steps[k];
      sayEl.textContent = s.say;
      $('.ct-count').textContent = `${k + 1} of ${steps.length}`;
      $('.ct-back').disabled = k === 0;
      $('.ct-next').textContent = k === steps.length - 1 ? 'Done' : 'Next';
      ans.hidden = true; asking++; // (an answer belongs to the step it was asked on)
      past = steps.slice(0, k).flatMap((x) => x.shown || x.draw); // (what she drew before stays, in grey)
      host.dataset.past = String(past.length);
      mark(s);
      speakThen(s.say, () => { if (autoOn && alive && at0 === k && k < steps.length - 1) go(k + 1); });
    }

    function close() {
      if (!alive) return;
      alive = false;
      if (lesson.save !== false) saveLesson();
      hush();
      cancelAnimationFrame(raf);
      removeEventListener('scroll', onScroll, true); removeEventListener('resize', onResize); removeEventListener('wheel', onWheel, true);
      removeEventListener('keydown', onKey, true);
      host.remove();
      if (current && current.host === host) current = null;
      followPaint(); // (her cursor comes back beside the mouse)
      if (opts.onClose) opts.onClose();
    }
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    addEventListener('scroll', onScroll, true); addEventListener('resize', onResize); addEventListener('wheel', onWheel, { capture: true, passive: true });
    addEventListener('keydown', onKey, true);
    $('.ct-again').addEventListener('click', () => { const a = opts.again; close(); if (a) a(); });

    // moving and sizing the card
    if (!inPanel) {
      const head = $('.ct-head'), grip = $('.ct-size'), minB = $('.ct-min-b');
      const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      let drag = null, size = null, tallBefore = '';
      head.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || e.target.closest('button')) return;
        const c = cardRect(); drag = { dx: e.clientX - c.left, dy: e.clientY - c.top, id: e.pointerId };
        try { head.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        e.preventDefault();
      });
      head.addEventListener('pointermove', (e) => { if (!drag || e.pointerId !== drag.id) return; movedByHand = true; placeCard(e.clientX - drag.dx, e.clientY - drag.dy); });
      const dropCard = () => { if (!drag) return; drag = null; if (movedByHand) keepCard(); };
      head.addEventListener('pointerup', dropCard); head.addEventListener('pointercancel', dropCard);
      head.addEventListener('keydown', (e) => {
        const d = e.target === head && ARROWS[e.key];
        if (!d) return;
        e.preventDefault(); e.stopPropagation();
        const c = cardRect(), k = e.shiftKey ? 60 : 20;
        movedByHand = true; placeCard(c.left + d[0] * k, c.top + d[1] * k); keepCard();
      });
      grip.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        const c = cardRect(); size = { x: e.clientX, y: e.clientY, w: c.width, h: c.height, left: c.left, top: c.top, id: e.pointerId };
        try { grip.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        e.preventDefault();
      });
      grip.addEventListener('pointermove', (e) => {
        if (!size || e.pointerId !== size.id) return;
        movedByHand = true;
        placeCard(size.left, size.top, Math.min(size.w + e.clientX - size.x, innerWidth - size.left - M), Math.min(size.h + e.clientY - size.y, innerHeight - size.top - M));
      });
      const doneSizing = () => { if (!size) return; size = null; keepCard(); };
      grip.addEventListener('pointerup', doneSizing); grip.addEventListener('pointercancel', doneSizing);
      grip.addEventListener('keydown', (e) => {
        const d = ARROWS[e.key];
        if (!d) return;
        e.preventDefault(); e.stopPropagation();
        const c = cardRect(); movedByHand = true; placeCard(c.left, c.top, c.width + d[0] * 20, c.height + d[1] * 20); keepCard();
      });
      minB.addEventListener('click', () => {
        const min = card.classList.toggle('ct-min');
        if (min) { tallBefore = card.style.height; card.style.height = ''; } else if (tallBefore) card.style.height = tallBefore;
        minB.setAttribute('aria-expanded', String(!min));
        minB.setAttribute('aria-label', min ? 'Expand' : 'Minimize'); minB.title = min ? 'Expand' : 'Minimize';
        minB.querySelector('path').setAttribute('d', min ? 'M6 9l6 6 6 -6' : 'M6 15l6 -6 6 6');
        if (card.classList.contains('ct-placed')) { const c = cardRect(); placeCard(c.left, c.top); }
      });
    }

    /* ---------- questions about a step: typed or said (the mic), answered from the same picture ---------- */
    const askForm = $('.ct-ask'), askIn = askForm.querySelector('input'), ans = $('.ct-ans'), ansOut = ans.querySelector('p');
    const qa = [];
    let asking = 0;
    if (window.CassieMic) window.CassieMic.attach(askIn, { send: () => askForm.requestSubmit() });
    askIn.addEventListener('keydown', (e) => { if (e.key !== 'Escape') e.stopPropagation(); }); // (the page's own shortcuts stay out of the box)
    askForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const q = askIn.value.trim();
      if (!q) { askIn.focus(); return; }
      askIn.value = '';
      hush(); // (she stops to answer: no step goes on by itself meanwhile)
      const my = ++asking, at = at0;
      ans.hidden = false;
      ans.querySelector('b').textContent = 'You asked: ' + q;
      // a student at risk: care first, and no AI is asked (care.js; counted with no words, no id)
      const hit = window.CassieCare && window.CassieCare.check(q);
      if (hit) {
        ansOut.textContent = window.CassieCare.reply(hit.lang);
        qa.push({ q, a: ansOut.textContent });
        try { chrome.runtime.sendMessage({ type: 'CASSIE_CARE' }).catch(() => {}); } catch (err) { /* best effort */ }
        return;
      }
      ansOut.textContent = 'Cassie is thinking…';
      const count = numbered ? parts.length : 0;
      let reply = '';
      try {
        const r = await chrome.runtime.sendMessage({ type: 'CASSIE_VISION', image: inPanel ? opts.image : opts.shot, maxTokens: 900,
          prompt: followPrompt({ q, steps, at, title: lesson.title || document.title, items: count ? parts.map((p, i) => ({ n: i + 1, what: p.what, box: p.box })) : [] }) });
        if (!r || r.error) throw new Error((r && r.error) || 'ask failed');
        reply = String(r.reply || '');
      } catch (err) { if (my === asking && alive) ansOut.textContent = problem(err) === window.CassieErrors.say('teach_failed') ? window.CassieErrors.say('teach_ask_failed') : problem(err); return; }
      if (my !== asking || !alive) return;
      const d = jsonOf(reply) || {};
      const words = (typeof d.answer === 'string' && d.answer.trim()) || (reply.indexOf('{') < 0 ? reply.trim() : '');
      if (!words) { ansOut.textContent = window.CassieErrors.say('teach_ask_failed'); return; }
      ansOut.textContent = words.slice(0, 1500);
      qa.push({ q, a: ansOut.textContent });
      host.dataset.answered = String(qa.length);
      // and she shows where, by the same rules as the lesson
      const shown = { say: words, point: cleanPoint(d.point, count), draw: (Array.isArray(d.draw) ? d.draw : []).map((x) => cleanShape(x, count)).filter(Boolean).slice(0, 3) };
      await vet([shown]);
      if (my === asking && alive) mark(shown);
    });
    $('.ct-x').addEventListener('click', close);
    $('.ct-next').addEventListener('click', () => { if (at0 < steps.length - 1) go(at0 + 1); else close(); });
    $('.ct-back').addEventListener('click', () => go(Math.max(0, at0 - 1)));
    const setVoice = (on) => { voiceOn = on; const b = $('.ct-voice'); b.setAttribute('aria-pressed', String(on)); b.textContent = on ? 'Voice on' : 'Voice off'; };
    const setAuto = (on) => { autoOn = on; $('.ct-auto').setAttribute('aria-pressed', String(on)); };
    $('.ct-voice').addEventListener('click', () => {
      setVoice(!voiceOn); store.set({ teachVoice: voiceOn ? 'on' : 'off' });
      if (!voiceOn) { hush(); if (autoOn) speakThen(steps[at0].say, () => { if (autoOn && alive && at0 < steps.length - 1) go(at0 + 1); }); }
      else if (!asked) decideVoice(at0 + 1); // (turned on partway: the steps still to come decide it)
    });
    $('.ct-auto').addEventListener('click', () => {
      setAuto(!autoOn); store.set({ teachAuto: autoOn ? 'on' : 'off' });
      if (!autoOn) clearTimeout(timer);
    });

    // the lesson, kept on this device: its title, every step's words, and a small picture with the drawings
    const shotImg = inPanel ? $('img') : opts.shot ? Object.assign(new Image(), { src: opts.shot }) : null;
    function saveLesson() {
      let pic = '';
      try {
        render();
        const g = opts.region, W = 480;
        const srcW = inPanel || !g ? canvas.width : g.w * innerWidth * (devicePixelRatio || 1), srcH = inPanel || !g ? canvas.height : g.h * innerHeight * (devicePixelRatio || 1);
        const H = Math.max(1, Math.round((W * srcH) / Math.max(1, srcW)));
        const c = document.createElement('canvas'); c.width = W; c.height = H;
        const x = c.getContext('2d');
        x.fillStyle = '#ffffff'; x.fillRect(0, 0, W, H);
        if (shotImg && shotImg.complete && shotImg.naturalWidth) x.drawImage(shotImg, 0, 0, W, H);
        if (!inPanel && g) { const d = devicePixelRatio || 1; x.drawImage(canvas, g.x * innerWidth * d, g.y * innerHeight * d, srcW, srcH, 0, 0, W, H); } else x.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, W, H);
        pic = c.toDataURL('image/jpeg', 0.72);
      } catch (e) { pic = ''; } // (a page that won't let its picture be read: the words are still kept)
      const item = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), at: Date.now(), title: String(lesson.title || document.title || 'A page').slice(0, 120), q: String(lesson.q || '').slice(0, 300), steps: steps.map((x) => x.say), qa: qa.slice(0, 20), pic };
      store.get(['teachLessons']).then((o) => { const list = Array.isArray(o.teachLessons) ? o.teachLessons : []; store.set({ teachLessons: [item, ...list].slice(0, 20) }); });
    }

    current = { host, close };
    followPaint(); // (her cursor beside the mouse waits while she teaches)
    // she starts where her cursor was (beside the mouse), then glides to the first thing
    if (opts.from && !inPanel) { cursor.style.transition = 'none'; cursor.style.transform = `translate(${Math.round(opts.from.x)}px, ${Math.round(opts.from.y)}px)`; cursor.classList.add('on'); void cursor.offsetWidth; cursor.style.transition = ''; }
    store.get(['teachVoice', 'teachAuto', 'teachCard']).then(async (o) => {
      if (!alive) return;
      setVoice(o.teachVoice !== 'off'); setAuto(o.teachAuto !== 'off');
      const was = o.teachCard;
      if (!inPanel && was && Number.isFinite(was.x) && Number.isFinite(was.y)) placeCard(was.x, was.y, Number.isFinite(was.w) ? was.w : null, Number.isFinite(was.h) ? was.h : null);
      await vet(steps);
      if (!alive) return;
      if (voiceOn) await decideVoice(0);
      if (!alive) return;
      const img = inPanel ? $('img') : null;
      if (img && !img.complete) img.onload = () => go(0); else go(0);
    });
    return current;
  }
  function stop() { if (current) current.close(); const old = document.getElementById(HOST_ID); if (old) old.remove(); current = null; }


  /* ---------- what Cassie is asked (the side panel and the page share these) ---------- */
  const TEACH_SHAPES = (numbered) => `Each step can draw up to 3 shapes ("draw"). x, y, w, h and r are shares of the picture from 0 to 1, and (0, 0) is its top left corner.
  ${numbered ? 'A shape can be about a numbered thing: {"shape":"circle","el":3}, {"shape":"box","el":3}, {"shape":"underline","el":3}, {"shape":"highlight","el":3}, {"shape":"arrow","to_el":3}.\n' : ''}{"shape":"circle","x":0.4,"y":0.3,"r":0.05}
  {"shape":"box","x":0.1,"y":0.2,"w":0.3,"h":0.1}
  {"shape":"underline","x":0.1,"y":0.25,"w":0.3}
  {"shape":"highlight","x":0.1,"y":0.2,"w":0.3,"h":0.05}
  {"shape":"arrow","from":[0.2,0.6],"to":[0.4,0.3]}
  {"shape":"line","from":[0.1,0.5],"to":[0.6,0.5]}
  {"shape":"curve","points":[[0.1,0.6],[0.3,0.4],[0.5,0.6]]}
  {"shape":"polygon","points":[[0.2,0.2],[0.4,0.2],[0.3,0.4]]}
  {"shape":"graph","fn":"x^2 - 4","xrange":[-4,4],"x":0.6,"y":0.1,"w":0.3,"h":0.3} (a small graph with its axes; fn uses * to multiply and ^ for powers)
  {"shape":"text","x":0.5,"y":0.1,"text":"a short label"}
  Draw only where it helps: circle or box the thing, an arrow to it, underline a key word, a graph for a function.`;
  function prompt({ q = '', page = null, snipped = false }) {
    const parts = page && !page.pictureOnly && !snipped && Array.isArray(page.items) ? page.items : [];
    const list = parts.map((p) => `${p.n}. ${p.what} at [${p.box.join(', ')}]`).join('\n');
    return `A student is studying ${snipped ? 'the part of their screen in this picture (they snipped it)' : 'what is on their screen right now (the picture)'}${page && page.title ? `, on a page called "${page.title}"` : ''}.
  ${page && page.text && !snipped ? `The words on the page (maybe cut short):\n"""\n${page.text}\n"""\n` : ''}${list ? `Things on the screen you can point at, numbered, each with its box [x, y, w, h] as shares of the picture:\n${list}\n` : ''}
  ${q ? `The student asks: "${q}"\nAnswer it, then show them on the screen, step by step, where the answer comes from.` : 'Teach it like a kind tutor sitting beside them: what it is, how to read it and the big ideas, in the order they should look at them. If there is a question on it, work it out with them step by step.'}
  Reply with ONLY minified JSON, no other text:
  {${q ? '"answer":"a short, clear answer in plain words, under 80 words",' : ''}"steps":[{"say":"one or two short, natural spoken sentences","point":${list ? '3' : '{"x":0.4,"y":0.3}'},"draw":[{"shape":"circle","x":0.4,"y":0.3,"r":0.05}]}]}
  Give 2 to 6 steps. "point" is where her arrow goes: ${list ? 'the number of the thing on the list, or {"x":0.4,"y":0.3} for a spot on the picture, or 0 for nothing.' : 'a spot on the picture, {"x":0.4,"y":0.3}, or null for nothing.'}
  ${TEACH_SHAPES(!!list)}
  ${ACCURATE}`;
  }
  // what keeps her lessons true to the page (the lesson and every follow-up)
  const ACCURATE = `Be accurate:
  - Teach only what this page or picture shows. Use the page's own words and terms, quoted, and never add facts, numbers, names or examples that are not on it.
  - If you cannot read a part clearly, say so in that step instead of guessing.
  - Point at and draw on the lesson itself only: never on the app's or browser's own toolbars, menus, tabs or page thumbnails, and never on empty space.
  No markdown, no emojis, no symbols that sound odd read aloud.`;
  // a question about the step on screen: answered from the same picture, and she may point and draw
  function followPrompt({ q, steps = [], at = 0, title = '', items = [] }) {
    const list = items.map((p) => `${p.n}. ${p.what} at [${p.box.join(', ')}]`).join('\n');
    return `A student is in a lesson about the page in this picture${title ? ` ("${title}")` : ''}. You (Cassie) taught these steps so far:
  ${steps.slice(0, at + 1).map((x, i) => `${i + 1}. ${x.say}`).join('\n')}
  The step on their screen now: "${(steps[at] || {}).say || ''}"
  ${list ? `Things on the screen you can point at, numbered, each with its box [x, y, w, h] as shares of the picture:\n${list}\n` : ''}The student asks: "${q}"
  Answer it like a kind tutor, from what the page shows, in under 80 words. Then show them where on the screen.
  Reply with ONLY minified JSON, no other text:
  {"answer":"your answer","point":${list ? '3' : '{"x":0.4,"y":0.3}'},"draw":[{"shape":"circle","x":0.4,"y":0.3,"r":0.05}]}
  "point" is where your arrow goes${list ? ' (a number on the list, a spot on the picture, or 0 for nothing)' : ' (a spot on the picture, or null for nothing)'}.
  ${TEACH_SHAPES(!!list)}
  ${ACCURATE}`;
  }
  function answer(reply) {
    const d = jsonOf(reply);
    return d && typeof d.answer === 'string' ? d.answer.trim().slice(0, 1500) : '';
  }
  // why a reply couldn't be used, as a code only (never its words): no JSON at all, cut off, or no usable steps
  function whyUnusable(reply) {
    const t = String(reply || '').replace(/```(?:json)?/gi, ''), i = t.indexOf('{');
    if (i < 0) return 'teach_not_json';
    return closeOf(t, i) < 0 ? 'teach_cut_off' : 'teach_no_steps';
  }
  const STRICT = `
  IMPORTANT: your last reply could not be read. Reply with ONLY the JSON object, nothing before or after it. At most 5 steps. Each "say" is at most 2 sentences.`;
  // One lesson from Cassie: send(prompt, maxTokens) → her reply. A reply that can't be used is asked
  // for once more, more strictly; only after both does the student see "couldn't make a lesson".
  // → { steps, answer }
  async function lessonFrom({ send, prompt: ask, count = 0, q = '' }) {
    for (let tries = 0; tries < 2; tries++) {
      const reply = await send(tries ? ask + STRICT : ask, 2000);
      const steps = parse(reply, count), said = q ? answer(reply) : '';
      if (steps.length || said) return { steps, answer: said || (q ? steps.map((x) => x.say).join(' ') : '') };
      if (tries) {
        try { chrome.runtime.sendMessage({ type: 'CASSIE_TEACH_FAIL', code: whyUnusable(reply) }).catch(() => {}); } catch (e) { /* the extension was reloaded */ }
      }
    }
    throw keyed('teach_failed');
  }
  // what went wrong, in plain words (CassieErrors): a missing key, no internet, too slow, or "try again"
  function problem(e) {
    const m = String((e && e.message) || e || '');
    if (m === 'no-key' || m === 'no-vision') return window.CassieErrors.say('teach_no_key');
    const w = window.CassieErrors.explain({ message: m }, 'teach_failed');
    return w === window.CassieErrors.say('unknown') ? window.CassieErrors.say('teach_failed') : w;
  }

  /* ---------- on a web page: Teach me and Ask from the floating Cassie button ---------- */
  // run({ q, snip: { image, region }, from: { x, y }, hideUi(hidden), again() }) → { answer, steps }
  // (again: starts the lesson over with a fresh look, when the page moved under her drawings)
  // She reads the page (its numbered parts, and a picture of the screen) only now, when asked.
  const keyed = (key) => Object.assign(new Error(key), { code: key });
  async function run({ q = '', snip = null, from = null, hideUi = () => {}, again = null } = {}) {
    stop();
    const page = snip ? null : scan();
    let image = snip ? snip.image : null;
    if (!image) {
      hideUi(true); followHide(true);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); // (her own buttons stay out of the picture)
      let out = null;
      try { out = await chrome.runtime.sendMessage({ type: 'CASSIE_SNIP' }); } catch (e) { out = null; } finally { hideUi(false); followHide(false); }
      image = out && out.dataUrl && !(out.full && out.full.std < 4) ? out.dataUrl : null;
      if (!image) throw keyed('teach_no_picture');
    }
    const send = async (ask, maxTokens) => {
      let r = null;
      try { r = await chrome.runtime.sendMessage({ type: 'CASSIE_VISION', image, prompt: ask, maxTokens }); } catch (e) { r = { error: e.message }; }
      if (!r || r.error) throw new Error((r && r.error) || 'teach failed');
      return r.reply;
    };
    const numbered = !!(page && !page.pictureOnly);
    const { steps, answer: said } = await lessonFrom({ send, prompt: prompt({ q, page: page || { title: document.title }, snipped: !!snip }), count: numbered ? page.items.length : 0, q });
    if (steps.length) show({ steps, title: document.title, q }, { region: snip ? snip.region : null, from, shot: image, numbered, again });
    return { answer: said, steps };
  }

  /* ---------- Cursor Cassie beside the mouse (on a page; a switch turns her on or off) ---------- */
  const FOLLOW_ID = 'cassie-follow-92f1';
  let follow = null, followOn = false, followHidden = false, lastPointer = null;
  function followPaint() { if (follow) follow.style.display = followOn && !followHidden && !current && lastPointer ? 'block' : 'none'; }
  function followSet(on) {
    followOn = !!on;
    if (followOn && !follow && document.documentElement) {
      follow = document.createElement('div');
      follow.id = FOLLOW_ID;
      Object.assign(follow.style, { position: 'fixed', left: '0', top: '0', width: '26px', height: '26px', zIndex: '2147483639', pointerEvents: 'none', display: 'none', transition: 'transform .12s ease-out' });
      follow.attachShadow({ mode: 'open' }).innerHTML = '<style>svg{width:26px;height:26px;fill:#fff;stroke:#141416;stroke-width:1.6;stroke-linejoin:round;filter:drop-shadow(0 2px 4px rgba(0,0,0,.35))}@media (prefers-reduced-motion: reduce){:host{transition:none!important}}</style>' + ARROW;
      document.documentElement.appendChild(follow);
      const a = followAt();
      if (a) follow.style.transform = `translate(${Math.round(a.x)}px, ${Math.round(a.y)}px)`;
    }
    followPaint();
  }
  function followHide(h) { followHidden = !!h; followPaint(); }
  // where her cursor sits: beside the pointer, down and to the right, so it never covers what the student points at
  const followAt = () => (lastPointer ? { x: lastPointer.x + 16, y: lastPointer.y + 18 } : null);

  window.CassieTeach = { parse, scan, show, stop, prompt, followPrompt, answer, problem, run, lessonFrom, follow: { set: followSet, hide: followHide, at: followAt, get on() { return followOn; } }, get active() { return !!current; } };

  // on a web page: the side panel asks for the parts, then shows the lesson (top frame only)
  const onCassieSite = document.querySelector('meta[name="cassie-app"]') || /(^|\.)askcassie\.pages\.dev$|(^|\.)usernamehaze\.github\.io$/.test(location.hostname);
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage && !/^chrome-extension:$|^moz-extension:$/.test(location.protocol) && window.top === window && !onCassieSite) {
    chrome.runtime.onMessage.addListener((msg, sender, reply) => {
      if (!msg) return false;
      if (msg.type === 'CASSIE_TEACH_PING') { reply({ ok: true }); return false; }
      if (msg.type === 'CASSIE_TEACH_SCAN') { stop(); reply(scan()); return false; }
      if (msg.type === 'CASSIE_TEACH_SHOW') {
        // (Look again: the side panel that asked starts the lesson over)
        const again = () => { try { chrome.runtime.sendMessage({ type: 'CASSIE_TEACH_AGAIN' }).catch(() => {}); } catch (e) { /* the extension was reloaded */ } };
        reply({ ok: !!show(msg.lesson, { region: msg.region || null, shot: msg.shot || null, from: followOn ? followAt() : null, numbered: msg.numbered !== false, again }) });
        return false;
      }
      if (msg.type === 'CASSIE_TEACH_STOP') { stop(); reply({ ok: true }); return false; }
      return false;
    });
    // Cursor Cassie beside the mouse: on or off from the floating menu or the side panel (remembered)
    addEventListener('pointermove', (e) => {
      lastPointer = { x: e.clientX, y: e.clientY };
      if (!followOn || !follow) return;
      const a = followAt();
      follow.style.transform = `translate(${Math.round(a.x)}px, ${Math.round(a.y)}px)`;
      followPaint();
    }, { passive: true, capture: true });
    store.get(['teachCursor']).then((o) => followSet(o.teachCursor === 'on'));
    try { chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && ch.teachCursor) followSet(ch.teachCursor.newValue === 'on'); }); } catch (e) { /* ignore */ }
  }
})();

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
  const INK = '#141416', HALO = '#ffffff';
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
  function parse(reply, count = 0) {
    const t = String(reply || '').replace(/```(?:json)?/gi, '');
    const i = t.indexOf('{'), j = t.lastIndexOf('}');
    if (i < 0 || j <= i) return [];
    let d = null;
    try { d = JSON.parse(t.slice(i, j + 1)); } catch (e) { return []; }
    return (Array.isArray(d && d.steps) ? d.steps : []).slice(0, 8).map((s) => {
      const say = s && typeof s.say === 'string' ? s.say.replace(/\s+/g, ' ').trim().slice(0, 400) : '';
      if (!say) return null; // (a step with nothing to say is skipped)
      const draw = (Array.isArray(s.draw) ? s.draw : []).map((x) => cleanShape(x, count)).filter(Boolean).slice(0, 4);
      return { say, point: cleanPoint(s.point, count), draw };
    }).filter(Boolean);
  }

  /* ---------- what's on the page, numbered for her (a web page only) ---------- */
  let parts = [];
  const CANVAS_APPS = /(^|\.)(docs|sheets|slides)\.google\.com$|(^|\.)(office|officeapps\.live|sharepoint|onedrive\.live|live)\.com$|(^|\.)(figma|canva)\.com$/;
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
      pictureOnly: CANVAS_APPS.test(location.hostname) || wordy < 3 || text.length < 200,
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
    .ct-card { position: fixed; right: 16px; bottom: 16px; width: min(380px, calc(100vw - 32px)); box-sizing: border-box; pointer-events: auto; z-index: 2147483641;
      background: #18181b; color: #f4f4f5; border: 1px solid rgba(255,255,255,.14); border-radius: 18px; padding: 12px 14px 14px; box-shadow: 0 18px 50px rgba(0,0,0,.35);
      font: 15px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
    .ct-card.ct-top { bottom: auto; top: 16px; }
    .ct-in-panel .ct-card { position: static; width: auto; margin-top: 10px; box-shadow: none; }
    .ct-head { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
    .ct-who { flex: 1; display: inline-flex; align-items: center; gap: 6px; font-weight: 700; font-size: 13px; }
    .ct-who svg { width: 16px; height: 16px; fill: #fff; }
    .ct-card button { all: unset; box-sizing: border-box; min-height: 44px; min-width: 44px; padding: 0 12px; border-radius: 12px; display: inline-flex; align-items: center; justify-content: center;
      font: 600 13px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #f4f4f5; background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.16); cursor: pointer; }
    .ct-card button:hover { background: rgba(255,255,255,.14); }
    .ct-card button:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
    .ct-card button[aria-pressed="false"] { opacity: .6; }
    .ct-card button:disabled { opacity: .35; cursor: default; }
    .ct-card .ct-next { background: #f4f4f5; color: #111; border-color: #f4f4f5; }
    .ct-say { margin: 4px 0 10px; min-height: 2.9em; }
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
      <div class="ct-card" role="dialog" aria-label="Cassie is teaching">
        <div class="ct-head"><span class="ct-who">${ARROW}Cassie is teaching</span>
          <button type="button" class="ct-voice" aria-pressed="true" title="Cassie’s voice on or off">Voice on</button>
          <button type="button" class="ct-auto" aria-pressed="true" title="Go on to the next step by itself">Auto</button>
          <button type="button" class="ct-x" aria-label="Stop teaching">✕</button></div>
        <p class="ct-say" aria-live="polite"></p>
        <div class="ct-nav"><button type="button" class="ct-back">Back</button><span class="ct-count"></span><button type="button" class="ct-next">Next</button></div>
      </div>`;
    root.appendChild(wrap);
    (inPanel ? opts.mount : document.documentElement).appendChild(host);
    const $ = (s) => root.querySelector(s);
    const layer = $('.ct-layer'), canvas = $('canvas'), cursor = $('.ct-cursor'), card = $('.ct-card'), sayEl = $('.ct-say');
    if (inPanel) $('img').src = opts.image;
    host.dataset.spoken = '0'; host.dataset.drawn = ''; host.dataset.step = '0';

    // the area her numbers are about: the whole screen, the snipped part of it, or the picture in the panel
    const sx0 = scrollX, sy0 = scrollY;
    const frame = () => {
      if (inPanel) { const r = layer.getBoundingClientRect(); return { left: 0, top: 0, width: r.width, height: r.height }; }
      const dx = scrollX - sx0, dy = scrollY - sy0, g = opts.region;
      return g ? { left: g.x * innerWidth - dx, top: g.y * innerHeight - dy, width: g.w * innerWidth, height: g.h * innerHeight }
        : { left: -dx, top: -dy, width: innerWidth, height: innerHeight };
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
    const boxPts = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]];
    function strokesOf(d) {
      const sizeK = Math.max(1, Math.min(innerWidth, innerHeight) / 700);
      const pen = (points, size = 3.2, tool = 'pen') => ({ tool, color: INK, size: size * sizeK, points });
      const r = d.el ? partRect(d.el) : null;
      if (d.el && !r) return [];
      switch (d.shape) {
        case 'circle': {
          if (r) return [pen(ring(r.left + r.width / 2, r.top + r.height / 2, r.width / 2 + 12, r.height / 2 + 10))];
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
            a = d.from ? at(d.from[0], d.from[1]) : [b[0] - 90 * sizeK, b[1] - 60 * sizeK];
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
    let drawn = [], raf = 0, ptr = null;
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
      dodge(t);
    }
    // the card never sits on what she points at
    function dodge(t) {
      if (inPanel) return;
      const r = t.rect || { left: t.x - 10, right: t.x + 10, top: t.y - 10, bottom: t.y + 10 };
      const c = card.getBoundingClientRect();
      const hits = !(r.right < c.left || r.left > c.right || r.bottom < c.top || r.top > c.bottom);
      if (hits) card.classList.toggle('ct-top');
    }

    /* voice: one voice for the whole lesson, picked now */
    let voiceOn = true, autoOn = true, at0 = 0, timer = 0, utter = null, alive = true;
    const synth = window.speechSynthesis || null;
    let voice = null;
    if (synth) { try { const vs = synth.getVoices(); voice = vs.find((v) => /^en(-|_)/i.test(v.lang) && v.localService) || vs.find((v) => /^en/i.test(v.lang)) || null; } catch (e) { voice = null; } }
    const hush = () => { clearTimeout(timer); timer = 0; if (synth && utter) { try { synth.cancel(); } catch (e) { /* ignore */ } } utter = null; };
    function speakThen(text, then) {
      hush();
      if (!voiceOn || !synth) { timer = setTimeout(then, Math.min(9000, 1400 + text.length * 45)); return; }
      const u = new SpeechSynthesisUtterance(text);
      if (voice) u.voice = voice;
      u.rate = 1;
      let done = false;
      const end = () => { if (done) return; done = true; if (utter === u) { utter = null; timer = setTimeout(then, 700); } };
      u.onend = end; u.onerror = end;
      utter = u;
      host.dataset.spoken = String(+host.dataset.spoken + 1);
      try { synth.speak(u); } catch (e) { end(); }
      timer = setTimeout(end, Math.min(20000, 3000 + text.length * 80)); // (a voice that never says "done")
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
      ptr = s.point;
      const t0 = performance.now();
      drawn = s.draw.map((spec, i) => ({ spec, t0: t0 + 350 + i * 600 }));
      host.dataset.drawn = s.draw.map((d) => d.shape).join(',');
      render(); later();
      s.draw.forEach((d, i) => setTimeout(later, 360 + i * 600)); // (each shape starts after the arrow arrives)
      speakThen(s.say, () => { if (autoOn && alive && at0 === k && k < steps.length - 1) go(k + 1); });
    }

    function close() {
      if (!alive) return;
      alive = false;
      hush();
      cancelAnimationFrame(raf);
      removeEventListener('scroll', later, true); removeEventListener('resize', later);
      removeEventListener('keydown', onKey, true);
      host.remove();
      if (current && current.host === host) current = null;
      if (opts.onClose) opts.onClose();
    }
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    addEventListener('scroll', later, true); addEventListener('resize', later);
    addEventListener('keydown', onKey, true);
    $('.ct-x').addEventListener('click', close);
    $('.ct-next').addEventListener('click', () => { if (at0 < steps.length - 1) go(at0 + 1); else close(); });
    $('.ct-back').addEventListener('click', () => go(Math.max(0, at0 - 1)));
    const setVoice = (on) => { voiceOn = on; const b = $('.ct-voice'); b.setAttribute('aria-pressed', String(on)); b.textContent = on ? 'Voice on' : 'Voice off'; };
    const setAuto = (on) => { autoOn = on; $('.ct-auto').setAttribute('aria-pressed', String(on)); };
    $('.ct-voice').addEventListener('click', () => {
      setVoice(!voiceOn); store.set({ teachVoice: voiceOn ? 'on' : 'off' });
      if (!voiceOn) { hush(); if (autoOn) speakThen(steps[at0].say, () => { if (autoOn && alive && at0 < steps.length - 1) go(at0 + 1); }); }
    });
    $('.ct-auto').addEventListener('click', () => {
      setAuto(!autoOn); store.set({ teachAuto: autoOn ? 'on' : 'off' });
      if (!autoOn) clearTimeout(timer);
    });

    current = { host, close };
    store.get(['teachVoice', 'teachAuto']).then((o) => {
      if (!alive) return;
      setVoice(o.teachVoice !== 'off'); setAuto(o.teachAuto !== 'off');
      const img = inPanel ? $('img') : null;
      if (img && !img.complete) img.onload = () => go(0); else go(0);
    });
    return current;
  }
  function stop() { if (current) current.close(); const old = document.getElementById(HOST_ID); if (old) old.remove(); current = null; }

  window.CassieTeach = { parse, scan, show, stop, get active() { return !!current; } };

  // on a web page: the side panel asks for the parts, then shows the lesson (top frame only)
  const onCassieSite = document.querySelector('meta[name="cassie-app"]') || /(^|\.)askcassie\.pages\.dev$|(^|\.)usernamehaze\.github\.io$/.test(location.hostname);
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage && !/^chrome-extension:$|^moz-extension:$/.test(location.protocol) && window.top === window && !onCassieSite) {
    chrome.runtime.onMessage.addListener((msg, sender, reply) => {
      if (!msg) return false;
      if (msg.type === 'CASSIE_TEACH_PING') { reply({ ok: true }); return false; }
      if (msg.type === 'CASSIE_TEACH_SCAN') { stop(); reply(scan()); return false; }
      if (msg.type === 'CASSIE_TEACH_SHOW') { reply({ ok: !!show(msg.lesson, { region: msg.region || null }) }); return false; }
      if (msg.type === 'CASSIE_TEACH_STOP') { stop(); reply({ ok: true }); return false; }
      return false;
    });
  }
})();

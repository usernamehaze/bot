/* Cassie's live drawing: ask about what is on the screen, and she draws while she explains.
 *
 * The student asks, typed or said. Cassie looks at the screen once, right then, and answers in a few
 * short beats. A beat is a sentence or two, and while it is said (or shown) she draws the next pieces
 * of a labelled drawing on a paper card beside the page: the outline first, then the parts in colour,
 * then arrows and labels, her cursor writing each one. Nothing is ready-made: her reply is a small
 * description of the scene, and this file draws it.
 *
 * One file, two homes (like teach.js):
 *  - on a web page (a content script, after teach.js): CassieLive.ask({ q }) does all of it.
 *  - in the side panel: the same card, in the panel, for tabs she can't draw on.
 *
 * When the student asks for 3D, or to be shown how parts go together, the scene is a 3D model instead:
 * built part by part over the page by the Cassie app's own model builder (livedraw.js, with three.js
 * from this folder, both loaded only then). Where 3D can't show, the same answer is a flat drawing.
 *
 *   CassieLive.parse(reply, count) → { kind, answer, scene, steps }
 *       kind 'card': scene { title, caption, view, about, beats: [{ say, parts }] } (bad parts are left out),
 *                    or scene { dim: '3d', spec, beats: [{ say, part }] } for a 3D model
 *       kind 'page': steps for CassieTeach.show (she points at the page instead)
 *       kind 'words': only an answer          kind '': nothing that can be used
 *   CassieLive.prompt({ q, page, draw, scene, said }) → what Cassie is asked
 *   CassieLive.play(scene, opts) → the card { host, close }      CassieLive.stop() ends it
 *   CassieLive.from({ send, ask, count, draw }) → one reply, read (asked once more, more strictly, when it can't be used)
 *   CassieLive.ask({ q, from, hideUi, again }) → on a page: one picture of the tab, her reply, and the drawing
 *   CassieLive.wants(q) → the question asks for a drawing ("draw", "sketch", "a diagram of", "show me how")
 *   CassieLive.wants3d(q) → it asks for a 3D model ("in 3D", or to be shown how parts go together), and 3D can show here
 *   CassieLive.has3d → the 3D model builder has been asked for (it loads only then)
 *   CassieLive.problem(err) → what went wrong, in plain words (CassieErrors)
 */
(function () {
  'use strict';
  if (window.CassieLive) return;

  const HOST_ID = 'cassie-live-host-92f1';
  const NS = 'http://www.w3.org/2000/svg';
  const GW = 100, GH = 75;   // her grid: the card is 100 units wide and 75 tall
  const K = 10;              // drawn ten times as big, so every size is a whole number
  const say = (key, vars) => (window.CassieErrors ? window.CassieErrors.say(key, vars) : '');
  const keyed = (key) => Object.assign(new Error(key), { code: key });
  const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));

  /* ---------- reading Cassie's reply: only what makes sense is kept ---------- */
  const COLORS = ['ink', 'grey', 'blue', 'red', 'green', 'yellow', 'orange', 'purple'];
  const COLOR_AS = { gray: 'grey', black: 'ink', dark: 'ink', pink: 'red', amber: 'yellow', gold: 'yellow', violet: 'purple', brown: 'orange', teal: 'green', cyan: 'blue', silver: 'grey' };
  const SHAPE_AS = { path: 'curve', spline: 'curve', polyline: 'line', polygon: 'outline', shape: 'outline', area: 'outline', blob: 'outline', rect: 'box', rectangle: 'box', square: 'box', ellipse: 'oval', text: 'label', sticky: 'note' };
  const MOST = { beats: 8, parts: 8, all: 40, points: 24 };
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(+v) ? +v : null);
  const words = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
  const colour = (v, or) => { const c = String(v == null ? '' : v).toLowerCase().trim(); const name = COLOR_AS[c] || c; return COLORS.includes(name) ? name : or; };

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
  const wordOf = (t, key) => { const m = t.match(new RegExp('"' + key + '"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"')); if (!m) return ''; try { return JSON.parse('"' + m[1] + '"'); } catch (e) { return ''; } };
  // Her JSON, read kindly: with words around it, or cut off at the length limit (the beats that arrived whole are kept)
  function jsonOf(reply) {
    const t = String(reply || '').replace(/```(?:json)?/gi, '');
    const i = t.indexOf('{');
    if (i < 0) return null;
    const j = closeOf(t, i);
    if (j > 0) { try { return JSON.parse(t.slice(i, j + 1)); } catch (e) { /* the whole beats are picked out below */ } }
    // every whole {…} in the list called key (the one that was cut off is left out)
    const whole = (key) => {
      const s = t.search(new RegExp('"' + key + '"\\s*:\\s*\\[')), out = [];
      if (s < 0) return out;
      for (let k = t.indexOf('[', s) + 1; k < t.length;) {
        while (k < t.length && /[\s,]/.test(t[k])) k++;
        if (t[k] !== '{') break;
        const e = closeOf(t, k);
        if (e < 0) break;
        try { out.push(JSON.parse(t.slice(k, e + 1))); } catch (err) { break; }
        k = e + 1;
      }
      return out;
    };
    const beats = whole('beats'), parts = beats.length ? [] : whole('parts');
    if (parts.length && /"mode"\s*:\s*"3d"/.test(t)) return { answer: wordOf(t, 'answer'), title: wordOf(t, 'title'), intro: wordOf(t, 'intro'), mode: '3d', axis: wordOf(t, 'axis'), parts };
    if (parts.length && /"mode"\s*:\s*"2d"/.test(t)) return { answer: wordOf(t, 'answer'), title: wordOf(t, 'title'), intro: wordOf(t, 'intro'), mode: '2d', layout: wordOf(t, 'layout'), parts };
    if (!beats.length) return null;
    let about = null;
    const a = t.match(/"about"\s*:\s*(\[[^\]]*\]|\d+)/);
    if (a) { try { about = JSON.parse(a[1]); } catch (e) { about = null; } }
    return { answer: wordOf(t, 'answer'), title: wordOf(t, 'title'), caption: wordOf(t, 'caption'), view: wordOf(t, 'view'), keep: /"keep"\s*:\s*true/.test(t), about, beats };
  }

  // Her numbers are on the 100 by 75 grid. A reply that used shares of the card (0 to 1) instead is read as that.
  function inShares(beats) {
    let most = 0, seen = false;
    const look = (v) => { v = num(v); if (v != null) { seen = true; most = Math.max(most, Math.abs(v)); } };
    const walk = (p) => { if (Array.isArray(p)) p.forEach((q) => (Array.isArray(q) ? walk(q) : look(q))); };
    beats.forEach((b) => (Array.isArray(b && (b.draw || b.parts)) ? (b.draw || b.parts) : []).forEach((d) => {
      if (!d || typeof d !== 'object' || d.shape === 'graph') return;
      ['x', 'y', 'w', 'h', 'r', 'rx', 'ry'].forEach((key) => look(d[key]));
      walk(d.points); walk(d.to); walk(d.from);
    }));
    return seen && most <= 1.5;
  }
  function reader(shares) {
    const on = (v, size) => { v = num(v); if (v == null) return null; if (shares) v *= size; return v < -12 || v > size + 12 ? null : Math.round(clamp(v, 0, size) * 10) / 10; };
    const X = (v) => on(v, GW), Y = (v) => on(v, GH);
    const long = (v, size) => { v = num(v); if (v == null || v <= 0) return null; return Math.round(Math.min(size, shares ? v * size : v) * 10) / 10; };
    const pt = (p) => { const x = X(Array.isArray(p) ? p[0] : p && p.x), y = Y(Array.isArray(p) ? p[1] : p && p.y); return x == null || y == null ? null : [x, y]; };
    const pts = (list) => (Array.isArray(list) ? list.slice(0, MOST.points).map(pt).filter(Boolean) : []);
    return { X, Y, long, pt, pts };
  }
  function cleanPart(d, R) {
    if (!d || typeof d !== 'object') return null;
    const named = String(d.shape || d.type || '').toLowerCase().trim(), shape = SHAPE_AS[named] || named;
    const color = colour(d.color != null ? d.color : d.colour, 'ink');
    const fill = d.fill === true || d.fill === 1 ? color : colour(d.fill, null);
    const x = R.X(d.x), y = R.Y(d.y);
    let pts = R.pts(d.points);
    if (pts.length < 2 && d.from && d.to) pts = [R.pt(d.from), R.pt(d.to)].filter(Boolean);
    switch (shape) {
      case 'curve': return pts.length >= 2 ? { shape, points: pts, color, ...(d.dash ? { dash: 1 } : {}) } : null;
      case 'line': return pts.length >= 2 ? { shape, points: pts, color, ...(d.dash ? { dash: 1 } : {}) } : null;
      case 'outline': return pts.length >= 3 ? { shape, points: pts, color, ...(fill ? { fill } : {}), ...(d.sharp || named === 'polygon' ? { sharp: 1 } : {}) } : null;
      case 'arrow': return pts.length >= 2 ? { shape, points: pts, color } : null;
      case 'box': {
        const w = R.long(d.w, GW), h = R.long(d.h, GH);
        return x != null && y != null && w >= 1 && h >= 1 ? { shape, x, y, w: Math.min(w, GW - x), h: Math.min(h, GH - y), color, ...(fill ? { fill } : {}) } : null;
      }
      case 'circle': case 'oval': {
        const rx = R.long(d.rx != null ? d.rx : d.r != null ? d.r : num(d.w) / 2, GW), ry = shape === 'circle' && d.r != null ? rx : R.long(d.ry != null ? d.ry : d.r != null ? d.r : num(d.h) / 2, shape === 'circle' ? GW : GH);
        return x != null && y != null && rx >= 0.5 && ry >= 0.5 ? { shape: 'oval', x, y, rx, ry, color, ...(fill ? { fill } : {}) } : null;
      }
      case 'label': {
        const text = words(d.text != null ? d.text : d.label, 40), to = R.pt(d.to);
        return text && x != null && y != null ? { shape, x, y, text, ...(to ? { to } : {}), color } : null;
      }
      case 'note': {
        const text = words(d.text, 80);
        return text && x != null && y != null ? { shape, x, y, text } : null;
      }
      case 'graph': {
        const fn = words(d.fn, 80), bx = num(d.x), by = num(d.y), bw = num(d.w), bh = num(d.h);
        if (!fn || [bx, by, bw, bh].some((v) => v == null) || !window.CassieBoard) return null;
        const k = Math.max(bx, by, bw, bh) <= 1.5 ? [GW, GH] : [1, 1]; // (its box may come as shares too)
        const box = { x: clamp(bx * k[0], 0, GW - 10), y: clamp(by * k[1], 0, GH - 10), w: bw * k[0], h: bh * k[1] };
        box.w = Math.min(box.w, GW - box.x); box.h = Math.min(box.h, GH - box.y);
        if (box.w < 10 || box.h < 10) return null;
        try { const g = window.CassieBoard.compile(fn); if (!Number.isFinite(g(0.5)) && !Number.isFinite(g(1.5))) return null; } catch (e) { return null; }
        const xr = Array.isArray(d.xrange) && d.xrange.length === 2 && d.xrange.every(Number.isFinite) && d.xrange[0] < d.xrange[1] ? d.xrange : [-5, 5];
        return { shape, fn, xrange: xr, ...box, color: colour(d.color, 'blue') };
      }
    }
    return null;
  }
  // how much room a label's words take on her grid (for keeping labels on the card and off each other)
  const LABEL = { size: 3.8, line: 4.6, wide: 0.56, most: 12 };
  function wrap(text, most, lines) {
    const out = [];
    let cur = '';
    String(text).split(' ').forEach((w) => { if (!cur) cur = w; else if ((cur + ' ' + w).length <= most) cur += ' ' + w; else { out.push(cur); cur = w; } });
    if (cur) out.push(cur);
    if (out.length > lines) { out.length = lines; out[lines - 1] = out[lines - 1].slice(0, most - 1).trimEnd() + '…'; }
    return out.map((l) => (l.length > most + 4 ? l.slice(0, most + 3) + '…' : l));
  }
  const NOTE_AT = { most: 16, size: 3.4, line: 4.2 };
  const labelBox = (p) => {
    if (p.shape === 'note') { const lines = wrap(p.text, NOTE_AT.most, 3); return { w: Math.max(...lines.map((l) => l.length)) * NOTE_AT.size * LABEL.wide + 4.4, h: lines.length * NOTE_AT.line + 3.2 }; }
    const lines = wrap(p.text, LABEL.most, 2);
    return { w: Math.max(...lines.map((l) => l.length)) * LABEL.size * LABEL.wide + 2, h: lines.length * LABEL.line };
  };
  // labels and notes stay on the card, and one that would sit on an earlier one moves down or up, clear of it
  function tidy(beats) {
    const placed = [];
    beats.forEach((b) => b.parts.forEach((p) => {
      if (p.shape !== 'label' && p.shape !== 'note') return;
      const { w, h } = labelBox(p);
      const fit = () => { p.x = clamp(p.x, w / 2 + 1, GW - w / 2 - 1); p.y = clamp(p.y, h / 2 + 1, GH - h / 2 - 1); };
      fit();
      for (let pass = 0; pass < 6; pass++) {
        const hit = placed.find((o) => Math.abs(o.x - p.x) < (o.w + w) / 2 + 0.6 && Math.abs(o.y - p.y) < (o.h + h) / 2 + 0.4);
        if (!hit) break;
        const down = p.y >= hit.y ? 1 : -1, room = (hit.h + h) / 2 + 0.8;
        let y = hit.y + down * room;
        if (y < h / 2 + 1 || y > GH - h / 2 - 1) y = hit.y - down * room; // (no room that way: the other side)
        p.y = Math.round(y * 10) / 10;
        fit();
      }
      placed.push({ x: p.x, y: p.y, w, h });
    }));
  }
  function cleanAbout(a, count) {
    if (typeof a === 'number' || (typeof a === 'string' && /^\d+$/.test(a))) { const n = +a; return n >= 1 && n <= count ? { el: n } : null; }
    const share = (v) => { v = num(v); return v == null || v < -0.05 || v > 1.05 ? null : clamp(v); };
    if (Array.isArray(a) && a.length >= 4) { const [x, y, w, h] = a.map(share); return [x, y, w, h].every((v) => v != null) && w > 0 && h > 0 ? { x, y, w, h } : null; }
    if (a && typeof a === 'object') {
      const x = share(a.x), y = share(a.y), w = share(a.w), h = share(a.h);
      if (x != null && y != null) return { x, y, w: w || 0.02, h: h || 0.02 };
    }
    return null;
  }
  function cleanScene(d, count = 0) {
    const raw = Array.isArray(d.beats) ? d.beats : [];
    const R = reader(inShares(raw));
    const beats = [];
    let all = 0;
    raw.slice(0, MOST.beats).forEach((b) => {
      if (!b || typeof b !== 'object') return;
      const said = words(b.say, 400);
      const list = Array.isArray(b.draw) ? b.draw : Array.isArray(b.parts) ? b.parts : [];
      const parts = list.slice(0, 16).map((p) => cleanPart(p, R)).filter(Boolean).slice(0, MOST.parts).filter(() => all++ < MOST.all);
      if (!said && !parts.length) return;
      if (!said && beats.length) { beats[beats.length - 1].parts.push(...parts); return; } // (drawn with nothing said: it joins the beat before)
      beats.push({ say: said, parts });
    });
    tidy(beats);
    return { title: words(d.title, 60), caption: words(d.caption, 90), view: words(d.view, 30), about: cleanAbout(d.about, count), keep: d.keep === true, beats };
  }
  function parse(reply, count = 0) {
    const T = window.CassieTeach;
    const d = jsonOf(reply);
    const answer = words(d && d.answer, 1500) || (T ? T.answer(reply) : '');
    // a 3D model: one beat for each part she builds (the parts are made safe by the model builder itself)
    if (d && d.mode === '3d' && Array.isArray(d.parts)) {
      const parts = d.parts.slice(0, 10).filter((x) => x && typeof x === 'object' && Array.isArray(x.shapes) && x.shapes.some((sh) => sh && typeof sh === 'object'));
      if (parts.length) {
        const intro = words(d.intro, 300), sum = words(d.summary, 300), beats = [];
        if (intro) beats.push({ say: intro, parts: [] });
        parts.forEach((x, i) => beats.push({ say: words(x.say, 360) || words(x.label, 40), parts: [], part: i }));
        if (sum) beats.push({ say: sum, parts: [] });
        return { kind: 'card', answer: answer || intro || beats.map((b) => b.say).join(' '), scene: { dim: '3d', spec: { ...d, parts }, title: words(d.title, 60) || 'How it works', caption: sum, view: '3D model', about: cleanAbout(d.about, count), keep: false, beats }, steps: [] };
      }
    }
    // a flat drawing in the Cassie app's form: one beat for each part she draws, named as it is drawn
    if (d && d.mode !== '3d' && Array.isArray(d.parts)) {
      const parts = d.parts.slice(0, 8).filter((x) => x && typeof x === 'object' && Array.isArray(x.shapes) && x.shapes.some((sh) => sh && typeof sh === 'object'));
      if (parts.length) {
        const intro = words(d.intro, 300), sum = words(d.summary, 300), beats = [];
        if (intro) beats.push({ say: intro, parts: [] });
        parts.forEach((x, i) => beats.push({ say: words(x.say, 360) || words(x.label, 40), parts: [], part: i }));
        if (sum) beats.push({ say: sum, parts: [] });
        return { kind: 'card', answer: answer || intro || beats.map((b) => b.say).join(' '), scene: { dim: 'flat', spec: { ...d, mode: '2d', parts }, title: words(d.title, 60) || 'How it works', caption: sum, view: '', about: cleanAbout(d.about, count), keep: false, beats }, steps: [] };
      }
    }
    const scene = d && Array.isArray(d.beats) ? cleanScene(d, count) : null;
    const said = scene ? scene.beats.map((b) => b.say).filter(Boolean).join(' ') : '';
    if (scene && scene.beats.some((b) => b.parts.length)) return { kind: 'card', answer: answer || said, scene, steps: [] };
    const steps = T ? T.parse(reply, count) : [];
    if (steps.length) return { kind: 'page', answer: answer || steps.map((x) => x.say).join(' '), scene: null, steps };
    return { kind: answer || said ? 'words' : '', answer: answer || said, scene: scene && said ? scene : null, steps: [] };
  }

  /* ---------- what Cassie is asked ---------- */
  // (the same words the Cassie app takes as "draw it"; but "this diagram" on the screen is a thing to explain, not an order to draw)
  const WANTS = /\b(draw|redraw|sketch|illustrate|visuali[sz]e|iguhit|ipakita)\b|\bi-?drawing\b|\b(make|create|give|show|do|build)\b[^.?!]{0,24}\b(drawing|sketch|diagram|illustration|model)\b|\bdiagram of\b|\bshow\b[^.?!]{0,20}\bhow\b|\b(explain|teach)\b[^.?!]*\b(with|using|in)\s+(a\s+)?(drawing|diagram|graphics?|visuals?|3d)\b|\bin\s+3d\b|\b3d\b|\bthree[\s-]?d\b|\bturn\s+it\s+around\b|\brotate\s+it\b|\bfrom\s+all\s+sides\b/i;
  const wants = (q) => WANTS.test(String(q || ''));
  // 3D is for when the student asks for it, or asks to be shown how parts go together. Where 3D can't show
  // (no WebGL, or Reduce Motion), the same answer is a flat drawing.
  const WANTS_3D = /\b3d\b|\bthree[\s-]?d\b|\bturn\s+it\s+around\b|\brotate\s+it\b|\bfrom\s+all\s+sides\b/i;
  const FITS = /\b(attach|assembl|connect|install|plug|insert|mount|screw)\w*|\bput\b[^.?!]{0,20}\btogether\b|\bfits?\b[^.?!]{0,12}\b(in|into|onto|together)\b/i;
  // soft and living things, and processes: her 3D is made of simple solids and would look wrong, so these are drawn flat
  const SOFT = /\b(heart|lungs?|brain|kidneys?|liver|stomach|intestines?|eyes?|ears?|skin|muscles?|bones?|skeleton|tooth|teeth|tongue|nerves?|neurons?|veins?|arter(y|ies)|blood|organs?|body|digestive|respiratory|circulatory|nervous system|cells?|bacteri\w*|virus\w*|dna|plants?|lea(f|ves)|flowers?|roots?|seeds?|trees?|animals?|insects?|fish|birds?|frogs?|butterfl\w*|puso|baga|utak|halaman|dahon|bulaklak|hayop|cycle|photosynthesis|respiration|digestion|mitosis|meiosis|evaporation|erosion|food (chain|web)|ecosystem)\b/i;
  const glOk = () => { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; } };
  const stillNow = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const can3d = () => glOk() && !stillNow();
  const wants3d = (q) => { const t = String(q || ''); return (WANTS_3D.test(t) || (WANTS.test(t) && FITS.test(t))) && can3d(); };
  // the Cassie app's model builder, with three.js from this folder (both loaded only when a 3D model is asked for)
  let lib3d = null;
  const load3d = () => (lib3d || (lib3d = import(chrome.runtime.getURL('livedraw.js')).then((m) => {
    m.useThree(() => Promise.all([import(chrome.runtime.getURL('vendor/three.module.min.js')), import(chrome.runtime.getURL('vendor/OrbitControls.js'))]).then(([T, oc]) => ({ T, OrbitControls: oc.OrbitControls })));
    return m;
  }).catch((e) => { lib3d = null; throw e; })));
  // what she is told about building in 3D: the plan-first guide is the Cassie app's own (liveDrawPrompt in app.js)
  const GUIDE_3D = `Students learn from this: every fact, label, direction and count MUST be correct. If you are not sure of something, leave that part out.
  First think how the real object is built: its real parts, which part holds or contains which, how big each one is against the whole, and how they line up and connect. Then build the model to match that plan:
  - every part touches or sits inside the part it connects to; nothing floats in the air
  - parts that are inside a case are placed inside it, and the case is "shell": true so the student can open it
  - real proportions: a part that is small in the real object is small here; a part inside another is smaller than it
  - parts that turn get "spin": true; hot or glowing parts get "glow": true
  {"answer":the direct answer in one or two short sentences,"about":[x,y,w,h] the box around the thing on their screen the question is about, as shares of the picture from 0 to 1, or null,"title","mode":"3d","axis":the model's main length "x"|"y"|"z","intro":one sentence that says what you see on their screen,"summary":one sentence,"note":one short warning or tip for a sticky note (leave it out when there is none),"parts":[{"id","label":1 to 3 words,"say":1 or 2 short sentences,"color":"#hex","inside":the id of the part it sits in, or null,"attached":[ids of the parts it touches],"size":how big it really is (its longest side) against the whole object, 0 to 1,"shell","spin","glow","shapes":[...]}]}
  3 to 8 parts in building order, 1 to 8 shapes each. Each part is built while its "say" is said. The whole model about 6 units long, centred on 0,0,0. Every shape has "pos":[x,y,z] and, when it has a length, "axis":"x"|"y"|"z".
  Shapes: cylinder {r,r2,len,axis,pos,open,cut}, disc {r,thick,axis,pos}, cone {r,len,axis,pos,dir}, sphere {r,pos,cut}, box {size:[w,h,d],pos}, torus {r,tube,axis,pos}, blades {n,len,width,hub,axis,pos}, capsule {r,len,axis,pos}, pipe {pts:[[x,y,z],...],r} (a tube, hose or cable through 2 to 8 points), arrow {pts:[[x,y,z],...],r} (a flow or a push; its head is at the last point), lathe {profile:[[radius,along],...],axis,pos} (a profile turned round the axis), plate {outline:[[a,b],...],thick,axis,pos} (a flat board; its outline lies across the axis).
  To show how something is put together, give the part that moves "from":[dx,dy,dz], where it starts away from its place: it slides in. "view":"front"|"back"|"left"|"right"|"top" on a part turns the model to that side when it is built.`;
  // A flat drawing is asked for in the Cassie app's own form, with its three examples (the same ones, word for word).
  const FLAT_EXAMPLES = [
    {"title":"How photosynthesis works","mode":"2d","layout":"a leaf in the middle on its stem; the sun top left; CO2 coming in from the left; water rising from the roots; O2 leaving top right; glucose bottom right","intro":"A leaf makes its own food from light, air and water.","summary":"Light, carbon dioxide and water make glucose and release oxygen in the chloroplast.","photo":"a real green leaf on a plant in bright sunlight, close up, showing its veins","parts":[{"id":"sun","label":"Sunlight","say":"Sunlight gives the leaf the energy it needs.","color":"#ffd29e","box":[30,30,126,78],"anchor":[54,54],"shapes":[{"t":"circle","cx":54,"cy":54,"r":18,"fill":true},{"t":"line","x1":54,"y1":28,"x2":54,"y2":20},{"t":"line","x1":28,"y1":54,"x2":20,"y2":54},{"t":"line","x1":36,"y1":36,"x2":30,"y2":30},{"t":"arrow","x1":76,"y1":66,"x2":152,"y2":104}]},{"id":"leaf","label":"Leaf","say":"The leaf is a thin green blade with veins that carry water and food.","color":"#8fe0b0","box":[136,70,200,170],"anchor":[214,170],"shapes":[{"t":"path","d":"M150 190 C170 120 250 70 330 80 C320 150 250 200 150 190 Z","fill":true},{"t":"path","d":"M150 190 Q240 140 330 80"},{"t":"line","x1":200,"y1":160,"x2":204,"y2":132},{"t":"line","x1":200,"y1":160,"x2":226,"y2":178},{"t":"line","x1":250,"y1":128,"x2":252,"y2":100},{"t":"line","x1":250,"y1":128,"x2":282,"y2":146},{"t":"line","x1":150,"y1":190,"x2":140,"y2":236}]},{"id":"chloro","label":"Chloroplast","say":"Inside the leaf cells, chloroplasts catch the light with green chlorophyll.","color":"#7ee0e0","box":[244,108,36,24],"anchor":[262,120],"shapes":[{"t":"ellipse","cx":262,"cy":120,"rx":16,"ry":9,"fill":true},{"t":"path","d":"M251 117 L273 117"},{"t":"path","d":"M251 123 L273 123"}]},{"id":"co2","label":"Carbon dioxide in","say":"Carbon dioxide from the air enters through tiny holes called stomata.","color":"#a3a3ad","box":[16,130,148,40],"anchor":[90,152],"shapes":[{"t":"text","x":20,"y":142,"text":"CO2"},{"t":"arrow","x1":20,"y1":152,"x2":160,"y2":152},{"t":"arrow","x1":20,"y1":164,"x2":154,"y2":164}]},{"id":"water","label":"Water from roots","say":"The roots take in water, and it travels up the stem to the leaf.","color":"#7fb0ff","box":[118,196,48,60],"anchor":[147,216],"shapes":[{"t":"path","d":"M140 236 L124 252"},{"t":"path","d":"M140 236 L156 252"},{"t":"path","d":"M140 236 L140 254"},{"t":"arrow","x1":147,"y1":234,"x2":147,"y2":198},{"t":"text","x":152,"y":230,"text":"H2O"}]},{"id":"o2","label":"Oxygen out","say":"Oxygen is made and leaves the leaf into the air.","color":"#c9a7ff","box":[296,20,92,80],"anchor":[360,34],"shapes":[{"t":"arrow","x1":300,"y1":96,"x2":352,"y2":44},{"t":"circle","cx":360,"cy":34,"r":6},{"t":"circle","cx":374,"cy":30,"r":6},{"t":"text","x":352,"y":58,"text":"O2"}]},{"id":"gluc","label":"Glucose","say":"Glucose, a sugar, is the food the plant makes and uses to grow.","color":"#ffb067","box":[268,126,100,104],"anchor":[330,193],"shapes":[{"t":"arrow","x1":270,"y1":128,"x2":318,"y2":182},{"t":"poly","pts":[[318,186],[330,180],[342,186],[342,200],[330,206],[318,200],[318,186]],"fill":true},{"t":"text","x":296,"y":226,"text":"C6H12O6"}]}]},
    {"title":"A house being built","mode":"2d","layout":"side view; the ground at y 232; the house 60 to 340 wide; the roof peak at y 40","intro":"A house goes up from the ground: foundation, floor, walls, then roof.","summary":"Foundation, floor joists, wall studs, top plate, roof trusses, then sheathing closes it in.","photo":"a real timber frame house under construction on a building site, concrete foundation, exposed wall studs and roof trusses, partly covered with plywood sheathing","parts":[{"id":"found","label":"Foundation","say":"First a concrete foundation is poured into the ground to carry the weight.","color":"#a3a3ad","box":[56,206,288,30],"shapes":[{"t":"line","x1":20,"y1":232,"x2":380,"y2":232},{"t":"rect","x":60,"y":208,"w2":280,"h":24,"fill":true},{"t":"line","x1":60,"y1":220,"x2":340,"y2":220,"dash":true}],"anchor":[200,220]},{"id":"joists","label":"Floor joists","say":"Wooden joists lie across the foundation to hold up the floor.","color":"#ffb067","box":[58,196,284,12],"shapes":[{"t":"line","x1":60,"y1":200,"x2":340,"y2":200},{"t":"line","x1":60,"y1":206,"x2":340,"y2":206},{"t":"line","x1":100,"y1":200,"x2":100,"y2":206},{"t":"line","x1":160,"y1":200,"x2":160,"y2":206},{"t":"line","x1":220,"y1":200,"x2":220,"y2":206},{"t":"line","x1":280,"y1":200,"x2":280,"y2":206}],"anchor":[160,203]},{"id":"studs","label":"Wall studs","say":"Upright studs about 40 cm apart make the wall frame.","color":"#ffd29e","box":[60,118,280,82],"shapes":[{"t":"line","x1":64,"y1":198,"x2":64,"y2":120},{"t":"line","x1":104,"y1":198,"x2":104,"y2":120},{"t":"line","x1":144,"y1":198,"x2":144,"y2":120},{"t":"rect","x":168,"y":150,"w2":44,"h":48},{"t":"line","x1":232,"y1":198,"x2":232,"y2":120},{"t":"line","x1":272,"y1":198,"x2":272,"y2":120},{"t":"line","x1":312,"y1":198,"x2":312,"y2":120},{"t":"line","x1":336,"y1":198,"x2":336,"y2":120}],"anchor":[272,160]},{"id":"plate","label":"Top plate","say":"A top plate ties the studs together and carries the roof.","color":"#c9a7ff","box":[58,112,284,10],"shapes":[{"t":"line","x1":60,"y1":116,"x2":340,"y2":116},{"t":"line","x1":60,"y1":120,"x2":340,"y2":120}],"anchor":[200,118]},{"id":"truss","label":"Roof trusses","say":"Triangle trusses sit on top. Triangles keep the roof strong and stiff.","color":"#7fb0ff","box":[46,38,308,80],"shapes":[{"t":"poly","pts":[[48,116],[200,40],[352,116],[48,116]]},{"t":"line","x1":200,"y1":40,"x2":200,"y2":116},{"t":"line","x1":124,"y1":78,"x2":160,"y2":116},{"t":"line","x1":276,"y1":78,"x2":240,"y2":116}],"anchor":[200,80]},{"id":"sheath","label":"Sheathing","say":"Plywood sheathing is nailed on to close in the walls and roof.","color":"#8fe0b0","box":[60,40,148,160],"shapes":[{"t":"poly","pts":[[48,116],[200,40],[200,52],[72,116]],"fill":true},{"t":"rect","x":64,"y":122,"w2":80,"h":76,"fill":true}],"anchor":[104,160]}]},
    {"title":"The water cycle","mode":"2d","layout":"the sea along the bottom, a hill on the right, the sun top right, a cloud in the middle top","intro":"Water keeps moving between the sea, the sky and the land.","summary":"Evaporate, condense, fall, collect, and it starts again.","photo":"a real landscape with the sea, a hill, clouds and rain falling, on a sunny day","parts":[{"id":"sea","label":"Ocean","say":"Most water is in the oceans, lakes and rivers.","color":"#7fb0ff","box":[10,206,380,46],"shapes":[{"t":"path","d":"M10 222 Q60 210 110 222 T210 222 T310 222 T390 222","fill":false},{"t":"path","d":"M10 222 L10 250 L390 250 L390 222","fill":false}],"anchor":[200,236]},{"id":"sun","label":"Sun","say":"The sun heats the water.","color":"#ffd29e","box":[318,24,64,64],"shapes":[{"t":"circle","cx":350,"cy":56,"r":20,"fill":true},{"t":"line","x1":350,"y1":28,"x2":350,"y2":20},{"t":"line","x1":322,"y1":56,"x2":314,"y2":56},{"t":"line","x1":330,"y1":36,"x2":324,"y2":30}],"anchor":[350,56]},{"id":"evap","label":"Evaporation","say":"Warm water turns into vapour and rises.","color":"#8fe0b0","box":[100,110,70,96],"shapes":[{"t":"arrow","x1":112,"y1":204,"x2":112,"y2":116},{"t":"arrow","x1":136,"y1":204,"x2":136,"y2":116},{"t":"arrow","x1":160,"y1":204,"x2":160,"y2":116}],"anchor":[136,160]},{"id":"cloud","label":"Condensation","say":"High up the vapour cools into tiny drops: clouds.","color":"#a3a3ad","box":[150,40,124,48],"shapes":[{"t":"path","d":"M154 84 Q150 62 172 62 Q178 42 202 48 Q222 36 238 54 Q264 54 266 72 Q272 86 254 86 Z","fill":true},{"t":"path","d":"M182 70 Q194 62 206 70"}],"anchor":[210,66]},{"id":"rain","label":"Precipitation","say":"When the drops get heavy they fall as rain.","color":"#7ee0e0","box":[176,92,80,40],"shapes":[{"t":"line","x1":190,"y1":94,"x2":184,"y2":124,"dash":true},{"t":"line","x1":214,"y1":94,"x2":208,"y2":124,"dash":true},{"t":"line","x1":238,"y1":94,"x2":232,"y2":124,"dash":true}],"anchor":[214,108]},{"id":"runoff","label":"Runoff","say":"Rain runs down the land back to the sea.","color":"#c9a7ff","box":[240,140,140,82],"shapes":[{"t":"path","d":"M244 220 L300 148 L372 220"},{"t":"arrow","x1":326,"y1":190,"x2":272,"y2":216}],"anchor":[330,190]}]},
  ];
  const FLAT_GUIDE = `"mode":"2d" (a flat pen drawing). Picture: 400 wide, 260 tall, absolute coordinates, x 10 to 390, y 20 to 250.
  Plan: "layout" says how it is arranged; every part has "box":[x,y,w,h] where it sits and "anchor":[x,y], a point ON its main shape (the sun's disc, the leaf's blade); its name's line ends there. Strokes stay inside the box. Spread parts over the picture and leave clear space for the names.
  Draw REAL outlines, the way a textbook figure looks: a leaf with a pointed tip, a midrib and side veins; a heart with its curved walls, its four chambers and its vessels; an engine with its real profile. Never a plain circle or box for a real object, and never a cartoon symbol (no valentine heart for a real heart, no lightning zigzag for electricity). The main object is drawn large, about half the picture, with long curved paths (C and Q curves) for its true outline, and each of its inner parts is a part of its own, in its own colour, lightly filled ("fill":true) so the student can tell the parts apart. 5 to 8 parts in drawing order, 3 to 24 strokes each, 30 or more strokes in the whole drawing, each part's strokes in pen order. Arrows show what moves and which way. Each part is drawn, then named, while its "say" is said, so the student always knows what they are looking at.
  {"answer":the direct answer in one or two short sentences,"about":[x,y,w,h] the box around the thing on their screen the question is about, as shares of the picture from 0 to 1, or null,"title":2 to 6 words,"mode":"2d","layout","intro":one sentence,"summary":one sentence,"parts":[{"id","label":1 to 3 words,"say":1 or 2 short, natural spoken sentences,"color":"#hex","box","anchor","shapes":[...]}]}
  2d shapes: {"t":"line","x1","y1","x2","y2"}, {"t":"arrow",...same} for movement, {"t":"path","d":"M L Q C Z, CAPITAL letters only"}, {"t":"poly","pts":[[x,y],...]}, {"t":"rect","x","y","w2","h"}, {"t":"circle","cx","cy","r"}, {"t":"ellipse","cx","cy","rx","ry"}, {"t":"text","x","y","text"} for values only ("H2O"); "fill":true, "dash":true. Never write a part's name as text: the card does.
  Students learn from this: every fact, label, direction and count MUST be correct. If you are not sure of something, leave that part out.
  Three good drawings (this level of care, not these subjects; yours also has "answer" and "about"):
  ${FLAT_EXAMPLES.map((x) => JSON.stringify(x)).join('\n  ')}
  Use the student's language (English, Filipino or Taglish). No dashes in the words. No emojis.`;
  const CARD_SHAPE = '{"answer":"the direct answer in one or two short sentences","about":[0.3,0.2,0.4,0.5],"title":"2 to 6 words","caption":"what the drawing shows, in under 10 words","view":"Side view","beats":[{"say":"one or two short, natural spoken sentences","draw":[{"shape":"outline","points":[[30,22],[62,22],[68,58],[24,58]]}]}]}';
  const CARD_HELP = `Give 3 to 6 beats. "about" is the box [x, y, w, h] around the thing on their screen that the question is about, as shares of the picture from 0 to 1 (null when it is about nothing on the screen). "view" says how the thing is seen: Side view, Front view, Top view, Cut-away or Diagram.
  The drawing is made on a card ${GW} units wide and ${GH} tall, and (0, 0) is its top left corner. It grows while you talk: each beat adds 1 to 5 new parts ("draw") while its sentence is said. Draw the main outline first, then its parts in colour, then arrows, then labels. The parts you can draw:
  {"shape":"outline","points":[[30,22],[62,22],[68,58],[24,58]],"fill":"blue"} (a closed smooth shape through 3 to 12 points; add "sharp":1 for straight edges; "fill" is optional)
  {"shape":"curve","points":[[10,40],[30,22],[60,24]]} (a smooth line through 2 to 12 points)
  {"shape":"line","points":[[10,60],[90,60]]} (straight; add "dash":1 for a dashed line)
  {"shape":"box","x":40,"y":30,"w":20,"h":12,"fill":"grey"} (x, y is its top left corner)
  {"shape":"circle","x":50,"y":36,"r":6,"fill":"red"} (x, y is its middle)
  {"shape":"arrow","points":[[50,48],[50,66]],"color":"red"} (the arrowhead is at the last point; more points make it bend)
  {"shape":"label","x":16,"y":10,"text":"Lift fan","to":[34,32]} (1 to 3 words with their middle at x, y, and a thin line to the spot "to")
  {"shape":"note","x":80,"y":10,"text":"Unplug it first"} (a sticky note, for one warning or tip)
  {"shape":"graph","fn":"x^2 - 4","xrange":[-4,4],"x":20,"y":10,"w":60,"h":50} (the graph of a function with its axes; fn uses * to multiply and ^ for powers)
  Colours for "color" (the line) and "fill" (the inside): ink, grey, blue, red, green, yellow, orange, purple.
  Draw big, so the picture fills the card, and keep every part between 4 and 96 across and 4 and 71 down. Put each label in empty space beside the thing it names, never on top of the drawing or on another label. Use at most 20 parts in all.`;

  // prompt({ q, page: { title, text, items, pictureOnly }, draw, scene, said })
  //   draw: the student asked for a drawing, so she draws (no pointing at the page instead)
  //   scene: the drawing on the card now, for a follow-up (she adds to it, or starts a new one)
  //   said: what she has said so far (a lesson's steps, or the card's beats)
  //   dim: '3d' builds a model, '2d' draws flat; left out, the question decides (wants3d)
  function prompt({ q = '', page = null, draw = false, scene = null, said = [], dim = null } = {}) {
    const T = window.CassieTeach, truth = T && T.truth ? T.truth.asked : '';
    const d3 = dim === '3d' || (dim == null && !scene && wants3d(q));
    const title = page && page.title ? `, on a page called "${String(page.title).slice(0, 120)}"` : '';
    const text = page && page.text ? `The words on the page (maybe cut short):\n"""\n${page.text}\n"""\n` : '';
    const sofar = said.length ? `You (Cassie) said so far:\n${said.map((x, i) => `${i + 1}. ${x}`).join('\n')}\n` : '';
    if (scene) {
      const drawn = JSON.stringify({ title: scene.title, beats: scene.beats.map((b) => ({ say: b.say, draw: b.parts })) });
      return `A student is looking at their screen (the picture)${title}. You (Cassie, their tutor) are drawing for them on a card beside the page.
  ${sofar}The drawing on the card now: ${drawn}
  The student asks: "${q}"
  Answer like a kind tutor, and draw while you explain. Reply with ONLY minified JSON, no other text, in one of two ways:
  To add to the drawing on the card: {"keep":true,"answer":"the direct answer in one or two short sentences","beats":[{"say":"one or two short, natural spoken sentences","draw":[]}]} with only the new beats. New parts go in the empty space around what is already there.
  To start a new drawing: ${CARD_SHAPE}
  Give 1 to 5 beats.
  ${CARD_HELP.replace(/^Give 3 to 6 beats\. /, '')}
  ${truth}`;
    }
    const seen = `A student is looking at their screen right now (the picture)${title}.\n  ${text}${sofar}The student asks: "${q}"`;
    if (d3 && SOFT.test(q)) {
      return `${seen}
  Answer like a kind tutor sitting beside them, and draw it for them while you explain. They asked for 3D, but your 3D models are built from simple solids and would look wrong for something soft, living or a process, so draw it flat, and say that in a few words at the start of "intro".
  Reply with ONLY one minified JSON object, no other text.
  ${FLAT_GUIDE}
  ${truth}`;
    }
    if (d3) {
      return `${seen}
  Answer like a kind tutor sitting beside them, by building a 3D model for them while you explain. Reply with ONLY one minified JSON object, "mode":"3d".
  ${GUIDE_3D}
  Machines, engines, devices, tools, buildings, vehicles, molecules and planets are always built as the 3D model above. Only if the subject is soft or living (an organ, a plant, an animal, a cell) or is a process with no object, where simple solids would look wrong, reply with a flat drawing instead ("mode":"2d", "layout", parts with "box", "anchor" and flat "shapes": line, arrow, path, poly, rect, circle, ellipse on a 400 by 260 picture) and say why in a few words at the start of "intro".
  ${truth}`;
    }
    if (draw) {
      return `${seen}
  Answer like a kind tutor sitting beside them, and draw it for them while you explain. The student asked for a drawing, so always draw one.
  Reply with ONLY one minified JSON object, no other text.
  ${FLAT_GUIDE}
  ${truth}`;
    }
    const items = page && !page.pictureOnly && Array.isArray(page.items) ? page.items : [];
    const list = items.map((p) => `${p.n}. ${p.what} at [${p.box.join(', ')}]`).join('\n');
    return `${seen}
  ${list ? `Things on the screen you can point at, numbered, each with its box [x, y, w, h] as shares of the picture:\n${list}\n  ` : ''}Answer like a kind tutor sitting beside them, and show it in the ONE way that helps most. Reply with ONLY minified JSON, no other text.
  A. POINT at their screen, when the answer is something the screen already shows (where a thing is, what a part says or means, which choice is right):
  {"answer":"a short, clear answer in plain words, under 80 words","steps":[{"say":"one or two short, natural spoken sentences","point":${list ? '3' : '{"x":0.4,"y":0.3}'},"draw":[{"shape":"circle","x":0.4,"y":0.3,"r":0.05}]}]}
  Give 1 to 5 steps. "point" is where your arrow goes: ${list ? 'the number of the thing on the list, or {"x":0.4,"y":0.3} for a spot on the picture, or 0 for nothing.' : 'a spot on the picture, {"x":0.4,"y":0.3}, or null for nothing.'}
  ${T && T.shapes ? T.shapes(!!list) : ''}
  B. DRAW it on a card beside the page, when they ask how something works, what it is made of or looks like inside, why something happens, or how to do something:
  ${FLAT_GUIDE}${list ? '\n  In B, "about" can also be the number of a thing on the list.' : ''}
  For a quick fact that needs neither, reply {"answer":"your answer","steps":[]}.
  ${truth}`;
  }

  const STRICT = '\n  IMPORTANT: your last reply could not be read. Reply with ONLY the JSON object, nothing before or after it. At most 4 beats, and at most 4 parts in each beat.';
  const DRAW_IT = '\n  IMPORTANT: the student asked for a drawing and your last reply had none. Reply in the drawing form, and give every beat at least one part to draw.';
  // One reply from Cassie, read: send(prompt, maxTokens) → her reply. A reply that can't be used (or has no
  // drawing when one was asked for) is asked for once more, more strictly. → { kind, answer, scene, steps, noDraw }
  async function from({ send, ask, count = 0, draw = false, maxTokens = 3600 } = {}) {
    let last = null, nudge = '';
    for (let tries = 0; tries < 2; tries++) {
      const reply = await send(ask + nudge, maxTokens);
      const got = parse(reply, count);
      if (got.kind === 'card' && got.scene.dim === '3d' && !tries) {
        // (as in the Cassie app: the model against her own plan; what is wrong goes back to her once)
        const m = await load3d().catch(() => null), spec = m && m.clean(got.scene.spec), wrong = !m ? [] : spec ? m.check3d(spec) : ['the reply was not one valid JSON object in the schema'];
        if (wrong.length) { last = got; nudge = `\n  IMPORTANT: your model has these problems:\n  - ${wrong.join('\n  - ')}\n  Send the whole corrected JSON object again.`; continue; }
      }
      if (got.kind === 'card' && got.scene.dim === 'flat' && !tries) {
        const m = await load3d().catch(() => null), spec = m && m.clean(got.scene.spec), wrong = !m ? [] : spec ? m.check(spec) : ['the reply was not one valid JSON object in the schema'];
        if (wrong.length) { last = got; nudge = `\n  IMPORTANT: your drawing has these problems:\n  - ${wrong.slice(0, 8).join('\n  - ')}\n  Send the whole corrected JSON object again.`; continue; }
      }
      if (got.kind === 'card' || (got.kind && !draw)) return got;
      if (got.kind) { last = got; nudge = DRAW_IT; }
      else {
        if (tries && !last) { const plain = String(reply || '').trim(); if (plain && plain.indexOf('{') < 0) last = { kind: 'words', answer: plain.slice(0, 1500), scene: null, steps: [] }; } // (plain words twice: they are still an answer)
        if (!last) nudge = STRICT;
      }
    }
    if (last) return { ...last, noDraw: !!draw && last.kind !== 'card' };
    throw keyed('live_failed');
  }
  // what went wrong, in plain words (CassieErrors): a missing key, no internet, too slow, or "try again"
  function problem(e) {
    const E = window.CassieErrors, m = String((e && e.message) || e || '');
    if (m === 'no-key' || m === 'no-vision') return E.say('teach_no_key');
    if (e && e.code && E.STRINGS[e.code]) return E.say(e.code);
    const w = E.explain({ message: m }, 'live_failed');
    return w === E.say('unknown') ? E.say('live_failed') : w;
  }

  /* ---------- the drawing: each part as lines on the card ---------- */
  // her board's own paper and inks, in light and in dark (sketch.js); every line is at least 3:1 on its paper
  const PAPER = {
    light: { paper: '#ffffff', grid: 'rgba(0,0,0,.08)', ink: '#1b1b1d', grey: '#6d6d72', blue: '#2f6fd6', red: '#d93a3a', green: '#2a8f52', yellow: '#a67c00', orange: '#c56a12', purple: '#8e4ec6', tint: 0.2 },
    dark: { paper: '#1d1d20', grid: 'rgba(255,255,255,.09)', ink: '#f2f2f4', grey: '#a8a8b3', blue: '#7aa7ff', red: '#ff8a8a', green: '#6fd29a', yellow: '#f2c94c', orange: '#ffab5e', purple: '#b9a2ff', tint: 0.26 },
  };
  const NOTE = { paper: '#fff1a6', ink: '#1b1b1d', edge: 'rgba(0,0,0,.2)' }; // (a sticky note is yellow in light and in dark)
  const inks = (p) => COLORS.map((c) => `--p-${c}: ${p[c]};`).join(' ') + ` --paper: ${p.paper}; --grid: ${p.grid}; --tint: ${p.tint};`;
  const PEN = { main: 8, thin: 4, font: LABEL.size * K, line: LABEL.line * K, head: 26 };
  const ARROW = 'M5 3l14 7-6.2 1.8L10 18z'; // (Cursor Cassie's arrow, as in her lessons)
  const u = (v) => Math.round(v * K);
  // a smooth line through the points (closed: back round to the first)
  function smooth(points, closed) {
    const n = points.length, P = (i) => (closed ? points[((i % n) + n) % n] : points[clamp(i, 0, n - 1)]);
    let d = `M${points[0][0]} ${points[0][1]}`;
    if (n === 2 && !closed) return d + `L${points[1][0]} ${points[1][1]}`;
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      const a = P(i - 1), b = P(i), c = P(i + 1), e = P(i + 2);
      d += `C${Math.round(b[0] + (c[0] - a[0]) / 6)} ${Math.round(b[1] + (c[1] - a[1]) / 6)} ${Math.round(c[0] - (e[0] - b[0]) / 6)} ${Math.round(c[1] - (e[1] - b[1]) / 6)} ${c[0]} ${c[1]}`;
    }
    return d + (closed ? 'Z' : '');
  }
  const straight = (points, closed) => points.map((p, i) => `${i ? 'L' : 'M'}${p[0]} ${p[1]}`).join('') + (closed ? 'Z' : '');
  // the lines of one part: [{ d, color, fill, width, dash }] (a label and a note are built where they are shown)
  function linesOf(p) {
    const pts = (p.points || []).map((q) => [u(q[0]), u(q[1])]);
    switch (p.shape) {
      case 'curve': return [{ d: smooth(pts, false), color: p.color, width: PEN.main, dash: p.dash }];
      case 'line': return [{ d: straight(pts, false), color: p.color, width: PEN.main, dash: p.dash }];
      case 'outline': return [{ d: p.sharp ? straight(pts, true) : smooth(pts, true), color: p.color, fill: p.fill, width: PEN.main }];
      case 'box': {
        const x = u(p.x), y = u(p.y), w = u(p.w), h = u(p.h), r = Math.min(14, w / 4, h / 4);
        return [{ d: `M${x + r} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${y + h - r}Q${x + w} ${y + h} ${x + w - r} ${y + h}H${x + r}Q${x} ${y + h} ${x} ${y + h - r}V${y + r}Q${x} ${y} ${x + r} ${y}Z`, color: p.color, fill: p.fill, width: PEN.main }];
      }
      case 'oval': {
        const x = u(p.x), y = u(p.y), rx = u(p.rx), ry = u(p.ry);
        return [{ d: `M${x} ${y - ry}A${rx} ${ry} 0 1 1 ${x} ${y + ry}A${rx} ${ry} 0 1 1 ${x} ${y - ry}Z`, color: p.color, fill: p.fill, width: PEN.main }];
      }
      case 'arrow': {
        const tip = pts[pts.length - 1], back = pts[pts.length - 2], a = Math.atan2(tip[1] - back[1], tip[0] - back[0]);
        const wing = (s) => `M${tip[0]} ${tip[1]}L${Math.round(tip[0] - PEN.head * Math.cos(a + s))} ${Math.round(tip[1] - PEN.head * Math.sin(a + s))}`;
        return [{ d: smooth(pts, false) + wing(-0.48) + wing(0.48), color: p.color, width: PEN.main }];
      }
      case 'graph': {
        let fn; try { fn = window.CassieBoard.compile(p.fn); } catch (e) { return []; }
        const x = u(p.x), y = u(p.y), w = u(p.w), h = u(p.h), [a, b] = p.xrange, n = 60;
        const xs = Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n), ys = xs.map((v) => { const t = fn(v); return Number.isFinite(t) ? t : null; });
        const ok = ys.filter((v) => v != null);
        if (ok.length < 2) return [];
        let lo = Math.min(...ok, 0), hi = Math.max(...ok, 0);
        if (hi - lo < 1e-6) { lo -= 1; hi += 1; }
        const px = (v) => Math.round(x + ((v - a) / (b - a)) * w), py = (v) => Math.round(y + h - ((v - lo) / (hi - lo)) * h);
        const out = [{ d: `M${x} ${py(0)}H${x + w}`, color: 'grey', width: PEN.thin }];
        if (a <= 0 && b >= 0) out.push({ d: `M${px(0)} ${y}V${y + h}`, color: 'grey', width: PEN.thin });
        let run = [];
        const flush = () => { if (run.length > 1) out.push({ d: straight(run, false), color: p.color, width: PEN.main }); run = []; };
        xs.forEach((v, i) => { if (ys[i] == null) flush(); else run.push([px(v), py(ys[i])]); });
        flush();
        return out;
      }
    }
    return [];
  }

  /* ---------- the card ---------- */
  const ICON = {
    side: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h13M13 4l4 4-4 4M20 16H7M11 12l-4 4 4 4"/></svg>',
    x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  };
  const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
  const CSS = `
    :host { all: initial; }
    .lv { --bg: #f6f5f2; --card: #ffffff; --ink: #1b1b1d; --mute: #5f5f66; --line: #e4e1da; --edge: #8a8a90; --pri: #1b1b1d; --pri-ink: #ffffff; ${inks(PAPER.light)}
      font: 15px/1.45 ${FONT}; color: var(--ink); }
    @media (prefers-color-scheme: dark) { .lv { --bg: #18181c; --card: #222228; --ink: #ececf0; --mute: #a3a3ab; --line: #34343c; --edge: #8a8a93; --pri: #ececf0; --pri-ink: #18181c; ${inks(PAPER.dark)} } }
    .lv-card { position: fixed; top: 16px; right: 16px; width: min(432px, calc(100vw - 32px)); max-height: calc(100vh - 32px); box-sizing: border-box; display: flex; flex-direction: column; pointer-events: auto;
      background: var(--bg); color: var(--ink); border: 1px solid var(--line); border-radius: 16px; box-shadow: 0 16px 48px rgba(0,0,0,.28); overflow: hidden; }
    .lv-card[data-side="left"] { right: auto; left: 16px; }
    .lv-card:focus { outline: none; }
    .lv-in-panel .lv-card { position: static; width: auto; max-width: 560px; max-height: none; box-shadow: none; }
    .lv-head { display: flex; align-items: center; gap: 8px; padding: 8px 8px 8px 16px; border-bottom: 1px solid var(--line); }
    .lv-status { flex: 1; min-width: 0; margin: 0; display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 14px; line-height: 1.3; }
    .lv-status svg { flex: none; width: 16px; height: 16px; fill: var(--ink); }
    .lv-body { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 16px; display: flex; flex-direction: column; gap: 16px; }
    .lv-rest { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
    .lv [hidden] { display: none !important; }
    .lv-paper { background: var(--paper); border: 1px solid var(--line); border-radius: 12px; padding: 16px 16px 8px; }
    .lv-title { margin: 0; font: 700 18px/1.25 ${FONT}; color: var(--p-ink); }
    .lv-sub { margin: 4px 0 8px; font-size: 13px; line-height: 1.35; color: var(--p-grey); }
    .lv-svg { display: block; width: 100%; aspect-ratio: 4 / 3; max-height: max(168px, calc(100vh - 392px)); border-radius: 8px;
      background-image: linear-gradient(var(--grid) 1px, transparent 1px), linear-gradient(90deg, var(--grid) 1px, transparent 1px); background-size: 5% 6.6667%; }
    .lv-in-panel .lv-svg { max-height: none; }
    .lv-svg path { fill: none; stroke-linecap: round; stroke-linejoin: round; }
    .lv-svg text { font: 600 ${PEN.font}px ${FONT}; fill: var(--p-ink); paint-order: stroke; stroke: var(--paper); stroke-width: 9px; stroke-linejoin: round; }
    .lv-svg .lv-note text { fill: ${NOTE.ink}; stroke: none; font-size: 34px; }
    .lv-svg .lv-cur { transition: transform .12s linear, opacity .2s; }
    .lv-svg .lv-cur path { fill: #ffffff; stroke: #141416; stroke-width: 1.6; }
    .lv-words { display: flex; flex-direction: column; gap: 8px; max-height: 168px; overflow: auto; }
    .lv-words.is-more { -webkit-mask-image: linear-gradient(to bottom, transparent, #000 24px); mask-image: linear-gradient(to bottom, transparent, #000 24px); }
    .lv-line { margin: 0; color: var(--mute); }
    .lv-line.is-now { color: var(--ink); font-weight: 600; }
    .lv-asked { margin: 0; font-size: 13px; color: var(--mute); }
    .lv-vnote { margin: 0; font-size: 13px; line-height: 1.4; color: var(--ink); }
    .lv-nav { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .lv-count { flex: 1; min-width: 48px; text-align: center; font-size: 13px; color: var(--mute); }
    .lv-ask { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 0; }
    .lv-ask input { flex: 1; min-width: 0; min-height: 44px; box-sizing: border-box; border-radius: 12px; border: 1px solid var(--edge); background: var(--card); color: var(--ink); padding: 0 12px; font: 15px/1.2 ${FONT}; }
    .lv-ask input::placeholder { color: var(--mute); opacity: 1; }
    .lv-ask input:focus { outline: 2px solid var(--ink); outline-offset: 1px; }
    .lv button { all: unset; box-sizing: border-box; min-height: 44px; min-width: 44px; padding: 0 16px; border-radius: 12px; display: inline-flex; align-items: center; justify-content: center; gap: 8px;
      font: 600 14px/1 ${FONT}; color: var(--ink); background: var(--card); border: 1px solid var(--line); cursor: pointer; }
    .lv button:hover { border-color: var(--edge); }
    .lv button:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
    .lv button:disabled { opacity: .45; cursor: default; }
    .lv .lv-voice[aria-pressed="false"] { color: var(--mute); }
    .lv .lv-pri { background: var(--pri); color: var(--pri-ink); border-color: var(--pri); }
    .lv .lv-icon { padding: 0; }
    /* a 3D model: in her card (the side panel, a narrow window), or over the page with no background */
    .lv-hint { margin: 0 0 8px; font-size: 13px; line-height: 1.35; color: var(--p-grey); }
    .lv-stage { position: relative; width: 100%; aspect-ratio: 4 / 3; border-radius: 8px; overflow: hidden; }
    .lv-float { position: fixed; pointer-events: auto; box-sizing: border-box; padding: 16px; border-radius: 16px; border: 1px solid var(--line); background: color-mix(in srgb, var(--card) 90%, transparent); -webkit-backdrop-filter: blur(16px); backdrop-filter: blur(16px); box-shadow: 0 16px 48px rgba(0,0,0,.24); }
    /* (a flat drawing has room to be read: a wider card where the window allows) */
    @media (min-height: 681px) and (min-width: 960px) { .lv-on-page.lv-flat:not(.lv-cleared) .lv-card { width: min(576px, calc(100vw - 32px)); } }
    /* a flat drawing in the Cassie app's form (livedraw.js draws it; these are its looks on her card) */
    .lv-stage-flat { aspect-ratio: 400 / 260; overflow: visible; border-radius: 0; color: var(--ink); }
    .ld-svg { display: block; width: 100%; height: 100%; overflow: visible; }
    .ld-part { transition: opacity .25s ease; }
    .ld-part.dim { opacity: .25; }
    .ld-word { fill: var(--ink); stroke: none; font-weight: 600; font-family: ${FONT}; }
    .ld-lead { stroke: var(--p-grey); stroke-width: 1; }
    .ld-ltext { fill: var(--ink); font-weight: 600; font-family: ${FONT}; }
    .ld-lbg { fill: var(--paper); fill-opacity: .9; stroke: var(--line); stroke-width: 1; }
    .ld-anchor { fill: var(--ink); stroke: var(--paper); stroke-width: 1; }
    .ld-marker { stroke-width: 1.5; }
    .ld-legend { margin: 8px 0 0; font-size: 13px; line-height: 1.35; font-weight: 600; color: var(--p-grey); white-space: pre-wrap; }
    .ld-legend[hidden] { display: none; }
    .lv-float .lv-stage { height: 100%; aspect-ratio: auto; overflow: visible; }
    .lv-sticky { margin: 0 0 8px; padding: 8px 12px; max-width: 208px; box-sizing: border-box; background: ${NOTE.paper}; color: ${NOTE.ink}; border: 1px solid ${NOTE.edge}; border-radius: 4px;
      font: 600 14px/1.3 ${FONT}; transform: rotate(-2deg); box-shadow: 0 4px 12px rgba(0,0,0,.2); }
    .lv-paper .lv-sticky { display: inline-block; }
    .lv-float .lv-sticky { position: absolute; left: 16px; top: 16px; z-index: 2; margin: 0; max-width: 200px; }
    .lv .lv-clear3 { position: absolute; top: 16px; right: 16px; z-index: 2; border-color: var(--edge); box-shadow: 0 4px 16px rgba(0,0,0,.25); }
    .ld-canvas { display: block; width: 100% !important; height: 100% !important; cursor: grab; touch-action: none; outline: none; }
    .ld-canvas:active { cursor: grabbing; }
    .ld-tags { position: absolute; inset: 0; pointer-events: none; }
    .lv .ld-tag { all: unset; position: absolute; transform: translate(-50%, -50%); box-sizing: border-box; pointer-events: none; padding: 4px 12px; border-radius: 99px; border: 1px solid var(--edge);
      background: var(--card); color: var(--ink); font: 600 13px/1.3 ${FONT}; white-space: nowrap; box-shadow: 0 2px 8px rgba(0,0,0,.22); }
    .lv .ld-tag:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
    .ld-tag-lines { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; overflow: visible; filter: drop-shadow(0 0 1px var(--card)) drop-shadow(0 0 1px var(--card)); }
    .ld-tag-lines line { stroke: var(--ink); stroke-width: 1.5; }
    .ld-tag-lines circle { fill: var(--ink); stroke: var(--card); stroke-width: 1.5; }
    .lv-line.is-picked { color: var(--ink); text-decoration: underline; text-underline-offset: 3px; }
    .lv-icon svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    /* a short window (a small laptop): the drawing and her words sit side by side, so both show at once */
    @media (max-height: 680px) and (min-width: 880px) {
      .lv-on-page:not(.lv-cleared) .lv-card { width: min(776px, calc(100vw - 32px)); }
      .lv-on-page:not(.lv-cleared) .lv-body { display: grid; grid-template-columns: minmax(0, 1fr) 344px; align-items: start; }
      .lv-on-page .lv-svg { max-height: max(168px, calc(100vh - 184px)); }
      .lv-on-page .lv-words { max-height: 132px; }
      /* (a 3D model over the page: her card stays narrow, the model has the room) */
      .lv-on-page.lv-floats:not(.lv-cleared) .lv-card { width: min(432px, calc(100vw - 32px)); }
      .lv-on-page.lv-floats:not(.lv-cleared) .lv-body { display: flex; }
    }
  `;

  let current = null;
  const store = {
    get: (k) => new Promise((res) => { try { chrome.storage.local.get(k, (o) => res(o || {})); } catch (e) { res({}); } }),
    set: (o) => { try { chrome.storage.local.set(o); } catch (e) { /* not kept */ } },
  };
  const tell = (msg) => { try { return chrome.runtime.sendMessage(msg).catch(() => null); } catch (e) { return Promise.resolve(null); } };
  const readPace = (text) => Math.min(9000, 1400 + String(text || '').length * 45); // (typed: time to read it, as in her lessons)

  // play(scene, { q, send, mount, about, pointer, page, onBoard, onClose, save, pace })
  //   send(prompt, maxTokens) → her reply: for follow-ups (without it the card has no ask box)
  //   mount: a box in the side panel (the card sits in it); otherwise the card floats over the page
  //   onBoard(canvas, { title, steps }): opens the finished drawing on the board
  function play(scene, opts = {}) {
    stop();
    if (!scene || !Array.isArray(scene.beats) || !scene.beats.length) return null;
    const inPanel = !!opts.mount;
    const still = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
    const pace = opts.pace > 0 ? opts.pace : 1;
    const hostLinks = window.CassieLiveHost || {};
    const onBoard = opts.onBoard || hostLinks.board || null;

    const host = document.createElement('div');
    host.id = HOST_ID;
    if (!inPanel) Object.assign(host.style, { position: 'fixed', inset: '0', zIndex: '2147483642', pointerEvents: 'none' });
    const root = host.attachShadow({ mode: 'open' });
    const wrapEl = document.createElement('div');
    wrapEl.className = 'lv ' + (inPanel ? 'lv-in-panel' : 'lv-on-page');
    wrapEl.innerHTML = `<style>${CSS}</style>
      <div class="lv-card" role="dialog" aria-label="Cassie’s drawing" tabindex="-1" data-side="right">
        <div class="lv-head">
          <p class="lv-status" role="status" aria-live="polite"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ARROW}"/></svg><span></span></p>
          <button type="button" class="lv-voice" aria-pressed="true" title="Cassie’s voice on or off">Voice on</button>
          ${inPanel ? '' : `<button type="button" class="lv-side lv-icon" aria-label="Move this card to the other side" title="Move this card to the other side">${ICON.side}</button>`}
          <button type="button" class="lv-x lv-icon" aria-label="Close" title="Close">${ICON.x}</button>
        </div>
        <div class="lv-body">
          <div class="lv-paper">
            <p class="lv-title"></p>
            <p class="lv-sub"></p>
            <p class="lv-hint" hidden>Drag to turn it. Tap a part to read about it.</p>
            <svg class="lv-svg" viewBox="0 0 ${GW * K} ${GH * K}" role="img"></svg>
            <div class="lv-stage lv-stage-card" role="img" hidden></div>
          </div>
          <div class="lv-rest">
            <div class="lv-words" aria-live="polite"></div>
            <p class="lv-vnote" role="status" hidden></p>
            <div class="lv-nav lv-steps">
              <button type="button" class="lv-back">Back</button>
              <button type="button" class="lv-play lv-pri">Pause</button>
              <span class="lv-count"></span>
              <button type="button" class="lv-next">Next</button>
            </div>
            <div class="lv-nav">
              <button type="button" class="lv-replay">Replay</button>
              <button type="button" class="lv-clear">Clear</button>
              <button type="button" class="lv-open" aria-pressed="true" hidden>Close the case</button>
              <button type="button" class="lv-apart" aria-pressed="false" hidden>Pull apart</button>
              ${onBoard ? '<button type="button" class="lv-board">Open on the board</button>' : ''}
            </div>
            ${opts.send ? '<form class="lv-ask" autocomplete="off"><input type="text" placeholder="Ask a follow-up" aria-label="Ask a follow-up" maxlength="300" enterkeyhint="send"><button type="submit" class="lv-send">Ask</button></form>' : ''}
          </div>
        </div>
      </div>
      <div class="lv-float" hidden><div class="lv-stage lv-stage-float" role="img"></div><button type="button" class="lv-clear3">Clear</button></div>`;
    root.appendChild(wrapEl);
    (inPanel ? opts.mount : document.documentElement).appendChild(host);
    const $ = (s) => root.querySelector(s);
    const card = $('.lv-card'), svg = $('.lv-svg'), paper = $('.lv-paper'), wordsEl = $('.lv-words'), statusEl = $('.lv-status span'), vnote = $('.lv-vnote');
    const el = (name, attrs = {}) => { const n = document.createElementNS(NS, name); Object.keys(attrs).forEach((k) => n.setAttribute(k, attrs[k])); return n; };
    wordsEl.addEventListener('scroll', () => wordsEl.classList.toggle('is-more', wordsEl.scrollTop > 0), { passive: true });

    let cur = null, beats = [], info = {}, askedNow = '';
    // the scene on her card: the first one, or a new one a follow-up brought (q: the question it answers)
    const adopt = (sc, q) => {
      cur = sc; askedNow = String(q || '');
      info = { title: sc.title, caption: sc.caption, view: sc.view };
      beats = sc.beats.map((b, i) => ({ say: b.say, parts: (b.parts || []).slice(), part: b.part, asked: i === 0 ? askedNow : '' }));
    };
    adopt(scene, opts.q);
    const is3d = () => cur.dim === '3d';
    const isFlat = () => cur.dim === 'flat'; // (a flat drawing in the Cassie app's form, drawn by its own drawer)
    const lightPaper = () => !(window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
    const cardStage = $('.lv-stage-card'), floatEl = $('.lv-float'), floatStage = $('.lv-stage-float');
    let model = null, floating = false, picked = -1, built = 0, lastPic = '';
    let views = [], cursor = null;
    let at = -1, playing = false, alive = true, cleared = false, done = false;
    let run = 0, raf = 0, gap = 0, mid = null, nextUp = 0, voiceOn = true, asking = 0;
    host.dataset.beat = '-1'; host.dataset.spoken = '0'; host.dataset.status = '';

    const setStatus = (key) => { host.dataset.status = key; statusEl.textContent = say('live_' + key); };

    /* one part on the card: its lines (drawn on from their start), or a label (its line, then its words typed), or a note */
    function lineView(part) {
      const g = el('g', { class: 'lv-part', 'data-shape': part.shape });
      const lines = linesOf(part).map((ln) => {
        const p = el('path', { d: ln.d, 'stroke-width': ln.width });
        p.style.stroke = `var(--p-${ln.color})`;
        if (ln.dash) p.setAttribute('stroke-dasharray', '16 16'); else { p.setAttribute('pathLength', '1'); p.setAttribute('stroke-dasharray', '1 2'); }
        if (ln.fill) { p.style.fill = `var(--p-${ln.fill})`; p.style.fillOpacity = 'calc(var(--tint) * var(--f, 0))'; }
        g.appendChild(p);
        return { ...ln, p, len: 0 };
      });
      const n = lines.length || 1;
      return {
        g, part, lines,
        set(k) {
          g.style.opacity = k > 0 ? '1' : '0';
          lines.forEach((ln, i) => {
            const kk = clamp(k * n - i), pen = ln.fill ? clamp(kk / 0.72) : kk;
            if (ln.dash) ln.p.style.opacity = String(kk); else ln.p.style.strokeDashoffset = String(1 - pen);
            if (ln.fill) ln.p.style.setProperty('--f', String(clamp((kk - 0.55) / 0.45)));
          });
        },
        tip(k) {
          const i = Math.min(n - 1, Math.floor(k * n)), ln = lines[i];
          if (!ln || ln.dash) return null;
          try { if (!ln.len) ln.len = ln.p.getTotalLength(); const q = ln.p.getPointAtLength(ln.len * clamp((k * n - i) / (ln.fill ? 0.72 : 1))); return [q.x, q.y]; } catch (e) { return null; }
        },
        paint(x, pal) {
          lines.forEach((ln) => {
            const path = new Path2D(ln.d);
            if (ln.fill) { x.globalAlpha = pal.tint; x.fillStyle = pal[ln.fill]; x.fill(path); x.globalAlpha = 1; }
            x.strokeStyle = pal[ln.color]; x.lineWidth = ln.width; x.setLineDash(ln.dash ? [16, 16] : []); x.stroke(path); x.setLineDash([]);
          });
        },
      };
    }
    function labelView(part) {
      const g = el('g', { class: 'lv-part', 'data-shape': 'label' });
      const texts = wrap(part.text, LABEL.most, 2), cx = u(part.x), cy = u(part.y), top = cy - ((texts.length - 1) * PEN.line) / 2;
      const text = el('text', { 'dominant-baseline': 'central' });
      const rows = texts.map((t, i) => { const s = el('tspan', { y: Math.round(top + i * PEN.line) }); s.textContent = t; text.appendChild(s); return { full: t, s, w: 0, x: 0 }; });
      g.appendChild(text); svg.appendChild(g);
      // where the words sit: measured when they can be, else worked out from their length
      rows.forEach((r) => { let w = 0; try { w = r.s.getComputedTextLength(); } catch (e) { w = 0; } r.w = w > 0 ? w : r.full.length * PEN.font * LABEL.wide; r.x = Math.round(cx - r.w / 2); r.s.setAttribute('x', r.x); });
      const wide = Math.max(...rows.map((r) => r.w)), box = { x0: cx - wide / 2 - 8, x1: cx + wide / 2 + 8, y0: top - PEN.line / 2, y1: top + (texts.length - 0.5) * PEN.line };
      // the thin line from the edge of the words to the spot they name
      let lead = null, dot = null, leadD = '';
      if (part.to) {
        const tx = u(part.to[0]), ty = u(part.to[1]), dx = tx - cx, dy = ty - cy;
        const out = tx < box.x0 || tx > box.x1 || ty < box.y0 || ty > box.y1;
        if (out && Math.hypot(dx, dy) > 30) {
          const kx = dx ? ((dx > 0 ? box.x1 : box.x0) - cx) / dx : Infinity, ky = dy ? ((dy > 0 ? box.y1 : box.y0) - cy) / dy : Infinity, k = Math.min(kx, ky);
          leadD = `M${Math.round(cx + dx * k)} ${Math.round(cy + dy * k)}L${tx} ${ty}`;
          lead = el('path', { d: leadD, 'stroke-width': PEN.thin, pathLength: '1', 'stroke-dasharray': '1 2' });
          lead.style.stroke = `var(--p-${part.color === 'ink' ? 'grey' : part.color})`;
          dot = el('circle', { cx: tx, cy: ty, r: 7 });
          dot.style.fill = `var(--p-${part.color === 'ink' ? 'grey' : part.color})`;
          g.insertBefore(lead, text); g.insertBefore(dot, text);
        }
      }
      const total = rows.reduce((n, r) => n + r.full.length, 0) || 1;
      return {
        g, part,
        set(k) {
          g.style.opacity = k > 0 ? '1' : '0';
          const lk = lead ? clamp(k / 0.3) : 1, tk = lead ? clamp((k - 0.3) / 0.7) : k;
          if (lead) { lead.style.strokeDashoffset = String(1 - lk); dot.style.opacity = lk >= 1 ? '1' : '0'; }
          let left = Math.ceil(tk * total);
          rows.forEach((r) => { const n = Math.min(r.full.length, Math.max(0, left)); left -= r.full.length; const t = r.full.slice(0, n); if (r.s.textContent !== t) r.s.textContent = t; });
        },
        tip(k) {
          const tk = lead ? clamp((k - 0.3) / 0.7) : k;
          if (lead && k < 0.3) return [u(part.to[0]), u(part.to[1])];
          let left = Math.ceil(tk * total), spot = [rows[0].x, top];
          rows.forEach((r, i) => { if (left > 0) spot = [r.x + r.w * clamp(left / r.full.length), top + i * PEN.line]; left -= r.full.length; });
          return spot;
        },
        paint(x, pal) {
          const c = pal[part.color === 'ink' ? 'grey' : part.color];
          if (leadD) { x.strokeStyle = c; x.lineWidth = PEN.thin; x.stroke(new Path2D(leadD)); x.fillStyle = c; x.beginPath(); x.arc(u(part.to[0]), u(part.to[1]), 7, 0, Math.PI * 2); x.fill(); }
          x.font = `600 ${PEN.font}px system-ui, sans-serif`; x.textBaseline = 'middle'; x.textAlign = 'center'; x.lineJoin = 'round';
          rows.forEach((r, i) => { const y = top + i * PEN.line; x.strokeStyle = pal.paper; x.lineWidth = 9; x.strokeText(r.full, cx, y); x.fillStyle = pal.ink; x.fillText(r.full, cx, y); });
          x.textAlign = 'start';
        },
      };
    }
    function noteView(part) {
      const texts = wrap(part.text, NOTE_AT.most, 3), w = Math.round(Math.max(...texts.map((t) => t.length)) * NOTE_AT.size * K * LABEL.wide + 44), h = texts.length * NOTE_AT.line * K + 32;
      const cx = clamp(u(part.x), w / 2 + 10, GW * K - w / 2 - 10), cy = clamp(u(part.y), h / 2 + 10, GH * K - h / 2 - 10);
      const g = el('g', { class: 'lv-part lv-note', 'data-shape': 'note', transform: `translate(${Math.round(cx)} ${Math.round(cy)}) rotate(-2)` });
      const rect = el('rect', { x: -w / 2, y: -h / 2, width: w, height: h, rx: 6 });
      rect.style.fill = NOTE.paper; rect.style.stroke = NOTE.edge; rect.style.strokeWidth = '2';
      g.appendChild(rect);
      texts.forEach((t, i) => { const s = el('text', { x: 0, y: Math.round(-h / 2 + 37 + i * 42), 'text-anchor': 'middle', 'dominant-baseline': 'central' }); s.textContent = t; g.appendChild(s); });
      return {
        g, part,
        set(k) { g.style.opacity = String(clamp(k * 2)); },
        tip() { return [cx - w / 2 + 12, cy - h / 2 + 12]; },
        paint(x) {
          x.save(); x.translate(cx, cy); x.rotate((-2 * Math.PI) / 180);
          x.fillStyle = NOTE.paper; x.strokeStyle = NOTE.edge; x.lineWidth = 2; x.beginPath(); x.rect(-w / 2, -h / 2, w, h); x.fill(); x.stroke();
          x.fillStyle = NOTE.ink; x.font = '600 34px system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
          texts.forEach((t, i) => x.fillText(t, 0, -h / 2 + 37 + i * 42));
          x.restore();
        },
      };
    }
    // a part of a 3D model: it is built when its beat starts (at once, when a beat is shown whole)
    function part3d(i) {
      let on = false;
      return { part: { shape: 'part' }, set(k) { if (k > 0 && !on) { on = true; if (model) model.view.show(i, k >= 1); } else if (k <= 0 && on) { on = false; if (model) model.view.hide(i); } }, tip: () => null, paint() {} };
    }
    // a part of a flat drawing: its strokes are drawn when its beat starts, then its name is written
    function partFlat(i) {
      let on = false;
      return { part: { shape: 'part' }, set(k) { if (k > 0 && !on) { on = true; if (model) model.view.show(i, k >= 1 || still, 2200); } else if (k >= 1 && on) { /* drawn */ } else if (k <= 0 && on) { on = false; if (model) model.view.hide(i); } }, tip: () => null, paint() {} };
    }
    const kept = (v) => { const show = v.set; v.k = 0; v.set = (k) => { v.k = k; show(k); }; return v; };
    function end3d() {
      if (model) { try { model.view.stop(); } catch (e) { /* already gone */ } model = null; }
      paper.querySelectorAll('.ld-legend').forEach((n) => n.remove());
      cardStage.classList.remove('lv-stage-flat');
      cardStage.replaceChildren(); floatStage.replaceChildren();
      wrapEl.querySelectorAll('.lv-sticky').forEach((n) => n.remove());
      cardStage.hidden = true; floatEl.hidden = true; floating = false; picked = -1;
      wrapEl.classList.remove('lv-floats');
    }
    // where the model floats: in the room beside her card, in the middle of it
    function placeFloat() {
      if (!floating) return;
      const cw = card.offsetWidth, m = 16, free = innerWidth - cw - m * 3, w = Math.max(280, Math.min(720, free)), h = Math.max(240, Math.min(Math.round(w * 0.66), innerHeight - 96));
      const left = card.dataset.side === 'left' ? cw + m * 2 + (free - w) / 2 : m + (free - w) / 2;
      Object.assign(floatEl.style, { left: Math.round(left) + 'px', top: Math.round((innerHeight - h) / 2) + 'px', width: Math.round(w) + 'px', height: Math.round(h) + 'px' });
    }
    function paint3d() {
      const v = model && model.view, ob = $('.lv-open'), pb = $('.lv-apart');
      ob.hidden = !(v && v.open) || cleared; pb.hidden = !(v && v.explode) || cleared;
      if (v && v.open) { ob.textContent = v.opened ? 'Close the case' : 'Open it up'; ob.setAttribute('aria-pressed', String(!!v.opened)); }
      $('.lv-hint').hidden = !v || !is3d();
    }
    // every part of every beat, built once and hidden: a beat's parts appear when it is played.
    // → false when a 3D model can't be built here (then the same answer is shown flat: flatInstead)
    async function build() {
      const my = ++built, d3 = is3d(), flat = isFlat();
      end3d();
      svg.replaceChildren(); cursor = null; views = beats.map(() => []);
      svg.style.display = d3 || flat ? 'none' : '';
      host.dataset.dim = d3 ? '3d' : '2d';
      wrapEl.classList.toggle('lv-flat', flat);
      $('.lv-title').textContent = info.title || 'Cassie’s drawing';
      $('.lv-sub').textContent = [info.view, 'Simplified sketch'].filter(Boolean).join(' · ');
      const name = [info.title, info.caption].filter(Boolean).join(': ') || 'Cassie’s drawing';
      svg.setAttribute('aria-label', name);
      if (flat) {
        host.dataset.parts = '0';
        try {
          const m = await load3d();
          if (my !== built || !alive) return true;
          cardStage.classList.add('lv-stage-flat'); cardStage.hidden = false;
          cardStage.setAttribute('aria-label', name);
          const made = m.model2d(cardStage, cur.spec, { light: lightPaper() });
          if (!made) throw new Error('no drawing');
          model = made;
          views = beats.map((b) => (b.part >= 0 && made.view.has(b.part) ? [kept(partFlat(b.part))] : []));
          beats.forEach((b) => { if (b.part >= 0) made.view.hide(b.part); }); // (nothing shows until its beat)
          host.dataset.parts = String(views.reduce((n, v) => n + v.length, 0));
          paint3d();
          return true;
        } catch (e) {
          // (the drawer could not load here: her words stay, with no drawing)
          end3d(); cur = { ...cur, dim: '2d' }; beats.forEach((b) => { b.part = undefined; });
          svg.style.display = '';
          return true;
        }
      }
      if (!d3) {
        views = beats.map((b) => b.parts.map((p) => { const v = kept(p.shape === 'label' ? labelView(p) : p.shape === 'note' ? noteView(p) : lineView(p)); svg.appendChild(v.g); v.set(0); return v; }));
        cursor = el('g', { class: 'lv-cur' });
        cursor.appendChild(el('path', { d: ARROW }));
        cursor.style.opacity = '0';
        svg.appendChild(cursor);
        host.dataset.parts = String(views.reduce((n, v) => n + v.length, 0));
        paint3d();
        return true;
      }
      host.dataset.parts = '0';
      if (!can3d()) return false;
      try {
        const m = await load3d();
        if (my !== built || !alive) return true;
        // over the page when there is room beside her card; otherwise in the card
        floating = !inPanel && innerWidth - 432 - 48 >= 380;
        wrapEl.classList.toggle('lv-floats', floating);
        const stage = floating ? floatStage : cardStage;
        (floating ? floatEl : cardStage).hidden = false;
        stage.setAttribute('aria-label', name);
        placeFloat();
        const made = await m.model3d(stage, cur.spec, { turn: 'sway', zoom: !floating, matte: true, callout: true });
        if (my !== built || !alive) { if (made) made.view.stop(); return true; }
        if (!made) { end3d(); return false; }
        model = made;
        if (made.view.open) made.view.setOpen(true); // (the case starts open, so the parts inside show as they are built)
        views = beats.map((b) => (b.part >= 0 && made.view.has(b.part) ? [kept(part3d(b.part))] : []));
        beats.forEach((b) => { if (b.part >= 0) made.view.hide(b.part); }); // (nothing shows until its beat)
        const tip = ((t) => (t.length <= 110 ? t : t.slice(0, 110).replace(/\s+\S*$/, '') + '…'))(words(cur.spec.note, 400)); // (a note is cut at a whole word)
        if (tip) { const n = document.createElement('p'); n.className = 'lv-sticky'; n.textContent = tip; (floating ? floatEl : paper).insertBefore(n, floating ? floatStage : cardStage); }
        made.view.onPick = (part) => { picked = part ? beats.findIndex((b) => b.part === made.spec.parts.indexOf(part)) : -1; paintWords(); };
        host.dataset.parts = String(views.reduce((n, v) => n + v.length, 0));
        paint3d();
        return true;
      } catch (e) { end3d(); return false; }
    }
    // 3D can't show here: the same answer as a flat drawing (asked for once), or at least her words
    async function flatInstead() {
      if (opts.send && askedNow) {
        setStatus('looking');
        try {
          const got = await from({ send: opts.send, ask: prompt({ q: askedNow, page: opts.page || null, draw: true, dim: '2d' }), draw: true });
          if (!alive) return;
          if (got.kind === 'card' && got.scene.dim !== '3d') { adopt(got.scene, askedNow); await build(); return; }
        } catch (e) { /* her words, below */ }
      }
      if (!alive) return;
      cur = { ...cur, dim: '2d' };
      beats.forEach((b) => { b.parts = []; b.part = undefined; });
      await build();
    }
    const S = 2.2; // (her arrow's size on the card)
    function placeCursor(spot) {
      if (!cursor) return;
      if (!spot || still) { cursor.style.opacity = '0'; return; }
      cursor.style.transform = `translate(${Math.round(spot[0] - 5 * S)}px, ${Math.round(spot[1] - 3 * S)}px) scale(${S})`;
      cursor.style.opacity = '1';
    }
    const setBeat = (i, k) => { (views[i] || []).forEach((v) => v.set(k)); };
    const shownParts = () => { host.dataset.drawn = String(views.reduce((n, list) => n + list.filter((v) => v.k >= 1).length, 0)); };

    /* her words: every beat said so far, the one being said now in bold */
    function paintWords() {
      wordsEl.replaceChildren();
      beats.forEach((b, i) => {
        if (i > at) return;
        if (b.asked) { const a = document.createElement('p'); a.className = 'lv-asked'; a.textContent = 'You asked: ' + b.asked; wordsEl.appendChild(a); }
        if (!b.say) return;
        const p = document.createElement('p');
        p.className = 'lv-line' + (i === at ? ' is-now' : '') + (i === picked ? ' is-picked' : ''); p.textContent = b.say;
        wordsEl.appendChild(p);
      });
      const tapped = wordsEl.querySelector('.is-picked');
      if (tapped) { wordsEl.scrollTop = Math.max(0, tapped.offsetTop - wordsEl.offsetTop - 8); wordsEl.classList.toggle('is-more', wordsEl.scrollTop > 0); return; }
      wordsEl.scrollTop = wordsEl.scrollHeight;
      wordsEl.classList.toggle('is-more', wordsEl.scrollTop > 0);
    }
    function paintNav() {
      const last = beats.length - 1, play = $('.lv-play');
      $('.lv-count').textContent = at >= 0 ? `${at + 1} of ${beats.length}` : '';
      $('.lv-back').disabled = at <= 0;
      $('.lv-next').disabled = at >= last && (done || !playing && !mid);
      play.textContent = playing ? 'Pause' : 'Play';
      host.dataset.beat = String(at); host.dataset.playing = playing ? '1' : '0';
      wrapEl.classList.toggle('lv-cleared', cleared);
      $('.lv-steps').hidden = cleared; paper.hidden = cleared; wordsEl.hidden = cleared; $('.lv-clear').hidden = cleared;
      const board = $('.lv-board'); if (board) board.hidden = cleared;
      paint3d();
    }

    /* voice: Bella's studio voice (from Cassie's server, through the background) and no other, by the same
       rule as her lessons: she speaks only if what's left of the month's voice covers every beat still to
       come; otherwise, or if Bella stops partway, the beats are typed and the card says so once. */
    let actx = null, src = null, studio = false, asked = false;
    const clips = new Map();
    const audio = () => { const AC = window.AudioContext || window.webkitAudioContext; if (!actx && AC) { try { actx = new AC(); } catch (e) { actx = null; } } return actx; };
    const hush = () => { if (src) { try { src.onended = null; src.stop(); } catch (e) { /* already stopped */ } src = null; } if (actx && actx.state === 'suspended') actx.resume().catch(() => {}); };
    const typing = (guest) => { studio = false; if (!vnote.hidden) return; vnote.textContent = say(guest ? 'voice_ext_account' : 'voice_typing'); vnote.hidden = false; };
    async function decideVoice(fromBeat) {
      asked = true;
      const need = beats.slice(fromBeat).reduce((n, b) => n + b.say.length, 0);
      const left = await tell({ type: 'CASSIE_SPEAK_LEFT' });
      if (!alive) return;
      studio = !!(left && left.on && left.left >= need && audio());
      if (!studio) typing(!!(left && left.guest));
    }
    // one beat's words in her voice (asked for once, tried twice), or null when Bella can't say it
    function clip(i) {
      const text = beats[i].say;
      if (!clips.has(text)) clips.set(text, (async () => {
        for (let tries = 0; tries < 2; tries++) {
          const r = await tell({ type: 'CASSIE_SPEAK', text });
          if (r && r.audio) {
            try {
              const bin = atob(r.audio), bytes = new Uint8Array(bin.length);
              for (let j = 0; j < bin.length; j++) bytes[j] = bin.charCodeAt(j);
              const ac = audio();
              if (!ac) return null;
              if (ac.state === 'suspended') { try { await ac.resume(); } catch (e) { /* stays suspended */ } }
              if (ac.state !== 'running') return null;
              return await new Promise((res, rej) => ac.decodeAudioData(bytes.buffer, res, rej));
            } catch (e) { return null; }
          }
          if (r && r.usedUp) break;
        }
        return null;
      })());
      return clips.get(text);
    }

    /* playing: one beat at a time. Its parts are spread over the time its sentence takes: as long as her
       voice says it, or the time it takes to read. */
    function schedule(list, D) {
      const span = Math.max(500 * pace, D * 0.86), slot = span / Math.max(1, list.length), dur = clamp(slot * 0.92, 240 * pace, 1300);
      list.forEach((v, j) => { v.t0 = j * slot; v.dur = dur; });
    }
    async function startBeat(i) {
      const my = ++run;
      cancelAnimationFrame(raf); clearTimeout(gap); hush();
      mid = null; done = false; cleared = false; playing = true; at = i; nextUp = i;
      beats.forEach((b, j) => setBeat(j, j < i ? 1 : 0));
      placeCursor(null);
      paintWords(); paintNav(); shownParts();
      const beat = beats[i];
      let D = readPace(beat.say) * pace, voiced = null;
      if (voiceOn && studio && beat.say) {
        setStatus('speaking');
        const buf = await clip(i);
        if (my !== run || !alive) return;
        if (buf && voiceOn) voiced = buf; else if (!buf) typing();
      }
      let clock;
      if (voiced) {
        const node = actx.createBufferSource();
        node.buffer = voiced; node.connect(actx.destination);
        src = node;
        const t0 = actx.currentTime;
        try { node.start(); } catch (e) { src = null; }
        D = voiced.duration * 1000;
        host.dataset.spoken = String(+host.dataset.spoken + 1);
        clock = { now: () => (actx.currentTime - t0) * 1000, pause: () => actx.suspend().catch(() => {}), resume: () => actx.resume().catch(() => {}) };
        if (beats[i + 1] && beats[i + 1].say) clip(i + 1); // (her next line loads while this one is said)
      } else {
        let base = performance.now(), held = 0, stopped = 0;
        clock = { now: () => (stopped || performance.now()) - base - held, pause: () => { stopped = performance.now(); }, resume: () => { held += performance.now() - stopped; stopped = 0; } };
      }
      setStatus(voiced ? 'speaking' : 'drawing');
      schedule(views[i], D);
      const tick = () => {
        raf = 0;
        if (my !== run || !alive) return;
        const t = clock.now();
        let spot = null, moving = false;
        views[i].forEach((v) => { const k = still ? 1 : clamp((t - v.t0) / v.dur); v.set(k); if (k > 0 && k < 1) { moving = true; spot = v.tip(k) || spot; } });
        host.dataset.moving = moving ? '1' : '0';
        if (moving) placeCursor(spot);
        shownParts();
        if (t >= D + 240 * pace) { endBeat(i, my); return; }
        raf = requestAnimationFrame(tick);
      };
      mid = { tick, clock };
      tick();
    }
    function endBeat(i, my) {
      mid = null;
      setBeat(i, 1); placeCursor(null); host.dataset.moving = '0'; shownParts();
      if (i < beats.length - 1) { nextUp = i + 1; gap = setTimeout(() => { if (my === run && alive && playing) startBeat(i + 1); }, 320 * pace); }
      else finish();
    }
    function finish() { playing = false; done = true; mid = null; setStatus('done'); paintNav(); shownParts(); }
    // a beat shown whole, with nothing moving (paused, and Back or Next)
    function showStill(i) {
      run++; cancelAnimationFrame(raf); clearTimeout(gap); hush();
      mid = null; playing = false; cleared = false; at = i; nextUp = i + 1; done = i >= beats.length - 1;
      beats.forEach((b, j) => setBeat(j, j <= i ? 1 : 0));
      placeCursor(null); host.dataset.moving = '0';
      paintWords(); setStatus(done ? 'done' : 'paused'); paintNav(); shownParts();
    }
    function pause() {
      if (!playing) return;
      playing = false;
      clearTimeout(gap); cancelAnimationFrame(raf);
      if (mid) mid.clock.pause(); else run++; // (waiting for her voice, or between beats: Play starts that beat)
      setStatus('paused'); paintNav();
    }
    function resume() {
      if (cleared || done || at < 0) { replay(); return; }
      if (mid) { playing = true; mid.clock.resume(); setStatus(src ? 'speaking' : 'drawing'); paintNav(); raf = requestAnimationFrame(mid.tick); return; }
      if (nextUp < beats.length) startBeat(nextUp); else replay();
    }
    async function replay() {
      if (cleared) { cleared = false; paintNav(); if (!(await build())) await flatInstead(); if (!alive || cleared) return; }
      startBeat(0);
    }
    // Clear: everything she drew goes, and her voice stops. A small card stays, to ask again or replay.
    function clear() {
      run++; cancelAnimationFrame(raf); clearTimeout(gap); hush();
      mid = null; playing = false; done = false;
      try { lastPic = toCanvas(480).toDataURL('image/jpeg', 0.8); } catch (e) { lastPic = ''; } // (kept for Your lessons)
      cleared = true; built++;
      svg.replaceChildren(); views = []; cursor = null; end3d();
      host.dataset.drawn = '0'; host.dataset.moving = '0';
      setStatus('cleared'); paintNav();
    }

    /* the picture of the drawing, for the board and for Your lessons (always on white paper) */
    function toCanvas(W) {
      const c = document.createElement('canvas'), pal = PAPER.light;
      if (is3d() && model) {
        const stage = floating ? floatStage : cardStage, gl = stage.querySelector('canvas'), r = stage.getBoundingClientRect(), k = W / Math.max(1, r.width);
        c.width = W; c.height = Math.max(1, Math.round(r.height * k));
        const x = c.getContext('2d');
        x.fillStyle = pal.paper; x.fillRect(0, 0, c.width, c.height);
        if (gl) x.drawImage(gl, 0, 0, c.width, c.height);
        x.font = `600 ${Math.round(13 * k)}px system-ui, sans-serif`; x.textBaseline = 'middle'; x.textAlign = 'center';
        stage.querySelectorAll('.ld-tag').forEach((t) => {
          if (t.hidden) return;
          const tx = parseFloat(t.style.left) * k, ty = parseFloat(t.style.top) * k, ax = +t.dataset.ax * k, ay = +t.dataset.ay * k, w = x.measureText(t.textContent).width + 24 * k, h = 28 * k;
          x.strokeStyle = pal.ink; x.lineWidth = 1.5 * k; x.beginPath(); x.moveTo(ax, ay); x.lineTo(tx, ty); x.stroke();
          x.fillStyle = pal.ink; x.beginPath(); x.arc(ax, ay, 3 * k, 0, Math.PI * 2); x.fill();
          x.fillStyle = pal.paper; x.strokeStyle = pal.grey; x.beginPath(); x.roundRect(tx - w / 2, ty - h / 2, w, h, h / 2); x.fill(); x.stroke();
          x.fillStyle = pal.ink; x.fillText(t.textContent, tx, ty);
        });
        return c;
      }
      if (isFlat() && model) {
        // (her flat drawing as it stands on the card: every stroke and name that shows, in the card's own colours)
        const sv = cardStage.querySelector('svg'), k = W / 400;
        c.width = W; c.height = Math.round(W * 0.65);
        const x = c.getContext('2d');
        x.fillStyle = getComputedStyle(paper).backgroundColor || pal.paper; x.fillRect(0, 0, c.width, c.height);
        x.scale(k, k); x.lineCap = 'round'; x.lineJoin = 'round';
        const A = (n, a, d = 0) => { const v = parseFloat(n.getAttribute(a)); return Number.isFinite(v) ? v : d; };
        (sv ? [...sv.querySelectorAll('.ld-part > *, .ld-labels *')] : []).forEach((n) => {
          const tag = n.tagName.toLowerCase(), cs = getComputedStyle(n);
          if (tag === 'g' || cs.visibility === 'hidden' || cs.display === 'none') return;
          if (tag === 'text') { x.fillStyle = cs.fill; x.font = `${cs.fontWeight} ${A(n, 'font-size', 11)}px system-ui, sans-serif`; x.textAlign = cs.textAnchor === 'middle' ? 'center' : cs.textAnchor === 'end' ? 'right' : 'left'; x.textBaseline = cs.dominantBaseline === 'middle' || cs.dominantBaseline === 'central' ? 'middle' : 'alphabetic'; x.fillText(n.textContent, A(n, 'x'), A(n, 'y')); return; }
          const path = new Path2D();
          if (tag === 'path') path.addPath(new Path2D(n.getAttribute('d') || ''));
          else if (tag === 'line') { path.moveTo(A(n, 'x1'), A(n, 'y1')); path.lineTo(A(n, 'x2'), A(n, 'y2')); }
          else if (tag === 'rect') path.roundRect(A(n, 'x'), A(n, 'y'), A(n, 'width'), A(n, 'height'), A(n, 'rx'));
          else if (tag === 'circle') path.arc(A(n, 'cx'), A(n, 'cy'), A(n, 'r'), 0, Math.PI * 2);
          else if (tag === 'ellipse') path.ellipse(A(n, 'cx'), A(n, 'cy'), A(n, 'rx'), A(n, 'ry'), 0, 0, Math.PI * 2);
          else if (tag === 'polyline' || tag === 'polygon') (n.getAttribute('points') || '').trim().split(/\s+/).forEach((q, i) => { const [px, py] = q.split(',').map(Number); if (i) path.lineTo(px, py); else path.moveTo(px, py); });
          else return;
          if (cs.fill && cs.fill !== 'none') { x.save(); x.globalAlpha = parseFloat(cs.fillOpacity) || 1; x.fillStyle = cs.fill; x.fill(path); x.restore(); }
          if (cs.stroke && cs.stroke !== 'none') {
            x.strokeStyle = cs.stroke; x.lineWidth = parseFloat(cs.strokeWidth) || 2; x.setLineDash(n.getAttribute('stroke-dasharray') === '6 6' ? [6, 6] : []); x.stroke(path);
            if (tag === 'line' && n.getAttribute('marker-end')) { const x1 = A(n, 'x1'), y1 = A(n, 'y1'), x2 = A(n, 'x2'), y2 = A(n, 'y2'), a = Math.atan2(y2 - y1, x2 - x1), h = 4 + x.lineWidth * 2; x.setLineDash([]); x.fillStyle = cs.stroke; x.beginPath(); x.moveTo(x2 + Math.cos(a) * 2, y2 + Math.sin(a) * 2); x.lineTo(x2 - Math.cos(a - 0.45) * h, y2 - Math.sin(a - 0.45) * h); x.lineTo(x2 - Math.cos(a + 0.45) * h, y2 - Math.sin(a + 0.45) * h); x.closePath(); x.fill(); }
          }
        });
        return c;
      }
      c.width = W; c.height = Math.round((W * GH) / GW);
      const x = c.getContext('2d');
      x.fillStyle = pal.paper; x.fillRect(0, 0, c.width, c.height);
      x.scale(W / (GW * K), W / (GW * K)); x.lineCap = 'round'; x.lineJoin = 'round';
      views.forEach((list) => list.forEach((v) => v.paint(x, pal)));
      return c;
    }
    // kept on this device with her other lessons: the title, her words, and her drawing (never the picture of the screen)
    function saveLesson() {
      let pic = '';
      try { pic = cleared ? lastPic : toCanvas(480).toDataURL('image/jpeg', 0.8); } catch (e) { pic = ''; }
      // (her first answer is the lesson's steps; each follow-up is kept with its answer)
      const steps = [], qa = [];
      beats.forEach((b, i) => { if (i > 0 && b.asked) qa.push({ q: b.asked, a: b.say }); else if (qa.length) qa[qa.length - 1].a += ' ' + b.say; else if (b.say) steps.push(b.say); });
      const item = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), at: Date.now(), title: String(info.title || document.title || 'A drawing').slice(0, 120), q: String(beats[0] && beats[0].asked || opts.q || '').slice(0, 300), steps, qa: qa.slice(0, 20), pic };
      store.get(['teachLessons']).then((o) => { const list = Array.isArray(o.teachLessons) ? o.teachLessons : []; store.set({ teachLessons: [item, ...list].slice(0, 20) }); });
    }

    function close() {
      if (!alive) return;
      if (opts.save !== false) saveLesson();
      alive = false; run++; built++;
      cancelAnimationFrame(raf); clearTimeout(gap); hush();
      end3d();
      if (actx) { try { actx.close(); } catch (e) { /* ignore */ } }
      removeEventListener('keydown', onKey, true); removeEventListener('resize', placeFloat);
      if (mic && mic.stop) mic.stop();
      host.remove();
      if (current && current.host === host) current = null;
      if (window.CassieTeach && window.CassieTeach.follow) window.CassieTeach.follow.hide(false); // (her cursor comes back beside the mouse)
      if (opts.onClose) opts.onClose();
    }
    // Escape: first everything she drew goes (the same as Clear); pressed again, the card closes
    const onKey = (e) => { if (e.key !== 'Escape' || !alive) return; e.stopPropagation(); if (cleared) close(); else clear(); };
    addEventListener('keydown', onKey, true);
    addEventListener('resize', placeFloat);

    /* the side of the window that covers least of what the question is about */
    function aboutRect() {
      const a = opts.about || cur.about;
      if (a && a.x != null) return { left: a.x * innerWidth, right: (a.x + a.w) * innerWidth };
      if (opts.pointer) return { left: opts.pointer.x - 40, right: opts.pointer.x + 40 };
      return null;
    }
    function bestSide() {
      const r = aboutRect(), w = card.offsetWidth, m = 16;
      if (!r) return 'right';
      const over = (x0, x1) => Math.max(0, Math.min(r.right, x1) - Math.max(r.left, x0));
      return over(m, m + w) < over(innerWidth - m - w, innerWidth - m) ? 'left' : 'right';
    }
    const setSide = (side) => { card.dataset.side = side; host.dataset.side = side; placeFloat(); };

    /* the buttons */
    $('.lv-x').addEventListener('click', close);
    $('.lv-back').addEventListener('click', () => { const i = Math.max(0, at - 1); if (playing) startBeat(i); else showStill(i); });
    $('.lv-next').addEventListener('click', () => { const last = beats.length - 1; if (at >= last) showStill(last); else if (playing) startBeat(at + 1); else showStill(at + 1); });
    $('.lv-play').addEventListener('click', () => { if (playing) pause(); else resume(); });
    $('.lv-replay').addEventListener('click', replay);
    $('.lv-clear').addEventListener('click', clear);
    $('.lv-clear3').addEventListener('click', clear);
    $('.lv-open').addEventListener('click', () => { if (model && model.view.open) { model.view.open(); paint3d(); } });
    $('.lv-apart').addEventListener('click', () => { if (!model || !model.view.explode) return; const on = model.view.explode(), b = $('.lv-apart'); b.textContent = on ? 'Put it back' : 'Pull apart'; b.setAttribute('aria-pressed', String(on)); });
    if ($('.lv-side')) $('.lv-side').addEventListener('click', () => setSide(card.dataset.side === 'left' ? 'right' : 'left'));
    if ($('.lv-board')) $('.lv-board').addEventListener('click', () => {
      let canvas = null;
      try { canvas = toCanvas(1600); } catch (e) { canvas = null; }
      const told = { title: info.title || 'Cassie’s drawing', steps: beats.map((b) => b.say).filter(Boolean) };
      close();
      if (canvas) onBoard(canvas, told);
    });
    const setVoice = (on) => { voiceOn = on; const b = $('.lv-voice'); b.setAttribute('aria-pressed', String(on)); b.textContent = on ? 'Voice on' : 'Voice off'; };
    $('.lv-voice').addEventListener('click', () => {
      setVoice(!voiceOn); store.set({ teachVoice: voiceOn ? 'on' : 'off' });
      if (!voiceOn) { if (src) { hush(); if (playing && at >= 0) startBeat(at); } } // (her voice stops: this beat goes on as typed)
      else if (!asked) decideVoice(Math.max(0, at + 1)); // (turned on partway: the beats still to come decide it)
    });

    /* follow-ups: typed or said. She answers from the same picture, and adds to the drawing or starts a new one. */
    const askForm = $('.lv-ask'), askIn = askForm && askForm.querySelector('input');
    let mic = null;
    if (askForm) {
      mic = window.CassieMic ? window.CassieMic.attach(askIn, { send: () => askForm.requestSubmit() }) : null;
      if (mic && mic.button) new MutationObserver(() => { if (mic.button.dataset.on) setStatus('listening'); else if (host.dataset.status === 'listening') setStatus(playing ? (src ? 'speaking' : 'drawing') : cleared ? 'cleared' : done ? 'done' : 'paused'); }).observe(mic.button, { attributes: true, attributeFilter: ['data-on'] });
      askIn.addEventListener('keydown', (e) => { if (e.key !== 'Escape') e.stopPropagation(); }); // (the page's own shortcuts stay out of the box)
      askForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const q = askIn.value.trim();
        if (!q) { askIn.focus(); return; }
        askIn.value = '';
        const my = ++asking;
        // more beats on the drawing that is there (on a 3D model they are words only), or a new scene in its place
        const addBeats = async (list) => {
          if (cleared) { cleared = false; if (!(await build())) await flatInstead(); }
          const first = beats.length;
          const whole = is3d() || isFlat();
          list.forEach((b, i) => beats.push({ say: b.say, parts: whole ? [] : (b.parts || []).slice(), asked: i === 0 ? q : '' }));
          if (whole) list.forEach(() => views.push([])); else await build();
          return first;
        };
        // (the drawing it replaces is kept in Your lessons first, with its own question and follow-ups)
        const newScene = async (sc) => { if (opts.save !== false) saveLesson(); cleared = false; adopt(sc, q); if (!(await build())) await flatInstead(); return 0; };
        // a student at risk: care first, and no AI is asked (care.js; counted with no words, no id)
        const hit = window.CassieCare && window.CassieCare.check(q);
        if (hit) {
          const first = await addBeats([{ say: window.CassieCare.reply(hit.lang), parts: [] }]);
          if (my === asking && alive) showStill(first);
          tell({ type: 'CASSIE_CARE' });
          return;
        }
        if (playing) pause();
        setStatus('looking');
        // on a flat drawing she may add to it; a 3D model (there now, or asked for now) is asked about afresh
        const afresh = is3d() || isFlat() || wants3d(q);
        const words_ = afresh ? prompt({ q, page: opts.page || null, draw: wants(q), said: beats.map((b) => b.say).filter(Boolean) }) : prompt({ q, page: opts.page || null, scene: { title: info.title, beats }, said: [] });
        let got = null;
        try { got = await from({ send: opts.send, ask: words_, draw: wants(q) }); }
        catch (err) { if (my === asking && alive) { const first = await addBeats([{ say: problem(err), parts: [] }]); if (my === asking && alive) showStill(first); } return; }
        if (my !== asking || !alive) return;
        host.dataset.answered = String(+(host.dataset.answered || 0) + 1);
        const fresh = got.kind === 'card' && (afresh || !got.scene.keep);
        const first = fresh ? await newScene(got.scene) : await addBeats(got.kind === 'card' ? got.scene.beats : [{ say: got.answer + (got.noDraw ? ' ' + say('live_no_drawing') : ''), parts: [] }]);
        if (my !== asking || !alive) return;
        if (voiceOn && studio) await decideVoice(first);
        if (my !== asking || !alive) return;
        startBeat(first);
      });
    }

    current = { host, close };
    if (window.CassieTeach && window.CassieTeach.follow) window.CassieTeach.follow.hide(true); // (her cursor beside the mouse waits while she draws)
    if (!inPanel) setSide(bestSide());
    setStatus('drawing'); paintNav();
    try { card.focus({ preventScroll: true }); } catch (e) { /* not focusable here */ }
    const ready = build().then((ok) => (ok ? null : flatInstead()));
    store.get(['teachVoice']).then(async (o) => {
      if (!alive) return;
      setVoice(o.teachVoice !== 'off');
      await ready;
      if (!alive) return;
      if (voiceOn) await decideVoice(0);
      if (!alive || at >= 0 || cleared) return;
      startBeat(0);
    });
    return current;
  }
  function stop() { if (current) current.close(); const old = document.getElementById(HOST_ID); if (old) old.remove(); current = null; }

  /* ---------- on a web page: look once, ask, and draw ---------- */
  // ask({ q, from, hideUi(hidden), again() }) → { kind, answer, scene, steps, noDraw }
  // She reads the page (its numbered parts, and one picture of the visible tab) only now, when asked.
  async function ask({ q = '', from: startAt = null, hideUi = null, again = null } = {}) {
    const T = window.CassieTeach, links = window.CassieLiveHost || {};
    hideUi = hideUi || links.hideUi || (() => {});
    stop(); T.stop();
    const page = T.scan();
    let image = null, out = null;
    hideUi(true); T.follow.hide(true);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); // (her own buttons stay out of the picture)
    try { out = await chrome.runtime.sendMessage({ type: 'CASSIE_SNIP' }); } catch (e) { out = null; } finally { hideUi(false); T.follow.hide(false); }
    image = out && out.dataUrl && !(out.full && out.full.std < 4) ? out.dataUrl : null;
    if (!image) throw keyed('teach_no_picture');
    const send = async (words_, maxTokens) => {
      let r = null;
      try { r = await chrome.runtime.sendMessage({ type: 'CASSIE_VISION', image, prompt: words_, maxTokens, best: true }); } catch (e) { r = { error: e.message }; }
      if (!r || r.error) throw new Error((r && r.error) || 'ask failed');
      return String(r.reply || '');
    };
    const numbered = !page.pictureOnly, draw = wants(q);
    const got = await from({ send, ask: prompt({ q, page, draw }), count: numbered ? page.items.length : 0, draw });
    if (got.kind === 'card') {
      const about = got.scene.about && got.scene.about.el ? (() => { const it = page.items[got.scene.about.el - 1]; return it ? { x: it.box[0], y: it.box[1], w: it.box[2], h: it.box[3] } : null; })() : got.scene.about;
      const near = T.follow.at();
      play(got.scene, { q, send, page: { title: page.title }, about, pointer: near ? { x: near.x - 16, y: near.y - 18 } : null });
    } else if (got.kind === 'page') {
      T.show({ steps: got.steps, title: document.title, q }, { from: startAt, shot: image, numbered, again });
    }
    return got;
  }

  window.CassieLive = { parse, prompt, play, stop, from, ask, wants, wants3d, problem, get active() { return !!current; }, get has3d() { return !!lib3d; } };

  // on a web page: the side panel asks her to draw here (CASSIE_LIVE_SHOW: the scene she replied with, and the
  // picture it was made from, for follow-ups), or to stop (top frame only, and never on Cassie's own site)
  const onCassieSite = document.querySelector('meta[name="cassie-app"]') || /(^|\.)askcassie\.pages\.dev$|(^|\.)usernamehaze\.github\.io$/.test(location.hostname);
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage && !/^chrome-extension:$|^moz-extension:$/.test(location.protocol) && window.top === window && !onCassieSite) {
    chrome.runtime.onMessage.addListener((msg, sender, reply) => {
      if (!msg) return false;
      if (msg.type === 'CASSIE_LIVE_SHOW') {
        const send = async (ask_, maxTokens) => {
          const r = await chrome.runtime.sendMessage({ type: 'CASSIE_VISION', image: msg.shot, prompt: ask_, maxTokens, best: true });
          if (!r || r.error) throw new Error((r && r.error) || 'ask failed');
          return String(r.reply || '');
        };
        if (window.CassieTeach) window.CassieTeach.stop();
        reply({ ok: !!play(msg.scene, { q: msg.q || '', send: msg.shot ? send : null, page: { title: document.title }, about: msg.about || null }) });
        return false;
      }
      if (msg.type === 'CASSIE_LIVE_STOP' || msg.type === 'CASSIE_TEACH_STOP') { stop(); if (msg.type === 'CASSIE_LIVE_STOP') reply({ ok: true }); return false; }
      return false;
    });
  }
})();

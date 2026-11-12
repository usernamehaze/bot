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
 *   CassieLive.parse(reply, count) → { kind, answer, scene, steps }
 *       kind 'card': scene { title, caption, view, about, beats: [{ say, parts }] } (bad parts are left out)
 *       kind 'page': steps for CassieTeach.show (she points at the page instead)
 *       kind 'words': only an answer          kind '': nothing that can be used
 *   CassieLive.prompt({ q, page, draw, scene, said }) → what Cassie is asked
 *   CassieLive.play(scene, opts) → the card { host, close }      CassieLive.stop() ends it
 *   CassieLive.from({ send, ask, count, draw }) → one reply, read (asked once more, more strictly, when it can't be used)
 *   CassieLive.ask({ q, from, hideUi, again }) → on a page: one picture of the tab, her reply, and the drawing
 *   CassieLive.wants(q) → the question asks for a drawing ("draw", "sketch", "a diagram of", "show me how")
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
    const s = t.search(/"beats"\s*:\s*\[/);
    if (s < 0) return null;
    const beats = [];
    for (let k = t.indexOf('[', s) + 1; k < t.length;) {
      while (k < t.length && /[\s,]/.test(t[k])) k++;
      if (t[k] !== '{') break;
      const e = closeOf(t, k);
      if (e < 0) break; // (the beat that was cut off)
      try { beats.push(JSON.parse(t.slice(k, e + 1))); } catch (err) { break; }
      k = e + 1;
    }
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
    const scene = d && Array.isArray(d.beats) ? cleanScene(d, count) : null;
    const said = scene ? scene.beats.map((b) => b.say).filter(Boolean).join(' ') : '';
    if (scene && scene.beats.some((b) => b.parts.length)) return { kind: 'card', answer: answer || said, scene, steps: [] };
    const steps = T ? T.parse(reply, count) : [];
    if (steps.length) return { kind: 'page', answer: answer || steps.map((x) => x.say).join(' '), scene: null, steps };
    return { kind: answer || said ? 'words' : '', answer: answer || said, scene: scene && said ? scene : null, steps: [] };
  }

  /* ---------- what Cassie is asked ---------- */
  // (the same words the Cassie app takes as "draw it"; but "this diagram" on the screen is a thing to explain, not an order to draw)
  const WANTS = /\b(draw|redraw|sketch|illustrate|visuali[sz]e|iguhit|ipakita)\b|\bi-?drawing\b|\b(make|create|give|show|do|build)\b[^.?!]{0,24}\b(drawing|sketch|diagram|illustration|model)\b|\bdiagram of\b|\bshow\b[^.?!]{0,20}\bhow\b|\b(explain|teach)\b[^.?!]*\b(with|using|in)\s+(a\s+)?(drawing|diagram|graphics?|visuals?|3d)\b|\bin\s+3d\b/i;
  const wants = (q) => WANTS.test(String(q || ''));
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
  // one worked example (a kettle), so she sees how a drawing grows beat by beat
  const EXAMPLE = { answer: 'A hot coil at the bottom heats the water until it boils.', about: [0.3, 0.2, 0.3, 0.5], title: 'How a kettle boils water', caption: 'a hot coil heats the water', view: 'Cut-away', beats: [
    { say: 'I can see an electric kettle on a shop page. The page does not explain how it works, so here is how.', draw: [{ shape: 'outline', points: [[34, 20], [60, 20], [67, 40], [69, 60], [25, 60], [27, 40]] }, { shape: 'curve', points: [[66, 28], [80, 32], [80, 50], [69, 54]] }, { shape: 'curve', points: [[29, 30], [19, 26], [15, 18]] }, { shape: 'box', x: 22, y: 60, w: 50, h: 5, fill: 'grey' }] },
    { say: 'A metal coil at the bottom gets hot when electricity flows through it.', draw: [{ shape: 'curve', points: [[31, 55], [36, 50], [41, 55], [46, 50], [51, 55], [56, 50], [61, 55]], color: 'red' }, { shape: 'label', x: 84, y: 66, text: 'Heating coil', to: [61, 55] }] },
    { say: 'The coil warms the water next to it. Warm water rises and cooler water sinks, so all of it heats up.', draw: [{ shape: 'line', points: [[29, 32], [66, 32]], color: 'blue', dash: 1 }, { shape: 'arrow', points: [[40, 47], [40, 36]], color: 'red' }, { shape: 'arrow', points: [[54, 36], [54, 47]], color: 'blue' }, { shape: 'label', x: 12, y: 46, text: 'Warm water rises', to: [39, 42] }, { shape: 'label', x: 88, y: 22, text: 'Cool water sinks', to: [55, 41] }] },
    { say: 'At 100 degrees Celsius the water boils into steam, and a switch turns the kettle off.', draw: [{ shape: 'curve', points: [[12, 15], [9, 11], [13, 8], [10, 4]], color: 'grey' }, { shape: 'curve', points: [[18, 14], [15, 10], [19, 7], [16, 3]], color: 'grey' }, { shape: 'label', x: 30, y: 7, text: 'Steam', to: [19, 8] }, { shape: 'note', x: 82, y: 9, text: 'Steam burns. Keep hands away.' }] },
  ] };
  const EXAMPLE_HELP = `An example. The question was "how does this kettle boil water?", asked over a shop page that shows a kettle:\n  ${JSON.stringify(EXAMPLE)}`;

  // prompt({ q, page: { title, text, items, pictureOnly }, draw, scene, said })
  //   draw: the student asked for a drawing, so she draws (no pointing at the page instead)
  //   scene: the drawing on the card now, for a follow-up (she adds to it, or starts a new one)
  //   said: what she has said so far (a lesson's steps, or the card's beats)
  function prompt({ q = '', page = null, draw = false, scene = null, said = [] } = {}) {
    const T = window.CassieTeach, truth = T && T.truth ? T.truth.asked : '';
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
    if (draw) {
      return `${seen}
  Answer like a kind tutor sitting beside them, and draw it for them while you explain. The student asked for a drawing, so always draw one.
  Reply with ONLY minified JSON, no other text:
  ${CARD_SHAPE}
  ${CARD_HELP}
  ${EXAMPLE_HELP}
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
  ${CARD_SHAPE}
  ${CARD_HELP}${list ? '\n  In B, "about" can also be the number of a thing on the list.' : ''}
  ${EXAMPLE_HELP}
  For a quick fact that needs neither, reply {"answer":"your answer","steps":[]}.
  ${truth}`;
  }

  const STRICT = '\n  IMPORTANT: your last reply could not be read. Reply with ONLY the JSON object, nothing before or after it. At most 4 beats, and at most 4 parts in each beat.';
  const DRAW_IT = '\n  IMPORTANT: the student asked for a drawing and your last reply had none. Reply in the drawing form, and give every beat at least one part to draw.';
  // One reply from Cassie, read: send(prompt, maxTokens) → her reply. A reply that can't be used (or has no
  // drawing when one was asked for) is asked for once more, more strictly. → { kind, answer, scene, steps, noDraw }
  async function from({ send, ask, count = 0, draw = false, maxTokens = 3000 } = {}) {
    let last = null;
    for (let tries = 0; tries < 2; tries++) {
      const reply = await send(tries ? ask + (last && last.kind ? DRAW_IT : STRICT) : ask, maxTokens);
      const got = parse(reply, count);
      if (got.kind === 'card' || (got.kind && !draw)) return got;
      if (got.kind) last = got;
      else if (tries && !last) { const plain = String(reply || '').trim(); if (plain && plain.indexOf('{') < 0) last = { kind: 'words', answer: plain.slice(0, 1500), scene: null, steps: [] }; } // (plain words twice: they are still an answer)
    }
    if (last) return { ...last, noDraw: !!draw };
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
    .lv-in-panel .lv-card { position: static; width: auto; max-height: none; box-shadow: none; }
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
    .lv-card button { all: unset; box-sizing: border-box; min-height: 44px; min-width: 44px; padding: 0 16px; border-radius: 12px; display: inline-flex; align-items: center; justify-content: center; gap: 8px;
      font: 600 14px/1 ${FONT}; color: var(--ink); background: var(--card); border: 1px solid var(--line); cursor: pointer; }
    .lv-card button:hover { border-color: var(--edge); }
    .lv-card button:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
    .lv-card button:disabled { opacity: .45; cursor: default; }
    .lv-card button[aria-pressed="false"] { color: var(--mute); }
    .lv-card .lv-pri { background: var(--pri); color: var(--pri-ink); border-color: var(--pri); }
    .lv-card .lv-icon { padding: 0; }
    .lv-icon svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    /* a short window (a small laptop): the drawing and her words sit side by side, so both show at once */
    @media (max-height: 680px) and (min-width: 880px) {
      .lv-on-page:not(.lv-cleared) .lv-card { width: min(776px, calc(100vw - 32px)); }
      .lv-on-page:not(.lv-cleared) .lv-body { display: grid; grid-template-columns: minmax(0, 1fr) 344px; align-items: start; }
      .lv-on-page .lv-svg { max-height: max(168px, calc(100vh - 184px)); }
      .lv-on-page .lv-words { max-height: 132px; }
    }
  `;

  let current = null;
  const store = {
    get: (k) => new Promise((res) => { try { chrome.storage.local.get(k, (o) => res(o || {})); } catch (e) { res({}); } }),
    set: (o) => { try { chrome.storage.local.set(o); } catch (e) { /* not kept */ } },
  };
  const tell = (msg) => { try { return chrome.runtime.sendMessage(msg).catch(() => null); } catch (e) { return Promise.resolve(null); } };
  const readPace = (text) => Math.min(9000, 1400 + String(text || '').length * 45); // (typed: time to read it, as in her lessons)

  // play(scene, { q, send, mount, image, about, pointer, onBoard, onClose, save, pace })
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
            <svg class="lv-svg" viewBox="0 0 ${GW * K} ${GH * K}" role="img"></svg>
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
              ${onBoard ? '<button type="button" class="lv-board">Open on the board</button>' : ''}
            </div>
            ${opts.send ? '<form class="lv-ask" autocomplete="off"><input type="text" placeholder="Ask a follow-up" aria-label="Ask a follow-up" maxlength="300" enterkeyhint="send"><button type="submit" class="lv-send">Ask</button></form>' : ''}
          </div>
        </div>
      </div>`;
    root.appendChild(wrapEl);
    (inPanel ? opts.mount : document.documentElement).appendChild(host);
    const $ = (s) => root.querySelector(s);
    const card = $('.lv-card'), svg = $('.lv-svg'), paper = $('.lv-paper'), wordsEl = $('.lv-words'), statusEl = $('.lv-status span'), vnote = $('.lv-vnote');
    const el = (name, attrs = {}) => { const n = document.createElementNS(NS, name); Object.keys(attrs).forEach((k) => n.setAttribute(k, attrs[k])); return n; };
    wordsEl.addEventListener('scroll', () => wordsEl.classList.toggle('is-more', wordsEl.scrollTop > 0), { passive: true });

    let beats = scene.beats.map((b, i) => ({ say: b.say, parts: b.parts.slice(), asked: i === 0 ? String(opts.q || '') : '' }));
    let info = { title: scene.title, caption: scene.caption, view: scene.view };
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
    // every part of every beat, built once and hidden: a beat's parts appear when it is played
    function build() {
      svg.replaceChildren();
      views = beats.map((b) => b.parts.map((p) => {
        const v = p.shape === 'label' ? labelView(p) : p.shape === 'note' ? noteView(p) : lineView(p), show = v.set;
        v.k = 0; v.set = (k) => { v.k = k; show(k); };
        svg.appendChild(v.g); v.set(0);
        return v;
      }));
      cursor = el('g', { class: 'lv-cur' });
      cursor.appendChild(el('path', { d: ARROW }));
      cursor.style.opacity = '0';
      svg.appendChild(cursor);
      host.dataset.parts = String(views.reduce((n, v) => n + v.length, 0));
      $('.lv-title').textContent = info.title || 'Cassie’s drawing';
      $('.lv-sub').textContent = [info.view, 'Simplified sketch'].filter(Boolean).join(' · ');
      svg.setAttribute('aria-label', [info.title, info.caption].filter(Boolean).join(': ') || 'Cassie’s drawing');
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
        p.className = 'lv-line' + (i === at ? ' is-now' : ''); p.textContent = b.say;
        wordsEl.appendChild(p);
      });
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
    function replay() { if (cleared) { cleared = false; paintNav(); build(); } startBeat(0); }
    // Clear: everything she drew goes, and her voice stops. A small card stays, to ask again or replay.
    function clear() {
      run++; cancelAnimationFrame(raf); clearTimeout(gap); hush();
      mid = null; playing = false; done = false; cleared = true;
      svg.replaceChildren(); views = []; cursor = null;
      host.dataset.drawn = '0'; host.dataset.moving = '0';
      setStatus('cleared'); paintNav();
    }

    /* the picture of the drawing, for the board and for Your lessons (always on white paper) */
    function toCanvas(W) {
      const c = document.createElement('canvas');
      c.width = W; c.height = Math.round((W * GH) / GW);
      const x = c.getContext('2d'), pal = PAPER.light;
      x.fillStyle = pal.paper; x.fillRect(0, 0, c.width, c.height);
      x.scale(W / (GW * K), W / (GW * K)); x.lineCap = 'round'; x.lineJoin = 'round';
      views.forEach((list) => list.forEach((v) => v.paint(x, pal)));
      return c;
    }
    // kept on this device with her other lessons: the title, her words, and her drawing (never the picture of the screen)
    function saveLesson() {
      let pic = '';
      try { if (cleared) build(); pic = toCanvas(480).toDataURL('image/jpeg', 0.8); } catch (e) { pic = ''; }
      // (her first answer is the lesson's steps; each follow-up is kept with its answer)
      const steps = [], qa = [];
      beats.forEach((b, i) => { if (i > 0 && b.asked) qa.push({ q: b.asked, a: b.say }); else if (qa.length) qa[qa.length - 1].a += ' ' + b.say; else if (b.say) steps.push(b.say); });
      const item = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), at: Date.now(), title: String(info.title || document.title || 'A drawing').slice(0, 120), q: String(opts.q || '').slice(0, 300), steps, qa: qa.slice(0, 20), pic };
      store.get(['teachLessons']).then((o) => { const list = Array.isArray(o.teachLessons) ? o.teachLessons : []; store.set({ teachLessons: [item, ...list].slice(0, 20) }); });
    }

    function close() {
      if (!alive) return;
      if (opts.save !== false) saveLesson();
      alive = false; run++;
      cancelAnimationFrame(raf); clearTimeout(gap); hush();
      if (actx) { try { actx.close(); } catch (e) { /* ignore */ } }
      removeEventListener('keydown', onKey, true);
      if (mic && mic.stop) mic.stop();
      host.remove();
      if (current && current.host === host) current = null;
      if (window.CassieTeach && window.CassieTeach.follow) window.CassieTeach.follow.hide(false); // (her cursor comes back beside the mouse)
      if (opts.onClose) opts.onClose();
    }
    // Escape: first everything she drew goes (the same as Clear); pressed again, the card closes
    const onKey = (e) => { if (e.key !== 'Escape' || !alive) return; e.stopPropagation(); if (cleared) close(); else clear(); };
    addEventListener('keydown', onKey, true);

    /* the side of the window that covers least of what the question is about */
    function aboutRect() {
      const a = opts.about || scene.about;
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
    const setSide = (side) => { card.dataset.side = side; host.dataset.side = side; };

    /* the buttons */
    $('.lv-x').addEventListener('click', close);
    $('.lv-back').addEventListener('click', () => { const i = Math.max(0, at - 1); if (playing) startBeat(i); else showStill(i); });
    $('.lv-next').addEventListener('click', () => { const last = beats.length - 1; if (at >= last) showStill(last); else if (playing) startBeat(at + 1); else showStill(at + 1); });
    $('.lv-play').addEventListener('click', () => { if (playing) pause(); else resume(); });
    $('.lv-replay').addEventListener('click', replay);
    $('.lv-clear').addEventListener('click', clear);
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
        const addBeats = (list, startNew) => {
          if (cleared) { cleared = false; build(); }
          const first = startNew ? 0 : beats.length;
          if (startNew) beats = [];
          list.forEach((b, i) => beats.push({ say: b.say, parts: b.parts.slice(), asked: i === 0 ? q : '' }));
          build();
          return first;
        };
        // a student at risk: care first, and no AI is asked (care.js; counted with no words, no id)
        const hit = window.CassieCare && window.CassieCare.check(q);
        if (hit) {
          const first = addBeats([{ say: window.CassieCare.reply(hit.lang), parts: [] }], false);
          showStill(first);
          tell({ type: 'CASSIE_CARE' });
          return;
        }
        if (playing) pause();
        setStatus('looking');
        let got = null;
        try { got = await from({ send: opts.send, ask: prompt({ q, page: opts.page || null, scene: { title: info.title, beats }, said: [] }), draw: wants(q) }); }
        catch (err) { if (my === asking && alive) { const first = addBeats([{ say: problem(err), parts: [] }], false); showStill(first); } return; }
        if (my !== asking || !alive) return;
        host.dataset.answered = String(+(host.dataset.answered || 0) + 1);
        const fresh = got.kind === 'card' && !got.scene.keep;
        const list = got.kind === 'card' ? got.scene.beats : [{ say: got.answer + (got.noDraw ? ' ' + say('live_no_drawing') : ''), parts: [] }];
        if (fresh) info = { title: got.scene.title, caption: got.scene.caption, view: got.scene.view };
        const first = addBeats(list, fresh);
        if (voiceOn && studio) await decideVoice(first);
        if (my !== asking || !alive) return;
        startBeat(first);
      });
    }

    current = { host, close };
    if (window.CassieTeach && window.CassieTeach.follow) window.CassieTeach.follow.hide(true); // (her cursor beside the mouse waits while she draws)
    build();
    if (!inPanel) setSide(bestSide());
    setStatus('drawing'); paintNav();
    try { card.focus({ preventScroll: true }); } catch (e) { /* not focusable here */ }
    store.get(['teachVoice']).then(async (o) => {
      if (!alive) return;
      setVoice(o.teachVoice !== 'off');
      if (voiceOn) await decideVoice(0);
      if (!alive || at >= 0) return;
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
      try { r = await chrome.runtime.sendMessage({ type: 'CASSIE_VISION', image, prompt: words_, maxTokens }); } catch (e) { r = { error: e.message }; }
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

  window.CassieLive = { parse, prompt, play, stop, from, ask, wants, problem, get active() { return !!current; } };
})();
